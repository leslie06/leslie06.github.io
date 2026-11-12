import { describe, expect, it } from 'vitest';
import { CELL, DENS, flowKey, headingOf, hourBand, hourDensity, isRing, jamSlack, levelAt, odds, SPEED, worstAt } from './Flow';

describe('路况表', () => {
  it('只有有名字的环路、高速和主干道在表里；环路各段、辅路收成一个名字', () => {
    expect(flowKey('东三环中路', 'trunk')).toBe('东三环');
    expect(flowKey('东三环北路', 'trunk')).toBe('东三环');
    expect(flowKey('东三环辅路', 'primary')).toBe('东三环');
    expect(flowKey('建国路', 'primary')).toBe('建国路');
    expect(flowKey('横二条', 'residential')).toBe('');
    expect(flowKey(undefined, 'trunk')).toBe('');
    expect(flowKey('东三环中路', 'trunk_link')).toBe('');
    expect(isRing('东三环')).toBe(true); expect(isRing('京通快速路')).toBe(true); expect(isRing('建国路')).toBe(false);
  });
  it('同一条路同一格同一时段，谁问都是一个结果；不在表里的路永远畅通', () => {
    expect(levelAt('东三环', 'N', 4100, -300, 8, 77)).toBe(levelAt('东三环', 'N', 4900, -1900, 8, 77));   // 同一格
    expect(levelAt('', 'N', 0, 0, 8, 77)).toBe(0);
  });
  it('分方向：往北往南各算各的，交通台说的是差的那个', () => {
    expect(headingOf(0, -1)).toBe('N'); expect(headingOf(0.2, 1)).toBe('S'); expect(headingOf(1, 0.3)).toBe('E'); expect(headingOf(-1, 0)).toBe('W');
    let differ = 0;
    for (let s = 0; s < 200; s++) {
      const n = levelAt('东三环', 'N', 4500, 0, 8, s), so = levelAt('东三环', 'S', 4500, 0, 8, s);
      if (n !== so) differ++;
      expect(worstAt('东三环', 'z', 4500, 0, 8, s)).toBe(Math.max(n, so));
    }
    expect(differ).toBeGreaterThan(60);
  });
  it('早高峰环路堵的格子占四成上下，白天不到一成，夜里没有', () => {
    const share = (hour: number, key: string) => {
      const n = [0, 0, 0];
      for (let i = 0; i < 40; i++) for (let s = 0; s < 50; s++) n[levelAt(key, 'N', i * CELL, 0, hour, s)]++;
      return n.map((k) => k / 2000);
    };
    const rush = share(8, '东三环'), day = share(13, '东三环'), night = share(2, '东三环'), road = share(8, '建国路');
    expect(rush[2]).toBeGreaterThan(0.33); expect(rush[2]).toBeLessThan(0.47); expect(rush[0]).toBeLessThan(0.16);
    expect(day[2]).toBeLessThan(0.13); expect(day[0]).toBeGreaterThan(0.58);
    expect(night[2]).toBe(0); expect(night[0]).toBeGreaterThan(0.88);
    expect(road[2]).toBeLessThan(rush[2]);   // 主干道比环路好一些
  });
  it('机会表：拥堵的机会不超过「拥堵或缓行」', () => {
    for (const h of [0, 5, 6.2, 8, 12, 18, 21, 23]) for (const ring of [true, false]) { const [j, s] = odds(h, ring); expect(j).toBeLessThanOrEqual(s); expect(s).toBeLessThanOrEqual(1); }
  });
  it('越堵车越多、越慢；半夜全城的车少一半，高峰多两成', () => {
    expect(DENS[2]).toBeGreaterThan(DENS[1]); expect(DENS[1]).toBeGreaterThan(DENS[0]);
    expect(SPEED[2]).toBeLessThan(SPEED[1]); expect(SPEED[1]).toBeLessThan(SPEED[0]);
    expect(hourDensity(3)).toBeLessThan(0.6); expect(hourDensity(8)).toBeGreaterThan(1); expect(hourDensity(13)).toBe(1);
  });
  it('钟点段：密度和机会变的钟点都是一段的边', () => {
    for (const edge of [5, 6, 6.5, 7, 9.5, 17, 19.5, 22]) expect(hourBand(edge - 0.01)).not.toBe(hourBand(edge + 0.01));
  });
  it('堵车补时：畅通不补，缓行少补，拥堵多补，永远不扣', () => {
    const v = 80 / 3.6;
    expect(jamSlack(2000, v, 0, 10.5)).toBe(0);
    const slow = jamSlack(2000, v, 1, 10.5), jam = jamSlack(2000, v, 2, 10.5);
    expect(slow).toBeGreaterThan(30); expect(jam).toBeGreaterThan(slow);
    // 拥堵时补完的时限够按 16 km/h（实测 17）开完这两公里
    expect(2000 / 10.5 + jam).toBeGreaterThanOrEqual(2000 / (16 / 3.6));
    // 胡同里限速低的小路，平均车速本来就算得宽：不会补出负数
    expect(jamSlack(500, 30 / 3.6, 1, 10.5)).toBeGreaterThanOrEqual(0);
  });
});
