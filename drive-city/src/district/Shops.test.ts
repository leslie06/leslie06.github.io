import { describe, expect, it } from 'vitest';
import { blocked, CATALOG, dancePrize, DEFAULT_WORN, deliveryPay, deliveryTime, HAIR, loadSave, ownKey, priceOf, RACKET_SHOPS, SHOP_IDS, WARDROBE } from './Shops';

describe('南锣鼓巷 shops', () => {
  it('every shop but the arcade and the clothes shop sells something, at a price', () => {
    for (const id of SHOP_IDS) {
      const items = CATALOG[id].items;
      if (id === 'arcade' || id === 'clothes') expect(items.length).toBe(0);
      else expect(items.length).toBeGreaterThan(0);
      for (const it of items) expect(it.price).toBeGreaterThan(0);
    }
  });

  it('says why an item cannot be bought', () => {
    const [haws] = CATALOG.snack.items, [tea] = CATALOG.tea.items, [map] = CATALOG.crafts.items;
    expect(blocked(haws, { cash: 5, health: 50, rabbitsLeft: 3 })).toEqual({ key: 'nl.panel.short', n: 5 });
    expect(blocked(haws, { cash: 50, health: 100, rabbitsLeft: 3 })).toEqual({ key: 'nl.panel.full' });
    // a drink with a guard is still worth having at full health
    expect(blocked(tea, { cash: 50, health: 100, rabbitsLeft: 3 })).toBeNull();
    expect(blocked(map, { cash: 50, health: 100, rabbitsLeft: 0 })).toEqual({ key: 'nl.panel.noneLeft' });
    expect(blocked(map, { cash: 50, health: 100, rabbitsLeft: 2 })).toBeNull();
  });

  it('pays the dance machine by cues hit', () => {
    expect(dancePrize(16, 16)).toBe(150);
    expect(dancePrize(15, 16)).toBe(150);
    expect(dancePrize(12, 16)).toBe(60);
    expect(dancePrize(8, 16)).toBe(20);
    expect(dancePrize(7, 16)).toBe(0);
    expect(dancePrize(0, 0)).toBe(0);
  });

  it('reads a save, and survives a broken one', () => {
    const empty = { souvenirs: 0, photos: 0, danceBest: 0, visited: [], owned: [], worn: DEFAULT_WORN, yard: false, regulars: [], deliveries: 0, cat: false, rackets: 0 };
    expect(loadSave(null)).toEqual(empty);
    expect(loadSave('{oops')).toEqual(empty);
    // a round-1 save reads with round 2's defaults
    expect(loadSave(JSON.stringify({ souvenirs: 2.7, photos: -1, danceBest: 40, visited: ['tea', 'bank', 'photo'] })))
      .toEqual({ ...empty, souvenirs: 2, danceBest: 16, visited: ['tea', 'photo'] });
    // round 3's: shops stood up for, deliveries, the cat
    expect(loadSave(JSON.stringify({ regulars: ['grill', 'mall', 'cats'], deliveries: 3, cat: 'yes', rackets: 2 })))
      .toEqual({ ...empty, regulars: ['grill', 'cats'], deliveries: 3, rackets: 2 });
  });

  it('sells to a regular for less, and pays a delivery by the time left', () => {
    const [chuan] = CATALOG.grill.items;
    expect(priceOf(chuan, false)).toBe(15);
    expect(priceOf(chuan, true)).toBe(11);
    // the cheaper price is what decides whether it can be bought
    expect(blocked(chuan, { cash: 12, health: 50, rabbitsLeft: 0, price: priceOf(chuan, true) })).toBeNull();
    expect(blocked(chuan, { cash: 12, health: 50, rabbitsLeft: 0 })).toEqual({ key: 'nl.panel.short', n: 3 });
    for (const id of RACKET_SHOPS) expect(CATALOG[id].items.length).toBeGreaterThan(0);
    expect(deliveryPay(60, 60)).toBe(60);
    expect(deliveryPay(1, 60)).toBe(31);
    expect(deliveryPay(0, 60)).toBe(12);
    expect(deliveryTime(300)).toBe(125);
  });

  it('wears only what was bought (or is free)', () => {
    const s = loadSave(JSON.stringify({ owned: ['hat:cap', 'jacket:wine', 'bogus:x'], worn: { hat: 'cap', glasses: 'aviator', jacket: 'wine', pants: 'khaki', hair: 'blue' } }));
    expect(s.owned).toEqual(['hat:cap', 'jacket:wine']);
    expect(s.worn).toEqual({ hat: 'cap', glasses: null, jacket: 'wine', pants: DEFAULT_WORN.pants, hair: DEFAULT_WORN.hair });
  });

  it('wears a 每日任务 gift only once it is won', () => {
    const worn = { hat: 's0cap', glasses: null, jacket: 's0teal', pants: 'denim', hair: 'black' };
    expect(loadSave(JSON.stringify({ owned: [], worn })).worn).toEqual({ ...DEFAULT_WORN });
    expect(loadSave(JSON.stringify({ owned: ['hat:s0cap', 'jacket:s0teal'], worn })).worn).toEqual(worn);
  });

  it('sells each look once, the starting ones free', () => {
    for (const list of [WARDROBE, HAIR]) {
      const keys = list.map(ownKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const w of list) {
        const start = (DEFAULT_WORN as unknown as Record<string, string | null>)[w.kind] === w.id;
        if (!w.gift) expect(w.price === 0).toBe(start);
        if (w.kind !== 'glasses') expect(w.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
