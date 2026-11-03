import type { TKey } from '../core/I18n';

/**
 * 南锣鼓巷's five shops (docs/gta-plan.md §12): what each sells and what it does. Pure, so Node tests it; index.ts
 * applies the effects. The rooms themselves come from scripts/blender/landmarks/nanluo.py (nanluo.layout.json).
 */
export type ShopId = 'snack' | 'crafts' | 'tea' | 'photo' | 'arcade';
export const SHOP_IDS: readonly ShopId[] = ['snack', 'crafts', 'tea', 'photo', 'arcade'];

export interface Item {
  id: string;
  name: TKey;
  price: number;
  /** Health back (100 = all of it). */
  heal?: number;
  /** Every hurt scaled by `scale` for `secs`. */
  guard?: { scale: number; secs: number };
  /** Something index.ts does: mark 兔儿爷 on the map, keep a souvenir, take a portrait. */
  act?: 'map' | 'souvenir' | 'photo';
}

export interface Shop { name: TKey; greet: TKey; bark: TKey; items: Item[] }

export const CATALOG: Record<ShopId, Shop> = {
  snack: { name: 'nl.shop.snack', greet: 'nl.greet.snack', bark: 'nl.bark.snack', items: [
    { id: 'haws', name: 'nl.item.haws', price: 10, heal: 20 },
    { id: 'ludagun', name: 'nl.item.ludagun', price: 15, heal: 35 },
    { id: 'zhajiang', name: 'nl.item.zhajiang', price: 28, heal: 100 },
  ] },
  tea: { name: 'nl.shop.tea', greet: 'nl.greet.tea', bark: 'nl.bark.tea', items: [
    { id: 'milktea', name: 'nl.item.milktea', price: 18, heal: 15, guard: { scale: 0.7, secs: 180 } },
    { id: 'huaice', name: 'nl.item.huaice', price: 22, heal: 20, guard: { scale: 0.6, secs: 240 } },
    { id: 'suanmei', name: 'nl.item.suanmei', price: 12, heal: 15 },
  ] },
  crafts: { name: 'nl.shop.crafts', greet: 'nl.greet.crafts', bark: 'nl.bark.crafts', items: [
    { id: 'map', name: 'nl.item.map', price: 40, act: 'map' },
    { id: 'rabbit', name: 'nl.item.rabbit', price: 60, act: 'souvenir' },
  ] },
  photo: { name: 'nl.shop.photo', greet: 'nl.greet.photo', bark: 'nl.bark.photo', items: [
    { id: 'photo', name: 'nl.item.photo', price: 30, act: 'photo' },
  ] },
  arcade: { name: 'nl.shop.arcade', greet: 'nl.greet.arcade', bark: 'nl.bark.arcade', items: [] },
};

/** A go on the dance machine. */
export const DANCE_PRICE = 10;
/** What a dance pays, by cues hit (of 16): a near-perfect run pays well, a fair one a little, a poor one nothing. */
export function dancePrize(hits: number, of: number): number {
  const k = of > 0 ? hits / of : 0;
  return k >= 0.93 ? 150 : k >= 0.75 ? 60 : k >= 0.5 ? 20 : 0;
}

/** How many 兔儿爷 a hutong map marks. */
export const MAP_MARKS = 3;

/** Why an item cannot be bought now (a key to show on its button), or null. */
export function blocked(item: Item, s: { cash: number; health: number; rabbitsLeft: number }): { key: TKey; n?: number } | null {
  if (s.cash < item.price) return { key: 'nl.panel.short', n: item.price - s.cash };
  if (item.act === 'map' && s.rabbitsLeft <= 0) return { key: 'nl.panel.noneLeft' };
  // food that only heals is no use at full health (a drink with a guard still is)
  if (item.heal && !item.guard && !item.act && s.health >= 100) return { key: 'nl.panel.full' };
  return null;
}

/** What the player keeps from the lane: `drivecity.district.v1`. */
export interface Save { souvenirs: number; photos: number; danceBest: number; visited: ShopId[] }

export function loadSave(raw: string | null): Save {
  const s: Save = { souvenirs: 0, photos: 0, danceBest: 0, visited: [] };
  if (!raw) return s;
  try {
    const o = JSON.parse(raw) as Partial<Save>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    s.souvenirs = n(o.souvenirs); s.photos = n(o.photos); s.danceBest = Math.min(16, n(o.danceBest));
    if (Array.isArray(o.visited)) s.visited = o.visited.filter((v): v is ShopId => SHOP_IDS.includes(v as ShopId));
  } catch { /* a broken save starts over */ }
  return s;
}
