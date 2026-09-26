// Turn the cached OSM chunks (.cache/osm, from fetch-osm.mjs) into the streamed city the game loads:
//   public/city/manifest.json   bounds, tile index, spawn, named places
//   public/city/network.json    drivable road graph (traffic, GPS, minimap)
//   public/city/t_<ix>_<iz>.json one 256 m tile: road pieces, buildings, ground areas, trees, lamps,
//                                signals, crossings, bus stops
// Local metres, +X east, +Z south (region.mjs). Outer rings have positive signed area in (x, z),
// holes negative. Data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { BBOX, TILE, project } from './region.mjs';

const RAW = path.resolve('.cache/osm');
const OUT = path.resolve('public/city');

// ---------------------------------------------------------------------------------- load
const els = new Map();
for (const f of fs.readdirSync(RAW).filter((f) => /^chunk-\d+-\d+\.json$/.test(f))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')).elements) els.set(e.type[0] + e.id, e);
}
const ways = [], rels = [], nodes = [];
for (const e of els.values()) (e.type === 'way' ? ways : e.type === 'relation' ? rels : nodes).push(e);

// ---------------------------------------------------------------------------------- helpers
function hash32(a) { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const rnd = (id, salt = 0) => hash32(((id % 4294967296) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
const proj = (g) => g.map((p) => project(p.lat, p.lon));
const q1 = (v) => Math.round(v * 10) / 10;
const flat = (r) => r.flatMap(([x, z]) => [q1(x), q1(z)]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
function signedArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function centroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const c = p[0] * q[1] - q[0] * p[1]; a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c; }
  if (Math.abs(a) < 1e-6) { const n = r.length; return [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * a), cz / (3 * a)];
}
const openRing = (r) => (r.length > 1 && eq(r[0], r[r.length - 1]) ? r.slice(0, -1) : r);
function pip(x, z, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function bboxOf(r) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; }
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); }
/** Drop duplicate and nearly collinear vertices (keeps shapes, shrinks hutong-heavy tiles a lot). */
function simplifyRing(r, tol = 0.25) {
  let out = r.filter((p, i) => !eq(p, r[(i + 1) % r.length]));
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (segDist(b[0], b[1], a[0], a[1], c[0], c[1]) < tol) { out.splice(i, 1); changed = true; i--; }
    }
  }
  return out;
}
/** Oriented bounding box by trying every edge direction: centre, angle of the long axis, half sizes. */
function obb(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of r) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const areaB = (u1 - u0) * (v1 - v0);
    if (!best || areaB < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      let hu = (u1 - u0) / 2, hv = (v1 - v0) / 2, angle = ang;
      if (hv > hu) { [hu, hv] = [hv, hu]; angle += Math.PI / 2; }
      best = { area: areaB, cx: cu * c - cv * s, cz: cu * s + cv * c, angle, hl: hu, hw: hv };
    }
  }
  return best;
}
/** Stitch multipolygon member ways into closed rings. */
function assemble(lines) {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice()), rings = [];
  while (pool.length) {
    let cur = pool.shift(), guard = 0;
    while (!eq(cur[0], cur[cur.length - 1]) && guard++ < 2000) {
      const end = cur[cur.length - 1];
      let k = pool.findIndex((p) => eq(p[0], end)), rev = false;
      if (k < 0) { k = pool.findIndex((p) => eq(p[p.length - 1], end)); rev = true; }
      if (k < 0) break;
      const p = pool.splice(k, 1)[0];
      cur = cur.concat((rev ? p.reverse() : p).slice(1));
    }
    if (eq(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(openRing(cur));
  }
  return rings;
}
/** Sutherland–Hodgman against an axis-aligned rectangle (fine for concave subjects). */
function clipRing(r, x0, z0, x1, z1) {
  let out = r;
  for (const [ax, val, ge] of [[0, x0, true], [0, x1, false], [1, z0, true], [1, z1, false]]) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const ia = ge ? a[ax] >= val : a[ax] <= val, ib = ge ? b[ax] >= val : b[ax] <= val;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (val - a[ax]) / (b[ax] - a[ax]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!out.length) break;
  }
  return out;
}
function parseLen(v) {
  if (v === undefined || v === null) return NaN;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) * (/ft|'/.test(String(v)) ? 0.3048 : 1) : NaN;
}
const COLOURS = { white: '#e9e7e1', grey: '#9a9a96', gray: '#9a9a96', lightgrey: '#c4c3bd', lightgray: '#c4c3bd', darkgrey: '#5e5e5b', darkgray: '#5e5e5b', silver: '#b8bbbd',
  red: '#a8342b', darkred: '#7a2620', maroon: '#6e2a24', brown: '#7b5a44', beige: '#d8c9a6', tan: '#c8ad84', yellow: '#d9b440', gold: '#c9a13a', orange: '#d0782f',
  blue: '#4d6f9a', lightblue: '#9fb9cf', navy: '#2d3f62', green: '#4f7a4a', darkgreen: '#2f4d2e', black: '#2a2a2a', pink: '#d7a3a3', cream: '#eee4c8', ivory: '#eee9d8' };
function colour(v) {
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return COLOURS[s.replace(/[\s_-]/g, '')];
}

// ---------------------------------------------------------------------------------- region & tiles
const [RX0, RZ0] = project(BBOX.n, BBOX.w);
const [RX1, RZ1] = project(BBOX.s, BBOX.e);
const inRegion = (x, z) => x >= RX0 && x <= RX1 && z >= RZ0 && z <= RZ1;
const tiles = new Map();
const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
function tile(ix, iz) {
  const k = `${ix}_${iz}`;
  let t = tiles.get(k);
  if (!t) { t = { ix, iz, roads: [], buildings: [], areas: [], trees: [], lamps: [], signals: [], crossings: [], stops: [] }; tiles.set(k, t); }
  return t;
}
function eachTile(bb, fn) {
  const [a, b] = tileOf(Math.max(bb[0], RX0), Math.max(bb[1], RZ0)), [c, d] = tileOf(Math.min(bb[2], RX1), Math.min(bb[3], RZ1));
  for (let ix = a; ix <= c; ix++) for (let iz = b; iz <= d; iz++) fn(ix, iz);
}

// ---------------------------------------------------------------------------------- zones
function findPolygon(pred) {
  for (const w of ways) if (w.tags && pred(w.tags) && w.geometry && eq(w.geometry[0] && [w.geometry[0].lat, w.geometry[0].lon], [w.geometry.at(-1).lat, w.geometry.at(-1).lon])) return openRing(proj(w.geometry));
  for (const r of rels) if (r.tags && pred(r.tags)) { const rings = assemble(r.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => proj(m.geometry))); if (rings.length) return rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0]; }
  return null;
}
const templePoly = findPolygon((t) => /^天坛(公园)?$/.test(t.name || '') && (t.leisure || t.tourism || t.historic || t.landuse || t.amenity));
const palacePoly = findPolygon((t) => /^(故宫|故宫博物院|紫禁城)$/.test(t.name || ''));
console.log('zones: temple', !!templePoly, 'palace', !!palacePoly);
// Without an OSM palace polygon, the imperial core by box. OSM (WGS-84) puts the Tiananmen gate at
// x = -544, not at the map origin (a GCJ-02 point ~540 m east), so the box follows the OSM axis:
// the Forbidden City walls (z -1420..-420) plus the gate precinct with 太庙, 社稷坛 and the reviewing
// stands either side of the gate (z to 225, Chang'an Avenue's north kerb).
function zone(x, z) {
  if (palacePoly ? pip(x, z, palacePoly) : x > -940 && x < -150 && z > -1420 && z < 225) return 'palace';
  if (templePoly && pip(x, z, templePoly)) return 'temple';
  if (x > 4650 && x < 6500 && z > -1650 && z < 750) return 'cbd';
  if (x < 2850) return 'old';
  return 'city';
}

// ---------------------------------------------------------------------------------- roads
const ROAD = {
  motorway: [12, 24], motorway_link: [7, 9], trunk: [12, 22], trunk_link: [7, 9], primary: [13, 22], primary_link: [7, 9],
  secondary: [10, 16], secondary_link: [6, 8], tertiary: [8, 12], tertiary_link: [6, 8], unclassified: [6, 8], residential: [5.5, 7],
  living_street: [4.5, 5], service: [4, 5], busway: [7, 9],
  pedestrian: [6, 6], footway: [2.5, 2.5], cycleway: [2.5, 2.5], path: [2, 2], steps: [2.5, 2.5], track: [3, 3],
};
const CAR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'busway']);
function roadInfo(t) {
  const cls = t.highway, R = ROAD[cls];
  if (!R || t.area === 'yes') return null;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') return null;
  if (Number(t.layer) < 0 && !(t.bridge && t.bridge !== 'no')) return null;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || cls === 'motorway' ? 1 : t.oneway === '-1' ? -1 : 0;
  const lanes = parseInt(t.lanes, 10);
  let w = parseLen(t.width);
  if (!(w > 1.5)) w = lanes > 0 && CAR.has(cls) ? lanes * 3.3 + (oneway ? 1 : 1.5) : R[oneway ? 0 : 1];
  return { cls, w, oneway, lanes: lanes > 0 ? lanes : 0, car: CAR.has(cls), name: t.name || '', bridge: t.bridge && t.bridge !== 'no' ? 1 : 0 };
}
const degAll = new Map(), degCar = new Map();
for (const w of ways) {
  const info = w.tags && roadInfo(w.tags);
  if (!info || !w.geometry || w.geometry.length < 2) continue;
  w._road = info;
  w._pts = proj(w.geometry);
  w._ids = w.nodes.slice();
  if (info.oneway === -1) { w._pts.reverse(); w._ids.reverse(); info.oneway = 1; }
  w._ids.forEach((id, i) => {
    const d = i === 0 || i === w._ids.length - 1 ? 1 : 2;
    degAll.set(id, (degAll.get(id) || 0) + d);
    if (info.car) degCar.set(id, (degCar.get(id) || 0) + d);
  });
}
// ---------------------------------------------------------------------------------- elevation (立交)
// OSM draws an interchange flat, with `bridge=yes` and `layer` on the parts that pass over. A car
// bridge that crosses another kept road (or a railway) is lifted: DECK metres over whatever it
// crosses (so a layer-2 flyover over a layer-1 one sits at 13 m), flat along its whole way. The
// ways joined to it ramp down at GRADE until they reach the ground; the road it crosses is pinned
// at 0 for PIN metres round the crossing, and nothing may climb faster than STEEP from a pinned
// point (a slip road too short for GRADE gets steeper instead of lifting the road below into the
// deck). Bridges over water stay flat. Heights are solved on the ways' points every <= 10 m and
// written as `h` (per point) on road pieces and network edges; lamps and trees are kept off the decks.
const DECK = 6.5, GRADE = 0.06, STEEP = 0.12, PIN = 35;
const isBridgeT = (t) => t.bridge && t.bridge !== 'no';
const layerOf = (t) => { const n = parseInt(t.layer, 10); return Number.isFinite(n) ? n : isBridgeT(t) ? 1 : 0; };
const carWays = ways.filter((w) => w._road?.car);
const ECELL = 64, ekey = (ix, iz) => `${ix},${iz}`;
function gridOf(list) {
  const g = new Map();
  for (const it of list) for (let i = 1; i < it.p.length; i++) {
    const [ax, az] = it.p[i - 1], [bx, bz] = it.p[i];
    for (let ix = Math.floor(Math.min(ax, bx) / ECELL); ix <= Math.floor(Math.max(ax, bx) / ECELL); ix++)
      for (let iz = Math.floor(Math.min(az, bz) / ECELL); iz <= Math.floor(Math.max(az, bz) / ECELL); iz++) (g.get(ekey(ix, iz)) ?? g.set(ekey(ix, iz), []).get(ekey(ix, iz))).push([it, i]);
  }
  return g;
}
function segX(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}
/** Everything in `grid` that `w`'s polyline properly crosses: [{ it, x, z }]. */
function crossings(w, grid) {
  const out = [], seen = new Set();
  for (let i = 1; i < w._pts.length; i++) {
    const a = w._pts[i - 1], b = w._pts[i];
    for (let ix = Math.floor(Math.min(a[0], b[0]) / ECELL); ix <= Math.floor(Math.max(a[0], b[0]) / ECELL); ix++)
      for (let iz = Math.floor(Math.min(a[1], b[1]) / ECELL); iz <= Math.floor(Math.max(a[1], b[1]) / ECELL); iz++)
        for (const [it, k] of grid.get(ekey(ix, iz)) ?? []) {
          if (it.w === w) continue;
          const x = segX(a, b, it.p[k - 1], it.p[k]);
          if (!x) continue;
          const key = `${it.id}:${Math.round(x[0])},${Math.round(x[1])}`;
          if (seen.has(key)) continue;
          seen.add(key); out.push({ it, x: x[0], z: x[1] });
        }
  }
  return out;
}
const carGrid = gridOf(carWays.map((w) => ({ w, id: w.id, p: w._pts })));
const railGrid = gridOf(ways.filter((w) => w.tags?.railway && ['rail', 'light_rail', 'subway'].includes(w.tags.railway) && !(w.tags.tunnel && w.tags.tunnel !== 'no') && !isBridgeT(w.tags) && w.geometry).map((w) => ({ w, id: w.id, p: proj(w.geometry) })));
const waterGrid = gridOf(ways.filter((w) => (w.tags?.waterway && ['river', 'canal', 'stream', 'drain', 'ditch'].includes(w.tags.waterway)) && w.geometry).map((w) => ({ w, id: w.id, p: proj(w.geometry) })));
/** Whether ways a and b share a node within r m of (x, z): a T-junction whose lines overshoot by a few
 * metres "crosses" in plan, and treating that as a bridge over the road pinned the road under it and
 * dragged the bridge down to 1.2 m over it (建国门桥's side road onto 东二环). */
const sharesNear = (a, b, x, z, r) => { for (let i = 0; i < a._ids.length; i++) if (b._ids.includes(a._ids[i]) && Math.hypot(a._pts[i][0] - x, a._pts[i][1] - z) < r) return true; return false; };
const lifted = new Map(); // way -> { H, over: [{ o, x, z }] }
const overOf = new Map();
for (const w of carWays) {
  if (!isBridgeT(w.tags)) continue;
  const L = layerOf(w.tags);
  const over = crossings(w, carGrid).filter(({ it, x, z }) => (!isBridgeT(it.w.tags) || layerOf(it.w.tags) < L) && !sharesNear(w, it.w, x, z, 40)).map(({ it, x, z }) => ({ o: it.w, x, z }));
  const rail = crossings(w, railGrid).length > 0;
  if (over.length || rail) overOf.set(w, { over, rail });
}
// Heights over what they cross, lowest layer first so a flyover over a flyover stacks.
for (const [w, c] of [...overOf].sort((a, b) => layerOf(a[0].tags) - layerOf(b[0].tags))) {
  let H = DECK;
  for (const { o } of c.over) if (lifted.has(o)) H = Math.max(H, lifted.get(o).H + DECK);
  lifted.set(w, { H, over: c.over });
}
// Bridge ways that cross nothing but join a lifted one (the rest of a viaduct), unless over water.
const byNode = new Map();
for (const w of carWays) for (const id of [w._ids[0], w._ids.at(-1)]) (byNode.get(id) ?? byNode.set(id, []).get(id)).push(w);
for (let changed = true; changed;) {
  changed = false;
  for (const w of carWays) {
    if (lifted.has(w) || !isBridgeT(w.tags) || layerOf(w.tags) < 1) continue;
    let H = 0;
    for (const id of [w._ids[0], w._ids.at(-1)]) for (const o of byNode.get(id) ?? []) if (lifted.has(o)) H = Math.max(H, lifted.get(o).H);
    if (!H || crossings(w, waterGrid).length) continue;
    lifted.set(w, { H, over: [] }); changed = true;
  }
}
// Decks that cross each other with no node shared near the crossing are a deck apart - the higher
// layer over the lower, then the one already higher, then the bigger road - and the spans joined to a
// raised one follow it; round again until nothing moves. A span joined to a viaduct only after the
// layers were stacked was left at 6.5 m, and 朝阳路 and 东四环 crossed each other on the level in the
// air, a junction 6.5 m up with nothing to turn into.
const CLASS_RANK = ['service', 'living_street', 'residential', 'unclassified', 'tertiary_link', 'tertiary', 'secondary_link', 'secondary', 'primary_link', 'primary', 'busway', 'trunk_link', 'trunk', 'motorway_link', 'motorway'];
const deckX = [];
{
  const g = gridOf([...lifted.keys()].map((w) => ({ w, id: w.id, p: w._pts })));
  for (const [w] of lifted) for (const { it, x, z } of crossings(w, g)) if (w.id < it.w.id && !sharesNear(w, it.w, x, z, 40)) deckX.push([w, it.w]);
}
let stacked = 0;
for (let iter = 0; iter < 8; iter++) {
  let changed = false;
  for (const [a, b] of deckX) {
    const A = lifted.get(a), B = lifted.get(b);
    const key = (w, L) => [layerOf(w.tags), L.H, CLASS_RANK.indexOf(w._road.cls), -w.id];
    const ka = key(a, A), kb = key(b, B);
    let aOver = false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) { aOver = ka[i] > kb[i]; break; }
    const [hi, lo] = aOver ? [A, B] : [B, A];
    if (hi.H < lo.H + DECK) { hi.H = lo.H + DECK; changed = true; stacked++; }
  }
  for (const [w, L] of lifted) if (!L.over.length) for (const id of [w._ids[0], w._ids.at(-1)]) for (const o of byNode.get(id) ?? []) {
    const H = lifted.get(o)?.H ?? 0;
    if (H > L.H) { L.H = H; changed = true; }
  }
  if (!changed) break;
}
// Dense points on every car way (the OSM nodes keep their ids, so ways meet), and the graph.
const LB = new Map(), pinned = new Set(), adj = new Map();
const link = (a, b, d) => { (adj.get(a) ?? adj.set(a, []).get(a)).push([b, d]); (adj.get(b) ?? adj.set(b, []).get(b)).push([a, d]); };
for (const w of carWays) {
  const D = [];
  for (let i = 0; i < w._pts.length; i++) {
    if (i > 0) {
      const [ax, az] = w._pts[i - 1], [bx, bz] = w._pts[i], L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 10), s0 = D.at(-1).s;
      for (let k = 1; k < n; k++) D.push({ key: `${w.id}_${i}_${k}`, x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, s: s0 + L * k / n });
      D.push({ key: String(w._ids[i]), x: bx, z: bz, s: s0 + L });
    } else D.push({ key: String(w._ids[0]), x: w._pts[0][0], z: w._pts[0][1], s: 0 });
  }
  for (let i = 1; i < D.length; i++) link(D[i - 1].key, D[i].key, D[i].s - D[i - 1].s);
  for (const d of D) { d.x0 = d.x; d.z0 = d.z; }
  w._dense = D;
  const lf = lifted.get(w);
  if (lf) for (const d of D) LB.set(d.key, Math.max(LB.get(d.key) ?? 0, lf.H));
}
for (const [, lf] of lifted) for (const { o, x, z } of lf.over) if (!lifted.has(o)) for (const d of o._dense) if (Math.hypot(d.x - x, d.z - z) < PIN) pinned.add(d.key);
// A road that ends with nothing on (a bridge cut off at the edge of the data) comes down to the ground
// before it ends, rather than stopping 6.5 m up in the air.
const deadEnds = new Set();
for (const w of carWays) for (const id of [w._ids[0], w._ids.at(-1)]) if ((degCar.get(id) || 0) <= 1) deadEnds.add(String(id));
for (const k of deadEnds) pinned.add(k);
// A slip road leaving or joining a deck runs alongside it, overlapping, for a while: it stays at the
// deck's height until it is clear of it, and only then ramps down. Before this it started down from
// the shared node, was 2 m under the deck's edge where they overlapped, and the parapets closed the
// merge on 东三环 (the car stuck between the ramp's and the deck's).
const waysAt = new Map();
for (const w of carWays) for (const id of w._ids) (waysAt.get(id) ?? waysAt.set(id, []).get(id)).push(w);
const polyDist = (P, x, z) => { let m = Infinity; for (let i = 1; i < P.length; i++) m = Math.min(m, segDist(x, z, P[i - 1][0], P[i - 1][1], P[i][0], P[i][1])); return m; };
// Roads that meet and overlap are one surface: from every node two car ways share, each is tied to the
// other (a zero-length edge in the height graph, to the other's nearest point) for as long as it is
// inside the other's carriageway - a slip road leaving a deck, a street's mouth in a junction box, the
// two ways of a fork. Heights, pins and the limits on slopes all pass through the ties, so a merge is
// never a step and a junction never a wall, whichever way the slopes run - replacing three rules that
// each raised the lower road to the higher after the fact (the side road beside 天坛东路 went up to
// 5.9 m, down to 2.4 and back up to 3.5 on its way to a junction the main line reached at 1.2 m).
let deckPts = null;
const MERGE = !process.env.NO_MERGE;
let ties = 0, inserted = 0;
/**
 * The point of way W nearest (x, z), as a height-graph node: a dense point within 0.6 m of it, or a new one
 * spliced in there. Ties go to the very spot across, not the nearest dense point up to 5 m along - on a 6%
 * ramp that left two tied roads 0.3 m apart between their points, and the parapets across the merges.
 */
function denseAt(W, x, z) {
  const D = W._dense;
  let bj = 0, bt = 0, bd = Infinity;
  for (let j = 0; j < D.length - 1; j++) {
    const p = D[j], q = D[j + 1], vx = q.x - p.x, vz = q.z - p.z, L2 = vx * vx + vz * vz || 1;
    const t = clamp(((x - p.x) * vx + (z - p.z) * vz) / L2, 0, 1), d = Math.hypot(x - p.x - vx * t, z - p.z - vz * t);
    if (d < bd) { bd = d; bj = j; bt = t; }
  }
  const p = D[bj], q = D[bj + 1], L = q.s - p.s;
  if (bt * L < 0.6) return p;
  if ((1 - bt) * L < 0.6) return q;
  const nd = { key: `${W.id}_i${inserted++}`, x: p.x + (q.x - p.x) * bt, z: p.z + (q.z - p.z) * bt, s: p.s + L * bt };
  nd.x0 = nd.x; nd.z0 = nd.z;
  D.splice(bj + 1, 0, nd);
  adj.set(p.key, adj.get(p.key).filter(([k, d]) => !(k === q.key && d > 0)));
  adj.set(q.key, adj.get(q.key).filter(([k, d]) => !(k === p.key && d > 0)));
  link(p.key, nd.key, L * bt); link(nd.key, q.key, L * (1 - bt));
  const lf = lifted.get(W);
  if (lf) LB.set(nd.key, Math.max(LB.get(nd.key) ?? 0, lf.H));
  if (pinned.has(p.key) && pinned.has(q.key)) pinned.add(nd.key);
  if (deckPts?.has(p.key) && deckPts.has(q.key)) deckPts.add(nd.key);
  return nd;
}
const hasTie = (a, b) => adj.get(a)?.some(([k, d]) => k === b && d === 0);
if (MERGE) {
  const nearestDense = denseAt;
  const seen = new Set();
  for (const [id, ws] of waysAt) {
    if (ws.length < 2) continue;
    for (const O of ws) for (const W of ws) {
      if (O === W) continue;
      const D = O._dense;
      for (let k0 = 0; k0 < D.length; k0++) {
        if (D[k0].key !== String(id)) continue;
        // Only where they really overlap (half a metre in): roads merely touching can take a narrowing.
        const reach = W._road.w / 2 + O._road.w / 2 - 0.5;
        for (const dir of [1, -1]) for (let k = k0 + dir; k >= 0 && k < D.length; k += dir) {
          if (polyDist(W._pts, D[k].x, D[k].z) > reach) break;
          const n = nearestDense(W, D[k].x, D[k].z);
          if (n.key === D[k].key || hasTie(D[k].key, n.key)) continue;
          link(D[k].key, n.key, 0); ties++;
        }
      }
    }
  }
}
let hugged = 0;
function hug() {
if (MERGE) return;
for (const [W, lf] of lifted) for (const id of W._ids) for (const O of waysAt.get(id) ?? []) {
  // (A lower deck joining a higher one too: this loop ramp is a 6.5 m bridge climbing to 东三环's 13.)
  if (O === W || (lifted.get(O)?.H ?? 0) >= lf.H) continue;
  const D = O._dense, k0 = D.findIndex((d) => d.key === String(id));
  if (k0 < 0) continue;
  const reach = W._road.w / 2 + O._road.w / 2 + 1;
  for (const dir of [1, -1]) for (let k = k0 + dir; k >= 0 && k < D.length; k += dir) {
    if (polyDist(W._pts, D[k].x, D[k].z) > reach) break;
    if (pinned.has(D[k].key)) break;
    LB.set(D[k].key, Math.max(LB.get(D[k].key) ?? 0, lf.H)); hugged++;
  }
}
}
hug();
/** Points held up by a deck itself (a lifted way, or a slip road alongside one): they never come down
 * for a pin. The levels set later (junctions, crossings, overlaps) are softer and give way to one. */
deckPts = new Set(LB.keys());
// A tiny binary heap for the two Dijkstras.
class Heap {
  constructor(less) { this.a = []; this.less = less; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
/** Heights from the lower bounds (decks) and the pins: down from the decks at GRADE (highest
 * first, never onto a pinned point), then no faster than STEEP up from a pinned point. */
function solve() {
  // Preferred: down from the decks at GRADE along the roads - across a tie only off a deck (a slip road
  // leaving one), never from one road into another beside it: a tie makes two roads one surface, it is
  // not a way for a slope to spread into the streets around an interchange.
  const G = new Map(LB);
  const q = new Heap((a, b) => a[0] > b[0]);
  for (const [k, h] of LB) q.push([h, k]);
  while (q.size) {
    const [h, k] = q.pop();
    if (h < (G.get(k) ?? 0)) continue;
    for (const [nb, d] of adj.get(k) ?? []) {
      if (d === 0 && !deckPts?.has(k)) continue;
      const c = h - GRADE * d;
      if (c <= 0.02 || pinned.has(nb) || c <= (G.get(nb) ?? 0)) continue;
      G.set(nb, c); q.push([c, nb]);
    }
  }
  // Required: as high as the decks need, at STEEP, across everything (tied roads rise together).
  const N = new Map(LB);
  for (const [k, h] of LB) q.push([h, k]);
  while (q.size) {
    const [h, k] = q.pop();
    if (h < (N.get(k) ?? 0)) continue;
    for (const [nb, d] of adj.get(k) ?? []) { const c = h - STEEP * d; if (c > 0.02 && c > (N.get(nb) ?? 0)) { N.set(nb, c); q.push([c, nb]); } }
  }
  const HT = new Map(G);
  for (const [k, v] of N) if (v > (HT.get(k) ?? 0)) HT.set(k, v);
  return consistent(HT);
}
/**
 * Consistent: no point more than STEEP above a neighbour and tied points level, the lower winning -
 * pinned points at 0 pull decks down too (where OSM joins a bridge straight onto the road it crosses,
 * round 四惠, a flat deck left a 6.5 m cliff in 9 m).
 */
function consistent(HT) {
  for (const k of pinned) HT.delete(k);
  const u = new Heap((a, b) => a[0] < b[0]);
  // Every point, the ground ones too (absent from HT: at 0, and they hold their neighbours down).
  for (const k of adj.keys()) u.push([HT.get(k) ?? 0, k]);
  const done = new Set();
  while (u.size) {
    const [v, k] = u.pop();
    if (done.has(k)) continue;
    done.add(k);
    for (const [nb, d] of adj.get(k) ?? []) {
      const c = v + STEEP * d;
      if (!done.has(nb) && (HT.get(nb) ?? 0) > c) { if (c <= 0.02) HT.delete(nb); else HT.set(nb, c); u.push([c, nb]); }
    }
  }
  return HT;
}
let HT = solve();
// Roads that meet and overlap are one surface. From every junction, each road holds the height of the
// others for as long as it is inside one's carriageway (the higher, where they differ), then goes its
// own way. A slope used to run straight through a fork - on 建国门内大街 the main line climbs to
// 建国门桥 from the very node where its side road peels off downhill; OSM draws the two 6 m apart
// with 10 m of half widths, so they overlapped 2 m apart in height and the side road's parapet stood
// across the main line's lanes (「车往高架桥开，被挡住了」). Iterated: raising one raises its neighbours.
/** Height of way W's nearest dense point to (x, z), from the last solve. */
const heightNear = (W, x, z) => { let best = 0, bd = Infinity; for (const d of W._dense) { const dd = (d.x - x) ** 2 + (d.z - z) ** 2; if (dd < bd) { bd = dd; best = HT.get(d.key) ?? 0; } } return best; };
// A bridge that cannot reach clearance over what it crosses is not one here. The city has no ground to
// sink the road below into, so a 29 m span over 东二环 with its approaches running alongside 东二环
// could only climb 1-2 m (STEEP from the pins) and sat on top of the traffic under it. Such bridges
// go back to the flat, with their pins, and everything is solved again.
let demoted = 0;
for (const [W, lf] of [...lifted]) for (const { o, x, z } of lf.over) if (!lifted.has(o) && heightNear(W, x, z) < DECK - 1.2) { lifted.delete(W); demoted++; break; }
if (demoted) {
  LB.clear(); pinned.clear();
  for (const [W, lf] of lifted) for (const d of W._dense) LB.set(d.key, Math.max(LB.get(d.key) ?? 0, lf.H));
  for (const [, lf] of lifted) for (const { o, x, z } of lf.over) if (!lifted.has(o)) for (const d of o._dense) if (Math.hypot(d.x - x, d.z - z) < PIN) pinned.add(d.key);
  for (const k of deadEnds) pinned.add(k);
  hug();
  deckPts = new Set(LB.keys());
  HT = solve();
}
// Street junctions stay on the ground wherever a deck lets them. The slopes used to run from every
// bridge into every street joined to it, so whole blocks of junctions round 通惠河北路 and 恒惠路 stood
// on 2-4 m banks, parapets on every side - a maze the car climbed into (「车往高架桥开，被挡住了」).
// `need` is how high a point must be for the decks to be reached at STEEP; a junction that need not be
// up at all is pinned at 0 with the stretch of each road inside the others' carriageways, and the
// approach comes down between it and the deck (steeper, where it must).
const need = new Map(LB);
{
  const q = new Heap((a, b) => a[0] > b[0]);
  for (const [k, h] of LB) q.push([h, k]);
  while (q.size) {
    const [h, k] = q.pop();
    if (h < (need.get(k) ?? 0)) continue;
    for (const [nb, d] of adj.get(k) ?? []) { const c = h - STEEP * d; if (c > 0.02 && c > (need.get(nb) ?? 0)) { need.set(nb, c); q.push([c, nb]); } }
  }
}
let groundJ = 0;
if (process.env.DBG_NODE) { const id = Number(process.env.DBG_NODE); console.log('DBG', id, 'degCar', degCar.get(id), 'deck', deckPts.has(String(id)), 'need', need.get(String(id)), 'HT', HT.get(String(id)), 'LB', LB.get(String(id))); }
for (const [id, ws] of waysAt) {
  if ((degCar.get(id) || 0) < 3 || deckPts.has(String(id)) || (need.get(String(id)) ?? 0) > 0.05) continue;
  if ((HT.get(String(id)) ?? 0) < 0.05) continue;
  groundJ++;
  pinned.add(String(id));
  for (const O of ws) {
    const D = O._dense, k0 = D.findIndex((d) => d.key === String(id));
    if (k0 < 0) continue;
    for (const dir of [1, -1]) for (let k = k0 + dir; k >= 0 && k < D.length; k += dir) {
      if (deckPts.has(D[k].key) || (need.get(D[k].key) ?? 0) > 0.05) break;
      if (!ws.some((W) => W !== O && polyDist(W._pts, D[k].x, D[k].z) < W._road.w / 2 + O._road.w / 2 + 1.5)) break;
      pinned.add(D[k].key);
    }
  }
}
// Merge zones too (the points tied to another road's): where the decks do not need them up, they stay
// on the ground and the ramps do their climbing outside them. Without this a descending main line
// held an entrance ramp up where the two met, the ramp's other end held the side road it leaves, and
// the side road of 建国门外大街 rose and fell 0.9 - 2.6 - 0 m on its way past 国贸.
let tiePins = 0;
for (const [k, list] of adj) {
  if (pinned.has(k) || deckPts.has(k) || (need.get(k) ?? 0) > 0.05) continue;
  if (list.some(([, d]) => d === 0)) { pinned.add(k); tiePins++; }
}
HT = solve();
let flatJ = 0;
for (let iter = 0; iter < (MERGE ? 0 : 3); iter++) {
  let raised = 0;
  for (const [id, ws] of waysAt) {
    if ((degCar.get(id) || 0) < 3) continue;
    if ((HT.get(String(id)) ?? 0) < 0.05 && ws.every((W) => !W._dense.some((d) => (HT.get(d.key) ?? 0) > 0.05))) continue;
    if (iter === 0) flatJ++;
    for (const O of ws) {
      const D = O._dense, k0 = D.findIndex((d) => d.key === String(id));
      if (k0 < 0) continue;
      for (const dir of [1, -1]) for (let k = k0 + dir; k >= 0 && k < D.length; k += dir) {
        if (pinned.has(D[k].key)) break;
        let target = -1;
        for (const W of ws) if (W !== O && polyDist(W._pts, D[k].x, D[k].z) < W._road.w / 2 + O._road.w / 2 + 1.5) target = Math.max(target, heightNear(W, D[k].x, D[k].z));
        if (target < 0) break;
        if (target > (LB.get(D[k].key) ?? 0) + 0.05 && target > (HT.get(D[k].key) ?? 0) + 0.05) { LB.set(D[k].key, target); raised++; }
      }
    }
  }
  if (!raised) break;
  HT = solve();
}
// Roads that cross in plan with no shared node and too little height between them: a slope OSM did
// not tag as a bridge ran over 建国门南大街 at 3.3 m, and its embankment walls stood across the street.
// Over 2.5 m apart, the upper one is lifted to a full deck over the crossing and the lower one pinned;
// closer, they are brought level (the lower raised, or both pinned to the ground) and simply cross.
const allX = [];
// Unless they meet right there: a loop ramp shares a node with the road it later crosses, so only a
// shared node within 25 m of the crossing makes it a junction rather than a crossing.
const nodeXZ = new Map();
for (const w of carWays) w._ids.forEach((id, i) => nodeXZ.set(id, w._pts[i]));
for (const w of carWays) for (const { it, x, z } of crossings(w, carGrid)) if (w.id < it.w.id && !it.w._ids.some((id) => w._ids.includes(id) && Math.hypot(nodeXZ.get(id)[0] - x, nodeXZ.get(id)[1] - z) < 25)) allX.push({ a: w, b: it.w, x, z });
let crossFix = 0;
for (let iter = 0; iter < (process.env.NO_CROSSFIX ? 0 : 2); iter++) {
  let changed = 0;
  for (const { a, b, x, z } of allX) {
    const ha = heightNear(a, x, z), hb = heightNear(b, x, z);
    const [hi, lo, H, L] = ha >= hb ? [ha, hb, a, b] : [hb, ha, b, a];
    if (hi < 0.3 || hi - lo >= DECK - 1) continue;
    const near = (W, r) => W._dense.filter((d) => Math.hypot(d.x - x, d.z - z) < r);
    if (hi - lo >= 2.5) {
      for (const d of near(H, 18)) if (!pinned.has(d.key) && (LB.get(d.key) ?? 0) < lo + DECK) { LB.set(d.key, lo + DECK); changed++; }
      if (lo < 0.3) for (const d of near(L, PIN)) if (!(LB.get(d.key) > 0)) { pinned.add(d.key); changed++; }
    } else if (lo > 0.3) {
      for (const d of near(L, 15)) if (!pinned.has(d.key) && (LB.get(d.key) ?? 0) < hi - 0.05) { LB.set(d.key, hi); changed++; }
    } else {
      for (const d of [...near(H, 15), ...near(L, 15)]) if (!pinned.has(d.key) && !(LB.get(d.key) > 0)) { pinned.add(d.key); changed++; }
    }
    if (iter === 0) crossFix++;
  }
  if (!changed) break;
  HT = solve();
}
// Roads that overlap in plan alongside each other (two carriageways of 通惠河北路, a ramp beside the
// road it leaves) at heights that cannot both be (0.3 to DECK - 1 m apart) become one level: the
// lower is raised to the higher. Ones stacked a deck apart are left alone.
const DGRID = 16, dgrid = new Map();
for (const w of carWays) w._dense.forEach((d, i) => { const k = `${Math.floor(d.x / DGRID)},${Math.floor(d.z / DGRID)}`; (dgrid.get(k) ?? dgrid.set(k, []).get(k)).push([w, i]); });
/** The segment direction of way W nearest (x, z). */
const dirOf = (W, x, z) => { let best = 0, bd = Infinity; for (let i = 1; i < W._pts.length; i++) { const d = segDist(x, z, W._pts[i - 1][0], W._pts[i - 1][1], W._pts[i][0], W._pts[i][1]); if (d < bd) { bd = d; best = Math.atan2(W._pts[i][1] - W._pts[i - 1][1], W._pts[i][0] - W._pts[i - 1][0]); } } return best; };
/** Clearance from one road surface up to the one over it: the deck's depth and a lorry's height. */
const CLEAR = 5.6;
/**
 * Every place two carriageways overlap in plan - the higher one's parapet counted - at heights that are
 * neither one surface nor a deck clear over the other (0.3 to CLEAR m apart): each is a wall, a drop or
 * a structure through a road. Off the end of the other way does not count (the next piece of the same
 * road, or a street ending at a junction: along it, not beside it).
 */
function overlapRows() {
  const rows = [];
  for (const A of carWays) for (const a of A._dense) {
    const ha = HT.get(a.key) ?? 0;
    const gx = Math.floor(a.x / DGRID), gz = Math.floor(a.z / DGRID);
    // The nearest point of each way B about: its segment, distance and height there.
    const best = new Map();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [B, i] of dgrid.get(`${gx + dx},${gz + dz}`) ?? []) {
      if (B === A || B.id < A.id) continue;
      const D = B._dense;
      for (const j of [i - 1, i]) {
        if (j < 0 || j >= D.length - 1) continue;
        const p = D[j], q = D[j + 1], vx = q.x - p.x, vz = q.z - p.z, L2 = vx * vx + vz * vz || 1;
        const t = clamp(((a.x - p.x) * vx + (a.z - p.z) * vz) / L2, 0, 1), d = Math.hypot(a.x - p.x - vx * t, a.z - p.z - vz * t);
        const cur = best.get(B);
        if (!cur || d < cur.d) best.set(B, { d, j, t, h: (HT.get(p.key) ?? 0) * (1 - t) + (HT.get(q.key) ?? 0) * t });
      }
    }
    for (const [B, { d, j, t, h: hb }] of best) {
      const dh = Math.abs(ha - hb);
      if (dh < 0.3 || dh >= CLEAR) continue;
      const need = A._road.w / 2 + B._road.w / 2 + 0.45;
      if (d >= need) continue;
      const D = B._dense, b = t < 0.5 ? D[j] : D[j + 1];
      if ((j === 0 && t === 0) || (j === D.length - 2 && t === 1)) continue;
      if (Math.min(Math.hypot(b.x - A._pts[0][0], b.z - A._pts[0][1]), Math.hypot(b.x - A._pts.at(-1)[0], b.z - A._pts.at(-1)[1])) <= polyDist(A._pts, b.x, b.z) + 0.01) continue;
      let da = Math.abs(dirOf(A, a.x, a.z) - dirOf(B, a.x, a.z)) % Math.PI; da = Math.min(da, Math.PI - da);
      rows.push({ x: a.x, z: a.z, A, B, a, b, dh, over: need - d, ha, hb, along: da < 0.44 });
    }
  }
  return rows;
}
// Carriageways alongside each other at different heights that overlap in plan are made narrower:
// the widths are estimates (lanes x 3.3 m, or a class default of 12 m for a one-way trunk), and a
// main line's ramp and the side road beside it, drawn 9 m apart by OSM, overlapped by a metre or two
// - the ramp's parapet and embankment wall stood in the side road's outer lane. Each gives up to what
// its lanes can spare (3 m a lane) in proportion; what is left over is brought level below.
const minWidth = (W) => {
  const r = W._road, w0 = r.w0 ?? r.w;
  // Lanes as traffic/LaneGraph counts them (a two-way road untagged is one lane each way under 12.4 m).
  const L = r.oneway ? r.lanes || Math.max(1, Math.round((w0 - 1) / 3.3)) : 2 * Math.max(1, r.lanes ? Math.round(r.lanes / 2) : Math.floor(w0 / 2 / 3.1));
  return Math.min(w0, Math.max(0.7 * w0, L * 3 + (r.oneway ? 0.4 : 0.6)));
};
let narrowed = 0;
function narrow() {
if (!process.env.NO_NARROW) for (let iter = 0; iter < 3; iter++) {
  const cut = new Map();
  for (const r of overlapRows()) {
    if (!r.along) continue;
    const cA = (r.A._road.w - minWidth(r.A)) / 2, cB = (r.B._road.w - minWidth(r.B)) / 2;
    if (cA + cB < 0.05) continue;
    const k = Math.min(1, r.over / (cA + cB));
    cut.set(r.A, Math.max(cut.get(r.A) ?? 0, cA * k));
    cut.set(r.B, Math.max(cut.get(r.B) ?? 0, cB * k));
  }
  if (!cut.size) break;
  for (const [W, c] of cut) { W._road.w0 ??= W._road.w; W._road.w = Math.max(minWidth(W), W._road.w - 2 * c - 0.1); }
  narrowed = [...carWays].filter((W) => W._road.w0 !== undefined && W._road.w < W._road.w0).length;
}
}
narrow();
// Two ramps side by side that still overlap (a road's two carriageways coming off different decks, two
// slip roads drawn a few metres apart) are one surface too: tied like a merge. A ramp beside a road on
// the ground is not - that would lift the street into the interchange; the narrowing is its answer.
let sideFix = 0;
for (let iter = 0; iter < 4; iter++) {
  let changed = 0;
  for (const r of overlapRows()) {
    if (!r.along || Math.min(r.ha, r.hb) < 0.3 || r.dh > 2.5) continue;
    const n = denseAt(r.B, r.a.x, r.a.z);
    if (n.key === r.a.key || hasTie(r.a.key, n.key)) continue;
    link(r.a.key, n.key, 0); changed++; sideFix++;
  }
  if (!changed) break;
  HT = solve();
}
narrow();
// A ramp still overlapping a road on the ground beside it comes down to the ground there, where the decks
// allow (it climbs the steeper past it): its parapet and embankment stood in the road's outer lane.
let rampPins = 0;
for (let iter = 0; iter < 4; iter++) {
  let changed = 0;
  for (const r of overlapRows()) {
    const [hk, lo] = r.ha >= r.hb ? [r.a.key, r.hb] : [r.b.key, r.ha];
    if (lo > 0.05 || pinned.has(hk) || deckPts.has(hk) || (need.get(hk) ?? 0) > 0.05) continue;
    pinned.add(hk); changed++; rampPins++;
  }
  if (!changed) break;
  HT = solve();
}
// Smoothed: the raised stretches between the fixed points (decks, pins, the ground) are averaged along
// the roads a few times, never below what the decks need and tied points kept level. The solve takes
// the higher of two slopes from two decks and the lower of a tied group, and between them a ramp could
// zig-zag 5.4 - 4.4 - 5.6 m in 20 m (the slip roads at 左安门桥), enough to launch a car into the deck
// above.
const needNow = new Map(LB);
{
  const q = new Heap((a, b) => a[0] > b[0]);
  for (const [k, h] of LB) q.push([h, k]);
  while (q.size) {
    const [h, k] = q.pop();
    if (h < (needNow.get(k) ?? 0)) continue;
    for (const [nb, d] of adj.get(k) ?? []) { const c = h - STEEP * d; if (c > 0.02 && c > (needNow.get(nb) ?? 0)) { needNow.set(nb, c); q.push([c, nb]); } }
  }
}
let smoothed = 0;
{
  const free = [...HT.keys()].filter((k) => !pinned.has(k) && !LB.has(k) && (HT.get(k) ?? 0) > 0.02);
  const isFree = new Set(free);
  for (let it = 0; it < 24; it++) {
    const next = new Map();
    for (const k of free) {
      let sw = 0, sh = 0;
      for (const [nb, d] of adj.get(k) ?? []) if (d > 0) { const w = 1 / Math.max(1, d); sw += w; sh += w * (HT.get(nb) ?? 0); }
      if (sw) next.set(k, Math.max(needNow.get(k) ?? 0, 0.5 * (HT.get(k) ?? 0) + 0.5 * sh / sw));
    }
    for (const [k, v] of next) HT.set(k, v);
    // Tied points level: to the fixed one's height, or their mean.
    for (const k of free) for (const [nb, d] of adj.get(k) ?? []) if (d === 0) {
      const v = isFree.has(nb) ? ((HT.get(k) ?? 0) + (HT.get(nb) ?? 0)) / 2 : (HT.get(nb) ?? 0);
      HT.set(k, v); if (isFree.has(nb)) HT.set(nb, v);
    }
  }
  smoothed = free.length;
  HT = consistent(HT);
}
// Last, what is still in the way is moved aside. A ramp beside a road on the ground that the decks need
// up, with both roads as narrow as their lanes allow, still stood its parapet and embankment in the
// other's outer lane (or its deck's edge hung over it at bonnet height): the road that gives way -
// the lower, unless it is a deck - is shifted sideways by the overlap, easing in and out over TAPER m
// along it, junction nodes and all (every way through a moved node moves with it). The heights stay as
// they were: a point is the same point, only somewhere else.
const TAPER = 30, SHIFT_MAX = 4.5;
let shifted = 0;
const shiftOf = new Map(); // dense key -> [dx, dz]
for (let iter = 0; iter < 3; iter++) {
  const want = new Map(); // way -> [{ s, dx, dz }]
  for (const r of overlapRows()) {
    if (!r.along) continue;
    const [lo, hi, lp] = r.ha < r.hb ? [r.A, r.B, r.a] : [r.B, r.A, r.b];
    const [M, F, mp] = lifted.has(lo) && !lifted.has(hi) ? [hi, lo, r.ha < r.hb ? r.b : r.a] : [lo, hi, lp];
    // Away from F's line, by the overlap and a little.
    let best = null, bd = Infinity;
    for (let i = 1; i < F._dense.length; i++) {
      const p = F._dense[i - 1], q = F._dense[i], vx = q.x - p.x, vz = q.z - p.z, L2 = vx * vx + vz * vz || 1;
      const t = clamp(((mp.x - p.x) * vx + (mp.z - p.z) * vz) / L2, 0, 1), cx = p.x + vx * t, cz = p.z + vz * t, d = Math.hypot(mp.x - cx, mp.z - cz);
      if (d < bd) { bd = d; best = [cx, cz]; }
    }
    if (!best || bd < 0.3) continue;
    const need = F._road.w / 2 + M._road.w / 2 + 0.45 + 0.2, m = need - bd;
    if (m <= 0 || m > SHIFT_MAX) continue;
    const ux = (mp.x - best[0]) / bd, uz = (mp.z - best[1]) / bd;
    (want.get(M) ?? want.set(M, []).get(M)).push({ s: mp.s, dx: ux * m, dz: uz * m });
  }
  if (!want.size) break;
  for (const [M, list] of want) for (const d of M._dense) {
    let v = null, vm = 0;
    for (const w of list) { const f = Math.max(0, 1 - Math.max(0, Math.abs(d.s - w.s) - 5) / TAPER); const m = Math.hypot(w.dx, w.dz) * f; if (m > vm) { vm = m; v = [w.dx * f, w.dz * f]; } }
    if (!v) continue;
    const cur = shiftOf.get(d.key) ?? [0, 0];
    // Added to what earlier rounds moved it by, in the new direction only as far as it is short.
    if (Math.hypot(v[0], v[1]) > 0.02) { let nx = cur[0] + v[0], nz = cur[1] + v[1]; const m = Math.hypot(nx, nz); if (m > 5) { nx *= 5 / m; nz *= 5 / m; } shiftOf.set(d.key, [nx, nz]); }
  }
  // Every way through a moved point takes the move, and the points move for the next round's test.
  const touched = new Set();
  for (const w of carWays) for (const d of w._dense) { const v = shiftOf.get(d.key); if (!v) continue; touched.add(w); d.x = d.x0 + v[0]; d.z = d.z0 + v[1]; }
  for (const w of touched) {
    // Back into the way's polyline (every dense point a vertex; node ids where they are nodes) and arc lengths.
    w._pts = w._dense.map((d) => [d.x, d.z]);
    w._ids = w._dense.map((d) => (/^\d+$/.test(d.key) ? Number(d.key) : `x${d.key}`));
    let s0 = 0; w._dense.forEach((d, i) => { if (i) s0 += Math.hypot(d.x - w._dense[i - 1].x, d.z - w._dense[i - 1].z); d.s = s0; });
  }
  shifted = shiftOf.size;
  if (process.env.SHIFT_TOP) { const top = [...shiftOf.entries()].map(([k, v]) => [k, Math.hypot(v[0], v[1])]).sort((a, b) => b[1] - a[1]).slice(0, 8); for (const [k, m] of top) for (const w of carWays) { const d = w._dense.find((q) => q.key === k); if (d) { console.log('SHIFT', w.tags.name ?? w._road.cls, d.x.toFixed(0), d.z.toFixed(0), m.toFixed(2)); break; } } }
  if (process.env.ELEV_CONFLICTS && iter === 0) { const m = [...shiftOf.values()].map((v) => Math.hypot(v[0], v[1])).sort((a, b) => a - b); console.log('shifts', m.length, 'median', m[m.length >> 1]?.toFixed(2), 'max', m.at(-1)?.toFixed(2)); }
  dgrid.clear();
  for (const w of carWays) w._dense.forEach((d, i) => { const k = `${Math.floor(d.x / DGRID)},${Math.floor(d.z / DGRID)}`; (dgrid.get(k) ?? dgrid.set(k, []).get(k)).push([w, i]); });
}
if (process.env.ELEV_CONFLICTS) {
  const rows = overlapRows();
  if (process.env.CONF_AT) {
    const [cx, cz] = process.env.CONF_AT.split(',').map(Number);
    for (const r of rows) if (Math.hypot(r.x - cx, r.z - cz) < 45) console.log('CONF', r.A.id, r.A._road.cls, r.B.id, r.B._road.cls, 'at', r.x.toFixed(0), r.z.toFixed(0), 'ha', r.ha.toFixed(2), 'hb', r.hb.toFixed(2), 'over', r.over.toFixed(1), r.along ? 'along' : 'cross', 'pinA', pinned.has(r.a.key), 'pinB', pinned.has(r.b.key), 'deckA', deckPts.has(r.a.key), 'deckB', deckPts.has(r.b.key), r.a.key, r.b.key);
  }
  {
    const cls = {};
    for (const r of rows) {
      const [H, L, hh, hl, hk, lk] = r.ha >= r.hb ? [r.A, r.B, r.ha, r.hb, r.a.key, r.b.key] : [r.B, r.A, r.hb, r.ha, r.b.key, r.a.key];
      const k = `${r.along ? 'along' : 'cross'} low${hl < 0.05 ? '=0' : '>0'} high:${lifted.has(H) ? 'deck' : 'ramp'} dh${r.dh < 1.5 ? '<1.5' : r.dh < 3.5 ? '<3.5' : '<5.6'}`;
      cls[k] = (cls[k] ?? 0) + 1;
    }
    console.log('residual classes', cls);
  }
  const sites = [];
  for (const r of rows) {
    let s = sites.find((q) => Math.hypot(q.x - r.x, q.z - r.z) < 40);
    if (!s) { s = { x: r.x, z: r.z, n: 0, dh: 0, over: 0, ways: new Set() }; sites.push(s); }
    s.n++; s.dh = Math.max(s.dh, r.dh); s.over = Math.max(s.over, r.over);
    for (const W of [r.A, r.B]) s.ways.add(`${W.id}:${W.tags.name ?? ''}/${W._road.cls}${lifted.has(W) ? '*' : ''}(w${W._road.w})`);
  }
  sites.sort((p, q) => q.n - p.n);
  // Pairs by kind: joined (share a node), alongside (< 25 degrees), crossing.
  const pairs = new Map();
  for (const r of rows) { const k = `${r.A.id}|${r.B.id}`; const p = pairs.get(k) ?? pairs.set(k, { A: r.A, B: r.B, n: 0, over: 0, dh: 0 }).get(k); p.n++; p.over = Math.max(p.over, r.over); p.dh = Math.max(p.dh, r.dh); }
  const kinds = {};
  for (const r of rows) {
    const p = pairs.get(`${r.A.id}|${r.B.id}`);
    if (p.kind) continue;
    const joined = r.A._ids.some((id) => r.B._ids.includes(id));
    p.kind = (joined ? 'joined' : 'apart') + (r.along ? '-alongside' : '-crossing') + (lifted.has(r.A) || lifted.has(r.B) ? '-deck' : '');
  }
  const hist = {};
  for (const p of pairs.values()) if (p.kind.includes('alongside')) { const b = p.over < 1 ? '<1' : p.over < 2 ? '1-2' : p.over < 3 ? '2-3' : p.over < 4 ? '3-4' : p.over < 6 ? '4-6' : '6+'; hist[b] = (hist[b] ?? 0) + 1; }
  console.log('alongside pairs by max overlap', hist);
  for (const p of pairs.values()) { const k = kinds[p.kind] ?? (kinds[p.kind] = { pairs: 0, pts: 0 }); k.pairs++; k.pts += p.n; }
  console.log('conflict kinds', kinds);
  const km = {};
  for (const w of carWays) { const D = w._dense; for (let i = 1; i < D.length; i++) { const h = Math.max(HT.get(D[i - 1].key) ?? 0, HT.get(D[i].key) ?? 0); if (h < 0.3) continue; const k = lifted.has(w) ? 'deck' : w._road.cls; km[k] = (km[k] ?? 0) + (D[i].s - D[i - 1].s) / 1000; } }
  console.log('km raised by kind', Object.fromEntries(Object.entries(km).map(([k, v]) => [k, +v.toFixed(1)])));
  fs.writeFileSync('.scratch/conflicts.txt', `${rows.length} conflicting points, ${sites.length} sites\n` + sites.map((s) => `${Math.round(s.x)},${Math.round(s.z)} n${s.n} dh<=${s.dh.toFixed(1)} over<=${s.over.toFixed(1)} ${[...s.ways].join(' ')}`).join('\n'));
  console.log('conflicts', rows.length, 'points,', sites.length, 'sites');
  // Raised dead ends: a way's end with no other car way there, above the ground.
  const ends = [];
  for (const w of carWays) for (const id of [w._ids[0], w._ids.at(-1)]) if ((degCar.get(id) || 0) <= 1 && (HT.get(String(id)) ?? 0) > 0.3) ends.push(`${w.id} ${w.tags.name ?? w._road.cls} at ${nodeXZ.get(id).map(Math.round)} h ${(HT.get(String(id))).toFixed(1)}`);
  console.log('raised dead ends', ends.length, ends.slice(0, 20));
  // Kinks: a road's slope turning from climbing to falling (or back) by more than 8% within 20 m, off the ground.
  const kinks = [];
  for (const w of carWays) {
    const D = w._dense;
    for (let i = 1; i < D.length - 1; i++) {
      const h = (d) => HT.get(d.key) ?? 0;
      if (Math.max(h(D[i - 1]), h(D[i]), h(D[i + 1])) < 0.3) continue;
      let a = i - 1; while (a > 0 && D[i].s - D[a].s < 8) a--;
      let b = i + 1; while (b < D.length - 1 && D[b].s - D[i].s < 8) b++;
      const g0 = (h(D[i]) - h(D[a])) / Math.max(1, D[i].s - D[a].s), g1 = (h(D[b]) - h(D[i])) / Math.max(1, D[b].s - D[i].s);
      if (Math.abs(g1 - g0) > 0.08 && Math.sign(g0) !== Math.sign(g1) && Math.abs(g0) > 0.02 && Math.abs(g1) > 0.02) kinks.push(`${w.id} ${w.tags.name ?? w._road.cls} at ${D[i].x.toFixed(0)},${D[i].z.toFixed(0)} h ${h(D[i]).toFixed(1)} ${(g0 * 100).toFixed(0)}%/${(g1 * 100).toFixed(0)}%`);
    }
  }
  console.log('kinks', kinks.length, kinks.slice(0, 40));
}
if (process.env.ELEV_WAY) {
  const w = carWays.find((q) => String(q.id) === process.env.ELEV_WAY), lf = lifted.get(w);
  console.log('WAY', w.id, w.tags.name ?? w.tags.highway, 'layer', w.tags.layer, 'bridge', w.tags.bridge, 'pts', w._pts.map((p) => p.map(Math.round).join(',')).join(' '), 'H', lf?.H, 'over', lf?.over.map((c) => `${c.o.id}:${c.o.tags.name ?? c.o.tags.highway}@${Math.round(c.x)},${Math.round(c.z)}`).join(' '));
  for (const id of w._ids) for (const o of waysAt.get(id) ?? []) if (o !== w) console.log('  shares node', id, 'at', nodeXZ.get(id).map(Math.round).join(','), 'with', o.id, o.tags.name ?? o.tags.highway, 'pinned there', pinned.has(String(id)), 'HT', (HT.get(String(id)) ?? 0).toFixed(2));
  if (process.env.ELEV_KEYS) for (const d of w._dense) console.log('   KEY', d.key, d.s.toFixed(1), (HT.get(d.key) ?? 0).toFixed(2), JSON.stringify((adj.get(d.key) ?? []).map(([k, dd]) => [k, +dd.toFixed(1)])));
  console.log('  dense', w._dense.map((d) => `${Math.round(d.s)}:${(HT.get(d.key) ?? 0).toFixed(1)}${pinned.has(d.key) ? 'P' : ''}`).join(' '));
}
if (process.env.DBG_KEY) {
  const where = new Map(); for (const w of carWays) for (const d of w._dense) where.set(d.key, `${w.id} ${w.tags.name ?? w._road.cls} ${d.x.toFixed(1)},${d.z.toFixed(1)}`);
  const walk = (k, depth, seen) => { if (depth > 3 || seen.has(k)) return; seen.add(k); for (const [nb, d] of adj.get(k) ?? []) if (d === 0) { console.log(' '.repeat(depth * 2) + 'TIE', k, '->', nb, where.get(nb), 'HT', (HT.get(nb) ?? 0).toFixed(2)); walk(nb, depth + 1, seen); } };
  for (const k of process.env.DBG_KEY.split(',')) { console.log('KEY', k, where.get(k), 'HT', (HT.get(k) ?? 0).toFixed(2), 'LB', LB.get(k), 'pin', pinned.has(k)); for (const [nb, d] of adj.get(k) ?? []) console.log('   ', nb, d.toFixed(2), where.get(nb), 'HT', (HT.get(nb) ?? 0).toFixed(2), 'LB', LB.get(nb), 'pin', pinned.has(nb)); }
}
if (process.env.ELEV_AT) {
  const [ex, ez] = process.env.ELEV_AT.split(',').map(Number);
  for (const w of carWays) for (const d of w._dense) if (Math.hypot(d.x - ex, d.z - ez) < 9) console.log('AT', w.id, w.tags.name ?? w.tags.highway, 'w', w._road.w, d.key, d.x.toFixed(1), d.z.toFixed(1), 'HT', (HT.get(d.key) ?? 0).toFixed(2), 'LB', LB.get(d.key) ?? 0, 'pin', pinned.has(d.key), 'deck', deckPts.has(d.key), 'lifted', lifted.has(w));
}
/** Height at arc length s along way w. */
function heightAlong(w, s) {
  const D = w._dense;
  if (!D) return 0;
  let i = 1;
  while (i < D.length - 1 && D[i].s < s) i++;
  const a = D[i - 1], b = D[i], t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 0;
  return (HT.get(a.key) ?? 0) * (1 - t) + (HT.get(b.key) ?? 0) * t;
}
const nodeHeight = (id) => HT.get(String(id)) ?? 0;
// Elevated stretches by tile, to keep lamps and trees out from under and off the decks.
const elevSegs = new Map();
let elevLen = 0;
for (const w of carWays) {
  const D = w._dense;
  for (let i = 1; i < D.length; i++) {
    const ha = HT.get(D[i - 1].key) ?? 0, hb = HT.get(D[i].key) ?? 0;
    if (Math.max(ha, hb) < 0.3) continue;
    elevLen += D[i].s - D[i - 1].s;
    const hw = w._road.w / 2 + 1.6, a = D[i - 1], b = D[i];
    eachTile([Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw, Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw], (ix, iz) => {
      const k = `${ix}_${iz}`; (elevSegs.get(k) ?? elevSegs.set(k, []).get(k)).push([a.x, a.z, b.x, b.z, hw, Math.min(ha, hb)]);
    });
  }
}
/** The lowest deck over (x, z) (its road surface height), or Infinity. */
const deckOver = (x, z) => { let m = Infinity; for (const [ax, az, bx, bz, hw, lo] of elevSegs.get(tileOf(x, z).join('_')) ?? []) if (lo < m && segDist(x, z, ax, az, bx, bz) < hw) m = lo; return m; };
let underCut = 0;
const underDeck = (x, z) => { for (const [ax, az, bx, bz, hw] of elevSegs.get(tileOf(x, z).join('_')) ?? []) if (segDist(x, z, ax, az, bx, bz) < hw) return true; return false; };
if (process.env.ELEV_DEBUG) {
  const rows = [...lifted].map(([w, lf]) => { let L = 0; for (let i = 1; i < w._pts.length; i++) L += Math.hypot(w._pts[i][0] - w._pts[i - 1][0], w._pts[i][1] - w._pts[i - 1][1]); return { L, w, lf }; }).sort((a, b) => b.L - a.L);
  console.log('lifted total', Math.round(rows.reduce((s, r) => s + r.L, 0)), 'm');
  for (const { L, w, lf } of rows.slice(0, 25)) console.log(Math.round(L), w.id, w.tags.name ?? w.tags.highway, 'layer', w.tags.layer ?? '-', 'H', lf.H, 'over', lf.over.map((c) => c.o.tags.name ?? c.o.tags.highway).slice(0, 3).join(','), overOf.has(w) ? '' : '(joined)');
}
console.log(`elevation: ${deckX.length} deck crossings (${stacked} restacked), ${ties} ties between overlapping roads (${inserted} points spliced in), ${narrowed} ways narrowed, ${overOf.size} bridges over a road or railway, ${demoted} too short to clear it left flat, ${lifted.size} ways lifted, ${pinned.size} points pinned under them, ${hugged} slip-road points held level with a deck, ${groundJ} junctions and ${tiePins} merge points kept on the ground, ${flatJ} junctions off the ground made level, ${crossFix} crossings without a node given room or brought level, ${sideFix} points tied level with a ramp overlapping them, ${rampPins} ramp points brought down beside a road on the ground, ${smoothed} raised points smoothed, ${shifted} points moved aside, ${(elevLen / 1000).toFixed(1)} km of road above ground`);

const roadSegs = new Map(); // tile key -> [ax, az, bx, bz, halfWidth]
function addSeg(ax, az, bx, bz, hw) {
  eachTile([Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw], (ix, iz) => {
    const k = `${ix}_${iz}`; (roadSegs.get(k) ?? roadSegs.set(k, []).get(k)).push([ax, az, bx, bz, hw]);
  });
}
let roadPieces = 0;
for (const w of ways) {
  const info = w._road; if (!info) continue;
  const P = [], J = [], PS = [];
  let run = 0;
  // A point every 40 m, or every 10 m on a way with any height: the heights are linear between points,
  // and at 40 m two overlapping roads interpolated their ramps' feet and tops a metre apart.
  const step = info.car && w._dense?.some((d) => (HT.get(d.key) ?? 0) > 0.02) ? 10 : 40;
  for (let i = 0; i < w._pts.length; i++) {
    if (i > 0) {
      const [ax, az] = w._pts[i - 1], [bx, bz] = w._pts[i];
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / step);
      for (let k = 1; k < n; k++) { P.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); J.push(0); PS.push(run + L * k / n); }
      run += L;
    }
    P.push(w._pts[i]);
    J.push((degAll.get(w._ids[i]) || 0) >= 3 ? 1 : 0);
    PS.push(run);
  }
  let cur = null;
  const flush = () => {
    if (!cur || cur.p.length < 2) return;
    const h = info.car ? cur.s.map((s) => q1(heightAlong(w, s))) : [];
    tile(cur.ix, cur.iz).roads.push({ c: info.cls, w: q1(info.w), o: info.oneway ? 1 : 0, l: info.lanes, br: info.bridge, n: info.name || undefined, p: flat(cur.p), j: cur.j, a: cur.a ? flat([cur.a]) : 0, b: cur.b ? flat([cur.b]) : 0, ...(h.some((v) => v > 0.05) ? { h } : {}) });
    roadPieces++;
  };
  for (let i = 0; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2, mz = (P[i][1] + P[i + 1][1]) / 2;
    addSeg(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], info.w / 2);
    if (!inRegion(mx, mz)) { flush(); cur = null; continue; }
    const [ix, iz] = tileOf(mx, mz);
    if (!cur || cur.ix !== ix || cur.iz !== iz) { flush(); cur = { ix, iz, p: [P[i]], j: [J[i]], s: [PS[i]], a: i > 0 ? P[i - 1] : null, b: null }; }
    cur.p.push(P[i + 1]); cur.j.push(J[i + 1]); cur.s.push(PS[i + 1]);
    cur.b = i + 2 < P.length ? P[i + 2] : null;
  }
  flush();
}
function nearRoad(x, z, margin) {
  const list = roadSegs.get(tileOf(x, z).join('_'));
  if (list) for (const [ax, az, bx, bz, hw] of list) if (segDist(x, z, ax, az, bx, bz) < hw + margin) return true;
  return false;
}

// Drivable graph for traffic / GPS / minimap: edges run between junctions.
const netIndex = new Map(), netXZ = [], edges = [];
const netIds = [];
const nodeIdx = (id, p) => { let i = netIndex.get(id); if (i === undefined) { i = netXZ.length / 2; netIndex.set(id, i); netXZ.push(q1(p[0]), q1(p[1])); netIds.push(id); } return i; };
for (const w of ways) {
  const info = w._road; if (!info || !info.car) continue;
  if (!w._pts.some(([x, z]) => inRegion(x, z))) continue;
  let start = 0;
  const vs = [0];
  for (let i = 1; i < w._pts.length; i++) vs.push(vs[i - 1] + Math.hypot(w._pts[i][0] - w._pts[i - 1][0], w._pts[i][1] - w._pts[i - 1][1]));
  for (let i = 1; i < w._ids.length; i++) {
    if (i === w._ids.length - 1 || (degCar.get(w._ids[i]) || 0) >= 3) {
      const h = vs.slice(start, i + 1).map((s) => q1(heightAlong(w, s)));
      edges.push({ a: nodeIdx(w._ids[start], w._pts[start]), b: nodeIdx(w._ids[i], w._pts[i]), p: flat(w._pts.slice(start, i + 1)), c: info.cls, o: info.oneway, l: info.lanes, w: q1(info.w), n: info.name || undefined, br: info.bridge || undefined, ...(h.some((v) => v > 0.05) ? { h } : {}) });
      start = i;
    }
  }
}

// ---------------------------------------------------------------------------------- buildings
const outlines = [], parts = [];
function addBuilding(list, id, tags, ring, holes) {
  ring = simplifyRing(openRing(ring));
  if (ring.length < 3) return;
  let a = signedArea(ring);
  if (Math.abs(a) < 5) return;
  if (a < 0) { ring.reverse(); a = -a; }
  holes = (holes || []).map((h) => { h = simplifyRing(openRing(h)); if (signedArea(h) > 0) h.reverse(); return h; }).filter((h) => h.length >= 3);
  const c = centroid(ring);
  if (!inRegion(c[0], c[1])) return;
  list.push({ id, tags, ring, holes, area: a, c, bb: bboxOf(ring) });
}
for (const w of ways) {
  const t = w.tags; if (!t || !w.geometry || w.geometry.length < 4) continue;
  if (t['building:part'] && t['building:part'] !== 'no') addBuilding(parts, w.id, t, proj(w.geometry));
  else if (t.building && t.building !== 'no') addBuilding(outlines, w.id, t, proj(w.geometry));
}
for (const r of rels) {
  const t = r.tags; if (!t || (t.type !== 'multipolygon' && t.type !== 'building')) continue;
  const isPart = t['building:part'] && t['building:part'] !== 'no';
  if (!isPart && !(t.building && t.building !== 'no')) continue;
  const mem = (role) => r.members.filter((m) => m.type === 'way' && m.geometry && (role === 'inner' ? m.role === 'inner' : m.role !== 'inner')).map((m) => proj(m.geometry));
  const inner = assemble(mem('inner'));
  for (const outer of assemble(mem('outer'))) addBuilding(isPart ? parts : outlines, r.id, t, outer, inner.filter((h) => pip(h[0][0], h[0][1], outer)));
}
// An outline whose parts cover most of it is drawn by the parts (OSM simple-3D-buildings rule).
const partsByTile = new Map();
for (const p of parts) { const k = tileOf(p.c[0], p.c[1]).join('_'); (partsByTile.get(k) ?? partsByTile.set(k, []).get(k)).push(p); }
const kept = [];
for (const o of outlines) {
  let covered = 0;
  eachTile(o.bb, (ix, iz) => { for (const p of partsByTile.get(`${ix}_${iz}`) || []) if (p.c[0] >= o.bb[0] && p.c[0] <= o.bb[2] && p.c[1] >= o.bb[1] && p.c[1] <= o.bb[3] && pip(p.c[0], p.c[1], o.ring)) covered += p.area; });
  if (covered < 0.4 * o.area) kept.push(o);
}
const buildings = kept.concat(parts);
const ROOF = { flat: 'f', gabled: 'g', hipped: 'h', pyramidal: 'p', skillion: 's', dome: 'd', half_hipped: 'h', round: 'd', onion: 'd' };
const kinds = {};
const named = {};
const bIndex = new Map(); // tile -> buildings (by bbox) for tree exclusion
for (const b of buildings) {
  const t = b.tags, [cx, cz] = b.c, z = zone(cx, cz), bt = t['building:part'] && t['building:part'] !== 'no' ? t['building:part'] : t.building;
  const levels = parseFloat(t['building:levels']), minLevel = parseFloat(t['building:min_level']), roofLevels = parseFloat(t['roof:levels']);
  const r = rnd(b.id, 1), r2 = rnd(b.id, 2);
  let kind;
  if (bt === 'wall') kind = 'wall';
  else if (z === 'palace' || z === 'temple' || t.historic || /temple|shrine|pagoda|palace|gate/.test(bt) || t.amenity === 'place_of_worship') kind = 'trad';
  else if (/station|transportation/.test(bt) || t.railway === 'station') kind = 'station';
  else if (/industrial|warehouse|garage|garages|shed|kiosk|toilets|service|hut|roof|carport|construction/.test(bt)) kind = 'low';
  else if (z === 'old' && b.area < 420 && !(levels > 2)) kind = 'hutong';
  else if (/commercial|office|retail|hotel|bank|mall/.test(bt)) kind = z === 'cbd' ? 'glass' : 'office';
  else if (/school|university|college|hospital|public|government|civic|kindergarten|library|museum/.test(bt)) kind = 'office';
  else if (/apartments|residential|dormitory|house|detached/.test(bt)) kind = 'resid';
  else if (z === 'cbd' && b.area > 600) kind = 'glass';
  else kind = z === 'old' && b.area < 420 ? 'hutong' : 'resid';
  let h = parseLen(t.height);
  if (!(h > 0) && levels > 0) h = levels * 3.2 + (roofLevels > 0 ? roofLevels * 2.4 : 0);
  if (!(h > 0)) {
    const s = Math.sqrt(b.area);
    h = kind === 'hutong' ? 4.2 + 1.8 * r
      : kind === 'trad' ? (bt === 'gate' ? 10 + 4 * r : 8 + 8 * r)
      : kind === 'wall' ? 4
      : kind === 'low' ? 4 + 3 * r
      : kind === 'glass' ? Math.min(230, 50 + s * (0.9 + 1.4 * r))
      : kind === 'station' ? 18
      : kind === 'office' ? 14 + 22 * r + (z === 'city' || z === 'cbd' ? 14 : 0)
      : b.area < 500 ? 11 + 8 * r : 18 + 28 * r + (z === 'city' ? 12 : 0);
  }
  let minH = parseLen(t.min_height);
  if (!(minH > 0)) minH = minLevel > 0 ? minLevel * 3.2 : 0;
  if (minH >= h) minH = 0;
  let roof = ROOF[t['roof:shape']] || (kind === 'hutong' ? 'g' : kind === 'trad' ? 'h' : 'f');
  const o = obb(b.ring);
  let rh = parseLen(t['roof:height']);
  if (!(rh > 0)) rh = roof === 'g' || roof === 'h' ? Math.min(o.hw * 0.7, kind === 'trad' ? 9 : 3.5) : roof === 'p' ? o.hw * 0.8 : roof === 's' ? 1.2 : roof === 'd' ? o.hw : 0;
  if (roof !== 'f' && rh > h * 0.6) rh = h * 0.6;
  kinds[kind] = (kinds[kind] || 0) + 1;
  const rec = { i: b.id, k: kind, h: q1(h), m: q1(minH), r: roof, rh: q1(rh), o: flat(b.ring) };
  if (b.holes.length) rec.hs = b.holes.map(flat);
  const c = colour(t['building:colour'] || t.colour); if (c) rec.c = c;
  const rc = colour(t['roof:colour']); if (rc) rec.rc = rc;
  if (roof === 'g' || roof === 'h') rec.ob = [q1(o.cx), q1(o.cz), +o.angle.toFixed(4), q1(o.hl), q1(o.hw)];
  if (t.name) { rec.n = t.name; named[t.name] = [q1(cx), q1(cz)]; }
  rec.s = +(r2).toFixed(3);
  // A building a deck runs through goes (a ramp of 国贸桥 ran through a kiosk 15 m tall and the car
  // stopped dead against its walls); one low enough to stand under the deck's soffit stays.
  let deck = deckOver(cx, cz);
  for (const [x, z] of b.ring) deck = Math.min(deck, deckOver(x, z));
  if (deck < Infinity && h > deck - 1.5) { underCut++; continue; }
  tile(...tileOf(cx, cz)).buildings.push(rec);
  eachTile(b.bb, (ix, iz) => { const k = `${ix}_${iz}`; (bIndex.get(k) ?? bIndex.set(k, []).get(k)).push(b); });
}
function inBuilding(x, z, margin = 0) {
  for (const b of bIndex.get(tileOf(x, z).join('_')) || []) {
    if (x < b.bb[0] - margin || x > b.bb[2] + margin || z < b.bb[1] - margin || z > b.bb[3] + margin) continue;
    if (pip(x, z, b.ring)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------- ground areas
function areaKind(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || /reservoir|basin/.test(t.landuse || '') || t.water) return 'water';
  if (t.place === 'square' || t['area:highway'] || (t.highway === 'pedestrian' && t.area === 'yes') || t.amenity === 'marketplace') return 'plaza';
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'stadium' || t.leisure === 'sports_centre') return 'pitch';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub' || t.natural === 'shrubbery') return 'wood';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'recreation_ground' || t.landuse === 'village_green') return 'park';
  if (t.landuse === 'grass' || t.natural === 'grass' || t.landuse === 'meadow' || t.landuse === 'flowerbed') return 'grass';
  if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return 'parking';
  if (t.landuse === 'railway') return 'rail';
  return null;
}
const areaPolys = [];
for (const w of ways) {
  const t = w.tags; if (!t || !w.geometry || w.geometry.length < 4 || w._road) continue;
  if (!eq([w.geometry[0].lat, w.geometry[0].lon], [w.geometry.at(-1).lat, w.geometry.at(-1).lon])) continue;
  const k = areaKind(t); if (k) areaPolys.push({ k, outer: openRing(proj(w.geometry)), holes: [], id: w.id });
}
for (const r of rels) {
  const t = r.tags; if (!t || t.type !== 'multipolygon') continue;
  const k = areaKind(t); if (!k) continue;
  const inner = assemble(r.members.filter((m) => m.type === 'way' && m.geometry && m.role === 'inner').map((m) => proj(m.geometry)));
  for (const outer of assemble(r.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => proj(m.geometry)))) areaPolys.push({ k, outer, holes: inner.filter((h) => pip(h[0][0], h[0][1], outer)), id: r.id });
}
const areaCount = {};
for (const a of areaPolys) {
  if (signedArea(a.outer) < 0) a.outer.reverse();
  a.holes = a.holes.map((h) => (signedArea(h) > 0 ? h.reverse() : h));
  areaCount[a.k] = (areaCount[a.k] || 0) + 1;
  eachTile(bboxOf(a.outer), (ix, iz) => {
    const x0 = ix * TILE, z0 = iz * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
    const o = clipRing(a.outer, x0, z0, x1, z1);
    if (o.length < 3 || Math.abs(signedArea(o)) < 1) return;
    const hs = a.holes.map((h) => clipRing(h, x0, z0, x1, z1)).filter((h) => h.length >= 3 && Math.abs(signedArea(h)) > 1);
    const rec = { k: a.k, o: flat(o) };
    if (hs.length) rec.hs = hs.map(flat);
    tile(ix, iz).areas.push(rec);
  });
}

// ---------------------------------------------------------------------------------- trees, lamps, street furniture
const treeType = (x, z, id) => {
  const zz = zone(x, z), r = rnd(id, 7);
  if (zz === 'temple') return r < 0.85 ? 2 : 0;       // 天坛's old cypress groves
  if (zz === 'palace') return 2;
  return r < 0.62 ? 0 : r < 0.84 ? 1 : 3;              // 0 国槐 scholar tree, 1 杨树 poplar, 2 柏树 cypress, 3 银杏 ginkgo
};
let nTrees = 0, treeSeed = 1;
function addTree(x, z, kind, drop = false) {
  if (!inRegion(x, z) || inBuilding(x, z, 0.8) || nearRoad(x, z, 1.2)) return;
  // Off the decks and out from under them - still using up its seed, so every other tree in the
  // city keeps the species and size it had before the interchanges were lifted.
  if (drop || underDeck(x, z)) { treeSeed++; return; }
  const t = tile(...tileOf(x, z));
  t.trees.push(q1(x), q1(z), kind ?? treeType(x, z, treeSeed), +(0.8 + 0.45 * rnd(treeSeed, 9)).toFixed(2));
  treeSeed++; nTrees++;
}
for (const n of nodes) if (n.tags?.natural === 'tree') { const [x, z] = project(n.lat, n.lon); addTree(x, z); }
for (const w of ways) if (w.tags?.natural === 'tree_row' && w.geometry) {
  const p = proj(w.geometry);
  for (let i = 1; i < p.length; i++) { const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); for (let s = 0; s < L; s += 7) addTree(p[i - 1][0] + (p[i][0] - p[i - 1][0]) * s / L, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * s / L); }
}
// Scatter in woods and parks (jittered grid, deterministic).
for (const a of areaPolys) {
  if (a.k !== 'wood' && a.k !== 'park') continue;
  const step = a.k === 'wood' ? 8 : 16;
  const [x0, z0, x1, z1] = bboxOf(a.outer);
  for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
    const id = Math.round(x * 7 + z * 13);
    const px = x + (rnd(id, 3) - 0.5) * step * 0.9, pz = z + (rnd(id, 4) - 0.5) * step * 0.9;
    if (!pip(px, pz, a.outer) || a.holes.some((h) => pip(px, pz, h))) continue;
    if (a.k === 'park' && rnd(id, 5) < 0.35) continue;
    addTree(px, pz);
  }
}
// Street trees and lamps along the drivable roads.
const STREET_TREES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk']);
// Every street is lit, the lanes too (a residential street with no lamps was a black canyon at
// night): lamp spacing in metres per class. Service roads (driveways, car parks) stay dark.
const LAMPS = {
  motorway: 36, trunk: 32, primary: 32, secondary: 32, tertiary: 30, unclassified: 28, residential: 26, living_street: 24, busway: 32,
  motorway_link: 32, trunk_link: 30, primary_link: 30, secondary_link: 30, tertiary_link: 30,
};
const nearTree = (x, z, r) => { const t = tiles.get(tileOf(x, z).join('_')); if (!t) return false; for (let i = 0; i < t.trees.length; i += 4) if (Math.abs(t.trees[i] - x) < r && Math.abs(t.trees[i + 1] - z) < r) return true; return false; };
let nLamps = 0;
for (const w of ways) {
  const info = w._road; if (!info || !info.car) continue;
  const p = w._pts, ids = w._ids;
  const junctions = ids.map((id, i) => ((degCar.get(id) || 0) >= 3 ? p[i] : null)).filter(Boolean);
  // Lamps start half a gap in: from 0, every way put one at its junction end, so they bunched at
  // corners (three or four within 10 m) and left the middle of short blocks dark.
  let acc = 0, lampAcc = (LAMPS[info.cls] ?? 0) / 2, side = 1;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
    for (let s = (9 - acc % 9) % 9; s < L; s += 9) {
      const x = ax + dx * s, z = az + dz * s;
      if (junctions.some((j) => Math.hypot(j[0] - x, j[1] - z) < 14)) continue;
      // None along a deck or a ramp (`drop`: the seed is spent all the same, see addTree).
      const up = heightAlong(w, acc + s) > 0.3;
      if (STREET_TREES.has(info.cls)) for (const sd of info.oneway ? [1] : [1, -1]) addTree(x + nx * sd * (info.w / 2 + 2.2), z + nz * sd * (info.w / 2 + 2.2), undefined, up);
    }
    const gap = LAMPS[info.cls];
    if (gap) for (let s = (gap - lampAcc % gap) % gap; s < L; s += gap) {
      const x = ax + dx * s, z = az + dz * s;
      const off = info.w / 2 + 0.9;
      const lx = x + nx * side * off, lz = z + nz * side * off;
      // The arm (+z of the model) points back over the carriageway. Taken before `side` flips:
      // taking it after pointed every two-way street's arms away from the road.
      const yaw = Math.atan2(-nx * side, -nz * side);
      side = info.oneway ? 1 : -side;
      if (!inRegion(lx, lz) || inBuilding(lx, lz, 0.5) || nearTree(lx, lz, 1.2) || underDeck(lx, lz)) continue;
      tile(...tileOf(lx, lz)).lamps.push(q1(lx), q1(lz), +yaw.toFixed(3));
      nLamps++;
    }
    acc += L; lampAcc += L;
  }
}
// Nearest drivable road direction at a point (for crossings and bus stops).
function roadAt(x, z, maxD) {
  let best = null;
  for (const [ax, az, bx, bz, hw] of roadSegs.get(tileOf(x, z).join('_')) || []) {
    const d = segDist(x, z, ax, az, bx, bz);
    if (d < maxD + hw && (!best || d - hw < best.d)) best = { d: d - hw, ang: Math.atan2(bz - az, bx - ax), hw };
  }
  return best;
}
let nSignals = 0, nCross = 0, nStops = 0;
for (const n of nodes) {
  const hwy = n.tags?.highway; if (!hwy) continue;
  const [x, z] = project(n.lat, n.lon); if (!inRegion(x, z)) continue;
  const t = tile(...tileOf(x, z));
  if (underDeck(x, z) && nodeHeight(n.id) > 0.3) continue;
  if (hwy.includes('traffic_signals')) { t.signals.push(q1(x), q1(z)); nSignals++; }
  if (hwy.includes('crossing') || n.tags.crossing) {
    const r = roadAt(x, z, 3);
    if (r && r.hw * 2 >= 5) { t.crossings.push(q1(x), q1(z), +r.ang.toFixed(3), q1(r.hw * 2)); nCross++; }
  }
  if (hwy === 'bus_stop') {
    const r = roadAt(x, z, 14);
    if (r) { t.stops.push(q1(x), q1(z), +r.ang.toFixed(3)); nStops++; }
  }
}
// Signalised network nodes (for traffic lights): nearest graph node within 30 m of a signal.
const sig = new Uint8Array(netXZ.length / 2);
for (const n of nodes) if (n.tags?.highway?.includes('traffic_signals')) {
  const [x, z] = project(n.lat, n.lon);
  let bi = -1, bd = 30;
  for (let i = 0; i < netXZ.length; i += 2) { const d = Math.hypot(netXZ[i] - x, netXZ[i + 1] - z); if (d < bd) { bd = d; bi = i / 2; } }
  if (bi >= 0 && nodeHeight(netIds[bi]) < 0.5) sig[bi] = 1;
}

// ---------------------------------------------------------------------------------- spawn
// On Chang'an Avenue (建国门外大街) west of 国贸桥, facing west towards Tiananmen: the widest named
// main carriageway near the target, not whatever service road happens to be closest.
const [sx, sz] = project(39.9085, 116.4500);
let spawn = null;
const rank = { trunk: 3, primary: 3, secondary: 2, tertiary: 1 };
for (const e of edges) {
  const named = /长安街|建国门外大街|建国门内大街/.test(e.n || '');
  const score0 = (rank[e.c] || 0) + (named ? 2 : 0);
  if (score0 < 2) continue;
  for (let i = 0; i + 3 < e.p.length; i += 2) {
    const ax = e.p[i], az = e.p[i + 1], bx = e.p[i + 2], bz = e.p[i + 3];
    const d = segDist(sx, sz, ax, az, bx, bz);
    if (d > 400) continue;
    let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (e.o && dx > 0) continue;          // one-way eastbound carriageway: not ours
    if (dx > 0) { dx = -dx; dz = -dz; }
    const score = score0 * 100 + e.w * 5 - d;
    if (!spawn || score > spawn.score) spawn = { score, d: Math.round(d), x: q1((ax + bx) / 2), z: q1((az + bz) / 2), yaw: +Math.atan2(dx, dz).toFixed(4), road: e.n || e.c, cls: e.c, w: e.w };
  }
}

console.log(`buildings cut by a deck: ${underCut}`);
// Far skyline: every building of 20 m or more as an oriented box, for the distant city silhouette.
const sky = [];
for (const [, t] of tiles) for (const b of t.buildings) {
  if (b.h < 20) continue;
  const r = []; for (let i = 0; i < b.o.length; i += 2) r.push([b.o[i], b.o[i + 1]]);
  const o = obb(r);
  sky.push(q1(o.cx), q1(o.cz), +o.angle.toFixed(3), q1(o.hl), q1(o.hw), q1(b.h), ['glass', 'office', 'resid', 'hutong', 'trad', 'wall', 'low', 'station'].indexOf(b.k), +b.s.toFixed(2));
}

// ---------------------------------------------------------------------------------- write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = {};
let bytes = 0;
// Each tile also gets its neighbours' carriageways within CTX m of its edge (`ctx`, not drawn): its
// parapets must open where a road from the next tile runs over them, and its piers must not land on
// one. The trunk_link off 建国门外大街 at x 3067 is in tile 11_0, the main line beside it in 12_0, and
// 12_0's parapet stood straight across the link.
const CTX = 80;
for (const [k, t] of tiles) {
  const [ix, iz] = k.split('_').map(Number), x0 = ix * TILE - CTX, z0 = iz * TILE - CTX, x1 = (ix + 1) * TILE + CTX, z1 = (iz + 1) * TILE + CTX;
  const ctx = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    const n = tiles.get(`${ix + dx}_${iz + dz}`);
    if (n) for (const r of n.roads) {
      if (!CAR.has(r.c)) continue;
      // By segment, not by point: a 40 m segment can pass the edge with both its ends far off it.
      let inside = false;
      const inBox = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
      for (let i = 2; i < r.p.length && !inside; i += 2) {
        const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
        for (let t = 0; t <= 1 && !inside; t += 0.125) inside = inBox(ax + (bx - ax) * t, az + (bz - az) * t);
      }
      if (inside) ctx.push({ c: r.c, w: r.w, o: r.o, l: r.l, br: r.br, p: r.p, j: r.j, a: r.a, b: r.b, ...(r.h ? { h: r.h } : {}) });
    }
  }
  if (ctx.length && t.roads.some((r) => r.h) || ctx.some((r) => r.h)) t.ctx = ctx;
}
for (const [k, t] of tiles) {
  if (!t.roads.length && !t.buildings.length && !t.areas.length && !t.trees.length) continue;
  const s = JSON.stringify(t);
  fs.writeFileSync(path.join(OUT, `t_${k}.json`), s);
  index[k] = [t.buildings.length, t.roads.length, t.trees.length / 4];
  bytes += s.length;
}
const net = JSON.stringify({ nodes: netXZ, sig: Array.from(sig), edges });
fs.writeFileSync(path.join(OUT, 'network.json'), net);
const manifest = {
  version: 1, tile: TILE, origin: { lat: 39.90883, lon: 116.39757 },
  bounds: { x0: q1(RX0), z0: q1(RZ0), x1: q1(RX1), z1: q1(RZ1) }, tiles: index, spawn, named,
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(OUT, 'skyline.json'), JSON.stringify({ b: sky }));
console.log(`skyline ${sky.length / 8} buildings`);
console.log(`tiles ${Object.keys(index).length}, ${(bytes / 1e6).toFixed(1)} MB; network ${(net.length / 1e6).toFixed(1)} MB (${netXZ.length / 2} nodes, ${edges.length} edges, ${sig.reduce((a, b) => a + b, 0)} signalised)`);
console.log(`buildings ${buildings.length} (outlines kept ${kept.length}/${outlines.length}, parts ${parts.length})`, kinds);
console.log(`road pieces ${roadPieces}, areas`, areaCount, `trees ${nTrees}, lamps ${nLamps}, signals ${nSignals}, crossings ${nCross}, stops ${nStops}`);
console.log('spawn', spawn);
