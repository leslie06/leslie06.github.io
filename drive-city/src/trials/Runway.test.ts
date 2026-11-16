import { describe, expect, it } from 'vitest';
import { RUNWAYS } from './Courses';
import { MIN_DIST, MIN_KMH, RunwayRun } from './Runway';

describe('跑道极速的记分', () => {
  it('记这一趟的最高时速，离开跑道 0.3 秒后结束', () => {
    const r = new RunwayRun('36r');
    let done = false, t = 0;
    // 0→300 km/h 加速 20 秒，再减速
    for (; t < 20 && !done; t += 1 / 60) done = r.step(1 / 60, (t / 20) * 300 / 3.6, true);
    for (let k = 0; k < 60 && !done; k++) done = r.step(1 / 60, 50, true);
    expect(done).toBe(false);
    expect(r.max).toBeGreaterThan(299);
    expect(r.max).toBeLessThan(300.1);
    let steps = 0;
    while (!done && steps < 100) { done = r.step(1 / 60, 50, false); steps++; }
    expect(done).toBe(true);
    expect(steps).toBeGreaterThanOrEqual(18);
    expect(steps).toBeLessThanOrEqual(20);
    expect(r.counts).toBe(true);
  });

  it('跑出速度后停在跑道上 4 秒也结束；太慢、太短不算成绩', () => {
    const r = new RunwayRun('01');
    for (let k = 0; k < 600; k++) r.step(1 / 60, 30, true);
    let done = false, k = 0;
    for (; k < 600 && !done; k++) done = r.step(1 / 60, 0, true);
    expect(done).toBe(true);
    expect(k).toBeGreaterThan(235);
    const slow = new RunwayRun('01');
    for (let j = 0; j < 1200; j++) slow.step(1 / 60, (MIN_KMH - 5) / 3.6, true);
    expect(slow.counts).toBe(false);
    const short = new RunwayRun('01');
    short.step(1, 100 / 3.6, true);
    expect(short.dist).toBeLessThan(MIN_DIST);
    expect(short.counts).toBe(false);
  });

  it('三条跑道的 id 不重复', () => {
    expect(new Set(RUNWAYS.map((r) => r.id)).size).toBe(3);
  });
});
