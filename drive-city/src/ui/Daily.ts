import type { Engine } from '../core/Engine';
import { onLangChange, t } from '../core/I18n';
import type { DailyApi } from '../daily';
import { CARD, FULL_BONUS, seasonOf, STREAK_MAX, STREAK_STEP, type Reward } from '../daily/Daily';
import type { UiApi } from '.';
import { C, F, css, el } from './theme';

css(`
.daily{position:fixed;inset:0;z-index:46;display:grid;place-items:center;background:rgba(9,11,13,.6);font-family:${F.ui};color:${C.paper};padding:16px;box-sizing:border-box}
.daily[hidden]{display:none}
.daily .box{width:min(540px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;border-radius:12px;background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5)}
.daily .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.daily h2{margin:0;font:800 13px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.daily button{font:inherit;cursor:pointer;border:0;border-radius:6px;color:inherit;touch-action:manipulation}
.daily .x{background:transparent;color:${C.muted};font-size:22px;line-height:1;padding:2px 8px}
.daily .hint{font:500 13px/1.5 ${F.ui};color:${C.muted}}
.daily .streak{font:700 13px/1.5 ${F.ui};color:#f3c64a;margin:2px 0 10px}
.daily ol{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.daily li{padding:10px 12px;border-radius:8px;background:rgba(244,241,232,.05)}
.daily li.done{opacity:.6}
.daily li .l1{display:flex;align-items:center;gap:8px}
.daily li .k{font:800 10px/1 ${F.num};letter-spacing:.14em;padding:4px 6px;border-radius:4px;background:rgba(244,241,232,.1);white-space:nowrap}
.daily li .k.t1{background:rgba(243,181,15,.2);color:${C.yellow}}.daily li .k.t2{background:rgba(226,64,47,.22);color:#ff8a7a}
.daily li .n{flex:1;font:800 15px/1.3 ${F.ui}}
.daily li .p{font:800 14px/1 ${F.num};color:#f3c64a;white-space:nowrap}
.daily li .bar{height:5px;border-radius:3px;background:rgba(244,241,232,.1);margin:8px 0 2px;overflow:hidden}
.daily li .bar i{display:block;height:100%;background:${C.yellow}}
.daily li .l2{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;font:600 12px/1.4 ${F.ui};color:${C.muted}}
.daily li .l2 .sp{flex:1}
.daily li .l2 button{padding:7px 10px;background:rgba(244,241,232,.12);font:800 12px/1 ${F.ui};letter-spacing:.04em;white-space:nowrap}
.daily li .l2 button.go{background:${C.yellow};color:${C.ink}}
.daily li .l2 button:disabled{opacity:.4;cursor:default}
.daily .full{margin:10px 0 0;font:700 13px/1.5 ${F.ui};color:${C.paper}}
.daily .card{margin-top:12px;padding:10px 12px;border-radius:8px;border:1px solid ${C.line}}
.daily .card .h{font:700 12px/1.4 ${F.ui};color:${C.muted};margin-bottom:8px}
.daily .stamps{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.daily .stamps .s{display:grid;justify-items:center;gap:4px;font:700 10px/1.2 ${F.ui};color:${C.muted}}
.daily .stamps .s i{width:28px;height:28px;border-radius:50%;border:2px dashed ${C.line};box-sizing:border-box;display:grid;place-items:center;font:800 11px/1 ${F.num};font-style:normal}
.daily .stamps .s.on i{border:0;background:#c8231d;box-shadow:inset 0 0 0 3px #e8594d;color:#fff}
.daily .stamps .s.gift{color:#f3c64a}
.daily .locked{padding:14px 0;font:600 14px/1.6 ${F.ui};color:${C.muted}}
.daily .foot{margin-top:8px;font:600 13px/1.5 ${F.ui};color:#ff7a6a;min-height:18px}
@media (max-height:470px){.daily{padding:8px}.daily .box{padding:12px 14px}.daily li{padding:7px 10px}.daily .stamps .s i{width:22px;height:22px}}
`);

/**
 * 每日任务's panel (daily/, docs/gta-plan.md §15.4): today's three with their progress, pay, 带我去 / 快速前往 and 换一个;
 * the run of days; the stamp card and what each stamp gives. From the title, the pause screen and the 附近 panel (in
 * play: the game pauses under it and goes on when it closes).
 */
export class DailyPanel {
  readonly root: HTMLDivElement;
  private body: HTMLDivElement;
  private foot: HTMLDivElement;
  private fromPlay = false;

  constructor(private engine: Engine, container: HTMLElement, private resume: () => void) {
    const root = this.root = el('div', 'daily', container);
    root.hidden = true;
    root.addEventListener('click', (e) => { if (e.target === root) this.hide(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); e.stopPropagation(); });
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) root.addEventListener(ev, (e) => e.stopPropagation());
    const box = el('div', 'box', root);
    const top = el('div', 'top', box);
    const h = el('h2', '', top); h.dataset.k = 'dly.title';
    const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.hide());
    this.body = el('div', '', box);
    this.foot = el('div', 'foot', box);
    onLangChange(() => { if (!root.hidden) this.build(); });
  }

  private api() { return this.engine.get<DailyApi>('daily'); }

  private build(): void {
    const d = this.api();
    (this.root.querySelector('h2') as HTMLElement).textContent = t('dly.title');
    this.body.replaceChildren();
    if (!d) return;
    if (!d.open) { el('div', 'locked', this.body).textContent = t('dly.locked'); return; }
    const ms = d.untilTurn, hh = Math.floor(ms / 3_600_000), mm = Math.floor(ms / 60_000) % 60;
    el('div', 'hint', this.body).textContent = t('dly.turn', { h: hh, m: mm });
    const s = d.streak;
    el('div', 'streak', this.body).textContent = s >= 2 ? t('dly.streak', { n: s, p: Math.round(Math.min(STREAK_MAX, s - 1) * STREAK_STEP * 100) }) : s === 1 ? t('dly.streak1') : t('dly.streak0');
    const list = el('ol', '', this.body);
    const swapped = d.saved.swapped;
    for (const r of d.rows) {
      const li = el('li', r.done ? 'done' : '', list);
      const l1 = el('div', 'l1', li);
      el('span', `k t${r.tier}`, l1).textContent = t(`dly.tier.${r.tier}` as 'dly.tier.0');
      el('span', 'n', l1).textContent = r.name;
      el('span', 'p', l1).textContent = r.done ? t('dly.done') : t('dly.pay', { n: r.pay.toLocaleString() });
      const bar = el('div', 'bar', li);
      el('i', '', bar).style.width = `${Math.round(Math.min(1, r.got / r.n) * 100)}%`;
      const l2 = el('div', 'l2', li);
      el('span', 'sp', l2).textContent = `${r.got.toLocaleString()} / ${r.n.toLocaleString()}` + (r.dist !== null && !r.done ? ' · ' + t('dly.km', { n: (r.dist / 1000).toFixed(1) }) : '');
      if (r.done) continue;
      if (r.where) {
        const b = el('button', 'go', l2); b.textContent = t('dly.go');
        b.addEventListener('click', () => { this.hide(); this.toPlay(); d.go(r.i); });
      }
      if (r.jump && (r.dist ?? 0) > 300) {
        const b = el('button', '', l2); b.textContent = t('dly.jump');
        b.addEventListener('click', () => {
          this.hide(); this.toPlay();
          const why = d.jump(r.i);
          if (why) this.engine.get<{ name: string; toast(s: string, secs?: number): void }>('hud')?.toast(why, 3);
        });
      }
      const sw = el('button', '', l2); sw.textContent = t(swapped ? 'dly.swapped' : 'dly.swap'); sw.disabled = swapped;
      sw.addEventListener('click', () => { if (d.swap(r.i)) this.build(); });
    }
    el('div', 'full', this.body).textContent = d.done >= 3 ? t('dly.fullDone') : t('dly.full', { n: FULL_BONUS.toLocaleString() });
    // the card: the season's seven, what each gives
    const cardBox = el('div', 'card', this.body), season = seasonOf(d.saved.season);
    el('div', 'h', cardBox).textContent = t('dly.card', { n: d.saved.stamps, of: CARD, season: t(season.name) });
    const row = el('div', 'stamps', cardBox);
    season.rewards.forEach((rw, k) => {
      const on = k < d.saved.stamps, gift = !('cash' in rw);
      const c = el('div', `s${on ? ' on' : ''}${gift ? ' gift' : ''}`, row);
      el('i', '', c).textContent = String(k + 1);
      el('span', '', c).textContent = this.short(rw);
    });
  }

  private short(r: Reward): string {
    if ('cash' in r) return t('dly.r.cash', { n: r.cash >= 1000 ? `${r.cash / 1000}k` : r.cash });
    if ('paint' in r) return t('dly.r.paint');
    return t(r.wear.startsWith('hat:') ? 'dly.r.hat' : 'dly.r.jacket');
  }

  /** Back into the game (from the title or the pause screen), for 带我去 / 快速前往. */
  private toPlay(): void {
    const ui = this.engine.get<UiApi>('ui');
    if (ui && ui.state !== 'playing') this.resume();
  }

  show(): void {
    const ui = this.engine.get<UiApi>('ui');
    // from the 附近 panel, in play: pause under it, and go on when it closes
    this.fromPlay = ui?.state === 'playing';
    if (this.fromPlay) ui!.pause();
    this.foot.textContent = '';
    this.root.hidden = false;
    this.build();
  }
  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    if (this.fromPlay) { this.fromPlay = false; this.toPlay(); }
  }
  get open(): boolean { return !this.root.hidden; }
}
