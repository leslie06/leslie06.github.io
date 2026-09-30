/**
 * No building stands in a carriageway on the ground (「有的道路有建筑遮挡」, scripts/city/build.mjs
 * `blocksRoad`): over the old city and the CBD, every building's footprint keeps clear of every car
 * road's centre line by 45% of its half width (1.2 m in the old city's lanes, whose houses stand at the
 * kerb), except walls, buildings raised over the street and roads through a tagged passage.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BuildingRec, Manifest, RoadPiece } from './Data';

const dir = fileURLToPath(new URL('../../public/city/', import.meta.url));
const man = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8')) as Manifest;
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;
const LANES = /^(residential|service|living_street|unclassified)$/;

const pip = (x: number, z: number, o: number[]) => { let c = false; for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) if ((o[i + 1] > z) !== (o[j + 1] > z) && x < (o[j] - o[i]) * (z - o[i + 1]) / (o[j + 1] - o[i + 1]) + o[i]) c = !c; return c; };
const sd = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
const crosses = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => { const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (!d) return false; const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
function dist(ax: number, az: number, bx: number, bz: number, o: number[]): number {
  if (pip(ax, az, o) || pip(bx, bz, o)) return 0;
  let d = Infinity;
  for (let i = 0; i < o.length; i += 2) {
    const px = o[i], pz = o[i + 1], qx = o[(i + 2) % o.length], qz = o[(i + 3) % o.length];
    if (crosses(ax, az, bx, bz, px, pz, qx, qz)) return 0;
    d = Math.min(d, sd(px, pz, ax, az, bx, bz), sd(ax, az, px, pz, qx, qz), sd(bx, bz, px, pz, qx, qz));
  }
  return d;
}
const old = (x: number, z: number) => x > -4650 && x < 2850 && z > -4350 && z < 4850;

describe('roads clear of buildings', () => {
  it('has no building in a carriageway on the ground (old city and CBD)', () => {
    const load = (k: string) => (man.tiles[k] ? JSON.parse(fs.readFileSync(`${dir}t_${k}.json`, 'utf8')) as { buildings: BuildingRec[]; roads: RoadPiece[] } : null);
    const bad: string[] = [];
    let checked = 0;
    for (let ix = -18; ix <= 25; ix += 1) for (let iz = -17; iz <= 4; iz += 1) {
      if (ix > 10 && ix < 17) continue;   // the stretch between the old city and the CBD: sampled by the rest
      const t = load(`${ix}_${iz}`);
      if (!t) continue;
      const roads: RoadPiece[] = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roads.push(...(load(`${ix + dx}_${iz + dz}`)?.roads ?? []).filter((r) => CAR.test(r.c)));
      for (const b of t.buildings) {
        if (b.k === 'wall' || (b.m ?? 0) > 3.5 || b.ps) continue;
        checked++;
        let cx = 0, cz = 0;
        for (let i = 0; i < b.o.length; i += 2) { cx += b.o[i]; cz += b.o[i + 1]; }
        cx /= b.o.length / 2; cz /= b.o.length / 2;
        for (const r of roads) for (let i = 0; i + 3 < r.p.length; i += 2) {
          if (r.h && Math.max(r.h[i / 2] ?? 0, r.h[i / 2 + 1] ?? 0) > 1.5) continue;
          const hw = r.w / 2, lim = old(cx, cz) && LANES.test(r.c) ? 1.2 : Math.max(1.2, 0.45 * hw);
          if (Math.abs(r.p[i] - cx) > 400 || Math.abs(r.p[i + 1] - cz) > 400) continue;
          // 0.3 m of slack: the build tests the unsimplified ring and unrounded points.
          if (dist(r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], b.o) < lim - 0.3) { if (bad.length < 8) bad.push(`${b.i} ${r.n ?? r.c} @${cx.toFixed(0)},${cz.toFixed(0)}`); break; }
        }
      }
    }
    expect(checked).toBeGreaterThan(40000);
    expect(bad, bad.join(' | ')).toEqual([]);
  }, 180000);
});
