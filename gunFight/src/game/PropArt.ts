import * as THREE from 'three';
import { Rng } from '../core/Rng';

/**
 * Procedural art for the game module's hero props (resupply crate, frag grenade, ground marker).
 *
 * Everything is generated once, on demand, from 2D canvases: albedo + roughness + a height channel
 * that is converted to a tangent-space normal map. Nothing here runs at module scope so the pure
 * gameplay logic stays importable in node for the unit tests.
 */

type Ctx = CanvasRenderingContext2D;

export interface TexSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
}

/** UV rectangle inside an atlas. */
export interface Rect { u0: number; v0: number; u1: number; v1: number }

function mkCanvas(w: number, h: number, readable = false): { c: HTMLCanvasElement; x: Ctx } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // The height channel is read back with getImageData to build the normal/AO maps; flagging it
  // keeps Chromium from warning and from round-tripping the texture off the GPU.
  const x = c.getContext('2d', readable ? { willReadFrequently: true } : undefined)!;
  return { c, x };
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/**
 * Sobel a greyscale height canvas into an OpenGL-convention (green = +Y) normal map.
 * `flipY` on the resulting texture is the three.js default (true), so v grows as canvas y shrinks,
 * which is why the green channel takes +dH/dy_canvas.
 */
function heightToNormal(src: HTMLCanvasElement, strength: number, aniso = 8): THREE.CanvasTexture {
  const w = src.width, h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const { c, x } = mkCanvas(w, h);
  const img = x.createImageData(w, h);
  const o = img.data;
  const H = (px: number, py: number): number => data[(((py + h) % h) * w + ((px + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < w; px++) {
      const dx = (H(px + 1, y) - H(px - 1, y)) * strength;
      const dy = (H(px, y + 1) - H(px, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * w + px) * 4;
      o[i] = (nx * 0.5 + 0.5) * 255;
      o[i + 1] = (ny * 0.5 + 0.5) * 255;
      o[i + 2] = (nz * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, false, aniso);
}

/**
 * Cheap cavity/AO from the same height canvas: compare each texel against a blurred copy, so
 * anything sitting below its neighbourhood (panel grooves, latch recesses) darkens.
 */
function heightToAo(src: HTMLCanvasElement, radius: number, strength: number, aniso = 8): THREE.CanvasTexture {
  const w = src.width, h = src.height;
  const blur = mkCanvas(w, h, true);
  blur.x.filter = `blur(${radius}px)`;
  blur.x.drawImage(src, 0, 0);
  blur.x.filter = 'none';
  const a = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const b = blur.x.getImageData(0, 0, w, h).data;
  const { c, x } = mkCanvas(w, h);
  const img = x.createImageData(w, h);
  const o = img.data;
  for (let i = 0; i < w * h; i++) {
    const d = (b[i * 4] - a[i * 4]) / 255;
    const v = Math.max(0, Math.min(1, 1 - Math.max(0, d) * strength)) * 255;
    o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v;
    o[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, false, aniso);
}

// ---------------------------------------------------------------- painting helpers

/** Albedo + roughness + height canvases painted in lockstep. */
class Painter {
  constructor(readonly a: Ctx, readonly r: Ctx, readonly b: Ctx) {}
  save(): void { this.a.save(); this.r.save(); this.b.save(); }
  restore(): void { this.a.restore(); this.r.restore(); this.b.restore(); }
  translate(x: number, y: number): void { this.a.translate(x, y); this.r.translate(x, y); this.b.translate(x, y); }
  clip(x: number, y: number, w: number, h: number): void {
    for (const c of [this.a, this.r, this.b]) { c.beginPath(); c.rect(x, y, w, h); c.clip(); }
  }
}

/** Irregular n-gon "splat" — used for paint chips, rust, grime. */
function blob(c: Ctx, cx: number, cy: number, r: number, rng: Rng, lobes = 7): void {
  c.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (0.55 + rng.next() * 0.75);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath(); c.fill();
}

/** Base coat: sprayed olive with roller mottling, sun fade at the top, grime pooling at the bottom. */
function paintBase(p: Painter, w: number, h: number, rng: Rng, base: string, rough: number): void {
  p.a.fillStyle = base; p.a.fillRect(0, 0, w, h);
  const rv = Math.round(rough * 255);
  p.r.fillStyle = `rgb(${rv},${rv},${rv})`; p.r.fillRect(0, 0, w, h);
  p.b.fillStyle = '#808080'; p.b.fillRect(0, 0, w, h);
  // roller / spray mottling
  for (let i = 0; i < 220; i++) {
    const cx = rng.range(0, w), cy = rng.range(0, h), r = rng.range(w * 0.02, w * 0.16);
    const g = p.a.createRadialGradient(cx, cy, 0, cx, cy, r);
    const dark = rng.next() < 0.5;
    const al = rng.range(0.02, 0.08);
    g.addColorStop(0, dark ? `rgba(18,24,10,${al})` : `rgba(150,156,118,${al})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    p.a.fillStyle = g; p.a.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // sun-bleached top third
  const sun = p.a.createLinearGradient(0, 0, 0, h * 0.55);
  sun.addColorStop(0, 'rgba(196,196,160,0.16)'); sun.addColorStop(1, 'rgba(196,196,160,0)');
  p.a.fillStyle = sun; p.a.fillRect(0, 0, w, h);
  // grime / dust settling low
  const gr = p.a.createLinearGradient(0, h, 0, h * 0.4);
  gr.addColorStop(0, 'rgba(38,32,20,0.55)'); gr.addColorStop(1, 'rgba(38,32,20,0)');
  p.a.fillStyle = gr; p.a.fillRect(0, 0, w, h);
  const grr = p.r.createLinearGradient(0, h, 0, h * 0.4);
  grr.addColorStop(0, 'rgba(255,255,255,0.5)'); grr.addColorStop(1, 'rgba(255,255,255,0)');
  p.r.fillStyle = grr; p.r.fillRect(0, 0, w, h);
  // fine orange-peel in the paint film (height only)
  for (let i = 0; i < 2600; i++) {
    const cx = rng.range(0, w), cy = rng.range(0, h), r = rng.range(1.2, 3.4);
    p.b.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    p.b.beginPath(); p.b.arc(cx, cy, r, 0, Math.PI * 2); p.b.fill();
  }
}

/** Chipped paint biased toward panel borders: bare steel core, rust halo, lower roughness. */
function edgeChips(p: Painter, w: number, h: number, rng: Rng, count: number, band = 0.11): void {
  for (let i = 0; i < count; i++) {
    const side = rng.int(0, 3);
    const t = rng.next();
    const d = Math.pow(rng.next(), 2.4) * Math.min(w, h) * band;
    let cx: number, cy: number;
    if (side === 0) { cx = t * w; cy = d; } else if (side === 1) { cx = t * w; cy = h - d; }
    else if (side === 2) { cx = d; cy = t * h; } else { cx = w - d; cy = t * h; }
    const r = rng.range(Math.min(w, h) * 0.004, Math.min(w, h) * 0.018);
    p.a.fillStyle = `rgba(96,64,36,${rng.range(0.16, 0.38)})`; blob(p.a, cx, cy, r * 1.7, rng);
    const s = rng.int(96, 130);
    p.a.fillStyle = `rgb(${s},${s - 4},${s - 10})`; blob(p.a, cx, cy, r, rng);
    p.r.fillStyle = `rgba(70,70,70,0.85)`; blob(p.r, cx, cy, r, rng);
    p.b.fillStyle = 'rgba(0,0,0,0.35)'; blob(p.b, cx, cy, r, rng);
  }
}

/** Hairline scratches showing primer/steel. */
function scratches(p: Painter, w: number, h: number, rng: Rng, count: number): void {
  const m = Math.min(w, h);
  for (let i = 0; i < count; i++) {
    const x0 = rng.range(0, w), y0 = rng.range(0, h);
    // mostly horizontal drag marks; a few short verticals
    const a = rng.range(-0.35, 0.35) + (rng.next() < 0.78 ? 0 : Math.PI / 2);
    const len = rng.range(m * 0.03, m * 0.34);
    p.a.strokeStyle = `rgba(176,178,166,${rng.range(0.08, 0.28)})`;
    p.a.lineWidth = rng.range(0.7, 2.0);
    p.a.beginPath(); p.a.moveTo(x0, y0); p.a.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); p.a.stroke();
    p.r.strokeStyle = 'rgba(96,96,96,0.35)'; p.r.lineWidth = p.a.lineWidth;
    p.r.beginPath(); p.r.moveTo(x0, y0); p.r.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); p.r.stroke();
  }
}

/** Long dirt/rain streaks and settled dust — the macro value break-up the critic asks for. */
function grime(p: Painter, w: number, h: number, rng: Rng, count: number): void {
  for (let i = 0; i < count; i++) {
    const cx = rng.range(0, w), len = rng.range(h * 0.15, h * 0.9), wid = rng.range(w * 0.004, w * 0.03);
    const g = p.a.createLinearGradient(cx, 0, cx, len);
    g.addColorStop(0, `rgba(30,26,16,${rng.range(0.05, 0.17)})`); g.addColorStop(1, 'rgba(30,26,16,0)');
    p.a.fillStyle = g; p.a.fillRect(cx, 0, wid, len);
    const gr = p.r.createLinearGradient(cx, 0, cx, len);
    gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    p.r.fillStyle = gr; p.r.fillRect(cx, 0, wid, len);
  }
  // broad dusty patches
  for (let i = 0; i < count; i++) {
    const cx = rng.range(0, w), cy = rng.range(0, h), r = rng.range(w * 0.03, w * 0.14);
    const g = p.a.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(120,108,78,${rng.range(0.05, 0.16)})`); g.addColorStop(1, 'rgba(120,108,78,0)');
    p.a.fillStyle = g; p.a.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

const STENCIL = '700 %dpx "Arial Narrow", "Helvetica Neue Condensed", Impact, Arial, sans-serif';

/** Stencil-sprayed lettering: slightly bled edges, then eaten back by the chip mask. */
function stencilText(p: Painter, text: string, cx: number, cy: number, size: number, rng: Rng, opts: { color?: string; align?: CanvasTextAlign; wear?: number; track?: number } = {}): void {
  const col = opts.color ?? 'rgba(214,210,188,0.92)';
  const wear = opts.wear ?? 0.5;
  p.a.save(); p.b.save(); p.r.save();
  p.a.font = STENCIL.replace('%d', String(size));
  p.b.font = p.a.font; p.r.font = p.a.font;
  p.a.textAlign = p.b.textAlign = p.r.textAlign = opts.align ?? 'center';
  p.a.textBaseline = p.b.textBaseline = p.r.textBaseline = 'middle';
  if (opts.track) { p.a.letterSpacing = `${opts.track}px`; p.b.letterSpacing = `${opts.track}px`; p.r.letterSpacing = `${opts.track}px`; }
  // spray bleed
  p.a.globalAlpha = 0.22; p.a.fillStyle = col; p.a.filter = 'blur(2px)'; p.a.fillText(text, cx, cy); p.a.filter = 'none';
  p.a.globalAlpha = 1; p.a.fillStyle = col; p.a.fillText(text, cx, cy);
  // paint film sits slightly proud, and is glossier than the surrounding weathered coat
  p.b.fillStyle = 'rgba(255,255,255,0.30)'; p.b.fillText(text, cx, cy);
  p.r.fillStyle = 'rgba(120,120,120,0.75)'; p.r.fillText(text, cx, cy);
  p.a.restore(); p.b.restore(); p.r.restore();
  // wear the letters back out
  const m = p.a.measureText(text);
  const wpx = (m.width || size * text.length * 0.5);
  for (let i = 0; i < Math.round(wear * 34); i++) {
    const bx = cx + rng.range(-wpx * 0.6, wpx * 0.6), by = cy + rng.range(-size * 0.6, size * 0.6);
    p.a.fillStyle = `rgba(60,68,40,${rng.range(0.4, 0.9)})`;
    blob(p.a, bx, by, rng.range(size * 0.04, size * 0.16), rng, 5);
  }
}

/** Embossed / recessed panel line in the height channel only. */
function panelLine(p: Painter, x0: number, y0: number, x1: number, y1: number, wide: number, up: boolean): void {
  p.b.strokeStyle = up ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';
  p.b.lineWidth = wide;
  p.b.beginPath(); p.b.moveTo(x0, y0); p.b.lineTo(x1, y1); p.b.stroke();
  p.a.strokeStyle = up ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.22)';
  p.a.lineWidth = wide;
  p.a.beginPath(); p.a.moveTo(x0, y0); p.a.lineTo(x1, y1); p.a.stroke();
}

function rivetRow(p: Painter, x0: number, y0: number, x1: number, y1: number, n: number, r: number): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    const g = p.b.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(190,190,190,0.6)'); g.addColorStop(1, 'rgba(90,90,90,0)');
    p.b.fillStyle = g; p.b.beginPath(); p.b.arc(cx, cy, r, 0, Math.PI * 2); p.b.fill();
    p.a.fillStyle = 'rgba(120,124,96,0.28)'; p.a.beginPath(); p.a.arc(cx - r * 0.25, cy - r * 0.25, r * 0.55, 0, Math.PI * 2); p.a.fill();
    p.a.fillStyle = 'rgba(24,28,14,0.30)'; p.a.beginPath(); p.a.arc(cx + r * 0.2, cy + r * 0.3, r * 0.6, 0, Math.PI * 2); p.a.fill();
  }
}

// ---------------------------------------------------------------- crate atlas

/** Atlas quadrants (UV space). Long side / lid top / end face / plain sheet. */
export const CRATE_UV = {
  long: { u0: 0, v0: 0.5, u1: 0.5, v1: 1 } as Rect,
  lid: { u0: 0.5, v0: 0.5, u1: 1, v1: 1 } as Rect,
  end: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 } as Rect,
  plain: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 } as Rect,
};

let crateCache: TexSet | null = null;

/**
 * Painted-steel ammunition crate atlas, 4 quadrants.
 *
 * Each quadrant maps to a rectangular face, so it is painted in an aspect-corrected virtual space
 * and squashed horizontally on the way in — otherwise every stencil, rivet and chip would come out
 * stretched 2.45:1 on the long face.
 */
export function crateTextures(aniso = 8): TexSet {
  if (crateCache) return crateCache;
  const S = 2048, Q = 1024;
  const A = mkCanvas(S, S), R = mkCanvas(S, S), B = mkCanvas(S, S, true);
  const p = new Painter(A.x, R.x, B.x);
  const rng = new Rng(0xa11c0);
  const OLIVE = '#657047';

  // canvas y is flipped relative to v (texture flipY = true), so v0..v1 -> y (1-v1)*S .. (1-v0)*S
  const quad = (rect: Rect, aspect: number, draw: (w: number, h: number) => void): void => {
    p.save();
    p.translate(rect.u0 * S, (1 - rect.v1) * S);
    p.clip(0, 0, Q, Q);
    for (const c of [p.a, p.r, p.b]) c.scale(1 / aspect, 1);
    draw(Q * aspect, Q);
    p.restore();
  };

  // --- long side (0.98 x 0.40 m): recessed centre panel + the lot stencil block
  quad(CRATE_UV.long, 2.45, (w, h) => {
    paintBase(p, w, h, rng, OLIVE, 0.6);
    const ix = 70, iy = 52;
    panelLine(p, ix, iy, w - ix, iy, 9, false);
    panelLine(p, ix, h - iy, w - ix, h - iy, 9, false);
    panelLine(p, ix, iy, ix, h - iy, 9, false);
    panelLine(p, w - ix, iy, w - ix, h - iy, 9, false);
    panelLine(p, ix + 9, iy + 9, w - ix - 9, iy + 9, 4, true);
    panelLine(p, ix + 9, h - iy - 9, w - ix - 9, h - iy - 9, 4, true);
    rivetRow(p, 34, 26, w - 34, 26, 14, 8);
    rivetRow(p, 34, h - 26, w - 34, h - 26, 14, 8);
    // lot marking block, left of centre like the real thing
    stencilText(p, '5.56 MM', w * 0.30, h * 0.33, 108, rng, { track: 4 });
    stencilText(p, 'CARTRIDGE   BALL   M855', w * 0.30, h * 0.50, 46, rng, { color: 'rgba(214,210,190,0.9)', track: 2 });
    stencilText(p, '840 CTG   LOT MA-14-K227', w * 0.30, h * 0.63, 36, rng, { color: 'rgba(208,204,184,0.78)', track: 1 });
    // hazard placard + stock number on the right
    p.a.save();
    p.a.translate(w * 0.72, h * 0.42); p.a.rotate(Math.PI / 4);
    p.a.strokeStyle = 'rgba(178,58,44,0.85)'; p.a.lineWidth = 8; p.a.strokeRect(-58, -58, 116, 116);
    p.a.restore();
    stencilText(p, '1.4S', w * 0.72, h * 0.42, 42, rng, { color: 'rgba(186,66,50,0.9)', wear: 0.3 });
    stencilText(p, 'NSN 1305-01-390-4477', w * 0.72, h * 0.63, 26, rng, { color: 'rgba(204,200,182,0.62)', wear: 0.25 });
    grime(p, w, h, rng, 13);
    edgeChips(p, w, h, rng, 190, 0.09);
    scratches(p, w, h, rng, 120);
  });

  // --- lid top (1.01 x 0.55 m): hinge line, stencils, heavy stacking wear
  quad(CRATE_UV.lid, 1.84, (w, h) => {
    paintBase(p, w, h, rng, '#666f45', 0.58);
    panelLine(p, 46, 108, w - 46, 108, 8, false);
    panelLine(p, 46, h - 108, w - 46, h - 108, 8, false);
    panelLine(p, 46, 116, w - 46, 116, 4, true);
    rivetRow(p, 74, 56, w - 74, 56, 12, 8);
    rivetRow(p, 74, h - 56, w - 74, h - 56, 12, 8);
    stencilText(p, 'AMMUNITION', w * 0.5, h * 0.40, 92, rng, { track: 14 });
    stencilText(p, 'THIS SIDE UP', w * 0.5, h * 0.60, 42, rng, { color: 'rgba(206,202,182,0.8)', track: 8 });
    grime(p, w, h, rng, 20);
    // sun-bleached, boot-scuffed top
    for (let i = 0; i < 70; i++) {
      p.a.fillStyle = `rgba(168,172,138,${rng.range(0.05, 0.18)})`;
      blob(p.a, rng.range(0, w), rng.range(0, h), rng.range(24, 96), rng, 9);
    }
    edgeChips(p, w, h, rng, 230, 0.14);
    scratches(p, w, h, rng, 190);
  });

  // --- end face (0.52 x 0.40 m): handle recess + unit marking
  quad(CRATE_UV.end, 1.30, (w, h) => {
    paintBase(p, w, h, rng, '#646e46', 0.62);
    const i2 = 66;
    panelLine(p, i2, i2, w - i2, i2, 8, false);
    panelLine(p, i2, h - i2, w - i2, h - i2, 8, false);
    panelLine(p, i2, i2, i2, h - i2, 8, false);
    panelLine(p, w - i2, i2, w - i2, h - i2, 8, false);
    // shadowed recess the drop handle folds into
    p.a.fillStyle = 'rgba(14,18,8,0.45)'; p.a.fillRect(w * 0.20, h * 0.16, w * 0.60, h * 0.10);
    p.b.fillStyle = 'rgba(0,0,0,0.75)'; p.b.fillRect(w * 0.20, h * 0.16, w * 0.60, h * 0.10);
    stencilText(p, 'A-2', w * 0.5, h * 0.52, 118, rng, { track: 8 });
    stencilText(p, '5.56 BALL', w * 0.5, h * 0.72, 42, rng, { color: 'rgba(204,200,180,0.75)', track: 3 });
    grime(p, w, h, rng, 11);
    edgeChips(p, w, h, rng, 150, 0.10);
    scratches(p, w, h, rng, 90);
  });

  // --- plain painted sheet for undersides, ribs, lugs
  quad(CRATE_UV.plain, 1, (w, h) => {
    paintBase(p, w, h, rng, '#606a42', 0.66);
    grime(p, w, h, rng, 30);
    edgeChips(p, w, h, rng, 110, 0.3);
    scratches(p, w, h, rng, 130);
    const g = p.a.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(44,36,22,0.6)'); g.addColorStop(1, 'rgba(44,36,22,0)');
    p.a.fillStyle = g; p.a.fillRect(0, 0, w, h);
  });

  crateCache = {
    map: toTexture(A.c, true, aniso),
    roughnessMap: toTexture(R.c, false, aniso),
    normalMap: heightToNormal(B.c, 3.6, aniso),
    aoMap: heightToAo(B.c, 7, 3.2, aniso),
  };
  return crateCache;
}

// ---------------------------------------------------------------- grenade

let grenadeCache: TexSet | null = null;

/**
 * M67 body wrap. Lathe UVs run u around the circumference and v bottom -> top, so this is painted
 * as a flat "unrolled" band: olive with the yellow HE identification band and stencils near the top.
 */
export function grenadeTextures(aniso = 8): TexSet {
  if (grenadeCache) return grenadeCache;
  const W = 1024, H = 512;
  const A = mkCanvas(W, H), R = mkCanvas(W, H), B = mkCanvas(W, H, true);
  const p = new Painter(A.x, R.x, B.x);
  const rng = new Rng(0x67ee);
  paintBase(p, W, H, rng, '#4b5430', 0.56);

  // v is bottom->top on the lathe; canvas y is inverted, so "near the top of the grenade" = small y.
  const bandY = H * 0.185, bandH = H * 0.085;
  p.a.fillStyle = '#c19a2c'; p.a.fillRect(0, bandY, W, bandH);
  for (let i = 0; i < 140; i++) {
    p.a.fillStyle = `rgba(60,68,34,${rng.range(0.15, 0.6)})`;
    blob(p.a, rng.range(0, W), bandY + rng.range(-4, bandH + 4), rng.range(3, 12), rng, 6);
  }
  p.r.fillStyle = 'rgba(150,150,150,0.6)'; p.r.fillRect(0, bandY, W, bandH);
  p.b.fillStyle = 'rgba(255,255,255,0.25)'; p.b.fillRect(0, bandY, W, bandH);

  // equator seam where the two pressed halves meet
  panelLine(p, 0, H * 0.4885, W, H * 0.4885, 6, false);
  panelLine(p, 0, H * 0.4885 - 6, W, H * 0.4885 - 6, 3, true);

  // stencils repeated twice around so one face always reads
  for (const off of [0, W / 2]) {
    stencilText(p, 'M67', off + W * 0.25, H * 0.36, 66, rng, { color: 'rgba(24,24,20,0.9)', track: 4, wear: 0.55 });
    stencilText(p, 'GRENADE HAND FRAG DELAY', off + W * 0.25, H * 0.445, 22, rng, { color: 'rgba(26,26,20,0.75)', wear: 0.4 });
    stencilText(p, 'COMP  B    6.5 OZ', off + W * 0.25, H * 0.63, 21, rng, { color: 'rgba(214,210,188,0.6)', wear: 0.5 });
    stencilText(p, 'LOT IOP-08-12', off + W * 0.25, H * 0.71, 17, rng, { color: 'rgba(208,204,184,0.45)', wear: 0.5 });
  }

  // broad tonal variation so the sphere is never one flat green
  for (let i = 0; i < 26; i++) {
    const cx = rng.range(0, W), cy = rng.range(0, H), r = rng.range(60, 200);
    const g = p.a.createRadialGradient(cx, cy, 0, cx, cy, r);
    const light = rng.next() < 0.45;
    g.addColorStop(0, light ? `rgba(130,140,96,${rng.range(0.10, 0.22)})` : `rgba(20,24,10,${rng.range(0.10, 0.24)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    p.a.fillStyle = g; p.a.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  edgeChips(p, W, H, rng, 60, 0.95);
  scratches(p, W, H, rng, 110);
  const g2 = p.a.createLinearGradient(0, H, 0, H * 0.4);
  g2.addColorStop(0, 'rgba(34,28,16,0.22)'); g2.addColorStop(1, 'rgba(34,28,16,0)');
  p.a.fillStyle = g2; p.a.fillRect(0, 0, W, H);

  grenadeCache = {
    map: toTexture(A.c, true, aniso),
    roughnessMap: toTexture(R.c, false, aniso),
    normalMap: heightToNormal(B.c, 2.4, aniso),
    aoMap: heightToAo(B.c, 5, 2.4, aniso),
  };
  return grenadeCache;
}

// ---------------------------------------------------------------- ground marking decal

let markingCache: THREE.CanvasTexture | null = null;

/**
 * The physical half of the resupply marker: a weathered painted floor marking (broken ring +
 * inward chevrons + "AMMO RESUPPLY") over a soot/oil shadow so it holds contrast on pale asphalt.
 * Not emissive — the readable-at-range signal is the thin charge arc drawn on top of it.
 */
export function markingTexture(aniso = 8): THREE.CanvasTexture {
  if (markingCache) return markingCache;
  const S = 1024, c = mkCanvas(S, S);
  const x = c.x;
  const rng = new Rng(0x3a17);
  const R0 = S * 0.5;
  const PAINT = 'rgba(212,199,158,';
  x.translate(R0, R0);

  // 1. soot / oil ground-in shadow under everything, so the paint reads on light asphalt
  const soot = x.createRadialGradient(0, 0, S * 0.20, 0, 0, S * 0.48);
  soot.addColorStop(0, 'rgba(32,28,20,0.02)');
  soot.addColorStop(0.70, 'rgba(32,28,20,0.045)');
  soot.addColorStop(1, 'rgba(32,28,20,0)');
  x.fillStyle = soot; x.fillRect(-R0, -R0, S, S);
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * S * 0.46;
    x.fillStyle = `rgba(26,23,17,${rng.range(0.01, 0.05)})`;
    blob(x, Math.cos(a) * r, Math.sin(a) * r, rng.range(10, 60), rng, 8);
  }

  // 2. dark keyline under the paint (paint is applied over a primer band)
  const stroke = (r: number, wid: number, style: string, a0: number, a1: number) => {
    x.strokeStyle = style; x.lineWidth = wid; x.lineCap = 'butt';
    x.beginPath(); x.arc(0, 0, r, a0, a1); x.stroke();
  };
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI / 2 + 0.20, a1 = (i + 1) * Math.PI / 2 - 0.20;
    stroke(S * 0.400, S * 0.044, 'rgba(34,30,22,0.22)', a0 - 0.02, a1 + 0.02);
  }
  // 3. the paint itself
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI / 2 + 0.20, a1 = (i + 1) * Math.PI / 2 - 0.20;
    stroke(S * 0.400, S * 0.030, PAINT + '0.80)', a0, a1);
  }
  // 4. inward chevrons in the gaps
  for (let i = 0; i < 4; i++) {
    x.save(); x.rotate(i * Math.PI / 2 + Math.PI / 4);
    x.lineJoin = 'miter'; x.lineCap = 'butt';
    for (let k = 0; k < 2; k++) {
      const rr = S * (0.462 - k * 0.052);
      for (const [wid, col] of [[S * 0.030, 'rgba(34,30,22,0.2)'], [S * 0.020, PAINT + '0.78)']] as const) {
        x.strokeStyle = col; x.lineWidth = wid;
        x.beginPath();
        x.moveTo(rr, -S * 0.056); x.lineTo(rr - S * 0.046, 0); x.lineTo(rr, S * 0.056);
        x.stroke();
      }
    }
    x.restore();
  }
  // 5. callout on the near side
  x.save();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 82px "Arial Narrow", "Helvetica Neue Condensed", Impact, Arial, sans-serif';
  x.letterSpacing = '16px';
  x.fillStyle = 'rgba(34,30,22,0.22)'; x.fillText('AMMO', 3, S * 0.290 + 3);
  x.fillStyle = PAINT + '0.78)'; x.fillText('AMMO', 0, S * 0.290);
  x.font = '700 34px "Arial Narrow", Arial, sans-serif';
  x.letterSpacing = '7px';
  x.fillStyle = PAINT + '0.5)'; x.fillText('RESUPPLY', 0, S * 0.345);
  x.restore();

  // 6. wear: chip the paint back, but leave ~65% of it so the marking still reads
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1500; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * R0;
    x.fillStyle = `rgba(0,0,0,${rng.range(0.10, 0.85)})`;
    blob(x, Math.cos(a) * r, Math.sin(a) * r, rng.range(3, 22), rng, 6);
  }
  for (let i = 0; i < 26; i++) {
    x.save(); x.rotate(rng.range(0, Math.PI * 2));
    x.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.55)})`;
    x.fillRect(-S * 0.5, rng.range(-S * 0.5, S * 0.5), S, rng.range(4, 18));
    x.restore();
  }
  // feather the disc edge so there is no visible decal boundary
  const fade = x.createRadialGradient(0, 0, S * 0.44, 0, 0, S * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = fade; x.fillRect(-R0, -R0, S, S);
  x.globalCompositeOperation = 'source-over';

  markingCache = toTexture(c.c, true, aniso);
  markingCache.wrapS = markingCache.wrapT = THREE.ClampToEdgeWrapping;
  return markingCache;
}

// ---------------------------------------------------------------- geometry helpers

const _n = new THREE.Vector3();

/**
 * Box-projected UVs remapped into atlas rectangles, chosen per vertex by dominant normal axis.
 * `size` is the local bounding size the projection normalises against.
 */
export function atlasBoxUv(geo: THREE.BufferGeometry, size: [number, number, number], pick: (axis: 0 | 1 | 2 | 3 | 4 | 5) => Rect, tile = 0): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const [sx, sy, sz] = size;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i) / (tile || sx), y = pos.getY(i) / (tile || sy), z = pos.getZ(i) / (tile || sz);
    _n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    let axis: 0 | 1 | 2 | 3 | 4 | 5, u: number, v: number;
    if (ax >= ay && ax >= az) { axis = _n.x >= 0 ? 0 : 1; u = (_n.x >= 0 ? -z : z) + 0.5; v = y + 0.5; }
    else if (ay >= az) { axis = _n.y >= 0 ? 2 : 3; u = x + 0.5; v = (_n.y >= 0 ? -z : z) + 0.5; }
    else { axis = _n.z >= 0 ? 4 : 5; u = (_n.z >= 0 ? x : -x) + 0.5; v = y + 0.5; }
    const r = pick(axis);
    if (tile) { u = u - Math.floor(u); v = v - Math.floor(v); }
    uv[i * 2] = r.u0 + THREE.MathUtils.clamp(u, 0.004, 0.996) * (r.u1 - r.u0);
    uv[i * 2 + 1] = r.v0 + THREE.MathUtils.clamp(v, 0.004, 0.996) * (r.v1 - r.v0);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv.slice(), 2));
}

/** Flat vertex colour on a geometry (so several tinted parts can share one material). */
export function tint(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/**
 * A flat strip swept along a 3D curve — used for the grenade's safety lever, which is a stamped
 * sheet-metal spoon rather than a rod.
 */
export function ribbon(curve: THREE.Curve<THREE.Vector3>, segments: number, width: number, thickness: number, up = new THREE.Vector3(0, 0, 1)): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], tans: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) { const t = i / segments; pts.push(curve.getPoint(t)); tans.push(curve.getTangent(t).normalize()); }
  const pos: number[] = [], idx: number[] = [];
  const side = new THREE.Vector3(), nrm = new THREE.Vector3();
  const half = width / 2, ht = thickness / 2;
  for (let i = 0; i <= segments; i++) {
    side.copy(up).cross(tans[i]).normalize();
    nrm.copy(tans[i]).cross(side).normalize();
    // slight crown across the width so the spoon has a spine
    for (const [s, t2] of [[-1, 0], [-0.45, 1], [0.45, 1], [1, 0]] as const) {
      const o = pts[i].clone().addScaledVector(side, s * half).addScaledVector(nrm, ht * (0.35 + 0.65 * t2));
      pos.push(o.x, o.y, o.z);
    }
    for (const s of [1, 0.45, -0.45, -1]) {
      const o = pts[i].clone().addScaledVector(side, s * half).addScaledVector(nrm, -ht);
      pos.push(o.x, o.y, o.z);
    }
  }
  const ring = 8;
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k, b = i * ring + ((k + 1) % ring);
      const c = (i + 1) * ring + k, d = (i + 1) * ring + ((k + 1) % ring);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
