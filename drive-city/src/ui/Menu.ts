import type { Engine } from '../core/Engine';
import { LANG_NAME, LANGS, lang, setLang, onLangChange, t } from '../core/I18n';
import { QUALITY_CHOICE_KEY, type QualityTier } from '../core/Quality';
import { C, F, css, el } from './theme';
import { L } from './lang';

css(`
.menu{position:fixed;inset:0;z-index:20;font-family:${F.ui};color:${C.paper};display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:32px;
  padding:max(28px,4vh) max(28px,4vw);box-sizing:border-box;
  background:linear-gradient(90deg,rgba(9,11,13,.86) 0%,rgba(9,11,13,.55) 38%,rgba(9,11,13,0) 70%),linear-gradient(0deg,rgba(9,11,13,.6),rgba(9,11,13,0) 40%)}
.menu[hidden]{display:none}
.menu .left{max-width:560px;display:grid;gap:14px}
.menu .tag{font:700 12px/1 ${F.num};letter-spacing:.28em;color:${C.yellow};text-transform:uppercase}
.menu h1{margin:0;font:900 clamp(56px,9vw,112px)/.88 ${F.num};letter-spacing:-.035em;text-transform:uppercase}
.menu h1 .place{display:block;margin-top:10px;font:900 clamp(40px,6vw,76px)/1 ${F.ui};letter-spacing:.06em;color:${C.yellow}}
.menu .sub{font:600 17px/1.5 ${F.ui};color:${C.paper}}
.menu .note{font:400 14px/1.6 ${F.ui};color:${C.muted};max-width:46ch}
.menu .row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px}
.menu button{font:inherit;cursor:pointer;border:0;border-radius:6px}
.menu .go{padding:15px 30px;background:${C.yellow};color:${C.ink};font:800 18px/1 ${F.ui};letter-spacing:.12em;box-shadow:0 8px 28px rgba(243,181,15,.28)}
.menu .go:hover,.menu .go:focus-visible{background:#ffd04a;outline:none}
.menu .seg{display:inline-flex;border:1px solid ${C.line};border-radius:6px;overflow:hidden}
.menu .seg button{padding:9px 13px;background:transparent;color:${C.muted};font:700 12px/1 ${F.ui};letter-spacing:.1em}
.menu .seg button.on{background:rgba(244,241,232,.14);color:${C.paper}}
.menu .seg button:focus-visible{outline:2px solid ${C.yellow};outline-offset:-2px}
.menu .seglabel{font:700 11px/1 ${F.num};letter-spacing:.2em;color:${C.muted};margin-right:2px}
.menu .card{min-width:300px;padding:18px 20px;border-radius:10px;background:${C.inkGlass};border:1px solid ${C.line};backdrop-filter:blur(8px)}
.menu .card h2{margin:0 0 10px;font:800 12px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.menu .card .k{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;align-items:center;font:500 13px/1.3 ${F.ui}}
.menu .card kbd{display:inline-block;min-width:22px;padding:0 6px;margin-right:4px;border-radius:4px;border:1px solid ${C.line};background:rgba(244,241,232,.08);font:700 11px/22px ${F.mono};text-align:center}
.menu .card .pad{margin-top:12px;font:400 12px/1.5 ${F.ui};color:${C.muted};max-width:36ch}
.menu .pausehint{font:500 14px/1.4 ${F.ui};color:${C.muted}}
@media (max-width: 820px){.menu{grid-template-columns:1fr;align-items:end}.menu .card{display:none}}
/* A phone held sideways is only ~390px tall: compact the title so the start button stays on screen. */
@media (max-height: 470px){
  .menu{padding:12px 16px;gap:12px;align-items:center;overflow:auto}
  .menu .left{gap:7px}
  .menu h1{font-size:clamp(28px,7.5vh,52px)}
  .menu h1 .place{font-size:clamp(20px,5.5vh,38px);margin-top:2px}
  .menu .note{display:none}
  .menu .sub{font-size:14px}
  .menu .go{padding:11px 22px;font-size:15px}
}
`);

export type MenuState = 'title' | 'playing' | 'paused';

/** Title and pause screens over the live scene. */
export class Menu {
  readonly root: HTMLDivElement;
  private goLabel: Text;
  private title: HTMLElement;
  private pauseHint: HTMLElement;
  private noteEl: HTMLElement;
  private subEl: HTMLElement;
  onStart: () => void = () => {};

  constructor(private engine: Engine, container: HTMLElement) {
    const root = this.root = el('div', 'menu', container);
    const left = el('div', 'left', root);
    const tag = el('div', 'tag', left); tag.appendChild(L('title.tag'));
    const h1 = this.title = el('h1', '', left);
    h1.appendChild(L('title.name'));
    const place = el('span', 'place', h1); place.appendChild(L('title.place'));
    this.subEl = el('div', 'sub', left); this.subEl.appendChild(L('title.sub'));
    this.noteEl = el('div', 'note', left); this.noteEl.appendChild(L('title.note'));
    this.pauseHint = el('div', 'pausehint', left); this.pauseHint.appendChild(L('pause.hint'));
    const row = el('div', 'row', left);
    const go = el('button', 'go', row);
    go.id = 'start';
    this.goLabel = L('title.start');
    go.appendChild(this.goLabel);
    go.addEventListener('click', () => this.onStart());
    const opts = el('div', 'row', left);
    const langSeg = el('div', 'seg', opts);
    for (const l of LANGS) {
      const b = el('button', l === lang() ? 'on' : '', langSeg);
      b.textContent = LANG_NAME[l];
      b.addEventListener('click', () => setLang(l));
    }
    onLangChange((l) => { [...langSeg.children].forEach((b, i) => b.classList.toggle('on', LANGS[i] === l)); });
    const qLabel = el('span', 'seglabel', opts); qLabel.appendChild(L('settings.quality'));
    const qSeg = el('div', 'seg', opts);
    for (const tier of ['low', 'medium', 'high'] as QualityTier[]) {
      const b = el('button', tier === engine.quality.tier ? 'on' : '', qSeg);
      b.appendChild(L(`settings.q.${tier}` as 'settings.q.low'));
      b.addEventListener('click', () => {
        if (tier === engine.quality.tier) return;
        try { localStorage.setItem(QUALITY_CHOICE_KEY, tier); } catch { /* ignore */ }
        const u = new URL(location.href); u.searchParams.set('quality', tier); location.href = u.toString();
      });
    }
    const card = el('div', 'card', root);
    const h2 = el('h2', '', card); h2.appendChild(L('title.controls'));
    const k = el('div', 'k', card);
    const rows: [string, Parameters<typeof L>[0]][] = [['W S', 'ctl.drive'], ['A D', 'ctl.steer'], ['@key.space', 'ctl.handbrake'], ['V', 'ctl.camera'], ['C', 'ctl.lookBack'], ['@key.mouse', 'ctl.orbit'], ['E', 'ctl.horn'], ['R', 'ctl.reset'], ['F', 'ctl.enter'], ['Shift', 'ctl.sprint'], ['LMB', 'ctl.shove'], ['Tab', 'ctl.map'], ['W+S', 'ctl.burnout'], ['M', 'ctl.mute'], ['F1', 'ctl.help'], ['Esc', 'ctl.pause']];
    for (const [keys, key] of rows) {
      const a = el('span', '', k);
      for (const x of keys.split(' ')) { const kb = el('kbd', '', a); kb.append(x.startsWith('@') ? L(x.slice(1) as 'key.space') : x); }
      const b = el('span', '', k); b.appendChild(L(key));
    }
    const pad = el('div', 'pad', card); pad.appendChild(L('ctl.pad'));
    this.set('title');
  }

  set(state: MenuState): void {
    this.root.hidden = state === 'playing';
    const paused = state === 'paused';
    this.goLabel.data = t(paused ? 'title.resume' : 'title.start');
    this.pauseHint.hidden = !paused;
    this.noteEl.hidden = paused;
    this.subEl.hidden = paused;
    this.title.style.opacity = paused ? '0.85' : '1';
  }
}
