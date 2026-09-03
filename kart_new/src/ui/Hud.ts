import { injectTheme } from './theme';

/** DOM HUD：速度 + FPS + 操作提示。用 DOM 不用 canvas，改起来快，而且天然按 dpr 清晰。 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly speed: HTMLElement;
  private readonly speedValue: HTMLSpanElement;
  private readonly fpsValue: HTMLSpanElement;
  private readonly driftValue: HTMLSpanElement;
  private readonly speedLines: HTMLDivElement;

  private frames = 0;
  private elapsed = 0;
  private fps = 0;
  private boosting = false;

  constructor(parent: HTMLElement) {
    injectTheme();
    injectStyles();

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-speedlines"></div>
      <div class="hud-speed k-outline-lg">
        <span class="hud-speed-value k-num">0</span><span class="hud-speed-unit">km/h</span>
      </div>
      <div class="hud-stats k-chip">FPS <span class="hud-fps k-num">0</span> · <span class="hud-drift">—</span></div>
      <div class="hud-help">W/↑ 油门 · S/↓ 刹车倒车 · A D/← → 转向 · Space 刹车 · Shift 漂移 · Q/右键 道具 · R 重开 · H 收调参面板</div>
    `;
    parent.appendChild(this.root);

    this.speed = this.root.querySelector('.hud-speed')!;
    this.speedValue = this.root.querySelector('.hud-speed-value')!;
    this.fpsValue = this.root.querySelector('.hud-fps')!;
    this.driftValue = this.root.querySelector('.hud-drift')!;
    this.speedLines = this.root.querySelector('.hud-speedlines')!;
  }

  /**
   * @param speed m/s
   * @param boostIntensity 0..1，boost 越强速度线越明显
   * @param driftLabel 漂移/蓄力状态文字
   */
  update(speed: number, frameDt: number, boostIntensity = 0, driftLabel = '—'): void {
    this.speedValue.textContent = String(Math.round(Math.abs(speed) * 3.6));
    this.speedLines.style.opacity = boostIntensity.toFixed(3);
    // boost 时速度数字变金色。速度线在边缘，眼睛盯着路中间时不一定注意得到，
    // 数字变色是"我在加速"的第二个提示
    const boosting = boostIntensity > 0.05;
    if (boosting !== this.boosting) {
      this.boosting = boosting;
      this.speed.classList.toggle('is-boosting', boosting);
    }
    if (this.driftValue.textContent !== driftLabel) this.driftValue.textContent = driftLabel;

    this.frames++;
    this.elapsed += frameDt;
    if (this.elapsed >= 0.25) {
      this.fps = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
      this.fpsValue.textContent = this.fps.toFixed(0);
    }
  }
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .hud {
      position: absolute; inset: 0; pointer-events: none;
      color: var(--k-text); font-family: var(--k-font);
    }
    .hud-speed {
      position: absolute; left: 26px; bottom: 24px;
      display: flex; align-items: baseline; gap: 6px;
      transition: color 140ms ease;
    }
    .hud-speed.is-boosting { color: var(--k-gold); }
    .hud-speed-value { font-size: 74px; font-weight: 900; letter-spacing: -3px; line-height: 0.9; }
    .hud-speed-unit { font-size: 15px; font-weight: 700; opacity: 0.85; letter-spacing: 1px; }
    .hud-stats {
      position: absolute; left: 26px; top: 20px;
      font-size: 12px; font-weight: 600; color: var(--k-text-dim);
      padding: 6px 11px;
    }
    .hud-help {
      position: absolute; left: 0; right: 0; bottom: 8px;
      text-align: center; font-size: 12px; color: rgba(255,255,255,0.55);
      text-shadow: 0 2px 6px rgba(0,0,0,0.6);
    }
    /* boost 速度线：屏幕边缘往内收的放射状条纹，中间留空不挡视线 */
    .hud-speedlines {
      position: absolute; inset: 0; opacity: 0;
      transition: opacity 90ms linear;
      background:
        repeating-conic-gradient(from 0deg at 50% 50%,
          rgba(255,255,255,0.5) 0deg 0.7deg, transparent 0.7deg 4deg);
      -webkit-mask-image: radial-gradient(ellipse 42% 42% at 50% 50%, transparent 55%, #000 100%);
      mask-image: radial-gradient(ellipse 42% 42% at 50% 50%, transparent 55%, #000 100%);
      mix-blend-mode: screen;
    }
    @media (max-width: 640px) {
      .hud-speed-value { font-size: 46px; letter-spacing: -2px; }
      .hud-help { display: none; }
    }
    /* 触屏时按键提示是错的（按钮就在屏幕上），直接不显示 */
    body.touch-input .hud-help { display: none; }
    /* 触屏时速度表留在左下角，但要缩小并让开刘海/小白条。
       摇杆区盖在它上面没关系：HUD 整层是 pointer-events: none，挡不住手指 */
    body.touch-input .hud-speed {
      left: calc(20px + env(safe-area-inset-left));
      bottom: calc(12px + env(safe-area-inset-bottom));
    }
    body.touch-input .hud-speed-value { font-size: 42px; }
  `;
  document.head.appendChild(style);
}
