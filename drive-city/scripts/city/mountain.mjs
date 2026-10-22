// 出城路段和妙峰山山路（2026-10-22，「做下一步出城路段和妙峰山山路」）。
//
// The city stops at the edge of the OSM data (x0 = -17212, about 116.196 E). 阜石路 (G109 京拉路) runs off it
// westwards at z -1625; in the real world it goes on to the foot of 妙峰山 (门头沟, ~25 km). Here the distance is
// compressed (the GTA way): a 2.4 km 京拉路 from the end of 阜石路, past a petrol station and a village, climbing 35 m to
// the foot of the mountain, then the top 9.6 km of 妙峰山路 - its real line (OSM) and its real heights (terrarium DEM,
// lowered so its foot meets the road from the city) - up to a turning circle by the gate at the top (1039 m).
//
// Writes public/city/mountain.bin (src/mountain/ reads it: terrain grid, the roads' centre lines with heights and banking,
// guardrail runs, trees, props) and appends the two roads to public/city/network.json (marked `mt: 1`, replaced on a
// re-run), so traffic, the GPS and the map know them; then reruns signs.mts and netpack.mts (the closures at the edge
// go, the network pack follows). Run after build.mjs (it calls this) or alone:
//
//   node scripts/city/mountain.mjs [--preview out.png] [--no-signs]   (--no-signs: build.mjs reruns signs and netpack itself)
//
// Needs osmium (extract-pbf.mjs's), data/beijing-latest.osm.pbf, and the network: DEM tiles are fetched once into
// .cache/dem (AWS terrain tiles, terrarium encoding, zoom 13: ~15 m a pixel here).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'city');
const CACHE = path.join(ROOT, '.cache', 'mountain');
const DEM = path.join(ROOT, '.cache', 'dem');
const PBF = path.join(ROOT, 'data', 'beijing-latest.osm.pbf');
const argv = process.argv.slice(2);
const PREVIEW = argv.includes('--preview') ? argv[argv.indexOf('--preview') + 1] : null;
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(DEM, { recursive: true });

// ---- placement ------------------------------------------------------------------------------------------
/** The city's west edge (manifest bounds x0), and where 阜石路's two carriageways end at it. */
const X0 = -17211.9;
const FUSHI_W_END = [-17220, -1628];   // westbound end (node at the edge)
const FUSHI_E_START = [-17221, -1617]; // eastbound start
/** Where the two carriageways meet the two-way 京拉路. */
const MERGE = [-17262, -1622];
/** The mountain road's foot sits here (game metres, y up), its real line turned as it is (north up). */
const FOOT = { x: -19620, z: -2380, y: 35 };
/** The stretch of 妙峰山路 used: from the top down this far (m). */
const SECTION = 9600;
const ROAD_W = 7.5, ROAD_WT = 9;           // mountain road, 京拉路 (carriageway widths, m)
const STEP = 2;                            // centre-line spacing (m)
const CELL = 5;                            // terrain grid (m)
const MARGIN = 650;                        // terrain beyond the roads (m)
const MAX_GRADE = 0.12;
/** The ring of far hills round the detailed ground (m) and its grid (a multiple of CELL, so the two meet on shared lines). */
const RING = 4500, RCELL = 100;

// ---- small maths ----------------------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Value noise, smooth, ~1 at its peaks. */
function noise2(x, z, seed = 0) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(h(i, j), h(i + 1, j), u), lerp(h(i, j + 1), h(i + 1, j + 1), u), v);
}
const fbm = (x, z, seed) => 0.5 * noise2(x, z, seed) + 0.3 * noise2(x * 2.1, z * 2.1, seed + 1) + 0.2 * noise2(x * 4.3, z * 4.3, seed + 2);

// ---- the road from OSM ----------------------------------------------------------------------------------
function osmRoad() {
  const box = path.join(CACHE, 'box.osm.pbf'), road = path.join(CACHE, 'road.osm.pbf'), gj = path.join(CACHE, 'road.geojsonseq');
  if (!fs.existsSync(gj)) {
    execFileSync('osmium', ['extract', '-b', '115.98,39.97,116.10,40.09', PBF, '-o', box, '--overwrite']);
    execFileSync('osmium', ['tags-filter', box, 'w/name=妙峰山路', '-o', road, '--overwrite']);
    execFileSync('osmium', ['export', road, '-f', 'geojsonseq', '-o', gj, '--overwrite']);
  }
  const segs = [];
  for (const line of fs.readFileSync(gj, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const f = JSON.parse(line.replace(/^\x1e/, ''));
    if (f.geometry.type === 'LineString') segs.push(f.geometry.coordinates);
  }
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const ends = new Map();
  segs.forEach((s, i) => { for (const e of [key(s[0]), key(s[s.length - 1])]) (ends.get(e) ?? ends.set(e, []).get(e)).push(i); });
  const used = new Set(), chains = [];
  for (const [k, list] of ends) {
    if (list.length !== 1 || used.has(list[0])) continue;
    let cur = k, ch = [];
    for (;;) {
      const nxt = (ends.get(cur) ?? []).filter((i) => !used.has(i));
      if (!nxt.length) break;
      const i = nxt[0]; used.add(i);
      let s = segs[i];
      if (key(s[0]) !== cur) s = [...s].reverse();
      ch = ch.length ? ch.concat(s.slice(1)) : s.slice();
      cur = key(s[s.length - 1]);
    }
    chains.push(ch);
  }
  chains.sort((a, b) => b.length - a.length);
  let main = chains[0];
  if (main[0][1] < main[main.length - 1][1]) main = [...main].reverse();   // from the top (north)
  return main;
}

// ---- DEM (terrarium) ------------------------------------------------------------------------------------
const Z = 13;
const tiles = new Map();
async function loadTile(tx, ty) {
  const k = `${tx}_${ty}`;
  if (tiles.has(k)) return tiles.get(k);
  const f = path.join(DEM, `${Z}_${tx}_${ty}.png`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
    if (!r.ok) throw new Error(`DEM tile ${k}: HTTP ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) h[i] = data[i * info.channels] * 256 + data[i * info.channels + 1] + data[i * info.channels + 2] / 256 - 32768;
  tiles.set(k, h);
  return h;
}
const tileXY = (lon, lat) => { const n = 2 ** Z; const r = (lat * Math.PI) / 180; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n]; };
async function preloadDem(lon0, lat0, lon1, lat1) {
  const [ax, ay] = tileXY(lon0, lat1), [bx, by] = tileXY(lon1, lat0);
  for (let tx = Math.floor(ax); tx <= Math.floor(bx); tx++) for (let ty = Math.floor(ay); ty <= Math.floor(by); ty++) await loadTile(tx, ty);
}
/** Height (m) at a point, bilinear; the tiles must be preloaded. */
function dem(lon, lat) {
  const [x, y] = tileXY(lon, lat);
  const tx = Math.floor(x), ty = Math.floor(y);
  const px = (x - tx) * 256 - 0.5, py = (y - ty) * 256 - 0.5;
  const at = (i, j) => {
    let X = tx, Y = ty;
    if (i < 0) { X--; i += 256; } else if (i > 255) { X++; i -= 256; }
    if (j < 0) { Y--; j += 256; } else if (j > 255) { Y++; j -= 256; }
    const t = tiles.get(`${X}_${Y}`);
    if (!t) throw new Error(`DEM tile ${X}_${Y} not loaded`);
    return t[j * 256 + i];
  };
  const i0 = Math.floor(px), j0 = Math.floor(py), fx = px - i0, fy = py - j0;
  return lerp(lerp(at(i0, j0), at(i0 + 1, j0), fx), lerp(at(i0, j0 + 1), at(i0 + 1, j0 + 1), fx), fy);
}

// ---- polylines --------------------------------------------------------------------------------------------
/** Resample an (x, z) polyline every `step` m by arc length. */
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    let s = step - carry;
    while (s <= L) { out.push([ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L]); s += step; }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  return out;
}
/** Gaussian smoothing of a polyline's (x, z) (ends pinned), `sigma` in points. */
function smoothLine(pts, sigma) {
  const r = Math.ceil(sigma * 3), w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  return pts.map((p, i) => {
    if (i < 2 || i > pts.length - 3) return p;
    let sx = 0, sz = 0, sw = 0;
    for (let k = -r; k <= r; k++) { const j = clamp(i + k, 0, pts.length - 1), ww = w[k + r]; sx += pts[j][0] * ww; sz += pts[j][1] * ww; sw += ww; }
    return [sx / sw, sz / sw];
  });
}
function smooth1(a, sigma) {
  const r = Math.ceil(sigma * 3), w = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)));
  return a.map((_, i) => { let s = 0, sw = 0; for (let k = -r; k <= r; k++) { const j = clamp(i + k, 0, a.length - 1); s += a[j] * w[k + r]; sw += w[k + r]; } return s / sw; });
}
/** Limit the grade both ways (keeping the first point), then pull the last towards `endY` if given. */
function gradeLimit(h, step, g) {
  const o = h.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < o.length; i++) o[i] = clamp(o[i], o[i - 1] - g * step, o[i - 1] + g * step);
    for (let i = o.length - 2; i >= 1; i--) o[i] = clamp(o[i], o[i + 1] - g * step, o[i + 1] + g * step);
  }
  return o;
}
/** Signed curvature (1/m, + to the left) per point, smoothed over ~`sigma` points. */
function curvature(pts, sigma) {
  const k = pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return 0;
    const a = Math.atan2(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]), b = Math.atan2(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]);
    let d = b - a; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    // heading measured from +z towards +x: a positive turn is to the right in the x-z plane seen from above with z down
    return -d / Math.hypot(pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]) * 2;
  });
  return smooth1(k, sigma);
}

// ---- build ------------------------------------------------------------------------------------------------
const line = osmRoad();
// distance from the top along the OSM line, cut at SECTION, then reversed: foot to top
const ll = [line[0]];
{
  let d = 0;
  for (let i = 1; i < line.length && d < SECTION; i++) {
    const a = line[i - 1], b = line[i];
    const L = Math.hypot((b[0] - a[0]) * 85300, (b[1] - a[1]) * 111195);
    if (d + L > SECTION) { const t = (SECTION - d) / L; ll.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); break; }
    ll.push(b); d += L;
  }
}
ll.reverse();
const [lonB, latB] = ll[0];
const KX = 111195 * Math.cos((latB * Math.PI) / 180), KY = 111195;
const toGame = (lon, lat) => [FOOT.x + (lon - lonB) * KX, FOOT.z - (lat - latB) * KY];
const toLonLat = (x, z) => [lonB + (x - FOOT.x) / KX, latB - (z - FOOT.z) / KY];

// the mountain road: densify, smooth the corners OSM left as kinks, resample evenly
let mPts = resample(ll.map(([lo, la]) => toGame(lo, la)), 1);
mPts = smoothLine(mPts, 5);
mPts = resample(mPts, STEP);

// DEM over the mountain and its margin
const mb = mPts.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
{
  const [lo0, la1] = toLonLat(mb[0] - MARGIN - 400, mb[1] - MARGIN - 400), [lo1, la0] = toLonLat(mb[2] + MARGIN + 400, mb[3] + MARGIN + 400);
  await preloadDem(lo0, la0, lo1, la1);
}
const realAt = (x, z) => { const [lo, la] = toLonLat(x, z); return dem(lo, la); };
const hReal = smooth1(mPts.map(([x, z]) => realAt(x, z)), 10);
const H_OFF = hReal[0] - FOOT.y;
let mH = gradeLimit(hReal.map((h) => h - H_OFF), STEP, MAX_GRADE);
mH = mH.map((h, i) => h + (FOOT.y - mH[0]) * (1 - i / (mH.length - 1)) * 0);   // the foot stays at FOOT.y (first point pinned)

// 京拉路: from the merge west, a long easy S through the valley, into the mountain road's first heading
const d0 = [mPts[1][0] - mPts[0][0], mPts[1][1] - mPts[0][1]], dl = Math.hypot(...d0);
const dirF = [d0[0] / dl, d0[1] / dl];
function hermite(p0, t0, p1, t1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    out.push([h00 * p0[0] + h10 * t0[0] + h01 * p1[0] + h11 * t1[0], h00 * p0[1] + h10 * t0[1] + h01 * p1[1] + h11 * t1[1]]);
  }
  return out;
}
const tCtrl = [MERGE, [-17950, -1660], [-18800, -1980], [FOOT.x - dirF[0] * 1, FOOT.z - dirF[1] * 1]];
const tTan = [[-700, 0], [-750, -60], [-700, -260], [dirF[0] * 600, dirF[1] * 600]];
let tPts = [];
for (let i = 0; i < tCtrl.length - 1; i++) { const seg = hermite(tCtrl[i], tTan[i], tCtrl[i + 1], tTan[i + 1], 400); tPts = tPts.concat(i ? seg.slice(1) : seg); }
tPts = resample(tPts, STEP);
tPts[tPts.length - 1] = [FOOT.x, FOOT.z];
// its height: level by the city, easing up to the foot
const tLen = (tPts.length - 1) * STEP;
const tH = tPts.map((_, i) => FOOT.y * smooth(0.08, 1, (i * STEP) / tLen));

console.log(`mountain road ${(mPts.length * STEP / 1000).toFixed(2)} km, ${mH[0].toFixed(0)} -> ${mH[mH.length - 1].toFixed(0)} m (real ${hReal[0].toFixed(0)} -> ${hReal[hReal.length - 1].toFixed(0)}), 京拉路 ${(tLen / 1000).toFixed(2)} km`);
console.log(`mountain bbox x ${mb[0].toFixed(0)}..${mb[2].toFixed(0)} z ${mb[1].toFixed(0)}..${mb[3].toFixed(0)}`);

// ---- roads as records ---------------------------------------------------------------------------------------
// Each: centre points (x, z), heights, half width, bank per point (radians, + rolls the left edge up), name.
function bankOf(pts, maxBank) {
  const k = curvature(pts, 6);
  // tilt into the curve: a left turn (k > 0) lowers the left edge
  return smooth1(k.map((c) => clamp(-c * 3.2, -maxBank, maxBank)), 8);
}
const roads = [
  { name: '京拉路', en: 'Jingla Road (G109)', cls: 'primary', pts: tPts, h: tH, hw: ROAD_WT / 2, bank: bankOf(tPts, 0.03) },
  { name: '妙峰山路', en: 'Miaofengshan Road', cls: 'tertiary', pts: mPts, h: mH, hw: ROAD_W / 2, bank: bankOf(mPts, 0.07) },
];
// the turning circle at the top: a ring of road round a small plaza, entered straight on
{
  const m = roads[1], n = m.pts.length;
  const [px, pz] = m.pts[n - 1], dx = (px - m.pts[n - 6][0]) / 10, dz = (pz - m.pts[n - 6][1]) / 10, dl = Math.hypot(dx, dz);
  const fx = dx / dl, fz = dz / dl, R = 17;
  const cx = px + fx * R, cz = pz + fz * R;                 // the ring's centre, the road meeting it at its near side
  const a0 = Math.atan2(px - cx, pz - cz), pts = [], N = Math.round((2 * Math.PI * R) / STEP);
  for (let i = 0; i <= N; i++) { const a = a0 + (i / N) * 2 * Math.PI; pts.push([cx + Math.sin(a) * R, cz + Math.cos(a) * R]); }
  const y = m.h[n - 1];
  roads.push({ name: '妙峰山路', en: 'Miaofengshan Road', cls: 'tertiary', pts, h: pts.map(() => y), hw: ROAD_W / 2, bank: pts.map(() => 0), ring: true, centre: [cx, cz] });
}
const SUMMIT = { x: roads[2].centre[0], z: roads[2].centre[1], y: roads[1].h[roads[1].h.length - 1] };

// a spatial index over every road point
const RB = 24;
const rIndex = new Map();
roads.forEach((r, ri) => r.pts.forEach(([x, z], i) => { const k = `${Math.floor(x / RB)},${Math.floor(z / RB)}`; (rIndex.get(k) ?? rIndex.set(k, []).get(k)).push(ri, i); }));
/** Road points within `rad` of (x, z): [road, index, distance] (nearest segment distance per road). */
function roadsNear(x, z, rad) {
  const out = [];
  const best = new Map();
  const a = Math.floor((x - rad) / RB), b = Math.floor((x + rad) / RB), c = Math.floor((z - rad) / RB), d = Math.floor((z + rad) / RB);
  for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) {
    const l = rIndex.get(`${i},${j}`);
    if (!l) continue;
    for (let k = 0; k < l.length; k += 2) {
      const ri = l[k], pi = l[k + 1], [px, pz] = roads[ri].pts[pi];
      const dd = Math.hypot(px - x, pz - z);
      if (dd > rad) continue;
      // a road coming back nearby later along its length is another pass: keep the nearest per 60 m of road
      const key = `${ri}:${Math.floor(pi / 30)}`;
      const cur = best.get(key);
      if (!cur || dd < cur[2]) best.set(key, [ri, pi, dd]);
    }
  }
  for (const v of best.values()) out.push(v);
  return out;
}

// ---- terrain --------------------------------------------------------------------------------------------------
const allPts = roads.flatMap((r) => r.pts);
// edges on the far hills' 100 m lines (but the east one, the city's edge), so the two grids share their seam
const gx0 = Math.floor((Math.min(...allPts.map((p) => p[0])) - MARGIN) / 100) * 100;
const gz0 = Math.floor((Math.min(...allPts.map((p) => p[1])) - MARGIN) / 100) * 100;
const gx1 = X0, gz1 = Math.ceil((Math.max(...allPts.map((p) => p[1])) + MARGIN) / 100) * 100;
const NX = Math.round((gx1 - gx0) / CELL) + 1, NZ = Math.round((gz1 - gz0) / CELL) + 1;
console.log(`terrain ${NX} x ${NZ} at ${CELL} m (${((NX * NZ) / 1e6).toFixed(2)} M samples), x ${gx0}..${gx1} z ${gz0}..${gz1}`);
const demBox = [mb[0] - MARGIN, mb[1] - MARGIN, mb[2] + MARGIN, mb[3] + MARGIN];
{
  const [lo0, la1] = toLonLat(gx0 - RING - 1200, gz0 - RING - 1200), [lo1, la0] = toLonLat(gx1 + 1200, gz1 + RING + 1200);
  await preloadDem(lo0, la0, lo1, la1);
}
// Coarse fields (50 m): the real ground's regional level (a 900 m blur) and the distance to the mountain road.
const CG = 50, CX = Math.ceil((gx1 - gx0) / CG) + 1, CZ = Math.ceil((gz1 - gz0) / CG) + 1;
const raw = new Float32Array(CX * CZ), low = new Float32Array(CX * CZ), dMt = new Float32Array(CX * CZ).fill(1e9);
for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) raw[j * CX + i] = realAt(gx0 + i * CG, gz0 + j * CG) - H_OFF;
{
  const r = Math.round(900 / CG), tmp = new Float32Array(CX * CZ);
  for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const ii = clamp(i + k, 0, CX - 1); s += raw[j * CX + ii]; n++; } tmp[j * CX + i] = s / n; }
  for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const jj = clamp(j + k, 0, CZ - 1); s += tmp[jj * CX + i]; n++; } low[j * CX + i] = s / n; }
  for (const [x, z] of mPts) {
    const ci = Math.round((x - gx0) / CG), cj = Math.round((z - gz0) / CG), rr = Math.ceil(1400 / CG);
    for (let j = Math.max(0, cj - rr); j <= Math.min(CZ - 1, cj + rr); j++) for (let i = Math.max(0, ci - rr); i <= Math.min(CX - 1, ci + rr); i++) {
      const d = Math.hypot(gx0 + i * CG - x, gz0 + j * CG - z); if (d < dMt[j * CX + i]) dMt[j * CX + i] = d;
    }
  }
}
const coarse = (f, x, z) => {
  const fx = clamp((x - gx0) / CG, 0, CX - 1.001), fz = clamp((z - gz0) / CG, 0, CZ - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  return lerp(lerp(f[j * CX + i], f[j * CX + i + 1], u), lerp(f[(j + 1) * CX + i], f[(j + 1) * CX + i + 1], u), v);
};
/** The ground before the roads cut into it: the real ground everywhere (lowered by H_OFF), but away from the mountain
 *  road its regional level is swapped for the valley's (京拉路's height), keeping the local hills; a broad valley floor
 *  along 京拉路; level with the city's ground over the last 300 m to the edge. */
function natural(x, z) {
  const real = realAt(x, z) - H_OFF;
  // flat towards the city (east of the mountain), the real hills everywhere else
  const wFlat = smooth(mb[2] + 250, mb[2] + 1300, x) * smooth(500, 1000, coarse(dMt, x, z));
  const near = roadsNear(x, z, 300).filter((r) => r[0] === 0);
  const dRoad = near.length ? Math.min(...near.map((r) => r[2])) : 300;
  const roadY = near.length ? roads[0].h[near.reduce((a, b) => (b[2] < a[2] ? b : a))[1]] : FOOT.y * clamp((X0 - x) / 2500, 0, 1);
  const base = lerp(coarse(low, x, z), roadY, wFlat);
  // relief: full on the mountain, gentler hills in the valley, flat along 京拉路
  const relief = (real - coarse(low, x, z)) * lerp(1, 0.55, wFlat) * smooth(30, 280, dRoad);
  const h = base + relief;
  return lerp(h, 0, 1 - smooth(0, 300, X0 - x));
}
const H = new Float32Array(NX * NZ);
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) H[j * NX + i] = natural(gx0 + i * CELL, gz0 + j * CELL);
// the far hills: natural ground on a 100 m grid from RING beyond the detailed ground to the city's edge; inside the
// detailed ground a marker (-32768 dm). Its last column may lie a few metres over the edge (level there).
const RX0 = gx0 - RING, RZ0 = gz0 - RING, RNX = Math.ceil((X0 - RX0) / RCELL) + 1, RNZ = Math.ceil((gz1 + RING - RZ0) / RCELL) + 1;
const RH = new Float32Array(RNX * RNZ);
for (let j = 0; j < RNZ; j++) for (let i = 0; i < RNX; i++) {
  const x = RX0 + i * RCELL, z = RZ0 + j * RCELL;
  const inside = x > gx0 + 1 && x < gx1 - 1 && z > gz0 + 1 && z < gz1 - 1;
  RH[j * RNX + i] = inside ? NaN : x >= X0 - 1 ? 0 : natural(x, z);
}
console.log(`far hills ${RNX} x ${RNZ} at ${RCELL} m`);
// the roads cut in: under the carriageway the ground is just below it; beyond its shoulder a cut face (1:0.8) or a
// fill slope (1:1.4) runs out to the natural ground. Passes of the road close to each other (the hairpins) each limit
// it; where their limits cross, the nearest pass wins.
const SHOULDER = 1.6;
let carved = 0;
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const x = gx0 + i * CELL, z = gz0 + j * CELL;
  const near = roadsNear(x, z, 70);
  if (!near.length) continue;
  let lo = -Infinity, hi = Infinity, best = null;
  for (const [ri, pi, d] of near) {
    // a level verge of 3.5 m past the shoulder before the cut or fill: on a 5 m grid the slope otherwise rises from
    // inside the shoulder (the interpolation between a sample under the road and one past it), a kerb the cars hit
    const r = roads[ri], ry = r.h[pi] - 0.35, e = Math.max(0, d - r.hw - SHOULDER - 3.5);
    const l = ry - e * 1.4 - (e > 0 ? 0 : 0), u = ry + e * 1.25;
    if (!best || d < best.d) best = { l, u, d };
    lo = Math.max(lo, l); hi = Math.min(hi, u);
  }
  const n = H[j * NX + i];
  const h = lo <= hi ? clamp(n, lo, hi) : clamp(n, best.l, best.u);
  if (h !== n) { H[j * NX + i] = h; carved++; }
}
console.log(`carved ${carved} samples`);
const hAt = (x, z) => {
  const fx = clamp((x - gx0) / CELL, 0, NX - 1.001), fz = clamp((z - gz0) / CELL, 0, NZ - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  return lerp(lerp(H[j * NX + i], H[j * NX + i + 1], u), lerp(H[(j + 1) * NX + i], H[(j + 1) * NX + i + 1], u), v);
};

// ---- guardrails -------------------------------------------------------------------------------------------------
// On the valley side wherever the ground 6.5 m beyond the shoulder (past the level verge) is 1.6 m or more below the road; gaps under 24 m
// filled, runs under 16 m dropped. [road, side (+1 left / -1 right), from, to] in point indices.
const rails = [];
roads.forEach((r, ri) => {
  if (r.ring) return;
  for (const side of [1, -1]) {
    const want = r.pts.map((p, i) => {
      if (i === 0 || i === r.pts.length - 1) return false;
      const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      // left of travel (heading from +z towards +x) is (dz, -dx) / L
      const lx = (dz / L) * side, lz = (-dx / L) * side;
      // past the level verge (3.5 m)
      const o = r.hw + SHOULDER + 6.5;
      return hAt(p[0] + lx * o, p[1] + lz * o) < r.h[i] - 1.6;
    });
    const fill = Math.round(24 / STEP), min = Math.round(16 / STEP);
    for (let i = 0; i < want.length; i++) if (!want[i]) { let j = i; while (j < want.length && !want[j]) j++; if (i > 0 && j < want.length && j - i < fill) for (let k = i; k < j; k++) want[k] = true; i = j; }
    for (let i = 0; i < want.length; i++) if (want[i]) { let j = i; while (j < want.length && want[j]) j++; if (j - i >= min) rails.push([ri, side, i, j - 1]); i = j; }
  }
});
console.log(`guardrails ${rails.length} runs, ${(rails.reduce((s, r) => s + (r[3] - r[2]) * STEP, 0) / 1000).toFixed(1)} km`);

// ---- trees --------------------------------------------------------------------------------------------------------
// The western hills are 侧柏 and oak scrub: cypresses (type 2) on the mountain, 国槐 and poplars (0, 1) along 京拉路 and
// in the village. Thick by the road, thinner further off, none beyond 260 m (the ground's colour carries the forest),
// none on the road, on cliffs or where something stands (props, below).
const R = rng(20261022);
const trees = [];
const props = [];
const keepOut = [];               // [x, z, r]: props' footprints
function slope(x, z) { const e = 2.5; return Math.hypot(hAt(x + e, z) - hAt(x - e, z), hAt(x, z + e) - hAt(x, z - e)) / (2 * e); }

// ---- props --------------------------------------------------------------------------------------------------------
// kinds: house (平房: x, z, yaw, w, d), station (加油站), sign (green guide board: text), warn (连续弯路), km (km stone),
// mirror (convex mirror at a hairpin), gate (the 牌楼 at the top), temple (red wall and hall), plaza (the top's paving)
function along(r, s, off) {
  const i = clamp(Math.round(s / STEP), 1, r.pts.length - 2), a = r.pts[i - 1], b = r.pts[i + 1], p = r.pts[i];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), lx = dz / L, lz = -dx / L;
  return { x: p[0] + lx * off, z: p[1] + lz * off, y: r.h[i], yaw: Math.atan2(dx, dz), i };
}
const T0 = roads[0], M0 = roads[1];
// the petrol station on the right going out, 650 m from the city
{
  const p = along(T0, 650, -(T0.hw + 16));
  props.push({ k: 'station', x: p.x, z: p.z, y: hAt(p.x, p.z), yaw: p.yaw }); keepOut.push([p.x, p.z, 22]);
}
// the village (村) either side 1.4-2.0 km out: rows of 平房 set back from the road
for (let s = 1400; s < 2050; s += 26) for (const side of [1, -1]) {
  if (R() < 0.25) continue;
  for (const row of [0, 1]) {
    const off = side * (T0.hw + 14 + row * 17 + R() * 3);
    const p = along(T0, s + R() * 8, off);
    const w = 9 + R() * 5, d = 6 + R() * 2;
    props.push({ k: 'house', x: p.x, z: p.z, y: hAt(p.x, p.z), yaw: p.yaw + (side > 0 ? 0 : Math.PI), w, d, c: Math.floor(R() * 4) }); keepOut.push([p.x, p.z, 9]);
  }
}
// guide boards: leaving the city, and at the foot
{
  const a = along(T0, 140, -(T0.hw + 2.2));
  props.push({ k: 'sign', x: a.x, z: a.z, y: a.y, yaw: a.yaw, text: ['G109 京拉路', '妙峰山 ↑ 12 km', '门头沟 ↑'] });
  const b = along(T0, T0.pts.length * STEP - 160, -(T0.hw + 2.2));
  props.push({ k: 'sign', x: b.x, z: b.z, y: b.y, yaw: b.yaw, text: ['妙峰山 ↑ 9.5 km', '妙峰山景区', '山路弯急 谨慎驾驶'] });
}
// km stones and warning boards up the mountain; a convex mirror on the outside of each tight bend
{
  const L = (M0.pts.length - 1) * STEP;
  for (let s = 0; s < L; s += 1000) { const p = along(M0, s + 10, -(M0.hw + 1.0)); props.push({ k: 'km', x: p.x, z: p.z, y: p.y, yaw: p.yaw, n: Math.round(s / 1000) }); }
  const k = curvature(M0.pts, 4);
  let lastWarn = -1e9, lastMirror = -1e9;
  for (let i = 10; i < k.length - 10; i++) {
    const s = i * STEP;
    if (Math.abs(k[i]) > 1 / 22 && s - lastMirror > 120) {
      lastMirror = s;
      const out = k[i] > 0 ? -1 : 1;                 // the outside of the bend
      const p = along(M0, s, out * (M0.hw + 1.6));
      props.push({ k: 'mirror', x: p.x, z: p.z, y: p.y, yaw: p.yaw + Math.PI });
    }
    if (Math.abs(k[i]) > 1 / 30 && s - lastWarn > 400 && s > 150) {
      lastWarn = s;
      const p = along(M0, s - 90, -(M0.hw + 1.2));
      props.push({ k: 'warn', x: p.x, z: p.z, y: p.y, yaw: p.yaw, left: k[i] > 0 });
    }
  }
}
// the top: paved circle, the gate on the far side, the temple's red wall behind
{
  const r = roads[2], [cx, cz] = r.centre, y = SUMMIT.y;
  props.push({ k: 'plaza', x: cx, z: cz, y, r: 13 });
  const m = roads[1], n = m.pts.length, fx = (cx - m.pts[n - 1][0]) / 17, fz = (cz - m.pts[n - 1][1]) / 17;
  // the 牌楼 across the road 24 m before the circle, facing the way up; the temple beyond the circle
  const g = along(m, (n - 1 - 12) * STEP, 0);
  props.push({ k: 'gate', x: g.x, z: g.z, y: g.y, yaw: g.yaw, text: '妙峰山' });
  const yaw = Math.atan2(fx, fz), tx = cx + fx * 50, tz = cz + fz * 50;
  props.push({ k: 'temple', x: tx, z: tz, y, yaw });
  keepOut.push([cx, cz, 30], [g.x, g.z, 12], [tx, tz, 26]);
  // the top levelled: a plateau round the circle and the temple, easing out over 30 m
  for (const [px, pz, rr] of [[cx, cz, 34], [tx, tz, 24]]) {
    for (let j = Math.max(0, Math.floor((pz - rr - 32 - gz0) / CELL)); j <= Math.min(NZ - 1, Math.ceil((pz + rr + 32 - gz0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((px - rr - 32 - gx0) / CELL)); i <= Math.min(NX - 1, Math.ceil((px + rr + 32 - gx0) / CELL)); i++) {
        const d = Math.hypot(gx0 + i * CELL - px, gz0 + j * CELL - pz), w = 1 - smooth(rr, rr + 30, d);
        if (w > 0) H[j * NX + i] = lerp(H[j * NX + i], y - 0.35, w);
      }
  }
}
// the ground under the props: flattened to their footing
for (const p of props) {
  if (p.k !== 'house' && p.k !== 'station') continue;
  const rr = p.k === 'house' ? 8 : p.k === 'station' ? 20 : p.k === 'temple' ? 22 : p.k === 'plaza' ? 26 : 9;
  const i0 = Math.floor((p.x - rr - 6 - gx0) / CELL), i1 = Math.ceil((p.x + rr + 6 - gx0) / CELL), j0 = Math.floor((p.z - rr - 6 - gz0) / CELL), j1 = Math.ceil((p.z + rr + 6 - gz0) / CELL);
  for (let j = Math.max(0, j0); j <= Math.min(NZ - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(NX - 1, i1); i++) {
    const d = Math.hypot(gx0 + i * CELL - p.x, gz0 + j * CELL - p.z), w = 1 - smooth(rr, rr + 6, d);
    if (w > 0) H[j * NX + i] = lerp(H[j * NX + i], p.y - (p.k === 'plaza' ? 0.3 : 0.05), w);
  }
}

// trees (after the props, which keep them off)
const blocked = (x, z) => keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr);
for (let z = gz0 + 3; z < gz1 - 3; z += 6) for (let x = gx0 + 3; x < gx1 - 3; x += 6) {
  const px = x + (R() - 0.5) * 6, pz = z + (R() - 0.5) * 6;
  // woods in clumps and clearings, not an orchard
  const clump = clamp(fbm(px / 70, pz / 70, 21) * 2.6 - 0.75, 0, 1.6);
  const near = roadsNear(px, pz, 260);
  const d = near.length ? Math.min(...near.map((n) => n[2] - roads[n[0]].hw)) : 999;
  if (d < SHOULDER + 2.5 || d > 255) continue;
  const p = (d < 60 ? 0.27 : d < 140 ? 0.16 : 0.08) * clump;
  if (R() > p || slope(px, pz) > 1.1 || blocked(px, pz)) continue;
  const onMountain = px < demBox[2] + 200 && pz < demBox[3] + 100;
  // 国槐's round crowns stand in for the oaks and smoke trees; a third 侧柏 (whose far cards read pale against the light)
  const type = onMountain ? (R() < 0.3 ? 2 : 0) : R() < 0.55 ? 1 : 0;
  trees.push(Math.round(px * 10) / 10, Math.round(hAt(px, pz) * 10) / 10, Math.round(pz * 10) / 10, type, Math.round((0.75 + R() * 0.55) * 100) / 100);
}
console.log(`trees ${trees.length / 5}, props ${props.length}`);

// ---- preview (--preview out.png): hill-shaded ground, roads, rails, trees, props, 1 px = 2 cells ----------------
if (PREVIEW) {
  const S = 2, W = Math.floor(NX / S), Hh = Math.floor(NZ / S);
  const img = Buffer.alloc(W * Hh * 3);
  const put = (x, z, c, r = 0) => {
    const ci = Math.round((x - gx0) / CELL / S), cj = Math.round((z - gz0) / CELL / S);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const i = ci + a, j = cj + b;
      if (i < 0 || j < 0 || i >= W || j >= Hh) continue;
      img.set(c, (j * W + i) * 3);
    }
  };
  let hmin = Infinity, hmax = -Infinity;
  for (const v of H) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const I = i * S, J = j * S, h = H[J * NX + I];
    const dx = H[J * NX + Math.min(NX - 1, I + 1)] - H[J * NX + Math.max(0, I - 1)], dz = H[Math.min(NZ - 1, J + 1) * NX + I] - H[Math.max(0, J - 1) * NX + I];
    const shade = clamp(0.75 + (-dx + dz) * 0.06, 0.25, 1.2), t = (h - hmin) / (hmax - hmin);
    img.set([clamp(Math.round((90 + 120 * t) * shade), 0, 255), clamp(Math.round((120 + 70 * t) * shade), 0, 255), clamp(Math.round((80 + 60 * t) * shade), 0, 255)], (j * W + i) * 3);
  }
  for (let k = 0; k < trees.length; k += 5) put(trees[k], trees[k + 2], [30, 70, 35]);
  roads.forEach((r) => r.pts.forEach(([x, z]) => put(x, z, [40, 40, 44], 1)));
  for (const [ri, side, a, b] of rails) {
    const r = roads[ri];
    for (let i = a; i <= b; i++) { const p = r.pts[i], q = r.pts[Math.min(r.pts.length - 1, i + 1)], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; put(p[0] + (dz / L) * side * (r.hw + SHOULDER), p[1] - (dx / L) * side * (r.hw + SHOULDER), [235, 235, 235]); }
  }
  for (const p of props) put(p.x, p.z, p.k === 'house' ? [190, 120, 80] : p.k === 'mirror' ? [255, 140, 0] : p.k === 'warn' ? [255, 220, 0] : [220, 40, 40], p.k === 'house' ? 2 : 1);
  await sharp(img, { raw: { width: W, height: Hh, channels: 3 } }).png().toFile(PREVIEW);
  console.log('preview', PREVIEW, W, 'x', Hh, `heights ${hmin.toFixed(0)}..${hmax.toFixed(0)}`);
}

// ---- mountain.bin -------------------------------------------------------------------------------------------------
// gzip( u32 header length | header JSON | pad to 4 | terrain Int16: decimetres, rows by z, each row's first sample as it
// is and the rest as the step from the one before (the ground is smooth: the steps compress) | per road: x, y, z, bank
// Float32 per point | trees: Uint16 x, z (0.1 m from the grid's corner, z in 0.2 m), Int16 y (dm), Uint8 type, scale
// (hundredths) ). src/mountain/Data.ts reads it.
{
  const hdr = {
    v: 1,
    grid: { x0: gx0, z0: gz0, nx: NX, nz: NZ, cell: CELL },
    roads: roads.map((r) => ({ name: r.name, en: r.en, cls: r.cls, hw: r.hw, n: r.pts.length, ring: !!r.ring })),
    rails, props, summit: SUMMIT, foot: FOOT, merge: MERGE, shoulder: SHOULDER, trees: trees.length / 5,
    ring: { x0: RX0, z0: RZ0, nx: RNX, nz: RNZ, cell: RCELL },
  };
  let json = Buffer.from(JSON.stringify(hdr));
  const pad = (4 - ((4 + json.length) % 4)) % 4;
  json = Buffer.concat([json, Buffer.alloc(pad, 32)]);
  const head = Buffer.alloc(4); head.writeUInt32LE(json.length);
  const terrain = new Int16Array(NX * NZ);
  for (let j = 0; j < NZ; j++) { let prev = 0; for (let i = 0; i < NX; i++) { const v = clamp(Math.round(H[j * NX + i] * 10), -32768, 32767); terrain[j * NX + i] = i ? v - prev : v; prev = v; } }
  const parts = [head, json, Buffer.from(terrain.buffer)];
  for (const r of roads) {
    const a = new Float32Array(r.pts.length * 4);
    r.pts.forEach(([x, z], i) => a.set([x, r.h[i], z, r.bank[i]], i * 4));
    parts.push(Buffer.from(a.buffer));
  }
  const nt = trees.length / 5, tx = new Uint16Array(nt * 2), ty = new Int16Array(nt), tk = new Uint8Array(nt * 2);
  for (let k = 0; k < nt; k++) {
    tx[k * 2] = clamp(Math.round((trees[k * 5] - gx0) * 10), 0, 65535); tx[k * 2 + 1] = clamp(Math.round((trees[k * 5 + 2] - gz0) * 5), 0, 65535);
    ty[k] = clamp(Math.round(trees[k * 5 + 1] * 10), -32768, 32767); tk[k * 2] = trees[k * 5 + 3]; tk[k * 2 + 1] = Math.round(trees[k * 5 + 4] * 100);
  }
  parts.push(Buffer.from(tx.buffer), Buffer.from(ty.buffer), Buffer.from(tk.buffer));
  // the far hills: Int16 decimetres, -32768 inside the detailed ground (2-byte aligned after the trees' bytes)
  const ring = new Int16Array(RNX * RNZ);
  for (let k = 0; k < RH.length; k++) ring[k] = Number.isNaN(RH[k]) ? -32768 : clamp(Math.round(RH[k] * 10), -32767, 32767);
  parts.push(Buffer.from(ring.buffer));
  const bin = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
  fs.writeFileSync(path.join(OUT, 'mountain.bin'), bin);
  console.log(`mountain.bin ${(bin.length / 1e6).toFixed(2)} MB (raw ${(Buffer.concat(parts).length / 1e6).toFixed(2)})`);
}

// ---- the network: 阜石路's ends meet 京拉路 at MERGE; 京拉路 to the foot; 妙峰山路 to the turning circle -------------
{
  const file = path.join(OUT, 'network.json');
  const net = JSON.parse(fs.readFileSync(file, 'utf8'));
  // a re-run: take out what the last one added
  if (net.mt) { net.nodes.length = net.mt.node0 * 2; net.sig.length = net.mt.node0; net.edges = net.edges.filter((e) => !e.mt); }
  const node0 = net.nodes.length / 2;
  const nearestNode = ([x, z]) => { let best = -1, bd = 3; for (let i = 0; i < node0; i++) { const d = Math.hypot(net.nodes[2 * i] - x, net.nodes[2 * i + 1] - z); if (d < bd) { bd = d; best = i; } } if (best < 0) throw new Error(`no network node at ${x},${z}`); return best; };
  const wEnd = nearestNode(FUSHI_W_END), eStart = nearestNode(FUSHI_E_START);
  const addNode = ([x, z]) => { net.nodes.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10); net.sig.push(0); return net.nodes.length / 2 - 1; };
  const q = (v) => Math.round(v * 10) / 10;
  const edge = (a, b, pts, hs, extra) => net.edges.push({ a, b, p: pts.flatMap(([x, z]) => [q(x), q(z)]), ...extra, ...(hs && hs.some((v) => Math.abs(v) > 0.05) ? { h: hs.map(q) } : {}), mt: 1 });
  /** Every k-th point and the last. */
  const thin = (pts, k) => pts.filter((_, i) => i % k === 0 || i === pts.length - 1);
  const thinI = (n, k) => Array.from({ length: n }, (_, i) => i).filter((i) => i % k === 0 || i === n - 1);
  const m = addNode(MERGE);
  edge(wEnd, m, [[net.nodes[2 * wEnd], net.nodes[2 * wEnd + 1]], MERGE], null, { c: 'trunk', o: 1, l: 3, w: 10.9, n: '阜石路' });
  edge(m, eStart, [MERGE, [net.nodes[2 * eStart], net.nodes[2 * eStart + 1]]], null, { c: 'trunk', o: 1, l: 3, w: 10.9, n: '阜石路' });
  const [T, Mt, Rg] = roads;
  const foot = addNode(Mt.pts[0]);
  const ti = thinI(T.pts.length, 4);
  edge(m, foot, ti.map((i) => T.pts[i]), ti.map((i) => T.h[i]), { c: T.cls, o: 0, l: 0, w: ROAD_WT, n: T.name });
  const top = addNode(Mt.pts[Mt.pts.length - 1]);
  const mi = thinI(Mt.pts.length, 4);
  edge(foot, top, mi.map((i) => Mt.pts[i]), mi.map((i) => Mt.h[i]), { c: Mt.cls, o: 0, l: 0, w: ROAD_W, n: Mt.name });
  // the ring in three arcs (the first point is where the road meets it)
  const n3 = Math.floor((Rg.pts.length - 1) / 3), r1 = addNode(Rg.pts[n3]), r2 = addNode(Rg.pts[2 * n3]);
  const arc = (a, b) => thin(Rg.pts.slice(a, b + 1), 3);
  edge(top, r1, arc(0, n3), arc(0, n3).map(() => SUMMIT.y), { c: Mt.cls, o: 0, l: 0, w: ROAD_W, n: Mt.name });
  edge(r1, r2, arc(n3, 2 * n3), arc(n3, 2 * n3).map(() => SUMMIT.y), { c: Mt.cls, o: 0, l: 0, w: ROAD_W, n: Mt.name });
  edge(r2, top, arc(2 * n3, Rg.pts.length - 1), arc(2 * n3, Rg.pts.length - 1).map(() => SUMMIT.y), { c: Mt.cls, o: 0, l: 0, w: ROAD_W, n: Mt.name });
  net.mt = { node0 };
  net.en['京拉路'] ??= 'Jingla Lu';
  net.en['妙峰山路'] ??= 'Miaofengshan Lu';
  fs.writeFileSync(file, JSON.stringify(net));
  console.log(`network: +${net.nodes.length / 2 - node0} nodes, +${net.edges.filter((e) => e.mt).length} edges (阜石路 ends ${wEnd}, ${eStart})`);
}
if (!argv.includes('--no-signs')) {
  execFileSync('npx', ['tsx', 'scripts/city/signs.mts'], { stdio: 'inherit', cwd: ROOT });
  execFileSync('npx', ['tsx', 'scripts/city/netpack.mts'], { stdio: 'inherit', cwd: ROOT });
}
