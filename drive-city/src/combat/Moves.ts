import { STRIKE, type StrikeAction } from '../character/Animator';

/**
 * The player's side of a fist fight (combat/), as data and pure functions (Node-tested): the combo string, the
 * counter, the block, and who a strike goes for.
 */

/** Tap, tap, tap, tap: jab, cross, hook, and a kick that puts them down. */
export const COMBO: readonly { action: StrikeAction; dmg: number; knock: boolean }[] = [
  { action: 'jab', dmg: 9, knock: false },
  { action: 'cross', dmg: 11, knock: false },
  { action: 'hook', dmg: 14, knock: false },
  { action: 'kick', dmg: 20, knock: true },
];
/** The counter: an uppercut into the one winding up, which always lands and puts them down. */
export const COUNTER = { action: 'uppercut' as StrikeAction, dmg: 28, knock: true };
/** The block: how long it is held, and what share of a blow still gets through. */
export const BLOCK = { secs: 0.55, through: 0.25 };
/**
 * The finisher (环境处决): a fighter softened up (reeling from a blow, or at half health or less) with a car or a wall
 * within `back` m behind him, seen from the player, is kicked flying into it - out at once. `dmg` is enough for any.
 * The reach is generous (a fight keeps them a metre or two off the player, the cars round it 4-6 m out).
 */
export const FINISH = { action: 'kick' as StrikeAction, back: 3.5, soft: 0.5, dmg: 999 };
/** Whether a fighter in `state` at `hp` of `max` is soft enough for a finisher (the surface is the caller's ray). */
export function softened(state: string, hp: number, max: number): boolean {
  return state === 'flinch' || (hp <= max * FINISH.soft && (state === 'circle' || state === 'approach' || state === 'recover' || state === 'close'));
}
/** A strike goes for someone within this (it steps in up to `LUNGE` to reach), and lands within `REACH` in front. */
export const SEEK = 4.2, LUNGE = 2.4, REACH = 1.75, STAND_OFF = 1.0;
/** A press within this long after a strike ends carries the combo on; later starts it again. */
export const CHAIN_GAP = 0.5;

/** How long a strike plays, when its blow lands, and from when the next press may cut it short. */
export function timing(a: StrikeAction): { secs: number; hit: number; chainFrom: number } {
  const s = STRIKE[a];
  return { secs: s.dur, hit: s.hit, chainFrom: s.hit + 0.06 };
}

/**
 * Who a strike goes for: the nearest of `cands` (standing fighters) within SEEK, favouring the way the player is
 * pushing the stick (or facing): a fighter behind costs as much as 2.5 m more distance. -1 for nobody.
 */
export function pickTarget(px: number, pz: number, dirX: number, dirZ: number, cands: readonly { x: number; z: number }[]): number {
  let best = -1, bs = Infinity;
  const dl = Math.hypot(dirX, dirZ) || 1;
  for (let i = 0; i < cands.length; i++) {
    const dx = cands[i].x - px, dz = cands[i].z - pz, d = Math.hypot(dx, dz);
    if (d > SEEK) continue;
    const cos = d > 1e-3 ? (dx * dirX + dz * dirZ) / (d * dl) : 1;
    const s = d + (1 - cos) * 1.25;
    if (s < bs) { bs = s; best = i; }
  }
  return best;
}

/** Whether a blow from (px, pz) facing `yaw` reaches (x, z): within REACH and within 75 degrees of straight ahead. */
export function inReach(px: number, pz: number, yaw: number, x: number, z: number, reach = REACH): boolean {
  const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
  if (d > reach) return false;
  if (d < 0.4) return true;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d > Math.cos(75 * Math.PI / 180);
}

/** The combo's place: which strike a press gives, given when the last one ended. */
export class Combo {
  private i = 0;
  private endAt = -Infinity;
  /** The strike a press at `now` (seconds) would give. */
  next(now: number): number { return now - this.endAt > CHAIN_GAP ? 0 : this.i; }
  /** The strike `k` started at `now`: the next press carries on from it until it has ended CHAIN_GAP ago. */
  started(k: number, now: number): void { this.i = (k + 1) % COMBO.length; this.endAt = now + STRIKE[COMBO[k].action].dur; }
  reset(): void { this.i = 0; this.endAt = -Infinity; }
}
