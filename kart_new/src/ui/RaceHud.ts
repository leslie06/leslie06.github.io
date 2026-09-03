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
import { injectTheme } from './theme';

/**
 * 赛道进度条上的一个点。每辆车一个。
 * t 直接用赛道进度（0..1），不是 totalProgress —— 进度条画的是"在这一圈的什么位置"。
 */
export interface TrackDot {
  id: string;
  /** 0..1 */
  t: number;
  /** 和车身同色，一眼对得上 */
  color: string;
  isPlayer: boolean;
}

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
  /** 赛道进度条上的小圆点，每辆车一个。空数组 = 不画进度条 */
  dots: readonly TrackDot[];
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
  /** 完整排名表（含 AI）。单人局是空数组 */
  standings: readonly ResultRow[];
}

/** 结算排名表的一行。 */
export interface ResultRow {
  place: number;
  name: string;
  isPlayer: boolean;
  color: string;
  /** 完赛总时间；没跑完是 null */
  finishTime: number | null;
  /** 已完成圈数，给没跑完的车显示"第 n 圈" */
  lap: number;
  finished: boolean;
}

export interface RaceHudActions {
  /** "再来一局"：同一条赛道从头开始 */
  onRestart?: () => void;
  /** "换赛道"：回主菜单重选 */
  onChangeTrack?: () => void;
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
  private readonly trackBar: HTMLElement;
  /** 进度条上的小圆点，按 id 复用 DOM，不每帧重建 */
  private readonly dotEls = new Map<string, HTMLElement>();

  /** 中央提示的剩余显示时间 */
  private popupTime = 0;
  private popupTotal = POPUP_DURATION;
  /** 结算面板已经按这个签名渲染过了，内容没变就不重建 DOM */
  private resultsSignature = '';

  /**
   * @param actions 结算面板上两个按钮的回调。触屏上没有 R 键，
   *                "再来一局"是唯一的重开入口；"换赛道"要重载页面（见 main.ts 的说明）
   */
  constructor(parent: HTMLElement, private readonly actions: RaceHudActions = {}) {
    injectTheme();
    injectRaceStyles();

    this.root = document.createElement('div');
    this.root.className = 'race-hud';
    this.root.innerHTML = `
      <div class="race-lap k-outline">
        <span class="race-lap-label">LAP</span><!--
     --><span class="race-lap-value k-num">1</span><!--
     --><span class="race-lap-total k-num">/3</span>
      </div>
      <div class="race-pos k-outline-lg" hidden>
        <span class="race-pos-value k-num">1</span><span class="race-pos-label">位</span>
      </div>
      <div class="race-times k-chip">
        <div class="race-row race-row-cur"><span class="race-k">本圈</span><span class="race-v k-num">0.000</span></div>
        <div class="race-row race-row-last"><span class="race-k">上圈</span><span class="race-v k-num">--.---</span></div>
        <div class="race-row race-row-best"><span class="race-k">最佳</span><span class="race-v k-num">--.---</span></div>
        <div class="race-row race-row-record"><span class="race-k">纪录</span><span class="race-v k-num">--.---</span></div>
      </div>
      <div class="race-track" hidden><div class="race-track-line"></div></div>
      <div class="race-center k-outline-lg" hidden></div>
      <div class="race-warn" hidden>⚠ 漏了 checkpoint · 本圈不计</div>
      <div class="race-results k-panel" hidden></div>
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
    this.trackBar = q('.race-track');
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

    // --- 赛道进度条 ---
    this.renderDots(view.dots);

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

  /**
   * 赛道进度条：一条横线 + 每辆车一个小圆点。
   * 圆点按 id 复用 DOM，只改 left / background，不每帧重建元素。
   */
  private renderDots(dots: readonly TrackDot[]): void {
    this.trackBar.hidden = dots.length < 2;
    if (this.trackBar.hidden) return;

    const seen = new Set<string>();
    for (const dot of dots) {
      seen.add(dot.id);
      let el = this.dotEls.get(dot.id);
      if (!el) {
        el = document.createElement('i');
        el.className = dot.isPlayer ? 'race-dot race-dot-me' : 'race-dot';
        this.trackBar.appendChild(el);
        this.dotEls.set(dot.id, el);
      }
      // t 折回 [0,1)：车过线的那一帧 t 会从 0.999 跳回 0，圆点跟着绕回起点
      const t = ((dot.t % 1) + 1) % 1;
      // 横线左右各让开 10px 内边距，所以 0%~100% 要映射到 [10px, 宽度-10px]
      el.style.left = `calc(10px + ${(t * 100).toFixed(2)}% - ${(t * 20).toFixed(2)}px)`;
      if (el.style.background !== dot.color) el.style.background = dot.color;
    }
    // 车退出（理论上不会，但重开局换阵容时会）就把多余的点删掉
    for (const [id, el] of this.dotEls) {
      if (seen.has(id)) continue;
      el.remove();
      this.dotEls.delete(id);
    }
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
    // 排名表也进签名：AI 还在跑，名次会一直变，内容变了就得重画
    const standings = r.standings.map((s) => `${s.place}${s.name}${s.finishTime ?? s.lap}`).join(';');
    const signature = `${r.place}|${r.totalTime}|${r.lapTimes.join(',')}|${r.newRecord}|${standings}`;
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
      <div class="race-res-title k-label">完赛</div>
      ${view.racerCount > 1 ? `<div class="race-res-place k-outline">第 ${r.place} 名</div>` : ''}
      <div class="race-res-total k-num">${formatTime(r.totalTime)}</div>
      <ol class="race-res-laps">${rows}</ol>
      <div class="race-res-best">最佳圈 <span class="k-num">${formatTimeOrDash(r.bestLap)}</span></div>
      ${r.newRecord ? '<div class="race-res-record">★ 打破本地纪录</div>' : ''}
      ${renderStandings(r.standings)}
      <div class="race-res-actions">
        <button class="k-btn race-res-again" type="button">再来一局</button>
        <button class="k-btn k-btn-ghost race-res-change" type="button">换赛道</button>
      </div>
      <div class="race-res-hint">或按 R 重开</div>
    `;
    this.results
      .querySelector('.race-res-again')!
      .addEventListener('click', () => this.actions.onRestart?.());
    this.results
      .querySelector('.race-res-change')!
      .addEventListener('click', () => this.actions.onChangeTrack?.());
    this.results.hidden = false;
  }
}

/** 结算面板下半截的完整排名表。单人局（空数组）不画。 */
function renderStandings(rows: readonly ResultRow[]): string {
  if (rows.length < 2) return '';
  const items = rows
    .map((row) => {
      // 还没跑完的车没有总时间，显示它跑到第几圈了
      const right = row.finished ? formatTime(row.finishTime ?? 0) : `第 ${row.lap + 1} 圈`;
      return `<li class="race-rank-row${row.isPlayer ? ' race-rank-me' : ''}">
        <span class="race-rank-place">${row.place}</span>
        <i class="race-rank-chip" style="background:${escapeAttr(row.color)}"></i>
        <span class="race-rank-name">${escapeHtml(row.name)}</span>
        <span class="race-rank-time${row.finished ? '' : ' race-rank-dnf'}">${right}</span>
      </li>`;
    })
    .join('');
  return `<div class="race-rank-title">排名</div><ol class="race-rank">${items}</ol>`;
}

/** 名字来自配置表，不是用户输入，但拼进 innerHTML 之前还是转义一下。 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function escapeAttr(text: string): string {
  return text.replace(/["'<>&]/g, '');
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
      color: var(--k-text); font-family: var(--k-font);
    }
    /* 下面好几个块都是 display:flex，会盖掉 UA 的 [hidden]{display:none}，
       于是 el.hidden = true 根本藏不住（实测：空的结算面板会一直挂在屏幕中间）。
       这一条把 hidden 抢回来。 */
    .race-hud [hidden] { display: none !important; }

    /* 左上：圈数。Hud.ts 的 .hud-stats 占了 top:20，这里往下让一行 */
    .race-lap {
      position: absolute; left: 26px; top: 56px;
      display: flex; align-items: baseline; gap: 4px;
    }
    .race-lap-label {
      font-size: 12px; font-weight: 800; letter-spacing: 3px;
      opacity: 0.75; margin-right: 5px;
    }
    .race-lap-value { font-size: 44px; font-weight: 900; line-height: 0.95; }
    .race-lap-total { font-size: 20px; font-weight: 700; opacity: 0.7; }
    /* 名次：整块 HUD 里最大的一个数字。它是"我现在打得怎么样"的唯一答案，
       扫一眼就该看到，所以字号压过速度表 */
    .race-pos {
      position: absolute; left: 26px; top: 106px;
      display: flex; align-items: baseline; gap: 4px;
    }
    .race-pos-value {
      font-size: 56px; font-weight: 900; line-height: 0.9;
      color: var(--k-gold);
    }
    .race-pos-label { font-size: 15px; font-weight: 700; opacity: 0.8; }

    /* 右上：四行计时。lil-gui 也钉在右上角（宽 245px），开着的时候往左让开 */
    .race-times {
      position: absolute; right: 26px; top: 20px;
      transition: right 120ms ease;
      display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
      padding: 10px 14px;
    }
    .race-row { display: flex; align-items: baseline; gap: 12px; }
    .race-k { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: var(--k-text-dim); }
    .race-v { font-size: 17px; min-width: 8ch; text-align: right; }
    .race-row-cur .race-v { font-size: 27px; font-weight: 800; }
    .race-row-best .race-v { color: var(--k-gold); }
    .race-row-best .race-v.race-v-record { color: var(--k-mint); }
    .race-row-record .race-v { opacity: 0.75; font-size: 14px; }
    body.debug-gui-open .race-times { right: 268px; }
    /* 触屏时右上角被道具键占着，计时面板往左让，同时避开刘海 */
    body.touch-input .race-times {
      top: calc(14px + env(safe-area-inset-top));
      right: calc(30px + clamp(58px, 12vmin, 92px) + env(safe-area-inset-right));
    }

    /* 中央：倒计时 / 圈速弹窗 */
    .race-center {
      position: absolute; left: 50%; top: 42%;
      transform: translate(-50%, -50%);
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      font-weight: 900; letter-spacing: -1px; white-space: nowrap;
    }
    .race-center-count { font-size: 140px; line-height: 1; }
    .race-center-go { font-size: 118px; line-height: 1; color: var(--k-mint); }
    .race-pop-tag { font-size: 19px; font-weight: 800; letter-spacing: 5px; opacity: 0.92; }
    .race-pop-time { font-size: 56px; font-family: var(--k-font-num); font-variant-numeric: tabular-nums; }
    .race-center-best .race-pop-time, .race-center-best .race-pop-tag { color: var(--k-gold); }
    .race-center-record .race-pop-time, .race-center-record .race-pop-tag { color: var(--k-mint); }
    .race-center-record .race-pop-tag { font-size: 24px; }

    .race-warn {
      position: absolute; left: 50%; top: 14%; transform: translateX(-50%);
      font-size: 13px; font-weight: 700; color: #fff;
      background: rgba(190, 30, 40, 0.75);
      border: 1px solid rgba(255,255,255,0.25);
      padding: 6px 14px; border-radius: var(--k-r-pill);
      box-shadow: var(--k-shadow-chip);
    }

    /* 结算面板 */
    .race-results {
      z-index: 40;
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      min-width: 320px; max-width: min(92vw, 420px); max-height: 88vh; overflow-y: auto;
      padding: 24px 30px 20px;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      /* 面板整体是 pointer-events: auto，否则滚动排名表时手指会穿到摇杆上 */
      pointer-events: auto;
    }
    .race-res-title { font-size: 12px; }
    .race-res-place { font-size: 26px; font-weight: 900; color: var(--k-gold); }
    .race-res-total { font-size: 48px; font-weight: 900; line-height: 1; }
    .race-res-laps { list-style: none; margin: 12px 0 4px; padding: 0; width: 100%; }
    .race-res-lap {
      display: flex; justify-content: space-between; gap: 24px;
      font-size: 15px; padding: 4px 0;
      font-family: var(--k-font-num); font-variant-numeric: tabular-nums;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .race-res-lap-best { color: var(--k-gold); font-weight: 700; }
    .race-res-best { font-size: 14px; color: var(--k-gold); }
    .race-res-record { font-size: 14px; color: var(--k-mint); font-weight: 800; letter-spacing: 1px; }
    .race-res-actions { display: flex; gap: 10px; margin-top: 16px; }
    .race-res-hint { font-size: 12px; color: var(--k-text-dim); margin-top: 8px; }

    /* 结算面板下半截：完整排名表 */
    .race-rank-title { font-size: 11px; letter-spacing: 4px; color: var(--k-text-dim); margin-top: 14px; }
    .race-rank {
      list-style: none; margin: 6px 0 0; padding: 0; width: 100%;
      max-height: 34vh; overflow-y: auto;
    }
    .race-rank-row {
      display: flex; align-items: center; gap: 9px;
      font-size: 14px; padding: 4px 0;
      font-variant-numeric: tabular-nums;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .race-rank-me { color: var(--k-gold); font-weight: 800; }
    .race-rank-place { width: 2ch; text-align: right; opacity: 0.75; font-family: var(--k-font-num); }
    .race-rank-chip {
      width: 11px; height: 11px; border-radius: 4px; flex: none;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.5);
    }
    .race-rank-name { flex: 1; min-width: 5ch; }
    .race-rank-time { opacity: 0.9; font-family: var(--k-font-num); }
    .race-rank-dnf { opacity: 0.5; }

    /* 底部中央：赛道进度条。一条横线，每辆车一个小圆点。
       路面是浅色的，所以垫一层深色底，不然白点和白线在直道上会糊掉。
       bottom 要给 .hud-help 那行按键提示（bottom: 8px）让开位置 */
    .race-track {
      position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%);
      width: min(46vw, 520px); height: 18px;
      padding: 0 10px; box-sizing: content-box;
      background: rgba(13,17,27,0.45); border-radius: var(--k-r-pill);
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    }
    .race-track-line {
      position: absolute; left: 10px; right: 10px; top: 50%; height: 4px;
      margin-top: -2px; border-radius: 2px;
      background: rgba(255,255,255,0.28);
    }
    /* 起点/终点线：进度条的两端 */
    .race-track-line::before, .race-track-line::after {
      content: ''; position: absolute; top: -3px; width: 2px; height: 10px;
      background: rgba(255,255,255,0.8);
    }
    .race-track-line::before { left: 0; }
    .race-track-line::after { right: 0; }
    /* 圆点用 calc 把 0%~100% 映射到横线的两端（横线两边各让开 10px 内边距） */
    .race-dot {
      position: absolute; top: 50%; width: 9px; height: 9px;
      margin: -4.5px 0 0 -4.5px; border-radius: 50%;
      background: #fff; box-shadow: 0 0 0 1.5px rgba(0,0,0,0.55);
      transition: left 90ms linear;
    }
    /* 玩家的点大一圈、带白环，一眼找得到自己 */
    .race-dot-me {
      width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px; z-index: 1;
      box-shadow: 0 0 0 2px #fff, 0 0 8px rgba(0,0,0,0.6);
    }

    /* 触屏：左上角那一列也要让开刘海 */
    body.touch-input .race-lap { left: calc(20px + env(safe-area-inset-left)); }
    body.touch-input .race-pos { left: calc(20px + env(safe-area-inset-left)); }

    @media (max-width: 640px) {
      .race-lap-value { font-size: 30px; }
      .race-pos-value { font-size: 40px; }
      .race-row-cur .race-v { font-size: 20px; }
      .race-v { font-size: 14px; }
      .race-center-count { font-size: 92px; }
      .race-center-go { font-size: 76px; }
      .race-pop-time { font-size: 40px; }
      .race-results { min-width: 0; padding: 18px 20px 16px; }
      .race-res-total { font-size: 38px; }
    }
  `;
  document.head.appendChild(style);
}
