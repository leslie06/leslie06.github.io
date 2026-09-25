import { t } from '../core/I18n';
import { C, F, css, el } from '../ui/theme';
import { NITRO, PAINTS, PRICE } from './Parts';

css(`
.garage{position:fixed;inset:0;z-index:25;display:grid;place-items:center;font-family:${F.ui};color:${C.paper};
  background:radial-gradient(ellipse at center,rgba(9,11,13,.55),rgba(9,11,13,.82));padding:16px;box-sizing:border-box}
.garage[hidden]{display:none}
.garage .panel{width:min(560px,100%);max-height:100%;overflow:auto;padding:20px 22px;border-radius:12px;background:${C.inkGlass};border:1px solid ${C.line};backdrop-filter:blur(8px)}
.garage .top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px}
.garage h2{margin:0;font:900 26px/1 ${F.num};letter-spacing:.06em;color:${C.yellow}}
.garage .cash{font:800 22px/1 ${F.ui};color:#a6e38f;font-variant-numeric:tabular-nums}
.garage .sub{font:500 13px/1.5 ${F.ui};color:${C.muted};margin:6px 0 12px}
.garage .row{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid ${C.line}}
.garage .name{font:800 15px/1.2 ${F.ui}}
.garage .what{font:500 13px/1.4 ${F.ui};color:${C.muted}}
.garage .pips{letter-spacing:3px;color:${C.yellow};margin-right:6px}
.garage button{font:800 14px/1 ${F.ui};cursor:pointer;border:0;border-radius:6px;padding:10px 14px;background:${C.yellow};color:${C.ink};white-space:nowrap}
.garage button:disabled{background:rgba(244,241,232,.12);color:${C.muted};cursor:default}
.garage .paints{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.garage .paints button{width:30px;height:30px;padding:0;border-radius:50%;border:2px solid rgba(244,241,232,.5)}
.garage .leave{margin-top:14px;width:100%;background:rgba(244,241,232,.14);color:${C.paper}}
.garage .note{font:600 13px/1.5 ${F.ui};color:${C.yellow};margin:0 0 8px}
/* A phone on its side is ~340 CSS px tall: tighter rows, and the way out pinned to the panel's foot. */
@media (max-height:470px){
  .garage{padding:6px}
  .garage .panel{padding:8px 14px 0;max-height:calc(100vh - 12px)}
  .garage h2{font-size:18px}.garage .cash{font-size:17px}
  .garage .sub{margin:2px 0 4px;font-size:11px}
  .garage .row{padding:3px 0;gap:8px}
  .garage .name{font-size:13px}.garage .what{font-size:11px}
  .garage button{padding:7px 10px;font-size:12px}
  .garage .paints{gap:6px}.garage .paints button{width:22px;height:22px}
  .garage .leave{position:sticky;bottom:0;margin:6px 0 0;padding:9px;box-shadow:0 -8px 12px rgba(12,14,16,.8)}
}
`);

type Item = 'engine' | 'tyres' | 'nitro' | 'repair' | 'paint' | 'impound';
export interface GarageView {
  cash: number;
  /** The car in the garage is your car (the upgrades are on it). */
  mine: boolean;
  hasProfile: boolean;
  impounded: boolean;
  /** Stages fitted to this car. */
  engine: number; tyres: number; nitro: number;
  /** Your parts (on your car), when you have a car: what buying moves onto this one. */
  carLevels: { engine: number; tyres: number; nitro: number } | null;
  health: number;
  taxi: boolean;
}

const pips = (n: number, of: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, of - n));

/** The garage screen: upgrades with their price, repairs, paint, the impound. Mouse and touch. */
export class GarageMenu {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  onBuy: (item: Item, paint?: string) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.root = el('div', 'garage', document.body);
    this.root.hidden = true;
    this.panel = el('div', 'panel', this.root);
    // Taps must not fall through to the touch controls or the canvas behind.
    for (const ev of ['pointerdown', 'touchstart', 'mousedown'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
  }

  show(): void { this.root.hidden = false; }
  hide(): void { this.root.hidden = true; }

  render(v: GarageView): void {
    const p = this.panel;
    p.textContent = '';
    const top = el('div', 'top', p);
    el('h2', '', top).textContent = t('garage.title');
    el('div', 'cash', top).textContent = `¥${v.cash.toLocaleString('en-US')}`;
    const sub = el('div', 'sub', p);
    sub.textContent = v.mine ? t('garage.yours') : v.hasProfile ? t('garage.moveParts') : t('garage.firstCar');
    if (v.impounded) {
      el('div', 'note', p).textContent = t('garage.pound', { n: PRICE.impound });
      this.row(p, t('garage.impound'), t('garage.impoundWhat'), PRICE.impound, v.cash >= PRICE.impound, () => this.onBuy('impound'));
    }
    // Buying moves your parts onto this car: show the stages you own, not this car's stock ones.
    const lv = v.mine ? v : v.carLevels ?? v;
    const stage = (key: 'engine' | 'tyres' | 'nitro', of: number, what: string) => {
      const have = lv[key], price = PRICE[key][have];
      const label = price === undefined ? t('garage.max') : key === 'nitro' && have === 0 ? t('garage.fit') : t('garage.upgrade');
      this.row(p, t(`garage.${key}` as 'garage.engine'), `${pips(have, of)} ${what}`, price, price !== undefined && v.cash >= price && !v.impounded, () => this.onBuy(key), label);
    };
    stage('engine', 3, t('garage.engineWhat'));
    stage('tyres', 2, t('garage.tyresWhat'));
    stage('nitro', 3, lv.nitro > 0 ? t('garage.nitroWhat', { s: NITRO[lv.nitro] }) : t('garage.nitroNone'));
    const cost = Math.ceil((100 - v.health) * PRICE.repairPerPoint);
    this.row(p, t('garage.repair'), t('garage.repairWhat', { n: v.health }), v.health < 100 ? cost : undefined, v.health < 100 && v.cash >= cost, () => this.onBuy('repair'), v.health < 100 ? t('garage.fix') : t('garage.fine'));
    // Paint: one swatch per colour.
    const r = el('div', 'row', p);
    el('div', 'name', r).textContent = t('garage.paint');
    const sw = el('div', 'paints', r);
    for (const c of PAINTS) {
      const b = el('button', '', sw);
      b.style.background = c;
      b.disabled = v.cash < PRICE.paint;
      b.title = `¥${PRICE.paint}`;
      b.addEventListener('click', () => this.onBuy('paint', c));
    }
    el('div', 'what', r).textContent = `¥${PRICE.paint}${v.taxi ? ' · ' + t('garage.paintTaxi') : ''}`;
    const leave = el('button', 'leave', p);
    leave.textContent = t('garage.leave');
    leave.addEventListener('click', () => this.onClose());
  }

  private row(parent: HTMLElement, name: string, what: string, price: number | undefined, can: boolean, go: () => void, label = t('garage.buy')): void {
    const r = el('div', 'row', parent);
    el('div', 'name', r).textContent = name;
    el('div', 'what', r).innerHTML = what.replace(/^([●○]+)/, '<span class="pips">$1</span>');
    const b = el('button', '', r);
    b.textContent = price === undefined ? label : `${label} ¥${price.toLocaleString('en-US')}`;
    b.disabled = !can;
    b.addEventListener('click', go);
  }
}
