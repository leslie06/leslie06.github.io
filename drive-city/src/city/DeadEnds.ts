import type { Network } from './Data';

/** A 此路不通 sign at the mouth of a dead-end branch, on the kerb, facing the drivers turning in. */
export interface DeadEndSign {
  x: number; z: number;
  /** Rotation about Y: the plate's face (local +Z) points back towards the junction. */
  yaw: number;
  /** Road metres of the branch behind the sign (every way beyond the mouth, forks included). */
  len: number;
  /** Network edge the sign stands on, and the junction node it is read from. */
  edge: number; node: number;
}

export interface DeadEnds {
  signs: DeadEndSign[];
  /** Per network edge: its end nearer the way out of the branch it is in, or -1 (not in one, or a tree with no core at all). */
  out: Int32Array;
}

/** Branches shorter than this are seen to their end from the mouth: no sign. */
export const MIN_BRANCH = 50;
/** A branch that reaches within this of the data's edge runs off the map onto open ground, not into a wall. */
const EDGE_MARGIN = 60;

/**
 * The dead ends of the drivable graph. Peeling off every node with one road at it, again and
 * again, leaves the core where every road goes on somewhere; what was peeled off is trees hanging
 * off it, and a car that turns into one can only come back the way it went in. On a lane between
 * walls that means reversing all the way out (故宫's western service road, 5 m wide, runs 1 km
 * from the palace's north-west corner down its west side and stops between two walled groves). A branch that loops back on
 * itself somewhere (a ring in a compound) stays in the core - there is room to turn there.
 *
 * Each mouth - a peeled edge at a core node - whose branch holds at least MIN_BRANCH metres of
 * road, does not run off the data, and can be driven into (not a one-way leaving it) gets a sign
 * on the right-hand kerb, clear of every carriageway round it.
 */
export function findDeadEnds(net: Network, bounds: { x0: number; z0: number; x1: number; z1: number }): DeadEnds {
  const nNodes = net.nodes.length / 2, E = net.edges;
  const adj: number[][] = Array.from({ length: nNodes }, () => []);
  const deg = new Int32Array(nNodes);
  const len = new Float64Array(E.length);
  E.forEach((e, i) => {
    if (e.a === e.b || e.p.length < 4) return;
    adj[e.a].push(i); adj[e.b].push(i); deg[e.a]++; deg[e.b]++;
    for (let k = 2; k < e.p.length; k += 2) len[i] += Math.hypot(e.p[k] - e.p[k - 2], e.p[k + 1] - e.p[k - 1]);
  });
  const pruned = new Uint8Array(E.length);
  const stack: number[] = [];
  for (let i = 0; i < nNodes; i++) if (deg[i] === 1) stack.push(i);
  while (stack.length) {
    const n = stack.pop()!;
    if (deg[n] !== 1) continue;
    for (const ei of adj[n]) {
      if (pruned[ei]) continue;
      pruned[ei] = 1;
      const o = E[ei].a === n ? E[ei].b : E[ei].a;
      deg[n]--; deg[o]--;
      if (deg[o] === 1) stack.push(o);
    }
  }
  const core = (n: number) => deg[n] > 0;
  const nearEdge = (n: number) => {
    const x = net.nodes[n * 2], z = net.nodes[n * 2 + 1];
    return x - bounds.x0 < EDGE_MARGIN || bounds.x1 - x < EDGE_MARGIN || z - bounds.z0 < EDGE_MARGIN || bounds.z1 - z < EDGE_MARGIN;
  };

  // Carriageways by 64 m cell, for keeping the post off every road near it - every cell a segment
  // passes through, not only those of its points (a 300 m avenue has two).
  const grid = new Map<string, number[]>();
  E.forEach((e, i) => {
    for (let k = 2; k < e.p.length; k += 2) {
      const ax = e.p[k - 2], az = e.p[k - 1], bx = e.p[k], bz = e.p[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 24));
      for (let j = 0; j <= n; j++) {
        const key = `${Math.floor((ax + (bx - ax) * j / n) / 64)}_${Math.floor((az + (bz - az) * j / n) / 64)}`;
        const l = grid.get(key) ?? []; if (l[l.length - 1] !== i) l.push(i); grid.set(key, l);
      }
    }
  });
  const onRoad = (x: number, z: number) => {
    const cx = Math.floor(x / 64), cz = Math.floor(z / 64);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const ei of grid.get(`${cx + i}_${cz + j}`) ?? []) {
      const e = E[ei], p = e.p;
      for (let k = 2; k < p.length; k += 2) {
        const ax = p[k - 2], az = p[k - 1], vx = p[k] - ax, vz = p[k + 1] - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) < e.w / 2 + 0.5) return true;
      }
    }
    return false;
  };

  const signs: DeadEndSign[] = [];
  const out = new Int32Array(E.length).fill(-1);
  for (let ei = 0; ei < E.length; ei++) {
    if (!pruned[ei]) continue;
    const e = E[ei];
    const node = core(e.a) ? e.a : core(e.b) ? e.b : -1;
    if (node < 0) continue;
    // Walk the whole branch beyond the mouth, noting which way is out on every edge of it.
    let total = 0, offMap = false;
    const seen = new Set<number>([ei]), todo: [number, number][] = [[ei, node]];
    while (todo.length) {
      const [k, from] = todo.pop()!;
      total += len[k];
      out[k] = from;
      const to = E[k].a === from ? E[k].b : E[k].a;
      if (nearEdge(to)) offMap = true;
      for (const nk of adj[to]) if (pruned[nk] && !seen.has(nk)) { seen.add(nk); todo.push([nk, to]); }
    }
    if (offMap || total < MIN_BRANCH) continue;
    // A one-way leaving the branch: nobody turns in here legally.
    if (e.o && node === e.b) continue;
    // Off a raised road there is no kerb to stand on.
    if (e.h && Math.max(...e.h) > 0.3) continue;

    // Into the branch from the junction: past the widest road meeting there, clamped to this edge.
    let hwOther = 3;
    for (const k of adj[node]) if (k !== ei) hwOther = Math.max(hwOther, E[k].w / 2);
    const fwd = node === e.a, m = e.p.length / 2;
    const pt = (i: number): [number, number] => { const j = fwd ? i : m - 1 - i; return [e.p[j * 2], e.p[j * 2 + 1]]; };
    const place = (s: number): DeadEndSign | null => {
      s = Math.min(s, len[ei] - 1);
      let acc = 0;
      for (let i = 1; i < m; i++) {
        const [ax, az] = pt(i - 1), [bx, bz] = pt(i), L = Math.hypot(bx - ax, bz - az);
        if (acc + L < s && i < m - 1) { acc += L; continue; }
        const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0, dx = (bx - ax) / (L || 1), dz = (bz - az) / (L || 1);
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, off = e.w / 2 + 0.7;
        // Right of travel in (x, z) with +X east and +Z south is (-dz, dx); the left kerb if the right is taken.
        for (const side of [1, -1]) {
          const sx = x - dz * off * side, sz = z + dx * off * side;
          if (!onRoad(sx, sz)) return { x: sx, z: sz, yaw: Math.atan2(-dx, -dz), len: total, edge: ei, node };
        }
        return null;
      }
      return null;
    };
    const sign = place(hwOther + 3.5) ?? place(hwOther + 9);
    if (sign && !signs.some((o) => Math.hypot(o.x - sign.x, o.z - sign.z) < 3)) signs.push(sign);
  }
  return { signs, out };
}
