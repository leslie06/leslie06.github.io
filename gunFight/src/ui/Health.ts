/**
 * Bottom-left health: a thin 150x6 px bar (1080p) with the numeric HP beside it, plus the DOM red
 * damage vignette. No segments — the segmented sci-fi readout fought the military type system.
 * A paler "chip" layer trails the fill by ~0.6 s so a burst of damage reads as a hit, not a jump.
 */
import { div, span, setText, setClass, setVar } from './dom';
import type { HudState } from './HudState';

const LOW = 0.35;

export class Health {
  root: HTMLDivElement;
  vignette = div('ovl vig');
  private num = span('num', '100');
  private fill = div('f');
  private chip = div('ch');
  private lag = -1;

  constructor() {
    const bar = div('bar', [this.chip, this.fill]);
    this.root = div('hp', [bar, div('rd', [this.num, span('lbl', 'HP')])]);
  }

  update(s: HudState): void {
    const hp = s.player?.health ?? 100, max = s.player?.maxHealth ?? 100;
    const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    setText(this.num, String(Math.max(0, Math.ceil(hp))));

    // Chip bar catches up over ~0.6s; snaps instantly when healing so it never trails behind.
    if (this.lag < 0 || ratio >= this.lag) this.lag = ratio;
    else this.lag = Math.max(ratio, this.lag - Math.max(0.35, this.lag - ratio) * Math.min(1, s.dt * 1.8));
    setVar(this.fill, '--f', `${(ratio * 100).toFixed(1)}%`);
    setVar(this.chip, '--f', `${(this.lag * 100).toFixed(1)}%`);

    const low = ratio < LOW && ratio > 0;
    setClass(this.root, 'low', low);
    setClass(this.vignette, 'beat', low);
    const vig = low ? Math.min(1, (1 - ratio / LOW) * 0.9 + 0.22) : ratio <= 0 ? 1 : 0;
    setVar(this.vignette, '--o', (Math.round(vig * 50) / 50).toFixed(2));
  }
}
