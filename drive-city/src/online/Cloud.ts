import type { Engine, System } from '../core/Engine';
import { statsEndpoint } from './Leaderboard';
import { ACCT, SYNC, apply, fingerprint, meaningful, parse, serialise, snapshot, summary, type Snapshot, type Summary } from './CloudSave';

export { DEVICE_KEYS, snapshot, apply, serialise, fingerprint, summary, meaningful } from './CloudSave';

/**
 * Accounts and cloud saves (2026-10-15, 「游戏页面能做个注册登录页面，方便存档吗？」): a user name and password on the
 * stats server (`../stats`, /acct/* and /save/*), and the save - every `drivecity.*` key in localStorage but this
 * device's own (quality, sound, language, crash log...) - kept there as one JSON object with a version number.
 *  - Not logged in, nothing changes: the save stays in this browser as before.
 *  - Logging in: no cloud save yet, this one goes up; a cloud save and nothing much here (a new device), it comes
 *    down; both with progress and different, the player picks one (`conflict`).
 *  - Logged in: the local save goes up when it changes (looked at every 15 s, at once when a chapter is passed, and as
 *    the page is hidden); at the start `boot()` (before the systems read their saves) takes a newer cloud save if
 *    this device has not changed since it last synced, else that is a conflict too.
 * A cloud save taken while playing is written to localStorage and the page reloaded (every system reads its save
 * once, at install).
 */

export const GAME = 'bcity';

export type CloudStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'offline' | 'conflict';
export interface CloudConflict { local: Summary; cloud: Summary; cloudTs: number; resolve(keep: 'local' | 'cloud'): void }
export interface CloudApi extends System {
  /** The server is reachable in this build (the published game; a dev server only with `?lb=`). */
  readonly enabled: boolean;
  /** Logged in as, or null. */
  readonly user: string | null;
  readonly status: CloudStatus;
  /** When the save last went up or came down (ms), 0: not yet. */
  readonly lastSync: number;
  /** Waiting for the player to pick which save to keep, or null. */
  readonly conflict: CloudConflict | null;
  /** Something changed (status, user, conflict): the UI redraws. */
  onChange: (() => void) | null;
  register(name: string, pw: string): Promise<{ ok: true; recovery: string } | { ok: false; error: string }>;
  login(name: string, pw: string): Promise<{ ok: true } | { ok: false; error: string }>;
  reset(name: string, recovery: string, pw: string): Promise<{ ok: true; recovery: string } | { ok: false; error: string }>;
  logout(): Promise<void>;
  /**
   * The panel's 立即同步: always a round trip - local changes go up ('pushed'), else the cloud is checked ('same': it
   * matches; a newer one is taken, a conflict asked). Resolves to how it went ('offline', 'conflict', 'off' too).
   */
  syncNow(): Promise<'pushed' | 'same' | CloudStatus>;
}

interface Acct { name: string; token: string }
interface SyncState { ver: number; fp: string; ts: number }
const read = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

async function call(path: string, body: Record<string, unknown>, keepalive = false): Promise<{ status: number; body: Record<string, unknown> }> {
  const { base } = statsEndpoint();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify({ g: GAME, ...body }), headers: { 'content-type': 'text/plain' }, signal: ctl.signal, cache: 'no-store', keepalive });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  } catch { return { status: 0, body: { error: 'network' } }; }
  finally { clearTimeout(timer); }
}

/** A cloud save that came down at the start, or a conflict found there (`install` picks it up). */
let bootResult: { conflict?: { data: string; ver: number; ts: number } } = {};

/**
 * Before the systems read their saves (main.ts, after the city): a logged-in player's newer cloud save is written
 * into localStorage if this device has not changed since it last synced; changed on both sides is left for the
 * conflict dialog. Gives up after `wait` ms (the save will sync later).
 */
export async function boot(wait = 2500): Promise<void> {
  const acct = read<Acct>(ACCT);
  if (!acct || !statsEndpoint().enabled) return;
  const res = await Promise.race([call('/save/get', { t: acct.token }), new Promise<null>((r) => setTimeout(() => r(null), wait))]);
  if (!res || res.status !== 200) {
    if (res?.status === 401) { write(ACCT, null); write(SYNC, null); }
    return;
  }
  const data = res.body.data as string | null, ver = Number(res.body.ver) || 0, ts = Number(res.body.ts) || 0;
  const st = read<SyncState>(SYNC), local = serialise(snapshot(localStorage)), lfp = fingerprint(local);
  if (data === null) return;   // nothing up there yet: install's first sync sends it
  const cfp = fingerprint(data);
  if (cfp === lfp) { write(SYNC, { ver, fp: lfp, ts }); return; }
  if (st && ver === st.ver) return;   // the cloud has not moved: the local changes go up later
  // the cloud moved on (another device): take it if nothing changed here since the last sync, or nothing here at all
  if ((st && st.fp === lfp) || !meaningful(snapshot(localStorage))) {
    apply(localStorage, parse<Snapshot>(data, {}));
    write(SYNC, { ver, fp: cfp, ts });
    return;
  }
  bootResult = { conflict: { data, ver, ts } };
}

export function install(engine: Engine): CloudApi {
  const { enabled } = statsEndpoint();
  let acct = read<Acct>(ACCT);
  let sync = read<SyncState>(SYNC);
  let status: CloudStatus = acct && enabled ? 'idle' : 'off';
  let conflict: CloudConflict | null = null;
  let busy = false, tick = 0;
  /** The last time the server confirmed it has this save (a check that changed nothing still counts). */
  let checked = 0;
  const changed = () => api.onChange?.();
  const set = (s: CloudStatus) => { if (status !== s) { status = s; changed(); } };
  const local = () => serialise(snapshot(localStorage));
  const reload = () => location.reload();

  /** The player's pick between this save and the cloud's. */
  const ask = (data: string, ver: number, ts: number) => {
    conflict = {
      local: summary(snapshot(localStorage)), cloud: summary(parse<Snapshot>(data, {})), cloudTs: ts,
      resolve: (keep) => {
        conflict = null;
        if (keep === 'cloud') { apply(localStorage, parse<Snapshot>(data, {})); write(SYNC, sync = { ver, fp: fingerprint(data), ts }); reload(); return; }
        void push(true);
      },
    };
    set('conflict');
  };

  /** The local save up (if changed), on the version last synced; `force` over whatever is there. */
  const push = async (force = false, keepalive = false) => {
    if (!acct || busy || conflict) return;
    const text = local(), fp = fingerprint(text);
    if (!force && sync && sync.fp === fp) { set('ok'); return; }
    busy = true; set('syncing');
    const r = await call('/save/put', { t: acct.token, ver: sync?.ver ?? 0, data: text, force }, keepalive);
    busy = false;
    if (r.status === 200) { write(SYNC, sync = { ver: Number(r.body.ver), fp, ts: Number(r.body.ts) }); set('ok'); return; }
    if (r.status === 401) { await dropLogin(); return; }
    if (r.status === 409) { await pull(); return; }
    set('offline');
  };
  /** The cloud's save: the same as here, newer and nothing changed here (taken, reload), or a conflict. */
  const pull = async (fresh = false) => {
    if (!acct || busy) return;
    busy = true; set('syncing');
    const r = await call('/save/get', { t: acct.token });
    busy = false;
    if (r.status === 401) { await dropLogin(); return; }
    if (r.status !== 200) { set('offline'); return; }
    const data = r.body.data as string | null, ver = Number(r.body.ver) || 0, ts = Number(r.body.ts) || 0;
    if (data === null) { await push(true); return; }
    const lfp = fingerprint(local()), cfp = fingerprint(data);
    if (lfp === cfp) { write(SYNC, sync = { ver, fp: lfp, ts }); set('ok'); return; }
    // a new device (nothing here worth keeping), or nothing changed here since the last sync: take the cloud's
    if (!meaningful(snapshot(localStorage)) || (!fresh && sync && sync.fp === lfp)) {
      apply(localStorage, parse<Snapshot>(data, {})); write(SYNC, sync = { ver, fp: cfp, ts }); reload(); return;
    }
    ask(data, ver, ts);
  };
  const dropLogin = async () => { acct = null; sync = null; write(ACCT, null); write(SYNC, null); conflict = null; set('off'); };
  const loggedIn = async (name: string, token: string, fresh: boolean) => {
    acct = { name, token }; write(ACCT, acct);
    sync = null; write(SYNC, null);
    changed();
    await pull(fresh);
  };
  const err = (r: { status: number; body: Record<string, unknown> }) => ({ ok: false as const, error: r.status === 0 ? 'network' : String(r.body.error ?? 'server') });

  const api: CloudApi = {
    name: 'cloud',
    enabled,
    get user() { return acct?.name ?? null; },
    get status() { return status; },
    get lastSync() { return Math.max(sync?.ts ?? 0, checked); },
    get conflict() { return conflict; },
    onChange: null,
    async register(name, pw) {
      const r = await call('/acct/register', { name, pw });
      if (r.status !== 200) return err(r);
      await loggedIn(String(r.body.name), String(r.body.token), true);
      return { ok: true, recovery: String(r.body.recovery) };
    },
    async login(name, pw) {
      const r = await call('/acct/login', { name, pw });
      if (r.status !== 200) return err(r);
      await loggedIn(String(r.body.name), String(r.body.token), true);
      return { ok: true };
    },
    async reset(name, recovery, pw) {
      const r = await call('/acct/reset', { name, recovery, pw });
      if (r.status !== 200) return err(r);
      await loggedIn(String(r.body.name), String(r.body.token), true);
      return { ok: true, recovery: String(r.body.recovery) };
    },
    async logout() {
      if (acct) { await push(); void call('/acct/logout', { t: acct.token }); }
      await dropLogin();
    },
    async syncNow() {
      if (!acct) return 'off';
      if (busy) return status;
      if (sync && sync.fp !== fingerprint(local())) { await push(); return status === 'ok' ? 'pushed' : status; }
      // nothing changed here (or never synced): ask the server - the same save, a newer one, or a conflict
      await pull(false);
      if (status === 'ok') { checked = Date.now(); changed(); return 'same'; }
      return status;
    },
    update(dt) {
      if (!acct || !enabled) return;
      tick += dt;
      if (tick >= 15) { tick = 0; void push(); }
    },
  };
  if (enabled) {
    engine.events.on('campaign:passed', () => { void push(); });
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void push(false, true); });
    // the start: a conflict found by boot(), else a first look at the cloud (or the first upload)
    if (acct) {
      const b = bootResult.conflict;
      if (b) ask(b.data, b.ver, b.ts);
      else setTimeout(() => { void (sync ? push() : pull()); }, 3000);
    }
  }
  engine.add(api);
  return api;
}
