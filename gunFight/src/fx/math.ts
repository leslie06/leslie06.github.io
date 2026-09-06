/**
 * Pure math for the fx module. No three.js, no engine — everything here is unit-tested
 * and mirrored 1:1 by the GLSL in ParticlePool.ts (analytic integration + floor bounce).
 */
export interface V3 { x: number; y: number; z: number }

export const GRAVITY = 9.81;
/** Sentinel for "no floor" in the particle buffer. */
export const NO_FLOOR = -1e6;

/**
 * Closed-form position/velocity under gravity `g = -9.81 * gScale` and linear drag `k`:
 *   v(t) = g/k + (v0 - g/k) e^{-kt}
 *   p(t) = p0 + (g/k) t + (v0 - g/k)(1 - e^{-kt}) / k
 * `k` is clamped to 1e-3 so drag-free particles still work.
 */
export function integrate(p0: V3, v0: V3, gScale: number, drag: number, t: number, outP: V3, outV: V3): void {
  const k = Math.max(drag, 1e-3);
  const gy = -GRAVITY * gScale;
  const e = Math.exp(-k * t);
  const gk = gy / k;
  const f = (1 - e) / k;
  outP.x = p0.x + v0.x * f;
  outP.y = p0.y + gk * t + (v0.y - gk) * f;
  outP.z = p0.z + v0.z * f;
  outV.x = v0.x * e;
  outV.y = gk + (v0.y - gk) * e;
  outV.z = v0.z * e;
}

export function yAt(y0: number, vy0: number, gScale: number, drag: number, t: number): number {
  const k = Math.max(drag, 1e-3); const gk = -GRAVITY * gScale / k; const e = Math.exp(-k * t);
  return y0 + gk * t + (vy0 - gk) * (1 - e) / k;
}
export function vyAt(vy0: number, gScale: number, drag: number, t: number): number {
  const k = Math.max(drag, 1e-3); const gk = -GRAVITY * gScale / k;
  return gk + (vy0 - gk) * Math.exp(-k * t);
}

/**
 * Time at which a particle launched at y0 with vy0 crosses `floorY` on its way down, found by
 * Newton iteration from `tMax` (where y is known to be below the floor). y(t) is concave, so
 * iterating from the right converges monotonically. Returns tMax if it never crosses.
 */
export function floorHitTime(y0: number, vy0: number, gScale: number, drag: number, floorY: number, tMax: number, iters = 5): number {
  if (yAt(y0, vy0, gScale, drag, tMax) >= floorY) return tMax;
  let th = tMax;
  for (let i = 0; i < iters; i++) {
    const yy = yAt(y0, vy0, gScale, drag, th) - floorY;
    const dy = vyAt(vy0, gScale, drag, th);
    th -= yy / Math.min(dy, -1e-3);
  }
  return Math.min(Math.max(th, 0), tMax);
}

/**
 * Full particle position at `t` including one analytic floor bounce and rest. This is the exact
 * logic the vertex shader runs; tests pin it down so shader edits can be validated against it.
 */
export function particleAt(p0: V3, v0: V3, gScale: number, drag: number, floorY: number, t: number, outP: V3, outV: V3, restitution = 0.35, friction = 0.6): boolean {
  integrate(p0, v0, gScale, drag, t, outP, outV);
  if (floorY <= NO_FLOOR + 1 || outP.y >= floorY) return false;
  const th = floorHitTime(p0.y, v0.y, gScale, drag, floorY, t);
  const ph = { x: 0, y: 0, z: 0 }, vh = { x: 0, y: 0, z: 0 };
  integrate(p0, v0, gScale, drag, th, ph, vh);
  const vb = { x: vh.x * friction, y: -vh.y * restitution, z: vh.z * friction };
  integrate(ph, vb, gScale, drag, t - th, outP, outV);
  if (outP.y < floorY) { outP.y = floorY; outV.x = outV.y = outV.z = 0; return true; }
  return false;
}

/** Ring-buffer slot allocation: oldest slot is recycled. */
export function nextRing(i: number, cap: number): number { return (i + 1) % cap; }

/**
 * Orthonormal frame for a decal on a surface with normal `n`. `t` (sprite +x) and `b` (sprite +y)
 * are chosen so sprite -y points along projected gravity when `alignDown` (blood drips run down),
 * otherwise rotated by `rot`. Returns [tx,ty,tz, bx,by,bz, nx,ny,nz].
 */
export function decalBasis(n: V3, rot: number, alignDown: boolean, out: Float32Array | number[]): void {
  let nx = n.x, ny = n.y, nz = n.z;
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  // reference "up" projected onto the plane; on horizontal surfaces fall back to +z
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(ny) > 0.95) { ux = 0; uy = 0; uz = 1; }
  const d = ux * nx + uy * ny + uz * nz;
  let bx = ux - d * nx, by = uy - d * ny, bz = uz - d * nz;
  const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
  // t = b x n  (right-handed: t x b = n)
  let tx = by * nz - bz * ny, ty = bz * nx - bx * nz, tz = bx * ny - by * nx;
  // Base frame always has sprite +y along projected world-up; callers pass a tiny `rot` when
  // `alignDown` (drips stay vertical) and a random one otherwise.
  const c = Math.cos(rot), s = Math.sin(rot);
  void alignDown;
  const rtx = tx * c + bx * s, rty = ty * c + by * s, rtz = tz * c + bz * s;
  const rbx = -tx * s + bx * c, rby = -ty * s + by * c, rbz = -tz * s + bz * c;
  tx = rtx; ty = rty; tz = rtz; bx = rbx; by = rby; bz = rbz;
  out[0] = tx; out[1] = ty; out[2] = tz; out[3] = bx; out[4] = by; out[5] = bz; out[6] = nx; out[7] = ny; out[8] = nz;
}

/**
 * Alpha for ring slot `slot` given the write head: the `window` slots directly ahead of the head
 * are the oldest and fade out before being overwritten (k=1 -> nearly gone, k=window -> 1).
 */
export function fadeWindowAlpha(slot: number, head: number, cap: number, window: number): number {
  const k = ((slot - head) % cap + cap) % cap; // distance ahead of head
  if (k === 0 || k > window) return 1;
  return k / window;
}

/** Pick a pooled light: a free one, else the one closest to expiring. */
export function pickLight(remaining: ArrayLike<number>): number {
  let best = 0, bestV = Infinity;
  for (let i = 0; i < remaining.length; i++) {
    const r = remaining[i];
    if (r <= 0) return i;
    if (r < bestV) { bestV = r; best = i; }
  }
  return best;
}

export interface ShellState { x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; resting: boolean }

/** Cheap analytic shell casing step: gravity, floor bounce with restitution + friction, rest after N bounces. Returns true if it bounced this step. */
export function shellStep(s: ShellState, dt: number, floorY: number, radius: number, restitution = 0.38, friction = 0.55, maxBounces = 3): boolean {
  if (s.resting) return false;
  s.vy -= GRAVITY * dt;
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  const ground = floorY + radius;
  if (s.y < ground && s.vy < 0) {
    s.y = ground;
    s.bounces++;
    if (s.bounces >= maxBounces || Math.abs(s.vy) < 0.6) { s.vx = s.vy = s.vz = 0; s.resting = true; return true; }
    s.vy = -s.vy * restitution;
    s.vx *= friction; s.vz *= friction;
    return true;
  }
  return false;
}

/** Deterministic cone direction around `axis` with half-angle `angle` from two uniforms u,v in [0,1). */
export function coneDir(axis: V3, angle: number, u: number, v: number, out: V3): void {
  const ax = axis.x, ay = axis.y, az = axis.z;
  // orthonormal basis around axis
  let tx: number, ty: number, tz: number;
  if (Math.abs(ay) < 0.9) { tx = az; ty = 0; tz = -ax; } else { tx = 0; ty = -az; tz = ay; }
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = ay * tz - az * ty, by = az * tx - ax * tz, bz = ax * ty - ay * tx;
  const cosA = Math.cos(angle * Math.sqrt(u)); // sqrt for uniform area distribution
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const phi = v * Math.PI * 2;
  const cx = Math.cos(phi) * sinA, cy = Math.sin(phi) * sinA;
  out.x = ax * cosA + tx * cx + bx * cy;
  out.y = ay * cosA + ty * cx + by * cy;
  out.z = az * cosA + tz * cx + bz * cy;
}

/** Reflect `d` about `n` (both unit-ish); result written to out. */
export function reflect(d: V3, n: V3, out: V3): void {
  const k = 2 * (d.x * n.x + d.y * n.y + d.z * n.z);
  out.x = d.x - k * n.x; out.y = d.y - k * n.y; out.z = d.z - k * n.z;
}

/** Scale a particle count by the quality budget, never below 1. */
export function budgetCount(base: number, scale: number): number { return Math.max(1, Math.round(base * scale)); }
