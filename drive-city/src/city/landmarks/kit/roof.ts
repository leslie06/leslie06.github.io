import * as THREE from 'three';
import { Parts, V3, lerp, clamp, tube, box, extrude, lathe, lerp3, dist, norm, sub } from './geo';
import { bandV } from './tex';
import type { TileColor } from './mats';

/**
 * Chinese roofs: 庑殿 hipped (`hip`), 歇山 hip-and-gable (`hipGable`), 攒尖 pyramidal (`pyramid`),
 * round conical (`round`), and the skirt of a double eave (any rectangular kind with `inner`).
 *
 * The roof is lofted through contours: at parameter t (0 eave .. 1 ridge) the contour is a
 * rectangle of half-size (A(t), B(t)) at height Y(t). Y follows a concave 举折 profile (shallow at
 * the eave, steep at the ridge). Near the corners every point is displaced up and outwards (翼角
 * 起翘/出翘) by an amount that depends only on its distance to the corner along the eave, so the two
 * slopes meeting at a hip get identical displacement and stay welded.
 */
export interface RoofSpec {
  kind: 'hip' | 'hipGable' | 'pyramid' | 'round';
  /** Eave (tile surface at the eave line) and ridge / apex heights. */
  y0: number; y1: number;
  /** Eave outline half-extents (round: hw is the radius). */
  hw: number; hd: number;
  /** hip: half-length of the main ridge; hipGable: x of the gable; round: radius at the top. */
  ridge?: number;
  /** Skirt of a double eave: the roof stops at this contour (round: hw is the radius). */
  inner?: { hw: number; hd: number; y: number };
  /** Top of the bracket band: the soffit runs from the eave in to here. */
  wall: { hw: number; hd: number; y: number };
  /** 0 straight .. ~0.8 strongly concave. */
  curve?: number;
  lift?: number; flare?: number; span?: number;
  thick?: number;
  tile: TileColor;
  /** 剪边: eave rows and ridges in this colour (grey roofs trimmed green). */
  trim?: TileColor;
  ridgeH?: number; ridgeW?: number; hipR?: number; beasts?: number; chiwen?: boolean;
  /** Finial height at the apex (pyramid / round). */
  finial?: number; finialMat?: string;
  gableInset?: number;
  res?: number;
  /** Far LOD: coarse, no soffit or ornaments. */
  lod?: boolean;
}

const TK = (c: TileColor) => 'tile' + c;
const GK = (c: TileColor) => 'glz' + c;

export function roof(P: Parts, s: RoofSpec): void {
  if (s.kind === 'round') { roundRoof(P, s); return; }
  const res = s.res ?? 1, lod = !!s.lod;
  const k = s.curve ?? 0.5;
  const prof = (t: number) => t + k * (t * t - t);
  const inner = s.inner;
  const hw = s.hw, hd = s.hd;
  let R = 0, G = 0, tg = 1;
  if (s.kind === 'hip') R = s.ridge ?? Math.max(0.5, hw - hd * 0.85);
  if (s.kind === 'hipGable') { G = s.ridge ?? hw - hd * 0.45; tg = clamp((hw - G) / hd, 0.12, 0.85); }
  const A = (t: number) => inner ? lerp(hw, inner.hw, t) : s.kind === 'hip' ? lerp(hw, R, t) : s.kind === 'pyramid' ? lerp(hw, 0, t) : (t < tg ? lerp(hw, G, t / tg) : G);
  const B = (t: number) => inner ? lerp(hd, inner.hd, t) : lerp(hd, 0, t);
  const Y = (t: number) => lerp(s.y0, inner ? inner.y : s.y1, prof(t));
  const sc = Math.min(hw, hd);
  const lift = s.lift ?? sc * 0.07;
  const flare = s.flare ?? lift * 0.7;
  const span = s.span ?? sc * 0.6;
  const tf = inner ? 0.75 : s.kind === 'hipGable' ? Math.min(0.55, tg) : 0.55;
  const fade = (t: number) => { const f = 1 - Math.min(t / tf, 1); return f * f; };
  const thick = s.thick ?? clamp(sc * 0.035, 0.25, 0.6);
  const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  // side 0 front (+z), 1 right (+x), 2 back (-z), 3 left (-x)
  const pt = (side: number, u: number, t: number, drop = 0): V3 => {
    const a = A(t), b = B(t);
    let x: number, z: number, d: number;
    if (side === 0 || side === 2) { x = u * a; z = (side === 0 ? 1 : -1) * b; d = a * (1 - Math.abs(u)); }
    else { x = (side === 1 ? 1 : -1) * a; z = u * b; d = b * (1 - Math.abs(u)); }
    const c = clamp(1 - d / span, 0, 1), m = c * c * fade(t);
    return [x + sgn(x) * flare * m, Y(t) + lift * m - drop, z + sgn(z) * flare * m];
  };
  const OUT: V3[] = [[0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0]];
  const trimC = s.trim ?? s.tile;
  const main = P.get(TK(s.tile)), trim = P.get(TK(trimC));
  const lenF = Math.hypot(hd - B(1), Y(1) - Y(0));
  const tEndSide = s.kind === 'hipGable' && !inner ? tg : 1;
  const lenS = Math.hypot(hw - A(tEndSide), Y(tEndSide) - Y(0)) / tEndSide;
  for (let side = 0; side < 4; side++) {
    const fb = side === 0 || side === 2;
    const half = fb ? hw : hd, L = fb ? lenF : lenS, tEnd = fb ? 1 : tEndSide;
    const nu = Math.max(4, Math.ceil((2 * half / 1.1) * res));
    const tTrim = s.trim ? Math.min(0.5, 1.4 / L) : 0;
    const uv = (u: number, t: number): [number, number] => {
      const a = fb ? A(t) : B(t);
      return [(u * 2 - 1) * a * (side === 0 || side === 3 ? 1 : -1), t * L];
    };
    const rows = (t0: number, t1: number, buf: typeof main) => {
      const nv = Math.max(2, Math.ceil(((t1 - t0) * L / 1.2) * res));
      buf.grid(nu, nv, (u, v) => pt(side, u * 2 - 1, lerp(t0, t1, v)), (u, v) => uv(u, lerp(t0, t1, v)), OUT[side]);
    };
    if (tTrim > 0) { rows(0, tTrim, trim); rows(tTrim, tEnd, main); } else rows(0, tEnd, main);
    // fascia (eave edge) and soffit
    const glz = P.get(GK(trimC));
    glz.grid(nu, 1, (u, v) => pt(side, u * 2 - 1, 0, v * thick), (u, v) => [u * half * 2, v * thick], [OUT[side][0], 0, OUT[side][2]]);
    if (!lod) {
      const w = s.wall;
      const innerPt = (u: number): V3 => fb ? [u * w.hw, w.y, (side === 0 ? 1 : -1) * w.hd] : [(side === 1 ? 1 : -1) * w.hw, w.y, u * w.hd];
      P.get('paint').grid(nu, 1, (u, v) => lerp3(pt(side, u * 2 - 1, 0, thick), innerPt(u * 2 - 1), v),
        (u, v) => [(u * 2 - 1) * half / 5.6, bandV('soffit', v)], [0, -1, 0]);
    }
  }
  // gables of a 歇山
  if (s.kind === 'hipGable' && !inner) {
    const inset = s.gableInset ?? clamp(sc * 0.06, 0.4, 1.0);
    const red = P.get('red');
    for (const sx of [1, -1]) {
      const x = sx * (G - inset), n = 8;
      red.grid(1, n, (u, v) => { const t = lerp(tg, 1, v); return [x, Y(t) - 0.1, lerp(B(t), -B(t), u) * 0.995]; }, (u, v) => [u * hd, v * 6], [sx, 0, 0]);
      if (!lod) {
        // 博脊 along the top of the small side slope
        box(P.get(GK(trimC)), sx * (G - inset / 2), Y(tg) + 0.15, 0, inset + 0.3, 0.55, 2 * B(tg) * 0.98);
      }
    }
  }
  if (lod) {
    if (s.kind === 'hip' || s.kind === 'hipGable') {
      const ridgeEnd = s.kind === 'hip' ? R : G;
      box(P.get(GK(trimC)), 0, Y(1) + 0.3, 0, ridgeEnd * 2, 0.9, 0.9);
    }
    return;
  }
  // ridges
  const glz = P.get(GK(trimC));
  const hipR = s.hipR ?? clamp(sc * 0.022, 0.18, 0.36);
  const sizeK = hipR / 0.3;
  const seam = (sx: number, sz: number, t: number): V3 => {
    const m = fade(t);
    return [sx * (A(t) + flare * m), Y(t) + lift * m + hipR * 0.6, sz * (B(t) + flare * m)];
  };
  const tHipEnd = s.kind === 'hipGable' && !inner ? tg : 1;
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const pts: V3[] = [];
    const n = Math.max(6, Math.ceil(14 * res));
    // upturned tip beyond the corner
    const c0 = seam(sx, sz, 0);
    pts.push([c0[0] + sx * 0.45 * sizeK, c0[1] + 0.4 * sizeK, c0[2] + sz * 0.45 * sizeK]);
    for (let i = 0; i <= n; i++) pts.push(seam(sx, sz, (i / n) * tHipEnd));
    if (s.kind === 'pyramid' && !inner) pts[pts.length - 1] = [0, Y(1) + hipR * 0.6, 0];
    tube(glz, pts, hipR, 6);
    // beasts (仙人走兽) on the lower end, walking up the ridge
    const nb = s.beasts ?? 0;
    if (nb > 0) {
      let acc = 0, k2 = 1;
      for (let b = 0; b <= nb && k2 < pts.length - 1; b++) {
        const target = 0.55 * sizeK + b * 0.5 * sizeK;
        while (k2 < pts.length - 1 && acc + dist(pts[k2 - 1], pts[k2]) < target) { acc += dist(pts[k2 - 1], pts[k2]); k2++; }
        const f = (target - acc) / Math.max(1e-6, dist(pts[k2 - 1], pts[k2]));
        const p = lerp3(pts[k2 - 1], pts[k2], clamp(f, 0, 1));
        const dir = norm(sub(pts[k2], pts[k2 - 1]));
        const yaw = Math.atan2(-dir[2], dir[0]);
        const big = b === 0 ? 1.25 : 1;
        P.at(p[0], p[1] + hipR * 0.8, p[2], yaw, () => box(glz, 0, 0.2 * sizeK * big, 0, 0.3 * sizeK * big, 0.42 * sizeK * big, 0.16 * sizeK));
      }
    }
  }
  if (s.kind === 'hipGable' && !inner) {
    // 垂脊 down the gable edges, with a 垂兽 block at the bottom
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) { const t = lerp(tg, 1, i / 8); pts.push([sx * G, Y(t) + hipR * 0.7, sz * B(t)]); }
      tube(glz, pts, hipR * 1.15, 6);
      box(glz, sx * G, Y(tg) + hipR * 2, sz * B(tg), hipR * 2.4, hipR * 3.2, hipR * 2.4);
    }
  }
  if ((s.kind === 'hip' || s.kind === 'hipGable') && !inner) {
    const ridgeEnd = s.kind === 'hip' ? R : G;
    const rh = s.ridgeH ?? clamp(sc * 0.09, 0.5, 1.8), rw = s.ridgeW ?? rh * 0.5;
    box(glz, 0, Y(1) + rh / 2 - 0.15, 0, ridgeEnd * 2, rh + 0.3, rw);
    box(glz, 0, Y(1) + rh + 0.05, 0, ridgeEnd * 2, 0.22, rw * 1.25);
    if (s.chiwen !== false) for (const sx of [1, -1]) chiwen(P, GK(trimC), sx * ridgeEnd, Y(1) - 0.2, rh * 2.3, rw * 1.2, sx);
  }
  if (s.kind === 'pyramid' && !inner && (s.finial ?? 0) > 0) finial(P, s.finialMat ?? 'gold', 0, Y(1), 0, s.finial!);
}

/** 正吻: the dragon-head ridge ornament, as an extruded silhouette facing along the ridge. */
function chiwen(P: Parts, key: string, x: number, y: number, h: number, depth: number, side: number): void {
  const w = h * 0.72;
  const s = new THREE.Shape();
  // outline in (outward, up): 0 = inner face biting the ridge, w = outer face
  const pts: [number, number][] = [
    [0, 0], [w * 0.95, 0], [w, 0.35], [w * 0.92, 0.62], [w * 1.08, 0.8], [w * 1.02, 0.97], [w * 0.8, 1.0], [w * 0.68, 0.86],
    [w * 0.78, 0.78], [w * 0.72, 0.7], [w * 0.5, 0.78], [w * 0.4, 0.93], [w * 0.22, 0.9], [w * 0.2, 0.74], [w * 0.05, 0.66],
    [0, 0.5], [w * 0.14, 0.42], [w * 0.02, 0.3], [0, 0.12],
  ];
  pts.forEach(([px, py], i) => (i ? s.lineTo(px, py * h) : s.moveTo(px, py * h)));
  s.closePath();
  const m = new THREE.Matrix4().makeScale(side, 1, 1).setPosition(x - side * w * 0.35, y, 0);
  extrude(P.get(key), s, depth, m, 2);
}

/** 宝顶: gilded finial (base, waist, ball), `h` tall, standing on (x, y, z). */
export function finial(P: Parts, key: string, x: number, y: number, z: number, h: number): void {
  const r = h * 0.22;
  const prof: [number, number][] = [[r * 1.3, 0], [r * 1.35, h * 0.08], [r * 0.7, h * 0.16], [r * 0.55, h * 0.26], [r * 0.95, h * 0.36],
    [r * 1.0, h * 0.5], [r * 0.9, h * 0.66], [r * 0.55, h * 0.8], [r * 0.25, h * 0.92], [0.02, h]];
  lathe(P.get(key), prof.map(([pr, py]) => [pr, py + y] as [number, number]), 12, x, z);
}

function roundRoof(P: Parts, s: RoofSpec): void {
  const res = s.res ?? 1, lod = !!s.lod;
  const R0 = s.hw, Rt = s.inner ? s.inner.hw : (s.ridge ?? 0.8), y1 = s.inner ? s.inner.y : s.y1;
  const k = s.curve ?? 0.35;
  const prof = (t: number) => t + k * (t * t - t);
  const lift = s.lift ?? R0 * 0.025, tf = 0.45;
  const thick = s.thick ?? clamp(R0 * 0.03, 0.25, 0.5);
  const pt = (a: number, t: number, drop = 0): V3 => {
    const f = 1 - Math.min(t / tf, 1), m = f * f;
    const r = lerp(R0, Rt, t) + lift * 0.4 * m;
    return [Math.cos(a) * r, lerp(s.y0, y1, prof(t)) + lift * m - drop, Math.sin(a) * r];
  };
  const segs = Math.max(16, Math.round(72 * res));
  const L = Math.hypot(R0 - Rt, y1 - s.y0);
  const nv = Math.max(3, Math.ceil((L / 1.3) * res));
  const A = (u: number) => u * Math.PI * 2;
  P.get(TK(s.tile)).grid(segs, nv, (u, v) => pt(A(u), v), (u, v) => [A(u) * R0, v * L], [-1, 0.6, 0]);
  P.get(GK(s.trim ?? s.tile)).grid(segs, 1, (u, v) => pt(A(u), 0, v * thick), (u, v) => [A(u) * R0, v], [-1, 0, 0]);
  if (!lod) {
    const w = s.wall;
    P.get('paint').grid(segs, 1, (u, v) => lerp3(pt(A(u), 0, thick), [Math.cos(A(u)) * w.hw, w.y, Math.sin(A(u)) * w.hw], v),
      (u, v) => [A(u) * R0 / 5.6, bandV('soffit', v)], [0, -1, 0]);
  }
  if (!s.inner && (s.finial ?? 0) > 0) finial(P, s.finialMat ?? 'gold', 0, y1, 0, s.finial!);
}
