import { describe, expect, it } from 'vitest';
import { buildBuildings } from './Buildings';
import type { BuildingRec } from './Data';

/**
 * A road through a building (OSM tunnel=building_passage, `BuildingRec.ps`): its walls open below the
 * clearance, the passage is lined, and nothing of the collider stands in it. Before, 11 car roads -
 * 南池子大街 through the imperial wall's gate among them - drove into a solid wall.
 */
const box = (ps?: number[]): BuildingRec => ({
  i: 1, k: 'trad', h: 12, m: 0, r: 'f', rh: 0, s: 0.5,
  o: [-6, -3, 6, -3, 6, 3, -6, 3],          // 12 x 6 m, the road runs through it along z
  ps,
});
const PS = [0, -8, 0, 8, 2.5, 4.5];         // along x = 0, half width 2.5, clearance 4.5

/** Does the segment p -> q cross any collider triangle? (Möller-Trumbore) */
function hits(v: Float32Array, idx: Uint32Array, p: number[], q: number[]): boolean {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
    const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-9) continue;
    const s = sub(p, a), u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const qv = cross(s, e1), w = dot(d, qv) / det;
    if (w < 0 || u + w > 1) continue;
    const k = dot(e2, qv) / det;
    if (k >= 0 && k <= 1) return true;
  }
  return false;
}

describe('roads through buildings', () => {
  it('a car drives through the passage and not through the walls beside it', () => {
    const { colVerts, colIdx } = buildBuildings([box(PS)]);
    for (const x of [0, -1.8, 1.8]) for (const y of [0.3, 2, 4]) expect(hits(colVerts, colIdx, [x, y, -10], [x, y, 10])).toBe(false);
    // above the clearance, and beside the passage, the building is solid
    expect(hits(colVerts, colIdx, [0, 6, -10], [0, 6, 10])).toBe(true);
    expect(hits(colVerts, colIdx, [4, 1, -10], [4, 1, 10])).toBe(true);
    // the passage's side walls: a car cannot drive out of it sideways into the building
    expect(hits(colVerts, colIdx, [0, 1, 0], [5, 1, 0])).toBe(true);
  });

  it('control: without the passage the road runs into a wall', () => {
    const { colVerts, colIdx } = buildBuildings([box()]);
    expect(hits(colVerts, colIdx, [0, 1, -10], [0, 1, 10])).toBe(true);
  });

  it('the opening is drawn: no wall below the clearance across the road, a ceiling over it', () => {
    const { facade } = buildBuildings([box(PS)]);
    const pos = facade!.getAttribute('position'), nor = facade!.getAttribute('normal'), idx = facade!.getIndex()!;
    let wallInRoad = 0, ceiling = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const ids = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const cx = ids.reduce((s, i) => s + pos.getX(i), 0) / 3, cy = ids.reduce((s, i) => s + pos.getY(i), 0) / 3;
      const ny = nor.getY(ids[0]), nz = nor.getZ(ids[0]);
      if (Math.abs(nz) > 0.9 && Math.abs(cx) < 2.4 && cy < 4.4) wallInRoad++;
      if (ny < -0.9 && Math.abs(cx) < 2.5) ceiling++;
    }
    expect(wallInRoad).toBe(0);
    expect(ceiling).toBeGreaterThan(0);
  });
});
