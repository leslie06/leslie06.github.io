import type { Engine, System } from '../core/Engine';
import { statsEndpoint } from './Leaderboard';

/**
 * Promotion codes (2026-10-29, 「现在做个促销活动，对蛮牛跑车搞促销，用户获取兑换码就可以购车」): the developer makes
 * one-use codes on the stats service's `/promo/admin` page and hands them out; a player types one into the 车行
 * (garage/GarageMenu.ts) and the service checks it (`stats/worker.js` `POST /promo/redeem`: it exists, is unused, the
 * promotion is on, this player id - or the account logged in - has not had that prize). On `ok` the garage gives the
 * car. The codes live on the server only. `on` (`GET /promo/state`: which prizes are being given now) decides whether
 * the 车行 shows the code box at all; asked a few seconds after the start, every 5 minutes, and when the 车行 opens.
 * Off where the leaderboards are (a dev server, shot mode) unless `?lb=<base url>`.
 */
export type RedeemError = 'code' | 'used' | 'have' | 'off' | 'busy' | 'net';
export type RedeemResult = { ok: true; prize: string } | { ok: false; error: RedeemError };
export interface PromoApi extends System {
  readonly enabled: boolean;
  /** Prizes being given now ('super' = 蛮牛跑车). */
  readonly on: readonly string[];
  /** Called when `on` changes. */
  onChange: (() => void) | null;
  refresh(): Promise<void>;
  redeem(code: string): Promise<RedeemResult>;
}

const GAME = 'bcity', EVERY = 300, TIMEOUT = 12000;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) as T; } catch { return d; } };

export function install(engine: Engine): PromoApi | null {
  const { base, enabled } = statsEndpoint();
  if (!enabled) return null;
  let next = performance.now() + 4000, busy = false;
  const call = async (path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> => {
    try {
      const r = await fetch(`${base}${path}`, body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) }
        : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) });
      return { status: r.status, json: await r.json().catch(() => null) as Record<string, unknown> | null };
    } catch { return { status: 0, json: null }; }
  };
  const api: PromoApi & { on: string[] } = {
    name: 'promo',
    enabled,
    on: [],
    onChange: null,
    async refresh() {
      if (busy) return;
      busy = true;
      try {
        const r = await call(`/promo/state?g=${GAME}`);
        const on = r.json?.on;
        if (!Array.isArray(on)) return;
        const list = on.filter((x): x is string => typeof x === 'string');
        if (list.join() !== api.on.join()) { api.on = list; api.onChange?.(); }
      } finally { busy = false; }
    },
    async redeem(code) {
      const r = await call('/promo/redeem', { g: GAME, p: read('drivecity.pid', ''), code, t: read<{ token?: string } | null>('drivecity.acct.v1', null)?.token });
      if (r.status === 200 && r.json?.ok && typeof r.json.prize === 'string') return { ok: true, prize: r.json.prize };
      const e = r.json?.error;
      if (e === 'off') void api.refresh();
      return { ok: false, error: e === 'code' || e === 'used' || e === 'have' || e === 'off' || e === 'busy' ? e : 'net' };
    },
    update() {
      // wall-clock time: systems get dt = 0 while paused
      if (document.visibilityState !== 'visible' || performance.now() < next) return;
      next = performance.now() + EVERY * 1000;
      void api.refresh();
    },
  };
  engine.add(api);
  return api;
}
