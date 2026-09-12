// Downloads CC0 assets from Polyhaven (https://polyhaven.com/license) into public/.
// Idempotent: skips files that already exist. Run: npm run assets:fetch
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public');
const API = 'https://api.polyhaven.com';

// PBR texture sets. Resolution 1k keeps the whole set well under 40MB; hero surfaces use 2k.
const TEXTURES = [
  // name, res — city surfaces for DRIVE CITY
  ['asphalt_02', '2k'],             // road surface
  ['asphalt_04', '1k'],             // older side streets
  ['square_brick_paving', '1k'],    // Beijing pavements
  ['patterned_paving', '1k'],       // plazas
  ['granite_tile', '1k'],           // Tiananmen Square
  ['concrete_tiles', '1k'],
  ['brushed_concrete', '1k'],
  ['dark_brick_wall', '1k'],        // hutong grey brick
  ['grey_roof_tiles', '1k'],        // hutong roofs
  ['grey_plaster', '1k'],           // building walls
  ['leafy_grass', '1k'],            // parks
  ['sparse_grass', '1k'],
];
const HDRIS = [];

async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function download(url, dest) {
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return true;
}

const MAP_KEYS = { Diffuse: 'diffuse', nor_gl: 'normal', Rough: 'rough', AO: 'ao', Displacement: 'disp', Metal: 'metal', arm: 'arm' };

async function fetchTexture(name, res) {
  let files;
  try { files = await json(`${API}/files/${name}`); } catch (e) { console.warn('skip', name, e.message); return; }
  const dir = path.join(OUT, 'textures', name);
  const manifest = {};
  for (const [key, out] of Object.entries(MAP_KEYS)) {
    const entry = files[key]?.[res]?.jpg ?? files[key]?.[res]?.png;
    if (!entry) continue;
    const ext = files[key][res].jpg ? 'jpg' : 'png';
    const dest = path.join(dir, `${out}.${ext}`);
    try {
      const fresh = await download(entry.url, dest);
      manifest[out] = `${out}.${ext}`;
      console.log(fresh ? 'got ' : 'have', name, out);
    } catch (e) { console.warn('fail', name, out, e.message); }
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name, res, maps: manifest, license: 'CC0 polyhaven.com' }, null, 2));
}

async function fetchHdri(name, res) {
  let files;
  try { files = await json(`${API}/files/${name}`); } catch (e) { console.warn('skip', name, e.message); return; }
  const entry = files.hdri?.[res]?.hdr;
  if (!entry) { console.warn('no hdr', name, res); return; }
  const dest = path.join(OUT, 'hdri', `${name}_${res}.hdr`);
  try { const fresh = await download(entry.url, dest); console.log(fresh ? 'got ' : 'have', 'hdri', name); }
  catch (e) { console.warn('fail hdri', name, e.message); }
}

const jobs = [...TEXTURES.map(([n, r]) => () => fetchTexture(n, r)), ...HDRIS.map(([n, r]) => () => fetchHdri(n, r))];
let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) await jobs[i++](); }));
console.log('done');
