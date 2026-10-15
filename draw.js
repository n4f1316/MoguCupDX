// 告知画像の描画（canvas）。画像そのものは常に同じ配色（青みのある白＋青）
// 運営ページ（プレビュー、ジャケットなし）と、maimaidx.jp 上で動く告知画像用ブックマーク（ジャケットあり）の両方で使う。
// ブックマークでは common.js を読まないので、必要な値はここに持つ。
var DrawKit = window.DrawKit || (() => {
  // 難易度・種別の色と略称は 2fRATE と同じ
  const DIFF_COLOR = { BASIC: '#2E9E5B', ADVANCED: '#D98E04', EXPERT: '#E0434B', MASTER: '#8E44D6', 'Re:MASTER': '#B68BE0' };
  const DIFF_SHORT = { BASIC: 'BAS', ADVANCED: 'ADV', EXPERT: 'EXP', MASTER: 'MAS', 'Re:MASTER': 'Re:MAS' };
  const fmtConst = (c) => (Math.round(c * 10) / 10).toFixed(1);
  const C = { bg1: '#f6f9fd', bg2: '#e4eef8', hole: 'rgba(42,111,184,.06)', card: '#ffffff', card2: '#eef5fc', fg: '#1f2d3d', mute: '#5b6f86', accent: '#2a6fb8', ban: '#d93a49', gold: '#f0b429', goldText: '#9a6400', jk: '#dbe7f3', line: '#d6e2ee', onAccent: '#ffffff' };
  const FD = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif';
  const FB = '"Zen Kaku Gothic New","Hiragino Sans","Noto Sans JP",sans-serif';
  const FM = '"JetBrains Mono",monospace';
  const W = 1600;
  let cv, ctx, V, logo = null;
  const LOGO_URL = (window.MOGU_ASSETS || '') + 'logo3rd.svg?v=1';

  const imgCache = new Map();
  // cors：true なら CORS 付きで読む（canvas を保存できる）。false は表示専用（保存できなくなる）
  function loadImg(url, cors = true) {
    if (!url) return Promise.resolve(null);
    const key = (cors ? 'c:' : 'p:') + url;
    if (!imgCache.has(key)) {
      imgCache.set(key, new Promise((res) => {
        const im = new Image();
        if (cors) im.crossOrigin = 'anonymous';
        else im.referrerPolicy = 'no-referrer'; // 表示用：参照元を送らない（直接開いたときと同じ形で読む）
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = url;
      }));
    }
    return imgCache.get(key);
  }

  // ジャケット
  //   maimaidx.jp 上（告知画像用ブックマーク）：同じサイトの画像なので、描いてそのまま保存できる
  //   運営ページのプレビュー（opt.preview）：公式の画像を表示用に読む。この canvas は保存できない
  //   それ以外：「?」の枠。画像はこちらでは保存・公開しない
  const ON_OFFICIAL = location.hostname === 'maimaidx.jp';
  const OFFICIAL = 'https://maimaidx.jp/maimai-mobile/img/Music/';
  async function loadJacket(img, preview) {
    if (!img) return null;
    if (ON_OFFICIAL) return loadImg('/maimai-mobile/img/Music/' + img);
    if (!preview) return null;
    // 公式 → 少し待って読み直し → Worker の表示用の中継
    const tries = [OFFICIAL + img, OFFICIAL + img + '?r=1', ...(window.MOGU_JACKET ? [window.MOGU_JACKET + img] : [])];
    for (let i = 0; i < tries.length; i++) {
      if (i === 1) await new Promise((r) => setTimeout(r, 400));
      const im = await loadImg(tries[i], false);
      if (im) return im;
    }
    return null;
  }

  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function fit(text, x, y, maxW, size, weight, font, align = 'left', color = C.fg) {
    let s = size;
    ctx.font = `${weight} ${s}px ${font}`;
    while (ctx.measureText(text).width > maxW && s > 14) { s -= 1; ctx.font = `${weight} ${s}px ${font}`; }
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y);
  }
  // 画像の一番下に、権利表記の帯（高さ CREDIT_H）を足す
  const CREDIT_H = 52;
  const CREDIT = '本大会は有志による非公式大会です。楽曲・ジャケット画像の著作権は、株式会社セガおよび各権利者に帰属します。';
  function base(h, heading) {
    cv.width = W; cv.height = h + CREDIT_H;
    ctx.fillStyle = C.bg1; ctx.fillRect(0, 0, W, h + CREDIT_H);
    ctx.fillStyle = C.bg2; ctx.fillRect(0, h, W, CREDIT_H);
    ctx.textBaseline = 'alphabetic';
    fit(CREDIT, W / 2, h + 33, W - 160, 20, 500, FB, 'center', C.mute);
    // 大会アイコンを薄く（85% 透過）背景に敷く
    if (logo) {
      const size = Math.min(h - 60, 920);
      ctx.save(); ctx.globalAlpha = 0.15;
      ctx.drawImage(logo, (W - size) / 2, (h - size) / 2, size, size);
      ctx.restore();
    }
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 10);
    ctx.textBaseline = 'alphabetic';
    fit(V.title || 'もぐらたたきカップ', 80, 92, 1000, 34, 800, FD, 'left', C.mute);
    fit(heading, 80, 170, 1000, 72, 800, FD, 'left', C.fg);
    if (V.badge) { // 右上の丸いラベル：部門名
      ctx.font = `800 34px ${FD}`;
      const tw = Math.min(ctx.measureText(V.badge).width + 56, 420);
      rr(W - 80 - tw, 112, tw, 64, 32); ctx.fillStyle = V.badgeColor || C.accent; ctx.fill();
      fit(V.badge, W - 80 - tw / 2, 156, tw - 40, 34, 800, FD, 'center', V.badgeColor ? C.fg : C.onAccent);
    }
    ctx.fillStyle = C.mute; ctx.globalAlpha = 0.35; ctx.fillRect(80, 206, W - 160, 2); ctx.globalAlpha = 1;
  }
  // 左下に運営の一言（権利表記は一番下の帯）
  function footer(h, text) { if (text) fit(text, 80, h - 34, W - 160, 26, 700, FB, 'left', C.mute); }
  const label = (n) => 'MATCH ' + String(n).padStart(2, '0');

  // 譜面カード（ジャケット・難易度・定数・曲名）
  // 2fRATE と同じ形のチップ：[MAS] [ST] [13.7]
  function chips(s, x, y, room) {
    const items = [
      { t: DIFF_SHORT[s.diff] || s.diff, bg: s.diff === 'Re:MASTER' ? '#ffffff' : DIFF_COLOR[s.diff] || C.mute, fg: s.diff === 'Re:MASTER' ? '#8E44D6' : '#ffffff', border: s.diff === 'Re:MASTER' ? '#B68BE0' : null },
      { t: s.kind, bg: s.kind === 'DX' ? 'dx' : '#3B82C4', fg: '#ffffff' },
      { t: fmtConst(s.c), bg: '#EFECF9', fg: C.fg },
    ];
    let fs = 22;
    const pad = () => Math.round(fs * 0.45), gap = () => Math.round(fs * 0.3);
    const widths = () => items.map((it) => { ctx.font = `800 ${fs}px ${FM}`; return ctx.measureText(it.t).width + pad() * 2; });
    let ws = widths();
    while (ws.reduce((a, b) => a + b, 0) + gap() * 2 > room && fs > 14) { fs--; ws = widths(); }
    const h = Math.round(fs * 1.5);
    let cx = x;
    items.forEach((it, i) => {
      rr(cx, y, ws[i], h, 7);
      if (it.bg === 'dx') { const g = ctx.createLinearGradient(cx, 0, cx + ws[i], 0); g.addColorStop(0, '#E0348C'); g.addColorStop(1, '#F29A2E'); ctx.fillStyle = g; } else ctx.fillStyle = it.bg;
      ctx.fill();
      if (it.border) { ctx.lineWidth = 2; ctx.strokeStyle = it.border; ctx.stroke(); }
      ctx.font = `800 ${fs}px ${FM}`; ctx.fillStyle = it.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.t, cx + ws[i] / 2, y + h / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      cx += ws[i] + gap();
    });
  }

  // 文字列を幅 maxW で折り返す（英単語の途中ではなるべく切らない）
  function wrap(text, maxW) {
    const tokens = String(text).match(/[A-Za-z0-9'’.,!?&:;()\[\]-]+\s*|\s+|./gu) || [];
    const lines = [];
    let cur = '';
    for (const tk of tokens) {
      if (ctx.measureText(cur + tk).width <= maxW) { cur += tk; continue; }
      if (cur.trim()) { lines.push(cur.trimEnd()); cur = ''; }
      if (ctx.measureText(tk).width <= maxW) { cur = tk.trimStart(); continue; }
      for (const ch of tk) { // 1語が長すぎるときは文字の途中で切る
        if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ''; }
        cur += ch;
      }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
  }
  function title(text, x, top, maxW, maxH, color) {
    let fs = 36, lines;
    for (; fs >= 16; fs--) {
      ctx.font = `700 ${fs}px ${FB}`;
      lines = wrap(text, maxW);
      if (lines.length * fs * 1.22 <= maxH) break;
    }
    const lh = fs * 1.22;
    const maxLines = Math.max(1, Math.floor(maxH / lh));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '…';
    }
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // 縦方向は残りの高さの中で下寄せ（1行のときはこれまでと同じ位置）
    const y0 = top + maxH - lines.length * lh + fs * 0.95;
    lines.forEach((ln, i) => ctx.fillText(ln, x, y0 + i * lh));
  }

  function songCard(s, x, y, w, h, opt = {}) {
    rr(x, y, w, h, 14); ctx.fillStyle = opt.hi ? C.card2 : C.card; ctx.fill();
    if (opt.hi) { ctx.lineWidth = 4; ctx.strokeStyle = C.gold; ctx.stroke(); } else { ctx.lineWidth = 1.5; ctx.strokeStyle = C.line; ctx.stroke(); }
    const dc = s ? DIFF_COLOR[s.diff] || C.mute : C.mute;
    ctx.save(); rr(x, y, w, h, 14); ctx.clip(); ctx.fillStyle = dc; ctx.fillRect(x, y, 12, h); ctx.restore();
    const js = h - 24, jx = x + 26, jy = y + 12;
    ctx.save(); rr(jx, jy, js, js, 8); ctx.clip();
    ctx.fillStyle = C.jk; ctx.fillRect(jx, jy, js, js);
    const im = s && opt.img;
    if (im) ctx.drawImage(im, jx, jy, js, js);
    else { ctx.font = `800 ${js * 0.3}px ${FD}`; ctx.fillStyle = C.mute; ctx.textAlign = 'center'; ctx.fillText('?', jx + js / 2, jy + js * 0.62); }
    ctx.restore();
    const tx = jx + js + 22, tw = x + w - tx - 20;
    if (s) chips(s, tx, y + 14, tw - (opt.tag ? 150 : 0));
    if (opt.tag) {
      ctx.font = `800 22px ${FD}`;
      const tgw = ctx.measureText(opt.tag).width + 28;
      rr(x + w - tgw - 16, y + 14, tgw, 36, 18); ctx.fillStyle = C.gold; ctx.fill();
      ctx.fillStyle = C.fg; ctx.textAlign = 'center'; ctx.fillText(opt.tag, x + w - 16 - tgw / 2, y + 40);
    }
    // 曲名：長いときは折り返して複数行にする（入りきらなければ文字を小さくする）
    title(s ? s.name : (opt.empty || '（未入力）'), tx, y + 60, tw, y + h - 12 - (y + 60), s ? C.fg : C.mute);
    if (opt.ban) {
      ctx.fillStyle = 'rgba(246,249,253,.72)'; rr(x, y, w, h, 14); ctx.fill();
      ctx.strokeStyle = C.ban; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x + 30, y + h / 2 + 6); ctx.lineTo(x + w - 30, y + h / 2 - 6); ctx.stroke();
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.08);
      ctx.font = `800 46px ${FD}`;
      const bw = ctx.measureText('BAN').width + 44;
      rr(-bw / 2, -34, bw, 68, 10); ctx.fillStyle = C.ban; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('BAN', 0, 17); ctx.restore();
    }
  }

  function drawPair() {
    const n = V.matches.length, rowH = 104, gap = 18;
    const h = 260 + Math.max(1, n) * (rowH + gap) + 70;
    base(h, '対戦組み合わせ');
    V.matches.forEach((m, i) => {
      const y = 250 + i * (rowH + gap);
      rr(80, y, W - 160, rowH, 16); ctx.fillStyle = C.card; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.font = `500 24px ${FM}`; ctx.fillStyle = C.accent; ctx.textAlign = 'left'; ctx.fillText(label(i + 1), 116, y + 62);
      fit(m.aName, W / 2 - 90, y + 68, 520, 48, 800, FD, 'right');
      fit(m.bName, W / 2 + 90, y + 68, 520, 48, 800, FD, 'left');
      ctx.font = `800 40px ${FD}`; ctx.fillStyle = C.accent; ctx.textAlign = 'center'; ctx.fillText('VS', W / 2, y + 66);
    });
    if (!n) fit('対戦カードがまだありません', W / 2, 320, 800, 36, 700, FB, 'center', C.mute);
    footer(h, V.notes.pair);
  }

  function columns(m, mode, imgs) {
    const colW = (W - 160 - 110) / 2, cardH = 132, top = 290;
    [['a', 80], ['b', 80 + colW + 110]].forEach(([sd, x]) => {
      const songs = m[sd + 'Songs'], ban = m[sd + 'Ban'], pick = m[sd + 'Pick'];
      ctx.font = `500 22px ${FM}`; ctx.fillStyle = C.mute; ctx.textAlign = 'left';
      ctx.fillText(sd === 'a' ? 'PLAYER A' : 'PLAYER B', x, top - 50);
      fit(m[sd + 'Name'] + ' の自選曲', x, top - 12, colW, 40, 800, FD, 'left');
      songs.forEach((s, i) => {
        const o = { img: s && imgs.get(s.key) };
        if (mode === 'final' || mode === 'ban') { if (ban === i) o.ban = true; }
        if (mode === 'final' && pick === i) { o.hi = true; o.tag = '自選曲'; }
        songCard(s, x, top + 18 + i * (cardH + 16), colW, cardH, o);
      });
    });
    ctx.font = `800 56px ${FD}`; ctx.fillStyle = C.accent; ctx.textAlign = 'center';
    ctx.fillText('VS', W / 2, top + 18 + (cardH * 3 + 32) / 2 + 20);
    if (m.cap != null) fit(`上限 定数${fmtConst(Number(m.cap))}${m.lv14 ? '＋Lv14 1曲' : ''}`, W - 80, top - 50, 520, 22, 500, FM, 'right', m.lv14 ? C.goldText : C.mute);
    return top + 18 + 3 * (cardH + 16);
  }

  function drawReveal(m, i, imgs) {
    const h = 960;
    base(h, `選曲公開　${label(i + 1)}`);
    const y = columns(m, 'reveal', imgs);
    rr(80, y + 20, W - 160, 96, 16); ctx.fillStyle = C.card2; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent; ctx.stroke();
    fit('相手の自選曲から1曲をBANしてください', W / 2, y + 82, W - 240, 38, 800, FD, 'center', C.accent);
    footer(h, V.notes.reveal);
  }

  // BAN結果：両者の BAN だけを見せる（自選曲はまだ決まっていない段階）
  function drawBan(m, i, imgs) {
    const h = 960;
    base(h, `BAN結果　${label(i + 1)}`);
    const y = columns(m, 'ban', imgs);
    rr(80, y + 20, W - 160, 96, 16); ctx.fillStyle = C.card2; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent; ctx.stroke();
    fit('BANされなかった2曲から自選曲を1曲選んでください', W / 2, y + 82, W - 240, 38, 800, FD, 'center', C.accent);
    footer(h, V.notes.ban);
  }

  function drawFinal(m, i, imgs) {
    const h = 1210;
    base(h, `対戦曲決定　${label(i + 1)}`);
    const y = columns(m, 'final', imgs) + 20;
    ctx.fillStyle = C.mute; ctx.globalAlpha = 0.35; ctx.fillRect(80, y, W - 160, 2); ctx.globalAlpha = 1;
    fit('対戦曲', 80, y + 60, 400, 40, 800, FD, 'left', C.fg);
    const n = m.finals.length, ch = 170, cy = y + 124;
    const cw = (W - 160 - 20 * (n - 1)) / n;
    m.finals.forEach((f, k) => {
      const x = 80 + k * (cw + 20);
      fit(f.label, x + 4, cy - 8, cw - 8, 24, 700, FB, 'left', f.kind === 'kadai' ? C.accent : f.kind === 'both' ? C.goldText : C.mute);
      songCard(f.s, x, cy + 6, cw, ch, { hi: !!f.s, img: f.s && imgs.get(f.s.key), empty: '未定' });
    });
    footer(h, V.notes.final);
  }

  // view: { title, badge, notes, matches:[{ aName, bName, aSongs, bSongs, aBan, aPick, bBan, bPick, cap, finals:[{ s, label, kind }] }] }
  // 描画は1枚ずつ順番に行う（同時に呼ばれても描き先が混ざらないように）
  let queue = Promise.resolve();
  function render(canvas, view, kind, idx, opt = {}) {
    const job = queue.then(() => renderOne(canvas, view, kind, idx, opt));
    queue = job.catch(() => {});
    return job;
  }
  async function renderOne(canvas, view, kind, idx, opt) {
    cv = canvas; ctx = cv.getContext('2d'); V = view;
    if (!logo) logo = await loadImg(LOGO_URL);
    await Promise.all([`800 40px ${FD}`, `700 40px ${FB}`, `500 22px ${FM}`].map((f) => document.fonts.load(f, 'もぐらA'))).catch(() => {});
    if (kind === 'pair') { drawPair(); return; }
    const m = V.matches[idx];
    if (!m) { base(400, '対戦カードがありません'); return; }
    const charts = [...m.aSongs, ...m.bSongs, ...(kind === 'final' ? m.finals.map((f) => f.s) : [])].filter(Boolean);
    const imgs = new Map();
    await Promise.all(charts.map(async (s) => imgs.set(s.key, await loadJacket(s.img, opt.preview))));
    if (kind === 'reveal') drawReveal(m, idx, imgs); else if (kind === 'ban') drawBan(m, idx, imgs); else drawFinal(m, idx, imgs);
  }
  return { render };
})();
