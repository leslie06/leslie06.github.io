import type { TKey } from '../core/I18n';

/**
 * 南锣鼓巷's five shops (docs/gta-plan.md §12): what each sells and what it does. Pure, so Node tests it; index.ts
 * applies the effects. The rooms themselves come from scripts/blender/landmarks/nanluo.py (nanluo.layout.json).
 */
export type ShopId = 'snack' | 'crafts' | 'tea' | 'photo' | 'arcade' | 'clothes' | 'barber' | 'bar' | 'grill';
export const SHOP_IDS: readonly ShopId[] = ['snack', 'crafts', 'tea', 'photo', 'arcade', 'clothes', 'barber', 'bar', 'grill'];

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
  // round 2: the middle stretch (the clothes shop sells the WARDROBE below, the barber the HAIR dyes, the bar SONGS)
  clothes: { name: 'nl.shop.clothes', greet: 'nl.greet.clothes', bark: 'nl.bark.clothes', items: [] },
  barber: { name: 'nl.shop.barber', greet: 'nl.greet.barber', bark: 'nl.bark.barber', items: [
    { id: 'wash', name: 'nl.item.wash', price: 30, heal: 30 },
    { id: 'shave', name: 'nl.item.shave', price: 20, heal: 15 },
  ] },
  bar: { name: 'nl.shop.bar', greet: 'nl.greet.bar', bark: 'nl.bark.bar', items: [
    { id: 'soda', name: 'nl.item.soda', price: 8, heal: 10 },
    { id: 'peanuts', name: 'nl.item.peanuts', price: 15, heal: 20 },
  ] },
  grill: { name: 'nl.shop.grill', greet: 'nl.greet.grill', bark: 'nl.bark.grill', items: [
    { id: 'chuan', name: 'nl.item.chuan', price: 15, heal: 25 },
    { id: 'mantou', name: 'nl.item.mantou', price: 8, heal: 12 },
    { id: 'yaozi', name: 'nl.item.yaozi', price: 25, heal: 50 },
  ] },
};

/**
 * What the clothes shop and the barber sell: the player's look (PlayerApi.dress). Each is bought once and kept; the
 * first of each colour list is what Chen Ye wears to start with, free. Colours are the model's (character/hero/Wear.ts
 * recolours the suit's texture), and nanluo.py hangs the same ones on the racks.
 */
export type WearKind = 'hat' | 'glasses' | 'jacket' | 'pants' | 'hair';
export interface Wearable { kind: WearKind; id: string; name: TKey; price: number; color?: string }
export const WARDROBE: readonly Wearable[] = [
  { kind: 'hat', id: 'cap', name: 'nl.wear.cap', price: 80, color: '#b3221c' },
  { kind: 'hat', id: 'bucket', name: 'nl.wear.bucket', price: 90, color: '#b8a47a' },
  { kind: 'hat', id: 'beanie', name: 'nl.wear.beanie', price: 60, color: '#c8902a' },
  { kind: 'hat', id: 'straw', name: 'nl.wear.straw', price: 50, color: '#d9bf7a' },
  { kind: 'glasses', id: 'aviator', name: 'nl.wear.aviator', price: 120 },
  { kind: 'glasses', id: 'round', name: 'nl.wear.round', price: 100 },
  { kind: 'jacket', id: 'black', name: 'nl.col.black', price: 0, color: '#25262a' },
  { kind: 'jacket', id: 'olive', name: 'nl.col.olive', price: 150, color: '#3e4a32' },
  { kind: 'jacket', id: 'wine', name: 'nl.col.wine', price: 150, color: '#5a1e22' },
  { kind: 'jacket', id: 'navy', name: 'nl.col.navy', price: 150, color: '#1e2840' },
  { kind: 'jacket', id: 'khaki', name: 'nl.col.khaki', price: 150, color: '#8a7552' },
  { kind: 'jacket', id: 'cream', name: 'nl.col.cream', price: 180, color: '#cfc8b8' },
  { kind: 'pants', id: 'denim', name: 'nl.col.denim', price: 0, color: '#24314a' },
  { kind: 'pants', id: 'black', name: 'nl.col.black', price: 100, color: '#1c1c1f' },
  { kind: 'pants', id: 'khaki', name: 'nl.col.khaki', price: 100, color: '#7c6a4a' },
  { kind: 'pants', id: 'grey', name: 'nl.col.grey', price: 100, color: '#55585c' },
];
export const HAIR: readonly Wearable[] = [
  { kind: 'hair', id: 'black', name: 'nl.col.black', price: 0, color: '#191512' },
  { kind: 'hair', id: 'brown', name: 'nl.col.brown', price: 50, color: '#3e2a1c' },
  { kind: 'hair', id: 'auburn', name: 'nl.col.auburn', price: 50, color: '#5a2216' },
  { kind: 'hair', id: 'gold', name: 'nl.col.gold', price: 50, color: '#9a7440' },
  { kind: 'hair', id: 'silver', name: 'nl.col.silver', price: 50, color: '#8c8a86' },
  { kind: 'hair', id: 'blue', name: 'nl.col.blue', price: 50, color: '#2c3a5a' },
];
/** What one wears: an id per kind (no hat, no glasses: null). */
export interface Worn { hat: string | null; glasses: string | null; jacket: string; pants: string; hair: string }
export const DEFAULT_WORN: Worn = { hat: null, glasses: null, jacket: 'black', pants: 'denim', hair: 'black' };
const ALL_WEAR = [...WARDROBE, ...HAIR];
export const wearable = (kind: WearKind, id: string | null): Wearable | null => ALL_WEAR.find((w) => w.kind === kind && w.id === id) ?? null;
/** The key a bought thing is kept under in the save. */
export const ownKey = (w: Wearable): string => `${w.kind}:${w.id}`;

/** The bar's songs: request one (¥SONG_PRICE) and the singer plays it next. */
export const SONGS: readonly TKey[] = ['nl.song.0', 'nl.song.1', 'nl.song.2'];
export const SONG_PRICE = 20;
/** Sitting at the bar's tables listening: health back a second. */
export const LISTEN_HEAL = 1.5;

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

/**
 * What the player keeps from the lane: `drivecity.district.v1` (round 2 added `owned`, `worn` and `yard`; an older save
 * reads with the defaults).
 */
export interface Save { souvenirs: number; photos: number; danceBest: number; visited: ShopId[]; owned: string[]; worn: Worn; yard: boolean }

export function loadSave(raw: string | null): Save {
  const s: Save = { souvenirs: 0, photos: 0, danceBest: 0, visited: [], owned: [], worn: { ...DEFAULT_WORN }, yard: false };
  if (!raw) return s;
  try {
    const o = JSON.parse(raw) as Partial<Save>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    s.souvenirs = n(o.souvenirs); s.photos = n(o.photos); s.danceBest = Math.min(16, n(o.danceBest));
    if (Array.isArray(o.visited)) s.visited = o.visited.filter((v): v is ShopId => SHOP_IDS.includes(v as ShopId));
    if (Array.isArray(o.owned)) s.owned = o.owned.filter((k): k is string => typeof k === 'string' && ALL_WEAR.some((w) => ownKey(w) === k));
    s.yard = o.yard === true;
    // only what is owned (or free) can be worn
    const w = (o.worn ?? {}) as Partial<Worn>;
    const ok = (kind: WearKind, id: unknown): boolean => {
      const it = typeof id === 'string' ? wearable(kind, id) : null;
      return !!it && (it.price === 0 || s.owned.includes(ownKey(it)));
    };
    s.worn = {
      hat: ok('hat', w.hat) ? w.hat as string : null, glasses: ok('glasses', w.glasses) ? w.glasses as string : null,
      jacket: ok('jacket', w.jacket) ? w.jacket as string : DEFAULT_WORN.jacket, pants: ok('pants', w.pants) ? w.pants as string : DEFAULT_WORN.pants,
      hair: ok('hair', w.hair) ? w.hair as string : DEFAULT_WORN.hair,
    };
  } catch { /* a broken save starts over */ }
  return s;
}
