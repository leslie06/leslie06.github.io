/* 赛道谐波参数搜索：随机撒点，按"有多少路程值得漂"和最小转弯半径挑。
   不参与游戏运行，改赛道手感时才跑。 */
'use strict';
const { loadGame } = require('./env.js');
const G = loadGame();

const DRIFT_R = 76;          // 这个速度下漂移的最小转弯半径量级，比它急的弯才值得漂
function score(def) {
  G.buildTrack(def);
  const T = G.Track, N = T.N;
  let minR = Infinity, driftable = 0, wallAt = 0;
  for (const n of T.nodes) {
    const c = Math.abs(n.curv), r = c > 1e-6 ? 1 / c : Infinity;
    if (r < minR) { minR = r; wallAt = n.wall; }
    if (r < DRIFT_R) driftable++;
  }
  let minSep = Infinity;
  const skip = Math.ceil(240 / T.gap);
  for (let i = 0; i < N; i += 3) for (let j = i + 3; j < N; j += 3) {
    if (Math.min(j - i, N - (j - i)) < skip) continue;
    const p = T.nodes[i], q = T.nodes[j];
    const d = Math.hypot(p.x - q.x, p.z - q.z) - (p.wall + q.wall);
    if (d < minSep) minSep = d;
  }
  return { L: T.L, minR, wallAt, drift: driftable / N, minSep };
}

const TARGET = [
  { name: '雪原环道', R: 205, width: 11.5, minR: [46, 64], drift: [0.12, 0.24] },
  { name: '黄昏峡谷', R: 195, width: 10.0, minR: [29, 40], drift: [0.20, 0.34] },
  { name: '霓虹夜港', R: 185, width: 9.4,  minR: [21, 30], drift: [0.28, 0.46] },
];

const rnd = (a, b) => a + Math.random() * (b - a);
for (const t of TARGET) {
  const found = [];
  for (let iter = 0; iter < 4000; iter++) {
    const nH = 3 + Math.floor(Math.random() * 2);
    const ks = [2, 3, 4, 5, 6].sort(() => Math.random() - 0.5).slice(0, nH);
    const rh = ks.map(k => [k, rnd(0.03, 0.20), rnd(0, 6.28)]);
    rh.push([1, rnd(0.02, 0.08), rnd(0, 6.28)]);
    const yh = [[1, rnd(4, 9), rnd(0, 6.28)], [2, rnd(2, 6), rnd(0, 6.28)], [3, rnd(1, 3), rnd(0, 6.28)]];
    const def = { name: t.name, theme: 'snow', laps: 3, seed: 1, R: t.R, width: t.width, rh, yh };
    const r = score(def);
    if (r.minR < t.minR[0] || r.minR > t.minR[1]) continue;
    if (r.drift < t.drift[0] || r.drift > t.drift[1]) continue;
    if (r.minSep < 10) continue;
    if (r.minR < r.wallAt * 1.35) continue;                 // 别把路肩折过来
    if (r.L < 1000 || r.L > 1700) continue;
    found.push({ def, r });
  }
  found.sort((a, b) => b.r.drift - a.r.drift);
  console.log('\n' + t.name + '　候选 ' + found.length + ' 个');
  for (const f of found.slice(0, 3)) {
    const rh = f.def.rh.map(h => '[' + h[0] + ', ' + h[1].toFixed(3) + ', ' + h[2].toFixed(2) + ']').join(', ');
    const yh = f.def.yh.map(h => '[' + h[0] + ', ' + h[1].toFixed(1) + ', ' + h[2].toFixed(2) + ']').join(', ');
    console.log('  周长 ' + f.r.L.toFixed(0) + 'm  最小半径 ' + f.r.minR.toFixed(1) +
      'm  可漂 ' + (f.r.drift * 100).toFixed(0) + '%  余量 ' + f.r.minSep.toFixed(0) + 'm');
    console.log('    rh: [' + rh + ']');
    console.log('    yh: [' + yh + ']');
  }
}
