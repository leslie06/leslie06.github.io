import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import type { SurfaceType } from '../core/Events';
import type { Batcher } from './Batch';
import { box, boxMM, jaggedWall, prep, tube, type GeoOpts } from './Geo';
import { DECAL, type SignAtlas } from './Canvas';
import { aoStrip, decal, pocks, shellHole } from './Props';

/** Shared constants — scale is tuned for a 1.8 m player. */
export const FH = 3.24;   // floor-to-floor (18 risers × 0.18)
export const T = 0.35;    // exterior wall thickness
export const SLAB = 0.25; // slab thickness
export const RISER = 0.18, TREAD = 0.28, STEPS = 9; // per run (U-stair, 2 runs per floor)
export const RUN = STEPS * TREAD; // 2.52
export const STAIR_W = 2.6, STAIR_D = 4.1;

export interface BuildCtx {
  batch: Batcher;
  rng: Rng;
  signs: SignAtlas;
  collideBox(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface: SurfaceType, rotY?: number): void;
  collideQuat(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface: SurfaceType, q: THREE.Quaternion): void;
  collideMesh(geo: THREE.BufferGeometry, surface: SurfaceType): void;
}

export type OpeningKind = 'window' | 'door' | 'shop' | 'arch' | 'hole';
export type OpeningState = 'glass' | 'broken' | 'boarded' | 'shutter' | 'open' | 'missing' | 'closed' | 'halfShutter' | 'none';
export interface Opening {
  /** absolute world coordinate along the wall axis */
  u0: number; u1: number;
  /** absolute world y */
  y0: number; y1: number;
  kind: OpeningKind;
  state?: OpeningState;
  /** sign atlas slot for shopfronts */
  sign?: number;
  /** door swing angle (radians, 0 = closed) */
  swing?: number;
}

export interface WallSpec {
  axis: 'x' | 'z';
  /** extent along the axis (world) */
  u0: number; u1: number;
  /** thickness band across the axis (world: z for axis 'x', x for axis 'z') */
  b0: number; b1: number;
  y0: number; y1: number;
  /** which side of the band is the exterior (+1 = b1 side) */
  out: 1 | -1;
  openings?: Opening[];
  mat: string;
  tint?: THREE.ColorRepresentation;
  damage?: number;
  damageFn?: (x: number, y: number, z: number) => number;
  surface?: SurfaceType;
  /** thin interior finish layer on the inside face */
  innerSkin?: string;
  innerTint?: THREE.ColorRepresentation;
  frameTint?: THREE.ColorRepresentation;
  frameMat?: string;
  details?: boolean;
  /** optional floor levels for per-floor sill bands (decorative string course) */
  courses?: number[];
}

interface Rect { u0: number; u1: number; y0: number; y1: number }

function uniqSorted(v: number[]): number[] {
  const s = [...v].sort((a, b) => a - b); const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > 1e-4) out.push(x);
  return out;
}

/** Rectangle minus holes → few axis-aligned solid rectangles (column merge then row merge). */
export function decompose(u0: number, u1: number, y0: number, y1: number, holes: Rect[]): Rect[] {
  const clampH = holes.map((h) => ({ u0: Math.max(u0, h.u0), u1: Math.min(u1, h.u1), y0: Math.max(y0, h.y0), y1: Math.min(y1, h.y1) })).filter((h) => h.u1 > h.u0 + 1e-4 && h.y1 > h.y0 + 1e-4);
  const us = uniqSorted([u0, u1, ...clampH.flatMap((h) => [h.u0, h.u1])]);
  const ys = uniqSorted([y0, y1, ...clampH.flatMap((h) => [h.y0, h.y1])]);
  const solid = (u: number, y: number) => !clampH.some((h) => u > h.u0 && u < h.u1 && y > h.y0 && y < h.y1);
  let boxes: Rect[] = [];
  for (let i = 0; i < us.length - 1; i++) {
    let open: Rect | null = null;
    for (let j = 0; j < ys.length - 1; j++) {
      const s = solid((us[i] + us[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
      if (s) { if (open) open.y1 = ys[j + 1]; else open = { u0: us[i], u1: us[i + 1], y0: ys[j], y1: ys[j + 1] }; }
      else if (open) { boxes.push(open); open = null; }
    }
    if (open) boxes.push(open);
  }
  // horizontal merge
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < boxes.length; a++) for (let b = 0; b < boxes.length; b++) {
      if (a === b) continue;
      const A = boxes[a], B = boxes[b];
      if (Math.abs(A.y0 - B.y0) < 1e-4 && Math.abs(A.y1 - B.y1) < 1e-4 && Math.abs(A.u1 - B.u0) < 1e-4) {
        A.u1 = B.u1; boxes.splice(b, 1); merged = true; break outer;
      }
    }
  }
  return boxes;
}

/**
 * A wall works in local (u, y, v) coordinates; M maps local → world. For axis 'z' the local frame is
 * rotated so it stays right-handed (u→+z, v→−x).
 */
class Frame {
  M = new THREE.Matrix4();
  constructor(public axis: 'x' | 'z', public uOrigin: number) {
    if (axis === 'x') this.M.makeTranslation(uOrigin, 0, 0);
    else this.M.makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, 0, uOrigin));
  }
  /** world band coordinate → local v */
  v(worldBand: number): number { return this.axis === 'x' ? worldBand : -worldBand; }
  /** local AABB → world AABB */
  aabb(cu: number, cy: number, cv: number, w: number, h: number, d: number): [number, number, number, number, number, number] {
    const p = new THREE.Vector3(cu, cy, cv).applyMatrix4(this.M);
    return this.axis === 'x' ? [p.x, p.y, p.z, w, h, d] : [p.x, p.y, p.z, d, h, w];
  }
  lbox(cu: number, cy: number, cv: number, w: number, h: number, d: number, opts: GeoOpts = {}, rot?: THREE.Matrix4): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rot) g.applyMatrix4(rot);
    g.translate(cu, cy, cv);
    g.applyMatrix4(this.M);
    return prep(g, opts);
  }
}

// Weathered joinery paint: chalky, low-chroma. The old saturated slate-teal / cobalt on a 3.4-gain material
// rendered as flat colour cards inside every opening (round 3: "the boarded window is a flat teal card").
const FRAME_COLORS = [0x46534f, 0x6a5238, 0xc9c3b4, 0x4e5c68, 0x86847b, 0x556349];

/** Build one wall (exterior facade or interior partition) with openings + details + colliders. */
export function wall(ctx: BuildCtx, s: WallSpec): void {
  const { batch, rng } = ctx;
  const F = new Frame(s.axis, s.u0);
  const L = s.u1 - s.u0;
  const vb0 = Math.min(F.v(s.b0), F.v(s.b1)), vb1 = Math.max(F.v(s.b0), F.v(s.b1));
  const thick = vb1 - vb0;
  const outLocal: 1 | -1 = (s.axis === 'x' ? s.out : (-s.out as 1 | -1));
  const vOut = outLocal > 0 ? vb1 : vb0;       // exterior face v
  const vIn = outLocal > 0 ? vb0 : vb1;        // interior face v
  const surface = s.surface ?? 'plaster';
  const holes: Rect[] = (s.openings ?? []).map((o) => ({ u0: o.u0 - s.u0, u1: o.u1 - s.u0, y0: o.y0, y1: o.y1 }));
  const wallOpts: GeoOpts = { tint: s.tint, damage: s.damage ?? 0.08, damageFn: s.damageFn };

  // local → world helpers for decals/strips
  const W = (cu: number, cy: number, cv: number) => new THREE.Vector3(cu, cy, cv).applyMatrix4(F.M);
  const nOut = new THREE.Vector3(0, 0, outLocal).transformDirection(F.M);
  const nIn = nOut.clone().negate();
  const tangent = new THREE.Vector3(1, 0, 0).transformDirection(F.M);
  const isInteriorWall = s.mat.startsWith('interior') && !s.innerSkin; // partitions: both faces are room faces
  const details = s.details ?? true;
  const rects = decompose(0, L, s.y0, s.y1, holes);
  for (const r of rects) {
    const cu = (r.u0 + r.u1) / 2, cy = (r.y0 + r.y1) / 2, w = r.u1 - r.u0, h = r.y1 - r.y0;
    /**
     * A wall is emitted as one box per decomposed rect, and two neighbouring rects used to share an exactly
     * coplanar internal face pair — which z-fights into a hairline running the full height of the wall (round 2
     * and 3: "a 1 px white vertical seam in fx_decals"). Grow each rect by 2 mm *only* at internal boundaries;
     * growing it at the wall's own ends would push the panel proud of the abutting wall and turn the hairline
     * into a lit ledge instead.
     */
    const e = 0.002;
    const eu0 = Math.abs(r.u0) < 1e-3 ? 0 : e, eu1 = Math.abs(r.u1 - L) < 1e-3 ? 0 : e;
    const ey0 = Math.abs(r.y0 - s.y0) < 1e-3 ? 0 : e, ey1 = Math.abs(r.y1 - s.y1) < 1e-3 ? 0 : e;
    const gu = cu + (eu1 - eu0) / 2, gw = w + eu0 + eu1, gy = cy + (ey1 - ey0) / 2, gh = h + ey0 + ey1;
    batch.add(s.mat, F.lbox(gu, gy, (vb0 + vb1) / 2, gw, gh, thick, wallOpts));
    ctx.collideBox(...F.aabb(cu, cy, (vb0 + vb1) / 2, w, h, thick), surface);
    if (s.innerSkin) {
      const sv = vIn + outLocal * 0.012;
      const fn = s.damageFn; batch.add(s.innerSkin, F.lbox(gu, gy, sv, gw, gh, 0.024, { tint: s.innerTint, damage: 0.05, damageFn: fn ? (x, y, z) => fn(x, y, z) * 0.55 : undefined }));
    }
    // baked AO: room faces get a dark base band, a ceiling-corner band and darkened wall ends; exterior gets base grime
    const roomFaces: [number, THREE.Vector3][] = [];
    if (s.innerSkin) roomFaces.push([vIn - outLocal * 0.03, nIn]);
    if (isInteriorWall) { roomFaces.push([vb1 + 0.006, new THREE.Vector3(0, 0, 1).transformDirection(F.M)], [vb0 - 0.006, new THREE.Vector3(0, 0, -1).transformDirection(F.M)]); }
    for (const [fv, n] of roomFaces) {
      if (Math.abs(r.y0 - s.y0) < 1e-3 && h > 0.6) aoStrip(ctx, W(cu, r.y0, fv), n, new THREE.Vector3(0, 1, 0), w, 0.4, 0.4, 0);
      if (Math.abs(r.y1 - s.y1) < 1e-3 && h > 0.6) aoStrip(ctx, W(cu, r.y1, fv), n, new THREE.Vector3(0, -1, 0), w, 0.35, 0.3, 0);
      if (Math.abs(r.u0) < 1e-3 && h > 0.6) aoStrip(ctx, W(r.u0, cy, fv), n, tangent, h, 0.3, 0.32, 0);
      if (Math.abs(r.u1 - L) < 1e-3 && h > 0.6) aoStrip(ctx, W(r.u1, cy, fv), n, tangent.clone().negate(), h, 0.3, 0.32, 0);
      // ceiling underside next to the wall (the slab above this wall)
      if (Math.abs(r.y1 - s.y1) < 1e-3 && h > 0.6) aoStrip(ctx, W(cu, r.y1 - 0.004, fv), new THREE.Vector3(0, -1, 0), n, w, 0.35, 0.32, 0);
    }
    if (details && !isInteriorWall && s.y0 < 0.6 && Math.abs(r.y0 - s.y0) < 1e-3 && h > 0.8 && !s.mat.startsWith('interior')) {
      // exterior base grime (decal atlas) + contact shadow on the ground
      for (let u = r.u0; u < r.u1 - 0.3; u += 2.5) { const seg = Math.min(2.5, r.u1 - u); decal(ctx, DECAL.grime, W(u + seg / 2, r.y0 + 0.45, vOut), nOut, seg, 0.9, 0, rng.range(0.45, 0.7)); }
      aoStrip(ctx, W(cu, r.y0 + 0.004, vOut), new THREE.Vector3(0, 1, 0), nOut, w, 0.5, 0.62, 0);
      aoStrip(ctx, W(cu, r.y0, vOut + outLocal * 0.006), nOut, new THREE.Vector3(0, 1, 0), w, 0.3, 0.5, 0);
    }
  }
  // shell holes where the damage function peaks (sampled on the exterior face), away from openings
  if (details && s.damageFn && L > 2) {
    const step = 0.6; const cols = Math.floor(L / step), rows2 = Math.floor((s.y1 - s.y0) / step);
    const val: number[][] = [];
    for (let i = 0; i <= cols; i++) { val.push([]); for (let j = 0; j <= rows2; j++) { const p = W(i * step, s.y0 + j * step, vOut); val[i].push(s.damageFn(p.x, p.y, p.z)); } }
    for (let i = 1; i < cols; i++) for (let j = 1; j < rows2; j++) {
      const v = val[i][j]; if (v < 0.8) continue;
      let max = true; for (let a = -1; a <= 1 && max; a++) for (let b = -1; b <= 1; b++) if ((a || b) && val[i + a][j + b] > v) { max = false; break; }
      if (!max) continue;
      const u = i * step, y = s.y0 + j * step;
      if (holes.some((hh) => u > hh.u0 - 0.5 && u < hh.u1 + 0.5 && y > hh.y0 - 0.5 && y < hh.y1 + 0.5)) continue;
      shellHole(ctx, W(u, y, vOut), nOut, rng.range(1.2, 1.9));
    }
  }

  const frameMat = s.frameMat ?? 'paintedMetal';
  const frameTint = s.frameTint ?? rng.pick(FRAME_COLORS);
  for (const o of s.openings ?? []) {
    const u0 = o.u0 - s.u0, u1 = o.u1 - s.u0, w = u1 - u0, h = o.y1 - o.y0, uc = (u0 + u1) / 2, yc = (o.y0 + o.y1) / 2;
    if (!details || o.kind === 'hole') continue;
    if (o.kind === 'window') {
      // sill (protrudes out, into the reveal) + lintel
      batch.add('concrete', F.lbox(uc, o.y0 - 0.035, vOut - outLocal * 0.04, w + 0.14, 0.07, 0.30, { tint: 0xd9d4c8 }));
      ctx.collideBox(...F.aabb(uc, o.y0 - 0.035, vOut - outLocal * 0.04, w + 0.14, 0.07, 0.30), 'concrete');
      batch.add('concrete', F.lbox(uc, o.y1 + 0.08, vOut - outLocal * 0.16, w + 0.2, 0.16, 0.36, { tint: 0xc9c4b8, damage: 0.05 }));
      ctx.collideBox(...F.aabb(uc, o.y1 + 0.08, vOut - outLocal * 0.16, w + 0.2, 0.16, 0.36), 'concrete');
      const state = o.state ?? rng.pick<OpeningState>(['broken', 'broken', 'glass', 'glass', 'boarded', 'shutter', 'broken']);
      const fv = vOut - outLocal * 0.13; // frame plane
      /**
       * Reveal AO. The recess is real geometry, but with the screen-space pass smeared out there was no contact
       * darkening anywhere in it, so a 130 mm reveal read as a printed rectangle. These are gradient quads on the
       * three return faces (head + two jambs), darkest at the back of the recess where the frame meets the wall.
       */
      {
        // Reveal + soffit AO. Round 3: "world_detail's reveal edge is a razor line, fx_muzzle's door frame has
        // none". The recess is real geometry but nothing darkened the return faces, so a 130 mm reveal read as
        // a printed rectangle. Head is darkest (it sees the least sky), jambs next, and a contact fan spills a
        // little onto the outer face on all four sides so the edge itself is not a razor cut.
        const rv = 0.13, mid = vOut - outLocal * rv * 0.5;
        aoStrip(ctx, W(uc, o.y1 - 0.002, mid), new THREE.Vector3(0, -1, 0), nOut, w, rv, 0.85, 0.12);
        aoStrip(ctx, W(u0 + 0.003, yc, mid), tangent, nOut, h, rv, 0.66, 0.08);
        aoStrip(ctx, W(u1 - 0.003, yc, mid), tangent.clone().negate(), nOut, h, rv, 0.66, 0.08);
        aoStrip(ctx, W(uc, o.y0 + 0.004, mid), new THREE.Vector3(0, 1, 0), nOut, w, rv * 0.8, 0.42, 0.05);
        aoStrip(ctx, W(uc, o.y1 + 0.005, vOut), nOut, new THREE.Vector3(0, 1, 0), w, 0.16, 0.44, 0.0);
        aoStrip(ctx, W(u0 - 0.002, yc, vOut), nOut, tangent.clone().negate(), h, 0.13, 0.34, 0.0);
        aoStrip(ctx, W(u1 + 0.002, yc, vOut), nOut, tangent, h, 0.13, 0.34, 0.0);
      }
      if (!s.mat.startsWith('interior')) {
        // rain streaks below the sill, soot fan above burnt-out windows, AO under the sill and lintel
        decal(ctx, DECAL.streak, W(uc + rng.range(-0.1, 0.1), o.y0 - 0.07 - 0.55, vOut), nOut, w + 0.3, 1.1, 0, rng.range(0.4, 0.7));
        aoStrip(ctx, W(uc, o.y0 - 0.07, vOut), nOut, new THREE.Vector3(0, -1, 0), w + 0.14, 0.24, 0.62, 0);
        aoStrip(ctx, W(uc, o.y1 + 0.16, vOut), nOut, new THREE.Vector3(0, 1, 0), w + 0.2, 0.2, 0.45, 0);
        // underside of the projecting lintel (the soffit itself, not the wall beneath it)
        aoStrip(ctx, W(uc, o.y1 + 0.005, vOut - outLocal * 0.09), new THREE.Vector3(0, -1, 0), nOut, w + 0.2, 0.17, 0.7, 0.1);
        if (state === 'broken' && rng.next() < 0.45) decal(ctx, DECAL.soot, W(uc, o.y1 + 0.16 + 0.6, vOut), nOut, w + 0.8, 1.3, 0, rng.range(0.6, 0.9));
        if (rng.next() < 0.55) { const side = rng.pick([-1, 1]); pocks(ctx, W(uc + side * (w / 2 + rng.range(0.35, 0.7)), yc + rng.range(-0.4, 0.4), vOut), nOut, rng.range(0.5, 0.9)); }
      }
      if (state === 'broken') {
        // glass shards left in the frame corners
        for (const [cu2, cy2, su, sy] of [[u0 + 0.07, o.y1 - 0.07, 1, -1], [u1 - 0.07, o.y1 - 0.07, -1, -1], [u0 + 0.07, o.y0 + 0.07, 1, 1], [u1 - 0.07, o.y0 + 0.07, -1, 1]] as [number, number, number, number][]) {
          if (rng.next() < 0.5) continue;
          const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(su * w * rng.range(0.15, 0.4), 0); sh.lineTo(su * w * rng.range(0.03, 0.15), sy * h * rng.range(0.2, 0.5)); sh.lineTo(0, sy * h * rng.range(0.25, 0.6)); sh.closePath();
          const g = new THREE.ShapeGeometry(sh); g.translate(cu2, cy2, fv); g.applyMatrix4(F.M);
          batch.add('glass', prep(g, { uv: 'keep', tint: 0xffffff }));
        }
      }
      if ((state === 'broken' || state === 'glass') && rng.next() < 0.4 && !s.mat.startsWith('interior')) {
        // curtain hanging inside, pushed to one side, slightly waved
        const cw = w * rng.range(0.35, 0.6);
        const g = new THREE.PlaneGeometry(cw, h + 0.3, 4, 6);
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 14) * 0.03 + Math.cos(pos.getY(i) * 5) * 0.015);
        g.computeVertexNormals();
        const side = rng.pick([-1, 1]);
        g.translate(uc + side * (w / 2 - cw / 2 - 0.02), yc - 0.05, vIn - outLocal * 0.06); g.applyMatrix4(F.M);
        batch.add('fabric', prep(g, { uv: 'keep', uvScale: 0.5, tint: rng.pick([0xa08a70, 0x7a5a50, 0x6a7a80, 0xc8b898]) }));
      }
      if (state !== 'shutter') {
        const fw = 0.07;
        const frameOpts: GeoOpts = { tint: frameTint };
        batch.add(frameMat, F.lbox(u0 + fw / 2, yc, fv, fw, h, 0.07, frameOpts));
        batch.add(frameMat, F.lbox(u1 - fw / 2, yc, fv, fw, h, 0.07, frameOpts));
        batch.add(frameMat, F.lbox(uc, o.y1 - fw / 2, fv, w, fw, 0.07, frameOpts));
        batch.add(frameMat, F.lbox(uc, o.y0 + fw / 2, fv, w, fw, 0.07, frameOpts));
        if (w > 1.0) batch.add(frameMat, F.lbox(uc, yc, fv, 0.05, h, 0.06, frameOpts));
        if (h > 1.2) batch.add(frameMat, F.lbox(uc, o.y0 + h * 0.62, fv, w, 0.05, 0.06, frameOpts));
      }
      if (state === 'glass') {
        batch.add('burnt', F.lbox(uc, yc, vOut - outLocal * 0.145, w - 0.02, h - 0.02, 0.02, { tint: rng.pick([0x17150f, 0x1c1913, 0x141313]) }));
        const panes = w > 1.0 ? 2 : 1;
        // per-window glazing: a little dirt/age spread so a facade is not one repeated pane
        const gt = new THREE.Color().setHSL(rng.range(0.52, 0.60), rng.range(0.05, 0.2), rng.range(0.42, 0.72));
        for (let p = 0; p < panes; p++) {
          const pw = (w - 0.14) / panes - 0.03, pu = u0 + 0.07 + (p + 0.5) * ((w - 0.14) / panes);
          if (rng.next() < 0.35) continue; // one pane shot out
          batch.add('glass', F.lbox(pu, yc, fv, pw, h - 0.14, 0.006, { tint: gt }));
        }
      } else if (state === 'boarded') {
        batch.add('burnt', F.lbox(uc, yc, vOut - outLocal * 0.145, w - 0.02, h - 0.02, 0.02, { tint: 0x14120f }));
        const n = rng.int(2, 3);
        for (let b = 0; b < n; b++) {
          const by = o.y0 + 0.25 + (b + 0.5) * ((h - 0.5) / n) + rng.range(-0.05, 0.05);
          const rot = new THREE.Matrix4().makeRotationZ(rng.range(-0.12, 0.12));
          batch.add('wood', F.lbox(uc + rng.range(-0.05, 0.05), by, vOut - outLocal * 0.035, w + rng.range(0.25, 0.5), rng.range(0.16, 0.22), 0.028, { tint: rng.pick([0x9a8468, 0x7d6b52, 0xa89a80]) }, rot));
        }
      } else if (state === 'shutter') {
        batch.add('shutter', F.lbox(uc, yc, vOut - outLocal * 0.09, w + 0.02, h + 0.02, 0.03, { tint: rng.pick([0x8fa0a8, 0xb8a78a, 0x7e8a6b, 0x9c9c9c]) }));
        ctx.collideBox(...F.aabb(uc, yc, vOut - outLocal * 0.09, w, h, 0.03), 'metal');
        batch.add('paintedMetal', F.lbox(uc, o.y1 + 0.1, vOut - outLocal * 0.1, w + 0.2, 0.22, 0.24, { tint: 0x5a5854 }));
      }
    } else if (o.kind === 'door') {
      const fv = vOut - outLocal * 0.16;
      const fw = 0.09;
      {
        const rv = 0.16, mid = vOut - outLocal * rv * 0.5;
        aoStrip(ctx, W(uc, o.y1 - 0.002, mid), new THREE.Vector3(0, -1, 0), nOut, w, rv, 0.88, 0.14);
        aoStrip(ctx, W(u0 + 0.003, yc, mid), tangent, nOut, h, rv, 0.7, 0.1);
        aoStrip(ctx, W(u1 - 0.003, yc, mid), tangent.clone().negate(), nOut, h, rv, 0.7, 0.1);
        aoStrip(ctx, W(uc, o.y1 + 0.005, vOut), nOut, new THREE.Vector3(0, 1, 0), w, 0.2, 0.5, 0.0);
        aoStrip(ctx, W(u0 - 0.002, yc, vOut), nOut, tangent.clone().negate(), h, 0.14, 0.36, 0.0);
        aoStrip(ctx, W(u1 + 0.002, yc, vOut), nOut, tangent, h, 0.14, 0.36, 0.0);
      }
      if (!s.mat.startsWith('interior')) {
        if (rng.next() < 0.6) pocks(ctx, W(uc + rng.pick([-1, 1]) * (w / 2 + rng.range(0.3, 0.6)), yc + rng.range(-0.3, 0.5), vOut), nOut, rng.range(0.6, 0.95));
        decal(ctx, DECAL.grime, W(uc, o.y0 + 0.3, vOut), nOut, w + 0.9, 0.7, 0, 0.5);
      }
      aoStrip(ctx, W(uc, o.y1 + 0.02, isInteriorWall ? vb1 + 0.006 : vIn), isInteriorWall ? new THREE.Vector3(0, 0, 1).transformDirection(F.M) : nIn, new THREE.Vector3(0, 1, 0), w + 0.3, 0.3, 0.35, 0);
      const frameOpts: GeoOpts = { tint: frameTint };
      batch.add(frameMat, F.lbox(u0 + fw / 2, yc, fv, fw, h, 0.12, frameOpts));
      batch.add(frameMat, F.lbox(u1 - fw / 2, yc, fv, fw, h, 0.12, frameOpts));
      batch.add(frameMat, F.lbox(uc, o.y1 - fw / 2, fv, w, fw, 0.12, frameOpts));
      // threshold step
      batch.add('concrete', F.lbox(uc, o.y0 + 0.02, (vb0 + vb1) / 2, w + 0.1, 0.04, thick + 0.1, { tint: 0xb9b4a8 }));
      const state = o.state ?? rng.pick<OpeningState>(['open', 'open', 'missing', 'closed']);
      if (state !== 'missing') {
        const leafW = w - 0.2, leafH = h - 0.12;
        const swing = state === 'closed' ? 0 : (o.swing ?? rng.range(1.0, 1.7)) * (outLocal > 0 ? 1 : -1);
        // hinge at u0 side, on the interior face plane; leaf rotates into the building
        const rot = new THREE.Matrix4().makeRotationY(-swing * (outLocal > 0 ? 1 : -1));
        const g = new THREE.BoxGeometry(leafW, leafH, 0.05);
        g.translate(leafW / 2, 0, 0); // hinge at origin
        // door handle & panel ribs
        const ribs = [new THREE.BoxGeometry(leafW - 0.16, 0.05, 0.02).translate(leafW / 2, leafH * 0.25, 0.03), new THREE.BoxGeometry(leafW - 0.16, 0.05, 0.02).translate(leafW / 2, -leafH * 0.25, 0.03)];
        const parts = [g, ...ribs];
        for (const p of parts) { p.applyMatrix4(rot); p.translate(u0 + 0.1, yc, vIn + outLocal * 0.04); p.applyMatrix4(F.M); batch.add('paintedMetal', prep(p, { tint: o.kind === 'door' ? (frameTint) : frameTint, damage: 0 })); }
        if (state === 'closed') ctx.collideBox(...F.aabb(uc, yc, vIn + outLocal * 0.04, leafW, leafH, 0.05), 'metal');
        else {
          // open leaf collider: rotated box
          const q = new THREE.Quaternion().setFromRotationMatrix(rot);
          const c = new THREE.Vector3(leafW / 2, 0, 0).applyQuaternion(q).add(new THREE.Vector3(u0 + 0.1, yc, vIn + outLocal * 0.04)).applyMatrix4(F.M);
          const qw = new THREE.Quaternion().setFromRotationMatrix(F.M).multiply(q);
          ctx.collideQuat(c.x, c.y, c.z, leafW, leafH, 0.05, 'metal', qw);
        }
      }
    } else if (o.kind === 'shop') {
      const state = o.state ?? 'halfShutter';
      {
        const rv = 0.14, mid = vOut - outLocal * rv * 0.5;
        aoStrip(ctx, W(uc, o.y1 - 0.002, mid), new THREE.Vector3(0, -1, 0), nOut, w, rv, 0.85, 0.12);
        aoStrip(ctx, W(u0 + 0.003, yc, mid), tangent, nOut, h, rv, 0.62, 0.08);
        aoStrip(ctx, W(u1 - 0.003, yc, mid), tangent.clone().negate(), nOut, h, rv, 0.62, 0.08);
        aoStrip(ctx, W(u0 - 0.002, yc, vOut), nOut, tangent.clone().negate(), h, 0.14, 0.34, 0.0);
        aoStrip(ctx, W(u1 + 0.002, yc, vOut), nOut, tangent, h, 0.14, 0.34, 0.0);
      }
      // shutter housing above opening
      batch.add('paintedMetal', F.lbox(uc, o.y1 + 0.17, vOut - outLocal * 0.06, w + 0.3, 0.34, 0.36, { tint: 0x55534f }));
      ctx.collideBox(...F.aabb(uc, o.y1 + 0.17, vOut - outLocal * 0.06, w + 0.3, 0.34, 0.36), 'metal');
      // side rails
      batch.add('paintedMetal', F.lbox(u0 + 0.03, yc, vOut - outLocal * 0.1, 0.06, h, 0.1, { tint: 0x55534f }));
      batch.add('paintedMetal', F.lbox(u1 - 0.03, yc, vOut - outLocal * 0.1, 0.06, h, 0.1, { tint: 0x55534f }));
      let shutBottom = o.y1;
      if (state === 'shutter') shutBottom = o.y0;
      else if (state === 'halfShutter') shutBottom = o.y0 + Math.max(2.0, h - 0.7);
      if (shutBottom < o.y1 - 0.05) {
        const sh = o.y1 - shutBottom;
        batch.add('shutter', F.lbox(uc, shutBottom + sh / 2, vOut - outLocal * 0.1, w - 0.06, sh, 0.03, { tint: rng.pick([0x9aa5aa, 0xb0a07e, 0x8c9a86]) }));
        ctx.collideBox(...F.aabb(uc, shutBottom + sh / 2, vOut - outLocal * 0.1, w - 0.06, sh, 0.03), 'metal');
      }
      // interior floor threshold
      batch.add('concrete', F.lbox(uc, o.y0 + 0.02, (vb0 + vb1) / 2, w + 0.1, 0.04, thick + 0.1, { tint: 0xb9b4a8 }));
      // sign board
      if (o.sign !== undefined) {
        const slot = ctx.signs.slots[o.sign % ctx.signs.slots.length];
        const sw = w + 0.5, shh = sw / slot.aspect * 0.85;
        const sy = o.y1 + 0.34 + shh / 2 + 0.06;
        const sv = vOut + outLocal * 0.09;
        batch.add('paintedMetal', F.lbox(uc, sy, sv - outLocal * 0.04, sw + 0.08, shh + 0.08, 0.06, { tint: 0x3a3835 }));
        ctx.collideBox(...F.aabb(uc, sy, sv - outLocal * 0.04, sw + 0.08, shh + 0.08, 0.06), 'metal');
        const pg = new THREE.PlaneGeometry(sw, shh);
        const uv = pg.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, slot.u0 + uv.getX(i) * (slot.u1 - slot.u0), slot.v0 + uv.getY(i) * (slot.v1 - slot.v0));
        if (outLocal < 0) pg.rotateY(Math.PI);
        pg.translate(uc, sy, sv);
        pg.applyMatrix4(F.M);
        batch.add('sign', prep(pg, { uv: 'keep' }));
        // brackets
        for (const du of [-sw / 2 + 0.2, sw / 2 - 0.2]) batch.add('paintedMetal', F.lbox(uc + du, sy - shh / 2 - 0.03, vOut + outLocal * 0.03, 0.05, 0.05, 0.16, { tint: 0x3a3835 }));
      }
    } else if (o.kind === 'arch') {
      // passage: a lintel beam + nothing else
      batch.add('concrete', F.lbox(uc, o.y1 + 0.15, (vb0 + vb1) / 2, w + 0.3, 0.3, thick + 0.06, { tint: 0xbdb8ac, damage: 0.2 }));
      ctx.collideBox(...F.aabb(uc, o.y1 + 0.15, (vb0 + vb1) / 2, w + 0.3, 0.3, thick + 0.06), 'concrete');
      // the passage soffit and both jambs, so the opening is not a razor-edged black rectangle
      for (const [fv2, nrm] of [[vOut, nOut], [vIn, nIn]] as [number, THREE.Vector3][]) {
        aoStrip(ctx, W(uc, o.y1 - 0.004, fv2 - (fv2 === vOut ? outLocal : -outLocal) * thick * 0.35), new THREE.Vector3(0, -1, 0), nrm, w, thick * 0.7, 0.8, 0.15);
        aoStrip(ctx, W(u0 + 0.004, yc, fv2 - (fv2 === vOut ? outLocal : -outLocal) * thick * 0.35), tangent, nrm, h, thick * 0.7, 0.6, 0.1);
        aoStrip(ctx, W(u1 - 0.004, yc, fv2 - (fv2 === vOut ? outLocal : -outLocal) * thick * 0.35), tangent.clone().negate(), nrm, h, thick * 0.7, 0.6, 0.1);
      }
    }
  }
  // string courses between floors (thin projecting band)
  for (const y of s.courses ?? []) {
    batch.add('concrete', F.lbox(L / 2, y, vOut + outLocal * 0.03, L, 0.12, 0.08, { tint: 0xc5c0b4, damage: 0.1 }));
  }
}

/** Horizontal slab with rectangular holes. finishMat draws a thin top layer. */
export function slab(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, holes: { x0: number; z0: number; x1: number; z1: number }[], mat: string, finishMat?: string, opts: GeoOpts = {}, surface: SurfaceType = 'concrete'): void {
  const rects = decompose(x0, x1, z0, z1, holes.map((h) => ({ u0: h.x0, u1: h.x1, y0: h.z0, y1: h.z1 })));
  for (const r of rects) {
    ctx.batch.add(mat, boxMM(r.u0, y0, r.y0, r.u1, y1, r.y1, opts));
    ctx.collideBox((r.u0 + r.u1) / 2, (y0 + y1) / 2, (r.y0 + r.y1) / 2, r.u1 - r.u0, y1 - y0, r.y1 - r.y0, surface);
    if (finishMat) ctx.batch.add(finishMat, boxMM(r.u0 + 0.005, y1, r.y0 + 0.005, r.u1 - 0.005, y1 + 0.02, r.y1 - 0.005, { ...opts, tint: opts.tint }));
  }
}

/** One straight run of steps: solid concrete stair (extruded sawtooth) + step colliders. Runs along ±z. */
export function stairRun(ctx: BuildCtx, x0: number, x1: number, zStart: number, dir: 1 | -1, yBase: number, mat: string, tint?: THREE.ColorRepresentation): number {
  const shape = new THREE.Shape();
  // shape.x = -(world z offset), shape.y = y
  const sx = (sOff: number) => -dir * sOff;
  shape.moveTo(sx(0), 0);
  for (let k = 0; k < STEPS; k++) { shape.lineTo(sx(k * TREAD), (k + 1) * RISER); shape.lineTo(sx((k + 1) * TREAD), (k + 1) * RISER); }
  shape.lineTo(sx(RUN), STEPS * RISER - 0.3);
  shape.lineTo(sx(0.35), -0.02);
  shape.lineTo(sx(0), -0.02);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: 1 });
  g.rotateY(Math.PI / 2); // shape.x → -z, depth → +x
  g.translate(x0, yBase, zStart);
  ctx.batch.add(mat, prep(g, { tint, damage: 0.05 }));
  for (let k = 0; k < STEPS; k++) {
    const zc = zStart + dir * ((k + 0.5) * TREAD);
    const top = yBase + (k + 1) * RISER;
    ctx.collideBox((x0 + x1) / 2, (yBase - 0.02 + top) / 2, zc, x1 - x0, top - yBase + 0.02, TREAD, 'concrete');
  }
  return yBase + STEPS * RISER;
}

/** Simple steel railing along a line (posts + top rail). */
export function railing(ctx: BuildCtx, a: THREE.Vector3, b: THREE.Vector3, height = 0.95, mat = 'darkMetal', tint: THREE.ColorRepresentation = 0x2a2c2e): void {
  const len = a.distanceTo(b);
  const n = Math.max(1, Math.round(len / 0.9));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / n);
    ctx.batch.add(mat, box(p.x, p.y + height / 2, p.z, 0.04, height, 0.04, { tint }));
  }
  ctx.batch.add(mat, tube([a.clone().add(new THREE.Vector3(0, height, 0)), b.clone().add(new THREE.Vector3(0, height, 0))], 0.022, 2, 5, { tint }));
  ctx.batch.add(mat, tube([a.clone().add(new THREE.Vector3(0, height * 0.55, 0)), b.clone().add(new THREE.Vector3(0, height * 0.55, 0))], 0.014, 2, 4, { tint }));
}

/**
 * U-stair inside the stairwell rect [x0..x0+STAIR_W] × [z0..z0+STAIR_D] from yFrom to yFrom+FH.
 * Run 1 goes +z (dir=1) on the x0 side, landing at the far end, run 2 returns on the other side.
 * If dir=-1 the stairwell is mirrored in z (z0 is then the far edge... we pass zNear explicitly).
 */
export function stairsU(ctx: BuildCtx, x0: number, zNear: number, dir: 1 | -1, yFrom: number, mat: string, tint?: THREE.ColorRepresentation, wallMat = 'interior'): void {
  const halfW = (STAIR_W - 0.1) / 2;
  const zStart = zNear + dir * 0.3;
  const y1 = stairRun(ctx, x0, x0 + halfW, zStart, dir, yFrom, mat, tint);
  // landing
  const zl0 = zStart + dir * RUN, zl1 = zl0 + dir * (STAIR_D - 0.3 - RUN);
  const lz0 = Math.min(zl0, zl1), lz1 = Math.max(zl0, zl1);
  ctx.batch.add(mat, boxMM(x0, y1 - 0.22, lz0, x0 + STAIR_W, y1, lz1, { tint, damage: 0.05 }));
  ctx.collideBox(x0 + STAIR_W / 2, y1 - 0.11, (lz0 + lz1) / 2, STAIR_W, 0.22, lz1 - lz0, 'concrete');
  // run 2 back
  const y2 = stairRun(ctx, x0 + STAIR_W - halfW, x0 + STAIR_W, zl0, -dir as 1 | -1, y1, mat, tint);
  void y2;
  // railings on the open inner edges
  const xm1 = x0 + halfW, xm2 = x0 + STAIR_W - halfW;
  railing(ctx, new THREE.Vector3(xm1, yFrom + 0.05, zStart), new THREE.Vector3(xm1, y1 + 0.05, zl0));
  railing(ctx, new THREE.Vector3(xm2, y1 + 0.05, zl0), new THREE.Vector3(xm2, y2 + 0.05, zStart));
  // top landing strip between the slab edge and the first/last step so there is no gap over the well
  const zEdge = zStart - dir * 0.3;
  const za = Math.min(zEdge, zStart), zb = Math.max(zEdge, zStart);
  ctx.batch.add(mat, boxMM(x0 + STAIR_W - halfW, y2 - 0.22, za - 0.01, x0 + STAIR_W, y2, zb + 0.01, { tint, damage: 0.05 }));
  ctx.collideBox(x0 + STAIR_W - halfW / 2, y2 - 0.11, (za + zb) / 2, halfW, 0.22, zb - za + 0.02, 'concrete');
  void wallMat;
}

/** Parapet around a roof rect, with coping. */
export function parapet(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, y: number, h: number, th: number, mat: string, opts: GeoOpts = {}, sides: { n?: boolean; s?: boolean; w?: boolean; e?: boolean } = {}): void {
  const on = (k: 'n' | 's' | 'w' | 'e') => sides[k] ?? true;
  const segs: [number, number, number, number, boolean][] = [[x0, z0, x1, z0 + th, on('n')], [x0, z1 - th, x1, z1, on('s')], [x0, z0 + th, x0 + th, z1 - th, on('w')], [x1 - th, z0 + th, x1, z1 - th, on('e')]];
  for (const [a, b, c, d, k] of segs) {
    if (!k) continue;
    ctx.batch.add(mat, boxMM(a, y, b, c, y + h, d, { ...opts, damage: 0.1, damageTop: 0.38 }));
    ctx.collideBox((a + c) / 2, y + h / 2, (b + d) / 2, c - a, h, d - b, 'plaster');
    ctx.batch.add('concrete', boxMM(a - 0.04, y + h, b - 0.04, c + 0.04, y + h + 0.06, d + 0.04, { tint: 0xc8c3b6 }));
  }
}

/** Broken wall segment (shelled) — jagged strips + colliders. */
export function brokenWall(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, thick: number, yBase: number, heightAt: (t: number) => number, mat: string, opts: GeoOpts = {}): void {
  const { geos, strips } = jaggedWall(x0, z0, x1, z1, thick, yBase, heightAt, ctx.rng, opts);
  ctx.batch.addAll(mat, geos);
  for (const s of strips) ctx.collideBox(s.cx, s.cy, s.cz, s.w, s.h, s.d, 'brick', s.rotY);
}
