/* ---------------------------------------------------------------------------
   让机器人把每条赛道每个难度都跑一遍，报告"这局好不好玩"的几个数：

     名次差    第一名和最后一名的完赛时间差。差太大＝人机把你甩没了或者你把人机甩没了
     超车次数  全场名次变动的总数。为 0 说明发车顺序就是最终顺序，那不叫比赛
     玩家名次  玩家（也用人机在开）从第 8 位发车，最后能跑到第几
     道具      各种道具实际被用掉多少次，看权重表有没有跑偏
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame } = require('./env.js');
const G = loadGame();

function race(trackIdx, diff, seed) {
  G.Race.trackIdx = trackIdx; G.Race.diff = diff; G.Race.charIdx = 0;
  G.startRace();
  G.Race.state = 'race'; G.Race.countdown = 0;
  const dt = 1 / 100;
  const items = {};
  let passes = 0, lastRanks = G.Race.karts.map(k => k.rank);
  let leadChanges = 0, lastLeader = G.Race.order[0];

  const origUse = G.useItem;
  for (let t = 0; t < 400; t += dt) {
    G.Race.time += dt;
    for (const k of G.Race.karts) {
      const had = k.item;
      G.updateAI(k, dt);
      G.updateKart(k, dt);
      if (had && k.item !== had) items[had] = (items[had] || 0) + 1;
    }
    G.kartCollisions(dt); G.updateItems(dt); G.updateRanks(); G.updateParts(dt);
    for (const k of G.Race.karts) if (!k.finished && k.lap > G.Track.laps) G.finishKart(k);
    const now = G.Race.karts.map(k => k.rank);
    for (let i = 0; i < now.length; i++) if (now[i] !== lastRanks[i]) passes++;
    lastRanks = now;
    if (G.Race.order[0] !== lastLeader) { leadChanges++; lastLeader = G.Race.order[0]; }
    if (G.Race.karts.every(k => k.finished)) break;
  }
  const fin = G.Race.order.map(k => k.finishT);
  const laps = [].concat(...G.Race.karts.map(k => k.lapTimes));
  return {
    spread: fin[fin.length - 1] - fin[0],
    winner: fin[0],
    passes: passes / 2,
    leadChanges,
    playerRank: G.Race.player.rank,
    bestLap: Math.min(...laps),
    meanLap: laps.reduce((a, b) => a + b, 0) / laps.length,
    items,
  };
}

const RUNS = 3;
const allItems = {};
let bad = 0;
for (let ti = 0; ti < G.TRACKS.length; ti++) {
  G.buildTrack(G.TRACKS[ti]);
  console.log('\n\x1b[1m' + G.TRACKS[ti].name + '\x1b[0m  ' +
    G.TRACKS[ti].laps + ' 圈  ' + G.Track.L.toFixed(0) + 'm');
  for (let d = 0; d < 3; d++) {
    const rs = [];
    for (let r = 0; r < RUNS; r++) rs.push(race(ti, d, r));
    const avg = f => rs.reduce((a, x) => a + f(x), 0) / rs.length;
    for (const r of rs) for (const k in r.items) allItems[k] = (allItems[k] || 0) + r.items[k];
    const ranks = rs.map(r => r.playerRank).join(',');
    const spread = avg(r => r.spread);
    console.log('  ' + G.AI_SKILL[d].name.padEnd(3) +
      '  冠军 ' + avg(r => r.winner).toFixed(1) + 's' +
      '  最快圈 ' + avg(r => r.bestLap).toFixed(1) + 's' +
      '  名次差 ' + spread.toFixed(1) + 's' +
      '  超车 ' + avg(r => r.passes).toFixed(0) + ' 次' +
      '  换头名 ' + avg(r => r.leadChanges).toFixed(1) + ' 次' +
      '  玩家名次 ' + ranks);
    if (spread > 45) { console.log('    \x1b[33m↑ 名次差偏大，后半程可能已经没有比赛了\x1b[0m'); bad++; }
    if (avg(r => r.passes) < 6) { console.log('    \x1b[33m↑ 超车太少\x1b[0m'); bad++; }
  }
}
console.log('\n\x1b[1m道具实际使用次数\x1b[0m（' + (G.TRACKS.length * 3 * RUNS) + ' 局合计）');
const tot = Object.values(allItems).reduce((a, b) => a + b, 0);
for (const k of G.ITEM_KEYS)
  console.log('  ' + G.ITEM_DEF[k].nm.padEnd(6) + String(allItems[k] || 0).padStart(5) +
    '  ' + ((allItems[k] || 0) / tot * 100).toFixed(1) + '%');
console.log('\n' + (bad ? '\x1b[33m' + bad + ' 处需要留意\x1b[0m' : '\x1b[32m手感指标都在范围内\x1b[0m'));
