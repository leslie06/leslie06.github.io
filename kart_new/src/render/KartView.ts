import * as THREE from 'three';
import type { KartState } from '../kart/kartStep';
import type { KartConfig } from '../kart/KartConfig';

/** 纯视觉参数：车身侧倾、后仰、前轮转角。这些东西不进 kartStep。 */
export interface KartViewConfig {
  /** 满舵满速时车身侧倾角（rad） */
  maxRoll: number;
  /** 满加速/满刹车时车身俯仰角（rad） */
  maxPitch: number;
  /** 侧倾/俯仰的平滑速率 */
  leanSmoothing: number;
  /** 前轮视觉转角（rad） */
  steerVisualAngle: number;
  /** 后轮半径，用来算轮子转速 */
  wheelRadius: number;
  /** 漂移时侧倾角的额外倍率（在 maxRoll 之上再乘） */
  driftRollMul: number;
  /** 漂移时车身朝弯外侧再补一点倾角（rad），让"甩尾"更明显 */
  driftRollBias: number;
}

export const DEFAULT_KART_VIEW_CONFIG: KartViewConfig = {
  maxRoll: 0.16,
  maxPitch: 0.07,
  leanSmoothing: 9,
  steerVisualAngle: 0.5,
  wheelRadius: 0.36,
  driftRollMul: 2.1,
  driftRollBias: 0.1,
};

export const KART_VIEW_RANGES: Record<keyof KartViewConfig, [number, number, number]> = {
  maxRoll: [0, 0.6, 0.005],
  maxPitch: [0, 0.4, 0.005],
  leanSmoothing: [1, 30, 0.5],
  steerVisualAngle: [0, 1.2, 0.01],
  wheelRadius: [0.1, 1, 0.01],
  driftRollMul: [1, 5, 0.05],
  driftRollBias: [0, 0.5, 0.01],
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();

/**
 * 占位卡丁车：几个 Box 拼出来的，配色明快。
 * 之后换成 glTF 时只要保证"车头朝 +Z、轮子贴地 y=0"，外面的代码就不用动。
 */
export class KartView {
  readonly root = new THREE.Group();
  readonly config: KartViewConfig = { ...DEFAULT_KART_VIEW_CONFIG };

  /** 车身（会侧倾/俯仰），轮子挂在 root 上保持贴地 */
  private readonly chassis = new THREE.Group();
  private readonly frontPivots: THREE.Group[] = [];
  private readonly rearPivots: THREE.Group[] = [];
  private readonly allWheels: THREE.Mesh[] = [];

  private roll = 0;
  private pitch = 0;
  private lastSpeed = 0;
  private smoothedAccel = 0;

  /** 当前车身侧倾角（rad），只读，给测试和调试看 */
  get bodyRoll(): number {
    return this.roll;
  }

  /** 当前前轮视觉转角（rad），只读 */
  get frontWheelAngle(): number {
    return this.frontPivots[0]?.rotation.y ?? 0;
  }

  constructor() {
    this.root.add(this.chassis);
    this.buildChassis();
    this.buildWheels();
  }

  private buildChassis(): void {
    const mat = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...opts });

    const red = mat('#ff3b30');
    const white = mat('#f7f7fa');
    const dark = mat('#22262e', { roughness: 0.7 });
    const yellow = mat('#ffcc00');
    const blue = mat('#2f6fed');
    const skin = mat('#f0b48b', { roughness: 0.8, metalness: 0 });

    const add = (
      geo: THREE.BoxGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chassis.add(mesh);
      return mesh;
    };

    // 底盘
    add(new THREE.BoxGeometry(1.24, 0.22, 2.1), red, 0, 0.34, 0);
    // 两侧防撞条
    add(new THREE.BoxGeometry(0.22, 0.3, 1.4), white, -0.76, 0.36, 0.05);
    add(new THREE.BoxGeometry(0.22, 0.3, 1.4), white, 0.76, 0.36, 0.05);
    // 车头（前端收窄）
    add(new THREE.BoxGeometry(0.95, 0.2, 0.7), yellow, 0, 0.36, 1.32);
    // 座舱地板 + 靠背
    add(new THREE.BoxGeometry(0.9, 0.12, 0.9), dark, 0, 0.45, -0.05);
    add(new THREE.BoxGeometry(0.86, 0.62, 0.16), blue, 0, 0.72, -0.58);
    // 引擎块
    add(new THREE.BoxGeometry(0.7, 0.44, 0.5), dark, 0, 0.6, -1.0);
    // 尾翼
    add(new THREE.BoxGeometry(0.12, 0.34, 0.1), dark, -0.5, 0.95, -1.16);
    add(new THREE.BoxGeometry(0.12, 0.34, 0.1), dark, 0.5, 0.95, -1.16);
    add(new THREE.BoxGeometry(1.3, 0.08, 0.34), yellow, 0, 1.14, -1.16);
    // 方向盘柱
    add(new THREE.BoxGeometry(0.42, 0.07, 0.1), dark, 0, 0.76, 0.5);
    // 驾驶员：身子 + 头 + 头盔顶
    add(new THREE.BoxGeometry(0.5, 0.5, 0.34), blue, 0, 0.78, -0.28);
    add(new THREE.BoxGeometry(0.34, 0.3, 0.32), skin, 0, 1.16, -0.28);
    add(new THREE.BoxGeometry(0.4, 0.22, 0.4), red, 0, 1.3, -0.3);
  }

  private buildWheels(): void {
    const tire = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.85 });
    const hub = new THREE.MeshStandardMaterial({ color: '#e8e8ee', roughness: 0.4, metalness: 0.3 });

    const make = (radius: number, width: number) => {
      const geo = new THREE.CylinderGeometry(radius, radius, width, 20);
      geo.rotateZ(Math.PI / 2); // 圆柱默认沿 y，转成沿 x 当轮轴
      const wheel = new THREE.Mesh(geo, tire);
      wheel.castShadow = true;
      // 轮毂条，转起来看得出来在滚
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.02, radius * 0.5, radius * 0.5),
        hub,
      );
      wheel.add(cap);
      return wheel;
    };

    const layout: Array<[x: number, z: number, r: number, w: number, front: boolean]> = [
      [-0.82, 0.95, 0.32, 0.26, true],
      [0.82, 0.95, 0.32, 0.26, true],
      [-0.9, -0.92, 0.4, 0.36, false],
      [0.9, -0.92, 0.4, 0.36, false],
    ];

    for (const [x, z, r, w, front] of layout) {
      // 前轮要能转向，套一层 pivot
      const pivot = new THREE.Group();
      pivot.position.set(x, r, z);
      const wheel = make(r, w);
      pivot.add(wheel);
      this.root.add(pivot);
      this.allWheels.push(wheel);
      (front ? this.frontPivots : this.rearPivots).push(pivot);
    }
  }

  /**
   * @param state 已经做过渲染插值的状态
   * @param frameDt 真实帧间隔（视觉阻尼用真实时间，不用物理步长）
   */
  update(state: Readonly<KartState>, cfg: Readonly<KartConfig>, frameDt: number): void {
    this.root.position.set(state.x, state.y, state.z);
    // 姿态 = 先绕自身 y 转到 heading，再把车顶（局部 +y）掰到地面法线上。
    // 顺序不能反：反了的话上坡时车会绕世界 y 轴歪掉，而不是贴着坡面。
    // 车身画在 heading + driftYawOffset 上：漂移时看着是斜着走的，
    // 但位置推进在 kartStep 里只用 heading，前进方向没被改变
    _normal.set(state.groundNormalX, state.groundNormalY, state.groundNormalZ);
    _tilt.setFromUnitVectors(UP, _normal);
    _yaw.setFromAxisAngle(UP, state.heading + state.driftYawOffset);
    this.root.quaternion.copy(_tilt).multiply(_yaw);

    const speedRatio = clamp(Math.abs(state.speed) / Math.max(cfg.maxSpeed, 0.001), 0, 1);

    // 加速度估计（用来做后仰/点头），重度平滑，不然抖
    if (frameDt > 0) {
      const raw = (state.speed - this.lastSpeed) / frameDt;
      this.smoothedAccel = lerp(this.smoothedAccel, raw, 1 - Math.exp(-8 * frameDt));
    }
    this.lastSpeed = state.speed;

    const t = 1 - Math.exp(-this.config.leanSmoothing * frameDt);
    // 转向时车身往弯内侧倒（速度越快倒得越狠）。
    // 符号：模型面朝 +z，所以车自身的右侧在局部 -x 上（forward × up = -x）。
    // 右转要让右侧下沉 = 局部 +x 抬起 = rotation.z 取正，所以这里跟 steer 同号。
    const drifting = state.driftPhase === 'drifting';
    let rollTarget = this.config.maxRoll * state.steer * (0.35 + 0.65 * speedRatio);
    if (drifting && state.driftDir !== 0) {
      // 漂移时侧倾明显加大，并朝漂移方向补一个固定偏置，
      // 这样即使玩家反打方向车身也还是明显侧着的
      rollTarget = rollTarget * this.config.driftRollMul
        + this.config.driftRollBias * state.driftDir * (0.4 + 0.6 * speedRatio);
    }
    // 加速后仰、刹车点头
    const accelRatio = clamp(this.smoothedAccel / Math.max(cfg.engineAccel, 0.001), -1.5, 1.5);
    const pitchTarget = -this.config.maxPitch * accelRatio;

    this.roll = lerp(this.roll, rollTarget, t);
    this.pitch = lerp(this.pitch, pitchTarget, t);
    this.chassis.rotation.z = this.roll;
    this.chassis.rotation.x = this.pitch;

    // 前轮跟着方向盘转。负号同 kartStep：rotation.y 正向是左转
    const steerAngle = -state.steer * this.config.steerVisualAngle;
    for (const pivot of this.frontPivots) pivot.rotation.y = steerAngle;

    // 轮子滚动
    const spin = (state.speed / Math.max(this.config.wheelRadius, 0.05)) * frameDt;
    for (const wheel of this.allWheels) wheel.rotation.x += spin;
  }

  /**
   * 后轮的世界坐标，给火花特效当发射点。
   * 会就地写进传入的数组，避免每帧新建 Vector3。
   */
  getRearWheelWorldPositions(out: THREE.Vector3[]): THREE.Vector3[] {
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < this.rearPivots.length; i++) {
      const pivot = this.rearPivots[i]!;
      const target = out[i] ?? (out[i] = new THREE.Vector3());
      target.setScalar(0);
      pivot.localToWorld(target);
    }
    out.length = this.rearPivots.length;
    return out;
  }
}
