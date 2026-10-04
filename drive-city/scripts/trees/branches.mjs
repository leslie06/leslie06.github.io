// Low branches to hang things from (life/'s bird cages): for each species and variant of the Blender street trees
// (public/models/trees/trees.json, the near level's bark), the lowest point of the bark in each of eight sectors
// round the trunk, 0.9-2.6 m out from its axis and 2-6.5 m up - a branch's underside a cord can be tied to.
// Model space, metres (the game turns and scales each tree: city/Streamer.ts treeMatrices).
//   node scripts/trees/branches.mjs  -> src/life/branches.json
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('public/models/trees/trees.json', 'utf8'));
const out = {};
for (const sp of ['huai', 'poplar', 'cypress', 'ginkgo']) {
  out[sp] = [];
  for (let v = 0; v < 3; v++) {
    const bark = T[`${sp}_near_v${v}`]?.bark;
    const best = new Array(8).fill(null);
    if (bark) for (let i = 0; i < bark.p.length; i += 3) {
      const x = bark.p[i] / 1000, y = bark.p[i + 1] / 1000, z = bark.p[i + 2] / 1000, r = Math.hypot(x, z);
      if (r < 0.9 || r > 2.6 || y < 2.0 || y > 6.5) continue;
      const k = Math.floor(((Math.atan2(x, z) + Math.PI) / (2 * Math.PI)) * 8) % 8;
      if (!best[k] || y < best[k][1]) best[k] = [x, y, z];
    }
    out[sp].push(best.filter(Boolean).map((p) => p.map((c) => Math.round(c * 100) / 100)));
  }
}
fs.writeFileSync('src/life/branches.json', JSON.stringify(out));
for (const [sp, vs] of Object.entries(out)) console.log(sp, vs.map((l) => l.length).join('/'), JSON.stringify(vs[0]));
