/**
 * Can the villa's stair actually be walked up?
 *
 * Everything about the flight was already checked as arithmetic - the rise is under the autostep,
 * the treads touch, the top tread's centre is inside the landing rectangle - and every one of those
 * passed while the stair was unusable. Three bugs hid behind them at once:
 *
 *   - The landing was a 0.25 m slab at floor level, and the helix sweeps under it: treads 13 to 18
 *     were sealed inside a floor. You climbed to 3.5 m and met its underside at chest height.
 *   - The collider hulls chunked three treads each, so their outer edge was a chord of the arc. The
 *     arc bulges 0.22 m outside that chord at mid span, so the outer quarter of every third tread
 *     was a hole with a 2.3 m drop to the ground floor behind it.
 *   - The drawn balustrade had no collider, so the edge of the flight was not an edge at all.
 *
 * None of that is visible in a screenshot or derivable from the numbers in Layout. So this builds
 * the villa's real colliders into a real Rapier world, exactly as `placeLandmarks` does, and asks
 * the only questions that matter: at every tread, across its full width, what do I stand on, what
 * is over my head, and can I get from the hall to the first floor without falling?
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE, LANDING, STAIR, VOID } from './Layout';
import { buildVillaStatic } from './Villa';

/** What player/OnFoot.ts will do for us: autostep 0.4 m. Anything taller stops the player dead. */
const STEP = 0.4;
/** Standing height of the character capsule, plus a hat. */
const HEAD = 1.9;

const { cx, cz, r, w, a0, a1, treads } = STAIR;
const inner = r - w / 2, outer = r + w / 2;
const angleStep = (a1 - a0) / (treads - 1);
const rise = (HOUSE.floor1 - HOUSE.floor0) / treads;
/** The visual top of tread `i`, which is what the collider under it has to agree with. */
const treadTop = (i: number): number => HOUSE.floor0 + (i + 1) * rise;

type World = import('@dimforge/rapier3d-compat').World;
type Rapier = typeof import('@dimforge/rapier3d-compat');
let R: Rapier, world: World;

/**
 * Top of whatever is under (x, z), searching down from `from`. NaN if there is nothing.
 *
 * `from` is always just above the feet, never the roof: cast from up there and the first thing the
 * ray meets over the stairwell is the void rail or the slab the flight passes under, which reads
 * as a floor 3 m above the tread you are standing on.
 */
const under = (x: number, z: number, from: number): number => {
  const hit = world.castRay(new R.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 40, true);
  if (!hit) return NaN;
  const h = hit as unknown as { timeOfImpact?: number; toi?: number };
  return from - (h.timeOfImpact ?? h.toi ?? 0);
};

/** Distance from (x, y, z) to the first solid thing in direction d, or Infinity. */
const reach = (x: number, y: number, z: number, d: { x: number; y: number; z: number }, max: number): number => {
  const hit = world.castRay(new R.Ray({ x, y, z }, d), max, true);
  if (!hit) return Infinity;
  const h = hit as unknown as { timeOfImpact?: number; toi?: number };
  return h.timeOfImpact ?? h.toi ?? 0;
};

/** A point on the flight: `t` is the tread index (fractional walks between them), `k` across it. */
const spot = (t: number, k: number): { x: number; z: number } => {
  const a = a0 + angleStep * t, rad = inner + (outer - inner) * k;
  return { x: cx + Math.cos(a) * rad, z: cz + Math.sin(a) * rad };
};

beforeAll(async () => {
  const mod = await import('@dimforge/rapier3d-compat');
  R = ((mod as unknown as { default?: unknown }).default ?? mod) as Rapier;
  await R.init();
  world = new R.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  for (const sp of buildVillaStatic().colliders) {
    let desc: ReturnType<typeof R.ColliderDesc.cuboid> | null = null;
    if (sp.kind === 'box') {
      const yaw = sp.yaw ?? 0;
      desc = R.ColliderDesc.cuboid(sp.half[0], sp.half[1], sp.half[2])
        .setTranslation(sp.center[0], sp.center[1], sp.center[2])
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    } else if (sp.kind === 'cylinder') {
      desc = R.ColliderDesc.cylinder(sp.halfHeight, sp.radius)
        .setTranslation(sp.center[0], sp.center[1], sp.center[2]);
    } else {
      desc = R.ColliderDesc.convexHull(new Float32Array(sp.points));
    }
    if (desc) world.createCollider(desc, body);
  }
  // Ray queries run off the query pipeline, which only picks the new colliders up on a step.
  world.step();
});

describe('我家 the stair', () => {
  it('puts a floor under every part of every tread', () => {
    // The chord-hole bug: the outer quarter of treads 2, 5, 8, 11 had nothing under it, and the
    // ray went 2.3 m down to the ground floor. Sampling the middle of each tread missed it every
    // time, so sample right across the width.
    const bad: string[] = [];
    for (let i = 0; i < treads; i++) {
      // Not the very edges: the spine and the guard stand exactly on them, and the character
      // capsule is 0.56 m across, so it can never put a foot there anyway.
      for (let k = 0.05; k < 0.96; k += 0.1) {
        const { x, z } = spot(i, k);
        const drop = treadTop(i) - under(x, z, treadTop(i) + 0.6);
        if (!(Math.abs(drop) < 0.08)) {
          bad.push(`第 ${i} 级 ${(k * 100).toFixed(0)}% 处落差 ${Number.isNaN(drop) ? '无支撑' : `${drop.toFixed(2)} m`}`);
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('leaves headroom over the whole flight', () => {
    // The bug this exists for: the landing slab sat 0.19 m over tread 18 and the first-floor slab
    // capped the treads that swept past the void's edge. The flight has to rise in open air.
    const bad: string[] = [];
    for (let i = 0; i < treads; i++) {
      for (let k = 0.05; k <= 0.95; k += 0.1) {
        const { x, z } = spot(i, k);
        // The last tread is the floor, so anything above it is the storey above, not a cap.
        const up = reach(x, treadTop(i) + 0.12, z, { x: 0, y: 1, z: 0 }, HEAD);
        if (up < HEAD) bad.push(`第 ${i} 级 ${(k * 100).toFixed(0)}% 处头顶只有 ${(up + 0.12).toFixed(2)} m`);
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('can be walked from the hall to the first floor without a step over the autostep', () => {
    // Walk the middle of the flight in tenths of a tread, from the floor below to the floor above.
    let feet = HOUSE.floor0;
    const climbs: string[] = [];
    // Starting out on the hall floor short of the bottom tread, so the step onto the flight counts.
    for (let t = -1.2; t <= treads - 0.4; t += 0.1) {
      const { x, z } = spot(t, 0.5);
      const top = under(x, z, feet + 1.2);
      expect(Number.isFinite(top), `walking the flight fell into space at tread ${t.toFixed(1)}`).toBe(true);
      if (top - feet > STEP) climbs.push(`tread ${t.toFixed(1)}: a ${(top - feet).toFixed(2)} m step`);
      if (feet - top > STEP) climbs.push(`tread ${t.toFixed(1)}: a ${(feet - top).toFixed(2)} m drop`);
      feet = top;
    }
    expect(climbs.slice(0, 6)).toEqual([]);
    expect(feet).toBeCloseTo(HOUSE.floor1, 1);
  });

  it('arrives on the first floor, and the paving there is floor you can stand on', () => {
    // The top tread has to lap onto the slab west of the void, not stop in mid-air above it.
    const top = HOUSE.floor1 + 1;
    for (const z of [LANDING.z0 + 0.4, 0.4, LANDING.z1 - 0.4]) {
      expect(under(LANDING.x1 - 0.4, z, top), `landing at z=${z}`).toBeCloseTo(HOUSE.floor1, 2);
    }
    // And from the arrival you can walk south onto the boards and east along the gallery.
    expect(under(LANDING.x0 + 1.5, VOID.z1 + 2, top)).toBeCloseTo(HOUSE.floor1, 2);
    expect(under(VOID.x1 + 2, 0, top)).toBeCloseTo(HOUSE.floor1, 2);
  });

  it('walls both edges of the flight, so you cannot walk off it', () => {
    // Drawn balusters and a drawn spine wall stop nobody. Every tread needs something solid just
    // beyond each edge, at knee height, or the edge of a 3.8 m stair is an open side.
    for (let i = 0; i < treads - 1; i++) {
      const a = a0 + angleStep * i, y = treadTop(i) + 0.45;
      const mid = spot(i, 0.5);
      const out = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      expect(reach(mid.x, y, mid.z, out, w), `tread ${i} has no guard outside it`).toBeLessThan(w / 2 + 0.12);
      expect(reach(mid.x, y, mid.z, { x: -out.x, y: 0, z: -out.z }, w), `tread ${i} has no spine inside it`)
        .toBeLessThan(w / 2 + 0.12);
    }
  });

  it('rails the void, so the first floor is not an open hole', () => {
    // Every edge of the stairwell except the one the flight arrives at.
    const edges: [number, number, { x: number; y: number; z: number }][] = [
      [(VOID.x0 + VOID.x1) / 2, VOID.z0 + 0.8, { x: 0, y: 0, z: -1 }],
      [(VOID.x0 + VOID.x1) / 2, VOID.z1 - 0.8, { x: 0, y: 0, z: 1 }],
      [VOID.x1 - 0.8, (VOID.z0 + VOID.z1) / 2, { x: 1, y: 0, z: 0 }],
      [VOID.x0 + 0.8, VOID.z0 + 1.0, { x: -1, y: 0, z: 0 }],
    ];
    for (const [x, z, d] of edges) {
      expect(reach(x, HOUSE.floor1 + 0.5, z, d, 2), `the void's ${d.x || d.z} edge has no rail`).toBeLessThan(1.2);
    }
  });
});
