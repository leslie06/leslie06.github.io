/**
 * 确定性伪随机数。
 *
 * 道具系统有两处必须随机：抽奖、AI 用道具的反应延迟。但这个项目里所有模拟逻辑
 * 都是确定性的（kartStep 的注释里写死了"没有随机数，同样的输入永远得到同样的输出"），
 * 直接用 Math.random 会让整局比赛不可复现，出了问题也没法回放。
 *
 * 所以这里用一个自带种子的 mulberry32：每个用到随机的对象持有自己的一份，
 * 种子固定 -> 整局可复现；测试里换个种子就能跑不同的分支。
 */
export interface Rng {
  /** [0, 1) */
  next(): number;
}

/** mulberry32。够快、分布够均匀，32 位状态，实现只有几行。 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** [lo, hi) 之间的实数 */
export function rangeOf(rng: Rng, lo: number, hi: number): number {
  return lo + rng.next() * (hi - lo);
}

/**
 * 从一张权重表里抽一个。权重可以不归一化。
 * 全是 0 或表为空时返回 null —— 调用方自己决定兜底。
 */
export function weightedPick<T>(entries: readonly (readonly [T, number])[], rng: Rng): T | null {
  let total = 0;
  for (const [, w] of entries) if (w > 0) total += w;
  if (total <= 0) return null;

  let r = rng.next() * total;
  for (const [value, w] of entries) {
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return value;
  }
  // 浮点误差兜底：回退到最后一个有效权重
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]![1] > 0) return entries[i]![0];
  }
  return null;
}
