// もぐらたたきカップ 参加者ページ
const $ = (s, r = document) => r.querySelector(s);
const TOKEN_STORE = window.MOGU_DEMO ? 'mogucupdx-demo-session' : 'mogucupdx-session'; // デモは本番と別に保存
const PHASE_LABEL = { closed: '組み合わせ発表前', select: '自選曲の提出', ban: 'BAN', pick: '自選曲の決定', done: '対戦曲確定', play: '対戦期間（リザルト提出）', result: '結果発表' };
const PAGE_SIZE = 50;

let token = '';
try { token = localStorage.getItem(TOKEN_STORE) || ''; } catch {}
let ME = null;        // /api/me の結果
let charts = null;    // { list, byKey }
const drafts = {};    // 試合ごとの、提出前の自選曲（譜面キー）
const choices = {};   // 試合ごとの、BAN・決定で選んでいる番号
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
$('#divChecks').innerHTML = DIVISIONS.map((d) => `<label><input type="checkbox" name="div" value="${d.id}">${divPill(d.id)}</label>`).join('');
$('#plateChecks').innerHTML = PLATES.map((p) => `<label><input type="checkbox" name="plate" value="${p}">${p}神</label>`).join('');
// 神プレート：1つのボタンで全選択／全解除（すべて選ばれているときは「すべて解除」）
const plateBoxes = () => [...document.querySelectorAll('input[name=plate]')];
const syncPlateAll = () => { $('#plateAll').textContent = plateBoxes().every((x) => x.checked) ? 'すべて解除' : 'すべて選択'; };
$('#plateAll').onclick = () => { const all = plateBoxes().every((x) => x.checked); plateBoxes().forEach((x) => (x.checked = !all)); syncPlateAll(); };
$('#plateChecks').addEventListener('change', syncPlateAll);
const checkedDivs = () => [...document.querySelectorAll('input[name=div]:checked')].map((x) => x.value);
$('#divChecks').addEventListener('change', () => {
  const d = checkedDivs();
  $('#qLime').hidden = !d.includes('lime');
  $('#qLemon').hidden = !d.includes('lemon');
});
const intOf = (id) => ($('#' + id).value === '' ? null : Number($('#' + id).value));

$('#entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const divisions = checkedDivs();
  const lv14 = document.querySelector('input[name=lv14]:checked')?.value;
  const v = {
    xId: $('#xId').value.trim().replace(/^@/, ''), entryName: $('#entryName').value.trim(),
    rating: Number($('#rating').value), frate: Number($('#frate').value), website: $('#website').value,
    answers: {
      discord: $('#discord').value.trim(), divisions,
      plates: [...document.querySelectorAll('input[name=plate]:checked')].map((x) => x.value),
      lime: divisions.includes('lime') ? { m5: intOf('m5'), r5: intOf('r5'), s6: intOf('s6'), lv14: lv14 === 'yes' ? true : lv14 === 'no' ? false : null } : undefined,
      lemon: divisions.includes('lemon') ? { ap14: intOf('ap14'), ap14p: intOf('ap14p') } : undefined,
    },
  };
  const need = (ok, msg) => { if (!ok) { setMsg(msg, 'err'); return true; } return false; };
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  if (need(/^[A-Za-z0-9_]{1,15}$/.test(v.xId), 'Q1：X の ID は英数字と _ の15文字以内で入力してください')) return;
  if (need(v.answers.discord, 'Q2：Discord で使用している名前を入力してください')) return;
  if (need(v.entryName, 'Q3：スコアタで使用する名前を入力してください')) return;
  if (need(divisions.length, 'Q4：参加したい部門を1つ以上選んでください')) return;
  if (need($('#rating').value !== '' && Number.isInteger(v.rating), 'Q5：現在のレートを整数で入力してください')) return;
  if (need($('#frate').value !== '' && Number.isFinite(v.frate), 'Q6：2fRATE を入力してください')) return;
  const l = v.answers.lime, m = v.answers.lemon;
  if (l && need(isCount(l.m5) && isCount(l.r5) && isCount(l.s6), '【らいむ部門】Q8〜Q10 を0以上の整数で入力してください')) return;
  if (l && need(l.lv14 !== null, '【らいむ部門】Q11 を選んでください')) return;
  if (m && need(isCount(m.ap14) && isCount(m.ap14p), '【れもん部門】Q12・Q13 を0以上の整数で入力してください')) return;
  if (v.website) return;
  const btn = $('#entryForm button[type=submit]'); btn.disabled = true;
  try {
    await api('api/entry', { method: 'POST', key: token, body: v });
    setMsg('参加申請を受け付けました', 'ok');
    await refresh();
  } catch (err) { setMsg(err.message, 'err'); }
  btn.disabled = false;
});

// 2fRATE と連携しているユーザーは、2fRATE のレートと☆5・☆6 の達成数を最初から入れておく（空欄のときだけ）
function prefill2f(p) {
  if (!p) return;
  const put = (id, v) => { const x = $('#' + id); if (x && x.value === '' && v != null) { x.value = v; x.classList.add('from2f'); } };
  put('frate', p.rateFull != null ? Number(p.rateFull).toFixed(3) : null);
  put('m5', p.star5Mas);
  put('r5', p.star5Remas);
  put('s6', p.star6Mas != null && p.star6Remas != null ? p.star6Mas + p.star6Remas : null);
  $('#from2fNote').hidden = false;
}

function entryFacts(en) {
  const a = en.answers || {};
  const rows = [
    ['X', '@' + en.xId], ['Discord', a.discord || '-'], ['名前', en.entryName],
    ['部門', { html: (a.divisions || []).map((d) => divPill(d)).join(' ') || '-' }],
    ['レート', en.rating], ['2fRATE', Number(en.frate).toFixed(3)],
    ['神プレート', (a.plates || []).map((p) => p + '神').join(' ') || 'なし'],
  ];
  if (a.lime) rows.push([{ html: divPill('lime') }, `MAS星5 ${a.lime.m5}・Re:MAS星5 ${a.lime.r5}・星6 ${a.lime.s6}・Lv14 ${a.lime.lv14 ? '希望する' : '希望しない'}`]);
  if (a.lemon) rows.push([{ html: divPill('lemon') }, `Lv14 AP ${a.lemon.ap14}・Lv14+ AP ${a.lemon.ap14p}`]);
  const cell = (v) => (v && v.html !== undefined ? v.html : esc(v));
  return rows.map(([k, v]) => `<dt>${cell(k)}</dt><dd>${cell(v)}</dd>`).join('');
}

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
  if (en) $('#entryFacts').innerHTML = entryFacts(en);
  if (!en) prefill2f(ME.user.profile);
  for (const m of ME.matches) {
    drafts[m.id] = m.mySongs.slice();
    choices[m.id] = ME.settings.phase === 'ban' ? m.myBan : ME.settings.phase === 'pick' ? m.myPick : -1;
  }
  if (ME.matches.length && !charts) {
    $('#matchBox').hidden = false;
    $('#matchBox').textContent = '楽曲データを読み込み中…';
    try { charts = await loadCharts(); } catch { $('#matchBox').textContent = '楽曲データを読み込めませんでした。ページを再読み込みしてください'; return; }
  }
  renderMatches();
}

// ---------- 譜面の表示 ----------
const diffCls = (d) => 'd-' + d.replace(':', '').toUpperCase();
function chipsOf(c) {
  const box = el('div', 'chips');
  // 2fRATE と同じ色で「MAS ST 13.7」の順に並べる
  box.append(el('span', `chip ${diffCls(c.diff)}`, DIFF_SHORT[c.diff] || c.diff), el('span', `chip k-${c.kind}`, c.kind), el('span', 'chip c', fmtConst(c.c)));
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

// ---------- 自分の試合（部門ごと） ----------
function renderMatches() {
  const wrap = $('#matchBox');
  const phase = ME?.settings.phase;
  wrap.replaceChildren();
  if (!ME?.matches.length) {
    wrap.hidden = !(ME?.entry && phase !== 'closed');
    const p = el('section', 'panel'); p.innerHTML = '<h2>あなたの試合</h2><p class="note">対戦カードはまだ決まっていません。</p>';
    wrap.append(p);
    return;
  }
  wrap.hidden = false;
  ME.matches.forEach((m) => {
    const box = el('section', 'panel');
    box.dataset.mid = m.id;
    renderMatch(box, m, phase);
    wrap.append(box);
  });
}
function rerender(m) {
  const box = document.querySelector(`#matchBox [data-mid="${m.id}"]`);
  if (box) { box.replaceChildren(); renderMatch(box, m, ME.settings.phase); }
}

function renderMatch(box, m, phase) {
  const h = el('h2'); h.innerHTML = `${divPill(m.div)} MATCH ${String(m.no).padStart(2, '0')}`; box.append(h);
  const vs = el('div', 'vs');
  vs.append(el('div', 'nm', ME.entry.entryName), el('div', 'v', 'VS'), el('div', 'nm', m.opponent ? m.opponent.entryName : '（相手未定）'));
  box.append(vs);
  const facts = el('dl', 'facts');
  facts.innerHTML = `<dt>自選曲の上限</dt><dd>譜面定数 <b>${fmtConst(Number(m.cap))}</b> 以下${m.lv14 ? '<span class="lv14">Lv14 解禁：上限を超えるレベル14を1曲まで</span>' : ''}</dd>`;
  box.append(facts);
  if (m.kadai && ['select', 'ban', 'pick'].includes(phase)) { box.append(el('div', 'slotno', '運営課題曲')); box.append(songEl(m.kadai)); }
  const img = matchImage(m, phase);
  if (img) box.append(img);

  if (phase === 'select') renderSelect(box, m);
  else if (phase === 'ban') renderBan(box, m);
  else if (phase === 'pick') renderPick(box, m);
  else if (phase === 'done') renderDone(box, m);
  else if (phase === 'play') renderPlay(box, m);
  else if (phase === 'result') renderResult(box, m);
}

// 運営の告知画像と同じ形の表示。段階に合わせて見せる範囲を広げる。表示だけで保存はしない
//   BAN：選曲公開（両者の自選曲）／自選曲の決定：BAN結果／対戦曲確定：対戦曲（BAN と自選曲つき）
const imgCache = new Map();
const IMG_KIND = { ban: 'reveal', pick: 'ban', done: 'final', play: 'final', result: 'result' };
function matchImage(m, phase) {
  const kind = IMG_KIND[phase];
  if (!kind || !window.DrawKit || m.mySongs.length !== 3 || !m.oppSongs || m.oppSongs.length !== 3) return null;
  const ch = (k) => (k && charts?.byKey.get(k)) || null;
  const meName = ME.entry.entryName, opName = m.opponent?.entryName || '相手';
  const done = kind === 'final' || kind === 'result', bans = kind !== 'reveal';
  const myPick = done ? m.myPick : -1, opPick = done && m.oppPick != null ? m.oppPick : -1;
  const match = {
    aName: meName, bName: opName,
    aSongs: m.mySongs.map(ch), bSongs: m.oppSongs.map(ch), cap: m.cap, lv14: m.lv14,
    aBan: bans ? (m.bannedMine ?? -1) : -1, bBan: bans ? m.myBan : -1, aPick: myPick, bPick: opPick,
    finals: finalSongs({
      format: ME.settings.format, kadai: m.kadai, kadai2: m.kadai2, aName: meName, bName: opName,
      aKey: myPick >= 0 ? m.mySongs[myPick] : '', bKey: opPick >= 0 ? m.oppSongs[opPick] : '',
    }).map((f) => ({ ...f, s: ch(f.key) })),
  };
  if (kind === 'result') Object.assign(match, resultRows(m, match.finals));
  const matches = []; matches[m.no - 1] = match; // 画像の MATCH 番号を合わせる
  const view = { title: ME.settings.title, badge: divName(m.div), badgeColor: DIV_COLOR[m.div], notes: ME.settings.notes || {}, matches };
  const key = JSON.stringify([kind, match, view.title, view.notes]);
  const wrap = el('div', 'matchimg');
  if (imgCache.has(key)) { wrap.append(imgCache.get(key)); return wrap; }
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', { reveal: '選曲公開', ban: 'BAN結果', final: '対戦曲', result: '結果発表' }[kind] + 'の画像');
  wrap.append(cv);
  DrawKit.render(cv, view, kind, m.no - 1, { preview: true }).then(() => imgCache.set(key, cv)).catch(() => wrap.remove());
  return wrap;
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
  const draft = drafts[m.id];
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
      rm.onclick = () => { draft.splice(i, 1); rerender(m); };
      s.append(songEl(k, rm));
    } else s.append(el('span', 'empty', `自選曲${i + 1}：未選択`));
    slots.append(s);
  }
  box.append(slots);
  box.append(submitBtn(submitted ? '提出し直す' : '提出する', draft.length === 3 && !same, () => api('api/me/songs', { method: 'POST', key: token, body: { matchId: m.id, songs: draft } })));
  box.append(browser(m));
}

// 楽曲一覧（2fRATE の計算ページと同じ形：検索・レベル・難易度・ページ送り）
function browser(m) {
  const draft = drafts[m.id];
  const wrap = el('div');
  wrap.style.cssText = 'display:grid;gap:10px';
  const overUsed = draft.some((k) => { const c = charts.byKey.get(k); return c && overCap(c.c, m.cap); });
  // Lv14 解禁枠を1曲使ったら、ほかの上限超えの譜面は一覧から外す（選んだ1曲は残す）
  const pool = charts.list.filter((c) => selectable(c.c, m.cap, m.lv14) && c.key !== m.kadai && !(overUsed && overCap(c.c, m.cap) && !draft.includes(c.key)));
  const levels = [...new Set(pool.map((c) => c.lv))].sort((a, b) => levelOrder(b) - levelOrder(a));
  if (browse.level !== 'all' && !levels.includes(browse.level)) browse.level = 'all';

  const search = el('input', 'search');
  search.type = 'search'; search.id = 'songSearch-' + m.id; search.placeholder = '曲名で絞り込み'; search.value = browse.q;
  search.setAttribute('aria-label', '曲名で絞り込み');
  const lvTabs = el('div', 'tabs'); lvTabs.setAttribute('role', 'group'); lvTabs.setAttribute('aria-label', 'レベル');
  ['all', ...levels].forEach((lv) => {
    const b = el('button', '', lv === 'all' ? 'すべて' : 'Lv' + lv); b.type = 'button';
    b.setAttribute('aria-pressed', browse.level === lv);
    b.onclick = () => { browse.level = lv; browse.page = 1; rerender(m); };
    lvTabs.append(b);
  });
  const dTabs = el('div', 'tabs'); dTabs.setAttribute('role', 'group'); dTabs.setAttribute('aria-label', '難易度');
  DIFF_ORDER.forEach((d) => {
    const b = el('button', '', DIFF_SHORT[d]); b.type = 'button';
    b.setAttribute('aria-pressed', browse.diffs.has(d));
    b.onclick = () => { browse.diffs.has(d) ? browse.diffs.delete(d) : browse.diffs.add(d); if (!browse.diffs.size) browse.diffs.add(d); browse.page = 1; rerender(m); };
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
    count.textContent = `${hits.length} 譜面（譜面定数 ${fmtConst(Number(m.cap))} 以下${m.lv14 ? '、上限を超えるレベル14は1曲まで' : ''}）`;
    list.replaceChildren();
    hits.slice((browse.page - 1) * PAGE_SIZE, browse.page * PAGE_SIZE).forEach((c) => {
      const on = draft.includes(c.key);
      const over = overCap(c.c, m.cap);
      const full = draft.length >= 3 && !on;
      const blocked = !on && over && overUsed;
      const r = el('button', 'srow' + (on ? ' on' : '')); r.type = 'button';
      if (full || blocked) r.setAttribute('aria-disabled', 'true');
      const info = el('div'); info.append(el('div', 'sname', c.name), chipsOf(c));
      if (over) info.querySelector('.chips').append(el('span', 'lv14', 'Lv14 解禁枠'));
      r.append(jacketEl(c.img), info, el('span', 'go', on ? '選択中（外す）' : full ? '3曲選択済み' : blocked ? 'Lv14 は1曲まで' : '選ぶ'));
      r.onclick = () => {
        if (on) draft.splice(draft.indexOf(c.key), 1);
        else if (full) return setMsg('自選曲は3曲までです。入れ替えるときは先に1曲外してください', 'err');
        else if (blocked) return setMsg('上限を超えるレベル14の譜面は1曲までです', 'err');
        else draft.push(c.key);
        setMsg('');
        rerender(m);
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
  box.append(choiceList(m.oppSongs, { banned: -1, picked: choices[m.id], onPick: (i) => { choices[m.id] = i; rerender(m); } }));
  box.append(submitBtn('BAN を提出する', choices[m.id] >= 0 && choices[m.id] !== m.myBan, () => api('api/me/ban', { method: 'POST', key: token, body: { matchId: m.id, index: choices[m.id] } })));
  box.append(el('div', 'slotno', 'あなたの自選曲'));
  box.append(choiceList(m.mySongs, {}));
}

// 段階：自選曲の決定
function renderPick(box, m) {
  box.append(el('h2', '', '残った2曲から自選曲を決める'));
  if (m.mySongs.length !== 3) { box.append(el('p', 'note', '自選曲が提出されていません。運営に連絡してください。')); return; }
  if (m.bannedMine == null || m.bannedMine < 0) { box.append(el('p', 'note', '相手の BAN がまだ決まっていません。運営からの連絡をお待ちください。')); return; }
  box.append(el('p', 'note', m.myPick >= 0 ? '提出済みです。期間中は選び直せます。' : 'BAN されなかった2曲から1曲選んで「自選曲を提出する」を押してください。'));
  box.append(choiceList(m.mySongs, { banned: m.bannedMine, picked: choices[m.id], onPick: (i) => { choices[m.id] = i; rerender(m); } }));
  box.append(submitBtn('自選曲を提出する', choices[m.id] >= 0 && choices[m.id] !== m.myPick, () => api('api/me/pick', { method: 'POST', key: token, body: { matchId: m.id, index: choices[m.id] } })));
}

// 段階：対戦曲確定
function renderDone(box, m) {
  box.append(el('h2', '', '対戦曲'));
  const list = finalSongs({
    format: ME.settings.format, kadai: m.kadai, kadai2: m.kadai2, aName: 'あなた', bName: m.opponent?.entryName || '相手',
    aKey: m.myPick >= 0 ? m.mySongs[m.myPick] : '', bKey: m.oppPick >= 0 && m.oppSongs ? m.oppSongs[m.oppPick] : '',
  });
  if (list[0].kind === 'both') box.append(el('p', 'note', ME.settings.format === 'mini' ? '両者が同じ曲を自選曲にしました。' : '両者が同じ曲を自選曲にしたため、運営課題曲が2曲になります。'));
  list.forEach((f) => { box.append(el('div', 'slotno', f.label)); box.append(songEl(f.key)); });
}

// ============================================================
//  対戦期間：リザルトの提出（画像から値を読み取り、確認してから送る）
// ============================================================
// 対戦曲（自分が A の並び）と、サーバーの「何曲目か」の対応
function myFinals(m) {
  return finalSongs({
    format: ME.settings.format, kadai: m.kadai, kadai2: m.kadai2, aName: 'あなた', bName: m.opponent?.entryName || '相手',
    aKey: m.myPick >= 0 ? m.mySongs[m.myPick] : '', bKey: m.oppPick >= 0 && m.oppSongs ? m.oppSongs[m.oppPick] : '',
  }).map((f) => ({ ...f, slot: (m.finals || []).indexOf(f.key) }));
}
// 画像用：対戦曲ごとの両者のリザルトと合計
function resultRows(m, finals) {
  const metric = m.metric || METRIC[m.div] || 'ach';
  const bySlot = (list, slot) => (list || []).find((r) => r.slot === slot) || null;
  const rows = finals.map((f) => {
    const slot = (m.finals || []).indexOf(f.key);
    return { s: f.s, label: f.label, a: bySlot(m.myResults, slot), b: bySlot(m.oppResults, slot) };
  });
  return { metric, rows, score: resultScore(metric, rows, m.winner || '') };
}
const STATUS = { pending: ['承認待ち', 'st-pending'], approved: ['承認済み', 'st-ok'], rejected: ['却下', 'st-ng'] };
function valueLine(metric, r) {
  if (!r) return '';
  if (metric === 'dx') return r.dx != null ? `でらっくスコア ${fmtNum(r.dx)} / ${fmtNum(r.dx_max)}・CP以外のBREAK ${r.brk ?? '?'} → 失点 ${fmtLoss(lossOf(r))}` : '';
  return r.ach != null ? `達成率 ${fmtAch(r.ach)}` : '';
}

function renderPlay(box, m) {
  const metric = m.metric || METRIC[m.div];
  box.append(el('h2', '', 'リザルトの提出'));
  box.append(el('p', 'note', metric === 'dx'
    ? 'この部門は、失点の3曲合計が少ない方の勝ちです。失点 ＝（でらっくスコアの MAX − でらっくスコア）＋ CRITICAL PERFECT 以外で取った BREAK の数 × 2。曲ごとにリザルト画像を選ぶと、でらっくスコアを読み取ります。BREAK の数は判定の内訳を見て入力し、値を確かめてから提出してください。'
    : 'この部門は、達成率の3曲合計が高い方の勝ちです。曲ごとにリザルト画像を選ぶと、達成率を読み取ります。値を確かめてから提出してください。'));
  box.append(el('p', 'note', 'でらっくす NET のプレイ履歴（詳細）のスクリーンショットが一番正確に読み取れます。ゲーム機の画面の写真でも提出できます。期間中は何度でも出し直せます（出し直すと承認待ちに戻ります）。'));
  const dl = ME.settings.resultDeadline;
  const closed = dl && Date.now() > Date.parse(dl + ':00+09:00');
  const facts = el('dl', 'facts');
  facts.innerHTML = `<dt>提出の締切</dt><dd>${dl ? esc(fmtDeadline(dl)) : '運営が締め切るまで'}${closed ? '　<b>（終了しました）</b>' : ''}</dd>`;
  box.append(facts);
  if (closed) box.append(el('p', 'warn', 'リザルトの提出期間は終了しました。提出されていない曲は「未提出」として扱われます。'));
  for (const f of myFinals(m)) {
    const r = (m.myResults || []).find((x) => x.slot === f.slot) || null;
    const card = el('div', 'rcard');
    const st = r ? STATUS[r.status] || STATUS.pending : ['未提出', 'st-none'];
    card.append(el('div', 'slotno', f.label));
    card.append(songEl(f.key, el('span', 'rstatus ' + st[1], st[0])));
    if (r) card.append(el('div', 'rval', valueLine(metric, r)));
    if (r?.status === 'rejected') card.append(el('p', 'warn', `却下の理由：${r.reason || '（理由なし）'}。もう一度提出してください。`));
    if (f.slot < 0 || !f.key) { card.append(el('p', 'note', '対戦曲が決まっていません。運営に連絡してください。')); box.append(card); continue; }
    if (closed) { box.append(card); continue; }
    const open = el('button', r ? '' : 'primary', r ? '出し直す' : 'リザルトを提出');
    open.type = 'button';
    const form = el('div', 'rform'); form.hidden = true;
    open.onclick = () => { form.hidden = !form.hidden; if (!form.hidden && !form.childElementCount) buildResultForm(form, m, f, metric); };
    const w = el('div', 'btns'); w.append(open);
    card.append(w, form);
    box.append(card);
  }
}

function buildResultForm(form, m, f, metric) {
  const file = el('input'); file.type = 'file'; file.accept = 'image/*';
  const pick = el('label', 'filebtn'); pick.append(el('span', '', 'リザルト画像を選ぶ'), file);
  const prev = el('img', 'rprev'); prev.alt = '選んだリザルト画像'; prev.hidden = true;
  const ocrNote = el('p', 'note', '');
  const num = (label, ph, mode = 'numeric') => {
    const l = el('label', '', label); const i = el('input'); i.type = 'text'; i.inputMode = mode; i.placeholder = ph; l.append(i); return [l, i];
  };
  const [lDx, iDx] = num('でらっくスコア', '例 2345');
  const [lMax, iMax] = num('でらっくスコアの最大値（MAX）', '例 2502');
  const [lAch, iAch] = num('達成率（%）', '例 100.5432', 'decimal');
  const [lBrk, iBrk] = num('CRITICAL PERFECT 以外の BREAK の数', '例 3');
  const row = el('div', 'row');
  if (metric === 'dx') row.append(lDx, lMax, lBrk); else row.append(lAch);
  const brkNote = el('p', 'note', 'BREAK の数は、判定の内訳の BREAK の行で、CRITICAL PERFECT 以外（PERFECT・GREAT・GOOD・MISS）を足した数です。1つにつき失点が2増えます。');
  if (metric !== 'dx') brkNote.hidden = true;
  const send = el('button', 'primary', 'この内容で提出'); send.type = 'button'; send.disabled = true;
  const btns = el('div', 'btns'); btns.append(send);
  form.append(pick, prev, ocrNote, row, brkNote, btns);
  let image = '';
  file.onchange = async () => {
    const fl = file.files?.[0]; if (!fl) return;
    send.disabled = true;
    try {
      const { dataURL, canvas } = await compressImage(fl);
      image = dataURL; prev.src = dataURL; prev.hidden = false;
      send.disabled = false;
      ocrNote.textContent = '画像から値を読み取っています…（初回は少し時間がかかります）';
      const v = await readScore(canvas);
      if (metric === 'dx' && v.dx != null) { iDx.value = v.dx; iMax.value = v.dxMax; }
      if (metric === 'dx' && v.brk != null) iBrk.value = v.brk;
      if (metric === 'ach' && v.ach != null) iAch.value = v.ach;
      const got = metric === 'dx' ? v.dx != null : v.ach != null;
      ocrNote.textContent = got
        ? `読み取った値を入れました。画像と見比べて、違っていたら直してから提出してください。${metric === 'dx' && v.brk == null ? 'BREAK の数は読み取れなかったので、判定の内訳を見て入力してください。' : ''}`
        : '値を読み取れませんでした。画像を見ながら入力してください。';
    } catch (e) {
      ocrNote.textContent = image ? '値を読み取れませんでした。画像を見ながら入力してください。' : e.message;
    }
  };
  send.onclick = async () => {
    send.disabled = true;
    try {
      const body = { matchId: m.id, slot: f.slot, image };
      if (metric === 'dx') Object.assign(body, { dx: iDx.value, dxMax: iMax.value, brk: iBrk.value }); else body.ach = iAch.value;
      await api('api/me/result', { method: 'POST', key: token, body });
      setMsg('リザルトを提出しました。運営の承認をお待ちください', 'ok');
      await refresh();
    } catch (e) { setMsg(e.message, 'err'); send.disabled = false; }
  };
}

// 画像を JPEG に縮めて送る（デモはブラウザに保存するので、さらに小さくする）
async function compressImage(fileObj) {
  const url = URL.createObjectURL(fileObj);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('画像を読み込めませんでした')); i.src = url; });
    const max = window.MOGU_DEMO ? 720 : 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    let q = window.MOGU_DEMO ? 0.6 : 0.85, dataURL = cv.toDataURL('image/jpeg', q);
    while (dataURL.length > 1400000 && q > 0.4) { q -= 0.1; dataURL = cv.toDataURL('image/jpeg', q); }
    // 読み取りは、縮める前に近い大きさの画像で行う（小さいと数字を読み違えやすい）
    const k2 = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    let ocrCv = cv;
    if (k2 > k) {
      ocrCv = document.createElement('canvas');
      ocrCv.width = Math.round(img.naturalWidth * k2); ocrCv.height = Math.round(img.naturalHeight * k2);
      ocrCv.getContext('2d').drawImage(img, 0, 0, ocrCv.width, ocrCv.height);
    }
    return { dataURL, canvas: ocrCv };
  } finally { URL.revokeObjectURL(url); }
}

// 文字の読み取り（Tesseract.js をそのときだけ読み込む。画像はこのブラウザの中で読み、外には送らない）
let tessReady = null, tessWorker = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tessReady ||= new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    sc.onload = () => res(window.Tesseract);
    sc.onerror = () => { tessReady = null; rej(new Error('読み取りの準備ができませんでした')); };
    document.head.append(sc);
  });
  return tessReady;
}
async function readScore(canvas) {
  const T = await loadTesseract();
  if (!tessWorker) tessWorker = await T.createWorker('eng');
  const W = canvas.width, H = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, W, H);
  const ocr = async (cv, psm, chars) => {
    await tessWorker.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: chars });
    return (await tessWorker.recognize(cv)).data.text || '';
  };
  // 1回目：白黒にして全体を読む（でらっくスコア・達成率）
  const gray = maskCanvas(src, 0, 0, W, H, (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b < 150);
  const v = parseScore(await ocr(gray, 3, '0123456789.,/%'));
  // 2回目：紫の帯の上の白い大きな数字（達成率）は、白い部分を文字として読み直す
  if (v.ach == null || v.dx == null) {
    const white = maskCanvas(src, 0, 0, W, H, (r, g, b) => Math.min(r, g, b) > 215);
    const v2 = parseScore(await ocr(white, 3, '0123456789.,/%'));
    if (v.ach == null) v.ach = v2.ach;
    if (v.dx == null) { v.dx = v2.dx; v.dxMax = v2.dxMax; }
  }
  // 3回目：判定の内訳の表から、BREAK の行（PERFECT・GREAT・GOOD・MISS の合計）を読む
  v.brk = null;
  try { v.brk = await readBreak(src, W, H, ocr); } catch { /* 読めなければ手入力 */ }
  return v;
}

// 指定した範囲を、条件に合う画素を黒・それ以外を白にした canvas にする（scale 倍に拡大）
function maskCanvas(img, x0, y0, x1, y1, isInk, scale = 1, pad = 0) {
  const w = x1 - x0, h = y1 - y0;
  const cv = document.createElement('canvas');
  cv.width = w * scale + pad * 2; cv.height = h * scale + pad * 2;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  const out = c.getImageData(0, 0, cv.width, cv.height), d = img.data, o = out.data;
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const i = ((y0 + Math.floor(y / scale)) * img.width + (x0 + Math.floor(x / scale))) * 4;
      if (isInk(d[i], d[i + 1], d[i + 2], x0 + Math.floor(x / scale), y0 + Math.floor(y / scale))) {
        const j = ((y + pad) * cv.width + (x + pad)) * 4;
        o[j] = o[j + 1] = o[j + 2] = 0;
      }
    }
  }
  c.putImageData(out, 0, 0);
  return cv;
}

// でらっくす NET の判定表（青い枠）を探し、一番下の BREAK の行の数字を1つずつ読む
async function readBreak(img, W, H, ocr) {
  const d = img.data;
  const blue = (i) => d[i] < 130 && d[i + 1] > 110 && d[i + 1] < 200 && d[i + 2] > 200 && d[i + 2] - d[i] > 90;
  // 横に長い青い線（表の上辺・下辺）を探す
  const lines = [];
  for (let y = 0; y < H; y++) {
    // 画像の圧縮で線がところどころ途切れるので、数画素のすき間はつながっているとみなす
    let best = 0, bx = 0, s = -1, miss = 0;
    for (let x = 0; x <= W; x++) {
      const on = x < W && blue((y * W + x) * 4);
      if (on) { if (s < 0) s = x; miss = 0; continue; }
      if (s >= 0 && x < W && ++miss <= 3) continue;
      if (s >= 0) { const len = x - miss - s; if (len > best) { best = len; bx = s; } s = -1; miss = 0; }
    }
    if (best >= 0.35 * W && best <= 0.92 * W) {
      const last = lines[lines.length - 1];
      if (last && y - last.y1 <= 2) { last.y1 = y; last.x0 = Math.min(last.x0, bx); last.x1 = Math.max(last.x1, bx + best); }
      else lines.push({ y0: y, y1: y, x0: bx, x1: bx + best });
    }
  }
  let box = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[i], b = lines[j], w = t.x1 - t.x0, dy = b.y0 - t.y1;
      if (Math.abs(t.x0 - b.x0) < 0.03 * W && Math.abs(t.x1 - b.x1) < 0.03 * W && dy > 0.3 * w && dy < 0.8 * w && (!box || dy > box.y1 - box.y0)) {
        box = { x0: t.x0, y0: t.y1, x1: t.x1, y1: b.y0 };
      }
    }
  }
  if (!box) return null;
  // 表は6行（見出し・TAP・HOLD・SLIDE・TOUCH・BREAK）。一番下の行の、左の見出しの列を除いた部分
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const sx0 = box.x0 + Math.round(w * 0.17), sx1 = box.x1 - 4, sy0 = box.y0 + Math.round(h * 5 / 6) + 3, sy1 = box.y1 - 3;
  // 背景（白・水色）でないものを文字とする
  const ink = (r, g, b) => !(Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 45) && !(r > 150 && g > 200 && b > 230);
  const hasInk = [];
  for (let x = sx0; x < sx1; x++) {
    let on = false;
    for (let y = sy0; y < sy1 && !on; y++) { const i = (y * W + x) * 4; on = ink(d[i], d[i + 1], d[i + 2]); }
    hasInk.push(on);
  }
  // 数字のかたまり（すき間で区切る）＝ CRITICAL PERFECT・PERFECT・GREAT・GOOD・MISS の5つ
  const gap = Math.round(w * 0.03), runs = [];
  let s = -1, last = -1;
  hasInk.forEach((on, k) => {
    if (!on) return;
    if (s < 0) s = k; else if (k - last > gap) { runs.push([s, last]); s = k; }
    last = k;
  });
  if (s >= 0) runs.push([s, last]);
  // 罫線のかけらなど、細すぎるものは数字ではないので除く
  const minW = Math.max(2, Math.round(w * 0.006));
  const nums5 = runs.filter(([a, b]) => b - a + 1 >= minW);
  if (nums5.length !== 5) return null;
  runs.length = 0; runs.push(...nums5);
  const nums = [];
  for (const [a, b] of runs) {
    const cv = maskCanvas(img, sx0 + Math.max(0, a - 3), sy0, Math.min(sx1, sx0 + b + 4), sy1, ink, 3, 30);
    const t = (await ocr(cv, 7, '0123456789')).replace(/\D/g, '');
    if (!t) return null;
    nums.push(Number(t));
  }
  return nums[1] + nums[2] + nums[3] + nums[4];
}
// 読み取った文字から、達成率（100.5432%）とでらっくスコア（2,345 / 2,502）を探す
function parseScore(text) {
  const t = text.replace(/\s+/g, ' ');
  let ach = null;
  for (const mm of t.matchAll(/(\d{1,3})[.,](\d{4})/g)) {
    const v = Number(`${mm[1]}.${mm[2]}`);
    if (v <= 101 && (ach === null || v > Number(ach))) ach = `${mm[1]}.${mm[2]}`;
  }
  // 小数点が読めなかったとき（1007817% など）は、% の前の数字の並びから戻す
  if (ach === null) {
    for (const mm of t.matchAll(/(\d{2,3})(\d{4})\s*%/g)) {
      const v = Number(`${mm[1]}.${mm[2]}`);
      if (v >= 50 && v <= 101) { ach = `${mm[1]}.${mm[2]}`; break; }
    }
  }
  let dx = null, dxMax = null;
  for (const mm of t.matchAll(/(\d[\d,.]{0,6})\s*\/\s*(\d[\d,.]{0,6})/g)) {
    const a = Number(mm[1].replace(/[,.]/g, '')), b = Number(mm[2].replace(/[,.]/g, ''));
    if (b >= 300 && b <= 12000 && b % 3 === 0 && a <= b) { dx = a; dxMax = b; break; }
  }
  return { ach, dx, dxMax };
}

// ============================================================
//  結果発表
// ============================================================
function renderResult(box, m) {
  const metric = m.metric || METRIC[m.div];
  const fs = myFinals(m).map((f) => ({ ...f, s: charts?.byKey.get(f.key) || null }));
  const { rows, score } = resultRows(m, fs);
  box.append(el('h2', '', '結果'));
  const res = score.winner === 'a' ? 'あなたの勝ちです' : score.winner === 'b' ? 'あなたの負けです' : score.winner === 'draw' ? '引き分けです'
    : m.winner === 'none' || score.a.missing || score.b.missing ? '未提出の曲があるため、勝敗はつきません' : '集計中です';
  box.append(el('p', 'rwin', res));
  if (score.manual && m.winner !== 'none') box.append(el('p', 'note', 'この試合の勝敗は運営が判定しました。'));
  const facts = el('dl', 'facts');
  const tot = (x) => (x.done ? scoreText(metric, x.total) : `未提出 ${x.missing}曲`);
  facts.innerHTML = `<dt>あなた</dt><dd>${tot(score.a)}</dd><dt>${esc(m.opponent?.entryName || '相手')}</dt><dd>${tot(score.b)}</dd>`;
  box.append(facts);
  rows.forEach((r, i) => {
    box.append(el('div', 'slotno', fs[i].label));
    box.append(songEl(fs[i].key));
    const v = el('div', 'rval');
    v.append(el('div', '', `あなた：${valueLine(metric, r.a) || '未提出'}`), el('div', '', `${m.opponent?.entryName || '相手'}：${valueLine(metric, r.b) || '未提出'}`));
    box.append(v);
  });
}

refresh();
