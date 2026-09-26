/**
 * 此路不通 signs. 「我把车开到了故宫，发现进了死胡同，开不出去了」(2026-09-26): 故宫's western service
 * road runs 1 km from the palace's north-west corner and stops between two groves, 5 m wide, with
 * nothing at its mouth to say so. `findDeadEnds` peels the graph down to the roads that go on
 * somewhere and signs the mouth of every branch left hanging off it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Manifest, Network, NetworkEdge } from './Data';
import { findDeadEnds, MIN_BRANCH } from './DeadEnds';

function net(nodes: number[], edges: [a: number, b: number, o?: 0 | 1, w?: number][]): Network {
  const e: NetworkEdge[] = edges.map(([a, b, o = 0, w = 7]) =>
    ({ a, b, c: 'residential', o, l: 0, w, p: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]] }));
  return { nodes, sig: new Array(nodes.length / 2).fill(0), edges: e };
}
const BIG = { x0: -5000, z0: -5000, x1: 5000, z1: 5000 };

describe('dead ends in a hand-built network', () => {
  //  A square block 0-1-2-3 (the core), and off corner 0:
  //    4: a 200 m lane west that forks at 4 into 5 and 6   -> one sign, the branch is 200 + 80 + 80
  //    7: a 30 m stub north                                  -> too short to need one
  //    8: a one-way coming OUT of a 150 m lane south-west    -> nobody turns into it
  //  and off corner 2 a 300 m lane east to 9, which reaches the data's edge -> open ground, no sign.
  const N = net(
    [0, 0, 200, 0, 200, 200, 0, 200, -200, 0, -280, -40, -280, 40, 0, -30, -106, 106, 500, 200],
    [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [4, 6], [0, 7], [8, 0, 1], [2, 9]],
  );
  const { signs, out } = findDeadEnds(N, { x0: -1000, z0: -1000, x1: 520, z1: 1000 });

  it('signs the forked lane once, with the whole branch behind it', () => {
    expect(signs).toHaveLength(1);
    const s = signs[0];
    expect(s.edge).toBe(4);
    expect(s.node).toBe(0);
    expect(s.len).toBeCloseTo(200 + 2 * Math.hypot(80, 40), 0);
  });

  it('knows which way is out on every edge of a branch, and of none elsewhere', () => {
    expect([...out]).toEqual([-1, -1, -1, -1, 0, 4, 4, 0, 0, 2]);
  });

  it('stands on the right-hand kerb just in, facing back to the junction', () => {
    const s = signs[0];
    // Heading west (-X) the right hand is north (-Z); the lane is 7 m wide.
    expect(s.z).toBeCloseTo(-(3.5 + 0.7), 1);
    expect(s.x).toBeLessThan(-3.5);
    expect(s.x).toBeGreaterThan(-15);
    // The face (local +Z turned by yaw) points east, back at the junction.
    expect(Math.sin(s.yaw)).toBeCloseTo(1, 5);
    expect(Math.cos(s.yaw)).toBeCloseTo(0, 5);
  });

  it('leaves a lane that loops back on itself alone', () => {
    // A lane west to a ring: there is room to turn round.
    const L = net([0, 0, 100, 0, -200, 0, -260, -40, -260, 40], [[0, 1], [1, 0], [0, 2], [2, 3], [3, 4], [4, 2]]);
    expect(findDeadEnds(L, BIG).signs).toHaveLength(0);
  });

  it('moves to the left kerb when the right one is another road', () => {
    // Off node 0 of a loop, west; a parallel road runs 6 m north of the lane, over its right kerb.
    const P = net([0, 0, 0, 300, 300, 300, 300, 0, -150, 0, 60, -6, -300, -6], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [5, 6, 0, 6]]);
    const s = findDeadEnds(P, BIG).signs.find((q) => q.edge === 4)!;
    expect(s).toBeTruthy();
    expect(s.z).toBeGreaterThan(0);
  });
});

describe('dead ends in the real city', () => {
  const read = <T>(f: string) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../public/city/${f}`, import.meta.url)), 'utf8')) as T;
  const city = read<Network>('network.json'), man = read<Manifest>('manifest.json');
  const { signs, out } = findDeadEnds(city, man.bounds);

  it('signs the palace lane the report came from', () => {
    // Its mouth is at the palace's north-west corner (-816.6, -1301.7), its end at (-722.1, -558.5).
    const s = signs.find((q) => Math.hypot(city.nodes[q.node * 2] + 816.6, city.nodes[q.node * 2 + 1] + 1301.7) < 1);
    expect(s).toBeTruthy();
    expect(s!.len).toBeGreaterThan(1000);
    expect(Math.hypot(s!.x + 816.6, s!.z + 1301.7)).toBeLessThan(15);
  });

  it('keeps every post off every carriageway', () => {
    expect(signs.length).toBeGreaterThan(300);
    for (const s of signs) {
      expect(s.len).toBeGreaterThanOrEqual(MIN_BRANCH);
      for (const e of city.edges) {
        if (Math.abs(e.p[0] - s.x) > 800 || Math.abs(e.p[1] - s.z) > 800) continue;
        for (let k = 2; k < e.p.length; k += 2) {
          const ax = e.p[k - 2], az = e.p[k - 1], vx = e.p[k] - ax, vz = e.p[k + 1] - az, L2 = vx * vx + vz * vz || 1;
          const t = Math.max(0, Math.min(1, ((s.x - ax) * vx + (s.z - az) * vz) / L2));
          expect(Math.hypot(s.x - ax - vx * t, s.z - az - vz * t)).toBeGreaterThan(e.w / 2 + 0.4);
        }
      }
    }
  });
});
