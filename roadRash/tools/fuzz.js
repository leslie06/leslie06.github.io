/* ---------------------------------------------------------------------------
   模糊测试：往游戏里灌随机输入，看它会不会炸。

   查三件事：抛异常、数值变成 NaN/Infinity、对象只进不出（内存泄漏）。
   渲染也一起跑 —— 画布是假的，画不出东西，但投影、裁剪、排序里的除零
   和越界访问会当场抛出来。

   用法：node tools/fuzz.js [每条赛道跑多少秒]
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame, step, sanity, seedRandom } = require('./env.js');
seedRandom(process.argv);

const SECS = +process.argv[2] || 60;
const G = loadGame();
const P = G.Player;
const KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 's'];

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

let bad = 0;
const say = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++; };

for (let t = 0; t < 5; t++) {
  G.startRace(t);
  while (G.Game.state === 'pre') step(G, { hold: ['arrowup'] });   // 先把倒计时走完
  const frames = SECS * 60;
  let peakTraffic = 0, peakPick = 0, peakSpark = 0, renders = 0;
  let held = [];
  for (let i = 0; i < frames; i++) {
    // 每隔几帧随机换一把键，偶尔全松手
    if (i % 7 === 0) {
      held = [];
      for (const k of KEYS) if (rnd() < .4) held.push(k);
    }
    // 变长的 dt：模拟掉帧和后台标签页回来那一下
    const dt = rnd() < .06 ? .05 : (rnd() < .15 ? .004 : 1 / 60);
    try {
      step(G, { hold: held, atkL: rnd() < .08, atkR: rnd() < .08 }, dt);
      G.render(); renders++;
    } catch (e) {
      console.log('  ✗ 第' + (t + 1) + '场 第' + i + '帧抛异常：' + e.message + '\n' + (e.stack || '').split('\n')[1]);
      process.exit(1);
    }
    peakTraffic = Math.max(peakTraffic, G.Traffic.length);
    peakPick = Math.max(peakPick, G.Pickups.length);
    peakSpark = Math.max(peakSpark, G.Fx.sparks.length);
    if (i % 20 === 0) sanity(G, '第' + (t + 1) + '场 帧' + i);
    if (G.Game.state !== 'race') break;      // 冲线或者被抓，换下一条
  }
  console.log('第' + (t + 1) + '场 ' + G.Road.name.padEnd(5, '　') +
    ' 渲染 ' + renders + ' 帧　车流峰值 ' + peakTraffic +
    '　掉落峰值 ' + peakPick + '　火花峰值 ' + peakSpark +
    '　结束于 ' + G.Game.state);
  say(peakTraffic <= 40, '  车流不堆积');
  say(peakPick <= 20, '  掉落不堆积');
  say(peakSpark <= 600, '  火花不堆积');
}

/* ---- 边角情况 ---- */
console.log('\n──── 边角 ────');
try {
  // 1. 一上来就狂点攻击
  G.startRace(0);
  for (let i = 0; i < 300; i++) step(G, { atkL: true, atkR: true });
  sanity(G, '开局狂点攻击');
  say(true, '起跑前狂按攻击不炸');

  // 2. 倒着按刹车按到底
  G.startRace(1);
  for (let i = 0; i < 60 * 20; i++) step(G, { hold: ['arrowdown'] });
  say(P.speed >= 0, '一直刹车不会倒车（speed=' + P.speed.toFixed(0) + '）');
  sanity(G, '长时间刹车');

  // 3. 一直往一边压，冲出赛道
  G.startRace(2);
  for (let i = 0; i < 60 * 30; i++) step(G, { hold: ['arrowup', 'arrowleft'] });
  say(Math.abs(P.x) <= 2, '死命往外压也出不了边界（x=' + P.x.toFixed(2) + '）');
  sanity(G, '一直外压');

  // 4. 摔在赛道最后一段，还能不能正常收场
  G.startRace(3);
  while (G.Game.state === 'pre') step(G, {});
  P.z = G.Road.finishZ - 4000;
  G.wipeout(P, '测试');
  let f = 0;
  while (G.Game.state === 'race' && f < 60 * 30) { step(G, { hold: ['arrowup'] }); f++; }
  say(G.Game.state === 'results', '终点前摔车也能正常冲线结算（' + G.Game.state + '）');

  // 5. 比赛中途切赛道，不留脏数据
  G.startRace(4);
  for (let i = 0; i < 200; i++) step(G, { hold: ['arrowup'] });
  G.startRace(0);
  say(P.z === 0 && P.hp === P.maxHp && G.Pickups.length === 0 && !G.PlayerWreck, '重开一场会把上一场彻底清干净');
  sanity(G, '中途重开');

  // 6. 界面：标题 / 车行 / 结算 / 暂停 都不能抛异常（车行里还要现画四台车的预览）
  G.showTitle();
  G.showShop();
  G.Game.money = 99999; G.buyBike(3);
  say(G.Game.owned[3] === true, '车行买得动车（预览图也画得出来）');
  G.startRace(0);
  while (G.Game.state === 'pre') step(G, {});
  G.Player.z = G.Road.finishZ + 10;
  step(G, { hold: ['arrowup'] });
  say(G.Game.state === 'results', '冲线后结算页画得出来');

  // 7. 每条赛道的几何都是连续的
  let gaps = 0;
  for (let t = 0; t < 5; t++) {
    G.buildTrack(t);
    const sg = G.Road.segs;
    for (let i = 1; i < sg.length; i++) if (Math.abs(sg[i].p1.y - sg[i - 1].p2.y) > 1e-6) gaps++;
    for (const s of sg) if (!isFinite(s.p1.y) || !isFinite(s.curve)) gaps++;
  }
  say(gaps === 0, '五条赛道的路面接得上、没有 NaN');
} catch (e) {
  console.log('  ✗ 边角用例抛异常：' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n'));
  process.exit(1);
}

console.log(bad ? '\n有 ' + bad + ' 项没过' : '\n全过');
process.exit(bad ? 1 : 0);
