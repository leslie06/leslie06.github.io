import { describe, expect, it } from 'vitest';
import { TAIL, Tail, alertRate } from './Tail';

describe('Tail', () => {
  it('fills faster the closer, and faster in front of him', () => {
    expect(alertRate(5, false)).toBeGreaterThan(alertRate(15, false));
    expect(alertRate(15, false)).toBeGreaterThan(alertRate(24, false));
    expect(alertRate(15, true)).toBeCloseTo(alertRate(15, false) * TAIL.AHEAD);
    expect(alertRate(30, false)).toBe(0);
    expect(alertRate(80, false)).toBeLessThan(0);
  });

  it('a sensible distance never gets spotted; sitting on his bumper does in a few seconds', () => {
    const a = new Tail();
    a.update(1 / 60, 50, false);
    for (let i = 0; i < 60 * 300; i++) expect(a.update(1 / 60, 30 + 60 * Math.abs(Math.sin(i / 600)), false)).toMatch(/ok|far/);
    expect(a.alert).toBe(0);
    const b = new Tail();
    b.update(1 / 60, 50, false);
    let t = 0, s = '';
    while ((s = b.update(1 / 60, 6, false)) !== 'spotted') t += 1 / 60;
    expect(t).toBeGreaterThan(2); expect(t).toBeLessThan(4);
  });

  it('drains when dropping back, and a knock is most of the way', () => {
    const a = new Tail();
    a.update(1 / 60, 50, false);
    for (let i = 0; i < 60 * 3; i++) a.update(1 / 60, 15, false);
    const mid = a.alert;
    expect(mid).toBeGreaterThan(0.2);
    for (let i = 0; i < 60 * 3; i++) a.update(1 / 60, 60, false);
    expect(a.alert).toBeLessThan(mid);
    expect(a.peak).toBeCloseTo(mid);
    a.bump();
    expect(a.alert).toBeGreaterThan(0.6);
  });

  it('is lost after a while too far back, or at once past GONE', () => {
    const a = new Tail();
    a.update(1 / 60, 50, false);
    expect(a.update(1, TAIL.FAR + 10, false)).toBe('far');
    let s = '';
    for (let i = 0; i < 10 && s !== 'lost'; i++) s = a.update(1, TAIL.FAR + 10, false);
    expect(s).toBe('lost');
    const b = new Tail(); b.update(1 / 60, 50, false);
    expect(b.update(1 / 60, TAIL.GONE + 1, false)).toBe('lost');
  });

  it('gives the player time to catch up before the tail proper', () => {
    const a = new Tail();
    for (let i = 0; i < 40; i++) expect(a.update(1, 300, false)).toBe('far');
    expect(a.update(1, 60, false)).toBe('ok');
    const b = new Tail();
    let s = '';
    for (let i = 0; i <= TAIL.CATCH_SECS + 1 && s !== 'lost'; i++) s = b.update(1, 300, false);
    expect(s).toBe('lost');
  });
});
