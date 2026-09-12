import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, flat, rectPoly } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { facadeMaterial, loft, roundRect } from './kit/facade';
import { assemble } from './kit/model';

/**
 * 中国尊 / 中信大厦 CITIC Tower: 528 m, 108 floors, the profile of a 尊 ritual vessel. 78 m square at
 * the foot, drawing in to a 54 m waist at ~72% of the height, flaring back to 69 x 59 m at the top,
 * corners rounded over the mega-columns. Silver glass in eight zones split by louvred belt floors;
 * an open crown. Night: lit windows, glowing belts, LED lines up the mullions, a bright crown.
 */
const ROOF = 508, TOP = 528, WAIST = 0.72;
function width(y: number, base: number, top: number): number {
  const t = Math.min(1, y / TOP);
  if (t <= WAIST) return 54 + (base - 54) * Math.pow(1 - t / WAIST, 1.75);
  const u = (t - WAIST) / (1 - WAIST);
  return 54 + (top - 54) * u * u;
}
const outline = (y: number): [number, number][] => {
  const wx = width(y, 78, 69), wz = width(y, 78, 60);
  return roundRect(wx / 2, wz / 2, 8.5 * (wx / 78), 3);
};

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();
function mats(env: EnvUniforms): Record<string, THREE.Material> {
  let m = matCache.get(env);
  if (!m) {
    const spec = {
      floorH: 4.8, colW: 1.6, glass: '#8a9dae', frame: '#c9cfd4', spandrel: '#8f9aa3', mull: 0.09, slab: 0.1, metal: 0.88, rough: 0.06, lit: 0.26, seed: 11,
      bands: { every: 63.5, h: 5.5, color: '#9ea8b0', glow: 0.1, from: 40 }, finGlow: 0.05, crown: { from: 494, glow: 0.2 },
    };
    m = {
      ...landmarkMaterials(env),
      ctFacade: facadeMaterial(env, spec),
      ctCrown: facadeMaterial(env, { ...spec, colW: 2.4, mull: 0.14, slab: 0.02, lit: 0, bands: undefined, crown: { from: 496, glow: 0.22 }, side: THREE.DoubleSide }),
      ctRoof: new THREE.MeshStandardMaterial({ color: '#5a5f63', roughness: 0.8 }),
    };
    matCache.set(env, m);
  }
  return m;
}

function tower(P: Parts, far: boolean): void {
  const levels = [];
  const n = far ? 10 : 44;
  for (let i = 0; i <= n; i++) { const y = (i / n) * ROOF; levels.push({ y, pts: outline(y) }); }
  loft(P.get('ctFacade'), levels);
  loft(P.get('ctCrown'), [{ y: ROOF, pts: outline(ROOF) }, { y: TOP, pts: outline(TOP) }]);
  flat(P.get('ctRoof'), outline(ROOF).map(([x, z]) => [x * 0.97, z * 0.97] as [number, number]), ROOF + 3);
  if (!far) {
    // entrance canopies on all four sides and a granite plinth
    for (const [x, z, sx, sz] of [[0, 41, 30, 6], [0, -41, 30, 6], [41, 0, 6, 30], [-41, 0, 6, 30]] as const) box(P.get('ctRoof'), x, 12, z, sx, 1.0, sz);
    box(P.get('granite'), 0, 0.3, 0, 90, 0.6, 90);
  }
}

function build(env: EnvUniforms): LandmarkModel {
  const m = mats(env);
  const P = new Parts(), F = new Parts();
  tower(P, false); tower(F, true);
  const colliders: ColliderSpec[] = [
    { kind: 'box', center: [0, 40, 0], half: [38.5, 40, 38.5] },
    { kind: 'box', center: [0, 300, 0], half: [29, 220, 29] },
  ];
  return assemble({ name: 'citic', detail: P, far: F, mats: m, colliders, footprint: rectPoly(40.5, 39), height: TOP });
}

export const citic: LandmarkDef = {
  id: 'citic', name: { zh: '中国尊', en: 'CITIC Tower' },
  lat: 39.911501, lon: 116.460236, headingDeg: 0, build,
};
