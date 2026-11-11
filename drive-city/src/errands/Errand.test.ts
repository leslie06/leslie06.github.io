import { describe, expect, it } from 'vitest';
import { daijiaHour, DAIJIA_TRADES, doorTries, parcelsPay, PARCELS, takeoutLimit, takeoutPay, takeoutWeights, TAKEOUT_MAX, TAKEOUT_MIN } from './Errand';
import { SERVICE } from '../street/Trades';

describe('外卖', () => {
  it('什么钟点都往小区送，饭点写字楼最多，夜里不往写字楼、学校送', () => {
    for (const h of [3, 8, 12, 15, 19, 23]) expect(takeoutWeights(h).resid).toBeGreaterThan(0);
    const noon = takeoutWeights(12), night = takeoutWeights(23);
    expect(noon.office!).toBeGreaterThan(noon.resid!);
    expect(night.office).toBeUndefined(); expect(night.school).toBeUndefined();
    for (const h of [3, 12, 19]) expect(takeoutWeights(h).mall).toBeUndefined();   // 不给商场送
  });
  it('时限够守规矩地开过去再走进楼：一公里两分钟出头', () => {
    expect(takeoutLimit(1000)).toBeGreaterThan(200); expect(takeoutLimit(1000)).toBeLessThan(240);
    // 最近的单子：四百米，一分钟开到，还剩一分多钟走进去
    expect(takeoutLimit(TAKEOUT_MIN)).toBeGreaterThan(120);
  });
  it('按时比超时多，远的比近的多，都是几十块', () => {
    expect(takeoutPay(1000, false)).toBe(55); expect(takeoutPay(1000, true)).toBe(24);
    expect(takeoutPay(TAKEOUT_MAX, false)).toBeGreaterThan(takeoutPay(TAKEOUT_MIN, false));
    expect(takeoutPay(TAKEOUT_MAX, false)).toBeLessThan(100);
  });
  it('楼门先往深处、正对着找，再找两边和浅的；最浅也有二十米要走', () => {
    const t = doorTries();
    expect(t[0]).toEqual({ along: 0, deep: 55 });
    expect(Math.min(...t.map((x) => x.deep))).toBe(20);
    for (let i = 1; i < t.length; i++) expect(t[i].deep).toBeLessThanOrEqual(t[i - 1].deep);
  });
});

describe('派件和代驾', () => {
  it('每件都给钱，三件按时送完有奖', () => {
    expect(parcelsPay(1, true)).toBe(15); expect(parcelsPay(2, false)).toBe(30);
    expect(parcelsPay(PARCELS, true)).toBe(75); expect(parcelsPay(PARCELS, false)).toBe(45);
  });
  it('代驾只在夜里，只在喝酒的店：这些行当都是能吃的店', () => {
    expect(daijiaHour(20)).toBe(true); expect(daijiaHour(1)).toBe(true); expect(daijiaHour(12)).toBe(false); expect(daijiaHour(19)).toBe(false);
    for (const tr of DAIJIA_TRADES) expect(SERVICE[tr]).toBe('eat');
  });
});
