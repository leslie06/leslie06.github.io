// Turn the cached OSM chunks (.cache/osm, from extract-pbf.mjs or fetch-osm.mjs) into the streamed city the game loads:
//   public/city/manifest.json   bounds, tile index, spawn, named places
//   public/city/network.json    drivable road graph (traffic, GPS, minimap)
//   public/city/t_<ix>_<iz>.json one 256 m tile: road pieces, buildings, ground areas, trees, lamps,
//                                signals, crossings, bus stops
// Local metres, +X east, +Z south (region.mjs). Outer rings have positive signed area in (x, z),
// holes negative. Data © OpenStreetMap contributors, ODbL.
import polygonClipping from 'polygon-clipping';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pinyinOf } from './pinyin.mjs';
import { available as extraAvailable, clsmFootprints, grid, heightRasters, sample, scan } from './extra-buildings.mjs';
import { REGIONS, TILE, project } from './region.mjs';

const RAW = path.resolve('.cache/osm');
const OUT = path.resolve('public/city');

// ---------------------------------------------------------------------------------- load
const els = new Map();
// The main box's chunks first (digits sort before the corridors' tags), and an element already read is
// kept: a corridor fetched later may carry a newer edit of a way the main box has, and taking it would
// move things in the city already built.
for (const f of fs.readdirSync(RAW).filter((f) => /^chunk-[a-z]?\d+-\d+\.json$/.test(f)).sort()) {
  for (const e of JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')).elements) if (!els.has(e.type[0] + e.id)) els.set(e.type[0] + e.id, e);
}
const ways = [], rels = [], nodes = [];
for (const e of els.values()) (e.type === 'way' ? ways : e.type === 'relation' ? rels : nodes).push(e);

// ---------------------------------------------------------------------------------- helpers
function hash32(a) { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const rnd = (id, salt = 0) => hash32(((id % 4294967296) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
const proj = (g) => g.map((p) => project(p.lat, p.lon));
const q1 = (v) => Math.round(v * 10) / 10, q1v = q1;
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
// The playable area is a union of boxes (region.mjs REGIONS): the main one and the corridors.
const RECTS = REGIONS.map((b) => [...project(b.n, b.w), ...project(b.s, b.e)]);
const RX0 = Math.min(...RECTS.map((r) => r[0])), RZ0 = Math.min(...RECTS.map((r) => r[1]));
const RX1 = Math.max(...RECTS.map((r) => r[2])), RZ1 = Math.max(...RECTS.map((r) => r[3]));
const inRect = (r, x, z) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
const inRegion = (x, z) => RECTS.some((r) => inRect(r, x, z));
const inMain = (x, z) => inRect(RECTS[0], x, z);
const tiles = new Map();
const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
function tile(ix, iz) {
  const k = `${ix}_${iz}`;
  let t = tiles.get(k);
  if (!t) { t = { ix, iz, roads: [], buildings: [], areas: [], trees: [], lamps: [], signals: [], crossings: [], stops: [] }; tiles.set(k, t); }
  return t;
}
function eachTile(bb, fn) {
  let seen = null;
  for (const R of RECTS) {
    if (bb[0] > R[2] || bb[2] < R[0] || bb[1] > R[3] || bb[3] < R[1]) continue;
    const [a, b] = tileOf(Math.max(bb[0], R[0]), Math.max(bb[1], R[1])), [c, d] = tileOf(Math.min(bb[2], R[2]), Math.min(bb[3], R[3]));
    for (let ix = a; ix <= c; ix++) for (let iz = b; iz <= d; iz++) {
      if (RECTS.length > 1) { const k = ix * 65536 + iz; if ((seen ??= new Set()).has(k)) continue; seen.add(k); }
      fn(ix, iz);
    }
  }
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
// The imperial core: OSM's palace polygon, and always the box round it. OSM (WGS-84) puts the Tiananmen
// gate at x = -544, not at the map origin (a GCJ-02 point ~540 m east), so the box follows the OSM
// axis: the Forbidden City walls (z -1420..-420) plus the gate precinct with 太庙, 社稷坛, the 朝房 and
// the reviewing stands either side of the gate (z to 225, Chang'an Avenue's north kerb). The polygon
// alone (故宫博物院) stops at 午门, and the precinct's untagged buildings came out as 18-58 m blocks.
function zone(x, z) {
  if ((palacePoly && pip(x, z, palacePoly)) || (x > -940 && x < -150 && z > -1420 && z < 225)) return 'palace';
  if (templePoly && pip(x, z, templePoly)) return 'temple';
  if (x > 4650 && x < 6500 && z > -1650 && z < 750) return 'cbd';
  // The old city: inside the 2nd Ring (its box; 东二环 at x ~2850 is where it used to stop, when the map
  // began a kilometre west of Tiananmen - with the map out to the 4th Ring, 公主坟 was "old" too).
  if (x > -4650 && x < 2850 && z > -4350 && z < 4850) return 'old';
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
const NO_TUNNELS = !!process.env.NO_TUNNELS;
function roadInfo(t) {
  const cls = t.highway, R = ROAD[cls];
  if (!R || t.area === 'yes') return null;
  // Underpasses (下穿): a car road's tunnel is kept and sunk (see "underpasses" below); a path's, a
  // service road's (an underground car park's ramp) or a living street's is left out as before.
  const tunnel = t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage';
  const sunkOK = !NO_TUNNELS && CAR.has(cls) && cls !== 'service' && cls !== 'living_street';
  if (tunnel && !sunkOK) return null;
  if (Number(t.layer) < 0 && !(t.bridge && t.bridge !== 'no') && !sunkOK) return null;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || cls === 'motorway' ? 1 : t.oneway === '-1' ? -1 : 0;
  const lanes = parseInt(t.lanes, 10);
  let w = parseLen(t.width);
  if (!(w > 1.5)) w = lanes > 0 && CAR.has(cls) ? lanes * 3.3 + (oneway ? 1 : 1.5) : R[oneway ? 0 : 1];
  return { cls, w, oneway, lanes: lanes > 0 ? lanes : 0, car: CAR.has(cls), name: t.name || '', bridge: t.bridge && t.bridge !== 'no' ? 1 : 0, tunnel: tunnel ? 1 : 0, below: tunnel || (Number(t.layer) < 0 && !(t.bridge && t.bridge !== 'no')) ? 1 : 0 };
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
// The elevation solve below works on the ways on and above the ground; the tunnels and the ways under
// the ground (layer < 0) join after it (underpasses), so a bridge over a tunnel is not lifted.
const carWays = ways.filter((w) => w._road?.car && !w._road.below);
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
const demotedWays = [];
for (const [W, lf] of [...lifted]) for (const { o, x, z } of lf.over) if (!lifted.has(o) && heightNear(W, x, z) < DECK - 1.2) { lifted.delete(W); demoted++; demotedWays.push(W); break; }
// A dual carriageway's other half goes with it (2026-10-01): 紫竹院路's two bridges over 西三环 are separate
// ways; one could not climb and went flat, the other stayed a deck, was tied down to its flat twin and
// ended 0-0.5 m up with parapets standing across all four carriageways it crosses.
const bbOf = (W) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of W._pts) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, z); d = Math.max(d, z); } return [a, b, c, d]; };
for (const D of demotedWays) {
  if (!D.tags.name) continue;
  const [a, b, c, d] = bbOf(D);
  for (const [W] of [...lifted]) {
    if (W.tags.name !== D.tags.name) continue;
    const [e, f, g, h] = bbOf(W);
    if (e > c + 30 || g < a - 30 || f > d + 30 || h < b - 30) continue;
    lifted.delete(W); demoted++;
  }
}
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
// ---------------------------------------------------------------------------------- underpasses (下穿)
// A car road's tunnel (OSM tunnel=yes: the covered part, between two ways of the same road) goes down to
// -TUN.D and its approaches come down to it at TUN.G along the ways that continue it - never through a
// junction (a node where three car roads meet is held on the ground, and rises at most TUN.STEEP from it).
// A tunnel its approaches cannot take down to TUN.CLEAR before a junction is left out, as all tunnels
// were before (OSM's 下穿 often joins its 辅路 a few metres past the portal). A ground road crossing over
// an open approach makes it covered there (and as deep as the tunnel). The covered stretches keep the
// ground over them; the open ones are holes in the ground, written to public/city/tunnels.json with the
// sunk roads' centre lines, heights, half widths (narrowed where another carriageway runs alongside or
// another trench runs beside) and covered flags, for city/visual/Tunnels.ts.
const TUN = { D: 6, G: 0.06, STEEP: 0.09, CLEAR: 5.3 };
const TRENCH = { ways: [], holes: [], open: new Map() };
{
  // the ways the solve left out join its graph now, dense points and all
  const below = ways.filter((w) => w._road?.car && w._road.below);
  for (const w of below) {
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
  }
  const allCar = [...carWays, ...below];
  const tun = below.filter((w) => w._road.tunnel);
  const SG = 25, segGrid = new Map();
  for (const w of allCar) { const D = w._dense; for (let i = 1; i < D.length; i++) { const k = `${Math.floor((D[i - 1].x + D[i].x) / 2 / SG)},${Math.floor((D[i - 1].z + D[i].z) / 2 / SG)}`; (segGrid.get(k) ?? segGrid.set(k, []).get(k)).push([w, i]); } }
  const segsNear = (x, z) => { const out = [], cx = Math.floor(x / SG), cz = Math.floor(z / SG); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(segGrid.get(`${cx + a},${cz + b}`) ?? [])); return out; };
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => { const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (!d) return false; const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  const active = new Set(tun), extra = new Map();   // extra: key -> the tunnel it hangs off
  let H = new Map(), src = new Map(), dropped = 0, passes = 0;
  for (let pass = 0; pass < 60; pass++) {
    passes = pass + 1;
    const sinks = new Map();
    for (const w of active) for (const d of w._dense) sinks.set(d.key, w);
    for (const [k, w] of extra) if (active.has(w)) sinks.set(k, w);
    // held: a junction (on the ground) or a point the decks raised (at its height)
    const isPin = (k) => !sinks.has(k) && ((degCar.get(Number(k)) ?? 0) >= 3 || (HT.get(k) ?? 0) > 0.05);
    const down = new Map(), heap = new Heap((a, b) => a[1] < b[1]);
    src = new Map();
    for (const [k, w] of sinks) { down.set(k, -TUN.D); src.set(k, w); heap.push([k, -TUN.D]); }
    while (heap.size) {
      const [k, v] = heap.pop();
      if (v > down.get(k) || isPin(k)) continue;
      for (const [n, l] of adj.get(k) ?? []) { const nv = v + TUN.G * l; if (nv < -0.02 && nv < (down.get(n) ?? 0)) { down.set(n, nv); src.set(n, src.get(k)); heap.push([n, nv]); } }
    }
    const cap = new Map(), h2 = new Heap((a, b) => a[1] < b[1]);
    // every held point the sinking reaches or touches (it stops short of one where it runs out of depth)
    const seeds = new Set();
    for (const k of down.keys()) { if (isPin(k)) seeds.add(k); for (const [n] of adj.get(k) ?? []) if (isPin(n)) seeds.add(n); }
    for (const k of seeds) { const c = -Math.max(0, HT.get(k) ?? 0); cap.set(k, c); h2.push([k, c]); }
    while (h2.size) {
      const [k, v] = h2.pop();
      if (v > cap.get(k)) continue;
      for (const [n, l] of adj.get(k) ?? []) { if (!down.has(n)) continue; const nv = v + TUN.STEEP * l; if (nv < (cap.get(n) ?? Infinity)) { cap.set(n, nv); h2.push([n, nv]); } }
    }
    H = new Map();
    for (const [k, v] of down) { const h = Math.max(v, -(cap.get(k) ?? Infinity)); if (h < -0.02) H.set(k, h); }
    let changed = false;
    for (const [k, w] of sinks) if ((H.get(k) ?? 0) > -TUN.CLEAR && active.has(w)) { active.delete(w); changed = true; dropped++; }
    if (changed) continue;
    // ground roads crossing over an open approach: covered there
    for (const w of allCar) {
      if (!w._road || active.has(w)) continue;
      const D = w._dense;
      for (let i = 1; i < D.length; i++) {
        const a = D[i - 1], b = D[i], ha = H.get(a.key) ?? 0, hb = H.get(b.key) ?? 0;
        if (Math.min(ha, hb) > -0.3 || (extra.has(a.key) && extra.has(b.key))) continue;
        for (const [o, j] of segsNear((a.x + b.x) / 2, (a.z + b.z) / 2)) {
          if (o === w || !o._road) continue;
          const p = o._dense[j - 1], q = o._dense[j];
          if ((H.get(p.key) ?? 0) < -0.3 || (H.get(q.key) ?? 0) < -0.3) continue;
          if ((HT.get(p.key) ?? 0) > 3 && (HT.get(q.key) ?? 0) > 3) continue;   // a deck high over it
          if (!cross(a.x, a.z, b.x, b.z, p.x, p.z, q.x, q.z)) continue;
          const t = src.get(a.key) ?? src.get(b.key);
          if (t) { extra.set(a.key, t); extra.set(b.key, t); changed = true; }
          break;
        }
      }
    }
    if (!changed) break;
  }
  if (process.env.TUN_AT) {
    const [tx, tz] = process.env.TUN_AT.split(',').map(Number);
    for (const w of allCar) for (const d of w._dense) if (Math.hypot(d.x - tx, d.z - tz) < 12) console.log('TUN', w.id, w._road?.cls, w._road?.tunnel ? 'tunnel' : '', d.key, d.x.toFixed(1), d.z.toFixed(1), 'HT', (HT.get(d.key) ?? 0).toFixed(2), 'H', (H.get(d.key) ?? 0).toFixed(2), 'deg', degCar.get(Number(d.key)) ?? '-', 'active', active.has(w));
  }
  for (const w of tun) if (!active.has(w)) w._road = null;
  // the final heights
  for (const [k, v] of H) HT.set(k, v);
  // An open trench must not stand in a ground carriageway beside it, and OSM often draws a 下穿 and the
  // road it runs beside closer than their widths (东四环中路's side roads 5.8 m from the main line,
  // 9 m of carriageway between them): the sunk points of an open stretch that overlap one are moved
  // away by the overlap (at most 6 m), the move fading out along the road over EASE m either way and
  // never through a junction, and every way through a moved point takes it (as the decks' "moved aside").
  for (let round = 0; round < 3; round++) {
    const EASE = 30, want = new Map();
    const sunkKey = (k) => (H.get(k) ?? 0) < -0.3;
    for (const w of allCar) {
      if (!w._road || w._road.tunnel) continue;
      const hw0 = w._road.w / 2;
      for (const d of w._dense) {
        if (!sunkKey(d.key) || extra.has(d.key)) continue;
        let best = null;
        for (const [o, j] of segsNear(d.x, d.z)) {
          if (o === w || !o._road) continue;
          const p = o._dense[j - 1], q = o._dense[j];
          if (sunkKey(p.key) || sunkKey(q.key) || (HT.get(p.key) ?? 0) > 2 || (HT.get(q.key) ?? 0) > 2) continue;
          const vx = q.x - p.x, vz = q.z - p.z, L2 = vx * vx + vz * vz || 1, t = clamp(((d.x - p.x) * vx + (d.z - p.z) * vz) / L2, 0, 1);
          const cx = d.x - (p.x + vx * t), cz = d.z - (p.z + vz * t), dist = Math.hypot(cx, cz) || 0.01;
          const over = hw0 + 0.6 + o._road.w / 2 - dist;
          if (over > 0.05 && (!best || over > best.m)) best = { m: Math.min(6, over), x: cx / dist, z: cz / dist };
        }
        if (best && (!want.get(d.key) || want.get(d.key).m < best.m)) want.set(d.key, best);
      }
    }
    // spread along the roads, fading over EASE m, stopped at junctions
    const shift = new Map(), heap = new Heap((a, b) => a[1] > b[1]);
    for (const [k, v] of want) { shift.set(k, v); heap.push([k, v.m]); }
    while (heap.size) {
      const [k, m] = heap.pop();
      const v = shift.get(k);
      if (!v || m < v.m - 1e-9 || (degCar.get(Number(k)) ?? 0) >= 3) continue;
      for (const [n, l] of adj.get(k) ?? []) {
        const nm = m - (6 / EASE) * l * (m / 6 + 0.5);   // a larger move fades over a little longer
        if (nm <= 0.02 || (shift.get(n)?.m ?? 0) >= nm || (degCar.get(Number(n)) ?? 0) >= 3) continue;
        shift.set(n, { m: nm, x: v.x, z: v.z }); heap.push([n, nm]);
      }
    }
    const touched = new Set();
    for (const w of allCar) for (const d of w._dense) { const v = shift.get(d.key); if (!v) continue; touched.add(w); }
    const moved = new Set();
    for (const w of touched) for (const d of w._dense) { const v = shift.get(d.key); if (!v || moved.has(d)) continue; d.x += v.x * v.m; d.z += v.z * v.m; moved.add(d); }
    // a node shared by two ways is two objects with one key: both moved above, once each
    for (const w of touched) {
      w._pts = w._dense.map((d) => [d.x, d.z]);
      w._ids = w._dense.map((d) => (/^\d+$/.test(d.key) ? Number(d.key) : `x${d.key}`));
      let s0 = 0; w._dense.forEach((d, i) => { if (i) s0 += Math.hypot(d.x - w._dense[i - 1].x, d.z - w._dense[i - 1].z); d.s = s0; });
    }
    segGrid.clear();
    for (const w of allCar) { const D = w._dense; for (let i = 1; i < D.length; i++) { const k = `${Math.floor((D[i - 1].x + D[i].x) / 2 / SG)},${Math.floor((D[i - 1].z + D[i].z) / 2 / SG)}`; (segGrid.get(k) ?? segGrid.set(k, []).get(k)).push([w, i]); } }
    const mx = [...want.values()].reduce((a, v) => Math.max(a, v.m), 0);
    console.log(`underpasses (round ${round + 1}): ${want.size} trench points overlapping a road beside them moved away (up to ${mx.toFixed(1)} m), ${shift.size} points moved in all`);
    if (!want.size) break;
  }
  // the sunk ways: covered and open stretches, half widths narrowed against what runs alongside
  const sunkWays = allCar.filter((w) => w._road && w._dense.some((d) => (H.get(d.key) ?? 0) < -0.1));
  const sunkSet = new Set(sunkWays);
  let open = 0, covered = 0;
  for (const w of sunkWays) {
    const D = w._dense, hw0 = w._road.w / 2;
    // each side on its own: a sunk carriageway alongside at its height and close (OSM often draws the
    // two directions of an underpass closer than their widths) makes one trench with it - no wall
    // between, the edge carried out to meet it; a ground carriageway alongside pulls the wall in, but
    // never more than 0.5 m into this road's own lanes
    const L = [], R = [], wl = [], wr = [];
    for (let i = 0; i < D.length; i++) {
      const d = D[i], pa = D[Math.max(0, i - 1)], pb = D[Math.min(D.length - 1, i + 1)], tl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
      const nx = -(pb.z - pa.z) / tl, nz = (pb.x - pa.x) / tl, hd = H.get(d.key) ?? 0;
      let l = hw0, r = hw0, wallL = true, wallR = true;
      for (const [o, j] of segsNear(d.x, d.z)) {
        if (o === w || !o._road) continue;
        const p = o._dense[j - 1], q = o._dense[j], ohw = o._road.w / 2;
        const vx = q.x - p.x, vz = q.z - p.z, L2 = vx * vx + vz * vz || 1, t = clamp(((d.x - p.x) * vx + (d.z - p.z) * vz) / L2, 0, 1);
        const cx = p.x + vx * t - d.x, cz = p.z + vz * t - d.z, dist = Math.hypot(cx, cz);
        if (dist > hw0 + ohw + 1 || dist < 0.3) continue;
        const left = cx * nx + cz * nz > 0;
        if (sunkSet.has(o)) {
          const ho = ((H.get(p.key) ?? 0) + (H.get(q.key) ?? 0)) / 2;
          if (Math.abs(ho - hd) > 2.5) continue;
          // one trench only with one like it: a tunnel beside an open trench keeps its wall (else you see
          // the sky from inside it, through the ground's underside)
          const mine = !!w._road.tunnel || extra.has(d.key), theirs = !!o._road.tunnel || (extra.has(p.key) && extra.has(q.key));
          if (mine !== theirs) continue;
          if (left) { wallL = false; l = Math.max(l, dist - ohw + 0.3); } else { wallR = false; r = Math.max(r, dist - ohw + 0.3); }
        } else if ((HT.get(p.key) ?? 0) < 2) {
          const lim = Math.max(hw0 - 0.5, Math.min(hw0, dist - ohw - 0.2));
          if (left) l = Math.min(l, lim); else r = Math.min(r, lim);
        }
      }
      L.push(l); R.push(r); wl.push(wallL); wr.push(wallR);
    }
    const cov = [], eL = [], eR = [];
    for (let i = 1; i < D.length; i++) {
      const c = !!w._road.tunnel || (extra.has(D[i - 1].key) && extra.has(D[i].key));
      cov.push(c); eL.push(wl[i - 1] && wl[i]); eR.push(wr[i - 1] && wr[i]);
      const ha = H.get(D[i - 1].key) ?? 0, hb = H.get(D[i].key) ?? 0;
      if (Math.min(ha, hb) < -0.1) { if (c) covered += D[i].s - D[i - 1].s; else open += D[i].s - D[i - 1].s; }
    }
    TRENCH.open.set(w, cov.map((c, i) => !c && Math.min(H.get(D[i].key) ?? 0, H.get(D[i + 1].key) ?? 0) < -0.1));
    TRENCH.ways.push({ w, L, R, cov, eL, eR });
    // holes: each run of open segments as one ring, the left edge forward and the right edge back
    const op = TRENCH.open.get(w);
    for (let i = 0; i < op.length;) {
      if (!op[i]) { i++; continue; }
      let j = i; while (j + 1 < op.length && op[j + 1]) j++;
      const Lr = [], Rr = [];
      for (let k = i; k <= j + 1; k++) {
        const pa = D[Math.max(0, k - 1)], pb = D[Math.min(D.length - 1, k + 1)], l = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
        const nx = -(pb.z - pa.z) / l, nz = (pb.x - pa.x) / l;
        Lr.push([D[k].x + nx * L[k], D[k].z + nz * L[k]]); Rr.push([D[k].x - nx * R[k], D[k].z - nz * R[k]]);
      }
      TRENCH.holes.push([...Lr, ...Rr.reverse()]);
      i = j + 1;
    }
  }
  // overlapping holes (the two carriageways' trenches side by side) become one: the ground is
  // triangulated round them, which needs holes that do not overlap
  if (TRENCH.holes.length) {
    const close = (r) => [...r, r[0]];
    try {
      const u = polygonClipping.union(...TRENCH.holes.map((h) => [[close(h)]]));
      TRENCH.holes = u.map((poly) => poly[0].slice(0, -1));
    } catch (e) { console.warn('underpasses: union failed', e.message); }
  }
  console.log(`underpasses: solved in ${passes} passes; ${active.size} tunnels kept, ${dropped} left out (no room for the approaches), ${extra.size} approach points covered by a road over them; ${(covered / 1000).toFixed(1)} km covered, ${(open / 1000).toFixed(1)} km open, ${TRENCH.holes.length} holes`);
}
/** Whether way w is an open trench at arc length s (its carriageway is a hole in the ground there). */
const trenchOpen = (w, s) => { const op = TRENCH.open.get(w); if (!op) return false; const D = w._dense; for (let i = 1; i < D.length; i++) if (s <= D[i].s) return op[i - 1]; return false; };
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
const carSegs = new Map();  // the same for the carriageways on the ground, for keeping lamp posts out of them
function addSeg(ax, az, bx, bz, hw, car = false, cls = '', way = 0) {
  eachTile([Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw], (ix, iz) => {
    const k = `${ix}_${iz}`; (roadSegs.get(k) ?? roadSegs.set(k, []).get(k)).push([ax, az, bx, bz, hw]);
    if (car) (carSegs.get(k) ?? carSegs.set(k, []).get(k)).push([ax, az, bx, bz, hw, cls, way]);
  });
}
/** Whether (x, z) is on a carriageway on the ground (or within `margin` of one). */
function inCarriageway(x, z, margin) {
  for (const [ax, az, bx, bz, hw] of carSegs.get(tileOf(x, z).join('_')) ?? []) if (segDist(x, z, ax, az, bx, bz) < hw + margin) return true;
  return false;
}
let roadPieces = 0;
for (const w of ways) {
  const info = w._road; if (!info) continue;
  const P = [], J = [], PS = [];
  let run = 0;
  // A point every 40 m, or every 10 m on a way with any height: the heights are linear between points,
  // and at 40 m two overlapping roads interpolated their ramps' feet and tops a metre apart.
  const step = info.car && w._dense?.some((d) => Math.abs(HT.get(d.key) ?? 0) > 0.02) ? 10 : 40;
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
    tile(cur.ix, cur.iz).roads.push({ c: info.cls, w: q1(info.w), o: info.oneway ? 1 : 0, l: info.lanes, br: info.bridge, n: info.name || undefined, p: flat(cur.p), j: cur.j, a: cur.a ? flat([cur.a]) : 0, b: cur.b ? flat([cur.b]) : 0, ...(h.some((v) => Math.abs(v) > 0.05) ? { h } : {}) });
    roadPieces++;
  };
  for (let i = 0; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2, mz = (P[i][1] + P[i + 1][1]) / 2;
    { const hm = heightAlong(w, (PS[i] + PS[i + 1]) / 2); addSeg(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], info.w / 2, info.car && hm < 2 && (hm > -0.5 || trenchOpen(w, (PS[i] + PS[i + 1]) / 2)), info.cls, w.id); }
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
  const vs = [0];
  for (let i = 1; i < w._pts.length; i++) vs.push(vs[i - 1] + Math.hypot(w._pts[i][0] - w._pts[i - 1][0], w._pts[i][1] - w._pts[i - 1][1]));
  // Only the stretches drawn (a segment is in when its midpoint is, as for the tiles' pieces): whole
  // ways used to go in, and 东五环 or the airport expressway ran on for kilometres past the data's
  // edge - traffic drove where no road was drawn, and the router's seed links (the longest, fastest)
  // were those stubs, so its giant component came out one link and no route was found anywhere.
  const segIn = (i) => inRegion((w._pts[i - 1][0] + w._pts[i][0]) / 2, (w._pts[i - 1][1] + w._pts[i][1]) / 2);
  for (let r0 = 0; r0 < w._ids.length - 1;) {
    if (!segIn(r0 + 1)) { r0++; continue; }
    let r1 = r0 + 1;
    while (r1 < w._ids.length - 1 && segIn(r1 + 1)) r1++;
    let start = r0;
    for (let i = r0 + 1; i <= r1; i++) {
      if (i === r1 || (degCar.get(w._ids[i]) || 0) >= 3) {
        const h = vs.slice(start, i + 1).map((s) => q1(heightAlong(w, s)));
        edges.push({ a: nodeIdx(w._ids[start], w._pts[start]), b: nodeIdx(w._ids[i], w._pts[i]), p: flat(w._pts.slice(start, i + 1)), c: info.cls, o: info.oneway, l: info.lanes, w: q1(info.w), n: info.name || undefined, br: info.bridge || undefined, ...(h.some((v) => Math.abs(v) > 0.05) ? { h } : {}) });
        start = i;
      }
    }
    r0 = r1;
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
  // An indoor room (a metro station's halls under 前门) is not a building's shell: it drew as a 18 m block.
  if (t.indoor === 'room') continue;
  // Underground (a metro station's outline, layer -1..-5, over the street it runs under): 太平桥 and
  // 北新桥 stood as 18 m blocks across 闹市口北街 and 东四北大街.
  if ((Number(t.layer) < 0 && t.location !== 'surface') || t.location === 'underground') continue;
  if (t['building:part'] && t['building:part'] !== 'no') addBuilding(parts, w.id, t, proj(w.geometry));
  else if (t.building && t.building !== 'no') addBuilding(outlines, w.id, t, proj(w.geometry));
}
for (const r of rels) {
  const t = r.tags; if (!t || (t.type !== 'multipolygon' && t.type !== 'building')) continue;
  const isPart = t['building:part'] && t['building:part'] !== 'no';
  if (!isPart && !(t.building && t.building !== 'no')) continue;
  if ((Number(t.layer) < 0 && t.location !== 'surface') || t.location === 'underground') continue;
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
// Buildings OSM has not drawn, from machine-learnt footprints (Shi et al. 2023, via Overture; CC BY 4.0),
// and measured heights (3D-GloBFP, CMAB) for everything OSM gives no height (extra-buildings.mjs,
// 2026-09-29, 「尽量还原北京城的原貌」). In the play area OSM has 16k buildings and 15.2 km² of
// footprint; the learnt set adds 40k (7.7 km²) - the courtyard houses of the hutongs, the low blocks of
// the 小区, whole compounds - and two thirds of OSM's buildings had a made-up height. OSM wins wherever
// it has something: a learnt footprint mostly under an OSM one is dropped (our OSM is newer than
// Overture's), and none go in the palace or the temple (mapped to the last hall), on a carriageway or in
// water. NO_EXTRA=1 builds without any of it.
const EXTRA = extraAvailable() && !process.env.NO_EXTRA;
const HG = grid(RX0, RZ0, RX1, RZ1);
const HR = EXTRA ? heightRasters(HG) : null;
const learnt = [];
if (EXTRA) {
  const osmMask = new Uint8Array(HG.nx * HG.nz);
  for (const b of kept) scan(HG, b.ring, (i) => { osmMask[i] = 1; });
  for (const b of parts) scan(HG, b.ring, (i) => { osmMask[i] = 1; });
  const water = [];
  for (const e of [...ways, ...rels]) {
    if (!e.tags || areaKind(e.tags) !== 'water') continue;
    const rs = e.type === 'way' ? (e.geometry && e.geometry.length >= 4 ? [openRing(proj(e.geometry))] : []) : assemble(e.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => proj(m.geometry)));
    for (const r of rs) if (r.length >= 3) water.push({ r, bb: bboxOf(r) });
  }
  const inWater = (x, z) => water.some((w) => x >= w.bb[0] && x <= w.bb[2] && z >= w.bb[1] && z <= w.bb[3] && pip(x, z, w.r));
  const drop = { osm: 0, zone: 0, road: 0, water: 0 };
  let id = 8e12;
  for (const ring of clsmFootprints(inRegion)) {
    const n0 = learnt.length;
    addBuilding(learnt, id++, { building: 'yes' }, ring);
    if (learnt.length === n0) continue;
    const b = learnt[n0], [cx, cz] = b.c, z = zone(cx, cz);
    let n = 0, o = 0;
    scan(HG, b.ring, (i) => { n++; o += osmMask[i]; });
    // Into a carriageway: any corner or edge midpoint more than 0.5 m inside one (it would stand in the road).
    let onRoad = inCarriageway(cx, cz, 0.5);
    for (let k = 0; k < b.ring.length && !onRoad; k++) {
      const [ax, az] = b.ring[k], [bx, bz] = b.ring[(k + 1) % b.ring.length];
      onRoad = inCarriageway(ax, az, -0.5) || inCarriageway((ax + bx) / 2, (az + bz) / 2, -0.5);
    }
    const why = z === 'palace' || z === 'temple' ? 'zone' : n && o / n > 0.12 ? 'osm' : onRoad ? 'road' : inWater(cx, cz) ? 'water' : '';
    if (why) { drop[why]++; learnt.pop(); }
  }
  console.log(`learnt footprints: ${learnt.length} added (${(learnt.reduce((a, b) => a + b.area, 0) / 1e6).toFixed(2)} km²), dropped`, drop);
}
// Blocks OSM has not drawn, in the corridors (2026-09-29): 东四环's east side from 朝阳公园桥 to 东风北桥
// is mapped as residential land with almost no buildings in it, and the ring ran between empty paved
// fields. A residential or commercial polygon there with next to nothing drawn in it (< 6% covered) is
// filled the way Beijing builds a 小区: rows of slab blocks with their long sides to the south, set back
// from the streets, spaced for the winter sun - six-storey walk-ups, mid-rise slabs or towers, one style
// a polygon - and a few office blocks on commercial land. Only in the corridors: the main box is drawn,
// and everything placed there (the stunts' spots) was placed round what is drawn.
const filled = [];
{
  const corridor = (x, z) => !inMain(x, z) && inRegion(x, z);
  const exIndex = new Map();
  const index = (b) => eachTile(b.bb, (ix, iz) => { const k = `${ix}_${iz}`; (exIndex.get(k) ?? exIndex.set(k, []).get(k)).push(b); });
  for (const b of kept) index(b);
  for (const b of parts) index(b);
  for (const b of learnt) index(b);
  const inExisting = (x, z, m) => { for (const b of exIndex.get(tileOf(x, z).join('_')) ?? []) if (x > b.bb[0] - m && x < b.bb[2] + m && z > b.bb[1] - m && z < b.bb[3] + m && (m === 0 ? pip(x, z, b.ring) : true)) return true; return false; };
  // Ground that must stay open: water, parks, pitches, woods, car parks, railways, squares.
  const open = [];
  const lands = [];
  const ringsOf = (e) => e.type === 'way' ? (e.geometry && e.geometry.length >= 4 ? [openRing(proj(e.geometry))] : []) : assemble(e.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => proj(m.geometry)));
  for (const e of [...ways, ...rels]) {
    const t = e.tags; if (!t || e._road || t.building) continue;
    const lk = /^(residential|commercial|retail)$/.test(t.landuse ?? '') ? t.landuse : null;
    const ak = !lk && areaKind(t);
    if (!lk && !ak) continue;
    for (const r of ringsOf(e)) {
      if (r.length < 3) continue;
      const bb = bboxOf(r);
      if (![[bb[0], bb[1]], [bb[2], bb[3]], [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]].some(([x, z]) => corridor(x, z))) continue;
      (lk ? lands : open).push({ id: e.id, kind: lk ?? ak, ring: r, bb });
    }
  }
  const inOpen = (x, z) => open.some((o) => x >= o.bb[0] && x <= o.bb[2] && z >= o.bb[1] && z <= o.bb[3] && pip(x, z, o.ring));
  const free = (x, z) => corridor(x, z) && !nearRoad(x, z, 5) && !inExisting(x, z, 0) && !inOpen(x, z);
  let fid = 9e12;
  for (const L of lands) {
    const a = Math.abs(signedArea(L.ring));
    if (a < 6000) continue;
    // Coverage by what OSM has, on an 8 m grid.
    let n = 0, hit = 0;
    for (let x = L.bb[0]; x < L.bb[2]; x += 8) for (let z = L.bb[1]; z < L.bb[3]; z += 8) { if (!pip(x, z, L.ring)) continue; n++; if (inExisting(x, z, 0)) hit++; }
    if (!n || hit / n > 0.06) continue;
    const r = rnd(L.id, 31);
    const res = L.kind === 'residential';
    // [length, depth, row gap, column gap, height range]
    const style = !res ? [42, 30, 26, 22, [24, 60]] : r < 0.45 ? [58, 12, 22, 12, [16.5, 19.5]] : r < 0.8 ? [66, 15, 36, 16, [33, 55]] : [30, 24, 48, 26, [62, 92]];
    const [len, dep, rowGap, colGap, [h0, h1]] = style;
    const x0 = L.bb[0] + 10, z0 = L.bb[1] + 10;
    let row = 0;
    for (let z = z0; z + dep < L.bb[3] - 6; z += dep + rowGap, row++) {
      const shift = (rnd(L.id, 40 + row) - 0.5) * 16;
      for (let x = x0 + shift; x + 10 < L.bb[2] - 6; ) {
        // The longest block up to `len` that fits: every point of it on a 5 m grid inside the polygon and free.
        const fits = (w) => {
          for (let u = 0; u <= w; u += 5) for (let v = 0; v <= dep; v += 4) { const px = x + Math.min(u, w), pz = z + Math.min(v, dep); if (!pip(px, pz, L.ring) || !free(px, pz)) return false; }
          // ... and a margin round it clear of what is drawn.
          for (const [px, pz] of [[x - 4, z - 4], [x + w + 4, z - 4], [x - 4, z + dep + 4], [x + w + 4, z + dep + 4]]) if (inExisting(px, pz, 0)) return false;
          return true;
        };
        let w = len;
        while (w >= 18 && !fits(w)) w -= 8;
        if (w < 18) { x += 10; continue; }
        const id = fid++;
        const h = h0 + (h1 - h0) * rnd(id, 5);
        const ring = [[x, z], [x + w, z], [x + w, z + dep], [x, z + dep]];
        const levels = Math.max(2, Math.round(h / 3.1));
        filled.push({ id, tags: res ? { building: 'apartments', 'building:levels': String(levels) } : { building: 'commercial', height: String(Math.round(h)) }, ring, holes: [], area: w * dep, c: [x + w / 2, z + dep / 2], bb: [x, z, x + w, z + dep] });
        index(filled[filled.length - 1]);
        x += w + colGap;
      }
    }
  }
  // Building sites get their hoarding (围挡): 2.5 m blue panels round the edge, 0.6 m in, broken wherever
  // a road or path crosses the line (a site's own service roads go in and out through it) - as walls
  // (kind 'wall', coloured), so they are solid like any other.
  let hoard = 0;
  for (const o of open) {
    if (o.kind !== 'site' || Math.abs(signedArea(o.ring)) < 3000) continue;
    const R = o.ring, inward = signedArea(R) > 0 ? 1 : -1;
    for (let i = 0; i < R.length; i++) {
      const [ax, az] = R[i], [bx, bz] = R[(i + 1) % R.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 4) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      // Inward normal for a ring of positive signed area in (x, z) is (-dz, dx).
      const nx = -dz * inward * 0.6, nz = dx * inward * 0.6;
      let run0 = -1;
      const flush = (s1) => {
        if (run0 < 0 || s1 - run0 < 6) { run0 = -1; return; }
        const p0 = [ax + dx * run0 + nx, az + dz * run0 + nz], p1 = [ax + dx * s1 + nx, az + dz * s1 + nz], t = 0.12;
        const ring = [[p0[0] - dz * t, p0[1] + dx * t], [p1[0] - dz * t, p1[1] + dx * t], [p1[0] + dz * t, p1[1] - dx * t], [p0[0] + dz * t, p0[1] - dx * t]];
        const id = fid++;
        filled.push({ id, tags: { building: 'wall', height: '2.5', 'building:colour': '#35679f' }, ring, holes: [], area: (s1 - run0) * 2 * t, c: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], bb: bboxOf(ring) });
        hoard++;
        run0 = -1;
      };
      for (let sd = 0; sd <= L; sd += 2) {
        const x = ax + dx * sd + nx, z = az + dz * sd + nz;
        const ok = corridor(x, z) && !nearRoad(x, z, 2) && !inExisting(x, z, 0);
        if (ok && run0 < 0) run0 = sd;
        if (!ok) flush(sd - 2);
      }
      flush(Math.floor(L / 2) * 2);
    }
  }
  console.log(`filled: ${filled.length - hoard} blocks in ${lands.length} residential/commercial polygons of the corridors, ${hoard} lengths of hoarding round the building sites`);
}
const buildings = kept.concat(parts, learnt, filled);
// Roads through a building (OSM tunnel=building_passage: a gate, an arch under a block): the building
// gets a passage - [ax, az, bx, bz, half width, clearance] per segment, the segment carried 4 m past
// the road's ends so it cuts both walls - and the tile mesher opens its walls there, lines the
// passage and leaves it out of the collider. Before, 11 car roads (南池子大街 through the imperial
// wall's gate among them) ran into a solid wall.
const passageOf = new Map();
{
  const ext = 4;
  for (const w of ways) {
    if (!w._road?.car || w.tags.tunnel !== 'building_passage' || !w._pts) continue;
    // as wide as the road but no wider than two lanes a side (4.5 m): a gate is a gateway, not a missing
    // ground floor - the 12.5 m 南池子 gate on an 11.5 m road kept only a 0.5 m pier
    const hw = Math.min(4.5, Math.max(1.8, w._road.w / 2)) + 0.25;
    const P = w._pts;
    for (let i = 0; i + 1 < P.length; i++) {
      let [ax, az] = P[i], [bx, bz] = P[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      if (i === 0) { ax -= dx * ext; az -= dz * ext; }
      if (i + 2 === P.length) { bx += dx * ext; bz += dz * ext; }
      const n = Math.ceil(Math.hypot(bx - ax, bz - az));
      for (const bd of buildings) {
        const bb = bd.bb;
        if (Math.max(ax, bx) + hw < bb[0] || Math.min(ax, bx) - hw > bb[2] || Math.max(az, bz) + hw < bb[1] || Math.min(az, bz) - hw > bb[3]) continue;
        let hit = false;
        for (let k = 0; k <= n && !hit; k++) { const t = k / n; hit = pip(ax + (bx - ax) * t, az + (bz - az) * t, bd.ring); }
        if (hit) { (passageOf.get(bd) ?? passageOf.set(bd, []).get(bd)).push(q1(ax), q1(az), q1(bx), q1(bz), q1(hw)); (bd.passWays ??= new Set()).add(w.id); }
      }
    }
  }
  console.log(`passages: ${passageOf.size} buildings with a road through them`);
}
// Roads a building blocks (see the building loop): segment-to-footprint distance against the carriageway.
const roadBlockers = { osm: 0, learnt: 0 }, roadPassages = { osm: 0, learnt: 0 }, blockLog = [];
const LANES = /^(residential|service|living_street|unclassified)$/;
function segCrosses(ax, az, bx, bz, cx, cz, dx, dz) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (!d) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function segToRing(ax, az, bx, bz, R) {
  if (pip(ax, az, R) || pip(bx, bz, R)) return 0;
  let d = Infinity;
  for (let i = 0; i < R.length; i++) {
    const [px, pz] = R[i], [qx, qz] = R[(i + 1) % R.length];
    if (segCrosses(ax, az, bx, bz, px, pz, qx, qz)) return 0;
    d = Math.min(d, segDist(px, pz, ax, az, bx, bz), segDist(ax, az, px, pz, qx, qz), segDist(bx, bz, px, pz, qx, qz));
  }
  return d;
}
function blocksRoad(b, old) {
  const seen = new Set(), hits = [];
  eachTile([b.bb[0] - 12, b.bb[1] - 12, b.bb[2] + 12, b.bb[3] + 12], (ix, iz) => {
    for (const s of carSegs.get(`${ix}_${iz}`) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      const [ax, az, bx, bz, hw, cls, way] = s;
      if (b.passWays?.has(way)) continue;
      if (Math.max(ax, bx) + hw < b.bb[0] || Math.min(ax, bx) - hw > b.bb[2] || Math.max(az, bz) + hw < b.bb[1] || Math.min(az, bz) - hw > b.bb[3]) continue;
      const lim = old && LANES.test(cls) ? 1.2 : Math.max(1.2, 0.45 * hw);
      const d = segToRing(ax, az, bx, bz, b.ring);
      if (d < lim) hits.push({ ax, az, bx, bz, hw, cls, way, d });
    }
  });
  return hits;
}
// Where OSM gives no height: the measured sets' estimate (HEIGHT_EVAL=1 prints how each does against the
// buildings OSM does give a height).
const DEBUG_AT = process.env.DEBUG_AT?.split(',').map(Number);
const HEIGHT_EVAL = !!process.env.HEIGHT_EVAL, heightEval = [], guessLog = [], heightFrom = { osm: 0, curated: 0, corrected: 0, measured: 0, guessed: 0 };
// 3D-GloBFP, else CMAB: against OSM's heights of 6 m and more, 3D-GloBFP is off by a median 2.6 m at 6-12 m
// (CMAB 7.5), ~5 m at 12-30 m, and it flattens towers (-25% at 30-60 m, -50% over 60), so what it puts
// over 22 m is stretched by 1.4.
function measured(e) { const v = e.globfp || e.cmab; return v > 22 ? 22 + (v - 22) * 1.4 : v; }
const ROOF = { flat: 'f', gabled: 'g', hipped: 'h', pyramidal: 'p', skillion: 's', dome: 'd', half_hipped: 'h', round: 'd', onion: 'd' };
// Hutong context: the share of the ground within ~60 m covered by house-sized buildings (under 300 m²) in
// the old city. The learnt heights put a courtyard house at 8-19 m (median 12 in 南池子, where the
// houses are 4-6 m) - trusted there, they turned the hutongs round the palace into mid-rise blocks - while
// the old city's walk-ups (15-20 m) stand in blocks of their own. Where the houses dominate, a building
// they put under 20 m is a courtyard house.
const HC = 40, hutongCells = new Map();
for (const b of kept.concat(learnt)) {
  if (b.area >= 300 || zone(b.c[0], b.c[1]) !== 'old') continue;
  const k = `${Math.floor(b.c[0] / HC)}_${Math.floor(b.c[1] / HC)}`;
  hutongCells.set(k, (hutongCells.get(k) ?? 0) + b.area);
}
function hutongContext(x, z) {
  const cx = Math.floor(x / HC), cz = Math.floor(z / HC);
  let a = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) a += hutongCells.get(`${cx + dx}_${cz + dz}`) ?? 0;
  return a / (9 * HC * HC);
}
// Heights looked up by hand (scripts/city/heights.json, with sources): the CBD's towers and malls that
// neither OSM nor the measured sets give a height (the learnt sets miss most big buildings there, and
// the old guess put 金地购物中心, a mall, at 207 m). Matched by a point inside the footprint.
const curated = fs.existsSync('scripts/city/heights.json') ? JSON.parse(fs.readFileSync('scripts/city/heights.json', 'utf8')).map((q) => ({ ...q, p: project(q.lat, q.lon) })) : [];
const curatedFor = (b) => curated.find((q) => q.p[0] >= b.bb[0] && q.p[0] <= b.bb[2] && q.p[1] >= b.bb[1] && q.p[1] <= b.bb[3] && pip(q.p[0], q.p[1], b.ring));
const kinds = {}, btys = {};
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
  const cur = !(h > 0) && curated.length ? curatedFor(b) : null;
  if (cur) { h = cur.height; heightFrom.curated++; }
  const hTag = h > 0;
  if (!(h > 0) && levels > 0) h = levels * 3.2 + (roofLevels > 0 ? roofLevels * 2.4 : 0);
  // Measured heights and CMAB's function under the footprint (extra-buildings.mjs).
  const ext = HR && bt !== 'wall' ? sample(HG, HR, b.ring, b.c) : null;
  if (ext && HEIGHT_EVAL && h > 0) heightEval.push([h, ext.globfp, ext.cmab, Math.round(b.area), z, b.id, levels > 0 ? 1 : 0]);
  // Not for what OSM says is a single-storey type (bungalow, house, garage...), and not CMAB alone under a
  // small footprint (it puts 30 m on 30 m² courtyard wings round 鼓楼: its polygons merge neighbours).
  const lowType = /^(bungalow|house|detached|semidetached_house|terrace|garage|garages|shed|hut|kiosk|toilets|roof|carport|cabin|greenhouse|service)$/.test(bt);
  let mh = ext && kind !== 'trad' && kind !== 'station' && !lowType && (ext.globfp || b.area >= 300) ? measured(ext) : 0;
  // A footprint under 150 m² the sets put over 12 m (a seven-storey pencil tower among the courtyards)
  // is a tall neighbour's roof traced over it: the learnt outlines are roofs, towers lean ~20 m off.
  if (b.area < 150 && mh > 12) mh = 0;
  // OSM's building:levels=1 is wrong on much of Beijing: 3,700 of the 6,000 buildings here with a height
  // say one storey, most from one mass edit, apartment blocks among them (drawn as 3 m slabs). Outside
  // the courtyard houses, a one-storey tag the measurement puts at 9 m or more (15 in the old city) goes.
  const houses = z === 'old' && hutongContext(cx, cz) > 0.15;
  if (!hTag && levels === 1 && mh >= (houses ? 22 : z === 'old' ? 15 : 9) && !(z === 'old' && b.area < 420)) { h = mh; heightFrom.corrected++; }
  else if (h > 0 && !cur) heightFrom.osm++;
  else if (mh > 0) {
    // The learnt heights cannot tell a courtyard house from a three-storey block (they bottom out near
    // 8 m): among the courtyard houses, what they put under 20 m is one (its default height).
    if (bt === 'yes' && z === 'old' && (houses ? b.area < 600 && mh < 20 : b.area < 420 && mh < 14)) kind = 'hutong';
    else {
      h = Math.max(3, mh);
      heightFrom.measured++;
      if (bt === 'yes' && z === 'old') kind = h <= 6.5 ? 'hutong' : kind === 'hutong' ? 'resid' : kind;
    }
  }
  if (DEBUG_AT && Math.hypot(cx - DEBUG_AT[0], cz - DEBUG_AT[1]) < DEBUG_AT[2]) console.log('bld', b.id, bt, kind, 'area', Math.round(b.area), 'h', h && h.toFixed(1), 'levels', levels, 'ext', ext && [ext.globfp, ext.cmab, ext.fn], 'houses', hutongContext(cx, cz).toFixed(2));
  // What CMAB says it is used for, for the buildings OSM only calls building=yes.
  if (ext?.fn && bt === 'yes' && kind === 'resid') {
    if (ext.fn === 'Office' || ext.fn === 'Commerce' || ext.fn === 'Public service') kind = z === 'cbd' && b.area > 600 ? 'glass' : 'office';
    else if (ext.fn === 'Industry' && !(h > 12)) kind = 'low';
  }
  if (!(h > 0)) {
    heightFrom.guessed++;
    if (process.env.GUESS_LOG && (kind === 'glass' || kind === 'office') && b.area > 600) guessLog.push([b.id, kind, Math.round(b.area), t.name ?? '', Math.round(cx), Math.round(cz)]);
    const s = Math.sqrt(b.area);
    h = kind === 'hutong' ? 4.2 + 1.8 * r
      : kind === 'trad' ? (bt === 'gate' ? 10 + 4 * r : 8 + 8 * r)
      : kind === 'wall' ? 4
      : kind === 'low' ? 4 + 3 * r
      : kind === 'glass' ? (b.area > 6000 ? 24 + 12 * r : Math.min(160, 50 + s * (0.9 + 1.4 * r)))  // a footprint that big is a podium or a mall
      : kind === 'station' ? 18
      : kind === 'office' ? 14 + 22 * r + (z === 'city' || z === 'cbd' ? 14 : 0)
      : b.area < 500 ? 11 + 8 * r : 18 + 28 * r + (z === 'city' ? 12 : 0);
  }
  let minH = parseLen(t.min_height);
  if (!(minH > 0)) minH = minLevel > 0 ? minLevel * 3.2 : 0;
  if (minH >= h) minH = 0;
  let roof = ROOF[t['roof:shape']] || (kind === 'hutong' ? 'g' : kind === 'trad' ? 'h' : 'f');
  const o = obb(b.ring);
  // Beijing's housing by era (2026-10-02, the building types): CMAB's year (when the land was first built
  // up; 1985 = then or before) where it has one, else guessed from height and plan. 1 苏式 brick walk-ups
  // (1950s-70s, three to five storeys, grey or red brick, some under a hipped tile roof); 2 板楼 (1980s-90s
  // six-storey slabs, pale tile or grey render, many given a pitched roof in the 2000s 平改坡); 3 塔楼
  // (1990s point blocks, white tile); 4 new high-rise estates (2000s on: warm render, sand to terracotta).
  let bty = 0;
  const year = ext?.year ?? 0, rt = rnd(b.id, 7);
  if (kind === 'resid' && !(t['building:colour'] || t.colour)) {
    const aspect = o.hl / Math.max(1, o.hw), point = aspect < 1.7 && o.hl < 28;
    if (h <= 21) bty = (year && year <= 1985 ? (h <= 17 && rt < 0.5) : (!year && z === 'old' && rt < 0.4)) ? 1 : 2;
    else bty = point && (year ? year < 2006 : rt < 0.6) ? 3 : year && year < 1998 ? 3 : 4;
    // the pitched roofs: half the brick walk-ups, a third of the slabs (平改坡), none on the towers
    if (roof === 'f' && minH < 0.5 && !t['roof:shape'] && o.hw > 4 && aspect > 1.4 && (bty === 1 ? rt < 0.5 : bty === 2 ? rt < 0.33 && h >= 15 : false)) {
      roof = 'h';
      const add = Math.min(o.hw * 0.55, 3.2);
      h += add;   // the roof sits on top of the walls it had
    }
  }
  let rh = parseLen(t['roof:height']);
  if (!(rh > 0)) rh = roof === 'g' || roof === 'h' ? Math.min(o.hw * (bty ? 0.55 : 0.7), kind === 'trad' ? 9 : bty ? 3.2 : 3.5) : roof === 'p' ? o.hw * 0.8 : roof === 's' ? 1.2 : roof === 'd' ? o.hw : 0;
  if (roof !== 'f' && rh > h * 0.6) rh = h * 0.6;
  kinds[kind] = (kinds[kind] || 0) + 1;
  const rec = { i: b.id, k: kind, h: q1(h), m: q1(minH), r: roof, rh: q1(rh), o: flat(b.ring) };
  if (b.holes.length) rec.hs = b.holes.map(flat);
  const c = colour(t['building:colour'] || t.colour); if (c) rec.c = c;
  const rc = colour(t['roof:colour']); if (rc) rec.rc = rc;
  if (bty) {
    rec.t = bty;
    btys[bty] = (btys[bty] ?? 0) + 1;
    // 平改坡 roofs are red or grey tile; the old brick blocks' grey
    if ((roof === 'h' || roof === 'g') && !rc) rec.rc = bty === 1 ? (rt < 0.75 ? '#5f6366' : '#8a4a3a') : rt < 0.2 ? '#5f6366' : rt < 0.27 ? '#3f5f7a' : '#9a4b39';
  }
  // Big low sheds with no colour of their own are colour-steel (彩钢板): blue or white roofs.
  if (kind === 'low' && b.area > 250 && !rc && !rec.rc) rec.rc = rt < 0.55 ? '#3f6f9e' : rt < 0.8 ? '#d9dcdc' : '#9a4b39';
  if (roof === 'g' || roof === 'h') rec.ob = [q1(o.cx), q1(o.cz), +o.angle.toFixed(4), q1(o.hl), q1(o.hw)];
  const pas = passageOf.get(b);
  if (pas && minH < 0.5) {
    // clearance: 4.5 m, or what the walls allow under a low roof (a hutong house's eaves at 3.4 m)
    const wallTop = rec.r === 'g' || rec.r === 'h' || rec.r === 'p' ? h - rh : h;
    const ch = q1(Math.max(2.8, Math.min(4.5, wallTop - 0.6)));
    rec.ps = [];
    for (let k = 0; k < pas.length; k += 5) rec.ps.push(...pas.slice(k, k + 5), ch);
  }
  if (t.name) { rec.n = t.name; named[t.name] = [q1(cx), q1(cz)]; }
  rec.s = +(r2).toFixed(3);
  // A building a deck runs through goes (a ramp of 国贸桥 ran through a kiosk 15 m tall and the car
  // stopped dead against its walls); one low enough to stand under the deck's soffit stays.
  let deck = deckOver(cx, cz);
  for (const [x, z] of b.ring) deck = Math.min(deck, deckOver(x, z));
  if (deck < Infinity && h > deck - 1.5) { underCut++; continue; }
  // A building standing in a carriageway on the ground goes (「有的道路有建筑遮挡」): OSM draws some over
  // the street they front (a whole hutong house across 崇文门西河沿), the learnt set's roof outlines lean
  // into it, and a road through a building with no passage tagged ran into its wall. Blocking: the road's
  // centre line within 45% of its half width of the footprint (at least 1.2 m) - in the old city's
  // lanes 1.2 m, since our widths overstate a hutong and its houses really do stand at the kerb.
  // Walls, buildings raised over the street and roads through a tagged passage are left.
  if (bt !== 'wall' && !(minH > 3.5)) {
    const hits = blocksRoad(b, z === 'old');
    if (hits.length) {
      const src = b.id >= 8e12 ? 'learnt' : 'osm';
      // A small one is simply in the road (a hutong house drawn across 崇文门西河沿). A big one stays and
      // the road goes through it at street level, as if OSM had tagged a building_passage: a driveway into
      // a compound under its block, a mall spanning a street (王府井, 国贸, 吉市口 lost whole blocks to a
      // driveway ending under them before this).
      if (b.area < 400 || src === 'learnt' && b.area < 1500) { roadBlockers[src]++; if (process.env.BLOCK_LOG) blockLog.push(`${b.id} ${kind} removed ${hits[0].cls} ${hits[0].way}`); continue; }
      if (minH < 0.5) {
        const wallTop = rec.r === 'g' || rec.r === 'h' || rec.r === 'p' ? h - rh : h;
        const ch = q1(Math.max(2.8, Math.min(4.5, wallTop - 0.6)));
        rec.ps ??= [];
        for (const g of hits) {
          const L = Math.hypot(g.bx - g.ax, g.bz - g.az) || 1, ux = (g.bx - g.ax) / L, uz = (g.bz - g.az) / L;
          rec.ps.push(q1(g.ax - ux * 4), q1(g.az - uz * 4), q1(g.bx + ux * 4), q1(g.bz + uz * 4), q1(Math.min(4.5, g.hw) + 1.25), -ch);  // negative: no side walls (Buildings.ts `open`); a metre wider than a tagged gate: these follow whole roads, round bends
        }
        roadPassages[src]++;
        if (process.env.BLOCK_LOG) blockLog.push(`${b.id} ${kind} passage ${hits.length} ${hits[0].cls} ${hits[0].way}`);
      }
    }
  }
  tile(...tileOf(cx, cz)).buildings.push(rec);
  b._kind = kind;
  eachTile(b.bb, (ix, iz) => { const k = `${ix}_${iz}`; (bIndex.get(k) ?? bIndex.set(k, []).get(k)).push(b); });
}
console.log('heights:', heightFrom);
console.log('housing types (1 苏式, 2 板楼, 3 塔楼, 4 new):', btys);
console.log('buildings removed from carriageways:', roadBlockers, 'given a passage:', roadPassages);
if (process.env.BLOCK_LOG) fs.writeFileSync('.scratch/blocklog.txt', blockLog.join('\n'));
if (process.env.GUESS_LOG) fs.writeFileSync('.scratch/guesslog.json', JSON.stringify(guessLog));
if (HEIGHT_EVAL) {
  // Against OSM's own heights (levels x 3.2 or height): median absolute error and bias per estimator, by band.
  const est = { globfp: (g, c) => g, cmab: (g, c) => c, mean: (g, c) => (g && c ? (g + c) / 2 : g || c), max: (g, c) => Math.max(g, c) };
  for (const [lo, hi] of [[0, 12], [12, 30], [30, 60], [60, 400]]) {
    const rows = heightEval.filter(([h]) => h >= lo && h < hi);
    const out = [];
    for (const [k, f] of Object.entries(est)) {
      const e = rows.map(([h, g, c]) => [h, f(g, c)]).filter(([, v]) => v > 0), err = e.map(([h, v]) => Math.abs(v - h)).sort((a, b) => a - b), bias = e.map(([h, v]) => v - h).sort((a, b) => a - b);
      out.push(`${k} n${e.length} mae ${err[err.length >> 1]?.toFixed(1)} bias ${bias[bias.length >> 1]?.toFixed(1)}`);
    }
    console.log(`  osm ${lo}-${hi} m (${rows.length}):`, out.join(' | '));
  }
  fs.writeFileSync('.scratch/heighteval.json', JSON.stringify(heightEval));
}
function inBuilding(x, z, margin = 0) {
  for (const b of bIndex.get(tileOf(x, z).join('_')) || []) {
    if (x < b.bb[0] - margin || x > b.bb[2] + margin || z < b.bb[1] - margin || z > b.bb[3] + margin) continue;
    if (pip(x, z, b.ring)) return true;
  }
  return false;
}

// Courtyard walls and gates along the hutongs (2026-10-02, the building types' second round). The houses
// of a 四合院 stand round a courtyard; where the lane runs past the courtyard, or past the gap between two
// houses, OSM (and the learnt set) has nothing, so the hutongs read as rows of loose cottages on open
// ground. Along every lane among the courtyard houses, on each side just off the carriageway: a grey brick
// wall wherever the line is open and a courtyard house stands behind it within 12 m, broken at side lanes
// and junctions; in a run of wall, a gate (门楼, a small house with a gable roof turned to the lane, its door
// on the street face) every ~16 m.
{
  const houseAt = (x, z) => { for (const b of bIndex.get(tileOf(x, z).join('_')) || []) { if (x < b.bb[0] || x > b.bb[2] || z < b.bb[1] || z > b.bb[3]) continue; if (pip(x, z, b.ring)) return b; } return null; };
  const LANE = /^(residential|service|living_street|unclassified|footway|pedestrian|path)$/;
  let walls = 0, gates = 0, wid = 9.5e12;
  const WALL_C = '#8d8f8e';
  const emit = (ring, tags) => {
    const id = wid++, [cx, cz] = centroid(ring), [ix, iz] = tileOf(cx, cz);
    if (!tiles.has(`${ix}_${iz}`) && !inRegion(cx, cz)) return;
    tile(ix, iz).buildings.push({ i: id, ...tags, o: flat(ring), s: +rnd(id, 2).toFixed(3) });
  };
  for (const w of ways) {
    const info = w._road;
    if (!info || !LANE.test(info.cls) || info.w > 9 || !w._pts) continue;
    const P = w._pts;
    if (!P.some(([x, z]) => zone(x, z) === 'old')) continue;
    const hw = info.w / 2;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 4) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (const side of [1, -1]) {
        const nx = -uz * side, nz = ux * side, off = hw + 0.35;
        const ok = [];
        for (let sd = 1; sd <= L - 1; sd += 1) {
          const x = ax + ux * sd + nx * off, z = az + uz * sd + nz * off;
          let good = zone(x, z) === 'old' && hutongContext(x, z) > 0.18 && !houseAt(x, z) && !nearRoad(x, z, 0.2) && deckOver(x, z) === Infinity;
          if (good) {
            good = false;
            for (let k = 1.5; k <= 12 && !good; k += 1.5) { const b = houseAt(x + nx * k, z + nz * k); if (b) good = b._kind === 'hutong'; }
          }
          ok.push(good);
        }
        // runs of at least 3 m
        for (let s0 = 0; s0 < ok.length;) {
          if (!ok[s0]) { s0++; continue; }
          let s1 = s0; while (s1 + 1 < ok.length && ok[s1 + 1]) s1++;
          const a = s0 + 1 - 0.5, e = s1 + 1 + 0.5;
          if (e - a >= 3) {
            // gates every ~16 m in runs of 9 m or more, the rest wall
            const cuts = [];
            if (e - a >= 9) for (let g = a + 4 + rnd(Math.round(ax * 7 + az), side + 3) * 4; g + 3.4 < e - 1; g += 14 + rnd(Math.round(g * 13 + ax), 9) * 6) cuts.push(g);
            let at = a;
            const wallTo = (t) => {
              if (t - at < 1.2) { at = t; return; }
              const p0 = [ax + ux * at + nx * off, az + uz * at + nz * off], p1 = [ax + ux * t + nx * off, az + uz * t + nz * off], th = 0.36;
              emit([p0, p1, [p1[0] + nx * th, p1[1] + nz * th], [p0[0] + nx * th, p0[1] + nz * th]], { k: 'wall', h: 3, m: 0, r: 'f', rh: 0, c: WALL_C });
              walls++; at = t;
            };
            for (const g of cuts) {
              wallTo(g);
              // the gate: 3.4 m along the lane, 2.4 m deep behind the wall line, a gable roof along the lane
              const q0 = [ax + ux * g + nx * off, az + uz * g + nz * off], q1 = [q0[0] + ux * 3.4, q0[1] + uz * 3.4];
              const ring = [q0, q1, [q1[0] + nx * 2.4, q1[1] + nz * 2.4], [q0[0] + nx * 2.4, q0[1] + nz * 2.4]];
              const ocx = q0[0] + ux * 1.7 + nx * 1.2, ocz = q0[1] + uz * 1.7 + nz * 1.2;
              emit(ring, { k: 'hutong', h: 5.2, m: 0, r: 'g', rh: 1.3, ob: [q1v(ocx), q1v(ocz), +Math.atan2(uz, ux).toFixed(4), 1.7, 1.2] });
              gates++; at = g + 3.4;
            }
            wallTo(e);
          }
          s0 = s1 + 1;
        }
      }
    }
  }
  console.log(`hutong courtyards: ${walls} lengths of wall, ${gates} gates`);
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
  // Cleared and building land (much of 东四环's east side between 朝阳公园桥 and 东风北桥 is being rebuilt).
  if (/^(construction|brownfield|greenfield|landfill)$/.test(t.landuse ?? '')) return 'site';
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
// Rivers drawn as a line only (2026-10-02, step 4 of the plan): OSM gives most of 通惠河, 亮马河 and the
// moats as water areas, but ~86 km of rivers, canals, streams and drains in the play area as centre lines
// alone (凉水河's upper reaches, 坝河, the drains), and nothing drew them. Each one's stretches that no water
// area covers (sampled every 5 m, runs of 10 m or more) become a water strip as wide as its `width` tag, or
// river 18, canal 12, stream 4, drain or ditch 3 m.
{
  const W = { river: 18, canal: 12, stream: 4, drain: 3, ditch: 2.5 };
  const wet = areaPolys.filter((a) => a.k === 'water').map((a) => ({ a, bb: bboxOf(a.outer) }));
  const inWet = (x, z) => wet.some(({ a, bb }) => x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, a.outer) && !a.holes.some((h) => pip(x, z, h)));
  let strips = 0, metres = 0, rid = 9.9e12;
  for (const w of ways) {
    const t = w.tags; if (!t || !(t.waterway in W) || !w.geometry || (t.tunnel && t.tunnel !== 'no')) continue;
    // covered over (护城河（已盖板）: the moat under 东二环's west side), or underground
    if (t.covered === 'yes' || t.location === 'underground' || /盖板|暗沟|暗河/.test(t.name ?? '')) continue;
    const P = proj(w.geometry);
    if (!P.some(([x, z]) => inRegion(x, z))) continue;
    const width = Math.min(60, Math.max(1.5, parseFloat(t.width) || W[t.waterway]));
    // dense points with a flag: is there water drawn here already?
    const D = [];
    for (let i = 0; i < P.length; i++) {
      if (i > 0) { const [ax, az] = P[i - 1], [bx, bz] = P[i], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 5); for (let k = 1; k < n; k++) D.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
      D.push(P[i]);
    }
    const dry = D.map(([x, z]) => inRegion(x, z) && !inWet(x, z));
    for (let s0 = 0; s0 < D.length;) {
      if (!dry[s0]) { s0++; continue; }
      let s1 = s0; while (s1 + 1 < D.length && dry[s1 + 1]) s1++;
      // one point of overlap into the water at either end, so the strip meets it
      const a = Math.max(0, s0 - 1), e = Math.min(D.length - 1, s1 + 1), run = D.slice(a, e + 1);
      let L = 0; for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      if (run.length >= 2 && L >= 10) {
        const left = [], right = [];
        for (let i = 0; i < run.length; i++) {
          const p = run[Math.max(0, i - 1)], q = run[Math.min(run.length - 1, i + 1)], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          const nx = -(q[1] - p[1]) / l * width / 2, nz = (q[0] - p[0]) / l * width / 2;
          left.push([run[i][0] + nx, run[i][1] + nz]); right.push([run[i][0] - nx, run[i][1] - nz]);
        }
        areaPolys.push({ k: 'water', outer: [...left, ...right.reverse()], holes: [], id: rid++ });
        strips++; metres += L;
      }
      s0 = s1 + 1;
    }
  }
  console.log(`rivers from their centre lines: ${strips} strips, ${(metres / 1000).toFixed(1)} km`);
}
// Green ground under everything else (fetch-ground.py: ESA WorldCover tree cover, grass and crops,
// CC BY 4.0): the courtyards, compounds and verges under the trees were bare paving. Drawn lowest
// (Areas.ts `lawn`), so OSM's own areas, the roads and the buildings cover it where they are.
if (!process.env.NO_EXTRA && fs.existsSync('.cache/buildings/green.json')) {
  const G = JSON.parse(fs.readFileSync('.cache/buildings/green.json', 'utf8')).p;
  let rings = [], gid = 9.8e12, nLawn = 0;
  const flush = () => {
    if (rings.length) {
      const [outer, ...holes] = rings;
      const bb = bboxOf(outer);
      if (RECTS.some((R) => !(bb[0] > R[2] || bb[2] < R[0] || bb[1] > R[3] || bb[3] < R[1]))) { areaPolys.push({ k: 'lawn', outer, holes, id: gid++ }); nLawn++; }
    }
    rings = [];
  };
  for (const r of G) {
    if (r === null) { flush(); continue; }
    const ring = [];
    for (let i = 0; i + 1 < r.length; i += 2) ring.push([r[i], r[i + 1]]);
    rings.push(ring);
  }
  flush();
  console.log(`green ground: ${nLawn} polygons`);
}
// The open trenches of the underpasses are holes in every area over them (a lawn or a square would lie
// over the hole like a lid).
if (TRENCH.holes.length) {
  const hb = TRENCH.holes.map((h) => ({ h, bb: bboxOf(h) }));
  const close = (r) => [...r, r[0]];
  let cut = 0;
  for (let i = areaPolys.length - 1; i >= 0; i--) {
    const a = areaPolys[i], bb = bboxOf(a.outer);
    const hit = hb.filter(({ bb: b }) => !(b[0] > bb[2] || b[2] < bb[0] || b[1] > bb[3] || b[3] < bb[1]));
    if (!hit.length) continue;
    let res;
    try { res = polygonClipping.difference([[close(a.outer), ...a.holes.map(close)]], ...hit.map(({ h }) => [[close(h)]])); } catch { continue; }
    const parts = res.map((poly) => ({ k: a.k, outer: poly[0].slice(0, -1), holes: poly.slice(1).map((r) => r.slice(0, -1)), id: a.id }));
    areaPolys.splice(i, 1, ...parts.filter((q) => q.outer.length >= 3));
    cut++;
  }
  console.log(`underpasses: ${cut} areas cut round the open trenches`);
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
  // In the corridors a tree's seed is its position, so the main box's trees keep theirs.
  const main = inMain(x, z);
  if (drop || underDeck(x, z)) { if (main) treeSeed++; return; }
  const seed = main ? treeSeed : 1e7 + Math.round(x * 10) * 7919 + Math.round(z * 10);
  const t = tile(...tileOf(x, z));
  t.trees.push(q1(x), q1(z), kind ?? treeType(x, z, seed), +(0.8 + 0.45 * rnd(seed, 9)).toFixed(2));
  if (main) treeSeed++;
  nTrees++;
  noteTree(x, z);
}
// Every tree placed, on an 8 m grid, so the canopy's crowns (below) do not double the ones already there.
const treeGrid = new Map();
function noteTree(x, z) { const k = Math.floor(x / 8) * 100000 + Math.floor(z / 8); (treeGrid.get(k) ?? treeGrid.set(k, []).get(k)).push(x, z); }
function nearTreeG(x, z, r) {
  const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const a = treeGrid.get((cx + dx) * 100000 + cz + dz); if (a) for (let i = 0; i < a.length; i += 2) if ((a[i] - x) ** 2 + (a[i + 1] - z) ** 2 < r * r) return true; }
  return false;
}
// Trees where the canopy map has a crown (fetch-trees.py: Meta/WRI 1 m canopy height, CC BY 4.0): the
// courtyards, compounds, campuses and parks, at their real height. Seeded by position.
const CHM = !process.env.NO_EXTRA && fs.existsSync('.cache/buildings/trees.json') ? JSON.parse(fs.readFileSync('.cache/buildings/trees.json', 'utf8')).p : null;
let nCanopy = 0;
function addCanopyTrees(onOpen) {
  if (!CHM) return;
  for (let i = 0; i < CHM.length; i += 3) {
    const x = CHM[i], z = CHM[i + 1], hgt = CHM[i + 2];
    if (!inRegion(x, z) || nearTreeG(x, z, 3.5) || inBuilding(x, z, 0.8) || nearRoad(x, z, 1.2) || underDeck(x, z) || onOpen(x, z)) continue;
    const seed = 2e7 + Math.round(x * 10) * 7919 + Math.round(z * 10);
    // a tall one is most likely a poplar; the models stand ~9 m at scale 1
    let kind = treeType(x, z, seed);
    if (hgt >= 15 && kind !== 2 && rnd(seed, 11) < 0.5) kind = 1;
    tile(...tileOf(x, z)).trees.push(q1(x), q1(z), kind, +Math.max(0.55, Math.min(1.7, hgt / 9)).toFixed(2));
    noteTree(x, z);
    nTrees++; nCanopy++;
  }
}
for (const n of nodes) if (n.tags?.natural === 'tree') { const [x, z] = project(n.lat, n.lon); addTree(x, z); }
for (const w of ways) if (w.tags?.natural === 'tree_row' && w.geometry) {
  const p = proj(w.geometry);
  for (let i = 1; i < p.length; i++) { const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); for (let s = 0; s < L; s += 7) addTree(p[i - 1][0] + (p[i][0] - p[i - 1][0]) * s / L, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * s / L); }
}
// Scatter in woods and parks (jittered grid, deterministic) - but not on the water, pitches and squares
// inside them: 北海 and 中南海 are park polygons round their lakes, and the lakes were planted.
const noTrees = new Map();
for (const a of areaPolys) {
  if (a.k !== 'water' && a.k !== 'pitch' && a.k !== 'plaza') continue;
  const bb = bboxOf(a.outer);
  for (let ix = Math.floor(bb[0] / 256); ix <= Math.floor(bb[2] / 256); ix++) for (let iz = Math.floor(bb[1] / 256); iz <= Math.floor(bb[3] / 256); iz++) {
    const k = ix * 65536 + iz;
    (noTrees.get(k) ?? noTrees.set(k, []).get(k)).push({ a, bb });
  }
}
const onOpen = (x, z) => (noTrees.get(Math.floor(x / 256) * 65536 + Math.floor(z / 256)) ?? []).some(({ a, bb }) => x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, a.outer) && !a.holes.some((h) => pip(x, z, h)));
// (with the canopy map, parks and woods get their trees from it, where they really stand)
if (!CHM) for (const a of areaPolys) {
  if (a.k !== 'wood' && a.k !== 'park') continue;
  const step = a.k === 'wood' ? 8 : 16;
  const [x0, z0, x1, z1] = bboxOf(a.outer);
  for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
    const id = Math.round(x * 7 + z * 13);
    const px = x + (rnd(id, 3) - 0.5) * step * 0.9, pz = z + (rnd(id, 4) - 0.5) * step * 0.9;
    if (!pip(px, pz, a.outer) || a.holes.some((h) => pip(px, pz, h))) continue;
    if (a.k === 'park' && rnd(id, 5) < 0.35) continue;
    if (onOpen(px, pz)) continue;
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
      const up = Math.abs(heightAlong(w, acc + s)) > 0.3;
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
      // Nor in another road's carriageway: a lamp at one road's kerb stood in the lanes of a driveway,
      // a slip road or a side road running alongside (2.5k of them, 7%), and cars met them head on.
      if (!inRegion(lx, lz) || inBuilding(lx, lz, 0.5) || nearTree(lx, lz, 1.2) || underDeck(lx, lz) || inCarriageway(lx, lz, 0.3) || heightAlong(w, acc + s) < -0.3) continue;
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
// ---------------------------------------------------------------------------------- names for the signs
// Interchanges by name (for the guide signs: 「东四环 北 ↑ 双新桥 东风北桥」): OSM names a bridge on its
// ways (bridge=yes, bridge:name), on a node (a signal or a plain point), or only through the bus stops
// round it (东风北桥南, 东风北桥东...). A name counts when it is near a main road - 朝阳公园's footbridges
// and the railway's numbered bridges are not what a driver steers by. The point is the mean of the
// ways and nodes, or of the stops when that is all there is.
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']);
const majorGrid = new Map();
for (const e of edges) if (MAJOR.has(e.c)) for (let i = 0; i < e.p.length; i += 2) { const k = `${Math.floor(e.p[i] / 100)}_${Math.floor(e.p[i + 1] / 100)}`; (majorGrid.get(k) ?? majorGrid.set(k, []).get(k)).push(e.p[i], e.p[i + 1]); }
const nearMajor = (x, z, r) => {
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const l = majorGrid.get(`${Math.floor(x / 100) + i}_${Math.floor(z / 100) + j}`); if (l) for (let k = 0; k < l.length; k += 2) if (Math.hypot(l[k] - x, l[k + 1] - z) < r) return true; }
  return false;
};
const brHits = new Map();
for (const e of els.values()) {
  const t = e.tags; if (!t?.name) continue;
  // A named point alone is not enough (东风桥 is a culvert beside 东风北桥): a car bridge, a signal or
  // a motorway junction by that name, or its bus stops.
  let name = null, stop = false;
  if (t['bridge:name'] && /桥$/.test(t['bridge:name']) && CAR.has(t.highway)) name = t['bridge:name'];
  else if (/桥$/.test(t.name) && (t.bridge && t.bridge !== 'no' ? CAR.has(t.highway) : ['traffic_signals', 'motorway_junction'].includes(t.highway))) name = t.name;
  else if ((t.highway === 'bus_stop' || t.public_transport) && /桥[东西南北]$/.test(t.name)) { name = t.name.slice(0, -1); stop = true; }
  // Not footbridges, railway bridges, the bus-only bridge at 四惠 or 天安门's 金水桥.
  if (!name || /天桥|\d号桥|特大桥|专用桥|金水桥|石桥/.test(name)) continue;
  const c = e.type === 'node' ? e : e.geometry?.[Math.floor(e.geometry.length / 2)];
  if (!c) continue;
  const [x, z] = project(c.lat, c.lon);
  if (!inRegion(x, z) || !nearMajor(x, z, 150)) continue;
  const h = brHits.get(name) ?? brHits.set(name, { pts: [], stops: [] }).get(name);
  (stop ? h.stops : h.pts).push([x, z]);
}
// Every point kept (40 m apart), not their mean: an interchange is a few hundred metres across and its
// stops stand round the outside, so a mean can be 150 m off the road that passes through it.
const bridgeNames = [];
for (const [name, h] of brHits) {
  const P = [];
  for (const p of [...h.pts, ...h.stops]) if (!P.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 40)) P.push(p);
  for (const p of P) bridgeNames.push([q1(p[0]), q1(p[1]), name]);
}
// The second line of every sign in pinyin/English (pinyin.mjs).
const roadEn = {};
for (const w of ways) if (w._road?.car && w._road.name && !(w._road.name in roadEn)) { const en = pinyinOf(w._road.name); if (en) roadEn[w._road.name] = en; }
for (const b of bridgeNames) if (!(b[2] in roadEn)) roadEn[b[2]] = pinyinOf(b[2]);
console.log(`names: ${brHits.size} interchanges (${bridgeNames.length} points), ${Object.keys(roadEn).length} roads in pinyin/English`);

// Compound walls (大院围墙, 2026-10-02, step 4 of the plan). Beijing's schools, hospitals, offices, barracks,
// factories and 小区 stand behind walls, and OSM maps a few (barrier=wall, 136 km) but almost never the
// rest. Along the boundary of each such compound (a closed way: amenity school/university/college/hospital/
// kindergarten, landuse military/industrial, office/government, a named residential estate of 3,000-
// 300,000 m²) and along every OSM wall: a 2.4 m wall 0.3 m inside the line, a metre at a time, wherever
// the line is clear of buildings (0.7 m either side: the line often runs along a facade), of every road
// and path (a gap - the gate - where one crosses: a car road's pavement and 0.4 m more, a path's width and
// 0.6 m), of decks, water, pitches and squares, and of a wall already there (hutong courtyards, another
// compound's); runs of 4 m or more (piers at the ends were tried: 60k more records, +6 MB of tiles,
// not seen from the street). One colour per compound: grey brick, red brick
// or render.
const COMPOUND_SW = { trunk: 4.5, primary: 4.5, secondary: 4, tertiary: 3.5, unclassified: 2.5, residential: 2.5, busway: 3 };
{
  let walls = 0, cid = 9.6e12, compounds = 0, metres = 0;
  const WALLS = ['#8e908f', '#8e908f', '#93593f', '#d6ccb8'];
  const taken = new Set();   // 1 m cells already holding a wall
  for (const [, t] of tiles) for (const b of t.buildings) if (b.k === 'wall') for (let i = 0; i < b.o.length; i += 2) taken.add(`${Math.floor(b.o[i])}_${Math.floor(b.o[i + 1])}`);
  const emit = (ring, tags) => {
    const id = cid++, [cx, cz] = centroid(ring);
    if (!inRegion(cx, cz)) return;
    const [ix, iz] = tileOf(cx, cz);
    tile(ix, iz).buildings.push({ i: id, ...tags, o: flat(ring), s: +rnd(id, 2).toFixed(3) });
  };
  const nearCar = (x, z) => { for (const [ax, az, bx, bz, hw, cls] of carSegs.get(tileOf(x, z).join('_')) ?? []) if (segDist(x, z, ax, az, bx, bz) < hw + (COMPOUND_SW[cls] ?? 0) + 0.4) return true; return false; };
  const clear = (x, z, nx, nz) => {
    if (taken.has(`${Math.floor(x)}_${Math.floor(z)}`)) return false;
    for (const k of [0, 0.7, -0.7]) if (inBuilding(x + nx * k, z + nz * k)) return false;
    return !nearCar(x, z) && !nearRoad(x, z, 0.6) && deckOver(x, z) === Infinity && !onOpen(x, z);
  };
  const ringArea = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  /** Walls along a polyline, `inward` the side to set them on (+1 left of the direction, -1 right, 0 on it). */
  const line = (P, inward, colour) => {
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 2) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, off = inward * 0.3;
      const ok = [];
      for (let sd = 0.5; sd < L; sd += 1) ok.push(clear(ax + ux * sd + nx * off, az + uz * sd + nz * off, nx, nz));
      for (let s0 = 0; s0 < ok.length;) {
        if (!ok[s0]) { s0++; continue; }
        let s1 = s0; while (s1 + 1 < ok.length && ok[s1 + 1]) s1++;
        const a = s0, e = Math.min(L, s1 + 1);
        if (e - a >= 4) {
          const th = 0.3, p0 = [ax + ux * a + nx * (off - th / 2), az + uz * a + nz * (off - th / 2)], p1 = [ax + ux * e + nx * (off - th / 2), az + uz * e + nz * (off - th / 2)];
          emit([p0, p1, [p1[0] + nx * th, p1[1] + nz * th], [p0[0] + nx * th, p0[1] + nz * th]], { k: 'wall', h: 2.4, m: 0, r: 'f', rh: 0, c: colour });
          for (let d = a; d < e; d += 1) taken.add(`${Math.floor(ax + ux * d + nx * off)}_${Math.floor(az + uz * d + nz * off)}`);
          walls++; metres += e - a;
        }
        s0 = s1 + 1;
      }
    }
  };
  const COMPOUND = (t) => /^(school|university|college|hospital|kindergarten|prison)$/.test(t.amenity ?? '') || /^(military|industrial)$/.test(t.landuse ?? '') || t.office === 'government' || !!t.government;
  for (const w of ways) {
    const t = w.tags; if (!t || !w.geometry || w.geometry.length < 4) continue;
    const P = proj(w.geometry);
    if (!P.some(([x, z]) => inRegion(x, z))) continue;
    if (t.barrier === 'wall') { line(P, 0, WALLS[0]); continue; }
    if (w.nodes?.[0] !== w.nodes?.at(-1)) continue;
    const A = ringArea(P), area = Math.abs(A);
    const resid = t.landuse === 'residential' && t.name && area >= 3000 && area <= 300000;
    if (!(COMPOUND(t) && area >= 1500 && area <= 600000) && !resid) continue;
    compounds++;
    // the walls go 0.3 m inside the boundary: left of a clockwise ring in screen terms is its inside when A < 0
    line(P, A > 0 ? 1 : -1, WALLS[Math.floor(rnd(w.id, 5) * WALLS.length)]);
  }
  // compounds drawn as multipolygons (the universities): their outer ways, the wall on the line itself
  for (const r of rels) {
    const t = r.tags; if (!t || !COMPOUND(t)) continue;
    let any = false;
    for (const m of r.members ?? []) {
      if (m.type !== 'way' || m.role !== 'outer' || !m.geometry || m.geometry.length < 2) continue;
      const P = proj(m.geometry);
      if (!P.some(([x, z]) => inRegion(x, z))) continue;
      line(P, 0, WALLS[Math.floor(rnd(r.id, 5) * WALLS.length)]); any = true;
    }
    if (any) compounds++;
  }
  console.log(`compound walls: ${compounds} compounds and the OSM walls, ${walls} lengths of wall (${(metres / 1000).toFixed(0)} km)`);
}
addCanopyTrees(onOpen);
console.log(`canopy trees: ${nCanopy}`);
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
// The maps' area layer (nav/mapWorker.ts), baked per block of 4 x 4 tiles: water, green, plazas and
// building outlines in whole metres. The map used to fetch every tile, all of it, to draw itself -
// 20 MB for the first city, 38 MB once the old city was in, and the 4th Ring would be three times that.
{
  const MAPDIR = path.join(OUT, 'map');
  fs.rmSync(MAPDIR, { recursive: true, force: true });
  fs.mkdirSync(MAPDIR, { recursive: true });
  const GREEN = new Set(['park', 'wood', 'grass', 'pitch']);
  const blocks = new Map();
  const ints = (r) => r.map((v) => Math.round(v));
  for (const [k, t] of tiles) {
    if (!t.buildings.length && !t.areas.length) continue;
    const e = { k, w: [], g: [], p: [], b: [] };
    for (const a of t.areas) {
      const dst = a.k === 'water' ? e.w : GREEN.has(a.k) ? e.g : a.k === 'plaza' ? e.p : null;
      if (!dst) continue;
      dst.push(ints(a.o));
      for (const h of a.hs ?? []) dst.push(ints(h));
    }
    for (const b of t.buildings) { e.b.push(ints(b.o)); for (const h of b.hs ?? []) e.b.push(ints(h)); }
    const bk = `${Math.floor(t.ix / 4)}_${Math.floor(t.iz / 4)}`;
    (blocks.get(bk) ?? blocks.set(bk, []).get(bk)).push(e);
  }
  let mb = 0;
  for (const [bk, list] of blocks) { const s = JSON.stringify(list); mb += s.length; fs.writeFileSync(path.join(MAPDIR, `m_${bk}.json`), s); }
  console.log(`map layer: ${blocks.size} blocks, ${(mb / 1e6).toFixed(1)} MB`);
}
const net = JSON.stringify({ nodes: netXZ, sig: Array.from(sig), edges, br: bridgeNames, en: roadEn });
fs.writeFileSync(path.join(OUT, 'network.json'), net);
// The underpasses (city/visual/Tunnels.ts): per sunk way its dense centre line, heights, half widths and
// covered flags per segment; and the open trenches as rings (holes in the ground plane and collider).
fs.writeFileSync(path.join(OUT, 'tunnels.json'), JSON.stringify({
  // per segment c: 1 covered, and walls: 2 on the left, 4 on the right
  t: TRENCH.ways.map(({ w, L, R, cov, eL, eR }) => ({ p: w._dense.flatMap((d) => [q1(d.x), q1(d.z)]), h: w._dense.map((d) => q1(HT.get(d.key) ?? 0)), l: L.map(q1), w: R.map(q1), r: q1(w._road.w / 2), c: cov.map((c, i) => (c ? 1 : 0) | (eL[i] ? 2 : 0) | (eR[i] ? 4 : 0)) })),
  holes: TRENCH.holes.map((r) => r.flatMap(([x, z]) => [q1(x), q1(z)])),
}));
const manifest = {
  version: 1, tile: TILE, origin: { lat: 39.90883, lon: 116.39757 },
  bounds: { x0: q1(RX0), z0: q1(RZ0), x1: q1(RX1), z1: q1(RZ1) }, regions: RECTS.map((r) => r.map(q1)), tiles: index, spawn, named,
  attribution: EXTRA ? 'Map data © OpenStreetMap contributors (ODbL), Overture Maps · buildings Shi et al. 2023, 3D-GloBFP, CMAB · trees Meta/WRI · land cover ESA WorldCover (CC BY 4.0)' : 'Map data © OpenStreetMap contributors (ODbL)',
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(OUT, 'skyline.json'), JSON.stringify({ b: sky }));
console.log(`skyline ${sky.length / 8} buildings`);
console.log(`tiles ${Object.keys(index).length}, ${(bytes / 1e6).toFixed(1)} MB; network ${(net.length / 1e6).toFixed(1)} MB (${netXZ.length / 2} nodes, ${edges.length} edges, ${sig.reduce((a, b) => a + b, 0)} signalised)`);
console.log(`buildings ${buildings.length} (outlines kept ${kept.length}/${outlines.length}, parts ${parts.length})`, kinds);
console.log(`road pieces ${roadPieces}, areas`, areaCount, `trees ${nTrees}, lamps ${nLamps}, signals ${nSignals}, crossings ${nCross}, stops ${nStops}`);
console.log('spawn', spawn);
// The guide signs are placed from the network just written (TypeScript shared with the game).
execFileSync('npx', ['tsx', 'scripts/city/signs.mts'], { stdio: 'inherit' });
// The subway entrances, placed against the tiles just written.
execFileSync('node', ['scripts/city/entrances.mjs'], { stdio: 'inherit' });
execFileSync('node', ['scripts/city/footbridges.mjs'], { stdio: 'inherit' });
execFileSync('node', ['scripts/city/railways.mjs'], { stdio: 'inherit' });
// The map's place labels (needs the places export of extract-pbf.mjs; skipped without it).
execFileSync('node', ['scripts/city/places.mjs'], { stdio: 'inherit' });
