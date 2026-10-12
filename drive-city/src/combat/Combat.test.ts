import { describe, expect, it } from 'vitest';
import { Brain, TOUGH } from './Brain';
import { COMBO, Combo, CHAIN_GAP, inReach, pickTarget } from './Moves';
import { STRIKE } from '../character/Animator';

const DT = 1 / 60;
const run = (b: Brain, secs: number, view: Partial<Parameters<Brain['step']>[0]> = {}, each?: (landed: boolean) => void) => {
  for (let t = 0; t < secs; t += DT) { const o = b.step({ px: 0, pz: 0, others: [], token: false, ...view }, DT); each?.(o.landed); }
};

describe('a gang member in a fist fight', () => {
  it('runs in to a ring round the player and keeps it while it has no turn', () => {
    Brain.seed(3);
    const b = new Brain(12, 0);
    run(b, 6);
    expect(b.state).toBe('circle');
    let lo = Infinity, hi = 0;
    run(b, 10, {}, () => { const d = Math.hypot(b.x, b.z); lo = Math.min(lo, d); hi = Math.max(hi, d); });
    expect(lo).toBeGreaterThan(2.0);
    expect(hi).toBeLessThan(3.9);
  });

  it('with the token closes in, winds up where the player can see it, strikes and backs off', () => {
    Brain.seed(5);
    const b = new Brain(3, 0);
    run(b, 3);   // into the ring, its first cool-down over
    const seen: string[] = [];
    let landed = 0, windup = 0;
    for (let t = 0; t < 4; t += DT) {
      const o = b.step({ px: 0, pz: 0, others: [], token: true }, DT);
      if (seen[seen.length - 1] !== b.state) seen.push(b.state);
      if (b.telegraph) windup += DT;
      if (o.landed) landed++;
      if (b.state === 'circle' && seen.includes('recover')) break;
    }
    expect(seen).toEqual(expect.arrayContaining(['close', 'windup', 'strike', 'recover']));
    expect(seen.indexOf('windup')).toBeLessThan(seen.indexOf('strike'));
    expect(windup).toBeGreaterThan(TOUGH.windup * 0.8);   // the counter window
    expect(landed).toBe(1);
    expect(b.cool).toBeGreaterThan(1);
  });

  it('misses a player who has stepped out of reach', () => {
    Brain.seed(7);
    const b = new Brain(3, 0);
    run(b, 3);
    let landed = 0;
    for (let t = 0; t < 3; t += DT) {
      const away = b.state === 'strike' ? 3 : 0;   // the player backs off as the blow comes
      const o = b.step({ px: -away * Math.sign(b.x || 1), pz: 0, others: [], token: true }, DT);
      if (o.landed) landed++;
    }
    expect(landed).toBe(0);
  });

  it('shrugs off a plain blow mid wind-up (and still lands), is stopped by a counter, and stays down at no health', () => {
    Brain.seed(9);
    const b = new Brain(3, 0);
    run(b, 3);
    for (let t = 0; t < 3 && !b.telegraph; t += DT) b.step({ px: 0, pz: 0, others: [], token: true }, DT);
    expect(b.telegraph).toBe(true);
    expect(b.hit(10)).toBe('armored');
    let landed = 0;
    run(b, 1.2, { token: true }, (l) => { if (l) landed++; });
    expect(landed).toBe(1);
    run(b, 4, { token: true });
    for (let t = 0; t < 4 && !b.telegraph; t += DT) b.step({ px: 0, pz: 0, others: [], token: true }, DT);
    b.countered();
    expect(b.hit(10, true)).toBe('flinch');
    landed = 0;
    run(b, 1, { token: true }, (l) => { if (l) landed++; });
    expect(landed).toBe(0);
    expect(b.hit(1000)).toBe('ko');
    expect(b.standing).toBe(false);
    run(b, 2);
    expect(b.state).toBe('ko');
  });

  it('keeps out of the others\' way', () => {
    Brain.seed(11);
    const bs = [new Brain(5, 0), new Brain(5.2, 0.1), new Brain(4.8, -0.1)];
    let closest = Infinity;
    for (let t = 0; t < 8; t += DT) {
      for (const b of bs) b.step({ px: 0, pz: 0, others: bs.filter((o) => o !== b), token: false }, DT);
      if (t > 3) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) closest = Math.min(closest, Math.hypot(bs[i].x - bs[j].x, bs[i].z - bs[j].z));
    }
    expect(closest).toBeGreaterThan(0.8);
  });
});

describe('the player\'s moves', () => {
  it('goes for the one the stick points at, then the nearest', () => {
    const c = [{ x: 2, z: 0 }, { x: -1.5, z: 0 }, { x: 0, z: 9 }];
    expect(pickTarget(0, 0, 1, 0, c)).toBe(0);                 // pushing right: the one on the right, though further
    expect(pickTarget(0, 0, -1, 0, c)).toBe(1);
    expect(pickTarget(0, 0, 0, 1, c)).toBe(1);                 // pushing at someone out of reach: the nearest
    expect(pickTarget(0, 0, 0, 1, [{ x: 0, z: 9 }])).toBe(-1);
  });

  it('chains jab, cross, hook, kick on presses in time, and starts over after a pause', () => {
    const c = new Combo();
    let now = 0;
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) { const k = c.next(now); seq.push(COMBO[k].action); c.started(k, now); now += STRIKE[COMBO[k].action].hit + 0.1; }
    expect(seq).toEqual(['jab', 'cross', 'hook', 'kick', 'jab']);
    const k = c.next(now); c.started(k, now);
    now += STRIKE[COMBO[k].action].dur + CHAIN_GAP + 0.05;
    expect(COMBO[c.next(now)].action).toBe('jab');
    expect(COMBO[3].knock).toBe(true);
  });

  it('lands a blow only in front and within reach', () => {
    expect(inReach(0, 0, 0, 0, 1.2)).toBe(true);
    expect(inReach(0, 0, 0, 0, -1.2)).toBe(false);      // behind
    expect(inReach(0, 0, 0, 0, 2.5)).toBe(false);       // too far
    expect(inReach(0, 0, Math.PI / 2, 1.3, 0.2)).toBe(true);
  });
});
