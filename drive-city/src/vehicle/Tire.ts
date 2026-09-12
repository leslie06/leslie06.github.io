/**
 * Tyre and drivetrain curves. Pure functions so they can be tested and plotted without physics.
 */

/**
 * Normalised lateral force for a slip angle (rad): Pacejka's magic formula with E = 0.
 * Rises linearly (cornering stiffness B*C), peaks at `peakSlip`, then falls to sin(C*pi/2) of peak
 * as the tyre slides. That fall-off is what makes a slide self-sustaining but catchable: a tyre that
 * kept its peak grip past the limit would snap straight back, one that lost it all would spin.
 */
export function lateralCurve(alpha: number, B: number, C: number): number {
  return Math.sin(C * Math.atan(B * alpha));
}

/** Slip angle (rad) at which `lateralCurve` peaks. */
export function peakSlip(B: number, C: number): number {
  return Math.tan(Math.PI / (2 * C)) / B;
}

/** Grip left once the tyre is fully sliding, as a fraction of peak. */
export function slideFraction(C: number): number {
  return Math.sin(C * Math.PI / 2);
}

/**
 * Fit a longitudinal/lateral force pair inside the friction ellipse, longitudinal first.
 * Drive and brake forces are clipped to their own limit, and the lateral force gets what is left:
 * a rear tyre spending most of its grip on putting power down has little left for cornering, which
 * is where power oversteer comes from.
 */
export function combine(fx: number, fy: number, fxMax: number, fyMax: number, out: { x: number; y: number }): { x: number; y: number } {
  if (fxMax <= 0 || fyMax <= 0) { out.x = 0; out.y = 0; return out; }
  const x = Math.max(-fxMax, Math.min(fxMax, fx));
  const u = x / fxMax;
  const yAvail = fyMax * Math.sqrt(Math.max(0, 1 - u * u));
  out.x = x;
  out.y = Math.max(-yAvail, Math.min(yAvail, fy));
  return out;
}

/** Linear interpolation over an [rpm, Nm] table, clamped at both ends. */
export function torqueAt(curve: readonly (readonly [number, number])[], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function approach(v: number, target: number, maxDelta: number): number {
  return v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);
}
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
