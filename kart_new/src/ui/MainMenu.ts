/**
 * 主菜单 + 赛道选择。
 *
 * 它在**任何重活之前**就挂出来：赛道网格、rapier 的 wasm、环境贴图全都要等
 * 玩家选完赛道才开始建（不同赛道的网格和碰撞体完全不一样，先建就白建了）。
 * 顺带解决了另一件事：音频必须在用户手势里初始化，"开始比赛"那一下正好是它。
 *
 * 和 RaceHud / SettingsMenu 一样走 DOM，样式全部取自 theme.ts 的令牌。
 */
import { formatTimeOrDash } from '../race/formatTime';
import { TRACKS, TRACK_IDS, type TrackId } from '../track/TrackCatalog';
import type { QualityTier, TierOverride } from '../render/QualityTiers';
import { injectTheme } from './theme';

export interface MainMenuOptions {
  /** 默认停在哪条赛道（上次选的） */
  initial: TrackId;
  /** 画质档位的当前设置和探测结果。菜单里能改，因为有些东西开局后就改不了了 */
  quality: TierOverride;
  detectedTier: QualityTier;
  /** 画质改了。只写 prefs —— 这时候渲染器还没建，没有"立刻生效"这回事 */
  onQuality: (value: TierOverride) => void;
  /** 每条赛道的本地最佳圈速，没有就返回 null */
  bestLapOf: (id: TrackId) => number | null;
  /** 选中赛道变了（存 prefs 用） */
  onSelect?: (id: TrackId) => void;
  /** 点了"开始比赛"。**在用户手势的调用栈里**，音频初始化要挂在这儿 */
  onStart: (id: TrackId) => void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly cards = new Map<TrackId, HTMLButtonElement>();
  private readonly qualityButtons = new Map<TierOverride, HTMLButtonElement>();
  private selected: TrackId;
  private quality: TierOverride;

  constructor(parent: HTMLElement, private readonly options: MainMenuOptions) {
    injectTheme();
    injectMenuStyles();
    this.selected = options.initial;
    this.quality = options.quality;

    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="menu-inner">
        <div class="menu-head">
          <div class="menu-title k-outline-lg">KART</div>
          <div class="menu-sub">选一条赛道</div>
        </div>
        <div class="menu-tracks"></div>
        <div class="menu-quality">
          <span class="menu-quality-label">画质</span>
          <div class="k-seg menu-quality-seg"></div>
        </div>
        <button class="k-btn menu-start" type="button">开始比赛</button>
        <div class="menu-foot"></div>
      </div>
    `;
    parent.appendChild(this.root);

    const list = this.root.querySelector('.menu-tracks')!;
    for (const id of TRACK_IDS) list.appendChild(this.buildCard(id));

    // 画质放在菜单里而不是只放在游戏里的 ⚙：**对手数量是跟着画质档位走的**
    // （high 7 / medium 5 / low 3），而它在开局时就定死了，进去之后再改档位
    // 对手也不会跟着变。想少几个对手就得在这儿改
    const qualityRow = this.root.querySelector('.menu-quality-seg')!;
    for (const value of ['auto', 'high', 'medium', 'low'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = TIER_LABELS[value];
      button.addEventListener('click', () => {
        this.quality = value;
        this.options.onQuality(value);
        this.highlightQuality();
      });
      qualityRow.appendChild(button);
      this.qualityButtons.set(value, button);
    }
    this.highlightQuality();

    this.root.querySelector('.menu-start')!.addEventListener('click', () => {
      this.options.onStart(this.selected);
    });

    this.highlight();
  }

  private buildCard(id: TrackId): HTMLButtonElement {
    const track = TRACKS[id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-card';
    // 难度用实心/空心圆点画，不用星星：★ 在不同平台的字形宽度差别很大，会把行挤歪
    const dots = [1, 2, 3].map((n) => (n <= track.difficulty ? '●' : '○')).join('');
    card.innerHTML = `
      <div class="menu-card-top">
        <span class="menu-card-name">${escapeHtml(track.name)}</span>
        <span class="menu-card-diff">${dots}</span>
      </div>
      <div class="menu-card-sub">${escapeHtml(track.subtitle)}</div>
      <div class="menu-card-meta">
        <span>${track.laps} 圈</span>
        <span class="menu-card-record k-num">最佳 ${formatTimeOrDash(this.options.bestLapOf(id))}</span>
      </div>
    `;
    card.addEventListener('click', () => this.select(id));
    this.cards.set(id, card);
    return card;
  }

  private select(id: TrackId): void {
    if (this.selected === id) return;
    this.selected = id;
    this.highlight();
    this.options.onSelect?.(id);
  }

  private highlight(): void {
    for (const [id, card] of this.cards) card.classList.toggle('is-on', id === this.selected);
  }

  private highlightQuality(): void {
    for (const [key, button] of this.qualityButtons) {
      button.classList.toggle('is-on', key === this.quality);
    }
    const auto =
      this.quality === 'auto' ? `自动挡当前判定为「${TIER_LABELS[this.options.detectedTier]}」，` : '';
    this.root.querySelector('.menu-foot')!.textContent =
      `${auto}对手数量跟着画质走（高 7 / 中 5 / 低 3），开局后改不了。\n` +
      '操作方式和音量在比赛里的左上角 ⚙ 里调。';
  }

  /** 淡出并从 DOM 里摘掉。淡出期间不挡操作 */
  hide(): void {
    this.root.classList.add('is-hidden');
    this.root.addEventListener('transitionend', () => this.root.remove(), { once: true });
    // 标签页在后台时 transitionend 不会来，兜个底
    setTimeout(() => this.root.remove(), 800);
  }

  dispose(): void {
    this.root.remove();
  }
}

const TIER_LABELS: Record<TierOverride, string> = {
  auto: '自动',
  high: '高',
  medium: '中',
  low: '低',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

let injected = false;
function injectMenuStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    .menu {
      position: fixed; inset: 0; z-index: 90;
      display: flex; align-items: center; justify-content: center;
      padding: calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
               calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));
      font-family: var(--k-font); color: var(--k-text);
      /* 底色和天空同一个色系：菜单退场之后接上的就是这片天，不会"换了个世界" */
      background: radial-gradient(120% 90% at 50% 12%, #7fc4f2 0%, #3f7fc0 48%, #16233a 100%);
      transition: opacity 300ms ease;
      overflow-y: auto;
    }
    .menu.is-hidden { opacity: 0; pointer-events: none; }
    .menu-inner {
      width: min(92vw, 560px);
      display: flex; flex-direction: column; align-items: center; gap: 18px;
    }
    .menu-head { text-align: center; }
    .menu-title {
      font-size: clamp(52px, 13vw, 92px); font-weight: 900;
      letter-spacing: 10px; line-height: 1; margin-right: -10px;
    }
    .menu-sub { margin-top: 8px; font-size: 14px; color: rgba(255,255,255,0.8); letter-spacing: 4px; }

    .menu-tracks { width: 100%; display: flex; flex-direction: column; gap: 10px; }
    .menu-card {
      pointer-events: auto; width: 100%; text-align: left; cursor: pointer;
      font-family: inherit; color: var(--k-text);
      background: rgba(13,17,27,0.42);
      border: 2px solid rgba(255,255,255,0.14);
      border-radius: var(--k-r-md);
      padding: 12px 16px;
      display: flex; flex-direction: column; gap: 4px;
      -webkit-tap-highlight-color: transparent;
      transition: border-color 130ms ease, background 130ms ease, transform 130ms ease;
    }
    .menu-card:hover { transform: translateY(-1px); background: rgba(13,17,27,0.55); }
    /* 选中的卡片：边框换成强调色 + 一圈外发光。只靠背景色变化在小屏上看不出来 */
    .menu-card.is-on {
      border-color: var(--k-accent);
      background: rgba(47,168,255,0.18);
      box-shadow: 0 0 0 4px rgba(47,168,255,0.18);
    }
    .menu-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .menu-card-name { font-size: 19px; font-weight: 800; letter-spacing: 1px; }
    .menu-card-diff { font-size: 12px; letter-spacing: 3px; color: var(--k-gold); }
    .menu-card-sub { font-size: 13px; color: var(--k-text-dim); }
    .menu-card-meta {
      display: flex; justify-content: space-between; gap: 12px;
      font-size: 12px; color: rgba(255,255,255,0.7);
    }
    .menu-card-record { color: var(--k-gold); }

    .menu-quality { display: flex; align-items: center; gap: 10px; width: 100%; }
    .menu-quality-label { font-size: 12px; color: var(--k-text-dim); flex: none; }
    .menu-quality .k-seg { flex: 1; }

    .menu-start { min-width: 220px; font-size: 18px; padding: 14px 36px; }
    .menu-foot {
      font-size: 12px; color: rgba(255,255,255,0.62);
      text-align: center; white-space: pre-line; line-height: 1.6;
    }

    @media (max-height: 520px) {
      .menu-title { font-size: 40px; }
      .menu-inner { gap: 12px; }
      .menu-card { padding: 8px 14px; }
      .menu-card-sub { display: none; }
    }
  `;
  document.head.appendChild(style);
}
