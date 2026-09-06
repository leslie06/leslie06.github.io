/**
 * Frame-rate independent spring / damping math for camera feel.
 * Pure functions, no three.js dependency, unit-tested in Spring.test.ts.
 */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/**
 * Exponential approach: moves `current` toward `target` so that the remaining distance
 * decays by e^-lambda per second regardless of frame rate. lambda ~ 1/(time constant).
 */
export function expDamp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Same as expDamp but takes the shortest path around a circle (radians). */
export function expDampAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
}

export interface SpringCoefs { pp: number; pv: number; vp: number; vv: number }

/**
 * Closed-form damped harmonic oscillator coefficients (after Ryan Juckett's "Damped Springs").
 * Exact for any dt, so 1 step of 0.1s equals 10 steps of 0.01s: no frame-rate dependence.
 * @param omega natural angular frequency (rad/s) — how fast it reacts
 * @param zeta damping ratio: <1 bouncy, 1 critical, >1 sluggish
 */
export function springCoefs(omega: number, zeta: number, dt: number): SpringCoefs {
  if (omega < 1e-6 || dt <= 0) return { pp: 1, pv: dt, vp: 0, vv: 1 };
  zeta = Math.max(0, zeta);
  if (zeta > 1 + 1e-6) {
    const za = -omega * zeta, zb = omega * Math.sqrt(zeta * zeta - 1);
    const z1 = za - zb, z2 = za + zb;
    const e1 = Math.exp(z1 * dt), e2 = Math.exp(z2 * dt);
    const inv2zb = 1 / (2 * zb);
    const e1o = e1 * inv2zb, e2o = e2 * inv2zb;
    const z1e1o = z1 * e1o, z2e2o = z2 * e2o;
    return {
      pp: e1o * z2 - z2e2o + e2,
      pv: -e1o + e2o,
      vp: (z1e1o - z2e2o + e2) * z2,
      vv: -z1e1o + z2e2o,
    };
  }
  if (zeta > 1 - 1e-6) {
    const e = Math.exp(-omega * dt);
    const te = dt * e, tef = te * omega;
    return { pp: tef + e, pv: te, vp: -omega * tef, vv: -tef + e };
  }
  const oz = omega * zeta;
  const alpha = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-oz * dt);
  const c = Math.cos(alpha * dt), s = Math.sin(alpha * dt);
  const invA = 1 / alpha;
  const es = e * s, ec = e * c;
  const eozs = e * oz * s * invA;
  return { pp: ec + eozs, pv: es * invA, vp: -es * alpha - oz * eozs, vv: ec - eozs };
}

/** One scalar spring state. Mutated in place by `step`. */
export class Spring1 {
  x = 0; v = 0;
  constructor(public omega = 20, public zeta = 0.6) {}
  step(target: number, dt: number): number {
    const c = springCoefs(this.omega, this.zeta, dt);
    const dx = this.x - target, dv = this.v;
    this.x = dx * c.pp + dv * c.pv + target;
    this.v = dx * c.vp + dv * c.vv;
    return this.x;
  }
  kick(impulse: number): void { this.v += impulse; }
  reset(x = 0): void { this.x = x; this.v = 0; }
}

/** Three independent springs sharing coefficients (pitch/yaw/roll or x/y/z). */
export class Spring3 {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  constructor(public omega = 20, public zeta = 0.6) {}
  step(tx: number, ty: number, tz: number, dt: number): void {
    const c = springCoefs(this.omega, this.zeta, dt);
    let dx = this.x - tx, dv = this.vx; this.x = dx * c.pp + dv * c.pv + tx; this.vx = dx * c.vp + dv * c.vv;
    dx = this.y - ty; dv = this.vy; this.y = dx * c.pp + dv * c.pv + ty; this.vy = dx * c.vp + dv * c.vv;
    dx = this.z - tz; dv = this.vz; this.z = dx * c.pp + dv * c.pv + tz; this.vz = dx * c.vp + dv * c.vv;
  }
  kick(ix: number, iy: number, iz: number): void { this.vx += ix; this.vy += iy; this.vz += iz; }
  add(dx: number, dy: number, dz: number): void { this.x += dx; this.y += dy; this.z += dz; }
  reset(): void { this.x = this.y = this.z = this.vx = this.vy = this.vz = 0; }
}

/**
 * Smooth, deterministic 1D noise in [-1, 1] built from incommensurate sines.
 * Used for camera shake; same `t` always gives the same value (shot mode is deterministic).
 */
export function noise1(t: number, seed = 0): number {
  const s = seed * 12.9898;
  return (Math.sin(t * 1.0 + s) * 0.5 + Math.sin(t * 2.3 + 1.3 + s) * 0.3 + Math.sin(t * 5.1 + 2.1 + s) * 0.2);
}
