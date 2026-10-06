/**
 * Who gets to say what (2026-10-06): the rules of the NPC barks recorded with CosyVoice (assets/voice/dist,
 * scripts/voice/sprite.mjs), kept apart from the audio so they can be tested in Node.
 *  - A line is picked by archetype, trigger and the speaker's own voice, at random among its recordings but
 *    never one of the last `noRepeatLastVariants` played for that voice and trigger.
 *  - Every speaker has a cooldown per trigger (the trigger's `cooldownSec`).
 *  - Priority: a speaker already talking is cut off by a line of the same or higher priority (a lower one is
 *    dropped); when `maxConcurrentSpeakers` are talking, a new line cuts off the lowest-priority one if it
 *    outranks it, else it is dropped.
 *  - Each speaker keeps one speaking rate inside the archetype's `rateRange`; every line adds `rateJitter`.
 */
export type Trigger = 'near_miss' | 'bumped' | 'hit' | 'aimed' | 'gunshot' | 'car_stolen' | 'honk' | 'police_call' | 'greet' | 'idle';
export type Archetype = 'uncle' | 'auntie' | 'courier' | 'office' | 'tourist' | 'guard' | 'driver';
export const TRIGGERS: readonly Trigger[] = ['near_miss', 'bumped', 'hit', 'aimed', 'gunshot', 'car_stolen', 'honk', 'police_call', 'greet', 'idle'];
export const ARCHETYPES: readonly Archetype[] = ['uncle', 'auntie', 'courier', 'office', 'tourist', 'guard', 'driver'];

export interface SpriteClip {
  id: string; voice: string; voiceIndex: number; variant: number;
  start: number; end: number; trigger: Trigger; emotion: string; text: string;
}
export interface SpriteArchetype { name: string; rateRange: [number, number]; voiceSex: ('m' | 'f')[]; file: string; duration: number; clips: SpriteClip[] }
export interface Playback { rateJitter: number; refDistance: number; maxDistance: number; rolloffFactor: number; maxConcurrentSpeakers: number; noRepeatLastVariants: number }
export interface Sprite {
  version: number; sampleRate: number;
  playback: Playback;
  triggers: Record<Trigger, { priority: number; cooldownSec: number; desc: string }>;
  archetypes: Partial<Record<Archetype, SpriteArchetype>>;
}

/** One speaker: fixed archetype, voice and rate for as long as it exists. */
export interface Speaker {
  readonly archetype: Archetype;
  readonly voiceIndex: number;
  readonly rate: number;
  /** When it last said each trigger (seconds, the director's clock). */
  readonly said: Map<Trigger, number>;
  line: Line | null;
}

/** A line being said. */
export interface Line {
  readonly speaker: Speaker;
  readonly clip: SpriteClip;
  readonly priority: number;
  /** Playback rate: the speaker's own, jittered. */
  readonly rate: number;
  /** Called once: true when it was heard to the end, false when cut off. */
  readonly onDone?: (completed: boolean) => void;
  /** When it started (the director's clock). */
  readonly started: number;
  /** Set when it has been cut off (fading out, no longer counted as talking). */
  cut: boolean;
}

/** Where the lines are played (VoiceManager: positional audio; tests: a stub). */
export interface Output {
  /** Whether this archetype's audio can be played now (loaded, unmuted). */
  ready(archetype: Archetype): boolean;
  /** Start it; call `Director.ended` when it has played to its end. */
  play(line: Line): void;
  /** Cut it off (a short fade). */
  stop(line: Line): void;
}

export class Director {
  private readonly talking = new Set<Line>();
  private readonly recent = new Map<string, string[]>();
  now = 0;

  constructor(readonly sprite: Sprite, private out: Output, private rnd: () => number = Math.random) {}

  /** A speaker of this archetype; `sex` picks the matching voice where the archetype has both (office, tourist). */
  speaker(archetype: Archetype, sex: 'm' | 'f' | null, seed: number): Speaker {
    const a = this.sprite.archetypes[archetype];
    const sexes = a?.voiceSex ?? ['m'];
    let options = sexes.map((s, i) => [s, i] as const).filter(([s]) => !sex || s === sex).map(([, i]) => i);
    if (!options.length) options = sexes.map((_, i) => i);
    const h = frac(Math.sin((seed + 0.17) * 12.9898) * 43758.5453), h2 = frac(Math.sin((seed + 0.71) * 78.233) * 12345.678);
    const [lo, hi] = a?.rateRange ?? [1, 1];
    return { archetype, voiceIndex: options[Math.floor(h * options.length)], rate: lo + (hi - lo) * h2, said: new Map(), line: null };
  }

  /** How many speakers are talking (lines being cut off do not count). */
  get speakers(): number { return this.talking.size; }

  /** The lines being said now. */
  get lines(): readonly Line[] { return [...this.talking]; }

  /**
   * Have `s` say something for `trigger`. Returns the line, or null when it is dropped: no recording, the
   * audio not loaded yet, the cooldown, or outranked. `onDone` is only ever called for a returned line.
   */
  say(s: Speaker, trigger: Trigger, onDone?: (completed: boolean) => void): Line | null {
    const t = this.sprite.triggers[trigger];
    const a = this.sprite.archetypes[s.archetype];
    if (!t || !a || !this.out.ready(s.archetype)) return null;
    const last = s.said.get(trigger);
    if (last !== undefined && this.now - last < t.cooldownSec) return null;
    // Its own line first: the same or a higher priority cuts it off.
    if (s.line && !s.line.cut && t.priority < s.line.priority) return null;
    // The others: at the limit, the new line has to outrank the lowest one talking.
    let victim: Line | null = null;
    const others = [...this.talking].filter((l) => l.speaker !== s);
    if (others.length >= this.sprite.playback.maxConcurrentSpeakers) {
      for (const l of others) if (!victim || l.priority < victim.priority || (l.priority === victim.priority && l.started < victim.started)) victim = l;
      if (!victim || t.priority <= victim.priority) return null;
    }
    const clip = this.pick(a, s, trigger);
    if (!clip) return null;
    const j = this.sprite.playback.rateJitter;
    const line: Line = { speaker: s, clip, priority: t.priority, rate: s.rate * (1 + (this.rnd() * 2 - 1) * j), onDone, started: this.now, cut: false };
    if (s.line && !s.line.cut) this.cut(s.line);
    if (victim) this.cut(victim);
    this.talking.add(line);
    this.out.play(line);
    s.line = line;
    s.said.set(trigger, this.now);
    const key = `${s.archetype}/${s.voiceIndex}/${trigger}`;
    const hist = this.recent.get(key) ?? [];
    hist.push(clipKey(clip));
    while (hist.length > Math.max(1, this.sprite.playback.noRepeatLastVariants)) hist.shift();
    this.recent.set(key, hist);
    return line;
  }

  /** The output says a line has played to its end. */
  ended(line: Line): void {
    if (!this.talking.delete(line)) return;
    if (line.speaker.line === line) line.speaker.line = null;
    line.onDone?.(true);
  }

  /** Cut a speaker off (they were knocked down, they are gone). */
  silence(s: Speaker): void { if (s.line && !s.line.cut) this.cut(s.line); }

  /** Everyone stops (pause, mute). */
  silenceAll(): void { for (const l of [...this.talking]) this.cut(l); }

  private cut(line: Line): void {
    line.cut = true;
    this.talking.delete(line);
    if (line.speaker.line === line) line.speaker.line = null;
    this.out.stop(line);
    line.onDone?.(false);
  }

  /** A recording of the trigger in the speaker's voice, not one of the last few played. */
  private pick(a: SpriteArchetype, s: Speaker, trigger: Trigger): SpriteClip | null {
    let pool = a.clips.filter((c) => c.trigger === trigger && c.voiceIndex === s.voiceIndex);
    if (!pool.length) pool = a.clips.filter((c) => c.trigger === trigger);
    if (!pool.length) return null;
    const hist = this.recent.get(`${s.archetype}/${s.voiceIndex}/${trigger}`) ?? [];
    const fresh = pool.filter((c) => !hist.includes(clipKey(c)));
    const from = fresh.length ? fresh : pool.filter((c) => clipKey(c) !== hist[hist.length - 1]);
    const list = from.length ? from : pool;
    return list[Math.floor(this.rnd() * list.length)];
  }
}

const frac = (x: number) => x - Math.floor(x);
const clipKey = (c: SpriteClip) => `${c.id}#${c.voiceIndex}.${c.variant}`;
