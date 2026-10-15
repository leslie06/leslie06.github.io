import type { Engine } from '../core/Engine';
import { onLangChange, t } from '../core/I18n';
import type { CampaignApi } from '../campaign';
import { C, F, css, el } from './theme';
import { L } from './lang';

css(`
.chapters{position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:rgba(9,11,13,.6);font-family:${F.ui};color:${C.paper};padding:16px;box-sizing:border-box}
.chapters[hidden]{display:none}
.chapters .box{width:min(520px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;border-radius:12px;background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5)}
.chapters .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.chapters h2{margin:0;font:800 13px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.chapters button{font:inherit;cursor:pointer;border:0;border-radius:6px;color:inherit}
.chapters .x{background:transparent;color:${C.muted};font-size:22px;line-height:1;padding:2px 8px}
.chapters .hint{font:500 13px/1.5 ${F.ui};color:${C.muted};margin-bottom:12px}
.chapters ol{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.chapters li{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:10px 12px;border-radius:8px;background:rgba(244,241,232,.05)}
.chapters li .k{font:800 11px/1 ${F.num};letter-spacing:.2em;color:${C.yellow};margin-bottom:4px}
.chapters li .n{font:800 16px/1.2 ${F.ui}}
.chapters li .s{font:700 12px/1 ${F.ui};color:${C.muted};white-space:nowrap}
.chapters li .s.gold{color:#f6c445}.chapters li .s.silver{color:#d6dbe0}.chapters li .s.bronze{color:#d08a52}.chapters li .s.next{color:${C.paper}}
.chapters li button{padding:8px 12px;background:rgba(244,241,232,.12);font:800 13px/1 ${F.ui};letter-spacing:.06em;white-space:nowrap}
.chapters li button.go{background:${C.yellow};color:${C.ink}}
.chapters li button.warn{background:#ff5a4a;color:#fff}
.chapters li button:disabled{opacity:.4;cursor:default}
.chapters .quit{margin-top:8px;padding:9px 14px;background:rgba(244,241,232,.12);font:800 13px/1 ${F.ui};letter-spacing:.06em}
.chapters .quit[hidden]{display:none}
.chapters .quit.warn{background:#ff5a4a;color:#fff}
.chapters .foot{margin-top:10px;font:600 13px/1.5 ${F.ui};color:#ff7a6a;min-height:20px}
@media (max-height:470px){.chapters li{padding:7px 10px}.chapters .hint{margin-bottom:8px}}
`);

/**
 * The chapter select (2026-10-15, 「加一个章节选择，已通关的章节可以跳过」; the title's and pause screen's 主线章节
 * button - on the title too since 「怎么把主线章节弄丢了」): every
 * chapter with its medal, 已跳过, 下一章 or 未解锁, and a button - replay a cleared one, start the next, or skip ahead to a
 * locked one (a second tap confirms skipping those before it). Picking one closes the menu and starts it there and then.
 */
export class Chapters {
  readonly root: HTMLDivElement;
  private list: HTMLOListElement;
  private foot: HTMLDivElement;
  private armed = '';
  private quitBtn: HTMLButtonElement;
  private quitArmed = false;

  constructor(private engine: Engine, container: HTMLElement, private resume: () => void) {
    const root = this.root = el('div', 'chapters', container);
    root.hidden = true;
    root.addEventListener('click', (e) => { if (e.target === root) this.hide(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); e.stopPropagation(); });
    const box = el('div', 'box', root);
    const top = el('div', 'top', box);
    el('h2', '', top).appendChild(L('cmp.sel.title'));
    const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.hide());
    el('div', 'hint', box).appendChild(L('cmp.sel.hint'));
    this.list = el('ol', '', box);
    this.foot = el('div', 'foot', box);
    // a chapter running blocks the rest: this gives it up (a second tap confirms)
    this.quitBtn = el('button', 'quit', box);
    this.quitBtn.addEventListener('click', () => {
      if (!this.quitArmed) { this.quitArmed = true; this.build(); return; }
      this.quitArmed = false;
      this.api()?.quit();
      this.build();
    });
    onLangChange(() => { if (!root.hidden) this.build(); });
  }

  private api() { return this.engine.get<CampaignApi>('campaign'); }

  private build(): void {
    const c = this.api();
    this.list.textContent = '';
    if (!c) return;
    const blocked = c.blocked();
    this.foot.textContent = blocked ?? '';
    this.quitBtn.hidden = !c.running;
    this.quitBtn.className = this.quitArmed ? 'quit warn' : 'quit';
    this.quitBtn.textContent = t(this.quitArmed ? 'cmp.sel.quitSure' : 'cmp.sel.quit');
    const rows = c.list();
    rows.forEach((r, i) => {
      const li = el('li', '', this.list);
      const name = el('div', '', li);
      el('div', 'k', name).textContent = r.kick;
      el('div', 'n', name).textContent = r.title;
      const medal = r.state === 'gold' || r.state === 'silver' || r.state === 'bronze';
      el('span', `s ${r.state}`, li).textContent = medal ? t(`cmp.sel.medal.${r.state}` as 'cmp.sel.medal.gold') : t(`cmp.sel.${r.state}` as 'cmp.sel.next');
      const b = el('button', r.state === 'next' ? 'go' : '', li);
      const skips = rows.slice(0, i).filter((p) => p.state === 'next' || p.state === 'locked').length;
      if (r.state === 'locked' && this.armed === r.id) { b.className = 'warn'; b.textContent = t('cmp.sel.confirm', { n: skips }); }
      else b.textContent = t(r.state === 'next' ? 'cmp.sel.start' : r.state === 'locked' ? 'cmp.sel.skip' : 'cmp.sel.replay');
      b.disabled = !!blocked;
      b.addEventListener('click', () => {
        if (r.state === 'locked' && this.armed !== r.id) { this.armed = r.id; this.build(); return; }
        this.armed = '';
        // back into the game first (unpaused, input on), then the chapter's first cutscene takes over
        this.hide();
        this.resume();
        if (!this.api()?.play(r.id)) this.engine.get<{ name: string; toast(s: string): void }>('hud')?.toast(this.api()?.blocked() ?? '');
      });
    });
  }

  show(): void { this.armed = ''; this.quitArmed = false; this.root.hidden = false; this.build(); }
  hide(): void { this.root.hidden = true; this.armed = ''; this.quitArmed = false; }
  get open(): boolean { return !this.root.hidden; }
}
