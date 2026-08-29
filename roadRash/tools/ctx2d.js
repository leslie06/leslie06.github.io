/* ---------------------------------------------------------------------------
   假的 CanvasRenderingContext2D：只实现游戏真正用到的那部分，但路径填充、
   描边、变换、双线性缩图都是真算的，所以截出来的图能当画面来看。
   --------------------------------------------------------------------------- */
'use strict';
const { parseColor, Grad, Raster, fillPolys, strokeToPolys } = require('./raster.js');

const noop = () => {};

function makeCtx(el) {
  const R = () => { el._r.resize(el.width, el.height); return el._r; };
  let M = [1, 0, 0, 1, 0, 0];                     // a b c d e f
  const stack = [];
  const st = { fill: '#000', stroke: '#000', lw: 1, alpha: 1, smooth: true, clip: null };
  let subs = [], cur = null, curClosed = false;

  const tx = (x, y) => [M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5]];
  const scaleOf = () => Math.sqrt(Math.abs(M[0]*M[3] - M[1]*M[2])) || 1;
  const push = (x, y) => { const p = tx(x, y); cur.push(p[0], p[1]); };

  function flushSub() { if (cur && cur.length >= 2) { subs.push(cur); subs.closed = subs.closed || []; } }

  const closedFlags = [];
  function newSub(x, y) {
    cur = []; closedFlags.push(false); subs.push(cur); push(x, y);
  }

  const ctx = {
    get fillStyle() { return st.fill; },   set fillStyle(v) { st.fill = v; },
    get strokeStyle() { return st.stroke; },set strokeStyle(v) { st.stroke = v; },
    get lineWidth() { return st.lw; },     set lineWidth(v) { st.lw = v; },
    get globalAlpha() { return st.alpha; },set globalAlpha(v) { st.alpha = v; },
    get imageSmoothingEnabled() { return st.smooth; }, set imageSmoothingEnabled(v) { st.smooth = v; },
    imageSmoothingQuality: 'high', lineJoin: 'miter', lineCap: 'butt',
    font: '', textAlign: '', textBaseline: '', globalCompositeOperation: 'source-over',
    filter: 'none', shadowBlur: 0, shadowColor: '', miterLimit: 10,

    save() { stack.push([M.slice(), st.fill, st.stroke, st.lw, st.alpha, st.smooth, st.clip]); },
    restore() { const s = stack.pop(); if (s) { M = s[0]; st.fill = s[1]; st.stroke = s[2]; st.lw = s[3]; st.alpha = s[4]; st.smooth = s[5]; st.clip = s[6]; } },
    translate(x, y) { M = [M[0], M[1], M[2], M[3], M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5]]; },
    scale(x, y) { M = [M[0]*x, M[1]*x, M[2]*y, M[3]*y, M[4], M[5]]; },
    rotate(a) {
      const c = Math.cos(a), s = Math.sin(a);
      M = [M[0]*c + M[2]*s, M[1]*c + M[3]*s, M[0]*(-s) + M[2]*c, M[1]*(-s) + M[3]*c, M[4], M[5]];
    },
    setTransform(a, b, c, d, e, f) { M = [a, b, c, d, e, f]; },
    resetTransform() { M = [1, 0, 0, 1, 0, 0]; },

    beginPath() { subs = []; closedFlags.length = 0; cur = null; },
    closePath() { if (cur) closedFlags[subs.indexOf(cur)] = true; },
    moveTo(x, y) { newSub(x, y); },
    lineTo(x, y) { if (!cur) newSub(x, y); else push(x, y); },
    quadraticCurveTo(cx, cy, x, y) {
      if (!cur) newSub(cx, cy);
      const n = 12, p = cur, ax = p[p.length-2], ay = p[p.length-1];
      const [qx, qy] = tx(cx, cy), [ex, ey] = tx(x, y);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push(u*u*ax + 2*u*t*qx + t*t*ex, u*u*ay + 2*u*t*qy + t*t*ey);
      }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      if (!cur) newSub(c1x, c1y);
      const n = 16, p = cur, ax = p[p.length-2], ay = p[p.length-1];
      const [q1x, q1y] = tx(c1x, c1y), [q2x, q2y] = tx(c2x, c2y), [ex, ey] = tx(x, y);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push(u*u*u*ax + 3*u*u*t*q1x + 3*u*t*t*q2x + t*t*t*ex,
                 u*u*u*ay + 3*u*u*t*q1y + 3*u*t*t*q2y + t*t*t*ey);
      }
    },
    arc(cx, cy, r, a0, a1, ccw) {
      let span = a1 - a0;
      if (ccw) { while (span > 0) span -= Math.PI * 2; } else { while (span < 0) span += Math.PI * 2; }
      const n = Math.max(6, Math.ceil(Math.abs(span) / (Math.PI / 16)));
      for (let i = 0; i <= n; i++) {
        const a = a0 + span * i / n, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0 && !cur) newSub(x, y); else push(x, y);
      }
    },
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) {
      let span = a1 - a0;
      if (ccw) { while (span > 0) span -= Math.PI * 2; } else { while (span < 0) span += Math.PI * 2; }
      const n = Math.max(8, Math.ceil(Math.abs(span) / (Math.PI / 16)));
      const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
      for (let i = 0; i <= n; i++) {
        const a = a0 + span * i / n, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        const x = cx + ex * cr - ey * sr, y = cy + ex * sr + ey * cr;
        if (i === 0 && !cur) newSub(x, y); else push(x, y);
      }
    },
    rect(x, y, w, h) { newSub(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h); closedFlags[subs.indexOf(cur)] = true; },

    fill(rule) {
      if (!subs.length) return;
      fillPolys(R(), subs, st.fill instanceof Grad ? st.fill : parseColor(st.fill), st.alpha, rule === 'evenodd', st.clip);
    },
    stroke() {
      if (!subs.length) return;
      const w = Math.max(.35, st.lw * scaleOf());
      fillPolys(R(), strokeToPolys(subs, w, closedFlags), st.stroke instanceof Grad ? st.stroke : parseColor(st.stroke), st.alpha, false, st.clip);
    },
    fillRect(x, y, w, h) {
      const a = tx(x, y), b = tx(x + w, y), c = tx(x + w, y + h), d = tx(x, y + h);
      fillPolys(R(), [[a[0],a[1], b[0],b[1], c[0],c[1], d[0],d[1]]],
                st.fill instanceof Grad ? st.fill : parseColor(st.fill), st.alpha, false, st.clip);
    },
    strokeRect(x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke(); },
    clearRect() {},
    fillText: noop, strokeText: noop, measureText: () => ({ width: 8 }),
    clip() {                                     // 只支持矩形裁剪，游戏里也只用得到这个
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of subs) for (let i = 0; i < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
        if (p[i+1] < y0) y0 = p[i+1]; if (p[i+1] > y1) y1 = p[i+1];
      }
      if (x1 < x0) return;
      st.clip = st.clip ? [Math.max(st.clip[0], x0), Math.max(st.clip[1], y0),
                           Math.min(st.clip[2], x1), Math.min(st.clip[3], y1)] : [x0, y0, x1, y1];
    },
    setLineDash: noop, createPattern: () => null,

    createLinearGradient(x0, y0, x1, y1) { const a = tx(x0, y0), b = tx(x1, y1); return new Grad('lin', [a[0], a[1], b[0], b[1]]); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const a = tx(x0, y0), b = tx(x1, y1), s = scaleOf();
      return new Grad('rad', [a[0], a[1], r0 * s, b[0], b[1], r1 * s]);
    },

    drawImage(src, a1, a2, a3, a4, a5, a6, a7, a8) {
      let sx = 0, sy = 0, sw, sh, dx, dy, dw, dh;
      if (arguments.length === 3) { sw = src.width; sh = src.height; dx = a1; dy = a2; dw = sw; dh = sh; }
      else if (arguments.length === 5) { sw = src.width; sh = src.height; dx = a1; dy = a2; dw = a3; dh = a4; }
      else { sx = a1; sy = a2; sw = a3; sh = a4; dx = a5; dy = a6; dw = a7; dh = a8; }
      const s = src._r; if (!s || dw <= 0 || dh <= 0) return;
      const r = R();
      // 目标矩形四角走变换，再逐像素反算源坐标
      const c0 = tx(dx, dy), c1 = tx(dx + dw, dy), c2 = tx(dx + dw, dy + dh), c3 = tx(dx, dy + dh);
      const minX = Math.max(0, Math.floor(Math.min(c0[0],c1[0],c2[0],c3[0])));
      const maxX = Math.min(r.w - 1, Math.ceil(Math.max(c0[0],c1[0],c2[0],c3[0])));
      const minY = Math.max(0, Math.floor(Math.min(c0[1],c1[1],c2[1],c3[1])));
      const maxY = Math.min(r.h - 1, Math.ceil(Math.max(c0[1],c1[1],c2[1],c3[1])));
      const det = M[0]*M[3] - M[1]*M[2]; if (!det) return;
      const i0 = M[3]/det, i1 = -M[1]/det, i2 = -M[2]/det, i3 = M[0]/det;
      const i4 = -(M[4]*i0 + M[5]*i2), i5 = -(M[4]*i1 + M[5]*i3);
      const smooth = st.smooth;
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const X = px + .5, Y = py + .5;
        const ux = X*i0 + Y*i2 + i4, uy = X*i1 + Y*i3 + i5;   // 回到用户空间
        const fx = (ux - dx) / dw, fy = (uy - dy) / dh;
        if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue;
        const u = sx + fx * sw, v = sy + fy * sh;
        const c = smooth ? s.sample(u, v) : s.get(u | 0, v | 0);
        if (!c || c[3] <= 0) continue;
        r.blend(px, py, c[0], c[1], c[2], c[3] * st.alpha);
      }
    },

    getImageData(x, y, w, h) {
      const r = R(), d = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const c = r.get(x + i, y + j), o = (j * w + i) * 4;
        if (c) { d[o] = c[0]; d[o+1] = c[1]; d[o+2] = c[2]; d[o+3] = c[3] * 255; }
      }
      return { width: w, height: h, data: d };
    },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(img, x, y) {
      const r = R();
      for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
        const px = x + i, py = y + j;
        if (px < 0 || py < 0 || px >= r.w || py >= r.h) continue;
        const o = (j * img.width + i) * 4, q = ((py * r.w + px) << 2), a = img.data[o+3] / 255;
        r.d[q] = img.data[o] * a; r.d[q+1] = img.data[o+1] * a; r.d[q+2] = img.data[o+2] * a; r.d[q+3] = a;
      }
    },
  };
  return ctx;
}

function makeCanvas(w, h) {
  const el = { _r: new Raster(w || 1, h || 1), _w: w || 1, _h: h || 1,
    style: {}, dataset: {}, className: '', textContent: '', innerHTML: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    addEventListener(){}, removeEventListener(){}, appendChild(){},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left:0, top:0, width: el._w, height: el._h }) };
  Object.defineProperty(el, 'width',  { get: () => el._w, set: v => { el._w = Math.max(1, v|0); el._r.resize(el._w, el._h); } });
  Object.defineProperty(el, 'height', { get: () => el._h, set: v => { el._h = Math.max(1, v|0); el._r.resize(el._w, el._h); } });
  let c = null;
  el.getContext = () => (c || (c = makeCtx(el)));
  return el;
}

module.exports = { makeCanvas, makeCtx };
