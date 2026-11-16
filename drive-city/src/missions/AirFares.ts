import type { PlaceCat } from '../nav/Places';

/**
 * 首都机场第三批的乘客活（2026-11-16，「接着做第三批」，docs/airport-design.md §7）里不碰引擎的那部分：城里哪些客要去机场、
 * 去机场的长单给多少时间和钱、蓄车池在哪、排多久、进城的大单去哪类地方，还有熟人那两样（赶飞机、接机，contacts/AirRuns.ts）
 * 的时限、报酬和晚点。纯函数，Node 里测（`AirFares.test.ts`）。
 *
 * 坐标都是游戏的世界坐标（x 朝东、z 朝南），从 `public/city/network.json` 里量的：
 * - T3 出发层是高架（6.5 米），和到达层在平面上叠在一起，所以判断「到了出发层」要看车的高度。
 * - OSM 里的「出租车专用道」在 T2 西边（不在 T3），T2 的蓄车池放在它落地的那一段上；T3 的放在交通中心门前的到达层车道上
 *   （快速前往「首都机场 T3」落车的那条路）。
 */

/** T3 出发层车道边（T3C 楼前最靠楼的那幅高架，单向往西）：导航目标、光圈、多近算到。 */
export const T3_DEP = { x: 18107, z: -16117, y: 6.5, r: 34 };
/** 车在出发层上：离 T3_DEP 不远、而且在高架上（底下的到达层同一个平面位置）。 */
export function atDepartures(x: number, y: number, z: number): boolean {
  return Math.hypot(x - T3_DEP.x, z - T3_DEP.z) < T3_DEP.r && y > T3_DEP.y - 2.5;
}
/** T3 到达层（交通中心门前、往西的单行道）：接机的人在这附近的人行道上等。 */
export const T3_ARR = { x: 18120, z: -16059 };
/** 离 T3 多远以内算「已经在机场了」（这里接的客不去机场）。 */
export const AIRPORT_NEAR = 8000;

/** 蓄车池的排队点：停在这里 RANK_R 米内、停稳 RANK_STILL 秒就算进了队。`yaw` 是车头该朝的方向（atan2(x, z)）。 */
export const RANKS: readonly { id: 't3' | 't2'; x: number; z: number; yaw: number }[] = [
  { id: 't3', x: 18215, z: -16057, yaw: -1.5 },
  { id: 't2', x: 15700, z: -18508, yaw: 1.2 },
];
export const RANK_R = 16, RANK_STILL = 2;
/** 排一次队：前面几辆车、等几秒（一辆车约 5 秒）。 */
export function rankWait(rnd: () => number): { cars: number; secs: number } {
  const cars = 2 + Math.floor(rnd() * 3);
  return { cars, secs: Math.round(cars * (4.5 + rnd() * 1.5)) };
}

/** 城里的东北部：东二环以东、长安街以北（三元桥、亮马桥、望京、燕莎这一片，离机场近，酒店和使馆多）。 */
export const cityNE = (x: number, z: number): boolean => x > 2500 && z < -1200;

/**
 * 城里路边招手的这位要不要去机场：只在东北部（8%）或者酒店门口（150 米内有酒店，20%）才有，别处没有。
 * `boost`：今天的每日任务要「送一位乘客去机场」，机会翻三倍（最多四成）——不然要等很久。
 */
export function airChance(x: number, z: number, nearHotel: boolean, boost = false): number {
  const p = nearHotel ? 0.2 : cityNE(x, z) ? 0.08 : 0;
  return boost ? Math.min(0.4, p * 3 || 0.06) : p;
}
/** 去机场的路有多远才算（米）：太近的（已经在机场边上）不算长单，太远的（西边、南边的城外）不去。 */
export const AIR_MIN = 9000, AIR_MAX = 42000;

/**
 * 机场长单的时限（秒）：时间宽松——按 12 米/秒（43 km/h，城里守规矩开、高速上不用飙）再给两分钟，路上堵的另补。
 * 二十公里约 30 分钟。
 */
export const airLimit = (len: number): number => Math.round(len / 12 + 120);
/** 机场长单的车费：街机表（起步 8 + 每公里 14，和别的单一样），外加 ¥40 高速费。 */
export const airFare = (km: number): number => Math.round(8 + 14 * km) + 40;

/** 从机场进城的大单去哪类地方：回家（小区）和酒店最多，写字楼次之。 */
export function inboundWeights(hour: number): Partial<Record<PlaceCat, number>> {
  if (hour >= 7 && hour < 18) return { hotel: 4, office: 3, resid: 3, mall: 0.6 };
  return { resid: 5, hotel: 4, office: 0.6 };
}
/** 进城的大单：直线多远的地方（米）先挑出来，再按真路程试。 */
export const IN_MIN = 11000, IN_MAX = 26000;

// ------------------------------------------------------------------- 熟人的两样：赶飞机、接机（contacts/AirRuns.ts）

/**
 * 赶飞机的时限（秒）：「四十分钟后的飞机」，到 T3 出发层值机截止。按 17 米/秒（61 km/h）算再给 30 秒——城里那段守规矩开
 * 来得及，高速上要开起来；路上堵的另补。二十公里约 20 分钟。
 */
export const flightLimit = (len: number): number => Math.round(len / 17 + 30);
/** 赶飞机给多少：底价 260，剩的时间每秒 1 块（最多 240）。 */
export const flightPay = (left: number): number => 260 + Math.max(0, Math.min(240, Math.round(left)));
/** 赶飞机去接人的地方离玩家路上多远（米）。 */
export const FLIGHT_PICK_MIN = 350, FLIGHT_PICK_MAX = 1600;

/** 接机：航班晚点几分钟（游戏里的分钟）。一半准点；晚点的 10–40 分钟，按 5 分钟取整。 */
export function meetDelay(rnd: () => number): number {
  if (rnd() < 0.5) return 0;
  return 10 + Math.floor(rnd() * 7) * 5;
}
/** 游戏里的一分钟是现实的几秒（render/ 的钟一现实分钟走半小时）。 */
export const GAME_MIN = 2;
/** 接机送回城里：时限（宽松，和机场长单一样）、报酬（底价 200，每公里 10 块）。 */
export const meetLimit = (len: number): number => airLimit(len);
export const meetPay = (len: number, late: boolean): number => {
  const base = 200 + Math.round(len / 100);
  return late ? Math.round(base * 0.6) : base;
};

/** 航班号：编的航空公司（和机场里的飞机涂装一样，不用真的），两个字母加三四位数。 */
export function flightNo(rnd: () => number): string {
  const air = ['JH', 'BC', 'HY', 'XL'][Math.floor(rnd() * 4)];
  return `${air}${100 + Math.floor(rnd() * 8900)}`;
}

/** 熟人来电：进城玩满多久才打第一个（秒），两次之间至少隔多久（秒）。 */
export const CALL_FIRST = 300, CALL_GAP = 540;
