import * as THREE from 'three';
import { CG, groups, type Physics } from '../core/Physics';
import type { RampDef } from './Layout';
import { HILL, OFFICE, YARD } from './Layout';
import * as T from './Textures';

const WORLD_GROUPS = groups(CG.WORLD, CG.ALL);

/** A static box collider on the shared fixed body. */
export function staticBox(physics: Physics, x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0, surface: 'concrete' | 'metal' = 'concrete'): void {
  const R = physics.R;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const body = staticBody(physics);
  const c = physics.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setFriction(0.6).setCollisionGroups(WORLD_GROUPS), body);
  physics.tag(c, { surface });
}

let fixed: import('@dimforge/rapier3d-compat').RigidBody | null = null;
let fixedWorld: unknown = null;
export function staticBody(physics: Physics) {
  if (!fixed || fixedWorld !== physics.world) { fixed = physics.world.createRigidBody(physics.R.RigidBodyDesc.fixed()); fixedWorld = physics.world; }
  return fixed;
}

function convex(physics: Physics, pts: number[], surface: 'concrete' = 'concrete'): void {
  const desc = physics.R.ColliderDesc.convexHull(new Float32Array(pts));
  if (!desc) return;
  const c = physics.world.createCollider(desc.setFriction(0.9).setCollisionGroups(WORLD_GROUPS), staticBody(physics));
  physics.tag(c, { surface });
}

/** The blue hoarding round the yard, with a gap for the gate on the south side. */
export function buildWalls(physics: Physics, scene: THREE.Scene): void {
  const h = 2.6, half = YARD.half + 6, gap = YARD.gate.width / 2;
  const tex = T.hoarding();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.3 });
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const t = tex.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(L / 32, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, 0.12), mat.clone());
    (m.material as THREE.MeshStandardMaterial).map = t;
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    staticBox(physics, m.position.x, h / 2, m.position.z, L / 2, h / 2, 0.15, yaw, 'metal');
  };
  run(-half, half, half, half);
  run(half, half, half, -half);
  run(-half, -half, -half, half);
  run(half, -half, gap, -half);
  run(-gap, -half, -half, -half);
  // Gate: red pillars, a beam and the sign.
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#b8231b', roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, 6.4, 1), pillarMat);
    p.position.set(sx * (gap + 0.6), 3.2, -half);
    p.castShadow = true;
    scene.add(p);
    staticBox(physics, p.position.x, 3.2, p.position.z, 0.5, 3.2, 0.5);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gap * 2 + 2.2, 1.5, 0.5), pillarMat);
  beam.position.set(0, 6.1, -half); beam.castShadow = true;
  scene.add(beam);
  const signMat = new THREE.MeshStandardMaterial({ map: T.gateSign(), roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.05 });
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(gap * 2 + 1.6, 1.25), signMat);
    sign.position.set(0, 6.1, -half + side * 0.26);
    if (side < 0) sign.rotation.y = Math.PI;
    scene.add(sign);
  }
}

/** Two-storey office with a red rooftop sign. */
export function buildOffice(physics: Physics, scene: THREE.Scene): void {
  const { x, z, w, d, h } = OFFICE;
  const facade = T.officeFacade();
  const wall = new THREE.MeshStandardMaterial({ color: '#e1dfd9', roughness: 0.8 });
  const front = new THREE.MeshStandardMaterial({ map: facade, roughness: 0.6 });
  const mats = [wall, wall, new THREE.MeshStandardMaterial({ color: '#8c8f91', roughness: 0.9 }), wall, front, front];
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  b.position.set(x, h / 2, z);
  b.castShadow = true; b.receiveShadow = true;
  scene.add(b);
  staticBox(physics, x, h / 2, z, w / 2, h / 2, d / 2);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), new THREE.MeshStandardMaterial({ color: '#cfccc4', roughness: 0.8 }));
  parapet.position.set(x, h + 0.25, z);
  scene.add(parapet);
  // Rooftop characters, the way every Chinese institution labels its building.
  const c = document.createElement('canvas'); c.width = 1024; c.height = 220;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d42a1e'; g.font = `900 180px ${T.CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('京城驾校', 512, 118);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.4), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, emissive: '#ff3322', emissiveMap: tex, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
  sign.position.set(x, h + 2.2, z + d / 2 - 0.4);
  scene.add(sign);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(16, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.6, roughness: 0.4 }));
  frame.position.set(x, h + 0.55, z + d / 2 - 0.4);
  scene.add(frame);
}

/** Wedge rising from the ground to `height` over `length`, facing +Z after `yaw`. */
export function buildRamp(physics: Physics, scene: THREE.Scene, r: RampDef, material: THREE.Material, face?: THREE.Material): void {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(r.length, r.height); shape.lineTo(r.length + 0.6, r.height); shape.lineTo(r.length + 0.6, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: r.width, bevelEnabled: false });
  // Shape x -> world +Z (along the run), shape y -> up, extrusion -> world X.
  geo.rotateY(-Math.PI / 2).translate(r.width / 2, 0, 0);
  geo.rotateY(r.yaw);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(r.x, 0, r.z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  const pts: number[] = [];
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pts.push(pos.getX(i) + r.x, pos.getY(i), pos.getZ(i) + r.z);
  convex(physics, pts);
  if (face) {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(r.width, r.height), face);
    back.position.set(r.x, r.height / 2, r.z + r.length + 0.61);
    back.rotation.y = r.yaw;
    scene.add(back);
  }
}

/** 坡道定点停车: up slope, flat top with a stop line, down slope. */
export function buildHill(physics: Physics, scene: THREE.Scene, material: THREE.Material, paint: THREE.Material): void {
  const { x, z, width, up, top, down, height } = HILL;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(up, height); shape.lineTo(up + top, height); shape.lineTo(up + top + down, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2).translate(width / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, 0, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  // Three convex pieces so the top is flat for the collider too.
  const pts = (a: number[][]) => a.flatMap(([u, v]) => [x - width / 2, v, z + u, x + width / 2, v, z + u]);
  convex(physics, pts([[0, 0], [up, height], [up, 0]]));
  convex(physics, pts([[up, 0], [up, height], [up + top, height], [up + top, 0]]));
  convex(physics, pts([[up + top, 0], [up + top, height], [up + top + down, 0]]));
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.6, 0.3), paint);
  stop.rotation.x = -Math.PI / 2;
  stop.position.set(x, height + 0.012, z + up + top * 0.5);
  scene.add(stop);
}
