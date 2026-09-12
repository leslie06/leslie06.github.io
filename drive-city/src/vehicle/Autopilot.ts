import { clamp, wrapAngle } from './Tire';
import type { DriveInput } from './ControlFilter';

/** What the pilot needs to know about the car, in world XZ. */
export interface PilotView {
  x: number; z: number;
  /** Heading of the car's nose: atan2(fwd.x, fwd.z). */
  yaw: number;
  vx: number; vz: number;
  forwardSpeed: number;
  /** + when the car moves to the right of where it points. */
  bodySlip: number;
  /** Max road-wheel angle the car allows at its current speed (rad). */
  maxSteer: number;
  wheelbase: number;
}

export interface PilotOptions {
  /** Target speed (m/s), optionally per path point. */
  speed: number | ((i: number) => number);
  lookahead: number;
  closed: boolean;
  /**
   * Drift mode: tap the handbrake at `entries`, ride the throttle to hold `slip` (rad), and re-tap
   * inside `kickZones` (index ranges) whenever the slide has died below `rekick`.
   */
  drift?: { entries: number[]; tap: number; slip: number; rekick?: number; kickZones?: [number, number][] };
}

/**
 * Pure-pursuit driver for tests, screenshots and the attract loop. Steers at a point `lookahead`
 * metres up the path, measured from the direction the car is actually travelling rather than the
 * way its nose points, so it keeps working while the car is sideways.
 */
export class PathPilot {
  private idx = 0;
  private handbrakeT = 0;
  private lastEntry = -1;
  private sinceTap = 99;
  /** Arc length covered, metres (for lap counting). */
  travelled = 0;
  crossTrack = 0;
  readonly length: number;
  private seg: number[];
  readonly out: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: false };

  constructor(readonly path: [number, number][], readonly opts: PilotOptions) {
    this.seg = path.map((p, i) => {
      const q = path[(i + 1) % path.length];
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    this.length = this.seg.reduce((a, b) => a + b, 0) - (opts.closed ? 0 : this.seg[this.seg.length - 1]);
  }

  get index(): number { return this.idx; }

  /** +1 if the path ahead of `i` bends right, -1 if left (steer sign convention: right positive). */
  private turnSign(i: number): number {
    const n = this.path.length;
    const a = this.path[i], b = this.path[(i + 4) % n], c = this.path[(i + 8) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    // With +X to the car's left when facing +Z, a path bending towards +X (left) gives cross < 0.
    return cross > 0 ? 1 : -1;
  }
  get laps(): number { return this.travelled / this.length; }

  update(v: PilotView, dt: number): DriveInput {
    const n = this.path.length;
    // Advance the nearest-point index within a forward window (paths may cross themselves).
    let best = this.idx, bestD = Infinity;
    for (let k = -3; k <= 25; k++) {
      let j = this.idx + k;
      if (this.opts.closed) j = ((j % n) + n) % n; else j = clamp(j, 0, n - 1);
      const p = this.path[j];
      const d = (p[0] - v.x) ** 2 + (p[1] - v.z) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    // Arc length moved: forward steps add, backward steps (the window allows 3) subtract.
    const ahead = this.opts.closed ? ((best - this.idx) % n + n) % n : best - this.idx;
    if (ahead >= 0 && ahead <= 25) {
      for (let k = 0, j = this.idx; k < ahead; k++, j = (j + 1) % n) this.travelled += this.seg[j];
    } else {
      const back = this.opts.closed ? n - ahead : -ahead;
      for (let k = 0, j = this.idx; k < back; k++) { j = (j - 1 + n) % n; this.travelled -= this.seg[j]; }
    }
    this.idx = best;
    this.crossTrack = Math.sqrt(bestD);

    // Lookahead point.
    let acc = 0, t = best;
    while (acc < this.opts.lookahead) {
      acc += this.seg[t];
      const nt = t + 1;
      if (nt >= n) { if (!this.opts.closed) break; t = 0; } else t = nt;
    }
    const target = this.path[t];
    const speed = Math.hypot(v.vx, v.vz);
    const ref = speed > 3 && v.forwardSpeed > 0 ? Math.atan2(v.vx, v.vz) : v.yaw;
    const dx = target[0] - v.x, dz = target[1] - v.z;
    const theta = wrapAngle(Math.atan2(dx, dz) - ref);   // + = target to the left
    const L = Math.max(4, Math.hypot(dx, dz));
    const curvature = 2 * Math.sin(theta) / L;
    const wheel = Math.atan(curvature * v.wheelbase);    // left-positive road-wheel angle
    let steer = clamp(-wheel / Math.max(0.05, v.maxSteer), -1, 1);

    const vt = typeof this.opts.speed === 'function' ? this.opts.speed(best) : this.opts.speed;
    const err = vt - v.forwardSpeed;
    let throttle = clamp(0.35 + err * 0.4, 0, 1);
    let brake = err < -2.5 ? clamp(-err * 0.15, 0, 1) : 0;
    let handbrake = false;

    const d = this.opts.drift;
    if (d) {
      this.sinceTap += dt;
      for (const e of d.entries) {
        const ahead = ((best - e) % n + n) % n;
        if (ahead < 4 && this.lastEntry !== e) {
          this.lastEntry = e;
          // Already swinging the other way through the crossing: the pendulum does the work.
          if (speed > 9 && Math.abs(v.bodySlip) < 0.2) { this.handbrakeT = d.tap; this.sinceTap = 0; }
        }
      }
      const inZone = (d.kickZones ?? []).some(([a, b]) => best >= a && best <= b);
      if (inZone && this.handbrakeT <= 0 && Math.abs(v.bodySlip) < (d.rekick ?? 0) && speed > 9 && this.sinceTap > 0.9 && this.crossTrack < 3) {
        this.handbrakeT = d.tap * 0.6; this.sinceTap = 0;
      }
      if (this.handbrakeT > 0) {
        // Yank it with the wheel turned into the corner, as a player would.
        this.handbrakeT -= dt; handbrake = true; throttle = 0.5; brake = 0;
        steer = this.turnSign(best) * 1;
      }
      else if (Math.abs(v.bodySlip) > 0.15) {
        // Ride the slide: throttle holds the angle, steering keeps the line.
        // Off the line: ask for less angle, and past 5 m give up the slide to get back on it.
        const want = d.slip * clamp(1 - (this.crossTrack - 2) / 4, 0, 1);
        // Leaving a slide means lifting completely: in first gear even half throttle keeps the
        // rear tyres spinning.
        throttle = want > 0.05 ? clamp(0.72 + (want - Math.abs(v.bodySlip)) * 2 + err * 0.05, 0.2, 1) : 0.05;
        brake = 0;
      }
    }
    const o = this.out;
    o.forward = throttle; o.back = brake; o.steer = steer; o.handbrake = handbrake; o.analog = true;
    return o;
  }
}

/** Figure-eight through (cx, cz): two circles of radius r touching there, both driven along +X at the crossing. */
export function figureEight(cx: number, cz: number, r: number, perCircle = 120): [number, number][] {
  const pts: [number, number][] = [];
  // Circle A (centre below the crossing), clockwise from its top.
  for (let i = 0; i < perCircle; i++) {
    const a = Math.PI / 2 - (i / perCircle) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cz - r + r * Math.sin(a)]);
  }
  // Circle B (centre above the crossing), counter-clockwise from its bottom.
  for (let i = 0; i < perCircle; i++) {
    const a = -Math.PI / 2 + (i / perCircle) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cz + r + r * Math.sin(a)]);
  }
  return pts;
}
