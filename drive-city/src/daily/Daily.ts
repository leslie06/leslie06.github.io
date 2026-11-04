import { Rng } from '../core/Rng';
import type { TKey } from '../core/I18n';
import { TASKS, taskOf, type Ctx, type Tier } from './Tasks';

/**
 * 每日任务 (2026-11-04, docs/gta-plan.md §15): the books, no engine. A day is the real calendar's, in Beijing, from 5 in
 * the morning (a game day is 48 minutes: by it there would be a new set every hour); three tasks a day, one of each
 * tier; all three done stamps the card, seven stamps the season's rewards; days in a row lift the pay a little.
 */

/** The hour, Beijing time (UTC+8), the day turns over. */
export const TURN_HOUR = 5;
const DAY_MS = 86_400_000;
/** The day number of a moment (ms since 1970): the day that began at the last 5 a.m. in Beijing. */
export const dayOf = (ms: number): number => Math.floor((ms + (8 - TURN_HOUR) * 3_600_000) / DAY_MS);
/** Milliseconds from `ms` to the next turn of the day. */
export const untilTurn = (ms: number): number => (dayOf(ms) + 1) * DAY_MS - (8 - TURN_HOUR) * 3_600_000 - ms;

/** Each tier's pay, before the run's lift. */
export const PAY: Readonly<Record<Tier, number>> = { 0: 1000, 1: 2000, 2: 4000 };
/** All three done: this on top, and a stamp. */
export const FULL_BONUS = 3000;
/** Each day in a row lifts the pay by this, from the second, up to STREAK_MAX of them (+50%). */
export const STREAK_STEP = 0.1;
export const STREAK_MAX = 5;
/** Stamps to a card. */
export const CARD = 7;
/** A season's thing already had (a paint, a jacket): this instead. */
export const HAD_CASH = 5000;

export type Reward = { cash: number } | { paint: string; name: TKey } | { wear: string; name: TKey };
/**
 * What each stamp gives, a season to a card (§15.3): money on 1, 3, 5, the season's paint on 2, a hat on 4, a jacket
 * on 6, and its gold paint on 7. The wear is district/'s (Shops.ts WARDROBE, `gift`), kept as its save key.
 */
export const SEASONS: readonly { name: TKey; rewards: readonly Reward[] }[] = [
  {
    name: 'dly.season.0',
    rewards: [
      { cash: 2000 }, { paint: '#c8102e', name: 'dly.paint.rouge' }, { cash: 4000 }, { wear: 'hat:s0cap', name: 'dly.wear.s0cap' },
      { cash: 6000 }, { wear: 'jacket:s0teal', name: 'dly.wear.s0teal' }, { paint: '#c9a43a', name: 'dly.paint.gold' },
    ],
  },
  {
    name: 'dly.season.1',
    rewards: [
      { cash: 2000 }, { paint: '#2f73b0', name: 'dly.paint.lake' }, { cash: 4000 }, { wear: 'hat:s1bucket', name: 'dly.wear.s1bucket' },
      { cash: 6000 }, { wear: 'jacket:s1vermilion', name: 'dly.wear.s1vermilion' }, { paint: '#ece6d6', name: 'dly.paint.pearl' },
    ],
  },
];
export const seasonOf = (n: number) => SEASONS[n % SEASONS.length];

export interface Slot { id: string; got: number; done: boolean }
export interface DailySave {
  /** Mixed into the day's pick: the same player's tasks on every device (the save follows the account). */
  salt: number;
  /** The day the tasks are for (-1 none yet). */
  day: number;
  tasks: Slot[];
  /** 换一个 used today. */
  swapped: boolean;
  /** Today's three all done (the bonus and the stamp given). */
  full: boolean;
  /** Days in a row with a task done, and the last such day. */
  streak: number;
  last: number;
  stamps: number;
  season: number;
  /** The season paints won (garage/ shows them among its own). */
  paints: string[];
  /** Different days played with the tasks open (for the stats: none of their ids lasts a day). */
  days: number;
  /** The latest day seen: a clock set back keeps today's set. */
  seen: number;
}

export const freshDaily = (salt: number): DailySave => ({ salt, day: -1, tasks: [], swapped: false, full: false, streak: 0, last: -9, stamps: 0, season: 0, paints: [], days: 0, seen: -1 });

const int = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : d);
export function loadDaily(raw: string | null, salt: number): DailySave {
  const s = freshDaily(salt);
  if (!raw) return s;
  try {
    const o = JSON.parse(raw) as Partial<DailySave>;
    s.salt = int(o.salt, salt) >>> 0;
    s.day = int(o.day, -1);
    s.tasks = Array.isArray(o.tasks) ? o.tasks.filter((q) => q && taskOf(q.id)).slice(0, 3).map((q) => ({ id: q.id, got: Math.max(0, +q.got || 0), done: !!q.done })) : [];
    s.swapped = !!o.swapped; s.full = !!o.full;
    s.streak = Math.max(0, int(o.streak, 0)); s.last = int(o.last, -9);
    s.stamps = Math.min(CARD - 1, Math.max(0, int(o.stamps, 0))); s.season = Math.max(0, int(o.season, 0));
    s.paints = Array.isArray(o.paints) ? o.paints.filter((p) => typeof p === 'string' && /^#[0-9a-f]{6}$/i.test(p)) : [];
    s.days = Math.max(0, int(o.days, 0)); s.seen = int(o.seen, s.day);
  } catch { /* broken: start over */ }
  return s;
}

const seed = (day: number, salt: number) => (Math.imul(day, 2654435761) ^ salt) >>> 0;

/** One task of each tier, each from a different kind, from what is open: the same for the same day and salt. */
export function pick(day: number, salt: number, ctx: Ctx, not: readonly string[] = []): Slot[] {
  const rnd = new Rng(seed(day, salt));
  const cats = new Set<string>(), out: Slot[] = [];
  for (const tier of [0, 1, 2] as Tier[]) {
    let can = TASKS.filter((d) => d.tier === tier && (!d.open || d.open(ctx)) && !cats.has(d.cat) && !not.includes(d.id));
    if (!can.length) can = TASKS.filter((d) => d.tier === tier && (!d.open || d.open(ctx)));
    const d = rnd.pick(can);
    cats.add(d.cat);
    out.push({ id: d.id, got: 0, done: false });
  }
  return out;
}

/** The day's landmark: the same for everyone on a day (said in the chat), all of them in turn in a fixed shuffled order. */
export function landmarkOf(day: number, ids: readonly string[]): string | null {
  if (!ids.length) return null;
  const order = [...ids].sort(), rnd = new Rng(0x1a2d);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order[((day % order.length) + order.length) % order.length];
}

/** A new day (or the first): today's set. False when nothing changed - the same day, or the clock set back. */
export function refresh(s: DailySave, day: number, ctx: Ctx): boolean {
  if (day < s.seen || (day === s.day && s.tasks.length === 3)) return false;
  if (day > s.seen) s.days++;
  s.seen = day; s.day = day;
  s.tasks = pick(day, s.salt, ctx);
  s.swapped = false; s.full = false;
  return true;
}

/** Swap task `i` (not done) for another of its tier: once a day. */
export function swap(s: DailySave, i: number, ctx: Ctx): boolean {
  const q = s.tasks[i], d = q && taskOf(q.id);
  if (!q || !d || q.done || s.swapped) return false;
  const others = s.tasks.filter((_, j) => j !== i).map((o) => taskOf(o.id)!);
  const rnd = new Rng(seed(s.day, s.salt ^ 0x5a5a));
  const can = TASKS.filter((t) => t.tier === d.tier && t.id !== d.id && (!t.open || t.open(ctx)) && !others.some((o) => o.cat === t.cat || o.id === t.id));
  if (!can.length) return false;
  s.tasks[i] = { id: rnd.pick(can).id, got: 0, done: false };
  s.swapped = true;
  return true;
}

/** The days in a row as of `day` (0 once a day has been missed). */
export const streakOf = (s: DailySave, day: number): number => (s.last === day || s.last === day - 1 ? s.streak : 0);
/** A tier's pay with `streak` days in a row (today counted). */
export const payOf = (tier: Tier, streak: number): number => Math.round(PAY[tier] * (1 + STREAK_STEP * Math.min(STREAK_MAX, Math.max(0, streak - 1))) / 10) * 10;

export interface Step {
  /** Past half way (a task of more than one). */
  half?: boolean;
  /** Done now: its pay. */
  paid?: number;
  /** And with it all three: the bonus, the stamp (1..CARD), what it gives; `card` the card was filled. */
  full?: { bonus: number; stamp: number; reward: Reward; card: boolean };
}

/** `amount` more of task `i` (or the most so far, a `best` task) on `day`. */
export function advance(s: DailySave, i: number, amount: number, day: number): Step | null {
  const q = s.tasks[i], d = q && taskOf(q.id);
  if (!q || !d || q.done || amount <= 0 || s.day !== day) return null;
  const was = q.got;
  q.got = d.best ? Math.max(q.got, amount) : q.got + amount;
  if (q.got < d.n) return d.n > 1 && was < d.n / 2 && q.got >= d.n / 2 ? { half: true } : null;
  q.got = d.n; q.done = true;
  if (s.last !== day) { s.streak = s.last === day - 1 ? s.streak + 1 : 1; s.last = day; }
  const step: Step = { paid: payOf(d.tier, s.streak) };
  if (!s.full && s.tasks.every((o) => o.done)) {
    s.full = true;
    const stamp = s.stamps + 1, reward = seasonOf(s.season).rewards[stamp - 1], card = stamp >= CARD;
    step.full = { bonus: FULL_BONUS, stamp, reward, card };
    if (card) { s.stamps = 0; s.season++; } else s.stamps = stamp;
  }
  return step;
}

/** What a stamp's reward comes to: a paint is added to the save, a thing already had is HAD_CASH instead. */
export function grant(s: DailySave, r: Reward, hasWear: (key: string) => boolean): Reward {
  if ('paint' in r) {
    if (s.paints.includes(r.paint)) return { cash: HAD_CASH };
    s.paints.push(r.paint);
    return r;
  }
  if ('wear' in r && hasWear(r.wear)) return { cash: HAD_CASH };
  return r;
}
