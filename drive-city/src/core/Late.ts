import { afterTitle } from './Boot';

/**
 * Data the boot does not need, loaded once the title is up (2026-10-17, 「把内嵌的 JSON 模型也改成标题后加载」): the
 * Blender models of the stunt structures, the police helicopter, the street life's props and 兔儿爷 were JSON inside
 * the program, ~190 KB gzipped of what every visitor downloaded before the title. Each is now a chunk of its own,
 * fetched by `late(load, use)` after the title in the game, at once in shot mode (which waits for all of them before
 * it is ready, `lateSettled`) and in Node. Only looks wait like this: a structure's colliders are built at install
 * as before, so a ramp is solid before its model arrives.
 */
const DEFER = typeof window !== 'undefined' && (!new URLSearchParams(location.search).has('shot') || new URLSearchParams(location.search).has('defer'));
const pending: Promise<void>[] = [];

/** `load`, then hand its result to `use`: after the title in the game, at once in shot mode. A failure is logged and the thing stays unseen. */
export function late<T>(load: () => Promise<T>, use: (v: T) => void): Promise<void> {
  const p = (DEFER ? afterTitle.then(load) : load()).then(use).catch((e: unknown) => { console.error('[late] a model did not load', e); });
  pending.push(p);
  return p;
}

/** Every late load registered so far has settled. */
export const lateSettled = (): Promise<void> => Promise.all(pending).then(() => undefined);

/** A loader that fetches once: `once(() => import('./x.json'))`. */
export function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= f());
}
