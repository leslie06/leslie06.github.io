/**
 * iOS Safari / 移动浏览器的几个专项处理。
 *
 * 这些都是"不做就一定出事"的那类问题，跟游戏逻辑无关，所以集中放在这里：
 *   - 竖屏遮罩：横屏才有得玩，竖屏时直接盖住并说清楚要干嘛；
 *   - WebGL 上下文丢失：iOS 内存一紧就会把上下文收走，不监听的话就是一片黑；
 *   - 双击缩放 / 长按选择 / 橡皮筋滚动：默认行为在游戏里全是干扰。
 */

/** 竖屏时盖一层"请横屏"。只在触屏模式下启用 —— 桌面窗口拉窄了不该弹这个 */
export class OrientationGate {
  private readonly root: HTMLDivElement;
  private enabled = false;
  private readonly query: MediaQueryList | null;

  /** 竖屏状态变化时回调（主循环可以借此暂停） */
  onChange: ((portrait: boolean) => void) | null = null;

  constructor(parent: HTMLElement) {
    injectOverlayStyles();
    this.root = document.createElement('div');
    this.root.className = 'device-overlay orientation-gate';
    this.root.innerHTML = `
      <div class="device-overlay-box">
        <div class="device-overlay-icon">📱↻</div>
        <div class="device-overlay-title">请横屏游玩</div>
        <div class="device-overlay-text">把手机转过来，视野和虚拟摇杆都是按横屏排的</div>
      </div>
    `;
    parent.appendChild(this.root);

    this.query = typeof matchMedia === 'function' ? matchMedia('(orientation: portrait)') : null;
    this.query?.addEventListener('change', this.refresh);
    // 有些安卓浏览器转屏时不触发 media query，resize 兜底
    window.addEventListener('resize', this.refresh);
  }

  get isPortrait(): boolean {
    if (this.query) return this.query.matches;
    return window.innerHeight > window.innerWidth;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.refresh();
  }

  private readonly refresh = () => {
    const show = this.enabled && this.isPortrait;
    this.root.classList.toggle('is-visible', show);
    this.onChange?.(show);
  };

  dispose(): void {
    this.query?.removeEventListener('change', this.refresh);
    window.removeEventListener('resize', this.refresh);
    this.root.remove();
  }
}

export interface ContextLossGuardOptions {
  /** 上下文没了：主循环要停掉，不然每帧都在往一个死掉的上下文里画 */
  onLost?: () => void;
  /** 浏览器把上下文还回来了 */
  onRestored?: () => void;
}

/**
 * 监听 WebGL 上下文丢失。
 *
 * webglcontextlost 必须 preventDefault，否则浏览器根本不会尝试恢复 —— 这是
 * 规范里的规定，也是最容易漏的一步。恢复之后 three 会自己重传贴图和缓冲，
 * 但物理世界、比赛进度这些是我们自己的状态，稳妥起见给玩家一个"重新载入"的按钮。
 */
export function installContextLossGuard(
  canvas: HTMLCanvasElement,
  parent: HTMLElement,
  options: ContextLossGuardOptions = {},
): { dispose(): void } {
  injectOverlayStyles();
  const overlay = document.createElement('div');
  overlay.className = 'device-overlay context-lost';
  overlay.innerHTML = `
    <div class="device-overlay-box">
      <div class="device-overlay-icon">⚠️</div>
      <div class="device-overlay-title">画面被系统回收了</div>
      <div class="device-overlay-text">手机内存吃紧时会发生。点下面的按钮重新载入。</div>
      <button class="device-overlay-btn" type="button">重新载入</button>
    </div>
  `;
  parent.appendChild(overlay);
  overlay.querySelector('button')!.addEventListener('click', () => location.reload());

  const onLost = (event: Event) => {
    event.preventDefault(); // 不拦下来浏览器就不会走恢复流程
    overlay.classList.add('is-visible');
    options.onLost?.();
  };
  const onRestored = () => {
    overlay.classList.remove('is-visible');
    options.onRestored?.();
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    dispose(): void {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      overlay.remove();
    },
  };
}

/**
 * 关掉浏览器的几个默认手势。
 *
 * - gesturestart：Safari 的双指缩放（viewport 里的 user-scalable=no 在 iOS 10 之后被无视了）
 * - 300ms 内的第二次 touchend：双击缩放
 * - touchmove：整页橡皮筋。游戏是满屏固定布局，没有任何东西需要滚
 */
export function installGestureGuards(target: HTMLElement = document.body): { dispose(): void } {
  let lastTouchEnd = 0;

  const onGesture = (e: Event) => e.preventDefault();
  const onTouchEnd = (e: TouchEvent) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) e.preventDefault();
    lastTouchEnd = now;
  };
  const onTouchMove = (e: TouchEvent) => {
    // 多指手势（缩放）和单指拖拽一律拦掉
    e.preventDefault();
  };

  target.addEventListener('gesturestart', onGesture);
  target.addEventListener('gesturechange', onGesture);
  document.addEventListener('touchend', onTouchEnd, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });

  return {
    dispose(): void {
      target.removeEventListener('gesturestart', onGesture);
      target.removeEventListener('gesturechange', onGesture);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchmove', onTouchMove);
    },
  };
}

let injected = false;
function injectOverlayStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    .device-overlay {
      position: fixed; inset: 0; z-index: 90;
      display: none; align-items: center; justify-content: center;
      background: rgba(8,11,17,0.94); color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    }
    .device-overlay.is-visible { display: flex; }
    .device-overlay-box { text-align: center; max-width: 78vw; }
    .device-overlay-icon { font-size: 42px; margin-bottom: 14px; }
    .device-overlay-title { font-size: 19px; font-weight: 700; margin-bottom: 8px; }
    .device-overlay-text { font-size: 13px; opacity: 0.7; line-height: 1.6; }
    .device-overlay-btn {
      margin-top: 18px; padding: 10px 22px;
      border-radius: 9px; border: 1px solid rgba(255,255,255,0.25);
      background: #4d9bff; color: #06101f; font-weight: 700; font-family: inherit;
      font-size: 14px; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}
