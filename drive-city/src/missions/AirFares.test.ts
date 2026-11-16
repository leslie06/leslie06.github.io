import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import {
  AIR_MAX, AIR_MIN, airChance, airFare, airLimit, atDepartures, cityNE, flightLimit, flightNo, flightPay, GAME_MIN, inboundWeights, meetDelay, meetPay,
  RANKS, rankWait, T3_DEP,
} from './AirFares';

describe('首都机场的乘客活（AirFares.ts）', () => {
  it('城里只有东北部和酒店门口的客去机场，每日任务在的时候多一些', () => {
    expect(cityNE(5049, -5774)).toBe(true);    // 三元桥
    expect(cityNE(6185, -9704)).toBe(true);    // 望京
    expect(cityNE(-6, 14)).toBe(false);        // 天安门
    expect(cityNE(5374, 14)).toBe(false);      // 国贸（长安街上）
    expect(airChance(-6, 14, false)).toBe(0);
    expect(airChance(5049, -5774, false)).toBeCloseTo(0.08);
    expect(airChance(-6, 14, true)).toBeCloseTo(0.2);
    expect(airChance(5049, -5774, false, true)).toBeCloseTo(0.24);
    expect(airChance(-6, 14, true, true)).toBeCloseTo(0.4);
    // 每日任务要去机场时，别处也偶尔有
    expect(airChance(-6, 14, false, true)).toBeGreaterThan(0);
    // 频率：东北部一百个招手的里大约八个
    const rng = new Rng(7);
    let n = 0;
    for (let i = 0; i < 4000; i++) if (rng.next() < airChance(6000, -6000, false)) n++;
    expect(n / 4000).toBeGreaterThan(0.06);
    expect(n / 4000).toBeLessThan(0.1);
  });

  it('去机场的长单时间宽松、钱多', () => {
    // 三元桥到 T3 约 20 公里：半小时上下，守规矩的 43 km/h 也到得了
    const lim = airLimit(20200);
    expect(lim).toBeGreaterThan(20200 / 13);
    expect(lim / 60).toBeGreaterThan(28);
    expect(lim / 60).toBeLessThan(33);
    // 比一单最长的城里单（2.6 公里，街机表 8 + 14/km = ¥44）多得多
    expect(airFare(20.2)).toBeGreaterThan(300);
    expect(airFare(20.2)).toBeGreaterThan(6 * (8 + 14 * 2.6));
    expect(AIR_MIN).toBeLessThan(20200);
    expect(AIR_MAX).toBeGreaterThan(30500);   // 天安门 → T3 30.5 公里也算
  });

  it('T3 出发层在高架上：同一个平面位置，底下的到达层不算', () => {
    expect(atDepartures(T3_DEP.x, 7.1, T3_DEP.z)).toBe(true);
    expect(atDepartures(T3_DEP.x + 20, 7.0, T3_DEP.z + 5)).toBe(true);
    expect(atDepartures(T3_DEP.x, 0.6, T3_DEP.z)).toBe(false);
    expect(atDepartures(T3_DEP.x + 200, 7.0, T3_DEP.z)).toBe(false);
  });

  it('蓄车池：两个池子，排一次队十来秒到半分钟', () => {
    expect(RANKS.map((r) => r.id)).toEqual(['t3', 't2']);
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const w = rankWait(() => rng.next());
      expect(w.cars).toBeGreaterThanOrEqual(2);
      expect(w.cars).toBeLessThanOrEqual(4);
      expect(w.secs).toBeGreaterThanOrEqual(9);
      expect(w.secs).toBeLessThanOrEqual(24);
    }
    // 进城的大单去小区、酒店多
    for (const h of [3, 10, 15, 20]) { const w = inboundWeights(h); expect((w.hotel ?? 0) + (w.resid ?? 0)).toBeGreaterThan((w.office ?? 0) + (w.mall ?? 0)); }
  });

  it('赶飞机：二十公里约二十分钟，要开起来；剩的时间多给钱', () => {
    const lim = flightLimit(20000);
    expect(lim / 60).toBeGreaterThan(18);
    expect(lim / 60).toBeLessThan(22);
    // 比出租车长单紧
    expect(lim).toBeLessThan(airLimit(20000) * 0.75);
    // 平均 43 km/h（守规矩的城里车速）赶不上
    expect(20000 / 12).toBeGreaterThan(lim);
    expect(flightPay(0)).toBe(260);
    expect(flightPay(120)).toBe(380);
    expect(flightPay(9999)).toBe(500);
    expect(flightPay(-30)).toBe(260);
  });

  it('接机：一半准点，晚点的 10–40 分钟（游戏分钟，一分钟两秒）', () => {
    const rng = new Rng(11);
    let late = 0;
    for (let i = 0; i < 1000; i++) {
      const d = meetDelay(() => rng.next());
      if (d === 0) continue;
      late++;
      expect(d % 5).toBe(0);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(40);
      expect(d * GAME_MIN).toBeLessThanOrEqual(80);   // 现实里最多等一分二十秒
    }
    expect(late / 1000).toBeGreaterThan(0.4);
    expect(late / 1000).toBeLessThan(0.6);
    expect(meetPay(20000, false)).toBe(400);
    expect(meetPay(20000, true)).toBe(240);
    expect(flightNo(() => 0.5)).toMatch(/^[A-Z]{2}\d{3,4}$/);
  });
});
