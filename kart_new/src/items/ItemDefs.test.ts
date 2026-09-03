import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  ITEM_IDS,
  ITEM_LIST,
  ITEM_LOTTERY_TIERS,
  lotteryChances,
  lotteryTierOf,
  rollItem,
  type ItemId,
} from './ItemDefs';
import { createRng } from './rng';

/** 在某个名次上抽 n 次，返回各道具的实测频率 */
function sample(place: number, racerCount: number, n = 200_000, seed = 12345) {
  const rng = createRng(seed);
  const counts = {} as Record<ItemId, number>;
  for (const id of ITEM_IDS) counts[id] = 0;
  for (let i = 0; i < n; i++) counts[rollItem(place, racerCount, rng)]++;
  const freq = {} as Record<ItemId, number>;
  for (const id of ITEM_IDS) freq[id] = counts[id] / n;
  return freq;
}

describe('道具表', () => {
  it('每条定义的 id 和键名一致', () => {
    for (const id of ITEM_IDS) expect(ITEM_DEFS[id].id).toBe(id);
    expect(ITEM_LIST).toHaveLength(ITEM_IDS.length);
  });

  it('五个道具都在表里，targetType 覆盖到了各种情况', () => {
    expect(new Set(ITEM_IDS)).toEqual(
      new Set(['boost', 'projectile', 'shield', 'trap', 'lightning']),
    );
    expect(ITEM_DEFS.boost.targetType).toBe('self');
    expect(ITEM_DEFS.shield.targetType).toBe('self');
    expect(ITEM_DEFS.projectile.targetType).toBe('forward');
    expect(ITEM_DEFS.lightning.targetType).toBe('allOthers');
  });

  it('apply() 是纯的：同样的输入给出同样的结果', () => {
    const ctx = {
      userId: 'p', x: 1, y: 0, z: 2, heading: 0.3, trackT: 0.4, place: 3, racerCount: 8,
    };
    const rng = createRng(1);
    for (const def of ITEM_LIST) {
      expect(def.apply(ctx, rng)).toEqual(def.apply(ctx, createRng(1)));
    }
  });

  it('每个道具的 apply() 至少产生一件事', () => {
    const ctx = {
      userId: 'p', x: 0, y: 0, z: 0, heading: 0, trackT: 0, place: 1, racerCount: 8,
    };
    for (const def of ITEM_LIST) {
      const o = def.apply(ctx, createRng(7));
      const any =
        o.grantBoost || o.selfEffects?.length || o.targetEffects?.length ||
        o.spawnProjectile || o.spawnTrap;
      expect(any, `${def.id} 什么都没做`).toBeTruthy();
    }
  });
});

describe('名次分档', () => {
  it('第一名落在"领跑"档，末位落在"末位"档', () => {
    expect(lotteryTierOf(1, 8).label).toBe('领跑');
    expect(lotteryTierOf(8, 8).label).toBe('末位');
  });

  it('按名次占比分档，所以换车数不用重配表', () => {
    // 占比相同的名次必须落在同一档。(place-1)/(count-1) 相等的整数对：
    // 4 人局的第 1/4 名 <-> 8 人局的第 1/8 名
    expect(lotteryTierOf(1, 4).label).toBe(lotteryTierOf(1, 8).label);
    expect(lotteryTierOf(4, 4).label).toBe(lotteryTierOf(8, 8).label);
    // 16 人局第 8 名 (7/15=0.467) 和 8 人局第 4 名 (3/7=0.429) 同属中段
    expect(lotteryTierOf(8, 16).label).toBe(lotteryTierOf(4, 8).label);
  });

  it('档位随名次单调后移，不会来回跳', () => {
    const indexOf = (place: number, count: number) =>
      ITEM_LOTTERY_TIERS.indexOf(lotteryTierOf(place, count));
    for (const count of [4, 8, 12]) {
      let prev = -1;
      for (let place = 1; place <= count; place++) {
        const i = indexOf(place, count);
        expect(i).toBeGreaterThanOrEqual(prev);
        prev = i;
      }
    }
  });

  it('名次越界也能给出一个合法档位', () => {
    expect(lotteryTierOf(0, 8)).toBe(lotteryTierOf(1, 8));
    expect(lotteryTierOf(99, 8)).toBe(lotteryTierOf(8, 8));
    expect(lotteryTierOf(1, 1).label).toBe('领跑'); // 单人局既是第一也是最后，按第一名算
  });

  it('每一档的权重都是非负的，而且至少有一项 > 0', () => {
    for (const tier of ITEM_LOTTERY_TIERS) {
      let total = 0;
      for (const id of ITEM_IDS) {
        const w = tier.weights[id] ?? 0;
        expect(w).toBeGreaterThanOrEqual(0);
        total += w;
      }
      expect(total, `${tier.label} 权重全是 0`).toBeGreaterThan(0);
    }
  });

  it('档位上界是递增的，最后一档覆盖到 1', () => {
    for (let i = 1; i < ITEM_LOTTERY_TIERS.length; i++) {
      expect(ITEM_LOTTERY_TIERS[i]!.maxPlaceRatio).toBeGreaterThan(
        ITEM_LOTTERY_TIERS[i - 1]!.maxPlaceRatio,
      );
    }
    expect(ITEM_LOTTERY_TIERS[ITEM_LOTTERY_TIERS.length - 1]!.maxPlaceRatio).toBe(1);
  });

  it('各档概率都归一化到 1', () => {
    for (let place = 1; place <= 8; place++) {
      const chances = lotteryChances(place, 8);
      const sum = ITEM_IDS.reduce((acc, id) => acc + chances[id], 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });
});

describe('抽奖的期望分布', () => {
  it('实测频率和权重表算出来的概率一致（各名次都测）', () => {
    for (let place = 1; place <= 8; place++) {
      const expected = lotteryChances(place, 8);
      const actual = sample(place, 8);
      for (const id of ITEM_IDS) {
        // 20 万次采样，3 个标准差大概是 0.003 量级，留到 0.01 稳
        expect(
          Math.abs(actual[id] - expected[id]),
          `place=${place} item=${id} 期望 ${expected[id]} 实测 ${actual[id]}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it('权重为 0 的道具一次都抽不到', () => {
    const first = sample(1, 8, 50_000);
    // 第一名拿不到闪电和飞弹 —— 这是整套平衡的核心
    expect(first.lightning).toBe(0);
    expect(first.projectile).toBe(0);
  });

  it('闪电的概率随名次单调不减：越靠后越容易翻盘', () => {
    let prev = -1;
    for (let place = 1; place <= 8; place++) {
      const p = lotteryChances(place, 8).lightning;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(lotteryChances(8, 8).lightning).toBeGreaterThan(0.2);
  });

  it('防守类（护盾 / 地雷）的概率随名次单调不增：领跑的只能拿到弱道具', () => {
    let prev = Infinity;
    for (let place = 1; place <= 8; place++) {
      const c = lotteryChances(place, 8);
      const defensive = c.shield + c.trap;
      expect(defensive).toBeLessThanOrEqual(prev + 1e-12);
      prev = defensive;
    }
    expect(lotteryChances(1, 8).shield + lotteryChances(1, 8).trap).toBeGreaterThan(0.9);
    expect(lotteryChances(8, 8).shield + lotteryChances(8, 8).trap).toBeLessThan(0.15);
  });

  it('攻击类（飞弹 + 闪电）的概率随名次单调不减', () => {
    let prev = -1;
    for (let place = 1; place <= 8; place++) {
      const c = lotteryChances(place, 8);
      const offensive = c.projectile + c.lightning;
      expect(offensive).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = offensive;
    }
  });

  it('换种子只改具体序列，不改分布', () => {
    const a = sample(5, 8, 100_000, 1);
    const b = sample(5, 8, 100_000, 999);
    for (const id of ITEM_IDS) expect(Math.abs(a[id] - b[id])).toBeLessThan(0.01);
  });

  it('同一个种子给出同一串结果（整局可复现）', () => {
    const roll = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 30 }, () => rollItem(4, 8, rng));
    };
    expect(roll(42)).toEqual(roll(42));
    expect(roll(42)).not.toEqual(roll(43));
  });
});
