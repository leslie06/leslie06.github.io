/* ---------------------------------------------------------------------------
   模糊测试：随机乱按，把标题、游玩、商店、死亡之间的跳转全踩一遍。

   查三件事：有没有抛异常，坐标有没有变成 NaN，有没有哪个数组只进不出。
   死了就重开，所以一次能覆盖很多局。

   用法：node tools/fuzz.js [帧数]
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame, sanity } = require('./env.js');

const FRAMES = +process.argv[2] || 43200;          // 约 12 分钟游戏时间
const G = loadGame();
const { P, K, mouse, WEAPONS } = G;

mouse.has = true; mouse.down = 1;
G.startRun();

let runs = 1, buys = 0, maxZ = 0, maxP = 0;
for (let f = 0; f < FRAMES; f++) {
  if (G.mode === 'shop') {
    for (let i = 0; i < 8; i++) { const c = G.cash; G.buyItem(i); if (G.cash !== c) buys++; }
    G.startWave(G.wave + 1);
  }
  if (G.mode === 'over') { G.startRun(); runs++; }

  K.u = Math.random() < 0.3 ? 1 : 0; K.d = Math.random() < 0.3 ? 1 : 0;
  K.l = Math.random() < 0.3 ? 1 : 0; K.r = Math.random() < 0.3 ? 1 : 0;
  mouse.x = Math.random() * G.W; mouse.y = Math.random() * G.H;
  if (f % 97  === 0) G.dash();
  if (f % 211 === 0) G.throwNade();
  if (f % 313 === 0) G.swapWeapon(1);
  if (f % 401 === 0) G.startReload();
  if (f % 501 === 0) G.selectWeapon((Math.random() * WEAPONS.length) | 0);

  G.step(G.STEP);
  if (f % 3 === 0) G.render();

  maxZ = Math.max(maxZ, G.zombies.length);
  maxP = Math.max(maxP, G.parts.length);
  if (f % 600 === 0) sanity(G, '第 ' + f + ' 帧');
}
sanity(G, '收尾');
console.log('✓ 乱按 ' + FRAMES + ' 帧：开局 ' + runs + ' 次，购买 ' + buys + ' 次，' +
            '击杀 ' + G.kills + '，同屏最多 ' + maxZ + ' 只僵尸 / ' + maxP + ' 个粒子');
