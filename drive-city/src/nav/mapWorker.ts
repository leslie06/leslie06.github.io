/**
 * Background crawl for the maps' area layer: fetches the map blocks the build baked (public/city/map/,
 * 4 x 4 tiles each: water, green space, plazas and building outlines in whole metres), nearest first,
 * a few at a time, and hands each tile's rings over packed. Off the main thread. It used to fetch every
 * city tile whole - 38 MB once the old city was in.
 */

/** Rings packed as [pointCount, x, z, x, z, ..., pointCount, ...]. */
export interface MapTileMsg { key: string; ix: number; iz: number; water: Float32Array; green: Float32Array; plaza: Float32Array; bld: Float32Array; bbox: [number, number, number, number] }
export type MapWorkerOut = { tile: MapTileMsg } | { block: string } | { done: true; failed: number };
export interface MapWorkerIn { blocks: [key: string, url: string][]; concurrency: number; tile: number }
/** One tile's entry in a map block (scripts/city/build.mjs). */
interface BlockTile { k: string; w: number[][]; g: number[][]; p: number[][]; b: number[][] }

function pack(list: number[][]): Float32Array {
  let n = 0;
  for (const r of list) n += 1 + r.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const r of list) { out[o++] = r.length / 2; out.set(r, o); o += r.length; }
  return out;
}

self.onmessage = async (ev: MessageEvent<MapWorkerIn>) => {
  const { blocks, concurrency, tile } = ev.data;
  const post = (msg: MapWorkerOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  const pass = async (jobs: [string, string][]) => {
    const queue = jobs.slice(), failed: [string, string][] = [];
    const run = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const [key, url] = job;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          for (const e of (await res.json()) as BlockTile[]) {
            const [ix, iz] = e.k.split('_').map(Number);
            let x0 = ix * tile, z0 = iz * tile, x1 = x0 + tile, z1 = z0 + tile;
            for (const r of e.b) for (let i = 0; i < r.length; i += 2) {
              x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
            }
            const msg: MapTileMsg = { key: e.k, ix, iz, water: pack(e.w), green: pack(e.g), plaza: pack(e.p), bld: pack(e.b), bbox: [x0, z0, x1, z1] };
            post({ tile: msg }, [msg.water.buffer, msg.green.buffer, msg.plaza.buffer, msg.bld.buffer]);
          }
          post({ block: key });
        } catch { failed.push(job); }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, run));
    return failed;
  };
  // One retry after a pause: blocks can be mid-rewrite while the city data is being rebuilt.
  let failed = await pass(blocks);
  if (failed.length) { await new Promise((r) => setTimeout(r, 1500)); failed = await pass(failed); }
  post({ done: true, failed: failed.length });
};
