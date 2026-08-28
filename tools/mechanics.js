/* ---------------------------------------------------------------------------
   机制测试：吊索、跳板、水缸。

   通关测试只能说明「路是通的」，说明不了这三样有没有真的在工作——机器人
   绕过去了照样通关。这里直接把主角摆到该触发的位置，断言它确实触发。

   用法：node tools/mechanics.js
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame } = require('./env.js');

const G = loadGame();
const { World, Hero, Game, groundAt } = G;
let fails = 0;
function ok(cond, msg, detail) {
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + msg + (detail ? '   ' + detail : ''));
  if (!cond) fails++;
}
// 把主角摆到指定位置，清掉一切状态
function place(x, y, z, vx, vy) {
  Hero.x = x; Hero.y = y; Hero.z = z;
  Hero.vx = vx || 0; Hero.vy = vy || 0; Hero.vz = 0;
  Hero.onGround = false; Hero.ground = null; Hero.zip = null; Hero.zipCool = 0;
  Hero.dead = false; Hero.hp = Hero.maxHp; Hero.invuln = 9; Hero.slideT = 0; Hero.wallT = 0;
}

/* ---------------------------------------------------------------- 吊索 */
function testZip(ch) {
  Game.startChapter(ch);
  const z = World.zips[0];
  if (!z) return ok(false, '第' + ch + '回没有生成吊索');
  const p = [0, 0, 0];
  G.__zp = null;
  // 摆到索的起点下方，作自由落体状
  const zipPoint = (t) => { const sag = z.sag * 4 * t * (1 - t);
    return [z.ax + (z.bx - z.ax) * t, z.ay + (z.by - z.ay) * t - sag, z.az + (z.bz - z.az) * t]; };
  const s = zipPoint(0.10);
  place(s[0], s[1] - 1.86, s[2], 0, -1);

  let grabbed = false, frames = 0, maxV = 0;
  while (frames++ < 60 && !grabbed) { G.tick(); if (Hero.zip) grabbed = true; }
  ok(grabbed, '第' + ch + '回 掠过索会自动挂上', grabbed ? '用了 ' + frames + ' 帧' : '');
  if (!grabbed) return;

  let ride = 0;
  while (ride++ < 600 && Hero.zip) { maxV = Math.max(maxV, Hero.zipV); G.tick(); }
  ok(!Hero.zip, '滑到头会自动松手', '滑行 ' + (ride / 60).toFixed(1) + 's，峰值 ' + maxV.toFixed(1) + ' m/s');
  ok(maxV > 11, '顺坡确实在加速', '峰值 ' + maxV.toFixed(1) + ' m/s');
  const e = zipPoint(1);
  const dist = Math.hypot(Hero.x - e[0], Hero.z - e[2]);
  ok(dist < 4, '松手时人在索的末端', '距终点 ' + dist.toFixed(1) + 'm');
  // 松手后应当落到对面那片屋顶上
  let land = 0;
  while (land++ < 240 && !Hero.onGround) G.tick();
  ok(Hero.onGround && Hero.y > 3, '落到了对岸的屋顶', 'y=' + Hero.y.toFixed(1));
}

/* ---------------------------------------------------------------- 跳板 */
function testSpring(ch) {
  Game.startChapter(ch);
  const sp = World.solids.filter(s => s.spring);
  if (!sp.length) return ok(false, '第' + ch + '回没有生成跳板');
  const s = sp[0];
  place((s.x0 + s.x1) / 2, s.top + 0.35, (s.z0 + s.z1) / 2, 0, -2);
  let f = 0, peak = 0;
  while (f++ < 20 && Hero.vy < 10) G.tick();
  peak = Hero.vy;
  ok(peak > 14, '踩上跳板被弹起', '初速 ' + peak.toFixed(1) + ' m/s');
  ok(!Hero.onGround, '弹起后离地');
  const y0 = Hero.y;
  let top = y0;
  for (let i = 0; i < 200; i++) { G.tick(); top = Math.max(top, Hero.y); if (Hero.onGround) break; }
  ok(top - y0 > 6, '弹得比普通跳跃高得多', '升高 ' + (top - y0).toFixed(1) + 'm（普通跳约 2.4m）');
  ok(sp.length >= 2, '跳板横向铺满出檐口，绕不过去', sp.length + ' 块一排');
}

/* ---------------------------------------------------------------- 水缸 */
function testVat(ch) {
  Game.startChapter(ch);
  const v = World.dyn.find(d => d.kind === 'vat');
  if (!v) return ok(false, '第' + ch + '回没有生成水缸');
  const roof = groundAt(v.x, v.z, v.y + 0.4, 0);
  ok(v.sol.top > roof.y + 0.9, '缸顶能站人', '比屋面高 ' + (v.sol.top - roof.y).toFixed(2) + 'm');
  const onTop = groundAt(v.x, v.z, v.sol.top + 0.1, 0);
  ok(onTop.s === v.sol, '站上去踩到的是缸不是屋顶');

  const x0 = v.x;
  for (let i = 0; i < 30; i++) { v.pvx = 1; v.pvz = 0; v.pushT = 0.12; G.tick(); }
  ok(v.x - x0 > 0.8, '推得动', '推了 0.5s 走了 ' + (v.x - x0).toFixed(2) + 'm');

  let f = 0;
  while (f++ < 900 && !v.gone) { v.pvx = 1; v.pvz = 0; v.pushT = 0.12; G.tick(); }
  ok(v.gone, '推下屋顶会摔碎', '落到 y=' + v.y.toFixed(1));
  ok(v.sol.dead, '碎了之后碰撞体失效，不会留下隐形台阶');
}

/* 路段是随机抽的，某一回没抽到某种是正常的。所以先扫一遍三回，
   看每种至少出现过，再对真正生成了的那些回做行为断言。 */
const have = { zip: [], spring: [], vat: [] };
for (const ch of [1, 2, 3]) {
  Game.startChapter(ch);
  if (World.zips.length) have.zip.push(ch);
  if (World.solids.some(s => s.spring)) have.spring.push(ch);
  if (World.dyn.some(d => d.kind === 'vat')) have.vat.push(ch);
}
console.log('生成情况：吊索见于第 ' + (have.zip.join('') || '—') + ' 回 · ' +
            '跳板见于第 ' + (have.spring.join('') || '—') + ' 回 · ' +
            '水缸见于第 ' + (have.vat.join('') || '—') + ' 回\n');

console.log('吊索');
ok(have.zip.length > 0, '至少有一回生成了吊索');
have.zip.slice(0, 2).forEach(testZip);

console.log('\n跳板');
ok(have.spring.length > 0, '至少有一回生成了跳板');
have.spring.slice(0, 2).forEach(testSpring);

console.log('\n水缸');
ok(have.vat.length > 0, '至少有一回生成了水缸');
have.vat.slice(0, 2).forEach(testVat);

console.log(fails ? '\n✗ ' + fails + ' 项不通过' : '\n✓ 三样机制全部正常');
process.exit(fails ? 1 : 0);
