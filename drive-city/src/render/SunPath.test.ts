import { describe, expect, it } from 'vitest';
import { moonAt, nightFromElevation, sunAt, sunHourAngle } from './SunPath';
import { TimeOfDay } from './TimeOfDay';

/**
 * Pins the clock -> sky mapping the design asks for (see SunPath.ts): the rest of the game keys
 * street lamps, headlights and neon off `night`, and the tod_ screenshot poses assume these times.
 */
describe('sun path', () => {
  const el = (h: number) => sunAt(h).elevationDeg;

  it('hits the design times', () => {
    expect(el(6)).toBeGreaterThan(0.5); expect(el(6)).toBeLessThan(3);          // sunrise
    expect(el(12.25)).toBeGreaterThan(58);                                       // noon ~62
    expect(el(17)).toBeGreaterThan(9); expect(el(17)).toBeLessThan(13);        // golden
    expect(el(17.5)).toBeGreaterThan(5); expect(el(17.5)).toBeLessThan(9);     // low gold
    expect(Math.abs(el(18.5))).toBeLessThan(1.5);                               // sunset
    expect(el(19.5)).toBeLessThan(-3); expect(el(19.5)).toBeGreaterThan(-7);   // blue hour
    expect(el(22)).toBeLessThan(-20);                                            // night
  });

  it('rises in the east and sets in the west (+X east, +Z south)', () => {
    expect(sunAt(7).x).toBeGreaterThan(0.3);
    expect(sunAt(17).x).toBeLessThan(-0.3);
    expect(sunAt(12.25).z).toBeGreaterThan(0.2);   // noon sun to the south
  });

  it('keeps the clock monotone and continuous through midnight', () => {
    let prev = sunHourAngle(0);
    for (let h = 0.05; h < 24; h += 0.05) {
      const H = sunHourAngle(h);
      expect(H).toBeGreaterThan(prev);
      prev = H;
    }
    expect(Math.abs(sunHourAngle(23.999) - (sunHourAngle(0) + 360))).toBeLessThan(0.1);
  });

  it('puts a full moon up at night', () => {
    expect(moonAt(22).elevationDeg).toBeGreaterThan(15);
    expect(moonAt(12.25).elevationDeg).toBeLessThan(0);
  });

  it('turns night on around sunset', () => {
    expect(nightFromElevation(el(17.5))).toBe(0);
    expect(nightFromElevation(el(19.5))).toBeGreaterThan(0.6);
    expect(nightFromElevation(el(22))).toBe(1);
  });
});

describe('time of day look', () => {
  it('is finite and in range for every hour, dry and wet', () => {
    const tod = new TimeOfDay();
    for (const rain of [0, 0.5, 1]) {
      for (let h = 0; h < 24; h += 0.5) {
        const L = tod.compute(h, rain, true);
        for (const v of [L.exposure, L.keyIntensity, L.envIntensity, L.fog.density, L.bloomThreshold, L.night]) expect(Number.isFinite(v)).toBe(true);
        for (const c of [L.keyColor, L.skyAmbient, L.horizon, L.groundRadiance, L.sunDisc]) {
          expect(Number.isFinite(c.r + c.g + c.b)).toBe(true);
          expect(Math.min(c.r, c.g, c.b)).toBeGreaterThanOrEqual(0);
        }
        expect(L.exposure).toBeGreaterThanOrEqual(0.7);
        expect(L.exposure).toBeLessThanOrEqual(7.5);
        expect(L.night).toBeGreaterThanOrEqual(0); expect(L.night).toBeLessThanOrEqual(1);
      }
    }
  });

  it('lights the day more than the night', () => {
    const tod = new TimeOfDay();
    const noon = tod.compute(12.5, 0, true).keyIntensity;
    const night = tod.compute(22, 0, true).keyIntensity;
    expect(noon).toBeGreaterThan(night * 10);
    expect(tod.compute(22, 0, true).keyIsMoon).toBe(true);
  });
});
