/**
 * 所有道具的定义表。纯数据 + 纯函数，不 import three / rapier / DOM。
 *
 * ## 加一个新道具 = 往 ITEM_DEFS 里加一条
 *
 * 别处**不允许**再写 `switch (itemId)`。道具的一切差异都必须表达成表里的字段：
 * 作用对象是 targetType，效果是 apply() 返回的 ItemOutcome，出现概率是抽奖档位表。
 * ItemSystem 只认 ItemOutcome 的那几个字段，它压根不知道有 'lightning' 这个 id。
 *
 * ## 为什么 apply 返回的不是单个 Effect
 *
 * 需求里写的是 `apply(context): Effect`，但投射物和陷阱不是"挂在车上的状态"，
 * 它们是世界里的实体，用 Effect 表达不了。所以这里返回一个更宽的
 * ItemOutcome：既能描述"给谁挂什么效果"，也能描述"生成什么实体"。
 * 字段全是可选的，只挂效果的道具照样只填一个字段。
 */
import { effect, type Effect } from './EffectSystem';
import { weightedPick, type Rng } from './rng';

export type ItemId = 'boost' | 'projectile' | 'shield' | 'trap' | 'lightning';

/** 稀有度只影响展示（HUD 边框）和平衡表的可读性，不参与任何判定 */
export type ItemRarity = 'common' | 'uncommon' | 'rare';

/**
 * 道具作用于谁。ItemSystem 按这个字段挑目标，不看 id。
 *   self       只作用于自己
 *   forward    前方最近的一辆车（投射物去追它）
 *   backward   身后最近的一辆车
 *   allOthers  除自己以外所有车
 */
export type ItemTargetType = 'self' | 'forward' | 'backward' | 'allOthers';

export interface ItemUseContext {
  /** 用道具的车 */
  userId: string;
  /** 用道具那一刻的位置和朝向 */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** 用道具那一刻它在赛道上的进度 0..1 */
  trackT: number;
  /** 名次，1 = 第一名 */
  place: number;
  /** 场上总车数 */
  racerCount: number;
}

/** 生成一枚投射物的参数。具体飞行由 Projectile.ts 负责 */
export interface ProjectileSpawn {
  /** 初速度 m/s */
  speed: number;
  /** 最长存活时间（秒），超时自毁，防止绕着赛道飞一辈子 */
  life: number;
  /** 命中半径（米） */
  radius: number;
  /** 会不会追踪目标 */
  homing: boolean;
  /** 命中后给对方挂的效果 */
  onHit: Effect[];
}

/** 在使用者身后放一个地面陷阱 */
export interface TrapSpawn {
  radius: number;
  /** 存活时间（秒） */
  life: number;
  /** 放下之后多久才生效（对所有人）。 */
  armDelay: number;
  /**
   * 往车**后方**放多少米。
   *
   * 放在车当前位置是不行的：低速时车还在半径里，armDelay 一过就把自己炸了
   * （实测：站着丢雷，0.6 秒后自己失控）。真车游戏里香蕉皮也是往身后扔的。
   */
  dropBack: number;
  /**
   * 放下之后这段时间内不炸放的人。
   *
   * 光靠 dropBack 不够：倒车或者被撞回去都会立刻踩到自己刚放的雷。
   * 但也不能给放的人永久免疫 —— 那样绕回来站在自己雷上就无敌了。
   */
  ownerGrace: number;
  onHit: Effect[];
}

/**
 * "用了这个道具会发生什么"的描述。ItemSystem 拿着它去执行，
 * 执行过程里不需要知道是哪个道具产生的。
 */
export interface ItemOutcome {
  /** 挂给使用者自己 */
  selfEffects?: Effect[];
  /**
   * 挂给 targetType 选中的目标。
   * self 类型下等价于 selfEffects；forward/backward 类型如果同时生成了投射物，
   * 就交给投射物命中时再挂（免得没打中也生效）
   */
  targetEffects?: Effect[];
  /** 直接给自己的 boost：复用漂移 mini-turbo 那套状态，见 ItemSystem */
  grantBoost?: { level: 1 | 2 | 3; duration: number };
  spawnProjectile?: ProjectileSpawn;
  spawnTrap?: TrapSpawn;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  rarity: ItemRarity;
  targetType: ItemTargetType;
  /** HUD 上的占位方块颜色 */
  color: string;
  /** HUD 上的占位符号 */
  icon: string;
  /** 攻击类道具。AI 用它判断"前面没车就先攥着"，也不看 id */
  offensive: boolean;
  apply(ctx: Readonly<ItemUseContext>, rng: Rng): ItemOutcome;
}

// ============================================================================
// 道具表
// ============================================================================

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  boost: {
    id: 'boost',
    name: '加速',
    rarity: 'common',
    targetType: 'self',
    color: '#ffb020',
    icon: '»',
    offensive: false,
    // 直接复用漂移的三档 mini-turbo：给一个三档 boost。
    // 这样速度线、镜头推近、超速平滑回落全都是现成的，一行新逻辑都不用写
    apply: () => ({ grantBoost: { level: 3, duration: 1.6 } }),
  },

  projectile: {
    id: 'projectile',
    name: '飞弹',
    rarity: 'common',
    targetType: 'forward',
    color: '#3fc4ff',
    icon: '●',
    offensive: true,
    apply: () => ({
      spawnProjectile: {
        speed: 52,
        life: 5,
        radius: 2.2,
        homing: true,
        onHit: [effect('spinout', 1.5, 0.65)],
      },
    }),
  },

  shield: {
    id: 'shield',
    name: '护盾',
    rarity: 'common',
    targetType: 'self',
    color: '#7cf7c4',
    icon: '◇',
    offensive: false,
    apply: () => ({ selfEffects: [effect('shield', 8)] }),
  },

  trap: {
    id: 'trap',
    name: '地雷',
    rarity: 'common',
    targetType: 'self',
    color: '#ff5fa2',
    icon: '▲',
    offensive: true,
    apply: () => ({
      spawnTrap: {
        radius: 2.4,
        life: 25,
        armDelay: 0.6,
        dropBack: 4.5,
        ownerGrace: 2.5,
        onHit: [effect('spinout', 1.2, 0.6)],
      },
    }),
  },

  lightning: {
    id: 'lightning',
    name: '闪电',
    rarity: 'rare',
    targetType: 'allOthers',
    color: '#e8d64a',
    icon: '⚡',
    offensive: true,
    apply: () => ({ targetEffects: [effect('slow', 3.5, 0.45)] }),
  },
};

export const ITEM_IDS = Object.keys(ITEM_DEFS) as ItemId[];
export const ITEM_LIST: readonly ItemDef[] = ITEM_IDS.map((id) => ITEM_DEFS[id]);

// ============================================================================
// 名次加权抽奖
// ============================================================================

/**
 * 抽奖档位。
 *
 * 按**名次占比**分档而不是绝对名次：`(place - 1) / (racerCount - 1)`，
 * 0 = 第一名，1 = 最后一名。这样 4 人局和 8 人局共用一张表，
 * 改车数不用重新配平衡。
 */
export interface LotteryTier {
  /** 档位名，看表用 */
  label: string;
  /** 名次占比上界（含）。0 那一档只有第一名 */
  maxPlaceRatio: number;
  /** 权重表，不用归一化。没列出来的道具权重为 0 */
  weights: Partial<Record<ItemId, number>>;
}

/**
 * 越靠前抽到的东西越弱，越靠后越强。这是整套系统的平衡开关，调这里就行。
 *
 * 第一名只能拿到防守/布防的东西（护盾、地雷），拿不到闪电和飞弹；
 * 末位大概率拿到闪电和加速。中间几档平滑过渡。
 */
export const ITEM_LOTTERY_TIERS: readonly LotteryTier[] = [
  {
    label: '领跑',
    maxPlaceRatio: 0.0,
    weights: { shield: 50, trap: 45, boost: 5 },
  },
  {
    label: '前段',
    maxPlaceRatio: 0.34,
    weights: { shield: 34, trap: 34, boost: 20, projectile: 12 },
  },
  {
    label: '中段',
    maxPlaceRatio: 0.67,
    weights: { shield: 18, trap: 20, boost: 26, projectile: 32, lightning: 4 },
  },
  {
    label: '后段',
    maxPlaceRatio: 0.99,
    weights: { shield: 8, trap: 8, boost: 34, projectile: 34, lightning: 16 },
  },
  {
    label: '末位',
    maxPlaceRatio: 1.0,
    weights: { shield: 4, trap: 4, boost: 34, projectile: 28, lightning: 30 },
  },
];

/**
 * 名次 -> 档位。
 * @param place 1 = 第一名
 */
export function lotteryTierOf(place: number, racerCount: number): LotteryTier {
  const last = ITEM_LOTTERY_TIERS[ITEM_LOTTERY_TIERS.length - 1]!;
  // 只有一辆车时名次占比是 0/0。它既是第一也是最后，按**第一名**算 ——
  // 这样"领跑的抽不到强道具"就是一条无条件成立的性质，不用到处写例外
  if (racerCount <= 1) return ITEM_LOTTERY_TIERS[0]!;
  const clamped = Math.min(Math.max(place, 1), racerCount);
  const ratio = (clamped - 1) / (racerCount - 1);
  for (const tier of ITEM_LOTTERY_TIERS) {
    if (ratio <= tier.maxPlaceRatio + 1e-9) return tier;
  }
  return last;
}

/** 某个名次下各道具的归一化概率。给测试和调试面板看的 */
export function lotteryChances(place: number, racerCount: number): Record<ItemId, number> {
  const { weights } = lotteryTierOf(place, racerCount);
  let total = 0;
  for (const id of ITEM_IDS) total += weights[id] ?? 0;
  const out = {} as Record<ItemId, number>;
  for (const id of ITEM_IDS) out[id] = total > 0 ? (weights[id] ?? 0) / total : 0;
  return out;
}

/**
 * 抽一个道具。
 *
 * @param place 1 = 第一名
 * @param rng   注入的随机源。测试里换个种子就能覆盖不同分支，整局也能复现
 */
export function rollItem(place: number, racerCount: number, rng: Rng): ItemId {
  const { weights } = lotteryTierOf(place, racerCount);
  const entries = ITEM_IDS.map((id) => [id, weights[id] ?? 0] as const);
  // 权重表配错（全 0）时不该让抽奖直接崩掉，兜个最弱的
  return weightedPick(entries, rng) ?? 'shield';
}
