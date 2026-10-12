import { describe, expect, it } from 'vitest';
import { Runner, type MissionDef, type Step } from './Runner';

interface S { n: number; log: string[] }
const log: string[] = [];
const step = (id: string, secs: number, extra: Partial<Step<S>> = {}): Step<S> => ({
  id,
  enter(ctx) { log.push(`enter ${id}`); ctx.step.defer(() => log.push(`clean ${id}`)); },
  update(ctx) { return ctx.t >= secs ? 'done' : 'run'; },
  exit() { log.push(`exit ${id}`); },
  ...extra,
});

describe('campaign runner', () => {
  it('runs the steps in order and passes, cleaning every step', () => {
    log.length = 0;
    const r = new Runner<S>({ id: 'm', init: () => ({ n: 0, log: [] }), steps: [step('a', 1), step('b', 0.5)] });
    r.start();
    for (let i = 0; i < 40 && r.state === 'running'; i++) r.update(0.1);
    expect(r.state).toBe('passed');
    expect(log).toEqual(['enter a', 'exit a', 'clean a', 'enter b', 'exit b', 'clean b']);
  });

  it('goes back to the last checkpoint with its state, restoring first', () => {
    log.length = 0;
    let failNow = true;
    const r = new Runner<S>({
      id: 'm', init: () => ({ n: 0, log: [] }),
      steps: [
        step('a', 0.2, { update(ctx) { ctx.state.n = 1; ctx.mission.defer(() => log.push('mission clean')); return ctx.t >= 0.2 ? 'done' : 'run'; } }),
        step('cp', 0.2, { checkpoint: true, restore(ctx) { log.push(`restore n=${ctx.state.n}`); } }),
        step('c', 0.2, { update(ctx) { ctx.state.n = 99; return failNow ? { fail: 'crashed' } : 'done'; } }),
      ],
    });
    r.start();
    for (let i = 0; i < 20 && r.state === 'running'; i++) r.update(0.1);
    expect(r.state).toBe('failed');
    expect(r.reason).toBe('crashed');
    expect(log).toContain('mission clean');
    failNow = false;
    r.retry();
    expect(r.current?.id).toBe('cp');
    expect(r.data?.n).toBe(1);   // the state as it was when the checkpoint began, not 99
    expect(log).toContain('restore n=1');
    for (let i = 0; i < 20 && r.state === 'running'; i++) r.update(0.1);
    expect(r.state).toBe('passed');
    expect(r.retries).toBe(1);
  });

  it('a guard fails the mission; abandon cleans up and goes idle', () => {
    log.length = 0;
    const r = new Runner<S>({ id: 'm', init: () => ({ n: 0, log: [] }), steps: [step('a', 10)], guard: (ctx) => ctx.t > 0.3 ? 'too slow' : null });
    r.start();
    for (let i = 0; i < 10 && r.state === 'running'; i++) r.update(0.1);
    expect(r.state).toBe('failed');
    expect(r.reason).toBe('too slow');
    expect(log).toEqual(['enter a', 'exit a', 'clean a']);
    r.retry();   // no checkpoint: from the start
    expect(r.current?.id).toBe('a');
    r.abandon();
    expect(r.state).toBe('idle');
    expect(log.filter((l) => l === 'clean a').length).toBe(2);
  });
});
