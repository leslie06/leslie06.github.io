import { describe, expect, it } from 'vitest';
import { CUP, WaterCup } from './WaterCup';

const DT = 1 / 60, G = 9.81;
/** Run a cup through an acceleration profile (g, x left / z forward, as a function of time) for `secs`. */
const run = (secs: number, prof: (t: number) => [number, number], cup = new WaterCup()) => {
  for (let t = 0; t < secs; t += DT) { const [x, z] = prof(t); cup.step(DT, x * G, z * G); }
  return cup;
};
const ramp = (t: number, t0: number, t1: number) => Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));

describe('WaterCup', () => {
  it('holds still on a steady road', () => {
    expect(run(10, () => [0, 0]).level).toBe(1);
  });

  it('a smooth corner at 0.6 g spills nothing', () => {
    // in over 0.8 s, held 3 s, out over 0.8 s
    const cup = run(6, (t) => [0.6 * (ramp(t, 0, 0.8) - ramp(t, 3.8, 4.6)), 0]);
    expect(cup.level).toBe(1);
  });

  it('the same corner thrown in at once slops over', () => {
    const cup = run(6, (t) => [t < 3 ? 0.62 : 0, 0]);
    expect(cup.level).toBeLessThan(1);
    expect(cup.level).toBeGreaterThan(0.9);
  });

  it('a jerky slalom spills more than one smooth corner at the same force', () => {
    const smooth = run(6, (t) => [0.62 * (ramp(t, 0, 0.8) - ramp(t, 3.8, 4.6)), 0]);
    const slalom = run(6, (t) => [Math.floor(t / 0.6) % 2 ? 0.62 : -0.62, 0]);
    expect(slalom.level).toBeLessThan(smooth.level - 0.05);
  });

  it('an emergency stop spills a fair share but not the lot', () => {
    const cup = run(4, (t) => [0, t < 2 ? -0.95 : 0]);
    expect(cup.level).toBeLessThan(0.9);
    expect(cup.level).toBeGreaterThan(0.5);
  });

  it('a hard drift held long settles where the emptier cup holds it', () => {
    const cup = run(20, () => [0.95, 0]);
    // the rim holds 0.95 g once the level is down to 1 - (0.95 - rim) / rimEmpty
    expect(cup.level).toBeCloseTo(1 - (0.95 - CUP.rim) / CUP.rimEmpty, 1);
    expect(cup.empty).toBe(false);
  });

  it('a crash throws water out at once; small knocks do not', () => {
    const cup = new WaterCup();
    expect(cup.impact(2)).toBe(0);
    const out = cup.impact(10);
    expect(out).toBeGreaterThan(0.2);
    expect(out).toBeLessThan(0.45);
  });

  it('is empty after enough crashes', () => {
    const cup = new WaterCup();
    for (let i = 0; i < 5; i++) cup.impact(20);
    expect(cup.empty).toBe(true);
  });
});
