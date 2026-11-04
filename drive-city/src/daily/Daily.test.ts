import { describe, expect, it } from 'vitest';
import { advance, CARD, dayOf, FULL_BONUS, grant, HAD_CASH, landmarkOf, loadDaily, payOf, pick, refresh, SEASONS, streakOf, swap, untilTurn } from './Daily';
import { TASKS, taskOf, type Ctx } from './Tasks';

const ALL: Ctx = { rabbitsLeft: 5, checkinsLeft: 5, owns: true, landmark: true };
const NONE: Ctx = { rabbitsLeft: 0, checkinsLeft: 0, owns: false, landmark: false };
const at = (iso: string) => dayOf(Date.parse(iso));

/** Do task `i` of today's in one go. */
const finish = (s: ReturnType<typeof loadDaily>, i: number) => advance(s, i, taskOf(s.tasks[i].id)!.n, s.day);

describe('每日任务 (daily/)', () => {
  it('turns the day over at 5 in the morning, Beijing time', () => {
    expect(at('2026-11-04T04:59:00+08:00')).toBe(at('2026-11-03T12:00:00+08:00'));
    expect(at('2026-11-04T05:00:00+08:00')).toBe(at('2026-11-03T12:00:00+08:00') + 1);
    expect(at('2026-11-04T23:59:00+08:00')).toBe(at('2026-11-05T04:00:00+08:00'));
    expect(untilTurn(Date.parse('2026-11-04T03:00:00+08:00'))).toBe(2 * 3_600_000);
  });

  it('sets one of each tier, of three kinds, the same for the same day and player', () => {
    for (let d = 100; d < 160; d++) {
      const a = pick(d, 42, ALL);
      expect(a.map((q) => taskOf(q.id)!.tier)).toEqual([0, 1, 2]);
      expect(new Set(a.map((q) => taskOf(q.id)!.cat)).size).toBe(3);
      expect(pick(d, 42, ALL)).toEqual(a);
    }
    // another player another set (on most days)
    let same = 0;
    for (let d = 100; d < 160; d++) if (JSON.stringify(pick(d, 42, ALL)) === JSON.stringify(pick(d, 7, ALL))) same++;
    expect(same).toBeLessThan(10);
  });

  it('sets only what is open to the player', () => {
    const shut = TASKS.filter((d) => d.open && !d.open(NONE)).map((d) => d.id);
    expect(shut).toEqual(expect.arrayContaining(['collect', 'landmark', 'checkin', 'rabbit']));
    for (let d = 0; d < 200; d++) for (const q of pick(d, 3, NONE)) expect(shut).not.toContain(q.id);
  });

  it('gives a new set each day, keeps it through the day, and not when the clock goes back', () => {
    const s = loadDaily(null, 9);
    expect(refresh(s, 500, ALL)).toBe(true);
    expect(s.tasks).toHaveLength(3);
    advance(s, 0, 1, 500);
    const today = JSON.stringify(s.tasks);
    expect(refresh(s, 500, ALL)).toBe(false);
    expect(refresh(s, 499, ALL)).toBe(false);
    expect(JSON.stringify(s.tasks)).toBe(today);
    expect(refresh(s, 501, ALL)).toBe(true);
    expect(s.tasks.every((q) => q.got === 0 && !q.done)).toBe(true);
    expect(s.days).toBe(2);
    // the clock back a day after that: tomorrow's stays
    expect(refresh(s, 500, ALL)).toBe(false);
    expect(s.day).toBe(501);
  });

  it('counts up, says half way, and pays when done (a best keeps the largest)', () => {
    const s = loadDaily(null, 1);
    s.day = 10; s.seen = 10;
    s.tasks = [{ id: 'near', got: 0, done: false }, { id: 'fares', got: 0, done: false }, { id: 'shift', got: 0, done: false }];
    expect(advance(s, 0, 4, 10)).toBeNull();
    expect(advance(s, 0, 1, 10)).toEqual({ half: true });
    expect(advance(s, 0, 5, 10)).toEqual({ paid: 1000 });
    expect(advance(s, 0, 1, 10)).toBeNull();
    // a best: the most so far, not the sum
    advance(s, 2, 900, 10); advance(s, 2, 800, 10);
    expect(s.tasks[2].got).toBe(900);
    // not on another day's set
    expect(advance(s, 1, 3, 11)).toBeNull();
  });

  it('pays more for days in a row, up to half as much again, and starts over after a day missed', () => {
    expect(payOf(0, 1)).toBe(1000);
    expect(payOf(0, 2)).toBe(1100);
    expect(payOf(2, 6)).toBe(6000);
    expect(payOf(2, 30)).toBe(6000);
    const s = loadDaily(null, 1);
    for (const d of [20, 21, 22]) { refresh(s, d, ALL); finish(s, 0); }
    expect(s.streak).toBe(3);
    expect(streakOf(s, 23)).toBe(3);
    expect(streakOf(s, 24)).toBe(0);
    refresh(s, 24, ALL);
    expect(finish(s, 0)?.paid).toBe(payOf(0, 1));
    expect(s.streak).toBe(1);
  });

  it('stamps the card for all three, and a full card starts the next season', () => {
    const s = loadDaily(null, 1);
    for (let d = 0; d < CARD; d++) {
      refresh(s, 100 + d * 2, ALL);   // a day missed between each: the card does not mind
      finish(s, 0); finish(s, 1);
      const step = finish(s, 2)!;
      expect(step.full?.stamp).toBe(d + 1);
      expect(step.full?.bonus).toBe(FULL_BONUS);
      expect(step.full?.reward).toEqual(SEASONS[0].rewards[d]);
      expect(step.full?.card).toBe(d === CARD - 1);
    }
    expect(s.stamps).toBe(0);
    expect(s.season).toBe(1);
  });

  it('gives a paint once, and money for a thing already had', () => {
    const s = loadDaily(null, 1);
    const paint = SEASONS[0].rewards[1];
    expect(grant(s, paint, () => false)).toEqual(paint);
    expect(s.paints).toEqual(['#c8102e']);
    expect(grant(s, paint, () => false)).toEqual({ cash: HAD_CASH });
    const hat = SEASONS[0].rewards[3];
    expect(grant(s, hat, () => false)).toEqual(hat);
    expect(grant(s, hat, () => true)).toEqual({ cash: HAD_CASH });
  });

  it('swaps one task a day for another of its tier and of a kind not on the list', () => {
    const s = loadDaily(null, 5);
    refresh(s, 300, ALL);
    const before = s.tasks.map((q) => q.id);
    expect(swap(s, 1, ALL)).toBe(true);
    expect(s.tasks[1].id).not.toBe(before[1]);
    expect(taskOf(s.tasks[1].id)!.tier).toBe(1);
    expect(new Set(s.tasks.map((q) => taskOf(q.id)!.cat)).size).toBe(3);
    expect(swap(s, 2, ALL)).toBe(false);
    refresh(s, 301, ALL);
    finish(s, 0);
    expect(swap(s, 0, ALL)).toBe(false);   // done
    expect(swap(s, 2, ALL)).toBe(true);
  });

  it('picks one landmark a day for everyone, not the same two days running', () => {
    const ids = ['tiantan', 'gugong', 'cctv', 'niaochao', 'yiheyuan'];
    for (let d = 0; d < 100; d++) {
      expect(landmarkOf(d, ids)).toBe(landmarkOf(d, [...ids].reverse()));
      expect(landmarkOf(d, ids)).not.toBe(landmarkOf(d - 1, ids));
    }
    expect(landmarkOf(1, [])).toBeNull();
  });

  it('reads a save, and survives a broken one', () => {
    expect(loadDaily('{oops', 3).salt).toBe(3);
    const s = loadDaily(JSON.stringify({ salt: 77, day: 9, tasks: [{ id: 'near', got: 4 }, { id: 'gone', got: 1 }], stamps: 99, paints: ['#c8102e', 'red'], streak: 2, last: 8 }), 3);
    expect(s.salt).toBe(77);
    expect(s.tasks).toEqual([{ id: 'near', got: 4, done: false }]);
    expect(s.stamps).toBe(CARD - 1);
    expect(s.paints).toEqual(['#c8102e']);
    // an old set (fewer than three) is filled on the day
    expect(refresh(s, 9, ALL)).toBe(true);
    expect(s.tasks).toHaveLength(3);
  });
});
