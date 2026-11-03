import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { UiApi } from '../ui';
import { C, F, css, el } from '../ui/theme';

css(`
.nl-panel{position:fixed;inset:0;z-index:45;background:rgba(4,8,12,.6);display:grid;place-items:center;padding:16px;box-sizing:border-box;font-family:${F.ui};color:${C.paper};touch-action:pan-y}
.nl-panel[hidden],.nl-photo[hidden]{display:none}
.nl-panel .sheet{width:min(460px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:18px 18px 16px;border-radius:14px;
  background:linear-gradient(#2a1612,#1a0f0c);border:1px solid rgba(212,175,85,.45);box-shadow:0 18px 70px #000a}
.nl-panel .sign{display:inline-block;padding:6px 16px;border:2px solid #a9883c;border-radius:4px;background:#121212;color:#d4af55;font:800 20px/1.2 "Songti SC","STSong","SimSun",serif;letter-spacing:4px}
.nl-panel .greet{margin:12px 0 4px;color:${C.paper};font-size:14px;line-height:1.6}
.nl-panel .cash{color:${C.muted};font:600 13px/1 ${F.num};margin:8px 0 12px}
.nl-panel .items{display:grid;gap:8px}
.nl-panel button{min-height:48px;padding:9px 12px;border-radius:8px;border:1px solid rgba(212,175,85,.3);background:#31201a;color:${C.paper};font:700 15px/1.3 ${F.ui};
  cursor:pointer;text-align:left;display:grid;grid-template-columns:1fr auto;gap:2px 12px;touch-action:manipulation}
.nl-panel button .d{grid-column:1;font:500 12px/1.3 ${F.ui};color:${C.muted}}
.nl-panel button .p{grid-row:1 / span 2;grid-column:2;align-self:center;font:800 16px/1 ${F.num};color:#e2c066}
.nl-panel button:hover:not(:disabled){border-color:#e2c066}.nl-panel button:focus-visible{outline:2px solid ${C.yellow};outline-offset:2px}
.nl-panel button:disabled{opacity:.5;cursor:default}.nl-panel button:disabled .p{color:${C.red};font-size:12px}
.nl-panel .leave{margin-top:12px;display:block;width:100%;text-align:center;background:transparent;grid-template-columns:1fr}
@media(max-height:470px){.nl-panel{padding:8px}.nl-panel .sheet{max-height:calc(100dvh - 16px);padding:12px}.nl-panel .greet{margin:8px 0 2px}}
.nl-photo{position:fixed;inset:0;z-index:46;background:rgba(4,8,12,.55);display:grid;place-items:center;padding:16px;box-sizing:border-box}
.nl-photo .card{background:#f2ecdf;padding:12px 12px 10px;box-shadow:0 14px 40px rgba(0,0,0,.55);transform:rotate(-1.5deg);max-width:min(420px,100%);box-sizing:border-box}
.nl-photo canvas{display:block;width:100%;height:auto;background:#3a2e22}
.nl-photo .cap{padding:10px 4px 4px;text-align:center;color:#3b2a1b;font-family:"Kaiti SC","STKaiti","KaiTi",serif}
.nl-photo .zh{font-size:22px;font-weight:700;letter-spacing:4px}.nl-photo .date{font:600 12px ${F.num};color:#7b6c58;margin-top:2px}
.nl-photo .acts{display:flex;gap:8px;margin-top:10px}
.nl-photo button{flex:1;min-height:44px;border-radius:8px;border:1px solid #b8a888;background:#e8dfcc;color:#3b2a1b;font:700 14px ${F.ui};cursor:pointer;touch-action:manipulation}
.nl-photo button.main{background:#3b2a1b;color:#f2ecdf;border-color:#3b2a1b}
@media(max-height:560px){.nl-photo{padding:8px}.nl-photo .card{display:flex;align-items:center;gap:14px;max-width:none;padding:10px}
  .nl-photo canvas{height:calc(100dvh - 40px);width:auto}.nl-photo .side{width:170px}.nl-photo .acts{flex-direction:column}}
`);

export interface Row { label: string; detail: string; price: string; disabled: boolean; buy(): void }

/** A modal the world pauses under (the garage's and the adventure panel's way): `ui.overlay` plus `engine.paused`. */
abstract class Modal {
  abstract readonly root: HTMLDivElement;
  protected closed?: () => void;
  constructor(protected engine: Engine) {
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.open) return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
      this.key(e);
    }, true);
  }
  protected key(_e: KeyboardEvent): void {}
  get open(): boolean { return !!this.root && !this.root.hidden; }
  protected show(onClose?: () => void): boolean {
    const ui = this.engine.get<UiApi>('ui');
    if (ui?.state !== 'playing') return false;
    ui.overlay(true); this.engine.paused = true;
    this.engine.events.emit('game:pause', { paused: true });
    this.root.hidden = false;
    this.closed = onClose;
    return true;
  }
  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.engine.paused = false;
    this.engine.events.emit('game:pause', { paused: false });
    this.engine.get<UiApi>('ui')?.overlay(false);
    const c = this.closed; this.closed = undefined;
    c?.();
  }
}

/** The counter: the shop's board, what the keeper says, the cash, a button for each thing on sale (keys 1-9 too). */
export class ShopPanel extends Modal {
  readonly root: HTMLDivElement;
  private sign: HTMLDivElement; private greet: HTMLDivElement; private cash: HTMLDivElement; private items: HTMLDivElement;
  private leave: HTMLButtonElement;
  private rows: Row[] = [];
  constructor(engine: Engine) {
    super(engine);
    this.root = el('div', 'nl-panel', document.body); this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true');
    const sheet = el('div', 'sheet', this.root);
    this.sign = el('div', 'sign', sheet);
    this.greet = el('div', 'greet', sheet);
    this.cash = el('div', 'cash', sheet);
    this.items = el('div', 'items', sheet);
    this.leave = el('button', 'leave', sheet); this.leave.type = 'button';
    this.leave.addEventListener('click', () => this.close());
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
  }
  protected key(e: KeyboardEvent): void {
    const n = Number(e.key);
    if (n >= 1 && n <= this.rows.length && !this.rows[n - 1].disabled) { e.preventDefault(); e.stopImmediatePropagation(); this.rows[n - 1].buy(); }
  }
  /** Open (or redraw while open) with these contents. */
  render(sign: string, greet: string, cash: number, rows: Row[], onClose?: () => void): boolean {
    if (!this.open && !this.show(onClose)) return false;
    this.rows = rows;
    this.sign.textContent = sign;
    this.greet.textContent = greet;
    this.cash.textContent = t('nl.panel.cash', { n: cash });
    this.leave.textContent = t('nl.panel.close');
    this.items.replaceChildren();
    rows.forEach((r, i) => {
      const b = el('button', '', this.items); b.type = 'button'; b.disabled = r.disabled;
      el('span', 'n', b).textContent = `${i + 1}. ${r.label}`;
      el('span', 'p', b).textContent = r.price;
      el('span', 'd', b).textContent = r.detail;
      b.addEventListener('click', () => r.buy());
    });
    (this.items.querySelector('button:not(:disabled)') as HTMLButtonElement | null ?? this.leave).focus();
    return true;
  }
}

/** The studio's print: the frame toned sepia, the studio's name and the date, a button to save it. */
export class PhotoCard extends Modal {
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private zh: HTMLDivElement; private date: HTMLDivElement; private save: HTMLButtonElement; private done: HTMLButtonElement;
  constructor(engine: Engine) {
    super(engine);
    this.root = el('div', 'nl-photo', document.body); this.root.hidden = true;
    const card = el('div', 'card', this.root);
    this.canvas = el('canvas', '', card); this.canvas.width = 480; this.canvas.height = 600;
    // caption and buttons below the print, or beside it on a short (landscape phone) screen
    const side = el('div', 'side', card);
    const cap = el('div', 'cap', side);
    this.zh = el('div', 'zh', cap); this.date = el('div', 'date', cap);
    const acts = el('div', 'acts', side);
    this.save = el('button', '', acts); this.save.type = 'button';
    this.done = el('button', 'main', acts); this.done.type = 'button';
    this.save.addEventListener('click', () => this.download());
    this.done.addEventListener('click', () => this.close());
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) this.root.addEventListener(ev, (e) => e.stopPropagation());
  }
  /** Show the canvas as it now is. */
  present(onClose?: () => void): boolean {
    if (!this.show(onClose)) return false;
    this.zh.textContent = t('nl.photo.card');
    const d = new Date();
    this.date.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} · ${t('nl.name')}`;
    this.save.textContent = t('nl.photo.save');
    this.done.textContent = t('nl.photo.close');
    this.done.focus();
    return true;
  }
  private download(): void {
    try {
      const a = document.createElement('a');
      a.href = this.canvas.toDataURL('image/jpeg', 0.9);
      a.download = `nanluoguxiang-${Date.now()}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch { /* a tainted canvas or no downloads: nothing to save */ }
  }
}

/** Tone the canvas as an old print: sepia, a little grain, a soft vignette, a white border. */
export function agePrint(cv: HTMLCanvasElement, seed = 1): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const { width: w, height: h } = cv;
  const img = g.getImageData(0, 0, w, h), d = img.data;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const vx = (x / w - 0.5) * 2, vy = (y / h - 0.5) * 2, v = 1 - 0.35 * Math.min(1, (vx * vx + vy * vy) * 0.6);
    const n = (rnd() - 0.5) * 18;
    const k = Math.min(255, (l * 1.05 + 12) * v + n);
    d[i] = Math.min(255, k * 1.07 + 10); d[i + 1] = Math.min(255, k * 0.9 + 6); d[i + 2] = Math.min(255, k * 0.68);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#efe7d6'; g.lineWidth = 14; g.strokeRect(0, 0, w, h);
}
