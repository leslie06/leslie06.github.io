import type { AirfieldData } from './Data';
import { hash2 } from './Parked';
import type { PlaneKind } from './Plane';

/**
 * 起降的飞机（2026-11-16，第二批）：向北运行（北京冬天刮北风；这样进近的飞机从南边来，从机场高速上空压过去）。
 * 西跑道（36L）专落地、中跑道（36R）专起飞、东跑道（01）落地起飞轮着来，各自按固定间隔排时刻表，
 * 半夜（0–6 点）跳过三分之二。一架飞机的位置只由时刻表和钟点算出来（没有状态），所以玩家什么时候到、看到的都是对的。
 *
 * 只有两样有状态：复飞（落地前跑道上有玩家：拉起来、收起落架、爬升飞走），和「出现时镜头离得太近」——起飞的飞机在跑道头凭空
 * 出现，镜头在 500 米内的那一架整趟不画。
 *
 * 第二批只做天上和跑道上：落地的滑到跑道北头就消失，起飞的从跑道南头出现。滑行、进位、推出是第三批。
 */
export interface Runway { ref: string; w: number; sx: number; sz: number; nx: number; nz: number; ux: number; uz: number; len: number }

export interface FlightPose {
  id: number; kind: PlaneKind; livery: number;
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** 速度（米/秒，水平和竖直）、发动机推力 0–1、起落架放没放、着陆灯开没开、在不在地上。 */
  vx: number; vy: number; vz: number; thrust: number; gear: boolean; landing: boolean; ground: boolean;
  arr: boolean;
}

const G3 = Math.tan(3 * Math.PI / 180);
/** 进近从离瞄准点多远开始（米）、进近速度、接地点离跑道头多远。 */
const APP_D = 12000, APP_V = 72, AIM = 350;
/** 落地：减速度（米/秒²）、滑行速度、跑道北头前多远消失。 */
const DECEL = 2.2, ROLL_V = 14, ROLL_END = 180;
/** 起飞：对正后等几秒、加速度、抬轮速度、爬升角、离地多高消失。 */
const HOLD = 10, ACC = 1.9, VR = 74, CLIMB = 8 * Math.PI / 180, GONE_H = 1400;

export function runways(d: AirfieldData): Runway[] {
  return d.runways.map((r) => {
    const p = r.p, ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
    // 向北运行：从南头（z 大的那头）往北
    const [sx, sz, nx, nz] = az > bz ? [ax, az, bx, bz] : [bx, bz, ax, az];
    const len = Math.hypot(nx - sx, nz - sz);
    return { ref: r.ref, w: r.w, sx, sz, nx, nz, ux: (nx - sx) / len, uz: (nz - sz) / len, len };
  }).filter((r) => r.len > 1000).sort((a, b) => a.sx - b.sx);
}

/** 一条跑道的时刻表：几秒一班、起点偏移、这一班是落地还是起飞。 */
interface Slotting { rw: number; period: number; offset: number; mode: 'arr' | 'dep' | 'alt' }

export class Flights {
  readonly rws: Runway[];
  private plan: Slotting[];
  private goAround = new Map<number, { t: number; x: number; y: number; z: number; v: number }>();
  private hidden = new Map<number, boolean>();
  private out: FlightPose[] = [];

  constructor(d: AirfieldData) {
    this.rws = runways(d);
    // 西 36L 落地、中 36R 起飞、东 01 轮流
    this.plan = this.rws.map((_, i) => (i === 0 ? { rw: i, period: 105, offset: 0, mode: 'arr' as const } : i === 1 ? { rw: i, period: 115, offset: 40, mode: 'dep' as const } : { rw: i, period: 130, offset: 75, mode: 'alt' as const }));
  }

  /** 第 slot 班是不是落地。 */
  private isArr(p: Slotting, slot: number): boolean { return p.mode === 'arr' || (p.mode === 'alt' && slot % 2 === 0); }

  /**
   * 时刻 t（秒，游戏开始后的时钟）在飞的所有飞机。`hour` 是游戏钟点（半夜班少），(cx, cz) 镜头（出现时太近的不画），
   * `onRunway(rw)` 玩家是不是在这条跑道上（复飞）。
   */
  poses(t: number, hour: number, cx: number, cz: number, onRunway: (rw: Runway) => boolean): FlightPose[] {
    const out = this.out;
    out.length = 0;
    for (const p of this.plan) {
      const rw = this.rws[p.rw];
      // 一班最长（落地：进近 12 公里 170 秒 + 滑跑 + 滑到头）约 260 秒
      const first = Math.floor((t - p.offset - 300) / p.period), last = Math.floor((t - p.offset) / p.period);
      for (let slot = Math.max(0, first); slot <= last; slot++) {
        const t0 = slot * p.period + p.offset, tau = t - t0;
        if (tau < 0) continue;
        const id = p.rw * 100000 + slot;
        const night = hour < 6;
        if (night && hash2(id, 77) < 0.67) continue;
        const arr = this.isArr(p, slot);
        const pose = arr ? this.arrival(rw, id, tau, onRunway) : this.departure(rw, tau);
        if (!pose) { this.hidden.delete(id); this.goAround.delete(id); continue; }
        // 起飞的那架出现时镜头在 500 米内：整趟不画
        if (!this.hidden.has(id)) this.hidden.set(id, !arr && Math.hypot(pose.x - cx, pose.z - cz) < 500);
        if (this.hidden.get(id)) continue;
        const r = hash2(id, 5);
        pose.id = id; pose.kind = r < 0.68 ? 0 : r < 0.93 ? 1 : 2; pose.livery = Math.floor(hash2(id, 9) * 6); pose.arr = arr;
        out.push(pose);
      }
    }
    // 早就飞完的清掉
    if (this.hidden.size > 64) for (const k of [...this.hidden.keys()].slice(0, 32)) this.hidden.delete(k);
    return out;
  }

  private pose(x: number, y: number, z: number, yaw: number, pitch: number, vx: number, vy: number, vz: number, thrust: number, gear: boolean, ground: boolean): FlightPose {
    return { id: 0, kind: 0, livery: 0, x, y, z, yaw, pitch, vx, vy, vz, thrust, gear, landing: !ground || thrust > 0.5 || vx * vx + vz * vz > 400, ground, arr: true };
  }

  private arrival(rw: Runway, id: number, tau: number, onRunway: (rw: Runway) => boolean): FlightPose | null {
    const yaw = Math.atan2(rw.ux, rw.uz);
    const ga = this.goAround.get(id);
    if (ga) {
      // 复飞：从拉起那一刻起加速、6° 爬升
      const dt = tau - ga.t, v = Math.min(95, ga.v + 1.5 * dt), cl = Math.sin(6 * Math.PI / 180);
      const tc = (95 - ga.v) / 1.5, s = dt < tc ? ga.v * dt + 0.75 * dt * dt : ga.v * tc + 0.75 * tc * tc + 95 * (dt - tc);
      const y = ga.y + s * cl;
      if (y > GONE_H || s > 15000) return null;
      return this.pose(ga.x + rw.ux * s, y, ga.z + rw.uz * s, yaw, 0.16, rw.ux * v, v * cl, rw.uz * v, 0.95, dt < 4, false);
    }
    const tApp = APP_D / APP_V;
    if (tau < tApp) {
      // 进近：沿 3° 下滑线，离瞄准点 d 米
      const d = APP_D - APP_V * tau;
      const ax = rw.sx + rw.ux * AIM, az = rw.sz + rw.uz * AIM;
      const y = Math.max(0, d * G3 - Math.max(0, 12 - d * G3) * 0.6);
      // 跑道上有人：离跑道头 4 公里到 400 米之间复飞
      if (d > 400 && d < 4000 && onRunway(rw)) this.goAround.set(id, { t: tau, x: ax - rw.ux * d, y, z: az - rw.uz * d, v: APP_V });
      const flare = d < 250 ? (250 - d) / 250 : 0;
      return this.pose(ax - rw.ux * d, y, az - rw.uz * d, yaw, 0.045 + flare * 0.06, rw.ux * APP_V, -APP_V * G3, rw.uz * APP_V, 0.42, true, false);
    }
    // 接地以后：减速到滑行速度，滑到跑道北头
    const t1 = tau - tApp, tStop = (APP_V - ROLL_V) / DECEL;
    let s: number, v: number;
    if (t1 < tStop) { s = APP_V * t1 - 0.5 * DECEL * t1 * t1; v = APP_V - DECEL * t1; }
    else { s = APP_V * tStop - 0.5 * DECEL * tStop * tStop + ROLL_V * (t1 - tStop); v = ROLL_V; }
    if (AIM + s > rw.len - ROLL_END) return null;
    const nose = t1 < 2.5 ? 0.05 * (1 - t1 / 2.5) : 0;
    // 反推：接地后几秒推力大
    const thrust = t1 > 1.5 && t1 < 14 ? 0.85 : 0.25;
    return this.pose(rw.sx + rw.ux * (AIM + s), 0, rw.sz + rw.uz * (AIM + s), yaw, nose, rw.ux * v, 0, rw.uz * v, thrust, true, true);
  }

  private departure(rw: Runway, tau: number): FlightPose | null {
    const yaw = Math.atan2(rw.ux, rw.uz), s0 = 60;
    if (tau < HOLD) return this.pose(rw.sx + rw.ux * s0, 0, rw.sz + rw.uz * s0, yaw, 0, 0, 0, 0, tau > HOLD - 3 ? 0.6 : 0.2, true, true);
    const t1 = tau - HOLD, tR = VR / ACC, sR = 0.5 * ACC * tR * tR;
    if (t1 < tR) {
      const s = 0.5 * ACC * t1 * t1, v = ACC * t1;
      return this.pose(rw.sx + rw.ux * (s0 + s), 0, rw.sz + rw.uz * (s0 + s), yaw, 0, rw.ux * v, 0, rw.uz * v, 1, true, true);
    }
    // 抬轮（3 秒抬到 10°）、离地、爬升
    const t2 = t1 - tR, v = Math.min(95, VR + 1.2 * t2), tc = (95 - VR) / 1.2;
    const s = sR + (t2 < tc ? VR * t2 + 0.6 * t2 * t2 : VR * tc + 0.6 * tc * tc + 95 * (t2 - tc));
    const rot = Math.min(1, t2 / 3), lift = Math.max(0, t2 - 2.5);
    const climb = Math.min(CLIMB, lift * 0.05), y = Math.max(0, (s - sR - VR * 2.5) * Math.tan(climb * 0.85));
    if (y > GONE_H || s > 16000) return null;
    return this.pose(rw.sx + rw.ux * (s0 + s), y, rw.sz + rw.uz * (s0 + s), yaw, 0.17 * rot, rw.ux * v, v * Math.sin(climb), rw.uz * v, 0.95, lift < 7, y < 0.5);
  }
}
