import type { Engine } from '../core/Engine';
import { onLangChange, t } from '../core/I18n';
import { BOARDS, type BoardId, type LeaderboardApi } from '../online/Leaderboard';
import { C, F, css, el } from './theme';
import { L } from './lang';

css(`
.boards{position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:rgba(9,11,13,.6);font-family:${F.ui};color:${C.paper};padding:16px;box-sizing:border-box}
.boards[hidden]{display:none}
.boards .box{width:min(560px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;border-radius:12px;background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5)}
.boards .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.boards h2{margin:0;font:800 13px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.boards button{font:inherit;cursor:pointer;border:0;border-radius:6px;color:inherit}
.boards .x{background:transparent;color:${C.muted};font-size:22px;line-height:1;padding:2px 8px}
.boards .name{display:flex;gap:8px;align-items:center;margin-bottom:12px;font:600 13px/1 ${F.ui};color:${C.muted}}
.boards .name input{flex:1;min-width:0;padding:8px 10px;border-radius:6px;border:1px solid ${C.line};background:rgba(244,241,232,.06);color:${C.paper};font:600 14px/1.2 ${F.ui}}
.boards .name button{padding:8px 12px;background:rgba(244,241,232,.12);font:700 12px/1 ${F.ui};letter-spacing:.08em}
.boards .tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.boards .tabs button{padding:7px 10px;background:rgba(244,241,232,.07);color:${C.muted};font:700 12px/1.1 ${F.ui}}
.boards .tabs button.on{background:${C.yellow};color:${C.ink}}
.boards ol{list-style:none;margin:0;padding:0;display:grid;gap:2px;min-height:120px;align-content:start}
.boards li{display:grid;grid-template-columns:32px 1fr auto;gap:10px;padding:7px 10px;border-radius:6px;background:rgba(244,241,232,.04);font:600 14px/1.2 ${F.ui}}
.boards li b{font:800 14px/1.2 ${F.num};color:${C.muted}}
.boards li:nth-child(1) b{color:${C.yellow}}
.boards li .v{font:700 14px/1.2 ${F.num};font-variant-numeric:tabular-nums}
.boards li.me{background:rgba(243,181,15,.18)}
.boards .foot{margin-top:10px;font:600 13px/1.5 ${F.ui};color:${C.muted};min-height:20px}
.boards .foot.me{color:${C.paper}}
`);

/**
 * The leaderboards (Menu's 排行榜 button, title and pause): one tab per board, the top ten, the
 * player's own rank under them, and their nickname. Reads through `LeaderboardApi`; when the boards
 * are off (a dev server, shot mode) or unreachable it says so instead of a table.
 */
export class Boards {
  readonly root: HTMLDivElement;
  private list: HTMLOListElement;
  private foot: HTMLDivElement;
  private tabs: HTMLDivElement;
  private input: HTMLInputElement;
  private board: BoardId = 'race0';
  private seq = 0;

  constructor(private engine: Engine, container: HTMLElement) {
    const root = this.root = el('div', 'boards', container);
    root.hidden = true;
    root.addEventListener('click', (e) => { if (e.target === root) this.hide(); });
    // Typing a name must not drive the car or pause the game (Input listens on window).
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); e.stopPropagation(); });
    const box = el('div', 'box', root);
    const top = el('div', 'top', box);
    el('h2', '', top).appendChild(L('lb.title'));
    const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.hide());
    const nameRow = el('div', 'name', box);
    el('span', '', nameRow).appendChild(L('lb.you'));
    this.input = el('input', '', nameRow);
    this.input.maxLength = 12;
    const save = el('button', '', nameRow); save.appendChild(L('lb.save'));
    const commit = () => { const lb = this.api(); if (lb) { lb.nick = this.input.value; this.input.value = lb.nick; void this.load(); } };
    save.addEventListener('click', commit);
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    this.tabs = el('div', 'tabs', box);
    this.list = el('ol', '', box);
    this.foot = el('div', 'foot', box);
    onLangChange(() => { if (!root.hidden) { this.buildTabs(); void this.load(); } });
  }

  private api() { return this.engine.get<LeaderboardApi>('leaderboard'); }

  private buildTabs(): void {
    const lb = this.api();
    this.tabs.textContent = '';
    for (const b of BOARDS) {
      const btn = el('button', b.id === this.board ? 'on' : '', this.tabs);
      btn.textContent = lb ? lb.label(b.id) : b.id;
      btn.addEventListener('click', () => { this.board = b.id; this.buildTabs(); void this.load(); });
    }
  }

  show(board?: BoardId): void {
    if (board) this.board = board;
    this.root.hidden = false;
    this.input.value = this.api()?.nick ?? '';
    this.buildTabs();
    void this.load();
  }
  hide(): void { this.root.hidden = true; }
  get open(): boolean { return !this.root.hidden; }

  private async load(): Promise<void> {
    const lb = this.api(), n = ++this.seq, board = this.board;
    this.list.textContent = '';
    this.foot.className = 'foot';
    if (!lb?.enabled) { this.foot.textContent = t('lb.off'); return; }
    this.foot.textContent = t('lb.loading');
    const data = await lb.fetch(board);
    if (n !== this.seq) return;
    if (!data) { this.foot.textContent = t('lb.error'); return; }
    data.top.forEach((r, i) => {
      const li = el('li', r.me ? 'me' : '', this.list);
      el('b', '', li).textContent = String(i + 1);
      el('span', '', li).textContent = r.name;
      el('span', 'v', li).textContent = lb.format(board, r.score);
    });
    if (data.me) { this.foot.className = 'foot me'; this.foot.textContent = t('lb.mine', { rank: data.me.rank, total: data.total, score: lb.format(board, data.me.score) }); }
    else this.foot.textContent = data.top.length ? t('lb.none', { total: data.total }) : t('lb.empty');
  }
}
