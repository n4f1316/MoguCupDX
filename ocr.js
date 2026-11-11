// もぐらたたきカップ：リザルト画像の読み取り
// 対応している画像
//   ・でらっくす NET のプレイ履歴（詳細）のスクリーンショット … 達成率・でらっくスコア・MAX・BREAK
//   ・ゲーム機のリザルト画面の写真 … 達成率・でらっくスコア・MAX（BREAK は判定表が読めたときだけ）
//   ・ゲーム機の「大会リザルト」の写真 … 曲名で対象の曲を探し、達成率・でらっくスコア（同じ曲が複数あればスコアの高い方）
// 画像はこのブラウザの中で読み、外には送らない。文字の読み取りには Tesseract.js を使う
const MoguOCR = (() => {
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let ready = null;
  const workers = {};
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    ready ||= new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = TESS;
      sc.onload = () => res(window.Tesseract);
      sc.onerror = () => { ready = null; rej(new Error('読み取りの準備ができませんでした')); };
      document.head.append(sc);
    });
    return ready;
  }
  // 既定の読み取り：lang は 'eng'（数字・英字）か 'jpn+eng'（曲名）
  let engine = async (cv, psm, chars, lang = 'eng') => {
    const T = await loadTesseract();
    workers[lang] ||= T.createWorker(lang);
    const w = await workers[lang];
    await w.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: chars || '' });
    return (await w.recognize(cv)).data.text || '';
  };

  // 指定した範囲を、条件に合う画素を黒・それ以外を白にした canvas にする（scale 倍に拡大）
  function maskCanvas(img, x0, y0, x1, y1, isInk, scale = 1, pad = 0) {
    const w = x1 - x0, h = y1 - y0;
    const cv = document.createElement('canvas');
    const sw = Math.round(w * scale), sh = Math.round(h * scale);
    cv.width = sw + pad * 2; cv.height = sh + pad * 2;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    const out = c.getImageData(0, 0, cv.width, cv.height), d = img.data, o = out.data;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
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

  // ---------- 写真向けの処理 ----------
  const lumOf = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // 明るさを 2%〜98% の範囲に引き伸ばした画像（写真は暗かったり白っぽかったりするため）
  function autolevel(img, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height) {
    const w = x1 - x0, h = y1 - y0, d = img.data;
    const hist = new Uint32Array(256);
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) hist[Math.round(lumOf(d, (y * img.width + x) * 4))]++;
    const total = hist.reduce((a, b) => a + b, 0);
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
    const k = 255 / Math.max(1, hi - lo);
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y0 + y) * img.width + (x0 + x)) * 4, j = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) out.data[j + c] = Math.max(0, Math.min(255, (d[i + c] - lo) * k));
        out.data[j + 3] = 255;
      }
    }
    return out;
  }
  // 2値の配列のつながった部分に番号を付ける（4方向）
  function label(mask, w, h) {
    const lab = new Int32Array(w * h).fill(-1), boxes = [];
    const st = new Int32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (!mask[p] || lab[p] >= 0) continue;
      const id = boxes.length, bx = [w, h, 0, 0];
      let sp = 0; st[sp++] = p; lab[p] = id;
      while (sp) {
        const q = st[--sp], x = q % w, y = (q / w) | 0;
        if (x < bx[0]) bx[0] = x; if (y < bx[1]) bx[1] = y; if (x + 1 > bx[2]) bx[2] = x + 1; if (y + 1 > bx[3]) bx[3] = y + 1;
        if (x > 0 && mask[q - 1] && lab[q - 1] < 0) { lab[q - 1] = id; st[sp++] = q - 1; }
        if (x < w - 1 && mask[q + 1] && lab[q + 1] < 0) { lab[q + 1] = id; st[sp++] = q + 1; }
        if (y > 0 && mask[q - w] && lab[q - w] < 0) { lab[q - w] = id; st[sp++] = q - w; }
        if (y < h - 1 && mask[q + w] && lab[q + w] < 0) { lab[q + w] = id; st[sp++] = q + w; }
      }
      boxes.push(bx);
    }
    return { lab, boxes };
  }
  // オレンジ色の立体的な大きい数字（ゲーム機の達成率）が並んでいる行を探す
  function findAchRows(img) {
    const n = autolevel(img), w = n.width, h = n.height, d = n.data;
    const warm = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) { const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2]; warm[p] = r - b > 60 && r >= g ? 1 : 0; }
    const comps = label(warm, w, h).boxes.filter(([x0, y0, x1, y1]) => {
      const bh = y1 - y0, bw = x1 - x0;
      return bh > 0.015 * h && bh < 0.12 * h && bw > bh * 0.15 && bw < bh * 14;
    }).sort((a, b) => a[0] - b[0]);
    const groups = [];
    for (const [x0, y0, x1, y1] of comps) {
      const bh = y1 - y0;
      const g = groups.find((g) => {
        const gh = g[3] - g[1], ov = Math.min(y1, g[3]) - Math.max(y0, g[1]);
        return ov > 0.5 * Math.min(bh, gh) && x0 - g[2] < 1.2 * Math.max(bh, gh) && bh / gh > 0.5 && bh / gh < 2;
      });
      if (g) { g[0] = Math.min(g[0], x0); g[1] = Math.min(g[1], y0); g[2] = Math.max(g[2], x1); g[3] = Math.max(g[3], y1); }
      else groups.push([x0, y0, x1, y1]);
    }
    // 達成率（100.0000%）は横に長く、画面の中でも大きい
    return groups.filter((g) => g[2] - g[0] > 4 * (g[3] - g[1]) && g[3] - g[1] > 0.03 * h).sort((a, b) => a[1] - b[1]);
  }
  // 立体文字の中身（濃い縁取りに囲まれた部分）だけを黒くする
  function enclosedMask(n, t, useSeed) {
    const w = n.width, h = n.height, d = n.data;
    const stroke = new Uint8Array(w * h), open = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      stroke[p] = lumOf(d, i) < t && d[i] - d[i + 2] > 15 ? 1 : 0;
      open[p] = stroke[p] ? 0 : 1;
    }
    const { lab, boxes } = label(open, w, h);
    const bad = new Uint8Array(boxes.length);
    for (let x = 0; x < w; x++) { if (lab[x] >= 0) bad[lab[x]] = 1; if (lab[(h - 1) * w + x] >= 0) bad[lab[(h - 1) * w + x]] = 1; }
    for (let y = 0; y < h; y++) { if (lab[y * w] >= 0) bad[lab[y * w]] = 1; if (lab[y * w + w - 1] >= 0) bad[lab[y * w + w - 1]] = 1; }
    if (useSeed) {
      for (let p = 0; p < w * h; p++) {
        const i = p * 4, mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]);
        if (mn > 190 && mx - mn < 50 && lab[p] >= 0) bad[lab[p]] = 1;
      }
    }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d'), out = c.createImageData(w, h);
    for (let p = 0; p < w * h; p++) {
      const ink = !stroke[p] && lab[p] >= 0 && !bad[lab[p]];
      out.data[p * 4] = out.data[p * 4 + 1] = out.data[p * 4 + 2] = ink ? 0 : 255; out.data[p * 4 + 3] = 255;
    }
    c.putImageData(out, 0, 0);
    return cv;
  }
  // 1行ぶんの立体数字を、条件を変えながら何度か読み、多く出た値を使う
  async function readAchRow(img, box) {
    const [x0, y0, x1, y1] = box, h = y1 - y0, p = Math.round(h * 0.15);
    const n = autolevel(img, Math.max(0, x0 - p), Math.max(0, y0 - p), Math.min(img.width, x1 + p), Math.min(img.height, y1 + p));
    const votes = new Map();
    for (const t of [100, 115, 130]) {
      for (const seed of [true, false]) {
        const txt = (await engine(enclosedMask(n, t, seed), 7, '0123456789.%')).replace(/\s/g, '');
        for (const m of txt.matchAll(/(\d{2,3})\.?(\d{4})%?/g)) {
          const v = Number(`${m[1]}.${m[2]}`);
          if (v >= 50 && v <= 101) { const k = v.toFixed(4); votes.set(k, (votes.get(k) || 0) + 1); }
        }
        const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] >= 3) return best[0]; // 3回同じ値なら決まり
      }
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }
  // 周りより暗い部分を文字とする（写真の小さい文字向け）
  function adaptiveMask(img, x0, y0, x1, y1, t = 15, scale = 1) {
    const w = x1 - x0, h = y1 - y0, d = img.data, W = img.width;
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = lumOf(d, ((y0 + y) * W + x0 + x) * 4);
    // 積分画像で周りの平均を求める
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
    const r = Math.max(8, Math.round(img.width / 60));
    const cv = document.createElement('canvas');
    cv.width = w * scale; cv.height = h * scale;
    const c = cv.getContext('2d'), out = c.createImageData(cv.width, cv.height);
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
        const ax = Math.max(0, sx - r), ay = Math.max(0, sy - r), bx = Math.min(w, sx + r + 1), by = Math.min(h, sy + r + 1);
        const mean = (ii[by * (w + 1) + bx] - ii[ay * (w + 1) + bx] - ii[by * (w + 1) + ax] + ii[ay * (w + 1) + ax]) / ((bx - ax) * (by - ay));
        const v = mean - lum[sy * w + sx] > t ? 0 : 255, j = (y * cv.width + x) * 4;
        out.data[j] = out.data[j + 1] = out.data[j + 2] = v; out.data[j + 3] = 255;
      }
    }
    c.putImageData(out, 0, 0);
    return cv;
  }
  // 曲名の比べ方：記号・空白を除き、2文字ずつの組の重なりで似ている度合いを出す（0〜1）
  const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) return 1;
    const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const ga = grams(a), gb = grams(b);
    let hit = 0;
    for (const [g, c] of ga) hit += Math.min(c, gb.get(g) || 0);
    return (2 * hit) / Math.max(1, a.length - 1 + b.length - 1);
  }
  function cropCanvas(img, x0, y0, x1, y1, scale = 1) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(img.width, Math.round(x1)); y1 = Math.min(img.height, Math.round(y1));
    const cv = document.createElement('canvas');
    cv.width = (x1 - x0) * scale; cv.height = (y1 - y0) * scale;
    const t = document.createElement('canvas'); t.width = img.width; t.height = img.height;
    t.getContext('2d').putImageData(img, 0, 0);
    cv.getContext('2d').drawImage(t, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
    return cv;
  }

  // 大会リザルト：曲ごとの行（曲名・達成率・でらっくスコア）を読み、対象の曲を選ぶ
  async function readTournament(img, rows, opt) {
    const W = img.width, list = [];
    for (const box of rows) {
      const [x0, y0, x1, y1] = box, h = y1 - y0;
      const ach = await readAchRow(img, box);
      if (ach == null) continue;
      // 曲名は達成率の上の帯、でらっくスコアは達成率の右下
      // 曲名は紺の帯に白い文字なので、白い部分だけを黒い文字にして読む
      const tx0 = Math.max(0, Math.round(x0 - h * 0.1)), ty0 = Math.max(0, Math.round(y0 - h * 0.82)), tx1 = Math.min(W, Math.round(x1 + (x1 - x0) * 0.33)), ty1 = Math.round(y0 - h * 0.38);
      let title = '', sim = 0;
      // 文字の大きさで読み取りの結果が変わるので、曲名の文字の高さがおよそ 50px・35px になる2通りで読む
      for (const [t, sc] of [[140, 200 / h], [160, 200 / h], [140, 140 / h], [160, 140 / h]]) {
        const cv = maskCanvas(img, tx0, ty0, tx1, ty1, (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b > t && Math.max(r, g, b) - Math.min(r, g, b) < 110, sc, 16);
        const tt = (await engine(cv, 7, '', 'jpn+eng')).replace(/Re:MASTER|MASTER|EXPERT|ADVANCED|BASIC|TRACK\s*\d*/gi, '').trim();
        const sm = similarity(tt, opt.target);
        if (sm > sim || !title) { title = tt; sim = sm; }
        if (sim >= 0.8) break;
      }
      // 「でらっくスコア」の文字を避けて、右側の数字だけを読む
      const dxText = await engine(adaptiveMask(img, Math.round(x1 + (x1 - x0) * 0.27), Math.round(y1 - h * 0.45), Math.round(Math.min(W, x1 + (x1 - x0) * 0.5)), Math.round(Math.min(img.height, y1 + h * 0.15)), 15, 2), 7, '0123456789');
      const dxm = dxText.replace(/\D+/g, ' ').trim().split(' ').filter((s) => s.length >= 3 && s.length <= 5).pop();
      list.push({ ach, dx: dxm ? Number(dxm) : null, title, sim });
    }
    if (!list.length) return { note: '大会リザルトから達成率を読み取れませんでした。' };
    const choices = list.map((x, i) => ({ ...x, track: i + 1 }));
    let cand = list.filter((x) => x.sim >= 0.45);
    if (!cand.length) {
      if (list.length === 1) cand = list;
      else return { choices, note: `大会リザルトの中に「${opt.target}」を見つけられませんでした（曲名を読み取れなかった可能性があります）。下から、この曲の TRACK を選んでください。` };
    }
    // 同じ曲が複数あるときは、スコアの高い方（れもん：達成率、らいむ：でらっくスコア）
    const key = opt.metric === 'dx' ? (x) => x.dx ?? -1 : (x) => Number(x.ach);
    const best = cand.sort((a, b) => key(b) - key(a))[0];
    return {
      ach: best.ach, dx: best.dx, dxMax: null, brk: null, choices, picked: choices.find((c) => c.ach === best.ach && c.title === best.title)?.track,
      note: `大会リザルトから「${opt.target}」を${cand.length > 1 ? `${cand.length}件見つけ、スコアの高い方を` : ''}読み取りました。${opt.metric === 'dx' ? 'でらっくスコアの MAX と BREAK の数は大会リザルトに出ないので、入力してください。' : ''}`,
    };
  }

  // 判定表の BREAK の行を、文字として読む（ゲーム機の写真のサブモニターなど）
  function breakFromText(text) {
    for (const line of text.split('\n')) {
      const m = line.match(/BREAK\D*((?:\d+\D+){4}\d+)/i);
      if (m) { const n = m[1].match(/\d+/g).map(Number); if (n.length === 5) return n[1] + n[2] + n[3] + n[4]; }
    }
    return null;
  }

  // ---------- 入口 ----------
  // opt：{ metric: 'dx'|'ach', target: 曲名 }。返り値：{ ach, dx, dxMax, brk, note }
  async function read(canvas, opt = {}) {
    const W = canvas.width, H = canvas.height;
    const src = canvas.getContext('2d').getImageData(0, 0, W, H);
    const ocr = (cv, psm, chars) => engine(cv, psm, chars, 'eng');
    // 大会リザルト（立体数字の行が2つ以上）
    const rows = findAchRows(src);
    if (rows.length >= 2) return readTournament(src, rows, opt);
    // でらっくす NET のスクリーンショット
    const gray = maskCanvas(src, 0, 0, W, H, (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b < 150);
    const v = parseScore(await ocr(gray, 3, '0123456789.,/%'));
    if (v.ach == null || v.dx == null) {
      const white = maskCanvas(src, 0, 0, W, H, (r, g, b) => Math.min(r, g, b) > 215);
      const v2 = parseScore(await ocr(white, 3, '0123456789.,/%'));
      if (v.ach == null) v.ach = v2.ach;
      if (v.dx == null) { v.dx = v2.dx; v.dxMax = v2.dxMax; }
    }
    v.brk = null;
    try { v.brk = await readBreak(src, W, H, ocr); } catch { /* 読めなければ手入力 */ }
    // ゲーム機の写真：立体数字の達成率、周りより暗い小さな文字（でらっくスコア・判定表）
    if (rows.length === 1 && v.ach == null) v.ach = await readAchRow(src, rows[0]);
    if (v.dx == null || v.brk == null) {
      const am = adaptiveMask(src, 0, 0, W, H, 15);
      for (const psm of [3, 11]) {
        if (v.dx != null) break;
        const p = parseScore(await ocr(am, psm, '0123456789/,.%'));
        v.dx = p.dx; v.dxMax = p.dxMax; if (v.ach == null) v.ach = p.ach;
      }
      if (v.brk == null) v.brk = breakFromText(await ocr(am, 11, ''));
    }
    return v;
  }
  return { read, setEngine: (fn) => { engine = fn; }, getEngine: () => engine, parseScore, similarity, findAchRows };
})();
