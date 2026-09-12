import type { LaneGraph, Link } from '../traffic/LaneGraph';
import type { Manifest } from '../city/Data';
import type { MapTileMsg, MapWorkerIn, MapWorkerOut } from './mapWorker';

/** Road drawing tiers, thinnest first: service, local, collector, arterial, expressway. */
export const TIERS = 5;
const TIER: Record<string, number> = {
  motorway: 4, trunk: 4,
  primary: 3, motorway_link: 3, trunk_link: 3,
  secondary: 2, tertiary: 2, primary_link: 2,
  residential: 1, unclassified: 1, secondary_link: 1, tertiary_link: 1,
  service: 0, living_street: 0, busway: 0,
};
export const tierOf = (cls: string): number => TIER[cls] ?? 1;

/** Fine cells match the city's 256 m tiles; coarse cells serve the zoomed-out map. */
export const FINE = 256, COARSE = 2048;
/** Fine road pieces are at most this long and filed by their midpoint, so a query pads by half of it. */
const PIECE = 64;
/** Coarse cells file whole segments by midpoint: pad by half the longest segment on the map (810 m). */
const COARSE_PAD = 420;
/** Building outlines stick out of their tile by up to ~330 m (filed by centroid); their tile bbox covers that. */
const TILE_PAD = 2;
const ck = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

export interface RoadCell { roads: (Path2D | null)[]; /** Named canonical link ids with a piece in this cell. */ named: number[] }
export interface AreaCell { water: Path2D | null; green: Path2D | null; plaza: Path2D | null; bld: Path2D | null }

interface TileLayer { msg: MapTileMsg; cell: AreaCell | null }

const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

function ringsTo(path: Path2D, packed: Float32Array): void {
  for (let o = 0; o < packed.length;) {
    const n = packed[o++];
    if (n < 3) { o += n * 2; continue; }
    path.moveTo(packed[o], packed[o + 1]);
    for (let i = 1; i < n; i++) path.lineTo(packed[o + i * 2], packed[o + i * 2 + 1]);
    path.closePath();
    o += n * 2;
  }
}

/**
 * Everything the minimap and the full map draw that does not move: the road network as Path2D
 * objects in world metres (one per cell per tier, stroked under a world->screen transform), and
 * parks, water, plazas and building outlines, which arrive from a background worker.
 */
export class MapData {
  private fine = new Map<number, RoadCell>();
  private coarse = new Map<number, RoadCell>();
  private tiles = new Map<number, TileLayer>();
  private coarseAreas = new Map<number, AreaCell>();
  /** Bumped whenever area data arrives, so a static map knows to redraw. */
  version = 0;
  tilesLoaded = 0;
  tilesTotal = 0;
  /** The crawl finished (some tiles may have failed). */
  complete = false;
  readonly buildMs: number;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private worker: Worker | null = null;

  constructor(readonly graph: LaneGraph) {
    this.ready = new Promise((r) => { this.resolveReady = r; });
    const t0 = performance.now();
    for (const l of graph.links) if (l.rev < 0 || l.id < l.rev) this.addLink(l);
    this.buildMs = performance.now() - t0;
  }

  /** Start the area crawl, nearest tiles to (x, z) first. */
  load(manifest: Manifest, x: number, z: number, concurrency = 4): void {
    if (this.worker) return;
    const T = manifest.tile;
    const keys = Object.keys(manifest.tiles).map((k) => { const [ix, iz] = k.split('_').map(Number); return { k, d: Math.hypot((ix + 0.5) * T - x, (iz + 0.5) * T - z) }; });
    keys.sort((a, b) => a.d - b.d);
    this.tilesTotal = keys.length;
    if (!keys.length) { this.done(); return; }
    try {
      const w = this.worker = new Worker(new URL('./mapWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<MapWorkerOut>) => {
        const m = ev.data;
        if ('tile' in m) this.ingest(m.tile);
        else { w.terminate(); this.worker = null; this.done(); if (m.failed) console.warn(`[nav] ${m.failed} map tiles failed to load`); }
      };
      w.onerror = (e) => { console.warn('[nav] map worker', e.message); this.done(); };
      const msg: MapWorkerIn = { tiles: keys.map(({ k }) => [k, new URL(`${BASE}city/t_${k}.json`, location.href).href]), concurrency, tile: T };
      w.postMessage(msg);
    } catch (e) { console.warn('[nav] no map worker', e); this.done(); }
  }

  private done(): void { this.complete = true; this.version++; this.resolveReady(); }

  private ingest(msg: MapTileMsg): void {
    this.tiles.set(ck(msg.ix, msg.iz), { msg, cell: null });
    this.coarseAreas.delete(ck(Math.floor(msg.ix * FINE / COARSE), Math.floor(msg.iz * FINE / COARSE)));
    this.tilesLoaded++;
    this.version++;
  }

  private cell(map: Map<number, RoadCell>, k: number): RoadCell {
    let c = map.get(k);
    if (!c) map.set(k, c = { roads: new Array<Path2D | null>(TIERS).fill(null), named: [] });
    return c;
  }

  private addLink(l: Link): void {
    const tier = tierOf(l.cls), p = l.pts;
    let prevF = -1, prevC = -1;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      // Coarse: whole segments.
      const cK = ck(Math.floor((ax + bx) / 2 / COARSE), Math.floor((az + bz) / 2 / COARSE));
      const cp = this.cell(this.coarse, cK).roads;
      const pc = cp[tier] ??= new Path2D();
      if (cK !== prevC) pc.moveTo(ax, az);
      pc.lineTo(bx, bz);
      prevC = cK;
      // Fine: pieces of at most PIECE metres.
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / PIECE));
      for (let i = 0; i < n; i++) {
        const x0 = ax + (bx - ax) * i / n, z0 = az + (bz - az) * i / n, x1 = ax + (bx - ax) * (i + 1) / n, z1 = az + (bz - az) * (i + 1) / n;
        const fk = ck(Math.floor((x0 + x1) / 2 / FINE), Math.floor((z0 + z1) / 2 / FINE));
        const f = this.cell(this.fine, fk);
        const pf = f.roads[tier] ??= new Path2D();
        if (fk !== prevF) pf.moveTo(x0, z0);
        pf.lineTo(x1, z1);
        if (l.name && f.named[f.named.length - 1] !== l.id) f.named.push(l.id);
        prevF = fk;
      }
    }
  }

  /** Road cells whose pieces may cross the world rect, into `out`. */
  roadCells(x0: number, z0: number, x1: number, z1: number, coarse: boolean, out: RoadCell[]): RoadCell[] {
    out.length = 0;
    const size = coarse ? COARSE : FINE, pad = coarse ? COARSE_PAD : PIECE / 2 + 4, map = coarse ? this.coarse : this.fine;
    for (let ix = Math.floor((x0 - pad) / size); ix <= Math.floor((x1 + pad) / size); ix++)
      for (let iz = Math.floor((z0 - pad) / size); iz <= Math.floor((z1 + pad) / size); iz++) {
        const c = map.get(ck(ix, iz));
        if (c) out.push(c);
      }
    return out;
  }

  /** Area layers crossing the world rect: per tile when `coarse` is false, else merged per 2 km cell. */
  areaCells(x0: number, z0: number, x1: number, z1: number, coarse: boolean, out: AreaCell[]): AreaCell[] {
    out.length = 0;
    if (coarse) {
      for (let ix = Math.floor(x0 / COARSE); ix <= Math.floor(x1 / COARSE); ix++)
        for (let iz = Math.floor(z0 / COARSE); iz <= Math.floor(z1 / COARSE); iz++) {
          const k = ck(ix, iz);
          let c = this.coarseAreas.get(k);
          if (!c) {
            const parts: MapTileMsg[] = [], per = COARSE / FINE;
            for (let tx = ix * per; tx < (ix + 1) * per; tx++) for (let tz = iz * per; tz < (iz + 1) * per; tz++) { const t = this.tiles.get(ck(tx, tz)); if (t) parts.push(t.msg); }
            if (!parts.length) continue;
            c = this.build(parts, false);
            this.coarseAreas.set(k, c);
          }
          out.push(c);
        }
      return out;
    }
    for (let ix = Math.floor(x0 / FINE) - TILE_PAD; ix <= Math.floor(x1 / FINE) + TILE_PAD; ix++)
      for (let iz = Math.floor(z0 / FINE) - TILE_PAD; iz <= Math.floor(z1 / FINE) + TILE_PAD; iz++) {
        const t = this.tiles.get(ck(ix, iz));
        if (!t) continue;
        const b = t.msg.bbox;
        if (b[0] > x1 || b[2] < x0 || b[1] > z1 || b[3] < z0) continue;
        out.push(t.cell ??= this.build([t.msg], true));
      }
    return out;
  }

  private build(parts: MapTileMsg[], buildings: boolean): AreaCell {
    const layer = (pick: (m: MapTileMsg) => Float32Array): Path2D | null => {
      let p: Path2D | null = null;
      for (const m of parts) { const a = pick(m); if (a.length) ringsTo(p ??= new Path2D(), a); }
      return p;
    };
    return { water: layer((m) => m.water), green: layer((m) => m.green), plaza: layer((m) => m.plaza), bld: buildings ? layer((m) => m.bld) : null };
  }

  dispose(): void { this.worker?.terminate(); this.worker = null; }
}
