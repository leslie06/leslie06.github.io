/**
 * Dynamic crosshair: four lines whose gap follows the weapon's spread cone projected to pixels.
 * Hides on ADS, collapses to a dot while sprinting, ring for shotguns, nothing for snipers.
 */
import { div, setVar, setClass } from './dom';
import type { HudState } from './HudState';

const KINDS = ['rifle', 'smg', 'pistol', 'shotgun', 'sniper', 'lmg', 'launcher'] as const;

export class Crosshair {
  root = div('xh', [div('l t'), div('l b'), div('l lf'), div('l rt'), div('dot'), div('ring')]);
  private hitUntil = -1;
  private kind = '';

  update(s: HudState): void {
    const w = s.weapon;
    const spread = w?.spread ?? 0.018;
    const focal = (s.heightPx * 0.5) / Math.tan(s.fovRad * 0.5);
    // Reference hipfire gap is 10-14px at 1080p; the spread cone only widens it from there, and
    // at 0.28 of the projected cone a firing rifle sits around 15px rather than the old 22px.
    const base = s.heightPx * 0.0093;
    const gap = Math.min(s.heightPx * 0.1, base + Math.tan(spread) * focal * 0.28);
    setVar(this.root, '--gap', `${Math.round(gap * 2) / 2}px`);

    const aiming = (w?.aimBlend ?? 0) > 0.45 || (s.player?.aiming ?? false);
    setClass(this.root, 'ads', aiming);
    setClass(this.root, 'sprint', !aiming && (s.player?.sprinting ?? false));
    const kind = w?.kind ?? 'rifle';
    if (kind !== this.kind) {
      for (const k of KINDS) this.root.classList.remove(`k-${k}`);
      this.root.classList.add(`k-${kind}`);
      this.kind = kind;
    }
    setClass(this.root, 'hit', s.t < this.hitUntil);
  }

  /** Brief orange flash on a confirmed hit. */
  flash(now: number): void { this.hitUntil = now + 0.1; }
}
