import { describe, expect, it } from 'vitest';
import { alongside, type Pose } from './Hijack';

/** Both heading north (-z) at `v` m/s; the target `side` m to the east (+x), `along` m ahead. */
const me: Pose = { x: 0, z: 0, fx: 0, fz: -1, vx: 0, vz: -20 };
const it_ = (side: number, along: number, o: Partial<Pose> = {}): Pose => ({ x: side, z: -along, fx: 0, fz: -1, vx: 0, vz: -20, ...o });

describe('alongside (the hijack leap)', () => {
  it('lines up side by side at speed, on either side', () => {
    expect(alongside(me, it_(2.6, 0.5)).ok).toBe(true);
    expect(alongside(me, it_(-3, -1.5)).ok).toBe(true);
  });
  it('wants it beside, not ahead, behind or across the road', () => {
    expect(alongside(me, it_(2.6, 6))).toMatchObject({ ok: false, why: 'far' });
    expect(alongside(me, it_(2.6, -6))).toMatchObject({ ok: false, why: 'far' });
    expect(alongside(me, it_(8, 0))).toMatchObject({ ok: false, why: 'far' });
    // overlapping (a crash, not a leap)
    expect(alongside(me, it_(0.4, 0))).toMatchObject({ ok: false, why: 'far' });
  });
  it('wants the same way and about the same speed', () => {
    expect(alongside(me, it_(2.6, 0, { fx: 1, fz: 0, vx: 20, vz: 0 }))).toMatchObject({ ok: false, why: 'angle' });
    expect(alongside(me, it_(2.6, 0, { vz: -30 }))).toMatchObject({ ok: false, why: 'speed' });
    expect(alongside(me, it_(2.6, 0, { vz: -25 })).ok).toBe(true);
  });
  it('works stopped too (boxed in at a light)', () => {
    expect(alongside({ ...me, vz: 0 }, it_(2.4, 0, { vz: 0 })).ok).toBe(true);
  });
});
