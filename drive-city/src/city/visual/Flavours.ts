import DATA from './flavours.gen.json';
import { FLAVOURS, type Flavour } from './ShopSigns';

/**
 * 每栋楼的「片区口味」（2026-11-10，docs/street-level-design.md B4）：店招按它挑（ShopSigns.ts 的 `signIndex`）。
 * 数据 `flavours.gen.json` 是 `node scripts/city/flavours.mjs` 生成的一串圆 [x, z, 半径, 口味]，先到先得：
 *   手工指定的名街（簋街、三里屯、中关村大街、后海……，沿路每 50 米一个圆）→ 医院周边 → 高校周边 → 写字楼扎堆的地方。
 * 圆之外按楼自己：胡同平房是「胡同」；离天安门 12 公里以外的厂房、矮楼是「城乡结合部」。其余没有口味（通用招牌）。
 * 纯函数，瓦片 worker 里用。
 */
const Z = (DATA as { z: number[] }).z;
const CELL = 512;
let grid: Map<number, number[]> | null = null;
const key = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);
function index(): Map<number, number[]> {
  const g = new Map<number, number[]>();
  for (let i = 0; i < Z.length; i += 4) {
    const x = Z[i], z = Z[i + 1], r = Z[i + 2];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
      const k = key(cx, cz);
      (g.get(k) ?? g.set(k, []).get(k)!).push(i);
    }
  }
  return g;
}
const ID = (f: Flavour) => FLAVOURS.indexOf(f) + 1;

/** The flavour of a building at (x, z): 0 none, else 1 + its index in FLAVOURS. `kind` the building's, `r` its own random 0..1. */
export function flavourAt(x: number, z: number, kind: string, r: number): number {
  grid ??= index();
  // the zones are in the file in order of precedence: the first that holds the point
  let best = Infinity;
  for (const i of grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
    if (i < best && (x - Z[i]) ** 2 + (z - Z[i + 1]) ** 2 < Z[i + 2] ** 2) best = i;
  }
  if (best < Infinity) return Z[best + 3];
  if (kind === 'hutong') return ID('hutong');
  if (Math.hypot(x, z) > 12000 && (kind === 'low' || r < 0.35)) return ID('fringe');
  return 0;
}
