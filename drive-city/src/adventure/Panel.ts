import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { UiApi } from '../ui';
import { C, F, css, el } from '../ui/theme';
export interface Action { label: string; run(): void; disabled?: boolean }
export interface Card { title: string; status: string; detail: string; inventory: string; actions: Action[] }
css(`
.adventure-open{position:fixed;left:var(--hud-x);top:calc(var(--mm-top,18px) + var(--mm-h,0px) + 62px);z-index:26;border:1px solid ${C.yellowDim};border-radius:8px;padding:9px 12px;background:${C.inkGlass};color:${C.paper};font:700 13px/1.2 ${F.ui};cursor:pointer;min-height:44px}
.adventure-open[hidden],.adventure-panel[hidden]{display:none}
body.dc-touch .adventure-open{display:none}
.adventure-panel{position:fixed;inset:0;z-index:45;background:rgba(4,8,12,.76);display:grid;place-items:center;padding:16px;box-sizing:border-box;font-family:${F.ui};color:${C.paper};touch-action:pan-y}
.adventure-panel .sheet{width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid ${C.line};border-radius:16px;background:#121b23;box-shadow:0 18px 70px #0008}
.adventure-panel .head{display:flex;justify-content:space-between;align-items:center;gap:12px;color:${C.yellow};font-weight:800}
.adventure-panel h2{font-size:25px;margin:20px 0 12px}.adventure-panel p{font-size:14px;line-height:1.65;margin:10px 0;color:${C.muted}}
.adventure-panel .status{color:${C.paper};font-weight:700}.adventure-panel .inventory{color:#8ed4ff;font-size:12px}
.adventure-panel .actions{display:grid;gap:8px;margin-top:18px}
.adventure-panel button{min-height:46px;padding:10px 14px;border-radius:8px;border:1px solid ${C.line};background:#22303d;color:${C.paper};font:700 14px/1.4 ${F.ui};cursor:pointer;text-align:left;touch-action:manipulation}
.adventure-panel button:focus-visible{outline:2px solid ${C.yellow};outline-offset:2px}.adventure-panel button:hover{border-color:${C.yellow}}
.adventure-panel button:disabled{opacity:.45;cursor:default}.adventure-panel .actions button:first-child{background:${C.yellow};color:${C.ink}}
@media(max-height:470px){.adventure-panel{padding:8px}.adventure-panel .sheet{max-height:calc(100dvh - 16px);padding:14px}.adventure-panel h2{margin:10px 0;font-size:20px}}
`);
export class NearbyPanel {
  readonly root: HTMLDivElement;
  private launch: HTMLButtonElement;
  private head: HTMLSpanElement;
  private closeButton: HTMLButtonElement;
  private title: HTMLHeadingElement;
  private status: HTMLParagraphElement;
  private detail: HTMLParagraphElement;
  private inventory: HTMLParagraphElement;
  private actions: HTMLDivElement;
  private shown = '';
  constructor(private engine: Engine) {
    this.launch = el('button', 'adventure-open', document.body); this.launch.hidden = true;
    this.launch.addEventListener('click', () => this.toggle());
    this.root = el('div', 'adventure-panel', document.body); this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'adventure-title');
    const sheet = el('div', 'sheet', this.root), head = el('div', 'head', sheet);
    this.head = el('span', '', head); this.closeButton = el('button', '', head);
    this.closeButton.addEventListener('click', () => this.close());
    this.title = el('h2', '', sheet); this.title.id = 'adventure-title';
    this.status = el('p', 'status', sheet); this.detail = el('p', '', sheet);
    this.inventory = el('p', 'inventory', sheet); this.actions = el('div', 'actions', sheet);
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) this.root.addEventListener(ev, e => e.stopPropagation());
  }
  get open(): boolean { return !this.root.hidden; }
  toggle(): void {
    if (this.open) { this.close(); return; }
    const ui = this.engine.get<UiApi>('ui');
    if (ui?.state !== 'playing') return;
    ui.overlay(true); this.engine.paused = true;
    this.engine.events.emit('game:pause', { paused: true });
    this.root.hidden = false; this.closeButton.focus();
  }
  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.engine.paused = false;
    this.engine.events.emit('game:pause', { paused: false });
    this.engine.get<UiApi>('ui')?.overlay(false);
  }
  update(readCard: () => Card): void {
    const visible = this.engine.get<UiApi>('ui')?.state === 'playing';
    this.launch.hidden = !visible; this.launch.textContent = `📍 ${t('adv.nearby')}`;
    if (this.open && this.engine.get<UiApi>('ui')?.state !== 'overlay') { this.root.hidden = true; return; }
    if (!this.open) return;
    const card = readCard();
    this.head.textContent = t('adv.nearby'); this.closeButton.textContent = t('adv.close');
    const key = JSON.stringify([card.title, card.status, card.detail, card.inventory, card.actions.map(a => [a.label, a.disabled])]);
    if (key === this.shown) return;
    this.shown = key; this.title.textContent = card.title; this.status.textContent = card.status;
    this.detail.textContent = card.detail; this.inventory.textContent = card.inventory;
    this.actions.replaceChildren();
    for (const action of card.actions) {
      const b = el('button', '', this.actions); b.textContent = action.label; b.disabled = !!action.disabled;
      b.addEventListener('click', () => { this.close(); action.run(); });
    }
  }
}
