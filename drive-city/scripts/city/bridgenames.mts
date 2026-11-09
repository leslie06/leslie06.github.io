// 立交桥身上的桥名（2026-11-09，src/city/visual/BridgeNames.ts）：从 network.json 算出每块字的位置和朝向，
// 写到 public/city/bridgenames.json（{"p": [[x, y, z, nx, nz, 名字下标], ...], "n": [名字...]}）。
// 游戏启动时算要 0.1 秒（手机上更久），所以在构建时算。build.mjs 在 netpack 之后跑它。
// Usage: npx tsx scripts/city/bridgenames.mts
import fs from 'node:fs';
import { bridgePlates } from '../../src/city/visual/BridgeNames';

const net = JSON.parse(fs.readFileSync('public/city/network.json', 'utf8'));
const plates = bridgePlates(net);
const names = [...new Set(plates.map((p) => p.name))];
const r = (v: number, k = 10) => Math.round(v * k) / k;
const json = JSON.stringify({ n: names, p: plates.map((p) => [r(p.x), r(p.y), r(p.z), r(p.nx, 1000), r(p.nz, 1000), names.indexOf(p.name)]) });
fs.writeFileSync('public/city/bridgenames.json', json);
console.log(`bridge names: ${plates.length} plates on ${names.length} interchanges, ${(json.length / 1024).toFixed(0)} KB`);
