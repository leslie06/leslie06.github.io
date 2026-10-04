import type { Engine } from '../core/Engine';
import { lang } from '../core/I18n';
import type { DialogueApi, Speaker } from '../game/Contracts';
import { portrait } from '../character/Portrait';
import { C, F, css, el } from '../ui/theme';

css(`
.hud .dlg{position:absolute;left:50%;bottom:calc(var(--hud-y) + 6px);transform:translateX(-50%);width:min(600px,60vw);display:grid;grid-template-columns:52px 1fr;gap:12px;
  padding:11px 14px;border-radius:12px;background:rgba(14,17,20,.86);border:1px solid ${C.line};box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;
  transition:opacity .18s,transform .18s}
.hud .dlg.off{opacity:0;transform:translate(-50%,10px)}
.hud .dlg .av{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font:800 20px/1 ${F.ui};color:#101315;background-size:cover}
.hud .dlg .who{font:800 12px/1.2 ${F.ui};letter-spacing:.08em;margin:2px 0 4px}
.hud .dlg .txt{font:600 16px/1.45 ${F.ui};color:${C.paper};min-height:23px}
.hud .dlg .opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.hud .dlg .opts[hidden]{display:none}
.hud .dlg .opts button{pointer-events:auto;cursor:pointer;border:1px solid ${C.yellowDim};border-radius:7px;background:rgba(243,181,15,.12);color:${C.paper};font:700 14px/1 ${F.ui};padding:8px 11px}
.hud .dlg .opts button kbd{display:inline-block;min-width:16px;margin-right:7px;padding:2px 4px;border-radius:4px;background:${C.yellow};color:${C.ink};font:800 11px/1 ${F.mono};text-align:center}
.hud .dlg .opts button.on{background:${C.yellow};color:${C.ink}}
.hud .dlg .bar{grid-column:1/-1;height:3px;border-radius:2px;background:rgba(244,241,232,.12);overflow:hidden;margin-top:2px}
.hud .dlg .bar[hidden]{display:none}
.hud .dlg .bar i{display:block;height:100%;background:${C.yellow};width:100%}
/* A phone on its side: the radar is top left, the pads bottom right and the stick bottom left, so the box
   goes top centre, narrow, between them, its answers stacked (big enough to tap). */
body.dc-touch .hud .dlg{top:calc(15vh + env(safe-area-inset-top,0px));bottom:auto;width:min(400px,38vw);padding:7px 10px;grid-template-columns:34px 1fr;gap:8px}
body.dc-touch .hud .dlg.off{transform:translate(-50%,-10px)}
body.dc-touch .hud .dlg .av{width:34px;height:34px;font-size:15px}
body.dc-touch .hud .dlg .who{font-size:11px;margin:0 0 2px}
body.dc-touch .hud .dlg .txt{font-size:13px;line-height:1.35}
body.dc-touch .hud .dlg .opts{flex-direction:column;gap:5px;margin-top:6px}
body.dc-touch .hud .dlg .opts button{padding:8px 10px;font-size:13px;text-align:left}
`);

interface Item {
  who: Speaker; text: string; prio: number; secs: number; born: number;
  ask?: { options: string[]; onPick: (i: number) => void; timeout: number; fallback: number };
}

/**
 * The dialogue box (DialogueApi): lines from people in the world, one at a time at the bottom of the
 * screen, typed out at reading pace with the speaker's avatar (character/Portrait.ts) and voice
 * (`npc:voice`), each held long enough to read; questions wait for an answer (1-3, the D-pad, a tap)
 * or time out to their fallback. Priorities: a higher line cuts in, low ones that waited too long
 * are dropped (a passenger's quip about a drift is stale ten seconds later). It never pauses.
 */
export async function install(engine: Engine): Promise<void> {
  let root: HTMLDivElement | null = null;
  let av!: HTMLDivElement, whoEl!: HTMLDivElement, txt!: HTMLDivElement, opts!: HTMLDivElement, bar!: HTMLDivElement, barFill!: HTMLElement;
  const queue: Item[] = [];
  let cur: Item | null = null, t = 0, clock = 0, shown = -1, picked = -1, optionsOn = false;

  const mount = (): boolean => {
    if (root) return true;
    const hud = document.querySelector<HTMLElement>('.hud');
    if (!hud) return false;
    root = el('div', 'dlg off', hud);
    av = el('div', 'av', root);
    const body = el('div', '', root);
    whoEl = el('div', 'who', body); txt = el('div', 'txt', body);
    opts = el('div', 'opts', body); opts.hidden = true;
    bar = el('div', 'bar', root); barFill = el('i', '', bar); bar.hidden = true;
    for (const ev of ['pointerdown', 'touchstart', 'mousedown'] as const) opts.addEventListener(ev, (e) => e.stopPropagation());
    return true;
  };

  /** Characters a second the line is typed at, and how long it stays once typed. */
  const cps = () => (lang() === 'zh' ? 16 : 40);
  const holdFor = (it: Item) => it.secs > 0 ? it.secs : Math.min(6, Math.max(1.6, it.text.length / (lang() === 'zh' ? 7 : 16)));

  const start = (it: Item) => {
    cur = it; t = 0; shown = -1; picked = -1; optionsOn = false;
    if (!mount()) return;
    const w = it.who;
    if (w.look) { av.style.backgroundImage = `url(${portrait(w.look, w.color)})`; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.style.background = w.color; av.textContent = w.name.slice(0, 1); }
    whoEl.textContent = w.name; whoEl.style.color = w.color;
    txt.textContent = '';
    opts.hidden = true; opts.textContent = ''; bar.hidden = true;
    root!.classList.remove('off');
    if (w.voice) engine.events.emit('npc:voice', { text: it.text, voice: w.voice, x: w.at ? w.at.x : NaN, z: w.at ? w.at.z : NaN, id: 'dlg' });
  };

  const finish = () => {
    cur = null; optionsOn = false; engine.input.choosing = false;
    root?.classList.add('off');
  };

  const pick = (i: number) => {
    const it = cur;
    if (!it?.ask) return;
    picked = i;
    const buttons = opts.querySelectorAll('button');
    buttons[i]?.classList.add('on');
    finish();
    it.ask.onPick(i);
  };

  const enqueue = (it: Item) => {
    // A higher priority cuts in on a plain line (never on a question).
    if (cur && !cur.ask && it.prio > cur.prio) { queue.unshift(cur); finish(); }
    let i = queue.length;
    while (i > 0 && queue[i - 1].prio < it.prio) i--;
    queue.splice(i, 0, it);
  };

  const api: DialogueApi = {
    name: 'dialogue',
    get busy() { return !!cur || queue.length > 0; },
    get asking() { return !!cur?.ask || queue.some((q) => q.ask); },
    say(who, text, o) { enqueue({ who, text, prio: o?.prio ?? 1, secs: o?.secs ?? 0, born: clock }); },
    ask(who, text, options, onPick, o) {
      enqueue({ who, text, prio: o?.prio ?? 2, secs: 0, born: clock, ask: { options, onPick, timeout: o?.timeout ?? 14, fallback: o?.fallback ?? 0 } });
    },
    clear(prio = Infinity) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].prio <= prio) queue.splice(i, 1);
      if (cur && cur.prio <= prio) finish();
    },
    update(dt) {
      clock += dt;
      const ui = engine.get<{ name: string; state: string }>('ui');
      if (root) root.style.visibility = !ui || ui.state === 'playing' ? '' : 'hidden';
      if (dt === 0) return;
      if (!cur) {
        // stale chatter goes; everything else waits its turn
        while (queue.length && queue[0].prio <= 1 && !queue[0].ask && clock - queue[0].born > 9) queue.shift();
        const next = queue.shift();
        if (next) start(next);
        return;
      }
      const it = cur;
      t += dt;
      const n = Math.min(it.text.length, Math.floor(t * cps()));
      if (n !== shown && root) { shown = n; txt.textContent = it.text.slice(0, n); }
      const typed = n >= it.text.length, typedAt = it.text.length / cps();
      if (!it.ask) {
        if (typed && t > typedAt + holdFor(it)) finish();
        return;
      }
      if (!typed) return;
      if (!optionsOn && root) {
        optionsOn = true;
        engine.input.choosing = true;
        opts.textContent = '';
        it.ask.options.forEach((o, i) => {
          const b = el('button', '', opts);
          el('kbd', '', b).textContent = String(i + 1);
          b.append(o);
          b.addEventListener('click', () => pick(i));
        });
        opts.hidden = false; bar.hidden = false;
      }
      const left = Math.max(0, 1 - (t - typedAt) / it.ask.timeout);
      barFill.style.width = `${(left * 100).toFixed(1)}%`;
      const c = engine.input.state.choice;
      if (c >= 1 && c <= it.ask.options.length) { pick(c - 1); return; }
      if (left <= 0) pick(Math.min(it.ask.fallback, it.ask.options.length - 1));
    },
  };
  void picked;
  engine.add(api);
}
