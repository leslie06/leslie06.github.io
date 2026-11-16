import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AirfieldData } from './Data';

/**
 * 廊桥（2026-11-16，第二批）：OSM 的 140 条 `aeroway=jet_bridge` 线。离机位停机点近的那头是机门，另一头接航站楼：
 * 楼那头一个圆转台，接着一节节的通道（宽 3 米、高 2.8 米，底面离地 3.2–3.6 米，车能从下面过），机门那头一个宽一点的驾驶舱，
 * 70% 处一对带轮子的撑脚。一张合并的网格；碰撞体只给撑脚和转台（`colliders`：[x, z, 半宽, 半深, 高, 朝向]）。
 */
export function buildBridges(d: AirfieldData): { geo: THREE.BufferGeometry | null; colliders: number[][] } {
  const parts: THREE.BufferGeometry[] = [], colliders: number[][] = [];
  const BODY = new THREE.Color('#d6d9dc'), GLASS = new THREE.Color('#3b4a57'), LEG = new THREE.Color('#5d6267'), TYRE = new THREE.Color('#1c1d1e');
  const box = (cx: number, cy: number, cz: number, w: number, h: number, l: number, yaw: number, pitch: number, col: THREE.Color) => {
    const g = new THREE.BoxGeometry(w, h, l).toNonIndexed();
    g.rotateX(-pitch); g.rotateY(yaw); g.translate(cx, cy, cz);
    const n = g.getAttribute('position').count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const cyl = (cx: number, cy: number, cz: number, r: number, h: number, col: THREE.Color) => {
    const g = new THREE.CylinderGeometry(r, r, h, 12).toNonIndexed();
    g.translate(cx, cy, cz);
    const n = g.getAttribute('position').count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  for (const b of d.bridges) {
    const p = b.p;
    if (p.length < 4) continue;
    let ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
    // 机门那头：离机位停机点近的那头（Parked.ts bridgeEnds 同一个判断）
    const near = (x: number, z: number) => d.stands.reduce((m, s) => Math.min(m, Math.hypot(s.x - x, s.z - z)), Infinity);
    if (near(ax, az) < near(bx, bz)) [ax, az, bx, bz] = [bx, bz, ax, az];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 6 || L > 80) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, yaw = Math.atan2(ux, uz);
    const y0 = 3.2, y1 = 3.6, pitch = Math.atan2(y1 - y0, L);
    // 转台
    cyl(ax, 1.9, az, 0.6, 3.8, LEG);
    cyl(ax, y0 + 1.4, az, 2.2, 3.0, BODY);
    colliders.push([ax, az, 0.7, 0.7, 3.8, yaw]);
    // 通道（两节，伸缩的那节粗一点）
    const mid = (t: number) => [ax + ux * L * t, az + uz * L * t] as const;
    const [m1x, m1z] = mid(0.32), [m2x, m2z] = mid(0.7);
    box(m1x, y0 + 1.4 + (y1 - y0) * 0.32, m1z, 2.9, 2.7, L * 0.6, yaw, pitch, BODY);
    box(m2x, y0 + 1.4 + (y1 - y0) * 0.7, m2z, 3.2, 2.95, L * 0.42, yaw, pitch, BODY);
    // 侧面一条玻璃
    for (const s of [1, -1]) box(m1x + uz * s * 1.47, y0 + 1.7 + (y1 - y0) * 0.32, m1z - ux * s * 1.47, 0.04, 0.9, L * 0.56, yaw, pitch, GLASS);
    // 驾驶舱（机门那头）
    const [cx, cz] = mid(0.97);
    box(cx, y1 + 1.5, cz, 3.8, 3.0, 2.6, yaw, 0, BODY);
    box(cx + ux * 1.31, y1 + 1.6, cz + uz * 1.31, 3.4, 2.2, 0.06, yaw, 0, GLASS);
    // 撑脚：一对柱子、一根横梁、轮子
    const [lx, lz] = mid(0.7);
    for (const s of [1, -1]) {
      const px = lx + uz * s * 1.3, pz = lz - ux * s * 1.3;
      box(px, y1 / 2, pz, 0.35, y1, 0.35, yaw, 0, LEG);
      box(px, 0.35, pz, 0.45, 0.7, 0.9, yaw, 0, TYRE);
    }
    box(lx, 0.8, lz, 2.9, 0.3, 0.5, yaw, 0, LEG);
    colliders.push([lx, lz, 1.6, 0.45, y1, yaw]);
  }
  if (!parts.length) return { geo: null, colliders };
  const geo = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  geo.computeBoundingSphere();
  return { geo, colliders };
}
