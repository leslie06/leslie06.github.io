// A vehicle body part modelled in Blender (scripts/blender/vehicles/*.py) into the game: reads the glb,
// applies each node's world matrix, turns glTF's frame (x right, y up, z back: Blender's export of +X right,
// +Y forward, +Z up) into the body frame (+X left, +Y up, +Z forward) and merges the triangles per material
// name - the surface TwoWheelers.ts maps it to - into compact JSON: positions in whole millimetres, normals in
// hundredths, indices (all integers). It is imported statically, so building a body stays synchronous and Node-safe.
//
//   node scripts/vehicles/import.mjs .scratch/blender/moto.glb src/vehicle/models/moto.json
// With --group, objects named "<group>__<anything>" land under out[group][material] (the trees: one group per
// species and level). UVs, when a primitive has them, are kept as `t` in 1/4096ths, glTF-style (v down from the top).
// --simplify hi=0.5,lo=0.8 thins a group's larger surfaces with meshoptimizer, each on its own with its borders locked
// (the edges where one material meets another, sharp edges and UV seams), so a colour split or a glass edge stays put.
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [input, output] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const GROUP = process.argv.includes('--group');
if (!input || !output) { console.error('usage: node scripts/vehicles/import.mjs in.glb out.json'); process.exit(1); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const out = {};
let tris = 0;
const mul = (m, x, y, z, w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  // normals by the inverse transpose of the upper 3x3 (uniform scale here: the matrix itself, renormalised)
  const flip = (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])) < 0;
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? 'black';
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
    const idx = prim.getIndices();
    const bucket = GROUP ? (out[node.getName().split('__')[0]] ??= {}) : out;
    const S = (bucket[name] ??= { p: [], n: [], i: [] });
    const uv = prim.getAttribute('TEXCOORD_0');
    if (uv) S.t ??= [];
    const base = S.p.length / 3;
    const a = [], b = [];
    for (let i = 0; i < pos.getCount(); i++) {
      const p = mul(m, ...pos.getElement(i, a), 1);
      const q = nor ? mul(m, ...nor.getElement(i, b), 0) : [0, 1, 0];
      const l = Math.hypot(...q) || 1;
      // glTF (x, y, z) -> body (-x, y, -z)
      S.p.push(Math.round(-p[0] * 1e3), Math.round(p[1] * 1e3), Math.round(-p[2] * 1e3));
      S.n.push(Math.round(-q[0] / l * 100), Math.round(q[1] / l * 100), Math.round(-q[2] / l * 100));
      if (uv && S.t) { const t = uv.getElement(i, []); S.t.push(Math.round(t[0] * 4096), Math.round(t[1] * 4096)); }
    }
    const ix = idx ? idx.getArray() : Array.from({ length: pos.getCount() }, (_, i) => i);
    for (let i = 0; i < ix.length; i += 3) {
      // (x, z) -> (-x, -z) is a rotation, so the winding holds unless the node's own matrix mirrors
      if (flip) S.i.push(base + ix[i], base + ix[i + 2], base + ix[i + 1]);
      else S.i.push(base + ix[i], base + ix[i + 1], base + ix[i + 2]);
      tris++;
    }
  }
}
const si = process.argv.indexOf('--simplify');
if (si > 0) {
  await MeshoptSimplifier.ready;
  const want = Object.fromEntries(process.argv[si + 1].split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, +v]));
  for (const [g, ratio] of Object.entries(want)) {
    for (const [name, S] of Object.entries(out[g] ?? {})) {
      const nt = S.i.length / 3;
      if (nt < 400) continue;
      const nv = S.p.length / 3;
      const pos = Float32Array.from(S.p, (v) => v / 1000), nor = Float32Array.from(S.n, (v) => v / 100);
      const [idx] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(S.i), pos, 3, nor, 3, [0.6, 0.6, 0.6], null, Math.floor(nt * ratio) * 3, 0.0025, ['LockBorder']);
      // keep only the vertices still used
      const map = new Int32Array(nv).fill(-1), p = [], n = [], t = S.t ? [] : null, i = [];
      for (const v of idx) {
        if (map[v] < 0) {
          map[v] = p.length / 3;
          p.push(S.p[v * 3], S.p[v * 3 + 1], S.p[v * 3 + 2]); n.push(S.n[v * 3], S.n[v * 3 + 1], S.n[v * 3 + 2]);
          if (t) t.push(S.t[v * 2], S.t[v * 2 + 1]);
        }
        i.push(map[v]);
      }
      tris -= nt - i.length / 3;
      Object.assign(S, { p, n, i }, t ? { t } : {});
    }
  }
}
fs.mkdirSync(new URL('.', `file://${process.cwd()}/${output}`).pathname, { recursive: true });
fs.writeFileSync(output, JSON.stringify(out));
const list = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v.i ? [`${pre}${k} ${v.i.length / 3}`] : list(v, `${k}/`)));
console.log(`${output}: ${tris} triangles (${list(out).join(', ')}), ${(fs.statSync(output).size / 1024).toFixed(0)} KB`);
