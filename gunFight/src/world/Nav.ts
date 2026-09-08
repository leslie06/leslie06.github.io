import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { NavPoint } from '../game/Contracts';

/**
 * The body the graph is validated against. Mirrors `PLAYER` in player/PlayerController (radius 0.35,
 * height 1.8, autostep 0.42) — world/ may not import player internals, so these are kept in step by hand.
 * A graph that claims routes this body cannot walk is worse than a sparse one: it silently misleads the
 * AI *and* anyone measuring reachability from it.
 */
const BODY = { radius: 0.35, height: 1.8, stepUp: 0.42, stepDown: 0.55 };
/** Shrink the probe a hair so a node sampled a centimetre off-centre isn't rejected by its own floor. */
const SKIN = 0.03;

/**
 * Waypoint graph built by sampling the physics world after all static colliders exist:
 *  - candidates on a grid (plus hand-placed seeds for stairs/upper floors),
 *  - keep a candidate if a down-ray finds walkable ground and the standing body fits there,
 *  - link neighbours only when the body can actually *walk* the line: the ground is stepped along the
 *    whole span and the capsule fits at every sample (see `walkable`),
 *  - annotate cover by probing 8 directions at crouch and stand height.
 */
export function buildNavGraph(engine: Engine, bounds: THREE.Box3, seeds: THREE.Vector3[], step = 2.4): NavPoint[] {
  const phys = engine.physics;
  const WORLD = groups(CG.PLAYER, CG.WORLD);
  const down = { x: 0, y: -1, z: 0 };
  const candidates: THREE.Vector3[] = [];

  const groundAt = (x: number, yFrom: number, z: number, maxDrop: number): number | null => {
    const hit = phys.raycast({ x, y: yFrom, z }, down, maxDrop, WORLD);
    if (!hit) return null;
    if (hit.normal[1] < 0.64) return null; // steeper than ~50°
    return hit.point[1];
  };

  /**
   * Standing body minus the autostep zone at the feet: kerbs, rubble lips and stair risers the player
   * walks straight over must not read as walls, but anything from knee to scalp height must.
   */
  const probeR = BODY.radius - SKIN;
  const probeH = BODY.height - BODY.stepUp - SKIN;
  const capsule = new phys.R.Capsule(Math.max(0.01, (probeH - 2 * probeR) / 2), probeR);
  const IDENT = { x: 0, y: 0, z: 0, w: 1 };
  const at = { x: 0, y: 0, z: 0 };
  /** Does the standing body fit with its feet on (x, y, z)? */
  const fits = (x: number, y: number, z: number): boolean => {
    at.x = x; at.y = y + BODY.stepUp + probeH / 2; at.z = z;
    let hit = false;
    phys.world.intersectionsWithShape(at, IDENT, capsule, () => { hit = true; return false; }, undefined, WORLD);
    return !hit;
  };

  /**
   * Ground under the *footprint*, not under a hairline: a capsule rests on the highest surface beneath
   * any part of its base, which is what lets it walk onto a stair tread its centre is not over yet, and
   * what lets it bridge the 10 cm slot between two flights.
   */
  const FOOT: [number, number][] = [[0, 0], [BODY.radius * 0.7, 0], [-BODY.radius * 0.7, 0], [0, BODY.radius * 0.7], [0, -BODY.radius * 0.7]];
  const groundUnder = (x: number, z: number, yFrom: number, maxDrop: number): number | null => {
    let best: number | null = null;
    for (const [ox, oz] of FOOT) {
      const g = groundAt(x + ox, yFrom, z + oz, maxDrop);
      if (g !== null && (best === null || g > best)) best = g;
    }
    return best;
  };

  /**
   * Can the body walk the straight line a→b?
   *
   * Sampled at just under a capsule diameter: at every sample there must be ground within one step of
   * the last one, and the capsule must fit standing on it. The old test was two hairline rays down the
   * centre at fixed heights, which passes straight through a doorway narrower than the player and under
   * a ceiling too low to stand in — that is how 530 upper-floor nodes came to advertise links to the
   * ground floor through a stairwell whose entrance had 1.6 m of headroom.
   */
  const walkable = (a: THREE.Vector3, b: THREE.Vector3, bow: number): boolean => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const n = Math.max(2, Math.ceil(len / (BODY.radius * 0.9)));
    // sideways offset at the midpoint, tapering to zero at both ends
    const ox = bow === 0 ? 0 : (-dz / len) * bow, oz = bow === 0 ? 0 : (dx / len) * bow;
    let y = a.y;
    for (let i = 1; i <= n; i++) {
      const t = i / n, s = 4 * t * (1 - t);
      const x = a.x + dx * t + ox * s, z = a.z + dz * t + oz * s;
      const g = groundUnder(x, z, y + BODY.stepUp, BODY.stepUp + BODY.stepDown);
      if (g === null || g - y > BODY.stepUp || y - g > BODY.stepDown) return false;
      y = g;
      if (!fits(x, y, z)) return false;
    }
    return Math.abs(y - b.y) < BODY.stepUp;
  };
  /**
   * A link says "the body can get from a to b", not "along this exact line". Waypoints sit on a 2 m
   * lattice and the level is full of furniture, so a table corner 3 cm inside the straight line would
   * otherwise seal off a whole room corner. Allow the walk to bow half a body width either way — still
   * a real capsule-width path, just not a ruler-straight one.
   */
  const reachable = (a: THREE.Vector3, b: THREE.Vector3): boolean =>
    walkable(a, b, 0) || walkable(a, b, 0.45) || walkable(a, b, -0.45);

  /**
   * Grid candidates at every floor level: cast from high above and walk down through the hits.
   *
   * The descent is non-solid on purpose. A solid ray whose origin is inside a collider reports a hit at
   * zero distance, so stepping down 5 cm at a time the old marcher spent five of its eight tries crawling
   * through the 0.25 m roof slab and never reached the storeys below — inside a three-floor building the
   * graph only ever saw the roof and the top floor. A non-solid ray leaves the slab in one step, at the
   * cost of also reporting slab *undersides*, which the `top` probe below rejects.
   */
  for (let x = bounds.min.x + step / 2; x < bounds.max.x; x += step) {
    for (let z = bounds.min.z + step / 2; z < bounds.max.z; z += step) {
      let yFrom = bounds.max.y;
      for (let guard = 0; guard < 24 && yFrom > bounds.min.y; guard++) {
        const hit = phys.raycast({ x, y: yFrom, z }, down, yFrom - bounds.min.y, WORLD, false);
        if (!hit) break;
        const y = hit.point[1];
        // A real floor has solid ground just under a point a few centimetres above it; a soffit does not.
        const top = phys.raycast({ x, y: y + 0.06, z }, down, 0.12, WORLD);
        if (top && Math.abs(top.point[1] - y) < 0.05 && top.normal[1] >= 0.64 && fits(x, y, z)) candidates.push(new THREE.Vector3(x, y, z));
        yFrom = y - 0.02;
      }
    }
  }
  for (const s of seeds) {
    const y = groundAt(s.x, s.y + 1.0, s.z, 3.0);
    if (y !== null && fits(s.x, y, s.z)) candidates.push(new THREE.Vector3(s.x, y, s.z));
  }

    // dedupe
  const pts: THREE.Vector3[] = [];
  for (const c of candidates) if (!pts.some((p) => p.distanceToSquared(c) < 0.8 * 0.8)) pts.push(c);

  const nodes: NavPoint[] = pts.map((p) => ({ position: p, links: [] }));
  const maxLink = step * 1.6;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].position, b = nodes[j].position;
      const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
      const dxz = Math.hypot(dx, dz);
      if (dxz > maxLink || dxz < 0.3) continue;
      if (Math.abs(dy) > dxz * 0.85 + 0.2) continue; // too steep / a ledge
      if (!reachable(a, b)) continue;
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
