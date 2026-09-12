import * as THREE from 'three';
import { JOINT_COUNT, LOOK_FLOATS, lookScale, type Look } from './Body';
import { JOINT_FLOATS, poseWorld, writeSkin, type Gait } from './Animator';
import { crowdGeometries } from './BodyMesh';
import { crowdDepthMaterials, patchCrowdMaterial, ROW_TEXELS, type CrowdUniforms } from './CrowdShader';

/** Characters drawn per quality tier, the player included. */
export const CROWD_CAP = { low: 40, medium: 80, high: 120 } as const;
/** Beyond this distance (m, with 2 m hysteresis) people use the far LOD (~690 instead of ~2,470 triangles). */
export const LOD_DISTANCE = 22;

/**
 * Every person in the world (the player on foot and all pedestrians): one continuous skinned mesh
 * per LOD, instanced, skinned on the GPU from a joint texture (see CrowdShader). Two draw calls in
 * the main pass (near and far LOD), the same per shadow map.
 *
 * Several systems add to the same crowd each frame (the player, then the pedestrians) with no
 * guaranteed end(): every add leaves both meshes drawable. Nothing is allocated per frame.
 */
export class Crowd {
  private readonly data: Float32Array;
  private readonly tex: THREE.DataTexture;
  private readonly near: THREE.Mesh;
  private readonly far: THREE.Mesh;
  private readonly W = new Float64Array(JOINT_COUNT * JOINT_FLOATS);
  private nNear = 0;
  private nFar = 0;
  /** Camera the LOD split measures from. Set it (player/) to avoid the first-frame fallback below. */
  cam: THREE.Camera | null = null;
  private readonly camPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly cap: number) {
    this.data = new Float32Array(ROW_TEXELS * 4 * Math.max(1, cap));
    this.tex = new THREE.DataTexture(this.data, ROW_TEXELS, Math.max(1, cap), THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    const geos = crowdGeometries();
    const mk = (src: THREE.InstancedBufferGeometry, base: number, sign: number): THREE.Mesh => {
      const g = new THREE.InstancedBufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
      g.setIndex(src.index);
      g.instanceCount = 0;
      g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox;
      const u: CrowdUniforms = { dccJoints: { value: this.tex }, dccBase: { value: base }, dccSign: { value: sign } };
      const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
      mat.userData.wet = true;
      mat.name = 'crowd';
      patchCrowdMaterial(mat, u);
      const mesh = new THREE.Mesh(g, mat);
      const { depth, distance } = crowdDepthMaterials(u);
      mesh.customDepthMaterial = depth;
      mesh.customDistanceMaterial = distance;
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.visible = false;
      mesh.name = sign > 0 ? 'crowd-near' : 'crowd-far';
      // The LOD split needs the camera; the crowd only gets the scene, so remember the camera
      // that draws it (perspective, not a 90-degree cube/env capture; shadow cameras are ortho).
      mesh.onBeforeRender = (_r, _s, camera) => {
        const c = camera as THREE.PerspectiveCamera;
        if (c.isPerspectiveCamera && c.fov !== 90) this.cam = c;
      };
      scene.add(mesh);
      return mesh;
    };
    this.near = mk(geos.near, 0, 1);
    this.far = mk(geos.far, Math.max(1, cap) - 1, -1);
  }

  begin(): void { this.nNear = 0; this.nFar = 0; this.end(); }

  /**
   * Add one character this frame. Several systems add to the same crowd (the player, then the
   * pedestrians), so every add leaves the meshes ready to draw: no separate end() is needed.
   */
  add(root: THREE.Vector3, yaw: number, gait: Gait, look: Look): void {
    if (this.nNear + this.nFar >= this.cap) return;
    if (gait.look !== look) gait.bindLook(look);
    let far = false;
    if (this.cam) {
      const c = this.cam;
      if (c.parent) this.camPos.setFromMatrixPosition(c.matrixWorld); else this.camPos.copy(c.position);
      const d2 = this.camPos.distanceToSquared(root);
      const lim = gait.lodFar ? LOD_DISTANCE - 2 : LOD_DISTANCE + 2;
      far = d2 > lim * lim;
      gait.lodFar = far;
    }
    const row = far ? this.cap - 1 - this.nFar++ : this.nNear++;
    const base = row * ROW_TEXELS * 4;
    poseWorld(root, yaw, lookScale(look), gait, this.W);
    writeSkin(this.W, this.data, base);
    const pk = gait.pack, d = this.data;
    for (let k = 0; k < LOOK_FLOATS / 4; k++) {
      const o = base + (k * 4 + 3) * 4;
      d[o] = pk[k * 4]; d[o + 1] = pk[k * 4 + 1]; d[o + 2] = pk[k * 4 + 2]; d[o + 3] = pk[k * 4 + 3];
    }
    d[base + (4 * 4 + 3) * 4 + 3] = gait.prop;
    this.end();
  }

  get size(): number { return this.nNear + this.nFar; }

  end(): void {
    (this.near.geometry as THREE.InstancedBufferGeometry).instanceCount = this.nNear;
    (this.far.geometry as THREE.InstancedBufferGeometry).instanceCount = this.nFar;
    this.near.visible = this.nNear > 0;
    this.far.visible = this.nFar > 0;
    this.tex.needsUpdate = true;
  }
}
