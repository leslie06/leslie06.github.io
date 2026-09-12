/**
 * Headless test rig: a Rapier world with ground, optional ramps, and one car. Used by the handling
 * tests and by anything that wants to drive the car without a renderer. Node-safe.
 */
import * as THREE from 'three';
import { Physics, CG, groups } from '../core/Physics';
import { Vehicle } from './Vehicle';
import { TAXI, type VehicleSpec } from './Spec';
import { ControlFilter, emptyControls, type DriveInput, type VehicleControls } from './ControlFilter';
import type { PilotView } from './Autopilot';

export interface Ramp { x: number; z: number; yaw: number; length: number; width: number; height: number }

export class Rig {
  readonly filter = new ControlFilter();
  time = 0;
  constructor(readonly physics: Physics, readonly car: Vehicle) {}

  static async create(opts: { spec?: VehicleSpec; ramps?: Ramp[]; slope?: number; at?: THREE.Vector3Like; yaw?: number } = {}): Promise<Rig> {
    const physics = new Physics();
    await physics.init();
    const R = physics.R;
    const ground = physics.world.createRigidBody(R.RigidBodyDesc.fixed());
    const slope = opts.slope ?? 0;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slope);
    physics.world.createCollider(R.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(0, -1, 0).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.9).setCollisionGroups(groups(CG.WORLD, CG.ALL)), ground);
    for (const r of opts.ramps ?? []) addRamp(physics, r);
    const at = opts.at ?? { x: 0, y: 0.36, z: 0 };
    const car = new Vehicle(physics, opts.spec ?? TAXI, at, opts.yaw ?? 0);
    return new Rig(physics, car);
  }

  /** Advance one fixed step with raw controls (bypassing the filter). */
  stepControls(c: VehicleControls, dt = this.physics.fixedDt): void {
    this.car.step(c, dt);
    this.physics.step();
    this.car.afterStep(dt);
    this.time += dt;
  }

  /** Advance one fixed step with driver intent, through the same filter the game uses. */
  stepInput(i: DriveInput, dt = this.physics.fixedDt): VehicleControls {
    const c = this.filter.update(i, this.car.forwardSpeed, dt);
    this.stepControls(c, dt);
    return c;
  }

  settle(seconds = 1.5): void {
    const idle = emptyControls();
    for (let t = 0; t < seconds; t += this.physics.fixedDt) this.stepControls(idle);
  }

  /** Give the car a forward speed (m/s) without driving it there. */
  launch(speed: number): void { this.car.setMoving(speed); }

  view(): PilotView {
    const c = this.car;
    return { x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.fwd.x, c.fwd.z), vx: c.vel.x, vz: c.vel.z, forwardSpeed: c.forwardSpeed,
      bodySlip: c.bodySlip, maxSteer: c.maxSteerAngle(Math.abs(c.forwardSpeed)), wheelbase: c.wheelbase };
  }
}

export function addRamp(physics: Physics, r: Ramp): void {
  const R = physics.R;
  const angle = Math.atan2(r.height, r.length);
  const hyp = Math.hypot(r.height, r.length);
  const thick = 0.5;
  // A tilted slab whose top surface rises from ground level at the near end to `height`.
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-angle, r.yaw, 0, 'YXZ'));
  const centre = new THREE.Vector3(0, r.height / 2 - thick / 2 * Math.cos(angle), r.length / 2 + thick / 2 * Math.sin(angle)).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw);
  const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed());
  physics.world.createCollider(R.ColliderDesc.cuboid(r.width / 2, thick / 2, hyp / 2)
    .setTranslation(r.x + centre.x, centre.y, r.z + centre.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setFriction(0.9).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body);
}

/**
 * Turns an analogue command into key presses the way a person taps keys: the key state is decided
 * once per `period` frames (8 = 7.5 Hz), held down for a share of it proportional to the command.
 */
export class KeyTapper {
  private frame = 0;
  private duty = 0;
  private dir = 0;
  constructor(private readonly period = 8) {}
  tap(v: number): number {
    const f = this.frame % this.period;
    if (f === 0) { this.duty = Math.round(Math.min(1, Math.abs(v)) * this.period); this.dir = Math.sign(v); }
    this.frame++;
    return f < this.duty ? this.dir : 0;
  }
}
