import type { AirfieldData } from './Data';
import { bridgeEnds, hash2, stands as standsOf, type Stand } from './Parked';
import { dims, type PlaneKind } from './Plane';
import { at, smooth, TaxiGraph, track, type Entry, type Pt, type Track } from './Taxi';

/**
 * 起降和滑行的飞机。
 *
 * 第二批（2026-11-16）：向北运行（北京冬天刮北风；进近的飞机从南边来，从机场高速上空压过去），位置只由时刻表和钟点算出来。
 *
 * 第三批（2026-11-16，「接着做第三批」）：一架飞机走完一整圈（`Plan`）——进近、落地、从快速脱离道滑出跑道、沿滑行道滑到一个
 * 机位、停十到二十分钟、推出、滑到跑道头等、起飞。
 * - 每 `P` 秒一圈。西边的机位（T1、T2）从西跑道 36L 落地，东边的（T3）从东跑道 01 落地；西边的都从中跑道 36R 起飞，东边的
 *   三分之一从 01 起飞、其余从 36R。滑行的飞机不横穿跑道（`TaxiGraph` 里压在跑道上的边重罚）。
 * - **按圈的顺序排**（优先级规划）：排第 i 圈时，前面排好的每一圈的地面轨迹（每 2 秒一个点）都知道，挑一个机位、在脱离跑道后
 *   的等待点等几秒、推出晚几秒，直到轨迹和谁都不挨着；起飞的时间按跑道空档排（01 还要让开落地的）。机位有一张占用表，
 *   一个机位同一时间只停一架。
 * - 排好的就不变，所以一架飞机的位置还是只由时钟算出来：玩家什么时候来、看到的都对。拨时钟（`seek`）或者时钟跳了，从
 *   「现在往前 W 秒」重新排。
 * - 两样有状态：复飞（落地前跑道上有玩家，或者有停着不动的飞机）；**被挡住**——滑行的飞机前面 60 米内有车（或者别的飞机），
 *   停下来等（`lag` 累加，在等待点上等的时候再把它吃回来）。互相挡住 40 秒以上的，编号大的那架当没看见对方（不然死锁）。
 *   玩家离机场远了，`lag` 清零（反正看不见）。
 * - 这些机位（`pool`，两边各约 30 个靠楼的）不归「停着的飞机」的哈希管：`Parked.ts` 的那些机位照旧按钟点哈希。
 */
export interface Runway { ref: string; w: number; sx: number; sz: number; nx: number; nz: number; ux: number; uz: number; len: number }

export interface FlightPose {
  id: number; kind: PlaneKind; livery: number;
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** 速度（米/秒，水平和竖直）、发动机推力 0–1、起落架放没放、着陆灯开没开、在不在地上。 */
  vx: number; vy: number; vz: number; thrust: number; gear: boolean; landing: boolean; ground: boolean;
  arr: boolean;
  /** 停在机位上（发动机关着、灯不亮）。 */
  parked: boolean;
  /** 推出中（机尾朝前，推车顶着）。 */
  push: boolean;
}

const G3 = Math.tan(3 * Math.PI / 180);
/** 进近从离瞄准点多远开始（米）、进近速度、接地点离跑道头多远。 */
const APP_D = 12096, APP_V = 72, AIM = 350, T_APP = APP_D / APP_V;
/** 落地后的减速度、脱离跑道前的速度。 */
const DECEL = 2.2, EXIT_V = 15;
/** 起飞：对正后等几秒、加速度、抬轮速度、爬升角、离地多高消失。 */
const HOLD = 6, ACC = 1.9, VR = 74, CLIMB = 8 * Math.PI / 180, GONE_H = 1400;
/** 一圈的间隔（秒）、一圈最长多久（重排时往前看多远）。P 和进近时间（168 秒）都是 DT 的整数倍：滑行的每一段都从采样格上开始。 */
export const P = 76;
const W = 3600;
/** 轨迹采样间隔（秒）。 */
const DT = 2;
const up = (t: number) => Math.ceil(t / DT - 1e-9) * DT;
/** 滑行：直道速度、弯道横向加速度、加减速度。 */
const TAXI = { vmax: 10, lat: 0.9, acc: 0.6, dec: 1.0 };

export function runways(d: AirfieldData): Runway[] {
  return d.runways.map((r) => {
    const p = r.p, ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
    // 向北运行：从南头（z 大的那头）往北
    const [sx, sz, nx, nz] = az > bz ? [ax, az, bx, bz] : [bx, bz, ax, az];
    const len = Math.hypot(nx - sx, nz - sz);
    return { ref: r.ref, w: r.w, sx, sz, nx, nz, ux: (nx - sx) / len, uz: (nz - sz) / len, len };
  }).filter((r) => r.len > 1000).sort((a, b) => a.sx - b.sx);
}

/** 归 `Flights` 管的机位。 */
export interface PoolStand { i: number; st: Stand; e: Entry; west: boolean }

type Seg =
  | { k: 'app'; t0: number; t1: number }
  | { k: 'trk'; t0: number; t1: number; tr: Track; land?: boolean; push?: boolean; lineup?: boolean }
  | { k: 'wait'; t0: number; t1: number; x: number; z: number; yaw: number; park?: boolean; spool?: boolean }
  | { k: 'roll'; t0: number; t1: number; rw: Runway; s0: number };

interface Plan {
  i: number; id: number; kind: PlaneKind; livery: number;
  skip: boolean;
  arrRw: Runway; depRw: Runway | null;
  segs: Seg[];
  end: number;
  stand: PoolStand | null; standFrom: number; standTo: number;
  /** 地面轨迹的采样：从 g0 起每 DT 秒一个点（不在地上是 NaN）。 */
  g0: number; gx: Float32Array; gz: Float32Array; r: number; bb: number[];
  ga: { t: number; x: number; y: number; z: number; v: number } | null;
  lag: number; blockT: number; ghost: number;
  /** 上一帧的位置（别的飞机看它挡不挡路）。 */
  px: number; pz: number; pyaw: number; pOn: boolean; pRoll: boolean;
  /** 地上的推力（平滑过：加减速段换来换去时声音不跳）。 */
  thr: number;
}

export class Flights {
  readonly rws: Runway[];
  readonly graph: TaxiGraph;
  readonly pool: PoolStand[] = [];
  /** 哪些机位编号（`stands()` 的下标）归这里管：停着的飞机的哈希跳过它们。 */
  readonly poolSet = new Set<number>();
  private readonly d: AirfieldData;
  private plans = new Map<number, Plan>();
  private next = 0;
  private lastT = -1e9;
  private pruned = -1e9;
  private standUse = new Map<number, [number, number][]>();
  private depUse = new Map<Runway, [number, number][]>();
  private out: FlightPose[] = [];
  private exits = new Map<Runway, number>();
  private inCache = new Map<string, InPath | null>();
  private outCache = new Map<string, OutPath | null>();
  private entries = new Map<string, { node: number; s: number }>();
  /** 玩家离机场远（lag 清零）。 */
  far = false;

  constructor(d: AirfieldData, st: Stand[] = standsOf(d)) {
    this.d = d;
    this.rws = runways(d);
    this.graph = new TaxiGraph(d, this.rws);
    const mid = this.rws[1] ?? this.rws[0];
    const westOf = (x: number, z: number) => (x - mid.sx) * -mid.uz + (z - mid.sz) * mid.ux < 0;
    // 机位：靠廊桥的（门口有廊桥头）优先，两边各最多 32 个；公务机不要
    const ends = bridgeEnds(d);
    const cand: { ps: PoolStand; score: number }[] = [];
    st.forEach((s, i) => {
      if (s.kind === 2) return;
      const e = this.graph.entry(s);
      if (!e) return;
      const bridged = ends.some((b) => Math.hypot(b.x - s.sx, b.z - s.sz) < 40);
      cand.push({ ps: { i, st: s, e, west: westOf(s.x, s.z) }, score: (bridged ? 0 : 1) + hash2(i, 31) });
    });
    cand.sort((a, b) => a.score - b.score);
    let nw = 0, ne = 0;
    for (const { ps } of cand) {
      if (ps.west ? nw >= 32 : ne >= 32) continue;
      if (ps.west) nw++; else ne++;
      this.pool.push(ps); this.poolSet.add(ps.i);
    }
    // 落地后从哪个口脱离：减到脱离速度以后第一个往机位那边去的口
    const sSlow = AIM + (APP_V * APP_V - EXIT_V * EXIT_V) / (2 * DECEL);
    for (const [rw, side] of [[this.rws[0], 1], [this.rws[2], -1]] as const) {
      if (!rw) continue;
      const ns = this.graph.runwayNodes(rw, d).filter((n) => n.side === side && n.fwd > -0.2);
      const e = ns.find((n) => n.s > sSlow - 250) ?? ns[ns.length - 1];
      if (e) this.exits.set(rw, e.node);
    }
    // 起飞从哪儿上跑道：南头最近的口（36R 两边各一个、01 西边一个）
    for (const [rw, side, key] of [[this.rws[1], -1, 'W'], [this.rws[1], 1, 'E'], [this.rws[2], -1, 'E']] as const) {
      if (!rw) continue;
      const ns = this.graph.runwayNodes(rw, d).filter((n) => n.side === side && n.fwd < 0.2 && n.s < 600);
      if (ns.length) this.entries.set(`${rw.ref}${key}`, ns[0]);
    }
    for (const rw of this.rws) this.depUse.set(rw, []);
  }

  /** 第 i 圈从哪条跑道落地（偶数西、奇数东）。 */
  private arrRunway(i: number): Runway { return (i & 1) === 0 || !this.rws[2] ? this.rws[0] : this.rws[2]; }

  // ------------------------------------------------------------------ 排一圈

  private plan(i: number, hour: number): Plan {
    const id = 1e6 + i;
    const arrRw = this.arrRunway(i);
    const west = arrRw === this.rws[0];
    const t0 = i * P, tTd = t0 + T_APP;
    const p: Plan = {
      i, id, kind: 0, livery: Math.floor(hash2(id, 9) * 6), skip: hour < 6 && hash2(id, 77) < 0.67,
      arrRw, depRw: null, segs: [{ k: 'app', t0, t1: tTd }], end: tTd + 60, stand: null, standFrom: 0, standTo: 0,
      g0: 0, gx: new Float32Array(0), gz: new Float32Array(0), r: 0, bb: [0, 0, 0, 0], ga: null, lag: 0, blockT: 0, ghost: 0,
      px: 0, pz: 0, pyaw: 0, pOn: false, pRoll: false, thr: 0,
    };
    if (p.skip) return p;
    const exit = this.exits.get(arrRw);
    const pool = this.pool.filter((s) => s.west === west);
    if (exit === undefined || !pool.length) return p;
    // 机位按哈希排个序，挨个试
    const order = pool.map((s, k) => ({ s, h: hash2(id, 100 + k) })).sort((a, b) => a.h - b.h).map((o) => o.s);
    let best: { segs: Seg[]; stand: PoolStand; from: number; to: number; dep: Runway; score: number; occ: [number, number] } | null = null;
    for (const s of order.slice(0, 12)) {
      const tin = this.inPath(arrRw, exit, s);
      if (!tin) continue;
      for (const wait of [0, 15, 30, 50, 75, 100]) {
        const segIn = this.withWait(tin, tTd, wait);
        const at = segIn[segIn.length - 1].t1;
        const turn = 600 + hash2(id, 13) * 600;
        // 机位得空到推出完
        if (!this.standFree(s.i, at - 20, at + turn + 700)) break;
        const inS = this.sample(segIn, s.st.kind);
        if (this.conflicts(inS, id)) continue;
        // 起飞
        const dep = this.departure(p, s, at, turn, inS);
        // 推出怎么晚都不行：多等一会儿进来也一样，换个机位
        if (!dep) break;
        const score = wait + dep.delay * 0.5;
        if (!best || score < best.score) best = { segs: [...segIn, ...dep.segs], stand: s, from: at, to: dep.pushEnd, dep: dep.rw, score, occ: dep.occ };
        break;
      }
      if (best && best.score < 30) break;
    }
    if (!best) return p;
    p.kind = best.stand.st.kind;
    p.segs = [p.segs[0], ...best.segs];
    p.stand = best.stand; p.standFrom = best.from; p.standTo = best.to; p.depRw = best.dep;
    p.end = p.segs[p.segs.length - 1].t1;
    const smp = this.sample(p.segs.slice(1), p.kind);
    p.g0 = smp.g0; p.gx = smp.gx; p.gz = smp.gz; p.r = smp.r; p.bb = smp.bb;
    (this.standUse.get(best.stand.i) ?? this.standUse.set(best.stand.i, []).get(best.stand.i)!).push([best.from - 20, best.to + 20]);
    this.depUse.get(best.dep)!.push(best.occ);
    return p;
  }

  /** 落地滑跑 + 脱离 + 滑到机位（一条轨迹，从接地开始；还有在等待点拆开的两段）。和时间无关，按跑道和机位缓存。 */
  private inPath(rw: Runway, exit: number, s: PoolStand): InPath | null {
    const key = `${rw.ref}:${s.i}`;
    if (this.inCache.has(key)) return this.inCache.get(key)!;
    const r = this.buildIn(rw, exit, s);
    this.inCache.set(key, r);
    return r;
  }

  private buildIn(rw: Runway, exit: number, s: PoolStand): InPath | null {
    const g = this.graph, e = s.e;
    const tree = g.tree(exit);
    const La = Math.hypot(g.nx[e.b] - g.nx[e.a], g.nz[e.b] - g.nz[e.a]);
    const viaA = tree.dist[e.a] + e.f * La, viaB = tree.dist[e.b] + (1 - e.f) * La;
    if (!Number.isFinite(Math.min(viaA, viaB)) || Math.min(viaA, viaB) > 9000) return null;
    const nodes = g.pathTo(exit, viaA <= viaB ? e.a : e.b);
    const td = { x: rw.sx + rw.ux * AIM, z: rw.sz + rw.uz * AIM };
    const P0: Pt[] = [td, ...nodes.map((n) => ({ x: g.nx[n], z: g.nz[n] })), { x: e.ex, z: e.ez }, { x: s.st.x, z: s.st.z }];
    const pts = smooth(P0, 45);
    const sEx = Math.hypot(g.nx[exit] - td.x, g.nz[exit] - td.z);
    const tr = track(pts, {
      vmax: APP_V, lat: TAXI.lat, acc: TAXI.acc, dec: DECEL, v0: APP_V, v1: 0,
      cap: (sx, left) => Math.min(sx < sEx - 40 ? Math.max(EXIT_V, Math.sqrt(Math.max(0, APP_V * APP_V - 2 * DECEL * sx))) : TAXI.vmax, left < 70 ? 1.5 + left * 0.04 : 99),
    });
    // 等待点：脱离口往里 160 米（离跑道够远）
    const holdS = Math.min(tr.len - 80, sEx + 160);
    let hold = 0;
    while (hold < tr.s.length - 1 && tr.s[hold] < holdS) hold++;
    if (hold <= 0) return { tr, A: null, B: null, hx: 0, hz: 0, hyaw: 0 };
    const sub = (a: number, b: number) => { const o: Pt[] = []; for (let k = a; k <= b; k++) o.push({ x: tr.x[k], z: tr.z[k] }); return o; };
    const A = track(sub(0, hold), {
      vmax: APP_V, lat: TAXI.lat, acc: TAXI.acc, dec: DECEL, v0: APP_V, v1: 0,
      cap: (sx) => sx < sEx - 40 ? Math.max(EXIT_V, Math.sqrt(Math.max(0, APP_V * APP_V - 2 * DECEL * sx))) : TAXI.vmax,
    });
    const B = track(sub(hold, tr.x.length - 1), { ...TAXI, v0: 0, v1: 0, cap: (_s, left) => left < 70 ? 1.5 + left * 0.04 : 99 });
    return { tr, A, B, hx: tr.x[hold], hz: tr.z[hold], hyaw: Math.atan2(tr.x[hold] - tr.x[hold - 1], tr.z[hold] - tr.z[hold - 1]) };
  }

  /** 在等待点插一段等待：轨迹拆成两段（停下、等、再走）。wait = 0 就是原样一段。 */
  private withWait(ip: InPath, tTd: number, wait: number): Seg[] {
    if (wait <= 0 || !ip.A || !ip.B) return [{ k: 'trk', t0: tTd, t1: tTd + ip.tr.dur, tr: ip.tr, land: true }];
    const t1 = tTd + ip.A.dur, t2 = up(t1 + wait);
    return [
      { k: 'trk', t0: tTd, t1, tr: ip.A, land: true },
      { k: 'wait', t0: t1, t1: t2, x: ip.hx, z: ip.hz, yaw: ip.hyaw },
      { k: 'trk', t0: t2, t1: t2 + ip.B.dur, tr: ip.B },
    ];
  }

  /** 推出、滑到跑道头、等、对正、起飞。在机位上停 `turn` 秒以后推出，推出可以再晚（避让）。 */
  private departure(p: Plan, s: PoolStand, atStand: number, turn: number, inS: Smp): { segs: Seg[]; pushEnd: number; rw: Runway; delay: number; occ: [number, number] } | null {
    const g = this.graph, e = s.e;
    const east01 = !s.west && this.rws[2] && hash2(p.id, 21) < 0.34;
    const rw = east01 ? this.rws[2] : this.rws[1];
    const key = `${rw.ref}:${s.i}`;
    if (!this.outCache.has(key)) this.outCache.set(key, this.buildOut(rw, s));
    const op = this.outCache.get(key);
    if (!op) return null;
    const { push, out, lineup, ax, az, ayaw, hx, hz, hyaw, s0 } = op, st = s.st;
    const tR = VR / ACC;
    for (const delay of DELAYS) {
      const tPush = up(atStand + turn + delay);
      const tOut = up(tPush + push.dur + 20);
      const tHS = tOut + out.dur;
      // 跑道空档：从对正开始到离地后 10 秒
      const tLU = up(this.runwayNext(rw, tHS, lineup.dur + HOLD + tR + 4));
      if (tLU - tHS > 600) continue;
      const tRoll = up(tLU + lineup.dur);
      const segs: Seg[] = [
        { k: 'wait', t0: atStand, t1: tPush, x: st.x, z: st.z, yaw: st.yaw, park: true },
        { k: 'trk', t0: tPush, t1: tPush + push.dur, tr: push, push: true },
        { k: 'wait', t0: tPush + push.dur, t1: tOut, x: ax, z: az, yaw: ayaw, spool: true },
        { k: 'trk', t0: tOut, t1: tHS, tr: out },
        { k: 'wait', t0: tHS, t1: tLU, x: hx, z: hz, yaw: hyaw },
        { k: 'trk', t0: tLU, t1: tRoll, tr: lineup, lineup: true },
        { k: 'roll', t0: tRoll, t1: tRoll + 260, rw, s0 },
      ];
      const smp = this.sample(segs, st.kind);
      if (this.conflicts(smp, p.id)) continue;
      void inS;
      return { segs, pushEnd: tPush + push.dur, rw, delay, occ: [tLU, tRoll + HOLD + tR + 4] };
    }
    return null;
  }

  /** 推出、滑出、对正的三段路径（和时间无关，按跑道和机位缓存）。 */
  private buildOut(rw: Runway, s: PoolStand): OutPath | null {
    const g = this.graph, e = s.e;
    const en = this.entries.get(`${rw.ref}${s.west ? 'W' : 'E'}`);
    if (!en) return null;
    const tree = g.tree(en.node);
    const La = Math.hypot(g.nx[e.b] - g.nx[e.a], g.nz[e.b] - g.nz[e.a]);
    const viaA = tree.dist[e.a] + e.f * La, viaB = tree.dist[e.b] + (1 - e.f) * La;
    if (!Number.isFinite(Math.min(viaA, viaB)) || Math.min(viaA, viaB) > 9000) return null;
    const first = viaA <= viaB ? e.a : e.b, back = first === e.a ? e.b : e.a;
    // 推出：机尾往要去的反方向拐。A 点在接入点往 back 那头 40 米（不超过那条边）
    const bl = Math.hypot(g.nx[back] - e.ex, g.nz[back] - e.ez), k = Math.min(40, bl * 0.9);
    const ax = e.ex + (g.nx[back] - e.ex) / Math.max(1e-6, bl) * k, az = e.ez + (g.nz[back] - e.ez) / Math.max(1e-6, bl) * k;
    const st = s.st;
    const push = track(smooth([{ x: st.x, z: st.z }, { x: e.ex, z: e.ez }, { x: ax, z: az }], 30), { vmax: 1.8, lat: 0.25, acc: 0.25, dec: 0.4, v0: 0, v1: 0 }, true);
    // 滑出：A → 接入点 → first → … → 上跑道的口 → 对正点
    const nodes = g.pathTo(en.node, first).reverse();
    const s0 = Math.max(60, en.s + 45);
    const lu = { x: rw.sx + rw.ux * s0, z: rw.sz + rw.uz * s0 };
    const all = smooth([{ x: ax, z: az }, { x: e.ex, z: e.ez }, ...nodes.map((n) => ({ x: g.nx[n], z: g.nz[n] })), lu], 40);
    // 等待点：上跑道的口前 70 米
    let s1 = 0, hs = 0;
    const L = all.map((q, j) => (j ? (s1 += Math.hypot(q.x - all[j - 1].x, q.z - all[j - 1].z)) : 0));
    const sEntry = L[L.length - 1] - Math.hypot(lu.x - g.nx[en.node], lu.z - g.nz[en.node]);
    while (hs < all.length - 2 && L[hs] < sEntry - 70) hs++;
    if (hs < 2) hs = Math.max(1, all.length - 3);
    const out = track(all.slice(0, hs + 1), { ...TAXI, v0: 0, v1: 0 });
    const lineup = track(all.slice(hs), { vmax: 6, lat: 0.6, acc: 0.5, dec: 0.8, v0: 0, v1: 0 });
    const hsYaw = Math.atan2(all[hs].x - all[hs - 1].x, all[hs].z - all[hs - 1].z);
    return { push, out, lineup, ax, az, ayaw: Math.atan2(e.ex - ax, e.ez - az), hx: all[hs].x, hz: all[hs].z, hyaw: hsYaw, s0 };
  }

  private standFree(i: number, a: number, b: number): boolean {
    for (const [x, y] of this.standUse.get(i) ?? []) if (a < y && b > x) return false;
    return true;
  }

  /**
   * 从 a 起最早什么时候这条跑道能空出 len 秒（起飞的占用从上跑道对正到离地后 4 秒）：别的起飞前后各 8 秒；落地的按时刻表
   * （排没排、跳没跳都算），接地前 15 秒（起飞的得在落地的过跑道头之前离地）到接地后 32 秒（滑到脱离口）。
   */
  private runwayNext(rw: Runway, a: number, len: number): number {
    for (let guard = 0; guard < 64; guard++) {
      let moved = false;
      const b = a + len;
      for (const [x, y] of this.depUse.get(rw) ?? []) if (a < y + 8 && b > x - 8) { a = y + 8; moved = true; }
      const j0 = Math.floor((a - T_APP - 40) / P) - 1, j1 = Math.ceil((a + len - T_APP + 20) / P) + 1;
      for (let j = j0; j <= j1; j++) {
        if (this.arrRunway(j) !== rw) continue;
        const td = j * P + T_APP;
        if (a < td + 32 && a + len > td - 15) { a = td + 32; moved = true; }
      }
      if (!moved) return a;
    }
    return a + 1e4;
  }

  // ------------------------------------------------------------------ 采样和冲突

  private sample(segs: Seg[], kind: PlaneKind): Smp {
    const g0 = Math.ceil(segs[0].t0 / DT) * DT, t1 = segs[segs.length - 1].t1;
    const n = Math.max(0, Math.floor((t1 - g0) / DT) + 1);
    const gx = new Float32Array(n), gz = new Float32Array(n);
    let si = 0;
    for (let k = 0; k < n; k++) {
      const t = g0 + k * DT;
      while (si < segs.length - 1 && t >= segs[si].t1) si++;
      const sg = segs[si];
      if (sg.k === 'roll') {
        const r = rollPose(sg.rw, sg.s0, t - sg.t0);
        if (!r || r.y > 4) { gx[k] = NaN; gz[k] = NaN; } else { gx[k] = r.x; gz[k] = r.z; }
      } else if (sg.k === 'wait') { gx[k] = sg.x; gz[k] = sg.z; }
      else if (sg.k === 'trk') {
        // 段从采样格上开始：查这条路径的缓存表
        const rel = relOf(sg.tr), j = Math.round((t - sg.t0) / DT);
        if (Math.abs(t - sg.t0 - j * DT) < 1e-6 && j >= 0) { const jj = Math.min(j, rel.x.length - 1); gx[k] = rel.x[jj]; gz[k] = rel.z[jj]; }
        else { at(sg.tr, t - sg.t0, TMP); gx[k] = TMP.x; gz[k] = TMP.z; }
      } else { gx[k] = NaN; gz[k] = NaN; }
    }
    const D = dims(kind);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { const x = gx[k], z = gz[k]; if (x === x) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } }
    return { g0, gx, gz, r: Math.max(D.span, D.len) * 0.36, bb: [x0, z0, x1, z1] };
  }

  private conflicts(c: Smp, self: number): boolean {
    for (const q of this.plans.values()) {
      if (q.id === self || !q.gx.length) continue;
      const a = Math.max(c.g0, q.g0), b = Math.min(c.g0 + (c.gx.length - 1) * DT, q.g0 + (q.gx.length - 1) * DT);
      if (a > b) continue;
      const R = c.r + q.r;
      if (c.bb[0] > q.bb[2] + R || q.bb[0] > c.bb[2] + R || c.bb[1] > q.bb[3] + R || q.bb[1] > c.bb[3] + R) continue;
      for (let t = a; t <= b; t += DT) {
        const i = Math.round((t - c.g0) / DT), j = Math.round((t - q.g0) / DT);
        const dx = c.gx[i] - q.gx[j], dz = c.gz[i] - q.gz[j];
        if (dx * dx + dz * dz < R * R) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ 每帧

  /**
   * 时刻 t（秒，游戏开始后的时钟）在飞、在滑、在机位上的所有飞机。`hour` 是游戏钟点（半夜班少）。
   * `onRunway(rw)`：玩家是不是在这条跑道上（复飞）；`car`：玩家（或玩家的车）在哪、多大，挡滑行的飞机。
   */
  poses(t: number, hour: number, _cx: number, _cz: number, onRunway: (rw: Runway) => boolean, car?: { x: number; z: number; r: number } | null): FlightPose[] {
    let dt = t - this.lastT;
    // 时钟跳了（拨钟、开局）：从「现在往前 W 秒」重新排
    if (dt < -1 || dt > 30) { this.reset(t); dt = 0; }
    this.lastT = t;
    dt = Math.min(dt, 0.5);
    const want = Math.floor((t + 5) / P);
    while (this.next <= want) { const p = this.plan(this.next, hour); this.plans.set(p.id, p); this.next++; }
    // 早就用完的机位和跑道占用清掉
    if (t - this.pruned > 60) {
      this.pruned = t;
      for (const l of [...this.standUse.values(), ...this.depUse.values()]) for (let k = l.length - 1; k >= 0; k--) if (l[k][1] < t - 120) l.splice(k, 1);
    }
    const out = this.out;
    out.length = 0;
    for (const [id, p] of this.plans) {
      if (t - p.lag > p.end + 5 && !p.ga) { this.plans.delete(id); continue; }
      if (t < p.segs[0].t0) continue;
      const pose = this.poseOf(p, t, dt, onRunway, car ?? null);
      if (!pose) { if (p.ga || t - p.lag > p.end) this.plans.delete(id); p.pOn = false; continue; }
      pose.id = id; pose.kind = p.kind; pose.livery = p.livery;
      if (pose.ground && pose.thrust < 0.9) { p.thr += (pose.thrust - p.thr) * Math.min(1, dt * 1.5); pose.thrust = p.thr; } else p.thr = pose.thrust;
      p.px = pose.x; p.pz = pose.z; p.pyaw = pose.yaw; p.pOn = pose.ground; p.pRoll = !pose.parked && pose.ground && Math.hypot(pose.vx, pose.vz) > 20;
      out.push(pose);
    }
    return out;
  }

  /** 重排：清掉所有的圈，从 t - W 开始排。 */
  reset(t: number): void {
    this.plans.clear(); this.standUse.clear();
    for (const l of this.depUse.values()) l.length = 0;
    this.next = Math.floor((t - W) / P);
  }

  private poseOf(p: Plan, t: number, dt: number, onRunway: (rw: Runway) => boolean, car: { x: number; z: number; r: number } | null): FlightPose | null {
    if (p.ga) return this.goAround(p, t);
    if (p.skip) return null;
    if (this.far) p.lag = 0;
    let tau = t - p.lag;
    const segs = p.segs;
    let k = 0;
    while (k < segs.length - 1 && tau >= segs[k].t1) k++;
    const sg = segs[k];
    if (tau >= sg.t1 && k === segs.length - 1 && sg.k !== 'roll' && p.stand) return null;
    const D = dims(p.kind);
    if (sg.k === 'app') {
      const d = APP_D - APP_V * (tau - sg.t0);
      const rw = p.arrRw;
      const ax = rw.sx + rw.ux * AIM, az = rw.sz + rw.uz * AIM;
      const y = Math.max(0, d * G3 - Math.max(0, 12 - d * G3) * 0.6);
      // 跑道上有人（或者有停着不动的飞机）：离跑道头 4 公里到 400 米之间复飞
      if (d > 400 && d < 4000 && (onRunway(rw) || this.runwayBlocked(rw, p.id))) {
        p.ga = { t, x: ax - rw.ux * d, y, z: az - rw.uz * d, v: APP_V };
        this.release(p);
      }
      const flare = d < 250 ? (250 - d) / 250 : 0;
      const yaw = Math.atan2(rw.ux, rw.uz);
      return pose(ax - rw.ux * d, y, az - rw.uz * d, yaw, 0.045 + flare * 0.06, rw.ux * APP_V, -APP_V * G3, rw.uz * APP_V, 0.42, true, false);
    }
    if (!p.stand) {
      // 没排上机位（极少）：滑跑到跑道北头消失（第二批的做法）
      const t1 = tau - sg.t0, rw = p.arrRw, tStop = (APP_V - 14) / DECEL;
      const s = t1 < tStop ? APP_V * t1 - 0.5 * DECEL * t1 * t1 : APP_V * tStop - 0.5 * DECEL * tStop * tStop + 14 * (t1 - tStop);
      const v = t1 < tStop ? APP_V - DECEL * t1 : 14;
      if (AIM + s > rw.len - 180) return null;
      p.end = Math.max(p.end, tau + 1);
      return pose(rw.sx + rw.ux * (AIM + s), 0, rw.sz + rw.uz * (AIM + s), Math.atan2(rw.ux, rw.uz), 0, rw.ux * v, 0, rw.uz * v, t1 < 14 ? 0.85 : 0.25, true, true);
    }
    if (sg.k === 'wait') {
      // 等待点上把被挡住耽误的时间吃回来（停机位上不吃：那是推出前）
      if (p.lag > 0 && !sg.park) { p.lag = Math.max(0, p.lag - dt); tau = t - p.lag; }
      const f = pose(sg.x, 0, sg.z, sg.yaw, 0, 0, 0, 0, sg.park ? 0 : sg.spool ? 0.35 : 0.22, true, true);
      f.parked = !!sg.park; f.arr = tau < p.standFrom;
      return f;
    }
    if (sg.k === 'trk') {
      at(sg.tr, tau - sg.t0, TMP);
      const fwd = sg.tr.rev ? -1 : 1;
      // 被挡住：落地滑跑（还快）的时候不停
      if (!(sg.land && TMP.v > 20) && dt > 0) {
        const blocked = this.blocked(p, TMP.x, TMP.z, sg.tr.rev ? TMP.yaw + Math.PI : TMP.yaw, D.len, D.span, car);
        if (blocked) { p.lag += dt; TMP.v = 0; }
        if (blocked === 'plane') {
          p.blockT += dt;
          // 互相挡住太久：编号大的那架当没看见（死锁）
          if (p.blockT > 40) { p.ghost = 25; p.blockT = 0; }
        } else p.blockT = 0;
      }
      if (p.ghost > 0) p.ghost -= dt;
      const vx = Math.sin(TMP.yaw) * TMP.v * fwd, vz = Math.cos(TMP.yaw) * TMP.v * fwd;
      const t1 = tau - sg.t0;
      let thrust = sg.push ? 0.12 : TMP.a > 0.15 ? 0.6 : 0.25;
      if (sg.land && t1 > 1.5 && t1 < 14) thrust = 0.85;
      const nose = sg.land && t1 < 2.5 ? 0.05 * (1 - t1 / 2.5) : 0;
      const f = pose(TMP.x, 0, TMP.z, TMP.yaw, nose, vx, 0, vz, thrust, true, true);
      f.push = !!sg.push; f.arr = tau < p.standFrom;
      return f;
    }
    // 起飞：对正后等几秒（前面跑道上有飞机就接着等）、加速、抬轮、爬升
    const t1 = tau - sg.t0;
    // 对正以后：前面跑道上有车（玩家）或者停着的飞机，接着等；后面的不管（尾流吹它）
    if (t1 < HOLD && dt > 0 && (this.runwayAhead(p, sg.rw) || (car && onRunway(sg.rw) && (car.x - sg.rw.sx) * sg.rw.ux + (car.z - sg.rw.sz) * sg.rw.uz > sg.s0 - 10))) p.lag += dt;
    const r = rollPose(sg.rw, sg.s0, t1);
    if (!r) { p.end = Math.min(p.end, tau); return null; }
    p.end = Math.max(p.end, tau + 1);
    const f = pose(r.x, r.y, r.z, Math.atan2(sg.rw.ux, sg.rw.uz), r.pitch, sg.rw.ux * r.v, r.vy, sg.rw.uz * r.v, r.thrust, r.gear, r.y < 0.5);
    f.arr = false;
    return f;
  }

  /** 前面有没有挡路的：玩家（的车）或者别的在地上的飞机，在机头前方 60 米、机翼宽度里。 */
  private blocked(p: Plan, x: number, z: number, yaw: number, len: number, span: number, car: { x: number; z: number; r: number } | null): 'car' | 'plane' | null {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const ahead = (ox: number, oz: number, r: number, lo: number, hi: number) => {
      const dx = ox - x, dz = oz - z, a = dx * fx + dz * fz, l = Math.abs(dx * fz - dz * fx);
      return a > lo && a < hi && l < span * 0.35 + r;
    };
    if (car && ahead(car.x, car.z, car.r, len / 2 - 6, len / 2 + 60)) return 'car';
    if (p.ghost > 0) return null;
    for (const q of this.plans.values()) {
      if (q === p || !q.pOn || q.ga) continue;
      const qd = dims(q.kind);
      // 互相挡住的时候编号小的先走
      if (ahead(q.px, q.pz, qd.span * 0.3, 0, len / 2 + qd.len / 2 + 25) && !(q.lag > 0 && p.lag > 0 && p.id < q.id && p.blockT > 40)) return 'plane';
    }
    return null;
  }

  /** 起飞前：同一条跑道前方（对正点往前）还有在地上的飞机。 */
  private runwayAhead(p: Plan, rw: Runway): boolean {
    for (const q of this.plans.values()) {
      if (q === p || !q.pOn) continue;
      const s = (q.px - rw.sx) * rw.ux + (q.pz - rw.sz) * rw.uz, o = Math.abs((q.px - rw.sx) * -rw.uz + (q.pz - rw.sz) * rw.ux);
      if (o < rw.w / 2 + 5 && s > 0 && s < rw.len && q.lag > 0 && !q.pRoll) return true;
    }
    return false;
  }

  /** 跑道上有停着不动的飞机（被挡住、耽误了的）。 */
  private runwayBlocked(rw: Runway, self: number): boolean {
    for (const q of this.plans.values()) {
      if (q.id === self || !q.pOn || q.lag < 3) continue;
      const s = (q.px - rw.sx) * rw.ux + (q.pz - rw.sz) * rw.uz, o = Math.abs((q.px - rw.sx) * -rw.uz + (q.pz - rw.sz) * rw.ux);
      if (o < rw.w / 2 + 10 && s > -60 && s < rw.len + 60) return true;
    }
    return false;
  }

  /** 复飞了：机位和起飞的时间让出来。 */
  private release(p: Plan): void {
    if (p.stand) {
      const l = this.standUse.get(p.stand.i);
      if (l) { const k = l.findIndex(([a]) => a === p.standFrom - 20); if (k >= 0) l.splice(k, 1); }
    }
    p.gx = new Float32Array(0); p.gz = new Float32Array(0);
  }

  private goAround(p: Plan, t: number): FlightPose | null {
    const ga = p.ga!, rw = p.arrRw, yaw = Math.atan2(rw.ux, rw.uz);
    const dt = t - ga.t, v = Math.min(95, ga.v + 1.5 * dt), cl = Math.sin(6 * Math.PI / 180);
    const tc = (95 - ga.v) / 1.5, s = dt < tc ? ga.v * dt + 0.75 * dt * dt : ga.v * tc + 0.75 * tc * tc + 95 * (dt - tc);
    const y = ga.y + s * cl;
    if (y > GONE_H || s > 15000) return null;
    return pose(ga.x + rw.ux * s, y, ga.z + rw.uz * s, yaw, 0.16, rw.ux * v, v * cl, rw.uz * v, 0.95, dt < 4, false);
  }

  /** 第 i 圈停在哪个机位、从几点到几点（探针用）。 */
  standOf(id: number): { stand: PoolStand; from: number; to: number } | null {
    const p = this.plans.get(id);
    return p?.stand ? { stand: p.stand, from: p.standFrom, to: p.standTo } : null;
  }

  /** 现在排着的所有圈（探针、测试用）。 */
  get planned(): readonly { id: number; stand: number; from: number; to: number; ga: boolean; skip: boolean; lag: number }[] {
    return [...this.plans.values()].map((p) => ({ id: p.id, stand: p.stand?.i ?? -1, from: p.standFrom, to: p.standTo, ga: !!p.ga, skip: p.skip, lag: p.lag }));
  }
}

interface Smp { g0: number; gx: Float32Array; gz: Float32Array; r: number; bb: number[] }
/** 推出可以晚多少秒（避让）。 */
const DELAYS = [0, 20, 40, 60, 90, 120, 160, 200, 260, 330, 420, 520, 640];
const REL = new WeakMap<Track, { x: Float32Array; z: Float32Array }>();
/** 一条路径每 DT 秒的位置（从 0 开始，缓存）。 */
function relOf(tr: Track): { x: Float32Array; z: Float32Array } {
  let r = REL.get(tr);
  if (r) return r;
  const n = Math.ceil(tr.dur / DT) + 1, x = new Float32Array(n), z = new Float32Array(n);
  for (let k = 0; k < n; k++) { at(tr, k * DT, TMP); x[k] = TMP.x; z[k] = TMP.z; }
  r = { x, z };
  REL.set(tr, r);
  return r;
}
interface InPath { tr: Track; A: Track | null; B: Track | null; hx: number; hz: number; hyaw: number }
interface OutPath { push: Track; out: Track; lineup: Track; ax: number; az: number; ayaw: number; hx: number; hz: number; hyaw: number; s0: number }

const TMP = { x: 0, z: 0, yaw: 0, v: 0, a: 0 };

function pose(x: number, y: number, z: number, yaw: number, pitch: number, vx: number, vy: number, vz: number, thrust: number, gear: boolean, ground: boolean): FlightPose {
  return { id: 0, kind: 0, livery: 0, x, y, z, yaw, pitch, vx, vy, vz, thrust, gear, landing: !ground || thrust > 0.9 || vx * vx + vz * vz > 400, ground, arr: true, parked: false, push: false };
}

/** 起飞：从对正点（跑道头往里 s0 米）起，τ 秒时的位置。等 HOLD 秒、加速、抬轮（3 秒抬到 10°）、离地、爬升。 */
function rollPose(rw: Runway, s0: number, tau: number): { x: number; y: number; z: number; v: number; vy: number; pitch: number; thrust: number; gear: boolean } | null {
  const P0 = (s: number, y: number, v: number, vy: number, pitch: number, thrust: number, gear: boolean) => ({ x: rw.sx + rw.ux * (s0 + s), y, z: rw.sz + rw.uz * (s0 + s), v, vy, pitch, thrust, gear });
  if (tau < HOLD) return P0(0, 0, 0, 0, 0, tau > HOLD - 3 ? 0.6 : 0.3, true);
  const t1 = tau - HOLD, tR = VR / ACC, sR = 0.5 * ACC * tR * tR;
  if (t1 < tR) return P0(0.5 * ACC * t1 * t1, 0, ACC * t1, 0, 0, 1, true);
  const t2 = t1 - tR, v = Math.min(95, VR + 1.2 * t2), tc = (95 - VR) / 1.2;
  const s = sR + (t2 < tc ? VR * t2 + 0.6 * t2 * t2 : VR * tc + 0.6 * tc * tc + 95 * (t2 - tc));
  const rot = Math.min(1, t2 / 3), lift = Math.max(0, t2 - 2.5);
  const climb = Math.min(CLIMB, lift * 0.05), y = Math.max(0, (s - sR - VR * 2.5) * Math.tan(climb * 0.85));
  if (y > GONE_H || s > 16000) return null;
  return P0(s, y, v, v * Math.sin(climb), 0.17 * rot, 0.95, lift < 7);
}
