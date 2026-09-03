/**
 * 触屏 -> InputState。和 KeyboardAdapter 平级：同样只产出 InputState，
 * 上层完全不知道这一帧的输入是手指还是键盘来的。
 *
 * 几条硬规矩：
 *   - 控件全是 CSS 定位的 DOM，**不画在 canvas 里**。画在 canvas 里意味着每帧要重画、
 *     要自己做命中判定、还要跟着分辨率缩放；DOM 这些全是白送的，而且 0 drawcall。
 *   - 用 Pointer Events + setPointerCapture，不用 touchstart/touchmove。
 *     捕获之后手指滑出按钮范围也还算按住，松开一定收得到 up —— 这是"按住油门过弯时
 *     手指跟着屏幕晃了一下，车就熄火了"这类问题的根治办法。
 *   - 摇杆是**浮动**的：手指按在左边区域哪儿，圆心就落在哪儿。固定圆心的摇杆
 *     在看不见手的情况下很难摸准。
 *   - useItem 和键盘一样是边沿触发：按一下用一次，按住不连发。
 */
import { createInputState, type InputAdapter, type InputState } from './InputState';
import { clampKnob, DEFAULT_TOUCH_STEER, steerFromOffset, type TouchSteerConfig } from './touchMath';

type ButtonAction = 'throttle' | 'brake' | 'drift' | 'item';

interface ButtonSpec {
  action: ButtonAction;
  className: string;
  label: string;
  hint: string;
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'throttle', className: 'touch-btn-throttle', label: '▲', hint: '油门' },
  { action: 'brake', className: 'touch-btn-brake', label: '▼', hint: '刹车' },
  { action: 'drift', className: 'touch-btn-drift', label: 'DRIFT', hint: '漂移' },
  { action: 'item', className: 'touch-btn-item', label: '道具', hint: '使用道具' },
];

export interface TouchAdapterOptions {
  /** 摇杆手感。半径同时决定视觉大小，改了要一起改 CSS 变量 */
  steer?: Partial<TouchSteerConfig>;
  /**
   * 惯用手。'right' = 摇杆在左、按钮在右（大多数人）；'left' 整个镜像过来。
   *
   * 这不是审美偏好：转向是**连续**的精细操作，油门刹车是开关。惯用手应该管转向，
   * 所以左撇子必须能把摇杆换到右边，否则精细的那一半交给了不灵活的手。
   */
  handed?: 'right' | 'left';
}

export class TouchAdapter implements InputAdapter {
  readonly root: HTMLDivElement;
  readonly steerConfig: TouchSteerConfig;

  private readonly state: InputState = createInputState();
  private readonly held = new Set<ButtonAction>();
  /** 按钮的 pointerId -> 动作。一根手指按油门另一根按漂移，两根要各自记账 */
  private readonly pointerAction = new Map<number, ButtonAction>();
  private usePending = false;

  /** 当前布局。setHanded 之后 CSS 会把摇杆和按钮左右对调 */
  private handed: 'right' | 'left';
  private readonly stickZone: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  /** 摇杆当前是哪根手指在拉，-1 = 没人拉 */
  private stickPointer = -1;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private stickDx = 0;
  private readonly knob = { x: 0, y: 0 };

  constructor(parent: HTMLElement, options: TouchAdapterOptions = {}) {
    this.steerConfig = { ...DEFAULT_TOUCH_STEER, ...options.steer };
    this.handed = options.handed ?? 'right';
    injectTouchStyles();

    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    // 镜像布局只是一个类：所有位置都是 left/right 成对写的，
    // 换手就是把这一对互换，不需要第二套 DOM
    if (options.handed === 'left') this.root.classList.add('is-left-handed');
    this.root.style.setProperty('--stick-radius', `${this.steerConfig.radius}px`);

    this.stickZone = document.createElement('div');
    this.stickZone.className = 'touch-stick-zone';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'touch-stick-base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'touch-stick-knob';
    this.stickBase.appendChild(this.stickKnob);
    this.stickZone.appendChild(this.stickBase);
    this.root.appendChild(this.stickZone);

    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    for (const spec of BUTTONS) {
      const button = document.createElement('div');
      button.className = `touch-btn ${spec.className}`;
      button.dataset.action = spec.action;
      button.innerHTML = `<span class="touch-btn-label">${spec.label}</span><span class="touch-btn-hint">${spec.hint}</span>`;
      button.addEventListener('pointerdown', this.onButtonDown);
      button.addEventListener('pointerup', this.onButtonUp);
      button.addEventListener('pointercancel', this.onButtonUp);
      // 道具键放右上角单独一块，其余三个进右下角的按钮组
      (spec.action === 'item' ? this.root : pad).appendChild(button);
    }
    this.root.appendChild(pad);

    this.stickZone.addEventListener('pointerdown', this.onStickDown);
    this.stickZone.addEventListener('pointermove', this.onStickMove);
    this.stickZone.addEventListener('pointerup', this.onStickUp);
    this.stickZone.addEventListener('pointercancel', this.onStickUp);
    // 长按会弹出 iOS 的选择/复制菜单，按住油门时正好触发
    this.root.addEventListener('contextmenu', preventDefault);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    parent.appendChild(this.root);
  }

  // --- 摇杆 ---

  private readonly onStickDown = (e: PointerEvent) => {
    if (this.stickPointer !== -1) return; // 已经有一根手指在摇杆上了，第二根不抢
    e.preventDefault();
    this.stickPointer = e.pointerId;
    this.stickZone.setPointerCapture(e.pointerId);
    // 浮动摇杆：按下的那一点就是圆心
    const rect = this.stickZone.getBoundingClientRect();
    this.stickOriginX = e.clientX;
    this.stickOriginY = e.clientY;
    this.stickBase.style.left = `${e.clientX - rect.left}px`;
    this.stickBase.style.top = `${e.clientY - rect.top}px`;
    this.stickBase.classList.add('is-active');
    this.moveStick(e.clientX, e.clientY);
  };

  private readonly onStickMove = (e: PointerEvent) => {
    if (e.pointerId !== this.stickPointer) return;
    e.preventDefault();
    this.moveStick(e.clientX, e.clientY);
  };

  private readonly onStickUp = (e: PointerEvent) => {
    if (e.pointerId !== this.stickPointer) return;
    this.releaseStick();
  };

  private moveStick(x: number, y: number): void {
    this.stickDx = x - this.stickOriginX;
    clampKnob(this.stickDx, y - this.stickOriginY, this.steerConfig.radius, this.knob);
    this.stickKnob.style.transform = `translate(-50%, -50%) translate(${this.knob.x}px, ${this.knob.y}px)`;
  }

  private releaseStick(): void {
    this.stickPointer = -1;
    this.stickDx = 0;
    this.stickBase.classList.remove('is-active');
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
  }

  // --- 按钮 ---

  private readonly onButtonDown = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    const action = target.dataset.action as ButtonAction | undefined;
    if (!action) return;
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    target.classList.add('is-pressed');
    this.pointerAction.set(e.pointerId, action);
    if (action === 'item') this.usePending = true;
    else this.held.add(action);
  };

  private readonly onButtonUp = (e: PointerEvent) => {
    const action = this.pointerAction.get(e.pointerId);
    if (!action) return;
    this.pointerAction.delete(e.pointerId);
    (e.currentTarget as HTMLElement).classList.remove('is-pressed');
    // 同一个动作可能被两根手指按着，还有别人按着就不算松开
    if (![...this.pointerAction.values()].includes(action)) this.held.delete(action);
  };

  /** 切到后台时松开一切，回来别让车自己冲出去 */
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.releaseAll();
  };

  private releaseAll(): void {
    this.held.clear();
    this.pointerAction.clear();
    this.usePending = false;
    this.releaseStick();
    for (const el of this.root.querySelectorAll('.is-pressed')) el.classList.remove('is-pressed');
  }

  /** 切成键盘时藏起来（但不销毁，切回来还能用） */
  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
    if (!visible) this.releaseAll();
  }

  sample(): Readonly<InputState> {
    const s = this.state;
    s.steer = this.stickPointer === -1 ? 0 : steerFromOffset(this.stickDx, this.steerConfig);
    s.throttle = this.held.has('throttle') ? 1 : 0;
    // 和键盘的 back 键一样：停下之后 kartStep 会把它当倒车用
    s.brake = this.held.has('brake') ? 1 : 0;
    s.drift = this.held.has('drift');
    s.useItem = this.usePending;
    this.usePending = false;
    return s;
  }

  /** 运行时换手。设置面板里点一下就生效，不用重建适配器 */
  setHanded(handed: 'right' | 'left'): void {
    if (this.handed === handed) return;
    this.handed = handed;
    this.root.classList.toggle('is-left-handed', handed === 'left');
    // 摇杆的圆心是"按下那一点"，换手之后那个位置在另一半屏幕上，
    // 不复位的话下一次按下之前会看到一个悬在旧位置的圈
    this.releaseStick();
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.releaseAll();
    this.root.remove();
  }
}

const preventDefault = (e: Event) => e.preventDefault();

let stylesInjected = false;
function injectTouchStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* 触控层本身不吃事件，只有摇杆区和按钮吃 —— 中间那块要留给以后可能加的点击操作 */
    .touch-controls {
      position: absolute; inset: 0; pointer-events: none;
      touch-action: none; -webkit-user-select: none; user-select: none;
      -webkit-tap-highlight-color: transparent;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      z-index: 30;
    }
    .touch-controls * { touch-action: none; }

    /* 摇杆区：左下一大块。宁可大也不要小 —— 摸不准的代价是撞墙 */
    .touch-stick-zone {
      position: absolute; left: 0; bottom: 0;
      width: 46%; height: 68%;
      pointer-events: auto;
      padding: 0 0 env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    .touch-stick-base {
      position: absolute; left: 50%; top: 60%;
      width: calc(var(--stick-radius) * 2); height: calc(var(--stick-radius) * 2);
      margin-left: calc(var(--stick-radius) * -1); margin-top: calc(var(--stick-radius) * -1);
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.28);
      background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.10), rgba(0,0,0,0.18));
      opacity: 0.35; transition: opacity 120ms ease;
    }
    .touch-stick-base.is-active { opacity: 0.9; }
    .touch-stick-knob {
      position: absolute; left: 50%; top: 50%;
      width: calc(var(--stick-radius) * 1.05); height: calc(var(--stick-radius) * 1.05);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255,255,255,0.72);
      box-shadow: 0 2px 10px rgba(0,0,0,0.45);
    }

    /* 右下角按钮组：油门最大最靠角，刹车在它左边，漂移在它上面 */
    .touch-pad {
      position: absolute;
      right: calc(18px + env(safe-area-inset-right));
      bottom: calc(18px + env(safe-area-inset-bottom));
      display: grid;
      grid-template-areas: ". drift" "brake throttle";
      gap: 12px;
      pointer-events: none;
    }
    .touch-btn {
      pointer-events: auto;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.35);
      background: rgba(12,16,24,0.42);
      color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.6);
      backdrop-filter: blur(3px);
      transition: transform 70ms ease, background 70ms ease;
    }
    .touch-btn.is-pressed { transform: scale(0.92); background: rgba(255,255,255,0.34); }
    .touch-btn-label { font-size: 20px; font-weight: 700; line-height: 1; }
    .touch-btn-hint { font-size: 10px; opacity: 0.75; margin-top: 3px; }

    .touch-btn-throttle {
      grid-area: throttle;
      width: clamp(76px, 17vmin, 128px); height: clamp(76px, 17vmin, 128px);
      background: rgba(60,180,110,0.34); border-color: rgba(120,255,190,0.5);
    }
    .touch-btn-brake {
      grid-area: brake;
      width: clamp(62px, 13vmin, 100px); height: clamp(62px, 13vmin, 100px);
      background: rgba(200,70,70,0.32); border-color: rgba(255,150,150,0.5);
    }
    .touch-btn-drift {
      grid-area: drift;
      width: clamp(66px, 14vmin, 108px); height: clamp(66px, 14vmin, 108px);
      background: rgba(70,120,220,0.32); border-color: rgba(150,190,255,0.55);
    }
    .touch-btn-drift .touch-btn-label { font-size: 13px; letter-spacing: 1px; }
    .touch-btn-item {
      position: absolute;
      top: calc(14px + env(safe-area-inset-top));
      right: calc(18px + env(safe-area-inset-right));
      width: clamp(58px, 12vmin, 92px); height: clamp(58px, 12vmin, 92px);
      background: rgba(230,180,40,0.30); border-color: rgba(255,225,140,0.55);
    }
    .touch-btn-item .touch-btn-label { font-size: 14px; }
    .touch-btn-item .touch-btn-hint { display: none; }

    /* --- 左手布局：整个控件区左右镜像 ---
       所有位置本来就是成对写的（摇杆 left / 按钮组 right），所以换手就是把这一对
       互换，不需要第二套 DOM，也不用重建适配器。
       注意安全区也要跟着换边：刘海在横屏时只在一侧 */
    .touch-controls.is-left-handed .touch-stick-zone {
      left: auto; right: 0;
      padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) 0;
    }
    .touch-controls.is-left-handed .touch-pad {
      right: auto;
      left: calc(18px + env(safe-area-inset-left));
      /* 油门在最靠角那一格：镜像之后"角"换到了左边 */
      grid-template-areas: "drift ." "throttle brake";
    }
    .touch-controls.is-left-handed .touch-btn-item {
      right: auto;
      left: calc(18px + env(safe-area-inset-left));
    }

    /* 屏幕矮的时候（横屏手机）整体缩一点，别把画面挡完 */
    @media (max-height: 420px) {
      .touch-stick-zone { height: 78%; }
      .touch-pad { gap: 9px; bottom: calc(10px + env(safe-area-inset-bottom)); }
    }
  `;
  document.head.appendChild(style);
}
