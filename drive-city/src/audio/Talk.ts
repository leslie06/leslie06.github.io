import { RADIO_ROADS, type RadioRoad, type RoadStatus } from './CityLines';
import type { CityClips } from './CityClips';

/**
 * 「B城交通台」（2026-11-09，docs/beijing-immersion-design.md B2）：电台的第二个台，北京的哥开车都开着交通广播。
 * 节目一段接一段：台呼、实时路况（玩家附近真有的 2–3 条路，早晚高峰环路和快速路堵）、天气和季节、段子、广告；
 * 游戏时钟到整点插报时（嘀、嘀、嘀、嘟）；玩家被追捕、甩掉警察、被抓、在路口漂移，主持人插播「听众报料」。
 * 录音在 public/voice/city/radio.*（CityLines.ts）；没下载好的句子跳过。
 */
export interface TalkWorld {
  /** Game clock, hours 0..24. */
  hour(): number;
  /** 0 dry .. 1 pouring. */
  rain(): number;
  /** The player's position. */
  where(): { x: number; z: number };
  /** The radio roads within reach and how far (m), nearest first: the map's road chains. */
  roadsNear(x: number, z: number): { road: RadioRoad; d: number }[];
  /** Day of the year in Beijing (render/Season.ts), for the season lines. */
  day(): number;
}

type Item = { clip: string } | { gap: number } | { pips: true };

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export class Talk {
  private queue: Item[] = [];
  private playing: AudioBufferSourceNode | null = null;
  private busyUntil = 0;
  private lastHour = -1;
  private segment = 0;
  private news: string | null = null;
  private newsCool = 0;
  private tuned = false;
  private readonly out: GainNode;

  constructor(private ctx: AudioContext, bus: AudioNode, private clips: CityClips, private world: TalkWorld) {
    // 收音机的声音：去掉最低和最高的频段，稍微压一下
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2400; pk.gain.value = 3; pk.Q.value = 0.8;
    this.out = ctx.createGain(); this.out.gain.value = 1.6;
    this.out.connect(hp).connect(pk).connect(lp).connect(bus);
  }

  /** A listener tip-off about what the player just did (played at the next pause, at most every 50 s). */
  report(kind: 'chase' | 'crazy' | 'drift' | 'escaped' | 'busted'): void {
    if (this.newsCool > 0 && kind !== 'escaped' && kind !== 'busted') return;
    this.news = kind;
  }

  /** Once a frame while the talk station is the one on. `audible`: in a car, not paused. */
  update(dt: number, audible: boolean): void {
    this.newsCool = Math.max(0, this.newsCool - dt);
    if (!audible) { this.stop(); this.tuned = false; return; }
    const now = this.ctx.currentTime;
    // the hour: pips and the time, ahead of anything else
    const h = Math.floor(this.world.hour()) % 24;
    if (this.lastHour < 0) this.lastHour = h;
    if (h !== this.lastHour) {
      this.lastHour = h;
      this.queue.unshift({ pips: true }, { clip: `radio.time.${h}` }, { gap: 0.6 });
    }
    if (!this.tuned) {
      this.tuned = true;
      this.queue = [{ gap: 0.4 }, { clip: pick(['radio.id1', 'radio.id2']) }, { gap: 0.7 }];
    }
    if (this.news && !this.queue.some((i) => 'clip' in i && i.clip.startsWith('radio.news'))) {
      // straight after the line now playing
      this.queue.unshift({ gap: 0.5 }, { clip: `radio.news.${this.news}` }, { gap: 0.8 });
      this.news = null;
      this.newsCool = 50;
    }
    if (now < this.busyUntil) return;
    if (!this.queue.length) { this.queue.push(...this.program()); for (const n of this.queue) if ('clip' in n) void this.clips.load(n.clip); }
    const it = this.queue.shift()!;
    if ('gap' in it) { this.busyUntil = now + it.gap; return; }
    if ('pips' in it) { this.pips(now); this.busyUntil = now + 3.1; return; }
    const buf = this.clips.get(it.clip);
    // preload what comes next; a clip still loading is waited for a moment, a failed one skipped
    for (const n of this.queue.slice(0, 4)) if ('clip' in n) void this.clips.load(n.clip);
    if (!buf) {
      // still loading: wait for it (a slow line on the mirror is a pause, not a missing sentence); failed: skip it
      if (!this.clips.failed(it.clip)) { void this.clips.load(it.clip); this.queue.unshift(it); this.busyUntil = now + 0.2; }
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    src.start(now);
    this.playing = src;
    this.busyUntil = now + buf.duration;
  }

  private stop(): void {
    try { this.playing?.stop(); } catch { /* already done */ }
    this.playing = null;
    this.busyUntil = 0;
  }

  /** 嘀、嘀、嘀、嘟：three short pips at 1 kHz and a long one an octave up. */
  private pips(at: number): void {
    const c = this.ctx;
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator(), g = c.createGain(), t = at + i;
      o.frequency.value = i < 3 ? 1000 : 2000;
      const len = i < 3 ? 0.12 : 0.5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.setValueAtTime(0.25, t + len - 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + len + 0.05);
    }
  }

  /** The next segment: a traffic report every other one, between them the weather, a joke or an ad. */
  private program(): Item[] {
    const s = this.segment++;
    const gap = (g: number): Item => ({ gap: g });
    if (s % 2 === 0) return [...this.traffic(), gap(14 + Math.random() * 10)];
    const k = Math.floor(s / 2) % 3;
    if (k === 0) return [{ clip: this.weather() }, gap(12 + Math.random() * 8)];
    if (k === 1) return [{ clip: pick(['radio.chat1', 'radio.chat2', 'radio.chat3', 'radio.chat4', 'radio.chat5']) }, gap(12 + Math.random() * 8)];
    return [{ clip: pick(['radio.ad1', 'radio.ad2', 'radio.ad3']) }, gap(1), { clip: pick(['radio.id1', 'radio.id2', 'radio.bye']) }, gap(12 + Math.random() * 8)];
  }

  private traffic(): Item[] {
    const p = this.world.where();
    const near = this.world.roadsNear(p.x, p.z).filter((r) => r.d < 5000);
    const roads: RadioRoad[] = [];
    for (const r of near) { if (roads.length >= 3) break; if (Math.random() < 0.8) roads.push(r.road); }
    while (roads.length < 2) { const r = pick(RADIO_ROADS); if (!roads.includes(r)) roads.push(r); }
    const out: Item[] = [{ clip: pick(['radio.tr.intro1', 'radio.tr.intro2', 'radio.tr.intro3']) }, { gap: 0.35 }];
    for (const r of roads) out.push({ clip: `radio.tr.${r.id}.${this.status(r)}` }, { gap: 0.3 });
    if (this.world.rain() > 0.3) out.push({ clip: 'radio.tr.rain' });
    else out.push({ clip: pick(['radio.tr.out1', 'radio.tr.out2', 'radio.tr.out3']) });
    return out;
  }

  /** Rush hours jam the rings and the expressways; the night is clear. */
  private status(r: RadioRoad): RoadStatus {
    const h = this.world.hour(), x = Math.random();
    const rush = (h >= 7 && h < 9.5) || (h >= 17 && h < 19.5);
    if (h >= 22 || h < 6) return x < 0.9 ? 'ok' : 'slow';
    if (rush) return r.ring ? (x < 0.4 ? 'jam' : x < 0.9 ? 'slow' : 'ok') : (x < 0.2 ? 'jam' : x < 0.7 ? 'slow' : 'ok');
    return x < 0.3 ? 'slow' : 'ok';
  }

  private weather(): string {
    const h = this.world.hour(), d = this.world.day();
    if (h >= 23 || h < 4) return 'radio.wx.night';
    if (this.world.rain() > 0.3) return 'radio.wx.rain';
    const opts = ['radio.wx.clear'];
    if (d >= 288 && d <= 325) opts.push('radio.wx.autumn', 'radio.wx.autumn');
    if (d >= 318 || d <= 73) opts.push('radio.wx.heat', 'radio.wx.winter');
    if (d >= 105 && d <= 140) opts.push('radio.wx.spring', 'radio.wx.spring');
    if (d >= 160 && d <= 240) opts.push('radio.wx.summer', 'radio.wx.summer');
    return pick(opts);
  }
}
