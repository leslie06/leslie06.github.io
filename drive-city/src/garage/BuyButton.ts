import { t } from '../core/I18n';
import { C, F, css, el } from '../ui/theme';

css(`
.hud .dc-buy{position:absolute;top:calc(var(--hud-y) + 35px);display:flex;align-items:center;gap:7px;height:33px;padding:0 12px;box-sizing:border-box;
  border:1px solid ${C.yellowDim};border-radius:17px;background:${C.inkGlass};color:${C.paper};font:800 14px/1 ${F.ui};letter-spacing:.04em;
  white-space:nowrap;cursor:pointer;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hud .dc-buy[hidden]{display:none}
.hud .dc-buy kbd{font:800 11px/1 ${F.num};padding:3px 5px;border-radius:4px;border:1px solid ${C.line};color:${C.muted}}
.hud .dc-buy.ready{background:${C.yellow};border-color:${C.yellow};color:${C.ink}}
.hud .dc-buy.ready kbd{border-color:rgba(16,19,21,.35);color:${C.ink}}
.hud .dc-buy.pulse{animation:dc-buy 1.1s ease-in-out 4}
@keyframes dc-buy{0%,100%{box-shadow:0 0 0 0 rgba(243,181,15,.7)}50%{box-shadow:0 0 0 9px rgba(243,181,15,0)}}
body.dc-touch .hud .dc-buy{top:calc(37px + env(safe-area-inset-top,0px));height:29px;padding:0 10px;font-size:13px}
body.dc-touch .hud .dc-buy kbd{display:none}
/* portrait: the four top buttons and the objective fill the row, so under the cash instead */
@media (max-width:600px){body.dc-touch .hud .dc-buy{top:calc(66px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px))!important}
  body.dc-touch .hud .cash-add{top:calc(102px + env(safe-area-inset-top,0px))}}
`);

/**
 * 「🚗 买车」 beside the cash (2026-10-21, 「重新设计下买车的入口，现在不明显」): the phone's 车行 was the last of eight
 * buttons in the 附近 panel. Money and buying go together, so it sits just left of the cash, kept there as the cash
 * grows; yellow once a car you do not own is affordable.
 */
export class BuyButton {
  readonly el: HTMLButtonElement;
  private cash: HTMLElement | null = null;
  private placed = '';
  private ready = false;

  constructor(hud: HTMLElement, touch: boolean, onClick: () => void) {
    this.el = el('button', 'dc-buy', hud);
    this.el.hidden = true;
    el('span', '', this.el).textContent = t('garage.buyButton');
    if (!touch) el('kbd', '', this.el).textContent = 'B';
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) this.el.addEventListener(ev, (e) => e.stopPropagation());
    this.el.addEventListener('click', onClick);
  }

  update(visible: boolean, ready: boolean): void {
    this.cash ??= this.el.parentElement?.querySelector<HTMLElement>('.cash') ?? null;
    const show = visible && !!this.cash?.offsetWidth;
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) return;
    // just left of the cash, whatever its width (measured only when its text changes)
    const key = this.cash!.textContent ?? '';
    if (key !== this.placed) {
      this.placed = key;
      const hud = this.el.parentElement!.getBoundingClientRect(), c = this.cash!.getBoundingClientRect();
      this.el.style.right = `${Math.round(hud.right - c.left + 10)}px`;
    }
    if (ready !== this.ready) {
      this.ready = ready;
      this.el.classList.toggle('ready', ready);
      this.el.classList.remove('pulse');
      if (ready) { void this.el.offsetWidth; this.el.classList.add('pulse'); }
    }
  }
}
