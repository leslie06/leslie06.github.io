/**
 * 难度档位。纯数据，不 import three / rapier。
 *
 * 三档的差异只落在四个地方（其余一切都和玩家共用）：
 *   1. lookAheadDistance —— 看得越远走线越圆、进弯越早，也就越稳
 *   2. 橡皮筋强度 —— easy 的 AI 领先时会明显等你，hard 几乎不等
 *   3. maxSpeed 基准倍率 —— 直接决定直线段拉不拉得开
 *   4. 会不会用漂移蓄力 —— easy 不会，所以出弯没有 mini-turbo
 */
import type { AIDriverConfig } from './AIDriver';
import type { RubberbandConfig } from './Rubberband';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export const AI_DIFFICULTIES: readonly AIDifficulty[] = ['easy', 'normal', 'hard'];

export interface AIProfile {
  /** 乘在 KartConfig.maxSpeed 上的基准倍率（橡皮筋倍率还会再乘一次） */
  speedMul: number;
  /** 覆盖 DEFAULT_AI_DRIVER_CONFIG 的部分 */
  driver: Partial<AIDriverConfig>;
  rubberband: RubberbandConfig;
}

export const AI_PROFILES: Record<AIDifficulty, AIProfile> = {
  easy: {
    speedMul: 0.85,
    driver: {
      lookAheadDistance: 13,
      lookAheadPerSpeed: 0.28,
      steerGain: 1.6,
      liftAngle: 0.16,
      fullLiftAngle: 0.6,
      minThrottle: 0.42,
      brakeAngle: 0.85,
      useDrift: false,
    },
    rubberband: {
      behindRange: 0.1,
      aheadRange: 0.05,
      maxMultiplier: 1.15,
      minMultiplier: 0.85,
      smoothing: 0.7,
    },
  },
  normal: {
    speedMul: 0.94,
    driver: {
      lookAheadDistance: 18,
      lookAheadPerSpeed: 0.34,
      steerGain: 2.0,
      liftAngle: 0.22,
      fullLiftAngle: 0.72,
      minThrottle: 0.55,
      brakeAngle: 1.0,
      useDrift: true,
      driftAngleThreshold: 0.42,
    },
    rubberband: {
      behindRange: 0.09,
      aheadRange: 0.07,
      maxMultiplier: 1.1,
      minMultiplier: 0.9,
      smoothing: 0.8,
    },
  },
  hard: {
    speedMul: 1.0,
    driver: {
      lookAheadDistance: 23,
      lookAheadPerSpeed: 0.4,
      steerGain: 2.3,
      liftAngle: 0.3,
      fullLiftAngle: 0.85,
      minThrottle: 0.7,
      brakeAngle: 1.15,
      useDrift: true,
      driftAngleThreshold: 0.34,
      driftMinHold: 0.7,
    },
    rubberband: {
      behindRange: 0.08,
      aheadRange: 0.09,
      maxMultiplier: 1.06,
      minMultiplier: 0.96,
      smoothing: 1.0,
    },
  },
};

/**
 * 每辆 AI 的"个性"。同一难度下也不该所有车走同一条线、跑同一个极速，
 * 不然它们会挤成一坨、而且永远不会互相超车。
 *
 * 全部按序号查表，**不用随机数** —— 和 kartStep 一样保持确定性，重开一局阵容完全一致。
 */
export interface AIPersona {
  name: string;
  /** 走线相对中心线的横向偏移（米，正 = 右） */
  laneOffset: number;
  /**
   * 这辆车"想待在玩家前面/后面多少"（totalProgress 单位，正 = 想领先）。
   *
   * 橡皮筋算的是"和玩家的差距"，如果所有 AI 的目标差距都是 0，它们会一起收敛到
   * 玩家的速度、挤成一坨互相刮着走（实测：八辆车整局下来平均每帧都有 0.8 对在接触）。
   * 给每辆车一个不同的目标差距，队形就自然拉成一串：
   * 前面几辆想跑在你前头，后面几辆在你身后徘徊，中间那几辆正好在你旁边缠斗。
   */
  targetGap: number;
  /** 在难度基准倍率之上的个体差异 */
  speedMul: number;
  /** 车身配色 */
  color: string;
  /** 座舱 / 头盔的辅助色 */
  accent: string;
}

/**
 * 7 个对手够填满一个 8 人发车格。数组顺序 = 发车格顺序（0 号在最前）。
 *
 * laneOffset 控制在 ±6.5m 内（赛道可行驶半宽 ~10.9m），而且**相邻两条走线至少差 1.5m** ——
 * 碰撞直径是 2.2m，走线挨得比这还近的话，两辆车一旦并排就会永久互相顶着，
 * 双方都在持续掉速，看起来像卡住了。
 */
export const AI_PERSONAS: readonly AIPersona[] = [
  { name: '蓝闪', laneOffset: -5.0, targetGap: 0.06, speedMul: 1.02, color: '#2f6fed', accent: '#8fd0ff' },
  { name: '青柠', laneOffset: 5.0, targetGap: 0.04, speedMul: 0.99, color: '#39c46a', accent: '#eaff9b' },
  { name: '橘子', laneOffset: -2.5, targetGap: 0.02, speedMul: 1.01, color: '#ff8c1a', accent: '#ffd9a3' },
  { name: '紫电', laneOffset: 2.5, targetGap: 0.0, speedMul: 0.98, color: '#9b5cf6', accent: '#e2ccff' },
  { name: '雪白', laneOffset: -6.5, targetGap: -0.02, speedMul: 1.0, color: '#e8e8ee', accent: '#9aa3b2' },
  { name: '墨黑', laneOffset: 6.5, targetGap: -0.04, speedMul: 1.0, color: '#3a3f4b', accent: '#ffd34d' },
  { name: '粉桃', laneOffset: 0, targetGap: -0.06, speedMul: 0.97, color: '#ff5fa2', accent: '#ffd7e8' },
];

export const MAX_AI_COUNT = AI_PERSONAS.length;

export function personaAt(index: number): AIPersona {
  return AI_PERSONAS[index % AI_PERSONAS.length]!;
}
