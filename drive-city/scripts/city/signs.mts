// Guide signs (src/city/Signs.ts) placed once from the built network and written to public/city/signs.json,
// so the game does not spend the placement (~0.1 s, more on a phone) at boot. Run by build.mjs at its end;
// by hand: npx tsx scripts/city/signs.mts
import fs from 'node:fs';
import path from 'node:path';
import type { Manifest, Network } from '../../src/city/Data';
import { LaneGraph } from '../../src/traffic/LaneGraph';
import { placeSigns } from '../../src/city/Signs';

const DIR = path.resolve('public/city');
const net = JSON.parse(fs.readFileSync(path.join(DIR, 'network.json'), 'utf8')) as Network;
const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as Manifest;
const t0 = performance.now();
const { signs, closures } = placeSigns(new LaneGraph(net), net, man.regions);
const r2 = (v: number) => Math.round(v * 100) / 100;
const out = JSON.stringify({
  signs: signs.map((s) => ({ ...s, x: r2(s.x), z: r2(s.z), y: r2(s.y), yaw: +s.yaw.toFixed(4), reach: r2(s.reach), s: r2(s.s) })),
  closures: closures.map((c) => ({ x: r2(c.x), z: r2(c.z), y: r2(c.y), yaw: +c.yaw.toFixed(4), width: r2(c.width) })),
});
fs.writeFileSync(path.join(DIR, 'signs.json'), out);
console.log(`signs ${signs.length} (${['cross', 'exit', 'ahead'].map((k) => `${k} ${signs.filter((s) => s.kind === k).length}`).join(', ')}), closures ${closures.length}, ${(out.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms`);
