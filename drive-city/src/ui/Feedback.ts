import type { Engine } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import type { FeedbackApi, FeedbackKind, FeedbackThread } from '../online/Feedback';
import { C, F, css, el } from './theme';
import { L } from './lang';

css(`
.fbk{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(9,11,13,.6);font-family:${F.ui};color:${C.paper};padding:16px;box-sizing:border-box}
.fbk[hidden]{display:none}
.fbk .box{width:min(560px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;border-radius:12px;background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5)}
.fbk .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.fbk h2{margin:0;font:800 13px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.fbk button{font:inherit;cursor:pointer;border:0;border-radius:6px;color:inherit}
.fbk .x{background:transparent;color:${C.muted};font-size:22px;line-height:1;padding:2px 8px}
.fbk .intro{font:500 13px/1.6 ${F.ui};color:${C.muted};margin-bottom:12px}
.fbk .kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.fbk .kinds button{padding:8px 12px;background:rgba(244,241,232,.07);color:${C.muted};font:700 13px/1.1 ${F.ui}}
.fbk .kinds button.on{background:${C.yellow};color:${C.ink}}
.fbk textarea,.fbk input[type=text]{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid ${C.line};background:rgba(244,241,232,.06);color:${C.paper};font:500 15px/1.5 ${F.ui};resize:vertical}
.fbk textarea{min-height:120px;margin-bottom:4px}
.fbk .count{text-align:right;font:600 11px/1.4 ${F.num};color:${C.muted};margin-bottom:8px}
.fbk input[type=text]{font-size:14px;margin-bottom:10px}
.fbk .shot{display:flex;gap:12px;align-items:center;margin-bottom:8px;font:600 13px/1.4 ${F.ui};color:${C.paper}}
.fbk .shot label{display:flex;gap:8px;align-items:center;cursor:pointer;flex:1}
.fbk .shot input{width:18px;height:18px;accent-color:${C.yellow}}
.fbk .shot img{width:120px;height:68px;object-fit:cover;border-radius:6px;border:1px solid ${C.line};background:#0c0e10}
.fbk .shot img[hidden]{display:none}
.fbk .note{font:500 11px/1.6 ${F.ui};color:${C.muted};margin-bottom:12px}
.fbk .send{display:flex;gap:12px;align-items:center}
.fbk .send button{padding:12px 22px;background:${C.yellow};color:${C.ink};font:800 14px/1 ${F.ui};letter-spacing:.12em}
.fbk .send button:disabled{opacity:.5;cursor:default}
.fbk .status{font:600 13px/1.5 ${F.ui};color:${C.muted};flex:1}
.fbk .status.good{color:#62d39a}
.fbk .tabs{display:flex;gap:6px;margin-bottom:12px}
.fbk .tabs[hidden]{display:none}
.fbk .tabs button{padding:8px 14px;background:rgba(244,241,232,.07);color:${C.muted};font:800 13px/1.1 ${F.ui};letter-spacing:.06em}
.fbk .tabs button.on{background:rgba(244,241,232,.18);color:${C.paper}}
.fbk .tabs .badge{display:inline-block;min-width:16px;padding:0 4px;margin-left:6px;border-radius:8px;background:#e8433a;color:#fff;font:800 10px/16px ${F.num};text-align:center}
.fbk .tabs .badge[hidden]{display:none}
.fbk .pane[hidden]{display:none}
.fbk .th{padding:10px 0 12px;border-top:1px solid ${C.line}}
.fbk .th:first-child{border-top:0;padding-top:0}
.fbk .th .head{font:600 11px/1.6 ${F.num};color:${C.muted};margin-bottom:4px}
.fbk .th .orig{font:500 13px/1.5 ${F.ui};color:${C.muted};white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px}
.fbk .msgs{display:flex;flex-direction:column;gap:6px}
.fbk .msg{max-width:88%;padding:7px 11px;border-radius:10px;background:rgba(244,241,232,.08);align-self:flex-end;font:500 14px/1.5 ${F.ui};white-space:pre-wrap;word-break:break-word}
.fbk .msg.dev{align-self:flex-start;background:rgba(243,181,15,.14);border:1px solid rgba(243,181,15,.4)}
.fbk .msg.dev.unread{box-shadow:0 0 0 2px rgba(243,181,15,.55)}
.fbk .msg .who{display:block;font:700 11px/1.5 ${F.ui};color:${C.muted}}
.fbk .msg.dev .who{color:${C.yellow}}
.fbk .none{font:500 12px/1.5 ${F.ui};color:${C.muted}}
.fbk .rep{display:flex;gap:8px;margin-top:8px}
.fbk .rep input[type=text]{margin:0;flex:1}
.fbk .rep button{padding:0 16px;background:${C.yellow};color:${C.ink};font:800 13px/1 ${F.ui};letter-spacing:.08em}
.fbk .rep button:disabled{opacity:.5;cursor:default}
.fbk .rep-err{font:600 12px/1.5 ${F.ui};color:#ff8a7a;margin-top:4px}
/* a phone on its side: ~340 px tall */
@media (max-height:520px){
  .fbk{padding:8px}
  .fbk .box{padding:10px 14px}
  .fbk .intro,.fbk .note{display:none}
  .fbk .kinds{margin-bottom:6px}.fbk .kinds button{padding:6px 10px}
  .fbk textarea{min-height:56px;height:64px;font-size:14px}
  .fbk .count{margin-bottom:4px}
  .fbk input[type=text]{margin-bottom:6px;padding:7px 10px}
  .fbk .shot{margin-bottom:6px}.fbk .shot img{width:80px;height:45px}
  .fbk .send button{padding:9px 18px}
  .fbk .tabs{margin-bottom:8px}.fbk .tabs button{padding:6px 10px}
}
`);

const KINDS: FeedbackKind[] = ['bug', 'idea', 'praise', 'other'];

/**
 * The feedback panel (Menu's 意见反馈 button, title and pause): a kind, what they want to say, a contact if they
 * want a reply, and the game view they were looking at when they opened it (ticked by default, shown as a thumbnail).
 * Sends through `FeedbackApi` (online/Feedback.ts). Typing never reaches the game (keys stop here).
 * Once the player has sent any, a second tab 我的反馈 lists them with the developer's replies (a red count when some
 * are unread; the panel opens on it then) and a box to answer under each one that has a reply.
 */
export class FeedbackPanel {
  readonly root: HTMLDivElement;
  private kind: FeedbackKind = 'bug';
  private kinds: HTMLDivElement;
  private text: HTMLTextAreaElement;
  private contact: HTMLInputElement;
  private withShot: HTMLInputElement;
  private thumb: HTMLImageElement;
  private status: HTMLDivElement;
  private count: HTMLDivElement;
  private sendBtn: HTMLButtonElement;
  private shot = '';
  private tabs: HTMLDivElement;
  private tabBadge: HTMLSpanElement;
  private compose: HTMLDivElement;
  private mine: HTMLDivElement;
  private tab: 'new' | 'mine' = 'new';
  /** Replies being typed, by thread (the list is redrawn when new ones come). */
  private drafts = new Map<number, string>();

  constructor(private engine: Engine, container: HTMLElement) {
    const root = this.root = el('div', 'fbk', container);
    root.hidden = true;
    root.addEventListener('click', (e) => { if (e.target === root) this.hide(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); e.stopPropagation(); });
    root.addEventListener('keyup', (e) => e.stopPropagation());
    const box = el('div', 'box', root);
    const top = el('div', 'top', box);
    el('h2', '', top).appendChild(L('fb.title'));
    const x = el('button', 'x', top); x.textContent = '×'; x.addEventListener('click', () => this.hide());
    this.tabs = el('div', 'tabs', box);
    const tNew = el('button', 'on', this.tabs); tNew.appendChild(L('fb.tab.new'));
    tNew.addEventListener('click', () => this.setTab('new'));
    const tMine = el('button', '', this.tabs); tMine.appendChild(L('fb.tab.mine'));
    this.tabBadge = el('span', 'badge', tMine);
    tMine.addEventListener('click', () => this.setTab('mine'));
    this.mine = el('div', 'pane', box);
    const compose = this.compose = el('div', 'pane', box);
    el('div', 'intro', compose).appendChild(L('fb.intro'));
    this.kinds = el('div', 'kinds', compose);
    for (const k of KINDS) {
      const b = el('button', k === this.kind ? 'on' : '', this.kinds);
      b.appendChild(L(`fb.kind.${k}` as TKey));
      b.addEventListener('click', () => { this.kind = k; [...this.kinds.children].forEach((c, i) => c.classList.toggle('on', KINDS[i] === k)); });
    }
    this.text = el('textarea', '', compose);
    this.text.maxLength = 2000;
    this.text.addEventListener('input', () => { this.count.textContent = `${this.text.value.length} / 2000`; });
    this.count = el('div', 'count', compose); this.count.textContent = '0 / 2000';
    this.contact = el('input', '', compose);
    this.contact.type = 'text'; this.contact.maxLength = 80;
    const shotRow = el('div', 'shot', compose);
    const lab = el('label', '', shotRow);
    this.withShot = el('input', '', lab); this.withShot.type = 'checkbox'; this.withShot.checked = true;
    lab.appendChild(L('fb.shot'));
    this.thumb = el('img', '', shotRow); this.thumb.alt = '';
    this.withShot.addEventListener('change', () => { this.thumb.hidden = !this.withShot.checked || !this.shot; });
    el('div', 'note', compose).appendChild(L('fb.note'));
    const send = el('div', 'send', compose);
    this.sendBtn = el('button', '', send); this.sendBtn.appendChild(L('fb.send'));
    this.status = el('div', 'status', send);
    this.sendBtn.addEventListener('click', () => void this.submit());
    this.setTab('new');
    this.api()?.listen(() => this.refreshInbox());
    this.refreshInbox();
  }

  private setTab(tab: 'new' | 'mine'): void {
    this.tab = tab;
    [...this.tabs.children].forEach((b, i) => b.classList.toggle('on', (i === 1) === (tab === 'mine')));
    this.compose.hidden = tab !== 'new';
    this.mine.hidden = tab !== 'mine';
    if (tab === 'mine') { this.renderMine(); if (this.open) this.api()?.markSeen(); }
  }

  /** New replies or threads: the tab's count, and the list if it is showing. */
  private refreshInbox(): void {
    const api = this.api(), n = api?.unread ?? 0;
    this.tabs.hidden = !api?.threads.length;
    this.tabBadge.hidden = !n; this.tabBadge.textContent = String(n);
    if (this.tabs.hidden && this.tab === 'mine') this.setTab('new');
    if (this.tab === 'mine' && this.open) { this.renderMine(); if (n) api?.markSeen(); }
  }

  private renderMine(): void {
    const api = this.api();
    if (!api) return;
    const focused = document.activeElement instanceof HTMLInputElement && this.mine.contains(document.activeElement) ? +(document.activeElement.dataset.id ?? 0) : 0;
    for (const inp of this.mine.querySelectorAll<HTMLInputElement>('input[data-id]')) this.drafts.set(+inp.dataset.id!, inp.value);
    this.mine.textContent = '';
    // answered ones first (latest message first), then the rest, newest first
    const last = (th: FeedbackThread) => th.msgs.length ? th.msgs[th.msgs.length - 1].ts : 0;
    const list = [...api.threads].sort((a, b) => (last(b) - last(a)) || (b.ts - a.ts));
    const when = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    for (const th of list) {
      const box = el('div', 'th', this.mine);
      el('div', 'head', box).textContent = `${t(`fb.kind.${th.kind}` as TKey)} · ${when(th.ts)}`;
      el('div', 'orig', box).textContent = th.text;
      if (!th.msgs.length) { el('div', 'none', box).textContent = t('fb.noReply'); continue; }
      const msgs = el('div', 'msgs', box);
      for (const m of th.msgs) {
        const b = el('div', `msg ${m.who === 'dev' ? 'dev' : 'me'}${m.unread ? ' unread' : ''}`, msgs);
        el('span', 'who', b).textContent = `${t(m.who === 'dev' ? 'fb.dev' : 'fb.me')} · ${when(m.ts)}`;
        b.append(m.text);
      }
      const row = el('div', 'rep', box);
      const inp = el('input', '', row);
      inp.type = 'text'; inp.maxLength = 1000; inp.placeholder = t('fb.replyPh'); inp.dataset.id = String(th.id);
      inp.value = this.drafts.get(th.id) ?? '';
      const go = el('button', '', row); go.textContent = t('fb.reply');
      const send = async () => {
        const text = inp.value.trim();
        if (!text || go.disabled) return;
        go.disabled = true;
        box.querySelector('.rep-err')?.remove();
        const r = await api.reply(th.id, text);
        go.disabled = false;
        // the list may have been redrawn while it went (keeping the text as a draft): clear whichever box is up now
        if (r === 'ok') {
          for (const x of this.mine.querySelectorAll<HTMLInputElement>(`input[data-id="${th.id}"]`)) x.value = '';
          this.drafts.delete(th.id); this.renderMine(); return;
        }
        el('div', 'rep-err', box).textContent = t(r === 'busy' ? 'fb.replyBusy' : 'fb.replyFail');
      };
      go.addEventListener('click', () => void send());
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void send(); } });
      if (focused === th.id) inp.focus();
    }
  }

  private api() { return this.engine.get<FeedbackApi>('feedback'); }

  /** Open it, taking the frame on screen now as the attachment. */
  show(): void {
    this.root.hidden = false;
    // replies waiting: open on them
    const api = this.api();
    this.setTab(api?.unread ? 'mine' : 'new');
    this.refreshInbox();
    void api?.refresh();
    this.text.placeholder = t('fb.placeholder');
    this.contact.placeholder = t('fb.contact');
    this.status.className = 'status'; this.status.textContent = '';
    this.sendBtn.disabled = false;
    this.shot = ''; this.thumb.hidden = true;
    void this.api()?.capture().then((s) => { this.shot = s; this.thumb.src = s; this.thumb.hidden = !s || !this.withShot.checked; });
    if (this.tab === 'new') setTimeout(() => this.text.focus(), 30);
  }
  hide(): void { this.root.hidden = true; }
  get open(): boolean { return !this.root.hidden; }

  private async submit(): Promise<void> {
    const api = this.api(), text = this.text.value.trim();
    if (!text) { this.status.className = 'status'; this.status.textContent = t('fb.empty'); this.text.focus(); return; }
    if (!api?.enabled) { this.status.className = 'status'; this.status.textContent = t('fb.off'); return; }
    this.sendBtn.disabled = true;
    this.status.className = 'status'; this.status.textContent = t('fb.sending');
    const r = await api.send(this.kind, text, this.contact.value.trim(), this.withShot.checked ? this.shot : '');
    this.status.className = r === 'ok' ? 'status good' : 'status';
    this.status.textContent = t(r === 'ok' ? 'fb.ok' : r === 'queued' ? 'fb.queued' : r === 'busy' ? 'fb.busy' : 'fb.off');
    if (r === 'ok' || r === 'queued') { this.text.value = ''; this.count.textContent = '0 / 2000'; setTimeout(() => { if (!this.root.hidden) this.hide(); }, 1800); }
    else this.sendBtn.disabled = false;
  }
}
