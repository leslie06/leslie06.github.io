import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Rng';

/**
 * Geometry helpers. Every geometry that goes into a batch is normalised by `prep()` so that all
 * pieces of one material share the same attribute layout: position, normal, uv (world metres),
 * uv1 (= uv, for aoMap), color (rgba tint), damage (float, drives the exposed-brick layer).
 */
export interface GeoOpts {
  /** rgb tint multiplier (vertex color) */
  tint?: THREE.ColorRepresentation;
  /** alpha (vertex color .a) — only matters for transparent decal materials */
  alpha?: number;
  /** 0..1 how much of the second material layer shows */
  damage?: number;
  /** 'planar' (default) world-space projection by face normal; 'keep' keeps the geometry's own uv scaled by uvScale */
  uv?: 'planar' | 'keep';
  uvScale?: number;
  /** rotation about Y (radians) applied around the box centre */
  rotY?: number;
  /** full quaternion (overrides rotY) */
  quat?: THREE.Quaternion;
  /** damage gradient: top of the piece gets more damage than the bottom */
  damageTop?: number;
  /** continuous damage function in world space (wins over damage/damageTop) */
  damageFn?: (x: number, y: number, z: number) => number;
  /** keep an existing rgba color attribute (multi-tint merged geometry) instead of filling with tint */
  keepColor?: boolean;
  /** per-vertex brightness multiplier (baked AO / grime), evaluated in the geometry's current space */
  aoFn?: (x: number, y: number, z: number) => number;
  /** box subdivision (width, height, depth segments) so aoFn / tints can vary across a face */
  segs?: [number, number, number];
}

const _c = new THREE.Color();

/** Ensure uv/uv1/color/damage attributes exist and return a non-indexed geometry. */
export function prep(geo: THREE.BufferGeometry, opts: GeoOpts = {}): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g === geo) g = geo; // no copy needed
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  if (opts.uv !== 'keep' || !g.getAttribute('uv')) planarUv(g);
  else if (opts.uvScale && opts.uvScale !== 1) {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * opts.uvScale, uv.getY(i) * opts.uvScale);
  }
  g.setAttribute('uv1', new THREE.BufferAttribute((g.getAttribute('uv') as THREE.BufferAttribute).array.slice() as Float32Array, 2));
  const existing = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  let col: Float32Array;
  if (opts.keepColor && existing && existing.itemSize === 4 && existing.count === n) {
    col = existing.array as Float32Array;
    if (opts.tint !== undefined) { _c.set(opts.tint); for (let i = 0; i < n; i++) { col[i * 4] *= _c.r; col[i * 4 + 1] *= _c.g; col[i * 4 + 2] *= _c.b; } }
  } else {
    _c.set(opts.tint ?? 0xffffff);
    col = new Float32Array(n * 4);
    const a = opts.alpha ?? 1;
    for (let i = 0; i < n; i++) { col[i * 4] = _c.r; col[i * 4 + 1] = _c.g; col[i * 4 + 2] = _c.b; col[i * 4 + 3] = a; }
  }
  if (opts.aoFn) for (let i = 0; i < n; i++) { const f = THREE.MathUtils.clamp(opts.aoFn(pos.getX(i), pos.getY(i), pos.getZ(i)), 0, 2); col[i * 4] *= f; col[i * 4 + 1] *= f; col[i * 4 + 2] *= f; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const dmg = new Float32Array(n);
  const d0 = opts.damage ?? 0;
  if (opts.damageFn) {
    for (let i = 0; i < n; i++) dmg[i] = THREE.MathUtils.clamp(opts.damageFn(pos.getX(i), pos.getY(i), pos.getZ(i)), 0, 1);
  } else if (opts.damageTop !== undefined) {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const h = Math.max(1e-3, bb.max.y - bb.min.y);
    for (let i = 0; i < n; i++) { const t = (pos.getY(i) - bb.min.y) / h; dmg[i] = d0 + (opts.damageTop - d0) * t; }
  } else dmg.fill(d0);
  g.setAttribute('damage', new THREE.BufferAttribute(dmg, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1', 'color', 'damage'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** World-space planar projection chosen per-vertex by dominant normal axis. UVs in metres. */
export function planarUv(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (nx >= ny && nx >= nz) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else if (ny >= nz) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Apply a transform: rotate (about centre) then translate to centre. UVs computed after transform so tiling is continuous across pieces. */
export function place(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, opts: GeoOpts = {}): THREE.BufferGeometry {
  if (opts.quat) g.applyQuaternion(opts.quat);
  else if (opts.rotY) g.rotateY(opts.rotY);
  g.translate(cx, cy, cz);
  return prep(g, opts);
}

/** Axis-aligned (optionally Y-rotated) box with world-planar UVs. Centre-based. */
export function box(cx: number, cy: number, cz: number, w: number, h: number, d: number, opts: GeoOpts = {}): THREE.BufferGeometry {
  const sg = opts.segs ?? [1, 1, 1];
  return place(new THREE.BoxGeometry(w, h, d, sg[0], sg[1], sg[2]), cx, cy, cz, opts);
}

/**
 * Vertical quad with a vertical alpha gradient (a0 at the bottom, a1 at the top), centred at the origin in the
 * xy plane facing +z. Used for baked-AO / grime strips. Transform it, then prep with keepColor.
 */
export function gradQuad(w: number, h: number, a0: number, a1: number, tint: THREE.ColorRepresentation = 0x000000): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  _c.set(tint);
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) + h / 2) / h; col[i * 4] = _c.r; col[i * 4 + 1] = _c.g; col[i * 4 + 2] = _c.b; col[i * 4 + 3] = a0 + (a1 - a0) * t; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

/** Deterministic per-position hash in [0,1) — stable across duplicated (non-indexed) vertices. */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 1000) * 12.9898 + Math.round(y * 1000) * 78.233 + Math.round(z * 1000) * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Copy a geometry's rgba color attribute into a merged-ready non-indexed clone with the given tint (helper for multi-tint parts). */
export function tinted(g: THREE.BufferGeometry, tint: THREE.ColorRepresentation, alpha = 1): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute('position').count;
  _c.set(tint);
  const col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { col[i * 4] = _c.r; col[i * 4 + 1] = _c.g; col[i * 4 + 2] = _c.b; col[i * 4 + 3] = alpha; }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 4));
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  return ng;
}

/** Box given by min/max corners. */
export function boxMM(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, opts: GeoOpts = {}): THREE.BufferGeometry {
  return box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, opts);
}

/** Box with chamfered edges (bevel), for cover pieces / T-walls / curbs. */
export function chamferBox(cx: number, cy: number, cz: number, w: number, h: number, d: number, bevel: number, opts: GeoOpts = {}): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = w / 2 - bevel, hh = h / 2 - bevel;
  shape.moveTo(-hw, -h / 2); shape.lineTo(hw, -h / 2); shape.lineTo(w / 2, -hh); shape.lineTo(w / 2, hh); shape.lineTo(hw, h / 2); shape.lineTo(-hw, h / 2); shape.lineTo(-w / 2, hh); shape.lineTo(-w / 2, -hh); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -d / 2);
  return place(g, cx, cy, cz, opts);
}

/**
 * A vertical wall segment whose top edge is broken into a jagged profile (for shelled buildings).
 * Built from vertical strips so it also gives sensible colliders. Returns strips as [geo, box-desc].
 */
export interface StripDesc { cx: number; cy: number; cz: number; w: number; h: number; d: number; rotY: number }
export function jaggedWall(x0: number, z0: number, x1: number, z1: number, thick: number, yBase: number, heightAt: (t: number) => number, rng: Rng, opts: GeoOpts & { stripW?: number } = {}): { geos: THREE.BufferGeometry[]; strips: StripDesc[] } {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const dir = new THREE.Vector2(x1 - x0, z1 - z0).divideScalar(len);
  const rotY = -Math.atan2(dir.y, dir.x);
  const stripW = opts.stripW ?? 0.45;
  const n = Math.max(1, Math.round(len / stripW));
  const sw = len / n;
  const geos: THREE.BufferGeometry[] = []; const strips: StripDesc[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const h = Math.max(0.15, heightAt(t) + rng.range(-0.18, 0.18));
    const cx = x0 + dir.x * (i + 0.5) * sw, cz = z0 + dir.y * (i + 0.5) * sw;
    const g = new THREE.BoxGeometry(sw + 0.01, h, thick);
    // shear the top a little so silhouettes aren't all flat-topped
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const tilt = rng.range(-0.12, 0.12);
    for (let v = 0; v < pos.count; v++) if (pos.getY(v) > 0) pos.setY(v, pos.getY(v) + tilt * (pos.getX(v) / sw));
    g.computeVertexNormals();
    geos.push(place(g, cx, yBase + h / 2, cz, { ...opts, rotY, damage: opts.damage ?? 0.15, damageTop: Math.max(opts.damageTop ?? 0.9, 0.7) }));
    strips.push({ cx, cy: yBase + h / 2, cz, w: sw, h, d: thick, rotY });
  }
  return { geos, strips };
}

/**
 * Rubble/dirt field: a subdivided patch displaced by a base height function + fbm, faded to the base
 * at the border. Suitable for trimesh colliders. Local coords: x∈[x0,x1], z∈[z0,z1].
 */
export function heightField(x0: number, z0: number, x1: number, z1: number, res: number, height: (x: number, z: number) => number, opts: GeoOpts = {}): THREE.BufferGeometry {
  const w = x1 - x0, d = z1 - z0;
  const sx = Math.max(2, Math.round(w / res)), sz = Math.max(2, Math.round(d / res));
  const g = new THREE.PlaneGeometry(w, d, sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  return prep(g, opts);
}

/** Smooth value noise on the CPU (for rubble fields / debris placement). Deterministic. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(ix, iy), h(ix + 1, iy), sx), THREE.MathUtils.lerp(h(ix, iy + 1), h(ix + 1, iy + 1), sx), sy);
}
export function fbm2(x: number, y: number, oct = 4): number {
  let v = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += a * noise2(x * f + i * 3.7, y * f - i * 1.3); norm += a; a *= 0.5; f *= 2.1; }
  return v / norm;
}

/** Tube along a catenary between two points (cables). */
export function cable(a: THREE.Vector3, b: THREE.Vector3, sag: number, radius = 0.014, opts: GeoOpts = {}): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, radius, 4, false);
  return prep(g, { ...opts, uv: 'keep' });
}

/** Tube along arbitrary points (rebar, pipes). */
export function tube(points: THREE.Vector3[], radius: number, segs = 10, radial = 5, opts: GeoOpts = {}): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segs, radius, radial, false);
  return prep(g, { ...opts, uv: 'keep' });
}

/** Lathe from a profile (r, y) list. */
export function lathe(profile: [number, number][], segments: number, cx: number, cy: number, cz: number, opts: GeoOpts = {}): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  return place(g, cx, cy, cz, { ...opts, uv: opts.uv ?? 'keep', uvScale: opts.uvScale ?? 1 });
}

/** Irregular soft-edged patch (disc with alpha fading to 0 at the rim) for dirt/puddles/scorch decals. */
export function softPatch(cx: number, cy: number, cz: number, rx: number, rz: number, rng: Rng, opts: GeoOpts = {}): THREE.BufferGeometry {
  const segs = 18;
  const verts: number[] = []; const alphas: number[] = [];
  const rim: [number, number][] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const r = 0.7 + 0.3 * noise2(Math.cos(a) * 1.7 + cx, Math.sin(a) * 1.7 + cz) + rng.range(-0.08, 0.08);
    rim.push([Math.cos(a) * rx * r, Math.sin(a) * rz * r]);
  }
  const inner = 0.45;
  for (let i = 0; i < segs; i++) {
    const [ax, az] = rim[i], [bx, bz] = rim[(i + 1) % segs];
    // centre fan (opaque core) + rim ring (fade)
    verts.push(0, 0, 0, ax * inner, 0, az * inner, bx * inner, 0, bz * inner); alphas.push(1, 1, 1);
    verts.push(ax * inner, 0, az * inner, ax, 0, az, bx, 0, bz); alphas.push(1, 0, 0);
    verts.push(ax * inner, 0, az * inner, bx, 0, bz, bx * inner, 0, bz * inner); alphas.push(1, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const n = verts.length / 3;
  const nor = new Float32Array(n * 3); for (let i = 0; i < n; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.translate(cx, cy, cz);
  const out = prep(g, opts);
  const col = out.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) col.setW(i, alphas[i] * (opts.alpha ?? 1));
  return out;
}

/**
 * Debris pieces (unit size ≈ 1 m, resting on y=0, colour baked in so several kinds can be merged into one
 * instanced geometry).
 *
 * Every kind is *fractured*, not a primitive: corners are chipped off along random planes, break faces are
 * roughened and darkened (exposed aggregate), and each piece carries its own albedo inside a ±15% band. A
 * rectangular prism with razor corners reads as a foam block no matter what texture is on it.
 *
 * Kinds: rock (aggregate lump), slab (broken floor slab with rebar stubs), plaster (thin render fragment with
 * a torn edge), brick (chipped brick), shard (long thin spall), wedge (a corner broken off a lintel/column),
 * clump (a small pile mixing several).
 */
export type ChunkKind = 'rock' | 'slab' | 'plaster' | 'brick' | 'shard' | 'wedge' | 'clump';
const CONCRETE_TINTS = [0x9b968c, 0x8b877e, 0xa8a397, 0x7f7b73, 0x928d84, 0xa29c90];

/**
 * Cut a convex-ish geometry with `n` random planes through the bounding sphere: any vertex outside a plane is
 * projected onto it. Cheap (no BSP, no re-triangulation) but it turns a box into an irregular fractured solid
 * with flat break faces, which is exactly the read we want.
 */
function chip(g: THREE.BufferGeometry, rng: Rng, n: number, depth: number, seed = 0): THREE.BufferGeometry {
  g.computeBoundingSphere();
  const r = g.boundingSphere!.radius;
  const c = g.boundingSphere!.center;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, Math.PI * 2), e = Math.acos(rng.range(-1, 1));
    const nx = Math.sin(e) * Math.cos(a), ny = Math.cos(e), nz = Math.sin(e) * Math.sin(a);
    const d = r * (1 - depth * (0.35 + 0.65 * hash3(k + seed, a, e)));
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) - c.x, py = pos.getY(i) - c.y, pz = pos.getZ(i) - c.z;
      const t = px * nx + py * ny + pz * nz - d;
      if (t > 0) pos.setXYZ(i, pos.getX(i) - nx * t, pos.getY(i) - ny * t, pos.getZ(i) - nz * t);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Roughen every vertex by a fraction of the piece size — kills the "extruded primitive" silhouette. */
function roughen(g: THREE.BufferGeometry, amp: number, seed = 0): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x + amp * (hash3(x + seed, y, z) - 0.5), y + amp * (hash3(y, z + seed, x) - 0.5), z + amp * (hash3(z, x, y + seed) - 0.5));
  }
  g.computeVertexNormals();
  return g;
}

/** Darken the faces that point away from the piece's "up" (the fresh break faces show damp aggregate). */
function breakShade(g: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) return g;
  for (let i = 0; i < col.count; i++) {
    const f = 1 - amount * (0.5 - 0.5 * nor.getY(i));
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  return g;
}

export function chunkGeo(kind: ChunkKind, rng: Rng, seed = 0): THREE.BufferGeometry {
  const shade = () => 0.85 + 0.3 * hash3(seed, kind.length, rng.next());
  if (kind === 'rock') {
    const g = chip(roughen(new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed(), 0.2, seed), rng, 3, 0.3, seed);
    g.scale(1, rng.range(0.45, 0.8), 1);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
    return breakShade(tinted(g, new THREE.Color(rng.pick(CONCRETE_TINTS)).multiplyScalar(shade())), 0.22);
  }
  if (kind === 'plaster') {
    // a torn sheet of render: irregular outline, uneven thickness, one curled corner
    const shape = new THREE.Shape();
    const n = 9;
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, r = rng.range(0.22, 0.55); const x = Math.cos(a) * r, y = Math.sin(a) * r * rng.range(0.55, 0.95); if (k === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: rng.range(0.055, 0.12), bevelEnabled: false, curveSegments: 1 }).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    // curl: lift one side of the sheet so it never lies perfectly flat
    const cx = Math.cos(rng.range(0, 6)), cz = Math.sin(rng.range(0, 6)), curl = rng.range(0.05, 0.16);
    for (let i = 0; i < pos.count; i++) { const t = Math.max(0, pos.getX(i) * cx + pos.getZ(i) * cz); pos.setY(i, pos.getY(i) + curl * t * t * 3.0); }
    g.computeVertexNormals();
    g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
    return breakShade(tinted(g, new THREE.Color(rng.pick([0xb5aea0, 0xa79f90, 0xbcb5a6, 0x9d9587])).multiplyScalar(shade())), 0.38);
  }
  if (kind === 'brick') {
    const g = chip(roughen(new THREE.BoxGeometry(0.235, 0.07, 0.112, 2, 1, 1).toNonIndexed(), 0.014, seed), rng, 2, 0.22, seed);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
    return breakShade(tinted(g, new THREE.Color().setHSL(0.03, rng.range(0.28, 0.5), rng.range(0.26, 0.44))), 0.25);
  }
  if (kind === 'shard') {
    // long thin spall off a wall face — reads on edge, not as a tile
    const w = rng.range(0.5, 1.0), t = rng.range(0.10, 0.20), d = rng.range(0.18, 0.4);
    const g = chip(roughen(new THREE.BoxGeometry(w, t, d, 2, 1, 1).toNonIndexed(), 0.055, seed), rng, 3, 0.48, seed);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
    return breakShade(tinted(g, new THREE.Color(rng.pick(CONCRETE_TINTS)).multiplyScalar(shade())), 0.3);
  }
  if (kind === 'wedge') {
    // a corner knocked off a lintel: triangular prism, chipped, one exposed aggregate face
    const sh = new THREE.Shape();
    const a = rng.range(0.35, 0.7), b = rng.range(0.25, 0.5);
    sh.moveTo(-a / 2, 0); sh.lineTo(a / 2, 0); sh.lineTo(a * rng.range(-0.2, 0.25), b); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: rng.range(0.3, 0.6), bevelEnabled: false, curveSegments: 1 }).toNonIndexed();
    g.translate(0, 0, -0.15);
    const g2 = chip(roughen(g, 0.06, seed), rng, 2, 0.38, seed);
    g2.computeBoundingBox(); g2.translate(0, -g2.boundingBox!.min.y, 0);
    return breakShade(tinted(g2, new THREE.Color(rng.pick(CONCRETE_TINTS)).multiplyScalar(shade())), 0.28);
  }
  if (kind === 'slab') {
    const w = rng.range(0.75, 1.25), d = rng.range(0.45, 0.85), t = rng.range(0.13, 0.24);
    const g = chip(roughen(new THREE.BoxGeometry(w, t, d, 2, 1, 2).toNonIndexed(), 0.085, seed), rng, 4, 0.42, seed);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox!.min.y, 0);
    const slabG = breakShade(tinted(g, new THREE.Color(rng.pick(CONCRETE_TINTS)).multiplyScalar(shade())), 0.34);
    // rust bleed from the reinforcement into the broken end face
    {
      const col = slabG.getAttribute('color') as THREE.BufferAttribute;
      const p3 = slabG.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < col.count; i++) {
        const f = THREE.MathUtils.clamp((p3.getX(i) - w * 0.15) / (w * 0.35), 0, 1) * 0.55;
        col.setXYZ(i, col.getX(i) * (1 + 0.25 * f), col.getY(i) * (1 - 0.28 * f), col.getZ(i) * (1 - 0.45 * f));
      }
    }
    const parts = [slabG];
    // rebar stubs out of one broken edge
    for (let k = 0; k < 2; k++) {
      const r = new THREE.CylinderGeometry(0.011, 0.011, 0.35, 3, 1, true).toNonIndexed();
      r.rotateZ(Math.PI / 2 + rng.range(-0.4, 0.4)); r.rotateY(rng.range(-0.3, 0.3));
      r.translate(w / 2 + 0.1, t * rng.range(0.3, 0.7), (k - 0.5) * d * 0.5);
      parts.push(tinted(r, 0x6a3f28));
    }
    return mergeGeometries(parts, false)!;
  }
  // clump: a little pile
  const parts: THREE.BufferGeometry[] = [];
  const put = (g: THREE.BufferGeometry, sc: number, x: number, z: number, ry: number, rx = 0, sink = 0) => {
    g.scale(sc, sc, sc); g.rotateX(rx); g.rotateY(ry); g.translate(x, -sink, z); parts.push(g);
  };
  put(chunkGeo('slab', rng, seed + 1), rng.range(0.45, 0.7), rng.range(-0.15, 0.15), rng.range(-0.1, 0.1), rng.range(0, 6), rng.range(-0.25, 0.25), 0.03);
  put(chunkGeo('brick', rng, seed + 4), 1, rng.range(-0.3, 0.3), rng.range(0.25, 0.45), rng.range(0, 6), rng.next() < 0.4 ? 0.5 : 0, 0.0);
  put(chunkGeo('wedge', rng, seed + 5), rng.range(0.4, 0.7), rng.range(-0.3, 0.2), rng.range(-0.3, 0.3), rng.range(0, 6), 0, 0.02);
  put(chunkGeo('plaster', rng, seed + 6), rng.range(0.5, 0.8), rng.range(-0.35, 0.35), rng.range(-0.35, 0.35), rng.range(0, 6), rng.range(-0.2, 0.2), 0.0);
  return mergeGeometries(parts, false)!;
}

/**
 * A slab / beam fragment of a given size with chipped corners, a roughened surface and darkened break faces.
 * Used for the hero rubble pieces that used to be razor-edged boxes ("a spilled box of clean foam blocks").
 */
export function fracturedBox(w: number, h: number, d: number, rng: Rng, opts: { chips?: number; amp?: number; seed?: number; tint?: THREE.ColorRepresentation } = {}): THREE.BufferGeometry {
  const seed = opts.seed ?? 0;
  const g = new THREE.BoxGeometry(w, h, d, Math.max(3, Math.round(w * 1.05)), 1, Math.max(3, Math.round(d * 1.05))).toNonIndexed();
  roughen(g, opts.amp ?? Math.min(0.09, h * 0.35), seed);
  // Bite chunks out of the perimeter: `chip` only trims corners on a long slab, which leaves the razor-straight
  // edges that read as a foam block. These are local spherical bites along the rim, so the edge breaks up.
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const bites = Math.max(4, Math.round((w + d) * 0.8));
  for (let k = 0; k < bites; k++) {
    const onX = hash3(k + seed, 1, 2) > 0.5;
    const bx = onX ? (hash3(k, seed, 3) - 0.5) * w : (hash3(k, seed, 5) > 0.5 ? 0.5 : -0.5) * w;
    const bz = onX ? (hash3(k, seed, 7) > 0.5 ? 0.5 : -0.5) * d : (hash3(k, seed, 9) - 0.5) * d;
    const br = (0.12 + 0.5 * hash3(k, seed, 11)) * Math.min(1.4, Math.max(h * 2.2, 0.3));
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - bx, dz = pos.getZ(i) - bz;
      const dist = Math.hypot(dx, dz);
      if (dist > br) continue;
      const push = (br - dist) / br;
      pos.setXYZ(i, pos.getX(i) - (dx / (dist + 1e-4)) * push * br * 0.6, pos.getY(i) * (1 - 0.35 * push), pos.getZ(i) - (dz / (dist + 1e-4)) * push * br * 0.6);
    }
  }
  chip(g, rng, opts.chips ?? 4, 0.16, seed);
  g.computeVertexNormals();
  const out = breakShade(tinted(g, opts.tint ?? 0xb5b0a6), 0.26);
  // per-vertex value break-up so a 6 m fragment is not one flat albedo (weathered top, damp broken faces)
  const col = out.getAttribute('color') as THREE.BufferAttribute;
  const p2 = out.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    const f = 0.8 + 0.42 * fbm2(p2.getX(i) * 0.9 + seed, p2.getZ(i) * 0.9);
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  return out;
}

/** Legacy alias kept for callers that only need "some rock". */
export function chunk(size: number, rng: Rng, opts: GeoOpts = {}): THREE.BufferGeometry {
  const g = chunkGeo('rock', rng); g.scale(size * 2, size * 2, size * 2);
  return prep(g, { keepColor: true, ...opts });
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  const m = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return m;
}
