import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Blip, CombatApi, HudApi, MissionApi, NavApi, PlayerApi, RenderApi, WantedApi } from '../game/Contracts';
import { Fade } from '../campaign/Screens';
import {
  accrue, AWAKE_MIN, buyBlocked, capOf, dailyOf, ESTATE_IDS, loadEstate, PROPERTIES, RAID_ODDS, RAID_SHARE, RAID_TIME,
  SAFEHOUSE_PRICE, sleepHours, upBlocked, wakeHour, type EstateId, type EstateSave,
} from './Ledger';

export type { EstateId } from './Ledger';

/** Where a property is (its door): the system that runs it registers it (district/). */
export interface EstatePlace { id: EstateId; x: number; z: number }
/** 黑豹's men at one of the player's properties: real seconds left to get there, and whether the fight has begun. */
export interface Raid { id: EstateId; left: number; fighting: boolean }

/**
 * 产业和安全屋 (2026-11-04, docs/gta-plan.md §14): the properties the player owns, the takings piling up behind their
 * counters by the game clock (a game day is 48 real minutes; three days' worth at most), the day's takings told at
 * midnight, 黑豹's raids, the safehouse and sleep. The places themselves - the panel at the counter, the improvements to
 * look at, the fight at the door, the bed - belong to the system each stands in (district/, home/); this keeps the books.
 */
export interface EstateApi extends System {
  readonly saved: Readonly<EstateSave>;
  owns(id: EstateId): boolean;
  has(id: EstateId, up: string): boolean;
  /** Takings waiting at `id`, whole yuan. */
  till(id: EstateId): number;
  register(p: EstatePlace): void;
  /** Buy `id`: null when bought, else why not. */
  buy(id: EstateId): string | null;
  upgrade(id: EstateId, up: string): string | null;
  /** The counter's takings into the player's pocket: how much. */
  collect(id: EstateId): number;
  readonly safehouse: boolean;
  rentSafehouse(): string | null;
  /** Why the player cannot sleep now, or null. */
  sleepBlocked(): string | null;
  /** Sleep now: null when asleep (a fade, the clock on to the morning or the evening), else why not. */
  sleep(): string | null;
  readonly asleep: boolean;
  readonly raid: Raid | null;
  /** The provider's fight at the raided place has begun (the clock stops). */
  raidFight(): void;
  /** It is over: won (the counter safe), or lost (they took a share of it). */
  raidOver(won: boolean): void;
  /** The pause screen's line ('' with nothing owned). */
  readonly line: string;
  debug: { days(n: number): void; raid(id: EstateId): boolean; awake(h: number): void; save(): EstateSave };
}

const KEY = 'drivecity.estate.v1';
/** A raid waits until the player is this far from the place (they are not going to walk in on it). */
const RAID_AWAY = 150;
/** The last hour a raid starts. */
const RAID_LAST = 22;

export async function install(engine: Engine): Promise<void> {
  let save = loadEstate(null);
  try { save = loadEstate(localStorage.getItem(KEY)); } catch { /* private mode */ }
  let dirty = false, storeT = 0;
  const store = () => { dirty = false; try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ } };
  const touch = () => { dirty = true; };
  addEventListener('pagehide', () => { if (dirty) store(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) store(); });

  const missions = () => engine.get<MissionApi>('missions');
  const hud = () => engine.get<HudApi>('hud');
  const pl = () => engine.get<PlayerApi>('player');
  const toast = (s: string, secs?: number) => hud()?.toast(s, secs);
  const places = new Map<EstateId, EstatePlace>();
  const rnd = new Rng((Date.now() & 0xffff) ^ 0x5e57);
  const name = (id: EstateId) => t(PROPERTIES[id].name);
  const yuan = (n: number) => `¥${Math.round(n).toLocaleString()}`;

  // --- the game clock: hours go by while the game is played (a jump of the clock - a pose, a sleep - is not time) ---
  let last: number | null = null;
  const today: Partial<Record<EstateId, number>> = {};
  let raidAt = -1;
  const rollRaid = (hour: number) => { raidAt = rnd.next() < RAID_ODDS ? Math.max(hour, 9 + rnd.next() * 12) : -1; };
  const pass = (hours: number) => {
    const got = accrue(save, hours);
    for (const id of ESTATE_IDS) if (got[id]) today[id] = (today[id] ?? 0) + got[id]!;
    save.awake += hours;
    touch();
  };
  /** Midnight: the day's takings, and which counters are full (`quiet` asleep: the waking caption says what came in). */
  const settle = (quiet = false) => {
    const owned = ESTATE_IDS.filter((id) => save.owned[id]);
    if (owned.length) {
      const total = owned.reduce((s, id) => s + (today[id] ?? 0), 0);
      const list = owned.filter((id) => (today[id] ?? 0) >= 1).map((id) => t('est.dayItem', { name: name(id), n: yuan(today[id]!) })).join(t('est.sep'));
      const full = owned.filter((id) => save.owned[id]!.till >= capOf(id, save.owned[id]) - 1).map(name);
      if (total >= 1 && !quiet) toast(t('est.day', { n: yuan(total), list }) + (full.length ? t('est.dayFull', { list: full.join(t('est.sep')) }) : ''), 7);
    }
    for (const id of ESTATE_IDS) delete today[id];
  };

  // --- 黑豹's raids ---
  let raid: Raid | null = null;
  const calm = () => (engine.get<WantedApi>('wanted')?.level ?? 0) === 0 && !missions()?.travelBlocked?.() && !engine.get<CombatApi>('combat')?.engaged;
  const startRaid = (id: EstateId): boolean => {
    if (raid || !save.owned[id] || !places.has(id)) return false;
    raid = { id, left: RAID_TIME, fighting: false };
    toast(t('est.raid.news', { name: name(id), m: Math.round(RAID_TIME / 60) }), 6);
    engine.events.emit('estate:raid', { id });
    return true;
  };
  const endRaid = (won: boolean) => {
    const r = raid;
    if (!r) return;
    raid = null;
    const h = save.owned[r.id];
    if (won) toast(t('est.raid.won', { name: name(r.id) }), 4.5);
    else if (h) {
      const lost = Math.floor(h.till * RAID_SHARE);
      h.till -= lost; touch();
      toast(lost > 0 ? t('est.raid.lost', { name: name(r.id), n: yuan(lost) }) : t('est.raid.lostNone', { name: name(r.id) }), 5);
    }
    engine.events.emit('estate:raidOver', { id: r.id, won });
  };

  // --- sleep ---
  let asleep = false, fade: Fade | null = null;
  const sleepBlocked = (): string | null => {
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) return t('est.sleep.wanted');
    if (raid) return t('est.sleep.raid');
    if (missions()?.travelBlocked?.()) return t('travel.busy');
    if (save.awake < AWAKE_MIN) return t('est.sleep.awake', { h: Math.ceil(AWAKE_MIN - save.awake) });
    return null;
  };

  const owns = (id: EstateId) => !!save.owned[id];
  const api: EstateApi = {
    name: 'estate',
    get saved() { return save; },
    owns,
    has: (id, up) => !!save.owned[id]?.ups.includes(up),
    till: (id) => Math.floor(save.owned[id]?.till ?? 0),
    register(p) { places.set(p.id, p); },
    buy(id) {
      const m = missions();
      const why = buyBlocked(save, id, m?.cash ?? 0);
      if (why || !m) return why ? t(why.key, { n: why.n ?? 0 }) : 'no missions';
      m.addCash(-PROPERTIES[id].price);
      save.owned[id] = { ups: [], till: 0 };
      store();
      engine.events.emit('estate:bought', { id });
      toast(t('est.bought', { name: name(id), n: yuan(dailyOf(id, save.owned[id])) }), 5);
      return null;
    },
    upgrade(id, up) {
      const m = missions();
      const why = upBlocked(save, id, up, m?.cash ?? 0);
      if (why || !m) return why ? t(why.key, { n: why.n ?? 0 }) : 'no missions';
      const u = PROPERTIES[id].ups.find((q) => q.id === up)!;
      m.addCash(-u.price);
      save.owned[id]!.ups.push(up);
      store();
      engine.events.emit('estate:upgraded', { id, up });
      toast(t('est.upgraded', { up: t(u.name), n: yuan(dailyOf(id, save.owned[id])) }), 4);
      return null;
    },
    collect(id) {
      const h = save.owned[id];
      const n = h ? Math.floor(h.till) : 0;
      if (!h || n <= 0) return 0;
      h.till -= n; save.earned += n;
      missions()?.addCash(n);
      store();
      engine.events.emit('estate:collected', { id, n });
      return n;
    },
    get safehouse() { return save.safehouse; },
    rentSafehouse() {
      const m = missions();
      if (save.safehouse) return t('est.owned');
      if (!m || m.cash < SAFEHOUSE_PRICE) return t('nl.panel.short', { n: SAFEHOUSE_PRICE - (m?.cash ?? 0) });
      m.addCash(-SAFEHOUSE_PRICE);
      save.safehouse = true;
      store();
      engine.events.emit('estate:safehouse', {});
      return null;
    },
    sleepBlocked,
    sleep() {
      const why = sleepBlocked();
      if (why || asleep) return why ?? t('travel.busy');
      const r = engine.get<RenderApi>('render');
      if (!r) return 'no render';
      asleep = true;
      fade ??= new Fade();
      fade.to(true);
      const hour = r.timeOfDay, hours = sleepHours(hour), wake = wakeHour(hour);
      const before = ESTATE_IDS.reduce((s, id) => s + (save.owned[id]?.till ?? 0), 0);
      setTimeout(() => {
        // the hours asleep go on the books (and midnight's line, if the night went past it), then the clock is set
        const crossed = hour + hours >= 24;
        if (crossed) { pass(24 - hour); settle(true); pass(hours - (24 - hour)); rollRaid(wake); } else pass(hours);
        save.awake = 0;
        r.timeOfDay = wake;
        last = wake;
        r.settle?.();
        pl()?.heal(100);
        store();
        const got = ESTATE_IDS.reduce((s, id) => s + (save.owned[id]?.till ?? 0), 0) - before;
        const hh = String(Math.floor(wake)).padStart(2, '0');
        fade!.to(false, got >= 1 ? t('est.slept', { at: `${hh}:00`, n: yuan(got) }) : t('est.sleptNone', { at: `${hh}:00` }));
        asleep = false;
        engine.events.emit('estate:slept', { hours, wake });
      }, 1100);
      return null;
    },
    get asleep() { return asleep; },
    get raid() { return raid; },
    raidFight() { if (raid) raid.fighting = true; },
    raidOver(won) { endRaid(won); },
    get line() {
      const owned = ESTATE_IDS.filter(owns);
      if (!owned.length && !save.safehouse) return '';
      const till = owned.reduce((s, id) => s + Math.floor(save.owned[id]!.till), 0);
      return t('est.pause', { n: owned.length, of: ESTATE_IDS.length, till: yuan(till), day: yuan(owned.reduce((s, id) => s + dailyOf(id, save.owned[id]), 0)) })
        + (save.safehouse ? t('est.pauseHome') : '');
    },
    debug: {
      days(n) { pass(24 * n); store(); },
      raid(id) { return startRaid(id); },
      awake(h) { save.awake = h; },
      save: () => save,
    },

    fixedUpdate(dt) {
      const r = engine.get<RenderApi>('render'), ui = engine.get<{ name: string; state: string }>('ui');
      if (!r || asleep) return;
      const h = r.timeOfDay;
      if (last === null) { last = h; rollRaid(h); }
      let d = h - last;
      const wrapped = d < -12;
      if (wrapped) d += 24;
      last = h;
      if (ui && ui.state !== 'playing') return;
      if (d > 0 && d < 1) {
        if (wrapped) { pass(d - h); settle(); pass(h); rollRaid(0); } else pass(d);
      }
      if (dirty && (storeT += dt) > 5) { storeT = 0; store(); }
      // a raid: when its hour comes and the player is well away from one of theirs (else a while later)
      if (!raid && raidAt >= 0 && h >= raidAt && h < RAID_LAST) {
        const p = pl()?.position;
        const far = ESTATE_IDS.filter((id) => save.owned[id] && places.has(id) && p && Math.hypot(p.x - places.get(id)!.x, p.z - places.get(id)!.z) > RAID_AWAY);
        if (far.length && calm()) { startRaid(far[Math.floor(rnd.next() * far.length)]); raidAt = -1; } else raidAt = h + 0.5;
      }
      if (raid && !raid.fighting && (raid.left -= dt) <= 0) endRaid(false);
    },
  };
  engine.add(api);

  // the map: gold ¥ for what is yours (the takings on its label), grey for sale, red and flashing under attack
  engine.get<NavApi>('nav')?.addBlips(function* (): Iterable<Blip> {
    for (const [id, p] of places) {
      const h = save.owned[id];
      if (raid?.id === id) yield { kind: 'estate', x: p.x, z: p.z, flash: true, label: t('est.raid.blip', { name: name(id) }), color: '#ff3b30' };
      else if (h) yield { kind: 'estate', x: p.x, z: p.z, label: t('est.blip', { name: name(id), n: yuan(h.till) }) };
      else yield { kind: 'estateSale', x: p.x, z: p.z, label: t('est.blipSale', { name: name(id), n: yuan(PROPERTIES[id].price) }) };
    }
  });
}
