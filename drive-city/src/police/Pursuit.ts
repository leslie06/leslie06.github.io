import type { DriveInput } from '../vehicle/ControlFilter';
import type { Vehicle } from '../vehicle/Vehicle';

export interface Goal { x: number; z: number; vx: number; vz: number }
export type Router = (fromX: number, fromZ: number, heading: number, toX: number, toZ: number) => { pts: Float32Array; len: number } | null;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * A police driver. Straight at the player (with a lead on their velocity) when it can see them up
 * close, otherwise along a road route to where it wants to be. Flat out on straights, lifts for
 * the corners ahead, matches the player's speed at the end so it boxes them in rather than bouncing
 * off, and backs out of walls. Outputs the analogue input a gamepad would: police run on the
 * player's physics.
 */
export class Pursuit {
  readonly input: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: false };
  /** m/s. */
  topSpeed = 32;
  stuck = 0;
  private path: Float32Array | null = null;
  private pathAge = 99;
  private gx = 0; private gz = 0;
  private idx = 0;
  private reverse = 0;
  private lastSteer = 0;
  private a = { x: 0, z: 0 }; private b = { x: 0, z: 0 };

  reset(): void { this.path = null; this.pathAge = 99; this.idx = 0; this.reverse = 0; this.stuck = 0; }

  /** Point `dist` metres along the path from (x, z), via the vertices after the nearest one. */
  private walk(x: number, z: number, dist: number, out: { x: number; z: number }): void {
    const p = this.path!, n = p.length / 2;
    let cx = x, cz = z, left = dist;
    for (let j = this.idx + 1; j < n; j++) {
      const nx = p[j * 2], nz = p[j * 2 + 1], L = Math.hypot(nx - cx, nz - cz);
      if (L >= left) { const k = left / Math.max(1e-6, L); out.x = cx + (nx - cx) * k; out.z = cz + (nz - cz) * k; return; }
      left -= L; cx = nx; cz = nz;
    }
    out.x = p[(n - 1) * 2]; out.z = p[(n - 1) * 2 + 1];
  }

  update(car: Vehicle, goal: Goal, direct: boolean, dt: number, route: Router | null, gentle: boolean): DriveInput {
    const inp = this.input;
    const v = Math.max(0, car.forwardSpeed);
    this.pathAge += dt;
    if (this.reverse > 0) {
      this.reverse -= dt;
      inp.forward = 0; inp.back = 1; inp.steer = -this.lastSteer; inp.handbrake = false;
      return inp;
    }
    const dist = Math.hypot(goal.x - car.pos.x, goal.z - car.pos.z);
    let ax = goal.x, az = goal.z, vt = this.topSpeed;
    if (!direct && route) {
      if (!this.path || this.pathAge > 1.5 || Math.hypot(goal.x - this.gx, goal.z - this.gz) > 25) {
        this.path = route(car.pos.x, car.pos.z, Math.atan2(car.fwd.x, car.fwd.z), goal.x, goal.z)?.pts ?? null;
        this.idx = 0; this.pathAge = 0; this.gx = goal.x; this.gz = goal.z;
      }
    } else this.path = null;
    if (this.path && this.path.length >= 4) {
      const p = this.path, n = p.length / 2;
      const d2 = (i: number) => (p[i * 2] - car.pos.x) ** 2 + (p[i * 2 + 1] - car.pos.z) ** 2;
      while (this.idx + 1 < n && d2(this.idx + 1) <= d2(this.idx)) this.idx++;
      const look = clamp(5 + v * 0.7, 8, 30);
      this.walk(car.pos.x, car.pos.z, look, this.a);
      this.walk(car.pos.x, car.pos.z, look + 25, this.b);
      ax = this.a.x; az = this.a.z;
      const h1 = Math.atan2(ax - car.pos.x, az - car.pos.z), h2 = Math.atan2(this.b.x - ax, this.b.z - az);
      let turn = Math.abs(h2 - h1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.15) vt = Math.min(vt, Math.sqrt(8 * 25 / turn));
    } else if (!direct) vt = Math.min(vt, 16);   // no route: straight for it, carefully
    else {
      const lead = Math.min(1.2, dist / Math.max(12, v));
      ax = goal.x + goal.vx * lead; az = goal.z + goal.vz * lead;
    }
    // Pure pursuit on the aim point (left of the car is +lx; the steer axis is right-positive).
    const rx = ax - car.pos.x, rz = az - car.pos.z;
    const lx = rx * car.left.x + rz * car.left.z, lz = rx * car.fwd.x + rz * car.fwd.z;
    let steer: number;
    if (lz < 0.5) { steer = lx > 0 ? -1 : 1; vt = Math.min(vt, 10); }
    else {
      const kappa = 2 * lx / Math.max(1, lx * lx + lz * lz);
      steer = clamp(-Math.atan(kappa * car.wheelbase) / Math.max(0.05, car.maxSteerAngle(v)), -1, 1);
      const ang = Math.atan2(Math.abs(lx), lz);
      if (ang > 0.35) vt = Math.min(vt, Math.max(9, this.topSpeed * Math.cos(ang)));
    }
    const gs = Math.hypot(goal.vx, goal.vz);
    if (direct && dist < 16) vt = Math.min(vt, gs + (gentle ? 1.5 : 6));
    // Up against a stopped player: stop and box them in (ramming would keep shoving them free).
    if (direct && dist < 9 && gs < 3) vt = 0;
    if (vt < 0.5) { inp.forward = 0; inp.back = v > 0.5 ? 1 : 0; inp.handbrake = v < 1; inp.steer = steer; this.lastSteer = steer; this.stuck = 0; return inp; }
    if (v < vt - 1) { inp.forward = 1; inp.back = 0; }
    else if (v > vt + 2) { inp.forward = 0; inp.back = clamp((v - vt) / 6, 0.2, 1); }
    else { inp.forward = 0.3; inp.back = 0; }
    inp.handbrake = false;
    inp.steer = steer; this.lastSteer = steer;
    if (inp.forward > 0.5 && car.speed < 1.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 0.5);
    if (this.stuck > 1.6) { this.stuck = 0; this.reverse = 1.3; }
    return inp;
  }
}
