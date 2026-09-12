import type { EnvUniforms, LandmarkDef, LandmarkModel } from '../game/Contracts';
import { assemble } from '../city/landmarks/kit/model';
import { ANCHOR } from './Layout';
import { buildParkFar, buildParkStatic, parkMaterials } from './Rides';

/**
 * 北京欢乐谷 as a landmark: the park's ground, lake, paths, fence, stations, the coaster track and
 * the rock mountain. Everything that moves is built by the park system (park/index.ts) instead,
 * because a landmark is baked once and never animated.
 *
 * The far LOD keeps only what is read from the 4th Ring Road: the mountain, the track and the two
 * towers.
 */
function build(env: EnvUniforms): LandmarkModel {
  const s = buildParkStatic();
  return assemble({
    name: 'happyvalley',
    detail: s.parts,
    far: buildParkFar(),
    mats: parkMaterials(env),
    colliders: s.colliders,
    footprint: s.footprint,
    height: s.height,
    farDistance: 1600,
  });
}

export const happyValley: LandmarkDef = {
  id: 'happyvalley',
  name: { zh: '北京欢乐谷', en: 'Happy Valley Beijing' },
  lat: ANCHOR.lat, lon: ANCHOR.lon, headingDeg: ANCHOR.headingDeg,
  build,
};
