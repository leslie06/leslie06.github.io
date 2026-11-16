import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import { t } from '../core/I18n';
import type { CarLook, HudApi, PlayerApi, RenderApi, VehicleApi } from '../game/Contracts';
import type { ExternalCars, TrafficApi } from '../traffic';
import { CarKit } from '../traffic/CarKit';
import type { Livery } from '../vehicle/CarModel';
import { ControlFilter, type DriveInput } from '../vehicle/ControlFilter';
import { bodySettled, readyBodies, specLength } from '../vehicle/Bodies';
import { SPEC_OF } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import type { AirfieldData } from './Data';
import type { AirportApi } from './index';
import { bridgeEnds, hash2, occupied, stands, type Stand } from './Parked';
import { dims, type PlaneKind } from './Plane';

/**
 * 空侧勤务车（2026-11-16，第三批，「接着做第三批」；设计 docs/airport-design.md §5.2、§7，笔记 docs/notes/airport.md）：
 *
 * - **会动的勤务车**：沿 airfield.json 的空侧勤务道（`roads`，不在路网里）跑的黄色引导车（轿车车身，黄漆、琥珀色灯条、车门
 *   「引导车 FOLLOW ME」）和摆渡车（公交车身，白蓝涂装、线路牌「摆渡 T3 远机位」）。勤务道在建城时就是一堆折线，这里把它们
 *   在交叉、丁字口处切开连成图（`ServiceNet`），车在图上随便走，走到死胡同就原地掉头。只在玩家身边是实体车（真 `Vehicle`，
 *   能撞能抢，交给 traffic 的 `addExternalCars`），离远了就收掉，远处不画。玩家身边同时 4 / 6 / 8 辆（按画质），省电档 2 辆。
 *   前方有东西（射线：楼、廊桥撑脚、飞机、车）就停；地上在动的飞机（`AirportApi.flights` 里 `ground` 的）挡在前方 60 米的路上
 *   也停下让。
 * - **登机梯车跳台**：玩家附近停着飞机的远机位（门口没有廊桥的）按概率摆一辆静止的登机梯车：程序生成的车身（底盘、驾驶室、
 *   斜梯、扶手、后面放下来的踏板）加一个车能开上去的楔形碰撞体（13°，顶 2.7 米，跟特技坡道一样是凸包，人车都挡）。摆的时候
 *   挑一个前后都空着的朝向：后面 25 米助跑、前面 45 米落地，不压飞机、廊桥、勤务道、滑行道，不出空侧。从梯子上飞出去 8 米以上
 *   算一次特技跳（`stunt:jump`，`ramp` 3000 + 机位号），屏幕上报米数。梯车第一版**开不走**（静止道具）。
 * - 停着的飞机旁边的锥桶（翼尖、机头、机尾，能撞飞的轻道具）和远机位上一辆静止的行李牵引车加两节行李拖斗（固定碰撞体）。
 *
 * 机位上有没有飞机按 `Parked.occupied`（钟点取 render 的 `timeOfDay`），`Flights` 管的机位（`poolSet`，飞机会滑进滑出）跳过。
 * `?ground=0` 关掉整个系统。
 */
export interface GroundApi extends System {
  readonly debug: {
    cars(): { id: number; kind: 'guide' | 'bus'; x: number; z: number; y: number; v: number; mode: string; stuck: number; wait: string; car: Vehicle }[];
    sites(): { stand: number; truck: { x: number; z: number; yaw: number } | null; tug: { x: number; z: number; yaw: number } | null; cones: number }[];
    net(): ServiceNet | null;
    stats: { spawned: number; despawned: number; uturns: number; backups: number; jumps: number; lastJump: number };
    /** 探针：假装地上有这些飞机（勤务车该不该让）。 */
    fakePlanes: { x: number; z: number; yaw: number; kind: PlaneKind; vx: number; vz: number }[];
    /** 探针：在路 `road` 的 s 米处、朝 d 方向放一辆。 */
    spawnAt(kind: 'guide' | 'bus', road: number, s: number, d: 1 | -1): Vehicle | null;
  };
}

/** 机场引导车：黄车身、琥珀色灯条（`beaconAmber`）、车门「引导车 FOLLOW ME」。 */
export const GUIDE_LIVERY: Livery = {
  upper: '#f2c200', lower: '#f2c200', roofSign: null, beacons: true, beaconAmber: true,
  plate: { text: '京A·J2046', bg: '#f2c21b', fg: '#111111' },
  doorText: '引导车 FOLLOW ME', doorColor: '#111111',
};
/** 摆渡车：白上蓝下，线路牌写摆渡。 */
export const SHUTTLE_LIVERY: Livery = {
  upper: '#f3f5f7', lower: '#1d5fb8', roofSign: null,
  plate: { text: '京A·J3310', bg: '#f2c21b', fg: '#111111' },
  doorText: '首都机场 摆渡车', doorColor: '#ffffff', dest: ['摆渡', 'T3 远机位'],
};

// ---- 勤务道连成图（纯数据，Node 里能测） ---------------------------------------------------------------

const GCELL = 64;
/** 线段的格子索引：长线段按半格取样登记，查询看周围的格子。 */
class SegGrid {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private tick = 0;
  constructor(n: number) { this.stamp = new Int32Array(n); }
  private key(cx: number, cz: number) { return (cx + 32768) * 65536 + (cz + 32768); }
  add(id: number, ax: number, az: number, bx: number, bz: number): void {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (GCELL / 2)));
    let last = NaN;
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, key = this.key(Math.floor(x / GCELL), Math.floor(z / GCELL));
      if (key === last) continue;
      last = key;
      const c = this.cells.get(key);
      if (!c) this.cells.set(key, [id]); else if (c[c.length - 1] !== id) c.push(id);
    }
  }
  /** 半径 r 内可能碰到的线段（去重）。 */
  query(x: number, z: number, r: number, cb: (id: number) => void): void {
    if (++this.tick > 2e9) { this.tick = 1; this.stamp.fill(0); }
    const tk = this.tick;
    const r1 = r + GCELL / 2;
    const c0 = Math.floor((x - r1) / GCELL), c1 = Math.floor((x + r1) / GCELL), d0 = Math.floor((z - r1) / GCELL), d1 = Math.floor((z + r1) / GCELL);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const c = this.cells.get(this.key(cx, cz));
      if (!c) continue;
      for (const id of c) { if (this.stamp[id] === tk) continue; this.stamp[id] = tk; cb(id); }
    }
  }
}

/** 点到线段的距离和线段上的参数 t（0..1）。 */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
  return { d: Math.hypot(ax + dx * t - x, az + dz * t - z), t };
}

export interface GEdge { road: number; s0: number; s1: number; a: number; b: number }
export interface GNode { x: number; z: number; out: { e: number; dir: 1 | -1 }[] }

/**
 * 空侧勤务道的图：OSM 的 service 路是一段段折线，在交叉点、一条的端点落在另一条上（4 米内）的地方切开，切点 6 米内并成
 * 一个节点。边是一条折线上相邻两个切点之间的一段（`s0`..`s1`，按那条折线自己的里程）。
 */
export class ServiceNet {
  readonly roads: { p: number[]; cum: number[]; len: number }[];
  readonly nodes: GNode[] = [];
  readonly edges: GEdge[] = [];
  /** 每条路上的边（按 s 排）。 */
  readonly roadEdges: number[][];
  private readonly segRoad: Int32Array;
  private readonly segK: Int32Array;
  private readonly grid: SegGrid;

  constructor(d: AirfieldData) {
    this.roads = d.roads.map((r) => {
      const cum = [0];
      for (let i = 2; i < r.p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]));
      return { p: r.p, cum, len: cum[cum.length - 1] };
    });
    let nSeg = 0;
    for (const r of this.roads) nSeg += r.cum.length - 1;
    this.segRoad = new Int32Array(nSeg); this.segK = new Int32Array(nSeg);
    this.grid = new SegGrid(nSeg);
    let id = 0;
    this.roads.forEach((r, ri) => {
      for (let k = 0; k + 1 < r.cum.length; k++, id++) {
        this.segRoad[id] = ri; this.segK[id] = k;
        this.grid.add(id, r.p[2 * k], r.p[2 * k + 1], r.p[2 * k + 2], r.p[2 * k + 3]);
      }
    });
    // 切点：两条线段真交叉、一条路的端点落在别的线段 4 米内
    const cuts: { s: number; x: number; z: number }[][] = this.roads.map(() => []);
    const seg = (sid: number) => { const r = this.roads[this.segRoad[sid]], k = this.segK[sid]; return [r.p[2 * k], r.p[2 * k + 1], r.p[2 * k + 2], r.p[2 * k + 3], r.cum[k], r.cum[k + 1] - r.cum[k]]; };
    for (let A = 0; A < nSeg; A++) {
      const [ax, az, bx, bz, sa, la] = seg(A), ra = this.segRoad[A], ka = this.segK[A];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      this.grid.query(mx, mz, la / 2 + 2, (B) => {
        if (B <= A) return;
        const rb = this.segRoad[B];
        if (rb === ra && Math.abs(this.segK[B] - ka) <= 1) return;
        const [cx, cz, dx, dz, sb, lb] = seg(B);
        const ex = bx - ax, ez = bz - az, fx = dx - cx, fz = dz - cz, den = ex * fz - ez * fx;
        if (Math.abs(den) < 1e-9) return;
        const tt = ((cx - ax) * fz - (cz - az) * fx) / den, u = ((cx - ax) * ez - (cz - az) * ex) / den;
        if (tt < 0 || tt > 1 || u < 0 || u > 1) return;
        const x = ax + ex * tt, z = az + ez * tt;
        cuts[ra].push({ s: sa + la * tt, x, z });
        cuts[rb].push({ s: sb + lb * u, x, z });
      });
    }
    this.roads.forEach((r, ri) => {
      for (const end of [0, 1]) {
        const k = end ? r.cum.length - 1 : 0, x = r.p[2 * k], z = r.p[2 * k + 1], sEnd = end ? r.len : 0;
        let best = Infinity, bs = 0, br = -1;
        this.grid.query(x, z, 4, (B) => {
          const rb = this.segRoad[B];
          const [cx, cz, dx, dz, sb, lb] = seg(B);
          const q = segDist(x, z, cx, cz, dx, dz), s = sb + lb * q.t;
          if (rb === ri && Math.abs(s - sEnd) < 12) return;
          if (q.d < 4 && q.d < best) { best = q.d; bs = s; br = rb; }
        });
        if (br >= 0) { cuts[ri].push({ s: sEnd, x, z }); const p = this.at(br, bs); cuts[br].push({ s: bs, x: p.x, z: p.z }); }
      }
    });
    // 切点并成节点（6 米内同一个）
    const nodeGrid = new Map<number, number[]>();
    const nk = (x: number, z: number) => (Math.floor(x / 16) + 32768) * 65536 + Math.floor(z / 16) + 32768;
    const nodeAt = (x: number, z: number): number => {
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of nodeGrid.get((cx + i + 32768) * 65536 + cz + j + 32768) ?? []) {
        if (Math.hypot(this.nodes[n].x - x, this.nodes[n].z - z) < 6) return n;
      }
      const n = this.nodes.length;
      this.nodes.push({ x, z, out: [] });
      const key = nk(x, z), c = nodeGrid.get(key);
      if (c) c.push(n); else nodeGrid.set(key, [n]);
      return n;
    };
    this.roadEdges = this.roads.map((r, ri) => {
      const cs = cuts[ri];
      if (!cs.some((c) => c.s < 1)) { const p = this.at(ri, 0); cs.push({ s: 0, x: p.x, z: p.z }); }
      if (!cs.some((c) => c.s > r.len - 1)) { const p = this.at(ri, r.len); cs.push({ s: r.len, x: p.x, z: p.z }); }
      cs.sort((a, b) => a.s - b.s);
      const kept: { s: number; n: number }[] = [];
      for (const c of cs) {
        const s = Math.max(0, Math.min(r.len, c.s));
        if (kept.length && s - kept[kept.length - 1].s < 1.5) continue;
        kept.push({ s, n: nodeAt(c.x, c.z) });
      }
      // 最后一个切点离终点很近（合并掉了），终点就算它
      kept[kept.length - 1].s = Math.max(kept[kept.length - 1].s, kept.length > 1 ? kept[kept.length - 1].s : r.len);
      const list: number[] = [];
      for (let i = 0; i + 1 < kept.length; i++) {
        if (kept[i + 1].s - kept[i].s < 1) continue;
        const e = this.edges.length;
        this.edges.push({ road: ri, s0: kept[i].s, s1: kept[i + 1].s, a: kept[i].n, b: kept[i + 1].n });
        this.nodes[kept[i].n].out.push({ e, dir: 1 });
        this.nodes[kept[i + 1].n].out.push({ e, dir: -1 });
        list.push(e);
      }
      return list;
    });
  }

  /** 路 `road` 上 s 米处的点和走向（沿 s 增大的方向）。 */
  at(road: number, s: number, out = { x: 0, z: 0, dx: 0, dz: 1 }): { x: number; z: number; dx: number; dz: number } {
    const r = this.roads[road], cum = r.cum;
    s = Math.max(0, Math.min(r.len, s));
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const k = Math.max(0, Math.min(cum.length - 2, lo)), L = cum[k + 1] - cum[k] || 1, tt = (s - cum[k]) / L;
    const ax = r.p[2 * k], az = r.p[2 * k + 1], bx = r.p[2 * k + 2], bz = r.p[2 * k + 3];
    out.x = ax + (bx - ax) * tt; out.z = az + (bz - az) * tt;
    out.dx = (bx - ax) / L; out.dz = (bz - az) / L;
    return out;
  }

  /** (x, z) 在 `road` 的 [lo, hi] 那一截上最近的 s。 */
  project(road: number, x: number, z: number, lo: number, hi: number): number {
    const r = this.roads[road], cum = r.cum;
    let best = Infinity, bs = lo;
    for (let k = 0; k + 1 < cum.length; k++) {
      if (cum[k + 1] < lo || cum[k] > hi) continue;
      const q = segDist(x, z, r.p[2 * k], r.p[2 * k + 1], r.p[2 * k + 2], r.p[2 * k + 3]);
      if (q.d < best) { best = q.d; bs = cum[k] + (cum[k + 1] - cum[k]) * q.t; }
    }
    return Math.max(lo, Math.min(hi, bs));
  }

  /** 离 (x, z) 最近的勤务道（`r` 米内）：哪条、多少米处、多远。 */
  nearest(x: number, z: number, r: number): { road: number; s: number; d: number } | null {
    let best: { road: number; s: number; d: number } | null = null;
    this.grid.query(x, z, r, (id) => {
      const ri = this.segRoad[id], k = this.segK[id], p = this.roads[ri].p, cum = this.roads[ri].cum;
      const q = segDist(x, z, p[2 * k], p[2 * k + 1], p[2 * k + 2], p[2 * k + 3]);
      if (q.d < r && (!best || q.d < best.d)) best = { road: ri, s: cum[k] + (cum[k + 1] - cum[k]) * q.t, d: q.d };
    });
    return best;
  }

  /** 路 `road` 上 s 米处所在的边。 */
  edgeAt(road: number, s: number): number {
    const list = this.roadEdges[road];
    for (const e of list) if (s <= this.edges[e].s1 + 1e-6) return e;
    return list[list.length - 1] ?? -1;
  }
}

// ---- 程序生成的道具：登机梯车、行李牵引车、行李拖斗、锥桶 -----------------------------------------------

/** 登机梯车（本地坐标：+Z 是梯顶那头，原点在车身中线的地面上）：坡从 `zA` 的地面升到 `zB` 的 `H` 米高，宽 `W`。 */
export const STAIR = { H: 2.7, zA: -7.4, zB: 4.0, W: 3.0 };
const STAIR_TAN = STAIR.H / (STAIR.zB - STAIR.zA);
const stairY = (z: number) => STAIR_TAN * (z - STAIR.zA);

function colour(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string, rx = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return colour(g.translate(x, y, z), hex);
}
function wheel(r: number, w: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return colour(new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, y, z), '#151515');
}
/** 沿坡的斜梁：从 z0 到 z1，贴着坡面往上 `up` 米。 */
function slant(w: number, h: number, x: number, z0: number, z1: number, up: number, hex: string): THREE.BufferGeometry {
  const len = (z1 - z0) / Math.cos(Math.atan(STAIR_TAN)), zm = (z0 + z1) / 2;
  return box(w, h, len, x, stairY(zm) + up, zm, hex, -Math.atan(STAIR_TAN));
}

function stairTruckGeometry(): THREE.BufferGeometry {
  const { zA, zB } = STAIR;
  const p: THREE.BufferGeometry[] = [];
  const Z0 = -4.3;   // 车身尾
  // 底盘、轮子、驾驶室（梯顶下面）
  p.push(box(2.3, 0.45, zB - Z0, 0, 0.75, (zB + Z0) / 2, '#3a3d40'));
  for (const z of [-2.9, 2.5]) for (const x of [1.05, -1.05]) p.push(wheel(0.45, 0.34, x, 0.45, z));
  p.push(box(2.2, 1.05, 1.6, 0, 1.45, 3.15, '#eef0f1'));
  p.push(box(2.24, 0.14, 1.64, 0, 1.08, 3.15, '#e2571a'));
  p.push(box(1.9, 0.45, 0.04, 0, 1.68, 3.96, '#1d2730'));
  for (const x of [1.11, -1.11]) p.push(box(0.04, 0.42, 1.1, x, 1.68, 3.15, '#1d2730'));
  // 支撑：底盘到梯子下面
  for (const z of [-2.6, 0.6]) for (const x of [0.95, -0.95]) { const top = stairY(z) - 0.3, bot = 0.97; p.push(box(0.16, top - bot, 0.16, x, (top + bot) / 2, z, '#5b6066')); }
  // 梯子：两根侧梁、踏板和踢板（踏板中心压在坡面上，碰撞体就是这个坡面）
  for (const x of [1.42, -1.42]) p.push(slant(0.14, 0.34, x, Z0, zB, -0.1, '#9aa1a8'));
  const n = 12, depth = (zB - Z0) / n;
  for (let k = 0; k < n; k++) {
    const zc = Z0 + depth * (k + 0.5);
    p.push(box(2.7, 0.05, depth, 0, stairY(zc), zc, '#b8bdc2'));
    p.push(box(2.7, depth * STAIR_TAN, 0.03, 0, stairY(zc) + depth * STAIR_TAN / 2, zc + depth / 2, '#8d939a'));
  }
  // 后面放下来的踏板：黄底黑条
  p.push(slant(2.8, 0.06, 0, zA, Z0, 0.02, '#e8b400'));
  for (let k = 0; k < 4; k++) { const z = zA + 0.5 + k * (Z0 - zA - 0.8) / 3; p.push(box(2.8, 0.025, 0.28, 0, stairY(z) + 0.06, z, '#151515', -Math.atan(STAIR_TAN))); }
  // 扶手：立柱、上扶手、中扶手
  for (const x of [1.45, -1.45]) {
    for (const z of [-4.0, -1.5, 1.0, 3.6]) p.push(box(0.06, 1.05, 0.06, x, stairY(z) + 0.52, z, '#d9dcdf'));
    p.push(slant(0.06, 0.06, x, -4.0, 3.6, 1.05, '#d9dcdf'));
    p.push(slant(0.05, 0.05, x, -4.0, 3.6, 0.55, '#d9dcdf'));
  }
  const g = mergeGeometries(p)!;
  for (const q of p) q.dispose();
  return g;
}

function tugGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [
    box(1.5, 0.55, 2.7, 0, 0.6, 0, '#f0b800'),
    box(1.3, 0.35, 0.8, 0, 1.05, 0.85, '#f0b800'),
    box(0.6, 0.15, 0.5, 0, 0.98, -0.5, '#1b1c1e'),
    box(0.6, 0.5, 0.1, 0, 1.25, -0.78, '#1b1c1e'),
    box(1.45, 0.06, 1.5, 0, 1.98, -0.25, '#2a2d31'),
    box(1.6, 0.2, 0.15, 0, 0.45, 1.4, '#1b1c1e'),
    box(0.5, 0.3, 0.08, 0, 0.42, -1.38, '#1b1c1e'),
  ];
  for (const x of [0.66, -0.66]) for (const z of [0.45, -0.95]) p.push(box(0.06, 1.1, 0.06, x, 1.42, z, '#2a2d31'));
  for (const x of [0.7, -0.7]) for (const z of [0.95, -0.95]) p.push(wheel(0.3, 0.22, x, 0.3, z));
  const g = mergeGeometries(p)!;
  for (const q of p) q.dispose();
  return g;
}

function cartGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [
    box(1.5, 0.12, 2.6, 0, 0.55, 0, '#6b7178'),
    box(1.55, 0.05, 2.65, 0, 1.75, 0, '#3a4f6b'),
    box(0.03, 1.1, 2.5, 0.76, 1.15, 0, '#2f5f9e'),
    box(1.5, 1.1, 0.03, 0, 1.15, 1.29, '#2f5f9e'),
    box(0.08, 0.08, 0.8, 0, 0.4, 1.68, '#2a2d31'),
  ];
  for (const x of [0.74, -0.74]) for (const z of [1.28, -1.28]) p.push(box(0.05, 1.2, 0.05, x, 1.15, z, '#2a2d31'));
  for (const x of [0.6, -0.6]) for (const z of [0.95, -0.95]) p.push(wheel(0.2, 0.15, x, 0.2, z));
  // 车上的箱子（敞着的那边看得见）
  const bags: [number, number, number, string][] = [[-0.35, 0.86, -0.8, '#1f2a44'], [-0.4, 0.86, -0.15, '#8c1d1d'], [-0.35, 0.86, 0.5, '#2c2c2e'], [0.25, 0.86, -0.5, '#4a6b3f'], [0.2, 0.86, 0.35, '#b9bcbf'], [-0.3, 1.32, -0.45, '#c9b48f']];
  for (const [x, y, z, c] of bags) p.push(box(0.5, 0.5, 0.42, x, y, z, c));
  const g = mergeGeometries(p)!;
  for (const q of p) q.dispose();
  return g;
}

function coneGeometry(): THREE.BufferGeometry {
  const base = colour(new THREE.BoxGeometry(0.38, 0.035, 0.38).translate(0, 0.0175, 0), '#e8591c');
  const pts = [new THREE.Vector2(0.17, 0.035), new THREE.Vector2(0.155, 0.1), new THREE.Vector2(0.035, 0.72), new THREE.Vector2(0.001, 0.73)];
  const body = new THREE.LatheGeometry(pts, 14);
  const pos = body.getAttribute('position'), col = new Float32Array(pos.count * 3);
  const o = new THREE.Color('#f0621c'), w = new THREE.Color('#f2f2ee');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), c = (y > 0.3 && y < 0.4) || (y > 0.49 && y < 0.56) ? w : o;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  body.deleteAttribute('uv');
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return mergeGeometries([base.toNonIndexed(), body.toNonIndexed()])!;
}

// ---- 平面上的矩形（飞机、道具的占地） -------------------------------------------------------------------

interface Rect { x: number; z: number; ux: number; uz: number; hl: number; hw: number }
const inRect = (r: Rect, x: number, z: number, m: number) => {
  const dx = x - r.x, dz = z - r.z, a = dx * r.ux + dz * r.uz, b = dx * r.uz - dz * r.ux;
  return Math.abs(a) <= r.hl + m && Math.abs(b) <= r.hw + m;
};
/** 一架停着（或在地上）的飞机占的地：机身、机翼（后掠按多占一截算）、平尾。 */
function planeRects(x: number, z: number, yaw: number, kind: PlaneKind, out: Rect[]): void {
  const D = dims(kind), ux = Math.sin(yaw), uz = Math.cos(yaw);
  out.push({ x, z, ux, uz, hl: D.len / 2, hw: D.r + 0.4 });
  const wz = D.wingZ - D.span * 0.1;
  out.push({ x: x + ux * wz, z: z + uz * wz, ux, uz, hl: D.chord / 2 + D.span * 0.12, hw: D.span / 2 });
  const tz = -D.len * 0.42;
  out.push({ x: x + ux * tz, z: z + uz * tz, ux, uz, hl: 3.2, hw: D.span * 0.2 });
}

// ---- 系统 -------------------------------------------------------------------------------------------

type Kind = 'guide' | 'bus';
interface Step { e: number; d: 1 | -1 }
interface GCar {
  id: number; kind: Kind; car: Vehicle; filter: ControlFilter;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  upper: THREE.Color; lower: THREE.Color;
  /** 'drive' 沿路开，'uturn' 死胡同掉头，'back' 卡住了倒一把，'parked' 玩家开过、扔下的（没人开）。 */
  mode: 'drive' | 'uturn' | 'back' | 'parked';
  modeT: number;
  e: number; d: 1 | -1; s: number; queue: Step[];
  vmax: number;
  /** 前方障碍物的距离（射线、地上的飞机、徒步的玩家），多久测一次。 */
  obst: number; obstKind: string; senseT: number;
  blockedBy: GCar | null;
  stuck: number; backs: number;
  /** 徒步的玩家刚挡过路、站在车边：还要停几秒。 */
  footHold: number;
  /** 倒车以前在干什么、倒车时方向打多少。 */
  backFrom: 'drive' | 'uturn'; backSteer: number;
  hl: number; hw: number; top: number;
}

const LANE = 1.6;
const SITE_R = 260, SITE_OUT = 320;
const SPAWN_MIN = 70, SPAWN_MAX = 250, DESPAWN = 330;
const parkedInput: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
const UP = new THREE.Vector3(0, 1, 0);

export function installGround(engine: Engine): void {
  const qs = new URLSearchParams(location.search);
  if (qs.get('airport') === '0' || qs.get('ground') === '0') return;
  const ap = engine.get<AirportApi>('airport');
  const traffic = engine.get<TrafficApi>('traffic');
  if (!ap || !traffic) return;
  const { R, world } = engine.physics;
  const tier = engine.quality.tier;
  const rng = new Rng(9137);
  const capCars = () => (engine.lite ? 2 : tier === 'low' ? 4 : tier === 'medium' ? 6 : 8);
  const capSites = () => (engine.lite ? 3 : 6);
  const stats = { spawned: 0, despawned: 0, uturns: 0, backups: 0, jumps: 0, lastJump: 0 };

  let net: ServiceNet | null = null, st: Stand[] = [], bridgeDoors: { x: number; z: number }[] = [];
  let taxiGrid: SegGrid | null = null;
  const taxiSegs: number[] = [];   // [ax, az, bx, bz, halfWidth] × n
  const bridgeSegs: number[] = [];

  // 画：两套自己的车模（涂装不同），空着不画
  const guideKit = new CarKit(engine.scene, 12, GUIDE_LIVERY, 'sedan');
  let busKit: CarKit | null = null;
  const makeBusKit = () => { busKit ??= new CarKit(engine.scene, 6, SHUTTLE_LIVERY, 'bus'); };
  if (bodySettled('bus')) makeBusKit(); else void readyBodies(['bus']).then(makeBusKit);

  // 道具：四张实例网格
  const group = new THREE.Group();
  group.name = 'airport-ground';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  mat.userData.wet = true;
  const mesh = (geo: THREE.BufferGeometry, cap: number, name: string) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.name = name; m.count = 0; m.visible = false; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    return m;
  };
  let stairMesh: THREE.InstancedMesh | null = null, tugMesh: THREE.InstancedMesh | null = null, cartMesh: THREE.InstancedMesh | null = null, coneMesh: THREE.InstancedMesh | null = null;
  const buildMeshes = () => {
    stairMesh = mesh(stairTruckGeometry(), 8, 'airport-stairs');
    tugMesh = mesh(tugGeometry(), 8, 'airport-tugs');
    cartMesh = mesh(cartGeometry(), 16, 'airport-carts');
    coneMesh = mesh(coneGeometry(), 48, 'airport-cones');
    coneMesh.castShadow = false;
    (engine.get('render') as unknown as { prepare?(o: THREE.Object3D): void } | undefined)?.prepare?.(group);
    engine.scene.add(group);
  };

  const cars: GCar[] = [];
  const spares = new Map<Kind, Vehicle[]>();
  /** 我们造的车（玩家开走了也记着：扔下的时候认得出来）。 */
  const owned = new WeakMap<Vehicle, Kind>();
  let nextId = 1;

  const playerPos = () => engine.get<PlayerApi>('player')?.position ?? engine.camera.position;
  const hourNow = () => engine.get<RenderApi>('render')?.timeOfDay ?? 12;
  const camDir = new THREE.Vector3();
  const inView = (x: number, z: number) => {
    const c = engine.camera.position, d = Math.hypot(x - c.x, z - c.z);
    return d < 8 || ((x - c.x) * camDir.x + (z - c.z) * camDir.z) / d > 0.35;
  };

  // ---- 建图、索引（airfield.json 到了以后一次） ----
  const build = (d: AirfieldData) => {
    net = new ServiceNet(d);
    st = stands(d);
    bridgeDoors = bridgeEnds(d);
    const segs: number[] = [];
    for (const tw of [...d.taxiways, ...d.runways]) for (let i = 2; i < tw.p.length; i += 2) segs.push(tw.p[i - 2], tw.p[i - 1], tw.p[i], tw.p[i + 1], tw.w / 2);
    taxiSegs.push(...segs);
    taxiGrid = new SegGrid(segs.length / 5);
    for (let k = 0; k < segs.length / 5; k++) taxiGrid.add(k, segs[k * 5], segs[k * 5 + 1], segs[k * 5 + 2], segs[k * 5 + 3]);
    for (const b of d.bridges) for (let i = 2; i < b.p.length; i += 2) bridgeSegs.push(b.p[i - 2], b.p[i - 1], b.p[i], b.p[i + 1]);
    buildMeshes();
  };
  /** 离最近的滑行道 / 跑道的边多远（负的是在上面）。 */
  const taxiGap = (x: number, z: number, r = 60) => {
    let best = Infinity;
    taxiGrid?.query(x, z, r, (k) => {
      const o = k * 5, q = segDist(x, z, taxiSegs[o], taxiSegs[o + 1], taxiSegs[o + 2], taxiSegs[o + 3]);
      best = Math.min(best, q.d - taxiSegs[o + 4]);
    });
    return best;
  };
  const bridgeGap = (x: number, z: number) => {
    let best = Infinity;
    for (let o = 0; o < bridgeSegs.length; o += 4) {
      if (Math.abs(bridgeSegs[o] - x) > 120 || Math.abs(bridgeSegs[o + 1] - z) > 120) continue;
      best = Math.min(best, segDist(x, z, bridgeSegs[o], bridgeSegs[o + 1], bridgeSegs[o + 2], bridgeSegs[o + 3]).d);
    }
    return best;
  };
  const poolSet = () => ap?.poolStands ?? null;

  // ---- 会动的勤务车 ----
  const vehicleFor = (kind: Kind): Vehicle => {
    const body = kind === 'bus' ? 'bus' : 'sedan';
    const car = spares.get(kind)?.pop() ?? new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -300, z: 0 }, 0);
    car.body.setEnabled(true);
    owned.set(car, kind);
    return car;
  };
  const putAway = (g: GCar) => {
    const i = cars.indexOf(g);
    if (i >= 0) cars.splice(i, 1);
    for (const o of cars) if (o.blockedBy === g) o.blockedBy = null;
    g.car.body.setTranslation({ x: 0, y: -300, z: 0 }, false);
    g.car.body.setEnabled(false);
    (spares.get(g.kind) ?? spares.set(g.kind, []).get(g.kind)!).push(g.car);
    stats.despawned++;
  };
  const makeG = (kind: Kind, car: Vehicle): GCar => {
    const spec = car.spec, hl = specLength(spec) / 2;
    const hw = Math.max(...spec.chassis.map((c) => Math.abs(c.at[0]) + c.half[0]));
    const top = Math.max(...spec.chassis.map((c) => c.at[1] + c.half[1])) + spec.wheelRadius;
    return { id: nextId++, kind, car, filter: new ControlFilter(),
      prevPos: car.pos.clone(), curPos: car.pos.clone(), prevQuat: car.quat.clone(), curQuat: car.quat.clone(),
      upper: new THREE.Color(kind === 'bus' ? SHUTTLE_LIVERY.upper : GUIDE_LIVERY.upper), lower: new THREE.Color(kind === 'bus' ? SHUTTLE_LIVERY.lower : GUIDE_LIVERY.lower),
      mode: 'drive', modeT: 0, e: -1, d: 1, s: 0, queue: [], vmax: kind === 'bus' ? 6.5 + rng.next() * 1.5 : 8 + rng.next() * 2.5,
      obst: Infinity, obstKind: '', senseT: rng.next() * 0.1, blockedBy: null, stuck: 0, backs: 0, footHold: 0, backFrom: 'drive', backSteer: 0, hl, hw, top };
  };

  const pt = { x: 0, z: 0, dx: 0, dz: 1 };
  /** 这条边在 d 方向上的终点那头的走向（离开节点时的方向用 `startDir`）。 */
  const endDir = (e: number, d: 1 | -1) => {
    const E = net!.edges[e];
    net!.at(E.road, d > 0 ? E.s1 - 0.5 : E.s0 + 0.5, pt);
    return [pt.dx * d, pt.dz * d] as const;
  };
  const startDir = (e: number, d: 1 | -1) => {
    const E = net!.edges[e];
    net!.at(E.road, d > 0 ? E.s0 + 0.5 : E.s1 - 0.5, pt);
    return [pt.dx * d, pt.dz * d] as const;
  };
  /** 到了这条边的头，接着走哪条：不走回头路，大拐弯少挑；死胡同就是掉头（同一条边反过来）。 */
  const chooseNext = (e: number, d: 1 | -1): Step => {
    const N = net!, E = N.edges[e], node = N.nodes[d > 0 ? E.b : E.a];
    const [ix, iz] = endDir(e, d);
    const opts: { s: Step; w: number }[] = [];
    for (const o of node.out) {
      if (o.e === e && o.dir === -d) continue;
      const [ox, oz] = startDir(o.e, o.dir), c = ix * ox + iz * oz;
      if (c < -0.55) continue;   // 拐 120° 以上的不走
      opts.push({ s: { e: o.e, d: o.dir }, w: c > 0.6 ? 3 : c > -0.1 ? 1.5 : 0.4 });
    }
    if (!opts.length) return { e, d: -d as 1 | -1 };
    let r = rng.next() * opts.reduce((a, o) => a + o.w, 0);
    for (const o of opts) { r -= o.w; if (r <= 0) return o.s; }
    return opts[opts.length - 1].s;
  };
  const isUturn = (from: Step, to: Step) => from.e === to.e && from.d !== to.d;
  /** 往后挑够三段；队尾是掉头就先不挑（掉过头再说）。 */
  const fillQueue = (g: GCar) => {
    const q = g.queue;
    let prev: Step = q.length ? q[q.length - 1] : { e: g.e, d: g.d };
    if (q.length && isUturn(q.length > 1 ? q[q.length - 2] : { e: g.e, d: g.d }, prev)) return;
    while (q.length < 3) {
      const nx = chooseNext(prev.e, prev.d);
      q.push(nx);
      if (isUturn(prev, nx)) break;
      prev = nx;
    }
  };
  /**
   * 从车现在的位置沿路往前 `dist` 米的点（往行车方向右边偏 `LANE`）：先走完这条边，再按队列走下一条；队列里是掉头的，
   * 就停在这条边的尽头（掉头另外做）。返回实际走了多远。
   */
  const ahead = (g: GCar, dist: number, out: { x: number; z: number; dx: number; dz: number }): number => {
    const N = net!;
    let e = g.e, d = g.d, s = g.s, rem = dist, done = 0, qi = 0;
    for (let guard = 0; guard < 6; guard++) {
      const E = N.edges[e], room = d > 0 ? E.s1 - s : s - E.s0;
      if (rem <= room) { s += d * rem; done += rem; break; }
      rem -= room; done += room; s = d > 0 ? E.s1 : E.s0;
      const nx = g.queue[qi];
      if (!nx || isUturn({ e, d }, nx)) break;
      qi++; e = nx.e; d = nx.d;
      const E2 = N.edges[e];
      s = d > 0 ? E2.s0 : E2.s1;
    }
    N.at(N.edges[e].road, s, out);
    out.dx *= d; out.dz *= d;
    // 右手边：朝 (dx, dz) 时右边是 (-dz, dx)
    out.x += -out.dz * LANE; out.z += out.dx * LANE;
    return done;
  };
  /** 车到队列里第一个掉头处还有多远（没有就 Infinity）。 */
  const toUturn = (g: GCar): number => {
    const N = net!;
    let e = g.e, d = g.d, acc = 0;
    let E = N.edges[e];
    acc += d > 0 ? E.s1 - g.s : g.s - E.s0;
    for (const nx of g.queue) {
      if (isUturn({ e, d }, nx)) return acc;
      e = nx.e; d = nx.d; E = N.edges[e];
      acc += E.s1 - E.s0;
      if (acc > 80) break;
    }
    return Infinity;
  };

  const spawnOne = (p: THREE.Vector3): boolean => {
    const N = net!;
    const planes = groundPlaneRects();
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = rng.next() * Math.PI * 2, r = SPAWN_MIN + rng.next() * (SPAWN_MAX - SPAWN_MIN);
      const near = N.nearest(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 60);
      if (!near) continue;
      const e = N.edgeAt(near.road, near.s);
      if (e < 0) continue;
      const d: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
      N.at(near.road, near.s, pt);
      const hx = pt.dx * d, hz = pt.dz * d;
      const x = pt.x - hz * LANE, z = pt.z + hx * LANE;
      const dp = Math.hypot(x - p.x, z - p.z);
      if (dp < SPAWN_MIN - 10 || dp > SPAWN_MAX + 30) continue;
      // 镜头里只在远处出现（近处凭空冒出来看得见）
      if (inView(x, z) && Math.hypot(x - engine.camera.position.x, z - engine.camera.position.z) < 170) continue;
      if (!ap.airside(x, z)) continue;
      if (cars.some((o) => Math.hypot(o.car.pos.x - x, o.car.pos.z - z) < 30)) continue;
      if (planes.some((rc) => inRect(rc, x, z, 12))) continue;
      const kind: Kind = busKit && rng.next() < 0.35 ? 'bus' : 'guide';
      const spec = SPEC_OF[kind === 'bus' ? 'bus' : 'sedan'], hl = specLength(spec) / 2 + 0.5;
      const yaw = Math.atan2(hx, hz);
      const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      if (world.intersectionWithShape({ x, y: 1.6, z }, { x: q.x, y: q.y, z: q.z, w: q.w }, new R.Cuboid(1.5, 1.3, hl), undefined, groups(CG.CAR, CG.WORLD | CG.CAR))) continue;
      const car = vehicleFor(kind);
      car.reset({ x, y: 0.03 + spec.wheelRadius + 0.05, z }, yaw);
      const g = makeG(kind, car);
      g.e = e; g.d = d; g.s = near.s;
      fillQueue(g);
      cars.push(g);
      stats.spawned++;
      return true;
    }
    return false;
  };

  /** 地上的飞机（滑行、推出、停在 Flights 机位上的）占的地，加上 2.5 秒后的位置；停着的只算机身。 */
  const planeRectsBuf: Rect[] = [];
  const fakePlanes: GroundApi['debug']['fakePlanes'] = [];
  const groundPlaneRects = (): Rect[] => {
    planeRectsBuf.length = 0;
    for (const f of fakePlanes) { planeRects(f.x, f.z, f.yaw, f.kind, planeRectsBuf); planeRects(f.x + f.vx * 2.5, f.z + f.vz * 2.5, f.yaw, f.kind, planeRectsBuf); }
    for (const f of ap.flights) {
      if (!f.ground && f.y > 6) continue;
      if (f.parked) { const D = dims(f.kind); planeRectsBuf.push({ x: f.x, z: f.z, ux: Math.sin(f.yaw), uz: Math.cos(f.yaw), hl: D.len / 2 + 2, hw: D.r + 2 }); continue; }
      planeRects(f.x, f.z, f.yaw, f.kind, planeRectsBuf);
      const sp = Math.hypot(f.vx, f.vz);
      if (sp > 0.5) planeRects(f.x + f.vx * 2.5, f.z + f.vz * 2.5, f.yaw, f.kind, planeRectsBuf);
    }
    return planeRectsBuf;
  };

  const rayDir = new THREE.Vector3(), rayO = { x: 0, y: 0, z: 0 }, rd = { x: 0, y: 0, z: 0 };
  const tgt = { x: 0, z: 0, dx: 0, dz: 1 }, tmpP = { x: 0, z: 0, dx: 0, dz: 1 };
  const bodyOwner = new Map<number, GCar>();
  /** 前方有什么、多远（从车头量）：射线（楼、廊桥撑脚、飞机、梯车、车）、路上的飞机、徒步的玩家。 */
  const sense = (g: GCar, planes: Rect[]) => {
    const c = g.car, v = Math.max(0, c.forwardSpeed);
    const reach = Math.max(9, 4 + v * v / 5 + v);
    g.obst = Infinity; g.obstKind = ''; g.blockedBy = null;
    // 射线朝车头和要去的点之间
    ahead(g, 8, tgt);
    let tx = tgt.x - c.pos.x, tz = tgt.z - c.pos.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const back = g.mode === 'back';
    if (back) rayDir.set(-c.fwd.x, 0, -c.fwd.z);
    else if (g.mode === 'drive') rayDir.set(c.fwd.x * 0.6 + tx * 0.4, 0, c.fwd.z * 0.6 + tz * 0.4);
    else rayDir.set(c.fwd.x, 0, c.fwd.z);
    rayDir.normalize();
    const lx = -rayDir.z, lz = rayDir.x;   // 射线方向的左手
    const y0 = c.pos.y - c.spec.wheelRadius;
    for (const h of [0.55, g.top - 0.25]) for (const off of [0, g.hw - 0.12, -(g.hw - 0.12)]) {
      rayO.x = c.pos.x + rayDir.x * (g.hl + 0.15) + lx * off; rayO.y = y0 + h; rayO.z = c.pos.z + rayDir.z * (g.hl + 0.15) + lz * off;
      rd.x = rayDir.x; rd.y = 0; rd.z = rayDir.z;
      const hit = engine.physics.raycast(rayO, rd, reach, groups(CG.CAR, CG.WORLD | CG.CAR), true, c.body);
      if (!hit || hit.normal[1] > 0.75 || hit.distance >= g.obst) continue;
      g.obst = hit.distance;
      const body = hit.collider.parent();
      const other = body ? bodyOwner.get(body.handle) : undefined;
      g.blockedBy = other ?? null;
      g.obstKind = hit.userData.tag === 'plane' ? 'plane' : other ? 'car' : body && body.isFixed() ? 'static' : 'car';
    }
    if (back) return;
    // 路上的飞机：沿要走的路每 5 米取一点，落在飞机占地里就停在那之前
    if (planes.length) {
      for (let s = 5; s <= 60; s += 5) {
        const got = ahead(g, s, tmpP);
        if (got + 0.01 < s && s > 5) break;
        if (planes.some((rc) => inRect(rc, tmpP.x, tmpP.z, 1.2 + g.hw))) { const dd = Math.max(0, s - g.hl - 2); if (dd < g.obst) { g.obst = dd; g.obstKind = 'plane'; g.blockedBy = null; } break; }
      }
    }
    // 徒步的玩家站在前面
    const pl = engine.get<PlayerApi>('player');
    if (pl?.mode === 'onfoot' && pl.foot && !pl.riding) {
      const rx = pl.foot.pos.x - c.pos.x, rz = pl.foot.pos.z - c.pos.z, along = rx * c.fwd.x + rz * c.fwd.z, lat = Math.abs(rx * c.left.x + rz * c.left.z);
      if (along > 0 && along < reach + g.hl && lat < g.hw + 1.2 && along - g.hl < g.obst) { g.obst = Math.max(0, along - g.hl); g.obstKind = 'foot'; g.blockedBy = null; }
      // 人挡在车头前、或者站在车门边上（停着的时候）：等人走开再多等一会儿（好让玩家拉开车门）
      if ((g.obstKind === 'foot' && g.obst < 8) || (Math.abs(along) < g.hl + 0.5 && lat < g.hw + 1.6 && v < 2)) g.footHold = 2;
    }
    // 两辆互相挡着（路口对上了）：编号小的先走
    const o = g.blockedBy;
    if (o && o.blockedBy === g && g.id < o.id) { g.obst = Infinity; g.obstKind = ''; }
  };

  const drive = (g: GCar, dt: number, planes: Rect[]): DriveInput => {
    const N = net!, c = g.car, v = Math.max(0, c.forwardSpeed), inp = driveOut;
    g.senseT -= dt;
    if (g.senseT <= 0) { g.senseT = 0.066; sense(g, planes); }
    // 走到哪了
    if (g.mode === 'drive') {
      const E = N.edges[g.e];
      g.s = N.project(E.road, c.pos.x, c.pos.z, Math.max(E.s0, g.s - 15), Math.min(E.s1, g.s + 25));
      const left = g.d > 0 ? E.s1 - g.s : g.s - E.s0;
      if (left < 2.5 && g.queue.length) {
        const nx = g.queue[0];
        if (isUturn({ e: g.e, d: g.d }, nx)) { g.mode = 'uturn'; g.modeT = 0; stats.uturns++; }
        else {
          g.queue.shift(); g.e = nx.e; g.d = nx.d;
          const E2 = N.edges[g.e];
          g.s = g.d > 0 ? E2.s0 : E2.s1;
          fillQueue(g);
        }
      }
    }
    g.modeT += dt;
    inp.handbrake = false;
    if (g.mode === 'back') {
      // 倒一把：反着打方向，1.6 秒
      inp.forward = 0; inp.back = g.obst < 1.2 ? 0 : 0.55; inp.steer = g.backSteer;
      if (g.modeT > 1.6) { g.mode = g.backFrom; g.modeT = 0; g.stuck = 0; }
      return inp;
    }
    let vt = g.vmax, steer = 0;
    if (g.mode === 'uturn') {
      // 往左打死掉头，回到原来那条边上反过来走
      const E = N.edges[g.e];
      N.at(E.road, g.s, pt);
      const nx = -pt.dx * g.d, nz = -pt.dz * g.d;
      steer = -1; vt = 3;
      if (c.fwd.x * nx + c.fwd.z * nz > 0.8 || g.modeT > 14) {
        g.d = -g.d as 1 | -1; g.queue.length = 0;
        g.s = N.project(E.road, c.pos.x, c.pos.z, E.s0, E.s1);
        fillQueue(g); g.mode = 'drive'; g.modeT = 0;
      }
    } else {
      const look = Math.max(6, Math.min(16, 4 + v * 0.9)) + (g.kind === 'bus' ? 3 : 0);
      ahead(g, look, tgt);
      const dx = tgt.x - c.pos.x, dz = tgt.z - c.pos.z;
      const lx = dx * c.left.x + dz * c.left.z, lz = dx * c.fwd.x + dz * c.fwd.z;
      const kappa = 2 * lx / Math.max(1, lx * lx + lz * lz);
      steer = Math.max(-1, Math.min(1, -Math.atan(kappa * c.wheelbase) / Math.max(0.05, c.maxSteerAngle(v))));
      // 拐弯前减速
      ahead(g, Math.max(6, v * 1.2), tmpP);
      const h0x = tmpP.dx, h0z = tmpP.dz;
      ahead(g, Math.max(6, v * 1.2) + 20, tmpP);
      const turn = Math.acos(Math.max(-1, Math.min(1, h0x * tmpP.dx + h0z * tmpP.dz)));
      if (turn > 0.15) vt = Math.min(vt, Math.max(2.5, Math.sqrt(2.2 * 20 / turn)));
      const tu = toUturn(g);
      if (tu < 60) vt = Math.min(vt, 3 + Math.sqrt(2 * 1.6 * Math.max(0, tu - 2)));
    }
    // 前面有东西：停在它前面 3 米
    if (g.obst < Infinity) vt = Math.min(vt, Math.sqrt(2 * 3 * Math.max(0, g.obst - 3)));
    if (g.footHold > 0) { g.footHold -= dt; vt = 0; }
    let a = 1.6 * (1 - Math.pow(v / Math.max(0.5, vt), 4));
    if (vt < 0.3) a = -4;
    if (a >= 0) { inp.forward = Math.min(1, 0.12 + a / 2.2); inp.back = 0; }
    else if (v > 0.6) { inp.forward = 0; inp.back = Math.min(1, -a / 7); }
    else { inp.forward = 0; inp.back = 0; }
    inp.steer = steer;
    // 卡住了（撞在楼上、梯车上、掉头掉不过去）：倒一把；挡着的是飞机、玩家、别的车就等着
    const blockedStatic = g.obst < 4 && (g.obstKind === 'static');
    const wantGo = g.mode === 'uturn' || vt > 1.5;
    g.stuck = (v < 0.3 && (wantGo || blockedStatic)) ? g.stuck + dt : 0;
    if (g.stuck > (blockedStatic || g.mode === 'uturn' ? 2.5 : 30) && g.obstKind !== 'plane' && g.obstKind !== 'foot') {
      g.backFrom = g.mode === 'uturn' ? 'uturn' : 'drive'; g.backSteer = g.mode === 'uturn' ? 1 : -steer; g.mode = 'back'; g.modeT = 0; g.stuck = 0; g.backs++; stats.backups++;
    }
    return inp;
  };
  const driveOut: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: false };

  // ---- 停着的飞机旁边的东西 ----
  interface Site {
    stand: number; x: number; z: number;
    truck: { x: number; z: number; yaw: number } | null;
    tug: { x: number; z: number; yaw: number } | null;
    body: RAPIER_NS.RigidBody | null;
    cones: RAPIER_NS.RigidBody[];
  }
  const sites = new Map<number, Site>();
  let sitesDirty = false;
  const isRemote = (s: Stand) => !bridgeDoors.some((b) => Math.hypot(b.x - s.sx, b.z - s.sz) < 40);
  /** 附近机位的飞机占地（Flights 的机位不管有没有飞机都算上）。 */
  const standRects = (x: number, z: number, hour: number, r: number): Rect[] => {
    const out: Rect[] = [];
    const pool = poolSet();
    st.forEach((s, i) => {
      if (Math.abs(s.x - x) > r || Math.abs(s.z - z) > r) return;
      if (pool?.has(i) || occupied(i, hour)) planeRects(s.x, s.z, s.yaw, s.kind, out);
    });
    return out;
  };
  const along = (x: number, z: number, yaw: number, lz: number, lx = 0): [number, number] => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [x + lx * c + lz * s, z - lx * s + lz * c];
  };
  /** 一片地（中心、朝向、半长、半宽）上取样，全部满足 ok。 */
  const areaOk = (x: number, z: number, yaw: number, z0: number, z1: number, hw: number, step: number, ok: (px: number, pz: number) => boolean) => {
    for (let lz = z0; lz <= z1 + 1e-6; lz += step) for (const lx of hw > 0 ? [-hw, 0, hw] : [0]) {
      const [px, pz] = along(x, z, yaw, lz, lx);
      if (!ok(px, pz)) return false;
    }
    return true;
  };
  const groundOk = (px: number, pz: number) => ap.airside(px, pz) && !ap.runwayAt(px, pz, 30);
  const rayClear = (x: number, z: number, yaw: number, lz0: number, lz1: number, h: number) => {
    const [ax, az] = along(x, z, yaw, lz0), dx = Math.sin(yaw), dz = Math.cos(yaw);
    for (const lx of [-1.2, 1.2]) {
      const c = Math.cos(yaw);
      const hit = engine.physics.raycast({ x: ax + lx * c, y: h, z: az - lx * Math.sin(yaw) }, { x: dx, y: 0, z: dz }, lz1 - lz0, groups(CG.CAR, CG.WORLD));
      if (hit) return false;
    }
    return true;
  };
  const footprintClear = (x: number, z: number, yaw: number, lzc: number, hl: number, hw: number) => {
    const [cx, cz] = along(x, z, yaw, lzc);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    return !world.intersectionWithShape({ x: cx, y: 1.3, z: cz }, { x: q.x, y: q.y, z: q.z, w: q.w }, new R.Cuboid(hw, 1.1, hl), R.QueryFilterFlags.EXCLUDE_DYNAMIC, groups(CG.PROP, CG.WORLD));
  };
  const awayFromOthers = (x: number, z: number, self: number) => {
    for (const o of sites.values()) {
      if (o.stand === self) continue;
      if (o.truck && Math.hypot(o.truck.x - x, o.truck.z - z) < 16) return false;
      if (o.tug && Math.hypot(o.tug.x - x, o.tug.z - z) < 12) return false;
    }
    return true;
  };

  /** 梯车放哪：飞机旁边一圈候选位置、两个朝向，挑第一个前后都空的。 */
  const placeTruck = (i: number, s: Stand, rects: Rect[]): Site['truck'] => {
    const D = dims(s.kind), cands: [number, number, number][] = [];
    for (const side of [1, -1]) for (const lat of [D.r + 6, D.r + 10]) for (const lz of [D.len * 0.3, D.len * 0.15, -D.len * 0.3]) for (const turn of [0, Math.PI]) cands.push([side * lat, lz, turn]);
    for (const side of [1, -1]) for (const turn of [Math.PI / 2, -Math.PI / 2]) cands.push([side * 7, D.len / 2 + 16, turn]);
    // 按机位号打乱（每次来都是同一个）
    const order = cands.map((c, k) => ({ c, r: hash2(i * 31 + k, 77) })).sort((a, b) => a.r - b.r).map((o) => o.c);
    for (const [lx, lz, turn] of order) {
      const [x, z] = along(s.x, s.z, s.yaw, lz, lx), yaw = s.yaw + turn;
      if (!awayFromOthers(x, z, i)) continue;
      const net0 = net!;
      // 车身：不压飞机、勤务道（车道 + 车宽）、滑行道、廊桥
      const bodyOk = areaOk(x, z, yaw, STAIR.zA - 0.5, STAIR.zB + 0.5, STAIR.W / 2 + 0.2, 1.5, (px, pz) =>
        groundOk(px, pz) && !rects.some((r) => inRect(r, px, pz, 1.5)) && !net0.nearest(px, pz, 4.6) && taxiGap(px, pz) > 14 && bridgeGap(px, pz) > 5);
      if (!bodyOk) continue;
      // 助跑 25 米、落地 45 米
      if (!areaOk(x, z, yaw, STAIR.zA - 25, STAIR.zA - 1, 1.5, 3, (px, pz) => groundOk(px, pz) && !rects.some((r) => inRect(r, px, pz, 1)) && taxiGap(px, pz) > 2)) continue;
      if (!areaOk(x, z, yaw, STAIR.zB + 2, STAIR.zB + 45, 2, 3, (px, pz) => groundOk(px, pz) && !rects.some((r) => inRect(r, px, pz, 2)) && bridgeGap(px, pz) > 4 && taxiGap(px, pz) > 2)) continue;
      if (!footprintClear(x, z, yaw, (STAIR.zA + STAIR.zB) / 2, (STAIR.zB - STAIR.zA) / 2 + 0.3, STAIR.W / 2 + 0.2)) continue;
      if (!rayClear(x, z, yaw, STAIR.zA - 25, STAIR.zA - 0.5, 1.0) || !rayClear(x, z, yaw, STAIR.zB + 0.5, STAIR.zB + 45, 1.6) || !rayClear(x, z, yaw, STAIR.zB + 0.5, STAIR.zB + 40, 4.2)) continue;
      return { x, z, yaw };
    }
    return null;
  };
  /** 牵引车加两节拖斗（全长约 10 米）放在飞机右边后半截。 */
  const placeTug = (i: number, s: Stand, rects: Rect[]): Site['tug'] => {
    const D = dims(s.kind);
    for (const [lx, lz, turn] of [[-(D.r + 5), -D.len * 0.22, 0], [-(D.r + 5), D.len * 0.32, Math.PI], [D.r + 5, -D.len * 0.22, 0], [-(D.r + 8), -D.len * 0.05, 0]] as const) {
      const [x, z] = along(s.x, s.z, s.yaw, lz, lx), yaw = s.yaw + turn;
      if (!awayFromOthers(x, z, i)) continue;
      const ok = areaOk(x, z, yaw, -8.4, 1.5, 0.9, 1.5, (px, pz) => groundOk(px, pz) && !rects.some((r) => inRect(r, px, pz, 1)) && !net!.nearest(px, pz, 4.2) && taxiGap(px, pz) > 10 && bridgeGap(px, pz) > 4);
      if (!ok || !footprintClear(x, z, yaw, -3.5, 5.2, 0.9)) continue;
      return { x, z, yaw };
    }
    return null;
  };

  const makeSite = (i: number, hour: number): Site => {
    const s = st[i];
    const site: Site = { stand: i, x: s.x, z: s.z, truck: null, tug: null, body: null, cones: [] };
    const rects = standRects(s.x, s.z, hour, 160);
    const remote = isRemote(s) && !poolSet()?.has(i);
    if (remote && hash2(i, 501) < 0.75) site.truck = placeTruck(i, s, rects);
    if (remote && hash2(i, 502) < 0.55) site.tug = placeTug(i, s, rects);
    const body = (site.truck || site.tug) ? world.createRigidBody(R.RigidBodyDesc.fixed()) : null;
    site.body = body;
    if (site.truck && body) {
      // 楔形：后面贴地、前面 H 高，跟特技坡道一样的凸包（人车都挡、都能上）
      const { x, z, yaw } = site.truck, c = Math.cos(yaw), sn = Math.sin(yaw), pts: number[] = [];
      const put = (lx: number, y: number, lz: number) => pts.push(x + lx * c + lz * sn, y + 0.03, z - lx * sn + lz * c);
      for (const lx of [-STAIR.W / 2, STAIR.W / 2]) { put(lx, 0, STAIR.zA); put(lx, STAIR.H, STAIR.zB); put(lx, 0, STAIR.zB); }
      const desc = R.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) engine.physics.tag(world.createCollider(desc.setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.9), body), { surface: 'metal', tag: 'ramp' });
    }
    if (site.tug && body) {
      const { x, z, yaw } = site.tug, q = new THREE.Quaternion().setFromAxisAngle(UP, yaw), rot = { x: q.x, y: q.y, z: q.z, w: q.w };
      for (const [lz, hl, hw, hy] of [[0, 1.4, 0.76, 0.55], [-3.3, 1.33, 0.78, 0.65], [-6.6, 1.33, 0.78, 0.65]] as const) {
        const [cx, cz] = along(x, z, yaw, lz);
        engine.physics.tag(world.createCollider(R.ColliderDesc.cuboid(hw, hy, hl).setTranslation(cx, hy + 0.25, cz).setRotation(rot).setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.6), body), { surface: 'metal', tag: 'airport-tug' });
      }
    }
    // 锥桶：两个翼尖外、机头前、机尾后（能撞飞）
    if (hash2(i, 503) < 0.8 && coneMesh) {
      const D = dims(s.kind);
      for (const [lx, lz] of [[D.span / 2 + 1.2, D.wingZ - D.span * 0.18], [-(D.span / 2 + 1.2), D.wingZ - D.span * 0.18], [0, D.len / 2 + 2.5], [0, -D.len / 2 - 2]]) {
        const [x, z] = along(s.x, s.z, s.yaw, lz, lx);
        if (!groundOk(x, z) || net!.nearest(x, z, 3.6) || taxiGap(x, z, 40) < 3) continue;
        if (site.truck && Math.hypot(site.truck.x - x, site.truck.z - z) < 9) continue;
        const cb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0.002, z).setLinearDamping(0.3).setAngularDamping(0.6).setCanSleep(true));
        for (const cd of [R.ColliderDesc.cone(0.35, 0.16).setTranslation(0, 0.38, 0), R.ColliderDesc.cuboid(0.19, 0.02, 0.19).setTranslation(0, 0.02, 0)]) {
          cd.setDensity(0).setFriction(0.7).setRestitution(0.15).setCollisionGroups(groups(CG.PROP, CG.WORLD | CG.CAR | CG.PROP));
          engine.physics.tag(world.createCollider(cd, cb), { surface: 'rubber', tag: 'prop' });
        }
        cb.setAdditionalMassProperties(3.2, { x: 0, y: 0.2, z: 0 }, { x: 0.2, y: 0.16, z: 0.2 }, { x: 0, y: 0, z: 0, w: 1 }, true);
        cb.sleep();
        site.cones.push(cb);
      }
    }
    return site;
  };
  const dropBody = (b: RAPIER_NS.RigidBody) => { for (let k = 0; k < b.numColliders(); k++) engine.physics.untag(b.collider(k)); world.removeRigidBody(b); };
  const dropSite = (s: Site) => {
    if (s.body) dropBody(s.body);
    for (const c of s.cones) dropBody(c);
    sites.delete(s.stand);
    sitesDirty = true;
  };

  let siteT = 0, siteHour = -1;
  const updateSites = () => {
    const p = playerPos(), hour = hourNow(), h = Math.floor(hour);
    const pool = poolSet();
    // 钟点变了，飞机走了的机位上的东西收掉
    for (const s of [...sites.values()]) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > SITE_OUT || !occupied(s.stand, hour) || pool?.has(s.stand)) dropSite(s);
    }
    siteHour = h;
    if (Math.hypot(p.x - 16760, p.z + 19090) > 6000 || (!ap.airside(p.x, p.z) && !net?.nearest(p.x, p.z, 400))) return;
    const cand: [number, number][] = [];
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (Math.abs(s.x - p.x) > SITE_R || Math.abs(s.z - p.z) > SITE_R) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < SITE_R && occupied(i, hour) && !pool?.has(i)) cand.push([d, i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const want = cand.slice(0, capSites()).map(([, i]) => i);
    // 不在前几个里的、比最远那个还远的收掉
    for (const s of [...sites.values()]) if (!want.includes(s.stand) && sites.size > capSites()) dropSite(s);
    // 一次只摆一个（射线和取样不少）
    for (const i of want) if (!sites.has(i)) { sites.set(i, makeSite(i, hour)); sitesDirty = true; break; }
  };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const writeSites = () => {
    if (!stairMesh || !tugMesh || !cartMesh) return;
    let ns = 0, nt = 0, nc = 0;
    for (const s of sites.values()) {
      if (s.truck && ns < stairMesh.instanceMatrix.count) { stairMesh.setMatrixAt(ns++, m4.compose(p4.set(s.truck.x, 0.03, s.truck.z), q4.setFromAxisAngle(UP, s.truck.yaw), one)); }
      if (s.tug && nt < tugMesh.instanceMatrix.count) {
        const { x, z, yaw } = s.tug;
        q4.setFromAxisAngle(UP, yaw);
        tugMesh.setMatrixAt(nt++, m4.compose(p4.set(x, 0.03, z), q4, one));
        for (const lz of [-3.3, -6.6]) { const [cx, cz] = along(x, z, yaw, lz); if (nc < cartMesh.instanceMatrix.count) cartMesh.setMatrixAt(nc++, m4.compose(p4.set(cx, 0.03, cz), q4, one)); }
      }
    }
    for (const [m, n] of [[stairMesh, ns], [tugMesh, nt], [cartMesh, nc]] as const) { m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; }
  };
  const writeCones = (force: boolean) => {
    if (!coneMesh) return;
    // 都睡着（没人碰）就不重写
    let awake = force;
    for (const s of sites.values()) for (const b of s.cones) if (!b.isSleeping()) { awake = true; break; }
    if (!awake) return;
    let n = 0;
    for (const s of sites.values()) for (const b of s.cones) {
      if (n >= coneMesh.instanceMatrix.count) break;
      const tr = b.translation(), r = b.rotation();
      coneMesh.setMatrixAt(n++, m4.compose(p4.set(tr.x, tr.y, tr.z), q4.set(r.x, r.y, r.z, r.w), one));
    }
    coneMesh.count = n; coneMesh.visible = n > 0; coneMesh.instanceMatrix.needsUpdate = true;
  };

  // ---- 从梯子上飞出去 ----
  let clock = 0, onRamp: Site | null = null, onRampT = -9, flight: { x: number; z: number; site: Site } | null = null;
  const jumpCheck = () => {
    const pl = engine.get<PlayerApi>('player'), v = engine.get<VehicleApi>('vehicle');
    if (!pl || !v || pl.mode !== 'driving' || !v.occupied) { flight = null; return; }
    const car = v.car;
    if (flight) {
      if (car.grounded >= 2 || car.pos.y < -2) {
        const dist = Math.hypot(car.pos.x - flight.x, car.pos.z - flight.z), site = flight.site;
        flight = null;
        if (dist >= 8) {
          stats.jumps++; stats.lastJump = dist;
          engine.get<HudApi>('hud')?.toast(t('airport.stairJump', { m: Math.round(dist) }));
          engine.events.emit('stunt:jump', { ramp: 3000 + site.stand, x: site.truck!.x, z: site.truck!.z, dist, over: false });
        }
      }
      return;
    }
    for (const s of sites.values()) {
      const tr = s.truck;
      if (!tr || Math.abs(car.pos.x - tr.x) > 20 || Math.abs(car.pos.z - tr.z) > 20) continue;
      const dx = car.pos.x - tr.x, dz = car.pos.z - tr.z, sn = Math.sin(tr.yaw), c = Math.cos(tr.yaw);
      const al = dx * sn + dz * c, ac = dx * c - dz * sn;
      if (al > STAIR.zA && al < STAIR.zB + 1.5 && Math.abs(ac) < STAIR.W / 2 + 0.6 && car.pos.y > 0.9 && car.vel.x * sn + car.vel.z * c > 6) { onRamp = s; onRampT = clock; }
    }
    if (onRamp && car.grounded === 0 && clock - onRampT < 0.35) {
      const tr = onRamp.truck!;
      flight = { x: tr.x + Math.sin(tr.yaw) * STAIR.zB, z: tr.z + Math.cos(tr.yaw) * STAIR.zB, site: onRamp };
      onRamp = null;
    }
  };

  // ---- 交给 traffic：能抢、扔下的认得、路上的车知道躲 ----
  const listBuf: Vehicle[] = [], blockBuf: Vehicle[] = [];
  const look = (g: GCar): CarLook => ({ upper: g.upper.clone(), lower: g.lower.clone(), taxi: false, parked: true, body: g.kind === 'bus' ? 'bus' : 'sedan', livery: g.kind === 'bus' ? SHUTTLE_LIVERY : GUIDE_LIVERY });
  const provider: ExternalCars = {
    cars: () => { listBuf.length = 0; for (const g of cars) listBuf.push(g.car); return listBuf; },
    canTake: () => true,
    take(car) {
      const g = cars.find((o) => o.car === car);
      if (!g) return null;
      cars.splice(cars.indexOf(g), 1);
      for (const o of cars) if (o.blockedBy === g) o.blockedBy = null;
      bodyOwner.delete(g.car.body.handle);
      return look(g);
    },
    park(car) {
      const kind = owned.get(car);
      if (!kind) return false;
      const g = makeG(kind, car);
      g.mode = 'parked';
      cars.push(g);
      return true;
    },
    blocking: () => { blockBuf.length = 0; for (const g of cars) if (g.mode !== 'parked') blockBuf.push(g.car); return blockBuf; },
  };
  traffic.addExternalCars(provider);

  let spawnT = 0, planeT = 0, built = false, nearAir = false;
  const renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion();
  const api: GroundApi = {
    name: 'airport-ground',
    debug: {
      cars: () => cars.map((g) => ({ id: g.id, kind: g.kind, x: g.car.pos.x, z: g.car.pos.z, y: g.car.pos.y, v: g.car.forwardSpeed, mode: g.mode, stuck: g.stuck, wait: g.obst < 30 ? `${g.obstKind}@${g.obst.toFixed(1)}` : '', car: g.car })),
      sites: () => [...sites.values()].map((s) => ({ stand: s.stand, truck: s.truck, tug: s.tug, cones: s.cones.length })),
      net: () => net,
      stats,
      fakePlanes,
      spawnAt(kind, road, s0, d) {
        if (!net || (kind === 'bus' && !busKit)) return null;
        const e = net.edgeAt(road, s0);
        net.at(road, s0, pt);
        const hx = pt.dx * d, hz = pt.dz * d, spec = SPEC_OF[kind === 'bus' ? 'bus' : 'sedan'];
        const car = vehicleFor(kind);
        car.reset({ x: pt.x - hz * LANE, y: 0.03 + spec.wheelRadius + 0.05, z: pt.z + hx * LANE }, Math.atan2(hx, hz));
        const g = makeG(kind, car);
        g.e = e; g.d = d; g.s = s0;
        fillQueue(g);
        cars.push(g);
        return car;
      },
    },
    fixedUpdate(dt) {
      clock += dt;
      if (!built) { if (ap.data) { build(ap.data); built = true; } else return; }
      const p = playerPos();
      // 生成、回收
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = 0.5;
        nearAir = Math.hypot(p.x - 16760, p.z + 19090) < 6000 && (ap.airside(p.x, p.z) || !!net!.nearest(p.x, p.z, 300));
        engine.camera.getWorldDirection(camDir);
        for (const g of [...cars]) {
          const d = Math.hypot(g.car.pos.x - p.x, g.car.pos.z - p.z), seen = inView(g.car.pos.x, g.car.pos.z);
          const gone = g.car.pos.y < -5 || (g.mode === 'parked' ? d > 420 : !nearAir || d > DESPAWN + (seen ? 120 : 0) || ((g.stuck > 25 || g.backs > 4 || g.car.up.y < 0.5) && !seen && d > 40));
          if (gone) { bodyOwner.delete(g.car.body.handle); putAway(g); }
        }
        if (nearAir && cars.filter((g) => g.mode !== 'parked').length < capCars()) spawnOne(p);
        siteT -= 0.5;
        if (siteT <= 0 || Math.floor(hourNow()) !== siteHour) { siteT = 1; updateSites(); }
      }
      // 地上飞机的占地每 0.1 秒算一次（每辆车的感知也是 0.066 秒一次）
      planeT -= dt;
      if (planeT <= 0 && cars.length) { planeT = 0.1; groundPlaneRects(); }
      const planes = planeRectsBuf;
      for (const g of cars) {
        bodyOwner.set(g.car.body.handle, g);
        g.prevPos.copy(g.curPos); g.prevQuat.copy(g.curQuat);
        const inp = g.mode === 'parked' ? parkedInput : drive(g, dt, planes);
        g.car.step(g.filter.update(inp, g.car.forwardSpeed, dt), dt);
      }
      jumpCheck();
    },
    postStep(dt) {
      for (const g of cars) {
        g.car.afterStep(dt);
        g.curPos.copy(g.car.pos); g.curQuat.copy(g.car.quat);
      }
    },
    update(_dt, alpha) {
      let ng = 0, nb = 0;
      for (const g of cars) {
        renderPos.lerpVectors(g.prevPos, g.curPos, alpha);
        renderQuat.slerpQuaternions(g.prevQuat, g.curQuat, alpha);
        if (g.kind === 'bus') { if (busKit) busKit.set(nb++, renderPos, renderQuat, g.car, g.upper, g.lower, true); }
        else guideKit.set(ng++, renderPos, renderQuat, g.car, g.upper, g.lower, true);
      }
      const night = (engine.get<RenderApi>('render')?.night ?? 0) > 0.35;
      guideKit.commit(ng); guideKit.setHeadlights(night);
      // 琥珀色灯条左右轮流闪
      const ph = clock * 2.6 % 1;
      guideKit.setBeacons(ph < 0.5 ? 6 : 0.3, ph < 0.5 ? 0.3 : 6);
      if (busKit) { busKit.commit(nb); busKit.setHeadlights(night); }
      const dirty = sitesDirty;
      if (dirty) { sitesDirty = false; writeSites(); }
      writeCones(dirty);
    },
  };
  engine.add(api);
}
