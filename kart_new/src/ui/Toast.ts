/**
 * 屏幕中下方的一句话提示。自动降画质、上下文恢复这类"系统替你做了个决定"
 * 的事必须说出来，不然玩家只会觉得"画面怎么突然变糊了"。
 */
import { injectTheme } from './theme';

export class Toast {
  private readonly root: HTMLDivElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    injectTheme();
    injectToastStyles();
    this.root = document.createElement('div');
    this.root.className = 'toast';
    parent.appendChild(this.root);
  }

  show(text: string, seconds = 3): void {
    this.root.textContent = text;
    this.root.classList.add('is-visible');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.root.classList.remove('is-visible'), seconds * 1000) as unknown as number;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.root.remove();
  }
}

let injected = false;
function injectToastStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      position: absolute; left: 50%; transform: translateX(-50%);
      bottom: calc(84px + env(safe-area-inset-bottom));
      padding: 10px 18px; border-radius: var(--k-r-pill);
      background: var(--k-panel); color: var(--k-text);
      font-family: var(--k-font); font-size: 13px; font-weight: 600;
      border: 1px solid var(--k-panel-line);
      box-shadow: var(--k-shadow-chip);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      opacity: 0; pointer-events: none; z-index: 60;
      transition: opacity 220ms ease;
      max-width: min(80vw, 460px); text-align: center;
    }
    .toast.is-visible { opacity: 1; }
  `;
  document.head.appendChild(style);
}
