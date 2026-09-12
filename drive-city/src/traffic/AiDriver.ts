import type { DriveInput } from '../vehicle/ControlFilter';
import type { Vehicle } from '../vehicle/Vehicle';
import type { LaneGraph } from './LaneGraph';
import type { Light, Signals } from './Signals';

export interface Leader { gap: number; speed: number }

const A_MAX = 2.2, B_COMF = 3.2, S0 = 3, HEADWAY = 1.25, CAR_LEN = 4.6;

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
  private timer = 0;
  stuck = 0;
  lateral = 0;
  readonly input: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: false };
  private p = { x: 0, z: 0, dx: 0, dz: 0 };
  private q = { x: 0, z: 0, dx: 0, dz: 0 };

  constructor(private g: LaneGraph, private sig: Signals, link: number, s: number, lane: number, private rnd: () => number) {
    this.link = link; this.s = s; this.lane = lane;
    this.fill();
  }

  private fill(): void {
    while (this.queue.length < 3) this.queue.push(this.g.next(this.queue.length ? this.queue[this.queue.length - 1] : this.link, this.rnd));
  }

  /** Point `ahead` metres along the path (current link, then the queue) at this car's lane. */
  private along(ahead: number, out: { x: number; z: number; dx: number; dz: number }): void {
    let l = this.g.links[this.link], s = this.s + ahead, i = 0;
    while (s > l.len && i < this.queue.length) { s -= l.len; l = this.g.links[this.queue[i++]]; }
    const lane = Math.min(this.lane, l.lanes - 1);
    this.g.at(l, s, this.g.laneOffset(l, lane), out);
  }

  /** Called when the car hit something hard. */
  shake(): void { if (this.mode === 'drive') { this.mode = 'shaken'; this.timer = 2 + this.rnd() * 2; } }

  update(car: Vehicle, dt: number, t: number, leader: Leader | null): DriveInput {
    const g = this.g;
    let l = g.links[this.link];
    const pr = g.project(l, car.pos.x, car.pos.z, this.s);
    this.s = pr.s;
    this.lateral = pr.d;
    while (this.s > l.len - 0.3 && this.queue.length) {
      this.s -= l.len;
      this.link = this.queue.shift()!;
      l = g.links[this.link];
      if (this.lane >= l.lanes) this.lane = l.lanes - 1;
      this.fill();
      this.s = g.project(l, car.pos.x, car.pos.z, Math.max(0, this.s)).s;
    }
    const v = Math.max(0, car.forwardSpeed);
    const inp = this.input;
    if (this.mode === 'shaken') {
      this.timer -= dt;
      inp.forward = 0; inp.back = v > 0.5 ? 1 : 0; inp.steer = 0;
      if (this.timer <= 0) this.mode = car.up.y > 0.8 && this.lateral < 6 ? 'drive' : 'lost';
      return inp;
    }
    if (this.mode === 'lost') { inp.forward = 0; inp.back = v > 0.5 ? 1 : 0; inp.steer = 0; return inp; }

    // Steering: pure pursuit on a point ahead at the lane offset.
    const look = Math.max(6, Math.min(24, 4 + v * 0.8));
    this.along(look, this.p);
    const dx = this.p.x - car.pos.x, dz = this.p.z - car.pos.z;
    const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z;
    const kappa = 2 * lx / Math.max(1, lx * lx + lz * lz);
    const wheel = Math.atan(kappa * car.wheelbase);
    inp.steer = Math.max(-1, Math.min(1, -wheel / Math.max(0.05, car.maxSteerAngle(v))));

    // Target speed: road class, the turn within the next ~45 m, then the light at the end.
    let vt = l.speed;
    this.along(Math.max(8, v * 1.2), this.q);
    const h0x = this.q.dx, h0z = this.q.dz;
    this.along(Math.max(8, v * 1.2) + 28, this.q);
    const turn = Math.acos(Math.max(-1, Math.min(1, h0x * this.q.dx + h0z * this.q.dz)));
    if (turn > 0.12) vt = Math.min(vt, Math.sqrt(2.6 * 28 / turn));
    const toEnd = l.len - this.s;
    const light: Light = this.sig.state(l, t);
    const stopAt = toEnd - 7;
    if (light !== 0 && stopAt > -0.5) {
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
