import * as THREE from 'three';
import type { RoadPiece } from './Data';
import { hash3, h01 } from './visual/hash';

/** Geometry accumulator: quads with metre UVs, per-quad normal, optional vertex colour. */
class Strip {
  pos: number[] = []; uv: number[] = []; nor: number[] = []; col: number[] = [];
  constructor(private coloured = false) {}
  quad(a: number[], b: number[], c: number[], d: number[], n: number[] = UP, colour?: THREE.Color): void {
    // a,b,c,d = [x, y, z, u, v] around the quad, counter-clockwise seen from the normal side.
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], p[1], p[2]); this.uv.push(p[3], p[4]); this.nor.push(n[0], n[1], n[2]);
      if (this.coloured) { const k = colour ?? WHITE; this.col.push(k.r, k.g, k.b); }
    }
  }
  tri(a: number[], b: number[], c: number[], colour: THREE.Color): void {
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.uv.push(0, 0); this.nor.push(0, 1, 0); if (this.coloured) this.col.push(colour.r, colour.g, colour.b); }
  }
  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.coloured) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const UP = [0, 1, 0];
const WHITE = new THREE.Color('#e4e3dd'), YELLOW = new THREE.Color('#d6a72c'), TACTILE = new THREE.Color('#c79f3a');
const MANHOLE = new THREE.Color('#3d3e3f'), RIM = new THREE.Color('#646563');
/** Vertex tints: minor roads greyer and more worn; curb stones and medians lighter than paving. */
const MAIN_ASPHALT = new THREE.Color(1, 1, 1), OLD_ASPHALT = new THREE.Color(1.1, 1.09, 1.06), PAVING = new THREE.Color(1, 1, 1), CURB = new THREE.Color(1.22, 1.22, 1.2);

export interface RoadMeshes { road: THREE.BufferGeometry | null; sidewalk: THREE.BufferGeometry | null; paint: THREE.BufferGeometry | null }

export const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'busway']);
const MINOR_CAR = new Set(['unclassified', 'residential', 'living_street', 'service']);
export const SIDEWALK: Record<string, number> = { trunk: 4.5, primary: 4.5, secondary: 4, tertiary: 3.5, unclassified: 2.5, residential: 2.5, busway: 3 };
/** Heights: paths under the roads (roads cover them), the carriageway the car drives on, paint, raised pavement and curb. */
export const Y = { path: 0.02, road: 0.03, mark: 0.034, walk: 0.06, curb: 0.075, median: 0.15 };

/** Polyline with arc length and per-point left normals (from the context points at the ends). */
export interface Line { P: [number, number][]; N: [number, number][]; S: number[]; len: number }
export function lineOf(r: RoadPiece): Line {
  const n = r.p.length / 2;
  const P: [number, number][] = [];
  for (let i = 0; i < n; i++) P.push([r.p[i * 2], r.p[i * 2 + 1]]);
  const prev = r.a ? [r.a[0], r.a[1]] : null, next = r.b ? [r.b[0], r.b[1]] : null;
  const N: [number, number][] = [], S: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? P[i - 1] : prev ?? P[i], b = i < n - 1 ? P[i + 1] : next ?? P[i];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    N.push([tz, -tx]);
    if (i > 0) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  }
  return { P, N, S, len: S[n - 1] };
}
/** Point, left normal and tangent at arc length s. */
export function at(l: Line, s: number): [number, number, number, number, number, number] {
  const { P, N, S } = l;
  let i = 0;
  while (i < S.length - 2 && S[i + 1] < s) i++;
  const L = S[i + 1] - S[i] || 1, t = Math.max(0, Math.min(1, (s - S[i]) / L));
  let nx = N[i][0] + (N[i + 1][0] - N[i][0]) * t, nz = N[i][1] + (N[i + 1][1] - N[i][1]) * t;
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t, nx, nz, -nz, nx];
}

/** Parts of [0, len] outside the blocked intervals. */
export function spans(len: number, blocked: [number, number][]): [number, number][] {
  const b = blocked.filter(([a, c]) => c > 0 && a < len).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let s = 0;
  for (const [a, c] of b) { if (a > s + 0.05) out.push([s, a]); s = Math.max(s, c); }
  if (len > s + 0.05) out.push([s, len]);
  return out;
}

/** Band between lateral offsets o0 and o1 (left positive) from s0 to s1, following the polyline. */
function band(st: Strip, l: Line, s0: number, s1: number, o0: number, o1: number, y: number, colour?: THREE.Color): void {
  const lo = Math.min(o0, o1), hi = Math.max(o0, o1);
  const cuts = [s0];
  for (const s of l.S) if (s > s0 + 0.01 && s < s1 - 0.01) cuts.push(s);
  cuts.push(s1);
  for (let k = 0; k < cuts.length - 1; k++) {
    const [ax, az, anx, anz] = at(l, cuts[k]), [bx, bz, bnx, bnz] = at(l, cuts[k + 1]);
    st.quad(
      [ax + anx * lo, y, az + anz * lo, cuts[k], lo], [bx + bnx * lo, y, bz + bnz * lo, cuts[k + 1], lo],
      [bx + bnx * hi, y, bz + bnz * hi, cuts[k + 1], hi], [ax + anx * hi, y, az + anz * hi, cuts[k], hi], UP, colour,
    );
  }
}

/** Vertical face at lateral offset o from y0 to y1, facing `facing` (+1 left / -1 right). */
function wall(st: Strip, l: Line, s0: number, s1: number, o: number, y0: number, y1: number, facing: number): void {
  const cuts = [s0];
  for (const s of l.S) if (s > s0 + 0.01 && s < s1 - 0.01) cuts.push(s);
  cuts.push(s1);
  for (let k = 0; k < cuts.length - 1; k++) {
    const [ax, az, anx, anz] = at(l, cuts[k]), [bx, bz, bnx, bnz] = at(l, cuts[k + 1]);
    const A = [ax + anx * o, az + anz * o], B = [bx + bnx * o, bz + bnz * o];
    const n = [anx * facing, 0, anz * facing];
    const q = [[A[0], y0, A[1], cuts[k], y0], [B[0], y0, B[1], cuts[k + 1], y0], [B[0], y1, B[1], cuts[k + 1], y1], [A[0], y1, A[1], cuts[k], y1]];
    // winding: counter-clockwise seen from the normal side
    if (facing > 0) st.quad(q[1], q[0], q[3], q[2], n, CURB); else st.quad(q[0], q[1], q[2], q[3], n, CURB);
  }
}

function dashes(st: Strip, l: Line, sp: [number, number][], o: number, w: number, dash: number, gap: number, y: number, colour: THREE.Color): void {
  const period = dash + gap;
  for (const [a, b] of sp) for (let s = Math.ceil(a / period) * period; s + dash <= b; s += period) band(st, l, s, s + dash, o - w / 2, o + w / 2, y, colour);
}

/** Lane arrow in the lane at offset o, pointing along +dir, centred at s. */
type ArrowKind = 'straight' | 'left' | 'right' | 'leftOnly';
function arrow(st: Strip, l: Line, s: number, o: number, dir: number, kind: ArrowKind): void {
  const [x, z, nx, nz, tx, tz] = at(l, s);
  // local (a along travel, c to the left of travel) -> world
  const T = [tx * dir, tz * dir], Nl = [nx * dir, nz * dir];
  const cx = x + nx * o, cz = z + nz * o;
  const W = (a: number, c: number): number[] => [cx + T[0] * a + Nl[0] * c, Y.mark + 0.001, cz + T[1] * a + Nl[1] * c, 0, 0];
  const seg = (a0: number, c0: number, a1: number, c1: number, head: boolean) => {
    const da = a1 - a0, dc = c1 - c0, L = Math.hypot(da, dc) || 1, pa = -dc / L * 0.08, pc = da / L * 0.08;
    const q = [W(a0 + pa, c0 + pc), W(a0 - pa, c0 - pc), W(a1 - pa, c1 - pc), W(a1 + pa, c1 + pc)];
    st.quad(q[1], q[2], q[3], q[0], UP, WHITE);
    if (head) {
      const ua = da / L, uc = dc / L;
      st.tri(W(a1 + uc * 0.32, c1 - ua * 0.32), W(a1 + ua * 1.1, c1 + uc * 1.1), W(a1 - uc * 0.32, c1 + ua * 0.32), WHITE);
    }
  };
  if (kind !== 'leftOnly') seg(-2.3, 0, 0.9, 0, true);
  if (kind === 'left') seg(-0.5, 0, 0.35, 0.85, true);
  if (kind === 'right') seg(-0.5, 0, 0.35, -0.85, true);
  if (kind === 'leftOnly') { seg(-2.3, 0, -0.2, 0, false); seg(-0.28, -0.05, 0.5, 0.85, true); }
}

function manhole(st: Strip, x: number, z: number, y: number): void {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p = (a: number, r: number) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 0];
    st.tri([x, y, z, 0, 0], p(a1, 0.3), p(a0, 0.3), MANHOLE);
    st.quad(p(a0, 0.3), p(a1, 0.3), p(a1, 0.37), p(a0, 0.37), UP, RIM);
  }
}

interface JMember { r: RoadPiece; hw: number; sw: number; dx: number; dz: number }
const jkey = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
export const isCar = (c: string) => MAIN.has(c) || MINOR_CAR.has(c);

/** Per car piece, its junctions: arc length, how far the crossing roads reach (carriageway plus pavement), their half width. */
export function junctions(pieces: RoadPiece[]): Map<RoadPiece, { s: number; cut: number; road: number }[]> {
  const jm = new Map<string, JMember[]>();
  for (const r of pieces) {
    if (!isCar(r.c)) continue;
    const n = r.p.length / 2;
    for (let i = 0; i < n; i++) {
      if (!r.j[i]) continue;
      const k = i < n - 1 ? i + 1 : i - 1;
      let dx = r.p[k * 2] - r.p[i * 2], dz = r.p[k * 2 + 1] - r.p[i * 2 + 1];
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const key = jkey(r.p[i * 2], r.p[i * 2 + 1]);
      let list = jm.get(key); if (!list) { list = []; jm.set(key, list); }
      list.push({ r, hw: r.w / 2, sw: SIDEWALK[r.c] ?? 0, dx, dz });
    }
  }
  const out = new Map<RoadPiece, { s: number; cut: number; road: number }[]>();
  for (const r of pieces) {
    if (!isCar(r.c)) continue;
    const n = r.p.length / 2;
    let S = 0;
    const list: { s: number; cut: number; road: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) S += Math.hypot(r.p[i * 2] - r.p[i * 2 - 2], r.p[i * 2 + 1] - r.p[i * 2 - 1]);
      if (!r.j[i]) continue;
      const k = i < n - 1 ? i + 1 : i - 1;
      let dx = r.p[k * 2] - r.p[i * 2], dz = r.p[k * 2 + 1] - r.p[i * 2 + 1];
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      let cut = 0, road = 0;
      for (const m of jm.get(jkey(r.p[i * 2], r.p[i * 2 + 1])) ?? []) {
        if (m.r === r || Math.abs(m.dx * dx + m.dz * dz) > 0.87) continue;
        cut = Math.max(cut, m.hw + m.sw); road = Math.max(road, m.hw);
      }
      if (!cut) { cut = 7; road = 4; }
      list.push({ s: S, cut, road });
    }
    out.set(r, list);
  }
  return out;
}

/** Arc lengths along the piece of the zebra crossings that lie on it. */
export function zebrasOn(l: Line, hw: number, crossings: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < crossings.length; i += 4) {
    const cx = crossings[i], cz = crossings[i + 1];
    for (let k = 0; k < l.P.length - 1; k++) {
      const [ax, az] = l.P[k], [bx, bz] = l.P[k + 1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((cx - ax) * vx + (cz - az) * vz) / L2));
      if (Math.hypot(ax + vx * t - cx, az + vz * t - cz) < hw + 1) { out.push(l.S[k] + Math.sqrt(L2) * t); break; }
    }
  }
  return out;
}

/**
 * Ribbons along each road piece: carriageway, raised pavements with a curb face (both sides of
 * two-way roads, the right of one-way ones; a raised median on the left of one-way main roads),
 * paths under the roads, and the Chinese paint scheme as one vertex-coloured mesh: double yellow
 * centre line, dashed white lanes, solid edges, stop lines and lane arrows on the approach to
 * junctions, zebra crossings, the yellow tactile strip on pavements, manhole covers. Pavements and
 * lines stop where the crossing road begins, so junction corners stay open.
 */
export function buildRoads(pieces: RoadPiece[], crossings: number[]): RoadMeshes {
  const road = new Strip(true), walk = new Strip(true), curb = walk, paint = new Strip(true);
  const J = junctions(pieces);
  for (const r of pieces) {
    const n = r.p.length / 2;
    if (n < 2) continue;
    const l = lineOf(r);
    const car = isCar(r.c);
    const hw = r.w / 2;
    if (!car) { band(walk, l, 0, l.len, -hw, hw, Y.path, PAVING); continue; }
    band(road, l, 0, l.len, -hw, hw, Y.road, MAIN.has(r.c) ? MAIN_ASPHALT : OLD_ASPHALT);
    const junctions = J.get(r) ?? [];
    const block = (extra: number, useRoad = false) => spans(l.len, junctions.map((j) => [j.s - (useRoad ? j.road : j.cut) - extra, j.s + (useRoad ? j.road : j.cut) + extra] as [number, number]));
    // Pavements with curbs, and the median of one-way main roads.
    const sw = SIDEWALK[r.c] ?? 0;
    const sides: number[] = sw ? (r.o ? [-1] : [1, -1]) : [];
    const walkSp = block(0);
    for (const side of sides) for (const [a, b] of walkSp) {
      wall(curb, l, a, b, side * hw, Y.road - 0.01, Y.curb, -side);
      band(curb, l, a, b, side * hw, side * (hw + 0.18), Y.curb, CURB);
      band(walk, l, a, b, side * (hw + 0.18), side * (hw + sw), Y.walk, PAVING);
      const t = side * (hw + 0.18 + sw * 0.42);
      if (sw >= 3.5) band(paint, l, a, b, t - 0.15, t + 0.15, Y.walk + 0.003, TACTILE);
    }
    if (r.o && MAIN.has(r.c) && r.w >= 7) for (const [a, b] of block(-2)) {
      wall(curb, l, a, b, hw, Y.road - 0.01, Y.median, -1);
      band(curb, l, a, b, hw, hw + 0.6, Y.median, CURB);
    }
    // Paint.
    const lanesTotal = r.l || Math.max(1, Math.round(r.w / 3.4));
    const marked = r.w >= 5.5 && !r.c.endsWith('_link') && r.c !== 'service' && r.c !== 'living_street';
    const lineSp = block(1.5, true);
    const WL = 0.15;
    const zebra = zebrasOn(l, hw, crossings);
    if (marked) {
      if (r.o) {
        const lanes = Math.max(1, lanesTotal), lw = r.w / lanes;
        for (let k = 1; k < lanes; k++) dashes(paint, l, lineSp, -hw + k * lw, WL, 4, 6, Y.mark, WHITE);
        for (const [a, b] of lineSp) { band(paint, l, a, b, hw - 0.25 - WL / 2, hw - 0.25 + WL / 2, Y.mark, YELLOW); band(paint, l, a, b, -hw + 0.25 - WL / 2, -hw + 0.25 + WL / 2, Y.mark, WHITE); }
      } else {
        const per = Math.max(1, Math.round(lanesTotal / 2)), lw = hw / per;
        for (const [a, b] of lineSp) { band(paint, l, a, b, 0.06, 0.19, Y.mark, YELLOW); band(paint, l, a, b, -0.19, -0.06, Y.mark, YELLOW); }
        for (let k = 1; k < per; k++) { dashes(paint, l, lineSp, k * lw, WL, 4, 6, Y.mark, WHITE); dashes(paint, l, lineSp, -k * lw, WL, 4, 6, Y.mark, WHITE); }
        if (r.w >= 9) for (const [a, b] of lineSp) { band(paint, l, a, b, hw - 0.3 - WL / 2, hw - 0.3 + WL / 2, Y.mark, WHITE); band(paint, l, a, b, -hw + 0.3 - WL / 2, -hw + 0.3 + WL / 2, Y.mark, WHITE); }
      }
      // Stop lines and lane arrows on the approach to each junction (right-hand traffic: lanes
      // right of the centre line travel along the piece, lanes left of it against it).
      if (MAIN.has(r.c) && r.w >= 7) for (const j of junctions) {
        for (const dir of r.o ? [1] : [1, -1]) {
          const zs = zebra.filter((s) => (dir > 0 ? s < j.s && s > j.s - j.road - 16 : s > j.s && s < j.s + j.road + 16));
          const back = zs.length ? Math.max(...zs.map((s) => Math.abs(j.s - s))) + 3 : j.road + 2.5;
          const sStop = j.s - dir * back;
          if (sStop < 1 || sStop > l.len - 1) continue;
          const o0 = r.o ? -hw : dir > 0 ? -hw : 0, o1 = r.o ? hw : dir > 0 ? 0 : hw;
          band(paint, l, sStop - 0.2, sStop + 0.2, o0 + 0.3, o1 - (r.o ? 0.3 : 0.2), Y.mark, WHITE);
          const lanes = r.o ? Math.max(1, lanesTotal) : Math.max(1, Math.round(lanesTotal / 2));
          const lw = (o1 - o0) / lanes;
          const sA = sStop - dir * 9;
          if (sA < 3 || sA > l.len - 3) continue;
          for (let k = 0; k < lanes; k++) {
            // k = 0 is the lane next to the centre line (the left-turn lane)
            const o = dir > 0 ? (r.o ? o1 - (k + 0.5) * lw : -(k + 0.5) * lw) : (k + 0.5) * lw;
            const kind: ArrowKind = lanes === 1 ? 'straight' : k === 0 ? (lanes >= 3 ? 'leftOnly' : 'left') : k === lanes - 1 ? 'right' : 'straight';
            arrow(paint, l, sA, o, dir, kind);
          }
        }
      }
    }
    // Manhole covers: in the lanes and on the pavements, every ~50 m.
    const seed = Math.round(Math.abs(r.p[0] * 13 + r.p[1] * 7));
    for (let s = 20 + h01(hash3(seed, 1, 2)) * 30, k = 0; s < l.len - 5; s += 35 + h01(hash3(seed, k++, 3)) * 40) {
      const [x, z, nx, nz] = at(l, s);
      const lat = (h01(hash3(seed, k, 9)) - 0.5) * (r.w - 2);
      manhole(paint, x + nx * lat, z + nz * lat, Y.mark + 0.002);
      if (sw && h01(hash3(seed, k, 11)) < 0.5) { const side = sides[k % sides.length] ?? 1, o = side * (hw + sw * 0.75); manhole(paint, x + nx * o, z + nz * o, Y.walk + 0.004); }
    }
  }
  // Zebra crossings: stripes parallel to the road, laid across its width.
  for (let i = 0; i < crossings.length; i += 4) {
    const x = crossings[i], z = crossings[i + 1], ang = crossings[i + 2], w = crossings[i + 3];
    const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
    for (let v = -w / 2 + 0.45; v < w / 2 - 0.3; v += 1) {
      const p = (du: number, dv: number): number[] => [x + ux * du + vx * dv, Y.mark + 0.002, z + uz * du + vz * dv, 0, 0];
      paint.quad(p(-2, v + 0.5), p(2, v + 0.5), p(2, v), p(-2, v), UP, WHITE);
    }
  }
  return { road: road.build(), sidewalk: walk.build(), paint: paint.build() };
}
