import * as THREE from 'three';
import type { AreaKind, AreaRec } from './Data';

/**
 * Small lifts only (under the 3 cm roads): the real separation between overlapping ground layers
 * is each kind's polygon offset (Materials.ts), which holds at a kilometre where millimetres do not.
 */
const LIFT: Record<AreaKind, number> = { rail: 0.004, parking: 0.006, grass: 0.008, park: 0.009, wood: 0.01, pitch: 0.012, plaza: 0.014, water: 0.016 };

/** Ground polygons (clipped to the tile by the build) triangulated with holes, one geometry per kind. */
export function buildAreas(areas: AreaRec[]): Map<AreaKind, THREE.BufferGeometry> {
  const acc = new Map<AreaKind, { pos: number[]; uv: number[] }>();
  for (const a of areas) {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < a.o.length; i += 2) contour.push(new THREE.Vector2(a.o[i], a.o[i + 1]));
    const holes = (a.hs ?? []).map((h) => { const r: THREE.Vector2[] = []; for (let i = 0; i < h.length; i += 2) r.push(new THREE.Vector2(h[i], h[i + 1])); return r; });
    let faces: number[][];
    try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { continue; }
    const all = contour.concat(...holes);
    let b = acc.get(a.k);
    if (!b) { b = { pos: [], uv: [] }; acc.set(a.k, b); }
    const y = LIFT[a.k];
    for (const f of faces) {
      let [p, q, r] = f.map((i) => all[i]);
      if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0) [q, r] = [r, q];
      for (const v of [p, q, r]) { b.pos.push(v.x, y, v.y); b.uv.push(v.x, v.y); }
    }
  }
  const out = new Map<AreaKind, THREE.BufferGeometry>();
  for (const [k, b] of acc) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const n = new Float32Array(b.pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.computeBoundingSphere();
    out.set(k, g);
  }
  return out;
}
