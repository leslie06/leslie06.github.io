import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RaceProgress, type LapCompleted } from './RaceProgress';

const DT = 1 / 60;
/** 一圈 480 步 = 8 秒。选 480 的理由：8 的整数倍，sector 边界正好落在整步上 */
const STEPS_PER_LAP = 480;

/**
 * 沿正向开 laps 圈。update 内部会把 t 折回 [0,1)，所以这里直接喂递增的值。
 * @returns 途中拿到的所有 LapCompleted
 */
function driveForward(
  rp: RaceProgress,
  laps: number,
  stepsPerLap = STEPS_PER_LAP,
  dt = DT,
): LapCompleted[] {
  const events: LapCompleted[] = [];
  const start = rp.t;
  const total = Math.round(laps * stepsPerLap);
  for (let i = 1; i <= total; i++) {
    const e = rp.update(start + i / stepsPerLap, dt);
    if (e) events.push(e);
  }
  return events;
}

/** 倒车退 fraction 圈。 */
function driveBackward(rp: RaceProgress, fraction: number, steps: number, dt = DT): LapCompleted[] {
  const events: LapCompleted[] = [];
  const start = rp.t;
  for (let i = 1; i <= steps; i++) {
    const e = rp.update(start - (fraction * i) / steps, dt);
    if (e) events.push(e);
  }
  return events;
}

describe('架构约束', () => {
  it('RaceProgress / RaceState 不 import three、rapier 或 DOM', () => {
    for (const file of ['./RaceProgress.ts', './RaceState.ts', './formatTime.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec).not.toMatch(/three/i);
        expect(spec).not.toMatch(/rapier/i);
        expect(spec.startsWith('.')).toBe(true);
      }
      expect(src).not.toMatch(/\b(window|document|localStorage|THREE)\b/);
    }
  });
});

describe('正常过线加圈', () => {
  it('跑满一圈记一圈，圈速 = 累计的 dt', () => {
    const rp = new RaceProgress();
    const events = driveForward(rp, 1);

    expect(events).toHaveLength(1);
    expect(events[0]!.lap).toBe(1);
    expect(events[0]!.best).toBe(true);
    expect(events[0]!.time).toBeCloseTo(STEPS_PER_LAP * DT, 9);
    expect(rp.lap).toBe(1);
    expect(rp.lapTimes).toHaveLength(1);
    // 新一圈的计时从 0 重新开始
    expect(rp.lapTime).toBeCloseTo(0, 9);
  });

  it('半圈时 totalProgress = 0.5，没有事件', () => {
    const rp = new RaceProgress();
    const events = driveForward(rp, 0.5);

    expect(events).toHaveLength(0);
    expect(rp.lap).toBe(0);
    expect(rp.t).toBeCloseTo(0.5, 6);
    expect(rp.totalProgress).toBeCloseTo(0.5, 6);
    expect(rp.lapValid).toBe(true);
  });

  it('dt 传 0（倒计时期间）只跟 sector，不计时', () => {
    const rp = new RaceProgress();
    driveForward(rp, 0.25, STEPS_PER_LAP, 0);

    expect(rp.sector).toBe(2);
    expect(rp.lapTime).toBe(0);
    expect(rp.totalTime).toBe(0);
  });
});

describe('倒车过线不加圈', () => {
  it('发车就倒车退过起点线，再正着开回来也不加圈', () => {
    const rp = new RaceProgress();

    driveBackward(rp, 0.1, 48); // t: 0 -> 0.9
    expect(rp.lap).toBe(0);
    expect(rp.t).toBeCloseTo(0.9, 6);

    const events = driveForward(rp, 0.1); // 0.9 -> 1.0，正向过线
    expect(events).toHaveLength(0);
    expect(rp.lap).toBe(0);
    expect(rp.lapTimes).toHaveLength(0);
  });

  it('跑完一圈后倒车退回线外，圈数退回去；再开过来净得一圈，且时间算在同一圈里', () => {
    const rp = new RaceProgress();
    driveForward(rp, 1);
    expect(rp.lap).toBe(1);

    driveBackward(rp, 0.05, 24); // 退回 t = 0.95
    expect(rp.lap).toBe(0);
    expect(rp.lapTimes).toHaveLength(0);
    expect(rp.bestLap).toBeNull();

    const events = driveForward(rp, 0.05); // 再正着过线
    expect(events).toHaveLength(1);
    expect(rp.lap).toBe(1);
    expect(rp.lapTimes).toHaveLength(1);
    // 来回折腾的 48 步全部算进这一圈
    expect(rp.lapTimes[0]!).toBeCloseTo((STEPS_PER_LAP + 48) * DT, 9);
  });

  it('在赛道中段来回倒车不会丢 checkpoint', () => {
    const rp = new RaceProgress();
    driveForward(rp, 0.4); // sector 3
    driveBackward(rp, 0.1, 48); // 退回 sector 2
    driveForward(rp, 0.7); // 一路开到终点线

    expect(rp.lap).toBe(1);
  });
});

describe('漏 checkpoint 不计圈', () => {
  it('从赛道内侧横穿（t 跳变）之后过线不计圈', () => {
    const rp = new RaceProgress();
    driveForward(rp, 0.3);
    expect(rp.sector).toBe(2);

    // 一帧之内从 sector 2 跳到 sector 5：非相邻，判为抄近道
    rp.update(0.7, DT);
    expect(rp.sector).toBe(5);
    expect(rp.lapValid).toBe(false);
    expect(rp.missingCheckpoints).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const events = driveForward(rp, 0.3); // 0.7 -> 1.0
    expect(events).toHaveLength(0);
    expect(rp.lap).toBe(0);
  });

  it('抄近道之后老老实实再跑一整圈就能记上，计时不清零', () => {
    const rp = new RaceProgress();
    driveForward(rp, 0.3);
    rp.update(0.7, DT);
    driveForward(rp, 0.3);
    expect(rp.lap).toBe(0);

    const events = driveForward(rp, 1);
    expect(events).toHaveLength(1);
    expect(rp.lap).toBe(1);
    // 作废那一圈的时间没有被清掉，全部算在这一圈头上
    expect(events[0]!.time).toBeGreaterThan(STEPS_PER_LAP * DT);
  });

  it('checkpoint 数量可配', () => {
    const rp = new RaceProgress({ checkpointCount: 4 });
    expect(rp.checkpointT(0)).toBe(0);
    expect(rp.checkpointT(2)).toBe(0.5);
    expect(driveForward(rp, 1)).toHaveLength(1);
  });
});

describe('连续多圈的计时', () => {
  it('三圈匀速：每圈时间相同，totalTime = 三圈之和', () => {
    const rp = new RaceProgress();
    const events = driveForward(rp, 3);

    expect(events.map((e) => e.lap)).toEqual([1, 2, 3]);
    for (const e of events) expect(e.time).toBeCloseTo(STEPS_PER_LAP * DT, 9);
    // 第一圈是纪录，之后同样快但没更快，不算刷新
    expect(events.map((e) => e.best)).toEqual([true, false, false]);

    expect(rp.lap).toBe(3);
    expect(rp.lapTimes).toHaveLength(3);
    expect(rp.totalTime).toBeCloseTo(3 * STEPS_PER_LAP * DT, 8);
    expect(rp.bestLap).toBeCloseTo(STEPS_PER_LAP * DT, 9);
  });

  it('后一圈更快时刷新最佳圈速', () => {
    const rp = new RaceProgress();
    driveForward(rp, 1, 480); // 8.000s
    driveForward(rp, 1, 240); // 4.000s
    driveForward(rp, 1, 360); // 6.000s

    expect(rp.lapTimes.map((t) => Number(t.toFixed(3)))).toEqual([8, 4, 6]);
    expect(rp.bestLap).toBeCloseTo(240 * DT, 9);
    expect(rp.lastLap).toBeCloseTo(360 * DT, 9);
    expect(rp.totalTime).toBeCloseTo((480 + 240 + 360) * DT, 8);
    expect(rp.totalProgress).toBeCloseTo(3, 6);
  });

  it('中间夹一个作废圈也不会打乱后面的计时', () => {
    const rp = new RaceProgress();
    driveForward(rp, 1, 240); // 有效，4.000s
    driveForward(rp, 0.3, 240);
    rp.update(0.7, DT); // 抄近道
    driveForward(rp, 0.3, 240); // 过线但作废
    driveForward(rp, 1, 240); // 再跑一圈，这一圈把作废的时间也背上

    expect(rp.lap).toBe(2);
    expect(rp.lapTimes[0]!).toBeCloseTo(240 * DT, 9);
    expect(rp.lapTimes[1]!).toBeCloseTo((240 * 0.3 + 1 + 240 * 0.3 + 240) * DT, 9);
    expect(rp.bestLap).toBeCloseTo(240 * DT, 9);
  });
});

describe('getLastCheckpoint', () => {
  it('返回当前 sector 的入口，掉出赛道就送回那里', () => {
    const rp = new RaceProgress({ checkpointCount: 8 });
    expect(rp.getLastCheckpoint()).toEqual({ index: 0, t: 0 });

    driveForward(rp, 0.4); // sector 3
    expect(rp.getLastCheckpoint()).toEqual({ index: 3, t: 0.375 });

    driveForward(rp, 0.2); // sector 4
    expect(rp.getLastCheckpoint().index).toBe(4);
  });
});

describe('reset', () => {
  it('清空圈数、计时和 checkpoint', () => {
    const rp = new RaceProgress();
    driveForward(rp, 2);
    rp.reset(0);

    expect(rp.lap).toBe(0);
    expect(rp.lapTimes).toHaveLength(0);
    expect(rp.bestLap).toBeNull();
    expect(rp.totalTime).toBe(0);
    expect(rp.sector).toBe(0);
    expect(driveForward(rp, 1)).toHaveLength(1);
  });
});

describe('健壮性', () => {
  it('NaN 的 t 直接忽略，不会污染状态', () => {
    const rp = new RaceProgress();
    driveForward(rp, 0.5);
    const before = rp.t;
    expect(rp.update(Number.NaN, DT)).toBeNull();
    expect(rp.t).toBe(before);
  });

  it('t 超出 [0,1) 会自动折回', () => {
    const rp = new RaceProgress();
    rp.update(2.25, 0);
    expect(rp.t).toBeCloseTo(0.25, 9);
    rp.update(-0.25, 0);
    expect(rp.t).toBeCloseTo(0.75, 9);
  });
});
