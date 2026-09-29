// The map's places (「跟高德地图一样」): named stations, parks, hospitals, schools, malls, hotels, sights,
// offices, 小区 and neighbourhoods, from .cache/osm/places.geojsonseq (extract-pbf.mjs) into
// public/city/places.json - each a point, a category, a rank (which zoom it shows from) and its size.
// Usage: node scripts/city/places.mjs (build.mjs runs it at its end when the export is there).
// Data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { placeEn } from './pinyin.mjs';
import { REGIONS, project } from './region.mjs';

const SRC = path.resolve('.cache/osm/places.geojsonseq');
const OUT = path.resolve('public/city/places.json');
/** Category order is the game's (nav/Places.ts `PLACE_CATS`). */
export const CATS = ['metro', 'rail', 'park', 'hospital', 'school', 'mall', 'hotel', 'sight', 'gov', 'office', 'resid', 'area'];
const C = Object.fromEntries(CATS.map((c, i) => [c, i]));

if (!fs.existsSync(SRC)) { console.log('places: no .cache/osm/places.geojsonseq (run extract-pbf.mjs), skipped'); process.exit(0); }

function ringArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function ringCentroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length], c = p[0] * q[1] - q[0] * p[1]; a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c; }
  return Math.abs(a) < 1e-6 ? r[0] : [cx / (3 * a), cz / (3 * a)];
}
const inRegion = (lat, lon) => REGIONS.some((b) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e);

/** Category and rank (0 shows at city zoom ... 3 only at street zoom), or null to leave it out. */
function classify(t, ha) {
  const subway = t.station === 'subway' || t.subway === 'yes' || t.station === 'light_rail';
  const train = t.station === 'train' || t.train === 'yes' || t.railway === 'station' && !subway && !t.station;
  if (t.railway === 'station' || t.railway === 'halt' || t.public_transport === 'station') {
    // Bus terminals (公交场站) are public_transport=station too: not on the map.
    if (t.bus === 'yes' || t.amenity === 'bus_station' || /公交|汽车站|客运/.test(t.name)) return null;
    if (subway) return [C.metro, 1];
    if (train) return [C.rail, 0];
    return null;
  }
  if (t.place) return ['suburb', 'quarter', 'neighbourhood'].includes(t.place) && !/(社区|居委会|村)$/.test(t.name) ? [C.area, t.place === 'neighbourhood' ? 2 : 1] : null;
  if (t.amenity === 'hospital') return [C.hospital, ha > 2 ? 1 : 2];
  if (['university', 'college'].includes(t.amenity)) return [C.school, ha > 10 ? 1 : 2];
  if (t.amenity === 'school') return [C.school, ha > 3 ? 2 : 3];
  if (['townhall', 'embassy'].includes(t.amenity)) return [C.gov, 2];
  if (t.amenity === 'police') return [C.gov, 3];
  if (['theatre', 'cinema', 'library'].includes(t.amenity)) return [C.sight, 2];
  if (t.shop === 'mall' || t.shop === 'department_store') return [C.mall, ha > 2 ? 1 : 2];
  if (t.leisure === 'park' || t.leisure === 'garden') return [C.park, ha > 30 ? 0 : ha > 4 ? 1 : ha > 0.5 ? 2 : 3];
  if (t.leisure === 'stadium' || t.leisure === 'sports_centre') return [C.sight, ha > 3 ? 1 : 2];
  if (['theme_park', 'zoo'].includes(t.tourism)) return [C.sight, ha > 20 ? 0 : 2];
  if (['museum', 'gallery', 'attraction'].includes(t.tourism)) return [C.sight, ha > 5 ? 1 : 2];
  if (t.tourism === 'hotel' || t.building === 'hotel') return [C.hotel, 2];
  if (t.historic) return ha > 0.5 ? [C.sight, 2] : [C.sight, 3];
  if (t.landuse === 'residential') return ha > 0.3 ? [C.resid, 3] : null;
  if (t.office || t.building === 'office' || t.building === 'commercial') return [C.office, ha > 0.8 ? 2 : 3];
  if (t.building === 'retail') return [C.mall, 2];
  return null;
}

const out = [];
for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const f = JSON.parse(line.replace(/^\x1e/, '')), t = f.properties;
  let name = t.name ?? t['name:zh'];
  if (!name) continue;
  let lat, lon, ha = 0;
  const g = f.geometry;
  if (g.type === 'Point') [lon, lat] = g.coordinates;
  else {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let best = null, bestA = 0;
    for (const poly of polys) {
      const ring = poly[0].map(([lo, la]) => project(la, lo)), a = Math.abs(ringArea(ring));
      ha += a / 1e4;
      if (a > bestA) { bestA = a; best = ring; }
    }
    if (!best) continue;
    const [x, z] = ringCentroid(best);
    out.push({ x, z, t, name, ha });
    continue;
  }
  if (!inRegion(lat, lon)) continue;
  const [x, z] = project(lat, lon);
  out.push({ x, z, t, name, ha });
}

const rows = [];
for (const p of out) {
  const cls = classify({ ...p.t, name: p.name }, p.ha);
  if (!cls) continue;
  let [cat, rank] = cls;
  let name = p.name;
  // 建外街道 is 建外 on a map, 东风地区 东风.
  if (cat === C.area) name = name.replace(/(街道|地区|街道办事处)$/, '') || name;
  // Hospitals as people say them: 首都医科大学附属北京朝阳医院 -> 朝阳医院.
  if (cat === C.hospital) {
    const i = name.indexOf('附属');
    if (i >= 0 && name.length - i - 2 >= 4) name = name.slice(i + 2);
    name = name.replace(/^北京(市)?(?!医院|大学)(?=.{4,})/, '');
  }
  // A long name with no Chinese in it (an English-only tag) is not something a map in either language shows.
  if (!/[一-鿿]/.test(name) && name.length > 14) continue;
  // OSM names railway stations as the city (北京, 北京东): the map says 北京站, 北京东站.
  const station = cat === C.rail && !/站$/.test(name);
  if (station) name += '站';
  // OSM's English when it has one; else pinyin, but only for short names (中华人民共和国商务部 in pinyin is
  // unreadable): the game shows the Chinese then.
  const en = p.t['name:en'] && /^[\x20-\x7e]+$/.test(p.t['name:en']) ? p.t['name:en'] : name.length <= 6 ? placeEn(name) : '';
  rows.push({ x: p.x, z: p.z, cat, rank, ha: p.ha, name, en: station && en && !/station/i.test(en) ? `${en} Railway Station` : en });
}
// Inside the play area (a polygon's centroid; points were checked above).
const RECTS = REGIONS.map((b) => { const [x0, z1] = project(b.s, b.w), [x1, z0] = project(b.n, b.e); return [x0, z0, x1, z1]; });
const inside = (x, z) => RECTS.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
// One label per place: a station is a node, a stop area and a building; a hospital its campus and its buildings.
rows.sort((a, b) => a.rank - b.rank || b.ha - a.ha);
const kept = [];
for (const r of rows) {
  if (!inside(r.x, r.z)) continue;
  if (kept.some((k) => k.name === r.name && Math.hypot(k.x - r.x, k.z - r.z) < 500)) continue;
  kept.push(r);
}
const q1 = (v) => Math.round(v * 10) / 10;
const json = JSON.stringify({ v: 1, cats: CATS, p: kept.map((r) => [q1(r.x), q1(r.z), r.cat, r.rank, q1(r.ha), r.name, r.en]) });
fs.writeFileSync(OUT, json);
const count = {};
for (const r of kept) count[CATS[r.cat]] = (count[CATS[r.cat]] ?? 0) + 1;
console.log(`places ${kept.length}`, count, `${(json.length / 1024).toFixed(0)} KB`);
