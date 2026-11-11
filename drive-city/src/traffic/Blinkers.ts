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
    const d = this.dim(body), sn = Math.sin(yaw), cs = Math.cos(yaw), a = this.mesh.instanceMatrix.array as Float32Array;
    // 左手方向是 (cos, -sin)，车头方向是 (sin, cos)
    const ox = cs * side * d.hw, oz = -sn * side * d.hw;
    for (const e of [1, -1]) {
      const i = this.n++ * 16;
      a[i] = cs; a[i + 1] = 0; a[i + 2] = -sn; a[i + 3] = 0;
      a[i + 4] = 0; a[i + 5] = 1; a[i + 6] = 0; a[i + 7] = 0;
      a[i + 8] = sn; a[i + 9] = 0; a[i + 10] = cs; a[i + 11] = 0;
      a[i + 12] = x + ox + sn * e * d.hl; a[i + 13] = y + d.y; a[i + 14] = z + oz + cs * e * d.hl; a[i + 15] = 1;
    }
  }

  commit(): void {
    this.mesh.count = this.n;
    if (this.n) this.mesh.instanceMatrix.needsUpdate = true;
  }
  /** 这一帧画了几个灯（探针）。 */
  get count(): number { return this.n; }
}
