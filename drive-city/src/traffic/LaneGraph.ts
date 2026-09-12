import type { Network } from '../city/Data';

/** One direction of travel along a network edge. Lateral offsets are left-positive of travel. */
export interface Link {
  id: number;
  from: number; to: number;
  /** Centre-line points [x, z, ...] in travel order, and cumulative arc length at each point. */
  pts: Float32Array; cum: Float32Array; len: number;
  cls: string;
  lanes: number; laneW: number; hw: number;
  oneway: boolean;
  /** Target speed, m/s. */
  speed: number;
  /** The opposite direction of the same edge, or -1. */
  rev: number;
  name: string;
  /** Unit direction at the start and the end. */
  d0x: number; d0z: number; d1x: number; d1z: number;
}

const SPEED: Record<string, number> = {
  motorway: 22, trunk: 16.7, primary: 13.9, secondary: 12.5, tertiary: 11.1, unclassified: 8.3, residential: 8.3,
  living_street: 5.5, service: 5.5, busway: 12, motorway_link: 13, trunk_link: 11, primary_link: 10, secondary_link: 9, tertiary_link: 8,
};
const RANK: Record<string, number> = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1, busway: 2 };

/**
 * Directed lanes over the drivable graph (network.json). China drives on the right: on a two-way
 * road lane 0 is next to the centre line, on the right of it; on a one-way carriageway lane 0 is
 * the leftmost (fast) lane.
 */
export class LaneGraph {
  readonly links: Link[] = [];
  readonly out: number[][];
  readonly nodeX: Float32Array; readonly nodeZ: Float32Array;
  readonly sig: Uint8Array;
  private grid = new Map<string, number[]>();

  constructor(readonly net: Network) {
    const n = net.nodes.length / 2;
    this.nodeX = new Float32Array(n); this.nodeZ = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.nodeX[i] = net.nodes[i * 2]; this.nodeZ[i] = net.nodes[i * 2 + 1]; }
    this.sig = Uint8Array.from(net.sig);
    this.out = Array.from({ length: n }, () => []);
    for (const e of net.edges) {
      if (e.p.length < 4) continue;
      const make = (fwd: boolean): Link => {
        const m = e.p.length / 2, pts = new Float32Array(e.p.length), cum = new Float32Array(m);
        for (let k = 0; k < m; k++) { const i = fwd ? k : m - 1 - k; pts[k * 2] = e.p[i * 2]; pts[k * 2 + 1] = e.p[i * 2 + 1]; }
        for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
        const lanes = e.o ? (e.l || Math.max(1, Math.round(e.w / 3.3))) : Math.max(1, e.l ? Math.round(e.l / 2) : Math.floor(e.w / 2 / 3.1));
        const laneW = (e.o ? e.w : e.w / 2) / lanes;
        const dir = (a: number, b: number) => { const dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
        const [d0x, d0z] = dir(0, 1), [d1x, d1z] = dir(m - 2, m - 1);
        return { id: this.links.length, from: fwd ? e.a : e.b, to: fwd ? e.b : e.a, pts, cum, len: cum[m - 1], cls: e.c, lanes, laneW, hw: e.w / 2, oneway: !!e.o,
          speed: SPEED[e.c] ?? 8, rev: -1, name: e.n ?? '', d0x, d0z, d1x, d1z };
      };
      const f = make(true);
      this.add(f);
      if (!e.o) { const r = make(false); this.add(r); f.rev = r.id; r.rev = f.id; }
    }
  }

  private add(l: Link): void {
    this.links.push(l);
    this.out[l.from].push(l.id);
    for (let k = 0; k < l.pts.length; k += 2) {
      const key = `${Math.floor(l.pts[k] / 64)}_${Math.floor(l.pts[k + 1] / 64)}`;
      const list = this.grid.get(key) ?? [];
      if (list[list.length - 1] !== l.id) list.push(l.id);
      this.grid.set(key, list);
    }
  }

  laneOffset(l: Link, lane: number): number {
    return l.oneway ? l.hw - (lane + 0.5) * l.laneW : -(lane + 0.5) * l.laneW;
  }

  /** Position and direction at arc length `s` along link `l`, `off` metres left of the centre line. */
  at(l: Link, s: number, off: number, out: { x: number; z: number; dx: number; dz: number }): typeof out {
    const m = l.cum.length;
    s = Math.max(0, Math.min(l.len, s));
    let k = 1;
    while (k < m - 1 && l.cum[k] < s) k++;
    const s0 = l.cum[k - 1], s1 = l.cum[k], t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], bx = l.pts[k * 2], bz = l.pts[k * 2 + 1];
    let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    // Left of travel in (x, z) with +X east and +Z south is (dz, -dx).
    out.x = ax + (bx - ax) * t + dz * off; out.z = az + (bz - az) * t - dx * off;
    out.dx = dx; out.dz = dz;
    return out;
  }

  /** Arc length on `l` closest to (x, z), searched near `hint`. */
  project(l: Link, x: number, z: number, hint: number): { s: number; d: number } {
    let best = { s: hint, d: Infinity };
    for (let k = 1; k < l.cum.length; k++) {
      if (l.cum[k] < hint - 25 || l.cum[k - 1] > hint + 40) continue;
      const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], bx = l.pts[k * 2], bz = l.pts[k * 2 + 1];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d < best.d) best = { s: l.cum[k - 1] + t * Math.sqrt(L2), d };
    }
    return best;
  }

  /** Pick the link to take after `id`: mostly straight on, stays on its class, no U-turns if avoidable. */
  next(id: number, rnd: () => number): number {
    const l = this.links[id];
    const cand = this.out[l.to].filter((c) => c !== l.rev);
    const list = cand.length ? cand : this.out[l.to];
    if (!list.length) return l.rev >= 0 ? l.rev : id;
    let best = list[0], bs = -Infinity;
    for (const c of list) {
      const o = this.links[c];
      const straight = l.d1x * o.d0x + l.d1z * o.d0z;
      const score = straight * 1.2 + (o.cls === l.cls ? 0.4 : 0) + (RANK[o.cls] ?? 0) * 0.08 - (o.cls === 'service' ? 1 : 0) - (o.len < 8 ? 0.3 : 0) + rnd() * 0.9;
      if (score > bs) { bs = score; best = c; }
    }
    return best;
  }

  /** Links with a point in the 64 m cells overlapping the square around (x, z). */
  near(x: number, z: number, r: number): number[] {
    const out = new Set<number>();
    for (let cx = Math.floor((x - r) / 64); cx <= Math.floor((x + r) / 64); cx++)
      for (let cz = Math.floor((z - r) / 64); cz <= Math.floor((z + r) / 64); cz++)
        for (const id of this.grid.get(`${cx}_${cz}`) ?? []) out.add(id);
    return [...out];
  }
}
