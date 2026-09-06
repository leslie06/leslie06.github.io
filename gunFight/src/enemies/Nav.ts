/**
 * Pure navigation math: A* over a waypoint graph plus helpers. No three.js dependency so it is
 * trivially unit-testable; the AI converts THREE.Vector3 <-> tuples at the boundary.
 */
export type V3 = readonly [number, number, number];
export interface NavNode { p: V3; links: readonly number[]; comp?: number }

export function dist(a: V3, b: V3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function distXZ(a: V3, b: V3): number {
  const dx = a[0] - b[0], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

/** Index of the node closest to `p` (XZ distance + a strong penalty on height difference so rooftop islands are not picked from the street), -1 if graph empty. */
export function nearestNode(nodes: readonly NavNode[], p: V3, maxDist = Infinity, yWeight = 4): number {
  let best = -1, bd = maxDist;
  for (let i = 0; i < nodes.length; i++) {
    const d = distXZ(nodes[i].p, p) + Math.abs(nodes[i].p[1] - p[1]) * yWeight;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Binary min-heap keyed on f-score. Small, allocation-light. */
class Heap {
  items: number[] = []; keys: number[] = [];
  push(item: number, key: number): void {
    this.items.push(item); this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= this.keys[i]) break; this.swap(i, p); i = p; }
  }
  pop(): number {
    const top = this.items[0]; const last = this.items.pop()!; const lk = this.keys.pop()!;
    if (this.items.length) {
      this.items[0] = last; this.keys[0] = lk;
      let i = 0; const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < n && this.keys[l] < this.keys[m]) m = l;
        if (r < n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break; this.swap(i, m); i = m;
      }
    }
    return top;
  }
  get size(): number { return this.items.length; }
  private swap(a: number, b: number): void {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
  }
}

/**
 * A* from node index `start` to `goal`. Returns the list of node indices including both ends,
 * or null if unreachable. Optional `penalty(i)` adds cost to entering node i (used to avoid nodes
 * other squad members are heading to).
 */
export function astar(nodes: readonly NavNode[], start: number, goal: number, penalty?: (i: number) => number): number[] | null {
  if (start < 0 || goal < 0 || start >= nodes.length || goal >= nodes.length) return null;
  if (start === goal) return [start];
  const n = nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new Heap();
  g[start] = 0; open.push(start, dist(nodes[start].p, nodes[goal].p));
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) {
      const path: number[] = []; let c = goal;
      while (c !== -1) { path.push(c); c = from[c]; }
      return path.reverse();
    }
    if (closed[cur]) continue; closed[cur] = 1;
    const cp = nodes[cur].p;
    for (const nb of nodes[cur].links) {
      if (nb < 0 || nb >= n || closed[nb]) continue;
      const cost = g[cur] + dist(cp, nodes[nb].p) + (penalty ? penalty(nb) : 0);
      if (cost < g[nb]) { g[nb] = cost; from[nb] = cur; open.push(nb, cost + dist(nodes[nb].p, nodes[goal].p)); }
    }
  }
  return null;
}

/** Label connected components (undirected) so planning can pick start/goal nodes that can actually reach each other. */
export function labelComponents(nodes: NavNode[]): number {
  const n = nodes.length; const comp = new Int32Array(n).fill(-1); let c = 0;
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1) continue;
    comp[i] = c; stack.push(i);
    while (stack.length) { const k = stack.pop()!; for (const l of nodes[k].links) if (l >= 0 && l < n && comp[l] === -1) { comp[l] = c; stack.push(l); } }
    c++;
  }
  for (let i = 0; i < n; i++) nodes[i].comp = comp[i];
  return c;
}

/** Nearest node restricted to a component. */
export function nearestNodeIn(nodes: readonly NavNode[], p: V3, comp: number, yWeight = 4): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].comp !== comp) continue;
    const d = distXZ(nodes[i].p, p) + Math.abs(nodes[i].p[1] - p[1]) * yWeight;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Full path in world points from `from` to `to` through the graph (falls back to a direct segment). */
export function planPath(nodes: readonly NavNode[], from: V3, to: V3, penalty?: (i: number) => number): V3[] {
  if (nodes.length === 0) return [to];
  let s = nearestNode(nodes, from), e = nearestNode(nodes, to);
  if (s >= 0 && e >= 0 && nodes[s].comp !== undefined && nodes[s].comp !== nodes[e].comp) {
    // start in a different island than the goal: use the goal's island for the start too
    const alt = nearestNodeIn(nodes, from, nodes[e].comp!);
    if (alt >= 0) s = alt;
  }
  const idx = astar(nodes, s, e, penalty);
  if (!idx) return [to];
  const pts: V3[] = idx.map((i) => nodes[i].p);
  // drop the first node if we are already past it (it lies behind us relative to the next)
  if (pts.length >= 2 && distXZ(from, pts[1]) < distXZ(pts[0], pts[1])) pts.shift();
  pts.push(to);
  return pts;
}

/**
 * Pick a steering direction (radians offset from desired heading) from whisker probe results.
 * `clear[i]` is the free distance measured along whiskerAngles[i]. Returns the angle of the first
 * fully clear whisker in preference order, or the longest one if none are clear.
 */
export function pickWhisker(angles: readonly number[], clear: readonly number[], length: number): number {
  let best = 0, bd = -1;
  for (let i = 0; i < angles.length; i++) {
    if (clear[i] >= length) return angles[i];
    if (clear[i] > bd) { bd = clear[i]; best = i; }
  }
  return angles[best];
}

/** Separation vector (XZ) pushing `me` away from nearby others within `radius`. */
export function separation(me: V3, others: readonly V3[], radius: number): [number, number] {
  let x = 0, z = 0;
  for (const o of others) {
    const dx = me[0] - o[0], dz = me[2] - o[2];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-4 || d >= radius) continue;
    const w = (1 - d / radius) / d;
    x += dx * w; z += dz * w;
  }
  return [x, z];
}

/** Ring of candidate points around `c` (XZ), used for procedural cover search. */
export function ringSamples(c: V3, radii: readonly number[], count: number, phase = 0): V3[] {
  const out: V3[] = [];
  for (const r of radii) for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2 + (r * 0.37);
    out.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
  }
  return out;
}

/** Score a cover candidate: prefer distance in the engage band, hidden from the player, near us. */
export function coverScore(cand: V3, me: V3, player: V3, hidden: boolean, peekable: boolean, dMin: number, dMax: number, claimed: boolean): number {
  if (!hidden || claimed) return -Infinity;
  const dp = distXZ(cand, player);
  const band = dp < dMin ? (dp - dMin) * 1.5 : dp > dMax ? (dMax - dp) * 0.6 : 0;
  const near = -distXZ(cand, me) * 0.35;
  return 10 + band + near + (peekable ? 4 : -3);
}
