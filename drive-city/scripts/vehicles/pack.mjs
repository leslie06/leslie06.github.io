// Pack vehicle models (the JSON scripts/vehicles/import.mjs writes: per group, per material, integer positions in mm,
// normals in hundredths, indices, UVs in 1/4096ths) into one meshopt-compressed binary the game fetches
// (vehicle/Bodies.ts `readyBodies` -> Mesher.ts `unpackModel`): 40% smaller than the JSON gzipped.
//   node scripts/vehicles/pack.mjs src/vehicle/models/sedan.json public/models/vehicles/sedan.bin
// Layout: uint32 header length, the header (JSON: [[group, material, vertices, indices, hasUv, vertexBytes, indexBytes]...]),
// padded to 4, then each part's encoded vertex buffer (stride 16: int16 x3 mm, pad, int8 x3 normal * 127, pad, uint16 x2 uv)
// and index buffer (uint32), each padded to 4.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
await MeshoptEncoder.ready;
const model = JSON.parse(fs.readFileSync(input, 'utf8'));
const header = [], chunks = [];
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
for (const [g, mats] of Object.entries(model)) for (const [m, S] of Object.entries(mats)) {
  const nv = S.p.length / 3, buf = new ArrayBuffer(nv * 16), dv = new DataView(buf);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) dv.setInt16(v * 16 + k * 2, S.p[v * 3 + k], true);
    for (let k = 0; k < 3; k++) dv.setInt8(v * 16 + 8 + k, Math.max(-127, Math.min(127, Math.round(S.n[v * 3 + k] * 1.27))));
    if (S.t) { dv.setUint16(v * 16 + 12, S.t[v * 2], true); dv.setUint16(v * 16 + 14, S.t[v * 2 + 1], true); }
  }
  const vb = Buffer.from(MeshoptEncoder.encodeVertexBuffer(new Uint8Array(buf), nv, 16));
  const idx = new Uint32Array(S.i);
  const ib = Buffer.from(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(idx.buffer), idx.length, 4));
  header.push([g, m, nv, idx.length, S.t ? 1 : 0, vb.length, ib.length]);
  chunks.push(pad4(vb), pad4(ib));
}
const h = pad4(Buffer.from(JSON.stringify(header)));
const len = Buffer.alloc(4);
len.writeUInt32LE(h.length);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([len, h, ...chunks]));
console.log(`${output}: ${(fs.statSync(output).size / 1024).toFixed(0)} KB (json ${(fs.statSync(input).size / 1024).toFixed(0)} KB)`);
