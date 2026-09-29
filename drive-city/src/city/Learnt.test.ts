/**
 * The buildings OSM lacks (machine-learnt footprints, ids 8e12..9e12, scripts/city/extra-buildings.mjs)
 * on the real tiles: they are there in numbers, none stands in a carriageway on the ground, none is in
 * the palace or the temple, and the heights they brought look like Beijing (courtyard houses stay low).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BuildingRec, Manifest, RoadPiece } from './Data';

const dir = fileURLToPath(new URL('../../public/city/', import.meta.url));
const man = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8')) as Manifest;
const tiles = new Map<string, { buildings: BuildingRec[]; roads: RoadPiece[] }>();
for (const k of Object.keys(man.tiles)) tiles.set(k, JSON.parse(fs.readFileSync(`${dir}t_${k}.json`, 'utf8')));
const learnt = (b: BuildingRec) => b.i >= 8e12 && b.i < 9e12;
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
  return Math.hypot(x - ax - vx * t, z - az - vz * t);
}

describe('learnt buildings', () => {
  const all = [...tiles.values()].flatMap((t) => t.buildings.filter(learnt));

  it('fill what OSM lacks', () => {
    expect(all.length).toBeGreaterThan(30000);
  });

  it('never stand in a carriageway', () => {
    let bad = 0;
    const where: string[] = [];
    for (const [k, t] of tiles) {
      const [ix, iz] = k.split('_').map(Number);
      const roads: RoadPiece[] = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roads.push(...(tiles.get(`${ix + dx}_${iz + dz}`)?.roads ?? []).filter((r) => CAR.test(r.c) && !r.h));
      for (const b of t.buildings) {
        if (!learnt(b)) continue;
        let cx = 0, cz = 0;
        for (let i = 0; i < b.o.length; i += 2) { cx += b.o[i]; cz += b.o[i + 1]; }
        cx /= b.o.length / 2; cz /= b.o.length / 2;
        const hit = roads.some((r) => { for (let i = 0; i + 3 < r.p.length; i += 2) if (segDist(cx, cz, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) < r.w / 2 - 0.5) return true; return false; });
        if (hit) { bad++; if (where.length < 5) where.push(`${b.i} @${cx.toFixed(0)},${cz.toFixed(0)}`); }
      }
    }
    expect(bad, where.join(' ')).toBe(0);
  });

  it('stay out of the palace and the temple, and keep the hutongs low', () => {
    // The palace box (build.mjs zone()): no learnt footprint inside.
    const inPalace = all.filter((b) => { const x = b.o[0], z = b.o[1]; return x > -900 && x < -200 && z > -1400 && z < -450; });
    expect(inPalace.length).toBe(0);
    // Round 南池子 (tile 0_-1, courtyard houses of 4-6 m) most buildings stay under 8 m.
    const t = tiles.get('0_-1')!.buildings;
    expect(t.filter((b) => b.h < 8).length / t.length).toBeGreaterThan(0.6);
  });
});
