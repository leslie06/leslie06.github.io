import { t } from '../core/I18n';

/**
 * The car radio: hip-hop while you drive, GTA style, and N to switch station or turn it off.
 *
 * There are no songs on disk and no network: the beats station is composed on the fly with Web
 * Audio - drums, an 808 bass, pad chords and a pentatonic hook, each track a seed, a tempo and a
 * key, arranged intro / verse / hook / verse / hook / outro and then the next one. Real rap is
 * licensed music the game cannot ship, so the second station is the player's own: drop mp3s into
 * public/music/ and list them in public/music/playlist.json ([{ "title": "...", "file": "x.mp3" }])
 * and 「我的歌单」 appears in the cycle. Both play only while the player is in a car and the game is
 * not paused, which is where a radio lives. The station survives a reload (localStorage).
 */
export interface Song { title: string; bpm: number; root: number; seed: number; trap: boolean }

const SONGS: Song[] = [
  { title: '二环夜行', bpm: 92, root: 45, seed: 11, trap: false },
  { title: '国贸飘移', bpm: 142, root: 41, seed: 23, trap: true },
  { title: '长安街午夜', bpm: 88, root: 43, seed: 37, trap: false },
  { title: '三里屯回声', bpm: 96, root: 46, seed: 51, trap: false },
  { title: '通缉五星', bpm: 150, root: 40, seed: 67, trap: true },
  { title: '出租车蓝调', bpm: 84, root: 47, seed: 83, trap: false },
  { title: '欢乐谷冲顶', bpm: 134, root: 42, seed: 97, trap: true },
  { title: '天坛清晨', bpm: 90, root: 44, seed: 113, trap: false },
];

/** Bars per section: intro, verse, hook, verse, hook, outro. */
const FORM = [4, 8, 8, 8, 8, 4];
const BARS = FORM.reduce((a, b) => a + b, 0);
const STEPS = 16;
/** Chord roots over a four-bar turnaround, semitones above the key: i, VI, III, VII. */
const PROG = [0, 8, 3, 10];
const PENTA = [0, 3, 5, 7, 10, 12, 15];
const STORE = 'drivecity.radio';
const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

/** One track's patterns, all decided by its seed so a title always sounds the same. */
interface Arrangement {
  kick: boolean[]; snare: boolean[]; hat: number[]; open: boolean[];
  /** Hook notes per step over two bars: semitone above the chord root, or -1 for a rest. */
  hook: number[];
  /** 808 hits per step over two bars. */
  bass: boolean[];
}
export function arrange(song: Song): Arrangement {
  const r = rng(song.seed), n = STEPS * 2;
  const kick = new Array<boolean>(n).fill(false), snare = new Array<boolean>(n).fill(false), open = new Array<boolean>(n).fill(false);
  const hat = new Array<number>(n).fill(0), hook = new Array<number>(n).fill(-1), bass = new Array<boolean>(n).fill(false);
  for (let bar = 0; bar < 2; bar++) {
    const o = bar * STEPS;
    kick[o] = true;
    if (song.trap) {
      // Half time: the snare on beat three, kicks skipping around it.
      snare[o + 8] = true;
      for (const s of [3, 6, 7, 10, 11, 13]) if (r() < 0.45) kick[o + s] = true;
      for (let s = 0; s < STEPS; s++) hat[o + s] = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.7 : 0.45;
      open[o + 14] = r() < 0.6;
    } else {
      snare[o + 4] = snare[o + 12] = true;
      kick[o + 10] = true;
      for (const s of [3, 7, 8, 11, 14]) if (r() < 0.35) kick[o + s] = true;
      for (let s = 0; s < STEPS; s += 2) hat[o + s] = s % 4 === 0 ? 0.9 : 0.55;
      if (r() < 0.5) hat[o + 7] = 0.4;
      open[o + 14] = r() < 0.5;
    }
    for (let s = 0; s < STEPS; s++) if (kick[o + s] && (s === 0 || r() < 0.5)) bass[o + s] = true;
  }
  // The hook: a motif over bar one, answered with a variation in bar two.
  let last = 2;
  for (let s = 0; s < STEPS; s++) {
    if (r() < (s % 4 === 0 ? 0.85 : 0.4)) {
      last = Math.max(0, Math.min(PENTA.length - 1, last + Math.round((r() - 0.5) * 3)));
      hook[s] = PENTA[last];
    }
  }
  for (let s = 0; s < STEPS; s++) hook[STEPS + s] = s < 12 ? hook[s] : (r() < 0.6 ? PENTA[Math.floor(r() * PENTA.length)] : -1);
  return { kick, snare, hat, open, hook, bass };
}

export type Station = 'beats' | 'custom';

export class Radio {
  /** Stations in cycle order; `custom` joins once the playlist has loaded. */
  stations: Station[] = ['beats'];
  private idx = 0;
  private on = true;
  private audible = false;
  private readonly bus: GainNode;
  private readonly beatsBus: GainNode;
  private readonly customBus: GainNode;
  private readonly delay: DelayNode;
  // The sequencer.
  private song = 0;
  private arr: Arrangement;
  private step = 0;
  private nextT = 0;
  private lastLabel = '';
  // The player's own music.
  private playlist: { title: string; file: string }[] = [];
  private el: HTMLAudioElement | null = null;
  private track = 0;
  /** Called with the new "now playing" label whenever it changes (a station switch or a new track). */
  onTrack: ((label: string) => void) | null = null;

  constructor(private ctx: AudioContext, master: GainNode, private noiseBuf: AudioBuffer) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.bus = ctx.createGain(); this.bus.gain.value = 0;
    this.bus.connect(comp).connect(master);
    this.beatsBus = ctx.createGain(); this.beatsBus.gain.value = 0.7; this.beatsBus.connect(this.bus);
    this.customBus = ctx.createGain(); this.customBus.gain.value = 0.9; this.customBus.connect(this.bus);
    this.delay = ctx.createDelay(1.0);
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay); fb.connect(this.beatsBus);
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORE); } catch { /* ignore */ }
    this.on = saved !== 'off';
    this.song = Math.floor(Math.random() * SONGS.length);
    this.arr = arrange(SONGS[this.song]);
    void this.loadPlaylist(saved);
  }

  private async loadPlaylist(saved: string | null): Promise<void> {
    try {
      const r = await fetch(`${BASE}music/playlist.json`);
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      const list = (await r.json()) as { title?: string; file: string }[];
      if (!Array.isArray(list) || !list.length) return;
      this.playlist = list.map((x) => ({ title: x.title ?? x.file.replace(/\.[a-z0-9]+$/i, ''), file: x.file }));
      this.stations.push('custom');
      if (saved === 'custom') this.idx = this.stations.indexOf('custom');
    } catch { /* no playlist: the beats station alone */ }
  }

  get station(): Station | null { return this.on ? this.stations[this.idx] : null; }

  /** What the HUD shows: station and track, or '' when off. */
  label(): string {
    const st = this.station;
    if (!st) return '';
    const title = st === 'beats' ? SONGS[this.song].title : (this.playlist[this.track]?.title ?? '');
    return t('hud.radio', { station: t(`radio.${st}` as 'radio.beats'), track: title });
  }

  /** N: the next station, and after the last one, off. */
  next(): void {
    if (!this.on) { this.on = true; this.idx = 0; }
    else if (this.idx + 1 < this.stations.length) this.idx++;
    else this.on = false;
    try { localStorage.setItem(STORE, this.on ? this.stations[this.idx] : 'off'); } catch { /* ignore */ }
    this.lastLabel = '';
    if (this.station !== 'custom') this.el?.pause();
    this.announce();
  }

  private announce(): void {
    const l = this.label();
    if (l !== this.lastLabel) { this.lastLabel = l; this.onTrack?.(l || t('hud.radioOff')); }
  }

  /** Once per frame. `driving`: the player is in a car; the radio is silent otherwise, and while paused. */
  update(driving: boolean, paused: boolean): void {
    const c = this.ctx, now = c.currentTime;
    const want = this.on && driving && !paused;
    if (want !== this.audible) {
      this.audible = want;
      this.bus.gain.setTargetAtTime(want ? 0.45 : 0, now, want ? 0.3 : 0.12);
    }
    const st = this.station;
    if (st === 'custom') this.custom(want);
    if (!want || st !== 'beats') { this.nextT = 0; return; }
    // The sequencer, a quarter second ahead of the clock.
    const song = SONGS[this.song], stepDur = 60 / song.bpm / 4;
    if (this.nextT < now - 0.5) { this.nextT = now + 0.05; }
    while (this.nextT < now + 0.25) {
      this.play(song, this.step, this.nextT, stepDur);
      this.nextT += stepDur;
      if (++this.step >= BARS * STEPS) { this.step = 0; this.song = (this.song + 1) % SONGS.length; this.arr = arrange(SONGS[this.song]); this.lastLabel = ''; }
    }
    this.announce();
  }

  private custom(want: boolean): void {
    if (!this.playlist.length) return;
    if (!this.el) {
      const el = new Audio(); el.preload = 'auto';
      el.addEventListener('ended', () => { this.track = (this.track + 1) % this.playlist.length; this.load(); if (this.audible) void el.play().catch(() => {}); });
      this.ctx.createMediaElementSource(el).connect(this.customBus);
      this.el = el;
      this.load();
    }
    if (want && this.el.paused) void this.el.play().catch(() => {});
    else if (!want && !this.el.paused) this.el.pause();
    this.announce();
  }

  private load(): void {
    if (!this.el) return;
    this.el.src = `${BASE}music/${this.playlist[this.track].file}`;
    this.lastLabel = '';
  }

  private section(step: number): number {
    const bar = Math.floor(step / STEPS);
    let acc = 0;
    for (let i = 0; i < FORM.length; i++) { acc += FORM[i]; if (bar < acc) return i; }
    return FORM.length - 1;
  }

  /** Everything that sounds on one sixteenth. */
  private play(song: Song, step: number, at: number, stepDur: number): void {
    const a = this.arr, s = step % (STEPS * 2), bar = Math.floor(step / STEPS), sec = this.section(step);
    const intro = sec === 0, outro = sec === FORM.length - 1, hookSec = sec === 2 || sec === 4;
    const chord = song.root + PROG[bar % 4];
    const drums = !intro || bar >= 2;
    if (drums && !outro) {
      if (a.kick[s]) this.kick(at);
      if (a.snare[s]) this.snare(at, hookSec ? 1 : 0.85);
      if (a.hat[s] > 0 && (song.trap || hookSec || s % 2 === 0)) this.hat(at, a.hat[s] * (song.trap && hookSec && s % 4 === 2 ? 0.7 : 1), false);
      if (a.open[s] && hookSec) this.hat(at, 0.6, true);
      if (song.trap && hookSec && s % 8 === 6) { this.hat(at, 0.5, false); this.hat(at + stepDur / 2, 0.5, false); }
    }
    if (drums && a.bass[s]) this.bass(midi(chord - 24), at, song.trap ? stepDur * 6 : stepDur * 3, song.trap);
    if (s % STEPS === 0 && (sec !== 1 || bar % 2 === 0)) this.pad(chord, at, stepDur * STEPS);
    const hookOn = hookSec || intro || outro || (sec === 3 && bar % 4 >= 2);
    if (hookOn && a.hook[s] >= 0) this.lead(midi(chord + 12 + a.hook[s]), at, stepDur * 1.6, hookSec ? 1 : 0.7);
  }

  private kick(at: number): void {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(48, at + 0.12);
    g.gain.setValueAtTime(0.9, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
    o.connect(g).connect(this.beatsBus); o.start(at); o.stop(at + 0.35);
  }

  private snare(at: number, v: number): void {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * v, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    n.connect(f).connect(g).connect(this.beatsBus); n.start(at, Math.random() * 1.5, 0.2);
    const o = c.createOscillator(); o.frequency.setValueAtTime(210, at); o.frequency.exponentialRampToValueAtTime(140, at + 0.08);
    const og = c.createGain(); og.gain.setValueAtTime(0.35 * v, at); og.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
    o.connect(og).connect(this.beatsBus); o.start(at); o.stop(at + 0.12);
  }

  private hat(at: number, v: number, open: boolean): void {
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain(); const d = open ? 0.28 : 0.05;
    g.gain.setValueAtTime(0.16 * v, at); g.gain.exponentialRampToValueAtTime(0.001, at + d);
    n.connect(f).connect(g).connect(this.beatsBus); n.start(at, Math.random() * 1.5, d + 0.02);
  }

  private bass(f: number, at: number, len: number, slide: boolean): void {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), sh = c.createWaveShaper();
    const curve = new Float32Array(256); for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 1.8);
    sh.curve = curve;
    o.frequency.setValueAtTime(slide ? f * 1.5 : f, at); if (slide) o.frequency.exponentialRampToValueAtTime(f, at + 0.08);
    g.gain.setValueAtTime(0.001, at); g.gain.exponentialRampToValueAtTime(0.7, at + 0.01); g.gain.setTargetAtTime(0.001, at + len * 0.6, len * 0.2);
    o.connect(sh).connect(g).connect(this.beatsBus); o.start(at); o.stop(at + len + 0.2);
  }

  private pad(root: number, at: number, len: number): void {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.001, at); g.gain.linearRampToValueAtTime(0.045, at + len * 0.3); g.gain.setTargetAtTime(0.001, at + len * 0.8, len * 0.1);
    for (const [semi, det] of [[0, -6], [3, 5], [7, -4], [12, 7]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(root + 12 + semi); o.detune.value = det;
      o.connect(f); o.start(at); o.stop(at + len + 0.5);
    }
    f.connect(g).connect(this.beatsBus);
  }

  private lead(f: number, at: number, len: number, v: number): void {
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'square'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, at); lp.frequency.exponentialRampToValueAtTime(700, at + len);
    g.gain.setValueAtTime(0.001, at); g.gain.exponentialRampToValueAtTime(0.11 * v, at + 0.01); g.gain.setTargetAtTime(0.001, at + len * 0.7, len * 0.15);
    o.connect(lp).connect(g); g.connect(this.beatsBus); g.connect(this.delay);
    o.start(at); o.stop(at + len + 0.3);
  }
}
