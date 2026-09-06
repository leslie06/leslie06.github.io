import * as THREE from 'three';

/**
 * Procedural sprite atlas, generated at startup into a DataTexture (a canvas would premultiply
 * alpha and wreck the normal-encoded smoke cells at low alpha).
 *
 * Three kinds of cells share the atlas:
 *  - "lit" cells store a sprite-space normal in RGB and density in A. The particle shader lights
 *    them with the sun/hemisphere (a cheap normal-mapped sprite, the same trick CoD uses for its
 *    6-way lit smoke, minus two directions). Smoke, dust, debris, splinters, paper, clods.
 *  - "unlit" cells store linear color in RGB + alpha: sparks, fire, flashes, blood, every decal.
 *  - the fireball flipbook stores color + alpha too, but is drawn with lit=2 (sphere-normal sun
 *    shading gated by luminance) so its smoke phase has a lit and an unlit side.
 * Grid is 16x16 (256 cells); cell index = row * 16 + col, v grows with row (flipY=false).
 * Painter coordinates: x,y in [-1,1], +y is the top of the billboard.
 */
export const GRID = 16;
export const CELL = {
  FIREBALL: 0, FIREBALL_N: 64,        // rows 0-3: 64-frame fireball flipbook (fBm, rising/expanding, orange -> smoke)
  SMOKE: 64, SMOKE_N: 8,              // row 4: lit smoke puffs
  DUST: 72, DUST_N: 8,                //        lit gritty dust
  SPARK: 80, EMBER: 81, GLOW: 82, DROP: 83, FLAME: 84, FLAME_N: 4, MOTE: 88, RING: 89, SHARD: 90, SHARD_N: 2, FLASH_CONE: 92, FLASH_SIDE: 93, SHOCK: 94, STREAK: 95, // row 5
  FLASH: 96, FLASH_N: 4, BLOOD_SPRAY: 100, BLOOD_SPRAY_N: 4, BLOOD_SPLAT: 104, BLOOD_SPLAT_N: 4, BLOOD_DRIP: 108, BLOOD_DRIP_N: 4, // row 6
  HOLE_CONCRETE: 112, HOLE_CONCRETE_N: 4, HOLE_METAL: 116, HOLE_METAL_N: 3, HOLE_WOOD: 119, HOLE_WOOD_N: 3, HOLE_PLASTER: 122, HOLE_PLASTER_N: 4, HOLE_GLASS: 126, HOLE_GLASS_N: 2, // row 7
  HOLE_BRICK: 128, HOLE_BRICK_N: 3, HOLE_DIRT: 131, HOLE_DIRT_N: 3, HOLE_SANDBAG: 134, HOLE_SANDBAG_N: 2, SCORCH: 136, SCORCH_N: 2, BLOOD_POOL: 138, BLOOD_POOL_N: 2, // row 8
  DEBRIS: 144, DEBRIS_N: 6, SPLINTER: 150, SPLINTER_N: 4, PAPER: 154, FIBER: 155, FIBER_N: 2, CLOD: 157, CLOD_N: 3, // row 9
  SOOT: 160, SOOT_N: 48,              // rows 10-12: soot-crown flipbook (same ball, smoke-dominated, only embers left burning)
  SPARK_TRAIL: 208, SPARK_TRAIL_N: 6, // row 13: irregular impact-spark streaks (see sparkTrail)
} as const;

export interface Atlas { texture: THREE.DataTexture; size: number; cell: number }

// ---------- noise ----------
function hash(ix: number, iy: number, s: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hash3(ix: number, iy: number, iz: number, s: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2246822519) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function vnoise3(x: number, y: number, z: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a0 = hash3(ix, iy, iz, s), b0 = hash3(ix + 1, iy, iz, s), c0 = hash3(ix, iy + 1, iz, s), d0 = hash3(ix + 1, iy + 1, iz, s);
  const a1 = hash3(ix, iy, iz + 1, s), b1 = hash3(ix + 1, iy, iz + 1, s), c1 = hash3(ix, iy + 1, iz + 1, s), d1 = hash3(ix + 1, iy + 1, iz + 1, s);
  const n0 = a0 + (b0 - a0) * ux + (c0 - a0) * uy + (a0 - b0 - c0 + d0) * ux * uy;
  const n1 = a1 + (b1 - a1) * ux + (c1 - a1) * uy + (a1 - b1 - c1 + d1) * ux * uy;
  return n0 + (n1 - n0) * uz;
}
function fbm(x: number, y: number, s: number, oct = 4): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 17); norm += amp; amp *= 0.5; f *= 2.07; }
  return sum / norm;
}
function fbm3(x: number, y: number, z: number, s: number, oct = 4): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise3(x * f, y * f, z * f, s + i * 17); norm += amp; amp *= 0.5; f *= 2.07; }
  return sum / norm;
}
/** Tiny deterministic RNG for shape parameters. */
function srand(seed: number): () => number { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sat = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type Painter = (x: number, y: number, out: Float32Array) => void; // x,y in [-1,1]; out = r,g,b,a (linear, 0..1)

function encodeNormal(nx: number, ny: number, nz: number, a: number, out: Float32Array): void {
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l * 0.5 + 0.5; out[1] = ny / l * 0.5 + 0.5; out[2] = nz / l * 0.5 + 0.5; out[3] = a;
}

// ---------- lit cells ----------
/**
 * Lumpy volumetric puff: sum of noisy spheres, normals from the sphere gradients + noise. Edges
 * are eaten by two frequencies of noise so nothing reads as a disc; density never saturates.
 */
function puff(seed: number, opts: { spheres: number; spread: number; rMin: number; rMax: number; erosion: number; density: number; wisp: number }): Painter {
  const r = srand(seed);
  const S: [number, number, number][] = [];
  for (let i = 0; i < opts.spheres; i++) {
    const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * opts.spread;
    S.push([Math.cos(ang) * d, Math.sin(ang) * d, mix(opts.rMin, opts.rMax, r())]);
  }
  return (x, y, out) => {
    let dens = 0, nx = 0, ny = 0, nz = 0;
    for (const [cx, cy, rad] of S) {
      const dx = (x - cx) / rad, dy = (y - cy) / rad; const d2 = dx * dx + dy * dy;
      if (d2 < 1) { const h = Math.sqrt(1 - d2); const w = h * h * h; dens += w * 0.6; nx += w * dx; ny += w * dy; nz += w * h; }
    }
    const n1 = fbm(x * 2.2 + seed, y * 2.2, seed, 4);
    const n2 = fbm(x * 5 + 3.1, y * 5 - seed, seed + 5, 3);
    dens = dens * (0.7 + 0.6 * n1) - opts.erosion * 0.55 * (n2 - 0.4) - opts.wisp * 0.5 * (0.5 - n1);
    const rr = Math.hypot(x, y);
    dens *= sstep(1.0, 0.55, rr);
    const a = (1 - Math.exp(-Math.max(0, dens) * 1.5 * opts.density)) * 0.9;
    const e = 0.03;
    const gx = (fbm((x + e) * 3.2 + seed, y * 3.2, seed + 9, 3) - fbm((x - e) * 3.2 + seed, y * 3.2, seed + 9, 3)) / (2 * e);
    const gy = (fbm(x * 3.2 + seed, (y + e) * 3.2, seed + 9, 3) - fbm(x * 3.2 + seed, (y - e) * 3.2, seed + 9, 3)) / (2 * e);
    const k = 0.16 * Math.min(1, a * 2);
    // keep real curvature in the normal so the sun side / shadow side read (nz used to be flattened)
    encodeNormal(nx * 0.85 + gx * k, ny * 0.85 + gy * k, nz * 0.8 + 0.3 + (1 - a) * 0.5, a, out);
  };
}

/**
 * Concrete chunk: an irregular blocky silhouette split into 2-3 flat facets with clearly
 * different normals (so the sun makes one face bright and the others dark) plus a bevelled rim.
 * Flat-shaded facets are what stop it reading as a flat cardboard panel; the normals also tilt
 * "down" on the lower facet so the underside stays in shadow.
 */
function debrisChunk(seed: number): Painter {
  const r = srand(seed);
  const n = 5 + Math.floor(r() * 4);
  const verts: number[] = [];
  // blocky, not round: alternate long and short radii
  for (let i = 0; i < n; i++) verts.push(mix(0.45, 0.95, r()) * (i % 2 ? 0.78 : 1));
  const radAt = (th: number) => { const t = ((th / (Math.PI * 2)) % 1 + 1) % 1 * n; const i = Math.floor(t); const f = t - i; const k = f * f * (3 - 2 * f); return mix(verts[i % n], verts[(i + 1) % n], k); };
  const nf = 2 + Math.floor(r() * 2);
  const facets: [number, number, number, number][] = []; // dirX, dirY, offset, tilt
  for (let i = 0; i < nf; i++) { const a = r() * 6.28; facets.push([Math.cos(a), Math.sin(a), (r() - 0.5) * 0.7, mix(0.35, 0.8, r())]); }
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const th = Math.atan2(y, x);
    const R = radAt(th);
    const edge = (R - rr) / R; // 1 at center, 0 at edge
    const a = sstep(-0.01, 0.05, edge);
    const bev = sstep(0.3, 0.0, edge);
    // pick the facet this pixel belongs to; each gets its own flat normal
    let best = 0, bestV = -1e9;
    for (let i = 0; i < facets.length; i++) {
      const v = x * facets[i][0] + y * facets[i][1] + facets[i][2];
      if (v > bestV) { bestV = v; best = i; }
    }
    const [fx2, fy2, , tilt] = facets[best];
    // facet normal, biased downward so undersides sit in shadow, plus the rim bevel
    let nx = fx2 * tilt + (x / rr || 0) * bev * 1.1;
    let ny = fy2 * tilt - 0.22 + (y / rr || 0) * bev * 1.1;
    const nz = 0.85 - bev * 0.5;
    encodeNormal(nx, ny, nz, a, out);
  };
}
/** Rounded dirt clod. */
function clod(seed: number): Painter {
  const r = srand(seed);
  const ex = mix(0.7, 1.0, r()), ey = mix(0.6, 1.0, r()), tilt = r() * 3.14;
  return (x, y, out) => {
    const xx = (x * Math.cos(tilt) + y * Math.sin(tilt)) / ex, yy = (-x * Math.sin(tilt) + y * Math.cos(tilt)) / ey;
    const n = fbm(x * 5 + seed, y * 5, seed, 3);
    const rr = Math.hypot(xx, yy) + (n - 0.5) * 0.25;
    const a = sstep(0.9, 0.8, rr);
    const h = Math.sqrt(Math.max(0, 1 - rr * rr));
    encodeNormal(xx * 0.9 + (n - 0.5) * 0.5, yy * 0.9, h + 0.2, a, out);
  };
}
function splinter(seed: number): Painter {
  const r = srand(seed);
  const w = mix(0.05, 0.11, r()), len = mix(0.75, 0.95, r()), tilt = (r() - 0.5) * 0.15;
  return (x, y, out) => {
    const xx = x + y * tilt;
    const yEnd = 1 - sstep(len - 0.25 * Math.abs(xx / w), len, Math.abs(y) + fbm(x * 8, y * 8, seed) * 0.15);
    const a = sat(sstep(w, w * 0.6, Math.abs(xx))) * yEnd;
    const nx = (xx / w) * 0.9;
    encodeNormal(nx, 0.05, Math.sqrt(Math.max(0.05, 1 - nx * nx)), a, out);
  };
}
/** Torn burlap thread: thin, frayed, slightly kinked. */
function fiber(seed: number): Painter {
  const r = srand(seed);
  const w = mix(0.03, 0.05, r()), kink = mix(0.15, 0.35, r()), freq = mix(4, 7, r());
  return (x, y, out) => {
    const cx = Math.sin(y * freq + seed) * kink;
    const fray = fbm(x * 9, y * 9, seed, 2);
    const a = sstep(w + fray * 0.03, w * 0.4, Math.abs(x - cx)) * sstep(0.95, 0.6, Math.abs(y));
    encodeNormal((x - cx) / w * 0.6, 0.1, 0.8, a, out);
  };
}
function paper(): Painter {
  return (x, y, out) => {
    const inside = sstep(0.72, 0.68, Math.abs(x)) * sstep(0.92, 0.88, Math.abs(y));
    const bend = Math.sin(y * 3.1 + x * 1.3) * 0.45;
    encodeNormal(Math.sin(x * 2.2) * 0.3, bend, 1, inside, out);
  };
}

// ---------- unlit cells ----------
function sparkDot(): Painter {
  return (x, y, out) => {
    const r2 = x * x + y * y;
    const core = Math.exp(-r2 * 16), halo = Math.exp(-r2 * 4.0);
    const a = sat(core * 1.2 + halo * 0.4 - 0.02);
    out[0] = 1; out[1] = mix(0.5, 0.97, core); out[2] = mix(0.12, 0.85, core); out[3] = a;
  };
}
/** Horizontal streak with a hot centre (velocity-stretched sparks / tracers). */
function streak(): Painter {
  return (x, y, out) => {
    const along = sstep(1.0, 0.55, Math.abs(x)) * (0.55 + 0.45 * sstep(-1, 0.3, x));
    const core = Math.exp(-y * y * 60), halo = Math.exp(-y * y * 10);
    const a = sat((core * 1.1 + halo * 0.35) * along);
    out[0] = 1; out[1] = mix(0.55, 0.97, core); out[2] = mix(0.15, 0.85, core); out[3] = a;
  };
}
/**
 * Impact spark: a *fragment of glowing metal*, not a lens artifact. Six seeds, each a bent,
 * tapering streak with a white-hot head, an orange body and a tail that breaks into dashes.
 *
 * The starburst the critic saw was not one bad sprite - it was 24 copies of the same perfectly
 * straight, uniform-width, uniform-length bar radiating from one point, which is a star by
 * construction. So the fix has to be in the silhouette: every variant differs in curvature,
 * where along its length the hot head sits, how far the tail runs, how thick it is and how badly
 * it fragments, so a burst reads as scattered debris even when the velocities are symmetric.
 * +x is the direction of travel (MODE_STRETCH puts the sprite's +x along the velocity).
 */
function sparkTrail(seed: number): Painter {
  const r = srand(seed * 977 + 13);
  const bend = mix(0.06, 0.26, r()) * (r() < 0.5 ? -1 : 1);
  const freq = mix(1.0, 2.7, r());
  const phase = r() * 6.283;
  const head = mix(0.42, 0.9, r());          // where along the streak the hot head sits
  const tailLen = mix(0.7, 1.05, r());       // how far the tail runs back
  const wid = mix(0.45, 1.0, r());           // overall thickness
  const gap = mix(0.3, 0.95, r());           // how badly the tail fragments into dashes
  return (x, y, out) => {
    const yc = bend * Math.sin(x * freq * 2.4 + phase) + bend * 0.45 * Math.sin(x * freq * 5.3 - phase);
    const dy = y - yc;
    // sharp cut just past the head, long fade into the tail
    const along0 = sstep(head + 0.16, head - 0.02, x) * sstep(-tailLen - 0.14, -tailLen * 0.5, x);
    // fragmenting tail: 1-D noise gates the trail into dashes, strongest far behind the head
    const n = fbm(x * 9.5 + seed * 3.7, seed * 1.9, seed + 31, 3);
    const back = sat((head - x) / Math.max(0.25, head + tailLen));
    const along = along0 * Math.max(0, 1 - gap * back * sstep(0.62, 0.3, n));
    // fat at the head, hairline at the tail
    const th = (0.05 + 0.11 * sstep(-0.45, 1.0, x)) * wid;
    const core = Math.exp(-(dy * dy) / (th * th));
    const halo = Math.exp(-(dy * dy) / (th * th * 5));
    const a = sat((core * 1.15 + halo * 0.3) * along);
    // white-hot head -> yellow body -> deep orange tail; the sprite carries the heat gradient so
    // the emitter can stay at a sane HDR level instead of clipping the whole streak to white
    const heat = sat(core * 0.5 + sstep(-tailLen, head + 0.1, x) * 0.8);
    out[0] = 1;
    out[1] = mix(0.24, 0.95, heat);
    out[2] = mix(0.02, 0.7, heat * heat);
    out[3] = a;
  };
}
function ember(): Painter {
  return (x, y, out) => {
    const r2 = x * x + y * y; const n = fbm(x * 4, y * 4, 77, 3);
    const a = sat((Math.exp(-r2 * 6) * (0.7 + 0.6 * n) - 0.05) * 1.1);
    out[0] = 1; out[1] = 0.35 + 0.4 * Math.exp(-r2 * 10); out[2] = 0.08; out[3] = a;
  };
}
function glow(): Painter {
  return (x, y, out) => { const r2 = x * x + y * y; const a = sat(Math.exp(-r2 * 3.2) - 0.04); out[0] = 1; out[1] = 0.82; out[2] = 0.6; out[3] = a; };
}
function drop(): Painter { // liquid droplet: dark red with rim highlight
  return (x, y, out) => {
    const r2 = x * x + y * y; const a = sstep(0.6, 0.35, Math.sqrt(r2));
    const hl = Math.exp(-((x + 0.15) * (x + 0.15) + (y - 0.18) * (y - 0.18)) * 40) * 0.3;
    out[0] = 0.2 + hl; out[1] = 0.012 + hl * 0.5; out[2] = 0.01 + hl * 0.5; out[3] = a;
  };
}
function flame(seed: number): Painter {
  return (x, y, out) => {
    const n = fbm(x * 3 + seed, y * 3 - seed * 0.3, seed, 4);
    const yy = (y + 0.35) / 1.25;
    const rr = Math.hypot(x * (1.15 + yy * 0.9), yy * 0.8 - 0.2);
    const shape = sstep(0.95, 0.25, rr + (n - 0.5) * 0.7);
    const hot = sstep(0.75, 0.1, rr + (n - 0.5) * 0.3);
    out[0] = 1; out[1] = mix(0.35, 0.9, hot); out[2] = mix(0.05, 0.55, hot); out[3] = sat(shape);
  };
}
/** Blackbody-ish ramp: 0 = smoke, 1 = white-hot. */
function heatRamp(h: number, smoke: [number, number, number], out: Float32Array): void {
  let r: number, g: number, b: number;
  if (h > 0.9) { const t = (h - 0.9) / 0.1; r = 1; g = mix(0.82, 0.95, t); b = mix(0.38, 0.75, t); }
  else if (h > 0.6) { const t = (h - 0.6) / 0.3; r = 1; g = mix(0.5, 0.82, t); b = mix(0.08, 0.38, t); }
  else if (h > 0.36) { const t = (h - 0.36) / 0.22; r = mix(0.88, 1, t); g = mix(0.22, 0.52, t); b = mix(0.02, 0.1, t); }
  else if (h > 0.16) { const t = (h - 0.16) / 0.2; r = mix(0.3, 0.88, t); g = mix(0.05, 0.22, t); b = mix(0.012, 0.02, t); }
  else { const t = h / 0.16; r = mix(smoke[0], 0.3, t); g = mix(smoke[1], 0.05, t); b = mix(smoke[2], 0.012, t); }
  out[0] = r; out[1] = g; out[2] = b;
}
/**
 * Explosion fireball flipbook frame f/N: a domain-warped 3D fBm ball that rises, expands and
 * mushrooms while its heat drains from white-yellow through orange to dark, top-lit smoke. All
 * frames sample one continuous 3D noise field (frame index = z), so the animation is smooth.
 */
function fireball(f: number, N: number, seed: number): Painter {
  const u = f / (N - 1);
  const R = 0.34 + 0.38 * (1 - Math.exp(-3.5 * u));
  const y0 = -0.32 + 0.42 * u;
  const evolve = u * 2.6;
  const heatDecay = Math.exp(-3.2 * u) * 0.85 + 0.02;
  const fade = 1 - sstep(0.6, 1.0, u);
  const smoke: [number, number, number] = [0.2, 0.19, 0.18];
  const px = new Float32Array(3);
  return (x, y, out) => {
    const dy = y - y0;
    const ry = dy > 0 ? dy * 0.9 : dy * 1.35; // flatter bottom, taller top (mushroom)
    const w1 = fbm3(x * 1.7 + seed, y * 1.7 - u * 1.2, evolve, seed + 3, 3);
    const w2 = fbm3(x * 1.7 - seed, y * 1.7 - u * 1.2 + 7, evolve + 5, seed + 9, 3);
    const wx = x + (w1 - 0.5) * 0.7, wy = y + (w2 - 0.5) * 0.7;
    const n = fbm3(wx * 2.6, wy * 2.6 - u * 2.0, evolve, seed + 11, 5);
    const n2 = fbm3(wx * 5.5, wy * 5.5 - u * 3.0, evolve * 1.5, seed + 23, 3); // fine sooty streaks
    const rr = Math.hypot(x, ry);
    const edge = rr / R + (n - 0.5) * (0.9 + 0.4 * u);
    // Wide erosion ramp on purpose. With a narrow one the ball had a fully opaque core disc, and
    // an explosion is 13 of these stacked - each opaque core hid the lobes behind it, which is
    // what made the fireball read as "4-5 discrete circular blobs" instead of one volume.
    let shape = sstep(1.42, 0.32, edge);
    shape *= sstep(1.0, 0.8, Math.hypot(x, y)); // never touch the cell border
    const dens = shape * (0.35 + 1.0 * n);
    const core = sat(1 - rr / (R * 1.05));
    const heat = sat(dens * heatDecay * (0.25 + core * 1.15) * (0.3 + n * 1.1) * (0.5 + n2 * 0.95) * (1.0 - 0.45 * sstep(0.1, 0.75, dy / Math.max(R, 0.2))));
    // baked self-shadow for the smoke phase: top-lit, denser lumps darker underneath
    const shade = 0.5 + 0.5 * sat(0.55 + (dy / Math.max(R, 0.25)) * 0.7 - (n - 0.5) * 0.8);
    heatRamp(heat, smoke, px);
    const sm = 1 - sstep(0.05, 0.3, heat);
    const k = mix(1, shade, sm);
    out[0] = px[0] * k; out[1] = px[1] * k; out[2] = px[2] * k;
    out[3] = Math.min(sat(dens * 1.45), 0.9) * fade * (1 - 0.25 * sm * u);
  };
}
/**
 * Soot crown flipbook frame f/N: the same turbulent ball as `fireball`, but the heat is nearly
 * gone from the start — dense dark smoke with a few embers still glowing in the folds. Used for
 * the upper lobes of an explosion so the fireball gets a dark, silhouetted crown instead of
 * reading as a uniformly bright orange cluster.
 */
function sootBall(f: number, N: number, seed: number): Painter {
  const u = f / (N - 1);
  const R = 0.36 + 0.42 * (1 - Math.exp(-2.6 * u));
  const y0 = -0.28 + 0.5 * u;
  const evolve = u * 2.2;
  const emberDecay = Math.exp(-4.5 * u);
  const fade = 1 - sstep(0.65, 1.0, u);
  const px = new Float32Array(3);
  return (x, y, out) => {
    const dy = y - y0;
    const ry = dy > 0 ? dy * 0.88 : dy * 1.3;
    const w1 = fbm3(x * 1.6 + seed, y * 1.6 - u, evolve, seed + 3, 3);
    const w2 = fbm3(x * 1.6 - seed, y * 1.6 - u + 7, evolve + 5, seed + 9, 3);
    const wx = x + (w1 - 0.5) * 0.75, wy = y + (w2 - 0.5) * 0.75;
    const n = fbm3(wx * 2.5, wy * 2.5 - u * 1.6, evolve, seed + 11, 5);
    const n2 = fbm3(wx * 6.0, wy * 6.0 - u * 2.4, evolve * 1.4, seed + 23, 3);
    const rr = Math.hypot(x, ry);
    const edge = rr / R + (n - 0.5) * (0.85 + 0.45 * u);
    let shape = sstep(1.3, 0.45, edge);
    shape *= sstep(1.0, 0.8, Math.hypot(x, y));
    const dens = shape * (0.45 + 0.9 * n);
    // embers survive only deep in the folds, and only early
    const core = sat(1 - rr / (R * 0.8));
    const heat = sat(dens * emberDecay * core * (0.15 + n2 * 0.85) * sstep(0.45, 0.85, n2)) * 0.75;
    // billowing smoke shading: lit tops, dark undersides, denser lumps darker
    const shade = 0.32 + 0.68 * sat(0.5 + (dy / Math.max(R, 0.2)) * 0.8 - (n - 0.5) * 1.1 + (n2 - 0.5) * 0.35);
    const smoke: [number, number, number] = [0.115 + 0.06 * n2, 0.105 + 0.05 * n2, 0.098 + 0.045 * n2];
    heatRamp(heat, smoke, px);
    const sm = 1 - sstep(0.04, 0.28, heat);
    const k = mix(1, shade, sm);
    out[0] = px[0] * k; out[1] = px[1] * k; out[2] = px[2] * k;
    // underside feather: the bottom of a smoke crown is torn and translucent where it meets the
    // fire, so let the flame glow through instead of ending on a hard silhouette edge
    const under = mix(0.35, 1.0, sstep(-1.0, 0.15, dy / Math.max(R, 0.2)) ) * mix(0.7, 1.0, n2);
    out[3] = sat(dens * 1.9) * fade * under;
  };
}
function bloodSplat(seed: number): Painter {
  const r = srand(seed);
  const drops: [number, number, number, number][] = [];
  const nd = 10 + Math.floor(r() * 9);
  for (let i = 0; i < nd; i++) { const ang = r() * Math.PI * 2, d = mix(0.3, 0.92, r()); drops.push([Math.cos(ang) * d, Math.sin(ang) * d, mix(0.025, 0.09, r() * r()), ang]); }
  const drips: [number, number, number][] = [];
  const ndr = 1 + Math.floor(r() * 3);
  for (let i = 0; i < ndr; i++) drips.push([(r() - 0.5) * 0.4, mix(0.25, 0.75, r()), mix(0.012, 0.03, r())]);
  const blobR = mix(0.26, 0.38, r());
  return (x, y, out) => {
    const n = fbm(x * 5 + seed, y * 5, seed, 3);
    const rr = Math.hypot(x, y);
    let a = sstep(blobR + 0.08, blobR - 0.06, rr + (n - 0.5) * 0.35);
    for (const [cx, cy, cr, ang] of drops) {
      const dx = x - cx, dy = y - cy; const along = dx * Math.cos(ang) + dy * Math.sin(ang); const perp = -dx * Math.sin(ang) + dy * Math.cos(ang);
      const stretch = along < 0 ? 2.2 : 1;
      const d = Math.hypot(along / stretch, perp);
      a = Math.max(a, sstep(cr, cr * 0.55, d));
    }
    for (const [dx, len, w] of drips) {
      if (y < 0 && y > -len - 0.2) { const ww = w * (1 + (y + len) * 0.6) + (n - 0.5) * 0.01; a = Math.max(a, sstep(ww, ww * 0.5, Math.abs(x - dx)) * sstep(-len - 0.1, -len + 0.05, y)); }
    }
    // thin rim, dark centre (wet blood is darker where it pools)
    const dark = sstep(0.55, 0.0, rr) * 0.5 + n * 0.3;
    out[0] = mix(0.33, 0.14, dark); out[1] = mix(0.045, 0.014, dark); out[2] = mix(0.032, 0.012, dark); out[3] = sat(a) * 0.96;
  };
}
/** Splat with long drips running down (-y); alignDown decals keep them vertical. */
function bloodDrip(seed: number): Painter {
  const r = srand(seed);
  const blobR = mix(0.18, 0.28, r());
  const drips: [number, number, number][] = [];
  const nd = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nd; i++) drips.push([(r() - 0.5) * 0.5, mix(0.5, 1.4, r()), mix(0.02, 0.045, r())]);
  return (x, y, out) => {
    const n = fbm(x * 5 + seed, y * 5, seed, 3);
    const cy = y - 0.45;
    let a = sstep(blobR + 0.1, blobR - 0.05, Math.hypot(x, cy) + (n - 0.5) * 0.3);
    for (const [dx, len, w] of drips) {
      const yy = 0.45 - y; // 0 at blob centre, grows downward
      if (yy > 0 && yy < len + 0.15) {
        const bulb = sstep(len - 0.12, len + 0.02, yy) * 0.7; // fatter drop head at the end
        const ww = w * (1 - yy / (len + 0.4) * 0.5) * (1 + bulb) + (n - 0.5) * 0.012;
        a = Math.max(a, sstep(ww, ww * 0.45, Math.abs(x - dx + Math.sin(yy * 6 + seed) * 0.015)) * sstep(len + 0.12, len, yy));
      }
    }
    const dark = sstep(0.4, 0.0, Math.hypot(x, cy)) * 0.4 + n * 0.3;
    out[0] = mix(0.31, 0.13, dark); out[1] = mix(0.042, 0.013, dark); out[2] = mix(0.03, 0.011, dark); out[3] = sat(a) * 0.95;
  };
}
/** Directional droplet fan: base at x=-0.9, opening toward +x (drawn with MODE_STRETCH along the shot). */
function bloodSpray(seed: number): Painter {
  const r = srand(seed);
  const drops: [number, number, number, number][] = [];
  const nd = 30 + Math.floor(r() * 24);
  for (let i = 0; i < nd; i++) {
    const ang = (r() - 0.5) * 0.9; const d = mix(0.05, 1.8, Math.sqrt(r()));
    drops.push([-0.9 + Math.cos(ang) * d, Math.sin(ang) * d * 0.8, mix(0.012, 0.07, r() * r() * (1 - d * 0.3)), ang]);
  }
  return (x, y, out) => {
    let a = 0;
    for (const [cx, cy, cr, ang] of drops) {
      const dx = x - cx, dy = y - cy; const along = dx * Math.cos(ang) + dy * Math.sin(ang); const perp = -dx * Math.sin(ang) + dy * Math.cos(ang);
      const d = Math.hypot(along / 2.0, perp);
      a = Math.max(a, sstep(cr, cr * 0.5, d));
    }
    const n = fbm(x * 6, y * 6, seed, 2);
    const mist = sstep(0.5, 0.0, Math.abs(y) / (0.25 + (x + 0.9) * 0.35)) * sstep(-0.95, -0.6, x) * sstep(1.0, 0.3, x) * 0.35 * n;
    a = Math.max(a, mist);
    out[0] = mix(0.2, 0.1, n); out[1] = 0.012; out[2] = 0.01; out[3] = sat(a) * 0.92;
  };
}
function bloodPool(seed: number): Painter {
  const r = srand(seed);
  const lobes: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) { const ang = r() * 6.28, d = r() * 0.2; lobes.push([Math.cos(ang) * d, Math.sin(ang) * d, mix(0.26, 0.44, r())]); }
  return (x, y, out) => {
    const n = fbm(x * 3 + seed, y * 3, seed, 3);
    let a = 0;
    for (const [cx, cy, cr] of lobes) a = Math.max(a, sstep(cr + 0.1, cr - 0.08, Math.hypot(x - cx, y - cy) + (n - 0.5) * 0.2));
    a *= sstep(1.0, 0.82, Math.hypot(x, y)); // never touch the cell border
    const dark = 0.45 + n * 0.3;
    out[0] = mix(0.29, 0.13, dark); out[1] = mix(0.05, 0.018, dark); out[2] = mix(0.035, 0.014, dark); out[3] = sat(a) * 0.97;
  };
}

// ---------- decals ----------
/**
 * Bullet holes. Drawn with alignDown so +y is world-up: the hole interior is dark at the top
 * (overhang shadow) and lighter at the bottom (lit inner wall), and the chipped lip catches
 * light on its lower edge. That baked depth cue is what stops them reading as flat discs.
 */
function holeConcrete(seed: number): Painter {
  const r = srand(seed);
  const holeR = mix(0.1, 0.15, r()), lipBias = r() * 6.28, chipScale = mix(0.5, 0.9, r());
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const th = Math.atan2(y, x);
    const n = fbm(x * 3 + seed, y * 3, seed + 1, 4); const n2 = fbm(x * 12, y * 12, seed + 2, 3); const n3 = fbm(x * 1.6 + 5, y * 1.6, seed + 3, 2);
    const ang = 0.4 + 1.0 * fbm(Math.cos(th + lipBias) * 1.5 + 9, Math.sin(th + lipBias) * 1.5 + 9, seed + 4, 2);
    const hole = sstep(holeR + 0.08, holeR - 0.02, rr + (n - 0.5) * 0.1);
    const lip = sstep(holeR + 0.22, holeR + 0.02, rr + (n - 0.5) * 0.16) * (1 - hole) * ang;
    const chipR = (0.3 + (n3 - 0.5) * 0.6) * chipScale;
    const chip = sstep(chipR + 0.3, chipR - 0.1, rr + (n - 0.5) * 0.5) * (1 - hole) * (1 - lip * 0.5) * (0.4 + 0.6 * ang);
    const bits = sstep(0.7, 0.78, n2) * sstep(0.95, 0.4, rr) * (1 - chip);
    // depth cue: interior darker at the top, lip brighter at its lower edge
    const depth = sat(0.5 - y / Math.max(rr, 1e-3) * 0.5);
    const interior = mix(0.03, 0.14, depth * (1 - hole * 0.4));
    const lipShade = mix(0.22, 0.5, sat(0.5 - y * 1.5));
    // the halo is dust and micro-chipping, not paint: low alpha, broken up by noise
    // the halo must never out-value the wall it sits on: low alpha, mid-dark dust, broken by noise
    const a = Math.max(hole, lip * 0.85, chip * 0.09 * (0.35 + 0.65 * n2), bits * 0.1);
    const chipCol = 0.25 + n2 * 0.16;
    let c = mix(chipCol, lipShade, sat(lip * 1.2));
    c = mix(c, interior, hole);
    out[0] = c; out[1] = c * 0.97; out[2] = c * 0.92; out[3] = a;
  };
}
function holeMetal(seed: number): Painter {
  const r = srand(seed);
  const dentR = mix(0.4, 0.55, r()), holeR = mix(0.05, 0.1, r()), tearAng = r() * 6.28;
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const n = fbm(x * 5 + seed, y * 5, seed, 3); const th = Math.atan2(y, x);
    const tear = 1 + 0.5 * Math.max(0, Math.cos((th - tearAng) * 2)) * sstep(0.1, 0.2, rr);
    const hole = sstep(holeR + 0.05, holeR * 0.6, rr / tear);
    const dent = sstep(dentR, holeR + 0.05, rr + (n - 0.5) * 0.08);
    // dent shading: pushed-in surface, lit from top-left
    const dir = (-x * 0.6 + y * 0.8) / Math.max(rr, 1e-3);
    const hl = sat(dir) * sstep(holeR + 0.02, holeR + 0.18, rr) * sstep(dentR, dentR - 0.25, rr);
    const sh = sat(-dir) * sstep(holeR, holeR + 0.12, rr) * sstep(dentR - 0.05, dentR - 0.25, rr);
    const scorch = sstep(0.85, 0.35, rr + (n - 0.5) * 0.4) * 0.3;
    const a = Math.max(hole, dent * 0.95, scorch);
    let c = mix(0.24, 0.02, hole); c = mix(c, 0.9, hl * 0.85); c = mix(c, 0.05, sh * 0.8);
    c = mix(c * 0.55, c, 1 - scorch * (1 - dent));
    out[0] = c; out[1] = c; out[2] = c * 1.02; out[3] = a;
  };
}
function holeWood(seed: number): Painter {
  const r = srand(seed);
  const grainF = mix(2.5, 4, r()), splitLen = mix(0.55, 0.9, r());
  return (x, y, out) => {
    const rr = Math.hypot(x * 1.3, y); const n = fbm(x * 6 + seed, y * 3, seed, 3); const g = fbm(x * 14, y * grainF, seed + 7, 2);
    const hole = sstep(0.26, 0.11, rr + (n - 0.5) * 0.14);
    // fibrous split running along the grain (vertical), frayed
    const fib = sstep(0.2 + n * 0.14, 0.03, Math.abs(x + (n - 0.5) * 0.18)) * sstep(splitLen + 0.25, splitLen * 0.4, Math.abs(y) + (n - 0.5) * 0.4);
    const bright = sstep(0.4, 0.75, g) * fib * (1 - hole);
    const a = Math.max(hole, fib * 0.55);
    const depth = sat(0.5 - y * 2.5);
    const t = fib * (1 - hole);
    out[0] = mix(mix(0.05, 0.14, depth), mix(0.45, 0.72, bright), t); out[1] = mix(mix(0.03, 0.09, depth), mix(0.32, 0.54, bright), t); out[2] = mix(0.02, mix(0.16, 0.3, bright), t); out[3] = a;
  };
}
function holePlaster(seed: number): Painter {
  const r = srand(seed);
  const chipScale = mix(0.7, 1.1, r()), lathAng = r() * 6.28;
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const th = Math.atan2(y, x); const n = fbm(x * 3.5 + seed, y * 3.5, seed, 4); const n2 = fbm(x * 10, y * 10, seed + 1, 2);
    const hole = sstep(0.13, 0.05, rr);
    const nA = fbm(Math.cos(th + lathAng) * 1.6 + 3, Math.sin(th + lathAng) * 1.6 + 3, seed + 4, 3); // angular irregularity, never lobed
    const lathR = 0.18 + 0.22 * nA;
    const lath = sstep(lathR + 0.05, lathR - 0.15, rr + (n - 0.5) * 0.18) * (1 - hole);
    const chipR = (0.35 + 0.5 * nA) * chipScale;
    const chip = sstep(chipR + 0.25, chipR - 0.2, rr + (n - 0.5) * 0.55) * (1 - hole - lath * 0.6);
    // chipped plaster halo: exposed lath/brown mortar patch, white powder outside, crumbly edge
    // powder halo: broken into flecks by the fine noise so it never reads as a solid white disc
    const a = Math.max(hole, lath * 0.85, chip * 0.1 * (0.25 + n2 * 0.75) * sstep(0.3, 0.62, n2));
    const depth = sat(0.5 - y / Math.max(rr, 1e-3) * 0.5);
    const white = 0.46 + n2 * 0.2;
    let rc = white, gc = white * 0.98, bc = white * 0.93;
    rc = mix(rc, 0.42 + depth * 0.1, lath); gc = mix(gc, 0.33 + depth * 0.08, lath); bc = mix(bc, 0.24, lath);
    rc = mix(rc, 0.04 + depth * 0.08, hole); gc = mix(gc, 0.035 + depth * 0.06, hole); bc = mix(bc, 0.03, hole);
    out[0] = rc; out[1] = gc; out[2] = bc; out[3] = a;
  };
}
/**
 * Bullet hole in glass. THIS is the "symmetric 8-point starburst that reads as a lens artifact"
 * the critic kept finding in `fx_impacts` — not a spark. The old version put 8-12 cracks at
 * angles `i / nc * 2pi` with a tenth of a sector of jitter, each the same width, each running the
 * same distance, which is a rendered asterisk. Real fracture is nothing like that: the radials
 * leave at wildly uneven spacing, run wildly uneven distances, taper to nothing, and are crossed
 * by *partial* conchoidal rings that only ever span part of the circle.
 */
function holeGlass(seed: number): Painter {
  const r = srand(seed);
  // angles by cumulative random step, so the gaps are as uneven as the fracture
  const cracks: { a: number; cur: number; len: number; w: number }[] = [];
  const nc = 7 + Math.floor(r() * 4);
  let ang = r() * 6.283, budget = 6.283;
  for (let i = 0; i < nc; i++) {
    const step = budget / (nc - i) * mix(0.35, 1.75, r());
    ang += step; budget = Math.max(0.2, budget - step);
    cracks.push({ a: ang, cur: (r() - 0.5) * 1.6, len: mix(0.22, 1.0, r() * r() + 0.15), w: mix(0.006, 0.019, r()) });
  }
  // two or three arcs, each covering only a slice of the circle
  const arcs: [number, number, number][] = [];
  for (let i = 0; i < 2 + Math.floor(r() * 2); i++) arcs.push([mix(0.17, 0.42, r()), r() * 6.283, mix(0.5, 2.2, r())]);
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const th = Math.atan2(y, x);
    const hole = sstep(0.13, 0.07, rr + (fbm(x * 8, y * 8, seed, 2) - 0.5) * 0.08);
    let crack = 0;
    for (const c of cracks) {
      let d = th - c.a - c.cur * rr * rr; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 1.2) continue;
      const dist = rr * Math.abs(Math.sin(d));
      // the radial thins as it runs out and dies at its own length, not at a shared radius
      const w = c.w * sstep(c.len, 0.05, rr);
      crack = Math.max(crack, sstep(w, w * 0.25, dist) * sstep(c.len, c.len * 0.35, rr) * (0.55 + 0.6 * fbm(rr * 9, c.a * 3, seed + 17, 2)));
    }
    let ring = 0;
    for (const [rad, a0, span] of arcs) {
      let d = th - a0; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > span * 0.5) continue;
      const wob = (fbm(th * 2.5 + rad * 9, 0, seed + 3, 2) - 0.5) * 0.07;
      ring = Math.max(ring, sstep(0.011, 0.003, Math.abs(rr - rad + wob)) * sstep(span * 0.5, span * 0.3, Math.abs(d)) * 0.55);
    }
    // crazing is a faint frosted haze, never a white disc: glass is transparent, only the fracture scatters light
    const crazed = sstep(0.34, 0.12, rr) * 0.16 * (1 - hole) * (0.5 + fbm(x * 14, y * 14, seed + 8, 2));
    const a = Math.max(hole * 0.85, crack * 0.5, ring, crazed);
    const bright = 1 - hole;
    out[0] = 0.8 * bright + 0.02; out[1] = 0.86 * bright + 0.02; out[2] = 0.94 * bright + 0.03; out[3] = a;
  };
}
function scorch(seed: number): Painter {
  const r = srand(seed);
  const lobes: [number, number][] = [];
  for (let i = 0; i < 4; i++) lobes.push([r() * 6.28, mix(0.15, 0.4, r())]);
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const th = Math.atan2(y, x); const n = fbm(x * 3 + seed, y * 3, seed, 4); const n2 = fbm(x * 9, y * 9, seed + 1, 3);
    let lobe = 0;
    for (const [la, ls] of lobes) lobe += Math.max(0, Math.cos(th - la)) ** 6 * ls;
    const R = 0.6 + lobe;
    const a = sstep(R + 0.35, R * 0.35, rr + (n - 0.5) * 0.7) * (0.65 + 0.35 * n2) * 0.95;
    // ashy grey flecks inside the soot
    const ash = sstep(0.7, 0.85, n2) * sstep(0.5, 0.15, rr) * 0.15;
    const c = 0.018 + n2 * 0.03 + ash;
    out[0] = c * 1.25; out[1] = c; out[2] = c * 0.85; out[3] = sat(a);
  };
}
function holeDirt(seed: number): Painter {
  const r = srand(seed);
  const ex = mix(0.8, 1.0, r());
  return (x, y, out) => {
    const rr = Math.hypot(x * ex, y); const n = fbm(x * 4 + seed, y * 4, seed, 3); const n2 = fbm(x * 10, y * 10, seed + 1, 2);
    const crater = sstep(0.3, 0.1, rr + (n - 0.5) * 0.2);
    const a = sstep(0.75, 0.2, rr + (n - 0.5) * 0.45) * 0.85;
    const depth = sat(0.5 - y * 2);
    const c = mix(0.14 + n2 * 0.08, 0.04 + depth * 0.05, crater);
    out[0] = c * 1.3; out[1] = c; out[2] = c * 0.7; out[3] = a;
  };
}
function holeSandbag(seed: number): Painter {
  const r = srand(seed);
  const tearAng = r() * 6.28, tearLen = mix(0.3, 0.5, r());
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const n = fbm(x * 6 + seed, y * 6, seed, 3);
    const hole = sstep(0.14, 0.06, rr + (n - 0.5) * 0.08);
    // torn burlap flap: a dark tear line plus frayed threads
    const tx = x * Math.cos(tearAng) + y * Math.sin(tearAng), ty = -x * Math.sin(tearAng) + y * Math.cos(tearAng);
    const tear = sstep(0.04 + n * 0.03, 0.0, Math.abs(ty)) * sstep(tearLen + 0.1, tearLen * 0.5, Math.abs(tx)) * (1 - hole);
    const weave = sstep(0.45, 0.65, fbm(x * 30, y * 30, seed + 5, 2)) * sstep(0.45, 0.2, rr) * 0.25;
    const spill = sstep(0.55, 0.15, rr + (n - 0.5) * 0.5) * 0.45 * (1 - hole);
    const a = Math.max(hole, tear * 0.85, spill * 0.55 * (0.6 + 0.4 * n), weave * 0.6);
    const sand = 0.45 + n * 0.15;
    let cr = sand * 1.15, cg = sand * 0.95, cb = sand * 0.65;
    cr = mix(cr, 0.08, Math.max(hole, tear * 0.8)); cg = mix(cg, 0.06, Math.max(hole, tear * 0.8)); cb = mix(cb, 0.04, Math.max(hole, tear * 0.8));
    out[0] = cr; out[1] = cg; out[2] = cb; out[3] = a;
  };
}
function holeBrick(seed: number): Painter {
  const r = srand(seed);
  const chipScale = mix(0.6, 1.0, r());
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const n = fbm(x * 4 + seed, y * 4, seed, 4); const n2 = fbm(x * 12, y * 12, seed + 1, 3); const n3 = fbm(x * 1.5 + 2, y * 1.5, seed + 2, 2);
    const hole = sstep(0.2, 0.1, rr + (n - 0.5) * 0.08);
    const chipR = (0.3 + (n3 - 0.5) * 0.6) * chipScale;
    const chip = sstep(chipR + 0.25, chipR - 0.12, rr + (n - 0.5) * 0.45) * (1 - hole);
    const a = Math.max(hole, chip * 0.2 * (0.5 + n2 * 0.5));
    const depth = sat(0.5 - y / Math.max(rr, 1e-3) * 0.5);
    const t = chip * (1 - hole);
    out[0] = mix(0.04 + depth * 0.1, 0.55 + n2 * 0.18, t); out[1] = mix(0.025 + depth * 0.05, 0.3 + n2 * 0.1, t); out[2] = mix(0.02, 0.22, t); out[3] = a;
  };
}
// ---------- flashes / misc ----------
/** Muzzle flash core seen down the bore: hot centre, irregular spikes, noise-eroded halo. */
function flash(seed: number): Painter {
  const r = srand(seed);
  // Uneven angular spacing, as with holeGlass: `i / ns * 2pi` draws an asterisk however much the
  // spike lengths vary, and an asterisk over a muzzle reads as a lens flare, not burning gas.
  const spikes: [number, number, number][] = [];
  const ns = 5 + Math.floor(r() * 4);
  let ang = r() * 6.283, budget = 6.283;
  for (let i = 0; i < ns; i++) {
    const step = budget / (ns - i) * mix(0.3, 1.8, r());
    ang += step; budget = Math.max(0.25, budget - step);
    spikes.push([ang, mix(0.03, 0.16, r()), mix(0.35, 1.0, r() * r() + 0.2)]);
  }
  const haloR = mix(0.3, 0.45, r());
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const th = Math.atan2(y, x);
    const n = fbm(x * 5 + seed, y * 5, seed, 3);
    const core = Math.exp(-rr * rr * 22) * 1.4;
    const blob = sstep(haloR + 0.12, haloR * 0.3, rr + (n - 0.5) * 0.4) * 0.75;
    let sp = 0;
    for (const [ak, w, len] of spikes) {
      let d = th - ak; d = Math.atan2(Math.sin(d), Math.cos(d));
      sp = Math.max(sp, Math.exp(-(d * d) / (w * w)) * sstep(len, 0.05, rr) * (0.5 + 0.7 * n));
    }
    const a = sat(core + blob + sp * 0.85);
    const hot = sat(core + blob * 0.5);
    out[0] = 1; out[1] = mix(0.45, 0.95, hot); out[2] = mix(0.08, 0.8, hot); out[3] = a;
  };
}
/** Muzzle cone: base at x=-1 (the muzzle), tip toward +x; axial spikes, bright throat, orange rim. */
function flashCone(): Painter {
  const r = srand(1201);
  const spikes: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) spikes.push([(r() - 0.5) * 0.7, mix(0.02, 0.05, r()), mix(0.5, 1.0, r())]);
  return (x, y, out) => {
    const s = sat((x + 1) / 2); // 0 at muzzle, 1 at tip
    const n = fbm(x * 4 + 3, y * 6, 1202, 3);
    const prof = 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.55)), 0.9) * (1 - s * 0.35);
    const body = sstep(prof + 0.1, prof * 0.35, Math.abs(y) + (n - 0.5) * 0.35) * sstep(0.0, 0.08, s) * sstep(1.0, 0.75, s);
    let sp = 0;
    for (const [yk, w, len] of spikes) sp = Math.max(sp, Math.exp(-((y - yk * prof * 1.6) ** 2) / (w * w)) * sstep(len + 0.15, len * 0.3, s) * sstep(0.0, 0.1, s) * (0.5 + 0.7 * n));
    const throat = Math.exp(-(y * y) * 30) * sstep(0.55, 0.0, s) * 1.2;
    const a = sat(body * 0.85 + sp * 0.8 + throat);
    const hot = sat(throat + body * 0.4 * (1 - s));
    out[0] = 1; out[1] = mix(0.42, 0.95, hot); out[2] = mix(0.06, 0.8, hot); out[3] = a;
  };
}
/** Compensator side petal: shorter, wider base than the cone. */
function flashSide(): Painter {
  return (x, y, out) => {
    const s = sat((x + 1) / 2);
    const n = fbm(x * 6, y * 6, 1301, 3);
    const prof = 0.45 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.7)), 0.8);
    const jet = sstep(prof + 0.12, prof * 0.3, Math.abs(y) + (n - 0.5) * 0.3) * sstep(0.0, 0.1, s) * sstep(1.0, 0.7, s);
    const throat = Math.exp(-(y * y) * 40) * sstep(0.5, 0.0, s);
    const a = sat(jet * 0.9 + throat);
    out[0] = 1; out[1] = mix(0.45, 0.9, sat(throat + jet * 0.3)); out[2] = mix(0.1, 0.7, sat(throat)); out[3] = a;
  };
}
function ring(): Painter {
  return (x, y, out) => {
    const rr = Math.hypot(x, y);
    const a = Math.exp(-(((rr - 0.78) / 0.09) ** 2)) * 0.9 + Math.exp(-(((rr - 0.65) / 0.2) ** 2)) * 0.25;
    out[0] = 1; out[1] = 0.95; out[2] = 0.88; out[3] = sat(a) * sstep(1.0, 0.9, rr);
  };
}
/** Soft shock disc: bright thin front, faint interior (drawn additively, flat on the ground). */
function shock(): Painter {
  return (x, y, out) => {
    const rr = Math.hypot(x, y); const n = fbm(x * 4, y * 4, 1401, 2);
    const front = Math.exp(-(((rr - 0.82 + (n - 0.5) * 0.06) / 0.05) ** 2));
    const inner = sstep(0.85, 0.2, rr) * 0.18 * (0.6 + n * 0.6);
    out[0] = 1; out[1] = 0.9; out[2] = 0.75; out[3] = sat(front * 0.9 + inner) * sstep(1.0, 0.9, rr);
  };
}
function mote(): Painter {
  return (x, y, out) => { const a = sat(Math.exp(-(x * x + y * y) * 9) - 0.03); out[0] = 1; out[1] = 0.95; out[2] = 0.85; out[3] = a; };
}
function shard(seed: number): Painter {
  const r = srand(seed);
  const skew = (r() - 0.5) * 0.5, wTop = mix(0.1, 0.3, r()), wBot = mix(0.2, 0.4, r());
  return (x, y, out) => {
    const w = mix(wBot, wTop, (y + 1) / 2);
    const xx = x - y * skew;
    const inside = sstep(w, w - 0.08, Math.abs(xx)) * sstep(0.95, 0.8, Math.abs(y));
    const edge = sstep(0.06, 0.0, Math.abs(Math.abs(xx) - w + 0.03)) * sstep(0.95, 0.85, Math.abs(y));
    const glint = Math.exp(-((xx - 0.05) ** 2 + (y - 0.3) ** 2) * 30) * 0.6;
    const a = inside * 0.16 + edge * 0.42 + glint * 0.8;
    out[0] = 0.72 + edge * 0.28; out[1] = 0.82 + edge * 0.18; out[2] = 0.95; out[3] = sat(a);
  };
}

/** Alpha falloff over the outermost ~5% of a cell (atlas gutter; prevents mip-level cell bleed). */
const gutter = (v: number): number => sstep(1.0, 0.9, Math.abs(v));

export function buildAtlas(cell: number): Atlas {
  const size = cell * GRID;
  const data = new Uint8Array(size * size * 4);
  const px = new Float32Array(4);
  const paint = (index: number, fn: Painter) => {
    const col = index % GRID, row = Math.floor(index / GRID);
    const ox = col * cell, oy = row * cell;
    for (let j = 0; j < cell; j++) {
      const y = ((j + 0.5) / cell) * 2 - 1;
      for (let i = 0; i < cell; i++) {
        const x = ((i + 0.5) / cell) * 2 - 1;
        px[0] = 0; px[1] = 0; px[2] = 0; px[3] = 0;
        fn(x, y, px);
        px[3] *= gutter(x) * gutter(y);
        const o = ((oy + j) * size + (ox + i)) * 4;
        data[o] = sat(px[0]) * 255 + 0.5; data[o + 1] = sat(px[1]) * 255 + 0.5; data[o + 2] = sat(px[2]) * 255 + 0.5; data[o + 3] = sat(px[3]) * 255 + 0.5;
      }
    }
  };
  for (let i = 0; i < CELL.FIREBALL_N; i++) paint(CELL.FIREBALL + i, fireball(i, CELL.FIREBALL_N, 900));
  for (let i = 0; i < CELL.SOOT_N; i++) paint(CELL.SOOT + i, sootBall(i, CELL.SOOT_N, 1700));
  for (let i = 0; i < CELL.SMOKE_N; i++) paint(CELL.SMOKE + i, puff(100 + i * 13, { spheres: 7, spread: 0.42, rMin: 0.32, rMax: 0.58, erosion: 0.4, density: 1.15, wisp: 0.25 }));
  for (let i = 0; i < CELL.DUST_N; i++) paint(CELL.DUST + i, puff(300 + i * 31, { spheres: 6, spread: 0.62, rMin: 0.22, rMax: 0.48, erosion: 1.05, density: 0.9, wisp: 0.6 }));
  paint(CELL.SPARK, sparkDot()); paint(CELL.EMBER, ember()); paint(CELL.GLOW, glow()); paint(CELL.DROP, drop());
  for (let i = 0; i < CELL.FLAME_N; i++) paint(CELL.FLAME + i, flame(40 + i * 7));
  paint(CELL.MOTE, mote()); paint(CELL.RING, ring());
  for (let i = 0; i < CELL.SHARD_N; i++) paint(CELL.SHARD + i, shard(700 + i * 3));
  paint(CELL.FLASH_CONE, flashCone()); paint(CELL.FLASH_SIDE, flashSide()); paint(CELL.SHOCK, shock()); paint(CELL.STREAK, streak());
  for (let i = 0; i < CELL.SPARK_TRAIL_N; i++) paint(CELL.SPARK_TRAIL + i, sparkTrail(11 + i * 5));
  for (let i = 0; i < CELL.FLASH_N; i++) paint(CELL.FLASH + i, flash(6000 + i * 19));
  for (let i = 0; i < CELL.BLOOD_SPRAY_N; i++) paint(CELL.BLOOD_SPRAY + i, bloodSpray(3000 + i * 53));
  for (let i = 0; i < CELL.BLOOD_SPLAT_N; i++) paint(CELL.BLOOD_SPLAT + i, bloodSplat(2000 + i * 97));
  for (let i = 0; i < CELL.BLOOD_DRIP_N; i++) paint(CELL.BLOOD_DRIP + i, bloodDrip(2500 + i * 41));
  for (let i = 0; i < CELL.HOLE_CONCRETE_N; i++) paint(CELL.HOLE_CONCRETE + i, holeConcrete(301 + i * 7));
  for (let i = 0; i < CELL.HOLE_METAL_N; i++) paint(CELL.HOLE_METAL + i, holeMetal(401 + i * 7));
  for (let i = 0; i < CELL.HOLE_WOOD_N; i++) paint(CELL.HOLE_WOOD + i, holeWood(501 + i * 7));
  for (let i = 0; i < CELL.HOLE_PLASTER_N; i++) paint(CELL.HOLE_PLASTER + i, holePlaster(601 + i * 7));
  for (let i = 0; i < CELL.HOLE_GLASS_N; i++) paint(CELL.HOLE_GLASS + i, holeGlass(701 + i * 7));
  for (let i = 0; i < CELL.HOLE_BRICK_N; i++) paint(CELL.HOLE_BRICK + i, holeBrick(1001 + i * 7));
  for (let i = 0; i < CELL.HOLE_DIRT_N; i++) paint(CELL.HOLE_DIRT + i, holeDirt(901 + i * 7));
  for (let i = 0; i < CELL.HOLE_SANDBAG_N; i++) paint(CELL.HOLE_SANDBAG + i, holeSandbag(951 + i * 7));
  for (let i = 0; i < CELL.SCORCH_N; i++) paint(CELL.SCORCH + i, scorch(801 + i * 7));
  for (let i = 0; i < CELL.BLOOD_POOL_N; i++) paint(CELL.BLOOD_POOL + i, bloodPool(2800 + i * 7));
  for (let i = 0; i < CELL.DEBRIS_N; i++) paint(CELL.DEBRIS + i, debrisChunk(4000 + i * 11));
  for (let i = 0; i < CELL.SPLINTER_N; i++) paint(CELL.SPLINTER + i, splinter(5000 + i * 7));
  paint(CELL.PAPER, paper());
  for (let i = 0; i < CELL.FIBER_N; i++) paint(CELL.FIBER + i, fiber(5100 + i * 7));
  for (let i = 0; i < CELL.CLOD_N; i++) paint(CELL.CLOD + i, clod(5200 + i * 7));

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, size, cell };
}

/** UV rect (u0, v0, du, dv) of a cell. */
export function cellRect(index: number, out: Float32Array | number[], offset = 0): void {
  const col = index % GRID, row = Math.floor(index / GRID);
  out[offset] = col / GRID; out[offset + 1] = row / GRID; out[offset + 2] = 1 / GRID; out[offset + 3] = 1 / GRID;
}
