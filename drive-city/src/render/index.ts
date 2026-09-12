import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { EnvUniforms } from '../game/Contracts';
import { shotMode } from '../debug/ShotMode';
import { TimeOfDay, type Look } from './TimeOfDay';
import { SkyDome } from './SkyDome';
import { Lighting } from './Lighting';
import { Rain } from './Rain';
import { PostFx } from './PostFx';
import type { WetUniforms } from './Wet';
import type { RenderSystem } from './RenderSystem';
import { registerRenderPoses } from './Poses';

export type { RenderApi } from '../game/Contracts';
export type { RenderSystem } from './RenderSystem';

/**
 * Rendering: time of day, sky, sun/moon light and shadows, weather, and the post chain.
 *
 *  - TimeOfDay  clock + rain -> every lighting/grade number (SunPath for where the sun is, Atmo for
 *               what the air does to its light).
 *  - SkyDome    physically based sky-view LUT, the dome (sun, moon, stars), the environment map.
 *  - Lighting   key light (sun by day, moon by night) with CSM or a single stabilised map, hemisphere
 *               fill, and the material scan that adds cascade and wet-surface patches.
 *  - Rain       one-draw-call streaks around the camera.
 *  - PostFx     AO, motion blur, clouds, aerial perspective, shafts, bloom, AgX, grade, SMAA, lens.
 *
 * Other modules read `engine.get<RenderApi>('render')`: `night` (0 day .. 1 night), `wetness`,
 * `sunDir`, `hazeColor`, and the shared `uniforms` ({uNight, uWet, uTime}) to put in their own
 * materials. Materials opt into the wet look with `material.userData.wet = true` (see Wet.ts).
 *
 * URL: `?tod=17.5` fixes the clock (timeScale 0), `?rain=0.8`, `?timescale=N` (in-game hours per
 * real minute; default 0.5 = a day in 48 minutes), `?tm=aces|neutral`, `?nofx=...` (PostFx).
 */
const wrap24 = (h: number) => ((h % 24) + 24) % 24;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const COS_1DEG = Math.cos(THREE.MathUtils.degToRad(1));

class Render implements RenderSystem {
  readonly name = 'render';
  timeOfDay: number;
  timeScale: number;
  rain: number;
  wetness = 0;
  readonly sunDir = new THREE.Vector3();
  readonly hazeColor = new THREE.Color();
  readonly uniforms: EnvUniforms = { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };
  readonly defaultTime: number;
  exposure = 1;
  readonly postfx: PostFx;
  private tod = new TimeOfDay();
  private sky: SkyDome;
  private lighting: Lighting;
  private rainFx: Rain;
  private focus = new THREE.Vector3();
  private wetU: WetUniforms;
  /** Unlit backdrops (skyline) scale with the horizon: current / at build time. */
  private backdrop = { value: new THREE.Color(1, 1, 1) };
  private refHorizon = new THREE.Color();
  private lastHour = NaN;
  private snapAll = true;
  private forceEnv = true;
  private framesSinceEnv = 0;
  /** Inputs the sky LUT was last rendered with / the env map was last captured with. */
  private lutState = new Float64Array(15).fill(NaN);
  private lutNow = new Float64Array(15);
  private envSun = new THREE.Vector3(9, 9, 9);
  private envState = [NaN, NaN, NaN, NaN];

  constructor(private engine: Engine) {
    const p = new URLSearchParams(location.search);
    const num = (k: string) => { const v = p.get(k); return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
    const tod = num('tod'), rain = num('rain'), ts = num('timescale');
    this.defaultTime = tod !== null ? wrap24(tod) : 15;   // 15:00: warm but not into the sun on the westbound spawn
    this.timeOfDay = this.defaultTime;
    this.timeScale = ts !== null ? ts : tod !== null || shotMode ? 0 : 0.5;
    this.rain = rain !== null ? clamp01(rain) : 0;
    this.wetness = this.rain;

    const q = engine.quality;
    this.wetU = { dcWetness: this.uniforms.uWet, dcRain: { value: this.rain }, dcTime: this.uniforms.uTime };
    this.lighting = new Lighting(engine, this.wetU, q.wetRipples, this.backdrop);
    this.sky = new SkyDome(engine.renderer, { lutWidth: q.skyLutSize, viewSteps: q.skySteps, lightSteps: q.tier === 'low' ? 4 : 6, envSize: q.envSize });
    engine.scene.add(this.sky.mesh);
    this.rainFx = new Rain(q.rainStreaks);
    engine.scene.add(this.rainFx.mesh);
    // Aerial perspective is the Atmosphere effect's job; three's fog would haze everything twice.
    engine.scene.fog = null;
    this.postfx = new PostFx(engine, this.sky.lut.texture);

    // First look, sky and environment now: world/ reads hazeColor while it builds, and every
    // material then compiles against a scene.environment that already exists.
    this.updateLook(true);
    this.refHorizon.copy(this.tod.look.horizon);
    this.exposure = this.tod.look.exposure;
    this.sky.setAtmosphere(this.tod.look.atmo);
    this.sky.renderLut();
    this.markLut(this.tod.look);
    engine.scene.environment = this.sky.captureEnv();
    engine.scene.environmentIntensity = this.tod.look.envIntensity;
    this.markEnv(this.tod.look);
  }

  get night(): number { return this.tod.look.night; }
  get look(): Look { return this.tod.look; }
  get bypass(): boolean { return this.postfx.bypass; }
  set bypass(v: boolean) { this.postfx.bypass = v; }

  setFocus(p: THREE.Vector3): void { this.focus.copy(p); }
  prepare(root: THREE.Object3D): void { this.lighting.prepare(root); }
  settle(): void { this.snapAll = true; }

  private updateLook(force: boolean): void {
    const L = this.tod.compute(this.timeOfDay, this.rain, force);
    this.uniforms.uNight.value = L.night;
    this.sunDir.copy(L.sunDir);
    this.hazeColor.copy(L.horizon);
    const b = this.backdrop.value, h = L.horizon, r = this.refHorizon;
    b.setRGB(Math.min(1.5, h.r / Math.max(r.r, 1e-6)), Math.min(1.5, h.g / Math.max(r.g, 1e-6)), Math.min(1.5, h.b / Math.max(r.b, 1e-6)));
  }

  update(dt: number): void {
    if (dt > 0 && this.timeScale !== 0) this.timeOfDay += dt * this.timeScale / 60;
    this.timeOfDay = wrap24(this.timeOfDay);
    this.rain = clamp01(this.rain);
    // Somebody set the clock (a pose, a debug key): exposure and the env map jump with it.
    const dh = Math.abs(this.timeOfDay - this.lastHour);
    const jumped = !(Math.min(dh, 24 - dh) < 0.2);
    this.lastHour = this.timeOfDay;
    // Roads soak through in ~20 s of rain and take ~2.5 min to dry.
    if (this.snapAll) this.wetness = this.rain;
    else if (dt > 0) this.wetness += (this.rain - this.wetness) * (1 - Math.exp(-dt / (this.rain > this.wetness ? 20 : 150)));
    this.updateLook(this.snapAll || jumped);
    const target = this.tod.look.exposure;
    // Exposure adapts in log space over ~1.2 s, like an eye (or an auto-exposing camera).
    if (this.snapAll || jumped) this.exposure = target;
    else if (dt > 0) this.exposure *= Math.exp((Math.log(target) - Math.log(this.exposure)) * (1 - Math.exp(-dt / 1.2)));
    this.uniforms.uWet.value = this.wetness;
    this.uniforms.uTime.value = this.engine.time;
    this.wetU.dcRain.value = this.rain;
    if (this.snapAll || jumped) { this.forceEnv = true; }
    if (this.snapAll) this.rainFx.reset();
    this.snapAll = false;
  }

  /** The LUT's inputs as numbers, into a preallocated array (no per-frame garbage). */
  private lutInputs(L: Look): Float64Array {
    const a = L.atmo, v = this.lutNow;
    v[0] = a.sunDir.x; v[1] = a.sunDir.y; v[2] = a.sunDir.z; v[3] = a.moonDir.x; v[4] = a.moonDir.y; v[5] = a.moonDir.z;
    v[6] = a.aod; v[7] = a.ms; v[8] = a.mieG; v[9] = a.lightPollution.r; v[10] = a.moonE.b; v[11] = a.sunE.r;
    v[12] = a.fill.r + a.fill.g + a.fill.b; v[13] = a.ground.g; v[14] = a.ground.b;
    return v;
  }

  private lutDirty(L: Look): boolean {
    const s = this.lutState, v = this.lutInputs(L);
    for (let i = 0; i < v.length; i++) {
      const tol = i < 6 ? 4e-4 : Math.max(1e-5, Math.abs(v[i]) * 0.01);
      if (!(Math.abs(v[i] - s[i]) <= tol)) return true;
    }
    return false;
  }

  private markLut(L: Look): void { this.lutState.set(this.lutInputs(L)); }

  private envDirty(L: Look): boolean {
    const s = this.envState;
    return this.envSun.dot(L.sunDir) < COS_1DEG || !(Math.abs(L.night - s[0]) < 0.02) || !(Math.abs(L.overcast - s[1]) < 0.02) || !(Math.abs(L.atmo.aod - s[2]) < 0.02) || (L.keyIsMoon ? 1 : 0) !== s[3];
  }

  private markEnv(L: Look): void {
    this.envSun.copy(L.sunDir);
    this.envState[0] = L.night; this.envState[1] = L.overcast; this.envState[2] = L.atmo.aod; this.envState[3] = L.keyIsMoon ? 1 : 0;
    this.forceEnv = false;
    this.framesSinceEnv = 0;
  }

  /** The frame: runs after every system's update, so the camera is final. */
  draw(dt: number): void {
    const e = this.engine, L = this.tod.look;
    this.lighting.setKey(L.keyDir, L.keyColor, L.keyIntensity, L.shadowIntensity, L.keyIsMoon ? 1 : L.overcast);
    this.lighting.setAmbient(L.hemiSky, L.hemiGround);
    this.lighting.beforeRender(this.focus);
    if (this.lutDirty(L)) { this.sky.setAtmosphere(L.atmo); this.sky.renderLut(); this.markLut(L); }
    this.framesSinceEnv++;
    // The env capture (6 faces + PMREM) is the one expensive refresh: only when the sky changed by
    // a visible amount, and at most every 30 frames.
    if (this.forceEnv || (this.framesSinceEnv >= 30 && this.envDirty(L))) {
      e.scene.environment = this.sky.captureEnv();
      this.markEnv(L);
    }
    e.scene.environmentIntensity = L.envIntensity;
    this.sky.setBodies(L.sunDir, L.moonDir, L.sunDisc, L.moonDisc, L.stars, e.time);
    this.sky.follow(e.camera);
    this.rainFx.update(e.camera, dt, this.rain, L.rainColor);
    this.postfx.apply(L, this.exposure, dt);
    this.postfx.render(dt);
  }

  resize(): void { this.postfx.resize(); }

  dispose(): void { this.lighting.dispose(); this.sky.dispose(); }
}

export async function install(engine: Engine): Promise<void> {
  const r = new Render(engine);
  engine.add(r);
  engine.renderFrame = (dt) => r.draw(dt);
  registerRenderPoses(engine);
}
