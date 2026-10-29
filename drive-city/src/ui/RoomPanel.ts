import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { MultiplayerApi } from '../online/Multiplayer';
import { C, F, css, el } from './theme';

css(`
.mpk{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(9,11,13,.6);font-family:${F.ui};color:${C.paper};padding:16px;box-sizing:border-box}
.mpk[hidden]{display:none}
.mpk .box{width:min(520px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;border-radius:12px;background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5)}
.mpk .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.mpk h2{margin:0;font:800 13px/1 ${F.num};letter-spacing:.24em;color:#35e0c2}
.mpk button{font:inherit;cursor:pointer;border:0;border-radius:6px;color:inherit}
.mpk .x{background:transparent;color:${C.muted};font-size:22px;line-height:1;padding:2px 8px}
.mpk .intro{font:500 13px/1.6 ${F.ui};color:${C.muted};margin-bottom:14px}
.mpk .main{padding:12px 22px;background:#35e0c2;color:${C.ink};font:800 15px/1 ${F.ui};letter-spacing:.1em}
.mpk .main:disabled,.mpk .ghost:disabled{opacity:.5;cursor:default}
.mpk .ghost{padding:10px 16px;background:rgba(244,241,232,.1);color:${C.paper};font:700 14px/1 ${F.ui};border:1px solid ${C.line}}
.mpk .or{font:600 12px/1 ${F.ui};color:${C.muted};margin:14px 0 8px}
.mpk .row{display:flex;gap:8px;align-items:center}
.mpk input{flex:1;min-width:0;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid ${C.line};background:rgba(244,241,232,.06);color:${C.paper};font:700 18px/1.2 ${F.num};letter-spacing:.3em}
.mpk input.link{font:500 13px/1.3 ${F.ui};letter-spacing:0;color:${C.muted}}
.mpk .status{font:600 13px/1.5 ${F.ui};color:#ff8a7a;margin-top:10px;min-height:1px}
.mpk .status.ok{color:${C.muted}}
.mpk .code{font:900 46px/1 ${F.num};letter-spacing:.18em;color:#35e0c2;margin:4px 0 6px}
.mpk .label{font:700 12px/1.4 ${F.ui};color:${C.muted};letter-spacing:.08em}
.mpk .who{margin:14px 0 10px;border-top:1px solid ${C.line}}
.mpk .p{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${C.line};font:700 15px/1.3 ${F.ui}}
.mpk .p .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpk .p .s{font:500 12px/1.3 ${F.ui};color:${C.muted};white-space:nowrap}
.mpk .p .you{color:${C.muted};font-weight:500}
.mpk .p button{padding:7px 12px;background:#35e0c2;color:${C.ink};font:800 12px/1 ${F.ui}}
.mpk .empty{font:500 13px/1.5 ${F.ui};color:${C.muted};padding:10px 0}
@media (max-height:520px){
  .mpk{padding:8px}.mpk .box{padding:10px 14px}
  .mpk .intro{margin-bottom:8px;font-size:12px}
  .mpk .code{font-size:34px}
  .mpk .who{margin:8px 0 6px}.mpk .p{padding:5px 0}
}
`);

/**
 * 和朋友联机 (online/Multiplayer.ts), from the title and the pause screen: make a room or join one by its code; in a
 * room, its code and invite link (copied with a tap), who is in it (driving or on foot, how far) with a button to go
 * to each one, and the way out. Typing never reaches the game.
 */
export class RoomPanel {
  readonly root: HTMLDivElement;
  private body: HTMLDivElement;
  private timer = 0;
  private status = '';

  constructor(private engine: Engine, container: HTMLElement, private mp: MultiplayerApi, private resume: () => void) {
    const root = this.root = el('div', 'mpk', container);
    root.hidden = true;
    root.addEventListener('click', (e) => { if (e.target === root) this.hide(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); e.stopPropagation(); });
    root.addEventListener('keyup', (e) => e.stopPropagation());
    const box = el('div', 'box', root);
    const top = el('div', 'top', box);
    el('h2', '', top).textContent = t('mp.title');
    const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.hide());
    this.body = el('div', '', box);
    mp.listen(() => { if (this.open) this.render(); });
  }

  get open(): boolean { return !this.root.hidden; }
  show(): void {
    this.root.hidden = false; this.status = '';
    this.render();
    clearInterval(this.timer);
    // the distances move
    this.timer = window.setInterval(() => { if (this.open && this.mp.status === 'in' && !this.root.contains(document.activeElement)) this.render(); }, 1000);
  }
  hide(): void { this.root.hidden = true; clearInterval(this.timer); }

  private render(): void {
    const b = this.body, mp = this.mp;
    b.textContent = '';
    if (mp.status === 'in' && mp.room) {
      el('div', 'label', b).textContent = t('mp.roomCode');
      el('div', 'code', b).textContent = mp.room;
      el('div', 'intro', b).textContent = t('mp.share', { n: mp.max });
      const row = el('div', 'row', b);
      const link = el('input', 'link', row) as HTMLInputElement;
      link.readOnly = true; link.value = mp.inviteLink();
      const copy = el('button', 'ghost', row); copy.textContent = t('mp.copy');
      copy.addEventListener('click', () => {
        const text = t('mp.copyText', { room: mp.room ?? '', link: mp.inviteLink() });
        void navigator.clipboard?.writeText(text).then(() => { copy.textContent = t('mp.copied'); }, () => { link.select(); copy.textContent = t('mp.copyHand'); });
        if (!navigator.clipboard) { link.select(); copy.textContent = t('mp.copyHand'); }
      });
      const who = el('div', 'who', b);
      const me = el('div', 'p', who);
      const mn = el('span', 'n', me); mn.textContent = mp.me?.name ?? '';
      el('span', 'you', mn).textContent = t('mp.you');
      const others = mp.peers;
      if (!others.length) el('div', 'empty', who).textContent = t('mp.alone');
      for (const p of others) {
        const r = el('div', 'p', who);
        el('span', 'n', r).textContent = p.name;
        el('span', 's', r).textContent = p.dist < 0 ? t('mp.waiting') : `${t(p.foot ? 'mp.onFoot' : 'mp.driving')} · ${p.dist < 1000 ? `${Math.round(p.dist)} m` : `${(p.dist / 1000).toFixed(1)} km`}`;
        const go = el('button', '', r); go.textContent = t('mp.goTo');
        go.disabled = p.dist < 0;
        go.addEventListener('click', () => {
          const ui = this.engine.get<{ name: string; state: string }>('ui');
          if (ui?.state !== 'playing' && ui?.state !== 'paused') { this.status = t('mp.goFromCity'); this.render(); return; }
          this.hide(); this.resume();
          const err = mp.goTo(p.id);
          if (err) { this.show(); this.status = err; this.render(); }
        });
      }
      const leave = el('button', 'ghost', b); leave.textContent = t('mp.leave');
      leave.addEventListener('click', () => { mp.leave(); this.status = ''; this.render(); });
    } else {
      el('div', 'intro', b).textContent = t('mp.intro', { n: mp.max });
      const make = el('button', 'main', b); make.textContent = t('mp.create');
      make.disabled = mp.status === 'connecting';
      make.addEventListener('click', () => { this.status = ''; mp.create(); this.render(); });
      el('div', 'or', b).textContent = t('mp.orJoin');
      const row = el('div', 'row', b);
      const inp = el('input', '', row) as HTMLInputElement;
      inp.inputMode = 'numeric'; inp.maxLength = 4; inp.placeholder = '1234'; inp.autocomplete = 'off';
      const go = el('button', 'ghost', row); go.textContent = t('mp.join');
      go.disabled = mp.status === 'connecting';
      const join = () => {
        const code = inp.value.replace(/\D/g, '');
        if (code.length !== 4) { this.status = t('mp.badCode'); this.render(); return; }
        this.status = ''; mp.join(code); this.render();
      };
      go.addEventListener('click', join);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    }
    const st = el('div', 'status', b);
    const err = mp.status === 'error' && mp.error ? t(`mp.err.${mp.error}` as 'mp.err.net') : '';
    if (mp.status === 'connecting') { st.className = 'status ok'; st.textContent = t('mp.connecting'); }
    else st.textContent = this.status || err;
  }
}
