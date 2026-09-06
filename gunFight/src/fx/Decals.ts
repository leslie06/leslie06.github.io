import * as THREE from 'three';
import { cellRect, type Atlas } from './Atlas';
import { decalBasis, fadeWindowAlpha } from './math';

/**
 * Instanced decal quads projected onto surfaces: one InstancedMesh, one draw call, budget from
 * quality.decalBudget. Uses MeshStandardMaterial (patched via onBeforeCompile for per-instance
 * atlas cell / tint / roughness+metalness) so decals get real sun + shadow + fog like the wall
 * they sit on — a bullet hole in shade is dark, a metal dent catches the env map.
 * Offset 2.5mm along the normal + polygonOffset so they never z-fight; ring buffer fades the
 * oldest ~12% before they get overwritten.
 */
export interface DecalOpts { rot?: number; alignDown?: boolean; alpha?: number; tint?: [number, number, number]; roughness?: number; metalness?: number;
  /**
   * Multiplies the decal's lit output (default 1). Use this — never a dark `tint` — to stop a
   * decal blowing out in direct sun: `tint` scales ALBEDO, so darkening a already-dark texture
   * (blood) with it crushes the colour to black instead of just dimming it.
   */
  exposure?: number }

export class Decals {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private head = 0; private used = 0;
  private aCell: THREE.InstancedBufferAttribute;
  private aTint: THREE.InstancedBufferAttribute;
  private aMat: THREE.InstancedBufferAttribute;
  private basis = new Float32Array(9);
  private m = new THREE.Matrix4();
  private fadeWindow: number;

  constructor(atlas: Atlas, capacity: number) {
    this.capacity = Math.max(8, capacity | 0);
    this.fadeWindow = Math.max(2, Math.round(this.capacity * 0.12));
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aMat = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    geo.setAttribute('aCell', this.aCell); geo.setAttribute('aTint', this.aTint); geo.setAttribute('aMat', this.aMat);
    const mat = new THREE.MeshStandardMaterial({ map: atlas.texture, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, envMapIntensity: 1 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aCell; attribute vec4 aTint; attribute vec4 aMat; varying vec4 vCell; varying vec4 vTint; varying vec4 vMat;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = aCell; vTint = aTint; vMat = aMat;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vCell; varying vec4 vTint; varying vec4 vMat;')
        .replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D( map, vCell.xy + vMapUv * vCell.zw );\ndiffuseColor *= sampledDiffuseColor * vTint;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vMat.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;')
        // per-decal exposure on the lit result (before tonemapping), so brightness can be dialled
        // back without touching albedo
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb *= vMat.z;\n#include <tonemapping_fragment>');
    };
    mat.customProgramCacheKey = () => 'fx-decal';
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'fx-decals';
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, this.m);
  }

  place(point: THREE.Vector3, normal: THREE.Vector3, cell: number, size: number, opts: DecalOpts = {}): void {
    const i = this.head;
    decalBasis(normal, opts.rot ?? 0, opts.alignDown ?? false, this.basis);
    const b = this.basis, e = this.m.elements;
    // columns: t*size, b*size, n ; translation = point + n * 0.006
    e[0] = b[0] * size; e[1] = b[1] * size; e[2] = b[2] * size; e[3] = 0;
    e[4] = b[3] * size; e[5] = b[4] * size; e[6] = b[5] * size; e[7] = 0;
    e[8] = b[6]; e[9] = b[7]; e[10] = b[8]; e[11] = 0;
    e[12] = point.x + b[6] * 0.0025; e[13] = point.y + b[7] * 0.0025; e[14] = point.z + b[8] * 0.0025; e[15] = 1;
    this.mesh.setMatrixAt(i, this.m);
    cellRect(cell, this.aCell.array as Float32Array, i * 4);
    const t = opts.tint ?? WHITE;
    const ta = this.aTint.array as Float32Array;
    ta[i * 4] = t[0]; ta[i * 4 + 1] = t[1]; ta[i * 4 + 2] = t[2]; ta[i * 4 + 3] = opts.alpha ?? 1;
    const ma = this.aMat.array as Float32Array;
    ma[i * 4] = opts.roughness ?? 0.85; ma[i * 4 + 1] = opts.metalness ?? 0; ma[i * 4 + 2] = opts.exposure ?? 1; ma[i * 4 + 3] = 0;
    // fade the oldest slots (the ones about to be overwritten)
    for (let k = 1; k <= this.fadeWindow; k++) {
      const s = (i + k) % this.capacity;
      ta[s * 4 + 3] = Math.min(ta[s * 4 + 3], fadeWindowAlpha(s, i, this.capacity, this.fadeWindow)) ;
    }
    this.head = (i + 1) % this.capacity;
    if (this.used < this.capacity) this.used++;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aCell.needsUpdate = true; this.aTint.needsUpdate = true; this.aMat.needsUpdate = true;
  }

  clear(): void {
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, this.m);
    this.head = 0; this.used = 0; this.mesh.count = 0; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const WHITE: [number, number, number] = [1, 1, 1];
