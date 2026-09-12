import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, rectPoly, floodGlow } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { gatePlatform, terrace, hall, story, bays, type HallSpec } from './kit/hall';
import { roof } from './kit/roof';
import { assemble } from './kit/model';

/**
 * 故宫午门 Meridian Gate, the 五凤楼: a U-shaped red platform (12 m on a marble base, 125 m across
 * the back, wings 24 x 74 m reaching south) with three arched gates through the centre; the 9 x 5
 * bay main hall under a double-eaved 庑殿 roof (37.95 m); a square pavilion with double pyramidal
 * roofs at each end of both wings; thirteen-bay galleries (雁翅楼) along the wings. Yellow glaze.
 * Local frame: +Z south (the open side of the U faces 端门 and Tiananmen).
 */
const PH = 12;
const CENTRAL = { hw: 62.5, hd: 17, cz: -37 };
const WING = { cx: 50, hw: 12, cz: 16.3, hd: 37.3 };
const ARCHES = [{ x: 0, w: 5.8, h: 9.2 }, { x: -14, w: 4.8, h: 8.2 }, { x: 14, w: 4.8, h: 8.2 }];

function mainHall(y0: number, lod: boolean): HallSpec {
  return {
    y0, xs: bays(9, 60, 0.8), zs: bays(5, 25, 0.8), colH: 6.8, colR: 0.5, corridor: { front: 4.55, back: 4.55 },
    front: 'mixed', back: 'mixed', sides: 'wall', beamH: 1.0, bracketH: 1.2, bracketOut: 1.2,
    roof: { kind: 'hip', tile: 'Y', overhang: 3.4, rise: 5.8, curve: 0.55, lift: 1.3, beasts: 9, ridgeH: 1.4 },
    double: { inset: 6.0, insetZ: 4.55, h: 2.0, skirtRise: 2.5, front: 'windows', back: 'windows', sides: 'wall' },
    lod,
  };
}

/** 阙亭: square three-bay pavilion with double pyramidal eaves. */
function pavilion(P: Parts, cx: number, cz: number, y0: number, lod: boolean): void {
  const res = lod ? 0.3 : 1;
  P.push(new THREE.Matrix4().makeTranslation(cx, 0, cz));
  terrace(P, { tiers: [{ hw: 9.6, hd: 9.6, h: 0.8 }], y0, rail: false, topKey: 'paving', sumeru: false, lod });
  const g = [-7.2, -2.4, 2.4, 7.2];
  const s1 = story(P, { y0: y0 + 0.8, xs: g, zs: g, colH: 4.8, colR: 0.4, front: 'windows', back: 'windows', sides: 'windows', beamH: 0.8, bracketH: 1.0, bracketOut: 1.0, lod });
  const inY = s1.top + 2.2;
  roof(P, { kind: 'pyramid', y0: s1.top + 0.12, y1: inY, hw: s1.wall.hw + 2.6, hd: s1.wall.hd + 2.6, inner: { hw: 5.6, hd: 5.6, y: inY }, wall: s1.wall, tile: 'Y', lift: 0.9, beasts: 5, res, lod });
  const s2 = story(P, { y0: inY - 0.4, xs: [-5.2, 5.2], zs: [-5.2, 5.2], colH: 2.0, colR: 0.34, front: 'windows', back: 'windows', sides: 'windows', beamH: 0.7, bracketH: 0.9, bracketOut: 0.9, plinth: false, lod });
  roof(P, { kind: 'pyramid', y0: s2.top + 0.12, y1: s2.top + 7.4, hw: s2.wall.hw + 2.8, hd: s2.wall.hd + 2.8, wall: s2.wall, tile: 'Y', lift: 0.9, beasts: 7, finial: 2.2, res, lod });
  P.pop();
}

/** 雁翅楼: thirteen-bay single-eave gallery along a wing, facing the court. */
function gallery(P: Parts, cx: number, cz: number, ry: number, y0: number, lod: boolean): void {
  P.push(new THREE.Matrix4().makeRotationY(ry).setPosition(cx, 0, cz));
  terrace(P, { tiers: [{ hw: 28, hd: 6, h: 0.6 }], y0, rail: false, topKey: 'paving', sumeru: false, lod });
  hall(P, { y0: y0 + 0.6, xs: bays(13, 52, 0.95), zs: [-4.2, 4.2], colH: 4.2, colR: 0.34, front: 'windows', back: 'wall', sides: 'wall', beamH: 0.7, bracketH: 0.8, bracketOut: 0.8,
    roof: { kind: 'hipGable', tile: 'Y', overhang: 1.8, rise: 3.4, curve: 0.55, lift: 0.6, beasts: 5 }, lod });
  P.pop();
}

function body(P: Parts, lod: boolean): number {
  const pp = { h: 1.1, t: 0.8, key: 'redWall', coping: 'glzY' };
  P.at(0, 0, CENTRAL.cz, 0, () => gatePlatform(P, { hw: CENTRAL.hw, hd: CENTRAL.hd, h: PH, batter: 0.8, key: 'redWall', arches: ARCHES, base: { h: 1.5, out: 0.5, key: 'marble' }, parapet: lod ? undefined : pp, topKey: 'paving', tunnelGlow: 0.2, lod }));
  for (const sx of [-1, 1]) P.at(sx * WING.cx, 0, WING.cz, 0, () => gatePlatform(P, { hw: WING.hw, hd: WING.hd, h: PH, batter: 0.8, key: 'redWall', base: { h: 1.5, out: 0.5, key: 'marble' }, parapet: lod ? undefined : pp, topKey: 'paving', lod }));
  let top = 0;
  P.at(0, 0, CENTRAL.cz, 0, () => {
    const t = terrace(P, { tiers: [{ hw: 33.5, hd: 15.2, h: 1.0 }], y0: PH, topKey: 'paving', railH: 1.0, lod });
    top = hall(P, mainHall(t, lod)).top;
  });
  for (const sx of [-1, 1]) {
    pavilion(P, sx * WING.cx, -30, PH, lod);
    pavilion(P, sx * WING.cx, 42, PH, lod);
    gallery(P, sx * (WING.cx + 1.5), 6, -sx * Math.PI / 2, PH, lod);
  }
  return top;
}

function build(env: EnvUniforms): LandmarkModel {
  const mats = landmarkMaterials(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.18, front: 0.3, under: 0.9, top: 0.2, foot: 0.6, footH: 6, above: 0.35, aboveY: PH + 0.1 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  const height = body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [];
  let x0 = -CENTRAL.hw;
  for (const a of [...ARCHES].sort((p, q) => p.x - q.x)) {
    const x1 = a.x - a.w / 2;
    colliders.push({ kind: 'box', center: [(x0 + x1) / 2, PH / 2, CENTRAL.cz], half: [(x1 - x0) / 2, PH / 2, CENTRAL.hd] });
    colliders.push({ kind: 'box', center: [a.x, (a.h + PH) / 2, CENTRAL.cz], half: [a.w / 2, (PH - a.h) / 2, CENTRAL.hd] });
    x0 = a.x + a.w / 2;
  }
  colliders.push({ kind: 'box', center: [(x0 + CENTRAL.hw) / 2, PH / 2, CENTRAL.cz], half: [(CENTRAL.hw - x0) / 2, PH / 2, CENTRAL.hd] });
  for (const sx of [-1, 1]) colliders.push({ kind: 'box', center: [sx * WING.cx, PH / 2, WING.cz], half: [WING.hw, PH / 2, WING.hd] });
  colliders.push({ kind: 'box', center: [0, PH + 12, CENTRAL.cz], half: [33, 12, 15] });
  return assemble({ name: 'wumen', detail: P, far: F, mats, colliders, footprint: rectPoly(63.3, 54.6, 0, -0.2), height: Math.max(37.95, height) });
}

export const wumen: LandmarkDef = {
  id: 'wumen', name: { zh: '故宫午门', en: 'Meridian Gate' },
  lat: 39.912119, lon: 116.390993, headingDeg: -1.49, build,
};
