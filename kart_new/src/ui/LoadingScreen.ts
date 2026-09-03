import type { LoadSnapshot } from '../assets/LoadProgress';
import { injectTheme } from './theme';

/**
 * 首屏加载界面：一条进度条 + 当前在做什么。
 *
 * 直接写在 DOM 里而不是等 three 起来再画：它要在**第一帧之前**就有东西可看。
 * 手机上从点开链接到能开车中间有好几秒（wasm 编译、赛道网格挤出），
 * 这几秒黑屏的话玩家会以为页面挂了。
 */
export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly label: HTMLElement;
  private readonly percent: HTMLElement;

  constructor(parent: HTMLElement) {
    injectTheme();
    injectLoadingStyles();
    this.root = document.createElement('div');
    this.root.className = 'loading-screen';
    this.root.innerHTML = `
      <div class="loading-box">
        <div class="loading-title k-outline-lg">KART</div>
        <div class="loading-bar"><div class="loading-fill"></div></div>
        <div class="loading-foot">
          <span class="loading-label">准备中…</span>
          <span class="loading-percent k-num">0%</span>
        </div>
      </div>
    `;
    parent.appendChild(this.root);
    this.bar = this.root.querySelector('.loading-fill')!;
    this.label = this.root.querySelector('.loading-label')!;
    this.percent = this.root.querySelector('.loading-percent')!;
  }

  update(snapshot: LoadSnapshot): void {
    const pct = Math.round(snapshot.ratio * 100);
    this.bar.style.width = `${pct}%`;
    this.percent.textContent = `${pct}%`;
    if (this.label.textContent !== snapshot.label) this.label.textContent = snapshot.label;
  }

  /** 淡出后从 DOM 里摘掉。淡出期间它是 pointer-events: none，不挡操作 */
  hide(): void {
    this.root.classList.add('is-hidden');
    this.root.addEventListener('transitionend', () => this.root.remove(), { once: true });
    // transitionend 在标签页后台时不会来，兜个底
    setTimeout(() => this.root.remove(), 1200);
  }
}

let injected = false;
function injectLoadingStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    .loading-screen {
      position: fixed; inset: 0; z-index: 100;
      display: flex; align-items: center; justify-content: center;
      /* 和主菜单同一片天：菜单 -> 加载 -> 赛道，底色是连续的 */
      background: radial-gradient(120% 90% at 50% 12%, #7fc4f2 0%, #3f7fc0 48%, #16233a 100%);
      color: var(--k-text); font-family: var(--k-font);
      transition: opacity 320ms ease;
    }
    .loading-screen.is-hidden { opacity: 0; pointer-events: none; }
    .loading-box { width: min(72vw, 420px); }
    .loading-title {
      font-size: clamp(38px, 9vw, 56px); font-weight: 900; letter-spacing: 10px;
      text-align: center; margin: 0 -10px 22px 0;
    }
    .loading-bar {
      height: 8px; border-radius: var(--k-r-pill); overflow: hidden;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.16);
    }
    .loading-fill {
      height: 100%; width: 0%; border-radius: var(--k-r-pill);
      background: linear-gradient(90deg, var(--k-accent), var(--k-gold));
      transition: width 110ms ease;
    }
    .loading-foot {
      display: flex; justify-content: space-between;
      margin-top: 12px; font-size: 12px; color: rgba(255,255,255,0.78);
    }
  `;
  document.head.appendChild(style);
}
