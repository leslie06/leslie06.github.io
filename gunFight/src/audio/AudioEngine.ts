/**
 * AudioEngine: Web Audio graph, buses, spatialization, reverb, ducking and every event subscription.
 *
 *   voice -> [distance LP] -> [HRTF panner] -> bus gain -> master -> tinnitus LP -> compressor -> limiter -> safety clip -> analyser -> out
 *   voice -> send gain -> bus reverb-in (mirrors bus volume) -> convolver (generated street IR) -> reverb return -> master
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { GameEvents, SurfaceType } from '../core/Events';
import { Rng } from '../core/Rng';
import type { AudioApi, PlayerApi, WeaponsApi, WeaponState } from '../game/Contracts';
import { SOUNDS, ALIASES, type BusName, type SoundDef } from './SoundDefs';
import { impulseResponse, seedFor, encodeWav, type Mono } from './synth';

export interface PlayOpts { position?: THREE.Vector3; volume?: number; pitch?: number; /** seconds; audio-clock scheduled */ delay?: number; /** override the reverb send (0..1) */ reverb?: number }

interface Voice { id: string; src: AudioBufferSourceNode; gain: GainNode; started: number; nodes: AudioNode[] }

const BUSES: BusName[] = ['sfx', 'weapons', 'ambience', 'ui', 'voice'];
const IR_OPTS = { length: 2.0, rt60: 1.6, streetWidth: 40, preDelay: 0.012, damping: 0.55 };
const SPEED_OF_SOUND = 343;

const WEAPON_FOLEY = new Set(['reload_magout', 'reload_magin', 'reload_rack', 'bolt', 'bolt_close', 'pump', 'pump_fwd', 'shell_insert']);
const KIND_TO_FIRE: Record<WeaponState['kind'], string> = { rifle: 'fire_ar', lmg: 'fire_ar', smg: 'fire_smg', pistol: 'fire_pistol', shotgun: 'fire_shotgun', sniper: 'fire_sniper', launcher: 'fire_shotgun' };

export class AudioEngine implements AudioApi {
  readonly name = 'audio';
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private tinnitusLp!: BiquadFilterNode;
  private comp!: DynamicsCompressorNode;
  private limiter!: DynamicsCompressorNode;
  private clip!: WaveShaperNode;
  private analyser!: AnalyserNode;
  private bus = {} as Record<BusName, GainNode>;
  private busVol = { sfx: 1, weapons: 1, ambience: 1, ui: 1, voice: 1 } as Record<BusName, number>;
  private busReverbIn = {} as Record<BusName, GainNode>;
  private convolver!: ConvolverNode;
  private reverbReturn!: GainNode;
  private masterVol = 1;
  private _muted = false;
  private buffers = new Map<string, AudioBuffer[]>();
  private voices = new Map<string, Voice[]>();
  private loops = new Map<string, Voice>();
  private recent = new Map<string, number[]>();
  private warned = new Set<string>();
  private rng = new Rng(7);
  private altCounter = new Map<string, number>();
  private scheduled: Voice[] = [];
  private prewarm: string[] = [];
  private ir: [Mono, Mono] | null = null;
  private unlocked = false;
  private listenerPos = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();
  private battleTimer = 2;
  private heartbeatOn = false;
  private lowHpLp = 20000;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private offs: (() => void)[] = [];
  /** true while a play() originates from one of our own event handlers */
  private fromEvent = false;
  /** audio-clock time of the last direct (non-event) play per id, to yield to modules that play + emit */
  private externalPlayAt = new Map<string, number>();

  constructor(private engine: Engine) {
    try { this.buildGraph(); } catch (e) { console.warn('[audio] Web Audio unavailable', e); this.ctx = null; }
    this.subscribe();
    const once = () => { this.unlock(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click'] as const) document.addEventListener(ev, once, { once: true, capture: true, passive: true });
    this.prewarm = Object.keys(SOUNDS).sort((a, b) => priority(a) - priority(b));
  }

  // ------------------------------------------------------------------ graph

  private buildGraph(): void {
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) throw new Error('no AudioContext');
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 1;
    this.tinnitusLp = ctx.createBiquadFilter(); this.tinnitusLp.type = 'lowpass'; this.tinnitusLp.frequency.value = 20000; this.tinnitusLp.Q.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 8; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.06;
    this.clip = ctx.createWaveShaper(); this.clip.curve = safetyCurve(); this.clip.oversample = 'none';
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 32768; this.analyser.smoothingTimeConstant = 0;
    this.master.connect(this.tinnitusLp); this.tinnitusLp.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(this.clip); this.clip.connect(this.analyser); this.analyser.connect(ctx.destination);

    this.convolver = ctx.createConvolver(); this.convolver.normalize = true;
    this.reverbReturn = ctx.createGain(); this.reverbReturn.gain.value = 0.55;
    this.convolver.connect(this.reverbReturn); this.reverbReturn.connect(this.master);
    for (const b of BUSES) {
      const g = ctx.createGain(); g.gain.value = 1; g.connect(this.master); this.bus[b] = g;
      const r = ctx.createGain(); r.gain.value = 1; r.connect(this.convolver); this.busReverbIn[b] = r;
    }
    this.ir = impulseResponse(ctx.sampleRate, IR_OPTS, new Rng(seedFor('street_ir')));
    const irBuf = ctx.createBuffer(2, this.ir[0].length, ctx.sampleRate);
    irBuf.copyToChannel(this.ir[0], 0); irBuf.copyToChannel(this.ir[1], 1);
    this.convolver.buffer = irBuf;
    const l = ctx.listener;
    if (l.forwardX) { l.forwardZ.value = -1; l.upY.value = 1; }
  }

  /** Must be called synchronously inside a user gesture (UI calls it on the pointer-lock click). */
  unlock(): void {
    const ctx = this.ctx; if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => { /* retried on next gesture */ });
    if (!this.unlocked) {
      this.unlocked = true;
      // silent kick so iOS/Safari actually opens the output path
      const b = ctx.createBuffer(1, 1, ctx.sampleRate); const s = ctx.createBufferSource(); s.buffer = b; s.connect(this.master); s.start();
      this.startAmbience();
    }
  }

  get muted(): boolean { return this._muted; }
  set muted(v: boolean) { this._muted = v; this.applyMaster(); }
  setMasterVolume(v: number): void { this.masterVol = clamp01(v); this.applyMaster(); }
  setBusVolume(bus: BusName, v: number): void {
    if (!this.ctx || !this.bus[bus]) return;
    this.busVol[bus] = clamp01(v);
    const t = this.ctx.currentTime;
    this.bus[bus].gain.setTargetAtTime(this.busVol[bus], t, 0.02);
    this.busReverbIn[bus].gain.setTargetAtTime(this.busVol[bus], t, 0.02);
  }
  /** Settings UI convenience: sfx covers weapons/sfx/voice/ui, music covers ambience (there is no music yet). */
  setSfxVolume(v: number): void { for (const b of ['sfx', 'weapons', 'voice', 'ui'] as BusName[]) this.setBusVolume(b, v); }
  setMusicVolume(v: number): void { this.setBusVolume('ambience', v); }
  getBusVolume(bus: BusName): number { return this.busVol[bus]; }
  getMasterVolume(): number { return this.masterVol; }
  private applyMaster(): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this._muted ? 0 : this.masterVol, this.ctx.currentTime, 0.02);
  }

  /** Post-limiter analyser (tests tap this). */
  getAnalyser(): AnalyserNode { return this.analyser; }
  ids(): string[] { return Object.keys(SOUNDS); }
  def(id: string): SoundDef | undefined { return SOUNDS[id]; }
  isUnlocked(): boolean { return this.unlocked && this.ctx?.state === 'running'; }

  // ------------------------------------------------------------------ buffers

  private getBuffers(id: string): AudioBuffer[] | null {
    const ctx = this.ctx; if (!ctx) return null;
    let list = this.buffers.get(id);
    if (list) return list;
    const def = SOUNDS[id]; if (!def) return null;
    list = [];
    for (let v = 0; v < def.variants; v++) {
      const data = def.build(ctx.sampleRate, new Rng(seedFor(id, v)));
      const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data, 0);
      list.push(buf);
    }
    this.buffers.set(id, list);
    return list;
  }

  // ------------------------------------------------------------------ playback

  play(id: string, opts: PlayOpts = {}): void {
    const ctx = this.ctx; if (!ctx) return;
    id = ALIASES[id] ?? id;
    const def = SOUNDS[id];
    if (!def) { if (!this.warned.has(id)) { this.warned.add(id); console.warn(`[audio] unknown sound id "${id}"`); } return; }
    if (def.loop) { this.startLoop(id, def, opts); return; }
    const now = ctx.currentTime;
    // Other modules may both play() a sound directly and emit the event we listen to. The direct call wins;
    // our event-driven play yields if the same id was played directly within the last 60 ms.
    if (this.fromEvent) { if (now - (this.externalPlayAt.get(id) ?? -1) < 0.06) return; }
    else {
      this.externalPlayAt.set(id, now);
      // the weapons module drives reload/bolt/pump foley from its animation events: drop our fallback sequence
      if (WEAPON_FOLEY.has(id)) this.cancelScheduled();
    }
    // burst limiter: dedupes double emits (grenade emits + plays) and shotgun pellet impact storms
    const rec = this.recent.get(id) ?? [];
    while (rec.length && now - rec[0] > 0.02) rec.shift();
    if (rec.length >= def.burst) return;
    rec.push(now); this.recent.set(id, rec);

    const bufs = this.getBuffers(id); if (!bufs) return;
    const buf = bufs[Math.floor(this.rng.next() * bufs.length)];

    // polyphony: steal the oldest voice with a 5 ms fade
    let list = this.voices.get(id);
    if (!list) { list = []; this.voices.set(id, list); }
    while (list.length >= def.poly) { const v = list.shift()!; this.stopVoice(v, 0.005); }

    // alternate gain/timing on repeated shots so auto fire never phases into a flat buzz
    const n = (this.altCounter.get(id) ?? 0) + 1; this.altCounter.set(id, n);
    const alt = def.bus === 'weapons' ? (n % 2 ? 1.0 : 0.93) : 1;
    const jitter = def.bus === 'weapons' && def.burst === 1 ? this.rng.next() * 0.003 : 0;
    const pitch = (opts.pitch ?? 1) * (1 + (this.rng.next() * 2 - 1) * def.pitchVar);

    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch;
    const gain = ctx.createGain();
    const nodes: AudioNode[] = [];
    let dist = 0;
    let head: AudioNode = gain;
    src.connect(gain);
    if (opts.position) {
      dist = opts.position.distanceTo(this.listenerPos);
      if (dist > 6) {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
        lp.frequency.value = distanceCutoff(dist);
        head.connect(lp); head = lp; nodes.push(lp);
      }
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1; pan.rolloffFactor = 0; pan.maxDistance = 10000;
      setPannerPos(pan, opts.position, ctx.currentTime);
      head.connect(pan); head = pan; nodes.push(pan);
    }
    head.connect(this.bus[def.bus]);
    const att = opts.position ? def.refDistance / (def.refDistance + dist) : 1;
    gain.gain.value = def.gain * (opts.volume ?? 1) * att * alt;
    // reverb send: farther sources are wetter (the street does more of the work)
    const wet = (opts.reverb ?? def.reverb) * (1 + Math.min(1.5, dist / 30));
    if (wet > 0.001) {
      const send = ctx.createGain(); send.gain.value = wet;
      (opts.position ? head : gain).connect(send); send.connect(this.busReverbIn[def.bus]); nodes.push(send);
    }
    const when = now + (opts.delay ?? 0) + jitter + (def.propagate && opts.position ? dist / SPEED_OF_SOUND : 0);
    const voice: Voice = { id, src, gain, started: when, nodes };
    list.push(voice);
    if ((opts.delay ?? 0) > 0.05) this.scheduled.push(voice);
    src.onended = () => this.release(voice);
    src.start(when);
  }

  private release(v: Voice): void {
    const list = this.voices.get(v.id);
    if (list) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); }
    const si = this.scheduled.indexOf(v); if (si >= 0) this.scheduled.splice(si, 1);
    try { v.src.disconnect(); v.gain.disconnect(); for (const n of v.nodes) n.disconnect(); } catch { /* already gone */ }
  }

  private stopVoice(v: Voice, fade = 0.02): void {
    const ctx = this.ctx!; const t = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.005);
    } catch { /* not started yet */ try { v.src.stop(); } catch { /* ignore */ } }
  }

  /** Cancel not-yet-started scheduled voices (reload sequences, bolt/pump follow-ups). */
  private cancelScheduled(): void {
    const t = this.ctx?.currentTime ?? 0;
    for (const v of this.scheduled.splice(0)) if (v.started > t) { try { v.src.stop(); } catch { /* ignore */ } this.release(v); }
  }

  stop(id: string, fade = 0.3): void {
    const loop = this.loops.get(id);
    if (loop) { this.loops.delete(id); this.stopVoice(loop, fade); return; }
    for (const v of this.voices.get(id) ?? []) this.stopVoice(v, fade);
  }

  private startLoop(id: string, def: SoundDef, opts: PlayOpts): void {
    const ctx = this.ctx!;
    if (this.loops.has(id)) return;
    if (id === 'ambience_distant_battle') { this.loops.set(id, { id, src: ctx.createBufferSource(), gain: ctx.createGain(), started: ctx.currentTime, nodes: [] }); return; }
    const bufs = this.getBuffers(id); if (!bufs) return;
    const src = ctx.createBufferSource(); src.buffer = bufs[0]; src.loop = true;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(gain); gain.connect(this.bus[def.bus]);
    gain.gain.setTargetAtTime(def.gain * (opts.volume ?? 1), ctx.currentTime, 0.4);
    src.start();
    this.loops.set(id, { id, src, gain, started: ctx.currentTime, nodes: [] });
  }

  private startAmbience(): void { this.play('ambience_wind'); this.play('ambience_distant_battle'); }

  // ------------------------------------------------------------------ ducking / tinnitus

  private duckAmbience(amount = 0.35, hold = 0.06, recover = 0.35): void {
    const ctx = this.ctx; if (!ctx) return;
    const g = this.bus.ambience.gain; const t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(this.busVol.ambience * amount, t, 0.006);
    g.setTargetAtTime(this.busVol.ambience, t + hold, recover);
  }

  /** Explosion near the listener: high whine + everything low-passed, recovering over ~2 s. */
  private tinnitus(intensity: number): void {
    const ctx = this.ctx; if (!ctx || intensity <= 0.02) return;
    const t = ctx.currentTime; const k = Math.min(1, intensity);
    const f = this.tinnitusLp.frequency;
    f.cancelScheduledValues(t); f.setValueAtTime(Math.max(this.lowHpLp > 19000 ? 20000 : this.lowHpLp, 1), t);
    f.exponentialRampToValueAtTime(Math.max(300, 20000 * Math.pow(0.03, k)), t + 0.02);
    f.exponentialRampToValueAtTime(20000, t + 2.0 + k);
    const m = this.master.gain;
    m.cancelScheduledValues(t); m.setValueAtTime(m.value, t);
    m.setTargetAtTime((this._muted ? 0 : this.masterVol) * (1 - 0.5 * k), t, 0.01);
    m.setTargetAtTime(this._muted ? 0 : this.masterVol, t + 0.25, 0.5);
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 3900 + 400 * this.rng.next();
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * k, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 + k);
    osc.connect(g); g.connect(this.comp); osc.start(t); osc.stop(t + 2.3 + k);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }

  // ------------------------------------------------------------------ events

  /** play() from an event handler (yields to a direct play of the same id, see play()). */
  private evPlay(id: string, opts?: PlayOpts): void { this.fromEvent = true; try { this.play(id, opts); } finally { this.fromEvent = false; } }

  private subscribe(): void {
    const ev = this.engine.events;
    const on = <K extends keyof GameEvents>(k: K, fn: (p: GameEvents[K]) => void) => this.offs.push(ev.on(k, fn));
    const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

    on('weapon:fire', (p) => {
      const w = this.weaponFor(p.weaponId);
      this.cancelScheduled();
      this.evPlay(this.fireIdFor(p.weaponId, w));
      this.duckAmbience();
      if (w?.fireMode === 'bolt') this.evPlay('bolt', { delay: 0.38 });
      else if (w?.fireMode === 'pump') this.evPlay('pump', { delay: 0.42 });
    });
    on('weapon:reload', (p) => { this.cancelScheduled(); this.reloadSequence(this.weaponFor(p.weaponId)); });
    on('weapon:switch', () => { this.cancelScheduled(); this.evPlay('switch'); });
    on('hit:surface', (p) => this.evPlay(`hit_${p.surface}`, { position: v3(p.point) }));
    on('hit:enemy', (p) => this.evPlay(p.headshot ? 'headshot' : 'hit_flesh', { position: v3(p.point) }));
    on('ui:hitmarker', (p) => { this.evPlay(p.headshot ? 'hitmarker_head' : 'hitmarker'); });
    on('game:kill', () => this.evPlay('kill'));
    on('player:footstep', (p) => this.evPlay(`footstep_${p.surface}`, { volume: clamp(0.45 + p.speed / 8, 0.4, 1.15) }));
    on('player:land', (p) => this.evPlay('land', { volume: clamp(0.4 + p.speed / 9, 0.35, 1.2) }));
    on('player:slide', (p) => { if (p.start) this.evPlay('slide'); else this.stop('slide', 0.12); });
    on('player:damage', (p) => { this.evPlay('player_hurt', { volume: clamp(0.5 + p.amount / 40, 0.5, 1.1) }); });
    on('player:death', () => { this.stop('player_heartbeat', 0.5); this.heartbeatOn = false; });
    on('enemy:fire', (p) => this.enemyFire(p));
    on('enemy:death', (p) => { this.evPlay('enemy_death', { position: v3(p.position) }); });
    on('enemy:spawn', () => { if (this.rng.next() < 0.35) this.evPlay('enemy_callout_contact', { volume: 0.7, delay: 0.3 + this.rng.next() * 0.6 }); });
    on('explosion', (p) => {
      const pos = v3(p.position);
      this.evPlay('explosion', { position: pos });
      const d = pos.distanceTo(this.listenerPos);
      this.tinnitus(1.1 - d / (p.radius * 3.2));
      this.duckAmbience(0.2, 0.4, 1.0);
    });
    on('game:wave', () => { /* GameMode plays wave_start itself; keep the hook for future stingers */ });
    on('game:start', () => this.startAmbience());
  }

  private weaponFor(id: string): WeaponState | undefined {
    const w = this.engine.get<WeaponsApi>('weapons');
    if (!w) return undefined;
    if (w.current?.id === id) return w.current;
    return w.slots?.find((s) => s.id === id) ?? w.current;
  }

  private fireIdFor(id: string, w?: WeaponState): string {
    if (w?.kind && KIND_TO_FIRE[w.kind]) return KIND_TO_FIRE[w.kind];
    const s = id.toLowerCase();
    if (/smg|mp5|mp7|vector|ump/.test(s)) return 'fire_smg';
    if (/pistol|m9|glock|1911|deagle/.test(s)) return 'fire_pistol';
    if (/shot|870|spas|m1014/.test(s)) return 'fire_shotgun';
    if (/snip|l96|awp|intervention|barrett/.test(s)) return 'fire_sniper';
    return 'fire_ar';
  }

  private reloadSequence(w?: WeaponState): void {
    switch (w?.kind) {
      case 'shotgun':
        for (let i = 0; i < 4; i++) this.evPlay('shell_insert', { delay: 0.35 + i * 0.38 });
        this.evPlay('pump', { delay: 0.35 + 4 * 0.38 + 0.1 });
        break;
      case 'sniper':
        this.evPlay('reload_magout', { delay: 0.3 }); this.evPlay('reload_magin', { delay: 1.15 }); this.evPlay('bolt', { delay: 1.7 });
        break;
      case 'pistol':
        this.evPlay('reload_magout', { delay: 0.18 }); this.evPlay('reload_magin', { delay: 0.75 }); this.evPlay('reload_rack', { delay: 1.05 });
        break;
      case 'smg':
        this.evPlay('reload_magout', { delay: 0.22 }); this.evPlay('reload_magin', { delay: 0.9 }); this.evPlay('reload_rack', { delay: 1.25 });
        break;
      default:
        this.evPlay('reload_magout', { delay: 0.28 }); this.evPlay('reload_magin', { delay: 1.05 }); this.evPlay('reload_rack', { delay: 1.5 });
    }
  }

  private enemyFire(p: GameEvents['enemy:fire']): void {
    const origin = this.tmp.set(p.origin[0], p.origin[1], p.origin[2]);
    const d = origin.distanceTo(this.listenerPos);
    const delay = d / SPEED_OF_SOUND;
    this.evPlay('enemy_fire_ak', { position: origin.clone() }); // propagation delay is applied inside play()
    if (p.hitPlayer) return;
    // supersonic crack: closest approach of the bullet path to the listener, arrives before the report
    const dir = this.tmp2.set(p.dir[0], p.dir[1], p.dir[2]).normalize();
    const toL = this.listenerPos.clone().sub(origin);
    const t = toL.dot(dir);
    if (t <= 0) return;
    const closest = origin.clone().addScaledVector(dir, t);
    const miss = closest.distanceTo(this.listenerPos);
    if (miss < 3.5) this.evPlay('whiz', { position: closest, volume: clamp(1.1 - miss / 3.5, 0.3, 1), delay: Math.min(delay, t / 900) });
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number): void {
    const ctx = this.ctx; if (!ctx) return;
    this.prewarmStep();
    if (ctx.state !== 'running') return;
    // listener follows the camera
    const cam = this.engine.camera;
    cam.getWorldPosition(this.listenerPos);
    cam.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = this.listenerPos.x; l.positionY.value = this.listenerPos.y; l.positionZ.value = this.listenerPos.z;
      l.forwardX.value = this.fwd.x; l.forwardY.value = this.fwd.y; l.forwardZ.value = this.fwd.z;
      l.upX.value = this.up.x; l.upY.value = this.up.y; l.upZ.value = this.up.z;
    } else {
      l.setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
    this.distantBattle(dt);
    this.lowHealth();
  }

  private prewarmStep(): void {
    if (!this.prewarm.length) return;
    const t0 = performance.now();
    while (this.prewarm.length && performance.now() - t0 < 3) this.getBuffers(this.prewarm.shift()!);
  }

  /** Random far-off thumps and bursts around the listener while 'ambience_distant_battle' is active. */
  private distantBattle(dt: number): void {
    if (!this.loops.has('ambience_distant_battle')) return;
    this.battleTimer -= dt;
    if (this.battleTimer > 0) return;
    this.battleTimer = 1.5 + this.rng.next() * 5;
    const ang = this.rng.next() * Math.PI * 2; const dist = 150 + this.rng.next() * 300;
    const pos = new THREE.Vector3(this.listenerPos.x + Math.cos(ang) * dist, this.listenerPos.y + 5 + this.rng.next() * 20, this.listenerPos.z + Math.sin(ang) * dist);
    const vol = 0.5 + this.rng.next() * 0.4;
    if (this.rng.next() < 0.35) {
      const n = 3 + Math.floor(this.rng.next() * 5); const gap = 0.085 + this.rng.next() * 0.03;
      for (let i = 0; i < n; i++) this.play('distant_shot', { position: pos, volume: vol * 0.8, delay: i * gap, pitch: 1.1 });
    } else this.play('distant_shot', { position: pos, volume: vol });
  }

  private lowHealth(): void {
    const ctx = this.ctx!;
    const pl = this.engine.get<PlayerApi>('player');
    if (!pl) return;
    const frac = pl.maxHealth > 0 ? pl.health / pl.maxHealth : 1;
    const low = pl.alive && frac < 0.3;
    if (low && !this.heartbeatOn) { this.heartbeatOn = true; this.play('player_heartbeat'); }
    else if (!low && this.heartbeatOn) { this.heartbeatOn = false; this.stop('player_heartbeat', 0.6); }
    if (this.heartbeatOn) { const loop = this.loops.get('player_heartbeat'); if (loop) loop.src.playbackRate.value = 1 + (0.3 - frac) * 1.2; }
    // gentle muffle when nearly dead (only when no tinnitus ramp is active)
    const target = low ? 20000 * Math.pow(0.35, (0.3 - frac) / 0.3) : 20000;
    if (Math.abs(target - this.lowHpLp) > 50) {
      this.lowHpLp = target;
      this.tinnitusLp.frequency.setTargetAtTime(target, ctx.currentTime, 0.4);
    }
  }

  dispose(): void { for (const off of this.offs) off(); void this.ctx?.close(); }

  // ------------------------------------------------------------------ offline render (WAV export for humans + tests)

  /** Render one sound through a dry+street-reverb chain into stereo float arrays (used by the playwright harness). */
  async renderOffline(id: string, opts: { seconds?: number; distance?: number; reverb?: boolean; sampleRate?: number; /** auto-fire: play the sound `repeat` times every `interval` s with the live alternation/pitch jitter */ repeat?: number; interval?: number } = {}): Promise<{ left: Float32Array<ArrayBufferLike>; right: Float32Array<ArrayBufferLike>; sampleRate: number }> {
    const def = SOUNDS[id]; if (!def) throw new Error(`unknown sound ${id}`);
    const sr = opts.sampleRate ?? 48000;
    const repeat = Math.max(1, opts.repeat ?? 1); const interval = opts.interval ?? 0.1;
    const seconds = (opts.seconds ?? Math.min(8, def.length + 2 + (repeat - 1) * interval)) + 0.1;
    const off = new OfflineAudioContext(2, Math.round(seconds * sr), sr);
    const rng = new Rng(11);
    const bufs: AudioBuffer[] = [];
    for (let v = 0; v < (repeat > 1 ? def.variants : 1); v++) { const data = def.build(sr, new Rng(seedFor(id, v))); const b = off.createBuffer(1, data.length, sr); b.copyToChannel(data, 0); bufs.push(b); }
    const g = off.createGain(); g.gain.value = def.gain;
    const sources: AudioBufferSourceNode[] = [];
    for (let i = 0; i < repeat; i++) {
      const src = off.createBufferSource(); src.buffer = bufs[i % bufs.length]; src.loop = !!def.loop;
      src.playbackRate.value = 1 + (repeat > 1 ? (rng.next() * 2 - 1) * def.pitchVar : 0);
      const vg = off.createGain(); vg.gain.value = i % 2 ? 0.93 : 1; src.connect(vg); vg.connect(g);
      sources.push(src);
    }
    let head: AudioNode = g;
    const dist = opts.distance ?? 0;
    if (dist > 6) { const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = distanceCutoff(dist); head.connect(lp); head = lp; g.gain.value *= def.refDistance / (def.refDistance + dist); }
    const comp = off.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
    const lim = off.createDynamicsCompressor(); lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
    const clip = off.createWaveShaper(); clip.curve = safetyCurve();
    comp.connect(lim); lim.connect(clip); clip.connect(off.destination);
    head.connect(comp);
    if (opts.reverb !== false && def.reverb > 0) {
      const ir = impulseResponse(sr, IR_OPTS, new Rng(seedFor('street_ir')));
      const irBuf = off.createBuffer(2, ir[0].length, sr); irBuf.copyToChannel(ir[0], 0); irBuf.copyToChannel(ir[1], 1);
      const conv = off.createConvolver(); conv.normalize = true; conv.buffer = irBuf;
      const send = off.createGain(); send.gain.value = def.reverb * (1 + Math.min(1.5, dist / 30));
      const ret = off.createGain(); ret.gain.value = 0.55;
      head.connect(send); send.connect(conv); conv.connect(ret); ret.connect(comp);
    }
    // Chromium's compressor fades in over the first ~50 ms of a fresh context; give the render a 0.1 s lead so the first transient is not eaten.
    const lead = 0.1;
    sources.forEach((s, i) => s.start(lead + i * interval + (i ? rng.next() * 0.003 : 0)));
    const out = await off.startRendering();
    return { left: out.getChannelData(0), right: out.getChannelData(1), sampleRate: sr };
  }

  /** Same as renderOffline but returns a base64 WAV string for page.evaluate. */
  async renderWavBase64(id: string, opts: Parameters<AudioEngine['renderOffline']>[1] = {}): Promise<string> {
    const r = await this.renderOffline(id, opts);
    const wav = encodeWav([r.left, r.right], r.sampleRate);
    const bytes = new Uint8Array(wav); let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return btoa(s);
  }

  /** Raw mono buffer for a sound id (variant 0) at the live sample rate; for in-page measurements. */
  rawBuffer(id: string, variant = 0): Mono | null {
    const def = SOUNDS[id]; if (!def || !this.ctx) return null;
    return def.build(this.ctx.sampleRate, new Rng(seedFor(id, variant)));
  }
}

// ---------------------------------------------------------------------- helpers

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }

/** Air absorption + occlusion by distance: 18 kHz near, ~3.4 kHz at 40 m, ~1.6 kHz at 100 m. */
export function distanceCutoff(d: number): number { return clamp(18000 * Math.pow(6 / Math.max(6, d), 0.85), 500, 18000); }

function setPannerPos(p: PannerNode, v: THREE.Vector3, t: number): void {
  if (p.positionX) { p.positionX.setValueAtTime(v.x, t); p.positionY.setValueAtTime(v.y, t); p.positionZ.setValueAtTime(v.z, t); }
  else p.setPosition(v.x, v.y, v.z);
}

/** Transparent below 0.8, soft knee into a hard ceiling of 1.0. Final guarantee that nothing exceeds full scale. */
function safetyCurve(): Float32Array<ArrayBuffer> {
  const n = 4096; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; const a = Math.abs(x);
    c[i] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return c;
}

function priority(id: string): number {
  if (id.startsWith('fire_')) return 0;
  if (id.startsWith('hit') || id.startsWith('footstep') || id === 'enemy_fire_ak' || id === 'whiz') return 1;
  if (id.startsWith('reload') || id.startsWith('ambience')) return 2;
  return 3;
}

export type { SurfaceType };
