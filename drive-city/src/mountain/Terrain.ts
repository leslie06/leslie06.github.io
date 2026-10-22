import * as THREE from 'three';
import type { MountainData } from './Data';

/**
 * The ground west of the city (mountain.bin's grid, 5 m): drawn in chunks of CH cells, each at the detail its distance
 * from the camera calls for, the chunks of one level merged into one mesh (rebuilt when the set changes, which is when
 * the camera crosses into another chunk) - and everything beyond the detailed ring as one coarse mesh with holes where
 * the detailed chunks are. Each detailed chunk has a skirt round its edge so the levels never show a crack between
 * them. Colours per vertex: the western hills in late October - dark cypress, olive scrub, the 黄栌 turning red on the
 * slopes, bare rock where it is steep, grass by the city.
 */
const CH = 64;
/** Detail levels: step (cells) and the distance (m) to the chunk's nearest point it is used within. */
const LEVELS_HIGH: [number, number][] = [[1, 260], [2, 800], [4, 1500]];
const LEVELS_LOW: [number, number][] = [[2, 420], [4, 1100]];
const FAR_STEP = 8;
const SKIRT = 6;

const C_FOREST = new THREE.Color('#3f5a33'), C_SCRUB = new THREE.Color('#6b6d3e'), C_RED = new THREE.Color('#8a3b24'),
  C_ROCK = new THREE.Color('#857d6e'), C_GRASS = new THREE.Color('#6a7b45'), C_DIRT = new THREE.Color('#8a7b5c');
const _c = new THREE.Color();

function hash(x: number, z: number): number { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, uu = u * u * (3 - 2 * u), vv = v * v * (3 - 2 * v);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv;
}

interface Chunk { ci: number; cj: number; cx: number; cz: number; geo: Map<number, { p: Float32Array; n: Float32Array; c: Float32Array; i: Uint32Array }> }

export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly levels: [number, number][];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly far: THREE.Mesh;
  private key = '';
  private readonly nci: number;
  private readonly ncj: number;
  /** Per vertex of the full grid: colour (computed once, shared by every level). */
  private readonly col: Float32Array;
  private readonly nrm: Float32Array;

  constructor(private readonly d: MountainData, private readonly mat: THREE.Material, low: boolean, private readonly onBuild: (m: THREE.Mesh) => void) {
    const { nx, nz, x0, z0, cell } = d.grid;
    this.levels = low ? LEVELS_LOW : LEVELS_HIGH;
    this.nci = Math.ceil((nx - 1) / CH); this.ncj = Math.ceil((nz - 1) / CH);
    for (let cj = 0; cj < this.ncj; cj++) for (let ci = 0; ci < this.nci; ci++) {
      this.chunks.push({ ci, cj, cx: x0 + (ci + 0.5) * CH * cell, cz: z0 + (cj + 0.5) * CH * cell, geo: new Map() });
    }
    // normals and colours over the whole grid
    const h = d.h;
    this.nrm = new Float32Array(nx * nz * 3);
    this.col = new Float32Array(nx * nz * 3);
    const n = new THREE.Vector3();
    const X0 = x0 + (nx - 1) * cell;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)], hd = h[Math.max(0, j - 1) * nx + i], hu = h[Math.min(nz - 1, j + 1) * nx + i];
      n.set(hl - hr, 2 * cell, hd - hu).normalize();
      this.nrm.set([n.x, n.y, n.z], k * 3);
      const x = x0 + i * cell, z = z0 + j * cell;
      const steep = 1 - n.y;                                       // 0 flat .. ~0.5 at 60 deg
      const nn = vnoise(x / 90, z / 90), fine = vnoise(x / 18, z / 18), red = vnoise(x / 45 + 7.3, z / 45 - 2.1);
      // the valley by the city: grass; the hills: forest and scrub with red patches, rock on the steep
      const valley = Math.min(1, Math.max(0, (x - (X0 - 2600)) / 1600)) * Math.min(1, Math.max(0, 1 - h[k] / 60));
      _c.copy(C_FOREST).lerp(C_SCRUB, Math.min(1, Math.max(0, (nn - 0.35) * 2.2)));
      if (red > 0.66) _c.lerp(C_RED, Math.min(1, (red - 0.66) * 5) * 0.4);
      _c.lerp(C_ROCK, Math.min(1, Math.max(0, (steep - 0.22) * 4)));
      _c.lerp(C_GRASS, valley);
      if (valley > 0.5 && fine > 0.7) _c.lerp(C_DIRT, 0.4);
      const shade = 0.9 + 0.2 * fine;
      this.col.set([_c.r * shade, _c.g * shade, _c.b * shade], k * 3);
    }
    for (let l = 0; l < this.levels.length; l++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      // receives shadows, casts none: the nearest level drawn into three cascades was a third of a high frame (1.6M)
      m.name = `mountain-ground-${l}`; m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false;
      this.meshes.push(m); this.group.add(m);
    }
    this.far = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.far.name = 'mountain-ground-far'; this.far.receiveShadow = true; this.far.frustumCulled = false;
    this.group.add(this.far);
    for (const m of [...this.meshes, this.far]) onBuild(m);
  }

  /** Pick each chunk's level from the camera; rebuild the merged meshes when the picks change. */
  update(cam: THREE.Vector3): void {
    const { cell } = this.d.grid, half = (CH * cell) / 2;
    const pick = this.chunks.map((c) => {
      const dx = Math.max(0, Math.abs(cam.x - c.cx) - half), dz = Math.max(0, Math.abs(cam.z - c.cz) - half), dd = Math.hypot(dx, dz);
      const l = this.levels.findIndex(([, r]) => dd < r);
      return l;
    });
    const key = pick.join(',');
    if (key === this.key) return;
    this.key = key;
    this.levels.forEach(([step], l) => this.merge(this.meshes[l], this.chunks.filter((_, i) => pick[i] === l).map((c) => this.chunkGeo(c, step))));
    this.buildFar(new Set(this.chunks.map((c, i) => (pick[i] >= 0 ? c.cj * this.nci + c.ci : -1)).filter((v) => v >= 0)));
  }

  private chunkGeo(c: Chunk, step: number) {
    const got = c.geo.get(step);
    if (got) return got;
    const { nx, nz, x0, z0, cell } = this.d.grid, h = this.d.h;
    const i0 = c.ci * CH, j0 = c.cj * CH, i1 = Math.min(nx - 1, i0 + CH), j1 = Math.min(nz - 1, j0 + CH);
    const is: number[] = [], js: number[] = [];
    for (let i = i0; i < i1; i += step) is.push(i);
    is.push(i1);
    for (let j = j0; j < j1; j += step) js.push(j);
    js.push(j1);
    const W = is.length, Hh = js.length;
    // the grid, then the skirt: a ring of vertices under the border
    const ring: [number, number][] = [];
    for (let a = 0; a < W; a++) ring.push([a, 0]);
    for (let b = 1; b < Hh; b++) ring.push([W - 1, b]);
    for (let a = W - 2; a >= 0; a--) ring.push([a, Hh - 1]);
    for (let b = Hh - 2; b > 0; b--) ring.push([0, b]);
    const nv = W * Hh + ring.length;
    const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3), co = new Float32Array(nv * 3);
    const put = (v: number, i: number, j: number, dy: number) => {
      const k = j * nx + i;
      p.set([x0 + i * cell, h[k] - dy, z0 + j * cell], v * 3);
      n.set(this.nrm.subarray(k * 3, k * 3 + 3), v * 3);
      co.set(this.col.subarray(k * 3, k * 3 + 3), v * 3);
    };
    for (let b = 0; b < Hh; b++) for (let a = 0; a < W; a++) put(b * W + a, is[a], js[b], 0);
    ring.forEach(([a, b], r) => put(W * Hh + r, is[a], js[b], SKIRT));
    const idx: number[] = [];
    for (let b = 0; b < Hh - 1; b++) for (let a = 0; a < W - 1; a++) {
      const v = b * W + a;
      idx.push(v, v + W, v + 1, v + 1, v + W, v + W + 1);
    }
    // the skirt faces outwards and downwards round the ring (double-sided is not needed: seen only from outside)
    for (let r = 0; r < ring.length; r++) {
      const r2 = (r + 1) % ring.length;
      const top0 = ring[r][1] * W + ring[r][0], top1 = ring[r2][1] * W + ring[r2][0];
      const bot0 = W * Hh + r, bot1 = W * Hh + r2;
      idx.push(top0, top1, bot0, top1, bot1, bot0, top0, bot0, top1, top1, bot0, bot1);
    }
    const g = { p, n, c: co, i: new Uint32Array(idx) };
    c.geo.set(step, g);
    return g;
  }

  private merge(mesh: THREE.Mesh, parts: { p: Float32Array; n: Float32Array; c: Float32Array; i: Uint32Array }[]): void {
    const nv = parts.reduce((s, g) => s + g.p.length / 3, 0), ni = parts.reduce((s, g) => s + g.i.length, 0);
    const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3), c = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const g of parts) {
      p.set(g.p, ov * 3); n.set(g.n, ov * 3); c.set(g.c, ov * 3);
      for (let k = 0; k < g.i.length; k++) idx[oi + k] = g.i[k] + ov;
      ov += g.p.length / 3; oi += g.i.length;
    }
    for (let v = 0; v < nv; v++) { uv[v * 2] = p[v * 3] / 9; uv[v * 2 + 1] = p[v * 3 + 2] / 9; }
    this.setGeo(mesh, p, n, c, uv, idx);
  }

  /** Everything at FAR_STEP, less the cells of the chunks drawn in detail. */
  private buildFar(skip: Set<number>): void {
    const { nx, nz, x0, z0, cell } = this.d.grid, h = this.d.h, s = FAR_STEP;
    const is: number[] = [], js: number[] = [];
    for (let i = 0; i < nx - 1; i += s) is.push(i);
    is.push(nx - 1);
    for (let j = 0; j < nz - 1; j += s) js.push(j);
    js.push(nz - 1);
    const W = is.length, Hh = js.length;
    const p = new Float32Array(W * Hh * 3), n = new Float32Array(W * Hh * 3), c = new Float32Array(W * Hh * 3), uv = new Float32Array(W * Hh * 2);
    for (let b = 0; b < Hh; b++) for (let a = 0; a < W; a++) {
      const k = js[b] * nx + is[a], v = b * W + a;
      // a little lower than the detail, so where they overlap at a border the detail wins
      p.set([x0 + is[a] * cell, h[k] - 0.4, z0 + js[b] * cell], v * 3);
      n.set(this.nrm.subarray(k * 3, k * 3 + 3), v * 3); c.set(this.col.subarray(k * 3, k * 3 + 3), v * 3);
      uv[v * 2] = (x0 + is[a] * cell) / 9; uv[v * 2 + 1] = (z0 + js[b] * cell) / 9;
    }
    const idx: number[] = [];
    for (let b = 0; b < Hh - 1; b++) for (let a = 0; a < W - 1; a++) {
      const ci = Math.floor(is[a] / CH), cj = Math.floor(js[b] / CH);
      if (skip.has(cj * this.nci + ci)) continue;
      const v = b * W + a;
      idx.push(v, v + W, v + 1, v + 1, v + W, v + W + 1);
    }
    this.setGeo(this.far, p, n, c, uv, new Uint32Array(idx));
  }

  private setGeo(mesh: THREE.Mesh, p: Float32Array, n: Float32Array, c: Float32Array, uv: Float32Array, idx: Uint32Array): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = g;
  }
}

/**
 * The far hills round the detailed ground (mountain.bin's ring, 100 m): one mesh, coloured like the ground (by height
 * and slope, no detail), cells with a corner inside the detailed ground left out and a skirt hung on that seam.
 */
export function farHills(d: MountainData, mat: THREE.Material): THREE.Mesh {
  const R = d.ring, h = R.h, nx = R.nx, nz = R.nz;
  const p: number[] = [], c: number[] = [], idx: number[] = [];
  const vid = new Int32Array(nx * nz).fill(-1);
  const n = new THREE.Vector3();
  const vert = (i: number, j: number, dy = 0) => {
    const k = j * nx + i, y = h[k];
    p.push(R.x0 + i * R.cell, y - 0.6 - dy, R.z0 + j * R.cell);
    const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)], hd = h[Math.max(0, j - 1) * nx + i], hu = h[Math.min(nz - 1, j + 1) * nx + i];
    n.set((Number.isFinite(hl) ? hl : y) - (Number.isFinite(hr) ? hr : y), 2 * R.cell, (Number.isFinite(hd) ? hd : y) - (Number.isFinite(hu) ? hu : y)).normalize();
    const steep = 1 - n.y, nn = vnoise(R.x0 / 300 + i / 3, R.z0 / 300 + j / 3);
    _c.copy(C_FOREST).lerp(C_SCRUB, Math.min(1, Math.max(0, (nn - 0.35) * 2))).lerp(C_ROCK, Math.min(1, Math.max(0, (steep - 0.2) * 3)));
    c.push(_c.r, _c.g, _c.b);
    return p.length / 3 - 1;
  };
  const at = (i: number, j: number) => { const k = j * nx + i; if (vid[k] < 0) vid[k] = vert(i, j); return vid[k]; };
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && Number.isFinite(h[j * nx + i]);
  const cellOk = (i: number, j: number) => ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1);
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (!cellOk(i, j)) continue;
    const a = at(i, j), b = at(i + 1, j), e = at(i, j + 1), f = at(i + 1, j + 1);
    idx.push(a, e, b, b, e, f);
    // a skirt on each side whose neighbouring cell is not drawn (the seam with the detailed ground)
    const skirt = (i0: number, j0: number, i1: number, j1: number) => {
      const top0 = at(i0, j0), top1 = at(i1, j1), bot0 = vert(i0, j0, 30), bot1 = vert(i1, j1, 30);
      idx.push(top0, bot0, top1, top1, bot0, bot1, top0, top1, bot0, top1, bot1, bot0);
    };
    if (!cellOk(i, j - 1) && j > 0) skirt(i, j, i + 1, j);
    if (!cellOk(i, j + 1) && j < nz - 2) skirt(i, j + 1, i + 1, j + 1);
    if (!cellOk(i - 1, j) && i > 0) skirt(i, j, i, j + 1);
    if (!cellOk(i + 1, j) && i < nx - 2) skirt(i + 1, j, i + 1, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = 'mountain-far-hills'; m.receiveShadow = false; m.frustumCulled = false;
  return m;
}

/** A grey detail texture over the ground's colours (9 m a repeat): grain, tufts and stones, about 1 on average. */
export function groundDetail(): THREE.CanvasTexture {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(214,214,214)'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 2600; k++) { const v = 150 + Math.random() * 105; g.fillStyle = `rgba(${v},${v},${v},0.55)`; const r = 1 + Math.random() * 3; g.fillRect(Math.random() * S, Math.random() * S, r, r); }
  for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(120,120,120,${0.1 + Math.random() * 0.12})`; g.beginPath(); g.ellipse(Math.random() * S, Math.random() * S, 6 + Math.random() * 18, 4 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
