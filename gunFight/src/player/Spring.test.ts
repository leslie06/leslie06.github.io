import { describe, it, expect } from 'vitest';
import { expDamp, expDampAngle, springCoefs, Spring1, Spring3, noise1, smoothstep } from './Spring';

describe('expDamp', () => {
  it('is frame-rate independent', () => {
    let a = 0; for (let i = 0; i < 60; i++) a = expDamp(a, 1, 8, 1 / 60);
    const b = expDamp(0, 1, 8, 1);
    expect(a).toBeCloseTo(b, 9);
  });
  it('never overshoots', () => {
    expect(expDamp(0, 1, 50, 10)).toBeLessThanOrEqual(1);
    expect(expDamp(0, 1, 50, 10)).toBeGreaterThan(0.999);
  });
  it('dt=0 is a no-op', () => { expect(expDamp(0.3, 1, 8, 0)).toBe(0.3); });
  it('angles take the short way round', () => {
    const v = expDampAngle(Math.PI - 0.1, -Math.PI + 0.1, 1e6, 1);
    expect(Math.atan2(Math.sin(v - (-Math.PI + 0.1)), Math.cos(v - (-Math.PI + 0.1)))).toBeCloseTo(0, 6);
  });
});

describe('springCoefs / Spring1', () => {
  for (const zeta of [0.3, 1, 1.8]) {
    it(`zeta=${zeta}: one 0.1 s step equals ten 0.01 s steps`, () => {
      const a = new Spring1(25, zeta); a.x = 1; a.v = -3;
      const b = new Spring1(25, zeta); b.x = 1; b.v = -3;
      a.step(0, 0.1);
      for (let i = 0; i < 10; i++) b.step(0, 0.01);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.v).toBeCloseTo(b.v, 9);
    });
    it(`zeta=${zeta}: converges to the target`, () => {
      const s = new Spring1(25, zeta); s.x = 1;
      for (let i = 0; i < 600; i++) s.step(0.5, 1 / 60);
      expect(s.x).toBeCloseTo(0.5, 5);
      expect(Math.abs(s.v)).toBeLessThan(1e-4);
    });
  }
  it('critically damped never crosses the target', () => {
    const s = new Spring1(20, 1); s.x = 1;
    for (let i = 0; i < 300; i++) { s.step(0, 1 / 60); expect(s.x).toBeGreaterThanOrEqual(-1e-12); }
  });
  it('under-damped overshoots after a kick and returns', () => {
    const s = new Spring1(30, 0.42); s.kick(5);
    let peak = 0, crossed = false;
    for (let i = 0; i < 240; i++) { s.step(0, 1 / 60); peak = Math.max(peak, s.x); if (s.x < 0) crossed = true; }
    expect(peak).toBeGreaterThan(0.05);
    expect(crossed).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });
  it('a kick of omega*1.6*A peaks near A (recoil calibration)', () => {
    const s = new Spring1(30, 0.42); s.kick(30 * 1.6 * 0.02);
    let peak = 0; for (let i = 0; i < 60; i++) { s.step(0, 1 / 120); peak = Math.max(peak, s.x); }
    expect(peak).toBeGreaterThan(0.015); expect(peak).toBeLessThan(0.03);
  });
  it('degenerate omega passes through', () => {
    const c = springCoefs(0, 1, 0.1); expect(c.pp).toBe(1); expect(c.vp).toBe(0);
  });
  it('Spring3 axes are independent', () => {
    const s = new Spring3(20, 0.7); s.kick(1, 0, 0);
    for (let i = 0; i < 10; i++) s.step(0, 0, 0, 1 / 60);
    expect(s.x).not.toBe(0); expect(s.y).toBe(0); expect(s.z).toBe(0);
  });
});

describe('noise1 / smoothstep', () => {
  it('noise is deterministic and bounded', () => {
    for (let t = 0; t < 50; t += 0.37) { const v = noise1(t, 3); expect(v).toBe(noise1(t, 3)); expect(Math.abs(v)).toBeLessThanOrEqual(1); }
  });
  it('smoothstep clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0); expect(smoothstep(0, 1, 2)).toBe(1); expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});
