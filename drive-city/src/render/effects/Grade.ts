import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

/**
 * Colour grade, applied after tone mapping on display-linear values (ported from gunFight):
 * saturation, mid-grey contrast, gain, lifted black floor, shadow/highlight split toning.
 * Values are linear; the sRGB encode happens at the end of the chain, so a lift of 0.005 is roughly
 * a 6% floor on screen.
 */
const frag = /* glsl */`
uniform float uSaturation;
uniform float uContrast;
uniform float uLift;
uniform float uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplitBalance;
uniform float uSplitStrength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  float l = luminance(c);
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.18) * uContrast + 0.18;
  c = max(c, 0.0) * uGain;
  float t = smoothstep(0.0, uSplitBalance, luminance(c));
  vec3 tint = mix(uShadowTint, uHighlightTint, t);
  c *= mix(vec3(1.0), tint, uSplitStrength);
  c = c * (1.0 - uLift) + uLift;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export interface GradeParams {
  saturation: number; contrast: number; lift: number; gain: number;
  shadowTint: THREE.Color; highlightTint: THREE.Color; splitBalance: number; splitStrength: number;
}

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', frag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSaturation', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1.05)],
        ['uLift', new THREE.Uniform(0.004)],
        ['uGain', new THREE.Uniform(1.0)],
        ['uShadowTint', new THREE.Uniform(new THREE.Color(0.95, 0.99, 1.06))],
        ['uHighlightTint', new THREE.Uniform(new THREE.Color(1.06, 1.0, 0.93))],
        ['uSplitBalance', new THREE.Uniform(0.35)],
        ['uSplitStrength', new THREE.Uniform(0.8)],
      ]),
    });
  }

  set(p: Partial<GradeParams>): void {
    const u = this.uniforms;
    if (p.saturation !== undefined) u.get('uSaturation')!.value = p.saturation;
    if (p.contrast !== undefined) u.get('uContrast')!.value = p.contrast;
    if (p.lift !== undefined) u.get('uLift')!.value = p.lift;
    if (p.gain !== undefined) u.get('uGain')!.value = p.gain;
    if (p.shadowTint) (u.get('uShadowTint')!.value as THREE.Color).copy(p.shadowTint);
    if (p.highlightTint) (u.get('uHighlightTint')!.value as THREE.Color).copy(p.highlightTint);
    if (p.splitBalance !== undefined) u.get('uSplitBalance')!.value = p.splitBalance;
    if (p.splitStrength !== undefined) u.get('uSplitStrength')!.value = p.splitStrength;
  }
}
