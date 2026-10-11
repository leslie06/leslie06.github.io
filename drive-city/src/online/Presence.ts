import type { Engine, System } from '../core/Engine';
import { statsEndpoint } from './Leaderboard';

/**
 * How many are playing (2026-10-11, 「添加在线玩家人数」): the site's stats service counts the sessions whose page
 * sent its heartbeat (the stats snippet in index.html, every 15 s) within the last 45 s, and the devices that
 * played today (`stats/worker.js` `GET /online`). Asked at the start, then every 30 s while the title or pause screen
 * is up and every minute while playing; the menu shows it (`onChange`) and the radar reads `online` (ui/Minimap.ts). Off where the leaderboards are (a dev server,
 * shot mode), and silent when the service cannot be reached.
 */
export interface PresenceApi extends System {
  online: number | null;
  today: number | null;
  /** Called with each new reading. */
  onChange: ((online: number, today: number) => void) | null;
}

const EVERY = 30, TIMEOUT = 6000;

export function install(engine: Engine): PresenceApi | null {
  const { base, enabled } = statsEndpoint();
  if (!enabled) return null;
  let next = performance.now() + 1500, busy = false;
  const ask = async () => {
    busy = true;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${base}/online?g=bcity`, { signal: ctl.signal, cache: 'no-store' });
      const j = r.ok ? await r.json() as { online?: number; today?: number } : null;
      if (j && Number.isFinite(j.online) && Number.isFinite(j.today)) {
        // the page asking is open, so at least one (its own heartbeat may be a beat behind)
        api.online = Math.max(1, j.online!); api.today = Math.max(api.online, j.today!);
        api.onChange?.(api.online, api.today);
      }
    } catch { /* offline: keep the last reading */ } finally { clearTimeout(timer); busy = false; }
  };
  const api: PresenceApi = {
    name: 'presence',
    online: null, today: null, onChange: null,
    update() {
      // wall-clock time: the engine hands systems dt = 0 while paused
      const ui = engine.get<System & { state: string }>('ui');
      const menu = ui?.state === 'title' || ui?.state === 'paused';
      if (document.visibilityState !== 'visible' || busy || performance.now() < next) return;
      // every 30 s with a menu up, every minute while playing (the radar shows it too)
      next = performance.now() + (menu ? EVERY : EVERY * 2) * 1000;
      void ask();
    },
  };
  engine.add(api);
  return api;
}
