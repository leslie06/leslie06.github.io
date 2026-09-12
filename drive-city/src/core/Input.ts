/**
 * Raw device input -> InputState snapshot. Nothing above this layer reads DOM events or gamepads.
 *
 * Keyboard follows GTA V's PC layout where it has one (V cycles the camera, C looks behind, E is the
 * horn) so a player who knows that game does not have to read the help panel. A gamepad, when one
 * is connected and touched, takes over the analogue axes: steering and pedals are the two places
 * where analogue input changes how the car feels, and the keyboard path has to fake it (see
 * vehicle/ControlFilter).
 */
/** What the on-screen controls hand over; see `Input.touch`. */
export interface TouchInput {
  steer: number; forward: number; back: number; handbrake: boolean; sprint: boolean; analog: boolean;
  lookDX: number; lookDY: number;
  jumpPressed: boolean; enterPressed: boolean; punchPressed: boolean; mapPressed: boolean; cameraPressed: boolean; pausePressed: boolean;
}

export interface InputState {
  /** 0..1 each. Keyboard gives 0 or 1; triggers give anything in between. */
  forward: number; back: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  /** True when `steer`/`forward`/`back` came from an analogue device this frame. */
  analog: boolean;
  handbrake: boolean;
  /** On foot: sprint (Shift) and jump (Space, the handbrake key). */
  sprint: boolean;
  jumpPressed: boolean;
  /** Get in / out of a vehicle (F, gamepad Y). */
  enterPressed: boolean;
  horn: boolean;
  lookBack: boolean;
  /** Camera orbit: mouse pixels (pointer locked) or right-stick deflection scaled to pixels. */
  /** Tab / D-pad up: the full-screen map. */
  mapPressed: boolean;
  /** Left mouse button, E or gamepad B: shove the person in front (on foot). */
  punchPressed: boolean;
  lookDX: number; lookDY: number;
  cameraPressed: boolean;
  resetPressed: boolean;
  pausePressed: boolean;
  helpPressed: boolean;
  mutePressed: boolean;
  diagPressed: boolean;
}

const DEADZONE = 0.12;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export class Input {
  state: InputState = Input.empty();
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0; private dy = 0;
  private dragging = false;
  /** A left click since the last poll (shove on foot). */
  private clicked = false;
  /** Touch screen: the browser also fires a synthetic mousedown per tap, which must not shove anyone. */
  private coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  locked = false;
  enabled = true;
  /** Buttons held on the previous poll, to turn gamepad buttons into edges. */
  private padPrev: boolean[] = [];
  private padActive = false;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      this.padActive = false;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.dragging = false; });
    // Orbit with the mouse either under pointer lock or by dragging, so the camera is reachable
    // even when the browser refuses the lock (iframes, some Safari builds).
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
      if (e.button === 0 && !this.coarse) this.clicked = true;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.dx += e.movementX; this.dy += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.keys.clear();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    try { const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* denied */ }
  }
  exitLock(): void { if (document.pointerLockElement) document.exitPointerLock(); }

  /**
   * Written by the on-screen controls (ui/Touch.ts) and merged in `poll`. Edge flags are cleared
   * once consumed, so a tap counts exactly once.
   */
  touch: TouchInput | null = null;

  /** Call once per frame before systems read `state`. */
  poll(): InputState {
    const s = this.state;
    if (!this.enabled) {
      Object.assign(s, Input.empty());
      // Pause/help must still work while gameplay input is off.
      s.pausePressed = this.pressed.has('Escape') || this.pressed.has('KeyP');
      s.helpPressed = this.pressed.has('F1');
      s.diagPressed = this.pressed.has('F9');
      this.dx = this.dy = 0; this.pressed.clear();
      return s;
    }
    const k = (c: string) => this.keys.has(c);
    const p = (c: string) => this.pressed.has(c);
    s.forward = k('KeyW') || k('ArrowUp') ? 1 : 0;
    s.back = k('KeyS') || k('ArrowDown') ? 1 : 0;
    s.steer = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    s.analog = false;
    s.handbrake = k('Space');
    s.sprint = k('ShiftLeft') || k('ShiftRight');
    s.jumpPressed = p('Space');
    s.enterPressed = p('KeyF') || p('Enter');
    s.horn = k('KeyE') || k('KeyH');
    s.lookBack = k('KeyC');
    s.lookDX = this.dx; s.lookDY = this.dy; this.dx = this.dy = 0;
    s.cameraPressed = p('KeyV');
    s.resetPressed = p('KeyR');
    s.pausePressed = p('Escape') || p('KeyP');
    s.helpPressed = p('F1');
    s.mutePressed = p('KeyM');
    s.diagPressed = p('F9');
    s.mapPressed = p('Tab');
    s.punchPressed = p('KeyE') || this.clicked;
    this.clicked = false;
    this.pressed.clear();
    this.pollPad(s);
    this.pollTouch(s);
    return s;
  }

  /** Merge the on-screen controls: analogue axes take the larger magnitude, buttons OR together. */
  private pollTouch(s: InputState): void {
    const c = this.touch;
    if (!c) return;
    if (Math.abs(c.steer) > Math.abs(s.steer)) { s.steer = c.steer; s.analog = true; }
    if (c.analog) s.analog = true;
    s.forward = Math.max(s.forward, c.forward);
    s.back = Math.max(s.back, c.back);
    s.handbrake ||= c.handbrake;
    s.sprint ||= c.sprint;
    s.lookDX += c.lookDX; s.lookDY += c.lookDY;
    c.lookDX = 0; c.lookDY = 0;
    s.jumpPressed ||= c.jumpPressed; c.jumpPressed = false;
    s.enterPressed ||= c.enterPressed; c.enterPressed = false;
    s.punchPressed ||= c.punchPressed; c.punchPressed = false;
    s.mapPressed ||= c.mapPressed; c.mapPressed = false;
    s.cameraPressed ||= c.cameraPressed; c.cameraPressed = false;
    s.pausePressed ||= c.pausePressed; c.pausePressed = false;
  }

  /** Xbox layout (standard mapping): RT/LT pedals, left stick steers, A/RB handbrake. */
  private pollPad(s: InputState): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const g of pads) if (g && g.connected && g.mapping === 'standard') { pad = g; break; }
    if (!pad) return;
    const b = (i: number) => pad!.buttons[i]?.pressed ?? false;
    const v = (i: number) => pad!.buttons[i]?.value ?? 0;
    const edge = (i: number) => b(i) && !this.padPrev[i];
    const steer = dz(pad.axes[0] ?? 0);
    const rt = v(7), lt = v(6);
    // A pad that is merely plugged in must not override the keyboard: take over only once touched.
    if (!this.padActive && (Math.abs(steer) > 0 || rt > 0.05 || lt > 0.05 || pad.buttons.some((x) => x.pressed))) this.padActive = true;
    if (this.padActive) {
      if (Math.abs(steer) > Math.abs(s.steer) || s.steer === 0) { s.steer = steer; s.analog = true; }
      s.forward = Math.max(s.forward, rt);
      s.back = Math.max(s.back, lt);
      if (rt > 0 && rt < 1 || lt > 0 && lt < 1) s.analog = true;
      s.handbrake ||= b(0) || b(5);
      s.horn ||= b(2) || b(10);
      s.lookBack ||= b(11);
      s.lookDX += dz(pad.axes[2] ?? 0) * 14;
      s.lookDY += dz(pad.axes[3] ?? 0) * 10;
      s.cameraPressed ||= edge(8);
      s.enterPressed ||= edge(3);
      s.resetPressed ||= edge(13);
      s.sprint ||= b(0);
      s.jumpPressed ||= edge(2);
      s.pausePressed ||= edge(9);
      s.mapPressed ||= edge(12);
      s.punchPressed ||= edge(1);
    }
    this.padPrev = pad.buttons.map((x) => x.pressed);
  }

  static empty(): InputState {
    return { forward: 0, back: 0, steer: 0, analog: false, handbrake: false, sprint: false, jumpPressed: false, enterPressed: false, mapPressed: false, punchPressed: false, horn: false, lookBack: false, lookDX: 0, lookDY: 0,
      cameraPressed: false, resetPressed: false, pausePressed: false, helpPressed: false, mutePressed: false, diagPressed: false };
  }
}
