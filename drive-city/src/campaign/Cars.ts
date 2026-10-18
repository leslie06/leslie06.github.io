import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CarLook, NavApi, VehicleApi } from '../game/Contracts';
import type { FxApi } from '../fx';
import { Pursuit } from '../police/Pursuit';
import { CarKit } from '../traffic/CarKit';
import type { Livery } from '../vehicle/CarModel';
import { ControlFilter } from '../vehicle/ControlFilter';
import { bodySettled, type BodySource, type BodyType } from '../vehicle/Bodies';
import { SPEC_OF } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';

const HOLD = { throttle: 0, brake: 1, steer: 0, handbrake: true, reverse: false, burnout: false };

/**
 * A car a mission owns (docs/gta-plan.md §4): the mission car the player is given, or an enemy. While it is not the
 * player's car the mission simulates it (parked on its handbrake, or driven by `driver`) and draws it in its own kit
 * (its livery: door lettering, plate); once the player is in it the vehicle module does both. Enemy cars take damage
 * like the police's (hard knocks off `hp`; at 0, or on their roof for 2.5 s, they are wrecked: stopped, smoking).
 */
export class ScriptCar {
  readonly car: Vehicle;
  readonly look: CarLook;
  readonly kit: CarKit;
  /** A driver's input each fixed step (an enemy's `Pursuit`), or null: parked. */
  driver: ((dt: number) => import('../vehicle/ControlFilter').DriveInput) | null = null;
  readonly filter = new ControlFilter();
  /** The player may get in with F (traffic's external cars). */
  takeable = false;
  hp = 100;
  /** Seconds since wrecked, or -1. */
  wreck = -1;
  private flipped = 0; private hitT = 0; private smokeT = 0;
  private prevPos = new THREE.Vector3(); private curPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion(); private curQuat = new THREE.Quaternion();
  private p = new THREE.Vector3(); private q = new THREE.Quaternion();
  on = false;

  constructor(private engine: Engine, body: BodyType, livery: Livery) {
    const b: BodyType = bodySettled(body as BodySource) ? body : 'sedan';
    this.car = new Vehicle(engine.physics, SPEC_OF[b], { x: 0, y: -700, z: 0 }, 0);
    this.car.body.setEnabled(false);
    this.kit = new CarKit(engine.scene, 1, livery, b);
    this.look = { upper: new THREE.Color(livery.upper), lower: new THREE.Color(livery.lower), taxi: false, body: b, parked: true, livery };
  }

  private get mine(): boolean { return this.engine.get<VehicleApi>('vehicle')?.car === this.car; }

  /** Put it on the road at (x, z) facing `yaw` (atan2(dx, dz)), standing. */
  place(x: number, z: number, yaw: number, y = 0): void {
    this.on = true; this.wreck = -1; this.hp = 100; this.flipped = 0;
    this.car.body.setEnabled(true);
    this.car.reset({ x, y: y + 0.03 + this.car.spec.wheelRadius + 0.04, z }, yaw);
    this.filter.reset();
    this.prevPos.copy(this.car.pos); this.curPos.copy(this.car.pos); this.prevQuat.copy(this.car.quat); this.curQuat.copy(this.car.quat);
  }

  /** Gone (out of the world), unless the player is driving it: then it is theirs and the mission lets go. */
  remove(): void {
    if (this.mine) { this.on = false; this.takeable = false; return; }
    this.on = false; this.takeable = false; this.driver = null;
    this.car.body.setTranslation({ x: 0, y: -700, z: 0 }, false);
    this.car.body.setEnabled(false);
    this.kit.commit(0);
  }

  fixed(dt: number): void {
    if (!this.on || this.mine) return;
    this.prevPos.copy(this.curPos); this.prevQuat.copy(this.curQuat);
    if (this.driver && this.wreck < 0) this.car.step(this.filter.update(this.driver(dt), this.car.forwardSpeed, dt), dt);
    else this.car.step(HOLD, dt);
  }

  post(dt: number): void {
    if (!this.on || this.mine) return;
    this.car.afterStep(dt);
    this.curPos.copy(this.car.pos); this.curQuat.copy(this.car.quat);
    if (!this.driver) return;
    // damage, as the police's
    this.hitT -= dt;
    if (this.wreck < 0 && this.car.impact > 6 && this.hitT <= 0) { this.hitT = 0.35; this.hp -= Math.min(45, (this.car.impact - 6) * 7); }
    this.flipped = this.car.up.y < 0.5 ? this.flipped + dt : 0;
    if (this.wreck < 0 && (this.hp <= 0 || this.flipped > 2.5)) this.wreck = 0;
    if (this.wreck >= 0) {
      this.wreck += dt; this.smokeT -= dt;
      const fx = this.engine.get<FxApi>('fx');
      if (fx && this.smokeT <= 0) { this.smokeT = 0.09; const c = this.car.pos, f = this.car.fwd; fx.smoke(c.x + f.x * 1.6, c.y + 0.9, c.z + f.z * 1.6, 0, 1.6, 0, 1.4, 2.4, 1); }
    }
  }

  draw(alpha: number): void {
    if (!this.on || this.mine) { this.kit.commit(0); return; }
    this.p.lerpVectors(this.prevPos, this.curPos, alpha); this.q.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    this.kit.set(0, this.p, this.q, this.car, this.look.upper, this.look.lower, false);
    this.kit.commit(1);
  }

  /**
   * Drive at the player with `Pursuit`: `ram` straight through them, else box in. `top` may change as it goes (read
   * each step after `target`: chapter 5's escorts slow to let the truck catch up instead of turning round for it).
   */
  chase(nav: NavApi | undefined, target: () => { x: number; z: number; vx: number; vz: number }, opts: { ram?: boolean; top?: number | (() => number) } = {}): void {
    const pursuit = new Pursuit();
    const top = opts.top ?? 30;
    pursuit.topSpeed = typeof top === 'number' ? top : 30;
    const route = nav ? (a: number, b: number, c: number, d: number, e: number) => nav.route(a, b, c, d, e) : null;
    this.driver = (dt) => {
      const g = target(), d = Math.hypot(g.x - this.car.pos.x, g.z - this.car.pos.z);
      if (typeof top === 'function') pursuit.topSpeed = top();
      return pursuit.update(this.car, g, d < 45, dt, route, false, !!opts.ram && d < 45, !opts.ram && d < 30);
    };
  }
}
