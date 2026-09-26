import { t } from '../core/I18n';
import { C, F } from '../ui/theme';
import type { StuntKind } from '.';

const CSS = `
.hud .combo{position:absolute;left:50%;top:22vh;transform:translateX(-50%);text-align:center;pointer-events:none;min-width:220px;transition:opacity .25s}
.hud .combo .head{font:800 40px/1.05 ${F.num};font-variant-numeric:tabular-nums;color:${C.paper};text-shadow:0 2px 14px rgba(0,0,0,.55)}
.hud .combo .mult{display:inline-block;margin-left:10px;padding:2px 8px;border-radius:4px;background:#6fc3ff;color:${C.ink};font:800 18px/1.2 ${F.num};vertical-align:middle}
.hud .combo .mult[hidden]{display:none}
.hud .combo .bar{margin:6px auto 4px;width:200px;height:4px;background:rgba(244,241,232,.2);border-radius:2px;overflow:hidden}
.hud .combo .bar i{display:block;height:100%;background:#6fc3ff;width:0}
.hud .combo .ln{font:800 15px/1.5 ${F.ui};letter-spacing:.06em;color:${C.paper};text-shadow:0 1px 8px rgba(0,0,0,.65)}
.hud .combo .ln b{color:#8fd4ff;margin-left:6px;font-family:${F.num}}
.hud .combo .ln.live b{color:${C.yellow}}
.hud .combo .ln:nth-child(n+2){opacity:.7;font-size:13px}
.hud .combo .res{display:inline-block;margin-top:4px;padding:6px 14px;border-radius:6px;background:rgba(10,12,14,.66);font:800 20px/1.2 ${F.num};color:#a6e38f}
.hud .combo .res.bad{color:${C.red}}
.hud .combo .res:empty{display:none}
body.dc-touch .hud .combo{top:17vh;transform:translateX(-50%) scale(.8);transform-origin:top center}
`;

const LABEL: Record<StuntKind, string> = { near: 'stunt.near', drift: 'stunt.drift', air: 'stunt.air', oncoming: 'stunt.oncoming', redlight: 'stunt.redlight', smash: 'stunt.smash', evade: 'stunt.evade', shortcut: 'stunt.shortcut', takedown: 'stunt.takedown' };

/** The combo under the drift meter: running total and multiplier, the last few moves, the result. */
export class StuntHud {
  private box: HTMLDivElement | null = null;
  private head!: HTMLSpanElement;
  private mult!: HTMLSpanElement;
  private bar!: HTMLElement;
  private lines!: HTMLDivElement;
  private liveEl!: HTMLDivElement;
  private res!: HTMLDivElement;
  private resT = 0;
  private shown = { total: -1, mult: -1 };

  private mount(): boolean {
    if (this.box) return true;
    const hud = document.querySelector('.hud');
    if (!hud) return false;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const box = this.box = document.createElement('div');
    box.className = 'combo';
    box.style.opacity = '0';
    const h = document.createElement('div'); h.className = 'head';
    this.head = document.createElement('span');
    this.mult = document.createElement('span'); this.mult.className = 'mult'; this.mult.hidden = true;
    h.append(this.head, this.mult);
    const bar = document.createElement('div'); bar.className = 'bar';
    this.bar = document.createElement('i'); bar.append(this.bar);
    this.liveEl = document.createElement('div'); this.liveEl.className = 'ln live'; this.liveEl.hidden = true;
    this.lines = document.createElement('div');
    this.res = document.createElement('div'); this.res.className = 'res';
    box.append(h, bar, this.liveEl, this.lines, this.res);
    hud.append(box);
    return true;
  }

  private row(kind: StuntKind, n: number, el?: HTMLDivElement): HTMLDivElement {
    const d = el ?? document.createElement('div');
    if (!el) d.className = 'ln';
    d.textContent = t(LABEL[kind] as 'stunt.near');
    const b = document.createElement('b'); b.textContent = `+${n}`;
    d.append(b);
    return d;
  }

  line(kind: StuntKind, n: number): void {
    if (!this.mount()) return;
    this.lines.prepend(this.row(kind, n));
    while (this.lines.children.length > 4) this.lines.lastChild!.remove();
    this.res.textContent = '';
  }

  /** A move still going on (driving into oncoming traffic): one line that counts up. */
  live(kind: StuntKind, n: number): void {
    if (!this.mount()) return;
    this.liveEl.hidden = false;
    this.row(kind, n, this.liveEl);
  }
  clearLive(): void { if (this.box) { this.liveEl.hidden = true; this.liveEl.textContent = ''; } }

  bank(total: number, cash: number): void {
    if (!this.mount()) return;
    this.res.className = 'res';
    this.res.textContent = t('stunt.bank', { n: total.toLocaleString(), cash });
    this.resT = 2.4;
  }
  lost(): void {
    if (!this.mount()) return;
    this.res.className = 'res bad';
    this.res.textContent = t('stunt.lost');
    this.resT = 2.4;
  }

  update(dt: number, c: { points: number; mult: number; count: number; timer: number }): void {
    if (!this.mount()) return;
    const on = c.count > 0 || !this.liveEl.hidden;
    if (this.resT > 0) this.resT -= dt;
    this.box!.style.opacity = on || this.resT > 0 ? '1' : '0';
    if (!on) {
      if (this.shown.total !== -1) { this.shown.total = -1; this.shown.mult = -1; this.head.textContent = ''; this.mult.hidden = true; this.lines.textContent = ''; this.bar.style.width = '0'; }
      return;
    }
    const total = Math.round(c.points * c.mult);
    if (total !== this.shown.total) { this.shown.total = total; this.head.textContent = total.toLocaleString(); }
    if (c.mult !== this.shown.mult) { this.shown.mult = c.mult; this.mult.textContent = `×${c.mult}`; this.mult.hidden = c.mult <= 1; }
    this.bar.style.width = `${Math.max(0, Math.min(1, c.timer / 4)) * 100}%`;
  }
}
