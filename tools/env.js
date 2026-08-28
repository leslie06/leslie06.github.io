/* ---------------------------------------------------------------------------
   无头运行环境：用假的 DOM 和假的 2D 上下文把 index.html 里的游戏跑起来。

   目的不是渲染，是让游戏逻辑（波次、AI、碰撞、商店、结算）能在 Node 里跑，
   这样改完数值可以立刻验证还打不打得动。

   注意：画布调用全部是打桩的，画错位置、颜色不对、图层顺序反了这套测试
   查不出来，那个只能靠真浏览器看。
   --------------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');

const noop = () => {};

/** 假的 2D 上下文：任何没定义的方法都当空函数，任何属性都可写。 */
function fake2D() {
  const grad = { addColorStop: noop };
  const base = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    textAlign: '', textBaseline: '', globalCompositeOperation: '', imageSmoothingEnabled: false,
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    measureText: () => ({ width: 10 })
  };
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

function fakeEl(id) {
  const el = {
    id, width: id === 'cv' ? 640 : 300, height: id === 'cv' ? 360 : 150,
    style: {}, classList: { add: noop, remove: noop, toggle: noop },
    firstElementChild: null,
    addEventListener: noop, removeEventListener: noop, appendChild: noop,
    setPointerCapture: noop, getContext: () => fake2D(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 })
  };
  el.firstElementChild = { style: {} };
  return el;
}

// 游戏里所有需要被测试碰到的顶层名字。index.html 里改了名，这里会直接报错。
const EXPORTS = ['P', 'K', 'mouse', 'cam', 'WEAPONS', 'ZT', 'OBST', 'STEP', 'W', 'H', 'WW', 'WH',
                 'startRun', 'startWave', 'step', 'render', 'buyItem', 'shopItems', 'nextGun',
                 'dash', 'throwNade', 'swapWeapon', 'selectWeapon', 'startReload',
                 'spawnZ', 'spawnAt', 'dist', 'rnd'];
// 这些名字会被重新赋值（开局时数组全部换新，波次数是基本类型），
// 只能用取值器读——直接抄一份走会拿到上一局的旧数组。
const GETTERS = ['mode', 'wave', 'cash', 'kills', 'timeAlive',
                 'zombies', 'bullets', 'zshots', 'nades', 'parts', 'drops', 'barrels'];

/** 装载游戏，返回它的顶层对象。 */
function loadGame() {
  const file = path.join(__dirname, '..', 'index.html');
  const m = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('index.html 里找不到 <script> 块');

  const els = {};
  global.window = {};                          // AudioContext 取不到，游戏会自己跳过音频
  global.document = {
    getElementById: id => els[id] || (els[id] = fakeEl(id)),
    createElement: () => fakeEl('new'),
    body: fakeEl('body'), addEventListener: noop
  };
  global.innerWidth = 1280; global.innerHeight = 720;
  global.addEventListener = noop;
  global.performance = { now: () => Date.now() };
  global.requestAnimationFrame = () => 1;      // 帧由测试自己推，不用浏览器的
  global.setTimeout = fn => { try { fn(); } catch (e) {} return 0; };

  const getters = GETTERS.map(g => 'get ' + g + '(){return ' + g + '}').join(',');
  (0, eval)(m[1] + '\n;globalThis.__GAME__ = {' + EXPORTS.join(',') + ',' + getters + '};');
  return globalThis.__GAME__;
}

/** 坐标或血量变成 NaN，说明某处除零了；数量爆掉说明有东西没被回收。 */
function sanity(G, tag) {
  const bad = [];
  const { P, zombies, bullets, parts, drops } = G;
  if (!isFinite(P.x) || !isFinite(P.y) || !isFinite(P.hp)) bad.push('主角坐标/血量 NaN');
  for (const z of zombies) if (!isFinite(z.x) || !isFinite(z.y) || !isFinite(z.hp)) bad.push('僵尸 NaN：' + z.t);
  for (const b of bullets) if (!isFinite(b.x) || !isFinite(b.y)) bad.push('子弹 NaN');
  if (zombies.length > 200) bad.push('僵尸堆积 ' + zombies.length);
  if (bullets.length > 900) bad.push('子弹堆积 ' + bullets.length);
  if (parts.length  > 4000) bad.push('粒子堆积 ' + parts.length);
  if (drops.length  > 200)  bad.push('掉落堆积 ' + drops.length);
  if (bad.length) { console.log('✗ ' + tag + '：' + bad.slice(0, 4).join('，')); process.exit(1); }
}

module.exports = { loadGame, sanity };
