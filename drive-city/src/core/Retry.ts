/**
 * Try `fn` up to `tries` times, waiting `delayMs`, then twice that, ... between attempts. For the downloads
 * that come after the boot (landmark glbs, the Blender trees, the player's model): on GitHub Pages a
 * connection can drop a request (`ERR_HTTP2_PROTOCOL_ERROR`), and one failure used to be final - a glb
 * landmark whose OSM building its footprint had already removed left a hole in the city (2026-09-28).
 */
export async function retry<T>(what: string, fn: () => Promise<T>, tries = 3, delayMs = 3000, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<T> {
  for (let k = 1; ; k++) {
    try {
      return await fn();
    } catch (e) {
      if (k >= tries) throw e;
      console.warn(`[load] ${what} failed (attempt ${k} of ${tries}), retrying`, e);
      await wait(delayMs * 2 ** (k - 1));
    }
  }
}
