import * as THREE from 'three';
import { Rng } from '../core/Rng';

/**
 * Procedural canvas textures for the yard. All tileable where they repeat, all seeded so shot mode
 * renders the same pixels every run. Chinese text uses the system CJK face (PingFang on macOS,
 * Microsoft YaHei on Windows).
 */
export const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

function make(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function toTex(c: HTMLCanvasElement, color: boolean, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 8;
  return t;
}

/** Tileable value noise on a `cells`-sized lattice, sampled at (x, y) in [0, 1). */
class TileNoise {
  private v: Float32Array;
  constructor(private cells: number, rng: Rng) {
    this.v = new Float32Array(cells * cells);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next();
  }
  at(x: number, y: number): number {
    const n = this.cells;
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number) => this.v[((j % n + n) % n) * n + ((i % n + n) % n)];
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

function fbm(layers: TileNoise[], x: number, y: number): number {
  let s = 0, amp = 0.5, tot = 0;
  for (const l of layers) { s += l.at(x, y) * amp; tot += amp; amp *= 0.5; }
  return s / tot;
}

/** Worn asphalt: aggregate speckle, tar patches, faint cracks. Colour + roughness. */
export function asphalt(size = 1024, seed = 11): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const rng = new Rng(seed);
  const [c, g] = make(size, size);
  const [rc, rg] = make(size, size);
  const layers = [8, 16, 32, 64].map((n) => new TileNoise(n, rng));
  const img = g.createImageData(size, size), rimg = rg.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // Fine grain only: anything coarse repeats visibly every tile. Large-scale patches live in
    // `asphaltMacro`, which is stretched once over the whole yard.
    const n = fbm(layers, u, v);
    let l = 76 + (n - 0.5) * 22;
    const tar = 0;
    const r = rng.next();
    if (r > 0.985) l += 45 + rng.next() * 40;       // light aggregate
    else if (r < 0.01) l -= 18;
    const i = (y * size + x) * 4;
    img.data[i] = l * 0.98; img.data[i + 1] = l; img.data[i + 2] = l * 1.04; img.data[i + 3] = 255;
    const ro = 225 - tar * 1.6 + (n - 0.5) * 30;
    rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.max(120, Math.min(255, ro)); rimg.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); rg.putImageData(rimg, 0, 0);
  // Hairline cracks.
  g.strokeStyle = 'rgba(20,20,22,0.55)'; g.lineWidth = 1.2;
  for (let k = 0; k < 14; k++) {
    let x = rng.next() * size, y = rng.next() * size, a = rng.next() * Math.PI * 2;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 30; s++) { a += (rng.next() - 0.5) * 0.9; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  return { map: toTex(c, true), rough: toTex(rc, false) };
}

/**
 * Yard-scale variation for the asphalt, mapped once over the whole yard (see world/index): resealed
 * patches, sun-bleached areas, rubbered-in bands. Breaks up the tiling of `asphalt`.
 */
export function asphaltMacro(size = 512, seed = 17): THREE.CanvasTexture {
  const rng = new Rng(seed);
  const [c, g] = make(size, size);
  const layers = [3, 6, 12, 24].map((n) => new TileNoise(n, rng));
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(layers, x / size, y / size);
    const v = Math.max(0, Math.min(255, 128 + (n - 0.5) * 300));
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Rectangular resealed patches (darker), the way a yard is repaired a slab at a time.
  for (let k = 0; k < 26; k++) {
    g.fillStyle = `rgba(0,0,0,${0.12 + rng.next() * 0.18})`;
    const w = 6 + rng.next() * 30, h = 6 + rng.next() * 30;
    g.fillRect(rng.next() * size, rng.next() * size, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.userData.keepImage = true;
  return t;
}

/** Light broom-finished concrete. */
export function concrete(size = 512, seed = 21, tint = [178, 176, 170]): THREE.CanvasTexture {
  const rng = new Rng(seed);
  const [c, g] = make(size, size);
  const layers = [4, 8, 16, 32].map((n) => new TileNoise(n, rng));
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(layers, x / size, y / size);
    const streak = Math.sin((y / size) * Math.PI * 2 * 90 + n * 6) * 3;
    const k = 1 + (n - 0.5) * 0.22 + streak / 255 + (rng.next() - 0.5) * 0.05;
    const i = (y * size + x) * 4;
    img.data[i] = tint[0] * k; img.data[i + 1] = tint[1] * k; img.data[i + 2] = tint[2] * k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, true);
}

/** Dry autumn grass, the colour of a Beijing verge in September. */
export function grass(size = 512, seed = 31): THREE.CanvasTexture {
  const rng = new Rng(seed);
  const [c, g] = make(size, size);
  const layers = [4, 8, 16, 32, 64].map((n) => new TileNoise(n, rng));
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(layers, x / size, y / size);
    const dry = Math.min(1, Math.max(0, (n - 0.42) * 1.6));
    const r = 88 + dry * 62 + (rng.next() - 0.5) * 26, gg = 104 + dry * 38 + (rng.next() - 0.5) * 26, b = 52 + dry * 22;
    const i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, true);
}

/**
 * Blue corrugated site hoarding (蓝色彩钢围挡), the wall around every Beijing lot, with a painted
 * slogan band. One tile = 32 m of wall.
 */
export function hoarding(): THREE.CanvasTexture {
  const [c, g] = make(2048, 192);
  for (let x = 0; x < 2048; x += 16) {
    const grad = g.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, '#1b4f97'); grad.addColorStop(0.5, '#2e6cc0'); grad.addColorStop(1, '#173f7a');
    g.fillStyle = grad; g.fillRect(x, 0, 16, 192);
  }
  // Rust and grime at the foot, a white cap along the top.
  const foot = g.createLinearGradient(0, 150, 0, 192);
  foot.addColorStop(0, 'rgba(60,45,30,0)'); foot.addColorStop(1, 'rgba(60,45,30,0.55)');
  g.fillStyle = foot; g.fillRect(0, 150, 2048, 42);
  g.fillStyle = '#e9ecef'; g.fillRect(0, 0, 2048, 10);
  // Panel seams every 2 m.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 0; x < 2048; x += 128) g.fillRect(x, 0, 3, 192);
  g.fillStyle = '#ffffff';
  g.font = `700 64px ${CJK}`;
  g.textBaseline = 'middle';
  g.fillText('文明驾驶  安全出行', 120, 92);
  g.font = `700 52px ${CJK}`;
  g.fillStyle = '#ffd24a';
  g.fillText('京城驾校', 1280, 92);
  g.fillStyle = '#ffffff';
  g.font = `600 40px ${CJK}`;
  g.fillText('一次拿证  终身安全', 1560, 92);
  return toTex(c, true);
}

/** Two-storey white-tile office with blue glass and a red rooftop sign line. */
export function officeFacade(): THREE.CanvasTexture {
  const [c, g] = make(1024, 256);
  g.fillStyle = '#e4e2dc'; g.fillRect(0, 0, 1024, 256);
  // Tile grid.
  g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 1;
  for (let x = 0; x < 1024; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y < 256; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  for (let floor = 0; floor < 2; floor++) {
    const y0 = 34 + floor * 110;
    for (let x = 24; x < 1000; x += 60) {
      const glass = g.createLinearGradient(0, y0, 0, y0 + 62);
      glass.addColorStop(0, '#6f93b3'); glass.addColorStop(1, '#2d4a66');
      g.fillStyle = '#9aa3a8'; g.fillRect(x - 3, y0 - 3, 44, 68);
      g.fillStyle = glass; g.fillRect(x, y0, 38, 62);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y0, 38, 10);
      g.fillStyle = '#9aa3a8'; g.fillRect(x + 18, y0, 2, 62);
    }
  }
  g.fillStyle = '#8a8f93'; g.fillRect(0, 236, 1024, 20);
  return toTex(c, true);
}

/** Painted ground lettering (worn), transparent background. */
export function stencil(text: string, color = '#f1efe6', w = 512, h = 160): THREE.CanvasTexture {
  const rng = new Rng(text.length * 97 + text.charCodeAt(0));
  const [c, g] = make(w, h);
  g.fillStyle = color;
  g.font = `800 ${Math.round(h * 0.72)}px ${CJK}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  // Wear: knock random holes out of the paint.
  const img = g.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0 && rng.next() < 0.16) img.data[i] *= 0.35;
  g.putImageData(img, 0, 0);
  return toTex(c, true);
}

/** Red gate sign with gold characters. */
export function gateSign(): THREE.CanvasTexture {
  const [c, g] = make(1024, 160);
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, '#c3281f'); grad.addColorStop(1, '#8f1812');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = '#e8c15a'; g.lineWidth = 6; g.strokeRect(10, 10, 1004, 140);
  g.fillStyle = '#ffd772';
  g.font = `800 96px ${CJK}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('京城驾校 · 训练场', 512, 84);
  return toTex(c, true);
}

/** White distance board with a black number (drag strip). */
export function board(text: string): THREE.CanvasTexture {
  const [c, g] = make(256, 256);
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 10; g.strokeRect(8, 8, 240, 240);
  g.fillStyle = '#111';
  g.font = `800 ${text.length > 2 ? 110 : 140}px ${CJK}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 136);
  return toTex(c, true);
}

/** Yellow/black chevrons for the kicker's face. */
export function chevrons(): THREE.CanvasTexture {
  const [c, g] = make(256, 64);
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#161616';
  for (let x = -64; x < 256; x += 48) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 56, 0); g.lineTo(x + 32, 0); g.closePath(); g.fill(); }
  return toTex(c, true);
}
