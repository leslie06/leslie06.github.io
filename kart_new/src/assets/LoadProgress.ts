/**
 * 加载进度的账本。纯的，不碰 DOM —— 画进度条是 LoadingScreen 的事。
 *
 * 存在的理由：首屏要等的不只是"下载资源"。rapier 的 wasm 要编译、赛道网格要挤出来，
 * 这些都是实打实的几百毫秒，进度条要是只算下载量，就会出现"100% 之后再黑屏两秒"。
 * 所以这里按**加权任务**记账：每个阶段自己报 0..1，权重决定它占进度条多长。
 */
export interface LoadTask {
  id: string;
  /** 显示给玩家看的一句话 */
  label: string;
  /** 权重，相对值。大概按"预计耗时"给就行 */
  weight: number;
}

export interface LoadSnapshot {
  /** 0..1 */
  ratio: number;
  /** 当前还没做完的第一个任务的 label；全做完了就是最后一个 */
  label: string;
  done: boolean;
}

export class LoadProgress {
  private readonly tasks: readonly LoadTask[];
  private readonly ratios = new Map<string, number>();
  private readonly totalWeight: number;

  constructor(
    tasks: readonly LoadTask[],
    private readonly onChange?: (snapshot: LoadSnapshot) => void,
  ) {
    this.tasks = tasks;
    this.totalWeight = tasks.reduce((sum, t) => sum + Math.max(t.weight, 0), 0) || 1;
    for (const task of tasks) this.ratios.set(task.id, 0);
    this.emit();
  }

  /** 报告某个任务的进度。未知 id 直接忽略（少写一个 if 比多一次崩强） */
  set(id: string, ratio: number): void {
    if (!this.ratios.has(id)) return;
    const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    // 进度只许往前：xhr 的 total 有时会中途才知道，回退会让条子倒着走
    if (clamped <= this.ratios.get(id)!) return;
    this.ratios.set(id, clamped);
    this.emit();
  }

  complete(id: string): void {
    this.set(id, 1);
  }

  snapshot(): LoadSnapshot {
    let weighted = 0;
    let label = this.tasks[this.tasks.length - 1]?.label ?? '';
    let found = false;
    for (const task of this.tasks) {
      const ratio = this.ratios.get(task.id) ?? 0;
      weighted += ratio * Math.max(task.weight, 0);
      if (!found && ratio < 1) {
        label = task.label;
        found = true;
      }
    }
    const value = weighted / this.totalWeight;
    return { ratio: value, label, done: value >= 1 };
  }

  private emit(): void {
    this.onChange?.(this.snapshot());
  }
}
