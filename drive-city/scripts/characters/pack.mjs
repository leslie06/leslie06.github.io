// A character glb from Blender (scripts/blender/characters/mpfb_char.py) -> the game's: WebP textures (the skin's
// at 1024, the rest at 512: clothes and hair are seen at a few metres), meshopt geometry, dedup and prune.
//   node scripts/characters/pack.mjs in.glb public/models/characters/<id>.glb
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createIO } from '../landmarks/lib.mjs';

const [, , src, dst] = process.argv;
const io = await createIO();
const doc = await io.read(src);
const root = doc.getRoot();
// the skin's textures (the body's material) keep 1024
const skinTex = new Set();
for (const m of root.listMaterials()) if (/body|skin/i.test(m.getName())) for (const t of [m.getBaseColorTexture(), m.getNormalTexture()]) if (t) skinTex.add(t.getName() || t.getURI());
const named = root.listTextures().map((t) => t.getName() || t.getURI());
// Blender exports every MPFB material as BLEND: three.js then sorts them by object and writes no depth, and the teeth
// (red gums) drew over the face. Opaque, but hair, eyebrows and eyelashes alpha-tested; the teeth go (closed mouth).
const CARDS = /short|bob|long|ponytail|braid|afro|eyebrow|eyelash/i;
for (const m of root.listMaterials()) {
  if (CARDS.test(m.getName())) m.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
  else m.setAlphaMode('OPAQUE');
}
for (const n of root.listNodes()) if (/teeth|tongue/i.test(n.getName())) { n.getMesh()?.dispose(); n.dispose(); }
// MakeHuman's 'brown' iris is a red-brown that reads as red eyes at game distances: dark brown, less saturated
for (const m of root.listMaterials()) {
  const t = /low-poly|high-poly|eye(?!brow|lash)/i.test(m.getName()) ? m.getBaseColorTexture() : null;
  if (t?.getImage()) t.setImage(new Uint8Array(await sharp(Buffer.from(t.getImage())).modulate({ saturation: 0.45, brightness: 0.82 }).png().toBuffer())).setMimeType('image/png');
}
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
