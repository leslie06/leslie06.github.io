import type { LaneGraph, Link } from '../traffic/LaneGraph';

/** A drive from the start's projection on the road to the target's. */
export interface Route {
  /** [x, z, ...] along the lane graph's centre lines. */
  pts: Float32Array;
  /** Metres along `pts`. */
  len: number;
  /** Estimated seconds (the search cost: driving time plus turn penalties). */
  time: number;
  /** Directed link ids driven, in order. */
  links: number[];
}

interface Source { link: number; s: number; g0: number }

// Seconds added at a real junction (3+ roads): (1 - cos(turn)) x TURN, so 90 degrees costs 3 s; a
// left turn waits for the oncoming traffic (China drives on the right); turning back is a last resort.
const TURN = 3, LEFT = 2.5, UTURN = 30;
/** On top of length / speed: keep the GPS out of car parks, alleys and bus lanes. Must stay >= 1 (the heuristic assumes it). */
const FACTOR: Record<string, number> = { service: 1.6, living_street: 1.6, busway: 4 };
/** Metres of snap distance that one unit of (1 - cos) between a road and the heading is worth. */
const HEADING_M = 18;
const CELL = 48;
const RADII = [60, 250, 800];
/** ALT landmarks (A*, landmarks, triangle inequality): corners of the network with precomputed costs to and from every node. */
const LANDMARKS = 8;
/** Stands in for "unreachable" in the landmark tables (a finite value keeps Inf - Inf out of the heuristic). */
const BIG = 1e7;
const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

/**
 * GPS routing: A* over the lane graph's directed links (one per travel direction, so one-way
 * streets are respected by construction).
 *
 * The search state is a link, not a node, so turns can be priced. The heuristic is straight-line
 * distance to the target's projection divided by the fastest speed on the map: admissible and
 * consistent, so the search stops as soon as the cheapest open entry cannot beat the best arrival.
 * Nothing is allocated per search except the result.
 */
export class Router {
  /** Last search: wall time (ms) and links expanded. */
  readonly stats = { ms: 0, expanded: 0 };
  private readonly links: Link[];
  private readonly out: number[][];
  /** Seconds to drive a whole link, and seconds per metre of it. */
  private readonly cost: Float64Array;
  private readonly rate: Float64Array;
  private readonly g: Float64Array;
  private readonly from: Int32Array;
  private readonly seen: Uint32Array;
  private readonly done: Uint32Array;
  private readonly mark: Uint32Array;
  private readonly junction: Uint8Array;
  /** Links the giant strongly connected part of the network can reach (usable targets), and links that can reach it (usable starts). */
  private readonly reachable: Uint8Array;
  private readonly reaches: Uint8Array;
  private readonly vmax: number;
  private readonly K: number;
  /** Driving seconds (turns ignored, so a lower bound) from landmark k to node v at [k * nodes + v], and from v to k. */
  private readonly lmF: Float32Array;
  private readonly lmB: Float32Array;
  private readonly tF = new Float64Array(LANDMARKS);
  private readonly tB = new Float64Array(LANDMARKS);
  /** 48 m cells -> canonical link ids (a two-way edge is indexed once, by its forward link). */
  private readonly grid = new Map<number, number[]>();
  private epoch = 0;
  private markEpoch = 0;
  private hk = new Float64Array(2048);
  private hv = new Int32Array(2048);
  private hn = 0;
  private readonly tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private readonly buf: number[] = [];
  private readonly chain: number[] = [];

  constructor(readonly graph: LaneGraph) {
    const links = this.links = graph.links;
    this.out = graph.out;
    const n = links.length;
    this.cost = new Float64Array(n); this.rate = new Float64Array(n); this.g = new Float64Array(n); this.from = new Int32Array(n);
    this.seen = new Uint32Array(n); this.done = new Uint32Array(n); this.mark = new Uint32Array(n);
    let vmax = 1;
    const deg = new Uint16Array(graph.nodeX.length);
    for (const l of links) {
      this.rate[l.id] = (FACTOR[l.cls] ?? 1) / l.speed;
      this.cost[l.id] = l.len * this.rate[l.id];
      vmax = Math.max(vmax, l.speed);
      if (l.rev < 0 || l.id < l.rev) { deg[l.from]++; deg[l.to]++; this.index(l); }
    }
    this.vmax = vmax;
    this.junction = new Uint8Array(deg.length);
    for (let i = 0; i < deg.length; i++) this.junction[i] = deg[i] >= 3 ? 1 : 0;
    [this.reachable, this.reaches] = this.components();
    const into: number[][] = Array.from({ length: graph.nodeX.length }, () => []);
    for (const l of links) into[l.to].push(l.id);
    const marks = this.pickLandmarks();
    this.K = marks.length;
    const N = graph.nodeX.length;
    this.lmF = new Float32Array(this.K * N); this.lmB = new Float32Array(this.K * N);
    marks.forEach((v, k) => { this.dijkstra(v, true, into, this.lmF, k * N); this.dijkstra(v, false, into, this.lmB, k * N); });
  }

  /**
   * Shortest legal drive from (fromX, fromZ) facing `heading` (atan2(x, z); NaN = either way) to
   * (toX, toZ). Starts on the nearby link that points along the heading (turning back on the spot
   * costs a U-turn), ends on the link nearest the target in either direction. Null if no road is
   * near either end or the target cannot be reached.
   */
  route(fromX: number, fromZ: number, heading: number, toX: number, toZ: number): Route | null {
    const t0 = performance.now();
    const r = this.search(fromX, fromZ, heading, toX, toZ);
    this.stats.ms = performance.now() - t0;
    return r;
  }

  /** Closest point within `r` metres on a road the GPS can route to, or null. */
  nearestRoad(x: number, z: number, r = 60): { x: number; z: number; d: number; link: number } | null {
    let best: { x: number; z: number; d: number; link: number } | null = null;
    this.near(x, z, r, (l, s, d) => {
      if ((best && d >= best.d) || !this.canEnd(l)) return;
      this.graph.at(l, s, 0, this.tmp);
      best = { x: this.tmp.x, z: this.tmp.z, d, link: l.id };
    });
    return best;
  }

  private search(fromX: number, fromZ: number, heading: number, toX: number, toZ: number): Route | null {
    const src = this.sources(fromX, fromZ, heading);
    const end = this.nearestRoadWide(toX, toZ);
    if (!src.length || !end) return null;
    const L = this.links, nx = this.graph.nodeX, nz = this.graph.nodeZ;
    const rv = L[end.link].rev, dS0 = end.s, dS1 = rv >= 0 ? L[rv].len - end.s : 0;
    const d0 = this.reachable[end.link] ? end.link : -1, d1 = rv >= 0 && this.reachable[rv] ? rv : -1;
    const px = end.x, pz = end.z, iv = 1 / this.vmax;
    // Lower bound to the target: straight line at the top speed, or the landmark triangle
    // inequalities d(k, t) - d(k, v) and d(v, k) - d(t, k), whichever is tightest.
    const N = nx.length, K = this.K, F = this.lmF, B = this.lmB, tF = this.tF, tB = this.tB, rate = this.rate;
    for (let k = 0; k < K; k++) {
      let f = BIG, b = BIG;
      for (const [d, sT] of [[d0, dS0], [d1, dS1]]) {
        if (d < 0) continue;
        const l = L[d];
        f = Math.min(f, F[k * N + l.from] + sT * rate[d]);
        b = Math.min(b, (l.len - sT) * rate[d] + B[k * N + l.to]);
      }
      tF[k] = f - 1e-3; tB[k] = b + 1e-3;
    }
    const heur = (v: number) => {
      const dx = nx[v] - px, dz = nz[v] - pz;
      let h = Math.sqrt(dx * dx + dz * dz) * iv;
      for (let k = 0, o = v; k < K; k++, o += N) {
        const a = tF[k] - F[o]; if (a > h) h = a;
        const c = B[o] - tB[k]; if (c > h) h = c;
      }
      return h;
    };
    const ep = this.nextEpoch();
    this.hn = 0;
    let best = Infinity, bestFrom = -1, bestLink = -1, bestS = 0, bestSrc = 0;
    for (let i = 0; i < src.length; i++) {
      const s = src[i], l = L[s.link];
      // The target further along the start link itself: drive straight to it.
      const direct = s.link === d0 ? dS0 : s.link === d1 ? dS1 : -1;
      if (direct >= s.s) {
        const c = s.g0 + (direct - s.s) * this.rate[s.link];
        if (c < best) { best = c; bestFrom = -1; bestLink = s.link; bestS = direct; bestSrc = i; }
      }
      const g = s.g0 + (l.len - s.s) * this.rate[s.link];
      if (this.seen[s.link] !== ep || g < this.g[s.link]) {
        this.seen[s.link] = ep; this.g[s.link] = g; this.from[s.link] = -1 - i;
        this.push(g + heur(l.to), s.link);
      }
    }
    let expanded = 0;
    while (this.hn > 0) {
      if (this.hk[0] >= best) break;
      const a = this.pop();
      if (this.done[a] === ep) continue;
      this.done[a] = ep; expanded++;
      const la = L[a], ga = this.g[a], jn = this.junction[la.to];
      for (const b of this.out[la.to]) {
        const lb = L[b];
        let pen = 0;
        if (b === la.rev) pen = UTURN;
        else if (jn) {
          const c = la.d1x * lb.d0x + la.d1z * lb.d0z;
          pen = (1 - c) * TURN;
          // (x, z) with +Z south: a negative cross product is a left turn.
          if (c < 0.7 && la.d1x * lb.d0z - la.d1z * lb.d0x < 0) pen += LEFT;
        }
        const base = ga + pen;
        if (b === d0 || b === d1) {
          const sT = b === d0 ? dS0 : dS1, c = base + sT * this.rate[b];
          if (c < best) { best = c; bestFrom = a; bestLink = b; bestS = sT; }
        }
        if (this.done[b] === ep) continue;
        const gb = base + this.cost[b];
        if (this.seen[b] !== ep || gb < this.g[b]) {
          this.seen[b] = ep; this.g[b] = gb; this.from[b] = a;
          this.push(gb + heur(lb.to), b);
        }
      }
    }
    this.stats.expanded = expanded;
    if (best === Infinity) return null;

    // Walk the parents back to a source, then lay the points out start -> target.
    const pts = this.buf, links: number[] = [];
    pts.length = 0;
    if (bestFrom === -1) {
      this.append(pts, L[bestLink], src[bestSrc].s, bestS);
      links.push(bestLink);
    } else {
      const chain = this.chain;
      chain.length = 0;
      let c = bestFrom, guard = 0;
      while (c >= 0 && guard++ <= L.length) { chain.push(c); c = this.from[c]; }
      if (c >= 0) return null;
      chain.reverse();
      this.append(pts, L[chain[0]], src[-1 - c].s, L[chain[0]].len);
      for (let i = 1; i < chain.length; i++) this.append(pts, L[chain[i]], 0, L[chain[i]].len);
      this.append(pts, L[bestLink], 0, bestS);
      for (const id of chain) links.push(id);
      links.push(bestLink);
    }
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (pts.length < 4) pts.push(pts[0], pts[1]);
    return { pts: Float32Array.from(pts), len, time: best, links };
  }

  /** Where to start: the nearby link along the heading, plus its reverse (a U-turn on the spot). */
  private sources(x: number, z: number, heading: number): Source[] {
    const dir = Number.isFinite(heading), hx = Math.sin(heading), hz = Math.cos(heading);
    let bestScore = Infinity, bestLink = -1, bestS = 0;
    for (const r of RADII) {
      this.near(x, z, r, (l, s, d, dx, dz) => {
        const along = dir ? dx * hx + dz * hz : 1;
        const fw = d + (1 - along) * HEADING_M;
        if (fw < bestScore && this.reaches[l.id]) { bestScore = fw; bestLink = l.id; bestS = s; }
        if (l.rev >= 0 && this.reaches[l.rev]) {
          const bw = d + (1 + (dir ? along : -1)) * HEADING_M;
          if (bw < bestScore) { bestScore = bw; bestLink = l.rev; bestS = l.len - s; }
        }
      });
      if (bestLink >= 0) break;
    }
    if (bestLink < 0) return [];
    const out: Source[] = [{ link: bestLink, s: bestS, g0: 0 }];
    const rev = this.links[bestLink].rev;
    if (rev >= 0 && this.reaches[rev]) out.push({ link: rev, s: this.links[rev].len - bestS, g0: dir ? UTURN : 0 });
    return out;
  }

  /** Nearest road to the target, searching wider when nothing is close. */
  private nearestRoadWide(x: number, z: number): { link: number; s: number; x: number; z: number } | null {
    for (const r of RADII) {
      let bd = Infinity, link = -1, bs = 0;
      this.near(x, z, r, (l, s, d) => { if (d < bd && this.canEnd(l)) { bd = d; link = l.id; bs = s; } });
      if (link >= 0) {
        this.graph.at(this.links[link], bs, 0, this.tmp);
        return { link, s: bs, x: this.tmp.x, z: this.tmp.z };
      }
    }
    return null;
  }

  private canEnd(l: Link): boolean { return !!this.reachable[l.id] || (l.rev >= 0 && !!this.reachable[l.rev]); }

  /**
   * OSM leaves islands: service roads inside parks, one-way stubs into dead ends. A target snapped
   * onto one would have no route, so find the giant strongly connected part (forward and backward
   * reachability from a long, fast seed link, intersected) and only start where it can be reached
   * from, and only end where it reaches.
   */
  private components(): [Uint8Array, Uint8Array] {
    const L = this.links, n = L.length;
    const into: number[][] = Array.from({ length: this.graph.nodeX.length }, () => []);
    for (const l of L) into[l.to].push(l.id);
    const queue = new Int32Array(Math.max(1, n));
    const bfs = (seed: number, fwd: boolean, mark: Uint8Array) => {
      mark.fill(0);
      let h = 0, t = 0;
      queue[t++] = seed; mark[seed] = 1;
      while (h < t) {
        const a = queue[h++];
        for (const b of fwd ? this.out[L[a].to] : into[L[a].from]) if (!mark[b]) { mark[b] = 1; queue[t++] = b; }
      }
    };
    const seeds = L.map((l) => l.id).sort((a, b) => L[b].len * L[b].speed - L[a].len * L[a].speed).slice(0, 8);
    const F = new Uint8Array(n), B = new Uint8Array(n), bestF = new Uint8Array(n), bestB = new Uint8Array(n);
    let bestSize = -1;
    for (const seed of seeds) {
      bfs(seed, true, F); bfs(seed, false, B);
      let size = 0;
      for (let i = 0; i < n; i++) if (F[i] && B[i]) size++;
      if (size > bestSize) { bestSize = size; bestF.set(F); bestB.set(B); }
      if (size * 2 > n) break;
    }
    return [bestF, bestB];
  }

  /** Landmarks spread over the connected network: the node farthest from its centre, then each next farthest from those chosen. */
  private pickLandmarks(): number[] {
    const g = this.graph, N = g.nodeX.length, inScc = new Uint8Array(N);
    let cx = 0, cz = 0, n = 0;
    for (const l of this.links) if (this.reachable[l.id] && this.reaches[l.id] && !inScc[l.from]) { inScc[l.from] = 1; cx += g.nodeX[l.from]; cz += g.nodeZ[l.from]; n++; }
    if (!n) return [];
    cx /= n; cz /= n;
    const near = new Float64Array(N).fill(Infinity), out: number[] = [];
    let best = -1, bd = -1;
    for (let v = 0; v < N; v++) if (inScc[v]) { const d = Math.hypot(g.nodeX[v] - cx, g.nodeZ[v] - cz); if (d > bd) { bd = d; best = v; } }
    while (best >= 0 && out.length < Math.min(LANDMARKS, n)) {
      out.push(best);
      let next = -1; bd = -1;
      for (let v = 0; v < N; v++) {
        if (!inScc[v]) continue;
        near[v] = Math.min(near[v], Math.hypot(g.nodeX[v] - g.nodeX[best], g.nodeZ[v] - g.nodeZ[best]));
        if (near[v] > bd) { bd = near[v]; next = v; }
      }
      best = bd > 0 ? next : -1;
    }
    return out;
  }

  /** Node-level Dijkstra from `src` over whole links (forward, or backward over reversed links) into out[off + v]. */
  private dijkstra(src: number, fwd: boolean, into: number[][], out: Float32Array, off: number): void {
    const N = this.graph.nodeX.length, L = this.links, dist = new Float64Array(N).fill(BIG);
    dist[src] = 0; this.hn = 0; this.push(0, src);
    while (this.hn > 0) {
      const k = this.hk[0], u = this.pop();
      if (k > dist[u]) continue;
      for (const id of fwd ? this.out[u] : into[u]) {
        const v = fwd ? L[id].to : L[id].from, nd = k + this.cost[id];
        if (nd < dist[v]) { dist[v] = nd; this.push(nd, v); }
      }
    }
    for (let v = 0; v < N; v++) out[off + v] = dist[v];
  }

  /** Canonical links within `r` of (x, z), each with its closest point: arc length, distance, segment direction. */
  private near(x: number, z: number, r: number, fn: (l: Link, s: number, d: number, dx: number, dz: number) => void): void {
    if (++this.markEpoch >= 0xffffffff) { this.mark.fill(0); this.markEpoch = 1; }
    const m = this.markEpoch, pad = r + CELL / 2;
    const x0 = Math.floor((x - pad) / CELL), x1 = Math.floor((x + pad) / CELL);
    const z0 = Math.floor((z - pad) / CELL), z1 = Math.floor((z + pad) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const list = this.grid.get(key(ix, iz));
      if (!list) continue;
      for (const id of list) {
        if (this.mark[id] === m) continue;
        this.mark[id] = m;
        const l = this.links[id], p = l.pts;
        let bd = Infinity, bs = 0, bdx = 0, bdz = 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = p[k], az = p[k + 1], vx = p[k + 2] - ax, vz = p[k + 3] - az, L2 = vx * vx + vz * vz;
          if (L2 < 1e-9) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
          const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
          if (d < bd) { const len = Math.sqrt(L2); bd = d; bs = l.cum[k >> 1] + t * len; bdx = vx / len; bdz = vz / len; }
        }
        if (bd <= r) fn(l, bs, bd, bdx, bdz);
      }
    }
  }

  /** Add every 48 m cell a link's segments pass through (sampled at half a cell; queries pad by half a cell). */
  private index(l: Link): void {
    const p = l.pts, step = CELL / 2;
    let last = NaN;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let i = 0; i <= n; i++) {
        const c = key(Math.floor((ax + (bx - ax) * i / n) / CELL), Math.floor((az + (bz - az) * i / n) / CELL));
        if (c === last) continue;
        last = c;
        let list = this.grid.get(c);
        if (!list) this.grid.set(c, list = []);
        if (list[list.length - 1] !== l.id) list.push(l.id);
      }
    }
  }

  /** Points of `l` between arc lengths s0 and s1 (end points interpolated), skipping a repeat of the last point. */
  private append(out: number[], l: Link, s0: number, s1: number): void {
    const a = this.graph.at(l, s0, 0, this.tmp);
    this.pushPt(out, a.x, a.z);
    for (let k = 1; k < l.cum.length - 1; k++) if (l.cum[k] > s0 && l.cum[k] < s1) this.pushPt(out, l.pts[k * 2], l.pts[k * 2 + 1]);
    const b = this.graph.at(l, s1, 0, this.tmp);
    this.pushPt(out, b.x, b.z);
  }

  private pushPt(out: number[], x: number, z: number): void {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - x) < 0.05 && Math.abs(out[n - 1] - z) < 0.05) return;
    out.push(x, z);
  }

  private nextEpoch(): number {
    if (++this.epoch >= 0xffffffff) { this.seen.fill(0); this.done.fill(0); this.epoch = 1; }
    return this.epoch;
  }

  private push(k: number, v: number): void {
    if (this.hn >= this.hk.length) {
      const hk = new Float64Array(this.hk.length * 2), hv = new Int32Array(this.hv.length * 2);
      hk.set(this.hk); hv.set(this.hv); this.hk = hk; this.hv = hv;
    }
    const hk = this.hk, hv = this.hv;
    let i = this.hn++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p]; hv[i] = hv[p]; i = p;
    }
    hk[i] = k; hv[i] = v;
  }

  private pop(): number {
    const hk = this.hk, hv = this.hv, top = hv[0], n = --this.hn;
    if (n > 0) {
      const k = hk[n], v = hv[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = k; hv[i] = v;
    }
    return top;
  }
}
