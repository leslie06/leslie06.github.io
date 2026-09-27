import type { LandmarkDef } from '../../game/Contracts';
import { huanqiu } from './huanqiu';
import { happyValley } from '../../park/landmark';
import { myVilla } from '../../home/landmark';
import { glbLandmark, type GlbMeta } from './glb/Glb';

/** Landmarks imported from Blender (scripts/landmarks/import.mjs writes one meta per model). */
const GLB = Object.values(import.meta.glob<GlbMeta>('./glb/*.meta.json', { eager: true, import: 'default' })).map(glbLandmark);

/**
 * Landmark models that replace OSM footprints. The city places each at project(lat, lon) with
 * `group.rotation.y = -headingDeg`, removes OSM buildings whose centroid is inside `footprint`, and
 * adds `colliders`. Each group holds a THREE.LOD named 'lod' (detailed level, far level beyond
 * FAR_LOD_DISTANCE); optional pieces outside the footprint sit in a child group named 'extras'.
 */
export const LANDMARKS: LandmarkDef[] = [huanqiu, happyValley, myVilla, ...GLB];

export { LANDMARK_LIGHTS } from './kit/mats';
export { FAR_LOD_DISTANCE } from './kit/model';
