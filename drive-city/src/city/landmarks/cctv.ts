import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, hexa, walls, flat, rectPoly, type V3 } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { facadeMaterial } from './kit/facade';
import { assemble } from './kit/model';

/**
 * 中央电视台总部大楼 CCTV Headquarters: the loop. An L-shaped 48 m podium through the north-east
 * joins two towers at the NW and SE corners of the site; each leans 6° in both directions towards
 * the other and they meet 162 m up in an L-shaped 72 m deep overhang through the south-west that
 * cantilevers ~75 m over the plaza. 234 m. Grey glass behind an irregular structural diagrid that is
 * dense where the loads are high. Footprints from OSM (the site is 159 x 168 m).
 */
const T = 162, TOP = 234, PODIUM = 48, SH = 17;
const A = { x0: -79, x1: -19.5, z0: -84.3, z1: -26.3 };
const B = { x0: 26, x1: 79.3, z0: 23.9, z1: 84.2 };
const PODIUM_POLY: [number, number][] = [[-79, -84.3], [79.3, -84.3], [79.3, 84.2], [26, 84.2], [26, -26.3], [-79, -26.3]];
const OVER_POLY: [number, number][] = [[-62, -67.3], [-2.5, -67.3], [-2.5, 6.9], [62.3, 6.9], [62.3, 67.2], [-62, 67.2]];

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();
function mats(env: EnvUniforms): Record<string, THREE.Material> {
  let m = matCache.get(env);
  if (!m) {
    m = {
      ...landmarkMaterials(env),
      cvFacade: facadeMaterial(env, { floorH: 4.5, colW: 1.8, glass: '#7f8a91', frame: '#5d656a', spandrel: '#6a7277', mull: 0.05, slab: 0.2, metal: 0.72, rough: 0.12, lit: 0.3, seed: 7, diagrid: { size: 9, width: 0.45, color: '#2d3236', glow: 0.05, slope: 0.62 } }),
      cvUnder: new THREE.MeshStandardMaterial({ color: '#4c5358', roughness: 0.5, metalness: 0.6 }),
    };
    matCache.set(env, m);
  }
  return m;
}

/** Sheared prism: base rectangle at y = 0, the same rectangle shifted by (dx, dz) at y = h. */
function leaning(r: typeof A, dx: number, dz: number, h: number): V3[] {
  return [
    [r.x0, 0, r.z0], [r.x1, 0, r.z0], [r.x1, 0, r.z1], [r.x0, 0, r.z1],
    [r.x0 + dx, h, r.z0 + dz], [r.x1 + dx, h, r.z0 + dz], [r.x1 + dx, h, r.z1 + dz], [r.x0 + dx, h, r.z1 + dz],
  ];
}

function body(P: Parts): { a: V3[]; b: V3[] } {
  const f = P.get('cvFacade');
  walls(f, PODIUM_POLY, 0, PODIUM);
  flat(P.get('cvUnder'), PODIUM_POLY, PODIUM);
  const a = leaning(A, SH, SH, T), b = leaning(B, -SH, -SH, T);
  hexa(f, a, { top: false }); hexa(f, b, { top: false });
  walls(f, OVER_POLY, T, TOP);
  flat(P.get('cvUnder'), OVER_POLY, T, true);
  flat(P.get('cvUnder'), OVER_POLY, TOP);
  return { a, b };
}

function build(env: EnvUniforms): LandmarkModel {
  const m = mats(env);
  const P = new Parts(), F = new Parts();
  const { a, b } = body(P); body(F);
  const colliders: ColliderSpec[] = [
    { kind: 'box', center: [0.15, PODIUM / 2, -55.3], half: [79.15, PODIUM / 2, 29] },
    { kind: 'box', center: [52.65, PODIUM / 2, 28.95], half: [26.65, PODIUM / 2, 55.25] },
    { kind: 'hull', points: a.flat() }, { kind: 'hull', points: b.flat() },
    { kind: 'box', center: [-32.25, (T + TOP) / 2, 0], half: [29.75, (TOP - T) / 2, 67.25] },
    { kind: 'box', center: [29.9, (T + TOP) / 2, 37.05], half: [32.4, (TOP - T) / 2, 30.15] },
  ];
  return assemble({ name: 'cctv', detail: P, far: F, mats: m, colliders, footprint: rectPoly(79.6, 84.5), height: TOP });
}

export const cctv: LandmarkDef = {
  id: 'cctv', name: { zh: '中央电视台总部大楼', en: 'CCTV Headquarters' },
  lat: 39.913812, lon: 116.457966, headingDeg: 0, build,
};
