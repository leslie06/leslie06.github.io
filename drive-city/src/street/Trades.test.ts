import { describe, expect, it } from 'vitest';
import { shopSigns } from '../city/visual/ShopSigns';
import { ALBUM_REWARDS, EAT_TRADES, GOODS, SERVICE, TICKET_PRICE, ate, emptySave, goodOf, repairPrice, scratch } from './Trades';
import { STREET_EN, STREET_ZH } from '../core/i18n/street';

describe('street counters', () => {
  const trades = new Set(shopSigns().map((s) => s.trade));
  it('the album is of trades the city has signs for', () => {
    expect(EAT_TRADES.length).toBeGreaterThanOrEqual(12);
    for (const k of EAT_TRADES) { expect(trades.has(k), k).toBe(true); expect(SERVICE[k]).toBe('eat'); }
  });
  it('a counter that sells things has things, each with a name in both languages', () => {
    for (const [trade, s] of Object.entries(SERVICE)) {
      if (s === 'hair' || s === 'clothes' || s === 'repair' || s === 'hotel' || s === 'lottery') continue;
      expect(GOODS[trade]?.length, trade).toBeGreaterThan(0);
      for (const g of GOODS[trade]) { expect(STREET_EN[g.name as keyof typeof STREET_EN], g.id).toBeTruthy(); expect(STREET_ZH[g.name as keyof typeof STREET_ZH], g.id).toBeTruthy(); expect(g.price).toBeGreaterThan(0); }
    }
    for (const s of new Set(Object.values(SERVICE))) { expect(STREET_ZH[`st.offer.${s}` as keyof typeof STREET_ZH], s).toBeTruthy(); expect(STREET_ZH[`st.greet.${s}` as keyof typeof STREET_ZH], s).toBeTruthy(); }
  });
  it('a good share of the signs have a counter', () => {
    const n = shopSigns().filter((s) => SERVICE[s.trade]).length;
    expect(n / shopSigns().length).toBeGreaterThan(0.5);
  });
  it('the album pays each step once', () => {
    const save = emptySave();
    let cash = 0;
    for (const tr of EAT_TRADES) { const a = ate(save, tr); expect(a.fresh).toBe(true); cash += a.reward; }
    expect(cash).toBe(ALBUM_REWARDS.reduce((a, r) => a + r[1], 0));
    expect(ate(save, EAT_TRADES[0])).toEqual({ fresh: false, reward: 0 });
    expect(ate(save, '五金').fresh).toBe(false);
  });
  it('a scratch card loses money on average', () => {
    let sum = 0; const N = 100000;
    for (let i = 0; i < N; i++) sum += scratch((i + 0.5) / N);
    expect(sum / N).toBeLessThan(TICKET_PRICE);
    expect(sum / N).toBeGreaterThan(TICKET_PRICE * 0.6);
  });
  it('gifts and repairs', () => {
    expect(goodOf('bouquet')?.gift).toBeGreaterThan(0);
    expect(goodOf(null)).toBeNull();
    expect(repairPrice(100)).toBe(0);
    expect(repairPrice(40)).toBe(300);
  });
});
