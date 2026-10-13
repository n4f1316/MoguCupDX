// もぐらたたきカップ 参加者ページ
const $ = (s, r = document) => r.querySelector(s);
const TOKEN_STORE = 'mogucupdx-session';
const PHASE_LABEL = { closed: '組み合わせ発表前', select: '自選曲の提出', ban: 'BAN', pick: '自選曲の決定', done: '対戦曲確定' };
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
$('#divChecks').innerHTML = DIVISIONS.map((d) => `<label><input type="checkbox" name="div" value="${d.id}">${d.name}</label>`).join('');
$('#plateChecks').innerHTML = PLATES.map((p) => `<label><input type="checkbox" name="plate" value="${p}">${p}神</label>`).join('');
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
  if (need($('#rating').value !== '' && Number.isInteger(v.rating), 'Q5：レートを整数で入力してください')) return;
  if (need($('#frate').value !== '' && Number.isFinite(v.frate), '2fRATE を入力してください')) return;
  const l = v.answers.lime, m = v.answers.lemon;
  if (l && need(isCount(l.m5) && isCount(l.r5) && isCount(l.s6), '【らいむ部門】Q7〜Q9 を0以上の整数で入力してください')) return;
  if (l && need(l.lv14 !== null, '【らいむ部門】Q10 を選んでください')) return;
  if (m && need(isCount(m.ap14) && isCount(m.ap14p), '【れもん部門】Q11・Q12 を0以上の整数で入力してください')) return;
  if (v.website) return;
  const btn = $('#entryForm button[type=submit]'); btn.disabled = true;
  try {
    await api('api/entry', { method: 'POST', key: token, body: v });
    setMsg('参加申請を受け付けました', 'ok');
    await refresh();
  } catch (err) { setMsg(err.message, 'err'); }
  btn.disabled = false;
});

function entryFacts(en) {
  const a = en.answers || {};
  const rows = [
    ['X', '@' + en.xId], ['Discord', a.discord || '-'], ['名前', en.entryName],
    ['部門', (a.divisions || []).map(divName).join('・') || '-'],
    ['レート', en.rating], ['2fRATE', Number(en.frate).toFixed(3)],
    ['神プレート', (a.plates || []).map((p) => p + '神').join(' ') || 'なし'],
  ];
  if (a.lime) rows.push(['らいむ部門', `MAS星5 ${a.lime.m5}・Re:MAS星5 ${a.lime.r5}・星6 ${a.lime.s6}・Lv14 ${a.lime.lv14 ? '希望する' : '希望しない'}`]);
  if (a.lemon) rows.push(['れもん部門', `Lv14 AP ${a.lemon.ap14}・Lv14+ AP ${a.lemon.ap14p}`]);
  return rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
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
  box.append(el('h2', '', `${m.divName ? m.divName + '　' : ''}MATCH ${String(m.no).padStart(2, '0')}`));
  const vs = el('div', 'vs');
  vs.append(el('div', 'nm', ME.entry.entryName), el('div', 'v', 'VS'), el('div', 'nm', m.opponent ? m.opponent.entryName : '（相手未定）'));
  box.append(vs);
  const facts = el('dl', 'facts');
  facts.innerHTML = `<dt>自選曲の上限</dt><dd>譜面定数 <b>${fmtConst(Number(m.cap))}</b> 以下${m.lv14 ? '<span class="lv14">Lv14 解禁：上限を超えるレベル14を1曲まで</span>' : ''}</dd>${m.opponent ? `<dt>相手の X</dt><dd><a href="https://x.com/${encodeURIComponent(m.opponent.xId)}" target="_blank" rel="noopener">@${esc(m.opponent.xId)}</a></dd>` : ''}`;
  box.append(facts);
  if (m.kadai && phase !== 'done') { box.append(el('div', 'slotno', '運営課題曲')); box.append(songEl(m.kadai)); }

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
  const pool = charts.list.filter((c) => selectable(c.c, m.cap, m.lv14) && c.key !== m.kadai);
  const levels = [...new Set(pool.map((c) => c.lv))].sort((a, b) => levelOrder(b) - levelOrder(a));
  if (browse.level !== 'all' && !levels.includes(browse.level)) browse.level = 'all';
  const overUsed = draft.some((k) => { const c = charts.byKey.get(k); return c && overCap(c.c, m.cap); });

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

refresh();
