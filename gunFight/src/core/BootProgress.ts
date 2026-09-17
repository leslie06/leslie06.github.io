/**
 * Boot progress: what the loading screen's bar and caption are driven by.
 *
 * A cold open is dominated by two things the player cannot see - downloading the level's textures
 * and compiling its shaders - and a bar that only sweeps left to right says nothing about either.
 * People read that as a hang and close the tab. So main.ts walks the stages below, Assets reports
 * bytes inside the ones that download, and the screen shows a number that only ever goes up.
 *
 * The first slice of the bar (`SCRIPT_SHARE`) belongs to index.html: it is on screen before any of
 * this code has been downloaded, and creeps on its own while the bundles arrive. The stages here
 * share what is left, by `weight` - rough wall-clock shares of a cold load over a slow link, where
 * the texture download is most of the wait.
 *
 * core must not import ui, so the screen subscribes with `onBootProgress`; index.html's inline
 * script also exposes `window.__gfBoot` and gets the same numbers, which keeps the bar moving even
 * if the ui module has not been evaluated yet.
 */
export type BootStage = 'physics' | 'sky' | 'world' | 'actors' | 'systems' | 'shaders';

const STAGES: readonly { id: BootStage; weight: number }[] = [
  { id: 'physics', weight: 4 },
  { id: 'sky', weight: 10 },
  { id: 'world', weight: 58 },
  { id: 'actors', weight: 10 },
  { id: 'systems', weight: 6 },
  { id: 'shaders', weight: 12 },
];
const TOTAL = STAGES.reduce((s, x) => s + x.weight, 0);

/** Share of the bar index.html fills on its own while the scripts download. */
export const SCRIPT_SHARE = 0.12;

export interface BootState { progress: number; stage: BootStage | 'done'; loadedBytes: number; totalBytes: number }
type Listener = (s: Readonly<BootState>) => void;

const state: BootState = { progress: SCRIPT_SHARE, stage: 'physics', loadedBytes: 0, totalBytes: 0 };
const listeners = new Set<Listener>();
let base = 0, span = 0;
/** ms spent in each stage, for the diagnostics panel and for re-tuning the weights. */
export const bootTimings: Partial<Record<BootStage, number>> = {};
let stageStart = 0;

function emit(): void {
  for (const fn of listeners) fn(state);
  if (typeof window !== 'undefined') (window as unknown as { __gfBoot?: Listener }).__gfBoot?.(state);
}

function raise(p: number): void {
  // Monotonic: a stage whose total grows as it discovers more files must not pull the bar back.
  if (p > state.progress) state.progress = Math.min(1, p);
}

export function bootStage(id: BootStage): void {
  const now = performance.now();
  if (stageStart && state.stage !== 'done') bootTimings[state.stage] = Math.round(now - stageStart);
  stageStart = now;
  let before = 0;
  for (const s of STAGES) { if (s.id === id) { span = s.weight / TOTAL; break; } before += s.weight; }
  base = before / TOTAL;
  state.stage = id;
  raise(SCRIPT_SHARE + (1 - SCRIPT_SHARE) * base);
  emit();
}

/** Progress inside the current stage, 0..1. */
export function bootFraction(f: number): void {
  raise(SCRIPT_SHARE + (1 - SCRIPT_SHARE) * (base + span * Math.max(0, Math.min(1, f))));
  emit();
}

/**
 * Bytes downloaded within the current stage (drives the bar) and since boot began (what the
 * caption shows - a total that reset at every stage would read as the download starting over).
 */
export function bootBytes(stageLoaded: number, stageTotal: number, loaded: number, total: number): void {
  state.loadedBytes = loaded; state.totalBytes = total;
  if (stageTotal > 0) bootFraction(stageLoaded / stageTotal); else emit();
}

export function bootDone(): void {
  if (stageStart && state.stage !== 'done') bootTimings[state.stage] = Math.round(performance.now() - stageStart);
  state.stage = 'done'; state.progress = 1;
  emit();
}

export function onBootProgress(fn: Listener): () => void {
  listeners.add(fn); fn(state);
  return () => { listeners.delete(fn); };
}
