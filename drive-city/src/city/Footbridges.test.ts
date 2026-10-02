/**
 * The subway entrances and footbridges placed by the build (scripts/city/entrances.mjs, footbridges.mjs):
 * there are as many as OSM has room for, and no kiosk, stair foot or pier stands in a carriageway on
 * the ground.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Manifest, RoadPiece } from './Data';
import type { FootbridgesFile } from './visual/Footbridges';
import { decodeRail, type RailFileV2 } from './visual/Railways';
import type { TunnelsFile } from './visual/Tunnels';
import type { EntrancesFile } from './visual/SubwayEntrances';

const dir = fileURLToPath(new URL('../../public/city/', import.meta.url));
const man = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8')) as Manifest;
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;
const tiles = new Map<string, RoadPiece[]>();
const roadsAt = (x: number, z: number): RoadPiece[] => {
  const out: RoadPiece[] = [];
  const ix = Math.floor(x / man.tile), iz = Math.floor(z / man.tile);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const k = `${ix + dx}_${iz + dz}`;
    if (!tiles.has(k)) tiles.set(k, man.tiles[k] ? (JSON.parse(fs.readFileSync(`${dir}t_${k}.json`, 'utf8')).roads as RoadPiece[]).filter((r) => CAR.test(r.c)) : []);
    out.push(...tiles.get(k)!);
  }
  return out;
};
const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
/** How far (x, z) is inside the nearest ground carriageway (negative: outside); `sunk` counts an underpass's too. */
const into = (x: number, z: number, sunk = true) => {
  let worst = -Infinity;
  for (const r of roadsAt(x, z)) for (let i = 0; i + 3 < r.p.length; i += 2) {
    if (r.h && Math.max(r.h[i / 2] ?? 0, r.h[i / 2 + 1] ?? 0) > 1) continue;
    if (!sunk && r.h && Math.min(r.h[i / 2] ?? 0, r.h[i / 2 + 1] ?? 0) < -0.5) continue;
    worst = Math.max(worst, r.w / 2 - segDist(x, z, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]));
  }
  return worst;
};

describe('street structures', () => {
  it('places subway kiosks off the carriageways', () => {
    const f = JSON.parse(fs.readFileSync(dir + 'entrances.json', 'utf8')) as EntrancesFile;
    expect(f.e.length).toBeGreaterThan(500);
    const bad = f.e.filter(([x, z]) => into(x, z) > -1.5).map(([x, z]) => `${x},${z}`);
    expect(bad, bad.join(' ')).toEqual([]);
    expect(f.e.every((e) => e[5] >= 0 && f.names[e[5]][0].length > 0)).toBe(true);
  }, 120000);

  it('puts every footbridge pier and stair foot off the carriageways', () => {
    const f = JSON.parse(fs.readFileSync(dir + 'footbridges.json', 'utf8')) as FootbridgesFile;
    expect(f.b.length).toBeGreaterThan(400);
    const bad: string[] = [];
    for (const b of f.b) {
      for (let i = 0; i < b.q.length; i += 2) if (into(b.q[i], b.q[i + 1]) > -0.3) bad.push(`pier ${b.q[i]},${b.q[i + 1]}`);
      for (const [, , , fx, fz] of b.s) if (into(fx, fz) > 0) bad.push(`foot ${fx},${fz}`);
    }
    expect(bad, bad.slice(0, 10).join(' | ')).toEqual([]);
    expect(f.b.filter((b) => b.s.length === 2).length / f.b.length).toBeGreaterThan(0.8);
    // control: the test sees carriageways - most decks are over one somewhere along them
    const over = f.b.filter((b) => { for (let i = 0; i + 3 < b.p.length; i += 2) for (let t = 0; t <= 1; t += 0.1) if (into(b.p[i] + (b.p[i + 2] - b.p[i]) * t, b.p[i + 1] + (b.p[i + 3] - b.p[i + 1]) * t) > 0) return true; return false; });
    expect(over.length / f.b.length).toBeGreaterThan(0.9);
  }, 120000);

  it('keeps the railways off the roads where they are low', () => {
    const f = decodeRail(JSON.parse(fs.readFileSync(dir + 'rail.json', 'utf8')) as RailFileV2);
    expect(f.r.length).toBeGreaterThan(1500);
    // a deck between 0.6 and 4.5 m over a carriageway is a wall or a low ceiling for traffic; piers stay off them
    const bad: string[] = [];
    let raised = 0;
    for (const r of f.r) {
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ha = r.h?.[i / 2] ?? 0, hb = r.h?.[i / 2 + 1] ?? 0;
        if (Math.max(ha, hb) > 0.6) raised++;
        for (const t of [0.25, 0.5, 0.75]) {
          const h = ha + (hb - ha) * t;
          if (h > 0.6 && h < 4.5 && into(r.p[i] + (r.p[i + 2] - r.p[i]) * t, r.p[i + 1] + (r.p[i + 3] - r.p[i + 1]) * t) > 1) { bad.push(`${r.p[i]},${r.p[i + 1]} h ${h.toFixed(1)}`); break; }
        }
      }
      for (let j = 0; r.q && j < r.q.length; j += 3) if (into(r.q[j], r.q[j + 1]) > -0.5) bad.push(`pier ${r.q[j]},${r.q[j + 1]}`);
    }
    expect(raised).toBeGreaterThan(1000);
    expect(bad, `${bad.length}: ` + bad.slice(0, 10).join(' | ')).toEqual([]);
  }, 120000);

  it('keeps the underpasses\' walls out of every carriageway on the ground', () => {
    const f = JSON.parse(fs.readFileSync(dir + 'tunnels.json', 'utf8')) as TunnelsFile;
    expect(f.t.length).toBeGreaterThan(100);
    const bad: string[] = [];
    let walls = 0;
    for (const t of f.t) for (let i = 0; i + 1 < t.h.length; i++) {
      const h = Math.min(t.h[i], t.h[i + 1]);
      if (h > -0.1 || (t.c[i] & 1)) continue;   // the open trenches: their parapets stand on the ground
      const ax = t.p[2 * i], az = t.p[2 * i + 1], bx = t.p[2 * i + 2], bz = t.p[2 * i + 3], L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (const [bit, o] of [[2, (t.l[i] + t.l[i + 1]) / 2 + 0.2], [4, -(t.w[i] + t.w[i + 1]) / 2 - 0.2]] as const) {
        if (!(t.c[i] & bit)) continue;
        walls++;
        const x = (ax + bx) / 2 + nx * o, z = (az + bz) / 2 + nz * o;
        if (into(x, z, false) > 0.8) bad.push(`${x.toFixed(1)},${z.toFixed(1)} h ${h}`);
      }
    }
    expect(walls).toBeGreaterThan(1000);
    expect(bad.length / walls, `${bad.length} of ${walls}: ` + bad.slice(0, 8).join(' | ')).toBeLessThan(0.01);
  }, 120000);
});
