/**
 * The shop signs over Beijing's ground floors (2026-10-11): names made the way the street makes them - a name
 * (a family, a lucky word, the place) and the trade: 老王烧烤, 鑫源超市, 京味炸酱面 - with each trade's colours, a
 * second line on some (24小时营业, a phone number), and the trade's kind, so the pavement in front can show it
 * (a food shop puts out tables and stools, a fruit shop its crates). Pure data, the same in the tile worker (which
 * places the props) and on the main thread (FacadeAtlas draws them into `SIGN_COLS` x `SIGN_ROWS` cells); the
 * facade shader and the worker pick a sign by the same hash (`hs >> 4` modulo `SIGN_COUNT`).
 */
export type ShopKind = 'food' | 'fruit' | 'shop' | 'service' | 'bank' | 'pharmacy';
export interface ShopSign {
  text: string; sub: string; bg: string; fg: string; kind: ShopKind; style: number;
  /** The trade alone, and its cell in the vertical lightboxes' atlas (`VERT_TEXTS`). */
  trade: string; vert: number;
}

export const SIGN_COLS = 4, SIGN_ROWS = 24, SIGN_COUNT = SIGN_COLS * SIGN_ROWS;

/** Trades: name, kind, weight, colour schemes [background, lettering]. */
const TRADES: [string, ShopKind, number, [string, string][]][] = [
  ['便利店', 'shop', 4, [['#d8342a', '#ffffff'], ['#1f7a3a', '#ffffff'], ['#1f5fae', '#ffffff']]],
  ['超市', 'shop', 3, [['#1f5fae', '#ffffff'], ['#d8342a', '#ffe070'], ['#e8e8e4', '#c3231b']]],
  ['水果', 'fruit', 3, [['#e2702a', '#ffffff'], ['#2f8a3a', '#ffffff'], ['#f2d02a', '#c3231b']]],
  ['烟酒', 'shop', 2, [['#9c1f1a', '#f6d36b'], ['#7a1a12', '#ffffff']]],
  ['药店', 'pharmacy', 2, [['#1d8a4a', '#ffffff'], ['#ffffff', '#1d8a4a']]],
  ['大药房', 'pharmacy', 1, [['#1d8a4a', '#ffffff']]],
  ['面馆', 'food', 2, [['#f2e6c8', '#a8261e'], ['#b52a22', '#ffffff']]],
  ['拉面', 'food', 2, [['#1a5a8a', '#ffffff'], ['#f2e6c8', '#1a5a8a']]],
  ['饺子馆', 'food', 2, [['#c4291f', '#ffe9a8']]],
  ['包子铺', 'food', 2, [['#f4efe2', '#b42a20'], ['#c4291f', '#ffffff']]],
  ['烧烤', 'food', 3, [['#1b1b1b', '#ff5a2a'], ['#c3121a', '#ffe070']]],
  ['火锅', 'food', 2, [['#c3121a', '#ffe070']]],
  ['麻辣烫', 'food', 2, [['#d8261e', '#ffffff'], ['#f2c21b', '#c3121a']]],
  ['炸酱面', 'food', 1, [['#5a3a28', '#f2e4c4']]],
  ['卤煮', 'food', 1, [['#7a1a12', '#f6d36b']]],
  ['涮肉', 'food', 1, [['#8a1c14', '#f6d36b']]],
  ['快餐', 'food', 2, [['#f2c21b', '#1b1b1b'], ['#e2702a', '#ffffff']]],
  ['黄焖鸡米饭', 'food', 1, [['#f2c21b', '#7a1a12']]],
  ['早点', 'food', 1, [['#e8b63a', '#7a1a12']]],
  ['粥铺', 'food', 1, [['#f4efe2', '#2f6a3a']]],
  ['川菜馆', 'food', 1, [['#c3121a', '#ffffff']]],
  ['东北菜', 'food', 1, [['#2b2b2b', '#f6d36b']]],
  ['奶茶', 'food', 1, [['#f6e7d0', '#6a3a22'], ['#f0a8b8', '#ffffff']]],
  ['咖啡', 'food', 1, [['#3b2a22', '#f2e2c8']]],
  ['理发', 'service', 2, [['#2b2b2b', '#f2f2f2'], ['#ffffff', '#1f4f9a']]],
  ['美发', 'service', 2, [['#1b1b1b', '#e8c86a'], ['#e6a0b8', '#ffffff']]],
  ['足疗', 'service', 1, [['#5a1a3a', '#f6d36b']]],
  ['干洗', 'service', 1, [['#2a78b8', '#ffffff']]],
  ['洗衣', 'service', 1, [['#2a78b8', '#ffffff']]],
  ['五金', 'shop', 2, [['#3a4a5a', '#f2f2f2'], ['#f2c21b', '#1b1b1b']]],
  ['日用百货', 'shop', 1, [['#d8342a', '#ffffff']]],
  ['文具', 'shop', 1, [['#e24a2a', '#ffffff']]],
  ['眼镜', 'shop', 1, [['#ffffff', '#1f4f9a']]],
  ['手机维修', 'service', 2, [['#1b1b1b', '#39c1e8']]],
  ['通讯', 'shop', 1, [['#1f5fae', '#ffffff']]],
  ['母婴', 'shop', 1, [['#f0a8b8', '#ffffff']]],
  ['服装', 'shop', 1, [['#2a2a2a', '#e8c86a']]],
  ['鞋店', 'shop', 1, [['#2a2a2a', '#ffffff']]],
  ['花店', 'shop', 1, [['#e6a0b8', '#ffffff'], ['#2f6a3a', '#ffffff']]],
  ['茶叶', 'shop', 1, [['#305c3a', '#e9d9a0']]],
  ['宠物', 'service', 1, [['#f2c21b', '#2a2a2a']]],
  ['口腔诊所', 'service', 1, [['#ffffff', '#1f6fb8']]],
  ['房产', 'service', 2, [['#2f6a3a', '#ffffff'], ['#f2c21b', '#2a2a2a']]],
  ['彩票', 'service', 1, [['#c3121a', '#ffffff']]],
  ['快递驿站', 'service', 1, [['#f1c21b', '#1b1b1b'], ['#2f8a3a', '#ffffff']]],
  ['修车', 'service', 1, [['#1d6fb8', '#ffe070']]],
  ['开锁', 'service', 1, [['#f2c21b', '#c3121a']]],
  ['打印复印', 'service', 1, [['#1f5fae', '#ffffff']]],
  ['银行', 'bank', 2, [['#1c3f7a', '#e8e8e8'], ['#c3121a', '#ffffff'], ['#1d6a4a', '#ffffff']]],
  ['宾馆', 'service', 1, [['#7a1a2a', '#f6d36b']]],
];
/** The name in front: families (+记), lucky words, places. */
const NAMES = ['老王', '老李', '张记', '刘记', '马记', '小马', '老张', '鑫源', '金鼎', '福满', '兴隆', '惠民', '百姓', '便民', '好邻居',
  '四季', '京味', '胡同', '老北京', '华联', '万家', '东城', '朝阳', '双井', '金台', '旺铺', '鸿运', '盛达', '佳佳', '一品', '大红',
  '天天', '有家', '小院', '聚福', '永和', '红星', '东方', '新世纪'];
/** Names only a food shop takes (兰州拉面, not 兰州水果). */
const FOOD_NAMES = ['兰州', '沙县', '重庆', '山西', '天津', '东北', '阿里郎', '老北京', '京味', '胡同'];
const SUBS = ['24小时营业', '欢迎光临', '诚信经营', '老字号', '外卖电话 6512 ', '营业时间 7:00-22:00', '本店新开张', '会员优惠', ''];

/** A trade as a projecting lightbox says it (two or three characters stacked). */
const vertOf = (t: string) => ({ 黄焖鸡米饭: '黄焖鸡', 日用百货: '百货', 手机维修: '手机', 口腔诊所: '口腔', 快递驿站: '快递', 打印复印: '打印', 大药房: '药', 药店: '药', 饺子馆: '饺子', 包子铺: '包子', 川菜馆: '川菜' } as Record<string, string>)[t] ?? t;
/** The vertical lightboxes' texts, in atlas order (`VERT_COLS` x `VERT_ROWS` cells). */
export const VERT_TEXTS = [...new Set(TRADES.map(([t]) => vertOf(t)))];
export const VERT_COLS = 8, VERT_ROWS = Math.ceil(VERT_TEXTS.length / VERT_COLS);
/** Each vertical text's colours (the first scheme of its trade). */
export const VERT_COLOURS = VERT_TEXTS.map((v) => TRADES.find(([t]) => vertOf(t) === v)![3][0]);

let cache: ShopSign[] | null = null;
/** All `SIGN_COUNT` signs, in atlas order (seeded: the same every run, on every thread). */
export function shopSigns(): ShopSign[] {
  if (cache) return cache;
  let s = 20261011 >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const total = TRADES.reduce((a, t) => a + t[2], 0);
  const out: ShopSign[] = [];
  const used = new Set<string>();
  while (out.length < SIGN_COUNT) {
    let u = rnd() * total, t = TRADES[0];
    for (const tr of TRADES) { u -= tr[2]; if (u <= 0) { t = tr; break; } }
    const [trade, kind, , schemes] = t;
    // banks go by their trade alone; most others take a name
    const named = kind === 'bank' ? false : rnd() < 0.75;
    const names = kind === 'food' ? [...NAMES, ...FOOD_NAMES] : NAMES;
    const text = named ? names[Math.floor(rnd() * names.length)] + trade : trade;
    if (used.has(text) || text.length > 7) continue;
    used.add(text);
    const [bg, fg] = schemes[Math.floor(rnd() * schemes.length)];
    const subI = Math.floor(rnd() * SUBS.length);
    let sub = rnd() < 0.45 ? SUBS[subI] : '';
    if (sub.endsWith(' ')) sub += String(1000 + Math.floor(rnd() * 9000));
    out.push({ text, sub, bg, fg, kind, style: Math.floor(rnd() * 3), trade, vert: VERT_TEXTS.indexOf(vertOf(trade)) });
  }
  return (cache = out);
}
