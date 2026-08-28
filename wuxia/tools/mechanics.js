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
const SCENES = G.SCENES;
/* 追捕默认关掉：不然测吊索、跳板、脚步声的时候捕快照追不误，把主角抓死，
   后面的断言全成了噪声。到追捕那一节再打开。 */
let chaseOn = false;
const realStart = Game.startChapter.bind(Game);
Game.startChapter = function (n) { realStart(n); G.Chase.on = chaseOn; };
let fails = 0;
function ok(cond, msg, detail) {
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + msg + (detail ? '   ' + detail : ''));
  if (!cond) fails++;
}
// 清掉输入残留：不清的话上一段测试的「一直向前」会带进下一段
function idle() {
  G.Input.ax = 0; G.Input.ay = 0; G.Input.touch = true;
  G.Input.jumpEdge = false; G.Input.atkEdge = false; G.Input.slideEdge = false;
  for (const k in G.Keys) G.Keys[k] = false;
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
for (let ch = 1; ch <= G.SCENES.length; ch++) {
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

/* ------------------------------------------------------------------ 天气 */
console.log('\n天气');
{
  const want = { none: [0, 0, 'tile'], rain: [0, 1, 'wet'], snow: [1, 0, 'snow'], dawn: [0, 0, 'tile'] };
  let allOk = true, line = [];
  for (let ch = 1; ch <= SCENES.length; ch++) {
    Game.startChapter(ch);
    const sc = SCENES[ch - 1], w = want[sc.weather];
    const good = G.Env.snow === w[0] && G.Env.wet === w[1] && G.Env.step === w[2] &&
                 G.Weather.kind === sc.weather;
    if (!good) allOk = false;
    line.push(ch + sc.weather[0]);
  }
  ok(allOk, '六回各自装上了对的天气参数', line.join(' '));

  // 雨：粒子在动，溅点在生成
  const rainCh = SCENES.findIndex(s => s.weather === 'rain') + 1;
  Game.startChapter(rainCh);
  const W = G.Weather;
  ok(W.n > 300, '雨滴数量够铺满视野', W.n + ' 滴');
  const y0 = W.py[0];
  for (let i = 0; i < 10; i++) G.tick();
  ok(W.py[0] !== y0, '雨滴在下落');
  ok(W.splash.length > 0, '雨打在瓦上会溅起来', W.splash.length + ' 个溅点');
  // 粒子始终跟着摄像机走，不会飘走
  for (let i = 0; i < 400; i++) G.tick();
  let out = 0;
  for (let i = 0; i < W.n; i++)
    if (Math.abs(W.px[i] - G.Cam.x) > W.box || Math.abs(W.pz[i] - G.Cam.z) > W.box) out++;
  ok(out === 0, '雨滴始终跟着摄像机循环，不会掉队', out + ' 滴跑掉');

  // 闪电：先闪，隔一会儿才打雷
  let thunders = 0;
  const realThunder = G.SFX.thunder;
  G.SFX.thunder = function () { thunders++; };
  W.boltT = 0.001;
  let peak = 0;
  for (let i = 0; i < 5; i++) { G.tick(); peak = Math.max(peak, W.flash); }
  ok(peak > 0.7, '会闪电', '峰值 flash=' + peak.toFixed(2) + '（衰减很快，取峰值）');
  ok(W.thunderT > 0, '雷声排在闪光之后', '延后 ' + W.thunderT.toFixed(1) + 's');
  for (let i = 0; i < 300; i++) G.tick();
  ok(thunders >= 1, '延时之后打雷', thunders + ' 声');
  G.SFX.thunder = realThunder;

  // 脚步：拦截 SFX.step，跑一段看踩出什么声
  function runSteps(ch, frames) {
    Game.startChapter(ch);
    const kinds = {};
    const real = G.SFX.step;
    G.SFX.step = function (kind) { kinds[kind] = (kinds[kind] || 0) + 1; };
    G.Input.touch = true; G.Input.ax = 0; G.Input.ay = 1;
    G.Cam.yaw = Math.PI / 2;
    for (let i = 0; i < frames; i++) { Hero.hp = Hero.maxHp; G.tick(); }
    G.SFX.step = real;
    return kinds;
  }
  // 只断言「响了」和「只响对的那种」，不去卡具体次数——跑动节奏本来就是浮动的
  const total = k => Object.keys(k).reduce((a, b) => a + k[b], 0);
  const snowCh = SCENES.findIndex(s => s.weather === 'snow') + 1;
  const sk = runSteps(snowCh, 500);
  ok((sk.snow || 0) >= 4 && (sk.snow || 0) === total(sk), '雪地里只踩出踩雪声', JSON.stringify(sk));
  const rk = runSteps(rainCh, 500);
  ok((rk.wet || 0) >= 4 && (rk.wet || 0) === total(rk), '雨夜里只踩出湿脚步', JSON.stringify(rk));
  const nk = runSteps(1, 500);
  const dry = (nk.tile || 0) + (nk.wood || 0);
  ok(dry >= 4 && dry === total(nk), '晴夜按脚下材质分瓦声和木声，不会混进雨雪', JSON.stringify(nk));
}

/* ------------------------------------------------------------------ 追捕 */
console.log('\n追捕');
{
  chaseOn = true;
  const C = G.Chase;

  // 不杀人就没人追
  Game.startChapter(1); idle();
  G.Input.ay = 1; G.Cam.yaw = Math.PI / 2;
  for (let i = 0; i < 600; i++) { Hero.hp = Hero.maxHp; G.tick(); }
  ok(C.cops.length === 0, '不杀人，整回没有捕快', '跑了 10s，追兵 ' + C.cops.length + ' 人');
  ok(!Hero.dead, '也不会平白无故被抓');

  // 取一条人命就有人报官
  const foe = G.Foes.find(f => !f.dead && f.type !== 'boss');
  ok(!!foe, '关里有可杀的敌人');
  const gapAtKill = C.headS;
  G.hitFoe(foe, 1, 0, 99);
  ok(C.cops.length >= 2, '杀第一个人，两个捕快循声赶来', C.cops.length + ' 人');
  ok(C.headS - C.cops[0].prog > 30, '捕快从后面赶来，不是凭空贴在脸上',
     '出现时距离 ' + (C.headS - C.cops[0].prog).toFixed(0) + 'm');

  // 杀得越多来得越多，且脚程更快
  const n1 = C.cops.length, sp1 = C.speed;
  for (const f of G.Foes.filter(f => !f.dead && f.type !== 'boss').slice(0, 3)) G.hitFoe(f, 1, 0, 99);
  ok(C.cops.length > n1 && C.speed > sp1, '杀得越多，人越多、脚程越快',
     n1 + '→' + C.cops.length + ' 人，' + sp1.toFixed(2) + '→' + C.speed.toFixed(2) + ' m/s');
  ok(C.cops.length <= C.maxCops, '人数有上限', C.cops.length + '/' + C.maxCops);

  // 被摸到先上绳，不是当场判负
  idle();
  C.hold = 0;                                   // 摔跤复活的宽限期，测试里直接清掉
  Game.hitStop = 0;                             // 击杀顿帧期间物理不推进，会误判
  for (let i = 0; i < 4; i++) G.tick();         // 等主角停稳
  C.cops[0].prog = C.headS - 1.0;
  let gt = 0;
  while (gt++ < 8 && !Hero.grabbed) G.tick();
  ok(Hero.grabbed && !Hero.dead, '被摸到先上绳，不是当场就输',
     'bound=' + Hero.bound.toFixed(2) + '，' + gt + ' 帧内触发');
  const b0 = Hero.bound;
  for (let i = 0; i < 12; i++) G.tick();
  ok(Hero.bound > b0, '不挣扎，绳子一直在收紧', b0.toFixed(2) + ' → ' + Hero.bound.toFixed(2));

  // 连打能挣脱，挣完能继续跑
  const progBeforeFree = C.cops[0].prog;
  let mashes = 0, tk = 0;
  while (tk++ < 300 && Hero.grabbed && !Hero.dead) {
    if (tk % 7 === 0) { G.Input.jumpEdge = true; mashes++; }   // 约每秒 8 下，真人手速
    G.tick();
  }
  ok(!Hero.grabbed && !Hero.dead, '连打能挣脱',
     '按了 ' + mashes + ' 下，用了 ' + (tk / 60).toFixed(1) + 's');
  ok(C.cops[0].prog < progBeforeFree - 5, '挣脱时把捕快推开',
     '退了 ' + (progBeforeFree - C.cops[0].prog).toFixed(0) + 'm');
  idle();
  for (let i = 0; i < 30; i++) G.tick();
  ok(!Hero.dead, '挣脱后还能继续跑，不会立刻又被按住');

  // 围的人越多，绑得越快
  // 量收绳速度：先让人贴稳，再测一段，避开上绳瞬间那一跳
  function bindRate(k) {
    Game.startChapter(1); idle();
    G.hitFoe(G.Foes.find(f => !f.dead && f.type !== 'boss'), 1, 0, 99);
    while (C.cops.length < k) C.alarm();
    C.cops.length = k;                          // 精确控制围上来几个人
    C.hold = 0; Game.hitStop = 0;
    for (let i = 0; i < 4; i++) G.tick();
    for (const c of C.cops) c.prog = C.headS - 1.0;
    let g0 = 0;
    while (g0++ < 8 && !Hero.grabbed) G.tick();
    if (!Hero.grabbed) return { rate: -1, g: 0 };
    for (let i = 0; i < 20; i++) G.tick();      // 等人都贴上来
    const a = Hero.bound;
    for (let i = 0; i < 24; i++) G.tick();
    return { rate: (Hero.bound - a) / (24 / 60), g: C.grabbers };
  }
  const r1 = bindRate(1), r3 = bindRate(3);
  ok(r1.rate > 0 && r3.rate > r1.rate * 1.35, '围上来的人越多，绳子收得越快',
     r1.g + ' 人 ' + r1.rate.toFixed(2) + '/s，' + r3.g + ' 人 ' + r3.rate.toFixed(2) + '/s');

  // 完全不动，绳子会上满
  Game.startChapter(1); idle();
  G.hitFoe(G.Foes.find(f => !f.dead && f.type !== 'boss'), 1, 0, 99);
  let f2 = 0;
  while (f2++ < 1500 && !Hero.dead) { G.tick(); }
  ok(Hero.dead && Hero.deathKind === 'caught', '一直不挣扎，绳子上满就被擒',
     '第 ' + (f2 / 60).toFixed(1) + 's');

  // 摔一跤要丢掉从检查点跑到失足处的那段路，不能反而赚
  Game.startChapter(2); idle();
  G.Input.ay = 1; G.Cam.yaw = Math.PI / 2;
  for (let i = 0; i < 300; i++) { Hero.hp = Hero.maxHp; G.tick(); }
  G.hitFoe(G.Foes.find(f => !f.dead && f.type !== 'boss'), 1, 0, 99);
  for (let i = 0; i < 240; i++) { Hero.hp = Hero.maxHp; G.tick(); }
  const before = C.s, gapBefore = C.minGap;
  Hero.invuln = 0; Hero.y = 0.5;
  for (let i = 0; i < 6; i++) G.tick();
  ok(C.s < before - 5, '摔下去会把轨迹弧长退回检查点',
     '丢掉 ' + (before - C.s).toFixed(0) + 'm（原本瞬移会白赚这一段）');
  ok(C.minGap <= gapBefore + 1, '摔完距离不会反而变大',
     gapBefore.toFixed(0) + 'm → ' + C.minGap.toFixed(0) + 'm');

  // 一剑打不死捕快，但能把人逼退
  Game.startChapter(1); idle();
  G.Input.ay = 1; G.Cam.yaw = Math.PI / 2;
  for (let i = 0; i < 90; i++) G.tick();
  G.hitFoe(G.Foes.find(f => !f.dead && f.type !== 'boss'), 1, 0, 99);
  idle();
  for (let i = 0; i < 30; i++) G.tick();
  const cop = C.cops[0], nCops = C.cops.length;
  C.speed = 0;
  cop.prog = C.headS - 2.2;
  G.tick();
  const progBefore = cop.prog;
  Hero.yaw = Math.atan2(cop.x - Hero.x, cop.z - Hero.z);
  G.Input.atkEdge = true;
  for (let i = 0; i < 20; i++) G.tick();
  ok(cop.stun > 0 || cop.prog < progBefore - 3, '一棍子能把捕快逼退',
     '退了 ' + (progBefore - cop.prog).toFixed(1) + 'm');
  ok(C.cops.length === nCops, '捕快打不死，人数不变');

  // 上了钟楼就安全
  Game.startChapter(1); idle();
  G.hitFoe(G.Foes.find(f => !f.dead && f.type !== 'boss'), 1, 0, 99);
  const g = World.goal;
  for (let i = 0; i < 240; i++) {
    Hero.x = g.x - 6; Hero.y = g.y + 0.2; Hero.z = g.z;
    Hero.dead = false; Hero.hp = Hero.maxHp;
    G.tick();
  }
  ok(C.atGoal, '上了钟楼判定为安全区');
  ok(!Hero.dead, '在钟楼上不会被抓（否则第六回没法打头目）');
}

console.log(fails ? '\n✗ ' + fails + ' 项不通过' : '\n✓ 机制、天气、追捕全部正常');
process.exit(fails ? 1 : 0);
