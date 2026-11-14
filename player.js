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
  if (s.form) applyForm(s.form);
}

// ---------- 申請の設問（運営が必須／任意／非表示や追加の設問を決める） ----------
let FORM = { q: {}, custom: [] };
let formSig = '';
const qMode = (k) => FORM.q[k] || 'required';
const tagHtml = (mode) => (mode === 'required' ? '<i>必須</i>' : '<i class="opt">任意</i>');
function customHtml(c) {
  const head = `<b>Q.</b> ${esc(c.label)} ${tagHtml(c.mode)}`;
  const note = c.note ? `<small>${esc(c.note)}</small>` : '';
  const name = 'cq_' + c.id;
  if (c.type === 'choice' || c.type === 'multi') {
    const t = c.type === 'choice' ? 'radio' : 'checkbox';
    const opts = c.options.map((o) => `<label><input type="${t}" name="${name}" value="${esc(o)}">${esc(o)}</label>`).join('');
    return `<fieldset class="q" data-cq="${c.id}"><legend>${head}</legend>${note}<div class="checks">${opts}</div></fieldset>`;
  }
  const input = c.type === 'number'
    ? `<input id="${name}" type="number" inputmode="decimal" step="any">`
    : `<input id="${name}" type="text" maxlength="500">`;
  return `<label class="q" data-cq="${c.id}"><span>${head}</span>${note}${input}</label>`;
}
function applyForm(form) {
  const sig = JSON.stringify(form);
  if (sig === formSig) return;
  formSig = sig; FORM = { q: form.q || {}, custom: form.custom || [] };
  document.querySelectorAll('#entryForm [data-q]').forEach((el) => {
    const m = qMode(el.dataset.q);
    el.hidden = m === 'hidden';
    el.dataset.off = m === 'hidden' ? '1' : '';
    const tag = el.querySelector(':scope > span > i, :scope > legend > i');
    if (tag) tag.outerHTML = tagHtml(m);
  });
  const slot = { '': '#qCustom', lime: '#qCustomLime', lemon: '#qCustomLemon' };
  for (const [div, sel] of Object.entries(slot)) {
    $(sel).innerHTML = FORM.custom.filter((c) => c.mode !== 'hidden' && (c.div || '') === div).map(customHtml).join('');
  }
  // 見えている設問だけで番号を振り直す
  let n = 0;
  document.querySelectorAll('#entryForm .q').forEach((el) => {
    if (el.dataset.off === '1') return;
    const b = el.querySelector(':scope > span > b, :scope > legend > b');
    if (b) { n++; b.textContent = `Q${n}.`; el.dataset.no = 'Q' + n; }
  });
}
const qNo = (sel) => document.querySelector('#entryForm ' + sel)?.dataset.no || '';
function customAnswers(divisions) {
  const out = {};
  for (const c of FORM.custom) {
    if (c.mode === 'hidden' || (c.div && !divisions.includes(c.div))) continue;
    const name = 'cq_' + c.id;
    if (c.type === 'choice') out[c.id] = document.querySelector(`input[name="${name}"]:checked`)?.value ?? '';
    else if (c.type === 'multi') out[c.id] = [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value);
    else out[c.id] = ($('#' + name)?.value ?? '').trim();
  }
  return out;
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
    rating: $('#rating').value === '' ? null : Number($('#rating').value),
    frate: $('#frate').value === '' ? null : Number($('#frate').value), website: $('#website').value,
    answers: {
      discord: $('#discord').value.trim(), divisions,
      plates: [...document.querySelectorAll('input[name=plate]:checked')].map((x) => x.value),
      lime: divisions.includes('lime') ? { m5: intOf('m5'), r5: intOf('r5'), s6: intOf('s6'), lv14: lv14 === 'yes' ? true : lv14 === 'no' ? false : null } : undefined,
      lemon: divisions.includes('lemon') ? { ap14: intOf('ap14'), ap14p: intOf('ap14p') } : undefined,
      custom: customAnswers(divisions),
    },
  };
  const need = (ok, msg) => { if (!ok) { setMsg(msg, 'err'); return true; } return false; };
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  const req = (k) => qMode(k) === 'required';
  const on = (k) => qMode(k) !== 'hidden';
  // 必須なら空欄不可、任意なら空欄可（入っていれば形式だけ確かめる）
  const okCount = (k, n) => (!on(k) || n === null ? !req(k) : isCount(n));
  const tag = (k) => qNo(`[data-q="${k}"]`) + '：';
  if (on('xId') && (v.xId || req('xId')) && need(/^[A-Za-z0-9_]{1,15}$/.test(v.xId), tag('xId') + 'X の ID は英数字と _ の15文字以内で入力してください')) return;
  if (!on('xId')) v.xId = '';
  if (req('discord') && need(v.answers.discord, tag('discord') + 'Discord で使用している名前を入力してください')) return;
  if (need(v.entryName, 'スコアタで使用する名前を入力してください')) return;
  if (need(divisions.length, '参加したい部門を1つ以上選んでください')) return;
  if (!on('rating')) v.rating = null;
  if (!on('frate')) v.frate = null;
  if (need(v.rating === null ? !req('rating') : Number.isInteger(v.rating), tag('rating') + '現在のレートを整数で入力してください')) return;
  if (need(v.frate === null ? !req('frate') : Number.isFinite(v.frate), tag('frate') + '2fRATE を入力してください')) return;
  const l = v.answers.lime, m = v.answers.lemon;
  if (l && need(okCount('m5', l.m5) && okCount('r5', l.r5) && okCount('s6', l.s6), '【らいむ部門】星5・星6の達成譜面数を0以上の整数で入力してください')) return;
  if (l && req('lv14') && need(l.lv14 !== null, '【らいむ部門】' + tag('lv14') + 'レベル14の希望を選んでください')) return;
  if (m && need(okCount('ap14', m.ap14) && okCount('ap14p', m.ap14p), '【れもん部門】AP 達成譜面数を0以上の整数で入力してください')) return;
  for (const c of FORM.custom) {
    if (!(c.id in v.answers.custom) || c.mode !== 'required') continue;
    const x = v.answers.custom[c.id];
    if (need(Array.isArray(x) ? x.length : x !== '', `${qNo(`[data-cq="${c.id}"]`)}：「${c.label}」に答えてください`)) return;
  }
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
    ['X', en.xId ? '@' + en.xId : '-'], ['Discord', a.discord || '-'], ['名前', en.entryName],
    ['部門', { html: (a.divisions || []).map((d) => divPill(d)).join(' ') || '-' }],
    ['レート', en.rating >= 0 ? en.rating : '-'], ['2fRATE', en.frate >= 0 ? Number(en.frate).toFixed(3) : '-'],
    ['神プレート', (a.plates || []).map((p) => p + '神').join(' ') || 'なし'],
  ];
  const nv = (x) => (x === null || x === undefined ? '-' : x);
  if (a.lime) rows.push([{ html: divPill('lime') }, `MAS星5 ${nv(a.lime.m5)}・Re:MAS星5 ${nv(a.lime.r5)}・星6 ${nv(a.lime.s6)}・Lv14 ${a.lime.lv14 === true ? '希望する' : a.lime.lv14 === false ? '希望しない' : '-'}`]);
  if (a.lemon) rows.push([{ html: divPill('lemon') }, `Lv14 AP ${nv(a.lemon.ap14)}・Lv14+ AP ${nv(a.lemon.ap14p)}`]);
  for (const c of FORM.custom) {
    const x = a.custom?.[c.id];
    if (x === undefined) continue;
    rows.push([c.label, Array.isArray(x) ? x.join('、') || '-' : x]);
  }
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
  box.append(el('p', 'note', '読み取れる画像：でらっくす NET のプレイ履歴（詳細）のスクリーンショット（BREAK まで読めて一番正確）、ゲーム機のリザルト画面の写真、ゲーム機の「大会リザルト」の写真（曲名で対象の曲を探します）。期間中は何度でも出し直せます（出し直すと承認待ちに戻ります）。'));
  const dl = ME.settings.resultDeadline;
  const closed = dl && Date.now() > Date.parse(dl + ':00+09:00');
  const facts = el('dl', 'facts');
  facts.innerHTML = `<dt>提出の締切</dt><dd>${dl ? esc(fmtDeadline(dl)) : '運営が締め切るまで'}${closed ? '　<b>（終了しました）</b>' : ''}</dd>`;
  box.append(facts);
  if (closed) box.append(el('p', 'warn', 'リザルトの提出期間は終了しました。提出されていない曲は「未提出」として扱われます。'));
  if (!closed) box.append(bulkForm(m, metric));
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

// 大会リザルト1枚で、複数の対戦曲をまとめて提出する
// 画像からは TRACK ごとの達成率（とでらっくスコア）だけを読み、どの TRACK がどの対戦曲かは本人が選ぶ
function bulkForm(m, metric) {
  const wrap = el('details', 'rcard bulk');
  wrap.append(el('summary', '', '大会リザルト1枚で、複数の曲をまとめて提出する'));
  const body = el('div', 'rform');
  wrap.append(body);
  const finals = myFinals(m).filter((f) => f.key && f.slot >= 0);
  const name = (f) => charts?.byKey.get(f.key)?.name || String(f.key).split('|')[0];
  body.append(el('p', 'note', 'ゲーム機の「大会リザルト」の写真から、TRACK ごとの達成率を読み取ります。それぞれの TRACK がどの対戦曲かを選ぶと、曲ごとの値が下に入ります。同じ曲を2回遊んだときは、スコアの高い方を使います。'));
  const file = el('input'); file.type = 'file'; file.accept = 'image/*';
  const pick = el('label', 'filebtn'); pick.append(el('span', '', '大会リザルトの画像を選ぶ'), file);
  const prev = el('img', 'rprev'); prev.alt = '選んだ画像'; prev.hidden = true;
  const note = el('p', 'note', '');
  const trackBox = el('div', 'bulkrows');
  const songBox = el('div', 'bulkrows');
  const send = el('button', 'primary', 'チェックした曲を提出'); send.type = 'button'; send.disabled = true;
  const btns = el('div', 'btns'); btns.append(send);
  body.append(pick, prev, note, trackBox, songBox, btns);
  let image = '', tracks = [], assign = [], songUI = [];
  const key = (t) => (metric === 'dx' ? t.dx ?? -1 : Number(t.ach));

  // TRACK の割り当てから、曲ごとの値を作り直す
  function renderSongs() {
    songBox.replaceChildren(); songUI = [];
    if (!tracks.length) return;
    songBox.append(el('h3', 'bulkh', '提出する値'));
    finals.forEach((f, i) => {
      const mine = tracks.filter((t, k) => assign[k] === i);
      const best = mine.sort((a, b) => key(b) - key(a))[0] || null;
      const row = el('div', 'bulkrow');
      const chk = el('input'); chk.type = 'checkbox'; chk.checked = !!best;
      const head = el('label', 'bulkhead'); head.append(chk, el('span', '', `${f.label}：${name(f)}`));
      const inp = (ph, v) => { const x = el('input'); x.type = 'text'; x.inputMode = 'decimal'; x.placeholder = ph; x.value = v ?? ''; return x; };
      const iAch = inp('達成率', best?.ach), iDx = inp('DXスコア', best?.dx), iMax = inp('MAX', ''), iBrk = inp('CP以外のBREAK', '');
      const vals = el('div', 'rinputs');
      if (metric === 'dx') vals.append(iDx, document.createTextNode(' / '), iMax, document.createTextNode('　BREAK '), iBrk); else vals.append(iAch, document.createTextNode(' %'));
      const src = best ? `TRACK ${best.track} の値${mine.length > 1 ? `（${mine.length} 回のうちスコアの高い方）` : ''}` : 'TRACK が選ばれていません';
      row.append(head, vals, el('p', 'note', src));
      songBox.append(row);
      songUI.push({ f, chk, iAch, iDx, iMax, iBrk });
    });
    send.disabled = !songUI.some((x) => x.chk.checked);
    songUI.forEach((x) => { x.chk.onchange = () => { send.disabled = !songUI.some((y) => y.chk.checked); }; });
  }

  file.onchange = async () => {
    const fl = file.files?.[0]; if (!fl) return;
    send.disabled = true; trackBox.replaceChildren(); songBox.replaceChildren(); tracks = [];
    try {
      const { dataURL, canvas } = await compressImage(fl);
      image = dataURL; prev.src = dataURL; prev.hidden = false;
      note.textContent = '画像から達成率を読み取っています…';
      const res = await MoguOCR.readTracks(canvas, { metric });
      tracks = res.tracks;
      if (!tracks.length) { note.textContent = '達成率を読み取れませんでした。1曲ずつの「リザルトを提出」から出してください。'; return; }
      // TRACK の数が対戦曲と同じなら、上から順に対戦曲を当てておく（違っていたら選び直す）
      assign = tracks.map((_, k) => (tracks.length === finals.length ? k : ''));
      note.textContent = `${tracks.length} 曲ぶんの達成率を読み取りました。それぞれの TRACK がどの対戦曲かを選んでください${tracks.length === finals.length ? '（上から順に当てています）' : ''}。${metric === 'dx' ? 'MAX と BREAK の数は大会リザルトに出ないので入力してください。' : ''}`;
      trackBox.append(el('h3', 'bulkh', '読み取った TRACK'));
      tracks.forEach((t, k) => {
        const row = el('div', 'trackrow');
        const sel = el('select');
        sel.innerHTML = `<option value="">提出しない</option>` + finals.map((f, i) => `<option value="${i}"${assign[k] === i ? ' selected' : ''}>${esc(f.label)}：${esc(name(f))}</option>`).join('');
        sel.onchange = () => { assign[k] = sel.value === '' ? '' : Number(sel.value); renderSongs(); };
        row.append(el('span', 'trackval', `TRACK ${t.track}　${t.ach}%${t.dx != null ? `　DX ${t.dx}` : ''}`), sel);
        trackBox.append(row);
      });
      renderSongs();
    } catch (e) { note.textContent = image ? '値を読み取れませんでした。1曲ずつ提出してください。' : e.message; }
  };
  send.onclick = async () => {
    const todo = songUI.filter((x) => x.chk.checked);
    if (!todo.length) { setMsg('提出する曲にチェックを入れてください', 'err'); return; }
    send.disabled = true;
    try {
      for (const x of todo) {
        const b = { matchId: m.id, slot: x.f.slot, image };
        if (metric === 'dx') Object.assign(b, { dx: x.iDx.value, dxMax: x.iMax.value, brk: x.iBrk.value }); else b.ach = x.iAch.value;
        try { await api('api/me/result', { method: 'POST', key: token, body: b }); }
        catch (e) { throw new Error(`${x.f.label}：${e.message}`); }
      }
      setMsg(`${todo.length} 曲のリザルトを提出しました。運営の承認をお待ちください`, 'ok');
      await refresh();
    } catch (e) { setMsg(e.message, 'err'); send.disabled = false; }
  };
  return wrap;
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
  const tracks = el('div', 'btns tracks'); tracks.hidden = true;
  form.append(pick, prev, ocrNote, tracks, row, brkNote, btns);
  let image = '';
  file.onchange = async () => {
    const fl = file.files?.[0]; if (!fl) return;
    send.disabled = true;
    try {
      const { dataURL, canvas } = await compressImage(fl);
      image = dataURL; prev.src = dataURL; prev.hidden = false;
      send.disabled = false;
      ocrNote.textContent = '画像から値を読み取っています…（初回は少し時間がかかります）';
      const v = await MoguOCR.read(canvas, { metric, target: charts?.byKey.get(f.key)?.name || String(f.key).split('|')[0], names: charts ? [...new Set(charts.list.map((x) => x.name))] : [] });
      const fill = (x) => {
        if (metric === 'dx') { if (x.dx != null) iDx.value = x.dx; if (x.dxMax != null) iMax.value = x.dxMax; if (x.brk != null) iBrk.value = x.brk; }
        else if (x.ach != null) iAch.value = x.ach;
      };
      fill(v);
      // 大会リザルト：読み取った TRACK を並べ、違っていたら選び直せるようにする
      tracks.replaceChildren(); tracks.hidden = !v.choices?.length;
      for (const c of v.choices || []) {
        const b = el('button', c.track === v.picked ? 'primary' : '', `TRACK ${c.track}：${c.title ? c.title.slice(0, 18) + '　' : ''}${c.ach}%${c.dx != null ? `・DX ${c.dx}` : ''}`);
        b.type = 'button';
        b.onclick = () => {
          tracks.querySelectorAll('button').forEach((x) => x.classList.toggle('primary', x === b));
          if (metric === 'dx') { iDx.value = c.dx ?? ''; } else iAch.value = c.ach;
          ocrNote.textContent = `TRACK ${c.track} の値を入れました。画像と見比べてから提出してください。${metric === 'dx' ? 'MAX と BREAK の数は大会リザルトに出ないので入力してください。' : ''}`;
        };
        tracks.append(b);
      }
      const got = metric === 'dx' ? v.dx != null : v.ach != null;
      const missing = [];
      if (metric === 'dx' && v.dx != null) { if (v.dxMax == null) missing.push('でらっくスコアの MAX'); if (v.brk == null) missing.push('BREAK の数'); }
      ocrNote.textContent = v.note && !got ? v.note
        : got ? `${v.note ? v.note + ' ' : ''}読み取った値を入れました。画像と見比べて、違っていたら直してから提出してください。${missing.length ? `${missing.join('と')}は読み取れなかったので入力してください。` : ''}`
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
    const max = window.MOGU_DEMO ? 720 : 1600; // 送る画像の大きさ
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    let q = window.MOGU_DEMO ? 0.6 : 0.85, dataURL = cv.toDataURL('image/jpeg', q);
    while (dataURL.length > 1400000 && q > 0.4) { q -= 0.1; dataURL = cv.toDataURL('image/jpeg', q); }
    // 読み取りは、縮める前に近い大きさの画像で行う（小さいと数字を読み違えやすい）
    const k2 = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
    let ocrCv = cv;
    if (k2 > k) {
      ocrCv = document.createElement('canvas');
      ocrCv.width = Math.round(img.naturalWidth * k2); ocrCv.height = Math.round(img.naturalHeight * k2);
      ocrCv.getContext('2d').drawImage(img, 0, 0, ocrCv.width, ocrCv.height);
    }
    return { dataURL, canvas: ocrCv };
  } finally { URL.revokeObjectURL(url); }
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
