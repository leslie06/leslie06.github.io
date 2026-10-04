import type { VoiceSpec } from '../character/Voice';

/**
 * Lines read out loud (2026-10-04, 「这npc只有文字，咋没有语音？」): the browser's own speech synthesis
 * with a voice installed on the device (macOS / iOS Tingting, Windows Huihui, Android's on-device
 * voices) - `localService` voices only, so nothing is fetched, as the game ships no audio and makes no
 * content requests. Each speaker's VoiceSpec sets the pitch and rate (a man lower, an old one slower).
 * One line at a time: the dialogue box's lines cut in, a shout waits its turn (audio/ babbles it
 * instead). Without a usable voice `ready` stays false and audio/Babble.ts speaks for everyone.
 */
export class Speech {
  private voices: SpeechSynthesisVoice[] = [];
  private synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  private current: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (!this.synth) return;
    const load = () => { this.voices = this.synth!.getVoices().filter((v) => v.localService); };
    load();
    this.synth.addEventListener?.('voiceschanged', load);
  }

  /** A local voice for this language exists. */
  ready(lang: 'zh' | 'en'): boolean { return !!this.pick(lang); }

  /**
   * A voice for this speaker: a man's or a woman's (an old one's for the old) where the device has them -
   * macOS has Tingting and eight more (Eddy, Reed, Rocko, Grandpa; Flo, Sandy, Shelley, Grandma), Windows
   * Huihui, Yaoyao and Kangkang - the same one for the same speaker every time (picked by their pitch).
   * `own`: it is that kind of voice, so it needs little pitch shift.
   */
  private voiceFor(lang: 'zh' | 'en', v: VoiceSpec): { voice: SpeechSynthesisVoice; own: boolean } | null {
    const base = this.pick(lang);
    if (!base || v.fem === undefined) return base ? { voice: base, own: false } : null;
    const same = this.voices.filter((x) => x.lang === base.lang);
    const male = /Eddy|Reed|Rocko|Grandpa|Kangkang|Yunxi|Yunyang|Yunjian|Daniel|Alex|Fred|Aaron|Arthur|Gordon|Male|男/i;
    const female = /Ting|Flo|Sandy|Shelley|Grandma|Huihui|Yaoyao|Xiaoxiao|Xiaoyi|Meijia|Samantha|Karen|Moira|Serena|Female|女/i;
    const old = /Grandpa|Grandma/i;
    const fem = v.fem > 0.5, aged = (v.age ?? 0.3) > 0.72;
    let pool = same.filter((x) => (fem ? female : male).test(x.name) && !(fem ? male : female).test(x.name));
    const olds = pool.filter((x) => old.test(x.name));
    pool = aged && olds.length ? olds : pool.filter((x) => !old.test(x.name));
    if (!pool.length) return { voice: base, own: false };
    return { voice: pool[Math.floor(v.pitch * 37) % pool.length], own: true };
  }

  /** Something is being said now. */
  get busy(): boolean { return !!this.synth?.speaking; }

  /** iOS only lets speech start inside a user gesture: say nothing once on the start button. */
  unlock(): void {
    if (!this.synth) return;
    try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; this.synth.speak(u); } catch { /* not allowed */ }
  }

  private pick(lang: 'zh' | 'en'): SpeechSynthesisVoice | null {
    const want = lang === 'zh' ? /^zh[-_](CN|Hans)/i : /^en[-_](US|GB)/i, any = lang === 'zh' ? /^(zh|cmn)/i : /^en/i;
    return this.voices.find((v) => want.test(v.lang)) ?? this.voices.find((v) => any.test(v.lang)) ?? null;
  }

  /** Say `text` in this voice at `volume` 0..1; `cut` stops whatever is being said first. */
  say(text: string, v: VoiceSpec, lang: 'zh' | 'en', volume: number, cut: boolean): boolean {
    const pickd = this.voiceFor(lang, v);
    if (!this.synth || !pickd) return false;
    const { voice, own } = pickd;
    if (cut) this.synth.cancel();
    else if (this.synth.speaking || this.synth.pending) return false;
    // Speech engines read the ellipses and dashes of written dialogue as pauses or not at all: keep the words.
    const clean = text.replace(/[*＊]/g, '').replace(/[—―]+/g, '，').trim();
    if (!clean) return false;
    const u = new SpeechSynthesisUtterance(clean);
    u.voice = voice; u.lang = voice.lang;
    // A voice of their own kind only varies a little round its own pitch; otherwise the one voice there is
    // is moved: 112 Hz (a man) -> 0.8, 207 Hz (a woman) -> 1.3.
    const typical = 112 + 95 * (v.fem ?? 0);
    u.pitch = own ? Math.max(0.8, Math.min(1.25, 1 + (v.pitch - typical) / 200)) : Math.max(0.5, Math.min(1.7, 0.8 + (v.pitch - 112) / 190));
    u.rate = Math.max(0.75, Math.min(1.35, 0.95 * v.rate + 0.12));
    u.volume = Math.max(0, Math.min(1, volume));
    this.current = u;
    this.synth.speak(u);
    return true;
  }

  stop(): void { this.synth?.cancel(); this.current = null; }
}
