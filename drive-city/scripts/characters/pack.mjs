// A character glb from Blender (scripts/blender/characters/mpfb_char.py) -> the game's: WebP textures (the skin's
// at 1024, the rest at 512: clothes and hair are seen at a few metres), meshopt geometry, dedup and prune.
//   node scripts/characters/pack.mjs in.glb public/models/characters/<id>.glb
// The character's `look` in scripts/characters/cast.json (by the output's id) is applied to the textures here, so
// one MakeHuman asset dresses several people (see docs/characters.md, 人物标准):
//   skin: {tint, amount, sat, bright}   MakeHuman's asian skins ship the light-skinned diffuse and tint it in its own
//                                       shader; multiplied towards `tint` by `amount`, then saturation and brightness
//   hair, brows: "#hex"                 the card's luminance (normalised to its mean) times the colour: grey hair from
//                                       a dark texture, where a material colour can only darken it
//   recolor: [{mat, hue:[a,b], sat:[a,b], val:[a,b], rects, except, to, keep, contrast}]  pixels of material /mat/ in that HSV box (soft edges)
//                                       take colour `to` times their luminance over the box's mean (the folds stay;
//                                       to the power `contrast`: under 1 evens out faded denim); `rects` / `except`
//                                       ([u0, v0, u1, v1] of the image, v down) limit it to garments of one texture
//   ao: n                               the occlusion mpfb_char.py baked (in.ao.png beside in.glb) multiplied into
//                                       the skin at strength n (default 0.85 when the file is there)
//   lashAlpha: n                        the eyelashes' opacity (default 0.6)
//   detail: n                           a normal map from the skin's own high-passed luminance (pores, wrinkles)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createIO } from '../landmarks/lib.mjs';

const [, , src, dst] = process.argv;
const id = path.basename(dst, '.glb');
const castFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'cast.json');
const look = JSON.parse(fs.readFileSync(castFile, 'utf8')).cast.find((c) => c.id === id)?.look ?? {};
const io = await createIO();
const doc = await io.read(src);
const root = doc.getRoot();
// the skin's textures (the body's material) keep 1024
// materials are named "<id>.<asset>"; match the asset only ("feilong" contains "long", the long hair's name)
function asset(m) { return m.getName().replace(/^[^.]*\./, ''); }
const skinTex = new Set();
for (const m of root.listMaterials()) if (/body|skin/i.test(asset(m))) for (const t of [m.getBaseColorTexture(), m.getNormalTexture()]) if (t) skinTex.add(t.getName() || t.getURI());
const named = root.listTextures().map((t) => t.getName() || t.getURI());
// Blender exports every MPFB material as BLEND: three.js then sorts them by object and writes no depth, and the teeth
// (red gums) drew over the face. Opaque, but hair, eyebrows and eyelashes alpha-tested; the teeth go (closed mouth).
// Brows and lashes lie on the skin and are blended (cut at 0.45 they came out as thin jagged strokes); the hair is
// cut here and given its soft fringe in the game (Hero.ts: a second, blended pass).
const CARDS = /short|bob|long|ponytail|braid|afro/i;
for (const m of root.listMaterials()) {
  if (/eyebrow|eyelash/i.test(asset(m))) m.setAlphaMode('BLEND').setDoubleSided(true);
  else if (CARDS.test(asset(m))) m.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
  else m.setAlphaMode('OPAQUE');
}
for (const n of root.listNodes()) if (/teeth|tongue/i.test(n.getName())) { n.getMesh()?.dispose(); n.dispose(); }
// MakeHuman's 'brown' iris is a red-brown that reads as red eyes at game distances: the iris (saturated) becomes a
// dark brown by its own luminance; the white keeps its brightness, half its pink
for (const m of root.listMaterials()) {
  const t = /low-poly|high-poly|eye(?!brow|lash)/i.test(asset(m)) ? m.getBaseColorTexture() : null;
  if (!t?.getImage()) continue;
  const im = await raw(t), { px } = im, iris = hex('#4a3020');
  for (let i = 0; i < px.length; i += 4) {
    const [, sa] = hsv(px[i], px[i + 1], px[i + 2]), l = lum(px[i], px[i + 1], px[i + 2]);
    const a = Math.min(1, Math.max(0, (sa - 0.3) / 0.2));
    for (let c = 0; c < 3; c++) {
      const white = l + (px[i + c] - l) * 0.5, brown = iris[c] * Math.pow(l / 0.25, 0.8);
      px[i + c] = white + (brown - white) * a;
    }
  }
  await put(t, im);
}
await applyLook(doc, look);
await doc.transform(
  dedup(), prune({ keepLeaves: false }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], pattern: new RegExp(`^(${[...skinTex].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^'})$`) }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], pattern: new RegExp(`^(?!(${[...skinTex].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^'})$).*`) }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
fs.mkdirSync(path.dirname(dst), { recursive: true });
await io.write(dst, doc);
const tris = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`${path.basename(dst)}: ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB, ${tris} triangles, ${root.listTextures().length} textures (${named.length} before), skin ${[...skinTex].join(', ')}`);

// --- the look -----------------------------------------------------------------------------------------------------
function hex(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx > 0 ? d / mx : 0, mx];
}
/** 1 inside [a, b], easing to 0 over `f` outside (hue wraps). */
function band(x, [a, b], f, wrap = 0) {
  if (wrap) { const m = (a + b) / 2; x = m + ((((x - m) % wrap) + wrap * 1.5) % wrap) - wrap / 2; }
  const d = x < a ? a - x : x > b ? x - b : 0;
  return d >= f ? 0 : 1 - d / f;
}
async function raw(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Float32Array(data).map((v) => v / 255), w: info.width, h: info.height };
}
async function put(tex, { px, w, h }) {
  const out = Buffer.alloc(px.length);
  for (let i = 0; i < px.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(px[i] * 255)));
  tex.setImage(new Uint8Array(await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer())).setMimeType('image/png');
}
function texOf(re) { return root.listMaterials().filter((m) => re.test(asset(m))).map((m) => [m, m.getBaseColorTexture()]).filter(([, t]) => t?.getImage()); }

/** Luminance (normalised to the mean of the opaque texels) times a colour. */
async function tintCards(re, to) {
  const c = hex(to);
  for (const [, t] of texOf(re)) {
    const im = await raw(t), { px } = im;
    let s = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0.5) { s += lum(px[i], px[i + 1], px[i + 2]); n++; }
    const mean = s / Math.max(1, n);
    for (let i = 0; i < px.length; i += 4) {
      const k = Math.pow(lum(px[i], px[i + 1], px[i + 2]) / mean, 0.8);
      px[i] = c[0] * k; px[i + 1] = c[1] * k; px[i + 2] = c[2] * k;
    }
    await put(t, im);
  }
}

async function applyLook(doc, look) {
  const done = [];
  if (look.skin) {
    const { tint = '#ffffff', amount = 0, sat = 1, bright = 1 } = look.skin, c = hex(tint);
    for (const [, t] of texOf(/body|skin/i)) {
      const im = await raw(t), { px } = im;
      for (let i = 0; i < px.length; i += 4) {
        let r = px[i] * (1 - amount + amount * c[0]), g = px[i + 1] * (1 - amount + amount * c[1]), b = px[i + 2] * (1 - amount + amount * c[2]);
        const l = lum(r, g, b);
        px[i] = (l + (r - l) * sat) * bright; px[i + 1] = (l + (g - l) * sat) * bright; px[i + 2] = (l + (b - l) * sat) * bright;
      }
      await put(t, im);
    }
    done.push('skin');
  }
  const aoFile = src.replace(/\.glb$/, '.ao.png');
  if (fs.existsSync(aoFile) && look.ao !== 0) {
    const k = look.ao ?? 0.85;
    for (const [, t] of texOf(/body|skin/i)) {
      const im = await raw(t), { px, w, h } = im;
      const ao = await sharp(aoFile).resize(w, h).greyscale().blur(1.5).raw().toBuffer();
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        // soft knee: the darkest creases still show some skin
        const o = 1 - k + k * (0.12 + 0.88 * ao[j] / 255);
        px[i] *= o; px[i + 1] *= o; px[i + 2] *= o;
      }
      await put(t, im);
    }
    done.push(`ao ${k}`);
  }
  if (look.hair) { await tintCards(/short|bob|long|ponytail|braid|afro/i, look.hair); done.push('hair'); }
  if (look.brows) { await tintCards(/eyebrow/i, look.brows); done.push('brows'); }
  // a man's lashes at MakeHuman's full density read as mascara: thinned
  for (const [, t] of texOf(/eyelash/i)) {
    const im = await raw(t), { px } = im, k = look.lashAlpha ?? 0.6;
    for (let i = 3; i < px.length; i += 4) px[i] *= k;
    await put(t, im);
  }
  for (const r of look.recolor ?? []) {
    const c = hex(r.to), keep = r.keep ?? 0;
    for (const [, t] of texOf(new RegExp(r.mat, 'i'))) {
      const im = await raw(t), { px } = im, w = new Float32Array(px.length / 4);
      const at = (j, q) => { const u = (j % im.w) / im.w, v = Math.floor(j / im.w) / im.h; return q[0] <= u && u < q[2] && q[1] <= v && v < q[3]; };
      let s = 0, n = 0;
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        if (r.rects && !r.rects.some((q) => at(j, q))) continue;
        if (r.except?.some((q) => at(j, q))) continue;
        const [h, sa, v] = hsv(px[i], px[i + 1], px[i + 2]);
        w[j] = (r.hue ? band(h, r.hue, 12, 360) : 1) * (r.sat ? band(sa, r.sat, 0.06) : 1) * (r.val ? band(v, r.val, 0.06) : 1);
        if (w[j] > 0.5) { s += lum(px[i], px[i + 1], px[i + 2]); n++; }
      }
      const mean = s / Math.max(1, n);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        if (!w[j]) continue;
        const k = Math.pow(lum(px[i], px[i + 1], px[i + 2]) / mean, r.contrast ?? 1), a = w[j] * (1 - keep);
        for (let ch = 0; ch < 3; ch++) px[i + ch] += (c[ch] * k - px[i + ch]) * a;
      }
      await put(t, im);
      done.push(`recolor ${r.mat} ${n} px`);
    }
  }
  if (look.detail) {
    for (const [m, t] of texOf(/body|skin/i)) {
      if (m.getNormalTexture()) continue;
      // the skin's luminance, high-passed (a 6 px blur off): pores, wrinkles and creases as height
      const S = 1024;
      // one channel: greyscale keeps an alpha channel, interleaved it striped the whole face
      const L = await sharp(Buffer.from(t.getImage())).resize(S, S).removeAlpha().greyscale().toColourspace('b-w').raw().toBuffer();
      if (L.length !== S * S) throw new Error(`detail: ${L.length / (S * S)} channels`);
      const B = await sharp(L, { raw: { width: S, height: S, channels: 1 } }).blur(6).toColourspace('b-w').raw().toBuffer();
      const out = Buffer.alloc(S * S * 3), k = look.detail * 4 / 255;
      const hgt = (x, y) => { x = Math.min(S - 1, Math.max(0, x)); y = Math.min(S - 1, Math.max(0, y)); const i = y * S + x; return L[i] - B[i]; };
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * k, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * k, n = Math.hypot(dx, dy, 1), o = (y * S + x) * 3;
        // glTF normal maps are +Y up in UV space; image rows run down, so dy flips
        out[o] = Math.round((-dx / n * 0.5 + 0.5) * 255); out[o + 1] = Math.round((dy / n * 0.5 + 0.5) * 255); out[o + 2] = Math.round((1 / n * 0.5 + 0.5) * 255);
      }
      const nt = doc.createTexture(`${t.getName()}_detail_normal`).setMimeType('image/png')
        .setImage(new Uint8Array(await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer()));
      m.setNormalTexture(nt);
      skinTex.add(nt.getName());
      done.push('detail normal');
    }
  }
  if (done.length) console.log(`look ${id}: ${done.join(', ')}`);
}
