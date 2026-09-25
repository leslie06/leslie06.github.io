import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Network, TileData } from './Data';
import { buildRoads } from './Roads';

const read = <T>(f: string): T => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../public/city/${f}`, import.meta.url)), 'utf8')) as T;
const net = read<Network>('network.json');

/** Heights along every edge with a height, as [grade, name, x, z] per segment. */
function segments(): { g: number; n: string; x: number; z: number; h0: number; h1: number }[] {
  const out: { g: number; n: string; x: number; z: number; h0: number; h1: number }[] = [];
  for (const e of net.edges) {
    const h = e.h;
    if (!h) continue;
    for (let i = 1; i < h.length; i++) {
      const L = Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]);
      if (L > 1) out.push({ g: Math.abs(h[i] - h[i - 1]) / L, n: e.n ?? e.c, x: e.p[i * 2], z: e.p[i * 2 + 1], h0: h[i - 1], h1: h[i] });
    }
  }
  return out;
}

/** Whether the segment p->q passes through triangle (a, b, c) (Möller–Trumbore). */
function hits(p: number[], q: number[], a: number[], b: number[], c: number[]): boolean {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < 1e-9) return false;
  const s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
  if (u < 0 || u > 1) return false;
  const qv = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
  if (v < 0 || u + v > 1) return false;
  const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
  return t > 0 && t < 1;
}

describe('the interchanges (scripts/city/build.mjs lifts OSM bridges over roads)', () => {
  it('lifts 国贸桥 and stacks 东三环 over it', () => {
    const top = (name: string) => Math.max(0, ...net.edges.filter((e) => e.n === name && e.h).map((e) => Math.max(...e.h!)));
    expect(top('国贸桥')).toBeGreaterThanOrEqual(6);
    expect(top('建国门桥')).toBeGreaterThanOrEqual(6);
    // 东三环's main line crosses 国贸桥 (a layer-1 bridge) one deck up.
    const e3 = net.edges.filter((e) => e.n === '东三环' && e.h && e.p.some((v, i) => i % 2 === 0 && Math.abs(v - 4950) < 30 && Math.abs(e.p[i + 1] - 250) < 120));
    expect(Math.max(...e3.map((e) => Math.max(...e.h!)))).toBeGreaterThanOrEqual(12.5);
  });

  it('has no cliffs: no ramp steeper than 15%', () => {
    const s = segments();
    expect(s.length).toBeGreaterThan(1500);
    // STEEP is 12%; where roads overlapping each other were brought level a short step can reach 14%.
    const bad = s.filter((x) => x.g > 0.15).map((x) => `${x.n} at ${x.x},${x.z} ${x.h0}->${x.h1}`);
    expect(bad).toEqual([]);
  });

  it('opens the parapets where a slip road leaves: nothing across 国贸桥 where its tile edge is', () => {
    // The main line crosses the tile edge x 4864 with a slip road diverging to its south; the slip
    // road's parapet used to be built straight across the main carriageway (the stretch of main line
    // on the far side of the edge is in the other tile) and stopped every car dead at x 4864.
    const col: number[] = [];
    for (const k of ['18_0', '19_0']) { const t = read<TileData>(`t_${k}.json`); buildRoads(t.roads, t.crossings, col, [], t.ctx); }
    expect(col.length).toBeGreaterThan(9 * 100);
    for (const z of [204, 206, 208, 210, 212]) {
      const p = [4830, 7.2, z], q = [4900, 7.2, z];
      let wall = false;
      for (let i = 0; i < col.length && !wall; i += 9) wall = hits(p, q, col.slice(i, i + 3), col.slice(i + 3, i + 6), col.slice(i + 6, i + 9));
      expect(wall, `a wall across the deck at z ${z}`).toBe(false);
    }
  });
});
