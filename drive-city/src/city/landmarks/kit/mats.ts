import * as THREE from 'three';
import type { EnvUniforms } from '../../../game/Contracts';
import { brickTex, grimeTex, marbleTex, paintTex, pavingTex, tileTex, TILE_SPAN } from './tex';

export type TileColor = 'Y' | 'G' | 'B' | 'K';

/**
 * Night-light gains shared by every landmark material. The render module may scale these to match
 * its exposure (they are plain uniform objects, read every frame).
 */
export const LANDMARK_LIGHTS = {
  /** Floodlight on stone, lacquer and tiles: emissive = albedo * warm tint * aGlow * flood * uNight. */
  flood: { value: 0.32 },
  /** Self-lit things: lanterns, lit passages, clock faces, signs. */
  lamps: { value: 0.6 },
  /** Office windows and facade LEDs on the towers. */
  windows: { value: 2.0 },
};

export type GlowMode = 'flood' | 'lamp';

/**
 * Adds the night term to a built-in material. Vertices carry `aGlow` (see geo.ts); the material
 * reads `env.uNight` by reference, so the shared uniform drives it with no per-frame work here.
 * If another module later sets its own onBeforeCompile (the wet-road shader), it must call
 * `material.userData.landmarkCompile` first.
 */
export function nightGlow<T extends THREE.Material>(mat: T, env: EnvUniforms, mode: GlowMode, color: THREE.ColorRepresentation): T {
  const col = new THREE.Color(color);
  const gain = mode === 'flood' ? LANDMARK_LIGHTS.flood : LANDMARK_LIGHTS.lamps;
  const hook = (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.uniforms.uNight = env.uNight;
    s.uniforms.uGlowGain = gain;
    s.uniforms.uGlowColor = { value: col };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uGlowGain;\nuniform vec3 uGlowColor;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += uNight * uGlowGain * vGlow * uGlowColor${mode === 'flood' ? ' * diffuseColor.rgb' : ''};`);
  };
  mat.onBeforeCompile = hook;
  mat.userData.landmarkCompile = hook;
  mat.customProgramCacheKey = () => 'lm-glow-' + mode;
  return mat;
}

function rep<T extends THREE.Texture>(t: T, sx: number, sy = sx): T {
  // Shared textures: every material using one takes the same span, so one texture object suffices.
  t.repeat.set(1 / sx, 1 / sy);
  return t;
}

const FLOOD = '#ffcf94';
const cache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();

export const TILE_COLORS: Record<TileColor, string> = { Y: '#e8aa2a', G: '#2c7d4c', B: '#2553a8', K: '#6f706c' };
const GLAZE_COLORS: Record<TileColor, string> = { Y: '#dca128', G: '#2a7448', B: '#234d9c', K: '#5d5e5b' };

/** The shared landmark palette. Keys are what the builders put geometry under. */
export function landmarkMaterials(env: EnvUniforms): Record<string, THREE.Material> {
  const hit = cache.get(env);
  if (hit) return hit;
  const grime = rep(grimeTex(), 4);
  const grimeWide = grimeTex().clone(); grimeWide.repeat.set(1 / 9, 1 / 9);   // big walls: no visible tiling
  // wet: true = porous ground (puddles on flat tops), 'surface' = sealed (glaze, lacquer, glass); see render/Wet.ts
  const std = (p: THREE.MeshStandardMaterialParameters, mode: GlowMode | null = 'flood', glowColor: THREE.ColorRepresentation = FLOOD, wet: boolean | 'surface' = 'surface') => {
    const m = new THREE.MeshStandardMaterial(p);
    if (mode) nightGlow(m, env, mode, glowColor);
    if (wet) m.userData.wet = wet;
    return m;
  };
  const tt = tileTex();
  rep(tt.map, TILE_SPAN); rep(tt.normal, TILE_SPAN); rep(tt.rough, TILE_SPAN);
  const m: Record<string, THREE.Material> = {
    red: std({ color: '#9e2518', map: grime, roughness: 0.5 }),
    redWall: std({ color: '#9b2e21', map: grimeWide, roughness: 0.88 }, 'flood', FLOOD, true),
    marble: std({ color: '#ece7db', map: rep(marbleTex(), 3), roughness: 0.52 }, 'flood', FLOOD, true),
    paving: std({ color: '#d0cabd', map: rep(pavingTex(), 4), roughness: 0.82 }, 'flood', FLOOD, true),
    brick: std({ color: '#d9dcdc', map: rep(brickTex(), 2.4, 1.2), roughness: 0.9 }, 'flood', FLOOD, true),
    granite: std({ color: '#d6d1c6', map: grime, roughness: 0.62 }, 'flood', FLOOD, true),
    plaster: std({ color: '#ddcfae', map: grimeWide, roughness: 0.85 }, 'flood', FLOOD, true),
    paint: std({ map: paintTex(), roughness: 0.62 }),
    gold: std({ color: '#e6b556', metalness: 1, roughness: 0.3 }),
    bronze: std({ color: '#6a5a44', metalness: 0.85, roughness: 0.42 }),
    roofFlat: std({ color: '#6b6a66', map: grime, roughness: 0.92 }, 'flood', FLOOD, true),
    dark: std({ color: '#15100d', roughness: 0.95 }, 'lamp', '#ffb46a'),
    lantern: std({ color: '#c8200f', roughness: 0.45 }, 'lamp', '#ff5a22'),
    white: std({ color: '#f1efe8', roughness: 0.5 }, 'lamp', '#fff3dc'),
  };
  for (const c of Object.keys(TILE_COLORS) as TileColor[]) {
    m['tile' + c] = std({ color: TILE_COLORS[c], map: tt.map, normalMap: tt.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughnessMap: tt.rough, roughness: c === 'K' ? 1.6 : 1.0 }, 'flood', FLOOD, 'surface');
    m['glz' + c] = std({ color: GLAZE_COLORS[c], map: grime, roughness: c === 'K' ? 0.8 : 0.34 }, 'flood', FLOOD, 'surface');
  }
  cache.set(env, m);
  return m;
}
