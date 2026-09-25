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

export interface RoadMeshes { road: THREE.BufferGeometry | null; sidewalk: THREE.BufferGeometry | null; paint: THREE.BufferGeometry | null; bridge: THREE.BufferGeometry | null }

export const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'busway']);
const MINOR_CAR = new Set(['unclassified', 'residential', 'living_street', 'service']);
export const SIDEWALK: Record<string, number> = { trunk: 4.5, primary: 4.5, secondary: 4, tertiary: 3.5, unclassified: 2.5, residential: 2.5, busway: 3 };
/** Heights: paths under the roads (roads cover them), the carriageway the car drives on, paint, raised pavement and curb. */
export const Y = { path: 0.02, road: 0.03, mark: 0.034, walk: 0.06, curb: 0.075, median: 0.15 };

/** Polyline with arc length, per-point left normals (from the context points at the ends) and heights above the ground (all 0 on the flat). */
export interface Line { P: [number, number][]; N: [number, number][]; S: number[]; len: number; H: number[] | null }
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
  return { P, N, S, len: S[n - 1], H: r.h && r.h.length === n ? r.h : null };
}
/** Height of the carriageway above the ground at arc length s (a deck or a ramp; 0 on the flat). */
export function hAt(l: Line, s: number): number {
  const H = l.H;
  if (!H) return 0;
  const S = l.S;
  let i = 0;
  while (i < S.length - 2 && S[i + 1] < s) i++;
  const L = S[i + 1] - S[i] || 1, t = Math.max(0, Math.min(1, (s - S[i]) / L));
  return H[i] + (H[i + 1] - H[i]) * t;
}
/** The stretches of the piece higher than `thr` above the ground, ends interpolated to where it crosses `thr`. */
export function lifted(l: Line, thr: number): [number, number][] {
  const H = l.H;
  if (!H) return [];
  const out: [number, number][] = [];
  let start = H[0] > thr ? 0 : -1;
  for (let i = 1; i < H.length; i++) {
    const a = H[i - 1] > thr, b = H[i] > thr;
    if (a === b) continue;
    const t = (thr - H[i - 1]) / (H[i] - H[i - 1]), s = l.S[i - 1] + (l.S[i] - l.S[i - 1]) * t;
    if (b) start = s; else { out.push([start, s]); start = -1; }
  }
  if (start >= 0) out.push([start, l.len]);
  return out;
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

/** Arc length along the line nearest (x, z) and the lateral offset there (left positive). */
export function project(l: Line, x: number, z: number): { s: number; lat: number; d: number } {
  let best = { s: 0, lat: Infinity, d: Infinity };
  for (let k = 0; k < l.P.length - 1; k++) {
    const [ax, az] = l.P[k], [bx, bz] = l.P[k + 1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
    const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const L = Math.sqrt(L2), nx = vz / L, nz = -vx / L;   // left normal
      best = { s: l.S[k] + L * t, lat: (x - px) * nx + (z - pz) * nz, d };
    }
  }
  return best;
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
    const ya = y + hAt(l, cuts[k]), yb = y + hAt(l, cuts[k + 1]);
    st.quad(
      [ax + anx * lo, ya, az + anz * lo, cuts[k], lo], [bx + bnx * lo, yb, bz + bnz * lo, cuts[k + 1], lo],
      [bx + bnx * hi, yb, bz + bnz * hi, cuts[k + 1], hi], [ax + anx * hi, ya, az + anz * hi, cuts[k], hi], UP, colour,
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
    const ha = hAt(l, cuts[k]), hb = hAt(l, cuts[k + 1]);
    const q = [[A[0], y0 + ha, A[1], cuts[k], y0], [B[0], y0 + hb, B[1], cuts[k + 1], y0], [B[0], y1 + hb, B[1], cuts[k + 1], y1], [A[0], y1 + ha, A[1], cuts[k], y1]];
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
  const cx = x + nx * o, cz = z + nz * o, lift = hAt(l, s);
  const W = (a: number, c: number): number[] => [cx + T[0] * a + Nl[0] * c, Y.mark + 0.001 + lift, cz + T[1] * a + Nl[1] * c, 0, 0];
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


/** Concrete of the decks, parapets and piers (vertex tint on the bridge material). */
const CONCRETE = new THREE.Color(1, 1, 1), SOFFIT = new THREE.Color(0.72, 0.72, 0.7), PIER = new THREE.Color(0.9, 0.89, 0.86);
/** Bridge dimensions, m: parapet width and height, deck depth, the height under which a ramp is a filled embankment, pier size and spacing. */
export const DECK = { parapet: 0.4, rail: 0.9, depth: 1.1, fill: 3.2, pier: 1.3, pierGap: 26 };
/** Headroom kept clear over every carriageway, m: nothing of a bridge but a deck high enough may stand in it. */
const HEADROOM = 4.3;
/** Parapet height over a deck `h` m up: rising out of the ramp from 0.45 m to full height at 1.45. */
const railOf = (h: number) => Math.max(0, Math.min(DECK.rail, (h - 0.45) * 0.9));
/** Metres between the lamps along a deck (as on a trunk road below). */
const DECK_LAMP = 32;
/** Collider triangles as a flat [x, y, z, ...] soup. */
type Soup = number[];
const tri3 = (col: Soup, a: number[], b: number[], c: number[]) => { col.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
const quad3 = (col: Soup, a: number[], b: number[], c: number[], d: number[]) => { tri3(col, a, b, c); tri3(col, a, c, d); };

/**
 * The structure under a lifted piece (`r.h`): a parapet each side (inside face, top, outside face),
 * the deck's edge and soffit where it stands on piers, the outside faces carried down to the ground
 * where the ramp is still low enough to be a filled embankment (under DECK.fill), a wall across
 * where the one turns into the other, and piers every DECK.pierGap m on the high parts - one down
 * the middle, or two on a wide deck - skipping any that would land on a road below. Colliders go
 * into `col`: the deck top (from where it leaves the ground, so a car drives up without a step),
 * the parapets, the embankment walls and the piers.
 */
function bridgeOf(st: Strip, col: Soup, l: Line, r: RoadPiece, below: (x: number, z: number, h: number, gap: number, maxGap?: number) => boolean, inJunction: (x: number, z: number, h: number) => boolean, joins: (x: number, z: number, h: number, step?: boolean, margin?: number) => boolean, lamps: number[], occupied: (x: number, z: number, y0: number, y1: number) => boolean): void {
  const hw = r.w / 2, oi = hw + 0.05, oo = hw + 0.05 + DECK.parapet;
  const P = (s: number, o: number, y: number): number[] => { const [x, z, nx, nz] = at(l, s); return [x + nx * o, y, z + nz * o]; };
  const V = (p: number[], u: number, v: number) => [p[0], p[1], p[2], u, v];
  /** A vertex with its u along the road and v its height: metre UVs on the upright faces. */
  const Y3 = (p: number[], u: number) => [p[0], p[1], p[2], u, p[1]];
  // Every 4 m, so a parapet can open exactly where a slip road leaves or joins.
  const cutsOf = (a: number, b: number) => {
    const c = [a];
    for (const x of l.S) if (x > a + 0.01 && x < b - 0.01) c.push(x);
    c.push(b);
    const out = [a];
    for (let i = 1; i < c.length; i++) { const n = Math.max(1, Math.ceil((c[i] - c[i - 1]) / 4)); for (let k = 1; k <= n; k++) out.push(c[i - 1] + (c[i] - c[i - 1]) * k / n); }
    return out;
  };
  for (const [a, b] of lifted(l, 0.02)) {
    const cuts = cutsOf(a, b);
    for (let k = 0; k < cuts.length - 1; k++) {
      const s0 = cuts[k], s1 = cuts[k + 1], h0 = hAt(l, s0) + Y.road, h1 = hAt(l, s1) + Y.road;
      const [, , n0x, n0z] = at(l, s0);
      // The deck top the wheels run on, parapet to parapet. (Leaving strips out over a road close
      // underneath was tried twice: both times it opened holes the car fell through.)
      quad3(col, P(s0, -oo, h0), P(s1, -oo, h1), P(s1, oo, h1), P(s0, oo, h0));
      if (Math.max(h0, h1) < 0.2) continue;
      // Low enough to be a filled embankment - unless a lower road runs under this edge (OSM's widths
      // overlap a ramp with the road beside it): then it is open underneath, a deck on the lower road.
      const sm = (s0 + s1) / 2, hm = (h0 + h1) / 2;
      const open = (side: number) => { const q = P(sm, side * oo, 0); return below(q[0], q[2], hm, 1.5); };
      const openL = open(-1), openR = open(1);
      for (const side of [-1, 1]) {
        const bot = (h: number) => (h > DECK.fill || (side < 0 ? openL : openR) ? Math.max(0.2, h - DECK.depth) : 0);
        const ti = side * oi, to = side * oo;
        // No parapet across a slip road leaving or joining here: its carriageway covers this edge.
        // Tested just beyond the parapet's outer face: only a carriageway whose surface reaches past it
        // makes it a merge. One within a metre with a gap between was taken for one, and the gap between
        // a road's two carriageways on 东三环 or 国贸桥 was left open to fall through.
        const mid = P((s0 + s1) / 2, side * (oo + 0.3), 0);
        if (joins(mid[0], mid[2], (h0 + h1) / 2)) continue;
        // Nor one standing on another carriageway at this level: the outer parapet of a slip road
        // still inside the main line it is leaving stood in the main line's lane, beside its own.
        const foot = P((s0 + s1) / 2, side * (oi + DECK.parapet / 2), 0);
        if (joins(foot[0], foot[2], (h0 + h1) / 2, false, -0.15)) continue;
        // The parapet grows out of the deck as the ramp leaves the ground (none under 0.45 m, full height
        // from 1.45): at full height from the first centimetre its end stood in the lane of the road
        // the ramp comes off, a concrete block across it. And none over another carriageway only a step
        // lower, which it would stand in.
        const g0 = railOf(h0), g1 = railOf(h1), rail = (g0 > 0 || g1 > 0) && !joins(mid[0], mid[2], (h0 + h1) / 2, true);
        const r0 = h0 + (rail ? g0 : 0), r1 = h1 + (rail ? g1 : 0);
        const n = [n0x * side, 0, n0z * side], inN = [-n[0], 0, -n[2]];
        // Inside face (towards the road), the top, the outside face down to the deck edge or the ground.
        const i0 = P(s0, ti, h0), i1 = P(s1, ti, h1), i2 = P(s1, ti, r1), i3 = P(s0, ti, r0);
        const o0 = P(s0, to, bot(h0)), o1 = P(s1, to, bot(h1)), o2 = P(s1, to, r1), o3 = P(s0, to, r0);
        // The outside face: a collider only where it is more than a kerb (a car climbs 0.45 m).
        const face = !(side < 0 ? openL : openR) && Math.max(r0, r1) > 0.5;
        if (side > 0) {
          if (rail) { st.quad(Y3(i1, s1), Y3(i0, s0), Y3(i3, s0), Y3(i2, s1), inN, CONCRETE); quad3(col, i1, i0, i3, i2); }
          st.quad(Y3(o0, s0), Y3(o1, s1), Y3(o2, s1), Y3(o3, s0), n, CONCRETE);
          if (face) quad3(col, o0, o1, o2, o3);
        } else {
          if (rail) { st.quad(Y3(i0, s0), Y3(i1, s1), Y3(i2, s1), Y3(i3, s0), inN, CONCRETE); quad3(col, i0, i1, i2, i3); }
          st.quad(Y3(o1, s1), Y3(o0, s0), Y3(o3, s0), Y3(o2, s1), n, CONCRETE);
          if (face) quad3(col, o1, o0, o3, o2);
        }
        const t0 = P(s0, ti, r0), t1 = P(s1, ti, r1), t2 = P(s1, to, r1), t3 = P(s0, to, r0);
        if (side > 0) st.quad(V(t0, s0, oi), V(t1, s1, oi), V(t2, s1, oo), V(t3, s0, oo), UP, CONCRETE);
        else st.quad(V(t1, s1, -oi), V(t0, s0, -oi), V(t3, s0, -oo), V(t2, s1, -oo), UP, CONCRETE);
      }
      // The soffit where the deck stands on piers; a wall across where the embankment ends.
      const hi0 = h0 > DECK.fill || openL || openR, hi1 = h1 > DECK.fill || openL || openR;
      if (hi0 && hi1) {
        const y0 = h0 - DECK.depth, y1 = h1 - DECK.depth;
        st.quad(V(P(s0, oo, y0), s0, oo), V(P(s1, oo, y1), s1, oo), V(P(s1, -oo, y1), s1, -oo), V(P(s0, -oo, y0), s0, -oo), [0, -1, 0], SOFFIT);
      } else if (hi0 !== hi1 && ![-1, -0.5, 0, 0.5, 1].some((u) => { const q = P(hi0 ? s0 : s1, u * oo, 0); return occupied(q[0], q[2], 0, (hi0 ? h0 : h1) - DECK.depth); })) {
        // (Not where another carriageway runs through it: the end of 国贸桥's embankment stood across the
        // slip road beside it as a block of concrete.)
        const sc = hi0 ? s0 : s1, h = hi0 ? h0 : h1, f = hi0 ? 1 : -1;
        const [, , , , tx, tz] = at(l, sc);
        const q = [P(sc, -oo, 0), P(sc, oo, 0), P(sc, oo, h - DECK.depth), P(sc, -oo, h - DECK.depth)];
        const nrm = [tx * f, 0, tz * f];
        // Facing the open side (under the deck), which is towards the high end.
        if (f > 0) st.quad(V(q[1], oo, q[1][1]), V(q[0], -oo, q[0][1]), V(q[3], -oo, q[3][1]), V(q[2], oo, q[2][1]), nrm, SOFFIT);
        else st.quad(V(q[0], -oo, q[0][1]), V(q[1], oo, q[1][1]), V(q[2], oo, q[2][1]), V(q[3], -oo, q[3][1]), nrm, SOFFIT);
        quad3(col, q[0], q[1], q[2], q[3]);
      }
    }
    // Street lamps on the parapet every DECK_LAMP m (the ground's are kept off the decks), arm over
    // the road: [x, y, z, yaw] with the base on the parapet's top. Right of travel on a one-way deck,
    // alternating on a two-way one.
    let lampSide = -1;
    for (let sl = a + DECK_LAMP / 2; sl < b - 2; sl += DECK_LAMP) {
      const h = hAt(l, sl) + Y.road;
      if (h < 2.5) continue;
      const [x, z, nx, nz] = at(l, sl), side = lampSide, o = side * (oi + DECK.parapet / 2);
      if (!r.o) lampSide = -lampSide;
      const lx = x + nx * o, lz = z + nz * o;
      if (joins(x + nx * side * (oo + 0.3), z + nz * side * (oo + 0.3), h)) continue;
      lamps.push(lx, h + DECK.rail, lz, Math.atan2(-nx * side, -nz * side));
    }
    // Piers on the high stretches, not on a road below.
    const w = oo;
    for (let sp = a + DECK.pierGap / 2; sp < b - 4; sp += DECK.pierGap) {
      const h = hAt(l, sp) + Y.road;
      if (h < DECK.fill + 0.4) continue;
      const [x, z, nx, nz, tx, tz] = at(l, sp);
      const offs = w > 8 ? [-w * 0.55, w * 0.55] : [0];
      let any = false;
      for (const o of offs) {
        const px = x + nx * o, pz = z + nz * o;
        if (below(px, pz, h, 0.5) || inJunction(px, pz, h)) continue;
        any = true;
        box(st, col, px, pz, tx, tz, DECK.pier / 2, DECK.pier / 2, 0, h - DECK.depth, PIER);
      }
      // A cross-head under the deck where at least one pier stands, unless it would reach into the space
      // over another carriageway beside or under the deck (it stuck out across a ramp at head height).
      let clear = any;
      for (let o = -(w - 0.3); clear && o <= w - 0.3 + 1e-6; o += (w - 0.3) / 4) clear = !occupied(x + nx * o, z + nz * o, h - DECK.depth - 0.9, h - DECK.depth);
      if (clear) box(st, null, x, z, tx, tz, 0.7, w - 0.3, h - DECK.depth - 0.9, h - DECK.depth, PIER);
    }
  }
}

/** An upright box centred on (x, z), `ha` half along the road (tx, tz), `hc` half across, from y0 to y1; sides into `col` when given. */
function box(st: Strip, col: Soup | null, x: number, z: number, tx: number, tz: number, ha: number, hc: number, y0: number, y1: number, c: THREE.Color): void {
  const nx = -tz, nz = tx;
  const p = (a: number, b: number, y: number): number[] => [x + tx * a + nx * b, y, z + tz * a + nz * b];
  const V = (q: number[], u: number, v: number) => [q[0], q[1], q[2], u, v];
  const faces: [number, number, number, number, number[]][] = [[ha, -hc, ha, hc, [tx, 0, tz]], [-ha, hc, -ha, -hc, [-tx, 0, -tz]], [ha, hc, -ha, hc, [nx, 0, nz]], [-ha, -hc, ha, -hc, [-nx, 0, -nz]]];
  for (const [a0, b0, a1, b1, n] of faces) {
    const q0 = p(a0, b0, y0), q1 = p(a1, b1, y0), q2 = p(a1, b1, y1), q3 = p(a0, b0, y1), w = Math.hypot(a1 - a0, b1 - b0);
    st.quad(V(q1, 0, y0), V(q0, w, y0), V(q3, w, y1), V(q2, 0, y1), n, c);
    if (col) quad3(col, q1, q0, q3, q2);
  }
  st.quad(V(p(-ha, -hc, y0), -ha, -hc), V(p(-ha, hc, y0), -ha, hc), V(p(ha, hc, y0), ha, hc), V(p(ha, -hc, y0), ha, -hc), [0, -1, 0], c);
}

/**
 * Ribbons along each road piece: carriageway, raised pavements with a curb face (both sides of
 * two-way roads, the right of one-way ones; a raised median on the left of one-way main roads),
 * paths under the roads, and the Chinese paint scheme as one vertex-coloured mesh: double yellow
 * centre line, dashed white lanes, solid edges, stop lines and lane arrows on the approach to
 * junctions, zebra crossings, the yellow tactile strip on pavements, manhole covers. Pavements and
 * lines stop where the crossing road begins, so junction corners stay open.
 */
export function buildRoads(pieces: RoadPiece[], crossings: number[], col: number[] = [], deckLamps: number[] = [], ctx: RoadPiece[] = []): RoadMeshes {
  const road = new Strip(true), walk = new Strip(true), curb = walk, paint = new Strip(true), bridge = new Strip(true);
  const J = junctions(pieces);
  // Every carriageway with its line, for the piers: none may stand on a road below its deck.
  // Each extended by its neighbour points where the road runs on into the next tile: a tile only
  // knows its own pieces, and the stretch of 国贸桥 across the tile edge was missing, so the slip
  // road beside it built its parapet straight across the main carriageway - a wall at x 4864.
  const carLines: { r: RoadPiece; l: Line }[] = [];
  for (const r of [...pieces, ...ctx]) if (isCar(r.c) && r.p.length >= 4) {
    const h = r.h, a = r.a, b = r.b;
    const ext: RoadPiece = { ...r, a: 0, b: 0,
      p: [...(a || []), ...r.p, ...(b || [])],
      j: [...(a ? [0] : []), ...r.j, ...(b ? [0] : [])],
      h: h ? [...(a ? [h[0]] : []), ...h, ...(b ? [h[h.length - 1]] : [])] : undefined };
    carLines.push({ r, l: lineOf(ext) });
  }
  /** Where the roads' pieces end - junction mouths, mostly - and their heights: no pier stands in a junction under a deck, where cars cut across between the roads (大望桥 over 西大望路). */
  const ends: [number, number, number][] = [];
  for (const { l } of carLines) { const n = l.P.length - 1; ends.push([l.P[0][0], l.P[0][1], hAt(l, 0)], [l.P[n][0], l.P[n][1], hAt(l, l.len)]); }
  /** A carriageway at (x, z) lower than h by more than `gap` (and less than `maxGap`): under a deck's edge, where a pier would land, or overlapping a deck too close under it. */
  const below = (x: number, z: number, h: number, gap: number, maxGap = Infinity) => carLines.some(({ r, l }) => {
    const p = project(l, x, z);
    if (p.d >= r.w / 2 + 1.2) return false;
    const d = h - hAt(l, Math.max(0, Math.min(l.len, p.s))) - Y.road;
    return d > gap && d < maxGap;
  });
  /** Whether the space over any carriageway at (x, z) - its surface up to a lorry's height - reaches into [y0, y1]: where no pier, cross-head or wall may stand. */
  const occupied = (x: number, z: number, y0: number, y1: number) => carLines.some(({ r, l }) => {
    const p = project(l, x, z);
    if (p.d >= r.w / 2 + 0.3) return false;
    const y = hAt(l, Math.max(0, Math.min(l.len, p.s))) + Y.road;
    return y < y1 - 0.05 && y + HEADROOM > y0;
  });
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
    // Up on an interchange: parapets and the structure instead of pavements.
    const up = lifted(l, 0.15).map(([a, b]) => [a - 3, b + 3] as [number, number]);
    if (l.H) bridgeOf(bridge, col, l, r, below, (x, z, h) => ends.some(([ex, ez, eh]) => eh < h - 2.5 && Math.hypot(ex - x, ez - z) < 24), (x, z, h, step, margin = 0.05) => carLines.some((o) => {
      if (o.r === r) return false;
      const p = project(o.l, x, z);
      // Real distance, not the lateral offset: at a node where a dozen short pieces of 建国门桥 meet,
      // the junction lies off the ends of them all, and an in-span test left their parapets standing.
      if (p.d >= o.r.w / 2 + margin) return false;
      // One level (a merge), or with `step` a carriageway 0.3-1.5 m lower: a drop a car can take, where a
      // parapet would stand in its lanes. A carriageway lower still beside the edge is a real drop.
      const dh = h - hAt(o.l, p.s) - Y.road;
      return step ? dh > 0.3 && dh < 1.5 : Math.abs(dh) < 0.5;
    }), deckLamps, occupied);
    // Pavements with curbs, and the median of one-way main roads.
    const sw = SIDEWALK[r.c] ?? 0;
    const sides: number[] = sw ? (r.o ? [-1] : [1, -1]) : [];
    const walkSp = up.length ? spans(l.len, [...junctions.map((j) => [j.s - j.cut, j.s + j.cut] as [number, number]), ...up]) : block(0);
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
      if (hAt(l, s) > 0.05) continue;
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
  return { road: road.build(), sidewalk: walk.build(), paint: paint.build(), bridge: bridge.build() };
}
