import type { Actor, Blip, CombatApi } from '../game/Contracts';
import type { Step, StepCtx } from './Runner';

/** What a fight needs of the campaign's Env (kept apart from Kit.ts, which touches the DOM: `Fight.test.ts`). */
export interface FightEnv {
  readonly combat: CombatApi | undefined;
  readonly blips: Blip[];
  objective(text: string | null): void;
}

/**
 * A fist fight on foot (combat/ `brawl`): `n` gang members round `at`, done when all are down for good. Running more
 * than 60 m from them fails it (`fled`); going down is the mission's own `wasted`. A failed or abandoned fight takes
 * its people away at once; a won one leaves them lying (combat/ clears them later). `ko` counts them as they go down.
 */
export function fight<S>(env: FightEnv, o: {
  id: string; checkpoint?: boolean; restore?(ctx: StepCtx<S>): void; line: string;
  at(ctx: StepCtx<S>): { x: number; z: number }; n: number; tough?: number; fled: string;
  enter?(ctx: StepCtx<S>): void; ko?(ctx: StepCtx<S>, n: number): void;
}): Step<S> {
  let res: 'won' | 'lost' | 'fled' | null = null, actors: readonly Actor[] = [], down = 0, wait = 0, serial = 0;
  /** Start the brawl; none of its people placed (the streets round `at` not in yet) leaves it to be tried again. A
   *  brawl dropped this way still resolves (`fled`) inside combat/, which nobody is listening to any more. */
  const begin = (ctx: StepCtx<S>) => {
    const c = env.combat, p = o.at(ctx);
    if (!c) { res = 'won'; actors = []; return; }
    const b = c.brawl(p.x, p.z, o.n, { tough: o.tough });
    if (!b.actors.length) { b.end(); return; }
    actors = b.actors;
    // only this brawl's outcome counts (one dropped for want of people resolves too: 'won', its people all gone)
    const mine = ++serial;
    void b.done.then((r) => { if (mine === serial) res = r; });
    ctx.step.defer(() => {
      if (res === 'won') return;
      b.end();
      for (const a of actors) if (a.alive) a.release('vanish');
    });
  };
  return {
    id: o.id, checkpoint: o.checkpoint, restore: o.restore,
    enter(ctx) {
      res = null; down = 0; wait = 0; actors = []; serial++;
      o.enter?.(ctx);
      env.objective(o.line);
      begin(ctx);
    },
    update(ctx, dt) {
      // all of them gone before a blow (people/ drops scripted people far from the camera: a retry from afar) is no fight
      if (actors.length && res === null && actors.every((a) => !a.alive)) { actors = []; serial++; }
      if (!actors.length && res === null) { if ((wait += dt) > 0.5) { wait = 0; begin(ctx); } return 'run'; }
      let n = 0;
      for (const a of actors) {
        if (!a.alive) continue;
        if (a.state === 'down' && a.downFor > 1e8) n++;
        else env.blips.push({ kind: 'suspect', x: a.pos.x, z: a.pos.z, flash: true });
      }
      if (n !== down) { down = n; o.ko?.(ctx, n); }
      if (res === 'won') { o.ko?.(ctx, actors.length); return 'done'; }
      if (res === 'fled') return { fail: o.fled };
      return 'run';
    },
  };
}

