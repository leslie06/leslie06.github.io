import { describe, expect, it } from 'vitest';
import type { Actor, Blip, CombatApi } from '../game/Contracts';
import { fight } from './Fight';
import { Runner } from './Runner';

/** A combat/ stand-in: each brawl places `per` people (or none while `empty`) and is resolved by hand. */
class FakeCombat {
  per = 3; empty = false;
  brawls: { actors: { alive: boolean; state: 'script' | 'down'; downFor: number; pos: { x: number; z: number } }[]; resolve: (r: 'won' | 'lost' | 'fled') => void; ended: boolean }[] = [];
  brawl() {
    let resolve: (r: 'won' | 'lost' | 'fled') => void = () => {};
    const done = new Promise<'won' | 'lost' | 'fled'>((r) => { resolve = r; });
    const actors = this.empty ? [] : Array.from({ length: this.per }, () => ({ alive: true, state: 'script' as const, downFor: 2, pos: { x: 0, z: 0 }, release() { this.alive = false; } }));
    const b = { actors, resolve, ended: false };
    this.brawls.push(b);
    return { done, end: () => { b.ended = true; }, actors: actors as unknown as Actor[] };
  }
}
const setup = () => {
  const combat = new FakeCombat();
  const env = { combat: combat as unknown as CombatApi, blips: [] as Blip[], objective: () => {} };
  const kos: number[] = [];
  const r = new Runner<{ ko: number }>({ id: 'f', init: () => ({ ko: 0 }), steps: [fight(env, { id: 'f', line: '', at: () => ({ x: 0, z: 0 }), n: 3, fled: 'fled', ko: (ctx, n) => { kos.push(n); ctx.state.ko = n; } })] });
  return { combat, r, kos };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('campaign fight step', () => {
  it('passes when its brawl is won, counting the knock-outs', async () => {
    const { combat, r, kos } = setup();
    r.start(); r.update(0.1);
    const b = combat.brawls[0];
    b.actors[0].state = 'down'; b.actors[0].downFor = 1e9;
    r.update(0.1);
    expect(r.data?.ko).toBe(1);
    b.resolve('won'); await flush(); r.update(0.1);
    expect(r.state).toBe('passed');
    expect(kos.at(-1)).toBe(3);
  });

  it('fails when the player runs from it', async () => {
    const { combat, r } = setup();
    r.start(); r.update(0.1);
    combat.brawls[0].resolve('fled'); await flush(); r.update(0.1);
    expect(r.state).toBe('failed');
    expect(r.reason).toBe('fled');
  });

  it('tries again while nobody could be placed, and a brawl whose people all vanished is not a win', async () => {
    // the streets round it not streamed in yet: no people, so no fight - it waits and tries again
    const { combat, r } = setup();
    combat.empty = true;
    r.start();
    for (let i = 0; i < 8; i++) r.update(0.1);
    expect(combat.brawls.length).toBeGreaterThan(1);
    expect(r.state).toBe('running');
    // placed, then dropped by people/ before a blow (a retry from far away): combat/ calls that brawl 'won'
    combat.empty = false;
    for (let i = 0; i < 8; i++) r.update(0.1);
    const first = combat.brawls.at(-1)!;
    for (const a of first.actors) a.alive = false;
    r.update(0.1);
    first.resolve('won'); await flush();
    for (let i = 0; i < 8; i++) r.update(0.1);
    expect(r.state).toBe('running');
    // the new one is the one that counts
    combat.brawls.at(-1)!.resolve('won'); await flush(); r.update(0.1);
    expect(r.state).toBe('passed');
  });

  it('takes its people away when the mission fails or is abandoned, but leaves a won fight lying', async () => {
    const { combat, r } = setup();
    r.start(); r.update(0.1);
    r.fail('wasted');
    expect(combat.brawls[0].ended).toBe(true);
    expect(combat.brawls[0].actors.every((a) => !a.alive)).toBe(true);
    const w = setup();
    w.r.start(); w.r.update(0.1);
    w.combat.brawls[0].resolve('won'); await flush(); w.r.update(0.1);
    expect(w.combat.brawls[0].actors.every((a) => a.alive)).toBe(true);
  });
});
