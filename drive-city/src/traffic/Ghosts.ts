import * as THREE from 'three';
import { CarKit } from './CarKit';
import type { LaneGraph, Link } from './LaneGraph';
import type { Signals } from './Signals';
import { STOP_LINE } from './AiDriver';
import { SPEC_OF } from '../vehicle/Spec';
import { bodySettled, specLength, type BodySource, type BodyType } from '../vehicle/Bodies';
import { defaultLivery } from '../vehicle/CarModel';

/**
 * The distant traffic (2026-10-11, 「街道太空」: the physics traffic lives within 330 m of the camera, so down a
 * Beijing arterial the road ran empty to the horizon). Cars with no physics drive the lane graph from `R_IN` out
 * to `rOut`: the Intelligent Driver Model behind the car in front (another of these, or a physics car's driver),
 * stopping at red lights, slowing for turns, picking the way on as traffic does (`LaneGraph.next`) - and drawn
 * as instances of far kits that keep their lamps (headlights at night, brake lamps in a queue).
 *
 * At the edges they hand over: one that comes within `R_IN` of the camera becomes a physics car where it is, at
 * its speed and lane (`adopt`, traffic/'s pool; while the pool is full it drives on as one of these until 120 m,
 * and goes when out of view), and a physics car leaving for good past 330 m becomes one of these (`take`), so a
 * car neither appears nor vanishes at either edge. New ones are put out of view (anywhere at the start or after
 * the camera jumps), on links weighted by length, lanes and class density, as far as the budget `cap` allows.
 */
export interface GhostCar {
  link: number; s: number; lane: number; v: number;
  /** Own desired speed factor. */
  mood: number;
  /** The link after this one: -2 not chosen yet, -1 the road ends. */
  next: number;
  body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean;
  /** Drawn lateral offset (eases to the lane's at a lane change across a junction). */
  off: number;
  brake: boolean;
  /** Bucket order this frame (-1: a physics car's entry). */
  ord: number;
  /** Length of its body, m. */
  len: number;
  /** Where it was put this frame: point and direction; `k` the polyline segment it is on (a search hint). */
  x: number; z: number; dx: number; dz: number; k: number;
  /**
   * 「轻量车」（`GhostTraffic.light`）：离镜头 `R_NEAR` 以内的，画的位置和朝向不再贴着折线（过路口会原地转 90°），而是像实体车
   * 的司机那样追着前方一点开（`pursue`）：`px, pz, yaw` 是画出来的位姿，`steer` 前轮转角，`spin` 车轮转过的角度，`plate` 车牌号。
   */
  near: boolean; px: number; pz: number; yaw: number; steer: number; spin: number; plate: number;
  /** `close`：离镜头不到 `rNear + 40` 米（按位置互相让的范围，比近处大一圈）。`y`：路面高度（高架、下穿），上一帧画的时候算的。 */
  uid: number; close: boolean; y: number;
  /** 这一帧开头它在哪、朝哪（近处的是追出来的位姿，否则是轨道上的）：互相让行时用，免得每一对都算一遍三角函数。 */
  qx: number; qz: number; hx: number; hz: number;
  /** 这一帧是什么在限制它（探针用）：0 没有，1 同车道前车，2 下一段路的头一辆，3 红灯，4 路到头，5 人，6 实体车，7 按位置让另一辆轻量车。 */
  why: number;
  /**
   * 按位置让行是有耐心的：为了让人、让车停了 `wait` 秒；超过 8 秒就不让了，硬挤过去 `push` 秒（会从对方身上穿过去，但不会
   * 堵死：探针里一辆轻量车和两个骑手在 10 米长的小路口互相等了 200 秒，后面排了一串）。
   */
  wait: number; push: number;
}
/** A car in a lane's list: a ghost, or a physics car's driver (`ord` -1). */
type Entry = GhostCar | { s: number; v: number; ord: -1; len: number };
/** What a physics car hands over (and an adopted ghost gives). */
export interface Handover {
  link: number; s: number; lane: number; v: number; body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean;
  /** 轻量车交接时带上的：已经选好的下一段路（-1 路到头），和它现在画在哪、朝哪。 */
  next?: number; x?: number; z?: number; yaw?: number;
}

/** Cars per lane-kilometre by road class (the density the budget is shared out by; scaled down to fit it). */
const DENSITY: Record<string, number> = {
  motorway: 30, trunk: 30, primary: 26, secondary: 18, tertiary: 8, busway: 4, unclassified: 2.5, residential: 2,
  motorway_link: 10, trunk_link: 10, primary_link: 8, secondary_link: 6, tertiary_link: 4,
};
/** How much of its share a link out of view gets (the budget goes where the camera looks; turning round, new ones come). */
const BEHIND = 0.25;
/** Within this a ghost becomes a physics car (traffic spawns its own from 70 m, and lets go of them past 330). */
export const R_IN = 220;
/** A ghost that could not become a physics car goes at the latest here (out of view from R_IN - 40). */
const R_GONE = 120;
/** New ones in view only this far off. */
const IN_VIEW_MIN = R_IN + 10;
/**
 * 「轻量车」（2026-11-11，docs/street-level-design.md A2 第二步，「只是在地图上开车」）：远景车不再在 220 米处交给物理、120 米处
 * 消失，而是一直开到玩家身边（`hot`，55 米起，车速越快越远）才变成实体车；实体车开远了又变回来。离镜头 `R_NEAR` 以内的用近处
 * 的车模画（车轮会转、会打方向），位姿是追出来的，会让行人和停着的车。这样实体车只剩玩家身边的十来辆，路上的车数由密度表定。
 */
const R_NEAR = 170;
/** 近处的密度加权：预算先紧着 330 米以内（再往外到 450 米线性降到 1），但每条路不超过密度表的满值。 */
const NEAR_BOOST = 2.2;
/** 镜头跳走的时候，玩家身边这么远以内的轻量车留着。 */
const KEEP = 260;
const A_MAX = 1.6, B_COMF = 2.8;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class GhostTraffic {
  readonly cars: GhostCar[] = [];
  private kits = new Map<BodyType, CarKit>();
  private buckets = new Map<number, Entry[]>();
  private spareLists: Entry[][] = [];
  private list(o: Entry): Entry[] { const l = this.spareLists.pop() ?? []; l.push(o); return l; }
  /** Physics cars' entries in the lanes, reused. */
  private drv: { s: number; v: number; ord: -1; len: number }[] = [];
  /** Points along each link (x, z), once asked for. */
  private samples = new Map<number, Float32Array>();
  private free: GhostCar[] = [];
  private refillT = 0;
  /** Cars the roads in reach would hold at full density (weighted), last refill: probes. */
  demand = 0;
  private warm = 2;
  private last = new THREE.Vector3(Infinity, 0, Infinity);
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private pos = new THREE.Vector3();
  /** The camera's direction this frame. */
  private dir = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private lit = { taxi: false, brake: false };
  /** Physics cars as leaders: [link, s, lane, v, length] per car, set each frame by traffic. */
  readonly drivers: number[] = [];
  /** 轻量车模式（traffic/ 打开；`?lightcars=0` 关）。 */
  light = false;
  /** 玩家在哪、多近以内的要变成实体车；`hots` 是别的要实体车的地方（警车、任务车）：x, z, r 三个一组。 */
  readonly hot = { x: 0, z: 0, r: 0 };
  readonly hots: number[] = [];
  /** 多近以内算近处（用近处车模画、位姿用追的）；近处密度加权多少。traffic 按画质定。 */
  rNear = R_NEAR;
  nearBoost = NEAR_BOOST;
  /** 近处的轻量车要让的人（路上的行人、徒步的玩家）：x, z, 半径 三个一组，traffic 每帧填。 */
  readonly blockers: number[] = [];
  /**
   * 近处的轻量车要让的车（实体车、玩家的车、警车、任务车；骑手贴着路边骑，不在车道的队列里也要让）：x, z, 路面高度, vx, vz,
   * 车长, 半宽 七个一组，traffic 每帧填。按几何位置让（在自己正前方的车道宽度里、同一层路面上），不按车道编号。
   */
  readonly movers: number[] = [];
  /** 离镜头 `rNear + 40` 米以内的（上一帧的）：互相按位置让；实体车的司机也看它们（traffic/ 的 leaderFor）。 */
  readonly nearList: GhostCar[] = [];
  /** 把一辆近处的轻量车画进 traffic 的近处车模里（画不下返回 false，退回远处车模）。 */
  nearDraw: ((c: GhostCar, pos: THREE.Vector3, quat: THREE.Quaternion) => boolean) | null = null;
  /** 交接了多少次（探针用）。 */
  readonly counts = { promoted: 0, demoted: 0 };
  private plates = 0;

  /**
   * At night, one bright point a car (white facing the camera, red going away): its lamps are under a pixel past
   * 300 m, and a Beijing avenue at night is a stream of them. One draw call; HDR colours, so bloom takes them.
   */
  private lights: THREE.Points;
  private lightPos: THREE.BufferAttribute;
  private lightCol: THREE.BufferAttribute;

  constructor(private scene: THREE.Scene, private g: LaneGraph, private sig: Signals, private rnd: () => number,
    readonly cap: number, readonly rOut: number,
    /** Bodies drawn as themselves (others map to these: hatch -> sedan, mpv -> suv, truck -> suv). */
    private bodies: Set<BodyType>,
    /** A body and colours for a new car on a link of class `cls`. */
    private paint: (cls: string) => { body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean },
    /** Make it a physics car here; false while the pool has no room. */
    private adopt: (h: Handover) => boolean) {
    const geo = new THREE.BufferGeometry();
    this.lightPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.lightCol = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.lightPos); geo.setAttribute('color', this.lightCol);
    geo.setDrawRange(0, 0);
    this.lights = new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lights.frustumCulled = false;
    this.lights.name = 'ghost-lights';
    scene.add(this.lights);
  }

  private bodyOf(b: BodyType): BodyType {
    const d: BodyType = this.bodies.has(b) ? b : b === 'mpv' || b === 'truck' ? 'suv' : 'sedan';
    return this.bodies.has(d) && bodySettled(d as BodySource) ? d : 'sedan';
  }
  private kit(b: BodyType): CarKit {
    let k = this.kits.get(b);
    if (!k) { k = new CarKit(this.scene, this.cap, defaultLivery(b), b, { far: true, lamps: true }); this.kits.set(b, k); }
    return k;
  }

  private add(h: Handover, mood = 0.85 + this.rnd() * 0.2, force = false): GhostCar | null {
    if (this.cars.length >= this.cap) {
      // 一辆实体车交过来（就在镜头附近，不能凭空没了）：让离镜头最远的一辆走
      if (!force) return null;
      // （正在逐辆更新的时候不能从中间拿走：先超出一辆，下一帧开头再让）
      if (!this.busy) this.dropFar();
    }
    const c: GhostCar = this.free.pop() ?? { link: 0, s: 0, lane: 0, v: 0, mood: 1, next: -2, body: 'sedan', upper: new THREE.Color(), lower: new THREE.Color(), taxi: false, off: 0, brake: false, ord: 0, len: 4.6, x: 0, z: 0, dx: 0, dz: 1, k: 1,
      near: false, px: 0, pz: 0, yaw: 0, steer: 0, spin: 0, plate: 0, uid: 0, close: false, y: 0, qx: 0, qz: 0, hx: 0, hz: 1, why: 0, wait: 0, push: 0 };
    const l = this.g.links[h.link];
    c.link = h.link; c.s = h.s; c.lane = this.g.laneOn(l, h.lane); c.v = h.v; c.mood = mood; c.next = h.next ?? -2;
    c.body = h.body; c.len = specLength(SPEC_OF[h.body]); c.upper.copy(h.upper); c.lower.copy(h.lower); c.taxi = h.taxi; c.off = this.g.laneOffset(l, c.lane); c.brake = false; c.k = 1;
    c.uid = this.plates; c.plate = this.plates++ % 8; c.spin = 0; c.steer = 0;
    this.place(c, l);
    c.wait = 0; c.push = 0;
    c.near = h.x !== undefined; c.close = c.near; c.y = l.h ? this.g.heightAt(l, c.s) : 0;
    if (c.near) { c.px = h.x!; c.pz = h.z!; c.yaw = h.yaw!; }
    this.cars.push(c);
    return c;
  }
  private busy = false;
  private dropFar(): void {
    let far = -1, fd = 0;
    for (let i = 0; i < this.cars.length; i++) { const o = this.cars[i], d = Math.hypot(o.x - this.last.x, o.z - this.last.z); if (d > fd) { fd = d; far = i; } }
    if (far >= 0) this.remove(far);
  }
  /**
   * 近处的轻量车这一帧画在哪：追着轨道上前方 `look` 米的那一点开（和 AiDriver 一样的 pure pursuit），速度跟着轨道上的速度，
   * 落后了快一点、超前了慢一点。直路上和轨道重合，过路口走一条弧线。
   */
  private pursue(c: GhostCar, l: Link, dt: number): void {
    const g = this.g, look = Math.max(6, Math.min(20, 4 + c.v * 0.8));
    let tl = l, ts = c.s + look, off = c.off;
    if (ts > l.len) {
      if (c.next >= 0) { tl = g.links[c.next]; ts = Math.min(tl.len, ts - l.len); off = g.laneOffset(tl, g.laneOn(tl, c.lane)); }
      else ts = l.len;
    }
    g.at(tl, ts, off, this.tmp);
    const rx = this.tmp.x - c.px, rz = this.tmp.z - c.pz, d2 = rx * rx + rz * rz, dist = Math.sqrt(d2);
    // 离轨道太远（数据里的怪事）：放回轨道上
    if (dist > look + 12) { c.px = c.x; c.pz = c.z; c.yaw = Math.atan2(c.dx, c.dz); c.steer = 0; return; }
    const sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
    const side = rx * cs - rz * sn;   // 左手方向是 (cos, -sin)
    const vd = Math.max(0, Math.min(c.v + 4, c.v + 1.5 * (dist - look)));
    const kappa = Math.max(-0.22, Math.min(0.22, 2 * side / Math.max(9, d2)));
    const ds = vd * dt;
    c.yaw += kappa * ds;
    c.px += Math.sin(c.yaw) * ds; c.pz += Math.cos(c.yaw) * ds;
    c.steer += (Math.atan(kappa * 2.7) - c.steer) * Math.min(1, dt * 8);
    c.spin += ds / 0.32;
  }
  /** Put `c` at its s and offset on its link (as `LaneGraph.at`, walking on from the segment it was on). */
  private place(c: GhostCar, l: Link): void {
    const m = l.cum.length, s = Math.max(0, Math.min(l.len, c.s));
    let k = c.k;
    if (k < 1 || k > m - 1 || l.cum[k - 1] > s) k = 1;
    while (k < m - 1 && l.cum[k] < s) k++;
    c.k = k;
    const s0 = l.cum[k - 1], s1 = l.cum[k], t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], bx = l.pts[k * 2], bz = l.pts[k * 2 + 1];
    let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    c.x = ax + (bx - ax) * t + dz * c.off; c.z = az + (bz - az) * t - dx * c.off; c.dx = dx; c.dz = dz;
  }

  private remove(i: number): void {
    const c = this.cars[i];
    this.cars[i] = this.cars[this.cars.length - 1];
    this.cars.pop();
    this.free.push(c);
  }

  /** A physics car leaving for good: it drives on as one of these (when within reach and the budget). */
  take(h: Handover): void { if (this.add(h, undefined, this.light) && this.light) this.counts.demoted++; }
  /** 把 (x, z) 周围 `r` 米内的都拿走（第五章收费站那种清场）。 */
  clearNear(x: number, z: number, r: number): number {
    let k = 0;
    for (let i = this.cars.length - 1; i >= 0; i--) { const c = this.cars[i]; if (Math.hypot(c.x - x, c.z - z) < r) { this.remove(i); k++; } }
    return k;
  }

  /** Forget them all (a teleport): the next frames fill the new place anywhere, in view or not. */
  reset(): void {
    // 轻量车模式下玩家身边的留着：镜头切到别处再切回来（过场、任务开头的镜头），身边的车不能全没了再冒出来
    for (let i = this.cars.length - 1; i >= 0; i--) { const c = this.cars[i]; if (!this.light || Math.hypot(c.x - this.hot.x, c.z - this.hot.z) > KEEP) this.remove(i); }
    this.warm = 2;
  }

  /**
   * The ghost in front of a physics car on `link` (then `next`) at `s` in `lane`: the distance from centre to
   * centre, its length and speed, or null (traffic's leader test: a physics car must not drive through one either).
   */
  leaderFor(link: number, s: number, lane: number, next: number): { ds: number; len: number; v: number } | null {
    const b = this.buckets.get(link * 8 + lane);
    if (b) for (const o of b) if (o.ord >= 0 && o.s > s) return { ds: o.s - s, len: o.len, v: o.v };
    if (next >= 0) {
      const nl = this.g.links[next], b2 = this.buckets.get(next * 8 + this.g.laneOn(nl, lane));
      if (b2) for (const o of b2) if (o.ord >= 0) return { ds: this.g.links[link].len - s + o.s, len: o.len, v: o.v };
    }
    return null;
  }

  private seen(x: number, z: number, d: number, cam: THREE.Vector3): boolean { return d < 1 || ((x - cam.x) * this.dir.x + (z - cam.z) * this.dir.z) / d > 0.3; }

  /** How far the nearest ghost in view inside R_IN is (Infinity: none): one that will be gone at R_GONE unless a place is made for it. */
  waitingInView(cam: THREE.Vector3): number {
    let bd = Infinity;
    for (const c of this.cars) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d < R_IN && d < bd && this.seen(c.x, c.z, d, cam)) bd = d;
    }
    return bd;
  }

  /** Physics room came free: the nearest ghost already within R_IN takes it (before traffic spawns one of its own). */
  adoptWaiting(cam: THREE.Vector3): boolean {
    // the one the camera looks at before one behind it (2026-11-10: the places go where the player is looking)
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i], d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d >= R_IN) continue;
      const score = d * (this.seen(c.x, c.z, d, cam) ? 1 : 2.2);
      if (score < bd) { bd = score; best = i; }
    }
    if (best < 0) return false;
    const c = this.cars[best];
    if (!this.adopt({ link: c.link, s: c.s, lane: c.lane, v: c.v, body: c.body, upper: c.upper, lower: c.lower, taxi: c.taxi })) return false;
    this.remove(best);
    return true;
  }

  /** Simulate, hand over, refill and draw: once a frame, from traffic's update (after `drivers` is set); `room`: the physics pool has a free place. */
  update(dt: number, t: number, cam: THREE.Vector3, camDir: THREE.Vector3, night: boolean, room = true): void {
    dt = Math.min(dt, 0.1);
    const g = this.g;
    if (Math.hypot(cam.x - this.last.x, cam.z - this.last.z) > 150) this.reset();
    this.last.copy(cam);
    this.dir.copy(camDir);
    this.warm = Math.max(0, this.warm - dt);
    const inView = (x: number, z: number, d: number) => d < 1 || ((x - cam.x) * camDir.x + (z - cam.z) * camDir.z) / d > 0.3;

    // Lanes: every ghost and every physics car in its link and lane, in order along it.
    // (the map is emptied every frame and its arrays reused: kept, it grew by every lane ever driven)
    for (const b of this.buckets.values()) { b.length = 0; this.spareLists.push(b); }
    this.buckets.clear();
    const put = (key: number, o: Entry) => { const b = this.buckets.get(key); if (b) b.push(o); else this.buckets.set(key, this.list(o)); };
    for (const c of this.cars) { c.ord = 0; put(c.link * 8 + c.lane, c); }
    for (let i = 0, j = 0; i < this.drivers.length; i += 5, j++) {
      const o = this.drv[j] ?? (this.drv[j] = { s: 0, v: 0, ord: -1, len: 4.6 });
      o.s = this.drivers[i + 1]; o.v = this.drivers[i + 3]; o.len = this.drivers[i + 4];
      put(this.drivers[i] * 8 + this.drivers[i + 2], o);
    }
    for (const b of this.buckets.values()) {
      if (b.length > 1) b.sort((a, c) => a.s - c.s);
      for (let k = 0; k < b.length; k++) if (b[k].ord >= 0) b[k].ord = k;
    }

    this.busy = true;
    this.nearList.length = 0;
    if (this.light) for (const c of this.cars) if (c.close) {
      if (c.near) { c.qx = c.px; c.qz = c.pz; c.hx = Math.sin(c.yaw); c.hz = Math.cos(c.yaw); } else { c.qx = c.x; c.qz = c.z; c.hx = c.dx; c.hz = c.dz; }
      this.nearList.push(c);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      let l = g.links[c.link];
      if (c.next === -2 && c.s > l.len - 60) c.next = g.next(c.link, this.rnd);
      // The car in front: on this lane, else the first on the way on.
      let gap = Infinity, vl = 0;
      const b = this.buckets.get(c.link * 8 + c.lane)!;
      const k = c.ord + 1;
      c.why = 0;
      if (k < b.length) { gap = b[k].s - c.s - (b[k].len + c.len) / 2; vl = b[k].v; c.why = 1; }
      if (gap === Infinity && c.next >= 0) {
        const nl = g.links[c.next], b2 = this.buckets.get(c.next * 8 + g.laneOn(nl, c.lane));
        if (b2?.length) { gap = l.len - c.s + b2[0].s - (b2[0].len + c.len) / 2; vl = b2[0].v; c.why = 2; }
      }
      // A red light (or an amber one it can stop for) is a standing car at the stop line.
      const toLine = l.len - STOP_LINE - c.s;
      if (toLine > -0.5 && toLine < 70) {
        const light = this.sig.state(l, t);
        if (light === 2 || (light === 1 && c.v * c.v / 8 < toLine + 0.5)) if (toLine + 2 < gap) { gap = Math.max(0.1, toLine + 2); vl = 0; c.why = 3; }
      }
      if (c.next === -1 && l.len - c.s < gap) { gap = Math.max(0.1, l.len - c.s - 2); vl = 0; c.why = 4; }
      // 近处的轻量车还按几何位置让：正前方的人、实体车（实体车的司机也这样，见 traffic/ 的 leaderFor），和从别的路汇进来的
      // 另一辆轻量车（车道队列只管同一段路的同一条车道，匝道汇入、没有灯的路口两辆车会叠在一起）
      if (c.close && c.push <= 0) {
        const cx = c.qx, cz = c.qz, sn = c.hx, cs = c.hz, bl = this.blockers, mv = this.movers;
        for (let q = 0; q < bl.length && Math.abs(c.y) < 3; q += 3) {
          const rx = bl[q] - cx, rz = bl[q + 1] - cz, along = rx * sn + rz * cs;
          if (along < 0.5 || along > 30 || Math.abs(rx * cs - rz * sn) > 1.1 + bl[q + 2]) continue;
          const gb = Math.max(0.1, along - c.len / 2 - bl[q + 2] - 1);
          if (gb < gap) { gap = gb; vl = 0; c.why = 5; }
        }
        for (let q = 0; q < mv.length; q += 7) {
          const rx = mv[q] - cx, rz = mv[q + 1] - cz;
          if (rx > 31 || rx < -31 || rz > 31 || rz < -31) continue;
          const along = rx * sn + rz * cs;
          if (along < 0.5 || along > 30 || Math.abs(mv[q + 2] - c.y) > 3 || Math.abs(rx * cs - rz * sn) > 0.95 + mv[q + 6] + along * 0.02) continue;
          const gb = Math.max(0.1, along - (c.len + mv[q + 5]) / 2);
          if (gb < gap) { gap = gb; vl = Math.max(0, mv[q + 3] * sn + mv[q + 4] * cs); c.why = 6; }
        }
        for (const o of this.nearList) {
          const rx = o.qx - cx;
          if (rx > 25 || rx < -25) continue;
          const rz = o.qz - cz;
          if (rz > 25 || rz < -25 || o === c || (o.link === c.link && o.lane === c.lane) || Math.abs(o.y - c.y) > 3) continue;
          const so = o.hx, co = o.hz;
          const along = rx * sn + rz * cs;
          // 它的车身中心在我前面、挡在我的车道宽度里：让（并排挤过来的也算，落在后面的那辆停）。两条路以小角度汇到同一个路口
          // （匝道并线、主路和辅路合流）：车道在节点前十几米就收到一起了，所以还隔着一条车道就开始让，排成一列——不然并到一起
          // 才刹车，要叠着开一秒，红灯前会叠着停一整个灯
          let lat = 1.9;
          if (o.link !== c.link && l.len - c.s < 45 && sn * so + cs * co > 0.7) {
            const ol = g.links[o.link];
            if (ol.to === l.to && ol.len - o.s < 45) lat = c.next >= 0 && o.next === c.next && g.laneOn(g.links[c.next], c.lane) === g.laneOn(g.links[c.next], o.lane) ? 4.4 : 3.2;
          }
          if (along <= 0 || Math.abs(rx * cs - rz * sn) > lat) continue;
          // 两辆互相都在对方前面（交叉着开）：停着的那辆让不开（支路口等灯的车头探在主路上），动的让它；都在动或都停着，
          // 离冲突点远的那辆让
          const back = -(rx * so + rz * co);
          if (back > 0 && Math.abs(rx * co - rz * so) < 1.9) {
            const still = c.v < 1, oStill = o.v < 1;
            if (still !== oStill ? still : back > along || (back === along && c.uid < o.uid)) continue;
          }
          const gb = Math.max(0.1, along - (c.len + o.len) / 2);
          if (gb < gap) { gap = gb; vl = Math.max(0, o.v * (sn * so + cs * co)); c.why = 7; }
        }
      }
      let v0 = l.speed * c.mood;
      if (c.next >= 0 && l.len - c.s < 40) {
        const nl = g.links[c.next];
        const turn = Math.acos(Math.max(-1, Math.min(1, l.d1x * nl.d0x + l.d1z * nl.d0z)));
        if (turn > 0.3) v0 = Math.min(v0, Math.sqrt(2.6 * 28 / turn));
      }
      const sStar = 2.5 + c.v * 1.3 + c.v * (c.v - vl) / (2 * Math.sqrt(A_MAX * B_COMF));
      const a = A_MAX * (1 - (c.v / Math.max(1, v0)) ** 4 - (gap < Infinity ? (Math.max(0, sStar) / Math.max(0.1, gap)) ** 2 : 0));
      c.v = Math.max(0, c.v + Math.max(-8, a) * dt);
      if (c.push > 0) c.push -= dt;
      else if (c.why >= 5 && c.v < 0.3) { c.wait += dt; if (c.wait > 8) { c.wait = 0; c.push = 4; } }
      else c.wait = 0;
      c.brake = a < -0.6 || c.v < 0.3;
      c.s += c.v * dt;
      // On to the next link (the lane kept where it can be; the drawn offset eases across).
      let gone = false;
      while (c.s > l.len) {
        if (c.next < 0) { gone = true; break; }
        c.s -= l.len; c.link = c.next; c.next = -2; c.k = 1; l = g.links[c.link];
        c.lane = g.laneOn(l, c.lane);
      }
      if (gone) { this.remove(i); continue; }
      const want = g.laneOffset(l, c.lane);
      c.off += Math.max(-1.5 * dt, Math.min(1.5 * dt, want - c.off));
      // At the edges: into the physics traffic, or out of range.
      this.place(c, l);
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d > this.rOut + 40 && !(this.light && Math.hypot(c.x - this.hot.x, c.z - this.hot.z) < KEEP)) { this.remove(i); continue; }
      if (this.light) {
        const was = c.near;
        c.near = d < (was ? this.rNear + 15 : this.rNear);
        c.close = d < this.rNear + 40;
        if (c.near) {
          if (!was) { c.px = c.x; c.pz = c.z; c.yaw = Math.atan2(c.dx, c.dz); c.steer = 0; }
          this.pursue(c, l, dt);
        }
        // 到了玩家身边（或警车、任务车身边）：变成实体车，就在它现在画的地方
        const x = c.near ? c.px : c.x, z = c.near ? c.pz : c.z;
        let hot = (x - this.hot.x) ** 2 + (z - this.hot.z) ** 2 < this.hot.r * this.hot.r;
        for (let q = 0; !hot && q < this.hots.length; q += 3) hot = (x - this.hots[q]) ** 2 + (z - this.hots[q + 1]) ** 2 < this.hots[q + 2] ** 2;
        if (hot && this.adopt({ link: c.link, s: c.s, lane: c.lane, v: c.v, body: c.body, upper: c.upper, lower: c.lower, taxi: c.taxi, next: c.next === -2 ? undefined : c.next, x, z, yaw: c.near ? c.yaw : Math.atan2(c.dx, c.dz) })) {
          this.counts.promoted++; this.remove(i); continue;
        }
      } else if (d < R_IN) {
        if (room && this.adopt({ link: c.link, s: c.s, lane: c.lane, v: c.v, body: c.body, upper: c.upper, lower: c.lower, taxi: c.taxi })) { this.remove(i); continue; }
        if (d < R_GONE || (d < R_IN - 40 && !inView(c.x, c.z, d))) { this.remove(i); continue; }
      }
    }

    this.busy = false;
    while (this.cars.length > this.cap) this.dropFar();
    this.refillT -= dt;
    if (this.refillT <= 0) { this.refillT = this.warm > 0 ? 0.05 : 0.4; this.refill(cam, inView); }
    this.draw(night);
  }

  /** Put out new ones where the roads are emptier than their share of the budget. */
  private refill(cam: THREE.Vector3, inView: (x: number, z: number, d: number) => boolean): void {
    if (this.cars.length >= this.cap) return;
    const g = this.g, ids = g.near(cam.x, cam.z, this.rOut);
    const want: number[] = [], who: number[] = [], full: number[] = [];
    const light = this.light, rMin = light ? 45 : R_IN + 20;
    let total = 0;
    for (const id of ids) {
      const l = g.links[id], dens = DENSITY[l.cls];
      if (!dens || l.len < 15 || g.avoid.has(id)) continue;
      // Its share by the part of it in reach, in view and nearer (points every ~50 m along it: judged by its middle,
      // a long link starting by the camera got nothing - the lanes ahead stayed empty to 450 m).
      let pts = this.samples.get(id);
      if (!pts) {
        const n = Math.max(2, Math.min(12, Math.ceil(l.len / 50)));
        pts = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) { g.at(l, (k + 0.5) / n * l.len, 0, this.tmp); pts[k * 2] = this.tmp.x; pts[k * 2 + 1] = this.tmp.z; }
        this.samples.set(id, pts);
      }
      let share = 0, cnt = 0;
      const n = pts.length / 2;
      for (let k = 0; k < n; k++) {
        const x = pts[k * 2], z = pts[k * 2 + 1], d = Math.hypot(x - cam.x, z - cam.z);
        if (d < rMin || d > this.rOut) continue;
        cnt++;
        const far = d < 450 ? 1 : 1 - 0.5 * (d - 450) / (this.rOut - 450 || 1);
        // 轻量车：近处多给（玩家身边才是看得见的地方），背后近处也不能太空（镜头一转就看到）
        share += light ? (inView(x, z, d) ? 1 : d < 200 ? 0.6 : BEHIND) * (d < 330 ? this.nearBoost : d < 450 ? 1 + (this.nearBoost - 1) * (450 - d) / 120 : far)
          : (inView(x, z, d) ? 1 : BEHIND) * far;
      }
      if (!share) continue;
      // 能用的车道数（被对向路面占了的不算，LaneGraph.minLane）
      const ul = l.lanes - g.minLane(l);
      const w = l.len * ul * dens / 1000 * share / n;
      want.push(w); who.push(id); total += w;
      full.push(light ? l.len * ul * dens / 1000 * cnt / n : Infinity);
    }
    if (!total) return;
    const scale = Math.min(1, this.cap / total);
    this.demand = total;
    const have = new Map<number, number>();
    for (const c of this.cars) have.set(c.link, (have.get(c.link) ?? 0) + 1);
    // 轻量车模式下实体车就在这些路上，也算在已有的里面
    if (light) for (let i = 0; i < this.drivers.length; i += 5) have.set(this.drivers[i], (have.get(this.drivers[i]) ?? 0) + 1);
    const short = (i: number) => Math.max(0, Math.min(full[i], want[i] * scale) - (have.get(who[i]) ?? 0));
    // Full, and the view short of its share: let the furthest ones out of view go (they would only be seen on turning round).
    if (this.cars.length >= this.cap - 4) {
      let freed = 0;
      for (let i = this.cars.length - 1; i >= 0 && freed < 12; i--) {
        const c = this.cars[i], d = Math.hypot(c.x - cam.x, c.z - cam.z);
        if (d > 380 && ((c.x - cam.x) * this.dir.x + (c.z - cam.z) * this.dir.z) / d < -0.2) { this.remove(i); freed++; }
      }
    }
    const tries = this.warm > 0 ? 60 : 8;
    for (let k = 0; k < tries && this.cars.length < this.cap; k++) {
      // a link by its shortfall
      let sum = 0;
      for (let i = 0; i < who.length; i++) sum += short(i);
      if (sum < 0.5) return;
      let u = this.rnd() * sum, i = 0;
      for (; i < who.length - 1; i++) { u -= short(i); if (u <= 0) break; }
      const id = who[i], l = g.links[id];
      const s = 4 + this.rnd() * (l.len - 8), lane = g.laneOn(l, Math.floor(this.rnd() * l.lanes));
      g.at(l, s, g.laneOffset(l, lane), this.tmp);
      const d = Math.hypot(this.tmp.x - cam.x, this.tmp.z - cam.z);
      if (d < (light ? 70 : R_IN + 10) || d > this.rOut) {
        // 轻量车刚开局或瞬移之后：近处也放（离玩家 25 米以外），不然要等车从 70 米外开过来
        if (!(light && this.warm > 0 && d <= this.rOut && Math.hypot(this.tmp.x - this.hot.x, this.tmp.z - this.hot.z) > 25)) continue;
      }
      if (light) {
        let clear = true;
        for (let q = 0; clear && q < this.blockers.length; q += 3) clear = Math.hypot(this.tmp.x - this.blockers[q], this.tmp.z - this.blockers[q + 1]) > 10;
        if (!clear) continue;
      }
      // In view only far off: a car seen from behind at 230 m is 7 px wide (the lanes heading away from the camera
      // fill no other way - nothing drives into them from the near side, so held to 450 m they stayed empty).
      if (this.warm <= 0 && d < IN_VIEW_MIN && inView(this.tmp.x, this.tmp.z, d)) continue;
      const b = this.buckets.get(id * 8 + lane);
      if (b && b.some((o) => Math.abs(o.s - s) < 14)) continue;
      const p = this.paint(l.cls);
      const c = this.add({ link: id, s, lane, v: l.speed * 0.8, ...p });
      if (c) { have.set(id, (have.get(id) ?? 0) + 1); if (b) b.push(c); else this.buckets.set(id * 8 + lane, this.list(c)); }
    }
  }

  private draw(night: boolean): void {
    const g = this.g, cam = this.last, lp = this.lightPos.array as Float32Array, lc = this.lightCol.array as Float32Array;
    let nl = 0;
    for (const c of this.cars) {
      const l: Link = g.links[c.link];
      const body = this.bodyOf(c.body), spec = SPEC_OF[body], kit = this.kit(body);
      let y = 0, pitch = 0;
      c.y = 0;
      if (l.h) {
        y = c.y = g.heightAt(l, c.s);
        pitch = Math.atan((g.heightAt(l, Math.min(l.len, c.s + 2)) - g.heightAt(l, Math.max(0, c.s - 2))) / 4);
      }
      if (c.near && this.nearDraw) {
        this.pos.set(c.px, y + 0.03, c.pz);
        this.quat.setFromEuler(_e.set(-pitch, c.yaw, 0));
        if (this.nearDraw(c, this.pos, this.quat)) continue;
      }
      this.pos.set(c.x, y + 0.03 + spec.wheelRadius, c.z);
      if (!kit.sees(this.pos)) continue;
      this.quat.setFromEuler(_e.set(-pitch, Math.atan2(c.dx, c.dz), 0));
      this.lit.taxi = c.taxi; this.lit.brake = c.brake;
      kit.setStill(this.pos, this.quat, c.upper, c.lower, this.lit);
      if (night && nl < this.cap) {
        // the end facing the camera, 0.7 m up: headlamps or tail lamps (brighter braking), fading with distance
        const tx = cam.x - c.x, tz = cam.z - c.z, d = Math.hypot(tx, tz) || 1, front = (tx * c.dx + tz * c.dz) / d;
        const end = (front > 0 ? 1 : -1) * c.len * 0.48, k = (1.2 - 0.6 * Math.min(1, d / this.rOut)) * Math.min(1, Math.abs(front) * 3 + 0.25);
        lp[nl * 3] = c.x + c.dx * end; lp[nl * 3 + 1] = this.pos.y + 0.4; lp[nl * 3 + 2] = c.z + c.dz * end;
        if (front > 0) { lc[nl * 3] = 4 * k; lc[nl * 3 + 1] = 3.6 * k; lc[nl * 3 + 2] = 2.8 * k; }
        else { const b = c.brake ? 4.4 : 2.4; lc[nl * 3] = b * k; lc[nl * 3 + 1] = 0.08 * k; lc[nl * 3 + 2] = 0.05 * k; }
        nl++;
      }
    }
    this.lights.geometry.setDrawRange(0, nl);
    this.lights.visible = nl > 0;
    if (nl) { this.lightPos.needsUpdate = true; this.lightCol.needsUpdate = true; this.lightPos.clearUpdateRanges(); this.lightPos.addUpdateRange(0, nl * 3); this.lightCol.clearUpdateRanges(); this.lightCol.addUpdateRange(0, nl * 3); }
    for (const k of this.kits.values()) { k.commit(0); k.setHeadlights(night); }
  }

}
