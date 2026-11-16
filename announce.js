// 大会の告知画像（ルール・申込の流れの説明）を作るページ
// - 大会名・形式（本編／mini）・開催する部門・日程などを入力すると、X に貼れる画像（1600×900）を5枚描く
// - ジャケットなどの版権物は使わないので、そのまま保存できる
// - 入力した内容はこのブラウザに保存する
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const W = 1600, H = 900, CREDIT_H = 48;
  const FD = '"Chakra Petch","Noto Sans JP","Hiragino Sans",sans-serif';
  const FB = '"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
  const PAL = {
    light: { bg: '#F4F5F7', soft: '#E6E7EC', line: '#D5D6DE', fg: '#12101F', mute: '#55516E', accent: '#007A99', onAccent: '#F4F5F7', ban: '#C0303A', gold: '#8A5A00', ring: '#B9BBC9' },
    dark: { bg: '#0E0B1F', soft: '#16122E', line: '#2E2858', fg: '#F2F0FF', mute: '#A9A3D6', accent: '#4DE1FF', onAccent: '#0E0B1F', ban: '#FF7A85', gold: '#FFD86B', ring: '#2E2858' },
  };
  const DIVS = {
    lime: { name: 'らいむ部門', color: '#B5E05A', metric: 'でらっくスコア' },
    lemon: { name: 'れもん部門', color: '#FFD86B', metric: '達成率' },
  };
  const STEPS = [
    ['entry', '参加申請', '参加者ページから申請します'],
    ['pair', '組み合わせ発表', '対戦相手と自選曲の上限が発表されます'],
    ['select', '自選曲を3曲提出', '上限の範囲で、自分の得意な譜面を3つ選びます'],
    ['ban', '相手の曲を1曲 BAN', '相手の3曲が公開されます。1曲を選んで外します'],
    ['pick', '自選曲を1曲に決定', 'BAN されなかった2曲から、対戦で使う1曲を決めます'],
    ['final', '対戦曲の発表', '対戦曲が発表されます'],
    ['play', '対戦・リザルト提出', '期間内にプレイして、リザルト画像を提出します'],
    ['result', '結果発表', '運営の確認後、対戦結果が発表されます'],
  ];
  const KEY = 'mogu-announce-v1';
  const DEFAULTS = {
    title: '', format: 'main', theme: 'light', lime: true, lemon: true, capLime: '13.9', capLemon: '14.9', lv14: true, same: true,
    url: 'https://n4f1316.github.io/MoguCupDX/', contact: '', note: '',
    d_entry: '', d_pair: '', d_select: '', d_ban: '', d_pick: '', d_final: '', d_play: '', d_result: '',
  };
  let S = { ...DEFAULTS };
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 読めなければ初期値 */ }

  let ctx, C, logo = null, logoInv = null;
  const loadImg = (url) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  function invert(im) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 800;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0, 800, 800);
      x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 800);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(im, 0, 0, 800, 800);
      return c;
    } catch { return null; }
  }

  // ---------- 描画の部品 ----------
  const font = (w, s, f = FB) => { ctx.font = `${w} ${s}px ${f}`; };
  function text(t, x, y, { size = 28, weight = 500, color = C.fg, align = 'left', f = FB, maxW = 0 } = {}) {
    let s = size; font(weight, s, f);
    if (maxW) while (ctx.measureText(t).width > maxW && s > 14) { s--; font(weight, s, f); }
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x, y);
    return ctx.measureText(t).width;
  }
  // 幅 maxW で折り返す（英数字のかたまりと、行頭に来てはいけない記号はなるべく切らない）
  function wrapLines(t, maxW) {
    const tokens = String(t).match(/[A-Za-z0-9@:/._\-+%×−()]+|\s+|[\s\S]/g) || [];
    const lines = []; let cur = '';
    for (const tk of tokens) {
      if (tk === '\n') { lines.push(cur); cur = ''; continue; }
      if (ctx.measureText(cur + tk).width <= maxW || !cur) { cur += tk; continue; }
      if (/^[、。）」』・！？ー]/.test(tk)) { cur += tk; continue; }
      lines.push(cur.trimEnd()); cur = tk.trimStart();
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function para(t, x, y, maxW, { size = 26, weight = 500, color = C.fg, lh = 1.5, f = FB } = {}) {
    font(weight, size, f);
    const lines = wrapLines(t, maxW);
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * size * lh));
    return y + lines.length * size * lh;
  }
  function box(x, y, w, h, { fill = C.bg, stroke = C.line, lw = 2, dash = null } = {}) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.save(); if (dash) ctx.setLineDash(dash); ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); ctx.restore(); }
  }
  // 小さなラベル（塗り）
  function tag(t, x, y, { bg = C.accent, fg = C.onAccent, size = 24, padX = 14, h = 0, f = FD } = {}) {
    font(700, size, f);
    const w = ctx.measureText(t).width + padX * 2, hh = h || Math.round(size * 1.7);
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, hh);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + w / 2, y + hh / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    return w;
  }
  // 日付の欄：入力があればその文字、なければ書き込み用の空欄
  function dateBox(v, x, y, w, h, label) {
    if (label) text(label, x, y - 10, { size: 20, weight: 700, color: C.mute });
    if (v) { box(x, y, w, h, { fill: C.soft, stroke: C.accent }); text(v, x + w / 2, y + h / 2 + h * 0.17, { size: Math.min(34, h * 0.5), weight: 700, f: FD, align: 'center', maxW: w - 24 }); }
    else box(x, y, w, h, { fill: C.bg, stroke: C.mute, dash: [8, 6] });
  }
  const divs = () => ['lime', 'lemon'].filter((d) => S[d]);
  const mini = () => S.format === 'mini';
  const titleText = () => S.title.trim() || (mini() ? 'もぐらたたきカップmini' : 'もぐらたたきカップ');

  // 共通の土台：背景・リング・ロゴ・見出し・ページ番号・権利表記
  function base(heading, no, total) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H - CREDIT_H); ctx.clip();
    ctx.strokeStyle = C.ring; ctx.lineWidth = 1.5;
    [[W - 40, 60, [180, 300, 420, 540]], [60, H - 60, [140, 240, 340]]].forEach(([cx, cy, rs]) => rs.forEach((r, k) => {
      ctx.globalAlpha = 0.9 - k * 0.2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }));
    ctx.restore();
    const lg = C === PAL.dark ? logoInv || logo : logo;
    if (lg) { ctx.save(); ctx.globalAlpha = 0.07; ctx.drawImage(lg, (W - 720) / 2, (H - CREDIT_H - 720) / 2 + 20, 720, 720); ctx.restore(); }
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = C.soft; ctx.fillRect(0, H - CREDIT_H, W, CREDIT_H);
    text('本大会は有志による非公式大会です。株式会社セガおよび maimai 公式とは関係ありません。', W / 2, H - 16, { size: 20, color: C.mute, align: 'center' });
    if (heading) {
      text(titleText(), 80, 76, { size: 28, weight: 700, color: C.mute, f: FD, maxW: 1100 });
      text(heading, 80, 144, { size: 60, weight: 700, f: FD, maxW: 1200 });
      ctx.fillStyle = C.fg; ctx.fillRect(80, 170, W - 160, 4);
      text(`${no} / ${total}`, W - 80, 144, { size: 30, weight: 700, color: C.mute, f: FD, align: 'right' });
    }
  }

  // ---------- 1枚目：表紙 ----------
  function drawCover(no, total) {
    base('', no, total);
    tag('参加者募集', 80, 96, { size: 30, h: 56, padX: 22 });
    text(mini() ? 'maimai 非公式大会　mini（小規模版）' : 'maimai 非公式大会', 300, 136, { size: 28, weight: 700, color: C.mute });
    // 大会名：長いときは2行まで
    font(700, 104, FD);
    let size = 104, lines = wrapLines(titleText(), W - 160);
    while (lines.length > 2 && size > 56) { size -= 6; font(700, size, FD); lines = wrapLines(titleText(), W - 160); }
    ctx.fillStyle = C.fg; ctx.textAlign = 'left';
    lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, 80, 280 + i * size * 1.2));
    let y = 280 + (Math.min(lines.length, 2) - 1) * size * 1.2 + 34;
    ctx.fillStyle = C.fg; ctx.fillRect(80, y, W - 160, 4);
    y += 62;
    text('1対1のスコアアタック。自選曲を出し合い、BAN と PICK で対戦曲を決めます。', 80, y, { size: 34, weight: 700, maxW: W - 160 });
    y += 40;
    // 部門
    let x = 80;
    divs().forEach((d) => {
      const w = tag(DIVS[d].name, x, y, { bg: DIVS[d].color, fg: '#12101F', size: 30, h: 56, padX: 20, f: FB });
      const w2 = text(`${DIVS[d].metric}で勝負`, x + w + 16, y + 39, { size: 28, weight: 700 });
      x += w + 16 + w2 + 48;
    });
    // 日程
    const by = 640, bw = (W - 160 - 40) / 2;
    dateBox(S.d_entry, 80, by, bw, 92, '申込期間');
    dateBox(S.d_play, 80 + bw + 40, by, bw, 92, '対戦期間');
    text('申込はこちら', 80, 796, { size: 24, weight: 700, color: C.mute });
    text(S.url.trim() || '（参加者ページの URL）', 240, 798, { size: 32, weight: 700, color: C.accent, f: FD, maxW: W - 320 - (total > 1 ? 330 : 0) });
    if (total > 1) text('ルールと申込の流れは次の画像へ ▶', W - 80, 798, { size: 24, weight: 700, color: C.mute, align: 'right' });
  }

  // ---------- 2枚目：大会の流れ ----------
  function drawFlow(no, total) {
    base('大会の流れ', no, total);
    const cols = 4, gap = 24, cw = (W - 160 - gap * (cols - 1)) / cols, ch = 292, top = 206;
    STEPS.forEach(([k, name, desc], i) => {
      const x = 80 + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + 22);
      box(x, y, cw, ch);
      ctx.fillStyle = C.accent; ctx.fillRect(x, y, 64, 56);
      text(String(i + 1).padStart(2, '0'), x + 32, y + 40, { size: 30, weight: 700, color: C.onAccent, f: FD, align: 'center' });
      let d = desc;
      if (k === 'final') d = mini() ? '自選曲と他選曲の2曲が対戦曲になります' : '自選曲・他選曲・運営課題曲の3曲が対戦曲になります';
      text(name, x + 78, y + 40, { size: 28, weight: 700, maxW: cw - 92 });
      para(d, x + 20, y + 98, cw - 40, { size: 22, color: C.mute, lh: 1.5 });
      dateBox(S['d_' + k], x + 20, y + ch - 78, cw - 40, 58);
      // 次へ進む矢印
      if (i % cols < cols - 1 && i < STEPS.length - 1) {
        ctx.fillStyle = C.accent; ctx.beginPath(); ctx.moveTo(x + cw + 5, y + ch / 2 - 12); ctx.lineTo(x + cw + gap - 5, y + ch / 2); ctx.lineTo(x + cw + 5, y + ch / 2 + 12); ctx.fill();
      }
    });
    text('各段階の提出は、参加者ページから行います。締切を過ぎると提出できません。', 80, 842, { size: 22, weight: 700, color: C.mute });
  }

  // ---------- 3枚目：対戦曲の決め方 ----------
  function drawSongs(no, total) {
    base('対戦曲の決め方', no, total);
    const colW = 560, sh = 64, top = 250;
    const col = (x, who, banI, pickI) => {
      text(who, x, top - 16, { size: 28, weight: 700 });
      ['自選曲 1', '自選曲 2', '自選曲 3'].forEach((t, i) => {
        const y = top + i * (sh + 12), pick = i === pickI, ban = i === banI;
        box(x, y, colW, sh, { fill: pick ? C.soft : C.bg, stroke: pick ? C.gold : C.line, lw: pick ? 4 : 2 });
        text(t, x + 22, y + 42, { size: 26, weight: 700, color: ban ? C.mute : C.fg });
        if (pick) tag('決定', x + colW - 96, y + 14, { bg: C.gold, fg: C.bg, size: 22, h: 36, f: FB });
        if (ban) {
          ctx.strokeStyle = C.ban; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x + 16, y + sh / 2); ctx.lineTo(x + colW - 130, y + sh / 2); ctx.stroke();
          tag('BAN', x + colW - 110, y + 14, { bg: C.ban, fg: C.bg, size: 22, h: 36 });
        }
      });
    };
    col(80, 'あなたの自選曲（3曲提出）', 0, 2);
    col(W - 80 - colW, '相手の自選曲（3曲提出）', 1, 0);
    // 中央の説明
    const mx = 80 + colW + 30, mw = W - 160 - colW * 2 - 60;
    const steps = ['① おたがいに3曲を提出', '② 相手の3曲から1曲を BAN', '③ 残った2曲から1曲を決定'];
    steps.forEach((t, i) => text(t, mx + mw / 2, top + 40 + i * 76, { size: 23, weight: 700, color: C.accent, align: 'center', maxW: mw }));
    // 対戦曲
    const y0 = 520;
    ctx.fillStyle = C.fg; ctx.fillRect(80, y0, W - 160, 2);
    text(mini() ? '対戦曲（2曲）' : '対戦曲（3曲）', 80, y0 + 52, { size: 32, weight: 700, f: FD });
    const items = [['あなたの自選曲', '自分で決めた1曲', C.gold], ['相手の自選曲（他選曲）', '相手が決めた1曲', C.gold]];
    if (!mini()) items.push(['運営課題曲', '運営が決めた1曲', C.accent]);
    const n = items.length, g = 24, w = (W - 160 - g * (n - 1)) / n;
    items.forEach(([t, d, c], i) => {
      const x = 80 + i * (w + g), y = y0 + 76;
      box(x, y, w, 110, { fill: C.soft, stroke: c, lw: 4 });
      text(t, x + 24, y + 48, { size: 30, weight: 700, maxW: w - 48 });
      text(d, x + 24, y + 88, { size: 22, color: C.mute, maxW: w - 48 });
      if (i < n - 1) text('＋', x + w + g / 2, y + 68, { size: 30, weight: 700, color: C.mute, align: 'center' });
    });
    let y = y0 + 232;
    y = para('自選曲は、試合ごとに決められた譜面定数の上限以下から選びます。', 80, y, W - 160, { size: 24, weight: 700, color: C.mute });
    if (S.same) para(mini() ? '両者が同じ曲を自選曲に決めた場合は、その1曲で対戦します。' : '両者が同じ曲を自選曲に決めた場合は、その曲＋運営課題曲2曲の3曲で対戦します。', 80, y + 4, W - 160, { size: 24, weight: 700, color: C.mute });
  }

  // ---------- 4枚目：部門とルール ----------
  function drawRules(no, total) {
    const ds = divs();
    base(ds.length > 1 ? '部門とルール' : 'ルール', no, total);
    if (!ds.length) { text('開催する部門を選んでください', W / 2, 460, { size: 36, weight: 700, color: C.mute, align: 'center' }); return; }
    const g = 32, w = (W - 160 - g * (ds.length - 1)) / ds.length, top = 206, h = 560;
    const songs = mini() ? '' : '3曲';
    ds.forEach((d, i) => {
      const x = 80 + i * (w + g), iw = w - 56;
      box(x, top, w, h);
      ctx.fillStyle = DIVS[d].color; ctx.fillRect(x, top, w, 72);
      text(DIVS[d].name, x + 28, top + 50, { size: 38, weight: 700, color: '#12101F' });
      text(`${DIVS[d].metric}で勝負`, x + w - 28, top + 48, { size: 26, weight: 700, color: '#12101F', align: 'right' });
      let y = top + 124;
      const row = (label, body, sub) => {
        text(label, x + 28, y, { size: 22, weight: 700, color: C.accent });
        y = para(body, x + 28, y + 40, iw, { size: ds.length > 1 ? 28 : 32, weight: 700, lh: 1.4 });
        if (sub) y = para(sub, x + 28, y + 2, iw, { size: 21, color: C.mute, lh: 1.5 }) - 4;
        y += 26;
      };
      if (d === 'lime') {
        row('勝敗の決め方', `失点の${songs}合計が少ない方の勝ち`, '失点 ＝（でらっくスコアの MAX − 自分のでらっくスコア）＋ CRITICAL PERFECT 以外で取った BREAK の数 × 2');
        row('自選曲の上限', `譜面定数 ${S.capLime || '　　'} 以下`, '試合によって、これより低い上限になることがあります。');
        if (S.lv14) row('レベル14の解禁', '両者が希望すれば、レベル14を1曲選べます', '申込のときに希望を聞きます。上限を超えるレベル14は1曲までです。');
      } else {
        row('勝敗の決め方', `達成率の${songs}合計が高い方の勝ち`, '');
        row('自選曲の上限', `譜面定数 ${S.capLemon || '　　'} 以下`, '試合によって、これより低い上限になることがあります。');
      }
    });
    const foot = [ds.length > 1 ? '1人で両方の部門に参加できます。' : '', '対戦は各部門1試合です。組み合わせは運営が決めます。'].filter(Boolean).join('　');
    text(foot, 80, 812, { size: 24, weight: 700, color: C.mute, maxW: W - 160 });
  }

  // ---------- 5枚目：申込方法とリザルトの提出 ----------
  function drawEntry(no, total) {
    base('申込方法とリザルトの提出', no, total);
    const g = 32, w = (W - 160 - g) / 2, top = 206, h = 520;
    const panel = (x, title, items) => {
      box(x, top, w, h);
      ctx.fillStyle = C.fg; ctx.fillRect(x, top, w, 60);
      text(title, x + 24, top + 42, { size: 28, weight: 700, color: C.bg });
      let y = top + 108;
      items.forEach(([t, d], i) => {
        ctx.fillStyle = C.accent; ctx.fillRect(x + 24, y - 30, 40, 40);
        text(String(i + 1), x + 44, y, { size: 24, weight: 700, color: C.onAccent, f: FD, align: 'center' });
        const y1 = para(t, x + 80, y, w - 108, { size: 26, weight: 700, lh: 1.35 });
        y = (d ? para(d, x + 80, y1 - 2, w - 108, { size: 20, color: C.mute, lh: 1.45 }) : y1) + 22;
      });
    };
    panel(80, '申込の手順', [
      ['参加者ページを開く', S.url.trim()],
      ['「新規登録」でユーザー名と PIN を決める', '2fRATE のランキングに登録している人は、そのユーザー名と PIN でログインできます。'],
      ['参加する部門を選び、設問に答えて申請する', ''],
      ['組み合わせの発表を待つ', '発表後は、同じページから自選曲・BAN・リザルトを提出します。'],
    ]);
    panel(80 + w + g, 'リザルトの提出', [
      ['対戦期間中に、対戦曲をプレイする', 'プレイする店舗や日時は自由です。'],
      ['参加者ページで、曲ごとにリザルト画像を提出する', '使える画像：maimai でらっくす NET のプレイ履歴のスクリーンショット、またはゲーム機のリザルト画面の写真。'],
      ['運営が確認して承認する', '画像から読み取った値は、提出の前に自分で確かめて直せます。'],
    ]);
    let y = top + h + 44;
    if (S.contact.trim()) { text('お問い合わせ', 80, y, { size: 22, weight: 700, color: C.accent }); text(S.contact.trim(), 230, y + 2, { size: 26, weight: 700, maxW: W - 310 }); y += 40; }
    if (S.note.trim()) para(S.note.trim(), 80, y, W - 160, { size: 22, weight: 700, color: C.mute, lh: 1.45 });
  }

  const SLIDES = [['表紙', drawCover], ['大会の流れ', drawFlow], ['対戦曲の決め方', drawSongs], ['部門とルール', drawRules], ['申込方法とリザルトの提出', drawEntry]];

  // ---------- 画面 ----------
  const FIELDS = Object.keys(DEFAULTS);
  function readForm() {
    FIELDS.forEach((k) => { const el = $('#f_' + k); if (el) S[k] = el.type === 'checkbox' ? el.checked : el.value; });
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 保存できなくても描画は続ける */ }
  }
  function fillForm() {
    FIELDS.forEach((k) => { const el = $('#f_' + k); if (!el) return; if (el.type === 'checkbox') el.checked = !!S[k]; else el.value = S[k] ?? ''; });
  }
  let seq = 0;
  async function renderAll() {
    const my = ++seq;
    readForm();
    $('#rowLv14').hidden = !S.lime; $('#rowCapLime').hidden = !S.lime; $('#rowCapLemon').hidden = !S.lemon;
    await Promise.all([`700 40px ${FD}`, `700 40px ${FB}`, `500 22px ${FB}`].map((f) => document.fonts.load(f, 'もぐらA1'))).catch(() => {});
    if (!logo) { logo = await loadImg('logo3rd.svg?v=1'); if (logo) logoInv = invert(logo); }
    if (my !== seq) return;
    C = S.theme === 'dark' ? PAL.dark : PAL.light;
    SLIDES.forEach(([, draw], i) => {
      const cv = $('#cv' + i); cv.width = W; cv.height = H; ctx = cv.getContext('2d');
      draw(i + 1, SLIDES.length);
    });
  }
  function save(i) {
    return new Promise((res) => $('#cv' + i).toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `mogucup_announce_${i + 1}_${SLIDES[i][0]}.png`; a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); res(); }, 600);
    }, 'image/png'));
  }

  $('#slides').innerHTML = SLIDES.map(([name], i) => `<figure class="slide"><figcaption><b>${i + 1}. ${name}</b><button type="button" data-save="${i}">この画像を保存</button></figcaption><canvas id="cv${i}" role="img" aria-label="${name}の画像"></canvas></figure>`).join('');
  $('#dates').innerHTML = STEPS.map(([k, name]) => `<label>${name}<input id="f_d_${k}" type="text" maxlength="40" placeholder="例 12/1（日）〜 12/7（土）"></label>`).join('');
  fillForm();
  $('#form').addEventListener('input', renderAll);
  $('#slides').addEventListener('click', (e) => { const b = e.target.closest('[data-save]'); if (b) save(+b.dataset.save); });
  $('#saveAll').onclick = async () => { for (let i = 0; i < SLIDES.length; i++) await save(i); };
  $('#reset').onclick = () => { S = { ...DEFAULTS, title: S.title }; fillForm(); renderAll(); };
  // 大会名と形式が未入力なら、いまの大会設定から入れておく
  (async () => {
    if (!S.title && window.MOGU_API) {
      try {
        const r = await fetch(window.MOGU_API + 'api/public'); const j = await r.json();
        if (!S.title && j.settings?.title) { S.title = j.settings.title; S.format = j.settings.format === 'mini' ? 'mini' : 'main'; fillForm(); }
      } catch { /* 取れなければ空のまま */ }
    }
    renderAll();
  })();
})();
