import type { Turn } from '../nav/Turns';
import type { CityClips } from './CityClips';
import { NAV_DISTS, NAV_KINDS, navId, roadClip, type NavDist, type NavVoiceId } from './NavLines';

/**
 * 语音导航（2026-11-10，docs/beijing-immersion-design.md C2）：有导航目标（地图上点的、任务的；主线来电的起点不算）、
 * 人在车里时，跟着 GPS 的转向提示说话。每个路口最多说两次：远的一次带距离（「前方五百米右转，进入东三环」，
 * 快的时候从一公里说起），快到时再说一次（「前方路口右转」）；下一个路口紧挨着的话后面加一句「随后左转」。
 * 换了目的地说「开始导航」，开岔了重新规划时说一句，到了地图上点的地方说「已到达」。说话时电台压低。
 * 两种声音：普通话和京腔（暂停菜单「语音导航」，默认京腔），录音是 public/voice/nav/ 下的片段（audio/NavLines.ts）。
 */
export type NavVoicePref = 'off' | NavVoiceId;
export const NAV_VOICE_PREFS: readonly NavVoicePref[] = ['j', 'f', 'off'];
const KEY = 'drivecity.navVoice';
let pref: NavVoicePref = 'j';
try { const s = localStorage.getItem(KEY) as NavVoicePref | null; if (s && NAV_VOICE_PREFS.includes(s)) pref = s; } catch { /* private mode */ }
const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('navvoice') as NavVoicePref | null : null;
if (fromUrl && NAV_VOICE_PREFS.includes(fromUrl)) pref = fromUrl;
const listeners: ((p: NavVoicePref) => void)[] = [];
/** `?navlog`: each prompt as it plays, on the console (probes). */
const LOG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('navlog');
export const navVoicePref = {
  get value(): NavVoicePref { return pref; },
  set(p: NavVoicePref): void {
    if (p === pref) return;
    pref = p;
    try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
    for (const f of listeners) f(p);
  },
  onChange(f: (p: NavVoicePref) => void): void { listeners.push(f); },
};

/** What it reads from nav/ each frame. */
export interface NavView {
  readonly target: { kind: string; x: number; z: number } | null;
  readonly gps: { s: number; turns: Turn[] } | null;
  readonly routeLeft: number;
}

/** Seconds of silence between two clips of one prompt. */
const GAP = 0.05;
/** A new destination at least this far from the last one is a new route (closer: a moving target, say nothing). */
const NEW_TARGET = 40;
/** The next turn this close after the one being announced: "随后…" on the end. */
const THEN = 150;

/** The recorded distance nearest (by ratio) to `d`. */
function bucket(d: number): NavDist {
  let best: NavDist = NAV_DISTS[0], bd = Infinity;
  for (const x of NAV_DISTS) { const e = Math.abs(Math.log(x / d)); if (e < bd) { bd = e; best = x; } }
  return best;
}

export class NavVoice {
  private readonly out: GainNode;
  private turn: Turn | null = null;
  /** 0 nothing said for `turn`, 1 the far prompt, 2 the near one. */
  private stage = 0;
  private gps: object | null = null;
  private tx = NaN; private tz = NaN; private kind = '';
  private startT = -1e9; private rerouteT = -1e9;
  private lastLeft = Infinity;
  private token = 0;
  private pending: { ids: string[]; token: number } | null = null;
  private loading = false;
  private until = 0;
  private ducked = false;
  private preloaded = '';

  constructor(private ctx: AudioContext, master: AudioNode, private clips: CityClips, private duck: (on: boolean) => void) {
    this.out = ctx.createGain();
    this.out.gain.value = 1.1;
    this.out.connect(master);
  }

  /**
   * Once a frame. `speed` m/s; `active`: the player is driving and not paused; `quiet`: someone is talking (a call, a
   * line of dialogue): only the near prompts then.
   */
  update(nav: NavView, speed: number, active: boolean, quiet: boolean): void {
    const now = this.ctx.currentTime;
    if (this.ducked && now > this.until && !this.loading) { this.ducked = false; this.duck(false); }
    const v = pref;
    const tg = nav.target && nav.target.kind !== 'story' ? nav.target : null;
    if (v === 'off' || !active) { this.pending = null; this.syncTarget(tg, null); return; }
    this.preload(v);
    if (this.pending && !this.loading && now >= this.until) this.play();
    if (!tg) {
      // the map's waypoint reached (nav/ clears it on arrival)
      if (this.kind === 'waypoint' && this.lastLeft < 160) this.say([navId.arrived(v)]);
      this.syncTarget(null, null);
      return;
    }
    const moved = Math.hypot(tg.x - this.tx, tg.z - this.tz);
    if (!(moved < NEW_TARGET) || tg.kind !== this.kind) {
      this.syncTarget(tg, nav.gps);
      if (now - this.startT > 30) { this.startT = now; this.say([navId.start(v)]); }
    } else if (moved > 1) {
      // a moving target (a chase): follow it quietly
      this.tx = tg.x; this.tz = tg.z; this.gps = nav.gps;
    }
    const g = nav.gps;
    this.lastLeft = nav.routeLeft;
    if (!g) return;
    if (g !== this.gps) {
      const had = this.gps;
      this.gps = g;
      this.turn = null;
      if (had && now - this.rerouteT > 20 && now - this.startT > 8) { this.rerouteT = now; this.say([navId.reroute(v)]); }
    }
    let i = 0;
    while (i < g.turns.length && g.turns[i].s <= g.s + 4) i++;
    const tn = g.turns[i];
    if (!tn) return;
    if (tn !== this.turn) { this.turn = tn; this.stage = 0; }
    const dist = tn.s - g.s;
    const road = tn.kind === 'arrive' || tn.kind === 'U' ? null : roadClip(v, tn.road);
    // straight on where the road changes its name: worth a word only with the name
    if (tn.kind === 'S' && !road) return;
    const next = g.turns[i + 1];
    const then = next && next.s - tn.s < THEN && next.kind !== 'S' ? navId.then(v, next.kind) : null;
    const nearD = Math.max(60, speed * 5), farD = speed >= 19 ? 1100 : speed >= 11 ? 560 : 340;
    if (this.stage === 0 && !quiet && dist > nearD + 80 && dist <= farD) {
      this.stage = 1;
      this.say([navId.far(v, bucket(dist), tn.kind), road, then]);
    } else if (this.stage < 2 && dist <= nearD) {
      const first = this.stage === 0;
      this.stage = 2;
      this.say([navId.near(v, tn.kind), first ? road : null, then]);
    }
  }

  private syncTarget(tg: NavView['target'], gps: object | null): void {
    this.tx = tg?.x ?? NaN; this.tz = tg?.z ?? NaN; this.kind = tg?.kind ?? '';
    this.gps = gps; this.turn = null; this.stage = 0;
    if (!tg) this.lastLeft = Infinity;
  }

  /** The short prompts every route uses, fetched when the voice is first needed. */
  private preload(v: NavVoiceId): void {
    if (this.preloaded === v) return;
    this.preloaded = v;
    for (const k of NAV_KINDS) void this.clips.load(navId.near(v, k));
    for (const id of [navId.start(v), navId.reroute(v), navId.arrived(v)]) void this.clips.load(id);
  }

  /** Queue a prompt (it replaces one not started yet); null entries are skipped. */
  private say(ids: (string | null)[]): void {
    this.pending = { ids: ids.filter((x): x is string => !!x), token: ++this.token };
    for (const id of this.pending.ids) void this.clips.load(id);
    if (!this.loading && this.ctx.currentTime >= this.until) this.play();
  }

  private play(): void {
    const p = this.pending;
    if (!p || !p.ids.length) { this.pending = null; return; }
    this.pending = null;
    this.loading = true;
    const asked = this.ctx.currentTime;
    void Promise.all(p.ids.map((id) => this.clips.load(id))).then((bufs) => {
      this.loading = false;
      // too slow to fetch (2.5 s), or the first clip is missing: say nothing rather than half of it, or late
      if (!bufs[0] || this.ctx.currentTime - asked > 2.5) { if (LOG) console.info('[navvoice] dropped', p.ids.join(' + ')); return; }
      if (LOG) console.info('[navvoice]', p.ids.filter((_, i) => bufs[i]).join(' + '));
      let t = this.ctx.currentTime + 0.03;
      for (const b of bufs) {
        if (!b) continue;
        const src = this.ctx.createBufferSource();
        src.buffer = b;
        src.connect(this.out);
        src.start(t);
        t += b.duration + GAP;
      }
      this.until = t;
      if (!this.ducked) { this.ducked = true; this.duck(true); }
    });
  }
}

