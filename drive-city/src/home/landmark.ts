import * as THREE from 'three';
import type { EnvUniforms, LandmarkDef, LandmarkModel } from '../game/Contracts';
import { assemble } from '../city/landmarks/kit/model';
import { ANCHOR } from './Layout';
import { buildVillaExtras, buildVillaFar, buildVillaStatic, villaMaterials } from './Villa';

/**
 * 我家 as a landmark: the plot, the walls and gate, the house inside and out, the garden and the
 * pool. Registering it in city/landmarks/index.ts is what puts it on the map and in the GPS's
 * search list too, because nav/ builds its pins from LANDMARKS.
 *
 * Everything here is baked once. The garage door is the only moving part and lives in home/index.ts.
 */
/** Materials only seen inside: upholstery, brass, books, rugs, art, mirrors, the fireplaces, joinery, marble. */
const INTERIOR = new Set(['vFabricTan', 'vFabricWhite', 'vBrass', 'vVelvet', 'vBook', 'vRug', 'vArt', 'vMirror', 'vMarbleDark', 'vFire', 'vWoodDark', 'vMarbleWhite']);
/** Past this the house is drawn without them (the same geometry otherwise, shared). */
export const VILLA_MID_DISTANCE = 70;

function build(env: EnvUniforms): LandmarkModel {
  const s = buildVillaStatic();
  const model = assemble({
    name: 'home',
    detail: s.parts,
    far: buildVillaFar(),
    extras: buildVillaExtras(),
    mats: villaMaterials(env),
    colliders: s.colliders,
    footprint: s.footprint,
    clear: s.clear,
    height: s.height,
    // A two-storey house is not read from across the city; drop to the massing sooner than a tower.
    farDistance: 900,
  });
  // A middle level: the house seen from the street, the plaza or the air, not through its windows from
  // close by. 32 draw calls and 44k triangles were drawn from anywhere within 900 m, the spawn 300 m
  // away included; the rooms' furnishings are 12 of those calls and ~18k of the triangles.
  const lod = model.group.getObjectByName('lod') as THREE.LOD;
  const detail = lod.levels[0].object;
  const mid = new THREE.Group();
  mid.name = 'mid';
  for (const c of detail.children) if (!INTERIOR.has(c.name)) mid.add(c.clone());
  lod.addLevel(mid, VILLA_MID_DISTANCE);
  const stats = model.group.userData.stats as Record<string, number>;
  stats.midDrawCalls = mid.children.length;
  return model;
}

export const myVilla: LandmarkDef = {
  id: 'home',
  name: { zh: '我家', en: 'My Villa' },
  lat: ANCHOR.lat, lon: ANCHOR.lon, headingDeg: ANCHOR.headingDeg,
  build,
};
