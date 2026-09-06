import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Aerial perspective: exponential height fog integrated analytically along the view ray.
 *
 * The fog colour is the *sky radiance in that direction* (a small blurred equirect copy of the HDRI,
 * built by Sky), not a constant. That is what makes distance read as air: a building 400 m out
 * dissolves into exactly the sky pixel next to its silhouette instead of into a flat grey-blue that
 * disagreed with the sky and drew a hard horizon band. A sun in-scatter lobe is added on top so
 * looking towards the sun warms up while the opposite side stays cool.
 *
 * Before the fog mix, optical depth also desaturates the scene and lifts its blacks towards the haze
 * colour, so the far skyline reads as three haze steps rather than as grey boxes that suddenly fade.
 *
 * Scale height matters more than density: `heightFalloff` k gives a scale height of 1/k metres, and
 * anything taller than ~2/k receives almost no haze. k = 0.045 (22 m) left every roof and tower above
 * 40 m at full contrast; the skyline here reaches ~80 m, so k must be ~0.01 (100 m).
 *
 * Sky pixels (depth == 1) only get a soft horizon softening towards the same blurred sky colour, so
 * there is no value or hue step across the horizon line. Viewmodel pixels (depth < vmDepth) are skipped.
 */
const frag = /* glsl */`
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uFogTint;
uniform vec3 uSunScatter;
uniform float uDensity;
uniform float uHeightFalloff;
uniform float uHeightBase;
uniform float uSunPower;
uniform float uMaxFog;
uniform float uSkyHaze;
uniform float uDesat;
uniform float uLift;
uniform float uVmDepth;
uniform float uVmExposure;
uniform sampler2D uSkyTex;
uniform float uSkyRot;
uniform float uSkyMix;

vec3 atmoWorld(const in vec2 uv, const in float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  return (uCamWorld * vec4(v.xyz, 1.0)).xyz;
}

/** Blurred sky radiance along a world direction. uSkyRot undoes scene.backgroundRotation. */
vec3 atmoSkyRadiance(const in vec3 dir) {
  float c = cos(uSkyRot), s = sin(uSkyRot);
  vec3 d = vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
  vec2 uv = vec2(atan(d.z, d.x) * 0.1591549431 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.3183098862 + 0.5);
  return texture2D(uSkyTex, uv).rgb;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // Viewmodel pixels: no fog (the weapon is 0.3 m away), but they do carry the interior exposure
  // correction. The weapon scene has its own light rig owned by the weapons module, which does not
  // dim when the camera walks into a room - so when PostFx opens the exposure by ~4.5 stops-worth to
  // expose the interior, the weapon would come out as a white cut-out. uVmExposure puts it back on
  // the room's light level (slightly above it: the weapon is the closest thing to the opening).
  if (depth < uVmDepth) { outputColor = vec4(inputColor.rgb * uVmExposure, inputColor.a); return; }
  bool sky = depth >= 0.99999;
  vec3 wp = atmoWorld(uv, min(depth, 0.9999));
  vec3 ray = wp - uCamPos;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  if (sky) { dist = 6000.0; wp = uCamPos + dir * dist; }
  float k = uHeightFalloff;
  float dy = wp.y - uCamPos.y;
  float startDens = uDensity * exp(-k * (uCamPos.y - uHeightBase));
  float integ = abs(k * dy) > 1e-3 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
  float od = startDens * integ * dist;
  float fog = min(1.0 - exp(-od), uMaxFog);
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), uSunPower);
  // Haze colour: the sky in this direction, tinted, so geometry always dissolves into its own backdrop.
  vec3 base = mix(uFogColor, atmoSkyRadiance(dir) * uFogTint, uSkyMix);
  vec3 fogCol = base + uSunScatter * sunAmt;
  if (sky) {
    // The HDRI already is the sky. All that is left is a soft horizon softening towards the same
    // blurred colour the geometry converges to - hue-neutral by construction, so no band can form.
    float band = pow(1.0 - clamp(dir.y * 3.0, 0.0, 1.0), 3.0);
    outputColor = vec4(mix(inputColor.rgb, base + uSunScatter * sunAmt * 0.5, uSkyHaze * band), inputColor.a);
    return;
  }
  // Aerial perspective on geometry: contrast/saturation fall off with optical depth before the fog mix.
  float ap = 1.0 - exp(-od * 1.6);
  vec3 c = inputColor.rgb;
  float l = luminance(c);
  c = mix(c, vec3(l), uDesat * ap);
  c += base * (uLift * ap);
  outputColor = vec4(mix(c, fogCol, fog), inputColor.a);
}
`;

export interface AtmosphereParams {
  sunDir: THREE.Vector3; color: THREE.Color; sunScatter: THREE.Color; density: number; heightFalloff: number;
  base: number; sunPower: number; maxFog: number; skyHaze: number; desaturate?: number; lift?: number;
  /** Blurred equirect of the current sky, its Y rotation, and how much of the haze colour comes from it. */
  skyTex?: THREE.Texture | null; skyRotation?: number; skyMix?: number; fogTint?: THREE.Color;
}

export class AtmosphereEffect extends Effect {
  constructor(private camera: THREE.PerspectiveCamera, vmDepth: number) {
    super('AtmosphereEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uFogColor', new THREE.Uniform(new THREE.Color(0.6, 0.7, 0.8))],
        ['uFogTint', new THREE.Uniform(new THREE.Color(0.96, 0.99, 1.06))],
        ['uSunScatter', new THREE.Uniform(new THREE.Color(0.8, 0.5, 0.3))],
        ['uDensity', new THREE.Uniform(0.0028)],
        ['uHeightFalloff', new THREE.Uniform(0.009)],
        ['uHeightBase', new THREE.Uniform(0)],
        ['uSunPower', new THREE.Uniform(6)],
        ['uMaxFog', new THREE.Uniform(0.97)],
        ['uSkyHaze', new THREE.Uniform(0.35)],
        ['uDesat', new THREE.Uniform(0.45)],
        ['uLift', new THREE.Uniform(0.2)],
        ['uVmDepth', new THREE.Uniform(vmDepth)],
        ['uVmExposure', new THREE.Uniform(1)],
        ['uSkyTex', new THREE.Uniform(null)],
        ['uSkyRot', new THREE.Uniform(0)],
        ['uSkyMix', new THREE.Uniform(0)],
      ]),
    });
  }

  set(p: AtmosphereParams): void {
    const u = this.uniforms;
    (u.get('uSunDir')!.value as THREE.Vector3).copy(p.sunDir);
    (u.get('uFogColor')!.value as THREE.Color).copy(p.color);
    (u.get('uSunScatter')!.value as THREE.Color).copy(p.sunScatter);
    u.get('uDensity')!.value = p.density; u.get('uHeightFalloff')!.value = p.heightFalloff; u.get('uHeightBase')!.value = p.base;
    u.get('uSunPower')!.value = p.sunPower; u.get('uMaxFog')!.value = p.maxFog; u.get('uSkyHaze')!.value = p.skyHaze;
    if (p.desaturate !== undefined) u.get('uDesat')!.value = p.desaturate;
    if (p.lift !== undefined) u.get('uLift')!.value = p.lift;
    if (p.fogTint) (u.get('uFogTint')!.value as THREE.Color).copy(p.fogTint);
    if (p.skyTex !== undefined) {
      u.get('uSkyTex')!.value = p.skyTex;
      // Without a sky texture the shader must fall back to the flat preset colour, or every fogged
      // pixel would sample a null sampler and go black.
      u.get('uSkyMix')!.value = p.skyTex ? (p.skyMix ?? 1) : 0;
    } else if (p.skyMix !== undefined) u.get('uSkyMix')!.value = p.skyMix;
    if (p.skyRotation !== undefined) u.get('uSkyRot')!.value = p.skyRotation;
  }

  /** Compensation applied to viewmodel pixels for the camera's interior exposure adaptation. */
  set viewmodelExposure(v: number) { this.uniforms.get('uVmExposure')!.value = v; }

  /** Density multiplier (1 = preset). */
  set densityScale(v: number) { this.uniforms.get('uDensity')!.value = this.baseDensity * v; }
  private baseDensity = 0.0028;
  setBaseDensity(d: number): void { this.baseDensity = d; this.uniforms.get('uDensity')!.value = d; }

  override update(): void {
    const c = this.camera;
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(c.projectionMatrixInverse);
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(c.matrixWorld);
    (this.uniforms.get('uCamPos')!.value as THREE.Vector3).setFromMatrixPosition(c.matrixWorld);
  }
}
