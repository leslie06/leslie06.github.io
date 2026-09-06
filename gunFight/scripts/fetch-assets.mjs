// Downloads CC0 assets from Polyhaven (https://polyhaven.com/license) into public/.
// Idempotent: skips files that already exist. Run: npm run assets:fetch
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public');
const API = 'https://api.polyhaven.com';

// PBR texture sets. Resolution 1k keeps the whole set well under 40MB; hero surfaces use 2k.
const TEXTURES = [
  // name, res
  ['concrete_wall_008', '2k'],       // bare concrete, bullet-friendly
  ['concrete_floor_worn_001', '2k'],
  ['plastered_wall_04', '1k'],
  ['brick_wall_006', '2k'],
  ['red_brick_03', '1k'],
  ['asphalt_02', '2k'],
  ['asphalt_04', '1k'],
  ['cobblestone_floor_08', '1k'],
  ['metal_plate', '1k'],
  ['corrugated_iron_02', '1k'],
  ['rusty_metal_02', '1k'],
  ['metal_grate_rusty', '1k'],
  ['painted_metal_shutter', '1k'],
  ['sandbag', '1k'],
  ['rubble', '1k'],
  ['dirt_floor', '1k'],
  ['broken_wall', '1k'],
  ['painted_concrete', '1k'],
  ['weathered_planks', '1k'],
  ['wood_planks_grey', '1k'],
  ['dirty_concrete', '1k'],
  ['rock_wall_10', '1k'],
  ['fabric_pattern_07', '1k'],
  ['leather_red_02', '1k'],
  ['metal_scratched', '1k'],
  ['blue_metal_plate', '1k'],
  ['dark_brick_wall', '1k'],
  ['rusty_metal_grid', '1k'],
  // world/ additions: war-torn urban set
  ['damaged_plaster', '2k'],        // plaster with exposed brick
  ['rough_plaster_broken', '1k'],
  ['red_brick_plaster_patch_02', '1k'],
  ['road_damaged', '2k'],
  ['worn_asphalt', '1k'],
  ['concrete_debris', '1k'],
  ['damaged_concrete_floor', '1k'],
  ['concrete_block_wall_02', '1k'],
  ['rusty_metal_sheet', '1k'],
  ['rusty_corrugated_iron', '1k'],
  ['rusty_painted_metal', '1k'],
  ['wood_planks_dirt', '1k'],
  ['yellow_plaster', '1k'],
  ['peeling_painted_wall', '1k'],
  ['hessian_230', '1k'],            // sandbags
  ['sand_01', '1k'],
  // world/ round-2 additions: interiors, ground decals, wreck metal
  ['painted_plaster_wall', '1k'],   // desaturated interior plaster
  ['grey_plaster', '1k'],
  ['gravel_concrete', '1k'],        // gravel/dust ground decal
  ['gravel_floor', '1k'],
  ['rust_coarse_01', '1k'],         // burnt / rusted vehicle panels
  ['concrete_layers_02', '1k'],
];
const HDRIS = [
  ['kloofendal_48d_partly_cloudy_puresky', '2k'],
  ['kloppenheim_06_puresky', '2k'],
  ['drackenstein_quarry_puresky', '2k'],
  ['industrial_sunset_puresky', '2k'],
  ['moonless_golf', '1k'],
];

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
