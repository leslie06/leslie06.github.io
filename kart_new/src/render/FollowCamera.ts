import * as THREE from 'three';
import type { KartState } from '../kart/kartStep';
import type { KartConfig } from '../kart/KartConfig';

/**
 * 弹簧阻尼跟随相机。速度感基本全靠这个：
 * 速度越快 -> 拉得越远、压得越低、FOV 越大。
 */
export interface FollowCameraConfig {
  /** 静止时相机在车后多远 */
  baseDistance: number;
  /** 满速时额外拉远多少 */
  distanceGain: number;
  /** 静止时相机高度 */
  baseHeight: number;
  /** 满速时高度变化（负数 = 压低，更贴地更快） */
  heightGain: number;
  /** 看向车前方多远 */
  lookAhead: number;
  /** 视线目标的离地高度 */
  lookHeight: number;
  /** 弹簧刚度，越大越紧跟 */
  stiffness: number;
  /** 阻尼比，1 = 临界阻尼（不过冲） */
  damping: number;
  /** 静止时 FOV */
  baseFov: number;
  /** 满速时 FOV 增加量 */
  fovGain: number;
  /** FOV 变化的平滑速率 */
  fovSmoothing: number;
  /** boost 启动时 FOV 短促推出去多少度 */
  punchFov: number;
  /** 推镜回落的衰减速率，越大回得越快 */
  punchDecay: number;
}

export const DEFAULT_FOLLOW_CAMERA_CONFIG: FollowCameraConfig = {
  baseDistance: 7.5,
  distanceGain: 3.2,
  baseHeight: 3.6,
  heightGain: -0.9,
  lookAhead: 7,
  lookHeight: 1.4,
  stiffness: 90,
  damping: 1,
  baseFov: 62,
  fovGain: 22,
  fovSmoothing: 4,
  punchFov: 10,
  punchDecay: 3.2,
};

export const FOLLOW_CAMERA_RANGES: Record<keyof FollowCameraConfig, [number, number, number]> = {
  baseDistance: [2, 25, 0.1],
  distanceGain: [0, 20, 0.1],
  baseHeight: [0.5, 15, 0.1],
  heightGain: [-5, 8, 0.1],
  lookAhead: [0, 30, 0.1],
  lookHeight: [0, 6, 0.1],
  stiffness: [5, 400, 1],
  damping: [0.3, 2, 0.01],
  baseFov: [30, 100, 1],
  fovGain: [0, 60, 1],
  fovSmoothing: [0.5, 20, 0.1],
  punchFov: [0, 40, 0.5],
  punchDecay: [0.5, 12, 0.1],
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 弹簧最大子步长：帧掉太狠时要拆分积分，否则弹簧会发散。 */
const MAX_SPRING_STEP = 1 / 90;

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly config: FollowCameraConfig = { ...DEFAULT_FOLLOW_CAMERA_CONFIG };

  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private fov = DEFAULT_FOLLOW_CAMERA_CONFIG.baseFov;
  /** 车脚下的地面高度，相机不许钻到它下面去 */
  private floorY = 0;
  /** 叠加在 fov 上的瞬时推镜量，自己衰减回 0 */
  private fovPunch = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.config.baseFov, aspect, 0.1, 1200);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 直接把相机放到目标位置，不做插值（初始化 / 重置用）。 */
  snapTo(state: Readonly<KartState>, cfg: Readonly<KartConfig>): void {
    this.computeDesired(state, cfg);
    this.position.copy(this.desired);
    this.velocity.set(0, 0, 0);
    this.smoothedLook.copy(this.lookTarget);
    this.fov = this.config.baseFov;
    this.fovPunch = 0;
    this.applyToCamera();
  }

  update(state: Readonly<KartState>, cfg: Readonly<KartConfig>, frameDt: number): void {
    this.computeDesired(state, cfg);

    // 弹簧阻尼，拆成小步积分保证稳定
    const c = 2 * Math.sqrt(this.config.stiffness) * this.config.damping;
    let remaining = Math.min(frameDt, 0.25);
    while (remaining > 0) {
      const h = Math.min(remaining, MAX_SPRING_STEP);
      this.tmp.copy(this.desired).sub(this.position).multiplyScalar(this.config.stiffness);
      this.tmp.addScaledVector(this.velocity, -c);
      this.velocity.addScaledVector(this.tmp, h);
      this.position.addScaledVector(this.velocity, h);
      remaining -= h;
    }

    const lookT = 1 - Math.exp(-10 * frameDt);
    this.smoothedLook.lerp(this.lookTarget, lookT);

    const speedRatio = clamp(Math.abs(state.speed) / Math.max(cfg.maxSpeed, 0.001), 0, 1);
    const fovTarget = this.config.baseFov + this.config.fovGain * speedRatio;
    this.fov = lerp(this.fov, fovTarget, 1 - Math.exp(-this.config.fovSmoothing * frameDt));
    // 推镜独立衰减，不走上面那个平滑，否则"短促"就被抹平了
    this.fovPunch *= Math.exp(-this.config.punchDecay * frameDt);
    if (this.fovPunch < 0.01) this.fovPunch = 0;

    this.applyToCamera();
  }

  private computeDesired(state: Readonly<KartState>, cfg: Readonly<KartConfig>): void {
    const speedRatio = clamp(Math.abs(state.speed) / Math.max(cfg.maxSpeed, 0.001), 0, 1);
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);

    const distance = this.config.baseDistance + this.config.distanceGain * speedRatio;
    // 高度是**相对车身**的：赛道有起伏，写死绝对高度的话上了坡相机就埋进路面里了
    const height = state.y + Math.max(0.5, this.config.baseHeight + this.config.heightGain * speedRatio);
    this.floorY = state.y;

    // 速度前馈：弹簧追一个匀速移动的目标会有固定稳态滞后（临界阻尼下约 2v/ωn），
    // 不补偿的话 baseDistance / distanceGain 就失去意义 —— 满速时实测能被拖到配置值的 1.6 倍远。
    // 这里把滞后量提前加到目标点上，配置多少就是多少；转弯时的拖尾还是留着，那个是好看的。
    const omega = Math.sqrt(Math.max(this.config.stiffness, 1e-3));
    const lead = (2 * this.config.damping) / omega;
    const leadX = fx * state.speed * lead;
    const leadZ = fz * state.speed * lead;

    this.desired.set(state.x - fx * distance + leadX, height, state.z - fz * distance + leadZ);
    this.lookTarget.set(
      state.x + fx * this.config.lookAhead,
      state.y + this.config.lookHeight,
      state.z + fz * this.config.lookAhead,
    );
  }

  /** boost 起步时叫一下，FOV 短促推出去再自己回落。amount 默认用 punchFov。 */
  punch(amount = this.config.punchFov): void {
    // 取 max 而不是累加：连续吃 boost 时不会把 FOV 叠到失真
    this.fovPunch = Math.max(this.fovPunch, amount);
  }

  /** 当前实际 FOV（含推镜），给测试用 */
  get currentFov(): number {
    return this.fov + this.fovPunch;
  }

  private applyToCamera(): void {
    // 别让相机钻到地面底下
    this.camera.position.set(
      this.position.x,
      Math.max(this.position.y, this.floorY + 0.4),
      this.position.z,
    );
    this.camera.lookAt(this.smoothedLook);
    const fov = this.fov + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
