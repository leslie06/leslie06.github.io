// Cut the playable area out of Geofabrik's Beijing extract into .cache/osm/, in the shape the Overpass
// chunks had (fetch-osm.mjs, `out geom`), so build.mjs reads either. Needs osmium-tool (brew install
// osmium-tool) and data/beijing-latest.osm.pbf
// (https://download.geofabrik.de/asia/china/beijing-latest.osm.pbf). Data © OpenStreetMap contributors, ODbL.
// Usage: node scripts/city/extract-pbf.mjs [file.osm.pbf]
// Each box of REGIONS becomes one file: chunk-0-0.json (the main box), chunk-<tag>0-0.json (corridors).
// Also places.geojsonseq: named stations, parks, hospitals, schools, malls, hotels, 小区, areas and the
// like for the map's labels (places.mjs turns it into public/city/places.json).
// Overpass chunks already in .cache/osm are moved to .cache/osm-overpass/ first.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { BBOX, EXTRA, REGIONS } from './region.mjs';

const PBF = path.resolve(process.argv[2] ?? 'data/beijing-latest.osm.pbf');
const OUT = path.resolve('.cache/osm');
const TMP = path.resolve('.cache/osm-pbf');
if (!fs.existsSync(PBF)) throw new Error(`no ${PBF}: download https://download.geofabrik.de/asia/china/beijing-latest.osm.pbf`);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// fetch-osm.mjs's query, as osmium tags-filter expressions and as predicates for what is output.
const FILTER = [
  'nwr/building', 'w/building:part', 'w/highway', 'wr/landuse', 'wr/leisure', 'nwr/natural', 'w/waterway', 'w/amenity',
  'nwr/tourism', 'nw/attraction', 'w/railway', 'w/barrier=wall', 'w/man_made', 'w/area:highway', 'wr/place=square',
  'n/highway=traffic_signals,crossing,bus_stop,street_lamp',
];
const WAY_KEYS = ['building', 'building:part', 'highway', 'landuse', 'leisure', 'natural', 'waterway', 'amenity', 'tourism', 'attraction', 'railway', 'man_made', 'area:highway'];
const REL_KEYS = ['building', 'landuse', 'leisure', 'natural', 'tourism'];
const wanted = {
  n: (t) => t.tourism != null || t.attraction != null || t.natural === 'tree' || /traffic_signals|crossing|bus_stop|street_lamp/.test(t.highway ?? ''),
  w: (t) => WAY_KEYS.some((k) => t[k] != null) || t.barrier === 'wall' || t.place === 'square',
  r: (t) => REL_KEYS.some((k) => t[k] != null) || t.place === 'square',
};

const osmium = (...args) => execFileSync('osmium', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const stamp = osmium('fileinfo', '-g', 'header.option.osmosis_replication_timestamp', PBF).trim();

// Only the tagged things the build reads (and the nodes and members they reference), once for all boxes.
const filtered = path.join(TMP, 'filtered.osm.pbf');
if (!fs.existsSync(filtered) || fs.statSync(filtered).mtimeMs < fs.statSync(PBF).mtimeMs) {
  console.log('tags-filter ...');
  osmium('tags-filter', PBF, ...FILTER, '-o', filtered, '-O');
}

// OPL escapes anything but plain characters as %<hex codepoint>%.
const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function tagsOf(s) {
  const t = {};
  if (s) for (const kv of s.split(',')) { const i = kv.indexOf('='); t[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1)); }
  return t;
}
const round7 = (v) => Math.round(v * 1e7) / 1e7;

async function convert(tag, box) {
  const cut = path.join(TMP, `${tag || 'main'}.osm.pbf`);
  // smart: ways whole, and multipolygon / building relations with all their members.
  osmium('extract', '-b', `${box.w},${box.s},${box.e},${box.n}`, '-s', 'smart', '-S', 'types=multipolygon,building', filtered, '-o', cut, '-O');
  const coords = new Map(), wayNodes = new Map(), elements = [], relsRaw = [];
  const opl = spawn('osmium', ['cat', cut, '-f', 'opl,add_metadata=false', '-o', '-']);
  const lines = readline.createInterface({ input: opl.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const f = {};
    for (const part of line.split(' ')) f[part[0]] = part.slice(1);
    const kind = line[0], id = Number(line.slice(1, line.indexOf(' ') < 0 ? undefined : line.indexOf(' ')));
    const tags = tagsOf(f.T);
    const has = Object.keys(tags).length > 0;
    if (kind === 'n') {
      const lat = round7(+f.y), lon = round7(+f.x);
      coords.set(id, { lat, lon });
      if (has && wanted.n(tags)) elements.push({ type: 'node', id, lat, lon, tags });
    } else if (kind === 'w') {
      const refs = f.N ? f.N.split(',').map((r) => Number(r.slice(1))) : [];
      wayNodes.set(id, refs);
      if (has && wanted.w(tags)) elements.push({ type: 'way', id, nodes: refs, tags });
    } else if (kind === 'r') {
      if (has && wanted.r(tags)) relsRaw.push({ id, tags, members: f.M ? f.M.split(',') : [] });
    }
  }
  const geom = (refs) => refs.map((r) => coords.get(r)).filter(Boolean);
  let missing = 0;
  for (const e of elements) if (e.type === 'way') {
    e.geometry = geom(e.nodes);
    if (e.geometry.length !== e.nodes.length) missing++;
  }
  for (const r of relsRaw) {
    const members = r.members.map((m) => {
      const at = m.indexOf('@'), type = { n: 'node', w: 'way', r: 'relation' }[m[0]], ref = Number(m.slice(1, at)), role = unesc(m.slice(at + 1));
      if (type === 'node') { const c = coords.get(ref); return c ? { type, ref, role, lat: c.lat, lon: c.lon } : { type, ref, role }; }
      if (type === 'way') { const refs = wayNodes.get(ref); return refs ? { type, ref, role, geometry: geom(refs) } : { type, ref, role }; }
      return { type, ref, role };
    });
    elements.push({ type: 'relation', id: r.id, members, tags: r.tags });
  }
  const file = path.join(OUT, `chunk-${tag}0-0.json`);
  const text = JSON.stringify({ version: 0.6, generator: `osmium extract of ${path.basename(PBF)}`, osm3s: { timestamp_osm_base: stamp }, elements });
  fs.writeFileSync(file, text);
  const count = { node: 0, way: 0, relation: 0 };
  for (const e of elements) count[e.type]++;
  console.log(`${path.basename(file)}: ${count.node} nodes, ${count.way} ways, ${count.relation} relations, ${(text.length / 1e6).toFixed(1)} MB${missing ? `, ${missing} ways cut short` : ''}`);
}

// The Overpass chunks go aside, so the build reads only this extract.
const old = fs.readdirSync(OUT).filter((f) => /^chunk-[a-z]?\d+-\d+\.json$/.test(f));
const head = (f) => { const fd = fs.openSync(path.join(OUT, f), 'r'), b = Buffer.alloc(200); fs.readSync(fd, b, 0, 200, 0); fs.closeSync(fd); return b.toString(); };
if (old.some((f) => !head(f).includes('osmium extract'))) {
  const bak = path.resolve('.cache/osm-overpass');
  fs.mkdirSync(bak, { recursive: true });
  for (const f of old) fs.renameSync(path.join(OUT, f), path.join(bak, f));
  console.log(`moved ${old.length} Overpass chunks to ${bak}`);
} else for (const f of old) fs.rmSync(path.join(OUT, f));

console.log(`${path.basename(PBF)}, data as of ${stamp}`);
await convert('', BBOX);
for (const box of EXTRA) await convert(box.tag, box);
// The map's places: points and areas (osmium assembles the multipolygons), over the regions' box.
const POI = [
  'n/railway=station,halt', 'nwr/public_transport=station',
  'nwr/amenity=hospital,school,university,college,cinema,theatre,library,police,townhall,embassy',
  'nwr/shop=mall,department_store', 'nwr/tourism=hotel,attraction,museum,theme_park,zoo,gallery',
  'wr/leisure=park,stadium,sports_centre,garden', 'nwr/historic', 'n/place=suburb,quarter,neighbourhood',
  'wr/landuse=residential', 'nwr/office', 'wr/building=office,commercial,hotel,retail',
];
const box = [Math.min(...REGIONS.map((r) => r.w)), Math.min(...REGIONS.map((r) => r.s)), Math.max(...REGIONS.map((r) => r.e)), Math.max(...REGIONS.map((r) => r.n))];
const poi = path.join(TMP, 'poi.osm.pbf'), poiBox = path.join(TMP, 'poi-box.osm.pbf');
osmium('tags-filter', PBF, ...POI, '-o', poi, '-O');
osmium('extract', '-b', box.join(','), '-s', 'smart', poi, '-o', poiBox, '-O');
osmium('export', poiBox, '-f', 'geojsonseq', '--geometry-types=point,polygon', '-o', path.join(OUT, 'places.geojsonseq'), '-O');
console.log('places.geojsonseq written');
console.log('done');
