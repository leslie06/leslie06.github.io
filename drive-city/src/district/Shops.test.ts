import { describe, expect, it } from 'vitest';
import { blocked, CATALOG, dancePrize, loadSave, SHOP_IDS } from './Shops';

describe('南锣鼓巷 shops', () => {
  it('every shop but the arcade sells something, at a price', () => {
    for (const id of SHOP_IDS) {
      const items = CATALOG[id].items;
      if (id === 'arcade') expect(items.length).toBe(0);
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
    expect(loadSave(null)).toEqual({ souvenirs: 0, photos: 0, danceBest: 0, visited: [] });
    expect(loadSave('{oops')).toEqual({ souvenirs: 0, photos: 0, danceBest: 0, visited: [] });
    expect(loadSave(JSON.stringify({ souvenirs: 2.7, photos: -1, danceBest: 40, visited: ['tea', 'bank', 'photo'] })))
      .toEqual({ souvenirs: 2, photos: 0, danceBest: 16, visited: ['tea', 'photo'] });
  });
});
