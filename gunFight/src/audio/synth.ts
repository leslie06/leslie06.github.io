/**
 * Pure DSP: every sound in GUNFIGHT is rendered from these functions into Float32Arrays
 * (mono, sample-based) and then played through Web Audio graphs. Nothing here touches the
 * DOM or an AudioContext, so it runs identically in vitest (node), in the page, and inside
 * an OfflineAudioContext render.
 *
 * Design language (target: MWIII-style gunfire):
 *   gunshot = sub thump (sine sweep) + body (low-mid resonance) + crack (band-passed noise, ~1-3 kHz,
 *             fast decay) + mechanical click (2-5 kHz transient) + tail (long low-passed noise, goes to
 *             the convolution reverb) + optional discrete street echoes, then soft-clipped.
 */
import { Rng } from '../core/Rng';

export type Mono = Float32Array<ArrayBuffer>;

// ---------------------------------------------------------------- primitives

export function seedFor(id: string, variant = 0): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h + variant * 7919) >>> 0 || 1;
}

export function zeros(n: number): Mono { return new Float32Array(Math.max(1, n | 0)); }

export function noise(n: number, rng: Rng): Mono {
  const out = zeros(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** e^(-t/tau) starting after `hold` seconds, with an optional linear attack (seconds). */
export function expEnv(n: number, sr: number, tau: number, attack = 0, hold = 0): Mono {
  const out = zeros(n);
  const a = Math.max(1, Math.round(attack * sr));
  const h = Math.round(hold * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = i < h ? 1 : Math.exp(-(t - hold) / tau);
    out[i] = env * (i < a && attack > 0 ? i / a : 1);
  }
  return out;
}

export function mul(a: Mono, b: Mono): Mono {
  const n = Math.min(a.length, b.length); const out = zeros(a.length);
  for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
  return out;
}

export function scale(a: Mono, g: number): Mono { const out = zeros(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] * g; return out; }

/** dst += src * gain, starting at `offset` samples. */
export function mixInto(dst: Mono, src: Mono, gain = 1, offset = 0): Mono {
  const o = Math.max(0, offset | 0);
  const n = Math.min(src.length, dst.length - o);
  for (let i = 0; i < n; i++) dst[o + i] += src[i] * gain;
  return dst;
}

export function sine(n: number, sr: number, freq: number, phase = 0): Mono {
  const out = zeros(n); const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < n; i++) out[i] = Math.sin(phase + w * i);
  return out;
}

/** Exponential frequency sweep f0 -> f1 over `dur` seconds (holds f1 after). */
export function sineSweep(n: number, sr: number, f0: number, f1: number, dur: number): Mono {
  const out = zeros(n); let ph = 0;
  const k = Math.log(f1 / f0);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, i / sr / Math.max(1e-4, dur));
    const f = f0 * Math.exp(k * t);
    out[i] = Math.sin(ph); ph += 2 * Math.PI * f / sr;
  }
  return out;
}

/** Simple 2-op FM: carrier fc modulated by fmod with index `idx` (grunts/voices/UI tones). `glide` multiplies pitch over the length. */
export function fm(n: number, sr: number, fc: number, fmod: number, idx: number, glide = 1): Mono {
  const out = zeros(n); let ph = 0, mph = 0;
  for (let i = 0; i < n; i++) {
    const g = 1 + (glide - 1) * (i / n);
    out[i] = Math.sin(ph + idx * Math.sin(mph));
    ph += 2 * Math.PI * fc * g / sr; mph += 2 * Math.PI * fmod * g / sr;
  }
  return out;
}

export type FilterType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'lowshelf' | 'highshelf';

/** RBJ cookbook biquad, applied offline. Returns a new array. */
export function biquad(x: Mono, sr: number, type: FilterType, freq: number, q = 0.707, gainDb = 0): Mono {
  const f = Math.min(Math.max(freq, 10), sr * 0.45);
  const w0 = 2 * Math.PI * f / sr, cw = Math.cos(w0), sw = Math.sin(w0);
  const Q = Math.max(0.05, q); const alpha = sw / (2 * Q); const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break; // constant peak gain
    case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    case 'lowshelf': { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
    case 'highshelf': { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = zeros(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]; const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}

export function bandpass(x: Mono, sr: number, f: number, q: number, stages = 1): Mono { let y = x; for (let i = 0; i < stages; i++) y = biquad(y, sr, 'bp', f, q); return y; }
export function lowpass(x: Mono, sr: number, f: number, q = 0.707, stages = 1): Mono { let y = x; for (let i = 0; i < stages; i++) y = biquad(y, sr, 'lp', f, q); return y; }
export function highpass(x: Mono, sr: number, f: number, q = 0.707, stages = 1): Mono { let y = x; for (let i = 0; i < stages; i++) y = biquad(y, sr, 'hp', f, q); return y; }

/** One-pole low-pass whose cutoff moves linearly from f0 to f1 across the buffer. */
export function sweepLowpass(x: Mono, sr: number, f0: number, f1: number): Mono {
  const y = zeros(x.length); let s = 0;
  for (let i = 0; i < x.length; i++) {
    const f = f0 + (f1 - f0) * (i / x.length);
    const a = 1 - Math.exp(-2 * Math.PI * Math.max(10, f) / sr);
    s += a * (x[i] - s); y[i] = s;
  }
  return y;
}

/** tanh soft clipper with drive; keeps peak <= 1. */
export function softClip(x: Mono, drive = 1.5): Mono {
  const y = zeros(x.length); const norm = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i] * drive) / norm;
  return y;
}

export function peak(x: Mono): number { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; }
export function rms(x: Mono, start = 0, end = x.length): number { let s = 0; const n = Math.max(1, end - start); for (let i = start; i < end; i++) s += x[i] * x[i]; return Math.sqrt(s / n); }
export function hasNaN(x: Mono): boolean { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return true; return false; }

export function normalize(x: Mono, target = 0.95): Mono {
  const p = peak(x); if (p < 1e-9) return x;
  return scale(x, target / p);
}

/** Linear fade in/out at the edges (seconds) to kill clicks. */
export function fadeEdges(x: Mono, sr: number, fadeIn: number, fadeOut: number): Mono {
  const y = zeros(x.length); y.set(x);
  const a = Math.round(fadeIn * sr), b = Math.round(fadeOut * sr);
  for (let i = 0; i < a && i < y.length; i++) y[i] *= i / a;
  for (let i = 0; i < b && i < y.length; i++) y[y.length - 1 - i] *= i / b;
  return y;
}

/** Make a buffer loop seamlessly by cross-fading its last `fade` seconds into its start. */
export function makeLoopable(x: Mono, sr: number, fade: number): Mono {
  const f = Math.min(Math.round(fade * sr), Math.floor(x.length / 2));
  const n = x.length - f; const y = zeros(n);
  for (let i = 0; i < n; i++) y[i] = x[i];
  for (let i = 0; i < f; i++) { const t = i / f; y[i] = x[i] * t + x[n + i] * (1 - t); }
  return y;
}

// ---------------------------------------------------------------- analysis helpers (tests + in-page critique)

/** In-place radix-2 FFT on (re, im). n must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len; const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Power spectrum (Hann-windowed) of x[start..start+len). Returns magnitudes^2 for bins 0..N/2. */
export function powerSpectrum(x: Mono, start = 0, len = 2048): Float64Array {
  let n = 1; while (n < len) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < len; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len); re[i] = (x[start + i] ?? 0) * w; }
  fft(re, im);
  const out = new Float64Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

export function spectralCentroid(x: Mono, sr: number, start = 0, len = 2048): number {
  const ps = powerSpectrum(x, start, len); let n = 1; while (n < len) n <<= 1;
  let num = 0, den = 0;
  for (let i = 0; i < ps.length; i++) { const f = i * sr / n; num += f * ps[i]; den += ps[i]; }
  return den > 0 ? num / den : 0;
}

/** Fraction of spectral energy between lo and hi Hz. */
export function bandEnergyRatio(x: Mono, sr: number, lo: number, hi: number, start = 0, len = 4096): number {
  const ps = powerSpectrum(x, start, len); let n = 1; while (n < len) n <<= 1;
  let band = 0, tot = 0;
  for (let i = 0; i < ps.length; i++) { const f = i * sr / n; tot += ps[i]; if (f >= lo && f < hi) band += ps[i]; }
  return tot > 0 ? band / tot : 0;
}

/** Seconds from 10% to 90% of the peak absolute level (standard 10-90 rise time). */
export function attackTime(x: Mono, sr: number): number {
  const p = peak(x); if (p <= 0) return 0;
  let first = -1, pi = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (first < 0 && a > p * 0.1) first = i; if (a >= p * 0.9) { pi = i; break; } }
  return Math.max(0, pi - Math.max(0, first)) / sr;
}

/** Seconds until the running RMS (10ms windows) falls `db` below its peak. */
export function decayTime(x: Mono, sr: number, db = 40): number {
  const win = Math.max(1, Math.round(sr * 0.01));
  const levels: number[] = [];
  for (let i = 0; i + win <= x.length; i += win) levels.push(rms(x, i, i + win));
  const pk = Math.max(...levels, 1e-9); const thr = pk * Math.pow(10, -db / 20);
  const pi = levels.indexOf(pk);
  for (let i = pi; i < levels.length; i++) if (levels[i] < thr) return (i - pi) * win / sr;
  return (levels.length - pi) * win / sr;
}

// ---------------------------------------------------------------- gunshots

export interface GunRecipe {
  length: number;
  sub: { f0: number; f1: number; dur: number; gain: number };
  body?: { freq: number; q?: number; tau: number; gain: number };
  crack: { center: number; q: number; tau: number; gain: number; stages?: number };
  click: { freq: number; tau: number; gain: number };
  tail: { tau: number; lp: number; hp?: number; gain: number };
  /** discrete street slap-backs [seconds, gain] applied to a low-passed copy of the shot */
  echoes?: [number, number][];
  drive: number;
  /** extra broadband "air" burst on top of the crack, for very sharp weapons */
  air?: { tau: number; gain: number };
}

export function gunshot(sr: number, r: GunRecipe, rng: Rng): Mono {
  const n = Math.round(r.length * sr); const out = zeros(n);
  // sub thump: sine sweep, hard attack, exp decay
  const sub = mul(sineSweep(n, sr, r.sub.f0, r.sub.f1, r.sub.dur), expEnv(n, sr, r.sub.dur * 0.9, 0.0005));
  mixInto(out, sub, r.sub.gain);
  // body: low-mid resonant burst (chest punch)
  if (r.body) {
    const b = bandpass(mul(noise(n, rng), expEnv(n, sr, r.body.tau)), sr, r.body.freq, r.body.q ?? 2.5, 2);
    mixInto(out, normalize(b, 1), r.body.gain);
  }
  // crack: band-passed noise, very fast decay
  const crack = bandpass(mul(noise(n, rng), expEnv(n, sr, r.crack.tau)), sr, r.crack.center, r.crack.q, r.crack.stages ?? 2);
  mixInto(out, normalize(crack, 1), r.crack.gain);
  // air: bright broadband burst (2.5 kHz+), sharper than the crack
  if (r.air) {
    const air = highpass(mul(noise(n, rng), expEnv(n, sr, r.air.tau)), sr, 2500, 0.8, 2);
    mixInto(out, normalize(air, 1), r.air.gain);
  }
  // mechanical click: 2-5 kHz transient with a tiny ring
  const clk = bandpass(mul(noise(n, rng), expEnv(n, sr, r.click.tau)), sr, r.click.freq, 1.2, 1);
  const ring = mul(sine(n, sr, r.click.freq * 1.31), expEnv(n, sr, r.click.tau * 2.5));
  mixInto(out, normalize(clk, 1), r.click.gain);
  mixInto(out, ring, r.click.gain * 0.25);
  // tail: long noise, low-passed, high-passed to keep mud out; slow amplitude flutter reads as reflections off facades
  let tail = mul(noise(n, rng), expEnv(n, sr, r.tail.tau, 0.004, 0.01));
  tail = lowpass(tail, sr, r.tail.lp, 0.8, 2); tail = highpass(tail, sr, r.tail.hp ?? 90, 0.7);
  const flutter = 11 + 7 * rng.next();
  for (let i = 0; i < n; i++) tail[i] *= 0.75 + 0.25 * Math.sin(i / sr * flutter * 2 * Math.PI);
  mixInto(out, normalize(tail, 1), r.tail.gain);
  // discrete echoes
  if (r.echoes) {
    const src = lowpass(scale(out, 1), sr, 1500, 0.7, 2);
    for (const [t, g] of r.echoes) mixInto(out, src, g, Math.round(t * sr));
  }
  return normalize(softClip(out, r.drive), 0.95);
}

// ---------------------------------------------------------------- foley / impacts / UI

export interface Layer {
  kind: 'noise' | 'sine' | 'sweep' | 'fm';
  freq?: number; f1?: number; sweepDur?: number;
  q?: number; filter?: FilterType; stages?: number;
  tau: number; attack?: number; hold?: number;
  gain: number; at?: number;
  fmRatio?: number; fmIndex?: number; glide?: number;
  hp?: number; lp?: number;
  /** one-pole low-pass sweep [f0, f1] across the layer (scrapes, whooshes) */
  lpSweep?: [number, number];
}

/** Generic multi-layer foley builder used by footsteps/impacts/clicks/UI. */
export function layered(sr: number, length: number, layers: Layer[], rng: Rng, drive = 1.0, target = 0.9): Mono {
  const n = Math.round(length * sr); const out = zeros(n);
  for (const L of layers) {
    const at = Math.round((L.at ?? 0) * sr);
    const m = Math.max(8, n - at);
    let src: Mono;
    if (L.kind === 'noise') src = noise(m, rng);
    else if (L.kind === 'sine') src = sine(m, sr, L.freq ?? 100);
    else if (L.kind === 'sweep') src = sineSweep(m, sr, L.freq ?? 200, L.f1 ?? 50, L.sweepDur ?? L.tau);
    else src = fm(m, sr, L.freq ?? 200, (L.freq ?? 200) * (L.fmRatio ?? 1), L.fmIndex ?? 2, L.glide ?? 1);
    src = mul(src, expEnv(m, sr, L.tau, L.attack ?? 0, L.hold ?? 0));
    if (L.filter && L.freq !== undefined && L.kind === 'noise') {
      src = L.filter === 'bp' ? bandpass(src, sr, L.freq, L.q ?? 1, L.stages ?? 1) : biquad(src, sr, L.filter, L.freq, L.q ?? 0.707);
      src = normalize(src, 1);
    }
    if (L.lpSweep) src = normalize(sweepLowpass(src, sr, L.lpSweep[0], L.lpSweep[1]), 1);
    if (L.lp) src = lowpass(src, sr, L.lp, 0.7);
    if (L.hp) src = highpass(src, sr, L.hp, 0.7);
    mixInto(out, src, L.gain, at);
  }
  return normalize(drive > 1 ? softClip(out, drive) : out, target);
}

// ---------------------------------------------------------------- reverb impulse response

export interface IrOptions {
  length: number;          // seconds
  rt60: number;            // seconds to -60 dB for the diffuse tail
  streetWidth: number;     // meters between facades
  preDelay: number;        // seconds before first reflection
  damping: number;         // 0..1, HF loss per reflection
}

/**
 * Stereo IR for a ~40 m street between buildings: early reflections from each facade (with a slapback
 * at 2*halfWidth/343), a few from facades further down the street, a diffuse tail with HF damping.
 */
export function impulseResponse(sr: number, o: IrOptions, rng: Rng): [Mono, Mono] {
  const n = Math.round(o.length * sr);
  const L = zeros(n), R = zeros(n);
  const c = 343;
  const half = o.streetWidth / 2;
  const slap = 2 * half / c;
  // [delay s, gain, pan(-1..1)]
  const taps: [number, number, number][] = [
    [o.preDelay, 0.55, 0.0],                 // ground / nearby props
    [o.preDelay + 0.006, 0.35, 0.4],
    [o.preDelay + 0.011, 0.3, -0.5],
    [slap, 0.5, -0.8],                       // left facade slapback
    [slap + 0.013, 0.45, 0.8],               // right facade (slightly offset)
    [slap * 1.6, 0.25, 0.5],                 // corner / setback
    [slap * 2.1, 0.22, -0.3],                // facade down the street
    [slap * 2.9, 0.16, 0.2],
    [slap * 3.7, 0.12, -0.6],
    [slap * 4.6, 0.08, 0.6],
  ];
  for (let k = 0; k < 8; k++) taps.push([0.02 + rng.next() * 0.12, 0.12 + rng.next() * 0.12, rng.next() * 2 - 1]);
  for (const [t, g, pan] of taps) {
    const at = Math.round(t * sr); if (at >= n) continue;
    // a rough facade reflects diffusely: a 4-10 ms burst of noise, low-passed by damping.
    // Early taps share one burst (coherent), later ones get independent bursts per ear (decorrelated).
    const len = Math.round((0.004 + rng.next() * 0.006) * sr);
    const mk = () => normalize(lowpass(mul(noise(len, rng), expEnv(len, sr, len / sr / 3)), sr, 9000 - 6000 * o.damping * Math.min(1, t * 4), 0.7), 1);
    const bl = mk(); const br = t > 0.03 ? mk() : bl;
    const gl = g * Math.sqrt(0.5 * (1 - pan)), gr = g * Math.sqrt(0.5 * (1 + pan));
    mixInto(L, bl, gl, at); mixInto(R, br, gr, at);
  }
  // diffuse tail: decorrelated noise, exp decay to -60 dB at rt60, progressively low-passed
  const tau = o.rt60 / 6.91;
  const start = Math.round((o.preDelay + 0.015) * sr);
  const tl = zeros(n), tr = zeros(n);
  for (let i = start; i < n; i++) {
    const t = (i - start) / sr; const env = Math.exp(-t / tau) * Math.min(1, t / 0.06);
    tl[i] = (rng.next() * 2 - 1) * env; tr[i] = (rng.next() * 2 - 1) * env;
  }
  // HF damping: sum of a bright fast-decaying copy and a dark slow one
  const bright = (x: Mono) => mul(lowpass(x, sr, 7000, 0.7), expEnv(n, sr, tau * 0.35));
  const dark = (x: Mono) => lowpass(x, sr, 1800 - 1000 * o.damping, 0.7, 2);
  const tailL = mixInto(scale(bright(tl), 0.6), dark(tl), 0.8);
  const tailR = mixInto(scale(bright(tr), 0.6), dark(tr), 0.8);
  mixInto(L, highpass(tailL, sr, 80), 0.32); mixInto(R, highpass(tailR, sr, 80), 0.32);
  const p = Math.max(peak(L), peak(R), 1e-6);
  return [scale(L, 0.9 / p), scale(R, 0.9 / p)];
}

// ---------------------------------------------------------------- wav

export function encodeWav(channels: ArrayLike<number>[], sr: number): ArrayBuffer {
  const nch = channels.length; const n = channels[0].length;
  const buf = new ArrayBuffer(44 + n * nch * 2); const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
  return buf;
}
