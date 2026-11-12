import * as THREE from 'three';
import { SPEC_OF } from '../vehicle/Spec';
import { specLength, type BodyType } from '../vehicle/Bodies';

/**
 * 车流的转向灯（2026-11-11，street-level-design A6）：变道、拐弯的车在那一侧的车头车尾各亮一个琥珀色的小块，一秒多闪
 * 一下。车模的灯是按实例开关的刹车灯和倒车灯，没有转向灯这一路，九种车身逐个加太费事，所以单画：一个实例化网格，一次
 * 绘制调用，最多 `cap` 个灯。颜色是 HDR 的，辉光会带上。
 */
export class Blinkers {
  private mesh: THREE.InstancedMesh;
  private n = 0;
  private on = false;
  private dims = new Map<BodyType, { hw: number; hl: number; y: number }>();

  constructor(scene: THREE.Scene, private cap = 64) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.6, 0.02) });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.11, 0.24), mat, cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'traffic-blinkers';
    scene.add(this.mesh);
  }

  private dim(body: BodyType): { hw: number; hl: number; y: number } {
    let d = this.dims.get(body);
    if (!d) {
      const spec = SPEC_OF[body];
      let hw = 0;
      for (const c of spec.chassis) hw = Math.max(hw, Math.abs(c.at[0]) + c.half[0]);
      d = { hw: Math.max(0.3, hw - 0.08), hl: specLength(spec) / 2 - 0.12, y: spec.single ? 0.62 : 0.68 + spec.wheelRadius * 0.2 };
      this.dims.set(body, d);
    }
    return d;
  }

  /** 一帧开头：清空，定这一帧是亮是灭（每秒 1.4 下，亮的时候占一半多一点）。 */
  begin(t: number): void { this.n = 0; this.on = (t * 1.4) % 1 < 0.55; }

  /** 一辆车的一侧：(x, y, z) 是车身中心在地面上的位置，`yaw` 朝向，`side` +1 左、-1 右。 */
  add(x: number, y: number, z: number, yaw: number, body: BodyType, side: number): void {
    if (!this.on || this.n + 2 > this.cap) return;
    const sn = Math.sin(yaw), cs = Math.cos(yaw), a = this.mesh.instanceMatrix.array as Float32Array;
    const c = CORNERS[body], d = c ? null : this.dim(body);
    // 左手方向是 (cos, -sin)，车头方向是 (sin, cos)
    for (let e = 0; e < 2; e++) {
      const lx = c ? c[e * 3] : d!.hw, ly = c ? c[e * 3 + 1] : d!.y, lz = c ? c[e * 3 + 2] : (e ? -d!.hl : d!.hl);
      const i = this.n++ * 16;
      a[i] = cs; a[i + 1] = 0; a[i + 2] = -sn; a[i + 3] = 0;
      a[i + 4] = 0; a[i + 5] = 1; a[i + 6] = 0; a[i + 7] = 0;
      a[i + 8] = sn; a[i + 9] = 0; a[i + 10] = cs; a[i + 11] = 0;
      a[i + 12] = x + cs * side * lx + sn * lz; a[i + 13] = y + ly; a[i + 14] = z - sn * side * lx + cs * lz; a[i + 15] = 1;
    }
  }

  commit(): void {
    this.mesh.count = this.n;
    if (this.n) this.mesh.instanceMatrix.needsUpdate = true;
  }
  /** 这一帧画了几个灯（探针）。 */
  get count(): number { return this.n; }
}

/** 左前、左后两个灯的中心，车身坐标（x 往左、y 从地面算、z 往前）：[前 x, y, z, 后 x, y, z]。右边的取 x 的相反数。 */
export type Corners = readonly [number, number, number, number, number, number];

/**
 * 每种车身的车角，`fitCorners` 在浏览器里、交通车的低模（车模是 glb，Node 里只有备用的程序化车身，量不了）上量好的；
 * 运行时量一种车身要 25 毫秒、弱手机上 250 毫秒，所以写死在这里。改了车模就重量：
 * `node .scratch/streetlevel/blinkfit.mjs`（要开着 5198 的开发服务器），把最后打出来的十行贴过来。
 */
export const CORNERS: Partial<Record<BodyType, Corners>> = {
  sedan: [0.78, 0.66, 2.12, 0.79, 0.76, -2.2],
  hatch: [0.77, 0.64, 1.88, 0.77, 0.77, -1.82],
  suv: [0.82, 0.8, 2.09, 0.82, 0.9, -2.14],
  mpv: [0.83, 0.73, 2.3, 0.84, 0.82, -2.53],
  bus: [1.13, 0.69, 5.44, 1.13, 1.27, -6.25],
  truck: [0.89, 0.72, 2.82, 0.91, 0.52, -2.93],
  coupe: [0.58, 0.3, 2.19, 0.62, 0.6, -1.92],
  limo: [0.82, 0.69, 2.5, 0.81, 0.84, -2.5],
  super: [0.85, 0.5, 2.27, 0.65, 0.56, -2.29],
  ae86: [0.62, 0.46, 2, 0.65, 0.53, -1.99],
};

/**
 * 量车角（2026-11-11）：按 Spec 的车宽、车长估的位置在公交上前面悬空、后面埋进车里，跑车、AE86 车头低，灯飘在车鼻上面。
 * 改成在交通车用的低模上量：灯的高度取大灯（尾灯）那一簇的高度，从车头（车尾）往里打一条射线找到车脸，再从侧面打一条
 * 找到车角，灯块贴在那儿、往外露几厘米。`meshes` 是车身（漆、饰件、车灯），原点在车身中心，`lift` 是原点离地面多高。
 */
export function fitCorners(meshes: readonly THREE.Mesh[], lamp: THREE.BufferGeometry | null, lift: number): Corners | null {
  const box = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!); }
  if (box.isEmpty()) return null;
  const rc = new THREE.Raycaster(), o = new THREE.Vector3(), dir = new THREE.Vector3();
  const cast = (ox: number, oy: number, oz: number, dx: number, dz: number): THREE.Vector3 | null => {
    rc.set(o.set(ox, oy, oz), dir.set(dx, 0, dz)); rc.far = 30;
    const h = rc.intersectObjects(meshes as THREE.Mesh[], false)[0];
    return h ? h.point : null;
  };
  const out: number[] = [], h = box.max.y - box.min.y, top = box.min.y + 0.55 * h;
  const pos = lamp?.getAttribute('position');
  const faceAt = (x: number, y: number, e: number): number | null => cast(x, y, e * 30, 0, -e)?.z ?? null;
  const sideAt = (y: number, z: number): number | null => cast(box.max.x + 2, y, z, -1, 0)?.x ?? null;
  for (const e of [1, -1]) {
    // 大灯（尾灯）的高度：车身下半截里、最靠外 0.35 米内车灯顶点的高度中位数（公交顶上的线路牌也算车灯，不要它）
    let ly = box.min.y + h / 3;
    if (pos) {
      let far = -Infinity;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < top) far = Math.max(far, pos.getZ(i) * e);
      const ys: number[] = [];
      if (far > 0.5) for (let i = 0; i < pos.count; i++) if (pos.getY(i) < top && pos.getZ(i) * e > far - 0.35) ys.push(pos.getY(i));
      if (ys.length) { ys.sort((p, q) => p - q); ly = ys[ys.length >> 1]; }
    }
    // 车角：下半截里扫几个高度、几个横向位置，挑最靠外的车脸，偏向车灯的高度（货车车厢底下是空的，打进去会落到后轮那儿）
    let bx = 0, by = 0, bz = 0, best = -Infinity;
    for (let k = 0; k <= 8; k++) {
      const y = k === 0 ? ly : box.min.y + h * (0.12 + 0.43 * (k - 1) / 7);
      for (const kx of [0.85, 0.75, 0.65, 0.5]) {
        const x = box.max.x * kx, z = faceAt(x, y, e);
        if (z === null) continue;
        const score = z * e - 0.3 * Math.abs(y - ly) - 0.25 * (0.85 - kx);
        if (score > best) { best = score; bx = x; by = y; bz = z; }
      }
    }
    if (best === -Infinity) return null;
    // 贴上去：侧面收到车身表面里 7 厘米、车脸收 8 厘米，来回两遍（圆角上两个方向互相影响）
    let x = bx, z = bz - e * 0.08;
    for (let it = 0; it < 2; it++) {
      const sx = sideAt(by, z);
      if (sx !== null && sx > 0.3) x = sx - 0.07;
      const fz = faceAt(x, by, e);
      if (fz !== null) z = fz - e * 0.08;
    }
    out.push(Math.max(0.25, x), by + lift, z);
  }
  return out as unknown as Corners;
}
