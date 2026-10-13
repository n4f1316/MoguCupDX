// 告知画像の描画（canvas）。画像そのものは常に同じ配色（青みのある白＋青）
const DrawKit = (() => {
  const C = { bg1: '#f6f9fd', bg2: '#e4eef8', hole: 'rgba(42,111,184,.06)', card: '#ffffff', card2: '#eef5fc', fg: '#1f2d3d', mute: '#5b6f86', accent: '#2a6fb8', ban: '#d93a49', gold: '#f0b429', goldText: '#9a6400', jk: '#dbe7f3', line: '#d6e2ee', onAccent: '#ffffff' };
  const FD = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN",sans-serif';
  const FB = '"Zen Kaku Gothic New","Hiragino Sans","Noto Sans JP",sans-serif';
  const FM = '"JetBrains Mono",monospace';
  const W = 1600;
  let cv, ctx, V;

  const imgCache = new Map();
  function loadImg(url) {
    if (!url) return Promise.resolve(null);
    if (!imgCache.has(url)) {
      imgCache.set(url, new Promise((res) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = url;
      }));
    }
    return imgCache.get(url);
  }

  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function fit(text, x, y, maxW, size, weight, font, align = 'left', color = C.fg) {
    let s = size;
    ctx.font = `${weight} ${s}px ${font}`;
    while (ctx.measureText(text).width > maxW && s > 14) { s -= 1; ctx.font = `${weight} ${s}px ${font}`; }
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y);
  }
  function base(h, heading) {
    cv.width = W; cv.height = h;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
    ctx.fillStyle = C.hole; // もぐらの穴
    for (let y = 60; y < h; y += 150) for (let x = (y / 150) % 2 ? 40 : 115; x < W; x += 150) { ctx.beginPath(); ctx.ellipse(x, y, 46, 16, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 10);
    ctx.textBaseline = 'alphabetic';
    fit((V.title || 'もぐらたたきカップ') + (V.divName ? '　' + V.divName : ''), 80, 92, 1000, 34, 800, FD, 'left', C.mute);
    fit(heading, 80, 170, 1000, 72, 800, FD, 'left', C.fg);
    if (V.round) {
      ctx.font = `800 34px ${FD}`;
      const tw = Math.min(ctx.measureText(V.round).width + 56, 420);
      rr(W - 80 - tw, 112, tw, 64, 32); ctx.fillStyle = C.accent; ctx.fill();
      fit(V.round, W - 80 - tw / 2, 156, tw - 40, 34, 800, FD, 'center', C.onAccent);
    }
    ctx.fillStyle = C.mute; ctx.globalAlpha = 0.35; ctx.fillRect(80, 206, W - 160, 2); ctx.globalAlpha = 1;
  }
  function footer(h, text) { if (text) fit(text, 80, h - 34, W - 160, 26, 700, FB, 'left', C.mute); }
  const label = (n) => 'MATCH ' + String(n).padStart(2, '0');

  // 譜面カード（ジャケット・難易度・定数・曲名）
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
    if (s) {
      // 難易度・レベル・定数・DX/ST。幅が足りなければ文字を小さくする
      const meta = `${s.diff}  Lv.${s.lv}  (${fmtConst(s.c)})`;
      const room = tw - (opt.tag ? 150 : 0);
      let fs = 22, mw, kw;
      for (; fs >= 14; fs--) {
        ctx.font = `500 ${fs}px ${FM}`; mw = ctx.measureText(meta).width;
        ctx.font = `800 ${fs - 4}px ${FM}`; kw = ctx.measureText(s.kind).width + 16;
        if (mw + 14 + kw <= room) break;
      }
      ctx.font = `500 ${fs}px ${FM}`; ctx.textAlign = 'left'; ctx.fillStyle = dc;
      ctx.fillText(meta, tx, y + 42);
      rr(tx + mw + 14, y + 42 - fs + 1, kw, fs + 4, 6); ctx.fillStyle = s.kind === 'DX' ? '#f6a23a' : '#4aa3e8'; ctx.fill();
      ctx.font = `800 ${fs - 4}px ${FM}`; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(s.kind, tx + mw + 14 + kw / 2, y + 41);
    }
    if (opt.tag) {
      ctx.font = `800 22px ${FD}`;
      const tgw = ctx.measureText(opt.tag).width + 28;
      rr(x + w - tgw - 16, y + 14, tgw, 36, 18); ctx.fillStyle = C.gold; ctx.fill();
      ctx.fillStyle = C.fg; ctx.textAlign = 'center'; ctx.fillText(opt.tag, x + w - 16 - tgw / 2, y + 40);
    }
    fit(s ? s.name : (opt.empty || '（未入力）'), tx, y + h - 26, tw, 38, 700, FB, 'left', s ? C.fg : C.mute);
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
        if (mode === 'final') { if (ban === i) o.ban = true; if (pick === i) { o.hi = true; o.tag = '自選曲'; } }
        songCard(s, x, top + 18 + i * (cardH + 16), colW, cardH, o);
      });
    });
    ctx.font = `800 56px ${FD}`; ctx.fillStyle = C.accent; ctx.textAlign = 'center';
    ctx.fillText('VS', W / 2, top + 18 + (cardH * 3 + 32) / 2 + 20);
    if (m.cap != null) fit(`上限 定数${fmtConst(Number(m.cap))}${m.lv14 ? '＋Lv14 1曲' : ''}`, W - 80, top - 50, 520, 22, 500, FM, 'right', m.lv14 ? C.goldText : C.mute);
    return top + 18 + 3 * (cardH + 16);
  }

  function drawReveal(m, i, imgs) {
    const h = 920;
    base(h, `選曲公開　${label(i + 1)}`);
    const y = columns(m, 'reveal', imgs);
    rr(80, y + 20, W - 160, 96, 16); ctx.fillStyle = C.card2; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent; ctx.stroke();
    fit('相手の自選曲から1曲をBANしてください', W / 2, y + 82, W - 240, 38, 800, FD, 'center', C.accent);
    footer(h, V.notes.reveal);
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

  // view: { title, round, notes, matches:[{ aName, bName, aSongs, bSongs, aBan, aPick, bBan, bPick, cap, finals:[{ s, label, kind }] }] }
  async function render(canvas, view, kind, idx) {
    cv = canvas; ctx = cv.getContext('2d'); V = view;
    await Promise.all([`800 40px ${FD}`, `700 40px ${FB}`, `500 22px ${FM}`].map((f) => document.fonts.load(f, 'もぐらA'))).catch(() => {});
    if (kind === 'pair') { drawPair(); return; }
    const m = V.matches[idx];
    if (!m) { base(400, '対戦カードがありません'); return; }
    const charts = [...m.aSongs, ...m.bSongs, ...(kind === 'final' ? m.finals.map((f) => f.s) : [])].filter(Boolean);
    const imgs = new Map();
    await Promise.all(charts.map(async (s) => imgs.set(s.key, await loadImg(jacketURL(s.img)))));
    if (kind === 'reveal') drawReveal(m, idx, imgs); else drawFinal(m, idx, imgs);
  }
  return { render };
})();
