/* ---------------------------------------------------------------------------
   无头运行环境：用假的 DOM 和假的 WebGL2 把 index.html 里的游戏跑进 Node。

   目的不是渲染，是让游戏逻辑（赛道生成、物理、AI、道具、比赛流程）能离线跑，
   这样改完曲线参数不用手动开八台车绕三圈去看。

   注意：着色器编译在这里是打桩的，GLSL 的语法错误这套测试查不出来，
   那个只能靠真浏览器。
   --------------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');
const noop = () => {};

function fakeGL() {
  const g = {};
  const CONSTS = [
    'VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ACTIVE_UNIFORMS',
    'ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','STATIC_DRAW','DYNAMIC_DRAW','FLOAT','TRIANGLES',
    'DEPTH_TEST','CULL_FACE','BLEND','BACK','FRONT','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','ONE',
    'COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT','TEXTURE_2D','TEXTURE0','TEXTURE_MIN_FILTER',
    'TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','NEAREST','LINEAR','CLAMP_TO_EDGE',
    'DEPTH_COMPONENT24','DEPTH_COMPONENT','UNSIGNED_INT','FRAMEBUFFER','DEPTH_ATTACHMENT',
    'FRAMEBUFFER_COMPLETE','NONE','MAX_TEXTURE_SIZE',
  ];
  CONSTS.forEach((c, i) => { g[c] = i + 1; });
  const METHODS = [
    'shaderSource','compileShader','getShaderInfoLog','attachShader','bindAttribLocation',
    'linkProgram','getProgramInfoLog','deleteShader','bindBuffer','bufferData','bufferSubData',
    'deleteBuffer','bindVertexArray','deleteVertexArray','enableVertexAttribArray',
    'disableVertexAttribArray','vertexAttribPointer','vertexAttribDivisor','drawArrays',
    'drawArraysInstanced','viewport','clearColor','clear','enable','disable','depthMask',
    'cullFace','useProgram','blendFunc','bindTexture','texImage2D','texParameteri',
    'activeTexture','bindFramebuffer','framebufferTexture2D','drawBuffers','readBuffer',
    'deleteFramebuffer','deleteTexture','polygonOffset','pixelStorei','generateMipmap',
    'uniform1f','uniform1i','uniform2f','uniform3f','uniform3fv','uniform4f','uniform4fv',
    'uniformMatrix3fv','uniformMatrix4fv','finish','flush',
  ];
  METHODS.forEach(m => { g[m] = noop; });
  g.createShader = () => ({});
  g.createProgram = () => ({});
  g.createBuffer  = () => ({ __buf: true });
  g.createTexture = () => ({ __tex: true });
  g.createFramebuffer = () => ({ __fbo: true });
  g.createVertexArray = () => ({ __vao: true });
  g.getShaderParameter  = () => true;
  g.getProgramParameter = (p, k) => (k === g.LINK_STATUS ? true : 0);
  g.getActiveUniform    = () => ({ name: 'stub' });
  g.getUniformLocation  = () => ({});
  g.checkFramebufferStatus = () => g.FRAMEBUFFER_COMPLETE;
  g.getParameter = () => 4096;
  g.getExtension = () => null;
  return g;
}

function fake2D() {
  const c = {};
  ['clearRect','beginPath','moveTo','lineTo','closePath','stroke','fill','arc','rect',
   'save','restore','translate','rotate','scale','drawImage','fillRect','fillText',
   'setLineDash','quadraticCurveTo','bezierCurveTo','ellipse'].forEach(m => { c[m] = noop; });
  c.getImageData = () => ({ data: new Uint8ClampedArray(4) });
  return c;
}

function fakeEl(id) {
  const el = {
    id, style: {}, innerHTML: '', textContent: '', value: '',
    offsetWidth: 1, offsetHeight: 1, width: 800, height: 600,
    clientWidth: 1280, clientHeight: 720, dataset: {},
    classList: { _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); } },
    appendChild: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop,
    setAttribute: noop, getAttribute: () => null, focus: noop, blur: noop, click: noop,
    closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  el.getContext = kind => (kind === '2d' ? fake2D() : fakeGL());
  return el;
}

/* 游戏里需要被测试碰到的顶层名字。index.html 改了名这里会立刻报错。 */
const EXPORTS = [
  'Track','Race','Cam','Keys','Parts','MODELS','Quality','M4','Mesh','THEMES','TRACKS',
  'DRIVERS','AI_SKILL','ITEM_DEF','ITEM_KEYS','ITEM_ODDS','MT','SURF','SPD_MAX','KART_R',
  'buildTrack','buildTrackGeometry','buildItemModels','layoutTrackFeatures',
  'locate','surfaceY','atS','worldAt','curvAt','peakCurv','sDist',
  'makeKart','updateKart','updateAI','kartCollisions','updateItems','updateParts',
  'useItem','rollItem','giveItem','spinOut','squash','nextAhead',
  'startRace','step','frame','endRace','finishKart','updateRanks','updateCamera',
  'Touch','readInput','IS_TOUCH',
  'showTitle','SFX','Audio_','render','Shadow','outH','groundOut','sideOut',
];

function loadGame(opts) {
  opts = opts || {};
  const file = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('index.html 里找不到 <script> 块');

  const els = {};
  global.window = global;
  global.document = {
    getElementById: id => els[id] || (els[id] = fakeEl(id)),
    querySelector: () => fakeEl('q'),
    querySelectorAll: () => [],
    createElement: () => fakeEl('new'),
    body: fakeEl('body'),
    addEventListener: noop, removeEventListener: noop,
  };
  global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
  global.addEventListener = noop; global.removeEventListener = noop;
  global.matchMedia = () => ({ matches: false });
  global.performance = { now: () => Date.now() };
  global.AudioContext = undefined; global.webkitAudioContext = undefined;
  try { global.navigator = { maxTouchPoints: 0, userAgent: 'node' }; }
  catch (e) { Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: 0, userAgent: 'node' }, configurable: true }); }

  let queue = [];
  global.requestAnimationFrame = fn => { queue.push(fn); return 1; };
  global.cancelAnimationFrame = noop;
  const timers = [];
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  global.clearTimeout = noop;

  (0, eval)(m[1] + '\n;globalThis.__KART__ = {' + EXPORTS.join(',') + '};');
  const G = globalThis.__KART__;

  let clock = 0;
  const errors = [];
  /* 推进一帧（默认 60fps）。返回这一帧抛出的异常数。 */
  G.tick = (ms) => {
    clock += (ms === undefined ? 16.7 : ms);
    const q = queue; queue = [];
    let n = 0;
    for (const fn of q) {
      try { fn(clock); } catch (e) { n++; if (errors.length < 8) errors.push(e); }
    }
    return n;
  };
  /* 兑现挂起的 setTimeout（比赛结束的那个 2.6 秒延时） */
  G.flushTimers = () => { const t = timers.splice(0); for (const x of t) { try { x.fn(); } catch (e) { errors.push(e); } } };
  G.errors = errors;
  G.els = els;
  return G;
}

module.exports = { loadGame, fakeGL, fakeEl };
