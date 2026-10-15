// もぐらたたきカップ 運営ページ
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY_STORE = window.MOGU_DEMO ? 'mogucupdx-demo-admin-key' : 'mogucupdx-admin-key'; // デモは本番と別に保存

let KEY = '';
let entries = [];      // [{ id, entry_name, x_id, rating, frate, memo, created_at }]
let settings = null;   // 大会設定
// 画面の中では、試合ごとに両者の選曲もまとめて持つ
// aBan：A の自選曲のうち（B に）BAN された番号、aPick：A が決めた自選曲の番号
let matches = [];      // [{ id, a, b, cap, kadai, aSongs:[key×3], bSongs, aBan, aPick, bBan, bPick, edited }]
let charts = null;     // { list, byKey }
let dirty = false;

function setMsg(t, cls = '') { const m = $('#msg'); m.textContent = t; m.className = 'msg ' + cls; }
function markDirty() { dirty = true; $('#dirty').hidden = false; }
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// 2回押しで確定するボタン
function confirmTwice(btn, text, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = text;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
}

// ---------- ログイン ----------
try { KEY = localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE) || ''; } catch {}
$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  KEY = $('#key').value.trim();
  if (!KEY) return setMsg('鍵を入力してください', 'err');
  await start(true);
});
$('#logout').onclick = () => {
  try { localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE); } catch {}
  location.reload();
};

async function start(fromForm) {
  setMsg('読み込んでいます…');
  try {
    const [e, st] = await Promise.all([api('api/admin/entries', { key: KEY }), api('api/admin/state', { key: KEY })]);
    entries = e.entries; settings = st.settings; matches = buildMatches(st.matches, st.picks);
    if (fromForm) {
      try {
        const store = $('#remember').checked ? localStorage : sessionStorage;
        store.setItem(KEY_STORE, KEY);
      } catch {}
    }
    $('#login').hidden = true; $('#app').hidden = false; $('#savebar').hidden = false;
    dirty = false; $('#dirty').hidden = true;
    setMsg('');
    renderAll();
    loadCharts().then((c) => { charts = c; renderAll(); }).catch(() => setMsg('譜面データを読み込めませんでした。ページを再読み込みしてください', 'err'));
  } catch (err) {
    if (err.status === 401) { KEY = ''; try { localStorage.removeItem(KEY_STORE); sessionStorage.removeItem(KEY_STORE); } catch {} }
    $('#login').hidden = false;
    setMsg(err.message, 'err');
  }
}
$('#reload').onclick = () => {
  if (!dirty) return start(false);
  confirmTwice($('#reload'), '未保存の変更を捨てて再読み込み', () => start(false));
};

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function buildMatches(ms, picks) {
  const row = (mid, eid) => picks.find((p) => p.match_id === mid && p.entry_id === eid) || { songs: [], ban: -1, pick: -1 };
  return (ms || []).map((m) => {
    const pa = row(m.id, m.a), pb = row(m.id, m.b);
    return {
      id: m.id || newId(), div: m.div || DIVISIONS[0].id, a: m.a ?? null, b: m.b ?? null, cap: m.cap ?? 14, kadai: m.kadai || '', kadai2: m.kadai2 || '', lv14: !!m.lv14,
      aSongs: [0, 1, 2].map((i) => pa.songs[i] || ''), bSongs: [0, 1, 2].map((i) => pb.songs[i] || ''),
      aBan: pb.ban, bBan: pa.ban, aPick: pa.pick, bPick: pb.pick, edited: false,
    };
  });
}

$('#saveState').onclick = async () => {
  readSettingsForm();
  const btn = $('#saveState'); btn.disabled = true;
  try {
    const plain = matches.map(({ id, div, a, b, cap, kadai, kadai2, lv14 }) => ({ id, div, a, b, cap, kadai, kadai2, lv14 }));
    // 運営が直した試合の選曲だけ送る（参加者がその後に提出した内容を上書きしないため）
    const items = [];
    matches.filter((m) => m.edited).forEach((m) => {
      if (m.a != null) items.push({ match_id: m.id, entry_id: m.a, songs: m.aSongs, pick: m.aPick, ban: m.bBan });
      if (m.b != null) items.push({ match_id: m.id, entry_id: m.b, songs: m.bSongs, pick: m.bPick, ban: m.aBan });
    });
    await api('api/admin/state', { method: 'PUT', key: KEY, body: { settings, matches: plain } });
    if (items.length) await api('api/admin/picks', { method: 'PUT', key: KEY, body: { items } });
    matches.forEach((m) => (m.edited = false));
    dirty = false; $('#dirty').hidden = true;
    setMsg('保存しました', 'ok');
  } catch (e) { setMsg(e.message, 'err'); }
  btn.disabled = false;
};

// ---------- タブ ----------
let tab = 'entries';
$$('[role=tab]').forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab;
  $$('[role=tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  if (tab === 'images') renderImage();
}));

function renderAll() {
  renderEntries();
  renderSettingsForm();
  renderMatches();
  if (tab === 'images') renderImage();
}

// ---------- 参加者 ----------
let sortKey = 'id', sortDir = 1, editing = null, entryDiv = 'all';
const A = (e) => e.answers || {};
const inDiv = (e, div) => (A(e).divisions || []).includes(div);
// 列：[キー, 見出し, 並べ替えに使う値, 表示, 数値列か]
const COLS = [
  ['id', 'No.', (e) => e.id, (e) => e.id, 1],
  ['entry_name', '名前', (e) => e.entry_name, (e) => esc(e.entry_name)],
  ['x_id', 'X', (e) => e.x_id.toLowerCase(), (e) => `<a href="https://x.com/${encodeURIComponent(e.x_id)}" target="_blank" rel="noopener">@${esc(e.x_id)}</a>`],
  ['discord', 'Discord', (e) => A(e).discord || '', (e) => esc(A(e).discord || '-')],
  ['div', '部門', (e) => (A(e).divisions || []).join(), (e) => (A(e).divisions || []).map((d) => divPill(d, true)).join(' ') || '-'],
  ['username', 'ユーザー', (e) => e.username || '', (e) => userCell(e)],
  ['rating', 'レート', (e) => e.rating, (e) => e.rating, 1],
  ['frate', '2fRATE', (e) => e.frate, (e) => Number(e.frate).toFixed(3), 1],
  ['plates', '神', (e) => (A(e).plates || []).length, (e) => { const p = A(e).plates || []; return p.length ? `<span title="${esc(p.map((x) => x + '神').join(' '))}">${p.length}（${esc(p.join(''))}）</span>` : '-'; }, 1],
  ['m5', 'MAS☆5', (e) => A(e).lime?.m5 ?? -1, (e) => A(e).lime?.m5 ?? '-', 1],
  ['r5', 'ReM☆5', (e) => A(e).lime?.r5 ?? -1, (e) => A(e).lime?.r5 ?? '-', 1],
  ['s6', '☆6計', (e) => A(e).lime?.s6 ?? -1, (e) => A(e).lime?.s6 ?? '-', 1],
  ['lv14', 'Lv14希望', (e) => (A(e).lime ? (A(e).lime.lv14 ? 1 : 0) : -1), (e) => (A(e).lime ? (A(e).lime.lv14 ? 'はい' : 'いいえ') : '-')],
  ['ap14', 'AP14', (e) => A(e).lemon?.ap14 ?? -1, (e) => A(e).lemon?.ap14 ?? '-', 1],
  ['ap14p', 'AP14+', (e) => A(e).lemon?.ap14p ?? -1, (e) => A(e).lemon?.ap14p ?? '-', 1],
  ['created_at', '申請日時', (e) => e.created_at, (e) => esc(fmtTime(e.created_at))],
  ['memo', 'メモ', (e) => e.memo, (e) => esc(e.memo)],
];
const entryById = (id) => entries.find((e) => e.id === id);
const fmtTime = (s) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(+d) ? s : d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const userCell = (e) => (e.username ? `${esc(e.username)}${e.source === '2frate' ? ' <span class="note">2fRATE</span>' : ''}` : '<span class="note">-</span>');
function renderEntries() {
  const shown = entries.filter((e) => entryDiv === 'all' || inDiv(e, entryDiv));
  $('#entryCount').textContent = `（${shown.length}人${entryDiv === 'all' ? '' : '／全' + entries.length + '人'}）`;
  $('#entryDiv').innerHTML = `<option value="all">すべての部門</option>` + DIVISIONS.map((d) => `<option value="${d.id}"${entryDiv === d.id ? ' selected' : ''}>${d.name}（${entries.filter((e) => inDiv(e, d.id)).length}人）</option>`).join('');
  const col = COLS.find((c) => c[0] === sortKey) || COLS[0];
  const rows = shown.sort((x, y) => {
    const a = col[2](x), b = col[2](y);
    return (typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'ja')) * sortDir;
  });
  const head = '<tr>' + COLS.map(([k, t, , , n]) => `<th class="${n ? 'num' : ''}"><button type="button" data-sort="${k}">${t}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('') + '<th></th></tr>';
  const body = rows.map((e) => {
    if (editing === e.id) {
      const cells = {
        entry_name: `<input id="ed-name" value="${esc(e.entry_name)}" maxlength="20">`,
        x_id: `<input id="ed-x" value="${esc(e.x_id)}" maxlength="15">`,
        discord: `<input id="ed-discord" value="${esc(A(e).discord || '')}" maxlength="40">`,
        div: DIVISIONS.map((d) => `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" class="ed-div" value="${d.id}"${inDiv(e, d.id) ? ' checked' : ''}>${divPill(d.id, true)}</label>`).join(''),
        rating: `<input id="ed-rating" type="number" value="${e.rating}" style="width:7em">`,
        frate: `<input id="ed-frate" type="number" step="0.001" value="${e.frate}" style="width:7em">`,
        memo: `<input id="ed-memo" value="${esc(e.memo)}" maxlength="200">`,
      };
      return `<tr data-id="${e.id}">${COLS.map(([k, , , show, n]) => `<td class="${n ? 'num' : ''}">${cells[k] ?? show(e)}</td>`).join('')}
        <td><div class="btns"><button type="button" class="primary" data-act="save">保存</button><button type="button" class="ghost" data-act="cancel">やめる</button></div></td></tr>`;
    }
    return `<tr data-id="${e.id}">${COLS.map(([, , , show, n]) => `<td class="${n ? 'num' : ''}">${show(e)}</td>`).join('')}
      <td><div class="btns"><button type="button" data-act="edit">編集</button>${e.source === 'local' ? '<button type="button" data-act="pin">仮PIN</button>' : ''}<button type="button" class="danger" data-act="del">削除</button></div></td></tr>`;
  }).join('');
  $('#entryTable').innerHTML = `<thead>${head}</thead><tbody>${body || `<tr><td colspan="${COLS.length + 1}" class="note">まだ申請はありません</td></tr>`}</tbody>`;
}
$('#entryDiv').onchange = (e) => { entryDiv = e.target.value; renderEntries(); };

$('#entryTable').addEventListener('click', async (ev) => {
  const s = ev.target.closest('[data-sort]');
  if (s) { const k = s.dataset.sort; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; return renderEntries(); }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const id = +b.closest('tr').dataset.id, act = b.dataset.act;
  if (act === 'edit') { editing = id; return renderEntries(); }
  if (act === 'cancel') { editing = null; return renderEntries(); }
  if (act === 'save') {
    const body = {
      entryName: $('#ed-name').value, xId: $('#ed-x').value, rating: Number($('#ed-rating').value), frate: Number($('#ed-frate').value), memo: $('#ed-memo').value,
      discord: $('#ed-discord').value, divisions: $$('.ed-div:checked').map((x) => x.value),
    };
    try {
      await api('api/admin/entries/' + id, { method: 'PUT', key: KEY, body });
      const e = entryById(id);
      Object.assign(e, { entry_name: body.entryName.trim(), x_id: body.xId.trim().replace(/^@/, ''), rating: body.rating, frate: body.frate, memo: body.memo });
      e.answers = { ...A(e), discord: body.discord.trim(), divisions: body.divisions };
      editing = null; renderEntries(); renderMatches(); setMsg('参加者を更新しました', 'ok');
    } catch (er) { setMsg(er.message, 'err'); }
    return;
  }
  if (act === 'pin') {
    const e = entryById(id);
    confirmTwice(b, '押すと今のPINが使えなくなります', async () => {
      try {
        const r = await api('api/admin/reset-pin', { method: 'POST', key: KEY, body: { username: e.username } });
        setMsg(`@${r.username} の仮PIN：${r.pin}（本人にだけ伝えてください。この表示は再読み込みで消えます）`, 'ok');
      } catch (er) { setMsg(er.message, 'err'); }
    });
    return;
  }
  if (act === 'del') {
    confirmTwice(b, 'もう一度押すと削除', async () => {
      try {
        await api('api/admin/entries/' + id, { method: 'DELETE', key: KEY });
        entries = entries.filter((e) => e.id !== id);
        renderEntries(); renderMatches(); setMsg('参加者を削除しました', 'ok');
      } catch (er) { setMsg(er.message, 'err'); }
    });
  }
});

$('#csv').onclick = () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['No.', 'スコアタで使用する名前', 'X', 'Discord', '部門', 'ユーザー', 'レート', '2fRATE', '神プレート',
    '【らいむ】MASTER星5', '【らいむ】Re:MASTER星5', '【らいむ】星6合計', '【らいむ】Lv14希望', '【れもん】Lv14 AP', '【れもん】Lv14+ AP', '申請日時', 'メモ'];
  const rows = entries.filter((e) => entryDiv === 'all' || inDiv(e, entryDiv)).map((e) => {
    const a = A(e);
    return [e.id, e.entry_name, '@' + e.x_id, a.discord, (a.divisions || []).map(divName).join('・'), e.username || '', e.rating, e.frate,
      (a.plates || []).map((p) => p + '神').join(' '), a.lime?.m5, a.lime?.r5, a.lime?.s6, a.lime ? (a.lime.lv14 ? 'はい' : 'いいえ') : '',
      a.lemon?.ap14, a.lemon?.ap14p, fmtTime(e.created_at), e.memo];
  });
  const lines = [head, ...rows].map((r) => r.map(q).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `mogucup_entries${entryDiv === 'all' ? '' : '_' + entryDiv}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- 譜面検索 ----------
// cap：この定数以下だけ候補に出す（null なら制限なし）。lv14：上限を超える Lv14 も候補に出す
const okFor = (c, cap, lv14) => cap == null || selectable(c, cap, lv14);
function chosenHTML(key, cap, lv14) {
  if (!key) return '';
  if (!charts) return esc(key);
  const ch = charts.byKey.get(key);
  if (!ch) return `<span class="over">譜面データにない譜面です：${esc(key)}</span>`;
  const bad = !okFor(ch.c, cap, lv14);
  const lvx = !bad && cap != null && overCap(ch.c, cap);
  return `<span class="${bad ? 'over' : ''}"><span class="d" style="color:${DIFF_COLOR[ch.diff]}">${ch.diff}</span> ${ch.kind} Lv.${ch.lv}（${fmtConst(ch.c)}）${bad ? '　上限を超えています' : ''}${lvx ? '　Lv14 解禁枠' : ''}${ch.img ? '' : '　ジャケットなし'}</span>`;
}

function makePicker({ id, value, onChange, cap = null, lv14 = false, placeholder }) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  const cur = value && charts?.byKey.get(value);
  wrap.innerHTML = `<input type="text" id="${id}" autocomplete="off" placeholder="${placeholder || '曲名で検索'}" value="${esc(cur ? cur.name : value || '')}" aria-autocomplete="list">
    <div class="list" hidden role="listbox"></div><div class="chosen">${chosenHTML(value, cap, lv14)}</div>`;
  const input = wrap.querySelector('input'), list = wrap.querySelector('.list');
  let hits = [], on = -1;
  const show = () => {
    if (!charts) { list.innerHTML = '<div class="empty">譜面データを読み込み中です</div>'; list.hidden = false; return; }
    const q = norm(input.value);
    const t = input.value.trim();
    const num = /^\d+(\.\d)?\+?$/.test(t) ? t : null;
    hits = charts.list.filter((c) => okFor(c.c, cap, lv14) &&
      (num ? (num.endsWith('+') || !num.includes('.') ? c.lv === num : fmtConst(c.c) === num) : !q || norm(c.name).includes(q))).slice(0, 50);
    on = hits.length ? 0 : -1;
    list.innerHTML = hits.length
      ? hits.map((c, i) => `<button type="button" role="option" data-i="${i}" class="${i === on ? 'on' : ''}"><span>${esc(c.name)}</span><span class="meta"><span style="color:${DIFF_COLOR[c.diff]}">${DIFF_SHORT[c.diff]}</span> ${c.kind} ${fmtConst(c.c)}</span></button>`).join('')
      : `<div class="empty">見つかりません${cap != null ? `（定数 ${fmtConst(Number(cap))} 以下${lv14 ? 'と Lv14' : ''}だけを表示しています）` : ''}</div>`;
    list.hidden = false;
  };
  const choose = (c) => { list.hidden = true; input.value = c ? c.name : ''; onChange(c ? c.key : ''); };
  input.addEventListener('focus', show);
  input.addEventListener('input', () => { show(); if (!input.value) onChange(''); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!hits.length) return;
      on = (on + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      $$('button', list).forEach((b, i) => b.classList.toggle('on', i === on));
      $$('button', list)[on].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); if (on >= 0) choose(hits[on]); }
    else if (e.key === 'Escape') list.hidden = true;
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) choose(hits[+b.dataset.i]); });
  input.addEventListener('blur', () => { list.hidden = true; const c = value && charts?.byKey.get(value); if (c && input.value !== c.name && input.value) input.value = c.name; });
  return wrap;
}

// ---------- 大会設定 ----------
const isMini = () => settings?.format === 'mini';
const PHASE_LABEL = { closed: '組み合わせ発表前（参加者に対戦カードを見せない）', select: '自選曲の提出', ban: 'BAN', pick: '自選曲の決定', done: '対戦曲確定' };
const defOf = (div) => settings.divDefaults?.[div] || { cap: 14, kadai: '', kadai2: '' };
function renderSettingsForm() {
  const s = settings;
  $('#sTitle').value = s.title; $('#sOpen').checked = !!s.entryOpen;
  $('#sDeadline').value = s.entryDeadline || ''; $('#sNotice').value = s.notice || '';
  $('#sPhase').innerHTML = Object.entries(PHASE_LABEL).map(([k, v]) => `<option value="${k}"${k === s.phase ? ' selected' : ''}>${v}</option>`).join('');
  $('#sPhaseNote').value = s.phaseNote || '';
  $('#nPair').value = s.notes.pair; $('#nReveal').value = s.notes.reveal; $('#nFinal').value = s.notes.final;
  $('#sFormat').value = s.format || 'main';
  const box = $('#divDefaults');
  box.replaceChildren();
  DIVISIONS.forEach((d) => {
    const dd = defOf(d.id);
    const sec = document.createElement('div');
    sec.className = 'divdef';
    sec.innerHTML = `<h3>${divPill(d.id)}</h3><div class="row" style="align-items:start">
      <label>自選曲の上限（譜面定数）<input type="number" step="0.1" min="1" max="15" id="dd-${d.id}-cap" data-dd="${d.id}" value="${dd.cap}"></label>
      <div${isMini() ? ' hidden' : ''}><label for="dd-${d.id}-k1">運営課題曲</label><div class="k1"></div></div>
      <div${isMini() ? ' hidden' : ''}><label for="dd-${d.id}-k2">運営課題曲2（同じ曲になったとき用）</label><div class="k2"></div></div></div>`;
    $('.k1', sec).append(makePicker({ id: `dd-${d.id}-k1`, value: dd.kadai, placeholder: '課題曲を曲名で検索', onChange: (k) => { defOf(d.id).kadai = k; markDirty(); renderSettingsForm(); } }));
    $('.k2', sec).append(makePicker({ id: `dd-${d.id}-k2`, value: dd.kadai2, placeholder: '課題曲2を曲名で検索', onChange: (k) => { defOf(d.id).kadai2 = k; markDirty(); renderSettingsForm(); } }));
    box.append(sec);
  });
}
function readSettingsForm() {
  if (!settings) return;
  Object.assign(settings, {
    title: $('#sTitle').value.trim(), round: '', entryOpen: $('#sOpen').checked,
    entryDeadline: $('#sDeadline').value, notice: $('#sNotice').value.trim(),
    phase: $('#sPhase').value || settings.phase, phaseNote: $('#sPhaseNote').value.trim(),
    format: $('#sFormat').value || 'main',
  });
  settings.divDefaults = settings.divDefaults || {};
  DIVISIONS.forEach((d) => {
    const inp = $(`#dd-${d.id}-cap`);
    settings.divDefaults[d.id] = { ...defOf(d.id), ...(inp ? { cap: Number(inp.value) || 15 } : {}) };
  });
  settings.notes = { pair: $('#nPair').value, reveal: $('#nReveal').value, final: $('#nFinal').value };
}
$('[data-pane=settings]').addEventListener('input', (e) => {
  if (e.target.closest('.picker')) return;
  readSettingsForm(); markDirty();
});
$('[data-pane=settings]').addEventListener('change', (e) => {
  if (e.target.id === 'sFormat') { readSettingsForm(); markDirty(); renderSettingsForm(); renderMatches(); return; }
  if (e.target.id === 'sPhase') { readSettingsForm(); markDirty(); setMsg('段階を変えました。「設定と組み合わせを保存」を押すと参加者のページに反映されます', 'ok'); }
});

// ---------- 組み合わせ・選曲（部門ごと） ----------
let curDiv = DIVISIONS[0].id;
const nameOf = (id, fb) => entryById(id)?.entry_name || fb;
const divEntries = (div) => entries.filter((e) => inDiv(e, div));
const divMatches = (div = curDiv) => matches.filter((m) => m.div === div);
// らいむ部門で両者が Q11（Lv14）に「はい」と答えていれば、Lv14 を解禁する
const wantsLv14 = (id) => !!entryById(id)?.answers?.lime?.lv14;
const autoLv14 = (div, a, b) => div === 'lime' && a != null && b != null && wantsLv14(a) && wantsLv14(b);
const emptyMatch = (div, a = null, b = null) => {
  const dd = defOf(div);
  return { id: newId(), div, a, b, cap: dd.cap ?? 14, kadai: dd.kadai || '', kadai2: dd.kadai2 || '', lv14: autoLv14(div, a, b), aSongs: ['', '', ''], bSongs: ['', '', ''], aBan: -1, aPick: -1, bBan: -1, bPick: -1, edited: false };
};

function divTabs(el, onPick) {
  el.innerHTML = DIVISIONS.map((d) => `<button type="button" data-div="${d.id}" aria-selected="${d.id === curDiv}">${divPill(d.id)} ${divMatches(d.id).length}試合</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-div]'); if (!b) return; curDiv = b.dataset.div; onPick(); };
}

function entryOptions(sel) {
  const list = divEntries(curDiv);
  const extra = sel != null && !list.some((e) => e.id === sel) ? [entryById(sel)].filter(Boolean) : [];
  return '<option value="">（未設定）</option>' + [...list, ...extra].map((e) => `<option value="${e.id}"${e.id === sel ? ' selected' : ''}>${esc(e.entry_name)}（2fRATE ${Number(e.frate).toFixed(3)}${curDiv === 'lime' && e.answers?.lime ? '・Lv14 ' + (e.answers.lime.lv14 ? '希望' : '希望しない') : ''}）</option>`).join('');
}

function submitState(m, sd) {
  const done = m[sd + 'Songs'].filter(Boolean).length;
  const opp = sd === 'a' ? 'b' : 'a';
  return `提出 ${done}/3・BAN ${m[opp + 'Ban'] >= 0 ? '済' : '未'}・決定 ${m[sd + 'Pick'] >= 0 ? '済' : '未'}`;
}

function renderMatches() {
  divTabs($('#matchDiv'), () => { renderMatches(); });
  const list = $('#matchList');
  list.replaceChildren();
  const shown = divMatches();
  shown.forEach((m, no) => {
    const mi = matches.indexOf(m);
    const art = document.createElement('article');
    art.className = 'match';
    art.innerHTML = `<header><b>MATCH ${String(no + 1).padStart(2, '0')}</b>
      <div class="btns"><button type="button" class="danger" data-del="${mi}">この対戦カードを削除</button></div></header>
      <div class="row" style="align-items:start"><div style="display:grid;gap:6px"><label>自選曲の上限（譜面定数）<input type="number" step="0.1" min="1" max="15" id="m${mi}cap" data-m="${mi}" data-f="cap" value="${m.cap}"></label>
        <label style="display:flex;gap:6px;align-items:center;color:var(--fg)"><input type="checkbox" id="m${mi}lv14" data-m="${mi}" data-f="lv14"${m.lv14 ? ' checked' : ''}>Lv14 解禁（上限を超えるレベル14を1曲まで）</label></div>
      <div${isMini() ? ' hidden' : ''}><label for="m${mi}kadai">運営課題曲</label><div class="kadai"></div></div>
      <div${isMini() ? ' hidden' : ''}><label for="m${mi}kadai2">運営課題曲2（両者が同じ曲を自選曲にしたときだけ使う）</label><div class="kadai2"></div></div></div>
      <div class="sides"></div><p class="warn" hidden></p>`;
    $('.kadai', art).append(makePicker({ id: `m${mi}kadai`, value: m.kadai, placeholder: '課題曲を曲名で検索',
      onChange: (k) => { m.kadai = k; markDirty(); renderMatches(); } }));
    $('.kadai2', art).append(makePicker({ id: `m${mi}kadai2`, value: m.kadai2, placeholder: '課題曲2を曲名で検索',
      onChange: (k) => { m.kadai2 = k; markDirty(); renderMatches(); } }));
    const sides = $('.sides', art);
    ['a', 'b'].forEach((sd) => {
      const opp = sd === 'a' ? 'b' : 'a';
      const div = document.createElement('div');
      div.className = 'side';
      div.innerHTML = `<label>${sd === 'a' ? 'プレイヤーA' : 'プレイヤーB'}<select id="m${mi}${sd}p" data-m="${mi}" data-sd="${sd}">${entryOptions(m[sd])}</select></label>
        <span class="note">${submitState(m, sd)}</span>`;
      m[sd + 'Songs'].forEach((key, i) => {
        const slot = document.createElement('div');
        slot.className = 'slot' + (m[sd + 'Ban'] === i ? ' ban' : '') + (m[sd + 'Pick'] === i ? ' pick' : '');
        slot.innerHTML = `<span class="n">${i + 1}</span>`;
        slot.append(makePicker({ id: `m${mi}${sd}s${i}`, value: key, cap: m.cap, lv14: m.lv14, placeholder: `自選曲${i + 1}を曲名・定数で検索`,
          onChange: (k) => { m[sd + 'Songs'][i] = k; m.edited = true; markDirty(); renderMatches(); } }));
        div.append(slot);
      });
      const radios = (f, title) => `<div class="radios"><span>${title}</span>${[0, 1, 2].map((i) =>
        `<label><input type="radio" name="m${mi}${sd}${f}" data-m="${mi}" data-f="${sd}${f}" value="${i}"${m[sd + f] === i ? ' checked' : ''}${f === 'Pick' && m[sd + 'Ban'] === i ? ' disabled' : ''}>${i + 1}</label>`).join('')}
        <label><input type="radio" name="m${mi}${sd}${f}" data-m="${mi}" data-f="${sd}${f}" value="-1"${m[sd + f] === -1 ? ' checked' : ''}>未定</label></div>`;
      div.insertAdjacentHTML('beforeend', radios('Ban', esc(nameOf(m[opp], '相手')) + ' がBAN') + radios('Pick', '自選曲に決定'));
      sides.append(div);
    });
    const w = matchWarnings(m);
    if (w.length) { const p = $('.warn', art); p.hidden = false; p.textContent = w.join(' / '); }
    list.append(art);
  });
  if (!shown.length) list.innerHTML = `<p class="note">${divName(curDiv)}の対戦カードはまだありません。上のボタンでペアを作るか、対戦カードを追加してください。</p>`;
  const used = shown.flatMap((m) => [m.a, m.b]).filter((x) => x != null);
  const dupIds = [...new Set(used.filter((x, i) => used.indexOf(x) !== i))];
  const unpaired = divEntries(curDiv).filter((e) => !used.includes(e.id));
  const wrongDiv = [...new Set(used)].filter((id) => entryById(id) && !inDiv(entryById(id), curDiv));
  const msgs = [];
  if (dupIds.length) msgs.push('複数の対戦カードに入っている人：' + dupIds.map((id) => nameOf(id, '?')).join('、'));
  if (wrongDiv.length) msgs.push(`${divName(curDiv)}に申請していない人：` + wrongDiv.map((id) => nameOf(id, '?')).join('、'));
  if (unpaired.length && shown.length) msgs.push('対戦カードに入っていない人：' + unpaired.map((e) => e.entry_name).join('、'));
  $('#pairWarn').hidden = !msgs.length; $('#pairWarn').textContent = msgs.join(' / ');
}

function matchWarnings(m) {
  const w = [];
  if (m.a != null && m.a === m.b) w.push('同じ人どうしの対戦になっています');
  const pa = m.aPick >= 0 ? m.aSongs[m.aPick] : '', pb = m.bPick >= 0 ? m.bSongs[m.bPick] : '';
  if (pa && pa === pb) w.push(isMini() ? '両者が同じ曲を自選曲にしました（対戦曲は1曲）' : '両者が同じ曲を自選曲にしました。運営課題曲2を使います');
  if (m.div === 'lime' && m.a != null && m.b != null && m.lv14 !== autoLv14(m.div, m.a, m.b)) {
    w.push(m.lv14 ? 'Lv14 を解禁していますが、両者とも希望しているわけではありません' : '両者とも Lv14 を希望していますが、解禁していません');
  }
  if (!isMini()) {
    if (!m.kadai) w.push('運営課題曲が未設定です');
    if (!m.kadai2) w.push('運営課題曲2が未設定です（両者が同じ曲を選んだときに必要）');
    if (m.kadai && m.kadai === m.kadai2) w.push('運営課題曲と運営課題曲2が同じです');
  }
  ['a', 'b'].forEach((sd) => {
    const name = nameOf(m[sd], sd === 'a' ? 'プレイヤーA' : 'プレイヤーB');
    const ks = m[sd + 'Songs'].filter(Boolean);
    const cs = charts ? ks.map((k) => charts.byKey.get(k)).filter(Boolean) : [];
    if (new Set(ks).size !== ks.length) w.push(`${name} の自選曲に同じ譜面があります`);
    if (cs.some((c) => !selectable(c.c, m.cap, m.lv14))) w.push(`${name} の自選曲に上限を超える譜面があります`);
    if (cs.filter((c) => overCap(c.c, m.cap)).length > 1 && m.lv14) w.push(`${name} の自選曲に上限を超えるレベル14が2曲以上あります`);
    if (!isMini() && m.kadai && ks.includes(m.kadai)) w.push(`${name} の自選曲が運営課題曲と同じです`);
    if (!isMini() && m.kadai2 && ks.includes(m.kadai2)) w.push(`${name} の自選曲が運営課題曲2と同じです`);
  });
  return w;
}

$('#matchList').addEventListener('change', (e) => {
  const t = e.target, mi = t.dataset.m;
  if (mi === undefined) return;
  const m = matches[+mi];
  if (t.tagName === 'SELECT') { m[t.dataset.sd] = t.value ? +t.value : null; m.lv14 = autoLv14(m.div, m.a, m.b); }
  else if (t.dataset.f === 'cap') m.cap = Number(t.value) || m.cap;
  else if (t.dataset.f === 'lv14') m.lv14 = t.checked;
  else if (t.type === 'radio') {
    const f = t.dataset.f, v = +t.value;
    m[f] = v; m.edited = true;
    if (f.endsWith('Ban') && m[f[0] + 'Pick'] === v && v !== -1) m[f[0] + 'Pick'] = -1;
  }
  markDirty(); renderMatches();
});
$('#matchList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  confirmTwice(b, 'もう一度押すと削除', () => { matches.splice(+b.dataset.del, 1); markDirty(); renderMatches(); });
});
$('#addMatch').onclick = () => { matches.push(emptyMatch(curDiv)); markDirty(); renderMatches(); };
$('#applyDefaults').onclick = () => {
  readSettingsForm();
  confirmTwice($('#applyDefaults'), `もう一度押すと${divName(curDiv)}の全試合を上書き`, () => {
    const dd = defOf(curDiv);
    divMatches().forEach((m) => { m.cap = dd.cap; m.kadai = dd.kadai || ''; m.kadai2 = dd.kadai2 || ''; });
    markDirty(); renderMatches(); setMsg(`${divName(curDiv)}の全試合の上限と課題曲を、既定値にしました`, 'ok');
  });
};

function makePairs(order) {
  const ms = [];
  for (let i = 0; i < order.length; i += 2) ms.push(emptyMatch(curDiv, order[i].id, order[i + 1]?.id ?? null));
  matches = [...matches.filter((m) => m.div !== curDiv), ...ms]; markDirty(); renderMatches();
  const lv = ms.filter((m) => m.lv14).length;
  setMsg(`${divName(curDiv)}：${ms.length} 試合の対戦カードを作りました${lv ? `（うち ${lv} 試合は両者の希望で Lv14 解禁）` : ''}${order.length % 2 ? '（奇数のため最後の1人は相手が未設定です）' : ''}`, 'ok');
}
const pairAction = (btn, fn) => () => (divMatches().length ? confirmTwice(btn, `もう一度押すと${divName(curDiv)}を作り直す`, fn) : fn());
$('#pairFrate').onclick = pairAction($('#pairFrate'), () => makePairs(divEntries(curDiv).sort((x, y) => y.frate - x.frate)));
$('#pairRandom').onclick = pairAction($('#pairRandom'), () => {
  const a = divEntries(curDiv);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  makePairs(a);
});

// ---------- 告知画像（部門ごと・両部門） ----------
let kind = 'pair';
let imgDivSel = null;   // 'lime' | 'lemon' | 'both'（null のときは組み合わせタブの部門）
let imgSel = '';        // 'all'（全試合）または '部門:番号'
const imgDivs = () => (imgDivSel === 'both' ? DIVISIONS.map((d) => d.id) : [imgDivSel || curDiv]);
function viewModel(div = curDiv) {
  readSettingsForm();
  const ch = (k) => (k && charts?.byKey.get(k)) || null;
  return {
    title: settings.title, badge: divName(div), badgeColor: DIV_COLOR[div], notes: settings.notes,
    matches: divMatches(div).map((m) => ({
      aName: nameOf(m.a, 'プレイヤーA'), bName: nameOf(m.b, 'プレイヤーB'),
      aSongs: m.aSongs.map(ch), bSongs: m.bSongs.map(ch), cap: m.cap, lv14: m.lv14,
      finals: finalSongs({
        format: settings.format, kadai: m.kadai, kadai2: m.kadai2, aName: nameOf(m.a, 'プレイヤーA'), bName: nameOf(m.b, 'プレイヤーB'),
        aKey: m.aPick >= 0 ? m.aSongs[m.aPick] : '', bKey: m.bPick >= 0 ? m.bSongs[m.bPick] : '',
      }).map((f) => ({ ...f, s: ch(f.key) })),
      aBan: m.aBan, aPick: m.aPick, bBan: m.bBan, bPick: m.bPick,
    })),
  };
}
// いま表示する画像の一覧：[{ div, idx }]
function imgTargets() {
  const divs = imgDivs();
  if (kind === 'pair') return divs.map((div) => ({ div, idx: 0 }));
  if (imgSel === 'all') return divs.flatMap((div) => divMatches(div).map((_, idx) => ({ div, idx })));
  const [div, i] = imgSel.split(':');
  return divs.includes(div) && divMatches(div)[+i] ? [{ div, idx: +i }] : [];
}
function imgDivTabs() {
  const el = $('#imgDiv');
  const sel = imgDivSel || curDiv;
  el.innerHTML = DIVISIONS.map((d) => `<button type="button" data-div="${d.id}" aria-selected="${d.id === sel}">${divPill(d.id)} ${divMatches(d.id).length}試合</button>`).join('')
    + `<button type="button" data-div="both" aria-selected="${sel === 'both'}">両部門 ${matches.length}試合</button>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-div]'); if (!b) return;
    imgDivSel = b.dataset.div;
    if (imgDivSel !== 'both') { curDiv = imgDivSel; renderMatches(); }
    imgSel = imgSel === 'all' ? 'all' : '';
    renderImage();
  };
}
let renderSeq = 0;
async function renderImage() {
  imgDivTabs();
  const per = kind !== 'pair';
  const divs = imgDivs();
  $('#imgMatchWrap').hidden = !per;
  // ジャケットを使う画像は、ここでは保存させずブックマークで作ってもらう
  $('#dlOne').hidden = per;
  // 対象の試合：全試合／各試合（両部門のときは部門名つき）
  const opts = divs.flatMap((div) => divMatches(div).map((m, i) => ({ v: `${div}:${i}`, t: `${divs.length > 1 ? divName(div).replace('部門', '') + '　' : ''}MATCH ${String(i + 1).padStart(2, '0')}　${nameOf(m.a, 'A')} vs ${nameOf(m.b, 'B')}` })));
  if (imgSel !== 'all' && !opts.some((o) => o.v === imgSel)) imgSel = opts[0]?.v || 'all';
  $('#imgMatch').innerHTML = `<option value="all"${imgSel === 'all' ? ' selected' : ''}>全試合（${opts.length}試合）</option>`
    + opts.map((o) => `<option value="${o.v}"${o.v === imgSel ? ' selected' : ''}>${esc(o.t)}</option>`).join('');
  const seq = ++renderSeq;
  const box = $('#previews');
  const targets = imgTargets();
  box.innerHTML = targets.length ? '' : '<p class="note">対戦カードがありません</p>';
  for (const t of targets) {
    const holder = document.createElement('div');
    holder.className = 'canvasbox';
    box.appendChild(holder);
    const cv = document.createElement('canvas');
    if (!per) {
      // 組み合わせ発表はジャケットを使わないので画像にして表示する（長押し・右クリックで保存できる）
      await DrawKit.render(cv, viewModel(t.div), kind, t.idx);
      if (seq !== renderSeq) return;
      const img = document.createElement('img');
      img.alt = `${divName(t.div)} 組み合わせ発表`;
      img.src = cv.toDataURL('image/png');
      holder.appendChild(img);
    } else {
      // 選曲公開・対戦曲は表示用に描く（ジャケットは公式から表示用に読む。この画面からは保存できない）
      await DrawKit.render(cv, viewModel(t.div), kind, t.idx, { preview: true });
      if (seq !== renderSeq) return;
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', `${divName(t.div)} MATCH ${t.idx + 1} のプレビュー`);
      holder.appendChild(cv);
    }
  }
  $('#imgNote').textContent = per ? 'プレビューです。ジャケット入りの画像の保存はブックマークで行います' : '画像を長押し（パソコンは右クリック）でも保存できます';
}

// 告知画像用ブックマーク：maimaidx.jp の上で bookmark-image.js を読み込む
const BM_BASE = new URL('.', location.href.split('?')[0]).href;
const BM_CODE = `javascript:(()=>{const s=document.createElement('script');s.charset='utf-8';s.src='${BM_BASE}bookmark-image.js?'+Date.now();document.body.appendChild(s)})()`;
$('#bmLink').href = BM_CODE;
$('#bmLink').onclick = (e) => { e.preventDefault(); setMsg('このボタンはブックマークバーへドラッグして登録してください', 'ok'); };
$('#bmCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(BM_CODE); setMsg('ブックマーク用のコードをコピーしました', 'ok'); }
  catch { prompt('このコードをコピーしてください', BM_CODE); }
};
$('#copyData').onclick = async () => {
  const base = safe(settings.title || 'mogucup');
  const divs = imgDivs();
  const data = JSON.stringify({ app: 'mogucup-image', v: 2, sets: divs.map((div) => ({ div, file: `${base}_${safe(divName(div))}`, view: viewModel(div) })) });
  const label = divs.length > 1 ? '両部門' : divName(divs[0]);
  try { await navigator.clipboard.writeText(data); setMsg(`${label}の画像用データをコピーしました。maimaidx.jp でブックマークを押して貼り付けてください`, 'ok'); }
  catch { setMsg('コピーできませんでした。ブラウザのクリップボードの許可を確認してください', 'err'); }
};
$('#kindTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]'); if (!b) return;
  kind = b.dataset.kind;
  $$('#kindTabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
  renderImage();
});
$('#imgMatch').onchange = (e) => { imgSel = e.target.value; renderImage(); };

const KIND_NAME = { pair: '組み合わせ', reveal: '選曲公開', final: '対戦曲' };
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]/g, '_');
const fileName = (div, k, i) => `${safe(settings.title || 'mogucup')}_${safe(divName(div))}_${KIND_NAME[k]}${k === 'pair' ? '' : '_M' + String(i + 1).padStart(2, '0')}.png`;
async function download(div, k, i) {
  await DrawKit.render($('#cv'), viewModel(div), k, i);
  const blob = await new Promise((r) => $('#cv').toBlob(r, 'image/png'));
  if (!blob) throw new Error('画像を書き出せませんでした');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileName(div, k, i); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// 表示中の組み合わせ発表をすべて保存（両部門なら2枚）
$('#dlOne').onclick = async () => {
  const ts = imgTargets();
  try {
    for (const t of ts) { await download(t.div, kind, t.idx); await new Promise((r) => setTimeout(r, 300)); }
    setMsg(`${ts.length} 枚保存しました`, 'ok');
  } catch (e) { setMsg(e.message, 'err'); }
};

if (KEY) start(false);
