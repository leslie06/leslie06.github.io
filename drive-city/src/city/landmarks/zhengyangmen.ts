import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, rectPoly, floodGlow } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { gatePlatform, hall, story, terrace, balustrade, type HallSpec } from './kit/hall';
import { roof } from './kit/roof';
import { assemble } from './kit/model';
import { plaque, plaqueMaterial, archHood } from './kit/props2';

/**
 * 正阳门 (前门) — two defs:
 *  - the gate tower 城楼: grey brick platform 100 x 31 m, 14.7 m, one arched gateway; 7 x 3 bay tower
 *    with a surrounding colonnade, red brick walls below and lattice doors above, double-eaved 歇山
 *    roof of grey tiles trimmed in green glaze (灰筒瓦绿琉璃剪边), 42 m overall;
 *  - the arrow tower 箭楼 190 m south: 12 m battered platform with a white balustrade, a 62 x 20 m
 *    grey brick keep pierced by 94 arrow windows in four rows (the lower two with the white arched
 *    hoods of 1915), a five-bay 抱厦 on the north, the same roofing, 38 m overall.
 * Local frame: +X east, +Z south (both face south down 前门大街).
 */

// ---------- gate tower -------------------------------------------------------------------------
const GP = { hw: 50, hd: 15.7, h: 14.7, batter: 1.1 };
const xsG = [-20.5, -17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5, 20.5];
const zsG = [-10.5, -7.5, -2.5, 2.5, 7.5, 10.5];

function gateHall(y0: number, lod: boolean): HallSpec {
  return {
    y0, xs: xsG, zs: zsG, colH: 6.0, colR: 0.42, corridor: 3.0,
    front: 'wallDoor', back: 'wallDoor', sides: 'wallDoor', beamH: 0.9, bracketH: 1.1, bracketOut: 1.1,
    roof: { kind: 'hipGable', tile: 'K', trim: 'G', overhang: 3.3, rise: 7.2, curve: 0.62, lift: 1.3, beasts: 7 },
    double: { inset: 3.0, h: 3.6, skirtRise: 2.6, front: 'doors', back: 'doors', sides: 'wall' },
    lod,
  };
}

function buildGate(env: EnvUniforms): LandmarkModel {
  const mats = { ...landmarkMaterials(env), zymPlaque: plaqueMaterial(env, '正陽門') };
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.15, front: 0.25, under: 0.9, top: 0.2, foot: 0.65, footH: 6, above: 0.35, aboveY: 14.8 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  const top = gatePlatform(P, { ...GP, key: 'brick', arches: [{ x: 0, w: 6.6, h: 9.6 }], parapet: { h: 1.1, t: 0.9, key: 'brick', coping: 'glzK' }, topKey: 'paving', tunnelGlow: 0.14 });
  const base = terrace(P, { tiers: [{ hw: 23.8, hd: 13.8, h: 0.9 }], y0: top, key: 'brick', topKey: 'paving', rail: false, sumeru: false });
  const spec = gateHall(base, false);
  const res = hall(P, spec);
  plaque(P, 'zymPlaque', 0, res.eaveY[1] - 2.3, 10.5 - 3.0 + 0.42 + 1.2, 1.7, 3.2);
  // far
  gatePlatform(F, { ...GP, key: 'brick', lod: true });
  hall(F, gateHall(GP.h + 0.9, true));
  const colliders: ColliderSpec[] = [
    { kind: 'box', center: [-(50 + 3.3) / 2, 7.35, 0], half: [(50 - 3.3) / 2, 7.35, GP.hd] },
    { kind: 'box', center: [(50 + 3.3) / 2, 7.35, 0], half: [(50 - 3.3) / 2, 7.35, GP.hd] },
    { kind: 'box', center: [0, (9.6 + 15.8) / 2, 0], half: [3.3, (15.8 - 9.6) / 2, GP.hd] },
    { kind: 'box', center: [0, 27, 0], half: [22, 12, 12] },
  ];
  return assemble({ name: 'zhengyangmen', detail: P, far: F, mats, colliders, footprint: rectPoly(GP.hw + 0.5, GP.hd + 0.5), height: 42 });
}

// ---------- arrow tower --------------------------------------------------------------------------
const AP = { hw: 31, hd: 18.2, h: 12, batter: 1.4 };
// keep: x in [-29, 29], z in [-4, 16]; 抱厦 on the north: x in [-21, 21], z in [-16, -4]
const KEEP = { x0: -29, x1: 29, z0: -3.4, z1: 15.4, y1: 26.6 };

function arrowWindows(P: Parts, faceZ: number, xs: number[], rows: number[], hoodRows: number, ry: number, cx: number, cz: number): void {
  P.at(cx, 0, cz, ry, () => {
    P.glow(0.05, () => {
      for (const y of rows) for (const x of xs) P.get('dark').poly([[x - 0.55, y - 0.6, faceZ + 0.03], [x + 0.55, y - 0.6, faceZ + 0.03], [x + 0.55, y + 0.6, faceZ + 0.03], [x - 0.55, y + 0.6, faceZ + 0.03]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    });
    rows.forEach((y, ri) => {
      for (const x of xs) {
        const b = P.get('plaster');
        box(b, x, y - 0.72, faceZ + 0.08, 1.5, 0.16, 0.2);                 // sill
        box(b, x - 0.66, y, faceZ + 0.06, 0.16, 1.3, 0.14, { faces: 'xXZY' });
        box(b, x + 0.66, y, faceZ + 0.06, 0.16, 1.3, 0.14, { faces: 'xXZY' });
        if (ri < hoodRows) archHood(P, 'plaster', x, y + 0.66, faceZ, 0.95, 0.35);
        else box(b, x, y + 0.7, faceZ + 0.06, 1.5, 0.16, 0.14);
      }
    });
  });
}

function buildArrow(env: EnvUniforms): LandmarkModel {
  const mats = landmarkMaterials(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.15, front: 0.25, under: 0.9, top: 0.2, foot: 0.65, footH: 6, above: 0.2, aboveY: 12 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  const top = gatePlatform(P, { ...AP, key: 'brick', arches: [{ x: 0, w: 6.2, h: 9.0 }], parapet: { rail: true, key: 'marble' }, topKey: 'paving', tunnelGlow: 0.14 });
  const k = KEEP;
  // the keep: grey brick walls from the platform to the lower eave
  const b = P.get('brick');
  box(b, (k.x0 + k.x1) / 2, (top + k.y1) / 2, (k.z0 + k.z1) / 2, k.x1 - k.x0, k.y1 - top, k.z1 - k.z0, { top: false });
  box(P.get('brick'), (k.x0 + k.x1) / 2, top + 0.4, (k.z0 + k.z1) / 2, k.x1 - k.x0 + 0.5, 0.8, k.z1 - k.z0 + 0.5, { top: false });
  // arrow windows: south 13 per row, east and west 4 per row; three rows below the lower eave
  const rowsLow = [top + 3.4, top + 7.6, top + 11.8];
  const xsS = Array.from({ length: 13 }, (_, i) => -25.2 + i * 4.2);
  const zsE = [-0.5, 4.2, 8.9, 13.2].map((z) => z - (k.z0 + k.z1) / 2);
  arrowWindows(P, 0, xsS, rowsLow, 2, 0, 0, k.z1);
  arrowWindows(P, 0, zsE, rowsLow, 2, Math.PI / 2, k.x1, (k.z0 + k.z1) / 2);
  arrowWindows(P, 0, zsE.map((z) => -z), rowsLow, 2, -Math.PI / 2, k.x0, (k.z0 + k.z1) / 2);
  // bracket band + lower (skirt) eave around the keep
  const cz = (k.z0 + k.z1) / 2, hw = (k.x1 - k.x0) / 2, hd = (k.z1 - k.z0) / 2;
  P.at(0, 0, cz, 0, () => {
    const up = story(P, { y0: k.y1 - 0.01, xs: [-hw + 0.4, hw - 0.4], zs: [-hd + 0.4, hd - 0.4], colH: 0.02, colR: 0.4, beamH: 0.7, bracketH: 0.9, bracketOut: 0.9, plinth: false });
    const skTop = up.top + 2.4, upX = hw - 1.6, upZ = hd - 1.6;
    roof(P, { kind: 'hip', y0: up.top + 0.1, y1: skTop, hw: up.wall.hw + 2.6, hd: up.wall.hd + 2.6, inner: { hw: upX, hd: upZ, y: skTop }, wall: up.wall, tile: 'K', trim: 'G', lift: 0.9, beasts: 5, curve: 0.4 });
    // upper storey: brick with one row of windows
    const upY1 = skTop + 3.6;
    box(P.get('brick'), 0, (skTop - 0.4 + upY1) / 2, 0, upX * 2, upY1 - skTop + 0.4, upZ * 2, { top: false });
    arrowWindows(P, upZ, xsS.map((x) => x * (upX / hw)), [skTop + 1.7], 0, 0, 0, 0);
    arrowWindows(P, upX, [-5.4, -1.8, 1.8, 5.4], [skTop + 1.7], 0, Math.PI / 2, 0, 0);
    arrowWindows(P, upX, [-5.4, -1.8, 1.8, 5.4], [skTop + 1.7], 0, -Math.PI / 2, 0, 0);
    const up2 = story(P, { y0: upY1 - 0.01, xs: [-upX + 0.3, upX - 0.3], zs: [-upZ + 0.3, upZ - 0.3], colH: 0.02, colR: 0.35, beamH: 0.7, bracketH: 0.9, bracketOut: 0.9, plinth: false });
    roof(P, { kind: 'hipGable', y0: up2.top + 0.1, y1: up2.top + 6.6, hw: up2.wall.hw + 2.8, hd: up2.wall.hd + 2.8, wall: up2.wall, tile: 'K', trim: 'G', lift: 1.2, beasts: 7, curve: 0.62 });
  });
  // 抱厦 on the north: open five-bay hall under a single hip-and-gable roof against the keep
  story(P, { y0: top, xs: [-21, -12.6, -4.2, 4.2, 12.6, 21].map((x) => x * 0.97), zs: [-16, -10, -3.6], colH: 7.2, colR: 0.4, front: 'open', sides: 'open', beamH: 0.8, bracketH: 0.9, bracketOut: 0.9 });
  P.at(0, 0, -9.8, 0, () => {
    const hy = top + 7.2 + 0.8 + 0.9;
    roof(P, { kind: 'hipGable', y0: hy + 0.1, y1: hy + 4.2, hw: 21 * 0.97 + 0.66 + 0.9 + 2.2, hd: 6.2 + 0.66 + 0.9 + 2.2, ridge: 17, wall: { hw: 21 * 0.97 + 1.5, hd: 7.1, y: hy }, tile: 'K', trim: 'G', lift: 0.8, beasts: 5, curve: 0.5 });
  });
  box(P.get('brick'), 0, top + 3.6, -4.1, 40, 7.2, 1.2);   // back wall of the 抱厦 (the keep's north face)
  // 1915 stairs up the north face, one each side, with white balustrades
  for (const sx of [-1, 1]) {
    const run = 16, w = 2.6, zc = -AP.hd - w / 2 - 0.2, n = 34;
    for (let i = 0; i < n; i++) {
      const x = sx * (6 + (i + 0.5) * run / n), y = (i + 1) * (AP.h / n);
      box(P.get('marble'), x, y / 2, zc, run / n + 0.02, y, w, { faces: 'xXzZY' });
    }
    balustrade(P, [[sx * 6, zc - w / 2 + 0.15], [sx * (6 + run), zc - w / 2 + 0.15]], 0, { h: 1.0 });
  }
  // far LOD
  gatePlatform(F, { ...AP, key: 'brick', lod: true });
  box(F.get('brick'), 0, (AP.h + k.y1) / 2, cz, k.x1 - k.x0, k.y1 - AP.h, k.z1 - k.z0, { top: false });
  F.at(0, 0, cz, 0, () => {
    roof(F, { kind: 'hip', y0: k.y1 + 1.6, y1: k.y1 + 4, hw: hw + 3.5, hd: hd + 3.5, inner: { hw: hw - 1.6, hd: hd - 1.6, y: k.y1 + 4 }, wall: { hw, hd, y: k.y1 }, tile: 'K', trim: 'G', lod: true, res: 0.3 });
    box(F.get('brick'), 0, k.y1 + 5.8, 0, (hw - 1.6) * 2, 3.6, (hd - 1.6) * 2, { top: false });
    roof(F, { kind: 'hipGable', y0: k.y1 + 9.3, y1: k.y1 + 15.9, hw: hw - 1.6 + 4.4, hd: hd - 1.6 + 4.4, wall: { hw, hd, y: k.y1 + 9 }, tile: 'K', trim: 'G', lod: true, res: 0.3 });
  });
  const colliders: ColliderSpec[] = [
    { kind: 'box', center: [-(31 + 3.1) / 2, 6, 0], half: [(31 - 3.1) / 2, 6, AP.hd] },
    { kind: 'box', center: [(31 + 3.1) / 2, 6, 0], half: [(31 - 3.1) / 2, 6, AP.hd] },
    { kind: 'box', center: [0, (9 + 12) / 2, 0], half: [3.1, 1.5, AP.hd] },
    { kind: 'box', center: [0, 24, cz], half: [29, 12, hd] },
  ];
  return assemble({ name: 'jianlou', detail: P, far: F, mats, colliders, footprint: rectPoly(AP.hw + 0.5, AP.hd + 3.5), height: 38 });
}

export const zhengyangmen: LandmarkDef = {
  id: 'zhengyangmen', name: { zh: '正阳门城楼', en: 'Zhengyangmen Gate Tower' },
  lat: 39.899184, lon: 116.391618, headingDeg: -1.41, build: buildGate,
};
export const jianlou: LandmarkDef = {
  id: 'jianlou', name: { zh: '正阳门箭楼', en: 'Zhengyangmen Arrow Tower' },
  lat: 39.897970, lon: 116.391659, headingDeg: -1.45, build: buildArrow,
};
