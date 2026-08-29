/* ---------------------------------------------------------------------------
   软件光栅化器：把 index.html 里的一帧真画出来，用来在没有浏览器的情况下
   检查画面。支持带抗锯齿的路径填充/描边、2D 变换、双线性缩图、渐变。

   为什么要自己写：矢量画法一上来，"画得对不对"就全在亚像素上了 —— 边缘糊没糊、
   描边粗细对不对、远处的车还剩几个像素。最近邻的假画布看不出这些。
   --------------------------------------------------------------------------- */
'use strict';

/* ---------- 颜色 ---------- */
function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 0];
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
    const v = parseInt(h.slice(0, 6), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0]|0, p[1]|0, p[2]|0, p.length > 3 ? p[3] : 1]; }
  if (c === 'white') return [255,255,255,1];
  if (c === 'black') return [0,0,0,1];
  return [255, 0, 255, 1];                       // 认不出来的画成品红，一眼看得见
}

class Grad {
  constructor(kind, a) { this.kind = kind; this.a = a; this.stops = []; }
  addColorStop(p, c) { this.stops.push([p, parseColor(c)]); this.stops.sort((x, y) => x[0] - y[0]); }
  at(x, y) {
    let t;
    if (this.kind === 'lin') {
      const [x0, y0, x1, y1] = this.a, dx = x1 - x0, dy = y1 - y0, L = dx*dx + dy*dy;
      t = L ? ((x - x0) * dx + (y - y0) * dy) / L : 0;
    } else {
      const [x0, y0, r0, x1, y1, r1] = this.a;
      t = (r1 - r0) ? (Math.hypot(x - x1, y - y1) - r0) / (r1 - r0) : 0;
    }
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = this.stops;
    if (!s.length) return [0,0,0,0];
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) {
      const [p0, c0] = s[i-1], [p1, c1] = s[i], k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return [c0[0]+(c1[0]-c0[0])*k, c0[1]+(c1[1]-c0[1])*k, c0[2]+(c1[2]-c0[2])*k, c0[3]+(c1[3]-c0[3])*k];
    }
    return s[s.length - 1][1];
  }
}

/* ---------- 像素缓冲 ---------- */
class Raster {
  constructor(w, h) { this.w = 0; this.h = 0; this.resize(w, h); }
  resize(w, h) {
    w = Math.max(1, w|0); h = Math.max(1, h|0);
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h; this.d = new Float32Array(w * h * 4);   // 预乘 alpha
  }
  blendPx(i, r, g, b, a) {
    if (a <= 0) return;
    const d = this.d, ia = 1 - a;
    d[i]   = d[i]   * ia + r * a;
    d[i+1] = d[i+1] * ia + g * a;
    d[i+2] = d[i+2] * ia + b * a;
    d[i+3] = d[i+3] * ia + a;
  }
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.blendPx(((y * this.w + x) << 2), r, g, b, a);
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const i = ((y * this.w + x) << 2), d = this.d, a = d[i+3];
    return a <= 0 ? [0,0,0,0] : [d[i]/a, d[i+1]/a, d[i+2]/a, a];
  }
  sample(u, v) {                                  // 双线性，给缩图用
    const x = u - .5, y = v - .5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    let r=0,g=0,b=0,a=0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const w = (i ? fx : 1-fx) * (j ? fy : 1-fy); if (w <= 0) continue;
      const px = Math.min(this.w-1, Math.max(0, x0+i)), py = Math.min(this.h-1, Math.max(0, y0+j));
      const k = ((py*this.w+px)<<2), d = this.d;
      r += d[k]*w; g += d[k+1]*w; b += d[k+2]*w; a += d[k+3]*w;
    }
    return a <= 0 ? null : [r/a, g/a, b/a, a];
  }
}

/* ---------- 带抗锯齿的多边形填充 ----------
   每个像素行切 SUB 条子扫描线，算出跨度后左右两端按覆盖率给小数权重。
   比 4×4 点采样快得多，边缘质量也够看。 */
const SUB = 5;
function fillPolys(raster, polys, paint, alpha, evenOdd, clip) {
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
  const edges = [];
  for (const p of polys) {
    const n = p.length / 2;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const x0 = p[i*2], y0 = p[i*2+1];
      const j = (i + 1) % n, x1 = p[j*2], y1 = p[j*2+1];
      if (y0 === y1) continue;
      edges.push(x0, y0, x1, y1);
      if (y0 < minY) minY = y0; if (y0 > maxY) maxY = y0;
      if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
      if (x0 < minX) minX = x0; if (x0 > maxX) maxX = x0;
      if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1;
    }
  }
  if (!edges.length) return;
  let cy0 = 0, cy1 = raster.h - 1, cx0 = 0, cx1 = raster.w - 1;
  if (clip) { cx0 = Math.max(cx0, Math.floor(clip[0])); cy0 = Math.max(cy0, Math.floor(clip[1]));
              cx1 = Math.min(cx1, Math.ceil(clip[2])); cy1 = Math.min(cy1, Math.ceil(clip[3])); }
  const y0i = Math.max(cy0, Math.floor(minY)), y1i = Math.min(cy1, Math.ceil(maxY));
  const x0i = Math.max(cx0, Math.floor(minX)), x1i = Math.min(cx1, Math.ceil(maxX));
  if (y1i < y0i || x1i < x0i) return;
  const bw = x1i - x0i + 1;
  const cov = new Float32Array(bw);
  const xs = [], wd = [];
  const grad = paint instanceof Grad;
  const col = grad ? null : paint;

  for (let py = y0i; py <= y1i; py++) {
    cov.fill(0);
    for (let s = 0; s < SUB; s++) {
      const sy = py + (s + .5) / SUB;
      xs.length = 0; wd.length = 0;
      for (let e = 0; e < edges.length; e += 4) {
        const ax = edges[e], ay = edges[e+1], bx = edges[e+2], by = edges[e+3];
        if ((sy >= ay && sy < by) || (sy >= by && sy < ay)) {
          xs.push(ax + (sy - ay) / (by - ay) * (bx - ax));
          wd.push(by > ay ? 1 : -1);
        }
      }
      if (xs.length < 2) continue;
      const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
      let wind = 0;
      for (let k = 0; k < idx.length - 1; k++) {
        wind += evenOdd ? 1 : wd[idx[k]];
        const inside = evenOdd ? (wind & 1) : (wind !== 0);
        if (!inside) continue;
        let xa = xs[idx[k]], xb = xs[idx[k+1]];
        if (xb <= x0i || xa >= x1i + 1) continue;
        if (xa < x0i) xa = x0i; if (xb > x1i + 1) xb = x1i + 1;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) { cov[ia - x0i] += (xb - xa) / SUB; continue; }
        cov[ia - x0i] += (ia + 1 - xa) / SUB;
        for (let x = ia + 1; x < ib; x++) cov[x - x0i] += 1 / SUB;
        if (ib <= x1i) cov[ib - x0i] += (xb - ib) / SUB;
      }
    }
    for (let x = 0; x < bw; x++) {
      let c = cov[x]; if (c <= .0008) continue; if (c > 1) c = 1;
      const px = x0i + x;
      const p = grad ? paint.at(px + .5, py + .5) : col;
      raster.blend(px, py, p[0], p[1], p[2], p[3] * alpha * c);
    }
  }
}

/* ---------- 描边：把折线加粗成多边形再填 ----------
   加粗出来的一堆四边形绕向不一定一致，非零填充时会互相抵消出现空洞，
   所以每块都先按有向面积翻正 */
function orient(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    a += poly[i] * poly[j+1] - poly[j] * poly[i+1];
  }
  if (a < 0) {
    const r = [];
    for (let i = poly.length - 2; i >= 0; i -= 2) r.push(poly[i], poly[i+1]);
    return r;
  }
  return poly;
}
function strokeToPolys(polys, w, closedFlags) {
  const out = [];
  const hw = w / 2;
  polys.forEach((p, pi) => {
    const n = p.length / 2;
    if (n < 2) { if (n === 1) out.push([p[0]-hw,p[1]-hw, p[0]+hw,p[1]-hw, p[0]+hw,p[1]+hw, p[0]-hw,p[1]+hw]); return; }
    const closed = closedFlags[pi];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const ax = p[i*2], ay = p[i*2+1], bx = p[j*2], by = p[j*2+1];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      const nx = -dy / L * hw, ny = dx / L * hw;
      out.push([ax+nx, ay+ny, bx+nx, by+ny, bx-nx, by-ny, ax-nx, ay-ny]);
    }
    // 关节处补一个方块，免得转折出现缺口
    const joints = closed ? n : n - 1;
    for (let i = closed ? 0 : 1; i < joints; i++) {
      const x = p[i*2], y = p[i*2+1];
      out.push([x-hw,y-hw, x+hw,y-hw, x+hw,y+hw, x-hw,y+hw]);
    }
  });
  return out.map(orient);
}

module.exports = { parseColor, Grad, Raster, fillPolys, strokeToPolys };
