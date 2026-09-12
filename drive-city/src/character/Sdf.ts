import { BIND_ARM } from './Body';

/**
 * The body as signed distance fields (metres, bind pose: A-pose arms, see Body.ts), built from
 * smooth unions of ellipsoids and round cones so shoulders, hips and the neck blend into the
 * torso. BodyMesh sweeps rings along the limbs and projects them onto these surfaces; the blend
 * shapes are the same rings projected onto the `fem = 1` and `build = 1` bodies.
 * Only used while building the meshes (startup), never per frame.
 */
export type Sdf = (x: number, y: number, z: number) => number;

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number): number { return -smin(-a, -b, k); }

export function ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): Sdf {
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const k1 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

/** An ellipsoid in a rotated frame: axes u, v, w (unit, orthogonal) with radii ru, rv, rw. */
export function ellipsoidFrame(c: V3, u: V3, v: V3, w: V3, ru: number, rv: number, rw: number): Sdf {
  const e = ellipsoid(0, 0, 0, ru, rv, rw);
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    return e(dx * u[0] + dy * u[1] + dz * u[2], dx * v[0] + dy * v[1] + dz * v[2], dx * w[0] + dy * w[1] + dz * w[2]);
  };
}

export function sphere(cx: number, cy: number, cz: number, r: number): Sdf {
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

/** Round cone (capsule with different end radii), exact. */
export function roundCone(a: V3, b: V3, r1: number, r2: number): Sdf {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

/** Rounded box centred at c with axes u, v, w and half extents h (rounding r included). */
export function roundBox(c: V3, u: V3, v: V3, w: V3, hu: number, hv: number, hw: number, r: number): Sdf {
  return (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const qx = Math.abs(dx * u[0] + dy * u[1] + dz * u[2]) - (hu - r);
    const qy = Math.abs(dx * v[0] + dy * v[1] + dz * v[2]) - (hv - r);
    const qz = Math.abs(dx * w[0] + dy * w[1] + dz * w[2]) - (hw - r);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}

export type V3 = [number, number, number];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

const unionS = (k: number, ...fs: Sdf[]): Sdf => (x, y, z) => {
  let d = fs[0](x, y, z);
  for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](x, y, z), k);
  return d;
};

/** Bind-pose landmarks shared with the mesh builder (left side; mirror x for the right). */
export const BIND = (() => {
  const s = Math.sin(BIND_ARM), c = Math.cos(BIND_ARM);
  const shoulder: V3 = [0.172, 1.42, -0.025];
  const arm: V3 = [s, -c, 0];            // down the arm
  const out: V3 = [c, s, 0];             // away from the body, perpendicular to the arm
  const fwd: V3 = [0, 0, 1];
  const elbow = add(shoulder, arm, 0.285), wrist = add(elbow, arm, 0.25);
  return { shoulder, arm, out, fwd, elbow, wrist, hip: [0.088, 0.925, 0] as V3, knee: [0.088, 0.5, 0.005] as V3, ankle: [0.088, 0.085, -0.005] as V3 };
})();

/** Head ray centre: rays for the head grid start here. */
export const HEAD_C: V3 = [0, 1.64, 0.005];

export interface BodyShape {
  torso: Sdf;
  /** Torso with both legs, no arms: the torso rings are projected onto this. */
  trunk: Sdf;
  /** One limb alone (no torso): tube rings are projected onto these. */
  arm(side: number): Sdf;
  leg(side: number): Sdf;
  /** Torso smoothly joined to one arm / one leg (side +1 left, -1 right). */
  armBranch(side: number): Sdf;
  legBranch(side: number): Sdf;
  /** Torso with both arms and both legs (the legs meet each other with a crease). */
  body: Sdf;
  head: Sdf;
  /** Everything, including shoes (ambient occlusion). */
  all: Sdf;
}

/**
 * @param fem 0 male .. 1 female proportions
 * @param heavy 0 average .. 1 heavy (negative values are extrapolated by the blend shape, not here)
 */
export function bodyShape(fem: number, heavy: number): BodyShape {
  const f = fem, h = heavy;
  const b = BIND;
  const torso = unionS(0.05,
    ellipsoid(0, 0.945, -0.012, 0.158 + 0.024 * f + 0.02 * h, 0.105, 0.108 + 0.008 * f + 0.02 * h),           // pelvis
    ellipsoid(0, 1.075, 0.0, 0.133 - 0.02 * f + 0.035 * h, 0.12, 0.096 - 0.008 * f + 0.03 * h),              // abdomen, waist
    ellipsoid(0, 1.05, 0.035, 0.11 + 0.02 * h, 0.11, 0.055 + 0.06 * h),                                       // belly
    ellipsoid(0, 1.255, -0.008, 0.147 - 0.016 * f + 0.02 * h, 0.165, 0.1 - 0.006 * f + 0.02 * h),            // rib cage
    ellipsoid(0, 1.325, 0.01, 0.162 - 0.024 * f + 0.015 * h, 0.092, 0.095 - 0.01 * f + 0.015 * h),            // upper chest
    ellipsoid(0.066, 1.315, 0.042, 0.072 - 0.02 * f, 0.052, 0.05 - 0.012 * f),                               // pecs
    ellipsoid(-0.066, 1.315, 0.042, 0.072 - 0.02 * f, 0.052, 0.05 - 0.012 * f),
    ellipsoid(0.058, 1.29 - 0.01 * f, 0.05, 0.02 + 0.042 * f, 0.02 + 0.037 * f, 0.02 + 0.036 * f),          // bust
    ellipsoid(-0.058, 1.29 - 0.01 * f, 0.05, 0.02 + 0.042 * f, 0.02 + 0.037 * f, 0.02 + 0.036 * f),
    ellipsoid(0, 1.35, -0.04, 0.158 - 0.02 * f, 0.115, 0.083 - 0.006 * f + 0.01 * h),                         // upper back
    roundCone([-0.152 + 0.014 * f, 1.432, -0.03], [0.152 - 0.014 * f, 1.432, -0.03], 0.045, 0.045),         // shoulder girdle
    roundCone([0.03, 1.5, -0.035], [0.15 - 0.012 * f, 1.442, -0.03], 0.043 + 0.006 * h, 0.034),            // trapezius
    roundCone([-0.03, 1.5, -0.035], [-0.15 + 0.012 * f, 1.442, -0.03], 0.043 + 0.006 * h, 0.034),
    roundCone([0, 1.44, -0.022], [0, 1.625, -0.006], 0.061 - 0.009 * f + 0.01 * h, 0.053 - 0.007 * f + 0.008 * h), // neck
    ellipsoid(0.072, 0.875, -0.062 - 0.006 * f, 0.082 + 0.01 * f + 0.012 * h, 0.088, 0.072 + 0.012 * f + 0.012 * h), // buttocks
    ellipsoid(-0.072, 0.875, -0.062 - 0.006 * f, 0.082 + 0.01 * f + 0.012 * h, 0.088, 0.072 + 0.012 * f + 0.012 * h),
  );

  const arm = (side: number): Sdf => {
    const m = (v: V3): V3 => [v[0] * side, v[1], v[2]];
    const S = m(b.shoulder), A = m(b.arm), O = m(b.out), F = b.fwd, E = m(b.elbow), W = m(b.wrist);
    const k = 1 - 0.13 * f + 0.14 * h;
    const hand = 1 - 0.1 * f;
    return unionS(0.03,
      ellipsoidFrame(add(add(S, A, 0.035), O, 0.012), O, A, F, 0.058 * k, 0.078, 0.06 * k),                   // deltoid
      roundCone(add(S, A, 0.05), E, 0.048 * k, 0.037 * k),                                                     // upper arm
      ellipsoidFrame(add(add(S, A, 0.15), F, 0.008), O, A, F, 0.043 * k, 0.085, 0.047 * k),                    // biceps/triceps
      roundCone(E, W, 0.036 * k, 0.025 * k),                                                                   // forearm
      ellipsoidFrame(add(E, A, 0.075), O, A, F, 0.034 * k, 0.09, 0.042 * k),                                  // forearm muscle
      roundBox(add(W, A, 0.05 * hand), O, A, F, 0.016 * hand, 0.05 * hand, 0.042 * hand, 0.014 * hand),       // palm
      roundBox(add(add(W, A, 0.135 * hand), O, -0.006), O, A, F, 0.012 * hand, 0.045 * hand, 0.038 * hand, 0.011 * hand), // fingers
    );
  };
  const thumb = (side: number): Sdf => {
    const m = (v: V3): V3 => [v[0] * side, v[1], v[2]];
    const A = m(b.arm), O = m(b.out), F = b.fwd, W = m(b.wrist), hand = 1 - 0.1 * f;
    return roundCone(add(add(add(W, A, 0.025), F, 0.03), O, -0.01), add(add(add(W, A, 0.085), F, 0.046), O, -0.026), 0.012 * hand, 0.009 * hand);
  };
  const leg = (side: number): Sdf => {
    const m = (x: number, y: number, z: number): V3 => [x * side, y, z];
    const k = 1 + 0.2 * h;
    return unionS(0.03,
      roundCone(m(0.096, 0.905, 0), m(0.088, 0.54, 0.005), 0.087 + 0.008 * f + 0.016 * h, 0.056 + 0.01 * h),   // thigh
      ellipsoid(0.125 * side + 0.012 * f * side, 0.905, -0.01, 0.055 + 0.012 * f, 0.075, 0.068),              // outer hip
      ellipsoid(0.092 * side, 0.72, 0.028, 0.066 * k, 0.15, 0.058 * k),                                       // quadriceps
      sphere(0.088 * side, 0.5, 0.01, 0.05),                                                                   // knee
      ellipsoid(0.09 * side, 0.355, -0.018, 0.049 * k, 0.11, 0.051 * k),                                      // calf
      roundCone(m(0.088, 0.49, 0.008), m(0.088, 0.09, -0.005), 0.046, 0.032),                                   // shin
      sphere(0.088 * side, 0.085, -0.005, 0.036),                                                              // ankle
    );
  };
  const armL = arm(1), armR = arm(-1), legL = leg(1), legR = leg(-1);
  const armBranch = (side: number): Sdf => { const a = side > 0 ? armL : armR; return (x, y, z) => smin(torso(x, y, z), a(x, y, z), 0.035); };
  const legBranch = (side: number): Sdf => { const l = side > 0 ? legL : legR; return (x, y, z) => smin(torso(x, y, z), l(x, y, z), 0.04); };
  const trunk: Sdf = (x, y, z) => smin(torso(x, y, z), Math.min(legL(x, y, z), legR(x, y, z)), 0.04);
  const body: Sdf = (x, y, z) => {
    const t = torso(x, y, z);
    return smin(smin(t, Math.min(armL(x, y, z), armR(x, y, z)), 0.035), Math.min(legL(x, y, z), legR(x, y, z)), 0.04);
  };

  const head = unionS(0.025,
    ellipsoid(0, 1.655, -0.01, 0.079, 0.094, 0.099),                                                         // cranium
    ellipsoid(0, 1.59, 0.03, 0.062 - 0.007 * f + 0.01 * h, 0.072 - 0.004 * f, 0.068 + 0.004 * h),              // face / jaw
    ellipsoid(0.047, 1.585, -0.005, 0.022 - 0.004 * f + 0.008 * h, 0.03, 0.035),                             // jaw angles
    ellipsoid(-0.047, 1.585, -0.005, 0.022 - 0.004 * f + 0.008 * h, 0.03, 0.035),
    sphere(0, 1.536 + 0.003 * f, 0.077 - 0.002 * f, 0.02 - 0.002 * f),                                        // chin
    ellipsoid(0.047, 1.632, 0.058, 0.028 + 0.006 * h, 0.02, 0.025),                                          // cheekbones
    ellipsoid(-0.047, 1.632, 0.058, 0.028 + 0.006 * h, 0.02, 0.025),
    ellipsoid(0.05, 1.6, 0.05, 0.02 + 0.014 * h, 0.022 + 0.008 * h, 0.022 + 0.008 * h),                     // cheeks (heavy)
    ellipsoid(-0.05, 1.6, 0.05, 0.02 + 0.014 * h, 0.022 + 0.008 * h, 0.022 + 0.008 * h),
    ellipsoid(0.078, 1.638, -0.008, 0.011, 0.031, 0.02),                                                    // ears
    ellipsoid(-0.078, 1.638, -0.008, 0.011, 0.031, 0.02),
  );
  const feature = unionS(0.012,
    roundCone([-0.036, 1.673, 0.079], [0.036, 1.673, 0.079], 0.012 - 0.002 * f, 0.012 - 0.002 * f),       // brow ridge
    roundCone([0, 1.662, 0.091], [0, 1.618, 0.111 - 0.003 * f], 0.0085, 0.012),                            // nose
    ellipsoid(0, 1.61, 0.099, 0.0175, 0.009, 0.012),                                                        // nostril wings
    ellipsoid(0, 1.579, 0.094, 0.023, 0.011 + 0.002 * f, 0.012),                                            // lips
  );
  const sockets = (x: number, y: number, z: number) => Math.min(
    ellipsoid(0.032, 1.652, 0.1, 0.019, 0.012, 0.016)(x, y, z), ellipsoid(-0.032, 1.652, 0.1, 0.019, 0.012, 0.016)(x, y, z));
  const eyes = (x: number, y: number, z: number) => Math.min(Math.hypot(x - 0.032, y - 1.652, z - 0.078) - 0.0135, Math.hypot(x + 0.032, y - 1.652, z - 0.078) - 0.0135);
  const headF: Sdf = (x, y, z) => {
    let d = smin(head(x, y, z), feature(x, y, z), 0.012);
    d = smax(d, -sockets(x, y, z), 0.01);
    return Math.min(d, eyes(x, y, z));
  };

  const shoe = (side: number): Sdf => roundBox([0.088 * side, 0.045, 0.06], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.048, 0.045, 0.135, 0.03);
  const shoeL = shoe(1), shoeR = shoe(-1);
  const thumbL = thumb(1), thumbR = thumb(-1);
  const all: Sdf = (x, y, z) => Math.min(body(x, y, z), headF(x, y, z), shoeL(x, y, z), shoeR(x, y, z), thumbL(x, y, z), thumbR(x, y, z));
  return { torso, trunk, arm: (s) => (s > 0 ? armL : armR), leg: (s) => (s > 0 ? legL : legR), armBranch, legBranch, body, head: headF, all };
}

/** Numeric gradient (unnormalised) into `out`. */
export function gradient(f: Sdf, x: number, y: number, z: number, out: V3, e = 5e-4): V3 {
  out[0] = f(x + e, y, z) - f(x - e, y, z);
  out[1] = f(x, y + e, z) - f(x, y - e, z);
  out[2] = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

/**
 * First exit of the ray o + t d from the inside of `f` (t in [0, tMax]); returns t, or -1 if the
 * ray starts outside and never enters, or never leaves.
 */
export function rayExit(f: Sdf, o: V3, d: V3, tMax = 0.45): number {
  let t = 0, prev = 0;
  let v = f(o[0], o[1], o[2]);
  if (v > 0) {
    // Starting outside (a thin part): walk back towards the axis is not possible; march in
    // until inside, then out again.
    let entered = false;
    for (let i = 0; i < 400 && t < tMax; i++) {
      t += 0.0015;
      v = f(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
      if (v < 0) { entered = true; break; }
    }
    if (!entered) return -1;
  }
  while (t < tMax) {
    prev = t;
    t += Math.max(-v * 0.8, 0.0012);
    v = f(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
    if (v >= 0) {
      let lo = prev, hi = t;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) * 0.5;
        if (f(o[0] + d[0] * mid, o[1] + d[1] * mid, o[2] + d[2] * mid) < 0) lo = mid; else hi = mid;
      }
      return (lo + hi) * 0.5;
    }
  }
  return -1;
}

/** Pull p onto the surface of f along the gradient (Newton). */
export function snap(f: Sdf, p: V3, iters = 4): V3 {
  const g: V3 = [0, 0, 0];
  for (let i = 0; i < iters; i++) {
    const v = f(p[0], p[1], p[2]);
    if (Math.abs(v) < 1e-5) break;
    gradient(f, p[0], p[1], p[2], g);
    p[0] -= g[0] * v; p[1] -= g[1] * v; p[2] -= g[2] * v;
  }
  return p;
}
