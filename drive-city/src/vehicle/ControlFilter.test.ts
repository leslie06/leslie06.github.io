import { describe, expect, it } from 'vitest';
import { ControlFilter, type DriveInput } from './ControlFilter';

const key = (steer: number): DriveInput => ({ forward: 0, back: 0, steer, analog: false, handbrake: false });
const stick = (steer: number): DriveInput => ({ forward: 0, back: 0, steer, analog: true, handbrake: false });

/** Seconds a held key takes to reach 90% of where it settles at `speed` m/s. */
function rise(sense: number, speed: number): number {
  const dt = 1 / 60;
  const settle = new ControlFilter(); settle.sense = sense;
  for (let n = 0; n < 600; n++) settle.update(key(1), speed, dt);
  const f = new ControlFilter(); f.sense = sense;
  for (let n = 1; n < 600; n++) if (f.update(key(1), speed, dt).steer >= 0.9 * settle.out.steer) return n * dt;
  return Infinity;
}

describe('方向灵敏度 (ControlFilter.sense)', () => {
  it('a quicker setting turns the wheel faster, a slower one slower', () => {
    for (const v of [0, 15, 35]) {
      expect(rise(1.5, v)).toBeLessThan(rise(1, v));
      expect(rise(0.6, v)).toBeGreaterThan(rise(1, v));
    }
  });

  it('parked, a held key reaches full lock at every setting', () => {
    for (const s of [0.6, 1, 1.5]) {
      const f = new ControlFilter(); f.sense = s;
      for (let i = 0; i < 300; i++) f.update(key(1), 0, 1 / 60);
      expect(f.out.steer).toBeCloseTo(1, 3);
    }
  });

  it('at motorway speed a held key gives more lock when quicker, never under 25%', () => {
    const held = (s: number) => { const f = new ControlFilter(); f.sense = s; for (let i = 0; i < 600; i++) f.update(key(1), 36, 1 / 60); return f.out.steer; };
    expect(held(1)).toBeCloseTo(0.5, 2);
    expect(held(1.5)).toBeGreaterThan(held(1));
    expect(held(0.6)).toBeLessThan(held(1));
    expect(held(0.6)).toBeGreaterThanOrEqual(0.25 - 1e-6);
  });

  it('a stick: half deflection steers more when quicker, full deflection is full lock', () => {
    const at = (s: number, x: number) => { const f = new ControlFilter(); f.sense = s; for (let i = 0; i < 120; i++) f.update(stick(x), 10, 1 / 60); return f.out.steer; };
    expect(at(1.5, 0.5)).toBeGreaterThan(at(1, 0.5));
    expect(at(0.6, 0.5)).toBeLessThan(at(1, 0.5));
    for (const s of [0.6, 1, 1.5]) expect(at(s, 1)).toBeCloseTo(1, 3);
  });
});
