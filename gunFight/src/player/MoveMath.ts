/**
 * Pure movement helpers (no physics engine, no three.js) so the feel can be unit-tested.
 * Vectors are plain {x,y,z} objects mutated in place where noted.
 */
export interface V3 { x: number; y: number; z: number }

/** Ground friction: exponential-ish drop with a floor so we come to a full stop (Quake style). */
export function applyFriction(hv: V3, friction: number, stopSpeed: number, dt: number): void {
  const sp = Math.hypot(hv.x, hv.z);
  if (sp < 1e-6) { hv.x = hv.z = 0; return; }
  const control = Math.max(sp, stopSpeed);
  const drop = control * friction * dt;
  const ns = Math.max(0, sp - drop) / sp;
  hv.x *= ns; hv.z *= ns;
}

/**
 * Accelerate toward `wish` (unit or zero) up to `maxSpeed` in that direction.
 * `accel` is in units of maxSpeed per second, so 10 means "reach full speed in ~0.1 s".
 */
export function accelerate(hv: V3, wish: V3, maxSpeed: number, accel: number, dt: number): void {
  const cur = hv.x * wish.x + hv.z * wish.z;
  const add = maxSpeed - cur;
  if (add <= 0) return;
  const step = Math.min(accel * maxSpeed * dt, add);
  hv.x += wish.x * step; hv.z += wish.z * step;
}

/** Cap horizontal speed without changing direction. */
export function capSpeed(hv: V3, max: number): void {
  const sp = Math.hypot(hv.x, hv.z);
  if (sp > max && sp > 1e-6) { const k = max / sp; hv.x *= k; hv.z *= k; }
}

/** Remove the velocity component going into a surface (no bounce, no sticking). */
export function clipVelocity(v: V3, n: V3, overbounce = 1.0): void {
  const into = v.x * n.x + v.y * n.y + v.z * n.z;
  if (into >= 0) return;
  v.x -= n.x * into * overbounce; v.y -= n.y * into * overbounce; v.z -= n.z * into * overbounce;
}

/**
 * Stair smoothing: when the feet snap up/down a step while grounded on flat ground, the camera
 * gets an equal and opposite offset that then decays, so the eye glides instead of popping.
 * Returns the offset delta to add (0 when the vertical change looks like a slope, not a step).
 */
export function stepSmoothingDelta(dy: number, groundedBefore: boolean, groundedAfter: boolean, flatBefore: boolean, flatAfter: boolean, threshold = 0.04): number {
  if (!groundedBefore || !groundedAfter) return 0;
  if (!flatBefore || !flatAfter) return 0;
  if (Math.abs(dy) < threshold) return 0;
  return -dy;
}

/** Slide speed over time: initial boost then decel; slope adds/removes speed. */
export function slideSpeedStep(speed: number, friction: number, slopeAccel: number, dt: number, minSpeed: number): number {
  const s = speed - friction * dt + slopeAccel * dt;
  return Math.max(minSpeed, s);
}

export interface MantlePath { startY: number; topY: number; startX: number; startZ: number; endX: number; endZ: number; duration: number }

/** Position along a mantle: rise first (ease-out), then push forward (ease-in-out). t in seconds. */
export function mantlePoint(m: MantlePath, t: number, out: V3): V3 {
  const s = Math.min(1, Math.max(0, t / m.duration));
  const upT = Math.min(1, s / 0.62);
  const eu = 1 - Math.pow(1 - upT, 3);
  const fwT = Math.max(0, (s - 0.3) / 0.7);
  const ef = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, fwT));
  out.y = m.startY + (m.topY - m.startY) * eu;
  out.x = m.startX + (m.endX - m.startX) * ef;
  out.z = m.startZ + (m.endZ - m.startZ) * ef;
  return out;
}

/** How long a mantle should take as a function of the ledge height (CoD: quick vault, slower climb). */
export function mantleDuration(ledgeHeight: number): number {
  return 0.28 + Math.max(0, ledgeHeight - 0.5) * 0.22;
}

/** Landing camera dip impulse (m/s downward) for a given fall speed; soft landings barely register. */
export function landingImpulse(fallSpeed: number): number {
  const s = Math.max(0, fallSpeed - 2.5);
  return Math.min(3.6, s * 0.5);
}

/** Speed retained after a landing (hard landings stagger you). */
export function landingSpeedMul(fallSpeed: number): number {
  if (fallSpeed < 7) return 1;
  return Math.max(0.4, 1 - (fallSpeed - 7) * 0.12);
}
