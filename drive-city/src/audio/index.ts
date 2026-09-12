import type { Engine, System } from '../core/Engine';
import type { VehicleApi, WantedApi, RenderApi, PlayerApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';

export interface AudioApi extends System {
  /** Must be called synchronously inside a user gesture (the start button). */
  unlock(): void;
  muted: boolean;
  setMuted(m: boolean): void;
}

/**
 * All sound is synthesised with Web Audio; there are no audio files.
 *
 * Engine: a four-cylinder fires twice per revolution, so the fundamental is rpm/30 Hz (28 Hz at
 * idle, 220 Hz at the limiter). Three oscillators on that fundamental through a soft clipper and a
 * throttle-opened low-pass give the note; band-passed noise on top is the intake. Tyres are
 * band-passed noise plus two detuned sines for the squeal, both scaled by how hard the tyres slide.
 */
export async function install(engine: Engine): Promise<void> {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let engineGain: GainNode, engineFilter: BiquadFilterNode, o1: OscillatorNode, o2: OscillatorNode, o3: OscillatorNode, intakeFilter: BiquadFilterNode, intakeGain: GainNode;
  let tyreGain: GainNode, tyreFilter: BiquadFilterNode, squealGain: GainNode, s1: OscillatorNode, s2: OscillatorNode;
  let windGain: GainNode, hornGain: GainNode;
  let sirenGain: GainNode, sirenLfo: OscillatorNode;
  let cityGain: GainNode, passGain: GainNode, humGain: GainNode;
  let stepDist = 0;
  let noiseBuf: AudioBuffer;
  let shiftDip = 0;
  let muted = false;
  try { muted = localStorage.getItem('drivecity.muted') === '1'; } catch { /* ignore */ }

  const noise = (c: AudioContext) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuf; src.loop = true; src.start();
    return src;
  };

  function build(c: AudioContext): void {
    master = c.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(c.destination);
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Engine.
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    engineFilter = c.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.Q.value = 0.9;
    engineGain = c.createGain(); engineGain.gain.value = 0;
    const mix = c.createGain(); mix.gain.value = 0.5;
    o1 = c.createOscillator(); o1.type = 'sawtooth';
    o2 = c.createOscillator(); o2.type = 'square';
    o3 = c.createOscillator(); o3.type = 'sawtooth'; o3.detune.value = 8;
    const g1 = c.createGain(); g1.gain.value = 0.55; const g2 = c.createGain(); g2.gain.value = 0.35; const g3 = c.createGain(); g3.gain.value = 0.2;
    o1.connect(g1).connect(mix); o2.connect(g2).connect(mix); o3.connect(g3).connect(mix);
    mix.connect(shaper).connect(engineFilter).connect(engineGain).connect(master);
    for (const o of [o1, o2, o3]) o.start();
    intakeFilter = c.createBiquadFilter(); intakeFilter.type = 'bandpass'; intakeFilter.Q.value = 2.5;
    intakeGain = c.createGain(); intakeGain.gain.value = 0;
    noise(c).connect(intakeFilter).connect(intakeGain).connect(master);

    // Tyres.
    tyreFilter = c.createBiquadFilter(); tyreFilter.type = 'bandpass'; tyreFilter.frequency.value = 1100; tyreFilter.Q.value = 1.4;
    tyreGain = c.createGain(); tyreGain.gain.value = 0;
    noise(c).connect(tyreFilter).connect(tyreGain).connect(master);
    squealGain = c.createGain(); squealGain.gain.value = 0;
    s1 = c.createOscillator(); s1.type = 'triangle'; s1.frequency.value = 820;
    s2 = c.createOscillator(); s2.type = 'triangle'; s2.frequency.value = 1090;
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lfoG = c.createGain(); lfoG.gain.value = 18;
    lfo.connect(lfoG); lfoG.connect(s1.frequency); lfoG.connect(s2.frequency);
    s1.connect(squealGain); s2.connect(squealGain); squealGain.connect(master);
    for (const o of [s1, s2, lfo]) o.start();

    // Wind.
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 520;
    windGain = c.createGain(); windGain.gain.value = 0;
    noise(c).connect(wf).connect(windGain).connect(master);

    // Horn: the flat two-tone of a Chinese saloon.
    hornGain = c.createGain(); hornGain.gain.value = 0;
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 2600;
    for (const f of [415, 520]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hf); o.start(); }
    hf.connect(hornGain).connect(master);
    // Siren: a sawtooth swept by a slow triangle (wail) or a fast one (yelp), band-passed.
    sirenGain = c.createGain(); sirenGain.gain.value = 0;
    const so = c.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 930;
    sirenLfo = c.createOscillator(); sirenLfo.type = 'triangle'; sirenLfo.frequency.value = 0.32;
    const sweep = c.createGain(); sweep.gain.value = 340;
    sirenLfo.connect(sweep).connect(so.frequency);
    const sbp = c.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 1150; sbp.Q.value = 0.7;
    so.connect(sbp).connect(sirenGain).connect(master);
    so.start(); sirenLfo.start();
    // City: a low rumble bed, a whoosh from cars passing close, the hum of their engines.
    cityGain = c.createGain(); cityGain.gain.value = 0;
    const cf = c.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 320;
    noise(c).connect(cf).connect(cityGain).connect(master);
    passGain = c.createGain(); passGain.gain.value = 0;
    const pf = c.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 700; pf.Q.value = 0.6;
    noise(c).connect(pf).connect(passGain).connect(master);
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 62;
    humGain = c.createGain(); humGain.gain.value = 0;
    const hlp = c.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 240;
    hum.connect(hlp).connect(humGain).connect(master); hum.start();
  }

  /** One footstep: a short, soft noise tick (harder when running). */
  function footstep(k: number): void {
    const c = ctx!, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + k * 900;
    const g = c.createGain(); g.gain.setValueAtTime(0.05 + k * 0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(lp).connect(g).connect(master); src.start(t, Math.random() * 1.5, 0.12);
  }

  function thump(strength: number, freq = 70): void {
    if (!ctx || muted) return;
    const c = ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + strength * 1400;
    const g = c.createGain();
    const a = Math.min(0.9, 0.15 + strength * 0.6);
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + strength * 0.2);
    src.connect(lp).connect(g).connect(master);
    src.start(t, Math.random()); src.stop(t + 0.6);
    const o = c.createOscillator(); o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.3);
    const og = c.createGain(); og.gain.setValueAtTime(a * 0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og).connect(master); o.start(t); o.stop(t + 0.4);
  }

  engine.events.on('vehicle:impact', ({ strength }) => thump(Math.min(1, strength / 12)));
  engine.events.on('vehicle:land', ({ airTime }) => thump(Math.min(0.8, airTime * 0.5), 55));
  engine.events.on('vehicle:shift', () => { shiftDip = 0.14; });

  const api: AudioApi = {
    name: 'audio',
    get muted() { return muted; },
    set muted(m: boolean) { api.setMuted(m); },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('drivecity.muted', m ? '1' : '0'); } catch { /* ignore */ }
      if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
    },
    unlock() {
      if (ctx) { void ctx.resume(); return; }
      try {
        ctx = new AudioContext();
        build(ctx);
        void ctx.resume();
      } catch (e) { console.warn('[audio] unavailable', e); ctx = null; }
    },
    update(dt) {
      const v = engine.get<VehicleApi>('vehicle');
      if (!ctx || !v) return;
      const c = ctx, t = c.currentTime, car = v.car;
      if (engine.input.state.mutePressed) api.setMuted(!muted);
      const paused = engine.paused;
      // Engine off while the player is out of the car.
      const off = !v.occupied;
      const rpm = off ? 0 : car.rpm, thr = paused || off ? 0 : v.controls.throttle;
      const f = rpm / 30;
      shiftDip = Math.max(0, shiftDip - dt);
      const tc = 0.03;
      o1.frequency.setTargetAtTime(f, t, tc); o2.frequency.setTargetAtTime(f * 0.5, t, tc); o3.frequency.setTargetAtTime(f * 2, t, tc);
      const rn = (rpm - 850) / 6000;
      engineFilter.frequency.setTargetAtTime(260 + rn * 2200 + thr * 1600, t, 0.05);
      const eg = off ? 0 : paused ? 0.05 : (0.16 + thr * 0.22 + rn * 0.1) * (shiftDip > 0 ? 0.45 : 1);
      engineGain.gain.setTargetAtTime(eg, t, 0.04);
      intakeFilter.frequency.setTargetAtTime(f * 4, t, 0.05);
      intakeGain.gain.setTargetAtTime(paused ? 0 : thr * 0.05 * (0.3 + rn), t, 0.05);
      let skid = 0;
      for (const w of car.wheels) skid = Math.max(skid, w.skid);
      const sf = Math.min(1, car.speed / 8);
      tyreGain.gain.setTargetAtTime(paused ? 0 : skid * 0.22 * sf, t, 0.05);
      squealGain.gain.setTargetAtTime(paused ? 0 : skid * skid * 0.05 * sf, t, 0.06);
      tyreFilter.frequency.setTargetAtTime(700 + car.speed * 25, t, 0.1);
      windGain.gain.setTargetAtTime(paused ? 0 : Math.min(0.2, car.speed * car.speed / 9000), t, 0.2);
      hornGain.gain.setTargetAtTime(!paused && v.inputEnabled && engine.input.state.horn ? 0.09 : 0, t, 0.015);
      // City ambience (quieter at night), cars passing close, footsteps on foot.
      const traffic = engine.get<TrafficApi>('traffic');
      let pass = 0, near = 0;
      if (traffic) {
        const cam = engine.camera.position;
        for (const oc of traffic.cars()) {
          const d = Math.hypot(oc.pos.x - cam.x, oc.pos.z - cam.z);
          if (d < 40) { pass += oc.speed / (d + 4); near += 1 / (d + 6); }
        }
      }
      const night = engine.get<RenderApi>('render')?.night ?? 0;
      cityGain.gain.setTargetAtTime(paused || !traffic ? 0 : 0.035 * (1 - 0.5 * night), t, 0.5);
      passGain.gain.setTargetAtTime(paused ? 0 : Math.min(0.09, pass * 0.02), t, 0.15);
      humGain.gain.setTargetAtTime(paused ? 0 : Math.min(0.05, near * 0.12), t, 0.2);
      const foot = engine.get<PlayerApi>('player')?.foot;
      if (foot && !paused) {
        const sp = Math.hypot(foot.vel.x, foot.vel.z);
        stepDist += sp * dt;
        if (sp > 0.4 && stepDist > (sp > 4.5 ? 1.25 : sp > 2.5 ? 1.0 : 0.72)) { stepDist = 0; footstep(Math.min(1, sp / 6)); }
      }
      // Siren: louder as the nearest police car comes closer; wail far away, yelp up close.
      const sd = engine.get<WantedApi>('wanted')?.sirenDistance ?? Infinity;
      sirenGain.gain.setTargetAtTime(paused || !Number.isFinite(sd) ? 0 : 0.11 * Math.pow(Math.max(0, 1 - sd / 260), 1.6), t, 0.12);
      sirenLfo.frequency.setTargetAtTime(sd < 45 ? 3.2 : 0.32, t, 0.3);
    },
  };
  engine.add(api);
}
