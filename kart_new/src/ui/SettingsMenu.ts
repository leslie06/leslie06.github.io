import type { Prefs } from '../core/Prefs';
import type { InputMode, InputModeSetting } from '../input/InputMode';
import {
  ACTION_LABELS,
  INPUT_ACTIONS,
  isBindable,
  isDefaultBindings,
  keyLabel,
  rebind,
  sanitizeKeyBindings,
  type InputAction,
  type KeyBindings,
} from '../input/KeyBindings';
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
  /** 按键映射改了。整张表传过去，调用方存 prefs 并喂给 KeyboardAdapter */
  onKeys: (bindings: KeyBindings) => void;
  /** 触屏惯用手改了 */
  onHanded: (handed: 'right' | 'left') => void;
  /** 清空本地记录（圈速、幽灵车、杯赛进度）。**不可撤销**，所以要二次确认 */
  onResetRecords: () => void;
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
  private readonly keyList: HTMLElement;
  private readonly keysTag: HTMLElement;
  private readonly dangerButton: HTMLButtonElement;
  private readonly qualityButtons = new Map<TierOverride, HTMLButtonElement>();
  private readonly inputButtons = new Map<InputModeSetting, HTMLButtonElement>();
  private readonly handedButtons = new Map<'right' | 'left', HTMLButtonElement>();
  private open = false;
  private bindings: KeyBindings;
  /** 正在等玩家按键的那个格子。null = 没在改键 */
  private capturing: { action: InputAction; slot: number; button: HTMLButtonElement } | null = null;
  /** 清空记录的二次确认状态 */
  private confirmingReset = false;
  private confirmTimer = 0;

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
        <div class="settings-row settings-row-handed">
          <div class="settings-label">布局</div>
          <div class="k-seg settings-handed"></div>
        </div>
        <details class="settings-keys">
          <summary>按键映射<span class="settings-keys-tag"></span></summary>
          <div class="settings-keys-list"></div>
          <button class="settings-keys-reset" type="button">恢复默认按键</button>
        </details>
        <div class="settings-note"></div>
        <button class="settings-danger" type="button">清空本地记录</button>
      </div>
    `;
    parent.appendChild(this.root);

    this.panel = this.root.querySelector('.settings-panel')!;
    this.note = this.root.querySelector('.settings-note')!;
    this.toggleButton = this.root.querySelector('.settings-toggle')!;
    this.muteButton = this.root.querySelector('.settings-mute')!;
    this.keyList = this.root.querySelector('.settings-keys-list')!;
    this.keysTag = this.root.querySelector('.settings-keys-tag')!;
    this.dangerButton = this.root.querySelector('.settings-danger')!;
    this.bindings = sanitizeKeyBindings(options.prefs.keys);

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

    const handedRow = this.root.querySelector('.settings-handed')!;
    for (const value of ['right', 'left'] as const) {
      this.handedButtons.set(value, this.addButton(handedRow, HANDED_LABELS[value], () => {
        this.options.onHanded(value);
        this.setHanded(value);
      }));
    }

    this.root.querySelector('.settings-keys-reset')!.addEventListener('click', () => {
      this.applyBindings(sanitizeKeyBindings(null));
    });
    this.dangerButton.addEventListener('click', () => this.onDangerClick());

    this.toggleButton.addEventListener('click', () => this.toggle());
    this.renderKeys();
    this.setHanded(options.prefs.handed);
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
    // 面板收起来时把两个"半途状态"清掉，否则下次打开会看到一个还在等按键的格子
    if (!this.open) {
      this.cancelCapture();
      this.resetDanger();
    }
  }

  // --- 按键映射 -------------------------------------------------------------

  /**
   * 改键是"点一下格子，然后按一个键"。
   *
   * 捕获期间用的是 **capture 阶段**的监听器并且 preventDefault：不这么做的话
   * 按下的那个键会同时被 KeyboardAdapter 收到 —— 玩家想把油门改成空格，
   * 结果车在后面猛地窜出去。
   */
  private beginCapture(action: InputAction, slot: number, button: HTMLButtonElement): void {
    this.cancelCapture();
    this.capturing = { action, slot, button };
    button.classList.add('is-capturing');
    button.textContent = '按一个键…';
    window.addEventListener('keydown', this.onCaptureKey, true);
  }

  private readonly onCaptureKey = (event: KeyboardEvent) => {
    if (!this.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    const { action, slot } = this.capturing;
    // Esc = 放弃改键。它本身不许绑（绑上去之后就再也退不出捕获了）
    if (event.code !== 'Escape' && isBindable(event.code)) {
      this.applyBindings(rebind(this.bindings, action, slot, event.code));
    }
    this.cancelCapture();
  };

  private cancelCapture(): void {
    if (!this.capturing) return;
    window.removeEventListener('keydown', this.onCaptureKey, true);
    this.capturing = null;
    this.renderKeys();
  }

  private applyBindings(next: KeyBindings): void {
    this.bindings = next;
    this.options.onKeys(next);
    this.renderKeys();
  }

  /** 整块重画。改一个键可能牵动别的动作（键会从原来那儿被摘走），所以不做局部更新 */
  private renderKeys(): void {
    this.keyList.textContent = '';
    for (const action of INPUT_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'settings-key-row';

      const label = document.createElement('span');
      label.className = 'settings-key-label';
      label.textContent = ACTION_LABELS[action];
      row.appendChild(label);

      const keys = document.createElement('span');
      keys.className = 'settings-key-slots';
      this.bindings[action].forEach((code, slot) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-key';
        button.textContent = keyLabel(code);
        button.title = code;
        button.addEventListener('click', () => this.beginCapture(action, slot, button));
        keys.appendChild(button);
      });
      row.appendChild(keys);
      this.keyList.appendChild(row);
    }
    this.keysTag.textContent = isDefaultBindings(this.bindings) ? '' : ' · 已改';
  }

  // --- 清空记录 -------------------------------------------------------------

  /**
   * 二次确认。这个操作会抹掉所有圈速纪录、幽灵车和杯赛进度，**没法撤销**，
   * 而按钮就在设置面板里，手滑点到的代价太大。
   * 用"再点一次确认"而不是 confirm()：后者在移动端是个系统弹窗，很突兀。
   */
  private onDangerClick(): void {
    if (!this.confirmingReset) {
      this.confirmingReset = true;
      this.dangerButton.textContent = '真的清空？再点一次';
      this.dangerButton.classList.add('is-confirming');
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.resetDanger(), 4000) as unknown as number;
      return;
    }
    this.options.onResetRecords();
    this.resetDanger();
    this.dangerButton.textContent = '已清空';
    setTimeout(() => this.resetDanger(), 2000);
  }

  private resetDanger(): void {
    clearTimeout(this.confirmTimer);
    this.confirmingReset = false;
    this.dangerButton.textContent = '清空本地记录';
    this.dangerButton.classList.remove('is-confirming');
  }

  /** 同步画质那一行的高亮 + 说明文字 */
  setQuality(value: TierOverride): void {
    for (const [key, button] of this.qualityButtons) button.classList.toggle('is-on', key === value);
    this.refreshNote(value);
  }

  setInput(value: InputModeSetting): void {
    for (const [key, button] of this.inputButtons) button.classList.toggle('is-on', key === value);
  }

  setHanded(value: 'right' | 'left'): void {
    for (const [key, button] of this.handedButtons) button.classList.toggle('is-on', key === value);
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
    this.cancelCapture();
    clearTimeout(this.confirmTimer);
    this.root.remove();
  }
}

const HANDED_LABELS: Record<'right' | 'left', string> = {
  right: '右手（摇杆在左）',
  left: '左手（摇杆在右）',
};

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
    /* 触屏布局那一行只在触屏模式下有意义 */
    .settings-row-handed { display: none; }
    body.touch-input .settings-row-handed { display: flex; }
    .settings-row-handed .k-seg button { font-size: 11px; }

    /* 按键映射：默认折起来。它是一大块，展开着会把面板顶出屏幕 */
    .settings-keys { margin-bottom: 10px; }
    .settings-keys summary {
      cursor: pointer; font-size: 12px; color: var(--k-text-dim);
      padding: 4px 0; -webkit-tap-highlight-color: transparent;
    }
    .settings-keys-tag { color: var(--k-gold); }
    .settings-keys-list { display: flex; flex-direction: column; gap: 5px; margin: 6px 0 8px; }
    .settings-key-row { display: flex; align-items: center; gap: 8px; }
    .settings-key-label { font-size: 12px; color: var(--k-text-dim); flex: 1; min-width: 0; }
    .settings-key-slots { display: flex; gap: 4px; flex: none; }
    .settings-key {
      pointer-events: auto; min-width: 46px; padding: 4px 7px;
      font-family: var(--k-font); font-size: 11px; font-weight: 700;
      border-radius: var(--k-r-sm); cursor: pointer;
      border: 1px solid var(--k-panel-line);
      background: rgba(255,255,255,0.08); color: var(--k-text);
      -webkit-tap-highlight-color: transparent;
    }
    /* 等待按键时闪一下，不然玩家不知道该干什么 */
    .settings-key.is-capturing {
      background: var(--k-gold); color: var(--k-ink);
      border-color: var(--k-gold); animation: settings-blink 900ms ease-in-out infinite;
    }
    @keyframes settings-blink { 50% { opacity: 0.55; } }
    .settings-keys-reset {
      pointer-events: auto; width: 100%; padding: 6px 0;
      font-family: var(--k-font); font-size: 11px; cursor: pointer;
      border-radius: var(--k-r-sm); border: 1px solid var(--k-panel-line);
      background: rgba(255,255,255,0.06); color: var(--k-text-dim);
    }

    /* 清空记录：危险操作，放在最下面，颜色和别的键区分开 */
    .settings-danger {
      pointer-events: auto; width: 100%; margin-top: 10px; padding: 8px 0;
      font-family: var(--k-font); font-size: 12px; font-weight: 700; cursor: pointer;
      border-radius: var(--k-r-sm);
      border: 1px solid rgba(255,95,109,0.45);
      background: rgba(255,95,109,0.12); color: var(--k-danger);
      -webkit-tap-highlight-color: transparent;
    }
    .settings-danger.is-confirming {
      background: var(--k-danger); color: var(--k-ink); border-color: var(--k-danger);
    }
  `;
  document.head.appendChild(style);
}
