import { t } from '../core/I18n';
import { C, F, css, el } from '../ui/theme';
import { DEALER, NITRO, PAINTS, PRICE, TRANSFER, type LuxuryBody } from './Parts';
import type { ThumbLook } from './Thumbs';

css(`
.garage{position:fixed;inset:0;z-index:31;display:grid;place-items:center;font-family:${F.ui};color:${C.paper};
  background:radial-gradient(ellipse at center,rgba(9,11,13,.55),rgba(9,11,13,.82));padding:16px;box-sizing:border-box}
.garage[hidden]{display:none}
.garage .panel{width:min(560px,100%);max-height:100%;overflow:auto;padding:20px 22px;border-radius:12px;background:${C.inkGlass};border:1px solid ${C.line};backdrop-filter:blur(8px)}
.garage .top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px}
.garage h2{margin:0;font:900 26px/1 ${F.num};letter-spacing:.06em;color:${C.yellow}}
.garage .cash{font:800 22px/1 ${F.ui};color:#a6e38f;font-variant-numeric:tabular-nums}
.garage .sub{font:500 13px/1.5 ${F.ui};color:${C.muted};margin:6px 0 12px}
.garage .row{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid ${C.line}}
.garage .name{font:800 15px/1.2 ${F.ui}}
/* the 车行's rows lead with a picture of the car (2026-10-23) */
.garage .row.car{grid-template-columns:120px 64px 1fr auto}
.garage .pic{width:120px;height:68px;object-fit:contain;display:block}
.garage .what{font:500 13px/1.4 ${F.ui};color:${C.muted}}
.garage .pips{letter-spacing:3px;color:${C.yellow};margin-right:6px}
.garage button{font:800 14px/1 ${F.ui};cursor:pointer;border:0;border-radius:6px;padding:10px 14px;background:${C.yellow};color:${C.ink};white-space:nowrap}
.garage button:disabled{background:rgba(244,241,232,.12);color:${C.muted};cursor:default}
.garage .paints{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.garage .paints button{width:30px;height:30px;padding:0;border-radius:50%;border:2px solid rgba(244,241,232,.5)}
.garage .leave{margin-top:14px;width:100%;background:rgba(244,241,232,.14);color:${C.paper}}
.garage .note{font:600 13px/1.5 ${F.ui};color:${C.yellow};margin:0 0 8px}
/* Always on screen, whatever the panel's scroll (2026-10-19, a phone on its side: 「打开这个页面没有关闭按钮」). The screen sits over
   the map credit (z 30), which had covered the way out at the panel's foot. */
.garage .x{position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));z-index:1;
  width:42px;height:42px;padding:0;border-radius:50%;font:700 22px/1 ${F.ui};background:rgba(244,241,232,.16);color:${C.paper};
  border:1px solid ${C.line}}
/* A phone on its side is ~340 CSS px tall: tighter rows, and the way out pinned to the panel's foot. */
@media (max-height:470px){
  .garage{padding:6px}
  /* 100% of the screen's own height, not 100vh: on Android 100vh counts the strip the address bar covers, and the way
     out pinned to the panel's foot sat below the screen (2026-10-19) */
  .garage .panel{padding:8px 14px 0;max-height:100%}
  .garage h2{font-size:18px}.garage .cash{font-size:17px}
  .garage .sub{margin:2px 0 4px;font-size:11px}
  .garage .row{padding:3px 0;gap:8px}
  .garage .name{font-size:13px}.garage .what{font-size:11px}
  .garage .row.car{grid-template-columns:84px 56px 1fr auto}.garage .pic{width:84px;height:48px}
  .garage button{padding:7px 10px;font-size:12px}
  .garage .paints{gap:6px}.garage .paints button{width:22px;height:22px}
  .garage .leave{position:sticky;bottom:0;margin:6px 0 0;padding:9px;background:#2b2e31;box-shadow:0 -8px 12px rgba(12,14,16,.8)}
}
`);

/** `call:i` / `fetch:i`: your car `i` brought to the kerb (the phone) or into the garage. */
export type Item = 'engine' | 'tyres' | 'nitro' | 'repair' | 'paint' | 'impound' | 'dashcam' | 'transfer' | `car:${LuxuryBody}` | `call:${number}` | `fetch:${number}`;
export interface GarageView {
  cash: number;
  /** The car in the garage is one of your cars (the upgrades are on it). */
  mine: boolean;
  /** Not yours: the one of yours it would take the place of (its parts move across), if any. */
  replaces: string | null;
  hasProfile: boolean;
  /** One of your cars is at the pound (its name). */
  pound: string | null;
  /** It would take the place of the car at the pound: nothing is done to it until that one is back. */
  locked: boolean;
  /** Stages fitted to this car. */
  engine: number; tyres: number; nitro: number;
  /** Your parts (on your car), when you have a car: what buying moves onto this one. */
  carLevels: { engine: number; tyres: number; nitro: number } | null;
  health: number;
  taxi: boolean;
  /** 大刘's discount on the parts (0..1). */
  discount: number;
  /** A dashcam is fitted (the player's, whatever car: npc/'s scammers run from it). */
  dashcam: boolean;
  /** The car in the garage is a luxury car taken off the street: nothing is done to it before 过户. */
  stolen: LuxuryBody | null;
  /** Your cars' bodies (the 车行 marks the ones you have). */
  ownBodies: string[];
  /** Your other cars, free to swap into the garage. */
  others: { i: number; name: string }[];
}

/** The phone's 车行: your cars (one sent for, for a fee) and the ones for sale. */
export interface DealerView {
  cash: number;
  wanted: boolean;
  mine: { i: number; name: string; look: ThumbLook; levels: { engine: number; tyres: number; nitro: number }; state: 'pound' | 'driving' | 'call' }[];
  ownBodies: string[];
}

const pips = (n: number, of: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, of - n));

/** The garage screen: upgrades with their price, repairs, paint, the impound. Mouse and touch. */
export class GarageMenu {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  onBuy: (item: Item, paint?: string) => void = () => {};
  onClose: () => void = () => {};
  /** A picture of a car (garage/Thumbs): now if made, else null and `ready` later. Unset: rows without pictures. */
  thumb: ((look: ThumbLook, ready: (url: string) => void) => string | null) | null = null;

  constructor() {
    this.root = el('div', 'garage', document.body);
    this.root.hidden = true;
    this.panel = el('div', 'panel', this.root);
    const x = el('button', 'x', this.root);
    x.textContent = '×';
    x.setAttribute('aria-label', t('garage.leave'));
    x.addEventListener('click', () => this.onClose());
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
    sub.textContent = v.mine ? t('garage.yours') : v.replaces ? t('garage.moveParts', { car: v.replaces }) : v.hasProfile ? t('garage.addCar') : t('garage.firstCar');
    if (v.stolen) {
      const d = DEALER.find((x) => x.body === v.stolen)!, fee = Math.round(d.price * TRANSFER);
      el('div', 'note', p).textContent = t('garage.stolen');
      this.row(p, t('garage.transfer'), t('garage.transferWhat', { car: t(`car.${d.body}`) }), fee, v.cash >= fee, () => this.onBuy('transfer'));
    }
    if (v.pound) {
      el('div', 'note', p).textContent = t('garage.pound', { car: v.pound, n: PRICE.impound });
      this.row(p, t('garage.impound'), t('garage.impoundWhat'), PRICE.impound, v.cash >= PRICE.impound, () => this.onBuy('impound'));
    }
    // Buying moves your parts onto this car: show the stages you own, not this car's stock ones.
    const lv = v.mine ? v : v.carLevels ?? v;
    const stage = (key: 'engine' | 'tyres' | 'nitro', of: number, what: string) => {
      const have = lv[key], base = PRICE[key][have], price = base === undefined ? undefined : Math.round(base * (1 - v.discount));
      const label = price === undefined ? t('garage.max') : key === 'nitro' && have === 0 ? t('garage.fit') : t('garage.upgrade');
      this.row(p, t(`garage.${key}` as 'garage.engine'), `${pips(have, of)} ${what}`, price, price !== undefined && v.cash >= price && !v.locked && !v.stolen, () => this.onBuy(key), label);
    };
    stage('engine', 3, t('garage.engineWhat'));
    stage('tyres', 2, t('garage.tyresWhat'));
    stage('nitro', 3, lv.nitro > 0 ? t('garage.nitroWhat', { s: NITRO[lv.nitro] }) : t('garage.nitroNone'));
    const cost = Math.ceil((100 - v.health) * PRICE.repairPerPoint);
    this.row(p, t('garage.repair'), t('garage.repairWhat', { n: v.health }), v.health < 100 ? cost : undefined, v.health < 100 && v.cash >= cost, () => this.onBuy('repair'), v.health < 100 ? t('garage.fix') : t('garage.fine'));
    this.row(p, t('garage.dashcam'), t('garage.dashcamWhat'), v.dashcam ? undefined : PRICE.dashcam, !v.dashcam && v.cash >= PRICE.dashcam, () => this.onBuy('dashcam'), v.dashcam ? t('garage.dashcamHave') : t('garage.buy'));
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
    // Your other cars: one swapped into the garage, for nothing.
    if (v.others.length) {
      el('div', 'sub', p).textContent = t('garage.myCarsHome');
      for (const o of v.others) this.row(p, o.name, t('garage.fetchWhat'), undefined, true, () => this.onBuy(`fetch:${o.i}`), t('garage.fetch'));
    }
    // 车行: the luxury cars, new; the ones you own are marked.
    el('div', 'sub', p).textContent = t('garage.dealer');
    for (const d of DEALER) {
      const have = v.ownBodies.includes(d.body);
      this.row(p, t(`car.${d.body}`), t('garage.carWhat', { kmh: d.kmh, s: d.to100 }), have ? undefined : d.price, !have && v.cash >= d.price, () => this.onBuy(`car:${d.body}`), have ? t('garage.carHave') : t('garage.buy'));
    }
    const leave = el('button', 'leave', p);
    leave.textContent = t('garage.leave');
    leave.addEventListener('click', () => this.onClose());
  }

  /**
   * The 车行 on the phone (2026-10-19, 「现在买车只能回家在车库买吗？感觉不方便」): your cars, one sent for to the kerb
   * beside you for `PRICE.call` (2026-10-21), and the luxury cars you do not have yet, delivered there new. `wanted`: no
   * delivery while the police are after you.
   */
  renderDealer(v: DealerView): void {
    const p = this.panel;
    p.textContent = '';
    const top = el('div', 'top', p);
    el('h2', '', top).textContent = t('garage.dealerTitle');
    el('div', 'cash', top).textContent = `¥${v.cash.toLocaleString('en-US')}`;
    el('div', 'sub', p).textContent = t('garage.dealerSub');
    if (v.wanted) el('div', 'note', p).textContent = t('garage.dealerWanted');
    if (v.mine.length) {
      el('div', 'sub', p).textContent = t('garage.myCars');
      for (const m of v.mine) {
        const lv = t('garage.levels', { e: pips(m.levels.engine, 3), t: pips(m.levels.tyres, 2), n: pips(m.levels.nitro, 3) });
        if (m.state === 'call') {
          const short = v.cash < PRICE.call;
          this.row(p, m.name, lv, short ? undefined : PRICE.call, !v.wanted && !short, () => this.onBuy(`call:${m.i}`), short ? t('garage.short', { n: (PRICE.call - v.cash).toLocaleString('en-US') }) : t('garage.call'), m.look);
        } else this.row(p, m.name, m.state === 'pound' ? t('garage.inPoundWhat', { n: PRICE.impound }) : lv, undefined, false, () => {}, m.state === 'pound' ? t('garage.inPound') : t('garage.driving'), m.look);
      }
    }
    const sale = DEALER.filter((d) => !v.ownBodies.includes(d.body));
    if (sale.length) el('div', 'sub', p).textContent = t('garage.forSale');
    for (const d of sale) {
      // short of money: how much more, not a greyed-out price
      const short = v.cash < d.price;
      this.row(p, t(`car.${d.body}`), t('garage.carWhat', { kmh: d.kmh, s: d.to100 }) + (short ? ` · ¥${d.price.toLocaleString('en-US')}` : ''), short ? undefined : d.price, !v.wanted && !short, () => this.onBuy(`car:${d.body}`), short ? t('garage.short', { n: (d.price - v.cash).toLocaleString('en-US') }) : t('garage.order'),
        { body: d.body, upper: d.paint, lower: d.paint, taxi: false });
    }
    const leave = el('button', 'leave', p);
    leave.textContent = t('garage.dealerClose');
    leave.addEventListener('click', () => this.onClose());
  }

  private row(parent: HTMLElement, name: string, what: string, price: number | undefined, can: boolean, go: () => void, label = t('garage.buy'), car?: ThumbLook): void {
    const r = el('div', 'row', parent);
    if (car && this.thumb) {
      r.classList.add('car');
      const img = el('img', 'pic', r) as HTMLImageElement;
      img.alt = '';
      const url = this.thumb(car, (u) => { img.src = u; });
      if (url) img.src = url;
    }
    el('div', 'name', r).textContent = name;
    el('div', 'what', r).innerHTML = what.replace(/^([●○]+)/, '<span class="pips">$1</span>');
    const b = el('button', '', r);
    b.textContent = price === undefined ? label : `${label} ¥${price.toLocaleString('en-US')}`;
    b.disabled = !can;
    b.addEventListener('click', go);
  }
}
