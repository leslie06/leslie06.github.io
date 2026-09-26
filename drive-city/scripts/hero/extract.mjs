// Copies the player's model out of Quaternius' "Universal Base Characters [Standard]" (CC0,
// https://quaternius.itch.io/universal-base-characters) into public/models/hero/, with the 2048
// textures cut down to what a third-person camera can use (macOS `sips`).
// Usage: node scripts/hero/extract.mjs "<unzipped>/Universal Base Characters[Standard]"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'Base Characters'))) { console.error('usage: node scripts/hero/extract.mjs "<pack>/Universal Base Characters[Standard]"'); process.exit(1); }
const out = path.resolve('public/models/hero');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const tex = path.join(src, 'Base Characters/Textures');
const hair = path.join(src, 'Hairstyles/Origin at 0/glTF (Godot)');

/** [source png, published name, longest side, format] */
const IMAGES = [
  ['T_Superhero_Male_Ligh.png', 'body.jpg', 1024, 'jpeg'],
  ['T_Superhero_Male_Normal.png', 'body_n.png', 1024, 'png'],
  ['T_Superhero_Male_Roughness.png', 'body_r.jpg', 512, 'jpeg'],
  ['T_Eye_Brown.png', 'eye.jpg', 256, 'jpeg'],
  ['T_Hair_1_BaseColor.png', 'hair.jpg', 512, 'jpeg'],
  ['T_Hair_1_Normal.png', 'hair_n.png', 512, 'png'],
];
for (const [from, to, size, fmt] of IMAGES) {
  execFileSync('sips', ['-s', 'format', fmt, ...(fmt === 'jpeg' ? ['-s', 'formatOptions', '88'] : []), '-Z', String(size), path.join(tex, from), '--out', path.join(out, to)], { stdio: 'ignore' });
}
const RENAME = {
  'T_Hair_1_Normal_png.png': 'hair_n.png', 'T_Hair_1_Normal.png': 'hair_n.png', 'T_Hair_1_BaseColor.png': 'hair.jpg',
  'T_Eye_Normal_png.png': null, 'T_Eye_Brown.png': 'eye.jpg',
  'T_Superhero_Male_Normal.png': 'body_n.png', 'T_Superhero_Male_Dark.png': 'body.jpg', 'T_Superhero_Male_Roughness.png': 'body_r.jpg',
};

/** Copy a glTF and its buffer, pointing its images at the published textures (null: dropped). */
function gltf(from, to) {
  const g = JSON.parse(fs.readFileSync(from, 'utf8'));
  const bin = g.buffers[0].uri;
  fs.copyFileSync(path.join(path.dirname(from), bin), path.join(out, `${to}.bin`));
  g.buffers[0].uri = `${to}.bin`;
  const drop = new Set();
  g.images?.forEach((im, i) => { const n = RENAME[im.uri]; if (n === undefined) throw new Error(`unknown image ${im.uri}`); if (n === null) drop.add(i); else im.uri = n; });
  if (drop.size) {
    // Materials referencing a dropped image's texture lose that slot.
    const deadTex = new Set(g.textures.map((t, i) => (drop.has(t.source) ? i : -1)).filter((i) => i >= 0));
    for (const m of g.materials) if (m.normalTexture && deadTex.has(m.normalTexture.index)) delete m.normalTexture;
  }
  fs.writeFileSync(path.join(out, `${to}.gltf`), JSON.stringify(g));
}
gltf(path.join(src, 'Base Characters/Godot - UE/Superhero_Male_FullBody.gltf'), 'body');
gltf(path.join(hair, 'Hair_SimpleParted.gltf'), 'hair');
fs.writeFileSync(path.join(out, 'LICENSE.txt'), 'Universal Base Characters by Quaternius (https://quaternius.com), CC0 1.0 Universal.\nTextures resized by scripts/hero/extract.mjs.\n');
let bytes = 0;
for (const f of fs.readdirSync(out)) bytes += fs.statSync(path.join(out, f)).size;
console.log(`public/models/hero: ${fs.readdirSync(out).length} files, ${(bytes / 1e6).toFixed(2)} MB`);
