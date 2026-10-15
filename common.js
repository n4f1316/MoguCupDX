// もぐらたたきカップ 共通処理（API 呼び出し・譜面データ）
const API = window.MOGU_API;
const DATA = window.MOGU_DATA;

async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = 'Bearer ' + key;
  let r;
  try {
    r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('サーバーにつながりませんでした。通信状況を確認して、もう一度お試しください');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `エラー（${r.status}）`), { status: r.status });
  return data;
}

const DIFF_ORDER = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER'];
const DIFF_COLOR = { BASIC: '#2e9e5b', ADVANCED: '#c98200', EXPERT: '#e0434b', MASTER: '#8e44d6', 'Re:MASTER': '#a679e0' };
const DIFF_SHORT = { BASIC: 'BAS', ADVANCED: 'ADV', EXPERT: 'EXP', MASTER: 'MAS', 'Re:MASTER': 'Re:MAS' };

// 譜面定数 → レベル表記（.6 以上は +）
function levelOf(c) {
  const i = Math.floor(c + 1e-9);
  if (i < 7) return String(i);
  return i + (c - i >= 0.6 - 1e-9 ? '+' : '');
}
const levelOrder = (lv) => parseInt(lv, 10) + (String(lv).endsWith('+') ? 0.5 : 0);

// 参加者ページ用：ジャケットは公式サイトの画像を直接表示する（2fRATE と同じ）
const JACKET_BASES = ['https://maimaidx.jp/maimai-mobile/img/Music/', 'https://maimai.sega.jp/storage/DX_jacket/'];
function jacketEl(file) {
  if (!file) { const d = document.createElement('div'); d.className = 'jk'; return d; }
  const img = document.createElement('img');
  let i = 0;
  img.className = 'jk'; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
  img.src = JACKET_BASES[0] + file;
  img.onerror = () => { i++; if (i < JACKET_BASES.length) img.src = JACKET_BASES[i] + file; else { const d = document.createElement('div'); d.className = 'jk'; img.replaceWith(d); } };
  return img;
}
// 部門と神プレート（申請の設問）
const DIVISIONS = [{ id: 'lime', name: 'らいむ部門' }, { id: 'lemon', name: 'れもん部門' }];
const divName = (id) => DIVISIONS.find((d) => d.id === id)?.name || '';
const PLATES = ['真', '超', '檄', '橙', '暁', '桃', '櫻', '紫', '菫', '白', '雪', '輝', '舞', '熊', '華', '爽', '煌', '宙', '星', '祭', '祝', '双', '宴', '鏡', '彩', '丸', '廻'];

// 自選曲として選べるか：上限以下。Lv14解禁の試合では、上限を超える Lv14（14.0〜14.5）も候補（1曲まで）
const isLv14 = (c) => c >= 14 - 1e-9 && c < 14.6 - 1e-9;
const overCap = (c, cap) => c > Number(cap) + 1e-9;
const selectable = (c, cap, lv14) => !overCap(c, cap) || (lv14 && isLv14(c));

// 対戦曲の決め方
//   本編（format: 'main'）：両者の自選曲＋運営課題曲。両者が同じ曲を自選曲にしたときだけ、その曲＋運営課題曲2曲
//   mini（format: 'mini'）：両者の自選曲だけ（運営課題曲なし）。同じ曲なら1曲
// 戻り値：[{ key, label, kind: 'a' | 'b' | 'both' | 'kadai' }]
function finalSongs({ format, aKey, bKey, aName, bName, kadai, kadai2 }) {
  const same = aKey && bKey && aKey === bKey;
  const out = same
    ? [{ key: aKey, label: '両者の自選曲', kind: 'both' }]
    : [{ key: aKey || '', label: `${aName} の自選曲`, kind: 'a' }, { key: bKey || '', label: `${bName} の自選曲`, kind: 'b' }];
  if (format !== 'mini') {
    out.push({ key: kadai || '', label: same ? '運営課題曲1' : '運営課題曲', kind: 'kadai' });
    if (same) out.push({ key: kadai2 || '', label: '運営課題曲2', kind: 'kadai' });
  }
  return out;
}
const fmtConst = (c) => (Math.round(c * 10) / 10).toFixed(1);

// 全譜面の一覧を読み込む（{ key, name, kind, diff, c, lv, img }）
let chartsPromise = null;
function loadCharts() {
  if (chartsPromise) return chartsPromise;
  const get = (f) => fetch(DATA + f, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))));
  chartsPromise = Promise.all([get('maimai_consts_magical.json'), get('maimai_jackets.json')]).then(([consts, jackets]) => {
    const list = [];
    for (const [key, c] of Object.entries(consts)) {
      const [name, kind, diff] = key.split('|');
      const lv = levelOf(c);
      list.push({ key, name, kind, diff, c, lv, img: resolveJacket(jackets, name, kind, diff, lv) });
    }
    list.sort((a, b) => b.c - a.c || a.name.localeCompare(b.name, 'ja'));
    const byKey = new Map(list.map((x) => [x.key, x]));
    return { list, byKey };
  });
  return chartsPromise;
}

// 同名曲は、種別と難易度のレベルが一致する候補が1つに絞れたときだけ採用する
function resolveJacket(map, name, kind, diff, lv) {
  const v = map[name];
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return null;
  const k = kind === 'ST' ? 'st' : 'dx';
  const i = DIFF_ORDER.indexOf(diff);
  const hits = v.filter((x) => x[k]?.[i] === lv);
  return hits.length === 1 ? hits[0].img : null;
}

const jacketURL = (img) => (img ? (window.MOGU_JACKET || API) + 'jacket/' + img : null);

// ひらがな・カタカナ・全角半角・大文字小文字の違いを無視して検索する
function norm(s) {
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s・･\-_~〜！!？?。、,.'"’”]/g, '');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
