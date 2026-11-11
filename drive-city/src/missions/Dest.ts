import type { Place, PlaceCat } from '../nav/Places';

/**
 * 乘客去哪（2026-11-11，street-level-design A7）：从 `places.json` 的九千个有名字的地方里挑——小区、医院、学校、
 * 商场、饭店、写字楼、公园、地铁站。OSM 里的名字良莠不齐（「5号楼」「报账大厅」、天坛里的一块柱础），所以每一类
 * 只留名字像个能打车去的地方的；什么钟点去哪一类的多由 `catWeights` 定。纯函数，Node 里测（`Dest.test.ts`）。
 */

/** 每一类只要名字对得上的；没列的类（rail、area）不去。 */
const FIT: Partial<Record<PlaceCat, RegExp>> = {
  resid: /./,
  hospital: /医院|卫生|诊所|门诊/,
  school: /大学|学院|中学|小学|学校|附中|附小|幼儿园|校区/,
  mall: /[一-鿿]{2}/,
  hotel: /酒店|宾馆|饭店|公寓|旅馆|客栈|会议中心/,
  sight: /博物馆|纪念馆|美术馆|影城|电影院|影院|剧院|剧场|体育馆|体育场|图书馆|艺术中心|展览馆|科技馆|动物园|海洋馆|文化宫/,
  office: /大厦|SOHO|中心|广场|使馆|写字楼|科技园|产业园|电视台|银行|研究院|研究所/,
  gov: /派出所$|法院|检察院|政府|办事处|税务|出入境/,
  park: /公园|园$/,
  metro: /./,
};
/** 像楼号、门、分部的不要。 */
const NOT = /号楼|[东南西北]门$|[（(]|停车|厕|宿舍楼|食堂/;

/** 这个地方能不能当目的地。英文界面只要有英文名、不太长的。 */
export function usable(p: Place, zh: boolean): boolean {
  const fit = FIT[p.cat];
  if (!fit || !fit.test(p.name.zh) || NOT.test(p.name.zh)) return false;
  const n = [...p.name.zh].length;
  if (n < 2 || n > 12) return false;
  if (!zh && (p.name.en === p.name.zh || p.name.en.length > 34)) return false;
  return true;
}

/** 乘客嘴里的叫法：地铁站在 OSM 里有的带「站」有的不带，统一成「双井地铁站」。 */
export function placeLabel(p: Place, zh: boolean): string {
  if (p.cat !== 'metro') return zh ? p.name.zh : p.name.en;
  return zh ? `${p.name.zh.replace(/站$/, '')}地铁站` : `${p.name.en.replace(/\s*(Railway |Subway |Metro )?Station$/i, '')} Station`;
}

/** 什么钟点去哪一类的多：早上写字楼和学校，白天商场、医院、景点，傍晚回小区、逛商场，夜里小区和饭店。 */
export function catWeights(hour: number): Partial<Record<PlaceCat, number>> {
  if (hour >= 6 && hour < 10) return { office: 4, school: 3, hospital: 2, metro: 2, park: 1, gov: 1, resid: 0.6, mall: 0.5, hotel: 0.5, sight: 0.3 };
  if (hour >= 10 && hour < 17) return { mall: 3, hospital: 2, sight: 2, park: 2, office: 2, resid: 1.5, hotel: 1, school: 1, metro: 1, gov: 0.6 };
  if (hour >= 17 && hour < 21) return { resid: 4, mall: 3, hotel: 1.5, metro: 1.5, sight: 1, hospital: 1, park: 0.8, office: 0.5, school: 0.3, gov: 0.2 };
  return { resid: 5, hotel: 3, hospital: 1, metro: 0.4, office: 0.2, mall: 0.2 };
}

/**
 * 离 (x, z) 直线 `min`–`max` 米的能去的地方，按这个钟点的口味排好的前 `n` 个：先按权重抽类，再在那一类里抽
 * 一个（大地方——rank 0、1——多一倍机会）。调用的人再按真路程挨个试。
 */
export function rankPlaces(places: readonly Place[], x: number, z: number, min: number, max: number, hour: number, rnd: () => number, zh: boolean, n = 8,
  skip?: (p: Place) => boolean, weights?: Partial<Record<PlaceCat, number>>): Place[] {
  // `weights`：不按乘客的口味（外卖有自己的：errands/Errand.ts）
  const w = weights ?? catWeights(hour), by = new Map<PlaceCat, Place[]>();
  for (const p of places) {
    if (!w[p.cat]) continue;
    const dx = p.x - x, dz = p.z - z;
    if (Math.abs(dx) > max || Math.abs(dz) > max) continue;
    const d = Math.hypot(dx, dz);
    if (d < min || d > max || !usable(p, zh) || skip?.(p)) continue;
    (by.get(p.cat) ?? by.set(p.cat, []).get(p.cat)!).push(p);
  }
  const out: Place[] = [];
  while (out.length < n && by.size) {
    let total = 0;
    for (const c of by.keys()) total += w[c]!;
    let r = rnd() * total, cat: PlaceCat = by.keys().next().value!;
    for (const c of by.keys()) { cat = c; if ((r -= w[c]!) <= 0) break; }
    const list = by.get(cat)!;
    let sum = 0;
    for (const p of list) sum += p.rank <= 1 ? 2 : 1;
    let q = rnd() * sum, i = 0;
    for (; i < list.length - 1; i++) if ((q -= list[i].rank <= 1 ? 2 : 1) <= 0) break;
    out.push(list[i]);
    list.splice(i, 1);
    if (!list.length) by.delete(cat);
  }
  return out;
}

/** 找路边的时候找多远：占地大的（公园、大学）中心点离哪条路都远，按占地放宽。 */
export const kerbReach = (p: Place): number => Math.max(150, Math.min(900, 120 + Math.sqrt(p.ha) * 50));
