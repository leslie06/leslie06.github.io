// The Forbidden City's four corner towers share one model (scripts/blender/landmarks/gugong_jiaolou.py, built as the
// south-east one with its battlements on the east and south): this writes the other three corners' metas from the
// south-east one's, the same glb turned by quarter turns so the battlements face out. Run after exporting it.
//   npx tsx scripts/landmarks/corners.mjs
import fs from 'node:fs';
import { unproject } from '../../src/city/Geo.ts';

const dir = new URL('../../src/city/landmarks/glb/', import.meta.url);
const base = JSON.parse(fs.readFileSync(new URL('gugongjiaolou.meta.json', dir), 'utf8'));
// the platform centres (OSM ways 156145604, 156146621, 156145763), and the extra quarter turns (anticlockwise seen
// from above) that bring the south-east tower's outer faces (east, south) round to each corner's
const CORNERS = [
  { id: 'gugongjiaolou_ne', zh: '故宫东北角楼', en: 'Forbidden City Northeast Corner Tower', x: -235.4, z: -1361.45, turns: 1 },
  { id: 'gugongjiaolou_nw', zh: '故宫西北角楼', en: 'Forbidden City Northwest Corner Tower', x: -956.1, z: -1326.8, turns: 2 },
  { id: 'gugongjiaolou_sw', zh: '故宫西南角楼', en: 'Forbidden City Southwest Corner Tower', x: -922.75, z: -391.0, turns: 3 },
];
for (const c of CORNERS) {
  const { lat, lon } = unproject(c.x, c.z);
  let heading = base.headingDeg - 90 * c.turns;
  heading = ((heading + 180) % 360 + 360) % 360 - 180;
  const meta = { ...base, id: c.id, name: { zh: c.zh, en: c.en }, lat: +lat.toFixed(7), lon: +lon.toFixed(7), headingDeg: +heading.toFixed(2) };
  fs.writeFileSync(new URL(`${c.id}.meta.json`, dir), JSON.stringify(meta, null, 2) + '\n');
  console.log(c.id, meta.lat, meta.lon, meta.headingDeg);
}
