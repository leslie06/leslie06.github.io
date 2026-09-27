import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * The traffic kits' lighter geometry (2026-09-27): the procedural mesher's 'low' body is a dense grid
 * (a sedan's paint is 5.2k triangles), and with ~50 traffic and parked cars round the camera the
 * cars were 60% of a frame's triangles on high. meshoptimizer's simplifier takes a body to a fifth
 * of that at under a centimetre of error, in a few milliseconds at boot. Attribute seams (paint
 * split, glass, trim edges) are duplicated vertices, so without `Permissive` they stay as borders
 * and the two-tone paint keeps its line.
 *
 * `readyKitLod()` must be awaited once before the first kit is built (the simplifier is WASM);
 * until then `simplifyIndex` leaves geometry as it is.
 */
let ready = false;

export async function readyKitLod(): Promise<void> {
  if (ready) return;
  await MeshoptSimplifier.ready;
  ready = true;
}

/** Attributes the simplifier must keep, with their weights: shading, texture, colour, paint and part flags. */
const ATTRS: [string, number][] = [['normal', 1], ['uv', 8], ['color', 2], ['pbr', 2], ['aux', 4]];

/**
 * Replace `g`'s index by a simplified one keeping at most `ratio` of its triangles, within `error`
 * (relative to its size). Normals, UVs (the grille, badge and plates are atlas regions), colours
 * and the paint-tone / part flags weigh in, so a collapse never drags one part's texture or tone
 * onto another.
 */
export function simplifyIndex(g: THREE.BufferGeometry, ratio: number, error: number): void {
  if (!ready || !g.index) return;
  const pos = g.getAttribute('position'), n = pos.count;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { positions[i * 3] = pos.getX(i); positions[i * 3 + 1] = pos.getY(i); positions[i * 3 + 2] = pos.getZ(i); }
  const used = ATTRS.map(([name, w]) => [g.getAttribute(name), w] as const).filter(([a]) => !!a) as [THREE.BufferAttribute, number][];
  const stride = used.reduce((a, [at]) => a + at.itemSize, 0);
  const attrs = new Float32Array(n * stride), weights: number[] = [];
  let o = 0;
  for (const [a, w] of used) {
    for (let i = 0; i < n; i++) for (let k = 0; k < a.itemSize; k++) attrs[i * stride + o + k] = a.getComponent(i, k);
    for (let k = 0; k < a.itemSize; k++) weights.push(w);
    o += a.itemSize;
  }
  const indices = new Uint32Array(g.index.array);
  const target = Math.max(3, Math.floor(indices.length * ratio / 3) * 3);
  const [out] = stride > 0
    ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, stride, weights, null, target, error)
    : MeshoptSimplifier.simplify(indices, positions, 3, target, error);
  if (out.length >= 3 && out.length < indices.length) g.setIndex(new THREE.BufferAttribute(out, 1));
}
