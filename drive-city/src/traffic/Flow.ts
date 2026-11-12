/**
 * 路况（2026-11-11，docs/street-level-design.md A6「车流的北京规矩」）：环路、快速路、主干道每两公里一格，每格在每个时段
 * 是畅通、缓行、拥堵里的一种——早晚高峰红的黄的多，夜里几乎全绿。车流（Ghosts.ts 的密度和车速、AiDriver 的车速）、
 * 环路上的情报板（city/visual/InfoBoards.ts）、交通台（audio/Talk.ts）都读这一张表，所以板上是红的那一段开过去真的堵，
 * 广播里说缓行的路真的慢。原来板子和广播各自掷骰子，路上的车哪个钟点都一样多。纯函数，Node 里测（`Flow.test.ts`）。
 */
export type Level = 0 | 1 | 2;

/** 一个时段多长（现实时间，毫秒）、一格多大（米）。 */
export const SLOT_MS = 180000, CELL = 2000;
/** 现在是第几个时段。 */
export const slotNow = (): number => Math.floor(Date.now() / SLOT_MS);

/** 畅通、缓行、拥堵时路上的车是平时的几倍、开到限速的几成。 */
export const DENS: readonly number[] = [1, 1.5, 2], SPEED: readonly number[] = [1, 0.6, 0.32];
/**
 * 往哪边开：东、南、西、北四个方向里最接近的一个（世界坐标 x 朝东、z 朝南）。路况分方向——一边堵成一串尾灯、对面畅通，
 * 是北京环路最常见的样子；也省一半的车（名额有限，两个方向都按拥堵放，别的路就空了）。
 */
export const headingOf = (dx: number, dz: number): string => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : dz > 0 ? 'S' : 'N');

const RING = /^[东西南北][二三四五]环/;
const FAST = /高速|快速/;
/** 环路各段的名字收成一个（东三环中路、东三环北路 → 东三环），辅路算主路的。和 city/Signs.ts 的 `shortName` 一个意思。 */
const short = (n: string) => n.replace(/辅路$/, '').replace(/^([东西南北][二三四五]环)[东西南北中]?路?$/, '$1').replace(/快速(道路)?$/, '快速路');

/**
 * 这条路在不在路况表里：有名字的环路、高速、快速路和主干道（motorway / trunk / primary 和它们的匝道不算——匝道跟着
 * 自己的名字走，多半没名字）。返回表里的键，不在返回 ''。
 */
export function flowKey(name: string | undefined | null, cls: string): string {
  if (!name || !(cls === 'motorway' || cls === 'trunk' || cls === 'primary')) return '';
  return short(name);
}
/** 环路和高速、快速路（高峰堵得更厉害的那一类）。 */
export const isRing = (key: string): boolean => RING.test(key) || FAST.test(key);

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

export const rushHour = (hour: number): boolean => (hour >= 7 && hour < 9.5) || (hour >= 17 && hour < 19.5);

/** 这个钟点一格路是拥堵、缓行的机会：[拥堵, 拥堵或缓行]。 */
export function odds(hour: number, ring: boolean): [number, number] {
  if (hour >= 22 || hour < 6) return [0, 0.08];
  if (rushHour(hour)) return ring ? [0.4, 0.9] : [0.2, 0.7];
  return ring ? [0.08, 0.35] : [0.05, 0.28];
}

/**
 * 路 `key` 往 `dir` 方向（`headingOf`）在 (x, z) 那一格、`hour` 点、第 `slot` 个时段的路况。不在表里的路（key 是 ''）
 * 永远畅通。
 */
export function levelAt(key: string, dir: string, x: number, z: number, hour: number, slot: number): Level {
  if (!key) return 0;
  const r = hash(`${key}|${dir}|${Math.floor(x / CELL)}|${Math.floor(z / CELL)}|${slot}`);
  const [jam, slow] = odds(hour, isRing(key));
  return r < jam ? 2 : r < slow ? 1 : 0;
}

/** 一条路在 (x, z) 那一格两个方向里差的那个（交通台只说路名，不分方向）。`along`：这条路大致沿哪个轴，'x' 东西向、'z' 南北向。 */
export function worstAt(key: string, along: 'x' | 'z', x: number, z: number, hour: number, slot: number): Level {
  const a = along === 'x' ? ['E', 'W'] : ['S', 'N'];
  return Math.max(levelAt(key, a[0], x, z, hour, slot), levelAt(key, a[1], x, z, hour, slot)) as Level;
}

/** 全城的车随钟点多少：半夜少一半，清早和深夜少一些，高峰多两成。哪条路都乘。 */
export function hourDensity(hour: number): number {
  if (hour < 5) return 0.55;
  if (hour < 6.5) return 0.75;
  if (rushHour(hour)) return 1.2;
  if (hour >= 22) return 0.8;
  return 1;
}

/** 钟点分成几段（密度和机会只在换段时变）：路况缓存按「时段 × 钟点段」记。 */
export const hourBand = (hour: number): number => (hour < 5 ? 0 : hour < 6 ? 1 : hour < 6.5 ? 2 : hour < 7 ? 3 : hour < 9.5 ? 4 : hour < 17 ? 5 : hour < 19.5 ? 6 : hour < 22 ? 7 : 8);

/**
 * 堵着的路段该多给的时间（秒）：出租车乘客、外卖、跑腿的时限按一个平均车速（`pace` 米每秒）算，
 * 缓行和拥堵的路段上按实际开得动的速度（限速 × SPEED × JAM_PACE）重算，多出来的就是要补的。畅通的路段不补，也不扣。
 * JAM_PACE 0.6：东三环拥堵实测 17 km/h（限速 80 × 0.32 × 0.6 = 15），缓行实测 31 km/h（× 0.6 × 0.6 = 29）。
 */
export const JAM_PACE = 0.6;
export function jamSlack(len: number, speed: number, level: Level, pace: number): number {
  if (level === 0 || len <= 0) return 0;
  return Math.max(0, len / (speed * SPEED[level] * JAM_PACE) - len / pace);
}
