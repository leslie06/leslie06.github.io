/**
 * 帧率自适应的判断逻辑。
 *
 * 纯的：喂帧间隔进来，它只回答"现在该不该降一档"，降档这个动作由调用方去做。
 * 这样这套判断能单测，不用真的跑起来卡给你看。
 *
 * 三个防误判的设计，缺一个都会乱降档：
 *   1. warmup：开头几秒着色器还在编、资源还在解码，必卡，这段不算数；
 *   2. 滑动窗口取平均：单帧毛刺（GC、切标签页回来）不该触发降档；
 *   3. sustain：窗口平均连续差了这么久才降，降完还有 cooldown ——
 *      降档本身会引起一波卡顿（重建 composer、换阴影贴图），不冷静一下会连降到底。
 */
export interface FrameMonitorConfig {
  /** 滑动窗口长度（帧）。需求就是"最近 60 帧" */
  sampleCount: number;
  /** 目标帧率。窗口平均低于它就开始记账 */
  targetFps: number;
  /**
   * 帧时容差。判据是 平均帧时 > (1/targetFps) * tolerance。
   * 留这 5% 是因为"刚好压在 30fps 上"的机器是达标的，不该被降档 ——
   * 而且浮点累加本身就有误差，卡在等号上判断会随机翻车。
   */
  tolerance: number;
  /** 启动后多少秒内不判断 */
  warmupSeconds: number;
  /** 连续不达标多久才建议降档 */
  sustainSeconds: number;
  /** 降档后多少秒内不再判断 */
  cooldownSeconds: number;
  /** 单帧超过这个秒数就当成毛刺丢掉（切标签页回来会有个几秒的巨帧） */
  spikeCutoffSeconds: number;
}

export const DEFAULT_FRAME_MONITOR_CONFIG: Readonly<FrameMonitorConfig> = Object.freeze({
  sampleCount: 60,
  targetFps: 30,
  tolerance: 1.05,
  warmupSeconds: 3,
  sustainSeconds: 2.5,
  cooldownSeconds: 8,
  spikeCutoffSeconds: 0.5,
});

export class FrameMonitor {
  private readonly cfg: FrameMonitorConfig;
  private readonly samples: Float64Array;
  private cursor = 0;
  private filled = 0;
  private sum = 0;

  private warmup: number;
  private cooldown = 0;
  private badTime = 0;

  constructor(config: Partial<FrameMonitorConfig> = {}) {
    this.cfg = { ...DEFAULT_FRAME_MONITOR_CONFIG, ...config };
    this.samples = new Float64Array(this.cfg.sampleCount);
    this.warmup = this.cfg.warmupSeconds;
  }

  /** 窗口还没攒满时返回 0 —— 别拿三帧的平均去下结论 */
  get averageFps(): number {
    if (this.filled < this.cfg.sampleCount || this.sum <= 0) return 0;
    return this.filled / this.sum;
  }

  /** 距离触发降档还差多少秒。给调试面板看 */
  get pendingSeconds(): number {
    return this.badTime;
  }

  /**
   * 喂一帧。
   * @param frameDt 真实帧间隔（秒）
   * @returns true = 建议降一档。返回 true 之后自动进入冷静期，不会连着喊
   */
  push(frameDt: number): boolean {
    if (!(frameDt > 0)) return false;
    // 巨帧不进窗口：它是切标签页/断点停住造成的，不代表机器画不动
    if (frameDt > this.cfg.spikeCutoffSeconds) return false;

    this.sum += frameDt - this.samples[this.cursor]!;
    this.samples[this.cursor] = frameDt;
    this.cursor = (this.cursor + 1) % this.cfg.sampleCount;
    if (this.filled < this.cfg.sampleCount) this.filled++;

    if (this.warmup > 0) {
      this.warmup -= frameDt;
      return false;
    }
    if (this.cooldown > 0) {
      this.cooldown -= frameDt;
      return false;
    }
    if (this.filled < this.cfg.sampleCount) return false;

    const budget = (1 / this.cfg.targetFps) * this.cfg.tolerance;
    const average = this.sum / this.filled;
    if (average <= budget) {
      this.badTime = 0;
      return false;
    }

    this.badTime += frameDt;
    if (this.badTime < this.cfg.sustainSeconds) return false;

    this.badTime = 0;
    this.cooldown = this.cfg.cooldownSeconds;
    return true;
  }

  /** 降档/换档之后调一下：窗口里全是旧档位的帧，留着会立刻再触发一次 */
  reset(warmupSeconds = this.cfg.warmupSeconds): void {
    this.samples.fill(0);
    this.cursor = 0;
    this.filled = 0;
    this.sum = 0;
    this.badTime = 0;
    this.cooldown = 0;
    this.warmup = warmupSeconds;
  }
}
