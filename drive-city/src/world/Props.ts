import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CG, groups, type Physics } from '../core/Physics';
import type { System } from '../core/Engine';

/** Paint a merged geometry one flat colour per vertex (for single-material instanced props). */
export function tint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/** Traffic cone: square base, orange body, two white reflective sleeves. Origin at its foot. */
function coneGeometry(): THREE.BufferGeometry {
  const base = tint(new THREE.BoxGeometry(0.38, 0.035, 0.38).translate(0, 0.0175, 0), '#e8591c');
  const pts = [new THREE.Vector2(0.17, 0.035), new THREE.Vector2(0.155, 0.1), new THREE.Vector2(0.035, 0.72), new THREE.Vector2(0.001, 0.73)];
  const body = new THREE.LatheGeometry(pts, 20).toNonIndexed();
  const pos = body.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const o = new THREE.Color('#f0621c'), w = new THREE.Color('#f2f2ee');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = (y > 0.3 && y < 0.4) || (y > 0.49 && y < 0.56) ? w : o;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.deleteAttribute('uv');
  return mergeGeometries([base, body])!;
}

/** Three stacked car tyres (the crash barrier every Chinese driving school has). */
function tyreStackGeometry(): THREE.BufferGeometry {
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ring.push(new THREE.Vector2(0.27 + Math.cos(a) * 0.075 * 1.0, 0.125 + Math.sin(a) * 0.12));
  }
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) parts.push(tint(new THREE.LatheGeometry(ring, 18).translate(0, k * 0.25, 0), k === 1 ? '#d8d8d2' : '#1b1b1c'));
  return mergeGeometries(parts)!;
}

/** New Jersey concrete barrier, 3 m long, origin at its foot. */
export function jerseyGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.2, 0.33); s.lineTo(0.1, 0.8); s.lineTo(-0.1, 0.8); s.lineTo(-0.2, 0.33); s.lineTo(-0.3, 0.08); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 2.95, bevelEnabled: false });
  g.translate(0, 0, -1.475);
  return g;
}

interface Dyn { body: RAPIER_NS.RigidBody; slot: number; set: THREE.InstancedMesh }

/**
 * Loose props the car can knock about. Each kind is one InstancedMesh; each prop a small dynamic
 * body in the PROP group (the chassis hits them, the wheel rays do not).
 */
export class Props implements System {
  name = 'props';
  readonly cones: THREE.InstancedMesh;
  readonly tyres: THREE.InstancedMesh;
  private dyn: Dyn[] = [];
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3(1, 1, 1);

  constructor(private physics: Physics, scene: THREE.Scene, maxCones = 80, maxTyres = 40) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    this.cones = new THREE.InstancedMesh(coneGeometry(), mat, maxCones);
    this.tyres = new THREE.InstancedMesh(tyreStackGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), maxTyres);
    for (const m of [this.cones, this.tyres]) {
      m.count = 0; m.castShadow = true; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  private add(set: THREE.InstancedMesh, x: number, z: number, mass: number, collider: RAPIER_NS.ColliderDesc[], yaw = 0): void {
    if (set.count >= set.instanceMatrix.count) return;
    const R = this.physics.R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0.002, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.3).setAngularDamping(0.6).setCanSleep(true));
    const total = collider.length;
    for (const c of collider) {
      c.setDensity(0).setFriction(0.7).setRestitution(0.15).setCollisionGroups(groups(CG.PROP, CG.WORLD | CG.CAR | CG.PROP));
      this.physics.tag(this.physics.world.createCollider(c, body), { surface: 'rubber', tag: 'prop' });
    }
    body.setAdditionalMassProperties(mass, { x: 0, y: total > 1 ? 0.2 : 0.3, z: 0 }, { x: mass * 0.06, y: mass * 0.05, z: mass * 0.06 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    body.sleep();
    const slot = set.count++;
    this.dyn.push({ body, slot, set });
    this._m.compose(this._p.set(x, 0, z), q, this._s);
    set.setMatrixAt(slot, this._m);
    set.instanceMatrix.needsUpdate = true;
  }

  cone(x: number, z: number): void {
    const R = this.physics.R;
    this.add(this.cones, x, z, 3.2, [R.ColliderDesc.cone(0.35, 0.16).setTranslation(0, 0.38, 0), R.ColliderDesc.cuboid(0.19, 0.02, 0.19).setTranslation(0, 0.02, 0)]);
  }

  tyreStack(x: number, z: number): void {
    const R = this.physics.R;
    this.add(this.tyres, x, z, 45, [R.ColliderDesc.cylinder(0.37, 0.35).setTranslation(0, 0.37, 0)]);
  }

  update(): void {
    let dirty = new Set<THREE.InstancedMesh>();
    for (const d of this.dyn) {
      if (d.body.isSleeping()) continue;
      const t = d.body.translation(), r = d.body.rotation();
      this._m.compose(this._p.set(t.x, t.y, t.z), this._q.set(r.x, r.y, r.z, r.w), this._s);
      d.set.setMatrixAt(d.slot, this._m);
      dirty.add(d.set);
    }
    for (const s of dirty) s.instanceMatrix.needsUpdate = true;
  }
}

/** Static instanced things with one shared collider shape each: lamp posts. */
export function lampPostGeometry(): THREE.BufferGeometry {
  const pole = tint(new THREE.CylinderGeometry(0.07, 0.11, 8, 10).translate(0, 4, 0), '#8e9398');
  const arm = tint(new THREE.BoxGeometry(0.08, 0.08, 1.6).translate(0, 7.9, 0.75), '#8e9398');
  const head = tint(new THREE.BoxGeometry(0.34, 0.12, 0.7).translate(0, 7.84, 1.45), '#d9dcdf');
  const base = tint(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10).translate(0, 0.25, 0), '#b7b4ad');
  return mergeGeometries([pole, arm, head, base])!;
}

/**
 * Beijing's roadside poplar (杨树): tall pale trunk, narrow crown built from three lumps, darker
 * at the bottom and lighter at the top (a cheap stand-in for the crown shading itself).
 */
export function poplarGeometry(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.13, 0.22, 8, 7).translate(0, 4, 0);
  const lump = (sx: number, sy: number, y: number, ox: number) => new THREE.IcosahedronGeometry(1, 1).scale(sx, sy, sx).translate(ox, y, 0);
  const crown = mergeGeometries([lump(1.9, 3.4, 8.2, 0), lump(1.55, 3, 10.8, 0.25), lump(1.05, 2.3, 13.1, -0.1)])!;
  const pos = crown.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const lo = new THREE.Color('#3d5a2a'), hi = new THREE.Color('#8fae58'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - 5.5) / 9.5));
    c.copy(lo).lerp(hi, t * t * (3 - 2 * t));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  crown.setAttribute('color', new THREE.BufferAttribute(col, 3));
  crown.computeVertexNormals();
  return { trunk, crown };
}
