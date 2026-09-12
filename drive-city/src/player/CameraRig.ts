import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { CameraApi, CameraMode, PlayerApi, VehicleApi } from '../game/Contracts';
import { smoothstep, wrapAngle } from '../vehicle/Tire';

interface ModeCfg { dist: number; height: number; look: number; fov: number }
const MODES: Record<Exclude<CameraMode, 'hood'>, ModeCfg> = {
  chase: { dist: 5.9, height: 1.8, look: 1.05, fov: 62 },
  far: { dist: 8.4, height: 2.6, look: 1.2, fov: 58 },
  near: { dist: 4.3, height: 1.4, look: 0.95, fov: 66 },
};
const ORDER: CameraMode[] = ['chase', 'far', 'near', 'hood'];

/**
 * GTA-style chase camera.
 *
 * It trails the car's heading with a lag, but swings part-way towards the direction of travel once
 * the car slides, so a drift is framed from outside the arc instead of from behind the bumper. The
 * mouse (or right stick) orbits freely and the orbit drifts back behind the car after a second and
 * a half of driving. FOV opens with speed; impacts and landings shake it. A ray from the car to the
 * camera pulls it in front of walls.
 */
export class CameraRig implements CameraApi {
  name = 'camera';
  mode: CameraMode = 'chase';
  override: CameraApi['override'] = null;
  private yaw = 0;
  private y = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private sinceOrbit = 99;
  private shakeAmt = 0;
  private fov = 62;
  private dist = 5.9;
  private snapNext = true;
  private t = 0;
  private readonly look = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly rayGroups = groups(CG.CAR, CG.WORLD);

  constructor(private engine: Engine) {
    engine.events.on('vehicle:impact', ({ strength }) => this.shake(Math.min(1, strength / 10)));
    engine.events.on('vehicle:land', ({ airTime }) => this.shake(Math.min(0.6, airTime * 0.5)));
    engine.events.on('vehicle:reset', () => this.snap());
  }

  shake(amount: number): void { this.shakeAmt = Math.min(1.2, this.shakeAmt + amount); }
  snap(): void { this.snapNext = true; }

  update(dt: number): void {
    const cam = this.engine.camera;
    if (this.override) { this.override(cam, dt); this.snapNext = true; return; }
    const v = this.engine.get<VehicleApi>('vehicle');
    if (!v) return;
    this.t += dt;
    const inp = this.engine.input.state;
    if (inp.cameraPressed && v.inputEnabled) this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    const pl = this.engine.get<PlayerApi>('player');
    if (pl?.foot) { this.onFoot(cam, dt, pl.foot, v.inputEnabled); return; }
    const car = v.car;
    const p = v.renderPos;
    this.fwd.set(0, 0, 1).applyQuaternion(v.renderQuat);
    const carYaw = Math.atan2(this.fwd.x, this.fwd.z);
    const speed = car.speed;

    if (this.mode === 'hood') {
      cam.position.copy(this.tmp.set(0, 0.92, 0.35).applyQuaternion(v.renderQuat).add(p));
      cam.quaternion.copy(v.renderQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      this.fov = 74 + 8 * smoothstep(10, 45, speed);
      cam.fov = this.fov; cam.updateProjectionMatrix();
      this.snapNext = true;
      return;
    }

    const cfg = MODES[this.mode];
    // Big vehicles need a bigger box: a 12 m bus would otherwise swallow the camera.
    const size = v.model.size;
    const grow = Math.max(0, size.length - 4.6) * 0.55;
    const rise = Math.max(0, size.height - 1.5) * 0.6;
    // Heading target: the car's nose, leaning towards the direction of travel in a slide.
    let target = carYaw;
    if (car.forwardSpeed > 3) {
      const velYaw = Math.atan2(car.vel.x, car.vel.z);
      // 0.65 of the slide: at 0.45 a 45° drift showed only ~20° of flank and read as "straight with smoke".
      target = carYaw + wrapAngle(velYaw - carYaw) * 0.65 * smoothstep(4, 12, speed);
    }
    // Orbit input.
    if (v.inputEnabled && (inp.lookDX !== 0 || inp.lookDY !== 0)) {
      this.orbitYaw -= inp.lookDX * 0.0032;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + inp.lookDY * 0.0025, -0.25, 0.9);
      this.sinceOrbit = 0;
    } else this.sinceOrbit += dt;
    if (this.sinceOrbit > 1.5 && speed > 2) {
      const k = 1 - Math.exp(-dt * 2.5);
      this.orbitYaw += (wrapAngle(0 - this.orbitYaw)) * k;
      this.orbitPitch += (0 - this.orbitPitch) * k;
    }
    this.orbitYaw = wrapAngle(this.orbitYaw);
    const lookBack = v.inputEnabled && inp.lookBack ? Math.PI : 0;

    if (this.snapNext) { this.yaw = target; this.y = p.y; this.dist = cfg.dist + grow; this.fov = cfg.fov; }
    const follow = 1 - Math.exp(-dt * (2.6 + 3 * smoothstep(5, 30, speed)));
    this.yaw += wrapAngle(target - this.yaw) * follow;
    // Height follows with more lag than yaw: jumps and dips read as motion instead of being cancelled.
    this.y += (p.y - this.y) * (1 - Math.exp(-dt * 5));
    const wantDist = cfg.dist + grow + speed * 0.022 + THREE.MathUtils.clamp(car.accel.z * 0.05, -0.3, 0.5);
    this.dist += (wantDist - this.dist) * (1 - Math.exp(-dt * 3));

    const yaw = this.yaw + this.orbitYaw + lookBack;
    const pitch = 0.1 + this.orbitPitch;
    this.look.set(p.x, this.y + cfg.look, p.z);
    const horiz = this.dist * Math.cos(pitch);
    this.pos.set(this.look.x - Math.sin(yaw) * horiz, this.look.y + cfg.height + rise - cfg.look + this.dist * Math.sin(pitch), this.look.z - Math.cos(yaw) * horiz);

    // Keep the camera out of walls: pull it in to just short of whatever is between it and the car.
    this.tmp.subVectors(this.pos, this.look);
    const len = this.tmp.length();
    this.tmp.divideScalar(len);
    const hit = this.engine.physics.raycast(this.look, this.tmp, len, this.rayGroups, true, car.body);
    if (hit && hit.userData.tag !== 'prop') this.pos.copy(this.look).addScaledVector(this.tmp, Math.max(1.2, hit.distance - 0.3));
    this.pos.y = Math.max(this.pos.y, 0.45);

    // Shake: impacts, landings and a little road rumble at speed.
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    const rumble = 0.012 * smoothstep(15, 50, speed);
    const a = this.shakeAmt * this.shakeAmt * 0.35 + rumble;
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.3 + o * 1.7) * 0.4;
    this.pos.x += n(31, 0) * a; this.pos.y += n(37, 2) * a; this.pos.z += n(29, 4) * a;

    cam.position.copy(this.pos);
    // Look ahead along the nose, turning halfway towards the direction of travel in a slide.
    const lead = this.tmp.copy(this.fwd);
    const slideW = car.forwardSpeed > 3 ? smoothstep(0.15, 0.35, Math.abs(car.bodySlip)) : 0;
    if (slideW > 0 && car.speed > 0.1) {
      const vx = car.vel.x / car.speed, vz = car.vel.z / car.speed;
      lead.x += (vx - lead.x) * 0.5 * slideW; lead.z += (vz - lead.z) * 0.5 * slideW;
      lead.normalize();
    }
    lead.multiplyScalar(1.6);
    if (lookBack) lead.negate();
    cam.lookAt(this.look.x + lead.x, this.look.y + 0.15, this.look.z + lead.z);
    cam.rotateZ(n(23, 5) * a * 0.4);
    const wantFov = cfg.fov + 16 * smoothstep(8, 48, speed) + this.shakeAmt * 3;
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-dt * 4));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.snapNext = false;
  }

  /**
   * On foot: a free orbit around the character's shoulders (mouse or right stick), drifting back
   * behind the character while it moves, pulled in front of walls.
   */
  private footYaw = 0;
  private footPitch = 0.18;
  private onFoot(cam: THREE.PerspectiveCamera, dt: number, f: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number }, input: boolean): void {
    const inp = this.engine.input.state;
    this.t += dt;
    if (this.snapNext) { this.footYaw = f.yaw; this.footPitch = 0.18; this.y = f.pos.y; }
    if (input && (inp.lookDX !== 0 || inp.lookDY !== 0)) {
      this.footYaw -= inp.lookDX * 0.0032;
      this.footPitch = THREE.MathUtils.clamp(this.footPitch + inp.lookDY * 0.0025, -0.5, 1.1);
      this.sinceOrbit = 0;
    } else this.sinceOrbit += dt;
    const speed = Math.hypot(f.vel.x, f.vel.z);
    if (this.sinceOrbit > 2 && speed > 1.5) this.footYaw += wrapAngle(f.yaw - this.footYaw) * (1 - Math.exp(-dt * 1.2));
    this.y += (f.pos.y - this.y) * (1 - Math.exp(-dt * 8));
    const dist = 3.3 + smoothstep(3, 6.5, speed) * 0.7;
    this.look.set(f.pos.x, this.y + 1.55, f.pos.z);
    const horiz = dist * Math.cos(this.footPitch);
    // Over the right shoulder: the camera's right is -X of its heading frame.
    const rx = -Math.cos(this.footYaw), rz = Math.sin(this.footYaw);
    this.pos.set(this.look.x - Math.sin(this.footYaw) * horiz + rx * 0.45, this.look.y + dist * Math.sin(this.footPitch), this.look.z - Math.cos(this.footYaw) * horiz + rz * 0.45);
    this.tmp.subVectors(this.pos, this.look);
    const len = this.tmp.length();
    this.tmp.divideScalar(len);
    const hit = this.engine.physics.raycast(this.look, this.tmp, len, this.rayGroups, true);
    if (hit && hit.userData.tag !== 'prop' && hit.userData.tag !== 'player') this.pos.copy(this.look).addScaledVector(this.tmp, Math.max(0.6, hit.distance - 0.25));
    this.pos.y = Math.max(this.pos.y, 0.35);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    const a = this.shakeAmt * this.shakeAmt * 0.3;
    this.pos.x += Math.sin(this.t * 31) * a; this.pos.y += Math.sin(this.t * 37 + 2) * a;
    cam.position.copy(this.pos);
    cam.lookAt(this.look.x + rx * 0.45, this.look.y, this.look.z + rz * 0.45);
    this.fov += (60 - this.fov) * (1 - Math.exp(-dt * 4));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.snapNext = false;
  }
}

export async function install(engine: Engine): Promise<void> {
  engine.add(new CameraRig(engine));
}

