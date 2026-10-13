// もぐらたたきカップ 参加者ページ
const $ = (s, r = document) => r.querySelector(s);
const TOKEN_STORE = 'mogucupdx-session';
const PHASE_LABEL = { closed: '組み合わせ発表前', select: '自選曲の提出', ban: 'BAN', pick: '自選曲の決定', done: '対戦曲確定' };
const PAGE_SIZE = 50;

let token = '';
try { token = localStorage.getItem(TOKEN_STORE) || ''; } catch {}
let ME = null;        // /api/me の結果
let charts = null;    // { list, byKey }
let draft = [];       // 提出前の自選曲（譜面キー）
let choice = -1;      // BAN・決定で選んでいる番号
const browse = { q: '', level: 'all', diffs: new Set(DIFF_ORDER), page: 1 };

function setMsg(t, cls = '') { const m = $('#msg'); m.textContent = t; m.className = 'msg ' + cls; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function saveToken(t) { token = t; try { t ? localStorage.setItem(TOKEN_STORE, t) : localStorage.removeItem(TOKEN_STORE); } catch {} }

// ---------- お知らせ ----------
function fmtDeadline(s) {
  if (!s) return '期限なし';
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-');
  return `${+y}年${+m}月${+dd}日 ${t || ''}（日本時間）`;
}
function renderInfo(s, count) {
  $('#title').textContent = s.title;
  document.title = s.title;
  $('#fOpen').textContent = (s.entryOpen ? '受付中' : '受付終了') + (count !== undefined ? `（${count}人）` : '');
  $('#fDeadline').textContent = fmtDeadline(s.entryDeadline);
  $('#fPhase').textContent = PHASE_LABEL[s.phase] || s.phase;
  $('#fPhaseNote').textContent = s.phaseNote || '';
  $('#notice').hidden = !s.notice; $('#notice').textContent = s.notice || '';
}

// ---------- ログイン ----------
let authMode = 'login';
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
  authMode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  $('#authSubmit').textContent = authMode === 'login' ? 'ログイン' : '登録する';
  $('#authNote').textContent = authMode === 'login'
    ? '2fRATE のランキングに登録している人は、2fRATE のユーザー名と PIN でそのままログインできます。'
    : 'ユーザー名と PIN を決めて登録します。PIN を忘れると運営に再発行してもらう必要があります。2fRATE のユーザー名で登録すると、2fRATE と連携します。';
  $('#pin').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}));
$('#auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#username').value.trim().toLowerCase(), pin = $('#pin').value.trim();
  if (!/^[a-z0-9_]{3,16}$/.test(username)) return setMsg('ユーザー名は英数字と _ で3〜16文字にしてください', 'err');
  if (!/^\d{4,8}$/.test(pin)) return setMsg('PIN は数字4〜8桁にしてください', 'err');
  $('#authSubmit').disabled = true;
  setMsg(authMode === 'login' ? 'ログインしています…' : '登録しています…');
  try {
    const r = await api('api/auth/' + authMode, { method: 'POST', body: { username, pin } });
    saveToken(r.token);
    $('#pin').value = '';
    setMsg(r.linked2f && authMode === 'register' ? '2fRATE のユーザーとして連携しました' : 'ログインしました', 'ok');
    await refresh();
  } catch (err) { setMsg(err.message, 'err'); }
  $('#authSubmit').disabled = false;
});
$('#logout').onclick = async () => {
  try { await api('api/auth/logout', { method: 'POST', key: token }); } catch {}
  saveToken(''); ME = null; setMsg('ログアウトしました', 'ok'); refresh();
};

// ---------- 参加申請 ----------
$('#entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = { entryName: $('#entryName').value.trim(), xId: $('#xId').value.trim().replace(/^@/, ''), rating: Number($('#rating').value), frate: Number($('#frate').value), website: $('#website').value };
  if (!v.entryName) return setMsg('エントリー名を入力してください', 'err');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(v.xId)) return setMsg('X の ID は英数字と _ の15文字以内で入力してください', 'err');
  if ($('#rating').value === '' || !Number.isInteger(v.rating)) return setMsg('maimai のレートを整数で入力してください', 'err');
  if ($('#frate').value === '' || !Number.isFinite(v.frate)) return setMsg('2fRATE を入力してください', 'err');
  if (v.website) return;
  const btn = $('#entryForm button[type=submit]'); btn.disabled = true;
  try {
    await api('api/entry', { method: 'POST', key: token, body: v });
    setMsg('参加申請を受け付けました', 'ok');
    await refresh();
  } catch (err) { setMsg(err.message, 'err'); }
  btn.disabled = false;
});

// ---------- 読み込み ----------
async function refresh() {
  if (!token) {
    try { const p = await api('api/public'); renderInfo(p.settings, p.entryCount); } catch (e) { setMsg(e.message, 'err'); }
    $('#auth').hidden = false;
    ['#userbar', '#entryForm', '#entryDone', '#matchBox'].forEach((s) => ($(s).hidden = true));
    return;
  }
  try {
    ME = await api('api/me', { key: token });
  } catch (e) {
    if (e.status === 401) { saveToken(''); setMsg(e.message, 'err'); return refresh(); }
    return setMsg(e.message, 'err');
  }
  renderInfo(ME.settings);
  $('#auth').hidden = true;
  $('#userbar').hidden = false;
  $('#uName').textContent = '@' + ME.user.username;
  $('#uLinked').hidden = !ME.user.linked2f;
  const en = ME.entry;
  $('#entryForm').hidden = !!en || !ME.settings.entryOpen;
  $('#entryDone').hidden = !en;
  if (!en && !ME.settings.entryOpen) setMsg('参加申請の受付は終了しています', 'err');
  if (en) {
    $('#entryFacts').innerHTML = `<dt>エントリー名</dt><dd>${esc(en.entryName)}</dd><dt>X</dt><dd>@${esc(en.xId)}</dd>
      <dt>レート</dt><dd class="num">${en.rating}</dd><dt>2fRATE</dt><dd class="num">${Number(en.frate).toFixed(3)}</dd>`;
  }
  const m = ME.match;
  if (m) {
    draft = m.mySongs.slice();
    choice = ME.settings.phase === 'ban' ? m.myBan : ME.settings.phase === 'pick' ? m.myPick : -1;
    if (!charts) {
      $('#matchBox').hidden = false;
      $('#matchBox').textContent = '楽曲データを読み込み中…';
      try { charts = await loadCharts(); } catch { $('#matchBox').textContent = '楽曲データを読み込めませんでした。ページを再読み込みしてください'; return; }
    }
  }
  renderMatch();
}

// ---------- 譜面の表示 ----------
const diffCls = (d) => 'd-' + d.replace(':', '').toUpperCase();
function chipsOf(c) {
  const box = el('div', 'chips');
  box.append(el('span', `chip k-${c.kind}`, c.kind), el('span', `chip ${diffCls(c.diff)}`, c.diff), el('span', 'chip c', fmtConst(c.c)), el('span', 'chip lv', 'Lv' + c.lv));
  return box;
}
function songEl(key, right) {
  const c = charts?.byKey.get(key);
  const row = el('div', 'song');
  const info = el('div');
  info.append(el('div', 'sname', c ? c.name : key || '（未定）'));
  if (c) info.append(chipsOf(c));
  row.append(jacketEl(c?.img), info, right || el('span'));
  return row;
}

// ---------- 自分の試合 ----------
function renderMatch() {
  const box = $('#matchBox');
  const m = ME?.match;
  const phase = ME?.settings.phase;
  if (!m) {
    box.hidden = !(ME?.entry && phase !== 'closed');
    box.innerHTML = '<h2>あなたの試合</h2><p class="note">対戦カードはまだ決まっていません。</p>';
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  box.append(el('h2', '', `MATCH ${String(m.no).padStart(2, '0')}`));
  const vs = el('div', 'vs');
  vs.append(el('div', 'nm', ME.entry.entryName), el('div', 'v', 'VS'), el('div', 'nm', m.opponent ? m.opponent.entryName : '（相手未定）'));
  box.append(vs);
  const facts = el('dl', 'facts');
  facts.innerHTML = `<dt>自選曲の上限</dt><dd>譜面定数 <b>${fmtConst(Number(m.cap))}</b> 以下</dd>${m.opponent ? `<dt>相手の X</dt><dd><a href="https://x.com/${encodeURIComponent(m.opponent.xId)}" target="_blank" rel="noopener">@${esc(m.opponent.xId)}</a></dd>` : ''}`;
  box.append(facts);
  if (m.kadai) { box.append(el('div', 'slotno', '運営課題曲')); box.append(songEl(m.kadai)); }

  if (phase === 'select') renderSelect(box, m);
  else if (phase === 'ban') renderBan(box, m);
  else if (phase === 'pick') renderPick(box, m);
  else if (phase === 'done') renderDone(box, m);
}

function submitBtn(label, enabled, fn) {
  const b = el('button', 'primary', label);
  b.type = 'button'; b.disabled = !enabled;
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); setMsg('送信しました', 'ok'); await refresh(); } catch (e) { setMsg(e.message, 'err'); b.disabled = false; }
  };
  const w = el('div', 'btns'); w.append(b); return w;
}

// 段階：自選曲の提出
function renderSelect(box, m) {
  const submitted = m.mySongs.length === 3;
  const same = submitted && draft.length === 3 && draft.every((k, i) => k === m.mySongs[i]);
  box.append(el('h2', '', '自選曲を3曲選ぶ'));
  box.append(el('p', 'note', submitted
    ? (same ? '提出済みです。期間中は選び直して提出し直せます。' : '変更があります。「提出する」を押すと提出し直します。')
    : '下の一覧から3曲選んで「提出する」を押してください。'));
  const slots = el('div', 'slots');
  for (let i = 0; i < 3; i++) {
    const k = draft[i];
    const s = el('div', 'slot' + (k ? ' filled' : ''));
    if (k) {
      const rm = el('button', 'ghost', '外す'); rm.type = 'button';
      rm.onclick = () => { draft.splice(i, 1); renderMatch(); };
      s.append(songEl(k, rm));
    } else s.append(el('span', 'empty', `自選曲${i + 1}：未選択`));
    slots.append(s);
  }
  box.append(slots);
  box.append(submitBtn(submitted ? '提出し直す' : '提出する', draft.length === 3 && !same, () => api('api/me/songs', { method: 'POST', key: token, body: { songs: draft } })));
  box.append(browser(m));
}

// 楽曲一覧（2fRATE の計算ページと同じ形：検索・レベル・難易度・ページ送り）
function browser(m) {
  const wrap = el('div');
  wrap.style.cssText = 'display:grid;gap:10px';
  const cap = Number(m.cap) + 1e-9;
  const pool = charts.list.filter((c) => c.c <= cap && c.key !== m.kadai);
  const levels = [...new Set(pool.map((c) => c.lv))].sort((a, b) => levelOrder(b) - levelOrder(a));
  if (browse.level !== 'all' && !levels.includes(browse.level)) browse.level = 'all';

  const search = el('input', 'search');
  search.type = 'search'; search.id = 'songSearch'; search.placeholder = '曲名で絞り込み'; search.value = browse.q;
  search.setAttribute('aria-label', '曲名で絞り込み');
  const lvTabs = el('div', 'tabs'); lvTabs.setAttribute('role', 'group'); lvTabs.setAttribute('aria-label', 'レベル');
  ['all', ...levels].forEach((lv) => {
    const b = el('button', '', lv === 'all' ? 'すべて' : 'Lv' + lv); b.type = 'button';
    b.setAttribute('aria-pressed', browse.level === lv);
    b.onclick = () => { browse.level = lv; browse.page = 1; renderMatch(); };
    lvTabs.append(b);
  });
  const dTabs = el('div', 'tabs'); dTabs.setAttribute('role', 'group'); dTabs.setAttribute('aria-label', '難易度');
  DIFF_ORDER.forEach((d) => {
    const b = el('button', '', DIFF_SHORT[d]); b.type = 'button';
    b.setAttribute('aria-pressed', browse.diffs.has(d));
    b.onclick = () => { browse.diffs.has(d) ? browse.diffs.delete(d) : browse.diffs.add(d); if (!browse.diffs.size) browse.diffs.add(d); browse.page = 1; renderMatch(); };
    dTabs.append(b);
  });
  const count = el('div', 'note');
  const list = el('div', 'list');
  const pager = el('div', 'pager');

  const draw = () => {
    const q = norm(browse.q);
    const hits = pool.filter((c) => (browse.level === 'all' || c.lv === browse.level) && browse.diffs.has(c.diff) && (!q || norm(c.name).includes(q)));
    const pages = Math.max(1, Math.ceil(hits.length / PAGE_SIZE));
    browse.page = Math.min(browse.page, pages);
    count.textContent = `${hits.length} 譜面（譜面定数 ${fmtConst(Number(m.cap))} 以下）`;
    list.replaceChildren();
    hits.slice((browse.page - 1) * PAGE_SIZE, browse.page * PAGE_SIZE).forEach((c) => {
      const on = draft.includes(c.key);
      const full = draft.length >= 3 && !on;
      const r = el('button', 'row' + (on ? ' on' : '')); r.type = 'button';
      if (full) r.setAttribute('aria-disabled', 'true');
      const info = el('div'); info.append(el('div', 'sname', c.name), chipsOf(c));
      r.append(jacketEl(c.img), info, el('span', 'go', on ? '選択中（外す）' : full ? '3曲選択済み' : '選ぶ'));
      r.onclick = () => {
        if (on) draft = draft.filter((k) => k !== c.key);
        else if (!full) draft.push(c.key);
        else return setMsg('自選曲は3曲までです。入れ替えるときは先に1曲外してください', 'err');
        setMsg('');
        renderMatch();
      };
      list.append(r);
    });
    if (!hits.length) list.append(el('div', 'note', '条件に合う譜面がありません'));
    pager.replaceChildren();
    if (pages > 1) {
      const add = (label, p, cur) => { const b = el('button', cur ? 'cur' : '', label); b.type = 'button'; b.disabled = p < 1 || p > pages; b.onclick = () => { browse.page = p; draw(); list.scrollIntoView({ block: 'start' }); }; pager.append(b); };
      add('‹', browse.page - 1);
      for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - browse.page) <= 2) add(String(p), p, p === browse.page); else if (Math.abs(p - browse.page) === 3) pager.append(el('span', 'note', '…'));
      add('›', browse.page + 1);
    }
  };
  search.addEventListener('input', () => { browse.q = search.value; browse.page = 1; draw(); });
  wrap.append(el('h2', '', '楽曲一覧'), search, lvTabs, dTabs, count, list, pager);
  draw();
  return wrap;
}

function choiceList(keys, { banned = -1, picked = -1, onPick }) {
  const box = el('div', 'choices');
  keys.forEach((k, i) => {
    const b = el('button', 'choice' + (i === banned ? ' banned' : '')); b.type = 'button';
    b.setAttribute('aria-pressed', i === picked);
    const right = i === banned ? el('span', 'tag ban', 'BAN') : i === picked ? el('span', 'tag pick', onPick ? '選択中' : '自選曲') : el('span');
    b.append(songEl(k, right));
    if (onPick && i !== banned) b.onclick = () => { onPick(i); };
    else b.setAttribute('aria-disabled', 'true');
    box.append(b);
  });
  return box;
}

// 段階：BAN
function renderBan(box, m) {
  box.append(el('h2', '', '相手の自選曲から1曲を BAN する'));
  if (!m.oppSongs || m.oppSongs.length !== 3) { box.append(el('p', 'note', '相手の自選曲がまだそろっていません。運営からの連絡をお待ちください。')); return; }
  box.append(el('p', 'note', m.myBan >= 0 ? 'BAN を提出済みです。期間中は選び直せます。' : 'BAN する曲を選んで「BAN を提出する」を押してください。'));
  box.append(choiceList(m.oppSongs, { banned: -1, picked: choice, onPick: (i) => { choice = i; renderMatch(); } }));
  box.append(submitBtn('BAN を提出する', choice >= 0 && choice !== m.myBan, () => api('api/me/ban', { method: 'POST', key: token, body: { index: choice } })));
  box.append(el('div', 'slotno', 'あなたの自選曲'));
  box.append(choiceList(m.mySongs, {}));
}

// 段階：自選曲の決定
function renderPick(box, m) {
  box.append(el('h2', '', '残った2曲から自選曲を決める'));
  if (m.mySongs.length !== 3) { box.append(el('p', 'note', '自選曲が提出されていません。運営に連絡してください。')); return; }
  if (m.bannedMine == null || m.bannedMine < 0) { box.append(el('p', 'note', '相手の BAN がまだ決まっていません。運営からの連絡をお待ちください。')); return; }
  box.append(el('p', 'note', m.myPick >= 0 ? '提出済みです。期間中は選び直せます。' : 'BAN されなかった2曲から1曲選んで「自選曲を提出する」を押してください。'));
  box.append(choiceList(m.mySongs, { banned: m.bannedMine, picked: choice, onPick: (i) => { choice = i; renderMatch(); } }));
  box.append(submitBtn('自選曲を提出する', choice >= 0 && choice !== m.myPick, () => api('api/me/pick', { method: 'POST', key: token, body: { index: choice } })));
}

// 段階：対戦曲確定
function renderDone(box, m) {
  box.append(el('h2', '', '対戦曲'));
  const rows = [
    ['あなたの自選曲', m.myPick >= 0 ? m.mySongs[m.myPick] : ''],
    [`${m.opponent?.entryName || '相手'} の自選曲`, m.oppPick >= 0 && m.oppSongs ? m.oppSongs[m.oppPick] : ''],
    ['運営課題曲', m.kadai],
  ];
  rows.forEach(([lab, k]) => { box.append(el('div', 'slotno', lab)); box.append(songEl(k)); });
}

refresh();
