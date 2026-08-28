/* ---------------------------------------------------------------------------
   无头运行环境：用假的 DOM 和假的 WebGL 把 index.html 里的游戏跑起来。

   目的不是渲染，是让游戏逻辑（世界生成、物理、AI、关卡流程）能在 Node 里
   跑，这样改完关卡生成器可以立刻验证有没有造出跳不过去的地方。

   注意：着色器编译在这里是打桩的，GLSL 的语法错误这套测试查不出来，
   那个只能靠真浏览器。
   --------------------------------------------------------------------------- */
'use strict';
const fs = require('fs');
const path = require('path');

const noop = () => {};

function fakeGL() {
  const g = {};
  ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ACTIVE_UNIFORMS',
   'ARRAY_BUFFER', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'FLOAT', 'TRIANGLES', 'DEPTH_TEST',
   'CULL_FACE', 'BLEND', 'BACK', 'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ONE',
   'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT'].forEach((c, i) => g[c] = i + 1);
  ['createShader', 'shaderSource', 'compileShader', 'getShaderInfoLog', 'attachShader',
   'bindAttribLocation', 'linkProgram', 'getProgramInfoLog', 'getUniformLocation',
   'bindBuffer', 'bufferData', 'bufferSubData', 'deleteBuffer', 'enableVertexAttribArray',
   'disableVertexAttribArray', 'vertexAttribPointer', 'drawArrays', 'viewport', 'clearColor',
   'clear', 'enable', 'disable', 'depthMask', 'cullFace', 'useProgram', 'blendFunc',
   'uniform1f', 'uniform1i', 'uniform3f', 'uniform3fv', 'uniformMatrix4fv'].forEach(m => g[m] = noop);
  g.createProgram = () => ({});
  g.createBuffer = () => ({});
  g.getShaderParameter = () => true;
  g.getProgramParameter = (p, k) => k === g.LINK_STATUS ? true : 0;
  g.getActiveUniform = () => ({ name: 'stub' });
  return g;
}

function fakeEl(id) {
  return {
    id, style: {}, innerHTML: '', textContent: '', offsetWidth: 1, width: 800, height: 600,
    classList: { add: noop, remove: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, requestPointerLock: noop,
    querySelector: () => fakeEl('q'), getContext: () => fakeGL(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
}

// 游戏里所有需要被测试碰到的顶层名字。index.html 里改了名，这里会直接报错。
const EXPORTS = ['World', 'Hero', 'Game', 'Keys', 'Input', 'Cam', 'Foes', 'Items', 'Shots',
                 'Parts', 'Rings', 'LANTERNS', 'groundAt', 'surfaceY', 'primaryClick', 'QI_MAX',
                 'SCENES', 'Env', 'Weather', 'SFX', 'applyScene', 'Chase'];

/** 装载游戏，返回它的顶层对象。frames 是一个手动推进帧的函数。 */
function loadGame() {
  const file = path.join(__dirname, '..', 'index.html');
  const m = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('index.html 里找不到 <script> 块');

  const els = {};
  global.window = global;
  global.document = {
    getElementById: id => els[id] || (els[id] = fakeEl(id)),
    querySelector: () => fakeEl('q'),
    createElement: () => fakeEl('new'),
    body: fakeEl('body'),
    addEventListener: noop, exitPointerLock: noop, pointerLockElement: null
  };
  global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
  global.addEventListener = noop;
  global.matchMedia = () => ({ matches: false });
  global.performance = { now: () => Date.now() };
  global.AudioContext = undefined; global.webkitAudioContext = undefined;

  let queue = [];
  global.requestAnimationFrame = fn => { queue.push(fn); return 1; };
  global.setTimeout = fn => { try { fn(); } catch (e) {} return 0; };   // 界面延时立刻兑现

  (0, eval)(m[1] + '\n;globalThis.__GAME__ = {' + EXPORTS.join(',') + '};');
  const G = globalThis.__GAME__;

  let clock = 0, errors = [];
  /** 推进一帧（约 60fps）。返回这一帧抛出的异常数。 */
  G.tick = () => {
    clock += 16.7;
    const q = queue; queue = [];
    let n = 0;
    for (const fn of q) {
      try { fn(clock); } catch (e) { n++; if (errors.length < 5) errors.push(e); }
    }
    return n;
  };
  G.errors = errors;
  return G;
}

module.exports = { loadGame };
