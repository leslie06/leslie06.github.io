// Where street life happens (life/, P2 of the NPC plan): open ground in the squares and parks, found in the
// tiles just written and baked into public/city/sites.json so the game spends nothing looking.
//   square  room for a 广场舞 formation (a disc of CLEAR.square m with nothing in it: no tree, lamp, building,
//           wall, carriageway or water), in a plaza or a park, at least SPACING.square m from the next
//   park    room for tai chi, a chess table or bird cages (CLEAR.park m), in a park, plaza or green; with the
//           nearest tree within 7 m when there is one (the bird cages hang from it)
// Each is the most open point of its polygon (sampled on a grid), the polygon's own edge counting as an
// obstacle (they stay inside it). Format: { v: 1, square: [[x, z, r], ...], park: [[x, z, r, treeX, treeZ], ...] }
// with r the clearance found (m, one decimal). Run by build.mjs at its end; by hand: node scripts/city/sites.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TILE } from './region.mjs';

const DIR = path.resolve('public/city');
const CLEAR = { square: 6.5, park: 3.6 };
const SPACING = { square: 140, park: 70 };
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;

const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const tiles = new Map();
const tileAt = (ix, iz) => {
  const k = `${ix}_${iz}`;
  if (!tiles.has(k)) tiles.set(k, man.tiles[k] ? JSON.parse(fs.readFileSync(path.join(DIR, `t_${k}.json`), 'utf8')) : null);
  return tiles.get(k);
};
const pip = (x, z, o) => { let c = false; for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) if ((o[i + 1] > z) !== (o[j + 1] > z) && x < (o[j] - o[i]) * (z - o[i + 1]) / (o[j + 1] - o[i + 1]) + o[i]) c = !c; return c; };
const segDist = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
const ringDist = (x, z, o) => { let d = Infinity; for (let i = 0; i < o.length; i += 2) { const j = (i + 2) % o.length; d = Math.min(d, segDist(x, z, o[i], o[i + 1], o[j], o[j + 1])); } return d; };
const area = (o) => { let a = 0; for (let i = 0; i < o.length; i += 2) { const j = (i + 2) % o.length; a += o[i] * o[j + 1] - o[j] * o[i + 1]; } return Math.abs(a / 2); };

/**
 * Obstacles near a tile, all in an 8 m hash: points (trees, lamps) with a radius, segments with a half width
 * (carriageways, walls) and rings (buildings, water) registered in every cell their box touches.
 */
const C8 = 8;
function obstacles(ix, iz) {
  const pts = new Map(), segs = [], rings = [], sCells = new Map(), rCells = new Map();
  const cell = (m, x, z) => { const k = `${x}_${z}`; let a = m.get(k); if (!a) m.set(k, a = []); return a; };
  const put = (x, z, r) => cell(pts, Math.floor(x / C8), Math.floor(z / C8)).push(x, z, r);
  const span = (m, id, x0, z0, x1, z1) => { for (let i = Math.floor(x0 / C8); i <= Math.floor(x1 / C8); i++) for (let j = Math.floor(z0 / C8); j <= Math.floor(z1 / C8); j++) cell(m, i, j).push(id); };
  const seg = (ax, az, bx, bz, hw) => { const id = segs.length; segs.push(ax, az, bx, bz, hw); span(sCells, id, Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw); };
  const ring = (o, m) => {
    const id = rings.length; rings.push(o, m);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) { x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); z0 = Math.min(z0, o[i + 1]); z1 = Math.max(z1, o[i + 1]); }
    span(rCells, id, x0 - m, z0 - m, x1 + m, z1 + m);
  };
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const t = tileAt(ix + dx, iz + dz);
    if (!t) continue;
    for (let i = 0; i < t.trees.length; i += 4) put(t.trees[i], t.trees[i + 1], 1.1);
    for (let i = 0; i < t.lamps.length; i += 3) put(t.lamps[i], t.lamps[i + 1], 0.6);
    for (const r of t.roads) {
      if (!CAR.test(r.c) || r.h?.some((h) => h < -0.5)) continue;
      for (let i = 2; i < r.p.length; i += 2) seg(r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1], r.w / 2 + 1.2);
    }
    for (const b of t.buildings) {
      if (b.k === 'wall') { for (let i = 2; i < b.o.length; i += 2) seg(b.o[i - 2], b.o[i - 1], b.o[i], b.o[i + 1], 0.8); }
      else ring(b.o, 1.5);
    }
    for (const a of t.areas) if (a.k === 'water' || a.k === 'rail' || a.k === 'site') ring(a.o, 1);
  }
  return { pts, segs, rings, sCells, rCells };
}

/** How far from (x, z) the nearest obstacle is (0 inside one), looking no further than `cap`. */
let stamp = 0;
const seenS = new Int32Array(1 << 22), seenR = new Int32Array(1 << 22);
function clearance(O, x, z, cap) {
  let d = cap;
  stamp++;
  const r = Math.ceil(cap / C8), cx = Math.floor(x / C8), cz = Math.floor(z / C8);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const k = `${cx + i}_${cz + j}`;
    const a = O.pts.get(k);
    if (a) for (let q = 0; q < a.length; q += 3) d = Math.min(d, Math.hypot(a[q] - x, a[q + 1] - z) - a[q + 2]);
    const sc = O.sCells.get(k);
    if (sc) for (const id of sc) { if (seenS[id / 5 % seenS.length] === stamp) continue; seenS[id / 5 % seenS.length] = stamp; const s = O.segs; d = Math.min(d, segDist(x, z, s[id], s[id + 1], s[id + 2], s[id + 3]) - s[id + 4]); }
    const rc = O.rCells.get(k);
    if (rc) for (const id of rc) {
      if (seenR[id / 2 % seenR.length] === stamp) continue; seenR[id / 2 % seenR.length] = stamp;
      const o = O.rings[id];
      if (pip(x, z, o)) return 0;
      d = Math.min(d, ringDist(x, z, o) - O.rings[id + 1]);
    }
    if (d <= 0) return 0;
  }
  return Math.max(0, d);
}

const out = { square: [], park: [] };
const tooClose = (list, x, z, sp) => list.some((s) => Math.hypot(s[0] - x, s[1] - z) < sp);
let polys = 0, t0 = Date.now();
for (const key of Object.keys(man.tiles).sort((a, b) => { const [ax, az] = a.split('_').map(Number), [bx, bz] = b.split('_').map(Number); return ax - bx || az - bz; })) {
  const [ix, iz] = key.split('_').map(Number);
  const t = tileAt(ix, iz);
  const cands = t.areas.filter((a) => a.k === 'plaza' || a.k === 'park' || a.k === 'grass' || a.k === 'lawn');
  if (!cands.length) continue;
  let O = null;
  for (const a of cands) {
    const A = area(a.o);
    if (A < 120) continue;
    polys++;
    O ??= obstacles(ix, iz);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < a.o.length; i += 2) { x0 = Math.min(x0, a.o[i]); x1 = Math.max(x1, a.o[i]); z0 = Math.min(z0, a.o[i + 1]); z1 = Math.max(z1, a.o[i + 1]); }
    const step = Math.max(3, Math.sqrt(A / 300));
    let best = null;
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
      if (!pip(x, z, a.o) || a.hs?.some((h) => pip(x, z, h))) continue;
      const edge = ringDist(x, z, a.o) + 1.5;   // a little over the edge is fine (paths, verges round a plaza)
      const c = Math.min(edge, clearance(O, x, z, Math.min(12, edge)));
      if (!best || c > best[2]) best = [x, z, c];
    }
    if (!best) continue;
    const [x, z, c] = best;
    if ((a.k === 'plaza' || a.k === 'park') && c >= CLEAR.square && !tooClose(out.square, x, z, SPACING.square)) out.square.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(c * 10) / 10]);
    else if (a.k !== 'lawn' && c >= CLEAR.park && !tooClose(out.park, x, z, SPACING.park)) {
      // the nearest tree within 7 m (a bird cage hangs from it)
      let tx = NaN, tz = NaN, td = 7;
      for (let i = 0; i < t.trees.length; i += 4) { const d = Math.hypot(t.trees[i] - x, t.trees[i + 1] - z); if (d < td) { td = d; tx = t.trees[i]; tz = t.trees[i + 1]; } }
      out.park.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(c * 10) / 10, ...(Number.isFinite(tx) ? [Math.round(tx * 10) / 10, Math.round(tz * 10) / 10] : [])]);
    }
  }
  // memory: keep the last few hundred tiles (walking in order, the neighbours are among them)
  while (tiles.size > 300) tiles.delete(tiles.keys().next().value);
}
fs.writeFileSync(path.join(DIR, 'sites.json'), JSON.stringify({ v: 1, ...out }));
console.log(`sites: ${out.square.length} squares, ${out.park.length} park spots from ${polys} polygons in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
