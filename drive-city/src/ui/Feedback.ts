import type { Engine } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import type { FeedbackApi, FeedbackKind } from '../online/Feedback';
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
}
`);

const KINDS: FeedbackKind[] = ['bug', 'idea', 'praise', 'other'];

/**
 * The feedback panel (Menu's 意见反馈 button, title and pause): a kind, what they want to say, a contact if they
 * want a reply, and the game view they were looking at when they opened it (ticked by default, shown as a thumbnail).
 * Sends through `FeedbackApi` (online/Feedback.ts). Typing never reaches the game (keys stop here).
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
    el('div', 'intro', box).appendChild(L('fb.intro'));
    this.kinds = el('div', 'kinds', box);
    for (const k of KINDS) {
      const b = el('button', k === this.kind ? 'on' : '', this.kinds);
      b.appendChild(L(`fb.kind.${k}` as TKey));
      b.addEventListener('click', () => { this.kind = k; [...this.kinds.children].forEach((c, i) => c.classList.toggle('on', KINDS[i] === k)); });
    }
    this.text = el('textarea', '', box);
    this.text.maxLength = 2000;
    this.text.addEventListener('input', () => { this.count.textContent = `${this.text.value.length} / 2000`; });
    this.count = el('div', 'count', box); this.count.textContent = '0 / 2000';
    this.contact = el('input', '', box);
    this.contact.type = 'text'; this.contact.maxLength = 80;
    const shotRow = el('div', 'shot', box);
    const lab = el('label', '', shotRow);
    this.withShot = el('input', '', lab); this.withShot.type = 'checkbox'; this.withShot.checked = true;
    lab.appendChild(L('fb.shot'));
    this.thumb = el('img', '', shotRow); this.thumb.alt = '';
    this.withShot.addEventListener('change', () => { this.thumb.hidden = !this.withShot.checked || !this.shot; });
    el('div', 'note', box).appendChild(L('fb.note'));
    const send = el('div', 'send', box);
    this.sendBtn = el('button', '', send); this.sendBtn.appendChild(L('fb.send'));
    this.status = el('div', 'status', send);
    this.sendBtn.addEventListener('click', () => void this.submit());
  }

  private api() { return this.engine.get<FeedbackApi>('feedback'); }

  /** Open it, taking the frame on screen now as the attachment. */
  show(): void {
    this.root.hidden = false;
    this.text.placeholder = t('fb.placeholder');
    this.contact.placeholder = t('fb.contact');
    this.status.className = 'status'; this.status.textContent = '';
    this.sendBtn.disabled = false;
    this.shot = ''; this.thumb.hidden = true;
    void this.api()?.capture().then((s) => { this.shot = s; this.thumb.src = s; this.thumb.hidden = !s || !this.withShot.checked; });
    setTimeout(() => this.text.focus(), 30);
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
