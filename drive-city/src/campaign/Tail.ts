/**
 * Tailing a car without being seen (chapter 4, docs/gta-plan.md §8), as pure logic (Node-tested): the mark's
 * suspicion fills while the player is close - faster the closer, half again as fast in front of him, where he sees
 * them through the windscreen and not the mirror - holds at a sensible distance and drains further back. Too far
 * back for too long and he is lost.
 */
export const TAIL = {
  /** Right on him: suspicion per second. */
  CLOSE: 8, CLOSE_RATE: 0.35,
  /** Closer than NEAR it fills, from NEAR_RATE at NEAR up towards CLOSE_RATE at CLOSE. */
  NEAR: 25, NEAR_RATE: 0.03,
  /** Beyond SAFE it drains. */
  SAFE: 40, DRAIN: 0.06,
  /** In front of him (seen through the windscreen) it fills this much faster. */
  AHEAD: 1.6,
  /** Further than FAR is "losing him"; past FAR for LOSE_SECS, or past GONE at all, he is lost. */
  FAR: 280, LOSE_SECS: 6, GONE: 450,
  /** A knock from the player's car: this much at once. */
  BUMP: 0.6,
  /** The tail proper begins once within CATCH of him (he sets off ahead): until then nothing is lost, for CATCH_SECS. */
  CATCH: 120, CATCH_SECS: 90,
};

export type TailState = 'ok' | 'near' | 'far' | 'spotted' | 'lost';

/** Suspicion per second at `d` metres, `ahead` of him or not (negative: draining). */
export function alertRate(d: number, ahead: boolean): number {
  const k = ahead ? TAIL.AHEAD : 1;
  if (d < TAIL.CLOSE) return TAIL.CLOSE_RATE * k;
  if (d < TAIL.NEAR) return (TAIL.NEAR_RATE + (TAIL.CLOSE_RATE - TAIL.NEAR_RATE) * (TAIL.NEAR - d) / (TAIL.NEAR - TAIL.CLOSE)) * k;
  if (d < TAIL.SAFE) return 0;
  return -TAIL.DRAIN;
}

export class Tail {
  /** 0..1: at 1 he has spotted the player. */
  alert = 0;
  /** The most it reached (the results card). */
  peak = 0;
  /** Seconds past FAR. */
  farT = 0;
  /** Within CATCH of him yet (the tail proper), and seconds spent catching up before that. */
  caught = false; catchT = 0;
  reset(): void { this.alert = 0; this.peak = 0; this.farT = 0; this.caught = false; this.catchT = 0; }
  bump(): void { this.alert = Math.min(1, this.alert + TAIL.BUMP); this.peak = Math.max(this.peak, this.alert); }
  /** One frame at `d` metres from him; returns where the tail stands. */
  update(dt: number, d: number, ahead: boolean): TailState {
    this.alert = Math.max(0, Math.min(1, this.alert + alertRate(d, ahead) * dt));
    this.peak = Math.max(this.peak, this.alert);
    if (!this.caught && d < TAIL.CATCH) this.caught = true;
    if (!this.caught) {
      this.catchT += dt;
      if (this.alert >= 1) return 'spotted';
      return this.catchT > TAIL.CATCH_SECS || d > TAIL.GONE + 300 ? 'lost' : 'far';
    }
    this.farT = d > TAIL.FAR ? this.farT + dt : 0;
    if (this.alert >= 1) return 'spotted';
    if (d > TAIL.GONE || this.farT > TAIL.LOSE_SECS) return 'lost';
    if (d > TAIL.FAR) return 'far';
    return d < TAIL.NEAR ? 'near' : 'ok';
  }
}
