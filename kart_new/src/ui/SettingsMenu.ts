import type { Prefs } from '../core/Prefs';
import type { InputMode, InputModeSetting } from '../input/InputMode';
import type { QualityTier, TierOverride } from '../render/QualityTiers';
import { injectTheme } from './theme';

/**
 * 设置面板：画质档位 + 操作方式 + 音量。
 *
 * 和 lil-gui 的调参面板分开，因为读者不一样：那个是给调手感的人用的（键盘、桌面、
 * 一屏几十个滑条），这个是给玩家在手机上用的 —— 一共四行，手指点得着。
 *
 * 画质和操作是"自动 + 手动覆盖"：自动挡照顾大多数人，手动挡照顾探测判错的那些机器。
 * 音量三件（总音量、音乐、静音）是纯偏好，没有自动挡。
 */
export interface SettingsMenuOptions {
  prefs: Prefs;
  /** 探测出来的值，显示在"自动"那一格的副标题上 */
  detectedTier: QualityTier;
  detectedInput: InputMode;
  onQuality: (value: TierOverride) => void;
  onInput: (value: InputModeSetting) => void;
  /** 音量改变。bus 'master' 是总音量，'music' 是背景音乐 */
  onVolume: (bus: 'master' | 'music', value: number) => void;
  onMuted: (muted: boolean) => void;
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
  private readonly toggleButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly qualityButtons = new Map<TierOverride, HTMLButtonElement>();
  private readonly inputButtons = new Map<InputModeSetting, HTMLButtonElement>();
  private open = false;

  constructor(parent: HTMLElement, private readonly options: SettingsMenuOptions) {
    injectTheme();
    injectSettingsStyles();

    this.root = document.createElement('div');
    this.root.className = 'settings';
    this.root.innerHTML = `
      <button class="settings-toggle" type="button" aria-label="设置">⚙</button>
      <div class="settings-panel k-panel">
        <div class="settings-row">
          <div class="settings-label">画质</div>
          <div class="k-seg settings-quality"></div>
        </div>
        <div class="settings-row">
          <div class="settings-label">操作</div>
          <div class="k-seg settings-input"></div>
        </div>
        <div class="settings-row">
          <div class="settings-label">音量</div>
          <input class="k-range settings-master" type="range" min="0" max="1" step="0.05" aria-label="总音量" />
          <button class="settings-mute k-btn k-btn-ghost" type="button" aria-label="静音">🔊</button>
        </div>
        <div class="settings-row">
          <div class="settings-label">音乐</div>
          <input class="k-range settings-music" type="range" min="0" max="1" step="0.05" aria-label="音乐音量" />
        </div>
        <div class="settings-note"></div>
      </div>
    `;
    parent.appendChild(this.root);

    this.panel = this.root.querySelector('.settings-panel')!;
    this.note = this.root.querySelector('.settings-note')!;
    this.toggleButton = this.root.querySelector('.settings-toggle')!;
    this.muteButton = this.root.querySelector('.settings-mute')!;

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

    const master = this.root.querySelector<HTMLInputElement>('.settings-master')!;
    const music = this.root.querySelector<HTMLInputElement>('.settings-music')!;
    master.value = String(options.prefs.volume);
    music.value = String(options.prefs.musicVolume);
    // input 而不是 change：拖动过程中就要听到变化，不然没法边听边调
    master.addEventListener('input', () => this.options.onVolume('master', Number(master.value)));
    music.addEventListener('input', () => this.options.onVolume('music', Number(music.value)));

    this.muteButton.addEventListener('click', () => {
      const muted = !this.options.prefs.muted;
      this.options.onMuted(muted);
      this.setMuted(muted);
    });

    this.toggleButton.addEventListener('click', () => this.toggle());
    this.setQuality(options.prefs.quality);
    this.setInput(options.prefs.input);
    this.setMuted(options.prefs.muted);
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

  setMuted(muted: boolean): void {
    // 图标本身就是状态：喇叭上有没有那道杠一眼看得出，比文字快
    this.muteButton.textContent = muted ? '🔇' : '🔊';
    this.muteButton.classList.toggle('is-muted', muted);
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
      position: absolute; z-index: 95;
      left: calc(136px + env(safe-area-inset-left));
      top: calc(14px + env(safe-area-inset-top));
      font-family: var(--k-font);
    }
    .settings-toggle {
      pointer-events: auto;
      width: 40px; height: 40px; border-radius: 50%;
      border: 1px solid var(--k-panel-line);
      background: rgba(13,17,27,0.55); color: var(--k-text);
      font-size: 18px; line-height: 1; cursor: pointer;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      -webkit-tap-highlight-color: transparent;
      transition: transform 140ms ease;
    }
    .settings-toggle:active { transform: rotate(60deg); }
    .settings-panel {
      position: absolute; left: 0; top: 48px;
      width: 280px; padding: 14px;
      color: var(--k-text);
      display: none;
    }
    .settings-panel.is-open { display: block; }
    .settings-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .settings-label { font-size: 12px; color: var(--k-text-dim); width: 28px; flex: none; }
    .settings-row .k-seg { flex: 1; }
    /* 静音键复用 k-btn 的手感，但要收成一个正方形小键 */
    .settings-mute {
      flex: none; width: 34px; height: 34px; padding: 0;
      font-size: 15px; border-radius: var(--k-r-sm);
    }
    .settings-mute.is-muted { color: var(--k-danger); }
    .settings-note {
      font-size: 11px; color: var(--k-text-dim); line-height: 1.5; white-space: pre-line;
    }
  `;
  document.head.appendChild(style);
}
