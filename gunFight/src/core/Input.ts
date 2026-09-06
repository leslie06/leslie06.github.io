/** Raw device input -> InputState snapshot. Nothing above this layer reads DOM events. */
export interface InputState {
  moveX: number; moveY: number;      // -1..1
  lookDX: number; lookDY: number;    // accumulated mouse delta this frame (pixels)
  jump: boolean; jumpPressed: boolean;
  crouch: boolean; crouchPressed: boolean;
  sprint: boolean;
  fire: boolean; firePressed: boolean;
  aim: boolean;
  reload: boolean;
  interact: boolean;
  melee: boolean;
  weaponSlot: number;   // 0 none, 1..n
  scrollDelta: number;
  inspect: boolean;
  grenadePressed: boolean;
}

const BINDINGS: Record<string, keyof InputState | 'slot1' | 'slot2' | 'slot3' | 'slot4'> = {
  KeyW: 'moveY', KeyS: 'moveY', KeyA: 'moveX', KeyD: 'moveX',
  Space: 'jump', ControlLeft: 'crouch', KeyC: 'crouch', ShiftLeft: 'sprint', KeyR: 'reload', KeyE: 'interact', KeyV: 'melee', KeyF: 'inspect', KeyG: 'grenadePressed',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4',
};

export class Input {
  state: InputState = Input.empty();
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private mouseButtons = new Set<number>();
  private mousePressed = new Set<number>();
  private dx = 0; private dy = 0; private scroll = 0;
  private slot = 0;
  locked = false;
  sensitivity = 0.0022;
  enabled = true;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressedThisFrame.add(e.code);
      const b = BINDINGS[e.code];
      if (b === 'slot1') this.slot = 1; else if (b === 'slot2') this.slot = 2; else if (b === 'slot3') this.slot = 3; else if (b === 'slot4') this.slot = 4;
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    el.addEventListener('mousedown', (e) => { if (this.locked) { this.mouseButtons.add(e.button); this.mousePressed.add(e.button); } });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    window.addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; } });
    window.addEventListener('wheel', (e) => { this.scroll += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; if (!this.locked) { this.keys.clear(); this.mouseButtons.clear(); } });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void { this.el.requestPointerLock?.(); }
  exitLock(): void { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Call once per frame before systems read `state`. */
  poll(): InputState {
    const k = (c: string) => this.keys.has(c);
    const s = this.state;
    if (!this.enabled) { Object.assign(s, Input.empty()); this.dx = this.dy = 0; this.scroll = 0; this.pressedThisFrame.clear(); this.mousePressed.clear(); this.slot = 0; return s; }
    s.moveX = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    s.moveY = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    s.lookDX = this.dx; s.lookDY = this.dy; this.dx = this.dy = 0;
    s.jump = k('Space'); s.jumpPressed = this.pressedThisFrame.has('Space');
    s.crouch = k('ControlLeft') || k('KeyC'); s.crouchPressed = this.pressedThisFrame.has('ControlLeft') || this.pressedThisFrame.has('KeyC');
    s.sprint = k('ShiftLeft');
    s.fire = this.mouseButtons.has(0); s.firePressed = this.mousePressed.has(0);
    s.aim = this.mouseButtons.has(2);
    s.reload = this.pressedThisFrame.has('KeyR');
    s.interact = this.pressedThisFrame.has('KeyE');
    s.melee = this.pressedThisFrame.has('KeyV');
    s.inspect = this.pressedThisFrame.has('KeyF');
    s.grenadePressed = this.pressedThisFrame.has('KeyG');
    s.weaponSlot = this.slot; this.slot = 0;
    s.scrollDelta = this.scroll; this.scroll = 0;
    this.pressedThisFrame.clear(); this.mousePressed.clear();
    return s;
  }

  static empty(): InputState {
    return { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, jumpPressed: false, crouch: false, crouchPressed: false, sprint: false, fire: false, firePressed: false, aim: false, reload: false, interact: false, melee: false, weaponSlot: 0, scrollDelta: 0, inspect: false, grenadePressed: false };
  }
}
