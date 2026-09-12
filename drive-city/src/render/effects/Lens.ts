import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

/**
 * Final "lens" stage on the anti-aliased LDR image (ported from gunFight without the weapon terms):
 * optional CAS-style sharpen and radial chromatic aberration (both sample the input, compiled in
 * only when enabled so the effect can share a pass with SMAA), vignette, luminance-scaled grain.
 */
const frag = /* glsl */`
uniform float uSharpen;
uniform float uCA;
uniform float uCAOnset;
uniform float uVigOffset;
uniform float uVigDarkness;
uniform float uGrain;

float lensCas(float c, float n, float s, float e, float w) {
  float mn = min(c, min(min(n, s), min(e, w)));
  float mx = max(c, max(max(n, s), max(e, w)));
  float amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  float k = -amp * mix(0.0, 0.2, uSharpen);
  return (c + (n + s + e + w) * k) / (1.0 + 4.0 * k);
}

float lensHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 fc = uv - 0.5;
  fc.x *= aspect;
  float r = length(fc) * 1.2;                     // 0 centre .. ~1.22 corner (16:9)
  vec3 c = inputColor.rgb;
#ifdef LENS_SAMPLES
  float caPx = uCA * smoothstep(uCAOnset, 1.22, r);
  if (caPx > 0.01) {
    vec2 shift = normalize(fc + 1e-5) * vec2(1.0 / aspect, 1.0) * caPx * texelSize.y;
    c = vec3(texture2D(inputBuffer, uv + shift).r, c.g, texture2D(inputBuffer, uv - shift).b);
  }
  if (uSharpen > 0.001) {
    vec2 dx = vec2(texelSize.x, 0.0), dy = vec2(0.0, texelSize.y);
    float l0 = luminance(inputColor.rgb);
    float ls = lensCas(l0,
      luminance(texture2D(inputBuffer, uv + dy).rgb), luminance(texture2D(inputBuffer, uv - dy).rgb),
      luminance(texture2D(inputBuffer, uv + dx).rgb), luminance(texture2D(inputBuffer, uv - dx).rgb));
    c += ls - l0;
  }
#endif
  c *= 1.0 - uVigDarkness * smoothstep(uVigOffset, 1.25, r);
  if (uGrain > 0.0) {
    // Luminance-only triangular grain, scaled by absolute luminance so shadows do not turn to static.
    vec2 seed = uv * resolution + vec2(fract(time * 7.31) * 977.0, fract(time * 3.17) * 613.0);
    float g = (lensHash(seed) + lensHash(seed + 17.0)) - 1.0;
    float gl = luminance(clamp(c, 0.0, 1.0));
    c += g * uGrain * (0.06 + 0.94 * gl) * (1.0 - 0.55 * gl);
  }
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export class LensEffect extends Effect {
  /** True when the effect samples its input (sharpen / CA) and must not share a pass after SMAA. */
  readonly samples: boolean;

  constructor(opts: { sharpen: number; ca: number; grain: number }) {
    const samples = opts.sharpen > 0 || opts.ca > 0;
    super('LensEffect', frag, {
      blendFunction: BlendFunction.SRC,
      defines: samples ? new Map([['LENS_SAMPLES', '1']]) : new Map<string, string>(),
      uniforms: new Map<string, THREE.Uniform>([
        ['uSharpen', new THREE.Uniform(opts.sharpen)],
        ['uCA', new THREE.Uniform(opts.ca)],
        ['uCAOnset', new THREE.Uniform(0.85)],
        ['uVigOffset', new THREE.Uniform(0.42)],
        ['uVigDarkness', new THREE.Uniform(0.16)],
        ['uGrain', new THREE.Uniform(opts.grain)],
      ]),
    });
    this.samples = samples;
  }

  set vignette(v: { offset?: number; darkness?: number }) {
    if (v.offset !== undefined) this.uniforms.get('uVigOffset')!.value = v.offset;
    if (v.darkness !== undefined) this.uniforms.get('uVigDarkness')!.value = v.darkness;
  }
  set grain(v: number) { this.uniforms.get('uGrain')!.value = v; }
}
