import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, floodGlow } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { polyTerrace, offsetPoly, sumeru, hall, bays, type PolyTier, type HallSpec } from './kit/hall';
import { assemble } from './kit/model';

/**
 * 太和殿 Hall of Supreme Harmony, with 中和殿 and 保和殿 on their shared 三台: the three-tier
 * 土-shaped white-marble terrace (8.1 m, ~130 x 206 m) with balustrades, 螭首 spouts and the great
 * stair on the axis. 太和殿: 11 x 5 bays, front porch, double-eaved 庑殿 roof, ten ridge beasts, 35 m.
 * 中和殿: square, single pyramidal roof, gilded finial. 保和殿: 9 x 5 bays, double-eaved 歇山.
 * All three OSM halls fall inside the footprint. Local frame: +Z south, origin at 太和殿.
 */
const T1: [number, number][] = [[-66, 50], [66, 50], [66, -36], [44, -36], [44, -94], [58, -94], [58, -156], [-58, -156], [-58, -94], [-44, -94], [-44, -36], [-66, -36]];
const TH = 2.71, STEP = 4.5;
const Z_ZH = -64.6, Z_BH = -123.5;

function tiers(): PolyTier[] {
  const out: PolyTier[] = [];
  for (let k = 0; k < 3; k++) {
    const d = k * STEP;
    out.push({
      poly: k ? offsetPoly(T1, d) : T1, h: TH,
      stairs: [
        { x: 0, z: 50 - d, ry: 0, w: 12, ramp: 3.6 },
        { x: 0, z: -156 + d, ry: Math.PI, w: 9, ramp: 3 },
        { x: 66 - d, z: 6, ry: Math.PI / 2, w: 5 },
        { x: -66 + d, z: 6, ry: -Math.PI / 2, w: 5 },
      ],
    });
  }
  return out;
}

function taihe(y0: number, lod: boolean): HallSpec {
  return {
    y0, xs: bays(11, 60, 0.8), zs: bays(5, 33.3, 0.8), colH: 8.0, colR: 0.53, corridor: { front: 6.05 },
    front: 'mixed', back: 'mixed', sides: 'wall', beamH: 1.1, bracketH: 1.3, bracketOut: 1.3,
    roof: { kind: 'hip', tile: 'Y', overhang: 3.6, rise: 6.0, curve: 0.55, lift: 1.4, beasts: 10, ridgeH: 1.5 },
    double: { inset: 4.9, insetZ: 4.2, h: 2.0, skirtRise: 2.6, front: 'windows', back: 'windows', sides: 'wall' },
    lod,
  };
}
function zhonghe(y0: number, lod: boolean): HallSpec {
  const g = bays(5, 20, 0.85);
  return {
    y0, xs: g, zs: g, colH: 5.6, colR: 0.4, corridor: 3.74, front: 'doors', back: 'doors', sides: 'windows', beamH: 0.8, bracketH: 1.0, bracketOut: 1.0,
    roof: { kind: 'pyramid', tile: 'Y', overhang: 3.0, rise: 7.2, curve: 0.5, lift: 1.0, beasts: 7, finial: 2.6 },
    lod,
  };
}
function baohe(y0: number, lod: boolean): HallSpec {
  return {
    y0, xs: bays(9, 47, 0.8), zs: bays(5, 23, 0.8), colH: 6.2, colR: 0.45, corridor: { front: 4.2 },
    front: 'mixed', back: 'mixed', sides: 'wall', beamH: 1.0, bracketH: 1.2, bracketOut: 1.2,
    roof: { kind: 'hipGable', tile: 'Y', overhang: 3.3, rise: 4.8, curve: 0.6, lift: 1.25, beasts: 9 },
    double: { inset: 4.7, insetZ: 3.2, h: 1.8, skirtRise: 2.4, front: 'windows', back: 'windows', sides: 'wall' },
    lod,
  };
}

function body(P: Parts, lod: boolean): number {
  const top = polyTerrace(P, { tiers: tiers(), topKey: 'paving', spouts: true, railStep: 2.1, rise: 0.17, tread: 0.28, lod });
  let height = 0;
  const on = (z: number, hw: number, hd: number, spec: (y: number, lod: boolean) => HallSpec) => {
    P.push(new THREE.Matrix4().makeTranslation(0, 0, z));
    sumeru(P, 'marble', hw, hd, top, 0.6, { plain: true, top: 'paving' });
    height = Math.max(height, hall(P, spec(top + 0.6, lod)).top);
    P.pop();
  };
  on(0, 33.6, 19.6, taihe);
  on(Z_ZH, 13.5, 13.5, zhonghe);
  on(Z_BH, 27, 14, baohe);
  return height;
}

function build(env: EnvUniforms): LandmarkModel {
  const mats = landmarkMaterials(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.2, front: 0.3, under: 0.9, top: 0.2, foot: 0.5, footH: 5, above: 0.3, aboveY: 8.5 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  const height = body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [];
  for (let k = 0; k < 3; k++) {
    const d = k * STEP, yc = TH * (k + 1) / 2, hh = TH * (k + 1) / 2;
    colliders.push({ kind: 'box', center: [0, yc, 7], half: [66 - d, hh, 43 - d] });
    colliders.push({ kind: 'box', center: [0, yc, -65], half: [44 - d, hh, 29 + 0.1] });
    colliders.push({ kind: 'box', center: [0, yc, -125], half: [58 - d, hh, 31 - d] });
  }
  colliders.push({ kind: 'box', center: [0, 20, 0], half: [34, 12, 20] }, { kind: 'box', center: [0, 16, Z_ZH], half: [13, 8, 13] }, { kind: 'box', center: [0, 18, Z_BH], half: [26, 10, 13.5] });
  return assemble({ name: 'taihedian', detail: P, far: F, mats, colliders, footprint: offsetPoly(T1, -1), height: Math.max(35.05, height) });
}

export const taihedian: LandmarkDef = {
  id: 'taihedian', name: { zh: '太和殿', en: 'Hall of Supreme Harmony' },
  lat: 39.915896, lon: 116.390814, headingDeg: -1.52, build,
};
