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
 */
export type FeedbackKind = 'bug' | 'idea' | 'praise' | 'other';
export type SendResult = 'ok' | 'queued' | 'off' | 'busy';
export interface FeedbackApi extends System {
  readonly enabled: boolean;
  /** The frame as it is drawn next, as a JPEG data URL at most 960 px wide ('' if it cannot be read). */
  capture(): Promise<string>;
  send(kind: FeedbackKind, text: string, contact: string, shot: string): Promise<SendResult>;
}

const GAME = 'bcity';
const PENDING = 'drivecity.fb.pending';
/** At most this many waiting (a screenshot is ~100-300 KB of localStorage); the oldest go first. */
const PENDING_MAX = 4;
const TIMEOUT = 15000;

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

  const post = async (body: unknown): Promise<number> => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${base}/fb`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' }, signal: ctl.signal, cache: 'no-store' });
      return r.status;
    } catch { return 0; } finally { clearTimeout(timer); }
  };

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

  const api: FeedbackApi = {
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
      const body = { g: GAME, k: kind, t: text, c: contact, x: context(), s: shot || undefined, p: (() => { try { return JSON.parse(localStorage.getItem('drivecity.pid') ?? '""'); } catch { return ''; } })() };
      const st = await post(body);
      if (st === 200) { void flush(); return 'ok'; }
      if (st === 429) return 'busy';
      if (st === 400) return 'ok';   // refused as malformed: nothing to retry (the panel checks what it can first)
      write([...read(), body]);
      return 'queued';
    },
    update() {
      const now = performance.now(), dt = now - last;
      last = now;
      if (dt > 0 && dt < 1000) fpsAvg += (1000 / dt - fpsAvg) * 0.02;
    },
  };
  engine.add(api);
  if (enabled) setTimeout(() => void flush(), 8000);
  return api;
}
