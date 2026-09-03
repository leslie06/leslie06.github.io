/**
 * 一次地面探测的结果。
 *
 * kartStep 是纯函数，不许 import rapier / three，所以射线查询不能写在里面 ——
 * 由外层的 PhysicsSystem（rapier raycast + TrackSpline.getProgress）算好，
 * 每步作为参数喂进 stepKart。
 *
 * 这里全是裸数字，没有 Vector3，保持 kartStep 的纯数值边界。
 */
export interface GroundSample {
  /**
   * 射线有没有打到赛道。
   * false = 掉出赛道了（下方没有路面），kartStep 会进入下落状态并在 respawnDelay 后重生。
   */
  onTrack: boolean;
  /** 接触点高度（车轮着地的 y）。onTrack 为 false 时无意义 */
  height: number;

  /** 接触点的地面法线，单位向量 */
  normalX: number;
  normalY: number;
  normalZ: number;

  /** 采样点在赛道上的进度 0..1 */
  progress: number;
  /** 相对中心线的横向偏移，正 = 车手视角的右侧 */
  lateral: number;
  /** 可行驶半宽（路面 + 路肩）。|lateral| 超过它就算撞护栏 */
  halfWidth: number;
  /**
   * 从车指向中心线的水平单位方向。
   * 撞墙回推时直接沿它走，kartStep 就不需要知道中心线在哪。
   */
  toCenterX: number;
  toCenterZ: number;

  /** 重生点：最近的样条中心点 + 该处的赛道朝向 */
  respawnX: number;
  respawnY: number;
  respawnZ: number;
  respawnHeading: number;
}

/**
 * 无限大平地，永远在赛道上、没有护栏。
 * 测试和"还没加载出赛道"的那一帧用它，行为等价于加赛道之前的老版本。
 */
export const FLAT_GROUND: GroundSample = Object.freeze({
  onTrack: true,
  height: 0,
  normalX: 0,
  normalY: 1,
  normalZ: 0,
  progress: 0,
  lateral: 0,
  halfWidth: Infinity,
  toCenterX: 0,
  toCenterZ: 0,
  respawnX: 0,
  respawnY: 0,
  respawnZ: 0,
  respawnHeading: 0,
});
