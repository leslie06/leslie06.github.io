import * as THREE from 'three';
import { Rng } from '../../../core/Rng';

/**
 * Procedural canvas textures for the landmarks. Drawn once per page and shared by every landmark.
 * All seeded, so shot mode renders identical pixels each run.
 */
export const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
export const CJK_SERIF = '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", serif';

const cache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}
function mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function toTex(c: HTMLCanvasElement, srgb: boolean, wrap = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Tileable value noise. */
class Noise {
  private v: Float32Array;
  constructor(private n: number, rng: Rng) { this.v = new Float32Array(n * n); for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next(); }
  at(x: number, y: number): number {
    const n = this.n, fx = x * n, fy = y * n, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number) => this.v[((j % n + n) % n) * n + ((i % n + n) % n)];
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}
function fbm(ls: Noise[], x: number, y: number): number { let s = 0, a = 0.5, t = 0; for (const l of ls) { s += l.at(x, y) * a; t += a; a *= 0.5; } return s / t; }

/**
 * Albedo modulation (sRGB grey around 0.85..1) with vertical rain streaks and blotches, 4 m tile.
 * Multiplied by each material's colour.
 */
export function grimeTex(): THREE.CanvasTexture {
  return cached('grime', () => {
    const S = 512, rng = new Rng(21);
    const [c, g] = mk(S, S);
    const ls = [4, 8, 16, 32, 64].map((n) => new Noise(n, rng));
    const streak = [16, 48].map((n) => new Noise(n, rng));
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = fbm(ls, u, v);
      // streaks: noise stretched vertically
      const st = streak[0].at(u, v * 0.06) * 0.6 + streak[1].at(u, v * 0.02) * 0.4;
      let l = 0.93 + (n - 0.5) * 0.22 - Math.max(0, st - 0.55) * 0.35;
      l = Math.min(1, Math.max(0.6, l));
      const i = (y * S + x) * 4, b = Math.round(l * 255);
      img.data[i] = b; img.data[i + 1] = b; img.data[i + 2] = Math.round(b * 0.985); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true);
  });
}

/** White marble: faint veins and weathering, 3 m tile. */
export function marbleTex(): THREE.CanvasTexture {
  return cached('marble', () => {
    const S = 512, rng = new Rng(5);
    const [c, g] = mk(S, S);
    const ls = [4, 8, 16, 32, 64, 128].map((n) => new Noise(n, rng));
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = fbm(ls, u, v);
      const vein = Math.abs(Math.sin((u * 3 + v * 1.3 + n * 2.2) * Math.PI * 2));
      let l = 0.95 + (n - 0.5) * 0.12 - Math.pow(1 - vein, 18) * 0.12;
      l = Math.min(1, l);
      const i = (y * S + x) * 4;
      img.data[i] = l * 255; img.data[i + 1] = l * 252; img.data[i + 2] = l * 246; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // block joints: 1.5 m x 0.75 m blocks (texture spans 3 m)
    g.strokeStyle = 'rgba(90,85,75,0.35)'; g.lineWidth = 1.2;
    for (let r = 0; r < 4; r++) {
      const y = r * S / 4 + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
      for (let k = 0; k < 2; k++) { const x = ((k + (r % 2) * 0.5) * S / 2) % S + 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + S / 4); g.stroke(); }
    }
    return toTex(c, true);
  });
}

/** Blue-grey city brick (青砖, 0.48 x 0.12 m), 2.4 m x 1.2 m tile. Low contrast: it must not moiré at 200 m. */
export function brickTex(): THREE.CanvasTexture {
  return cached('brick', () => {
    const W = 512, H = 256, rng = new Rng(9);
    const [c, g] = mk(W, H);
    g.fillStyle = '#8f9190'; g.fillRect(0, 0, W, H);
    const rows = 10, cols = 5, bh = H / rows, bw = W / cols;
    for (let r = 0; r < rows; r++) for (let k = -1; k < cols; k++) {
      const x = k * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
      const l = 112 + rng.next() * 14 - (rng.next() < 0.06 ? 10 : 0);
      g.fillStyle = `rgb(${l - 2},${l},${l + 3})`;
      g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
    const rng2 = new Rng(10), ls = [8, 32].map((n) => new Noise(n, rng2));
    const img = g.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, m = 0.94 + fbm(ls, x / W, y / H) * 0.12;
      img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m;
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true);
  });
}

/** Stone paving slabs (1 x 0.5 m), 4 m tile. */
export function pavingTex(): THREE.CanvasTexture {
  return cached('paving', () => {
    const S = 512, rng = new Rng(13);
    const [c, g] = mk(S, S);
    const rows = 8, cols = 4, h = S / rows, w = S / cols;
    for (let r = 0; r < rows; r++) for (let k = -1; k < cols; k++) {
      const x = k * w + (r % 2 ? w / 2 : 0), l = 190 + rng.next() * 26;
      g.fillStyle = `rgb(${l},${l - 3},${l - 10})`; g.fillRect(x, r * h, w, h);
      g.strokeStyle = 'rgba(70,65,58,0.5)'; g.lineWidth = 2; g.strokeRect(x + 1, r * h + 1, w - 2, h - 2);
    }
    const rng2 = new Rng(14), ls = [8, 32, 128].map((n) => new Noise(n, rng2));
    const img = g.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, m = 0.84 + fbm(ls, x / S, y / S) * 0.3;
      img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m;
    }
    g.putImageData(img, 0, 0);
    return toTex(c, true);
  });
}

/**
 * Glazed barrel-tile roofing: albedo (grey, tinted by the material colour), normal and roughness.
 * One texture spans 1.2 m x 1.2 m: 4 tile rows (0.3 m) across, 4 courses up the slope.
 */
export const TILE_SPAN = 1.2;
export function tileTex(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const map = cached('tile.map', () => buildTile().map);
  return { map, normal: cache.get('tile.normal') as THREE.CanvasTexture, rough: cache.get('tile.rough') as THREE.CanvasTexture };
}
function buildTile() {
  const S = 256, rows = 4, courses = 4, rng = new Rng(3);
  const [c, g] = mk(S, S), [nc, ng] = mk(S, S), [rc, rg] = mk(S, S);
  const img = g.createImageData(S, S), nimg = ng.createImageData(S, S), rimg = rg.createImageData(S, S);
  const pw = S / rows, ch = S / courses;
  const shade: number[] = [];
  for (let k = 0; k < rows * courses * 2; k++) shade.push(0.9 + rng.next() * 0.16);
  const hgt = (x: number, y: number): number => {
    // x across rows, y up the slope (canvas y grows downwards = down the slope)
    const px = ((x % pw) + pw) % pw / pw;            // 0..1 across one period
    const py = ((y % ch) + ch) % ch / ch;            // 0..1 within a course
    const barrel = Math.abs(px - 0.5) < 0.2 ? Math.sqrt(Math.max(0, 1 - Math.pow((px - 0.5) / 0.2, 2))) : 0;
    const pan = -0.25 * Math.cos(((px + 0.5) % 1 - 0.5) * Math.PI) * (barrel > 0 ? 0 : 1);
    const lap = py * 0.12;                            // each course overlaps the one below
    return (barrel > 0 ? 0.35 + barrel * 0.65 : 0.1 + pan * 0.3) + lap;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const h = hgt(x, y);
    const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 2.2, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 2.2;
    const nx = -dx, ny = dy, nz = 1, l = Math.hypot(nx, ny, nz);
    nimg.data[i] = (nx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
    const px = (x % pw) / pw, py = (y % ch) / ch;
    const onBarrel = Math.abs(px - 0.5) < 0.2;
    const tileId = (Math.floor(y / ch) * rows + Math.floor(x / pw)) * 2 + (onBarrel ? 1 : 0);
    let a = onBarrel ? 0.78 + 0.22 * Math.sqrt(Math.max(0, 1 - Math.pow((px - 0.5) / 0.2, 2))) : 0.5;
    a *= shade[tileId];
    if (py > 0.9) a *= 0.72;                         // shadow under the next course
    if (!onBarrel && Math.abs(px - 0.5) < 0.24) a *= 0.55; // groove beside the barrel
    const b = Math.min(255, a * 255);
    img.data[i] = b; img.data[i + 1] = b; img.data[i + 2] = b; img.data[i + 3] = 255;
    const r = onBarrel ? 70 : 140;                    // green channel = roughness
    rimg.data[i] = r; rimg.data[i + 1] = r; rimg.data[i + 2] = r; rimg.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); ng.putImageData(nimg, 0, 0); rg.putImageData(rimg, 0, 0);
  const map = toTex(c, true), normal = toTex(nc, false), rough = toTex(rc, false);
  cache.set('tile.normal', normal); cache.set('tile.rough', rough);
  return { map, normal, rough };
}

// --- the paint atlas ----------------------------------------------------------------------------
/**
 * One 1024 x 2048 atlas for every painted wooden part, so a hall's beams, brackets, rafters, doors
 * and ceilings are a single draw call. u is in bays (repeats), v selects the band.
 */
export const BAND = {
  beam: [0.0, 0.1], bracket: [0.1, 0.3], soffit: [0.3, 0.4], door: [0.4, 0.78], window: [0.4, 0.62],
  board: [0.78, 0.84], ceil: [0.84, 0.92], solidBlue: [0.925, 0.935], solidGreen: [0.945, 0.955], solidRed: [0.965, 0.975], solidDark: [0.985, 0.995],
} as const;
export type BandName = keyof typeof BAND;
export function bandV(b: BandName, t: number): number { const [a, c] = BAND[b]; return a + (c - a) * t; }

export function paintTex(): THREE.CanvasTexture {
  return cached('paint', () => {
    const W = 1024, H = 2048;
    const [c, g] = mk(W, H);
    const blue = '#1d4f86', blueD = '#143a66', green = '#2c7a5c', greenD = '#1d5a43', gold = '#e0b64e', red = '#8e2016', dark = '#1a1310', white = '#e9e4d6';
    // band helper: draws in a box where (0,0) is the band's top-left on canvas (v1) and h its height
    const band = (b: BandName, fn: (h: number) => void) => {
      const [v0, v1] = BAND[b];
      const y0 = (1 - v1) * H, h = (v1 - v0) * H;
      g.save(); g.translate(0, y0); g.beginPath(); g.rect(0, 0, W, h); g.clip(); fn(h); g.restore();
    };
    // 额枋 with 和玺 painting: green ends, blue middle, gold chevrons, gold dragon squiggles.
    band('beam', (h) => {
      g.fillStyle = blue; g.fillRect(0, 0, W, h);
      g.fillStyle = green; g.fillRect(0, 0, W * 0.24, h); g.fillRect(W * 0.76, 0, W * 0.24, h);
      g.fillStyle = greenD; g.fillRect(0, 0, W * 0.05, h); g.fillRect(W * 0.95, 0, W * 0.05, h);
      g.strokeStyle = gold; g.lineWidth = 7;
      for (const cx of [0.24, 0.76]) {
        const x = cx * W, d = cx < 0.5 ? 1 : -1;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + d * 60, h / 2); g.lineTo(x, h); g.stroke();
        g.beginPath(); g.moveTo(x + d * 30, 0); g.lineTo(x + d * 90, h / 2); g.lineTo(x + d * 30, h); g.stroke();
      }
      // central 枋心 panel
      g.fillStyle = blueD; g.fillRect(W * 0.33, h * 0.14, W * 0.34, h * 0.72);
      g.strokeStyle = gold; g.lineWidth = 5; g.strokeRect(W * 0.33, h * 0.14, W * 0.34, h * 0.72);
      g.lineWidth = 9; g.lineCap = 'round';
      for (const [x0, flip] of [[0.4, 1], [0.6, -1]] as const) {
        g.beginPath();
        for (let k = 0; k <= 24; k++) { const t = k / 24; g.lineTo(W * (x0 + flip * (t - 0.5) * 0.12), h * (0.5 + Math.sin(t * Math.PI * 2.5) * 0.22)); }
        g.stroke();
      }
      g.fillStyle = gold;
      for (const x of [0.12, 0.88]) { g.beginPath(); g.arc(W * x, h / 2, h * 0.22, 0, Math.PI * 2); g.fill(); g.fillStyle = blue; g.beginPath(); g.arc(W * x, h / 2, h * 0.12, 0, Math.PI * 2); g.fill(); g.fillStyle = gold; }
      g.fillStyle = gold; g.fillRect(0, 0, W, 6); g.fillRect(0, h - 6, W, 6);
    });
    // 斗栱 frieze: 6 bracket sets per bay on red boards; the band is seen corbelled outwards.
    band('bracket', (h) => {
      g.fillStyle = red; g.fillRect(0, 0, W, h);
      const n = 6, sw = W / n;
      for (let k = 0; k < n; k++) {
        const cx = (k + 0.5) * sw;
        // flame pearl on the board between sets
        g.fillStyle = gold; g.beginPath(); g.arc(k * sw, h * 0.55, h * 0.06, 0, Math.PI * 2); g.fill();
        // stacked arms, widening upwards
        const tiers = 5;
        for (let t = 0; t < tiers; t++) {
          const y = h * (0.86 - t * 0.17), aw = sw * (0.22 + t * 0.13), ah = h * 0.09;
          g.fillStyle = t % 2 ? green : blue;
          g.beginPath(); g.roundRect(cx - aw / 2, y - ah, aw, ah, ah * 0.45); g.fill();
          g.strokeStyle = white; g.lineWidth = 2.5; g.stroke();
          // 斗 blocks
          for (const bx of t === 0 ? [0] : [-aw / 2 + 10, 0, aw / 2 - 10]) {
            g.fillStyle = t % 2 ? blue : green; g.fillRect(cx + bx - 12, y - ah - h * 0.05, 24, h * 0.05);
            g.strokeStyle = gold; g.lineWidth = 2; g.strokeRect(cx + bx - 12, y - ah - h * 0.05, 24, h * 0.05);
          }
        }
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx - sw * 0.1, h * 0.9, sw * 0.2, h * 0.1);
      }
      g.fillStyle = blue; g.fillRect(0, 0, W, h * 0.06);
      g.fillStyle = green; g.fillRect(0, h * 0.94, W, h * 0.06);
    });
    // Rafters seen from below: 16 per unit, green flying rafters outside, blue eave rafters inside.
    band('soffit', (h) => {
      g.fillStyle = red; g.fillRect(0, 0, W, h);
      const n = 16, sw = W / n;
      for (let k = 0; k < n; k++) {
        const x = k * sw + sw * 0.2;
        g.fillStyle = green; g.fillRect(x, h * 0.55, sw * 0.6, h * 0.45);   // outer part (v near 0 is canvas bottom)
        g.fillStyle = blue; g.fillRect(x, 0, sw * 0.6, h * 0.5);
        g.fillStyle = gold; g.fillRect(x, h * 0.93, sw * 0.6, h * 0.07);
        g.fillStyle = white; g.fillRect(x, h * 0.5, sw * 0.6, h * 0.05);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + sw * 0.5, 0, sw * 0.1, h);
      }
    });
    // 隔扇 doors: 4 leaves per bay, lattice upper part, gilt fittings.
    band('door', (h) => {
      g.fillStyle = red; g.fillRect(0, 0, W, h);
      const n = 4, lw = W / n;
      for (let k = 0; k < n; k++) {
        const x0 = k * lw + 8, w = lw - 16;
        // lattice 菱花: dark gaps behind a red-brown diamond grid
        const ly0 = h * 0.07, ly1 = h * 0.6;
        g.fillStyle = dark; g.fillRect(x0 + 14, ly0, w - 28, ly1 - ly0);
        g.strokeStyle = '#9a3a24'; g.lineWidth = 5;
        const step = 26;
        g.save(); g.beginPath(); g.rect(x0 + 14, ly0, w - 28, ly1 - ly0); g.clip();
        for (let d = -h; d < W + h; d += step) {
          g.beginPath(); g.moveTo(x0 + d, ly0); g.lineTo(x0 + d + (ly1 - ly0) * 0.58, ly1); g.stroke();
          g.beginPath(); g.moveTo(x0 + d, ly0); g.lineTo(x0 + d - (ly1 - ly0) * 0.58, ly1); g.stroke();
        }
        g.strokeStyle = '#b8543a'; g.lineWidth = 3;
        for (let yy = ly0; yy < ly1; yy += step * 0.9) { g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + w, yy); g.stroke(); }
        g.restore();
        // rails and panels
        g.fillStyle = red;
        g.fillRect(x0, ly1, w, h * 0.04);
        g.fillStyle = '#7d1c13'; g.fillRect(x0 + 18, h * 0.66, w - 36, h * 0.06);
        g.fillRect(x0 + 18, h * 0.76, w - 36, h * 0.18);
        g.strokeStyle = gold; g.lineWidth = 3; g.strokeRect(x0 + 18, h * 0.76, w - 36, h * 0.18); g.strokeRect(x0 + 18, h * 0.66, w - 36, h * 0.06);
        g.fillStyle = gold; g.beginPath(); g.ellipse(x0 + w / 2, h * 0.85, w * 0.22, h * 0.05, 0, 0, Math.PI * 2); g.fill();
        // gilt corner fittings (看叶)
        for (const yy of [ly0, ly1, h * 0.72, h * 0.94]) { g.fillRect(x0 + 2, yy - 6, 16, 12); g.fillRect(x0 + w - 18, yy - 6, 16, 12); }
        g.strokeStyle = '#5a130c'; g.lineWidth = 6; g.strokeRect(x0, 3, w, h - 6);
      }
    });
    band('board', (h) => {
      g.fillStyle = red; g.fillRect(0, 0, W, h);
      g.fillStyle = gold;
      for (let k = 0; k < 8; k++) { g.beginPath(); g.ellipse((k + 0.5) * W / 8, h / 2, h * 0.5, h * 0.22, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = blue; g.fillRect(0, 0, W, h * 0.15); g.fillRect(0, h * 0.85, W, h * 0.15);
    });
    // 天花 coffered ceiling: green grid with blue panels and a gold dot.
    band('ceil', (h) => {
      g.fillStyle = greenD; g.fillRect(0, 0, W, h);
      const n = 8, s = W / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < Math.ceil(h / s); j++) {
        g.fillStyle = blueD; g.fillRect(i * s + 8, j * s + 8, s - 16, s - 16);
        g.fillStyle = gold; g.beginPath(); g.arc(i * s + s / 2, j * s + s / 2, s * 0.14, 0, Math.PI * 2); g.fill();
      }
    });
    const solid = (b: BandName, col: string) => band(b, (h) => { g.fillStyle = col; g.fillRect(0, -4, W, h + 8); });
    solid('solidBlue', blue); solid('solidGreen', green); solid('solidRed', red); solid('solidDark', dark);
    const t = toTex(c, true);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Text on a board (plaques, slogans, signs). Returns a clamped sRGB texture. */
export function textTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  return cached('text.' + key, () => {
    const [c, g] = mk(w, h);
    draw(g, w, h);
    return toTex(c, true, false);
  });
}
