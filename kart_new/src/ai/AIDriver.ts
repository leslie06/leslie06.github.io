/**
 * AI 车手。**只产出 InputState**，不碰物理。
 *
 * 核心原则：AI 车跑的是和玩家一模一样的 stepKart + KartConfig，
 * 唯一的区别是这份 InputState 由这里生成而不是键盘。
 * 所以 AI 的加速曲线、转向权限、漂移蓄力、撞墙掉速……全都和玩家共用同一套规则，
 * 不会出现"AI 开得不像人"（比如贴着墙匀速滑行、或者原地掉头）的割裂感。
 *
 * 和 kartStep.ts 一样：不许 import three / rapier / DOM。赛道信息只经 AITrack 这个裸数字接口进来。
 *
 * ## 怎么开
 *
 * 1. 沿中心线往前看 lookAhead 米取一个目标点，叠上自己的 laneOffset（每辆车不同的走线）
 * 2. 目标点相对车头的角度差 diff  ->  steer（比例控制，够用；PID 的 D 项由 kartStep 的
 *    steerSmoothing 变相提供了）
 * 3. |diff| 大 = 前面是弯 -> 收油（甚至点刹），|diff| 小 -> 全油门
 * 4. |diff| 超过 driftAngleThreshold 且速度够快 -> 按住漂移键，靠 mini-turbo 出弯
 *
 * 这个类**有内部状态**（漂移的按住时长、脱困计时器），所以它是 class 不是函数，
 * 但依然是确定性的：同样的调用序列永远得到同样的输出。
 */
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';
import type { KartState } from '../kart/kartStep';
import { createTrackPoint, shiftLateral, wrap01, wrapPi, type AITrack, type AITrackPoint } from './AITrack';
import { createRng, rangeOf, type Rng } from '../items/rng';

export interface AIDriverConfig {
  /** 往前看多少米。看得越远开得越稳（进弯早、走线圆），太远则会切弯切过头 */
  lookAheadDistance: number;
  /** 速度前瞻：每 1 m/s 再多看这么多米。高速时必须看得更远，否则来不及入弯 */
  lookAheadPerSpeed: number;
  /** 自己这条走线相对中心线的横向偏移（米，正 = 车手视角右侧） */
  laneOffset: number;

  /** 角度差 -> steer 的比例增益（1/rad） */
  steerGain: number;

  /** |diff| 超过这个开始收油 */
  liftAngle: number;
  /** |diff| 到这个时油门收到 minThrottle */
  fullLiftAngle: number;
  /** 收油的下限，别真收到 0，不然出弯没劲 */
  minThrottle: number;
  /** |diff| 超过这个而且还在高速 -> 点刹 */
  brakeAngle: number;
  /** 低于这个速度就不点刹了（已经够慢） */
  brakeSpeed: number;

  /** 会不会用漂移蓄力。easy 档直接关掉 */
  useDrift: boolean;
  /** |diff| 超过这个就起漂 */
  driftAngleThreshold: number;
  /** 漂移中 |diff| 回落到这个以下就松手结算（比 threshold 小，做迟滞，避免抖） */
  driftReleaseAngle: number;
  /** 低于这个速度不起漂（kartStep 那边也有 driftMinSpeed，这里取更保守的） */
  driftMinSpeed: number;
  /** 起漂后至少按住这么久。太短会连一档都蓄不满，白搭上 driftFriction 的掉速 */
  driftMinHold: number;
  /** 最多按住这么久，防止长弯里一路漂到停 */
  driftMaxHold: number;

  /** 速度低于这个算"没在动" */
  stuckSpeed: number;
  /** 连续没动这么久就开始倒车脱困 */
  stuckTime: number;
  /** 一次脱困倒多久 */
  reverseTime: number;

  /** 拿到道具之后最少攥多久才用（秒）。模拟人的反应时间 */
  itemDelayMin: number;
  /** 最多攥多久 */
  itemDelayMax: number;
  /**
   * 攻击类道具在"前面没车"时最多再等多久。
   * 等超过了就照用不误 —— 不然领跑的 AI 会把飞弹攥到比赛结束
   */
  itemHoldPatience: number;
}

export const DEFAULT_AI_DRIVER_CONFIG: AIDriverConfig = {
  lookAheadDistance: 18,
  lookAheadPerSpeed: 0.34,
  laneOffset: 0,

  steerGain: 2.0,

  liftAngle: 0.22,
  fullLiftAngle: 0.72,
  minThrottle: 0.55,
  brakeAngle: 1.0,
  brakeSpeed: 18,

  useDrift: true,
  driftAngleThreshold: 0.4,
  driftReleaseAngle: 0.2,
  driftMinSpeed: 14,
  driftMinHold: 0.75,
  driftMaxHold: 2.6,

  stuckSpeed: 0.8,
  stuckTime: 1.5,
  reverseTime: 0.8,

  itemDelayMin: 0.5,
  itemDelayMax: 2,
  itemHoldPatience: 6,
};

/**
 * AI 每帧看到的道具情况。
 *
 * 故意**不**传 ItemId：车手只需要知道"有没有货""是不是攻击类""前面有没有人"，
 * 不需要认识具体是哪个道具。这样加新道具不用来改 AIDriver，
 * 也避免 ai/ 反过来依赖 items/。
 */
export interface AIItemView {
  /** 手里有没有道具 */
  hasItem: boolean;
  /** 是不是攻击类（ItemDef.offensive） */
  offensive: boolean;
  /** 前方够近的地方有没有车可以打 */
  targetAhead: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 目标点离车太近时 atan2 会被数值噪声主导，这时改用赛道自身的朝向当目标。 */
const MIN_TARGET_DISTANCE = 0.5;

export class AIDriver {
  readonly config: AIDriverConfig;

  /** 复用的输出对象。调用方每帧读完就用掉，不要长期持有（和 InputAdapter.sample 的约定一致） */
  private readonly out: InputState = { ...NEUTRAL_INPUT };
  private readonly point: AITrackPoint = createTrackPoint();

  /** 已经按住漂移键多久，0 = 没在漂 */
  private driftHold = 0;
  private stuckTimer = 0;
  private reverseTimer = 0;

  /** 还要攥多久才用手里这个道具。null = 手里没货（或者已经在等着开火了） */
  private itemDelay: number | null = null;
  /** 已经攥了多久。用来给"前面没车"的攻击道具封顶 */
  private itemHeld = 0;
  private readonly rng: Rng;

  /** 上一帧算出来的角度差，调试面板和测试要看 */
  private _angleError = 0;
  /** 上一帧瞄准的目标点，画调试线用 */
  private readonly _target = createTrackPoint();

  /**
   * @param seed 反应延迟的随机种子。每辆 AI 给一个不同的值，
   *   同一局又完全可复现（和项目里其余部分一样不用 Math.random）
   */
  constructor(
    private readonly track: AITrack,
    config: Partial<AIDriverConfig> = {},
    seed = 1,
  ) {
    this.config = { ...DEFAULT_AI_DRIVER_CONFIG, ...config };
    this.rng = createRng(seed);
  }

  /** 回到"刚发车"的状态。倒计时期间和重开比赛时调，免得脱困计时器在罚站时白白攒满。 */
  reset(): void {
    this.driftHold = 0;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.itemDelay = null;
    this.itemHeld = 0;
    this._angleError = 0;
    this.out.steer = 0;
    this.out.throttle = 0;
    this.out.brake = 0;
    this.out.drift = false;
    this.out.useItem = false;
  }

  /**
   * 算这一帧的输入。
   *
   * @param state  这辆 AI 车当前的运动状态
   * @param trackT 它在赛道上的进度 0..1（主循环从 GroundSample.progress 拿）
   */
  update(
    state: Readonly<KartState>,
    trackT: number,
    dt: number,
    item?: Readonly<AIItemView>,
  ): Readonly<InputState> {
    const cfg = this.config;
    const out = this.out;

    // --- 1. 瞄准点 ---
    const look = cfg.lookAheadDistance + cfg.lookAheadPerSpeed * Math.max(state.speed, 0);
    const targetT = wrap01(trackT + look / Math.max(this.track.length, 1e-6));
    const p = shiftLateral(this.track.sampleAt(targetT, this.point), cfg.laneOffset);
    this._target.x = p.x;
    this._target.z = p.z;
    this._target.heading = p.heading;

    const dx = p.x - state.x;
    const dz = p.z - state.z;
    // 目标点贴脸时方向向量退化，退回赛道朝向（此刻"跟着路走"就是对的）
    const desired = Math.hypot(dx, dz) < MIN_TARGET_DISTANCE ? p.heading : Math.atan2(dx, dz);
    const diff = wrapPi(desired - state.heading);
    const absDiff = Math.abs(diff);
    this._angleError = diff;

    // --- 2. 脱困。撞墙顶住 / 被别的车挤停了 -> 倒一段车重新起步 ---
    if (Math.abs(state.speed) < cfg.stuckSpeed && !state.airborne) this.stuckTimer += dt;
    else this.stuckTimer = 0;

    let reversing = false;
    if (this.reverseTimer > 0) {
      this.reverseTimer = Math.max(0, this.reverseTimer - dt);
      reversing = true;
    } else if (this.stuckTimer >= cfg.stuckTime) {
      this.reverseTimer = cfg.reverseTime;
      this.stuckTimer = 0;
      reversing = true;
    }

    // --- 3. 转向 ---
    // 符号：steer = +1 是"往右"，对应 heading 减小（见 KartState.heading 的说明）。
    // 目标在左边时 diff > 0（heading 要变大），所以要给负的 steer —— 故取负号。
    let steer = clamp(-diff * cfg.steerGain, -1, 1);
    // 倒车时 kartStep 会把转向结果反过来（和真车一致），这里也跟着反，
    // 不然脱困会越倒越歪
    if (reversing) steer = -steer;

    // --- 4. 油门 / 刹车 ---
    let throttle: number;
    let brake: number;
    if (reversing) {
      throttle = 0;
      brake = 1;
    } else {
      // 弯越急收得越多。liftAngle 以内全油门
      const liftSpan = Math.max(cfg.fullLiftAngle - cfg.liftAngle, 1e-6);
      const lift = clamp((absDiff - cfg.liftAngle) / liftSpan, 0, 1);
      throttle = lerp(1, cfg.minThrottle, lift);
      brake = absDiff >= cfg.brakeAngle && state.speed > cfg.brakeSpeed ? 1 : 0;
      // 点刹的那一帧别同时踩油门：kartStep 里刹车优先，油门会被忽略，
      // 但留着会让调试面板上的读数自相矛盾
      if (brake > 0) throttle = 0;
    }

    // --- 5. 漂移 ---
    let drift = false;
    if (cfg.useDrift && !reversing) {
      if (this.driftHold > 0) {
        this.driftHold += dt;
        const tooLong = this.driftHold >= cfg.driftMaxHold;
        // 迟滞：蓄够 driftMinHold 之后，弯一出（角度回正）就松手结算 mini-turbo
        const cornerDone = this.driftHold >= cfg.driftMinHold && absDiff < cfg.driftReleaseAngle;
        const tooSlow = state.speed < cfg.driftMinSpeed;
        if (tooLong || cornerDone || tooSlow) this.driftHold = 0;
        else drift = true;
      } else if (absDiff >= cfg.driftAngleThreshold && state.speed >= cfg.driftMinSpeed) {
        this.driftHold = dt;
        drift = true;
      }
    } else {
      this.driftHold = 0;
    }

    out.steer = steer;
    out.throttle = throttle;
    out.brake = brake;
    out.drift = drift;
    out.useItem = this.decideItem(item, dt);
    return out;
  }

  /**
   * 要不要在这一帧把道具丢出去。
   *
   * 规则很简单，但两条都是为了不让 AI 显得像机器：
   *   - 拿到手之后先攥 0.5~2 秒（每次随机）才用，模拟人的反应时间。
   *     不加这个的话八辆 AI 会在碾过箱子的同一帧齐刷刷开火
   *   - 攻击类道具等前面有车了再用；但攥过 itemHoldPatience 之后就不等了，
   *     否则领跑的 AI 会把道具攥到终点
   */
  private decideItem(item: Readonly<AIItemView> | undefined, dt: number): boolean {
    if (!item?.hasItem) {
      this.itemDelay = null;
      this.itemHeld = 0;
      return false;
    }

    // 刚拿到手：摇一个反应延迟
    if (this.itemDelay === null) {
      this.itemDelay = rangeOf(this.rng, this.config.itemDelayMin, this.config.itemDelayMax);
      this.itemHeld = 0;
    }

    this.itemHeld += dt;
    this.itemDelay -= dt;
    if (this.itemDelay > 0) return false;

    // 防御类立刻用；攻击类等目标，等腻了也用
    if (item.offensive && !item.targetAhead && this.itemHeld < this.config.itemHoldPatience) {
      return false;
    }
    // 交出去了。下次拿到新道具会重新摇延迟
    this.itemDelay = null;
    this.itemHeld = 0;
    return true;
  }

  /** 上一帧的角度差（rad，正 = 目标在左）。调试面板 / 测试用 */
  get angleError(): number {
    return this._angleError;
  }

  /** 上一帧瞄准的点。画调试线用 */
  get target(): Readonly<AITrackPoint> {
    return this._target;
  }

  /** 现在是不是按着漂移键 */
  get drifting(): boolean {
    return this.driftHold > 0;
  }
}
