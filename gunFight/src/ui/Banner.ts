/**
 * Centre-screen text, sequenced so only one thing ever owns the middle of the frame:
 *   wave banner   — 1.2 s hold then a 0.4 s fade, parked high at 20% so it never touches the reticle
 *   message       — low, above the ammo cluster
 *   prompt        — the interact keycap, just under the crosshair
 *   objective     — announced under the compass for 3 s, then demoted to a dim gold line there
 */
import { div, span, setText, setClass, animate, pad2, type ShotAnim } from './dom';
import { theme } from './theme';
import type { HudState } from './HudState';
import { t, lang } from '../core/I18n';

export class WaveBanner {
  root: HTMLDivElement;
  private big = div('big', [t('wave.banner', { n: 1, nn: '01' })]);
  private sub = div('sub', [t('wave.inbound')]);
  private ln = div('ln');
  private anims: ShotAnim[] = [];

  constructor() {
    this.root = div('wave', [this.ln, this.big, this.sub]);
  }

  show(wave: number, subtitle = t('wave.inbound')): void {
    setText(this.big, t('wave.banner', { n: wave, nn: pad2(wave) }));
    setText(this.sub, subtitle);
    for (const a of this.anims) a.cancel();
    const life = theme.timing.waveBanner, hold = theme.timing.waveBannerHold;
    // Shot time lands after the reveal so captures never freeze mid-wipe.
    const shot = 620;
    this.anims = [
      animate(this.root, [
        { opacity: 0, offset: 0 }, { opacity: 1, offset: 110 / life },
        { opacity: 1, offset: hold / life }, { opacity: 0, offset: 1 },
      ], { duration: life, easing: 'linear' }, shot),
      animate(this.big, [
        { transform: 'translateY(.18em)', letterSpacing: '.18em', offset: 0 },
        { transform: 'translateY(0)', letterSpacing: '.08em', offset: 380 / life },
        { transform: 'translateY(0)', letterSpacing: '.08em', offset: 1 },
      ], { duration: life, easing: 'cubic-bezier(.2,.8,.2,1)' }, shot),
      animate(this.ln, [
        { width: '0em', opacity: 0, offset: 0 }, { width: '11em', opacity: .8, offset: 420 / life },
        { width: '11em', opacity: .8, offset: 1 },
      ], { duration: life, easing: 'cubic-bezier(.2,.8,.2,1)' }, shot),
      animate(this.sub, [
        { opacity: 0, offset: 0 }, { opacity: 0, offset: 200 / life },
        { opacity: 1, offset: 520 / life }, { opacity: 1, offset: 1 },
      ], { duration: life, easing: 'ease-out' }, shot),
    ];
  }
}

export class Message {
  root = div('msg');
  private anim: ShotAnim | null = null;

  show(text: string, ms: number = theme.timing.message): void {
    setText(this.root, text.toUpperCase());
    this.anim?.cancel();
    this.anim = animate(this.root, [
      { opacity: 0, transform: 'translate(-50%, .25em)', offset: 0 },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: Math.min(0.3, 140 / ms) },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: 1 - Math.min(0.3, 260 / ms) },
      { opacity: 0, transform: 'translate(-50%, 0)', offset: 1 },
    ], { duration: ms, easing: 'ease-out' }, 400);
  }
}

export class Prompt {
  root: HTMLDivElement;
  private key = span('key', 'E');
  private txt = span('txt', t('prompt.interact'));
  private shown = false;
  private anim: ShotAnim | null = null;

  constructor() { this.root = div('prompt', [this.key, this.txt]); }

  show(key: string, text: string): void {
    setText(this.key, key.toUpperCase());
    setText(this.txt, text.toUpperCase());
    setClass(this.root, 'nokey', key === '');
    if (this.shown) return;
    this.shown = true;
    this.anim?.cancel();
    this.anim = animate(this.root, [{ opacity: 0, transform: 'translate(-50%, .25em)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 140, easing: 'ease-out' }, 140);
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.anim?.cancel();
    this.anim = animate(this.root, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 }, 120);
  }

  /**
   * Drive from `GameApi.interactPrompt`, which arrives pre-formatted as "[E] RESUPPLY" (or plain
   * text, in which case the keycap is dropped). Empty string means nothing is in reach.
   */
  setRaw(raw: string): void {
    if (!raw) { this.hide(); return; }
    const m = /^\s*\[([^\]]{1,6})\]\s*(.*)$/.exec(raw);
    if (m) this.show(m[1], m[2]); else this.show('', raw);
  }
}

/**
 * Objective line, directly under the compass heading (where CoD puts the zone name).
 * A *new* objective is announced at full strength for 3 s, then collapses to one dim gold line so
 * the top of the frame reads as one element instead of three.
 */
export class Objective {
  root: HTMLDivElement;
  private line = div('t', [t('obj.eliminate')]);
  private pre = span('tl', '');
  private count = span('n', '0');
  private tail = span('tl', '');
  private title = '';
  private titleLang = lang();
  private fmt = '';
  private since = -1e9;

  constructor() {
    const c = div('c', [this.pre, this.count, this.tail]);
    this.root = div('obj settled', [this.line, c]);
  }

  /**
   * `fmt` is the whole count phrase with `{n}` where the number goes ("{n} REMAINING", "剩余 {n}"),
   * so each language keeps its own word order. Only re-split when it changes: this runs every frame.
   */
  set(title: string, count: number, fmt: string): void {
    const up = title.toUpperCase();
    if (up !== this.title) {
      // The very first assignment is the HUD booting, not a new order: start already settled. Nor is
      // a language switch: same order, new words.
      if (this.title !== '' && this.titleLang === lang()) this.since = -1;
      this.title = up; this.titleLang = lang();
      setText(this.line, up);
    }
    if (fmt !== this.fmt) {
      this.fmt = fmt;
      const i = fmt.indexOf('{n}');
      setText(this.pre, i > 0 ? fmt.slice(0, i).trim().toUpperCase() : '');
      setText(this.tail, (i >= 0 ? fmt.slice(i + 3) : fmt).trim().toUpperCase());
    }
    setText(this.count, String(count));
  }

  update(s: HudState): void {
    if (this.since === -1) this.since = s.t;
    setClass(this.root, 'settled', s.t - this.since > theme.timing.objectiveSettle);
  }
}
