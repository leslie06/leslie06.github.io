import { describe, expect, it } from 'vitest';
import { hhWorld, inLake, winterNow } from './Houhai';

describe('后海', () => {
  it('freezes from December to February, Beijing time (or as ?season says)', () => {
    const q = new URLSearchParams('');
    expect(winterNow(q, new Date('2026-11-04T12:00:00Z'))).toBe(false);
    expect(winterNow(q, new Date('2026-12-01T00:00:00+08:00'))).toBe(true);
    // 31 Jan 20:00 UTC is already 1 Feb in Beijing: still winter; 28 Feb 17:00 UTC is 1 Mar there: thawed
    expect(winterNow(q, new Date('2027-01-31T20:00:00Z'))).toBe(true);
    expect(winterNow(q, new Date('2027-02-28T17:00:00Z'))).toBe(false);
    expect(winterNow(new URLSearchParams('season=winter'), new Date('2026-07-01T00:00:00Z'))).toBe(true);
    expect(winterNow(new URLSearchParams('season=summer'), new Date('2026-12-15T00:00:00Z'))).toBe(false);
  });

  it('knows the lake from the road beside it', () => {
    // across 后海南沿 from the bars: 15 m out is water, the road and the bars' side are not
    const water = hhWorld(15, 60), road = hhWorld(0, 60), bars = hhWorld(-8, 60);
    expect(inLake(water.x, water.z)).toBe(true);
    expect(inLake(road.x, road.z)).toBe(false);
    expect(inLake(bars.x, bars.z)).toBe(false);
  });
});
