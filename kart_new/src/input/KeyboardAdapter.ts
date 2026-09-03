import { createInputState, type InputAdapter, type InputState } from './InputState';

/** 键盘 -> InputState 的映射。WASD / 方向键 / 空格刹车 / Shift 漂移。 */
const KEY_MAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  brake: ['Space'],
  drift: ['ShiftLeft', 'ShiftRight'],
} as const;

type Action = keyof typeof KEY_MAP;

const CODE_TO_ACTION = new Map<string, Action>();
for (const action of Object.keys(KEY_MAP) as Action[]) {
  for (const code of KEY_MAP[action]) CODE_TO_ACTION.set(code, action);
}

export class KeyboardAdapter implements InputAdapter {
  private readonly held = new Set<Action>();
  private readonly state: InputState = createInputState();

  constructor(private readonly target: EventTarget = window) {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.repeat) return;
    const action = CODE_TO_ACTION.get(e.code);
    if (!action) return;
    e.preventDefault();
    this.held.add(action);
  };

  private readonly onKeyUp = (event: Event) => {
    const action = CODE_TO_ACTION.get((event as KeyboardEvent).code);
    if (action) this.held.delete(action);
  };

  /** 失焦时松开所有键，否则切窗口回来车会一直冲。 */
  private readonly onBlur = () => this.held.clear();

  sample(): Readonly<InputState> {
    const s = this.state;
    s.steer = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    s.throttle = this.held.has('forward') ? 1 : 0;
    // 后退键既是刹车也是倒车：停下来之后 kartStep 会把它当倒车用。
    s.brake = this.held.has('brake') || this.held.has('back') ? 1 : 0;
    s.drift = this.held.has('drift');
    return s;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
  }
}
