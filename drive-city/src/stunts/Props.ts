import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnvUniforms } from '../game/Contracts';
import MODELS from './models.json';

/**
 * The stunt structures' looks, modelled in Blender (scripts/blender/props/stunts.py -> models.json, per thing, per material
 * name: positions in mm, normals in hundredths, indices): the ramp, the unfinished overpass, its landing mound, the
 * underground car park and the shortcuts' lanterns. Their colliders are the game code's. Each material name has a colour,
 * whether it is metal (the steel goes in its own mesh, a metallic material) and how much it glows.
 */
const LOOK: Record<string, [string, boolean, number]> = {
  steel: ['#6c7176', true, 0], steelDark: ['#3c3f43', true, 0], deck: ['#2b2d30', true, 0], yellow: ['#f2b705', false, 0],
  black: ['#1a1a1a', false, 0], red: ['#e8481f', false, 0], white: ['#d8dadc', false, 0], tyre: ['#161616', false, 0],
  concrete: ['#b9b6ae', false, 0], concreteDark: ['#8f8c86', false, 0], asphalt: ['#3a3c3f', false, 0], paint: ['#e8e6df', false, 0],
  rebar: ['#7a4a30', false, 0], dirt: ['#7d6a4f', false, 0], dirtDark: ['#5f503b', false, 0], stone: ['#8a8278', false, 0],
  hoard: ['#2f6db5', false, 0], orange: ['#e8641f', false, 0], floor: ['#5d6a64', false, 0], pipeRed: ['#b8322a', false, 0],
  duct: ['#9aa0a4', true, 0], light: ['#fff4dc', false, 1.6], sign: ['#1d5fd1', false, 0.5], lantern: ['#d8201c', false, 1.4],
  gold: ['#e8b62a', false, 0.6],
};

type Model = Record<string, { p: number[]; n: number[]; i: number[] }>;
const cache = new Map<string, { matte: THREE.BufferGeometry | null; metal: THREE.BufferGeometry | null }>();

/** A thing's geometry (colour and `aGlow` per vertex), matte and metal parts apart; copies, so callers may transform them. */
export function propGeometry(name: string): { matte: THREE.BufferGeometry | null; metal: THREE.BufferGeometry | null } {
  let c = cache.get(name);
  if (!c) {
    const model = (MODELS as unknown as Record<string, Model>)[name];
    if (!model) throw new Error(`stunt prop: no model "${name}"`);
    const matte: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [];
    for (const [mat, g] of Object.entries(model)) {
      const [hex, isMetal, glow] = LOOK[mat] ?? ['#ff00ff', false, 0];
      const geo = new THREE.BufferGeometry();
      const n = g.p.length / 3, col = new THREE.Color(hex), cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cols.set([col.r, col.g, col.b], i * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(g.p, (v) => v / 1000), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(g.n, (v) => v / 100), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
      geo.setIndex(g.i);
      (isMetal ? metal : matte).push(geo);
    }
    c = { matte: matte.length ? mergeGeometries(matte) : null, metal: metal.length ? mergeGeometries(metal) : null };
    cache.set(name, c);
  }
  return { matte: c.matte?.clone() ?? null, metal: c.metal?.clone() ?? null };
}

/**
 * The two materials the props are drawn with: matte (paint, concrete, earth) and metal (steel). Glowing parts light up by
 * `glowDay` in daylight and `glowDay + glowNight` at night (the car park's lamps are always on: glowNight 0).
 */
export function propMaterials(env: EnvUniforms | undefined, key: string, glowDay: number, glowNight: number): { matte: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial } {
  const make = (metal: boolean) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: metal ? 0.45 : 0.82, metalness: metal ? 0.6 : 0.0, side: THREE.DoubleSide });
    m.userData.wet = 'surface';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = env?.uNight ?? { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * (${glowDay.toFixed(2)} + ${glowNight.toFixed(2)} * uNight);`);
    };
    m.customProgramCacheKey = () => `stunt-props-${key}-${metal ? 'metal' : 'matte'}`;
    return m;
  };
  return { matte: make(false), metal: make(true) };
}

/** Meshes (matte, metal) from lists of placed geometries; empty lists are left out. */
export function propMeshes(name: string, matte: THREE.BufferGeometry[], metal: THREE.BufferGeometry[], mats: { matte: THREE.Material; metal: THREE.Material }): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const [list, mat, tag] of [[matte, mats.matte, 'matte'], [metal, mats.metal, 'metal']] as const) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list)!, mat);
    mesh.name = `${name}-${tag}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}
