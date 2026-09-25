import { C, F, css, el } from '../ui/theme';

css(`
.hud .phone{position:absolute;top:calc(var(--hud-y) + 124px);right:var(--hud-x);width:min(310px,40vw);display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}
.hud .phone .task{pointer-events:auto;cursor:pointer;max-width:100%;padding:7px 11px;border-radius:8px;background:${C.inkGlass};border-left:3px solid var(--c,${C.yellow});
  font:700 13px/1.35 ${F.ui};color:${C.paper};text-align:left;box-sizing:border-box}
.hud .phone .task small{display:block;font:700 11px/1.2 ${F.ui};color:var(--c,${C.yellow});letter-spacing:.06em;margin-bottom:2px}
.hud .phone .task[hidden],.hud .phone .sms[hidden],.hud .phone .thread[hidden]{display:none}
.hud .phone .sms{width:100%;display:grid;grid-template-columns:34px 1fr;gap:9px;padding:10px 12px;border-radius:12px;box-sizing:border-box;
  background:rgba(22,26,30,.92);box-shadow:0 8px 26px rgba(0,0,0,.4);border:1px solid ${C.line};animation:dc-sms .28s ease-out}
@keyframes dc-sms{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
.hud .phone .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:800 15px/1 ${F.ui};color:#101315}
.hud .phone .who{font:800 12px/1.2 ${F.ui};letter-spacing:.06em;margin-bottom:3px}
.hud .phone .who span{float:right;font-weight:600;color:${C.muted}}
.hud .phone .txt{font:500 14px/1.45 ${F.ui};color:${C.paper}}
.hud .phone .thread{pointer-events:auto;width:100%;max-height:52vh;overflow:auto;padding:10px 12px;border-radius:14px;box-sizing:border-box;background:rgba(16,19,22,.94);border:1px solid ${C.line};display:grid;gap:9px}
.hud .phone .thread .head{font:800 11px/1 ${F.num};letter-spacing:.22em;color:${C.yellow};display:flex;justify-content:space-between}
.hud .phone .thread .m{display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:start}
.hud .phone .thread .av{width:26px;height:26px;font-size:12px}
.hud .phone .thread .txt{font-size:13px;background:rgba(244,241,232,.07);padding:6px 9px;border-radius:4px 10px 10px 10px}
/* A phone: the right side is the pads', so the column goes top centre under the objective, compact,
   over the road ahead (a card is ~60 px, the thread stops above the pads' top row). */
body.dc-touch .hud .phone{top:calc(50px + env(safe-area-inset-top,0px));right:auto;left:50%;transform:translateX(-50%);width:min(340px,48vw);align-items:center;gap:5px}
body.dc-touch .hud .phone .task{padding:4px 9px;font-size:12px}
body.dc-touch .hud .phone .task small{display:inline;margin:0 6px 0 0}
body.dc-touch .hud .phone .sms{padding:7px 10px;grid-template-columns:26px 1fr;gap:7px}
body.dc-touch .hud .phone .sms .av{width:26px;height:26px;font-size:12px}
body.dc-touch .hud .phone .txt{font-size:12.5px;line-height:1.35}
body.dc-touch .hud .phone .thread{max-height:calc(100vh - 150px);padding:8px 10px;gap:6px}
`);

export interface Sender { id: string; name: string; initial: string; color: string }
export interface Message { from: Sender; text: string; at: number }

/**
 * The phone in the HUD's right column, under the cash and health: a line for the current task (who
 * asked, what for), the texts sliding in as cards, one at a time, each on screen long enough to
 * read, and the thread (T, or a tap on the task line) with the last dozen.
 */
export class Phone {
  private root: HTMLDivElement | null = null;
  private task!: HTMLDivElement;
  private card!: HTMLDivElement;
  private thread!: HTMLDivElement;
  private queue: Message[] = [];
  private showT = 0;
  private taskKey = '';
  readonly log: Message[] = [];
  /** Minutes on the in-game clock, for the timestamps. */
  clock = (): string => '';
  /** Opening the thread (for the probes and the pause of hints). */
  onOpen: (() => void) | null = null;

  private mount(): boolean {
    if (this.root) return true;
    const hud = document.querySelector<HTMLElement>('.hud');
    if (!hud) return false;
    const root = this.root = el('div', 'phone', hud);
    this.task = el('div', 'task', root); this.task.hidden = true;
    this.task.addEventListener('click', () => this.toggle());
    this.card = el('div', 'sms', root); this.card.hidden = true;
    this.thread = el('div', 'thread', root); this.thread.hidden = true;
    return true;
  }

  push(from: Sender, text: string): void {
    const m = { from, text, at: Date.now() };
    this.log.push(m);
    if (this.log.length > 30) this.log.shift();
    this.queue.push(m);
    if (this.thread && !this.thread.hidden) this.renderThread();
  }

  /** How long a card stays: long enough to read at a glance while driving. */
  private static dwell(text: string): number { return Math.min(9, 3.2 + [...text].length * 0.09); }

  /** The task line: `null` hides it. */
  setTask(from: Sender | null, text: string | null): void {
    if (!this.mount()) return;
    const key = from && text ? from.id + text : '';
    if (key === this.taskKey) return;
    this.taskKey = key;
    this.task.hidden = !key;
    if (!from || !text) return;
    this.task.style.setProperty('--c', from.color);
    this.task.textContent = '';
    el('small', '', this.task).textContent = `📱 ${from.name}`;
    this.task.append(text);
  }

  get open(): boolean { return !!this.thread && !this.thread.hidden; }
  toggle(): void {
    if (!this.mount()) return;
    this.thread.hidden = !this.thread.hidden;
    if (!this.thread.hidden) { this.renderThread(); this.card.hidden = true; this.showT = 0; this.onOpen?.(); }
  }

  private renderThread(): void {
    this.thread.textContent = '';
    const head = el('div', 'head', this.thread);
    el('span', '', head).textContent = 'SMS';
    if (!document.body.classList.contains('dc-touch')) el('span', '', head).textContent = 'T';
    for (const m of this.log.slice(-12)) {
      const row = el('div', 'm', this.thread);
      const av = el('div', 'av', row); av.textContent = m.from.initial; av.style.background = m.from.color;
      const body = el('div', '', row);
      const who = el('div', 'who', body); who.textContent = m.from.name; who.style.color = m.from.color;
      el('div', 'txt', body).textContent = m.text;
    }
    this.thread.scrollTop = this.thread.scrollHeight;
  }

  update(dt: number, visible: boolean): void {
    if (!this.mount()) return;
    this.root!.style.visibility = visible ? '' : 'hidden';
    // A card with more waiting behind it moves on sooner: in the heist the texts come two seconds apart
    // and must not lag the action (the alarm's text arrived after the getaway).
    if (this.showT > 0) { this.showT -= dt * (1 + 2 * this.queue.length); if (this.showT <= 0) this.card.hidden = true; return; }
    const m = this.queue.shift();
    if (!m) return;
    if (this.open) return;
    this.card.hidden = false;
    this.card.textContent = '';
    const av = el('div', 'av', this.card); av.textContent = m.from.initial; av.style.background = m.from.color;
    const body = el('div', '', this.card);
    const who = el('div', 'who', body); who.textContent = m.from.name; who.style.color = m.from.color;
    el('span', '', who).textContent = this.clock();
    el('div', 'txt', body).textContent = m.text;
    // Restart the slide-in for back-to-back texts.
    this.card.style.animation = 'none'; void this.card.offsetWidth; this.card.style.animation = '';
    this.showT = Phone.dwell(m.text);
  }
}
