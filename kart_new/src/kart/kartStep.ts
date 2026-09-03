/**
 * 纯数值的卡丁车运动学步进 + 漂移蓄力（mini-turbo）状态机。
 *
 * 这个文件不许 import three / DOM / 任何渲染相关的东西 —— 它只吃 (state, input, config, dt)，
 * 吐一个新的 state。没有副作用，没有随机数，同样的输入永远得到同样的输出。
 * 车身侧倾、火花、相机推镜这类纯视觉的东西属于 KartView / FollowCamera，不属于这里。
 *
 * 地形也一样：射线查询要用 rapier，那是渲染/物理层的事，所以这里只吃一个算好的
 * GroundSample（接触点高度、地面法线、在不在赛道上），自己不查任何东西。
 *
 * 模型是"运动学"的：只维护一个标量速度 speed 和一个朝向角 heading，每帧沿 heading 推进。
 * 没有横向速度分量，所以抓地力天然是满的 —— 不侧滑、不打转、不失控。
 * 漂移时"车身斜着走"是靠 driftYawOffset 这个纯朝向量做的，前进方向仍然严格沿 heading。
 */
import type { KartConfig } from './KartConfig';
import type { GroundSample } from './GroundSample';
import type { InputState } from '../input/InputState';

/**
 * 漂移相位。描述的是**玩家此刻在做什么**：
 * - `none`     普通行驶
 * - `drifting` 正在漂移蓄力
 * - `boosting` 漂移结束、正在吃 mini-turbo
 *
 * 注意 boost 的**生效**与否看 `boostTime > 0`，不看这个字段：
 * boost 期间可以直接起下一个漂移，那时 phase 会回到 `drifting` 但 boostTime 继续跑，
 * 剩余的 boost 不会因为起漂而白白丢掉。
 */
export type DriftPhase = 'none' | 'drifting' | 'boosting';

/** 蓄力档位。0 = 未成档，1/2/3 对应 chargeThresholds 的三档。 */
export type ChargeLevel = 0 | 1 | 2 | 3;

/** 漂移方向。0 = 没在漂移。 */
export type DriftDir = -1 | 0 | 1;

export interface KartState {
  /** 地面平面坐标（对应 three 里的 x / z） */
  x: number;
  z: number;
  /** 离地高度。贴地时平滑逼近接触点，掉出赛道时按重力下落 */
  y: number;
  /**
   * 朝向角，弧度。0 指向 +z，绕 +y 轴的右手旋转（x = sin(h), z = cos(h)），
   * 和 three 里的 `object.rotation.y` 完全一致，可以直接赋值。
   *
   * 注意符号：绕 +y 的正向旋转从上往下看是逆时针，也就是**左转**。
   * 所以 steer = +1（玩家按右）对应的是 heading 减小 —— 见下面 yawRate 的负号。
   *
   * 故意不做 [-π, π] 归一化：这样主循环做渲染插值时可以直接线性插值，不用处理绕圈跳变。
   */
  heading: number;
  /** 标量速度，沿 heading。负数 = 倒车 */
  speed: number;
  /** 平滑后的方向输入 -1..1（给转向和视觉侧倾用） */
  steer: number;
  /** 这一帧实际施加的偏航角速度 rad/s（给视觉侧倾用） */
  yawRate: number;

  // ---------- 漂移 ----------
  driftPhase: DriftPhase;
  /** 起漂瞬间锁定的方向，漂移过程中不可改变 */
  driftDir: DriftDir;
  /** 已蓄力时长（秒），非漂移状态恒为 0 */
  driftCharge: number;
  /** driftCharge 换算出来的档位 */
  driftLevel: ChargeLevel;
  /**
   * 车身相对前进方向的额外偏转角（弧度，已平滑）。
   * 渲染时车身画在 heading + driftYawOffset 上，但位置推进只用 heading。
   */
  driftYawOffset: number;

  // ---------- Boost ----------
  /** 剩余 boost 时间（秒）。> 0 就在吃 boost，跟 driftPhase 无关 */
  boostTime: number;
  /** 当前 boost 的档位，boostTime 为 0 时是 0 */
  boostLevel: ChargeLevel;

  // ---------- 地形 ----------
  /** 垂直速度，只在下落时有意义 */
  vy: number;
  /** 车下面没路了，正在往下掉 */
  airborne: boolean;
  /** 已经掉了多久（秒）。到 cfg.respawnDelay 就重生 */
  fallTime: number;
  /**
   * 平滑后的地面法线（单位向量）。车身姿态对齐它。
   * 平滑放在这里而不是 KartView：这样它是确定性的、可测的，
   * KartView 只管把它转成旋转。
   */
  groundNormalX: number;
  groundNormalY: number;
  groundNormalZ: number;
  /** 上一次采样得到的赛道进度 0..1。存进 state 纯粹是方便 HUD / 调试面板读 */
  trackProgress: number;
  /** 上一次采样得到的横向偏移（正 = 车手视角右侧） */
  lateralOffset: number;
}

/**
 * @param y 出生高度。放在最后是为了不动 (x, z, heading) 这个已有的调用顺序
 */
export function createKartState(x = 0, z = 0, heading = 0, y = 0): KartState {
  return {
    x,
    z,
    y,
    heading,
    speed: 0,
    steer: 0,
    yawRate: 0,
    driftPhase: 'none',
    driftDir: 0,
    driftCharge: 0,
    driftLevel: 0,
    driftYawOffset: 0,
    boostTime: 0,
    boostLevel: 0,
    vy: 0,
    airborne: false,
    fallTime: 0,
    groundNormalX: 0,
    groundNormalY: 1,
    groundNormalZ: 0,
    trackProgress: 0,
    lateralOffset: 0,
  };
}

export function cloneKartState(s: Readonly<KartState>): KartState {
  return { ...s };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 把 value 朝 target 拉近 maxDelta，不会越过 target。 */
function moveToward(value: number, target: number, maxDelta: number): number {
  const diff = target - value;
  if (Math.abs(diff) <= maxDelta) return target;
  return value + Math.sign(diff) * maxDelta;
}

/** 速度小到这个值以下就当作停住了（避免刹车在 0 附近来回抖）。 */
const STOP_EPSILON = 0.05;

/**
 * 朝上限加速。
 *
 * 关键点：已经超过上限时**原样返回**，绝不把 speed 硬拽回 cap。
 * 直接写 `Math.min(cap, speed + delta)` 的话，boost 一结束上限从 maxSpeed*mul 掉回 maxSpeed，
 * 这一句就会在单帧内把超速部分全部抹掉（实测一下掉 11.5 m/s，手感像撞墙）。
 * 超速部分要交给下面的 boostFalloffDecel 平滑放掉。
 */
function accelerateToward(speed: number, cap: number, delta: number): number {
  return speed >= cap ? speed : Math.min(cap, speed + delta);
}

/** 蓄力时长换算档位。阈值假定递增。 */
export function chargeLevelOf(charge: number, thresholds: readonly number[]): ChargeLevel {
  let level: ChargeLevel = 0;
  for (let i = 0; i < 3; i++) {
    if (charge >= (thresholds[i] ?? Infinity)) level = (i + 1) as ChargeLevel;
  }
  return level;
}

/** boost 生效时的速度上限；没有 boost 就是普通 maxSpeed。 */
export function speedCapOf(state: Readonly<KartState>, cfg: Readonly<KartConfig>): number {
  if (state.boostTime <= 0 || state.boostLevel === 0) return cfg.maxSpeed;
  return cfg.maxSpeed * (cfg.boostSpeedMul[state.boostLevel - 1] ?? 1);
}

/**
 * @param ground 外层 PhysicsSystem 对**当前位置**做的地面探测结果。
 *   注意它对应的是这一步开始时的位置，推进之后才用它做贴地和护栏修正 ——
 *   也就是差一帧。60Hz 下这点滞后看不出来，换来的是"查询和积分完全解耦"。
 */
export function stepKart(
  state: Readonly<KartState>,
  input: Readonly<InputState>,
  ground: Readonly<GroundSample>,
  cfg: Readonly<KartConfig>,
  dt: number,
): KartState {
  if (dt <= 0) return cloneKartState(state);

  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const steerTarget = clamp(input.steer, -1, 1);

  // --- 方向输入平滑（指数逼近，跟帧率无关）---
  const steer = lerp(state.steer, steerTarget, 1 - Math.exp(-cfg.steerSmoothing * dt));

  // ==========================================================================
  // 1. 纵向。用的是**上一帧**的 boost 状态：boost 的开关在下面的状态机里翻，
  //    这一帧的动力学按上一帧的结论算，因果顺序才不会绕回去。
  // ==========================================================================
  const boostActive = state.boostTime > 0 && state.boostLevel > 0;
  const speedCap = speedCapOf(state, cfg);

  let speed = state.speed;
  const movingForward = speed > STOP_EPSILON;

  if (brake > 0 && movingForward) {
    // 前进中踩刹车：减速，但不会被刹到倒着走
    speed = Math.max(0, speed - cfg.brakeDecel * brake * dt);
  } else if (brake > 0 && !movingForward) {
    // 已经停住（或已经在倒车）：后退键当倒车用
    speed = Math.max(-cfg.maxReverseSpeed, speed - cfg.reverseAccel * brake * dt);
  } else if (boostActive) {
    // boost 像加速带一样推着走，松油门也照推（松了也不该把 mini-turbo 浪费掉）
    speed = accelerateToward(speed, speedCap, cfg.engineAccel * cfg.boostAccelMul * dt);
  } else if (throttle > 0) {
    if (speed < 0) {
      // 倒车中踩油门 = 先刹住
      speed = Math.min(0, speed + cfg.brakeDecel * throttle * dt);
    } else {
      speed = accelerateToward(speed, cfg.maxSpeed, cfg.engineAccel * throttle * dt);
    }
  } else {
    // 滑行：自然衰减到 0
    speed = moveToward(speed, 0, cfg.coastFriction * dt);
  }

  // 超过当前上限的部分**平滑回落**，不硬 clamp。
  // boost 结束的那一帧 speedCap 会掉回 maxSpeed，靠这里把超速部分慢慢放掉，
  // 不然会瞬间掉速，手感像撞墙。
  if (speed > speedCap) speed = moveToward(speed, speedCap, cfg.boostFalloffDecel * dt);
  if (speed < -cfg.maxReverseSpeed) speed = -cfg.maxReverseSpeed;

  // ==========================================================================
  // 2. 漂移状态机
  // ==========================================================================
  let phase = state.driftPhase;
  let driftDir = state.driftDir;
  let charge = state.driftCharge;
  let level = state.driftLevel;
  let boostTime = Math.max(0, state.boostTime - dt);
  let boostLevel: ChargeLevel = boostTime > 0 ? state.boostLevel : 0;

  // 只有前进中才能漂移
  const fastEnough = speed > cfg.driftMinSpeed;
  const steerEngaged = Math.abs(steerTarget) >= cfg.driftSteerDeadzone;

  if (phase === 'drifting') {
    if (!fastEnough) {
      // 掉速 -> 中断，charge 清零，没有奖励
      phase = 'none';
      driftDir = 0;
      charge = 0;
      level = 0;
    } else if (!input.drift) {
      // 松键结算
      if (level > 0) {
        const duration = cfg.boostDuration[level - 1] ?? 0;
        // 手上还有更久的 boost 就别把它换短了
        if (duration >= boostTime) {
          boostTime = duration;
          boostLevel = level;
        }
        phase = 'boosting';
      } else {
        // 蓄力不足：平滑退出，无奖励
        phase = 'none';
      }
      driftDir = 0;
      charge = 0;
      level = 0;
    } else {
      charge += dt;
      level = chargeLevelOf(charge, cfg.chargeThresholds);
    }
  } else {
    // none / boosting：boost 跑完就回 none
    if (phase === 'boosting' && boostTime <= 0) phase = 'none';
    // 起漂。boost 期间也允许起漂，boostTime 不清零，剩下的 boost 继续吃
    if (input.drift && steerEngaged && fastEnough) {
      phase = 'drifting';
      driftDir = steerTarget > 0 ? 1 : -1;
      charge = 0;
      level = 0;
    }
  }

  // ==========================================================================
  // 3. 转向
  // ==========================================================================
  const absSpeed = Math.abs(speed);
  // 低速时转向权限线性淡入：静止时为 0，所以原地打方向车不会自转
  const authority = clamp(absSpeed / cfg.steerAuthoritySpeed, 0, 1);
  // 速度越高转得越钝
  const speedFalloff = lerp(1, cfg.highSpeedSteerFactor, clamp(absSpeed / cfg.maxSpeed, 0, 1));

  let yawRate: number;
  if (phase === 'drifting' && driftDir !== 0) {
    // 漂移中恒定朝 driftDir 转，steer 只能调紧或调松。
    // aligned = +1 同向（转最紧），-1 反打（掰回来一些，但 factor 始终 > 0，
    // 也就是反打**永远不能**把转向掰到停或反向，漂移不会被反打取消）。
    const aligned = clamp(steerTarget * driftDir, -1, 1);
    const factor = lerp(cfg.driftCounterSteer, 1, (aligned + 1) / 2);
    yawRate = -cfg.driftTurnRate * driftDir * factor * authority * speedFalloff;
  } else {
    // 倒车时打方向的转向结果要反过来，跟真车一致
    const direction = speed < 0 ? -1 : 1;
    // 负号：steer=+1 是玩家意义上的"右"，对应绕 +y 的负向旋转（见 KartState.heading 的说明）
    yawRate = -cfg.turnRate * steer * authority * speedFalloff * direction;
  }
  const heading = state.heading + yawRate * dt;

  // ==========================================================================
  // 4. 阻力 & 车身偏转
  // ==========================================================================
  let drag = Math.abs(yawRate) * cfg.corneringDrag;
  if (phase === 'drifting') drag += cfg.driftFriction;
  if (drag > 0 && !boostActive) speed = moveToward(speed, 0, drag * dt);

  // 车身相对前进方向斜过去。右漂（driftDir=+1）车头朝弯内侧转 = 绕 +y 的负向，故取负号。
  const yawOffsetTarget = phase === 'drifting' ? -cfg.driftYaw * driftDir : 0;
  const driftYawOffset = lerp(
    state.driftYawOffset,
    yawOffsetTarget,
    1 - Math.exp(-cfg.driftYawSmoothing * dt),
  );

  // ==========================================================================
  // 5. 推进位置。只用 heading，driftYawOffset 不参与 —— 车斜着走但仍沿 heading 前进
  // ==========================================================================
  let x = state.x + Math.sin(heading) * speed * dt;
  let z = state.z + Math.cos(heading) * speed * dt;

  // ==========================================================================
  // 6. 护栏。没做真的碰撞体：横向偏移超出半宽就沿 toCenter 拉回来，顺便掉速。
  //    便宜、稳定，而且永远不会穿墙。
  //
  //    注意这里**不能**加 `ground.onTrack &&` 这个条件。碰撞几何总有个边界，
  //    而采样差一帧：满速斜着撞墙时，上一帧还在界内（不修正），这一帧位置已经出界，
  //    射线可能就打空了 —— 于是"没在赛道上"和"该被墙挡住"同时成立，加了条件就等于直接穿墙飞出去。
  //    实测过：34 m/s 斜撞护栏，横向偏移一路跑到 70m。
  //
  //    但也不能无条件生效，否则真的掉出去的车会被墙从半空吸回来。两道闸：
  //      - 已经在下落的车不管（那是真掉出去了，交给重生）
  //      - 超出量大于"一帧可能走过的距离"的不管（那不是撞墙，是被扔出去了）
  const overshoot = Math.abs(ground.lateral) - ground.halfWidth;
  const grabRange = Math.abs(speed) * dt * 1.5 + 0.5;
  const scraping = overshoot > 0 && overshoot < grabRange && !state.airborne;
  if (scraping) {
    x += ground.toCenterX * overshoot;
    z += ground.toCenterZ * overshoot;
    speed = moveToward(speed, 0, cfg.wallDecel * dt);
  }

  // ==========================================================================
  // 7. 贴地 / 下落 / 重生
  // ==========================================================================
  let y = state.y;
  let vy = state.vy;
  let fallTime = state.fallTime;
  // 被墙拉回来的那一帧，车其实已经回到路面上了，别当成掉出赛道
  const airborne = !ground.onTrack && !scraping;

  if (airborne) {
    fallTime += dt;
    // 掉太久就送回最近的样条点，位置/朝向/速度全部重来
    if (fallTime >= cfg.respawnDelay) {
      const fresh = createKartState(
        ground.respawnX,
        ground.respawnZ,
        ground.respawnHeading,
        ground.respawnY,
      );
      fresh.trackProgress = ground.progress;
      return fresh;
    }
    vy -= cfg.gravity * dt;
    y += vy * dt;
  } else {
    fallTime = 0;
    vy = 0;
    // 不瞬间吸附：按阻尼逼近接触点，过坎才有起伏感。
    // 射线打空但被墙拉回来的那一帧没有高度可用，保持原样，下一帧就有数据了
    if (ground.onTrack) {
      y = lerp(y, ground.height, 1 - Math.exp(-cfg.groundStickSmoothing * dt));
    }
  }

  // 地面法线也平滑一下，不然接缝处车身会抽搐。悬空时慢慢回正
  const nt = ground.onTrack || airborne ? 1 - Math.exp(-cfg.groundNormalSmoothing * dt) : 0;
  const [groundNormalX, groundNormalY, groundNormalZ] = normalize3(
    lerp(state.groundNormalX, airborne ? 0 : ground.normalX, nt),
    lerp(state.groundNormalY, airborne ? 1 : ground.normalY, nt),
    lerp(state.groundNormalZ, airborne ? 0 : ground.normalZ, nt),
  );

  return {
    x,
    z,
    y,
    heading,
    speed,
    steer,
    yawRate,
    driftPhase: phase,
    driftDir,
    driftCharge: charge,
    driftLevel: level,
    driftYawOffset,
    boostTime,
    boostLevel,
    vy,
    airborne,
    fallTime,
    groundNormalX,
    groundNormalY,
    groundNormalZ,
    trackProgress: ground.progress,
    lateralOffset: ground.lateral,
  };
}

/** 归一化，退化时回落到 +y（法线不能是零向量，否则车身姿态会 NaN）。 */
function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return [0, 1, 0];
  return [x / len, y / len, z / len];
}

// ============================================================================
// 事件
// ============================================================================

/**
 * 从前后两个 state 推导出来的事件，给特效/音效用。
 *
 * stepKart 是纯函数，没法自己往外发回调，所以事件做成"两个状态的差分"。
 * 主循环在**每个物理子步**之后调一次 diffKartEvents，就不会因为一帧跑了多步而漏事件。
 */
export type KartEvent =
  | { type: 'driftStart'; dir: -1 | 1 }
  | { type: 'driftLevelUp'; level: 1 | 2 | 3 }
  /** 漂移结束。level 是结束瞬间的档位，0 表示蓄力不足（掉速中断也是 0 奖励） */
  | { type: 'driftEnd'; level: ChargeLevel; boosted: boolean }
  | { type: 'boostStart'; level: 1 | 2 | 3 }
  | { type: 'boostEnd' };

const NO_EVENTS: readonly KartEvent[] = Object.freeze([]);

export function diffKartEvents(
  prev: Readonly<KartState>,
  next: Readonly<KartState>,
): readonly KartEvent[] {
  const wasDrifting = prev.driftPhase === 'drifting';
  const isDrifting = next.driftPhase === 'drifting';
  const boostStarted = next.boostTime > prev.boostTime && next.boostLevel > 0;
  const boostEnded = prev.boostTime > 0 && next.boostTime <= 0;
  const levelUp = isDrifting && wasDrifting && next.driftLevel > prev.driftLevel;

  if (!isDrifting && !wasDrifting && !boostStarted && !boostEnded) return NO_EVENTS;

  const events: KartEvent[] = [];
  if (!wasDrifting && isDrifting && next.driftDir !== 0) {
    events.push({ type: 'driftStart', dir: next.driftDir });
  }
  if (levelUp && next.driftLevel > 0) {
    events.push({ type: 'driftLevelUp', level: next.driftLevel as 1 | 2 | 3 });
  }
  if (wasDrifting && !isDrifting) {
    events.push({ type: 'driftEnd', level: prev.driftLevel, boosted: boostStarted });
  }
  if (boostStarted) {
    events.push({ type: 'boostStart', level: next.boostLevel as 1 | 2 | 3 });
  }
  if (boostEnded) events.push({ type: 'boostEnd' });
  return events.length === 0 ? NO_EVENTS : events;
}

/** 渲染插值用：在两个物理状态之间线性插值。heading 不归一化，所以可以直接 lerp。 */
export function lerpKartState(a: Readonly<KartState>, b: Readonly<KartState>, t: number): KartState {
  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    y: lerp(a.y, b.y, t),
    heading: lerp(a.heading, b.heading, t),
    speed: lerp(a.speed, b.speed, t),
    steer: lerp(a.steer, b.steer, t),
    yawRate: lerp(a.yawRate, b.yawRate, t),
    driftYawOffset: lerp(a.driftYawOffset, b.driftYawOffset, t),
    driftCharge: lerp(a.driftCharge, b.driftCharge, t),
    boostTime: lerp(a.boostTime, b.boostTime, t),
    vy: lerp(a.vy, b.vy, t),
    fallTime: lerp(a.fallTime, b.fallTime, t),
    groundNormalX: lerp(a.groundNormalX, b.groundNormalX, t),
    groundNormalY: lerp(a.groundNormalY, b.groundNormalY, t),
    groundNormalZ: lerp(a.groundNormalZ, b.groundNormalZ, t),
    lateralOffset: lerp(a.lateralOffset, b.lateralOffset, t),
    // 离散量不插值，取新的那一端
    driftPhase: b.driftPhase,
    driftDir: b.driftDir,
    driftLevel: b.driftLevel,
    boostLevel: b.boostLevel,
    airborne: b.airborne,
    // 进度在 1 -> 0 处有跳变，插值会把它拉回一整圈，直接取新值
    trackProgress: b.trackProgress,
  };
}
