// Railways (铁路, 2026-10-02, step 4 of the plan): OSM's rail, light rail and subway tracks above ground
// inside the play area, into public/city/rail.json for city/visual/Railways.ts. Each way is one track
// (OSM draws one way per track), densified to DENSE m, with a height per point:
// - lifted to H (a rail bridge over a ground car road) or HV (a subway viaduct, or any long rail viaduct)
//   where OSM says bridge, down at G either side (max-plus over the track graph);
// - held on the ground where it crosses a car road with no bridge (a level crossing) or runs under a
//   road bridge, rising at most GS from there (min-plus) - so a ramp never stands in a road;
// the lower of the two wins. Elevated runs get piers off every carriageway at most SPAN apart, and a
// parapet on each side that has no other track beside it at its height.
// Run by build.mjs at its end; by hand: node scripts/city/railways.mjs
// Data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { TILE, project } from './region.mjs';

const DIR = path.resolve('public/city');
const OSM = path.resolve('.cache/osm');
const H = 7.6, HV = 9, G = 0.025, GS = 0.07, DENSE = 10, SPAN = 28, LONG = 80;
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;

const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const inPlay = (x, z) => man.regions.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);

// --- the tracks
const rails = [];
const seen = new Set();
for (const f of fs.readdirSync(OSM).filter((f) => /^chunk.*\.json$/.test(f))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(OSM, f), 'utf8')).elements) {
    if (e.type !== 'way' || !e.geometry || seen.has(e.id)) continue;
    const t = e.tags;
    if (!/^(rail|light_rail|subway)$/.test(t.railway ?? '') || (t.tunnel && t.tunnel !== 'no') || (t.layer && +t.layer < 0)) continue;
    seen.add(e.id);
    const P = e.geometry.map((g) => project(g.lat, g.lon));
    if (!P.some(([x, z]) => inPlay(x, z))) continue;
    // dense points, keyed by OSM node at the way's own vertices (where ways join)
    const pts = [], keys = [];
    for (let i = 0; i < P.length; i++) {
      if (i > 0) {
        const [ax, az] = P[i - 1], [bx, bz] = P[i], n = Math.ceil(Math.hypot(bx - ax, bz - az) / DENSE);
        for (let k = 1; k < n; k++) { pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); keys.push(`${e.id}:${i}:${k}`); }
      }
      pts.push(P[i]); keys.push(`n${e.nodes[i]}`);
    }
    let L = 0;
    for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const bridge = !!t.bridge && t.bridge !== 'no';
    rails.push({
      id: e.id, pts, keys, bridge, L,
      subway: t.railway !== 'rail',
      yard: /yard|siding|spur|crossover/.test(t.service ?? ''),
      viaduct: bridge && (t.railway !== 'rail' || t.bridge === 'viaduct' || +(t.layer ?? 0) >= 2) && L > LONG,
    });
  }
}

// --- the graph
const adj = new Map();
const link = (a, b, l) => { (adj.get(a) ?? adj.set(a, []).get(a)).push([b, l]); (adj.get(b) ?? adj.set(b, []).get(b)).push([a, l]); };
for (const r of rails) for (let i = 1; i < r.pts.length; i++) link(r.keys[i - 1], r.keys[i], Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));

// --- the roads they cross (tiles loaded on demand)
const tiles = new Map();
const roadsNear = (x, z) => {
  const out = [], ix = Math.floor(x / TILE), iz = Math.floor(z / TILE);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const k = `${ix + dx}_${iz + dz}`;
    if (!tiles.has(k)) tiles.set(k, man.tiles[k] ? JSON.parse(fs.readFileSync(path.join(DIR, `t_${k}.json`), 'utf8')).roads.filter((r) => CAR.test(r.c)) : []);
    out.push(...tiles.get(k));
  }
  return out;
};
const isect = (ax, az, bx, bz, cx, cz, dx, dz) => { const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (!d) return -1; const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : -1; };
const segDist = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };

const lift = new Map(), pin = new Set();
let nLift = 0, nLevel = 0, nUnder = 0;
for (const r of rails) {
  const top = r.subway ? HV : H;
  if (r.viaduct) for (const k of r.keys) lift.set(k, Math.max(lift.get(k) ?? 0, r.subway ? HV : H));
  // any point inside a ground carriageway: on the deck if this is a bridge, else on the ground
  for (let i = 0; i < r.pts.length; i++) {
    const [x, z] = r.pts[i];
    let inRoad = false;
    for (const q of roadsNear(x, z)) {
      for (let j = 0; j + 3 < q.p.length && !inRoad; j += 2) {
        if (q.h && Math.max(q.h[j / 2] ?? 0, q.h[j / 2 + 1] ?? 0) > 1) continue;
        if (segDist(x, z, q.p[j], q.p[j + 1], q.p[j + 2], q.p[j + 3]) < q.w / 2 + 1.5) inRoad = true;
      }
      if (inRoad) break;
    }
    if (!inRoad) continue;
    if (r.bridge) lift.set(r.keys[i], Math.max(lift.get(r.keys[i]) ?? 0, top));
    else pin.add(r.keys[i]);
  }
  for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
    for (const q of roadsNear((ax + bx) / 2, (az + bz) / 2)) {
      for (let j = 0; j + 3 < q.p.length; j += 2) {
        const u = isect(ax, az, bx, bz, q.p[j], q.p[j + 1], q.p[j + 2], q.p[j + 3]);
        if (u < 0) continue;
        const hr = q.h ? (q.h[j / 2] ?? 0) * (1 - u) + (q.h[j / 2 + 1] ?? 0) * u : 0;
        if (hr > 2) { pin.add(r.keys[i - 1]); pin.add(r.keys[i]); nUnder++; }
        else if (r.bridge) { for (const k of [r.keys[i - 1], r.keys[i]]) lift.set(k, Math.max(lift.get(k) ?? 0, top)); nLift++; }
        else { pin.add(r.keys[i - 1]); pin.add(r.keys[i]); nLevel++; }
      }
    }
  }
}

// --- heights: max-plus down from the lifts at G, min-plus up from the pins at GS, the lower wins
class Heap {
  a = [];
  constructor(less) { this.less = less; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
// A lift that the pins round it hold under 5 m cannot clear the road it is over (OSM draws the bridge
// ending right at a level crossing): it goes back to the ground, and the solve runs again.
let up, cap, demoted = 0;
for (let pass = 0; pass < 6; pass++) {
  up = new Map();
  {
    const h = new Heap((x, y) => x[1] > y[1]);
    for (const [k, v] of lift) { up.set(k, v); h.push([k, v]); }
    while (h.size) {
      const [k, v] = h.pop();
      if (v < (up.get(k) ?? 0)) continue;
      for (const [n, l] of adj.get(k) ?? []) { const w = v - G * l; if (w > 0.2 && w > (up.get(n) ?? 0)) { up.set(n, w); h.push([n, w]); } }
    }
  }
  cap = new Map();
  {
    const h = new Heap((x, y) => x[1] < y[1]);
    for (const k of pin) { cap.set(k, 0); h.push([k, 0]); }
    while (h.size) {
      const [k, v] = h.pop();
      if (v > (cap.get(k) ?? Infinity)) continue;
      for (const [n, l] of adj.get(k) ?? []) { const w = v + GS * l; if (w < HV + 1 && w < (cap.get(n) ?? Infinity)) { cap.set(n, w); h.push([n, w]); } }
    }
  }

  const low = [...lift.keys()].filter((k) => (cap.get(k) ?? Infinity) < 5);
  if (!low.length) break;
  for (const k of low) { lift.delete(k); pin.add(k); demoted++; }
}
const height = (k) => { const v = Math.min(up.get(k) ?? 0, cap.get(k) ?? Infinity); return v < 0.3 ? 0 : v; };

// --- parapets: a side with another track beside it at its height has none
const GRID = 20, grid = new Map();
const gk = (x, z) => `${Math.floor(x / GRID)}_${Math.floor(z / GRID)}`;
rails.forEach((r, ri) => { r.H = r.keys.map(height); for (let i = 1; i < r.pts.length; i++) { const k = gk((r.pts[i][0] + r.pts[i - 1][0]) / 2, (r.pts[i][1] + r.pts[i - 1][1]) / 2); (grid.get(k) ?? grid.set(k, []).get(k)).push([ri, i]); } });
const beside = (ri, x, z, h) => {
  const cx = Math.floor(x / GRID), cz = Math.floor(z / GRID);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [rj, j] of grid.get(`${cx + dx}_${cz + dz}`) ?? []) {
    if (rj === ri) continue;
    const r = rails[rj], [ax, az] = r.pts[j - 1], [bx, bz] = r.pts[j];
    if (segDist(x, z, ax, az, bx, bz) < 2 && Math.abs((r.H[j - 1] + r.H[j]) / 2 - h) < 1.5) return true;
  }
  return false;
};

// --- piers: under the elevated runs, off every ground carriageway
const offRoad = (x, z, m = 1) => !roadsNear(x, z).some((q) => { for (let j = 0; j + 3 < q.p.length; j += 2) { if (q.h && Math.max(q.h[j / 2] ?? 0, q.h[j / 2 + 1] ?? 0) > 2) continue; if (segDist(x, z, q.p[j], q.p[j + 1], q.p[j + 2], q.p[j + 3]) < q.w / 2 + m) return true; } return false; });

const q1 = (v) => Math.round(v * 10) / 10;
const out = [];
let elevated = 0, ground = 0, piers = 0;
for (let ri = 0; ri < rails.length; ri++) {
  const r = rails[ri];
  // only the stretch inside the play area (a margin of one segment)
  let a = 0, b = r.pts.length - 1;
  while (a < b && !inPlay(...r.pts[a + 1])) a++;
  while (b > a && !inPlay(...r.pts[b - 1])) b--;
  if (b - a < 1) continue;
  const P = r.pts.slice(a, b + 1), Hs = r.H.slice(a, b + 1);
  const rec = { k: r.subway ? 1 : r.yard ? 2 : 0, p: P.flatMap(([x, z]) => [q1(x), q1(z)]) };
  // per segment: 1 = parapet on the left, 2 = on the right (where the deck is up), 4 = on the ground in a
  // carriageway (a level crossing: the rails are set in the road, no ballast bed)
  const e = [];
  for (let i = 1; i < P.length; i++) {
    if (Hs[i - 1] > 0 || Hs[i] > 0) { e.push(0); continue; }
    const [ax, az] = P[i - 1], [bx, bz] = P[i];
    let inRoad = false;
    for (let t = 0; t <= 1 && !inRoad; t += 0.25) inRoad = !offRoad(ax + (bx - ax) * t, az + (bz - az) * t, -0.5);
    e.push(inRoad ? 4 : 0);
  }
  if (e.some(Boolean)) rec.e = e;
  if (Hs.some((h) => h > 0)) {
    rec.h = Hs.map(q1);
    rec.e = e;
    for (let i = 1; i < P.length; i++) {
      const hm = (Hs[i - 1] + Hs[i]) / 2;
      if (hm <= 0.3) continue;
      rec.e[i - 1] = 0;
      const [ax, az] = P[i - 1], [bx, bz] = P[i], L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      rec.e[i - 1] = (beside(ri, mx + nx * 4.2, mz + nz * 4.2, hm) ? 0 : 1) | (beside(ri, mx - nx * 4.2, mz - nz * 4.2, hm) ? 0 : 2);
    }
    // piers: walk the run, one at most SPAN on from the last where the deck's underside clears 1 m
    rec.q = [];
    let S = 0, last = -Infinity;
    for (let i = 1; i < P.length; i++) {
      const [ax, az] = P[i - 1], [bx, bz] = P[i], L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 2) {
        const t = s / L, h = Hs[i - 1] + (Hs[i] - Hs[i - 1]) * t;
        if (h - 1.3 < 1) { last = S + s; continue; }   // low: the deck is on its own wall
        if (S + s - last < SPAN) continue;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (!offRoad(x, z)) continue;
        rec.q.push(q1(x), q1(z), q1(h)); last = S + s; piers++;
      }
      S += L;
    }
    elevated++;
  } else ground++;
  out.push(rec);
}
// Smaller on the wire (2026-10-02: 1.5 MB / 466 KB compressed held up the boot on a slow link): each
// track simplified (Douglas-Peucker, 0.25 m in plan and 0.1 m in height, keeping every point where the
// segment flags change), then written in decimetres as deltas. Railways.ts `decodeRail` reads it back.
function simplify(rec) {
  const n = rec.p.length / 2, keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  if (rec.e) for (let i = 1; i < n - 1; i++) if (rec.e[i - 1] !== rec.e[i]) keep[i] = 1;
  const X = (i) => rec.p[2 * i], Z = (i) => rec.p[2 * i + 1], Hh = (i) => rec.h?.[i] ?? 0;
  const dp = (a, b) => {
    let worst = -1, wi = -1;
    const ax = X(a), az = Z(a), bx = X(b), bz = Z(b), L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((X(i) - ax) * (bx - ax) + (Z(i) - az) * (bz - az)) / L2));
      const d = Math.hypot(X(i) - ax - (bx - ax) * t, Z(i) - az - (bz - az) * t) / 0.25 + Math.abs(Hh(i) - (Hh(a) + (Hh(b) - Hh(a)) * t)) / 0.1;
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > 1) { keep[wi] = 1; dp(a, wi); dp(wi, b); }
  };
  let a = 0;
  for (let i = 1; i < n; i++) if (keep[i]) { dp(a, i); a = i; }
  const idx = [...keep.keys()].filter((i) => keep[i]);
  const outRec = { k: rec.k, p: idx.flatMap((i) => [X(i), Z(i)]) };
  if (rec.h) outRec.h = idx.map((i) => rec.h[i]);
  // a kept segment takes the flags of the first original segment it covers
  if (rec.e) outRec.e = idx.slice(0, -1).map((i) => rec.e[i]);
  if (rec.q) outRec.q = rec.q;
  return outRec;
}
const dm = (v) => Math.round(v * 10);
const delta = (arr, stride) => { const o = []; const prev = new Array(stride).fill(0); for (let i = 0; i < arr.length; i++) { const v = dm(arr[i]); o.push(v - prev[i % stride]); prev[i % stride] = v; } return o; };
let before = 0, after = 0;
const packed = out.map((rec) => {
  const r = simplify(rec);
  before += rec.p.length / 2; after += r.p.length / 2;
  const o = { k: r.k, p: delta(r.p, 2) };
  if (r.h) o.h = delta(r.h, 1);
  if (r.e && r.e.some(Boolean)) o.e = r.e;
  if (r.q && r.q.length) o.q = delta(r.q, 3);
  return o;
});
console.log(`railways: ${before} points simplified to ${after}`);
const json = JSON.stringify({ v: 2, r: packed });
fs.writeFileSync(path.join(DIR, 'rail.json'), json);
console.log(`railways: ${demoted} lifted points back on the ground; ${out.reduce((a, r) => a + (r.e ? r.e.filter((v) => v & 4).length : 0), 0)} segments set in a road; ${out.length} tracks (${elevated} with a raised stretch, ${ground} on the ground), ${nLift} bridge crossings over roads, ${nLevel} level crossings, ${nUnder} under road bridges, ${piers} piers, ${(json.length / 1e6).toFixed(1)} MB`);
