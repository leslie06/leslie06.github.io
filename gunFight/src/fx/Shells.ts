import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { shellStep, type ShellState } from './math';

/**
 * Ejected brass: one InstancedMesh (one draw call), cheap analytic bounce (gravity, 3 bounces
 * with restitution + friction, then rest), tumbling spin, despawn after ~3s. Floor height is
 * found with a single downward raycast at spawn. Metallic material picks up the scene env map.
 */
const MAX_AGE = 3.2;
const F = 16; // floats per shell: x y z vx vy vz | rx ry rz | wx wy wz | floorY age kind pad

export class Shells {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private data: Float32Array;
  private count = 0;
  private s: ShellState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, resting: false };
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private sc = new THREE.Vector3();
  private rng = new Rng(77);

  constructor(capacity: number) {
    this.capacity = Math.max(8, capacity | 0);
    this.data = new Float32Array(this.capacity * F);
    // 5.56 case along +x, ~45 mm overall.
    //
    // This is the object round 3 called "a ~200 px polished-gold bar floating at frame right" in
    // `fx_muzzle` and `weapon_pistol_fire`. It is not floating and it is not the wrong size — it is
    // ejected brass, and the eject port sits ~0.35 m from the eye, so a 45 mm case genuinely
    // subtends ~150 px. What made it read as a gold bar was that it had nothing on it to read as a
    // *case*: metalness 1 / roughness 0.28 is mirror gold, and a capped cylinder has no open case
    // mouth, no rim, no primer. So: duller fired brass, and vertex-coloured detail (near-black
    // interior at the mouth, darker head, grey primer) that survives at 150 px and costs no extra
    // draw call.
    const BRASS: Rgb = [0.5, 0.36, 0.15], HEAD: Rgb = [0.36, 0.26, 0.11], DARK: Rgb = [0.035, 0.028, 0.022], PRIMER: Rgb = [0.30, 0.29, 0.27];
    const body = new THREE.CylinderGeometry(0.0045, 0.0048, 0.038, 12, 1, true);
    body.rotateZ(Math.PI / 2);
    const neck = new THREE.CylinderGeometry(0.0032, 0.0045, 0.012, 12, 1, true); neck.rotateZ(Math.PI / 2); neck.translate(0.025, 0, 0);
    const rim = new THREE.CylinderGeometry(0.0053, 0.0053, 0.003, 12, 1); rim.rotateZ(Math.PI / 2); rim.translate(-0.019, 0, 0);
    // open case mouth: a dark disc set just inside the neck, so the end reads as a hole
    const mouth = new THREE.CircleGeometry(0.0031, 12); mouth.rotateY(Math.PI / 2); mouth.translate(0.0295, 0, 0);
    const throat = new THREE.CylinderGeometry(0.0031, 0.0031, 0.006, 12, 1, true); throat.rotateZ(Math.PI / 2); throat.translate(0.028, 0, 0);
    // head end: flat base with a primer in the middle
    const head = new THREE.CircleGeometry(0.0053, 12); head.rotateY(-Math.PI / 2); head.translate(-0.0206, 0, 0);
    const primer = new THREE.CircleGeometry(0.0022, 10); primer.rotateY(-Math.PI / 2); primer.translate(-0.0209, 0, 0);
    const geo = mergeGeometries([
      [body, BRASS], [neck, BRASS], [rim, HEAD], [throat, DARK], [mouth, DARK], [head, HEAD], [primer, PRIMER],
    ]);
    // Fired brass, not jewellery: still metal, but rough enough that the sky is a broad sheen
    // rather than a mirror, and dark enough in the albedo to sit below the plaster it flies past.
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.88, roughness: 0.5, envMapIntensity: 0.85 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.name = 'fx-shells';
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, kind: 'rifle' | 'pistol' | 'shotgun', floorY: number): void {
    let i = this.count;
    if (i >= this.capacity) { i = this.rng.int(0, this.capacity - 1); } else this.count++;
    const o = i * F, d = this.data, r = this.rng;
    d[o] = pos.x; d[o + 1] = pos.y; d[o + 2] = pos.z;
    d[o + 3] = vel.x + r.range(-0.4, 0.4); d[o + 4] = vel.y + r.range(-0.3, 0.3); d[o + 5] = vel.z + r.range(-0.4, 0.4);
    d[o + 6] = r.range(0, 6.28); d[o + 7] = r.range(0, 6.28); d[o + 8] = r.range(0, 6.28);
    d[o + 9] = r.range(-25, 25); d[o + 10] = r.range(-30, 30); d[o + 11] = r.range(-25, 25);
    d[o + 12] = floorY; d[o + 13] = 0; d[o + 14] = kind === 'pistol' ? 0.8 : kind === 'shotgun' ? 1.5 : 1.15; d[o + 15] = 0;
  }

  update(dt: number): void {
    const d = this.data;
    let i = 0;
    while (i < this.count) {
      const o = i * F;
      d[o + 13] += dt;
      if (d[o + 13] > MAX_AGE) { // swap-remove
        const last = (this.count - 1) * F;
        if (last !== o) for (let k = 0; k < F; k++) d[o + k] = d[last + k];
        this.count--; continue;
      }
      const s = this.s;
      s.x = d[o]; s.y = d[o + 1]; s.z = d[o + 2]; s.vx = d[o + 3]; s.vy = d[o + 4]; s.vz = d[o + 5]; s.bounces = d[o + 15]; s.resting = d[o + 15] >= 3;
      const bounced = shellStep(s, dt, d[o + 12], 0.005);
      d[o] = s.x; d[o + 1] = s.y; d[o + 2] = s.z; d[o + 3] = s.vx; d[o + 4] = s.vy; d[o + 5] = s.vz; d[o + 15] = s.resting ? 3 : s.bounces;
      if (bounced) { d[o + 9] *= 0.4; d[o + 10] *= 0.4; d[o + 11] *= 0.4; }
      if (!s.resting) { d[o + 6] += d[o + 9] * dt; d[o + 7] += d[o + 10] * dt; d[o + 8] += d[o + 11] * dt; }
      else { d[o + 7] = 0; d[o + 8] = Math.round(d[o + 8] / Math.PI) * Math.PI; }
      const fade = d[o + 13] > MAX_AGE - 0.3 ? (MAX_AGE - d[o + 13]) / 0.3 : 1;
      this.e.set(d[o + 6], d[o + 7], d[o + 8]); this.q.setFromEuler(this.e);
      this.p.set(d[o], d[o + 1], d[o + 2]);
      const k = d[o + 14] * fade;
      this.sc.set(k, k, k);
      this.m.compose(this.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      i++;
    }
    this.mesh.count = this.count;
    if (this.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.count = 0; this.mesh.count = 0; }
}

type Rgb = readonly [number, number, number];

/** Merge parts into one indexed geometry, baking each part's linear RGB into a `color` attribute. */
function mergeGeometries(list: [THREE.BufferGeometry, Rgb][]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const [g] of list) { vCount += g.getAttribute('position').count; iCount += g.index ? g.index.count : 0; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2), col = new Float32Array(vCount * 3), idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const [g, c] of list) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    pos.set(p.array as Float32Array, vo * 3); nor.set(n.array as Float32Array, vo * 3); uv.set(u.array as Float32Array, vo * 2);
    for (let k = 0; k < p.count; k++) { col[(vo + k) * 3] = c[0]; col[(vo + k) * 3 + 1] = c[1]; col[(vo + k) * 3 + 2] = c[2]; }
    const gi = g.index!; for (let k = 0; k < gi.count; k++) idx[io + k] = gi.getX(k) + vo;
    vo += p.count; io += gi.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
