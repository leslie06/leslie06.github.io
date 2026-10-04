import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import { DANCE_BPM } from '../character/Animator';
import { C, F, css, el } from '../ui/theme';

css(`
.hud .dgame{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:8px;pointer-events:none}
.hud .dgame[hidden]{display:none}
.hud .dgame .ttl{font:800 13px/1 ${F.ui};letter-spacing:.12em;color:${C.paper};text-shadow:0 2px 8px rgba(0,0,0,.6)}
.hud .dgame .lane{position:relative;width:120px;height:120px}
.hud .dgame .arrow{position:absolute;inset:22px;border-radius:50%;display:grid;place-items:center;background:rgba(14,17,20,.8);border:3px solid ${C.yellow};
  font:900 40px/1 ${F.ui};color:${C.yellow}}
.hud .dgame .ring{position:absolute;left:50%;top:50%;border:3px solid rgba(244,241,232,.85);border-radius:50%;transform:translate(-50%,-50%)}
.hud .dgame .fb{font:900 22px/1 ${F.num};letter-spacing:.06em;min-height:24px;text-shadow:0 2px 10px rgba(0,0,0,.6)}
.hud .dgame .score{font:700 13px/1 ${F.num};color:${C.muted}}
`);

const ARROWS = ['←', '↑', '→', '↓'];
/** Cues: one every CUE_BEATS beats, CUES of them, starting LEAD beats in. Windows in seconds either side. */
const CUE_BEATS = 2, CUES = 16, LEAD = 4, PERFECT = 0.12, GOOD = 0.22;

/**
 * Dancing with the square (life/): an arrow comes up on every other beat with a ring closing on it; press
 * that way (WASD, the arrow keys, the stick) as the ring meets it. Perfect, good or a miss; sixteen of them,
 * then `onDone(perfect + good, of)`. Timed on the dance's own clock, so the beat is the music's and the dancers'.
 */
export class DanceGame {
  private root: HTMLDivElement | null = null;
  private arrow!: HTMLDivElement; private ring!: HTMLDivElement; private fb!: HTMLDivElement; private score!: HTMLDivElement;
  private cues: number[] = []; private start = 0; private next = 0; private hits = 0; private fbT = 0;
  private prev = [false, false, false, false];
  /** The first cue's beat on the dance clock. */
  private b0 = 0;
  active = false;
  constructor(private engine: Engine, private onDone: (hits: number, of: number) => void) {}

  private mount(): void {
    if (this.root) return;
    const hud = document.querySelector<HTMLElement>('.hud');
    if (!hud) return;
    const r = this.root = el('div', 'dgame', hud);
    el('div', 'ttl', r).textContent = t('life.game.title');
    const lane = el('div', 'lane', r);
    this.ring = el('div', 'ring', lane); this.arrow = el('div', 'arrow', lane);
    this.fb = el('div', 'fb', r); this.score = el('div', 'score', r);
  }

  /** Start on the dance clock at `danceT` (seconds); cues land on its beats. */
  begin(danceT: number): void {
    this.mount();
    const beat = 60 / DANCE_BPM, b0 = Math.ceil(danceT / beat) + LEAD;
    this.start = danceT; this.next = 0; this.hits = 0; this.fbT = 0;
    this.cues = Array.from({ length: CUES }, () => Math.floor(Math.random() * 4));
    this.b0 = b0;
    this.active = true;
    if (this.root) { this.root.hidden = false; this.root.querySelector('.ttl')!.textContent = t('life.game.title'); }
  }

  private cueTime(i: number): number { const beat = 60 / DANCE_BPM; return (this.b0 + i * CUE_BEATS) * beat; }

  /** Each frame with the dance clock. */
  update(dt: number, danceT: number): void {
    if (!this.active) return;
    const s = this.engine.input.state;
    const now = [s.steer < -0.5, s.forward > 0.5, s.steer > 0.5, s.back > 0.5];
    let pressed = -1;
    for (let k = 0; k < 4; k++) { if (now[k] && !this.prev[k]) pressed = k; this.prev[k] = now[k]; }
    this.fbT -= dt;
    if (this.next >= CUES) {
      if (this.fbT <= -0.6) { this.active = false; if (this.root) this.root.hidden = true; this.onDone(this.hits, CUES); }
      return;
    }
    const due = this.cueTime(this.next), dtc = danceT - due;
    if (pressed >= 0 && dtc > -GOOD * 1.6) {
      const ok = pressed === this.cues[this.next] && Math.abs(dtc) <= GOOD;
      this.feedback(ok ? (Math.abs(dtc) <= PERFECT ? 'hit' : 'good') : 'miss');
      if (ok) this.hits++;
      this.next++;
    } else if (dtc > GOOD) { this.feedback('miss'); this.next++; }
    if (!this.root) return;
    if (this.next < CUES) {
      const left = this.cueTime(this.next) - danceT, beat = 60 / DANCE_BPM;
      this.arrow.textContent = ARROWS[this.cues[this.next]];
      const size = 76 + Math.max(0, Math.min(1, left / (beat * CUE_BEATS))) * 80;
      this.ring.style.width = this.ring.style.height = `${size.toFixed(0)}px`;
      this.ring.style.opacity = left > beat * CUE_BEATS ? '0.25' : '1';
    }
    this.score.textContent = `${this.hits} / ${CUES}`;
  }

  private feedback(k: 'hit' | 'good' | 'miss'): void {
    this.fbT = 0.5;
    if (!this.fb) return;
    this.fb.textContent = t(k === 'hit' ? 'life.game.hit' : k === 'good' ? 'life.game.good' : 'life.game.miss');
    this.fb.style.color = k === 'miss' ? C.red : k === 'hit' ? C.yellow : C.paper;
  }

  cancel(): void { this.active = false; if (this.root) this.root.hidden = true; }
}
