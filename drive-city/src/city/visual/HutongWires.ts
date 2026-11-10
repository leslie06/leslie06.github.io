import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../../core/Engine';
import type { WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';
import type { Routes } from '../Routes';

/**
 * 胡同的电线杆和电线（2026-11-10，docs/beijing-immersion-design.md A3）：老城的胡同头顶总有一团电线，水泥杆子贴着墙根
 * 一根接一根。这里在二环里（以天安门为原点的一个框）7 米以下的小路（胡同、小街）每隔 28 米在一侧（按路的号定哪边）
 * 贴着路边立一根水泥杆，杆间拉三根往下垂的线；离三条以上的路相交的路口 12 米内不立（拐弯时别挡着）。没有碰撞体。
 * 镜头 250 米内的画出来（省电档 150 米）：杆子一次 draw call，线一次（LineSegments），镜头挪 30 米重填一次。`?wires=0` 关。
 */
const SPACING = 28, BLOCK = 128, NEAR = 250, POLE_H = 7.2;
const OLD_CITY = (x: number, z: number) => x > -4300 && x < 3600 && z > -3600 && z < 4300;
const SMALL = /^(residential|service|living_street|unclassified)$/;

/** Per block: [x, z, yaw, next x, next z (NaN: the last on its run)] per pole (pure). */
export function poles(net: Network): Map<string, number[]> {
  const deg = new Map<number, number>();
  for (const e of net.edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  const node = new Map<number, [number, number]>();
  for (const e of net.edges) { node.set(e.a, [e.p[0], e.p[1]]); node.set(e.b, [e.p[e.p.length - 2], e.p[e.p.length - 1]]); }
  const junctions: [number, number][] = [];
  for (const [id, d] of deg) if (d > 2) { const p = node.get(id); if (p && OLD_CITY(p[0], p[1])) junctions.push(p); }
  const jgrid = new Map<string, [number, number][]>();
  for (const j of junctions) { const k = `${Math.floor(j[0] / 32)}_${Math.floor(j[1] / 32)}`; (jgrid.get(k) ?? jgrid.set(k, []).get(k)!).push(j); }
  const nearJunction = (x: number, z: number) => {
    for (let a = Math.floor(x / 32) - 1; a <= Math.floor(x / 32) + 1; a++) for (let b = Math.floor(z / 32) - 1; b <= Math.floor(z / 32) + 1; b++) {
      for (const [jx, jz] of jgrid.get(`${a}_${b}`) ?? []) if (Math.hypot(jx - x, jz - z) < 12) return true;
    }
    return false;
  };
  const out = new Map<string, number[]>();
  net.edges.forEach((e, ei) => {
    if (!SMALL.test(e.c) || e.w > 7 || e.br || !OLD_CITY(e.p[0], e.p[1])) return;
    const p = e.p, side = ei % 2 ? 1 : -1, off = e.w / 2 + 0.25;
    let total = 0;
    for (let i = 0; i + 3 < p.length; i += 2) total += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (total < SPACING) return;
    const run: number[] = [];
    let s = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      if (L < 0.3) { s += L; continue; }
      const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L, rx = -dz * side, rz = dx * side;
      for (let at = Math.ceil((s - 6) / SPACING) * SPACING + 6; at < s + L; at += SPACING) {
        if (at < s) continue;
        const u = at - s, x = p[i] + dx * u + rx * off, z = p[i + 1] + dz * u + rz * off;
        if (nearJunction(x, z)) { run.push(NaN, NaN, 0); continue; }
        run.push(x, z, Math.atan2(dx, dz));
      }
      s += L;
    }
    for (let k = 0; k < run.length; k += 3) {
      if (Number.isNaN(run[k])) continue;
      const nx = run[k + 3] ?? NaN, nz = run[k + 4] ?? NaN;
      const key = `${Math.floor(run[k] / BLOCK)}_${Math.floor(run[k + 1] / BLOCK)}`;
      (out.get(key) ?? out.set(key, []).get(key)!).push(run[k], run[k + 1], run[k + 2], nx, nz);
    }
  });
  return out;
}

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('wires') === '0') return;
  const net = engine.get<WorldApi & { routes?: Routes }>('world')?.routes?.net;
  if (!net) return;
  // worked out a few seconds in, not in the boot (~60 ms on a desktop)
  let blocks: Map<string, number[]> | null = null, wait = 4;
  // a tapered concrete pole with a crossarm (across the lane, local x) and three insulators
  const geo = mergeGeometries([
    new THREE.CylinderGeometry(0.09, 0.15, POLE_H, 7).translate(0, POLE_H / 2, 0),
    new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, POLE_H - 0.45, 0),
    ...[-0.6, 0, 0.6].map((x) => new THREE.CylinderGeometry(0.04, 0.04, 0.16, 5).translate(x, POLE_H - 0.32, 0)),
  ])!;
  const poleMat = new THREE.MeshStandardMaterial({ color: '#9e9a92', roughness: 0.9 });
  poleMat.userData.wet = true;
  const CAP = 900;
  const mesh = new THREE.InstancedMesh(geo, poleMat, CAP);
  mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
  const WSEG = 6, MAXW = CAP * 3 * WSEG * 2;
  const wpos = new Float32Array(MAXW * 3);
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3).setUsage(THREE.DynamicDrawUsage));
  wgeo.setDrawRange(0, 0);
  const wires = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: '#1d1f22' }));
  wires.frustumCulled = false;
  const root = new THREE.Group();
  root.name = 'hutong-wires';
  root.add(mesh, wires);
  engine.get<RenderSystem>('render')?.prepare?.(root);
  engine.scene.add(root);
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let lastX = Infinity, lastZ = Infinity;
  engine.add({
    name: 'hutongWires',
    update(dt) {
      if (!blocks) { if ((wait -= dt) > 0) return; blocks = poles(net); }
      const cam = engine.camera.position;
      if (Math.hypot(cam.x - lastX, cam.z - lastZ) < 30) return;
      lastX = cam.x; lastZ = cam.z;
      let n = 0, w = 0;
      const near = engine.lite ? 150 : NEAR, bi = Math.floor(cam.x / BLOCK), bj = Math.floor(cam.z / BLOCK), r = Math.ceil(near / BLOCK);
      for (let i = bi - r; i <= bi + r; i++) for (let j = bj - r; j <= bj + r; j++) {
        const b = blocks.get(`${i}_${j}`);
        if (!b) continue;
        for (let k = 0; k < b.length && n < CAP; k += 5) {
          const x = b[k], z = b[k + 1], yaw = b[k + 2];
          if (Math.hypot(x - cam.x, z - cam.z) > near) continue;
          // the crossarm across the lane: local x along the road's normal
          mat.compose(pos.set(x, 0, z), q.setFromAxisAngle(up, yaw), one);
          mesh.setMatrixAt(n++, mat);
          const nx = b[k + 3], nz = b[k + 4];
          if (Number.isNaN(nx) || w + 3 * WSEG * 2 * 3 > wpos.length) continue;
          const cx = Math.cos(yaw), cz = -Math.sin(yaw);
          for (const o of [-0.6, 0, 0.6]) {
            const ax = x + cx * o, az = z + cz * o, bx = nx + cx * o, bz = nz + cz * o, y = POLE_H - 0.25, sag = 0.35 + Math.hypot(bx - ax, bz - az) * 0.012;
            for (let t = 0; t < WSEG; t++) {
              for (const tt of [t / WSEG, (t + 1) / WSEG]) {
                wpos[w++] = ax + (bx - ax) * tt; wpos[w++] = y - sag * 4 * tt * (1 - tt); wpos[w++] = az + (bz - az) * tt;
              }
            }
          }
        }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      wgeo.setDrawRange(0, w / 3);
      (wgeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    },
  });
}
