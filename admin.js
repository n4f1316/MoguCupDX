// もぐらたたきカップ 運営ページ
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY_STORE = 'mogucupdx-admin-key';

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
      id: m.id || newId(), a: m.a ?? null, b: m.b ?? null, cap: m.cap ?? settings.defaultCap, kadai: m.kadai || '', kadai2: m.kadai2 || '',
      aSongs: [0, 1, 2].map((i) => pa.songs[i] || ''), bSongs: [0, 1, 2].map((i) => pb.songs[i] || ''),
      aBan: pb.ban, bBan: pa.ban, aPick: pa.pick, bPick: pb.pick, edited: false,
    };
  });
}

$('#saveState').onclick = async () => {
  readSettingsForm();
  const btn = $('#saveState'); btn.disabled = true;
  try {
    const plain = matches.map(({ id, a, b, cap, kadai, kadai2 }) => ({ id, a, b, cap, kadai, kadai2 }));
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
let sortKey = 'id', sortDir = 1, editing = null;
const COLS = [
  ['id', 'No.', 'num'], ['entry_name', 'エントリー名'], ['x_id', 'X'], ['username', 'ユーザー'], ['rating', 'レート', 'num'],
  ['frate', '2fRATE', 'num'], ['created_at', '申請日時'], ['memo', 'メモ'],
];
const entryById = (id) => entries.find((e) => e.id === id);
const fmtTime = (s) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(+d) ? s : d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const userCell = (e) => (e.username ? `${esc(e.username)}${e.source === '2frate' ? ' <span class="note">2fRATE</span>' : ''}` : '<span class="note">-</span>');
function renderEntries() {
  $('#entryCount').textContent = `（${entries.length}人）`;
  const rows = [...entries].sort((x, y) => {
    const a = x[sortKey], b = y[sortKey];
    return (typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'ja')) * sortDir;
  });
  const head = '<tr>' + COLS.map(([k, t, c]) => `<th class="${c || ''}"><button type="button" data-sort="${k}">${t}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('') + '<th></th></tr>';
  const body = rows.map((e) => {
    if (editing === e.id) {
      return `<tr data-id="${e.id}"><td class="num">${e.id}</td>
        <td><input id="ed-name" value="${esc(e.entry_name)}" maxlength="20"></td>
        <td><input id="ed-x" value="${esc(e.x_id)}" maxlength="15"></td>
        <td>${userCell(e)}</td>
        <td><input id="ed-rating" type="number" value="${e.rating}" style="width:7em"></td>
        <td><input id="ed-frate" type="number" step="0.001" value="${e.frate}" style="width:7em"></td>
        <td>${esc(fmtTime(e.created_at))}</td>
        <td><input id="ed-memo" value="${esc(e.memo)}" maxlength="200"></td>
        <td><div class="btns"><button type="button" class="primary" data-act="save">保存</button><button type="button" class="ghost" data-act="cancel">やめる</button></div></td></tr>`;
    }
    return `<tr data-id="${e.id}"><td class="num">${e.id}</td><td>${esc(e.entry_name)}</td>
      <td><a href="https://x.com/${encodeURIComponent(e.x_id)}" target="_blank" rel="noopener">@${esc(e.x_id)}</a></td>
      <td>${userCell(e)}</td>
      <td class="num">${e.rating}</td><td class="num">${Number(e.frate).toFixed(3)}</td>
      <td>${esc(fmtTime(e.created_at))}</td><td>${esc(e.memo)}</td>
      <td><div class="btns"><button type="button" data-act="edit">編集</button>${e.source === 'local' ? '<button type="button" data-act="pin">仮PIN</button>' : ''}<button type="button" class="danger" data-act="del">削除</button></div></td></tr>`;
  }).join('');
  $('#entryTable').innerHTML = `<thead>${head}</thead><tbody>${body || '<tr><td colspan="9" class="note">まだ申請はありません</td></tr>'}</tbody>`;
}

$('#entryTable').addEventListener('click', async (ev) => {
  const s = ev.target.closest('[data-sort]');
  if (s) { const k = s.dataset.sort; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; return renderEntries(); }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const id = +b.closest('tr').dataset.id, act = b.dataset.act;
  if (act === 'edit') { editing = id; return renderEntries(); }
  if (act === 'cancel') { editing = null; return renderEntries(); }
  if (act === 'save') {
    const body = { entryName: $('#ed-name').value, xId: $('#ed-x').value, rating: Number($('#ed-rating').value), frate: Number($('#ed-frate').value), memo: $('#ed-memo').value };
    try {
      await api('api/admin/entries/' + id, { method: 'PUT', key: KEY, body });
      Object.assign(entryById(id), { entry_name: body.entryName.trim(), x_id: body.xId.trim().replace(/^@/, ''), rating: body.rating, frate: body.frate, memo: body.memo });
      editing = null; renderEntries(); renderMatches(); setMsg('参加者を更新しました', 'ok');
    } catch (e) { setMsg(e.message, 'err'); }
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
      } catch (e) { setMsg(e.message, 'err'); }
    });
  }
});

$('#csv').onclick = () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['No.', 'エントリー名', 'X', 'ユーザー', 'レート', '2fRATE', '申請日時', 'メモ'].map(q).join(',')]
    .concat(entries.map((e) => [e.id, e.entry_name, '@' + e.x_id, e.username || '', e.rating, e.frate, fmtTime(e.created_at), e.memo].map(q).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mogucup_entries.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- 譜面検索 ----------
const under = (c, cap) => cap == null || c <= Number(cap) + 1e-9;
function chosenHTML(key, cap) {
  if (!key) return '';
  if (!charts) return esc(key);
  const ch = charts.byKey.get(key);
  if (!ch) return `<span class="over">譜面データにない譜面です：${esc(key)}</span>`;
  const over = !under(ch.c, cap);
  return `<span class="${over ? 'over' : ''}"><span class="d" style="color:${DIFF_COLOR[ch.diff]}">${ch.diff}</span> ${ch.kind} Lv.${ch.lv}（${fmtConst(ch.c)}）${over ? '　上限を超えています' : ''}${ch.img ? '' : '　ジャケットなし'}</span>`;
}

// value：譜面キー、onChange(key)、cap：この定数以下だけ候補に出す（null なら制限なし）
function makePicker({ id, value, onChange, cap = null, placeholder }) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  const cur = value && charts?.byKey.get(value);
  wrap.innerHTML = `<input type="text" id="${id}" autocomplete="off" placeholder="${placeholder || '曲名で検索'}" value="${esc(cur ? cur.name : value || '')}" aria-autocomplete="list">
    <div class="list" hidden role="listbox"></div><div class="chosen">${chosenHTML(value, cap)}</div>`;
  const input = wrap.querySelector('input'), list = wrap.querySelector('.list');
  let hits = [], on = -1;
  const show = () => {
    if (!charts) { list.innerHTML = '<div class="empty">譜面データを読み込み中です</div>'; list.hidden = false; return; }
    const q = norm(input.value);
    const t = input.value.trim();
    const num = /^\d+(\.\d)?\+?$/.test(t) ? t : null;
    hits = charts.list.filter((c) => under(c.c, cap) &&
      (num ? (num.endsWith('+') || !num.includes('.') ? c.lv === num : fmtConst(c.c) === num) : !q || norm(c.name).includes(q))).slice(0, 50);
    on = hits.length ? 0 : -1;
    list.innerHTML = hits.length
      ? hits.map((c, i) => `<button type="button" role="option" data-i="${i}" class="${i === on ? 'on' : ''}"><span>${esc(c.name)}</span><span class="meta"><span style="color:${DIFF_COLOR[c.diff]}">${DIFF_SHORT[c.diff]}</span> ${c.kind} ${fmtConst(c.c)}</span></button>`).join('')
      : `<div class="empty">見つかりません${cap != null ? `（定数 ${fmtConst(Number(cap))} 以下だけを表示しています）` : ''}</div>`;
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
function renderSettingsForm() {
  const s = settings;
  $('#sTitle').value = s.title; $('#sRound').value = s.round; $('#sOpen').checked = !!s.entryOpen;
  $('#sDeadline').value = s.entryDeadline || ''; $('#sNotice').value = s.notice || '';
  $('#sPhase').innerHTML = Object.entries(PHASE_LABEL).map(([k, v]) => `<option value="${k}"${k === s.phase ? ' selected' : ''}>${v}</option>`).join('');
  $('#sPhaseNote').value = s.phaseNote || '';
  $('#sDefCap').value = s.defaultCap ?? 14;
  $('#nPair').value = s.notes.pair; $('#nReveal').value = s.notes.reveal; $('#nFinal').value = s.notes.final;
  $('#sFormat').value = s.format || 'main';
  $$('.mainOnly').forEach((x) => (x.hidden = isMini()));
  $('#defKadai2Picker').replaceChildren(makePicker({ id: 'defKadai2', value: s.defaultKadai2 || '', placeholder: '課題曲2を曲名で検索',
    onChange: (k) => { settings.defaultKadai2 = k; markDirty(); renderSettingsForm(); } }));
  $('#defKadaiPicker').replaceChildren(makePicker({ id: 'defKadai', value: s.defaultKadai || '', placeholder: '課題曲を曲名で検索',
    onChange: (k) => { settings.defaultKadai = k; markDirty(); renderSettingsForm(); } }));
}
function readSettingsForm() {
  if (!settings) return;
  Object.assign(settings, {
    title: $('#sTitle').value.trim(), round: $('#sRound').value.trim(), entryOpen: $('#sOpen').checked,
    entryDeadline: $('#sDeadline').value, notice: $('#sNotice').value.trim(),
    phase: $('#sPhase').value || settings.phase, phaseNote: $('#sPhaseNote').value.trim(),
    defaultCap: Number($('#sDefCap').value) || 15,
    format: $('#sFormat').value || 'main',
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

// ---------- 組み合わせ・選曲 ----------
const nameOf = (id, fb) => entryById(id)?.entry_name || fb;
const emptyMatch = (a = null, b = null) => ({ id: newId(), a, b, cap: settings.defaultCap ?? 14, kadai: settings.defaultKadai || '', kadai2: settings.defaultKadai2 || '', aSongs: ['', '', ''], bSongs: ['', '', ''], aBan: -1, aPick: -1, bBan: -1, bPick: -1, edited: false });

function entryOptions(sel) {
  return '<option value="">（未設定）</option>' + entries.map((e) => `<option value="${e.id}"${e.id === sel ? ' selected' : ''}>${esc(e.entry_name)}（2fRATE ${Number(e.frate).toFixed(3)}）</option>`).join('');
}

function submitState(m, sd) {
  const done = m[sd + 'Songs'].filter(Boolean).length;
  const opp = sd === 'a' ? 'b' : 'a';
  return `提出 ${done}/3・BAN ${m[opp + 'Ban'] >= 0 ? '済' : '未'}・決定 ${m[sd + 'Pick'] >= 0 ? '済' : '未'}`;
}

function renderMatches() {
  const list = $('#matchList');
  list.replaceChildren();
  matches.forEach((m, mi) => {
    const art = document.createElement('article');
    art.className = 'match';
    art.innerHTML = `<header><b>MATCH ${String(mi + 1).padStart(2, '0')}</b>
      <div class="btns"><button type="button" class="danger" data-del="${mi}">この対戦カードを削除</button></div></header>
      <div class="row" style="align-items:start"><label>自選曲の上限（譜面定数）<input type="number" step="0.1" min="1" max="15" id="m${mi}cap" data-m="${mi}" data-f="cap" value="${m.cap}"></label>
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
        slot.append(makePicker({ id: `m${mi}${sd}s${i}`, value: key, cap: m.cap, placeholder: `自選曲${i + 1}を曲名・定数で検索`,
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
  if (!matches.length) list.innerHTML = '<p class="note">対戦カードはまだありません。上のボタンでペアを作るか、対戦カードを追加してください。</p>';
  const used = matches.flatMap((m) => [m.a, m.b]).filter((x) => x != null);
  const dupIds = [...new Set(used.filter((x, i) => used.indexOf(x) !== i))];
  const unpaired = entries.filter((e) => !used.includes(e.id));
  const msgs = [];
  if (dupIds.length) msgs.push('複数の対戦カードに入っている人：' + dupIds.map((id) => nameOf(id, '?')).join('、'));
  if (unpaired.length && matches.length) msgs.push('対戦カードに入っていない人：' + unpaired.map((e) => e.entry_name).join('、'));
  $('#pairWarn').hidden = !msgs.length; $('#pairWarn').textContent = msgs.join(' / ');
}

function matchWarnings(m) {
  const w = [];
  if (m.a != null && m.a === m.b) w.push('同じ人どうしの対戦になっています');
  const pa = m.aPick >= 0 ? m.aSongs[m.aPick] : '', pb = m.bPick >= 0 ? m.bSongs[m.bPick] : '';
  if (pa && pa === pb) w.push(isMini() ? '両者が同じ曲を自選曲にしました（対戦曲は1曲）' : '両者が同じ曲を自選曲にしました。運営課題曲2を使います');
  if (!isMini()) {
    if (!m.kadai) w.push('運営課題曲が未設定です');
    if (!m.kadai2) w.push('運営課題曲2が未設定です（両者が同じ曲を選んだときに必要）');
    if (m.kadai && m.kadai === m.kadai2) w.push('運営課題曲と運営課題曲2が同じです');
  }
  ['a', 'b'].forEach((sd) => {
    const name = nameOf(m[sd], sd === 'a' ? 'プレイヤーA' : 'プレイヤーB');
    const ks = m[sd + 'Songs'].filter(Boolean);
    if (new Set(ks).size !== ks.length) w.push(`${name} の自選曲に同じ譜面があります`);
    if (charts && ks.some((k) => { const c = charts.byKey.get(k); return c && !under(c.c, m.cap); })) w.push(`${name} の自選曲に上限を超える譜面があります`);
    if (!isMini() && m.kadai && ks.includes(m.kadai)) w.push(`${name} の自選曲が運営課題曲と同じです`);
    if (!isMini() && m.kadai2 && ks.includes(m.kadai2)) w.push(`${name} の自選曲が運営課題曲2と同じです`);
  });
  return w;
}

$('#matchList').addEventListener('change', (e) => {
  const t = e.target, mi = t.dataset.m;
  if (mi === undefined) return;
  const m = matches[+mi];
  if (t.tagName === 'SELECT') m[t.dataset.sd] = t.value ? +t.value : null;
  else if (t.dataset.f === 'cap') m.cap = Number(t.value) || m.cap;
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
$('#addMatch').onclick = () => { matches.push(emptyMatch()); markDirty(); renderMatches(); };
$('#applyDefaults').onclick = () => {
  readSettingsForm();
  confirmTwice($('#applyDefaults'), 'もう一度押すと全試合を上書き', () => {
    matches.forEach((m) => { m.cap = settings.defaultCap; m.kadai = settings.defaultKadai || ''; m.kadai2 = settings.defaultKadai2 || ''; });
    markDirty(); renderMatches(); setMsg('全試合の上限と課題曲を、大会設定の既定値にしました', 'ok');
  });
};

function makePairs(order) {
  const ms = [];
  for (let i = 0; i < order.length; i += 2) ms.push(emptyMatch(order[i].id, order[i + 1]?.id ?? null));
  matches = ms; markDirty(); renderMatches();
  setMsg(`${ms.length} 試合の対戦カードを作りました${order.length % 2 ? '（奇数のため最後の1人は相手が未設定です）' : ''}`, 'ok');
}
const pairAction = (btn, fn) => () => (matches.length ? confirmTwice(btn, 'もう一度押すと作り直す', fn) : fn());
$('#pairFrate').onclick = pairAction($('#pairFrate'), () => makePairs([...entries].sort((x, y) => y.frate - x.frate)));
$('#pairRandom').onclick = pairAction($('#pairRandom'), () => {
  const a = [...entries];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  makePairs(a);
});

// ---------- 告知画像 ----------
let kind = 'pair', imgIdx = 0;
function viewModel() {
  readSettingsForm();
  const ch = (k) => (k && charts?.byKey.get(k)) || null;
  return {
    title: settings.title, round: settings.round, notes: settings.notes,
    matches: matches.map((m) => ({
      aName: nameOf(m.a, 'プレイヤーA'), bName: nameOf(m.b, 'プレイヤーB'),
      aSongs: m.aSongs.map(ch), bSongs: m.bSongs.map(ch), cap: m.cap,
      finals: finalSongs({
        format: settings.format, kadai: m.kadai, kadai2: m.kadai2, aName: nameOf(m.a, 'プレイヤーA'), bName: nameOf(m.b, 'プレイヤーB'),
        aKey: m.aPick >= 0 ? m.aSongs[m.aPick] : '', bKey: m.bPick >= 0 ? m.bSongs[m.bPick] : '',
      }).map((f) => ({ ...f, s: ch(f.key) })),
      aBan: m.aBan, aPick: m.aPick, bBan: m.bBan, bPick: m.bPick,
    })),
  };
}
let renderSeq = 0;
async function renderImage() {
  const per = kind !== 'pair';
  $('#imgMatchWrap').hidden = !per;
  $('#dlAll').hidden = !per || matches.length < 2;
  imgIdx = Math.min(imgIdx, Math.max(0, matches.length - 1));
  $('#imgMatch').innerHTML = matches.map((m, i) => `<option value="${i}"${i === imgIdx ? ' selected' : ''}>MATCH ${String(i + 1).padStart(2, '0')}　${esc(nameOf(m.a, 'A'))} vs ${esc(nameOf(m.b, 'B'))}</option>`).join('');
  const seq = ++renderSeq;
  await DrawKit.render($('#cv'), viewModel(), kind, imgIdx);
  if (seq !== renderSeq) return;
  try {
    $('#out').src = $('#cv').toDataURL('image/png');
    $('#imgNote').textContent = '';
  } catch {
    $('#imgNote').textContent = 'ジャケット画像の読み込みに問題があり、画像を書き出せませんでした';
  }
}
$('#kindTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]'); if (!b) return;
  kind = b.dataset.kind;
  $$('#kindTabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
  renderImage();
});
$('#imgMatch').onchange = (e) => { imgIdx = +e.target.value; renderImage(); };

const KIND_NAME = { pair: '組み合わせ', reveal: '選曲公開', final: '対戦曲' };
const fileName = (k, i) => `${(settings.round || 'mogucup').replace(/[\\/:*?"<>|\s]/g, '_')}_${KIND_NAME[k]}${k === 'pair' ? '' : '_M' + String(i + 1).padStart(2, '0')}.png`;
async function download(k, i) {
  await DrawKit.render($('#cv'), viewModel(), k, i);
  const blob = await new Promise((r) => $('#cv').toBlob(r, 'image/png'));
  if (!blob) throw new Error('画像を書き出せませんでした');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileName(k, i); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#dlOne').onclick = async () => { try { await download(kind, imgIdx); } catch (e) { setMsg(e.message, 'err'); } renderImage(); };
$('#dlAll').onclick = async () => {
  try {
    for (let i = 0; i < matches.length; i++) { await download(kind, i); await new Promise((r) => setTimeout(r, 300)); }
    setMsg(`${matches.length} 枚保存しました`, 'ok');
  } catch (e) { setMsg(e.message, 'err'); }
  renderImage();
};

if (KEY) start(false);
