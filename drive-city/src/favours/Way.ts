/**
 * 问路和路人的小委托里不碰引擎的那部分（2026-11-11，street-level-design C4「路人不只一句话」）：往哪个方向、多远怎么说，
 * 这回该是哪种委托，找东西时离得近了远了。纯函数，Node 里测（`Way.test.ts`）。
 */

export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const ROSE: readonly Compass[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** 从这儿到那儿是哪个方向。世界坐标 x 朝东、z 朝南（`city/Geo.ts` 的 `project`）；北京人指路说东南西北。 */
export function compass(dx: number, dz: number): Compass {
  const a = Math.atan2(dx, -dz);   // 0 北，顺时针
  return ROSE[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** 多远算「到了」「走着去」「开车去」。 */
export const HERE = 35, WALK = 450;
export type Reach = 'here' | 'walk' | 'drive';
export const reachOf = (d: number): Reach => (d < HERE ? 'here' : d <= WALK ? 'walk' : 'drive');

/** 嘴上说的距离：一百米以内凑到十米，一公里以内凑到五十米，再远说几点几公里。 */
export function roughly(d: number): { n: string; km: boolean } {
  if (d < 100) return { n: String(Math.max(10, Math.round(d / 10) * 10)), km: false };
  if (d < 950) return { n: String(Math.round(d / 50) * 50), km: false };
  return { n: (Math.round(d / 100) / 10).toFixed(1).replace(/\.0$/, ''), km: true };
}

export type FavourKind = 'deliver' | 'photo' | 'lift' | 'find';

/** 这会儿能有哪几种委托：有店可送、车在身边才有对应的那种。 */
export interface Chances {
  /** 50–280 米内有开着门的店。 */
  shop: boolean;
  /** 玩家自己的四轮车停在 90 米内，而且找得到一个去处。 */
  car: boolean;
  /** 附近有地标或景点（合影的人多）。 */
  sight: boolean;
  /** 找得到一块能掉东西的人行道。 */
  ground: boolean;
}

/** 每种委托这会儿的分量；0 是没有。 */
export function favourWeights(c: Chances): Record<FavourKind, number> {
  return { deliver: c.shop ? 3 : 0, photo: c.sight ? 4 : 1.5, lift: c.car ? 3 : 0, find: c.ground ? 2.5 : 0 };
}

/** 按分量抽一种；`last` 是上一回的那种，分量减半，免得连着两回一样。一种都没有返回 null。 */
export function pickFavour(c: Chances, rnd: () => number, last: FavourKind | null = null): FavourKind | null {
  const w = favourWeights(c);
  if (last) w[last] *= 0.5;
  const kinds = (Object.keys(w) as FavourKind[]).filter((k) => w[k] > 0);
  let total = 0;
  for (const k of kinds) total += w[k];
  if (!total) return null;
  let r = rnd() * total;
  for (const k of kinds) if ((r -= w[k]) <= 0) return k;
  return kinds[kinds.length - 1];
}

/** 找东西：离得多近说什么。3 就在跟前（看得见了），0 还远。 */
export const warmth = (d: number): 0 | 1 | 2 | 3 => (d < 6 ? 3 : d < 14 ? 2 : d < 26 ? 1 : 0);

/** 报酬：捎东西按路程，搭车按路程；别的是定数。 */
export const deliverPay = (m: number): number => 30 + Math.round(m / 10);
export const liftPay = (m: number): number => 40 + Math.round(m / 50) * 2;
export const FIND_PAY = 50;
