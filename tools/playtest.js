/* ---------------------------------------------------------------------------
   通关测试：让一个自动寻路的机器人把三回都跑一遍。

   机器人很笨——只会朝下一个路点冲、前方没地就起跳、要掉下去了补一次踏空。
   它跑得通，人就一定跑得通。反过来，如果它在同一个路点反复摔（热点），
   多半是关卡生成器造出了跳不过去的距离。

   用法：node tools/playtest.js
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame } = require('./env.js');

const MAX_SECONDS = 900;      // 单回上限，超了算失败
const HOTSPOT = 3;            // 同一个路点摔够这么多次就算设计问题

function playChapter(G, ch) {
  const { World, Hero, Game, Input, Cam, groundAt } = G;
  Game.startChapter(ch);
  Input.touch = true;                       // 让 readInput 走摇杆分支，方便脚本喂方向

  let t = 0, stuck = 0, lastX = Hero.x, best = 0, falling = false;
  const falls = [];
  const dt = 16.7 / 1000;

  while (t < MAX_SECONDS && Game.state === 'play') {
    t += dt;
    Hero.hp = Hero.maxHp;                   // 不死身：要找的是过不去的地方，不是耐久

    const next = World.path[Math.min(Hero.node + 1, World.path.length - 1)];
    let dx = next.cx - Hero.x, dz = next.cz - Hero.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;

    // 镜头转向目标，摇杆一律推前
    const want = Math.atan2(dx, dz);
    let diff = ((want - Cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    Cam.yaw += Math.max(-0.14, Math.min(0.14, diff));
    Input.ax = 0; Input.ay = 1; Input.tsprint = d > 7;

    if (Hero.onGround) {
      const ahead = groundAt(Hero.x + dx * 1.7, Hero.z + dz * 1.7, Hero.y + 0.6, 0);
      if (!ahead.s || ahead.y < Hero.y - 1.6 || (d < 2.6 && next.y > Hero.y + 0.5)) Input.jumpEdge = true;
    } else if (Hero.vy < -1 && Hero.jumps < 2 && Hero.qi >= 25) {
      const land = groundAt(Hero.x + dx * 1.2, Hero.z + dz * 1.2, Hero.y, 0);
      if (!land.s || land.y < Hero.y - 4) Input.jumpEdge = true;   // 补一次踏空
    }
    if (Math.random() < 0.02) Input.atkEdge = true;

    G.tick();

    if (Hero.y < 2 && !falling) { falling = true; falls.push((Hero.node + 1) + ':' + next.kind); }
    if (Hero.y > 3) falling = false;
    if (Hero.node > best) best = Hero.node;
    stuck = Math.abs(Hero.x - lastX) < 0.02 ? stuck + 1 : 0;
    lastX = Hero.x;
    if (stuck > 420) break;                 // 卡住 7 秒
  }

  const tally = {};
  falls.forEach(f => tally[f] = (tally[f] || 0) + 1);
  const hot = Object.entries(tally).filter(e => e[1] >= HOTSPOT).sort((a, b) => b[1] - a[1]);
  const boss = G.Foes.find(f => f.type === 'boss');
  return {
    ch, cleared: Game.state === 'clear', seconds: +t.toFixed(1),
    node: best, of: World.path.length - 1, falls: falls.length, hot,
    boss: boss ? (boss.dead ? '伏诛' : '尚在 hp' + boss.hp) : '—',
    stuck: stuck > 420
  };
}

const G = loadGame();
let bad = 0;
console.log('回  场景      结果    用时     路点        摔  头目');
for (let ch = 1; ch <= G.SCENES.length; ch++) {
  const r = playChapter(G, ch);
  const ok = r.cleared && !r.hot.length && !r.stuck;
  if (!ok) bad++;
  const wname = { none: '夜　', rain: '雨夜', snow: '雪夜', dawn: '破晓' }[G.SCENES[ch - 1].weather];
  console.log(
    ' ' + r.ch + '  ' + wname + '      ' + (r.cleared ? '通关  ' : r.stuck ? '卡死  ' : '未通  ') +
    String(r.seconds).padStart(6) + 's  ' +
    String(r.node + '/' + r.of).padStart(7) + '  ' +
    String(r.falls).padStart(4) + '  ' + r.boss +
    (r.hot.length ? '   ← 热点 ' + r.hot.map(h => h[0] + '×' + h[1]).join(' ') : ''));
}
if (G.errors.length) { console.log('\n运行时异常：'); G.errors.forEach(e => console.log('  ' + e.stack.split('\n')[0])); bad++; }
console.log(bad ? '\n✗ ' + bad + ' 回有问题' : '\n✓ ' + G.SCENES.length + ' 回全部可通关，无重复失败点');
process.exit(bad ? 1 : 0);
