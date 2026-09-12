import type { LandmarkDef } from '../../game/Contracts';
import { tiananmen } from './tiananmen';
import { zhengyangmen, jianlou } from './zhengyangmen';
import { cwtc3 } from './cwtc3';
import { citic } from './citic';
import { cctv } from './cctv';
import { qiniandian } from './qiniandian';
import { huanqiu } from './huanqiu';
import { monument } from './monument';
import { station } from './station';
import { huangqiongyu } from './huangqiongyu';
import { taihedian } from './taihedian';
import { wumen } from './wumen';

/**
 * Landmark models that replace OSM footprints. The city places each at project(lat, lon) with
 * `group.rotation.y = -headingDeg`, removes OSM buildings whose centroid is inside `footprint`, and
 * adds `colliders`. Each group holds a THREE.LOD named 'lod' (detailed level, far level beyond
 * FAR_LOD_DISTANCE); optional pieces outside the footprint sit in a child group named 'extras'.
 */
export const LANDMARKS: LandmarkDef[] = [tiananmen, zhengyangmen, jianlou, qiniandian, huanqiu, cwtc3, citic, cctv, monument, station, wumen, taihedian, huangqiongyu];

export { LANDMARK_LIGHTS } from './kit/mats';
export { FAR_LOD_DISTANCE } from './kit/model';
