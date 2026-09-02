/* ---------------------------------------------------------------------------
   全部检查。退出码非 0 表示有测试没过，可以直接挂 CI。
   --------------------------------------------------------------------------- */
'use strict';
const { loadGame } = require('./env.js');

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, detail) {
  if (cond) { pass++; return true; }
  fail++; bad.push(name + (detail ? '  → ' + detail : ''));
  return false;
}
function head(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
function finite(...v) { return v.every(x => typeof x === 'number' && Number.isFinite(x)); }

const G = loadGame();

/* ======================================================= 1. 赛道生成 */
head('赛道生成');
for (let ti = 0; ti < G.TRACKS.length; ti++) {
  const def = G.TRACKS[ti];
  G.buildTrack(def);
  const T = G.Track, N = T.N, nodes = T.nodes;
  const tag = def.name;

  ok(N > 200, tag + ' 节点数够', 'N=' + N);
  ok(finite(T.L) && T.L > 600 && T.L < 4000, tag + ' 周长合理', T.L.toFixed(1) + 'm');

  let nan = 0, gapErr = 0, maxGapErr = 0;
  for (let i = 0; i < N; i++) {
    const n = nodes[i], m = nodes[(i + 1) % N];
    if (!finite(n.x, n.y, n.z, n.head, n.curv, n.bank, n.w, n.wall, n.ex, n.ey, n.ez)) nan++;
    const d = Math.hypot(m.x - n.x, m.y - n.y, m.z - n.z);
    const e = Math.abs(d - T.gap) / T.gap;
    if (e > 0.06) gapErr++;
    maxGapErr = Math.max(maxGapErr, e);
  }
  ok(nan === 0, tag + ' 节点无 NaN', nan + ' 个');
  /* 等距重采样是 AI 前瞻、碰撞查找、圈数进度的共同前提，必须真的等距 */
  ok(gapErr === 0, tag + ' 节点等距', gapErr + ' 段超差，最大 ' + (maxGapErr * 100).toFixed(2) + '%');

  /* 闭合：首尾必须接得上，包括高度和航向 */
  const a = nodes[0], b = nodes[N - 1];
  const closeD = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  ok(closeD < T.gap * 1.5, tag + ' 首尾闭合', closeD.toFixed(3) + 'm');
  let dh = Math.abs(a.head - b.head) % (Math.PI * 2);
  if (dh > Math.PI) dh = Math.PI * 2 - dh;
  ok(dh < 0.25, tag + ' 首尾航向连续', dh.toFixed(4) + ' rad');

  /* 不折叠：转弯半径必须大于横截面半宽，否则挤出的路肩会在弯内侧翻过来 */
  let minR = Infinity, minRWall = 0;
  for (const n of nodes) {
    const c = Math.abs(n.curv);
    const r = c > 1e-6 ? 1 / c : Infinity;
    if (r < minR) { minR = r; minRWall = n.wall; }
  }
  ok(minR > minRWall * 1.3, tag + ' 弯不会把路肩折过来',
     '最小半径 ' + minR.toFixed(1) + 'm vs 半宽 ' + minRWall.toFixed(1) + 'm');
  /* 有真正的弯可开：半径太大就是条大圆，全程不用松油门 */
  ok(minR < 95, tag + ' 有真正需要减速的弯', '最小半径 ' + minR.toFixed(1) + 'm');

  /* 不自交：沿赛道隔得够远的两处，空间上必须分得开。
     注意环形要按两个方向取最短的那个弧长，不然首尾附近会被误判。 */
  let cross = 0, minSep = Infinity;
  const skip = Math.ceil(240 / T.gap);
  for (let i = 0; i < N; i += 2) {
    for (let j = i + 2; j < N; j += 2) {
      const arc = Math.min(j - i, N - (j - i));
      if (arc < skip) continue;
      const p = nodes[i], q = nodes[j];
      const d = Math.hypot(p.x - q.x, p.z - q.z) - (p.wall + q.wall);
      if (d < 0) cross++;
      if (d < minSep) minSep = d;
    }
  }
  ok(cross === 0, tag + ' 赛道不自交', cross + ' 处重叠，最小余量 ' + minSep.toFixed(1) + 'm');

  /* 侧倾不能翻过来 */
  const maxBank = Math.max(...nodes.map(n => Math.abs(n.bank)));
  ok(maxBank < 0.35, tag + ' 侧倾在范围内', maxBank.toFixed(3) + ' rad');
}

/* ======================================================= 2. 位置查询 */
head('位置查询');
G.buildTrack(G.TRACKS[0]);
{
  const T = G.Track;
  let worst = 0, worstLat = 0;
  for (let t = 0; t < 400; t++) {
    const s = Math.random() * T.L;
    const lat = (Math.random() - 0.5) * 12;
    const w = G.worldAt(s, lat);
    if (!finite(w[0], w[1], w[2])) { worst = 1e9; break; }
    const loc = G.locate(w[0], w[2]);
    let ds = Math.abs(G.sDist(s, loc.s));
    worst = Math.max(worst, ds);
    worstLat = Math.max(worstLat, Math.abs(loc.lat - lat));
  }
  /* worldAt 出去、locate 回来，必须落回原处 —— 圈数进度全靠这条闭环 */
  ok(worst < 1.2, 'worldAt → locate 弧长往返一致', '最大偏差 ' + worst.toFixed(3) + 'm');
  ok(worstLat < 0.6, 'worldAt → locate 横向往返一致', '最大偏差 ' + worstLat.toFixed(3) + 'm');

  let ynan = 0;
  for (let t = 0; t < 300; t++) {
    const s = Math.random() * T.L, lat = (Math.random() - 0.5) * 16;
    const w = G.worldAt(s, lat);
    const y = G.surfaceY(G.locate(w[0], w[2]));
    if (!finite(y)) ynan++;
  }
  ok(ynan === 0, '路面高度无 NaN', ynan + ' 次');
}

/* ======================================================= 3. 道具抽奖 */
head('道具抽奖');
{
  const roll = (rank, n) => {
    const c = {};
    for (let i = 0; i < n; i++) { const k = G.rollItem(rank); c[k] = (c[k] || 0) + 1; }
    return c;
  };
  const first = roll(1, 4000), last = roll(8, 4000);
  ok(!first.bolt && !first.red, '第 1 名摸不到闪电和红壳',
     '闪电 ' + (first.bolt || 0) + ' 红壳 ' + (first.red || 0));
  ok((last.bolt || 0) > 400, '第 8 名摸得到闪电', (last.bolt || 0) + '/4000');
  ok((last.banana || 0) < (first.banana || 0) / 5, '香蕉主要给前排',
     '第1名 ' + first.banana + ' vs 第8名 ' + (last.banana || 0));
  let allKeys = true;
  for (const k of G.ITEM_KEYS) if (!G.ITEM_DEF[k]) allKeys = false;
  ok(allKeys, '道具表与权重表对得上');
  ok(G.ITEM_ODDS.every(r => r.length === G.ITEM_KEYS.length), '每一行权重长度正确');
}

/* ======================================================= 4. 跑完整局 */
head('整局对跑');

function runRace(G, maxSeconds, opts) {
  opts = opts || {};
  const dt = 1 / 100;
  const T = G.Track;
  /* 测难度梯度时要把道具关掉：一发红壳的运气比三档人机之间的差距还大，
     开着道具量出来的圈速纯粹是噪声。 */
  if (opts.noItems) for (const sp of T.itemSpots) sp.taken = 1e9;
  let nan = 0, off = 0, stuck = 0, t = 0;
  const speeds = [];
  G.Race.state = 'race';
  G.Race.countdown = 0;
  for (; t < maxSeconds; t += dt) {
    G.Race.time += dt;
    for (const k of G.Race.karts) {
      G.updateAI(k, dt);
      if (opts.jam) { k.in.st += (Math.random() - 0.5) * opts.jam; }
      G.updateKart(k, dt);
      if (!finite(k.x, k.y, k.z, k.speed, k.head, k.yaw, k.prog, k.lat)) nan++;
    }
    G.kartCollisions(dt);
    G.updateItems(dt);
    G.updateRanks();
    for (const k of G.Race.karts) if (!k.finished && k.lap > T.laps) G.finishKart(k);
    G.updateParts(dt);
    if (Math.random() < 0.02) {
      for (const k of G.Race.karts) {
        speeds.push(k.speed);
        if (k.surf === G.SURF.VERGE) off++;
      }
    }
    if (G.Race.karts.every(k => k.finished)) break;
  }
  return { t, nan, off, speeds, done: G.Race.karts.every(k => k.finished) };
}

for (let ti = 0; ti < G.TRACKS.length; ti++) {
  for (let d = 0; d < 3; d++) {
    G.Race.trackIdx = ti; G.Race.diff = d; G.Race.charIdx = 0;
    G.startRace();
    const T = G.Track, tag = G.TRACKS[ti].name + '/' + G.AI_SKILL[d].name;
    const r = runRace(G, 400);

    ok(r.nan === 0, tag + ' 无 NaN', r.nan + ' 次');
    ok(r.done, tag + ' 八台车都跑完了', '用了 ' + r.t.toFixed(0) + 's');
    const ranks = G.Race.order.map(k => k.rank).join(',');
    ok(ranks === '1,2,3,4,5,6,7,8', tag + ' 名次是 1..8', ranks);
    const laps = G.Race.karts.map(k => k.lap);
    ok(laps.every(l => l === T.laps + 1), tag + ' 每台车都跑满圈数', laps.join(','));

    const avg = r.speeds.reduce((a, b) => a + b, 0) / Math.max(r.speeds.length, 1);
    ok(avg > 12 && avg < G.SPD_MAX * 1.5, tag + ' 平均速度合理', (avg * 3.6).toFixed(1) + ' km/h');
    const offRate = r.off / Math.max(r.speeds.length, 1);
    ok(offRate < 0.18, tag + ' 人机基本待在赛道上', '出界占比 ' + (offRate * 100).toFixed(1) + '%');

    const lapT = [].concat(...G.Race.karts.map(k => k.lapTimes));
    ok(lapT.length === 8 * T.laps, tag + ' 圈速条数对', lapT.length + ' / ' + (8 * T.laps));
    ok(lapT.every(x => x > 8 && x < 200), tag + ' 圈速在合理区间',
       lapT.length ? Math.min(...lapT).toFixed(1) + '~' + Math.max(...lapT).toFixed(1) + 's' : '无');
  }
}

/* ======================================================= 5. 难度确实有差别 */
head('难度梯度');
{
  /* 关掉道具、三条赛道全跑，取所有圈速的平均。
     只看一条赛道或者留着道具，量到的都是运气而不是人机水平。 */
  const mean = [];
  for (let d = 0; d < 3; d++) {
    const all = [];
    for (let ti = 0; ti < G.TRACKS.length; ti++) {
      G.Race.trackIdx = ti; G.Race.diff = d; G.Race.charIdx = 0;
      G.startRace();
      runRace(G, 400, { noItems: true });
      for (const k of G.Race.karts) for (const l of k.lapTimes) all.push(l);
    }
    mean.push(all.reduce((a, b) => a + b, 0) / all.length);
  }
  const fmt = mean.map(x => x.toFixed(1) + 's').join(' / ');
  ok(mean[0] > mean[1], '标准比轻松快', fmt);
  ok(mean[1] > mean[2], '困难比标准快', fmt);
  ok(mean[0] - mean[2] > 1.0, '三档之间差得出来', '轻松比困难慢 ' + (mean[0] - mean[2]).toFixed(1) + 's');
}

/* ======================================================= 6. 乱按 */
head('乱按（fuzz）');
{
  G.Race.trackIdx = 1; G.Race.diff = 1; G.Race.charIdx = 3;
  G.startRace();
  G.Race.state = 'race';
  const p = G.Race.player;
  const dt = 1 / 100;
  let nan = 0, thrown = 0;
  for (let i = 0; i < 30000; i++) {
    try {
      if (i % 17 === 0) {
        p.in.th = Math.random() < 0.7 ? 1 : 0;
        p.in.br = Math.random() < 0.15 ? 1 : 0;
        p.in.st = (Math.random() - 0.5) * 2.4;
        p.in.dr = Math.random() < 0.45;
      }
      if (i % 231 === 0 && p.item) G.useItem(p);
      if (i % 97 === 0 && !p.item) { p.item = G.ITEM_KEYS[i % G.ITEM_KEYS.length]; p.itemQty = 1; }
      G.Race.time += dt;
      for (const k of G.Race.karts) { if (k.ai) G.updateAI(k, dt); G.updateKart(k, dt); }
      G.kartCollisions(dt); G.updateItems(dt); G.updateRanks(); G.updateParts(dt);
      for (const k of G.Race.karts) {
        if (!finite(k.x, k.y, k.z, k.speed, k.head, k.yaw, k.lat, k.prog, k.bodyRoll, k.driftYaw)) nan++;
      }
      for (const q of G.Parts) if (!finite(q.x, q.y, q.z, q.size)) nan++;
    } catch (e) { thrown++; if (thrown < 3) bad.push('fuzz 抛异常: ' + e.message); }
  }
  ok(thrown === 0, '30000 帧不抛异常', thrown + ' 次');
  ok(nan === 0, '30000 帧不出 NaN', nan + ' 次');
  ok(G.Parts.length <= 900, '粒子数没有失控', G.Parts.length + ' 个');
  ok(G.Race.items.length < 200, '道具没有堆积', G.Race.items.length + ' 个');
}

/* ======================================================= 7. 一帧渲染 */
head('渲染路径');
{
  G.Race.trackIdx = 0; G.Race.diff = 1; G.startRace();
  let thrown = 0;
  for (let i = 0; i < 5; i++) {
    try { G.updateCamera(0.016, i === 0); G.render(0.016); } catch (e) { thrown++; bad.push('render: ' + e.message); }
  }
  ok(thrown === 0, 'render() 跑得通（着色器是打桩的，GLSL 错误查不出来）');
  ok(finite(G.Cam.x, G.Cam.y, G.Cam.z, G.Cam.fov, G.Cam.yaw), '镜头参数无 NaN');
}

/* ======================================================= 汇总 */
console.log('\n' + '─'.repeat(56));
if (fail) {
  console.log('\x1b[31m' + fail + ' 项没过\x1b[0m，通过 ' + pass + ' 项');
  for (const b of bad) console.log('  ✗ ' + b);
  process.exit(1);
} else {
  console.log('\x1b[32m全部通过\x1b[0m（' + pass + ' 项）');
}
