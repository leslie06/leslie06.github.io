import type { DriveInput } from '../vehicle/ControlFilter';
import type { Vehicle } from '../vehicle/Vehicle';
import type { LaneGraph } from './LaneGraph';
import type { Light, Signals } from './Signals';

export interface Leader { gap: number; speed: number }

const A_MAX = 2.2, B_COMF = 3.2, S0 = 3, HEADWAY = 1.25, CAR_LEN = 4.6;
/** Where a driver stops for a red: this far short of the junction node. */
export const STOP_LINE = 7;

/**
 * Stop lines crossed by every AiDriver since boot, and how many of them on red: the probe's proof
 * that traffic obeys the lights (`.scratch/order.mjs`). A line crossed on amber is legal - that is
 * a driver too close to stop when it changed.
 */
export const lineStats = { crossed: 0, onRed: 0, yields: 0 };

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
  /** Seconds left pulled over to the kerb for a police car with its siren on (set by traffic/). */
  yieldT = 0;
  /** Metres moved right of the lane towards the kerb while yielding (eased in and out). */
  private shift = 0;
  private timer = 0;
  stuck = 0;
  lateral = 0;
  readonly input: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: false };
  private p = { x: 0, z: 0, dx: 0, dz: 0 };
  private q = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Where the car was last step, for counting stop lines crossed (`lineStats`). */
  private lineLink = -1; private lineToEnd = 0;

  constructor(private g: LaneGraph, private sig: Signals, link: number, s: number, lane: number, private rnd: () => number) {
    this.link = link; this.s = s; this.lane = lane;
    this.fill();
  }

  private fill(): void {
    // Stops short where the road ends: `next` has nothing to give, the queue stays short, and the
    // driver brakes for the end of the link as for a red light, then reports itself lost.
    while (this.queue.length < 3) {
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.link;
      const n = this.g.next(last, this.rnd);
      if (n < 0 || n === last) break;
      this.queue.push(n);
    }
  }

  /** Point `ahead` metres along the path (current link, then the queue) at this car's lane. */
  private along(ahead: number, out: { x: number; z: number; dx: number; dz: number }): void {
    let l = this.g.links[this.link], s = this.s + ahead, i = 0;
    while (s > l.len && i < this.queue.length) { s -= l.len; l = this.g.links[this.queue[i++]]; }
    const lane = Math.min(this.lane, l.lanes - 1), off = this.g.laneOffset(l, lane);
    // Pulled over: towards the right kerb, never past a car's half width inside it.
    this.g.at(l, s, Math.max(-l.hw + 1.3, off - this.shift), out);
  }

  /** Called when the car hit something hard. */
  shake(): void { if (this.mode === 'drive') { this.mode = 'shaken'; this.timer = 2 + this.rnd() * 2; } }

  update(car: Vehicle, dt: number, t: number, leader: Leader | null): DriveInput {
    const g = this.g;
    let l = g.links[this.link];
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
      this.link = this.queue.shift()!;
      l = g.links[this.link];
      if (this.lane >= l.lanes) this.lane = l.lanes - 1;
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
    this.shift += ((yielding ? 3.2 : 0) - this.shift) * Math.min(1, dt * 1.6);
    // Steering: pure pursuit on a point ahead at the lane offset.
    const look = Math.max(6, Math.min(24, 4 + v * 0.8));
    this.along(look, this.p);
    const dx = this.p.x - car.pos.x, dz = this.p.z - car.pos.z;
    const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z;
    const kappa = 2 * lx / Math.max(1, lx * lx + lz * lz);
    const wheel = Math.atan(kappa * car.wheelbase);
    inp.steer = Math.max(-1, Math.min(1, -wheel / Math.max(0.05, car.maxSteerAngle(v))));

    // Target speed: road class, the turn within the next ~45 m, then the light at the end.
    let vt = yielding ? Math.min(l.speed, 3.5) : l.speed * this.boost;
    this.along(Math.max(8, v * 1.2), this.q);
    const h0x = this.q.dx, h0z = this.q.dz;
    this.along(Math.max(8, v * 1.2) + 28, this.q);
    const turn = Math.acos(Math.max(-1, Math.min(1, h0x * this.q.dx + h0z * this.q.dz)));
    if (turn > 0.12) vt = Math.min(vt, Math.sqrt(2.6 * 28 / turn));
    const toEnd = l.len - this.s;
    // Brake for the end of a road that ends, as for a red light at it.
    if (ending) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 2.6 * (toEnd - 1.5))));
    const light: Light = this.sig.state(l, t);
    const stopAt = toEnd - STOP_LINE;
    if (this.lineLink === this.link && this.lineToEnd > STOP_LINE && toEnd <= STOP_LINE && this.sig.junctionOf(l.to) >= 0) {
      lineStats.crossed++;
      if (light === 2) lineStats.onRed++;
    }
    this.lineLink = this.link; this.lineToEnd = toEnd;
    if (light !== 0 && stopAt > -0.5 && !this.reckless) {
      const canStop = v * v / (2 * 4.5) < stopAt + 0.5;
      if (light === 2 || canStop) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 2.6 * Math.max(0, stopAt - 0.8))));
    }
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
    this.stuck = v < 0.4 && light === 0 && (!leader || leader.gap > 14) ? this.stuck + dt : 0;
    return inp;
  }
}
