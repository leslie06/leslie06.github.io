/** Serializable facts only. Scene objects and ticking clocks never enter the save. */
export type Phase = 'available' | 'search' | 'parked' | 'race' | 'secured' | 'kept' | 'returned' | 'borrowed';
export type Method = 'intercept' | 'tail' | 'race';
export interface Spot { x: number; z: number; yaw: number }
export interface Layout { source: Spot; parking: Spot; garage: Spot; finish: Spot }
export interface Save {
  version: 1; phase: Phase; tracking: boolean; clue: boolean; informed: boolean; keys: boolean;
  method: Method | null; rewarded: boolean; returning: boolean; condition: number;
  /** Daliu's tool case: at his bay, carried, or put down by the player at `toolAt`. */
  tool: 'base' | 'held' | 'ground'; toolAt?: { x: number; z: number } | null;
  layout: Layout | null; pose: Spot | null;
}
const phases: Phase[] = ['available', 'search', 'parked', 'race', 'secured', 'kept', 'returned', 'borrowed'];
const spot = (s: unknown): s is Spot => !!s && typeof s === 'object' && ['x', 'z', 'yaw'].every(k => typeof (s as Record<string, unknown>)[k] === 'number' && Number.isFinite((s as Record<string, number>)[k]) && Math.abs((s as Record<string, number>)[k]) < 100000);
export function fresh(): Save { return { version: 1, phase: 'available', tracking: true, clue: false, informed: false, keys: false, method: null, rewarded: false, returning: false, condition: 100, tool: 'base', layout: null, pose: null }; }
export function restore(raw: string | null): Save {
  const s = fresh();
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Save> | null;
    if (!v || v.version !== 1 || !phases.includes(v.phase!)) return s;
    const l = v.layout;
    if (!l || ![l.source, l.parking, l.garage, l.finish].every(spot)) return s;
    s.layout = l; s.pose = spot(v.pose) ? v.pose : null;
    s.phase = v.phase === 'race' ? 'parked' : v.phase!;
    s.tracking = v.tracking !== false;
    for (const k of ['clue', 'informed', 'rewarded'] as const) s[k] = v[k] === true;
    s.keys = ['secured', 'kept', 'returned', 'borrowed'].includes(s.phase);
    s.method = ['intercept', 'tail', 'race'].includes(v.method!) ? v.method! : null;
    s.condition = typeof v.condition === 'number' && Number.isFinite(v.condition) ? Math.max(0, Math.min(100, v.condition)) : 100;
    const at = v.toolAt;
    s.tool = v.tool === 'held' ? 'held' : v.tool === 'ground' && !!at && Number.isFinite(at.x) && Number.isFinite(at.z) && Math.abs(at.x) < 100000 && Math.abs(at.z) < 100000 ? 'ground' : 'base';
    if (s.tool === 'ground') s.toolAt = { x: at!.x, z: at!.z };
    if (v.phase === 'race' || v.returning === true && s.phase === 'parked') s.pose = l.parking;
  } catch { /* A damaged save must not lock the player out of the encounter. */ }
  return s;
}
export function isActive(s: Save): boolean { return s.tracking && ['search', 'parked', 'race', 'secured'].includes(s.phase); }
export function secure(s: Save, method: Method): boolean {
  if (!['search', 'parked', 'race'].includes(s.phase)) return false;
  s.phase = 'secured'; s.keys = true; s.method = method;
  return true;
}
/** Returns true only for the first relationship/reward grant. */
export function giveBack(s: Save): boolean {
  if (!['secured', 'kept', 'borrowed'].includes(s.phase)) return false;
  const reward = !s.rewarded;
  s.phase = 'returned'; s.keys = true; s.rewarded = true;
  return reward;
}
export function keep(s: Save): boolean {
  if (s.phase !== 'secured') return false;
  s.phase = 'kept'; return true;
}
export function borrow(s: Save): boolean {
  if (s.phase !== 'returned') return false;
  s.phase = 'borrowed'; return true;
}
export function nextCheckpoint(points: readonly { x: number; z: number }[], index: number, x: number, z: number): number {
  // Exactly one ordered checkpoint per tick: a shortcut to the finish cannot win the race.
  const p = points[index];
  return p && Math.hypot(p.x - x, p.z - z) < 18 ? index + 1 : index;
}
