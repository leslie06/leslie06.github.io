import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';
import { DEFAULT_RACE_CONFIG, RaceState, type RaceEvent } from './RaceState';

const DT = 1 / 60;
const STEPS_PER_LAP = 480;

const FULL_INPUT: InputState = { steer: 1, throttle: 1, brake: 0, drift: true };

/** 把倒计时跑完，期间所有车停在 t 上不动。返回倒计时期间的事件 */
function runCountdown(race: RaceState, positions: Record<string, number>): RaceEvent[] {
  const steps = Math.ceil(DEFAULT_RACE_CONFIG.countdownDuration / DT);
  for (let i = 0; i < steps; i++) race.update(DT, positions);
  return race.consumeEvents();
}

/**
 * 用 steps 步把每辆车各自往前推 laps[id] 圈（匀速）。
 * @param offsets 起始进度，接着上一段跑时要传
 */
function drive(
  race: RaceState,
  laps: Record<string, number>,
  steps: number,
  offsets: Record<string, number> = {},
): void {
  const ids = Object.keys(laps);
  for (let i = 1; i <= steps; i++) {
    const positions: Record<string, number> = {};
    for (const id of ids) positions[id] = (offsets[id] ?? 0) + (laps[id]! * i) / steps;
    race.update(DT, positions);
  }
}

describe('倒计时', () => {
  it('倒计时期间锁输入，读秒 3-2-1 然后 GO', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }]);

    expect(race.phase).toBe('countdown');
    expect(race.isInputLocked('p')).toBe(true);
    expect(race.gateInput('p', FULL_INPUT)).toEqual(NEUTRAL_INPUT);
    expect(race.countdown).toBe(3);

    const events = runCountdown(race, { p: 0 });

    expect(events.filter((e) => e.type === 'countdownTick').map((e) => e.count)).toEqual([3, 2, 1]);
    expect(events.at(-1)).toEqual({ type: 'go' });
    expect(race.phase).toBe('racing');
    expect(race.isInputLocked('p')).toBe(false);
    expect(race.gateInput('p', FULL_INPUT)).toBe(FULL_INPUT);
  });

  it('倒计时期间不累计比赛时间和圈速', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }]);
    runCountdown(race, { p: 0 });

    expect(race.time).toBe(0);
    expect(race.getProgress('p')!.totalTime).toBe(0);
  });
});

describe('比赛结束', () => {
  it('跑满 3 圈进入 finished，输入被锁住', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }]);
    runCountdown(race, { p: 0 });

    drive(race, { p: 3 }, 3 * STEPS_PER_LAP);

    expect(race.phase).toBe('finished');
    expect(race.isInputLocked('p')).toBe(true);
    expect(race.gateInput('p', FULL_INPUT)).toEqual(NEUTRAL_INPUT);

    const standing = race.getStanding('p')!;
    expect(standing.finished).toBe(true);
    expect(standing.place).toBe(1);
    expect(standing.finishTime).toBeCloseTo(3 * STEPS_PER_LAP * DT, 6);

    const progress = race.getProgress('p')!;
    expect(progress.lapTimes).toHaveLength(3);
    expect(progress.totalTime).toBeCloseTo(3 * STEPS_PER_LAP * DT, 6);
  });

  it('冲线之后计时停住，即使车还在往前滑', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }]);
    runCountdown(race, { p: 0 });
    drive(race, { p: 3 }, 3 * STEPS_PER_LAP);

    const finishTime = race.getProgress('p')!.totalTime;
    drive(race, { p: 0.25 }, 120, { p: 3 });
    expect(race.getProgress('p')!.totalTime).toBeCloseTo(finishTime, 9);
  });

  it('圈数不够不会结束', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }], { totalLaps: 5 });
    runCountdown(race, { p: 0 });
    drive(race, { p: 3 }, 3 * STEPS_PER_LAP);

    expect(race.phase).toBe('racing');
    expect(race.getProgress('p')!.lap).toBe(3);
  });

  it('发出 lap / racerFinished / raceFinished 事件', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }]);
    runCountdown(race, { p: 0 });
    drive(race, { p: 3 }, 3 * STEPS_PER_LAP);

    const types = race.consumeEvents().map((e) => e.type);
    expect(types).toEqual(['lap', 'lap', 'lap', 'racerFinished', 'raceFinished']);
  });
});

describe('名次', () => {
  it('按 totalProgress 降序，跑得多的排前面', () => {
    const race = new RaceState([
      { id: 'a', isPlayer: true },
      { id: 'b' },
      { id: 'c' },
    ]);
    runCountdown(race, { a: 0, b: 0, c: 0 });

    // b 最快、a 次之、c 最慢
    drive(race, { a: 0.5, b: 0.9, c: 0.2 }, STEPS_PER_LAP);

    expect(race.standings.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(race.standings.map((s) => s.place)).toEqual([1, 2, 3]);
    expect(race.getStanding('a')!.place).toBe(2);
    expect(race.racerCount).toBe(3);
  });

  it('已冲线的按冲线顺序排在所有未冲线的前面', () => {
    const race = new RaceState([
      { id: 'a', isPlayer: true },
      { id: 'b' },
    ]);
    runCountdown(race, { a: 0, b: 0 });

    // b 先跑完 3 圈，a 只跑了 2.9 圈
    drive(race, { a: 2.9, b: 3 }, 3 * STEPS_PER_LAP);

    expect(race.getStanding('b')!.finished).toBe(true);
    expect(race.standings.map((s) => s.id)).toEqual(['b', 'a']);
    // 玩家还没冲线，比赛不结束
    expect(race.phase).toBe('racing');
    // 冲线的那辆车自己被锁输入，玩家不受影响
    expect(race.isInputLocked('b')).toBe(true);
    expect(race.isInputLocked('a')).toBe(false);
  });

  it('多圈领先的排在同 sector 但圈数少的前面', () => {
    const race = new RaceState([{ id: 'a', isPlayer: true }, { id: 'b' }]);
    runCountdown(race, { a: 0, b: 0 });
    drive(race, { a: 2.5, b: 1.5 }, STEPS_PER_LAP);

    expect(race.getProgress('a')!.totalProgress).toBeCloseTo(2.5, 6);
    expect(race.getProgress('b')!.totalProgress).toBeCloseTo(1.5, 6);
    expect(race.standings[0]!.id).toBe('a');
  });
});

describe('restart', () => {
  it('回到倒计时，圈数计时全部清空', () => {
    const race = new RaceState([{ id: 'p', isPlayer: true }]);
    runCountdown(race, { p: 0 });
    drive(race, { p: 3 }, 3 * STEPS_PER_LAP);
    expect(race.phase).toBe('finished');

    race.restart();

    expect(race.phase).toBe('countdown');
    expect(race.countdown).toBe(3);
    expect(race.time).toBe(0);
    expect(race.getProgress('p')!.lap).toBe(0);
    expect(race.getProgress('p')!.bestLap).toBeNull();
    expect(race.getStanding('p')!.finished).toBe(false);
    expect(race.consumeEvents()).toEqual([]);

    runCountdown(race, { p: 0 });
    drive(race, { p: 3 }, 3 * STEPS_PER_LAP);
    expect(race.phase).toBe('finished');
  });
});
