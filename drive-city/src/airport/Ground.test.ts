import { describe, expect, it } from 'vitest';
import { loadAirfield } from './Data';
import { ServiceNet } from './Ground';

/** 空侧勤务道连成的图（airport/Ground.ts）：用真的 airfield.json。 */
describe('ServiceNet', async () => {
  const d = await loadAirfield();
  const N = new ServiceNet(d);

  it('切成边、连成一大片', () => {
    expect(N.edges.length).toBeGreaterThan(d.roads.length);
    for (const e of N.edges) expect(e.s1 - e.s0).toBeGreaterThan(0.99);
    // 每条边的两头确实挂在节点上，节点离边的端点不超过 6 米（并点的半径）
    const p = { x: 0, z: 0, dx: 0, dz: 1 };
    for (const [i, e] of N.edges.entries()) {
      N.at(e.road, e.s0, p);
      expect(Math.hypot(N.nodes[e.a].x - p.x, N.nodes[e.a].z - p.z)).toBeLessThan(6.01);
      expect(N.nodes[e.a].out.some((o) => o.e === i && o.dir === 1)).toBe(true);
      N.at(e.road, e.s1, p);
      expect(Math.hypot(N.nodes[e.b].x - p.x, N.nodes[e.b].z - p.z)).toBeLessThan(6.01);
    }
    // 最大的连通片占了大部分路（建的时候 83 / 110 公里）
    const comp = new Int32Array(N.nodes.length).fill(-1);
    let best = 0, total = 0;
    for (const e of N.edges) total += e.s1 - e.s0;
    for (let i = 0; i < N.nodes.length; i++) {
      if (comp[i] >= 0) continue;
      const st = [i]; comp[i] = i; let L = 0;
      while (st.length) {
        const n = st.pop()!;
        for (const o of N.nodes[n].out) { const E = N.edges[o.e]; L += (E.s1 - E.s0) / 2; const m = o.dir > 0 ? E.b : E.a; if (comp[m] < 0) { comp[m] = i; st.push(m); } }
      }
      best = Math.max(best, L);
    }
    expect(best / total).toBeGreaterThan(0.6);
  });

  it('nearest / edgeAt / project 对得上', () => {
    const near = N.nearest(17620, -16700, 300)!;
    expect(near).not.toBeNull();
    const e = N.edgeAt(near.road, near.s);
    const E = N.edges[e];
    expect(E.road).toBe(near.road);
    expect(near.s).toBeGreaterThanOrEqual(E.s0 - 1e-6);
    expect(near.s).toBeLessThanOrEqual(E.s1 + 1e-6);
    const p = N.at(near.road, near.s);
    expect(Math.abs(N.project(near.road, p.x, p.z, E.s0, E.s1) - near.s)).toBeLessThan(0.05);
  });
});
