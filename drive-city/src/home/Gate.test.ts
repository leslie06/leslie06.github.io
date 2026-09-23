/**
 * Can a car actually get through the gate, from wherever it happens to come at it?
 *
 * The block around the plot is an OSM parking lot and two pitches: flat drivable paving with no
 * colliders, so nobody arrives along the drive's axis off 恒惠路 the way every home probe did. The
 * player in the screenshot of 2026-09-23 (「我把车开到家门口就卡住了」) came diagonally across that
 * plaza from the south-west. With straight walls and piers on the plot line, that line put the taxi's
 * nose into the inside corner between the wall's face and the south pier's face - where the throttle
 * only spins the wheels, sliding along the wall is stopped by the pier, and only reverse gets it out.
 *
 * Nothing in Layout's numbers says whether that corner exists, so this drives the real Vehicle with
 * the real PathPilot through the villa's real colliders (built as placeLandmarks builds them) in a
 * Rapier world, along the lines a player takes, and asks the only question that matters: does it
 * reach the motor court, or does it stop?
 */
import { describe, expect, it } from 'vitest';
import { CG, groups } from '../core/Physics';
import { PathPilot } from '../vehicle/Autopilot';
import { Rig } from '../vehicle/Rig';
import { DRIVE, EDGE, GATE, PLOT } from './Layout';
import { buildVillaStatic } from './Villa';

const DT = 1 / 60;
const colliders = buildVillaStatic().colliders;
/** The middle of the gate opening, on the plot wall's line. */
const GATE_AT: [number, number] = [-(PLOT.hw - EDGE.inset) + 0.5, GATE.z];

/** A Rig standing at villa-local (x, z), with the villa's colliders added as placeLandmarks adds them. */
async function rigAt(x: number, z: number, yaw: number): Promise<Rig> {
  const rig = await Rig.create({ at: { x, y: 0.36, z }, yaw });
  const { R, world } = rig.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL), gWalk = groups(CG.WORLD, CG.ALL & ~CG.CAR);
  for (const sp of colliders) {
    let desc: ReturnType<typeof R.ColliderDesc.cuboid> | null = null;
    if (sp.kind === 'box') {
      const yaw = sp.yaw ?? 0;
      desc = R.ColliderDesc.cuboid(sp.half[0], sp.half[1], sp.half[2])
        .setTranslation(sp.center[0], sp.center[1], sp.center[2])
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    } else if (sp.kind === 'cylinder') {
      desc = R.ColliderDesc.cylinder(sp.halfHeight, sp.radius).setTranslation(sp.center[0], sp.center[1], sp.center[2]);
    } else {
      desc = R.ColliderDesc.convexHull(new Float32Array(sp.points));
    }
    if (desc) world.createCollider(desc.setCollisionGroups(sp.walkOnly ? gWalk : g).setFriction(0.6), body);
  }
  return rig;
}

interface Run { reached: boolean; stopped: boolean; at: [number, number]; t: number; trail: string }

/**
 * Drive a straight line from `from` to the middle of the gate, then east along the drive, at
 * `speed` m/s (20 km/h is what the screenshot shows), and say where it got to.
 */
async function driveIn(from: [number, number], facing?: number, speed = 6): Promise<Run> {
  const path: [number, number][] = [];
  const n = Math.ceil(Math.hypot(GATE_AT[0] - from[0], GATE_AT[1] - from[1]));
  for (let i = 0; i <= n; i++) path.push([from[0] + (GATE_AT[0] - from[0]) * i / n, from[1] + (GATE_AT[1] - from[1]) * i / n]);
  for (let x = GATE_AT[0] + 1; x <= DRIVE.court.x1 - 4; x += 1) path.push([x, GATE.z]);
  // yaw 0 faces +z, π/2 faces +x. Facing the gate unless told otherwise.
  const rig = await rigAt(from[0], from[1], facing ?? Math.atan2(GATE_AT[0] - from[0], GATE_AT[1] - from[1]));
  rig.settle(0.5);
  const pilot = new PathPilot(path, { speed, lookahead: 6, closed: false });
  const car = rig.car;
  const trail: string[] = [];
  let still = 0;
  for (let t = 0; t < 20; t += DT) {
    rig.stepInput(pilot.update(rig.view(), DT));
    const sp = Math.hypot(car.vel.x, car.vel.z);
    if (Math.round(t / DT) % 30 === 0) trail.push(`${t.toFixed(1)}s (${car.pos.x.toFixed(1)}, ${car.pos.z.toFixed(1)}) ${(sp * 3.6).toFixed(0)} km/h`);
    const at: [number, number] = [+car.pos.x.toFixed(2), +car.pos.z.toFixed(2)];
    if (car.pos.x > DRIVE.court.x0 && Math.abs(car.pos.z - GATE.z) < 4) return { reached: true, stopped: false, at, t, trail: trail.join('\n') };
    if (t > 1.5 && sp < 0.3 && ++still >= 60) return { reached: false, stopped: true, at, t, trail: trail.join('\n') };
    if (sp >= 0.3) still = 0;
  }
  return { reached: false, stopped: false, at: [+car.pos.x.toFixed(2), +car.pos.z.toFixed(2)], t: 20, trail: trail.join('\n') };
}

describe('我家 the gate', () => {
  it('opens a mouth wider than the gap between the piers', () => {
    // The clear opening between the wings, and the mouth on the plot line where a car turns in.
    expect(GATE.w).toBeGreaterThan(7);
    expect(GATE.splay).toBeGreaterThanOrEqual(3);
  });

  // The lines a player takes across the plaza: a straight run at the middle of the gate, then the
  // turn east onto the drive. Some start already facing the gate; the ones facing east start as a
  // player who has just turned off the pavement, still swinging round, and reach the plot wall on a
  // curve that grazes it beside the opening - the lines the straight-walled gate held fast, its pier
  // catching the nose (the first of those is the screenshot's).
  const EAST = Math.PI / 2;
  const lines: [string, [number, number], number?][] = [
    ['from the south-west, across the plaza', [-56, 2]],
    ['from the south-west, still turning in (the screenshot)', [-56, 2], EAST],
    ['from the north-west, across the plaza', [-56, -22]],
    ['from the north-west, still turning in', [-56, -22], EAST],
    ['up the plot wall from the south', [-52, 12]],
    ['straight in off 恒惠路', [-66, GATE.z]],
    ['from the south-west, further out', [-64, 8]],
    ['from the north-west, further out', [-64, -28]],
  ];
  for (const [name, from, facing] of lines) {
    it(`lets a taxi in ${name}`, async () => {
      const run = await driveIn(from, facing);
      expect(run.stopped, `stopped at (${run.at}) after ${run.t.toFixed(1)} s\n${run.trail}`).toBe(false);
      expect(run.reached, `never reached the court, last at (${run.at})\n${run.trail}`).toBe(true);
    }, 30000);
  }
});
