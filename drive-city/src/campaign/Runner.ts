/**
 * The mission runner (docs/gta-plan.md §4): a mission is a list of steps run one after another; a step marked
 * `checkpoint` is where a failed mission starts again. Everything a step spawns goes into a `Scope` and is
 * cleaned up when the step ends, the mission fails or is abandoned. Pure logic (no engine): `Runner.test.ts`.
 */
export type StepResult = 'run' | 'done' | { fail: string };

/** Things to undo, newest first. */
export class Scope {
  private undo: (() => void)[] = [];
  /** Register a cleanup; returns its argument's value for chaining. */
  add<T>(value: T, dispose: (v: T) => void): T { this.undo.push(() => dispose(value)); return value; }
  defer(fn: () => void): void { this.undo.push(fn); }
  clear(): void {
    const u = this.undo; this.undo = [];
    for (let i = u.length - 1; i >= 0; i--) { try { u[i](); } catch (e) { console.error('[campaign] cleanup', e); } }
  }
  get size(): number { return this.undo.length; }
}

export interface StepCtx<S> {
  /** The mission's own state (a fresh copy of the checkpoint's at a retry). */
  state: S;
  /** Cleaned up when this step ends (done or failed). */
  step: Scope;
  /** Cleaned up when the mission ends (passed, failed for good, abandoned) or goes back to a checkpoint. */
  mission: Scope;
  /** Seconds since this step began. */
  t: number;
}

export interface Step<S> {
  id: string;
  /** A failure starts again here (with the state as it was when this step began). */
  checkpoint?: boolean;
  /**
   * At a retry from this checkpoint, before `enter`: put back what the mission had built by now (the mission scope was
   * cleared at the failure) - the player in the mission car at the checkpoint, a passenger aboard.
   */
  restore?(ctx: StepCtx<S>): void;
  enter?(ctx: StepCtx<S>): void;
  update?(ctx: StepCtx<S>, dt: number): StepResult;
  exit?(ctx: StepCtx<S>): void;
}

export interface MissionDef<S> {
  id: string;
  steps: Step<S>[];
  /** The state at the start. */
  init(): S;
  /** Checked every update while running, after the step's own update: a mission-wide failure. */
  guard?(ctx: StepCtx<S>): string | null;
}

export type RunnerState = 'idle' | 'running' | 'failed' | 'passed';

export class Runner<S> {
  state: RunnerState = 'idle';
  index = -1;
  reason = '';
  /** Seconds since the mission started (kept across retries: a retry adds to it). */
  clock = 0;
  retries = 0;
  readonly mission = new Scope();
  private step = new Scope();
  private ctx: StepCtx<S> | null = null;
  private saved: { index: number; state: string } | null = null;

  constructor(readonly def: MissionDef<S>, private clone: (s: S) => S = (s) => JSON.parse(JSON.stringify(s)) as S) {}

  get current(): Step<S> | null { return this.index >= 0 ? this.def.steps[this.index] ?? null : null; }
  get data(): S | null { return this.ctx?.state ?? null; }

  start(): void {
    this.cleanup();
    this.state = 'running'; this.reason = ''; this.clock = 0; this.retries = 0; this.saved = null;
    this.ctx = { state: this.def.init(), step: this.step, mission: this.mission, t: 0 };
    this.enter(0);
  }

  private enter(i: number): void {
    this.index = i;
    if (i >= this.def.steps.length) { this.state = 'passed'; this.cleanup(); return; }
    const s = this.def.steps[i], ctx = this.ctx!;
    if (s.checkpoint) this.saved = { index: i, state: JSON.stringify(ctx.state) };
    ctx.t = 0;
    s.enter?.(ctx);
  }

  private leave(): void {
    const s = this.current;
    if (s && this.ctx) { try { s.exit?.(this.ctx); } catch (e) { console.error('[campaign] exit', e); } }
    this.step.clear();
  }

  update(dt: number): void {
    if (this.state !== 'running' || !this.ctx) return;
    this.clock += dt;
    const s = this.current!, ctx = this.ctx;
    ctx.t += dt;
    let r: StepResult = s.update ? s.update(ctx, dt) : 'done';
    if (r === 'run') { const g = this.def.guard?.(ctx); if (g) r = { fail: g }; }
    if (r === 'done') {
      this.leave();
      if (this.state === 'running') this.enter(this.index + 1);
    } else if (r !== 'run') this.fail(r.fail);
  }

  /** Fail now (a step's result, the guard, or the outside: busted, wasted). */
  fail(reason: string): void {
    if (this.state !== 'running') return;
    this.leave();
    this.mission.clear();
    this.state = 'failed'; this.reason = reason;
  }

  /** After a failure: back to the last checkpoint (or the start) with its state. */
  retry(): void {
    if (this.state !== 'failed' || !this.ctx) return;
    this.retries++;
    this.state = 'running'; this.reason = '';
    if (this.saved) {
      this.ctx.state = this.clone(JSON.parse(this.saved.state) as S);
      const s = this.def.steps[this.saved.index];
      this.ctx.t = 0;
      s.restore?.(this.ctx);
      this.enter(this.saved.index);
    }
    else { this.ctx.state = this.def.init(); this.enter(0); }
  }

  /** Give up: everything cleaned, back to idle. */
  abandon(): void {
    if (this.state === 'running') this.leave();
    this.cleanup();
    this.state = 'idle'; this.index = -1; this.ctx = null;
  }

  private cleanup(): void { this.step.clear(); this.mission.clear(); }
}
