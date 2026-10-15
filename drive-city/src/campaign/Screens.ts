import { t } from '../core/I18n';
import { C, F, css, el } from '../ui/theme';

css(`
.cmp-bars{position:fixed;inset:0;z-index:25;pointer-events:none}
.cmp-bars>i{position:absolute;left:0;right:0;height:0;background:#000;transition:height .45s ease}
.cmp-bars>i:first-child{top:0}.cmp-bars>i:last-child{bottom:0}
.cmp-bars.on>i{height:11vh}
.cmp-bars .skip{position:absolute;right:18px;bottom:calc(11vh + 10px);font:600 12px/1 ${F.ui};color:rgba(244,241,232,.55);letter-spacing:.08em;opacity:0;transition:opacity .4s}
.cmp-bars.on .skip{opacity:1}
.cmp-card{position:fixed;inset:0;z-index:26;display:grid;place-items:center;pointer-events:none;font-family:${F.ui};color:${C.paper};text-align:center}
.cmp-card[hidden]{display:none}
.cmp-card .in{opacity:0;transform:translateY(8px);transition:opacity .5s,transform .5s}
.cmp-card.show .in{opacity:1;transform:none}
.cmp-card .kick{font:800 13px/1 ${F.num};letter-spacing:.32em;color:${C.yellow};margin-bottom:12px}
.cmp-card h1{margin:0;font:900 clamp(34px,6vw,64px)/1.1 ${F.ui};letter-spacing:.06em;text-shadow:0 4px 30px rgba(0,0,0,.7)}
.cmp-card .who{margin-top:10px;font:600 15px/1.4 ${F.ui};color:${C.muted};text-shadow:0 2px 10px rgba(0,0,0,.8)}
.cmp-card.pass{background:radial-gradient(ellipse at center,rgba(8,10,12,.82),rgba(8,10,12,.55));pointer-events:auto}
.cmp-card.pass h1{color:${C.yellow}}
.cmp-card.fail h1{color:#ff5a4a}
.cmp-card table{margin:18px auto 6px;border-collapse:collapse;font:600 15px/1.2 ${F.ui}}
.cmp-card td{padding:7px 14px;text-align:left}
.cmp-card td.v{text-align:right;font:800 16px/1.2 ${F.num};font-variant-numeric:tabular-nums}
.cmp-card td.m{font-size:18px}
.cmp-card .medal{margin-top:10px;font:900 20px/1 ${F.ui};letter-spacing:.12em}
.cmp-card .medal.gold{color:#f6c445}.cmp-card .medal.silver{color:#d6dbe0}.cmp-card .medal.bronze{color:#d08a52}
.cmp-card .pay{margin-top:8px;font:800 22px/1 ${F.num};color:#62d39a}
.cmp-card .go{margin-top:20px;pointer-events:auto;padding:12px 26px;border:0;border-radius:8px;background:${C.yellow};color:${C.ink};font:800 15px/1 ${F.ui};letter-spacing:.14em;cursor:pointer}
.cmp-nudge{position:fixed;left:50%;top:76px;z-index:24;transform:translate(-50%,-8px);opacity:0;transition:opacity .4s,transform .4s;pointer-events:none;
  display:flex;align-items:center;gap:12px;padding:10px 18px 10px 10px;border-radius:12px;background:rgba(14,17,20,.86);border:1px solid ${C.yellowDim};
  box-shadow:0 10px 30px rgba(0,0,0,.45);font-family:${F.ui};color:${C.paper};max-width:min(560px,86vw)}
.cmp-nudge.on{opacity:1;transform:translate(-50%,0)}
.cmp-nudge[hidden],body.cmp-cine .cmp-nudge{display:none}
.cmp-nudge .g{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:${C.yellow};color:${C.ink};font:900 18px/1 ${F.ui};
  box-shadow:0 0 0 2px rgba(255,255,255,.8)}
.cmp-nudge .h{font:800 15px/1.25 ${F.ui};color:${C.yellow}}
.cmp-nudge .s{font:600 13px/1.35 ${F.ui};color:${C.paper};margin-top:2px}
body.dc-touch .cmp-nudge{top:calc(46px + env(safe-area-inset-top,0px));padding:7px 12px 7px 7px;gap:9px}
body.dc-touch .cmp-nudge .g{width:28px;height:28px;font-size:15px}
body.dc-touch .cmp-nudge .h{font-size:13px}
body.dc-touch .cmp-nudge .s{font-size:12px}
.cmp-meter{position:fixed;left:50%;top:70px;z-index:23;transform:translateX(-50%);width:min(240px,50vw);pointer-events:none;font-family:${F.ui};color:${C.paper};text-align:center}
.cmp-meter[hidden],body.cmp-cine .cmp-meter{display:none}
.cmp-meter .l{font:800 12px/1 ${F.ui};letter-spacing:.2em;margin-bottom:5px;text-shadow:0 1px 6px rgba(0,0,0,.9)}
.cmp-meter .b{height:8px;border-radius:4px;background:rgba(8,10,12,.62);box-shadow:inset 0 0 0 1px rgba(244,241,232,.22);overflow:hidden}
.cmp-meter .b>i{display:block;height:100%;width:0;border-radius:4px;background:${C.yellow};transition:width .15s linear,background .3s}
.cmp-meter.hot .b>i{background:#ff5a4a}
.cmp-meter.hot .l{color:#ff7a6a;animation:cmpm .4s ease-in-out infinite alternate}
.cmp-meter .n{margin-top:4px;font:600 12px/1.2 ${F.ui};color:${C.muted};text-shadow:0 1px 6px rgba(0,0,0,.9)}
@keyframes cmpm{from{opacity:.65}to{opacity:1}}
body.dc-touch .cmp-meter{top:calc(84px + env(safe-area-inset-top,0px))}
@media (max-height:520px){.cmp-card table{margin-top:8px}.cmp-card td{padding:4px 10px}.cmp-card .go{margin-top:10px}}
`);

/** Cutscene letterbox: two black bars and the skip hint. */
export class Letterbox {
  private root = el('div', 'cmp-bars', document.body);
  private hint: HTMLElement;
  constructor() { el('i', '', this.root); this.hint = el('div', 'skip', this.root); el('i', '', this.root); }
  show(on: boolean): void { this.hint.textContent = t('cmp.skip'); this.root.classList.toggle('on', on); }
}

export type Medal = 'gold' | 'silver' | 'bronze';

/** The big centred cards: a chapter's title as it begins, the result as it ends, a failure. */
export class Card {
  private root = el('div', 'cmp-card', document.body);
  private timer = 0;
  constructor() { this.root.hidden = true; }

  private open(cls: string, build: (inner: HTMLElement) => void, secs: number): void {
    clearTimeout(this.timer);
    this.root.className = `cmp-card ${cls}`;
    this.root.textContent = '';
    const inner = el('div', 'in', this.root);
    build(inner);
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('show'));
    if (secs > 0) this.timer = window.setTimeout(() => this.hide(), secs * 1000);
  }
  hide(): void { this.root.classList.remove('show'); clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.root.hidden = true; }, 450); }

  title(kick: string, title: string, who: string, secs = 3.2): void {
    this.open('', (b) => { el('div', 'kick', b).textContent = kick; el('h1', '', b).textContent = title; el('div', 'who', b).textContent = who; }, secs);
  }
  failed(reason: string, secs = 0): void {
    this.open('fail', (b) => { el('h1', '', b).textContent = t('cmp.failed'); el('div', 'who', b).textContent = reason; }, secs);
  }
  /** The result; `onClose` when the player closes it (button, Enter, Space) or after 12 s. `note` in place of the pay. */
  passed(title: string, rows: [string, string][], medal: Medal, pay: number, onClose: () => void, note?: string): void {
    this.open('pass', (b) => {
      el('div', 'kick', b).textContent = title;
      el('h1', '', b).textContent = t('cmp.passed');
      const tb = el('table', '', b);
      for (const [k, v] of rows) { const tr = el('tr', '', tb); el('td', '', tr).textContent = k; el('td', 'v', tr).textContent = v; }
      el('div', `medal ${medal}`, b).textContent = t(`cmp.medal.${medal}` as 'cmp.medal.gold');
      if (note) el('div', 'who', b).textContent = note;
      else el('div', 'pay', b).textContent = `+¥${pay.toLocaleString()}`;
      const go = el('button', 'go', b); go.textContent = t('cmp.continue');
      let done = false;
      const close = () => { if (done) return; done = true; removeEventListener('keydown', key, true); this.hide(); onClose(); };
      const key = (e: KeyboardEvent) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); close(); } };
      go.addEventListener('click', close);
      addEventListener('keydown', key, true);
      this.timer = window.setTimeout(close, 12000);
    }, 0);
  }
}

/** A short note at the top of the screen pointing the player at the main story's next chapter (2026-10-14). */
export class Nudge {
  private root = el('div', 'cmp-nudge', document.body);
  private glyph = el('div', 'g', this.root);
  private head: HTMLElement;
  private sub: HTMLElement;
  private timer = 0;
  constructor() { const b = el('div', '', this.root); this.head = el('div', 'h', b); this.sub = el('div', 's', b); this.root.hidden = true; }
  show(glyph: string, head: string, sub: string, secs = 7): void {
    clearTimeout(this.timer);
    this.glyph.textContent = glyph; this.head.textContent = head; this.sub.textContent = sub;
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.timer = window.setTimeout(() => this.hide(), secs * 1000);
  }
  hide(): void { this.root.classList.remove('on'); clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.root.hidden = true; }, 450); }
  get shown(): boolean { return !this.root.hidden; }
}

/** A bar under the objective (a tail's suspicion): `hot` turns it red and pulses the label; `note` is a line under it. */
export class Meter {
  private root = el('div', 'cmp-meter', document.body);
  private label = el('div', 'l', this.root);
  private fill: HTMLElement;
  private note: HTMLElement;
  constructor() { this.fill = el('i', '', el('div', 'b', this.root)); this.note = el('div', 'n', this.root); this.root.hidden = true; }
  show(label: string): void { this.label.textContent = label; this.root.hidden = false; }
  set(v: number, hot: boolean, note = ''): void {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
    this.root.classList.toggle('hot', hot);
    if (this.note.textContent !== note) this.note.textContent = note;
  }
  hide(): void { this.root.hidden = true; }
}
