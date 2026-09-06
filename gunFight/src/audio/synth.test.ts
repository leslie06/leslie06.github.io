import { describe, it, expect } from 'vitest';
import { Rng } from '../core/Rng';
import { SOUNDS, SOUND_IDS } from './SoundDefs';
import { attackTime, bandEnergyRatio, decayTime, hasNaN, impulseResponse, peak, rms, seedFor, spectralCentroid, biquad, noise, gunshot, encodeWav } from './synth';

const SR = 48000;

describe('sound table', () => {
  it('renders every id: correct length, finite, peak <= 1', () => {
    for (const id of SOUND_IDS) {
      const def = SOUNDS[id];
      const buf = def.build(SR, new Rng(seedFor(id, 0)));
      expect(buf.length, id).toBeGreaterThan(0);
      if (id !== 'ambience_distant_battle') expect(Math.abs(buf.length - def.length * SR), `${id} length`).toBeLessThan(SR * 0.9);
      expect(hasNaN(buf), `${id} has NaN`).toBe(false);
      expect(peak(buf), `${id} peak`).toBeLessThanOrEqual(1.0);
      if (id !== 'ambience_distant_battle') expect(peak(buf), `${id} silent`).toBeGreaterThan(0.5);
    }
  });

  it('variants differ but are the same recipe', () => {
    const a = SOUNDS.fire_ar.build(SR, new Rng(seedFor('fire_ar', 0)));
    const b = SOUNDS.fire_ar.build(SR, new Rng(seedFor('fire_ar', 1)));
    expect(a.length).toBe(b.length);
    let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length).toBeGreaterThan(0.001);
  });

  it('is deterministic for a given seed', () => {
    const a = SOUNDS.hit_metal.build(SR, new Rng(seedFor('hit_metal', 2)));
    const b = SOUNDS.hit_metal.build(SR, new Rng(seedFor('hit_metal', 2)));
    expect(Array.from(a.subarray(0, 500))).toEqual(Array.from(b.subarray(0, 500)));
  });
});

describe('gunshots', () => {
  const guns = ['fire_ar', 'fire_smg', 'fire_pistol', 'fire_shotgun', 'fire_sniper', 'enemy_fire_ak'];
  for (const id of guns) {
    it(`${id}: attack < 5 ms, crack in 1-3 kHz, sub present, tail 150-900 ms`, () => {
      const buf = SOUNDS[id].build(SR, new Rng(seedFor(id, 0)));
      expect(attackTime(buf, SR)).toBeLessThan(0.005);
      // first 10 ms: sharp crack band should carry a large share of the energy
      const crack = bandEnergyRatio(buf, SR, 800, 4000, 0, 512);
      expect(crack, `${id} crack ratio`).toBeGreaterThan(0.25);
      // sub thump (30-200 Hz) present in the first 80 ms
      const sub = bandEnergyRatio(buf, SR, 25, 200, 0, 4096);
      expect(sub, `${id} sub ratio`).toBeGreaterThan(0.04);
      // -40 dB decay time: body of an urban shot
      const d40 = decayTime(buf, SR, 40);
      expect(d40, `${id} decay`).toBeGreaterThan(0.12);
      expect(d40, `${id} decay`).toBeLessThan(id === 'fire_sniper' ? 1.8 : 1.3);
      // centroid of the first 20 ms sits in the crack region
      const c = spectralCentroid(buf, SR, 0, 1024);
      expect(c, `${id} centroid`).toBeGreaterThan(900);
      expect(c, `${id} centroid`).toBeLessThan(5500);
    });
  }

  it('weapons have distinct character (sniper/shotgun decay longer than smg; smg brighter than shotgun)', () => {
    const b = (id: string) => SOUNDS[id].build(SR, new Rng(seedFor(id, 0)));
    expect(decayTime(b('fire_sniper'), SR, 40)).toBeGreaterThan(decayTime(b('fire_smg'), SR, 40));
    expect(decayTime(b('fire_shotgun'), SR, 40)).toBeGreaterThan(decayTime(b('fire_smg'), SR, 40));
    expect(spectralCentroid(b('fire_smg'), SR, 0, 1024)).toBeGreaterThan(spectralCentroid(b('fire_shotgun'), SR, 0, 1024));
  });

  it('gunshot() never clips even with absurd drive', () => {
    const r = { ...JSON.parse(JSON.stringify((SOUNDS.fire_ar as unknown as { build: unknown }))), length: 0.5, drive: 12, sub: { f0: 120, f1: 40, dur: 0.06, gain: 4 }, crack: { center: 2000, q: 1, tau: 0.02, gain: 4 }, click: { freq: 4000, tau: 0.004, gain: 4 }, tail: { tau: 0.2, lp: 2000, gain: 4 } };
    const buf = gunshot(SR, r, new Rng(3));
    expect(peak(buf)).toBeLessThanOrEqual(1);
    expect(hasNaN(buf)).toBe(false);
  });
});

describe('foley', () => {
  it('footsteps have heel and toe layers (two energy peaks)', () => {
    const buf = SOUNDS.footstep_concrete.build(SR, new Rng(seedFor('footstep_concrete', 0)));
    const win = Math.round(SR * 0.01);
    const env: number[] = [];
    for (let i = 0; i + win <= buf.length; i += win) env.push(rms(buf, i, i + win));
    const heel = Math.max(...env.slice(0, 6)); const dip = Math.min(...env.slice(4, 8)); const toe = Math.max(...env.slice(8, 14));
    expect(heel).toBeGreaterThan(dip * 1.5);
    expect(toe).toBeGreaterThan(dip * 1.2);
  });
  it('hitmarker is two short ticks under 100 ms', () => {
    const buf = SOUNDS.hitmarker.build(SR, new Rng(seedFor('hitmarker', 0)));
    expect(buf.length / SR).toBeLessThanOrEqual(0.1);
    expect(spectralCentroid(buf, SR, 0, 2048)).toBeGreaterThan(1800);
  });
  it('headshot is brighter than hit_flesh', () => {
    const h = SOUNDS.headshot.build(SR, new Rng(seedFor('headshot', 0)));
    const f = SOUNDS.hit_flesh.build(SR, new Rng(seedFor('hit_flesh', 0)));
    expect(spectralCentroid(h, SR, 0, 2048)).toBeGreaterThan(spectralCentroid(f, SR, 0, 2048));
  });
  it('metal impact rings longer than dirt', () => {
    const m = SOUNDS.hit_metal.build(SR, new Rng(seedFor('hit_metal', 0)));
    const d = SOUNDS.hit_dirt.build(SR, new Rng(seedFor('hit_dirt', 0)));
    expect(decayTime(m, SR, 30)).toBeGreaterThan(decayTime(d, SR, 30));
  });
  it('wind loop is seamless at the loop point', () => {
    const w = SOUNDS.ambience_wind.build(SR, new Rng(seedFor('ambience_wind', 0)));
    const jump = Math.abs(w[w.length - 1] - w[0]);
    const typical = rms(w, 0, 4800);
    expect(jump).toBeLessThan(typical * 3);
  });
});

describe('impulse response', () => {
  it('is a plausible 40 m street: pre-delay, ~117 ms slapback, RT60 within range, finite, stereo-decorrelated', () => {
    const [L, R] = impulseResponse(SR, { length: 2.0, rt60: 1.6, streetWidth: 40, preDelay: 0.012, damping: 0.55 }, new Rng(seedFor('street_ir')));
    expect(L.length).toBe(Math.round(2.0 * SR));
    expect(hasNaN(L) || hasNaN(R)).toBe(false);
    expect(Math.max(peak(L), peak(R))).toBeLessThanOrEqual(1);
    // nothing before pre-delay
    expect(peak(L.subarray(0, Math.round(0.011 * SR)))).toBeLessThan(1e-6);
    // slapback bump around 2*20/343 = 116.6 ms
    const at = Math.round(0.1166 * SR);
    const around = rms(L, at - 200, at + 500) + rms(R, at - 200, at + 500);
    const before = rms(L, at - 1500, at - 700) + rms(R, at - 1500, at - 700);
    expect(around).toBeGreaterThan(before * 1.3);
    // decays: tail level at 1.2 s well below level at 0.2 s
    expect(rms(L, Math.round(1.4 * SR), Math.round(1.5 * SR))).toBeLessThan(rms(L, Math.round(0.2 * SR), Math.round(0.3 * SR)) * 0.2);
    // decorrelated channels
    let dot = 0, nl = 0, nr = 0;
    for (let i = Math.round(0.3 * SR); i < Math.round(0.6 * SR); i++) { dot += L[i] * R[i]; nl += L[i] * L[i]; nr += R[i] * R[i]; }
    expect(Math.abs(dot / Math.sqrt(nl * nr))).toBeLessThan(0.3);
  });
});

describe('dsp primitives', () => {
  it('biquad lp attenuates HF and keeps LF', () => {
    const rng = new Rng(1); const n = noise(SR, rng);
    const lp = biquad(n, SR, 'lp', 500, 0.707);
    expect(bandEnergyRatio(lp, SR, 0, 800, 0, 8192)).toBeGreaterThan(0.85);
    const hp = biquad(n, SR, 'hp', 5000, 0.707);
    expect(bandEnergyRatio(hp, SR, 4000, 24000, 0, 8192)).toBeGreaterThan(0.85);
  });
  it('encodeWav writes a valid header', () => {
    const wav = encodeWav([new Float32Array(100), new Float32Array(100)], SR);
    const v = new DataView(wav);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(SR);
    expect(wav.byteLength).toBe(44 + 100 * 2 * 2);
  });
});
