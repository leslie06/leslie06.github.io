import type { GameEvents } from '../core/Events';
import type { TKey } from '../core/I18n';

/** 容易 / 中等 / 难: one of each a day. */
export type Tier = 0 | 1 | 2;
/** No two of a day's three from the same one. */
export type Cat = 'drive' | 'money' | 'race' | 'deliver' | 'roam' | 'lane' | 'police';
/** Where 带我去 leads: a 快速前往 spot (travel/), or the day's landmark. */
export type Where = 'nanluo' | 'tofu' | 'landmark';

/** What the player has open to them, for which tasks can be set. */
export interface Ctx {
  rabbitsLeft: number;
  checkinsLeft: number;
  /** Owns a property (estate/). */
  owns: boolean;
  /** There is a landmark to send them to today. */
  landmark: boolean;
}

export interface TaskDef {
  id: string;
  tier: Tier;
  cat: Cat;
  /** How much makes it done. */
  n: number;
  /** Its line, `{n}` the amount (the landmark's: `{name}`). */
  name: TKey;
  /** The event it counts, and how much one adds (0: not this one); `best` keeps the largest instead of adding up. */
  on?: keyof GameEvents;
  count?: (e: never) => number;
  best?: boolean;
  where?: Where;
  /** Only set when this holds. */
  open?: (c: Ctx) => boolean;
}

const def = <K extends keyof GameEvents>(d: Omit<TaskDef, 'on' | 'count'> & { on: K; count: (e: GameEvents[K]) => number }): TaskDef => d as unknown as TaskDef;

/**
 * Every task there is (docs/gta-plan.md §15.5): each counts an event the game already sends. Kept to what can be done
 * in a sitting: 容易 two or three minutes anywhere, 中等 five to eight with a drive somewhere, 难 ten to fifteen.
 * Ids are kept in saves: rename none.
 */
export const TASKS: readonly TaskDef[] = [
  // 容易
  def({ id: 'drift', tier: 0, cat: 'drive', n: 1500, name: 'dly.t.drift', on: 'drift:end', count: (e) => (e.crashed ? 0 : e.score) }),
  def({ id: 'near', tier: 0, cat: 'drive', n: 10, name: 'dly.t.near', on: 'stunt:event', count: (e) => (e.kind === 'near' ? 1 : 0) }),
  def({ id: 'oncoming', tier: 0, cat: 'drive', n: 5, name: 'dly.t.oncoming', on: 'stunt:event', count: (e) => (e.kind === 'oncoming' ? 1 : 0) }),
  def({ id: 'combo', tier: 0, cat: 'drive', n: 150, name: 'dly.t.combo', on: 'stunt:bank', count: (e) => (e.lost ? 0 : e.cash), best: true }),
  def({ id: 'fare1', tier: 0, cat: 'money', n: 1, name: 'dly.t.fare', on: 'taxi:fare', count: () => 1 }),
  def({ id: 'photo', tier: 0, cat: 'lane', n: 1, name: 'dly.t.photo', on: 'district:photo', count: () => 1, where: 'nanluo' }),
  def({ id: 'collect', tier: 0, cat: 'money', n: 1, name: 'dly.t.collect', on: 'estate:collected', count: () => 1, open: (c) => c.owns }),
  // 中等
  def({ id: 'fares', tier: 1, cat: 'money', n: 3, name: 'dly.t.fares', on: 'taxi:fare', count: () => 1 }),
  def({ id: 'star5', tier: 1, cat: 'money', n: 2, name: 'dly.t.star5', on: 'taxi:fare', count: (e) => (e.stars === 5 ? 1 : 0) }),
  def({ id: 'jobs', tier: 1, cat: 'money', n: 2, name: 'dly.t.jobs', on: 'job:done', count: () => 1 }),
  def({ id: 'race', tier: 1, cat: 'race', n: 1, name: 'dly.t.race', on: 'race:finish', count: (e) => (e.place <= 3 ? 1 : 0) }),
  def({ id: 'jump', tier: 1, cat: 'drive', n: 2, name: 'dly.t.jump', on: 'stunt:jump', count: () => 1 }),
  def({ id: 'deliver', tier: 1, cat: 'deliver', n: 2, name: 'dly.t.deliver', on: 'district:delivered', count: () => 1, where: 'nanluo' }),
  def({ id: 'dance', tier: 1, cat: 'lane', n: 1, name: 'dly.t.dance', on: 'district:dance', count: () => 1, where: 'nanluo' }),
  // counted by daily/ itself: `checkin:visit` of the day's landmark (CheckinApi.want)
  { id: 'landmark', tier: 1, cat: 'roam', n: 1, name: 'dly.t.landmark', where: 'landmark', open: (c) => c.landmark },
  def({ id: 'checkin', tier: 1, cat: 'roam', n: 1, name: 'dly.t.checkin', on: 'checkin', count: () => 1, open: (c) => c.checkinsLeft > 0 }),
  // 难
  def({ id: 'trial', tier: 2, cat: 'race', n: 1, name: 'dly.t.trial', on: 'trial:finish', count: (e) => (e.medal >= 1 ? 1 : 0) }),
  def({ id: 'escape', tier: 2, cat: 'police', n: 1, name: 'dly.t.escape', on: 'wanted:escaped', count: (e) => (e.level >= 3 ? 1 : 0) }),
  def({ id: 'wreck', tier: 2, cat: 'police', n: 3, name: 'dly.t.wreck', on: 'police:wrecked', count: (e) => (e.nearPlayer ? 1 : 0) }),
  def({ id: 'tofu', tier: 2, cat: 'deliver', n: 1, name: 'dly.t.tofu', on: 'tofu:delivered', count: (e) => (e.water >= 0.8 ? 1 : 0), where: 'tofu' }),
  def({ id: 'racket', tier: 2, cat: 'lane', n: 1, name: 'dly.t.racket', on: 'district:racket', count: (e) => (e.result === 'won' ? 1 : 0), where: 'nanluo' }),
  def({ id: 'shift', tier: 2, cat: 'money', n: 1500, name: 'dly.t.shift', on: 'taxi:shift', count: (e) => e.earned, best: true }),
  def({ id: 'rabbit', tier: 2, cat: 'roam', n: 1, name: 'dly.t.rabbit', on: 'collect:found', count: () => 1, open: (c) => c.rabbitsLeft > 0 }),
];

export const taskOf = (id: string): TaskDef | undefined => TASKS.find((d) => d.id === id);
