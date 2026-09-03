/**
 * AI 需要的**最小**赛道视图。
 *
 * AIDriver 是纯逻辑（不许 import three / rapier），可它又必须知道"前面的路往哪拐"。
 * TrackSpline 是 three 的 CatmullRomCurve3 包出来的，不能直接进 AI 层，
 * 所以这里抽一个只有裸数字的接口：给一个进度 t，还一个中心线上的点 + 该处朝向。
 *
 * 真实实现见 SplineSampler.ts（对 TrackSpline 的适配器，只用 type-only import，
 * 所以它也不会把 three 拉进运行时依赖）；测试里则直接手写直线 / 圆形赛道。
 */

/** 中心线上的一个点。heading 与 KartState.heading 同约定（0 = +z，x = sin h, z = cos h）。 */
export interface AITrackPoint {
  x: number;
  z: number;
  heading: number;
}

export interface AITrack {
  /** 中心线总长（米）。把"往前看几米"换算成 Δt 用 */
  readonly length: number;
  /**
   * 采样中心线。
   * @param t 进度，允许越界，实现方自己折回 [0,1)
   * @param out 就地写入的结果对象 —— 每帧要调好几次，别让它产生垃圾
   */
  sampleAt(t: number, out: AITrackPoint): AITrackPoint;
}

export function createTrackPoint(): AITrackPoint {
  return { x: 0, z: 0, heading: 0 };
}

/** 把 t 折回 [0,1)。闭合赛道，越界就是绕圈。 */
export function wrap01(t: number): number {
  const r = t % 1;
  return r < 0 ? r + 1 : r;
}

/**
 * 把角度折回 (-π, π]。
 * 求"目标方向和车头差多少"必须先折 —— 不折的话 heading 跑过几圈之后差值会是几十弧度，
 * 乘上 steerGain 直接满舵乱打。
 */
export function wrapPi(angle: number): number {
  const a = (angle + Math.PI) % (2 * Math.PI);
  return (a < 0 ? a + 2 * Math.PI : a) - Math.PI;
}

/**
 * 把中心线上的点沿"车手视角右"方向平移 lateral 米（就地改 p）。
 * 每辆 AI 的 laneOffset 就是靠这个变成一条自己的走线。
 */
export function shiftLateral(p: AITrackPoint, lateral: number): AITrackPoint {
  if (lateral === 0) return p;
  const h = p.heading - Math.PI / 2;
  p.x += Math.sin(h) * lateral;
  p.z += Math.cos(h) * lateral;
  return p;
}
