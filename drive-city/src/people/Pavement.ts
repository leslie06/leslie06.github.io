import type { LaneGraph } from '../traffic/LaneGraph';

/** Pavement width by road class. Keep in step with city/Roads.ts, which draws them. */
export const SIDEWALK: Record<string, number> = { trunk: 4.5, primary: 4.5, secondary: 4, tertiary: 3.5, unclassified: 2.5, residential: 2.5, busway: 3 };

/** A point on a pavement: world position, the road it belongs to, which side, the road direction there. */
export interface Kerb { x: number; z: number; link: number; s: number; side: number; dx: number; dz: number }

/**
 * The pavement point nearest (x, z) within `r` metres, `off` metres in from the kerb, on the side
 * of the road that (x, z) is on (one-way carriageways have their pavement on the right). Null when
 * no road with a pavement is that close.
 */
export function nearestKerb(g: LaneGraph, x: number, z: number, r: number, off = 0.8): Kerb | null {
  let best: Kerb | null = null, bd = r;
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const id of g.near(x, z, r)) {
    const l = g.links[id], w = SIDEWALK[l.cls] ?? 0;
    if (!w || (l.rev >= 0 && l.rev < id)) continue;
    for (let k = 1; k < l.cum.length; k++) {
      const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], vx = l.pts[k * 2] - ax, vz = l.pts[k * 2 + 1] - az;
      const L2 = vx * vx + vz * vz || 1, L = Math.sqrt(L2);
      const u = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const cx = ax + vx * u, cz = az + vz * u;
      const lat = ((x - cx) * vz - (z - cz) * vx) / L;   // left of travel is (dz, -dx)
      const side = l.oneway ? -1 : lat >= 0 ? 1 : -1;
      const s = l.cum[k - 1] + u * L;
      g.at(l, s, side * (l.hw + Math.min(off, w - 0.3)), at);
      const d = Math.hypot(at.x - x, at.z - z);
      if (d < bd) { bd = d; best = { x: at.x, z: at.z, link: id, s, side, dx: at.dx, dz: at.dz }; }
    }
  }
  return best;
}
