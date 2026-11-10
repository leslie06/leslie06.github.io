/**
 * 语音导航要录的路名（2026-11-10，docs/beijing-immersion-design.md C2）：在车道图上随机规划 12000 条 0.8–9 公里的路线，
 * 统计转向提示（nav/Turns.ts）里「进入 XX」出现的次数，取最常见的 COUNT 个写到 src/audio/NavRoads.ts。
 * 「XX桥」（立交上的一段）和「XX辅路」不录：前者不说路名，后者说「走辅路」。改了路网以后可以重跑；名单变了要重录
 * （scripts/voice/nav.mts → synth → nav-pack.mjs），录音按路名的哈希命名，旧的不会错位。
 *   npx tsx scripts/voice/nav-roads.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { LaneGraph } from '../../src/traffic/LaneGraph';
import { Router } from '../../src/nav/Router';
import { routeTurns } from '../../src/nav/Turns';

const COUNT = 320, ROUTES = 12000;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const net = JSON.parse(fs.readFileSync(path.join(root, 'public/city/network.json'), 'utf8'));
const g = new LaneGraph(net), r = new Router(g);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const cnt = new Map<string, number>();
let named = 0;
for (let i = 0; i < ROUTES; i++) {
  const a = Math.floor(rnd() * g.nodeX.length), b = Math.floor(rnd() * g.nodeX.length);
  const d = Math.hypot(g.nodeX[b] - g.nodeX[a], g.nodeZ[b] - g.nodeZ[a]);
  if (d < 800 || d > 9000) continue;
  const route = r.route(g.nodeX[a], g.nodeZ[a], NaN, g.nodeX[b], g.nodeZ[b]);
  if (!route) continue;
  for (const t of routeTurns(g, route.pts, route.links)) {
    if (!t.road || t.kind === 'arrive') continue;
    named++;
    if (/桥$|辅路$|[A-Za-z0-9]/.test(t.road)) continue;
    cnt.set(t.road, (cnt.get(t.road) ?? 0) + 1);
  }
}
const list = [...cnt].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, COUNT);
const covered = list.reduce((s, [, c]) => s + c, 0);
const out = `// 由 scripts/voice/nav-roads.mts 生成，别手改：语音导航录了的路名（按转向提示里出现的次数排）。\nexport const NAV_ROADS: readonly string[] = ${JSON.stringify(list.map(([n]) => n))};\n`;
fs.writeFileSync(path.join(root, 'src/audio/NavRoads.ts'), out);
console.log(`src/audio/NavRoads.ts: ${list.length} roads, ${(covered / named * 100).toFixed(1)}% of named turns`);
