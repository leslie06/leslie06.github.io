import * as THREE from 'three';
import type { BuildingRec, RoadPiece } from './Data';
import { FLAG_SHOP, FLAG_STREET, ST, TYPE_COLOURS, WALL_COLOURS, type Style } from './visual/styles';
import { hashU, h01, rng } from './visual/hash';
import ROOF_PROPS from './visual/roofprops.json';

/** Per-building facade parameters (see the facade shader in Materials.ts). */
interface Facade { style: Style; fh: number; bw: number; gh: number; top: number; base: number; seed: number; col: THREE.Color }

/**
 * Wall vertices for the facade shader, as indexed quads. Per vertex: uv = (metres along the ring,
 * metres up), aFac = (bay coordinate along the segment, bay width, flags, style), aFloor = (floor
 * height, ground-floor height, roof level, base), aSeed = building hash (24 bit, exact in float).
 */
class FacadeBucket {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; fac: number[] = []; flo: number[] = []; seed: number[] = []; idx: number[] = [];
  private n = 0;
  vert(x: number, y: number, z: number, n: number[], u: number, bay: number, bayW: number, flags: number, style: number, F: Facade, c: THREE.Color): number {
    this.pos.push(x, y, z); this.nor.push(n[0], n[1], n[2]); this.uv.push(u, y);
    this.col.push(c.r, c.g, c.b); this.fac.push(bay, bayW, flags, style); this.flo.push(F.fh, F.gh, F.top, F.base); this.seed.push(F.seed);
    return this.n++;
  }
  /** Roof or roof-object vertex: [x, y, z, u, v] with its own metre UVs. */
  rvert(p: number[], n: number[], c: THREE.Color, style: number, F: Facade): number {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(p[3], p[4]);
    this.col.push(c.r, c.g, c.b); this.fac.push(0, 1, 0, style); this.flo.push(F.fh, F.gh, F.top, F.base); this.seed.push(F.seed);
    return this.n++;
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.fac, 4));
    g.setAttribute('aFloor', new THREE.Float32BufferAttribute(this.flo, 4));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** The roof things' vertices (position, normal, colour) in growing typed arrays, and their indices. */
class PropBucket {
  pos = new Float32Array(3 * 4096); nor = new Float32Array(3 * 4096); col = new Float32Array(3 * 4096);
  idx: number[] = [];
  count = 0;
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color): void {
    if (this.count * 3 + 3 > this.pos.length) {
      const grow = (a: Float32Array) => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
      this.pos = grow(this.pos); this.nor = grow(this.nor); this.col = grow(this.col);
    }
    const o = this.count++ * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
    this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry(), n = this.count * 3;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n), 3));
    g.setIndex(new THREE.BufferAttribute(this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Triangle sink for roofs and roof-top objects: [x, y, z, u, v] corners. */
interface Sink { tri(a: number[], b: number[], c: number[], n: [number, number, number], col: THREE.Color): void }
const sinkOf = (fb: FacadeBucket, style: number, F: Facade): Sink => ({
  tri(a, b, c, n, col) { fb.idx.push(fb.rvert(a, n, col, style, F), fb.rvert(b, n, col, style, F), fb.rvert(c, n, col, style, F)); },
});

export interface BuildingMeshes {
  /** Every wall, parapet, gable, roof and stair house of the tile: one mesh, one material. */
  facade: THREE.BufferGeometry | null;
  /** The roof-top things modelled in Blender (tanks, solar heaters, condensers...), drawn on the near tiles only. */
  props: THREE.BufferGeometry | null;
  /** Wall triangles for a static trimesh collider (base at ground). */
  colVerts: Float32Array;
  colIdx: Uint32Array;
}

const ring = (flat: number[]): [number, number][] => { const r: [number, number][] = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]); return r; };
const pick = <T>(a: T[], r: number): T => a[Math.min(a.length - 1, Math.floor(r * a.length))];
const C = (hex: string) => new THREE.Color(hex);

function facadeOf(b: BuildingRec, top: number, base: number, shops: boolean): Facade {
  const hh = hashU((b.i % 4294967296) >>> 0);
  const r = h01(hashU(hh ^ 0x68e31da4)), r2 = h01(hashU(hh ^ 0x1b873593));
  const H = top - base;
  let style: Style, fh = 3, bw = 3.2;
  switch (b.k) {
    case 'glass': style = ST.GLASS; fh = 3.9 + 0.3 * r2; bw = 3.0; break;
    case 'office': style = r < 0.5 ? ST.OFF_RIBBON : ST.OFF_GRID; fh = 3.6 + 0.3 * r2; bw = 3.2; break;
    case 'resid':
      // by the build's Beijing housing type where it has one, else as before
      style = b.t === 1 ? ST.BRICK : b.t === 2 ? ST.SLAB : b.t === 3 ? ST.TOWER : b.t === 4 ? (r < 0.55 ? ST.TOWER : ST.SLAB)
        : H < 21 ? (r < 0.45 ? ST.BRICK : ST.SLAB) : (r < 0.6 ? ST.TOWER : ST.SLAB);
      fh = 2.85 + 0.2 * r2; bw = style === ST.TOWER ? 3.5 : style === ST.BRICK ? 3.0 : 3.3; break;
    case 'hutong': style = ST.HUTONG; fh = Math.max(2.4, H); bw = 4.2 + r2; break;
    case 'trad': style = ST.TRAD; fh = H > 13 ? H / 2 : Math.max(3, H); bw = 3.8 + r2 * 0.6; break;
    case 'wall': style = ST.WALL; fh = Math.max(1, H); bw = 50; break;
    case 'low': style = ST.LOW; fh = 4.5; bw = 5; break;
    default: style = ST.STATION; fh = 5; bw = 4;
  }
  const housing = style === ST.SLAB || style === ST.BRICK || style === ST.TOWER;
  const gh = base > 0.5 || H < 7 ? 0 : shops && style !== ST.GLASS && style !== ST.LOW ? 4.3 : housing ? fh : 0;
  const col = b.c ? C(b.c).lerp(C('#d8d4cb'), 0.3) : C(pick(b.t ? TYPE_COLOURS[b.t] : WALL_COLOURS[style], b.s)).offsetHSL(0, 0, (r2 - 0.5) * 0.04);
  return { style, fh, bw, gh, top, base, seed: hh & 0xffffff, col };
}

const CAR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'pedestrian', 'service']);
const SHOPPY = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'pedestrian', 'living_street']);

/** Distance from a wall midpoint to the nearest road in front of it (Infinity if none within maxD). */
function roadInFront(roads: RoadPiece[], mx: number, mz: number, nx: number, nz: number, maxD: number, shoppy: boolean): number {
  let best = Infinity;
  for (const r of roads) {
    if (!(shoppy ? SHOPPY : CAR).has(r.c)) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((mx - ax) * vx + (mz - az) * vz) / L2));
      const qx = ax + vx * t - mx, qz = az + vz * t - mz;
      const d = Math.hypot(qx, qz);
      if (d - r.w / 2 > maxD || d < 1e-3) continue;
      if ((qx * nx + qz * nz) / d < 0.55) continue;
      best = Math.min(best, d - r.w / 2);
    }
  }
  return best;
}

/**
 * Build a tile's buildings: all walls in one facade geometry (the facade shader draws windows,
 * balconies, shops from per-vertex style data), roofs per roofing material with roof-top clutter
 * (stair houses, water tanks, solar heaters, AC condensers), and collider triangles. `skip`
 * removes buildings replaced by landmark models; `roads` decides which walls face a street.
 */
export function buildBuildings(list: BuildingRec[], skip?: (b: BuildingRec) => boolean, roads: RoadPiece[] = []): BuildingMeshes {
  const fb = new FacadeBucket(), pb = new PropBucket();
  const cv: number[] = [], ci: number[] = [];
  const roofCol = new THREE.Color();

  for (const b of list) {
    if (skip?.(b)) continue;
    const pitched = (b.r === 'g' || b.r === 'h' || b.r === 'p') && b.ob && b.rh > 0.3;
    const top = pitched ? b.h - b.rh : b.h;
    const base = b.m;
    if (top - base < 0.5) continue;
    const rings = [ring(b.o), ...(b.hs ?? []).map(ring)];
    // Which walls face a street: shops on housing/office ground floors, doors in hutongs.
    const wantShops = (b.k === 'resid' || b.k === 'office') && base < 0.5 && top > 7;
    const segFlags: number[][] = rings.map((r) => r.map((a, i) => {
      const bq = r[(i + 1) % r.length], dx = bq[0] - a[0], dz = bq[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 3 || (!wantShops && b.k !== 'hutong')) return 0;
      const nx = dz / L, nz = -dx / L, mx = (a[0] + bq[0]) / 2 + nx, mz = (a[1] + bq[1]) / 2 + nz;
      const d = roadInFront(roads, mx, mz, nx, nz, b.k === 'hutong' ? 9 : 26, b.k !== 'hutong');
      if (!Number.isFinite(d)) return 0;
      return (wantShops && L >= 4.5 ? FLAG_SHOP : 0) | FLAG_STREET;
    }));
    const hasShops = segFlags.some((fl) => fl.some((f) => f & FLAG_SHOP));
    const F = facadeOf(b, top, base, hasShops);
    const flatStyle = F.style !== ST.HUTONG && F.style !== ST.TRAD && F.style !== ST.WALL;
    const ph = !pitched && flatStyle && top - base > 5 ? (F.style === ST.GLASS ? 1.4 : F.style === ST.LOW ? 0.5 : 0.9) : 0;
    const wallTop = top + ph;

    const ps = base < 0.5 ? passagesOf(b) : [];
    for (const p of ps) passageLining(fb, cv, ci, p, rings, F, ps);

    rings.forEach((r, ri) => {
      let u = 0;
      const n = r.length;
      for (let i = 0; i < n; i++) {
        const [ax, az] = r[i], [bx, bz] = r[(i + 1) % n];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const nx = dz / L, nz = -dx / L;   // outward for positive-area outer rings, into the hole for holes
        const nb = L >= F.bw * 0.6 ? Math.max(1, Math.round(L / F.bw)) : 0;
        const style = nb ? F.style : (F.style === ST.HUTONG || F.style === ST.WALL ? F.style : ST.BLANK);
        const bayW = nb ? L / nb : L;
        const fl = segFlags[ri][i];
        const N = [nx, 0, nz];
        // Seen from outside, a wall's right-hand end is always A: bays count from B so modules
        // (and shop signs) are not mirrored. A road through the building opens the wall below its
        // clearance: the wall is drawn in pieces along t (A = 0, B = 1).
        const quad = (t0: number, t1: number, y0: number, y1: number) => {
          const px = (t: number) => ax + dx * t, pz = (t: number) => az + dz * t;
          const a0 = fb.vert(px(t0), y0, pz(t0), N, u + L * (1 - t0), nb * (1 - t0), bayW, fl, style, F, F.col);
          const b0 = fb.vert(px(t1), y0, pz(t1), N, u + L * (1 - t1), nb * (1 - t1), bayW, fl, style, F, F.col);
          const b1 = fb.vert(px(t1), y1, pz(t1), N, u + L * (1 - t1), nb * (1 - t1), bayW, fl, style, F, F.col);
          const a1 = fb.vert(px(t0), y1, pz(t0), N, u + L * (1 - t0), nb * (1 - t0), bayW, fl, style, F, F.col);
          fb.idx.push(a0, b1, b0, a0, a1, b1);
          if (base < 2.5) collide(cv, ci, px(t0), pz(t0), px(t1), pz(t1), y0 <= base ? 0 : y0, top);
        };
        let t = 0;
        for (const [t0, t1, ch] of openings(ps, ax, az, bx, bz)) {
          if (t0 > t) quad(t, t0, base, wallTop);
          if (ch < wallTop) quad(t0, t1, ch, wallTop);
          t = t1;
        }
        if (t < 1) quad(t, 1, base, wallTop);
        u += L;
      }
      if (ph > 0) parapet(fb, r, top, ph, F);
    });

    // Roofs.
    const roofStyle = b.k === 'trad' ? ST.ROOF_TRAD : pitched ? ST.ROOF_TILE : ST.ROOF_FLAT;
    const rs = sinkOf(fb, roofStyle, F);
    if (b.rc) roofCol.set(b.rc);
    else if (roofStyle === ST.ROOF_TRAD) roofCol.set(b.s < 0.7 ? '#d9a53a' : '#3f7f5a');
    else if (roofStyle === ST.ROOF_TILE) roofCol.set('#8c9194').offsetHSL(0, 0, (b.s - 0.5) * 0.06);
    else roofCol.set(pick(['#a19f98', '#aaa79f', '#959b94', '#b3afa6', '#8f999c', '#a39a8e'], b.s));
    if (pitched) pitchedRoof(rs, fb, b, top, roofCol, F);
    else {
      flatRoof(rs, rings, top, roofCol);
      if (flatStyle && top - base > 6) clutter(rs, pb, fb, b, rings, top, F);
    }
  }
  return { facade: fb.build(), props: pb.build(), colVerts: new Float32Array(cv), colIdx: new Uint32Array(ci) };
}

/** A road through a building: start, unit direction and length along it, half width, clearance. */
/** `open`: a passage the build gave a road through a big building (a negative clearance in the record):
 * no side walls - it follows a whole road, bends and junctions, and its walls stood in the way. */
interface Passage { ax: number; az: number; dx: number; dz: number; len: number; hw: number; ch: number; open: boolean }

function passagesOf(b: BuildingRec): Passage[] {
  const out: Passage[] = [];
  const p = b.ps;
  if (!p) return out;
  for (let i = 0; i + 5 < p.length; i += 6) {
    const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (L > 0.1) out.push({ ax: p[i], az: p[i + 1], dx: (p[i + 2] - p[i]) / L, dz: (p[i + 3] - p[i + 1]) / L, len: L, hw: p[i + 4], ch: Math.abs(p[i + 5]), open: p[i + 5] < 0 });
  }
  return out;
}

/** Where a wall A-B crosses the passages: [t0, t1, clearance] runs along it (A = 0, B = 1), merged and sorted. */
function openings(ps: Passage[], ax: number, az: number, bx: number, bz: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  // the t where lo <= f0 + (f1 - f0) t <= hi, clipped to [lo, hi] of t
  const clip = (f0: number, f1: number, lo: number, hi: number, r: [number, number]) => {
    const df = f1 - f0;
    if (Math.abs(df) < 1e-9) { if (f0 < lo || f0 > hi) r[0] = 1, r[1] = 0; return; }
    let a = (lo - f0) / df, b = (hi - f0) / df;
    if (a > b) [a, b] = [b, a];
    r[0] = Math.max(r[0], a); r[1] = Math.min(r[1], b);
  };
  for (const p of ps) {
    const nx = -p.dz, nz = p.dx;
    const r: [number, number] = [0, 1];
    clip((ax - p.ax) * nx + (az - p.az) * nz, (bx - p.ax) * nx + (bz - p.az) * nz, -p.hw, p.hw, r);
    clip((ax - p.ax) * p.dx + (az - p.az) * p.dz, (bx - p.ax) * p.dx + (bz - p.az) * p.dz, 0, p.len, r);
    if (r[1] - r[0] > 1e-4) out.push([r[0], r[1], p.ch]);
  }
  out.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < out.length; i++) {
    if (out[i][0] <= out[i - 1][1]) { out[i - 1][1] = Math.max(out[i - 1][1], out[i][1]); out[i - 1][2] = Math.min(out[i - 1][2], out[i][2]); out.splice(i--, 1); }
  }
  return out;
}

/** Collider quad from (ax, az) to (bx, bz), y0..y1. */
function collide(cv: number[], ci: number[], ax: number, az: number, bx: number, bz: number, y0: number, y1: number): void {
  if (y1 - y0 < 0.05) return;
  const k = cv.length / 3;
  cv.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
  ci.push(k, k + 2, k + 1, k, k + 3, k + 2);
}

const inside = (x: number, z: number, r: [number, number][]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[i], [bx, bz] = r[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
  }
  return c;
};

/** The spans [s0, s1] along a line (start, direction, 0..len) that lie inside the building. */
function spansInside(x0: number, z0: number, dx: number, dz: number, len: number, rings: [number, number][][]): [number, number][] {
  const ss = [0, len];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
      const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const s = ((ax - x0) * ez - (az - z0) * ex) / den, t = ((ax - x0) * dz - (az - z0) * dx) / den;
      if (t >= 0 && t <= 1 && s > 0 && s < len) ss.push(s);
    }
  }
  ss.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ss.length; i++) {
    const m = (ss[i] + ss[i + 1]) / 2;
    const inAll = inside(x0 + dx * m, z0 + dz * m, rings[0]) && !rings.slice(1).some((h) => inside(x0 + dx * m, z0 + dz * m, h));
    if (inAll && ss[i + 1] - ss[i] > 0.05) out.push([ss[i], ss[i + 1]]);
  }
  return out;
}

/** The passage's two side walls and ceiling inside the building, facing into it; its sides collide. */
/** Whether (x, z) is inside the opening of a passage other than `p` (a road bending inside a building). */
function inOtherPassage(x: number, z: number, p: Passage, all: Passage[]): boolean {
  for (const q of all) {
    if (q === p) continue;
    const rx = x - q.ax, rz = z - q.az, along = rx * q.dx + rz * q.dz, lat = -rx * q.dz + rz * q.dx;
    if (along > 0 && along < q.len && Math.abs(lat) < q.hw - 0.05) return true;
  }
  return false;
}

/** Sub-spans of [s0, s1] along a line from (x0, z0) that are not inside another passage's opening. */
function outsideOthers(x0: number, z0: number, dx: number, dz: number, s0: number, s1: number, p: Passage, all: Passage[]): [number, number][] {
  if (all.length < 2) return [[s0, s1]];
  const out: [number, number][] = [];
  let start = -1;
  const step = 0.5, n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * i / n, free = !inOtherPassage(x0 + dx * s, z0 + dz * s, p, all);
    if (free && start < 0) start = s;
    if ((!free || i === n) && start >= 0) { const e = free ? s : s - (s1 - s0) / n; if (e - start > 2) out.push([start, e]); start = -1; }  // no stubs between openings: a car cuts the corner
  }
  return out;
}

function passageLining(fb: FacadeBucket, cv: number[], ci: number[], p: Passage, rings: [number, number][][], F: Facade, all: Passage[] = [p]): void {
  const nx = -p.dz, nz = p.dx;
  const wall = F.col.clone().multiplyScalar(0.8), ceil = F.col.clone().multiplyScalar(0.55);
  for (const side of p.open ? [] : [-1, 1]) {
    const x0 = p.ax + nx * side * p.hw, z0 = p.az + nz * side * p.hw;
    // A road that bends inside the building is several passages: each one's side wall stops where it
    // enters another's opening, or it stood across the road at the bend (东直门交通枢纽's bus lane).
    for (const [s0, s1] of spansInside(x0, z0, p.dx, p.dz, p.len, rings).flatMap(([a, b]) => outsideOthers(x0, z0, p.dx, p.dz, a, b, p, all))) {
      // wall from A to B faces (dz, -dx) of its direction: order the ends so that is towards the road
      let ax = x0 + p.dx * s0, az = z0 + p.dz * s0, bx = x0 + p.dx * s1, bz = z0 + p.dz * s1;
      if ((bz - az) * (-nx * side) + (-(bx - ax)) * (-nz * side) < 0) [ax, az, bx, bz] = [bx, bz, ax, az];
      const N = [-nx * side, 0, -nz * side], L = s1 - s0;
      const a0 = fb.vert(ax, 0, az, N, L, 0, L, 0, ST.BLANK, F, wall), b0 = fb.vert(bx, 0, bz, N, 0, 0, L, 0, ST.BLANK, F, wall);
      const b1 = fb.vert(bx, p.ch, bz, N, 0, 0, L, 0, ST.BLANK, F, wall), a1 = fb.vert(ax, p.ch, az, N, L, 0, L, 0, ST.BLANK, F, wall);
      fb.idx.push(a0, b1, b0, a0, a1, b1);
      collide(cv, ci, ax, az, bx, bz, 0, p.ch);
    }
  }
  const D = [0, -1, 0];
  for (const [s0, s1] of spansInside(p.ax, p.az, p.dx, p.dz, p.len, rings)) {
    const c = (s: number, side: number) => [p.ax + p.dx * s + nx * side * p.hw, p.az + p.dz * s + nz * side * p.hw];
    const q = [c(s0, -1), c(s1, -1), c(s1, 1), c(s0, 1)].map(([x, z], i) => fb.vert(x, p.ch, z, D, i === 1 || i === 2 ? s1 - s0 : 0, 0, s1 - s0, 0, ST.BLANK, F, ceil));
    // facing down: clockwise seen from below
    const cross = (c(s1, -1)[0] - c(s0, -1)[0]) * (c(s0, 1)[1] - c(s0, -1)[1]) - (c(s1, -1)[1] - c(s0, -1)[1]) * (c(s0, 1)[0] - c(s0, -1)[0]);
    if (cross > 0) fb.idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else fb.idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
  }
}

/** Inner face and cap of a parapet around a flat roof, with mitred corners. */
function parapet(fb: FacadeBucket, r: [number, number][], top: number, ph: number, F: Facade): void {
  const n = r.length, t = 0.25;
  const nor: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % n];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    nor.push([(bz - az) / L, -(bx - ax) / L]);
  }
  const inner: [number, number][] = r.map((p, i) => {
    const n0 = nor[(i - 1 + n) % n], n1 = nor[i];
    const d = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    let mx = (n0[0] + n1[0]) / Math.max(0.25, d), mz = (n0[1] + n1[1]) / Math.max(0.25, d);
    const ml = Math.hypot(mx, mz); if (ml > 3) { mx *= 3 / ml; mz *= 3 / ml; }
    return [p[0] - mx * t, p[1] - mz * t];
  });
  const cap = F.col.clone().lerp(new THREE.Color('#c9c7c1'), 0.5);
  const y0 = top, y1 = top + ph;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, az] = inner[i], [bx, bz] = inner[j];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const N = [-nor[i][0], 0, -nor[i][1]];
    const a0 = fb.vert(ax, y0, az, N, u, 0, L, 0, ST.BLANK, F, F.col), b0 = fb.vert(bx, y0, bz, N, u + L, 0, L, 0, ST.BLANK, F, F.col);
    const b1 = fb.vert(bx, y1, bz, N, u + L, 0, L, 0, ST.BLANK, F, F.col), a1 = fb.vert(ax, y1, az, N, u, 0, L, 0, ST.BLANK, F, F.col);
    fb.idx.push(a0, b0, b1, a0, b1, a1);
    const up = [0, 1, 0];
    const o0 = fb.vert(r[i][0], y1, r[i][1], up, u, 0, L, 4, ST.BLANK, F, cap), o1 = fb.vert(r[j][0], y1, r[j][1], up, u + L, 0, L, 4, ST.BLANK, F, cap);
    const i1 = fb.vert(bx, y1, bz, up, u + L, 0, L, 4, ST.BLANK, F, cap), i0 = fb.vert(ax, y1, az, up, u, 0, L, 4, ST.BLANK, F, cap);
    // cap faces up: (outer a, inner b, outer b) winding checked against +Y
    const cx = (r[j][0] - r[i][0]) * (bz - r[i][1]) - (r[j][1] - r[i][1]) * (bx - r[i][0]);
    if (cx < 0) fb.idx.push(o0, o1, i1, o0, i1, i0); else fb.idx.push(o0, i1, o1, o0, i0, i1);
    u += L;
  }
}

function flatRoof(rb: Sink, rings: [number, number][][], y: number, col: THREE.Color): void {
  const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = rings.slice(1).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  let faces: number[][];
  try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { return; }
  const all = contour.concat(...holes);
  for (const f of faces) {
    let [a, b, c] = f.map((i) => all[i]);
    // Face up (+Y): in (x, z) that is a clockwise triangle.
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross > 0) [b, c] = [c, b];
    rb.tri([a.x, y, a.y, a.x, a.y], [b.x, y, b.y, b.x, b.y], [c.x, y, c.y, c.x, c.y], [0, 1, 0], col);
  }
}

/** Gabled / hipped / pyramidal roof over the oriented box, eave overhang; gable ends are walls. */
function pitchedRoof(rb: Sink, fb: FacadeBucket, b: BuildingRec, eave: number, col: THREE.Color, F: Facade): void {
  const [cx, cz, ang, hl0, hw0] = b.ob!;
  const over = b.k === 'trad' ? 1.1 : 0.45;
  const hl = hl0 + (b.r === 'g' ? 0.15 : over), hw = hw0 + over;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P = (u: number, v: number, y: number): number[] => [cx + u * ca - v * sa, y, cz + u * sa + v * ca];
  const top = b.h;
  const drop = over * (b.rh / Math.max(0.5, hw0)) ;
  const e = eave - Math.min(drop, b.k === 'trad' ? 1.2 : 0.5);
  const ridge = b.r === 'g' ? hl : b.r === 'h' ? Math.max(0, hl - hw) : 0;
  const c1 = P(-hl, -hw, e), c2 = P(hl, -hw, e), c3 = P(hl, hw, e), c4 = P(-hl, hw, e);
  const r1 = P(-ridge, 0, top), r2 = P(ridge, 0, top);
  const quad = (a: number[], bq: number[], c: number[], d: number[]) => { face(rb, a, bq, c, col); face(rb, a, c, d, col); };
  quad(c1, c2, r2, r1);
  quad(c3, c4, r1, r2);
  if (b.r === 'g') {
    // Gable ends in the wall material, from the wall top up to the ridge.
    const g1 = P(hl0, -hw0, eave), g2 = P(hl0, hw0, eave), g3 = P(hl0, 0, top);
    const g4 = P(-hl0, hw0, eave), g5 = P(-hl0, -hw0, eave), g6 = P(-hl0, 0, top);
    for (const [p, q, s, nu] of [[g1, g2, g3, 1], [g4, g5, g6, -1]] as [number[], number[], number[], number][]) {
      const N = [ca * nu, 0, sa * nu];
      const L = Math.hypot(q[0] - p[0], q[2] - p[2]);
      const ia = fb.vert(p[0], p[1], p[2], N, 0, 0, L, 4, F.style, F, F.col), ib = fb.vert(q[0], q[1], q[2], N, L, 0, L, 4, F.style, F, F.col), ic = fb.vert(s[0], s[1], s[2], N, L / 2, 0, L, 4, F.style, F, F.col);
      // order the triangle so it faces its outward normal
      const fx = (q[1] - p[1]) * (s[2] - p[2]) - (q[2] - p[2]) * (s[1] - p[1]), fz = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
      if (fx * N[0] + fz * N[2] >= 0) fb.idx.push(ia, ib, ic); else fb.idx.push(ia, ic, ib);
    }
  }
  face(rb, c2, c3, r2, col);
  face(rb, c4, c1, r1, col);
}

/** One triangle with its own flat normal (made to face up/outward) and slope-aligned UVs in metres. */
function face(rb: Sink, a: number[], b: number[], c: number[], col: THREE.Color, out?: number[]): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  let p = [a, b, c];
  // Face up, or (for objects) away from `out`, the object's centre.
  const flip = out ? nx * ((a[0] + b[0] + c[0]) / 3 - out[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - out[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - out[2]) < 0 : ny < 0;
  if (flip) { nx = -nx; ny = -ny; nz = -nz; p = [a, c, b]; }
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L; ny /= L; nz /= L;
  const hx = -nz, hz = nx, hl = Math.hypot(hx, hz) || 1;
  const uvOf = (q: number[]) => [(q[0] * hx + q[2] * hz) / hl, q[1] / Math.max(0.2, Math.hypot(nx, nz) + 0.2) * 0.9];
  const w = p.map((q) => [q[0], q[1], q[2], ...uvOf(q)]);
  rb.tri(w[0], w[1], w[2], [nx, ny, nz], col);
}

// ------------------------------------------------------------------ roof clutter

function pip(x: number, z: number, r: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function obb(r: [number, number][]): { cx: number; cz: number; ang: number; hl: number; hw: number } {
  let best: { area: number; cx: number; cz: number; ang: number; hl: number; hw: number } | null = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of r) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      let hu = (u1 - u0) / 2, hv = (v1 - v0) / 2, an = ang;
      if (hv > hu) { [hu, hv] = [hv, hu]; an += Math.PI / 2; }
      best = { area, cx: cu * c - cv * s, cz: cu * s + cv * c, ang: an, hl: hu, hw: hv };
    }
  }
  return best!;
}

/** Oriented box: centre, three half-axis vectors; 5 faces (no bottom), normals away from the centre. */
function obox(rb: Sink, c: number[], ax: number[], ay: number[], az: number[], col: THREE.Color): void {
  const P = (i: number, j: number, k: number) => [c[0] + ax[0] * i + ay[0] * j + az[0] * k, c[1] + ax[1] * i + ay[1] * j + az[1] * k, c[2] + ax[2] * i + ay[2] * j + az[2] * k];
  const faces: [number[], number[], number[], number[]][] = [
    [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)],
    [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
    [P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1)],
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
    [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
  ];
  for (const [a, b, cc, d] of faces) { face(rb, a, b, cc, col, c); face(rb, a, cc, d, col, c); }
}

function cylinder(rb: Sink, x: number, z: number, r: number, y0: number, y1: number, col: THREE.Color, sides = 8): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [x + Math.cos(a0) * r, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, z + Math.sin(a1) * r];
    const n: [number, number, number] = [Math.cos(am), 0, Math.sin(am)];
    const A = [p0[0], y0, p0[1], i, y0], B = [p1[0], y0, p1[1], i + 1, y0], Cc = [p1[0], y1, p1[1], i + 1, y1], D = [p0[0], y1, p0[1], i, y1];
    rb.tri(A, Cc, B, n, col); rb.tri(A, D, Cc, n, col);
    rb.tri([x, y1, z, x, z], [p1[0], y1, p1[1], p1[0], p1[1]], [p0[0], y1, p0[1], p0[0], p0[1]], [0, 1, 0], col);
  }
}

/** Colours of the Blender roof things' materials (scripts/blender/props/roof.py). */
const ROOF_COLOURS: Record<string, THREE.Color> = {
  steel: C('#8a8d8f'), tank: C('#a9c3d1'), pipe: C('#6e6f6c'), glass: C('#1d2a36'), white: C('#e2e3de'),
  grille: C('#34383b'), badge: C('#9aa3a8'), louvre: C('#a7aaa4'), red: C('#c0302a'),
};
/** Water tank colours (`model`'s tint recolours the 'tank' material). */
const TANK_TINTS = ['#8fb2c8', '#dde1e0', '#9a9d9a', '#b9c7cf'].map((h) => new THREE.Color(h));

/** Each thing's parts with positions in metres and unit normals, decoded once per worker. */
type PropPart = { mat: string; col: THREE.Color; p: Float32Array; n: Float32Array; i: Uint16Array };
const PROPS: Record<string, PropPart[]> = Object.fromEntries(Object.entries(ROOF_PROPS as unknown as Record<string, Record<string, { p: number[]; n: number[]; i: number[] }>>).map(([name, parts]) => [name,
  Object.entries(parts).map(([mat, g]) => ({ mat, col: ROOF_COLOURS[mat] ?? ROOF_COLOURS.steel, p: Float32Array.from(g.p, (v) => v / 1000), n: Float32Array.from(g.n, (v) => v / 100), i: Uint16Array.from(g.i) }))]));

/**
 * A Blender roof thing into a bucket: at (x, y, z), turned `yaw` about y, scaled `s`, `tint` recolouring its
 * 'tank' material. Written straight into the arrays, a vertex per model vertex (the export already splits them
 * per face), a position, normal and colour each: through the facade's Sink, 21 floats a vertex a triangle at
 * a time, the roofs made a tile's buildings five times slower to build.
 */
function model(fb: PropBucket, name: string, x: number, y: number, z: number, yaw: number, s = 1, tint?: THREE.Color): void {
  const parts = PROPS[name];
  if (!parts) return;
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  for (let k = 0; k < parts.length; k++) {
    const g = parts[k], col = tint && g.mat === 'tank' ? tint : g.col;
    const base = fb.count;
    for (let v = 0; v < g.p.length; v += 3) {
      const lx = g.p[v] * s, lz = g.p[v + 2] * s, nx = g.n[v], nz = g.n[v + 2];
      const wx = x + lx * ca + lz * sa, wz = z - lx * sa + lz * ca;
      fb.vert(wx, y + g.p[v + 1] * s, wz, nx * ca + nz * sa, g.n[v + 1], -nx * sa + nz * ca, col);
    }
    for (let t = 0; t < g.i.length; t++) fb.idx.push(base + g.i[t]);
  }
}

/**
 * Beijing roof-top clutter, placed inside the footprint by rejection sampling (seeded per building).
 * Stair and lift houses go into the facade (`roof`, `fb`); every other thing is a Blender model into `pb`,
 * a mesh of its own drawn on the near tiles only (a condenser is under two pixels from the far ones):
 * solar heaters in rows facing south and condensers along the parapet on the housing, plant on the offices.
 */
function clutter(roof: Sink, pb: PropBucket, fb: FacadeBucket, b: BuildingRec, rings: [number, number][][], top: number, F: Facade): void {
  const outer = rings[0], holes = rings.slice(1);
  const o = obb(outer);
  if (o.hl < 3 || o.hw < 2.2) return;
  const R = rng(F.seed * 7 + 3);
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
  const W = (u: number, v: number): [number, number] => [o.cx + u * ca - v * sa, o.cz + u * sa + v * ca];
  const inside = (x: number, z: number) => pip(x, z, outer) && !holes.some((h) => pip(x, z, h));
  const fits = (u: number, v: number, hu: number, hv: number, m = 0.7) => {
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [x, z] = W(u + du * (hu + m), v + dv * (hv + m)); if (!inside(x, z)) return false; }
    return true;
  };
  const place = (hu: number, hv: number, tries = 14): [number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const u = (R() * 2 - 1) * Math.max(0, o.hl - hu - 0.8), v = (R() * 2 - 1) * Math.max(0, o.hw - hv - 0.8);
      if (fits(u, v, hu, hv)) return [u, v];
    }
    return null;
  };
  const area = o.hl * o.hw * 4;
  const tall = top - F.base;
  const office = F.style === ST.GLASS || F.style === ST.OFF_GRID || F.style === ST.OFF_RIBBON;
  // Stair / lift house in the wall material.
  if (area > 180 && tall > 11) {
    const hu = office ? Math.min(o.hl * 0.45, 9) : 1.6 + R() * 1.2, hv = office ? Math.min(o.hw * 0.5, 7) : 1.4 + R() * 0.6;
    const at = place(hu, hv, 20);
    if (at) {
      const hh = office ? 4.5 : 2.8 + R() * 0.6;
      const cs = [W(at[0] - hu, at[1] - hv), W(at[0] + hu, at[1] - hv), W(at[0] + hu, at[1] + hv), W(at[0] - hu, at[1] + hv)];
      // CCW in (x, z) as the footprints are
      const area2 = cs.reduce((s, p, i) => { const q = cs[(i + 1) % 4]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
      if (area2 < 0) cs.reverse();
      const HF: Facade = { ...F, style: ST.BLANK, top: top + hh, base: top, gh: 0 };
      let u = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4], L = Math.hypot(bx - ax, bz - az);
        const N = [(bz - az) / L, 0, -(bx - ax) / L];
        const a0 = fb.vert(ax, top, az, N, u, 0, L, 4, ST.BLANK, HF, F.col), b0 = fb.vert(bx, top, bz, N, u + L, 0, L, 4, ST.BLANK, HF, F.col);
        const b1 = fb.vert(bx, top + hh, bz, N, u + L, 0, L, 4, ST.BLANK, HF, F.col), a1 = fb.vert(ax, top + hh, az, N, u, 0, L, 4, ST.BLANK, HF, F.col);
        fb.idx.push(a0, b1, b0, a0, a1, b1);
        u += L;
      }
      const rc = new THREE.Color('#9d9b95');
      flatRoof(roof, [cs], top + hh, rc);
      if (!office && R() < 0.6) { const [x, z] = W(at[0], at[1]); model(pb, 'tank', x, top + hh, z, o.ang, 0.8 + R() * 0.2, TANK_TINTS[Math.floor(R() * 3)]); }
    }
  }
  const housing = F.style === ST.SLAB || F.style === ST.BRICK || F.style === ST.TOWER;
  // Everything below is a Blender model (scripts/blender/props/roof.py), on the near tiles only.
  const yawU = o.ang, south = Math.PI;
  const taken: [number, number, number][] = [];          // (u, v, radius) already used on this roof
  const free = (u: number, v: number, r: number) => taken.every(([tu, tv, tr]) => Math.hypot(u - tu, v - tv) > r + tr);
  const put = (name: string, u: number, v: number, r: number, yaw: number, s = 1, tint?: THREE.Color) => {
    if (!free(u, v, r) || !fits(u, v, r, r, 0.3)) return false;
    taken.push([u, v, r]);
    const [x, z] = W(u, v);
    model(pb, name, x, top, z, yaw, s, tint);
    return true;
  };
  const scatter = (name: string, r: number, n: number, yaw: () => number, tries = 8) => {
    let k = 0;
    for (let t = 0; t < n * tries && k < n; t++) {
      const u = (R() * 2 - 1) * Math.max(0, o.hl - r - 0.6), v = (R() * 2 - 1) * Math.max(0, o.hw - r - 0.6);
      if (put(name, u, v, r, yaw())) k++;
    }
  };
  // A row along the long axis at offset v, from one end: solar heaters, condensers along a parapet.
  const row = (name: string, v: number, step: number, r: number, yaw: number, frac: number) => {
    const len = 2 * (o.hl - r - 0.6) * frac, u0 = -len / 2 + (R() - 0.5) * (2 * o.hl - len) * 0.5;
    for (let u = u0; u <= u0 + len; u += step) put(name, u, v, r, yaw);
  };
  if (housing) {
    // Solar water heaters in rows on the south half, facing south, on most of the old slabs.
    if (tall < 40 && R() < 0.75) {
      const rows = o.hw > 6 ? 1 + Math.floor(R() * Math.min(3, o.hw / 5)) : 1;
      for (let k = 0; k < rows; k++) row('solar', (o.hw - 2.2) * (1 - k * 0.9 / Math.max(1, rows)) * (Math.cos(o.ang) >= 0 ? 1 : -1), 2.5, 1.2, south, 0.4 + R() * 0.55);
    }
    // Condensers along the north parapet, a tank or two, dishes.
    if (R() < 0.8) row('ac', -(o.hw - 1.0) * (Math.cos(o.ang) >= 0 ? 1 : -1), 1.3 + R() * 0.8, 0.5, yawU + south, 0.3 + R() * 0.6);
    if (R() < 0.5) {
      const tint = TANK_TINTS[Math.floor(R() * 4)];
      for (let k = 0, n = 1 + Math.floor(R() * 2), t = 0; k < n && t < 16; t++) {
        const u = (R() * 2 - 1) * Math.max(0, o.hl - 2), v = (R() * 2 - 1) * Math.max(0, o.hw - 2);
        if (put('tank', u, v, 1.4, yawU + R() * 0.3, 1, tint)) k++;
      }
    }
    if (R() < 0.35) scatter('dish', 0.6, 1 + Math.floor(R() * 3), () => south + (R() - 0.5) * 0.6);
  } else if (office) {
    // Plant: cooling towers, condensers in blocks, exhaust fans.
    if (area > 300) scatter('cooling', 1.9, 1 + Math.floor(R() * (area > 1500 ? 4 : 2)), () => yawU, 12);
    for (let b = 0, nb = 1 + Math.floor(R() * 3); b < nb; b++) {
      const u0 = (R() * 2 - 1) * Math.max(0, o.hl - 4), v0 = (R() * 2 - 1) * Math.max(0, o.hw - 3);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) put('ac', u0 + i * 1.1, v0 + j * 1.4, 0.5, yawU);
    }
    scatter('vent', 0.5, 2 + Math.floor(R() * 5), () => yawU);
  } else if (R() < 0.6) {
    scatter('ac', 0.5, 2 + Math.floor(R() * 5), () => yawU + (R() < 0.5 ? 0 : south));
  }
  if (R() < 0.3) scatter('mast', 0.3, 1, () => R() * 6.28);
}
