import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';

/**
 * How long the player has played (2026-10-15, 「要给玩家看到自己玩的时长」): seconds in the city - not on the title,
 * paused, in another tab, or idle for IDLE seconds (a car left on the kerb is not playing) - kept in
 * `drivecity.playtime.v1`, so it travels with the cloud save (online/Cloud.ts syncs every `drivecity.*` key but the
 * device's own). Shown on the pause screen and in the account panel.
 */
export const PLAYTIME_KEY = 'drivecity.playtime.v1';
const IDLE = 120;

/** The count so far this session (it reaches localStorage every 10 s). */
let live = 0;
const stored = (): number => { try { return Math.max(0, Math.floor(Number(localStorage.getItem(PLAYTIME_KEY) ?? 0) || 0)); } catch { return 0; } };
/** Seconds played: the saved total, or this session's count if it is ahead of it. */
export function readPlaytime(): number { return Math.max(stored(), live); }

/** 「3 小时 12 分」/「12 分钟」/「不到 1 分钟」. */
export function formatPlaytime(secs: number): string {
  const m = Math.floor(secs / 60), h = Math.floor(m / 60);
  if (m < 1) return t('time.underMin');
  if (h < 1) return t('time.mins', { m });
  return t('time.hm', { h, m: m % 60 });
}

/** Count while `playing()` says the player is in the game. */
export function trackPlaytime(engine: Engine, playing: () => boolean): void {
  let secs = stored(), last = performance.now(), dirty = 0;
  const touched = () => { last = performance.now(); };
  for (const ev of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const) addEventListener(ev, touched, { passive: true, capture: true });
  const save = () => {
    if (!dirty) return;
    // another tab (or a cloud save that came down) may have moved it on: never write it backwards
    secs = Math.max(secs, stored());
    try { localStorage.setItem(PLAYTIME_KEY, String(secs)); } catch { /* private mode */ }
    dirty = 0;
  };
  setInterval(() => {
    // a pad or a held key moves the car without new events: input counts as a touch
    const s = engine.input.state;
    if (s.forward || s.back || Math.abs(s.steer) > 0.1 || s.lookDX || s.lookDY) touched();
    if (!playing() || engine.paused || document.visibilityState !== 'visible' || performance.now() - last > IDLE * 1000) return;
    secs++; dirty++; live = secs;
    if (dirty >= 10) save();
  }, 1000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  addEventListener('pagehide', save);
}
