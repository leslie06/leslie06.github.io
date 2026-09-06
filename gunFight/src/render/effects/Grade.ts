import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

/**
 * Colour grade, applied after tone mapping on display-linear values:
 * saturation, mid-grey contrast, lifted black floor (~5% in sRGB), shadow/highlight split toning
 * (teal shadows, orange highlights - the CoD lean). All parameters are live uniforms.
 * Note: values here are linear; the final sRGB encode happens at the end of the chain, so a linear lift
 * of 0.005 is roughly a 6% floor on screen.
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

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', frag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSaturation', new THREE.Uniform(0.95)],
        ['uContrast', new THREE.Uniform(1.05)],
        ['uLift', new THREE.Uniform(0.005)],
        ['uGain', new THREE.Uniform(1.0)],
        ['uShadowTint', new THREE.Uniform(new THREE.Color(0.9, 0.98, 1.1))],
        ['uHighlightTint', new THREE.Uniform(new THREE.Color(1.07, 1.0, 0.92))],
        ['uSplitBalance', new THREE.Uniform(0.4)],
        ['uSplitStrength', new THREE.Uniform(1.0)],
      ]),
    });
  }
  set(p: Partial<{ saturation: number; contrast: number; lift: number; gain: number; shadowTint: THREE.Color; highlightTint: THREE.Color; splitBalance: number; splitStrength: number }>): void {
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
