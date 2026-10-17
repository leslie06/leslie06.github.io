import type { BloomEffect } from 'postprocessing';
import { Effect, BlendFunction } from 'postprocessing';

/**
 * Keeps NaN and Inf out of the post chain.
 *
 * The scene renders into a half-float target, where anything over 65504 is stored as Inf, and one
 * shader dividing by zero writes NaN. A single such pixel is harmless on its own, but the bloom's
 * mip chain averages it into every texel it touches on the way down and back up, and tone mapping
 * turns the result black: a black rectangle a third of the screen wide hanging over the city
 * (2026-10-17, 「游戏玩了十几分钟，屏幕上会出现一个大黑框」; `.scratch/nanbox.mjs` reproduces it
 * with one Inf sphere). NaN becomes black, anything else is clamped to [0, cap].
 */
export const FINITE_GLSL = /* glsl */`
vec3 finiteRgb(vec3 c, float cap) {
  if (any(isnan(c))) return vec3(0.0);
  return clamp(c, 0.0, cap);
}
`;

/** Largest value a pixel keeps in the image (half float's max is 65504). */
export const IMAGE_CAP = '65000.0';
/** Largest value the bloom sees: a lone pixel this bright already blooms white. */
const BLOOM_CAP = '1000.0';

/** First in the scene pass: what the rest of the chain receives is finite. */
export class FiniteEffect extends Effect {
  constructor() {
    super('FiniteEffect', `${FINITE_GLSL}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(finiteRgb(inputColor.rgb, ${IMAGE_CAP}), inputColor.a);
}
`, { blendFunction: BlendFunction.SRC });
  }
}

/** The bloom reads the scene target itself, not the chain's colour: guard its luminance pass too. */
export function guardBloom(bloom: BloomEffect): void {
  const m = bloom.luminanceMaterial;
  const read = 'vec4 texel=texture2D(inputBuffer,vUv);';
  if (!m.fragmentShader.includes(read)) { console.warn('[drive-city] bloom luminance shader changed: NaN guard not applied'); return; }
  m.fragmentShader = m.fragmentShader
    .replace('varying vec2 vUv;', `varying vec2 vUv;${FINITE_GLSL}`)
    .replace(read, `${read}texel.rgb=finiteRgb(texel.rgb, ${BLOOM_CAP});`);
  m.needsUpdate = true;
}
