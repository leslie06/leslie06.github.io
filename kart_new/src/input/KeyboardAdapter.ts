import { createInputState, type InputAdapter, type InputState } from './InputState';

/**
 * 键盘 -> InputState 的映射。WASD / 方向键 / 空格刹车 / Shift 漂移 / Q 用道具。
 *
 * 道具键**不能**用 Shift：Shift 是漂移键，而且是长按的，绑在一起等于每次漂移
 * 都自动把道具丢掉。除了 Q 之外，鼠标右键也能用道具（见 useItem 的处理）。
 */
const KEY_MAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  brake: ['Space'],
  drift: ['ShiftLeft', 'ShiftRight'],
  useItem: ['KeyQ'],
} as const;

type Action = keyof typeof KEY_MAP;

const CODE_TO_ACTION = new Map<string, Action>();
for (const action of Object.keys(KEY_MAP) as Action[]) {
  for (const code of KEY_MAP[action]) CODE_TO_ACTION.set(code, action);
}

export class KeyboardAdapter implements InputAdapter {
  private readonly held = new Set<Action>();
  private readonly state: InputState = createInputState();
  /**
   * 攒着的"用道具"请求。
   *
   * 用道具是**边沿**触发的，而按键事件和物理步长不同频：一个渲染帧可能跑好几个
   * 物理子步，也可能一个子步里来了两次 keydown。所以按下时记一笔，
   * sample() 取走一次就清掉 —— 一次按键正好换一次使用，不多不少。
   */
  private usePending = false;

  constructor(private readonly target: EventTarget = window) {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('mousedown', this.onMouseDown);
    this.target.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.repeat) return;
    const action = CODE_TO_ACTION.get(e.code);
    if (!action) return;
    e.preventDefault();
    this.held.add(action);
    if (action === 'useItem') this.usePending = true;
  };

  /** 鼠标右键也用道具 */
  private readonly onMouseDown = (event: Event) => {
    if ((event as MouseEvent).button !== 2) return;
    event.preventDefault();
    this.usePending = true;
  };

  /** 右键当操作键用，就别弹系统菜单了 */
  private readonly onContextMenu = (event: Event) => event.preventDefault();

  private readonly onKeyUp = (event: Event) => {
    const action = CODE_TO_ACTION.get((event as KeyboardEvent).code);
    if (action) this.held.delete(action);
  };

  /** 失焦时松开所有键，否则切窗口回来车会一直冲。攒着的道具请求也一起丢掉 */
  private readonly onBlur = () => {
    this.held.clear();
    this.usePending = false;
  };

  sample(): Readonly<InputState> {
    const s = this.state;
    s.steer = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    s.throttle = this.held.has('forward') ? 1 : 0;
    // 后退键既是刹车也是倒车：停下来之后 kartStep 会把它当倒车用。
    s.brake = this.held.has('brake') || this.held.has('back') ? 1 : 0;
    s.drift = this.held.has('drift');
    // 取走就清：一次按键只换一次使用
    s.useItem = this.usePending;
    this.usePending = false;
    return s;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.usePending = false;
  }
}
