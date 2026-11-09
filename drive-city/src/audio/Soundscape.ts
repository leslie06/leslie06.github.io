import type { CityClips } from './CityClips';

/**
 * 北京的街头声景（2026-11-09，docs/beijing-immersion-design.md B1，「闭上眼睛听，也知道这是北京」）：按听的人在哪儿
 * （胡同、小区、公园、大马路）、几点、什么季节混进来：
 *   鸽哨     胡同和老城，白天：一群鸽子带着哨子绕一圈飞过去（几只频率略不同的哨音，绕着头顶转、带多普勒）；
 *   知了     夏天白天，树多的地方：一阵一阵地叫起来；
 *   蛐蛐     秋天夜里；
 *   麻雀、喜鹊  白天（喜鹊冬天多）；
 *   自行车铃 胡同、小区；
 *   吆喝     录音（public/voice/city/street.*）：收旧家电的喇叭、磨剪子戗菜刀、冬天的冰糖葫芦，从几十米外传过来；
 *   倒车请注意 小区里偶尔；公交进站、起步的报站（traffic/ 的 `traffic:bus`）。
 * 都是 Web Audio 合成或很短的录音，不占帧时间。坐在车里关着窗：整体小一半、高频滤掉。
 */
export interface Where {
  x: number; z: number;
  /** Camera forward on the ground, normalised. */
  fx: number; fz: number;
  hour: number;
  /** Day of the year (Beijing). */
  day: number;
  hutong: boolean; old: boolean; resid: boolean; park: boolean; bigRoad: boolean;
  /** Inside a closed car (not on foot, not on a two-wheeler). */
  inCar: boolean;
  paused: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Soundscape {
  private readonly out: GainNode;
  private readonly muffle: BiquadFilterNode;
  private timers = { pigeon: rand(8, 25), sparrow: 2, magpie: rand(10, 30), bell: rand(10, 30), recycle: rand(40, 120), knife: rand(120, 300), tanghulu: rand(60, 200), reverse: rand(90, 240) };
  private cicada: { gain: GainNode; amp: number; next: number } | null = null;
  private cricketT = 0;
  private preloaded = false;

  constructor(private ctx: AudioContext, master: AudioNode, private clips: CityClips, private noise: AudioBuffer) {
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(this.muffle).connect(master);
  }

  update(dt: number, w: Where): void {
    const c = this.ctx, now = c.currentTime;
    this.out.gain.setTargetAtTime(w.paused ? 0 : w.inCar ? 0.45 : 1, now, 0.3);
    this.muffle.frequency.setTargetAtTime(w.inCar ? 1800 : 18000, now, 0.3);
    if (w.paused) return;
    const day = w.hour >= 6 && w.hour < 18.5, h = w.hour, d = w.day;
    const green = w.park || w.resid || w.hutong;
    // 第一次走进胡同或小区：把街头的几段录音先下好（共约 200 KB），第一次吆喝就有声音
    if (!this.preloaded && (w.hutong || w.resid)) {
      this.preloaded = true;
      for (const id of ['street.recycle', 'street.knife', 'street.tanghulu', 'street.reverse', 'street.bus.arrive', 'street.bus.leave']) void this.clips.load(id);
    }
    const t = this.timers;
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] -= dt;
    // 鸽哨
    if (t.pigeon <= 0) { t.pigeon = rand(50, 110); if ((w.hutong || w.old) && h >= 7 && h < 17.5) this.pigeons(); }
    // 麻雀
    if (t.sparrow <= 0) { t.sparrow = rand(3, h < 10 ? 7 : 12); if (green && day && !w.bigRoad) this.sparrows(); }
    // 喜鹊（冬天多）
    if (t.magpie <= 0) { const winter = d >= 320 || d < 70; t.magpie = rand(winter ? 15 : 30, winter ? 40 : 70); if (green && day) this.magpie(); }
    // 自行车铃
    if (t.bell <= 0) { t.bell = rand(25, 60); if ((w.hutong || w.resid) && h >= 7 && h < 21) this.bell(); }
    // 吆喝和倒车提示（录音）
    if (t.recycle <= 0) { t.recycle = rand(150, 300); if ((w.hutong || w.resid) && h >= 9 && h < 18) this.voice('street.recycle', w, 50, 110, true); }
    if (t.knife <= 0) { t.knife = rand(300, 600); if (w.hutong && h >= 9 && h < 17) this.voice('street.knife', w, 40, 90, false); }
    if (t.tanghulu <= 0) { t.tanghulu = rand(200, 400); if ((w.hutong || w.old) && (d >= 335 || d < 60) && h >= 10 && h < 20) this.voice('street.tanghulu', w, 30, 80, false); }
    if (t.reverse <= 0) { t.reverse = rand(240, 480); if (w.resid && h >= 7 && h < 20) this.voice('street.reverse', w, 20, 50, true); }
    // 知了：夏天白天，一阵一阵
    const summer = d >= 160 && d <= 240 && h >= 9 && h < 19 && green;
    if (summer && !this.cicada) this.cicada = this.cicadas();
    if (this.cicada) {
      const cc = this.cicada;
      cc.next -= dt;
      if (cc.next <= 0) { cc.next = rand(5, 11); cc.amp = summer ? rand(0.4, 1) : 0; }
      cc.gain.gain.setTargetAtTime(cc.amp * (w.park ? 0.05 : 0.03), now, 1.6);
    }
    // 蛐蛐：秋天夜里
    if (d >= 225 && d <= 300 && (h >= 19.5 || h < 4) && green) {
      this.cricketT -= dt;
      if (this.cricketT <= 0) { this.cricketT = rand(0.5, 1.3); this.cricket(); }
    }
  }

  /** 公交进站 / 起步：报站从车那儿传过来（镜头 40 米内）。 */
  bus(x: number, z: number, arrive: boolean, w: Where): void {
    if (w.paused || Math.hypot(x - w.x, z - w.z) > 40) return;
    this.voiceAt(arrive ? 'street.bus.arrive' : 'street.bus.leave', x, z, w, true, 0.9);
  }

  // --- the sounds ---------------------------------------------------------------------------------

  private panFor(x: number, z: number, w: Where): { pan: number; dist: number } {
    const dx = x - w.x, dz = z - w.z, dist = Math.hypot(dx, dz) || 1;
    // the camera's right on the ground is (-fz, fx) (x east, z south)
    const pan = Math.max(-1, Math.min(1, (dx * -w.fz + dz * w.fx) / dist));
    return { pan, dist };
  }

  /** A recorded call from somewhere `r0`..`r1` m off in a random direction (a loudspeaker's band if `horn`). */
  private voice(id: string, w: Where, r0: number, r1: number, horn: boolean): void {
    const a = Math.random() * Math.PI * 2, r = rand(r0, r1);
    this.voiceAt(id, w.x + Math.cos(a) * r, w.z + Math.sin(a) * r, w, horn, 1);
  }

  private voiceAt(id: string, x: number, z: number, w: Where, horn: boolean, level: number): void {
    const buf = this.clips.get(id);
    if (!buf) { void this.clips.load(id); return; }   // next time
    const c = this.ctx, { pan, dist } = this.panFor(x, z, w);
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(1400, 9000 - dist * 70);
    const g = c.createGain(); g.gain.value = level * 0.55 / (1 + dist / 22);
    const p = c.createStereoPanner(); p.pan.value = pan * 0.8;
    let head: AudioNode = src;
    if (horn) {
      // a cheap loudspeaker: a narrow band and a little grit
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
      const sh = c.createWaveShaper(); const k = new Float32Array(256); for (let i = 0; i < 256; i++) k[i] = Math.tanh((i / 128 - 1) * 2.2); sh.curve = k;
      head = head.connect(bp).connect(sh);
    }
    head.connect(lp).connect(g).connect(p).connect(this.out);
    src.start();
  }

  /** 鸽哨：a flock wheeling overhead with whistles on their tails, ~10 s. */
  private pigeons(): void {
    const c = this.ctx, t = c.currentTime, len = rand(8, 12);
    const p = c.createStereoPanner(); p.connect(this.out);
    p.pan.setValueAtTime(-0.8, t); p.pan.linearRampToValueAtTime(0.8, t + len * 0.5); p.pan.linearRampToValueAtTime(-0.4, t + len);
    const base = rand(480, 620);
    for (const [ratio, lvl] of [[1, 1], [1.5, 0.7], [2.02, 0.55], [2.51, 0.35], [3.03, 0.25]] as const) {
      const o = c.createOscillator(); o.type = 'sine';
      const f = base * ratio * rand(0.995, 1.005);
      // the flock comes and goes: the pitch rises as it nears and falls away (Doppler), with a slow wobble
      o.frequency.setValueAtTime(f * 0.985, t); o.frequency.linearRampToValueAtTime(f * 1.02, t + len * 0.45); o.frequency.linearRampToValueAtTime(f * 0.97, t + len);
      const vib = c.createOscillator(); vib.frequency.value = rand(3, 5.5);
      const vg = c.createGain(); vg.gain.value = f * 0.006; vib.connect(vg).connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.018 * lvl, t + len * 0.35);
      g.gain.setValueAtTime(0.018 * lvl, t + len * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(p); o.start(t); o.stop(t + len + 0.1); vib.start(t); vib.stop(t + len + 0.1);
    }
    // wingbeats under the whistles
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const am = c.createGain(); am.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.004;
    lfo.connect(lg).connect(am.gain);
    const eg = c.createGain(); eg.gain.setValueAtTime(0, t); eg.gain.linearRampToValueAtTime(1, t + len * 0.4); eg.gain.linearRampToValueAtTime(0, t + len);
    n.connect(bp).connect(am).connect(eg).connect(p); n.start(t, Math.random()); n.stop(t + len); lfo.start(t); lfo.stop(t + len);
  }

  /** 麻雀：two to five quick chirps. */
  private sparrows(): void {
    const c = this.ctx, t0 = c.currentTime, n = 2 + Math.floor(Math.random() * 4), pan = rand(-0.9, 0.9);
    const p = c.createStereoPanner(); p.pan.value = pan; p.connect(this.out);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.09, 0.2), o = c.createOscillator(), g = c.createGain();
      const f = rand(3600, 5200);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rand(0.7, 1.25), t + 0.05);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(p); o.start(t); o.stop(t + 0.08);
    }
  }

  /** 喜鹊：a harsh chatter, chak-chak-chak. */
  private magpie(): void {
    const c = this.ctx, t0 = c.currentTime, n = 3 + Math.floor(Math.random() * 5);
    const p = c.createStereoPanner(); p.pan.value = rand(-0.8, 0.8); p.connect(this.out);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.11, 0.16);
      const src = c.createBufferSource(); src.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1600, 2200); bp.Q.value = 3;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(bp).connect(g).connect(p); src.start(t, Math.random() * 1.5, 0.09);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = rand(800, 1000);
      const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.01, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(og).connect(p); o.start(t); o.stop(t + 0.07);
    }
  }

  /** 自行车铃：叮铃—叮铃, a thumb-flicked bell. */
  private bell(): void {
    const c = this.ctx, t0 = c.currentTime, rings = Math.random() < 0.5 ? 2 : 4;
    const p = c.createStereoPanner(); p.pan.value = rand(-0.7, 0.7); p.connect(this.out);
    for (let i = 0; i < rings; i++) {
      const t = t0 + i * 0.075 + (i >= 2 ? 0.25 : 0);
      for (const [f, a, dec] of [[3150, 1, 0.5], [4080, 0.6, 0.35], [5650, 0.35, 0.22], [7400, 0.2, 0.12]] as const) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f * rand(0.998, 1.002);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.02 * a, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g).connect(p); o.start(t); o.stop(t + dec + 0.05);
      }
    }
  }

  /** 蛐蛐：a train of three or four chirps at ~4.4 kHz. */
  private cricket(): void {
    const c = this.ctx, t0 = c.currentTime, n = 3 + Math.floor(Math.random() * 2);
    const p = c.createStereoPanner(); p.pan.value = rand(-0.9, 0.9); p.connect(this.out);
    const f = rand(4200, 4700);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.055, o = c.createOscillator(), g = c.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.008, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      o.connect(g).connect(p); o.start(t); o.stop(t + 0.05);
    }
  }

  /** 知了：a chorus that swells and fades (the caller drives `gain`): noise in a 5 kHz band, buzzed at ~70 Hz. */
  private cicadas(): { gain: GainNode; amp: number; next: number } {
    const c = this.ctx, gain = c.createGain(); gain.gain.value = 0;
    gain.connect(this.out);
    for (const [fc, buzz, pan] of [[4800, 68, -0.6], [5600, 74, 0.5], [4200, 61, 0.1]] as const) {
      const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = 4;
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = buzz;
      const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
      const p = c.createStereoPanner(); p.pan.value = pan;
      n.connect(bp).connect(am).connect(p).connect(gain);
      n.start(0, Math.random()); lfo.start();
    }
    return { gain, amp: 0, next: 0 };
  }
}
