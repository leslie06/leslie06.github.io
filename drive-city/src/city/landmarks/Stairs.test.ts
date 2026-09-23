/**
 * Can the stairs of the marble terraces be walked up?
 *
 * 「我走天坛的楼梯上不去，人就埋在台阶里了」(2026-09-23): the flights are drawn on the detail LOD
 * only, `placeLandmarks` takes its stone trimesh from the far LOD (which builds no stairs), and the
 * tiers are solid drums besides - so every flight of 祈年殿 was a picture. The feet walked the
 * ground under the treads and stopped at the tier's face. The kit's terraces now hand out a walk-only
 * ramp hull per flight (`stairWedge`), and this builds the real collider lists into a Rapier world
 * and rides a ray up the centre line of every ramp: the surface must climb from the ground outside
 * the foot to the tier top inside the face in rises the character controller's autostep can take.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ColliderSpec } from '../../game/Contracts';
import { qiniandianParts } from './qiniandian';
import { taihedianParts } from './taihedian';

type Rapier = typeof import('@dimforge/rapier3d-compat');
let R: Rapier;

beforeAll(async () => {
  const mod = await import('@dimforge/rapier3d-compat');
  R = ((mod as unknown as { default?: unknown }).default ?? mod) as Rapier;
  await R.init();
});

/** A world holding `colliders` exactly as placeLandmarks builds them (at the origin, heading 0). */
function worldOf(colliders: ColliderSpec[]): import('@dimforge/rapier3d-compat').World {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  for (const sp of colliders) {
    if (sp.kind === 'box') {
      const yaw = sp.yaw ?? 0;
      world.createCollider(R.ColliderDesc.cuboid(sp.half[0], sp.half[1], sp.half[2]).setTranslation(sp.center[0], sp.center[1], sp.center[2]).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }), body);
    } else if (sp.kind === 'cylinder') {
      world.createCollider(R.ColliderDesc.cylinder(sp.halfHeight, sp.radius).setTranslation(sp.center[0], sp.center[1], sp.center[2]), body);
    } else {
      world.createCollider(R.ColliderDesc.convexHull(new Float32Array(sp.points))!, body);
    }
  }
  world.step();
  return world;
}

/** Top of whatever is under (x, z) from 12 m up, or 0 for the ground. */
function under(world: import('@dimforge/rapier3d-compat').World, x: number, z: number): number {
  const hit = world.castRay(new R.Ray({ x, y: 12, z }, { x: 0, y: -1, z: 0 }), 12, true);
  return hit ? Math.max(0, 12 - hit.timeOfImpact) : 0;
}

/** The centre line of a ramp hull, from just outside its foot to just inside its head, and its top height. */
function rampLine(points: number[]): { foot: [number, number]; head: [number, number]; top: number } {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < points.length; i += 3) pts.push([points[i], points[i + 1], points[i + 2]]);
  const ys = [...new Set(pts.map((p) => +p[1].toFixed(3)))].sort((a, b) => a - b);
  const top = ys[ys.length - 1], low = ys[ys.length - 2];
  const mid = (list: [number, number, number][]): [number, number] => [list.reduce((a, p) => a + p[0], 0) / list.length, list.reduce((a, p) => a + p[2], 0) / list.length];
  const head = mid(pts.filter((p) => Math.abs(p[1] - top) < 1e-3)), foot = mid(pts.filter((p) => Math.abs(p[1] - low) < 1e-3));
  return { foot, head, top };
}

/** Every ramp hull in `colliders` climbs from the level below to its tier in steps the autostep takes. */
function walkable(colliders: ColliderSpec[], tierH: number): string[] {
    const ramps = colliders.filter((c) => c.kind === 'hull');
    const world = worldOf(colliders);
    const bad: string[] = [];
    for (const r of ramps) {
      if (r.kind !== 'hull') continue;
      const { foot, head, top } = rampLine(r.points);
      const dx = head[0] - foot[0], dz = head[1] - foot[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      // From 0.6 m before the foot to 0.6 m past the head, every 0.25 m.
      let prev = under(world, foot[0] - ux * 0.6, foot[1] - uz * 0.6), start = prev;
      for (let s = -0.35; s <= L + 0.6; s += 0.25) {
        const y = under(world, foot[0] + ux * s, foot[1] + uz * s);
        if (y - prev > 0.4 || y - prev < -0.4) bad.push(`ramp to ${top.toFixed(2)} m: a ${(y - prev).toFixed(2)} m step at ${s.toFixed(2)} m along`);
        prev = y;
      }
      // It starts no higher than the level below (太和殿's tiers step back exactly one flight, so an
      // upper ramp's foot stands on the slope of the one below it), and ends on the tier it climbs to.
      if (start > top - tierH + 0.25) bad.push(`ramp to ${top.toFixed(2)} m starts at ${start.toFixed(2)} m, above the ${(top - tierH).toFixed(2)} m below it`);
      if (prev < top - 0.1) bad.push(`ramp to ${top.toFixed(2)} m ends at ${prev.toFixed(2)} m`);
    }
    return bad;
}

describe('the terrace stairs', () => {
  it('祈年殿: every flight is a ramp you can walk from the ground to its tier', () => {
    const { colliders } = qiniandianParts();
    const ramps = colliders.filter((c) => c.kind === 'hull');
    // Four stairs on each of three tiers, and cars must not get a ramp onto the altar.
    expect(ramps.length).toBe(12);
    for (const r of ramps) expect(r.walkOnly).toBe(true);
    expect(walkable(colliders, 1.9)).toEqual([]);
  });

  it('太和殿: the polygon terrace\'s flights too (the other stair code path)', () => {
    const { colliders } = taihedianParts();
    const ramps = colliders.filter((c) => c.kind === 'hull');
    expect(ramps.length).toBeGreaterThanOrEqual(4);
    for (const r of ramps) expect(r.walkOnly).toBe(true);
    // Its tiers are TH each; read the height off the first tier box rather than hard-code it.
    const tier = colliders.find((c) => c.kind === 'box' && c.center[2] === 7 && c.center[1] > 0.5)!;
    const th = tier.kind === 'box' ? tier.half[1] * 2 : 0;
    expect(walkable(colliders, th)).toEqual([]);
  });
});
