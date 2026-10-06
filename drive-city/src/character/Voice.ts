import type { Look } from './Body';

/**
 * How a person sounds when they speak (audio/Babble.ts synthesises it: no recordings). `pitch` is
 * the fundamental in Hz, `rate` syllables a second relative to normal speech, `bright` how far up
 * the formants sit (a small or young voice is brighter).
 */
export interface VoiceSpec { pitch: number; rate: number; bright: number;
  /** Who it is, for a spoken voice (audio/Speech.ts picks a man's or a woman's, an old one's): 0 male .. 1 female, 0 young .. 1 old. */
  fem?: number; age?: number;
  /** A contact's id (contacts/): their own recorded voice for their own lines (audio/VoiceClips.ts). */
  character?: string }

/** A voice to go with a look: lower for men, slower and a little lower with age; `seed` 0..1 varies it. */
export function voiceOf(look: Look, seed: number): VoiceSpec {
  const fem = look.fem ?? 0, age = look.age ?? 0.3, h = (k: number) => { const s = Math.sin((seed + 0.31) * (91.7 + k * 13.1)) * 43758.5453; return s - Math.floor(s); };
  const base = 112 + 95 * fem;
  return {
    fem, age,
    pitch: base * (0.88 + 0.24 * h(1)) * (1 - 0.1 * Math.max(0, age - 0.5)),
    rate: (0.9 + 0.25 * h(2)) * (1 - 0.18 * Math.max(0, age - 0.55)),
    bright: 0.85 + 0.25 * fem + 0.15 * h(3) - 0.1 * age,
  };
}
