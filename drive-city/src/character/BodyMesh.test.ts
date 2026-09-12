import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { makeGeometry, NEAR, FAR, PART, type GeoStats } from './BodyMesh';

/**
 * The procedural person: triangle budget per LOD, a single manifold body (torso, arms, legs share
 * vertices at the shoulders and hips: no gaps, no ball joints), sane weights and blend shapes.
 */
const report: string[] = [];
describe('body mesh', () => {
  for (const [name, L, budget] of [['near', NEAR, 2600], ['far', FAR, 800]] as const) {
    it(`${name} LOD fits the budget and is well formed`, () => {
      const st: GeoStats = { vertices: 0, triangles: 0, ms: 0 };
      const g = makeGeometry(L, st);
      report.push(`${name}: ${st.triangles} tris, ${st.vertices} verts, built in ${st.ms.toFixed(0)} ms`);
      expect(st.triangles).toBeLessThanOrEqual(budget);
      const pos = g.getAttribute('position').array as Float32Array;
      const nrm = g.getAttribute('normal').array as Float32Array;
      const w = g.getAttribute('dcWeight').array as Float32Array;
      const dc = g.getAttribute('aDc').array as Float32Array;
      const mf = g.getAttribute('aMorphF').array as Float32Array, mh = g.getAttribute('aMorphH').array as Float32Array;
      for (let i = 0; i < pos.length; i++) { expect(Number.isFinite(pos[i])).toBe(true); expect(Number.isFinite(nrm[i])).toBe(true); expect(Number.isFinite(mf[i]) && Number.isFinite(mh[i])).toBe(true); }
      for (let i = 0; i < w.length / 4; i++) expect(Math.abs(w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3] - 1)).toBeLessThan(1e-4);
      let maxM = 0;
      for (let i = 0; i < mf.length; i++) maxM = Math.max(maxM, Math.abs(mf[i]), Math.abs(mh[i]));
      report.push(`  largest blend-shape delta ${maxM.toFixed(3)} m`);
      // Height: crown ~1.75, lowest point is the sole.
      let top = 0, low = 9;
      for (let i = 0; i < pos.length / 3; i++) {
        const part = dc[i * 4];
        if (part === PART.head) top = Math.max(top, pos[i * 3 + 1]);
        low = Math.min(low, pos[i * 3 + 1]);
      }
      report.push(`  crown ${top.toFixed(3)} m, lowest ${low.toFixed(3)} m`);
      expect(top).toBeGreaterThan(1.72); expect(top).toBeLessThan(1.78);
      expect(low).toBeGreaterThanOrEqual(-0.001);
      // Body manifold: every edge of the torso/arm/leg surface is shared by exactly two triangles,
      // except the neck opening (inside the head).
      const idx = g.getIndex()!.array as Uint16Array;
      const edges = new Map<string, number>();
      const bodyPart = (v: number) => dc[v * 4] <= PART.leg && dc[v * 4] !== PART.hand ? true : dc[v * 4] === PART.hand;
      for (let t = 0; t < idx.length; t += 3) {
        const tri = [idx[t], idx[t + 1], idx[t + 2]];
        if (!tri.every(bodyPart)) continue;
        if (tri.some((v) => dc[v * 4] === PART.hand && dc[v * 4 + 1] > 0.555 && dc[v * 4 + 1] < 0.565)) continue; // thumbs
        for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
      }
      let open = 0, over = 0, openTop = 0;
      for (const [key, c] of edges) {
        if (c === 1) { open++; const [a] = key.split(',').map(Number); if (pos[a * 3 + 1] > 1.53) openTop++; }
        if (c > 2) over++;
      }
      report.push(`  body edges ${edges.size}, open ${open} (neck top ${openTop}), non-manifold ${over}`);
      expect(over).toBe(0);
      expect(open).toBe(openTop);
    });
  }
  it('writes the report', () => { fs.mkdirSync('.scratch', { recursive: true }); fs.writeFileSync('.scratch/body-mesh.txt', report.join('\n') + '\n'); });
});
