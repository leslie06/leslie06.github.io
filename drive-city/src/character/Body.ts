import * as THREE from 'three';

/**
 * The human skeleton, the look of a person, and the random variety of Beijing street clothing.
 *
 * Metres, origin between the feet, facing +Z, +X to the character's left. The canonical person is
 * 1.75 m tall (7.5 heads, shoulders ~0.43 m across the deltoids); everyone else is that skeleton
 * scaled uniformly by `height / 1.75` and reshaped by the `fem` / `build` blend shapes (BodyMesh).
 */
export const J = {
  pelvis: 0, spine: 1, chest: 2, neck: 3, head: 4,
  shoulderL: 5, elbowL: 6, wristL: 7, shoulderR: 8, elbowR: 9, wristR: 10,
  hipL: 11, kneeL: 12, ankleL: 13, hipR: 14, kneeR: 15, ankleR: 16,
} as const;
export const JOINT_COUNT = 17;
export const BASE_HEIGHT = 1.75;

/**
 * Parent index and rest offset from the parent (pelvis offset is from the root at the feet), in
 * the "arms hanging straight down" pose every animation angle is relative to.
 */
export const SKELETON: { parent: number; offset: [number, number, number] }[] = [
  { parent: -1, offset: [0, 0.98, 0] },            // pelvis (centre of the hip bones)
  { parent: 0, offset: [0, 0.12, -0.01] },          // spine (lumbar, waist)
  { parent: 1, offset: [0, 0.2, 0] },               // chest (mid rib cage)
  { parent: 2, offset: [0, 0.175, -0.015] },        // neck (base of the neck, C7)
  { parent: 3, offset: [0, 0.11, 0.02] },           // head (atlas pivot, level with the ear canals)
  { parent: 2, offset: [0.172, 0.12, -0.015] },     // shoulderL (glenohumeral joint)
  { parent: 5, offset: [0, -0.285, 0] },            // elbowL
  { parent: 6, offset: [0, -0.25, 0] },             // wristL
  { parent: 2, offset: [-0.172, 0.12, -0.015] },    // shoulderR
  { parent: 8, offset: [0, -0.285, 0] },            // elbowR
  { parent: 9, offset: [0, -0.25, 0] },             // wristR
  { parent: 0, offset: [0.088, -0.055, 0] },        // hipL
  { parent: 11, offset: [0, -0.425, 0] },           // kneeL
  { parent: 12, offset: [0, -0.415, 0] },           // ankleL (0.085 above the sole)
  { parent: 0, offset: [-0.088, -0.055, 0] },       // hipR
  { parent: 14, offset: [0, -0.425, 0] },           // kneeR
  { parent: 15, offset: [0, -0.415, 0] },           // ankleR
];

/** Segment lengths the IK and the mesh share. */
export const THIGH = 0.425, SHIN = 0.415, UPPER_ARM = 0.285, FOREARM = 0.25, HAND = 0.19;
/** Ankle height above the sole, heel behind and ball of the foot ahead of the ankle. */
export const ANKLE_H = 0.085, HEEL = 0.055, BALL = 0.13;

/**
 * The mesh is modelled in an A-pose (arms 29 deg out from the body), which deforms far better at
 * the shoulder than arms-down: every pose angle stays within ~35 deg of it. Euler ZXY per joint.
 */
export const BIND_ARM = 0.5;
export const BIND_ROT: [number, number, number][] = Array.from({ length: JOINT_COUNT }, () => [0, 0, 0]);
BIND_ROT[J.shoulderL][2] = BIND_ARM;
BIND_ROT[J.shoulderR][2] = -BIND_ARM;

export type TopKind = 'tee' | 'shirt' | 'jacket' | 'coat' | 'hoodie';
export type BottomKind = 'trousers' | 'shorts' | 'skirt';
export type HairKind = 'bald' | 'buzz' | 'short' | 'long' | 'bob' | 'ponytail' | 'bun';

/**
 * How one person looks. The first five colours are required (callers build literals with just
 * those); everything else is optional and defaults to a man of 1.75 m in a t-shirt and trousers
 * with short hair. `shirt` colours whatever top is worn, `pants` whatever is worn below.
 * A Look is packed for the GPU once per object (Crowd caches it on the Gait): replace the object,
 * don't mutate its colours in place.
 */
export interface Look {
  skin: THREE.Color; shirt: THREE.Color; pants: THREE.Color; shoes: THREE.Color; hair: THREE.Color;
  /** Metres, 1.55 .. 1.90 (default 1.75). */
  height?: number;
  /** -0.6 slim .. 0 average .. 1 heavy. */
  build?: number;
  /** 0 male .. 1 female body shape. */
  fem?: number;
  top?: TopKind;
  /** Sleeve end, metres down the arm from the shoulder (0.15 short, 0.36 rolled, 0.53 full). */
  sleeve?: number;
  /** The layer under an open jacket or coat. */
  inner?: THREE.Color;
  bottom?: BottomKind;
  /** Trousers/shorts: hem, metres down the leg from the hip (0.8 ankle, 0.3 shorts). Skirt: 0.3 mini .. 1 knee. */
  hem?: number;
  hairStyle?: HairKind;
  /** A baseball cap in this colour. */
  cap?: THREE.Color | null;
  glasses?: boolean;
  /** A face mask in this colour. */
  mask?: THREE.Color | null;
  /** Shoe sole (white trainers vs dark leather). */
  sole?: THREE.Color;
  /** Socks/tights colour shown between hem and shoe (skirts, cropped trousers). */
  legwear?: THREE.Color | null;
  /** 0 young .. 1 elderly (grey hair, slower gait). */
  age?: number;
  /** Stubble on the jaw. */
  beard?: boolean;
  /** A fringe over the forehead (short, bob and long hair). */
  fringe?: boolean;
  /** A graphic on a t-shirt; pleats on a skirt. */
  print?: boolean;
}

const TOPS: Record<TopKind, number> = { tee: 0, shirt: 1, jacket: 2, coat: 3, hoodie: 4 };
const BOTTOMS: Record<BottomKind, number> = { trousers: 0, shorts: 1, skirt: 2 };
const HAIRS: Record<HairKind, number> = { bald: 0, buzz: 1, short: 2, long: 3, bob: 4, ponytail: 5, bun: 6 };

/** Floats per packed look (5 texels). Layout documented in CrowdShader. */
export const LOOK_FLOATS = 20;

const _srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
/** A linear colour as one exactly-representable float (8-bit sRGB per channel). */
export function packColor(c: THREE.Color | null | undefined, fallback: number): number {
  if (!c) return fallback;
  const r = Math.round(THREE.MathUtils.clamp(_srgb(c.r), 0, 1) * 255);
  const g = Math.round(THREE.MathUtils.clamp(_srgb(c.g), 0, 1) * 255);
  const b = Math.round(THREE.MathUtils.clamp(_srgb(c.b), 0, 1) * 255);
  return r * 65536 + g * 256 + b;
}

/** Height scale of a look (feet stay on the ground; taller people stand taller). */
export function lookScale(l: Look): number {
  return THREE.MathUtils.clamp(l.height ?? BASE_HEIGHT, 1.4, 2.05) / BASE_HEIGHT;
}

/** Pack a look into `out[o .. o+20)`. */
export function packLook(l: Look, out: Float32Array, o: number): void {
  const top = TOPS[l.top ?? 'tee'] ?? 0;
  const bottom = BOTTOMS[l.bottom ?? 'trousers'] ?? 0;
  const hair = HAIRS[l.hairStyle ?? 'short'] ?? 2;
  const sleeve = l.sleeve ?? (top === 0 ? 0.15 : 0.53);
  const hem = l.hem ?? (bottom === 0 ? 0.81 : bottom === 1 ? 0.3 : 0.75);
  const topC = packColor(l.shirt, 0xeeeeee);
  const flags = (l.glasses ? 1 : 0) | (l.mask ? 2 : 0) | (l.cap ? 4 : 0) | (l.beard ? 8 : 0) | (l.legwear ? 16 : 0) | (l.fringe ? 32 : 0) | (l.print ? 64 : 0);
  out[o] = packColor(l.skin, 0xe2bd98); out[o + 1] = topC; out[o + 2] = packColor(l.inner, topC); out[o + 3] = packColor(l.pants, 0x222222);
  out[o + 4] = packColor(l.shoes, 0x1a1a1a); out[o + 5] = packColor(l.hair, 0x141212); out[o + 6] = packColor(l.cap, 0x222222); out[o + 7] = packColor(l.sole, packColor(l.shoes, 0x1a1a1a));
  out[o + 8] = top; out[o + 9] = sleeve; out[o + 10] = bottom; out[o + 11] = hem;
  out[o + 12] = hair; out[o + 13] = THREE.MathUtils.clamp(l.fem ?? 0, 0, 1); out[o + 14] = THREE.MathUtils.clamp(l.build ?? 0, -0.7, 1.2); out[o + 15] = flags;
  out[o + 16] = packColor(l.mask, 0xdfe6ea); out[o + 17] = THREE.MathUtils.clamp(l.age ?? 0.3, 0, 1); out[o + 18] = packColor(l.legwear, 0x202022);
  out[o + 19] = 0; // per frame: prop in hand (Crowd writes Gait.prop here)
}

// Beijing street palettes: mostly muted, dark and neutral, with a few colour accents.
const SKIN = ['#efd2b4', '#e9c9a8', '#e4c19c', '#dcb58e', '#d4a982', '#c99c74', '#bd8e66', '#f1d7bd'];
const TOP_M = ['#1c1c1e', '#26282b', '#34373b', '#eceae4', '#d8d6cf', '#7d8186', '#1f2a44', '#2b3a55', '#4a5a3c', '#56603f', '#6b2a33', '#8a8f96', '#b9a98a', '#9c8b63', '#3d4c63', '#a33a32', '#c8b79a', '#e8e3d6'];
const TOP_F = ['#1c1c1e', '#f0ede6', '#e6dccd', '#d9a3aa', '#c98f8f', '#8aa0b8', '#6f86a3', '#2a2e36', '#b9a98a', '#7a5a78', '#c39a3a', '#9fb39a', '#e8cfc0', '#3b4a6b', '#a33a3f', '#dcd3c3', '#556b8a', '#f4f1ea'];
const COAT = ['#1d1e21', '#2c2f33', '#3a3530', '#a47c52', '#8a6a4a', '#4a4e54', '#1f2638', '#6b6258', '#c2b49a', '#5a3c33'];
const BOT_M = ['#1b1c1f', '#26324a', '#2f3f5c', '#3e5474', '#585c62', '#4a4a48', '#8f8166', '#20263a', '#6b6254', '#2a2a2a'];
const BOT_F = ['#1b1c1f', '#26324a', '#3e5474', '#6d86a8', '#c9bfa9', '#e9e5dc', '#585c62', '#2a2a2e', '#8a7a66', '#7c4f5a'];
const SKIRT = ['#1b1c1f', '#2a2e36', '#6b5a4a', '#c9bfa9', '#3b4a6b', '#7c4f5a', '#8a8f96', '#e9e5dc', '#a87c6c', '#4d5a47'];
const SHOE = ['#f2f2ef', '#ecebe6', '#1a1a1a', '#222326', '#3a2f28', '#5a4636', '#5a5f66', '#8b8f95', '#e9e4da', '#23324f', '#9a2b2b'];
const HAIR_C = ['#0e0d0d', '#141212', '#1a1614', '#211a16', '#2a211b', '#3a2a20', '#4a3526', '#5e4330'];
const GREY = ['#8d8a86', '#a9a6a1', '#c7c4be', '#6e6a66', '#d8d5cf'];
const CAP_C = ['#1c1c1e', '#f0efea', '#1f2a44', '#8a2a2a', '#5a6a4a', '#c7b48f', '#3a4f6e'];
const MASK_C = ['#dfe8ef', '#bcd2e6', '#f2f2f0', '#1e1f22', '#9fb7cc'];

/** A random passer-by. `rnd` returns [0, 1). Always returns every field. */
export function randomLook(rnd: () => number): Look {
  const pick = (a: string[]) => new THREE.Color(a[Math.floor(rnd() * a.length) % a.length]);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
  const chance = (p: number) => rnd() < p;
  const fem = chance(0.5) ? 0.85 + rnd() * 0.15 : rnd() * 0.08;
  const woman = fem > 0.5;
  const age = rnd() < 0.18 ? 0.75 + rnd() * 0.25 : rnd() * 0.6;
  const old = age > 0.72;
  const height = THREE.MathUtils.clamp(woman ? 1.615 + gauss() * 0.055 : 1.725 + gauss() * 0.065, 1.55, 1.9) - (old ? 0.03 : 0);
  const build = THREE.MathUtils.clamp(gauss() * 0.38 + (old ? 0.25 : 0) - (woman ? 0.1 : 0), -0.6, 1);

  let top: TopKind;
  const t = rnd();
  if (woman) top = t < 0.34 ? 'tee' : t < 0.58 ? 'shirt' : t < 0.8 ? 'jacket' : t < 0.92 ? 'coat' : 'hoodie';
  else top = t < 0.4 ? 'tee' : t < 0.6 ? 'shirt' : t < 0.82 ? 'jacket' : t < 0.9 ? 'coat' : 'hoodie';
  const shirt = top === 'coat' ? pick(COAT) : pick(woman ? TOP_F : TOP_M);
  const inner = pick(woman ? TOP_F : TOP_M);
  const sleeve = top === 'tee' ? 0.13 + rnd() * 0.05 : top === 'shirt' && chance(0.4) ? 0.34 + rnd() * 0.05 : 0.525;

  let bottom: BottomKind;
  const b = rnd();
  if (woman) bottom = top === 'coat' ? (b < 0.7 ? 'trousers' : 'skirt') : b < 0.55 ? 'trousers' : b < 0.83 ? 'skirt' : 'shorts';
  else bottom = top === 'coat' || top === 'jacket' || old ? 'trousers' : b < 0.84 ? 'trousers' : 'shorts';
  const pants = bottom === 'skirt' ? pick(SKIRT) : pick(woman ? BOT_F : BOT_M);
  const hem = bottom === 'trousers' ? (woman && chance(0.25) ? 0.72 + rnd() * 0.04 : 0.8 + rnd() * 0.02)
    : bottom === 'shorts' ? 0.24 + rnd() * 0.1 : 0.45 + rnd() * 0.55;

  let hairStyle: HairKind;
  const h = rnd();
  if (woman) hairStyle = h < 0.38 ? 'long' : h < 0.62 ? 'ponytail' : h < 0.82 ? 'bob' : h < 0.93 ? 'bun' : 'short';
  else hairStyle = old && h < 0.3 ? 'bald' : h < 0.62 ? 'short' : h < 0.88 ? 'buzz' : h < 0.95 ? 'bald' : 'long';
  const hair = old && chance(0.75) ? pick(GREY) : pick(HAIR_C);
  if (!woman && hair.r > 0.2 && chance(0.4) && hairStyle !== 'bald') hairStyle = 'short';
  const cap = !old && chance(woman ? 0.06 : 0.12) ? pick(CAP_C) : null;
  if (cap && (hairStyle === 'long' || hairStyle === 'bun')) hairStyle = 'ponytail';

  const shoes = pick(SHOE);
  const light = shoes.r + shoes.g + shoes.b > 1.5;
  const sole = light || chance(0.5) ? new THREE.Color('#f3f2ee') : shoes.clone().multiplyScalar(0.6);
  const legwear = bottom === 'skirt' && chance(0.45) ? new THREE.Color(chance(0.7) ? '#15161a' : '#c9b7a6') : null;

  return {
    skin: pick(SKIN), shirt, pants, shoes, hair,
    height, build, fem, top, sleeve, inner, bottom, hem, hairStyle, cap,
    glasses: chance(old ? 0.45 : 0.28), mask: chance(0.06) ? pick(MASK_C) : null,
    sole, legwear, age, beard: !woman && chance(old ? 0.35 : 0.15),
    fringe: (hairStyle === 'long' || hairStyle === 'bob' || (hairStyle === 'short' && woman)) && chance(0.55),
    print: (top === 'tee' && chance(0.35)) || (bottom === 'skirt' && chance(0.4)),
  };
}
