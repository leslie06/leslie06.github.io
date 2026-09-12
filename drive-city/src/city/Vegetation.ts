import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnvUniforms } from '../game/Contracts';
import { foliageMaterials, treeSet } from './visual/Foliage';

/**
 * Four street trees of Beijing: 国槐 scholar tree (broad rounded crown, the most common street
 * tree), 杨树 poplar, 柏树 cypress (the dark groves of the Temple of Heaven) and 银杏 ginkgo, as
 * leaf-card crowns (visual/Foliage.ts). `near` trees get branches and full crowns and cast shadows,
 * `mid` ones fewer cards, `far` ones a handful of big cards.
 */
export function treeGeometries(tier: string): { near: THREE.BufferGeometry[]; mid: THREE.BufferGeometry[]; far: THREE.BufferGeometry[] } {
  return { near: treeSet(tier === 'low' ? 'mid' : 'near'), mid: treeSet(tier === 'low' ? 'far' : 'mid'), far: treeSet('far') };
}

export function treeMaterials(env: EnvUniforms, tier: string): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  return foliageMaterials(env, tier === 'low' ? 512 : 1024);
}

/**
 * Beijing's main-road lamp: a tapered grey pole, one long arm over the road (+z), a flat LED head.
 * Six-sided and capless (~50 triangles); the lens is a separate emissive part.
 */
export function lampGeometries(): { post: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const tint = (g: THREE.BufferGeometry, hex: string) => {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  };
  const post = mergeGeometries([
    tint(new THREE.CylinderGeometry(0.075, 0.13, 8.2, 6, 1, true).translate(0, 4.1, 0), '#8e9398'),
    tint(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 6, 1, true).translate(0, 0.3, 0), '#7a7f84'),
    tint(new THREE.BoxGeometry(0.07, 0.07, 1.75).translate(0, 8.12, 0.82), '#8e9398'),
    tint(new THREE.BoxGeometry(0.36, 0.11, 0.72).translate(0, 8.07, 1.6), '#c5c9cc'),
  ])!;
  const head = new THREE.BoxGeometry(0.3, 0.04, 0.62).translate(0, 8.0, 1.6);
  return { post, head };
}
