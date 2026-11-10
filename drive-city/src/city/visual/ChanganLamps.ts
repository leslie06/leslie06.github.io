import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { RenderApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';
import type { CityStreamer } from '../Streamer';

/**
 * 长安街的华灯（2026-11-10，docs/beijing-immersion-design.md A3）：长安街（东西长安街、建国门内外大街、复兴门内大街）两边
 * 立的不是普通路灯，是白色高杆顶上一簇灯球的华灯，中间也没有白护栏。这里在建网格时把这条路两侧 9 米内的路灯和
 * 护栏去掉（`lampClear`，行道树留着），沿每条车行道的外侧路沿每 32 米立一盏华灯（路口、横穿的路口不立），晚上灯球亮，
 * 夜里路面的路灯光照图也算上它们。网格只画镜头 400 米内的（灯球是 20 面的，不投影子），碰撞体全建。`?huadeng=0` 关（原来的路灯回来）。
 */
const MATCH = /长安街$|^建国门(内|外)大街$|^复兴门内大街$/;
const SPACING = 32, NEAR = 400;

export interface Huadeng { x: number; z: number }

/** Lamp spots and the clear zones (pure). */
export function plan(net: Network): { lamps: Huadeng[]; zones: number[][] } {
  const zones: number[][] = [], lamps: Huadeng[] = [];
  // other roads' segments, to keep lamps out of their mouths
  const CELL = 64, grid = new Map<string, number[]>(), segs: number[] = [];
  const mine = net.edges.filter((e) => e.n && MATCH.test(e.n));
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const e of mine) for (let i = 0; i < e.p.length; i += 2) { x0 = Math.min(x0, e.p[i]); x1 = Math.max(x1, e.p[i]); z0 = Math.min(z0, e.p[i + 1]); z1 = Math.max(z1, e.p[i + 1]); }
  for (const e of net.edges) {
    if (e.n && MATCH.test(e.n)) continue;
    // only the roads round 长安街
    if (e.p[0] < x0 - 300 || e.p[0] > x1 + 300 || e.p[1] < z0 - 300 || e.p[1] > z1 + 300) continue;
    if (!/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|.*_link)$/.test(e.c)) continue;
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const k = segs.push(e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3], e.w / 2 + 3) - 5;
      const cx = Math.floor((e.p[i] + e.p[i + 2]) / 2 / CELL), cz = Math.floor((e.p[i + 1] + e.p[i + 3]) / 2 / CELL);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) { const key = `${a}_${b}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); }
    }
  }
  const inOther = (x: number, z: number) => {
    for (const k of grid.get(`${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`) ?? []) {
      const ax = segs[k], az = segs[k + 1], vx = segs[k + 2] - ax, vz = segs[k + 3] - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < segs[k + 4]) return true;
    }
    return false;
  };
  for (const e of mine) {
    if (e.h && Math.max(...e.h) > 0.5) continue;
    const p = e.p, hw = e.w / 2;
    let total = 0;
    for (let i = 0; i + 3 < p.length; i += 2) total += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    let s = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      if (L < 0.5) continue;
      const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L, rx = -dz, rz = dx, W = hw + 9;
      zones.push([p[i] + rx * W, p[i + 1] + rz * W, p[i + 2] + rx * W, p[i + 3] + rz * W, p[i + 2] - rx * W, p[i + 3] - rz * W, p[i] - rx * W, p[i + 1] - rz * W]);
      for (let at = Math.ceil((s + 1) / SPACING) * SPACING; at < s + L; at += SPACING) {
        if (at < 15 || at > total - 15) continue;
        const t = (at - s) / L, cx = p[i] + (p[i + 2] - p[i]) * t, cz = p[i + 1] + (p[i + 3] - p[i + 1]) * t;
        // one-way carriageways: the kerb on the right; two-way: both sides
        for (const side of e.o === 1 ? [1] : [1, -1]) {
          const x = cx + rx * (hw + 1) * side, z = cz + rz * (hw + 1) * side;
          if (!inOther(x, z)) lamps.push({ x, z });
        }
      }
      s += L;
    }
  }
  return { lamps, zones };
}

/** The lamp: an ivory pole, a collar, and a crown of globes on two tiers of arms (metres, foot at the origin). */
function lampGeometry(): { body: THREE.BufferGeometry; globes: THREE.BufferGeometry } {
  const body: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.42, 0.5, 0.7, 12).translate(0, 0.35, 0),
    new THREE.CylinderGeometry(0.11, 0.19, 9, 10).translate(0, 5.2, 0),
    new THREE.CylinderGeometry(0.24, 0.24, 0.3, 10).translate(0, 7.4, 0),
  ];
  const globes: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(0.3, 0).translate(0, 10.0, 0)];
  const tier = (y: number, n: number, reach: number, r: number, off: number) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + off, x = Math.cos(a) * reach, z = Math.sin(a) * reach;
      const arm = new THREE.CylinderGeometry(0.035, 0.035, reach, 5).rotateZ(Math.PI / 2).translate(reach / 2, 0, 0).rotateY(-a).translate(0, y - 0.15, 0);
      body.push(arm);
      globes.push(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z));
    }
  };
  tier(8.4, 8, 0.95, 0.22, 0);
  tier(9.3, 4, 0.55, 0.2, Math.PI / 4);
  const b = mergeGeometries(body)!, g = mergeGeometries(globes)!;
  for (const x of [...body, ...globes]) x.dispose();
  return { body: b, globes: g };
}

/** The clear zones go to the streamer before the first tiles are asked for; call from city/ at install. */
export function install(engine: Engine, streamer: CityStreamer, net: Network): void {
  if (new URLSearchParams(location.search).get('huadeng') === '0') return;
  const { lamps, zones } = plan(net);
  if (!lamps.length) return;
  streamer.lampClear.push(...zones);
  // their light on the road at night (render/StreetLights), the heads over the kerb
  for (const l of lamps) streamer.extraHeads.push(l.x, l.z);
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL);
  for (const l of lamps) engine.physics.tag(world.createCollider(R.ColliderDesc.cylinder(4.5, 0.2).setTranslation(l.x, 4.5, l.z).setCollisionGroups(g), body), { surface: 'metal', tag: 'lamp' });
  const geo = lampGeometry();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ece6d6', roughness: 0.45, metalness: 0.15 });
  bodyMat.userData.wet = 'surface';
  const globeMat = new THREE.MeshStandardMaterial({ color: '#f7f2e4', roughness: 0.25, emissive: '#ffefc8', emissiveIntensity: 0.05 });
  const meshes = [new THREE.InstancedMesh(geo.body, bodyMat, lamps.length), new THREE.InstancedMesh(geo.globes, globeMat, lamps.length)];
  const root = new THREE.Group();
  root.name = 'huadeng';
  // no shadows: the pass would draw every globe again for a thin line on the pavement
  for (const m of meshes) { m.count = 0; m.frustumCulled = false; root.add(m); }
  engine.get<RenderSystem>('render')?.prepare?.(root);
  engine.scene.add(root);
  const mat = new THREE.Matrix4();
  let poll = 0;
  engine.add({
    name: 'huadeng',
    update(dt) {
      if ((poll -= dt) > 0) return;
      poll = 0.5;
      const cam = engine.camera.position;
      let n = 0;
      for (const l of lamps) {
        if (Math.abs(l.x - cam.x) > NEAR || Math.abs(l.z - cam.z) > NEAR) continue;
        mat.makeTranslation(l.x, 0, l.z);
        for (const m of meshes) m.setMatrixAt(n, mat);
        n++;
      }
      for (const m of meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; }
      globeMat.emissiveIntensity = 0.05 + 2.4 * (engine.get<RenderApi>('render')?.night ?? 0);
    },
  });
}
