/// <reference lib="webworker" />
/**
 * Builds one city tile off the main thread: fetch + parse the JSON, then every geometry as plain
 * typed arrays (transferred, not copied). The main thread only wraps them in BufferGeometries.
 */
import type { BuildingRec, RoadPiece, TileData } from './Data';
import { buildBuildings } from './Buildings';
import { buildRoads } from './Roads';
import { buildAreas } from './Areas';
import { placeFurniture, type Furniture } from './visual/StreetFurniture';
import { dropParked, placeParking } from './visual/Parking';
import { clearStreet, dropInside, inside, overlaps } from './Clear';
import FAMOUS_GEN from './famous.gen.json';
import { TILE } from './Geo';
import type * as THREE from 'three';

export interface PackedGeometry { name: string; attrs: { name: string; array: Float32Array; itemSize: number }[]; index?: Uint32Array }
export interface TileResult {
  key: string;
  error?: string;
  geoms?: PackedGeometry[];
  colVerts?: Float32Array; colIdx?: Uint32Array;
  /** The interchanges' decks, parapets, embankment walls and piers as one trimesh (Roads.ts `bridgeOf`), or absent. */
  deckVerts?: Float32Array; deckIdx?: Uint32Array;
  /** Street lamps standing on the decks' parapets: [x, y, z, yaw] each. */
  deckLamps?: number[];
  trees?: number[]; lamps?: number[]; signals?: number[]; stops?: number[];
  /** Street furniture instances (visual/StreetFurniture.ts). */
  furniture?: Furniture;
  /** Shop units on the ground floors (Buildings.ts `shops`, `SHOP_STRIDE` numbers each). */
  shops?: number[];
}

function pack(name: string, g: THREE.BufferGeometry | null, out: PackedGeometry[], transfer: Transferable[]): void {
  if (!g) return;
  const attrs = Object.entries(g.attributes).map(([n, a]) => {
    const array = (a as THREE.BufferAttribute).array as Float32Array;
    transfer.push(array.buffer);
    return { name: n, array, itemSize: (a as THREE.BufferAttribute).itemSize };
  });
  const index = g.index ? (g.index.array as Uint32Array) : undefined;
  if (index) transfer.push(index.buffer);
  out.push({ name, attrs, index });
}

self.onmessage = async (ev: MessageEvent<{ key: string; url: string; footprints: number[][]; clear?: number[][]; street?: number[][]; lampClear?: number[][]; near?: RoadPiece[] } | { ping: true }>) => {
  // spawnTileWorkers: loaded, so the other workers will find this script in the cache
  if ('ping' in ev.data) { (self as unknown as Worker).postMessage({ ping: true }); return; }
  const { key, url, footprints, clear = [], street: streetOnly = [], lampClear = [], near = [] } = ev.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as TileData;
    // A footprint removes the buildings whose centre it holds; a learnt building (ids from 8e12, machine-
    // learnt footprints OSM lacks) goes if it overlaps a footprint at all, and anything overlapping a clear
    // zone goes (the villa's drive, the shortcuts: sited on open ground that the learnt set may build on).
    const skip = footprints.length || clear.length ? (b: BuildingRec) => {
      let cx = 0, cz = 0; const n = b.o.length / 2;
      for (let i = 0; i < b.o.length; i += 2) { cx += b.o[i]; cz += b.o[i + 1]; }
      cx /= n; cz /= n;
      if (footprints.some((f) => inside(cx, cz, f))) return true;
      const learnt = b.i >= 8e12 && b.i < 9e12;
      return clear.some((f) => overlaps(b.o, f)) || (learnt && footprints.some((f) => overlaps(b.o, f)));
    } : undefined;
    const geoms: PackedGeometry[] = [], transfer: Transferable[] = [];
    // the roads next door too: a building is on the tile its middle is on, its street may be on the next one
    // 名片街补的铺面（scripts/city/famous.mts、city/Famous.ts）：中心在这块瓦片上的加进来当普通房子（地标照样能删）；
    // 它们底下的树、路灯、停的车清掉（地块挨着这块瓦片的都算：树可能在邻块的楼底下）
    const [tix, tiz] = key.split('_').map(Number), bx0 = tix * TILE - 20, bx1 = (tix + 1) * TILE + 20, bz0 = tiz * TILE - 20, bz1 = (tiz + 1) * TILE + 20;
    const infillZones: number[][] = [];
    for (const b of (FAMOUS_GEN as { b: BuildingRec[] }).b) {
      const o = b.o;
      let cx = 0, cz = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < o.length; i += 2) { cx += o[i]; cz += o[i + 1]; x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); z0 = Math.min(z0, o[i + 1]); z1 = Math.max(z1, o[i + 1]); }
      if (x1 < bx0 || x0 > bx1 || z1 < bz0 || z0 > bz1 || skip?.(b)) continue;
      infillZones.push(o);
      cx /= o.length / 2; cz /= o.length / 2;
      if (Math.floor(cx / TILE) === tix && Math.floor(cz / TILE) === tiz) data.buildings.push(b);
    }
    const bm = buildBuildings(data.buildings, skip, near.length ? [...data.roads, ...near] : data.roads);
    pack('facade', bm.facade, geoms, transfer);
    pack('roofprops', bm.props, geoms, transfer);
    const deck: number[] = [], deckLamps: number[] = [];
    // tree pits under the street trees the clear zones leave standing
    const zones = streetOnly.length || infillZones.length ? [...clear, ...streetOnly, ...infillZones] : clear;
    const street = clearStreet({ trees: data.trees, lamps: data.lamps, furniture: placeFurniture(data.roads, data.crossings, data.stops) }, zones);
    // 长安街（visual/ChanganLamps.ts）：只换路灯、去掉白护栏，行道树留着
    if (lampClear.length) { street.lamps = dropInside(street.lamps, 3, lampClear); street.furniture.rail = dropInside(street.furniture.rail, 5, lampClear, 0, 2); }
    // Cars parked along the kerbs, clear of what the street keeps there and of the zones.
    street.furniture.park = dropParked(placeParking(data.roads, data.crossings, data.stops, street.trees, street.lamps, street.furniture.bike, street.furniture.bin, data.ctx), zones);
    const rm = buildRoads(data.roads, data.crossings, deck, deckLamps, data.ctx, street.trees);
    for (const [k, g] of Object.entries(rm)) pack(k, g as THREE.BufferGeometry | null, geoms, transfer);
    for (const [k, g] of buildAreas(data.areas)) pack(`area:${k}`, g, geoms, transfer);
    transfer.push(bm.colVerts.buffer, bm.colIdx.buffer);
    // A footprint removes buildings; a landmark's clear zones remove what the street put in its way.
    const { trees, lamps, furniture } = street;
    const msg: TileResult = { key, geoms, colVerts: bm.colVerts, colIdx: bm.colIdx, trees, lamps, signals: data.signals, stops: data.stops, furniture, shops: bm.shops };
    if (deckLamps.length) msg.deckLamps = deckLamps;
    if (deck.length) {
      msg.deckVerts = Float32Array.from(deck);
      msg.deckIdx = new Uint32Array(deck.length / 3).map((_, i) => i);
      transfer.push(msg.deckVerts.buffer, msg.deckIdx.buffer);
    }
    (self as unknown as Worker).postMessage(msg, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ key, error: String((e as Error)?.message ?? e) } satisfies TileResult);
  }
};
