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
  /** The result; `onClose` when the player closes it (button, Enter, Space) or after 12 s. */
  passed(title: string, rows: [string, string][], medal: Medal, pay: number, onClose: () => void): void {
    this.open('pass', (b) => {
      el('div', 'kick', b).textContent = title;
      el('h1', '', b).textContent = t('cmp.passed');
      const tb = el('table', '', b);
      for (const [k, v] of rows) { const tr = el('tr', '', tb); el('td', '', tr).textContent = k; el('td', 'v', tr).textContent = v; }
      el('div', `medal ${medal}`, b).textContent = t(`cmp.medal.${medal}` as 'cmp.medal.gold');
      el('div', 'pay', b).textContent = `+¥${pay.toLocaleString()}`;
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
