// Subway entrances (地铁口, 2026-10-02): OSM's railway=subway_entrance nodes (~700 inside the 4th Ring)
// placed as kiosks beside the street, into public/city/entrances.json for city/visual/SubwayEntrances.ts.
// Each kiosk is a box KW wide and KL long with its long side along the nearest car road on the ground,
// as Beijing's are: moved off the carriageway and, where there is room, back behind the pavement (the
// pavement's walkers would go through it), clear of every building, of other kiosks and of water. An
// entrance inside a building (a mall's) is the building's, not drawn. The station is the entrance's own
// name when it has one, else the nearest subway station's within 700 m; the letter is `ref`.
// Run by build.mjs at its end (it reads the tiles just written); by hand: node scripts/city/entrances.mjs
// Data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { placeEn } from './pinyin.mjs';
import { REGIONS, TILE, project } from './region.mjs';

const DIR = path.resolve('public/city');
const OSM = path.resolve('.cache/osm');
/** Kiosk size where it is placed by the road: width across it, length along it. */
const KW = 4.4, KL = 10.5;
const SIDEWALK = { trunk: 4.5, primary: 4.5, secondary: 4, tertiary: 3.5, unclassified: 2.5, residential: 2.5, busway: 3 };
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;

const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const inRegion = (lat, lon) => REGIONS.some((b) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e);

// --- the entrance nodes and the stations
const ents = new Map();
for (const f of fs.readdirSync(OSM).filter((f) => /^chunk.*\.json$/.test(f))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(OSM, f), 'utf8')).elements) {
    if (e.type === 'node' && e.tags?.railway === 'subway_entrance' && inRegion(e.lat, e.lon)) ents.set(e.id, e);
  }
}
const stations = [];
const SRC = path.join(OSM, 'places.geojsonseq');
if (fs.existsSync(SRC)) {
  for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
    if (!line.includes('subway')) continue;
    const f = JSON.parse(line.replace(/^\x1e/, "")), t = f.properties;
    if (!t.name || !(t.railway === 'station' || t.public_transport === 'station') || !(t.station === 'subway' || t.subway === 'yes')) continue;
    const g = f.geometry;
    const c = g.type === 'Point' ? g.coordinates : (g.type === 'Polygon' ? g.coordinates[0][0] : g.coordinates[0][0][0]);
    const [x, z] = project(c[1], c[0]);
    stations.push({ x, z, zh: t.name.replace(/(地铁)?站$/, ''), en: (t['name:en'] ?? '').replace(/ (Subway )?Station$/i, '') });
  }
}

// --- tiles, loaded on demand
const tiles = new Map();
const tileAt = (ix, iz) => {
  const k = `${ix}_${iz}`;
  if (!tiles.has(k)) tiles.set(k, man.tiles[k] ? JSON.parse(fs.readFileSync(path.join(DIR, `t_${k}.json`), 'utf8')) : null);
  return tiles.get(k);
};
const around = (x, z) => {
  const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE), out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const t = tileAt(ix + dx, iz + dz); if (t) out.push(t); }
  return out;
};
const pip = (x, z, o) => { let c = false; for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) if ((o[i + 1] > z) !== (o[j + 1] > z) && x < (o[j] - o[i]) * (z - o[i + 1]) / (o[j + 1] - o[i + 1]) + o[i]) c = !c; return c; };
const segDist = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
const cross = (ax, az, bx, bz, cx, cz, dx, dz) => { const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (!d) return false; const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
/** Two flat rings overlap (a corner inside the other or edges crossing). */
function overlap(a, b) {
  for (let i = 0; i < a.length; i += 2) if (pip(a[i], a[i + 1], b)) return true;
  for (let i = 0; i < b.length; i += 2) if (pip(b[i], b[i + 1], a)) return true;
  for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) {
    if (cross(a[i], a[i + 1], a[(i + 2) % a.length], a[(i + 3) % a.length], b[j], b[j + 1], b[(j + 2) % b.length], b[(j + 3) % b.length])) return true;
  }
  return false;
}
/** A kiosk's ring: centre, along-road unit (ux, uz), length and width, grown by m. */
const rect = (x, z, ux, uz, len, wid, m) => {
  const a = len / 2 + m, b = wid / 2 + m, nx = -uz, nz = ux;
  return [x + ux * a + nx * b, z + uz * a + nz * b, x - ux * a + nx * b, z - uz * a + nz * b, x - ux * a - nx * b, z - uz * a - nz * b, x + ux * a - nx * b, z + uz * a - nz * b];
};
const ringArea = (o) => { let a = 0; for (let i = 0; i < o.length; i += 2) { const j = (i + 2) % o.length; a += o[i] * o[j + 1] - o[j] * o[i + 1]; } return Math.abs(a / 2); };
/** The smallest box round a ring over its edges' directions: centre, long axis, length, width. */
function obb(o) {
  let best = null;
  for (let i = 0; i < o.length; i += 2) {
    const j = (i + 2) % o.length, L = Math.hypot(o[j] - o[i], o[j + 1] - o[i + 1]);
    if (L < 0.5) continue;
    const ux = (o[j] - o[i]) / L, uz = (o[j + 1] - o[i + 1]) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < o.length; k += 2) { const a = o[k] * ux + o[k + 1] * uz, b = -o[k] * uz + o[k + 1] * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      const r = { area, x: ca * ux - cb * uz, z: ca * uz + cb * ux, ux, uz, len: a1 - a0, wid: b1 - b0 };
      if (r.len < r.wid) Object.assign(r, { ux: -uz, uz: ux, len: b1 - b0, wid: a1 - a0 });
      best = r;
    }
  }
  return best;
}
const stationNames = new Set(stations.map((s) => s.zh));

const placed = [], names = [], nameIdx = new Map();
let inBuilding = 0, noRoad = 0, noRoom = 0, replaced = 0;
for (const e of [...ents.values()].sort((a, b) => a.id - b.id)) {
  const [x, z] = project(e.lat, e.lon);
  const T = around(x, z);
  let bld = T.flatMap((t) => t.buildings.filter((b) => b.k !== 'wall' && (b.m ?? 0) < 3));
  // OSM (and the learnt outlines, from the air) often draw the kiosk itself as a small low building:
  // the kiosk takes its place and its box. An entrance in anything bigger is the building's own.
  const host = bld.find((b) => pip(x, z, b.o));
  let fit = null;
  if (host) {
    const A = ringArea(host.o);
    // OSM's kiosks are often building=train_station (kind station, 18 m by default); the learnt outlines' heights over a kiosk are noise
    const box = A < 400 && (host.h < 9 || host.k === 'station' || A < 160) ? obb(host.o) : null;
    if (!box || box.len < 5 || box.len > 26 || box.wid < 2.6 || box.wid > 12) { inBuilding++; continue; }
    fit = { ...box, len: Math.min(16, Math.max(7, box.len)), wid: Math.min(6, Math.max(3.6, box.wid)) };
    bld = bld.filter((b) => b !== host);
  }
  // the car carriageways round it, and the nearest on the ground
  const segs = [];
  for (const t of T) for (const r of t.roads) {
    if (!CAR.test(r.c)) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const lifted = r.h && Math.max(r.h[i / 2] ?? 0, r.h[i / 2 + 1] ?? 0) > 2;
      segs.push({ ax: r.p[i], az: r.p[i + 1], bx: r.p[i + 2], bz: r.p[i + 3], hw: r.w / 2, sw: SIDEWALK[r.c] ?? 0, c: r.c, lifted });
    }
  }
  const water = T.flatMap((t) => t.areas.filter((a) => a.k === 'water'));
  const ok = (cx, cz, ux, uz, len, wid) => {
    const r = rect(cx, cz, ux, uz, len, wid, 0.4);
    if (bld.some((b) => overlap(r, b.o))) return false;
    for (const q of segs) {
      if (q.lifted) continue;
      for (let i = 0; i < 8; i += 2) if (segDist(r[i], r[i + 1], q.ax, q.az, q.bx, q.bz) < q.hw + 0.3) return false;
      if (segDist(cx, cz, q.ax, q.az, q.bx, q.bz) < q.hw + wid / 2 + 0.3) return false;
      if (cross(r[0], r[1], r[4], r[5], q.ax, q.az, q.bx, q.bz) || cross(r[2], r[3], r[6], r[7], q.ax, q.az, q.bx, q.bz)) return false;
    }
    if (water.some((a) => pip(cx, cz, a.o))) return false;
    return !placed.some((p) => Math.hypot(p.x - cx, p.z - cz) < (len + p.len) / 2 + 1 && overlap(r, rect(p.x, p.z, p.ux, p.uz, p.len, p.wid, 0.4)));
  };
  let best = null;
  if (fit && ok(fit.x, fit.z, fit.ux, fit.uz, fit.len, fit.wid)) { best = fit; replaced++; }
  else {
    let near = null;
    for (const s of segs) {
      if (s.lifted || /^service/.test(s.c)) continue;
      const d = segDist(x, z, s.ax, s.az, s.bx, s.bz) - s.hw;
      if (!near || d < near.d) near = { s, d };
    }
    if (!near || near.d > 40) { noRoad++; continue; }
    const { s } = near;
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az), ux = (s.bx - s.ax) / L, uz = (s.bz - s.az) / L;
    // the side of the road the node is on, and its offset from the centre line
    const nx = -uz, nz = ux, side = Math.sign((x - s.ax) * nx + (z - s.az) * nz) || 1;
    const t0 = (x - s.ax) * ux + (z - s.az) * uz, off0 = Math.abs((x - s.ax) * nx + (z - s.az) * nz);
    const inner = s.hw + 0.5 + KW / 2, behind = s.hw + 0.18 + s.sw + 0.4 + KW / 2;
    // candidates: the node's own offset (kept off the carriageway), then behind the pavement, then
    // anywhere on it; shifted along the road up to 9 m. On the pavement costs 3 m: its walkers go
    // through a kiosk standing in their way.
    for (let off = inner; off <= behind + 8; off += 0.5) {
      const onWalk = off - KW / 2 < s.hw + 0.18 + s.sw;
      for (const sh of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6, 9, -9]) {
        const cost = Math.abs(off - Math.max(off0, inner)) + Math.abs(sh) * 0.7 + (onWalk ? 3 : 0);
        if (best && cost >= best.cost) continue;
        const cx = s.ax + ux * (t0 + sh) + nx * side * off, cz = s.az + uz * (t0 + sh) + nz * side * off;
        if (ok(cx, cz, ux, uz, KL, KW)) best = { cost, x: cx, z: cz, ux, uz, len: KL, wid: KW };
      }
    }
    if (!best) { noRoom++; continue; }
  }
  // the station: the entrance's own name when it is a station's (not a letter, not 华夏银行), else the nearest station's
  const t = e.tags;
  let zh = '', en = '';
  const own = (t['name:zh'] ?? t.name ?? '').replace(/(地铁)?站.*$/, '');
  if (stationNames.has(own)) ({ zh, en } = stations.find((st) => st.zh === own));
  else {
    let d = 700;
    for (const st of stations) { const dd = Math.hypot(st.x - x, st.z - z); if (dd < d) { d = dd; zh = st.zh; en = st.en; } }
  }
  en = en.replace(/ (Subway|Metro)\b.*$/i, '');
  if (zh && !en) en = placeEn(zh) || '';
  let ref = (t.ref ?? '').trim();
  if (!ref && /^[A-Za-z]\d?$/.test(t.name ?? '')) ref = t.name;
  ref = /^[A-Za-z]\d{0,2}$/.test(ref) ? ref.toUpperCase() : '';
  const key = zh + '|' + en;
  let ni = -1;
  if (zh) { ni = nameIdx.get(key) ?? -1; if (ni < 0) { ni = names.length; names.push([zh, en]); nameIdx.set(key, ni); } }
  // the open end: either, by the id (the stair runs down towards the closed end)
  const flip = e.id % 2 ? 1 : -1;
  placed.push({ x: best.x, z: best.z, ux: best.ux * flip, uz: best.uz * flip, len: best.len, wid: best.wid, ni, ref, id: e.id });
}
const q2 = (v) => Math.round(v * 100) / 100;
const out = {
  size: [KW, KL],
  names,
  // x, z, yaw (local +Z = the open end), length, width, station index (-1 none), exit letter
  e: placed.map((p) => [q2(p.x), q2(p.z), +Math.atan2(p.ux, p.uz).toFixed(4), q2(p.len), q2(p.wid), p.ni, p.ref]),
};
fs.writeFileSync(path.join(DIR, 'entrances.json'), JSON.stringify(out));
console.log(`subway entrances: ${placed.length} placed of ${ents.size} (${replaced} in place of OSM's own box, ${inBuilding} inside a building, ${noRoad} with no street near, ${noRoom} with no room), ${names.length} stations, ${placed.filter((p) => p.ni < 0).length} unnamed`);
