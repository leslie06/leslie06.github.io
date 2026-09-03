/**
 * 单车的圈速 / checkpoint 记录。纯逻辑。
 *
 * 和 kartStep.ts 一样：不许 import three / rapier / DOM。
 * 它只吃两个数 —— 这一帧的赛道进度 t（0..1，来自 TrackSpline.getProgress）和 dt。
 * 赛道在哪、车在哪、谁在开，它一概不知道。
 *
 * ## 为什么不直接积分 t 的增量
 *
 * "把每帧的 Δt 累加起来，过 1 就是一圈"这种写法挡不住抄近道：从赛道内侧横穿过去，
 * getProgress 找的是**最近的样条点**，t 会直接从 0.3 跳到 0.7，累加器照收不误。
 * 所以这里按 checkpoint 走：把样条均分成 checkpointCount 段（sector），
 * 只认**相邻**的 sector 变化，非相邻的跳变一律判为传送/抄近道，整圈作废。
 *
 * checkpoint i 定义为 sector i 的入口（t = i / checkpointCount），
 * 其中 checkpoint 0 就是起点/终点线。
 */

/** update() 在完成一圈的那一帧返回的东西，其余时候返回 null。 */
export interface LapCompleted {
  /** 完成的是第几圈，从 1 开始 */
  lap: number;
  /** 这一圈用时（秒） */
  time: number;
  /** 是否刷新了本对象的最佳圈速 */
  best: boolean;
}

export interface RaceProgressOptions {
  /** 沿样条均分多少个 checkpoint（含起点线）。至少 2 */
  checkpointCount?: number;
  /** 初始进度 t */
  startT?: number;
}

export const DEFAULT_CHECKPOINT_COUNT = 8;

export class RaceProgress {
  /** checkpoint 总数，含 0 号（起点线） */
  readonly checkpointCount: number;

  /** 已完成的圈数 */
  private _lap = 0;
  /** 上一次喂进来的 t，已折回 [0,1) */
  private _t = 0;
  /** 当前所在的 sector = floor(t * checkpointCount) */
  private _sector = 0;
  /**
   * visited[i] = 本圈已按顺序通过 checkpoint i。
   * 0 号（起点线）不用这个数组表示 —— 过线是"结算"动作，见 crossForward。
   */
  private readonly _visited: boolean[];
  /**
   * 上一次正向过起点线**有没有真的记上一圈**。
   * 倒车退回线外要不要把圈退掉，取决于这个：漏了 checkpoint 的那次过线本来就没加圈，
   * 退回去时当然也不能去减前面某一圈。
   */
  private _lineCredited = false;

  private _lapTime = 0;
  private _totalTime = 0;
  private _lapTimes: number[] = [];
  private _bestLap: number | null = null;

  constructor(options: RaceProgressOptions = {}) {
    this.checkpointCount = Math.max(2, Math.floor(options.checkpointCount ?? DEFAULT_CHECKPOINT_COUNT));
    this._visited = new Array<boolean>(this.checkpointCount).fill(false);
    this.reset(options.startT ?? 0);
  }

  /** 回到发车状态。圈数、计时、最佳圈速全部清空。 */
  reset(t = 0): void {
    this._t = wrap01(t);
    this._sector = this.sectorOf(this._t);
    this._visited.fill(false);
    this._lineCredited = false;
    this._lap = 0;
    this._lapTime = 0;
    this._totalTime = 0;
    this._lapTimes = [];
    this._bestLap = null;
  }

  /**
   * 喂一帧。
   *
   * @param t  当前赛道进度 0..1（超出范围会自动折回，方便调用方直接传累加值）
   * @param dt 这一帧计入圈速的时长。**倒计时和冲线后传 0**：sector 照常跟踪，但计时不走
   * @returns  完成一圈的那一帧返回 LapCompleted，其余返回 null
   */
  update(t: number, dt = 0): LapCompleted | null {
    if (!Number.isFinite(t)) return null;

    if (dt > 0) {
      this._lapTime += dt;
      this._totalTime += dt;
    }

    const next = wrap01(t);
    this._t = next;

    const sector = this.sectorOf(next);
    if (sector === this._sector) return null;

    const n = this.checkpointCount;
    const from = this._sector;
    this._sector = sector;

    if ((sector - from + n) % n === 1) return this.crossForward(sector);
    if ((from - sector + n) % n === 1) {
      this.crossBackward(from);
      return null;
    }

    // 非相邻跳变：从赛道内侧横穿过去了，或者被传送走了。本圈作废，从线上重来。
    // 注意这里**不**清 _lapTime —— 抄近道的惩罚是"这圈白跑"，计时继续走。
    this._visited.fill(false);
    return null;
  }

  /** 正向进入 sector s。 */
  private crossForward(s: number): LapCompleted | null {
    if (s !== 0) {
      this._visited[s] = true;
      return null;
    }

    // 过起点线：1..n-1 全通过才算有效圈
    const complete = this.allCheckpointsPassed();
    this._visited.fill(false);
    this._lineCredited = complete;
    if (!complete) return null;

    const time = this._lapTime;
    this._lapTime = 0;
    this._lap += 1;
    this._lapTimes.push(time);
    const best = this._bestLap === null || time < this._bestLap;
    if (best) this._bestLap = time;
    return { lap: this._lap, time, best };
  }

  /** 倒车退出 sector `from`（也就是反向穿过 checkpoint from）。 */
  private crossBackward(from: number): void {
    if (from !== 0) {
      this._visited[from] = false;
      return;
    }

    // 倒车退回起点线之前。把刚才记上的那一圈整个撤销：圈数减一、圈速弹回来接着走、
    // 已通过的 checkpoint 恢复。再正着开过来时会重新记这一圈 —— 净效果就是"倒车过线不加圈"，
    // 而且来回折腾浪费的时间会算进那一圈里。
    if (!this._lineCredited) return;
    this._lineCredited = false;

    this._lap -= 1;
    this._lapTime += this._lapTimes.pop() ?? 0;
    this._bestLap = minOrNull(this._lapTimes);
    this._visited.fill(true);
    this._visited[0] = false;
  }

  private allCheckpointsPassed(): boolean {
    for (let i = 1; i < this.checkpointCount; i++) {
      if (!this._visited[i]) return false;
    }
    return true;
  }

  private sectorOf(t: number): number {
    const s = Math.floor(t * this.checkpointCount);
    return s < 0 ? 0 : s >= this.checkpointCount ? this.checkpointCount - 1 : s;
  }

  // ---------------------------------------------------------------- 只读视图

  /** 已完成的圈数（发车时 0） */
  get lap(): number {
    return this._lap;
  }

  /** 当前进度 0..1 */
  get t(): number {
    return this._t;
  }

  /**
   * 排名用的总进度 = 已完成圈数 + 当前圈进度。
   *
   * 注意它在"漏了 checkpoint 却过了线"时会掉回去将近 1 —— 这是对的：
   * 那一圈确实不算，名次也就该退回去。
   */
  get totalProgress(): number {
    return this._lap + this._t;
  }

  /** 当前这一圈已经跑了多久 */
  get lapTime(): number {
    return this._lapTime;
  }

  /** 从发车到现在计入的总时长（= 已完成各圈之和 + 当前圈） */
  get totalTime(): number {
    return this._totalTime;
  }

  /** 每一圈的用时，下标 0 = 第 1 圈 */
  get lapTimes(): readonly number[] {
    return this._lapTimes;
  }

  /** 最佳圈速，还没完成任何一圈时是 null */
  get bestLap(): number | null {
    return this._bestLap;
  }

  /** 上一圈用时，还没完成任何一圈时是 null */
  get lastLap(): number | null {
    return this._lapTimes.length === 0 ? null : this._lapTimes[this._lapTimes.length - 1]!;
  }

  /** 当前所在 sector */
  get sector(): number {
    return this._sector;
  }

  /** 本圈到目前为止 checkpoint 有没有漏。漏了的话过线不会记圈，HUD 可以提示一下 */
  get lapValid(): boolean {
    // 只检查"已经开过去的"那些：还没跑到的 checkpoint 当然是 false，不算漏
    for (let i = 1; i <= this._sector; i++) {
      if (!this._visited[i]) return false;
    }
    return true;
  }

  /** 本圈还没通过的 checkpoint 编号（调试用） */
  get missingCheckpoints(): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.checkpointCount; i++) {
      if (!this._visited[i]) out.push(i);
    }
    return out;
  }

  /** checkpoint i 在样条上的位置 t */
  checkpointT(index: number): number {
    const n = this.checkpointCount;
    return (((index % n) + n) % n) / n;
  }

  /**
   * 最近一个 checkpoint —— 也就是当前所在 sector 的入口。掉出赛道后拿它当重生点，
   * 比"最近的样条点"稳：从赛道外面横着摔出去时，最近样条点可能落在赛道另一段上，
   * 那等于白送一段近道。
   */
  getLastCheckpoint(): { index: number; t: number } {
    return { index: this._sector, t: this.checkpointT(this._sector) };
  }
}

/** 把 t 折回 [0,1)。 */
function wrap01(t: number): number {
  const r = t % 1;
  return r < 0 ? r + 1 : r;
}

function minOrNull(values: readonly number[]): number | null {
  let best: number | null = null;
  for (const v of values) if (best === null || v < best) best = v;
  return best;
}
