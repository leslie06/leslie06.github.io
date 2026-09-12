import * as THREE from 'three';
import { Parts, GeoBuf, V3, box, cyl, lerp, clamp, flat, rectPoly, circlePoly, lathe, hexa, norm } from './geo';
import { bandV, type BandName } from './tex';
import { roof, type RoofSpec } from './roof';
import type { TileColor } from './mats';

/**
 * The traditional-architecture kit: stepped marble terraces (须弥座 with balustrades, stairs and
 * spouts), city-gate platforms (battered walls with arched tunnels and parapets), and halls built
 * as stories of columns, walls, lattice doors, painted beams and bracket bands under the roofs of
 * roof.ts. Gates, halls and altars are all assembled from these.
 */

// ---------- balustrades --------------------------------------------------------------------------

export interface RailOpts {
  closed?: boolean;
  /** Skip posts where this returns true (stair openings). */
  gap?: (x: number, z: number) => boolean;
  h?: number; step?: number;
  /** Drain spouts (螭首) under each post: y of the spout and how far it sticks out. */
  spout?: { y: number; len: number };
  key?: string;
}

/** 汉白玉栏杆 along a polyline (x, z) standing on height y. */
export function balustrade(P: Parts, pts: [number, number][], y: number, o: RailOpts = {}): void {
  const b = P.get(o.key ?? 'marble');
  const h = o.h ?? 1.1, step = o.step ?? 1.8;
  const n = pts.length, segs = o.closed ? n : n - 1;
  let prev: [number, number] | null = null;
  for (let s = 0; s < segs; s++) {
    const a = pts[s], c = pts[(s + 1) % n];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.05) continue;
    const k = Math.max(1, Math.round(len / step));
    const yaw = Math.atan2(-(c[1] - a[1]), c[0] - a[0]);
    const outN: [number, number] = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len];
    for (let i = 0; i <= k; i++) {
      if (i === 0 && s > 0) { prev = [a[0], a[1]]; continue; }
      const t = i / k, x = lerp(a[0], c[0], t), z = lerp(a[1], c[1], t);
      const gapHere = o.gap?.(x, z) ?? false;
      if (!gapHere) {
        box(b, x, y + h / 2, z, 0.22, h, 0.22, { ry: yaw });
        box(b, x, y + h + 0.12, z, 0.27, 0.24, 0.27, { ry: yaw });
        cyl(b, x, y + h + 0.24, z, 0.13, 0.02, 0.18, 4, { phase: Math.PI / 4 - yaw });
        if (o.spout) P.at(x + outN[0] * o.spout.len / 2, o.spout.y, z + outN[1] * o.spout.len / 2, yaw, () => box(b, 0, 0, 0, 0.22, 0.22, o.spout!.len, { bottom: true }));
      }
      if (prev && !gapHere && !(o.gap?.(prev[0], prev[1]) ?? false)) {
        const mx = (prev[0] + x) / 2, mz = (prev[1] + z) / 2, L = Math.hypot(x - prev[0], z - prev[1]) - 0.22;
        if (L > 0.1) P.at(mx, y, mz, yaw, () => {
          box(b, 0, 0.07, 0, L, 0.14, 0.3, { faces: 'zZY' });
          box(b, 0, 0.14 + h * 0.2, 0, L, h * 0.4, 0.11, { faces: 'zZY' });
          box(b, 0, 0.14 + h * 0.4 + h * 0.08, 0, 0.14, h * 0.16, 0.09, { faces: 'xXzZ' });
          box(b, 0, h * 0.78, 0, L, h * 0.11, 0.13, { faces: 'zZYy' });
        });
      }
      prev = [x, z];
    }
  }
}

// ---------- terraces --------------------------------------------------------------------------

export type Side = 'S' | 'N' | 'E' | 'W';
const SIDE_RY: Record<Side, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

export interface Stair { side: Side; w: number; at?: number; ramp?: number }
export interface Tier { hw: number; hd: number; h: number; round?: boolean }
export interface TerraceSpec {
  tiers: Tier[]; y0?: number; key?: string; topKey?: string;
  rail?: boolean; railH?: number; railStep?: number; stairs?: Stair[]; spouts?: boolean; sumeru?: boolean; lod?: boolean;
  cx?: number; cz?: number;
}

const SUMERU: [number, number][] = [[0, 0], [0, 0.13], [0.05, 0.19], [0.12, 0.23], [0.12, 0.29], [0.2, 0.33], [0.2, 0.67], [0.12, 0.71], [0.12, 0.77], [0.05, 0.81], [0, 0.87], [0, 1]];

/** Sumeru-profiled block (rectangular or round) from y0 to y0 + h, centred on (cx, cz). */
export function sumeru(P: Parts, key: string, hw: number, hd: number, y0: number, h: number, o: { round?: boolean; plain?: boolean; cx?: number; cz?: number; top?: string | false } = {}): void {
  const b = P.get(key), cx = o.cx ?? 0, cz = o.cz ?? 0;
  const s = Math.min(1, h / 1.6);
  const prof = o.plain ? [[0, 0], [0, 1]] as [number, number][] : SUMERU;
  if (o.round) {
    lathe(b, prof.map(([i, f]) => [hw - i * s, y0 + f * h] as [number, number]), Math.max(24, Math.round(hw * 3)), cx, cz);
    if (o.top !== false) flat(P.get(o.top ?? key), circlePoly(hw, Math.max(24, Math.round(hw * 3)), cx, cz), y0 + h);
    return;
  }
  for (let k = 0; k < prof.length - 1; k++) {
    const i0 = prof[k][0] * s, i1 = prof[k + 1][0] * s, ya = y0 + prof[k][1] * h, yb = y0 + prof[k + 1][1] * h;
    const r0 = rectCW(hw - i0, hd - i0, cx, cz), r1 = rectCW(hw - i1, hd - i1, cx, cz);
    let u = 0;
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) % 4;
      const w = Math.hypot(r0[f][0] - r0[e][0], r0[f][1] - r0[e][1]);
      b.poly([[r0[e][0], ya, r0[e][1]], [r0[f][0], ya, r0[f][1]], [r1[f][0], yb, r1[f][1]], [r1[e][0], yb, r1[e][1]]], [[u, ya], [u + w, ya], [u + w, yb], [u, yb]]);
      u += w;
    }
  }
  if (o.top !== false) flat(P.get(o.top ?? key), rectPoly(hw, hd, cx, cz), y0 + h);
}
/** Rectangle corners, clockwise in (x, z) maths orientation (so walls built edge by edge face out). */
function rectCW(hw: number, hd: number, cx = 0, cz = 0): [number, number][] {
  return [[cx - hw, cz + hd], [cx + hw, cz + hd], [cx + hw, cz - hd], [cx - hw, cz - hd]];
}

/** Stepped terrace; returns the height of its top. Stairs climb each tier on the given sides. */
export function terrace(P: Parts, o: TerraceSpec): number {
  let y = o.y0 ?? 0;
  const key = o.key ?? 'marble', cx = o.cx ?? 0, cz = o.cz ?? 0;
  const tiers = o.tiers;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    sumeru(P, key, t.hw, t.hd, y, t.h, { round: t.round, plain: o.sumeru === false || o.lod, cx, cz, top: o.topKey ?? key });
    const yTop = y + t.h;
    for (const st of o.stairs ?? []) if (!o.lod) stairOld(P, key, t, st, y, yTop, cx, cz);
    if (o.rail !== false && !o.lod) {
      const inset = 0.28;
      const gap = (x: number, z: number) => (o.stairs ?? []).some((st) => inStair(st, t, x - cx, z - cz, inset));
      const spout = o.spouts ? { y: yTop - 0.22, len: 0.8 } : undefined;
      if (t.round) balustrade(P, circlePoly(t.hw - inset, Math.max(12, Math.round((Math.PI * 2 * (t.hw - inset)) / (o.railStep ?? 1.8))), cx, cz), yTop, { closed: true, gap, h: o.railH, step: 99, spout, key });
      else balustrade(P, rectPoly(t.hw - inset, t.hd - inset, cx, cz), yTop, { closed: true, gap, h: o.railH, step: o.railStep, spout, key });
    }
    y = yTop;
  }
  return y;
}

function inStair(st: Stair, t: Tier, x: number, z: number, inset: number): boolean {
  const at = st.at ?? 0, hw = st.w / 2 + 0.35;
  const edgeX = t.round ? t.hw : t.hw, edgeZ = t.round ? t.hw : t.hd;
  switch (st.side) {
    case 'S': return z > edgeZ - inset - 1.5 && Math.abs(x - at) < hw;
    case 'N': return z < -(edgeZ - inset - 1.5) && Math.abs(x - at) < hw;
    case 'E': return x > edgeX - inset - 1.5 && Math.abs(z - at) < hw;
    case 'W': return x < -(edgeX - inset - 1.5) && Math.abs(z - at) < hw;
  }
}

/** Steps up one tier face, with sloped side rails and an optional central carved ramp (御路). */
function stairOld(P: Parts, key: string, t: Tier, st: Stair, y0: number, y1: number, cx: number, cz: number): void {
  const b = P.get(key);
  const rise = 0.15, tread = 0.32;
  const n = Math.max(2, Math.round((y1 - y0) / rise)), rr = (y1 - y0) / n, run = n * tread;
  const edge = st.side === 'S' || st.side === 'N' ? (t.round ? t.hw : t.hd) : t.hw;
  const at = st.at ?? 0;
  const ry = SIDE_RY[st.side];
  // local frame: x across the stair, +z outward from the tier face, origin at the face
  const off = t.round ? Math.sqrt(Math.max(0, edge * edge - at * at)) - 0.05 : edge - 0.02;
  // `at` is the world offset along the face (x on S/N faces, z on E/W faces)
  const ox = st.side === 'S' || st.side === 'N' ? at : st.side === 'E' ? off : -off;
  const oz = st.side === 'S' ? off : st.side === 'N' ? -off : at;
  // Rotate so local +z points outward, then place.
  P.push(new THREE.Matrix4().makeRotationY(ry).setPosition(cx + ox, 0, cz + oz));
  const hw = st.w / 2;
  for (let i = 0; i < n; i++) {
    const yt = y0 + (i + 1) * rr, zf = run - i * tread, zb = zf - tread;
    b.quadM([-hw, yt - rr, zf], [hw, yt - rr, zf], [hw, yt, zf], [-hw, yt, zf]);
    b.quadM([-hw, yt, zf], [hw, yt, zf], [hw, yt, zb - 0.02], [-hw, yt, zb - 0.02]);
  }
  // 垂带 side rails: sloped wedges
  for (const sx of [-1, 1]) {
    const x0 = sx * (hw + 0.3), w = 0.3;
    const c: V3[] = [
      [x0 - w, y0, run], [x0 + w, y0, run], [x0 + w, y0, -0.05], [x0 - w, y0, -0.05],
      [x0 - w, y0 + rr + 0.12, run], [x0 + w, y0 + rr + 0.12, run], [x0 + w, y1 + 0.15, -0.05], [x0 - w, y1 + 0.15, -0.05],
    ];
    // reorder into hexa convention (-x,-z),(+x,-z),(+x,+z),(-x,+z)
    hexa(b, [c[3], c[2], c[1], c[0], c[7], c[6], c[5], c[4]]);
  }
  if (st.ramp) {
    const rw = st.ramp / 2;
    const yA = y0 + rr + 0.06, yB = y1 + 0.06;
    const c: V3[] = [[-rw, y0, -0.02], [rw, y0, -0.02], [rw, y0, run], [-rw, y0, run], [-rw, yB, -0.02], [rw, yB, -0.02], [rw, yA, run], [-rw, yA, run]];
    hexa(b, c);
  }
  P.pop();
}

// ---------- city-gate platforms (城台) -------------------------------------------------------------

export interface Arch { x: number; w: number; h: number }
export interface PlatformSpec {
  hw: number; hd: number; h: number; batter: number; key: string; y0?: number;
  arches?: Arch[];
  base?: { h: number; out: number; key: string };
  parapet?: { h: number; t: number; key: string; coping?: string; crenel?: boolean } | { rail: true; key?: string };
  topKey?: string;
  lod?: boolean;
  /** Night light inside the tunnels (0..1). */
  tunnelGlow?: number;
}

/** Battered platform with arched tunnels running through it along z. Returns the top height. */
export function gatePlatform(P: Parts, o: PlatformSpec): number {
  const y0 = o.y0 ?? 0, { hw, hd, h, batter: bt } = o;
  const b = P.get(o.key);
  const arches = [...(o.arches ?? [])].sort((a, c) => a.x - c.x);
  const zf = (y: number) => hd - bt * ((y - y0) / h);
  // front and back faces: outline with arch notches cut from the bottom edge
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  for (const a of arches) {
    const r = a.w / 2, spring = a.h - r;
    shape.lineTo(a.x - r, 0); shape.lineTo(a.x - r, spring);
    shape.absarc(a.x, spring, r, Math.PI, 0, true);
    shape.lineTo(a.x + r, 0);
  }
  shape.lineTo(hw, 0); shape.lineTo(hw - bt, h); shape.lineTo(-hw + bt, h); shape.closePath();
  const sg = new THREE.ShapeGeometry(shape, 10);
  const pa = sg.getAttribute('position'), ix = sg.getIndex()!;
  const nrm = norm([0, bt / h, 1]);
  for (const side of [1, -1]) {
    const base = b.count;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), yy = pa.getY(i) + y0;
      b.vert(side * x, yy, side * zf(yy), 0, nrm[1], side * nrm[2], side * x, yy);
    }
    for (let i = 0; i < ix.count; i += 3) b.tri(base + ix.getX(i), base + ix.getX(i + 1), base + ix.getX(i + 2));
    // side === -1 mirrors x as well as z, which is a rotation, so the winding stays outward
  }
  sg.dispose();
  // sides
  for (const sx of [1, -1]) {
    const pts: V3[] = [[sx * hw, y0, sx * hd], [sx * hw, y0, -sx * hd], [sx * (hw - bt), y0 + h, -sx * (hd - bt)], [sx * (hw - bt), y0 + h, sx * (hd - bt)]];
    b.poly(pts, [[0, y0], [2 * hd, y0], [2 * hd - bt, y0 + h], [bt, y0 + h]]);
  }
  flat(P.get(o.topKey ?? o.key), rectPoly(hw - bt, hd - bt), y0 + h);
  // tunnels
  if (!o.lod) {
    // lit passages: fixtures in the vault, the light falling off towards the floor
    const tg = o.tunnelGlow ?? 0.5, archTop = Math.max(...arches.map((a) => a.h), 1);
    P.glow((_x, y) => tg * (0.25 + 0.75 * Math.min(1, Math.max(0, (y - y0) / archTop)) ** 2), () => {
      const d = P.get('dark');
      for (const a of arches) {
        const r = a.w / 2, spring = y0 + a.h - r;
        for (const sx of [-1, 1]) {
          const x = a.x + sx * r;
          const q: V3[] = [[x, y0, -zf(y0)], [x, y0, zf(y0)], [x, spring, zf(spring)], [x, spring, -zf(spring)]];
          d.poly(sx > 0 ? q : [q[1], q[0], q[3], q[2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        d.grid(12, 1, (u, v) => { const th = u * Math.PI, yy = spring + Math.sin(th) * r; return [a.x + Math.cos(th) * r, yy, lerp(-zf(yy), zf(yy), v)]; }, (u, v) => [u, v], [0, -1, 0]);
        flat(d, rectPoly(r, hd, a.x, 0), y0 + 0.02);
      }
    });
  }
  // marble base band, cut around the tunnels
  if (o.base) {
    const bb = P.get(o.base.key), bh = o.base.h, out = o.base.out;
    const spans: [number, number][] = [];
    let x = -hw - out;
    for (const a of arches) { spans.push([x, a.x - a.w / 2]); x = a.x + a.w / 2; }
    spans.push([x, hw + out]);
    for (const side of [1, -1]) for (const [xa, xb] of spans) {
      if (xb - xa < 0.05) continue;
      const cxx = (xa + xb) / 2, w = xb - xa, z = side * (hd + out / 2 - 0.15);
      box(bb, cxx, y0 + bh * 0.16, z, w, bh * 0.32, out + 0.3, { faces: 'xXzZY' });
      box(bb, cxx, y0 + bh * 0.52, z - side * out * 0.25, w - (xa <= -hw ? 0 : 0.0), bh * 0.4, out * 0.5 + 0.3, { faces: 'xXzZY' });
      box(bb, cxx, y0 + bh * 0.86, z, w, bh * 0.28, out + 0.3, { faces: 'xXzZY' });
    }
    for (const sx of [1, -1]) {
      const xx = sx * (hw + out / 2 - 0.15);
      box(bb, xx, y0 + bh * 0.16, 0, out + 0.3, bh * 0.32, 2 * hd, { faces: 'xX' });
      box(bb, xx - sx * out * 0.25, y0 + bh * 0.52, 0, out * 0.5 + 0.3, bh * 0.4, 2 * hd, { faces: 'xX' });
      box(bb, xx, y0 + bh * 0.86, 0, out + 0.3, bh * 0.28, 2 * hd, { faces: 'xXY' });
    }
  }
  // parapet
  const top = y0 + h, ew = hw - bt, ed = hd - bt;
  const pp = o.parapet;
  if (pp && !o.lod) {
    if ('rail' in pp) balustrade(P, rectPoly(ew - 0.3, ed - 0.3), top, { closed: true, key: pp.key });
    else {
      const pb = P.get(pp.key), t = pp.t;
      for (const [cx, cz, sx, sz] of [[0, ed - t / 2, 2 * ew, t], [0, -(ed - t / 2), 2 * ew, t], [ew - t / 2, 0, t, 2 * ed - 2 * t], [-(ew - t / 2), 0, t, 2 * ed - 2 * t]] as const) {
        if (pp.crenel) {
          const along = sx > sz ? sx : sz, n = Math.floor(along / 2.2);
          box(pb, cx, top + pp.h * 0.3, cz, sx, pp.h * 0.6, sz);
          for (let i = 0; i < n; i++) {
            const f = (i + 0.5) / n - 0.5;
            box(pb, cx + (sx > sz ? f * sx : 0), top + pp.h * 0.8, cz + (sx > sz ? 0 : f * sz), sx > sz ? 1.3 : sz, pp.h * 0.4, sx > sz ? sz : 1.3);
          }
        } else box(pb, cx, top + pp.h / 2, cz, sx, pp.h, sz);
        if (pp.coping) {
          box(P.get(pp.coping), cx, top + pp.h + 0.09, cz, sx + (sx > sz ? 0.2 : 0.3), 0.18, sz + (sx > sz ? 0.3 : 0.2));
          box(P.get(pp.coping), cx, top + pp.h + 0.26, cz, sx > sz ? sx : sx * 0.5, 0.16, sx > sz ? sz * 0.5 : sz);
        }
      }
    }
  }
  return top;
}

// ---------- hall stories ------------------------------------------------------------------------

export type Fill = 'doors' | 'windows' | 'wall' | 'open' | 'mixed' | 'wallDoor';
export type Corridor = number | { front?: number; back?: number; sides?: number };
export interface StorySpec {
  y0: number;
  /** Column centre lines of the outer ring, ascending (the first and last are the corners). */
  xs: number[]; zs: number[];
  colH: number; colR: number;
  /** Walls set back from the outer columns by this much (an open 廊), per side or all round. */
  corridor?: Corridor;
  front?: Fill; back?: Fill; sides?: Fill;
  beamH?: number; bracketH?: number; bracketOut?: number;
  plinth?: boolean; lod?: boolean; wallKey?: string; colKey?: string;
}
export interface StoryOut { top: number; wall: { hw: number; hd: number; y: number }; xw: number; zw: number }

/** One storey: columns, wall fills, painted beams and the corbelled bracket band. */
export function story(P: Parts, s: StorySpec): StoryOut {
  const xmax = s.xs[s.xs.length - 1], zmax = s.zs[s.zs.length - 1];
  const r = s.colR;
  const cor = s.corridor ?? 0;
  const cf = typeof cor === 'number' ? cor : cor.front ?? 0, cb = typeof cor === 'number' ? cor : cor.back ?? 0, cs = typeof cor === 'number' ? cor : cor.sides ?? 0;
  const beamH = s.beamH ?? r * 2.2, bH = s.bracketH ?? r * 2.6, bOut = s.bracketOut ?? r * 2.4;
  const red = P.get(s.colKey ?? 'red'), paint = P.get('paint');
  const y0 = s.y0, yTop = y0 + s.colH;
  const segs = s.lod ? 6 : 10;
  const col = (x: number, z: number) => {
    cyl(red, x, y0, z, r, r * 0.93, s.colH + 0.05, segs, { top: false });
    if (s.plinth !== false && !s.lod) cyl(P.get('marble'), x, y0 - 0.02, z, r * 1.45, r * 1.3, 0.22, segs);
  };
  for (const x of s.xs) { col(x, zmax); col(x, -zmax); }
  for (const z of s.zs.slice(1, -1)) { col(xmax, z); col(-xmax, z); }
  const xw = xmax - cs, zwF = zmax - cf, zwB = zmax - cb;
  const inX = [-xw, ...s.xs.filter((x) => Math.abs(x) < xw - 0.05), xw];
  const inZ = [-zwB, ...s.zs.filter((z) => z > -zwB + 0.05 && z < zwF - 0.05), zwF];
  if (!s.lod) {
    for (const x of inX) { if (cf > 0.05) col(x, zwF); if (cb > 0.05) col(x, -zwB); }
    if (cs > 0.05) for (const z of inZ) { col(xw, z); col(-xw, z); }
    // corridor ceilings (天花), side strips full length, front/back strips between them
    const yc = yTop + beamH * 0.9;
    const ceil = (x0: number, x1: number, z0: number, z1: number) => paint.poly([[x0, yc, z0], [x1, yc, z0], [x1, yc, z1], [x0, yc, z1]], [[x0 / 3, bandV('ceil', 0.1)], [x1 / 3, bandV('ceil', 0.1)], [x1 / 3, bandV('ceil', 0.9)], [x0 / 3, bandV('ceil', 0.9)]]);
    if (cs > 0.05) { ceil(xw, xmax, -zmax, zmax); ceil(-xmax, -xw, -zmax, zmax); }
    const xa = cs > 0.05 ? xw : xmax;
    if (cf > 0.05) ceil(-xa, xa, zwF, zmax);
    if (cb > 0.05) ceil(-xa, xa, -zmax, -zwB);
  }
  // wall fills along a run of column points (x, z); the outward side is to the right of the run
  const fillRun = (fill: Fill | undefined, pts: [number, number][]) => {
    if (!fill || fill === 'open' || s.lod) return;
    const nb = pts.length - 1;
    for (let i = 0; i < nb; i++) {
      const [ax, az] = pts[i], [bx2, bz2] = pts[i + 1];
      const len = Math.hypot(bx2 - ax, bz2 - az), ux = (bx2 - ax) / len, uz = (bz2 - az) / len;
      const a: [number, number] = [ax + ux * r * 0.75, az + uz * r * 0.75], b: [number, number] = [bx2 - ux * r * 0.75, bz2 - uz * r * 0.75];
      let kind: Fill = fill;
      if (fill === 'mixed') kind = Math.abs(i - (nb - 1) / 2) <= 1 ? 'doors' : 'windows';
      if (fill === 'wallDoor') kind = Math.abs(i - (nb - 1) / 2) < 0.6 ? 'doors' : 'wall';
      const yt = yTop - Math.min(0.9, s.colH * 0.12);
      const w = len - r * 1.5;
      const quad = (key: string, y1: number, y2: number, uv: (u: number, v: number) => [number, number]) =>
        P.get(key).poly([[a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y2, b[1]], [a[0], y2, a[1]]], [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)]);
      if (kind === 'wall') quad(s.wallKey ?? 'redWall', y0, yTop, (u, v) => [u * w, y0 + v * (yTop - y0)]);
      else if (kind === 'doors') {
        quad('paint', y0, yt, (u, v) => [u * Math.max(1, Math.round(w / 5)), bandV('door', v)]);
        quad('paint', yt, yTop, (u, v) => [u * 2, bandV('board', v)]);
      } else {
        const sill = Math.min(1.1, s.colH * 0.22);
        quad(s.wallKey ?? 'redWall', y0, y0 + sill, (u, v) => [u * w, v * sill]);
        quad('paint', y0 + sill, yt, (u, v) => [u * Math.max(1, Math.round(w / 5)), bandV('window', v)]);
        quad('paint', yt, yTop, (u, v) => [u * 2, bandV('board', v)]);
      }
    }
  };
  fillRun(s.front, inX.map((x) => [x, zwF] as [number, number]));
  fillRun(s.back, [...inX].reverse().map((x) => [x, -zwB] as [number, number]));
  fillRun(s.sides, [...inZ].reverse().map((z) => [xw, z] as [number, number]));
  fillRun(s.sides, inZ.map((z) => [-xw, z] as [number, number]));
  if (s.lod) box(P.get(s.wallKey ?? 'redWall'), 0, (y0 + yTop) / 2, (zwF - zwB) / 2, 2 * xw, s.colH, zwF + zwB, { top: false });
  // beams (额枋 + 垫板) and the corbelled bracket band, per bay so the painting lines up with columns
  const X = xmax + r * 0.6, Z = zmax + r * 0.6;
  const yb0 = yTop, yb1 = yTop + beamH, yk0 = yb1, yk1 = yb1 + bH;
  const bandSide = (pos: number[], lim: number, other: number, place: (a: number, y: number, o: number) => V3) => {
    const p = [-lim, ...pos.slice(1, -1), lim];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], bb = p[i + 1];
      const first = i === 0, last = i === p.length - 2;
      paint.poly([place(a, yb0, other), place(bb, yb0, other), place(bb, yb1 - beamH * 0.3, other), place(a, yb1 - beamH * 0.3, other)],
        [[0, bandV('beam', 0)], [1, bandV('beam', 0)], [1, bandV('beam', 1)], [0, bandV('beam', 1)]]);
      paint.poly([place(a, yb1 - beamH * 0.3, other), place(bb, yb1 - beamH * 0.3, other), place(bb, yb1, other), place(a, yb1, other)],
        [[0, bandV('board', 0)], [2, bandV('board', 0)], [2, bandV('board', 1)], [0, bandV('board', 1)]]);
      if (s.lod) continue;
      const a1 = first ? a - bOut : a, b1 = last ? bb + bOut : bb;
      const nSets = Math.max(1, Math.round((bb - a) / (bH * 0.75 * 6)));
      paint.poly([place(a, yk0, other), place(bb, yk0, other), place(b1, yk1, other + bOut), place(a1, yk1, other + bOut)],
        [[0, bandV('bracket', 0)], [nSets, bandV('bracket', 0)], [nSets, bandV('bracket', 1)], [0, bandV('bracket', 1)]]);
      paint.poly([place(a, yb0, other - r * 1.2), place(bb, yb0, other - r * 1.2), place(bb, yb0, other), place(a, yb0, other)],
        [[0, bandV('solidBlue', 0.5)], [1, bandV('solidBlue', 0.5)], [1, bandV('solidBlue', 0.5)], [0, bandV('solidBlue', 0.5)]]);
    }
  };
  bandSide(s.xs, X, Z, (a, y, o) => [a, y, o]);
  bandSide(s.xs, X, Z, (a, y, o) => [-a, y, -o]);
  bandSide(s.zs, Z, X, (a, y, o) => [o, y, -a]);
  bandSide(s.zs, Z, X, (a, y, o) => [-o, y, a]);
  return { top: yk1, wall: { hw: X + bOut, hd: Z + bOut, y: yk1 }, xw, zw: zwF };
}

// ---------- whole halls --------------------------------------------------------------------------

export interface HallRoof {
  kind: 'hip' | 'hipGable' | 'pyramid';
  tile: TileColor; trim?: TileColor;
  /** Eave overhang beyond the bracket band, and ridge height above the eave. */
  overhang: number; rise: number;
  curve?: number; lift?: number; flare?: number; span?: number; beasts?: number; ridgeH?: number; hipR?: number; ridge?: number; finial?: number; chiwen?: boolean;
}
export interface HallSpec {
  y0: number; xs: number[]; zs: number[]; colH: number; colR: number;
  corridor?: Corridor; front?: Fill; back?: Fill; sides?: Fill;
  beamH?: number; bracketH?: number; bracketOut?: number;
  roof: HallRoof;
  /** 重檐: an upper storey set in by `inset`, `h` tall above the skirt, with its own fills. */
  double?: { inset: number; insetZ?: number; h: number; skirtRise: number; overhang?: number; front?: Fill; back?: Fill; sides?: Fill; colR?: number };
  lod?: boolean; res?: number;
}

export function hall(P: Parts, s: HallSpec): { top: number; eaveY: number[] } {
  const res = s.res ?? (s.lod ? 0.25 : 1);
  const st1 = story(P, { y0: s.y0, xs: s.xs, zs: s.zs, colH: s.colH, colR: s.colR, corridor: s.corridor, front: s.front, back: s.back, sides: s.sides, beamH: s.beamH, bracketH: s.bracketH, bracketOut: s.bracketOut, lod: s.lod });
  const R = s.roof;
  const common = { curve: R.curve, beasts: R.beasts, hipR: R.hipR, tile: R.tile, trim: R.trim, res, lod: s.lod } as const;
  let top = st1;
  const eaveY: number[] = [];
  if (s.double) {
    const d = s.double;
    const xm = s.xs[s.xs.length - 1] - d.inset, zm = s.zs[s.zs.length - 1] - (d.insetZ ?? d.inset);
    const ov = d.overhang ?? R.overhang;
    const yIn = st1.top + d.skirtRise;
    roof(P, {
      ...common, kind: R.kind === 'pyramid' ? 'pyramid' : 'hip', y0: st1.top + 0.15, y1: yIn,
      hw: st1.wall.hw + ov, hd: st1.wall.hd + ov, inner: { hw: xm + s.colR, hd: zm + s.colR, y: yIn }, wall: st1.wall,
      lift: R.lift !== undefined ? R.lift * 0.85 : undefined, flare: R.flare, span: R.span !== undefined ? R.span * 0.9 : undefined,
    } as RoofSpec);
    eaveY.push(st1.top + 0.15);
    const xs2 = [-xm, ...s.xs.filter((x) => Math.abs(x) < xm - 0.1), xm];
    const zs2 = [-zm, ...s.zs.filter((z) => Math.abs(z) < zm - 0.1), zm];
    top = story(P, { y0: yIn - 0.5, xs: xs2, zs: zs2, colH: d.h + 0.5, colR: d.colR ?? s.colR * 0.9, front: d.front ?? 'wall', back: d.back ?? 'wall', sides: d.sides ?? 'wall', beamH: s.beamH, bracketH: s.bracketH, bracketOut: s.bracketOut, plinth: false, lod: s.lod });
  }
  roof(P, {
    ...common, kind: R.kind, y0: top.top + 0.15, y1: top.top + 0.15 + R.rise, hw: top.wall.hw + R.overhang, hd: top.wall.hd + R.overhang,
    wall: top.wall, lift: R.lift, flare: R.flare, span: R.span, ridgeH: R.ridgeH, ridge: R.ridge, finial: R.finial, chiwen: R.chiwen,
  } as RoofSpec);
  eaveY.push(top.top + 0.15);
  return { top: top.top + 0.15 + R.rise, eaveY };
}

/** Even bay layout: `n` bays, the centre `nc` of width `wc`, the rest shrinking towards the ends. */
export function bays(n: number, total: number, endRatio = 0.75): number[] {
  // widths: centre bay 1, falling off linearly to endRatio at the ends
  const w: number[] = [];
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) w.push(1 - (1 - endRatio) * (Math.abs(i - mid) / Math.max(1, mid)));
  const sum = w.reduce((a, b) => a + b, 0);
  const out: number[] = [-total / 2];
  let x = -total / 2;
  for (let i = 0; i < n; i++) { x += (w[i] / sum) * total; out.push(x); }
  out[out.length - 1] = total / 2;
  return out;
}


// ---------- round storeys (祈年殿, 皇穹宇) -------------------------------------------------------------

export interface RoundStorySpec {
  y0: number; r: number; n: number; colH: number; colR: number;
  fill?: Fill; beamH?: number; bracketH?: number; bracketOut?: number; plinth?: boolean; lod?: boolean;
}

/** A ring of `n` columns (a bay centred on +z, the south door), fills, beam ring and bracket ring. */
export function roundStory(P: Parts, s: RoundStorySpec): StoryOut {
  const { y0, r, n, colH } = s, cr = s.colR;
  const beamH = s.beamH ?? cr * 2, bH = s.bracketH ?? cr * 2.4, bOut = s.bracketOut ?? cr * 2.4;
  const red = P.get('red'), paint = P.get('paint');
  const ang = (i: number) => Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
  const yTop = y0 + colH;
  for (let i = 0; i < n; i++) {
    const a = ang(i), x = Math.cos(a) * r, z = Math.sin(a) * r;
    cyl(red, x, y0, z, cr, cr * 0.93, colH + 0.05, s.lod ? 6 : 10, { top: false });
    if (s.plinth !== false && !s.lod) cyl(P.get('marble'), x, y0 - 0.02, z, cr * 1.45, cr * 1.3, 0.22, 10);
  }
  const at = (a: number, rr: number, y: number): V3 => [Math.cos(a) * rr, y, Math.sin(a) * rr];
  const fill = s.lod ? 'wall' : s.fill ?? 'doors';
  for (let i = 0; i < n; i++) {
    const a0 = ang(i - 1) + (cr * 0.8) / r, a1 = ang(i) - (cr * 0.8) / r, rw = r * Math.cos(Math.PI / n) - 0.05;
    // chord between two columns, facing out (points ordered with increasing angle seen from outside)
    const q = (key: string, ya: number, yb: number, v0: number, v1: number, us: number) =>
      P.get(key).poly([at(a1, rw, ya), at(a0, rw, ya), at(a0, rw, yb), at(a1, rw, yb)], [[0, v0], [us, v0], [us, v1], [0, v1]]);
    const yt = yTop - Math.min(0.8, colH * 0.12);
    if (fill === 'wall') q(s.lod ? 'red' : 'redWall', y0, yTop, y0, yTop, 1);
    else if (fill === 'doors') { q('paint', y0, yt, bandV('door', 0), bandV('door', 1), 1); q('paint', yt, yTop, bandV('board', 0), bandV('board', 1), 2); }
    else if (fill === 'windows') {
      const sill = Math.min(0.9, colH * 0.25);
      q('redWall', y0, y0 + sill, 0, sill, 1);
      q('paint', y0 + sill, yt, bandV('window', 0), bandV('window', 1), 1);
      q('paint', yt, yTop, bandV('board', 0), bandV('board', 1), 2);
    }
  }
  const R0 = r + cr * 0.6;
  const yb1 = yTop + beamH, yk1 = yb1 + bH;
  for (let i = 0; i < n; i++) {
    const a0 = ang(i - 1), a1 = ang(i);
    paint.poly([at(a1, R0, yTop), at(a0, R0, yTop), at(a0, R0, yb1 - beamH * 0.3), at(a1, R0, yb1 - beamH * 0.3)], [[0, bandV('beam', 0)], [1, bandV('beam', 0)], [1, bandV('beam', 1)], [0, bandV('beam', 1)]]);
    paint.poly([at(a1, R0, yb1 - beamH * 0.3), at(a0, R0, yb1 - beamH * 0.3), at(a0, R0, yb1), at(a1, R0, yb1)], [[0, bandV('board', 0)], [2, bandV('board', 0)], [2, bandV('board', 1)], [0, bandV('board', 1)]]);
    if (!s.lod) {
      const sets = Math.max(1, Math.round((2 * Math.PI * R0) / n / (bH * 0.75 * 6)));
      paint.poly([at(a1, R0, yb1), at(a0, R0, yb1), at(a0, R0 + bOut, yk1), at(a1, R0 + bOut, yk1)], [[0, bandV('bracket', 0)], [sets, bandV('bracket', 0)], [sets, bandV('bracket', 1)], [0, bandV('bracket', 1)]]);
    }
  }
  return { top: yk1, wall: { hw: R0 + bOut, hd: 0, y: yk1 }, xw: r, zw: r };
}

// ---------- polygon terraces (三台, 午门) ---------------------------------------------------------------

/** Offset a simple polygon (x, z) inwards by d (negative: outwards). Returned counter-clockwise (maths). */
export function offsetPoly(poly: [number, number][], d: number): [number, number][] {
  const v = poly.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(v)) v.reverse();
  const n = v.length, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = v[(i - 1 + n) % n], p1 = v[i], p2 = v[(i + 1) % n];
    const e0 = p1.clone().sub(p0).normalize(), e1 = p2.clone().sub(p1).normalize();
    const n0 = new THREE.Vector2(-e0.y, e0.x), n1 = new THREE.Vector2(-e1.y, e1.x);   // left = inwards for CCW
    const a = p0.clone().addScaledVector(n0, d), b = p1.clone().addScaledVector(n1, d);
    const cr = e0.x * e1.y - e0.y * e1.x;
    if (Math.abs(cr) < 1e-6) { out.push([p1.x + n1.x * d, p1.y + n1.y * d]); continue; }
    const t = ((b.x - a.x) * e1.y - (b.y - a.y) * e1.x) / cr;
    out.push([a.x + e0.x * t, a.y + e0.y * t]);
  }
  return out;
}

/** Sumeru-profiled block over any simple polygon. */
export function sumeruPoly(P: Parts, key: string, poly: [number, number][], y0: number, h: number, o: { plain?: boolean; top?: string | false } = {}): void {
  const b = P.get(key), s = Math.min(1, h / 1.6);
  const prof = o.plain ? [[0, 0], [0, 1]] as [number, number][] : SUMERU;
  const ring = (inset: number) => offsetPoly(poly, inset).reverse();   // clockwise: edges face out
  for (let k = 0; k < prof.length - 1; k++) {
    const r0 = ring(prof[k][0] * s), r1 = ring(prof[k + 1][0] * s), ya = y0 + prof[k][1] * h, yb = y0 + prof[k + 1][1] * h;
    let u = 0;
    for (let e = 0; e < r0.length; e++) {
      const f = (e + 1) % r0.length, w = Math.hypot(r0[f][0] - r0[e][0], r0[f][1] - r0[e][1]);
      b.poly([[r0[e][0], ya, r0[e][1]], [r0[f][0], ya, r0[f][1]], [r1[f][0], yb, r1[f][1]], [r1[e][0], yb, r1[e][1]]], [[u, ya], [u + w, ya], [u + w, yb], [u, yb]]);
      u += w;
    }
  }
  if (o.top !== false) flat(P.get(o.top ?? key), poly, y0 + h);
}

/** A stair flight whose top step meets a face at (x, z); ry turns local +z (outwards) into the world. */
export interface StairAt { x: number; z: number; ry: number; w: number; ramp?: number }
export function stairFlight(P: Parts, key: string, st: StairAt, y0: number, y1: number, rise = 0.15, tread = 0.32): number {
  const b = P.get(key);
  const n = Math.max(2, Math.round((y1 - y0) / rise)), rr = (y1 - y0) / n, run = n * tread, hw = st.w / 2;
  P.push(new THREE.Matrix4().makeRotationY(st.ry).setPosition(st.x, 0, st.z));
  for (let i = 0; i < n; i++) {
    const yt = y0 + (i + 1) * rr, zf = run - i * tread, zb = zf - tread;
    b.quadM([-hw, yt - rr, zf], [hw, yt - rr, zf], [hw, yt, zf], [-hw, yt, zf]);
    b.quadM([-hw, yt, zf], [hw, yt, zf], [hw, yt, zb - 0.02], [-hw, yt, zb - 0.02]);
  }
  for (const sx of [-1, 1]) {
    const x0 = sx * (hw + 0.3), w = 0.3;
    hexa(b, [[x0 - w, y0, -0.05], [x0 + w, y0, -0.05], [x0 + w, y0, run], [x0 - w, y0, run], [x0 - w, y1 + 0.15, -0.05], [x0 + w, y1 + 0.15, -0.05], [x0 + w, y0 + rr + 0.12, run], [x0 - w, y0 + rr + 0.12, run]]);
  }
  if (st.ramp) {
    const rw = st.ramp / 2, yA = y0 + rr + 0.06, yB = y1 + 0.06;
    hexa(b, [[-rw, y0, -0.02], [rw, y0, -0.02], [rw, y0, run], [-rw, y0, run], [-rw, yB, -0.02], [rw, yB, -0.02], [rw, yA, run], [-rw, yA, run]]);
  }
  P.pop();
  return run;
}

export interface PolyTier { poly: [number, number][]; h: number; stairs?: StairAt[] }
/** Stepped marble terrace over polygons, with balustrades, spouts and explicit stair flights. Returns the top. */
export function polyTerrace(P: Parts, o: { tiers: PolyTier[]; key?: string; topKey?: string; rail?: boolean; railStep?: number; spouts?: boolean; lod?: boolean; rise?: number; tread?: number }): number {
  const key = o.key ?? 'marble';
  let y = 0;
  for (const t of o.tiers) {
    sumeruPoly(P, key, t.poly, y, t.h, { plain: o.lod, top: o.topKey ?? key });
    const yTop = y + t.h;
    if (!o.lod) {
      for (const st of t.stairs ?? []) stairFlight(P, key, st, y, yTop, o.rise, o.tread);
      if (o.rail !== false) {
        const gap = (x: number, z: number) => (t.stairs ?? []).some((st) => {
          const dx = x - st.x, dz = z - st.z, c = Math.cos(st.ry), s2 = Math.sin(st.ry);
          const lx = dx * c - dz * s2, lz = dx * s2 + dz * c;
          return Math.abs(lx) < st.w / 2 + 0.45 && Math.abs(lz) < 2.0;
        });
        balustrade(P, offsetPoly(t.poly, 0.28), yTop, { closed: true, gap, step: o.railStep ?? 2.0, spout: o.spouts ? { y: yTop - 0.25, len: 0.9 } : undefined, key });
      }
    }
    y = yTop;
  }
  return y;
}
