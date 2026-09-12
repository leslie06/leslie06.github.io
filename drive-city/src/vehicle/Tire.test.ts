import { describe, it, expect } from 'vitest';
import { combine, lateralCurve, peakSlip, slideFraction, torqueAt } from './Tire';
import { TAXI } from './Spec';

describe('tyre curve', () => {
  const { B, C } = TAXI.tire;
  it('peaks between 6 and 10 degrees of slip', () => {
    const p = peakSlip(B, C);
    expect(p * 180 / Math.PI).toBeGreaterThan(6);
    expect(p * 180 / Math.PI).toBeLessThan(10);
    expect(lateralCurve(p, B, C)).toBeCloseTo(1, 5);
    expect(lateralCurve(p * 0.5, B, C)).toBeLessThan(1);
    expect(lateralCurve(p * 2, B, C)).toBeLessThan(1);
  });
  it('keeps 80-92% of peak at drift angles (35 deg), so slides are catchable', () => {
    const f = lateralCurve(35 * Math.PI / 180, B, C);
    expect(f).toBeGreaterThan(0.8);
    expect(f).toBeLessThan(0.92);
    // Fully sideways it keeps less, but never collapses.
    expect(slideFraction(C)).toBeGreaterThan(0.7);
  });
  it('is odd: sliding left pushes right', () => {
    expect(lateralCurve(-0.1, B, C)).toBeCloseTo(-lateralCurve(0.1, B, C), 10);
  });
  it('friction ellipse gives lateral grip up to longitudinal', () => {
    const o = { x: 0, y: 0 };
    combine(0, 900, 1000, 1000, o); expect(o).toEqual({ x: 0, y: 900 });
    combine(2000, 900, 1000, 1000, o); expect(o.x).toBe(1000); expect(o.y).toBe(0);
    combine(600, 900, 1000, 1000, o); expect(o.x).toBe(600); expect(o.y).toBeCloseTo(800, 6);
  });
  it('interpolates the torque table and clamps at the ends', () => {
    expect(torqueAt(TAXI.engine.torque, 0)).toBe(TAXI.engine.torque[0][1]);
    expect(torqueAt(TAXI.engine.torque, 99999)).toBe(TAXI.engine.torque.at(-1)![1]);
    expect(torqueAt([[1000, 100], [2000, 200]], 1500)).toBe(150);
  });
});
