import type { TKey } from '../core/I18n';
import { shopSigns } from '../city/visual/ShopSigns';

/**
 * 全城店面的柜台卖什么（street/，2026-11-10，docs/street-level-design.md C1，「下车之后，几乎没事可做」）：招牌上的行当
 * （city/visual/ShopSigns.ts 的 TRADES）对到一种柜台，每种柜台几样东西。纯数据和纯函数，Node 里测（Trades.test.ts）。
 * 回血不是主要回报：徒步很少掉血。主要是「吃遍北京」的册子、给熟人的礼物、省事（就地修车、睡一觉、换装）。
 */
export type Service = 'eat' | 'snack' | 'gift' | 'pharmacy' | 'care' | 'hair' | 'clothes' | 'repair' | 'hotel' | 'lottery' | 'courier';

export interface Good {
  id: string; name: TKey; price: number;
  /** Health back (100 = all of it). */
  heal?: number;
  /** Every hurt scaled by `scale` for `secs`. */
  guard?: { scale: number; secs: number };
  /** A gift: friendship points for whoever gets it (contacts/). */
  gift?: number;
  /** A first-aid kit to carry: used by itself when the player is badly hurt. */
  kit?: boolean;
}

const G = (id: string, price: number, heal?: number): Good => ({ id, name: `st.i.${id}` as TKey, price, heal });
const gift = (id: string, price: number, pts: number): Good => ({ id, name: `st.i.${id}` as TKey, price, gift: pts });

/** What each trade's counter is; a trade not here is a shop front only. */
export const SERVICE: Record<string, Service> = {
  面馆: 'eat', 拉面: 'eat', 饺子馆: 'eat', 包子铺: 'eat', 烧烤: 'eat', 火锅: 'eat', 麻辣烫: 'eat', 炸酱面: 'eat', 卤煮: 'eat', 涮肉: 'eat',
  快餐: 'eat', 黄焖鸡米饭: 'eat', 早点: 'eat', 粥铺: 'eat', 川菜馆: 'eat', 东北菜: 'eat', 奶茶: 'eat', 咖啡: 'eat',
  // the districts' own (ShopSigns.ts FLAVOUR_TRADES, 2026-11-10)
  轻食: 'eat', 西餐: 'eat', 麻辣小龙虾: 'eat', 烤鸭: 'eat', 烤鱼: 'eat', 酒吧: 'eat', 精酿: 'eat', 糖葫芦: 'eat',
  小卖部: 'snack', 旅馆: 'hotel',
  便利店: 'snack', 超市: 'snack', 日用百货: 'snack',
  水果: 'gift', 烟酒: 'gift', 茶叶: 'gift', 花店: 'gift',
  药店: 'pharmacy', 大药房: 'pharmacy',
  足疗: 'care',
  理发: 'hair', 美发: 'hair',
  服装: 'clothes', 鞋店: 'clothes',
  修车: 'repair',
  宾馆: 'hotel',
  彩票: 'lottery',
  // 没有东西卖，只接活：派一趟件（errands/，2026-11-11）
  快递驿站: 'courier',
};

/** The things on each counter (the trades of `eat` are the pages of 吃遍北京: the first thing on each is its 招牌). */
export const GOODS: Record<string, Good[]> = {
  面馆: [G('beefnoodle', 22, 40), G('tomatonoodle', 16, 30)],
  拉面: [G('lamian', 20, 40), G('coldbeef', 28, 45)],
  饺子馆: [G('porkdumpling', 24, 45), G('sanxian', 30, 55)],
  包子铺: [G('baozi', 8, 20), G('millet', 4, 10)],
  烧烤: [G('skewers', 20, 30), G('mantoupian', 6, 10)],
  火锅: [G('hotpot', 88, 100), G('yuanyang', 98, 100)],
  麻辣烫: [G('malatang', 25, 40), G('suanmeitang', 8, 10)],
  炸酱面: [G('zhajiangmian', 26, 50), G('cucumber', 12, 15)],
  卤煮: [G('luzhuhuoshao', 28, 55), G('orangesoda', 6, 10)],
  涮肉: [G('shuanrou', 96, 100), G('sweetgarlic', 6, 8)],
  快餐: [G('gaifan', 18, 35), G('soda', 5, 8)],
  黄焖鸡米饭: [G('huangmenji', 22, 45), G('rice', 3, 8)],
  早点: [G('youtiao', 7, 20), G('doufunao', 5, 15)],
  粥铺: [G('pidanzhou', 12, 25), G('xiaolongbao', 15, 25)],
  川菜馆: [G('shuizhuyu', 68, 90), G('gongbao', 32, 55)],
  东北菜: [G('guobaorou', 42, 70), G('disanxian', 26, 45)],
  奶茶: [G('bubbletea', 15, 15), G('mangosago', 20, 20)],
  咖啡: [G('americano', 18, 10), G('latte', 24, 15)],
  轻食: [G('salad', 32, 30), G('sandwich', 26, 30)],
  西餐: [G('steak', 128, 100), G('pasta', 58, 60)],
  麻辣小龙虾: [G('maxiao', 98, 90), G('edamame', 12, 10)],
  烤鸭: [G('roastduck', 138, 100), G('duckroll', 28, 35)],
  烤鱼: [G('kaoyu', 88, 90), G('rice', 3, 8)],
  酒吧: [G('draught', 30, 10), G('cocktail', 60, 12)],
  精酿: [G('ipa', 45, 12), G('fries', 25, 20)],
  糖葫芦: [G('tanghulu', 10, 15), G('sugarstrawberry', 15, 15)],
  小卖部: [G('water', 3, 8), G('icecream', 4, 8), G('bread', 6, 15)],
  便利店: [G('water', 3, 8), G('bread', 6, 15), G('ricebox', 15, 30)],
  超市: [G('water', 3, 8), G('bread', 6, 15), G('ricebox', 15, 30)],
  日用百货: [G('water', 3, 8), G('bread', 6, 15)],
  水果: [gift('tangerines', 20, 3), gift('fruitbasket', 60, 7)],
  烟酒: [gift('erguotou', 35, 5), gift('cigarettes', 200, 14)],
  茶叶: [gift('jasminetea', 80, 8)],
  花店: [gift('bouquet', 50, 6)],
  药店: [G('patchup', 30, 100), { id: 'kit', name: 'st.i.kit', price: 60, kit: true }],
  大药房: [G('patchup', 30, 100), { id: 'kit', name: 'st.i.kit', price: 60, kit: true }],
  足疗: [{ id: 'footbath', name: 'st.i.footbath', price: 68, heal: 100, guard: { scale: 0.75, secs: 300 } }],
};

/**
 * The trades that are pages of 吃遍北京: the eating ones some sign in the city carries (the 96 generic signs are drawn by a seed
 * from the trades' weights and 炸酱面 and 早点 did not come up there: they and the districts' own are in the flavours' dozens).
 */
export const EAT_TRADES: readonly string[] = [...new Set(shopSigns().map((g) => g.trade))].filter((k) => SERVICE[k] === 'eat');
/** How many trades tried pays what (once each). */
export const ALBUM_REWARDS: readonly [number, number][] = [[6, 500], [12, 1500], [EAT_TRADES.length, 4000]];
/** First-aid kits carried at most; what one gives back; used when health is under this. */
export const KIT_MAX = 2, KIT_HEAL = 60, KIT_AT = 25;
export const HOTEL_PRICE = 120, TICKET_PRICE = 10;
/** A scratch card's prize by a roll in [0, 1): it pays back 93% on average. */
export function scratch(r: number): number {
  return r < 0.001 ? 1000 : r < 0.01 ? 200 : r < 0.05 ? 50 : r < 0.15 ? 20 : r < 0.4 ? 10 : 0;
}
/** A repair at a street garage: per point of the car's 100, a little dearer than your own garage's. */
export const REPAIR_PER_POINT = 5;
export const repairPrice = (health: number): number => Math.max(0, Math.round((100 - health) * REPAIR_PER_POINT));

export interface StreetSave {
  /** Trades of 吃遍北京 tried. */
  eaten: string[];
  /** ALBUM_REWARDS already paid (their counts). */
  paid: number[];
  kits: number;
  /** The gift in hand (a Good's id), or null. */
  gift: string | null;
  /** Things bought over every counter. */
  bought: number;
}
export const emptySave = (): StreetSave => ({ eaten: [], paid: [], kits: 0, gift: null, bought: 0 });
/** The Good with this id (a gift in hand is kept as its id). */
export function goodOf(id: string | null): Good | null {
  if (!id) return null;
  for (const list of Object.values(GOODS)) { const g = list.find((x) => x.id === id); if (g) return g; }
  return null;
}
/** A trade eaten at: is it new to the album, and what that pays now (0 mostly). */
export function ate(save: StreetSave, trade: string): { fresh: boolean; reward: number } {
  if (SERVICE[trade] !== 'eat' || save.eaten.includes(trade)) return { fresh: false, reward: 0 };
  save.eaten.push(trade);
  let reward = 0;
  for (const [n, cash] of ALBUM_REWARDS) if (save.eaten.length >= n && !save.paid.includes(n)) { save.paid.push(n); reward += cash; }
  return { fresh: true, reward };
}
