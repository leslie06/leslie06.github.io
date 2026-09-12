import * as THREE from 'three';
import type { BuildingRec, RoadPiece } from './Data';
import { FLAG_SHOP, FLAG_STREET, ST, WALL_COLOURS, type Style } from './visual/styles';
import { hashU, h01, rng } from './visual/hash';

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

/** Triangle sink for roofs and roof-top objects: [x, y, z, u, v] corners. */
interface Sink { tri(a: number[], b: number[], c: number[], n: [number, number, number], col: THREE.Color): void }
const sinkOf = (fb: FacadeBucket, style: number, F: Facade): Sink => ({
  tri(a, b, c, n, col) { fb.idx.push(fb.rvert(a, n, col, style, F), fb.rvert(b, n, col, style, F), fb.rvert(c, n, col, style, F)); },
});

export interface BuildingMeshes {
  /** Every wall, parapet, gable, roof and roof-top object of the tile: one mesh, one material. */
  facade: THREE.BufferGeometry | null;
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
      style = H < 21 ? (r < 0.45 ? ST.BRICK : ST.SLAB) : (r < 0.6 ? ST.TOWER : ST.SLAB);
      fh = 2.85 + 0.2 * r2; bw = style === ST.TOWER ? 3.5 : style === ST.BRICK ? 3.0 : 3.3; break;
    case 'hutong': style = ST.HUTONG; fh = Math.max(2.4, H); bw = 4.2 + r2; break;
    case 'trad': style = ST.TRAD; fh = H > 13 ? H / 2 : Math.max(3, H); bw = 3.8 + r2 * 0.6; break;
    case 'wall': style = ST.WALL; fh = Math.max(1, H); bw = 50; break;
    case 'low': style = ST.LOW; fh = 4.5; bw = 5; break;
    default: style = ST.STATION; fh = 5; bw = 4;
  }
  const housing = style === ST.SLAB || style === ST.BRICK || style === ST.TOWER;
  const gh = base > 0.5 || H < 7 ? 0 : shops && style !== ST.GLASS && style !== ST.LOW ? 4.3 : housing ? fh : 0;
  const col = b.c ? C(b.c).lerp(C('#d8d4cb'), 0.3) : C(pick(WALL_COLOURS[style], b.s)).offsetHSL(0, 0, (r2 - 0.5) * 0.04);
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
  const fb = new FacadeBucket();
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
        // (and shop signs) are not mirrored.
        const a0 = fb.vert(ax, base, az, N, u + L, nb, bayW, fl, style, F, F.col);
        const b0 = fb.vert(bx, base, bz, N, u, 0, bayW, fl, style, F, F.col);
        const b1 = fb.vert(bx, wallTop, bz, N, u, 0, bayW, fl, style, F, F.col);
        const a1 = fb.vert(ax, wallTop, az, N, u + L, nb, bayW, fl, style, F, F.col);
        fb.idx.push(a0, b1, b0, a0, a1, b1);
        if (base < 2.5) {
          const k = cv.length / 3;
          cv.push(ax, 0, az, bx, 0, bz, bx, top, bz, ax, top, az);
          ci.push(k, k + 2, k + 1, k, k + 3, k + 2);
        }
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
      if (flatStyle && top - base > 6) clutter(rs, sinkOf(fb, ST.OBJ, F), fb, b, rings, top, F);
    }
  }
  return { facade: fb.build(), colVerts: new Float32Array(cv), colIdx: new Uint32Array(ci) };
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

/** Beijing roof-top clutter, placed inside the footprint by rejection sampling (seeded per building). */
function clutter(roof: Sink, rb: Sink, fb: FacadeBucket, b: BuildingRec, rings: [number, number][][], top: number, F: Facade): void {
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
  const AX = [ca, 0, sa], AZ = [-sa, 0, ca];
  const box = (u: number, v: number, hu: number, hv: number, y0: number, y1: number, col: THREE.Color) => {
    const [x, z] = W(u, v);
    obox(rb, [x, (y0 + y1) / 2, z], [AX[0] * hu, 0, AX[2] * hu], [0, (y1 - y0) / 2, 0], [AZ[0] * hv, 0, AZ[2] * hv], col);
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
      if (!office && R() < 0.6) cylinder(rb, ...W(at[0], at[1]), 0.9 + R() * 0.3, top + hh, top + hh + 1.6, new THREE.Color(pick(['#8fb2c8', '#dde1e0', '#9a9d9a'], R())));
    }
  }
  const housing = F.style === ST.SLAB || F.style === ST.BRICK || F.style === ST.TOWER;
  // Water tank.
  if (housing && R() < 0.35) { const at = place(1.4, 1.4); if (at) { const [x, z] = W(at[0], at[1]); box(at[0], at[1], 1.3, 1.3, top, top + 0.45, new THREE.Color('#8d8b86')); cylinder(rb, x, z, 1.1 + R() * 0.3, top + 0.45, top + 2.3, new THREE.Color(pick(['#8fb2c8', '#dde1e0', '#9a9d9a', '#b9c7cf'], R()))); } }
  // Solar water heaters: rows of tilted collectors facing south with their tanks.
  if (housing && tall < 34 && R() < 0.55) {
    const n = 2 + Math.floor(R() * 6);
    const panel = new THREE.Color('#263444'), tank = new THREE.Color('#e3e5e3'), frameC = new THREE.Color('#aeb2b4');
    for (let k = 0; k < n; k++) {
      const at = place(1.0, 1.0, 8);
      if (!at) continue;
      const [x, z] = W(at[0], at[1]);
      // Collector: 2 m wide, 1.6 m long, tilted 40 deg, its low edge to the south (+Z).
      const t = 0.7, hw = 1.0, hl = 0.8;
      const dirZ = [0, Math.sin(t), -Math.cos(t)];   // up the slope, towards the north
      obox(rb, [x, top + 0.35 + Math.sin(t) * hl, z + Math.cos(t) * 0.05], [hw, 0, 0], [0, Math.cos(t) * 0.04, Math.sin(t) * 0.04], [0, dirZ[1] * hl, dirZ[2] * hl], panel);
      obox(rb, [x, top + 0.45 + Math.sin(t) * hl * 2, z - Math.cos(t) * hl], [hw + 0.1, 0, 0], [0, 0.22, 0], [0, 0, 0.22], tank);
      obox(rb, [x, top + 0.3, z], [hw, 0, 0], [0, 0.3, 0], [0, 0, 0.05], frameC);
    }
  }
  // AC condensers in a row.
  if (R() < 0.7) {
    const n = 2 + Math.floor(R() * (office ? 10 : 6));
    const ac = new THREE.Color('#d9dad5');
    for (let k = 0; k < n; k++) { const at = place(0.45, 0.35, 6); if (at) box(at[0], at[1], 0.45, 0.33, top, top + 0.7, ac); }
  }
  // Antenna mast.
  if (R() < 0.25) { const at = place(0.1, 0.1); if (at) box(at[0], at[1], 0.05, 0.05, top, top + 2.5 + R() * 3, new THREE.Color('#86898b')); }
}
