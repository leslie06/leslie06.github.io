// Bus stops whose shelter would stand in a carriageway (「候车亭会无故在马路生成，容易撞车」, 2026-10-02):
// the tile worker places each shelter (city/visual/StreetFurniture.ts `placeFurniture`) and checks it
// against the carriageways of its own tile only, so one by a tile's edge could stand in the next tile's
// road, and its footprint (7.4 x 2 m) was tested at its back row, not its front. Here every stop's
// shelter is placed as the game places it and tested, footprint and all, against every car road of the
// 3x3 tiles (end caps included: a junction's mouth is a road too); a stop whose shelter lands in one is
// taken out of its tile. Run by build.mjs at its end; by hand: npx tsx scripts/city/shelters.mts
import fs from 'node:fs';
import path from 'node:path';
import type { Manifest, RoadPiece, TileData } from '../../src/city/Data';
import { placeFurniture } from '../../src/city/visual/StreetFurniture';

const DIR = path.resolve('public/city');
const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as Manifest;
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;
const cache = new Map<string, TileData | null>();
const tile = (k: string) => { if (!cache.has(k)) cache.set(k, man.tiles[k] ? JSON.parse(fs.readFileSync(path.join(DIR, `t_${k}.json`), 'utf8')) : null); return cache.get(k)!; };
const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };

let stops = 0, dropped = 0, tilesChanged = 0;
const t0 = performance.now();
for (const k of Object.keys(man.tiles)) {
  const t = tile(k);
  if (!t || !t.stops.length) continue;
  const [ix, iz] = k.split('_').map(Number);
  const roads: RoadPiece[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const r of tile(`${ix + dx}_${iz + dz}`)?.roads ?? []) if (CAR.test(r.c)) roads.push(r);
  /** In a carriageway on the ground (inside its kerb), end caps included. */
  const inRoad = (x: number, z: number) => roads.some((r) => {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      if (r.h && Math.max(Math.abs(r.h[i / 2] ?? 0), Math.abs(r.h[i / 2 + 1] ?? 0)) > 1) continue;
      if (segDist(x, z, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) < r.w / 2) return true;
    }
    return false;
  });
  const keep: number[] = [];
  for (let i = 0; i < t.stops.length; i += 3) {
    stops++;
    const f = placeFurniture(t.roads, t.crossings, t.stops.slice(i, i + 3));
    let bad = false;
    for (let j = 0; j < f.shelter.length && !bad; j += 4) {
      const x = f.shelter[j], z = f.shelter[j + 2], yaw = f.shelter[j + 3], c = Math.cos(yaw), s = Math.sin(yaw);
      for (const lx of [-3.7, 0, 3.7]) for (const lz of [-1, 1.1]) if (!bad && inRoad(x + lx * c + lz * s, z - lx * s + lz * c)) bad = true;
    }
    if (bad) dropped++; else keep.push(t.stops[i], t.stops[i + 1], t.stops[i + 2]);
  }
  if (keep.length !== t.stops.length) {
    t.stops = keep;
    fs.writeFileSync(path.join(DIR, `t_${k}.json`), JSON.stringify(t));
    tilesChanged++;
  }
  if (cache.size > 300) cache.clear();
}
console.log(`bus stops: ${dropped} of ${stops} taken out (their shelter would stand in a carriageway), ${tilesChanged} tiles rewritten, ${(performance.now() - t0).toFixed(0)} ms`);
