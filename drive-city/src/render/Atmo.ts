import * as THREE from 'three';
import { SKY_LUT_GLSL } from './glsl';

/**
 * Physically based single-scattering atmosphere (Rayleigh + Mie + ozone, Bruneton/Hillaire
 * constants), in two copies that must stay in step:
 *
 *   - `LUT_FRAG`: the GPU version. Renders the sky-view LUT (render/Sky.ts) that the dome, the
 *     environment capture and the Atmosphere effect's haze colour all sample.
 *   - `skyRadiance` / `transmittance`: a CPU mirror for the handful of numbers lighting needs
 *     synchronously (sun colour, ambient sky colour, horizon haze colour), so shot mode stays
 *     deterministic without GPU readbacks.
 *
 * Units: kilometres for the planet, radiance in scene units (a white Lambert surface under the
 * sun at the zenith with E = 5 reads ~1.3). Beijing's haze is the aerosol optical depth `aod`:
 * 0.05 is a rare blue-sky day, 0.3 an ordinary hazy afternoon, 0.8+ smog or rain.
 *
 * Multiple scattering is approximated by two isotropic terms on top of single scattering: `ms`
 * (sunlight scattered more than once, still carrying the sun's transmittance) and `fill` (the mean
 * sky radiance in-scattered again: along a long horizontal path through haze the radiance then
 * converges to the average sky colour instead of to darkness, which is what removed the dark
 * brown band above the horizon at dawn and dusk).
 */
export const ATMO = {
  Rg: 6360, Rt: 6460,
  betaR: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  ozone: [0.650e-3, 1.881e-3, 0.085e-3] as const,
  // Aerosol scale height. 1.2 km (the textbook value) put all of Beijing's haze in the bottom
  // kilometre, and every horizontal ray at sunset turned into a dark brown band above the trees.
  HR: 8, HM: 2.0,
  /** Fraction of aerosol extinction that is absorption (city smog absorbs; sea haze does not). */
  mieAbsorb: 0.12,
};

export interface AtmoInputs {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** Top-of-atmosphere illuminance of the sun and moon (scene units, rgb). */
  sunE: THREE.Color;
  moonE: THREE.Color;
  aod: number;
  mieG: number;
  ms: number;
  /** Camera altitude (km). */
  alt: number;
  /** Horizon glow from the city's lights (radiance, rgb) and the dark-sky floor. */
  lightPollution: THREE.Color;
  airglow: THREE.Color;
  /** Radiance of the ground, seen by rays that hit it. */
  ground: THREE.Color;
  /** Mean radiance around a point in the air (sky + ground), in-scattered isotropically. */
  fill: THREE.Color;
}

export const mieBeta = (aod: number) => aod / ATMO.HM;

// ---------------------------------------------------------------------------------------------------
// GPU
// ---------------------------------------------------------------------------------------------------

export const LUT_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export const LUT_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunE;
uniform vec3 uMoonE;
uniform float uMieBeta;
uniform float uMieG;
uniform float uMs;
uniform float uAlt;
uniform vec3 uLP;
uniform vec3 uAirglow;
uniform vec3 uGround;
uniform vec3 uFill;
varying vec2 vUv;
#define RG ${ATMO.Rg.toFixed(1)}
#define RT ${ATMO.Rt.toFixed(1)}
#define HR ${ATMO.HR.toFixed(3)}
#define HM ${ATMO.HM.toFixed(3)}
const vec3 BR = vec3(${ATMO.betaR.map((v) => v.toExponential(4)).join(', ')});
const vec3 BO = vec3(${ATMO.ozone.map((v) => v.toExponential(4)).join(', ')});
const float MIE_EXT = ${(1 / (1 - ATMO.mieAbsorb)).toFixed(5)};
${SKY_LUT_GLSL}

float phaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float phaseM(float mu, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
float rayFar(vec3 o, vec3 d, float r) { float b = dot(o, d); float c = dot(o, o) - r * r; float q = b * b - c; return q < 0.0 ? -1.0 : -b + sqrt(q); }
float rayNear(vec3 o, vec3 d, float r) { float b = dot(o, d); float c = dot(o, o) - r * r; float q = b * b - c; return q < 0.0 ? -1.0 : -b - sqrt(q); }

vec3 extinction(float h, out float dR, out float dM) {
  dR = exp(-h / HR); dM = exp(-h / HM);
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  return BR * dR + vec3(uMieBeta * MIE_EXT) * dM + BO * dO;
}

/** Soft earth shadow: 1 when the ray towards the light clears the planet by >4 km, 0 when it is 4 km inside. */
float earthShadow(vec3 p, vec3 s) {
  float b = dot(p, s);
  if (b >= 0.0) return 1.0;
  return smoothstep(RG - 4.0, RG + 4.0, sqrt(max(dot(p, p) - b * b, 0.0)));
}

vec3 transmittanceTo(vec3 p, vec3 s) {
  float lit = earthShadow(p, s);
  if (lit <= 0.0) return vec3(0.0);
  float tt = rayFar(p, s, RT);
  vec3 od = vec3(0.0);
  float dR, dM;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    float a = (float(i) + 0.5) / float(LIGHT_STEPS);
    float dt = tt * (2.0 * float(i) + 1.0) / float(LIGHT_STEPS * LIGHT_STEPS);
    od += extinction(length(p + s * (tt * a * a)) - RG, dR, dM) * dt;
  }
  return exp(-od) * lit;
}

void main() {
  vec3 d = skyLutDir(vUv);
  vec3 o = vec3(0.0, RG + uAlt, 0.0);
  float tg = rayNear(o, d, RG);
  bool ground = tg > 0.0;
  float tmax = ground ? tg : rayFar(o, d, RT);
  float muS = dot(d, uSunDir), muM = dot(d, uMoonDir);
  float pRs = phaseR(muS), pMs = phaseM(muS, uMieG);
  float pRm = phaseR(muM), pMm = phaseM(muM, uMieG);
  bool moon = uMoonE.b > 1e-6;
  vec3 L = vec3(0.0), od = vec3(0.0);
  float dR, dM;
  for (int i = 0; i < VIEW_STEPS; i++) {
    float a = (float(i) + 0.5) / float(VIEW_STEPS);
    float dt = tmax * (2.0 * float(i) + 1.0) / float(VIEW_STEPS * VIEW_STEPS);
    vec3 p = o + d * (tmax * a * a);
    vec3 ext = extinction(length(p) - RG, dR, dM);
    vec3 Tv = exp(-(od + ext * dt * 0.5));
    od += ext * dt;
    vec3 sR = BR * dR;
    vec3 sM = vec3(uMieBeta * dM);
    L += Tv * transmittanceTo(p, uSunDir) * uSunE * (sR * pRs + sM * pMs + (sR + sM) * uMs) * dt;
    // Moon: an eighth of the aerosol forward lobe, or the haze turns the whole night sky into one halo.
    if (moon) L += Tv * transmittanceTo(p, uMoonDir) * uMoonE * (sR * pRm + sM * pMm * 0.12 + (sR + sM) * uMs) * dt;
    L += Tv * (sR + sM) * uFill * dt;
  }
  if (ground) L += exp(-od) * uGround;
  float el = max(asin(clamp(d.y, -1.0, 1.0)), 0.0);
  // City glow: a band hugging the horizon plus a faint wash over the whole dome (Beijing's night
  // sky is orange-grey at the zenith, not black).
  L += uLP * (0.8 * exp(-el * 12.0) + 0.2 * exp(-el * 3.0));
  L += uAirglow;
  gl_FragColor = vec4(L, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------------
// CPU mirror
// ---------------------------------------------------------------------------------------------------

const phaseR = (mu: number) => 0.0596831 * (1 + mu * mu);
function phaseM(mu: number, g: number): number {
  const g2 = g * g;
  return 0.1193662 * (1 - g2) * (1 + mu * mu) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * mu, 1e-4), 1.5));
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Optical depth scratch: [rayleigh, mie, ozone] density integrals. */
const _od = [0, 0, 0];

function density(h: number, out: number[], dt: number): void {
  out[0] += Math.exp(-h / ATMO.HR) * dt;
  out[1] += Math.exp(-h / ATMO.HM) * dt;
  out[2] += Math.max(0, 1 - Math.abs(h - 25) / 15) * dt;
}

/**
 * Transmittance from point (px, py, pz) (km, planet centre at origin) towards unit direction s,
 * including the soft earth shadow. Written into `out`.
 */
function transmittanceFrom(px: number, py: number, pz: number, sx: number, sy: number, sz: number, aod: number, steps: number, out: THREE.Color): THREE.Color {
  const pp = px * px + py * py + pz * pz;
  const b = px * sx + py * sy + pz * sz;
  let lit = 1;
  if (b < 0) lit = smooth(ATMO.Rg - 4, ATMO.Rg + 4, Math.sqrt(Math.max(pp - b * b, 0)));
  if (lit <= 0) return out.setRGB(0, 0, 0);
  const tt = -b + Math.sqrt(Math.max(b * b - (pp - ATMO.Rt * ATMO.Rt), 0));
  _od[0] = _od[1] = _od[2] = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i + 0.5) / steps;
    const t = tt * a * a, dt = tt * (2 * i + 1) / (steps * steps);
    const x = px + sx * t, y = py + sy * t, z = pz + sz * t;
    density(Math.sqrt(x * x + y * y + z * z) - ATMO.Rg, _od, dt);
  }
  const bm = mieBeta(aod) / (1 - ATMO.mieAbsorb);
  return out.setRGB(
    Math.exp(-(ATMO.betaR[0] * _od[0] + bm * _od[1] + ATMO.ozone[0] * _od[2])) * lit,
    Math.exp(-(ATMO.betaR[1] * _od[0] + bm * _od[1] + ATMO.ozone[1] * _od[2])) * lit,
    Math.exp(-(ATMO.betaR[2] * _od[0] + bm * _od[1] + ATMO.ozone[2] * _od[2])) * lit,
  );
}

/** Transmittance from the camera (altitude `alt` km) towards `dir` (e.g. the sun's colour at the ground). */
export function transmittance(dir: THREE.Vector3, aod: number, alt: number, out: THREE.Color, steps = 48): THREE.Color {
  return transmittanceFrom(0, ATMO.Rg + alt, 0, dir.x, dir.y, dir.z, aod, steps, out);
}

const _ts = new THREE.Color(), _tm = new THREE.Color();

/** Sky radiance towards unit `dir` (mirror of LUT_FRAG, coarser). */
export function skyRadiance(dx: number, dy: number, dz: number, a: AtmoInputs, out: THREE.Color, viewSteps = 16, lightSteps = 6): THREE.Color {
  const oy = ATMO.Rg + a.alt;
  const bG = oy * dy, cG = oy * oy - ATMO.Rg * ATMO.Rg, qG = bG * bG - cG;
  const tg = qG < 0 ? -1 : -bG - Math.sqrt(qG);
  const ground = tg > 0;
  const tmax = ground ? tg : -bG + Math.sqrt(Math.max(bG * bG - (oy * oy - ATMO.Rt * ATMO.Rt), 0));
  const s = a.sunDir, m = a.moonDir;
  const muS = dx * s.x + dy * s.y + dz * s.z, muM = dx * m.x + dy * m.y + dz * m.z;
  const pRs = phaseR(muS), pMs = phaseM(muS, a.mieG), pRm = phaseR(muM), pMm = phaseM(muM, a.mieG);
  const moon = a.moonE.b > 1e-6;
  const bm = mieBeta(a.aod), bme = bm / (1 - ATMO.mieAbsorb);
  const [bR0, bR1, bR2] = ATMO.betaR, [bO0, bO1, bO2] = ATMO.ozone;
  let Lr = 0, Lg = 0, Lb = 0, odr = 0, odg = 0, odb = 0;
  for (let i = 0; i < viewSteps; i++) {
    const f = (i + 0.5) / viewSteps;
    const t = tmax * f * f, dt = tmax * (2 * i + 1) / (viewSteps * viewSteps);
    const px = dx * t, py = oy + dy * t, pz = dz * t;
    const h = Math.sqrt(px * px + py * py + pz * pz) - ATMO.Rg;
    const dR = Math.exp(-h / ATMO.HR), dM = Math.exp(-h / ATMO.HM), dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
    const er = bR0 * dR + bme * dM + bO0 * dO, eg = bR1 * dR + bme * dM + bO1 * dO, eb = bR2 * dR + bme * dM + bO2 * dO;
    const tvr = Math.exp(-(odr + er * dt * 0.5)), tvg = Math.exp(-(odg + eg * dt * 0.5)), tvb = Math.exp(-(odb + eb * dt * 0.5));
    odr += er * dt; odg += eg * dt; odb += eb * dt;
    const sM = bm * dM;
    transmittanceFrom(px, py, pz, s.x, s.y, s.z, a.aod, lightSteps, _ts);
    const kr = (bR0 * dR * pRs + sM * pMs + (bR0 * dR + sM) * a.ms) * dt;
    const kg = (bR1 * dR * pRs + sM * pMs + (bR1 * dR + sM) * a.ms) * dt;
    const kb = (bR2 * dR * pRs + sM * pMs + (bR2 * dR + sM) * a.ms) * dt;
    Lr += tvr * _ts.r * a.sunE.r * kr; Lg += tvg * _ts.g * a.sunE.g * kg; Lb += tvb * _ts.b * a.sunE.b * kb;
    if (moon) {
      transmittanceFrom(px, py, pz, m.x, m.y, m.z, a.aod, lightSteps, _tm);
      const jr = (bR0 * dR * pRm + sM * pMm * 0.12 + (bR0 * dR + sM) * a.ms) * dt;
      const jg = (bR1 * dR * pRm + sM * pMm * 0.12 + (bR1 * dR + sM) * a.ms) * dt;
      const jb = (bR2 * dR * pRm + sM * pMm * 0.12 + (bR2 * dR + sM) * a.ms) * dt;
      Lr += tvr * _tm.r * a.moonE.r * jr; Lg += tvg * _tm.g * a.moonE.g * jg; Lb += tvb * _tm.b * a.moonE.b * jb;
    }
    Lr += tvr * (bR0 * dR + sM) * a.fill.r * dt; Lg += tvg * (bR1 * dR + sM) * a.fill.g * dt; Lb += tvb * (bR2 * dR + sM) * a.fill.b * dt;
  }
  if (ground) { Lr += Math.exp(-odr) * a.ground.r; Lg += Math.exp(-odg) * a.ground.g; Lb += Math.exp(-odb) * a.ground.b; }
  const el = Math.max(Math.asin(Math.max(-1, Math.min(1, dy))), 0);
  const lp = 0.8 * Math.exp(-el * 12) + 0.2 * Math.exp(-el * 3);
  return out.setRGB(Lr + a.lightPollution.r * lp + a.airglow.r, Lg + a.lightPollution.g * lp + a.airglow.g, Lb + a.lightPollution.b * lp + a.airglow.b);
}

/**
 * Cosine-weighted mean sky radiance over the upper hemisphere (irradiance / pi), and the mean
 * horizon colour (3 deg up, all round). Three zenith bands of six azimuths: 19 CPU rays.
 */
export function skySummary(a: AtmoInputs, ambient: THREE.Color, horizon: THREE.Color): void {
  const c = new THREE.Color();
  const bands: [number, number][] = [[75, 0.25], [45, 0.5], [15, 0.25]];   // elevation, cosine weight
  ambient.setRGB(0, 0, 0);
  for (const [elDeg, w] of bands) {
    const el = elDeg * Math.PI / 180;
    for (let k = 0; k < 6; k++) {
      const az = (k / 6) * Math.PI * 2;
      skyRadiance(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az), a, c);
      ambient.r += c.r * w / 6; ambient.g += c.g * w / 6; ambient.b += c.b * w / 6;
    }
  }
  horizon.setRGB(0, 0, 0);
  const el = 3 * Math.PI / 180;
  for (let k = 0; k < 6; k++) {
    const az = (k / 6) * Math.PI * 2;
    skyRadiance(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az), a, c);
    horizon.r += c.r / 6; horizon.g += c.g / 6; horizon.b += c.b / 6;
  }
}
