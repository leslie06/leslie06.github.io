import * as THREE from 'three';
import { monotoneSpline, moonAt, nightFromElevation, sunAt, type SkyBody } from './SunPath';
import { ATMO, skySummary, transmittance, type AtmoInputs } from './Atmo';
import type { GradeParams } from './effects/Grade';
import type { AtmosphereParams } from './effects/Atmosphere';
import type { CloudParams } from './effects/Clouds';

/**
 * The look of a given clock time and weather: every number the renderer needs, derived from the
 * sun path (SunPath) and the physical atmosphere (Atmo) where physics gives a good answer (sun and
 * moon colour, sky colour, haze colour, ambient), and from short curves over sun elevation where it
 * is an artistic call (exposure, how hard the low sun hits, grade, bloom).
 *
 * Everything is keyed on sun elevation, not on the clock, so morning and evening share one grade.
 * Rain blends towards an overcast variant (sun behind cloud, flat grey light, thicker haze, a full
 * cloud deck, stronger city glow on the cloud base at night).
 */

/** Top-of-atmosphere sun illuminance, scene units (the old fixed sun was 3.5). */
export const E_SUN = 5;
/** Moonlight, scene units. ~1/23 of the sun rather than 1/400000: games light the night for the eye. */
export const E_MOON = 0.22;
/** Albedo of the ground seen by the sky (asphalt, grass, roofs). */
const GROUND_ALBEDO = 0.13;

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;
/** out += c * s (THREE.Color has no addScaledVector). */
function mad(out: THREE.Color, c: THREE.Color, s: number): THREE.Color { out.r += c.r * s; out.g += c.g * s; out.b += c.b * s; return out; }

/** A smooth scalar curve over sun elevation (degrees), clamped at both ends. */
function curve(keys: [number, number][]): (el: number) => number {
  const f = monotoneSpline(keys.map((k) => k[0]), keys.map((k) => k[1]));
  const lo = keys[0][0], hi = keys[keys.length - 1][0];
  return (el) => f(Math.max(lo, Math.min(hi, el)));
}

/**
 * Exposure follows the scene's illuminance (key light on the ground + sky), adapting only part of
 * the way (E^-0.72) so dusk and night stay darker than noon, clamped to [0.7, 6.5]: emissives are
 * authored in absolute units, and past ~8 every tail light turns into a flare. This curve is the
 * artistic bias on top (a slightly darker, moodier golden hour).
 */
const EXPOSURE_BIAS = curve([[-20, 1.0], [-4, 1.0], [2, 0.82], [10, 0.86], [25, 1.0]]);
/** Sky gain for the sun below the horizon: twilight is ~1/100 of the day sky; games show it luminous blue. */
const TWILIGHT = curve([[-18, 6], [-9, 10], [-4, 6], [1, 1], [10, 1]]);
/** Moonlit sky gain over the physical moon term (a deep blue night sky rather than black). */
const MOON_SKY = 1.4;
/** Second-order skylight (Atmo `fill`) as a fraction of the single-scattered mean sky + ground. */
const FILL_GAIN = 0.7;
/** Direct-light boost over the physical transmittance: a low sun that still throws hard shadows. */
const SUN_GAIN = curve([[-2, 2.6], [3, 2.8], [8, 2.4], [15, 1.8], [30, 1.25], [62, 1.05]]);
/** Image-based ambient (scene.environmentIntensity). */
/** Image-based ambient (scene.environmentIntensity). Well above physical after sunset: the eye (and GTA) keeps a dusk street readable. */
const ENV_GAIN = curve([[-40, 3.0], [-8, 3.2], [-3, 2.6], [0, 2.0], [8, 1.45], [20, 1.4], [62, 1.35]]);
/** Beijing aerosol optical depth: hazier with the low sun (the evening inversion), clearer at noon. */
const AOD = curve([[-40, 0.2], [-4, 0.2], [5, 0.22], [20, 0.18], [40, 0.14], [62, 0.13]]);

const g = (sat: number, con: number, lift: number, sh: [number, number, number], hi: [number, number, number], bal: number, str: number): GradeParams =>
  ({ saturation: sat, contrast: con, lift, gain: 1, shadowTint: new THREE.Color(...sh), highlightTint: new THREE.Color(...hi), splitBalance: bal, splitStrength: str });
/** Hazy Beijing afternoon: warm highlights, faintly cool shade, a touch of contrast back into the haze. */
const GRADE_DAY = g(1.12, 1.12, 0.003, [0.96, 1.0, 1.06], [1.06, 1.0, 0.93], 0.35, 0.75);
const GRADE_GOLDEN = g(1.16, 1.18, 0.003, [0.9, 0.96, 1.12], [1.12, 1.0, 0.86], 0.3, 0.85);
const GRADE_BLUE = g(1.1, 1.12, 0.003, [0.85, 0.95, 1.2], [1.1, 0.99, 0.88], 0.3, 0.9);
/** Night: blue shade, sodium-orange highlights. */
const GRADE_NIGHT = g(0.92, 1.15, 0.002, [0.86, 0.95, 1.18], [1.14, 0.97, 0.8], 0.25, 0.9);
const GRADE_RAIN = g(0.9, 1.06, 0.004, [0.95, 0.99, 1.06], [1.0, 1.0, 0.98], 0.35, 0.6);

function lerpGrade(out: GradeParams, b: GradeParams, t: number): void {
  if (t <= 0) return;
  out.saturation = lerp(out.saturation, b.saturation, t); out.contrast = lerp(out.contrast, b.contrast, t);
  out.lift = lerp(out.lift, b.lift, t); out.gain = lerp(out.gain, b.gain, t);
  out.shadowTint.lerp(b.shadowTint, t); out.highlightTint.lerp(b.highlightTint, t);
  out.splitBalance = lerp(out.splitBalance, b.splitBalance, t); out.splitStrength = lerp(out.splitStrength, b.splitStrength, t);
}

export interface Look {
  hour: number;
  rain: number;
  sun: SkyBody;
  moon: SkyBody;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** Contract value: 0 day .. 1 night. */
  night: number;
  /** Low-sun warmth, blue-hour and overcast weights (0..1). */
  golden: number;
  blue: number;
  overcast: number;
  /** Inputs of the sky LUT / CPU atmosphere. */
  atmo: AtmoInputs;
  /** Cosine-weighted mean sky radiance and mean horizon radiance (scene units, linear). */
  skyAmbient: THREE.Color;
  horizon: THREE.Color;
  sunT: THREE.Color;
  moonT: THREE.Color;
  /** The shadow-casting light: the sun by day, the moon by night. Direction points towards it. */
  keyDir: THREE.Vector3;
  keyColor: THREE.Color;
  keyIntensity: number;
  keyIsMoon: boolean;
  shadowIntensity: number;
  groundRadiance: THREE.Color;
  envIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  exposure: number;
  fog: AtmosphereParams;
  grade: GradeParams;
  /** Display-referred bloom threshold (divide by exposure for scene units) and strength. */
  bloomThreshold: number;
  bloomIntensity: number;
  clouds: CloudParams;
  sunDisc: THREE.Color;
  moonDisc: THREE.Color;
  stars: number;
  rainColor: THREE.Color;
}

function makeLook(): Look {
  const c = () => new THREE.Color(0, 0, 0);
  const v = () => new THREE.Vector3(0, 1, 0);
  const sun = sunAt(12);
  return {
    hour: 12, rain: 0, sun, moon: moonAt(12), sunDir: v(), moonDir: v(), night: 0, golden: 0, blue: 0, overcast: 0,
    atmo: { sunDir: v(), moonDir: v(), sunE: c(), moonE: c(), aod: 0.3, mieG: 0.78, ms: 0.06, alt: 0.01, lightPollution: c(), airglow: c(), ground: c(), fill: c() },
    skyAmbient: c(), horizon: c(), sunT: c(), moonT: c(),
    keyDir: v(), keyColor: new THREE.Color(1, 1, 1), keyIntensity: 1, keyIsMoon: false, shadowIntensity: 1,
    groundRadiance: c(), envIntensity: 1, hemiSky: c(), hemiGround: c(), exposure: 1,
    fog: { sunDir: v(), color: c(), sunScatter: c(), density: 0.0005, heightFalloff: 0.001, base: 0, sunPower: 8, maxFog: 0.98, skyHaze: 0.15, desaturate: 0.25, lift: 0.05, tint: new THREE.Color(1, 1, 1) },
    grade: g(1, 1, 0, [1, 1, 1], [1, 1, 1], 0.35, 0),
    bloomThreshold: 1.2, bloomIntensity: 0.25,
    clouds: {
      lit: c(), dark: c(), sunColor: c(), sunDir: v(), underGlow: c(),
      coverage: 0.6, sharpness: 0.08, altitude: 1500, thickness: 900, scale: 0.0009, wind: new THREE.Vector2(0.0011, 0.0004),
      opacity: 1, cirrus: 0.15, shadow: 6.6, maxDist: 25000, profile: 0.16, gain: 5.0, detail: 0.075,
    },
    sunDisc: c(), moonDisc: c(), stars: 0, rainColor: c(),
  };
}

export class TimeOfDay {
  readonly look: Look = makeLook();
  private lastSun = new THREE.Vector3(9, 9, 9);
  private lastAod = -1;
  private lastLp = -1;
  private tmp = new THREE.Color();

  /** Recompute the look for `hour` and `rain`. The CPU sky is re-integrated only when it changed. */
  compute(hour: number, rain: number, force = false): Look {
    const L = this.look;
    L.hour = hour; L.rain = rain;
    sunAt(hour, L.sun); moonAt(hour, L.moon);
    L.sunDir.set(L.sun.x, L.sun.y, L.sun.z);
    L.moonDir.set(L.moon.x, L.moon.y, L.moon.z);
    const el = L.sun.elevationDeg;
    L.night = nightFromElevation(el);
    L.golden = smooth(20, 5, el) * smooth(-3, 1, el);
    L.blue = smooth(1, -3, el) * (1 - smooth(-8, -14, el));
    const oc = L.overcast = smooth(0.05, 0.7, rain);
    const night = L.night;

    // --- atmosphere ---
    const a = L.atmo;
    a.sunDir.copy(L.sunDir); a.moonDir.copy(L.moonDir);
    a.aod = AOD(el) + 0.5 * oc;
    a.mieG = lerp(0.76, 0.7, oc);
    // Isotropic multiple-scattering term, in phase-function units (1/4pi = 0.08 is isotropic).
    a.ms = lerp(0.06, 0.14, oc);
    const skyGain = lerp(1, 0.32, oc);
    a.sunE.setScalar(E_SUN * skyGain * TWILIGHT(el));
    const moonUp = smooth(-6, 2, L.moon.elevationDeg) * night;
    a.moonE.setRGB(0.82, 0.9, 1.0).multiplyScalar(E_MOON * MOON_SKY * skyGain * moonUp);
    // Sodium city glow: lives in the haze, so it grows with overcast (cloud base reflects it back).
    a.lightPollution.setRGB(1.0, 0.52, 0.22).multiplyScalar(night * (0.014 + 0.004 * oc));
    // A deep-blue floor, so a moonless or overcast night sky is navy rather than black or brown.
    a.airglow.setRGB(0.0008, 0.0014, 0.0035).multiplyScalar(night);

    // --- key light ---
    transmittance(L.sunDir, a.aod, a.alt, L.sunT);
    transmittance(L.moonDir, a.aod, a.alt, L.moonT);
    const sunMax = Math.max(L.sunT.r, L.sunT.g, L.sunT.b, 1e-6);
    const sunI = E_SUN * SUN_GAIN(el) * sunMax * smooth(-1.5, 1.0, el) * (1 - 0.88 * oc);
    const moonMax = Math.max(L.moonT.r, L.moonT.g, L.moonT.b, 1e-6);
    const moonI = E_MOON * moonMax * smooth(-1, 8, L.moon.elevationDeg) * (1 - 0.85 * oc) * night;
    if (sunI >= moonI) {
      L.keyIsMoon = false; L.keyDir.copy(L.sunDir);
      L.keyColor.copy(L.sunT).multiplyScalar(1 / sunMax);
      L.keyIntensity = sunI;
    } else {
      L.keyIsMoon = true; L.keyDir.copy(L.moonDir);
      // Moonlight reads blue to a dark-adapted eye (Purkinje shift); games paint it that way.
      L.keyColor.copy(L.moonT).multiplyScalar(1 / moonMax).multiply(this.tmp.setRGB(0.72, 0.84, 1.0));
      L.keyIntensity = moonI;
    }
    L.shadowIntensity = lerp(1, 0.3, oc) * (L.keyIsMoon ? 0.85 : 1);

    // --- ground bounce (also what the env capture and the LUT see below the horizon) ---
    const keyIrr = L.keyIntensity * Math.max(L.keyDir.y, 0);
    L.groundRadiance.copy(L.keyColor).multiplyScalar(keyIrr * GROUND_ALBEDO / Math.PI);
    mad(L.groundRadiance, L.skyAmbient, GROUND_ALBEDO);
    mad(L.groundRadiance, a.lightPollution, 0.9);   // street lamps on the road surface
    a.ground.copy(L.groundRadiance);

    // --- CPU sky (19 rays), only when the sun or the air changed ---
    const lp = a.lightPollution.r;
    if (force || this.lastSun.distanceToSquared(L.sunDir) > 1e-6 || Math.abs(this.lastAod - a.aod) > 1e-3 || Math.abs(this.lastLp - lp) > 1e-4) {
      // Two passes: single scattering first, then the skylight fill computed from *that* sky. Feeding
      // the fill from the previous (already filled) sky was a feedback loop: in thick haze every
      // recompute amplified it, and a rainy night came out as bright as an overcast afternoon.
      a.fill.setRGB(0, 0, 0);
      skySummary(a, L.skyAmbient, L.horizon);
      a.fill.copy(L.skyAmbient);
      mad(a.fill, L.groundRadiance, 0.5);
      a.fill.multiplyScalar(0.5 * FILL_GAIN);
      skySummary(a, L.skyAmbient, L.horizon);
      this.lastSun.copy(L.sunDir); this.lastAod = a.aod; this.lastLp = lp;
    }

    // --- ambient ---
    L.envIntensity = ENV_GAIN(el) * lerp(1, 1.15, oc);
    L.hemiSky.copy(L.skyAmbient).multiplyScalar(Math.PI * 0.3);
    L.hemiGround.copy(L.groundRadiance).multiplyScalar(Math.PI * 0.45);
    // Night floor: moonlit blue from above, sodium bounce from below.
    mad(L.hemiSky, this.tmp.setRGB(0.012, 0.018, 0.035), night);
    mad(L.hemiGround, a.lightPollution, 2.5);

    // --- exposure (target; index.ts smooths it) ---
    const skyE = Math.PI * (0.2126 * L.skyAmbient.r + 0.7152 * L.skyAmbient.g + 0.0722 * L.skyAmbient.b);
    const E = L.keyIntensity * Math.max(L.keyDir.y, 0) + skyE + night * 0.02;
    L.exposure = Math.max(0.7, Math.min(6.5, 2.2 * Math.pow(E, -0.72) * EXPOSURE_BIAS(el))) * lerp(1, 0.72, oc);

    // --- aerial perspective ---
    const f = L.fog;
    f.sunDir.copy(L.sunDir);
    // Extinction at the ground from the same aerosol + Rayleigh as the sky, scaled up: the yard's
    // skyline is 2-3 km out and must sit well into the haze. Rain adds its own curtain.
    f.density = ((a.aod / ATMO.HM + 0.0136) / 1000 * 2.4) * (1 + 0.6 * night) + rain * 0.002;
    f.heightFalloff = lerp(1 / (ATMO.HM * 1000), 1 / 700, oc);
    f.maxFog = 0.985;
    f.skyHaze = lerp(0.12, 0.5, oc);
    f.desaturate = lerp(0.22, 0.4, oc);
    f.lift = 0.05;
    f.sunScatter.copy(L.keyColor).multiplyScalar(L.keyIsMoon ? 0 : 0.04 * L.keyIntensity * (1 - oc));
    f.sunPower = 10;
    f.tint.setRGB(1, 1, 1).lerp(this.tmp.setRGB(0.85, 0.93, 1.06), oc);
    f.color.copy(L.horizon);

    // --- grade / bloom ---
    const gr = L.grade;
    lerpGrade(gr, GRADE_DAY, 1);
    lerpGrade(gr, GRADE_GOLDEN, L.golden);
    lerpGrade(gr, GRADE_BLUE, L.blue);
    lerpGrade(gr, GRADE_NIGHT, smooth(0.6, 1, night));
    lerpGrade(gr, GRADE_RAIN, oc * 0.75);
    L.bloomThreshold = lerp(1.3, 0.75, night) - 0.1 * oc;
    L.bloomIntensity = lerp(0.2, 0.5, night) + 0.12 * oc * night;

    // --- clouds ---
    const cl = L.clouds;
    cl.sunDir.copy(L.keyDir);
    mad(cl.lit.copy(L.keyColor).multiplyScalar(L.keyIntensity * (L.keyIsMoon ? 0.15 : 0.3)), L.skyAmbient, lerp(2.2, 1.4, night));
    mad(cl.dark.copy(L.skyAmbient).multiplyScalar(1.2), L.groundRadiance, 0.6);
    cl.sunColor.copy(L.keyColor).multiplyScalar(L.keyIntensity * 0.25);
    cl.underGlow.copy(a.lightPollution).multiplyScalar(2.4);
    cl.coverage = lerp(0.64, 0.12, oc);
    cl.sharpness = lerp(0.08, 0.3, oc);
    cl.gain = lerp(5.0, 7.0, oc);
    cl.cirrus = lerp(0.15, 0, oc);
    cl.altitude = lerp(1500, 900, oc);

    // --- sky bodies ---
    L.sunDisc.copy(L.sunT).multiplyScalar(45 * smooth(-1, 0.5, el) * (1 - 0.97 * oc));
    L.moonDisc.copy(L.moonT).multiplyScalar(0.9 * smooth(-1, 1, L.moon.elevationDeg) * (1 - 0.9 * oc));
    L.stars = smooth(0.85, 1, night) * (1 - oc) * 0.35;

    // --- rain streaks: lit by the sky, the key light and the city ---
    mad(mad(L.rainColor.copy(L.skyAmbient).multiplyScalar(3.2), L.keyColor, L.keyIntensity * 0.08), a.lightPollution, 6);
    return L;
  }
}
