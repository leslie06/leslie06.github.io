/**
 * Music in the street (life/'s scenes), synthesised like the radio: no files. Each source is a little
 * sequencer scheduling a fifth of a second ahead, through its own gain (distance) and panner (direction):
 *   dance   广场舞 off a trolley speaker: four-on-the-floor at DANCE_BPM, claps, an octave bass on the
 *           off-beats, a square-wave pentatonic hook over I-V-vi-IV (in time with the dancers: `t`);
 *   taichi  slow plucked pentatonic notes, sparse, a guzheng's colour;
 *   guitar  a busker strumming C-G-Am-F;
 *   erhu    a slow sliding melody, bowed: a sawtooth through a nasal band-pass, vibrato;
 *   birds   a thrush in a cage: bursts of chirps;
 *   ballad  南锣鼓巷's bar singer (district/, 2026-11-03): fingerpicked chords and a sung line, one of three songs
 *           (`song`), each its own progression and tune; a song is 16 bars, then it starts over.
 */
export type MusicKind = 'dance' | 'taichi' | 'guitar' | 'erhu' | 'birds' | 'ballad';
export interface MusicSource { id: string; kind: MusicKind; x: number; z: number; t: number; song?: number }

const BPM: Record<MusicKind, number> = { dance: 128, taichi: 72, guitar: 92, erhu: 66, birds: 120, ballad: 80 };
const REACH: Record<MusicKind, number> = { dance: 75, taichi: 40, guitar: 55, erhu: 55, birds: 30, ballad: 28 };
const LEVEL: Record<MusicKind, number> = { dance: 0.16, taichi: 0.07, guitar: 0.1, erhu: 0.09, birds: 0.05, ballad: 0.12 };
/** The bar's songs: four chords (MIDI roots, minor where flagged), the key's scale for the tune, the tune's seed. */
const SONGS: { roots: number[]; minor: boolean[]; seed: number }[] = [
  { roots: [48, 43, 45, 41], minor: [false, false, true, false], seed: 3.1 },    // C G Am F
  { roots: [45, 41, 48, 43], minor: [true, false, false, false], seed: 7.7 },    // Am F C G
  { roots: [41, 43, 40, 45], minor: [false, false, true, true], seed: 5.3 },     // F G Em Am
];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const PENTA = [0, 2, 4, 7, 9];

interface Voice { src: MusicSource; gain: GainNode; pan: StereoPannerNode; next: number; step: number; seen: number; rng: number }

export class StreetMusic {
  private voices = new Map<string, Voice>();
  private frame = 0;
  constructor(private ctx: AudioContext, private out: AudioNode, private noise: AudioBuffer) {}

  private rand(v: Voice): number { v.rng = (v.rng * 16807) % 2147483647; return (v.rng - 1) / 2147483646; }

  /** Each frame: the sources in earshot, where the listener is and which way it faces (x, z). */
  update(sources: readonly MusicSource[], lx: number, lz: number, fx: number, fz: number, paused: boolean): void {
    const c = this.ctx, now = c.currentTime;
    this.frame++;
    for (const s of sources) {
      const d = Math.hypot(s.x - lx, s.z - lz);
      if (d > REACH[s.kind] * 1.2) continue;
      let v = this.voices.get(s.id);
      if (!v) {
        const gain = c.createGain(); gain.gain.value = 0;
        const pan = c.createStereoPanner();
        gain.connect(pan).connect(this.out);
        const step = 60 / BPM[s.kind] / 4, k = Math.ceil(s.t / step);
        v = { src: s, gain, pan, next: now + 0.05 + (k * step - s.t), step: k, seen: 0, rng: 1 + Math.floor(Math.abs(Math.sin(s.x * 12.9 + s.z * 78.2)) * 1e6) };
        this.voices.set(s.id, v);
      }
      v.src = s; v.seen = this.frame;
      const vol = paused ? 0 : LEVEL[s.kind] * Math.pow(Math.max(0, 1 - d / REACH[s.kind]), 1.4);
      v.gain.gain.setTargetAtTime(vol, now, 0.15);
      v.pan.pan.setTargetAtTime(d > 1 ? Math.max(-1, Math.min(1, ((s.x - lx) * -fz + (s.z - lz) * fx) / d)) * 0.7 : 0, now, 0.1);
      if (vol <= 0.0005) { v.next = Math.max(v.next, now); continue; }
      const dur = 60 / BPM[s.kind] / 4;
      while (v.next < now + 0.22) { this.play(v, v.step, v.next, dur); v.step++; v.next += dur; }
    }
    // Sources gone: fade out and let go.
    for (const [id, v] of this.voices) {
      if (v.seen === this.frame) continue;
      v.gain.gain.setTargetAtTime(0, now, 0.2);
      if (this.frame - v.seen > 120) { v.pan.disconnect(); this.voices.delete(id); }
    }
  }

  private play(v: Voice, step: number, t: number, dur: number): void {
    switch (v.src.kind) {
      case 'dance': return this.dance(v, step, t, dur);
      case 'taichi': if (step % 2 === 0 && this.rand(v) < 0.55) this.pluck(v.gain, midi(62 + PENTA[Math.floor(this.rand(v) * 5)] + (this.rand(v) < 0.3 ? 12 : 0)), t, 1.6, 'triangle', 0.5); return;
      case 'guitar': return this.guitar(v, step, t);
      case 'erhu': return this.erhu(v, step, t, dur);
      case 'birds': if (this.rand(v) < 0.09) this.chirps(v, t); return;
      case 'ballad': return this.ballad(v, step, t, dur);
    }
  }

  private dance(v: Voice, step: number, t: number, dur: number): void {
    const s16 = step % 16, bar = Math.floor(step / 16) % 4, root = [57, 52, 54, 50][bar];   // A E F#m D
    if (s16 % 4 === 0) this.kick(v.gain, t);
    if (s16 === 4 || s16 === 12) this.noiseHit(v.gain, t, 1800, 0.35, 0.12);
    if (s16 % 4 === 2) this.noiseHit(v.gain, t, 8000, 0.12, 0.04);
    if (s16 % 2 === 1 || s16 % 4 === 2) this.tone(v.gain, midi(root - 12 + (s16 % 4 === 2 ? 12 : 0)), t, dur * 0.9, 'sawtooth', 0.22, 600);
    // the hook: a seeded two-bar phrase over the progression
    const ph = step % 32;
    const h = Math.sin((ph + 3) * 91.7 + Math.floor(step / 128) * 3.1) * 43758.5;
    const note = Math.floor((h - Math.floor(h)) * 10);
    if (ph % 2 === 0 && note < 8) {
      const deg = PENTA[note % 5] + (note > 5 ? 12 : 0);
      this.tone(v.gain, midi(69 + deg), t, dur * (note % 3 === 0 ? 3.6 : 1.7), 'square', 0.12, 2800);
    }
  }

  private guitar(v: Voice, step: number, t: number): void {
    const s16 = step % 16, chord = [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65]][Math.floor(step / 16) % 4];
    if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 12) {
      const down = s16 !== 6;
      chord.forEach((n, i) => this.pluck(v.gain, midi(n), t + (down ? i : chord.length - i) * 0.012, 0.9, 'sawtooth', 0.28, 1800));
    }
  }

  private ballad(v: Voice, step: number, t: number, dur: number): void {
    const song = SONGS[(v.src.song ?? 0) % SONGS.length];
    const s16 = step % 16, bar = Math.floor(step / 16), ci = bar % 4, root = song.roots[ci];
    const third = song.minor[ci] ? 3 : 4;
    const chord = [root, root + 7, root + 12, root + 12 + third, root + 19];
    // fingerpicking: the bass on 1 and 3, the strings in between
    const pick = [0, -1, 2, 3, 1, -1, 3, 4, 0, -1, 2, 3, 1, 3, 4, 2][s16];
    if (pick >= 0) this.pluck(v.gain, midi(chord[pick] + (pick === 0 && s16 === 8 ? 7 : 0)), t, 1.4, 'triangle', pick === 0 ? 0.32 : 0.2, 2400);
    // the sung line: a seeded phrase over two bars, a note on most eighths, held over the bar's end; the last two
    // bars of each four rest (a breath), the tune lands on the chord's root
    const phrase = Math.floor(bar / 2) % 8;
    if (s16 % 2 !== 0 || bar % 4 === 3) return;
    const h = Math.sin((s16 + 1) * 12.9 + phrase * 78.2 + song.seed * 37.7) * 43758.5, r = h - Math.floor(h);
    if (r < 0.28) return;
    const deg = Math.floor(r * 9) % 7;
    const scaleRoot = song.roots[0] + 24;
    const near = (n: number) => { // the chord tone nearest the scale note on strong beats
      if (s16 % 8 !== 0) return n;
      const tones = chord.map((c) => c + 24);
      return tones.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    };
    const note = near(scaleRoot + (song.minor[0] ? [0, 2, 3, 5, 7, 8, 10] : MAJOR)[deg]);
    const len = dur * (s16 === 12 ? 6 : r > 0.8 ? 4 : 2);
    this.voice(v.gain, midi(note), t, len);
  }

  /** A sung note: a soft triangle with vibrato after the onset, through two vowel formants. */
  private voice(out: AudioNode, f: number, t: number, d: number): void {
    const c = this.ctx, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), g = c.createGain(), mix = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f * 0.985, t); o.frequency.setTargetAtTime(f, t, 0.04);
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.35, d * 0.6)); lfo.connect(lg).connect(o.frequency);
    f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 2.2;
    f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 3;
    mix.gain.value = 1;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.06); g.gain.setValueAtTime(0.5, t + d * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f1).connect(mix); o.connect(f2).connect(mix); mix.connect(g).connect(out);
    o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
  }

  private erhu(v: Voice, step: number, t: number, dur: number): void {
    if (step % 8 !== 0 || this.rand(v) < 0.15) return;
    const len = dur * (this.rand(v) < 0.5 ? 8 : 16);
    const base = midi(64 + PENTA[Math.floor(this.rand(v) * 5)] + (this.rand(v) < 0.3 ? 12 : 0));
    const c = this.ctx, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), bp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(base * 0.96, t); o.frequency.setTargetAtTime(base, t, 0.06);
    lfo.frequency.value = 5.5; lg.gain.value = base * 0.006; lfo.connect(lg).connect(o.frequency);
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.6;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.12); g.gain.setValueAtTime(0.5, t + len * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(bp).connect(g).connect(v.gain);
    o.start(t); lfo.start(t); o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
  }

  private chirps(v: Voice, t: number): void {
    const c = this.ctx, n = 3 + Math.floor(this.rand(v) * 4), f0 = 2600 + this.rand(v) * 1800;
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.09, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(f0, s); o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + 0.3 * this.rand(v)), s + 0.04); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, s + 0.07);
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.5, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.075);
      o.connect(g).connect(v.gain); o.start(s); o.stop(s + 0.09);
    }
  }

  private tone(out: AudioNode, f: number, t: number, d: number, type: OscillatorType, a: number, lp: number): void {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f1 = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; f1.type = 'lowpass'; f1.frequency.value = lp;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.01); g.gain.setValueAtTime(a, t + d * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f1).connect(g).connect(out); o.start(t); o.stop(t + d + 0.02);
  }

  private pluck(out: AudioNode, f: number, t: number, d: number, type: OscillatorType, a: number, lp = 3000): void {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f1 = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; f1.type = 'lowpass'; f1.frequency.setValueAtTime(lp, t); f1.frequency.exponentialRampToValueAtTime(lp * 0.3, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f1).connect(g).connect(out); o.start(t); o.stop(t + d + 0.02);
  }

  private kick(out: AudioNode, t: number): void {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
  }

  private noiseHit(out: AudioNode, t: number, f: number, a: number, d: number): void {
    const c = this.ctx, n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise; bp.type = f > 5000 ? 'highpass' : 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.9;
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    n.connect(bp).connect(g).connect(out); n.start(t, Math.random() * 1.5, d + 0.02);
  }
}
