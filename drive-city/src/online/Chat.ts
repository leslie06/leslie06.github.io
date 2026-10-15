import type { Engine, System } from '../core/Engine';
import { statsEndpoint } from './Leaderboard';

/**
 * In-game chat (2026-10-15, 「让在线的玩家在游戏里可以实时发评论聊天，未登录的用户显示游客+编号」): the stats server's
 * /chat (`../stats/worker.js`, 「聊天」), polled - every 2.5 s while the chat is open, every 15 s otherwise (the unread
 * count), only while the page is shown. A logged-in player (online/Cloud.ts) speaks under their account's name; anyone
 * else as 游客 and a number the server derives from the leaderboards' player id (the same on this device every time).
 * The server filters and rate-limits; this keeps the last MAX messages and says what went wrong.
 */
export interface ChatMsg { id: number; ts: number; name: string; guest: boolean; text: string; mine?: boolean }
export interface ChatApi extends System {
  readonly enabled: boolean;
  /** The latest messages, oldest first. */
  readonly msgs: readonly ChatMsg[];
  /** Arrived since the chat was last open. */
  readonly unread: number;
  /** The chat panel is open (fast polling, unread cleared). */
  open: boolean;
  send(text: string): Promise<{ ok: true } | { ok: false; error: string; until?: number }>;
  /** New messages arrived (the UI shows them); `history`: the first load's, already said before the player came. */
  onMsgs: ((fresh: readonly ChatMsg[], history: boolean) => void) | null;
}

const GAME = 'bcity', MAX = 80, FAST = 2.5, SLOW = 15;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) as T; } catch { return d; } };

export function install(engine: Engine): ChatApi | null {
  const { base, enabled } = statsEndpoint();
  const msgs: ChatMsg[] = [];
  const mine = new Set<number>();
  let last = 0, loaded = false, unread = 0, open = false, wait = 0, busy = false;

  const pid = () => {
    let p = read<string>('drivecity.pid', '');
    if (!/^[a-z0-9]{8,32}$/i.test(p)) { p = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24); try { localStorage.setItem('drivecity.pid', JSON.stringify(p)); } catch { /* private mode */ } }
    return p;
  };
  const add = (list: ChatMsg[]) => {
    const fresh = list.filter((m) => !msgs.some((x) => x.id === m.id)).map((m) => ({ ...m, mine: mine.has(m.id) }));
    if (!fresh.length) return;
    msgs.push(...fresh);
    msgs.sort((a, b) => a.id - b.id);
    if (msgs.length > MAX) msgs.splice(0, msgs.length - MAX);
    last = Math.max(last, ...fresh.map((m) => m.id));
    if (loaded && !open) unread += fresh.filter((m) => !m.mine).length;
    api.onMsgs?.(fresh, !loaded);
  };
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(`${base}/chat?g=${GAME}${loaded ? `&after=${last}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const j = await res.json() as { msgs: ChatMsg[] };
        // the first load is history: shown in the panel, not counted as unread
        add(j.msgs ?? []);
        loaded = true;
      }
    } catch { /* offline: next time */ }
    busy = false;
  };

  const api: ChatApi = {
    name: 'chat',
    enabled,
    get msgs() { return msgs; },
    get unread() { return unread; },
    get open() { return open; },
    set open(v) { open = v; if (v) { unread = 0; wait = 0; } },
    onMsgs: null,
    async send(text) {
      const t = read<{ token?: string } | null>('drivecity.acct.v1', null)?.token;
      try {
        const res = await fetch(`${base}/chat`, { method: 'POST', body: JSON.stringify({ g: GAME, text, p: pid(), t }), headers: { 'content-type': 'text/plain' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
        const j = await res.json() as { ok?: boolean; msg?: ChatMsg; error?: string; until?: number };
        if (!res.ok || !j.msg) return { ok: false, error: j.error ?? 'server', until: j.until };
        mine.add(j.msg.id);
        add([j.msg]);
        return { ok: true };
      } catch { return { ok: false, error: 'network' }; }
    },
  };
  if (!enabled) { engine.add(api); return api; }
  // real seconds, not the game's (it stops while paused, and the chat should not)
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    wait -= 0.5;
    if (wait > 0) return;
    wait = open ? FAST : SLOW;
    void poll();
  }, 500);
  engine.add(api);
  return api;
}
