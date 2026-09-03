import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloneKartConfig, type KartConfig } from './KartConfig';
import { FLAT_GROUND, type GroundSample } from './GroundSample';
import {
  chargeLevelOf,
  createKartState,
  diffKartEvents,
  lerpKartState,
  stepKart,
  type KartEvent,
  type KartState,
} from './kartStep';
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';

const DT = 1 / 60;
const cfg: KartConfig = cloneKartConfig();

const input = (partial: Partial<InputState> = {}): InputState => ({ ...NEUTRAL_INPUT, ...partial });

/** 跑 seconds 秒，每步 DT，返回最终状态。onStep 可以逐帧断言。 */
function simulate(
  start: KartState,
  inp: InputState,
  seconds: number,
  onStep?: (next: KartState, prev: KartState) => void,
): KartState {
  let state = start;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const next = stepKart(state, inp, FLAT_GROUND, cfg, DT);
    onStep?.(next, state);
    state = next;
  }
  return state;
}

describe('架构约束', () => {
  it('kartStep.ts 不 import three 或任何渲染相关的东西', () => {
    const src = readFileSync(new URL('./kartStep.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).not.toMatch(/three/i);
      expect(spec).not.toMatch(/rapier/i);
      expect(spec.startsWith('.')).toBe(true); // 只允许项目内的相对引用
    }
    expect(src).not.toMatch(/\b(window|document|THREE|requestAnimationFrame)\b/);
  });
});

describe('油门', () => {
  it('全油门在合理时间内到达 maxSpeed，且不会超过', () => {
    // 恒定加速度，理论时间 = maxSpeed / engineAccel
    const expected = cfg.maxSpeed / cfg.engineAccel;
    const end = simulate(createKartState(), input({ throttle: 1 }), expected + 0.5, (next) => {
      expect(next.speed).toBeLessThanOrEqual(cfg.maxSpeed + 1e-9);
    });
    expect(expected).toBeLessThan(5);
    expect(end.speed).toBeCloseTo(cfg.maxSpeed, 6);
  });

  it('半油门加速度减半', () => {
    const full = simulate(createKartState(), input({ throttle: 1 }), 0.5);
    const half = simulate(createKartState(), input({ throttle: 0.5 }), 0.5);
    expect(half.speed).toBeCloseTo(full.speed / 2, 6);
  });

  it('全油门直行时沿 heading 前进', () => {
    const end = simulate(createKartState(0, 0, 0), input({ throttle: 1 }), 2);
    expect(end.x).toBeCloseTo(0, 9); // heading 0 = +z，不该有横向漂移
    expect(end.z).toBeGreaterThan(10);
  });
});

describe('松油门', () => {
  it('速度单调下降，不会冲过 0 变成倒车', () => {
    const cruising = simulate(createKartState(), input({ throttle: 1 }), 3);
    expect(cruising.speed).toBeGreaterThan(0);

    let sawZero = false;
    const end = simulate(cruising, input(), 6, (next, prev) => {
      expect(next.speed).toBeLessThanOrEqual(prev.speed + 1e-12);
      expect(next.speed).toBeGreaterThanOrEqual(0);
      if (next.speed === 0) sawZero = true;
    });
    expect(sawZero).toBe(true);
    expect(end.speed).toBe(0);
  });

  it('刹车比自然滑行停得快', () => {
    const cruising = simulate(createKartState(), input({ throttle: 1 }), 3);
    const coasted = simulate(cruising, input(), 0.5);
    const braked = simulate(cruising, input({ brake: 1 }), 0.5);
    expect(braked.speed).toBeLessThan(coasted.speed);
  });
});

describe('转向', () => {
  it('静止时打方向既不改变位置也不改变朝向', () => {
    const start = createKartState(3, -7, 0.8);
    const end = simulate(start, input({ steer: 1 }), 2);
    expect(end.x).toBe(start.x);
    expect(end.z).toBe(start.z);
    expect(end.heading).toBe(start.heading);
    expect(end.speed).toBe(0);
  });

  it('静止时打方向 + 刹车（倒车键没按下的纯转向）也不会自转', () => {
    const end = simulate(createKartState(), input({ steer: -1 }), 1);
    expect(end.heading).toBe(0);
  });

  /**
   * 这条曾经写反过：原来断言的是"右打方向 heading 增加"，正好把 bug 编码进了测试。
   * 现在改成跟坐标约定无关的判据 —— 用车自身的右向量投影，heading 的符号约定
   * 怎么定都不影响这条测试的对错。
   */
  it('打右舵车往自己的右边跑，打左舵往左边跑', () => {
    const cruising = simulate(createKartState(), input({ throttle: 1 }), 2);

    for (const [label, steer, wantSign] of [
      ['右', 1, 1],
      ['左', -1, -1],
    ] as const) {
      const after = simulate(cruising, input({ throttle: 1, steer }), 1);
      // 车头 forward=(sin h, cos h)，up=+y，那么车自身的右向量 = forward × up = (-cos h, sin h)
      const rx = -Math.cos(cruising.heading);
      const rz = Math.sin(cruising.heading);
      const lateral = (after.x - cruising.x) * rx + (after.z - cruising.z) * rz;
      expect(Math.sign(lateral), `打${label}舵应该往${label}边偏`).toBe(wantSign);
    }
  });

  it('高速转得比低速钝', () => {
    const slow = simulate(createKartState(), input({ throttle: 1 }), 0.4);
    const fast = simulate(createKartState(), input({ throttle: 1 }), 3);
    const slowTurn = stepKart(slow, input({ steer: 1 }), FLAT_GROUND, cfg, DT);
    const fastTurn = stepKart(fast, input({ steer: 1 }), FLAT_GROUND, cfg, DT);
    expect(Math.abs(slowTurn.yawRate)).toBeGreaterThan(Math.abs(fastTurn.yawRate));
  });

  it('倒车时打方向的转向方向相反', () => {
    const cruising = simulate(createKartState(), input({ throttle: 1 }), 1);
    const forwardTurn = stepKart(cruising, input({ throttle: 1, steer: 1 }), FLAT_GROUND, cfg, DT);

    const reversing = simulate(createKartState(), input({ brake: 1 }), 1.5);
    expect(reversing.speed).toBeLessThan(-1);
    const reverseTurn = stepKart(reversing, input({ brake: 1, steer: 1 }), FLAT_GROUND, cfg, DT);

    expect(Math.sign(reverseTurn.yawRate)).toBe(-Math.sign(forwardTurn.yawRate));
  });

  it('全程满油满舵也不会侧滑：速度方向永远等于 heading', () => {
    let state = createKartState();
    const inp = input({ throttle: 1, steer: 1 });
    for (let i = 0; i < 600; i++) {
      const next = stepKart(state, inp, FLAT_GROUND, cfg, DT);
      const dx = next.x - state.x;
      const dz = next.z - state.z;
      const travelled = Math.hypot(dx, dz);
      if (travelled > 1e-6) {
        // 位移方向必须和该帧的 heading 完全一致（无横向分量）
        expect(dx / travelled).toBeCloseTo(Math.sin(next.heading), 9);
        expect(dz / travelled).toBeCloseTo(Math.cos(next.heading), 9);
      }
      state = next;
    }
    expect(Number.isFinite(state.x) && Number.isFinite(state.z)).toBe(true);
  });
});

describe('纯函数性质', () => {
  it('不修改传入的 state', () => {
    const start = createKartState(1, 2, 0.3);
    const snapshot = { ...start };
    stepKart(start, input({ throttle: 1, steer: 1 }), FLAT_GROUND, cfg, DT);
    expect(start).toEqual(snapshot);
  });

  it('同样的输入得到同样的输出', () => {
    const a = simulate(createKartState(), input({ throttle: 1, steer: 0.6 }), 2);
    const b = simulate(createKartState(), input({ throttle: 1, steer: 0.6 }), 2);
    expect(a).toEqual(b);
  });

  it('dt <= 0 时状态不变', () => {
    const start = createKartState(1, 2, 0.3);
    expect(stepKart(start, input({ throttle: 1 }), FLAT_GROUND, cfg, 0)).toEqual(start);
  });
});

describe('渲染插值', () => {
  it('lerpKartState 在两端返回端点值', () => {
    const a = createKartState(0, 0, 0);
    const b = stepKart(a, input({ throttle: 1 }), FLAT_GROUND, cfg, DT);
    expect(lerpKartState(a, b, 0).z).toBeCloseTo(a.z, 12);
    expect(lerpKartState(a, b, 1).z).toBeCloseTo(b.z, 12);
    expect(lerpKartState(a, b, 0.5).speed).toBeCloseTo((a.speed + b.speed) / 2, 12);
  });
});

// ============================================================================
// 漂移蓄力 / mini-turbo
// ============================================================================

/** 一路跑到底并收集事件，方便断言状态机的转移序列。 */
function simulateWithEvents(start: KartState, inp: InputState, seconds: number) {
  let state = start;
  const events: KartEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const next = stepKart(state, inp, FLAT_GROUND, cfg, DT);
    events.push(...diffKartEvents(state, next));
    state = next;
  }
  return { state, events };
}

/** 先加速到能起漂的速度 */
const cruising = () => simulate(createKartState(), input({ throttle: 1 }), 2);

describe('漂移 · 进入', () => {
  it('速度够 + 按住 drift + 有方向输入 -> 进入 drifting', () => {
    const end = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), 0.5);
    expect(end.driftPhase).toBe('drifting');
    expect(end.driftDir).toBe(1);
    expect(end.driftCharge).toBeGreaterThan(0);
  });

  it('没有方向输入不起漂', () => {
    const end = simulate(cruising(), input({ throttle: 1, drift: true }), 1);
    expect(end.driftPhase).toBe('none');
    expect(end.driftCharge).toBe(0);
  });

  it('方向输入在死区内不起漂', () => {
    const steer = cfg.driftSteerDeadzone * 0.9;
    const end = simulate(cruising(), input({ throttle: 1, steer, drift: true }), 1);
    expect(end.driftPhase).toBe('none');
  });

  it('速度低于 driftMinSpeed 不起漂', () => {
    const slow = simulate(createKartState(), input({ throttle: 1 }), 0.2);
    expect(slow.speed).toBeLessThan(cfg.driftMinSpeed);
    const end = stepKart(slow, input({ throttle: 1, steer: 1, drift: true }), FLAT_GROUND, cfg, DT);
    expect(end.driftPhase).toBe('none');
  });

  it('driftDir 在起漂瞬间锁定，中途反打也不变', () => {
    const started = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), 0.3);
    expect(started.driftDir).toBe(1);
    // 反打到底
    const after = simulate(started, input({ throttle: 1, steer: -1, drift: true }), 1);
    expect(after.driftPhase).toBe('drifting');
    expect(after.driftDir).toBe(1);
  });
});

describe('漂移 · 转向', () => {
  it('漂移转弯半径比普通转向小', () => {
    const start = cruising();
    const normal = stepKart(start, input({ throttle: 1, steer: 1 }), FLAT_GROUND, cfg, DT);
    const drift = simulate(start, input({ throttle: 1, steer: 1, drift: true }), 0.3);
    const driftStep = stepKart(drift, input({ throttle: 1, steer: 1, drift: true }), FLAT_GROUND, cfg, DT);
    expect(Math.abs(driftStep.yawRate)).toBeGreaterThan(Math.abs(normal.yawRate));
  });

  it('同向打方向转得更紧，反打能掰回来一些', () => {
    const drifting = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), 0.3);
    const inward = stepKart(drifting, input({ throttle: 1, steer: 1, drift: true }), FLAT_GROUND, cfg, DT);
    const neutral = stepKart(drifting, input({ throttle: 1, steer: 0, drift: true }), FLAT_GROUND, cfg, DT);
    const counter = stepKart(drifting, input({ throttle: 1, steer: -1, drift: true }), FLAT_GROUND, cfg, DT);
    expect(Math.abs(inward.yawRate)).toBeGreaterThan(Math.abs(neutral.yawRate));
    expect(Math.abs(neutral.yawRate)).toBeGreaterThan(Math.abs(counter.yawRate));
  });

  it('反打到底也不能把漂移转向掰到停或反向', () => {
    const drifting = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), 0.3);
    const counter = simulate(drifting, input({ throttle: 1, steer: -1, drift: true }), 1.5);
    // 全程 yawRate 符号不变、且始终不为 0
    let state = counter;
    for (let i = 0; i < 60; i++) {
      state = stepKart(state, input({ throttle: 1, steer: -1, drift: true }), FLAT_GROUND, cfg, DT);
      expect(state.driftPhase).toBe('drifting');
      expect(Math.sign(state.yawRate)).toBe(-1); // driftDir=+1 -> yawRate 恒为负
    }
  });

  it('漂移中车身斜着走，但位移方向仍严格沿 heading', () => {
    let state = cruising();
    const inp = input({ throttle: 1, steer: 1, drift: true });
    let sawOffset = false;
    for (let i = 0; i < 120; i++) {
      const next = stepKart(state, inp, FLAT_GROUND, cfg, DT);
      if (Math.abs(next.driftYawOffset) > 0.05) sawOffset = true;
      const dx = next.x - state.x;
      const dz = next.z - state.z;
      const travelled = Math.hypot(dx, dz);
      if (travelled > 1e-6) {
        expect(dx / travelled).toBeCloseTo(Math.sin(next.heading), 9);
        expect(dz / travelled).toBeCloseTo(Math.cos(next.heading), 9);
      }
      state = next;
    }
    expect(sawOffset).toBe(true); // 确实斜过了，不是因为偏转恒为 0 才通过的
  });
});

describe('漂移 · 蓄力分档', () => {
  it('chargeLevelOf 按阈值分档', () => {
    const [t1, t2, t3] = cfg.chargeThresholds;
    expect(chargeLevelOf(0, cfg.chargeThresholds)).toBe(0);
    expect(chargeLevelOf(t1 - 0.01, cfg.chargeThresholds)).toBe(0);
    expect(chargeLevelOf(t1, cfg.chargeThresholds)).toBe(1);
    expect(chargeLevelOf(t2, cfg.chargeThresholds)).toBe(2);
    expect(chargeLevelOf(t3, cfg.chargeThresholds)).toBe(3);
    expect(chargeLevelOf(t3 + 10, cfg.chargeThresholds)).toBe(3);
  });

  it('一直漂能依次升到三档，并逐档发出事件', () => {
    const { state, events } = simulateWithEvents(
      cruising(),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[2] + 0.5,
    );
    expect(state.driftLevel).toBe(3);
    const levelUps = events.filter((e) => e.type === 'driftLevelUp').map((e) => e.level);
    expect(levelUps).toEqual([1, 2, 3]);
    expect(events.filter((e) => e.type === 'driftStart')).toHaveLength(1);
  });

  it('漂移全程速度不会掉到 driftMinSpeed 以下（否则根本蓄不满三档）', () => {
    let state = cruising();
    const inp = input({ throttle: 1, steer: 1, drift: true });
    for (let i = 0; i < Math.round((cfg.chargeThresholds[2] + 0.5) / DT); i++) {
      state = stepKart(state, inp, FLAT_GROUND, cfg, DT);
      expect(state.speed).toBeGreaterThan(cfg.driftMinSpeed);
    }
    expect(state.driftLevel).toBe(3);
  });
});

describe('漂移 · 释放', () => {
  it('蓄力不足就释放，没有任何加速奖励', () => {
    const short = cfg.chargeThresholds[0] * 0.5;
    const drifted = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), short);
    expect(drifted.driftLevel).toBe(0);

    const released = simulate(drifted, input({ throttle: 1 }), 2);
    expect(released.driftPhase).toBe('none');
    expect(released.boostTime).toBe(0);
    expect(released.boostLevel).toBe(0);
    expect(released.speed).toBeLessThanOrEqual(cfg.maxSpeed + 1e-9);
  });

  it('蓄满三档释放后速度超过 maxSpeed', () => {
    const drifted = simulate(
      cruising(),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[2] + 0.3,
    );
    expect(drifted.driftLevel).toBe(3);

    const boosting = simulate(drifted, input({ throttle: 1 }), 0.5);
    expect(boosting.driftPhase).toBe('boosting');
    expect(boosting.boostLevel).toBe(3);
    expect(boosting.speed).toBeGreaterThan(cfg.maxSpeed);
    expect(boosting.speed).toBeLessThanOrEqual(cfg.maxSpeed * cfg.boostSpeedMul[2] + 1e-9);
  });

  it('档位越高 boost 越猛', () => {
    const peakAfter = (chargeFor: number) => {
      const drifted = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), chargeFor);
      let state = drifted;
      let peak = 0;
      for (let i = 0; i < 60 * 4; i++) {
        state = stepKart(state, input({ throttle: 1 }), FLAT_GROUND, cfg, DT);
        peak = Math.max(peak, state.speed);
      }
      return peak;
    };
    const l1 = peakAfter(cfg.chargeThresholds[0] + 0.05);
    const l2 = peakAfter(cfg.chargeThresholds[1] + 0.05);
    const l3 = peakAfter(cfg.chargeThresholds[2] + 0.05);
    expect(l2).toBeGreaterThan(l1);
    expect(l3).toBeGreaterThan(l2);
  });

  it('boost 结束后平滑回落，不会瞬间掉速', () => {
    const drifted = simulate(
      cruising(),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[2] + 0.3,
    );
    let state = drifted;
    let maxDrop = 0;
    let sawOverspeed = false;
    for (let i = 0; i < 60 * 5; i++) {
      const next = stepKart(state, input({ throttle: 1 }), FLAT_GROUND, cfg, DT);
      if (next.speed > cfg.maxSpeed) sawOverspeed = true;
      maxDrop = Math.max(maxDrop, state.speed - next.speed);
      state = next;
    }
    expect(sawOverspeed).toBe(true);
    // 单帧掉速不超过 boostFalloffDecel * dt（外加过弯掉速的余量，这里是直行所以没有）
    expect(maxDrop).toBeLessThanOrEqual(cfg.boostFalloffDecel * DT + 1e-9);
    expect(state.speed).toBeCloseTo(cfg.maxSpeed, 3);
  });

  it('释放时发出 boostStart，boost 跑完发出 boostEnd', () => {
    const drifted = simulate(
      cruising(),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[0] + 0.05,
    );
    const { events } = simulateWithEvents(drifted, input({ throttle: 1 }), 3);
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain('driftEnd');
    expect(kinds).toContain('boostStart');
    expect(kinds).toContain('boostEnd');
    expect(kinds.indexOf('boostStart')).toBeLessThan(kinds.indexOf('boostEnd'));
    const end = events.find((e) => e.type === 'driftEnd');
    expect(end && end.boosted).toBe(true);
  });
});

describe('漂移 · 中断', () => {
  it('速度掉到 driftMinSpeed 以下时 charge 清零且没有奖励', () => {
    const drifted = simulate(
      cruising(),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[2] + 0.3,
    );
    expect(drifted.driftLevel).toBe(3);

    // 按住 drift 不放，同时踩死刹车把速度拉下来
    const braked = simulate(drifted, input({ brake: 1, steer: 1, drift: true }), 2);
    expect(braked.speed).toBeLessThanOrEqual(cfg.driftMinSpeed);
    expect(braked.driftPhase).toBe('none');
    expect(braked.driftCharge).toBe(0);
    expect(braked.driftLevel).toBe(0);
    expect(braked.boostTime).toBe(0);
    expect(braked.boostLevel).toBe(0);
  });

  it('中断时 driftEnd 事件标记为没吃到 boost', () => {
    const drifted = simulate(
      cruising(),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[2] + 0.3,
    );
    const { events } = simulateWithEvents(drifted, input({ brake: 1, steer: 1, drift: true }), 2);
    const end = events.find((e) => e.type === 'driftEnd');
    expect(end).toBeDefined();
    expect(end && end.boosted).toBe(false);
    expect(events.some((e) => e.type === 'boostStart')).toBe(false);
  });
});

describe('漂移 · 纯函数性质仍然成立', () => {
  it('漂移过程也不修改传入 state', () => {
    const drifting = simulate(cruising(), input({ throttle: 1, steer: 1, drift: true }), 0.5);
    const snapshot = { ...drifting };
    stepKart(drifting, input({ throttle: 1, steer: 1, drift: true }), FLAT_GROUND, cfg, DT);
    expect(drifting).toEqual(snapshot);
  });

  it('同样的漂移输入得到同样的输出', () => {
    const inp = input({ throttle: 1, steer: 1, drift: true });
    const a = simulate(createKartState(), inp, 4);
    const b = simulate(createKartState(), inp, 4);
    expect(a).toEqual(b);
  });
});

// ============================================================================
// 地形贴合 / 护栏 / 掉出赛道
// ============================================================================

const ground = (partial: Partial<GroundSample>): GroundSample => ({ ...FLAT_GROUND, ...partial });

/** 在指定地面上跑 seconds 秒。 */
function simulateOn(
  start: KartState,
  inp: InputState,
  g: GroundSample,
  seconds: number,
  onStep?: (next: KartState, prev: KartState) => void,
): KartState {
  let state = start;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const next = stepKart(state, inp, g, cfg, DT);
    onStep?.(next, state);
    state = next;
  }
  return state;
}

describe('贴地', () => {
  it('平地上 y 一直是 0（没有赛道时的老行为不变）', () => {
    const end = simulate(createKartState(), input({ throttle: 1 }), 3);
    expect(end.y).toBe(0);
    expect(end.airborne).toBe(false);
  });

  it('y 平滑逼近接触点，不是瞬间吸附', () => {
    const g = ground({ height: 5 });
    const start = createKartState();
    const first = stepKart(start, input(), g, cfg, DT);
    // 一帧只能走一小段，绝不能直接跳到 5
    expect(first.y).toBeGreaterThan(0);
    expect(first.y).toBeLessThan(5 * 0.5);
    const end = simulateOn(start, input(), g, 2);
    expect(end.y).toBeCloseTo(5, 2);
  });

  it('接触点变高时 y 单调上升', () => {
    let seen = -Infinity;
    simulateOn(createKartState(), input(), ground({ height: 3 }), 1, (next) => {
      expect(next.y).toBeGreaterThanOrEqual(seen);
      seen = next.y;
    });
  });

  it('地面法线被平滑追踪，并且始终是单位向量', () => {
    const tilt = 0.3;
    const g = ground({ normalX: Math.sin(tilt), normalY: Math.cos(tilt), normalZ: 0 });
    const first = stepKart(createKartState(), input(), g, cfg, DT);
    expect(first.groundNormalX).toBeGreaterThan(0);
    expect(first.groundNormalX).toBeLessThan(g.normalX); // 平滑，不是一步到位
    const end = simulateOn(createKartState(), input(), g, 2);
    expect(end.groundNormalX).toBeCloseTo(g.normalX, 3);
    expect(Math.hypot(end.groundNormalX, end.groundNormalY, end.groundNormalZ)).toBeCloseTo(1, 9);
  });

  it('进度和横向偏移原样带进 state，方便 HUD 读', () => {
    const end = stepKart(createKartState(), input(), ground({ progress: 0.42, lateral: -3.5 }), cfg, DT);
    expect(end.trackProgress).toBe(0.42);
    expect(end.lateralOffset).toBe(-3.5);
  });
});

describe('护栏', () => {
  const halfWidth = 10;
  /**
   * 车在中心线右边 10.4 米（超界 0.4 米），回中方向是 -x。
   * 超界量要取得比"一帧的位移"小 —— 护栏只管得住这个量级，
   * 更夸张的偏移会被当成"被扔出赛道"交给下落逻辑，见下面的用例。
   */
  const scraping = ground({ halfWidth, lateral: 10.4, toCenterX: -1, toCenterZ: 0 });
  const inside = ground({ halfWidth, lateral: 3, toCenterX: -1, toCenterZ: 0 });

  it('超出半宽会被拉回来', () => {
    const start = simulate(createKartState(), input({ throttle: 1 }), 2);
    const free = stepKart(start, input({ throttle: 1 }), inside, cfg, DT);
    const pushed = stepKart(start, input({ throttle: 1 }), scraping, cfg, DT);
    // 超界 0.4 米，就往回推 0.4 米
    expect(free.x - pushed.x).toBeCloseTo(0.4, 6);
  });

  it('蹭护栏会掉速', () => {
    const start = simulate(createKartState(), input({ throttle: 1 }), 2);
    const free = stepKart(start, input({ throttle: 1 }), inside, cfg, DT);
    const pushed = stepKart(start, input({ throttle: 1 }), scraping, cfg, DT);
    expect(pushed.speed).toBeLessThan(free.speed);
    expect(free.speed - pushed.speed).toBeCloseTo(cfg.wallDecel * DT, 6);
  });

  it('一直朝墙开也顶不出去（每帧重新采样，模拟真实闭环）', () => {
    // 上面几条用的是固定的 ground 采样；这条把采样接回状态：
    // 一条沿 +z 的直路，中心线在 x=0，横向偏移就是车的 x。
    // 真实系统里 PhysicsSystem 每帧都会重算，这条测的就是那个闭环收不收敛。
    const straightWall = (s: KartState): GroundSample =>
      ground({ halfWidth, lateral: s.x, toCenterX: s.x > 0 ? -1 : 1, toCenterZ: 0 });

    let state = simulate(createKartState(), input({ throttle: 1 }), 2);
    let worst = 0;
    for (let i = 0; i < 60 * 6; i++) {
      // 一直往右打方向，车头会一直顶着右墙
      state = stepKart(state, input({ throttle: 1, steer: 1 }), straightWall(state), cfg, DT);
      worst = Math.max(worst, state.x);
    }
    // 采样差一帧，所以最多超出"一帧的位移"这么多，不会越顶越远
    expect(worst).toBeLessThan(halfWidth + cfg.maxSpeed * DT + 0.01);
    expect(worst).toBeGreaterThan(halfWidth - 0.5); // 确实顶到墙了，不是压根没开过去
  });

  it('射线打空但只超出一点点 -> 照样被墙挡住，不算掉出赛道（穿墙回归）', () => {
    // 真实系统里碰撞几何只铺到可行驶半宽外一点，采样又差一帧：
    // 满速斜着撞墙时"射线打空"和"该被墙挡住"会同时成立。
    // 早先的实现里护栏修正带了 onTrack 条件，结果就是直接穿墙飞出去（实测横向跑到 70m）。
    const start = { ...simulate(createKartState(), input({ throttle: 1 }), 2), lateralOffset: 11 };
    const justOut = ground({ halfWidth, lateral: 11, toCenterX: -1, toCenterZ: 0, onTrack: false });
    const next = stepKart(start, input({ throttle: 1 }), justOut, cfg, DT);
    expect(next.airborne).toBe(false);
    expect(next.fallTime).toBe(0);
    // 超界 1 米，就往回推 1 米
    const free = stepKart(start, input({ throttle: 1 }), ground({ halfWidth, lateral: 3 }), cfg, DT);
    expect(free.x - next.x).toBeCloseTo(1, 6);
  });

  it('已经在下落的车不会被墙从半空吸回来', () => {
    const falling = { ...simulate(createKartState(), input({ throttle: 1 }), 2), airborne: true };
    const justOut = ground({ halfWidth, lateral: 11, toCenterX: -1, toCenterZ: 0, onTrack: false });
    const next = stepKart(falling, input({ throttle: 1 }), justOut, cfg, DT);
    const free = stepKart(falling, input({ throttle: 1 }), ground({ halfWidth, lateral: 3, onTrack: false }), cfg, DT);
    expect(next.x).toBeCloseTo(free.x, 9); // 没被拉
    expect(next.airborne).toBe(true);
  });

  it('被扔到离赛道很远的地方不算蹭墙，该掉就掉', () => {
    const start = simulate(createKartState(), input({ throttle: 1 }), 2);
    const wayOut = ground({ halfWidth, lateral: 60, toCenterX: -1, toCenterZ: 0, onTrack: false });
    const next = stepKart(start, input({ throttle: 1 }), wayOut, cfg, DT);
    expect(next.airborne).toBe(true);
    expect(next.vy).toBeLessThan(0);
  });

  it('赛道内正常行驶不受影响', () => {
    const start = simulate(createKartState(), input({ throttle: 1 }), 2);
    const a = stepKart(start, input({ throttle: 1 }), inside, cfg, DT);
    const b = stepKart(start, input({ throttle: 1 }), FLAT_GROUND, cfg, DT);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.speed).toBeCloseTo(b.speed, 9);
  });
});

describe('掉出赛道', () => {
  const off = ground({
    onTrack: false,
    respawnX: 40,
    respawnY: 7,
    respawnZ: -25,
    respawnHeading: 1.2,
    progress: 0.66,
  });

  it('脚下没路 -> 进入下落，y 按重力往下掉', () => {
    const start = simulate(createKartState(), input({ throttle: 1 }), 2);
    const falling = simulateOn(start, input({ throttle: 1 }), off, 0.5);
    expect(falling.airborne).toBe(true);
    expect(falling.vy).toBeLessThan(0);
    expect(falling.y).toBeLessThan(start.y);
    // 自由落体：0.5s 下落约 g/2 * t^2
    expect(falling.y).toBeCloseTo(-0.5 * cfg.gravity * 0.5 ** 2, 0);
  });

  /** 抓住"刚重生那一帧"的状态。之后还在 off 上，会继续掉、继续加速，比不了精确值 */
  function respawnFrame(start: KartState, inp: InputState): KartState {
    let found: KartState | null = null;
    simulateOn(start, inp, off, cfg.respawnDelay + 0.5, (next, prev) => {
      if (!found && prev.airborne && !next.airborne) found = next;
    });
    expect(found).not.toBeNull();
    return found!;
  }

  it('掉够 respawnDelay 秒后重生到最近的样条点', () => {
    const start = simulate(createKartState(), input({ throttle: 1, steer: 0.5 }), 2);
    const before = simulateOn(start, input({ throttle: 1 }), off, cfg.respawnDelay - 0.1);
    expect(before.airborne).toBe(true);

    const after = respawnFrame(start, input({ throttle: 1 }));
    expect(after.x).toBe(off.respawnX);
    expect(after.z).toBe(off.respawnZ);
    expect(after.y).toBe(off.respawnY);
    expect(after.heading).toBe(off.respawnHeading);
    expect(after.airborne).toBe(false);
    expect(after.fallTime).toBe(0);
    expect(after.vy).toBe(0);
    expect(after.trackProgress).toBe(off.progress);
  });

  it('重生会清空速度和漂移蓄力', () => {
    const drifted = simulate(
      simulate(createKartState(), input({ throttle: 1 }), 2),
      input({ throttle: 1, steer: 1, drift: true }),
      cfg.chargeThresholds[2] + 0.3,
    );
    expect(drifted.driftLevel).toBe(3);
    const after = respawnFrame(drifted, input({ throttle: 1, steer: 1, drift: true }));
    expect(after.speed).toBe(0);
    expect(after.driftPhase).toBe('none');
    expect(after.driftCharge).toBe(0);
    expect(after.driftLevel).toBe(0);
    expect(after.boostTime).toBe(0);
  });

  it('掉一半又落回赛道 -> 计时清零，不重生', () => {
    const start = simulate(createKartState(), input({ throttle: 1 }), 2);
    const half = simulateOn(start, input({ throttle: 1 }), off, cfg.respawnDelay - 0.3);
    const landed = stepKart(half, input({ throttle: 1 }), ground({ height: half.y }), cfg, DT);
    expect(landed.airborne).toBe(false);
    expect(landed.fallTime).toBe(0);
    expect(landed.vy).toBe(0);
    expect(landed.x).not.toBe(off.respawnX);
  });

  it('悬空时地面法线回正到竖直', () => {
    const tilted = simulateOn(
      createKartState(),
      input(),
      ground({ normalX: 0.5, normalY: Math.sqrt(1 - 0.25), normalZ: 0 }),
      2,
    );
    expect(tilted.groundNormalX).toBeGreaterThan(0.4);
    const inAir = simulateOn(tilted, input(), off, 1);
    expect(inAir.groundNormalX).toBeCloseTo(0, 2);
    expect(inAir.groundNormalY).toBeCloseTo(1, 2);
  });
});
