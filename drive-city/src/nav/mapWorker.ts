/**
 * Background crawl for the maps' area layer: fetches every city tile once (nearest first, a few at a
 * time) and keeps only what the maps draw, as flat rings: water, green space, plazas and building
 * outlines. Off the main thread, so ~5.7 MB of tile JSON never costs a frame; tiles the streamer
 * already fetched come from the HTTP cache.
 */
import type { TileData } from '../city/Data';

/** Rings packed as [pointCount, x, z, x, z, ..., pointCount, ...]. */
export interface MapTileMsg { key: string; ix: number; iz: number; water: Float32Array; green: Float32Array; plaza: Float32Array; bld: Float32Array; bbox: [number, number, number, number] }
export type MapWorkerOut = { tile: MapTileMsg } | { done: true; failed: number };
export interface MapWorkerIn { tiles: [key: string, url: string][]; concurrency: number; tile: number }

const GREEN = new Set(['park', 'wood', 'grass', 'pitch']);

function pack(list: number[][]): Float32Array {
  let n = 0;
  for (const r of list) n += 1 + r.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const r of list) { out[o++] = r.length / 2; out.set(r, o); o += r.length; }
  return out;
}

self.onmessage = async (ev: MessageEvent<MapWorkerIn>) => {
  const { tiles, concurrency, tile } = ev.data;
  const post = (msg: MapWorkerOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  const pass = async (jobs: [string, string][]) => {
    const queue = jobs.slice(), failed: [string, string][] = [];
    const run = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const [key, url] = job;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const t = (await res.json()) as TileData;
          const water: number[][] = [], green: number[][] = [], plaza: number[][] = [], bld: number[][] = [];
          for (const a of t.areas) {
            const dst = a.k === 'water' ? water : GREEN.has(a.k) ? green : a.k === 'plaza' ? plaza : null;
            if (!dst) continue;
            dst.push(a.o);
            for (const h of a.hs ?? []) dst.push(h);
          }
          let x0 = t.ix * tile, z0 = t.iz * tile, x1 = x0 + tile, z1 = z0 + tile;
          for (const b of t.buildings) {
            bld.push(b.o);
            for (const h of b.hs ?? []) bld.push(h);
            for (let i = 0; i < b.o.length; i += 2) {
              x0 = Math.min(x0, b.o[i]); x1 = Math.max(x1, b.o[i]); z0 = Math.min(z0, b.o[i + 1]); z1 = Math.max(z1, b.o[i + 1]);
            }
          }
          const msg: MapTileMsg = { key, ix: t.ix, iz: t.iz, water: pack(water), green: pack(green), plaza: pack(plaza), bld: pack(bld), bbox: [x0, z0, x1, z1] };
          post({ tile: msg }, [msg.water.buffer, msg.green.buffer, msg.plaza.buffer, msg.bld.buffer]);
        } catch { failed.push(job); }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, run));
    return failed;
  };
  // One retry after a pause: tiles can be mid-rewrite while the city data is being rebuilt.
  let failed = await pass(tiles);
  if (failed.length) { await new Promise((r) => setTimeout(r, 1500)); failed = await pass(failed); }
  post({ done: true, failed: failed.length });
};
