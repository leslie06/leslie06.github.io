import * as THREE from 'three';
import { Rng } from '../../core/Rng';
import { CJK } from '../../world/Textures';

/**
 * Facade module atlas: 8x8 modules, each one bay x one floor of a Beijing building, drawn on two
 * canvases in step. `col` (sRGB) is the module's colour; `mat` (linear) says what each pixel is:
 * R = cover (1 = the module paints here, 0 = the wall shows through), G = glass (glossy, lit at
 * night), B = shade (multiplies whatever ends up there: sill and AC-unit shadows fall on the wall).
 * Both canvases are opaque, so nothing is lost to premultiplied alpha.
 *
 * Module space: x from the left, y from the BOTTOM of the cell, 0..1 (the shader's fract(bay),
 * fract(floor)). Rows are counted from the top of the canvas; `ROW` is shared with the shader.
 */
export const ATLAS_N = 8;
export const ROW = { RESID_WIN: 0, RESID_BALC: 1, OFFICE: 2, BRICK_WIN: 3, HUTONG: 4, TRAD: 5, SHOP: 6, MISC: 7 } as const;

class Pen {
  x = 0; y = 0;
  constructor(readonly c: CanvasRenderingContext2D, readonly m: CanvasRenderingContext2D, readonly s: number, public r: Rng) {}
  at(col: number, row: number): void { this.x = col * this.s; this.y = row * this.s; }
  X(fx: number): number { return this.x + fx * this.s; }
  Y(fy: number): number { return this.y + (1 - fy) * this.s; }
  /** Rectangle in module fractions. `col` null keeps the colour; cover < 0 keeps the material. */
  rect(x0: number, y0: number, x1: number, y1: number, col: string | CanvasGradient | null, cover = 1, glass = 0): void {
    const X = this.X(x0), Y = this.Y(y1), W = (x1 - x0) * this.s, H = (y1 - y0) * this.s;
    if (col) { this.c.fillStyle = col; this.c.fillRect(X, Y, W, H); }
    if (cover >= 0) { this.m.fillStyle = `rgb(${Math.round(cover * 255)},${Math.round(glass * 255)},255)`; this.m.fillRect(X, Y, W, H); }
  }
  /** Darken (wall or module) by k, softly. */
  shade(x0: number, y0: number, x1: number, y1: number, k: number, blur = 1.5): void {
    const m = this.m;
    m.save();
    m.beginPath(); m.rect(this.x, this.y, this.s, this.s); m.clip();
    m.globalCompositeOperation = 'multiply';
    m.filter = `blur(${(blur * this.s / 256).toFixed(2)}px)`;
    m.fillStyle = `rgb(255,255,${Math.round(k * 255)})`;
    m.fillRect(this.X(x0), this.Y(y1), (x1 - x0) * this.s, (y1 - y0) * this.s);
    m.restore();
  }
  vgrad(y0: number, y1: number, top: string, bottom: string): CanvasGradient {
    const g = this.c.createLinearGradient(0, this.Y(y1), 0, this.Y(y0));
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    return g;
  }
  line(x0: number, y0: number, x1: number, y1: number, col: string, w: number): void {
    this.c.strokeStyle = col; this.c.lineWidth = w * this.s;
    this.c.beginPath(); this.c.moveTo(this.X(x0), this.Y(y0)); this.c.lineTo(this.X(x1), this.Y(y1)); this.c.stroke();
  }
  disc(x: number, y: number, r: number, col: string): void {
    this.c.fillStyle = col; this.c.beginPath(); this.c.arc(this.X(x), this.Y(y), r * this.s, 0, Math.PI * 2); this.c.fill();
  }
}

const FRAMES = ['#ebebe5', '#e4e4de', '#e9e8e2', '#b6babd', '#ebebe5', '#6b5a4c'];
const CURTAINS = ['#d9c9a3', '#c9b48c', '#e4ddd0', '#b9776a', '#8ea0b4', '#a8b58f', '#d8b9a2', '#9e8a78'];

function glass(p: Pen, x0: number, y0: number, x1: number, y1: number, tint = 0): void {
  const t = ['#35414c', '#303a42', '#3a3f45'][tint % 3], b = ['#1b2229', '#1a1f24', '#202326'][tint % 3];
  p.rect(x0, y0, x1, y1, p.vgrad(y0, y1, t, b), 1, 1);
}

/** What hangs behind the glass (colour only: the pixels stay glass). */
function curtain(p: Pen, kind: number, x0: number, y0: number, x1: number, y1: number, col: string): void {
  const w = x1 - x0, h = y1 - y0;
  p.c.save();
  p.c.globalAlpha = 0.62;
  if (kind === 1) {            // drawn to both sides
    p.rect(x0, y0, x0 + w * 0.3, y1, col, -1); p.rect(x1 - w * 0.26, y0, x1, y1, col, -1);
    for (let k = 1; k < 5; k++) { p.line(x0 + w * 0.3 * k / 5, y0, x0 + w * 0.3 * k / 5, y1, 'rgba(0,0,0,0.25)', 0.006); p.line(x1 - w * 0.26 * k / 5, y0, x1 - w * 0.26 * k / 5, y1, 'rgba(0,0,0,0.25)', 0.006); }
  } else if (kind === 2) {     // blinds half down
    const b = y1 - h * (0.3 + p.r.next() * 0.5);
    for (let y = y1; y > b; y -= 0.022) p.rect(x0, y - 0.012, x1, y, '#d8d6cf', -1);
  } else if (kind === 3) {     // net curtain across
    p.c.globalAlpha = 0.45; p.rect(x0, y0, x1, y1, '#e8e6e0', -1);
  } else if (kind === 4) {     // one side, heavy
    p.rect(x0, y0, x0 + w * 0.55, y1, col, -1);
  } else if (kind === 5) {     // dim room: a lamp and furniture silhouettes
    p.c.globalAlpha = 0.5; p.rect(x0 + w * 0.1, y0, x0 + w * 0.45, y0 + h * 0.35, '#4a3c30', -1); p.disc(x0 + w * 0.7, y1 - h * 0.25, 0.03, '#e8d8b0');
  }
  p.c.restore();
}

function frame(p: Pen, x0: number, y0: number, x1: number, y1: number, t: number, col: string, mullions: number[] = [], transom = 0): void {
  p.rect(x0, y0, x1, y0 + t, col); p.rect(x0, y1 - t, x1, y1, col);
  p.rect(x0, y0, x0 + t, y1, col); p.rect(x1 - t, y0, x1, y1, col);
  for (const mx of mullions) p.rect(mx - t * 0.4, y0, mx + t * 0.4, y1, col);
  if (transom) p.rect(x0, transom - t * 0.4, x1, transom + t * 0.4, col);
}

function acUnit(p: Pen, x0: number, y0: number, w: number, h: number): void {
  p.shade(x0 + 0.012, y0 - 0.035, x0 + w + 0.03, y0 + h - 0.015, 0.55, 3);
  p.rect(x0 + 0.01, y0 - 0.02, x0 + 0.02, y0, '#6d7072'); p.rect(x0 + w - 0.02, y0 - 0.02, x0 + w - 0.01, y0, '#6d7072');
  p.rect(x0, y0, x0 + w, y0 + h, p.vgrad(y0, y0 + h, '#f0f0eb', '#cfd0cc'));
  p.rect(x0, y0 + h - 0.008, x0 + w, y0 + h, '#fafaf7');
  const cx = x0 + w * 0.4, cy = y0 + h * 0.5, r = Math.min(w * 0.33, h * 0.4);
  p.disc(cx, cy, r, '#7e8386');
  for (let k = 1; k <= 3; k++) { p.c.strokeStyle = '#c5c8c6'; p.c.lineWidth = Math.max(1, p.s / 200); p.c.beginPath(); p.c.arc(p.X(cx), p.Y(cy), r * p.s * k / 3.4, 0, Math.PI * 2); p.c.stroke(); }
  for (let k = 0; k < 4; k++) p.rect(x0 + w * 0.78, y0 + h * (0.2 + k * 0.17), x0 + w * 0.94, y0 + h * (0.26 + k * 0.17), '#a9acab');
}

function sill(p: Pen, x0: number, x1: number, y: number, col = '#d7d4cc'): void {
  p.rect(x0 - 0.025, y - 0.03, x1 + 0.025, y, col);
  p.shade(x0 - 0.02, y - 0.07, x1 + 0.03, y - 0.03, 0.72, 2);
}

function reveal(p: Pen, x0: number, y0: number, x1: number, y1: number): void {
  p.shade(x0 - 0.02, y0 - 0.015, x1 + 0.02, y1 + 0.02, 0.8, 2);
}

function bars(p: Pen, x0: number, y0: number, x1: number, y1: number, col = '#c6c9ca'): void {
  p.shade(x0 - 0.03, y0 - 0.06, x1 + 0.05, y0, 0.7, 3);
  for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 9) p.rect(x - 0.005, y0, x + 0.005, y1 + 0.02, col);
  for (const y of [y0, y0 + (y1 - y0) * 0.5, y1 + 0.02]) p.rect(x0 - 0.01, y - 0.008, x1 + 0.01, y + 0.008, col);
  p.rect(x0 - 0.02, y1 + 0.02, x1 + 0.02, y1 + 0.045, '#b3b6b6');
}

function laundry(p: Pen, x0: number, x1: number, y: number): void {
  const cols = ['#c94f45', '#3f6fa8', '#e9e5dc', '#e0b64a', '#6b9e6a', '#2b2b2b', '#d98fb0', '#8a6d5a'];
  p.line(x0, y, x1, y, '#8a8a88', 0.004);
  let x = x0 + 0.02;
  while (x < x1 - 0.08) {
    const w = 0.05 + p.r.next() * 0.08, h = 0.1 + p.r.next() * 0.16;
    p.rect(x, y - h, x + w, y, cols[p.r.int(0, cols.length - 1)], 1, 0);
    x += w + 0.015 + p.r.next() * 0.03;
  }
}

function plants(p: Pen, x0: number, x1: number, y: number): void {
  for (let x = x0; x < x1; x += 0.07 + p.r.next() * 0.05) {
    p.rect(x, y, x + 0.045, y + 0.04, '#8b5a3c');
    p.disc(x + 0.022, y + 0.07, 0.035 + p.r.next() * 0.02, ['#4f7a3a', '#3e6a33', '#6b8f3f'][p.r.int(0, 2)]);
  }
}

// ------------------------------------------------------------------ rows

function residWindow(p: Pen, v: number): void {
  const fc = v === 7 ? '#b6babd' : FRAMES[p.r.int(0, 4)];
  const wide = v === 7;
  const x0 = wide ? 0.14 : 0.22, x1 = wide ? 0.86 : 0.78, y0 = 0.3, y1 = 0.84;
  reveal(p, x0, y0, x1, y1);
  glass(p, x0, y0, x1, y1, v);
  curtain(p, [1, 2, 3, 0, 4, 1, 4, 2][v], x0, y0, x1, y1, CURTAINS[(v * 3 + 1) % CURTAINS.length]);
  const panes = v === 1 || wide ? [x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3] : [(x0 + x1) / 2];
  frame(p, x0, y0, x1, y1, 0.024, fc, panes, v === 5 || wide ? y0 + (y1 - y0) * 0.72 : 0);
  sill(p, x0, x1, y0);
  if (v === 6) plants(p, x0 + 0.02, x1 - 0.04, y0);
  if (v === 2 || v === 7) acUnit(p, 0.36, 0.04, 0.28, 0.19);
  if (v === 3 || v === 5) acUnit(p, 0.805, 0.34, 0.17, 0.22);
  if (v === 4) bars(p, x0 - 0.02, y0 - 0.01, x1 + 0.02, y1);
  // the floor slab line
  p.rect(0, 0, 1, 0.035, null, 0);
}

function residBalcony(p: Pen, v: number): void {
  const open = v >= 6;
  const panel = v < 4 ? '#e8e6df' : v < 6 ? '#d8cbb1' : '#e2e0da';
  p.shade(0, 0.05, 0.04, 1, 0.8); p.shade(0.96, 0.05, 1, 1, 0.8);
  p.rect(0.02, 0, 0.98, 0.07, '#ecebe6');          // balcony slab edge
  p.shade(0.02, 0.9, 0.98, 1.0, 0.72, 2);          // shadow of the slab above
  if (!open) {
    glass(p, 0.04, 0.42, 0.96, 0.97, v);
    if (v === 1 || v === 3) laundry(p, 0.08, 0.92, 0.9);
    if (v === 2 || v === 5) plants(p, 0.08, 0.9, 0.42);
    curtain(p, [3, 0, 0, 0, 1, 2][v] ?? 0, 0.04, 0.42, 0.96, 0.97, CURTAINS[v]);
    frame(p, 0.04, 0.42, 0.96, 0.97, 0.022, '#dfe1e1', [0.27, 0.5, 0.73]);
    p.rect(0.04, 0.07, 0.96, 0.42, p.vgrad(0.07, 0.42, panel, panel));
    p.rect(0.04, 0.4, 0.96, 0.43, '#f2f1ec');
    p.shade(0.04, 0.07, 0.96, 0.4, 0.93, 1);
  } else {
    // recessed balcony: dark interior wall, door and window, railing in front
    p.rect(0.04, 0.07, 0.96, 0.97, '#7d7870', 1);
    glass(p, 0.1, 0.07, 0.42, 0.85, 1); frame(p, 0.1, 0.07, 0.42, 0.85, 0.02, '#e6e6e0', [0.26]);
    glass(p, 0.5, 0.35, 0.9, 0.85, 2); frame(p, 0.5, 0.35, 0.9, 0.85, 0.02, '#e6e6e0', [0.7]);
    if (v === 6) laundry(p, 0.06, 0.94, 0.88);
    p.shade(0.04, 0.07, 0.96, 0.97, 0.7, 1);
    for (let x = 0.05; x < 0.96; x += 0.04) p.rect(x, 0.07, x + 0.012, 0.4, '#d8d9d6');
    p.rect(0.03, 0.38, 0.97, 0.42, '#e8e8e4'); p.rect(0.03, 0.07, 0.97, 0.1, '#e8e8e4');
    if (v === 7) acUnit(p, 0.62, 0.1, 0.26, 0.2);
  }
}

function officeWindow(p: Pen, v: number): void {
  const fc = ['#4a4f54', '#5c5146', '#8d9296', '#3e4246'][v % 4];
  if (v < 4) {
    const x0 = 0.1, x1 = 0.9, y0 = 0.22, y1 = 0.9;
    reveal(p, x0, y0, x1, y1);
    glass(p, x0, y0, x1, y1, v + 1);
    curtain(p, [2, 0, 2, 5][v], x0, y0, x1, y1, '#cfcfcb');
    frame(p, x0, y0, x1, y1, 0.02, fc, [0.5], v === 3 ? 0.75 : 0);
    sill(p, x0, x1, y0, '#c7c4bc');
  } else {
    const y0 = 0.3, y1 = 0.94;
    glass(p, 0, y0, 1, y1, v);
    curtain(p, [2, 0, 2, 3][v - 4], 0, y0, 1, y1, '#cfcfcb');
    frame(p, -0.02, y0, 1.02, y1, 0.018, fc, [0.5, 1.0, 0.0]);
    p.rect(0, y0 - 0.02, 1, y0, '#bdbab2');
    p.shade(0, y1, 1, 1, 0.85, 1);
  }
}

function brickWindow(p: Pen, v: number): void {
  const fc = v === 6 ? '#5f7d63' : v === 3 ? '#8a5a3e' : '#e6e4da';
  const x0 = 0.26, x1 = 0.74, y0 = 0.3, y1 = 0.82;
  if (v === 7) {     // caged balcony
    p.rect(0.12, 0.02, 0.88, 0.9, '#6f6a62', 1);
    glass(p, 0.2, 0.3, 0.8, 0.82, 1);
    laundry(p, 0.16, 0.84, 0.86);
    bars(p, 0.12, 0.05, 0.88, 0.86, '#b9bcbc');
    p.rect(0.1, 0.0, 0.9, 0.06, '#c4c0b8');
    return;
  }
  reveal(p, x0, y0, x1, y1);
  glass(p, x0, y0, x1, y1, v);
  curtain(p, [1, 3, 4, 0, 1, 2, 3][v], x0, y0, x1, y1, CURTAINS[(v * 5) % CURTAINS.length]);
  frame(p, x0, y0, x1, y1, 0.026, fc, [0.5], y0 + (y1 - y0) * 0.66);
  p.rect(x0 - 0.04, y1, x1 + 0.04, y1 + 0.06, '#bdb8ae');   // concrete lintel
  sill(p, x0, x1, y0, '#c9c5bc');
  if (v === 4) acUnit(p, 0.77, 0.3, 0.19, 0.22);
  if (v === 5) bars(p, x0 - 0.02, y0 - 0.01, x1 + 0.02, y1);
}

function hutong(p: Pen, v: number): void {
  // plinth and the eave shadow on every module
  p.rect(0, 0, 1, 0.12, '#6e7173');
  p.rect(0, 0.115, 1, 0.13, '#5f6264');
  p.shade(0, 0.8, 1, 1, 0.55, 5);
  p.rect(0, 0.93, 1, 1, '#5d6062');
  if (v === 1) { glass(p, 0.4, 0.62, 0.6, 0.76, 2); frame(p, 0.4, 0.62, 0.6, 0.76, 0.02, '#4a3a2e', [0.5], 0.69); }
  if (v === 2 || v === 3) {
    const red = v === 2;
    p.rect(0.22, 0.34, 0.78, 0.8, red ? '#8b2a20' : '#4c3a2c');
    p.rect(0.26, 0.38, 0.74, 0.76, '#d8cfb8', 1, 0.35);
    for (let x = 0.26; x < 0.74; x += 0.04) p.rect(x, 0.38, x + 0.01, 0.76, red ? '#7a241c' : '#3e2f24');
    for (let y = 0.38; y < 0.76; y += 0.045) p.rect(0.26, y, 0.74, y + 0.01, red ? '#7a241c' : '#3e2f24');
    p.shade(0.2, 0.3, 0.8, 0.34, 0.7, 2);
  }
  if (v >= 4 && v <= 6) {
    const x0 = v === 5 ? 0.28 : 0.34, x1 = v === 5 ? 0.72 : 0.66, top = 0.74;
    p.shade(x0 - 0.04, 0.12, x1 + 0.04, top + 0.06, 0.6, 3);
    p.rect(x0 - 0.03, 0.12, x1 + 0.03, top + 0.04, '#3f3430');
    p.rect(x0, 0.12, x1, top, '#9e2c22');
    p.rect((x0 + x1) / 2 - 0.005, 0.12, (x0 + x1) / 2 + 0.005, top, '#5a1a14');
    for (const x of [(x0 + x1) / 2 - 0.04, (x0 + x1) / 2 + 0.04]) p.disc(x, 0.45, 0.012, '#c9a14a');
    if (v !== 6) { p.rect(x0 + 0.02, top + 0.06, x1 - 0.02, top + 0.12, '#2e5566'); p.rect(x0 + 0.04, top + 0.075, x1 - 0.04, top + 0.105, '#c4a45a'); }
    p.rect(x0 - 0.09, 0.12, x0 - 0.03, 0.24, '#9a9894'); p.rect(x1 + 0.03, 0.12, x1 + 0.09, 0.24, '#9a9894');
    if (v === 6) { for (let k = 0; k < 2; k++) p.rect(0.3, 0.8 + k * 0.05, 0.7, 0.82 + k * 0.05, '#c8352a'); }
  }
  if (v === 7) {
    p.shade(0.12, 0.12, 0.88, 0.9, 0.5, 4);
    p.rect(0.16, 0.12, 0.84, 0.86, '#443835');
    p.rect(0.3, 0.12, 0.7, 0.7, '#a02d22');
    p.rect(0.495, 0.12, 0.505, 0.7, '#5a1a14');
    p.rect(0.2, 0.74, 0.8, 0.84, '#2f5a47'); p.rect(0.24, 0.76, 0.76, 0.82, '#c9a14a');
    p.rect(0.1, 0.12, 0.9, 0.16, '#9a9894');
  }
}

function trad(p: Pen, v: number): void {
  p.rect(0, 0, 1, 0.08, '#a19d96'); p.rect(0, 0.075, 1, 0.09, '#8d8982');
  p.rect(0, 0.08, 0.07, 0.86, '#7d231b'); p.rect(0.93, 0.08, 1, 0.86, '#7d231b');
  // painted beams under the eave (xuanzi caihua)
  p.rect(0, 0.86, 1, 1, '#2d5d6b');
  p.rect(0, 0.93, 1, 1, '#3f7a57');
  for (let x = 0.05; x < 1; x += 0.2) { p.disc(x + 0.05, 0.895, 0.03, '#e8d9a8'); p.disc(x + 0.05, 0.895, 0.017, '#2d5d6b'); }
  p.rect(0, 0.925, 1, 0.932, '#d6b25c');
  p.shade(0, 0.7, 1, 1, 0.7, 5);
  const lattice = (x0: number, y0: number, x1: number, y1: number) => {
    p.rect(x0, y0, x1, y1, '#e6dcc2', 1, 0.3);
    for (let x = x0; x < x1; x += 0.028) p.rect(x, y0, x + 0.008, y1, '#6e2019');
    for (let y = y0; y < y1; y += 0.028) p.rect(x0, y, x1, y + 0.008, '#6e2019');
  };
  if (v < 4) {
    for (let k = 0; k < 4; k++) {
      const a = 0.09 + k * 0.205, b = a + 0.195;
      p.rect(a, 0.09, b, 0.84, '#8e2a20');
      lattice(a + 0.02, 0.4, b - 0.02, 0.8);
      p.rect(a + 0.03, 0.14, b - 0.03, 0.34, '#7a241c');
      p.rect(a + 0.05, 0.18, b - 0.05, 0.3, '#6a1f18');
    }
  } else {
    p.rect(0.07, 0.09, 0.93, 0.4, v % 2 ? '#8e2c22' : '#8f9294');
    for (let k = 0; k < 4; k++) { const a = 0.09 + k * 0.205, b = a + 0.195; p.rect(a, 0.4, b, 0.84, '#8e2a20'); lattice(a + 0.02, 0.43, b - 0.02, 0.81); }
  }
}

function shop(p: Pen, v: number): void {
  const fr = v === 7 ? '#2d3238' : v === 4 ? '#c9ccce' : '#44484c';
  if (v === 5) {      // closed roller shutter
    p.rect(0.03, 0, 0.97, 0.98, '#a3a6a7');
    for (let y = 0.02; y < 0.98; y += 0.028) p.rect(0.03, y, 0.97, y + 0.008, '#8a8d8e');
    p.rect(0.03, 0.9, 0.97, 0.98, '#7d8081');
    p.rect(0.45, 0.02, 0.55, 0.05, '#555');
    return;
  }
  const inner: Record<number, [string, string]> = { 0: ['#e9e7dd', '#bfc5c7'], 1: ['#e4dcc8', '#b8a88a'], 2: ['#e0b27a', '#8c5a3a'], 3: ['#ece2e0', '#c5b4b0'], 4: ['#f2f3f4', '#c9d0d6'], 6: ['#eef3ef', '#b6c9bc'], 7: ['#dfe3e6', '#9aa6ae'] };
  const [ceil, floor] = inner[v] ?? inner[0];
  p.rect(0.03, 0.02, 0.97, 0.97, p.vgrad(0.02, 0.97, ceil, floor), 1, 1);
  // interior: shelves / tables / counter, colour-only over glass
  p.c.save(); p.c.globalAlpha = 0.85;
  if (v === 0 || v === 4 || v === 6) {
    for (let y = 0.15; y < 0.75; y += 0.14) {
      p.rect(0.36, y, 0.94, y + 0.012, '#8d9294', -1);
      for (let x = 0.37; x < 0.93; x += 0.03 + p.r.next() * 0.02) p.rect(x, y + 0.014, x + 0.018, y + 0.06 + p.r.next() * 0.04, ['#c8423a', '#3a74b8', '#e8c24a', '#4d9a58', '#e8e4d8', '#e07a3a'][p.r.int(0, 5)], -1);
    }
  } else if (v === 1) {
    for (let x = 0.08; x < 0.92; x += 0.06) for (let y = 0.05; y < 0.3; y += 0.05) p.disc(x + p.r.next() * 0.02, y + 0.02, 0.022, ['#e0862a', '#d23c2e', '#e8cf3a', '#7fae3a', '#b8452e'][p.r.int(0, 4)]);
    p.rect(0.06, 0.02, 0.94, 0.05, '#6b4a2e', -1);
  } else if (v === 2) {
    for (let x = 0.15; x < 0.9; x += 0.22) { p.rect(x, 0.2, x + 0.14, 0.24, '#5a3a26', -1); p.rect(x + 0.06, 0.02, x + 0.08, 0.2, '#4a2e1e', -1); }
    for (let x = 0.2; x < 0.9; x += 0.25) { p.line(x, 0.97, x, 0.82, '#2a2a2a', 0.004); p.disc(x, 0.78, 0.045, '#d8342a'); p.rect(x - 0.012, 0.72, x + 0.012, 0.74, '#e8c040'); }
  } else if (v === 3) {
    p.rect(0.5, 0.3, 0.9, 0.85, '#c9bcb6', -1); p.disc(0.62, 0.62, 0.08, '#d7b8a4');
    p.rect(0.12, 0.25, 0.28, 0.5, '#6a4a3a', -1);
  } else if (v === 7) {
    p.rect(0.6, 0.18, 0.78, 0.62, '#6c7a86', -1); p.rect(0.63, 0.45, 0.75, 0.56, '#9fd0e8', -1);
  }
  p.c.restore();
  // stickers on the glass
  if (v === 0 || v === 4) { p.rect(0.4, 0.62, 0.6, 0.7, '#d92e2a', 1, 0); p.rect(0.66, 0.1, 0.9, 0.14, '#e8c43a', 1, 0); }
  if (v === 6) { p.rect(0.72, 0.55, 0.78, 0.75, '#2e9a4a', 1, 0); p.rect(0.65, 0.62, 0.85, 0.68, '#2e9a4a', 1, 0); }
  // door on the left, frames
  frame(p, 0.03, 0.0, 0.97, 0.97, 0.022, fr, [0.33], 0.85);
  frame(p, 0.06, 0.0, 0.3, 0.85, 0.016, fr);
  p.rect(0.265, 0.35, 0.275, 0.55, '#d8d8d8');
  p.rect(0.0, 0.0, 1.0, 0.02, '#8f8d88');
  p.shade(0.03, 0.9, 0.97, 0.97, 0.75, 2);
}

function misc(p: Pen, v: number): void {
  if (v < 2) {
    const x0 = 0.1, x1 = 0.9, y0 = 0.25, y1 = 0.85;
    reveal(p, x0, y0, x1, y1);
    glass(p, x0, y0, x1, y1, 2);
    for (let i = 0; i < 12; i++) if (p.r.next() < 0.25) { const gx = i % 4, gy = Math.floor(i / 4); p.rect(x0 + gx * 0.2, y0 + gy * 0.2, x0 + gx * 0.2 + 0.2, y0 + gy * 0.2 + 0.2, '#9aa3a6', 1, 0.6); }
    frame(p, x0, y0, x1, y1, 0.02, '#4d5256', [0.3, 0.5, 0.7], 0);
    for (const y of [0.45, 0.65]) p.rect(x0, y - 0.008, x1, y + 0.008, '#4d5256');
    sill(p, x0, x1, y0, '#b9b5ad');
  } else if (v < 4) {
    glass(p, 0.08, 0.08, 0.92, 0.96, 1);
    curtain(p, 3, 0.08, 0.08, 0.92, 0.96, '#ffffff');
    frame(p, 0.08, 0.08, 0.92, 0.96, 0.02, '#8a9094', [0.36, 0.64], 0.7);
  } else if (v < 6) {
    const x0 = 0.24, x1 = 0.76, y0 = 0.36, y1 = 0.82;
    reveal(p, x0, y0, x1, y1);
    glass(p, x0, y0, x1, y1, v);
    curtain(p, v === 4 ? 4 : 3, x0, y0, x1, y1, CURTAINS[v]);
    frame(p, x0, y0, x1, y1, 0.024, '#e6e6e0', [0.5]);
    bars(p, x0 - 0.03, y0 - 0.02, x1 + 0.03, y1 + 0.02, '#aeb2b3');
    sill(p, x0, x1, y0);
  } else {
    // unit entrance: steel security door under a small canopy
    p.shade(0.22, 0.0, 0.78, 0.66, 0.6, 3);
    p.rect(0.3, 0.0, 0.7, 0.58, v === 6 ? '#4d5a52' : '#5a5550');
    p.rect(0.32, 0.02, 0.68, 0.56, v === 6 ? '#5f6d64' : '#6b6560');
    p.rect(0.49, 0.02, 0.51, 0.56, '#3a3a38');
    glass(p, 0.36, 0.34, 0.47, 0.5, 0); glass(p, 0.53, 0.34, 0.64, 0.5, 0);
    p.rect(0.2, 0.62, 0.8, 0.68, '#d6d3cb');
    p.shade(0.2, 0.52, 0.8, 0.62, 0.55, 3);
    p.rect(0.44, 0.7, 0.56, 0.78, '#2f5a8a'); p.rect(0.46, 0.72, 0.54, 0.76, '#e8e8e8');
  }
}

const cache = new Map<number, { col: THREE.CanvasTexture; mat: THREE.CanvasTexture }>();

/** Module atlas at `size` px square (8x8 modules). Drawn once per size. */
export function facadeAtlas(size = 2048): { col: THREE.CanvasTexture; mat: THREE.CanvasTexture } {
  const hit = cache.get(size);
  if (hit) return hit;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const cc = mk(), mc = mk();
  const c = cc.getContext('2d')!, m = mc.getContext('2d')!;
  c.fillStyle = '#808080'; c.fillRect(0, 0, size, size);
  m.fillStyle = 'rgb(0,0,255)'; m.fillRect(0, 0, size, size);
  const s = size / ATLAS_N;
  const p = new Pen(c, m, s, new Rng(20260912));
  const rows: ((p: Pen, v: number) => void)[] = [residWindow, residBalcony, officeWindow, brickWindow, hutong, trad, shop, misc];
  rows.forEach((draw, row) => {
    for (let v = 0; v < ATLAS_N; v++) {
      p.at(v, row);
      p.r = new Rng(row * 97 + v * 13 + 5);
      c.save(); c.beginPath(); c.rect(p.x, p.y, s, s); c.clip();
      draw(p, v);
      c.restore();
    }
  });
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const out = { col: tex(cc, true), mat: tex(mc, false) };
  cache.set(size, out);
  return out;
}

/** Shop names for the ground-floor signs: [text, background, lettering]. */
export const SIGNS: [string, string, string][] = [
  ['便利店', '#d8342a', '#ffffff'], ['超市', '#1f5fae', '#ffffff'], ['药店', '#1d8a4a', '#ffffff'], ['餐厅', '#b52a22', '#f6d36b'],
  ['银行', '#1c3f7a', '#e8e8e8'], ['理发', '#2b2b2b', '#f2f2f2'], ['烟酒', '#9c1f1a', '#f6d36b'], ['水果', '#e2702a', '#ffffff'],
  ['面馆', '#f2e6c8', '#a8261e'], ['饺子馆', '#c4291f', '#ffe9a8'], ['早点', '#e8b63a', '#7a1a12'], ['手机维修', '#1b1b1b', '#39c1e8'],
  ['眼镜', '#ffffff', '#1f4f9a'], ['茶叶', '#305c3a', '#e9d9a0'], ['干洗店', '#2a78b8', '#ffffff'], ['快递', '#f1c21b', '#1b1b1b'],
  ['书店', '#5a3a28', '#f2e4c4'], ['宾馆', '#7a1a2a', '#f6d36b'], ['火锅', '#c3121a', '#ffe070'], ['烤鸭店', '#8a1c14', '#f6d36b'],
  ['包子铺', '#f4efe2', '#b42a20'], ['花店', '#e6a0b8', '#ffffff'], ['五金', '#3a4a5a', '#f2f2f2'], ['服装', '#2a2a2a', '#e8c86a'],
  ['母婴', '#f0a8b8', '#ffffff'], ['咖啡', '#3b2a22', '#f2e2c8'], ['麻辣烫', '#d8261e', '#ffffff'], ['奶茶', '#f6e7d0', '#6a3a22'],
  ['牛肉面', '#1a5a8a', '#ffffff'], ['洗车', '#1d6fb8', '#ffe070'], ['文具', '#e24a2a', '#ffffff'], ['24小时', '#1d8a4a', '#ffffff'],
];

let signTex: THREE.CanvasTexture | null = null;
/** 2 columns x 16 rows of 512x64 shop signs (text on a coloured lightbox with a trim). */
export function signAtlas(): THREE.CanvasTexture {
  if (signTex) return signTex;
  const W = 1024, H = 1024, sw = 512, sh = 64;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const rng = new Rng(88);
  SIGNS.forEach(([text, bg, fg], i) => {
    const x = (i % 2) * sw, y = Math.floor(i / 2) * sh;
    g.fillStyle = '#3a3a3a'; g.fillRect(x, y, sw, sh);
    g.fillStyle = bg; g.fillRect(x + 3, y + 4, sw - 6, sh - 8);
    const grad = g.createLinearGradient(0, y, 0, y + sh);
    grad.addColorStop(0, 'rgba(255,255,255,0.18)'); grad.addColorStop(0.5, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    g.fillStyle = grad; g.fillRect(x + 3, y + 4, sw - 6, sh - 8);
    g.fillStyle = fg;
    g.font = `bold 40px ${CJK}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(text).width;
    const scale = Math.min(1, (sw - 150) / tw);
    g.save(); g.translate(x + sw / 2 + (rng.next() < 0.5 ? 18 : 0), y + sh / 2 + 2); g.scale(scale * 1.15, 1);
    g.fillText(text, 0, 0);
    g.restore();
    // a logo roundel or phone number stripe for variety
    if (rng.next() < 0.6) { g.beginPath(); g.fillStyle = fg; g.arc(x + 42, y + sh / 2, 18, 0, Math.PI * 2); g.fill(); g.fillStyle = bg; g.beginPath(); g.arc(x + 42, y + sh / 2, 11, 0, Math.PI * 2); g.fill(); }
    else { g.font = `bold 15px ${CJK}`; g.fillStyle = fg; g.textAlign = 'right'; g.fillText('营业中', x + sw - 16, y + sh / 2 + 1); }
  });
  signTex = new THREE.CanvasTexture(cv);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 8;
  return signTex;
}
