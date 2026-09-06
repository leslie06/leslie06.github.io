import { describe, it, expect } from 'vitest';
import { BOB_STYLES, bobSample, blendStyles, bobAmplitudeForSpeed, advancePhase } from './Bob';

describe('bobSample', () => {
  it('is periodic over one gait cycle', () => {
    const a = bobSample(0.3, BOB_STYLES.walk), b = bobSample(1.3, BOB_STYLES.walk);
    expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.roll).toBeCloseTo(b.roll, 9);
  });
  it('vertical bounces twice per cycle, lateral once', () => {
    const y = (p: number) => bobSample(p, BOB_STYLES.walk).y;
    const x = (p: number) => bobSample(p, BOB_STYLES.walk).x;
    expect(y(0.25)).toBeCloseTo(y(0.75), 9);
    expect(x(0.25)).toBeCloseTo(-x(0.75), 9);
  });
  it('sprint is bigger than walk and leans forward; ads is nearly still', () => {
    let wMax = 0, sMax = 0, aMax = 0;
    for (let p = 0; p < 1; p += 0.01) {
      wMax = Math.max(wMax, Math.abs(bobSample(p, BOB_STYLES.walk).y));
      sMax = Math.max(sMax, Math.abs(bobSample(p, BOB_STYLES.sprint).y + BOB_STYLES.sprint.drop));
      aMax = Math.max(aMax, Math.abs(bobSample(p, BOB_STYLES.ads).y));
    }
    expect(sMax).toBeGreaterThan(wMax * 1.5);
    expect(aMax).toBeLessThan(wMax * 0.4);
    expect(BOB_STYLES.sprint.lean).toBeGreaterThan(0);
    expect(BOB_STYLES.tacSprint.lean).toBeGreaterThan(BOB_STYLES.sprint.lean);
  });
  it('stays within amplitude bounds', () => {
    for (const s of Object.values(BOB_STYLES)) for (let p = 0; p < 2; p += 0.013) {
      const v = bobSample(p, s);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(s.ampX + 1e-9);
      expect(Math.abs(v.y + s.drop)).toBeLessThanOrEqual(s.ampY + 1e-9);
    }
  });
});

describe('blendStyles', () => {
  it('normalises weights', () => {
    const b = blendStyles([[BOB_STYLES.walk, 2], [BOB_STYLES.sprint, 2]]);
    expect(b.ampY).toBeCloseTo((BOB_STYLES.walk.ampY + BOB_STYLES.sprint.ampY) / 2, 9);
  });
  it('zero weight gives a silent style', () => {
    const b = blendStyles([[BOB_STYLES.walk, 0]]);
    expect(b.ampY).toBe(0); expect(b.cycleLength).toBeGreaterThan(0);
  });
});

describe('amplitude and phase', () => {
  it('amplitude is 0 when still and 1 at walk speed', () => {
    expect(bobAmplitudeForSpeed(0, 4.6)).toBe(0);
    expect(bobAmplitudeForSpeed(4.6, 4.6)).toBe(1);
    expect(bobAmplitudeForSpeed(1.5, 4.6)).toBeGreaterThan(0.1);
  });
  it('counts footfalls (two per cycle) as the phase advances', () => {
    let phase = 0, steps = 0;
    for (let i = 0; i < 60; i++) { const r = advancePhase(phase, 2.9, 1 / 60, 2.9); phase = r.phase; steps += r.footfalls; }
    expect(phase).toBeCloseTo(1, 6);
    expect(steps).toBe(2);
  });
});
