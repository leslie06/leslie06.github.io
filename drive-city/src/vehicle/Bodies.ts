import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp, curve, F_CUTOUT, LAMP, latheX, Mesher, smooth, surf, TONE_FIXED, TONE_LOWER, TONE_UPPER, type Surf } from './Mesher';
import { Shell, type CapFace, type ShellDef, type WallFace, type WallRow } from './Shell';
import { uv } from './Atlas';
import type { VehicleSpec } from './Spec';

/**
 * Body shapes. Each type is a Shell definition (see Shell.ts) plus the parts that are not panels:
 * mirrors, handles, plates, wipers, roof sign / light bar, underfloor, wheel-well liners, and the
 * wheels. Everything comes out as Mesher buckets (paint, trim, lamp, taxi) that CarModel turns into
 * a full-detail car and CarKit into instanced traffic. Node-safe: no DOM here.
 */

export type BodyType = 'sedan' | 'hatch' | 'suv' | 'mpv' | 'bus' | 'truck';
export const BODY_TYPES: readonly BodyType[] = ['sedan', 'hatch', 'suv', 'mpv', 'bus', 'truck'];
export type Detail = 'high' | 'low';

/** What the livery adds to the geometry. */
export interface BodyOptions {
  roofSign: boolean;
  beacons: boolean;
  doorText: boolean;
  /** Door lettering on the upper (light) band instead of the lower one (police). */
  doorTextHigh: boolean;
}

export interface BodyParts {
  type: BodyType;
  /** paint / trim / lamp / taxi buckets, body frame. */
  body: Mesher;
  /** One wheel at the origin, axle along X, rim face towards +X. `rear` when the rear axle differs (duals). */
  wheel: Mesher;
  wheelRear: Mesher | null;
  /** Dual rear wheels: the inner tyre sits this far inboard of the outer one (0: single). */
  dual: number;
  /** Brake callipers (steer with the hub, do not spin), full detail only: one at the origin like the wheel. */
  calliper: Mesher | null;
  /** Headlamp centres (body frame), for the night beams. */
  headlamps: THREE.Vector3[];
  /** Overall extents of the painted body (for cameras, bounds). */
  size: { length: number; width: number; height: number };
}

// ---- palette ---------------------------------------------------------------------------------------

function palette(style: { grille: 'grille' | 'grilleBars' | 'grilleSlim' | 'grilleWave'; head: 'head' | 'head2'; tail: 'tail' | 'tail2' } = { grille: 'grille', head: 'head', tail: 'tail' }) {
  return {
    paintU: surf('paint', '#ffffff', 0.34, 0, TONE_UPPER),
    paintL: surf('paint', '#ffffff', 0.34, 0, TONE_LOWER),
    glass: surf('paint', '#0a0f14', 0.03, 0, TONE_FIXED),
    glassDark: surf('paint', '#07090b', 0.05, 0, TONE_FIXED),
    black: surf('trim', '#111213', 0.5, 0),
    gloss: surf('trim', '#0a0b0c', 0.14, 0.2),
    seam: surf('trim', '#050505', 0.85, 0),
    chrome: surf('trim', '#dcdfe2', 0.1, 1),
    satin: surf('trim', '#a9adb2', 0.32, 0.9),
    rubber: surf('trim', '#0d0d0e', 0.85, 0),
    under: surf('trim', '#0a0a0b', 0.95, 0),
    liner: surf('trim', '#070708', 1, 0),
    cladding: surf('trim', '#1b1c1e', 0.72, 0),
    grille: surf('trim', '#ffffff', 0.4, 0.35, 0, { rect: uv(style.grille) }),
    intake: surf('trim', '#ffffff', 0.55, 0.2, 0, { rect: uv('intake') }),
    mesh: surf('trim', '#ffffff', 0.6, 0.2, 0, { rect: uv('mesh') }),
    vent: surf('trim', '#ffffff', 0.5, 0.1, 0, { rect: uv('vent') }),
    plateF: surf('trim', '#ffffff', 0.35, 0.1, 0, { rect: uv('plateF') }),
    plateR: surf('trim', '#ffffff', 0.35, 0.1, 0, { rect: uv('plateR') }),
    rearDoor: surf('trim', '#ffffff', 0.4, 0.3, 0, { rect: uv('rearDoor') }),
    head: surf('lamp', '#ffffff', 0.08, 0.6, LAMP.head, { rect: uv(style.head) }),
    busHead: surf('lamp', '#ffffff', 0.08, 0.6, LAMP.head, { rect: uv('busHead') }),
    tail: surf('lamp', '#ffffff', 0.12, 0.1, LAMP.tail, { rect: uv(style.tail) }),
    reverse: surf('lamp', '#ffffff', 0.1, 0.2, LAMP.reverse, { rect: uv('reverse') }),
    amber: surf('lamp', '#ffffff', 0.1, 0.2, LAMP.amber, { rect: uv('amber') }),
    brake: surf('lamp', '#ffffff', 0.15, 0, LAMP.brake, { rect: uv('tail', 20) }),
    beaconR: surf('lamp', '#ffffff', 0.15, 0, LAMP.beaconR, { rect: [uv('beacon')[0], uv('beacon')[1], (uv('beacon')[0] + uv('beacon')[2]) / 2, uv('beacon')[3]] }),
    beaconB: surf('lamp', '#ffffff', 0.15, 0, LAMP.beaconB, { rect: [(uv('beacon')[0] + uv('beacon')[2]) / 2, uv('beacon')[1], uv('beacon')[2], uv('beacon')[3]] }),
    dest: surf('lamp', '#ffffff', 0.2, 0, LAMP.sign, { rect: uv('dest') }),
    signF: surf('taxi', '#ffffff', 0.3, 0, LAMP.sign, { rect: [uv('sign')[0], uv('sign')[1], (uv('sign')[0] + uv('sign')[2]) / 2, uv('sign')[3]] }),
    signB: surf('taxi', '#ffffff', 0.3, 0, LAMP.sign, { rect: [(uv('sign')[0] + uv('sign')[2]) / 2, uv('sign')[1], uv('sign')[2], uv('sign')[3]] }),
    signBody: surf('taxi', '#f4f1e6', 0.35, 0, LAMP.none),
    signFoot: surf('taxi', '#141516', 0.5, 0, LAMP.none),
    door: surf('taxi', '#ffffff', 0.4, 0, LAMP.none, { rect: uv('door'), flags: F_CUTOUT }),
    sideText: surf('lamp', '#ffffff', 0.4, 0, LAMP.none, { rect: uv('side'), flags: F_CUTOUT }),
    badge: surf('trim', '#ffffff', 0.15, 0.9, 0, { rect: uv('badge') }),
  };
}
type Pal = ReturnType<typeof palette>;

/** Segments of rounded detail parts (mirrors, handles, pods) for the build in progress: 2 high, 1 low. */
let SEG = 2;

// ---- shared helpers --------------------------------------------------------------------------------

type Pts = [number, number][];
const between = (v: number, a: number, b: number) => v >= Math.min(a, b) && v <= Math.max(a, b);

/** `n` edge x positions (descending to 0), `xMax` first, containing every `req` value. */
function edgeXs(req: number[], n: number, xMax: number): number[] {
  const set = [xMax, ...req.filter((x) => x > 0.005 && x < xMax - 0.005), 0];
  const out = [...new Set(set.map((x) => +x.toFixed(4)))].sort((a, b) => b - a);
  while (out.length < n) {
    // Split the widest gap.
    let gi = 0, gw = -1;
    for (let i = 0; i < out.length - 1; i++) if (out[i] - out[i + 1] > gw) { gw = out[i] - out[i + 1]; gi = i; }
    out.splice(gi + 1, 0, (out[gi] + out[gi + 1]) / 2);
  }
  while (out.length > n) {
    // Drop the non-required point with the smallest gap.
    let di = -1, dw = Infinity;
    for (let i = 1; i < out.length - 1; i++) if (!req.some((r) => Math.abs(r - out[i]) < 1e-4) && out[i - 1] - out[i + 1] < dw) { dw = out[i - 1] - out[i + 1]; di = i; }
    if (di < 0) break;
    out.splice(di, 1);
  }
  return out;
}

function box(m: Mesher, s: Surf, w: number, h: number, d: number, at: THREE.Vector3Like, rot?: THREE.Euler, r = 0, seg = SEG): void {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)) : new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.Matrix4().compose(new THREE.Vector3(at.x, at.y, at.z), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
  m.geo(s, g, mat);
}

/** Add the same part on both sides (x and -x, mirrored). */
function both(fn: (sx: 1 | -1) => void): void { fn(1); fn(-1); }

const mirrorX = new THREE.Matrix4().makeScale(-1, 1, 1);

/** A conforming strip on the side wall (z0..z1, y0..y1), `out` metres proud, face coords u along z. */
function sideDecal(m: Mesher, shell: Shell, s: Surf, z0: number, z1: number, y0: number, y1: number, out: number, sx: 1 | -1, nu = 8): void {
  const P: THREE.Vector3[][] = [];
  for (let i = 0; i <= nu; i++) {
    const z = z0 + (z1 - z0) * (i / nu);
    const col: THREE.Vector3[] = [];
    for (const y of [y0, y1]) {
      const p = shell.sideAt(z, y);
      col.push(new THREE.Vector3((p.x + p.nx * out) * sx, y, p.z + p.nz * out));
    }
    P.push(col);
  }
  for (let i = 0; i < nu; i++) {
    const a = P[i][0], b = P[i + 1][0], c = P[i + 1][1], d = P[i][1];
    // Text reads front-to-back on the left (+X) side, back-to-front on the right, like real lettering.
    const u0 = sx > 0 ? 1 - i / nu : i / nu, u1 = sx > 0 ? 1 - (i + 1) / nu : (i + 1) / nu;
    const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, b)).normalize();
    if (n.x * sx < 0) n.negate();
    const N = [n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z];
    const tri = (p: THREE.Vector3[], q: number[]) => m.tri(s, [p[0].x, p[0].y, p[0].z, p[1].x, p[1].y, p[1].z, p[2].x, p[2].y, p[2].z], N, q);
    // Stations run front to back along +z; on the +X side that winding faces inward, so swap.
    if (sx > 0) { tri([a, c, b], [u0, 0, u1, 1, u1, 0]); tri([a, d, c], [u0, 0, u0, 1, u1, 1]); }
    else { tri([a, b, c], [u0, 0, u1, 0, u1, 1]); tri([a, c, d], [u0, 0, u1, 1, u0, 1]); }
  }
}

/** A flat textured quad facing +Z (front) or -Z (rear), centred at `c`. */
function endQuad(m: Mesher, s: Surf, c: THREE.Vector3Like, w: number, h: number, dir: 1 | -1): void {
  // Seen from outside, +X is on the viewer's right at the front and on the left at the rear.
  const x0 = c.x - w / 2 * dir, x1 = c.x + w / 2 * dir;
  m.quad(s, { x: x0, y: c.y - h / 2, z: c.z }, { x: x1, y: c.y - h / 2, z: c.z }, { x: x1, y: c.y + h / 2, z: c.z }, { x: x0, y: c.y + h / 2, z: c.z });
}

/** Side stations round a wheel arch, denser where the arch is steep. */
function archKeys(arches: { z: number; r: number }[], hi: boolean): number[] {
  const n = hi ? 18 : 8, out: number[] = [];
  for (const a of arches) for (let k = 0; k <= n; k++) out.push(a.z - a.r + (2 * a.r) * (0.5 - 0.5 * Math.cos(Math.PI * k / n)));
  return out;
}

// ---- the car-like shell (sedan, hatch, SUV, MPV) ---------------------------------------------------

interface EndRows { lampTop: number; lampBot: number; split: number; plateT: number; plateB: number; intakeB: number; sill: number; bottom: number }

interface CarParams {
  zRear: number; zFront: number;
  width: Pts; top: Pts; deck: Pts; deckInset: number;
  /** Greenhouse: windscreen base / top, rear screen top / base (z). */
  cowl: number; header: number; rearHeader: number; deckZ: number;
  rail: Pts; railInset: Pts; crown: Pts;
  bulge: number;
  frontRound: { len: number; end: number }; rearRound: { len: number; end: number };
  bottom: number; sill: number; charY: number; split: number; doorBottom: number;
  front: EndRows; rear: EndRows;
  /** Side profile offsets below the top contour ([depth below top, out]) and above the bottom ([height above bottom, out]). */
  offTop: Pts; offBottom: Pts; offFront: Pts; offRear: Pts;
  headInner: number; headSideZ: number; grilleX: number; plateX: number; intakeX: number;
  tailInner: number; tailSideZ: number; revInner: number;
  /** Side windows [z0, z1] front to back, and blacked-out bands [z0, z1] (B-pillar, dividers). */
  windows: Pts; blackouts: Pts;
  /** Vertical panel seams on the side: [z, top y]; they run down to the sill or the arch. */
  seams: Pts;
  doorSpan: [number, number];
  hoodSeam: number; bootSeam: number;
  arches: { z: number; r: number; yc: number }[];
  cladding: boolean;
  /** Fender flare round the arches, m. */
  flare: number;
  /** Which grille and lamp graphics this type wears (so the types do not share a face). */
  style: { grille: 'grille' | 'grilleBars' | 'grilleSlim' | 'grilleWave'; head: 'head' | 'head2'; tail: 'tail' | 'tail2' };
  /** Rear screen and tailgate are one (hatch, SUV, MPV): no boot deck. */
  tailgate: boolean;
  mirrorZ: number;
  roofRails: boolean;
  handles: number[];
  handleY: number;
  spoiler: boolean;
  chrome: { belt: boolean; split: boolean };
}

function carShell(p: CarParams, detail: Detail, pal: Pal): Shell {
  const hi = detail === 'high';
  const width = curve(p.width), top = curve(p.top), deck = curve(p.deck), crownF = curve(p.crown);
  const railF = curve(p.rail), insetF = curve(p.railInset);
  const offTop = curve(p.offTop), offBot = curve(p.offBottom), offFr = curve(p.offFront), offRe = curve(p.offRear);
  const inGreen = (z: number) => z < p.cowl && z > p.deckZ;
  const section = (z: number) => {
    const w = width(z), t = top(z), yD = deck(z), xD = w - p.deckInset;
    const g = inGreen(z);
    const yR = g ? Math.max(yD, railF(z)) : yD;
    const xR = g ? Math.min(xD, w - insetF(z)) : xD;
    const yT = Math.max(crownF(z), yR);
    const roof = z < p.header && z > p.rearHeader;
    return { w, top: t, xD, yD, xR, yR, yT, bulge: p.bulge, crown: roof ? 2.4 : 2 };
  };
  const cols = hi
    ? { S: [0, 0.35, 0.7, 1], G: [0, 0.06, 0.3, 0.55, 0.8, 0.93, 1], T: [0, 0.015, 0.09, 0.2, 0.32, 0.45, 0.58, 0.72, 0.86, 1] }
    : { S: [0, 0.5, 1], G: [0, 0.07, 0.92, 1], T: [0, 0.015, 0.09, 0.3, 0.6, 1] };
  const fw = width(p.zFront) * p.frontRound.end, rw = width(p.zRear) * p.rearRound.end;
  const frontX = edgeXs([p.headInner, p.grilleX, p.plateX, p.intakeX].filter((x) => x > 0), cols.T.length, (fw - p.deckInset * p.frontRound.end) * 0.999);
  const rearX = edgeXs([p.tailInner, p.revInner, p.plateX].filter((x) => x > 0), cols.T.length, (rw - p.deckInset * p.rearRound.end) * 0.999);
  const F = p.front, R = p.rear;
  const rows: WallRow[] = [
    { name: 'top', side: (_z, t) => t, front: (_x, t) => t, rear: (_x, t) => t },
    { name: 'r1', side: (_z, t) => t - 0.022, front: (_x, t) => Math.min(t - 0.012, F.lampTop), rear: (_x, t) => Math.min(t - 0.012, R.lampTop) },
    { name: 'char', side: (_z, t) => Math.min(t - 0.07, p.charY), front: () => F.lampBot, rear: () => R.lampBot },
    ...(hi ? [{ name: 'h1', side: () => (p.charY + p.split) / 2, front: () => (F.lampBot + F.split) / 2, rear: () => (R.lampBot + R.split) / 2 }] : []),
    { name: 'splitU', side: () => p.split + 0.005, front: () => F.split + 0.005, rear: () => R.split + 0.005 },
    { name: 'splitL', side: () => p.split - 0.005, front: () => F.split - 0.005, rear: () => R.split - 0.005 },
    { name: 'plateT', side: () => (p.split + p.doorBottom) / 2 + 0.06, front: () => F.plateT, rear: () => R.plateT },
    { name: 'plateB', side: () => (p.split + p.doorBottom) / 2 - 0.02, front: () => F.plateB, rear: () => R.plateB },
    ...(hi ? [{ name: 'h2', side: () => p.doorBottom + 0.05, front: () => (F.plateB + F.intakeB) / 2, rear: () => (R.plateB + R.intakeB) / 2 }] : []),
    { name: 'doorB', side: () => p.doorBottom, front: () => F.intakeB, rear: () => R.intakeB },
    { name: 'doorB2', side: () => p.doorBottom - 0.008, front: () => F.intakeB - 0.008, rear: () => R.intakeB - 0.008 },
    { name: 'sill', side: () => p.sill, front: () => F.sill, rear: () => R.sill },
    ...(hi ? [{ name: 'h3', side: () => (p.sill + p.bottom) / 2 + 0.01, front: () => (F.sill + F.bottom) / 2, rear: () => (R.sill + R.bottom) / 2 }] : []),
    { name: 'bottom', side: () => p.bottom, front: () => F.bottom, rear: () => R.bottom },
  ];
  const ri = (n: string) => rows.findIndex((r) => r.name === n);
  const K = { r1: ri('r1'), char: ri('char'), splitU: ri('splitU'), splitL: ri('splitL'), plateT: ri('plateT'), plateB: ri('plateB'), doorB: ri('doorB'), doorB2: ri('doorB2'), sill: ri('sill') };
  const seamBand = 0.0045;
  const zKeys = [p.cowl, p.cowl + 0.035, p.header, p.header + 0.03, p.rearHeader, p.rearHeader - 0.03, p.rearHeader - 0.035, p.rearHeader - 0.07, p.deckZ, p.hoodSeam, p.hoodSeam + 0.009, p.bootSeam, p.bootSeam - 0.009,
    p.headSideZ, p.tailSideZ, p.mirrorZ, ...p.windows.flat(), ...p.blackouts.flat(), ...p.seams.flatMap(([z]) => [z - seamBand, z + seamBand])];
  zKeys.push(...archKeys(p.arches, hi));
  const upperOrLower = (k: number) => (k < K.splitL ? pal.paintU : pal.paintL);
  const def: ShellDef = {
    zRear: p.zRear, zFront: p.zFront, section,
    frontRound: { ...p.frontRound, rows: hi ? 12 : 6 }, rearRound: { ...p.rearRound, rows: hi ? 12 : 6 },
    cols, frontX, rearX, rows, arches: p.arches, zKeys, maxDz: hi ? 0.055 : 0.16,
    offSide: (y, z) => {
      let o = Math.min(offTop(top(z) - y), offBot(y - p.bottom));
      // Fender flares: the panel swells round each arch and fades out above it.
      for (const a of p.arches) {
        const t = Math.abs(z - a.z) / (a.r + 0.2);
        if (t < 1) o += p.flare * (1 - t * t) ** 2 * (1 - smooth(a.yc + a.r - 0.02, a.yc + a.r + 0.16, y));
      }
      return o;
    },
    offFront: (y, x) => {
      let o = Math.min(offFr(top(p.zFront) - y), offBot(y - F.bottom) + 0.02);
      if (x < p.grilleX - 1e-4 && y < F.lampTop && y > F.split) o -= 0.012;
      if (x < p.intakeX - 1e-4 && y < F.plateB && y > F.intakeB) o -= 0.015;
      return o;
    },
    offRear: (y) => Math.min(offRe(top(p.zRear) - y), offBot(y - R.bottom) + 0.02),
    crease: 0.6,
    capClass(f: CapFace) {
      const z = f.z;
      if (f.group === 'S') return pal.paintU;
      if (f.group === 'G') {
        const h = f.sec.yR - f.sec.yD;
        if (h < 0.02) return pal.paintU;
        if (f.u < 0.07) return p.chrome.belt ? pal.chrome : pal.black;
        if (f.u > 0.92) return pal.black;
        for (const [a, b] of p.blackouts) if (between(z, a, b)) return pal.gloss;
        for (const [a, b] of p.windows) if (between(z, a, b)) return pal.glass;
        if (z > p.mirrorZ && z < p.cowl) return pal.black;   // mirror sail
        return pal.paintU;
      }
      // T group.
      if (f.u < 0.015 && (z > p.cowl || z < p.bootSeam)) return pal.seam;   // hood / boot lid side gaps
      if (between(z, p.hoodSeam, p.hoodSeam + 0.009) || between(z, p.bootSeam - 0.009, p.bootSeam)) return pal.seam;
      if (z < p.cowl + 0.035 && z > p.cowl) return pal.black;   // cowl panel
      if (z <= p.cowl && z > p.header) {
        if (f.u < 0.09) return pal.paintU;
        if (z < p.header + 0.03) return pal.black;
        return pal.glass;
      }
      if (z <= p.rearHeader && z > p.deckZ) {
        if (f.u < 0.09) return pal.paintU;
        if (z > p.rearHeader - 0.03) return pal.black;
        if (z > p.rearHeader - 0.07 && z < p.rearHeader - 0.035 && f.u > 0.75) return pal.brake;
        return pal.glassDark;
      }
      if (p.roofRails && z < p.header - 0.05 && z > p.rearHeader + 0.05 && f.u > 0.09 && f.u < 0.2) return pal.black;
      return pal.paintU;
    },
    wallClass(f: WallFace) {
      const k = f.k;
      const tone = upperOrLower(k);
      if (k >= K.sill) return f.region === 'side' && !p.cladding ? pal.paintL : pal.black;
      if (f.region === 'side' || (f.wS > 0.35)) {
        // Lamps wrap round the corners onto the sides.
        if (k >= K.r1 && k < K.char) {
          if (f.z > p.headSideZ) return pal.head;
          if (f.z < p.tailSideZ) return pal.tail;
        }
        if (p.cladding && k >= K.doorB2) return pal.cladding;
        if (k === K.splitU && p.chrome.split) return pal.chrome;
        if (k >= K.doorB && k < K.doorB2 && between(f.z, p.doorSpan[0], p.doorSpan[1])) return pal.seam;
        for (const [z, yTop] of p.seams) if (f.z0 >= z - seamBand - 1e-4 && f.z1 <= z + seamBand + 1e-4 && f.y < yTop && k < K.doorB2) return pal.seam;
        return tone;
      }
      if (f.region === 'front' || f.wF > f.wR) {
        if (k >= K.r1 && k < K.char) {
          if (f.x > p.headInner) return pal.head;
          if (f.x < p.grilleX) return pal.grille;
          return pal.paintU;
        }
        if (k >= K.char && k < K.splitU && f.x < p.grilleX) return pal.grille;
        if (k >= K.plateT && k < K.plateB && f.x < p.plateX) return pal.black;
        if (k >= K.plateB && k < K.doorB && f.x < p.intakeX) return pal.intake;
        if (p.cladding && k >= K.doorB) return pal.cladding;
        return tone;
      }
      // Rear.
      if (k >= K.r1 && k < K.char) {
        if (f.x > p.tailInner) return pal.tail;
        if (f.x > p.revInner) return pal.reverse;
        return p.tailgate ? pal.paintU : pal.paintU;
      }
      if (k >= K.plateT && k < K.plateB && f.x < p.plateX) return pal.black;
      if (k >= K.doorB && (p.cladding || k >= K.doorB2)) return pal.black;
      return tone;
    },
  };
  return new Shell(def);
}

// ---- body definitions ------------------------------------------------------------------------------

function sedanParams(spec: VehicleSpec): CarParams {
  const fz = spec.wheels[0].z, rz = spec.wheels[2].z;
  const cowl = 0.93, header = 0.08, rearHeader = -0.95, deckZ = -1.64;
  return {
    zRear: -2.28, zFront: 2.2,
    width: [[-2.28, 0.872], [-1.4, 0.893], [0, 0.9], [1.3, 0.895], [2.2, 0.872]],
    top: [[-2.28, 0.56], [-1.8, 0.57], [-1.1, 0.555], [0, 0.535], [0.95, 0.52], [1.4, 0.5], [1.9, 0.462], [2.2, 0.4]],
    deck: [[-2.28, 0.622], [-1.64, 0.655], [-1.2, 0.655], [0, 0.628], [0.93, 0.6], [1.3, 0.574], [1.8, 0.522], [2.2, 0.448]],
    deckInset: 0.045,
    cowl, header, rearHeader, deckZ,
    rail: [[deckZ, 0.655], [deckZ + 0.2, 0.8], [rearHeader - 0.2, 1.0], [rearHeader, 1.06], [rearHeader + 0.25, 1.072], [-0.3, 1.075], [header - 0.12, 1.07], [header, 1.058], [header + 0.25, 0.94], [cowl - 0.3, 0.76], [cowl, 0.6]],
    railInset: [[deckZ, 0.045], [rearHeader - 0.15, 0.2], [rearHeader, 0.222], [-0.4, 0.218], [header, 0.21], [cowl, 0.045]],
    crown: [[-2.28, 0.645], [-2.0, 0.675], [deckZ - 0.02, 0.68], [deckZ + 0.12, 0.75], [rearHeader - 0.18, 1.05], [rearHeader + 0.02, 1.12], [-0.35, 1.135], [header - 0.02, 1.122], [header + 0.18, 1.06], [cowl - 0.15, 0.7], [cowl + 0.05, 0.615], [1.6, 0.56], [2.2, 0.47]],
    bulge: 0.018,
    frontRound: { len: 0.46, end: 0.79 }, rearRound: { len: 0.42, end: 0.83 },
    bottom: -0.172, sill: -0.13, charY: 0.35, split: 0.28, doorBottom: -0.07,
    front: { lampTop: 0.39, lampBot: 0.285, split: 0.2, plateT: 0.1, plateB: -0.035, intakeB: -0.1, sill: -0.14, bottom: -0.185 },
    rear: { lampTop: 0.548, lampBot: 0.43, split: 0.28, plateT: 0.2, plateB: 0.06, intakeB: -0.07, sill: -0.13, bottom: -0.18 },
    offTop: [[0, 0], [0.02, 0.007], [0.06, 0.013], [0.12, 0.015], [0.4, 0.012]],
    offBottom: [[0, -0.05], [0.04, -0.008], [0.1, 0.006], [0.2, 0.012], [0.5, 0.016]],
    offFront: [[0, 0], [0.012, 0.012], [0.11, 0.03], [0.2, 0.05], [0.36, 0.068], [0.5, 0.06]],
    offRear: [[0, 0], [0.012, 0.009], [0.13, 0.024], [0.3, 0.045], [0.5, 0.058], [0.7, 0.055]],
    headInner: 0.47, headSideZ: 1.93, grilleX: 0.4, plateX: 0.225, intakeX: 0.56,
    tailInner: 0.47, tailSideZ: -2.06, revInner: 0.37,
    windows: [[-0.255, cowl], [-1.02, -0.345], [-1.4, -1.065]],
    blackouts: [[-0.345, -0.255], [-1.065, -1.02]],
    seams: [[0.885, 0.6], [-0.3, 0.64], [-0.985, 0.65], [1.735, 0.285], [-1.85, 0.43]],
    doorSpan: [-0.985, 0.885],
    hoodSeam: cowl + 0.07, bootSeam: deckZ - 0.03,
    arches: [{ z: fz, r: 0.39, yc: 0.005 }, { z: rz, r: 0.39, yc: 0.005 }],
    cladding: false, flare: 0.022, tailgate: false, mirrorZ: 0.83, roofRails: false,
    style: { grille: 'grille', head: 'head', tail: 'tail' },
    handles: [0.42, -0.72], handleY: 0.47, spoiler: false,
    chrome: { belt: true, split: false },
  };
}

function hatchParams(spec: VehicleSpec): CarParams {
  const fz = spec.wheels[0].z, rz = spec.wheels[2].z;
  const cowl = 0.72, header = -0.12, rearHeader = -1.55, deckZ = -1.86;
  return {
    zRear: -1.93, zFront: 1.98,
    width: [[-1.93, 0.85], [-1.3, 0.873], [0, 0.88], [1.2, 0.875], [1.98, 0.853]],
    top: [[-1.93, 0.57], [-1.3, 0.565], [-0.6, 0.548], [0.7, 0.518], [1.2, 0.492], [1.7, 0.452], [1.98, 0.39]],
    deck: [[-1.93, 0.655], [-1.6, 0.662], [-1.2, 0.662], [0, 0.632], [0.72, 0.6], [1.1, 0.572], [1.6, 0.522], [1.98, 0.44]],
    deckInset: 0.045,
    cowl, header, rearHeader, deckZ,
    rail: [[deckZ, 0.662], [-1.78, 0.84], [-1.65, 1.0], [rearHeader, 1.075], [-1.2, 1.088], [-0.6, 1.092], [header - 0.1, 1.086], [header, 1.072], [header + 0.25, 0.945], [cowl - 0.25, 0.752], [cowl, 0.6]],
    railInset: [[deckZ, 0.045], [rearHeader, 0.2], [-0.6, 0.205], [header, 0.2], [cowl, 0.045]],
    crown: [[-1.93, 0.66], [deckZ, 0.69], [-1.76, 0.9], [-1.62, 1.08], [rearHeader, 1.13], [-0.8, 1.148], [header, 1.14], [header + 0.2, 1.065], [cowl - 0.15, 0.72], [cowl + 0.05, 0.618], [1.4, 0.56], [1.98, 0.462]],
    bulge: 0.016,
    frontRound: { len: 0.42, end: 0.78 }, rearRound: { len: 0.3, end: 0.84 },
    bottom: -0.165, sill: -0.125, charY: 0.37, split: 0.28, doorBottom: -0.065,
    front: { lampTop: 0.378, lampBot: 0.27, split: 0.19, plateT: 0.09, plateB: -0.045, intakeB: -0.1, sill: -0.135, bottom: -0.18 },
    rear: { lampTop: 0.556, lampBot: 0.44, split: 0.37, plateT: 0.3, plateB: 0.16, intakeB: -0.06, sill: -0.12, bottom: -0.17 },
    offTop: [[0, 0], [0.02, 0.007], [0.06, 0.013], [0.12, 0.015], [0.4, 0.012]],
    offBottom: [[0, -0.05], [0.04, -0.008], [0.1, 0.006], [0.2, 0.012], [0.5, 0.016]],
    offFront: [[0, 0], [0.012, 0.012], [0.11, 0.03], [0.2, 0.05], [0.36, 0.064], [0.5, 0.058]],
    offRear: [[0, 0], [0.012, 0.01], [0.12, 0.022], [0.3, 0.03], [0.45, 0.05], [0.7, 0.05]],
    headInner: 0.45, headSideZ: 1.72, grilleX: 0.36, plateX: 0.225, intakeX: 0.52,
    tailInner: 0.52, tailSideZ: -1.76, revInner: 0.44,
    windows: [[-0.33, cowl], [-1.12, -0.415], [-1.5, -1.16]],
    blackouts: [[-0.415, -0.33], [-1.16, -1.12]],
    seams: [[0.78, 0.6], [-0.372, 0.64], [-1.08, 0.65], [1.66, 0.27], [-1.62, 0.44]],
    doorSpan: [-1.08, 0.78],
    hoodSeam: cowl + 0.07, bootSeam: rearHeader + 0.03,
    arches: [{ z: fz, r: 0.38, yc: 0.005 }, { z: rz, r: 0.38, yc: 0.005 }],
    cladding: false, flare: 0.02, tailgate: true, mirrorZ: 0.64, roofRails: false,
    style: { grille: 'grilleSlim', head: 'head2', tail: 'tail2' },
    handles: [0.25, -0.8], handleY: 0.47, spoiler: true,
    chrome: { belt: false, split: false },
  };
}

function suvParams(spec: VehicleSpec): CarParams {
  const fz = spec.wheels[0].z, rz = spec.wheels[2].z;
  const cowl = 0.93, header = 0.1, rearHeader = -1.95, deckZ = -2.2;
  return {
    zRear: -2.27, zFront: 2.22,
    width: [[-2.27, 0.9], [-1.36, 0.925], [0, 0.93], [1.36, 0.925], [2.22, 0.9]],
    top: [[-2.27, 0.66], [-1.4, 0.66], [0, 0.635], [0.9, 0.622], [1.4, 0.6], [1.9, 0.56], [2.22, 0.5]],
    deck: [[-2.27, 0.71], [-2.0, 0.742], [-1.4, 0.752], [0, 0.725], [0.93, 0.702], [1.36, 0.682], [1.8, 0.642], [2.22, 0.562]],
    deckInset: 0.05,
    cowl, header, rearHeader, deckZ,
    rail: [[deckZ, 0.75], [-2.13, 0.95], [-2.03, 1.18], [rearHeader, 1.262], [-1.5, 1.285], [-0.5, 1.29], [header - 0.1, 1.285], [header, 1.27], [header + 0.25, 1.12], [cowl - 0.3, 0.9], [cowl, 0.702]],
    railInset: [[deckZ, 0.05], [rearHeader, 0.17], [-0.5, 0.175], [header, 0.17], [cowl, 0.05]],
    crown: [[-2.27, 0.8], [deckZ, 0.82], [-2.1, 1.15], [rearHeader, 1.328], [-1.0, 1.345], [header, 1.34], [header + 0.2, 1.25], [cowl - 0.15, 0.84], [cowl + 0.05, 0.73], [1.6, 0.668], [2.22, 0.585]],
    bulge: 0.012,
    frontRound: { len: 0.45, end: 0.8 }, rearRound: { len: 0.32, end: 0.86 },
    bottom: -0.13, sill: -0.08, charY: 0.46, split: 0.36, doorBottom: -0.02,
    front: { lampTop: 0.488, lampBot: 0.38, split: 0.3, plateT: 0.16, plateB: 0.02, intakeB: -0.06, sill: -0.1, bottom: -0.15 },
    rear: { lampTop: 0.63, lampBot: 0.52, split: 0.46, plateT: 0.4, plateB: 0.26, intakeB: 0.0, sill: -0.07, bottom: -0.13 },
    offTop: [[0, 0], [0.02, 0.006], [0.06, 0.012], [0.12, 0.014], [0.5, 0.012]],
    offBottom: [[0, -0.045], [0.04, -0.01], [0.1, 0.004], [0.2, 0.01], [0.6, 0.014]],
    offFront: [[0, 0], [0.012, 0.012], [0.11, 0.028], [0.25, 0.045], [0.45, 0.06], [0.64, 0.055]],
    offRear: [[0, 0], [0.012, 0.01], [0.12, 0.02], [0.35, 0.03], [0.55, 0.052], [0.8, 0.05]],
    headInner: 0.5, headSideZ: 1.95, grilleX: 0.42, plateX: 0.225, intakeX: 0.58,
    tailInner: 0.52, tailSideZ: -2.06, revInner: 0.44,
    windows: [[-0.3, cowl], [-1.2, -0.39], [-1.9, -1.26]],
    blackouts: [[-0.39, -0.3], [-1.26, -1.2]],
    seams: [[0.88, 0.7], [-0.345, 0.74], [-1.23, 0.75], [1.8, 0.38], [-2.0, 0.52]],
    doorSpan: [-1.23, 0.88],
    hoodSeam: cowl + 0.07, bootSeam: rearHeader + 0.03,
    arches: [{ z: fz, r: 0.44, yc: 0.01 }, { z: rz, r: 0.44, yc: 0.01 }],
    cladding: true, flare: 0.03, tailgate: true, mirrorZ: 0.84, roofRails: true,
    style: { grille: 'grilleBars', head: 'head2', tail: 'tail' },
    handles: [0.45, -0.85], handleY: 0.58, spoiler: false,
    chrome: { belt: true, split: false },
  };
}

function mpvParams(spec: VehicleSpec): CarParams {
  const fz = spec.wheels[0].z, rz = spec.wheels[2].z;
  const cowl = 1.02, header = 0.1, rearHeader = -2.45, deckZ = -2.6;
  return {
    zRear: -2.64, zFront: 2.42,
    width: [[-2.64, 0.92], [-1.6, 0.94], [0, 0.942], [1.5, 0.935], [2.42, 0.91]],
    top: [[-2.64, 0.62], [-1.6, 0.622], [0, 0.605], [1.0, 0.588], [1.5, 0.562], [2.0, 0.522], [2.42, 0.452]],
    deck: [[-2.64, 0.682], [-2.3, 0.702], [-1.6, 0.704], [0, 0.684], [1.02, 0.656], [1.5, 0.632], [2.0, 0.582], [2.42, 0.502]],
    deckInset: 0.05,
    cowl, header, rearHeader, deckZ,
    rail: [[deckZ, 0.704], [-2.56, 0.95], [-2.5, 1.25], [rearHeader, 1.378], [-1.5, 1.408], [-0.5, 1.415], [header - 0.1, 1.41], [header, 1.392], [header + 0.3, 1.2], [cowl - 0.35, 0.92], [cowl, 0.656]],
    railInset: [[deckZ, 0.05], [rearHeader, 0.15], [-0.5, 0.155], [header, 0.16], [cowl, 0.05]],
    crown: [[-2.64, 0.78], [deckZ, 0.8], [-2.55, 1.2], [rearHeader, 1.448], [-1.0, 1.465], [header, 1.46], [header + 0.25, 1.33], [cowl - 0.2, 0.86], [cowl + 0.05, 0.7], [1.8, 0.632], [2.42, 0.535]],
    bulge: 0.012,
    frontRound: { len: 0.45, end: 0.8 }, rearRound: { len: 0.3, end: 0.86 },
    bottom: -0.15, sill: -0.11, charY: 0.41, split: 0.3, doorBottom: -0.05,
    front: { lampTop: 0.44, lampBot: 0.33, split: 0.25, plateT: 0.12, plateB: -0.02, intakeB: -0.09, sill: -0.12, bottom: -0.17 },
    rear: { lampTop: 0.6, lampBot: 0.46, split: 0.4, plateT: 0.36, plateB: 0.22, intakeB: -0.03, sill: -0.1, bottom: -0.16 },
    offTop: [[0, 0], [0.02, 0.006], [0.06, 0.012], [0.12, 0.014], [0.5, 0.012]],
    offBottom: [[0, -0.05], [0.04, -0.01], [0.1, 0.004], [0.2, 0.01], [0.6, 0.014]],
    offFront: [[0, 0], [0.012, 0.012], [0.11, 0.03], [0.22, 0.05], [0.4, 0.066], [0.62, 0.06]],
    offRear: [[0, 0], [0.012, 0.01], [0.14, 0.02], [0.3, 0.028], [0.5, 0.05], [0.78, 0.05]],
    headInner: 0.5, headSideZ: 2.15, grilleX: 0.44, plateX: 0.225, intakeX: 0.6,
    tailInner: 0.55, tailSideZ: -2.42, revInner: 0.46,
    windows: [[-0.14, cowl], [-1.35, -0.24], [-2.35, -1.45]],
    blackouts: [[-0.24, -0.14], [-1.45, -1.35]],
    seams: [[0.98, 0.66], [-0.19, 0.69], [-1.4, 0.7], [2.05, 0.33], [-2.36, 0.46]],
    doorSpan: [-1.4, 0.98],
    hoodSeam: cowl + 0.06, bootSeam: rearHeader + 0.03,
    arches: [{ z: fz, r: 0.42, yc: 0.005 }, { z: rz, r: 0.42, yc: 0.005 }],
    cladding: false, flare: 0.02, tailgate: true, mirrorZ: 0.92, roofRails: false,
    style: { grille: 'grilleWave', head: 'head', tail: 'tail2' },
    handles: [0.55, -0.32], handleY: 0.52, spoiler: false,
    chrome: { belt: true, split: false },
  };
}

// ---- details ---------------------------------------------------------------------------------------

/** Apply a part on one side: `sx` < 0 mirrors it across the centre line. */
function sided(m: Mesher, sf: Surf, g: THREE.BufferGeometry, mat: THREE.Matrix4, sx: 1 | -1): void {
  if (sx < 0) mat.premultiply(mirrorX);
  m.geo(sf, g, mat);
}

/** Wing mirrors on the door at the A-pillar base: body-colour housing, dark glass facing back, black arm. */
function mirrors(m: Mesher, shell: Shell, pal: Pal, z: number, size = 1, out = 0.05): void {
  both((sx) => {
    const g = shell.glassAt(z, 0.08);
    const W = 0.19 * size, H = 0.105 * size, D = 0.085 * size;
    const cx = g.x + out + W / 2, cy = g.y + 0.055 * size, cz = z - 0.03;
    const toe = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.08, 0));
    const at = (x: number, y: number, zz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, zz), toe, new THREE.Vector3(1, 1, 1));
    sided(m, pal.paintU, new RoundedBoxGeometry(W, H, D, SEG + 1, 0.034 * size), at(cx, cy, cz), sx);
    sided(m, pal.glassDark, new THREE.PlaneGeometry(W - 0.03 * size, H - 0.028 * size).rotateY(Math.PI), at(cx + 0.004, cy, cz - D / 2 - 0.002), sx);
    sided(m, pal.black, SEG > 1 ? new RoundedBoxGeometry(out + 0.04, 0.035 * size, 0.07 * size, 2, 0.012) : new THREE.BoxGeometry(out + 0.04, 0.035 * size, 0.07 * size), at(g.x + (out + 0.04) / 2 - 0.01, cy - H * 0.3, cz + 0.01), sx);
  });
}

function handles(m: Mesher, shell: Shell, pal: Pal, zs: number[], y: number, s: Surf): void {
  for (const z of zs) both((sx) => {
    const p = shell.sideAt(z, y);
    const g = SEG > 1 ? new RoundedBoxGeometry(0.03, 0.028, 0.15, 2, 0.012) : new THREE.BoxGeometry(0.03, 0.028, 0.15);
    const mat = new THREE.Matrix4().compose(new THREE.Vector3(p.x + p.nx * 0.004, y, p.z + p.nz * 0.004), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.nx, p.nz) - Math.PI / 2), new THREE.Vector3(1, 1, 1));
    if (sx < 0) mat.premultiply(mirrorX);
    m.geo(s, g, mat);
    // Recess shadow behind the handle.
    const r = new THREE.PlaneGeometry(0.17, 0.04).rotateY(Math.PI / 2);
    const rm = new THREE.Matrix4().makeTranslation(p.x + 0.0015, y, p.z);
    if (sx < 0) rm.premultiply(mirrorX);
    m.geo(pal.seam, r, rm);
  });
}

/** Under-floor and wheel-well liners, so nothing shows daylight through the arches. */
function underbody(m: Mesher, pal: Pal, z0: number, z1: number, y: number, halfW: number, arches: { z: number; r: number; yc: number }[], xIn: number, xOut: (z: number, y: number) => number): void {
  // Floor: a strip between the arches and the ends; narrower through the arches.
  const cuts = [z0, ...arches.flatMap((a) => [a.z - a.r, a.z + a.r]), z1].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const inArch = arches.some((ar) => (a + b) / 2 > ar.z - ar.r && (a + b) / 2 < ar.z + ar.r);
    const w = inArch ? xIn : halfW;
    m.quad(pal.under, { x: w, y, z: b }, { x: -w, y, z: b }, { x: -w, y, z: a }, { x: w, y, z: a });
  }
  for (const a of arches) {
    both((sx) => {
      // Liner: the upper half of a cylinder round the tyre, seen from inside.
      const seg = 14;
      const R = a.r - 0.006;
      for (let i = 0; i < seg; i++) {
        const t0 = Math.PI * (i / seg), t1 = Math.PI * ((i + 1) / seg);
        const p = (t: number, x: number | null) => {
          const yy = a.yc + Math.sin(t) * R, zz = a.z + Math.cos(t) * R;
          return { x: (x ?? xOut(zz, yy)) * sx, y: yy, z: zz };
        };
        const A = p(t0, xIn), B = p(t0, null), C = p(t1, null), D = p(t1, xIn);
        if (sx > 0) m.quad(pal.liner, A, D, C, B); else m.quad(pal.liner, A, B, C, D);
      }
      // Inner wall of the well.
      // Upper half disc in XY facing +Z, turned into the ZY plane facing +X (outward on the left).
      const disc = new THREE.CircleGeometry(R, 14, 0, Math.PI).rotateY(Math.PI / 2);
      const mat = new THREE.Matrix4().makeTranslation(xIn * sx, a.yc, a.z);
      if (sx < 0) mat.premultiply(mirrorX);
      m.geo(pal.liner, disc, mat);
    });
  }
}

/** A strip round a wheel arch lip on the body surface (SUV cladding), `width` wide. */
function archTrim(m: Mesher, shell: Shell, s: Surf, a: { z: number; r: number; yc: number }, width: number, detail: Detail): void {
  const n = detail === 'high' ? 24 : 10;
  both((sx) => {
    for (let i = 0; i < n; i++) {
      const pt = (k: number, rr: number) => {
        const t = -0.18 + (Math.PI + 0.36) * (k / n);
        const y = a.yc + Math.sin(t) * rr, z = a.z + Math.cos(t) * rr;
        const q = shell.sideAt(z, y);
        return { x: (q.x + q.nx * 0.006) * sx, y, z: q.z + q.nz * 0.006 };
      };
      const A = pt(i, a.r), B = pt(i + 1, a.r), C = pt(i + 1, a.r + width), D = pt(i, a.r + width);
      // Angle runs front -> over the top -> back: seen from +X that is right to left, so A-B-C-D
      // is counter-clockwise on the left side and the mirrored side takes the reverse.
      if (sx > 0) m.quad(s, A, B, C, D); else m.quad(s, A, D, C, B);
    }
  });
}

/** Longitudinal roof rails (SUV). */
function roofRails(m: Mesher, shell: Shell, pal: Pal, z0: number, z1: number): void {
  both((sx) => {
    const n = SEG > 1 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const za = z0 + (z1 - z0) * (i / n), zb = z0 + (z1 - z0) * ((i + 1) / n);
      const pa = shell.capAt(za, 0.16), pb = shell.capAt(zb, 0.16);
      const c = new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 + 0.04, (za + zb) / 2);
      const len = Math.hypot(za - zb, pa.y - pb.y) + 0.01;
      const g = SEG > 1 ? new RoundedBoxGeometry(0.035, 0.03, len, 2, 0.012) : new THREE.BoxGeometry(0.035, 0.03, len);
      const mat = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(pa.y - pb.y, zb - za), 0, 0)), new THREE.Vector3(1, 1, 1));
      sided(m, pal.satin, g, mat, sx);
    }
    for (const z of [z0 + 0.03, z1 - 0.03]) {
      const pp = shell.capAt(z, 0.16);
      sided(m, pal.black, SEG > 1 ? new RoundedBoxGeometry(0.05, 0.05, 0.09, 2, 0.015) : new THREE.BoxGeometry(0.05, 0.05, 0.09), new THREE.Matrix4().makeTranslation(pp.x, pp.y + 0.02, z), sx);
    }
  });
}

/** Roof spoiler over a hatch's rear screen. */
function spoiler(m: Mesher, shell: Shell, pal: Pal, z: number): void {
  const p = shell.capAt(z, 0.5), e = shell.capAt(z, 0.05);
  box(m, pal.paintU, 2 * e.x - 0.04, 0.035, 0.16, { x: 0, y: (p.y + e.y) / 2 + 0.01, z: z - 0.06 }, new THREE.Euler(-0.12, 0, 0), 0.015);
}

function plates(m: Mesher, shell: Shell, pal: Pal, fy: number, ry: number): void {
  const f = shell.endAt(1, 0, fy), r = shell.endAt(-1, 0, ry);
  endQuad(m, pal.plateF, { x: 0, y: fy, z: f.z + 0.008 }, 0.44, 0.14, 1);
  endQuad(m, pal.plateR, { x: 0, y: ry, z: r.z - 0.012 }, 0.44, 0.14, -1);
}

function roofSign(m: Mesher, shell: Shell, pal: Pal, z: number): void {
  const p = shell.capAt(z, 1);
  const y0 = p.y + 0.012;
  // Trapezoid box: 0.64 wide, 0.2 deep at the foot, 0.16 at the top, 0.16 tall.
  const W = 0.32, D0 = 0.11, D1 = 0.075, H = 0.165;
  box(m, pal.signFoot, 0.5, 0.03, 0.18, { x: 0, y: y0, z });
  const yb = y0 + 0.015, yt = yb + H;
  const q = (s: Surf, a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like) => m.quad(s, a, b, c, d);
  // Front (+Z) and back faces carry the text.
  q(pal.signF, { x: -W, y: yb, z: z + D0 }, { x: W, y: yb, z: z + D0 }, { x: W, y: yt, z: z + D1 }, { x: -W, y: yt, z: z + D1 });
  q(pal.signB, { x: W, y: yb, z: z - D0 }, { x: -W, y: yb, z: z - D0 }, { x: -W, y: yt, z: z - D1 }, { x: W, y: yt, z: z - D1 });
  // Top and ends.
  q(pal.signBody, { x: W, y: yt, z: z - D1 }, { x: -W, y: yt, z: z - D1 }, { x: -W, y: yt, z: z + D1 }, { x: W, y: yt, z: z + D1 });
  q(pal.signBody, { x: W, y: yb, z: z + D0 }, { x: W, y: yb, z: z - D0 }, { x: W, y: yt, z: z - D1 }, { x: W, y: yt, z: z + D1 });
  q(pal.signBody, { x: -W, y: yb, z: z - D0 }, { x: -W, y: yb, z: z + D0 }, { x: -W, y: yt, z: z + D1 }, { x: -W, y: yt, z: z - D1 });
}

function lightBar(m: Mesher, shell: Shell, pal: Pal, z: number, w = 0.52): void {
  const p = shell.capAt(z, 1);
  const y0 = p.y + 0.015;
  box(m, pal.black, w * 2 + 0.06, 0.05, 0.3, { x: 0, y: y0 + 0.02, z }, undefined, 0.02);
  const lens = (s: Surf, x: number) => {
    const g = new RoundedBoxGeometry(w - 0.02, 0.085, 0.26, SEG + 1, 0.035);
    m.geo(s, g, new THREE.Matrix4().makeTranslation(x, y0 + 0.085, z));
  };
  // Red on the driver's (left, +X) side, blue on the right.
  lens(pal.beaconR, w / 2 + 0.005);
  lens(pal.beaconB, -w / 2 - 0.005);
  box(m, pal.chrome, 0.06, 0.07, 0.2, { x: 0, y: y0 + 0.08, z }, undefined, 0.01);
}

function wipers(m: Mesher, shell: Shell, pal: Pal, cowl: number): void {
  for (const [x, len] of [[0.28, 0.62], [-0.3, 0.55]] as const) {
    const p = shell.capAt(cowl - 0.03, 0.5);
    box(m, pal.black, len, 0.012, 0.018, { x, y: p.y + 0.012, z: cowl - 0.035 }, new THREE.Euler(0, 0.12 * Math.sign(x), 0));
  }
}

// ---- wheels ----------------------------------------------------------------------------------------

interface WheelStyle { spokes: number; double: boolean; steel: boolean; dish: number }

function wheel(r: number, width: number, detail: Detail, style: WheelStyle): Mesher {
  const m = new Mesher();
  const hi = detail === 'high';
  const seg = hi ? 48 : 12;
  const w = width / 2;
  const rimR = r * 0.64;
  const tyre = surf('trim', '#1a1a1b', 0.88, 0);
  const wall = surf('trim', '#202021', 0.8, 0);
  const alloy = style.steel ? surf('trim', '#8e9297', 0.45, 0.7) : surf('trim', '#c7cace', 0.26, 1);
  const dark = surf('trim', '#2b2c2e', 0.55, 0.5);
  const disc = surf('trim', '#55585c', 0.35, 0.85);
  const cap = surf('trim', '#d9dcdf', 0.12, 1);
  // Tyre: tread and rounded shoulders out to the bead, profile from the inner bead to the outer one.
  const sh = Math.min(0.06, (r - rimR) * 0.45);
  const tp: [number, number][] = [];
  const shoulder = (sgn: number) => {
    const n = hi ? 5 : 2;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI / 2;
      pts.push([r - sh + Math.cos(a) * sh, sgn * (w - sh + Math.sin(a) * sh)]);
    }
    return sgn > 0 ? pts : pts.reverse();
  };
  // Profile runs inner bead -> inner wall -> tread -> outer wall -> outer bead; lathe normals face outward.
  tp.push([rimR + 0.004, -w * 0.9]);
  if (hi) tp.push([rimR + (r - rimR) * 0.5, -w * 1.02]);
  tp.push(...shoulder(-1));
  tp.push(...shoulder(1));
  if (hi) tp.push([rimR + (r - rimR) * 0.5, w * 1.02]);
  tp.push([rimR + 0.004, w * 0.9]);
  // Lathe needs the profile ordered so its normals point away from the axle: revolve as given.
  // LatheGeometry's normal is (dy, -dx) of the profile: running inner -> outer bead puts it outward.
  const tyreGeo = latheX(tp, seg);
  m.geo(tyre, tyreGeo);
  // Sidewall ring (a slightly lighter band that catches the light).
  void wall;
  // Rim lip and barrel.
  const lip: [number, number][] = [[rimR - 0.018, w * 0.72], [rimR - 0.004, w * 0.92], [rimR + 0.006, w * 0.9]];
  m.geo(alloy, latheX(lip.reverse(), seg));
  // Seen from inside the rim bowl: run it outer -> inner so it faces the axle.
  const barrel: [number, number][] = [[rimR - 0.012, w * 0.7], [rimR - 0.012, -w * 0.85]];
  m.geo(dark, latheX(barrel, seg));
  // Brake disc behind the spokes.
  const dg = new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.8, 0.025, hi ? 32 : 10, 1, !hi).rotateZ(Math.PI / 2).translate(-w * 0.1, 0, 0);
  m.geo(disc, dg);
  const back = new THREE.CircleGeometry(rimR - 0.01, hi ? 32 : 10).rotateY(Math.PI / 2).translate(-w * 0.3, 0, 0);
  m.geo(dark, back);
  // Spokes: tapered, dished slightly towards the hub.
  const face = w * 0.66;
  const hubR = rimR * 0.3;
  const n = style.steel ? 0 : style.spokes;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const pair = style.double ? [-0.09, 0.09] : [0];
    for (const da of pair) {
      const ang = a + da;
      const wIn = (style.double ? 0.012 : 0.022) * (r / 0.32), wOut = (style.double ? 0.009 : 0.016) * (r / 0.32);
      const pts = (rr: number, hw: number, x: number) => {
        const c = Math.cos(ang), s = Math.sin(ang);
        return [new THREE.Vector3(x, c * rr - s * hw, s * rr + c * hw), new THREE.Vector3(x, c * rr + s * hw, s * rr - c * hw)];
      };
      const [i0, i1] = pts(hubR, wIn, face - style.dish), [o0, o1] = pts(rimR - 0.012, wOut, face);
      const [bi0, bi1] = pts(hubR, wIn, face - style.dish - 0.03), [bo0, bo1] = pts(rimR - 0.012, wOut, face - 0.03);
      m.quad(alloy, i1, o1, o0, i0);          // front face (+X)
      if (hi || !style.double) { m.quad(alloy, i0, o0, bo0, bi0); m.quad(alloy, o1, i1, bi1, bo1); }   // spoke sides
    }
  }
  // Steel wheels: a dished disc with hand holes, and a protruding hub with nuts.
  if (style.steel) {
    const plate = new THREE.RingGeometry(hubR, rimR - 0.01, hi ? 32 : 10).rotateY(Math.PI / 2).translate(face - 0.01, 0, 0);
    m.geo(alloy, plate);
    const holes = 8;
    for (let k = 0; k < holes; k++) {
      const a = (k / holes) * Math.PI * 2;
      const hole = new THREE.CircleGeometry(rimR * 0.13, hi ? 12 : 5).rotateY(Math.PI / 2).translate(face - 0.006, Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62);
      m.geo(dark, hole);
    }
    m.geo(alloy, new THREE.CylinderGeometry(hubR * 0.55, hubR * 0.9, 0.06, hi ? 20 : 8).rotateZ(-Math.PI / 2).translate(face + 0.02, 0, 0));
  }
  // Hub cap and nuts.
  m.geo(cap, new THREE.CylinderGeometry(hubR * 0.95, hubR, 0.02, hi ? 24 : 8, 1, !hi).rotateZ(-Math.PI / 2).translate(face - style.dish + 0.008, 0, 0));
  if (hi) for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    m.geo(cap, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6).rotateZ(-Math.PI / 2).translate(face - style.dish + 0.014, Math.cos(a) * hubR * 0.62, Math.sin(a) * hubR * 0.62));
  }
  return m;
}

function calliper(r: number, width: number): Mesher {
  const m = new Mesher();
  const s = surf('trim', '#9b1b1e', 0.4, 0.3);
  const rimR = r * 0.64;
  // Behind the spokes, at the back of the disc (towards the rear, a little above the axle).
  box(m, s, 0.05, 0.1, 0.09, { x: -width * 0.05, y: rimR * 0.55, z: -rimR * 0.5 }, new THREE.Euler(0.9, 0, 0), 0.015);
  return m;
}

// ---- build -----------------------------------------------------------------------------------------

export function buildBody(type: BodyType, spec: VehicleSpec, opts: BodyOptions, detail: Detail): BodyParts {
  SEG = detail === 'high' ? 2 : 1;
  switch (type) {
    case 'hatch': return buildCarBody(type, hatchParams(spec), spec, opts, detail);
    case 'suv': return buildCarBody(type, suvParams(spec), spec, opts, detail);
    case 'mpv': return buildCarBody(type, mpvParams(spec), spec, opts, detail);
    case 'bus': return buildBus(spec, opts, detail);
    case 'truck': return buildTruck(spec, opts, detail);
    default: return buildCarBody(type, sedanParams(spec), spec, opts, detail);
  }
}

function buildCarBody(type: BodyType, p: CarParams, spec: VehicleSpec, opts: BodyOptions, detail: Detail): BodyParts {
  const pal = palette(p.style);
  const m = new Mesher();
  const hi = detail === 'high';
  m.shade = (_x, y) => 0.6 + 0.4 * smooth(p.bottom, p.bottom + 0.32, y);
  const shell = carShell(p, detail, pal);
  shell.emit(m);
  m.shade = null;
  mirrors(m, shell, pal, p.mirrorZ);
  handles(m, shell, pal, p.handles, p.handleY, p.chrome.belt ? pal.chrome : pal.paintU);
  if (hi) wipers(m, shell, pal, p.cowl);
  plates(m, shell, pal, (p.front.plateT + p.front.plateB) / 2, (p.rear.plateT + p.rear.plateB) / 2);
  const halfW = Math.min(...p.width.map((w) => w[1])) - 0.06;
  underbody(m, pal, p.zRear - 0.02, p.zFront + 0.02, p.bottom + 0.004, halfW, p.arches, spec.wheels[0].x - spec.wheelWidth / 2 - 0.05, (z, y) => shell.sideAt(z, Math.max(y, p.bottom)).x - 0.004);
  if (p.cladding) for (const a of p.arches) archTrim(m, shell, pal.cladding, a, 0.075, detail);
  if (p.roofRails) roofRails(m, shell, pal, p.header - 0.05, p.rearHeader + 0.08);
  if (p.spoiler) spoiler(m, shell, pal, p.rearHeader);
  if (opts.roofSign) roofSign(m, shell, pal, (p.header + p.rearHeader) / 2 - 0.05);
  if (opts.beacons) lightBar(m, shell, pal, (p.header + p.rearHeader) / 2 + 0.02);
  if (opts.doorText) both((sx) => {
    const y0 = opts.doorTextHigh ? p.split + 0.03 : (p.split + p.doorBottom) / 2 - 0.035;
    sideDecal(m, shell, pal.door, -0.2, 0.74, y0, y0 + 0.14, 0.004, sx);
  });
  // Exhaust tip under the rear bumper.
  box(m, pal.satin, 0.09, 0.05, 0.12, { x: -0.52, y: p.rear.bottom + 0.035, z: p.zRear - 0.02 }, undefined, 0.02);
  const hs = shell.endAt(1, (p.headInner + 0.7) / 2, (p.front.lampTop + p.front.lampBot) / 2);
  const style: WheelStyle = { spokes: 5, double: true, steel: false, dish: 0.02 };
  const fw = spec.wheels[0].x;
  return {
    type, body: m,
    wheel: wheel(spec.wheelRadius, spec.wheelWidth, detail, style),
    wheelRear: null, dual: 0,
    calliper: hi ? calliper(spec.wheelRadius, spec.wheelWidth) : null,
    headlamps: [new THREE.Vector3(hs.x, hs.y, hs.z), new THREE.Vector3(-hs.x, hs.y, hs.z)],
    size: { length: p.zFront - p.zRear + 0.12, width: 2 * Math.max(fw + spec.wheelWidth / 2, ...p.width.map((w) => w[1])), height: Math.max(...p.crown.map((c) => c[1])) + spec.wheelRadius },
  };
}

// ---- boxy bodies (bus, truck) -----------------------------------------------------------------------

interface BoxRow { name: string; side: number; front: number; rear: number; hi?: boolean }
interface BoxDef {
  zRear: number; zFront: number;
  /** Half-width, height of the roof edge, how far the roof rounds up and in, crown height. */
  w: number; top: number; roofUp: number; inset: number; crown: number;
  frontRound: { len: number; end: number }; rearRound: { len: number; end: number };
  rows: BoxRow[];
  offSide(y: number, z: number): number; offFront(y: number, x: number): number; offRear(y: number, x: number): number;
  arches: { z: number; r: number; yc: number }[];
  zKeys: number[]; frontX: number[]; rearX: number[];
  wallClass(f: WallFace, row: (name: string) => number): Surf | null;
  capClass?(f: CapFace): Surf | null;
}

function boxShell(b: BoxDef, detail: Detail, pal: Pal): Shell {
  const hi = detail === 'high';
  const rows: WallRow[] = [{ name: 'top', side: (_z, t) => t, front: (_x, t) => t, rear: (_x, t) => t },
    ...b.rows.filter((r) => hi || !r.hi).map((r) => ({ name: r.name, side: () => r.side, front: (_x: number, t: number) => Math.min(r.front, t - 0.005), rear: (_x: number, t: number) => Math.min(r.rear, t - 0.005) }))];
  const idx = new Map(rows.map((r, i) => [r.name, i]));
  const row = (n: string) => idx.get(n) ?? -1;
  const T = hi ? [0, 0.08, 0.2, 0.35, 0.55, 0.75, 1] : [0, 0.2, 0.45, 0.75, 1];
  const xR = b.w - b.inset;
  const def: ShellDef = {
    zRear: b.zRear, zFront: b.zFront,
    section: () => ({ w: b.w, top: b.top, xD: xR, yD: b.top + b.roofUp, xR, yR: b.top + b.roofUp, yT: b.crown, crown: 3 }),
    frontRound: { ...b.frontRound, rows: hi ? 8 : 4 }, rearRound: { ...b.rearRound, rows: hi ? 8 : 4 },
    cols: { S: hi ? [0, 0.3, 0.6, 0.85, 1] : [0, 0.5, 1], G: [0, 1], T },
    frontX: edgeXs(b.frontX, T.length, xR * b.frontRound.end * 0.999), rearX: edgeXs(b.rearX, T.length, xR * b.rearRound.end * 0.999),
    rows, offSide: b.offSide, offFront: b.offFront, offRear: b.offRear, arches: b.arches,
    zKeys: [...b.zKeys, ...archKeys(b.arches, hi)], maxDz: hi ? 0.09 : 0.24,
    capClass: b.capClass ?? (() => pal.paintU),
    wallClass: (f) => b.wallClass(f, row),
    crease: 0.6,
  };
  return new Shell(def);
}

const isFront = (f: WallFace) => f.region === 'front' || (f.region === 'side' && f.wF > 0.5);
const isRear = (f: WallFace) => f.region === 'rear' || (f.region === 'side' && f.wR > 0.5);

/** A flat quad in a constant-x plane facing -X (the right side) or +X, face coords u along +z. */
function quadX(m: Mesher, s: Surf, x: number, z0: number, z1: number, y0: number, y1: number, facing: 1 | -1): void {
  if (facing < 0) m.quad(s, { x, y: y0, z: z0 }, { x, y: y0, z: z1 }, { x, y: y1, z: z1 }, { x, y: y1, z: z0 });
  else m.quad(s, { x, y: y0, z: z1 }, { x, y: y0, z: z0 }, { x, y: y1, z: z0 }, { x, y: y1, z: z1 });
}

/** Bus / truck wing mirror on a long arm from the front corner. */
function armMirror(m: Mesher, pal: Pal, root: THREE.Vector3Like, tip: THREE.Vector3Like, size: [number, number, number]): void {
  both((sx) => {
    const a = new THREE.Vector3(root.x, root.y, root.z), b = new THREE.Vector3(tip.x, tip.y + size[1] / 2, tip.z);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(0.015, 0.015, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    sided(m, pal.black, g, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), sx);
    sided(m, pal.black, new RoundedBoxGeometry(size[0], size[1], size[2], SEG, 0.02), new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z), sx);
    sided(m, pal.glassDark, new THREE.PlaneGeometry(size[0] - 0.03, size[1] - 0.03).rotateY(Math.PI), new THREE.Matrix4().makeTranslation(tip.x, tip.y, tip.z - size[2] / 2 - 0.002), sx);
  });
}

function buildBus(spec: VehicleSpec, opts: BodyOptions, detail: Detail): BodyParts {
  const pal = palette();
  const m = new Mesher();
  const hi = detail === 'high';
  const W = 1.265, zF = 5.55, zR = -6.35;
  const pillars = [4.6, 3.29, 1.98, 0.67, -0.64, -1.95, -3.26, -4.57];
  const winZ: [number, number] = [-5.85, 5.3];
  const inWin = (y: number) => y > 1.015 && y < 2.285;
  const def: BoxDef = {
    zRear: zR, zFront: zF, w: W, top: 2.46, roofUp: 0.11, inset: 0.09, crown: 2.62,
    frontRound: { len: 0.4, end: 0.86 }, rearRound: { len: 0.35, end: 0.88 },
    rows: [
      { name: 'roofBand', side: 2.36, front: 2.53, rear: 2.43 },
      { name: 'winTop', side: 2.28, front: 2.31, rear: 2.26 },
      { name: 'ws1', side: 1.9, front: 1.75, rear: 2.0, hi: true },
      { name: 'ws2', side: 1.45, front: 1.15, rear: 1.75 },
      { name: 'winBot', side: 1.02, front: 0.52, rear: 1.5 },
      { name: 'belt', side: 0.94, front: 0.44, rear: 1.42 },
      { name: 'stripeT', side: 0.64, front: 0.3, rear: 1.2 },
      { name: 'stripeB', side: 0.58, front: 0.1, rear: 0.35 },
      { name: 'skirtT', side: -0.06, front: 0.02, rear: 0.1 },
      { name: 'skirtB', side: -0.1, front: -0.1, rear: -0.05 },
      { name: 'bottom', side: -0.17, front: -0.17, rear: -0.17 },
    ],
    offSide: (y) => (inWin(y) ? -0.018 : 0) - 0.03 * smooth(0, -0.17, y),
    offFront: (y) => -0.14 * smooth(0.45, 2.31, y) + (y <= 0.03 && y >= -0.11 ? 0.06 : 0),
    offRear: (y) => (y <= 0.11 && y >= -0.06 ? 0.06 : 0),
    arches: [{ z: spec.wheels[0].z, r: 0.57, yc: 0.02 }, { z: spec.wheels[2].z, r: 0.6, yc: 0.02 }],
    zKeys: [...pillars.flatMap((z) => [z - 0.05, z + 0.05]), ...winZ, -6.2],
    frontX: [0.95, 0.62, 0.03], rearX: [0.88, 0.55],
    wallClass(f, row) {
      const k = f.k;
      const band = (a: string, b: string) => k >= row(a) && k < row(b);
      if (k < row('roofBand')) return pal.paintU;
      if (isFront(f)) {
        if (band('roofBand', 'winTop')) return f.x < 0.95 ? pal.dest : pal.black;
        if (band('winTop', 'winBot')) return f.x < 0.03 || f.x > 0.98 ? pal.black : pal.glass;
        if (band('winBot', 'belt')) return pal.black;
        if (band('stripeT', 'stripeB')) return f.x > 0.62 ? pal.busHead : pal.mesh;
        if (k >= row('skirtT')) return pal.black;
        return pal.paintL;
      }
      if (isRear(f)) {
        if (band('roofBand', 'winTop')) return f.x < 0.55 ? pal.dest : pal.paintU;
        if (band('winTop', 'winBot')) return f.x < 0.88 ? pal.glassDark : pal.paintU;
        if (band('winBot', 'belt')) return f.x < 0.88 ? pal.black : pal.paintU;
        if (band('stripeT', 'stripeB')) return f.x > 0.95 || f.region === 'side' ? pal.tail : f.x < 0.88 ? pal.vent : pal.paintL;
        if (k >= row('skirtT')) return pal.black;
        return pal.paintL;
      }
      if (band('roofBand', 'winTop') || band('winBot', 'belt')) return pal.black;
      if (band('winTop', 'winBot')) {
        if (f.z > winZ[1]) return pal.black;
        if (f.z < winZ[0]) return pal.paintU;
        for (const z of pillars) if (Math.abs(f.z - z) < 0.05) return pal.black;
        return pal.glass;
      }
      if (band('stripeT', 'stripeB')) return pal.satin;
      if (k >= row('skirtT')) return pal.black;
      return pal.paintL;
    },
  };
  m.shade = (_x, y) => 0.7 + 0.3 * smooth(-0.17, 0.5, y);
  const shell = boxShell(def, detail, pal);
  shell.emit(m);
  m.shade = null;
  // Doors on the kerb (right, -X) side: front door ahead of the front axle, one between the axles.
  for (const [z0, z1] of [[4.28, 5.26], [-1.2, 0.02]] as const) {
    const x = -W;
    quadX(m, pal.black, x - 0.004, z0, z1, -0.12, 2.3, -1);
    const mid = (z0 + z1) / 2;
    quadX(m, pal.glassDark, x - 0.008, z0 + 0.05, mid - 0.02, -0.05, 2.24, -1);
    quadX(m, pal.glassDark, x - 0.008, mid + 0.02, z1 - 0.05, -0.05, 2.24, -1);
    box(m, pal.satin, 0.02, 0.025, z1 - z0 - 0.12, { x: x - 0.014, y: 1.0, z: mid });
    box(m, pal.satin, 0.02, 0.025, z1 - z0 - 0.12, { x: x - 0.014, y: 0.35, z: mid });
  }
  // Air-conditioning pods and a roof hatch.
  box(m, pal.paintU, 1.9, 0.26, 2.5, { x: 0, y: 2.62 + 0.12, z: 1.4 }, undefined, 0.1, SEG + 1);
  box(m, pal.black, 1.5, 0.02, 2.0, { x: 0, y: 2.62 + 0.255, z: 1.4 });
  box(m, pal.paintU, 1.3, 0.2, 1.4, { x: 0, y: 2.62 + 0.09, z: -3.6 }, undefined, 0.08, SEG + 1);
  box(m, pal.black, 0.7, 0.06, 0.7, { x: 0, y: 2.64, z: -1.2 }, undefined, 0.02);
  armMirror(m, pal, { x: 1.18, y: 2.42, z: zF - 0.1 }, { x: 1.43, y: 1.95, z: zF + 0.18 }, [0.09, 0.34, 0.08]);
  // Wipers, plates, lettering.
  for (const x of [0.45, -0.5]) box(m, pal.black, 0.9, 0.02, 0.025, { x, y: 0.62, z: zF + 0.01 }, new THREE.Euler(0, 0, 0.45 * Math.sign(x)));
  plates(m, shell, pal, -0.04, 0.2);
  if (opts.doorText) both((sx) => sideDecal(m, shell, pal.door, -2.35, -1.3, 0.68, 0.9, 0.004, sx, 4));
  underbody(m, pal, zR, zF, -0.165, W - 0.05, def.arches, 0.62, (z, y) => shell.sideAt(z, Math.max(y, -0.17)).x - 0.004);
  const wheelStyle: WheelStyle = { spokes: 0, double: false, steel: true, dish: 0.03 };
  const hl = shell.endAt(1, 0.85, 0.2);
  return {
    type: 'bus', body: m,
    wheel: wheel(spec.wheelRadius, spec.wheelWidth, detail, wheelStyle),
    wheelRear: null, dual: 0.3,
    calliper: null,
    headlamps: [new THREE.Vector3(hl.x, hl.y, hl.z), new THREE.Vector3(-hl.x, hl.y, hl.z)],
    size: { length: zF - zR + 0.12, width: 2 * W + 0.3, height: 2.9 + spec.wheelRadius },
  };
}

function buildTruck(spec: VehicleSpec, opts: BodyOptions, detail: Detail): BodyParts {
  const pal = palette({ grille: 'grilleBars', head: 'head', tail: 'tail' });
  const m = new Mesher();
  const hi = detail === 'high';
  // Cab (cab-over, upper tone) and the cargo box (lower tone).
  const cabF = 2.92, cabR = 1.12, CW = 0.99;
  const glassIn = (y: number) => y > 1.045 && y < 1.855;
  const cab: BoxDef = {
    zRear: cabR, zFront: cabF, w: CW, top: 1.96, roofUp: 0.1, inset: 0.08, crown: 2.1,
    frontRound: { len: 0.24, end: 0.86 }, rearRound: { len: 0.06, end: 0.97 },
    rows: [
      { name: 'roofBand', side: 1.9, front: 1.95, rear: 1.9 },
      { name: 'winTop', side: 1.85, front: 1.88, rear: 1.82 },
      { name: 'ws1', side: 1.45, front: 1.5, rear: 1.55, hi: true },
      { name: 'winBot', side: 1.05, front: 1.12, rear: 1.3 },
      { name: 'belt', side: 0.98, front: 1.04, rear: 1.24 },
      { name: 'lampTop', side: 0.52, front: 0.42, rear: 0.6 },
      { name: 'lampBot', side: 0.44, front: 0.18, rear: 0.5 },
      { name: 'bumperT', side: 0.1, front: 0.1, rear: 0.1 },
      { name: 'bumperB', side: 0.0, front: -0.06, rear: 0.0 },
      { name: 'bottom', side: -0.1, front: -0.1, rear: -0.1 },
    ],
    offSide: (y) => (glassIn(y) ? -0.012 : 0) - 0.025 * smooth(0, -0.1, y),
    offFront: (y) => -0.16 * smooth(1.1, 1.88, y) + (y <= 0.11 && y >= -0.07 ? 0.06 : 0),
    offRear: () => 0,
    arches: [{ z: spec.wheels[0].z, r: 0.5, yc: 0.02 }],
    zKeys: [1.3, 1.31, 2.62, 2.63, 1.35, 2.6],
    frontX: [0.6, 0.45], rearX: [0.4],
    wallClass(f, row) {
      const k = f.k;
      const band = (a: string, b: string) => k >= row(a) && k < row(b);
      if (k < row('roofBand')) return pal.paintU;
      if (isFront(f)) {
        if (band('roofBand', 'winTop') || band('winBot', 'belt')) return pal.black;
        if (band('winTop', 'winBot')) return f.x > 0.9 ? pal.black : pal.glass;
        if (band('lampTop', 'lampBot')) return f.x > 0.6 ? pal.head : f.x < 0.45 ? pal.grille : pal.paintU;
        if (k >= row('bumperT')) return pal.black;
        return pal.paintU;
      }
      if (isRear(f)) {
        if (band('winTop', 'winBot') && f.x < 0.4) return pal.glassDark;
        return pal.paintU;
      }
      if (band('roofBand', 'winTop') || band('winBot', 'belt')) return pal.black;
      if (band('winTop', 'winBot')) return f.z > 2.62 ? pal.black : f.z > 1.35 ? pal.glass : pal.paintU;
      if (k < row('bumperT') && ((f.z0 >= 1.3 - 1e-4 && f.z1 <= 1.31 + 1e-4) || (f.z0 >= 2.62 - 1e-4 && f.z1 <= 2.63 + 1e-4))) return pal.seam;
      if (k >= row('bumperT')) return pal.black;
      return pal.paintU;
    },
  };
  const boxZ0 = -3.05, boxZ1 = 1.05, BW = 1.05;
  const cargo: BoxDef = {
    zRear: boxZ0, zFront: boxZ1, w: BW, top: 2.52, roofUp: 0.05, inset: 0.03, crown: 2.6,
    frontRound: { len: 0.06, end: 0.96 }, rearRound: { len: 0.06, end: 0.96 },
    rows: [
      { name: 'r1', side: 2.48, front: 2.48, rear: 2.48 },
      { name: 'r2', side: 0.72, front: 0.72, rear: 0.72 },
      { name: 'bottom', side: 0.62, front: 0.62, rear: 0.62 },
    ],
    offSide: () => 0, offFront: () => 0, offRear: () => 0,
    arches: [], zKeys: [], frontX: [], rearX: [],
    capClass: () => pal.paintL,
    wallClass(f, row) {
      if (f.k < row('r1') || f.k >= row('r2')) return pal.satin;
      if (isRear(f) && f.region === 'rear') return pal.rearDoor;
      return pal.paintL;
    },
  };
  m.shade = (_x, y) => 0.72 + 0.28 * smooth(-0.1, 0.6, y);
  const cabShell = boxShell(cab, detail, pal);
  cabShell.emit(m);
  const boxShellS = boxShell(cargo, detail, pal);
  boxShellS.emit(m);
  m.shade = null;
  // Box floor underside, chassis rails, fuel tank, guards, mudflaps, rear under-run bar and lamps.
  m.quad(pal.under, { x: BW, y: 0.62, z: boxZ1 }, { x: -BW, y: 0.62, z: boxZ1 }, { x: -BW, y: 0.62, z: boxZ0 }, { x: BW, y: 0.62, z: boxZ0 });
  both((sx) => {
    box(m, pal.black, 0.1, 0.24, 4.1, { x: 0.45 * sx, y: 0.28, z: -0.95 });
    box(m, pal.satin, 0.04, 0.04, 2.0, { x: 1.0 * sx, y: 0.28, z: 0.02 });
    box(m, pal.satin, 0.04, 0.04, 2.0, { x: 1.0 * sx, y: 0.46, z: 0.02 });
    box(m, pal.rubber, 0.56, 0.42, 0.02, { x: 0.8 * sx, y: 0.1, z: spec.wheels[2].z - 0.52 });
    box(m, pal.black, 0.62, 0.05, 1.1, { x: 0.8 * sx, y: 0.57, z: spec.wheels[2].z }, undefined, 0.02);
  });
  const tank = new THREE.CylinderGeometry(0.22, 0.22, 1.1, hi ? 20 : 10).rotateX(Math.PI / 2);
  m.geo(pal.satin, tank, new THREE.Matrix4().makeTranslation(0.72, 0.12, 0.0));
  box(m, pal.black, 2.0, 0.12, 0.1, { x: 0, y: -0.02, z: boxZ0 + 0.1 });
  for (const sx of [1, -1] as const) {
    const lamp = (s: Surf, x: number, w: number) => endQuad(m, s, { x: x * sx, y: 0.07, z: boxZ0 + 0.045 }, w, 0.09, -1);
    box(m, pal.black, 0.36, 0.12, 0.08, { x: 0.8 * sx, y: 0.07, z: boxZ0 + 0.09 });
    lamp(pal.tail, 0.86, 0.16); lamp(pal.amber, 0.7, 0.07); lamp(pal.reverse, 0.62, 0.06);
  }
  // Cab details: mirrors, roof marker lamps, a badge, the step, a handle.
  armMirror(m, pal, { x: 0.92, y: 1.6, z: cabF - 0.12 }, { x: 1.2, y: 1.45, z: cabF + 0.05 }, [0.08, 0.26, 0.07]);
  for (const x of [-0.35, 0, 0.35]) box(m, pal.amber, 0.09, 0.04, 0.05, { x, y: 2.12, z: cabF - 0.2 });
  box(m, pal.badge, 0.22, 0.08, 0.02, { x: 0, y: 0.78, z: cabF + 0.005 });
  handles(m, cabShell, pal, [1.45], 0.92, pal.black);
  // Lettering on both sides of the box, plates.
  if (opts.doorText) both((sx) => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const za = -2.7 + 3.4 * (i / n), zb = -2.7 + 3.4 * ((i + 1) / n);
      const u0 = sx > 0 ? 1 - i / n : i / n, u1 = sx > 0 ? 1 - (i + 1) / n : (i + 1) / n;
      const x = (BW + 0.004) * sx;
      const a = { x, y: 1.35, z: za }, b = { x, y: 1.35, z: zb }, c = { x, y: 1.95, z: zb }, d = { x, y: 1.95, z: za };
      const N = [sx, 0, 0, sx, 0, 0, sx, 0, 0];
      const P = (q: THREE.Vector3Like[]) => q.flatMap((v) => [v.x, v.y, v.z]);
      if (sx > 0) { m.tri(pal.sideText, P([a, c, b]), N, [u0, 0, u1, 1, u1, 0]); m.tri(pal.sideText, P([a, d, c]), N, [u0, 0, u0, 1, u1, 1]); }
      else { m.tri(pal.sideText, P([a, b, c]), N, [u0, 0, u1, 0, u1, 1]); m.tri(pal.sideText, P([a, c, d]), N, [u0, 0, u1, 1, u0, 1]); }
    }
  });
  endQuad(m, pal.plateF, { x: 0, y: 0.02, z: cabF + 0.07 }, 0.44, 0.14, 1);
  endQuad(m, pal.plateR, { x: 0, y: 0.26, z: boxZ0 - 0.005 }, 0.44, 0.14, -1);
  underbody(m, pal, cabR, cabF, -0.095, CW - 0.05, cab.arches, 0.6, (z, y) => cabShell.sideAt(z, Math.max(y, -0.1)).x - 0.004);
  const style: WheelStyle = { spokes: 0, double: false, steel: true, dish: 0.03 };
  const hl = cabShell.endAt(1, 0.78, 0.3);
  return {
    type: 'truck', body: m,
    wheel: wheel(spec.wheelRadius, spec.wheelWidth, detail, style),
    wheelRear: null, dual: 0.24,
    calliper: null,
    headlamps: [new THREE.Vector3(hl.x, hl.y, hl.z), new THREE.Vector3(-hl.x, hl.y, hl.z)],
    size: { length: cabF - boxZ0 + 0.1, width: 2 * BW, height: 2.6 + spec.wheelRadius },
  };
}

/** Bumper-to-bumper length from the chassis colliders: traffic gaps and spawn spacing. */
export function specLength(spec: VehicleSpec): number {
  let f = -Infinity, r = Infinity;
  for (const c of spec.chassis) { f = Math.max(f, c.at[2] + c.half[2]); r = Math.min(r, c.at[2] - c.half[2]); }
  return f - r;
}

/** Which body a spec belongs to (traffic and the player's car carry specs, not body names). */
export function bodyOfSpec(spec: VehicleSpec): BodyType {
  const n = spec.name as BodyType;
  return (BODY_TYPES as readonly string[]).includes(n) ? n : 'sedan';
}

export { clamp };
