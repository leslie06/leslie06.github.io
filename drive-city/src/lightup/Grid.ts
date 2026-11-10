import type { Network } from '../city/Data';
import { shortName } from '../city/Signs';
import { RADIO_ROADS } from '../audio/CityLines';

/**
 * 点亮北京的格子（2026-11-10，docs/beijing-immersion-design.md E1）：世界按 32 米一格，开车经过的格子记下来。
 * 存档是这些格子的坐标（按行排好、差分、变长整数、base64），和地图范围无关：以后扩图不会让旧存档错位。
 * 「路」是车道图上能开车的道路（不算小区里的 service 路）经过的格子；每个区、每条环路和长安街各有自己的格子，
 * 区的完成度按 32 米的格子算，环路和长安街按 128 米的粗格子算（主路、辅路、两个方向挤在一格里，开一圈就算）。
 * 浏览器之外也能用（Node 测试、统计脚本）。
 */
export const CELL = 32;
/** Coarse cells (4 x 4 cells) for the named roads. */
const COARSE = 4;
/** Keys are row-major on a 4096-wide grid: ±65 km either way of the origin (the city and the mountain road fit). */
const OFF = 2048, ROW = 4096;

export const cellOf = (v: number) => Math.floor(v / CELL);
export const keyOf = (cx: number, cz: number) => (cz + OFF) * ROW + (cx + OFF);
export const keyX = (k: number) => (k % ROW) - OFF;
export const keyZ = (k: number) => Math.floor(k / ROW) - OFF;
/** Inside the keyed area. */
export const keyable = (cx: number, cz: number) => cx >= -OFF && cx < OFF && cz >= -OFF && cz < OFF;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Sorted keys as a string: deltas in base-32 varint digits (6-bit chars: 5 bits of value, 1 of "more"). */
export function encodeKeys(keys: Iterable<number>): string {
  const ks = [...keys].sort((a, b) => a - b);
  let out = '', prev = 0;
  for (const k of ks) {
    let d = k - prev;
    prev = k;
    do { const v = d % 32; d = Math.floor(d / 32); out += B64[v | (d > 0 ? 32 : 0)]; } while (d > 0);
  }
  return out;
}

export function decodeKeys(s: string): number[] {
  const out: number[] = [];
  let prev = 0, d = 0, mul = 1;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return out;
    d += (v & 31) * mul;
    if (v & 32) { mul *= 32; continue; }
    prev += d; out.push(prev);
    d = 0; mul = 1;
  }
  return out;
}

/** Road classes that count (the lane graph's drivable roads but service ways and living streets). */
const COUNTS = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/;

/** The named roads with a 一圈 / 全程 of their own. */
export const ROUTES = [
  { id: 'r2', match: (n: string) => /^[东西南北]二环$/.test(shortName(n)) },
  { id: 'r3', match: (n: string) => /^[东西南北]三环$/.test(shortName(n)) },
  { id: 'r4', match: (n: string) => /^[东西南北]四环$/.test(shortName(n)) },
  { id: 'r5', match: (n: string) => /^[东西南北]五环$/.test(shortName(n)) },
  { id: 'changan', match: (n: string) => RADIO_ROADS.find((r) => r.id === 'changan')!.match.test(n) },
] as const;
export type RouteId = (typeof ROUTES)[number]['id'];

export interface District { zh: string; en: string; r: number[][] }

/**
 * Every road cell of the map, by district and named road: built once from the network (~0.15 s on a desktop, a little at a
 * time over frames: `build(ms)`), then asked how much of each a set of visited cells covers.
 */
export class Roads {
  /** Road cells: key -> district index (255: none). */
  readonly cells = new Map<number, number>();
  /** Per district: how many road cells. */
  readonly perDistrict: number[];
  /** Per named road: its coarse cells. */
  readonly routeCells = new Map<RouteId, Set<number>>();
  /** Edge indices by 512 m block (16 x 16 cells), for drawing the lit roads. */
  readonly blockEdges = new Map<number, number[]>();

  private raster: (x: number, z: number) => number;
  private next = 0;

  constructor(readonly net: Network, readonly districts: readonly District[]) {
    this.raster = districtRaster(districts);
    this.perDistrict = districts.map(() => 0);
    for (const r of ROUTES) this.routeCells.set(r.id, new Set());
  }

  /** All edges read. */
  get ready(): boolean { return this.next >= this.net.edges.length; }

  /** Read edges until `ms` have gone by (all of them without a budget); true when done. */
  build(ms = Infinity): boolean {
    const end = performance.now() + ms, edges = this.net.edges, STEP = 8;
    while (this.next < edges.length) {
      const ei = this.next++, e = edges[ei];
      if ((ei & 255) === 0 && performance.now() > end) return false;
      if (!COUNTS.test(e.c)) continue;
      const routes = e.n ? ROUTES.filter((r) => r.match(e.n!)) : [];
      const blocks = new Set<number>();
      for (let i = 0; i + 3 < e.p.length; i += 2) {
        const ax = e.p[i], az = e.p[i + 1], bx = e.p[i + 2], bz = e.p[i + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
        for (let j = 0; j <= n; j++) {
          const x = ax + (bx - ax) * j / n, z = az + (bz - az) * j / n, cx = cellOf(x), cz = cellOf(z), k = keyOf(cx, cz);
          if (!this.cells.has(k)) { const d = this.raster(x, z); this.cells.set(k, d); if (d !== 255) this.perDistrict[d]++; }
          for (const r of routes) this.routeCells.get(r.id)!.add(keyOf(cx >> 2, cz >> 2));
          blocks.add(keyOf(cx >> 4, cz >> 4));
        }
      }
      for (const b of blocks) (this.blockEdges.get(b) ?? this.blockEdges.set(b, []).get(b)!).push(ei);
    }
    return true;
  }

  /** How much of everything `visited` covers. */
  stats(visited: ReadonlySet<number>): LightStats {
    const perDistrict = this.districts.map(() => 0);
    let lit = 0;
    const coarse = new Set<number>();
    for (const k of visited) {
      coarse.add(keyOf(keyX(k) >> 2, keyZ(k) >> 2));
      const d = this.cells.get(k);
      if (d === undefined) continue;
      lit++;
      if (d !== 255) perDistrict[d]++;
    }
    const routes = {} as Record<RouteId, number>;
    for (const [id, cells] of this.routeCells) {
      let n = 0;
      for (const c of cells) if (coarse.has(c)) n++;
      routes[id] = cells.size ? n / cells.size : 0;
    }
    return { lit, total: this.cells.size, km: lit * CELL / 1000, perDistrict, routes };
  }
}

export interface LightStats {
  /** Road cells lit, of all. */
  lit: number; total: number;
  /** Roughly how many km of road that is (a cell per 32 m of road). */
  km: number;
  /** Road cells lit per district (the totals are `Roads.perDistrict`). */
  perDistrict: number[];
  /** Share of each named road's coarse cells lit (0..1). */
  routes: Record<RouteId, number>;
}

/** A named road counts as done from this share of it. */
export const ROUTE_DONE = 0.85;

/** District index at (x, z) (255: none), from a 128 m raster filled by scanlines. */
function districtRaster(ds: readonly District[]): (x: number, z: number) => number {
  const R = 128;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const d of ds) for (const ring of d.r) for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
  }
  if (!ds.length) return () => 255;
  const W = Math.ceil((x1 - x0) / R) + 1, H = Math.ceil((z1 - z0) / R) + 1;
  const grid = new Uint8Array(W * H).fill(255);
  ds.forEach((d, di) => {
    for (let row = 0; row < H; row++) {
      const z = z0 + (row + 0.5) * R, xs: number[] = [];
      // even-odd over all of the district's rings (holes and pieces alike)
      for (const ring of d.r) {
        const n = ring.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
          if ((az > z) !== (bz > z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / R - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / R - 0.5));
        for (let c = c0; c <= c1; c++) grid[row * W + c] = di;
      }
    }
  });
  return (x, z) => {
    const c = Math.floor((x - x0) / R), r = Math.floor((z - z0) / R);
    return c < 0 || r < 0 || c >= W || r >= H ? 255 : grid[r * W + c];
  };
}
