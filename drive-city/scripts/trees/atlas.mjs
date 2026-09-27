// The street trees' texture atlas (2048 x 1024), from the Blender renders in .scratch/trees:
//   top row      four leaf sprites, 512 x 512 each (国槐, poplar, 侧柏, ginkgo: scripts/blender/trees/leaves.py)
//   bottom row   four impostors, 448 x 512 each (the whole tree seen from the side: trees.py), and at the right
//                a column of four bark swatches, 256 x 128 each, drawn here
// Written as WebP for the game (public/models/trees/foliage.webp), PNG for Blender's own renders.
// Colour is bled into the transparent texels (blurred copies give the local mean), or mip levels grow dark
// fringes round every leaf.  node scripts/trees/atlas.mjs [--no-impostors] [out.webp|out.png]
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = '.scratch/trees', W = 2048, H = 1024;
const noImp = process.argv.includes('--no-impostors');
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'public/models/trees/foliage.webp';
const SPECIES = ['huai', 'poplar', 'cypress', 'ginkgo'];
const BARK = [[95, 88, 78], [185, 184, 171], [106, 86, 71], [107, 99, 86]];

const canvas = Buffer.alloc(W * H * 4);
// The sprigs were rendered under a white sky and sun, and the game lights them again: they come in at 82%.
const put = async (file, x0, y0, w, h, gain = 1) => {
  if (!fs.existsSync(file)) { console.warn('missing', file); return; }
  const { data, info } = await sharp(file).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (gain !== 1) for (let i = 0; i < data.length; i += 4) { data[i] *= gain; data[i + 1] *= gain; data[i + 2] *= gain; }
  for (let y = 0; y < info.height; y++) data.copy(canvas, ((y0 + y) * W + x0) * 4, y * info.width * 4, (y + 1) * info.width * 4);
};
for (let s = 0; s < 4; s++) {
  await put(`${SRC}/leaf_${SPECIES[s]}.png`, 512 * s, 0, 512, 512, 0.82);
  if (!noImp) await put(`${SRC}/imp_${SPECIES[s]}.png`, 448 * s, 512, 448, 512);
}
// bark: vertical streaks and flecks over the species' colour (vertex colour tints the rest)
let seed = 9;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let s = 0; s < 4; s++) {
  const [r, g, b] = BARK[s];
  const streak = Array.from({ length: 256 }, () => 0.85 + rnd() * 0.3);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
    const k = streak[x] * (0.92 + rnd() * 0.16) * (Math.sin((y + x * 0.3) * 0.35 + streak[x] * 20) > 0.85 ? 0.7 : 1);
    const i = ((512 + 128 * s + y) * W + 1792 + x) * 4;
    canvas[i] = Math.min(255, r * k); canvas[i + 1] = Math.min(255, g * k); canvas[i + 2] = Math.min(255, b * k); canvas[i + 3] = 255;
  }
}
// bleed colour into transparent texels
const blur = async (sigma) => sharp(canvas, { raw: { width: W, height: H, channels: 4 } }).blur(sigma).raw().toBuffer();
const b1 = await blur(3), b2 = await blur(20);
for (let i = 0; i < canvas.length; i += 4) {
  const a = canvas[i + 3];
  if (a >= 250) continue;
  const src = b1[i + 3] > 12 ? b1 : b2[i + 3] > 4 ? b2 : null;
  const t = a / 250;
  for (let c = 0; c < 3; c++) {
    const bled = src ? Math.min(255, src[i + c] * 255 / Math.max(1, src[i + 3])) : [70, 100, 50][c];
    canvas[i + c] = Math.round(canvas[i + c] * t + bled * (1 - t));
  }
}
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
const img = sharp(canvas, { raw: { width: W, height: H, channels: 4 } });
await (out.endsWith('.webp') ? img.webp({ quality: 88, alphaQuality: 95, effort: 6 }) : img.png({ compressionLevel: 9 })).toFile(out);
console.log('wrote', out, `${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
