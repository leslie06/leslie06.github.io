import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { NavApi, ParkApi, PlayerApi, VehicleApi } from '../game/Contracts';
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
.touch button.nitro{background:rgba(80,170,255,.2);border-color:rgba(120,190,255,.55)}
.touch button.interact{white-space:pre-line;background:rgba(243,181,15,.24);border-color:${C.yellow};line-height:1.4}
.touch button.action{position:absolute;left:50%;bottom:25vh;transform:translateX(-50%);width:auto;height:auto;min-height:48px;max-width:80vw;
  padding:10px 16px;border-radius:8px;background:${C.inkGlass};border-color:${C.yellow};font-size:15px;line-height:1.3}
.touch button:active,.touch button.down{background:rgba(243,181,15,.45);border-color:${C.yellow}}
.touch .top{position:absolute;left:calc(12px + env(safe-area-inset-left,0px));top:calc(12px + env(safe-area-inset-top,0px));display:flex;gap:10px}
.touch .top button{width:48px;height:48px;font-size:12px}
.touch .rot{position:absolute;left:50%;top:46%;transform:translateX(-50%);padding:7px 14px;border-radius:6px;
  background:${C.inkGlass};font:700 13px/1 ${F.ui};color:${C.paper};display:none}
@media (orientation:portrait){.touch .rot{display:block}}
/* Landscape: bottom centre the dial sat on the car (2026-10-19, 「手机版，会看到速度盘显示在车上面」), so it goes left of
   the car, right of the radar's column (the radar, the objective and the best score stack there): 0.55 of 196 = 108 px,
   at most 62 px left of the screen's centre (the car's half width, chase camera). */
body.dc-touch .hud .speedo{left:min(calc(var(--mm-left) + var(--mm-w) + 14px),calc(50% - 170px));right:auto;top:auto;
  bottom:calc(4px + env(safe-area-inset-bottom,0px));transform:scale(.55);transform-origin:bottom left}
body.dc-touch .hud .hint{display:none}
body.dc-touch .hud .prompt{display:none}
/* Dialogue choices must receive taps above the full-screen touch surface. */
body.dc-touch .hud{z-index:25}
/* Top-left on a phone too, but below the pause and map buttons (12 + 48 + 10 px). Overriding the
   variables rather than the width keeps --mm-h, which the HUD stacks against, correct. */
body.dc-touch{--mm-w:min(40vw,190px);--mm-left:calc(10px + env(safe-area-inset-left,0px));--mm-top:calc(70px + env(safe-area-inset-top,0px))}
body.dc-touch .hud .wanted{top:calc(12px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));font-size:24px}
body.dc-touch .hud .cash{top:calc(42px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));font-size:19px}
body.dc-touch .hud .health{top:calc(68px + env(safe-area-inset-top,0px));right:calc(14px + env(safe-area-inset-right,0px));width:92px}
body.dc-touch .hud .toast{bottom:32vh}
body.dc-touch .hud .prompt{bottom:25vh}
/* Clear of the pads: 16px inset + 64px top row + 10px gap + 82px gas button = 172px tall, so the
   street name sat inside the buttons at 118px. */
body.dc-touch .hud .street{bottom:calc(182px + env(safe-area-inset-bottom,0px))}
/* Portrait is narrow: the dial cannot share the bottom edge with the pads, so it sits over the radar. */
@media (orientation:portrait){
  body.dc-touch .hud .speedo{left:calc(4px + env(safe-area-inset-left,0px));transform:scale(.52);transform-origin:bottom left;bottom:calc(150px + env(safe-area-inset-bottom,0px))}
  body.dc-touch .hud .street{bottom:calc(256px + env(safe-area-inset-bottom,0px))}
  body.dc-touch .hud .toast{bottom:40vh}
  body.dc-touch .hud .prompt{bottom:33vh}
  .touch button.action{bottom:33vh}
}
body.dc-touch .hud .objective{top:calc(10px + env(safe-area-inset-top,0px));font-size:13px;max-width:52vw}
/* A phone on its side (2026-10-20, 「汽车上面会有任务，得分，得金币的文字，挡住屏幕了…地图也有点大，占了三分之一的屏幕」): every word
   goes to a strip along the top, over the sky, one small line each - the objective, the phone's task, a toast below
   them, the combo and the drift score in the objective's place while they run - and nothing over the road ahead of the
   car (the toast stood at the car's height, the combo over the road). The minimap is 124 px across and higher (the top
   buttons 42 px), its turn bar lower.
   "html" before each: the combo's, the phone's and the HUD's own sheets come later and would win a tie. */
@media (max-height:470px){
  body.dc-touch{--mm-w:124px;--mm-h:calc(var(--mm-w) / 1.58 + 20px);--mm-top:calc(60px + env(safe-area-inset-top,0px))}
  html body.dc-touch .touch .top{gap:8px}
  html body.dc-touch .touch .top button{width:42px;height:42px;font-size:11px}
  html body.dc-touch .minimap .turn{height:28px;gap:6px;padding:0 7px}
  html body.dc-touch .minimap .turn svg{width:18px;height:18px}
  html body.dc-touch .minimap .turn .a{font-size:11px}
  html body.dc-touch .minimap .turn .a b{font-size:12px;margin-right:4px}
  html body.dc-touch .minimap .turn .r{font-size:9px}
  html body.dc-touch .minimap .bar{margin-top:4px;height:14px}
  html body.dc-touch .minimap .bar .d{font-size:13px}
  html body.dc-touch .hud .objective{top:calc(6px + env(safe-area-inset-top,0px));padding:5px 12px;font-size:12px;max-width:42vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  html body.dc-touch .hud .phone{top:calc(6px + env(safe-area-inset-top,0px));width:min(360px,calc(100vw - 430px))}
  html body.dc-touch .hud:has(.objective:not([hidden])) .phone{top:calc(36px + env(safe-area-inset-top,0px))}
  html body.dc-touch .hud .phone .task{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;padding:3px 8px}
  html body.dc-touch .hud .toast{top:calc(6px + env(safe-area-inset-top,0px));bottom:auto;padding:5px 12px;font-size:12px;letter-spacing:.04em;max-width:42vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  html body.dc-touch .hud .combo,html body.dc-touch .hud .drift{top:calc(2px + env(safe-area-inset-top,0px));transform:translateX(-50%) scale(.55);transform-origin:top center}
  html body.dc-touch .hud .combo .ln:nth-child(n+3){display:none}
  /* one row of text at the top (2026-10-20, 「有信息还是会遮挡屏幕」: the task line, a text under it and the toast at 98 px
     stacked down to the middle of a 280 px screen): a text, a toast, a combo or a drift takes the row for its few seconds
     and the objective and the task line step aside */
  html body.dc-touch .hud:has(.combo.on) .objective,html body.dc-touch .hud:has(.drift.on) .objective,
  html body.dc-touch .hud:has(.toast.on) .objective,html body.dc-touch .hud:has(.phone .sms:not([hidden])) .objective{visibility:hidden}
  html body.dc-touch .hud:has(.combo.on) .phone .task,html body.dc-touch .hud:has(.drift.on) .phone .task,
  html body.dc-touch .hud:has(.toast.on) .phone .task,html body.dc-touch .hud .phone:has(.sms:not([hidden])) .task{display:none}
  html body.dc-touch .hud:has(.phone .sms:not([hidden])) .phone{top:calc(4px + env(safe-area-inset-top,0px))}
  html body.dc-touch .hud:has(.phone .sms:not([hidden])) .toast{top:auto;bottom:calc(18px + env(safe-area-inset-bottom,0px))}
  /* the street's name: a small line under the cash, not 22 px over the right of the road */
  html body.dc-touch .hud .street{top:calc(68px + env(safe-area-inset-top,0px));bottom:auto;right:calc(14px + env(safe-area-inset-right,0px));font-size:13px;letter-spacing:.04em}
  /* the best drift score under the radar stood over the road; the pause menu and the boards still have it */
  html body.dc-touch .hud .best{display:none}
  html body.dc-touch .hud .best[hidden] + .hint{top:calc(var(--mm-top) + var(--mm-h) + 10px)}
  /* the other big words (2026-10-20, 「不光是悬赏，同类的大字都改下」), like the banner (ui/Banner.ts): a tag at the top, no
     darkened screen. BUSTED; a chapter's title card and the failure card (the result card has a button and stays) */
  html body.dc-touch .dc-busted{inset:auto;top:calc(4px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);background:none}
  html body.dc-touch .dc-busted b{display:block;font-size:20px;letter-spacing:.12em;padding:5px 16px;border-radius:7px;border-bottom:3px solid ${C.yellow};background:rgba(14,16,18,.86);text-shadow:none;white-space:nowrap}
  html body.dc-touch .cmp-card:not(.pass){inset:auto;top:calc(4px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);max-width:calc(100vw - 430px);
    padding:5px 14px;border-radius:7px;background:rgba(14,16,18,.86);text-shadow:none}
  html body.dc-touch .cmp-card:not(.pass) .kick{font-size:10px;letter-spacing:.2em;margin-bottom:3px}
  html body.dc-touch .cmp-card:not(.pass) h1{font-size:18px;letter-spacing:.06em;text-shadow:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  html body.dc-touch .cmp-card:not(.pass) .who{margin-top:2px;font-size:11px;text-shadow:none}
  html body.dc-touch:has(:is(.dc-busted,.cmp-card:not(.pass)):not([hidden])) .hud :is(.objective,.phone,.toast,.combo,.drift){visibility:hidden}
  /* a time trial: one line where the objective was (it says the same) */
  html body.dc-touch .dc-trial{top:calc(4px + env(safe-area-inset-top,0px));min-width:0;display:flex;align-items:baseline;gap:10px;padding:4px 12px;border-top:0;border-bottom:2px solid #5fd1ff;white-space:nowrap}
  html body.dc-touch .dc-trial[hidden]{display:none}
  html body.dc-touch .dc-trial .t{font-size:16px}
  html body.dc-touch .dc-trial .n,html body.dc-touch .dc-trial .s{font-size:11px}
  html body.dc-touch .dc-trial .s span + span{margin-left:6px}
  html body.dc-touch:has(.dc-trial:not([hidden])) .hud .objective{visibility:hidden}
  /* the story's nudge and its meter: the second row, one line each */
  html body.dc-touch .cmp-nudge{top:calc(36px + env(safe-area-inset-top,0px));padding:3px 10px 3px 4px;gap:7px;max-width:calc(100vw - 430px)}
  html body.dc-touch .cmp-nudge .g{width:20px;height:20px;font-size:12px;box-shadow:none}
  html body.dc-touch .cmp-nudge > div{display:flex;gap:8px;align-items:baseline;min-width:0;white-space:nowrap}
  html body.dc-touch .cmp-nudge .h{font-size:12px}
  html body.dc-touch .cmp-nudge .s{font-size:11px;margin:0;overflow:hidden;text-overflow:ellipsis}
  html body.dc-touch .cmp-meter{top:calc(38px + env(safe-area-inset-top,0px));width:min(200px,30vw)}
  html body.dc-touch .cmp-meter .l{font-size:10px;margin-bottom:3px}
  html body.dc-touch .cmp-meter .b{height:6px}
  html body.dc-touch .cmp-meter .n{font-size:10px;margin-top:2px}
  html body.dc-touch:has(:is(.cmp-nudge,.cmp-meter):not([hidden])) .hud .phone .task{display:none}
  /* the map credit: the short line here, the whole list on the map screen */
  html body.dc-touch .dc-credit .f{display:none}
  html body.dc-touch .dc-credit .s{display:inline!important}
  /* a text message: no picture, small, two lines at most */
  html body.dc-touch .hud .phone .sms{grid-template-columns:1fr;padding:5px 10px;gap:0}
  html body.dc-touch .hud .phone .sms .av{display:none}
  html body.dc-touch .hud .phone .sms .who{display:inline;font-size:11px;margin:0 6px 0 0}
  html body.dc-touch .hud .phone .sms .who span{display:none}
  html body.dc-touch .hud .phone .sms .txt{display:inline}
  html body.dc-touch .hud .phone .sms > div:last-child{font-size:11.5px;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
  /* a call or a choice: high up, its answers side by side (one above the other it stood 175 px tall over the road) */
  html body.dc-touch .hud .dlg{top:calc(4px + env(safe-area-inset-top,0px));width:min(460px,calc(100vw - 430px));grid-template-columns:1fr;padding:5px 9px;gap:0}
  html body.dc-touch .hud .dlg .av{display:none}
  html body.dc-touch .hud:has(.dlg:not(.off)) :is(.objective,.phone,.combo,.drift){visibility:hidden}
  html body.dc-touch:has(.hud .dlg:not(.off)) .cmp-nudge{visibility:hidden}
  html body.dc-touch:has(.hud .dlg:not(.off)) .cmp-meter{top:calc(100px + env(safe-area-inset-top,0px))}
  html body.dc-touch .hud .dlg .txt{font-size:12px;line-height:1.3}
  html body.dc-touch .hud .dlg .opts{flex-direction:row;gap:6px;margin-top:4px}
  html body.dc-touch .hud .dlg .opts button{flex:1 1 0;min-height:32px;padding:4px 8px;font-size:12px;line-height:1.2}
}
`;

/**
 * On-screen controls for phones: a floating stick on the left half, pedals and action buttons
 * bottom-right, and a drag anywhere else on the right to swing the camera. It writes into
 * `engine.input.touch`, which `Input.poll` merges with the keyboard and pad, so the game itself
 * knows nothing about touch.
 */
/**
 * Safari on iPad and iPhone zooms the page on a double tap and a pinch even with `touch-action: none` (2026-10-12,
 * 「ipad点了几下反击，屏幕就放大了」: hammering a button zoomed the game, and with every gesture taken by the game
 * there was no pinching back). A second tap within 350 ms has its touchend cancelled (not in text fields), and
 * Safari's pinch gestures are cancelled.
 */
function noZoom(): void {
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp, el = e.target as HTMLElement | null;
    if (now - last < 350 && !(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) e.preventDefault();
    last = now;
  }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

export class TouchControls implements System {
  readonly name = 'touch';
  private root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLElement;
  private btns: Btn[] = [];
  private spacer!: HTMLDivElement;
  private nitroBtn!: HTMLButtonElement;
  private interactBtn: HTMLButtonElement;
  private actionBtn: HTMLButtonElement;
  /** The car has a nitro bottle: the button shows only then (an empty cell otherwise). */
  private n2o = false;
  private pointers = new Map<number, { kind: 'stick' | 'look'; x: number; y: number }>();
  private shown = false;
  private driving = true;
  private state = {
    steer: 0, forward: 0, back: 0, handbrake: false, sprint: false, analog: false, nitro: false,
    lookDX: 0, lookDY: 0,
    jumpPressed: false, enterPressed: false, punchPressed: false, counterPressed: false, mapPressed: false, cameraPressed: false, pausePressed: false, radioPressed: false, phonePressed: false, resetPressed: false,
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
    this.button(top, 'drive', t('touch.radio'), (down) => { if (down) this.state.radioPressed = true; });
    this.button(top, 'both', t(engine.get('adventure') ? 'adv.short' : 'touch.phone'), (down) => { if (down) this.state.phonePressed = true; });

    const pads = el('div', 'pads', this.root);
    // Row 1: camera / get in or out / shove or jump.
    this.button(pads, 'drive', t('touch.cam'), (down) => { if (down) this.state.cameraPressed = true; });
    this.button(pads, 'foot', t('touch.jump'), (down) => { if (down) this.state.jumpPressed = true; });
    const interact = (down: boolean) => { if (down) this.state.enterPressed = true; };
    this.button(pads, 'both', '', interact, false, 'interact');
    this.interactBtn = this.btns[this.btns.length - 1].el;
    this.button(pads, 'drive', t('touch.hand'), (down) => { this.state.handbrake = down; }, true);
    this.button(pads, 'foot', t('touch.push'), (down) => { if (down) this.state.punchPressed = true; });
    // Row 2: brake / run / throttle.
    this.button(pads, 'drive', t('touch.brake'), (down) => { this.state.back = down ? 1 : 0; }, true, 'brake');
    this.button(pads, 'foot', t('touch.run'), (down) => { this.state.sprint = down; }, true);
    // The middle of row 2: nitro while driving, an empty cell on foot so the throttle keeps its place.
    this.button(pads, 'drive', t('touch.nitro'), (down) => { this.state.nitro = down; }, true, 'nitro');
    this.nitroBtn = this.btns[this.btns.length - 1].el;
    // on foot the middle cell is the counter (combat/: catch one winding up, else block)
    this.button(pads, 'foot', t('touch.counter'), (down) => { if (down) this.state.counterPressed = true; });
    const spacer = this.spacer = el('div', undefined, pads);
    spacer.style.width = '64px';
    this.button(pads, 'both', t('touch.gas'), (down) => { this.state.forward = down ? 1 : 0; }, true, 'gas');
    this.button(this.root, 'both', '', interact, false, 'action');
    this.actionBtn = this.btns[this.btns.length - 1].el;
    this.actionBtn.hidden = true;

    this.driving = engine.get<PlayerApi>('player')?.mode !== 'onfoot';
    this.syncMode();
    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) surface.addEventListener(ev, (e) => this.up(e));
    container.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';
    noZoom();
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
    // iOS zooms on a quick second tap from the touch events, whatever the pointer events did: cancel them here
    b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    b.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
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
    this.nitroBtn.hidden = !(this.driving && this.n2o);
    this.spacer.hidden = !this.driving || this.n2o;
  }

  private release(): void {
    this.pointers.clear();
    this.stick.classList.remove('on');
    Object.assign(this.state, { steer: 0, forward: 0, back: 0, handbrake: false, sprint: false, analog: false, nitro: false });
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
    const player = this.engine.get<PlayerApi>('player');
    const driving = player?.mode !== 'onfoot';
    if (driving !== this.driving) {
      this.driving = driving;
      this.syncMode();
      this.release();
    }
    const n2o = (this.engine.get<VehicleApi>('vehicle')?.car.tune.nitro ?? 0) > 0;
    if (n2o !== this.n2o) { this.n2o = n2o; this.syncMode(); if (!n2o) this.state.nitro = false; }
    const park = this.engine.get<ParkApi>('park');
    const prompt = park?.prompt === 'board' ? t('hud.ride') : park?.prompt === 'exit' ? t('hud.rideOff') : player?.prompt;
    const label = prompt === t('npc.talk') ? t('touch.talk') : !park?.prompt && driving ? (prompt ? t('touch.leap') : t('touch.exit'))
      : player?.nearCar ? t('touch.enter') : t('touch.interact');
    const text = `F\n${label}`;
    if (this.interactBtn.textContent !== text) {
      this.interactBtn.textContent = text;
      this.interactBtn.setAttribute('aria-label', label);
    }
    this.actionBtn.hidden = !prompt;
    if (prompt) {
      const action = t('touch.use', { action: prompt.replace(/^F\s+/, '') });
      if (this.actionBtn.textContent !== action) this.actionBtn.textContent = action;
    }
  }
}
