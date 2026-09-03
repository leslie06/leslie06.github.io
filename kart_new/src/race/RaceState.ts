/**
 * 比赛状态机：倒计时 -> 比赛中 -> 结束，外加名次。纯逻辑，不碰 three / DOM。
 *
 * 每辆车一个 RaceProgress，RaceState 负责：
 *   - 三段式流程和输入锁（倒计时期间、冲线之后都不许操作）
 *   - 圈数达标判定
 *   - 按 totalProgress 排名次
 *
 * 玩家和 AI 在这里没有区别，都是一个 racer：主循环每帧把所有车的 t 一起喂进 update。
 * isPlayer 只影响一件事 —— 比赛什么时候算结束（玩家全部冲线即结束，AI 还在跑也照样出结算面板）。
 */
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';
import { DEFAULT_CHECKPOINT_COUNT, RaceProgress, type LapCompleted } from './RaceProgress';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceConfig {
  /** 跑几圈 */
  totalLaps: number;
  /** 倒计时时长（秒）。3 秒 = 3-2-1-GO */
  countdownDuration: number;
  /** 每圈几个 checkpoint（含起点线） */
  checkpointCount: number;
}

/**
 * 倒计时归零的判定阈值。
 * 3 秒按 1/60 减 180 次，二进制误差会剩下 ~1e-14，直接 `<= 0` 会卡住多跑一帧。
 */
const COUNTDOWN_EPSILON = 1e-6;

export const DEFAULT_RACE_CONFIG: RaceConfig = {
  totalLaps: 3,
  countdownDuration: 3,
  checkpointCount: DEFAULT_CHECKPOINT_COUNT,
};

export interface RacerInit {
  id: string;
  /** 显示名，默认用 id */
  name?: string;
  /** 玩家车。玩家全部冲线 = 比赛结束 */
  isPlayer?: boolean;
  /** 发车位置的 t */
  startT?: number;
}

/** 名次表的一行。 */
export interface Standing {
  id: string;
  name: string;
  isPlayer: boolean;
  /** 1 = 第一名 */
  place: number;
  /** 已完成圈数 */
  lap: number;
  totalProgress: number;
  finished: boolean;
  /** 冲线时的总用时，没冲线是 null */
  finishTime: number | null;
}

export type RaceEvent =
  /** 倒计时读秒，count = 3 / 2 / 1 */
  | { type: 'countdownTick'; count: number }
  /** 倒计时结束，放行 */
  | { type: 'go' }
  | { type: 'lap'; id: string; lap: number; time: number; best: boolean }
  | { type: 'racerFinished'; id: string; place: number; totalTime: number }
  /** 所有玩家车都冲线了，进入 finished */
  | { type: 'raceFinished' };

interface Racer {
  readonly id: string;
  readonly name: string;
  readonly isPlayer: boolean;
  readonly startT: number;
  readonly progress: RaceProgress;
  finished: boolean;
  finishTime: number | null;
  place: number;
}

export class RaceState {
  readonly config: RaceConfig;

  private readonly racers: Racer[];
  private readonly byId = new Map<string, Racer>();
  private _phase: RacePhase = 'countdown';
  private _countdown: number;
  /** 倒计时上一次播报的整数，用来只在跨秒时发一次事件 */
  private _shownCount = -1;
  /** 从 GO 到现在的比赛时长 */
  private _time = 0;
  private _finishedCount = 0;
  private readonly events: RaceEvent[] = [];
  private _standings: Standing[] = [];

  constructor(racers: readonly RacerInit[], config: Partial<RaceConfig> = {}) {
    this.config = { ...DEFAULT_RACE_CONFIG, ...config };
    this._countdown = this.config.countdownDuration;
    this.racers = racers.map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      isPlayer: r.isPlayer ?? false,
      startT: r.startT ?? 0,
      progress: new RaceProgress({
        checkpointCount: this.config.checkpointCount,
        startT: r.startT ?? 0,
      }),
      finished: false,
      finishTime: null,
      place: 0,
    }));
    for (const r of this.racers) this.byId.set(r.id, r);
    this.rebuildStandings();
  }

  /** 全部推倒重来（重开一局）。 */
  restart(): void {
    this._phase = 'countdown';
    this._countdown = this.config.countdownDuration;
    this._shownCount = -1;
    this._time = 0;
    this._finishedCount = 0;
    this.events.length = 0;
    for (const r of this.racers) {
      r.progress.reset(r.startT);
      r.finished = false;
      r.finishTime = null;
      r.place = 0;
    }
    this.rebuildStandings();
  }

  /**
   * 推进一步。
   *
   * @param dt 物理步长
   * @param positions 每辆车这一帧的赛道进度 t（0..1）。缺席的车沿用上一帧
   */
  update(dt: number, positions: Readonly<Record<string, number>>): void {
    const running = this._phase === 'racing';
    if (running) this._time += dt;

    for (const racer of this.racers) {
      const t = positions[racer.id];
      // 冲线之后计时停住，但进度还要继续跟（车在自然减速，还在往前滑）
      const timing = running && !racer.finished ? dt : 0;
      const lap = t === undefined ? null : racer.progress.update(t, timing);
      if (lap) this.onLap(racer, lap);
    }

    // 倒计时放在最后：这样"倒计时归零"的那一步 dt 全部算在倒计时上，
    // 比赛时间从下一步才开始走，不会白送一帧
    if (this._phase === 'countdown') this.tickCountdown(dt);

    this.rebuildStandings();
  }

  private tickCountdown(dt: number): void {
    this._countdown = Math.max(0, this._countdown - dt);
    const shown = Math.ceil(this._countdown);
    if (shown !== this._shownCount) {
      this._shownCount = shown;
      if (shown > 0) this.events.push({ type: 'countdownTick', count: shown });
    }
    if (this._countdown <= COUNTDOWN_EPSILON) {
      this._phase = 'racing';
      this.events.push({ type: 'go' });
    }
  }

  private onLap(racer: Racer, lap: LapCompleted): void {
    this.events.push({ type: 'lap', id: racer.id, lap: lap.lap, time: lap.time, best: lap.best });
    if (racer.finished || lap.lap < this.config.totalLaps) return;

    racer.finished = true;
    racer.finishTime = racer.progress.totalTime;
    this._finishedCount += 1;
    racer.place = this._finishedCount;
    this.events.push({
      type: 'racerFinished',
      id: racer.id,
      place: racer.place,
      totalTime: racer.finishTime,
    });

    if (this._phase !== 'finished' && this.allPlayersFinished()) {
      this._phase = 'finished';
      this.events.push({ type: 'raceFinished' });
    }
  }

  private allPlayersFinished(): boolean {
    const players = this.racers.filter((r) => r.isPlayer);
    const watched = players.length > 0 ? players : this.racers;
    return watched.every((r) => r.finished);
  }

  /**
   * 名次：已冲线的按冲线顺序排在前面，其余按 totalProgress 从大到小。
   * 每帧重排一次；车少，O(n log n) 无所谓。
   */
  private rebuildStandings(): void {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.place - b.place;
      return b.progress.totalProgress - a.progress.totalProgress;
    });
    this._standings = sorted.map((r, i) => ({
      id: r.id,
      name: r.name,
      isPlayer: r.isPlayer,
      place: i + 1,
      lap: r.progress.lap,
      totalProgress: r.progress.totalProgress,
      finished: r.finished,
      finishTime: r.finishTime,
    }));
  }

  // ---------------------------------------------------------------- 输入锁

  /** 倒计时期间谁都不许动；冲线的车也锁掉，让它靠 coastFriction 自然停下。 */
  isInputLocked(id?: string): boolean {
    if (this._phase === 'countdown' || this._phase === 'finished') return true;
    if (id === undefined) return false;
    return this.byId.get(id)?.finished ?? false;
  }

  /** 锁住时返回中立输入。主循环直接把它套在 InputAdapter.sample() 外面。 */
  gateInput(id: string, input: Readonly<InputState>): Readonly<InputState> {
    return this.isInputLocked(id) ? NEUTRAL_INPUT : input;
  }

  // ---------------------------------------------------------------- 只读视图

  get phase(): RacePhase {
    return this._phase;
  }

  /** 倒计时剩余秒数（HUD 自己 ceil 成 3/2/1） */
  get countdown(): number {
    return this._countdown;
  }

  /** GO 之后的比赛时长 */
  get time(): number {
    return this._time;
  }

  get standings(): readonly Standing[] {
    return this._standings;
  }

  get racerCount(): number {
    return this.racers.length;
  }

  /** 取某辆车的圈速记录 */
  getProgress(id: string): RaceProgress | undefined {
    return this.byId.get(id)?.progress;
  }

  getStanding(id: string): Standing | undefined {
    return this._standings.find((s) => s.id === id);
  }

  /** 取走这一批事件（取完就清空）。HUD 每渲染帧调一次。 */
  consumeEvents(): RaceEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }
}
