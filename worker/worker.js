// もぐらたたきカップ API（Cloudflare Workers + D1）
//
// 公開:
//   GET  /api/public            大会設定のうち公開してよい項目と申請人数
//   POST /api/entry             参加申請
//   GET  /jacket/<file>.png     ジャケット画像の中継（画像に描き込めるよう CORS を付ける）
// 運営（Authorization: Bearer <ADMIN_KEY>）:
//   GET    /api/admin/entries
//   PUT    /api/admin/entries/:id
//   DELETE /api/admin/entries/:id
//   GET    /api/admin/state     { settings, matches }
//   PUT    /api/admin/state     { settings?, matches? }
//
// 必要な設定: D1 バインディング DB、シークレット ADMIN_KEY、
//            変数 ALLOWED_ORIGINS（カンマ区切り。例 https://n4f1316.github.io）

const JACKET_BASES = [
  'https://maimaidx.jp/maimai-mobile/img/Music/',
  'https://maimai.sega.jp/storage/DX_jacket/',
];

const DEFAULT_SETTINGS = {
  title: '第3回 もぐらたたきカップ',
  round: '1回戦',
  entryOpen: true,
  entryDeadline: '',      // 例 "2026-11-01T23:59"（日本時間）。空なら期限なし
  notice: '',             // 申請ページに出すお知らせ
  constMin: 0,            // 自選曲の譜面定数の下限（0 で下限なし）
  constCap: 14.0,         // 自選曲の譜面定数の上限
  kadai: '',              // 運営課題曲 "曲名|DX|MASTER"
  notes: {
    pair: '自選曲を3曲選んで提出してください',
    reveal: 'BANされなかった2曲から、自分の自選曲を1曲選んで提出してください',
    final: '対戦曲は自選曲・他選曲・運営課題曲の3曲です',
  },
};
const PUBLIC_KEYS = ['title', 'round', 'entryOpen', 'entryDeadline', 'notice', 'constMin', 'constCap', 'kadai'];

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
    const pub = Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]]));
    return json({ settings: { ...pub, entryOpen: isOpen(s) }, entryCount: n });
  }
  if (m === 'POST' && p === '/api/entry') return entry(req, env);

  if (p.startsWith('/api/admin/')) {
    await requireAdmin(req, env);
    const sub = p.slice('/api/admin/'.length);
    if (m === 'GET' && sub === 'entries') {
      const { results } = await env.DB.prepare('SELECT * FROM entries ORDER BY id').all();
      return json({ entries: results });
    }
    const em = sub.match(/^entries\/(\d+)$/);
    if (em && m === 'PUT') {
      const b = await body(req);
      const v = validateEntry(b);
      const memo = String(b.memo ?? '').slice(0, 200);
      await env.DB.prepare('UPDATE entries SET entry_name=?, x_id=?, rating=?, frate=?, memo=? WHERE id=?')
        .bind(v.entryName, v.xId, v.rating, v.frate, memo, +em[1]).run().catch(dup);
      return json({ ok: true });
    }
    if (em && m === 'DELETE') {
      await env.DB.prepare('DELETE FROM entries WHERE id=?').bind(+em[1]).run();
      return json({ ok: true });
    }
    if (sub === 'state' && m === 'GET') {
      return json({ settings: await getSettings(env), matches: (await getKV(env, 'matches')) ?? [] });
    }
    if (sub === 'state' && m === 'PUT') {
      const b = await body(req);
      if (b.settings) await putKV(env, 'settings', { ...(await getSettings(env)), ...b.settings });
      if (Array.isArray(b.matches)) await putKV(env, 'matches', b.matches);
      return json({ ok: true });
    }
  }
  return json({ error: '見つかりません' }, 404);
}

async function entry(req, env) {
  const s = await getSettings(env);
  if (!isOpen(s)) throw err(403, '参加申請の受付は終了しています');
  const b = await body(req);
  if (b.website) return json({ ok: true }); // ボット対策（見えない入力欄に何か入っていたら捨てる）
  const v = validateEntry(b);
  const r = await env.DB.prepare('INSERT INTO entries (entry_name, x_id, rating, frate) VALUES (?, ?, ?, ?)')
    .bind(v.entryName, v.xId, v.rating, v.frate).run().catch(dup);
  return json({ ok: true, id: r.meta.last_row_id });
}

function validateEntry(b) {
  const entryName = String(b.entryName ?? '').trim().replace(/\s+/g, ' ');
  const xId = String(b.xId ?? '').trim().replace(/^@/, '');
  const rating = Number(b.rating);
  const frate = Number(b.frate);
  if (!entryName || [...entryName].length > 20) throw err(400, 'エントリー名は1〜20文字で入力してください');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(xId)) throw err(400, 'X の ID は英数字と _ の15文字以内で入力してください（@ は不要）');
  if (!Number.isInteger(rating) || rating < 0 || rating > 20000) throw err(400, 'maimai のレートは 0〜20000 の整数で入力してください');
  if (!Number.isFinite(frate) || frate < 0 || frate > 30) throw err(400, '2fRATE は 0〜30 の数値で入力してください');
  return { entryName, xId, rating, frate: Math.round(frate * 1000) / 1000 };
}

function dup(e) {
  if (String(e).includes('UNIQUE')) throw err(409, 'このエントリー名または X の ID はすでに申請されています');
  throw e;
}

function isOpen(s) {
  if (!s.entryOpen) return false;
  if (!s.entryDeadline) return true;
  const dl = Date.parse(s.entryDeadline + ':00+09:00');
  return Number.isNaN(dl) || Date.now() <= dl;
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
  const got = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const want = env.ADMIN_KEY || '';
  if (!want || got.length !== want.length) throw err(401, '管理者用の鍵が違います');
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  if (d) throw err(401, '管理者用の鍵が違います');
}

async function getSettings(env) {
  const s = (await getKV(env, 'settings')) ?? {};
  return { ...DEFAULT_SETTINGS, ...s, notes: { ...DEFAULT_SETTINGS.notes, ...(s.notes || {}) } };
}
async function getKV(env, key) {
  const r = await env.DB.prepare('SELECT value FROM kv WHERE key=?').bind(key).first();
  return r ? JSON.parse(r.value) : null;
}
async function putKV(env, key, value) {
  await env.DB.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(key, JSON.stringify(value)).run();
}

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
