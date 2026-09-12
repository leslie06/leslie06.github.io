import * as THREE from 'three';
import { J } from './Body';
import { bodyShape, BIND, HEAD_C, gradient, rayExit, snap, type BodyShape, type Sdf, type V3 } from './Sdf';

/**
 * One continuous skinned person, built procedurally at startup.
 *
 * The torso is a grid of horizontal rings projected onto the body's distance field (Sdf.ts). Each
 * side has a hole where the arm leaves; the arm tube starts from the hole's boundary loop (shared
 * vertices, so the shoulder is one manifold surface, no ball joint), blends to round rings along
 * the arm and ends in a hand. The legs start the same way from the two halves of the bottom ring
 * plus a crotch vertex. Junction vertices are relaxed onto the smooth union, so shoulders and hips
 * blend. The head is its own closed shell (the neck ends inside it); shoes, hair, cap brim, pony
 * tail and skirt/coat tail are separate pieces that the vertex shader shows or folds away per
 * person. Everything is in one geometry: one draw call per LOD.
 *
 * Per-vertex attributes (see CrowdShader for how they are read):
 *   position, normal   bind pose (A-pose), canonical 1.75 m male
 *   skinIndex/Weight   4 joints, smooth at shoulders, elbows, hips and knees
 *   aMorphF, aMorphH   blend shapes: body parts -> female / heavy; hair -> cap dome / long hair;
 *                      tail -> bun; skirt -> hem direction / heavy
 *   aDc                (part, along, ao, extra): along = metres down the limb from the shoulder or
 *                      hip; extra = per-part parameter (hair: thickness factor or curtain row, skirt: c)
 */
export const PART = { torso: 0, arm: 1, hand: 2, leg: 3, head: 4, shoe: 5, hair: 6, tail: 7, brim: 8, skirt: 9, curtain: 10, phone: 11 } as const;

export interface LodSpec {
  torsoM: number;
  torsoY: number[];
  /** First ring of the arm hole, its height in ring intervals and width in columns. */
  hole0: number; holeRings: number; holeCols: number;
  armT: number; armU: number[]; handU: number[];
  legT: number; legY: number[];
  headCols: number; headRings: number;
  shoeK: number; shoeZ: number[];
  hairCols: number; hairRows: number; curtainRows: number;
  tailK: number; tailRings: number;
  brimCols: number;
  skirtM: number; skirtC: number[];
  thumbs: boolean;
  phone: boolean;
}

export const NEAR: LodSpec = {
  torsoM: 20,
  torsoY: [0.845, 0.89, 0.945, 1.005, 1.06, 1.12, 1.18, 1.245, 1.325, 1.37, 1.415, 1.46, 1.505, 1.55, 1.595],
  hole0: 8, holeRings: 3, holeCols: 2,
  armT: 0.05, armU: [0.1, 0.25, 0.29, 0.33, 0.43, 0.535], handU: [0.58, 0.63, 0.675],
  legT: 0.125, legY: [0.76, 0.575, 0.5, 0.44, 0.33, 0.2, 0.13, 0.1],
  headCols: 20, headRings: 10,
  shoeK: 8, shoeZ: [-0.068, -0.045, 0.0, 0.07, 0.14, 0.192],
  hairCols: 16, hairRows: 5, curtainRows: 2,
  tailK: 6, tailRings: 4,
  brimCols: 8,
  skirtM: 16, skirtC: [0.33, 0.66, 1],
  thumbs: true, phone: true,
};

export const FAR: LodSpec = {
  torsoM: 10,
  torsoY: [0.85, 0.95, 1.07, 1.2, 1.325, 1.395, 1.46, 1.545],
  hole0: 4, holeRings: 2, holeCols: 1,
  armT: 0.06, armU: [0.13, 0.285, 0.535], handU: [0.62],
  legT: 0.13, legY: [0.72, 0.5, 0.3, 0.14, 0.1],
  headCols: 8, headRings: 5,
  shoeK: 5, shoeZ: [-0.065, 0.0, 0.1, 0.19],
  hairCols: 8, hairRows: 2, curtainRows: 1,
  tailK: 4, tailRings: 2,
  brimCols: 4,
  skirtM: 8, skirtC: [1],
  thumbs: false, phone: false,
};

/** Which field a vertex lives on (normals, relaxation). */
const SEL_BODY = 0, SEL_ARM = 1, SEL_LEG = 3, SEL_HEAD = 5, SEL_NONE = 6;

type Vec = V3;
const v3 = (x = 0, y = 0, z = 0): Vec => [x, y, z];
const addS = (a: Vec, b: Vec, s = 1): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** Geometry under construction. One build per shape; topology depends only on the LOD. */
export class Build {
  P: number[] = [];
  part: number[] = []; along: number[] = []; extra: number[] = []; side: number[] = []; sel: number[] = [];
  /** Explicit normals (shells), else NaN: computed from the field. */
  N: number[] = [];
  /** Explicit blend-shape deltas for shells (else computed from the female/heavy rebuilds). */
  XF: number[] = []; XH: number[] = []; explicit: number[] = [];
  I: number[] = [];
  relax = new Set<number>();
  /** Triangle ranges per piece, for orientation. */
  pieces: { from: number; to: number; sel: number }[] = [];
  holeCentre: Vec[] = [v3(), v3()]; holeRadius = [0, 0];

  vert(p: Vec, part: number, along: number, extra: number, side: number, sel: number): number {
    const i = this.P.length / 3;
    this.P.push(p[0], p[1], p[2]);
    this.part.push(part); this.along.push(along); this.extra.push(extra); this.side.push(side); this.sel.push(sel);
    this.N.push(NaN, NaN, NaN); this.XF.push(0, 0, 0); this.XH.push(0, 0, 0); this.explicit.push(0);
    return i;
  }
  pos(i: number): Vec { return [this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]]; }
  setPos(i: number, p: Vec): void { this.P[i * 3] = p[0]; this.P[i * 3 + 1] = p[1]; this.P[i * 3 + 2] = p[2]; }
  setN(i: number, n: Vec): void { this.N[i * 3] = n[0]; this.N[i * 3 + 1] = n[1]; this.N[i * 3 + 2] = n[2]; }
  tri(a: number, b: number, c: number): void { this.I.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.I.push(a, b, c, a, c, d); }
  begin(): number { return this.I.length / 3; }
  end(from: number, sel: number): void { this.pieces.push({ from, to: this.I.length / 3, sel }); }
}

/** Ray from o along d onto f; falls back to a short radius if the ray finds no surface. */
function project(f: Sdf, o: Vec, d: Vec, fallback = 0.03, tMax = 0.45): Vec {
  const t = rayExit(f, o, d, tMax);
  return addS(o, d, t < 0 ? fallback : t);
}

/** Horizontal rings stacked along y, projected from the torso axis. */
function torsoCentreZ(y: number): number {
  if (y > 1.45) return -0.02;
  if (y > 1.2) return -0.012;
  return -0.008;
}

interface Tube { rings: number[][]; }

/**
 * A limb tube that starts at an existing boundary `loop` of vertices, with ring angles measured
 * around the limb axis (origin o, direction a). Transition rings blend from the loop shape to the
 * limb's round section; clean rings are ray-projected onto the limb field.
 */
function tubeFromLoop(B: Build, shape: BodyShape, loop: number[], o: Vec, a: Vec, e1: Vec, e2In: Vec,
  trans: { u: number; blend: number }[], clean: { u: number; part: number }[], limb: Sdf, part: number, side: number, sel: number,
  relaxClean: number): Tube {
  const K = loop.length;
  let e2 = e2In;
  const angOf = (p: Vec, b2: Vec) => { const d = sub(p, o); const dp = addS(d, a, -dot(d, a)); return Math.atan2(dot(dp, b2), dot(dp, e1)); };
  // Loop direction around the axis: make the angles increase.
  let turn = 0;
  for (let j = 0; j < K; j++) {
    let dAng = angOf(B.pos(loop[(j + 1) % K]), e2) - angOf(B.pos(loop[j]), e2);
    while (dAng > Math.PI) dAng -= TAU; while (dAng < -Math.PI) dAng += TAU;
    turn += dAng;
  }
  if (turn < 0) e2 = [-e2[0], -e2[1], -e2[2]];
  const ang: number[] = [];
  let acc = angOf(B.pos(loop[0]), e2);
  ang.push(acc);
  for (let j = 1; j < K; j++) {
    let dAng = angOf(B.pos(loop[j]), e2) - angOf(B.pos(loop[j - 1]), e2);
    while (dAng > Math.PI) dAng -= TAU; while (dAng < -Math.PI) dAng += TAU;
    acc += dAng; ang.push(acc);
  }
  let off = 0;
  for (let j = 0; j < K; j++) off += ang[j] - (TAU * j) / K;
  off /= K;
  const uni = (j: number) => off + (TAU * j) / K;
  const dirAt = (psi: number): Vec => addS(addS(v3(), e1, Math.cos(psi)), e2, Math.sin(psi));
  const rings: number[][] = [loop];
  const total = trans.length + clean.length;
  let ri = 0;
  for (const t of trans) {
    ri++;
    const w = Math.min(1, ri / 2);
    const ring: number[] = [];
    for (let j = 0; j < K; j++) {
      const psi = ang[j] + (uni(j) - ang[j]) * w;
      const c = project(limb, addS(o, a, t.u), dirAt(psi), 0.04);
      const p = lerp3(B.pos(loop[j]), c, t.blend);
      const vi = B.vert(p, part, t.u, 0, side, sel);
      B.relax.add(vi);
      ring.push(vi);
    }
    rings.push(ring);
  }
  for (const c of clean) {
    ri++;
    const w = Math.min(1, ri / 2);
    const ring: number[] = [];
    for (let j = 0; j < K; j++) {
      const psi = ang[j] + (uni(j) - ang[j]) * w;
      const vi = B.vert(project(limb, addS(o, a, c.u), dirAt(psi), 0.03), c.part, c.u, 0, side, sel);
      if (ri <= trans.length + relaxClean) B.relax.add(vi);
      ring.push(vi);
    }
    rings.push(ring);
  }
  void total; void shape;
  for (let r = 0; r + 1 < rings.length; r++) {
    const A0 = rings[r], A1 = rings[r + 1];
    for (let j = 0; j < K; j++) B.quad(A0[j], A0[(j + 1) % K], A1[(j + 1) % K], A1[j]);
  }
  return { rings };
}

/** Close a tube with a pole vertex beyond its last ring, found along the axis. */
function capTube(B: Build, ring: number[], f: Sdf, o: Vec, a: Vec, part: number, along: number, side: number, sel: number): void {
  let c = v3();
  for (const i of ring) c = addS(c, B.pos(i), 1 / ring.length);
  const tip = project(f, c, a, 0.01, 0.12);
  const pi = B.vert(tip, part, along, 0, side, sel);
  for (let j = 0; j < ring.length; j++) B.tri(ring[j], ring[(j + 1) % ring.length], pi);
  void o;
}

/** Hairline height (bind pose, metres) around the head; `th` 0 = front, +-pi = back. Shared with the shader. */
export const HAIRLINE: [number, number][] = [[0, 1.724], [0.7, 1.708], [1.1, 1.686], [1.36, 1.674], [1.7, 1.682], [2.0, 1.66], [2.35, 1.626], [Math.PI, 1.603]];
export function hairlineY(th: number): number {
  const a = Math.min(Math.PI, Math.abs(th));
  for (let i = 1; i < HAIRLINE.length; i++) {
    if (a <= HAIRLINE[i][0]) { const [a0, y0] = HAIRLINE[i - 1], [a1, y1] = HAIRLINE[i]; return y0 + (y1 - y0) * smooth(0, 1, (a - a0) / (a1 - a0)); }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}
/** Lower edge of a baseball cap. */
export const capY = (th: number) => 1.652 + 0.056 * smooth(-0.8, 0.95, Math.cos(th));
export const CAP_T = 0.016;

const headDir = (phi: number, th: number): Vec => [Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th)];

/** Push p (horizontally) out of f until it is `margin` outside. */
function pushOut(f: Sdf, p: Vec, margin: number): Vec {
  const g: Vec = [0, 0, 0];
  for (let i = 0; i < 12; i++) {
    const d = f(p[0], p[1], p[2]);
    if (d >= margin) break;
    gradient(f, p[0], p[1], p[2], g);
    const h = Math.hypot(g[0], g[2]) || 1;
    p[0] += (g[0] / h) * (margin - d); p[2] += (g[2] / h) * (margin - d);
  }
  return p;
}

export interface Shapes { main: BodyShape; skirt: BodyShape; heavy: number }

/** Build one LOD for one body shape. Same topology for every shape. */
export function build(S: Shapes, L: LodSpec): Build {
  const B = new Build();
  const shape = S.main;
  const M = L.torsoM, R = L.torsoY.length;

  // ---- torso: rings from the crotch to inside the head, holes where the arms leave
  let from = B.begin();
  const grid: number[][] = [];
  for (let r = 0; r < R; r++) {
    const y = L.torsoY[r], zc = torsoCentreZ(y);
    const row: number[] = [];
    for (let k = 0; k < M; k++) {
      const th = (TAU * k) / M;
      const p = project(shape.trunk, [0, y, zc], [Math.sin(th), 0, Math.cos(th)], 0.05);
      row.push(B.vert(p, PART.torso, 0, 0, p[0] >= 0 ? 1 : -1, SEL_BODY));
    }
    grid.push(row);
  }
  const h0 = L.hole0, hi = L.holeRings, hs = L.holeCols;
  const c0s = [M / 4 - hs / 2, (3 * M) / 4 - hs / 2];
  const inHole = (r: number, k: number) => r >= h0 && r < h0 + hi && c0s.some((c0) => k >= c0 && k < c0 + hs);
  for (let r = 0; r + 1 < R; r++) {
    for (let k = 0; k < M; k++) {
      if (inHole(r, k)) continue;
      const k1 = (k + 1) % M;
      B.quad(grid[r][k], grid[r][k1], grid[r + 1][k1], grid[r + 1][k]);
    }
  }
  B.end(from, SEL_BODY);

  // ---- arms, from the hole loops
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1, c0 = c0s[s];
    const loop: number[] = [];
    for (let k = c0; k <= c0 + hs; k++) loop.push(grid[h0][k]);
    for (let r = h0 + 1; r < h0 + hi; r++) loop.push(grid[r][c0 + hs]);
    for (let k = c0 + hs; k >= c0; k--) loop.push(grid[h0 + hi][k]);
    for (let r = h0 + hi - 1; r > h0; r--) loop.push(grid[r][c0]);
    let cen = v3();
    for (const i of loop) cen = addS(cen, B.pos(i), 1 / loop.length);
    let rad = 0;
    for (const i of loop) rad += Math.hypot(...sub(B.pos(i), cen)) / loop.length;
    B.holeCentre[s] = cen; B.holeRadius[s] = rad;
    for (let r = h0 - 1; r <= h0 + hi + 1; r++) for (let k = c0 - 1; k <= c0 + hs + 1; k++) if (r >= 1 && r < R - 1) B.relax.add(grid[r][(k + M) % M]);
    const m = (v: Vec): Vec => [v[0] * side, v[1], v[2]];
    const o = m(BIND.shoulder), a = m(BIND.arm), out = m(BIND.out);
    from = B.begin();
    const clean = [...L.armU.map((u) => ({ u, part: PART.arm })), ...L.handU.map((u) => ({ u, part: PART.hand }))];
    const tube = tubeFromLoop(B, shape, loop, o, a, BIND.fwd, out, [{ u: L.armT, blend: 0.5 }], clean, shape.arm(side), PART.arm, side, SEL_ARM, 1);
    capTube(B, tube.rings[tube.rings.length - 1], shape.arm(side), o, a, PART.hand, 0.71, side, SEL_ARM);
    B.end(from, SEL_ARM);
  }

  // ---- legs, from the halves of the bottom ring and a crotch vertex
  const bottom = grid[0];
  const front = B.pos(bottom[0]), back = B.pos(bottom[M / 2]);
  const crotch = B.vert([0, Math.min(front[1], back[1]) - 0.04, (front[2] + back[2]) * 0.5], PART.torso, 0, 0, 1, SEL_BODY);
  B.relax.add(crotch);
  for (let k = 0; k < M; k++) { B.relax.add(grid[0][k]); B.relax.add(grid[1][k]); }
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    const loop: number[] = [];
    if (side > 0) { for (let k = 0; k <= M / 2; k++) loop.push(bottom[k]); }
    else { for (let k = M / 2; k <= M; k++) loop.push(bottom[k % M]); }
    loop.push(crotch);
    const o: Vec = [BIND.hip[0] * side, BIND.hip[1], BIND.hip[2]], a: Vec = [0, -1, 0];
    from = B.begin();
    const clean = L.legY.map((y) => ({ u: BIND.hip[1] - y, part: PART.leg }));
    const tube = tubeFromLoop(B, shape, loop, o, a, BIND.fwd, [side, 0, 0], [{ u: L.legT, blend: 0.5 }], clean, shape.leg(side), PART.leg, side, SEL_LEG, 1);
    capTube(B, tube.rings[tube.rings.length - 1], shape.leg(side), o, a, PART.leg, 0.86, side, SEL_LEG);
    B.end(from, SEL_LEG);
  }

  // ---- head: a warped sphere around the face, projected onto the head field
  from = B.begin();
  const hc = L.headCols, hr = L.headRings;
  const colTh = (c: number) => { const x = (2 * c) / hc - 1; return Math.PI * x * (0.6 + 0.4 * x * x); };
  const ringPhi = (i: number) => { const v = i / (hr + 1); return (155 / 180) * Math.PI * (v + (0.4 / TAU) * Math.sin(TAU * v)); };
  const hv = (p: Vec) => B.vert(p, PART.head, 0, 0, p[0] >= 0 ? 1 : -1, SEL_HEAD);
  const top = hv(project(shape.head, HEAD_C, [0, 1, 0]));
  const rows: number[][] = [];
  for (let i = 1; i <= hr; i++) {
    const row: number[] = [];
    for (let c = 0; c < hc; c++) row.push(hv(project(shape.head, HEAD_C, headDir(ringPhi(i), colTh(c)))));
    rows.push(row);
  }
  const bot = hv(project(shape.head, HEAD_C, [0, -1, 0.15]));
  for (let c = 0; c < hc; c++) {
    const c1 = (c + 1) % hc;
    B.tri(top, rows[0][c1], rows[0][c]);
    for (let i = 0; i + 1 < hr; i++) B.quad(rows[i][c], rows[i][c1], rows[i + 1][c1], rows[i + 1][c]);
    B.tri(rows[hr - 1][c], rows[hr - 1][c1], bot);
  }
  B.end(from, SEL_HEAD);

  buildHair(B, shape, L);
  buildShoes(B, L);
  if (L.thumbs) buildThumbs(B);
  if (L.phone) buildPhone(B);
  buildSkirt(B, S, L);
  finish(B, shape);
  return B;
}

function scalpAt(shape: BodyShape, phi: number, th: number): Vec { return project(shape.head, HEAD_C, headDir(phi, th)); }
function phiForY(shape: BodyShape, th: number, y: number): number {
  let lo = 0.05, hi = 2.9;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (scalpAt(shape, mid, th)[1] > y) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function buildHair(B: Build, shape: BodyShape, L: LodSpec): void {
  const C = L.hairCols, Jr = L.hairRows, Cr = L.curtainRows;
  const g: Vec = [0, 0, 0];
  const body = shape.body, head = shape.head;
  const around: Sdf = (x, y, z) => Math.min(body(x, y, z), head(x, y, z));
  let from = B.begin();
  const nAt = (p: Vec): Vec => gradient(head, p[0], p[1], p[2], g).slice() as Vec;
  const vtx = (p: Vec, n: Vec, part: number, extra: number) => { const i = B.vert(p, part, 0, extra, p[0] >= 0 ? 1 : -1, SEL_NONE); B.setN(i, n); B.explicit[i] = 3; return i; };
  const pole = scalpAt(shape, 0, 0);
  const poleI = vtx(pole, [0, 1, 0], PART.hair, 1);
  const capPole = addS(pole, [0, 1, 0], CAP_T);
  B.XF[poleI * 3 + 1] = capPole[1] - pole[1];
  const cols: number[][] = [];
  for (let c = 0; c < C; c++) {
    const th = (TAU * c) / C;
    const phH = phiForY(shape, th, hairlineY(th)), phC = phiForY(shape, th, capY(th));
    const col: number[] = [];
    let edge: Vec = v3(), edgeN: Vec = v3();
    for (let j = 1; j <= Jr; j++) {
      const t = j / Jr;
      const p = scalpAt(shape, phH * t, th), n = nAt(p);
      const i = vtx(p, n, PART.hair, j === Jr ? 0.5 : 1);
      const cp = scalpAt(shape, phC * t, th);
      const cn = nAt(cp);
      const capP = addS(cp, cn, CAP_T);
      B.XF[i * 3] = capP[0] - p[0]; B.XF[i * 3 + 1] = capP[1] - p[1]; B.XF[i * 3 + 2] = capP[2] - p[2];
      col.push(i);
      edge = p; edgeN = n;
    }
    // Curtain: folded onto the hairline unless the style lets it down (long hair, bob, fringe).
    const a = Math.abs(((th + Math.PI) % TAU) - Math.PI);
    const front = a < 0.95;
    const tipY = front ? 1.689 : a < 1.25 ? 1.5 : a < 1.75 ? 1.43 : 1.408;
    let hang = 0;
    for (let k = 0; k <= 40; k++) { const q = scalpAt(shape, (k / 40) * 2.2, th); hang = Math.max(hang, Math.hypot(q[0] - HEAD_C[0], q[2] - HEAD_C[2])); }
    const start = addS(edge, edgeN, 0.5 * 0.017);
    // Under a cap the hair edge hides beneath its band, except at the back where hair shows below it.
    const capEdge = scalpAt(shape, phC, th), capEdgeN = nAt(capEdge);
    const underCap = a < 2.3 ? addS(capEdge, capEdgeN, CAP_T * 0.3) : null;
    const tuckCap = (i: number) => { if (!underCap) return; const b = B.pos(i); B.XF[i * 3] = underCap[0] - b[0]; B.XF[i * 3 + 1] = underCap[1] - b[1]; B.XF[i * 3 + 2] = underCap[2] - b[2]; };
    for (let k = 1; k <= Cr; k++) {
      const t = k / Cr;
      const i = vtx(edge, edgeN, PART.curtain, t);
      let tgt: Vec;
      if (front) {
        tgt = [start[0], start[1] + (tipY - start[1]) * t, start[2]];
        pushOut(head, tgt, 0.007);
      } else {
        const y = start[1] + (tipY - start[1]) * t;
        const rr = Math.max(Math.hypot(start[0] - HEAD_C[0], start[2] - HEAD_C[2]), (hang + 0.028) * (0.62 + 0.42 * t));
        tgt = [HEAD_C[0] + Math.sin(th) * rr, y, HEAD_C[2] + Math.cos(th) * rr];
        pushOut(around, tgt, 0.024);
      }
      B.XH[i * 3] = tgt[0] - start[0]; B.XH[i * 3 + 1] = tgt[1] - start[1]; B.XH[i * 3 + 2] = tgt[2] - start[2];
      tuckCap(i);
      col.push(i);
    }
    const tp = scalpAt(shape, phH + 0.03, th), tn = nAt(tp);
    const ti = vtx(addS(tp, tn, -0.001), tn, PART.hair, 0);
    tuckCap(ti);
    col.push(ti);
    cols.push(col);
  }
  for (let c = 0; c < C; c++) {
    const c1 = (c + 1) % C, A0 = cols[c], A1 = cols[c1];
    B.tri(poleI, A1[0], A0[0]);
    for (let j = 0; j + 1 < A0.length; j++) B.quad(A0[j], A1[j], A1[j + 1], A0[j + 1]);
  }
  B.end(from, SEL_NONE);

  // ---- pony tail (bun as its blend shape)
  from = B.begin();
  const K = L.tailK, NR = L.tailRings;
  const gather = scalpAt(shape, 1.72, Math.PI);
  const pts: Vec[] = [], radii: number[] = [];
  for (let i = 0; i < NR; i++) {
    const t = i / (NR - 1);
    const p: Vec = [0, gather[1] + 0.01 - 0.23 * t, gather[2] - 0.018 - 0.05 * Math.sin(t * 2.2)];
    pushOut(around, p, 0.03 * (1 - t) + 0.02);
    pts.push(p); radii.push(0.02 + 0.014 * Math.sin(Math.min(1, t * 1.4) * Math.PI) * (1 - t * 0.3) + (i === NR - 1 ? -0.012 : 0));
  }
  const bunC: Vec = [0, gather[1] + 0.03, gather[2] - 0.03], bunR = 0.036;
  const tail: number[][] = [];
  for (let i = 0; i < NR; i++) {
    const ring: number[] = [];
    const lat = (i / NR) * Math.PI;
    for (let k = 0; k < K; k++) {
      const ang = (TAU * k) / K;
      const d: Vec = [Math.cos(ang), 0, Math.sin(ang)];
      const p = addS(pts[i], d, Math.max(0.004, radii[i]));
      const ix = vtx(p, d, PART.tail, i / (NR - 1));
      const bp = addS(bunC, [Math.cos(ang) * Math.sin(lat), Math.cos(lat), Math.sin(ang) * Math.sin(lat)], bunR);
      B.XF[ix * 3] = bp[0] - p[0]; B.XF[ix * 3 + 1] = bp[1] - p[1]; B.XF[ix * 3 + 2] = bp[2] - p[2];
      ring.push(ix);
    }
    tail.push(ring);
  }
  const tipP = addS(pts[NR - 1], [0, -1, 0], 0.02);
  const tipI = vtx(tipP, [0, -1, 0], PART.tail, 1);
  const bunTip = addS(bunC, [0, -1, 0], bunR);
  B.XF[tipI * 3] = bunTip[0] - tipP[0]; B.XF[tipI * 3 + 1] = bunTip[1] - tipP[1]; B.XF[tipI * 3 + 2] = bunTip[2] - tipP[2];
  for (let i = 0; i + 1 < NR; i++) for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; B.quad(tail[i][k], tail[i][k1], tail[i + 1][k1], tail[i + 1][k]); }
  for (let k = 0; k < K; k++) B.tri(tail[NR - 1][k], tail[NR - 1][(k + 1) % K], tipI);
  B.end(from, SEL_NONE);

  // ---- cap brim
  from = B.begin();
  const BC = L.brimCols, inner: number[] = [], outer: number[] = [];
  for (let c = 0; c <= BC; c++) {
    const th = (c / BC - 0.5) * 2.5;
    const phC = phiForY(shape, th, capY(th));
    const cp = scalpAt(shape, phC, th), n = nAt(cp);
    const p = addS(addS(cp, n, CAP_T), [0, -1, 0], 0.003);
    const ext = 0.078 * Math.pow(Math.max(0, Math.cos(th * 0.72)), 1.2) + 0.004;
    const dir: Vec = norm([Math.sin(th) * 0.55, -0.16, Math.cos(th)]);
    const up: Vec = [0, 1, 0];
    inner.push(vtx(p, up, PART.brim, 0));
    outer.push(vtx(addS(p, dir, ext), up, PART.brim, 1));
  }
  for (let c = 0; c < BC; c++) B.quad(inner[c], inner[c + 1], outer[c + 1], outer[c]);
  B.end(from, SEL_NONE);
}

function buildShoes(B: Build, L: LodSpec): void {
  const tbl = [[-0.078, 0.027, 0.07], [-0.058, 0.035, 0.095], [-0.02, 0.04, 0.1], [0.03, 0.044, 0.085], [0.08, 0.048, 0.064], [0.13, 0.046, 0.05], [0.17, 0.037, 0.04], [0.197, 0.018, 0.03]];
  const at = (z: number, col: number) => {
    for (let i = 1; i < tbl.length; i++) if (z <= tbl[i][0]) { const t = (z - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0]); return tbl[i - 1][col] + (tbl[i][col] - tbl[i - 1][col]) * t; }
    return tbl[tbl.length - 1][col];
  };
  const K = L.shoeK;
  const se = (c: number, e: number) => Math.sign(c) * Math.pow(Math.abs(c), e);
  for (const side of [1, -1]) {
    const from = B.begin();
    const rings: number[][] = [];
    for (const z of L.shoeZ) {
      const w = at(z, 1), h = at(z, 2);
      const cx = (0.088 + 0.012 * Math.max(0, z) / 0.2) * side;
      const ring: number[] = [];
      for (let k = 0; k < K; k++) {
        const b = (TAU * (k + 0.5)) / K;
        const x = cx + w * se(Math.cos(b), 0.6) * side, y = Math.max(0.0, h * 0.5 * (1 + se(Math.sin(b), 0.5)));
        ring.push(B.vert([x, y, z], PART.shoe, z, 0, side, SEL_NONE));
      }
      rings.push(ring);
    }
    for (let r = 0; r + 1 < rings.length; r++) for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; B.quad(rings[r][k], rings[r][k1], rings[r + 1][k1], rings[r + 1][k]); }
    const z0 = L.shoeZ[0], z1 = L.shoeZ[L.shoeZ.length - 1];
    const heel = B.vert([0.088 * side, at(z0, 2) * 0.45, z0 - 0.008], PART.shoe, z0, 0, side, SEL_NONE);
    const toe = B.vert([(0.088 + 0.012) * side, at(z1, 2) * 0.4, z1 + 0.006], PART.shoe, z1, 0, side, SEL_NONE);
    const f = rings[0], l = rings[rings.length - 1];
    for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; B.tri(f[k1], f[k], heel); B.tri(l[k], l[k1], toe); }
    B.end(from, SEL_NONE);
  }
}

function buildThumbs(B: Build): void {
  for (const side of [1, -1]) {
    const m = (v: Vec): Vec => [v[0] * side, v[1], v[2]];
    const A = m(BIND.arm), O = m(BIND.out), F = BIND.fwd, W = m(BIND.wrist);
    const t0 = addS(addS(addS(W, A, 0.02), F, 0.026), O, -0.008), t1 = addS(addS(addS(W, A, 0.085), F, 0.046), O, -0.026);
    const ax = norm(sub(t1, t0));
    const u = norm(cross(ax, O)), w = norm(cross(ax, u));
    const from = B.begin();
    const rings: number[][] = [];
    const K = 5, NR = 3;
    for (let i = 0; i < NR; i++) {
      const t = i / (NR - 1), c = lerp3(t0, t1, t), r = 0.0125 - 0.003 * t;
      const ring: number[] = [];
      for (let k = 0; k < K; k++) {
        const ang = (TAU * k) / K;
        const d = addS(addS(v3(), u, Math.cos(ang)), w, Math.sin(ang));
        const vi = B.vert(addS(c, d, r), PART.hand, 0.56, 0, side, SEL_NONE);
        B.setN(vi, d); B.explicit[vi] = 3;
        ring.push(vi);
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < NR; i++) for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; B.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]); }
    const tip = B.vert(addS(t1, ax, 0.009), PART.hand, 0.56, 0, side, SEL_NONE);
    B.setN(tip, ax); B.explicit[tip] = 3;
    for (let k = 0; k < K; k++) B.tri(rings[NR - 1][k], rings[NR - 1][(k + 1) % K], tip);
    B.end(from, SEL_NONE);
  }
}

/** A phone in the right palm (shown only while the gait holds one). */
function buildPhone(B: Build): void {
  const side = -1, m = (v: Vec): Vec => [v[0] * side, v[1], v[2]];
  const A = m(BIND.arm), O = m(BIND.out), F = BIND.fwd, W = m(BIND.wrist);
  const N: Vec = [-O[0], -O[1], -O[2]];
  const c = addS(addS(W, A, 0.085), N, 0.022);
  const h: [Vec, number][] = [[A, 0.07], [F, 0.034], [N, 0.0045]];
  const from = B.begin();
  for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) {
    const n: Vec = [h[ax][0][0] * sg, h[ax][0][1] * sg, h[ax][0][2] * sg];
    const u = h[(ax + 1) % 3], w = h[(ax + 2) % 3];
    const fc = addS(c, h[ax][0], h[ax][1] * sg);
    const q: number[] = [];
    for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const i = B.vert(addS(addS(fc, u[0], u[1] * su), w[0], w[1] * sw), PART.phone, 0.6, ax === 2 && sg > 0 ? 1 : 0, side, SEL_NONE);
      B.setN(i, n); B.explicit[i] = 3; q.push(i);
    }
    B.quad(q[0], q[1], q[2], q[3]);
  }
  B.end(from, SEL_NONE);
}

function buildSkirt(B: Build, S: Shapes, L: LodSpec): void {
  const trunk = S.skirt.trunk, K = L.skirtM, hk = 1 + 0.18 * S.heavy;
  const from = B.begin();
  const rings: number[][] = [];
  const se = (c: number, e: number) => Math.sign(c) * Math.pow(Math.abs(c), e);
  const waist: number[] = [], hip: number[] = [];
  const hips: Vec[] = [], hems: Vec[] = [];
  for (let k = 0; k < K; k++) {
    const th = (TAU * k) / K, d: Vec = [Math.sin(th), 0, Math.cos(th)];
    const wp = addS(project(trunk, [0, 1.0, -0.01], d), d, -0.012);
    const hp = addS(project(trunk, [0, 0.87, -0.01], d), d, 0.035);
    const hem: Vec = [0.245 * hk * se(Math.sin(th), 0.75), 0.43, -0.005 + 0.215 * hk * se(Math.cos(th), 0.75)];
    const wi = B.vert(wp, PART.skirt, 0, -0.3, wp[0] >= 0 ? 1 : -1, SEL_NONE);
    const hI = B.vert(hp, PART.skirt, 0, 0, hp[0] >= 0 ? 1 : -1, SEL_NONE);
    for (const i of [wi, hI]) { B.setN(i, d); B.explicit[i] = 1; }
    const dir = sub(hem, hp);
    B.XF[hI * 3] = dir[0]; B.XF[hI * 3 + 1] = dir[1]; B.XF[hI * 3 + 2] = dir[2];
    waist.push(wi); hip.push(hI); hips.push(hp); hems.push(hem);
  }
  rings.push(waist, hip);
  for (const c of L.skirtC) {
    const ring: number[] = [];
    for (let k = 0; k < K; k++) {
      const th = (TAU * k) / K, dir = sub(hems[k], hips[k]);
      const p = addS(hips[k], dir, c);
      const bulge = 0.045 * Math.sin(Math.PI * Math.min(1, c * 1.15));
      p[0] += Math.sin(th) * bulge; p[2] += Math.cos(th) * bulge;
      const i = B.vert(p, PART.skirt, 0, c, p[0] >= 0 ? 1 : -1, SEL_NONE);
      B.setN(i, norm([Math.sin(th), 0.25, Math.cos(th)])); B.explicit[i] = 1;
      B.XF[i * 3] = dir[0]; B.XF[i * 3 + 1] = dir[1]; B.XF[i * 3 + 2] = dir[2];
      ring.push(i);
    }
    rings.push(ring);
  }
  for (let r = 0; r + 1 < rings.length; r++) for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; B.quad(rings[r][k], rings[r][k1], rings[r + 1][k1], rings[r + 1][k]); }
  B.end(from, SEL_NONE);
}

/** Relax the shoulder/hip junctions onto the smooth union, then normals, orientation and occlusion. */
function finish(B: Build, shape: BodyShape): void {
  const nV = B.P.length / 3;
  const nb: Set<number>[] = Array.from({ length: nV }, () => new Set<number>());
  for (let t = 0; t < B.I.length; t += 3) {
    const a = B.I[t], b = B.I[t + 1], c = B.I[t + 2];
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }
  const relax = [...B.relax];
  for (let it = 0; it < 4; it++) {
    const next = relax.map((i) => {
      let c = v3();
      for (const j of nb[i]) c = addS(c, B.pos(j), 1 / nb[i].size);
      return lerp3(B.pos(i), c, 0.5);
    });
    relax.forEach((i, k) => B.setPos(i, snap(shape.body, next[k])));
  }
  // Field normals for the body; shells either set theirs or get mesh normals below.
  const g: Vec = [0, 0, 0];
  for (let i = 0; i < nV; i++) {
    if (!Number.isNaN(B.N[i * 3]) || B.sel[i] === SEL_NONE) continue;
    const s = B.sel[i], p = B.pos(i);
    const f = B.relax.has(i) ? shape.body : s === SEL_ARM ? shape.arm(B.side[i]) : s === SEL_LEG ? shape.leg(B.side[i]) : s === SEL_HEAD ? shape.head : shape.trunk;
    gradient(f, p[0], p[1], p[2], g);
    B.setN(i, [g[0], g[1], g[2]]);
  }
  // Orientation: outward per triangle for the body, per piece for shells (their folded parts are degenerate).
  for (const pc of B.pieces) {
    let cen = v3(), cnt = 0;
    for (let t = pc.from; t < pc.to; t++) for (let k = 0; k < 3; k++) { cen = addS(cen, B.pos(B.I[t * 3 + k])); cnt++; }
    cen = [cen[0] / cnt, cen[1] / cnt, cen[2] / cnt];
    const need: (boolean | null)[] = [];
    let flip = 0, keep = 0;
    for (let t = pc.from; t < pc.to; t++) {
      const a = B.I[t * 3], b = B.I[t * 3 + 1], c = B.I[t * 3 + 2];
      const pa = B.pos(a), fn = cross(sub(B.pos(b), pa), sub(B.pos(c), pa));
      if (Math.hypot(...fn) < 1e-10) { need.push(null); continue; }
      let ref: Vec;
      if (Number.isNaN(B.N[a * 3]) || Number.isNaN(B.N[b * 3]) || Number.isNaN(B.N[c * 3])) {
        ref = sub(lerp3(lerp3(pa, B.pos(b), 0.5), B.pos(c), 1 / 3), cen);
      } else ref = addS(addS(B.pos(a).map((_, k) => B.N[a * 3 + k]) as Vec, B.pos(b).map((_, k) => B.N[b * 3 + k]) as Vec), B.pos(c).map((_, k) => B.N[c * 3 + k]) as Vec);
      const bad = dot(fn, ref) < 0;
      need.push(bad);
      if (bad) flip++; else keep++;
    }
    const majority = flip > keep, perTri = pc.sel !== SEL_NONE;
    for (let t = pc.from; t < pc.to; t++) {
      const nd = need[t - pc.from];
      if (nd === null ? majority : perTri ? nd : majority) { const x = B.I[t * 3 + 1]; B.I[t * 3 + 1] = B.I[t * 3 + 2]; B.I[t * 3 + 2] = x; }
    }
  }
  // Mesh normals where none were given (shoes).
  const acc = new Float64Array(nV * 3);
  for (let t = 0; t < B.I.length; t += 3) {
    const a = B.I[t], b = B.I[t + 1], c = B.I[t + 2];
    const pa = B.pos(a), fn = cross(sub(B.pos(b), pa), sub(B.pos(c), pa));
    for (const v of [a, b, c]) { acc[v * 3] += fn[0]; acc[v * 3 + 1] += fn[1]; acc[v * 3 + 2] += fn[2]; }
  }
  for (let i = 0; i < nV; i++) if (Number.isNaN(B.N[i * 3])) B.setN(i, norm([acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]]));
}

/** Ambient occlusion from the field (5 samples along the normal), plus the arms' shade on the flanks. */
function occlusion(B: Build, i: number, all: Sdf): number {
  const part = B.part[i];
  if (part === PART.curtain) return 0.82;
  if (part === PART.brim) return 0.92;
  if (part === PART.skirt) return 0.78 + 0.2 * smooth(-0.3, 0.3, B.extra[i]);
  const p = B.pos(i), n: Vec = [B.N[i * 3], B.N[i * 3 + 1], B.N[i * 3 + 2]];
  let occ = 0, w = 1;
  for (let k = 1; k <= 5; k++) {
    const h = 0.004 + 0.013 * k;
    occ += (h - Math.min(h, all(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h))) * w;
    w *= 0.6;
  }
  let ao = Math.max(0.3, Math.min(1, 1 - 3.2 * occ));
  if (part === PART.torso) {
    // Arms hang against the flanks most of the time (the bind pose has them out).
    const side = Math.abs(n[0]) * smooth(1.05, 1.18, p[1]) * (1 - smooth(1.3, 1.36, p[1]));
    ao *= 1 - 0.25 * side * side;
  }
  if (part === PART.arm) ao *= 1 - 0.18 * Math.max(0, -n[0] * Math.sign(p[0])) * (1 - smooth(0.2, 0.45, B.along[i]));
  return ao;
}

const _w = new Float64Array(17);
/** Up to four joint weights for vertex i. */
function weights(B: Build, i: number, idx: number[], wt: number[]): void {
  _w.fill(0);
  const part = B.part[i], p = B.pos(i), side = B.side[i], u = B.along[i], ex = B.extra[i];
  const L = side > 0;
  const jS = L ? J.shoulderL : J.shoulderR, jE = L ? J.elbowL : J.elbowR, jW = L ? J.wristL : J.wristR;
  const jH = L ? J.hipL : J.hipR, jK = L ? J.kneeL : J.kneeR, jA = L ? J.ankleL : J.ankleR;
  const spine = (y: number, s: number) => {
    const s1 = smooth(0.99, 1.08, y), s2 = smooth(1.16, 1.25, y), s3 = smooth(1.44, 1.51, y), s4 = smooth(1.545, 1.6, y);
    _w[J.pelvis] += s * (1 - s1); _w[J.spine] += s * (s1 - s2); _w[J.chest] += s * (s2 - s3); _w[J.neck] += s * (s3 - s4); _w[J.head] += s * s4;
  };
  const scale = (k: number) => { for (let j = 0; j < 17; j++) _w[j] *= k; };
  switch (part) {
    case PART.torso: {
      spine(p[1], 1);
      const s = p[0] >= 0 ? 0 : 1;
      const d = Math.hypot(...sub(p, B.holeCentre[s])) - B.holeRadius[s];
      const wa = 0.42 * (1 - smooth(-0.005, 0.06, d));
      if (wa > 0) { scale(1 - wa); _w[s === 0 ? J.shoulderL : J.shoulderR] += wa; }
      const wl = 0.36 * (1 - smooth(0.835, 0.95, p[1]));
      if (wl > 0) { scale(1 - wl); const sl = smooth(-0.05, 0.05, p[0]); _w[J.hipL] += wl * sl; _w[J.hipR] += wl * (1 - sl); }
      break;
    }
    case PART.arm: case PART.hand: {
      const sc = smooth(-0.01, 0.11, u), wf = smooth(0.25, 0.32, u), wh = smooth(0.515, 0.56, u);
      _w[J.chest] += 1 - sc; _w[jS] += sc * (1 - wf); _w[jE] += sc * (wf - wh); _w[jW] += sc * wh;
      break;
    }
    case PART.leg: {
      const sc = smooth(0.05, 0.17, u), ws = smooth(0.39, 0.46, u), wa = smooth(0.79, 0.83, u);
      _w[J.pelvis] += 1 - sc; _w[jH] += sc * (1 - ws); _w[jK] += sc * (ws - wa); _w[jA] += sc * wa;
      break;
    }
    case PART.head: case PART.hair: case PART.brim: _w[J.head] = 1; break;
    case PART.curtain: {
      const th = Math.atan2(p[0] - HEAD_C[0], p[2] - HEAD_C[2]);
      const c = 0.55 * ex * smooth(0.8, 1.25, Math.abs(th));
      _w[J.head] = 1 - c; _w[J.chest] = c;
      break;
    }
    case PART.tail: _w[J.head] = 1 - 0.35 * ex; _w[J.neck] = 0.35 * ex; break;
    case PART.shoe: _w[jA] = 1; break;
    case PART.phone: _w[jW] = 1; break;
    case PART.skirt: {
      const c = Math.max(0, ex), sl = smooth(-0.1, 0.1, p[0]);
      _w[J.pelvis] = 1 - 0.85 * c; _w[J.hipL] = 0.85 * c * sl; _w[J.hipR] = 0.85 * c * (1 - sl);
      break;
    }
  }
  idx.length = 0; wt.length = 0;
  for (let k = 0; k < 4; k++) {
    let best = -1, bw = 0;
    for (let j = 0; j < 17; j++) if (_w[j] > bw && !idx.includes(j)) { bw = _w[j]; best = j; }
    if (best < 0 || bw < 1e-4) { idx.push(0); wt.push(0); continue; }
    idx.push(best); wt.push(bw);
  }
  const s = wt[0] + wt[1] + wt[2] + wt[3] || 1;
  for (let k = 0; k < 4; k++) wt[k] /= s;
}

export interface GeoStats { vertices: number; triangles: number; ms: number }

/** The skinned crowd geometry for one LOD (bind pose + blend shapes + weights). */
export function makeGeometry(L: LodSpec, stats?: GeoStats): THREE.InstancedBufferGeometry {
  const t0 = performance.now();
  const base = build({ main: bodyShape(0, 0), skirt: bodyShape(1, 0), heavy: 0 }, L);
  const fem = build({ main: bodyShape(1, 0), skirt: bodyShape(1, 0), heavy: 0 }, L);
  const hvy = build({ main: bodyShape(0, 1), skirt: bodyShape(1, 1), heavy: 1 }, L);
  const all = bodyShape(0, 0).all;
  const nV = base.P.length / 3;
  const map = new Int32Array(nV).fill(-1);
  let n = 0;
  for (const i of base.I) if (map[i] < 0) map[i] = n++;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), mf = new Float32Array(n * 3), mh = new Float32Array(n * 3);
  const dc = new Float32Array(n * 4), ji = new Uint8Array(n * 4), jw = new Float32Array(n * 4);
  const idx: number[] = [], wt: number[] = [];
  for (let i = 0; i < nV; i++) {
    const o = map[i];
    if (o < 0) continue;
    for (let k = 0; k < 3; k++) {
      pos[o * 3 + k] = base.P[i * 3 + k];
      nrm[o * 3 + k] = base.N[i * 3 + k];
      mf[o * 3 + k] = base.explicit[i] & 1 ? base.XF[i * 3 + k] : fem.P[i * 3 + k] - base.P[i * 3 + k];
      mh[o * 3 + k] = base.explicit[i] & 2 ? base.XH[i * 3 + k] : hvy.P[i * 3 + k] - base.P[i * 3 + k];
    }
    dc[o * 4] = base.part[i]; dc[o * 4 + 1] = base.along[i]; dc[o * 4 + 2] = occlusion(base, i, all); dc[o * 4 + 3] = base.extra[i];
    weights(base, i, idx, wt);
    for (let k = 0; k < 4; k++) { ji[o * 4 + k] = idx[k]; jw[o * 4 + k] = wt[k]; }
  }
  const index = new Uint16Array(base.I.length);
  for (let k = 0; k < base.I.length; k++) index[k] = map[base.I[k]];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aMorphF', new THREE.BufferAttribute(mf, 3));
  g.setAttribute('aMorphH', new THREE.BufferAttribute(mh, 3));
  g.setAttribute('aDc', new THREE.BufferAttribute(dc, 4));
  g.setAttribute('dcJoint', new THREE.BufferAttribute(ji, 4));
  g.setAttribute('dcWeight', new THREE.BufferAttribute(jw, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -1e5), new THREE.Vector3(1e5, 1e5, 1e5));
  if (stats) { stats.vertices = n; stats.triangles = index.length / 3; stats.ms = performance.now() - t0; }
  return g;
}

let cache: { near: THREE.InstancedBufferGeometry; far: THREE.InstancedBufferGeometry } | null = null;
/** Both LODs, built once per page. */
export function crowdGeometries(): { near: THREE.InstancedBufferGeometry; far: THREE.InstancedBufferGeometry } {
  if (!cache) cache = { near: makeGeometry(NEAR), far: makeGeometry(FAR) };
  return cache;
}
