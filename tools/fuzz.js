/* ---------------------------------------------------------------------------
   模糊测试：随机乱按，覆盖标题、游玩、暂停、失败、过关之间的所有跳转。

   查两件事：有没有抛异常，以及主角和摄像机的坐标有没有变成 NaN。
   物理里只要有一处除零，NaN 会顺着矩阵扩散到整个画面，肉眼很难定位，
   所以这里每帧都盯着。

   用法：node tools/fuzz.js [帧数]
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame } = require('./env.js');

const FRAMES = +process.argv[2] || 26000;    // 约 7 分钟游戏时间
const G = loadGame();
const { Hero, Game, Keys, Input, Cam } = G;
const R = Math.random;

let exceptions = 0, nanAt = -1;
const states = {};

for (let i = 0; i < FRAMES; i++) {
  Keys.up = R() < 0.75; Keys.down = R() < 0.05;
  Keys.left = R() < 0.15; Keys.right = R() < 0.15;
  Keys.sprint = R() < 0.6; Keys.jump = R() < 0.3;
  if (R() < 0.08) Input.jumpEdge = true;
  if (R() < 0.05) Input.atkEdge = true;
  if (R() < 0.03) Input.slideEdge = true;
  Cam.yaw += (R() - 0.5) * 0.25;
  Cam.pitch = Math.max(-1.1, Math.min(0.8, Cam.pitch + (R() - 0.5) * 0.1));

  // 暂停是粘住的，进去之后要快点出来，否则大半帧数都耗在暂停界面上
  if (Game.state === 'pause' ? R() < 0.03 : R() < 0.0007) Game.togglePause();
  if (R() < 0.0004) Game.restartChapter();
  if (R() < 0.0010) G.primaryClick();        // 模拟点画面：开始 / 重来 / 下一回

  states[Game.state] = (states[Game.state] || 0) + 1;
  exceptions += G.tick();

  const sum = Hero.x + Hero.y + Hero.z + Hero.vx + Hero.vy + Hero.vz + Cam.x + Cam.y + Cam.z;
  if (!isFinite(sum)) { nanAt = i; break; }
}

console.log('帧数 ' + FRAMES + ' · 状态分布 ' + JSON.stringify(states));
console.log('异常 ' + exceptions + ' · NaN ' + (nanAt < 0 ? '无' : '第 ' + nanAt + ' 帧'));
G.errors.forEach(e => console.log('  ' + e.stack.split('\n').slice(0, 2).join(' | ')));
const bad = exceptions || nanAt >= 0;
console.log(bad ? '\n✗ 有问题' : '\n✓ 无异常、无 NaN');
process.exit(bad ? 1 : 0);
