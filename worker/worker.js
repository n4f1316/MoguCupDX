// もぐらたたきカップ API（Cloudflare Workers + D1）
//
// 公開:
//   GET  /api/public                 大会設定のうち公開してよい項目と申請人数
//   GET  /jacket/<file>.png          ジャケット画像の中継（画像に描き込めるよう CORS を付ける）
// 参加者（ログイン。Authorization: Bearer <セッション>）:
//   POST /api/auth/register          { username, pin }  新規登録（2fRATE のユーザー名なら 2fRATE と連携）
//   POST /api/auth/login             { username, pin }  ログイン（2fRATE の ID・PIN でも可）
//   POST /api/auth/logout
//   GET  /api/me                     自分の申請・試合・選曲の状況
//   POST /api/entry                  参加申請
//   POST /api/me/songs               { songs: [譜面キー×3] }   段階「自選曲の提出」
//   POST /api/me/ban                 { index }                  段階「BAN」（相手の自選曲の番号）
//   POST /api/me/pick                { index }                  段階「自選曲の決定」（自分の自選曲の番号）
// 運営（Authorization: Bearer <ADMIN_KEY>）:
//   GET    /api/admin/entries
//   PUT    /api/admin/entries/:id
//   DELETE /api/admin/entries/:id
//   GET    /api/admin/state          { settings, matches, picks }
//   PUT    /api/admin/state          { settings?, matches? }
//   PUT    /api/admin/picks          { items: [{ match_id, entry_id, songs, ban, pick }] }
//   POST   /api/admin/reset-pin      { username }  このツールで作ったユーザーの仮PINを発行
//
// 設定: D1 バインディング DB、シークレット ADMIN_KEY、変数 ALLOWED_ORIGINS
// 任意: サービスバインディング RATE2F（2fRATE の Worker）。無ければ RATE2F_URL に直接送る

const JACKET_BASES = [
  'https://maimaidx.jp/maimai-mobile/img/Music/',
  'https://maimai.sega.jp/storage/DX_jacket/',
];
const CONSTS_URL = 'https://n4f1316.github.io/dxscore-tools/maimai_consts_magical.json';
const RATE2F_URL = 'https://2frate.want131611.workers.dev/';
const SESSION_DAYS = 30;
const PHASES = ['closed', 'select', 'ban', 'pick', 'done'];

const DEFAULT_SETTINGS = {
  title: '第3回 もぐらたたきカップ',
  round: '1回戦',
  entryOpen: true,
  entryDeadline: '',   // 例 "2026-11-01T23:59"（日本時間）。空なら期限なし
  notice: '',          // 参加者ページに出すお知らせ
  phase: 'closed',     // closed：組み合わせ非公開 / select：自選曲の提出 / ban：BAN / pick：自選曲の決定 / done：対戦曲の確定
  phaseNote: '',       // 段階の締切など、参加者ページに出す一言
  // 部門ごとの、新しく作る対戦カードの既定値（上限・運営課題曲・運営課題曲2）
  divDefaults: { lime: { cap: 14.0, kadai: '', kadai2: '' }, lemon: { cap: 14.0, kadai: '', kadai2: '' } },
  format: 'main',      // main：本編（運営課題曲あり） / mini：mini（運営課題曲なし、自選曲の投げ合いのみ）
  notes: {
    pair: '自選曲を3曲選んで提出してください',
    reveal: 'BANされなかった2曲から、自分の自選曲を1曲選んで提出してください',
    final: '対戦曲は自選曲・他選曲・運営課題曲の3曲です',
  },
};
const PUBLIC_KEYS = ['title', 'round', 'entryOpen', 'entryDeadline', 'notice', 'phase', 'phaseNote', 'format'];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? 'サーバーでエラーが起きました' : e.message }, status, cors);
    }
  },
};

async function route(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (m === 'GET' && p.startsWith('/jacket/')) return jacket(p.slice(8));
  if (m === 'GET' && p === '/api/public') {
    const s = await getSettings(env);
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first();
    return json({ settings: publicSettings(s), entryCount: n });
  }
  if (m === 'POST' && p === '/api/auth/register') return register(req, env);
  if (m === 'POST' && p === '/api/auth/login') return login(req, env);
  if (m === 'POST' && p === '/api/auth/logout') {
    const t = bearer(req);
    if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(t)).run();
    return json({ ok: true });
  }
  if (m === 'GET' && p === '/api/me') return me(await requireUser(req, env), env);
  if (m === 'POST' && p === '/api/entry') return entry(req, env, await requireUser(req, env));
  if (m === 'POST' && p === '/api/me/songs') return submitSongs(req, env, await requireUser(req, env));
  if (m === 'POST' && p === '/api/me/ban') return submitBan(req, env, await requireUser(req, env));
  if (m === 'POST' && p === '/api/me/pick') return submitPick(req, env, await requireUser(req, env));

  if (p.startsWith('/api/admin/')) {
    await requireAdmin(req, env);
    return admin(req, env, p.slice('/api/admin/'.length), m);
  }
  return json({ error: '見つかりません' }, 404);
}

// ============================================================
//  ユーザー（このツールで作るユーザーと、2fRATE と連携するユーザー）
// ============================================================

function readCredentials(b) {
  const username = String(b.username ?? '').trim().toLowerCase();
  const pin = String(b.pin ?? '').trim();
  if (!/^[a-z0-9_]{3,16}$/.test(username)) throw err(400, 'ユーザー名は英数字とアンダーバーで3〜16文字にしてください');
  if (!/^\d{4,8}$/.test(pin)) throw err(400, 'PINは数字4〜8桁にしてください');
  return { username, pin };
}

// 2fRATE の確認 API。{ ok, exists } が返る。PIN が違うときは ok:false
async function check2f(env, username, pin) {
  const req = new Request(env.RATE2F_URL || RATE2F_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'check', username, pin }),
  });
  try {
    const r = env.RATE2F ? await env.RATE2F.fetch(req) : await fetch(req);
    if (!r.ok) return { unavailable: true };
    const j = await r.json().catch(() => null);
    if (!j || (!j.ok && j.busy)) return { unavailable: true };
    if (j.ok && j.exists) return { valid: true, profile: pickProfile(j) };
    if (j.ok) return { missing: true };
    return { wrongPin: true };
  } catch {
    return { unavailable: true };
  }
}
const UNAVAILABLE_2F = '2fRATE のサーバーにつながりませんでした。少し時間をおいて、もう一度お試しください';

async function guardLock(env, username) {
  const r = await env.DB.prepare('SELECT fails, locked_until FROM login_fails WHERE username=?').bind(username).first();
  if (r && r.locked_until > Date.now()) throw err(429, 'PINを続けて間違えたため、15分ほどログインできません');
}
async function recordFail(env, username) {
  const r = await env.DB.prepare('SELECT fails FROM login_fails WHERE username=?').bind(username).first();
  const fails = (r?.fails || 0) + 1;
  const lock = fails >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
  await env.DB.prepare('INSERT INTO login_fails (username, fails, locked_until) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until')
    .bind(username, lock ? 0 : fails, lock).run();
}
const clearFails = (env, username) => env.DB.prepare('DELETE FROM login_fails WHERE username=?').bind(username).run();

// 2fRATE のレート（☆7まで）と、MASTER・Re:MASTER の☆5・☆6 達成数（☆5 は☆5以上の数）
function pickProfile(j) {
  const src = j.record || j;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const c = src.counts || {};
  const p = { rateFull: n(src.rateFull), star5Mas: n(c.star5Mas), star5Remas: n(c.star5Remas), star6Mas: n(c.star6Mas), star6Remas: n(c.star6Remas) };
  return Object.values(p).some((v) => v !== null) ? p : null;
}

async function upsert2fUser(env, username, profile) {
  await env.DB.prepare("INSERT INTO users (username, source) VALUES (?, '2frate') ON CONFLICT(username) DO NOTHING").bind(username).run();
  if (profile) await env.DB.prepare('UPDATE users SET profile=? WHERE username=?').bind(JSON.stringify(profile), username).run();
  return env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
}

async function register(req, env) {
  const { username, pin } = readCredentials(await body(req));
  await guardLock(env, username);
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first()) {
    throw err(409, 'このユーザー名はすでに登録されています。「ログイン」から入ってください');
  }
  const c = await check2f(env, username, pin);
  if (c.unavailable) throw err(503, UNAVAILABLE_2F);
  if (c.wrongPin) {
    await recordFail(env, username);
    throw err(409, 'このユーザー名は 2fRATE で使われています。2fRATE の PIN で「ログイン」してください');
  }
  let user;
  if (c.valid) {
    user = await upsert2fUser(env, username, c.profile);
  } else {
    const salt = randomHex(16);
    await env.DB.prepare("INSERT INTO users (username, source, pin_hash, pin_salt) VALUES (?, 'local', ?, ?)")
      .bind(username, await hashPin(pin, salt), salt).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
  }
  await clearFails(env, username);
  return json({ token: await newSession(env, user.id), user: userView(user), linked2f: user.source === '2frate' });
}

async function login(req, env) {
  const { username, pin } = readCredentials(await body(req));
  await guardLock(env, username);
  let user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
  if (user && user.source === 'local') {
    if ((await hashPin(pin, user.pin_salt)) !== user.pin_hash) {
      await recordFail(env, username);
      throw err(401, 'ユーザー名か PIN が違います');
    }
  } else {
    const c = await check2f(env, username, pin);
    if (c.unavailable) throw err(503, UNAVAILABLE_2F);
    if (c.missing && !user) throw err(404, 'このユーザー名は登録されていません。「新規登録」から登録してください');
    if (!c.valid) {
      await recordFail(env, username);
      throw err(401, 'ユーザー名か PIN が違います（2fRATE と連携しているユーザーは 2fRATE の PIN です）');
    }
    user = await upsert2fUser(env, username, c.profile);
  }
  await clearFails(env, username);
  return json({ token: await newSession(env, user.id), user: userView(user) });
}

const userView = (u) => ({ username: u.username, linked2f: u.source === '2frate', profile: u.source === '2frate' ? JSON.parse(u.profile || 'null') : null });

async function newSession(env, userId) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, exp).run();
  return token;
}

async function requireUser(req, env) {
  const t = bearer(req);
  if (!t) throw err(401, 'ログインしてください');
  const r = await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?')
    .bind(await sha256(t), Date.now()).first();
  if (!r) throw err(401, 'ログインの有効期限が切れました。もう一度ログインしてください');
  return r;
}

// ============================================================
//  参加申請・自分の試合
// ============================================================

// 部門と神プレート（申請の設問）
const DIVISIONS = [{ id: 'lime', name: 'らいむ部門' }, { id: 'lemon', name: 'れもん部門' }];
const PLATES = ['真', '超', '檄', '橙', '暁', '桃', '櫻', '紫', '菫', '白', '雪', '輝', '舞', '熊', '華', '爽', '煌', '宙', '星', '祭', '祝', '双', '宴', '鏡', '彩', '丸', '廻'];

async function entry(req, env, user) {
  const s = await getSettings(env);
  if (!isOpen(s)) throw err(403, '参加申請の受付は終了しています');
  if (await env.DB.prepare('SELECT 1 FROM entries WHERE user_id=?').bind(user.id).first()) throw err(409, 'このユーザーはすでに申請しています');
  const b = await body(req);
  const v = validateEntry(b);
  const answers = validateAnswers(b.answers || {});
  const r = await env.DB.prepare('INSERT INTO entries (entry_name, x_id, rating, frate, user_id, answers) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(v.entryName, v.xId, v.rating, v.frate, user.id, JSON.stringify(answers)).run().catch(dup);
  return json({ ok: true, id: r.meta.last_row_id });
}

function validateEntry(b) {
  const entryName = String(b.entryName ?? '').trim().replace(/\s+/g, ' ');
  const xId = String(b.xId ?? '').trim().replace(/^@/, '');
  const rating = Number(b.rating);
  const frate = Number(b.frate);
  if (!entryName || [...entryName].length > 20) throw err(400, 'スコアタで使用する名前は1〜20文字で入力してください');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(xId)) throw err(400, 'X の ID は英数字と _ の15文字以内で入力してください（@ は不要）');
  if (!Number.isInteger(rating) || rating < 0 || rating > 20000) throw err(400, 'レートは 0〜20000 の整数で入力してください');
  if (!Number.isFinite(frate) || frate < 0 || frate > 30) throw err(400, '2fRATE は 0〜30 の数値で入力してください');
  return { entryName, xId, rating, frate: Math.round(frate * 1000) / 1000 };
}

// 申請の設問（Q2・Q4・Q6〜Q12）
function validateAnswers(a) {
  const discord = String(a.discord ?? '').trim();
  if (!discord || [...discord].length > 40) throw err(400, 'Discord で使用している名前を40文字以内で入力してください');
  const divisions = DIVISIONS.map((d) => d.id).filter((id) => (a.divisions || []).includes(id));
  if (!divisions.length) throw err(400, '参加したい部門を1つ以上選んでください');
  const plates = PLATES.filter((p) => (a.plates || []).includes(p));
  const count = (v, label) => {
    const n = Number(v);
    if (v === '' || v == null || !Number.isInteger(n) || n < 0 || n > 9999) throw err(400, `${label}を0以上の整数で入力してください`);
    return n;
  };
  const out = { discord, divisions, plates };
  if (divisions.includes('lime')) {
    const l = a.lime || {};
    if (typeof l.lv14 !== 'boolean') throw err(400, '【らいむ部門】自選曲にレベル14を含められるようにしたいか選んでください');
    out.lime = { m5: count(l.m5, '【らいむ部門】MASTERの星5達成譜面数'), r5: count(l.r5, '【らいむ部門】Re:MASTERの星5達成譜面数'), s6: count(l.s6, '【らいむ部門】星6達成合計譜面数'), lv14: l.lv14 };
  }
  if (divisions.includes('lemon')) {
    const l = a.lemon || {};
    out.lemon = { ap14: count(l.ap14, '【れもん部門】レベル14のAP達成譜面数'), ap14p: count(l.ap14p, '【れもん部門】レベル14+のAP達成譜面数') };
  }
  return out;
}

function dup(e) {
  if (String(e).includes('UNIQUE')) throw err(409, 'この名前または X の ID はすでに申請されています');
  throw e;
}

// 自選曲として選べるか：上限以下。Lv14解禁の試合では、上限を超える Lv14（14.0〜14.5）を1曲まで
const isLv14 = (c) => c >= 14 - 1e-9 && c < 14.6 - 1e-9;
function checkSongs(consts, songs, m, mini) {
  let over = 0;
  for (const k of songs) {
    const c0 = consts[k];
    if (c0 === undefined) throw err(400, '譜面データにない譜面が含まれています');
    if (!mini && ((m.kadai && k === m.kadai))) throw err(400, '運営課題曲は自選曲に選べません');
    if (c0 <= Number(m.cap) + 1e-9) continue;
    if (m.lv14 && isLv14(c0)) { over++; continue; }
    throw err(400, `譜面定数 ${Number(m.cap).toFixed(1)} を超える譜面は選べません${m.lv14 ? '（レベル14を1曲だけ除く）' : ''}`);
  }
  if (over > 1) throw err(400, '上限を超えるレベル14の譜面は1曲までです');
}

// 自分の試合（部門ごとに1試合）と、今の段階で見てよい情報
async function myContext(env, user, matchId) {
  const s = await getSettings(env);
  const e = await env.DB.prepare('SELECT * FROM entries WHERE user_id=?').bind(user.id).first();
  if (!e || s.phase === 'closed') return { s, e, list: [] };
  const matches = (await getKV(env, 'matches')) ?? [];
  const mine = matches.filter((x) => (x.a === e.id || x.b === e.id) && (!matchId || x.id === matchId));
  const row = async (mid, id) => {
    if (!id) return { songs: [], ban: -1, pick: -1 };
    const r = await env.DB.prepare('SELECT songs, ban, pick FROM picks WHERE match_id=? AND entry_id=?').bind(mid, id).first();
    return r ? { songs: JSON.parse(r.songs), ban: r.ban, pick: r.pick } : { songs: [], ban: -1, pick: -1 };
  };
  const list = [];
  for (const m of mine) {
    const oppId = m.a === e.id ? m.b : m.a;
    const opp = oppId ? await env.DB.prepare('SELECT id, entry_name, x_id FROM entries WHERE id=?').bind(oppId).first() : null;
    const no = matches.filter((x) => (x.div || '') === (m.div || '')).findIndex((x) => x.id === m.id) + 1;
    list.push({ m, no, opp, mine: await row(m.id, e.id), theirs: await row(m.id, opp?.id) });
  }
  return { s, e, list };
}

async function me(user, env) {
  const c = await myContext(env, user);
  const ph = PHASES.indexOf(c.s.phase);
  const mini = c.s.format === 'mini';
  const matches = c.list.map(({ m, no, opp, mine, theirs }) => ({
    id: m.id, no, div: m.div || '', divName: DIVISIONS.find((d) => d.id === m.div)?.name || '',
    cap: m.cap, lv14: !!m.lv14, kadai: mini ? '' : m.kadai || '',
    // 運営課題曲2：両者が同じ曲を自選曲にしたときだけ、対戦曲確定の段階で公開
    kadai2: !mini && ph >= 4 && mine.pick >= 0 && theirs.pick >= 0 && mine.songs[mine.pick] === theirs.songs[theirs.pick] ? m.kadai2 || '' : '',
    opponent: opp ? { entryName: opp.entry_name } : null,
    mySongs: mine.songs,
    myBan: mine.ban,                                         // 自分が BAN した相手の曲の番号
    myPick: mine.pick,                                       // 自分が決めた自選曲の番号
    oppSubmitted: theirs.songs.length === 3,
    oppSongs: ph >= 2 ? theirs.songs : null,                 // BAN の段階から公開
    bannedMine: ph >= 3 ? theirs.ban : null,                 // 相手に BAN された自分の曲（決定の段階から）
    oppPick: ph >= 4 ? theirs.pick : null,                   // 相手の自選曲（確定の段階から）
  }));
  const entryView = c.e && { entryName: c.e.entry_name, xId: c.e.x_id, rating: c.e.rating, frate: c.e.frate, answers: JSON.parse(c.e.answers || '{}') };
  return json({ user: userView(user), settings: publicSettings(c.s), entry: entryView, matches });
}

async function writePick(env, matchId, entryId, fields) {
  await env.DB.prepare("INSERT INTO picks (match_id, entry_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(matchId, entryId).run();
  const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
  await env.DB.prepare(`UPDATE picks SET ${sets}, updated_at=datetime('now') WHERE match_id=? AND entry_id=?`)
    .bind(...Object.values(fields), matchId, entryId).run();
}

async function oneMatch(req, env, user, phase, phaseMsg) {
  const b = await body(req);
  const c = await myContext(env, user, String(b.matchId || ''));
  if (!c.list.length) throw err(403, '対戦カードがまだ公開されていません');
  if (c.list.length > 1) throw err(400, 'どの試合の提出か分かりませんでした。ページを再読み込みしてください');
  if (c.s.phase !== phase) throw err(403, phaseMsg);
  return { b, c, x: c.list[0] };
}

async function submitSongs(req, env, user) {
  const { b, c, x } = await oneMatch(req, env, user, 'select', '今は自選曲を提出できる期間ではありません');
  const songs = Array.isArray(b.songs) ? b.songs.map(String) : [];
  if (songs.length !== 3) throw err(400, '自選曲を3曲選んでください');
  if (new Set(songs).size !== 3) throw err(400, '同じ譜面を2回以上選ぶことはできません');
  checkSongs(await loadConsts(env), songs, x.m, c.s.format === 'mini');
  await writePick(env, x.m.id, c.e.id, { songs: JSON.stringify(songs), pick: -1 });
  return json({ ok: true });
}

async function submitBan(req, env, user) {
  const { b, c, x } = await oneMatch(req, env, user, 'ban', '今は BAN を選べる期間ではありません');
  if (x.theirs.songs.length !== 3) throw err(409, '相手の自選曲がまだそろっていません。運営に連絡してください');
  const i = Number(b.index);
  if (![0, 1, 2].includes(i)) throw err(400, 'BAN する曲を選んでください');
  await writePick(env, x.m.id, c.e.id, { ban: i });
  return json({ ok: true });
}

async function submitPick(req, env, user) {
  const { b, c, x } = await oneMatch(req, env, user, 'pick', '今は自選曲を決める期間ではありません');
  if (x.mine.songs.length !== 3) throw err(409, '自選曲が提出されていません。運営に連絡してください');
  if (x.theirs.ban < 0) throw err(409, '相手の BAN がまだ決まっていません。運営に連絡してください');
  const i = Number(b.index);
  if (![0, 1, 2].includes(i)) throw err(400, '自選曲を選んでください');
  if (i === x.theirs.ban) throw err(400, 'BAN された曲は選べません');
  await writePick(env, x.m.id, c.e.id, { pick: i });
  return json({ ok: true });
}

// 譜面定数表（10分ごとに読み直す）
let constsCache = null;
async function loadConsts(env) {
  if (constsCache && constsCache.at > Date.now() - 10 * 60 * 1000) return constsCache.data;
  const r = await fetch(env.CONSTS_URL || CONSTS_URL, { cf: { cacheTtl: 600 } }).catch(() => null);
  if (!r?.ok) {
    if (constsCache) return constsCache.data;
    throw err(503, '譜面データを読み込めませんでした。少し時間をおいて、もう一度お試しください');
  }
  constsCache = { at: Date.now(), data: await r.json() };
  return constsCache.data;
}

// ============================================================
//  運営
// ============================================================

async function admin(req, env, sub, m) {
  if (m === 'GET' && sub === 'entries') {
    const { results } = await env.DB.prepare('SELECT e.*, u.username, u.source FROM entries e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id').all();
    return json({ entries: results.map((r) => ({ ...r, answers: JSON.parse(r.answers || '{}') })) });
  }
  const em = sub.match(/^entries\/(\d+)$/);
  if (em && m === 'PUT') {
    const b = await body(req);
    const v = validateEntry(b);
    const memo = String(b.memo ?? '').slice(0, 200);
    const cur = await env.DB.prepare('SELECT answers FROM entries WHERE id=?').bind(+em[1]).first();
    const prev = JSON.parse(cur?.answers || '{}');
    // 運営は Discord 名と部門だけ直せる（部門別の回答は残す）
    const answers = { ...prev };
    if (b.discord !== undefined) answers.discord = String(b.discord).trim().slice(0, 40);
    if (Array.isArray(b.divisions)) answers.divisions = DIVISIONS.map((d) => d.id).filter((id) => b.divisions.includes(id));
    await env.DB.prepare('UPDATE entries SET entry_name=?, x_id=?, rating=?, frate=?, memo=?, answers=? WHERE id=?')
      .bind(v.entryName, v.xId, v.rating, v.frate, memo, JSON.stringify(answers), +em[1]).run().catch(dup);
    return json({ ok: true });
  }
  if (em && m === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM entries WHERE id=?').bind(+em[1]),
      env.DB.prepare('DELETE FROM picks WHERE entry_id=?').bind(+em[1]),
    ]);
    return json({ ok: true });
  }
  if (sub === 'state' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM picks').all();
    const picks = results.map((r) => ({ ...r, songs: JSON.parse(r.songs) }));
    return json({ settings: await getSettings(env), matches: (await getKV(env, 'matches')) ?? [], picks });
  }
  if (sub === 'state' && m === 'PUT') {
    const b = await body(req);
    if (b.settings) {
      if (b.settings.phase && !PHASES.includes(b.settings.phase)) throw err(400, '段階の指定が正しくありません');
      if (b.settings.format && !['main', 'mini'].includes(b.settings.format)) throw err(400, '大会の形式の指定が正しくありません');
      await putKV(env, 'settings', { ...(await getSettings(env)), ...b.settings });
    }
    if (Array.isArray(b.matches)) {
      const ms = b.matches.map((x) => ({
        id: /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : randomHex(8),
        a: Number.isInteger(x.a) ? x.a : null,
        b: Number.isInteger(x.b) ? x.b : null,
        cap: Number(x.cap) || 15,
        kadai: String(x.kadai || ''),
        kadai2: String(x.kadai2 || ''),
        div: DIVISIONS.some((d) => d.id === x.div) ? x.div : '',
        lv14: !!x.lv14,
      }));
      await putKV(env, 'matches', ms);
    }
    return json({ ok: true });
  }
  if (sub === 'picks' && m === 'PUT') {
    const items = (await body(req)).items;
    if (!Array.isArray(items)) throw err(400, 'items がありません');
    for (const it of items) {
      const f = {};
      if (Array.isArray(it.songs)) f.songs = JSON.stringify(it.songs.slice(0, 3).map(String).filter(Boolean));
      if (Number.isInteger(it.ban)) f.ban = it.ban;
      if (Number.isInteger(it.pick)) f.pick = it.pick;
      if (Object.keys(f).length && it.match_id && Number.isInteger(it.entry_id)) await writePick(env, String(it.match_id), it.entry_id, f);
    }
    return json({ ok: true });
  }
  if (sub === 'reset-pin' && m === 'POST') {
    const username = String((await body(req)).username || '').toLowerCase();
    const u = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
    if (!u) throw err(404, 'そのユーザーは見つかりません');
    if (u.source !== 'local') throw err(400, '2fRATE と連携しているユーザーです。2fRATE の運営ページで仮PINを発行してください');
    const pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pin_hash=?, pin_salt=? WHERE id=?').bind(await hashPin(pin, salt), salt, u.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id),
      env.DB.prepare('DELETE FROM login_fails WHERE username=?').bind(username),
    ]);
    return json({ username, pin });
  }
  return json({ error: '見つかりません' }, 404);
}

// ============================================================
//  共通
// ============================================================

function isOpen(s) {
  if (!s.entryOpen) return false;
  if (!s.entryDeadline) return true;
  const dl = Date.parse(s.entryDeadline + ':00+09:00');
  return Number.isNaN(dl) || Date.now() <= dl;
}
function publicSettings(s) {
  return { ...Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]])), entryOpen: isOpen(s) };
}

async function jacket(file) {
  if (!/^[0-9a-f]{16}\.png$/.test(file)) return new Response('bad name', { status: 400 });
  for (const base of JACKET_BASES) {
    const r = await fetch(base + file, { cf: { cacheEverything: true, cacheTtl: 60 * 60 * 24 * 30 } }).catch(() => null);
    if (r?.ok) {
      return new Response(r.body, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=2592000', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }
  return new Response('not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
}

async function requireAdmin(req, env) {
  const got = bearer(req);
  const want = env.ADMIN_KEY || '';
  if (!want || got.length !== want.length) throw err(401, '管理者用の鍵が違います');
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  if (d) throw err(401, '管理者用の鍵が違います');
}

async function getSettings(env) {
  const s = (await getKV(env, 'settings')) ?? {};
  const dd = {};
  for (const k of Object.keys(DEFAULT_SETTINGS.divDefaults)) dd[k] = { ...DEFAULT_SETTINGS.divDefaults[k], ...(s.divDefaults?.[k] || {}) };
  return { ...DEFAULT_SETTINGS, ...s, notes: { ...DEFAULT_SETTINGS.notes, ...(s.notes || {}) }, divDefaults: dd };
}
async function getKV(env, key) {
  const r = await env.DB.prepare('SELECT value FROM kv WHERE key=?').bind(key).first();
  return r ? JSON.parse(r.value) : null;
}
async function putKV(env, key, value) {
  await env.DB.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(key, JSON.stringify(value)).run();
}

async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: 5000 }, key, 256);
  return toHex(new Uint8Array(bits));
}
async function sha256(s) { return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const base64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bearer = (req) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

async function body(req) {
  try { return await req.json(); } catch { throw err(400, '送信内容を読み取れませんでした'); }
}
function err(status, message) { return Object.assign(new Error(message), { status }); }
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' }
    : { Vary: 'Origin' };
}
