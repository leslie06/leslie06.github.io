import type { Engine, System } from '../core/Engine';
import { lang } from '../core/I18n';
import type { PlayerApi, RenderApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { statsEndpoint } from './Leaderboard';

/**
 * Players' feedback (2026-10-11, 「做个用户可以反馈的功能」): what the panel (ui/Feedback.ts) sends to the site's
 * stats service (`stats/worker.js` `POST /fb`, read at `/fb?k=key`): a kind, the text, a contact if they give one,
 * the frame they were looking at (a JPEG, `capture`, when they opened the panel) and the game's side of it - build,
 * quality, frame rate, device, screen, language, where in the city (the road too), on foot or driving, stars, the
 * game's hour, minutes played. Nothing else: no account, no IP kept (the server keeps a day-salted hash for its rate
 * limit). What does not get through (offline, blocked, the server down) waits in `drivecity.fb.pending` and goes at
 * the next start; a dev server and shot mode send nothing unless `?lb=<base url>` (as the leaderboards).
 *
 * Replies (2026-10-28, 「我想回复他反馈的问题……他也看不见，增加后台可以和玩家反馈交流的功能」): the developer answers
 * under a feedback on the `/fb` page; the game asks `GET /fb/mine` with the player's random id (`drivecity.pid`, the one
 * the feedback carried) a few seconds after the start, every minute with a menu up and every 3 minutes while playing,
 * and keeps the threads and how many replies are unread (the menu badge, a toast in game, the panel's 我的反馈 tab).
 * Opening that tab marks them seen (`POST /fb/seen`); the player answers with `POST /fb/reply`.
 */
export type FeedbackKind = 'bug' | 'idea' | 'praise' | 'other';
export type SendResult = 'ok' | 'queued' | 'off' | 'busy';
export interface FeedbackMsg { id: number; ts: number; who: 'dev' | 'me'; text: string; unread?: boolean }
export interface FeedbackThread { id: number; ts: number; kind: FeedbackKind; text: string; msgs: FeedbackMsg[] }
export interface FeedbackApi extends System {
  readonly enabled: boolean;
  /** The frame as it is drawn next, as a JPEG data URL at most 960 px wide ('' if it cannot be read). */
  capture(): Promise<string>;
  send(kind: FeedbackKind, text: string, contact: string, shot: string): Promise<SendResult>;
  /** This player's feedback (newest first) and the conversation under each; empty until the first answer comes. */
  readonly threads: FeedbackThread[];
  /** Developer replies the player has not looked at. */
  readonly unread: number;
  /** Called whenever `threads` or `unread` change. */
  listen(fn: () => void): void;
  /** Ask the server now. */
  refresh(): Promise<void>;
  /** The player is looking at the replies: none unread. */
  markSeen(): void;
  reply(id: number, text: string): Promise<'ok' | 'busy' | 'fail'>;
}

const GAME = 'bcity';
const PENDING = 'drivecity.fb.pending';
/** At most this many waiting (a screenshot is ~100-300 KB of localStorage); the oldest go first. */
const PENDING_MAX = 4;
const TIMEOUT = 15000;
/** How often to look for replies (wall-clock seconds): with a menu up, while playing. */
const INBOX_MENU = 60, INBOX_PLAY = 180;

/** A short device name from the user agent: "iPhone · Safari", "Android · Chrome", "Mac · Chrome"... */
function device(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
  const br = /MicroMessenger/.test(ua) ? 'WeChat' : /Edg\//.test(ua) ? 'Edge' : /QQBrowser/.test(ua) ? 'QQ' : /UCBrowser/.test(ua) ? 'UC'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other';
  return `${os} · ${br}`;
}

export function install(engine: Engine): FeedbackApi {
  const { base, enabled } = statsEndpoint();
  const born = performance.now();
  let fpsAvg = 60, last = performance.now();
  const read = (): unknown[] => { try { return JSON.parse(localStorage.getItem(PENDING) ?? '[]') as unknown[]; } catch { return []; } };
  const write = (list: unknown[]) => {
    // a full localStorage: drop the screenshots, then the oldest
    for (let k = list.length; k >= 0; k--) {
      try { localStorage.setItem(PENDING, JSON.stringify(list.slice(-PENDING_MAX))); return; } catch { list = list.map((p, i) => (i < k ? { ...(p as object), s: '' } : p)); }
    }
  };

  const call = async (path: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${base}${path}`, body === undefined ? { signal: ctl.signal, cache: 'no-store' }
        : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' }, signal: ctl.signal, cache: 'no-store' });
      return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null };
    } catch { return { status: 0, json: null }; } finally { clearTimeout(timer); }
  };
  const post = async (body: unknown): Promise<number> => (await call('/fb', body)).status;
  // read at each call: the cloud save can bring another device's id in after the start
  const pid = (): string => { try { return String(JSON.parse(localStorage.getItem('drivecity.pid') ?? '""')); } catch { return ''; } };

  const listeners: (() => void)[] = [];
  const changed = () => { for (const fn of listeners) fn(); };
  let nextAsk = performance.now() + 6000, asking = false;

  /** What the game knows about where and how the player is. */
  const context = () => {
    const pl = engine.get<PlayerApi>('player'), pos = pl?.position;
    let road = '';
    const tr = engine.get<TrafficApi>('traffic');
    if (tr && pos) {
      let bd = 40;
      for (const id of tr.graph.near(pos.x, pos.z, 40)) {
        const l = tr.graph.links[id];
        if (!l.name) continue;
        const d = tr.graph.project(l, pos.x, pos.z, l.len / 2).d;
        if (d < bd) { bd = d; road = l.name; }
      }
    }
    const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="index-"]')?.src ?? '';
    return {
      v: script.match(/index-([\w-]+)\.js/)?.[1] ?? 'dev', q: engine.quality.tier, fps: Math.round(fpsAvg), dev: device(),
      w: innerWidth, h: innerHeight, dpr: +devicePixelRatio.toFixed(2), touch: document.body.classList.contains('dc-touch') ? 1 : 0, lang: lang(),
      pos: pos ? [Math.round(pos.x), Math.round(pos.z)] : undefined, road, mode: pl?.mode,
      stars: engine.get<WantedApi>('wanted')?.level ?? 0, tod: +(engine.get<RenderApi>('render')?.timeOfDay ?? 0).toFixed(1),
      play: Math.round((performance.now() - born) / 1000),
    };
  };

  const flush = async () => {
    let list = read();
    while (list.length) {
      const st = await post(list[0]);
      if (st !== 200 && st !== 400 && st !== 429) return;   // keep it for later; a refused one (bad, or too many today) goes
      list = read().slice(1); write(list);
    }
  };

  const api: FeedbackApi & { threads: FeedbackThread[]; unread: number } = {
    name: 'feedback',
    enabled,
    capture() {
      return new Promise((resolve) => {
        const orig = engine.renderFrame;
        let done = false;
        const grab = () => {
          const src = engine.renderer.domElement, k = Math.min(1, 960 / (src.width || 1));
          const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
          try { c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.72); } catch { return ''; }
        };
        // read the drawing buffer right after a frame is drawn (it is cleared before the next)
        engine.renderFrame = (dt: number) => { orig(dt); engine.renderFrame = orig; if (!done) { done = true; resolve(grab()); } };
        setTimeout(() => { if (!done) { done = true; engine.renderFrame = orig; resolve(''); } }, 1500);
      });
    },
    async send(kind, text, contact, shot) {
      if (!enabled) return 'off';
      const body = { g: GAME, k: kind, t: text, c: contact, x: context(), s: shot || undefined, p: pid() };
      const st = await post(body);
      if (st === 200) { void flush(); void api.refresh(); return 'ok'; }
      if (st === 429) return 'busy';
      if (st === 400) return 'ok';   // refused as malformed: nothing to retry (the panel checks what it can first)
      write([...read(), body]);
      return 'queued';
    },
    threads: [],
    unread: 0,
    listen(fn) { listeners.push(fn); },
    async refresh() {
      const p = pid();
      if (!enabled || !p || asking) return;
      asking = true;
      try {
        const r = await call(`/fb/mine?g=${GAME}&p=${encodeURIComponent(p)}`);
        const j = r.json as { items?: FeedbackThread[]; unread?: number } | null;
        if (!j || !Array.isArray(j.items)) return;
        const was = JSON.stringify([api.threads, api.unread]);
        api.threads = j.items; api.unread = Math.max(0, j.unread ?? 0);
        if (JSON.stringify([api.threads, api.unread]) !== was) changed();
      } finally { asking = false; }
    },
    markSeen() {
      if (!api.unread) return;
      api.unread = 0;   // the messages keep their mark while the panel is open (the next answer drops it)
      changed();
      void call('/fb/seen', { g: GAME, p: pid() });
    },
    async reply(id, text) {
      const r = await call('/fb/reply', { g: GAME, p: pid(), id, t: text });
      if (r.status === 429) return 'busy';
      const msg = (r.json as { msg?: FeedbackMsg; dup?: boolean } | null);
      if (r.status !== 200 || !msg) return 'fail';
      const th = api.threads.find((x) => x.id === id);
      if (th && msg.msg) { th.msgs.push(msg.msg); changed(); }
      return 'ok';
    },
    update() {
      const now = performance.now(), dt = now - last;
      last = now;
      if (dt > 0 && dt < 1000) fpsAvg += (1000 / dt - fpsAvg) * 0.02;
      // replies: wall-clock time (systems get dt = 0 while paused), only while the page is in front
      if (!enabled || now < nextAsk || document.visibilityState !== 'visible') return;
      const ui = engine.get<System & { state: string }>('ui');
      nextAsk = now + (ui?.state === 'playing' ? INBOX_PLAY : INBOX_MENU) * 1000;
      void api.refresh();
    },
  };
  engine.add(api);
  if (enabled) setTimeout(() => void flush(), 8000);
  return api;
}
