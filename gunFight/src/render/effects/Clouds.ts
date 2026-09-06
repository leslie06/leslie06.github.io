import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Sky cloud layer, drawn over the (softened) HDRI background on sky pixels only.
 *
 * The HDRI's own clouds are a photograph: uniform value, cut-out edges, no relationship to the sun,
 * and identical at noon and at dusk. This replaces them with a lit layer that actually responds to
 * the sun direction, which is the single thing that makes a game sky read as volume rather than as a
 * pasted image (ref_01, ref_04, ref_10 all have hard sun-lit tops over dark bases).
 *
 * Model - a short march through a slab, not a full raymarch and not a pair of planes:
 *   - `CLOUD_STEPS` samples of a 2D fBm coverage field are taken where the view ray crosses evenly
 *     spaced heights inside the layer. The parallax between them is what gives the layer depth:
 *     looking steeply up you mostly see base, towards the horizon you see the flank and top of the
 *     same cell.
 *   - the coverage **threshold rises with height** (`uProfile`). That one term is what produces a
 *     vertical silhouette: at the base of the slab most of the field passes, near the top only the
 *     densest cores do, so cells get flat bases, domed tops and different heights from each other.
 *     Two planes could not do this - both planes shared one threshold, so a cell had the same
 *     outline at its base and its top and the layer read as soft flat masses.
 *   - alpha is `1 - exp(-gain * mean density)`, so a ray that passes through a full column is opaque
 *     and one that clips a dome edge is not: the silhouette is soft where the cloud is thin and hard
 *     where it is thick, instead of being one smoothstep on a single coverage value.
 *   - self-shadowing is three coverage taps stepped along the sun's horizontal projection, scaled by
 *     the layer thickness / sun elevation, so a thick cell darkens what is behind it in sun-space.
 *   - a forward-scatter lobe adds the silver lining on cloud edges facing the sun.
 * Cost is confined to sky pixels and is texture-free (hash value noise).
 *
 * Runs before the Atmosphere effect in the same pass, so distant clouds get the horizon haze and the
 * sun-shaft mask can see cloud gaps.
 */
const frag = /* glsl */`
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uCoverage;
uniform float uSharpness;
uniform float uAltitude;
uniform float uThickness;
uniform float uScale;
uniform vec2 uWind;
uniform float uOpacity;
uniform float uCirrus;
uniform float uShadow;
uniform float uMaxDist;
uniform float uProfile;
uniform float uGain;
uniform float uDetail;

float cldHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cldNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cldHash(i), b = cldHash(i + vec2(1.0, 0.0));
  float c = cldHash(i + vec2(0.0, 1.0)), d = cldHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float cldFbm5(vec2 p) {
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * cldNoise(p); p = R * p * 2.07; a *= 0.5; }
  return s;
}

float cldFbm3(vec2 p) {
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * cldNoise(p); p = R * p * 2.07; a *= 0.5; }
  return s;
}

float cldCover3(vec2 p, float thr) { return smoothstep(thr, thr + uSharpness, cldFbm3(p) * 1.06); }

/**
 * Soft-clamped slab intersection. Un-clamped, a ray 5 deg above the horizon lands tens of km out and
 * the coverage field is foreshortened into horizontal streaks - the exact "pasted 2D layer" read we
 * are trying to remove. Past uMaxDist the cells stop stretching and just keep their size.
 */
float cldSlabT(float h, float dy) { return uMaxDist * tanh((h - uCamPos.y) / (dy * uMaxDist)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth < 0.99999) { outputColor = inputColor; return; }
  vec4 ndc = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  vec3 dir = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  if (dir.y <= 0.002) { outputColor = inputColor; return; }

  vec2 drift = uWind * time;
  // March the slab. f is the normalised height inside it; the coverage threshold rises with f so
  // the cell narrows towards its top (flat base, domed top, per-cell height variation).
  float dens = 0.0, dBot = 0.0, dTop = 0.0;
  vec2 pTop = vec2(0.0);
  float tBase = cldSlabT(uAltitude, dir.y);
  for (int i = 0; i < CLOUD_STEPS; i++) {
    float f = (float(i) + 0.5) / float(CLOUD_STEPS);
    float t = cldSlabT(uAltitude + uThickness * f, dir.y);
    vec2 p = (uCamPos.xz + dir.xz * t) * uScale + drift;
    // One extra octave of *threshold* noise rather than of coverage: it erodes the outline into
    // billows without softening the interior, which is what stopped the masses reading as cotton
    // wool. Costs one hash-noise tap per step, not a whole fBm.
    float thr = uCoverage + uProfile * f - uDetail * (cldNoise(p * 5.9 + 11.3) - 0.5);
    float d = smoothstep(thr, thr + uSharpness, cldFbm5(p));
    dens += d;
    if (i == 0) dBot = d;
    if (i == CLOUD_STEPS - 1) { dTop = d; pTop = p; }
  }
  dens /= float(CLOUD_STEPS);
  float a = 1.0 - exp(-uGain * dens);

  // Sun-space step: how far the coverage field slides per unit of height travelled towards the sun.
  vec2 sunStep = normalize(uSunDir.xz + vec2(1e-4)) * (uThickness / max(uSunDir.y, 0.22)) * uScale * 0.34;
  float thrTop = uCoverage + uProfile;
  float occ = cldCover3(pTop + sunStep, thrTop) + cldCover3(pTop + sunStep * 2.1, thrTop) * 0.7 + cldCover3(pTop + sunStep * 3.4, thrTop) * 0.42;
  occ = clamp(occ / 2.12, 0.0, 1.0);
  float lit = exp(-uShadow * occ);
  // Where the top of the column carries more cloud than its base, we are looking at a sunlit top;
  // where the base carries more, we are under the cell and it is in its own shadow.
  float topFacing = clamp(dTop - dBot * 0.7, 0.0, 1.0);
  vec3 col = mix(uCloudDark, uCloudLit, clamp(lit * (0.30 + 0.90 * topFacing), 0.0, 1.0));
  float phase = pow(max(dot(dir, uSunDir), 0.0), 10.0);
  col += uSunColor * (phase * 0.55 * (1.0 - occ));

  // Horizon: the slab intersection is already distance-clamped, so the layer does not streak and does
  // not need to be faded out well above the horizon. The old 0.05..0.30 fade cut the deck off in a
  // straight horizontal line a third of the way up the sky, and removed the sky entirely from any
  // pose looking at the horizon (dusk). All that is left is a short fade over the last ~1 deg plus
  // the distance dissolve, which hands the horizon over to the aerial-perspective pass.
  a *= smoothstep(0.006, 0.085, dir.y);
  a *= exp(-tBase * 1.1e-4);
  a *= uOpacity;

  vec3 c = inputColor.rgb;
  if (uCirrus > 0.0) {
    float tC = uMaxDist * 1.8 * tanh((uAltitude * 2.7 - uCamPos.y) / (dir.y * uMaxDist * 1.8));
    vec2 pC = (uCamPos.xz + dir.xz * tC) * (uScale * 0.42) + drift * 1.9;
    float ac = smoothstep(uCoverage + 0.05, uCoverage + 0.36, cldFbm5(pC * vec2(1.0, 0.62)));
    ac *= uCirrus * smoothstep(0.02, 0.20, dir.y) * exp(-tC * 5.0e-5);
    c = mix(c, mix(uCloudDark, uCloudLit, 0.78) + uSunColor * phase * 0.3, ac);
  }
  outputColor = vec4(mix(c, col, a), inputColor.a);
}
`;

export interface CloudParams {
  lit: THREE.Color; dark: THREE.Color; sunColor: THREE.Color; sunDir: THREE.Vector3;
  coverage: number; sharpness: number; altitude: number; thickness: number; scale: number;
  wind: THREE.Vector2; opacity: number; cirrus: number; shadow: number; maxDist: number;
  /** How much the coverage threshold rises from the base of the slab to its top (0 = flat plates). */
  profile: number;
  /** Optical-depth gain: alpha = 1 - exp(-gain * mean density). */
  gain: number;
  /** High-frequency erosion of the coverage threshold: breaks the outline into billows. */
  detail: number;
}

export class CloudsEffect extends Effect {
  constructor(private camera: THREE.PerspectiveCamera, steps = 4) {
    super('CloudsEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: new Map<string, string>([['CLOUD_STEPS', String(Math.max(2, Math.round(steps)))]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uSunColor', new THREE.Uniform(new THREE.Color(1, 0.95, 0.85))],
        ['uCloudLit', new THREE.Uniform(new THREE.Color(1.3, 1.32, 1.36))],
        ['uCloudDark', new THREE.Uniform(new THREE.Color(0.2, 0.24, 0.33))],
        ['uCoverage', new THREE.Uniform(0.52)],
        ['uSharpness', new THREE.Uniform(0.22)],
        ['uAltitude', new THREE.Uniform(900)],
        ['uThickness', new THREE.Uniform(520)],
        ['uScale', new THREE.Uniform(0.00055)],
        ['uWind', new THREE.Uniform(new THREE.Vector2(0.0012, 0.0005))],
        ['uOpacity', new THREE.Uniform(1)],
        ['uCirrus', new THREE.Uniform(0.35)],
        ['uShadow', new THREE.Uniform(2.6)],
        ['uMaxDist', new THREE.Uniform(4200)],
        ['uProfile', new THREE.Uniform(0.10)],
        ['uGain', new THREE.Uniform(3.4)],
        ['uDetail', new THREE.Uniform(0.06)],
      ]),
    });
  }

  set(p: CloudParams): void {
    const u = this.uniforms;
    (u.get('uCloudLit')!.value as THREE.Color).copy(p.lit);
    (u.get('uCloudDark')!.value as THREE.Color).copy(p.dark);
    (u.get('uSunColor')!.value as THREE.Color).copy(p.sunColor);
    (u.get('uSunDir')!.value as THREE.Vector3).copy(p.sunDir);
    (u.get('uWind')!.value as THREE.Vector2).copy(p.wind);
    u.get('uCoverage')!.value = p.coverage; u.get('uSharpness')!.value = p.sharpness;
    u.get('uAltitude')!.value = p.altitude; u.get('uThickness')!.value = p.thickness;
    u.get('uScale')!.value = p.scale; u.get('uOpacity')!.value = p.opacity;
    u.get('uCirrus')!.value = p.cirrus; u.get('uShadow')!.value = p.shadow; u.get('uMaxDist')!.value = p.maxDist;
    u.get('uProfile')!.value = p.profile; u.get('uGain')!.value = p.gain; u.get('uDetail')!.value = p.detail;
  }

  override update(): void {
    const c = this.camera;
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(c.projectionMatrixInverse);
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(c.matrixWorld);
    (this.uniforms.get('uCamPos')!.value as THREE.Vector3).setFromMatrixPosition(c.matrixWorld);
  }
}
