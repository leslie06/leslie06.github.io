/**
 * Hitmarker (white X, red on kill, yellow-outlined on headshot) and the damage-direction arcs
 * that orbit the crosshair pointing at whatever hurt the player.
 */
import { div, el, svg, animate, setVar, type ShotAnim } from './dom';
import { theme } from './theme';
import { bearingTo, wrapDeg, type HudState } from './HudState';

export class Hitmarker {
  root = div('hm', [el('i'), el('i'), el('i'), el('i')]);
  private anim: ShotAnim | null = null;

  fire(opts: { headshot: boolean; kill: boolean }): void {
    const r = this.root;
    r.classList.toggle('kill', opts.kill);
    r.classList.toggle('hs', opts.headshot);
    this.anim?.cancel();
    const hold = theme.timing.hitmarkerHold, fade = theme.timing.hitmarker;
    const total = 50 + hold + fade;
    this.anim = animate(r, [
      { opacity: 1, transform: `scale(${opts.kill ? 1.55 : 1.35})`, offset: 0 },
      { opacity: 1, transform: 'scale(1)', offset: 50 / total },
      { opacity: 1, transform: 'scale(1)', offset: (50 + hold) / total },
      { opacity: 0, transform: 'scale(1)', offset: 1 },
    ], { duration: total, easing: 'ease-out' }, 70);
  }
}

interface Indicator { el: HTMLElement; x: number; z: number; until: number; anim: ShotAnim | null }

/**
 * Damage-direction arc: a thin 20° crescent with a brighter core line, sized so it sits ~150px
 * from centre at 1080p. Kept deliberately slim — a thick gradient blob reads as UI clip-art.
 */
const ARC = (() => {
  const seg = (r: number, halfDeg: number) => {
    const a = halfDeg * Math.PI / 180;
    return `M${(100 + r * Math.sin(-a)).toFixed(2)} ${(100 - r * Math.cos(-a)).toFixed(2)}A${r} ${r} 0 0 1 ${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
  };
  const c = theme.color.danger;
  return `<defs><linearGradient id="dg" x1="0" x2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".4" stop-color="${c}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
  <path d="${seg(74, 20)}" fill="none" stroke="url(#dg)" stroke-width="4" opacity=".85"/>
  <path d="${seg(68, 6)}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
})();

export class DamageIndicators {
  root = div('di-pool');
  private pool: Indicator[] = [];

  constructor(size = 8) {
    for (let i = 0; i < size; i++) {
      const e = div('di', [svg(ARC, '0 0 200 200')]);
      this.root.append(e);
      this.pool.push({ el: e, x: 0, z: 0, until: -1, anim: null });
    }
  }

  /** `from` is a world position; the arc points at its bearing relative to the player's heading. */
  hit(from: [number, number, number], now: number): void {
    let slot = this.pool.find((p) => p.until < now);
    if (!slot) { slot = this.pool.reduce((a, b) => (a.until < b.until ? a : b)); }
    slot.x = from[0]; slot.z = from[2];
    const life = theme.timing.damageIndicator;
    slot.until = now + life / 1000;
    slot.anim?.cancel();
    slot.anim = animate(slot.el, [
      { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 1 },
    ], { duration: life, easing: 'linear' }, 350);
  }

  update(s: HudState): void {
    const p = s.player;
    for (const ind of this.pool) {
      if (ind.until < s.t) continue;
      const bearing = p ? bearingTo(p.x, p.z, ind.x, ind.z) : 0;
      const rel = wrapDeg(bearing - s.heading);
      setVar(ind.el, 'transform', `rotate(${rel.toFixed(1)}deg)`);
    }
  }
}
