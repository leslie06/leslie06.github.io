/**
 * Top-centre compass, built like the reference frames: a scrolling ruler of 1px ticks with small
 * cardinal/numeric labels, hostile diamonds pinned to their bearing, and the numeric heading
 * overlaid dead centre in gold between two hairlines (ref_10). Built once (three wraps) and only
 * translated per frame.
 */
import { div, span, setVar, setText } from './dom';
import { CARDINALS } from './icons';
import { bearingTo, wrapDeg, type HudState } from './HudState';

const CLAMP = 46;       // markers beyond this are pinned to the edge of the strip
const MARKERS = 10;

export class Compass {
  root: HTMLDivElement;
  private strip = div('strip');
  private hdg = span('hdg', '000');
  private markers: HTMLElement[] = [];
  private markerState: string[] = [];

  constructor() {
    for (let deg = -180; deg <= 540; deg += 5) {
      const major = deg % 15 === 0;
      const tk = div('tk' + (major ? ' mj' : ''));
      tk.style.left = `calc(var(--dpp) * ${deg})`;
      this.strip.append(tk);
      if (major) {
        const d = ((deg % 360) + 360) % 360;
        const card = d % 45 === 0;
        const lb = div('lb' + (card ? ' cd' : ''), [span('', card ? CARDINALS[d / 45] : String(d))]);
        lb.style.left = `calc(var(--dpp) * ${deg})`;
        this.strip.append(lb);
      }
    }
    const win = div('win', [this.strip]);
    for (let i = 0; i < MARKERS; i++) { const m = div('em'); this.markers.push(m); this.markerState.push(''); win.append(m); }
    this.root = div('compass', [win, div('hw', [div('b'), this.hdg, div('b')])]);
  }

  update(s: HudState): void {
    const h = s.heading;
    setVar(this.strip, '--x', `calc(var(--dpp) * ${(-h).toFixed(2)})`);
    setText(this.hdg, String(Math.round(h) % 360).padStart(3, '0'));

    const p = s.player;
    let mi = 0;
    if (p) {
      for (const e of s.enemies) {
        if (!e.alive || mi >= MARKERS) continue;
        const raw = wrapDeg(bearingTo(p.x, p.z, e.x, e.z) - h);
        const rel = Math.max(-CLAMP, Math.min(CLAMP, raw));
        const m = this.markers[mi++];
        const st = `translateX(calc(var(--dpp) * ${rel.toFixed(1)} - 50%)) rotate(45deg) scale(${Math.abs(raw) > CLAMP ? .68 : 1})`;
        if (this.markerState[mi - 1] !== st) { this.markerState[mi - 1] = st; m.style.transform = st; m.style.opacity = Math.abs(raw) > CLAMP ? '.45' : '.92'; }
      }
    }
    for (; mi < MARKERS; mi++) if (this.markerState[mi] !== '') { this.markerState[mi] = ''; this.markers[mi].style.opacity = '0'; }
  }
}
