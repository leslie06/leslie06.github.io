// Import a landmark exported from Blender (glTF 2.0 .glb) into the game.
//
//   node scripts/landmarks/import.mjs model.glb --id drumtower --zh 鼓楼 --en "Drum Tower" --lat 39.9405 --lon 116.3902 [--heading 0]
//   node scripts/landmarks/import.mjs model.glb --id drumtower --at 120,-4400      (game metres instead of lat/lon)
//   node scripts/landmarks/import.mjs model.glb --id drumtower                     (re-import: keeps name and place)
//   options: --heading <deg clockwise from north>  --far <m, far-LOD distance, default 800>  --tex <max texture px, default 2048>  --dry (inspect only)
//
// Writes public/models/landmarks/<id>.glb (meshopt, webp textures) and src/city/landmarks/glb/<id>.meta.json,
// which landmarks/index.ts picks up by itself. Naming rules for Blender: src/city/landmarks/glb/Glb.ts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createIO, inspect, optimize } from './lib.mjs';
import { project, unproject } from '../../src/city/Geo.ts';

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const usage = () => { console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(1); };
if (!file || !fs.existsSync(file)) usage();
const id = opt('id');
if (!id || !/^[a-z][a-z0-9_-]*$/.test(id)) { console.error('--id: lower-case letters, digits, - and _ (it names the files)'); usage(); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const metaPath = path.join(ROOT, 'src/city/landmarks/glb', `${id}.meta.json`);
const glbPath = path.join(ROOT, 'public/models/landmarks', `${id}.glb`);
const old = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;

// a hand-built landmark with the same id would be registered twice
if (!old) {
  const taken = new Set();
  for (const dir of ['src/city/landmarks', 'src/home', 'src/park']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.ts')) continue;
      for (const m of fs.readFileSync(path.join(ROOT, dir, f), 'utf8').matchAll(/\bid: '([^']+)'/g)) taken.add(m[1]);
    }
  }
  if (taken.has(id)) { console.error(`id "${id}" is already a landmark in the code`); process.exit(1); }
}

let lat = opt('lat') !== undefined ? Number(opt('lat')) : old?.lat;
let lon = opt('lon') !== undefined ? Number(opt('lon')) : old?.lon;
if (opt('at')) { const [x, z] = opt('at').split(',').map(Number); ({ lat, lon } = unproject(x, z)); }
const headingDeg = opt('heading') !== undefined ? Number(opt('heading')) : (old?.headingDeg ?? 0);
const name = { zh: opt('zh') ?? old?.name.zh ?? id, en: opt('en') ?? old?.name.en ?? id };
const dry = argv.includes('--dry');
if (!dry && (!Number.isFinite(lat) || !Number.isFinite(lon))) { console.error('where does it stand? --lat/--lon or --at x,z (first import)'); process.exit(1); }
if (!Number.isFinite(headingDeg)) { console.error('--heading must be a number'); process.exit(1); }

const io = await createIO();
const doc = await io.read(file);
const info = inspect(doc);

console.log(`\n${name.zh} / ${name.en}  (${id})`);
const s = info.stats;
console.log(`  近景 ${s.triangles} 三角形，${s.materials} 种材质（合并后约 ${s.materials} 个 draw call）`);
console.log(`  远景 ${s.farTriangles ? `${s.farTriangles} 三角形，${s.farMaterials} 种材质` : '无（复用近景）'}`);
console.log(`  碰撞体 COL_ ${s.colliders.solid}，WALK_ ${s.colliders.walk}，COLMESH_ ${s.colliders.mesh}；实例化网格 ${s.instancedMeshes} 个`);
console.log(`  高 ${info.height} m，占地 ${s.footprintArea} m²（${info.footprint.length} 点），清空区 ${info.clear.length} 个；贴图 ${s.textures} 张，最大 ${s.maxTexture}px`);
if (Number.isFinite(lat)) { const [x, z] = project(lat, lon); console.log(`  位置 ${lat.toFixed(6)}, ${lon.toFixed(6)} = 游戏坐标 (${x.toFixed(1)}, ${z.toFixed(1)})，朝向 ${headingDeg}°`); }
for (const n of info.notes) console.log(`  · ${n}`);
for (const w of info.warnings) console.log(`  ⚠ ${w}`);
if (dry) process.exit(0);

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.log('  · sharp 不可用：贴图原样保留'); }
await optimize(doc, { maxTexture: Number(opt('tex') ?? 2048), sharp });
const bytes = await io.writeBinary(doc);
fs.mkdirSync(path.dirname(glbPath), { recursive: true });
fs.writeFileSync(glbPath, bytes);
const meta = {
  id, name, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), headingDeg,
  file: `${id}.glb`, version: crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8),
  footprint: info.footprint, ...(info.clear.length ? { clear: info.clear } : {}), height: info.height,
  ...(opt('far') ? { farDistance: Number(opt('far')) } : old?.farDistance ? { farDistance: old.farDistance } : {}),
  stats: { ...info.stats, bytes: bytes.length, source: path.basename(file) },
};
// number arrays on one line: a footprint point per line, not three
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2).replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, '[$1, $2]') + '\n');
console.log(`\n  ${(fs.statSync(file).size / 1024).toFixed(0)} KB -> ${(bytes.length / 1024).toFixed(0)} KB  ${path.relative(ROOT, glbPath)}`);
console.log(`  ${path.relative(ROOT, metaPath)}`);
console.log(`  预览：http://127.0.0.1:5195/landmarks.html?id=${id}   游戏里：?glb=0 可对比关掉它\n`);
