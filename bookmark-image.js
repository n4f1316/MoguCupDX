// もぐらたたきカップ 告知画像用ブックマーク
// maimaidx.jp のページの上で動き、運営ページでコピーした「画像用データ」から告知画像を作る。
// ジャケットは maimaidx.jp の画像をそのブラウザの中で描くだけで、どこにも送らない・置かない。
(() => {
  'use strict';
  const BASE = (document.currentScript && document.currentScript.src)
    ? new URL('.', document.currentScript.src).href
    : 'https://n4f1316.github.io/MoguCupDX/';
  const VERSION = '20261015e';
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
      <div class="row" id="kinds"></div>
      <div class="row"><select id="match" aria-label="対象の試合"></select><button type="button" id="redo">データを貼り直す</button></div>
      <div class="out"><img id="out" alt="告知画像"></div>
      <div class="row"><button type="button" class="primary" id="dlOne">この画像を保存</button><button type="button" id="dlAll">全試合ぶん保存</button></div>
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
  let data = null, kind = 'reveal', idx = 0, seq = 0;

  function parse(text) {
    let d;
    try { d = JSON.parse(String(text).trim()); } catch { throw new Error('データの形が違います。運営ページで「画像用データをコピー」を押してから貼り付けてください'); }
    if (!d || d.app !== 'mogucup-image' || !d.view || !Array.isArray(d.view.matches)) throw new Error('もぐらたたきカップの画像用データではありません');
    return d;
  }
  async function useData(text) {
    try {
      data = parse(text);
      await drawReady;
      $('step1').hidden = true; $('step2').hidden = false;
      const n = data.view.matches.length;
      setMsg(`${data.view.badge || ''}　${n} 試合を読み込みました`, 'ok');
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

  function buildControls() {
    $('kinds').innerHTML = KINDS.map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${n}</button>`).join('');
    $('kinds').onclick = (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      kind = b.dataset.k;
      root.querySelectorAll('#kinds button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      render();
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    $('match').innerHTML = data.view.matches.map((m, i) => `<option value="${i}">MATCH ${String(i + 1).padStart(2, '0')}　${esc(m.aName)} vs ${esc(m.bName)}</option>`).join('');
    idx = Math.min(idx, Math.max(0, data.view.matches.length - 1));
    $('match').value = String(idx);
    $('match').onchange = (e) => { idx = +e.target.value; render(); };
  }

  function missingJackets(k, i) {
    if (k === 'pair') return 0;
    const m = data.view.matches[i]; if (!m) return 0;
    const songs = [...m.aSongs, ...m.bSongs, ...(k === 'final' ? m.finals.map((f) => f.s) : [])].filter(Boolean);
    return songs.filter((s) => !s.img).length;
  }
  async function render() {
    const per = kind !== 'pair';
    $('match').hidden = !per;
    $('dlAll').hidden = !per || data.view.matches.length < 2;
    const my = ++seq;
    await window.DrawKit.render(cv, data.view, kind, idx);
    if (my !== seq) return;
    try {
      $('out').src = cv.toDataURL('image/png');
      const miss = missingJackets(kind, idx);
      if (miss) setMsg(`ジャケットが決まらない譜面が ${miss} 件あります（同名曲など）。「?」の枠で描いています`, '');
    } catch {
      setMsg('画像を書き出せませんでした。ページを再読み込みしてから、もう一度ブックマークを押してください', 'err');
    }
  }

  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]/g, '_');
  const fileName = (k, i) => `${safe(data.file || 'mogucup')}_${KIND_NAME[k]}${k === 'pair' ? '' : '_M' + String(i + 1).padStart(2, '0')}.png`;
  async function download(k, i) {
    await window.DrawKit.render(cv, data.view, k, i);
    const blob = await new Promise((r) => { try { cv.toBlob(r, 'image/png'); } catch { r(null); } });
    if (!blob) throw new Error('画像を書き出せませんでした');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName(k, i);
    root.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('dlOne').onclick = async () => {
    try { await download(kind, idx); setMsg('保存しました', 'ok'); } catch (e) { setMsg(e.message, 'err'); }
    render();
  };
  $('dlAll').onclick = async () => {
    const n = data.view.matches.length;
    try {
      for (let i = 0; i < n; i++) { await download(kind, i); await new Promise((r) => setTimeout(r, 300)); }
      setMsg(`${n} 枚保存しました`, 'ok');
    } catch (e) { setMsg(e.message, 'err'); }
    render();
  };
  $('data').focus();
})();
