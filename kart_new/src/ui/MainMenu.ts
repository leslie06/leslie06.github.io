/**
 * 主菜单：玩法 + 赛道/杯赛 + 画质。
 *
 * 它在**任何重活之前**就挂出来：赛道网格、rapier 的 wasm、环境贴图全都要等
 * 玩家选完才开始建（不同赛道的网格和碰撞体完全不一样，先建就白建了）。
 * 顺带解决了另一件事：音频必须在用户手势里初始化，"开始比赛"那一下正好是它。
 *
 * 缩略图是**从控制点现算的**（trackThumbnail.ts），不是图片：改了赛道形状之后
 * 图自动跟着变，也不占一个字节的下载量。
 */
import { formatTimeOrDash } from '../race/formatTime';
import { CUPS, CUP_IDS, currentRound, isCupFinished, totalRounds, type CupId, type CupState } from '../race/Cup';
import { GAME_MODES, GAME_MODE_IDS, type GameMode } from '../race/GameMode';
import { TRACKS, TRACK_IDS, type TrackId } from '../track/tracks';
import { trackThumbnailSvg } from '../track/trackThumbnail';
import type { QualityTier, TierOverride } from '../render/QualityTiers';
import { injectTheme } from './theme';

export interface MenuSelection {
  mode: GameMode;
  trackId: TrackId;
  cupId: CupId;
}

export interface MainMenuOptions {
  /** 默认停在哪儿（上次选的） */
  initial: MenuSelection;
  /** 画质档位的当前设置和探测结果。菜单里能改，因为有些东西开局后就改不了了 */
  quality: TierOverride;
  detectedTier: QualityTier;
  /** 进行中的杯赛，没有就是 null */
  cupInProgress: CupState | null;
  /** 每条赛道的本地最佳圈速 */
  bestLapOf: (id: TrackId) => number | null;
  /** 每条赛道有没有幽灵车录像（计时赛模式的卡片上显示） */
  ghostLapOf: (id: TrackId) => number | null;
  /** 选择变了（存 prefs 用） */
  onSelect?: (selection: MenuSelection) => void;
  onQuality: (value: TierOverride) => void;
  /** 放弃进行中的杯赛 */
  onAbandonCup: () => void;
  /** 点了"开始"。**在用户手势的调用栈里**，音频初始化要挂在这儿 */
  onStart: (selection: MenuSelection) => void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly trackCards = new Map<TrackId, HTMLButtonElement>();
  private readonly cupCards = new Map<CupId, HTMLButtonElement>();
  private readonly modeButtons = new Map<GameMode, HTMLButtonElement>();
  private readonly qualityButtons = new Map<TierOverride, HTMLButtonElement>();
  private readonly trackList: HTMLElement;
  private readonly cupList: HTMLElement;
  private readonly startButton: HTMLButtonElement;

  private selection: MenuSelection;
  private quality: TierOverride;

  constructor(parent: HTMLElement, private readonly options: MainMenuOptions) {
    injectTheme();
    injectMenuStyles();
    this.selection = { ...options.initial };
    this.quality = options.quality;

    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="menu-inner">
        <div class="menu-head">
          <div class="menu-title k-outline-lg">KART</div>
          <div class="k-seg menu-modes"></div>
          <div class="menu-mode-sub"></div>
        </div>
        <div class="menu-tracks"></div>
        <div class="menu-cups"></div>
        <div class="menu-quality">
          <span class="menu-quality-label">画质</span>
          <div class="k-seg menu-quality-seg"></div>
        </div>
        <button class="k-btn menu-start" type="button">开始比赛</button>
        <div class="menu-foot"></div>
      </div>
    `;
    parent.appendChild(this.root);

    this.trackList = this.root.querySelector('.menu-tracks')!;
    this.cupList = this.root.querySelector('.menu-cups')!;
    this.startButton = this.root.querySelector('.menu-start')!;

    const modeRow = this.root.querySelector('.menu-modes')!;
    for (const mode of GAME_MODE_IDS) {
      modeRow.appendChild(
        this.addSegButton(GAME_MODES[mode].name, () => {
          this.selection = { ...this.selection, mode };
          this.options.onSelect?.(this.selection);
          this.refresh();
        }, this.modeButtons, mode),
      );
    }

    for (const id of TRACK_IDS) this.trackList.appendChild(this.buildTrackCard(id));
    for (const id of CUP_IDS) this.cupList.appendChild(this.buildCupCard(id));

    // 画质放在菜单里而不是只放在游戏里的 ⚙：**对手数量是跟着画质档位走的**
    // （high 7 / medium 5 / low 3），而它在开局时就定死了，进去之后再改档位
    // 对手也不会跟着变。想少几个对手就得在这儿改
    const qualityRow = this.root.querySelector('.menu-quality-seg')!;
    for (const value of ['auto', 'high', 'medium', 'low'] as const) {
      qualityRow.appendChild(
        this.addSegButton(TIER_LABELS[value], () => {
          this.quality = value;
          this.options.onQuality(value);
          this.refresh();
        }, this.qualityButtons, value),
      );
    }

    this.startButton.addEventListener('click', () => this.options.onStart(this.selection));
    this.refresh();
  }

  private addSegButton<K>(
    label: string,
    onClick: () => void,
    into: Map<K, HTMLButtonElement>,
    key: K,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    into.set(key, button);
    return button;
  }

  private buildTrackCard(id: TrackId): HTMLButtonElement {
    const track = TRACKS[id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-card menu-card-track';
    // 难度用实心/空心圆点画，不用星星：★ 在不同平台的字形宽度差别很大，会把行挤歪
    const dots = [1, 2, 3].map((n) => (n <= track.difficulty ? '●' : '○')).join('');
    card.innerHTML = `
      <span class="menu-thumb" style="color:${track.sky.horizon}">${trackThumbnailSvg(track.points, {
        size: 100,
        roadColor: 'currentColor',
      })}</span>
      <span class="menu-card-body">
        <span class="menu-card-top">
          <span class="menu-card-name">${escapeHtml(track.name)}</span>
          <span class="menu-card-diff">${dots}</span>
        </span>
        <span class="menu-card-sub">${escapeHtml(track.subtitle)}</span>
        <span class="menu-card-meta">
          <span>${track.laps} 圈</span>
          <span class="menu-card-record k-num"></span>
        </span>
      </span>
    `;
    card.addEventListener('click', () => {
      this.selection = { ...this.selection, trackId: id };
      this.options.onSelect?.(this.selection);
      this.refresh();
    });
    this.trackCards.set(id, card);
    return card;
  }

  private buildCupCard(id: CupId): HTMLButtonElement {
    const cup = CUPS[id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'menu-card menu-card-cup';
    card.innerHTML = `
      <span class="menu-cup-tracks">${cup.trackIds
        .map(
          (t) =>
            `<i class="menu-cup-chip" style="color:${TRACKS[t].sky.horizon}">${trackThumbnailSvg(
              TRACKS[t].points,
              { size: 100, roadColor: 'currentColor', baseColor: 'rgba(0,0,0,0.35)' },
            )}</i>`,
        )
        .join('')}</span>
      <span class="menu-card-body">
        <span class="menu-card-top">
          <span class="menu-card-name">${escapeHtml(cup.name)}</span>
          <span class="menu-card-diff">${cup.trackIds.length} 场</span>
        </span>
        <span class="menu-card-sub">${escapeHtml(cup.subtitle)}</span>
        <span class="menu-card-meta"><span class="menu-cup-progress"></span></span>
      </span>
    `;
    card.addEventListener('click', () => {
      this.selection = { ...this.selection, cupId: id };
      this.options.onSelect?.(this.selection);
      this.refresh();
    });
    this.cupCards.set(id, card);
    return card;
  }

  /** 一次性把所有跟着选择变的东西刷一遍。分散更新很容易漏掉一处 */
  private refresh(): void {
    const mode = GAME_MODES[this.selection.mode];
    for (const [key, button] of this.modeButtons) {
      button.classList.toggle('is-on', key === this.selection.mode);
    }
    this.root.querySelector('.menu-mode-sub')!.textContent = mode.subtitle;

    // 杯赛模式看杯赛列表，别的看赛道列表
    this.trackList.hidden = mode.cup;
    this.cupList.hidden = !mode.cup;

    for (const [id, card] of this.trackCards) {
      card.classList.toggle('is-on', id === this.selection.trackId);
      const record = card.querySelector('.menu-card-record')!;
      // 计时赛显示幽灵车的圈速（"我要追的是这个时间"），别的模式显示本地最佳
      const time = mode.ghost ? this.options.ghostLapOf(id) : this.options.bestLapOf(id);
      record.textContent = `${mode.ghost ? '幽灵' : '最佳'} ${formatTimeOrDash(time)}`;
    }

    const progress = this.options.cupInProgress;
    for (const [id, card] of this.cupCards) {
      card.classList.toggle('is-on', id === this.selection.cupId);
      const label = card.querySelector('.menu-cup-progress')!;
      const mine = progress && progress.cupId === id ? progress : null;
      const running = mine !== null && !isCupFinished(mine);
      label.textContent = running
        ? `进行中 · 第 ${currentRound(mine)} / ${totalRounds(mine)} 场`
        : mine
          ? '已完成 · 再开一次从头算'
          : '未开始';
      label.classList.toggle('is-running', Boolean(running));
    }

    for (const [key, button] of this.qualityButtons) {
      button.classList.toggle('is-on', key === this.quality);
    }

    this.startButton.textContent = this.startLabel();
    this.renderFoot();
  }

  private startLabel(): string {
    const progress = this.options.cupInProgress;
    if (this.selection.mode === 'cup' && progress && progress.cupId === this.selection.cupId) {
      if (!isCupFinished(progress)) return `继续杯赛 · 第 ${currentRound(progress)} 场`;
      return '重新开始杯赛';
    }
    return this.selection.mode === 'timeTrial' ? '开始计时' : '开始比赛';
  }

  private renderFoot(): void {
    const foot = this.root.querySelector('.menu-foot')!;
    foot.textContent = '';

    const progress = this.options.cupInProgress;
    // 换一个杯赛/换玩法之前得让人知道旧的进度还在，以及怎么丢掉它
    if (progress && !isCupFinished(progress)) {
      const line = document.createElement('div');
      line.textContent = `${CUPS[progress.cupId].name}进行到第 ${currentRound(progress)} / ${totalRounds(progress)} 场。`;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'menu-link';
      drop.textContent = '放弃进度';
      drop.addEventListener('click', () => {
        this.options.onAbandonCup();
        this.refresh();
      });
      line.appendChild(drop);
      foot.appendChild(line);
    }

    const auto =
      this.quality === 'auto' ? `自动挡当前判定为「${TIER_LABELS[this.options.detectedTier]}」，` : '';
    const hint = document.createElement('div');
    hint.textContent =
      `${auto}对手数量跟着画质走（高 7 / 中 5 / 低 3），开局后改不了。` +
      '操作、按键和音量在比赛里的左上角 ⚙ 里调。';
    foot.appendChild(hint);
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
      width: min(94vw, 580px);
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      margin: auto;
    }
    .menu-head { text-align: center; width: 100%; }
    .menu-title {
      font-size: clamp(44px, 11vw, 80px); font-weight: 900;
      letter-spacing: 10px; line-height: 1; margin-right: -10px;
    }
    .menu-head .k-seg { margin-top: 12px; }
    .menu-mode-sub { margin-top: 8px; font-size: 13px; color: rgba(255,255,255,0.78); }

    .menu-tracks, .menu-cups { width: 100%; display: flex; flex-direction: column; gap: 9px; }
    .menu-tracks[hidden], .menu-cups[hidden] { display: none; }

    .menu-card {
      pointer-events: auto; width: 100%; text-align: left; cursor: pointer;
      font-family: inherit; color: var(--k-text);
      background: rgba(13,17,27,0.42);
      border: 2px solid rgba(255,255,255,0.14);
      border-radius: var(--k-r-md);
      padding: 10px 14px;
      display: flex; align-items: center; gap: 12px;
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
    .menu-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .menu-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .menu-card-name { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
    .menu-card-diff { font-size: 11px; letter-spacing: 2px; color: var(--k-gold); flex: none; }
    .menu-card-sub { font-size: 12px; color: var(--k-text-dim); }
    .menu-card-meta {
      display: flex; justify-content: space-between; gap: 12px;
      font-size: 12px; color: rgba(255,255,255,0.7);
    }
    .menu-card-record { color: var(--k-gold); }

    /* 缩略图：赛道形状是从控制点现算的 SVG，颜色跟着那条道的天空色 */
    .menu-thumb {
      flex: none; width: 56px; height: 56px; display: block;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }
    .menu-thumb svg { width: 100%; height: 100%; display: block; }

    /* 杯赛卡片：四条道的缩略图排成一列 */
    .menu-cup-tracks { flex: none; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    .menu-cup-chip { width: 27px; height: 27px; display: block; }
    .menu-cup-chip svg { width: 100%; height: 100%; display: block; }
    .menu-cup-progress { color: var(--k-text-dim); }
    .menu-cup-progress.is-running { color: var(--k-mint); font-weight: 700; }

    .menu-quality { display: flex; align-items: center; gap: 10px; width: 100%; }
    .menu-quality-label { font-size: 12px; color: var(--k-text-dim); flex: none; }
    .menu-quality .k-seg { flex: 1; }

    .menu-start { min-width: 240px; font-size: 18px; padding: 14px 36px; }
    .menu-foot {
      font-size: 12px; color: rgba(255,255,255,0.62);
      text-align: center; line-height: 1.7; display: flex; flex-direction: column; gap: 4px;
    }
    .menu-link {
      pointer-events: auto; margin-left: 6px; padding: 0;
      background: none; border: none; cursor: pointer;
      font-family: inherit; font-size: inherit;
      color: var(--k-gold); text-decoration: underline;
    }

    @media (max-height: 620px) {
      .menu-title { font-size: 38px; }
      .menu-inner { gap: 9px; }
      .menu-card { padding: 7px 12px; }
      .menu-card-sub { display: none; }
      .menu-thumb { width: 42px; height: 42px; }
    }
  `;
  document.head.appendChild(style);
}
