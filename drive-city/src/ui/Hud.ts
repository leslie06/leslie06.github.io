import type { Engine } from '../core/Engine';
import { onLangChange, t } from '../core/I18n';
import type { CameraApi, HudApi, PlayerApi, VehicleApi, WorldApi, ParkApi } from '../game/Contracts';
import { C, F, css, el } from './theme';
import { L } from './lang';

css(`
.hud{position:fixed;inset:0;pointer-events:none;font-family:${F.ui};color:${C.paper};user-select:none;z-index:10}
.hud[hidden]{display:none}
.hud .speedo{position:absolute;right:max(24px,3vw);bottom:max(18px,3vh);width:196px;height:196px}
.hud .speedo svg{position:absolute;inset:0;overflow:visible;filter:drop-shadow(0 2px 8px rgba(0,0,0,.45))}
.hud .speedo .dial{position:absolute;inset:26px;border-radius:50%;background:radial-gradient(circle,rgba(10,12,14,.62) 0%,rgba(10,12,14,.38) 70%,rgba(10,12,14,0) 72%)}
.hud .speedo .num{position:absolute;left:0;right:0;top:62px;text-align:center;font:800 54px/1 ${F.num};font-variant-numeric:tabular-nums;letter-spacing:-.02em;text-shadow:0 2px 12px rgba(0,0,0,.45)}
.hud .speedo .num .lead{color:rgba(244,241,232,.25)}
.hud .speedo .unit{position:absolute;left:0;right:0;top:120px;text-align:center;font:700 10px/1 ${F.num};letter-spacing:.24em;color:${C.muted}}
.hud .speedo .gear{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);width:34px;height:34px;border:2px solid ${C.yellow};border-radius:6px;display:grid;place-items:center;font:800 19px/1 ${F.num};color:${C.yellow};background:rgba(10,12,14,.6)}
.hud .speedo .gear.flash{background:${C.yellow};color:${C.ink}}
.hud .drift{position:absolute;left:50%;top:8vh;transform:translateX(-50%);text-align:center;transition:opacity .25s}
.hud .drift .label{font:800 14px/1 ${F.ui};letter-spacing:.3em;color:${C.yellow};text-shadow:0 1px 8px rgba(0,0,0,.5)}
.hud .drift .score{font:800 46px/1.1 ${F.num};font-variant-numeric:tabular-nums;text-shadow:0 2px 14px rgba(0,0,0,.5)}
.hud .drift .mult{display:inline-block;margin-left:10px;padding:2px 8px;border-radius:4px;background:${C.yellow};color:${C.ink};font:800 18px/1.2 ${F.num};vertical-align:middle}
.hud .drift .bar{margin:8px auto 0;width:220px;height:4px;background:rgba(244,241,232,.2);border-radius:2px;overflow:hidden}
.hud .drift .bar i{display:block;height:100%;background:${C.yellow};width:0}
.hud .drift .result{display:inline-block;margin-top:6px;padding:6px 14px;border-radius:6px;background:rgba(10,12,14,.66);font:800 20px/1.2 ${F.num};color:${C.yellow};letter-spacing:.02em}
.hud .drift .result:empty{display:none}
.hud .drift .result.bad{color:${C.red}}
.hud .best{position:absolute;left:max(24px,3vw);top:max(20px,3vh);font:700 12px/1 ${F.num};letter-spacing:.18em;color:${C.muted}}
.hud .best b{color:${C.paper};font-size:15px;letter-spacing:.04em;margin-left:6px;font-variant-numeric:tabular-nums}
.hud .hint{position:absolute;left:max(24px,3vw);top:calc(max(20px,3vh) + 26px);font:600 12px/1 ${F.ui};color:${C.muted};letter-spacing:.06em}
.hud .street{position:absolute;right:max(24px,3vw);bottom:calc(max(18px,3vh) + 206px);text-align:right;font:800 22px/1.2 ${F.ui};letter-spacing:.06em;color:${C.paper};text-shadow:0 2px 10px rgba(0,0,0,.6);opacity:0;transition:opacity .6s}
.hud .street.on{opacity:1}
.hud .prompt{position:absolute;left:50%;bottom:17vh;transform:translateX(-50%);padding:9px 16px;border-radius:6px;background:${C.inkGlass};font:800 15px/1 ${F.ui};letter-spacing:.08em;border-left:3px solid ${C.yellow}}
.hud .toast{position:absolute;left:50%;bottom:22vh;transform:translateX(-50%);padding:9px 16px;border-radius:6px;background:${C.inkGlass};font:700 14px/1 ${F.ui};letter-spacing:.08em;opacity:0;transition:opacity .2s}
.hud .toast.on{opacity:1}
.hud .flipped{position:absolute;left:50%;top:42%;transform:translateX(-50%);padding:12px 20px;border-radius:8px;background:${C.inkGlass};font:700 18px/1 ${F.ui};border-left:3px solid ${C.yellow}}
.hud .help{position:absolute;left:max(24px,3vw);top:calc(max(20px,3vh) + 58px);padding:14px 16px;border-radius:8px;background:${C.inkGlass};font:500 13px/1.9 ${F.ui};min-width:260px}
/* The radar sits in the top-left corner (see Minimap.ts), so these stack below it. Only when a
   radar exists: the yard has no nav, and would otherwise leave the corner empty. */
body.dc-radar .hud .best{top:calc(var(--mm-top) + var(--mm-h) + 14px)}
body.dc-radar .hud .hint{top:calc(var(--mm-top) + var(--mm-h) + 40px)}
body.dc-radar .hud .help{top:calc(var(--mm-top) + var(--mm-h) + 72px)}
.hud .help kbd{display:inline-block;min-width:22px;padding:0 6px;margin-right:6px;border-radius:4px;border:1px solid ${C.line};background:rgba(244,241,232,.08);font:700 11px/20px ${F.mono};text-align:center;color:${C.paper}}
.hud .help .row{display:flex;justify-content:space-between;gap:18px}
.hud .help .row span:last-child{color:${C.muted}}
`);

// 270° dial: from bottom-left, clockwise over the top, to bottom-right (SVG y points down).
const R = 84, CX = 98, CY = 98, A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
function arc(frac: number, from = 0): string {
  const a0 = A0 + (A1 - A0) * from, a = A0 + (A1 - A0) * frac;
  const x0 = CX + Math.cos(a0) * R, y0 = CY + Math.sin(a0) * R;
  const x1 = CX + Math.cos(a) * R, y1 = CY + Math.sin(a) * R;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${a - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export class Hud implements HudApi {
  name = 'hud';
  readonly root: HTMLDivElement;
  private num: HTMLDivElement;
  private gear: HTMLDivElement;
  private rpmPath: SVGPathElement;
  private driftBox: HTMLDivElement;
  private driftScore: HTMLSpanElement;
  private driftMult: HTMLSpanElement;
  private driftBar: HTMLElement;
  private driftResult: HTMLDivElement;
  private driftLabel: HTMLDivElement;
  private bestNum: HTMLElement;
  private toastEl: HTMLDivElement;
  private flipped: HTMLDivElement;
  private help: HTMLDivElement;
  private toastT = 0;
  private lastGear = 1;
  private gearFlash = 0;
  private lastCam = '';
  private visible = true;
  /** Last values written to the DOM, so a frame that changes nothing writes nothing. */
  private shown = { kmh: -1, rpm: -1, red: false, gear: '', best: '', score: -1, mult: -1, angle: -1 };
  private bestEl: HTMLElement;
  private streetEl: HTMLDivElement;
  private street = '';
  private streetT = 0;
  private streetPoll = 0;
  private promptEl!: HTMLDivElement;
  private rideEl!: HTMLDivElement;
  private rideOffEl!: HTMLDivElement;
  private speedoEl!: HTMLDivElement;

  constructor(private engine: Engine, container: HTMLElement) {
    const root = this.root = el('div', 'hud', container);
    const speedo = el('div', 'speedo', root);
    el('div', 'dial', speedo);
    const ticks = Array.from({ length: 8 }, (_, i) => {
      const a = A0 + (A1 - A0) * (i / 7);
      return `<line x1="${(CX + Math.cos(a) * (R - 11)).toFixed(1)}" y1="${(CY + Math.sin(a) * (R - 11)).toFixed(1)}" x2="${(CX + Math.cos(a) * (R - 5)).toFixed(1)}" y2="${(CY + Math.sin(a) * (R - 5)).toFixed(1)}" stroke="rgba(244,241,232,.45)" stroke-width="2"/>`;
    }).join('');
    const red = 6300 / 6800;
    speedo.innerHTML += `<svg viewBox="0 0 196 196"><path d="${arc(1)}" fill="none" stroke="rgba(244,241,232,.16)" stroke-width="6" stroke-linecap="round"/>
      <path d="${arc(1, red)}" fill="none" stroke="${C.red}" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>${ticks}
      <path class="rpm" d="${arc(0)}" fill="none" stroke="${C.yellow}" stroke-width="6" stroke-linecap="round"/></svg>`;
    this.rpmPath = speedo.querySelector('.rpm') as SVGPathElement;
    this.num = el('div', 'num', speedo);
    const unit = el('div', 'unit', speedo); unit.appendChild(L('hud.kmh'));
    this.gear = el('div', 'gear', speedo);
    this.driftBox = el('div', 'drift', root);
    this.driftLabel = el('div', 'label', this.driftBox); this.driftLabel.appendChild(L('hud.drift'));
    const sc = el('div', 'score', this.driftBox);
    this.driftScore = el('span', '', sc);
    this.driftMult = el('span', 'mult', sc);
    const bar = el('div', 'bar', this.driftBox); this.driftBar = el('i', '', bar);
    this.driftResult = el('div', 'result', this.driftBox);
    this.driftBox.style.opacity = '0';
    this.bestEl = el('div', 'best', root);
    this.bestNum = document.createElement('b');
    onLangChange(() => { this.shown.best = ''; });
    const hint = el('div', 'hint', root); hint.appendChild(L('hud.helpHint'));
    this.toastEl = el('div', 'toast', root);
    this.streetEl = el('div', 'street', root);
    this.promptEl = el('div', 'prompt', root);
    this.promptEl.appendChild(L('hud.enterCar'));
    this.promptEl.hidden = true;
    this.rideEl = el('div', 'prompt', root);
    this.rideEl.appendChild(L('hud.ride'));
    this.rideEl.hidden = true;
    this.rideOffEl = el('div', 'prompt', root);
    this.rideOffEl.appendChild(L('hud.rideOff'));
    this.rideOffEl.hidden = true;
    this.speedoEl = root.querySelector('.speedo') as HTMLDivElement;
    this.flipped = el('div', 'flipped', root); this.flipped.appendChild(L('hud.flipped')); this.flipped.hidden = true;
    this.help = el('div', 'help', root);
    this.help.hidden = true;
    const rows: [string, Parameters<typeof L>[0]][] = [['W S', 'ctl.drive'], ['A D', 'ctl.steer'], ['@key.space', 'ctl.handbrake'], ['V', 'ctl.camera'], ['C', 'ctl.lookBack'], ['E', 'ctl.horn'], ['R', 'ctl.reset'], ['F', 'ctl.enter'], ['Shift', 'ctl.sprint'], ['LMB', 'ctl.shove'], ['Tab', 'ctl.map'], ['W+S', 'ctl.burnout'], ['M', 'ctl.mute'], ['Esc', 'ctl.pause']];
    for (const [k, key] of rows) {
      const r = el('div', 'row', this.help);
      const a = el('span', '', r);
      for (const x of k.split(' ')) { const kb = el('kbd', '', a); kb.append(x.startsWith('@') ? L(x.slice(1) as 'key.space') : x); }
      const b = el('span', '', r); b.appendChild(L(key));
    }
    engine.events.on('drift:end', ({ score, crashed }) => {
      this.driftResult.textContent = crashed ? t('hud.driftLost') : t('hud.driftBank', { n: score.toLocaleString() });
      this.driftResult.className = crashed ? 'result bad' : 'result';
    });
  }

  setVisible(v: boolean): void { this.visible = v; this.root.hidden = !v; }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    this.toastT = 1.6;
  }

  update(dt: number): void {
    const v = this.engine.get<VehicleApi>('vehicle');
    if (!v || !this.visible) return;
    const inp = this.engine.input.state;
    if (inp.helpPressed) this.help.hidden = !this.help.hidden;
    const car = v.car;
    const sh = this.shown;
    const kmh = Math.round(Math.abs(car.forwardSpeed) * 3.6);
    if (kmh !== sh.kmh) {
      sh.kmh = kmh;
      const s = String(kmh).padStart(3, '0');
      const lz = Math.min(s.match(/^0*/)?.[0].length ?? 0, 2);
      this.num.innerHTML = `<span class="lead">${s.slice(0, lz)}</span>${s.slice(lz)}`;
    }
    const g = car.gear === -1 ? t('hud.gearR') : String(car.gear);
    if (car.gear !== this.lastGear) { this.lastGear = car.gear; this.gearFlash = 0.18; }
    this.gearFlash = Math.max(0, this.gearFlash - dt);
    if (g !== sh.gear) { sh.gear = g; this.gear.textContent = g; }
    this.gear.classList.toggle('flash', this.gearFlash > 0);
    const e = car.spec.engine;
    const rpmQ = Math.round(Math.max(0.001, Math.min(1, car.rpm / e.redline)) * 200);
    if (rpmQ !== sh.rpm) { sh.rpm = rpmQ; this.rpmPath.setAttribute('d', arc(rpmQ / 200)); }
    const red = car.rpm > e.shiftUp;
    if (red !== sh.red) { sh.red = red; this.rpmPath.setAttribute('stroke', red ? C.red : C.yellow); }

    const d = v.drift;
    const since = this.engine.time - d.lastAt;
    const showResult = !d.active && since < 2.2 && d.lastAt > 0;
    this.driftBox.style.opacity = d.active || showResult ? '1' : '0';
    if (d.active) {
      const score = Math.round(d.score), ang = Math.round(d.angle);
      if (score !== sh.score) { sh.score = score; this.driftScore.textContent = score.toLocaleString(); }
      if (d.multiplier !== sh.mult) {
        sh.mult = d.multiplier;
        this.driftMult.textContent = `×${d.multiplier}`;
        this.driftMult.style.display = d.multiplier > 1 ? '' : 'none';
      }
      if (ang !== sh.angle) { sh.angle = ang; this.driftBar.style.width = `${Math.min(100, ang / 60 * 100)}%`; }
      if (this.driftResult.textContent) this.driftResult.textContent = '';
    } else if (showResult && sh.score !== -1) {
      sh.score = -1; sh.mult = -1; sh.angle = -1;
      this.driftScore.textContent = ''; this.driftMult.style.display = 'none'; this.driftBar.style.width = '0';
    }
    const best = d.best > 0 ? d.best.toLocaleString() : '—';
    if (best !== sh.best) {
      sh.best = best;
      this.bestEl.textContent = t('hud.best', { n: '' }).trim() + ' ';
      this.bestNum.textContent = best;
      this.bestEl.append(this.bestNum);
    }

    // GTA-style street name: shown for a few seconds whenever the road under the car changes.
    this.streetPoll -= dt;
    if (this.streetPoll <= 0) {
      this.streetPoll = 0.5;
      const where = this.engine.get<PlayerApi>('player')?.position ?? car.pos;
      const name = this.engine.get<WorldApi>('world')?.placeName?.(where.x, where.z) ?? '';
      if (name && name !== this.street) { this.street = name; this.streetEl.textContent = name; this.streetT = 4.5; }
    }
    this.streetT -= dt;
    this.streetEl.classList.toggle('on', this.streetT > 0);
    const pl = this.engine.get<PlayerApi>('player');
    const onFoot = pl?.mode === 'onfoot';
    this.speedoEl.hidden = onFoot;
    // A fairground ride in reach takes the prompt over from the get-in-the-car one.
    const park = this.engine.get<ParkApi>('park');
    this.rideEl.hidden = park?.prompt !== 'board';
    this.rideOffEl.hidden = park?.prompt !== 'exit';
    this.promptEl.hidden = !(onFoot && pl?.nearCar) || !!park?.prompt;
    this.flipped.hidden = onFoot || !(car.flippedTime > 1.2);
    const cam = this.engine.get<CameraApi>('camera');
    if (cam && cam.mode !== this.lastCam) {
      if (this.lastCam) this.toast(t(`hud.camera.${cam.mode}` as 'hud.camera.chase'));
      this.lastCam = cam.mode;
    }
    if (inp.mutePressed) { /* audio flips first in boot order */ setTimeout(() => this.toast(t((this.engine.get<{ name: string; muted: boolean }>('audio')?.muted ? 'hud.muted' : 'hud.unmuted'))), 0); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('on'); }
  }
}
