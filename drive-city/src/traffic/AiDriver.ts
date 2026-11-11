import type { DriveInput } from '../vehicle/ControlFilter';
import type { Vehicle } from '../vehicle/Vehicle';
import type { LaneGraph } from './LaneGraph';
import type { Light, Signals } from './Signals';

export interface Leader { gap: number; speed: number }

const A_MAX = 2.2, B_COMF = 3.2, S0 = 3, HEADWAY = 1.25, CAR_LEN = 4.6;
/**
 * 最右一条车道里的车往左让这么多（2026-11-11，A6）：多车道的路上最右车道的中线离路边只有 1.6–2 米，电动车贴着路边
 * 骑（离路边 0.5–0.8 米），和排队的车只隔一米，挤不过去（两个都是实体，会蹭上）。车往左让 0.4 米，给路边留出一条缝。
 */
export const EDGE_ROOM = 0.4;
/** 这条车道上的车画在、开在离路中线多远：最右车道（公交除外，它要靠站台）往左让 `EDGE_ROOM`。 */
export const driveOffset = (g: LaneGraph, l: { lanes: number; oneway: boolean; laneW: number; hw: number }, lane: number, bus = false): number => {
  const link = l as Parameters<LaneGraph['laneOffset']>[0];
  const off = g.laneOffset(link, lane);
  return !bus && lane === l.lanes - 1 && l.lanes - g.minLane(link) >= 2 ? off + EDGE_ROOM : off;
};
/** Where a driver stops for a red: this far short of the junction node. */
export const STOP_LINE = 7;

/**
 * Stop lines crossed by every AiDriver since boot, and how many of them on red: the probe's proof
 * that traffic obeys the lights (`.scratch/order.mjs`). A line crossed on amber is legal - that is
 * a driver too close to stop when it changed.
 */
export const lineStats = { crossed: 0, onRed: 0, yields: 0, busStops: 0, lastStop: [0, 0] as number[] };

/**
 * Drives one traffic car along the lane graph: pure-pursuit steering at a lane-offset point ahead,
 * speed from the road class, the curve ahead and the lights, and the Intelligent Driver Model for
 * the gap to whatever is in front (another car or the player). It outputs the same analogue
 * DriveInput a gamepad would, so traffic runs on the player's exact physics.
 */
export class AiDriver {
  link: number;
  s: number;
  lane: number;
  private queue: number[] = [];
  mode: 'drive' | 'shaken' | 'lost' = 'drive';
  /** A getaway driver: target speed multiplier, and no stopping for red lights. */
  boost = 1;
  reckless = false;
  /** A rider (an electric scooter): its own top speed, m/s, and it keeps to the right-hand kerb, `kerb` m in from it. */
  vmax = Infinity;
  kerb = 0;
  /** Seconds left pulled over to the kerb for a police car with its siren on (set by traffic/). */
  yieldT = 0;
  /** Metres moved right of the lane towards the kerb while yielding (eased in and out). */
  private shift = 0;
  /**
   * A bus's next stop on this link (set by traffic/ from the shelters nearby): it pulls in to the kerb,
   * stops at `s` and waits `dwell` seconds, then pulls out; `busCool` seconds before it takes another.
   */
  busStop: { s: number; dwell: number } | null = null;
  /** 公交进站、出站（audio/ 放报站，2026-11-09）：1 刚停稳，2 刚起步；traffic/ 读了就清。 */
  busEvent: 0 | 1 | 2 = 0;
  private dwelt = false;
  busCool = 0;
  /** 公交：一直走最靠右的车道（进站才靠得到站台）。traffic/ 造司机的时候设。 */
  kerbside = false;
  /** Standing at its stop this step (a bus at a shelter; a taxi pulled over for a fare, travel/Ride.ts). */
  atStop = false;
  /** The light at the end of its link is red this step. */
  red = false;
  /**
   * 电动车抢灯（2026-11-11，A6「绿灯头几秒电动车一拥而上」）：自己这边再过 `eager` 秒就绿了，现在就走；等红灯时停在汽车
   * 停车线前面 `ahead` 米。汽车都是 0。
   */
  eager = 0; ahead = 0;
  /** 前面路口要往哪边拐（+1 左、-1 右、0 直行）：进路口前 45 米起，traffic/ 拿它打转向灯。 */
  turn = 0;
  /**
   * 变道是慢慢并过去的：`slide` 是这会儿离新车道中线还差多少米（带符号，往左为正），每秒收 1.3 米。一下子把目标换到
   * 新车道，车速十几米每秒时两秒就横着甩过去 3 米多，冲过头蹭上中央护栏（2026-11-11 探针里撞飞过护栏）。
   */
  private slide = 0;
  changeLane(lane: number): void {
    const l = this.g.links[this.link];
    this.slide += driveOffset(this.g, l, this.lane, this.kerbside) - driveOffset(this.g, l, lane, this.kerbside);
    this.lane = lane;
  }
  /** 路况（traffic/ 设，Flow.ts）：这段路现在开得到限速的几成。 */
  static pace: (link: number) => number = () => 1;
  /** 有客的出租车照着走的路（`follow`）：还没进队列的路段，按顺序。走完了又随便开。 */
  private plan: number[] = [];
  private timer = 0;
  stuck = 0;
  lateral = 0;
  readonly input: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: false };
  private p = { x: 0, z: 0, dx: 0, dz: 0 };
  private q = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Where the car was last step, for counting stop lines crossed (`lineStats`). */
  private lineLink = -1; private lineToEnd = 0;

  constructor(private g: LaneGraph, private sig: Signals, link: number, s: number, lane: number, private rnd: () => number) {
    this.link = link; this.s = s; this.lane = g.laneOn(g.links[link], lane);
    this.fill();
  }

  /** The link after this one (-1 where the road ends): the distant traffic looks there for the car in front. */
  get nextLink(): number { return this.queue.length ? this.queue[0] : -1; }
  /** 接着一辆轻量车已经选好的下一段路走（Ghosts.ts 交接过来时它可能已经在往那边拐了）。 */
  seed(next: number): void { if (next >= 0 && next !== this.link) { this.queue = [next]; this.fill(); } }
  /**
   * 照一条路线开（nav/Router 的 `routeFrom`：第一段是现在这段）。路线上相邻两段要接得上，不然从接不上的地方起随便开。
   * 空数组：不照路线了。
   */
  follow(links: readonly number[]): void {
    const at = links.indexOf(this.link);
    this.plan = at >= 0 ? links.slice(at + 1) : [];
    this.queue = []; this.planned = 0;
    this.fill();
  }
  /**
   * 沿着要走的路往前 `ahead` 米处（车要被挪到那儿：有客的出租车卡死了，traffic/ 的 `FareCar.hop`）。`ok` 看那儿行不行
   * （车道上的位置和朝向、哪段路的多少米）；行就把司机也挪过去，返回 true。
   */
  hop(ahead: number, ok: (at: { x: number; z: number; dx: number; dz: number }, link: number, s: number) => boolean): boolean {
    let l = this.g.links[this.link], s = this.s + ahead, i = 0;
    while (s > l.len && i < this.queue.length) { s -= l.len; l = this.g.links[this.queue[i++]]; }
    if (s > l.len - 2) return false;
    const lane = this.g.laneOn(l, this.kerbside ? 7 : this.lane);
    this.g.at(l, s, this.g.laneOffset(l, lane), this.p);
    if (!ok(this.p, l.id, s)) return false;
    this.link = l.id; this.s = s; this.lane = lane;
    this.queue.splice(0, i); this.planned = Math.max(0, this.planned - i);
    this.busStop = null; this.stuck = 0; this.shift = 0;
    this.fill();
    return true;
  }
  /** 路线上还没开到的路段数（队列里的也算）；0 是已经在最后一段上，或者没有路线。 */
  get planLeft(): number { return this.plan.length + this.planned; }
  private planned = 0;

  private fill(): void {
    // Stops short where the road ends: `next` has nothing to give, the queue stays short, and the
    // driver brakes for the end of the link as for a red light, then reports itself lost.
    while (this.queue.length < 3) {
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.link;
      if (this.plan.length) {
        const p = this.plan.shift()!;
        if (this.g.links[p]?.from === this.g.links[last].to) { this.queue.push(p); this.planned++; continue; }
        this.plan.length = 0; this.planned = 0;   // 接不上：路线作废
      }
      const n = this.g.next(last, this.rnd);
      if (n < 0 || n === last) break;
      this.queue.push(n);
    }
  }

  /** Point `ahead` metres along the path (current link, then the queue) at this car's lane. */
  private along(ahead: number, out: { x: number; z: number; dx: number; dz: number }): void {
    let l = this.g.links[this.link], s = this.s + ahead, i = 0;
    while (s > l.len && i < this.queue.length) { s -= l.len; l = this.g.links[this.queue[i++]]; }
    const lane = this.g.laneOn(l, this.kerbside ? 7 : this.lane), off = driveOffset(this.g, l, lane, this.kerbside) + this.slide;
    // Pulled over: towards the right kerb (or the cars parked along it), never past a car's half width inside it.
    this.g.at(l, s, this.kerb > 0 ? -l.kerbR + this.kerb : Math.min(off, Math.max(-l.kerbR + 1.3, off - this.shift)), out);
  }

  /**
   * Whether a shelter at (x, z) stands at this link's right-hand kerb between `min` and `max` m ahead of
   * the car: its arc length on the link, or -1.
   */
  stopAhead(x: number, z: number, min: number, max: number): number {
    const l = this.g.links[this.link];
    let best = -1, bd = Infinity;
    for (let k = 1; k < l.cum.length; k++) {
      const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], bx = l.pts[k * 2], bz = l.pts[k * 2 + 1];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
      if (d >= bd) continue;
      // right of travel is (-vz, vx): left is (vz, -vx) (LaneGraph.at). 2026-11-11: this had the sign the other way
      // round, so a bus stopped for the shelters across the road and never for the one at its own kerb.
      const right = ((z - pz) * vx - (x - px) * vz) / Math.sqrt(L2);
      bd = d;
      best = right > 0 && d < l.hw + 7 ? l.cum[k - 1] + t * Math.sqrt(L2) : -1;
    }
    return best >= 0 && best - this.s > min && best - this.s < max && best < l.len - 8 ? best : -1;
  }

  /** Called when the car hit something hard. */
  shake(): void { if (this.mode === 'drive') { this.mode = 'shaken'; this.timer = 2 + this.rnd() * 2; } }

  update(car: Vehicle, dt: number, t: number, leader: Leader | null): DriveInput {
    const g = this.g;
    let l = g.links[this.link];
    this.atStop = false;
    const pr = g.project(l, car.pos.x, car.pos.z, this.s);
    this.s = pr.s;
    this.lateral = pr.d;
    // Onto the next link(s) the car has reached. Bounded: a car cannot honestly pass more than a few
    // links in one step, and unbounded this loop hung the whole game at a one-way dead end - `next`
    // handed the same link back, the projection landed on its end again, and so on until the tab was
    // killed (2026-09-23, 「游戏死机了」). `fill` no longer feeds it such a link, and the cap makes
    // sure no other glitch in the data can hold the main thread either.
    let hops = 0;
    while (this.s > l.len - 0.3 && this.queue.length && hops++ < 6) {
      this.s -= l.len;
      this.busStop = null;   // a stop is held on its link
      this.link = this.queue.shift()!;
      if (this.planned > 0) this.planned--;
      l = g.links[this.link];
      this.lane = g.laneOn(l, this.kerbside ? 7 : this.lane);
      this.fill();
      this.s = g.project(l, car.pos.x, car.pos.z, Math.max(0, this.s)).s;
    }
    // The road ends with this link. At its end the car is done: stop, and let the pool take it
    // back once it is out of view.
    const ending = !this.queue.length;
    if (ending && l.len - this.s < 3) this.mode = 'lost';
    const v = Math.max(0, car.forwardSpeed);
    const inp = this.input;
    if (this.mode === 'shaken') {
      this.timer -= dt;
      inp.forward = 0; inp.back = v > 0.5 ? 1 : 0; inp.steer = 0;
      if (this.timer <= 0) this.mode = car.up.y > 0.8 && this.lateral < 6 ? 'drive' : 'lost';
      return inp;
    }
    if (this.mode === 'lost') { inp.forward = 0; inp.back = v > 0.5 ? 1 : 0; inp.steer = 0; return inp; }

    // Sirens behind: ease over to the kerb and crawl until they are past (GTA's traffic clears a lane).
    const yielding = this.yieldT > 0 && !this.reckless;
    this.yieldT = Math.max(0, this.yieldT - dt);
    this.busCool = Math.max(0, this.busCool - dt);
    const toStop = this.busStop ? this.busStop.s - this.s : Infinity;
    if (this.busStop && toStop < -3) this.busStop = null;   // gone past it (pushed, or the stop was behind)
    const pulling = !!this.busStop && toStop < 45;
    this.shift += ((yielding ? 3.2 : pulling ? 2.4 : 0) - this.shift) * Math.min(1, dt * 1.6);
    if (this.slide) this.slide -= Math.sign(this.slide) * Math.min(Math.abs(this.slide), 1.3 * dt);
    // Steering: pure pursuit on a point ahead at the lane offset.
    const look = Math.max(6, Math.min(24, 4 + v * 0.8));
    this.along(look, this.p);
    const dx = this.p.x - car.pos.x, dz = this.p.z - car.pos.z;
    const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z;
    const kappa = 2 * lx / Math.max(1, lx * lx + lz * lz);
    const wheel = Math.atan(kappa * car.wheelbase);
    inp.steer = Math.max(-1, Math.min(1, -wheel / Math.max(0.05, car.maxSteerAngle(v))));

    // Target speed: road class, the turn within the next ~45 m, then the light at the end.
    let vt = yielding ? Math.min(l.speed, 3.5) : Math.min(this.vmax, l.speed * this.boost * (this.reckless ? 1 : AiDriver.pace(this.link)));
    this.along(Math.max(8, v * 1.2), this.q);
    const h0x = this.q.dx, h0z = this.q.dz;
    this.along(Math.max(8, v * 1.2) + 28, this.q);
    const turn = Math.acos(Math.max(-1, Math.min(1, h0x * this.q.dx + h0z * this.q.dz)));
    if (turn > 0.12) vt = Math.min(vt, Math.sqrt(2.6 * 28 / turn));
    const toEnd = l.len - this.s;
    // Brake for the end of a road that ends, as for a red light at it.
    if (ending) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 2.6 * (toEnd - 1.5))));
    const real: Light = this.sig.state(l, t);
    // 抢灯的把「马上就绿」当绿灯
    const light: Light = real === 2 && this.eager > 0 && this.sig.state(l, t + this.eager) === 0 ? 0 : real;
    this.red = real === 2;
    const line = STOP_LINE - this.ahead;
    const stopAt = toEnd - line;
    this.turn = 0;
    if (this.queue.length && toEnd < 45) {
      const nl = g.links[this.queue[0]];
      if (l.d1x * nl.d0x + l.d1z * nl.d0z < 0.878) this.turn = nl.d0x * l.d1z - nl.d0z * l.d1x > 0 ? 1 : -1;   // 拐过 0.5 弧度；左手方向是 (dz, -dx)
    }
    if (this.lineLink === this.link && this.lineToEnd > line && toEnd <= line && this.sig.junctionOf(l.to) >= 0) {
      lineStats.crossed++;
      if (light === 2) lineStats.onRed++;
    }
    this.lineLink = this.link; this.lineToEnd = toEnd;
    if (light !== 0 && stopAt > -0.5 && !this.reckless) {
      const canStop = v * v / (2 * 4.5) < stopAt + 0.5;
      if (light === 2 || canStop) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 2.6 * Math.max(0, stopAt - 0.8))));
    }
    // A bus pulling in: brake to its stop, wait there, then go on.
    let dwelling = false;
    if (this.busStop) {
      vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 1.8 * Math.max(0, toStop - 0.5))));
      if (toStop < 2.5 && v < 0.5) {
        dwelling = true; this.atStop = true; lineStats.lastStop = [car.pos.x, car.pos.z]; this.busStop.dwell -= dt;
        if (!this.dwelt) { this.dwelt = true; this.busEvent = 1; }
        if (this.busStop.dwell <= 0) { this.busStop = null; this.busCool = 30; lineStats.busStops++; this.dwelt = false; this.busEvent = 2; }
      }
    } else this.dwelt = false;
    // IDM with the car in front.
    let a = A_MAX * (1 - Math.pow(v / Math.max(0.5, vt), 4));
    if (vt < 0.3) a = -B_COMF * 2;
    if (leader) {
      const gap = Math.max(0.1, leader.gap - CAR_LEN);
      const sStar = S0 + v * HEADWAY + v * (v - leader.speed) / (2 * Math.sqrt(A_MAX * B_COMF));
      a -= A_MAX * (sStar / gap) ** 2;
    }
    if (a >= 0) { inp.forward = Math.min(1, 0.12 + a / 2.2); inp.back = 0; }
    else if (v > 0.6) { inp.forward = 0; inp.back = Math.min(1, -a / 7); }
    else { inp.forward = 0; inp.back = 0; }   // stopped: the car's own hold keeps it there (never reverse)
    this.stuck = v < 0.4 && light === 0 && !dwelling && (!leader || leader.gap > 14) ? this.stuck + dt : 0;
    return inp;
  }
}
