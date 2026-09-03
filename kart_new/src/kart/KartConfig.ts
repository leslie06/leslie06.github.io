/**
 * 所有手感参数集中在这里。街机手感，不是拟真。
 * 单位：距离 m，速度 m/s，加速度 m/s^2，角度 rad，角速度 rad/s，时间 s。
 * 这个文件和 kartStep 一样，不许 import 任何渲染相关的东西。
 */
export interface KartConfig {
  // ---------- 基础行驶 ----------
  /** 全油门能达到的最高速度 */
  maxSpeed: number;
  /** 倒车最高速度（正数） */
  maxReverseSpeed: number;
  /** 油门加速度，恒定。到达 maxSpeed 的时间 = maxSpeed / engineAccel */
  engineAccel: number;
  /** 倒车时的加速度 */
  reverseAccel: number;
  /** 刹车减速度 */
  brakeDecel: number;
  /** 松开油门后的自然衰减 */
  coastFriction: number;

  // ---------- 转向 ----------
  /** 满打方向、低速时的转向角速度 */
  turnRate: number;
  /**
   * 转向权限完全生效所需的速度。低于它时按速度线性淡入，
   * 保证原地静止打方向不会让车自转。
   */
  steerAuthoritySpeed: number;
  /** 到达 maxSpeed 时转向角速度的倍率（<1 = 高速转得钝） */
  highSpeedSteerFactor: number;
  /** 方向输入的平滑速率（每秒逼近目标的比例系数，越大越跟手） */
  steerSmoothing: number;
  /** 过弯掉速：每 1 rad/s 偏航带来的减速度 */
  corneringDrag: number;

  // ---------- 漂移 ----------
  /** 低于这个速度进不了漂移；漂移中掉到这个速度以下会中断且不给奖励 */
  driftMinSpeed: number;
  /** 起漂需要的最小方向输入（死区），低于它算"没打方向" */
  driftSteerDeadzone: number;
  /** 漂移中车身相对前进方向的额外偏转角（纯朝向，不改变前进方向） */
  driftYaw: number;
  /** 车身偏转角的平滑速率，进出漂移时不会瞬间折断 */
  driftYawSmoothing: number;
  /** 漂移中的转向角速度。必须 > turnRate，否则漂移比普通转向还钝 */
  driftTurnRate: number;
  /**
   * 反打方向时保留多少转向力（0..1）。
   * 1 = 反打无效果，0.35 = 能掰回来一些但仍在转。必须 > 0：反打不允许取消漂移。
   */
  driftCounterSteer: number;
  /** 漂移中的额外掉速 */
  driftFriction: number;

  // ---------- 蓄力 / mini-turbo ----------
  /** 三档蓄力阈值（秒），必须递增 */
  chargeThresholds: [number, number, number];
  /** 三档 boost 期间 maxSpeed 的倍率 */
  boostSpeedMul: [number, number, number];
  /** 三档 boost 的持续时间（秒） */
  boostDuration: [number, number, number];
  /** boost 期间 engineAccel 的倍率，要够大才能快速冲到提高后的上限 */
  boostAccelMul: number;
  /** boost 结束后超速部分的回落减速度。这个值决定"平滑回落"有多平滑 */
  boostFalloffDecel: number;

  // ---------- 地形贴合 / 护栏 ----------
  /** 车 y 坐标贴向接触点的平滑速率。越大越硬，太大过坎会磕 */
  groundStickSmoothing: number;
  /** 地面法线的平滑速率，决定车身姿态跟地面对齐得多快（太大会抖） */
  groundNormalSmoothing: number;
  /** 掉出赛道后的重力加速度 */
  gravity: number;
  /** 掉出赛道多久后重生到最近的样条点（秒） */
  respawnDelay: number;
  /** 蹭护栏时的减速度 */
  wallDecel: number;
}

export const DEFAULT_KART_CONFIG: KartConfig = {
  maxSpeed: 34,
  maxReverseSpeed: 10,
  engineAccel: 15,
  reverseAccel: 9,
  brakeDecel: 34,
  coastFriction: 8,

  turnRate: 2.7,
  steerAuthoritySpeed: 3,
  highSpeedSteerFactor: 0.42,
  steerSmoothing: 12,
  corneringDrag: 1.6,

  driftMinSpeed: 9,
  driftSteerDeadzone: 0.15,
  driftYaw: 0.42,
  driftYawSmoothing: 8,
  driftTurnRate: 3.6,
  driftCounterSteer: 0.35,
  driftFriction: 1.5,

  chargeThresholds: [0.6, 1.4, 2.2],
  boostSpeedMul: [1.12, 1.22, 1.34],
  boostDuration: [0.6, 1.1, 1.7],
  boostAccelMul: 3.5,
  boostFalloffDecel: 6,

  groundStickSmoothing: 16,
  groundNormalSmoothing: 7,
  gravity: 26,
  respawnDelay: 2,
  wallDecel: 22,
};

/** KartConfig 里所有标量参数的键 */
export type KartConfigScalarKey = {
  [K in keyof KartConfig]: KartConfig[K] extends number ? K : never;
}[keyof KartConfig];

/** KartConfig 里所有三元组参数的键 */
export type KartConfigTripleKey = {
  [K in keyof KartConfig]: KartConfig[K] extends [number, number, number] ? K : never;
}[keyof KartConfig];

/** GUI 用的标量参数范围表，[min, max, step]。 */
export const KART_CONFIG_RANGES: Record<KartConfigScalarKey, [number, number, number]> = {
  maxSpeed: [5, 80, 0.5],
  maxReverseSpeed: [2, 30, 0.5],
  engineAccel: [2, 60, 0.5],
  reverseAccel: [2, 40, 0.5],
  brakeDecel: [5, 100, 0.5],
  coastFriction: [0, 40, 0.25],

  turnRate: [0.5, 6, 0.05],
  steerAuthoritySpeed: [0.1, 15, 0.1],
  highSpeedSteerFactor: [0.05, 1, 0.01],
  steerSmoothing: [1, 40, 0.5],
  corneringDrag: [0, 10, 0.05],

  driftMinSpeed: [0, 30, 0.5],
  driftSteerDeadzone: [0, 0.9, 0.01],
  driftYaw: [0, 1.2, 0.01],
  driftYawSmoothing: [1, 30, 0.5],
  driftTurnRate: [0.5, 9, 0.05],
  // 下界故意不给 0：反打永远不能把漂移转向掰到停
  driftCounterSteer: [0.05, 1, 0.01],
  driftFriction: [0, 15, 0.25],

  boostAccelMul: [1, 10, 0.1],
  boostFalloffDecel: [0.5, 40, 0.5],

  groundStickSmoothing: [1, 40, 0.5],
  groundNormalSmoothing: [1, 30, 0.5],
  gravity: [1, 60, 0.5],
  respawnDelay: [0.2, 8, 0.1],
  wallDecel: [0, 60, 0.5],
};

/** GUI 用的三档参数范围表。 */
export const KART_CONFIG_TRIPLE_RANGES: Record<
  KartConfigTripleKey,
  { range: [number, number, number]; label: string }
> = {
  chargeThresholds: { range: [0.1, 5, 0.05], label: '蓄力阈值' },
  boostSpeedMul: { range: [1, 2.5, 0.01], label: '速度倍率' },
  boostDuration: { range: [0.1, 5, 0.05], label: '持续时间' },
};

export const CHARGE_LEVEL_NAMES = ['一档', '二档', '三档'] as const;

/**
 * 深拷贝一份 config。
 * 必须用这个而不是 `{ ...DEFAULT_KART_CONFIG }` —— 展开是浅拷贝，
 * 三个三档数组会和模块级默认值共享同一个对象，GUI 上一调滑条就把"默认值"本身改了，
 * 之后"恢复默认"等于没恢复。
 */
export function cloneKartConfig(cfg: Readonly<KartConfig> = DEFAULT_KART_CONFIG): KartConfig {
  return {
    ...cfg,
    chargeThresholds: [...cfg.chargeThresholds],
    boostSpeedMul: [...cfg.boostSpeedMul],
    boostDuration: [...cfg.boostDuration],
  };
}
