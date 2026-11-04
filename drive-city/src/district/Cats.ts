import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnvUniforms } from '../game/Contracts';

/**
 * Cats (2026-11-04, 南锣鼓巷 round 3: the cat café and the lost cat): made here, not a model - a body, a head with ears,
 * a tail, four legs, each part one InstancedMesh for all the cats (four draw calls while any is out), coloured per cat.
 * Poses: sitting up, a loaf (lying with the paws tucked), curled asleep, walking (the legs swinging, the tail up).
 */
export type CatPose = 'sit' | 'loaf' | 'curl' | 'walk';
export interface CatState { x: number; y: number; z: number; yaw: number; pose: CatPose; coat: number; t: number }

/** Coats: ginger (the café's 大橘), black, white, grey tabby, cream. */
export const COATS = ['#c87a34', '#1d1b1b', '#e6e1d6', '#7d7973', '#d8c3a0'];
const CAP = 12;

const _m = new THREE.Matrix4(), _p = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function headGeo(): THREE.BufferGeometry {
  const skull = new THREE.SphereGeometry(0.068, 12, 9);
  skull.scale(1, 0.9, 1.05);
  const muzzle = new THREE.SphereGeometry(0.032, 8, 6);
  muzzle.translate(0, -0.018, 0.058);
  const ears = [-1, 1].map((s) => { const e = new THREE.ConeGeometry(0.026, 0.05, 4); e.rotateY(Math.PI / 4); e.translate(s * 0.036, 0.066, 0.004); e.rotateZ(-s * 0.18); return e; });
  const g = mergeGeometries([skull, muzzle, ...ears].map((x) => x.toNonIndexed()))!;
  return g;
}

/** The cats drawn this frame: `begin`, `add` each, `commit`. */
export class Cats {
  private body: THREE.InstancedMesh; private head: THREE.InstancedMesh; private tail: THREE.InstancedMesh; private leg: THREE.InstancedMesh;
  private n = 0;

  constructor(scene: THREE.Scene, env?: EnvUniforms) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    // fur: a touch of light of its own at night (the lanes' lamps light them; nothing else here does)
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = env?.uNight ?? { value: 0 };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.12 * uNight;');
    };
    mat.customProgramCacheKey = () => 'nl-cats';
    const body = new THREE.SphereGeometry(1, 14, 10);
    const tail = new THREE.CylinderGeometry(0.012, 0.02, 1, 6, 4);
    tail.translate(0, 0.5, 0);
    const leg = new THREE.CylinderGeometry(0.016, 0.019, 1, 6);
    leg.translate(0, -0.5, 0);
    const mk = (g: THREE.BufferGeometry, name: string) => {
      const m = new THREE.InstancedMesh(g, mat, name === 'leg' ? CAP * 4 : CAP);
      m.name = `nl-cat-${name}`; m.frustumCulled = false; m.castShadow = name === 'body'; m.receiveShadow = true;
      m.count = 0; m.visible = false;
      m.setColorAt(0, _c.set('#ffffff'));
      scene.add(m);
      return m;
    };
    this.body = mk(body, 'body'); this.head = mk(headGeo(), 'head'); this.tail = mk(tail, 'tail'); this.leg = mk(leg, 'leg');
  }

  begin(): void { this.n = 0; }

  add(c: CatState): void {
    if (this.n >= CAP) return;
    const i = this.n++;
    _c.set(COATS[c.coat % COATS.length]);
    // the cat's frame: feet at (x, y, z), facing yaw (+Z its nose)
    _p.compose(_v.set(c.x, c.y, c.z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, c.yaw), _s.set(1, 1, 1));
    const t = c.t, breathe = 1 + 0.025 * Math.sin(t * 2.4);
    const part = (mesh: THREE.InstancedMesh, k: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) => {
      _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
      _m.premultiply(_p);
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, _c);
    };
    const legs = (pts: [number, number, number, number, number][]) => pts.forEach(([x, y, z, rx, len], j) => part(this.leg, i * 4 + j, x, y, z, rx, 0, 0, 1, len, 1));
    const swish = Math.sin(t * 1.3) * 0.35;
    if (c.pose === 'walk') {
      const ph = t * 9, bob = Math.abs(Math.sin(ph)) * 0.008;
      part(this.body, i, 0, 0.19 + bob, 0, 0, 0, 0, 0.09, 0.095, 0.2);
      part(this.head, i, 0, 0.27 + bob, 0.2, 0.15, 0, 0, 1, 1, 1);
      part(this.tail, i, 0, 0.22, -0.18, -0.55 + Math.sin(ph * 0.5) * 0.12, 0, Math.sin(ph * 0.5) * 0.3, 1, 0.28, 1);
      const sw = 0.45;
      legs([[0.05, 0.17, 0.12, Math.sin(ph) * sw, 0.17], [-0.05, 0.17, 0.12, -Math.sin(ph) * sw, 0.17],
        [0.05, 0.17, -0.12, -Math.sin(ph) * sw, 0.17], [-0.05, 0.17, -0.12, Math.sin(ph) * sw, 0.17]]);
    } else if (c.pose === 'sit') {
      part(this.body, i, 0, 0.15, -0.03, -0.95, 0, 0, 0.085 * breathe, 0.1, 0.17);
      part(this.head, i, 0, 0.33, 0.06, 0.05 + Math.sin(t * 0.4) * 0.08, Math.sin(t * 0.23) * 0.4, 0, 1, 1, 1);
      // the tail round the feet, its tip twitching
      part(this.tail, i, 0.06, 0.02, -0.1, -Math.PI / 2 + 0.05, -1.1 + swish * 0.3, 0, 1, 0.26, 1);
      legs([[0.035, 0.17, 0.07, 0.05, 0.17], [-0.035, 0.17, 0.07, 0.05, 0.17], [0.07, 0.06, -0.06, 0, 0.05], [-0.07, 0.06, -0.06, 0, 0.05]]);
    } else if (c.pose === 'loaf') {
      part(this.body, i, 0, 0.1, 0, 0, 0, 0, 0.1 * breathe, 0.085 * breathe, 0.19);
      part(this.head, i, 0, 0.19, 0.17, 0.1, Math.sin(t * 0.3) * 0.35, 0, 1, 1, 1);
      part(this.tail, i, 0.07, 0.03, -0.14, -Math.PI / 2 + 0.03, -0.9 + swish * 0.2, 0, 1, 0.24, 1);
      legs([[0.03, 0.03, 0.19, -Math.PI / 2, 0.05], [-0.03, 0.03, 0.19, -Math.PI / 2, 0.05], [0, -1, 0, 0, 0.001], [0, -1, 0, 0, 0.001]]);
    } else {
      // curled up asleep: a low round body, the head on the tail
      part(this.body, i, 0, 0.075, 0, 0, 0.6, 0, 0.13 * breathe, 0.07 * breathe, 0.15);
      part(this.head, i, 0.07, 0.07, 0.1, 0.5, 2.0, 0.6, 0.95, 0.95, 0.95);
      part(this.tail, i, -0.06, 0.03, -0.1, -Math.PI / 2 + 0.05, 2.4, 0, 1, 0.25, 1);
      legs([[0, -1, 0, 0, 0.001], [0, -1, 0, 0, 0.001], [0, -1, 0, 0, 0.001], [0, -1, 0, 0, 0.001]]);
    }
  }

  commit(): void {
    for (const m of [this.body, this.head, this.tail, this.leg]) {
      const k = m === this.leg ? this.n * 4 : this.n;
      m.count = k; m.visible = k > 0;
      if (k) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
  }
}
