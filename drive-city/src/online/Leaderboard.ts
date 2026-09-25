import type { Engine, System } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { shotMode } from '../debug/ShotMode';
import type { HudApi } from '../game/Contracts';
import { STARTS } from '../races';

/**
 * The online leaderboards: the street races' times (each start line's course is fixed by its seed),
 * the best street combo, the best taxi shift and the fastest heist. The server is the site's own
 * stats service (`stats/worker.js`, `POST /lb` and `GET /lb`), which keeps one row per player and
 * board - the best - under a nickname the player picks. A player is a random id in localStorage;
 * nothing else is sent. It is the one runtime request the game makes, and it is optional: offline,
 * blocked or slow, every call gives up quietly after TIMEOUT and the game never waits on it.
 *
 * Off in shot mode and on a dev server (so probes and local play never write the real boards),
 * unless `?lb=<base url>` points it somewhere; `?lb=0` turns it off anywhere.
 */
export type BoardId = 'race0' | 'race1' | 'race2' | 'race3' | 'combo' | 'taxi' | 'heist';
export interface BoardDef { id: BoardId; asc: boolean }
export const BOARDS: BoardDef[] = [
  ...STARTS.map((_, i) => ({ id: `race${i}` as BoardId, asc: true })),
  { id: 'combo', asc: false }, { id: 'taxi', asc: false }, { id: 'heist', asc: true },
];
export interface BoardRow { name: string; score: number; me: boolean }
export interface BoardData { board: BoardId; asc: boolean; total: number; top: BoardRow[]; me: { rank: number; score: number } | null }

export interface LeaderboardApi extends System {
  readonly enabled: boolean;
  /** The player's nickname (setting it renames them on every board). */
  nick: string;
  /** A result: sent if it beats this device's best on that board; the reply's rank is toasted. */
  submit(board: BoardId, score: number): void;
  fetch(board: BoardId): Promise<BoardData | null>;
  /** How a board is called and how its scores read, in the current language. */
  label(board: BoardId): string;
  format(board: BoardId, score: number): string;
}

const DEFAULT_BASE = 'https://stats.fishai.asia';
const GAME = 'bcity';
const TIMEOUT = 6000;
const KEY = { pid: 'drivecity.pid', name: 'drivecity.name', best: 'drivecity.lb.best', pending: 'drivecity.lb.pending' };

const read = <T>(k: string, fb: T): T => { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v) as T; } catch { return fb; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search).get('lb');
  const local = /^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname);
  const base = q && q !== '0' ? q.replace(/\/$/, '') : DEFAULT_BASE;
  const enabled = q === '0' ? false : !!q || (!shotMode && !local);

  let pid = read<string>(KEY.pid, '');
  if (!/^[a-z0-9]{8,32}$/i.test(pid)) { pid = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24); write(KEY.pid, pid); }
  let name = read<string>(KEY.name, '');
  if (!name) { name = (lang() === 'zh' ? '车手' : 'Driver') + String(1000 + Math.floor(Math.random() * 9000)); write(KEY.name, name); }
  const best = read<Record<string, number>>(KEY.best, {});
  /** Bests the server has not acknowledged yet (offline, timed out): sent again at the next start. */
  const pending = read<Record<string, number>>(KEY.pending, {});
  const def = (b: BoardId) => BOARDS.find((d) => d.id === b)!;
  const better = (b: BoardId, v: number, than: number | undefined) => than === undefined || (def(b).asc ? v < than : v > than);

  const call = async (method: 'GET' | 'POST', body?: unknown, query = ''): Promise<any> => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      // text/plain: a "simple" request, so no CORS preflight round trip.
      const res = await fetch(`${base}/lb${query}`, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'content-type': 'text/plain' } : undefined, signal: ctl.signal, cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch { return null; } finally { clearTimeout(timer); }
  };

  const send = async (board: BoardId, score: number, loud: boolean) => {
    const r = await call('POST', { g: GAME, b: board, p: pid, n: name, v: score });
    if (!r?.ok) return;
    if (pending[board] === score) { delete pending[board]; write(KEY.pending, pending); }
    if (loud && r.rank) engine.get<HudApi>('hud')?.toast(t('lb.rank', { board: api.label(board), rank: r.rank, total: r.total }));
  };

  const api: LeaderboardApi = {
    name: 'leaderboard',
    enabled,
    get nick() { return name; },
    set nick(v: string) {
      const n = [...String(v).replace(/[\u0000-\u001f<>]/g, '').trim()].slice(0, 12).join('');
      if (!n || n === name) return;
      name = n; write(KEY.name, n);
      if (enabled) void call('POST', { g: GAME, b: 'combo', p: pid, n });
    },
    submit(board, score) {
      if (!Number.isFinite(score) || score <= 0) return;
      const v = Math.round(score);
      if (!better(board, v, best[board])) return;
      best[board] = v; write(KEY.best, best);
      if (!enabled) return;
      pending[board] = v; write(KEY.pending, pending);
      void send(board, v, true);
    },
    fetch: async (board) => enabled ? await call('GET', undefined, `?g=${GAME}&b=${board}&p=${pid}`) as BoardData | null : null,
    label(board) {
      if (board.startsWith('race')) { const s = STARTS[+board.slice(4)]; return t('lb.race', { road: s ? (lang() === 'zh' ? s.zh : s.en) : board }); }
      return t(`lb.${board as 'combo' | 'taxi' | 'heist'}`);
    },
    format(board, score) {
      if (def(board).asc) { const s = score / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }
      return board === 'taxi' ? `¥${score.toLocaleString('en-US')}` : score.toLocaleString('en-US');
    },
  };

  // The results that go on the boards.
  engine.events.on('race:finish', ({ race, time }) => api.submit(`race${race}` as BoardId, time * 1000));
  engine.events.on('stunt:bank', ({ points, lost }) => { if (!lost) api.submit('combo', points); });
  engine.events.on('taxi:shift', ({ earned }) => api.submit('taxi', earned));
  engine.events.on('game:start', () => { if (enabled) for (const [b, v] of Object.entries(pending)) void send(b as BoardId, v, false); });
  engine.add(api);
}
