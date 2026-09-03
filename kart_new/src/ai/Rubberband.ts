/**
 * 橡皮筋（catch-up）。纯逻辑，不 import three / rapier。
 *
 * 输入是"这辆 AI 和玩家的 totalProgress 差值"，输出一个**速度倍率**：
 * 落后就给一点加成追上来，领先就收着点等一等。倍率乘在这辆 AI 自己的
 * KartConfig.maxSpeed 副本上 —— 绝不去改全局配置，也不去改 stepKart 的逻辑，
 * 所以 AI 的手感依然和玩家完全一致，只是"这辆车的极速略有不同"。
 *
 * 为什么要平滑：目标倍率是进度差的函数，而进度差在超车瞬间会来回穿过 0。
 * 直接用目标值的话，两车并排时倍率会在 1.1 和 0.9 之间高频抖动，
 * 表现出来就是 AI 一顿一顿的。所以这里维护一个状态量，按指数逼近目标。
 */

export interface RubberbandConfig {
  /** 落后多少（totalProgress 单位，1 = 一整圈）时吃满加成 */
  behindRange: number;
  /** 领先多少时吃满减速 */
  aheadRange: number;
  /** 落后到底时的速度倍率上限 */
  maxMultiplier: number;
  /** 领先到底时的速度倍率下限 */
  minMultiplier: number;
  /** 逼近目标倍率的速率（1/s）。越小越黏 */
  smoothing: number;
}

export const DEFAULT_RUBBERBAND_CONFIG: RubberbandConfig = {
  behindRange: 0.09,
  aheadRange: 0.07,
  maxMultiplier: 1.1,
  minMultiplier: 0.88,
  smoothing: 0.8,
};

/** 完全关掉橡皮筋用的配置：倍率恒为 1。 */
export const NO_RUBBERBAND: RubberbandConfig = {
  behindRange: 1,
  aheadRange: 1,
  maxMultiplier: 1,
  minMultiplier: 1,
  smoothing: 1,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 目标倍率。纯函数，好测。
 *
 * @param delta ai.totalProgress - player.totalProgress。负 = AI 落后
 * @returns 落后时在 [1, maxMultiplier]，领先时在 [minMultiplier, 1]；关于 delta 单调不增
 */
export function rubberbandTarget(delta: number, cfg: Readonly<RubberbandConfig>): number {
  if (!Number.isFinite(delta)) return 1;
  if (delta < 0) {
    const k = clamp01(-delta / Math.max(cfg.behindRange, 1e-6));
    return 1 + (cfg.maxMultiplier - 1) * k;
  }
  const k = clamp01(delta / Math.max(cfg.aheadRange, 1e-6));
  return 1 - (1 - cfg.minMultiplier) * k;
}

export class Rubberband {
  config: RubberbandConfig;
  private _multiplier = 1;

  constructor(config: Partial<RubberbandConfig> = {}) {
    this.config = { ...DEFAULT_RUBBERBAND_CONFIG, ...config };
  }

  /**
   * 推进一步。
   * @param delta ai.totalProgress - player.totalProgress
   * @returns 平滑后的当前倍率
   */
  update(delta: number, dt: number): number {
    const target = rubberbandTarget(delta, this.config);
    if (dt > 0) {
      this._multiplier += (target - this._multiplier) * (1 - Math.exp(-this.config.smoothing * dt));
    }
    return this._multiplier;
  }

  /** 当前倍率（已平滑） */
  get multiplier(): number {
    return this._multiplier;
  }

  /** 重开比赛时归位，别把上一局的领先带进新一局 */
  reset(): void {
    this._multiplier = 1;
  }
}
