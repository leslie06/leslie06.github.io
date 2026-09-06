/**
 * Procedural canvas textures for the soldier: camo diffuse (multicam / flecktarn / urban),
 * fabric weave normal map, roughness/dirt map, metal scratches, wood grain. All seeded so shot
 * mode is deterministic, all cached so archetypes share GPU textures.
 */
import * as THREE from 'three';
import { Rng } from '../core/Rng';

const cache = new Map<string, THREE.Texture>();

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb: boolean, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise on a grid (period = size). */
function makeNoise(size: number, cells: number, rng: Rng): (x: number, y: number) => number {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const sc = cells / size;
  return (x: number, y: number) => {
    const fx = x * sc, fy = y * sc;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const i = (xx: number, yy: number) => g[((yy % cells + cells) % cells) * cells + ((xx % cells + cells) % cells)];
    const a = i(x0, y0), b = i(x0 + 1, y0), c = i(x0, y0 + 1), d = i(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}
function fbm(size: number, rng: Rng, octaves = 4, base = 8): (x: number, y: number) => number {
  const layers: Array<(x: number, y: number) => number> = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise(size, base << o, rng));
  return (x, y) => { let v = 0, a = 0.5, s = 0; for (const l of layers) { v += l(x, y) * a; s += a; a *= 0.5; } return v / s; };
}

function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }
/** sRGB 0..255 components of a hex colour (THREE.Color would give linear values). */
function rgb(n: number): [number, number, number] { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

interface CamoSpec { base: number; layers: { color: number; count: number; size: [number, number]; elong: number; soft: number }[]; speckle?: { color: number; count: number; size: number } }

const CAMOS: Record<string, CamoSpec> = {
  multicam: {
    base: 0x9c8b66,
    layers: [
      { color: 0x7d6c4d, count: 40, size: [50, 130], elong: 2.2, soft: 0.5 },
      { color: 0x6b6a4c, count: 30, size: [36, 100], elong: 2.0, soft: 0.45 },
      { color: 0x5a4736, count: 26, size: [26, 70], elong: 1.8, soft: 0.35 },
      { color: 0x3d3a2c, count: 18, size: [18, 50], elong: 1.6, soft: 0.3 },
      { color: 0xbfae8a, count: 22, size: [14, 40], elong: 1.5, soft: 0.4 },
    ],
    speckle: { color: 0x4a4432, count: 700, size: 2.4 },
  },
  flecktarn: {
    base: 0x5e6249,
    layers: [
      { color: 0x414a35, count: 90, size: [12, 28], elong: 1.2, soft: 0.2 },
      { color: 0x6a5a42, count: 70, size: [12, 26], elong: 1.2, soft: 0.2 },
      { color: 0x2e2f26, count: 60, size: [9, 20], elong: 1.1, soft: 0.15 },
      { color: 0x7f8560, count: 40, size: [7, 16], elong: 1.1, soft: 0.2 },
    ],
    speckle: { color: 0x2c3323, count: 1400, size: 1.8 },
  },
  desert: {
    base: 0xb7a27c,
    layers: [
      { color: 0x8f7a56, count: 34, size: [50, 130], elong: 2.4, soft: 0.5 },
      { color: 0xa08f6b, count: 26, size: [40, 100], elong: 2.0, soft: 0.45 },
      { color: 0x6e5c43, count: 22, size: [26, 70], elong: 1.9, soft: 0.35 },
      { color: 0xcbbb98, count: 20, size: [16, 46], elong: 1.6, soft: 0.4 },
    ],
    speckle: { color: 0x5c4d38, count: 500, size: 2.2 },
  },
  urban: {
    base: 0x5a5c5e,
    layers: [
      { color: 0x3a3c3f, count: 44, size: [30, 100], elong: 2.0, soft: 0.4 },
      { color: 0x76797c, count: 34, size: [24, 80], elong: 1.9, soft: 0.4 },
      { color: 0x25272a, count: 26, size: [16, 50], elong: 1.7, soft: 0.3 },
      { color: 0x8d9094, count: 18, size: [12, 30], elong: 1.5, soft: 0.35 },
    ],
    speckle: { color: 0x1f2124, count: 700, size: 2 },
  },
};

/** Draws one organic blob as a union of overlapping ellipses (wraps around edges for tiling). */
function blob(ctx: CanvasRenderingContext2D, rng: Rng, size: number, cx: number, cy: number, r: number, elong: number, color: string) {
  ctx.fillStyle = color;
  const parts = 3 + rng.int(0, 4);
  const rot = rng.range(0, Math.PI);
  for (let i = 0; i < parts; i++) {
    const ox = rng.range(-r * 0.6, r * 0.6), oy = rng.range(-r * 0.35, r * 0.35);
    const rx = r * rng.range(0.5, 1) * elong * 0.5, ry = r * rng.range(0.35, 0.8) * 0.5;
    const a = rot + rng.range(-0.5, 0.5);
    for (const [wx, wy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath(); ctx.ellipse(cx + ox + wx, cy + oy + wy, rx, ry, a, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export function camoTexture(kind: string, size: number, aniso: number): THREE.Texture {
  const key = `camo:${kind}:${size}`;
  const hit = cache.get(key); if (hit) return hit;
  const spec = CAMOS[kind] ?? CAMOS.multicam;
  const rng = new Rng(kind.length * 7919 + 11);
  const [c, ctx] = canvas(size);
  const s = size / 512;
  ctx.fillStyle = hex(spec.base); ctx.fillRect(0, 0, size, size);
  for (const layer of spec.layers) {
    for (let i = 0; i < layer.count; i++) {
      blob(ctx, rng, size, rng.range(0, size), rng.range(0, size), rng.range(layer.size[0], layer.size[1]) * s, layer.elong, hex(layer.color));
    }
  }
  if (spec.speckle) {
    ctx.fillStyle = hex(spec.speckle.color);
    for (let i = 0; i < spec.speckle.count * s * s; i++) {
      const r = spec.speckle.size * s * rng.range(0.5, 1.2);
      ctx.beginPath(); ctx.arc(rng.range(0, size), rng.range(0, size), r, 0, Math.PI * 2); ctx.fill();
    }
  }
  // fabric weave + grime in the diffuse so it reads even without the normal map
  const img = ctx.getImageData(0, 0, size, size); const d = img.data;
  const grime = fbm(size, rng, 4, 4);
  const fine = makeNoise(size, size / 2, rng);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.96 : 1.04;
    const g = 1 - Math.max(0, grime(x, y) - 0.45) * 0.55;
    const f = 0.93 + fine(x, y) * 0.14;
    const m = weave * g * f;
    let r = d[i] * m, gg = d[i + 1] * m, bb = d[i + 2] * m * 0.98;
    // pull 15% toward luminance: field-worn cloth is never as saturated as a fresh swatch
    const lum = r * 0.299 + gg * 0.587 + bb * 0.114;
    r += (lum - r) * 0.15; gg += (lum - gg) * 0.15; bb += (lum - bb) * 0.15;
    d[i] = Math.min(255, r); d[i + 1] = Math.min(255, gg); d[i + 2] = Math.min(255, bb);
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, true, aniso); cache.set(key, t); return t;
}

/** Solid-colour nylon/cordura texture with fine texture and wear. */
export function nylonTexture(color: number, size: number, aniso: number): THREE.Texture {
  const key = `nylon:${color}:${size}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(color & 0xffff);
  const [c, ctx] = canvas(size);
  const base = rgb(color);
  const img = ctx.createImageData(size, size); const d = img.data;
  const grime = fbm(size, rng, 4, 4);
  const fine = makeNoise(size, size / 2, rng);
  // PALS webbing: horizontal 25 mm rows with a stitch line every 38 mm (texture = 0.4 m per repeat)
  const row = size / 10;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.93 : 1.06;
    const fy = (y % row) / row;
    const band = fy < 0.62 ? 1 : 0.88;                                  // webbing strip vs. gap shadow
    const edge = (fy < 0.04 || (fy > 0.58 && fy < 0.62)) ? 0.72 : 1;    // strip edges darken
    const stitch = ((x % (row * 1.5)) < 2 && fy < 0.62) ? 0.7 : 1;      // vertical bar tacks
    const w = 1 - Math.max(0, grime(x, y) - 0.5) * 0.5 + (grime(x * 3, y * 3) - 0.5) * 0.15;
    const m = weave * w * band * edge * stitch * (0.94 + fine(x, y) * 0.12);
    d[i] = Math.min(255, base[0] * m); d[i + 1] = Math.min(255, base[1] * m); d[i + 2] = Math.min(255, base[2] * m); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, true, aniso); cache.set(key, t); return t;
}

/** Fabric weave normal map (tileable). `cell` = pixels per thread. */
export function weaveNormal(size: number, cell: number, aniso: number, seed = 3): THREE.Texture {
  const key = `weaveN:${size}:${cell}:${seed}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(seed);
  const noise = fbm(size, rng, 3, 16);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const over = (cx + cy) & 1;
    const fx = ((x % cell) + 0.5) / cell, fy = ((y % cell) + 0.5) / cell;
    const thread = over ? Math.sin(fx * Math.PI) * (0.8 + 0.2 * Math.sin(fy * Math.PI * 2)) : Math.sin(fy * Math.PI) * (0.8 + 0.2 * Math.sin(fx * Math.PI * 2));
    h[y * size + x] = thread * 0.7 + noise(x, y) * 0.6;
  }
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  const strength = 2.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], dn = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, false, aniso); cache.set(key, t); return t;
}

/** Roughness (G) / metalness (B) map. */
export function ormTexture(size: number, rough: number, roughVar: number, metal: number, seed: number, aniso: number): THREE.Texture {
  const key = `orm:${size}:${rough}:${roughVar}:${metal}:${seed}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(seed);
  const n = fbm(size, rng, 4, 6);
  const fine = makeNoise(size, size / 2, rng);
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const r = Math.min(1, Math.max(0, rough + (n(x, y) - 0.5) * roughVar * 2 + (fine(x, y) - 0.5) * roughVar * 0.5));
    d[i] = 255; d[i + 1] = r * 255; d[i + 2] = metal * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, false, aniso); cache.set(key, t); return t;
}

/** Gun metal: dark, with scratches and edge-wear-ish streaks. Returns [diffuse, orm]. */
export function metalTextures(size: number, aniso: number): [THREE.Texture, THREE.Texture] {
  const key = `metal:${size}`;
  const hit = cache.get(key); if (hit) return [hit, cache.get(key + ':orm')!];
  const rng = new Rng(77);
  const [c, ctx] = canvas(size);
  // Parkerised steel, not black. At #26282a with metalness 0.9 a receiver has almost no diffuse
  // term left, so a rifle lying on the road out of the sun rendered as a flat black cutout with
  // orange furniture — which is what the dropped weapon in every ragdoll frame looked like.
  ctx.fillStyle = '#3a3d41'; ctx.fillRect(0, 0, size, size);
  const n = fbm(size, rng, 4, 6);
  const img = ctx.getImageData(0, 0, size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4; const m = 0.85 + n(x, y) * 0.35;
    d[i] *= m; d[i + 1] *= m; d[i + 2] *= m * 1.03;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(160,165,170,0.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, size), y = rng.range(0, size), a = rng.range(-0.4, 0.4), l = rng.range(4, 40);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const t = tex(c, true, aniso); cache.set(key, t);
  // roughness map with scratches shinier
  const [c2, ctx2] = canvas(size);
  const img2 = ctx2.createImageData(size, size); const d2 = img2.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4; const r = 0.45 + n(x, y) * 0.3;
    // metalness 0.69, not 0.9: a weapon has to keep a diffuse term to read anywhere the environment
    // is not reflecting into it — which for a corpse's rifle on shaded asphalt is everywhere.
    d2[i] = 255; d2[i + 1] = r * 255; d2[i + 2] = 175; d2[i + 3] = 255;
  }
  ctx2.putImageData(img2, 0, 0);
  const t2 = tex(c2, false, aniso); cache.set(key + ':orm', t2);
  return [t, t2];
}

/** Rifle furniture: laminated wood or ribbed polymer. */
export function furnitureTexture(kind: 'wood' | 'polymer', size: number, aniso: number): THREE.Texture {
  const key = `furn:${kind}:${size}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(kind === 'wood' ? 5 : 6);
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  const n = fbm(size, rng, 4, 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (kind === 'wood') {
      const grain = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 28 + n(x, y) * 9);
      const r = 92 + grain * 26 + (n(x * 2, y * 2) - 0.5) * 18, g = 66 + grain * 20, b = 46 + grain * 14;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    } else {
      const rib = ((y >> 3) & 1) ? 0.82 : 1;
      const v = (52 + n(x, y) * 18) * rib;
      d[i] = v; d[i + 1] = v * 1.02; d[i + 2] = v * 1.04;
    }
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, true, aniso); cache.set(key, t); return t;
}

/** Skin: warm base with pores + subtle blotch variation. */
export function skinTexture(color: number, size: number, aniso: number): THREE.Texture {
  const key = `skin:${color}:${size}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(color & 0xfff);
  const base = rgb(color);
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  const n = fbm(size, rng, 4, 3);
  const fine = makeNoise(size, size / 3, rng);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const m = 0.9 + n(x, y) * 0.18 + (fine(x, y) - 0.5) * 0.08;
    d[i] = Math.min(255, base[0] * m); d[i + 1] = Math.min(255, base[1] * m * 0.98); d[i + 2] = Math.min(255, base[2] * m * 0.96); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, true, aniso); cache.set(key, t); return t;
}

/** Normal map for a heightfield (tileable). */
function heightToNormal(h: Float32Array, size: number, strength: number, aniso: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], dn = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false, aniso);
}

/**
 * Cloth normal map: fabric weave + long soft folds (gaussian ridges with random direction/length,
 * wrapped for tiling) + fine wrinkle noise. One texture repeat = ~0.95 m on the uniform, so the
 * folds are 4-12 cm wide and 20-60 cm long, like a worn combat shirt.
 */
export function clothNormal(size: number, aniso: number, seed = 5, foldCount = 26): THREE.Texture {
  const key = `clothN:${size}:${seed}:${foldCount}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(seed);
  const h = new Float32Array(size * size);
  const noise = fbm(size, rng, 4, 8);
  const cell = Math.max(2, Math.round(size / 170));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const over = (cx + cy) & 1;
    const fx = ((x % cell) + 0.5) / cell, fy = ((y % cell) + 0.5) / cell;
    const thread = over ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
    h[y * size + x] = thread * 0.25 + noise(x, y) * 0.9;
  }
  // folds: each is a ridge along a segment with a gaussian cross-profile and tapered ends
  const folds: { x: number; y: number; a: number; len: number; w: number; amp: number }[] = [];
  for (let i = 0; i < foldCount; i++) {
    folds.push({ x: rng.range(0, size), y: rng.range(0, size), a: rng.range(0, Math.PI), len: rng.range(0.2, 0.6) * size, w: rng.range(0.035, 0.11) * size, amp: rng.range(0.6, 1.6) * (rng.next() < 0.35 ? -1 : 1) });
  }
  const wraps = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size], [size, size], [-size, -size], [size, -size], [-size, size]];
  for (const f of folds) {
    const dx = Math.cos(f.a), dy = Math.sin(f.a);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let best = 0;
      for (const [wx, wy] of wraps) {
        const px = x - (f.x + wx), py = y - (f.y + wy);
        const along = px * dx + py * dy;
        if (Math.abs(along) > f.len * 0.5) continue;
        const across = -px * dy + py * dx;
        const taper = 1 - (Math.abs(along) / (f.len * 0.5)) ** 2;
        const g = Math.exp(-(across * across) / (2 * f.w * f.w * 0.25));
        const v = g * taper;
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
      h[y * size + x] += best * f.amp * 6;
    }
  }
  const t = heightToNormal(h, size, 2.0, aniso);
  cache.set(key, t); return t;
}

/**
 * Eye texture for a sphere whose +Y pole faces forward: v near 1 = pupil, then iris, then sclera.
 * `iris` colour in sRGB.
 */
export function eyeTexture(iris: number, size: number, aniso: number): THREE.Texture {
  const key = `eye:${iris}:${size}`;
  const hit = cache.get(key); if (hit) return hit;
  const rng = new Rng(iris & 0xffff);
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  const ir = rgb(iris);
  // 12 mm iris on a 25.6 mm eyeball => iris half-angle 28 deg => v > 0.844; pupil ~3.5 mm radius
  const IRIS_V = 0.844, IRIS_SPAN = 1 - IRIS_V, PUPIL = 0.28;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const v = 1 - y / size;                 // canvas top = v 1 = pole (faces forward)
    const u = x / size;
    const ang = v > IRIS_V ? (1 - v) / IRIS_SPAN : 1 + (IRIS_V - v) * 3;   // 0 at pupil centre, 1 at limbus
    let r: number, g: number, b: number;
    if (ang < PUPIL) { r = 7; g = 6; b = 6; }                                     // pupil
    else if (ang < 1) {
      const t = (ang - PUPIL) / (1 - PUPIL);
      // radial fibres + a darker limbal ring at the outer edge
      const fib = 0.72 + 0.28 * Math.sin(u * Math.PI * 2 * 44 + rng.next() * 0.4) * (0.45 + 0.55 * Math.sin(u * 131));
      const rim = t > 0.86 ? 0.42 + 0.58 * (1 - t) / 0.14 : 1;                    // limbal ring
      const lite = 0.5 + 0.75 * t;                                                // darker toward the pupil
      r = ir[0] * fib * rim * lite; g = ir[1] * fib * rim * lite; b = ir[2] * fib * rim * lite;
    } else {
      // warm off-white sclera, shaded toward the corners so it never reads as paper
      const corner = Math.abs(Math.cos(u * Math.PI * 2));
      const shade = 1 - Math.min(1, (ang - 1) * 0.55) * 0.3 - corner * 0.08;
      const vein = Math.max(0, Math.sin(u * 57 + ang * 24) - 0.94) * 3;
      r = 208 * shade; g = (199 - vein * 32) * shade; b = (186 - vein * 38) * shade;
    }
    // catchlight: a small specular dot up-left on the iris, so the eye is alive even in shadow
    const px = ang * Math.cos(u * Math.PI * 2), py = ang * Math.sin(u * Math.PI * 2);
    const cd = Math.hypot(px + 0.4, py - 0.4);
    if (cd < 0.23) { const k = (1 - cd / 0.23) ** 1.6 * 0.6; r += (250 - r) * k; g += (250 - g) * k; b += (255 - b) * k; }
    d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, true, aniso); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; cache.set(key, t); return t;
}

/** Soft elliptical contact-shadow blob (alpha in RGB and A). */
export function blobTexture(size: number): THREE.Texture {
  const key = `blob:${size}`;
  const hit = cache.get(key); if (hit) return hit;
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const r = Math.hypot(dx, dy);
    const a = Math.max(0, 1 - r);
    const v = a * a * (3 - 2 * a);
    d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = v * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  cache.set(key, t); return t;
}
