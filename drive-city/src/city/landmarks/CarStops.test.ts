/**
 * Does a car stop at the foot of a flight of steps, not inside it?
 *
 * The ramp under every flight is walk-only (a ramp a person can climb is one a car can drive up), so
 * a car passed through it and stopped against the tier's face behind, its nose buried in the drawn
 * steps (人民英雄纪念碑, 2026-09-27). `carStops` gives each such ramp a car-only block. This drives the
 * real Vehicle at a flight built the way the kit builds 祈年殿's - once with the blocks and once
 * without, as a control - and checks people still meet only the ramp.
 */
import { describe, expect, it } from 'vitest';
import type { ColliderSpec } from '../../game/Contracts';
import { CG, groups } from '../../core/Physics';
import { TAXI } from '../../vehicle/Spec';
import { Rig } from '../../vehicle/Rig';
import { CAR_STOP, carStops } from './CarStops';
import { stairWedge } from './kit/hall';
import { qiniandianParts } from './qiniandian';

const DT = 1 / 60;
/** A 1.35 m tier north of z = 0 and a 12 m flight down to the south of it, 3.06 m deep (the monument's lower one). */
const TIER: ColliderSpec = { kind: 'box', center: [0, 0.675, -15], half: [20, 0.675, 15] };
const RUN = 3.06;
const FLIGHT = [TIER, stairWedge(0, 0, 0, 12, RUN, 0, 1.35)];
/** How far the taxi's chassis reaches ahead of its origin. */
const NOSE = Math.max(...TAXI.chassis.map((c) => c.at[2] + c.half[2]));

async function rigWith(colliders: ColliderSpec[]): Promise<Rig> {
  const rig = await Rig.create({ at: { x: 0, y: 0.36, z: 30 }, yaw: Math.PI });
  const { R, world } = rig.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL), gWalk = groups(CG.WORLD, CG.ALL & ~CG.CAR), gCar = groups(CG.WORLD, CG.CAR);
  for (const sp of colliders) {
    const desc = sp.kind === 'box'
      ? R.ColliderDesc.cuboid(sp.half[0], sp.half[1], sp.half[2]).setTranslation(sp.center[0], sp.center[1], sp.center[2])
      : sp.kind === 'hull' ? R.ColliderDesc.convexHull(new Float32Array(sp.points)) : null;
    if (desc) world.createCollider(desc.setCollisionGroups(sp.walkOnly ? gWalk : sp.carOnly ? gCar : g).setFriction(0.6), body);
  }
  return rig;
}

/** Drive straight north at the flight at `speed` m/s and say where the nose came to rest. */
async function driveAt(colliders: ColliderSpec[], speed: number): Promise<{ nose: number; y: number }> {
  const rig = await rigWith(colliders);
  rig.settle(0.5);
  rig.launch(speed);
  const car = rig.car;
  for (let t = 0; t < 6; t += DT) rig.stepInput({ forward: 1, back: 0, steer: 0, analog: true, handbrake: false });
  return { nose: car.pos.z - NOSE, y: car.pos.y };
}

describe('car stops at the foot of the steps', () => {
  it('gives a walk-only ramp a car-only block with a face at its foot', () => {
    const [stop] = carStops(FLIGHT);
    expect(carStops([TIER])).toEqual([]);
    expect(stop.carOnly).toBe(true);
    expect(stop.walkOnly).toBeFalsy();
    if (stop.kind !== 'hull') throw new Error('hull expected');
    // The foot (z = RUN) now reaches CAR_STOP over the ramp's base.
    const foot: number[] = [];
    for (let i = 0; i < stop.points.length; i += 3) if (stop.points[i + 2] > RUN - 0.01) foot.push(stop.points[i + 1]);
    expect(Math.max(...foot) - Math.min(...foot)).toBeCloseTo(CAR_STOP, 5);
  });

  it('a taxi at full throttle stops at the foot; without the block it ran into the steps', async () => {
    const control = await driveAt(FLIGHT, 8);
    const fixed = await driveAt([...FLIGHT, ...carStops(FLIGHT)], 8);
    // Control: through the ramp to the tier's face.
    expect(control.nose).toBeLessThan(0.5);
    // With the block: the nose is outside the flight, and the car is still on the ground.
    expect(fixed.nose).toBeGreaterThan(RUN - 0.15);
    expect(fixed.y).toBeLessThan(0.8);
  });

  it('people meet only the ramp', async () => {
    const rig = await rigWith([...FLIGHT, ...carStops(FLIGHT)]);
    rig.physics.world.step();
    const ped = groups(CG.PED, CG.WORLD), car = groups(CG.CAR, CG.WORLD);
    const down = (z: number, g: number) => 5 - (rig.physics.raycast({ x: 3, y: 5, z }, { x: 0, y: -1, z: 0 }, 6, g)?.distance ?? 5);
    // Halfway up the flight the ramp is at ~0.68 m; the car block there is higher.
    expect(down(RUN / 2, ped)).toBeCloseTo(1.35 / 2, 0);
    expect(down(RUN / 2, car)).toBeGreaterThan(CAR_STOP);
  });

  it('祈年殿: every flight gets one', () => {
    const { colliders } = qiniandianParts();
    expect(carStops(colliders)).toHaveLength(colliders.filter((c) => c.walkOnly).length);
  });
});
