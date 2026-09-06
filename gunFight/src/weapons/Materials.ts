import * as THREE from 'three';
import { Rng } from '../core/Rng';

/**
 * Procedural PBR maps drawn on canvas for the viewmodel.
 *
 *  metal      cerakote/anodised receiver: matte 0.55-0.7 roughness with macro blotching, bare-metal edge
 *             wear (0.3), scratches, machining-line micro normal.
 *  metalDark  phosphate/parkerised steel for rails, barrels, small parts: roughness clamped >= 0.42 so it
 *             never mirrors the sky.
 *  polymer    stippled fibre-reinforced polymer, edges polished by handling.
 *  glove      one 1024 atlas for the hands: leather (palm/fingers) | nylon dorsal | knuckle shell | sleeve
 *             fabric, so a hand + forearm is a single skinned draw call.
 *
 * Every box/rounded-box face has 0..1 UVs, so "wear near the UV border" lands exactly on the bevelled
 * edges of each part. All builder materials read the vertex colour written by PartBuilder (cavity /
 * contact darkening).
 */

export interface WeaponMaterials {
  metal: THREE.MeshPhysicalMaterial;
  metalDark: THREE.MeshPhysicalMaterial;
  /** hard-anodised aluminium: Picatinny rails and optic mounts. Distinctly glossier than the receiver. */
  rail: THREE.MeshPhysicalMaterial;
  polymer: THREE.MeshPhysicalMaterial;
  rubber: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  lensInner: THREE.MeshStandardMaterial;
  glove: THREE.MeshPhysicalMaterial;
  plate: THREE.MeshPhysicalMaterial;
  wood: THREE.MeshPhysicalMaterial;
  stockPoly: THREE.MeshPhysicalMaterial;
  red: THREE.MeshStandardMaterial;
  /** emissive LED (battery / laser indicator) */
  led: THREE.MeshBasicMaterial;
  scopeView: THREE.MeshBasicMaterial;
  scopeMask: THREE.MeshBasicMaterial;
  reticle: THREE.MeshBasicMaterial;
  /** soft dark contact-shadow disc */
  shadow: THREE.MeshBasicMaterial;
  /** additive muzzle-flash sheet: left half = side cone, right half = radial front burst */
  flash: THREE.MeshBasicMaterial;
  /** engraving decal factory (each call = one texture) */
  engraving(lines: string[], opts?: { size?: number; font?: number; color?: string }): THREE.MeshStandardMaterial;
  /** mag witness marks / round counter decal */
  witness(): THREE.MeshStandardMaterial;
  /** several engraving panels on one texture (one draw call); returns the material and each panel's uv rect [u0,v0,u1,v1] */
  engravingSheet(panels: SheetPanel[]): { mat: THREE.MeshStandardMaterial; rects: [number, number, number, number][] };
}

export interface SheetPanel {
  lines: string[]; font?: number; color?: string;
  /** 'label' draws a warning-label plate (dark rounded box, coloured header bar) behind the text */
  style?: 'etch' | 'label' | 'plate';
  /** header bar colour for 'label' */
  accent?: string;
}

/**
 * UV rectangles [u0, u1, v0, v1] of the hand atlas. Six vertical strips; every strip's pattern is
 * generated from strip-local pixel coordinates so it tiles inside itself and never bleeds a seam.
 *   leather  palm, thumb web, heel        finger   swept finger tube (u = around, v = base->tip)
 *   nylon    padded dorsal panel          shell    hard knuckle guard rubber
 *   cuff     gauntlet band + velcro       sleeve   forearm fabric
 */
export const HAND_UV = {
  leather: [0.006, 0.158, 0.01, 0.99] as const,
  finger: [0.172, 0.324, 0.01, 0.99] as const,
  nylon: [0.338, 0.490, 0.01, 0.99] as const,
  shell: [0.504, 0.606, 0.01, 0.99] as const,
  cuff: [0.620, 0.722, 0.01, 0.99] as const,
  sleeve: [0.736, 0.996, 0.0, 1.0] as const,
};

const TEX = 1024;

// ---------- noise ----------
class Noise {
  private perm: Uint8Array;
  constructor(seed: number) {
    const r = new Rng(seed);
    this.perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = r.int(0, i); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private hash(x: number, y: number): number { return this.perm[(this.perm[x & 255] + y) & 255] / 255; }
  /** value noise, tileable at period `per` */
  value(x: number, y: number, per: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const w = (a: number, b: number) => this.hash(((a % per) + per) % per, ((b % per) + per) % per);
    const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  fbm(x: number, y: number, octaves: number, per: number): number {
    let v = 0, amp = 0.5, f = 1, sum = 0;
    for (let i = 0; i < octaves; i++) { v += amp * this.value(x * f, y * f, per * f); sum += amp; amp *= 0.5; f *= 2; }
    return v / sum;
  }
}

function canvas(size: number, h = size): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = size; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function tex(c: HTMLCanvasElement, srgb: boolean, anis = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anis;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Normal map from a height field (Float32Array size*size, 0..1). */
function normalFromHeight(h: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], dn = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false);
}

/** distance-to-border wear mask in UV space (0 at center, 1 at edge), with noisy breakup */
function edgeMask(u: number, v: number, width: number, n: number): number {
  const d = Math.min(u, 1 - u, v, 1 - v);
  const w = width * (0.5 + 1.0 * n);
  return THREE.MathUtils.clamp(1 - d / w, 0, 1);
}

const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
const sstep = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * TRAP, and it has cost a review round already: every albedo canvas in this file is tagged
 * `SRGBColorSpace`, so the number you write here is an sRGB *code value*, NOT a linear reflectance.
 * `0.13` looks like "dark grey" and decodes to linear **0.015** — charcoal. The glove shipped at those
 * levels and read as a black silhouette with no internal shading whatsoever; no amount of baked AO or
 * normal detail rescues a surface whose albedo is already at the floor.
 *
 * Conversion for the values that matter here (linear -> what to write):
 *   black leather 0.03 -> 0.19   dark nylon 0.05 -> 0.24   olive cloth 0.07 -> 0.29   mid grey 0.18 -> 0.46
 * As a rule of thumb, halving a number in this file is roughly a 2.4x cut in linear reflectance, so
 * "a bit darker" is almost always a smaller step than it looks.
 */
const srgb8 = (v: number) => clamp01(v) * 255;

interface MapSet { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; metalnessMap?: THREE.CanvasTexture }

type Scratches = [number, number, number, number, number][];
function makeScratches(r: Rng, n: number, minLen: number, maxLen: number): Scratches {
  const out: Scratches = [];
  for (let i = 0; i < n; i++) { const x = r.next(), y = r.next(), a = r.range(-0.6, 0.6) + (r.next() < 0.3 ? Math.PI / 2 : 0), l = r.range(minLen, maxLen); out.push([x, y, Math.cos(a), Math.sin(a), l]); }
  return out;
}
function scratchAt(s: Scratches, u: number, v: number, w = 0.0011): number {
  let m = 0;
  for (const [x, y, cx, cy, l] of s) {
    const dx = u - x, dy = v - y; const t = dx * cx + dy * cy;
    if (t < 0 || t > l) continue;
    const px = dx - cx * t, py = dy - cy * t; const dist = Math.hypot(px, py);
    if (dist < w) m = Math.max(m, (1 - dist / w) * (0.5 + 0.5 * Math.sin((t / l) * Math.PI)));
  }
  return m;
}

/**
 * Coated gunmetal.
 *  cerakote:  matte polymer-ceramic finish, rough 0.55-0.72, macro blotching, worn edges -> bare steel 0.30
 *  phosphate: parkerised steel, rough 0.62-0.78 clamped >= 0.42 even on worn edges
 */
function metalMaps(seed: number, base: [number, number, number], wearAmt: number, kind: 'cerakote' | 'phosphate' | 'anodised'): MapSet {
  const size = TEX;
  const noise = new Noise(seed);
  const r = new Rng(seed);
  const [ca, ctxA] = canvas(size); const [cr, ctxR] = canvas(size); const [cm, ctxM] = canvas(size);
  const A = ctxA.createImageData(size, size), R = ctxR.createImageData(size, size), M = ctxM.createImageData(size, size);
  const height = new Float32Array(size * size);
  const scratches = makeScratches(r, kind === 'cerakote' ? 110 : 60, 0.02, 0.16);
  // Round 2: "receiver is still one roughness across polymer, rail and worn edges". A viewmodel needs at
  // least three finishes that read apart at a glance: matte cerakote receiver, glossy anodised rail,
  // mid parkerised steel. These are the anchors; the macro drift below widens each into a band.
  const roughMin = kind === 'cerakote' ? 0.26 : kind === 'anodised' ? 0.24 : 0.42;
  const roughBase = kind === 'cerakote' ? 0.60 : kind === 'anodised' ? 0.40 : 0.70;
  const bareRough = kind === 'cerakote' ? 0.25 : kind === 'anodised' ? 0.26 : 0.44;
  const bareTone = kind === 'cerakote' ? 0.52 : kind === 'anodised' ? 0.58 : 0.34;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const macro = noise.fbm(u * 4 + 11, v * 4 + 3, 4, 4);          // large blotching (per-panel tone / rough drift)
    const mid = noise.fbm(u * 18, v * 18, 3, 18);                   // handling smudges
    const grain = noise.fbm(x * 0.55, y * 0.55, 3, 563);            // fine coating grain
    const blob = noise.fbm(u * 7 + 5, v * 7, 4, 7);
    // machining lines: fine parallel marks (period ~3 px) whose amplitude drifts, only in the normal
    const lines = Math.sin(y * 2.05 + noise.value(x * 0.05, y * 0.01, 51) * 4) * (0.35 + 0.65 * noise.value(x * 0.03, y * 0.03, 31));
    // sparse pits (casting/tooling)
    const pitN = noise.value(x * 0.22 + 7, y * 0.22, 225);
    const pit = sstep(pitN, 0.965, 0.99);
    const wear = edgeMask(u, v, 0.075, blob) * wearAmt * (0.35 + 0.65 * grain) * (0.6 + 0.4 * sstep(macro, 0.3, 0.7));
    const dirt = sstep(macro, 0.6, 0.9) * (1 - wear) * 0.5 + sstep(mid, 0.72, 0.95) * 0.25;
    const scratch = scratchAt(scratches, u, v);
    // albedo: coating tone with macro drift, bare metal on wear, dark grime in dirt
    const tone = (macro - 0.5) * 0.13 + (mid - 0.5) * 0.05 + (grain - 0.5) * 0.05;
    let rr = base[0] + tone, gg = base[1] + tone, bb = base[2] + tone * 1.05;
    const bare = bareTone + 0.16 * grain;
    rr += (bare - rr) * wear; gg += (bare * 0.98 - gg) * wear; bb += (bare * 0.95 - bb) * wear;
    rr = rr * (1 - dirt * 0.75) + 0.045 * dirt; gg = gg * (1 - dirt * 0.75) + 0.042 * dirt; bb = bb * (1 - dirt * 0.75) + 0.038 * dirt;
    rr += scratch * 0.22; gg += scratch * 0.215; bb += scratch * 0.205;
    rr -= pit * 0.06; gg -= pit * 0.06; bb -= pit * 0.06;
    const i = (y * size + x) * 4;
    A.data[i] = clamp01(rr) * 255; A.data[i + 1] = clamp01(gg) * 255; A.data[i + 2] = clamp01(bb) * 255; A.data[i + 3] = 255;
    // roughness: matte coating with macro + grain variation; worn edges drop; dirt/pits rougher; scratches glossy
    let rough = roughBase + (macro - 0.5) * (kind === 'anodised' ? 0.20 : 0.42) + (mid - 0.5) * 0.12 + (grain - 0.5) * 0.10;
    rough = rough * (1 - wear * 0.8) + bareRough * wear * 0.8;
    rough += dirt * 0.22 + pit * 0.2;
    rough = rough * (1 - scratch * 0.7) + (bareRough + 0.05) * scratch * 0.7;
    const rv = THREE.MathUtils.clamp(rough, roughMin, 0.97) * 255;
    R.data[i] = rv; R.data[i + 1] = rv; R.data[i + 2] = rv; R.data[i + 3] = 255;
    // metalness: coating reads a little dielectric, bare edges fully metallic, dirt dielectric
    const mBase = kind === 'cerakote' ? 0.28 : kind === 'anodised' ? 0.85 : 0.62;
    const mv = clamp01(mBase + (1 - mBase) * wear - dirt * 0.7 + scratch * 0.2) * 255;
    M.data[i] = mv; M.data[i + 1] = mv; M.data[i + 2] = mv; M.data[i + 3] = 255;
    height[y * size + x] = 0.5 + lines * 0.16 + (grain - 0.5) * 0.30 + (mid - 0.5) * 0.12 - scratch * 0.7 - pit * 0.8 + wear * 0.14;
  }
  ctxA.putImageData(A, 0, 0); ctxR.putImageData(R, 0, 0); ctxM.putImageData(M, 0, 0);
  return { map: tex(ca, true), roughnessMap: tex(cr, false), metalnessMap: tex(cm, false), normalMap: normalFromHeight(height, size, 2.2) };
}

/** Stippled polymer (mag/grip/handguard/stock): fine bumps, matte, edges polished by handling, macro dust. */
function polymerMaps(seed: number, base: [number, number, number]): MapSet {
  const size = TEX;
  const noise = new Noise(seed);
  const [ca, ctxA] = canvas(size); const [cr, ctxR] = canvas(size);
  const A = ctxA.createImageData(size, size), R = ctxR.createImageData(size, size);
  const height = new Float32Array(size * size);
  const r = new Rng(seed + 3);
  const scratches = makeScratches(r, 40, 0.02, 0.09);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const stipple = noise.value(x * 0.36, y * 0.36, 369);
    const fine = noise.fbm(x * 0.9, y * 0.9, 2, 920);
    const macro = noise.fbm(u * 4 + 2, v * 4 + 9, 4, 4);
    const blob = noise.fbm(u * 6, v * 6, 4, 6);
    const wear = edgeMask(u, v, 0.05, blob) * 0.55 * (0.4 + 0.6 * fine);
    const dust = sstep(macro, 0.6, 0.9) * 0.35;
    const scratch = scratchAt(scratches, u, v, 0.0009);
    const tone = (stipple - 0.5) * 0.05 + (fine - 0.5) * 0.03 + (macro - 0.5) * 0.04;
    let rr = base[0] + tone, gg = base[1] + tone, bb = base[2] + tone;
    // handled edges go slightly lighter/greyer (polished polymer)
    rr += wear * 0.10 + scratch * 0.12; gg += wear * 0.10 + scratch * 0.12; bb += wear * 0.09 + scratch * 0.11;
    rr += dust * 0.09; gg += dust * 0.08; bb += dust * 0.06;
    const i = (y * size + x) * 4;
    A.data[i] = clamp01(rr) * 255; A.data[i + 1] = clamp01(gg) * 255; A.data[i + 2] = clamp01(bb) * 255; A.data[i + 3] = 255;
    const rough = 0.66 + (stipple - 0.5) * 0.22 + (macro - 0.5) * 0.1 - wear * 0.3 + dust * 0.25 - scratch * 0.2;
    const rv = THREE.MathUtils.clamp(rough, 0.3, 0.96) * 255;
    R.data[i] = rv; R.data[i + 1] = rv; R.data[i + 2] = rv; R.data[i + 3] = 255;
    height[y * size + x] = 0.5 + (stipple - 0.5) * 0.6 * (1 - wear) + (fine - 0.5) * 0.2 - scratch * 0.3;
  }
  ctxA.putImageData(A, 0, 0); ctxR.putImageData(R, 0, 0);
  return { map: tex(ca, true), roughnessMap: tex(cr, false), normalMap: normalFromHeight(height, size, 2.2) };
}

/**
 * Hand atlas (see HAND_UV): leather | finger | nylon dorsal | knuckle shell | cuff | sleeve.
 *
 * Levels: `g` is written straight into an sRGB byte, so a value that looks like a reflectance is NOT
 * one — sRGB 0.13 decodes to linear 0.015, i.e. charcoal. The glove used to sit there and read as a
 * black silhouette with no internal shading. The panels are now separated in value the way ref_06's
 * glove is: TPR guard darkest, leather next, cuff webbing, then the nylon pad and the sleeve lightest.
 *
 * Two more rules, both learned the hard way:
 *  1. NO periodic albedo. The old atlas printed sin(x)*sin(y) and an `x % 24` ripstop grid into the
 *     colour and it resolved at 1080p as graph paper. Cloth here is albedo noise + an irregular weave
 *     that lives only in the height field, so it breaks up the specular and never draws a lattice.
 *  2. Every pattern is generated in *strip-normalised UV* (su, sv in 0..1), never in pixels. The strips
 *     are 150 x 1024 px but map onto roughly square surfaces, so pixel-space noise came out stretched
 *     6.7:1 and read as vertical streaks on the palm. UV-space noise is isotropic on the surface.
 * Seams are dark grooves (albedo down, height down), never light thread.
 */
function handAtlas(seed: number): MapSet {
  const size = TEX;
  const noise = new Noise(seed);
  const [ca, ctxA] = canvas(size); const [cr, ctxR] = canvas(size);
  const A = ctxA.createImageData(size, size), R = ctxR.createImageData(size, size);
  const height = new Float32Array(size * size);
  const px = (r: readonly [number, number, number, number]) => [Math.round(r[0] * size), Math.round(r[1] * size)] as const;
  const [lx0, lx1] = px(HAND_UV.leather), [fx0, fx1] = px(HAND_UV.finger), [nx0, nx1] = px(HAND_UV.nylon);
  const [sx0, sx1] = px(HAND_UV.shell), [cx0, cx1] = px(HAND_UV.cuff), [vx0] = px(HAND_UV.sleeve);

  /** tileable fbm / value noise in strip UV; `c` = feature cells across the whole strip */
  const fb = (su: number, sv: number, c: number, oct: number) => noise.fbm(su * c, sv * c, oct, c);
  const vn = (su: number, sv: number, c: number) => noise.value(su * c, sv * c, c);
  /**
   * Irregular plain weave, height only. `c` = threads across the strip; each thread family wanders and
   * which one sits on top drifts diagonally, so there is no square lattice anywhere in the result.
   */
  const weaveH = (su: number, sv: number, c: number): number => {
    const jx = (vn(su, sv, Math.round(c / 9)) - 0.5) * 0.9;
    const jy = (vn(su + 0.31, sv + 0.17, Math.round(c / 9)) - 0.5) * 0.9;
    const k = Math.PI * 2 * c;
    const warp = Math.sin(su * k + jx * 3), weft = Math.sin(sv * k + jy * 3);
    // which thread family is on top is chosen by noise, not by a diagonal wave: a wave draws chevrons
    const over = vn(su + 0.13, sv + 0.29, Math.max(2, Math.round(c / 2))) - 0.5;
    return (over > 0 ? warp : weft) * 0.5 + (warp + weft) * 0.11;
  };
  /** Dark stitch groove: `d` = signed distance to the seam in strip UV, `along` drives the dash. */
  const seamG = (d: number, w: number, along: number, dashes: number): number => {
    const band = Math.max(0, 1 - Math.abs(d) / w);
    return band * band * (0.6 + 0.4 * (Math.sin(along * dashes * Math.PI * 2) > -0.25 ? 1 : 0.3));
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const sv = y / size;
    let rr = 0, gg = 0, bb = 0, rough = 0.7, h = 0.5;

    if (x < fx0) {
      // ---- leather palm / thumb / heel: dark neutral hide, broad sheen, dark seam grooves
      const su = THREE.MathUtils.clamp((x - lx0) / (lx1 - lx0), 0, 1);
      const grain = fb(su, sv, 40, 4);
      const pores = vn(su, sv, 210);
      const blob = fb(su + 0.5, sv, 6, 3);
      const shine = sstep(blob, 0.48, 0.86);                                    // handled / polished patches
      const s = Math.max(seamG(su - 0.10, 0.014, sv, 26), seamG(su - 0.40, 0.014, sv, 26),
        seamG(su - 0.72, 0.012, sv, 24) * 0.8);
      const g = 0.216 + (grain - 0.5) * 0.058 + (pores - 0.5) * 0.016 + (blob - 0.5) * 0.052;
      rr = g * 1.04; gg = g * 1.0; bb = g * 0.93;
      rr -= s * 0.078; gg -= s * 0.074; bb -= s * 0.070;
      rough = clamp01(0.52 + (grain - 0.5) * 0.18 - shine * 0.14 + s * 0.12);
      h = 0.5 + (grain - 0.5) * 0.30 + (pores - 0.5) * 0.22 - s * 0.55;
    } else if (x < nx0) {
      // ---- finger tube. su = around the finger (0 = palmar seam, 0.5 = dorsal ridge), sv = base -> tip
      const su = THREE.MathUtils.clamp((x - fx0) / (fx1 - fx0), 0, 1);
      const grain = fb(su, sv, 34, 4);
      const pores = vn(su + 0.2, sv, 170);
      const blob = fb(su, sv * 1.6, 5, 3);
      // the two seams that run the whole length of a glove finger, on the flanks
      const s = Math.max(seamG(su - 0.25, 0.028, sv, 30), seamG(su - 0.75, 0.028, sv, 30));
      // grip patch on the palmar face and a rubberised fingertip pad
      const palmar = 1 - sstep(Math.min(su, 1 - su), 0.05, 0.19);
      const pad = sstep(sv, 0.84, 0.93) * (0.35 + 0.65 * palmar);
      const g = 0.206 + (grain - 0.5) * 0.062 + (blob - 0.5) * 0.056 - palmar * 0.026 - pad * 0.030;
      rr = g * 1.04; gg = g * 1.0; bb = g * 0.93;
      rr -= s * 0.074; gg -= s * 0.070; bb -= s * 0.066;
      rough = clamp01(0.50 + (grain - 0.5) * 0.16 + palmar * 0.12 + pad * 0.16 + s * 0.10);
      h = 0.5 + (grain - 0.5) * 0.26 + (pores - 0.5) * 0.12 - s * 0.6 + pad * 0.10;
    } else if (x < sx0) {
      // ---- padded nylon dorsal panel: lengthwise quilt channels (never a square grid) + micro weave
      const su = THREE.MathUtils.clamp((x - nx0) / (nx1 - nx0), 0, 1);
      const dirt = fb(su, sv, 4, 3);
      let ch = 0;
      for (const c of [0.24, 0.53, 0.80]) ch = Math.max(ch, Math.max(0, 1 - Math.abs(su - c) / 0.040));
      const pad = 1 - ch * ch;
      const g = 0.236 + (dirt - 0.5) * 0.058 - ch * ch * 0.032;
      rr = g * 0.99; gg = g * 1.01; bb = g * 0.94;
      rough = clamp01(0.64 + (dirt - 0.5) * 0.12 + ch * 0.08);
      h = 0.5 + pad * 0.22 - ch * ch * 0.34 + weaveH(su, sv, 34) * 0.09;
    } else if (x < cx0) {
      // ---- hard knuckle guard: matte moulded rubber, pebbled, scuffed crown
      const su = THREE.MathUtils.clamp((x - sx0) / (sx1 - sx0), 0, 1);
      const pebble = vn(su, sv, 64);
      const g0 = fb(su, sv, 12, 3);
      const scuff = sstep(fb(su + 0.3, sv, 7, 3), 0.62, 0.93);
      const g = 0.158 + (g0 - 0.5) * 0.034 + scuff * 0.040;
      rr = g * 0.99; gg = g; bb = g * 1.05;
      rough = clamp01(0.60 + (pebble - 0.5) * 0.10 - scuff * 0.20);
      h = 0.5 + (pebble - 0.5) * 0.22 + (g0 - 0.5) * 0.10;
    } else if (x < vx0) {
      // ---- cuff: elastic gauntlet band with a velcro hook field down the middle
      const su = THREE.MathUtils.clamp((x - cx0) / (cx1 - cx0), 0, 1);
      const velcro = sstep(Math.abs(su - 0.5), 0.34, 0.24);
      const hooks = vn(su, sv, 90);
      const dirt = fb(su, sv, 5, 3);
      const g = 0.206 + (dirt - 0.5) * 0.060 - velcro * 0.026;
      rr = g * 1.0; gg = g * 1.0; bb = g * 0.94;
      rough = clamp01(0.74 + velcro * 0.12 + (dirt - 0.5) * 0.10);
      h = 0.5 + weaveH(su, sv, 46) * 0.11 * (1 - velcro) + velcro * (hooks - 0.5) * 0.45;
    } else {
      // ---- sleeve: dark neutral field-uniform cloth. albedo = noise only, weave lives in the normal
      const su = THREE.MathUtils.clamp((x - vx0) / (size - vx0), 0, 1);
      const dirt = fb(su, sv, 5, 4);
      const grime = sstep(fb(su + 0.6, sv * 0.8, 9, 3), 0.58, 0.95);
      // creases: elongated along the limb, irregular, never a lattice. They have to be resolvable at
      // ~15 mm or the sleeve reads as a smooth rubber cone at hip-fire distance.
      const fold = fb(su * 7, sv * 2.4, 3, 7);
      const crease = Math.abs(fb(su * 13, sv * 4.5, 3, 13) - 0.5) * 2;
      // Clearly below the leather (0.216): the hand has to stay the brightest thing on the limb, or the
      // eye lands on the forearm instead of the weapon. Ripstop in daylight is also busier than skin.
      const g = 0.128 + (dirt - 0.5) * 0.070 + (fold - 0.5) * 0.096 - (1 - crease) * 0.054 - grime * 0.036;
      rr = g * 0.99; gg = g * 1.015; bb = g * 0.90;
      rough = clamp01(0.84 + (dirt - 0.5) * 0.12 + grime * 0.08);
      h = 0.5 + (fold - 0.5) * 0.44 - (1 - crease) * 0.40 + weaveH(su, sv, 54) * 0.055;
    }

    // see srgb8: these are sRGB code values, not linear reflectances
    A.data[i] = srgb8(rr); A.data[i + 1] = srgb8(gg); A.data[i + 2] = srgb8(bb); A.data[i + 3] = 255;
    const rv = rough * 255;                                   // roughness/normal maps are linear data
    R.data[i] = rv; R.data[i + 1] = rv; R.data[i + 2] = rv; R.data[i + 3] = 255;
    height[y * size + x] = h;
  }
  ctxA.putImageData(A, 0, 0); ctxR.putImageData(R, 0, 0);
  return { map: tex(ca, true), roughnessMap: tex(cr, false), normalMap: normalFromHeight(height, size, 2.4) };
}

/** Laminated stock wood (sniper). */
function woodMaps(seed: number): MapSet {
  const size = TEX / 2;
  const noise = new Noise(seed);
  const [ca, ctxA] = canvas(size); const [cr, ctxR] = canvas(size);
  const A = ctxA.createImageData(size, size), R = ctxR.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const warp = noise.fbm(u * 3, v * 3, 3, 3) * 6;
    const ring = Math.sin((v * 40 + warp) * Math.PI) * 0.5 + 0.5;
    const grain = noise.fbm(x * 0.8, y * 0.1, 3, 512);
    const g = 0.20 + ring * 0.08 + (grain - 0.5) * 0.06;
    const i = (y * size + x) * 4;
    A.data[i] = g * 1.35 * 255; A.data[i + 1] = g * 0.95 * 255; A.data[i + 2] = g * 0.6 * 255; A.data[i + 3] = 255;
    R.data[i] = R.data[i + 1] = R.data[i + 2] = (0.45 + ring * 0.15) * 255; R.data[i + 3] = 255;
    height[y * size + x] = 0.5 + (ring - 0.5) * 0.3 + (grain - 0.5) * 0.2;
  }
  ctxA.putImageData(A, 0, 0); ctxR.putImageData(R, 0, 0);
  return { map: tex(ca, true), roughnessMap: tex(cr, false), normalMap: normalFromHeight(height, size, 1.2) };
}

/** Red-dot: a crisp 2-MOA-ish dot with a tight bloom halo. */
function reticleTexture(): THREE.CanvasTexture {
  const size = 128;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,1)'); g.addColorStop(0.34, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

/** Scope overlay: eye-relief vignette with a soft edge + a mil-dot / ranging reticle at scope scale. */
function scopeMaskTexture(): THREE.CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas(size);
  const cx = size / 2, cy = size / 2;
  ctx.clearRect(0, 0, size, size);
  // vignette: clear to r=0.40, dark by r=0.5 (the lens disc is the full texture)
  const g = ctx.createRadialGradient(cx, cy, size * 0.40, cx, cy, size * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.45, 'rgba(0,0,0,0.12)'); g.addColorStop(0.85, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // fine crosshair
  ctx.strokeStyle = 'rgba(0,0,0,0.95)'; ctx.lineWidth = 3.0;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke();
  // thick outer posts
  ctx.lineWidth = 14;
  const post = 175;
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(cx - post, cy); ctx.moveTo(cx + post, cy); ctx.lineTo(size, cy); ctx.moveTo(cx, cy + post); ctx.lineTo(cx, size); ctx.stroke();
  // mil hash marks + dots
  ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.lineWidth = 2;
  for (let k = 1; k <= 5; k++) {
    const d = k * 32;
    for (const [x, y] of [[cx + d, cy], [cx - d, cy], [cx, cy + d], [cx, cy - d]]) { ctx.beginPath(); ctx.arc(x, y, k % 2 ? 2.6 : 3.4, 0, Math.PI * 2); ctx.fill(); }
  }
  // ranging chevrons below centre
  ctx.beginPath();
  for (let k = 1; k <= 3; k++) { const y = cy + 55 * k + 20; const w = 10 + k * 3; ctx.moveTo(cx - w, y + 6); ctx.lineTo(cx, y - 4); ctx.lineTo(cx + w, y + 6); }
  ctx.stroke();
  // tiny illuminated centre (drawn faint red so it reads at scope scale)
  ctx.fillStyle = 'rgba(255,45,30,0.95)'; ctx.beginPath(); ctx.arc(cx, cy, 3.0, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

/** Soft radial black disc (contact shadow). */
function shadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [c, ctx] = canvas(size);
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.35, 'rgba(0,0,0,0.6)'); g.addColorStop(0.7, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true;
  return t;
}

/** Muzzle flash sheet: left half = side view cone (base at u=0), right half = radial burst with petals. */
function flashTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size * 2, size);
  const img = ctx.createImageData(size * 2, size);
  const noise = new Noise(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size * 2; x++) {
    const i = (y * size * 2 + x) * 4;
    let a = 0, heat = 0;
    if (x < size) {
      // side cone: along u from base (x=0) to tip; width shrinks; alpha erodes with noise
      const u = x / size, v = (y / size - 0.5) * 2;
      const width = 0.16 + 0.55 * Math.sin(Math.min(1, u * 1.15) * Math.PI) * (1 - u * 0.35);
      const core = 1 - Math.abs(v) / Math.max(width, 1e-3);
      const n = noise.fbm(x * 0.06, y * 0.06, 3, 32);
      a = clamp01(core * 1.4 - 0.15 - (n - 0.5) * 0.9 * u) * (1 - sstep(u, 0.78, 1.0)) * (0.35 + 0.65 * sstep(u, 0.0, 0.08));
      heat = clamp01(core * (1 - u * 0.7) * 1.3);
    } else {
      // radial burst: bright core + 6-8 petals
      const dx = (x - size) / size - 0.5, dy = y / size - 0.5;
      const r = Math.hypot(dx, dy) * 2, ang = Math.atan2(dy, dx);
      const petal = 0.55 + 0.45 * Math.cos(ang * 7 + noise.value(ang * 3, 0, 8) * 3);
      const n = noise.fbm(x * 0.07, y * 0.07, 3, 32);
      const edge = 0.35 + 0.5 * petal;
      a = clamp01((1 - r / edge) * 1.6 - (n - 0.5) * 0.9);
      heat = clamp01(1 - r / 0.45);
    }
    // colour: white-yellow core -> orange edge
    const rr = 1.0, gg = 0.55 + 0.45 * heat, bb = 0.15 + 0.75 * heat * heat;
    img.data[i] = rr * 255; img.data[i + 1] = gg * 255; img.data[i + 2] = bb * 255; img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildMaterials(anisotropy: number): WeaponMaterials {
  const metalM = metalMaps(11, [0.248, 0.240, 0.226], 1.0, 'cerakote');
  const metalD = metalMaps(29, [0.150, 0.147, 0.140], 0.75, 'phosphate');
  const railM = metalMaps(41, [0.132, 0.133, 0.138], 0.9, 'anodised');
  const polyM = polymerMaps(7, [0.150, 0.146, 0.140]);
  const handM = handAtlas(3);
  const woodM = woodMaps(9);
  for (const s of [metalM, metalD, railM, polyM, handM, woodM]) for (const t of [s.map, s.roughnessMap, s.normalMap, s.metalnessMap]) if (t) t.anisotropy = anisotropy;

  const metal = new THREE.MeshPhysicalMaterial({
    map: metalM.map, roughnessMap: metalM.roughnessMap, metalnessMap: metalM.metalnessMap, normalMap: metalM.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    color: 0xffffff, metalness: 1, roughness: 1, envMapIntensity: 0.7, vertexColors: true,
  });
  const metalDark = new THREE.MeshPhysicalMaterial({
    map: metalD.map, roughnessMap: metalD.roughnessMap, metalnessMap: metalD.metalnessMap, normalMap: metalD.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
    color: 0xffffff, metalness: 1, roughness: 1, envMapIntensity: 0.65, vertexColors: true,
  });
  // Rails and optic mounts: hard-anodised aluminium, rough 0.30-0.50 against the receiver's 0.39-0.81,
  // near-fully metallic, with the slot corners worn back to bare metal by mounting hardware.
  const rail = new THREE.MeshPhysicalMaterial({
    map: railM.map, roughnessMap: railM.roughnessMap, metalnessMap: railM.metalnessMap, normalMap: railM.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0xffffff, metalness: 1, roughness: 1, envMapIntensity: 1.05, vertexColors: true,
  });
  const polymer = new THREE.MeshPhysicalMaterial({
    map: polyM.map, roughnessMap: polyM.roughnessMap, normalMap: polyM.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
    color: 0xffffff, metalness: 0, roughness: 1, clearcoat: 0.18, clearcoatRoughness: 0.6, envMapIntensity: 0.8, vertexColors: true,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92, metalness: 0, normalMap: polyM.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 0.5, vertexColors: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.38, metalness: 1, envMapIntensity: 1.0, vertexColors: true });
  // optic glass: near-clear with a faint green edge tint; low env intensity so it never reads as a blue mirror
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xcfe6d8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.09, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: 0.55, side: THREE.DoubleSide, depthWrite: false, ior: 1.5, reflectivity: 0.5, vertexColors: false,
  });
  const lensInner = new THREE.MeshStandardMaterial({ color: 0x06080c, roughness: 0.25, metalness: 0.6, envMapIntensity: 0.4 });
  // Glove: dark hide, low albedo, but a broad worn-leather sheen so the *form* is read off the specular
  // (ref_06: mean luminance ~48/255 with specular hits to 240 — dark material, high contrast, not flat black).
  const glove = new THREE.MeshPhysicalMaterial({
    map: handM.map, roughnessMap: handM.roughnessMap, normalMap: handM.normalMap, normalScale: new THREE.Vector2(1.25, 1.25),
    color: 0xffffff, metalness: 0, roughness: 1, envMapIntensity: 0.82, vertexColors: true,
    clearcoat: 0.06, clearcoatRoughness: 0.6, specularIntensity: 0.85,
    // sheen is a grazing-angle lobe: at 0.30 it lit the whole forearm, because from a first-person
    // camera almost every visible sleeve texel is at a grazing angle. Kept low so it reads on the
    // leather's curvature without turning the sleeve into a lit tube.
    sheen: 0.14, sheenColor: new THREE.Color(0x5a544c), sheenRoughness: 0.6,
  });
  const plate = new THREE.MeshPhysicalMaterial({
    map: polyM.map, roughnessMap: polyM.roughnessMap, normalMap: polyM.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    color: 0xd9d9d9, metalness: 0, roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.35, envMapIntensity: 0.9, vertexColors: true,
  });
  const wood = new THREE.MeshPhysicalMaterial({ map: woodM.map, roughnessMap: woodM.roughnessMap, normalMap: woodM.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.8, vertexColors: true });
  const stockPoly = new THREE.MeshPhysicalMaterial({
    map: polyM.map, roughnessMap: polyM.roughnessMap, normalMap: polyM.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
    color: new THREE.Color(2.2, 2.4, 1.7), metalness: 0, roughness: 1, clearcoat: 0.2, clearcoatRoughness: 0.6, envMapIntensity: 0.8, vertexColors: true,
  });
  const red = new THREE.MeshStandardMaterial({ color: 0x8c1f1f, roughness: 0.45, metalness: 0, envMapIntensity: 0.8, vertexColors: true });
  const led = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 0.35, 0.18), toneMapped: false });
  const scopeView = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.34, 1.30, 1.20), toneMapped: false });
  const scopeMask = new THREE.MeshBasicMaterial({ map: scopeMaskTexture(), transparent: true, depthWrite: false, toneMapped: false });
  const reticle = new THREE.MeshBasicMaterial({ map: reticleTexture(), color: new THREE.Color(9, 0.55, 0.3), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const shadow = new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
  const flash = new THREE.MeshBasicMaterial({ map: flashTexture(17), color: new THREE.Color(5.5, 3.6, 2.0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });

  const engraving: WeaponMaterials['engraving'] = (lines, opts = {}) => {
    const size = opts.size ?? 512;
    const [c, ctx] = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const font = opts.font ?? 44;
    ctx.fillStyle = opts.color ?? '#d8d8d8';
    ctx.font = `bold ${font}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textBaseline = 'top';
    let y = size * 0.5 - (lines.length * font * 1.25) / 2;
    for (const l of lines) { ctx.fillText(l, size * 0.06, y); y += font * 1.25; }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.55, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, envMapIntensity: 0.8 });
  };
  const witness: WeaponMaterials['witness'] = () => {
    const size = 256;
    const [c, ctx] = canvas(size);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#e4e4e4';
    ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    for (let i = 0; i < 5; i++) { const y = 26 + i * 44; ctx.fillRect(size * 0.46, y, 14, 4); ctx.fillText(String(30 - i * 5), size * 0.55, y - 9); }
    ctx.font = 'bold 20px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('5.56x45', size * 0.1, size - 40);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  };

  const engravingSheet: WeaponMaterials['engravingSheet'] = (panels) => {
    const size = 1024;
    const [c, ctx] = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const rowH = size / panels.length;
    const rects: [number, number, number, number][] = [];
    panels.forEach((pn, i) => {
      const font = (pn.font ?? 40) * 2;
      const top = i * rowH;
      const style = pn.style ?? 'etch';
      if (style === 'label' || style === 'plate') {
        // dark plate with rounded corners, a coloured header strip and rivet dots
        const pad = rowH * 0.08;
        ctx.fillStyle = style === 'label' ? 'rgba(28,28,30,0.96)' : 'rgba(70,72,76,0.97)';
        roundRect(ctx, pad, top + pad, size - pad * 2, rowH - pad * 2, rowH * 0.08); ctx.fill();
        ctx.strokeStyle = 'rgba(190,190,190,0.55)'; ctx.lineWidth = 3;
        roundRect(ctx, pad, top + pad, size - pad * 2, rowH - pad * 2, rowH * 0.08); ctx.stroke();
        if (style === 'label') { ctx.fillStyle = pn.accent ?? '#e0b020'; ctx.fillRect(pad + 3, top + pad + 3, size - pad * 2 - 6, rowH * 0.2); }
        ctx.fillStyle = '#c8c8c8';
        for (const [x, y] of [[pad * 2, top + rowH - pad * 2], [size - pad * 2, top + rowH - pad * 2]]) { ctx.beginPath(); ctx.arc(x, y, rowH * 0.03, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.fillStyle = pn.color ?? (style === 'etch' ? '#d8d8d8' : '#e8e8e8');
      ctx.font = `${style === 'etch' ? 'bold ' : ''}${font}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const block = pn.lines.length * font * 1.25;
      let y = top + rowH / 2 - block / 2 + (style === 'label' ? rowH * 0.1 : 0);
      for (const l of pn.lines) { ctx.fillText(l, size * 0.06, y); y += font * 1.25; }
      // canvas y is top-down, uv v is bottom-up
      rects.push([0, 1 - (top + rowH) / size, 1, 1 - top / size]);
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; t.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, envMapIntensity: 0.7 });
    return { mat, rects };
  };

  return { metal, metalDark, rail, polymer, rubber, brass, glass, lensInner, glove, plate, wood, stockPoly, red, led, scopeView, scopeMask, reticle, shadow, flash, engraving, witness, engravingSheet };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
