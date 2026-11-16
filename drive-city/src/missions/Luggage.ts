import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 拉杆箱（2026-11-16，机场的客人）：一张实例网格，箱体加拉杆。站着的人箱子立在右手边，走着的人拖在右后方、往前倾一点。
 * 每帧 `begin` → `add` → `commit`，最多 MAX 个；一次绘制调用。
 */
const MAX = 8;
const COLORS = ['#2b3440', '#7a1f2a', '#c9ccd0', '#1f4f6b', '#3a3a3a', '#b9852f'].map((h) => new THREE.Color(h));

export class Luggage {
  private readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene) {
    // 箱体 0.42 × 0.62 × 0.26（底离地 6 厘米，留出轮子），拉杆两根细杆加一根把手
    const box = new THREE.BoxGeometry(0.42, 0.62, 0.26).translate(0, 0.37, 0);
    const pole = (x: number) => new THREE.BoxGeometry(0.025, 0.36, 0.025).translate(x, 0.86, -0.1);
    const grip = new THREE.BoxGeometry(0.22, 0.035, 0.035).translate(0, 1.04, -0.1);
    const wheels = new THREE.BoxGeometry(0.4, 0.06, 0.22).translate(0, 0.03, 0);
    const geo = mergeGeometries([box, pole(-0.09), pole(0.09), grip, wheels])!;
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, COLORS[i % COLORS.length]);
    scene.add(this.mesh);
  }

  begin(): void { this.n = 0; }

  /** 一个人 (x, z) 朝 `yaw`（atan2(x, z)）的箱子；`walking` 拖着走，`y` 地面高度，`tint` 选颜色。 */
  add(x: number, z: number, yaw: number, walking: boolean, y = 0.045, tint = 0): void {
    if (this.n >= MAX) return;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // 右手边：朝 +z 时右手是 -x
    const side = 0.42, back = walking ? 0.55 : 0.05;
    this.p.set(x - c * side - s * back, y, z + s * side - c * back);
    this.e.set(walking ? -0.35 : 0, yaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, COLORS[Math.abs(Math.floor(tint)) % COLORS.length]);
    this.n++;
  }

  commit(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
