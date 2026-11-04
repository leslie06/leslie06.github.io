import { describe, expect, it } from 'vitest';
import { accrue, AWAKE_MIN, buyBlocked, CAP_DAYS, capOf, dailyOf, ESTATE_IDS, loadEstate, PROPERTIES, sleepHours, upBlocked, wakeHour } from './Ledger';

describe('产业 (estate/)', () => {
  it('pays each property back in about a week of game days, its improvements too', () => {
    for (const id of ESTATE_IDS) {
      const p = PROPERTIES[id];
      expect(p.price / p.income).toBeGreaterThan(5);
      expect(p.price / p.income).toBeLessThan(9);
      expect(p.ups.length).toBe(2);
      for (const u of p.ups) expect(u.price / u.income).toBeGreaterThan(5), expect(u.price / u.income).toBeLessThan(9);
    }
  });

  it('fills the counter by the game hour, up to three days', () => {
    const s = loadEstate(null);
    s.owned.grill = { ups: [], till: 0 };
    expect(accrue(s, 12).grill).toBeCloseTo(450);
    expect(s.owned.grill.till).toBeCloseTo(450);
    accrue(s, 24 * 10);
    expect(s.owned.grill.till).toBe(900 * CAP_DAYS);
    // what is not owned takes nothing; no time, nothing
    expect(accrue(s, 0)).toEqual({});
    expect(s.owned.bar).toBeUndefined();
  });

  it('adds the improvements to the day', () => {
    const h = { ups: ['stove'], till: 0 };
    expect(dailyOf('grill', h)).toBe(1350);
    expect(capOf('grill', h)).toBe(1350 * CAP_DAYS);
    expect(dailyOf('grill', { ups: ['stove', 'hand'], till: 0 })).toBe(1850);
    expect(dailyOf('hhbar', undefined)).toBe(4500);
  });

  it('says why it cannot be bought', () => {
    const s = loadEstate(null);
    expect(buyBlocked(s, 'grill', 5000)).toEqual({ key: 'nl.panel.short', n: 1000 });
    expect(buyBlocked(s, 'grill', 6000)).toBeNull();
    s.owned.grill = { ups: [], till: 0 };
    expect(buyBlocked(s, 'grill', 99999)).toEqual({ key: 'est.owned' });
    expect(upBlocked(s, 'bar', 'erhu', 99999)).toEqual({ key: 'est.notYours' });
    expect(upBlocked(s, 'grill', 'stove', 100)).toEqual({ key: 'nl.panel.short', n: 2900 });
    s.owned.grill.ups.push('stove');
    expect(upBlocked(s, 'grill', 'stove', 99999)).toEqual({ key: 'est.upDone' });
    expect(upBlocked(s, 'grill', 'nope', 99999)).toEqual({ key: 'est.notYours' });
  });

  it('sleeps to the morning from the evening, to the evening from the day', () => {
    expect(sleepHours(22)).toBe(9);
    expect(wakeHour(22)).toBe(7);
    expect(sleepHours(2)).toBe(5);
    expect(sleepHours(18)).toBe(13);
    expect(sleepHours(10)).toBe(8);
    expect(wakeHour(10)).toBe(18);
    expect(wakeHour(5)).toBe(18);
  });

  it('reads a save, and survives a broken one', () => {
    const empty = { owned: {}, safehouse: false, awake: AWAKE_MIN, earned: 0 };
    expect(loadEstate(null)).toEqual(empty);
    expect(loadEstate('{oops')).toEqual(empty);
    // unknown properties and improvements dropped, the counter held to its cap
    expect(loadEstate(JSON.stringify({ owned: { grill: { ups: ['stove', 'stove', 'gold'], till: 1e9 }, bank: { ups: [], till: 5 } }, safehouse: true, awake: 2, earned: 12.6 })))
      .toEqual({ owned: { grill: { ups: ['stove'], till: 1350 * CAP_DAYS } }, safehouse: true, awake: 2, earned: 12 });
  });
});
