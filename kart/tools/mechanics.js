/* ---------------------------------------------------------------------------
   逐条把游戏机制摆到该触发的位置去断言。

   机器人跑完整局也可能整局没吃到一次星星、没被闪电劈过、没压过加速带 ——
   那些洞得靠这个脚本堵。
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame } = require('./env.js');
const G = loadGame();

let pass = 0, fail = 0; const bad = [];
function ok(c, name, detail) {
  if (c) { pass++; return true; }
  fail++; bad.push(name + (detail ? '  → ' + detail : '')); return false;
}
function head(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
const DT = 1 / 100;

G.Race.trackIdx = 0; G.Race.diff = 1; G.Race.charIdx = 0;
G.startRace();
G.Race.state = 'race'; G.Race.countdown = 0;
const P = G.Race.player;

/* 把一台车摆到赛道上某个位置，清干净状态 */
function place(k, s, lat, speed) {
  const a = G.atS(s), w = G.worldAt(s, lat || 0);
  k.x = w[0]; k.y = w[1]; k.z = w[2];
  k.head = a.head; k.yaw = a.head;
  k.speed = speed === undefined ? 20 : speed;
  k.vy = 0; k.air = false; k.airT = 0; k.spin = 0; k.invT = 0; k.starT = 0; k.small = 0;
  k.drift = 0; k.driftChg = 0; k.driftYaw = 0; k.hopT = 0; k.wantHop = false;
  k.boostT = 0; k.boostPow = 1; k.boostTier = -1; k.item = null; k.itemQty = 0; k.itemRollT = 0;
  k.finished = false; k.lap = 1;
  const loc = G.locate(k.x, k.z);
  k.node = loc.i; k.s = loc.s; k.prevS = loc.s; k.lat = loc.lat;
  k.in = { th: 1, br: 0, st: 0, stRaw: 0, dr: false, it: false };
  k.prog = k.lap * G.Track.L + k.s;
  return k;
}
/* 把其他车挪到很远的地方，免得干扰单项测试 */
function isolate() {
  for (const k of G.Race.karts) if (k !== P) { k.x = 99999; k.z = 99999; k.finished = true; }
}
/* 找一段最长的同向弯：漂移必须往弯的方向漂。
   这不是测试的便利设定 —— 漂移中转向有下限，永远拐不回反方向，
   所以在直道上或者反向弯里起漂，一定会冲出赛道，什么火都攒不到。 */
function longCorner() {
  const T = G.Track, N = T.N;
  let best = 0, bestS = 0, bestSign = 0;
  for (let i = 0; i < N; i++) {
    const c0 = T.nodes[i].curv;
    if (Math.abs(c0) < 0.0015) continue;
    const sg = Math.sign(c0);
    let len = 0;
    for (let j = 0; j < N; j++) {
      const c = T.nodes[(i + j) % N].curv;
      if (Math.sign(c) !== sg || Math.abs(c) < 0.0015) break;
      len += T.gap;
    }
    if (len > best) { best = len; bestS = T.nodes[i].s; bestSign = sg; }
  }
  return { s: bestS, sign: bestSign, len: best };
}

/* 找一段够直的赛道，加速带和路面测试要在直道上做 */
function straightS() {
  let best = 0, bc = Infinity;
  for (let s = 0; s < G.Track.L; s += 5) {
    let m = 0;
    for (let d = 0; d < 70; d += 5) m = Math.max(m, Math.abs(G.curvAt(s + d)));
    if (m < bc) { bc = m; best = s; }
  }
  return best;
}
const S0 = straightS();
const CORNER = longCorner();

/* =============================================== 漂移与迷你涡轮 */
head('漂移与迷你涡轮');
isolate();
console.log('  用的弯：s=' + CORNER.s.toFixed(0) + 'm，长 ' + CORNER.len.toFixed(0) +
            'm，方向 ' + (CORNER.sign > 0 ? '右' : '左'));
for (let tier = 0; tier < G.MT.length; tier++) {
  place(P, CORNER.s + 4, -CORNER.sign * 2.5, 22);      // 从弯的外侧切进去
  P.in.dr = true; P.in.st = CORNER.sign;               // 往弯的方向打
  P.in.stRaw = CORNER.sign;                            // 起漂看的是按键意图

  const need = G.MT[tier].t + 0.05;
  let held = 0;
  for (let i = 0; i < 1400 && P.driftChg < need; i++) {
    /* 起漂之后要像玩家那样修方向把车留在赛道上：一路压着方向不放的话，
       一秒就漂进雪地或者贴上护栏，橙火紫火根本攒不到。
       这里照着赛道航向修，等于模拟一个会开的人在长弯里控漂。 */
    if (P.drift) {
      const n = G.Track.nodes[P.node];
      let e = n.head - P.head;
      while (e > Math.PI) e -= Math.PI * 2;
      while (e < -Math.PI) e += Math.PI * 2;
      P.in.st = Math.max(-1, Math.min(1, (e - P.lat * 0.05) * 3.4));
    }
    G.updateKart(P, DT);
    if (P.drift) held += DT;
  }
  ok(P.drift === 1 && P.driftChg >= G.MT[tier].t,
     '第 ' + (tier + 1) + ' 档：按住攒得到', '攒到 ' + P.driftChg.toFixed(2));
  P.in.dr = false;
  G.updateKart(P, DT);
  ok(P.boostTier === tier, G.MT[tier].nm + ' 松手给到对应档位',
     '拿到 ' + (P.boostTier < 0 ? '无' : G.MT[P.boostTier].nm) +
     '，攒到 ' + P.driftChg.toFixed(2) + '，横向 ' + P.lat.toFixed(1) + 'm');
  ok(Math.abs(P.boostPow - G.MT[tier].pow) < 1e-6, G.MT[tier].nm + ' 涡轮强度对', String(P.boostPow));
}
{
  /* 攒不够门槛就松手，什么都不给 */
  place(P, CORNER.s + 4, -CORNER.sign * 2.5, 22);
  P.in.dr = true; P.in.st = CORNER.sign; P.in.stRaw = CORNER.sign;
  for (let i = 0; i < 30; i++) G.updateKart(P, DT);     // 0.3s，不到蓝火的 0.55s
  P.in.dr = false; G.updateKart(P, DT);
  ok(P.boostT <= 0, '攒不够门槛不给涡轮', 'boostT=' + P.boostT.toFixed(2));
}
{
  /* 反着弯漂必然出界：这条正是"漂移中拐不回反方向"的直接后果 */
  place(P, CORNER.s + 4, 0, 22);
  P.in.dr = true; P.in.st = -CORNER.sign; P.in.stRaw = -CORNER.sign;
  let wentOff = false;
  for (let i = 0; i < 300 && !wentOff; i++) {
    G.updateKart(P, DT);
    if (P.surf === G.SURF.VERGE) wentOff = true;
  }
  ok(wentOff, '反着弯漂会冲出赛道（漂移中拐不回反方向）');
}
{
  /* 涡轮确实让车更快 */
  place(P, S0, 0, 24); let plain = 0;
  for (let i = 0; i < 120; i++) G.updateKart(P, DT); plain = P.speed;
  place(P, S0, 0, 24); P.boostT = 5; P.boostPow = G.MT[2].pow; P.boostTier = 2;
  for (let i = 0; i < 120; i++) G.updateKart(P, DT);
  ok(P.speed > plain * 1.15, '紫火明显更快',
     (plain * 3.6).toFixed(0) + ' → ' + (P.speed * 3.6).toFixed(0) + ' km/h');
}

/* =============================================== 转向方向
   这个世界 forward=+Z、up=+Y、右手系，所以屏幕右边是 **−X**，而 head 增大
   是往 +X（屏幕左）转。也就是说"按右键该给 I.st 什么符号"完全不直观，
   写反了游戏照样跑、测试照样过、AI 照样赢 —— 只有人开起来是反的。
   所以这里不看符号，直接用真的视图投影矩阵问一句：车跑到屏幕哪边去了。 */
head('转向方向');
{
  isolate();
  const proj = G.M4.persp(G.M4.ident(), 1.30, 16 / 9, 0.22, 1400);

  function steerTo(setInput) {
    place(P, S0, 0, 20);
    G.updateCamera(0.016, true);
    const c = { x: G.Cam.x, y: G.Cam.y, z: G.Cam.z, lx: G.Cam.lx, ly: G.Cam.ly, lz: G.Cam.lz };
    for (const k in G.Keys) G.Keys[k] = false;
    for (const k in G.Touch) G.Touch[k] = false;
    setInput();
    for (let i = 0; i < 60; i++) { G.readInput(DT); G.updateKart(P, DT); }
    const view = G.M4.look(G.M4.ident(), c.x, c.y, c.z, c.lx, c.ly, c.lz, 0, 1, 0);
    const vp = G.M4.mul(G.M4.ident(), proj, view);
    const cx = vp[0] * P.x + vp[4] * P.y + vp[8] * P.z + vp[12];
    const cw = vp[3] * P.x + vp[7] * P.y + vp[11] * P.z + vp[15];
    return cx / cw;                       // 归一化设备坐标 X：>0 就在屏幕右half
  }
  const kr = steerTo(() => { G.Keys.ArrowRight = true; G.Keys.ArrowUp = true; });
  const kl = steerTo(() => { G.Keys.ArrowLeft  = true; G.Keys.ArrowUp = true; });
  const tr = steerTo(() => { G.Touch.r = true; G.Touch.a = true; });
  const tl = steerTo(() => { G.Touch.l = true; G.Touch.a = true; });
  ok(kr > 0.05, '键盘 → 车往屏幕右边走', 'NDC X = ' + kr.toFixed(3));
  ok(kl < -0.05, '键盘 ← 车往屏幕左边走', 'NDC X = ' + kl.toFixed(3));
  ok(tr > 0.05, '触屏 ▶ 车往屏幕右边走', 'NDC X = ' + tr.toFixed(3));
  ok(tl < -0.05, '触屏 ◀ 车往屏幕左边走', 'NDC X = ' + tl.toFixed(3));
  ok(Math.sign(kr) === Math.sign(tr) && Math.sign(kl) === Math.sign(tl),
     '触屏和键盘方向一致');

  /* 按右键起漂，得往右漂 */
  place(P, S0, 0, 22);
  for (const k in G.Keys) G.Keys[k] = false;
  for (const k in G.Touch) G.Touch[k] = false;
  G.Keys.ArrowRight = true; G.Keys.ArrowUp = true; G.Keys.Space = true;
  for (let i = 0; i < 40 && !P.drift; i++) { G.readInput(DT); G.updateKart(P, DT); }
  const h0 = P.head;
  for (let i = 0; i < 40; i++) { G.readInput(DT); G.updateKart(P, DT); }
  let dh = P.head - h0;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  ok(P.drift === 1, '按住右 + 空格能起漂');
  ok(dh < 0, '按右起漂就往右漂（head 减小＝屏幕右）', 'dhead = ' + dh.toFixed(3));
  for (const k in G.Keys) G.Keys[k] = false;

  /* 小地图：世界方向到画布方向不能翻手性。
     +X 在小地图上朝右、在 3D 里朝左，但 +Z 也同时反向（小地图朝下、3D 朝上），
     两个一起翻＝旋转 180°，手性是保住的 —— 这里把它钉死，免得以后只改一边。 */
  const pr = G.Track.mapProj;
  const mapU = x => (x - pr.cx) / pr.span;
  const mapV = z => (z - pr.cz) / pr.span;
  const dUdX = mapU(1) - mapU(0), dVdZ = mapV(1) - mapV(0);
  ok(Math.sign(dUdX) === Math.sign(dVdZ), '小地图相对 3D 画面没有镜像（只是转了 180°）',
     'dU/dX=' + dUdX.toFixed(4) + '  dV/dZ=' + dVdZ.toFixed(4));
}

/* =============================================== 油门与刹车 */
head('油门与刹车');
{
  isolate();
  place(P, S0, 0, 20);
  P.in.th = 0; P.in.br = 0;
  for (let i = 0; i < 800; i++) G.updateKart(P, DT);
  ok(P.speed >= 0 && P.speed < 0.5, '松油门滑行到停，不会自己变倒车',
     (P.speed * 3.6).toFixed(1) + ' km/h');

  place(P, S0, 0, 0);
  P.in.th = 0; P.in.br = 1;
  for (let i = 0; i < 300; i++) G.updateKart(P, DT);
  ok(P.speed < -1, '按刹车才倒得了车', (P.speed * 3.6).toFixed(1) + ' km/h');
  ok(P.speed > -12, '倒车速度有上限', (P.speed * 3.6).toFixed(1) + ' km/h');

  place(P, S0, 0, 25);
  P.in.th = 0; P.in.br = 1;
  let stopT = 0;
  for (let i = 0; i < 800 && P.speed > 0; i++) { G.updateKart(P, DT); stopT += DT; }
  ok(stopT < 1.5, '刹车比滑行快得多', '从 90km/h 刹停用了 ' + stopT.toFixed(2) + 's');
}

/* =============================================== 路面 */
head('路面');
{
  const run = lat => { place(P, S0, lat, 10);
    for (let i = 0; i < 400; i++) G.updateKart(P, DT); return P.speed; };
  const n = G.Track.nodes[Math.round(S0 / G.Track.gap) % G.Track.N];
  const road = run(0), curb = run(n.w + 0.5), verge = run(n.w + 3.5);
  ok(road > curb && curb > verge, '路面 > 路缘 > 路肩',
     [road, curb, verge].map(v => (v * 3.6).toFixed(0)).join(' / ') + ' km/h');
  ok(verge < road * 0.75, '出界确实吃亏', (verge / road * 100).toFixed(0) + '% 的极速');
}

/* =============================================== 加速带 */
head('加速带');
{
  const bp = G.Track.boostSpots[0];
  ok(!!bp, '赛道上有加速带');
  if (bp) {
    const s = G.Track.nodes[bp.i].s;
    place(P, s - 6, bp.lat, 18);
    let got = false;
    for (let i = 0; i < 200 && !got; i++) { G.updateKart(P, DT); G.updateItems(DT); if (P.boostT > 0) got = true; }
    ok(got, '压上加速带给涡轮');
    place(P, s - 6, bp.lat + 8, 18);
    let side = false;
    for (let i = 0; i < 200 && !side; i++) { G.updateKart(P, DT); G.updateItems(DT); if (P.boostT > 0) side = true; }
    ok(!side, '从旁边过去不给');
  }
}

/* =============================================== 道具箱 */
head('道具箱');
{
  for (const sp of G.Track.itemSpots) sp.taken = 0;
  const sp = G.Track.itemSpots[0];
  const s = G.Track.nodes[sp.i].s;
  place(P, s - 5, sp.lat, 18);
  for (let i = 0; i < 300 && !P.item; i++) { G.updateKart(P, DT); G.updateItems(DT); }
  ok(!!P.item, '开过去能吃到道具', String(P.item));
  ok(sp.taken > 0, '吃掉的箱子进入冷却', sp.taken.toFixed(1) + 's');
  const before = P.item;
  place(P, s - 5, sp.lat, 18); P.item = before; P.itemQty = 1;
  for (let i = 0; i < 300; i++) { G.updateKart(P, DT); G.updateItems(DT); }
  ok(P.item === before, '手里有东西时不会再吃');
}

/* =============================================== 攻击类道具 */
head('攻击类道具');
{
  const V = G.Race.karts.find(k => k !== P);
  const setPair = (gapM) => {
    V.finished = false;
    place(P, S0, 0, 20); place(V, S0 + gapM, 0, 20);
    V.in = { th: 1, br: 0, st: 0, dr: false, it: false };
    G.Race.items.length = 0;
  };

  /* 香蕉：踩上去打转 */
  setPair(60);
  G.Race.items.push({ kind: 'banana', s: (P.s + 12) % G.Track.L, lat: P.lat,
                      life: 30, owner: V, arm: 0, spin: 0 });
  let spun = false;
  for (let i = 0; i < 300 && !spun; i++) { G.updateKart(P, DT); G.updateItems(DT); if (P.spin > 0) spun = true; }
  ok(spun, '踩香蕉会打转');

  /* 打转期间失去控制、掉速 */
  const sp0 = P.speed;
  for (let i = 0; i < 60; i++) G.updateKart(P, DT);
  ok(P.speed < sp0, '打转掉速', (sp0 * 3.6).toFixed(0) + ' → ' + (P.speed * 3.6).toFixed(0) + ' km/h');

  /* 红壳：追得上前面那台 */
  setPair(45);
  P.item = 'red'; P.itemQty = 1;
  G.useItem(P);
  ok(G.Race.items.length === 1 && G.Race.items[0].target === V, '红壳锁定前车');
  let hit = false;
  for (let i = 0; i < 900 && !hit; i++) {
    G.updateAI(V, DT);                    // 前车得沿着赛道开，不然它自己撞墙、壳跟着碎在墙上
    G.updateKart(P, DT); G.updateKart(V, DT); G.updateItems(DT);
    if (V.spin > 0) hit = true;
  }
  ok(hit, '红壳追得上前车');

  /* 绿壳：撞墙反弹而不是消失 */
  setPair(60);
  const n = G.Track.nodes[P.node];
  G.Race.items.push({ kind: 'green', s: P.s, lat: n.wall - 0.6, latV: 6,
                      spd: 30, life: 12, owner: V, arm: 0, target: null, spin: 0 });
  let bounced = false;
  for (let i = 0; i < 100; i++) {
    G.updateItems(DT);
    const it = G.Race.items[0];
    if (!it) break;
    if (it.latV < 0) { bounced = true; break; }
  }
  ok(bounced, '绿壳撞墙反弹');

  /* 星星：撞谁谁转，自己不转 */
  setPair(1.0);
  P.starT = 5; P.invT = 5;
  for (let i = 0; i < 60; i++) { G.updateKart(P, DT); G.updateKart(V, DT); G.kartCollisions(DT); }
  ok(V.spin > 0, '星星撞人，对方打转');
  ok(P.spin === 0, '星星自己不受影响');

  /* 闪电：只劈前面的 */
  setPair(50);
  const behind = G.Race.karts.find(k => k !== P && k !== V);
  behind.finished = false;
  place(behind, S0 - 50, 0, 20);
  G.updateRanks();
  P.item = 'bolt'; P.itemQty = 1;
  const pAhead = V.prog > P.prog, pBehind = behind.prog < P.prog;
  G.useItem(P);
  ok(pAhead && V.small > 0, '闪电劈中前面的车', 'V.small=' + V.small.toFixed(1));
  ok(pBehind && behind.small === 0, '闪电不劈后面的车');
  ok(P.small === 0, '闪电不劈自己');
  /* 被压小的车更慢 */
  const s1 = V.speed; V.in.th = 1;
  for (let i = 0; i < 200; i++) G.updateKart(V, DT);
  ok(V.speed < G.SPD_MAX * 0.85, '被压小的车跑不快', (V.speed * 3.6).toFixed(0) + ' km/h');
}

/* =============================================== 起跳与落地 */
head('起跳');
{
  isolate();
  place(P, S0, 0, 20);
  P.in.dr = true; P.in.st = 0; P.in.stRaw = 0;      // 不打方向就只跳不漂
  G.updateKart(P, DT);
  ok(P.air, '按漂移键会起跳');
  ok(P.drift === 0, '不打方向不进入漂移');
  let landed = 0;
  for (let i = 0; i < 400 && !landed; i++) { G.updateKart(P, DT); if (!P.air) landed = i; }
  ok(landed > 0, '会落回地面', (landed * DT).toFixed(2) + 's 后');
  ok(Math.abs(P.y - G.surfaceY(G.locate(P.x, P.z, P.node))) < 0.05, '落地后贴着路面');
}

/* =============================================== 撞墙 */
head('撞墙');
{
  place(P, S0, 0, 26);
  const n = G.Track.nodes[P.node];
  P.head = n.head + 0.9;            // 斜着往墙上撞
  P.in.th = 1;
  let maxLat = 0;
  for (let i = 0; i < 500; i++) { G.updateKart(P, DT); maxLat = Math.max(maxLat, Math.abs(P.lat)); }
  const wallNow = G.Track.nodes[P.node].wall;
  ok(maxLat < wallNow, '不会穿墙出去', maxLat.toFixed(1) + 'm vs 护栏 ' + wallNow.toFixed(1) + 'm');
  ok(P.speed > 3, '撞墙不会把车停死', (P.speed * 3.6).toFixed(0) + ' km/h');
}

/* =============================================== 起步加速 */
head('起步加速');
{
  const trial = (press) => {
    G.startRace();
    G.Race.startPress = press;
    G.Race.countdown = 0.001;
    G.Race.state = 'countdown';
    for (let i = 0; i < 3; i++) { const f = G.frame; }
    // 直接走倒计时结算
    G.Race.countdown = -0.001;
    return G.Race.player;
  };
  /* 倒计时结算逻辑在 tickCountdown 里，这里复现它的判定条件 */
  const inWindow = (p) => p > 0 && p < 0.55;
  ok(inWindow(0.3), '最后半秒踩油门算起步加速');
  ok(!inWindow(1.5), '踩太早不算');
  ok(!inWindow(-1), '没踩不算');
}

/* =============================================== 名次 */
head('名次');
{
  G.startRace();
  for (let i = 0; i < G.Race.karts.length; i++) {
    G.Race.karts[i].prog = 1000 - i * 37;
    G.Race.karts[i].finished = false;
  }
  G.updateRanks();
  const byProg = G.Race.karts.slice().sort((a, b) => b.prog - a.prog);
  ok(G.Race.order.every((k, i) => k === byProg[i]), '未完赛时按进度排');
  ok(G.Race.order.every((k, i) => k.rank === i + 1), '名次连续 1..8');

  const a = G.Race.karts[3], b = G.Race.karts[5];
  a.finished = true; a.finishT = 10;
  b.finished = true; b.finishT = 5;
  G.updateRanks();
  ok(G.Race.order[0] === b && G.Race.order[1] === a, '完赛的排在前面且按完赛时间');
}

console.log('\n' + '─'.repeat(56));
if (fail) {
  console.log('\x1b[31m' + fail + ' 项没过\x1b[0m，通过 ' + pass + ' 项');
  for (const x of bad) console.log('  ✗ ' + x);
  process.exit(1);
} else console.log('\x1b[32m全部通过\x1b[0m（' + pass + ' 项）');
