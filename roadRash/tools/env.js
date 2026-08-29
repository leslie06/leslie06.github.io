/* ---------------------------------------------------------------------------
   无头运行环境：用假的 DOM 和假的 2D 上下文，把 index.html 里的游戏搬进 Node。

   目的不是渲染，是让赛道生成、物理、AI、战斗、结算这些逻辑能自己跑起来 ——
   改完数值立刻能验证：还摔不摔得动、AI 会不会集体冲出赛道、名次会不会算飞。

   画布调用全是打桩的：画错位置、颜色不对、图层顺序反了，这套测试查不出来，
   那个只能靠真浏览器看。
   --------------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');
const noop = () => {};

/** 假的 2D 上下文：没定义的方法一律当空函数，属性随便写。 */
function fake2D() {
  const grad = { addColorStop: noop };
  const base = {
    fillStyle:'', strokeStyle:'', lineWidth:1, font:'', globalAlpha:1,
    textAlign:'', textBaseline:'', globalCompositeOperation:'', imageSmoothingEnabled:false,
    createRadialGradient:() => grad, createLinearGradient:() => grad,
    measureText:() => ({ width: 10 }),
    // mipify 会真的读像素。这里只要不抛异常就行，内容对逻辑测试没有意义
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

function fakeEl(id) {
  return {
    id, width: 320, height: 180, className: '', textContent: '', innerHTML: '',
    style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, appendChild: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => fake2D(),
    getBoundingClientRect: () => ({ left:0, top:0, right:320, bottom:180, width:320, height:180 }),
  };
}

/* 测试会碰到的顶层名字。index.html 里改了名，这里立刻报错，不会静悄悄地过。 */
const EXPORTS = [
  'Player','Rivals','Traffic','Pickups','Game','Road','Input','Cam','Fx',
  'update','render','startRace','buildTrack','prepFog','segAt','roadY','computeRank',
  'doAttack','wipeout','BIKES','WEPS','THEMES','RIDER_PAL','CAR_SPECS',
  'SEG_LEN','ROAD_W','UNITS_PER_KM','DRAW_DIST','PLAYER_Z','showShop','showTitle','buyBike',
];
/* 这些会被重新赋值，只能用取值器读，直接抄一份会拿到旧的。 */
const GETTERS = ['Cop','PlayerWreck','W','H','frameCount','freezeT','flash','horizonY'];

function loadGame() {
  const file = path.join(__dirname, '..', 'index.html');
  const m = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('index.html 里找不到 <script> 块');

  const els = {};
  const win = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: noop };
  global.window = win;
  // Node 22 的 navigator 是只读的，用 defineProperty 盖过去
  Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
  global.document = {
    getElementById: id => els[id] || (els[id] = fakeEl(id)),
    createElement: () => fakeEl('new'),
    body: fakeEl('body'),
    addEventListener: noop,
  };
  global.addEventListener = noop;
  global.performance = { now: () => Date.now() };
  global.requestAnimationFrame = () => 1;         // 帧由测试自己推
  global.setTimeout = fn => { try { fn(); } catch (e) {} return 0; };

  const getters = GETTERS.map(g => 'get ' + g + '(){return ' + g + '}').join(',');
  (0, eval)(m[1] + '\n;globalThis.__GAME__ = {' + EXPORTS.join(',') + ',' + getters + '};');
  return globalThis.__GAME__;
}

/** 一帧一帧推进：把键盘状态塞进去，调 update，再清掉边沿触发。 */
function step(G, keys, dt) {
  const K = G.Input._keys;
  for (const k of Object.keys(K)) K[k] = false;
  for (const k of (keys.hold || [])) K[k] = true;
  if (keys.atkL) G.Input.atkL = true;
  if (keys.atkR) G.Input.atkR = true;
  G.update(dt == null ? 1 / 60 : dt);
  G.Input.atkL = false; G.Input.atkR = false;
}

/** 数值体检：NaN、跑到赛道外面去、对象堆积。 */
function sanity(G, tag) {
  const bad = [];
  const P = G.Player;
  const num = (v, n) => { if (typeof v !== 'number' || !isFinite(v)) bad.push(n + '=' + v); };
  num(P.z, '玩家z'); num(P.x, '玩家x'); num(P.speed, '玩家速度');
  num(P.hp, '玩家血'); num(P.y, '玩家y'); num(P.vy, '玩家vy');
  if (Math.abs(P.x) > 3) bad.push('玩家横向跑飞了 x=' + P.x.toFixed(2));
  if (P.speed < -1) bad.push('玩家倒着走 ' + P.speed.toFixed(0));
  if (P.hp > P.maxHp + .01) bad.push('血超上限 ' + P.hp.toFixed(1));
  for (const r of G.Rivals) {
    num(r.z, '对手z'); num(r.x, '对手x'); num(r.speed, '对手速度'); num(r.hp, '对手血');
    if (Math.abs(r.x) > 3) bad.push('对手跑飞 x=' + r.x.toFixed(2));
  }
  for (const c of G.Traffic) { num(c.z, '车z'); num(c.x, '车x'); }
  if (G.Traffic.length > 60) bad.push('车流堆积 ' + G.Traffic.length);
  if (G.Pickups.length > 40) bad.push('掉落堆积 ' + G.Pickups.length);
  if (G.Fx.sparks.length > 800) bad.push('火花堆积 ' + G.Fx.sparks.length);
  if (P.rank < 1 || P.rank > 8) bad.push('名次越界 ' + P.rank);
  if (bad.length) { console.log('✗ ' + tag + '：' + bad.slice(0, 5).join('，')); process.exit(1); }
}

/* 固定随机源：不播种的话，同一份代码两次跑出来的名次能差好几位，
   于是"失败"既可能是真回归、也可能是手气差 —— 那种断言等于没有。
   种子从命令行拿，复现一次坏运气就写 node tools/playtest.js --seed=7。 */
function seedRandom(argv) {
  const m = (argv || []).join(' ').match(/--seed=(\d+)/);
  let s = (m ? +m[1] : 20260829) >>> 0;
  Math.random = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

module.exports = { loadGame, step, sanity, seedRandom };
