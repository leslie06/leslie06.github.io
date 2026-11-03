// Where the jacket and the jeans are in a cast member's suit texture (2026-11-03, 南锣鼓巷's clothes shop): the same HSV
// boxes cast.json's `look.recolor` gives pack.mjs, drawn as a mask (red = the first rule's pixels, green = the second's)
// that character/hero/Wear.ts recolours the suit by at runtime. The striped shirt is in neither.
//
//   node scripts/characters/suitmask.mjs [id] [texture.png]
//   (default chenye and MakeHuman's male_casualsuit05 diffuse from the MPFB data under .cache/mpfb) -> public/models/characters/<id>.suitmask.png
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const id = process.argv[2] ?? 'chenye';
const look = JSON.parse(fs.readFileSync(path.join(root, 'scripts/characters/cast.json'), 'utf8')).cast.find((c) => c.id === id)?.look;
const rules = (look?.recolor ?? []).filter((r) => /casualsuit/i.test(r.mat));
if (rules.length < 2) throw new Error(`${id}: no jacket and trouser recolour rules in cast.json`);
const src = process.argv[3] ?? path.join(root, '.cache/mpfb/user/extensions/.user/user_default/mpfb/data/clothes/male_casualsuit05/male_casualsuit05_diffuse.png');
const S = 512;

// pack.mjs's own
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx > 0 ? d / mx : 0, mx];
}
function band(x, [a, b], f, wrap = 0) {
  if (wrap) { const m = (a + b) / 2; x = m + ((((x - m) % wrap) + wrap * 1.5) % wrap) - wrap / 2; }
  const d = x < a ? a - x : x > b ? x - b : 0;
  return d >= f ? 0 : 1 - d / f;
}

const { data, info } = await sharp(src).resize(S, S).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(S * S * 3);
let n0 = 0, n1 = 0;
for (let j = 0; j < S * S; j++) {
  const i = j * info.channels, u = (j % S) / S, v = Math.floor(j / S) / S;
  const [h, sa, va] = hsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
  rules.slice(0, 2).forEach((r, k) => {
    if (r.rects && !r.rects.some((q) => q[0] <= u && u < q[2] && q[1] <= v && v < q[3])) return;
    const w = (r.hue ? band(h, r.hue, 12, 360) : 1) * (r.sat ? band(sa, r.sat, 0.06) : 1) * (r.val ? band(va, r.val, 0.06) : 1);
    out[j * 3 + k] = Math.round(w * 255);
    if (w > 0.5) k ? n1++ : n0++;
  });
}
const dst = path.join(root, 'public/models/characters', `${id}.suitmask.png`);
await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png({ compressionLevel: 9, palette: true }).toFile(dst);
console.log(dst, `jacket ${n0} px, trousers ${n1} px`, `${(fs.statSync(dst).size / 1024).toFixed(1)} KB`);
