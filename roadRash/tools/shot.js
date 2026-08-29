/* ---------------------------------------------------------------------------
   截图：用一个带抗锯齿的软件光栅化器顶掉假画布，把真正的一帧画出来存成 PNG。

   fuzz 和 playtest 只能证明「不炸」，证明不了「画得对」。这个能：地平线在哪、
   路面收没收敛、描边粗细对不对、远处那辆车还剩几个像素 —— 出来一张图就看见了。
   路径填充按覆盖率算，所以亚像素的东西会变成半透明而不是消失或者锯齿。

   用法：node tools/shot.js [输出目录] [--sprites|--ladder|--tumble|--clean]
   --------------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { makeCanvas } = require('./ctx2d.js');

/* ---------- PNG ---------- */
const CRC = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(file, r, scale) {
  scale = scale || 1;
  const w = r.w * scale, h = r.h * scale;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const c = r.get((x / scale) | 0, (y / scale) | 0);
      if (!c || c[3] <= 0) { raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; }
      else { raw[o++] = Math.round(c[0]); raw[o++] = Math.round(c[1]); raw[o++] = Math.round(c[2]); }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ---------- 装载游戏，但用真的光栅顶掉假画布 ---------- */
function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
                .match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  global.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener(){} };
  Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
  global.document = {
    getElementById: id => els[id] || (els[id] = makeCanvas(id === 'px' ? 1280 : 1, id === 'px' ? 720 : 1)),
    createElement: () => makeCanvas(1, 1),
    body: makeCanvas(1, 1), addEventListener(){},
  };
  global.addEventListener = () => {};
  global.performance = { now: () => Date.now() };
  global.requestAnimationFrame = () => 1;
  global.setTimeout = fn => { try { fn(); } catch (e) {} return 0; };
  (0, eval)(src +
    '\n;globalThis.__G__={Player,Rivals,Traffic,Game,Road,Input,update,render,startRace,segAt,' +
    'UNITS_PER_KM,doAttack,wipeout,Pickups,PLAYER_PAL,RIDER_PAL,COP_PAL,CAR_SPECS,Cam,' +
    'DRAW_DIST,SEG_LEN,BIKES,roadY,' +
    'drawRider,drawCar,drawTumble,drawRunner,drawWreck,drawPickup,' +
    'get Cop(){return Cop},get W(){return W},get H(){return H},get PX(){return PX}};');
  return { G: globalThis.__G__, els };
}

require('./env.js').seedRandom(process.argv);   // 同一条命令两次跑出同一帧，才好前后对比
const OUT = process.argv.slice(2).find(a => a[0] !== '-') || path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const { G, els } = load();
const px = els['px'];
const K = G.Input._keys;
const drive = (n, keys) => {
  for (let i = 0; i < n; i++) {
    for (const k of Object.keys(K)) K[k] = false;
    for (const k of (keys || ['arrowup'])) K[k] = true;
    G.update(1 / 60);
  }
};


// --clean：把街景和所有车手清空，只留路面和天空，用来核对配色管线
if (process.argv.includes('--clean')) {
  for (const t of [0, 4]) {
    G.startRace(t);
    while (G.Game.state === 'pre') G.update(1 / 60);
    drive(60 * 6);
    for (const sg of G.Road.segs) sg.sprites.length = 0;
    G.Rivals.length = 0; G.Traffic.length = 0;
    G.update(1 / 60); G.render();
    const smp = (x, y) => { const c = px._r.get(x, y); return '#' + c.slice(0,3).map(v => (v|0).toString(16).padStart(2,'0')).join(''); };
    const th = G.Road.theme;
    console.log(G.Road.name);
    console.log('   近路面 ' + smp(px._r.w >> 1, px._r.h - 4) + '   应为 ' + th.road[0] + ' / ' + th.road[1]);
    console.log('   路 肩 ' + smp(3, px._r.h - 4) + '   应为 ' + th.off[0] + ' / ' + th.off[1]);
    console.log('   天 空 ' + smp(px._r.w >> 1, 4) + '   应为 ' + th.sky[0] + '→' + th.sky[1]);
    console.log('   远路面 ' + smp(px._r.w >> 1, Math.round(G.H * .55)) + '   雾色 ' + th.fog);
    writePng(path.join(OUT, 'clean-' + G.Road.name + '.png'), px._r, 1);
  }
  process.exit(0);
}


// --cost：路面这一层每帧的绘制量。视距从 340 拉到 560 段，但远处并成了长色带，
// 所以真正要问的是路径数和落点数有没有跟着涨。
if (process.argv.includes('--cost')) {
  const n = { fill: 0, pt: 0, rect: 0 };
  const cx = px.getContext("2d");
  const of = cx.fill.bind(cx), ol = cx.lineTo.bind(cx), om = cx.moveTo.bind(cx), orr = cx.fillRect.bind(cx);
  cx.fill = (...a) => { n.fill++; return of(...a); };
  cx.lineTo = (...a) => { n.pt++; return ol(...a); };
  cx.moveTo = (...a) => { n.pt++; return om(...a); };
  cx.fillRect = (...a) => { n.rect++; return orr(...a); };
  for (const t of [0, 3]) {
    G.startRace(t);
    while (G.Game.state === 'pre') G.update(1 / 60);
    drive(60 * 20);
    for (const sg of G.Road.segs) sg.sprites.length = 0;
    G.Rivals.length = 0; G.Traffic.length = 0;    // 只留路面
    n.fill = n.pt = n.rect = 0;
    const F = 30;
    for (let f = 0; f < F; f++) { G.Player.speed = G.Player.maxSpeed; drive(1); G.render(); }
    console.log(G.Road.name.padEnd(12) + '每帧  路径 ' + (n.fill / F).toFixed(1).padStart(6) +
                '   落点 ' + (n.pt / F).toFixed(0).padStart(6) + '   矩形 ' + (n.rect / F).toFixed(1).padStart(6));
  }
  process.exit(0);
}

// --jitter：高速下的画面稳定性。清掉街景和演员，只留路面，量相邻帧的逐像素变化。
// 路面本身在动，所以差值不会是 0；但「明暗带闪烁」会让差值暴涨好几倍 ——
// 稳定的路面是平滑位移，闪烁的路面是每帧翻色。
if (process.argv.includes('--jitter')) {
  /* 把玩家钉在固定的一段路上再测。原来只是「跑 20 秒然后测」，可路上撞没撞到车
     会改变 20 秒后停在哪，于是换个版本量出来的是「这次落在了哪段路」而不是
     「画面稳不稳」—— 两个数根本不可比。现在直道、弯道各钉一处。 */
  const park = z => {
    G.Player.z = z;
    G.Player.y = G.Player.lastGroundY = G.roadY(G.segAt(z), z);
    G.Player.vy = 0; G.Player.airTime = 0; G.Player.x = 0;
    G.Cam.shakeT = 0;
    for (let f = 0; f < 90; f++) { G.Player.speed = G.Player.maxSpeed; drive(1); G.Player.z = z; }
  };
  const spots = t => {
    const sg = G.Road.segs;
    let si = 100; while (si < sg.length - 200 && Math.abs(sg[si].curve) > .1) si++;
    let bi = 100, best = -1;
    for (let i = 100; i < sg.length - 700; i++) {
      let c = 0; for (let k = 0; k < 60; k++) c += Math.abs(sg[i + k].curve);
      if (c > best) { best = c; bi = i; }
    }
    return [['直道', sg[si].p1.z], ['弯道', sg[bi].p1.z]];
  };
  const rows = [];
  for (const t of [0, 3]) {
    G.startRace(t);
    while (G.Game.state === 'pre') G.update(1 / 60);
    drive(60 * 20);                                    // 先跑到顶速
    for (const sg of G.Road.segs) sg.sprites.length = 0;
    G.Rivals.length = 0; G.Traffic.length = 0;
    for (const [nm, z] of spots(t)) {
      park(z);
      let prev = null, sum = 0, peak = 0, n = 0, shaky = 0;
      for (let f = 0; f < 90; f++) {
        G.Player.speed = G.Player.maxSpeed;      // 钉在顶速，两次测量才比得了
        drive(1); G.render();
        const cur = Float32Array.from(px._r.d);
        if (prev) {
          // 只看地平线上下这一条：远处的路都挤在这里
          const y0 = Math.round(G.H * .40), y1 = Math.round(G.H * .60);
          let d = 0, c = 0;
          for (let y = y0; y < y1; y++) for (let x = 0; x < G.W; x += 2) {
            const i = (y * G.W + x) * 4;
            d += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i+1] - prev[i+1]) + Math.abs(cur[i+2] - prev[i+2]);
            c++;
          }
          d /= c * 3; sum += d; peak = Math.max(peak, d); n++;
        }
        prev = cur;
        if (G.Cam.shakeT > 0) shaky++;
      }
      rows.push([G.Road.name + ' ' + nm, (G.Player.speed / G.UNITS_PER_KM * 3600).toFixed(0),
                 (sum / n).toFixed(2), peak.toFixed(2), (shaky / 90 * 100).toFixed(0) + '%']);
    }
  }
  console.log('赛道            km/h  平均帧间差   峰值  抖屏占帧  （前两项 0~255，越小越稳）');
  for (const r of rows) console.log(r[0].padEnd(11, ' ') + r[1].padStart(5) + r[2].padStart(11) + r[3].padStart(8) + r[4].padStart(9));
  process.exit(0);
}


// --sprites：把源图本身按 6 倍摊开成一张表，专门用来看精灵画得对不对
if (process.argv.includes('--vec')) {
  const P = G.PLAYER_PAL, R = G.RIDER_PAL, CP = G.COP_PAL;
  // 每一格：[标题, 画法, 宽度]
  const cell = (draw) => draw;
  const big = [
    cell(g => G.drawRider(g, P, { tilt: 0 }, 0)),
    cell(g => G.drawRider(g, P, { tilt: -1 }, 0)),
    cell(g => G.drawRider(g, P, { tilt: 1, brake: true }, 0)),
    cell(g => G.drawRider(g, P, { tilt: .4, atk: 1, wep: 0 }, 0)),
    cell(g => G.drawRider(g, P, { tilt: .4, atk: 1, wep: 1 }, 0)),
    cell(g => G.drawRider(g, P, { tilt: -.4, atk: -1, wep: 2 }, 0)),
    cell(g => G.drawRider(g, R[3], { tilt: 0 }, 0)),
    cell(g => G.drawRider(g, CP, { tilt: 0, cop: true, flash: true }, 0)),
    cell(g => G.drawRider(g, P, { tilt: .3, hit: true }, 0)),
    cell(g => G.drawRunner(g, P, 1, 0)),
    cell(g => G.drawTumble(g, P, .12, 0)),
    cell(g => G.drawTumble(g, P, .55, 0)),
    cell(g => G.drawWreck(g, P, 0)),
    cell(g => G.drawPickup(g, 1, 0)),
    cell(g => G.drawPickup(g, 2, 0)),
    cell(g => G.drawCar(g, G.CAR_SPECS[0], false, 0)),
    cell(g => G.drawCar(g, G.CAR_SPECS[3], true, 0)),
    cell(g => G.drawCar(g, G.CAR_SPECS[4], false, 0)),
    cell(g => G.drawCar(g, G.CAR_SPECS[6], true, 0)),
    cell(g => G.drawCar(g, G.CAR_SPECS[8], false, 0)),
  ];
  const COLS = 5, CW = 150, CH = 150;
  const rows = Math.ceil(big.length / COLS);
  const sheet = makeCanvas(CW * COLS, CH * rows + 120);
  const g = sheet.getContext('2d');
  g.fillStyle = '#4e4e5a'; g.fillRect(0, 0, sheet.width, sheet.height);
  big.forEach((d, i) => {
    const cx = (i % COLS) * CW + CW / 2, cy = ((i / COLS) | 0) * CH + CH - 16;
    g.fillStyle = (i % 2) ? '#565663' : '#4a4a56';
    g.fillRect((i % COLS) * CW, ((i / COLS) | 0) * CH, CW, CH);
    g.save(); g.translate(cx, cy); g.scale(1.1, 1.1); d(g); g.restore();
  });
  // 底部一排：同一辆车缩到一串小尺寸，看看还认不认得出
  const SIZES = [4, 6, 8, 11, 15, 20, 28, 40, 56, 76];
  let x = 10;
  g.fillStyle = '#3e3e48'; g.fillRect(0, CH * rows, sheet.width, 120);
  for (const w of SIZES) {
    const k = w / 100, ink = w < 16 ? 0 : 1.35 / k;
    g.save(); g.translate(x + w / 2, CH * rows + 55); g.scale(k, k); G.drawCar(g, G.CAR_SPECS[3], true, ink); g.restore();
    g.save(); g.translate(x + w / 2, CH * rows + 112); g.scale(k, k); G.drawRider(g, G.RIDER_PAL[0], { tilt: 0 }, ink); g.restore();
    x += w + 16;
  }
  writePng(path.join(OUT, 'vec.png'), sheet._r, 1);
  console.log('写出 vec.png  尺寸阶梯: ' + SIZES.join('px '));
  process.exit(0);
}

/* --corner：把玩家钉在每条街最弯的地方、钉在顶速，画一帧。
   这正是「转弯看不见对面车」的现场：看得见多少路、车被相机推开多远，一张图见分晓。 */
if (process.argv.includes('--corner')) {
  for (let t = 0; t < 5; t++) {
    G.startRace(t);
    while (G.Game.state === 'pre') G.update(1 / 60);
    const sg = G.Road.segs;
    let bi = 60, best = -1;
    for (let i = 60; i < sg.length - 700; i++) {
      let c = 0; for (let k = 0; k < 60; k++) c += Math.abs(sg[i + k].curve);
      if (c > best) { best = c; bi = i; }
    }
    // 正常骑过去，别硬塞 z —— 硬塞会让车悬在半空（y 还停在上一段路的高度上）
    const zc = sg[bi].p1.z;
    G.Player.z = Math.max(0, zc - G.Player.maxSpeed * 3);
    // 挪 z 就得把整套落地状态一起挪：y、vy，还有 lastGroundY —— 少一个，下一帧
    // 那句 vy = (gy - lastGroundY)/dt 会把车弹到平流层去（只是探针的坑，正常跑不会挪 z）
    G.Player.y = G.Player.lastGroundY = G.roadY(G.segAt(G.Player.z), G.Player.z);
    G.Player.vy = 0; G.Player.airTime = 0;
    for (let f = 0; f < 60 * 6 && G.Player.z < zc; f++) {
      G.Player.state = 'ride'; G.Player.hp = G.Player.maxHp; G.Player.x = 0;
      drive(1); G.Player.speed = G.Player.maxSpeed;
      for (const car of G.Traffic) if (Math.abs(car.z - G.Player.z) < 5000) car.z += 30000;
    }
    G.Player.state = 'ride'; G.Player.hp = G.Player.maxHp; G.Player.x = 0;
    if (G.PlayerWreck) G.PlayerWreck.z = G.Player.z - 99999;
    G.update(1 / 60);
    G.render();
    bi = G.segAt(G.Player.z).i;
    let on = 0;
    for (let k = 0; k < G.DRAW_DIST; k++) {
      const sm = sg[(bi + k) % sg.length];
      if (sm.clip === 0) break;
      if (sm.p1.cz <= 0 || sm.p1.sw <= 0) continue;        // 还在相机身后
      if (sm.p1.sx + sm.p1.sw > 0 && sm.p1.sx - sm.p1.sw < G.W) on = k; else break;
    }
    writePng(path.join(OUT, 'c-' + G.Road.name + '.png'), px._r, 1);
    console.log('c-' + G.Road.name.padEnd(5, '\u3000') +
      ' 曲率 ' + (best / 60).toFixed(1) +
      '　路面可见 ' + String(on).padStart(3) + ' 段 / ' + (on / (G.Player.speed / G.SEG_LEN)).toFixed(2) + 's' +
      '　相机转头 ' + (G.Cam.look * 100).toFixed(1) + '% 屏宽');
  }
  process.exit(0);
}

const SHOTS = [
  { t: 0, sec: 14, nm: '1-市中心' },
  { t: 1, sec: 22, nm: '2-旧城区' },
  { t: 2, sec: 30, nm: '3-滨江' },
  { t: 3, sec: 18, nm: '4-工业区' },
  { t: 4, sec: 26, nm: '5-夜战' },
];
for (const s of SHOTS) {
  G.startRace(s.t);
  while (G.Game.state === 'pre') G.update(1 / 60);
  drive(Math.round(s.sec * 60));
  // 景观图要的是正常骑行：把状态摁回去，再空转几帧让摔车的白闪和震屏衰减掉
  for (let i = 0; i < 24; i++) {
    G.Player.state = 'ride'; G.Player.hp = G.Player.maxHp; G.Player.stun = 0;
    for (const car of G.Traffic) if (Math.abs(car.z - G.Player.z) < 4000) car.z += 26000;
    G.update(1 / 60);
    if (G.PlayerWreck) G.PlayerWreck.z = G.Player.z - 99999;   // 自己的残骸挪走（要在 update 之后）
  }
  G.Player.state = 'ride'; G.Player.hp = G.Player.maxHp;
  G.update(1 / 60);
  if (G.PlayerWreck) G.PlayerWreck.z = G.Player.z - 99999;
  G.render();
  writePng(path.join(OUT, s.nm + '.png'), px._r, 1);
  const smp = (x, y) => { const c = px._r.get(x, y); return c ? '#' + c.slice(0,3).map(v => (v|0).toString(16).padStart(2,'0')).join('') : '—'; };
  console.log('写出 ' + s.nm + '.png  (' + px._r.w + '×' + px._r.h + ')  ' +
              '速度 ' + Math.round(G.Player.speed / 60) + 'km/h  名次 ' + G.Player.rank +
              '\n   取样 近路面' + smp(px._r.w >> 1, px._r.h - 8) +
              ' 路肩' + smp(4, px._r.h - 8) +
              ' 天空' + smp(px._r.w >> 1, 6) +
              ' 地平线上方' + smp(px._r.w >> 1, Math.round(G.H * .48)));
}

// 打斗特写：把一个对手按在身边，出手那一帧
G.startRace(0);
while (G.Game.state === 'pre') G.update(1 / 60);
drive(60 * 12);
G.Player.state = 'ride'; G.Player.hp = G.Player.maxHp;   // 这一帧要的是踹人，别撞上别的
const r = G.Rivals[0];
r.z = G.Player.z + 300; r.x = G.Player.x + .16; r.speed = G.Player.speed; r.state = 'ride';
G.doAttack(G.Player, 1);
G.update(1 / 60); G.render();
writePng(path.join(OUT, '6-踹人.png'), px._r, 1);
console.log('写出 6-踹人.png');

// 摔车之后徒步跑回去
G.wipeout(G.Player, '截图');
drive(60 * 2);
G.render();
writePng(path.join(OUT, '7-摔车.png'), px._r, 1);
console.log('写出 7-摔车.png  state=' + G.Player.state);
