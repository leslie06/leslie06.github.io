import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry plumbing for the car bodies: faces are collected into buckets (one mesh per bucket in
 * the end), every vertex carrying the same attribute layout so a bucket can be drawn with one
 * material and one draw call:
 *
 *   position, normal, uv    as usual (uv points into the livery atlas, CarMaterials)
 *   color                   linear RGB multiplier (paint: 1 = the paint colour itself, <1 = baked AO)
 *   pbr                     roughness, metalness per vertex (chrome, rubber and plastic share a mesh)
 *   aux                     x: paint tone (0 upper, 1 lower, 2 fixed colour) or lamp kind; y: flags
 *
 * Node-safe (no DOM): the handling tests build geometry to count triangles.
 */

export type Bucket = 'paint' | 'trim' | 'lamp' | 'taxi';

/** Flags in aux.y. */
export const F_CUTOUT = 1;

/** Paint tones (aux.x in the paint bucket). */
export const TONE_UPPER = 0, TONE_LOWER = 1, TONE_FIXED = 2;

/** Lamp kinds (aux.x in the lamp and taxi buckets); CarMaterials maps them to intensities. */
export const LAMP = { head: 0, tail: 1, brake: 2, reverse: 3, amber: 4, beaconR: 5, beaconB: 6, sign: 7, none: 8 } as const;

export interface Surf {
  bucket: Bucket;
  /** Linear RGB. */
  color: [number, number, number];
  rough: number;
  metal: number;
  /** Paint tone or lamp kind. */
  kind: number;
  flags?: number;
  /** Atlas rectangle [u0, v0, u1, v1] that 0..1 face coordinates map into (default: the white swatch). */
  rect?: readonly [number, number, number, number];
}

/** A white texel in every atlas (CarMaterials draws it there): untextured faces sample it. */
import { WHITE as WHITE_UV } from './Atlas';
export { WHITE_UV };

const lin = new THREE.Color();
/** sRGB hex to linear RGB. */
export function rgb(hex: string, k = 1): [number, number, number] {
  lin.set(hex);
  return [lin.r * k, lin.g * k, lin.b * k];
}

export function surf(bucket: Bucket, hex: string, rough: number, metal: number, kind = 0, extra: Partial<Surf> = {}): Surf {
  return { bucket, color: rgb(hex), rough, metal, kind, ...extra };
}

class Arrays {
  p: number[] = []; n: number[] = []; t: number[] = []; c: number[] = []; m: number[] = []; a: number[] = [];
  vert(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, s: Surf, shade = 1): void {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.t.push(u, v);
    this.c.push(s.color[0] * shade, s.color[1] * shade, s.color[2] * shade);
    this.m.push(s.rough, s.metal); this.a.push(s.kind, s.flags ?? 0);
  }
}

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();

export class Mesher {
  private readonly b = new Map<Bucket, Arrays>();
  /** Optional per-vertex shade (baked ambient occlusion) as a function of the vertex position. */
  shade: ((x: number, y: number, z: number) => number) | null = null;

  private arr(k: Bucket): Arrays {
    let a = this.b.get(k);
    if (!a) { a = new Arrays(); this.b.set(k, a); }
    return a;
  }

  /** One triangle: 9 positions, 9 normals, 6 face coordinates (0..1, mapped into `s.rect`). */
  tri(s: Surf, p: ArrayLike<number>, n: ArrayLike<number>, uv?: ArrayLike<number>): void {
    const a = this.arr(s.bucket);
    for (let k = 0; k < 3; k++) {
      let u = WHITE_UV[0], v = WHITE_UV[1];
      if (s.rect && uv) { u = s.rect[0] + (s.rect[2] - s.rect[0]) * uv[k * 2]; v = s.rect[1] + (s.rect[3] - s.rect[1]) * uv[k * 2 + 1]; }
      const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
      a.vert(x, y, z, n[k * 3], n[k * 3 + 1], n[k * 3 + 2], u, v, s, this.shade ? this.shade(x, y, z) : 1);
    }
  }

  /** A flat quad a-b-c-d (counter-clockwise seen from the front), face coordinates 0..1 over it. */
  quad(s: Surf, a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like): void {
    const n = _n.set(c.x - a.x, c.y - a.y, c.z - a.z).cross(_v.set(d.x - b.x, d.y - b.y, d.z - b.z)).normalize();
    const N = [n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z];
    this.tri(s, [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], N, [0, 0, 1, 0, 1, 1]);
    this.tri(s, [a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z], N, [0, 0, 1, 1, 0, 1]);
  }

  /** Append a three.js geometry (any primitive) under `matrix`; its own uvs map into `s.rect`. */
  geo(s: Surf, g: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const src = g.index ? g.toNonIndexed() : g;
    const P = src.getAttribute('position'), N = src.getAttribute('normal'), T = src.getAttribute('uv');
    if (matrix) _nm.getNormalMatrix(matrix);
    const flip = matrix ? matrix.determinant() < 0 : false;
    const p = new Array<number>(9), n = new Array<number>(9), t = new Array<number>(6);
    for (let i = 0; i < P.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = flip ? i + (k === 0 ? 0 : 3 - k) : i + k;
        _v.fromBufferAttribute(P, j); if (matrix) _v.applyMatrix4(matrix);
        _n.fromBufferAttribute(N, j); if (matrix) _n.applyMatrix3(_nm).normalize();
        p[k * 3] = _v.x; p[k * 3 + 1] = _v.y; p[k * 3 + 2] = _v.z;
        n[k * 3] = _n.x; n[k * 3 + 1] = _n.y; n[k * 3 + 2] = _n.z;
        t[k * 2] = T ? T.getX(j) : 0.5; t[k * 2 + 1] = T ? T.getY(j) : 0.5;
      }
      this.tri(s, p, n, t);
    }
    if (src !== g) src.dispose();
    g.dispose();
  }

  triangles(k?: Bucket): number {
    if (k) return (this.b.get(k)?.p.length ?? 0) / 9;
    let n = 0; for (const a of this.b.values()) n += a.p.length / 9; return n;
  }

  has(k: Bucket): boolean { return (this.b.get(k)?.p.length ?? 0) > 0; }

  /** The bucket as an indexed geometry (identical vertices welded), or null if empty. */
  build(k: Bucket, filter?: (kind: number) => boolean): THREE.BufferGeometry | null {
    const a = this.b.get(k);
    if (!a || !a.p.length) return null;
    return toGeometry(a, filter);
  }
}

function toGeometry(a: Arrays, filter?: (kind: number) => boolean): THREE.BufferGeometry | null {
  let idx: number[] | null = null;
  if (filter) {
    idx = [];
    for (let t = 0; t < a.a.length / 6; t++) if (filter(a.a[t * 6])) idx.push(t);
    if (!idx.length) return null;
  }
  const sel = <T extends number[]>(src: T, w: number) => {
    if (!idx) return new Float32Array(src);
    const out = new Float32Array(idx.length * 3 * w);
    idx.forEach((t, i) => { for (let j = 0; j < 3 * w; j++) out[i * 3 * w + j] = src[t * 3 * w + j]; });
    return out;
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(sel(a.p, 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(sel(a.n, 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(sel(a.t, 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(sel(a.c, 3), 3));
  g.setAttribute('pbr', new THREE.BufferAttribute(sel(a.m, 2), 2));
  g.setAttribute('aux', new THREE.BufferAttribute(sel(a.a, 2), 2));
  const merged = mergeVertices(g, 1e-5);
  g.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Smooth normals that keep hard edges: each corner averages the (area-weighted) normals of the
 * faces sharing its position whose normal is within `crease` of its own face's. Positions are
 * matched to 0.1 mm, so the two mirrored halves of a body meet smoothly on the centre line.
 */
export function creaseNormals(pos: ArrayLike<number>, crease: number): Float32Array {
  const nf = pos.length / 9;
  const fn = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const o = f * 9;
    const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
    const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
    // Unnormalised cross product = twice the area along the normal: area weighting for free.
    fn[f * 3] = ay * bz - az * by; fn[f * 3 + 1] = az * bx - ax * bz; fn[f * 3 + 2] = ax * by - ay * bx;
  }
  const key = (i: number) => {
    const x = Math.round(pos[i] * 1e4) + 65536, y = Math.round(pos[i + 1] * 1e4) + 65536, z = Math.round(pos[i + 2] * 1e4) + 65536;
    return (x * 131072 + y) * 131072 + z;
  };
  const map = new Map<number, number[]>();
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
    const h = key(f * 9 + k * 3);
    const l = map.get(h);
    if (l) l.push(f); else map.set(h, [f]);
  }
  const cosC = Math.cos(crease);
  const out = new Float32Array(nf * 9);
  for (let f = 0; f < nf; f++) {
    const fx = fn[f * 3], fy = fn[f * 3 + 1], fz = fn[f * 3 + 2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    for (let k = 0; k < 3; k++) {
      let sx = 0, sy = 0, sz = 0;
      for (const g of map.get(key(f * 9 + k * 3))!) {
        const gx = fn[g * 3], gy = fn[g * 3 + 1], gz = fn[g * 3 + 2];
        const gl = Math.hypot(gx, gy, gz);
        if (gl < 1e-12) continue;
        if ((fx * gx + fy * gy + fz * gz) / (fl * gl) >= cosC) { sx += gx; sy += gy; sz += gz; }
      }
      const l = Math.hypot(sx, sy, sz);
      const o = f * 9 + k * 3;
      if (l < 1e-12) { out[o] = fx / fl; out[o + 1] = fy / fl; out[o + 2] = fz / fl; }
      else { out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l; }
    }
  }
  return out;
}

/** Monotone cubic (Fritsch-Carlson) through points sorted by x; flat beyond the ends. */
export function curve(pts: readonly (readonly [number, number])[]): (x: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = new Array<number>(n - 1), m = new Array<number>(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A box with rounded edges (radius r, `seg` segments per quarter), centred at the origin. */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  // A subdivided box whose vertices are pulled onto the rounded shape: inner box + r along the normal.
  const g = new THREE.BoxGeometry(1, 1, 1, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const q = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    q.fromBufferAttribute(p, i);   // on the unit box surface, -0.5..0.5
    // Map the lattice so the flat centre band stays flat and the outer segments bend.
    const f = (v: number, half: number) => {
      const s = Math.sign(v), a = Math.abs(v) * 2;   // 0..1
      const k = seg * 2 + 1, cells = a * k;          // lattice position from the centre (in cells)
      const inner = 1;                               // one flat cell in the middle
      const t = cells <= inner / 2 ? 0 : Math.min(1, (cells - inner / 2) / (k / 2 - inner / 2));
      return { core: s * (cells <= inner / 2 ? half * cells / (inner / 2) : half), t, s };
    };
    const fx = f(q.x, hx), fy = f(q.y, hy), fz = f(q.z, hz);
    c.set(fx.core, fy.core, fz.core);
    const dir = new THREE.Vector3(fx.s * fx.t, fy.s * fy.t, fz.s * fz.t);
    if (dir.lengthSq() < 1e-9) dir.fromBufferAttribute(n, i);
    dir.normalize();
    p.setXYZ(i, c.x + dir.x * r, c.y + dir.y * r, c.z + dir.z * r);
    n.setXYZ(i, dir.x, dir.y, dir.z);
  }
  return g;
}

/** Revolve a profile of (radius, x) points about the X axis (axle), `seg` segments round. */
export function latheX(profile: readonly (readonly [number, number])[], seg: number, phase = 0): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), seg, phase);
  // Lathe revolves about Y with the profile's y along the axis: turn the axis onto X.
  g.rotateZ(-Math.PI / 2);
  return g;
}
