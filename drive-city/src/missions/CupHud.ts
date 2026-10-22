import { css, F } from '../ui/theme';
import type { WaterCup } from './WaterCup';

css(`
.hud .cup{position:absolute;top:74px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none}
.hud .cup[hidden]{display:none}
.hud .cup svg{width:58px;height:72px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
.hud .cup .pct{font:800 14px/1 ${F.ui};font-variant-numeric:tabular-nums;color:#dff3ff;text-shadow:0 1px 0 rgba(0,0,0,.75);letter-spacing:.04em}
.hud .cup.spill .pct{color:#ff8a7a}
.hud .cup.low .pct{color:#ffb347}
`);

const NS = 'http://www.w3.org/2000/svg';
/** The glass, seen from the driver's seat: wide at the rim (y 8), narrower at the foot (y 92). */
const RIM = 8, FOOT = 92, RIM_L = 10, RIM_R = 70, FOOT_L = 19, FOOT_R = 61;

/**
 * The cup on the dashboard (2026-10-22, the tofu run): its water drawn as it stands - level by what is left, the surface
 * tilted by the slosh across the car (heaped up on the side away from the turn), bobbing with braking and throttle;
 * drops over the rim while it spills. One SVG, its few attributes set per frame.
 */
export class CupHud {
  private root: HTMLDivElement | null = null;
  private water!: SVGPolygonElement;
  private drops: SVGCircleElement[] = [];
  private pct!: HTMLDivElement;
  private shown = -1;
  private t = 0;

  private mount(): boolean {
    if (this.root) return true;
    const hud = document.querySelector('.hud');
    if (!hud) return false;
    const root = document.createElement('div');
    root.className = 'cup';
    root.hidden = true;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 80 100');
    const glass = `${RIM_L},${RIM} ${RIM_R},${RIM} ${FOOT_R},${FOOT} ${FOOT_L},${FOOT}`;
    svg.innerHTML = `<defs><clipPath id="dc-cup"><polygon points="${glass}"/></clipPath></defs>`
      + `<polygon points="${glass}" fill="rgba(220,240,255,0.10)"/>`
      + `<polygon class="w" clip-path="url(#dc-cup)" fill="rgba(120,200,255,0.82)"/>`
      + `<polygon points="${glass}" fill="none" stroke="rgba(240,248,255,0.92)" stroke-width="2.6" stroke-linejoin="round"/>`
      + `<line x1="${RIM_L + 4}" y1="${RIM + 6}" x2="${FOOT_L + 3}" y2="${FOOT - 8}" stroke="rgba(255,255,255,0.35)" stroke-width="2" stroke-linecap="round"/>`;
    this.water = svg.querySelector('.w') as SVGPolygonElement;
    for (let i = 0; i < 4; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', '2.2'); c.setAttribute('fill', 'rgba(140,210,255,0.9)'); c.setAttribute('visibility', 'hidden');
      svg.appendChild(c); this.drops.push(c);
    }
    this.pct = document.createElement('div');
    this.pct.className = 'pct';
    root.append(svg, this.pct);
    hud.appendChild(root);
    this.root = root;
    return true;
  }

  show(on: boolean): void {
    if (!this.mount()) return;
    this.root!.hidden = !on;
  }

  update(dt: number, cup: WaterCup, label: string): void {
    if (!this.mount() || this.root!.hidden) return;
    this.t += dt;
    // the surface: its middle at the level (full sits 6 below the rim), sloped by the slosh across, bobbing with it along
    const yc = FOOT - (FOOT - RIM - 6) * cup.level + cup.sz * 7;
    const s = Math.max(-1.4, Math.min(1.4, cup.sx)) * 30;
    this.water.setAttribute('points', `-10,${(yc + s).toFixed(1)} 90,${(yc - s).toFixed(1)} 90,110 -10,110`);
    const spilling = cup.sinceSpill < 0.35;
    // drops thrown off the high side
    const side = s > 0 ? 1 : -1;
    for (let i = 0; i < this.drops.length; i++) {
      const c = this.drops[i];
      if (!spilling) { c.setAttribute('visibility', 'hidden'); continue; }
      const k = (this.t * 2.6 + i / this.drops.length) % 1;
      const x = 40 + side * (32 + k * 10 + i * 2), y = RIM - 2 + k * k * 30 - (1 - k) * 4;
      c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1)); c.setAttribute('visibility', 'visible');
    }
    this.root!.classList.toggle('spill', spilling);
    this.root!.classList.toggle('low', cup.level < 0.35);
    const n = Math.round(cup.level * 100);
    if (n !== this.shown) { this.shown = n; this.pct.textContent = `${label} ${n}%`; }
  }
}
