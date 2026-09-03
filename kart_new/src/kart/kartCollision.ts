/**
 * 车与车的碰撞。纯逻辑，不 import three / rapier。
 *
 * 故意**不**接物理引擎的刚体：这套里车没有刚体（见 PhysicsSystem 的说明），
 * 车的运动全在 kartStep 那个运动学纯函数里。硬塞一个 rapier 的动态刚体进来，
 * 就会出现"运动学积分和刚体求解器互相打架"的经典问题 —— 车会抖、会互相穿模、
 * 会被推得原地打转，而且 kartStep 的确定性也没了。
 *
 * 所以这里就是最朴素的圆盘分离：两车水平距离小于两倍半径时，
 * 沿连线把它们各推开一半重叠量，并各自轻微掉速。稳定、便宜、可单测。
 */
import type { KartState } from './kartStep';

export interface KartCollisionConfig {
  /** 每辆车的水平碰撞半径（米）。车宽 ~1.8，取 1.1 让车身之间还留一点缝 */
  radius: number;
  /** 每秒消化掉多少比例的重叠量。不要一帧推到底，那样两车会互相弹开 */
  pushRate: number;
  /** 接触期间的减速度（m/s²）。撞一下会掉点速，但别掉到停 */
  contactDecel: number;
  /** 高度差超过这个就不算碰撞 —— 立体交叉的上下两层路不该互相推 */
  maxHeightDiff: number;
}

export const DEFAULT_KART_COLLISION_CONFIG: KartCollisionConfig = {
  radius: 1.1,
  pushRate: 14,
  contactDecel: 7,
  maxHeightDiff: 2.5,
};

/** GUI 滑条范围，和 KART_CONFIG_RANGES 同一套写法 */
export const KART_COLLISION_RANGES: Record<keyof KartCollisionConfig, [number, number, number]> = {
  radius: [0.4, 3, 0.05],
  pushRate: [1, 60, 0.5],
  contactDecel: [0, 40, 0.5],
  maxHeightDiff: [0.5, 10, 0.1],
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 把 value 朝 0 拉近 maxDelta，不会越过 0。 */
function decay(value: number, maxDelta: number): number {
  if (Math.abs(value) <= maxDelta) return 0;
  return value - Math.sign(value) * maxDelta;
}

/**
 * 就地解一遍所有车之间的重叠。车很少（<16），O(n²) 无所谓。
 *
 * 会改写传入 state 的 x / z / speed，其余字段不动 —— 尤其**不改 heading**：
 * 被撞一下就转向的话，玩家会觉得车"被抢了方向盘"，很难受。
 *
 * @returns 这一帧发生接触的车对数（给音效 / 调试面板用）
 */
export function resolveKartCollisions(
  states: readonly KartState[],
  cfg: Readonly<KartCollisionConfig> = DEFAULT_KART_COLLISION_CONFIG,
  dt: number,
): number {
  if (dt <= 0 || states.length < 2) return 0;

  const minDist = cfg.radius * 2;
  // 一帧最多消化掉这个比例的重叠，剩下的下一帧继续 —— 分几帧推开才不会"弹"
  const k = clamp01(cfg.pushRate * dt);
  let contacts = 0;

  for (let i = 0; i < states.length; i++) {
    const a = states[i]!;
    for (let j = i + 1; j < states.length; j++) {
      const b = states[j]!;
      if (Math.abs(a.y - b.y) > cfg.maxHeightDiff) continue;

      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let dist = Math.hypot(dx, dz);
      if (dist >= minDist) continue;

      // 完全重合（同一帧重生到同一点）时连线方向没定义，
      // 按序号选一个固定方向掰开，保证确定性
      if (dist < 1e-4) {
        dx = i % 2 === 0 ? 1 : -1;
        dz = 0;
        dist = 1;
      }
      const nx = dx / dist;
      const nz = dz / dist;
      const push = ((minDist - dist) * 0.5) * k;

      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;

      const loss = cfg.contactDecel * dt;
      a.speed = decay(a.speed, loss);
      b.speed = decay(b.speed, loss);
      contacts++;
    }
  }
  return contacts;
}
