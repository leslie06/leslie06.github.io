/**
 * AudioContext 的解锁。
 *
 * iOS Safari（以及现在的 Chrome）只允许在**用户手势的事件处理函数里**创建/恢复
 * AudioContext。不这么做的话 context 会一直是 'suspended'，之后你播什么都是静音，
 * 而且不报任何错 —— 排查起来非常费劲，所以这件事必须在第一次触摸/按键时就办掉。
 *
 * 这里只负责"拿到一个能出声的 context"，不管具体播什么。之后接音效的时候
 * 从 audio.context 拿这个实例用就行。
 */
export class AudioUnlock {
  private ctx: AudioContext | null = null;
  private readonly callbacks: Array<(ctx: AudioContext) => void> = [];
  private disposed = false;

  constructor(private readonly target: EventTarget = window) {
    for (const type of GESTURES) {
      this.target.addEventListener(type, this.onGesture, GESTURE_OPTIONS);
    }
    // 切回前台时 iOS 会把 context 挂起，回来要再 resume 一次
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** 解锁之后调一次（已经解锁了就立刻调） */
  onUnlock(callback: (ctx: AudioContext) => void): void {
    if (this.unlocked && this.ctx) callback(this.ctx);
    else this.callbacks.push(callback);
  }

  private readonly onGesture = () => {
    if (this.disposed) return;
    const Ctor =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return this.stopListening();

    if (!this.ctx) this.ctx = new Ctor();
    void this.ctx.resume();

    // 播一个 1 帧的空 buffer。光 resume 在老 iOS 上不算数，
    // 必须真的走一次 start() 才会解锁
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      source.connect(this.ctx.destination);
      source.start(0);
    } catch {
      // 有的浏览器在 suspended 状态下 start 会抛，忽略：下一次手势还会再来一遍
    }

    if (this.ctx.state === 'running') {
      this.stopListening();
      const ctx = this.ctx;
      for (const callback of this.callbacks.splice(0)) callback(ctx);
    }
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') void this.ctx?.resume();
  };

  private stopListening(): void {
    for (const type of GESTURES) this.target.removeEventListener(type, this.onGesture, GESTURE_OPTIONS);
  }

  dispose(): void {
    this.disposed = true;
    this.stopListening();
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** 能算"用户手势"的几个事件。touchend 比 touchstart 稳：iOS 上 touchstart 有时不算数 */
const GESTURES = ['touchend', 'pointerdown', 'mousedown', 'keydown'] as const;
const GESTURE_OPTIONS: AddEventListenerOptions = { passive: true };
