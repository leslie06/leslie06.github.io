/**
 * The cloud save's own logic (online/Cloud.ts), kept free of the browser so Node tests it (`Cloud.test.ts`): which
 * localStorage keys are the save, writing one back, comparing two, and what the conflict dialog says of each.
 */
export const ACCT = 'drivecity.acct.v1', SYNC = 'drivecity.sync.v1';
/** This device's own keys: never synced (and never removed when a cloud save comes down). */
export const DEVICE_KEYS = new Set([ACCT, SYNC, 'drivecity.blackbox', 'drivecity.blackbox.last', 'drivecity.fb.pending', 'drivecity.lb.pending',
  'drivecity.probe', 'drivecity.quality.choice', 'drivecity.muted', 'drivecity.radio', 'drivecity.lang.v1', 'drivecity.autogas']);
const PREFIX = 'drivecity.';

export type Snapshot = Record<string, string>;
/** What the conflict dialog shows of a save. */
export interface Summary { chapters: number; cash: number; car: boolean; keys: number; /** Seconds played (ui/PlayTime.ts). */ secs: number }

/** The save as it is in `store`: the synced keys and their values. */
export function snapshot(store: Pick<Storage, 'length' | 'key' | 'getItem'>): Snapshot {
  const out: Snapshot = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith(PREFIX) || DEVICE_KEYS.has(k)) continue;
    const v = store.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}
/** `s` into `store`: its keys written, any other synced key there removed (the device's own left alone). */
export function apply(store: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>, s: Snapshot): void {
  for (const k of Object.keys(snapshot(store))) if (!(k in s)) store.removeItem(k);
  for (const [k, v] of Object.entries(s)) if (k.startsWith(PREFIX) && !DEVICE_KEYS.has(k)) store.setItem(k, v);
}
/** The same save always serialises the same (keys sorted): what is compared and sent. */
export const serialise = (s: Snapshot): string => JSON.stringify(Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]])));
/** A short fingerprint of a serialised save (FNV-1a, not for security: "has it changed"). */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + text.length.toString(36);
}
export const parse = <T>(v: string | undefined | null, d: T): T => { try { return v ? JSON.parse(v) as T : d; } catch { return d; } };
export function summary(s: Snapshot): Summary {
  const camp = parse<{ done?: string[] }>(s['drivecity.campaign.v1'], {});
  return { chapters: camp.done?.length ?? 0, cash: Math.max(0, Number(s['drivecity.cash'] ?? 0) || 0), car: !!s['drivecity.garage.v1'], keys: Object.keys(s).length, secs: Math.max(0, Number(s['drivecity.playtime.v1'] ?? 0) || 0) };
}
/**
 * Progress worth keeping in it: a chapter, money, a car of one's own. A browser that has only driven about has a dozen
 * keys (empty lists, a player id, the opening seen), none of it worth a question when the cloud has a real save.
 */
export function meaningful(s: Snapshot): boolean {
  const m = summary(s);
  return m.chapters > 0 || m.cash > 0 || m.car;
}

