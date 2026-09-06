import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { NavPoint } from '../game/Contracts';

/**
 * Waypoint graph built by sampling the physics world after all static colliders exist:
 *  - candidates on a grid (plus hand-placed seeds for stairs/upper floors),
 *  - keep a candidate if a down-ray finds walkable ground with 1.9 m headroom and no wall within
 *    the capsule radius,
 *  - link neighbours when a knee-height and a chest-height ray between them are clear and the
 *    slope is walkable,
 *  - annotate cover by probing 8 directions at crouch and stand height.
 */
export function buildNavGraph(engine: Engine, bounds: THREE.Box3, seeds: THREE.Vector3[], step = 2.4): NavPoint[] {
  const phys = engine.physics;
  const WORLD = groups(CG.PLAYER, CG.WORLD);
  const R = 0.36;
  const down = { x: 0, y: -1, z: 0 };
  const candidates: THREE.Vector3[] = [];

  const groundAt = (x: number, yFrom: number, z: number, maxDrop: number): number | null => {
    const hit = phys.raycast({ x, y: yFrom, z }, down, maxDrop, WORLD);
    if (!hit) return null;
    if (hit.normal[1] < 0.64) return null; // steeper than ~50°
    return hit.point[1];
  };
  const clearAround = (x: number, y: number, z: number): boolean => {
    // headroom
    if (phys.raycast({ x, y: y + 0.3, z }, { x: 0, y: 1, z: 0 }, 1.7, WORLD)) return false;
    // walls within the capsule at two heights
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      for (const h of [0.5, 1.3]) if (phys.raycast({ x, y: y + h, z }, { x: dx, y: 0, z: dz }, R, WORLD)) return false;
    }
    return true;
  };

  // grid candidates at every "floor" level: cast from high above and walk down through hits.
  for (let x = bounds.min.x + step / 2; x < bounds.max.x; x += step) {
    for (let z = bounds.min.z + step / 2; z < bounds.max.z; z += step) {
      let yFrom = bounds.max.y;
      for (let guard = 0; guard < 8; guard++) {
        const hit = phys.raycast({ x, y: yFrom, z }, down, yFrom - bounds.min.y, WORLD);
        if (!hit) break;
        const y = hit.point[1];
        if (hit.normal[1] >= 0.64 && clearAround(x, y, z)) candidates.push(new THREE.Vector3(x, y, z));
        yFrom = y - 0.05;
        if (yFrom <= bounds.min.y) break;
      }
    }
  }
  for (const s of seeds) {
    const y = groundAt(s.x, s.y + 1.0, s.z, 3.0);
    if (y !== null) candidates.push(new THREE.Vector3(s.x, y, s.z));
  }

    // dedupe
  const pts: THREE.Vector3[] = [];
  for (const c of candidates) if (!pts.some((p) => p.distanceToSquared(c) < 0.8 * 0.8)) pts.push(c);

  const nodes: NavPoint[] = pts.map((p) => ({ position: p, links: [] }));
  const maxLink = step * 1.6;
  const dir = new THREE.Vector3();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].position, b = nodes[j].position;
      const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
      const dxz = Math.hypot(dx, dz);
      if (dxz > maxLink || dxz < 0.3) continue;
      if (Math.abs(dy) > dxz * 0.85 + 0.2) continue; // too steep / a ledge
      let ok = true;
      for (const h of [0.55, 1.35]) {
        dir.set(dx, dy, dz);
        const len = dir.length(); dir.normalize();
        if (phys.raycast({ x: a.x, y: a.y + h, z: a.z }, { x: dir.x, y: dir.y, z: dir.z }, len - 0.05, WORLD)) { ok = false; break; }
      }
      if (!ok) continue;
      // ground continuity: midpoint must have ground within a step of the interpolated height
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (a.y + b.y) / 2;
      const g = groundAt(mx, my + 0.6, mz, 1.6);
      if (g === null || Math.abs(g - my) > 0.7) continue;
      nodes[i].links.push(j); nodes[j].links.push(i);
    }
  }

    // cover annotation
  for (const n of nodes) {
    const p = n.position;
    let best: { dir: THREE.Vector3; height: 'low' | 'high'; d: number } | null = null;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const low = phys.raycast({ x: p.x, y: p.y + 0.6, z: p.z }, { x: dx, y: 0, z: dz }, 1.3, WORLD);
      if (!low) continue;
      const high = phys.raycast({ x: p.x, y: p.y + 1.45, z: p.z }, { x: dx, y: 0, z: dz }, 1.3, WORLD);
      const height: 'low' | 'high' = high ? 'high' : 'low';
      // prefer low cover (can shoot over it), then nearest
      const score = (height === 'low' ? 0 : 10) + low.distance;
      if (!best || score < (best.height === 'low' ? 0 : 10) + best.d) best = { dir: new THREE.Vector3(dx, 0, dz), height, d: low.distance };
    }
    if (best) n.cover = { dir: best.dir, height: best.height };
  }

  // drop isolated nodes
  const keep = nodes.map((n) => n.links.length > 0);
  const remap = new Map<number, number>();
  const out: NavPoint[] = [];
  nodes.forEach((n, i) => { if (keep[i]) { remap.set(i, out.length); out.push(n); } });
  for (const n of out) n.links = n.links.map((l) => remap.get(l)!).filter((l) => l !== undefined);
  return out;
}
