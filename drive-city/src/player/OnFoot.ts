import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { CG, groups, type Physics } from '../core/Physics';
import { Gait } from '../character/Animator';

const HALF = 0.55, RADIUS = 0.28, FEET = HALF + RADIUS;

/**
 * The player on foot: a kinematic capsule moved by Rapier's character controller (steps, slopes,
 * snapping to the ground). It is blocked by buildings, props and cars, but it never pushes a car:
 * its own collision groups leave cars out, and car hits on the player are detected by distance and
 * speed (see player/index.ts), the way pedestrians are.
 */
export class OnFoot {
  readonly body: RAPIER_NS.RigidBody;
  readonly collider: RAPIER_NS.Collider;
  private ctl: RAPIER_NS.KinematicCharacterController;
  /** Feet position (render interpolation happens in the caller). */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  private vy = 0;
  readonly gait = new Gait();
  airTime = 0;
  /** Knocked down by a car: seconds into the fall, lying, getting up. */
  knock: { phase: 'knocked' | 'down' | 'getup'; t: number } | null = null;
  /** Wasted: stays down. */
  dead = false;
  /** Seconds left of the shove animation (also its cooldown). */
  private punchT = 0;
  private moveFilter = groups(CG.PED, CG.WORLD | CG.CAR | CG.PROP);
  private groundFilter = groups(CG.PED, CG.WORLD | CG.CAR | CG.PROP);

  constructor(private physics: Physics) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -200, 0));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(CG.PED, CG.WORLD | CG.PROP)), this.body);
    physics.tag(this.collider, { tag: 'player', surface: 'rubber' });
    this.ctl = physics.world.createCharacterController(0.04);
    this.ctl.enableAutostep(0.4, 0.15, false);
    this.ctl.enableSnapToGround(0.35);
    this.ctl.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.ctl.setApplyImpulsesToDynamicBodies(false);
    this.body.setEnabled(false);
  }

  get active(): boolean { return this.body.isEnabled(); }

  enable(x: number, y: number, z: number, yaw: number): void {
    this.body.setEnabled(true);
    this.body.setTranslation({ x, y: y + FEET + 0.02, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + FEET + 0.02, z });
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.vy = 0; this.yaw = yaw; this.knock = null; this.dead = false;
  }
  disable(): void { this.body.setEnabled(false); this.body.setTranslation({ x: 0, y: -200, z: 0 }, false); }

  /** Knock the player over (hit by a car): fly with `v`, then lie, then get up. */
  hit(v: THREE.Vector3): void {
    if (this.knock) return;
    this.knock = { phase: 'knocked', t: 0 };
    this.vel.copy(v); this.vy = Math.max(3, v.length() * 0.35);
  }

  /**
   * One fixed step. `mx/my` is the stick or WASD (-1..1, +my forward) relative to camera heading
   * `camYaw` (the direction the camera looks, atan2(x, z)).
   */
  step(mx: number, my: number, sprint: boolean, jump: boolean, camYaw: number, dt: number): void {
    if (!this.active) return;
    const t = this.body.translation();
    let dx = 0, dz = 0;
    if (this.knock) {
      const k = this.knock;
      k.t += dt;
      if (k.phase === 'knocked' && k.t > 0.4 && this.grounded) { k.phase = 'down'; k.t = 0; }
      else if (k.phase === 'down' && k.t > 1.6 && !this.dead) { k.phase = 'getup'; k.t = 0; }
      else if (k.phase === 'getup' && k.t > 0.9) this.knock = null;
      const drag = this.grounded ? Math.exp(-dt * 6) : Math.exp(-dt * 0.5);
      this.vel.x *= drag; this.vel.z *= drag;
      dx = this.vel.x * dt; dz = this.vel.z * dt;
    } else {
      const len = Math.min(1, Math.hypot(mx, my));
      // Camera-relative: forward is where the camera looks; +X is the camera's left.
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw), lx = fz, lz = -fx;
      let wx = fx * my - lx * mx, wz = fz * my - lz * mx;
      const wl = Math.hypot(wx, wz);
      if (wl > 1e-3) { wx /= wl; wz /= wl; }
      const top = sprint ? 6.4 : len < 0.55 ? 1.7 : 3.9;
      const target = len > 0.05 ? top * Math.max(len, 0.35) : 0;
      const k = 1 - Math.exp(-dt * (this.grounded ? 10 : 2));
      this.vel.x += (wx * target - this.vel.x) * k;
      this.vel.z += (wz * target - this.vel.z) * k;
      if (len > 0.05) {
        const want = Math.atan2(wx, wz);
        let d = want - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        this.yaw += d * Math.min(1, dt * 12);
      }
      if (jump && this.grounded) { this.vy = 4.8; this.grounded = false; }
      dx = this.vel.x * dt; dz = this.vel.z * dt;
    }
    this.vy -= 9.81 * dt;
    this.ctl.computeColliderMovement(this.collider, { x: dx, y: this.vy * dt, z: dz }, undefined, this.moveFilter);
    const m = this.ctl.computedMovement();
    this.grounded = this.ctl.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    const nx = t.x + m.x, nz = t.z + m.z;
    let ny = t.y + m.y;
    // Rapier's character controller creeps into very large colliders (the city ground is a 28 km
    // box), so gravity sank the character a few millimetres every step: after a minute's walk they
    // were buried to the waist. Resolve the feet against a ray instead; this only ever lifts them.
    if (this.vy <= 0) {
      const from = ny - FEET + 0.6;
      const hit = this.physics.raycast({ x: nx, y: from, z: nz }, { x: 0, y: -1, z: 0 }, 2.4, this.groundFilter, true);
      if (hit) {
        const groundY = from - hit.distance;
        if (ny - FEET < groundY) { ny = groundY + FEET; this.grounded = true; this.vy = 0; }
      }
    }
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    // The controller slides along obstacles: velocity follows what actually happened.
    if (!this.knock) { this.vel.x = m.x / dt; this.vel.z = m.z / dt; }
    this.pos.set(nx, ny - FEET, nz);
    if (ny < -20) this.enable(nx, 0.5, nz, this.yaw);
  }

  /** Start a shove. False when knocked down or still swinging. */
  shove(): boolean {
    if (this.knock || this.punchT > 0) return false;
    this.punchT = 0.42;
    return true;
  }

  /** Pose for this frame. */
  animate(dt: number): void {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.punchT > 0 && !this.knock) {
      this.punchT = Math.max(0, this.punchT - dt);
      this.gait.update({ speed, action: 'punch', t: 0.42 - this.punchT }, dt, 0.3);
      return;
    }
    if (this.knock) this.gait.update({ speed: 0, action: this.knock.phase, t: this.knock.t }, dt, 0.3);
    else this.gait.update({ speed, action: this.grounded || this.airTime < 0.15 ? 'move' : 'air', t: this.airTime }, dt, 0.3);
  }
}

export const FEET_OFFSET = FEET;
