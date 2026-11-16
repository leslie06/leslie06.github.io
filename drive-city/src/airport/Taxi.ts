import type { AirfieldData } from './Data';
import type { Runway } from './Flights';
import type { Stand } from './Parked';

/**
 * 滑行（2026-11-16，第三批）：滑行道图、机位的接入点、带圆角的路径、按弯道限速排出来的速度表。
 *
 * - 图：airfield.json 的滑行道折线（节点下标共用：滑行道接上跑道的地方是同一个节点）。跑道本身的边不进图；穿过别的跑道的
 *   滑行道边加重罚（滑行的飞机不横穿跑道：西边的机位从 36L 落地、往 36R 起飞，东边的从 01 落地）。
 * - 机位的接入点：从飞机中心沿机头反方向（机尾那头）打一条射线，碰到的第一段滑行道（200 米内、夹角大于 40°）。滑进机位：
 *   滑行道 → 接入点 → 拐进去 → 停在机位上；推出：倒着沿同一条线退回滑行道，机尾往起飞方向的反面拐，然后往前滑。
 * - 路径：折线的每个拐角换成圆弧（半径受两边长度限制），每 3 米一个点。速度表：直道上限、弯道 `sqrt(横向加速度 × 半径)`、
 *   起止速度，先正着按加速度限制扫一遍、再倒着按减速度扫一遍。按时间查位置是二分。
 */
export interface Pt { x: number; z: number }

/** 一条排好时间的路径：点、每点的累计长度、时间、速度；`rev` 是倒着走（推出：机头朝路径的反方向）。 */
export interface Track {
  x: Float32Array; z: Float32Array; s: Float32Array; t: Float32Array; v: Float32Array;
  len: number; dur: number; rev: boolean;
}

export interface Entry {
  /** 接入点（在滑行道上）、它所在的边（节点 a、b 和沿 a→b 的比例）。 */
  ex: number; ez: number; a: number; b: number; f: number;
}

const SEG = 3;

export class TaxiGraph {
  readonly nx: Float64Array; readonly nz: Float64Array;
  /** 邻接：每个节点 → [邻居, 长度, 压在跑道上（1）]。 */
  private adj: [number, number, number][][] = [];
  /** 滑行道的边（画线、找接入点用）。 */
  readonly edges: [number, number][] = [];
  private trees = new Map<number, { dist: Float64Array; prev: Int32Array }>();

  constructor(d: AirfieldData, readonly rws: readonly Runway[]) {
    const n = d.nodes.length / 2;
    this.nx = new Float64Array(n); this.nz = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.nx[i] = d.nodes[i * 2]; this.nz[i] = d.nodes[i * 2 + 1]; }
    for (let i = 0; i < n; i++) this.adj.push([]);
    const onRw = (x: number, z: number) => {
      for (const r of rws) {
        const s = (x - r.sx) * r.ux + (z - r.sz) * r.uz, o = Math.abs((x - r.sx) * -r.uz + (z - r.sz) * r.ux);
        if (s > -30 && s < r.len + 30 && o < r.w / 2 + 2) return true;
      }
      return false;
    };
    const seen = new Set<string>();
    for (const t of d.taxiways) {
      for (let k = 0; k + 1 < t.n.length; k++) {
        const a = t.n[k], b = t.n[k + 1];
        if (a === b) continue;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const L = Math.hypot(this.nx[b] - this.nx[a], this.nz[b] - this.nz[a]);
        // 中点压在跑道上的边（横穿跑道、或者沿着跑道的那几段）：寻路时离起点远的重罚（`tree`）
        const rw = onRw((this.nx[a] + this.nx[b]) / 2, (this.nz[a] + this.nz[b]) / 2) ? 1 : 0;
        this.adj[a].push([b, L, rw]); this.adj[b].push([a, L, rw]);
        this.edges.push([a, b]);
      }
    }
  }

  /** 从节点 src 出发的最短路树（缓存）。压在跑道上的边离起点 150 米以外的重罚：从跑道脱离、上跑道的那几段不罚，横穿别的跑道罚。 */
  tree(src: number): { dist: Float64Array; prev: Int32Array } {
    let tr = this.trees.get(src);
    if (tr) return tr;
    const n = this.nx.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    dist[src] = 0;
    // 二叉堆
    const hv: number[] = [], hn: number[] = [];
    const push = (d: number, v: number) => {
      let i = hv.length; hv.push(d); hn.push(v);
      while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; [hv[p], hv[i]] = [hv[i], hv[p]]; [hn[p], hn[i]] = [hn[i], hn[p]]; i = p; }
    };
    const pop = () => {
      const d = hv[0], v = hn[0], ld = hv.pop()!, lv = hn.pop()!;
      if (hv.length) {
        hv[0] = ld; hn[0] = lv;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < hv.length && hv[l] < hv[m]) m = l;
          if (r < hv.length && hv[r] < hv[m]) m = r;
          if (m === i) break;
          [hv[m], hv[i]] = [hv[i], hv[m]]; [hn[m], hn[i]] = [hn[i], hn[m]]; i = m;
        }
      }
      return [d, v] as const;
    };
    push(0, src);
    while (hv.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (const [v, L, rw] of this.adj[u]) {
        let w = L;
        if (rw) {
          const mx = (this.nx[u] + this.nx[v]) / 2 - this.nx[src], mz = (this.nz[u] + this.nz[v]) / 2 - this.nz[src];
          if (mx * mx + mz * mz > 150 * 150) w = L * 40 + 4000;
        }
        const nd = d + w;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
      }
    }
    tr = { dist, prev };
    this.trees.set(src, tr);
    return tr;
  }

  /** 最短路树里从根到 v 的节点（根在前）。 */
  pathTo(src: number, v: number): number[] {
    const { prev } = this.tree(src), out: number[] = [];
    for (let u = v; u >= 0; u = prev[u]) { out.push(u); if (u === src) break; }
    return out.reverse();
  }

  /** 机位的接入点：从机位中心往机尾方向打射线碰到的第一段滑行道。 */
  entry(s: Stand): Entry | null {
    const bx = -Math.sin(s.yaw), bz = -Math.cos(s.yaw);
    let best: Entry | null = null, bt = 200;
    for (const [a, b] of this.edges) {
      const ax = this.nx[a], az = this.nz[a], ex = this.nx[b] - ax, ez = this.nz[b] - az;
      const den = bx * ez - bz * ex;
      if (Math.abs(den) < 1e-6) continue;
      // s + t·d = a + f·e
      const wx = ax - s.x, wz = az - s.z;
      const t = (wx * ez - wz * ex) / den, f = (wx * bz - wz * bx) / den;
      if (t < 15 || t >= bt || f < 0 || f > 1) continue;
      const L = Math.hypot(ex, ez);
      if (Math.abs(bx * ex + bz * ez) / L > Math.cos(40 * Math.PI / 180)) continue;
      bt = t;
      best = { ex: s.x + bx * t, ez: s.z + bz * t, a, b, f };
    }
    return best;
  }

  /**
   * 跑道上的节点（滑行道接上来的），按从南头量起的米数排；`side` 是滑行道往跑道哪一边走（+1 右手、-1 左手，朝北看），
   * `fwd` 是滑行道离开跑道的方向在跑道方向上的分量（快速脱离道是正的）。
   */
  runwayNodes(rw: Runway, d: AirfieldData): { node: number; s: number; side: number; fwd: number }[] {
    const r = d.runways.find((q) => q.ref === rw.ref)!;
    const out: { node: number; s: number; side: number; fwd: number }[] = [];
    for (const v of new Set(r.n)) {
      if (!this.adj[v]?.length) continue;
      const s = (this.nx[v] - rw.sx) * rw.ux + (this.nz[v] - rw.sz) * rw.uz;
      for (const [u] of this.adj[v]) {
        const dx = this.nx[u] - this.nx[v], dz = this.nz[u] - this.nz[v];
        // 朝北（u 方向）看，右手是 (-uz, ux)
        const side = Math.sign(dx * -rw.uz + dz * rw.ux);
        const fwd = (dx * rw.ux + dz * rw.uz) / Math.max(1e-6, Math.hypot(dx, dz));
        // 沿着跑道的那种（和跑道重叠的线）不要；脱离道和跑道夹角常常只有十来度
        if (Math.abs(fwd) < 0.995) out.push({ node: v, s, side, fwd });
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }
}

/** 折线（去掉挨得太近的点）→ 每个拐角换成圆弧（最大半径 R）→ 每 3 米一个点。 */
export function smooth(P: Pt[], R: number): Pt[] {
  const Q: Pt[] = [];
  for (const p of P) if (!Q.length || Math.hypot(p.x - Q[Q.length - 1].x, p.z - Q[Q.length - 1].z) > 0.5) Q.push(p);
  if (Q.length < 2) return Q;
  // 先确定每个拐角的切线长（不超过两边各自一半）
  const out: Pt[] = [Q[0]];
  for (let k = 1; k + 1 < Q.length; k++) {
    const a = Q[k - 1], b = Q[k], c = Q[k + 1];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    const ux = (b.x - a.x) / l1, uz = (b.z - a.z) / l1, vx = (c.x - b.x) / l2, vz = (c.z - b.z) / l2;
    const th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (th < 0.03 || th > Math.PI * 0.95) { out.push(b); continue; }
    const tl = Math.min(R * Math.tan(th / 2), l1 / 2, l2 / 2), r = tl / Math.tan(th / 2);
    const p0 = { x: b.x - ux * tl, z: b.z - uz * tl };
    // 圆心在拐向的那一侧
    const turn = Math.sign(ux * vz - uz * vx);
    const cx = p0.x - uz * r * turn, cz = p0.z + ux * r * turn;
    const a0 = Math.atan2(p0.z - cz, p0.x - cx);
    const n = Math.max(2, Math.ceil(th * r / SEG));
    for (let i = 0; i <= n; i++) {
      const ang = a0 + turn * th * i / n;
      out.push({ x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r });
    }
  }
  out.push(Q[Q.length - 1]);
  // 直道上每 3 米补一个点（速度表按点算弯道）
  const res: Pt[] = [out[0]];
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1], b = out[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    const m = Math.max(1, Math.ceil(L / SEG));
    for (let i = 1; i <= m; i++) res.push({ x: a.x + (b.x - a.x) * i / m, z: a.z + (b.z - a.z) * i / m });
  }
  return res;
}

export interface Profile {
  /** 直道最高速、横向加速度（弯道限速）、加速度、减速度、起点速度、终点速度。 */
  vmax: number; lat: number; acc: number; dec: number; v0: number; v1: number;
  /** 某个点的额外限速（跑道上的减速段、进机位的最后一段）。 */
  cap?: (s: number, left: number) => number;
}

/** 给路径排速度和时间。 */
export function track(P: Pt[], pr: Profile, rev = false): Track {
  const n = P.length;
  const x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n), t = new Float32Array(n), v = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = P[i].x; z[i] = P[i].z; if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); }
  const len = s[n - 1] ?? 0;
  // 每点的限速：弯道（三点定圆）、额外限速
  for (let i = 0; i < n; i++) {
    let lim = pr.vmax;
    if (i > 0 && i + 1 < n) {
      const ax = x[i] - x[i - 1], az = z[i] - z[i - 1], bx = x[i + 1] - x[i], bz = z[i + 1] - z[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      const sinT = Math.abs(ax * bz - az * bx) / Math.max(1e-6, la * lb);
      if (sinT > 1e-4) { const R = (la + lb) / 2 / sinT; lim = Math.min(lim, Math.sqrt(pr.lat * R)); }
    }
    if (pr.cap) lim = Math.min(lim, pr.cap(s[i], len - s[i]));
    v[i] = lim;
  }
  v[0] = Math.min(v[0], pr.v0); v[n - 1] = Math.min(v[n - 1], pr.v1);
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * pr.acc * (s[i] - s[i - 1])));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * pr.dec * (s[i + 1] - s[i])));
  for (let i = 1; i < n; i++) {
    const ds = s[i] - s[i - 1], vm = (v[i] + v[i - 1]) / 2;
    t[i] = t[i - 1] + ds / Math.max(0.3, vm);
  }
  return { x, z, s, t, v, len, dur: t[n - 1] ?? 0, rev };
}

/** 路径上 τ 秒（从起点算）的位置、朝向（机头）、速度。 */
export function at(tr: Track, tau: number, out: { x: number; z: number; yaw: number; v: number; a: number }): void {
  const n = tr.t.length;
  if (n === 1 || tau <= 0) { const i = 0, j = Math.min(1, n - 1); out.x = tr.x[0]; out.z = tr.z[0]; dir(tr, i, j, out); out.v = tr.v[0]; out.a = 0; return; }
  if (tau >= tr.dur) { out.x = tr.x[n - 1]; out.z = tr.z[n - 1]; dir(tr, n - 2, n - 1, out); out.v = 0; out.a = 0; return; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] <= tau) lo = m; else hi = m; }
  const dt = tr.t[hi] - tr.t[lo], f = dt > 0 ? (tau - tr.t[lo]) / dt : 0;
  // 段内匀加速：位置按速度插值的积分
  const v0 = tr.v[lo], v1 = tr.v[hi], ds = tr.s[hi] - tr.s[lo];
  const g = ds > 0 ? (v0 * f * dt + 0.5 * (v1 - v0) * f * f * dt) / ds : f;
  const k = Math.max(0, Math.min(1, g));
  out.x = tr.x[lo] + (tr.x[hi] - tr.x[lo]) * k; out.z = tr.z[lo] + (tr.z[hi] - tr.z[lo]) * k;
  // 朝向：前后各取一点，转弯时平滑
  const a = Math.max(0, lo - 1), b = Math.min(n - 1, hi + 1);
  dir(tr, a, b, out);
  out.v = v0 + (v1 - v0) * f;
  out.a = dt > 0 ? (v1 - v0) / dt : 0;
}

function dir(tr: Track, i: number, j: number, out: { yaw: number }): void {
  const dx = tr.x[j] - tr.x[i], dz = tr.z[j] - tr.z[i];
  if (dx * dx + dz * dz < 1e-8) return;
  out.yaw = tr.rev ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
}
