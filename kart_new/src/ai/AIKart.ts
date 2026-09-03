/**
 * 一辆 AI 车的全部状态：运动状态 + 自己的一份 KartConfig + 车手 + 橡皮筋。
 * 纯逻辑，不 import three / rapier —— 渲染那一半在 main.ts 里配一个 KartView 就行。
 *
 * 关键设计：**AI 用的是和玩家同一套 stepKart 和同一份 KartConfig 数值**。
 * 每个物理子步先把玩家那份 config（lil-gui 正在实时调的那个）逐字段拷进自己的副本，
 * 再只覆盖 maxSpeed 一项（难度基准倍率 × 个体差异 × 橡皮筋倍率）。
 * 于是：调参面板上一动，AI 立刻跟着变；而橡皮筋只影响这辆车的极速，
 * 绝不会反过来污染全局配置。
 */
import type { GroundSample } from '../kart/GroundSample';
import {
  cloneKartConfig,
  KART_CONFIG_RANGES,
  KART_CONFIG_TRIPLE_RANGES,
  type KartConfig,
  type KartConfigScalarKey,
  type KartConfigTripleKey,
} from '../kart/KartConfig';
import { createKartState, stepKart, type KartState } from '../kart/kartStep';
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';
import type { EffectSet } from '../items/EffectSystem';
import { AIDriver, type AIItemView } from './AIDriver';
import type { AITrack } from './AITrack';
import { AI_PROFILES, type AIDifficulty, type AIPersona } from './AIProfiles';
import { NO_RUBBERBAND, Rubberband } from './Rubberband';

const SCALAR_KEYS = Object.keys(KART_CONFIG_RANGES) as KartConfigScalarKey[];
const TRIPLE_KEYS = Object.keys(KART_CONFIG_TRIPLE_RANGES) as KartConfigTripleKey[];

export interface AIKartOptions {
  id: string;
  persona: AIPersona;
  difficulty: AIDifficulty;
  track: AITrack;
  /** 用道具的反应延迟的随机种子。每辆车给一个不同的值，同一局仍然可复现 */
  seed?: number;
}

/** 出生点。和 GridSlot 的形状对得上，直接传就行 */
export interface Spawn {
  x: number;
  z: number;
  y?: number;
  heading: number;
}

export class AIKart {
  readonly id: string;
  readonly persona: AIPersona;
  readonly driver: AIDriver;
  readonly rubberband = new Rubberband();
  /** 这辆车专用的配置副本。每步从玩家那份同步过来，只有 maxSpeed 是自己的 */
  readonly config: KartConfig = cloneKartConfig();

  current: KartState;
  previous: KartState;

  /** 上一步车手有没有要求用道具。主循环喂给 ItemSystem */
  private _wantsItem = false;

  private _difficulty: AIDifficulty;
  /** 难度基准倍率 × 这辆车的个体差异 */
  private speedMul = 1;
  private _rubberbandEnabled = true;

  constructor(options: AIKartOptions, spawn: Spawn) {
    this.id = options.id;
    this.persona = options.persona;
    this._difficulty = options.difficulty;
    this.driver = new AIDriver(
      options.track,
      { ...AI_PROFILES[options.difficulty].driver, laneOffset: options.persona.laneOffset },
      options.seed ?? 1,
    );
    this.applyDifficulty(options.difficulty);
    this.current = createKartState(spawn.x, spawn.z, spawn.heading, spawn.y ?? 0);
    this.previous = { ...this.current };
  }

  get difficulty(): AIDifficulty {
    return this._difficulty;
  }

  /** 换难度。可以在比赛中途改（调试面板要用），下一帧就生效 */
  setDifficulty(difficulty: AIDifficulty): void {
    this._difficulty = difficulty;
    this.applyDifficulty(difficulty);
  }

  private applyDifficulty(difficulty: AIDifficulty): void {
    const profile = AI_PROFILES[difficulty];
    Object.assign(this.driver.config, profile.driver);
    // laneOffset 是这辆车的个性，不归难度管，覆盖回来
    this.driver.config.laneOffset = this.persona.laneOffset;
    this.speedMul = profile.speedMul * this.persona.speedMul;
    this.rubberband.config = this._rubberbandEnabled ? profile.rubberband : NO_RUBBERBAND;
  }

  get rubberbandEnabled(): boolean {
    return this._rubberbandEnabled;
  }

  set rubberbandEnabled(on: boolean) {
    this._rubberbandEnabled = on;
    this.rubberband.config = on ? AI_PROFILES[this._difficulty].rubberband : NO_RUBBERBAND;
    if (!on) this.rubberband.reset();
  }

  /** 回到发车格。重开比赛时调 */
  respawn(spawn: Spawn): void {
    this.current = createKartState(spawn.x, spawn.z, spawn.heading, spawn.y ?? 0);
    this.previous = { ...this.current };
    this.driver.reset();
    this.rubberband.reset();
  }

  /**
   * 推进一个物理子步。
   *
   * @param base          玩家那份 KartConfig（lil-gui 实时在调的那个），当作基准数值
   * @param ground        这辆车当前位置的地面探测结果
   * @param locked        比赛状态机说这辆车现在不许动（倒计时中 / 已冲线）
   * @param deltaProgress this.totalProgress - 玩家的 totalProgress，负 = 落后
   * @param item    这一帧的道具情况。不传 = 这局没开道具系统
   * @param effects 这辆车身上挂着的道具效果。会改写这一步用的 config 副本
   */
  step(
    base: Readonly<KartConfig>,
    ground: Readonly<GroundSample>,
    locked: boolean,
    deltaProgress: number,
    dt: number,
    item?: Readonly<AIItemView>,
    effects?: EffectSet,
  ): void {
    this.previous = this.current;
    // 减去这辆车自己的目标差距：它追的不是"和玩家齐平"，而是"和玩家保持 targetGap"。
    // 八辆车各有各的目标位，队形才会拉成一串而不是挤成一坨
    this.rubberband.update(deltaProgress - this.persona.targetGap, dt);
    this.syncConfig(base);

    // 罚站的时候不要跑车手逻辑：脱困计时器会在倒计时那 3 秒里攒满，
    // 一放行 AI 就集体倒车
    let input: Readonly<InputState> = NEUTRAL_INPUT;
    if (locked) this.driver.reset();
    else input = this.driver.update(this.current, ground.progress, dt, item);
    this._wantsItem = input.useItem;

    // 道具效果最后写：它盖在难度倍率和橡皮筋之上，
    // 中了闪电的 AI 就是在"它自己的极速"基础上再打折
    effects?.applyTo(this.config);

    this.current = stepKart(this.current, input, ground, this.config, dt);
  }

  /** 把玩家那份配置逐字段拷过来，只有 maxSpeed 换成自己的。 */
  private syncConfig(base: Readonly<KartConfig>): void {
    const cfg = this.config;
    for (const key of SCALAR_KEYS) cfg[key] = base[key];
    // 三档数组必须**就地**改而不是换引用：换引用就和 base 共享了同一个数组，
    // 谁改都会串台（cloneKartConfig 的注释里踩过同一个坑）
    for (const key of TRIPLE_KEYS) {
      const src = base[key];
      const dst = cfg[key];
      dst[0] = src[0];
      dst[1] = src[1];
      dst[2] = src[2];
    }
    cfg.maxSpeed = base.maxSpeed * this.speedMul * this.rubberband.multiplier;
  }

  /**
   * 上一步车手要不要用道具。
   *
   * 车手把它写在 InputState 里（和油门刹车一样是一种"意图"），但真正执行道具
   * 是 ItemSystem 的事，而 ItemSystem 在这一步之后才跑，所以这里存一下转交出去。
   */
  get wantsItem(): boolean {
    return this._wantsItem;
  }

  /** 难度基准 × 个体差异，不含橡皮筋。橡皮筋到底加了多少，拿它和 effectiveSpeedMul 比 */
  get baseSpeedMul(): number {
    return this.speedMul;
  }

  /** 当前极速相对玩家的倍率（含难度、个体差异和橡皮筋）。调试面板用 */
  get effectiveSpeedMul(): number {
    return this.speedMul * this.rubberband.multiplier;
  }
}
