import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TileData } from '../Data';
import { lineOf, project } from '../Roads';
import { laneLayout, laneOffsetOf, parkingLine, PARK_W } from '../../traffic/Lanes';
import { placeFurniture } from './StreetFurniture';
import { PARK_HALF, placeParking, STRIDE } from './Parking';

const tile = (k: string) => JSON.parse(readFileSync(new URL(`../../../public/city/t_${k}.json`, import.meta.url), 'utf8')) as TileData;

describe('kerbside parking', () => {
  it('parks side streets only, clear of the outer lane', () => {
    const res = parkingLine('residential', 7, false, 0)!;
    expect(res).not.toBeNull();
    const { lanes, laneW } = laneLayout(7, false, 0);
    const traffic = -laneOffsetOf(false, lanes, laneW, 3.5, lanes - 1) + 0.92;
    expect(res.inner - traffic).toBeGreaterThanOrEqual(0.29);
    expect(res.outer - res.inner).toBeCloseTo(PARK_W);
    // half up on a 2.5 m pavement, leaving room to walk
    expect(res.outer - 3.5).toBeLessThanOrEqual(1.05);
    // a 12 m tertiary has room in the road: against the kerb
    expect(parkingLine('tertiary', 12, false, 0)!.outer).toBeCloseTo(5.85);
    for (const [c, w, o] of [['trunk', 12, true], ['primary', 13, true], ['secondary', 10, true], ['tertiary', 8, true], ['service', 5, false], ['residential', 4, false]] as const)
      expect(parkingLine(c, w, o, 0), `${c} ${w}`).toBeNull();
  });

  it('places rows by the spawn, none in a lane, another road or on a tree', () => {
    const d = tile('17_0');
    const f = placeFurniture(d.roads, d.crossings, d.stops);
    const p = placeParking(d.roads, d.crossings, d.stops, d.trees, d.lamps, f.bike, f.bin, d.ctx);
    const n = p.length / STRIDE;
    expect(n).toBeGreaterThan(20);
    const cars = d.roads.filter((r) => r.p.length >= 4 && !['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'track', 'bridleway'].includes(r.c)).map((r) => ({ r, l: lineOf(r), line: parkingLine(r.c, r.w, !!r.o, r.l) }));
    for (let i = 0; i < p.length; i += STRIDE) {
      const x = p[i], z = p[i + 1], h = p[i + 2], hl = PARK_HALF[p[i + 3]];
      const fx = Math.sin(h), fz = Math.cos(h);
      // its own road: one whose parking strip it stands in (never nearer its traffic than the strip allows)
      const own = cars.find((c) => { if (!c.line) return false; const pr = project(c.l, x, z); return pr.d > c.line.inner + PARK_W / 2 - 0.05 && pr.d < c.line.outer - PARK_W / 2 + 0.15; });
      expect(own, `car ${i / STRIDE} in no parking strip`).toBeTruthy();
      for (const [u, v] of [[hl, 0.9], [hl, -0.9], [-hl, 0.9], [-hl, -0.9]]) {
        const qx = x + fx * u + fz * v, qz = z + fz * u - fx * v;
        for (const c of cars) if (c.r !== own!.r) expect(project(c.l, qx, qz).d, `car ${i / STRIDE} corner in ${c.r.c} ${c.r.n ?? ''}`).toBeGreaterThan(c.r.w / 2);
      }
      for (let k = 0; k < d.trees.length; k += 4) {
        const dx = d.trees[k] - x, dz = d.trees[k + 1] - z;
        const inside = Math.abs(dx * fx + dz * fz) < hl && Math.abs(dx * fz - dz * fx) < PARK_W / 2;
        expect(inside, `car ${i / STRIDE} over a tree`).toBe(false);
      }
    }
  });
});
