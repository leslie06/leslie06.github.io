import type { Engine, System } from '../core/Engine';
import { lang, t } from '../core/I18n';
import type { HudApi, MissionApi, NavApi } from '../game/Contracts';
import type { CampaignApi } from '../campaign';
import type { CheckinApi } from '../checkin';
import type { DistrictApi } from '../district';
import type { EstateApi } from '../estate';
import type { TravelApi } from '../travel';
import { stat } from '../online/Funnel';
import { readPlaytime } from '../ui/PlayTime';
import { C, F, css, el } from '../ui/theme';
import {
  advance, CARD, dayOf, grant, landmarkOf, loadDaily, payOf, refresh, seasonOf, SEASONS, streakOf, swap, untilTurn, type DailySave, type Reward,
} from './Daily';
import { TASKS, taskOf, type Ctx, type Tier, type Where } from './Tasks';

/** One of today's three, as the panel shows it. */
export interface DailyRow {
  i: number; id: string; tier: Tier; name: string; got: number; n: number; done: boolean;
  /** What it pays now (the run of days in it). */
  pay: number;
  /** 带我去 leads somewhere, metres from the player; and a 快速前往 there, when there is one. */
  where: Where | null; dist: number | null; jump: boolean;
}

export interface DailyApi extends System {
  /** Open to the player yet (chapter 1 passed, or 10 minutes played). */
  readonly open: boolean;
  readonly rows: readonly DailyRow[];
  readonly saved: Readonly<DailySave>;
  /** Days running as of today. */
  readonly streak: number;
  /** Done of today's three. */
  readonly done: number;
  /** The title's and the pause screen's line ('' while not open). */
  readonly line: string;
  /** The season paints won (garage/ lists them). */
  readonly paints: readonly { color: string; name: string }[];
  /** Swap task `i`: once a day. */
  swap(i: number): boolean;
  /** The GPS to task `i`'s place: why not, or null. */
  go(i: number): string | null;
  /** 快速前往 to task `i`'s place: why not, or null. */
  jump(i: number): string | null;
  /** ms to the next day. */
  readonly untilTurn: number;
  /** The panel (ui/Daily.ts sets it): the 附近 panel opens it. */
  show?: () => void;
  debug: { set(ids: string[]): void; days(n: number): void; open(): void; finish(i: number): void; save(): DailySave; landmark(): string | null };
}

const KEY = 'drivecity.daily.v1';
/** Opened by this much play (seconds), without the first chapter. */
const OPEN_AFTER = 600;
/** The nudge, this long into a game (s), once. */
const NUDGE_AFTER = 40;
/** Where 带我去's 快速前往 spots are (travel/'s ids). */
const SPOT: Partial<Record<Where, string>> = { nanluo: 'nanluo', tofu: 'tofu' };

css(`
.dly-card{position:fixed;left:50%;top:16%;z-index:42;pointer-events:none;transform:translateX(-50%) scale(1.08);opacity:0;transition:transform .35s cubic-bezier(.2,1.4,.4,1),opacity .3s;
  width:min(360px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;border-radius:14px;background:#15191c;border:1px solid ${C.yellowDim};box-shadow:0 18px 60px rgba(0,0,0,.55);font-family:${F.ui};color:${C.paper};text-align:center}
.dly-card.on{transform:translateX(-50%) scale(1);opacity:1}
.dly-card .h{font:800 13px/1 ${F.num};letter-spacing:.2em;color:${C.yellow}}
.dly-card .stamps{display:flex;justify-content:center;gap:6px;margin:14px 0 10px}
.dly-card .stamps i{width:26px;height:26px;border-radius:50%;border:2px dashed ${C.line};box-sizing:border-box}
.dly-card .stamps i.on{border:0;background:#c8231d;box-shadow:inset 0 0 0 3px #e8594d}
.dly-card .stamps i.new{animation:dly-stamp .5s .25s both cubic-bezier(.3,1.6,.5,1)}
@keyframes dly-stamp{from{transform:scale(2.4);opacity:0}to{transform:scale(1);opacity:1}}
.dly-card .b{font:800 22px/1.3 ${F.num};color:${C.paper}}
.dly-card .r{font:700 14px/1.5 ${F.ui};color:#f3c64a;margin-top:4px}
.dly-card .s{font:600 12px/1.5 ${F.ui};color:${C.muted};margin-top:6px}
body.dc-touch .dly-card{top:8%}
`);

/**
 * 每日任务 (2026-11-04, docs/gta-plan.md §15, 「我想添加任务模式，每个玩家进来每天可以做任务，任务做完要有奖励，为了
 * 留住玩家」): three tasks a real day, set from what the game already sends (Tasks.ts), counted as they happen, paid on
 * the spot; all three stamp the card (the season's paints and wear). It sets no GPS of its own (支线不能自己抢导航):
 * the panel's 带我去 does, when the player asks. The books are Daily.ts.
 */
export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if (q.has('shot') && !q.has('daily')) return;
  const salt = (Math.random() * 0xffffffff) >>> 0;
  let save = loadDaily(null, salt);
  const load = () => { try { save = loadDaily(localStorage.getItem(KEY), salt); } catch { /* private mode */ } };
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ } };
  load();

  const hud = () => engine.get<HudApi>('hud');
  const missions = () => engine.get<MissionApi>('missions');
  const checkin = () => engine.get<CheckinApi>('checkins');
  let offset = 0, forceOpen = false;
  const now = () => Date.now() + offset;
  const today = () => dayOf(now());

  const isOpen = (): boolean => {
    if (forceOpen) return true;
    if (save.days > 0) return true;   // once open, open for good (the playtime is not read back in a new save)
    const first = engine.get<CampaignApi>('campaign')?.list()[0];
    return (!!first && first.state !== 'next' && first.state !== 'locked') || readPlaytime() >= OPEN_AFTER;
  };
  const sites = () => checkin()?.sites ?? [];
  const landmark = () => { const id = landmarkOf(today(), sites().map((s) => s.id)); return sites().find((s) => s.id === id) ?? null; };
  const ctx = (): Ctx => {
    const r = engine.get<{ name: string; found: number; total: number }>('collect'), c = checkin();
    return {
      rabbitsLeft: r ? r.total - r.found : 0, checkinsLeft: c ? c.total - c.found : 0,
      owns: Object.keys(engine.get<EstateApi>('estate')?.saved.owned ?? {}).length > 0, landmark: sites().length > 0,
    };
  };
  /** Today's set, if the day has turned (or it has just opened): true when it is new. */
  const roll = (): boolean => {
    if (!isOpen()) return false;
    const fresh = refresh(save, today(), ctx());
    if (fresh) { store(); stat.set('dlyd', save.days); }
    want();
    return fresh;
  };
  /** The day's landmark is wanted of checkin/ while it is still to do (and no longer once done). */
  const want = () => {
    const c = checkin();
    if (!c) return;
    const id = landmark()?.id ?? null, todo = save.day === today() && save.tasks.some((q) => q.id === 'landmark' && !q.done);
    if (todo) c.want = id; else if (c.want === id) c.want = null;
  };

  const nameOf = (id: string): string => {
    const d = taskOf(id)!;
    const lm = id === 'landmark' ? landmark() : null;
    return t(d.name, { n: d.n.toLocaleString(), name: lm ? lm.name[lang()] : '' });
  };
  const whereOf = (w: Where | undefined): { x: number; z: number } | null => {
    if (!w) return null;
    if (w === 'landmark') return landmark();
    return engine.get<TravelApi>('travel')?.spots.find((s) => s.id === SPOT[w]) ?? null;
  };

  // --- the card at all three ---
  const card = el('div', 'dly-card', document.body);
  let cardTimer = 0;
  const rewardText = (r: Reward) => ('cash' in r ? t('dly.got.cash', { n: r.cash.toLocaleString() }) : 'paint' in r ? t('dly.got.paint', { name: t(r.name) }) : t('dly.got.wear', { name: t(r.name) }));
  const showCard = (stamp: number, bonus: number, got: Reward, full: boolean) => {
    card.replaceChildren();
    el('div', 'h', card).textContent = t('dly.cardTitle');
    const row = el('div', 'stamps', card);
    for (let k = 1; k <= CARD; k++) el('i', k < stamp ? 'on' : k === stamp ? 'on new' : '', row);
    el('div', 'b', card).textContent = t('dly.cardBonus', { n: bonus.toLocaleString() });
    el('div', 'r', card).textContent = `${t('dly.cardStamp', { n: stamp, of: CARD })} · ${rewardText(got)}`;
    el('div', 's', card).textContent = full ? t('dly.cardFull', { season: t(seasonOf(save.season).name) }) : t('dly.cardTomorrow');
    card.classList.add('on');
    clearTimeout(cardTimer);
    cardTimer = window.setTimeout(() => card.classList.remove('on'), 6500);
  };

  // --- counting ---
  let aimed: string | null = null;
  const bump = (id: string, amount: number) => {
    if (amount <= 0) return;
    roll();
    const i = save.tasks.findIndex((s) => s.id === id);
    if (i < 0) return;
    const step = advance(save, i, amount, today());
    if (!step) return;
    const d = taskOf(id)!;
    if (step.half) hud()?.toast(t('dly.half', { name: nameOf(id), got: Math.floor(save.tasks[i].got).toLocaleString(), n: d.n.toLocaleString() }), 3);
    if (step.paid) {
      missions()?.addCash(step.paid);
      hud()?.toast(t('dly.toast', { name: nameOf(id), n: step.paid.toLocaleString() }), 4.5);
      engine.events.emit('daily:done', { id, tier: d.tier });
      stat.mark('dly1'); stat.set('dlys', save.streak);
      if (aimed === id) { aimed = null; engine.get<NavApi>('nav')?.clearTarget('mission'); }
    }
    if (step.full) {
      const f = step.full;
      missions()?.addCash(f.bonus);
      const dist = engine.get<DistrictApi>('district');
      const got = grant(save, f.reward, (k) => !!dist?.hasWear(k));
      if ('cash' in got) missions()?.addCash(got.cash);
      else if ('wear' in got) dist?.grant(got.wear);
      // after the task's own toast has had a moment
      setTimeout(() => showCard(f.stamp, f.bonus, got, f.card), 1200);
      engine.events.emit('daily:full', { stamp: f.stamp });
      stat.mark('dly3');
    }
    store();
    want();
  };
  for (const d of TASKS) if (d.on && d.count) {
    const count = d.count as (e: unknown) => number;
    engine.events.on(d.on, (e) => { if (save.tasks.some((s) => s.id === d.id && !s.done)) bump(d.id, count(e)); });
  }
  engine.events.on('checkin:visit', ({ id }) => { if (id === landmark()?.id) bump('landmark', 1); });

  // --- the once-a-game nudge, and the save following the account (online/Cloud.ts swaps it in before a game) ---
  let since = -1, nudged = false, called = false;
  engine.events.on('game:start', () => { load(); roll(); since = 0; stat.set('dlyd', save.days); if (save.days) stat.set('dlys', streakOf(save, today())); });
  engine.events.on('campaign:call', () => { called = true; });

  const rows = (): DailyRow[] => {
    const p = engine.get<{ name: string; position: { x: number; z: number } }>('player')?.position;
    const streak = Math.max(1, save.last === today() ? save.streak : streakOf(save, today()) + 1);
    return save.day === today() ? save.tasks.map((s, i) => {
      const d = taskOf(s.id)!, at = whereOf(d.where);
      return {
        i, id: s.id, tier: d.tier, name: nameOf(s.id), got: Math.floor(s.got), n: d.n, done: s.done, pay: payOf(d.tier, streak),
        where: at ? d.where! : null, dist: at && p ? Math.hypot(at.x - p.x, at.z - p.z) : null, jump: !!(d.where && SPOT[d.where]),
      };
    }) : [];
  };

  let poll = 0;
  const api: DailyApi = {
    name: 'daily',
    get open() { return isOpen(); },
    get rows() { roll(); return rows(); },
    get saved() { return save; },
    get streak() { return streakOf(save, today()); },
    get done() { return save.day === today() ? save.tasks.filter((s) => s.done).length : 0; },
    get line() {
      if (!isOpen()) return '';
      roll();
      const done = api.done;
      return done === 0 && !save.tasks.some((s) => s.got > 0) ? t('dly.lineNew') : t('dly.line', { done, s: save.stamps, d: api.streak });
    },
    get paints() {
      return save.paints.map((color) => {
        for (const s of SEASONS) for (const r of s.rewards) if ('paint' in r && r.paint === color) return { color, name: t(r.name) };
        return { color, name: '' };
      });
    },
    get untilTurn() { return untilTurn(now()); },
    swap(i) {
      const ok = swap(save, i, ctx());
      if (ok) { store(); roll(); }
      return ok;
    },
    go(i) {
      const r = rows()[i], at = r && whereOf(taskOf(r.id)!.where);
      const nav = engine.get<NavApi>('nav');
      if (!r || !at || !nav) return 'no place';
      nav.setTarget({ x: at.x, z: at.z, kind: 'mission', label: r.name });
      aimed = r.id;
      hud()?.toast(t('dly.aimed', { name: r.name }), 3);
      return null;
    },
    jump(i) {
      const r = rows()[i], spot = r?.where ? SPOT[r.where] : undefined, tr = engine.get<TravelApi>('travel');
      if (!spot || !tr) return 'no spot';
      return tr.go(spot);
    },
    debug: {
      set(ids) { roll(); save.tasks = ids.slice(0, 3).map((id) => ({ id, got: 0, done: false })); save.full = false; store(); roll(); },
      days(n) { offset += n * 86_400_000; roll(); },
      open() { forceOpen = true; roll(); },
      finish(i) { const s = save.tasks[i]; if (s) bump(s.id, taskOf(s.id)!.n); },
      save: () => save,
      landmark: () => landmark()?.id ?? null,
    },

    update(dt) {
      // the day can turn while playing (5 a.m.); a second is often enough to look
      if ((poll += dt) > 1) { poll = 0; roll(); }
      if (since < 0) return;
      const ui = engine.get<{ name: string; state: string }>('ui');
      if (ui?.state !== 'playing') return;
      since += dt;
      if (nudged || since < NUDGE_AFTER) return;
      // not over a call from the story, a chapter, a line on screen: the story first
      const busy = !!engine.get<CampaignApi>('campaign')?.running || !!engine.get<{ name: string; busy: boolean }>('dialogue')?.busy || !!missions()?.busy;
      if (busy && since < NUDGE_AFTER * 4) return;
      nudged = true;
      const left = 3 - api.done;
      if (!isOpen() || called || busy || left <= 0 || save.day !== today()) return;
      hud()?.toast(t(document.body.classList.contains('dc-touch') ? 'dly.nudgeTouch' : 'dly.nudge', { n: left }), 6);
    },
  };
  engine.add(api);
}
