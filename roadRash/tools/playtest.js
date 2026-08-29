/* ---------------------------------------------------------------------------
   自动试玩：一个只会「压着油门、躲车、见人就踹」的机器人，把五条街跑一遍。

   它比真人笨（不会走内线、不会预判弯、不捡武器就不换武器），所以它的成绩
   是难度的下限：机器人场场垫底，说明 AI 太快；机器人场场第一还不掉血，
   说明太松。改完数值跑一下就知道。

   用法：node tools/playtest.js [每条赛道跑几遍]
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame, step, sanity, seedRandom } = require('./env.js');
seedRandom(process.argv);

const RUNS = +process.argv[2] || 1;
const G = loadGame();
const { Player: P, WEPS } = G;

/* 机器人：先躲车，再贴人，其余时间往路中间靠 */
function think() {
  const hold = ['arrowup'];
  let want = 0, atkL = false, atkR = false;

  // 前方的车：往空的一侧让
  let dodge = 0;
  for (const c of G.Traffic) {
    const dz = c.z - P.z;
    if (dz > -900 && dz < 9000) {                 // 贴在身边的也要躲，不然会被黏住
      const dx = c.x - P.x;
      if (Math.abs(dx) < .34) dodge -= (dx >= 0 ? 1 : -1) * (dz < 300 ? 3 : (1 - dz / 9000) * 2.2);
    }
  }
  // 路障
  const seg = G.segAt(P.z + 4000);
  for (const it of seg.sprites) if (it.hazard && Math.abs(it.off - P.x) < .2) dodge -= (it.off >= P.x ? 1 : -1) * 1.2;

  // 警察：能打就打，打不着就往边上甩
  const cop = G.Cop;
  if (cop && cop.state === 'ride') {
    const cdz = cop.z - P.z, cdx = cop.x - P.x;
    if (Math.abs(cdz) < 800 && Math.abs(cdx) < WEPS[P.wep].reach) { if (cdx < 0) atkL = true; else atkR = true; }
    else if (Math.abs(cdz) < 2500 && Math.abs(cdx) < .4) dodge += (cdx >= 0 ? -1 : 1) * 1.8;
  }

  // 身边的对手：够得着就打，够不着就贴过去
  const reach = WEPS[P.wep].reach;
  let closest = null, cd = 1e9;
  for (const r of G.Rivals) {
    if (r.state !== 'ride') continue;
    const dz = r.z - P.z;
    if (dz < -700 || dz > 900) continue;
    const dx = r.x - P.x, ad = Math.abs(dx);
    if (ad < reach) { if (dx < 0) atkL = true; else atkR = true; }
    if (ad < cd) { cd = ad; closest = r; }
  }
  // 咬住一个人打：贴到刚好够得着的距离上，别打一下就飘走
  if (closest && cd < .6 && Math.abs(dodge) < .3)
    want = (closest.x > P.x ? 1 : -1) * (cd > reach * .75 ? .6 : (cd < reach * .45 ? -.35 : 0));

  want = Math.max(-1, Math.min(1, want + dodge - P.x * .8));
  if (want < -.12) hold.push('arrowleft');
  if (want >  .12) hold.push('arrowright');
  return { hold, atkL, atkR };
}

/* 车行策略：每次都买当下买得起的最好那台 —— 跟真人一样，钱都花在车上 */
function shop() {
  for (let i = G.BIKES.length - 1; i >= 0; i--) {
    if (!G.Game.owned[i] && G.Game.money >= G.BIKES[i].price) { G.buyBike(i); return; }
  }
}

const board = [];
for (let run = 0; run < RUNS; run++) {
  // 一整个生涯：从零开始，跑一场买一次车
  G.Game.money = 0; G.Game.owned = [true, false, false, false]; G.Game.bike = 0;
  for (let t = 0; t < 5; t++) {
    shop();
    const bike = G.BIKES[G.Game.bike], purse = G.Game.money;
    G.startRace(t);
    let f = 0;
    while (G.Game.state === 'pre' && f < 400) { step(G, { hold: ['arrowup'] }); f++; }
    const t0 = f;
    let maxSpd = 0, offroad = 0, air = 0, rivalDown = 0, wasDown = G.Rivals.map(() => false);
    while (G.Game.state === 'race' && f - t0 < 60 * 300) {   // 五分钟还没冲线就算卡住
      step(G, think());
      f++;
      maxSpd = Math.max(maxSpd, P.speed);
      if (Math.abs(P.x) > 1) offroad++;
      if (P.airTime > 0) air++;
      G.Rivals.forEach((r, k) => { const d = r.state === 'down'; if (d && !wasDown[k]) rivalDown++; wasDown[k] = d; });
      if (f % 30 === 0) sanity(G, '第' + (t + 1) + '场 帧' + f);
    }
    const done = G.Game.state === 'results';
    const n = Math.max(1, f - t0);
    const line = {
      track: G.Road.name, bike: bike.nm, ok: done, rank: P.rank, time: G.Game.time,
      crashes: G.Game.crashes, hits: G.Game.hits, kills: G.Game.takedowns,
      maxKmh: Math.round(maxSpd / 60), offPct: Math.round(offroad / n * 100),
      airPct: Math.round(air / n * 100), money: G.Game.money, paid: G.Game.money - purse, rivalDown,
      km: (G.Road.finishZ / G.UNITS_PER_KM).toFixed(2),
    };
    board.push(line);
    console.log(
      (done ? '\u2713' : '\u2717') + ' ' + line.track.padEnd(5, '\u3000') +
      ' [' + line.bike.padEnd(6, '\u3000') + ']' +
      ' 第' + line.rank + '名' +
      '  ' + line.time.toFixed(1) + 's / ' + line.km + 'km' +
      '  极速 ' + line.maxKmh +
      '  命中 ' + line.hits + ' 撂倒 ' + line.kills + ' 摔 ' + line.crashes +
      '  出界 ' + line.offPct + '%  腾空 ' + line.airPct + '%  对手翻 ' + line.rivalDown +
      '  +$' + line.paid + ' → $' + line.money);
    if (!done) console.log('   \u2191 没跑完，state=' + G.Game.state);
  }
}


/* ---------------------------------------------------------------------------
   台架测试：把战斗机制单独架起来量一遍，不受机器人水平影响。
   --------------------------------------------------------------------------- */
function bench() {
  console.log('\n──── 台架 ────');
  let bad = 0;
  const say = (ok, msg) => { console.log((ok ? '  \u2713 ' : '  \u2717 ') + msg); if (!ok) bad++; };

  // 1. 徒手能不能把人踹下车，几下
  G.startRace(0);
  while (G.Game.state === 'pre') step(G, {});
  const r = G.Rivals[0];
  let kicks = 0;
  for (let i = 0; i < 60 * 12 && r.state === 'ride'; i++) {
    r.z = P.z + 200; r.x = P.x + .2; r.speed = P.speed;   // 按住不让他跑
    const before = r.hp;
    step(G, { atkR: true });
    if (r.hp < before) kicks++;
  }
  say(r.state === 'down', '徒手踹得下车');
  say(kicks >= 3 && kicks <= 9, '需要 3～9 下（实际 ' + kicks + ' 下）');

  // 2. 被打下车的人会掉武器，掉的武器捡得起来
  G.startRace(0);
  while (G.Game.state === 'pre') step(G, {});
  const r2 = G.Rivals[1]; r2.wep = 2; r2.hp = 20;
  for (let i = 0; i < 40 && r2.state === 'ride'; i++) { r2.z = P.z + 200; r2.x = P.x + .2; step(G, { atkR: true }); }
  say(G.Pickups.length > 0, '撂倒持械的人会掉武器');
  if (G.Pickups.length) {
    const pk = G.Pickups[0];
    for (let i = 0; i < 60 * 3 && G.Pickups.length; i++) { pk.z = P.z + 300; pk.x = P.x; step(G, {}); }
    say(P.wep === 2, '骑过去能捡起来（当前 ' + G.WEPS[P.wep].nm + '）');
  } else { say(false, '没得捡'); }

  // 3. 铁链打得比徒手快
  const dmg = G.WEPS.map(w => w.dmg / w.cd);
  say(dmg[0] < dmg[1] && dmg[1] < dmg[2], '徒手 < 木棍 < 铁链（每秒伤害 ' + dmg.map(d => d.toFixed(0)).join(' / ') + '）');
  say(G.WEPS[0].reach < G.WEPS[2].reach, '武器越好够得越远');

  // 4. 摔了必须能重新骑上，而且不能卡在路上
  G.startRace(0);
  while (G.Game.state === 'pre') step(G, {});
  for (let i = 0; i < 200; i++) step(G, { hold: ['arrowup'] });
  P.x = .8; G.wipeout(P, '台架');
  let back = -1;
  for (let i = 0; i < 60 * 15; i++) {
    step(G, { hold: ['arrowup', 'arrowright'] });        // 故意一直往反方向跑
    if (P.state === 'ride') { back = i / 60; break; }
  }
  say(back > 0, '摔车之后一定能重新骑上（用了 ' + (back > 0 ? back.toFixed(1) + 's' : '再也没上去') + '）');
  say(back > 1.5 && back < 8, '重新上车耗时在 1.5～8 秒之间');

  // 5. 警察：贴住会被抓，把他打翻就能脱身
  G.startRace(4);
  while (G.Game.state === 'pre') step(G, {});
  for (let i = 0; i < 60 * 4; i++) step(G, { hold: ['arrowup'] });
  G.Game.crashes = 5;                                     // 逼他出场
  for (let i = 0; i < 60 * 3 && !G.Cop; i++) step(G, { hold: ['arrowup'] });
  say(!!G.Cop, '够条件时警察会出现');
  if (G.Cop) {
    const cop = G.Cop;
    G.Traffic.length = 0;                                // 单独量抓捕，别让路上的车和路障来搅局
    for (const sg of G.Road.segs) for (const it of sg.sprites) it.hazard = false;
    let busted = 0;
    for (let i = 0; i < 60 * 16; i++) {
      cop.z = P.z - 400; cop.x = P.x;                     // 死死贴住，不还手
      step(G, { hold: ['arrowup'] });
      if (G.Game.state === 'busted') { busted = i / 60; break; }
    }
    say(busted > 0, '不还手就会被拷走（' + (busted > 0 ? busted.toFixed(1) + 's' : '一直没抓到') + '）');
    say(busted > 2.5, '但不是贴上来就完 —— 有反应时间');
    G.startRace(4);
    while (G.Game.state === 'pre') step(G, {});
    G.Game.crashes = 5;
    for (let i = 0; i < 60 * 3 && !G.Cop; i++) step(G, { hold: ['arrowup'] });
    const cop2 = G.Cop; let downed = false;
    for (let i = 0; i < 60 * 20 && cop2; i++) {
      cop2.z = P.z + 200; cop2.x = P.x + .2;
      step(G, { hold: ['arrowup'], atkR: true });
      if (cop2.state === 'down') { downed = true; break; }
    }
    say(downed, '抡得翻警察（他不是无敌的）');
  }
  /* 13. 躲得掉吗：对向车第一次出现在屏幕上时，离撞上还剩多少时间。
     急弯会把路面横着推出画面，车是从画面外冒出来的；如果剩余时间比一次变道
     还短，那不是难，是没法躲。两个数一起卡：最险的一次，和"来不及"的次数。 */
  const laneT = (() => {                        // 满速拨过一条道要多久（.42 是相邻车道间距）
    G.Game.owned = [true,true,true,true]; G.Game.bike = 3;
    G.startRace(0);
    while (G.Game.state === 'pre') step(G, { hold:['arrowup'] });
    const sg = G.Road.segs;
    let i = 60; while (i < sg.length - 200 && Math.abs(sg[i].curve) > .1) i++;
    P.z = sg[i].p1.z; P.y = P.lastGroundY = sg[i].p1.y; P.vy = 0; P.airTime = 0;
    P.x = -.21; P.steer = 0;
    let t = 0;
    while (t < 4) { P.speed = P.maxSpeed; step(G, { hold:['arrowup','arrowright'] }); t += 1/60; if (P.x >= .21) break; }
    return t;
  })();
  /* 换向要多久画面才肯反过来。躲车基本都是"正往左走，突然要往右"，慢在这一下。
     相机的一阶滞后有个正比于横向速度的稳态误差，换向时得先"走完"它画面才反向 ——
     车 0.03s 就往回走了，画面却要 0.22s，手感上就是打了方向没反应。前馈修掉之后
     应该是一帧的事；这条卡住，免得以后动相机跟随时又把它带回来。 */
  const flipT = (() => {
    G.Game.owned = [true,true,true,true]; G.Game.bike = 3;
    G.startRace(0);
    while (G.Game.state === 'pre') step(G, { hold:['arrowup'] });
    const sg = G.Road.segs;
    let i = 60; while (i < sg.length - 200 && Math.abs(sg[i].curve) > .1) i++;
    P.z = sg[i].p1.z; P.y = P.lastGroundY = sg[i].p1.y; P.vy = 0; P.airTime = 0;
    P.x = .9; P.steer = 0; G.Cam.x = .9;
    for (let f = 0; f < 40; f++) { P.speed = P.maxSpeed; step(G, { hold:['arrowup','arrowleft'] }); }
    let t = 0;
    while (t < 1) {
      P.speed = P.maxSpeed;
      const cb = G.Cam.x;
      step(G, { hold:['arrowup','arrowright'] }); t += 1/60;
      if (G.Cam.x > cb) break;
    }
    return t;
  })();
  say(flipT < .06, '反打之后画面立刻跟着反（' + flipT.toFixed(3) + 's）');

  const warn = [];
  for (let t = 0; t < 5; t++) {
    G.Game.bike = 3; G.startRace(t);
    while (G.Game.state === 'pre') step(G, { hold:['arrowup'] });
    const seen = new Set();
    for (let f = 0; f < 30 * 60; f++) {
      P.speed = P.maxSpeed; P.x = 0;
      step(G, { hold:['arrowup'] }); G.render();
      for (const c of G.Traffic) {
        if (!c.oncoming) continue;
        const rel = c.z - P.z;
        if (rel < 0) { seen.delete(c); continue; }
        const sg = G.segAt(c.z);
        if (sg.clip === 0 || !sg.p1 || sg.p1.sx == null) continue;
        const sx = sg.p1.sx + sg.p1.sw * c.x;
        if (sx > 0 && sx < G.W && !seen.has(c)) { seen.add(c); warn.push(rel / (P.speed - c.speed)); }
      }
    }
  }
  warn.sort((a, b) => a - b);
  const tight = warn.filter(v => v < laneT * 1.5).length;
  say(warn[0] > laneT, '最险的一次也还够变一次道（' + warn[0].toFixed(2) + 's vs 变道 ' + laneT.toFixed(2) + 's）');
  say(tight / warn.length < .06, '来不及躲的不到 6%（' + tight + '/' + warn.length + '）');
  G.Game.owned = [true, false, false, false]; G.Game.bike = 0;

  return bad;
}

/* ---- 难度曲线体检 ---- */
let bad = 0;
const say = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) bad++; };
console.log('\n──── 体检 ────');
const finished = board.filter(b => b.ok);
say(finished.length === board.length, '每场都能跑到终点（' + finished.length + '/' + board.length + '）');
const times = board.map(b => b.time);
say(Math.min(...times) > 40, '最快一场不短于 40 秒（实际 ' + Math.min(...times).toFixed(0) + 's）');
say(Math.max(...times) < 260, '最慢一场不长于 260 秒（实际 ' + Math.max(...times).toFixed(0) + 's）');
say(board.every(b => b.maxKmh > 120), '每场都能跑上 120km/h');
say(board.every(b => b.offPct < 35), '出界时间不超过 35%（最多 ' + Math.max(...board.map(b => b.offPct)) + '%）');
const ranks = board.map(b => b.rank);
say(Math.min(...ranks) <= 4, '笨机器人至少有一场能进前四（最好 第' + Math.min(...ranks) + '名）');
say(Math.max(...ranks) >= 2, '最后一条街不该被机器人轻松通吃（最差 第' + Math.max(...ranks) + '名）');
/* 跑砸了也得有进项。这一条一旦破了，垫底的人就换不了车、于是永远垫底 —— 死角，不是难度 */
say(board.every(b => b.paid > 0), '每一场完赛都有钱拿（最少 $' + Math.min(...board.map(b => b.paid)) + '）');
say(board.some(b => b.hits > 0), '打得到人（共命中 ' + board.reduce((a, b) => a + b.hits, 0) + ' 次）');
const air = board.map(b => b.airPct);
say(Math.max(...air) >= 2, '路上有能飞起来的地方（最高腾空 ' + Math.max(...air) + '%）');
say(Math.max(...air) <= 14, '但不能半程都在天上（最高腾空 ' + Math.max(...air) + '%）');
say(board.every(b => +b.km > 3.2), '每条街都不短于 3.2km（最短 ' + Math.min(...board.map(b => +b.km)).toFixed(2) + 'km）');

bad += bench();
process.exit(bad ? 1 : 0);
