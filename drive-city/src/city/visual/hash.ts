/**
 * 32-bit integer hash (lowbias32, Chris Wellons) written identically in JS and GLSL ES 3.0, so the
 * tile worker and the facade shader make the same per-cell choices (which bay is a balcony, which
 * shop has which sign) without passing them per vertex.
 */
export function hashU(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
export const hash3 = (a: number, b: number, c: number): number => hashU((a >>> 0) ^ hashU((((b >>> 0) + 0x9e3779b9) ^ hashU(c >>> 0)) >>> 0));
export const h01 = (h: number): number => (h & 0xffffff) / 16777216;

/** Seeded mulberry32 stream for the worker (placement of roof clutter and street furniture). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GLSL_HASH = /* glsl */`
uint cityHashU(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
uint cityHash3(uint a, uint b, uint c) { return cityHashU(a ^ cityHashU((b + 0x9e3779b9u) ^ cityHashU(c))); }
float cityH01(uint h) { return float(h & 0xffffffu) / 16777216.0; }
float cityVNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  uvec2 q = uvec2(ivec2(i) + 32768);
  float a = cityH01(cityHash3(q.x, q.y, 7u)), b = cityH01(cityHash3(q.x + 1u, q.y, 7u));
  float c = cityH01(cityHash3(q.x, q.y + 1u, 7u)), d = cityH01(cityHash3(q.x + 1u, q.y + 1u, 7u));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;
