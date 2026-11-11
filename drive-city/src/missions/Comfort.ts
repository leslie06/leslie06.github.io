/**
 * 乘客满意（2026-11-11，street-level-design A7「好好开也有分」）：普通乘客从 100 分坐起，每出一件吓人的事扣一次，
 * 到站按分数给一到五颗星，星多了加小费、加班上的时间。只按事件扣，不按加减速扣：键盘的刹车只有踩死一档
 * （约 10 m/s²），按加速度扣的话键盘玩家每个红灯都丢星。只奖不罚：星再少也不扣车费。
 */
export type Rough = 'near' | 'oncoming' | 'drift' | 'air' | 'crash' | 'hard' | 'redlight' | 'ped';

/** 每件事扣多少。五星要 88 分：擦身而过能有四次，漂移一次，撞一下、闯一次灯就不是五星了。 */
export const COST: Record<Rough, number> = { near: 3, oncoming: 8, drift: 8, air: 12, crash: 14, hard: 22, redlight: 15, ped: 35 };
const STAR_MIN = [88, 70, 50, 30];
/** 同一种事多久之内只算一次（一次碰撞会连着报好几下）。 */
const AGAIN = 1.2;

export const starsOf = (value: number): number => 5 - STAR_MIN.filter((m) => value < m).length;
/** 一到五星的小费占车费的几成，和给班上加的秒数。 */
export const STAR_TIP = [0, 0, 0.1, 0.25, 0.5] as const;
export const STAR_TIME = [0, 0, 0, 2, 4] as const;
export const starText = (n: number): string => '★'.repeat(n) + '☆'.repeat(5 - n);

export class Comfort {
  value = 100;
  private t = 0;
  private last: Partial<Record<Rough, number>> = {};

  step(dt: number): void { this.t += dt; }

  /** 出了一件事。刚算过同一种的不再算（轻撞和重撞算一种）；返回这次算没算。 */
  mark(what: Rough): boolean {
    const key: Rough = what === 'hard' ? 'crash' : what, was = this.last[key];
    if (was !== undefined && this.t - was < AGAIN) return false;
    this.last[key] = this.t;
    this.value = Math.max(0, this.value - COST[what]);
    return true;
  }

  get stars(): number { return starsOf(this.value); }
}
