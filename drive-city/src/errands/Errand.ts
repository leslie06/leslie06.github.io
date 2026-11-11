import type { PlaceCat } from '../nav/Places';

/**
 * 活儿的最后一百米（2026-11-11，street-level-design C5）里不碰引擎的那部分：外卖送去哪类地方、给多少钱、限多久，
 * 楼门往院里找的顺序，派件的数，什么店什么钟点有代驾单。纯函数，Node 里测（`Errand.test.ts`）。
 */

/** 外卖送去哪：小区最多；饭点写字楼、学校、医院也叫；夜里是小区和宾馆。没列的类不送。 */
export function takeoutWeights(hour: number): Partial<Record<PlaceCat, number>> {
  if (hour >= 10.5 && hour < 14) return { office: 5, resid: 4, school: 2, hospital: 2, hotel: 1 };
  if (hour >= 17 && hour < 21) return { resid: 6, office: 2, school: 1, hospital: 1, hotel: 1 };
  if (hour >= 21 || hour < 6) return { resid: 5, hotel: 3, hospital: 1 };
  return { resid: 5, office: 2, school: 1, hospital: 1, hotel: 1 };
}

/** 外卖：路上多远的单子才接（米），给多少秒（守规矩开、等两个红灯、再走进去），按时和超时各给多少。 */
export const TAKEOUT_MIN = 400, TAKEOUT_MAX = 2200;
export const takeoutLimit = (len: number): number => Math.round(len / 7 + 75);
export const takeoutPay = (len: number, late: boolean): number => {
  const base = 20 + Math.round(len / 50);
  return late ? Math.round(base * 0.6) : base + 15;
};
/** 超过时限这么多倍还没送到，单子取消。 */
export const TAKEOUT_GIVE_UP = 2.2;

/**
 * 楼门在哪：从小区门口的人行道往院里找。每一项是（沿街挪多少米，往里走多少米），先试正对着往里最深的，
 * 再试两边的、浅一些的；调用的人拿射线和空地检测挨个试，头一个走得通的就是楼门。
 */
export function doorTries(): { along: number; deep: number }[] {
  const out: { along: number; deep: number }[] = [];
  for (const deep of [55, 45, 36, 28, 20]) for (const along of [0, 8, -8, 16, -16, 26, -26]) out.push({ along, deep });
  return out;
}
/** 一个都走不通（临街就是楼）：楼门算在沿人行道这么远的地方。 */
export const DOOR_ALONG = 32;

/** 派件：一趟几件，每件多少钱，限时内全送完再加多少，限多久，收件人离驿站多远。 */
export const PARCELS = 3, PARCEL_PAY = 15, PARCEL_BONUS = 30, PARCEL_LIMIT = 300, PARCEL_NEAR = 70, PARCEL_FAR = 380;
export const parcelsPay = (n: number, inTime: boolean): number => n * PARCEL_PAY + (n >= PARCELS && inTime ? PARCEL_BONUS : 0);

/** 代驾：晚上七点半到凌晨三点，喝酒的店门口才有单（和 npc/ 街头遭遇里那位老板一个钟点）。 */
export const daijiaHour = (hour: number): boolean => hour >= 19.5 || hour < 3;
export const DAIJIA_TRADES: ReadonlySet<string> = new Set(['酒吧', '精酿', '烧烤', '火锅', '涮肉', '麻辣小龙虾', '烤鱼', '烤鸭', '川菜馆', '东北菜']);

/** 逃逸车被拦下以后司机弃车跑的机会，和徒步抓到他多给的钱（events/）。 */
export const BAIL_CHANCE = 0.5, BAIL_BONUS = 300;
