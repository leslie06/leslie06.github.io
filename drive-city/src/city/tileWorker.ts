/// <reference lib="webworker" />
/**
 * Builds one city tile off the main thread: fetch + parse the JSON, then every geometry as plain
 * typed arrays (transferred, not copied). The main thread only wraps them in BufferGeometries.
 */
import type { BuildingRec, TileData } from './Data';
import { buildBuildings } from './Buildings';
import { buildRoads } from './Roads';
import { buildAreas } from './Areas';
import { placeFurniture, type Furniture } from './visual/StreetFurniture';
import { clearStreet, inside, overlaps } from './Clear';
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

self.onmessage = async (ev: MessageEvent<{ key: string; url: string; footprints: number[][]; clear?: number[][] }>) => {
  const { key, url, footprints, clear = [] } = ev.data;
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
    const bm = buildBuildings(data.buildings, skip, data.roads);
    pack('facade', bm.facade, geoms, transfer);
    pack('roofprops', bm.props, geoms, transfer);
    const deck: number[] = [], deckLamps: number[] = [];
    // tree pits under the street trees the clear zones leave standing
    const street = clearStreet({ trees: data.trees, lamps: data.lamps, furniture: placeFurniture(data.roads, data.crossings, data.stops) }, clear);
    const rm = buildRoads(data.roads, data.crossings, deck, deckLamps, data.ctx, street.trees);
    for (const [k, g] of Object.entries(rm)) pack(k, g as THREE.BufferGeometry | null, geoms, transfer);
    for (const [k, g] of buildAreas(data.areas)) pack(`area:${k}`, g, geoms, transfer);
    transfer.push(bm.colVerts.buffer, bm.colIdx.buffer);
    // A footprint removes buildings; a landmark's clear zones remove what the street put in its way.
    const { trees, lamps, furniture } = street;
    const msg: TileResult = { key, geoms, colVerts: bm.colVerts, colIdx: bm.colIdx, trees, lamps, signals: data.signals, stops: data.stops, furniture };
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
