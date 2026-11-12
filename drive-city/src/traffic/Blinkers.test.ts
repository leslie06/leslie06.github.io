import { describe, expect, it } from 'vitest';
import type { BodyType } from '../vehicle/Bodies';
import { specLength } from '../vehicle/Bodies';
import { SPEC_OF } from '../vehicle/Spec';
import { CORNERS } from './Blinkers';

/** 交通里会打灯的车身（两轮车不打）。 */
const CARS: BodyType[] = ['sedan', 'hatch', 'suv', 'mpv', 'bus', 'truck', 'coupe', 'limo', 'super', 'ae86'];

// 车角表是在浏览器里按 glb 车模量的（`.scratch/streetlevel/blinkfit.mjs`），Node 里没有那些车模，这里只看表全不全、数靠不靠谱。
describe('转向灯的车角表', () => {
  it('每种车身都有，前灯在前、后灯在后，都在车身尺寸以内', () => {
    for (const b of CARS) {
      const c = CORNERS[b], spec = SPEC_OF[b], half = specLength(spec) / 2;
      expect(c, b).toBeDefined();
      const [fx, fy, fz, rx, ry, rz] = c!;
      expect(fz, b).toBeGreaterThan(half * 0.6); expect(fz, b).toBeLessThan(half + 0.5);
      expect(rz, b).toBeLessThan(-half * 0.6); expect(rz, b).toBeGreaterThan(-half - 0.6);
      for (const x of [fx, rx]) { expect(x, b).toBeGreaterThan(0.25); expect(x, b).toBeLessThan(1.5); }
      for (const y of [fy, ry]) { expect(y, b).toBeGreaterThan(0.2); expect(y, b).toBeLessThan(1.6); }
    }
  });
});
