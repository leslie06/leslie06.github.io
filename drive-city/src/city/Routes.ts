import type { Network, NetworkEdge } from './Data';

/** Spatial index over the drivable graph: street names, nearest edge, and a route ahead. */
export class Routes {
  private grid = new Map<string, number[]>();   // 64 m cells -> edge indices
  private out: number[][];                        // node -> outgoing edge indices (both ways for two-way edges)
  constructor(readonly net: Network) {
    this.out = Array.from({ length: net.nodes.length / 2 }, () => []);
    net.edges.forEach((e, i) => {
      this.out[e.a].push(i);
      if (!e.o) this.out[e.b].push(-i - 1);   // negative = traversed b -> a
      for (let k = 0; k < e.p.length; k += 2) {
        const key = `${Math.floor(e.p[k] / 64)}_${Math.floor(e.p[k + 1] / 64)}`;
        const l = this.grid.get(key) ?? []; if (l[l.length - 1] !== i) l.push(i); this.grid.set(key, l);
      }
    });
  }

  /** Nearest edge within `maxD` metres: index, distance, and the direction of travel there. */
  nearest(x: number, z: number, maxD = 30): { edge: NetworkEdge; index: number; d: number; dx: number; dz: number } | null {
    let best: { edge: NetworkEdge; index: number; d: number; dx: number; dz: number } | null = null;
    const cx = Math.floor(x / 64), cz = Math.floor(z / 64);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const ei of this.grid.get(`${cx + i}_${cz + j}`) ?? []) {
      const e = this.net.edges[ei];
      for (let k = 0; k + 3 < e.p.length; k += 2) {
        const ax = e.p[k], az = e.p[k + 1], bx = e.p[k + 2], bz = e.p[k + 3];
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
        if (d < maxD && (!best || d < best.d)) { const L = Math.sqrt(L2); best = { edge: e, index: ei, d, dx: vx / L, dz: vz / L }; }
      }
    }
    return best;
  }

  /** Street name at a point ('' off the network or on unnamed roads). */
  nameAt(x: number, z: number): string { return this.nearest(x, z, 25)?.edge.n ?? ''; }

  /**
   * Follow the network from (x, z) heading (hx, hz) for `length` metres, going straightest at
   * every junction. Returns [x, z] points (for the attract drive and scripted routes).
   */
  ahead(x: number, z: number, hx: number, hz: number, length: number): [number, number][] {
    const start = this.nearest(x, z, 60);
    if (!start) return [[x, z]];
    let e = start.edge, forward = start.dx * hx + start.dz * hz >= 0 || !!e.o;
    const pts: [number, number][] = [];
    let total = 0, guard = 0;
    const take = (edge: NetworkEdge, fwd: boolean) => {
      const n = edge.p.length / 2;
      for (let k = 0; k < n; k++) {
        const i = fwd ? k : n - 1 - k;
        const p: [number, number] = [edge.p[i * 2], edge.p[i * 2 + 1]];
        const last = pts[pts.length - 1];
        if (last) { const d = Math.hypot(p[0] - last[0], p[1] - last[1]); if (d < 0.5) continue; total += d; }
        pts.push(p);
      }
    };
    take(e, forward);
    while (total < length && guard++ < 400) {
      const node = forward ? e.b : e.a;
      const n = pts.length;
      const hx2 = pts[n - 1][0] - pts[Math.max(0, n - 2)][0], hz2 = pts[n - 1][1] - pts[Math.max(0, n - 2)][1];
      const hl = Math.hypot(hx2, hz2) || 1;
      let bestScore = -Infinity, next: { e: NetworkEdge; fwd: boolean } | null = null;
      for (const code of this.out[node]) {
        const ei = code >= 0 ? code : -code - 1, fwd = code >= 0;
        const cand = this.net.edges[ei];
        if (cand === e) continue;
        const p = cand.p, m = p.length;
        const [x0, z0, x1, z1] = fwd ? [p[0], p[1], p[2], p[3]] : [p[m - 2], p[m - 1], p[m - 4], p[m - 3]];
        const dl = Math.hypot(x1 - x0, z1 - z0) || 1;
        const score = ((x1 - x0) * hx2 + (z1 - z0) * hz2) / (dl * hl) + (cand.c === e.c ? 0.15 : 0) + cand.w * 0.01;
        if (score > bestScore) { bestScore = score; next = { e: cand, fwd }; }
      }
      if (!next || bestScore < 0.3) break;
      e = next.e; forward = next.fwd;
      take(e, forward);
    }
    return pts;
  }
}
