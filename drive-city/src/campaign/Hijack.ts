import type { CarLook } from '../game/Contracts';
import type { Vehicle } from '../vehicle/Vehicle';
import type { ScriptCar } from './Cars';
import type { Env } from './Kit';

/** A car as the leap sees it: where, which way its nose points (unit), how fast (m/s, world). */
export interface Pose { x: number; z: number; fx: number; fz: number; vx: number; vz: number }

/**
 * Close enough alongside to leap across (2026-10-14, 「高速跳车夺车」): within ALONG metres ahead or behind, SIDE_MIN to
 * SIDE_MAX off to one side, pointing the same way within ANGLE, and the two speeds within REL of each other. Generous on
 * purpose: matching a fleeing car in traffic for a moment is the hard part, not the timing of F.
 */
export const LEAP = { ALONG: 3.6, SIDE_MIN: 1.2, SIDE_MAX: 5.2, ANGLE: 35 * Math.PI / 180, REL: 6.5 };

export type Alongside = { ok: true; side: number; along: number } | { ok: false; why: 'far' | 'angle' | 'speed' };

export function alongside(me: Pose, it: Pose): Alongside {
  const dx = it.x - me.x, dz = it.z - me.z;
  const along = dx * me.fx + dz * me.fz, side = dx * me.fz - dz * me.fx;
  if (Math.abs(along) > LEAP.ALONG || Math.abs(side) < LEAP.SIDE_MIN || Math.abs(side) > LEAP.SIDE_MAX) return { ok: false, why: 'far' };
  if (me.fx * it.fx + me.fz * it.fz < Math.cos(LEAP.ANGLE)) return { ok: false, why: 'angle' };
  if (Math.hypot(me.vx - it.vx, me.vz - it.vz) > LEAP.REL) return { ok: false, why: 'speed' };
  return { ok: true, side, along };
}

export const poseOf = (c: Vehicle): Pose => ({ x: c.pos.x, z: c.pos.z, fx: c.fwd.x, fz: c.fwd.z, vx: c.vel.x, vz: c.vel.z });

/**
 * The hijack: while the player drives alongside `target`, F (PlayerApi.offer, which takes F over from getting out) leaps
 * across (PlayerApi.leap). On landing the target is the player's, its driver thrown out onto the road to run for it,
 * and the car left behind rolls on: a mission car stays the mission's (ScriptCar simulates it again), any other is
 * handed to traffic as parked. Short of it, the player is down on the road and can try again from another car.
 */
export class Hijack {
  /** Leaps tried, and whether one is in the air. */
  tries = 0;
  busy = false;
  /** Lined up this frame (the HUD prompt is up). */
  aligned = false;

  constructor(private env: Env, private o: {
    target: () => ScriptCar | null;
    label: () => string;
    landed(prev: { car: Vehicle; look: CarLook }): void;
    missed(): void;
  }) {}

  /** Each frame while the hijack is on: offers the leap when lined up. */
  update(): boolean {
    const env = this.env, sc = this.o.target(), v = env.v;
    this.aligned = false;
    if (!sc || !sc.on || this.busy || env.pl.mode !== 'driving' || !v.occupied || v.car === sc.car || env.pl.leaping) return false;
    if (!alongside(poseOf(v.car), poseOf(sc.car)).ok) return false;
    this.aligned = true;
    env.pl.offer?.({ x: sc.car.pos.x, z: sc.car.pos.z, r: 9, label: this.o.label(), use: () => this.go(sc) });
    return true;
  }

  private go(sc: ScriptCar): void {
    const env = this.env;
    if (this.busy) return;
    const started = env.pl.leap?.(sc.car, { ...sc.look, parked: false }, (r) => {
      this.busy = false;
      if (!r.ok || !r.prev) { this.o.missed(); return; }
      // the driver goes out of the far door and runs
      const c = sc.car, side = (env.v.car.pos.x - r.prev.car.pos.x) * c.left.x + (env.v.car.pos.z - r.prev.car.pos.z) * c.left.z >= 0 ? 1 : -1;
      env.people?.spawnFleeing(c.pos.x + c.left.x * side * 1.8 - c.fwd.x * 0.6, c.pos.z + c.left.z * side * 1.8 - c.fwd.z * 0.6, { voice: 'driver', say: 'car_stolen' });
      sc.driver = null; sc.takeable = false;
      const mission = [...env.cars].some((m) => m.car === r.prev!.car);
      if (!mission) env.tr.parkCar(r.prev.car, r.prev.look);
      this.o.landed(r.prev);
    });
    if (started) { this.busy = true; this.tries++; }
  }
}
