import type { VoiceSpec } from '../character/Voice';

/** Vowels as two formants (Hz): a, e, i, o, u, and the Mandarin ü / er colours between them. */
const VOWELS: [number, number][] = [[800, 1200], [520, 1850], [300, 2300], [520, 900], [330, 780], [300, 1900], [560, 1450]];
const PAUSE = /[，,、；;：:]/, STOP = /[。.！!？?…]/;

/**
 * A voice without recordings: one buzzy syllable per Chinese character (one per vowel group in
 * English) through two formant filters, each syllable's pitch moving the way one of Mandarin's four
 * tones does (high level, rising, dipping, falling - picked from the character, so a line always
 * sounds the same), a consonant tick before some, pauses at commas and stops, the last syllable of a
 * question rising and of an exclamation louder. Starts at `t0`; returns when it ends (s).
 */
export function babble(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, text: string, v: VoiceSpec, gain: number, t0: number): number {
  const syl: { code: number; pause: number; ask: boolean; shout: boolean }[] = [];
  const latin = !/[㐀-鿿]/.test(text);
  let run = 0;
  for (let i = 0; i < text.length && syl.length < 32; i++) {
    const ch = text[i], code = ch.charCodeAt(0);
    if (PAUSE.test(ch) || STOP.test(ch)) {
      if (syl.length) { const last = syl[syl.length - 1]; last.pause = Math.max(last.pause, STOP.test(ch) ? 0.26 : 0.14); if (ch === '？' || ch === '?') last.ask = true; if (ch === '！' || ch === '!') last.shout = true; }
      continue;
    }
    if (latin) {
      // a syllable per run of vowels; spaces are short gaps
      if (/[aeiouy]/i.test(ch)) { if (run === 0) syl.push({ code: code * 7 + i, pause: 0, ask: false, shout: false }); run++; } else { run = 0; if (ch === ' ' && syl.length) syl[syl.length - 1].pause = Math.max(syl[syl.length - 1].pause, 0.03); }
    } else if (code >= 0x3400) syl.push({ code, pause: 0, ask: false, shout: false });
  }
  const dur = 0.125 / v.rate;
  let t = t0;
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i], tone = s.code % 4, d = dur * (0.85 + ((s.code >> 3) % 5) * 0.07) * (s.ask || s.shout ? 1.35 : 1);
    const f0 = v.pitch * (s.shout ? 1.18 : 1);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = o.frequency;
    if (s.ask) { f.setValueAtTime(f0 * 0.95, t); f.linearRampToValueAtTime(f0 * 1.45, t + d); }
    else if (tone === 0) { f.setValueAtTime(f0 * 1.15, t); }
    else if (tone === 1) { f.setValueAtTime(f0 * 0.92, t); f.linearRampToValueAtTime(f0 * 1.22, t + d); }
    else if (tone === 2) { f.setValueAtTime(f0 * 0.95, t); f.linearRampToValueAtTime(f0 * 0.78, t + d * 0.55); f.linearRampToValueAtTime(f0 * 0.92, t + d); }
    else { f.setValueAtTime(f0 * 1.28, t); f.linearRampToValueAtTime(f0 * 0.84, t + d); }
    const [a, b] = VOWELS[(s.code >> 2) % VOWELS.length];
    const env = ctx.createGain(), peak = gain * (s.shout ? 1.4 : 1);
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(peak, t + 0.018);
    env.gain.setValueAtTime(peak, t + d * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    for (const [fr, q, k] of [[a * v.bright, 5, 1], [b * v.bright, 9, 0.55]] as const) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = k;
      o.connect(bp).connect(g).connect(env);
    }
    env.connect(out);
    o.start(t); o.stop(t + d + 0.02);
    // a consonant: a little burst of hiss at the start of some syllables
    if ((s.code >> 5) % 3 !== 0) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2600 + ((s.code >> 1) % 7) * 450; hp.Q.value = 1.4;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(gain * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      n.connect(hp).connect(ng).connect(out); n.start(t, Math.random() * 1.5, 0.05);
    }
    t += d * 0.92 + s.pause;
  }
  return t;
}
