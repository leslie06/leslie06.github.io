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
function build(env: EnvUniforms): LandmarkModel {
  const s = buildVillaStatic();
  return assemble({
    name: 'home',
    detail: s.parts,
    far: buildVillaFar(),
    extras: buildVillaExtras(),
    mats: villaMaterials(env),
    colliders: s.colliders,
    footprint: s.footprint,
    height: s.height,
    // A two-storey house is not read from across the city; drop to the massing sooner than a tower.
    farDistance: 900,
  });
}

export const myVilla: LandmarkDef = {
  id: 'home',
  name: { zh: '我家', en: 'My Villa' },
  lat: ANCHOR.lat, lon: ANCHOR.lon, headingDeg: ANCHOR.headingDeg,
  build,
};
