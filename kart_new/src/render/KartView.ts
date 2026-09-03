import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KartState } from '../kart/kartStep';
import type { KartConfig } from '../kart/KartConfig';
import { applyTint, buildKartRig, type KartRig, type TintTag } from './kartRig';

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

/**
 * 车的配色。玩家和每辆 AI 各一套，纯视觉，不进任何逻辑。
 * 只换这四个颜色就够区分了 —— 轮胎、座舱地板这些深色件所有车共用，
 * 换掉反而会让车看起来不是同一个系列。
 *
 * 换到 glTF 模型之后，这四个键就是 kartRig 认的四个材质名标签
 * （材质名里带 body / accent / trim / suit）。
 */
export type KartPalette = Record<TintTag, string>;

export const DEFAULT_KART_PALETTE: KartPalette = {
  body: '#ff3b30',
  accent: '#ffcc00',
  trim: '#f7f7fa',
  suit: '#2f6fed',
};

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();

/** 要哪几个轮子的位置：漂移火花只要后轮，越野扬尘四个都要 */
export type WheelFilter = 'rear' | 'front' | 'all';

/**
 * 一辆车的可视部分。
 *
 * 两种形态，外面完全看不出区别：
 *   - **占位车**：几个 Box 拼的，颜色烘进顶点色（构造时的默认形态）；
 *   - **glTF 模型**：setModel() 之后换上去，轮子按名字拆成独立子对象。
 *
 * 换形态是运行时的：模型是慢慢下的，先拿占位车开着，下完了再无缝换上，
 * 不用为了等一个模型把加载界面多顶几秒。
 *
 * 两种形态共同的约定：**车头朝 +Z、轮子贴地 y = 0**，外面的代码只认这个。
 */
export class KartView {
  readonly root = new THREE.Group();
  readonly config: KartViewConfig = { ...DEFAULT_KART_VIEW_CONFIG };
  readonly palette: KartPalette;

  /** 车身（会侧倾/俯仰），轮子挂在 root 上保持贴地 */
  private chassis!: THREE.Group;
  private frontPivots: THREE.Group[] = [];
  private rearPivots: THREE.Group[] = [];
  private allWheels: THREE.Object3D[] = [];
  /** 占位车自己生成的几何体，换模型时要释放；模型的几何体是共享的，不能释放 */
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private usingModel = false;

  private roll = 0;
  private pitch = 0;
  private wheelSpin = 0;
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

  /** 现在挂的是 glTF 模型还是占位车 */
  get hasModel(): boolean {
    return this.usingModel;
  }

  constructor(palette: Partial<KartPalette> = {}) {
    this.palette = { ...DEFAULT_KART_PALETTE, ...palette };
    this.buildPlaceholder();
  }

  /**
   * 换上 glTF 模型。传 null 退回占位车。
   *
   * @param model **克隆**出来的场景（ModelLibrary.instantiate），不能是模板本身 ——
   *              建 rig 会就地重挂轮子，改到模板上就把别的车也毁了。
   */
  setModel(model: THREE.Object3D | null): void {
    this.teardown();
    if (!model) {
      this.buildPlaceholder();
      return;
    }

    applyTint(model, this.palette);
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const rig: KartRig = buildKartRig(this.root, model);
    this.chassis = rig.chassis;
    for (const wheel of rig.wheels) {
      (wheel.front ? this.frontPivots : this.rearPivots).push(wheel.pivot);
      this.allWheels.push(wheel.pivot.children[0] ?? wheel.pivot);
    }
    // 滚动速度得用模型自己的轮子半径，不然大轮子的车看着像在打滑。
    // 量出来的值直接写进 config，lil-gui 上还能接着调
    if (rig.wheelRadius && rig.wheelRadius > 0.05) this.config.wheelRadius = rig.wheelRadius;
    this.usingModel = true;
  }

  /** 拆掉当前形态。模型的几何体/材质是共享的，只释放占位车自己造的那些 */
  private teardown(): void {
    this.root.clear();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.ownedGeometries = [];
    this.frontPivots = [];
    this.rearPivots = [];
    this.allWheels = [];
    this.usingModel = false;
    this.roll = 0;
    this.pitch = 0;
  }

  private buildPlaceholder(): void {
    this.chassis = new THREE.Group();
    this.root.add(this.chassis);
    this.buildChassis();
    this.buildWheels();
  }

  /**
   * 占位车身。
   *
   * 十几个 Box 不是十几个 Mesh：全部**按材质合并**成两个几何体，颜色烘进顶点色。
   * 一辆车从 23 个 drawcall 降到 6 个（车身 2 + 轮子 4）——
   * 满编 8 辆车就是 184 vs 48，low 档 150 个 drawcall 的预算全花在车上都不够。
   * 代价是同一堆里的粗糙度只能取一个值，所以按"亮面/哑面"分了两堆，
   * 保住车壳和轮胎、皮肤之间的质感差别。
   */
  private buildChassis(): void {
    const P = this.palette;
    // [几何体, 颜色]。位置在这里就烘进几何体，之后不再有 mesh.position 这回事
    const glossy: ColoredPart[] = [
      // 底盘
      [box(1.24, 0.22, 2.1, 0, 0.34, 0), P.body],
      // 两侧防撞条
      [box(0.22, 0.3, 1.4, -0.76, 0.36, 0.05), P.trim],
      [box(0.22, 0.3, 1.4, 0.76, 0.36, 0.05), P.trim],
      // 车头（前端收窄）
      [box(0.95, 0.2, 0.7, 0, 0.36, 1.32), P.accent],
      // 靠背
      [box(0.86, 0.62, 0.16, 0, 0.72, -0.58), P.suit],
      // 尾翼板
      [box(1.3, 0.08, 0.34, 0, 1.14, -1.16), P.accent],
      // 驾驶员身子 + 头盔顶
      [box(0.5, 0.5, 0.34, 0, 0.78, -0.28), P.suit],
      [box(0.4, 0.22, 0.4, 0, 1.3, -0.3), P.body],
    ];
    const matte: ColoredPart[] = [
      // 座舱地板
      [box(0.9, 0.12, 0.9, 0, 0.45, -0.05), DARK],
      // 引擎块
      [box(0.7, 0.44, 0.5, 0, 0.6, -1.0), DARK],
      // 尾翼立柱
      [box(0.12, 0.34, 0.1, -0.5, 0.95, -1.16), DARK],
      [box(0.12, 0.34, 0.1, 0.5, 0.95, -1.16), DARK],
      // 方向盘柱
      [box(0.42, 0.07, 0.1, 0, 0.76, 0.5), DARK],
      // 驾驶员的头
      [box(0.34, 0.3, 0.32, 0, 1.16, -0.28), SKIN],
    ];

    for (const [parts, material] of [
      [glossy, sharedMaterials().glossy],
      [matte, sharedMaterials().matte],
    ] as const) {
      const geometry = mergeColored(parts);
      this.ownedGeometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chassis.add(mesh);
    }
  }

  private buildWheels(): void {
    const material = sharedMaterials().wheel;

    const layout: Array<[x: number, z: number, r: number, w: number, front: boolean]> = [
      [-0.82, 0.95, 0.32, 0.26, true],
      [0.82, 0.95, 0.32, 0.26, true],
      [-0.9, -0.92, 0.4, 0.36, false],
      [0.9, -0.92, 0.4, 0.36, false],
    ];

    for (const [x, z, r, w, front] of layout) {
      const tire = new THREE.CylinderGeometry(r, r, w, WHEEL_SEGMENTS);
      tire.rotateZ(Math.PI / 2); // 圆柱默认沿 y，转成沿 x 当轮轴
      // 轮胎和轮毂也合并：一个轮子一个 drawcall。
      // 轮毂条要看得出转动，所以颜色差别留着，只是共用一份粗糙度
      const geometry = mergeColored([
        [tire, TIRE],
        [box(w + 0.02, r * 0.5, r * 0.5, 0, 0, 0), HUB],
      ]);
      this.ownedGeometries.push(geometry);
      const wheel = new THREE.Mesh(geometry, material);
      wheel.castShadow = true;

      // 前轮要能转向，套一层 pivot
      const pivot = new THREE.Group();
      pivot.position.set(x, r, z);
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

    // 轮子滚动。累计到一个共享的角度上再写，省得每个轮子各存一份
    this.wheelSpin += (state.speed / Math.max(this.config.wheelRadius, 0.05)) * frameDt;
    for (const wheel of this.allWheels) wheel.rotation.x = this.wheelSpin;
  }

  /**
   * 轮子的世界坐标，给火花和扬尘当发射点。
   * 会就地写进传入的数组，避免每帧新建 Vector3。
   */
  getWheelWorldPositions(out: THREE.Vector3[], which: WheelFilter = 'rear'): THREE.Vector3[] {
    const pivots =
      which === 'rear'
        ? this.rearPivots
        : which === 'front'
          ? this.frontPivots
          : [...this.rearPivots, ...this.frontPivots];
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < pivots.length; i++) {
      const target = out[i] ?? (out[i] = new THREE.Vector3());
      pivots[i]!.getWorldPosition(target);
    }
    out.length = pivots.length;
    return out;
  }

  /** 后轮的世界坐标。getWheelWorldPositions('rear') 的老名字，主循环还在用 */
  getRearWheelWorldPositions(out: THREE.Vector3[]): THREE.Vector3[] {
    return this.getWheelWorldPositions(out, 'rear');
  }

  /** 车尾中点的世界坐标，boost 拖尾从这里长出来 */
  getTailWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return out.set(0, 0.5, -1.3).applyMatrix4(this.root.matrixWorld);
  }

  dispose(): void {
    this.teardown();
  }
}

/** 车轮圆柱的分段数。20 段在 1080p 下已经看不出棱，再多是白给 */
const WHEEL_SEGMENTS = 20;

const DARK = '#22262e';
const SKIN = '#f0b48b';
const TIRE = '#1b1d22';
const HUB = '#e8e8ee';

/**
 * 占位车的三份材质，**所有车共用**。
 *
 * 颜色是烘在顶点色里的，所以不同配色的车用的是同一份材质 —— 那就没有理由
 * 每辆车各 new 一套：材质各不相同的话每套都要单独编译一次着色器程序，
 * 八辆车就是八次没必要的编译（开局第一次出现在画面里时会顿一下）。
 * 懒建是因为模块加载时不一定有 WebGL 上下文（测试里就没有）。
 */
let materials: { glossy: THREE.Material; matte: THREE.Material; wheel: THREE.Material } | null = null;
function sharedMaterials() {
  materials ??= {
    glossy: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 }),
  };
  return materials;
}

type ColoredPart = readonly [geometry: THREE.BufferGeometry, color: string];

/** 一个摆好位置的方块 */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

const _tint = new THREE.Color();

/**
 * 把每块几何体刷上顶点色再合并成一个。
 *
 * 颜色走顶点色而不是多材质：three 是按 (几何体, 材质) 对发 drawcall 的，
 * 多材质合并出来还是几个 drawcall，等于没合。
 * Color 的构造已经把 sRGB 转成线性了（ColorManagement 默认开），
 * 顶点色要的正是线性值，所以这里直接取 r/g/b。
 */
function mergeColored(parts: readonly ColoredPart[]): THREE.BufferGeometry {
  for (const [geo, color] of parts) {
    _tint.set(color);
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = _tint.r;
      colors[i * 3 + 1] = _tint.g;
      colors[i * 3 + 2] = _tint.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const merged = mergeGeometries(parts.map(([geo]) => geo));
  for (const [geo] of parts) geo.dispose();
  if (!merged) throw new Error('KartView: 几何体合并失败（属性对不上？）');
  return merged;
}
