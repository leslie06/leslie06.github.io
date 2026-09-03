/**
 * 固定步长累加器主循环。
 * 物理永远按 fixedDt 走（默认 60Hz），渲染拿到 alpha 做插值。
 * 绝对不要把 deltaTime 直接丢进物理 —— 那样手感会随帧率变。
 */
export interface FixedStepLoopOptions {
  /** 物理步长，秒。默认 1/60 */
  fixedDt?: number;
  /** 单帧最多补偿多少秒，防止切标签页回来"死亡螺旋"。默认 0.25 */
  maxFrameTime?: number;
  /** 走一步物理 */
  update: (fixedDt: number) => void;
  /**
   * 画一帧。
   * @param alpha 0..1，当前渲染时刻在上一步和这一步物理状态之间的位置
   * @param frameDt 真实帧间隔（秒），给相机/视觉阻尼这类非物理的东西用
   */
  render: (alpha: number, frameDt: number) => void;
}

export class FixedStepLoop {
  readonly fixedDt: number;
  private readonly maxFrameTime: number;
  private readonly update: (dt: number) => void;
  private readonly render: (alpha: number, frameDt: number) => void;

  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(options: FixedStepLoopOptions) {
    this.fixedDt = options.fixedDt ?? 1 / 60;
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
    this.update = options.update;
    this.render = options.render;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly tick = (now: number) => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const frameDt = Math.min((now - this.lastTime) / 1000, this.maxFrameTime);
    this.lastTime = now;
    this.accumulator += frameDt;

    while (this.accumulator >= this.fixedDt) {
      this.update(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }

    this.render(this.accumulator / this.fixedDt, frameDt);
  };
}
