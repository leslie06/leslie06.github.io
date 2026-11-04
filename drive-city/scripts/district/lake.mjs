// 什刹海 (前海 · 后海 · 西海) as the city draws it, for district/Houhai.ts (2026-11-04, 后海, docs/gta-plan.md §12.3 第 4 轮):
// the water areas of the tiles round it, each tile's piece its own ring `o` [x, z, ...] in world metres with its islands `hs`. The boats keep inside
// them, and in winter the ice is laid over them.
//   node scripts/district/lake.mjs   (after a city rebuild: the tiles' water may have moved)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const BOX = { x0: -2000, x1: -700, z0: -3900, z1: -2600 };   // 西海 to the south tip of 前海 (荷花市场), not 北海
const rings = [];
for (let ix = -9; ix <= -2; ix++) for (let iz = -16; iz <= -10; iz++) {
  const f = path.join(root, 'public/city', `t_${ix}_${iz}.json`);
  if (!fs.existsSync(f)) continue;
  for (const a of JSON.parse(fs.readFileSync(f, 'utf8')).areas ?? []) {
    if (a.k !== 'water') continue;
    const o = a.o;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) { x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); z0 = Math.min(z0, o[i + 1]); z1 = Math.max(z1, o[i + 1]); }
    if (x1 < BOX.x0 || x0 > BOX.x1 || z1 < BOX.z0 || z0 > BOX.z1) continue;
    const r = (q) => q.map((v) => Math.round(v * 10) / 10);
    rings.push({ o: r(o), hs: (a.hs ?? []).map(r) });
  }
}
const out = path.join(root, 'src/district/houhai.lake.json');
fs.writeFileSync(out, JSON.stringify({ rings }) + '\n');
console.log(out, rings.length, 'rings', rings.reduce((n, r) => n + r.o.length / 2, 0), 'islands', rings.reduce((n, r) => n + r.hs.length, 0), 'points');
