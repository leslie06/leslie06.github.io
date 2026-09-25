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
const lifted = new Map(); // way -> { H, over: [{ o, x, z }] }
const overOf = new Map();
for (const w of carWays) {
  if (!isBridgeT(w.tags)) continue;
  const L = layerOf(w.tags);
  const over = crossings(w, carGrid).filter(({ it }) => !isBridgeT(it.w.tags) || layerOf(it.w.tags) < L).map(({ it, x, z }) => ({ o: it.w, x, z }));
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
  w._dense = D;
  const lf = lifted.get(w);
  if (lf) for (const d of D) LB.set(d.key, Math.max(LB.get(d.key) ?? 0, lf.H));
}
for (const [, lf] of lifted) for (const { o, x, z } of lf.over) if (!lifted.has(o)) for (const d of o._dense) if (Math.hypot(d.x - x, d.z - z) < PIN) pinned.add(d.key);
// A slip road leaving or joining a deck runs alongside it, overlapping, for a while: it stays at the
// deck's height until it is clear of it, and only then ramps down. Before this it started down from
// the shared node, was 2 m under the deck's edge where they overlapped, and the parapets closed the
// merge on 东三环 (the car stuck between the ramp's and the deck's).
const waysAt = new Map();
for (const w of carWays) for (const id of w._ids) (waysAt.get(id) ?? waysAt.set(id, []).get(id)).push(w);
const polyDist = (P, x, z) => { let m = Infinity; for (let i = 1; i < P.length; i++) m = Math.min(m, segDist(x, z, P[i - 1][0], P[i - 1][1], P[i][0], P[i][1])); return m; };
let hugged = 0;
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
// A tiny binary heap for the two Dijkstras.
class Heap {
  constructor(less) { this.a = []; this.less = less; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
// Down from the decks at GRADE (highest first), never onto a pinned point.
const HT = new Map(LB);
{
  const q = new Heap((a, b) => a[0] > b[0]);
  for (const [k, h] of LB) q.push([h, k]);
  while (q.size) {
    const [h, k] = q.pop();
    if (h < (HT.get(k) ?? 0)) continue;
    for (const [nb, d] of adj.get(k) ?? []) {
      const c = h - GRADE * d;
      if (c <= 0.02 || pinned.has(nb) || c <= (HT.get(nb) ?? 0)) continue;
      HT.set(nb, c); q.push([c, nb]);
    }
  }
}
// And no faster than STEEP up from a pinned point.
{
  const U = new Map(), q = new Heap((a, b) => a[0] < b[0]);
  for (const k of pinned) { U.set(k, 0); q.push([0, k]); HT.delete(k); }
  while (q.size) {
    const [u, k] = q.pop();
    if (u > (U.get(k) ?? Infinity) || u > 30) continue;
    for (const [nb, d] of adj.get(k) ?? []) { const c = u + STEEP * d; if (c < (U.get(nb) ?? Infinity)) { U.set(nb, c); q.push([c, nb]); } }
  }
  // Decks too: where OSM joins a bridge straight onto the road it crosses (a few places round 四惠),
  // holding the deck flat left a 6.5 m cliff in 9 m; now it comes down at STEEP instead.
  for (const [k, u] of U) if ((HT.get(k) ?? 0) > u) HT.set(k, u);
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
console.log(`elevation: ${overOf.size} bridges over a road or railway, ${lifted.size} ways lifted, ${pinned.size} points pinned under them, ${hugged} slip-road points held level with a deck, ${(elevLen / 1000).toFixed(1)} km of road above ground`);

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
  for (let i = 0; i < w._pts.length; i++) {
    if (i > 0) {
      const [ax, az] = w._pts[i - 1], [bx, bz] = w._pts[i];
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 40);
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
