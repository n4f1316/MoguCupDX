// Worker を公開したら、表示された URL に書き換えてください（末尾の / を付ける）
window.MOGU_API = 'https://mogucupdx.want131611.workers.dev/';
// 曲名・ジャケット・譜面定数のデータ（2fRATE と共用。同じ github.io なのでそのまま読める）
window.MOGU_DATA = '/dxscore-tools/';
// ジャケットを直接読めないとき（スマホなど）の表示用の中継（デモのときも本番の Worker を使う）
window.MOGU_JACKET = window.MOGU_API + 'jacket/';

// ---------- デモモード（URL の末尾に ?demo=1） ----------
// 本物の Worker のコードをブラウザの中だけで動かす。サーバーには何も送らない
window.MOGU_DEMO = /[?&]demo(=|&|$)/.test(location.search);
if (window.MOGU_DEMO) {
  window.MOGU_API = 'https://demo.mogucup.invalid/';
  try { sessionStorage.setItem('mogucupdx-demo-admin-key', 'demo'); } catch (e) {}
  // デモの準備ができるまで API への通信を待たせ、できたらブラウザ内の Worker に渡す
  window.__demoReady = new Promise((r) => { window.__demoResolve = r; });
  window.__origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(window.MOGU_API)) return (await window.__demoReady)(input, init);
    return window.__origFetch(input, init);
  };
  document.write('<script type="module" src="demo/demo.js?v=demo7"><\/script>');
}
