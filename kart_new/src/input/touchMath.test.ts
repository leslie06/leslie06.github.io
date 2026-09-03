import { describe, expect, it } from 'vitest';
import { clampKnob, DEFAULT_TOUCH_STEER, steerFromOffset } from './touchMath';

const cfg = DEFAULT_TOUCH_STEER;

describe('steerFromOffset', () => {
  it('圆心附近落在死区里，一律 0', () => {
    expect(steerFromOffset(0, cfg)).toBe(0);
    expect(steerFromOffset(cfg.radius * cfg.deadzone * 0.9, cfg)).toBe(0);
    expect(steerFromOffset(-cfg.radius * cfg.deadzone * 0.9, cfg)).toBe(0);
  });

  it('拉满是 ±1，拉过头也不会超过 ±1', () => {
    expect(steerFromOffset(cfg.radius, cfg)).toBeCloseTo(1, 6);
    expect(steerFromOffset(cfg.radius * 5, cfg)).toBeCloseTo(1, 6);
    expect(steerFromOffset(-cfg.radius * 5, cfg)).toBeCloseTo(-1, 6);
  });

  it('左右对称', () => {
    for (let dx = 0; dx <= cfg.radius; dx += 4) {
      expect(steerFromOffset(-dx, cfg)).toBeCloseTo(-steerFromOffset(dx, cfg), 12);
    }
  });

  it('单调递增，中间没有跳变', () => {
    let prev = -Infinity;
    for (let dx = -cfg.radius; dx <= cfg.radius; dx += 1) {
      const steer = steerFromOffset(dx, cfg);
      expect(steer).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = steer;
    }
  });

  it('刚出死区时舵角接近 0，不会"啪"地跳一块出来', () => {
    const justOutside = cfg.radius * (cfg.deadzone + 0.01);
    expect(Math.abs(steerFromOffset(justOutside, cfg))).toBeLessThan(0.05);
  });

  it('curve > 1 时中间段比线性更钝', () => {
    const half = cfg.radius * 0.5;
    const curved = steerFromOffset(half, cfg);
    const linear = steerFromOffset(half, { ...cfg, curve: 1 });
    expect(curved).toBeLessThan(linear);
  });

  it('半径不同但拉的比例相同，结果一样', () => {
    const a = steerFromOffset(40, { ...cfg, radius: 80 });
    const b = steerFromOffset(70, { ...cfg, radius: 140 });
    expect(a).toBeCloseTo(b, 12);
  });
});

describe('clampKnob', () => {
  it('圈内原样返回', () => {
    expect(clampKnob(10, -20, 64)).toEqual({ x: 10, y: -20 });
  });

  it('圈外按长度截，斜着拉也不会跑到方角上', () => {
    const knob = clampKnob(300, 300, 64);
    expect(Math.hypot(knob.x, knob.y)).toBeCloseTo(64, 6);
    expect(knob.x).toBeCloseTo(knob.y, 6);
  });

  it('就地写进传入的对象，不新建', () => {
    const out = { x: 0, y: 0 };
    expect(clampKnob(1, 2, 64, out)).toBe(out);
  });
});
