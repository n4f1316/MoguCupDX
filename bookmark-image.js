// もぐらたたきカップ 告知画像用ブックマーク
// maimaidx.jp のページの上で動き、運営ページでコピーした「画像用データ」から告知画像を作る。
// ジャケットは maimaidx.jp の画像をそのブラウザの中で描くだけで、どこにも送らない・置かない。
(() => {
  'use strict';
  const BASE = (document.currentScript && document.currentScript.src)
    ? new URL('.', document.currentScript.src).href
    : 'https://n4f1316.github.io/MoguCupDX/';
  const VERSION = '20261015h';
  const KINDS = [['pair', '組み合わせ発表'], ['reveal', '選曲公開'], ['final', 'BAN結果・対戦曲']];
  const KIND_NAME = { pair: '組み合わせ', reveal: '選曲公開', final: '対戦曲' };

  if (location.hostname !== 'maimaidx.jp') {
    alert('maimai でらっくす NET（https://maimaidx.jp/）を開いた状態で押してください。');
    return;
  }
  document.getElementById('mogu-img-host')?.remove();

  // フォント（画像の文字）と描画の処理を読み込む
  if (!document.getElementById('mogu-img-font')) {
    const font = document.createElement('link');
    font.id = 'mogu-img-font';
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;800&family=Zen+Kaku+Gothic+New:wght@400;700&family=JetBrains+Mono:wght@500&display=swap';
    document.head.appendChild(font);
  }
  window.MOGU_ASSETS = BASE;
  const drawReady = window.DrawKit ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.charset = 'utf-8';
    s.src = BASE + 'draw.js?v=' + VERSION;
    s.onload = res;
    s.onerror = () => rej(new Error('描画の処理を読み込めませんでした'));
    document.body.appendChild(s);
  });

  // 画面（maimaidx.jp の見た目と混ざらないよう Shadow DOM の中に作る）
  const host = document.createElement('div');
  host.id = 'mogu-img-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box}
  .bg{position:fixed;inset:0;background:rgba(31,45,61,.45);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:16px}
  .panel{width:min(980px,100%);background:#fff;color:#1f2d3d;border-radius:14px;padding:16px;display:grid;gap:12px;
    font:15px/1.6 "Zen Kaku Gothic New","Hiragino Sans","Noto Sans JP",sans-serif;box-shadow:0 10px 40px rgba(31,45,61,.25)}
  h1{margin:0;font:800 18px/1.4 "M PLUS Rounded 1c",sans-serif;color:#2a6fb8}
  .top{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  button,select{font:inherit;border:1.5px solid #d6e2ee;background:#fff;color:#1f2d3d;border-radius:999px;padding:6px 14px;cursor:pointer}
  select{border-radius:8px;max-width:100%}
  button.primary{background:#2a6fb8;border-color:#2a6fb8;color:#fff;font-weight:700}
  button[aria-pressed="true"]{border-color:#2a6fb8;box-shadow:inset 0 0 0 2px #2a6fb8;font-weight:700}
  textarea{width:100%;min-height:90px;font:12px/1.5 monospace;border:1.5px solid #d6e2ee;border-radius:8px;padding:8px;color:#1f2d3d;background:#f6f9fd}
  .note{font-size:13px;color:#5b6f86;margin:0}
  .msg{font-size:14px;margin:0;min-height:1.4em}
  .msg.err{color:#d93a49}.msg.ok{color:#2a6fb8}
  .out{border:1px solid #d6e2ee;border-radius:8px;overflow:hidden;background:#eef5fc}
  .out img{display:block;width:100%;height:auto}
  [hidden]{display:none!important}
</style>
<div class="bg">
  <div class="panel" role="dialog" aria-label="もぐらたたきカップ 告知画像">
    <div class="top"><h1>もぐらたたきカップ 告知画像</h1><button type="button" id="close">閉じる</button></div>
    <section id="step1" style="display:grid;gap:8px">
      <p class="note">運営ページの「告知画像」で「画像用データをコピー」を押してから、ここに貼り付けてください。</p>
      <textarea id="data" placeholder="ここに貼り付け（Ctrl+V）" aria-label="画像用データ"></textarea>
      <div class="row"><button type="button" class="primary" id="load">読み込む</button><button type="button" id="paste">クリップボードから読み込む</button></div>
    </section>
    <section id="step2" hidden style="display:grid;gap:10px">
      <div class="row" id="divs"></div>
      <div class="row" id="kinds"></div>
      <div class="row"><select id="match" aria-label="対象の試合"></select><button type="button" id="redo">データを貼り直す</button></div>
      <div class="row"><button type="button" class="primary" id="dlOne">表示中の画像を保存</button></div>
      <p class="note">画像を長押し（パソコンは右クリック）でも保存できます。</p>
      <div id="outs" style="display:grid;gap:10px"></div>
    </section>
    <p class="msg" id="msg" role="status" aria-live="polite"></p>
    <p class="note">非公式大会のツールです。ジャケット画像は maimaidx.jp の画像をこのブラウザの中で描いているだけで、外部には送りません。</p>
  </div>
</div>`;
  document.body.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const setMsg = (t, cls = '') => { $('msg').textContent = t; $('msg').className = 'msg ' + cls; };
  const close = () => { host.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('close').onclick = close;

  const cv = document.createElement('canvas');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // sets：[{ div, file, view }]。divSel：部門の番号 or 'both'。sel：'all' または '部門の番号:試合の番号'
  let sets = [], kind = 'reveal', divSel = 0, sel = 'all', seq = 0;

  function parse(text) {
    let d;
    try { d = JSON.parse(String(text).trim()); } catch { throw new Error('データの形が違います。運営ページで「画像用データをコピー」を押してから貼り付けてください'); }
    if (!d || d.app !== 'mogucup-image') throw new Error('もぐらたたきカップの画像用データではありません');
    const list = Array.isArray(d.sets) ? d.sets : d.view ? [{ file: d.file, view: d.view }] : [];
    if (!list.length || !list.every((x) => x && x.view && Array.isArray(x.view.matches))) throw new Error('もぐらたたきカップの画像用データではありません');
    return list;
  }
  async function useData(text) {
    try {
      sets = parse(text);
      await drawReady;
      $('step1').hidden = true; $('step2').hidden = false;
      divSel = sets.length > 1 ? 'both' : 0; sel = 'all';
      setMsg(sets.map((x) => `${x.view.badge || ''} ${x.view.matches.length}試合`).join('・') + ' を読み込みました', 'ok');
      buildControls();
      await render();
    } catch (e) { setMsg(e.message, 'err'); }
  }
  $('load').onclick = () => useData($('data').value);
  $('paste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); $('data').value = t; useData(t); }
    catch { setMsg('クリップボードを読めませんでした。上の欄に貼り付けて「読み込む」を押してください', 'err'); }
  };
  $('redo').onclick = () => { $('step1').hidden = false; $('step2').hidden = true; $('data').value = ''; $('data').focus(); setMsg(''); };

  const shownSets = () => (divSel === 'both' ? sets.map((_, i) => i) : [divSel]);
  function buildControls() {
    const total = sets.reduce((n, x) => n + x.view.matches.length, 0);
    $('divs').innerHTML = sets.map((x, i) => `<button type="button" data-d="${i}" aria-pressed="${divSel === i}">${esc(x.view.badge || '部門' + (i + 1))} ${x.view.matches.length}試合</button>`).join('')
      + (sets.length > 1 ? `<button type="button" data-d="both" aria-pressed="${divSel === 'both'}">両部門 ${total}試合</button>` : '');
    $('divs').onclick = (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      divSel = b.dataset.d === 'both' ? 'both' : +b.dataset.d;
      if (sel !== 'all') sel = '';
      buildControls(); render();
    };
    $('kinds').innerHTML = KINDS.map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${n}</button>`).join('');
    $('kinds').onclick = (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      kind = b.dataset.k;
      root.querySelectorAll('#kinds button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      render();
    };
    const many = shownSets().length > 1;
    const opts = shownSets().flatMap((si) => sets[si].view.matches.map((m, i) => ({
      v: `${si}:${i}`,
      t: `${many ? String(sets[si].view.badge || '').replace('部門', '') + '　' : ''}MATCH ${String(i + 1).padStart(2, '0')}　${m.aName} vs ${m.bName}`,
    })));
    if (sel !== 'all' && !opts.some((o) => o.v === sel)) sel = opts[0]?.v || 'all';
    $('match').innerHTML = `<option value="all">全試合（${opts.length}試合）</option>` + opts.map((o) => `<option value="${o.v}">${esc(o.t)}</option>`).join('');
    $('match').value = sel;
    $('match').onchange = (e) => { sel = e.target.value; render(); };
  }

  // いま表示する画像：[{ si, idx }]
  function targets() {
    const ss = shownSets();
    if (kind === 'pair') return ss.map((si) => ({ si, idx: 0 }));
    if (sel === 'all') return ss.flatMap((si) => sets[si].view.matches.map((_, idx) => ({ si, idx })));
    const [si, i] = sel.split(':').map(Number);
    return sets[si]?.view.matches[i] ? [{ si, idx: i }] : [];
  }
  function missingJackets(t) {
    if (kind === 'pair') return 0;
    const m = sets[t.si].view.matches[t.idx]; if (!m) return 0;
    const songs = [...m.aSongs, ...m.bSongs, ...(kind === 'final' ? m.finals.map((f) => f.s) : [])].filter(Boolean);
    return songs.filter((s) => !s.img).length;
  }
  async function render() {
    $('match').hidden = kind === 'pair';
    const my = ++seq;
    const ts = targets();
    const outs = $('outs');
    outs.innerHTML = ts.length ? '' : '<p class="note">対戦カードがありません</p>';
    let miss = 0;
    for (const t of ts) {
      await window.DrawKit.render(cv, sets[t.si].view, kind, t.idx);
      if (my !== seq) return;
      const box = document.createElement('div');
      box.className = 'out';
      const img = document.createElement('img');
      img.alt = fileName(t, kind);
      try { img.src = cv.toDataURL('image/png'); } catch {
        setMsg('画像を書き出せませんでした。ページを再読み込みしてから、もう一度ブックマークを押してください', 'err');
        return;
      }
      box.appendChild(img); outs.appendChild(box);
      miss += missingJackets(t);
    }
    $('dlOne').textContent = ts.length > 1 ? `表示中の画像を保存（${ts.length}枚）` : 'この画像を保存';
    $('dlOne').disabled = !ts.length;
    if (miss) setMsg(`ジャケットが決まらない譜面が ${miss} 件あります（同名曲など）。「?」の枠で描いています`, '');
  }

  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]/g, '_');
  const fileName = (t, k) => `${safe(sets[t.si].file || 'mogucup')}_${KIND_NAME[k]}${k === 'pair' ? '' : '_M' + String(t.idx + 1).padStart(2, '0')}.png`;
  async function download(t, k) {
    await window.DrawKit.render(cv, sets[t.si].view, k, t.idx);
    const blob = await new Promise((r) => { try { cv.toBlob(r, 'image/png'); } catch { r(null); } });
    if (!blob) throw new Error('画像を書き出せませんでした');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName(t, k);
    root.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('dlOne').onclick = async () => {
    const ts = targets();
    try {
      for (const t of ts) { await download(t, kind); await new Promise((r) => setTimeout(r, 300)); }
      setMsg(`${ts.length} 枚保存しました`, 'ok');
    } catch (e) { setMsg(e.message, 'err'); }
  };
  $('data').focus();
})();
