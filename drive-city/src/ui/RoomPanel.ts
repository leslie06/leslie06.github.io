import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { MultiplayerApi } from '../online/Multiplayer';
import type { PlayApi } from '../online/RoomPlay';
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
.mpk .games{margin:6px 0 14px}
.mpk .g{padding:10px 0;border-bottom:1px solid ${C.line}}
.mpk .g b{font:800 15px/1.3 ${F.ui}}
.mpk .g p{margin:3px 0 8px;font:500 12px/1.5 ${F.ui};color:${C.muted}}
.mpk select{flex:1;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid ${C.line};background:#20262a;color:${C.paper};font:600 14px/1.2 ${F.ui}}
.mpk .go{padding:10px 16px;background:#35e0c2;color:${C.ink};font:800 14px/1 ${F.ui}}
.mpk .on{display:flex;align-items:center;gap:10px;padding:10px 12px;margin:8px 0;border-radius:8px;background:rgba(53,224,194,.12);font:700 14px/1.3 ${F.ui}}
.mpk .on span{flex:1}
.mpk .res{margin-top:10px;font:600 13px/1.6 ${F.ui}}
.mpk .res .h{color:#35e0c2;font-weight:800}
.mpk .res div{display:flex;gap:8px}.mpk .res div span:first-child{flex:1;color:${C.muted}}
.mpk .hint{margin-top:10px;font:500 12px/1.5 ${F.ui};color:${C.muted}}
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
  /** The choices in 一起玩, kept across the panel's redraws. */
  private coursePick = 0;
  private runnerPick = -1;

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
  private play() { return this.engine.get<PlayApi & { listen(fn: () => void): void }>('play'); }
  /** Off into the city to do it: the panel closes, a pause ends; an error comes back here. */
  private launch(fn: () => string | null): void {
    const ui = this.engine.get<{ name: string; state: string }>('ui');
    if (ui?.state !== 'playing' && ui?.state !== 'paused') { this.status = t('mp.goFromCity'); this.render(); return; }
    this.hide(); this.resume();
    const err = fn();
    if (err) { this.show(); this.status = err; this.render(); }
  }

  /** 一起玩 (online/RoomPlay.ts): a race on a course, a chase with a runner; what is on; the last game; the scores. */
  private renderGames(b: HTMLElement): void {
    const play = this.play(), mp = this.mp;
    if (!play) return;
    const box = el('div', 'games', b);
    el('div', 'label', box).textContent = t('play.games');
    const on = play.running;
    if (on) {
      const r = el('div', 'on', box);
      el('span', '', r).textContent = on.title;
      if (on.mine) { const x = el('button', 'ghost', r); x.textContent = t('play.stopBtn'); x.addEventListener('click', () => play.stop()); }
    } else {
      const race = el('div', 'g', box);
      el('b', '', race).textContent = t('play.raceTitle');
      el('p', '', race).textContent = t('play.raceHelp');
      const rr = el('div', 'row', race);
      const cs = el('select', '', rr) as HTMLSelectElement;
      play.courses.forEach((c, i) => { const o = el('option', '', cs) as HTMLOptionElement; o.value = String(i); o.textContent = `${c.name} · ${(c.len / 1000).toFixed(1)} km`; });
      cs.value = String(this.coursePick);
      cs.addEventListener('change', () => { this.coursePick = Number(cs.value); });
      const rg = el('button', 'go', rr); rg.textContent = t('play.start');
      rg.addEventListener('click', () => this.launch(() => play.startRace(this.coursePick)));
      const chase = el('div', 'g', box);
      el('b', '', chase).textContent = t('play.chaseTitle');
      el('p', '', chase).textContent = t('play.chaseHelp');
      const cr = el('div', 'row', chase);
      const who = el('select', '', cr) as HTMLSelectElement;
      const people = [{ id: mp.me?.id ?? -1, name: `${mp.me?.name ?? ''}（${t('play.runnerMe')}）` }, ...mp.peers.filter((p) => p.dist >= 0).map((p) => ({ id: p.id, name: p.name }))];
      for (const p of people) { const o = el('option', '', who) as HTMLOptionElement; o.value = String(p.id); o.textContent = p.name; }
      if (!people.some((p) => p.id === this.runnerPick)) this.runnerPick = people[people.length > 1 ? 1 : 0].id;
      who.value = String(this.runnerPick);
      who.addEventListener('change', () => { this.runnerPick = Number(who.value); });
      const cg = el('button', 'go', cr); cg.textContent = t('play.start');
      cg.disabled = people.length < 2;
      cg.addEventListener('click', () => {
        const runner = this.runnerPick;
        // the next round's runner: the next one along
        const i = people.findIndex((p) => p.id === runner);
        this.runnerPick = people[(i + 1) % people.length].id;
        this.launch(() => play.startChase(runner));
      });
    }
    const last = play.last;
    if (last && last.rows.length) {
      const r = el('div', 'res', box);
      el('span', 'h', r).textContent = `${t('play.last')}：${last.title}`;
      for (const row of last.rows) { const d = el('div', '', r); el('span', '', d).textContent = row.name; el('span', '', d).textContent = row.text; }
    }
    const sc = play.scores.filter((x) => x.raceWins || x.escapes || x.catches);
    if (sc.length) {
      const r = el('div', 'res', box);
      el('span', 'h', r).textContent = t('play.scores');
      for (const x of sc) { const d = el('div', '', r); el('span', '', d).textContent = x.name; el('span', '', d).textContent = t('play.scoreRow', { w: x.raceWins, e: x.escapes, c: x.catches }); }
    }
    el('div', 'hint', box).textContent = t('play.keyHint');
  }
  private heard = false;
  show(): void {
    // the room's games are installed after the UI: heard from once there
    const play = this.play();
    if (play && !this.heard) { this.heard = true; play.listen(() => { if (this.open) this.render(); }); }
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
      this.renderGames(b);
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
