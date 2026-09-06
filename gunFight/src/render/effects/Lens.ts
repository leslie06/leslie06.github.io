import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

/**
 * Final "lens" stage, runs on the anti-aliased LDR image in its own pass:
 *   subtle CAS-style sharpening (computed once on luminance, its delta added to every channel),
 *   radial-only chromatic aberration (zero inside r<`uCAOnset`, at most `ca` px at the corner),
 *   vignette (10-15%), damage edge darkening, additive screen flash, luminance-scaled fine grain.
 * One effect so the sampling order is under control (AA -> sharpen -> CA -> vignette -> grain).
 */
const frag = /* glsl */`
uniform float uSharpen;
uniform float uCA;
uniform float uVigOffset;
uniform float uVigDarkness;
uniform float uGrain;
uniform vec3 uFlash;
uniform float uDamage;
uniform vec3 uDamageColor;
uniform float uDamageMax;
uniform float uDamageBoost;
uniform float uCAOnset;
uniform float uDeath;
uniform vec3 uDeathTint;

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
  // Chromatic aberration: purely radial, none in the central 45%, uCA pixels at the corner.
  float caPx = uCA * smoothstep(uCAOnset, 1.22, r);
  vec2 shift = normalize(fc + 1e-5) * vec2(1.0 / aspect, 1.0) * caPx * texelSize.y;
  vec3 mid = texture2D(inputBuffer, uv).rgb;
  vec3 c = caPx > 0.01
    ? vec3(texture2D(inputBuffer, uv + shift).r, mid.g, texture2D(inputBuffer, uv - shift).b)
    : mid;
  // Sharpen once on luminance and add the delta to every channel: 4 taps instead of 4 per channel.
  if (uSharpen > 0.001) {
    vec2 dx = vec2(texelSize.x, 0.0), dy = vec2(0.0, texelSize.y);
    float l0 = luminance(mid);
    float ls = lensCas(l0,
      luminance(texture2D(inputBuffer, uv + dy).rgb), luminance(texture2D(inputBuffer, uv - dy).rgb),
      luminance(texture2D(inputBuffer, uv + dx).rgb), luminance(texture2D(inputBuffer, uv - dx).rgb));
    c += ls - l0;
  }
  float vig = 1.0 - uVigDarkness * smoothstep(uVigOffset, 1.25, r);
  c *= vig;
  // Damage: a red *multiply* on the frame edge, never a hue mix across the image. Mixing towards a
  // dark red from r=0.25 recoloured 60% of the frame (a blue sky went lavender); multiplying by a
  // red-biased tint outside the centre 66% leaves the middle untouched. uDamageBoost pushes the red
  // channel of the multiplier above 1 so the edge reads as a red wash rather than as a grey-red
  // darkening, while green and blue are still crushed - so a blue sky cannot go magenta.
  float dmg = clamp(uDamage, 0.0, 1.0) * smoothstep(0.66, 1.24, r) * uDamageMax;
  c *= mix(vec3(1.0), uDamageColor * uDamageBoost, dmg);
  c += uFlash;
  // Death grade: the frame drains of colour, falls half a stop and closes in from the edges. Driven
  // from PlayerApi.alive, so it ramps back out on respawn without needing an event.
  if (uDeath > 0.0) {
    float dl = luminance(c);
    c = mix(c, vec3(dl), 0.62 * uDeath);
    c = mix(c, c * uDeathTint, uDeath);
    c *= 1.0 - 0.30 * uDeath;
    c *= 1.0 - uDeath * 0.55 * smoothstep(0.30, 1.15, r);
  }
  if (uGrain > 0.0) {
    // Luminance-only grain, triangular distribution, reduced in highlights.
    vec2 seed = uv * resolution + vec2(fract(time * 7.31) * 977.0, fract(time * 3.17) * 613.0);
    float g = (lensHash(seed) + lensHash(seed + 17.0)) - 1.0;
    float gl = luminance(clamp(c, 0.0, 1.0));
    // Scale by absolute luminance, not a floored curve: a 0.3 floor meant 1.8% amplitude was ~11% of
    // the signal in a 0.08-luminance shadow, which is what made the alley and the interior read as static.
    c += g * uGrain * (0.06 + 0.94 * gl) * (1.0 - 0.55 * gl);
  }
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export class LensEffect extends Effect {
  constructor(opts: { sharpen: number; ca: number; grain: number }) {
    super('LensEffect', frag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSharpen', new THREE.Uniform(opts.sharpen)],
        ['uCA', new THREE.Uniform(opts.ca)],
        ['uVigOffset', new THREE.Uniform(0.4)],
        ['uVigDarkness', new THREE.Uniform(0.14)],
        ['uGrain', new THREE.Uniform(opts.grain)],
        ['uFlash', new THREE.Uniform(new THREE.Color(0, 0, 0))],
        ['uDamage', new THREE.Uniform(0)],
        // Multiplier, not a target colour: green/blue are crushed, red survives, so the edge goes dark red.
        ['uDamageColor', new THREE.Uniform(new THREE.Color(0.88, 0.14, 0.11))],
        ['uDamageMax', new THREE.Uniform(0.62)],
        ['uDamageBoost', new THREE.Uniform(1.6)],
        ['uCAOnset', new THREE.Uniform(0.88)],
        ['uDeath', new THREE.Uniform(0)],
        // A multiply, like the damage tint: warm, blood-dark, never a hue mix over the whole frame.
        ['uDeathTint', new THREE.Uniform(new THREE.Color(1.06, 0.84, 0.82))],
      ]),
    });
  }
  get flash(): THREE.Color { return this.uniforms.get('uFlash')!.value as THREE.Color; }
  set damage(v: number) { this.uniforms.get('uDamage')!.value = v; }
  get damage(): number { return this.uniforms.get('uDamage')!.value as number; }
  set vignette(v: { offset?: number; darkness?: number }) {
    if (v.offset !== undefined) this.uniforms.get('uVigOffset')!.value = v.offset;
    if (v.darkness !== undefined) this.uniforms.get('uVigDarkness')!.value = v.darkness;
  }
  /** Chromatic aberration in pixels at the frame corner. */
  set ca(px: number) { this.uniforms.get('uCA')!.value = px; }
  /** Normalised radius (0 centre, ~1.22 corner) where CA starts ramping in. */
  set caOnset(r: number) { this.uniforms.get('uCAOnset')!.value = r; }
  set grain(v: number) { this.uniforms.get('uGrain')!.value = v; }
  /** 0..1 death grade: desaturate, half-stop down, heavy vignette, blood-warm multiply. */
  set death(v: number) { this.uniforms.get('uDeath')!.value = v; }
  get death(): number { return this.uniforms.get('uDeath')!.value as number; }
}
