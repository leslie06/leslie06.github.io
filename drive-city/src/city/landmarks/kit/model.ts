import * as THREE from 'three';
import type { ColliderSpec, LandmarkModel } from '../../../game/Contracts';
import type { Parts } from './geo';

/** Distance (m) beyond which the far LOD is drawn. */
export const FAR_LOD_DISTANCE = 800;

export interface AssembleOpts {
  name: string;
  detail: Parts;
  far: Parts;
  mats: Record<string, THREE.Material>;
  colliders: ColliderSpec[];
  footprint: [number, number][];
  height: number;
  /** Optional pieces outside the footprint (bridges, columns) the city may drop if they clash. */
  extras?: Parts;
  farDistance?: number;
}

/**
 * Wraps the built parts into the contract's model: `group` holds one THREE.LOD (named 'lod') with
 * the detailed level at 0 m and the far level at `farDistance`; `extras` hangs under the detailed
 * level as a group named 'extras'. Stats land in `group.userData.stats`.
 */
export function assemble(o: AssembleOpts): LandmarkModel {
  const detail = o.detail.build(o.mats);
  detail.name = 'detail';
  let extraTris = 0;
  if (o.extras) {
    const ex = o.extras.build(o.mats);
    ex.name = 'extras';
    detail.add(ex);
    extraTris = o.extras.triangles();
  }
  const far = o.far.build(o.mats, { shadows: false });
  far.name = 'far';
  const lod = new THREE.LOD();
  lod.name = 'lod';
  lod.addLevel(detail, 0);
  lod.addLevel(far, o.farDistance ?? FAR_LOD_DISTANCE);
  const group = new THREE.Group();
  group.name = o.name;
  group.add(lod);
  group.userData.stats = {
    triangles: o.detail.triangles() + extraTris,
    drawCalls: detail.children.length - (o.extras ? 1 : 0) + (o.extras ? detail.getObjectByName('extras')!.children.length : 0),
    farTriangles: o.far.triangles(),
    farDrawCalls: far.children.length,
  };
  group.updateMatrixWorld(true);
  return { group, colliders: o.colliders, footprint: o.footprint, height: o.height };
}
