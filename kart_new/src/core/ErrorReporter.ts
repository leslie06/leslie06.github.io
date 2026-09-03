/**
 * 错误收集。**不往任何服务器发东西** —— 这个项目没有后端，也不该为了收错误
 * 就去连一个。它做的是：把运行期间所有异常攒在一个环形缓冲里，随时能导出成
 * 一段可以直接贴进 issue 的文本。
 *
 * 收三个来源：
 *   - `window.onerror`：同步异常和资源加载失败；
 *   - `unhandledrejection`：没 catch 的 Promise（这个项目里加载资源全是异步的，
 *     漏掉它等于漏掉一半错误）；
 *   - `console.error` / `console.warn`：three 和我们自己的很多"降级了"提示走这条，
 *     它们不是异常但恰恰是排查用户反馈时最有用的线索。
 *
 * 玩家反馈"我这儿黑屏"的时候，让他打开设置里的"复制诊断信息"贴过来，
 * 比来回问二十句有用。
 */

export type ErrorKind = 'error' | 'rejection' | 'console' | 'manual';

export interface ErrorEntry {
  /** 页面加载后的毫秒数。用绝对时间没意义，要的是"第几秒出的事" */
  at: number;
  kind: ErrorKind;
  message: string;
  stack?: string;
  /** 同一条连着出现了几次。刷屏的错误折叠成一条，不然缓冲区一秒就被冲光 */
  count: number;
}

/** 最多留多少条。超了丢最老的 */
const MAX_ENTRIES = 40;
/** 单条消息的长度上限，防止一条几万字的报错把整个报告撑爆 */
const MAX_MESSAGE = 600;

export class ErrorReporter {
  private readonly entries: ErrorEntry[] = [];
  private readonly context = new Map<string, string>();
  private readonly startedAt = Date.now();
  private installed = false;
  private originalError: typeof console.error | null = null;
  private originalWarn: typeof console.warn | null = null;

  /** 有几条错误（不含 warn）。设置面板上显示一个小红点用 */
  get errorCount(): number {
    return this.entries.filter((e) => e.kind !== 'console' || e.message.startsWith('[error]')).length;
  }

  get all(): readonly ErrorEntry[] {
    return this.entries;
  }

  /**
   * 挂上全局钩子。**要在最早的地方调**（main.ts 的第一行），
   * 晚了的话启动期间的错误就漏了 —— 而那正是最要命的一段。
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);

    // 包一层而不是替换：原来的行为（控制台里照样有红字）必须留着
    this.originalError = console.error.bind(console);
    this.originalWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => {
      this.record('console', `[error] ${format(args)}`);
      this.originalError?.(...args);
    };
    console.warn = (...args: unknown[]) => {
      this.record('console', `[warn] ${format(args)}`);
      this.originalWarn?.(...args);
    };

    // 方便在真机上排查：手机没有控制台，但能在地址栏敲这个
    (window as unknown as Record<string, unknown>).kartReport = () => this.report();
  }

  /** 补一条上下文（画质档位、赛道、设备），会出现在报告的抬头里 */
  setContext(key: string, value: string): void {
    this.context.set(key, value);
  }

  record(kind: ErrorKind, message: string, stack?: string): void {
    const text = message.slice(0, MAX_MESSAGE);
    const last = this.entries[this.entries.length - 1];
    // 连着来的同一条只加计数。一个每帧都抛的错误能在一秒内产生 60 条
    if (last && last.kind === kind && last.message === text) {
      last.count++;
      return;
    }
    this.entries.push({
      at: Date.now() - this.startedAt,
      kind,
      message: text,
      stack: stack?.slice(0, MAX_MESSAGE),
      count: 1,
    });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  private readonly onError = (event: ErrorEvent) => {
    const where = event.filename ? ` @ ${trimUrl(event.filename)}:${event.lineno}` : '';
    this.record('error', `${event.message}${where}`, event.error?.stack);
  };

  private readonly onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: string; stack?: string } | string | undefined;
    const message = typeof reason === 'string' ? reason : (reason?.message ?? String(reason));
    this.record('rejection', message, typeof reason === 'object' ? reason?.stack : undefined);
  };

  /** 一段可以直接贴进 issue 的诊断文本 */
  report(): string {
    const lines: string[] = ['=== Kart 诊断信息 ==='];
    lines.push(`时间: ${new Date().toISOString()}`);
    lines.push(`页面: ${location.href}`);
    lines.push(`UA: ${navigator.userAgent}`);
    for (const [key, value] of this.context) lines.push(`${key}: ${value}`);
    lines.push(`错误 ${this.entries.length} 条:`);
    if (this.entries.length === 0) lines.push('  （没有）');
    for (const e of this.entries) {
      const times = e.count > 1 ? ` ×${e.count}` : '';
      lines.push(`  [${(e.at / 1000).toFixed(1)}s ${e.kind}${times}] ${e.message}`);
      if (e.stack) lines.push(`      ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
    }
    return lines.join('\n');
  }

  dispose(): void {
    if (!this.installed) return;
    this.installed = false;
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    if (this.originalError) console.error = this.originalError;
    if (this.originalWarn) console.warn = this.originalWarn;
  }
}

/** console 的参数可能是任何东西，包括循环引用的对象 */
function format(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** 打包后的文件名带一长串 hash，报告里只留最后一段就够认了 */
function trimUrl(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}
