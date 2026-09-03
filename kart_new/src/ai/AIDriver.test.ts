import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AIDriver, DEFAULT_AI_DRIVER_CONFIG, type AIDriverConfig } from './AIDriver';
import { createTrackPoint, wrapPi, type AITrack, type AITrackPoint } from './AITrack';
import { createKartState, type KartState } from '../kart/kartStep';

const DT = 1 / 60;

/**
 * 沿 +z 的直线赛道。闭合性在这些用例里用不到（车永远待在 t 很小的地方）。
 */
function straightTrack(length = 1000): AITrack {
  return {
    length,
    sampleAt(t, out) {
      out.x = 0;
      out.z = t * length;
      out.heading = 0;
      return out;
    },
  };
}

/**
 * 半径 radius 的圆形赛道。
 *
 * dir = +1: heading 随 t 增大 -> 左弯（yawRate 为正，对应 steer 为负）
 * dir = -1: heading 随 t 减小 -> 右弯
 *
 * 符号约定见 KartState.heading：forward = (sin h, cos h)，steer=+1（右）让 heading 变小。
 */
function circleTrack(radius: number, dir: 1 | -1): AITrack {
  return {
    length: 2 * Math.PI * radius,
    sampleAt(t, out) {
      const phi = 2 * Math.PI * t;
      out.x = dir * radius * Math.sin(phi);
      out.z = radius * Math.cos(phi);
      // 切线 = d(位置)/d(phi)
      out.heading = Math.atan2(dir * Math.cos(phi), -Math.sin(phi));
      return out;
    },
  };
}

/** 把车摆在赛道上 t 处、完全对齐中心线的姿态。 */
function onTrackAt(track: AITrack, t: number, speed: number): KartState {
  const p: AITrackPoint = track.sampleAt(t, createTrackPoint());
  const state = createKartState(p.x, p.z, p.heading);
  state.speed = speed;
  return state;
}

function driver(track: AITrack, overrides: Partial<AIDriverConfig> = {}): AIDriver {
  return new AIDriver(track, overrides);
}

describe('架构约束', () => {
  it('AI 层不 import three / rapier，也不碰 DOM', () => {
    for (const file of ['./AIDriver.ts', './Rubberband.ts', './AITrack.ts', './AIProfiles.ts']) {
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
});

describe('直线段', () => {
  it('车对齐中心线时 steer 接近 0', () => {
    const track = straightTrack();
    const ai = driver(track, { laneOffset: 0 });
    const state = onTrackAt(track, 0.05, 25);
    const out = ai.update(state, 0.05, DT);
    expect(Math.abs(out.steer)).toBeLessThan(1e-6);
    expect(Math.abs(ai.angleError)).toBeLessThan(1e-6);
  });

  it('直线上全油门、不刹车、不漂移', () => {
    const track = straightTrack();
    const ai = driver(track);
    const out = ai.update(onTrackAt(track, 0.05, 30), 0.05, DT);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
    expect(out.drift).toBe(false);
  });

  it('偏离中心线时会往回打，且方向正确', () => {
    const track = straightTrack();
    // 注意坐标约定：heading=0 面朝 +z 时，车手视角的"右"是 **-x**
    // （右向量 = (sin(h-π/2), cos(h-π/2))，h=0 时是 (-1, 0)，和 TrackSpline.lateral 同一套）。
    // 所以车在 +x 一侧 = 偏到了左边，要往右打把它拉回来。
    const onLeft = onTrackAt(track, 0.05, 25);
    onLeft.x = 4;
    expect(driver(track, { laneOffset: 0 }).update(onLeft, 0.05, DT).steer).toBeGreaterThan(0);

    const onRight = onTrackAt(track, 0.05, 25);
    onRight.x = -4;
    expect(driver(track, { laneOffset: 0 }).update(onRight, 0.05, DT).steer).toBeLessThan(0);
  });

  it('laneOffset 把走线整体挪到一侧', () => {
    const track = straightTrack();
    const state = onTrackAt(track, 0.05, 25);
    // 走线在右边 -> 站在中心线上时该往右打（steer > 0）
    expect(driver(track, { laneOffset: 5 }).update(state, 0.05, DT).steer).toBeGreaterThan(0);
    expect(driver(track, { laneOffset: -5 }).update(state, 0.05, DT).steer).toBeLessThan(0);
  });
});

describe('弯道段', () => {
  it('steer 方向和弯道方向一致', () => {
    for (const dir of [1, -1] as const) {
      const track = circleTrack(60, dir);
      const ai = driver(track, { laneOffset: 0 });
      // 走一圈上的多个位置，符号必须始终一致 —— 只测一个点的话，
      // 万一取的正好是象限边界，符号错了也可能碰巧过
      for (const t of [0, 0.17, 0.33, 0.5, 0.66, 0.83]) {
        const state = onTrackAt(track, t, 24);
        const out = ai.update(state, t, DT);
        // dir=+1 是左弯（heading 变大），左转 = steer 为负 —— 所以 sign(steer) = -dir
        expect(Math.sign(out.steer)).toBe(-dir);
      }
    }
  });

  it('弯道上算出来的角度差方向和赛道曲率一致', () => {
    for (const dir of [1, -1] as const) {
      const track = circleTrack(60, dir);
      const ai = driver(track);
      const state = onTrackAt(track, 0.25, 24);
      ai.update(state, 0.25, DT);
      // 左弯 -> 目标在左 -> heading 需要变大 -> angleError > 0
      expect(Math.sign(ai.angleError)).toBe(dir);
      // 前瞻 ~18m + 速度项，60m 半径上对应的圆心角量级是 0.3~0.6 rad
      expect(Math.abs(ai.angleError)).toBeGreaterThan(0.1);
      expect(Math.abs(ai.angleError)).toBeLessThan(Math.PI / 2);
    }
  });

  it('急弯里会收油，弯越急收得越多', () => {
    const wide = driver(circleTrack(120, 1)).update(
      onTrackAt(circleTrack(120, 1), 0.2, 28),
      0.2,
      DT,
    ).throttle;
    const tight = driver(circleTrack(28, 1)).update(
      onTrackAt(circleTrack(28, 1), 0.2, 28),
      0.2,
      DT,
    ).throttle;
    expect(tight).toBeLessThan(wide);
    expect(tight).toBeGreaterThanOrEqual(DEFAULT_AI_DRIVER_CONFIG.minThrottle);
    expect(wide).toBeLessThanOrEqual(1);
  });

  it('角度差够大、速度够快就起漂，并按住到出弯', () => {
    const track = circleTrack(30, 1);
    const ai = driver(track, { useDrift: true, driftAngleThreshold: 0.3, driftMinSpeed: 14 });
    const state = onTrackAt(track, 0.2, 26);
    expect(ai.update(state, 0.2, DT).drift).toBe(true);
    // 迟滞：一旦起漂，即使这一帧角度回正也要按满 driftMinHold
    const straightState = onTrackAt(straightTrack(), 0.05, 26);
    expect(ai.update(straightState, 0.05, DT).drift).toBe(true);
  });

  it('easy 档（useDrift=false）永远不按漂移键', () => {
    const track = circleTrack(25, 1);
    const ai = driver(track, { useDrift: false });
    let state = onTrackAt(track, 0.2, 30);
    for (let i = 0; i < 60; i++) {
      expect(ai.update(state, 0.2, DT).drift).toBe(false);
      state = onTrackAt(track, 0.2 + i * 0.001, 30);
    }
  });
});

describe('脱困', () => {
  it('长时间不动就倒车，倒完自己恢复', () => {
    const track = straightTrack();
    const cfg = { stuckSpeed: 0.8, stuckTime: 1.0, reverseTime: 0.5 };
    const ai = driver(track, cfg);
    const stuck = onTrackAt(track, 0.05, 0);

    // 卡住 1 秒之前不该倒车
    for (let i = 0; i < Math.round(cfg.stuckTime / DT) - 1; i++) {
      expect(ai.update(stuck, 0.05, DT).brake).toBe(0);
    }
    expect(ai.update(stuck, 0.05, DT).brake).toBe(1);

    // 倒够 reverseTime 就回到正常驱动
    const moving = onTrackAt(track, 0.05, 20);
    for (let i = 0; i < Math.round(cfg.reverseTime / DT) + 1; i++) ai.update(moving, 0.05, DT);
    expect(ai.update(moving, 0.05, DT).brake).toBe(0);
    expect(ai.update(moving, 0.05, DT).throttle).toBeGreaterThan(0);
  });

  it('reset() 清掉脱困计时器（倒计时罚站不该攒进去）', () => {
    const track = straightTrack();
    const ai = driver(track, { stuckTime: 1.0 });
    const stuck = onTrackAt(track, 0.05, 0);
    for (let i = 0; i < 200; i++) {
      ai.update(stuck, 0.05, DT);
      ai.reset();
    }
    expect(ai.update(stuck, 0.05, DT).brake).toBe(0);
  });
});

describe('数值稳定性', () => {
  it('heading 绕了很多圈之后角度差依然是折回过的小角', () => {
    const track = straightTrack();
    const ai = driver(track);
    const state = onTrackAt(track, 0.05, 25);
    state.heading += 20 * Math.PI; // 跑了 10 圈，heading 故意没归一化
    const out = ai.update(state, 0.05, DT);
    expect(Math.abs(ai.angleError)).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(out.steer)).toBeLessThan(1e-6);
  });

  it('steer 恒在 [-1, 1]', () => {
    const track = circleTrack(12, -1); // 极端小半径，角度差会大到饱和
    const ai = driver(track);
    for (let i = 0; i < 120; i++) {
      const out = ai.update(onTrackAt(track, i * 0.008, 30), i * 0.008, DT);
      expect(out.steer).toBeGreaterThanOrEqual(-1);
      expect(out.steer).toBeLessThanOrEqual(1);
      expect(out.throttle).toBeGreaterThanOrEqual(0);
      expect(out.throttle).toBeLessThanOrEqual(1);
    }
  });

  it('wrapPi 把任意角折回 (-π, π]', () => {
    for (const a of [0, 0.5, Math.PI, -Math.PI, 7, -7, 100]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(Math.cos(w) - Math.cos(a))).toBeLessThan(1e-9);
    }
  });
});
