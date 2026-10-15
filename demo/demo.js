// デモモード：本物の worker.js を、ブラウザの中のデータベースにつないで動かす
// （サーバーには何も送らない。データはこのブラウザの localStorage にだけ保存）
import worker from '../worker/worker.js?v=demo5';
import { makeDB, emptyData } from './memdb.js?v=demo5';

const STORE = 'mogucupdx-demo-db';
const ADMIN_KEY = 'demo';
const TOKEN = 'mogucupdx-demo-session';
const PIN = '0000';
const DEMO_API = window.MOGU_API;
const origFetch = window.__origFetch;
const CONSTS = new URL(window.MOGU_DATA + 'maimai_consts_magical.json', location.href).href;

// デモに最初から入っている参加者（PIN はすべて 0000）
const SEED = [
  { u: 'demo_mogura', name: 'もぐら太郎', x: 'mogura_taro', d: 'もぐら太郎', rating: 15820, frate: 13.452, divs: ['lime'], plates: ['真', '超'], lime: { m5: 180, r5: 12, s6: 40, lv14: true } },
  { u: 'demo_hammer', name: 'ハンマー花子', x: 'hammer_hana', d: 'hana', rating: 15910, frate: 13.611, divs: ['lime'], plates: ['真'], lime: { m5: 210, r5: 15, s6: 52, lv14: true } },
  { u: 'demo_anagura', name: 'あなぐら', x: 'anagura_mai', d: 'anagura', rating: 15640, frate: 13.105, divs: ['lime'], plates: [], lime: { m5: 140, r5: 8, s6: 21, lv14: true } },
  { u: 'demo_chitei', name: '地底のK', x: 'chitei_k', d: 'K', rating: 15500, frate: 12.874, divs: ['lime'], plates: [], lime: { m5: 120, r5: 5, s6: 18, lv14: true } },
  { u: 'demo_tsuchi', name: 'つちのこ', x: 'tsuchinoko', d: 'tsuchi', rating: 15420, frate: 12.630, divs: ['lime'], plates: [], lime: { m5: 95, r5: 3, s6: 12, lv14: false } },
  { u: 'demo_lemon', name: 'れもん先輩', x: 'lemon_senpai', d: 'lemon', rating: 16210, frate: 14.402, divs: ['lemon'], plates: ['真', '超', '檄', '舞'], lemon: { ap14: 85, ap14p: 30 } },
  { u: 'demo_ap', name: 'AP職人', x: 'ap_shokunin', d: 'ap_master', rating: 16330, frate: 14.655, divs: ['lemon'], plates: ['真', '超', '檄', '橙', '暁'], lemon: { ap14: 120, ap14p: 48 } },
  { u: 'demo_both', name: '両刀もぐら', x: 'ryoto_mogu', d: 'ryoto', rating: 16050, frate: 14.012, divs: ['lime', 'lemon'], plates: ['真', '超'], lime: { m5: 260, r5: 20, s6: 77, lv14: false }, lemon: { ap14: 40, ap14p: 9 } },
  { u: 'demo_kouhai', name: 'ほりほり後輩', x: 'horihori', d: 'horihori', rating: 16120, frate: 14.230, divs: ['lemon'], plates: ['真'], lemon: { ap14: 55, ap14p: 14 } },
];

// デモの中身の版。古い版のまま残っている・準備の途中で失敗したデータは作り直す
const DEMO_VERSION = 5;
let data;
try { data = JSON.parse(localStorage.getItem(STORE)); } catch { data = null; }
const fresh = !data || data.demoVersion !== DEMO_VERSION || !data.entries?.length;
if (fresh) data = emptyData();
let dirty = false;
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(data)); } catch {} dirty = false; };
const env = {
  DB: makeDB(data, () => { dirty = true; }),
  ADMIN_KEY,
  ALLOWED_ORIGINS: location.origin,
  CONSTS_URL: CONSTS,
  // 2fRATE の確認の代わり：porto_mint / 1234 だけ 2fRATE のユーザーとして扱う
  RATE2F: {
    async fetch(req) {
      const b = await req.json();
      const r = b.username === 'porto_mint' ? (b.pin === '1234' ? { ok: true, exists: true, rateFull: 13.874, counts: { star5Mas: 236, star5Remas: 18, star6Mas: 64, star6Remas: 5, star7Mas: 3, star7Remas: 0 } } : { ok: false, error: 'PINが違います' }) : { ok: true, exists: false };
      return new Response(JSON.stringify(r));
    },
  },
};

async function handle(input, init) {
  const req = input instanceof Request ? input : new Request(input, init);
  const res = await worker.fetch(req, env);
  if (dirty) save();
  return res;
}
const call = async (path, { method = 'GET', body, key } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  const r = await handle(DEMO_API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'エラー');
  return j;
};

let consts = null;
const loadConsts = async () => consts || (consts = await (await origFetch(CONSTS)).json());
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seed() {
  const c = await loadConsts();
  const keysIn = (lo, hi) => Object.entries(c).filter(([, v]) => v >= lo - 1e-9 && v <= hi + 1e-9).map(([k]) => k);
  const lime = keysIn(14.0, 14.4), lemon = keysIn(14.7, 14.9);
  await call('api/admin/state', { method: 'PUT', key: ADMIN_KEY, body: { settings: {
    title: '第3回 もぐらたたきカップ（デモ）', round: '', phase: 'closed', entryOpen: true, format: 'main',
    notice: 'これはデモです。入力した内容はこのブラウザの中にだけ保存され、本番には送られません。',
    divDefaults: {
      lime: { cap: 13.9, kadai: pickRandom(lime), kadai2: pickRandom(lime) },
      lemon: { cap: 14.9, kadai: pickRandom(lemon), kadai2: pickRandom(lemon) },
    },
  } } });
  for (const s of SEED) {
    const { token } = await call('api/auth/register', { method: 'POST', body: { username: s.u, pin: PIN } });
    await call('api/entry', { method: 'POST', key: token, body: {
      entryName: s.name, xId: s.x, rating: s.rating, frate: s.frate,
      answers: { discord: s.d, divisions: s.divs, plates: s.plates, lime: s.lime, lemon: s.lemon },
    } });
  }
}

// ---------- デモ用の操作バー ----------
const PHASES = [['closed', '組み合わせ発表前'], ['select', '自選曲の提出'], ['ban', 'BAN'], ['pick', '自選曲の決定'], ['done', '対戦曲確定']];
const isAdmin = /admin\.html/.test(location.pathname);
const go = (page) => { location.href = page + '?demo=1'; };

async function switchUser(username) {
  try { localStorage.removeItem(TOKEN); } catch {}
  if (username) {
    const { token } = await call('api/auth/login', { method: 'POST', body: { username, pin: PIN } });
    try { localStorage.setItem(TOKEN, token); } catch {}
  }
  go('index.html');
}

// 自分以外の参加者の提出を、いまの段階に合わせて自動で埋める
async function autoFill() {
  const st = await call('api/admin/state', { key: ADMIN_KEY });
  const c = await loadConsts();
  let me = null;
  try { const t = localStorage.getItem(TOKEN); if (t) me = (await call('api/me', { key: t })).entry; } catch {}
  const { entries } = await call('api/admin/entries', { key: ADMIN_KEY });
  const myId = me ? entries.find((e) => e.x_id === me.xId)?.id : null;
  const row = (m, id) => st.picks.find((p) => p.match_id === m.id && p.entry_id === id) || { songs: [], ban: -1, pick: -1 };
  const items = [];
  for (const m of st.matches) {
    for (const [self, opp] of [[m.a, m.b], [m.b, m.a]]) {
      if (self == null || self === myId) continue;
      const mine = row(m, self), theirs = row(m, opp);
      if (st.settings.phase === 'select' && mine.songs.length < 3) {
        const pool = Object.entries(c).filter(([k, v]) => v <= Number(m.cap) + 1e-9 && v >= Number(m.cap) - 1.0 && k !== m.kadai && k !== m.kadai2).map(([k]) => k);
        const songs = new Set();
        while (songs.size < 3 && pool.length) songs.add(pickRandom(pool));
        items.push({ match_id: m.id, entry_id: self, songs: [...songs] });
      }
      if (st.settings.phase === 'ban' && mine.ban < 0 && theirs.songs.length === 3) items.push({ match_id: m.id, entry_id: self, ban: Math.floor(Math.random() * 3) });
      if (st.settings.phase === 'pick' && mine.pick < 0 && mine.songs.length === 3 && theirs.ban >= 0) {
        items.push({ match_id: m.id, entry_id: self, pick: pickRandom([0, 1, 2].filter((i) => i !== theirs.ban)) });
      }
    }
  }
  if (items.length) await call('api/admin/picks', { method: 'PUT', key: ADMIN_KEY, body: { items } });
  return items.length;
}

async function nextPhase() {
  const st = await call('api/admin/state', { key: ADMIN_KEY });
  if (!st.matches.length && st.settings.phase === 'closed') throw new Error('先に運営ページで組み合わせを作って保存してください');
  const i = PHASES.findIndex(([k]) => k === st.settings.phase);
  const next = PHASES[Math.min(i + 1, PHASES.length - 1)][0];
  await call('api/admin/state', { method: 'PUT', key: ADMIN_KEY, body: { settings: { phase: next } } });
  return PHASES.find(([k]) => k === next)[1];
}

function bar(users, phaseLabel) {
  const css = document.createElement('style');
  css.textContent = `
    #demoBar{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#1f2d3d;color:#fff;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));
      display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;box-shadow:0 -4px 16px rgba(31,45,61,.18)}
    #demoBar b{font-family:var(--f-display);font-size:14px;background:#f0b429;color:#1f2d3d;border-radius:999px;padding:2px 10px}
    #demoBar select,#demoBar button{font:inherit;font-size:13px;border-radius:6px;padding:5px 10px;width:auto}
    #demoBar select{background:#fff;color:#1f2d3d;border:0}
    #demoBar button{background:#2f4a66;color:#fff;border:1px solid #4a6a8c;cursor:pointer}
    #demoBar button.on{background:#2a6fb8;border-color:#2a6fb8}
    #demoBar .msg{color:#cfe3f7;min-height:0}
    #demoBar .grp{display:flex;flex-wrap:wrap;gap:6px;align-items:center}`;
  document.head.append(css);
  const el = document.createElement('div');
  el.id = 'demoBar';
  el.innerHTML = `<b>デモ</b>
    <div class="grp"><button type="button" class="${isAdmin ? 'on' : ''}" data-act="admin">運営ページ</button>
      <label class="grp" style="color:#fff">参加者として見る
        <select id="demoUser"><option value="">（ログアウトして見る）</option>${users.map((u) => `<option value="${u.username}">${u.label}</option>`).join('')}</select></label></div>
    <div class="grp"><span>いまの段階：<span id="demoPhase">${phaseLabel}</span></span>
      <button type="button" data-act="next">次の段階へ</button>
      <button type="button" data-act="auto">ほかの参加者の提出を自動で埋める</button>
      <button type="button" data-act="reset">最初からやり直す</button></div>
    <span class="msg" id="demoMsg"></span>`;
  document.body.append(el);
  // バーの高さぶん、ページの下に余白をとる（狭い画面ではバーが折り返して高くなるため）
  const pad = () => { document.body.style.paddingBottom = el.offsetHeight + 24 + 'px'; };
  pad(); try { new ResizeObserver(pad).observe(el); } catch {}
  const msg = (t) => { el.querySelector('#demoMsg').textContent = t; };
  const sel = el.querySelector('#demoUser');
  if (!isAdmin) sel.value = currentUser();
  sel.onchange = () => switchUser(sel.value).catch((e) => msg(e.message));
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    try {
      if (b.dataset.act === 'admin') return go('admin.html');
      if (b.dataset.act === 'next') { const l = await nextPhase(); msg(`段階を「${l}」にしました`); setTimeout(() => location.reload(), 500); }
      if (b.dataset.act === 'auto') { const n = await autoFill(); msg(n ? `${n} 件を自動で入力しました` : 'いまの段階で自動で埋めるものはありません'); if (n) setTimeout(() => location.reload(), 600); }
      if (b.dataset.act === 'reset') {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'もう一度押すとリセット'; setTimeout(() => { delete b.dataset.armed; b.textContent = '最初からやり直す'; }, 4000); return; }
        try { localStorage.removeItem(STORE); localStorage.removeItem(TOKEN); } catch {}
        location.reload();
      }
    } catch (er) { msg(er.message); }
  });
}

// いまログインしている参加者（このブラウザに保存したデモ用のセッションから）
function currentUser() {
  try {
    const t = localStorage.getItem(TOKEN);
    if (!t) return '';
    return window.__demoUser || '';
  } catch { return ''; }
}

(async () => {
  if (fresh) {
    try { await seed(); data.demoVersion = DEMO_VERSION; } catch (e) { console.error(e); }
    save();
  }
  window.__demoResolve(handle);
  // バーに出すユーザー一覧と、いまの段階
  const { entries } = await call('api/admin/entries', { key: ADMIN_KEY });
  const st = await call('api/admin/state', { key: ADMIN_KEY });
  try {
    const t = localStorage.getItem(TOKEN);
    if (t) window.__demoUser = (await call('api/me', { key: t })).user.username;
  } catch {}
  // 切り替えられるのは最初から入っているデモ用の参加者（PIN 0000）だけ
  const seedNames = SEED.map((s) => s.u);
  const users = entries.filter((e) => seedNames.includes(e.username)).map((e) => ({ username: e.username, label: `${e.entry_name}（${(e.answers.divisions || []).map((d) => (d === 'lime' ? 'らいむ' : 'れもん')).join('・')}）` }));
  const label = PHASES.find(([k]) => k === st.settings.phase)?.[1] || st.settings.phase;
  const mount = () => bar(users, label);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
