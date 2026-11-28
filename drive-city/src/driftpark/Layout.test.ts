import { describe, expect, it } from 'vitest';
import { COURSE, courseLength, courseLine, DONUT, EIGHT, GRID, PARK, STATIONS, TEST_LANE, onGridRoad } from './Layout';

describe('drift park layout', () => {
  const pts = courseLine(2);

  it('the course is one smooth closed loop', () => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(2.05);
      // the heading turns at most what the tightest corner allows over 2 m
      const dh = Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h));
      expect(Math.abs(dh)).toBeLessThan(2 / 12);
      // and it is the way the line goes
      expect(Math.abs(Math.atan2(Math.sin(Math.atan2(b.x - a.x, b.z - a.z) - a.h), Math.cos(Math.atan2(b.x - a.x, b.z - a.z) - a.h)))).toBeLessThan(0.12);
    }
    expect(courseLength(pts)).toBeGreaterThan(900);
  });

  it('nowhere does the course come back near itself', () => {
    const L = courseLength(pts);
    let closest = Infinity;
    for (let i = 0; i < pts.length; i += 2) for (let j = i + 2; j < pts.length; j += 2) {
      const along = Math.min(Math.abs(pts[j].s - pts[i].s), L - Math.abs(pts[j].s - pts[i].s));
      if (along < 70) continue;
      closest = Math.min(closest, Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z));
    }
    // both halves of the road and a barrier either side
    expect(closest).toBeGreaterThan(COURSE.width + 6);
  });

  it('keeps clear of the grid, the circles, the walls and the gate', () => {
    const edge = COURSE.width / 2 + 2;
    for (const p of pts) {
      expect(Math.abs(p.x)).toBeLessThan(PARK.half - edge);
      expect(Math.abs(p.z)).toBeLessThan(PARK.half - edge);
      expect(onGridRoad(p.x, p.z, edge)).toBe(false);
      expect(Math.hypot(p.x - DONUT.x, p.z - DONUT.z)).toBeGreaterThan(30 + edge);
      for (const s of [-1, 1]) expect(Math.hypot(p.x - EIGHT.cx, p.z - (EIGHT.cz + s * EIGHT.r))).toBeGreaterThan(EIGHT.r + EIGHT.lane / 2 + edge);
      expect(Math.hypot(p.x - PARK.spawn.x, p.z - PARK.spawn.z)).toBeGreaterThan(40);
    }
  });

  it('every station sits on its own ground', () => {
    const at = (id: string) => STATIONS.find((s) => s.id === id)!;
    expect(onGridRoad(at('junction').x, at('junction').z)).toBe(true);
    expect(at('junction').x).toBeLessThan(TEST_LANE.x);   // the right-hand lane northbound is east of the centre
    expect(onGridRoad(at('grid').x, at('grid').z)).toBe(true);
    const c = at('course');
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z)))).toBeLessThan(1);
    expect(c.z).toBeLessThan(COURSE.startZ);
    // the test lane runs into the grid's first road from the south
    expect(TEST_LANE.zStop).toBeLessThan(GRID.zs[0] - GRID.width / 2);
  });
});
