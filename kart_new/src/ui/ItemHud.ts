/**
 * 左下角的道具槽 + 当前状态效果。
 *
 * 和 RaceHud 一样走 DOM 不走 3D。这个类只负责把状态画出来，不做任何判定，
 * 也**不认识任何具体道具** —— 图标、颜色、名字全部从 ItemDef 里取，
 * 加新道具不用来改这个文件。
 */
import type { EffectType } from '../items/EffectSystem';
import type { ItemDef, ItemRarity } from '../items/ItemDefs';

/** 每帧喂进来的快照 */
export interface ItemHudView {
  /** 手里的道具，空手是 null */
  held: ItemDef | null;
  /** 身上挂着的效果，按剩余时长画一条小进度条 */
  effects: readonly { type: EffectType; remaining: number; total: number }[];
  /** 抽奖轮盘还在转（拿到道具那一下的动画） */
  rolling: boolean;
}

/** 效果的显示名和颜色。key 是 EffectType，不是道具 id */
const EFFECT_STYLE: Record<EffectType, { label: string; color: string }> = {
  boost: { label: '加速', color: '#ffb020' },
  slow: { label: '减速', color: '#8fa3b8' },
  spinout: { label: '失控', color: '#ff5f5f' },
  shield: { label: '护盾', color: '#7cf7c4' },
};

/** 稀有度 -> 道具框的边框色 */
const RARITY_BORDER: Record<ItemRarity, string> = {
  common: 'rgba(255,255,255,0.35)',
  uncommon: '#7cc4ff',
  rare: '#ffd34d',
};

/** 拿到道具时轮盘转多久（秒） */
const ROLL_DURATION = 0.55;

export class ItemHud {
  private readonly root: HTMLDivElement;
  private readonly slot: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly label: HTMLElement;
  private readonly effectRow: HTMLElement;
  private readonly effectEls = new Map<EffectType, { box: HTMLElement; bar: HTMLElement }>();

  /** 轮盘剩余时间。> 0 时道具框在闪，用来盖住"凭空多出一个道具"的突兀感 */
  private rollTime = 0;
  private rollPhase = 0;
  private lastSignature = '';

  constructor(parent: HTMLElement) {
    injectItemStyles();

    this.root = document.createElement('div');
    this.root.className = 'item-hud';
    this.root.innerHTML = `
      <div class="item-slot item-slot-empty">
        <span class="item-icon"></span>
        <span class="item-label">无道具</span>
      </div>
      <div class="item-effects"></div>
      <div class="item-hint">Q / 右键 使用</div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel)!;
    this.slot = q('.item-slot');
    this.icon = q('.item-icon');
    this.label = q('.item-label');
    this.effectRow = q('.item-effects');
  }

  /** 抽到道具时叫一下，播个短动画 */
  playRoll(): void {
    this.rollTime = ROLL_DURATION;
  }

  update(view: ItemHudView, frameDt: number): void {
    this.renderSlot(view, frameDt);
    this.renderEffects(view.effects);
  }

  private renderSlot(view: ItemHudView, frameDt: number): void {
    const held = view.held;
    // 签名相同就只更新动画，不动 DOM
    const signature = held ? `${held.id}|${held.rarity}` : '';
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.slot.classList.toggle('item-slot-empty', held === null);
      setText(this.icon, held?.icon ?? '');
      setText(this.label, held?.name ?? '无道具');
      this.slot.style.background = held ? withAlpha(held.color, 0.85) : 'rgba(0,0,0,0.3)';
      this.slot.style.borderColor = held
        ? RARITY_BORDER[held.rarity]
        : 'rgba(255,255,255,0.18)';
    }

    if (this.rollTime > 0) {
      this.rollTime = Math.max(0, this.rollTime - frameDt);
      this.rollPhase += frameDt * 26;
      // 抽奖那一下：框在放大 + 抖，转完自然停在正常大小
      const k = this.rollTime / ROLL_DURATION;
      const scale = 1 + 0.22 * k;
      const tilt = Math.sin(this.rollPhase) * 5 * k;
      this.slot.style.transform = `scale(${scale.toFixed(3)}) rotate(${tilt.toFixed(2)}deg)`;
    } else if (this.slot.style.transform !== '') {
      this.slot.style.transform = '';
    }
  }

  private renderEffects(effects: ItemHudView['effects']): void {
    const seen = new Set<EffectType>();
    for (const e of effects) {
      seen.add(e.type);
      let el = this.effectEls.get(e.type);
      if (!el) {
        const box = document.createElement('div');
        box.className = 'item-eff';
        const style = EFFECT_STYLE[e.type];
        box.innerHTML = `<span>${style.label}</span><i class="item-eff-bar"></i>`;
        box.style.color = style.color;
        (box.querySelector('.item-eff-bar') as HTMLElement).style.background = style.color;
        this.effectRow.appendChild(box);
        el = { box, bar: box.querySelector('.item-eff-bar')! };
        this.effectEls.set(e.type, el);
      }
      const ratio = e.total > 0 ? Math.max(0, Math.min(e.remaining / e.total, 1)) : 0;
      el.bar.style.width = `${(ratio * 100).toFixed(1)}%`;
    }
    for (const [type, el] of this.effectEls) {
      if (seen.has(type)) continue;
      el.box.remove();
      this.effectEls.delete(type);
    }
  }
}

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

/** #rrggbb -> rgba(...)。道具颜色是十六进制的，做背景要透一点 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

let itemStylesInjected = false;
function injectItemStyles(): void {
  if (itemStylesInjected) return;
  itemStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* 左下角。.hud-speed（速度数字）占了 left:24 bottom:22，所以往上让开一截 */
    .item-hud {
      position: absolute; left: 24px; bottom: 108px;
      pointer-events: none; color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      text-shadow: 0 2px 8px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    }
    .item-slot {
      width: 82px; height: 82px; border-radius: 14px;
      border: 2px solid rgba(255,255,255,0.18);
      background: rgba(0,0,0,0.3);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; transform-origin: center;
      transition: background 140ms ease, border-color 140ms ease;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .item-icon { font-size: 30px; line-height: 1; }
    .item-label { font-size: 12px; letter-spacing: 1px; }
    .item-slot-empty { opacity: 0.45; }
    .item-slot-empty .item-label { font-size: 11px; }

    .item-effects { display: flex; flex-direction: column; gap: 3px; min-height: 0; }
    .item-eff {
      font-size: 11px; letter-spacing: 1px;
      background: rgba(0,0,0,0.4); border-radius: 5px;
      padding: 2px 7px 4px; min-width: 62px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .item-eff-bar { height: 2px; border-radius: 1px; width: 100%; display: block; }

    .item-hint { font-size: 11px; opacity: 0.55; letter-spacing: 1px; }
    /* 触屏上道具键在右上角，"Q / 右键"这行提示是错的 */
    body.touch-input .item-hint { display: none; }

    @media (max-width: 640px) {
      .item-hud { bottom: 84px; }
      .item-slot { width: 62px; height: 62px; border-radius: 11px; }
      .item-icon { font-size: 24px; }
      .item-hint { display: none; }
    }
  `;
  document.head.appendChild(style);
}
