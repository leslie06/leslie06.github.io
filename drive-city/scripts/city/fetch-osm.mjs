// Fetch the OSM data for the playable Beijing area into .cache/osm/, one Overpass request per chunk.
// Idempotent: chunks already on disk are skipped. Data © OpenStreetMap contributors, ODbL.
// Usage: node scripts/city/fetch-osm.mjs
import fs from 'node:fs';
import path from 'node:path';
import { BBOX, CHUNKS } from './region.mjs';

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OUT = path.resolve('.cache/osm');
fs.mkdirSync(OUT, { recursive: true });

function query(s, w, n, e) {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:240];
(
  way["building"]${b}; relation["building"]${b};
  way["building:part"]${b};
  way["highway"]${b};
  way["landuse"]${b}; relation["landuse"]${b};
  way["leisure"]${b}; relation["leisure"]${b};
  way["natural"]${b}; relation["natural"]${b};
  way["waterway"]${b};
  way["amenity"]${b};
  way["railway"]${b};
  way["barrier"="wall"]${b};
  way["man_made"]${b};
  way["area:highway"]${b};
  way["place"="square"]${b}; relation["place"="square"]${b};
  node["natural"="tree"]${b};
  node["highway"~"traffic_signals|crossing|bus_stop|street_lamp"]${b};
);
out geom;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchChunk(i, j, s, w, n, e) {
  const file = path.join(OUT, `chunk-${i}-${j}.json`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) { console.log(`skip ${i},${j}`); return; }
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const t0 = Date.now();
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query(s, w, n, e) }), signal: AbortSignal.timeout(300000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith('{')) throw new Error(`${res.status} ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
      const json = JSON.parse(text);
      if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
      fs.writeFileSync(file, text);
      console.log(`chunk ${i},${j}: ${json.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s via ${new URL(url).host}`);
      return;
    } catch (err) {
      console.warn(`chunk ${i},${j} attempt ${attempt + 1} via ${new URL(url).host} failed: ${String(err.message ?? err).slice(0, 200)}`);
      await sleep(8000 + attempt * 4000);
    }
  }
  throw new Error(`chunk ${i},${j} failed on every mirror`);
}

const { s, w, n, e } = BBOX;
const dLat = (n - s) / CHUNKS, dLon = (e - w) / CHUNKS;
for (let i = 0; i < CHUNKS; i++) for (let j = 0; j < CHUNKS; j++) {
  await fetchChunk(i, j, +(s + i * dLat).toFixed(5), +(w + j * dLon).toFixed(5), +(s + (i + 1) * dLat).toFixed(5), +(w + (j + 1) * dLon).toFixed(5));
  await sleep(3000);
}
console.log('done');
