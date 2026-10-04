import * as THREE from 'three';
import { t, type TKey, type TParams } from '../core/I18n';
import { randomLook, type Look } from '../character/Body';
import { voiceOf, type VoiceSpec } from '../character/Voice';
import type { Speaker } from '../game/Contracts';

/**
 * Who gets in the taxi. Most are just passengers; the rest have a way about them that changes how a
 * fare pays (P1 of the NPC plan):
 *   rush      a train to catch: to a railway station, the speed bonus doubled, nags when you dawdle;
 *   queasy    carsick: tips by how smooth the ride was, stunts earn nothing;
 *   chatty    an old Beijinger: a story at every landmark passed (each tipped), chatter between;
 *   streamer  live on her phone: stunts tipped double, an audience that grows with them;
 *   drunk     late at night only: rough driving makes him sick (a cleaning bill), else a tip;
 *   mystery   rare: a star on the way, triple fare if the police are lost before the drop.
 */
export type PaxKind = 'normal' | 'rush' | 'queasy' | 'chatty' | 'streamer' | 'drunk' | 'mystery';
export const PAX_COLOR: Record<PaxKind, string> = { normal: '#cfd6dd', rush: '#7fb2ff', queasy: '#9fdc8c', chatty: '#e6b35c', streamer: '#ff7fbf', drunk: '#c79bff', mystery: '#8d949b' };

/** Who is hailing, by the hour (0..24). */
export function pickPax(rnd: () => number, hour: number, special = 1): PaxKind {
  const night = hour >= 21 || hour < 4;
  const w: [PaxKind, number][] = [['normal', 0.36 / special], ['rush', 0.13], ['queasy', 0.12], ['chatty', 0.14], ['streamer', 0.11], ['drunk', night ? 0.16 : 0], ['mystery', 0.05]];
  let r = rnd() * w.reduce((a, [, x]) => a + x, 0);
  for (const [k, x] of w) { if ((r -= x) <= 0) return k; }
  return 'normal';
}

const col = (c: string) => new THREE.Color(c);
/** A look to go with the kind, so you can tell who is waving before they get in. */
export function paxLook(kind: PaxKind, rnd: () => number): Look {
  const l = randomLook(rnd), pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  switch (kind) {
    case 'rush': l.age = 0.25 + rnd() * 0.15; l.top = 'jacket'; l.shirt = col(pick(['#1f2a3d', '#2b2d31', '#3a3f47'])); l.inner = col('#eef0f2'); l.sleeve = 0.53;
      l.bottom = l.fem && rnd() < 0.5 ? 'skirt' : 'trousers'; l.hem = l.bottom === 'skirt' ? 0.8 : 0.8; l.pants = col('#202227'); l.glasses = rnd() < 0.5; l.cap = null; l.print = false; break;
    case 'queasy': l.fem = 1; l.age = 0.5 + rnd() * 0.15; l.top = 'coat'; l.shirt = col(pick(['#8a4f5c', '#5e6b4a', '#7d6a55'])); l.inner = col('#e8e1d6'); l.hairStyle = pick(['bob', 'short', 'bun']); l.cap = null; l.mask = null; break;
    case 'chatty': l.fem = 0; l.age = 0.82 + rnd() * 0.15; l.top = 'jacket'; l.shirt = col(pick(['#4b5048', '#5a5246', '#33405a'])); l.inner = col('#ded9cc');
      l.pants = col('#2d2e30'); l.hairStyle = pick(['buzz', 'bald']); l.cap = rnd() < 0.35 ? col('#3a3a36') : null; l.glasses = rnd() < 0.4; l.print = false; break;
    case 'streamer': l.fem = rnd() < 0.75 ? 1 : 0; l.age = 0.12 + rnd() * 0.12; l.top = 'tee'; l.print = true; l.shirt = col(pick(['#ff9ec7', '#ffe46b', '#8fe3ff', '#f4f1e8']));
      l.hairStyle = l.fem ? pick(['long', 'ponytail', 'bob']) : 'short'; l.fringe = true; l.cap = null; l.mask = null; break;
    case 'drunk': l.fem = 0; l.age = 0.22 + rnd() * 0.15; l.top = 'shirt'; l.shirt = col(pick(['#d9d6cf', '#9fb7d9', '#c9a27e'])); l.sleeve = 0.36; l.cap = null; l.mask = null; break;
    case 'mystery': l.fem = 0; l.age = 0.4; l.top = 'coat'; l.shirt = col('#141518'); l.inner = col('#1d1f22'); l.sleeve = 0.53; l.pants = col('#15161a');
      l.cap = col('#101112'); l.mask = rnd() < 0.7 ? col('#111214') : null; l.glasses = rnd() < 0.5; l.print = false; break;
    default: break;
  }
  return l;
}

type Moment = 'near' | 'drift' | 'air' | 'crash' | 'redlight';

/**
 * One fare in progress: what the passenger has to say about the drive, and the running scores
 * their kind pays by. missions/ feeds it the car each step and the stunts and knocks as they come,
 * and asks it for the tip at the end.
 */
export class PaxRide {
  readonly voice: VoiceSpec;
  smooth = 100; nausea = 0; vomited = false; viewers: number; lmTips = 0;
  readonly told = new Set<string>();
  private lineT = 0; private idleT: number; private slowT = 0; private calmSaid = false; private warned = false;
  /** mystery: 'calm' before the star, 'hot' with the police on, 'lost' once they are shaken off. */
  heat: 'calm' | 'hot' | 'lost' = 'calm';
  private prevVx = NaN; private prevVz = 0;

  constructor(readonly kind: PaxKind, readonly look: Look, seed: number, private say: (who: Speaker, text: string) => void, rnd: () => number) {
    this.voice = voiceOf(look, seed);
    this.viewers = 80 + Math.round(rnd() * 160);
    this.idleT = 12 + rnd() * 8;
  }

  get speaker(): Speaker { return { name: t(`pax.name.${this.kind}` as TKey), color: PAX_COLOR[this.kind], look: this.look, voice: this.voice, at: null }; }

  line(key: string, p?: TParams): void { this.lineT = 3.5; this.say(this.speaker, t(key as TKey, p)); }

  board(place: string, rnd: () => number): void {
    this.line(this.kind === 'normal' ? `pax.normal.board${1 + Math.floor(rnd() * 3)}` : `pax.${this.kind}.board`, { place });
  }

  /** A stunt or a knock: their reaction (rate-limited) and its effect on the scores. */
  react(m: Moment, points = 0): void {
    if (this.kind === 'queasy') this.smooth = Math.max(0, this.smooth - (m === 'air' ? 18 : m === 'crash' ? 12 : m === 'drift' ? 8 : m === 'near' ? 5 : 2));
    if (this.kind === 'drunk') this.nausea += m === 'air' ? 30 : m === 'crash' ? 22 : m === 'drift' ? 18 : 6;
    if (this.kind === 'streamer') this.viewers = m === 'crash' ? Math.round(this.viewers * 0.85) : this.viewers + points * 3;
    if (this.lineT > 0) return;
    this.line(`pax.${this.kind}.${m}`);
  }

  /** Each step of the ride: driving style, chatter, nagging. */
  step(dt: number, vx: number, vz: number, speed: number, rnd: () => number): void {
    this.lineT -= dt;
    if (Number.isFinite(this.prevVx)) {
      const a = Math.hypot(vx - this.prevVx, vz - this.prevVz) / dt;
      if (a > 4.5 && a < 60) {
        if (this.kind === 'queasy') this.smooth = Math.max(0, this.smooth - (a - 4.5) * dt * 4);
        if (this.kind === 'drunk') this.nausea += (a - 4.5) * dt * 6;
      }
    }
    this.prevVx = vx; this.prevVz = vz;
    if (this.kind === 'drunk' && !this.vomited) {
      this.nausea = Math.max(0, this.nausea - dt * 2);
      if (!this.warned && this.nausea > 65) { this.warned = true; this.line('pax.drunk.warn'); }
      if (this.nausea > 100) { this.vomited = true; this.line('pax.drunk.vomit'); }
    }
    if (this.kind === 'rush') {
      this.slowT = speed < 7 ? this.slowT + dt : 0;
      if (this.slowT > 4 && this.lineT <= 0) { this.slowT = -6; this.line(rnd() < 0.5 ? 'pax.rush.slow1' : 'pax.rush.slow2'); }
    }
    if (this.kind === 'queasy' && !this.calmSaid && this.smooth > 85) { this.idleT -= dt; if (this.idleT < -14) { this.calmSaid = true; this.line('pax.queasy.calm'); } }
    if (this.kind === 'chatty' || this.kind === 'drunk') {
      this.idleT -= dt;
      if (this.idleT <= 0 && this.lineT <= 0) {
        this.idleT = 16 + rnd() * 10;
        this.line(this.kind === 'chatty' ? `pax.chatty.idle${1 + Math.floor(rnd() * 3)}` : `pax.drunk.idle${1 + Math.floor(rnd() * 2)}`);
      }
    }
  }

  /** The chatty one passing a landmark: a story, and a tip for it. */
  landmark(id: string, name: string, rnd: () => number): void {
    if (this.kind !== 'chatty' || this.told.has(id)) return;
    this.told.add(id); this.lmTips += 8;
    this.line(`pax.chatty.lm${1 + Math.floor(rnd() * 3)}`, { place: name });
  }

  /** The tip their way: `stuntTips` what stunts earned in the usual reckoning. */
  tip(stuntTips: number): number {
    switch (this.kind) {
      case 'queasy': return Math.round(this.smooth * 0.5);
      case 'chatty': return stuntTips + this.lmTips;
      case 'streamer': return stuntTips * 2 + Math.floor(this.viewers / 150);
      case 'drunk': return this.vomited ? stuntTips : stuntTips + 20;
      default: return stuntTips;
    }
  }
}
