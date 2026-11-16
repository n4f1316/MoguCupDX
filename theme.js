/* 表示（ライト／ダーク）の切り替え。各ページの <head> で common.css のすぐあとに読み込む。
   - 選んだ表示はブラウザに保存する。2fRATE と同じ名前で保存するので、2fRATE で選んだ表示がこちらにも反映される
   - まだ選んでいないときはライト
   - ページ内の class="theme-toggle" のボタンが切り替えボタンになる */
// 背景に大会ロゴを入れるか：'off'（入れない）／'corner'（右下に小さく）／'center'（中央に大きく）
// 試すだけなら、ページの URL の末尾に ?logo=corner や ?logo=center を付けると、その表示だけ切り替わる
const BG_LOGO = 'center';
(() => {
  'use strict';
  try {
    const q = new URLSearchParams(location.search).get('logo');
    const v = ['off', 'corner', 'center'].includes(q) ? q : BG_LOGO;
    if (v !== 'off') document.documentElement.dataset.bglogo = v;
  } catch { /* 取れなければロゴなし */ }
  const KEY = '2frate-theme';
  const root = document.documentElement;
  const load = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
  const label = () => (current() === 'dark' ? '表示：ダーク' : '表示：ライト');
  const paint = () => document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.textContent = label();
    b.setAttribute('aria-label', `${label()}（押すと切り替え）`);
  });
  const apply = (theme) => { root.dataset.theme = theme; paint(); };
  apply(load() === 'dark' ? 'dark' : 'light');
  const wire = () => {
    document.querySelectorAll('.theme-toggle').forEach((b) => {
      b.type = 'button';
      b.onclick = () => {
        const next = current() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(KEY, next); } catch { /* 保存できない環境では、このページの間だけ切り替える */ }
        apply(next);
      };
    });
    paint();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
