// Buildings beyond OSM for build.mjs (「尽量还原北京城的原貌」, 2026-09-29): the footprints OSM lacks and
// measured heights for the ones it has no height for, from .cache/buildings/ (fetch-buildings.py):
//   clsm.json    machine-learnt footprints (Shi et al. 2023, via Overture; CC BY 4.0)
//   globfp.json  3D-GloBFP heights (Che et al. 2024; CC BY 4.0)
//   cmab.json    CMAB heights, function and age (Zhang, Zhao & Long 2025; CC BY 4.0)
// The height sets are burnt into rasters over the play area (RES m cells, last polygon wins) and a
// building reads the cells its footprint covers - so a footprint from any source finds its height,
// whatever the other set's outlines look like (CMAB merges neighbours; the sets do not share ids).
import fs from 'node:fs';
import path from 'node:path';
import { project } from './region.mjs';

const DIR = path.resolve('.cache/buildings');
export const RES = 2.5;
export const available = () => fs.existsSync(path.join(DIR, 'clsm.json'));
const read = (f) => (fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : null);

/** A flat [lon, lat, ...] ring (from `off`) as [[x, z], ...] game metres. */
function ringOf(a, off = 0) {
  const r = [];
  for (let i = off; i + 1 < a.length; i += 2) r.push(project(a[i + 1], a[i]));
  return r;
}

/** Calls fn(cell) for every cell of the grid whose centre is inside the ring (scanline, even-odd). */
export function scan(g, ring, fn) {
  let z0 = Infinity, z1 = -Infinity;
  for (const [, z] of ring) { if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const zi0 = Math.max(0, Math.ceil((z0 - g.z0) / RES - 0.5)), zi1 = Math.min(g.nz - 1, Math.floor((z1 - g.z0) / RES - 0.5));
  const xs = [];
  for (let zi = zi0; zi <= zi1; zi++) {
    const zc = g.z0 + (zi + 0.5) * RES;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xa, za] = ring[i], [xb, zb] = ring[j];
      if ((za > zc) !== (zb > zc)) xs.push(xa + (zc - za) * (xb - xa) / (zb - za));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - g.x0) / RES - 0.5)), b = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / RES - 0.5));
      for (let xi = a; xi <= b; xi++) fn(xi + zi * g.nx);
    }
  }
}

/** The grid over [x0, z0, x1, z1]. */
export function grid(x0, z0, x1, z1) {
  const nx = Math.ceil((x1 - x0) / RES), nz = Math.ceil((z1 - z0) / RES);
  return { x0, z0, nx, nz, cell: (x, z) => { const xi = Math.floor((x - x0) / RES), zi = Math.floor((z - z0) / RES); return xi < 0 || zi < 0 || xi >= nx || zi >= nz ? -1 : xi + zi * nx; } };
}

/**
 * The height rasters: globfp and cmab heights in decimetres (0 = none), cmab function (code + 1) and
 * year (- 1900). `inBox(bb)` skips polygons that cannot touch the grid.
 */
export function heightRasters(g) {
  const n = g.nx * g.nz;
  const out = { globfp: new Uint16Array(n), cmab: new Uint16Array(n), fn: new Uint8Array(n), year: new Uint8Array(n), fnNames: [] };
  const touches = (ring) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, z] of ring) { if (x < a) a = x; if (x > c) c = x; if (z < b) b = z; if (z > d) d = z; }
    return c > g.x0 && a < g.x0 + g.nx * RES && d > g.z0 && b < g.z0 + g.nz * RES;
  };
  const gf = read('globfp.json');
  if (gf) for (const p of gf.p) {
    const ring = ringOf(p, 1);
    if (!touches(ring)) continue;
    const v = Math.min(65535, Math.round(p[0] * 10));
    scan(g, ring, (i) => { out.globfp[i] = v; });
  }
  const cm = read('cmab.json');
  if (cm) {
    out.fnNames = cm.fn;
    for (const p of cm.p) {
      const ring = ringOf(p, 3);
      if (!touches(ring)) continue;
      const v = Math.min(65535, Math.round(p[0] * 10)), f = p[1] + 1, y = p[2] ? Math.max(1, Math.min(255, p[2] - 1900)) : 0;
      scan(g, ring, (i) => { out.cmab[i] = v; out.fn[i] = f; out.year[i] = y; });
    }
  }
  return out;
}

const median = (a) => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[a.length >> 1]; };

/**
 * What the rasters say under a footprint: each set's median height (m) where it covers at least
 * `minCover` of the footprint (else 0), CMAB's most common function name and median year.
 */
export function sample(g, R, ring, c, minCover = 0.3) {
  const gf = [], cm = [], fc = new Map(), yr = [];
  let n = 0;
  const take = (i) => {
    n++;
    if (R.globfp[i]) gf.push(R.globfp[i]);
    if (R.cmab[i]) { cm.push(R.cmab[i]); fc.set(R.fn[i], (fc.get(R.fn[i]) ?? 0) + 1); if (R.year[i]) yr.push(R.year[i]); }
  };
  scan(g, ring, take);
  if (!n) { const i = g.cell(c[0], c[1]); if (i >= 0) take(i); }
  let fn = 0, best = 0;
  for (const [k, v] of fc) if (v > best) { best = v; fn = k; }
  return {
    globfp: n && gf.length >= minCover * n ? median(gf) / 10 : 0,
    cmab: n && cm.length >= minCover * n ? median(cm) / 10 : 0,
    fn: fn && best >= minCover * n ? R.fnNames[fn - 1] : '',
    year: yr.length ? median(yr) + 1900 : 0,
  };
}

/** The machine-learnt footprints (game metres) whose centroid passes `keep(x, z)`. */
export function clsmFootprints(keep) {
  const d = read('clsm.json');
  const out = [];
  if (!d) return out;
  for (const p of d.p) {
    const ring = ringOf(p);
    let sx = 0, sz = 0;
    for (const [x, z] of ring) { sx += x; sz += z; }
    const c = [sx / ring.length, sz / ring.length];
    if (keep(c[0], c[1])) out.push(ring);
  }
  return out;
}
