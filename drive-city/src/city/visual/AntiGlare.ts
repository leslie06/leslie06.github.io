import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../../core/Engine';
import type { WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';
import type { Routes } from '../Routes';
import { shortName } from '../Signs';

/**
 * 环路中间的防撞墙和防眩板（2026-11-10，docs/beijing-immersion-design.md A3）：北京二环到五环的主路，两个方向中间是一道
 * 矮的水泥防撞墙，墙顶一排斜着的绿色防眩板，开在环路上一侧眼就认得出。这里沿每条环路主路（单向车行道、不在桥上）
 * 每 2 米找对面方向的同一条环路，中间带 0.5–12 米宽的地方，在两条车行道正中间放一段墙、一块板（宽绿化带不放）。
 * 只算一个方向（朝东、朝南的那条），不重复。按 256 米一块，镜头 500 米内的画出来（省电档 300 米；两次 draw call，不投影子），没有碰撞体。
 * `?antiglare=0` 关。
 */
const RING = /^[东西南北][二三四五]环$/;
const STEP = 2, BLOCK = 256, NEAR = 500;

/** Per block: [x, z, yaw] per 2 m of median (pure). */
export function medians(net: Network): Map<string, number[]> {
  const ring = net.edges.filter((e) => e.o === 1 && e.n && /^(trunk|motorway)$/.test(e.c) && !e.br && !(e.h && Math.max(...e.h) > 0.5) && RING.test(shortName(e.n)));
  // every segment of the rings in a 64 m grid
  const CELL = 64, grid = new Map<string, number[]>(), seg: number[] = [];
  ring.forEach((e) => {
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const k = seg.push(e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3], e.w / 2) - 5;
      const x0 = Math.floor(Math.min(e.p[i], e.p[i + 2]) / CELL), x1 = Math.floor(Math.max(e.p[i], e.p[i + 2]) / CELL);
      const z0 = Math.floor(Math.min(e.p[i + 1], e.p[i + 3]) / CELL), z1 = Math.floor(Math.max(e.p[i + 1], e.p[i + 3]) / CELL);
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const key = `${a}_${b}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); }
    }
  });
  const out = new Map<string, number[]>();
  for (const e of ring) {
    const p = e.p, hw = e.w / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      if (L < 0.5) continue;
      const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L;
      // one of the two directions only: eastbound-ish, or southbound-ish when going straight north-south
      if (dx < -0.02 || (Math.abs(dx) <= 0.02 && dz < 0)) continue;
      // the median is on the left: (dz, -dx)
      const lx = dz, lz = -dx;
      for (let u = STEP / 2; u < L; u += STEP) {
        const x = p[i] + dx * u, z = p[i + 1] + dz * u;
        let best = Infinity, bhw = 0;
        for (const k of grid.get(`${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`) ?? []) {
          const ax = seg[k], az = seg[k + 1], vx = seg[k + 2] - ax, vz = seg[k + 3] - az, L2 = vx * vx + vz * vz || 1;
          if ((vx * dx + vz * dz) / Math.sqrt(L2) > -0.85) continue;   // the other way
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), px = ax + vx * t, pz = az + vz * t;
          if ((px - x) * lx + (pz - z) * lz <= 0) continue;            // and on our left
          const d = Math.hypot(px - x, pz - z);
          if (d < best) { best = d; bhw = seg[k + 4]; }
        }
        const gap = best - hw - bhw;
        if (!(gap > 0.5 && gap < 12)) continue;
        // the middle of the gap between the two kerbs
        const o = hw + gap / 2, mx = x + lx * o, mz = z + lz * o;
        const key = `${Math.floor(mx / BLOCK)}_${Math.floor(mz / BLOCK)}`;
        (out.get(key) ?? out.set(key, []).get(key)!).push(mx, mz, Math.atan2(dx, dz));
      }
    }
  }
  return out;
}

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('antiglare') === '0') return;
  const net = engine.get<WorldApi & { routes?: Routes }>('world')?.routes?.net;
  if (!net) return;
  // worked out a few seconds in, not in the boot
  let blocks: Map<string, number[]> | null = null, wait = 3;
  // a 2 m length of wall (New Jersey profile, roughly) and the board on it, both along local +Z
  const wall = mergeGeometries([new THREE.BoxGeometry(0.55, 0.35, STEP).translate(0, 0.175, 0), new THREE.BoxGeometry(0.3, 0.5, STEP).translate(0, 0.6, 0)])!;
  // two boards a metre apart, each turned 20° to the road (it blocks the oncoming headlights, not the view across)
  const board = mergeGeometries([-0.5, 0.5].map((z) => new THREE.BoxGeometry(0.03, 0.75, 0.5).rotateY(0.35).translate(0, 1.22, z)))!;
  const wallMat = new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.9 });
  wallMat.userData.wet = 'surface';
  const boardMat = new THREE.MeshStandardMaterial({ color: '#2f7a4a', roughness: 0.6 });
  boardMat.userData.wet = 'surface';
  const CAP = 1400;
  const meshes = [new THREE.InstancedMesh(wall, wallMat, CAP), new THREE.InstancedMesh(board, boardMat, CAP)];
  const root = new THREE.Group();
  root.name = 'anti-glare';
  for (const m of meshes) { m.count = 0; m.frustumCulled = false; m.receiveShadow = true; root.add(m); }
  engine.get<RenderSystem>('render')?.prepare?.(root);
  engine.scene.add(root);
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let lastX = Infinity, lastZ = Infinity;
  engine.add({
    name: 'antiGlare',
    update(dt) {
      if (!blocks) { if ((wait -= dt) > 0) return; blocks = medians(net); }
      const cam = engine.camera.position;
      if (Math.hypot(cam.x - lastX, cam.z - lastZ) < 40) return;
      lastX = cam.x; lastZ = cam.z;
      let n = 0;
      const near = engine.lite ? 300 : NEAR, bi = Math.floor(cam.x / BLOCK), bj = Math.floor(cam.z / BLOCK), r = Math.ceil(near / BLOCK);
      for (let i = bi - r; i <= bi + r && n < CAP; i++) for (let j = bj - r; j <= bj + r && n < CAP; j++) {
        const b = blocks.get(`${i}_${j}`);
        if (!b) continue;
        for (let k = 0; k < b.length && n < CAP; k += 3) {
          if (Math.hypot(b[k] - cam.x, b[k + 1] - cam.z) > near) continue;
          mat.compose(pos.set(b[k], 0, b[k + 1]), q.setFromAxisAngle(up, b[k + 2]), one);
          for (const m of meshes) m.setMatrixAt(n, mat);
          n++;
        }
      }
      for (const m of meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    },
  });
}
