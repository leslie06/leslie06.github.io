import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUBBERBAND_CONFIG,
  NO_RUBBERBAND,
  Rubberband,
  rubberbandTarget,
  type RubberbandConfig,
} from './Rubberband';
import { AI_PROFILES, AI_DIFFICULTIES } from './AIProfiles';

const DT = 1 / 60;
const cfg: RubberbandConfig = DEFAULT_RUBBERBAND_CONFIG;

describe('rubberbandTarget', () => {
  it('倍率始终落在 [minMultiplier, maxMultiplier] 区间内', () => {
    for (let delta = -2; delta <= 2; delta += 0.01) {
      const m = rubberbandTarget(delta, cfg);
      expect(m).toBeGreaterThanOrEqual(cfg.minMultiplier);
      expect(m).toBeLessThanOrEqual(cfg.maxMultiplier);
    }
  });

  it('落后时 > 1，领先时 < 1，齐头并进时正好 1', () => {
    expect(rubberbandTarget(0, cfg)).toBe(1);
    expect(rubberbandTarget(-0.05, cfg)).toBeGreaterThan(1);
    expect(rubberbandTarget(0.05, cfg)).toBeLessThan(1);
  });

  it('随进度差单调不增（落后越多倍率越高）', () => {
    let prev = Infinity;
    for (let delta = -0.5; delta <= 0.5; delta += 0.005) {
      const m = rubberbandTarget(delta, cfg);
      expect(m).toBeLessThanOrEqual(prev + 1e-12);
      prev = m;
    }
  });

  it('在 behindRange / aheadRange 之内是严格单调的', () => {
    const a = rubberbandTarget(-cfg.behindRange * 0.25, cfg);
    const b = rubberbandTarget(-cfg.behindRange * 0.75, cfg);
    expect(b).toBeGreaterThan(a);

    const c = rubberbandTarget(cfg.aheadRange * 0.25, cfg);
    const d = rubberbandTarget(cfg.aheadRange * 0.75, cfg);
    expect(d).toBeLessThan(c);
  });

  it('超出区间就夹住，不会无限加成', () => {
    expect(rubberbandTarget(-1, cfg)).toBe(cfg.maxMultiplier);
    expect(rubberbandTarget(-99, cfg)).toBe(cfg.maxMultiplier);
    expect(rubberbandTarget(1, cfg)).toBe(cfg.minMultiplier);
    expect(rubberbandTarget(99, cfg)).toBe(cfg.minMultiplier);
  });

  it('NaN / Infinity 不会把倍率带坏', () => {
    expect(rubberbandTarget(NaN, cfg)).toBe(1);
    expect(rubberbandTarget(Infinity, cfg)).toBe(1);
  });

  it('NO_RUBBERBAND 恒为 1', () => {
    for (const delta of [-1, -0.1, 0, 0.1, 1]) {
      expect(rubberbandTarget(delta, NO_RUBBERBAND)).toBe(1);
    }
  });
});

describe('Rubberband 平滑', () => {
  it('从 1 出发，朝目标平滑逼近而不是一步到位', () => {
    const rb = new Rubberband();
    expect(rb.multiplier).toBe(1);
    const first = rb.update(-1, DT);
    // 一帧只能走一小步
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThan(1 + (cfg.maxMultiplier - 1) * 0.1);
  });

  it('长时间保持同一个差距会收敛到目标值', () => {
    const rb = new Rubberband();
    for (let i = 0; i < 60 * 20; i++) rb.update(-1, DT);
    expect(rb.multiplier).toBeCloseTo(cfg.maxMultiplier, 4);
  });

  it('平滑后的倍率也始终在区间内', () => {
    const rb = new Rubberband();
    // 差距来回横跳（模拟并排缠斗），倍率不许越界、也不许突变
    let last = rb.multiplier;
    for (let i = 0; i < 600; i++) {
      const delta = Math.sin(i * 0.5) * 0.3;
      const m = rb.update(delta, DT);
      expect(m).toBeGreaterThanOrEqual(cfg.minMultiplier - 1e-9);
      expect(m).toBeLessThanOrEqual(cfg.maxMultiplier + 1e-9);
      // 单帧变化量远小于整个区间宽度 —— 这就是"不突变"
      expect(Math.abs(m - last)).toBeLessThan((cfg.maxMultiplier - cfg.minMultiplier) * 0.05);
      last = m;
    }
  });

  it('reset 把倍率拉回 1', () => {
    const rb = new Rubberband();
    for (let i = 0; i < 300; i++) rb.update(-1, DT);
    expect(rb.multiplier).toBeGreaterThan(1.01);
    rb.reset();
    expect(rb.multiplier).toBe(1);
  });

  it('dt = 0 时不推进', () => {
    const rb = new Rubberband();
    rb.update(-1, 0);
    expect(rb.multiplier).toBe(1);
  });
});

describe('难度档位', () => {
  it('每一档的橡皮筋区间都是合法的', () => {
    for (const difficulty of AI_DIFFICULTIES) {
      const rb = AI_PROFILES[difficulty].rubberband;
      expect(rb.minMultiplier).toBeLessThanOrEqual(1);
      expect(rb.maxMultiplier).toBeGreaterThanOrEqual(1);
      expect(rb.behindRange).toBeGreaterThan(0);
      expect(rb.aheadRange).toBeGreaterThan(0);
      expect(rb.smoothing).toBeGreaterThan(0);
    }
  });

  it('难度越高橡皮筋越弱（少捞你也少等你）', () => {
    const width = (d: (typeof AI_DIFFICULTIES)[number]) => {
      const rb = AI_PROFILES[d].rubberband;
      return rb.maxMultiplier - rb.minMultiplier;
    };
    expect(width('easy')).toBeGreaterThan(width('normal'));
    expect(width('normal')).toBeGreaterThan(width('hard'));
  });

  it('难度越高基准极速越快、看得越远', () => {
    expect(AI_PROFILES.easy.speedMul).toBeLessThan(AI_PROFILES.normal.speedMul);
    expect(AI_PROFILES.normal.speedMul).toBeLessThan(AI_PROFILES.hard.speedMul);
    expect(AI_PROFILES.easy.driver.lookAheadDistance!).toBeLessThan(
      AI_PROFILES.normal.driver.lookAheadDistance!,
    );
    expect(AI_PROFILES.normal.driver.lookAheadDistance!).toBeLessThan(
      AI_PROFILES.hard.driver.lookAheadDistance!,
    );
  });

  it('只有 easy 不会漂移', () => {
    expect(AI_PROFILES.easy.driver.useDrift).toBe(false);
    expect(AI_PROFILES.normal.driver.useDrift).toBe(true);
    expect(AI_PROFILES.hard.driver.useDrift).toBe(true);
  });
});
