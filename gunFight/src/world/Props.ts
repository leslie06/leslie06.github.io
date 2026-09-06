import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../core/Rng';
import { box, boxMM, cable, chamferBox, chunkGeo, fbm2, gradQuad, hash3, heightField, lathe, merge, noise2, place, prep, tinted, tube, softPatch, type ChunkKind, type GeoOpts } from './Geo';
import { DECAL, FACADE_BRICK_BLANK, FACADE_BRICK_WINDOW, FACADE_CELL, FACADE_ROOF_DARK, FACADE_ROOF_LIGHT, decalUv, facadeUv } from './Canvas';
import type { BuildCtx } from './Buildings';

/**
 * Props. Repeated things are instanced (one draw call per kind); one-offs are merged into the
 * static batches by material. Every prop that a player can bump into gets a collider.
 *
 * Draw-call budget note: every distinct `instanced(kind)` is one draw call; merged statics are free.
 */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function mat4(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1, sy?: number): THREE.Matrix4 {
  _q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return _m.compose(_p.set(x, y, z), _q, _s.set(s, sy ?? s, s)).clone();
}
const nonIdx = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- decals (one merged draw call, 'decal' material)
/** Remap a plane's 0..1 uv into an atlas rect. */
function uvToRect(g: THREE.BufferGeometry, r: [number, number, number, number]): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return g;
}
/**
 * Decal quad from the decal atlas at p, facing n (+y for ground). `roll` rotates about the normal.
 * Walls: texture "up" = world up. Ground: texture "up" = -z rotated by roll.
 */
export function decal(ctx: BuildCtx, slot: number, p: THREE.Vector3, n: THREE.Vector3, w: number, h: number, roll = 0, alpha = 1, tint: THREE.ColorRepresentation = 0xffffff, offset = 0.012): void {
  const g = uvToRect(new THREE.PlaneGeometry(w, h), decalUv(slot));
  if (Math.abs(n.y) > 0.9) { g.rotateX(n.y > 0 ? -Math.PI / 2 : Math.PI / 2); g.rotateY(roll); }
  else { g.rotateZ(roll); g.rotateY(Math.atan2(n.x, n.z)); }
  g.translate(p.x + n.x * offset, p.y + n.y * offset, p.z + n.z * offset);
  ctx.batch.add('decal', prep(g, { uv: 'keep', alpha, tint }));
}
/** Bullet pock cluster on a vertical surface at point p with outward normal n. */
export function pocks(ctx: BuildCtx, p: THREE.Vector3, n: THREE.Vector3, size = 0.9): void {
  const slot = size < 0.6 ? DECAL.pocks3 : size < 0.8 ? DECAL.pocks6 : DECAL.pocks10;
  decal(ctx, slot, p, n, size * 0.72, size * 0.72, ctx.rng.range(0, 6), 0.92, 0xffffff, 0.01);
}
/** Shell hit: crater + radial cracks + chipped ring. */
export function shellHole(ctx: BuildCtx, p: THREE.Vector3, n: THREE.Vector3, size = 1.6): void {
  decal(ctx, DECAL.shell, p, n, size, size, ctx.rng.range(0, 6), 1, 0xffffff, 0.014);
}
/** Dust/gravel halo under a debris cluster. */
export function dustPatch(ctx: BuildCtx, x: number, y: number, z: number, r: number, alpha = 0.7): void {
  decal(ctx, DECAL.dust, new THREE.Vector3(x, y, z), UP, r * 2, r * 2 * ctx.rng.range(0.7, 1.3), ctx.rng.range(0, 6), alpha, 0xffffff, 0.006);
}
export function tireTrack(ctx: BuildCtx, x: number, z: number, yaw: number, len: number, y = 0): void {
  decal(ctx, DECAL.track, new THREE.Vector3(x, y, z), UP, 2.1, len, yaw, 0.7, 0xffffff, 0.005);
}
/** A trail of boot prints from a to b, laid as overlapping decal strips (each strip is ~5 prints). */
export function bootTrail(ctx: BuildCtx, a: THREE.Vector3, b: THREE.Vector3, y = 0, width = 0.75, alpha = 0.75): void {
  const len = a.distanceTo(b);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const strips = Math.max(1, Math.round(len / (width * 1.7)));
  for (let i = 0; i < strips; i++) {
    const p = a.clone().lerp(b, (i + 0.5) / strips);
    decal(ctx, DECAL.boots, new THREE.Vector3(p.x, y, p.z), UP, width, width * 1.75, yaw, alpha * ctx.rng.range(0.7, 1.0), 0xffffff, 0.005);
  }
}
/** Wind ripples in loose sand — a band of crests, usually drifted up against a wall or a barrier. */
export function sandRipple(ctx: BuildCtx, x: number, z: number, w: number, d: number, yaw: number, y = 0, alpha = 0.65): void {
  decal(ctx, DECAL.ripple, new THREE.Vector3(x, y, z), UP, w, d, yaw, alpha, 0xffffff, 0.004);
}
export function oilStain(ctx: BuildCtx, x: number, z: number, r: number, y = 0): void {
  decal(ctx, DECAL.oil, new THREE.Vector3(x, y, z), UP, r * 2, r * 2, ctx.rng.range(0, 6), 0.85, 0xffffff, 0.007);
}
/** Soft-edged ground decals (textured). */
export function dirtPatch(ctx: BuildCtx, x: number, z: number, rx: number, rz: number, y = 0.006, alpha = 0.85): void {
  ctx.batch.add('dirtDecal', softPatch(x, y, z, rx, rz, ctx.rng, { alpha, tint: new THREE.Color().setHSL(0.08, 0.25, ctx.rng.range(0.35, 0.5)) }));
}
export function gravelPatch(ctx: BuildCtx, x: number, z: number, rx: number, rz: number, y = 0.007, alpha = 0.9): void {
  ctx.batch.add('gravelDecal', softPatch(x, y, z, rx, rz, ctx.rng, { alpha: alpha * 0.7, tint: new THREE.Color().setHSL(0.09, 0.13, ctx.rng.range(0.42, 0.58)) }));
}
export function puddle(ctx: BuildCtx, x: number, z: number, rx: number, rz: number, y = 0.008): void {
  ctx.batch.add('puddle', softPatch(x, y, z, rx, rz, ctx.rng, { alpha: 0.92, tint: 0x3a3c3a }));
}
export function scorch(ctx: BuildCtx, x: number, z: number, r: number, y = 0.01): void {
  ctx.batch.add('scorch', softPatch(x, y, z, r, r * ctx.rng.range(0.7, 1.3), ctx.rng, { alpha: 0.9, tint: 0x0a0908 }));
}
/**
 * Baked-AO strip: a black gradient quad ('scorch' material, alpha blended) on a surface. Used at wall bases,
 * ceiling corners, under sills, under overhangs. p = centre of the strip's bottom edge on the surface, n = surface
 * normal, `up` = direction along which alpha fades (a0 → a1).
 */
export function aoStrip(ctx: BuildCtx, p: THREE.Vector3, n: THREE.Vector3, up: THREE.Vector3, w: number, h: number, a0: number, a1: number): void {
  const g = gradQuad(w, h, a0, a1);
  // orient: plane local +y → up, local +z → n
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, n).normalize(), up.clone().normalize(), n.clone().normalize());
  g.translate(0, h / 2, 0); g.applyMatrix4(m); g.translate(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01);
  ctx.batch.add('ao', prep(g, { uv: 'keep', keepColor: true }));
}

// ---------------------------------------------------------------- sandbags / hesco
const SB_L = 0.52, SB_H = 0.19, SB_D = 0.33;
export function sandbagGeo(): THREE.BufferGeometry {
  /**
   * A filled bag.
   *
   * The previous version deformed a BoxGeometry, whose vertices are duplicated per face — so
   * `computeVertexNormals()` produced flat per-face normals and every bag shaded as a faceted polyhedron with a
   * hard terminator running round it. That, not the silhouette, is the "bar of soap" read. A sphere shares its
   * vertices, so the same 64 triangles shade smoothly; the bag shape is then a rounded superellipsoid: poles at
   * the sewn ends, fill slumped into a belly, a flat-ish stacking face top and bottom, and a seam ridge along
   * the top so the light breaks across it instead of sliding over.
   */
  const g = new THREE.SphereGeometry(0.5, 8, 5);
  g.rotateZ(Math.PI / 2);                                  // poles onto +/-x: the sewn, gathered ends
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const sgn = (v: number, e: number) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v) * 2), e) * 0.5;
  for (let i = 0; i < pos.count; i++) {
    // rounded-box shaping: y flattest (bags are stacked and squashed), x/z fuller
    let x = sgn(pos.getX(i), 0.78) * SB_L * 2, y = sgn(pos.getY(i), 0.52) * (SB_H + 0.03) * 2, z = sgn(pos.getZ(i), 0.70) * SB_D * 2;
    const u = x / (SB_L / 2);
    const pinch = 1 - 0.34 * Math.pow(Math.abs(u), 2.6);   // the hessian is folded and sewn at both ends
    const belly = 1 + 0.09 * (1 - u * u);                  // fill slumps to the middle
    y *= pinch * (y > 0 ? 0.9 : 1.0);
    z *= pinch * belly;
    if (y > 0 && Math.abs(z) < SB_D * 0.32) y += 0.013;    // sewn seam ridge along the top
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
/** Sandbag wall from a to b, `rows` high (each row 0.19 m). Stretcher bond, jittered. */
export function sandbagWall(ctx: BuildCtx, a: THREE.Vector3, b: THREE.Vector3, rows = 3): void {
  const { rng, batch } = ctx;
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  const yaw = Math.atan2(-dir.z, dir.x);
  const n = Math.max(1, Math.floor(len / (SB_L + 0.02)));
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * SB_L * 0.5;
    const count = r % 2 ? n - 1 : n;
    for (let i = 0; i < count; i++) {
      const t = (off + (i + 0.5) * (SB_L + 0.02)) / len;
      const p = a.clone().lerp(b, t);
      const tint = new THREE.Color().setHSL(0.085 + rng.range(-0.02, 0.02), rng.range(0.17, 0.28), rng.range(0.25, 0.37) - r * 0.012);
      const sq = rng.range(0.92, 1.08);
      batch.instanced('sandbag', 'hessian', sandbagGeo, mat4(p.x + rng.range(-0.02, 0.02), a.y + SB_H * (r + 0.5) - r * 0.012, p.z + rng.range(-0.02, 0.02), yaw + rng.range(-0.08, 0.08), rng.range(-0.04, 0.04), rng.range(-0.05, 0.05), sq, 2 - sq), tint, { uv: 'keep', uvScale: SB_L });
    }
  }
  const c = a.clone().lerp(b, 0.5);
  ctx.collideBox(c.x, a.y + rows * SB_H / 2, c.z, len, rows * SB_H, SB_D, 'sandbag', yaw);
  // contact shadow
  aoStrip(ctx, new THREE.Vector3(c.x, a.y + 0.004, c.z), UP, new THREE.Vector3(dir.z, 0, -dir.x).negate(), len + 0.2, SB_D * 0.5, 0.5, 0.0);
  aoStrip(ctx, new THREE.Vector3(c.x, a.y + 0.004, c.z), UP, new THREE.Vector3(dir.z, 0, -dir.x), len + 0.2, SB_D * 0.5, 0.5, 0.0);
}

/**
 * Hesco bastion row: n cells of 1.1 m along dir (yaw).
 *
 * Round 2: "flat planes with a painted black square grid … no fill bulge, no sag, the wire mesh is a texture".
 * Rebuilt so the shape carries the load: the geotextile liner bows out ~4.5 cm at the point of maximum
 * hydrostatic pressure (~35% of the height, not the middle), each cell bulges by a different amount, the top
 * edge is pulled in by the frame and the fill domes above it, and the welded mesh is real 6 mm bar standing
 * proud of the fabric so it self-shadows and catches a specular.
 */
export function hescoRow(ctx: BuildCtx, x: number, z: number, yaw: number, n: number, h = 1.37): void {
  const { batch, rng } = ctx;
  const w = 1.1;
  const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  for (let i = 0; i < n; i++) {
    const c = new THREE.Vector3(x, 0, z).addScaledVector(dir, (i + 0.5) * w);
    const ch = h + rng.range(-0.035, 0.03);          // cells are not filled to the same height
    const cyaw = yaw + rng.range(-0.035, 0.035);     // nor set perfectly true
    const bulge = rng.range(0.10, 0.155);   // 10-15 cm of fill pressure: visible in silhouette from 1 m
    const seed = i * 3.1 + x * 0.7 + z * 0.3;
    const hh = (ch - 0.1) / 2;
    const g = new THREE.BoxGeometry(w - 0.05, ch - 0.1, w - 0.05, 3, 5, 3);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
      const t = THREE.MathUtils.clamp((py + hh) / (2 * hh), 0, 1);
      // fill pressure profile: zero at the pallet, peak at ~35% height, pulled back in by the top frame
      const load = Math.pow(Math.sin(Math.pow(t, 0.62) * Math.PI), 1.1);
      const face = 0.7 + 0.6 * hash3(px * 3 + seed, py * 3, pz * 3);
      const out = 1 + (bulge * load * face) / (w * 0.5);
      const top = t > 0.94 ? 0.93 : 1;              // frame pinches the liner at the top rail
      pos.setXYZ(v, px * out * top, py, pz * out * top);
    }
    g.computeVertexNormals(); g.rotateY(cyaw); g.translate(c.x, ch / 2 + 0.05, c.z);
    // vertex AO: a hard mud line in the bottom 0.3 m (splash-back off the ground) fading to clean geotextile
    batch.add('hesco', prep(g, { tint: new THREE.Color().setHSL(0.095 + rng.range(-0.015, 0.015), rng.range(0.16, 0.27), rng.range(0.30, 0.48)), damage: 0, aoFn: (_x, y) => 0.44 + 0.56 * THREE.MathUtils.smoothstep(y, 0.02, 0.34) }));
    // fill domed above the liner
    const fill = new THREE.PlaneGeometry(w - 0.14, w - 0.14, 3, 3);
    const fp = fill.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < fp.count; v++) { const u = fp.getX(v) / (w * 0.5), q = fp.getY(v) / (w * 0.5); fp.setZ(v, 0.05 * (1 - u * u) * (1 - q * q)); }
    fill.computeVertexNormals(); fill.rotateX(-Math.PI / 2); fill.rotateY(cyaw); fill.translate(c.x, ch - 0.03, c.z);
    batch.add('sand', prep(fill, { tint: 0xcbb995 }));
    // corner posts + top/mid rails
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = dx * (w / 2 - 0.01), lz = dz * (w / 2 - 0.01);
      const wx = c.x + lx * Math.cos(cyaw) + lz * Math.sin(cyaw), wz = c.z - lx * Math.sin(cyaw) + lz * Math.cos(cyaw);
      batch.add('darkMetal', box(wx, ch / 2 + 0.02, wz, 0.035, ch, 0.035, { tint: 0x76716a }));
    }
    for (const yy of [0.35, 0.75, ch - 0.02]) batch.add('darkMetal', box(c.x, yy, c.z, w + 0.01, 0.025, w + 0.01, { rotY: cyaw, tint: 0x7c776f }));
    /**
     * Welded wire mesh on the two long faces: real 6 mm bar standing clear of the bulged liner.
     *
     * The bars themselves were right; the *value* was not. At 0xc2c8c4 on a fully-chrome material they rendered
     * as 1 px pure-white lines on tan, which is both the "painted white grid" read and the high-contrast edge
     * the chromatic aberration was fringing. Galvanised steel outdoors is a mid grey with a green cast; three
     * bars per axis is also closer to a real bastion panel than four (and pays for the bulge in triangles).
     */
    const MESH = 0x8d948e;
    for (const sideSign of [-1, 1]) {
      const lz = sideSign * (w / 2 + 0.016 + bulge * 0.55);
      const wx = c.x + lz * Math.sin(cyaw), wz = c.z + lz * Math.cos(cyaw);
      for (let k = 1; k <= 3; k++) {
        const lx = -w / 2 + k * (w / 4);
        batch.add('wire', box(wx + lx * Math.cos(cyaw), ch / 2 + 0.02, wz - lx * Math.sin(cyaw), 0.007, ch - 0.08, 0.007, { rotY: cyaw, tint: MESH }));
      }
      for (let k = 1; k <= 3; k++) batch.add('wire', box(wx, 0.08 + k * ((ch - 0.14) / 4), wz, w - 0.02, 0.007, 0.007, { rotY: cyaw, tint: MESH }));
    }
  }
  const c = new THREE.Vector3(x, 0, z).addScaledVector(dir, n * w / 2);
  ctx.collideBox(c.x, h / 2, c.z, n * w, h, w + 0.06, 'sandbag', yaw);
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  // splash-back dirt drift piled against both faces (0.3 m band)
  for (const s2 of [-1, 1]) {
    const base = c.clone().addScaledVector(side, s2 * (w / 2 + 0.13));
    dirtPatch(ctx, base.x, base.z, Math.abs(dir.x) * n * w * 0.5 + 0.3, Math.abs(dir.z) * n * w * 0.5 + 0.3, 0.006, 0.8);
    aoStrip(ctx, c.clone().addScaledVector(side, s2 * w / 2).setY(0.004), UP, side.clone().multiplyScalar(s2), n * w + 0.2, 0.55, 0.6, 0);
  }
}

/**
 * Concertina razor wire.
 *
 * Round 2: "a chain of black hexagonal line-loops … reads as a wireframe debug draw". Rebuilt as an actual
 * coil: an 8 mm galvanised core wound at 0.45 m radius with the pitch varying ±15% (a real coil is never
 * evenly spaced), sagging slightly between supports, with a 4-blade barb cluster punched onto the wire every
 * ~0.28 m. Galvanised steel is *bright* — the old near-black tint was half the problem.
 */
export function razorWire(ctx: BuildCtx, a: THREE.Vector3, b: THREE.Vector3, r = 0.45, per = 32): void {
  const { rng } = ctx;
  const len = a.distanceTo(b);
  const turns = Math.max(2, Math.round(len / (r * 0.7)));
  const dir = b.clone().sub(a).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  // Path samples per turn. At 16 a 0.9 m coil 3 m from the camera puts a 50 px straight chord on screen —
  // that is the "10-12-sided polygon coil / chrome hula-hoop" read. 32 is the close-range figure; runs the
  // player never gets near pass a lower number so the budget is spent where it is seen.
  const n = turns * per;
  const pts: THREE.Vector3[] = [];
  // pitch jitter: accumulate an uneven advance along the run so the loops bunch and spread like real wire
  const adv: number[] = [];
  let acc = 0;
  for (let t = 0; t < turns; t++) { const p = 1 + rng.range(-0.15, 0.15); adv.push(acc); acc += p; }
  adv.push(acc);
  for (let i = 0; i <= n; i++) {
    const tf = i / per;                             // turn coordinate
    const ti = Math.min(turns - 1, Math.floor(tf));
    const u = (adv[ti] + (tf - ti) * (adv[ti + 1] - adv[ti])) / acc;
    const ang = tf * Math.PI * 2;
    const sag = 0.06 * Math.sin(u * Math.PI);       // the coil dips between its end anchors
    pts.push(a.clone().addScaledVector(dir, u * len)
      .addScaledVector(side, Math.cos(ang) * r * rng.range(0.97, 1.03))
      .add(new THREE.Vector3(0, r + Math.sin(ang) * r - sag, 0)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  // 3-sided tube: the core is 16 mm across and never wider than ~4 px on screen, so the cross-section costs
  // nothing to read and the saved triangles pay for the doubled path resolution.
  ctx.batch.add('wire', prep(new THREE.TubeGeometry(curve, n, 0.0115, 3, false), { uv: 'keep', tint: 0x848b88 }));
  // barb clusters: 4 blades pressed onto the core, alternating orientation along the wire
  const blades: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 2; i < pts.length - 2; i += Math.max(5, Math.round(per * 0.34))) {
    const p = pts[i];
    const t = pts[i + 1].clone().sub(pts[i - 1]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, t);
    for (let k = 0; k < 4; k++) {
      const bl = new THREE.BufferGeometry();
      const L = 0.052, Wd = 0.018;
      // a flat diamond blade lying in the plane through the wire
      const ang = k * Math.PI / 2 + (i % 4) * 0.4;
      const vx = Math.cos(ang), vz = Math.sin(ang);
      const v = [
        -0.012, 0, 0, 0.012, 0, 0, vx * L, Wd * 1.2, vz * L,
        -0.012, 0, 0, vx * L, Wd * 1.2, vz * L, vx * L * 0.55, -Wd, vz * L * 0.55,
      ];
      bl.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
      bl.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2));
      bl.computeVertexNormals();
      bl.applyQuaternion(q); bl.translate(p.x, p.y, p.z);
      blades.push(bl);
    }
  }
  if (blades.length) ctx.batch.add('wire', prep(mergeGeometries(blades, false)!, { uv: 'keep', tint: 0x848c8a }));
}

// ---------------------------------------------------------------- barrels, tires, pallets, crates
export function drumGeo(): THREE.BufferGeometry {
  const prof: [number, number][] = [[0, 0], [0.27, 0], [0.285, 0.02], [0.285, 0.27], [0.3, 0.29], [0.285, 0.31], [0.285, 0.57], [0.3, 0.59], [0.285, 0.61], [0.285, 0.86], [0.27, 0.88], [0.25, 0.88], [0.25, 0.87], [0, 0.87]];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 9);
}
// Faded industrial drums. The old saturated blue / green / red read as painted toys on the sidewalk in
// world_street: a drum that has stood outside for a decade is a chalky, low-chroma version of its paint.
const DRUM_TINTS = [0x565b60, 0x445468, 0x6a5c46, 0x6e4238, 0x4f6050, 0x82817c, 0x33322f];
export function drum(ctx: BuildCtx, x: number, z: number, yaw = 0, tipped = false, y = 0): void {
  const tint = ctx.rng.pick(DRUM_TINTS);
  if (!tipped) {
    ctx.batch.instanced('drum', 'rust', drumGeo, mat4(x, y, z, yaw), tint, { uv: 'keep', uvScale: 1.2 });
    ctx.collideBox(x, y + 0.44, z, 0.58, 0.88, 0.58, 'metal');
    dustPatch(ctx, x, y + 0.002, z, 0.5, 0.45);
    aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(1, 0, 0), 0.62, 0.3, 0.6, 0); aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(-1, 0, 0), 0.62, 0.3, 0.6, 0);
  } else {
    ctx.batch.instanced('drum', 'rust', drumGeo, mat4(x, y + 0.3, z, yaw, 0, Math.PI / 2), tint, { uv: 'keep', uvScale: 1.2 });
    ctx.collideBox(x, y + 0.3, z, 0.9, 0.58, 0.58, 'metal', yaw);
    oilStain(ctx, x + Math.cos(yaw) * 0.6, z - Math.sin(yaw) * 0.6, 0.7, y + 0.004);
  }
}

/**
 * Tire. Unit radius 0.33, width 0.2, axle along local z.
 *
 * Not a torus and not a plain lathe: the carcass profile has a bead seat, a sidewall bulge and a shoulder
 * radius, and the tread band is modulated per angular segment into real blocks separated by lateral grooves
 * plus one circumferential groove. That block pattern is what makes a wheel read as a tyre at 5 m — a smooth
 * ring reads as rubber pipe no matter how it is shaded.
 */
export function tireGeo(): THREE.BufferGeometry {
  // profile in z order (axle direction, half-width 0.1): bead, sidewall bulge, shoulder, tread band, mirrored
  // 7 rings, not 9: the two intermediate tread points only smoothed a band that is 15 mm proud, and 92 wheels
  // pay for every extra ring. Shoulders, the circumferential centre groove and the lateral blocks all survive.
  const pts: [number, number, number][] = [
    [0.195, -0.100, 0], [0.300, -0.086, 0],
    [0.330, -0.072, 1], [0.327, 0.000, 1], [0.330, 0.072, 1],
    [0.300, 0.086, 0], [0.195, 0.100, 0],
  ];
  const S = 12, P = pts.length;
  const pos: number[] = [], uv: number[] = [];
  const vert = (si: number, pi: number) => {
    const a = (si % S) / S * Math.PI * 2;
    const [r0, z, tread] = pts[pi];
    let r = r0;
    if (tread) {
      const block = (si % 3) === 0 ? -0.020 : 0;              // lateral grooves every 3rd segment
      const centre = Math.abs(z) < 0.02 ? -0.014 : 0;          // circumferential groove down the middle
      const stagger = (pi < P / 2 ? 0 : 1);
      const lat = ((si + stagger) % 3) === 0 ? -0.018 : 0;     // staggered halves so the pattern is not a stripe
      r = r0 + Math.min(block, lat) + centre;
    }
    return [Math.cos(a) * r, Math.sin(a) * r, z, a / (Math.PI * 2) * 2.1, (pi / (P - 1)) * 0.42];
  };
  for (let si = 0; si < S; si++) for (let pi = 0; pi < P - 1; pi++) {
    const q = [vert(si, pi), vert(si + 1, pi), vert(si + 1, pi + 1), vert(si, pi + 1)];
    for (const idx of [0, 1, 2, 0, 2, 3]) { pos.push(q[idx][0], q[idx][1], q[idx][2]); uv.push(q[idx][3], q[idx][4]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  return g;
}
export function rimGeo(): THREE.BufferGeometry {
  const prof: [number, number][] = [[0, -0.03], [0.07, -0.075], [0.16, -0.075], [0.185, -0.03], [0.19, 0.06], [0.17, 0.08], [0, 0.08]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 8);
  g.rotateX(Math.PI / 2);
  return g;
}
/** Wheel = tire + rim, axle along yaw's side axis. `flat` deflates the tire. */
export function wheel(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, scale = 1, flat = false, burnt = false, rimTint: THREE.ColorRepresentation = 0x8a8a88, missingTire = false): void {
  const sy = flat ? 0.78 : 1;
  const yy = flat ? y - 0.33 * scale * 0.2 : y;
  if (!missingTire) ctx.batch.instanced('tire', 'rubber', tireGeo, mat4(x, yy, z, yaw, 0, 0, scale, scale * sy), burnt ? 0x1c1a19 : 0x333130, { uv: 'keep' });
  ctx.batch.instanced('rim', 'darkMetal', rimGeo, mat4(x, yy, z, yaw, 0, 0, scale), burnt ? 0x2a2624 : rimTint, { uv: 'keep' });
}
export function tireStack(ctx: BuildCtx, x: number, z: number, n: number, y = 0): void {
  for (let i = 0; i < n; i++) ctx.batch.instanced('tire', 'rubber', tireGeo, mat4(x + ctx.rng.range(-0.03, 0.03), y + 0.1 + i * 0.2, z + ctx.rng.range(-0.03, 0.03), ctx.rng.range(0, 6), Math.PI / 2), 0x2c2a29, { uv: 'keep' });
  ctx.collideBox(x, y + n * 0.1, z, 0.68, n * 0.2, 0.68, 'metal');
  dustPatch(ctx, x, y + 0.002, z, 0.6, 0.45);
}
export function tireFlat(ctx: BuildCtx, x: number, z: number, yaw: number, tilt = 0, y = 0): void {
  ctx.batch.instanced('tire', 'rubber', tireGeo, mat4(x, y + 0.1, z, yaw, Math.PI / 2 + tilt), 0x2c2a29, { uv: 'keep' });
}

export function palletGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) parts.push(new THREE.BoxGeometry(1.2, 0.02, 0.1).translate(0, 0.135, -0.35 + i * 0.175));
  for (let i = 0; i < 3; i++) parts.push(new THREE.BoxGeometry(0.1, 0.09, 0.8).translate(-0.55 + i * 0.55, 0.08, 0));
  for (let i = 0; i < 3; i++) parts.push(new THREE.BoxGeometry(1.2, 0.02, 0.1).translate(0, 0.02, -0.35 + i * 0.35));
  return merge(parts.map(nonIdx))!;
}
export function pallet(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, lean = 0): void {
  ctx.batch.instanced('pallet', 'wood', palletGeo, mat4(x, y, z, yaw, lean), ctx.rng.pick([0xb09a78, 0x9a8a6a, 0x8c7a5a, 0xc0ae90]));
  if (lean === 0) ctx.collideBox(x, y + 0.07, z, 1.2, 0.15, 0.8, 'wood', yaw);
}
export function crate(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, s = 0.6): void {
  ctx.batch.instanced('crate', 'wood', () => {
    const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.96, 0.96, 0.96)];
    for (const [a, b] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) { parts.push(new THREE.BoxGeometry(0.08, 1, 0.08).translate(a, 0, b)); parts.push(new THREE.BoxGeometry(1, 0.08, 0.08).translate(0, a, b)); parts.push(new THREE.BoxGeometry(0.08, 0.08, 1).translate(a, b, 0)); }
    return merge(parts.map(nonIdx))!;
  }, mat4(x, y + s / 2, z, yaw, 0, 0, s), ctx.rng.pick([0xa8946e, 0x8f7c5c, 0xb8a685]));
  ctx.collideBox(x, y + s / 2, z, s, s, s, 'wood', yaw);
  aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), s + 0.1, s * 0.35, 0.55, 0);
  aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)), s + 0.1, s * 0.35, 0.55, 0);
}
/** Olive steel ammo can / crate, 0.5 x 0.3 x 0.32, with lid rim and two rope handles. */
export function ammoCrate(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, open = false): void {
  const parts: THREE.BufferGeometry[] = [tinted(new THREE.BoxGeometry(0.5, 0.28, 0.32).translate(0, 0.14, 0), 0x5a6440)];
  parts.push(tinted(new THREE.BoxGeometry(0.52, 0.03, 0.34).translate(0, 0.295, 0), 0x4d5636));
  parts.push(tinted(new THREE.BoxGeometry(0.5, 0.02, 0.32).translate(0, 0.32, 0), 0x5a6440));
  for (const s of [-1, 1]) { parts.push(tinted(new THREE.BoxGeometry(0.04, 0.04, 0.2).translate(s * 0.27, 0.2, 0), 0x2a2620)); parts.push(tinted(new THREE.BoxGeometry(0.16, 0.06, 0.34).translate(s * 0.1, 0.1, 0), 0x3f4630)); }
  parts.push(tinted(new THREE.BoxGeometry(0.2, 0.08, 0.01).translate(0, 0.16, 0.165), 0xc8c0a0)); // stencil label
  const g = mergeGeometries(parts, false)!;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, open ? 0.06 : 0, 'YXZ'));
  g.applyQuaternion(q); g.translate(x, y, z);
  ctx.batch.add('paintedMetal', prep(g, { keepColor: true }));
  ctx.collideBox(x, y + 0.16, z, 0.5, 0.32, 0.32, 'metal', yaw);
}

// ---------------------------------------------------------------- AC units, tanks, dishes
export function acUnit(ctx: BuildCtx, x: number, y: number, z: number, yaw: number): void {
  ctx.batch.instanced('ac', 'rust', () => {
    const parts: THREE.BufferGeometry[] = [tinted(new THREE.BoxGeometry(0.82, 0.56, 0.32), 0xffffff)];
    // grille slats + fan ring on the front (+z), side louvres, brackets below
    for (let i = 0; i < 6; i++) parts.push(tinted(new THREE.BoxGeometry(0.6, 0.02, 0.02).translate(0.06, -0.2 + i * 0.08, 0.165), 0x555350));
    parts.push(tinted(new THREE.BoxGeometry(0.62, 0.42, 0.01).translate(0.06, 0, 0.162), 0x1c1c1c));
    parts.push(tinted(new THREE.TorusGeometry(0.17, 0.018, 4, 12).translate(0.06, 0, 0.17), 0x8a8884));
    for (let i = 0; i < 3; i++) parts.push(tinted(new THREE.BoxGeometry(0.02, 0.4, 0.22).translate(-0.4, 0, -0.04 + i * 0.02 - 0.02), 0x8c8a86));
    parts.push(tinted(new THREE.BoxGeometry(0.05, 0.05, 0.36).translate(-0.3, -0.31, 0), 0x3a3836));
    parts.push(tinted(new THREE.BoxGeometry(0.05, 0.05, 0.36).translate(0.3, -0.31, 0), 0x3a3836));
    parts.push(tinted(new THREE.BoxGeometry(0.05, 0.42, 0.05).translate(-0.3, -0.5, -0.14), 0x3a3836));
    parts.push(tinted(new THREE.BoxGeometry(0.05, 0.42, 0.05).translate(0.3, -0.5, -0.14), 0x3a3836));
    return mergeGeometries(parts, false)!;
  }, mat4(x, y, z, yaw), ctx.rng.pick([0xd8d4c8, 0xbfb9ac, 0xa9a49a, 0xe2ded2]), { keepColor: true });
  ctx.collideBox(x, y, z, 0.82, 0.56, 0.32, 'metal', yaw);
  // rust drip on the wall below the unit
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  decal(ctx, DECAL.drip, new THREE.Vector3(x - n.x * 0.2, y - 0.9, z - n.z * 0.2), n, 0.7, 1.2, 0, 0.6, 0xffffff, 0.02);
}
export function waterTank(ctx: BuildCtx, x: number, y: number, z: number): void {
  const tint = ctx.rng.pick([0x2d3d5a, 0x1f1f22, 0x6b6b66, 0x2a4a3a, 0x8a8078]);
  ctx.batch.add('paintedMetal', lathe([[0, 0], [0.55, 0], [0.62, 0.15], [0.63, 0.5], [0.61, 0.52], [0.63, 0.54], [0.62, 1.05], [0.55, 1.2], [0.2, 1.3], [0.2, 1.36], [0.16, 1.38], [0, 1.38]], 12, x, y + 0.45, z, { tint, uvScale: 1 }));
  for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]]) ctx.batch.add('darkMetal', box(x + dx, y + 0.24, z + dz, 0.06, 0.48, 0.06, { tint: 0x3a3a3a }));
  ctx.batch.add('darkMetal', box(x, y + 0.02, z, 1.1, 0.04, 1.1, { tint: 0x3a3a3a }));
  ctx.batch.add('darkMetal', box(x, y + 0.46, z, 1.1, 0.04, 0.06, { tint: 0x3a3a3a })); ctx.batch.add('darkMetal', box(x, y + 0.46, z, 0.06, 0.04, 1.1, { tint: 0x3a3a3a }));
  // feed pipe down the side + overflow
  ctx.batch.add('rust', tube([new THREE.Vector3(x + 0.62, y + 0.6, z), new THREE.Vector3(x + 0.72, y + 0.5, z), new THREE.Vector3(x + 0.72, y + 0.05, z), new THREE.Vector3(x + 1.1, y + 0.03, z + 0.2)], 0.025, 8, 5, { tint: 0x8a7a6a, uvScale: 1 }));
  ctx.collideBox(x, y + 0.9, z, 1.25, 1.8, 1.25, 'metal');
}
export function satelliteDish(ctx: BuildCtx, x: number, y: number, z: number, yaw: number): void {
  const d = new THREE.LatheGeometry([new THREE.Vector2(0.01, 0), new THREE.Vector2(0.2, 0.03), new THREE.Vector2(0.35, 0.09), new THREE.Vector2(0.45, 0.16)], 10);
  d.rotateX(Math.PI / 2 - 0.5); d.rotateY(yaw); d.translate(x, y + 0.8, z);
  ctx.batch.add('paintedMetal', prep(d, { tint: 0xd0d0cc, uv: 'keep' }));
  ctx.batch.add('darkMetal', box(x, y + 0.4, z, 0.05, 0.8, 0.05, { tint: 0x3a3a3a }));
  ctx.batch.add('darkMetal', tube([new THREE.Vector3(x, y + 0.8, z), new THREE.Vector3(x + Math.sin(yaw) * 0.35, y + 1.0, z + Math.cos(yaw) * 0.35)], 0.012, 2, 4, { tint: 0x3a3a3a }));
  ctx.batch.add('darkMetal', box(x + Math.sin(yaw) * 0.35, y + 1.0, z + Math.cos(yaw) * 0.35, 0.06, 0.08, 0.06, { tint: 0x2a2a2a }));
}
export function ventPipe(ctx: BuildCtx, x: number, y: number, z: number, h = 1.2): void {
  ctx.batch.add('rust', lathe([[0, 0], [0.09, 0], [0.09, h], [0.15, h], [0.15, h + 0.08], [0.11, h + 0.14], [0, h + 0.14]], 8, x, y, z, { tint: 0x8a7a6a, uvScale: 1 }));
  ctx.batch.add('rust', lathe([[0.1, 0], [0.22, 0], [0.22, 0.06], [0.1, 0.06]], 8, x, y, z, { tint: 0x6a5a4a, uvScale: 1 }));
}
/** Rooftop cable tray / duct run between two points. */
export function duct(ctx: BuildCtx, a: THREE.Vector3, b: THREE.Vector3, r = 0.18): void {
  ctx.batch.add('paintedMetal', tube([a, a.clone().lerp(b, 0.5), b], r, 4, 6, { tint: 0x9a9690, uvScale: 1 }));
  for (const p of [a, b]) ctx.batch.add('darkMetal', box(p.x, p.y - r - 0.1, p.z, 0.08, 0.2, 0.08, { tint: 0x3a3a3a }));
}

// ---------------------------------------------------------------- street furniture
/**
 * T-wall (Jersey/Texas barrier).
 *
 * These are 3.6 m of flat concrete right next to the camera in several poses and shipped as a raw greybox
 * panel — "an untextured olive concrete slab fills 30% of the frame". A precast panel is not featureless: it
 * carries a form-board grain (now from the parallax pass on the concrete material), a splash-dirt band at the
 * foot, a bleached top edge, a lifting lug and two rows of form-tie plugs.
 */
export function tWall(ctx: BuildCtx, x: number, z: number, yaw: number, h = 3.6): void {
  const { rng } = ctx;
  const tint = new THREE.Color().setHSL(0.09, 0.05, rng.range(0.5, 0.66));
  const shade = (_px: number, py: number) => 0.62 + 0.30 * THREE.MathUtils.smoothstep(py, 0.6, 1.7) + 0.14 * THREE.MathUtils.smoothstep(py, 2.6, h + 0.6);
  ctx.batch.add('precast', chamferBox(x, h / 2 + 0.6, z, 2.95, h - 0.6, 0.24, 0.03, { rotY: yaw, tint, damage: 0.2, damageTop: 0.3, segs: [4, 6, 1], aoFn: shade }));
  ctx.batch.add('precast', chamferBox(x, 0.3, z, 3.0, 0.6, 1.1, 0.04, { rotY: yaw, tint, segs: [3, 2, 2], aoFn: shade }));
  {
    // lifting lug at the top and two rows of form-tie plugs
    const nn = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const tg = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    ctx.batch.add('darkMetal', prep(new THREE.TorusGeometry(0.09, 0.016, 3, 8, Math.PI).rotateY(yaw).translate(x, h + 0.58, z), { uv: 'keep', tint: 0x6a6660 }));
    for (const row of [1.15, 2.35]) for (const du of [-0.85, 0, 0.85]) for (const s of [-1, 1]) {
      const p = new THREE.Vector3(x, row, z).addScaledVector(tg, du).addScaledVector(nn, s * 0.121);
      ctx.batch.add('precast', prep(new THREE.CircleGeometry(0.035, 5).lookAt(nn.clone().multiplyScalar(s)).translate(p.x, p.y, p.z), { uv: 'planar', tint: 0x6f6a62 }));
    }
  }
  ctx.collideBox(x, h / 2, z, 3.0, h, 0.24, 'concrete', yaw);
  ctx.collideBox(x, 0.3, z, 3.0, 0.6, 1.1, 'concrete', yaw);
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (const s of [-1, 1]) {
    decal(ctx, DECAL.grime, new THREE.Vector3(x + n.x * s * 0.12, 1.05, z + n.z * s * 0.12), n.clone().multiplyScalar(s), 2.9, 0.9, 0, 0.55);
    decal(ctx, DECAL.streak, new THREE.Vector3(x + n.x * s * 0.121 + Math.cos(yaw) * rng.range(-1.1, 1.1), rng.range(2.0, 3.0), z + n.z * s * 0.121 - Math.sin(yaw) * rng.range(-1.1, 1.1)), n.clone().multiplyScalar(s), rng.range(0.5, 1.0), rng.range(1.2, 2.0), 0, rng.range(0.3, 0.55));
    aoStrip(ctx, new THREE.Vector3(x + n.x * s * 0.55, 0.004, z + n.z * s * 0.55), UP, n.clone().multiplyScalar(s), 3.1, 0.4, 0.55, 0);
  }
  if (rng.next() < 0.5) pocks(ctx, new THREE.Vector3(x + n.x * 0.13, rng.range(1.2, 2.6), z + n.z * 0.13).add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(rng.range(-1, 1))), n, rng.range(0.5, 0.9));
}
export function jerseyBarrier(ctx: BuildCtx, x: number, z: number, yaw: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(-0.4, 0); shape.lineTo(0.4, 0); shape.lineTo(0.4, 0.1); shape.lineTo(0.22, 0.35); shape.lineTo(0.12, 0.81); shape.lineTo(-0.12, 0.81); shape.lineTo(-0.22, 0.35); shape.lineTo(-0.4, 0.1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  g.rotateY(Math.PI / 2); g.translate(-1.2, 0, 0); g.rotateY(yaw); g.translate(x, 0, z);
  ctx.batch.add('precast', prep(g, { tint: new THREE.Color().setHSL(0.1, 0.06, ctx.rng.range(0.5, 0.65)), damage: 0.15, aoFn: (_x, y) => 0.68 + 0.32 * THREE.MathUtils.smoothstep(y, 0, 0.35) }));
  ctx.collideBox(x, 0.4, z, 2.4, 0.81, 0.8, 'concrete', yaw);
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (const s of [-1, 1]) aoStrip(ctx, new THREE.Vector3(x + n.x * s * 0.4, 0.004, z + n.z * s * 0.4), UP, n.clone().multiplyScalar(s), 2.5, 0.35, 0.55, 0);
  // lift-hook holes + a yellow/black chevron band on some
  if (ctx.rng.next() < 0.5) for (const s of [-1, 1]) ctx.batch.add('paint', prep(uvToRect(new THREE.PlaneGeometry(2.2, 0.12), [0, 0, 1, 1]).rotateY(yaw + (s > 0 ? 0 : Math.PI)).translate(x + n.x * s * 0.235, 0.6, z + n.z * s * 0.235), { uv: 'keep', tint: 0xc8a020 }));
}
export function manhole(ctx: BuildCtx, x: number, z: number): void {
  ctx.batch.instanced('manhole', 'rust', () => {
    const parts = [tinted(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 20), 0xffffff)];
    for (let i = 0; i < 5; i++) parts.push(tinted(new THREE.BoxGeometry(0.5, 0.008, 0.03).translate(0, 0.02, -0.2 + i * 0.1), 0x6a6058));
    return mergeGeometries(parts, false)!;
  }, mat4(x, 0.012, z, ctx.rng.range(0, 6)), 0x4a423a, { uv: 'planar', keepColor: true });
}
export function dumpster(ctx: BuildCtx, x: number, z: number, yaw: number): void {
  const tint = ctx.rng.pick([0x2f5a3a, 0x3a4a6a, 0x6a5a3a]);
  ctx.batch.add('paintedMetal', box(x, 0.75, z, 1.8, 1.2, 1.0, { rotY: yaw, tint, damage: 0, segs: [1, 2, 1], aoFn: (_x, y) => 0.75 + 0.25 * THREE.MathUtils.smoothstep(y, 0.15, 0.7) }));
  // lid half open, ribs, wheels
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, yaw, 0));
  ctx.batch.add('paintedMetal', box(x - Math.sin(yaw) * 0.25, 1.55, z - Math.cos(yaw) * 0.25, 1.84, 0.06, 1.04, { quat: q, tint }));
  for (const d of [-0.6, 0, 0.6]) ctx.batch.add('paintedMetal', box(x + d * Math.cos(yaw), 0.75, z - d * Math.sin(yaw), 0.06, 1.1, 1.04, { rotY: yaw, tint }));
  for (const d of [-0.8, 0.8]) ctx.batch.add('darkMetal', box(x + d * Math.cos(yaw), 0.08, z - d * Math.sin(yaw), 0.16, 0.16, 0.9, { rotY: yaw, tint: 0x222 }));
  ctx.collideBox(x, 0.8, z, 1.84, 1.6, 1.04, 'metal', yaw);
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (const s of [-1, 1]) aoStrip(ctx, new THREE.Vector3(x + n.x * s * 0.5, 0.004, z + n.z * s * 0.5), UP, n.clone().multiplyScalar(s), 1.9, 0.4, 0.6, 0);
  // rubbish spilling out
  debrisField(ctx, x + n.x * 0.9, z + n.z * 0.9, 0.6, 0.5, 8, 0, { bricks: false, paper: true, chunkScale: 0.5 });
}
export function bench(ctx: BuildCtx, x: number, z: number, yaw: number): void {
  for (const dy of [0, 0.06]) ctx.batch.add('wood', box(x, 0.45 + dy * 0.0, z + (dy ? 0.14 : -0.1), 1.6, 0.04, 0.16, { rotY: yaw, tint: 0x8a7658 }));
  ctx.batch.add('wood', box(x, 0.78, z + 0.22, 1.6, 0.16, 0.04, { rotY: yaw, tint: 0x8a7658 }));
  for (const d of [-0.7, 0.7]) { ctx.batch.add('darkMetal', box(x + d * Math.cos(yaw), 0.22, z - d * Math.sin(yaw), 0.05, 0.44, 0.4, { rotY: yaw, tint: 0x333 })); ctx.batch.add('darkMetal', box(x + d * Math.cos(yaw), 0.62, z - d * Math.sin(yaw) + 0.2, 0.05, 0.4, 0.05, { rotY: yaw, tint: 0x333 })); }
  ctx.collideBox(x, 0.25, z, 1.6, 0.5, 0.4, 'wood', yaw);
}

/** Power pole with crossarm; returns the cable attach points. */
export function pole(ctx: BuildCtx, x: number, z: number, yaw: number, h = 8): THREE.Vector3[] {
  ctx.batch.add('concrete', lathe([[0, -0.3], [0.16, -0.3], [0.16, 0], [0.12, h], [0, h]], 7, x, 0, z, { tint: 0x9a968c, damage: 0.3, uvScale: 1 }));
  ctx.collideBox(x, h / 2, z, 0.32, h, 0.32, 'concrete');
  ctx.batch.add('wood', box(x, h - 0.7, z, 1.6, 0.1, 0.1, { rotY: yaw, tint: 0x6b5a45 }));
  ctx.batch.add('darkMetal', box(x, h - 0.5, z, 0.04, 0.5, 0.04, { rotY: yaw, tint: 0x333 }));
  // poster scraps + a small transformer box on some poles
  if (ctx.rng.next() < 0.5) ctx.batch.add('paintedMetal', box(x + 0.25, h - 2.2, z, 0.4, 0.6, 0.3, { tint: 0x5a5e62 }));
  const pts: THREE.Vector3[] = [];
  for (const d of [-0.7, 0, 0.7]) {
    const px = x + d * Math.cos(yaw), pz = z - d * Math.sin(yaw);
    const yy = d === 0 ? h + 0.05 : h - 0.65;
    ctx.batch.add('paintedMetal', lathe([[0, 0], [0.05, 0], [0.06, 0.06], [0.04, 0.09], [0.06, 0.13], [0.03, 0.18], [0, 0.18]], 6, px, yy, pz, { tint: 0xd8d0c0, uvScale: 1 }));
    pts.push(new THREE.Vector3(px, yy + 0.18, pz));
  }
  aoStrip(ctx, new THREE.Vector3(x, 0.004, z), UP, new THREE.Vector3(1, 0, 0), 0.5, 0.25, 0.5, 0); aoStrip(ctx, new THREE.Vector3(x, 0.004, z), UP, new THREE.Vector3(-1, 0, 0), 0.5, 0.25, 0.5, 0);
  return pts;
}
export function cables(ctx: BuildCtx, a: THREE.Vector3[], b: THREE.Vector3[]): void {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) ctx.batch.add('darkMetal', cable(a[i], b[i], a[i].distanceTo(b[i]) * 0.045 + ctx.rng.range(0, 0.25), 0.014, { tint: 0x111111 }));
}
export function danglingCable(ctx: BuildCtx, a: THREE.Vector3, ground: THREE.Vector3): void {
  const mid = a.clone().lerp(ground, 0.5); mid.y = a.y - (a.y - ground.y) * 0.65; mid.x += ctx.rng.range(-0.5, 0.5);
  const end = ground.clone(); end.y += 0.02;
  const end2 = ground.clone().add(new THREE.Vector3(ctx.rng.range(-1, 1), 0.02, ctx.rng.range(-1, 1)));
  ctx.batch.add('darkMetal', tube([a, mid, end, end2], 0.014, 8, 4, { tint: 0x111111 }));
}
/** Laundry line between two anchors with hanging cloth (sagging, per-piece colour). */
export function laundryLine(ctx: BuildCtx, a: THREE.Vector3, b: THREE.Vector3, pieces = 4): void {
  const { rng, batch } = ctx;
  const sag = a.distanceTo(b) * 0.03 + 0.1;
  batch.add('darkMetal', cable(a, b, sag, 0.008, { tint: 0x2a2a2a }));
  const yaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
  for (let i = 0; i < pieces; i++) {
    const t = (i + 1) / (pieces + 1) + rng.range(-0.04, 0.04);
    const p = a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
    const w = rng.range(0.3, 0.5), h = rng.range(0.4, 0.8);
    /**
     * A garment hung over the line, not a card pinned to it.
     *
     * The old piece was a near-flat rectangle whose only relief was a 5 cm ripple, so at any distance it read
     * as a coloured quad floating on a wire — two of them were called out as "untextured mint/blue cards" on a
     * roof. It now drapes: the top edge wraps over the wire (so the wire disappears into the fold), the body
     * hangs in two soft vertical folds, the hem swings out and curls, and one corner is lifted by the wind.
     */
    const g = new THREE.PlaneGeometry(w, h, 4, 5);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const wind = rng.range(-1, 1), lean = rng.range(-0.09, 0.09);
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v), py = pos.getY(v);
      const t2 = THREE.MathUtils.clamp(0.5 - py / h, 0, 1);           // 0 at the line, 1 at the hem
      const u2 = px / (w / 2);                                        // -1..1 across
      const fold = Math.cos(u2 * Math.PI * 1.5) * 0.055 * Math.min(1, t2 * 3);
      const drape = t2 < 0.12 ? (1 - t2 / 0.12) * 0.035 : 0;          // the wrap over the wire
      pos.setX(v, px * (1 + 0.3 * t2 * t2) + lean * t2 * h);
      pos.setY(v, py - (0.11 * (1 - u2 * u2) + 0.03 * Math.cos(u2 * 4.5)) * t2 * t2 * h / 0.6);
      pos.setZ(v, fold + drape + wind * 0.09 * t2 * t2 * (0.4 + 0.6 * Math.max(0, u2)) + Math.cos(py * 7 + i) * 0.012);
    }
    g.computeVertexNormals(); g.rotateY(yaw + rng.range(-0.25, 0.25)); g.translate(p.x, p.y - h / 2 + 0.02, p.z);
    // Worn, dusty cloth. The old palette plus the material's 2.2 albedo gain blew two of these to flat mint and
    // pale blue rectangles on a rooftop in render_dusk, which is what got called as "untextured cards".
    batch.add('cloth', prep(g, { uv: 'keep', uvScale: 0.6, tint: rng.pick([0x7a7263, 0x4e5c66, 0x6d6148, 0x5a3b34, 0x3c4657, 0x827a6a, 0x4c5645, 0x655e54]) }));
  }
}

/** Striped awning on a wall: faces `out` (world normal along the band axis). Rusted frame. */
export function awning(ctx: BuildCtx, axis: 'x' | 'z', uc: number, w: number, faceV: number, out: 1 | -1, y: number, depth = 1.4, torn = false): void {
  const g = new THREE.PlaneGeometry(w, depth, 10, 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i);
    const t = (py + depth / 2) / depth; // 0 outer edge .. 1 at wall
    let z = 0.38 * (1 - t) * (1 - t) - 0.38;
    z -= 0.08 * Math.sin((px / w + 0.5) * Math.PI * 4) * (1 - t) * (1 - t);
    z -= 0.05 * Math.sin(t * Math.PI) * Math.cos(px * 2.5); // sag between ribs
    if (torn && px > w * 0.15 && t < 0.4) z -= (0.4 - t) * 1.6 * ((px - w * 0.15) / (w * 0.35));
    pos.setZ(i, z);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2);
  const rotY = axis === 'x' ? (out > 0 ? 0 : Math.PI) : (out > 0 ? -Math.PI / 2 : Math.PI / 2);
  g.rotateY(rotY);
  const nx = axis === 'x' ? 0 : out, nz = axis === 'x' ? out : 0;
  const cx = axis === 'x' ? uc : faceV + nx * depth / 2, cz = axis === 'x' ? faceV + nz * depth / 2 : uc;
  g.translate(cx, y, cz);
  ctx.batch.add('awning', prep(g, { uv: 'keep', uvScale: 1, tint: 0xffffff }));
  for (const d of [-w / 2 + 0.05, w / 2 - 0.05]) {
    const ax = axis === 'x' ? uc + d : faceV, az = axis === 'x' ? faceV : uc + d;
    const bx = ax + nx * depth, bz = az + nz * depth;
    ctx.batch.add('rust', tube([new THREE.Vector3(ax, y + 0.02, az), new THREE.Vector3(bx, y - 0.36, bz)], 0.022, 2, 6, { tint: 0x8a7a6a, uvScale: 1 }));
    ctx.batch.add('rust', tube([new THREE.Vector3(ax, y - 0.9, az), new THREE.Vector3(bx, y - 0.36, bz)], 0.016, 2, 5, { tint: 0x8a7a6a, uvScale: 1 }));
  }
  const fx = axis === 'x' ? uc : faceV + nx * depth, fz = axis === 'x' ? faceV + nz * depth : uc;
  ctx.batch.add('rust', box(fx, y - 0.36, fz, axis === 'x' ? w : 0.04, 0.04, axis === 'x' ? 0.04 : w, { tint: 0x8a7a6a }));
  // shadow band on the wall under the awning
  const n = new THREE.Vector3(nx, 0, nz);
  aoStrip(ctx, new THREE.Vector3(axis === 'x' ? uc : faceV, y - 0.05, axis === 'x' ? faceV : uc), n, new THREE.Vector3(0, -1, 0), w, 0.7, 0.45, 0);
}

// ---------------------------------------------------------------- vehicles
type Part = { g: THREE.BufferGeometry; mat: string; tint: THREE.ColorRepresentation; ao?: boolean };
function emitParts(ctx: BuildCtx, parts: Part[], rot: THREE.Matrix4, x: number, y: number, z: number, aoFn?: (x: number, y: number, z: number) => number): void {
  const merged: Record<string, THREE.BufferGeometry[]> = {};
  for (const p of parts) {
    const g = nonIdx(p.g); if (!g.getAttribute('normal')) g.computeVertexNormals();
    // AO/soot in vehicle-local space before the transform
    const pg = prep(g, { tint: p.tint, damage: 0, aoFn: p.ao === false ? undefined : aoFn, uv: 'keep' });
    pg.applyMatrix4(rot); pg.translate(x, y, z);
    // world-planar uv for textured panels so the rust tiles at world scale
    if (p.mat !== 'glass' && p.mat !== 'carGlass') { const uv = pg.getAttribute('uv') as THREE.BufferAttribute; const pos = pg.getAttribute('position') as THREE.BufferAttribute; const nor = pg.getAttribute('normal') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) { const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i)); if (nx >= ny && nx >= nz) uv.setXY(i, pos.getZ(i), pos.getY(i)); else if (ny >= nz) uv.setXY(i, pos.getX(i), pos.getZ(i)); else uv.setXY(i, pos.getX(i), pos.getY(i)); } pg.setAttribute('uv1', new THREE.BufferAttribute((uv.array as Float32Array).slice(), 2)); }
    (merged[p.mat] ??= []).push(pg);
  }
  for (const [m, gs] of Object.entries(merged)) ctx.batch.addAll(m, gs);
}
/** A flat quad from four corner points (vehicle-local), with 0..1 uv — used for glazing panes. */
function quad3(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], p3: [number, number, number]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = [p0, p1, p2, p0, p2, p3];
  const t: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v.flat()), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(t.flat()), 2));
  g.computeVertexNormals();
  return g;
}

/** Glass with a jagged missing chunk: returns 1-2 shard triangles around the frame of rect (u0,v0)-(u1,v1). */
function glassShards(u0: number, v0: number, u1: number, v1: number, rng: Rng, depth = 0.008): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const w = u1 - u0, h = v1 - v0;
  const corners: [number, number, number, number][] = [[u0, v1, 1, -1], [u1, v1, -1, -1], [u0, v0, 1, 1], [u1, v0, -1, 1]];
  for (const [cx, cy, sx, sy] of corners) {
    if (rng.next() < 0.45) continue;
    const s = new THREE.Shape();
    s.moveTo(cx, cy); s.lineTo(cx + sx * w * rng.range(0.2, 0.5), cy); s.lineTo(cx + sx * w * rng.range(0.05, 0.25), cy + sy * h * rng.range(0.25, 0.6)); s.lineTo(cx, cy + sy * h * rng.range(0.3, 0.7)); s.closePath();
    out.push(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }));
  }
  return out;
}

/**
 * Sedan wreck built from panels: two extruded side profiles (with wheel arches and window cut-outs, driver door
 * missing), hood, roof, trunk, bumpers, lights, grille, interior, one door on the ground, wheels (one flat).
 */
export function car(ctx: BuildCtx, x: number, z: number, yaw: number, burnt: boolean, tint: THREE.ColorRepresentation = 0x8a3a2a, tilt = 0, y = 0): void {
  const { rng } = ctx;
  const parts: Part[] = [];
  const body = burnt ? 'burnt' : 'wreck';
  const paint = tint;
  const dark = burnt ? 0x151312 : 0x2a2826;
  const W = 1.72, side = W / 2;
  const profile = (doorHole: boolean) => {
    const s = new THREE.Shape();
    s.moveTo(-2.15, 0.36); s.lineTo(-1.77, 0.36);
    s.absarc(-1.35, 0.36, 0.42, Math.PI, 0, true);
    s.lineTo(0.93, 0.36);
    s.absarc(1.35, 0.36, 0.42, Math.PI, 0, true);
    s.lineTo(2.15, 0.36); s.lineTo(2.22, 0.6); s.lineTo(2.15, 0.88); s.lineTo(0.85, 0.96); s.lineTo(0.7, 1.02); s.lineTo(0.15, 1.42); s.lineTo(-0.85, 1.44); s.lineTo(-1.4, 1.1); s.lineTo(-2.1, 1.04); s.lineTo(-2.2, 0.76); s.closePath();
    // windows: front door, rear door
    if (!doorHole) { const wf = new THREE.Path(); wf.moveTo(0.08, 1.05); wf.lineTo(0.62, 1.05); wf.lineTo(0.2, 1.36); wf.lineTo(0.08, 1.36); wf.closePath(); s.holes.push(wf); }
    const wr = new THREE.Path(); wr.moveTo(-0.82, 1.05); wr.lineTo(-0.05, 1.05); wr.lineTo(-0.05, 1.37); wr.lineTo(-0.78, 1.37); wr.closePath(); s.holes.push(wr);
    if (doorHole) { const d = new THREE.Path(); d.moveTo(0.1, 0.44); d.lineTo(0.9, 0.44); d.lineTo(0.9, 0.98); d.lineTo(0.72, 1.02); d.lineTo(0.6, 1.36); d.lineTo(0.1, 1.36); d.closePath(); s.holes.push(d); }
    return s;
  };
  const sideL = new THREE.ExtrudeGeometry(profile(true), { depth: 0.06, bevelEnabled: false }); sideL.translate(0, 0, side - 0.06);
  const sideR = new THREE.ExtrudeGeometry(profile(false), { depth: 0.06, bevelEnabled: false }); sideR.translate(0, 0, -side);
  parts.push({ g: sideL, mat: body, tint: paint }, { g: sideR, mat: body, tint: paint });
  // door seams (dark thin strips) on the intact side, fuel cap
  for (const sx of [-0.05, 0.98, -0.9]) parts.push({ g: new THREE.BoxGeometry(0.02, 0.5, 0.01).translate(sx, 0.72, -side - 0.003), mat: body, tint: dark });
  parts.push({ g: new THREE.BoxGeometry(0.02, 0.5, 0.01).translate(-0.9, 0.72, side + 0.003), mat: body, tint: dark });
  // Wheel-arch lips and a swage line: without them the extruded side profile reads as a flat card, which is
  // what has been called an "extrusion" in both rounds. Both are a few triangles each.
  for (const ax of [-1.35, 1.35]) for (const sz of [-1, 1]) {
    const arch = new THREE.TorusGeometry(0.44, 0.035, 3, 7, Math.PI * 1.05).rotateZ(-0.03).rotateY(Math.PI / 2);
    arch.translate(ax, 0.36, sz * (side + 0.01));
    parts.push({ g: arch, mat: body, tint: paint });
    // arch shadow: a dark band tucked just inside the lip
    const inner = new THREE.TorusGeometry(0.40, 0.06, 3, 6, Math.PI).rotateY(Math.PI / 2);
    inner.translate(ax, 0.36, sz * (side - 0.05));
    parts.push({ g: inner, mat: 'burnt', tint: 0x1a1715 });
  }
  for (const sz of [-1, 1]) {
    parts.push({ g: new THREE.BoxGeometry(3.6, 0.05, 0.045).translate(0, 0.80, sz * (side + 0.012)), mat: body, tint: paint });   // swage line
    parts.push({ g: new THREE.BoxGeometry(3.9, 0.10, 0.06).translate(0, 0.40, sz * (side + 0.01)), mat: body, tint: dark });      // rocker / sill
  }
  // hood (slightly crumpled: tilted), cowl, roof, trunk lid (ajar)
  const hood = new THREE.BoxGeometry(1.3, 0.05, W - 0.1, 3, 1, 2); { const pos = hood.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + 0.06 * Math.sin(pos.getX(i) * 4) * (0.5 + hash3(pos.getX(i), 0, pos.getZ(i)))); hood.computeVertexNormals(); hood.rotateZ(-0.06); hood.translate(1.5, 0.94, 0); }
  parts.push({ g: hood, mat: body, tint: paint });
  parts.push({ g: new THREE.BoxGeometry(0.2, 0.04, W - 0.1).translate(0.78, 0.99, 0), mat: body, tint: paint });
  parts.push({ g: new THREE.BoxGeometry(1.0, 0.04, W - 0.08).translate(-0.35, 1.44, 0), mat: body, tint: paint });
  parts.push({ g: new THREE.BoxGeometry(0.72, 0.04, W - 0.1).rotateZ(0.18).translate(-1.75, 1.1, 0), mat: body, tint: paint });
  // front & rear faces, bumpers, grille, lights
  parts.push({ g: new THREE.BoxGeometry(0.06, 0.5, W - 0.1).translate(2.18, 0.62, 0), mat: body, tint: paint });
  parts.push({ g: new THREE.BoxGeometry(0.12, 0.14, W + 0.04).translate(2.24, 0.42, 0), mat: 'darkMetal', tint: burnt ? 0x1a1a1a : 0x6a6a68 });
  parts.push({ g: new THREE.BoxGeometry(0.04, 0.22, 0.7).translate(2.22, 0.72, 0), mat: 'darkMetal', tint: 0x111 });
  for (let i = 0; i < 4; i++) parts.push({ g: new THREE.BoxGeometry(0.02, 0.02, 0.7).translate(2.235, 0.64 + i * 0.05, 0), mat: 'darkMetal', tint: burnt ? 0x222 : 0x9a9a98 });
  for (const s of [-1, 1]) {
    parts.push({ g: new THREE.BoxGeometry(0.04, 0.16, 0.28).translate(2.22, 0.74, s * 0.6), mat: burnt ? 'darkMetal' : 'glass', tint: burnt ? 0x111 : 0xd8e0e8, ao: false });
    parts.push({ g: new THREE.BoxGeometry(0.03, 0.12, 0.3).translate(-2.19, 0.86, s * 0.6), mat: 'glass', tint: 0x8a1a10, ao: false });
  }
  parts.push({ g: new THREE.BoxGeometry(0.06, 0.55, W - 0.1).translate(-2.16, 0.68, 0), mat: body, tint: paint });
  parts.push({ g: new THREE.BoxGeometry(0.12, 0.14, W + 0.04).translate(-2.22, 0.42, 0), mat: 'darkMetal', tint: burnt ? 0x1a1a1a : 0x6a6a68 });
  parts.push({ g: new THREE.BoxGeometry(0.04, 0.09, 0.4).translate(-2.2, 0.6, 0), mat: 'paint', tint: 0xe8e4d8, ao: false }); // plate
  // floor pan, seats, dash, steering wheel
  parts.push({ g: new THREE.BoxGeometry(4.2, 0.06, W - 0.16).translate(0, 0.42, 0), mat: body, tint: dark });
  const seat = burnt ? 0x241f1c : 0x554b41, trim = burnt ? 0x1a1715 : 0x3d3630;
  parts.push({ g: new THREE.BoxGeometry(0.5, 0.36, 0.5).translate(-0.05, 0.62, 0.42), mat: 'burnt', tint: seat }, { g: new THREE.BoxGeometry(0.16, 0.5, 0.5).translate(-0.3, 0.9, 0.42), mat: 'burnt', tint: seat });
  parts.push({ g: new THREE.BoxGeometry(0.5, 0.36, 0.5).translate(-0.05, 0.62, -0.42), mat: 'burnt', tint: seat }, { g: new THREE.BoxGeometry(0.16, 0.5, 0.5).translate(-0.3, 0.9, -0.42), mat: 'burnt', tint: seat });
  parts.push({ g: new THREE.BoxGeometry(0.5, 0.4, W - 0.2).translate(-1.1, 0.64, 0), mat: 'burnt', tint: seat }, { g: new THREE.BoxGeometry(0.16, 0.5, W - 0.2).translate(-1.35, 0.95, 0), mat: 'burnt', tint: seat });
  parts.push({ g: new THREE.BoxGeometry(0.4, 0.3, W - 0.2).translate(0.6, 0.86, 0), mat: 'burnt', tint: trim });
  // headliner under the roof so the cabin is never a silhouette hole
  parts.push({ g: new THREE.BoxGeometry(1.0, 0.02, W - 0.14).translate(-0.35, 1.41, 0), mat: 'burnt', tint: burnt ? 0x1d1a18 : 0x6a6258 });
  parts.push({ g: new THREE.TorusGeometry(0.17, 0.02, 6, 14).rotateY(Math.PI / 2 - 0.4).translate(0.35, 0.98, 0.42), mat: 'darkMetal', tint: 0x1a1a1a });
  // Glazing. A void windshield is the single loudest "extrusion" tell, so every opening gets either a cracked
  // laminated pane or a dark interior card behind it — never a hole onto the skybox.
  const hz = side - 0.09;
  parts.push({ g: quad3([0.68, 1.02, -hz], [0.68, 1.02, hz], [0.17, 1.40, hz], [0.17, 1.40, -hz]), mat: 'burnt', tint: 0x2b2724, ao: false });  // interior card behind the screen
  parts.push({ g: quad3([-0.88, 1.42, -hz], [-0.88, 1.42, hz], [-1.44, 1.08, hz], [-1.44, 1.08, -hz]), mat: 'burnt', tint: 0x2b2724, ao: false });
  if (!burnt) {
    // windscreen: laminated, cracked, still in its frame; rear screen shattered out to a few shards
    parts.push({ g: quad3([0.71, 1.00, -hz], [0.71, 1.00, hz], [0.19, 1.42, hz], [0.19, 1.42, -hz]), mat: 'carGlass', tint: 0xffffff, ao: false });
    parts.push({ g: quad3([-0.05, 1.05, -side - 0.005], [-0.82, 1.05, -side - 0.005], [-0.78, 1.37, -side - 0.005], [-0.05, 1.37, -side - 0.005]), mat: 'carGlass', tint: 0xdfe6e8, ao: false });
    for (const g of glassShards(-1.42, 1.08, -0.86, 1.44, rng)) { g.rotateY(Math.PI / 2); parts.push({ g, mat: 'carGlass', tint: 0xffffff, ao: false }); }
    // ground glass spill under the rear screen
  } else {
    for (const g of glassShards(0.19, 1.02, 0.71, 1.4, rng)) { g.rotateY(Math.PI / 2); parts.push({ g, mat: 'carGlass', tint: 0x8a8f90, ao: false }); }
  }
  // fallen driver door on the ground beside the car
  const door = new THREE.BoxGeometry(0.82, 0.55, 0.05); door.rotateX(Math.PI / 2 - 0.1); door.rotateY(0.4); door.translate(0.9, 0.04, side + 0.7);
  parts.push({ g: door, mat: body, tint: paint });
  parts.push({ g: new THREE.BoxGeometry(0.55, 0.32, 0.03).rotateX(Math.PI / 2 - 0.1).rotateY(0.4).translate(0.95, 0.06, side + 0.75), mat: 'darkMetal', tint: 0x1a1a1a });
  const rot = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(tilt));
  // bake AO: dark under the sills, soot toward the top for burnt wrecks, rust creeping up from the bottom otherwise
  const aoFn = (xx: number, yy: number) => (0.66 + 0.34 * THREE.MathUtils.smoothstep(yy, 0.34, 0.95))
    * (1 - 0.22 * Math.exp(-Math.pow((Math.abs(xx) - 1.35) / 0.5, 2)))                                   // wheel-arch cavity
    * (burnt ? 1 - 0.3 * THREE.MathUtils.smoothstep(yy, 0.9, 1.5) : 1);                                   // soot climbing the pillars
  emitParts(ctx, parts, rot, x, y, z, aoFn);
  // wheels
  const wp: [number, number, boolean, boolean][] = [[-1.35, -0.78, false, burnt && rng.next() < 0.5], [-1.35, 0.78, true, false], [1.35, -0.78, false, false], [1.35, 0.78, false, false]];
  for (const [wx, wz, flat, missing] of wp) {
    const rx = x + wx * Math.cos(yaw) + wz * Math.sin(yaw), rz = z - wx * Math.sin(yaw) + wz * Math.cos(yaw);
    wheel(ctx, rx, y + 0.36, rz, yaw, 1.05, flat, burnt, burnt ? 0x2a2624 : 0x7a7a78, missing);
  }
  ctx.collideBox(x, y + 0.7, z, 4.45, 0.75, W + 0.05, 'metal', yaw);
  ctx.collideBox(x - 0.35 * Math.cos(yaw), y + 1.2, z + 0.35 * Math.sin(yaw), 1.7, 0.5, W - 0.2, 'metal', yaw);
  // contact shadow + ground stains
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (const s of [-1, 1]) aoStrip(ctx, new THREE.Vector3(x + n.x * s * 0.75, y + 0.004, z + n.z * s * 0.75), UP, n.clone().multiplyScalar(s), 4.4, 0.55, 0.6, 0);
  oilStain(ctx, x + Math.cos(yaw) * 1.2, z - Math.sin(yaw) * 1.2, 0.8, y + 0.006);
  debrisField(ctx, x + n.x * 1.3, z + n.z * 1.3, 0.8, 1.6, 10, y, { bricks: false, paper: false, chunkScale: 0.4, glass: true });
}

/** Flatbed truck wreck: chassis rails, axles, cab with panels/doors/glass frames/mirrors, hood, grille, bed, dual wheels, tarp and cargo remains. */
export function truck(ctx: BuildCtx, x: number, z: number, yaw: number, tint: THREE.ColorRepresentation = 0x5a6e7a, roll = 0): void {
  const { rng } = ctx;
  const parts: Part[] = [];
  const body = 'wreck';
  // 0x2a2826 on a 70%-metallic material rendered as a pure black band across the whole nose (bumper + chassis
  // + steps), which is what reads as "no wheels — the body sits on two black struts": the tyres behind it were
  // black too, so nothing separated. Chassis steel is a mid-dark warm grey with dirt on it.
  const dark = 0x4a453e;
  // chassis: two C-rails, cross members, axles, springs, fuel tank, battery box, exhaust
  for (const s of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(7.2, 0.22, 0.08).translate(0.2, 0.72, s * 0.45), mat: 'darkMetal', tint: dark });
  for (const cx of [-3.0, -1.6, -0.2, 1.2, 2.6, 3.6]) parts.push({ g: new THREE.BoxGeometry(0.08, 0.18, 0.9).translate(cx, 0.72, 0), mat: 'darkMetal', tint: dark });
  for (const ax of [4.0, -0.9, -2.1]) { parts.push({ g: new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8).rotateX(Math.PI / 2).translate(ax, 0.5, 0), mat: 'darkMetal', tint: dark }); for (const s of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(1.1, 0.06, 0.08).translate(ax, 0.62, s * 0.55), mat: 'darkMetal', tint: 0x3a3836 }); }
  parts.push({ g: new THREE.CylinderGeometry(0.3, 0.3, 1.1, 12).rotateZ(Math.PI / 2).translate(1.2, 0.55, 1.05), mat: body, tint: 0x9a9a94 });
  parts.push({ g: new THREE.BoxGeometry(0.6, 0.35, 0.4).translate(1.2, 0.6, -1.0), mat: 'darkMetal', tint: dark });
  parts.push({ g: new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8).translate(1.45, 2.4, -1.18), mat: 'rust', tint: 0x6a5a4a });
  parts.push({ g: new THREE.CylinderGeometry(0.1, 0.06, 0.16, 8).translate(1.45, 3.62, -1.18), mat: 'rust', tint: 0x6a5a4a });
  // bed: planks with gaps (a few missing/broken), headboard, slatted sides with posts, rear bumper
  const planks = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
  for (const [i, pz] of planks.entries()) { if (i === 3 && rng.next() < 0.7) continue; const len = i === 1 ? 3.2 : 4.6; parts.push({ g: new THREE.BoxGeometry(len, 0.05, 0.36).translate(-1.1 + (i === 1 ? -0.7 : 0), 0.86, pz), mat: 'wood', tint: rng.pick([0x7a6a50, 0x6f5f47, 0x857458]) }); }
  parts.push({ g: new THREE.BoxGeometry(0.06, 1.1, 2.3).translate(1.2, 1.45, 0), mat: body, tint });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) { if (s > 0 && i === 3) continue; parts.push({ g: new THREE.BoxGeometry(4.6, 0.14, 0.04).translate(-1.1, 1.05 + i * 0.22, s * 1.17), mat: 'wood', tint: 0x8a7a5a }); }
    for (let i = 0; i < 4; i++) parts.push({ g: new THREE.BoxGeometry(0.06, 0.95, 0.08).translate(-3.2 + i * 1.4, 1.4, s * 1.17), mat: 'darkMetal', tint: dark });
    parts.push({ g: new THREE.BoxGeometry(4.7, 0.1, 0.12).translate(-1.1, 0.83, s * 1.2), mat: 'darkMetal', tint: dark });
  }
  parts.push({ g: new THREE.BoxGeometry(0.1, 0.12, 2.5).translate(-3.5, 0.6, 0), mat: 'darkMetal', tint: dark });
  for (const s of [-1, 1]) { parts.push({ g: new THREE.BoxGeometry(0.03, 0.3, 0.5).translate(-3.5, 0.4, s * 0.9), mat: 'rubber', tint: 0x111 }); parts.push({ g: new THREE.BoxGeometry(0.04, 0.1, 0.16).translate(-3.53, 0.78, s * 1.05), mat: 'glass', tint: 0x8a1a10, ao: false }); }
  // cab: side panels with door window cut-outs (extruded), roof, back, floor, hood, fenders, front
  const cabProfile = (doorOpen: boolean) => {
    const s = new THREE.Shape();
    s.moveTo(1.45, 0.85); s.lineTo(3.35, 0.85); s.lineTo(3.4, 1.7); s.lineTo(3.3, 2.5); s.lineTo(2.95, 2.95); s.lineTo(1.5, 3.0); s.closePath();
    if (!doorOpen) { const w = new THREE.Path(); w.moveTo(1.75, 2.05); w.lineTo(2.65, 2.05); w.lineTo(2.8, 2.8); w.lineTo(1.75, 2.85); w.closePath(); s.holes.push(w); }
    else { const d = new THREE.Path(); d.moveTo(1.7, 0.95); d.lineTo(2.75, 0.95); d.lineTo(2.85, 2.85); d.lineTo(1.7, 2.9); d.closePath(); s.holes.push(d); }
    return s;
  };
  const cabL = new THREE.ExtrudeGeometry(cabProfile(true), { depth: 0.06, bevelEnabled: false }); cabL.translate(0, 0, 1.15 - 0.06);
  const cabR = new THREE.ExtrudeGeometry(cabProfile(false), { depth: 0.06, bevelEnabled: false }); cabR.translate(0, 0, -1.15);
  parts.push({ g: cabL, mat: body, tint }, { g: cabR, mat: body, tint });
  // open door swung out on the left, with its window frame
  const door = new THREE.BoxGeometry(1.05, 1.9, 0.05); door.translate(0.525, 0, 0); door.rotateY(-1.1); door.translate(1.7, 1.93, 1.18);
  parts.push({ g: door, mat: body, tint });
  parts.push({ g: new THREE.BoxGeometry(0.06, 0.06, 0.06).translate(0, 0, 0), mat: 'darkMetal', tint: dark }); // dummy tiny hinge (keeps merge stable)
  parts.push({ g: quad3([3.36, 0.85, 1.15], [3.36, 0.85, -1.15], [3.31, 2.50, -1.15], [3.31, 2.50, 1.15]), mat: body, tint });     // cab front panel (wound to face +x)
  parts.push({ g: new THREE.BoxGeometry(0.06, 0.10, 2.3).translate(3.34, 2.46, 0), mat: body, tint: dark });                       // cowl lip under the screen
  parts.push({ g: new THREE.BoxGeometry(1.5, 0.06, 2.3).translate(2.22, 2.98, 0), mat: body, tint });
  parts.push({ g: new THREE.BoxGeometry(0.06, 2.1, 2.3).translate(1.48, 1.95, 0), mat: body, tint });
  parts.push({ g: new THREE.BoxGeometry(1.9, 0.06, 2.3).translate(2.4, 0.88, 0), mat: body, tint: dark });
  // door seam on the intact side + handles + steps
  parts.push({ g: new THREE.BoxGeometry(0.015, 1.9, 0.01).translate(1.72, 1.93, -1.155), mat: body, tint: dark });
  parts.push({ g: new THREE.BoxGeometry(0.015, 1.9, 0.01).translate(2.8, 1.93, -1.155), mat: body, tint: dark });
  parts.push({ g: new THREE.BoxGeometry(0.16, 0.04, 0.03).translate(2.6, 1.9, -1.17), mat: 'darkMetal', tint: 0x8a8a88 });
  for (const s of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(0.9, 0.05, 0.3).translate(2.2, 0.6, s * 1.25), mat: 'darkMetal', tint: dark });
  // windshield frame + glass shards, dash, seats, wheel
  parts.push({ g: new THREE.BoxGeometry(0.05, 0.06, 2.3).translate(3.3, 2.5, 0), mat: body, tint }, { g: new THREE.BoxGeometry(0.05, 0.06, 2.3).translate(2.95, 2.95, 0), mat: body, tint });
  parts.push({ g: new THREE.BoxGeometry(0.05, 0.5, 0.06).rotateZ(0.6).translate(3.12, 2.72, 0), mat: body, tint: dark }); // centre mullion
  // Windshield: a cracked laminated pane in the raked frame (3.35,2.5)-(2.95,2.95), backed by a dark
  // headliner card so the cab never reads as a hole punched through the truck.
  const wz = 1.09;
  parts.push({ g: quad3([3.25, 2.52, -wz], [3.25, 2.52, wz], [2.90, 2.92, wz], [2.90, 2.92, -wz]), mat: 'burnt', tint: 0x231f1c, ao: false });
  parts.push({ g: quad3([3.33, 2.50, -wz], [3.33, 2.50, wz], [2.96, 2.94, wz], [2.96, 2.94, -wz]), mat: 'carGlass', tint: 0xffffff, ao: false });
  // side window on the intact side + rear cab window
  parts.push({ g: quad3([1.78, 2.06, -1.16], [2.66, 2.06, -1.16], [2.79, 2.80, -1.16], [1.78, 2.84, -1.16]), mat: 'carGlass', tint: 0xe4ebee, ao: false });
  parts.push({ g: quad3([1.50, 2.15, -0.6], [1.50, 2.15, 0.6], [1.50, 2.80, 0.6], [1.50, 2.80, -0.6]), mat: 'burnt', tint: 0x2a2622, ao: false });
  parts.push({ g: new THREE.BoxGeometry(0.5, 0.4, 2.1).translate(3.0, 2.2, 0), mat: 'burnt', tint: 0x3a332c });
  parts.push({ g: new THREE.BoxGeometry(1.5, 0.03, 2.2).translate(2.22, 2.94, 0), mat: 'burnt', tint: 0x6a6156 });
  for (const s of [-0.55, 0.55]) parts.push({ g: new THREE.BoxGeometry(0.6, 0.4, 0.7).translate(2.1, 1.3, s), mat: 'burnt', tint: 0x55493d }, { g: new THREE.BoxGeometry(0.16, 0.7, 0.7).translate(1.75, 1.85, s), mat: 'burnt', tint: 0x55493d });
  parts.push({ g: new THREE.TorusGeometry(0.22, 0.025, 6, 16).rotateY(Math.PI / 2 - 0.5).translate(2.7, 2.05, 0.55), mat: 'darkMetal', tint: 0x1a1a1a });
  // hood (crumpled), fenders, grille with bars, headlights, bumper, mirrors
  const hood = new THREE.BoxGeometry(1.3, 0.06, 2.1, 3, 1, 2); { const pos = hood.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + 0.08 * (hash3(pos.getX(i), 1, pos.getZ(i)) - 0.3)); hood.computeVertexNormals(); hood.rotateZ(0.12); hood.translate(4.0, 1.78, 0); }
  parts.push({ g: hood, mat: body, tint });
  for (const s of [-1, 1]) { parts.push({ g: new THREE.BoxGeometry(1.3, 0.85, 0.06).translate(4.0, 1.3, s * 1.07), mat: body, tint }); parts.push({ g: new THREE.BoxGeometry(0.8, 0.1, 0.35).translate(3.4, 1.35, s * 1.2), mat: body, tint }); }
  // Grille: a recessed panel behind a bezel with bars standing proud of it, not a black plate with a decal.
  parts.push({ g: new THREE.BoxGeometry(0.05, 0.72, 1.66).translate(4.58, 1.35, 0), mat: 'burnt', tint: 0x14120f, ao: false });   // dark recess
  for (const [oy, oz, sy, sz] of [[0.40, 0, 0.08, 1.78], [-0.40, 0, 0.08, 1.78], [0, 0.87, 0.88, 0.08], [0, -0.87, 0.88, 0.08]] as [number, number, number, number][]) {
    parts.push({ g: new THREE.BoxGeometry(0.12, sy, sz).translate(4.66, 1.35 + oy, oz), mat: body, tint });                        // bezel
  }
  for (let i = 0; i < 6; i++) parts.push({ g: new THREE.BoxGeometry(0.07, 0.035, 1.6).translate(4.66, 1.05 + i * 0.12, 0), mat: 'darkMetal', tint: 0x8f8f8c });
  for (const s of [-1, 1]) {
    parts.push({ g: new THREE.CylinderGeometry(0.175, 0.175, 0.1, 10).rotateZ(Math.PI / 2).translate(4.63, 1.45, s * 0.95), mat: body, tint });                      // headlight bezel
    parts.push({ g: new THREE.CylinderGeometry(0.14, 0.10, 0.09, 10).rotateZ(Math.PI / 2).translate(4.66, 1.45, s * 0.95), mat: 'darkMetal', tint: 0xb4b2ac });       // reflector cone
    parts.push({ g: new THREE.CylinderGeometry(0.14, 0.14, 0.015, 10).rotateZ(Math.PI / 2).translate(4.705, 1.45, s * 0.95), mat: 'carGlass', tint: 0xd8e0e8, ao: false });
  }
  parts.push({ g: new THREE.BoxGeometry(0.16, 0.2, 2.5).translate(4.76, 0.86, 0), mat: 'wreck', tint: 0x7c766c });   // pressed-steel bumper, rusted, not a black bar
  for (const s of [-1, 1]) { parts.push({ g: new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).rotateX(Math.PI / 2).translate(3.2, 2.35, s * 1.4), mat: 'darkMetal', tint: dark }); parts.push({ g: new THREE.BoxGeometry(0.05, 0.32, 0.21).translate(3.2, 2.35, s * 1.62), mat: 'darkMetal', tint: dark }); parts.push({ g: new THREE.BoxGeometry(0.01, 0.27, 0.17).translate(3.235, 2.35, s * 1.62), mat: 'carGlass', tint: 0xb8c4c8, ao: false }); }
  parts.push({ g: new THREE.BoxGeometry(0.05, 0.12, 0.5).translate(3.36, 1.0, 0), mat: 'paint', tint: 0xe8e4d8, ao: false });
  // tarp remains over the rear of the bed (sagging, torn) + cargo
  const tarp = new THREE.PlaneGeometry(2.3, 2.6, 6, 6); { const pos = tarp.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), py = pos.getY(i); pos.setZ(i, -0.35 * Math.cos(px / 2.3 * Math.PI) * Math.cos(py / 2.6 * Math.PI) + 0.06 * Math.sin(px * 5) + (py < -0.9 ? (py + 0.9) * 0.5 : 0)); } tarp.computeVertexNormals(); tarp.rotateX(-Math.PI / 2); tarp.translate(-2.3, 1.75, 0); }
  parts.push({ g: tarp, mat: 'fabric', tint: 0x5a5a40, ao: false });
  for (const s of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(-2.3 + s * 1.0, 1.3, s * 0.9), mat: 'darkMetal', tint: dark });
  const rot = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(roll));
  emitParts(ctx, parts, rot, x, 0, z, (_x, yy) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(yy, 0.45, 1.3));
  // wheels: single front, dual rear on two axles
  /**
   * Wheels: single front axle, dual rear on two axles.
   *
   * The front axle used to sit at x = 3.4, under the cab and 1.35 m behind the bumper — so from the front (the
   * framing in world_intersection) the fenders and bumper hid both front tyres completely and the truck read as
   * a body on two black struts. It now sits at 4.0, directly under the fender arches, on a slightly wider track
   * so the tyre shoulder stands proud of the bodywork.
   */
  const wheels: [number, number, boolean][] = [[4.0, -1.14, false], [4.0, 1.14, true], [-0.9, -1.0, false], [-0.9, -1.28, false], [-0.9, 1.0, false], [-0.9, 1.28, false], [-2.1, -1.0, false], [-2.1, -1.28, false], [-2.1, 1.0, false], [-2.1, 1.28, true]];
  for (const [wx, wz, flat] of wheels) {
    const rx = x + wx * Math.cos(yaw) + wz * Math.sin(yaw), rz = z - wx * Math.sin(yaw) + wz * Math.cos(yaw);
    wheel(ctx, rx, 0.5, rz, yaw, 1.5, flat, false, 0x5a5a58);
  }
  // cargo remains on the bed
  const cg = (lx: number, lz: number) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)] as [number, number];
  const [d1x, d1z] = cg(-0.3, -0.5); drum(ctx, d1x, d1z, yaw + 0.3, false, 0.89);
  const [d2x, d2z] = cg(-0.4, 0.5); drum(ctx, d2x, d2z, yaw + 1.0, true, 0.89);
  const [c1x, c1z] = cg(0.6, 0.2); crate(ctx, c1x, 0.89, c1z, yaw + 0.2, 0.7);
  const [a1x, a1z] = cg(0.4, -0.7); ammoCrate(ctx, a1x, 0.89, a1z, yaw + 0.4);
  ctx.collideBox(x - 1.1 * Math.cos(yaw), 1.0, z + 1.1 * Math.sin(yaw), 4.8, 2.0, 2.5, 'metal', yaw);
  ctx.collideBox(x + 2.9 * Math.cos(yaw), 1.6, z - 2.9 * Math.sin(yaw), 3.8, 3.0, 2.4, 'metal', yaw);
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (const s of [-1, 1]) aoStrip(ctx, new THREE.Vector3(x + n.x * s * 1.15 + Math.cos(yaw) * 0.2, 0.004, z + n.z * s * 1.15 - Math.sin(yaw) * 0.2), UP, n.clone().multiplyScalar(s), 7.2, 0.7, 0.6, 0);
  oilStain(ctx, x + Math.cos(yaw) * 2.5, z - Math.sin(yaw) * 2.5, 1.1, 0.006);
  tireTrack(ctx, x - Math.cos(yaw) * 6, z + Math.sin(yaw) * 6, yaw + Math.PI / 2, 7, 0.005);
  debrisField(ctx, x + n.x * 1.8, z + n.z * 1.8, 1.0, 2.5, 14, 0, { bricks: false, paper: true, chunkScale: 0.5, glass: true });
}

// ---------------------------------------------------------------- debris & rubble
export interface DebrisOpts { bricks?: boolean; paper?: boolean; chunkScale?: number; glass?: boolean; groundFn?: (x: number, z: number) => number; dust?: boolean; cluster?: number }
/**
 * Place one fractured chunk as unique merged geometry (not an instance).
 *
 * Debris is the one prop class where instancing is the wrong trade: a handful of instanced kinds is exactly
 * what the critic reads as "one prim cloned 30x", and each kind also costs a draw call. Generating the mesh
 * per piece makes every fragment unique — its own random cuts, its own break faces — and merging them into
 * the material bucket costs *fewer* draw calls than the instanced version did.
 */
function putChunk(ctx: BuildCtx, mat: string, kind: ChunkKind, seed: number, x: number, y: number, z: number, s: number, rx: number, ry: number, rz: number, tint: THREE.Color): void {
  const g = chunkGeo(kind, ctx.rng, seed);
  g.scale(s, s, s);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  ctx.batch.add(mat, place(g, x, y, z, { quat: q, keepColor: true, tint }));
}

/**
 * Debris scatter.
 *
 * Round 2 replaced the dodecahedron clones with ~30 identical flat tan panels — the same clone defect in a new
 * shape. This version draws from six fractured chunk kinds (clump / slab / shard / wedge / plaster / brick),
 * each generated with its own random cuts so no two pieces share a mesh, and then varies the *placement* as
 * much as the geometry:
 *   - log-normal sizes clustered in a few Gaussian clumps, the rest scattered,
 *   - ~35% partially buried (sunk by up to 45% of the piece height),
 *   - ~25% tipped onto an edge or leaning rather than lying flat,
 *   - per-piece albedo over a ±22% band with a hue jitter,
 *   - paper is crumpled and folded, never a flat card, and capped at a few per field.
 */
export function debrisField(ctx: BuildCtx, cx: number, cz: number, rx: number, rz: number, count: number, y = 0, opts: DebrisOpts = {}): void {
  const { rng } = ctx;
  const gy = opts.groundFn ?? (() => y);
  const nClusters = opts.cluster ?? Math.max(1, Math.round(Math.sqrt(count) / 2));
  const centers: [number, number][] = [];
  for (let k = 0; k < nClusters; k++) { const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 0.8; centers.push([cx + Math.cos(a) * r * rx, cz + Math.sin(a) * r * rz]); }
  if (opts.dust ?? true) for (const [ccx, ccz] of centers) dustPatch(ctx, ccx, gy(ccx, ccz) + 0.004, ccz, Math.min(rx, rz) * rng.range(0.35, 0.6), 0.5);
  const n = Math.round(count * 0.55);
  const cs = opts.chunkScale ?? 1;
  // value band kept well under 1: a fragment tinted brighter than its own albedo reads as flat cardboard
  const stone = () => new THREE.Color().setHSL(0.075 + rng.range(-0.02, 0.02), rng.range(0.03, 0.11), rng.range(0.45, 0.88));
  /** log-normal size around `mid`, clamped */
  const size = (mid: number, sigma: number, lo: number, hi: number) => THREE.MathUtils.clamp(Math.exp(Math.log(mid) + sigma * rng.gauss()), lo, hi) * cs;
  let papers = 0;
  for (let i = 0; i < n; i++) {
    let x: number, z: number;
    if (rng.next() < 0.7) { const c = rng.pick(centers); x = c[0] + rng.gauss() * rx * 0.3; z = c[1] + rng.gauss() * rz * 0.3; }
    else { const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()); x = cx + Math.cos(a) * r * rx; z = cz + Math.sin(a) * r * rz; }
    if (Math.abs(x - cx) > rx || Math.abs(z - cz) > rz) continue;
    const gyy = gy(x, z);
    const k = rng.next();
    // orientation: flat-ish, leaning, or fully on edge
    const lean = rng.next();
    const tipX = lean < 0.16 ? rng.range(0.9, 1.9) : lean < 0.42 ? rng.range(0.25, 0.7) : rng.range(-0.16, 0.16);
    const tipZ = lean < 0.42 ? rng.range(-0.4, 0.4) : rng.range(-0.16, 0.16);
    const yaw = rng.range(0, 6);
    const buried = rng.next() < 0.35;
    const sink = (sc: number, lo: number, hi: number) => buried ? sc * rng.range(lo, hi) : 0.01;
    if (k < 0.15) {
      const sc = size(0.5, 0.35, 0.28, 1.0);
      putChunk(ctx, 'debris', 'clump', i * 7, x, gyy - sink(sc, 0.08, 0.3), z, sc, tipX * 0.35, yaw, tipZ * 0.35, stone());
    } else if (k < 0.36) {
      const sc = size(0.4, 0.5, 0.12, 1.15);
      putChunk(ctx, 'debris', 'slab', i * 11, x, gyy - sink(sc, 0.1, 0.45), z, sc, tipX, yaw, tipZ, stone());
    } else if (k < 0.55) {
      const sc = size(0.42, 0.45, 0.14, 1.0);
      putChunk(ctx, 'debris', 'shard', i * 13, x, gyy - sink(sc, 0.1, 0.5), z, sc, tipX, yaw, tipZ, stone());
    } else if (k < 0.68) {
      const sc = size(0.45, 0.4, 0.15, 1.0);
      putChunk(ctx, 'debris', 'wedge', i * 17, x, gyy - sink(sc, 0.1, 0.4), z, sc, tipX, yaw, tipZ, stone());
    } else if (k < 0.76) {
      const sc = size(0.5, 0.4, 0.18, 1.05);
      putChunk(ctx, 'debris', 'plaster', i * 19, x, gyy - sink(sc, 0.05, 0.3), z, sc, tipX, yaw, tipZ, new THREE.Color().setHSL(0.09, rng.range(0.04, 0.13), rng.range(0.5, 0.9)));
    } else if (k < 0.93 && (opts.bricks ?? true)) {
      putChunk(ctx, 'brickSolid', 'brick', i * 23, x, gyy - (buried ? rng.range(0.005, 0.03) : 0), z, rng.range(0.8, 1.1), lean < 0.3 ? rng.range(-1.6, 1.6) : 0, yaw, tipZ, new THREE.Color().setHSL(0.03, rng.range(0.3, 0.5), rng.range(0.45, 0.9)));
    } else if (k < 0.965 && opts.glass) {
      ctx.batch.add('glass', prep(new THREE.PlaneGeometry(rng.range(0.06, 0.2), rng.range(0.05, 0.16)).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, gyy + 0.004, z), { uv: 'keep', tint: 0xffffff }));
    } else if ((opts.paper ?? true) && papers < 4) {
      papers++;
      ctx.batch.add('paper', prep(crumpledPaper(rng, x, gyy, z), { uv: 'keep', tint: new THREE.Color().setHSL(0.09, 0.17, rng.range(0.26, 0.46)) }));
    }
  }
}

/** A sheet of paper/card that has been walked on: folded along one line, curled at the corners, never flat. */
function crumpledPaper(rng: Rng, x: number, y: number, z: number): THREE.BufferGeometry {
  const slot = rng.int(0, 3);
  const sc = rng.range(0.3, 0.6);
  const g = new THREE.PlaneGeometry(0.3 * sc, 0.32 * sc, 3, 3);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let j = 0; j < uv.count; j++) uv.setXY(j, (slot % 2) * 0.5 + uv.getX(j) * 0.5, 0.5 - Math.floor(slot / 2) * 0.5 + uv.getY(j) * 0.5);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const fa = rng.range(0, Math.PI), fx = Math.cos(fa), fy = Math.sin(fa), fold = rng.range(0.25, 0.75) * sc;
  for (let j = 0; j < pos.count; j++) {
    const px = pos.getX(j), py = pos.getY(j);
    const t = px * fx + py * fy;                                     // signed distance to the fold line
    const lift = t > 0 ? t * fold * 2.6 : 0;                          // one half stands up
    pos.setZ(j, lift + Math.sin(px * 22) * 0.008 + Math.cos(py * 17) * 0.008 + Math.max(0, Math.abs(px) + Math.abs(py) - 0.1 * sc) * 0.25);
  }
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2); g.rotateZ(rng.range(-0.25, 0.25)); g.rotateY(rng.range(0, 6));
  g.translate(x, y + 0.004, z);
  return g;
}

/** Exposed rebar sticking out of broken concrete: thin, bent, rusty. */
export function rebar(ctx: BuildCtx, x: number, y: number, z: number, dir: THREE.Vector3, len: number): void {
  const { rng } = ctx;
  const d = dir.clone().normalize();
  const pts = [new THREE.Vector3(x, y, z)];
  let p = pts[0].clone();
  const cur = d.clone();
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    cur.add(new THREE.Vector3(rng.range(-0.45, 0.45), rng.range(-0.55, 0.1), rng.range(-0.45, 0.45))).normalize();
    p = p.clone().addScaledVector(cur, len / segs); pts.push(p);
  }
  // #4 rebar is 12.7 mm; at 9 mm and a bright orange tint it rendered as a 1 px unlit polyline hanging out of
  // the concrete. 15 mm with a dark iron-oxide tint gives it a lit side and a shaded side at 5 m.
  const OX = new THREE.Color().setHSL(0.045, rng.range(0.34, 0.5), rng.range(0.13, 0.22)).getHex();
  ctx.batch.add('rust', tube(pts, 0.0155, 6, 4, { tint: OX, uvScale: 1 }));
  if (rng.next() < 0.4) { const e = pts[pts.length - 1]; ctx.batch.add('rust', tube([e, e.clone().add(new THREE.Vector3(rng.range(-0.2, 0.2), -0.05, rng.range(-0.2, 0.2)))], 0.0155, 2, 4, { tint: OX, uvScale: 1 })); }
}

/** Rubble mound: rough displaced heightfield (0.2 m noise) + clumps, slabs, rebar, gravel skirt. */
export function rubbleMound(ctx: BuildCtx, x: number, z: number, rx: number, rz: number, h: number, y0 = 0): void {
  const hf = (px: number, pz: number) => { const d = Math.hypot((px - x) / rx, (pz - z) / rz); const base = Math.max(0, h * (1 - d * d)); return y0 + base * (0.5 + 0.5 * fbm2(px * 1.3, pz * 1.3)) + base * 0.35 * (fbm2(px * 4.2, pz * 4.2) - 0.5) + base * 0.15 * (noise2(px * 9, pz * 9) - 0.5) + (d < 1 ? 0.01 : 0); };
  const g = heightField(x - rx, z - rz, x + rx, z + rz, 0.2, hf, { tint: 0xcfc8bc, aoFn: (px, py) => 0.8 + 0.2 * THREE.MathUtils.smoothstep(py - y0, 0, h * 0.6) + 0 * px });
  ctx.batch.add('rubble', g);
  ctx.collideMesh(g, 'concrete');
  gravelPatch(ctx, x, z, rx * 1.35, rz * 1.35, y0 + 0.006, 0.8);
  debrisField(ctx, x, z, rx * 0.9, rz * 0.9, Math.round(rx * rz * 14), y0, { bricks: true, chunkScale: 0.8, groundFn: (px, pz) => hf(px, pz) - 0.02, dust: false });
  for (let i = 0; i < Math.round(rx * rz * 1.5); i++) { const px = x + ctx.rng.range(-rx, rx) * 0.6, pz = z + ctx.rng.range(-rz, rz) * 0.6; rebar(ctx, px, hf(px, pz) - 0.05, pz, new THREE.Vector3(ctx.rng.range(-0.6, 0.6), 1, ctx.rng.range(-0.6, 0.6)), ctx.rng.range(0.4, 0.9)); }
}
/** Interior debris pile in a room corner: small mound of plaster + bricks + a broken shelf/plank. */
export function debrisPile(ctx: BuildCtx, x: number, y: number, z: number, r = 1.2, h = 0.35): void {
  const hf = (px: number, pz: number) => { const d = Math.hypot(px - x, pz - z) / r; return y + Math.max(0, h * (1 - d * d)) * (0.6 + 0.5 * fbm2(px * 3, pz * 3)) + 0.005; };
  const g = heightField(x - r, z - r, x + r, z + r, 0.2, hf, { tint: 0xd8d2c6 });
  ctx.batch.add('rubble', g); ctx.collideMesh(g, 'plaster');
  debrisField(ctx, x, z, r * 0.9, r * 0.9, Math.round(r * r * 16), y, { bricks: true, chunkScale: 0.6, groundFn: (px, pz) => hf(px, pz) - 0.02, paper: true });
  ctx.batch.add('wood', box(x + ctx.rng.range(-0.3, 0.3), y + h * 0.6, z + ctx.rng.range(-0.3, 0.3), 1.4, 0.04, 0.25, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(ctx.rng.range(-0.2, 0.2), ctx.rng.range(0, 6), ctx.rng.range(0.15, 0.35))), tint: 0x7a6248 }));
}

// ---------------------------------------------------------------- interior furniture
/**
 * Backdrop for an unlit opening.
 *
 * A doorway or garage mouth with an unlit room behind it renders as pure #000 — a hole punched in the wall
 * rather than a dark interior, which is round 3's "black voids ... no interior geometry and no AO gradient at
 * the opening". This is an *unlit* quad (no light needed) at a low value with a vertical gradient: brighter
 * near the floor where the sun bounces in off the ground, falling to near-black at the head. It sits at the
 * back of the real room, so nothing floats and nothing occludes.
 */
export function voidBack(ctx: BuildCtx, x: number, y: number, z: number, w: number, h: number, yaw: number, level = 1): void {
  const g = new THREE.PlaneGeometry(w, h, 1, 3).toNonIndexed();   // colours must be written after the split
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;                  // 0 floor .. 1 head
    const v = (0.052 - 0.042 * t * t) * level;
    col[i * 4] = v * 1.06; col[i * 4 + 1] = v; col[i * 4 + 2] = v * 0.92; col[i * 4 + 3] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.rotateY(yaw); g.translate(x, y + h / 2, z);
  ctx.batch.add('voidFill', prep(g, { uv: 'keep', keepColor: true }));
}

/** Steel/wood shelving unit with goods (boxes, cans, bottles) — instanced kind 'shelf'. */
export function shelfUnit(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, lean = 0): void {
  ctx.batch.instanced('shelf', 'wood', () => {
    const parts: THREE.BufferGeometry[] = [];
    const frame = 0x8a7256;
    for (const s of [-0.5, 0.5]) parts.push(tinted(new THREE.BoxGeometry(0.04, 1.9, 0.4).translate(s, 0.95, 0), frame));
    parts.push(tinted(new THREE.BoxGeometry(1.0, 1.9, 0.02).translate(0, 0.95, -0.19), 0x6b5a45));
    const goods: [number, number, number][] = [[0xb8a070, 0.2, 0.25], [0xc84a3a, 0.16, 0.2], [0xe8e0d0, 0.12, 0.3], [0x3a6a9a, 0.14, 0.22], [0x8a9a5a, 0.18, 0.18], [0xd8c8a0, 0.22, 0.14], [0x4a3a2a, 0.1, 0.28]];
    let gi = 0;
    for (let k = 0; k < 4; k++) {
      const sy = 0.12 + k * 0.5;
      parts.push(tinted(new THREE.BoxGeometry(1.0, 0.03, 0.4).translate(0, sy, 0), frame));
      let gx = -0.44;
      while (gx < 0.4) {
        const [col, w, h] = goods[gi++ % goods.length];
        if (hash3(gx, sy, k) < 0.55) { parts.push(tinted(hash3(gx, k, sy) < 0.4 ? new THREE.CylinderGeometry(w * 0.5, w * 0.5, h, 8).translate(gx + w / 2, sy + 0.015 + h / 2, -0.04) : new THREE.BoxGeometry(w, h, 0.25).translate(gx + w / 2, sy + 0.015 + h / 2, -0.03), col)); }
        gx += w + 0.04;
      }
    }
    return mergeGeometries(parts, false)!;
  }, mat4(x, y, z, yaw, 0, lean), 0xffffff, { keepColor: true });
  ctx.collideBox(x, y + 0.95, z, 1.0, 1.9, 0.4, 'wood', yaw);
  aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 1.05, 0.3, 0.55, 0);
}
/** Wooden chair; `over` lays it on its back/side. */
export function chair(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, over = false): void {
  const parts: THREE.BufferGeometry[] = [nonIdx(new THREE.BoxGeometry(0.42, 0.035, 0.42).translate(0, 0.45, 0))];
  for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) parts.push(nonIdx(new THREE.BoxGeometry(0.035, 0.45, 0.035).translate(a, 0.225, b)));
  for (const a of [-0.18, 0.18]) parts.push(nonIdx(new THREE.BoxGeometry(0.035, 0.5, 0.035).translate(a, 0.72, -0.19)));
  parts.push(nonIdx(new THREE.BoxGeometry(0.42, 0.14, 0.03).translate(0, 0.9, -0.19)));
  parts.push(nonIdx(new THREE.BoxGeometry(0.42, 0.04, 0.03).translate(0, 0.65, -0.19)));
  const g = mergeGeometries(parts, false)!;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(over ? -Math.PI / 2 + 0.1 : 0, yaw, 0, 'YXZ'));
  g.applyQuaternion(q); g.translate(x, y + (over ? 0.2 : 0), z);
  ctx.batch.add('wood', prep(g, { tint: ctx.rng.pick([0x8a7256, 0x6b5238, 0xa08a68]), aoFn: (_x, yy) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(yy - y, 0, 0.6) }));
  if (!over) ctx.collideBox(x, y + 0.45, z, 0.45, 0.9, 0.45, 'wood', yaw);
}
export function table(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, w = 1.4, d = 0.8): void {
  ctx.batch.add('wood', box(x, y + 0.74, z, w, 0.05, d, { rotY: yaw, tint: 0x8a7256 }));
  for (const [dx, dz] of [[-w / 2 + 0.06, -d / 2 + 0.06], [w / 2 - 0.06, -d / 2 + 0.06], [-w / 2 + 0.06, d / 2 - 0.06], [w / 2 - 0.06, d / 2 - 0.06]]) ctx.batch.add('wood', box(x + dx * Math.cos(yaw) + dz * Math.sin(yaw), y + 0.36, z - dx * Math.sin(yaw) + dz * Math.cos(yaw), 0.06, 0.72, 0.06, { tint: 0x6b5238 }));
  ctx.collideBox(x, y + 0.4, z, w, 0.78, d, 'wood', yaw);
  aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), w, d * 0.5, 0.3, 0); aoStrip(ctx, new THREE.Vector3(x, y + 0.003, z), UP, new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), w, d * 0.5, 0.3, 0);
}
/** Stained mattress (pillowed box) — instanced 'mattress'. */
/**
 * Discarded mattress. Shipped as a smooth pale box and was called out as "a raw untextured white cuboid on the
 * roof" in render_dusk. A mattress reads by its *tufting*: button dimples pulling the ticking down in a grid,
 * a rolled welt seam around the perimeter, a sag along the middle and heavy staining.
 */
export function mattress(ctx: BuildCtx, x: number, y: number, z: number, yaw: number, tint: THREE.ColorRepresentation = 0x6a6053, lean = 0): void {
  const g = new THREE.BoxGeometry(1.9, 0.22, 0.95, 6, 1, 4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const u = px / 0.95, w = pz / 0.475;
    const tuft = Math.cos(u * Math.PI * 2.5) * Math.cos(w * Math.PI * 1.5);      // button grid
    const sag = 1 - 0.16 * (1 - u * u) * (1 - w * w);                            // slumped middle
    const welt = 1 + 0.07 * Math.exp(-Math.pow((Math.abs(py) - 0.11) / 0.05, 2)); // rolled edge seam
    const k = 1 - 0.10 * (u * u * 0.25 + w * w) / 2;
    pos.setXYZ(i, px * (1 - 0.045 * w * w) * welt, py * k * sag * (py > 0 ? 0.9 - 0.075 * tuft : 1 + 0.04 * tuft), pz * (1 - 0.045 * u * u * 0.25) * welt);
  }
  g.computeVertexNormals();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, lean, 'YXZ'));
  g.applyQuaternion(q); g.translate(x, y + 0.11, z);
  // stains: darker toward the edges and wherever it has been rained on
  ctx.batch.add('fabric', prep(g, { tint, aoFn: (px, py, pz) => 0.72 + 0.34 * THREE.MathUtils.clamp(fbm2((px - x) * 2.4 + 7, (pz - z) * 2.4), 0, 1) * (0.5 + 0.5 * THREE.MathUtils.smoothstep(py - y, 0.0, 0.2)) }));
  if (lean === 0) ctx.collideBox(x, y + 0.11, z, 1.9, 0.22, 0.95, 'sandbag', yaw);
  dustPatch(ctx, x, y + 0.004, z, 1.15, 0.4);
}
/** Wire hanging from a ceiling point, optionally with a bare bulb / broken lamp shade. */
export function hangingWire(ctx: BuildCtx, x: number, y: number, z: number, len: number, lamp = false): void {
  const { rng } = ctx;
  const pts = [new THREE.Vector3(x, y, z)];
  let p = pts[0].clone(); const cur = new THREE.Vector3(rng.range(-0.15, 0.15), -1, rng.range(-0.15, 0.15)).normalize();
  for (let i = 0; i < 4; i++) { cur.add(new THREE.Vector3(rng.range(-0.25, 0.25), rng.range(-0.1, 0.05), rng.range(-0.25, 0.25))).normalize(); p = p.clone().addScaledVector(cur, len / 4); pts.push(p); }
  ctx.batch.add('darkMetal', tube(pts, 0.008, 6, 4, { tint: 0x111111 }));
  if (lamp) { const e = pts[pts.length - 1]; ctx.batch.add('paintedMetal', lathe([[0, 0], [0.04, 0], [0.16, -0.14], [0.17, -0.15], [0.05, -0.02], [0, -0.02]], 12, e.x, e.y, e.z, { tint: 0x9a9a90, uvScale: 1 })); ctx.batch.add('glass', prep(new THREE.SphereGeometry(0.035, 8, 6).translate(e.x, e.y - 0.12, e.z), { tint: 0xf0f0e8 })); }
}
/** Cheap steel/wood scaffold: bays along yaw, levels of 2 m, planks + ladder + torn tarp. */
export function scaffold(ctx: BuildCtx, x: number, z: number, yaw: number, bays: number, levels: number, y = 0): void {
  const { rng, batch } = ctx;
  const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), side = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const bay = 2.0, depth = 1.1, lvl = 2.0, h = levels * lvl + 0.4;
  const at = (u: number, v: number) => new THREE.Vector3(x, 0, z).addScaledVector(dir, u).addScaledVector(side, v);
  for (let i = 0; i <= bays; i++) for (const v of [0, depth]) { const p = at(i * bay, v); batch.add('darkMetal', box(p.x, y + h / 2, p.z, 0.05, h, 0.05, { tint: 0x5a5c5e })); ctx.collideBox(p.x, y + h / 2, p.z, 0.08, h, 0.08, 'metal'); }
  for (let l = 1; l <= levels; l++) {
    const yy = y + l * lvl;
    for (const v of [0, depth]) { const a = at(0, v), b = at(bays * bay, v); batch.add('darkMetal', tube([a.clone().setY(yy), b.clone().setY(yy)], 0.024, 1, 4, { tint: 0x5a5c5e })); }
    for (let i = 0; i <= bays; i++) { const a = at(i * bay, 0), b = at(i * bay, depth); batch.add('darkMetal', tube([a.clone().setY(yy), b.clone().setY(yy)], 0.024, 1, 4, { tint: 0x5a5c5e })); }
    for (let i = 0; i < bays; i++) { if (rng.next() < 0.25 && l < levels) continue; for (let k = 0; k < 3; k++) { const p = at((i + 0.5) * bay, 0.2 + k * 0.35); batch.add('wood', box(p.x, yy + 0.03, p.z, bay - 0.05, 0.05, 0.3, { rotY: yaw, tint: rng.pick([0x9a8468, 0x7d6b52, 0xa89a80]) })); } ctx.collideBox(at((i + 0.5) * bay, depth / 2).x, yy + 0.03, at((i + 0.5) * bay, depth / 2).z, bay, 0.06, depth, 'wood', yaw); }
    // diagonal brace
    const a = at(0, -0.02).setY(yy - lvl), b = at(bay, -0.02).setY(yy); batch.add('darkMetal', tube([a, b], 0.02, 1, 4, { tint: 0x5a5c5e }));
  }
  // tarp hanging off one bay
  const tp = at(bays * bay - 1.0, depth + 0.05);
  const g = new THREE.PlaneGeometry(1.15, 1.8, 3, 5);
  { const pos = g.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) { const py = pos.getY(i); pos.setZ(i, 0.1 * Math.sin(py * 4) + 0.06 * Math.cos(pos.getX(i) * 6)); pos.setX(i, pos.getX(i) * (1 + 0.06 * Math.sin(py * 3))); } g.computeVertexNormals(); g.rotateY(yaw + Math.PI / 2); g.translate(tp.x, y + levels * lvl - 1.35, tp.z); }
  batch.add('cloth', prep(g, { uv: 'keep', uvScale: 0.7, tint: rng.pick([0x3a444c, 0x46493c, 0x504740]) }));
  // debris netting stub along the top rail so the tarp reads as attached
  batch.add('darkMetal', box(tp.x, y + levels * lvl - 0.14, tp.z, 1.2, 0.04, 0.04, { rotY: yaw, tint: 0x4a4c4e }));
}
/** Two-wheel hand cart with a load of sacks. */
export function cart(ctx: BuildCtx, x: number, z: number, yaw: number, y = 0): void {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q), side = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const c = new THREE.Vector3(x, y, z);
  ctx.batch.add('wood', box(c.x, y + 0.62, c.z, 1.6, 0.05, 0.9, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0.12)), tint: 0x8a7256 }));
  for (const s of [-1, 1]) { const p = c.clone().addScaledVector(side, s * 0.45); ctx.batch.add('wood', box(p.x, y + 0.78, p.z, 1.6, 0.25, 0.03, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0.12)), tint: 0x7a6248 })); }
  for (const s of [-1, 1]) { const p = c.clone().addScaledVector(dir, 1.05).addScaledVector(side, s * 0.25); ctx.batch.add('wood', box(p.x, y + 0.72, p.z, 0.7, 0.04, 0.04, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0.2)), tint: 0x7a6248 })); }
  for (const s of [-1, 1]) { const p = c.clone().addScaledVector(dir, -0.2).addScaledVector(side, s * 0.52); wheel(ctx, p.x, y + 0.33, p.z, yaw, 1.0, false, false, 0x8a8a88); }
  ctx.batch.add('darkMetal', tube([c.clone().addScaledVector(dir, -0.2).addScaledVector(side, -0.55).setY(y + 0.33), c.clone().addScaledVector(dir, -0.2).addScaledVector(side, 0.55).setY(y + 0.33)], 0.03, 2, 6, { tint: 0x333 }));
  for (let i = 0; i < 3; i++) { const p = c.clone().addScaledVector(dir, -0.4 + i * 0.4).addScaledVector(side, (i - 1) * 0.15); ctx.batch.instanced('sandbag', 'hessian', sandbagGeo, mat4(p.x, y + 0.78 + (i === 1 ? 0.18 : 0), p.z, yaw + ctx.rng.range(-0.4, 0.4), 0, 0.12, 1.3), 0xb8a888, { uv: 'keep', uvScale: SB_L }); }
  ctx.collideBox(x, y + 0.5, z, 1.7, 1.0, 1.1, 'wood', yaw);
}

// ---------------------------------------------------------------- nature-ish
/** Dead tree: tapered trunk with recursive branching (cones), bark-dark wood material. */
export function deadTree(ctx: BuildCtx, x: number, z: number, y = 0, height = 5.5, seed = 1): void {
  const rng = ctx.rng;
  const parts: THREE.BufferGeometry[] = [];
  const branch = (p: THREE.Vector3, d: THREE.Vector3, len: number, r0: number, depth: number) => {
    const r1 = r0 * (depth === 0 ? 0.15 : 0.55);
    const g = new THREE.CylinderGeometry(r1, r0, len, depth > 1 ? 8 : 5, 1);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
    g.applyQuaternion(q); g.translate(p.x, p.y, p.z);
    parts.push(nonIdx(g));
    if (depth === 0) return;
    const end = p.clone().addScaledVector(d, len);
    const n = depth > 1 ? rng.int(2, 3) : rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const nd = d.clone().add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(0.1, 0.6), rng.range(-0.9, 0.9))).normalize();
      branch(end.clone().addScaledVector(d, -len * rng.range(0, 0.25)), nd, len * rng.range(0.5, 0.75), r1 * rng.range(0.8, 1.0), depth - 1);
    }
  };
  branch(new THREE.Vector3(x, y, z), new THREE.Vector3(rng.range(-0.1, 0.1), 1, rng.range(-0.1, 0.1)), height * 0.45, 0.22 + seed * 0, 3);
  // root flare
  parts.push(nonIdx(new THREE.CylinderGeometry(0.22, 0.4, 0.3, 8).translate(x, y + 0.15, z)));
  ctx.batch.add('wood', prep(mergeGeometries(parts, false)!, { tint: 0x3a2e24, aoFn: (_x, yy) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(yy - y, 0, 1.2) }));
  ctx.collideBox(x, y + height * 0.3, z, 0.5, height * 0.6, 0.5, 'wood');
  aoStrip(ctx, new THREE.Vector3(x, y + 0.004, z), UP, new THREE.Vector3(1, 0, 0), 0.9, 0.4, 0.5, 0); aoStrip(ctx, new THREE.Vector3(x, y + 0.004, z), UP, new THREE.Vector3(-1, 0, 0), 0.9, 0.4, 0.5, 0);
}
/** Stone well with a timber frame, crossbar and bucket. */
export function well(ctx: BuildCtx, x: number, z: number, y = 0): void {
  ctx.batch.add('stone', lathe([[0.7, 0], [1.0, 0], [1.02, 0.85], [0.98, 0.9], [0.7, 0.9], [0.7, 0.1]], 12, x, y, z, { tint: 0xc8c0b0, damage: 0.2, uv: 'planar', aoFn: (_x, yy) => 0.75 + 0.25 * THREE.MathUtils.smoothstep(yy - y, 0, 0.4) }));
  ctx.batch.add('concrete', lathe([[0.68, 0.9], [1.04, 0.9], [1.04, 0.98], [0.68, 0.98]], 12, x, y, z, { tint: 0xd0cabe, uv: 'planar' }));
  ctx.collideBox(x, y + 0.45, z, 2.0, 0.95, 2.0, 'concrete');
  for (const s of [-1, 1]) ctx.batch.add('wood', box(x + s * 0.85, y + 1.4, z, 0.1, 1.1, 0.1, { tint: 0x5a4a38 }));
  ctx.batch.add('wood', tube([new THREE.Vector3(x - 0.9, y + 1.9, z), new THREE.Vector3(x + 0.9, y + 1.9, z)], 0.05, 1, 5, { tint: 0x5a4a38, uvScale: 1 }));
  for (const s2 of [-1, 1]) ctx.batch.add('wood', box(x + s2 * 0.24, y + 2.02, z, 0.56, 0.035, 0.62, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s2 * 0.5)), tint: 0x8a7458 }));
  ctx.batch.add('darkMetal', tube([new THREE.Vector3(x + 0.2, y + 1.88, z), new THREE.Vector3(x + 0.2, y + 1.15, z)], 0.006, 2, 4, { tint: 0x222 }));
  ctx.batch.add('rust', lathe([[0, 0], [0.12, 0], [0.14, 0.22], [0.12, 0.22], [0.11, 0.02], [0, 0.02]], 8, x + 0.2, y + 0.95, z, { tint: 0x6a5a4a, uvScale: 1 }));
}

// ---------------------------------------------------------------- distant city (skyline) — everything in the 'skyline' bucket
/** Remap uv of a geometry (0..1 space) into an atlas cell. */
function toCell(g: THREE.BufferGeometry, cell: number): THREE.BufferGeometry { return uvToRect(g, facadeUv(cell)); }
interface SkyStyle { style: number; cellW: number; storey: number; roof: number; tintBase: THREE.Color }
/**
 * Bay/storey multiplier by distance.
 *
 * Round 2 called the far ring "untextured slabs with a stamped window grid": at lod 3 a cell was 12 x 10.5 m,
 * so a whole facade was 1-3 stamps of the same atlas tile and the storey rhythm disappeared. Facade quads are
 * ~2 tris each, so keeping the cells near their real size costs almost nothing and buys back the storey read.
 */
function lodStep(x: number, z: number): number { const d = Math.hypot(x, z); return d > 170 ? 3.2 : d > 110 ? 2.1 : d > 70 ? 1.35 : 1; }
const SKY_ROOT = new THREE.Vector3();
/**
 * One distant building block: 4 facades of atlas cells (one cell per bay per storey), roof quad, parapet, roof
 * furniture. Local origin at the footprint centre on the ground; yaw about y.
 */
export function distantBuilding(ctx: BuildCtx, x: number, z: number, w: number, d: number, h: number, yaw: number, st: SkyStyle, opts: { ground?: boolean; setback?: boolean; furniture?: number } = {}): void {
  const { rng, batch } = ctx;
  const geos: THREE.BufferGeometry[] = [];
  const litGeos: THREE.BufferGeometry[] = [];
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  const lod = lodStep(x, z);
  const cellW = st.cellW * lod, storeyH = st.storey * lod;
  const rows = Math.max(1, Math.round(h / storeyH));
  const hh = rows * storeyH;
  // per-building cast (some blocks are sun-bleached, some are soot-stained) plus per-face variation: ±15%
  const cast = new THREE.Color().setHSL(rng.range(0.06, 0.11), rng.range(0.02, 0.09), 0.5).multiplyScalar(2 * rng.range(0.92, 1.06));
  const faceTint = () => st.tintBase.clone().multiply(cast).multiplyScalar(rng.range(0.85, 1.15));
  const face = (len: number, cx: number, cz: number, nx: number, nz: number, towardLevel: boolean) => {
    const cols = Math.max(1, Math.round(len / cellW));
    const cw = len / cols;
    const tint = faceTint();
    // A fully blank face on a block the player can see is what read as "a debug quad grid": 12 identical
    // stamped cells with nothing to break them. Only faces turned away from the level are allowed to go blank.
    const blankFace = !towardLevel && rng.next() < 0.2;
    // vertical structure: a service core / blank bay and a mechanical band, so a tower is not one repeated stamp
    const coreCol = rng.int(0, Math.max(0, cols - 1));
    const coreWide = cols > 5 && rng.next() < 0.5;
    const mechRow = rows > 4 ? rng.int(1, rows - 2) : -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let cell: number;
      const k = rng.next();
      const inCore = c === coreCol || (coreWide && c === coreCol + 1);
      if (st.style === 3) cell = blankFace || k < 0.35 ? FACADE_BRICK_BLANK : FACADE_BRICK_WINDOW;
      else if (r === 0 && opts.ground && towardLevel && k < 0.7) cell = st.style * 4 + FACADE_CELL.ground;
      else if (blankFace || inCore || r === mechRow || k < 0.12) cell = st.style * 4 + FACADE_CELL.blank;
      else if (k < 0.28) cell = st.style * 4 + FACADE_CELL.broken;
      else if (st.style === 1 && k < 0.5) cell = 5; // balcony bay
      else if (st.style === 2 && k < 0.62) cell = 11; // deep ribbon glazing (taller band) mixed with the standard bay
      else cell = st.style * 4 + FACADE_CELL.window;
      const q = toCell(new THREE.PlaneGeometry(cw, storeyH), cell);
      q.rotateY(Math.atan2(nx, nz));
      const u = (c + 0.5) / cols - 0.5;
      const px = cx + (-nz) * u * len, pz = cz + nx * u * len; // tangent = (-nz, nx)
      q.translate(px, (r + 0.5) * storeyH, pz);
      /**
       * Lit window for dusk.
       *
       * A city at sunset is carried by scattered lit windows (ref_07, ref_10, ref_12) and render_dusk had none
       * anywhere. These are unlit quads on a separate material whose colour the level drives from the sun's
       * elevation, so they are invisible in daylight and cost nothing but two triangles each. The quad is sized
       * to a real window (~1.5 x 1.3 m) rather than to the LOD cell, so the far ring reads as dots, not slabs.
       */
      if (!isBlankCell(cell) && rng.next() < (towardLevel ? 0.2 : 0.11)) {
        const lw = Math.min(cw * 0.5, 1.35), lh = Math.min(storeyH * 0.4, 1.1);
        const lit = new THREE.PlaneGeometry(lw, lh);
        lit.rotateY(Math.atan2(nx, nz));
        lit.translate(px + nx * 0.05, (r + 0.5) * storeyH + storeyH * 0.06, pz + nz * 0.05);
        // tungsten / fluorescent mix, ±35% brightness, so the wall of windows is not one flat value
        const k2 = rng.next(), b = rng.range(0.65, 1.35);
        const lc = (k2 < 0.72 ? new THREE.Color(1.0, 0.72, 0.40) : new THREE.Color(0.78, 0.86, 0.92)).multiplyScalar(b);
        litGeos.push(tinted(lit, lc));
      }
      // darker ground rows, a slight top-lightening (dust and sky bounce), per-bay variation
      const shade = (0.7 + 0.3 * Math.min(1, r / 2)) * (1 + 0.1 * (r / Math.max(1, rows - 1))) * rng.range(0.87, 1.13);
      const col = new Float32Array(4 * 4); const t = tint.clone().multiplyScalar(shade);
      for (let i = 0; i < 4; i++) { col[i * 4] = t.r; col[i * 4 + 1] = t.g; col[i * 4 + 2] = t.b; col[i * 4 + 3] = 1; }
      q.setAttribute('color', new THREE.BufferAttribute(col, 4));
      geos.push(q.toNonIndexed());
      // balcony slab sticking out of balcony bays
      // projecting balcony slabs only on the ring the player can actually resolve
      if (cell === 5 && lod < 1.2) { const b = toCell(new THREE.BoxGeometry(cw * 0.8, 0.18, 1.1), st.style * 4 + FACADE_CELL.blank); b.rotateY(Math.atan2(nx, nz)); b.translate(px + nx * 0.55, r * storeyH + storeyH * 0.42, pz + nz * 0.55); geos.push(tinted(b, tint)); }
    }
  };
  const toLevel = (nx: number, nz: number) => (nx * -x + nz * -z) > 0;
  face(w, 0, d / 2, 0, 1, toLevel(Math.sin(yaw), Math.cos(yaw)));
  face(w, 0, -d / 2, 0, -1, toLevel(-Math.sin(yaw), -Math.cos(yaw)));
  face(d, w / 2, 0, 1, 0, toLevel(Math.cos(yaw), -Math.sin(yaw)));
  face(d, -w / 2, 0, -1, 0, toLevel(-Math.cos(yaw), Math.sin(yaw)));
  // roof + parapet
  const roofTint = new THREE.Color(0xffffff).multiplyScalar(rng.range(0.8, 1.0));
  const roof = toCell(new THREE.PlaneGeometry(w, d), st.roof); roof.rotateX(-Math.PI / 2); roof.translate(0, hh, 0); geos.push(tinted(roof, roofTint));
  const ph = rng.range(0.5, 1.2), blank = st.style === 3 ? FACADE_BRICK_BLANK : st.style * 4 + FACADE_CELL.blank;
  for (const [pw, pd, px, pz] of [[w, 0.3, 0, d / 2 - 0.15], [w, 0.3, 0, -d / 2 + 0.15], [0.3, d, w / 2 - 0.15, 0], [0.3, d, -w / 2 + 0.15, 0]]) geos.push(tinted(toCell(new THREE.BoxGeometry(pw, ph, pd), blank).translate(px, hh + ph / 2, pz), faceTint()));
  /**
   * Roof furniture and crown.
   *
   * A distant block is read almost entirely by its silhouette against the sky, so this runs at every LOD —
   * cutting it on the far ring is exactly what made those towers read as slabs. Everything here is a handful
   * of triangles; the whole far ring costs less than one hero prop.
   */
  const nFurn = Math.max(1, Math.round((opts.furniture ?? rng.int(3, 6)) / (lod > 1.2 ? 2 : 1)));
  const placeOnRoof = (g: THREE.BufferGeometry, gw: number, gd: number, gh: number, tint: THREE.ColorRepresentation, y = hh) => {
    const rx = rng.range(-w / 2 + gw / 2 + 0.6, w / 2 - gw / 2 - 0.6), rz = rng.range(-d / 2 + gd / 2 + 0.6, d / 2 - gd / 2 - 0.6);
    g.translate(rx, y + gh / 2, rz); geos.push(tinted(g, tint));
  };
  // stair bulkhead + plant room (always: it is the first thing that breaks a flat roofline)
  placeOnRoof(toCell(new THREE.BoxGeometry(3, 2.6, 3.4), blank), 3, 3.4, 2.6, faceTint().multiplyScalar(0.95));
  if (rng.next() < 0.55) placeOnRoof(toCell(new THREE.BoxGeometry(rng.range(3, 6), rng.range(1.6, 3.2), rng.range(3, 5)), blank), 6, 5, 3.2, faceTint().multiplyScalar(0.9));
  // stepped crown on a third of the blocks: a taller parapet band on one edge only
  if (rng.next() < 0.34) {
    const ch = rng.range(1.2, 3.0), which = rng.int(0, 3);
    const [cw, cd, cx2, cz2] = which === 0 ? [w, 1.2, 0, d / 2 - 0.6] : which === 1 ? [w, 1.2, 0, -d / 2 + 0.6] : which === 2 ? [1.2, d, w / 2 - 0.6, 0] : [1.2, d, -w / 2 + 0.6, 0];
    geos.push(tinted(toCell(new THREE.BoxGeometry(cw, ch, cd), blank).translate(cx2, hh + ph + ch / 2, cz2), faceTint()));
  }
  for (let i = 0; i < nFurn; i++) {
    const k = rng.next();
    if (k < 0.28) placeOnRoof(toCell(new THREE.CylinderGeometry(0.9, 0.9, rng.range(1.2, 2.4), 8), st.roof), 1.8, 1.8, 2.4, rng.pick([0x2d3d5a, 0x1f1f22, 0x6b6b66, 0x8a8078]));
    else if (k < 0.5) placeOnRoof(toCell(new THREE.BoxGeometry(rng.range(1.0, 2.2), rng.range(0.8, 1.6), rng.range(0.7, 1.6)), blank), 2.2, 1.6, 1.6, 0xc8c4bc);
    else if (k < 0.78) {
      // mast: a thin pole with two cross arms, the strongest cheap silhouette break there is
      const mh = rng.range(4, 11);
      const mast = toCell(new THREE.BoxGeometry(0.16, mh, 0.16), blank).translate(0, mh / 2, 0);
      const arms = [mast];
      for (let a2 = 0; a2 < 2; a2++) arms.push(toCell(new THREE.BoxGeometry(rng.range(0.8, 1.8), 0.09, 0.09), blank).translate(0, mh * rng.range(0.55, 0.92), 0));
      const m = mergeGeometries(arms, false)!;
      const rx = rng.range(-w / 2 + 0.8, w / 2 - 0.8), rz = rng.range(-d / 2 + 0.8, d / 2 - 0.8);
      m.translate(rx, hh, rz); geos.push(tinted(m, 0x55554f));
    } else { const dish = toCell(new THREE.CircleGeometry(rng.range(0.7, 1.4), 9), blank); dish.rotateX(-Math.PI / 2 + 1.0); dish.rotateY(rng.range(0, 6)); placeOnRoof(dish, 2.8, 2.8, 1.8, 0xd8d8d4); }
  }
  // setback tower on tall blocks
  if (opts.setback && h > 15) {
    const sw = w * rng.range(0.4, 0.6), sd = d * rng.range(0.4, 0.6), sh = rng.range(2, 4) * st.storey;
    const M2 = new THREE.Matrix4().makeTranslation(rng.range(-w * 0.2, w * 0.2), hh, rng.range(-d * 0.2, d * 0.2));
    const sub: THREE.BufferGeometry[] = [];
    const subRows = Math.round(sh / storeyH);
    for (const [len, cx, cz, nx, nz] of [[sw, 0, sd / 2, 0, 1], [sw, 0, -sd / 2, 0, -1], [sd, sw / 2, 0, 1, 0], [sd, -sw / 2, 0, -1, 0]]) {
      const cols = Math.max(1, Math.round(len / cellW)); const cw = len / cols;
      for (let r = 0; r < subRows; r++) for (let c = 0; c < cols; c++) { const q = toCell(new THREE.PlaneGeometry(cw, storeyH), rng.next() < 0.2 ? blank : st.style === 3 ? FACADE_BRICK_WINDOW : st.style * 4 + FACADE_CELL.window); q.rotateY(Math.atan2(nx, nz)); const u = (c + 0.5) / cols - 0.5; q.translate(cx + (-nz) * u * len, (r + 0.5) * storeyH, cz + nx * u * len); sub.push(tinted(q, faceTint())); }
    }
    const r2 = toCell(new THREE.PlaneGeometry(sw, sd), st.roof); r2.rotateX(-Math.PI / 2); r2.translate(0, sh, 0); sub.push(tinted(r2, roofTint));
    for (const g of sub) { g.applyMatrix4(M2); geos.push(g); }
  }
  const merged = mergeGeometries(geos, false)!;
  merged.applyMatrix4(M);
  batch.add('skyline', prep(merged, { uv: 'keep', keepColor: true }));
  if (litGeos.length) { const lm = mergeGeometries(litGeos, false)!; lm.applyMatrix4(M); batch.add('skylineLit', prep(lm, { uv: 'keep', keepColor: true })); }
  void SKY_ROOT;
}
/** Atlas cells that carry no glazing (blank wall / roof / brick blank) — nothing to light at dusk. */
function isBlankCell(cell: number): boolean {
  return cell === FACADE_BRICK_BLANK || cell === FACADE_ROOF_DARK || cell === FACADE_ROOF_LIGHT || cell % 4 === FACADE_CELL.blank;
}
export const SKY_STYLES: SkyStyle[] = [
  { style: 0, cellW: 3.4, storey: 3.1, roof: FACADE_ROOF_DARK, tintBase: new THREE.Color(0xa8a29a) },
  { style: 1, cellW: 3.6, storey: 3.3, roof: FACADE_ROOF_LIGHT, tintBase: new THREE.Color(0xcbb99a) },
  { style: 2, cellW: 4.0, storey: 3.5, roof: FACADE_ROOF_DARK, tintBase: new THREE.Color(0x8a8e94) },
  { style: 3, cellW: 3.4, storey: 3.2, roof: FACADE_ROOF_LIGHT, tintBase: new THREE.Color(0x9c7a6a) },
];
/**
 * City ring at Chebyshev distance D0..D1 from the origin (square rings so blocks line up with the streets), leaving
 * the four street axes open. `count` blocks; heights in [h0,h1] with a few towers (×1.8) when `towers` > 0.
 */
export function cityRing(ctx: BuildCtx, D0: number, D1: number, count: number, heights: [number, number], towers = 0, opts: { ground?: boolean; roadGap?: number } = {}): void {
  const { rng } = ctx;
  const gap = opts.roadGap ?? 10;
  let towerLeft = towers;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const cx = Math.cos(a), cz = Math.sin(a);
    const m = Math.max(Math.abs(cx), Math.abs(cz));
    const D = rng.range(D0, D1);
    const w = rng.range(10, 24), d = rng.range(10, 22);
    let x = (cx / m) * D, z = (cz / m) * D;
    // keep the street axes open
    if (Math.abs(x) < gap + w / 2 && Math.abs(z) > Math.abs(x)) x = Math.sign(x || 1) * (gap + w / 2 + rng.range(0, 3));
    if (Math.abs(z) < gap + d / 2 && Math.abs(x) >= Math.abs(z)) z = Math.sign(z || 1) * (gap + d / 2 + rng.range(0, 3));
    const isTower = towerLeft > 0 && rng.next() < 0.3;
    if (isTower) towerLeft--;
    // Style 2 is a glass office tower: right for the far skyline, wrong for the block next door, so it is kept
    // out of the innermost ring where it would sit behind a plaster courtyard wall.
    const near = D1 < 70;
    const stylePick = isTower ? (rng.next() < 0.75 ? 2 : 0) : rng.next() < 0.45 ? (near ? 1 : 0) : rng.next() < 0.6 ? 1 : rng.next() < 0.5 ? 3 : 0;
    const st = SKY_STYLES[stylePick];
    const h = isTower ? rng.range(heights[1] * 1.5, heights[1] * 2.1) : rng.range(heights[0], heights[1]);
    /**
     * Silhouette variation.
     *
     * Every block used to sit within +/-3 deg of the street grid with a near-square footprint, so the whole
     * ring read as one row of identical prisms no matter what was drawn on them. Blocks now take a real yaw
     * spread and a third of them are long slabs presented edge-on or broadside, which is what makes a skyline
     * read as a city rather than as a wall of boxes.
     */
    const yaw = rng.range(-0.34, 0.34);
    const slab = !isTower && rng.next() < 0.34 ? rng.range(1.5, 2.4) : 1;
    const aspect = isTower ? rng.range(0.45, 1.0) : 1;
    const bw = isTower ? w * 0.72 : w * (rng.next() < 0.5 ? slab : 1);
    const bd = isTower ? d * 0.72 * aspect : d * (bw > w ? 1 : slab);
    distantBuilding(ctx, x, z, bw, bd, h, yaw, st, { ground: opts.ground, setback: rng.next() < (isTower ? 0.7 : 0.45), furniture: rng.int(isTower ? 3 : 2, isTower ? 7 : 5) });
  }
}
export function minaret(ctx: BuildCtx, x: number, z: number, h: number): void {
  const g = mergeGeometries([
    tinted(toCell(new THREE.LatheGeometry([[0, 0], [2.6, 0], [2.6, 3.4], [1.7, 3.6], [1.55, h * 0.7], [1.55, h * 0.72]].map(([r, y]) => new THREE.Vector2(r, y)), 12), 6), 0xd8d0c0),
    tinted(toCell(new THREE.LatheGeometry([[1.5, h * 0.7], [2.3, h * 0.72], [2.3, h * 0.76], [1.35, h * 0.78], [1.35, h * 0.9], [1.9, h * 0.91], [1.9, h * 0.94], [1.1, h * 0.95], [0.9, h * 0.98], [0.5, h + 1.2], [0, h + 2.6]].map(([r, y]) => new THREE.Vector2(r, y)), 12), 6), 0xc9c2b2),
    tinted(toCell(new THREE.BoxGeometry(0.4, h * 0.6, 0.4), 6).translate(0, h * 0.4, 1.6), 0x8a8478),
  ], false)!;
  g.translate(x, 0, z);
  ctx.batch.add('skyline', prep(g, { uv: 'keep', keepColor: true }));
}
/** Mosque block: prayer hall + dome + a minaret. */
export function mosque(ctx: BuildCtx, x: number, z: number, yaw = 0): void {
  const st = SKY_STYLES[1];
  distantBuilding(ctx, x, z, 26, 20, 9, yaw, st, { furniture: 0 });
  const dome = toCell(new THREE.SphereGeometry(6.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), FACADE_ROOF_LIGHT); dome.translate(x, 9.9, z);
  const drum = toCell(new THREE.CylinderGeometry(6.6, 6.6, 1.4, 16), 6); drum.translate(x, 9.6, z);
  const fin = toCell(new THREE.CylinderGeometry(0.1, 0.3, 2.4, 6), 6); fin.translate(x, 17.2, z);
  ctx.batch.add('skyline', prep(mergeGeometries([tinted(dome, 0x6a8a7a), tinted(drum, 0xd8d0c0), tinted(fin, 0xc8b060)], false)!, { uv: 'keep', keepColor: true }));
  minaret(ctx, x + 16, z - 8, 34);
}
export function waterTower(ctx: BuildCtx, x: number, z: number): void {
  const parts = [tinted(toCell(new THREE.LatheGeometry([[0, 14], [4.5, 14], [5, 16], [5, 21], [3, 24], [0, 25]].map(([r, y]) => new THREE.Vector2(r, y)), 12), FACADE_ROOF_DARK), 0x8a8378)];
  for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) parts.push(tinted(toCell(new THREE.BoxGeometry(0.5, 15, 0.5), 2).translate(dx, 7.5, dz), 0x6a655c));
  for (const yy of [5, 10]) for (const [a, b] of [[[-3, -3], [3, -3]], [[3, -3], [3, 3]], [[3, 3], [-3, 3]], [[-3, 3], [-3, -3]]]) { const g = new THREE.BoxGeometry(6.2, 0.25, 0.25); g.rotateY(Math.atan2(b[1] - a[1], b[0] - a[0])); g.translate((a[0] + b[0]) / 2, yy, (a[1] + b[1]) / 2); parts.push(tinted(toCell(g, 2), 0x6a655c)); }
  const g = mergeGeometries(parts, false)!; g.translate(x, 0, z);
  ctx.batch.add('skyline', prep(g, { uv: 'keep', keepColor: true }));
}
export function crane(ctx: BuildCtx, x: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [];
  // lattice mast: 4 chords + horizontal rungs
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) parts.push(tinted(toCell(new THREE.BoxGeometry(0.22, 42, 0.22), 2).translate(dx, 21, dz), 0xb8a030));
  for (let yy = 2; yy < 42; yy += 3) { parts.push(tinted(toCell(new THREE.BoxGeometry(2.0, 0.14, 0.14), 2).translate(0, yy, -0.9), 0xb8a030)); parts.push(tinted(toCell(new THREE.BoxGeometry(2.0, 0.14, 0.14), 2).translate(0, yy, 0.9), 0xb8a030)); parts.push(tinted(toCell(new THREE.BoxGeometry(0.14, 0.14, 2.0), 2).translate(-0.9, yy, 0), 0xb8a030)); parts.push(tinted(toCell(new THREE.BoxGeometry(0.14, 0.14, 2.0), 2).translate(0.9, yy, 0), 0xb8a030)); }
  // jib (lattice-ish: two chords + rungs), counter-jib, cab, counterweight, hook line
  for (const dz of [-0.6, 0.6]) parts.push(tinted(toCell(new THREE.BoxGeometry(36, 0.3, 0.3), 2).translate(12, 41.6, dz), 0xb8a030));
  parts.push(tinted(toCell(new THREE.BoxGeometry(36, 0.3, 0.3), 2).translate(12, 43.0, 0), 0xb8a030));
  for (let xx = -4; xx < 30; xx += 2.5) parts.push(tinted(toCell(new THREE.BoxGeometry(0.14, 1.5, 0.14), 2).translate(xx, 42.3, 0), 0xb8a030));
  parts.push(tinted(toCell(new THREE.BoxGeometry(10, 0.6, 1.6), 2).translate(-6, 41.5, 0), 0xb8a030));
  parts.push(tinted(toCell(new THREE.BoxGeometry(2.6, 2.2, 2.2), 2).translate(1.8, 40.0, 1.6), 0x7a7a7a));
  parts.push(tinted(toCell(new THREE.BoxGeometry(3, 2.4, 2.6), 2).translate(-9, 40.5, 0), 0x8a8a86));
  parts.push(tinted(toCell(new THREE.BoxGeometry(0.06, 20, 0.06), 2).translate(22, 31, 0), 0x333333));
  const g = mergeGeometries(parts, false)!; g.rotateY(yaw); g.translate(x, 0, z);
  ctx.batch.add('skyline', prep(g, { uv: 'keep', keepColor: true }));
}
/** High-voltage lattice pylon (~38 m). */
export function pylon(ctx: BuildCtx, x: number, z: number, yaw = 0): void {
  const parts: THREE.BufferGeometry[] = [];
  const h = 38;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const g = new THREE.BoxGeometry(0.25, h, 0.25); const pos = g.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) + h / 2) / h; const spread = 3.2 * (1 - t) + 0.9; pos.setX(i, pos.getX(i) + sx * spread); pos.setZ(i, pos.getZ(i) + sz * spread); } g.translate(0, h / 2, 0); parts.push(tinted(toCell(g, 2), 0x6a6e70)); }
  for (let yy = 3; yy < h; yy += 4) { const t = yy / h; const s = 3.2 * (1 - t) + 0.9; for (const k of [-1, 1]) { parts.push(tinted(toCell(new THREE.BoxGeometry(s * 2, 0.12, 0.12), 2).translate(0, yy, k * s), 0x6a6e70)); parts.push(tinted(toCell(new THREE.BoxGeometry(0.12, 0.12, s * 2), 2).translate(k * s, yy, 0), 0x6a6e70)); } }
  for (const [yy, len] of [[h - 4, 14], [h - 10, 12], [h - 16, 12]]) { parts.push(tinted(toCell(new THREE.BoxGeometry(len, 0.4, 0.4), 2).translate(0, yy, 0), 0x6a6e70)); for (const s of [-1, 1]) parts.push(tinted(toCell(new THREE.BoxGeometry(0.12, 2.2, 0.12), 2).translate(s * (len / 2 - 0.6), yy - 1.2, 0), 0x2a2a2a)); }
  const g = mergeGeometries(parts, false)!; g.rotateY(yaw); g.translate(x, 0, z);
  ctx.batch.add('skyline', prep(g, { uv: 'keep', keepColor: true }));
}
export function smokestack(ctx: BuildCtx, x: number, z: number, h = 46): void {
  const g = mergeGeometries([tinted(toCell(new THREE.CylinderGeometry(1.6, 2.6, h, 12), FACADE_BRICK_BLANK).translate(0, h / 2, 0), 0xa07060), tinted(toCell(new THREE.CylinderGeometry(1.9, 1.7, 1.2, 12), 2).translate(0, h, 0), 0x3a3a3a), tinted(toCell(new THREE.BoxGeometry(14, 8, 10), 14).translate(6, 4, 4), 0xa07060)], false)!;
  g.translate(x, 0, z);
  ctx.batch.add('skyline', prep(g, { uv: 'keep', keepColor: true }));
}
/** Legacy API: skyline ring of blocks → uses the new city generator. */
export function skyline(ctx: BuildCtx, ring: { r0: number; r1: number; count: number; heights?: [number, number] }, _opts: GeoOpts = {}): void {
  cityRing(ctx, ring.r0, ring.r1, ring.count, ring.heights ?? [7, 26]);
}

/** Rainwater downspout on a facade: vertical pipe with brackets, top elbow and a broken bottom. */
export function downspout(ctx: BuildCtx, x: number, z: number, y0: number, y1: number, n: THREE.Vector3, tint: THREE.ColorRepresentation = 0x4e4a44): void {
  const off = 0.09;
  const px = x + n.x * off, pz = z + n.z * off;
  const broken = ctx.rng.next() < 0.4;
  const yb = broken ? y0 + ctx.rng.range(0.6, 1.6) : y0 + 0.08;
  ctx.batch.add('rust', lathe([[0, 0], [0.05, 0], [0.05, y1 - yb], [0, y1 - yb]], 6, px, yb, pz, { tint, uvScale: 4 }));
  ctx.batch.add('rust', tube([new THREE.Vector3(px, y1 - 0.02, pz), new THREE.Vector3(px - n.x * 0.06, y1 + 0.16, pz - n.z * 0.06), new THREE.Vector3(x - n.x * 0.12, y1 + 0.22, z - n.z * 0.12)], 0.05, 4, 5, { tint, uvScale: 3 }));
  for (let y = yb + 0.6; y < y1 - 0.3; y += 2.2) ctx.batch.add('darkMetal', box(x + n.x * 0.05, y, z + n.z * 0.05, Math.abs(n.z) * 0.16 + Math.abs(n.x) * 0.1, 0.04, Math.abs(n.x) * 0.16 + Math.abs(n.z) * 0.1, { tint: 0x333 }));
  if (broken) ctx.batch.add('rust', tube([new THREE.Vector3(px, yb + 0.02, pz), new THREE.Vector3(px + n.x * 0.3 + ctx.rng.range(-0.2, 0.2), y0 + 0.05, pz + n.z * 0.3 + ctx.rng.range(-0.2, 0.2))], 0.05, 2, 5, { tint, uvScale: 3 }));
  // rust streak on the wall behind the pipe + splash grime at the foot
  decal(ctx, DECAL.drip, new THREE.Vector3(x, (y0 + y1) / 2, z), n, 0.5, y1 - y0, 0, 0.5, 0xffffff, 0.018);
  decal(ctx, DECAL.grime, new THREE.Vector3(x, y0 + 0.4, z), n, 1.4, 0.8, 0, 0.6, 0xffffff, 0.02);
}

/** Street lamp: tapered post, arm, lamp head (dark, unlit), base plate. */
export function lampPost(ctx: BuildCtx, x: number, z: number, yaw: number, h = 6.5, lean = 0): void {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0));
  const post = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.14, 0), new THREE.Vector2(0.14, 0.5), new THREE.Vector2(0.08, 0.6), new THREE.Vector2(0.06, h), new THREE.Vector2(0, h)], 8);
  post.applyQuaternion(q); post.translate(x, 0, z);
  ctx.batch.add('paintedMetal', prep(post, { tint: 0x4a4f52, uv: 'keep', uvScale: 1 }));
  const armPts = [new THREE.Vector3(0, h - 0.05, 0), new THREE.Vector3(0.6, h + 0.25, 0), new THREE.Vector3(1.4, h + 0.35, 0)].map((p) => p.applyQuaternion(q).add(new THREE.Vector3(x, 0, z)));
  ctx.batch.add('paintedMetal', tube(armPts, 0.045, 4, 5, { tint: 0x4a4f52, uvScale: 1 }));
  const head = new THREE.BoxGeometry(0.55, 0.14, 0.26).translate(1.45, h + 0.3, 0); head.applyQuaternion(q); head.translate(x, 0, z);
  ctx.batch.add('darkMetal', prep(head, { tint: 0x2a2a2a }));
  const lens = new THREE.BoxGeometry(0.4, 0.02, 0.18).translate(1.45, h + 0.22, 0); lens.applyQuaternion(q); lens.translate(x, 0, z);
  ctx.batch.add('glass', prep(lens, { tint: 0xffffff }));
  // access panel + poster
  const panel = new THREE.BoxGeometry(0.1, 0.4, 0.16).translate(0.1, 1.0, 0); panel.applyQuaternion(q); panel.translate(x, 0, z);
  ctx.batch.add('darkMetal', prep(panel, { tint: 0x3a3f42 }));
  ctx.collideBox(x, h / 2, z, 0.3, h, 0.3, 'metal');
  aoStrip(ctx, new THREE.Vector3(x, 0.004, z), UP, new THREE.Vector3(1, 0, 0), 0.5, 0.25, 0.5, 0); aoStrip(ctx, new THREE.Vector3(x, 0.004, z), UP, new THREE.Vector3(-1, 0, 0), 0.5, 0.25, 0.5, 0);
}

export { boxMM };
