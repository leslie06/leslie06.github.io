import type { TKey } from '../core/I18n';

/**
 * 产业和安全屋 (docs/gta-plan.md §14, 「做路线图第 4 步「花钱与进度」：买产业、拿日结收入、安全屋」): what each
 * property costs, what it takes a day, its two improvements, how the takings pile up behind its counter, sleep. Pure, so
 * Node tests it; index.ts keeps the clock and the save, and the system a property stands in (district/) shows it.
 */
export type EstateId = 'grill' | 'bar' | 'hhbar';
export const ESTATE_IDS: readonly EstateId[] = ['grill', 'bar', 'hhbar'];

export interface Upgrade { id: string; name: TKey; detail: TKey; price: number; income: number }
export interface Property { name: TKey; price: number; income: number; ups: readonly Upgrade[] }

/** Each pays back its price in about seven game days (a game day is 48 real minutes), its improvements about the same. */
export const PROPERTIES: Record<EstateId, Property> = {
  grill: { name: 'est.grill', price: 6000, income: 900, ups: [
    { id: 'stove', name: 'est.up.stove', detail: 'est.up.stoveD', price: 3000, income: 450 },
    { id: 'hand', name: 'est.up.hand', detail: 'est.up.handD', price: 4000, income: 500 },
  ] },
  bar: { name: 'est.bar', price: 18000, income: 2400, ups: [
    { id: 'erhu', name: 'est.up.erhu', detail: 'est.up.erhuD', price: 8000, income: 1000 },
    { id: 'decor', name: 'est.up.decor', detail: 'est.up.decorD', price: 10000, income: 1200 },
  ] },
  hhbar: { name: 'est.hhbar', price: 35000, income: 4500, ups: [
    { id: 'singer', name: 'est.up.singer', detail: 'est.up.singerD', price: 15000, income: 2000 },
    { id: 'terrace', name: 'est.up.terrace', detail: 'est.up.terraceD', price: 18000, income: 2300 },
  ] },
};

/** The counter holds this many days' takings at most: come back for them. */
export const CAP_DAYS = 3;
/** 黑豹's men, left to it, take this share of the counter. */
export const RAID_SHARE = 0.5;
/** Real seconds to get to a property under attack. */
export const RAID_TIME = 300;
/** A day with a raid somewhere (rolled at midnight); the hour it comes is 9:00-21:00. */
export const RAID_ODDS = 0.6;
/** The 东厢房 in the courtyard, paid once. */
export const SAFEHOUSE_PRICE = 12000;
/** Game hours awake before one can sleep again (sleeping back to back would print money). */
export const AWAKE_MIN = 8;

export interface Holding {
  /** Improvements bought. */
  ups: string[];
  /** Takings waiting behind the counter (fractional: it grows by the game minute). */
  till: number;
}

export interface EstateSave {
  owned: Partial<Record<EstateId, Holding>>;
  safehouse: boolean;
  /** Game hours since the last sleep. */
  awake: number;
  /** Takings collected, ever. */
  earned: number;
}

export const dailyOf = (id: EstateId, h: Holding | undefined): number => {
  const p = PROPERTIES[id];
  return p.income + p.ups.reduce((s, u) => s + (h?.ups.includes(u.id) ? u.income : 0), 0);
};
export const capOf = (id: EstateId, h: Holding | undefined): number => dailyOf(id, h) * CAP_DAYS;

/** `hours` of game time go by: every owned property's counter fills (to its cap). What came in, by property. */
export function accrue(s: EstateSave, hours: number): Partial<Record<EstateId, number>> {
  const got: Partial<Record<EstateId, number>> = {};
  if (!(hours > 0)) return got;
  for (const id of ESTATE_IDS) {
    const h = s.owned[id];
    if (!h) continue;
    const cap = capOf(id, h), before = h.till;
    h.till = Math.min(cap, h.till + dailyOf(id, h) * hours / 24);
    got[id] = h.till - before;
  }
  return got;
}

/** Why `id` cannot be bought now (a key, with how much is short), or null. */
export function buyBlocked(s: EstateSave, id: EstateId, cash: number): { key: TKey; n?: number } | null {
  if (s.owned[id]) return { key: 'est.owned' };
  const price = PROPERTIES[id].price;
  return cash < price ? { key: 'nl.panel.short', n: price - cash } : null;
}
/** Why improvement `up` of `id` cannot be bought now, or null. */
export function upBlocked(s: EstateSave, id: EstateId, up: string, cash: number): { key: TKey; n?: number } | null {
  const h = s.owned[id], u = PROPERTIES[id].ups.find((q) => q.id === up);
  if (!h || !u) return { key: 'est.notYours' };
  if (h.ups.includes(up)) return { key: 'est.upDone' };
  return cash < u.price ? { key: 'nl.panel.short', n: u.price - cash } : null;
}

/** Asleep at `hour` (0-24): to 7:00 from the evening and the night (18:00-5:00), else to 18:00. Hours asleep. */
export function sleepHours(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const wake = h >= 18 || h < 5 ? 7 : 18;
  return (wake - h + 24) % 24 || 24;
}
export const wakeHour = (hour: number): number => (((hour + sleepHours(hour)) % 24) + 24) % 24;

export function loadEstate(raw: string | null): EstateSave {
  const s: EstateSave = { owned: {}, safehouse: false, awake: AWAKE_MIN, earned: 0 };
  if (!raw) return s;
  try {
    const o = JSON.parse(raw) as Partial<EstateSave>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    for (const id of ESTATE_IDS) {
      const h = (o.owned as Record<string, Partial<Holding>> | undefined)?.[id];
      if (!h || typeof h !== 'object') continue;
      const ups = Array.isArray(h.ups) ? h.ups.filter((u): u is string => PROPERTIES[id].ups.some((q) => q.id === u)) : [];
      const held: Holding = { ups: [...new Set(ups)], till: 0 };
      held.till = Math.min(capOf(id, held), n(h.till));
      s.owned[id] = held;
    }
    s.safehouse = o.safehouse === true;
    s.awake = o.awake === undefined ? AWAKE_MIN : n(o.awake);
    s.earned = Math.floor(n(o.earned));
  } catch { /* a broken save starts over */ }
  return s;
}
