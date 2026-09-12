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
import type * as THREE from 'three';

export interface PackedGeometry { name: string; attrs: { name: string; array: Float32Array; itemSize: number }[]; index?: Uint32Array }
export interface TileResult {
  key: string;
  error?: string;
  geoms?: PackedGeometry[];
  colVerts?: Float32Array; colIdx?: Uint32Array;
  trees?: number[]; lamps?: number[]; signals?: number[]; stops?: number[];
  /** Street furniture instances (visual/StreetFurniture.ts). */
  furniture?: Furniture;
}

function inside(x: number, z: number, r: number[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
  }
  return c;
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

self.onmessage = async (ev: MessageEvent<{ key: string; url: string; footprints: number[][] }>) => {
  const { key, url, footprints } = ev.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as TileData;
    const skip = footprints.length ? (b: BuildingRec) => {
      let cx = 0, cz = 0; const n = b.o.length / 2;
      for (let i = 0; i < b.o.length; i += 2) { cx += b.o[i]; cz += b.o[i + 1]; }
      cx /= n; cz /= n;
      return footprints.some((f) => inside(cx, cz, f));
    } : undefined;
    const geoms: PackedGeometry[] = [], transfer: Transferable[] = [];
    const bm = buildBuildings(data.buildings, skip, data.roads);
    pack('facade', bm.facade, geoms, transfer);
    const rm = buildRoads(data.roads, data.crossings);
    for (const [k, g] of Object.entries(rm)) pack(k, g as THREE.BufferGeometry | null, geoms, transfer);
    for (const [k, g] of buildAreas(data.areas)) pack(`area:${k}`, g, geoms, transfer);
    transfer.push(bm.colVerts.buffer, bm.colIdx.buffer);
    const furniture = placeFurniture(data.roads, data.crossings, data.stops);
    const msg: TileResult = { key, geoms, colVerts: bm.colVerts, colIdx: bm.colIdx, trees: data.trees, lamps: data.lamps, signals: data.signals, stops: data.stops, furniture };
    (self as unknown as Worker).postMessage(msg, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ key, error: String((e as Error)?.message ?? e) } satisfies TileResult);
  }
};
