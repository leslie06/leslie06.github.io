import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { NavApi, PlayerApi } from '../game/Contracts';
import type { UiApi } from '.';
import { C, F, css, el } from './theme';

/** A phone or tablet. `?touch=1` forces the controls on for testing, `?touch=0` off. */
export const TOUCH = (() => {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('touch');
  if (q !== null) return q !== '0';
  return (navigator.maxTouchPoints ?? 0) > 0 && matchMedia('(pointer: coarse)').matches;
})();

type Mode = 'drive' | 'foot' | 'both';
interface Btn { el: HTMLButtonElement; mode: Mode }

const PAD = 'width:64px;height:64px;border-radius:50%;border:1px solid rgba(244,241,232,.35);background:rgba(12,15,17,.45)';

const SHEET = `
.touch{position:fixed;inset:0;z-index:20;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;font-family:${F.ui}}
.touch[hidden]{display:none}
.touch .surface{position:absolute;inset:0;pointer-events:auto;touch-action:none}
.touch .stick{position:absolute;width:132px;height:132px;margin:-66px 0 0 -66px;border-radius:50%;
  border:1px solid ${C.line};background:rgba(12,15,17,.3);opacity:0;transition:opacity .12s}
.touch .stick.on{opacity:1}
.touch .stick i{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;
  background:rgba(243,181,15,.5);border:1px solid rgba(244,241,232,.5)}
.touch .pads{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));
  display:grid;grid-template-columns:repeat(3,64px);gap:10px;justify-items:center;align-items:end;pointer-events:none}
.touch button{${PAD};color:${C.paper};font:700 13px/1.1 ${F.ui};letter-spacing:.02em;pointer-events:auto;touch-action:none;
  -webkit-tap-highlight-color:transparent;display:grid;place-items:center;padding:0}
.touch button[hidden]{display:none}
.touch button.wide{grid-column:span 1}
.touch button.gas{width:82px;height:82px;background:rgba(243,181,15,.24);border-color:rgba(243,181,15,.6)}
.touch button.brake{background:rgba(226,64,47,.2);border-color:rgba(226,64,47,.5)}
.touch button:active,.touch button.down{background:rgba(243,181,15,.45);border-color:${C.yellow}}
.touch .top{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));top:calc(12px + env(safe-area-inset-top,0px));display:flex;gap:10px}
.touch .top button{width:48px;height:48px;font-size:12px}
.touch .rot{position:absolute;left:50%;top:46%;transform:translateX(-50%);padding:7px 14px;border-radius:6px;
  background:${C.inkGlass};font:700 13px/1 ${F.ui};color:${C.paper};display:none}
@media (orientation:portrait){.touch .rot{display:block}}
/* Narrow screens: shrink the dials so the pads and the radar have room. */
body.dc-touch .hud .speedo{left:50%;right:auto;top:auto;bottom:calc(4px + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%) scale(.62);transform-origin:bottom center}
body.dc-touch .hud .hint{display:none}
body.dc-touch .minimap{width:min(40vw,190px);left:calc(10px + env(safe-area-inset-left,0px));bottom:calc(10px + env(safe-area-inset-bottom,0px))}
body.dc-touch .hud .wanted{top:calc(12px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));font-size:24px}
body.dc-touch .hud .cash{top:calc(42px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));font-size:19px}
body.dc-touch .hud .health{top:calc(68px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));width:92px}
body.dc-touch .hud .toast{bottom:32vh}
body.dc-touch .hud .prompt{bottom:25vh}
body.dc-touch .hud .street{bottom:calc(118px + env(safe-area-inset-bottom,0px))}
/* Portrait is narrow: the dial cannot share the bottom edge with the pads, so it sits over the radar. */
@media (orientation:portrait){
  body.dc-touch .hud .speedo{left:calc(4px + env(safe-area-inset-left,0px));transform:scale(.52);transform-origin:bottom left;bottom:calc(150px + env(safe-area-inset-bottom,0px))}
  body.dc-touch .hud .street{bottom:calc(256px + env(safe-area-inset-bottom,0px))}
  body.dc-touch .hud .toast{bottom:40vh}
  body.dc-touch .hud .prompt{bottom:33vh}
}
body.dc-touch .hud .objective{top:calc(10px + env(safe-area-inset-top,0px));font-size:13px;max-width:52vw}
`;

/**
 * On-screen controls for phones: a floating stick on the left half, pedals and action buttons
 * bottom-right, and a drag anywhere else on the right to swing the camera. It writes into
 * `engine.input.touch`, which `Input.poll` merges with the keyboard and pad, so the game itself
 * knows nothing about touch.
 */
export class TouchControls implements System {
  readonly name = 'touch';
  private root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLElement;
  private btns: Btn[] = [];
  private pointers = new Map<number, { kind: 'stick' | 'look'; x: number; y: number }>();
  private shown = false;
  private driving = true;
  private state = {
    steer: 0, forward: 0, back: 0, handbrake: false, sprint: false, analog: false,
    lookDX: 0, lookDY: 0,
    jumpPressed: false, enterPressed: false, punchPressed: false, mapPressed: false, cameraPressed: false, pausePressed: false,
  };

  constructor(private engine: Engine, container: HTMLElement) {
    css(SHEET);
    // Not 'touch': the root element below uses that class, and `.touch{position:fixed}` would pin the body.
    document.body.classList.add('dc-touch');
    engine.input.touch = this.state;
    this.root = el('div', 'touch', container);
    this.root.hidden = true;
    const surface = el('div', 'surface', this.root);
    this.stick = el('div', 'stick', this.root);
    this.knob = el('i', undefined, this.stick);
    const rot = el('div', 'rot', this.root);
    rot.textContent = t('touch.rotate');

    const top = el('div', 'top', this.root);
    this.button(top, 'both', t('touch.pause'), (down) => { if (down) this.state.pausePressed = true; });
    this.button(top, 'both', t('touch.map'), (down) => { if (down) this.state.mapPressed = true; });

    const pads = el('div', 'pads', this.root);
    // Row 1: camera / get in or out / shove or jump.
    this.button(pads, 'drive', t('touch.cam'), (down) => { if (down) this.state.cameraPressed = true; });
    this.button(pads, 'foot', t('touch.jump'), (down) => { if (down) this.state.jumpPressed = true; });
    this.button(pads, 'both', t('touch.door'), (down) => { if (down) this.state.enterPressed = true; });
    this.button(pads, 'drive', t('touch.hand'), (down) => { this.state.handbrake = down; }, true);
    this.button(pads, 'foot', t('touch.push'), (down) => { if (down) this.state.punchPressed = true; });
    // Row 2: brake / run / throttle.
    this.button(pads, 'drive', t('touch.brake'), (down) => { this.state.back = down ? 1 : 0; }, true, 'brake');
    this.button(pads, 'foot', t('touch.run'), (down) => { this.state.sprint = down; }, true);
    const spacer = el('div', undefined, pads);
    spacer.style.width = '64px';
    this.button(pads, 'both', t('touch.gas'), (down) => { this.state.forward = down ? 1 : 0; }, true, 'gas');

    this.driving = engine.get<PlayerApi>('player')?.mode !== 'onfoot';
    this.syncMode();
    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) surface.addEventListener(ev, (e) => this.up(e));
    container.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';
  }

  private button(parent: HTMLElement, mode: Mode, label: string, set: (down: boolean) => void, hold = false, cls = ''): void {
    const b = el('button', cls, parent);
    b.textContent = label;
    b.type = 'button';
    const press = (down: boolean) => (e: PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (down) b.setPointerCapture(e.pointerId);
      b.classList.toggle('down', down && hold);
      set(down);
    };
    b.addEventListener('pointerdown', press(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, press(false));
    this.btns.push({ el: b, mode });
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    const left = e.clientX < window.innerWidth * 0.45;
    this.pointers.set(e.pointerId, { kind: left ? 'stick' : 'look', x: e.clientX, y: e.clientY });
    if (left) {
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
      this.knob.style.transform = 'translate(0,0)';
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') {
      const dx = e.clientX - p.x, dy = e.clientY - p.y, r = 52;
      const len = Math.hypot(dx, dy), k = len > r ? r / len : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.state.steer = Math.max(-1, Math.min(1, dx / r));
      this.state.analog = true;
      // On foot the same stick walks; in a car the vertical axis is ignored (pedals are buttons).
      if (!this.driving) {
        const fwd = Math.max(-1, Math.min(1, -dy / r));
        this.state.forward = Math.max(this.state.forward, Math.max(0, fwd));
        this.state.back = Math.max(0, -fwd);
      }
    } else {
      this.state.lookDX += e.clientX - p.x;
      this.state.lookDY += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    }
  }

  private up(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind !== 'stick') return;
    this.stick.classList.remove('on');
    this.state.steer = 0; this.state.analog = false;
    if (!this.driving) { this.state.forward = 0; this.state.back = 0; }
  }

  private syncMode(): void {
    for (const b of this.btns) if (b.mode !== 'both') b.el.hidden = (b.mode === 'drive') !== this.driving;
  }

  private release(): void {
    this.pointers.clear();
    this.stick.classList.remove('on');
    Object.assign(this.state, { steer: 0, forward: 0, back: 0, handbrake: false, sprint: false, analog: false });
    for (const b of this.btns) b.el.classList.remove('down');
  }

  update(): void {
    const ui = this.engine.get<UiApi>('ui');
    const open = this.engine.get<NavApi>('nav')?.mapOpen ?? false;
    const show = ui?.state === 'playing' && !open;
    if (show !== this.shown) {
      this.shown = show;
      this.root.hidden = !show;
      if (!show) this.release();
    }
    const driving = this.engine.get<PlayerApi>('player')?.mode !== 'onfoot';
    if (driving !== this.driving) {
      this.driving = driving;
      this.syncMode();
      this.release();
    }
  }
}
