import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EffectSet, effect } from './EffectSystem';
import { cloneKartConfig } from '../kart/KartConfig';

const DT = 1 / 60;

/** 跑 seconds 秒 */
function run(set: EffectSet, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) set.update(DT);
}

describe('架构约束', () => {
  it('items/ 里的纯逻辑不 import three / rapier，也不碰 DOM', () => {
    const files = [
      './EffectSystem.ts',
      './ItemDefs.ts',
      './ItemSystem.ts',
      './ItemBoxes.ts',
      './Projectile.ts',
      './rng.ts',
    ];
    for (const file of files) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec).not.toMatch(/three/i);
        expect(spec).not.toMatch(/rapier/i);
        expect(spec.startsWith('.')).toBe(true);
      }
      expect(src).not.toMatch(/\b(window|document|THREE|requestAnimationFrame)\b/);
    }
  });

  it('kartStep 不知道道具的存在（没有任何 items 的引用）', () => {
    const src = readFileSync(new URL('../kart/kartStep.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/items|Effect|Item/);
  });
});

describe('到期移除', () => {
  it('时长走完就自动移除', () => {
    const set = new EffectSet();
    set.add(effect('slow', 1, 0.5));
    expect(set.has('slow')).toBe(true);

    run(set, 0.9);
    expect(set.has('slow')).toBe(true);

    run(set, 0.2);
    expect(set.has('slow')).toBe(false);
    expect(set.size).toBe(0);
  });

  it('多个效果各走各的，先到期的先走', () => {
    const set = new EffectSet();
    set.add(effect('slow', 0.5, 0.4));
    set.add(effect('shield', 3));
    run(set, 0.6);
    expect(set.has('slow')).toBe(false);
    expect(set.has('shield')).toBe(true);
    run(set, 3);
    expect(set.size).toBe(0);
  });

  it('剩余时长是准的', () => {
    const set = new EffectSet();
    set.add(effect('boost', 2, 0.3));
    run(set, 0.5);
    expect(set.remaining('boost')).toBeCloseTo(1.5, 6);
    expect(set.remaining('slow')).toBe(0);
  });

  it('时长 <= 0 的效果直接被忽略', () => {
    const set = new EffectSet();
    set.add(effect('slow', 0, 0.5));
    set.add(effect('slow', -1, 0.5));
    expect(set.size).toBe(0);
  });

  it('dt <= 0 不推进', () => {
    const set = new EffectSet();
    set.add(effect('slow', 1, 0.5));
    set.update(0);
    set.update(-1);
    expect(set.remaining('slow')).toBe(1);
  });
});

describe('同类叠加：刷新时长，不累加倍率', () => {
  it('再吃一发同类效果，时长刷新而不是相加', () => {
    const set = new EffectSet();
    set.add(effect('slow', 3, 0.4));
    run(set, 1); // 还剩 2
    set.add(effect('slow', 3, 0.4));
    expect(set.remaining('slow')).toBeCloseTo(3, 6); // 刷新成 3，不是 5
  });

  it('强度取较强的那个，不相乘', () => {
    const set = new EffectSet();
    set.add(effect('slow', 2, 0.3));
    set.add(effect('slow', 2, 0.6));
    expect(set.get('slow')!.magnitude).toBe(0.6);
    // 再来一发弱的不会把强度冲淡
    set.add(effect('slow', 2, 0.2));
    expect(set.get('slow')!.magnitude).toBe(0.6);
  });

  it('短效果不会把还剩很久的长效果刷短', () => {
    const set = new EffectSet();
    set.add(effect('slow', 5, 0.4));
    run(set, 1); // 还剩 4
    set.add(effect('slow', 0.5, 0.4));
    expect(set.remaining('slow')).toBeCloseTo(4, 6);
  });

  it('连吃十发也不会叠成停在原地', () => {
    const set = new EffectSet();
    for (let i = 0; i < 10; i++) set.add(effect('slow', 2, 0.45));
    const cfg = cloneKartConfig();
    const before = cfg.maxSpeed;
    set.applyTo(cfg);
    expect(cfg.maxSpeed).toBeCloseTo(before * 0.55, 6);
  });
});

describe('护盾', () => {
  it('挡下一次就消失，不管还剩多久', () => {
    const set = new EffectSet();
    set.add(effect('shield', 8));
    expect(set.consumeShield()).toBe(true);
    expect(set.has('shield')).toBe(false);
    expect(set.consumeShield()).toBe(false);
  });

  it('没护盾时返回 false', () => {
    expect(new EffectSet().consumeShield()).toBe(false);
  });

  it('护盾自己也会到期', () => {
    const set = new EffectSet();
    set.add(effect('shield', 1));
    run(set, 1.1);
    expect(set.consumeShield()).toBe(false);
  });
});

describe('作用到 KartConfig 副本', () => {
  it('空效果集什么都不改', () => {
    const cfg = cloneKartConfig();
    const base = cloneKartConfig();
    new EffectSet().applyTo(cfg);
    expect(cfg).toEqual(base);
  });

  it('slow 按 (1 - magnitude) 砍极速和加速度', () => {
    const cfg = cloneKartConfig();
    const base = cloneKartConfig();
    const set = new EffectSet();
    set.add(effect('slow', 2, 0.5));
    set.applyTo(cfg);
    expect(cfg.maxSpeed).toBeCloseTo(base.maxSpeed * 0.5, 6);
    expect(cfg.engineAccel).toBeCloseTo(base.engineAccel * 0.5, 6);
    // 没被点名的参数不许动
    expect(cfg.turnRate).toBe(base.turnRate);
    expect(cfg.brakeDecel).toBe(base.brakeDecel);
  });

  it('boost 按 (1 + magnitude) 抬极速', () => {
    const cfg = cloneKartConfig();
    const base = cloneKartConfig();
    const set = new EffectSet();
    set.add(effect('boost', 2, 0.3));
    set.applyTo(cfg);
    expect(cfg.maxSpeed).toBeCloseTo(base.maxSpeed * 1.3, 6);
  });

  it('spinout 除了减速还吃掉转向权限，并且起不了漂', () => {
    const cfg = cloneKartConfig();
    const base = cloneKartConfig();
    const set = new EffectSet();
    set.add(effect('spinout', 1.5, 0.65));
    set.applyTo(cfg);
    expect(cfg.maxSpeed).toBeLessThan(base.maxSpeed);
    expect(cfg.turnRate).toBeLessThan(base.turnRate);
    expect(cfg.turnRate).toBeGreaterThan(0); // 留一点权限，不然撞墙后挪不出来
    expect(cfg.driftMinSpeed).toBe(Number.POSITIVE_INFINITY);
  });

  it('slow 和 spinout 同时在时取更强的那个，不叠乘', () => {
    const cfg = cloneKartConfig();
    const base = cloneKartConfig();
    const set = new EffectSet();
    set.add(effect('slow', 2, 0.3));
    set.add(effect('spinout', 2, 0.6));
    set.applyTo(cfg);
    expect(cfg.maxSpeed).toBeCloseTo(base.maxSpeed * 0.4, 6);
  });

  it('极速再怎么被砍也不会到 0（否则车永远起不来）', () => {
    const cfg = cloneKartConfig();
    const set = new EffectSet();
    set.add(effect('slow', 2, 5));
    set.applyTo(cfg);
    expect(cfg.maxSpeed).toBeGreaterThan(0);
  });
});
