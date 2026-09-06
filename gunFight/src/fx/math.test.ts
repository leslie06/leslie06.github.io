import { describe, it, expect } from 'vitest';
import { integrate, yAt, vyAt, floorHitTime, particleAt, nextRing, decalBasis, fadeWindowAlpha, pickLight, shellStep, coneDir, reflect, budgetCount, GRAVITY, NO_FLOOR } from './math';

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });

describe('integrate', () => {
  it('matches free fall when drag ~ 0', () => {
    const p = v(), vv = v();
    integrate(v(0, 10, 0), v(1, 0, 2), 1, 0, 1, p, vv);
    expect(p.x).toBeCloseTo(1, 2);
    expect(p.z).toBeCloseTo(2, 2);
    expect(p.y).toBeCloseTo(10 - 0.5 * GRAVITY, 1);
    expect(vv.y).toBeCloseTo(-GRAVITY, 1);
  });
  it('drag decays velocity toward terminal velocity', () => {
    const p = v(), vv = v();
    integrate(v(), v(5, 0, 0), 0, 2, 3, p, vv);
    expect(vv.x).toBeCloseTo(5 * Math.exp(-6), 5);
    expect(p.x).toBeCloseTo(5 * (1 - Math.exp(-6)) / 2, 5);
    integrate(v(), v(), 1, 2, 50, p, vv);
    expect(vv.y).toBeCloseTo(-GRAVITY / 2, 3); // terminal
  });
  it('no gravity means straight line', () => {
    const p = v(), vv = v();
    integrate(v(1, 1, 1), v(0, 3, 0), 0, 0, 2, p, vv);
    expect(p.y).toBeCloseTo(7, 1);
  });
  it('yAt/vyAt agree with integrate', () => {
    const p = v(), vv = v();
    integrate(v(0, 2, 0), v(0, 4, 0), 1, 1.5, 0.7, p, vv);
    expect(yAt(2, 4, 1, 1.5, 0.7)).toBeCloseTo(p.y, 9);
    expect(vyAt(4, 1, 1.5, 0.7)).toBeCloseTo(vv.y, 9);
  });
});

describe('floorHitTime', () => {
  it('finds the crossing of the floor', () => {
    const th = floorHitTime(1, 2, 1, 0.5, 0, 3);
    expect(th).toBeGreaterThan(0); expect(th).toBeLessThan(3);
    expect(yAt(1, 2, 1, 0.5, th)).toBeCloseTo(0, 4);
  });
  it('returns tMax when still above the floor', () => {
    expect(floorHitTime(5, 0, 1, 0, 0, 0.1)).toBe(0.1);
  });
});

describe('particleAt', () => {
  it('never goes below the floor and rests there', () => {
    const p = v(), vv = v();
    const rest = particleAt(v(0, 0.5, 0), v(3, 1, 0), 1, 0.3, 0, 5, p, vv);
    expect(rest).toBe(true);
    expect(p.y).toBeCloseTo(0, 6);
    expect(vv.x).toBe(0);
  });
  it('bounces: shortly after the hit the particle is above the floor', () => {
    const p = v(), vv = v();
    const th = floorHitTime(1, 0, 1, 0, 0, 2);
    particleAt(v(0, 1, 0), v(1, 0, 0), 1, 0, 0, th + 0.05, p, vv);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(th); // kept sliding forward (with friction)
  });
  it('ignores the floor sentinel', () => {
    const p = v(), vv = v();
    const rest = particleAt(v(0, 0, 0), v(0, 0, 0), 1, 0, NO_FLOOR, 2, p, vv);
    expect(rest).toBe(false);
    expect(p.y).toBeLessThan(-10);
  });
});

describe('ring + fade', () => {
  it('wraps', () => { expect(nextRing(0, 4)).toBe(1); expect(nextRing(3, 4)).toBe(0); });
  it('fades the oldest slots directly ahead of the head', () => {
    expect(fadeWindowAlpha(5, 5, 100, 10)).toBe(1);        // just written
    expect(fadeWindowAlpha(6, 5, 100, 10)).toBeCloseTo(0.1); // oldest, about to be overwritten
    expect(fadeWindowAlpha(15, 5, 100, 10)).toBe(1);
    expect(fadeWindowAlpha(0, 95, 100, 10)).toBeCloseTo(0.5); // wraps around
    expect(fadeWindowAlpha(50, 5, 100, 10)).toBe(1);
  });
});

describe('decalBasis', () => {
  it('is orthonormal and right-handed on a wall', () => {
    const o = new Float32Array(9);
    decalBasis(v(0, 0, 1), 0, true, o);
    const t = [o[0], o[1], o[2]], b = [o[3], o[4], o[5]], n = [o[6], o[7], o[8]];
    expect(b[1]).toBeCloseTo(1, 5); // sprite +y = world up
    expect(t[0]).toBeCloseTo(1, 5); // t x b = n  -> t = +x for n = +z
    expect(n[2]).toBeCloseTo(1, 5);
    const dot = t[0] * b[0] + t[1] * b[1] + t[2] * b[2];
    expect(dot).toBeCloseTo(0, 6);
  });
  it('handles a floor (normal = up) without NaN and stays orthonormal', () => {
    const o = new Float32Array(9);
    decalBasis(v(0, 1, 0), 1.2, false, o);
    for (const x of o) expect(Number.isNaN(x)).toBe(false);
    const len = Math.hypot(o[0], o[1], o[2]);
    expect(len).toBeCloseTo(1, 5);
    expect(o[0] * o[6] + o[1] * o[7] + o[2] * o[8]).toBeCloseTo(0, 6);
  });
  it('normalizes a non-unit normal', () => {
    const o = new Float32Array(9);
    decalBasis(v(0, 0, 4), 0, true, o);
    expect(o[8]).toBeCloseTo(1, 5);
  });
});

describe('pickLight', () => {
  it('prefers a free light', () => { expect(pickLight([0.5, 0, 0.2])).toBe(1); });
  it('otherwise the one closest to expiring', () => { expect(pickLight([0.5, 0.3, 0.9])).toBe(1); });
});

describe('shellStep', () => {
  it('falls, bounces, then rests', () => {
    const s = { x: 0, y: 1, z: 0, vx: 1, vy: 1, vz: 0, bounces: 0, resting: false };
    let bounced = 0;
    for (let i = 0; i < 600; i++) if (shellStep(s, 1 / 120, 0, 0.005)) bounced++;
    expect(s.resting).toBe(true);
    expect(bounced).toBeGreaterThanOrEqual(1);
    expect(s.y).toBeCloseTo(0.005, 6);
    expect(s.bounces).toBeLessThanOrEqual(3);
  });
});

describe('coneDir / reflect', () => {
  it('cone stays within the half-angle', () => {
    const o = v();
    for (let i = 0; i < 50; i++) {
      coneDir(v(0, 0, 1), 0.5, (i % 7) / 7, (i % 11) / 11, o);
      const len = Math.hypot(o.x, o.y, o.z);
      expect(len).toBeCloseTo(1, 5);
      expect(Math.acos(o.z)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
  it('cone around up axis works', () => {
    const o = v(); coneDir(v(0, 1, 0), 0.3, 0.5, 0.25, o);
    expect(o.y).toBeGreaterThan(Math.cos(0.3) - 1e-6);
  });
  it('reflect', () => { const o = v(); reflect(v(0, -1, 0), v(0, 1, 0), o); expect(o.y).toBeCloseTo(1); });
});

describe('budgetCount', () => {
  it('scales and floors at 1', () => { expect(budgetCount(10, 0.5)).toBe(5); expect(budgetCount(1, 0.1)).toBe(1); });
});
