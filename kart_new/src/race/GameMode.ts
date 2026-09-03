/**
 * 三种玩法。纯数据 —— 它决定的东西（有没有 AI、放不放幽灵车、算不算杯赛积分）
 * 全部表达成这张表里的字段，别处不许写 `if (mode === 'timeTrial')`。
 */
export type GameMode = 'single' | 'cup' | 'timeTrial';

export interface GameModeDef {
  id: GameMode;
  name: string;
  subtitle: string;
  /** 有没有 AI 对手 */
  ai: boolean;
  /** 放不放幽灵车（上一次最佳圈的回放） */
  ghost: boolean;
  /** 跑出更快的一圈时要不要覆盖幽灵车录像 */
  recordGhost: boolean;
  /** 成绩要不要计入杯赛积分 */
  cup: boolean;
  /**
   * 有没有道具。
   *
   * 计时赛关掉：吃到一个加速道具的那一圈会比正常快两秒，那种圈速当幽灵车
   * 或者纪录都没有意义 —— 计时赛比的是开得多干净，不是运气。
   */
  items: boolean;
}

export const GAME_MODES: Readonly<Record<GameMode, GameModeDef>> = Object.freeze({
  single: {
    id: 'single',
    name: '单场比赛',
    subtitle: '选一条赛道，和 AI 跑一局',
    ai: true,
    ghost: false,
    recordGhost: false,
    cup: false,
    items: true,
  },
  cup: {
    id: 'cup',
    name: '杯赛',
    subtitle: '连跑四条，积分决冠军',
    ai: true,
    ghost: false,
    recordGhost: false,
    cup: true,
    items: true,
  },
  timeTrial: {
    id: 'timeTrial',
    name: '计时赛',
    subtitle: '没有对手，只和自己的幽灵车比',
    ai: false,
    ghost: true,
    // 只有计时赛录幽灵：有 AI 的局里被撞一下就废掉一圈，
    // 那种圈速录下来当参照物没有意义
    recordGhost: true,
    cup: false,
    items: false,
  },
});

export const GAME_MODE_IDS: readonly GameMode[] = ['single', 'cup', 'timeTrial'] as const;

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && Object.hasOwn(GAME_MODES, value);
}
