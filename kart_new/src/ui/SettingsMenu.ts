import type { Prefs } from '../core/Prefs';
import type { InputMode, InputModeSetting } from '../input/InputMode';
import type { QualityTier, TierOverride } from '../render/QualityTiers';

/**
 * 设置面板：画质档位 + 操作方式。
 *
 * 和 lil-gui 的调参面板分开，因为读者不一样：那个是给调手感的人用的（键盘、桌面、
 * 一屏几十个滑条），这个是给玩家在手机上用的 —— 一共两行，手指点得着。
 *
 * 两项都是"自动 + 手动覆盖"：自动挡照顾大多数人，手动挡照顾探测判错的那些机器。
 */
export interface SettingsMenuOptions {
  prefs: Prefs;
  /** 探测出来的值，显示在"自动"那一格的副标题上 */
  detectedTier: QualityTier;
  detectedInput: InputMode;
  onQuality: (value: TierOverride) => void;
  onInput: (value: InputModeSetting) => void;
}

const TIER_LABELS: Record<TierOverride, string> = {
  auto: '自动',
  high: '高',
  medium: '中',
  low: '低',
};

const INPUT_LABELS: Record<InputModeSetting, string> = {
  auto: '自动',
  keyboard: '键盘',
  touch: '触屏',
};

export class SettingsMenu {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly note: HTMLElement;
  private readonly qualityButtons = new Map<TierOverride, HTMLButtonElement>();
  private readonly inputButtons = new Map<InputModeSetting, HTMLButtonElement>();
  private open = false;

  constructor(parent: HTMLElement, private readonly options: SettingsMenuOptions) {
    injectSettingsStyles();

    this.root = document.createElement('div');
    this.root.className = 'settings';
    this.root.innerHTML = `
      <button class="settings-toggle" type="button" aria-label="设置">⚙</button>
      <div class="settings-panel">
        <div class="settings-row">
          <div class="settings-label">画质</div>
          <div class="settings-seg settings-quality"></div>
        </div>
        <div class="settings-row">
          <div class="settings-label">操作</div>
          <div class="settings-seg settings-input"></div>
        </div>
        <div class="settings-note"></div>
      </div>
    `;
    parent.appendChild(this.root);

    this.panel = this.root.querySelector('.settings-panel')!;
    this.note = this.root.querySelector('.settings-note')!;

    const qualityRow = this.root.querySelector('.settings-quality')!;
    for (const value of ['auto', 'high', 'medium', 'low'] as const) {
      this.qualityButtons.set(value, this.addButton(qualityRow, TIER_LABELS[value], () => {
        this.options.onQuality(value);
        this.setQuality(value);
      }));
    }

    const inputRow = this.root.querySelector('.settings-input')!;
    for (const value of ['auto', 'keyboard', 'touch'] as const) {
      this.inputButtons.set(value, this.addButton(inputRow, INPUT_LABELS[value], () => {
        this.options.onInput(value);
        this.setInput(value);
      }));
    }

    this.root.querySelector('.settings-toggle')!.addEventListener('click', () => this.toggle());
    this.setQuality(options.prefs.quality);
    this.setInput(options.prefs.input);
  }

  private addButton(row: Element, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    row.appendChild(button);
    return button;
  }

  private toggle(): void {
    this.open = !this.open;
    this.panel.classList.toggle('is-open', this.open);
  }

  /** 同步画质那一行的高亮 + 说明文字 */
  setQuality(value: TierOverride): void {
    for (const [key, button] of this.qualityButtons) button.classList.toggle('is-on', key === value);
    this.refreshNote(value);
  }

  setInput(value: InputModeSetting): void {
    for (const [key, button] of this.inputButtons) button.classList.toggle('is-on', key === value);
  }

  /** 帧率自适应降档之后调，把面板上的显示和实际跑的档位对上 */
  setActiveTier(tier: QualityTier, override: TierOverride): void {
    this.options.detectedTier = tier;
    this.setQuality(override);
  }

  private refreshNote(value: TierOverride): void {
    const auto = value === 'auto' ? `（当前 ${TIER_LABELS[this.options.detectedTier]}）` : '';
    this.note.textContent =
      `自动挡会按设备能力选档${auto}，跑起来掉帧还会自动往下降。` +
      `\n对手数量要重新载入页面才会跟着档位变，其它改动立刻生效。`;
  }

  dispose(): void {
    this.root.remove();
  }
}

let injected = false;
function injectSettingsStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* 左上角、FPS 读数那一条的右边。这一块是布局里唯一两种操作模式下都空着的地方：
       左下是速度表和虚拟摇杆，右下是按钮组，右上是道具键和调参面板 */
    .settings {
      position: absolute; z-index: 50;
      left: calc(136px + env(safe-area-inset-left));
      top: calc(14px + env(safe-area-inset-top));
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .settings-toggle {
      width: 40px; height: 40px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(12,16,24,0.55); color: #fff;
      font-size: 18px; line-height: 1; cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .settings-panel {
      position: absolute; left: 0; top: 46px;
      width: 260px; padding: 12px;
      border-radius: 12px; border: 1px solid rgba(255,255,255,0.16);
      background: rgba(12,16,24,0.9); color: #fff;
      display: none;
    }
    .settings-panel.is-open { display: block; }
    .settings-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .settings-label { font-size: 12px; opacity: 0.7; width: 28px; flex: none; }
    .settings-seg { display: flex; gap: 4px; flex: 1; }
    .settings-seg button {
      flex: 1; padding: 7px 0; font-size: 12px;
      border-radius: 7px; cursor: pointer;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.06); color: #fff;
      font-family: inherit; -webkit-tap-highlight-color: transparent;
    }
    .settings-seg button.is-on { background: #4d9bff; border-color: #4d9bff; color: #06101f; font-weight: 700; }
    .settings-note { font-size: 11px; opacity: 0.55; line-height: 1.5; white-space: pre-line; }
  `;
  document.head.appendChild(style);
}
