import * as THREE from 'three';

/**
 * Geometry accumulation for landmarks. Every landmark is built into a handful of `GeoBuf`s, one per
 * material, so a whole building is <= ~20 draw calls. Vertices carry position, normal, uv and
 * `aGlow`: the night-emission weight the landmark materials multiply by `env.uNight` (floodlight
 * strength on stone and lacquer, lamp strength on lanterns and windows).
 *
 * UV convention: tiling materials take metres (u along the face, v up or down the slope); the paint
 * atlas takes u in "bays" and v in atlas coordinates (see tex.ts).
 */
export type V3 = [number, number, number];
export type GlowFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

interface Ctx { m: THREE.Matrix4 | null; nm: THREE.Matrix3 | null; glow: GlowFn | number; stack: (THREE.Matrix4 | null)[] }

const _v = new THREE.Vector3(), _n = new THREE.Vector3();

export class GeoBuf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; glow: number[] = []; idx: number[] = [];
  constructor(readonly ctx: Ctx) {}
  get count(): number { return this.pos.length / 3; }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const c = this.ctx;
    if (c.m) {
      _v.set(x, y, z).applyMatrix4(c.m); x = _v.x; y = _v.y; z = _v.z;
      _n.set(nx, ny, nz).applyMatrix3(c.nm!).normalize(); nx = _n.x; ny = _n.y; nz = _n.z;
    }
    // Degenerate spots (a pyramid apex, a collapsed hip) give zero normals; normalize(0) is NaN in
    // GLSL and the game's bloom chain smears one NaN pixel into a black block. Never emit one.
    if (!(nx * nx + ny * ny + nz * nz > 1e-10)) { nx = 0; ny = 1; nz = 0; }
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    this.glow.push(typeof c.glow === 'number' ? c.glow : c.glow(x, y, z, nx, ny, nz));
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }
  /** Flat convex polygon, points counter-clockwise seen from the side the normal points to. */
  poly(p: V3[], uv: [number, number][]): void {
    let n = faceNormal(p[0], p[1], p[2]);
    for (let k = 1; k < p.length - 2 && !(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) > 1e-9); k++) n = faceNormal(p[0], p[k + 1], p[k + 2]);
    if (!(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) > 1e-9) && p.length > 3) n = faceNormal(p[1], p[2], p[3]);
    const base = this.count;
    for (let i = 0; i < p.length; i++) this.vert(p[i][0], p[i][1], p[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1]);
    for (let i = 1; i < p.length - 1; i++) this.tri(base, base + i, base + i + 1);
  }
  /** Quad with uv in metres: u along p0->p1, v along p0->p3. */
  quadM(p0: V3, p1: V3, p2: V3, p3: V3, u0 = 0, v0 = 0, us = 1, vs = 1): void {
    const w = dist(p0, p1) * us, h = dist(p0, p3) * vs;
    this.poly([p0, p1, p2, p3], [[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0, v0 + h]]);
  }
  /** Copy a three.js geometry in (through the current transform). */
  addGeometry(g: THREE.BufferGeometry, uvScale = 1, flip = false): void {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), t = g.getAttribute('uv');
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      this.vert(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0, t ? t.getX(i) * uvScale : 0, t ? t.getY(i) * uvScale : 0);
    }
    const ix = g.getIndex();
    const n3 = ix ? ix.count : p.count;
    for (let i = 0; i < n3; i += 3) {
      const a = ix ? ix.getX(i) : i, b = ix ? ix.getX(i + 1) : i + 1, c = ix ? ix.getX(i + 2) : i + 2;
      if (flip) this.idx.push(base + a, base + c, base + b); else this.idx.push(base + a, base + b, base + c);
    }
  }
  /** Regular grid of vertices from f(i/nu, j/nv); normals from the grid itself. */
  grid(nu: number, nv: number, f: (u: number, v: number) => V3, uvf: (u: number, v: number) => [number, number], out: boolean | V3 = false): void {
    const pts: V3[] = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(f(i / nu, j / nv));
    const at = (i: number, j: number) => pts[Math.min(nv, Math.max(0, j)) * (nu + 1) + Math.min(nu, Math.max(0, i))];
    // `out` is either an explicit flip or a reference direction the surface should face.
    let flip = out === true;
    if (Array.isArray(out)) {
      const ci = Math.floor(nu / 2), cj = Math.floor(nv / 2);
      const n0 = cross(sub(at(ci + 1, cj), at(ci - 1, cj)), sub(at(ci, cj + 1), at(ci, cj - 1)));
      flip = n0[0] * out[0] + n0[1] * out[1] + n0[2] * out[2] < 0;
    }
    const base = this.count;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      let n = cross(sub(at(i + 1, j), at(i - 1, j)), sub(at(i, j + 1), at(i, j - 1)));
      // collapsed row (apex) or column: take the tangent from the next row / column instead
      if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = cross(sub(at(i + 1, j - 1), at(i - 1, j - 1)), sub(at(i, j + 1), at(i, j - 1)));
      if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = cross(sub(at(i + 1, j + 1), at(i - 1, j + 1)), sub(at(i, j + 1), at(i, j - 1)));
      n = norm(n);
      if (flip) n = [-n[0], -n[1], -n[2]];
      const p = at(i, j), t = uvf(i / nu, j / nv);
      this.vert(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1]);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      if (flip) this.quad(a, d, c, b); else this.quad(a, b, c, d);
    }
  }
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** A landmark under construction: one GeoBuf per material key, a shared transform stack and glow. */
export class Parts {
  readonly ctx: Ctx = { m: null, nm: null, glow: 0, stack: [] };
  readonly bufs = new Map<string, GeoBuf>();
  get(key: string): GeoBuf {
    let b = this.bufs.get(key);
    if (!b) { b = new GeoBuf(this.ctx); this.bufs.set(key, b); }
    return b;
  }
  /** Multiply a transform onto the stack for everything added until the matching pop(). */
  push(m: THREE.Matrix4): void {
    const c = this.ctx;
    c.stack.push(c.m);
    c.m = c.m ? c.m.clone().multiply(m) : m.clone();
    c.nm = new THREE.Matrix3().getNormalMatrix(c.m);
  }
  pop(): void {
    const c = this.ctx;
    c.m = c.stack.pop() ?? null;
    c.nm = c.m ? new THREE.Matrix3().getNormalMatrix(c.m) : null;
  }
  at(x: number, y: number, z: number, ry = 0, body?: () => void): void {
    this.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
    try { body?.(); } finally { this.pop(); }
  }
  glow(g: GlowFn | number, body: () => void): void {
    const prev = this.ctx.glow; this.ctx.glow = g;
    try { body(); } finally { this.ctx.glow = prev; }
  }
  triangles(): number { let n = 0; for (const b of this.bufs.values()) n += b.idx.length / 3; return n; }
  build(mats: Record<string, THREE.Material>, opts: { shadows?: boolean } = {}): THREE.Group {
    const g = new THREE.Group();
    for (const [key, b] of this.bufs) {
      if (!b.idx.length) continue;
      const mat = mats[key];
      if (!mat) throw new Error(`landmark: no material for "${key}"`);
      const mesh = new THREE.Mesh(b.toGeometry(), mat);
      mesh.name = key;
      mesh.castShadow = opts.shadows !== false && !(mat as THREE.Material & { transparent?: boolean }).transparent;
      mesh.receiveShadow = opts.shadows !== false;
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
    return g;
  }
}

// --- vector helpers ---------------------------------------------------------------------------
export function dist(a: V3, b: V3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
export function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
export function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scale(a: V3, s: number): V3 { return [a[0] * s, a[1] * s, a[2] * s]; }
export function lerp3(a: V3, b: V3, t: number): V3 { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function faceNormal(a: V3, b: V3, c: V3): V3 { return norm(cross(sub(b, a), sub(c, a))); }
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// --- primitives -------------------------------------------------------------------------------

/** Axis-aligned box (in the current transform) with metre uvs. `faces` skips hidden faces. */
export function box(b: GeoBuf, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
  o: { ry?: number; bottom?: boolean; top?: boolean; faces?: string; us?: number; vs?: number } = {}): void {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = Math.cos(o.ry ?? 0), s = Math.sin(o.ry ?? 0);
  const P = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const f = o.faces ?? ('xXzZ' + (o.top === false ? '' : 'Y') + (o.bottom ? 'y' : ''));
  const us = o.us ?? 1, vs = o.vs ?? 1;
  if (f.includes('Z')) b.quadM(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), cx - hx, cy - hy, us, vs);
  if (f.includes('z')) b.quadM(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), -cx - hx, cy - hy, us, vs);
  if (f.includes('X')) b.quadM(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), -cz - hz, cy - hy, us, vs);
  if (f.includes('x')) b.quadM(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), cz - hz, cy - hy, us, vs);
  if (f.includes('Y')) b.quadM(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), cx - hx, -cz - hz, us, vs);
  if (f.includes('y')) b.quadM(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), cx - hx, cz - hz, us, vs);
}

/** Hexahedron from 8 corners: bottom ring then top ring, each ordered (-x,-z), (+x,-z), (+x,+z), (-x,+z) (increasing atan2(z, x)). */
export function hexa(b: GeoBuf, c: V3[], o: { top?: boolean; bottom?: boolean } = {}): void {
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const w = Math.hypot(c[j][0] - c[i][0], c[j][2] - c[i][2]);
    b.poly([c[j], c[i], c[i + 4], c[j + 4]], [[u + w, c[j][1]], [u, c[i][1]], [u, c[i + 4][1]], [u + w, c[j + 4][1]]]);
    u += w;
  }
  if (o.top !== false) b.poly([c[4], c[7], c[6], c[5]], [c[4], c[7], c[6], c[5]].map((p) => [p[0], p[2]] as [number, number]));
  if (o.bottom) b.poly([c[0], c[1], c[2], c[3]], [c[0], c[1], c[2], c[3]].map((p) => [p[0], p[2]] as [number, number]));
}

/** Vertical cylinder / cone frustum. uv: u = arc length (m), v = height (m). */
export function cyl(b: GeoBuf, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, segs: number,
  o: { top?: boolean; bottom?: boolean; phase?: number; smooth?: boolean } = {}): void {
  const base = b.count, ph = o.phase ?? 0;
  const slope = (r0 - r1) / h;
  for (let i = 0; i <= segs; i++) {
    const a = ph + (i / segs) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const n = norm([ca, slope, sa]);
    b.vert(cx + ca * r0, y0, cz + sa * r0, n[0], n[1], n[2], (i / segs) * Math.PI * 2 * r0, y0);
    b.vert(cx + ca * r1, y0 + h, cz + sa * r1, n[0], n[1], n[2], (i / segs) * Math.PI * 2 * r0, y0 + h);
  }
  for (let i = 0; i < segs; i++) { const a = base + i * 2; b.quad(a, a + 1, a + 3, a + 2); }
  const cap = (y: number, r: number, up: boolean) => {
    if (r <= 1e-4) return;
    const c0 = b.vert(cx, y, cz, 0, up ? 1 : -1, 0, cx, cz);
    const s0 = b.count;
    for (let i = 0; i <= segs; i++) {
      const a = ph + (i / segs) * Math.PI * 2;
      b.vert(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, 0, up ? 1 : -1, 0, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
    for (let i = 0; i < segs; i++) up ? b.tri(c0, s0 + i + 1, s0 + i) : b.tri(c0, s0 + i, s0 + i + 1);
  };
  if (o.top !== false) cap(y0 + h, r1, true);
  if (o.bottom) cap(y0, r0, false);
}

/** Surface of revolution from a (radius, y) profile, bottom to top. Smooth normals along the profile. */
export function lathe(b: GeoBuf, prof: [number, number][], segs: number, cx = 0, cz = 0, o: { phase?: number; vScale?: number; a0?: number; a1?: number } = {}): void {
  const base = b.count;
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2, ph = o.phase ?? 0;
  const lens = [0];
  for (let k = 1; k < prof.length; k++) lens.push(lens[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
  for (let k = 0; k < prof.length; k++) {
    const pa = prof[Math.max(0, k - 1)], pb = prof[Math.min(prof.length - 1, k + 1)];
    let dr = pb[0] - pa[0], dy = pb[1] - pa[1];
    const l = Math.hypot(dr, dy) || 1; dr /= l; dy /= l;
    // outward normal of the profile curve (r, y) is (dy, -dr)
    const nr = dy, ny = -dr;
    for (let i = 0; i <= segs; i++) {
      const a = ph + a0 + (i / segs) * (a1 - a0), ca = Math.cos(a), sa = Math.sin(a);
      b.vert(cx + ca * prof[k][0], prof[k][1], cz + sa * prof[k][0], ca * nr, ny, sa * nr, (a - ph) * Math.max(prof[0][0], 0.5), lens[k] * (o.vScale ?? 1));
    }
  }
  for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < segs; i++) {
    const a = base + k * (segs + 1) + i, c = a + segs + 1;
    b.quad(a, c, c + 1, a + 1);
  }
}

/** Tube along a polyline (for ridges). Circular section with `sides` sides, optional radius per point. */
export function tube(b: GeoBuf, pts: V3[], r: number | number[], sides = 6, up: V3 = [0, 1, 0], vScale = 1): void {
  const base = b.count;
  let len = 0;
  for (let k = 0; k < pts.length; k++) {
    const pa = pts[Math.max(0, k - 1)], pb = pts[Math.min(pts.length - 1, k + 1)];
    const t = norm(sub(pb, pa));
    let side = norm(cross(t, up));
    if (!isFinite(side[0]) || Math.hypot(...side) < 0.5) side = [1, 0, 0];
    const nup = norm(cross(side, t));
    if (k > 0) len += dist(pts[k], pts[k - 1]);
    const rr = Array.isArray(r) ? r[k] : r;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const n: V3 = [side[0] * ca + nup[0] * sa, side[1] * ca + nup[1] * sa, side[2] * ca + nup[2] * sa];
      b.vert(pts[k][0] + n[0] * rr, pts[k][1] + n[1] * rr, pts[k][2] + n[2] * rr, n[0], n[1], n[2], (i / sides) * rr * 6.28, len * vScale);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) for (let i = 0; i < sides; i++) {
    const a = base + k * (sides + 1) + i, c = a + sides + 1;
    b.quad(a, c, c + 1, a + 1);
  }
}

/** Extruded 2D shape (x right, y up) along +z by `depth`, centred on z = 0, placed by `m`. */
export function extrude(b: GeoBuf, shape: THREE.Shape, depth: number, m: THREE.Matrix4, curveSegments = 6): void {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  g.translate(0, 0, -depth / 2);
  g.applyMatrix4(m);
  b.addGeometry(g, 1, m.determinant() < 0);
  g.dispose();
}

/** Flat polygon (x, z) at height y, facing up (or down), triangulated. */
export function flat(b: GeoBuf, poly: [number, number][], y: number, down = false): void {
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const base = b.count;
  for (const p of contour) b.vert(p.x, y, p.y, 0, down ? -1 : 1, 0, p.x, p.y);
  // contour is CCW in (x, z); seen from +y with z pointing toward the viewer's bottom that is CW, so flip.
  for (const t of tris) down ? b.tri(base + t[0], base + t[1], base + t[2]) : b.tri(base + t[0], base + t[2], base + t[1]);
}

/** Vertical walls of an extruded polygon (x, z) from y0 to y1, outward normals. */
export function walls(b: GeoBuf, poly: [number, number][], y0: number, y1: number, inward = false): void {
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  if (!THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  if (inward) contour.reverse();
  let u = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], c = contour[(i + 1) % contour.length];
    const w = a.distanceTo(c);
    b.poly([[a.x, y0, a.y], [c.x, y0, c.y], [c.x, y1, c.y], [a.x, y1, a.y]], [[u, y0], [u + w, y0], [u + w, y1], [u, y1]]);
    u += w;
  }
}

/** Prism: walls + top (+ optional bottom) of a polygon. */
export function prism(b: GeoBuf, poly: [number, number][], y0: number, y1: number, o: { bottom?: boolean; top?: boolean } = {}): void {
  walls(b, poly, y0, y1);
  if (o.top !== false) flat(b, poly, y1);
  if (o.bottom) flat(b, poly, y0, true);
}

export function rectPoly(hw: number, hd: number, cx = 0, cz = 0): [number, number][] {
  return [[cx - hw, cz - hd], [cx + hw, cz - hd], [cx + hw, cz + hd], [cx - hw, cz + hd]];
}
export function circlePoly(r: number, n: number, cx = 0, cz = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}

/**
 * Floodlight weight for landmark vertices: brighter on faces towards the lights (front, +z),
 * brightest on eave soffits and bracket bands lit from below, dim on roof tops, with a pool of
 * light near the floodlights at the foot of the walls.
 */
export function floodGlow(o: { base?: number; front?: number; under?: number; top?: number; foot?: number; footH?: number; y0?: number; above?: number; aboveY?: number } = {}): GlowFn {
  const base = o.base ?? 0.35, front = o.front ?? 0.35, under = o.under ?? 0.8, top = o.top ?? 0.25;
  const foot = o.foot ?? 0.3, footH = o.footH ?? 5, y0 = o.y0 ?? 0, above = o.above ?? 0, aboveY = o.aboveY ?? 1e9;
  return (_x, y, _z, _nx, ny, nz) => {
    let g = base + front * Math.max(0, nz) + under * Math.max(0, -ny) - top * Math.max(0, ny);
    g += foot * Math.exp(-Math.max(0, y - y0) / footH) * (1 - Math.abs(ny));
    if (y > aboveY) g += above;
    return Math.max(0.08, g);
  };
}
