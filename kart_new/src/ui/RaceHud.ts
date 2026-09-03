/**
 * 比赛 HUD：圈数、圈速、倒计时、结算面板。
 *
 * 和 Hud.ts 一样走 DOM 不走 3D —— 文字排版和动画交给 CSS，比在 canvas 里画省事得多，
 * 而且 devicePixelRatio 天然清晰。
 *
 * 这个类只负责"把状态画出来"，不做任何判定：圈数、名次、有效性全部由 RaceState 算好传进来。
 */
import { formatTime, formatTimeOrDash } from '../race/formatTime';
import type { RacePhase, Standing } from '../race/RaceState';

/** 每帧喂给 HUD 的快照。 */
export interface RaceHudView {
  phase: RacePhase;
  /** 当前是第几圈，从 1 开始；冲线后停在 totalLaps */
  lap: number;
  totalLaps: number;
  /** 当前圈已用时 */
  lapTime: number;
  lastLap: number | null;
  /** 本局最佳 */
  bestLap: number | null;
  /** localStorage 里的历史纪录 */
  recordLap: number | null;
  /** 倒计时剩余秒 */
  countdown: number;
  /** 本圈 checkpoint 有没有漏 */
  lapValid: boolean;
  place: number;
  racerCount: number;
  standings: readonly Standing[];
  /** 完赛结算数据，没完赛是 null */
  results: RaceResults | null;
}

export interface RaceResults {
  place: number;
  totalTime: number;
  lapTimes: readonly number[];
  bestLap: number | null;
  /** 这一局有没有破历史纪录 */
  newRecord: boolean;
}

/** 中央弹出提示的默认时长（秒） */
const POPUP_DURATION = 1.6;
/** 破纪录多留一会儿，这个是要让人看见的 */
const RECORD_POPUP_DURATION = 2.6;
const GO_DURATION = 1.0;

export class RaceHud {
  private readonly root: HTMLDivElement;
  private readonly lapValue: HTMLElement;
  private readonly lapTotal: HTMLElement;
  private readonly posBox: HTMLElement;
  private readonly posValue: HTMLElement;
  private readonly curValue: HTMLElement;
  private readonly lastValue: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly recordRow: HTMLElement;
  private readonly recordValue: HTMLElement;
  private readonly center: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly results: HTMLElement;

  /** 中央提示的剩余显示时间 */
  private popupTime = 0;
  private popupTotal = POPUP_DURATION;
  /** 结算面板已经按这个签名渲染过了，内容没变就不重建 DOM */
  private resultsSignature = '';

  constructor(parent: HTMLElement) {
    injectRaceStyles();

    this.root = document.createElement('div');
    this.root.className = 'race-hud';
    this.root.innerHTML = `
      <div class="race-lap">
        <span class="race-lap-label">LAP</span><!--
     --><span class="race-lap-value">1</span><!--
     --><span class="race-lap-total">/3</span>
      </div>
      <div class="race-pos" hidden>
        <span class="race-pos-value">1</span><span class="race-pos-label">位</span>
      </div>
      <div class="race-times">
        <div class="race-row race-row-cur"><span class="race-k">本圈</span><span class="race-v">0.000</span></div>
        <div class="race-row race-row-last"><span class="race-k">上圈</span><span class="race-v">--.---</span></div>
        <div class="race-row race-row-best"><span class="race-k">最佳</span><span class="race-v">--.---</span></div>
        <div class="race-row race-row-record"><span class="race-k">纪录</span><span class="race-v">--.---</span></div>
      </div>
      <div class="race-center" hidden></div>
      <div class="race-warn" hidden>⚠ 漏了 checkpoint · 本圈不计</div>
      <div class="race-results" hidden></div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel)!;
    this.lapValue = q('.race-lap-value');
    this.lapTotal = q('.race-lap-total');
    this.posBox = q('.race-pos');
    this.posValue = q('.race-pos-value');
    this.curValue = q('.race-row-cur .race-v');
    this.lastValue = q('.race-row-last .race-v');
    this.bestValue = q('.race-row-best .race-v');
    this.recordRow = q('.race-row-record');
    this.recordValue = q('.race-row-record .race-v');
    this.center = q('.race-center');
    this.warn = q('.race-warn');
    this.results = q('.race-results');
  }

  /** 倒计时读秒由 update 里的 phase 驱动，这里只处理 GO / 圈速 / 新纪录这些一次性弹窗。 */
  showGo(): void {
    this.popup('GO!', 'race-center-go', GO_DURATION);
  }

  /** 完成一圈时弹一下圈速。best = 本局最佳，record = 破了历史纪录 */
  showLapSplit(lap: number, time: number, best: boolean, record: boolean): void {
    const tag = record ? '★ 新纪录 ★' : best ? '最佳圈' : `第 ${lap} 圈`;
    const cls = record ? 'race-center-record' : best ? 'race-center-best' : 'race-center-lap';
    this.popup(
      `<span class="race-pop-tag">${tag}</span><span class="race-pop-time">${formatTime(time)}</span>`,
      cls,
      record ? RECORD_POPUP_DURATION : POPUP_DURATION,
    );
  }

  /**
   * @param frameDt 真实帧间隔，用来跑弹窗的淡出
   */
  update(view: RaceHudView, frameDt: number): void {
    // --- 圈数 ---
    const lap = Math.min(Math.max(view.lap, 1), view.totalLaps);
    setText(this.lapValue, String(lap));
    setText(this.lapTotal, `/${view.totalLaps}`);

    // --- 名次。单人局没意义，直接不显示 ---
    const showPos = view.racerCount > 1;
    this.posBox.hidden = !showPos;
    if (showPos) setText(this.posValue, String(view.place));

    // --- 计时 ---
    setText(this.curValue, formatTime(view.lapTime));
    setText(this.lastValue, formatTimeOrDash(view.lastLap));
    setText(this.bestValue, formatTimeOrDash(view.bestLap));
    this.recordRow.hidden = view.recordLap === null;
    if (view.recordLap !== null) setText(this.recordValue, formatTime(view.recordLap));
    // 本局已经追平/打破历史纪录时，"最佳"那一行换成纪录色
    const beatingRecord =
      view.bestLap !== null && (view.recordLap === null || view.bestLap <= view.recordLap);
    this.bestValue.classList.toggle('race-v-record', beatingRecord);

    // --- 漏 checkpoint 警告 ---
    this.warn.hidden = view.lapValid || view.phase !== 'racing';

    // --- 中央区：倒计时优先于弹窗；结算面板一出来就把弹窗收掉，别叠在一起 ---
    if (view.phase === 'countdown') {
      this.renderCountdown(view.countdown);
    } else if (view.results) {
      this.popupTime = 0;
      this.center.hidden = true;
    } else {
      this.tickPopup(frameDt);
    }

    // --- 结算面板 ---
    this.renderResults(view);
  }

  private renderCountdown(remaining: number): void {
    const n = Math.ceil(remaining);
    const frac = remaining - Math.floor(remaining); // 每一秒内从 1 走到 0
    this.center.hidden = false;
    this.center.className = 'race-center race-center-count';
    setHtml(this.center, String(Math.max(n, 1)));
    // 数字每秒"砸"一下：出现时大且淡，收到正常大小
    this.center.style.transform = `translate(-50%, -50%) scale(${(1 + frac * 0.5).toFixed(3)})`;
    this.center.style.opacity = (1.2 - frac * 0.5).toFixed(3);
    this.popupTime = 0;
  }

  private popup(html: string, cls: string, duration: number): void {
    this.center.hidden = false;
    this.center.className = `race-center ${cls}`;
    setHtml(this.center, html);
    this.popupTime = duration;
    this.popupTotal = duration;
  }

  private tickPopup(frameDt: number): void {
    if (this.popupTime <= 0) {
      if (!this.center.hidden) this.center.hidden = true;
      return;
    }
    this.popupTime = Math.max(0, this.popupTime - frameDt);
    const age = 1 - this.popupTime / this.popupTotal;
    // 前 12% 弹进来，最后 30% 淡出
    const pop = age < 0.12 ? age / 0.12 : 1;
    const fade = this.popupTime / this.popupTotal < 0.3 ? this.popupTime / this.popupTotal / 0.3 : 1;
    const scale = 0.7 + 0.3 * pop + 0.12 * (1 - pop);
    this.center.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    this.center.style.opacity = fade.toFixed(3);
    if (this.popupTime === 0) this.center.hidden = true;
  }

  private renderResults(view: RaceHudView): void {
    const r = view.results;
    if (!r) {
      if (!this.results.hidden) {
        this.results.hidden = true;
        this.resultsSignature = '';
      }
      return;
    }
    const signature = `${r.place}|${r.totalTime}|${r.lapTimes.join(',')}|${r.newRecord}`;
    if (signature === this.resultsSignature) return;
    this.resultsSignature = signature;

    const rows = r.lapTimes
      .map((time, i) => {
        const isBest = r.bestLap !== null && time === r.bestLap;
        return `<li class="${isBest ? 'race-res-lap race-res-lap-best' : 'race-res-lap'}">
          <span>第 ${i + 1} 圈</span><span>${formatTime(time)}</span></li>`;
      })
      .join('');

    this.results.innerHTML = `
      <div class="race-res-title">完赛</div>
      ${view.racerCount > 1 ? `<div class="race-res-place">第 ${r.place} 名</div>` : ''}
      <div class="race-res-total">${formatTime(r.totalTime)}</div>
      <ol class="race-res-laps">${rows}</ol>
      <div class="race-res-best">最佳圈 ${formatTimeOrDash(r.bestLap)}</div>
      ${r.newRecord ? '<div class="race-res-record">★ 打破本地纪录</div>' : ''}
      <div class="race-res-hint">按 R 重开</div>
    `;
    this.results.hidden = false;
  }
}

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function setHtml(el: HTMLElement, value: string): void {
  if (el.innerHTML !== value) el.innerHTML = value;
}

let raceStylesInjected = false;
function injectRaceStyles(): void {
  if (raceStylesInjected) return;
  raceStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .race-hud {
      position: absolute; inset: 0; pointer-events: none;
      color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.6);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      --race-best: #ffd34d;
      --race-record: #7cf7c4;
    }
    /* 下面好几个块都是 display:flex，会盖掉 UA 的 [hidden]{display:none}，
       于是 el.hidden = true 根本藏不住（实测：空的结算面板会一直挂在屏幕中间）。
       这一条把 hidden 抢回来。 */
    .race-hud [hidden] { display: none !important; }
    /* 左上：圈数。Hud.ts 的 .hud-stats 占了 top:20，这里往下让一行 */
    .race-lap {
      position: absolute; left: 24px; top: 54px;
      display: flex; align-items: baseline; gap: 4px;
    }
    .race-lap-label { font-size: 13px; opacity: 0.7; margin-right: 4px; letter-spacing: 1px; }
    .race-lap-value { font-size: 40px; font-weight: 700; line-height: 1; }
    .race-lap-total { font-size: 20px; opacity: 0.65; }
    .race-pos {
      position: absolute; left: 24px; top: 104px;
      display: flex; align-items: baseline; gap: 3px;
    }
    .race-pos-value { font-size: 30px; font-weight: 700; line-height: 1; }
    .race-pos-label { font-size: 13px; opacity: 0.7; }

    /* 右上：三行计时。lil-gui 也钉在右上角（宽 245px），开着的时候往左让开 */
    .race-times {
      position: absolute; right: 24px; top: 20px;
      transition: right 120ms ease;
      display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
      background: rgba(0,0,0,0.28); padding: 8px 12px; border-radius: 8px;
    }
    .race-row { display: flex; align-items: baseline; gap: 10px; }
    .race-k { font-size: 11px; opacity: 0.65; letter-spacing: 1px; }
    .race-v { font-size: 17px; font-variant-numeric: tabular-nums; min-width: 8ch; text-align: right; }
    .race-row-cur .race-v { font-size: 26px; font-weight: 700; }
    .race-row-best .race-v { color: var(--race-best); }
    .race-row-best .race-v.race-v-record { color: var(--race-record); }
    .race-row-record .race-v { opacity: 0.75; font-size: 14px; }
    body.debug-gui-open .race-times { right: 264px; }

    /* 中央：倒计时 / 圈速弹窗 */
    .race-center {
      position: absolute; left: 50%; top: 42%;
      transform: translate(-50%, -50%);
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      font-weight: 800; letter-spacing: -1px; white-space: nowrap;
      text-shadow: 0 4px 22px rgba(0,0,0,0.7);
    }
    .race-center-count { font-size: 130px; line-height: 1; }
    .race-center-go { font-size: 110px; line-height: 1; color: #8dff9e; }
    .race-pop-tag { font-size: 19px; font-weight: 700; letter-spacing: 4px; opacity: 0.9; }
    .race-pop-time { font-size: 54px; font-variant-numeric: tabular-nums; }
    .race-center-best .race-pop-time, .race-center-best .race-pop-tag { color: var(--race-best); }
    .race-center-record .race-pop-time, .race-center-record .race-pop-tag {
      color: var(--race-record);
      text-shadow: 0 0 18px rgba(124,247,196,0.75), 0 4px 22px rgba(0,0,0,0.7);
    }
    .race-center-record .race-pop-tag { font-size: 24px; }

    .race-warn {
      position: absolute; left: 50%; top: 14%; transform: translateX(-50%);
      font-size: 14px; color: #ffb3b3;
      background: rgba(90,0,0,0.4); padding: 5px 12px; border-radius: 999px;
    }

    /* 结算面板 */
    .race-results {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      min-width: 300px; padding: 22px 30px 18px;
      background: rgba(10,12,18,0.82); border: 1px solid rgba(255,255,255,0.14);
      border-radius: 14px; backdrop-filter: blur(6px);
      display: flex; flex-direction: column; align-items: center; gap: 6px;
    }
    .race-res-title { font-size: 15px; letter-spacing: 6px; opacity: 0.7; }
    .race-res-place { font-size: 22px; font-weight: 700; }
    .race-res-total { font-size: 46px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .race-res-laps { list-style: none; margin: 10px 0 4px; padding: 0; width: 100%; }
    .race-res-lap {
      display: flex; justify-content: space-between; gap: 24px;
      font-size: 15px; padding: 3px 0; font-variant-numeric: tabular-nums;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .race-res-lap-best { color: var(--race-best); font-weight: 700; }
    .race-res-best { font-size: 14px; color: var(--race-best); }
    .race-res-record { font-size: 14px; color: var(--race-record); font-weight: 700; }
    .race-res-hint { font-size: 12px; opacity: 0.55; margin-top: 8px; }

    @media (max-width: 640px) {
      .race-lap-value { font-size: 28px; }
      .race-row-cur .race-v { font-size: 20px; }
      .race-v { font-size: 14px; }
      .race-center-count { font-size: 84px; }
      .race-center-go { font-size: 70px; }
      .race-pop-time { font-size: 38px; }
    }
  `;
  document.head.appendChild(style);
}
