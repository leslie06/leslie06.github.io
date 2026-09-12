import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { SKY_LUT_GLSL } from '../glsl';

/**
 * Aerial perspective: exponential height fog integrated analytically along the view ray (ported
 * from gunFight, viewmodel terms removed).
 *
 * The fog colour is the sky radiance in that direction, read from the sky-view LUT the Sky renders
 * (render/Sky.ts), not a constant: a building 2 km out dissolves into exactly the sky next to its
 * silhouette, at noon, at dusk and at night (where the LUT carries the orange light-pollution band
 * on the horizon). A sun in-scatter lobe on top warms the side facing the sun.
 *
 * Before the fog mix, optical depth also desaturates and lifts the scene towards the haze colour,
 * so far geometry reads as haze steps rather than grey boxes that suddenly fade.
 *
 * Scale height matters more than density: `heightFalloff` k gives a scale height of 1/k metres and
 * anything taller than ~2/k gets almost no haze. The CBD towers are 200-500 m tall, so k ~ 0.004.
 *
 * Sky pixels (depth == 1) only get a soft horizon band towards the same LUT colour.
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
uniform sampler2D uSkyTex;
uniform float uSkyMix;
${SKY_LUT_GLSL}

vec3 atmoWorld(const in vec2 uv, const in float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  return (uCamWorld * vec4(v.xyz, 1.0)).xyz;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  bool sky = depth >= 0.99999;
  vec3 wp = atmoWorld(uv, min(depth, 0.9999));
  vec3 ray = wp - uCamPos;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  if (sky) { dist = 8000.0; wp = uCamPos + dir * dist; }
  float k = uHeightFalloff;
  float dy = wp.y - uCamPos.y;
  float startDens = uDensity * exp(-k * (uCamPos.y - uHeightBase));
  float integ = abs(k * dy) > 1e-3 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
  float od = startDens * integ * dist;
  float fog = min(1.0 - exp(-od), uMaxFog);
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), uSunPower);
  // Haze colour: the sky just above the horizon in this azimuth (the air between us and the object),
  // so geometry always dissolves into its own backdrop.
  vec3 hd = normalize(vec3(dir.x, max(dir.y, 0.035), dir.z));
  vec3 base = mix(uFogColor, texture2D(uSkyTex, skyLutUv(hd)).rgb * uFogTint, uSkyMix);
  vec3 fogCol = base + uSunScatter * sunAmt;
  if (sky) {
    float band = pow(1.0 - clamp(dir.y * 3.0, 0.0, 1.0), 3.0);
    outputColor = vec4(mix(inputColor.rgb, fogCol, uSkyHaze * band), inputColor.a);
    return;
  }
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
  base: number; sunPower: number; maxFog: number; skyHaze: number; desaturate: number; lift: number;
  tint: THREE.Color;
}

export class AtmosphereEffect extends Effect {
  constructor(private camera: THREE.PerspectiveCamera, skyTex: THREE.Texture | null) {
    super('AtmosphereEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uFogColor', new THREE.Uniform(new THREE.Color(0.6, 0.65, 0.7))],
        ['uFogTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['uSunScatter', new THREE.Uniform(new THREE.Color(0, 0, 0))],
        ['uDensity', new THREE.Uniform(0.002)],
        ['uHeightFalloff', new THREE.Uniform(0.004)],
        ['uHeightBase', new THREE.Uniform(0)],
        ['uSunPower', new THREE.Uniform(8)],
        ['uMaxFog', new THREE.Uniform(0.97)],
        ['uSkyHaze', new THREE.Uniform(0.2)],
        ['uDesat', new THREE.Uniform(0.3)],
        ['uLift', new THREE.Uniform(0.1)],
        ['uSkyTex', new THREE.Uniform(skyTex)],
        ['uSkyMix', new THREE.Uniform(skyTex ? 1 : 0)],
      ]),
    });
  }

  set(p: AtmosphereParams): void {
    const u = this.uniforms;
    (u.get('uSunDir')!.value as THREE.Vector3).copy(p.sunDir);
    (u.get('uFogColor')!.value as THREE.Color).copy(p.color);
    (u.get('uSunScatter')!.value as THREE.Color).copy(p.sunScatter);
    (u.get('uFogTint')!.value as THREE.Color).copy(p.tint);
    u.get('uDensity')!.value = p.density; u.get('uHeightFalloff')!.value = p.heightFalloff; u.get('uHeightBase')!.value = p.base;
    u.get('uSunPower')!.value = p.sunPower; u.get('uMaxFog')!.value = p.maxFog; u.get('uSkyHaze')!.value = p.skyHaze;
    u.get('uDesat')!.value = p.desaturate; u.get('uLift')!.value = p.lift;
  }

  override update(): void {
    const c = this.camera;
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(c.projectionMatrixInverse);
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(c.matrixWorld);
    (this.uniforms.get('uCamPos')!.value as THREE.Vector3).setFromMatrixPosition(c.matrixWorld);
  }
}
