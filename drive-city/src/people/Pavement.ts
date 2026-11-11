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
    const l = g.links[id], w = l.hmax > 0.3 ? 0 : SIDEWALK[l.cls] ?? 0;
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

/** Links arriving at each node (LaneGraph keeps the ones leaving). */
export function inbound(g: LaneGraph): number[][] {
  const inn: number[][] = g.out.map(() => []);
  for (const l of g.links) inn[l.to].push(l.id);
  return inn;
}

/**
 * A run along the pavements from near (x, z), heading away from (ax, az): [x, z, ...] every 3 m, `len` m; null when
 * there is no pavement within 18 m or the run is under 9 m. (The snatch thief of npc/ and the getaway driver who bails
 * out in events/ run it; moved here from npc/ on 2026-11-11.)
 */
export function pavementRun(g: LaneGraph, inn: number[][], x: number, z: number, ax: number, az: number, len: number): number[] | null {
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const k = nearestKerb(g, x, z, 18, 1.2);
  if (!k) return null;
  let l = g.links[k.link], s = k.s, side = k.side;
  g.at(l, s, 0, at);
  let dir = at.dx * (x - ax) + at.dz * (z - az) >= 0 ? 1 : -1;
  const pts: number[] = [];
  let left = len, hx = at.dx * dir, hz = at.dz * dir;
  for (let guard = 0; guard < 40 && left > 0; guard++) {
    const end = dir > 0 ? l.len : 0;
    for (let u = s; dir > 0 ? u < end : u > end; u += dir * 3) {
      g.at(l, u, side * (l.hw + 0.6), at);   // along the kerb edge (a car can brush him off it)
      pts.push(at.x, at.z); hx = at.dx * dir; hz = at.dz * dir;
      if ((left -= 3) <= 0) break;
    }
    if (left <= 0) break;
    // On round the corner: the straightest road on from this node, either way along it (not back
    // the way it came). A one-way street is run against its traffic as happily as with it.
    const node = dir > 0 ? l.to : l.from;
    let best = -1, bd = -0.2, bdir = 1;
    const consider = (c: number, d: number) => {
      if (c === l.id || c === l.rev) return;
      const o = g.links[c];
      if (o.hmax > 0.3 || o.len < 4) return;
      g.at(o, d > 0 ? Math.min(4, o.len / 2) : Math.max(o.len - 4, o.len / 2), 0, at);
      const dot = (at.dx * hx + at.dz * hz) * d;
      if (dot > bd) { bd = dot; best = c; bdir = d; }
    };
    for (const c of g.out[node]) consider(c, 1);
    for (const c of inn[node]) consider(c, -1);
    if (best < 0) break;
    side = side * dir * bdir; dir = bdir; l = g.links[best]; s = dir > 0 ? 0 : l.len;
  }
  return pts.length >= 6 ? pts : null;
}
