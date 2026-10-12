// Mixamo clips from Blender (scripts/blender/characters/anims.py) -> the game's: one animation per file named after
// it, only rotations plus the hips' translation (Mixamo's other bones never move along themselves; scale never
// changes), resampled (constant and linear runs dropped), meshopt-compressed.
//   node scripts/characters/pack-anims.mjs .scratch/anims/out public/models/anims
import fs from 'node:fs';
import path from 'node:path';
import { meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createIO } from '../landmarks/lib.mjs';

const [, , srcDir, dstDir] = process.argv;
const io = await createIO();
fs.mkdirSync(dstDir, { recursive: true });
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.glb')).sort()) {
  const name = path.basename(f, '.glb');
  const doc = await io.read(path.join(srcDir, f));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    a.setName(name);
    for (const ch of a.listChannels()) {
      const keep = ch.getTargetPath() === 'rotation' || (ch.getTargetPath() === 'translation' && /Hips$/.test(ch.getTargetNode()?.getName() ?? ''));
      if (!keep) { ch.getSampler()?.dispose(); ch.dispose(); }
    }
  }
  await doc.transform(resample({ tolerance: 1e-4 }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(dstDir, `${name}.glb`);
  await io.write(out, doc);
  console.log(`${name}.glb: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${root.listAnimations()[0].listChannels().length} channels`);
}
