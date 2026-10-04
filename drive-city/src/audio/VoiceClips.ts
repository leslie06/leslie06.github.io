import { STRINGS, type Lang, type TKey } from '../core/I18n';
import type { VoiceSpec } from '../character/Voice';

/**
 * Recorded lines (2026-10-05, 「说话不自然，一听就是机器人说的」): every NPC line and shout is recorded
 * offline with Microsoft's neural voices (scripts/voice/render.py) in six voices - a young man, a man, an
 * old man, the same for women - into `public/voice/zh/<class>/<key>.mp3` (~5 KB a line), fetched the first
 * time someone says it. A line arrives as its text, so the zh table is read backwards (a line with a
 * parameter by its template: 「去{place}」 matches 「去北京站」; its recording says it generically). The
 * speaker's VoiceSpec picks the class (`fem`, `age`) and, through the playback rate, a few per cent of
 * pitch of their own. Lines with no recording (English, HUD text) return false and go to Speech/Babble.
 */
type Cls = 'my' | 'mm' | 'mo' | 'fy' | 'fm' | 'fo' | 'xm';
interface Manifest { v: number; zh?: { classes: Cls[]; keys: string[]; only?: Record<string, Cls[]> } }

/** Is a recorded dialogue line playing (or on its way)? dialogue/ holds the box open for it. */
let lineBusyUntil = 0;
export function lineTalking(): boolean { return performance.now() < lineBusyUntil; }

const TYPICAL: Record<Cls, number> = { my: 120, mm: 108, mo: 100, fy: 215, fm: 200, fo: 185, xm: 112 };

export class VoiceClips {
  private manifest: Manifest | null = null;
  private loading: Promise<void> | null = null;
  private exact = new Map<string, string>();
  private patterns: { re: RegExp; key: string }[] = [];
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private line: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lineSeq = 0;
  private shouts = 0;

  constructor(private base: string) {}

  /** Fetch the list of recordings (at the first gesture: it is small). */
  prepare(): void {
    if (this.loading) return;
    this.loading = fetch(`${this.base}manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m: Manifest | null) => {
      if (!m?.zh) return;
      this.manifest = m;
      const zh = STRINGS.zh as Record<string, string>;
      for (const key of m.zh.keys) {
        const s = zh[key as TKey];
        if (!s) continue;
        if (!s.includes('{')) { this.exact.set(s, key); continue; }
        const re = s.split(/\{\w+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');
        this.patterns.push({ re: new RegExp(`^${re}$`), key });
      }
    }).catch(() => { this.loading = null; });
  }

  private keyOf(text: string): string | null {
    const k = this.exact.get(text);
    if (k) return k;
    for (const p of this.patterns) if (p.re.test(text)) return p.key;
    return null;
  }

  private classOf(key: string, v: VoiceSpec): Cls {
    const only = this.manifest?.zh?.only?.[key];
    if (only?.length) return only[0];
    const fem = (v.fem ?? (v.pitch > 160 ? 1 : 0)) > 0.5, age = v.age ?? 0.4;
    const band = age > 0.7 ? 'o' : age < 0.33 ? 'y' : 'm';
    return `${fem ? 'f' : 'm'}${band}` as Cls;
  }

  private load(c: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => c.decodeAudioData(b)).catch(() => { this.buffers.delete(url); return null; });
      this.buffers.set(url, p);
      if (this.buffers.size > 120) this.buffers.delete(this.buffers.keys().next().value!);   // oldest first
    }
    return p;
  }

  /**
   * Say `text` if it is a recorded line: `line` (the dialogue box) cuts in on the last line, a shout plays
   * over whatever else is going on (three at most). Returns false when there is no recording for it.
   */
  play(c: AudioContext, out: AudioNode, text: string, v: VoiceSpec, lang: Lang, volume: number, pan: number, line: boolean): boolean {
    if (lang !== 'zh' || !this.manifest) return false;
    const key = this.keyOf(text);
    if (!key) return false;
    const cls = this.classOf(key, v);
    // A few per cent of their own pitch (and pace) round the recorded voice's.
    const rate = Math.max(0.94, Math.min(1.06, Math.pow(v.pitch / TYPICAL[cls], 0.35)));
    const asked = performance.now(), seq = line ? ++this.lineSeq : 0;
    if (line) { this.stopLine(c); lineBusyUntil = asked + 2500; }
    else if (this.shouts >= 3) return true;
    else this.shouts++;
    void this.load(c, `${this.base}zh/${cls}/${key}.mp3`).then((buf) => {
      const late = performance.now() - asked;
      if (!line) this.shouts--;
      // A shout heard a second late is about something else by then; a line only while it is the box's.
      if (!buf || (line ? seq !== this.lineSeq : late > 1200)) { if (line && seq === this.lineSeq) lineBusyUntil = 0; return; }
      const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
      const gain = c.createGain(); gain.gain.value = volume;
      const panner = c.createStereoPanner(); panner.pan.value = pan;
      src.connect(gain).connect(panner).connect(out);
      src.start();
      if (!line) this.shouts++;
      src.onended = () => { panner.disconnect(); if (!line) this.shouts--; else if (this.line?.src === src) { this.line = null; lineBusyUntil = 0; } };
      if (line) { this.line = { src, gain }; lineBusyUntil = performance.now() + (buf.duration / rate) * 1000 + 150; }
    });
    return true;
  }

  private stopLine(c: AudioContext): void {
    if (!this.line) return;
    const { src, gain } = this.line;
    gain.gain.setTargetAtTime(0, c.currentTime, 0.03);
    try { src.stop(c.currentTime + 0.15); } catch { /* ended */ }
    this.line = null;
  }

  /** Everything quiet (pause, mute). */
  stop(c: AudioContext | null): void {
    this.lineSeq++; lineBusyUntil = 0;
    if (c) this.stopLine(c);
  }
}
