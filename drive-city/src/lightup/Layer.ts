import type { LightupApi } from '.';
import { CELL, cellOf, keyOf } from './Grid';

/**
 * 大地图上点亮的路（ui/MapScreen）：每 512 米一块，把开过的格子里的路段串成一条 Path2D 缓存起来，那块有新格子亮了才重建。
 * 画法：先给整张地图的路压一层暗色，再画亮的路（一层宽的暖光、一层细的亮线）。
 */
const BLOCK = CELL * 16, PIECE = 8;

export class LitLayer {
  private cache = new Map<number, { path: Path2D; ver: number }>();
  constructor(private api: LightupApi) {}

  private block(bx: number, bz: number, ver: number): Path2D | null {
    const key = keyOf(bx, bz), hit = this.cache.get(key);
    if (hit && hit.ver === ver) return hit.path;
    const roads = this.api.roads();
    if (!roads) return null;
    const path = new Path2D(), vis = this.api.visited;
    const x0 = bx * BLOCK, z0 = bz * BLOCK, x1 = x0 + BLOCK, z1 = z0 + BLOCK;
    for (const ei of roads.blockEdges.get(key) ?? []) {
      const p = roads.net.edges[ei].p;
      let pen = false;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx2 = p[i + 2], bz2 = p[i + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx2 - ax, bz2 - az) / PIECE));
        for (let j = 0; j < n; j++) {
          const sx = ax + (bx2 - ax) * j / n, sz = az + (bz2 - az) * j / n, ex = ax + (bx2 - ax) * (j + 1) / n, ez = az + (bz2 - az) * (j + 1) / n;
          const mx = (sx + ex) / 2, mz = (sz + ez) / 2;
          const on = mx >= x0 && mx < x1 && mz >= z0 && mz < z1 && vis.has(keyOf(cellOf(mx), cellOf(mz)));
          if (on) { if (!pen) path.moveTo(sx, sz); path.lineTo(ex, ez); }
          pen = on;
        }
      }
    }
    this.cache.set(key, { path, ver });
    return path;
  }

  /** In world units (the map's transform set); `s` px per m. */
  draw(ctx: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number, s: number, bounds: { x0: number; z0: number; x1: number; z1: number }): void {
    ctx.fillStyle = 'rgba(8,10,12,0.5)';
    ctx.fillRect(bounds.x0, bounds.z0, bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
    const paths: Path2D[] = [];
    const bx0 = Math.floor(x0 / BLOCK), bx1 = Math.floor(x1 / BLOCK), bz0 = Math.floor(z0 / BLOCK), bz1 = Math.floor(z1 / BLOCK);
    for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
      const ver = this.api.blockVer.get(keyOf(bx, bz));
      if (ver === undefined) continue;
      const p = this.block(bx, bz, ver);
      if (p) paths.push(p);
    }
    if (!paths.length) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // widths in screen px: a thin bright line down the road at any zoom, in a soft glow
    ctx.strokeStyle = 'rgba(255,196,84,0.25)'; ctx.lineWidth = 9 / s;
    for (const p of paths) ctx.stroke(p);
    ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2.6 / s;
    for (const p of paths) ctx.stroke(p);
  }
}
