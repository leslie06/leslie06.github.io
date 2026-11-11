import { describe, expect, it } from 'vitest';
import { Comfort, COST, STAR_TIP, starsOf, starText } from './Comfort';

describe('乘客满意', () => {
  it('一路没事是五星', () => {
    const c = new Comfort();
    for (let i = 0; i < 600; i++) c.step(1 / 60);
    expect(c.value).toBe(100);
    expect(c.stars).toBe(5);
  });

  it('擦身而过四次还是五星，撞一下或闯一次灯就不是了', () => {
    const near = new Comfort();
    for (let i = 0; i < 4; i++) { near.mark('near'); near.step(2); }
    expect(near.stars).toBe(5);
    near.mark('near');
    expect(near.stars).toBe(4);
    const crash = new Comfort(); crash.mark('crash');
    expect(crash.stars).toBe(4);
    const red = new Comfort(); red.mark('redlight');
    expect(red.stars).toBe(4);
  });

  it('一次碰撞连着报几下只算一次，隔开了再算', () => {
    const c = new Comfort();
    expect(c.mark('crash')).toBe(true);
    c.step(0.3);
    expect(c.mark('crash')).toBe(false);
    expect(c.mark('hard')).toBe(false);
    expect(c.value).toBe(100 - COST.crash);
    c.step(1.5);
    expect(c.mark('hard')).toBe(true);
    expect(c.value).toBe(100 - COST.crash - COST.hard);
  });

  it('撞了人最多三星，分数不会是负的', () => {
    const c = new Comfort();
    c.mark('ped'); c.mark('crash');
    expect(c.stars).toBe(3);
    for (let i = 0; i < 10; i++) { c.step(2); c.mark('ped'); }
    expect(c.value).toBe(0);
    expect(c.stars).toBe(1);
  });

  it('星和小费：三星起才有，五星是车费的一半', () => {
    expect([100, 88, 87, 70, 69, 50, 49, 30, 29, 0].map(starsOf)).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
    expect(STAR_TIP[0]).toBe(0); expect(STAR_TIP[1]).toBe(0); expect(STAR_TIP[4]).toBe(0.5);
    expect(starText(3)).toBe('★★★☆☆');
  });
});
