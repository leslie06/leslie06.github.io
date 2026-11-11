import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { VehicleApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';

/**
 * 车内（2026-11-10，docs/street-level-design.md A5 第一版，「没有开车的沉浸感」）。引擎盖视角原来是车身正中一个固定的点，
 * 往前看只有一块引擎盖：没有方向盘、仪表台、A 柱，也不能转头。现在这一档是「车内」：镜头在左边驾驶位，眼前是
 * 一套通用的内饰——仪表台和仪表罩、跟着前轮转的方向盘、两根 A 柱、车顶前沿、车内后视镜的壳、两边的门槛；
 * 鼠标或右摇杆转头（左右各约 115 度，停手一秒半回正），回头键看后面。引擎盖是车自己的模型，从风挡看出去就是它。
 *
 * 一套内饰按车宽缩放，不给每种车各做一套；公交、货车和两轮车没有（还是原来那个点）。后视镜不出像、仪表不走针、
 * 手机支架上的导航都没做（第二版）。内饰只在这一档、开着四轮小车时画。
 */
const DARK = '#17181b', TRIM = '#26282c';

/** Where the driver's eyes are in the car's frame (x to the car's left, y up, z forward), by its width. */
export function eyeOf(width: number): THREE.Vector3 { return new THREE.Vector3(0.34 * width / 1.82, 0.86, 0.22); }

export class Cockpit {
  readonly group = new THREE.Group();
  private wheel = new THREE.Group();
  private builtFor = 0;
  constructor(private engine: Engine) {
    this.group.name = 'cockpit';
    this.group.visible = false;
    engine.scene.add(this.group);
  }

  private build(width: number): void {
    this.group.clear();
    this.wheel = new THREE.Group();
    const e = eyeOf(width);
    const mat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.9, metalness: 0 });
    const trim = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.7, metalness: 0.1 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m = mat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); this.group.add(b); return b; };
    // the dash, right across, its top sloping down to the windscreen; the binnacle in front of the driver
    box(width - 0.22, 0.24, 0.6, 0, e.y - 0.4, e.z + 0.66).rotation.x = 0.1;
    box(0.4, 0.11, 0.24, e.x, e.y - 0.25, e.z + 0.5, trim);
    // the wheel: a rim, a hub and three spokes, tilted towards the driver, turning about its own axis
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.017, 8, 28), trim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12).rotateX(Math.PI / 2), mat);
    this.wheel.add(rim, hub);
    for (const a of [Math.PI / 2 * 3, Math.PI / 6, Math.PI * 5 / 6]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.026, 0.014), mat); s.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0); s.rotation.z = a; this.wheel.add(s); }
    const column = new THREE.Group();
    column.position.set(e.x, e.y - 0.31, e.z + 0.38);
    column.rotation.x = 0.42;   // the top of the wheel leans away from the driver
    column.add(this.wheel);
    this.group.add(column);
    // the A-pillars, from the dash's corners up and back to the roof
    for (const s of [1, -1]) {
      const a = new THREE.Vector3(s * (width / 2 - 0.1), e.y - 0.28, e.z + 0.98), b = new THREE.Vector3(s * (width / 2 - 0.2), e.y + 0.24, e.z + 0.22);
      const p = box(0.075, 0.075, a.distanceTo(b), (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
      // the sill of each door, under its window
      box(0.07, 0.2, 1.5, s * (width / 2 - 0.08), e.y - 0.36, e.z + 0.05);
    }
    // the roof's front edge and the mirror under it
    box(width - 0.3, 0.07, 0.6, 0, e.y + 0.25, e.z + 0.02);
    box(0.2, 0.055, 0.025, 0, e.y + 0.185, e.z + 0.6, trim).rotation.y = 0.18;
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.engine.get<RenderSystem>('render')?.prepare?.(this.group);
    this.builtFor = width;
  }

  /** Draw it this frame on the player's car (`on`), turned with the front wheels. */
  update(v: VehicleApi, on: boolean): void {
    this.group.visible = on;
    if (!on) return;
    const w = v.model.size.width;
    if (Math.abs(w - this.builtFor) > 0.02) this.build(w);
    this.group.position.copy(v.renderPos);
    this.group.quaternion.copy(v.renderQuat);
    // a road car's wheel turns ~14 times its front wheels; held to a turn and a quarter each way
    this.wheel.rotation.z = THREE.MathUtils.clamp(v.car.steerAngle * 14, -7.8, 7.8);
  }
}
