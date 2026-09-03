/**
 * 投射物。纯逻辑，不 import three / rapier，也不碰物理引擎。
 *
 * 就是直线飞行 + 球形碰撞：每帧沿 heading 推进，然后和所有车做一次距离判定。
 * 不用 rapier 的理由和车车碰撞一样（见 kartCollision.ts）——
 * 这套里没有任何刚体，塞一个进来只会和运动学积分打架。
 *
 * ## 追踪
 *
 * 直着飞的话在弯道里必然打空：赛道是弯的，目标车 3 秒后根本不在直线上。
 * 所以 homing 的投射物用**赛道样条**当导轨：
 *   1. 基础朝向 = 前方一小段样条的切线（保证它贴着赛道走，不会飞进护栏）
 *   2. 锁定了目标就再往目标方向偏一点（保证它最后能咬上去）
 * 每帧朝这个目标朝向转，转速有上限（turnRate），所以不会瞬移式贴脸，
 * 被追的人还有横向拉开距离甩掉它的余地。
 */
import type { AITrack, AITrackPoint } from '../ai/AITrack';
import { createTrackPoint, wrap01, wrapPi } from '../ai/AITrack';
import type { Effect } from './EffectSystem';

export interface ProjectileConfig {
  /** 每帧最多转多少（rad/s）。太大就成了必中，太小在急弯里会撞墙 */
  turnRate: number;
  /** 沿样条往前看多少米取导轨方向 */
  lookAhead: number;
  /** 目标偏出这个角度就放弃锁定（它已经不在前面了） */
  maxLockAngle: number;
  /** 锁定目标时，目标方向相对样条方向的权重 0..1 */
  homingWeight: number;
  /** 飞行高度：从车身中心往上抬多少。太低会被车壳挡住看不见 */
  hoverHeight: number;
}

export const DEFAULT_PROJECTILE_CONFIG: ProjectileConfig = {
  turnRate: 2.4,
  lookAhead: 14,
  maxLockAngle: 1.4,
  homingWeight: 0.62,
  hoverHeight: 0.95,
};

/** GUI 滑条范围 */
export const PROJECTILE_RANGES: Record<keyof ProjectileConfig, [number, number, number]> = {
  turnRate: [0.2, 10, 0.05],
  lookAhead: [2, 50, 0.5],
  maxLockAngle: [0.2, 3.14, 0.02],
  homingWeight: [0, 1, 0.01],
  hoverHeight: [0, 3, 0.05],
};

export interface Projectile {
  /** 场上唯一 id，渲染层按它复用 mesh */
  id: number;
  /** 谁放的。飞出去之后不会打到自己 */
  ownerId: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** 剩余存活时间（秒） */
  life: number;
  radius: number;
  homing: boolean;
  /** 锁定的目标车 id，没锁定就是 null */
  targetId: string | null;
  /** 命中时给对方挂的效果 */
  onHit: readonly Effect[];
}

/** 碰撞判定要的最小车辆信息 */
export interface ProjectileTarget {
  id: string;
  x: number;
  y: number;
  z: number;
  /** 赛道进度，选目标时用来判断谁在前面 */
  trackT: number;
}

export type ProjectileOutcome =
  /** 还在飞 */
  | { kind: 'alive' }
  /** 打到人了 */
  | { kind: 'hit'; targetId: string }
  /** 超时自毁 */
  | { kind: 'expired' };

/** 车身当成一个球，半径按车宽给。和 kartCollision 的 radius 是同一个量级 */
const KART_RADIUS = 1.2;
/** 高度差超过这个不算命中：立体交叉的上下两层路不该互相打到 */
const MAX_HEIGHT_DIFF = 3;

/**
 * 挑一个锁定目标：**前方**最近的一辆车。
 *
 * "前方"按赛道进度算而不是按世界坐标 —— 弯道里世界坐标上的"最近"很可能是
 * 对面直道上的车，那不是能打到的目标。
 *
 * @param fromT 投射物（发射瞬间是发射者）所在的赛道进度
 * @param maxGap 最多往前找多远（赛道进度单位，0.25 = 四分之一圈）
 */
export function pickForwardTarget(
  fromT: number,
  ownerId: string,
  targets: readonly ProjectileTarget[],
  maxGap = 0.25,
): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  for (const t of targets) {
    if (t.id === ownerId) continue;
    // 折回 [0,1)：目标可能已经过了终点线而自己还没过
    const gap = wrap01(t.trackT - fromT);
    if (gap <= 0 || gap > maxGap) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = t.id;
    }
  }
  return best;
}

/** 反过来找身后最近的一辆，'backward' 类型的道具用 */
export function pickBackwardTarget(
  fromT: number,
  ownerId: string,
  targets: readonly ProjectileTarget[],
  maxGap = 0.25,
): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  for (const t of targets) {
    if (t.id === ownerId) continue;
    const gap = wrap01(fromT - t.trackT);
    if (gap <= 0 || gap > maxGap) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = t.id;
    }
  }
  return best;
}

const _point: AITrackPoint = createTrackPoint();

/**
 * 推进一枚投射物一帧（就地改 p）。
 *
 * @param trackT 投射物当前所在的赛道进度。由调用方查（这里不许 import 样条实现）
 * @returns 这一帧的结局。'hit' / 'expired' 都意味着调用方该把它销毁
 */
export function stepProjectile(
  p: Projectile,
  trackT: number,
  track: AITrack,
  targets: readonly ProjectileTarget[],
  cfg: Readonly<ProjectileConfig>,
  dt: number,
): ProjectileOutcome {
  if (dt <= 0) return { kind: 'alive' };

  p.life -= dt;
  if (p.life <= 0) return { kind: 'expired' };

  if (p.homing) {
    // 1. 导轨方向：前方一小段样条的切线
    const aheadT = wrap01(trackT + cfg.lookAhead / Math.max(track.length, 1e-6));
    const guide = track.sampleAt(aheadT, _point);
    let desired = Math.atan2(guide.x - p.x, guide.z - p.z);

    // 2. 锁定的目标还在前面的话，往它那边再偏一点
    const target = p.targetId ? targets.find((t) => t.id === p.targetId) : undefined;
    if (target) {
      const toTarget = Math.atan2(target.x - p.x, target.z - p.z);
      const off = wrapPi(toTarget - desired);
      if (Math.abs(off) <= cfg.maxLockAngle) {
        desired = desired + off * cfg.homingWeight;
      } else {
        // 目标已经甩到侧后方了，放弃锁定，接着沿赛道飞，说不定还能撞上别人
        p.targetId = null;
      }
    }

    const diff = wrapPi(desired - p.heading);
    const maxTurn = cfg.turnRate * dt;
    p.heading += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
  }

  p.x += Math.sin(p.heading) * p.speed * dt;
  p.z += Math.cos(p.heading) * p.speed * dt;

  // 3. 碰撞：球对球。不打发射者自己
  const hitDist = p.radius + KART_RADIUS;
  for (const t of targets) {
    if (t.id === p.ownerId) continue;
    if (Math.abs(t.y - p.y) > MAX_HEIGHT_DIFF) continue;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    if (dx * dx + dz * dz <= hitDist * hitDist) return { kind: 'hit', targetId: t.id };
  }
  return { kind: 'alive' };
}

// ============================================================================
// 陷阱
// ============================================================================

/**
 * 地面陷阱。没有飞行逻辑，就是一个"到点生效的圆"。
 * 和投射物放在一起是因为它俩的命中判定是同一套。
 */
export interface Trap {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  life: number;
  /** 还有多久生效。> 0 时谁都碾不到 */
  armDelay: number;
  /** 还有多久开始能炸放的人。> 0 时只对别人生效 */
  ownerGrace: number;
  onHit: readonly Effect[];
}

export interface TrapOutcome {
  /** 这一帧碾到它的车。没有就是 null */
  hitId: string | null;
  /** 该销毁了（被碾到或者过期） */
  done: boolean;
}

/**
 * 推进一个陷阱一帧（就地改 trap）。
 *
 * 两道自伤保护：armDelay 之内对谁都不生效；ownerGrace 之内不炸放的人。
 * grace 过了之后**放的人自己也会踩** —— 不然掉头回来站在自己雷上就无敌了。
 */
export function stepTrap(
  trap: Trap,
  targets: readonly ProjectileTarget[],
  dt: number,
): TrapOutcome {
  if (dt <= 0) return { hitId: null, done: false };

  trap.life -= dt;
  if (trap.life <= 0) return { hitId: null, done: true };

  if (trap.ownerGrace > 0) trap.ownerGrace -= dt;

  if (trap.armDelay > 0) {
    trap.armDelay -= dt;
    return { hitId: null, done: false };
  }

  const hitDist = trap.radius + KART_RADIUS;
  for (const t of targets) {
    if (t.id === trap.ownerId && trap.ownerGrace > 0) continue;
    if (Math.abs(t.y - trap.y) > MAX_HEIGHT_DIFF) continue;
    const dx = t.x - trap.x;
    const dz = t.z - trap.z;
    if (dx * dx + dz * dz <= hitDist * hitDist) return { hitId: t.id, done: true };
  }
  return { hitId: null, done: false };
}
