import type { Engine, System } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { shotMode } from '../debug/ShotMode';
import type { HudApi } from '../game/Contracts';
import { STARTS } from '../races';
import { COURSES } from '../trials/Courses';

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
export type BoardId = 'race0' | 'race1' | 'race2' | 'race3' | 'combo' | 'taxi' | 'heist' | `trial_${string}`;
export interface BoardDef { id: BoardId; asc: boolean }
export const BOARDS: BoardDef[] = [
  ...STARTS.map((_, i) => ({ id: `race${i}` as BoardId, asc: true })),
  { id: 'combo', asc: false }, { id: 'taxi', asc: false }, { id: 'heist', asc: true },
  // the time trials (trials/), one board a course, the fastest time
  ...COURSES.map((c) => ({ id: `trial_${c.id}` as BoardId, asc: true })),
];
export interface BoardRow { name: string; score: number; me: boolean }
export interface BoardData { board: BoardId; asc: boolean; total: number; top: BoardRow[]; me: { rank: number; score: number } | null }

/**
 * 赛道纪录史 (2026-11-04, 「每次打破纪录的选手纪录下来，并记录开车时长」): one line on the server each time a course's
 * record falls - the nickname, the time from the start gate to the finish (ms), how it was run (a time trial alone, or a
 * room's race and how many were in it), when. `stats/worker.js` `POST /rec` / `GET /rec`.
 */
export interface CourseRec { name: string; ms: number; mode: 'solo' | 'room'; racers: number; ts: number; me?: boolean }
export interface RecResult { record: boolean; prev: CourseRec | null; best: CourseRec }

export interface LeaderboardApi extends System {
  readonly enabled: boolean;
  /** Each course's record now (`trial_<id>`), as last heard (refreshed every few minutes in play). */
  readonly records: Readonly<Record<string, CourseRec>>;
  /** A run on a course (ms from the gate): a record, or the record it did not beat; null offline. */
  record(board: BoardId, ms: number, mode: 'solo' | 'room', racers: number): Promise<RecResult | null>;
  /** A course's records, newest first, and how many there have been. */
  history(board: BoardId): Promise<{ n: number; hist: CourseRec[] } | null>;
  /** A record this game has said already (a room's friend broke it): not said again when the poll hears of it. */
  told(board: BoardId, ms: number): void;
  /** The player's nickname (setting it renames them on every board). */
  nick: string;
  /** A result: sent if it beats this device's best on that board; the reply's rank is toasted. */
  submit(board: BoardId, score: number): void;
  fetch(board: BoardId): Promise<BoardData | null>;
  /** How a board is called and how its scores read, in the current language. */
  label(board: BoardId): string;
  format(board: BoardId, score: number): string;
  /** Says a record this player has just set (the time trial's, a room race's). */
  recordToast(board: BoardId, r: RecResult): void;
  debug: { poll(): Promise<void> };
}

const DEFAULT_BASE = 'https://stats.fishai.asia';
const GAME = 'bcity';
const TIMEOUT = 6000;
/** How often the courses' records are asked for in play (s): a new one somebody else set is toasted. */
const REC_POLL = 180;
const KEY = { pid: 'drivecity.pid', name: 'drivecity.name', best: 'drivecity.lb.best', pending: 'drivecity.lb.pending' };

const read = <T>(k: string, fb: T): T => { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v) as T; } catch { return fb; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/**
 * The site's stats service and whether to talk to it (the leaderboards and the feedback panel, online/Feedback.ts):
 * the published game does, a dev server and shot mode do not unless `?lb=<base url>`; `?lb=0` turns it off anywhere.
 */
export function statsEndpoint(): { base: string; enabled: boolean } {
  const q = new URLSearchParams(location.search).get('lb');
  const local = /^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname);
  return { base: q && q !== '0' ? q.replace(/\/$/, '') : DEFAULT_BASE, enabled: q === '0' ? false : !!q || (!shotMode && !local) };
}

export function install(engine: Engine): void {
  const { base, enabled } = statsEndpoint();

  let pid = read<string>(KEY.pid, '');
  if (!/^[a-z0-9]{8,32}$/i.test(pid)) { pid = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24); write(KEY.pid, pid); }
  let name = read<string>(KEY.name, '');
  if (!name) { name = (lang() === 'zh' ? '车手' : 'Driver') + String(1000 + Math.floor(Math.random() * 9000)); write(KEY.name, name); }
  const best = read<Record<string, number>>(KEY.best, {});
  /** Bests the server has not acknowledged yet (offline, timed out): sent again at the next start. */
  const pending = read<Record<string, number>>(KEY.pending, {});
  const def = (b: BoardId) => BOARDS.find((d) => d.id === b)!;
  const better = (b: BoardId, v: number, than: number | undefined) => than === undefined || (def(b).asc ? v < than : v > than);

  const call = async (method: 'GET' | 'POST', body?: unknown, query = '', path = '/lb'): Promise<any> => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      // text/plain: a "simple" request, so no CORS preflight round trip.
      const res = await fetch(`${base}${path}${query}`, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { 'content-type': 'text/plain' } : undefined, signal: ctl.signal, cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch { return null; } finally { clearTimeout(timer); }
  };

  const send = async (board: BoardId, score: number, loud: boolean) => {
    const r = await call('POST', { g: GAME, b: board, p: pid, n: name, v: score });
    if (!r?.ok) return;
    if (pending[board] === score) { delete pending[board]; write(KEY.pending, pending); }
    if (loud && r.rank) engine.get<HudApi>('hud')?.toast(t('lb.rank', { board: api.label(board), rank: r.rank, total: r.total }));
  };

  // --- 赛道纪录 ---
  let records: Record<string, CourseRec> = {}, heard = false, pollT = REC_POLL - 8;
  const said = new Set<string>();
  const timeOf = (ms: number) => { const v = ms / 1000; return `${Math.floor(v / 60)}:${(v % 60).toFixed(2).padStart(5, '0')}`; };
  const pollRecords = async () => {
    const r = await call('GET', undefined, `?g=${GAME}&p=${pid}`, '/rec') as { recs?: Record<string, CourseRec> } | null;
    if (!r?.recs) return;
    const playing = engine.get<{ name: string; state: string }>('ui')?.state === 'playing';
    for (const [b, rec] of Object.entries(r.recs)) {
      const was = records[b], key = `${b}:${rec.ms}`;
      // somebody else's new record since we last looked: everyone in the city hears of it
      if (heard && playing && !rec.me && (!was || rec.ms < was.ms) && !said.has(key)) {
        engine.get<HudApi>('hud')?.toast(t('rec.news', { name: rec.name, course: api.label(b as BoardId), time: timeOf(rec.ms) }), 6);
      }
      said.add(key);
    }
    records = r.recs; heard = true;
  };

  const api: LeaderboardApi = {
    name: 'leaderboard',
    enabled,
    get records() { return records; },
    async record(board, ms, mode, racers) {
      if (!enabled || !Number.isFinite(ms) || ms <= 0) return null;
      const r = await call('POST', { g: GAME, b: board, p: pid, n: name, v: Math.round(ms), m: mode, r: racers }, '', '/rec') as (RecResult & { ok?: boolean }) | null;
      if (!r?.ok) return null;
      records = { ...records, [board]: r.best };
      said.add(`${board}:${r.best.ms}`);
      return { record: r.record, prev: r.prev ?? null, best: r.best };
    },
    history: async (board) => (enabled ? await call('GET', undefined, `?g=${GAME}&b=${board}&p=${pid}`, '/rec') : null),
    told(board, ms) { said.add(`${board}:${Math.round(ms)}`); },
    recordToast: () => {},
    debug: { poll: () => pollRecords() },
    update(dt) {
      if (!enabled || (pollT += dt) < REC_POLL) return;
      pollT = 0;
      void pollRecords();
    },
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
      if (board.startsWith('trial_')) { const c = COURSES.find((q) => `trial_${q.id}` === board); return t('lb.trial', { road: c ? (lang() === 'zh' ? c.zh : c.en) : board }); }
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
  engine.events.on('trial:finish', ({ id, time }) => {
    const board = `trial_${id}` as BoardId;
    api.submit(board, time * 1000);
    // the record (a time trial runs from its gate: a rolling start)
    void api.record(board, time * 1000, 'solo', 1).then((r) => { if (r?.record) recordToast(board, r); });
  });
  const recordToast = (board: BoardId, r: RecResult) => {
    const course = api.label(board), time = timeOf(r.best.ms);
    engine.get<HudApi>('hud')?.toast(r.prev ? t('rec.mine', { course, time, name: r.prev.name, prev: timeOf(r.prev.ms) }) : t('rec.first', { course, time }), 7);
    engine.events.emit('rec:broken', { board, ms: r.best.ms });
  };
  api.recordToast = recordToast;
  engine.events.on('game:start', () => { if (enabled) { for (const [b, v] of Object.entries(pending)) void send(b as BoardId, v, false); void pollRecords(); } });
  engine.add(api);
}
