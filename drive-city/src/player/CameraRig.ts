import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { CameraApi, CameraMode, PlayerApi, VehicleApi } from '../game/Contracts';
import { smoothstep, wrapAngle } from '../vehicle/Tire';
import { Cockpit, eyeOf } from './Cockpit';

const _head = new THREE.Euler(), _hq = new THREE.Quaternion();

/** `wide`: degrees the lens opens with speed, from `v0` to `v1` m/s. */
interface ModeCfg { dist: number; height: number; look: number; fov: number; wide: number; v0: number; v1: number }
const MODES: Record<Exclude<CameraMode, 'hood'>, ModeCfg> = {
  // 2026-11-10 (docs/street-level-design.md A1, 「只是在地图上开车」): the default sat 2.7 m up looking 9 degrees down through a
  // 62 degree lens - the horizon 37% down the frame, 63% of it tarmac. Now about 2.2 m up, nearly level, a 50 degree lens:
  // the horizon near the middle, the street and what stands at its end 1.3 times the size. The lens opens with speed from
  // 20 km/h (a narrow lens alone reads slow). The old one is `high`.
  chase: { dist: 6.5, height: 1.1, look: 1.32, fov: 50, wide: 20, v0: 6, v1: 40 },
  high: { dist: 5.9, height: 1.8, look: 1.05, fov: 62, wide: 16, v0: 8, v1: 48 },
  far: { dist: 8.4, height: 2.6, look: 1.2, fov: 58, wide: 16, v0: 8, v1: 48 },
  near: { dist: 4.3, height: 1.4, look: 0.95, fov: 66, wide: 16, v0: 8, v1: 48 },
};
const ORDER: CameraMode[] = ['chase', 'high', 'far', 'near', 'hood'];

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
  indoor = 0;
  /** `indoor` eased: the room's camera comes in over a second. */
  private inK = 0;
  private yaw = 0;
  private y = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private sinceOrbit = 99;
  private shakeAmt = 0;
  private fov = MODES.chase.fov;
  private dist = MODES.chase.dist;
  private snapNext = true;
  private t = 0;
  private readonly look = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly rayGroups = groups(CG.CAR, CG.WORLD);
  private readonly cockpit: Cockpit;
  private headYaw = 0;
  private headPitch = 0;

  constructor(private engine: Engine) {
    this.cockpit = new Cockpit(engine);
    engine.events.on('vehicle:impact', ({ strength }) => {
      this.shake(Math.min(1.2, strength / 7));
      if (strength > 3) engine.input.rumble(Math.min(1, strength / 10), Math.min(1, strength / 6), 90 + Math.min(260, strength * 22));
    });
    // Knocking a bin or a railing flying: a little jolt, not a crash.
    engine.events.on('prop:hit', ({ kind, speed }) => { this.shake(Math.min(0.35, speed / (kind === 'rail' ? 50 : 70))); engine.input.rumble(0.15, 0.35, 70); });
    engine.events.on('vehicle:land', ({ airTime }) => { this.shake(Math.min(0.6, airTime * 0.5)); engine.input.rumble(0.3, 0.6, 120); });
    // a bridge's joint, a kerb (traffic/RoadFeel.ts): felt more than seen
    engine.events.on('road:bump', ({ strength, kind }) => {
      this.shake(Math.min(0.16, 0.05 + strength * 0.12));
      engine.input.rumble(kind === 'kerb' ? 0.3 : 0.12, 0.25 + strength * 0.3, 45);
      try { if (typeof navigator !== 'undefined' && matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(kind === 'kerb' ? 18 : 10); } catch { /* no vibration */ }
    });
    engine.events.on('vehicle:reset', () => this.snap());
  }

  shake(amount: number): void { this.shakeAmt = Math.min(1.2, this.shakeAmt + amount); }
  snap(orbit?: number): void {
    this.snapNext = true;
    if (orbit !== undefined) { this.orbitYaw = orbit; this.orbitPitch = 0; this.sinceOrbit = 0; }
  }

  update(dt: number): void {
    const cam = this.engine.camera;
    if (this.override) { this.cockpit.group.visible = false; this.override(cam, dt); this.snapNext = true; return; }
    const v = this.engine.get<VehicleApi>('vehicle');
    if (!v) return;
    this.t += dt;
    const inp = this.engine.input.state;
    if (inp.cameraPressed && v.inputEnabled) this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    const pl = this.engine.get<PlayerApi>('player');
    if (pl?.foot) { this.cockpit.update(v, false); this.onFoot(cam, dt, pl.foot, v.inputEnabled); return; }
    const car = v.car;
    const p = v.renderPos;
    this.fwd.set(0, 0, 1).applyQuaternion(v.renderQuat);
    const carYaw = Math.atan2(this.fwd.x, this.fwd.z);
    const speed = car.speed;

    // 车内 (Cockpit.ts): a small four-wheeled car has a cabin to sit in; a bus, a lorry and a two-wheeler keep the old point
    const cabin = this.mode === 'hood' && v.occupied && v.model.size.length < 5.6 && v.model.size.width > 1.2 && !['moto', 'bike', 'ebike'].includes(v.look.body ?? '');
    this.cockpit.update(v, cabin);
    if (this.mode === 'hood') {
      if (cabin) {
        // the head turns with the mouse or the right stick, and comes back to the road after a second and a half
        if (v.inputEnabled && (inp.lookDX !== 0 || inp.lookDY !== 0)) {
          this.headYaw = THREE.MathUtils.clamp(this.headYaw - inp.lookDX * 0.0032, -2, 2);
          this.headPitch = THREE.MathUtils.clamp(this.headPitch - inp.lookDY * 0.0025, -0.45, 0.4);
          this.sinceOrbit = 0;
        } else this.sinceOrbit += dt;
        if (this.sinceOrbit > 1.5) { const k = 1 - Math.exp(-dt * 3); this.headYaw -= this.headYaw * k; this.headPitch -= this.headPitch * k; }
        const back = v.inputEnabled && inp.lookBack ? 2.7 : 0;
        cam.position.copy(eyeOf(v.model.size.width).applyQuaternion(v.renderQuat).add(p));
        this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
        const a = this.shakeAmt * this.shakeAmt * 0.12 + 0.004 * smoothstep(15, 50, speed);
        cam.position.y += Math.sin(this.t * 37 + 2) * a;
        _head.set(this.headPitch, Math.PI + this.headYaw + back, 0, 'YXZ');
        cam.quaternion.copy(v.renderQuat).multiply(_hq.setFromEuler(_head));
        this.fov += (64 + 8 * smoothstep(10, 45, speed) - this.fov) * (1 - Math.exp(-dt * 4));
      } else {
        cam.position.copy(this.tmp.set(0, 0.92, 0.35).applyQuaternion(v.renderQuat).add(p));
        cam.quaternion.copy(v.renderQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
        this.fov = 74 + 8 * smoothstep(10, 45, speed);
      }
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
    // Never under the street - unless the car is below it (the underground car park), then not under its floor.
    this.pos.y = Math.max(this.pos.y, car.pos.y < -1 ? car.pos.y + 0.2 : 0.45);

    // Shake: impacts, landings and a little road rumble at speed.
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    // The nitro kicks: a wider lens (below) and a harder rumble while it burns.
    const rumble = 0.012 * smoothstep(15, 50, speed) + (v.nitroActive ? 0.03 : 0);
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
    const wantFov = cfg.fov + cfg.wide * smoothstep(cfg.v0, cfg.v1, speed) + this.shakeAmt * 3 + (v.nitroActive ? 10 : 0);
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
    // in a small room (a shop: `indoor`) closer and wider, lower over the shoulder, else the walls push it onto his head
    this.inK += (THREE.MathUtils.clamp(this.indoor, 0, 1) - this.inK) * (1 - Math.exp(-dt * 3));
    const k = this.inK;
    const dist = (3.3 + smoothstep(3, 6.5, speed) * 0.7) * (1 - 0.48 * k);
    this.look.set(f.pos.x, this.y + 1.55 - 0.12 * k, f.pos.z);
    const pitch = Math.min(this.footPitch, 0.55 - 0.25 * k);
    const horiz = dist * Math.cos(pitch);
    // Over the right shoulder: the camera's right is -X of its heading frame.
    const rx = -Math.cos(this.footYaw), rz = Math.sin(this.footYaw), sh = 0.45 - 0.15 * k;
    this.pos.set(this.look.x - Math.sin(this.footYaw) * horiz + rx * sh, this.look.y + dist * Math.sin(pitch), this.look.z - Math.cos(this.footYaw) * horiz + rz * sh);
    this.tmp.subVectors(this.pos, this.look);
    const len = this.tmp.length();
    this.tmp.divideScalar(len);
    const hit = this.engine.physics.raycast(this.look, this.tmp, len, this.rayGroups, true);
    if (hit && hit.userData.tag !== 'prop' && hit.userData.tag !== 'player') this.pos.copy(this.look).addScaledVector(this.tmp, Math.max(0.6, hit.distance - 0.25));
    this.pos.y = Math.max(this.pos.y, f.pos.y < -1 ? f.pos.y + 0.35 : 0.35);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    const a = this.shakeAmt * this.shakeAmt * 0.3;
    this.pos.x += Math.sin(this.t * 31) * a; this.pos.y += Math.sin(this.t * 37 + 2) * a;
    cam.position.copy(this.pos);
    cam.lookAt(this.look.x + rx * sh, this.look.y, this.look.z + rz * sh);
    this.fov += (60 + 12 * k - this.fov) * (1 - Math.exp(-dt * 4));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.snapNext = false;
  }
}

export async function install(engine: Engine): Promise<void> {
  engine.add(new CameraRig(engine));
}

