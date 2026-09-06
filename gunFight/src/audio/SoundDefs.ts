/**
 * Sound id -> recipe table. Every id other modules use lives here. Buffers are rendered lazily
 * (a few seeded variants per id) by AudioEngine using the pure functions in synth.ts.
 */
import type { Rng } from '../core/Rng';
import { gunshot, layered, makeLoopable, lowpass, noise, mul, expEnv, normalize, zeros, mixInto, sine, fadeEdges, type Mono, type GunRecipe, type Layer } from './synth';

export type BusName = 'sfx' | 'weapons' | 'ambience' | 'ui' | 'voice';

export interface SoundDef {
  bus: BusName;
  /** linear gain applied to the (peak-normalized) buffer */
  gain: number;
  /** max simultaneous voices for this id (oldest is stolen) */
  poly: number;
  /** 0..1 send level to the street reverb */
  reverb: number;
  /** +/- fraction of random playbackRate variation */
  pitchVar: number;
  /** distance at which the sound is at full gain; attenuation = ref/(ref+d) */
  refDistance: number;
  /** number of seeded variants to pre-render */
  variants: number;
  /** max plays allowed within a 20 ms window (dedupes double-emits / pellet bursts) */
  burst: number;
  /** looped playback (started/stopped by the engine) */
  loop?: boolean;
  /** positional plays are delayed by distance/343 m/s (gunfire, explosions) */
  propagate?: boolean;
  /** seconds; buffer length */
  length: number;
  build: (sr: number, rng: Rng) => Mono;
}

const GUNS: Record<string, GunRecipe> = {
  // 5.56 carbine: tight, snappy, ~2 kHz crack, short urban tail
  fire_ar: {
    length: 1.1, drive: 1.7,
    sub: { f0: 130, f1: 42, dur: 0.06, gain: 0.55 },
    body: { freq: 240, q: 2.2, tau: 0.045, gain: 0.35 },
    crack: { center: 2100, q: 0.9, tau: 0.016, gain: 1.5, stages: 2 },
    air: { tau: 0.006, gain: 0.7 },
    click: { freq: 3900, tau: 0.004, gain: 0.55 },
    tail: { tau: 0.2, lp: 1900, gain: 0.55 },
  },
  // 9mm SMG: faster, thinner, brighter crack, short tail
  fire_smg: {
    length: 0.75, drive: 1.5,
    sub: { f0: 115, f1: 48, dur: 0.045, gain: 0.4 },
    body: { freq: 320, q: 2.5, tau: 0.03, gain: 0.25 },
    crack: { center: 2700, q: 1.0, tau: 0.011, gain: 1.5, stages: 2 },
    air: { tau: 0.004, gain: 0.6 },
    click: { freq: 4600, tau: 0.003, gain: 0.65 },
    tail: { tau: 0.13, lp: 3000, gain: 0.4 },
  },
  // 9mm pistol: sharper crack, more click, a little more tail than the SMG
  fire_pistol: {
    length: 0.85, drive: 1.6,
    sub: { f0: 140, f1: 55, dur: 0.04, gain: 0.45 },
    body: { freq: 300, q: 2.5, tau: 0.04, gain: 0.3 },
    crack: { center: 3000, q: 0.8, tau: 0.013, gain: 1.4, stages: 2 },
    air: { tau: 0.005, gain: 0.55 },
    click: { freq: 4300, tau: 0.0035, gain: 0.6 },
    tail: { tau: 0.17, lp: 2900, gain: 0.45 },
  },
  // 12ga pump: heavy boom, low crack, long tail
  fire_shotgun: {
    length: 1.5, drive: 2.1,
    sub: { f0: 95, f1: 30, dur: 0.12, gain: 0.7 },
    body: { freq: 150, q: 1.8, tau: 0.09, gain: 0.6 },
    crack: { center: 1200, q: 0.7, tau: 0.03, gain: 1.5, stages: 2 },
    air: { tau: 0.008, gain: 0.55 },
    click: { freq: 3000, tau: 0.005, gain: 0.4 },
    tail: { tau: 0.32, lp: 1800, gain: 0.7 },
    echoes: [[0.118, 0.18], [0.24, 0.1]],
  },
  // .338 bolt rifle: huge crack + long street echo
  fire_sniper: {
    length: 2.2, drive: 1.9,
    sub: { f0: 105, f1: 34, dur: 0.09, gain: 0.6 },
    body: { freq: 180, q: 2.0, tau: 0.07, gain: 0.45 },
    crack: { center: 1800, q: 0.8, tau: 0.028, gain: 1.5, stages: 2 },
    air: { tau: 0.009, gain: 0.8 },
    click: { freq: 4500, tau: 0.004, gain: 0.55 },
    tail: { tau: 0.42, lp: 1700, gain: 0.7 },
    echoes: [[0.118, 0.32], [0.26, 0.2], [0.41, 0.12], [0.6, 0.06]],
  },
  // 7.62x39 from an enemy AK: lower, slower crack, more tail (distance filtering is applied live)
  enemy_fire_ak: {
    length: 1.3, drive: 1.8,
    sub: { f0: 115, f1: 40, dur: 0.07, gain: 0.55 },
    body: { freq: 200, q: 2.0, tau: 0.06, gain: 0.4 },
    crack: { center: 1500, q: 0.8, tau: 0.022, gain: 1.5, stages: 2 },
    air: { tau: 0.006, gain: 0.45 },
    click: { freq: 3200, tau: 0.004, gain: 0.5 },
    tail: { tau: 0.28, lp: 1500, gain: 0.65 },
    echoes: [[0.118, 0.15]],
  },
  // far-off battle thump for the ambience scheduler (heavily low-passed, long)
  distant_shot: {
    length: 1.8, drive: 1.5,
    sub: { f0: 90, f1: 35, dur: 0.1, gain: 0.8 },
    body: { freq: 160, q: 1.5, tau: 0.12, gain: 0.8 },
    crack: { center: 700, q: 0.7, tau: 0.05, gain: 0.7, stages: 2 },
    click: { freq: 2000, tau: 0.004, gain: 0.1 },
    tail: { tau: 0.5, lp: 900, gain: 1.0 },
    echoes: [[0.16, 0.3], [0.35, 0.2], [0.58, 0.1]],
  },
};

// ---- foley recipes ------------------------------------------------------------

const click = (freq: number, tau: number, gain: number, at = 0): Layer => ({ kind: 'noise', filter: 'bp', freq, q: 1.6, stages: 1, tau, gain, at });
const ring = (freq: number, tau: number, gain: number, at = 0): Layer => ({ kind: 'sine', freq, tau, gain, at });
const thud = (f0: number, f1: number, dur: number, gain: number, at = 0): Layer => ({ kind: 'sweep', freq: f0, f1, sweepDur: dur, tau: dur, gain, at });
const scrape = (lp0: number, lp1: number, tau: number, gain: number, at = 0, hp = 300): Layer => ({ kind: 'noise', tau, gain, at, lpSweep: [lp0, lp1], hp });
const hiss = (lp: number, tau: number, gain: number, at = 0): Layer => ({ kind: 'noise', tau, gain, at, lp, hp: 150 });

/** heel + toe + surface character. Third layer per surface is what tells them apart. */
function footstep(surface: string): Layer[] {
  const heel: Layer = { kind: 'noise', tau: 0.02, gain: 0.7, lp: 280, hp: 60 };
  const heelThump = thud(95, 55, 0.03, 0.55);
  const toe: Layer = { kind: 'noise', filter: 'bp', freq: 1800, q: 0.8, tau: 0.012, gain: 0.45, at: 0.085 };
  switch (surface) {
    case 'concrete': return [heel, heelThump, toe, click(3200, 0.004, 0.35, 0.002), { kind: 'noise', filter: 'bp', freq: 2600, q: 1.0, tau: 0.02, gain: 0.3, at: 0.09 }];
    case 'metal': return [heel, heelThump, toe, ring(1230, 0.06, 0.25, 0.001), ring(2710, 0.04, 0.18, 0.001), ring(1230, 0.05, 0.15, 0.086), click(4200, 0.003, 0.3)];
    case 'wood': return [heel, thud(180, 90, 0.03, 0.7), { kind: 'noise', filter: 'bp', freq: 260, q: 4, tau: 0.04, gain: 0.5 }, { ...toe, gain: 0.35 }, { kind: 'noise', filter: 'bp', freq: 700, q: 2.5, tau: 0.03, gain: 0.25, at: 0.085 }];
    case 'dirt': return [{ ...heel, lp: 500, tau: 0.03, gain: 0.9 }, hiss(1200, 0.035, 0.6), { ...toe, freq: 1100, tau: 0.02, gain: 0.25 }, hiss(900, 0.03, 0.22, 0.09)];
    case 'brick': return [heel, heelThump, toe, click(2400, 0.005, 0.3, 0.002), { kind: 'noise', filter: 'bp', freq: 1900, q: 1.2, tau: 0.02, gain: 0.25, at: 0.09 }];
    case 'plaster': return [{ ...heel, lp: 400, gain: 0.9 }, thud(120, 70, 0.03, 0.5), { ...toe, freq: 1400, gain: 0.28 }, hiss(2500, 0.015, 0.15, 0.09)];
    case 'sandbag': return [{ ...heel, lp: 350, tau: 0.035, gain: 0.9 }, hiss(800, 0.05, 0.6), { ...toe, freq: 900, tau: 0.03, gain: 0.22 }, hiss(600, 0.04, 0.22, 0.1)];
    case 'glass': return [heel, heelThump, toe, ring(5200, 0.02, 0.2), click(6000, 0.003, 0.35)];
    case 'water': return [{ ...heel, lp: 900, tau: 0.05 }, hiss(3000, 0.08, 0.6), hiss(2000, 0.1, 0.4, 0.06), { ...toe, gain: 0.2 }];
    default: return [heel, heelThump, toe];
  }
}

/** bullet impact per surface */
function impact(surface: string): Layer[] {
  const punch: Layer = { kind: 'noise', tau: 0.006, gain: 0.8, lp: 4000, hp: 200 };
  switch (surface) {
    case 'concrete': return [punch, click(2600, 0.008, 0.9), thud(220, 90, 0.03, 0.5), { kind: 'noise', filter: 'bp', freq: 4500, q: 0.8, tau: 0.03, gain: 0.35 }, hiss(3000, 0.08, 0.25, 0.02)];
    case 'brick': return [punch, click(2200, 0.009, 0.9), thud(200, 80, 0.03, 0.55), hiss(2500, 0.09, 0.3, 0.02)];
    case 'metal': return [punch, click(3400, 0.004, 0.8), ring(1870, 0.09, 0.5), ring(3310, 0.06, 0.35), ring(5120, 0.04, 0.25), ring(870, 0.12, 0.3), thud(300, 120, 0.02, 0.4)];
    case 'wood': return [punch, thud(420, 140, 0.03, 0.8), { kind: 'noise', filter: 'bp', freq: 520, q: 3, tau: 0.04, gain: 0.6 }, click(2800, 0.005, 0.5), hiss(1500, 0.05, 0.2, 0.01)];
    case 'dirt': return [{ ...punch, lp: 1500 }, thud(140, 60, 0.05, 0.9), hiss(900, 0.06, 0.6), hiss(600, 0.1, 0.3, 0.02)];
    case 'sandbag': return [{ ...punch, lp: 1200 }, thud(120, 55, 0.05, 0.9), hiss(700, 0.07, 0.6), hiss(500, 0.12, 0.35, 0.02)];
    case 'plaster': return [punch, click(1900, 0.008, 0.7), thud(260, 100, 0.03, 0.5), hiss(3500, 0.1, 0.4, 0.015), hiss(2000, 0.15, 0.2, 0.05)];
    case 'glass': return [punch, click(6500, 0.004, 0.9), ring(7400, 0.03, 0.4), ring(5600, 0.05, 0.3, 0.012), ring(8900, 0.02, 0.25, 0.03), click(5800, 0.006, 0.4, 0.04), click(7200, 0.005, 0.3, 0.07), click(6100, 0.006, 0.3, 0.11), hiss(9000, 0.15, 0.3, 0.02)];
    case 'flesh': return [{ ...punch, lp: 1800 }, thud(180, 70, 0.04, 1.0), { kind: 'noise', filter: 'bp', freq: 350, q: 1.5, tau: 0.03, gain: 0.6 }, hiss(2500, 0.03, 0.35, 0.004), hiss(1200, 0.06, 0.25, 0.02)];
    case 'water': return [{ ...punch, lp: 2500 }, thud(160, 60, 0.05, 0.6), hiss(3500, 0.12, 0.7, 0.005), hiss(2000, 0.2, 0.4, 0.05)];
    default: return [punch, click(2500, 0.008, 0.8), thud(200, 80, 0.03, 0.5)];
  }
}

/** short pitched two-tone (UI / hitmarker family) */
function twoTone(f1: number, f2: number, gap: number, tau: number, gain = 1): Layer[] {
  return [
    ring(f1, tau, gain), click(f1 * 1.2, 0.002, gain * 0.5),
    ring(f2, tau, gain * 0.8, gap), click(f2 * 1.2, 0.002, gain * 0.4, gap),
  ];
}

/** voice-ish radio burst: FM buzz through a formant band, syllabic envelope. Honest placeholder for real VO. */
function radioCallout(sr: number, rng: Rng, syllables: number[], pitch: number): Mono {
  const total = syllables.reduce((a, b) => a + b, 0) + 0.12;
  const n = Math.round(total * sr); const out = zeros(n);
  let t = 0.02;
  for (const d of syllables) {
    const m = Math.round(d * sr);
    const f0 = pitch * (0.9 + rng.next() * 0.25);
    const buzz = mul(mixInto(mixInto(sine(m, sr, f0), sine(m, sr, f0 * 2.01), 0.5), sine(m, sr, f0 * 3.02), 0.3), expEnv(m, sr, d * 0.55, 0.012));
    const breath = mul(noise(m, rng), expEnv(m, sr, d * 0.4, 0.005));
    let syl = mixInto(lowpass(buzz, sr, 2400, 0.8), lowpass(breath, sr, 3500, 0.7), 0.25);
    syl = mixInto(zeros(m), syl, 1);
    const fmt1 = normalize(lowpass(mul(syl, expEnv(m, sr, d * 0.6)), sr, 1200 + rng.next() * 900, 3), 1);
    mixInto(out, fmt1, 0.9, Math.round(t * sr));
    t += d * (1.02 + rng.next() * 0.06);
  }
  // radio band-limit + squelch click
  let r = normalize(lowpass(mul(out, expEnv(n, sr, 5)), sr, 3200, 0.9), 0.9);
  const sq = normalize(mul(noise(Math.round(0.02 * sr), rng), expEnv(Math.round(0.02 * sr), sr, 0.004)), 1);
  mixInto(r, sq, 0.35, 0);
  mixInto(r, sq, 0.3, n - sq.length - 1);
  r = fadeEdges(r, sr, 0.002, 0.01);
  return r;
}

function windLoop(sr: number, rng: Rng): Mono {
  const len = 9; const n = Math.round(len * sr);
  let x = noise(n, rng);
  x = lowpass(x, sr, 420, 0.7, 2);
  // slow gust modulation from a couple of random LFOs
  const l1 = 0.05 + rng.next() * 0.05, l2 = 0.13 + rng.next() * 0.1, p1 = rng.next() * 6, p2 = rng.next() * 6;
  for (let i = 0; i < n; i++) { const t = i / sr; x[i] *= 0.55 + 0.3 * Math.sin(2 * Math.PI * l1 * t + p1) + 0.15 * Math.sin(2 * Math.PI * l2 * t + p2); }
  // a thin high whistle band that rides on the gusts
  const w = lowpass(noise(n, rng), sr, 1800, 0.7); const w2 = mul(w, x);
  mixInto(x, w2, 0.35);
  return normalize(makeLoopable(x, sr, 0.8), 0.9);
}

function heartbeat(sr: number, rng: Rng): Mono {
  void rng;
  const n = Math.round(1.0 * sr); const out = zeros(n);
  const lub = mul(sine(n, sr, 52), expEnv(n, sr, 0.09, 0.003)); mixInto(out, lub, 1.0, 0);
  const dub = mul(sine(n, sr, 44), expEnv(n, sr, 0.07, 0.003)); mixInto(out, dub, 0.75, Math.round(0.17 * sr));
  return normalize(lowpass(out, sr, 160, 0.7), 0.9);
}

const G = (name: keyof typeof GUNS) => (sr: number, rng: Rng) => gunshot(sr, GUNS[name], rng);
const Lyr = (length: number, layers: Layer[], drive = 1, target = 0.9) => (sr: number, rng: Rng) => layered(sr, length, layers, rng, drive, target);

function def(bus: BusName, length: number, build: SoundDef['build'], o: Partial<SoundDef> = {}): SoundDef {
  return { bus, length, build, gain: 1, poly: 4, reverb: 0.2, pitchVar: 0.03, refDistance: 4, variants: 3, burst: 2, ...o };
}

export const SOUNDS: Record<string, SoundDef> = {
  // ---- player weapons (non-positional; loud, alternate slight gain/timing in the engine)
  fire_ar: def('weapons', 1.1, G('fire_ar'), { gain: 0.9, poly: 6, reverb: 0.45, burst: 1, refDistance: 14 }),
  fire_smg: def('weapons', 0.75, G('fire_smg'), { gain: 0.8, poly: 8, reverb: 0.35, burst: 1, refDistance: 12 }),
  fire_pistol: def('weapons', 0.85, G('fire_pistol'), { gain: 0.85, poly: 5, reverb: 0.4, burst: 1, refDistance: 12 }),
  fire_shotgun: def('weapons', 1.5, G('fire_shotgun'), { gain: 1.0, poly: 3, reverb: 0.55, burst: 1, refDistance: 16 }),
  fire_sniper: def('weapons', 2.2, G('fire_sniper'), { gain: 1.0, poly: 3, reverb: 0.6, burst: 1, refDistance: 18 }),
  enemy_fire_ak: def('weapons', 1.3, G('enemy_fire_ak'), { gain: 0.8, poly: 10, reverb: 0.5, burst: 6, refDistance: 14, variants: 4, propagate: true }),
  distant_shot: def('ambience', 1.8, G('distant_shot'), { gain: 0.5, poly: 6, reverb: 0.7, burst: 6, refDistance: 60, pitchVar: 0.08, propagate: true }),
  dryfire: def('weapons', 0.12, Lyr(0.12, [click(2900, 0.004, 1.0), ring(3800, 0.012, 0.3), thud(400, 200, 0.01, 0.3)]), { gain: 0.5, poly: 2, reverb: 0.1, burst: 1 }),

  // ---- weapon handling
  reload_magout: def('weapons', 0.25, Lyr(0.25, [click(2600, 0.004, 0.8), thud(320, 140, 0.03, 0.6, 0.004), scrape(2500, 900, 0.06, 0.4, 0.02), click(1800, 0.006, 0.4, 0.09)]), { gain: 0.55, poly: 2, reverb: 0.15 }),
  reload_magin: def('weapons', 0.25, Lyr(0.25, [scrape(1200, 2600, 0.05, 0.35), thud(260, 110, 0.035, 0.9, 0.05), click(3100, 0.004, 0.9, 0.05), click(2200, 0.005, 0.5, 0.075)]), { gain: 0.6, poly: 2, reverb: 0.15 }),
  reload_rack: def('weapons', 0.3, Lyr(0.3, [click(3300, 0.004, 0.8), scrape(3500, 1500, 0.07, 0.5, 0.01), click(2700, 0.004, 1.0, 0.11), thud(380, 180, 0.02, 0.6, 0.11), ring(4100, 0.02, 0.25, 0.11)]), { gain: 0.6, poly: 2, reverb: 0.2 }),
  bolt: def('weapons', 0.55, Lyr(0.55, [click(3000, 0.004, 0.8), scrape(2800, 1600, 0.08, 0.45, 0.02), click(2400, 0.005, 0.7, 0.14), scrape(1400, 3000, 0.08, 0.45, 0.28), click(3400, 0.004, 1.0, 0.40), thud(360, 170, 0.02, 0.6, 0.40), ring(4300, 0.02, 0.2, 0.40)]), { gain: 0.6, poly: 2, reverb: 0.2 }),
  bolt_close: def('weapons', 0.3, Lyr(0.3, [scrape(1400, 3000, 0.07, 0.4), click(3400, 0.004, 1.0, 0.1), thud(360, 170, 0.02, 0.6, 0.1), ring(4300, 0.02, 0.2, 0.1), click(2600, 0.004, 0.4, 0.16)]), { gain: 0.6, poly: 2, reverb: 0.2 }),
  pump_fwd: def('weapons', 0.3, Lyr(0.3, [scrape(1200, 2600, 0.07, 0.5), click(2600, 0.005, 1.0, 0.09), thud(300, 140, 0.03, 0.7, 0.09), ring(3900, 0.02, 0.2, 0.09)]), { gain: 0.65, poly: 2, reverb: 0.2 }),
  pump: def('weapons', 0.42, Lyr(0.42, [scrape(2200, 1200, 0.07, 0.5), click(2000, 0.005, 0.8, 0.07), thud(260, 120, 0.03, 0.8, 0.07), scrape(1200, 2600, 0.07, 0.5, 0.2), click(2600, 0.005, 1.0, 0.29), thud(300, 140, 0.03, 0.7, 0.29)]), { gain: 0.65, poly: 2, reverb: 0.2 }),
  shell_insert: def('weapons', 0.16, Lyr(0.16, [scrape(1800, 3000, 0.03, 0.4), click(2900, 0.004, 0.9, 0.04), thud(500, 240, 0.015, 0.5, 0.04)]), { gain: 0.5, poly: 3, reverb: 0.1 }),
  switch: def('weapons', 0.35, Lyr(0.35, [hiss(2000, 0.06, 0.5), scrape(1000, 2000, 0.05, 0.3, 0.03), click(2400, 0.005, 0.7, 0.16), thud(300, 150, 0.02, 0.5, 0.16), click(3200, 0.004, 0.5, 0.22)]), { gain: 0.5, poly: 2, reverb: 0.1, burst: 1 }),
  inspect: def('weapons', 0.7, Lyr(0.7, [hiss(1800, 0.08, 0.4), click(2600, 0.004, 0.5, 0.12), scrape(1500, 2500, 0.06, 0.3, 0.2), click(3000, 0.004, 0.6, 0.38), click(2200, 0.005, 0.4, 0.5), hiss(1500, 0.06, 0.3, 0.55)]), { gain: 0.45, poly: 1, reverb: 0.1 }),
  melee_swing: def('weapons', 0.3, Lyr(0.3, [{ kind: 'noise', tau: 0.09, attack: 0.01, gain: 0.9, lpSweep: [600, 3200], hp: 300 }, hiss(1200, 0.06, 0.3, 0.02)]), { gain: 0.5, poly: 2, reverb: 0.1, burst: 1 }),
  melee_hit: def('weapons', 0.35, Lyr(0.35, [thud(190, 60, 0.05, 1.0), { kind: 'noise', filter: 'bp', freq: 320, q: 1.5, tau: 0.04, gain: 0.7 }, { kind: 'noise', tau: 0.008, gain: 0.6, lp: 2500, hp: 200 }, hiss(1400, 0.05, 0.3, 0.01), click(2000, 0.005, 0.3)], 1.4), { gain: 0.8, poly: 2, reverb: 0.2, burst: 1 }),
  melee_wall: def('weapons', 0.35, Lyr(0.35, [{ kind: 'noise', tau: 0.007, gain: 0.9, lp: 5000, hp: 200 }, click(2300, 0.006, 0.8), thud(260, 100, 0.03, 0.7), ring(1700, 0.04, 0.2), hiss(2500, 0.06, 0.25, 0.01)], 1.3), { gain: 0.7, poly: 2, reverb: 0.3, burst: 1 }),
  melee: def('weapons', 0.45, Lyr(0.45, [{ kind: 'noise', tau: 0.09, gain: 0.7, lpSweep: [700, 2600], hp: 250 }, thud(200, 70, 0.05, 1.0, 0.11), { kind: 'noise', filter: 'bp', freq: 350, q: 1.5, tau: 0.04, gain: 0.7, at: 0.11 }, click(2200, 0.006, 0.5, 0.11)], 1.4), { gain: 0.75, poly: 2, reverb: 0.25, burst: 1 }),
  grenade_throw: def('sfx', 0.35, Lyr(0.35, [{ kind: 'noise', tau: 0.1, gain: 0.8, lpSweep: [500, 3000], hp: 300 }, hiss(1500, 0.05, 0.3), click(2000, 0.005, 0.3, 0.02)]), { gain: 0.5, poly: 2, reverb: 0.15 }),
  grenade_bounce: def('sfx', 0.3, Lyr(0.3, [click(3200, 0.004, 0.8), ring(2140, 0.07, 0.5), ring(3560, 0.05, 0.3), ring(1220, 0.09, 0.3), thud(260, 120, 0.02, 0.5)]), { gain: 0.45, poly: 3, reverb: 0.3, pitchVar: 0.08 }),
  pickup_ammo: def('sfx', 0.35, Lyr(0.35, [click(2800, 0.004, 0.7), ring(3100, 0.03, 0.3), thud(280, 140, 0.02, 0.5, 0.005), click(3400, 0.004, 0.8, 0.13), ring(4200, 0.03, 0.3, 0.13), thud(340, 160, 0.02, 0.4, 0.13)]), { gain: 0.5, poly: 2, reverb: 0.15 }),

  // ---- impacts
  hit_concrete: def('sfx', 0.3, Lyr(0.3, impact('concrete'), 1.3), { gain: 0.6, poly: 6, reverb: 0.3, burst: 4, pitchVar: 0.08 }),
  hit_metal: def('sfx', 0.45, Lyr(0.45, impact('metal'), 1.2), { gain: 0.6, poly: 6, reverb: 0.35, burst: 4, pitchVar: 0.1 }),
  hit_wood: def('sfx', 0.3, Lyr(0.3, impact('wood'), 1.3), { gain: 0.6, poly: 6, reverb: 0.25, burst: 4, pitchVar: 0.08 }),
  hit_dirt: def('sfx', 0.35, Lyr(0.35, impact('dirt')), { gain: 0.6, poly: 6, reverb: 0.2, burst: 4, pitchVar: 0.08 }),
  hit_brick: def('sfx', 0.3, Lyr(0.3, impact('brick'), 1.3), { gain: 0.6, poly: 6, reverb: 0.3, burst: 4, pitchVar: 0.08 }),
  hit_plaster: def('sfx', 0.4, Lyr(0.4, impact('plaster')), { gain: 0.55, poly: 6, reverb: 0.25, burst: 4, pitchVar: 0.08 }),
  hit_glass: def('sfx', 0.5, Lyr(0.5, impact('glass')), { gain: 0.6, poly: 6, reverb: 0.3, burst: 4, pitchVar: 0.1 }),
  hit_sandbag: def('sfx', 0.35, Lyr(0.35, impact('sandbag')), { gain: 0.6, poly: 6, reverb: 0.15, burst: 4, pitchVar: 0.08 }),
  hit_water: def('sfx', 0.5, Lyr(0.5, impact('water')), { gain: 0.5, poly: 6, reverb: 0.2, burst: 4, pitchVar: 0.08 }),
  hit_flesh: def('sfx', 0.25, Lyr(0.25, impact('flesh'), 1.2), { gain: 0.7, poly: 6, reverb: 0.15, burst: 4, pitchVar: 0.08 }),
  headshot: def('sfx', 0.3, Lyr(0.3, [...impact('flesh'), click(4200, 0.005, 0.8), ring(3900, 0.03, 0.4), ring(5200, 0.02, 0.3, 0.004)], 1.3), { gain: 0.75, poly: 3, reverb: 0.2, burst: 2 }),

  // ---- feedback (UI bus, never positional)
  hitmarker: def('ui', 0.09, Lyr(0.09, twoTone(2200, 2950, 0.032, 0.014)), { gain: 0.45, poly: 4, reverb: 0, pitchVar: 0.01, burst: 3 }),
  hitmarker_head: def('ui', 0.09, Lyr(0.09, twoTone(3300, 4400, 0.03, 0.012)), { gain: 0.5, poly: 4, reverb: 0, pitchVar: 0.01, burst: 3 }),
  kill: def('ui', 0.3, Lyr(0.3, [thud(220, 110, 0.05, 0.45), click(2400, 0.004, 0.9), ring(1560, 0.06, 0.6, 0.02), ring(1040, 0.1, 0.5, 0.07), click(3100, 0.003, 0.6, 0.07), ring(2080, 0.05, 0.3, 0.07)]), { gain: 0.5, poly: 2, reverb: 0, pitchVar: 0.01 }),
  ui_click: def('ui', 0.06, Lyr(0.06, [click(2600, 0.003, 1.0), ring(3100, 0.01, 0.3)]), { gain: 0.35, poly: 3, reverb: 0, pitchVar: 0 }),
  ui_hover: def('ui', 0.05, Lyr(0.05, [click(3600, 0.002, 0.7), ring(4200, 0.007, 0.2)]), { gain: 0.18, poly: 3, reverb: 0, pitchVar: 0 }),
  wave_start: def('ui', 1.6, Lyr(1.6, [thud(70, 38, 0.3, 1.0), { kind: 'noise', tau: 0.25, gain: 0.5, lp: 900, hp: 60 }, { kind: 'fm', freq: 110, fmRatio: 2.0, fmIndex: 1.4, tau: 0.6, attack: 0.02, gain: 0.5, glide: 1.5 }, { kind: 'fm', freq: 220, fmRatio: 1.5, fmIndex: 0.8, tau: 0.5, attack: 0.1, gain: 0.3, at: 0.4, glide: 1.33 }, click(2000, 0.01, 0.5), thud(60, 32, 0.4, 0.8, 0.5)], 1.3), { gain: 0.6, poly: 1, reverb: 0.3, pitchVar: 0 }),
  wave_incoming: def('ui', 0.9, Lyr(0.9, [{ kind: 'fm', freq: 160, fmRatio: 2, fmIndex: 1.2, tau: 0.25, attack: 0.01, gain: 0.7 }, { kind: 'fm', freq: 120, fmRatio: 2, fmIndex: 1.2, tau: 0.35, attack: 0.01, gain: 0.7, at: 0.35 }, thud(70, 40, 0.2, 0.6, 0.35)]), { gain: 0.5, poly: 1, reverb: 0.25, pitchVar: 0 }),
  wave_complete: def('ui', 1.2, Lyr(1.2, [ring(523, 0.25, 0.5), ring(659, 0.25, 0.5, 0.12), ring(784, 0.45, 0.6, 0.24), ring(1047, 0.6, 0.4, 0.36), click(2500, 0.003, 0.3), click(2500, 0.003, 0.3, 0.12), click(2500, 0.003, 0.3, 0.24), click(2500, 0.003, 0.3, 0.36)]), { gain: 0.45, poly: 1, reverb: 0.2, pitchVar: 0 }),
  game_start: def('ui', 1.4, Lyr(1.4, [thud(80, 40, 0.25, 0.9), ring(392, 0.3, 0.4), ring(523, 0.5, 0.5, 0.18), { kind: 'noise', tau: 0.2, gain: 0.4, lp: 1200, hp: 80 }, click(2200, 0.006, 0.5)], 1.2), { gain: 0.55, poly: 1, reverb: 0.3, pitchVar: 0 }),
  game_over: def('ui', 2.0, Lyr(2.0, [ring(330, 0.5, 0.5), ring(311, 0.6, 0.5, 0.35), ring(262, 0.9, 0.5, 0.7), thud(60, 30, 0.6, 0.8, 0.7), { kind: 'noise', tau: 0.6, gain: 0.3, lp: 500, hp: 50, at: 0.7 }]), { gain: 0.55, poly: 1, reverb: 0.4, pitchVar: 0 }),

  // ---- movement
  footstep_concrete: def('sfx', 0.2, Lyr(0.2, footstep('concrete')), { gain: 0.32, poly: 3, reverb: 0.2, pitchVar: 0.06, variants: 4 }),
  footstep_metal: def('sfx', 0.25, Lyr(0.25, footstep('metal')), { gain: 0.35, poly: 3, reverb: 0.25, pitchVar: 0.06, variants: 4 }),
  footstep_wood: def('sfx', 0.2, Lyr(0.2, footstep('wood')), { gain: 0.35, poly: 3, reverb: 0.15, pitchVar: 0.06, variants: 4 }),
  footstep_dirt: def('sfx', 0.2, Lyr(0.2, footstep('dirt')), { gain: 0.3, poly: 3, reverb: 0.1, pitchVar: 0.06, variants: 4 }),
  footstep_brick: def('sfx', 0.2, Lyr(0.2, footstep('brick')), { gain: 0.32, poly: 3, reverb: 0.2, pitchVar: 0.06, variants: 4 }),
  footstep_plaster: def('sfx', 0.2, Lyr(0.2, footstep('plaster')), { gain: 0.3, poly: 3, reverb: 0.15, pitchVar: 0.06, variants: 4 }),
  footstep_sandbag: def('sfx', 0.22, Lyr(0.22, footstep('sandbag')), { gain: 0.3, poly: 3, reverb: 0.05, pitchVar: 0.06, variants: 4 }),
  footstep_glass: def('sfx', 0.2, Lyr(0.2, footstep('glass')), { gain: 0.32, poly: 3, reverb: 0.2, pitchVar: 0.06, variants: 4 }),
  footstep_water: def('sfx', 0.3, Lyr(0.3, footstep('water')), { gain: 0.32, poly: 3, reverb: 0.1, pitchVar: 0.06, variants: 4 }),
  land: def('sfx', 0.35, Lyr(0.35, [thud(110, 45, 0.06, 1.0), { kind: 'noise', tau: 0.03, gain: 0.7, lp: 400, hp: 50 }, click(2400, 0.005, 0.3, 0.005), ring(3100, 0.02, 0.15, 0.03), click(2800, 0.004, 0.25, 0.06), hiss(1200, 0.05, 0.3, 0.01)], 1.3), { gain: 0.55, poly: 2, reverb: 0.25 }),
  jump: def('sfx', 0.25, Lyr(0.25, [hiss(1500, 0.05, 0.6), scrape(600, 1800, 0.06, 0.4), click(2600, 0.004, 0.3, 0.02), ring(3300, 0.015, 0.15, 0.03)]), { gain: 0.35, poly: 2, reverb: 0.1 }),
  slide: def('sfx', 1.1, Lyr(1.1, [{ kind: 'noise', tau: 0.35, attack: 0.02, hold: 0.15, gain: 0.8, lpSweep: [2200, 600], hp: 200 }, hiss(500, 0.4, 0.5, 0.0), { kind: 'noise', filter: 'bp', freq: 1400, q: 0.7, tau: 0.3, hold: 0.1, gain: 0.3 }]), { gain: 0.45, poly: 1, reverb: 0.15 }),

  // ---- player state
  player_hurt: def('voice', 0.4, Lyr(0.4, [thud(160, 60, 0.05, 0.9), { kind: 'fm', freq: 150, fmRatio: 1.0, fmIndex: 3.0, tau: 0.12, attack: 0.01, gain: 0.5, glide: 0.8, lp: 1400 }, { kind: 'noise', filter: 'bp', freq: 700, q: 1.5, tau: 0.08, gain: 0.4, attack: 0.01 }, hiss(2500, 0.05, 0.2)], 1.3), { gain: 0.6, poly: 2, reverb: 0.05, burst: 1 }),
  player_heartbeat: def('voice', 1.0, heartbeat, { gain: 0.7, poly: 1, reverb: 0, pitchVar: 0, variants: 1, loop: true }),

  // ---- enemies
  enemy_death: def('voice', 0.9, Lyr(0.9, [{ kind: 'fm', freq: 130, fmRatio: 1.0, fmIndex: 2.5, tau: 0.18, attack: 0.02, gain: 0.6, glide: 0.7, lp: 1600 }, { kind: 'noise', filter: 'bp', freq: 600, q: 1.2, tau: 0.12, gain: 0.35, attack: 0.02 }, thud(140, 50, 0.08, 1.0, 0.32), { kind: 'noise', tau: 0.05, gain: 0.6, lp: 500, hp: 50, at: 0.32 }, click(2200, 0.005, 0.3, 0.33), hiss(1200, 0.06, 0.3, 0.34), thud(120, 45, 0.06, 0.5, 0.48), hiss(900, 0.05, 0.25, 0.49)], 1.3), { gain: 0.65, poly: 3, reverb: 0.3, refDistance: 8, burst: 1 }),
  enemy_callout_contact: def('voice', 0.8, (sr, rng) => radioCallout(sr, rng, [0.13, 0.09, 0.16], 145), { gain: 0.5, poly: 2, reverb: 0.25, refDistance: 10, pitchVar: 0.05, variants: 3 }),
  enemy_callout_reload: def('voice', 0.7, (sr, rng) => radioCallout(sr, rng, [0.1, 0.1, 0.12], 135), { gain: 0.5, poly: 2, reverb: 0.25, refDistance: 10, pitchVar: 0.05, variants: 3 }),
  enemy_callout_grenade: def('voice', 0.75, (sr, rng) => radioCallout(sr, rng, [0.12, 0.08, 0.2], 165), { gain: 0.55, poly: 2, reverb: 0.25, refDistance: 10, pitchVar: 0.05, variants: 3 }),

  // ---- explosions
  explosion: def('sfx', 2.8, (sr, rng) => {
    const n = Math.round(2.8 * sr);
    let out = layered(sr, 2.8, [
      thud(70, 22, 0.45, 1.0), thud(120, 30, 0.12, 0.6),
      { kind: 'noise', tau: 0.05, gain: 1.6, lp: 6000, hp: 100 },
      { kind: 'noise', filter: 'bp', freq: 900, q: 0.6, tau: 0.09, gain: 0.9, stages: 2 },
      { kind: 'noise', tau: 0.55, attack: 0.005, hold: 0.02, gain: 0.55, lpSweep: [2500, 250], hp: 40 },
      { kind: 'noise', tau: 0.9, attack: 0.05, gain: 0.35, lp: 180, hp: 25 },
      click(2500, 0.008, 0.7),
    ], rng, 1.6, 1);
    // debris: a scatter of small clicks/clatter 0.25-1.4 s after the blast
    for (let i = 0; i < 26; i++) {
      const at = Math.round((0.25 + rng.next() * 1.15) * sr);
      const m = Math.round(0.03 * sr);
      const c = normalize(layered(sr, 0.03, [click(1500 + rng.next() * 3500, 0.003 + rng.next() * 0.004, 1)], rng), 1);
      mixInto(out, c, 0.18 * (1 - at / n) * (0.5 + rng.next()), at);
      void m;
    }
    return normalize(out, 0.95);
  }, { gain: 1.0, poly: 2, reverb: 0.7, burst: 1, refDistance: 30, pitchVar: 0.04, variants: 2, propagate: true }),

  // ---- bullet passing the player: supersonic crack then the whip of the wake
  whiz: def('sfx', 0.22, Lyr(0.22, [click(4800, 0.003, 1.0), { kind: 'noise', filter: 'bp', freq: 3600, q: 1.2, tau: 0.02, gain: 0.7 }, { kind: 'noise', tau: 0.07, attack: 0.004, gain: 0.7, lpSweep: [5000, 900], hp: 700 }, ring(3400, 0.01, 0.3)], 1.2), { gain: 0.55, poly: 4, reverb: 0.15, refDistance: 2, pitchVar: 0.12, burst: 3 }),

  // ---- ambience loops
  ambience_wind: def('ambience', 9, windLoop, { gain: 0.3, poly: 1, reverb: 0, pitchVar: 0, variants: 1, loop: true }),
  /** the scheduler in AudioEngine drives this: it plays distant_shot / distant burst voices around the listener */
  ambience_distant_battle: def('ambience', 1, (sr) => zeros(Math.round(0.05 * sr)), { gain: 1, poly: 1, reverb: 0, pitchVar: 0, variants: 1, loop: true }),
};

/** Names other modules use that map onto an existing recipe. */
export const ALIASES: Record<string, string> = {
  reload_shell: 'shell_insert',
  enemy_reload: 'reload_rack',
  hitmarker_headshot: 'hitmarker_head',
  footstep: 'footstep_concrete',
  hit_default: 'hit_concrete',
  grenade_explode: 'explosion',
  ui_select: 'ui_click',
  ui_back: 'ui_click',
};

export const SOUND_IDS = Object.keys(SOUNDS);
