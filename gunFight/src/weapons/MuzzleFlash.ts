import * as THREE from 'three';
import type { Rng } from '../core/Rng';
import type { WeaponMaterials } from './Materials';

/**
 * Viewmodel-space muzzle flash: two crossed side-cone sheets along the bore + a radial petal burst at the
 * muzzle face, additive HDR so bloom picks up the core. Lives ~70 ms with a fast decay, random roll and
 * size per shot. One mesh, one draw call, only drawn while alive.
 */
export class MuzzleFlash {
  readonly mesh: THREE.Mesh;
  private life = 0;
  private baseScale = 1;
  private mat: THREE.MeshBasicMaterial;

  constructor(mats: WeaponMaterials) {
    const g: THREE.BufferGeometry[] = [];
    // side cones: quad from z=0 (muzzle) to z=-1, 0.42 tall; texture left half (u 0..0.5) base at u=0
    for (const roll of [0, Math.PI / 2]) {
      const q = new THREE.PlaneGeometry(1, 0.42);
      const uv = q.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5);
      q.rotateY(-Math.PI / 2);      // plane spans z (was x)
      q.translate(0, 0, -0.5);
      q.rotateZ(roll);
      g.push(q.toNonIndexed());
    }
    // radial burst at the muzzle face: 0.4 x 0.4, texture right half
    const burst = new THREE.PlaneGeometry(0.42, 0.42);
    const buv = burst.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < buv.count; i++) buv.setX(i, 0.5 + buv.getX(i) * 0.5);
    burst.translate(0, 0, -0.05);
    g.push(burst.toNonIndexed());
    const pos: number[] = [], uvs: number[] = [];
    for (const geo of g) { pos.push(...Array.from(geo.getAttribute('position').array as Float32Array)); uvs.push(...Array.from(geo.getAttribute('uv').array as Float32Array)); }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.mat = mats.flash.clone();
    this.mesh = new THREE.Mesh(merged, this.mat);
    this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.name = 'muzzleFlash';
  }

  /** `scale` ~ length in meters (0.3 rifle, 0.2 pistol, 0.45 shotgun). */
  fire(scale: number, rng: Rng): void {
    this.life = 1;
    this.baseScale = scale * (0.85 + rng.next() * 0.35);
    this.mesh.rotation.set(0, 0, rng.next() * Math.PI * 2);
    this.mesh.visible = true;
    this.apply();
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life = Math.max(0, this.life - dt / 0.07);
    if (this.life <= 0) { this.mesh.visible = false; return; }
    this.apply();
  }

  private apply(): void {
    const l = this.life;
    const s = this.baseScale * (0.75 + 0.25 * l);
    this.mesh.scale.set(s, s, s);
    this.mat.opacity = Math.pow(l, 0.6);
  }
}
