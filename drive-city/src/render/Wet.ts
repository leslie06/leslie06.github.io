import type * as THREE from 'three';

/**
 * Wet surfaces, for any MeshStandardMaterial / MeshPhysicalMaterial that opts in:
 *
 *   material.userData.wet = 'ground'    // roads, pavements, concrete, paint: darkens a lot, puddles
 *   material.userData.wet = true        // anything else that gets rained on (people, cloth, wood,
 *                                       // walls): damp and a little glossier, no puddles
 *   material.userData.wet = 'surface'   // sealed: car paint, glass, metal, signs - glossy, barely darker
 *
 * Driven by the shared `uniforms.uWet` (RenderApi.wetness, which follows rain with a lag and dries
 * slowly), so a dry material costs one uniform test. When wet:
 *   - albedo darkens (water fills the pores: ground to ~45%, damp to ~70%, sealed to ~92%);
 *   - roughness drops towards a water film, less on vertical faces (they shed water);
 *   - 'ground' only: puddles from world-space noise on up-facing surfaces, growing with wetness -
 *     mirror-flat (roughness 0.03, normal map flattened), a little darker, with rain ripples on the
 *     medium/high tiers (puddles on a head or a car roof would be wrong, hence the separate kind);
 *   - image-based reflections get a modest boost.
 * Needs no UVs or tangents. Lambert/Phong/Toon materials are left alone (no roughness to change).
 *
 * The patch is applied by render/Lighting's material scan (every 30 frames, or at once through
 * `engine.get<RenderSystem>('render').prepare(object)`), chained after any onBeforeCompile the
 * material already has.
 */
export type WetKind = 'ground' | 'damp' | 'surface';

export function wetKind(v: unknown): WetKind | null {
  if (v === 'ground') return 'ground';
  if (v === true || v === 'damp') return 'damp';
  if (v === 'surface') return 'surface';
  return null;
}

/** Per kind: albedo when soaked, the roughness a water film pulls towards. */
const DARKEN: Record<WetKind, string> = { ground: '0.45', damp: '0.7', surface: '0.92' };
const FILM_ROUGH: Record<WetKind, string> = { ground: '0.38', damp: '0.5', surface: '0.14' };

export interface WetUniforms {
  dcWetness: { value: number };
  dcRain: { value: number };
  dcTime: { value: number };
}

const FRAG_PARS = /* glsl */`
varying vec3 vDcWetPos;
uniform float dcWetness;
uniform float dcRain;
uniform float dcTime;
float dcHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float dcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dcHash(i), dcHash(i + vec2(1.0, 0.0)), f.x), mix(dcHash(i + vec2(0.0, 1.0)), dcHash(i + 1.0), f.x), f.y);
}
float dcFbm(vec2 p) { return dcNoise(p) * 0.55 + dcNoise(p * 2.13 + 5.2) * 0.3 + dcNoise(p * 4.7 + 1.7) * 0.15; }
// Expanding rings from raindrops in two offset grids; returns a world-XZ normal offset.
vec2 dcRipple(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (3.1 + float(k) * 1.3) + float(k) * 3.7;
    vec2 cell = floor(q);
    vec2 d = fract(q) - 0.5 - (vec2(dcHash(cell + 1.3), dcHash(cell + 7.1)) - 0.5) * 0.5;
    float r = length(d);
    float ph = fract(t * 1.2 + dcHash(cell));
    float ring = r - ph * 0.35;
    g += d / max(r, 1e-3) * exp(-ring * ring * 800.0) * (1.0 - ph) * sin(ring * 70.0);
  }
  return g * 0.08;
}
`;

function block(kind: WetKind, ripples: boolean): string {
  const ground = kind === 'ground';
  return /* glsl */`
{
  float dcW = clamp(dcWetness, 0.0, 1.0);
  if (dcW > 0.001) {
    vec3 dcWN = inverseTransformDirection(dcGeoN, viewMatrix);
    float dcUp = smoothstep(0.72, 0.97, dcWN.y);
    float dcPuddle = 0.0;
    ${ground ? `
    vec2 dcP = vDcWetPos.xz;
    float dcN = dcFbm(dcP * 0.085) + (dcNoise(dcP * 1.3) - 0.5) * 0.07;
    float dcCover = mix(0.14, 0.34, smoothstep(0.4, 1.0, dcW));
    dcPuddle = dcUp * (1.0 - smoothstep(dcCover - 0.05, dcCover + 0.01, dcN)) * smoothstep(0.35, 0.8, dcW);` : ''}
    float dcFilm = dcW * mix(0.55, 1.0, dcUp);
    diffuseColor.rgb *= mix(1.0, ${DARKEN[kind]}, dcFilm);
    diffuseColor.rgb *= mix(1.0, 0.75, dcPuddle);
    roughnessFactor = mix(roughnessFactor, min(roughnessFactor, ${FILM_ROUGH[kind]}), dcFilm);
    roughnessFactor = mix(roughnessFactor, 0.03, dcPuddle);
    normal = normalize(mix(normal, dcGeoN, dcPuddle * 0.92));
    ${ground && ripples ? `
    if (dcPuddle > 0.01 && dcRain > 0.01) {
      vec2 dcG = dcRipple(dcP, dcTime) * dcRain * dcPuddle;
      normal = normalize(normal + (viewMatrix * vec4(dcG.x, 0.0, dcG.y, 0.0)).xyz);
    }` : ''}
    // Modest: three's Fresnel is already right for a smooth surface; much more and every puddle
    // turned into a white mirror of the overcast sky.
    dcSpecBoost = 1.0 + dcFilm * 0.25 + dcPuddle * 0.6;
  }
}
`;
}

/** Inject the wet-surface terms into a standard/physical material's shader (inside onBeforeCompile). */
export function patchWet(shader: THREE.WebGLProgramParametersWithUniforms, kind: WetKind, u: WetUniforms, ripples: boolean): void {
  const fs = shader.fragmentShader;
  if (!fs.includes('#include <roughnessmap_fragment>') || !fs.includes('#include <normal_fragment_maps>')) return;
  shader.uniforms.dcWetness = u.dcWetness;
  shader.uniforms.dcRain = u.dcRain;
  shader.uniforms.dcTime = u.dcTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDcWetPos;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 dcWp = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    dcWp = batchingMatrix * dcWp;
  #endif
  #ifdef USE_INSTANCING
    dcWp = instanceMatrix * dcWp;
  #endif
  vDcWetPos = (modelMatrix * dcWp).xyz;
}`);
  shader.fragmentShader = fs
    .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nvec3 dcGeoN = normal;\nfloat dcSpecBoost = 1.0;')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + block(kind, ripples))
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#if defined( RE_IndirectSpecular )\n  radiance *= dcSpecBoost;\n#endif');
}
