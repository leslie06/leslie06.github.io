import { describe, expect, it } from 'vitest';
import { FLAVOURS, GENERIC, shopSigns, signIndex } from '../city/visual/ShopSigns';
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
      if (s === 'hair' || s === 'clothes' || s === 'repair' || s === 'hotel' || s === 'lottery' || s === 'courier') continue;   // 快递驿站不卖东西，只接活（errands/）
      expect(GOODS[trade]?.length, trade).toBeGreaterThan(0);
      for (const g of GOODS[trade]) { expect(STREET_EN[g.name as keyof typeof STREET_EN], g.id).toBeTruthy(); expect(STREET_ZH[g.name as keyof typeof STREET_ZH], g.id).toBeTruthy(); expect(g.price).toBeGreaterThan(0); }
    }
    for (const s of new Set(Object.values(SERVICE))) { expect(STREET_ZH[`st.offer.${s}` as keyof typeof STREET_ZH], s).toBeTruthy(); expect(STREET_ZH[`st.greet.${s}` as keyof typeof STREET_ZH], s).toBeTruthy(); }
  });
  it('a good share of the signs have a counter', () => {
    const n = shopSigns().filter((s) => SERVICE[s.trade]).length;
    expect(n / shopSigns().length).toBeGreaterThan(0.5);
  });
  it('名片街的本地和通用招牌都有柜台，普通街的通用招牌编号不变', () => {
    const signs = shopSigns();
    for (let f = 1; f <= FLAVOURS.length; f++) {
      // 穷举通用图集每一格：0% 走本地抽签，95% 走通用抽签。
      for (const chance of [0, 95]) for (let i = 0; i < GENERIC; i++) {
        const hs = (chance << 13) | (i << 4), idx = signIndex(hs, f, true);
        expect(SERVICE[signs[idx].trade], `${f}/${chance}/${i}: ${signs[idx].text}`).toBeTruthy();
        if (chance === 95) expect(signIndex(hs, f)).toBe((hs >>> 4) % GENERIC);
      }
    }
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
  it('名片街跳过的行当（ShopSigns.ts 的 NO_COUNTER）都没有柜台，有柜台的一个都没跳', async () => {
    const { NO_COUNTER, FAMOUS_SKIP } = await import('../city/visual/ShopSigns');
    for (const t of NO_COUNTER) expect(SERVICE[t], t).toBeUndefined();
    for (const t of new Set(shopSigns().map((g) => g.trade))) if (!SERVICE[t]) expect(NO_COUNTER.has(t), `${t} 没有柜台，名片街上该跳过`).toBe(true);
    // 每种口味至少留下一块能开柜台的
    for (const m of FAMOUS_SKIP) expect(m).toBeLessThan(0xfff);
  });
});
