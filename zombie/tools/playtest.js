/* ---------------------------------------------------------------------------
   自动试玩：一个会瞄准、会遛尸、会买东西的机器人，从第 1 波打到死。

   它比真人笨得多（只盯最近的一只、不绕障碍、不留手雷给尸王），所以它撑到
   第几波不是"通关难度"，而是难度曲线的下限：机器人一两波就死，说明前期
   太难；机器人打到二十波不掉血，说明数值太松。改完数值跑一下就知道。

   用法：node tools/playtest.js [局数]
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame, sanity } = require('./env.js');

const RUNS = +process.argv[2] || 3;
const G = loadGame();
const { P, K, mouse, WEAPONS } = G;

function nearest() {
  let best = null, bd = 1e9;
  for (const z of G.zombies) { const d = G.dist(P.x, P.y, z.x, z.y); if (d < bd) { bd = d; best = z; } }
  return [best, bd];
}
/* 采购顺序：先保命，再补弹，再换枪，剩下的钱堆属性 */
function shop() {
  const g = G.nextGun();
  if (P.hp < P.hpMax * 0.65) G.buyItem(1);
  if (P.own.some((o, i) => i > 0 && o && P.ammo[i] < WEAPONS[i].cap * 0.3)) G.buyItem(0);
  if (g >= 0 && G.cash >= WEAPONS[g].price) G.buyItem(7);
  for (let k = 0; k < 3; k++) {
    const its = G.shopItems();
    let bi = -1, bp = 1e9;
    for (let i = 2; i <= 5; i++) if (its[i].ok() && its[i].p < bp) { bp = its[i].p; bi = i; }
    if (bi >= 0 && G.cash >= bp) G.buyItem(bi); else break;
  }
  if (P.hp < P.hpMax * 0.9) G.buyItem(1);
}

const reached = [];
let slowest = 0;                                   // 单波最长耗时，用来抓"打不完的一波"
for (let run = 1; run <= RUNS; run++) {
  mouse.has = true;
  G.startRun();
  let f = 0, waveStart = 0;
  console.log('──── 第 ' + run + ' 局 ────');
  while (G.mode !== 'over' && f - waveStart < 60 * 150) {   // 一波超过两分半就算卡住
    f++;
    if (G.mode === 'shop') {
      console.log('  第 ' + String(G.wave).padStart(2) + ' 波  用时 ' +
                  String(Math.round((f - waveStart) / 60)).padStart(3) + 's  剩血 ' +
                  Math.round(P.hp) + '/' + P.hpMax + '  钱 ' + String(G.cash).padStart(4) +
                  '  ' + WEAPONS[P.wi].name + '  累计击杀 ' + G.kills);
      slowest = Math.max(slowest, (f - waveStart) / 60);
      shop(); waveStart = f; G.startWave(G.wave + 1);
    }
    const [z, d] = nearest();
    let ax = 0, ay = 0;
    if (z) {
      mouse.x = z.x - G.cam.x; mouse.y = z.y - G.cam.y;
      mouse.down = d < 340 ? 1 : 0;
      ax = -(z.x - P.x) / d; ay = -(z.y - P.y) / d;          // 背着最近的那只走
      if (d > 220) { ax *= -0.3; ay *= -0.3; }               // 离得远就贴上去打
      if (d < 70) G.dash();
      if (P.nade > 0 && d > 90 && d < 200 && G.zombies.length > 8 && f % 60 === 0) G.throwNade();
    } else mouse.down = 0;
    const cx = G.WW / 2 - P.x, cy = G.WH / 2 - P.y, cm = Math.hypot(cx, cy) || 1;
    if (P.x < 120 || P.x > G.WW - 120 || P.y < 120 || P.y > G.WH - 120) {  // 别被逼到墙角
      ax += cx / cm * 1.4; ay += cy / cm * 1.4;
    }
    K.r = ax > 0.2 ? 1 : 0; K.l = ax < -0.2 ? 1 : 0;
    K.d = ay > 0.2 ? 1 : 0; K.u = ay < -0.2 ? 1 : 0;
    G.step(G.STEP);
    if (f % 4 === 0) G.render();
    if (f % 900 === 0) sanity(G, '第 ' + run + ' 局');
  }
  if (G.mode !== 'over') {
    // 僵尸不会寻路，被地形卡住就再也走不到玩家跟前，这一波会永远结束不了
    console.log('✗ 第 ' + G.wave + ' 波打不完：还剩 ' + G.zombies.length + ' 只，位置 ' +
                G.zombies.slice(0, 4).map(z => z.t + '@' + z.x.toFixed(0) + ',' + z.y.toFixed(0)).join(' '));
    process.exit(1);
  }
  reached.push(G.wave);
  console.log('  阵亡于第 ' + G.wave + ' 波，' + Math.round(f / 60) + ' 秒，击杀 ' + G.kills +
              '，武器 ' + P.own.map((o, i) => o ? WEAPONS[i].tag : '').filter(Boolean).join('/'));
}
const avg = reached.reduce((a, b) => a + b, 0) / reached.length;
console.log('平均阵亡波次 ' + avg.toFixed(1) + '（' + reached.join(' / ') + '）');
if (avg < 3)  { console.log('✗ 前期太难：机器人连三波都撑不过'); process.exit(1); }
if (avg > 25) { console.log('✗ 太松了：机器人躺着都能打二十五波'); process.exit(1); }
console.log('✓ 难度曲线在预期区间内，最慢的一波用了 ' + slowest.toFixed(0) + ' 秒');
