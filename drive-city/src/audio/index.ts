import type { Engine, System } from '../core/Engine';
import type { VehicleApi, WantedApi, RenderApi, PlayerApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { HudApi } from '../game/Contracts';
import { Radio } from './Radio';
import { babble } from './Babble';
import { StreetMusic, type MusicSource } from './StreetMusic';
import { Speech } from './Speech';
import { VoiceClips } from './VoiceClips';
import { lang } from '../core/I18n';
import * as THREE from 'three';

export interface AudioApi extends System {
  /** Must be called synchronously inside a user gesture (the start button). */
  unlock(): void;
  muted: boolean;
  setMuted(m: boolean): void;
  /** The car radio (Radio.ts), once the context exists. */
  radio: Radio | null;
  /** The context, once unlocked (voice/ plays its positional audio in it). */
  readonly context: AudioContext | null;
  /** The master bus (mute applies), once unlocked. */
  readonly output: AudioNode | null;
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
  let windGain: GainNode, hornGain: GainNode, nitroGain: GainNode;
  let nitroWas = false;
  let sirenGain: GainNode, sirenLfo: OscillatorNode, siren2Gain: GainNode, siren2Lfo: OscillatorNode, rotorGain: GainNode, rotorLfo: OscillatorNode;
  let trainGain: GainNode, clackLfo: OscillatorNode, hornT = 0;
  let cityGain: GainNode, passGain: GainNode, humGain: GainNode;
  let radio: Radio | null = null;
  let street: StreetMusic | null = null;
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
    // Keep driving sounds below voices and music, including at full throttle.
    const drivingGain = c.createGain(); drivingGain.gain.value = 0.5; drivingGain.connect(master);
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    street = new StreetMusic(c, master, noiseBuf);

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
    mix.connect(shaper).connect(engineFilter).connect(engineGain).connect(drivingGain);
    for (const o of [o1, o2, o3]) o.start();
    intakeFilter = c.createBiquadFilter(); intakeFilter.type = 'bandpass'; intakeFilter.Q.value = 2.5;
    intakeGain = c.createGain(); intakeGain.gain.value = 0;
    noise(c).connect(intakeFilter).connect(intakeGain).connect(drivingGain);

    // Tyres.
    tyreFilter = c.createBiquadFilter(); tyreFilter.type = 'bandpass'; tyreFilter.frequency.value = 1100; tyreFilter.Q.value = 1.4;
    tyreGain = c.createGain(); tyreGain.gain.value = 0;
    noise(c).connect(tyreFilter).connect(tyreGain).connect(drivingGain);
    squealGain = c.createGain(); squealGain.gain.value = 0;
    s1 = c.createOscillator(); s1.type = 'triangle'; s1.frequency.value = 820;
    s2 = c.createOscillator(); s2.type = 'triangle'; s2.frequency.value = 1090;
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lfoG = c.createGain(); lfoG.gain.value = 18;
    lfo.connect(lfoG); lfoG.connect(s1.frequency); lfoG.connect(s2.frequency);
    s1.connect(squealGain); s2.connect(squealGain); squealGain.connect(drivingGain);
    for (const o of [s1, s2, lfo]) o.start();

    // Wind.
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 520;
    windGain = c.createGain(); windGain.gain.value = 0;
    noise(c).connect(wf).connect(windGain).connect(drivingGain);
    // Nitro: a gas hiss (band-passed noise) with a low roar under it, while it burns.
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1500; nf.Q.value = 0.6;
    const nl = c.createBiquadFilter(); nl.type = 'lowpass'; nl.frequency.value = 180;
    nitroGain = c.createGain(); nitroGain.gain.value = 0;
    noise(c).connect(nf).connect(nitroGain);
    noise(c).connect(nl).connect(nitroGain);
    nitroGain.connect(drivingGain);

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
    // A second siren a little lower and out of step, for when the pack is close: sirens overlapping is the sound of a big chase.
    siren2Gain = c.createGain(); siren2Gain.gain.value = 0;
    const so2 = c.createOscillator(); so2.type = 'sawtooth'; so2.frequency.value = 820;
    siren2Lfo = c.createOscillator(); siren2Lfo.type = 'triangle'; siren2Lfo.frequency.value = 0.41;
    const sweep2 = c.createGain(); sweep2.gain.value = 300;
    siren2Lfo.connect(sweep2).connect(so2.frequency);
    const sbp2 = c.createBiquadFilter(); sbp2.type = 'bandpass'; sbp2.frequency.value = 1000; sbp2.Q.value = 0.7;
    so2.connect(sbp2).connect(siren2Gain).connect(master);
    so2.start(); siren2Lfo.start();
    // Helicopter: low noise chopped by the blade pass (a pulse at ~11 Hz), with a faint turbine whine.
    rotorGain = c.createGain(); rotorGain.gain.value = 0;
    const chop = c.createGain(); chop.gain.value = 0.5;
    rotorLfo = c.createOscillator(); rotorLfo.type = 'square'; rotorLfo.frequency.value = 11;
    const chopDepth = c.createGain(); chopDepth.gain.value = 0.5;
    rotorLfo.connect(chopDepth).connect(chop.gain);
    const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 380; rlp.Q.value = 1.2;
    noise(c).connect(rlp).connect(chop).connect(rotorGain);
    const whine = c.createOscillator(); whine.type = 'sine'; whine.frequency.value = 2350;
    const wg = c.createGain(); wg.gain.value = 0.04;
    whine.connect(wg).connect(rotorGain);
    rotorGain.connect(master);
    rotorLfo.start(); whine.start();
    // Trains (city/visual/Trains.ts): a low rumble, and the wheels' clack over the rail joints - noise
    // gated by a pulse whose rate follows the train's speed (two bogies a 25 m car).
    trainGain = c.createGain(); trainGain.gain.value = 0;
    const trl = c.createBiquadFilter(); trl.type = 'lowpass'; trl.frequency.value = 180; trl.Q.value = 0.8;
    noise(c).connect(trl).connect(trainGain);
    const clack = c.createGain(); clack.gain.value = 0;
    clackLfo = c.createOscillator(); clackLfo.type = 'square'; clackLfo.frequency.value = 2;
    const clackDepth = c.createGain(); clackDepth.gain.value = 0.5;
    clackLfo.connect(clackDepth).connect(clack.gain);
    const cbp = c.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 900; cbp.Q.value = 2.5;
    noise(c).connect(cbp).connect(clack).connect(trainGain);
    trainGain.connect(master);
    clackLfo.start();
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

    // The radio, on its own bus under the master so mute covers it.
    radio = new Radio(c, master, noiseBuf);
    radio.onTrack = (label) => { if (engine.get<PlayerApi>('player')?.mode === 'driving') engine.get<HudApi>('hud')?.toast(label); };
  }

  /** One footstep: a short, soft noise tick (harder when running). */
  function footstep(k: number): void {
    const c = ctx!, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + k * 900;
    const g = c.createGain(); g.gain.setValueAtTime(0.05 + k * 0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(lp).connect(g).connect(master); src.start(t, Math.random() * 1.5, 0.12);
  }

  /** A train's horn: two sawtooth tones a minor third apart (311 / 370 Hz), low-passed, 1.4 s. */
  function trainHorn(k: number): void {
    if (!ctx || muted) return;
    const c = ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * k, t + 0.08);
    g.gain.setValueAtTime(0.09 * k, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    for (const f of [311, 370]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 1.55); }
    lp.connect(g).connect(master);
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

  /** A short band-passed noise burst at `t` (a tick of rattle, a crack, a scrape). */
  function burst(t: number, freq: number, q: number, gain: number, dur: number): void {
    const c = ctx!;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 1.5, dur + 0.02);
  }
  /** A decaying sine partial (metal ringing, a bell, a hollow bin). */
  function ring(t: number, freq: number, gain: number, dur: number, type: OscillatorType = 'sine'): void {
    const c = ctx!;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  /**
   * Street furniture hit by the car (city/Knock.ts): a pair of plastic sorting bins is a hollow
   * bonk and the rubbish rattling out; a shared bike a metal clatter with its bell; a railing a
   * steel clang (inharmonic partials) and a scrape. Louder the faster the car.
   */
  function knock(kind: 'bin' | 'bike' | 'rail', speed: number): void {
    if (!ctx || muted) return;
    const t = ctx.currentTime, k = Math.min(1, 0.35 + speed / 22), r = () => Math.random();
    if (kind === 'bin') {
      burst(t, 700, 0.8, 0.5 * k, 0.12);
      ring(t, 150 + r() * 40, 0.35 * k, 0.22, 'triangle');
      ring(t, 235 + r() * 50, 0.18 * k, 0.16, 'triangle');
      for (let i = 0; i < 5; i++) burst(t + 0.08 + r() * 0.45, 1400 + r() * 2500, 2, 0.12 * k, 0.04 + r() * 0.05);
    } else if (kind === 'bike') {
      burst(t, 2600, 1.2, 0.35 * k, 0.08);
      for (let i = 0; i < 6; i++) burst(t + 0.03 + r() * 0.5, 2500 + r() * 3500, 5, 0.16 * k, 0.03 + r() * 0.04);
      // The bell: two close partials, the second a little late (it swings on its bracket).
      ring(t + 0.02, 2350, 0.08 * k, 0.9); ring(t + 0.02, 3020, 0.045 * k, 0.7);
      ring(t + 0.25 + r() * 0.15, 2350, 0.05 * k, 0.6);
      ring(t, 480 + r() * 60, 0.12 * k, 0.25, 'triangle');
    } else {
      burst(t, 1800, 0.9, 0.45 * k, 0.07);
      for (const [f, a, d] of [[233, 0.2, 0.9], [587, 0.14, 0.7], [1161, 0.09, 0.55], [1893, 0.05, 0.4]] as const) ring(t, f * (0.97 + r() * 0.06), a * k, d);
      burst(t + 0.05, 3200, 1.5, 0.12 * k, 0.35 + speed * 0.01);
    }
  }

  /** Another driver's horn: a lower two-tone burst, quieter with distance. */
  function npcHorn(x: number, z: number): void {
    if (!ctx || muted) return;
    const c = ctx, t0 = c.currentTime, cam = engine.camera.position;
    const d = Math.hypot(x - cam.x, z - cam.z), vol = 0.07 * Math.max(0.15, 1 - d / 60);
    const g = c.createGain(); g.gain.setValueAtTime(0.001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.setValueAtTime(vol, t0 + 0.45); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    for (const fr of [370, 466]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t0); o.stop(t0 + 0.6); }
    f.connect(g).connect(master);
  }
  /** The wanted level rose: one siren whoop over everything. Fell to zero: a soft two-note all-clear. */
  function stinger(up: boolean): void {
    if (!ctx || muted) return;
    const c = ctx, t0 = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0.001, t0); g.gain.exponentialRampToValueAtTime(up ? 0.16 : 0.09, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t0 + (up ? 0.7 : 0.9));
    const o = c.createOscillator(); o.type = up ? 'sawtooth' : 'triangle';
    if (up) { o.frequency.setValueAtTime(520, t0); o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.35); o.frequency.exponentialRampToValueAtTime(600, t0 + 0.7); }
    else { o.frequency.setValueAtTime(660, t0); o.frequency.setValueAtTime(880, t0 + 0.3); }
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8;
    o.connect(f).connect(g).connect(master); o.start(t0); o.stop(t0 + 1);
  }
  /**
   * Someone talking (npc/, dialogue/, a shout from the pavement): Babble.ts, quieter with distance,
   * panned to where they stand; a passenger (x NaN) is in the car, centred. A new line from the same
   * speaker (`id`) fades the old one out.
   */
  const talking = new Map<string, GainNode>();
  const camF = new THREE.Vector3();
  /**
   * Spoken lines: recorded with neural voices (VoiceClips.ts, 2026-10-05) and panned and faded by distance;
   * a line with no recording (English) goes to the device's own speech synthesis (Speech.ts - a dialogue box
   * line cuts in, a shout only when nothing else is being said), and anything else (a second shout at once,
   * no local voice, `?voice=babble`) babbles (Babble.ts), which was all there was until 2026-10-04 and,
   * at a tenth of the knocks' level, read as no voice at all.
   */
  const speech = new Speech();
  const clips = new VoiceClips(`${import.meta.env.BASE_URL}voice/`);
  const babbleOnly = new URLSearchParams(location.search).get('voice') === 'babble';
  engine.events.on('npc:voice', ({ text, voice, x, z, id }) => {
    if (!ctx || muted || engine.paused) return;
    const c = ctx, cam = engine.camera.position;
    const line = id === 'dlg';
    let near = 1, pan = 0;
    if (Number.isFinite(x)) {
      const d = Math.hypot(x - cam.x, z - cam.z);
      if (d > 45) return;
      near = Math.max(0.15, 1 - d / 45);
    }
    if (Number.isFinite(x)) {
      const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
      engine.camera.getWorldDirection(camF);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * -camF.z + dz * camF.x) / d)) * 0.75 : 0;
    }
    if (!babbleOnly && clips.play(c, master, text, voice, lang(), (line ? 1 : 0.35 + 0.65 * near) * 1.2, line ? pan * 0.5 : pan, line)) return;
    if (!babbleOnly && speech.say(text, voice, lang(), line ? 1 : 0.35 + 0.65 * near, line)) return;
    const vol = 0.3 * near;
    const out = c.createGain();
    const panner = c.createStereoPanner(); panner.pan.value = pan;
    out.connect(panner).connect(master);
    if (id) { const old = talking.get(id); if (old) old.gain.setTargetAtTime(0, c.currentTime, 0.03); talking.set(id, out); }
    const end = babble(c, out, noiseBuf, text, voice, vol, c.currentTime + 0.02);
    setTimeout(() => { panner.disconnect(); if (id && talking.get(id) === out) talking.delete(id); }, (end - c.currentTime + 0.4) * 1000);
  });
  engine.events.on('game:pause', ({ paused }) => { if (paused) { speech.stop(); clips.stop(ctx); } });
  engine.events.on('traffic:horn', ({ x, z }) => npcHorn(x, z));
  // A traffic officer's whistle: two sharp trills.
  engine.events.on('life:whistle', ({ x, z }) => {
    if (!ctx || muted) return;
    const c = ctx, t0 = c.currentTime, cam = engine.camera.position, vol = 0.12 * Math.max(0.2, 1 - Math.hypot(x - cam.x, z - cam.z) / 90);
    for (const [s, d] of [[0, 0.22], [0.3, 0.5]]) {
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 2900; lfo.frequency.value = 28; lg.gain.value = 180; lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t0 + s); g.gain.exponentialRampToValueAtTime(vol, t0 + s + 0.02); g.gain.setValueAtTime(vol, t0 + s + d - 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d);
      o.connect(g).connect(master); o.start(t0 + s); lfo.start(t0 + s); o.stop(t0 + s + d + 0.02); lfo.stop(t0 + s + d + 0.02);
    }
  });
  engine.events.on('wanted:level', ({ up }) => stinger(up));
  engine.events.on('vehicle:impact', ({ strength }) => thump(Math.min(1, strength / 12)));
  engine.events.on('prop:hit', ({ kind, speed }) => knock(kind, speed));
  // A 兔儿爷 found: a bright rising three-note chime.
  // A landmark checked in: a camera's shutter (two clicks, the mirror up and down) and a bright chime.
  engine.events.on('checkin', () => {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    burst(t0, 3200, 1.6, 0.45, 0.025); burst(t0 + 0.075, 2200, 1.3, 0.35, 0.035);
    [1319, 1760, 2093].forEach((f, i) => ring(t0 + 0.18 + i * 0.08, f, 0.1, 0.55));
  });
  // Time trials: a beep through each checkpoint, three rising notes at the start and the finish.
  engine.events.on('trial:checkpoint', () => { if (!ctx || muted) return; ring(ctx.currentTime, 1760, 0.12, 0.18, 'square'); });
  engine.events.on('trial:start', () => { if (!ctx || muted) return; const t0 = ctx.currentTime; [880, 880, 1760].forEach((f, i) => ring(t0 + i * 0.12, f, 0.1, 0.12, 'square')); });
  engine.events.on('trial:finish', ({ medal }) => { if (!ctx || muted) return; const t0 = ctx.currentTime; [1047, 1319, 1568, medal >= 2 ? 2093 : 1568].forEach((f, i) => ring(t0 + i * 0.11, f, 0.12, 0.5)); });
  engine.events.on('collect:found', () => { if (!ctx || muted) return; const t0 = ctx.currentTime; [1047, 1319, 1568].forEach((f, i) => ring(t0 + i * 0.09, f, 0.12, 0.6)); });
  // A text message: the two-note phone chime, soft enough to sit under the radio.
  engine.events.on('phone:sms', () => { if (!ctx || muted) return; const t0 = ctx.currentTime; ring(t0, 1568, 0.07, 0.25); ring(t0 + 0.12, 2093, 0.07, 0.35); });
  engine.events.on('vehicle:land', ({ airTime }) => thump(Math.min(0.8, airTime * 0.5), 55));
  engine.events.on('vehicle:shift', () => { shiftDip = 0.14; });

  const api: AudioApi = {
    name: 'audio',
    get muted() { return muted; },
    set muted(m: boolean) { api.setMuted(m); },
    get radio() { return radio; },
    get context() { return ctx; },
    get output() { return ctx ? master : null; },
    setMuted(m) {
      muted = m;
      if (m) { speech.stop(); clips.stop(ctx); }
      try { localStorage.setItem('drivecity.muted', m ? '1' : '0'); } catch { /* ignore */ }
      if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
    },
    unlock() {
      speech.unlock(); clips.prepare();
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
      const driving = v.occupied && engine.get<PlayerApi>('player')?.mode === 'driving';
      if (radio) {
        if (engine.input.state.radioPressed && driving) radio.next();
        radio.update(!!driving, paused);
      }
      // The street's music (life/: a square dance's speaker, a busker, birds), heard where it is.
      if (street) {
        const cam = engine.camera.position;
        engine.camera.getWorldDirection(camF);
        const fl = Math.hypot(camF.x, camF.z) || 1;
        street.update(engine.get<{ name: string; music: readonly MusicSource[] }>('life')?.music ?? [], cam.x, cam.z, camF.x / fl, camF.z / fl, paused);
      }
      // Engine off while the player is out of the car, and a bicycle or an electric scooter has none.
      const off = !v.occupied || car.spec.name === 'bike' || car.spec.name === 'ebike';
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
      const n2o = v.nitroActive && !paused;
      nitroGain.gain.setTargetAtTime(n2o ? 0.2 : 0, t, n2o ? 0.03 : 0.12);
      if (n2o && !nitroWas && !muted) { burst(t, 700, 0.7, 0.4, 0.5); burst(t, 2600, 1.2, 0.15, 0.3); }
      nitroWas = n2o;
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
      const wanted = engine.get<WantedApi>('wanted');
      const sd = wanted?.sirenDistance ?? Infinity;
      sirenGain.gain.setTargetAtTime(paused || !Number.isFinite(sd) ? 0 : 0.11 * Math.pow(Math.max(0, 1 - sd / 260), 1.6), t, 0.12);
      sirenLfo.frequency.setTargetAtTime(sd < 45 ? 3.2 : 0.32, t, 0.3);
      // The second-nearest police car drives the second siren.
      let s2 = Infinity;
      if (wanted && Number.isFinite(sd)) {
        const cam = engine.camera.position;
        for (const pc of wanted.policeCars()) { const d = Math.hypot(pc.pos.x - cam.x, pc.pos.z - cam.z); if (d > sd + 0.5 && d < s2) s2 = d; }
      }
      siren2Gain.gain.setTargetAtTime(paused || !Number.isFinite(s2) ? 0 : 0.08 * Math.pow(Math.max(0, 1 - s2 / 220), 1.6), t, 0.15);
      siren2Lfo.frequency.setTargetAtTime(s2 < 40 ? 2.7 : 0.41, t, 0.3);
      // The nearest train: rumble and clack by distance, and now and then the horn as one comes close.
      const trains = engine.get<System & { nearest(x: number, z: number): { d: number; speed: number; kind: number } }>('trains');
      if (trains) {
        const cam = engine.camera.position, nt = trains.nearest(cam.x, cam.z);
        const k = Number.isFinite(nt.d) ? Math.pow(Math.max(0, 1 - nt.d / 260), 1.8) : 0;
        trainGain.gain.setTargetAtTime(paused ? 0 : 0.16 * k, t, 0.25);
        clackLfo.frequency.setTargetAtTime(Math.max(0.5, nt.speed / 12.5), t, 0.5);
        hornT -= dt;
        if (!paused && nt.d < 90 && nt.kind === 0 && hornT <= 0) { hornT = 25 + Math.random() * 20; trainHorn(Math.max(0.25, 1 - nt.d / 90)); }
      }
      const hd = wanted?.heliDistance ?? Infinity;
      rotorGain.gain.setTargetAtTime(paused || !Number.isFinite(hd) ? 0 : 0.22 * Math.pow(Math.max(0, 1 - hd / 420), 1.4), t, 0.2);
      rotorLfo.frequency.setTargetAtTime(11 + Math.max(0, 1 - hd / 200) * 1.5, t, 0.5);
    },
  };
  engine.add(api);
}
