import { describe, expect, it } from 'vitest';
import { compass, deliverPay, favourWeights, liftPay, pickFavour, reachOf, roughly, warmth, type Chances, type FavourKind } from './Way';

describe('问路：方向和距离', () => {
  it('x 朝东、z 朝南：往 -z 是北', () => {
    expect(compass(0, -100)).toBe('n');
    expect(compass(100, 0)).toBe('e');
    expect(compass(0, 100)).toBe('s');
    expect(compass(-100, 0)).toBe('w');
    expect(compass(70, -70)).toBe('ne');
    expect(compass(-70, 70)).toBe('sw');
    expect(compass(-70, -70)).toBe('nw');
    expect(compass(70, 70)).toBe('se');
  });
  it('偏一点还算正方向，过了 22.5 度才算斜的', () => {
    expect(compass(20, -100)).toBe('n');
    expect(compass(50, -100)).toBe('ne');
    expect(compass(-1, -100)).toBe('n');   // 正北两侧不能一边是 n 一边掉到表外
  });
  it('到了、走着去、开车去', () => {
    expect(reachOf(10)).toBe('here');
    expect(reachOf(200)).toBe('walk');
    expect(reachOf(450)).toBe('walk');
    expect(reachOf(451)).toBe('drive');
  });
  it('嘴上说的距离是凑整的', () => {
    expect(roughly(4)).toEqual({ n: '10', km: false });
    expect(roughly(83)).toEqual({ n: '80', km: false });
    expect(roughly(320)).toEqual({ n: '300', km: false });
    expect(roughly(940)).toEqual({ n: '950', km: false });
    expect(roughly(1000)).toEqual({ n: '1', km: true });
    expect(roughly(2340)).toEqual({ n: '2.3', km: true });
  });
});

describe('路人的委托', () => {
  const all: Chances = { shop: true, car: true, sight: false, ground: true };
  it('没店不捎东西，车不在身边不搭车，没地方掉不找东西；合影什么时候都有', () => {
    const w = favourWeights({ shop: false, car: false, sight: false, ground: false });
    expect(w.deliver).toBe(0); expect(w.lift).toBe(0); expect(w.find).toBe(0); expect(w.photo).toBeGreaterThan(0);
    expect(pickFavour({ shop: false, car: false, sight: false, ground: false }, () => 0.99)).toBe('photo');
  });
  it('景点边上合影的多', () => {
    expect(favourWeights({ ...all, sight: true }).photo).toBeGreaterThan(favourWeights(all).photo);
  });
  it('四种都抽得到，上一回的那种少一半', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n: Record<FavourKind, number> = { deliver: 0, photo: 0, lift: 0, find: 0 };
    for (let i = 0; i < 4000; i++) n[pickFavour(all, rnd)!]++;
    for (const k of Object.keys(n) as FavourKind[]) expect(n[k]).toBeGreaterThan(300);
    const m: Record<FavourKind, number> = { deliver: 0, photo: 0, lift: 0, find: 0 };
    for (let i = 0; i < 4000; i++) m[pickFavour(all, rnd, 'deliver')!]++;
    expect(m.deliver).toBeLessThan(n.deliver * 0.75);
  });
  it('找东西：越近越热', () => {
    expect(warmth(40)).toBe(0); expect(warmth(20)).toBe(1); expect(warmth(10)).toBe(2); expect(warmth(3)).toBe(3);
  });
  it('报酬随路程涨，都是几十块的小钱', () => {
    expect(deliverPay(60)).toBe(36); expect(deliverPay(250)).toBe(55);
    expect(liftPay(500)).toBe(60); expect(liftPay(1200)).toBe(88);
  });
});
