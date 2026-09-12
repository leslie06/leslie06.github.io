import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, cyl, flat, rectPoly } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { facadeMaterial, loft, roundRect } from './kit/facade';
import { assemble } from './kit/model';

/**
 * 国贸三期A China World Trade Center Tower III: 330 m, 74 floors. A chamfered square that tapers
 * gently as it rises, silver-blue glass behind close vertical stainless fins, and an 18 m open
 * crown around the rooftop helipad that glows white at night.
 */
const ROOF = 312, TOP = 330;
const taper = (y: number) => 1 - 0.13 * Math.pow(Math.min(y, ROOF) / ROOF, 1.25);
const outline = (y: number, k = 1): [number, number][] => { const s = taper(y) * k; return roundRect(26.8 * s, 28.6 * s, 5.2 * s, 1); };

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();
function mats(env: EnvUniforms): Record<string, THREE.Material> {
  let m = matCache.get(env);
  if (!m) {
    const spec = { floorH: 4.2, colW: 1.25, glass: '#7e98ae', frame: '#dfe3e6', spandrel: '#71879a', mull: 0.14, slab: 0.07, metal: 0.9, rough: 0.05, lit: 0.3, seed: 3, crown: { from: 298, glow: 0.2 } };
    m = {
      ...landmarkMaterials(env),
      cwFacade: facadeMaterial(env, spec),
      cwCrown: facadeMaterial(env, { ...spec, colW: 2.2, mull: 0.16, slab: 0.02, lit: 0, crown: { from: 300, glow: 0.22 }, side: THREE.DoubleSide }),
      cwRoof: new THREE.MeshStandardMaterial({ color: '#5d6266', roughness: 0.8 }),
    };
    matCache.set(env, m);
  }
  return m;
}

function tower(P: Parts, far: boolean): void {
  const levels = [];
  const n = far ? 4 : 26;
  for (let i = 0; i <= n; i++) { const y = (i / n) * ROOF; levels.push({ y, pts: outline(y) }); }
  loft(P.get('cwFacade'), levels);
  // crown: the skin carries on 18 m above the top floor, flaring slightly, open to the sky
  loft(P.get('cwCrown'), [{ y: ROOF, pts: outline(ROOF) }, { y: TOP, pts: outline(ROOF, 1.035) }]);
  flat(P.get('cwRoof'), outline(ROOF).map(([x, z]) => [x * 0.98, z * 0.98] as [number, number]), ROOF + 4);
  if (!far) {
    cyl(P.get('marble'), 0, ROOF + 4, 0, 11, 11, 0.4, 32);        // helipad
    // lobby canopy and the podium link on the south side
    box(P.get('cwRoof'), 0, 9.5, 31.5, 24, 0.8, 7);
    box(P.get('granite'), 0, 0.3, 0, 60, 0.6, 64);
  }
}

function build(env: EnvUniforms): LandmarkModel {
  const m = mats(env);
  const P = new Parts(), F = new Parts();
  tower(P, false); tower(F, true);
  const colliders: ColliderSpec[] = [{ kind: 'box', center: [0, ROOF / 2, 0], half: [27, ROOF / 2, 28.8] }];
  return assemble({ name: 'cwtc3', detail: P, far: F, mats: m, colliders, footprint: rectPoly(27.5, 29.5), height: TOP });
}

export const cwtc3: LandmarkDef = {
  id: 'cwtc3', name: { zh: '国贸三期', en: 'China World Trade Center III' },
  lat: 39.910975, lon: 116.452365, headingDeg: 0, build,
};
