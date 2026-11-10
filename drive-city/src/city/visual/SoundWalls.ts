import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../../core/Engine';
import type { WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import { loadCity, unpackSkyline, type Network, type Skyline, type SkylinePack } from '../Data';
import type { Routes } from '../Routes';
import { shortName } from '../Signs';

/**
 * 隔音屏（2026-11-10，docs/beijing-immersion-design.md A3）：四环、五环和快速路挨着住宅楼的路段，主路外侧立着一道四米多高的
 * 隔音屏：钢立柱、下半截实心板、上半截半透明的蓝绿色板、顶上往路里弯一点。这里沿这些路的主路（单向车行道、不在桥上）
 * 每 4 米看一眼外侧（右边）110 米内有没有住宅楼（skyline.json 里 20 米以上的 resid；环路外侧先是辅路和绿化带，60 米内几乎没有），有就在路沿外 1.2 米立一段；
 * 离路口（三条以上的路相交）40 米内、匝道和斜着岔出去的路 4 米内断开，免得把出口堵上；平行的辅路离得开（0.8 米以上）就照样立在两条路中间。全城约 21 公里（80 毫秒，skyline 到了以后算）。没有碰撞体。
 * 按 256 米一块，镜头 500 米内画（省电档 300 米），三次 draw call。skyline 开局 25 秒后才取。`?soundwalls=0` 关。
 */
const RING = /^[东西南北][四五]环$/;
const EXPRESS = /快速路$|^京通快速路$|^机场高速|^京藏高速|^京承高速|^京开高速/;
const STEP = 4, BLOCK = 256, NEAR = 500, H = 4.4;

/** Per block: [x, z, yaw] per 4 m panel (pure). `sky`: the unpacked skyline. */
export function soundWalls(net: Network, sky: number[]): Map<string, number[]> {
  // housing in a 64 m grid
  const CELL = 64, homes = new Map<string, number[]>();
  for (let o = 0; o < sky.length; o += 8) if (sky[o + 6] === 2) { const k = `${Math.floor(sky[o] / CELL)}_${Math.floor(sky[o + 1] / CELL)}`; (homes.get(k) ?? homes.set(k, []).get(k)!).push(o); }
  const homeNear = (x: number, z: number, r: number) => {
    for (let a = Math.floor((x - r) / CELL); a <= Math.floor((x + r) / CELL); a++) for (let b = Math.floor((z - r) / CELL); b <= Math.floor((z + r) / CELL); b++) {
      for (const o of homes.get(`${a}_${b}`) ?? []) if (Math.hypot(sky[o] - x, sky[o + 1] - z) - Math.max(sky[o + 3], sky[o + 4]) < r) return true;
    }
    return false;
  };
  const deg = new Map<number, number>();
  for (const e of net.edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  const isMain = (e: Network['edges'][number]) => e.o === 1 && !!e.n && /^(trunk|motorway)$/.test(e.c) && !e.br && !(e.h && Math.max(...e.h) > 0.5) && (RING.test(shortName(e.n)) || EXPRESS.test(e.n));
  // the main roads' cells, then every other road's segments near them (slip roads, exits, the side roads alongside)
  const SG = 64, mainCells = new Set<string>();
  for (const e of net.edges) if (isMain(e)) for (let i = 0; i < e.p.length; i += 2) mainCells.add(`${Math.floor(e.p[i] / SG)}_${Math.floor(e.p[i + 1] / SG)}`);
  const grid = new Map<string, number[]>(), seg: number[] = [];
  net.edges.forEach((e) => {
    if (isMain(e)) return;
    const link = e.c.endsWith('_link') ? 1 : 0;
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const cx = Math.floor((e.p[i] + e.p[i + 2]) / 2 / SG), cz = Math.floor((e.p[i + 1] + e.p[i + 3]) / 2 / SG);
      if (!mainCells.has(`${cx}_${cz}`)) continue;
      const k = seg.push(e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3], e.w / 2, link) - 6;
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) { const key = `${a}_${b}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); }
    }
  });
  /** A slip road, or a road leaving at an angle, within reach; or a road alongside too close for a wall between. */
  const blocked = (x: number, z: number, dx: number, dz: number) => {
    for (const k of grid.get(`${Math.floor(x / SG)}_${Math.floor(z / SG)}`) ?? []) {
      const ax = seg[k], az = seg[k + 1], vx = seg[k + 2] - ax, vz = seg[k + 3] - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      const along = Math.abs(vx * dx + vz * dz) / Math.sqrt(L2);
      if (seg[k + 5] || along < 0.9 ? d < seg[k + 4] + 4 : d < seg[k + 4] + 0.8) return true;
    }
    return false;
  };
  const out = new Map<string, number[]>();
  for (const e of net.edges) {
    if (!isMain(e)) continue;
    const p = e.p, off = e.w / 2 + 1.2;
    let total = 0;
    for (let i = 0; i + 3 < p.length; i += 2) total += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    const pad0 = (deg.get(e.a) ?? 0) > 2 ? 40 : 0, pad1 = (deg.get(e.b) ?? 0) > 2 ? 40 : 0;
    let s = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      if (L < 0.5) { s += L; continue; }
      const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L, rx = -dz, rz = dx;
      for (let u = (STEP - (s % STEP)) % STEP + STEP / 2; u < L; u += STEP) {
        const at = s + u;
        if (at < pad0 || at > total - pad1) continue;
        const x = p[i] + dx * u + rx * off, z = p[i + 1] + dz * u + rz * off;
        const bl = blocked(x, z, dx, dz), hn = homeNear(x + rx * 55, z + rz * 55, 55);
        if (bl || !hn) continue;
        const key = `${Math.floor(x / BLOCK)}_${Math.floor(z / BLOCK)}`;
        (out.get(key) ?? out.set(key, []).get(key)!).push(x, z, Math.atan2(dx, dz));
      }
      s += L;
    }
  }
  return out;
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if (q.get('soundwalls') === '0') return;
  const net = engine.get<WorldApi & { routes?: Routes }>('world')?.routes?.net;
  if (!net) return;
  let blocks: Map<string, number[]> | null = null, asked = false, waited = 0;
  // a 4 m bay along local +Z: a post, the solid lower panel, the clear upper one, the lip leaning over the road (local +X: the wall stands on the right of the traffic)
  const posts = mergeGeometries([
    new THREE.BoxGeometry(0.22, H, 0.22).translate(0, H / 2, -STEP / 2),
    new THREE.BoxGeometry(0.1, 1.3, STEP).translate(0, 0.65, 0),
    new THREE.BoxGeometry(0.9, 0.1, STEP).rotateZ(0.5).translate(0.38, H + 0.2, 0),
  ])!;
  const glass = new THREE.BoxGeometry(0.04, H - 1.3, STEP - 0.22).translate(0, 1.3 + (H - 1.3) / 2, 0);
  const steel = new THREE.MeshStandardMaterial({ color: '#8b949b', roughness: 0.5, metalness: 0.5 });
  steel.userData.wet = 'surface';
  const pane = new THREE.MeshStandardMaterial({ color: '#7fc0c7', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.42, depthWrite: false });
  pane.userData.wet = 'surface';
  const CAP = 1200;
  const meshes = [new THREE.InstancedMesh(posts, steel, CAP), new THREE.InstancedMesh(glass, pane, CAP)];
  const root = new THREE.Group();
  root.name = 'sound-walls';
  for (const m of meshes) { m.count = 0; m.frustumCulled = false; root.add(m); }
  meshes[1].renderOrder = 1;
  engine.get<RenderSystem>('render')?.prepare?.(root);
  engine.scene.add(root);
  const mat = new THREE.Matrix4(), qq = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let lastX = Infinity, lastZ = Infinity;
  engine.add({
    name: 'soundWalls',
    update(dt) {
      if (!asked && (waited += dt) > (q.has('shot') ? 0 : 26)) {
        asked = true;
        void loadCity<Skyline | SkylinePack>('skyline.json').then(unpackSkyline).then((s) => { blocks = soundWalls(net, s.b); lastX = Infinity; }).catch(() => { /* none */ });
      }
      if (!blocks) return;
      const cam = engine.camera.position;
      if (Math.hypot(cam.x - lastX, cam.z - lastZ) < 40) return;
      lastX = cam.x; lastZ = cam.z;
      const near = engine.lite ? 300 : NEAR, bi = Math.floor(cam.x / BLOCK), bj = Math.floor(cam.z / BLOCK), r = Math.ceil(near / BLOCK);
      let n = 0;
      for (let i = bi - r; i <= bi + r && n < CAP; i++) for (let j = bj - r; j <= bj + r && n < CAP; j++) {
        const b = blocks.get(`${i}_${j}`);
        if (!b) continue;
        for (let k = 0; k < b.length && n < CAP; k += 3) {
          if (Math.hypot(b[k] - cam.x, b[k + 1] - cam.z) > near) continue;
          mat.compose(pos.set(b[k], 0, b[k + 1]), qq.setFromAxisAngle(up, b[k + 2]), one);
          for (const m of meshes) m.setMatrixAt(n, mat);
          n++;
        }
      }
      for (const m of meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    },
  });
}
