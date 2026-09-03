/** DOM HUD：速度 + FPS + 操作提示。用 DOM 不用 canvas，改起来快。 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly speedValue: HTMLSpanElement;
  private readonly fpsValue: HTMLSpanElement;
  private readonly driftValue: HTMLSpanElement;
  private readonly speedLines: HTMLDivElement;

  private frames = 0;
  private elapsed = 0;
  private fps = 0;

  constructor(parent: HTMLElement) {
    injectStyles();

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-speedlines"></div>
      <div class="hud-speed">
        <span class="hud-speed-value">0</span><span class="hud-speed-unit">km/h</span>
      </div>
      <div class="hud-stats">FPS <span class="hud-fps">0</span> · <span class="hud-drift">—</span></div>
      <div class="hud-help">W/↑ 油门 · S/↓ 刹车倒车 · A D/← → 转向 · Space 刹车 · Shift 漂移</div>
    `;
    parent.appendChild(this.root);

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
      color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.55);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .hud-speed {
      position: absolute; left: 24px; bottom: 22px;
      display: flex; align-items: baseline; gap: 6px;
    }
    .hud-speed-value { font-size: 68px; font-weight: 700; letter-spacing: -2px; line-height: 1; }
    .hud-speed-unit { font-size: 16px; opacity: 0.75; }
    .hud-stats {
      position: absolute; left: 24px; top: 20px;
      font-size: 13px; opacity: 0.8;
      background: rgba(0,0,0,0.28); padding: 5px 9px; border-radius: 6px;
    }
    .hud-help {
      position: absolute; left: 0; right: 0; bottom: 6px;
      text-align: center; font-size: 12px; opacity: 0.6;
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
      .hud-speed-value { font-size: 44px; }
      .hud-help { display: none; }
    }
  `;
  document.head.appendChild(style);
}
