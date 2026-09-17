// Turns the Polyhaven originals in assets-src/textures/<set>/ into what the game actually ships:
//   public/textures/<set>/<map>_<res>.webp   one file per map per resolution (2048 / 1024 / 512)
//   public/textures/index.json               every set, map, resolution and its byte size
//
// Why: the originals are near-lossless JPEGs (~600 KB per 1k map, 125 MB for the level) and every
// quality tier used to download all of them and then downscale in the browser. WebP at these
// settings is visually identical under PBR shading at a fifth of the size, and because each tier's
// resolution exists as a file, `low` (512) downloads a twentieth of what it did. The index replaces
// the 34 per-set manifest fetches with one, and its byte sizes are what the loading bar counts.
//
// Idempotent: a variant newer than its source is skipped. Run: npm run assets:optimize
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('assets-src/textures');
const OUT = path.resolve('public/textures');
const SIZES = [2048, 1024, 512];
// Normal maps get the most bits: block artefacts there turn into visible facets under a grazing sun.
const QUALITY = { diffuse: 82, normal: 90, rough: 80, ao: 78, metal: 80, disp: 84 };
const MAPS = Object.keys(QUALITY);

if (!fs.existsSync(SRC)) { console.error(`no ${SRC} - run "npm run assets:fetch" first`); process.exit(1); }

const index = { version: 1, sets: {} };
let made = 0, kept = 0, bytesIn = 0;
const sets = fs.readdirSync(SRC).filter((d) => fs.statSync(path.join(SRC, d)).isDirectory()).sort();

for (const set of sets) {
  const maps = {};
  for (const map of MAPS) {
    const src = ['jpg', 'png'].map((e) => path.join(SRC, set, `${map}.${e}`)).find((f) => fs.existsSync(f));
    if (!src) continue;
    const srcStat = fs.statSync(src);
    bytesIn += srcStat.size;
    const meta = await sharp(src).metadata();
    const native = Math.max(meta.width ?? 0, meta.height ?? 0);
    const variants = {};
    for (const size of SIZES) {
      if (size > native) continue; // never upscale: a 1k set simply has no 2048 variant
      const dest = path.join(OUT, set, `${map}_${size}.webp`);
      if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < srcStat.mtimeMs) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        let img = sharp(src);
        if (size < native) img = img.resize(size, size, { fit: 'inside', kernel: 'lanczos3' });
        // Data maps are single-channel in spirit; dropping chroma costs nothing and saves ~15%.
        if (map !== 'diffuse' && map !== 'normal') img = img.grayscale();
        await img.webp({ quality: QUALITY[map], effort: 6, smartSubsample: map === 'normal' }).toFile(dest);
        made++;
      } else kept++;
      variants[size] = fs.statSync(dest).size;
    }
    if (Object.keys(variants).length) maps[map] = variants;
  }
  if (Object.keys(maps).length) index.sets[set] = { maps };
}

// Drop outputs whose source is gone (a set removed from fetch-assets, or the pre-WebP jpgs).
for (const set of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
  const dir = path.join(OUT, set);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\w+)_(\d+)\.webp$/.exec(f);
    if (!m || index.sets[set]?.maps[m[1]]?.[m[2]] === undefined) fs.rmSync(path.join(dir, f));
  }
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

const perTier = Object.fromEntries(SIZES.map((cap) => [cap, 0]));
for (const { maps } of Object.values(index.sets)) for (const [map, v] of Object.entries(maps)) {
  if (map === 'disp') continue; // only a few materials ask for displacement
  for (const cap of SIZES) {
    const fit = Object.keys(v).map(Number).filter((s) => s <= cap);
    perTier[cap] += v[fit.length ? Math.max(...fit) : Math.min(...Object.keys(v).map(Number))];
  }
}
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`${sets.length} sets: ${made} encoded, ${kept} up to date. originals ${mb(bytesIn)}`);
console.log(`download per texture cap (without disp): ${SIZES.map((s) => `${s} -> ${mb(perTier[s])}`).join(', ')}`);
