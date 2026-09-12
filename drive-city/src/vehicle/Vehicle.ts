import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { CG, groups, type Physics } from '../core/Physics';
import type { VehicleSpec } from './Spec';
import type { VehicleControls } from './ControlFilter';
import { clamp, clamp01, combine, lateralCurve, peakSlip, smoothstep, torqueAt } from './Tire';

const G = 9.81;

export class WheelState {
  contact = false;
  /** Metres the spring is compressed from its rest length. */
  compression = 0;
  /** Current spring length; the wheel hub sits this far below the hard point. */
  springLen: number;
  /** Normal load, N. */
  load = 0;
  /** Road-wheel steer angle, rad (left positive). */
  steer = 0;
  slipAngle = 0;
  /** Contact-patch velocity along / across the wheel, m/s. */
  vLong = 0; vLat = 0;
  /** 0..1: how hard the tyre is sliding, for marks, smoke and squeal. */
  skid = 0;
  locked = false;
  spinning = false;
  /** Rolling angle for the model, rad, and its rate. */
  spin = 0; spinRate = 0;
  readonly point = new THREE.Vector3();
  readonly normal = new THREE.Vector3(0, 1, 0);
  surface = 'asphalt';
  constructor(rest: number) { this.springLen = rest; }
}

// Scratch vectors: step() runs 60 times a second and must not allocate.
const _mount = new THREE.Vector3();
const _down = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _wl = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _g = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _combined = { x: 0, y: 0 };
const _rv = { x: 0, y: 0, z: 0 };
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * A ray-cast car on a Rapier rigid body.
 *
 * Why not Rapier's DynamicRayCastVehicleController: it is Bullet's btRaycastVehicle, whose tyres are
 * a friction-slip impulse with a hard sideways limit. Past that limit grip vanishes in one step, so
 * a slide either never starts or never stops, and there is nothing to tune in between. Here each
 * wheel is a spring-damper along a ray plus a slip-angle tyre (magic formula + friction ellipse),
 * so grip falls off gradually past the limit, weight transfer comes out of the suspension, and
 * every number in `VehicleSpec` has a physical meaning a test can measure.
 *
 * Forces are applied as impulses (F·dt) before the physics step, so nothing persists between
 * steps. Three things keep a stiff tyre stable at 60 Hz and at walking pace:
 *   - lateral force never exceeds what would cancel the contact patch's sideways velocity in one
 *     step (the tyre can stop a slide, not reverse it);
 *   - below ~3 m/s the tyre blends into a static-friction model that also cancels gravity along the
 *     slope, so a parked car stays parked on a ramp;
 *   - brakes are clamped the same way, so the car stops instead of rocking back and forth.
 */
export class Vehicle {
  readonly body: RAPIER_NS.RigidBody;
  readonly colliders: RAPIER_NS.Collider[] = [];
  readonly wheels: WheelState[];
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  readonly angVel = new THREE.Vector3();
  readonly fwd = new THREE.Vector3(0, 0, 1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly left = new THREE.Vector3(1, 0, 0);
  speed = 0;
  forwardSpeed = 0;
  lateralSpeed = 0;
  /** Angle between heading and travel, rad; + when the car moves to the right of where it points. */
  bodySlip = 0;
  yawRate = 0;
  /** Road-wheel angle after limiter + counter-steer, rad (left positive). */
  steerAngle = 0;
  rpm: number;
  /** -1 reverse, 1..n forward. */
  gear = 1;
  throttle = 0;
  brake = 0;
  handbrake = false;
  /** Wheels touching the ground. */
  grounded = 4;
  airTime = 0;
  /** Seconds spent on the roof or a side. */
  flippedTime = 0;
  /** Seconds since the last gear change (the HUD blinks the gear, audio dips the engine). */
  shiftTimer = 0;
  /** Smoothed body-frame acceleration (x left, y up, z forward), m/s², for body lean and camera. */
  readonly accel = new THREE.Vector3();
  /** Strongest unexplained velocity change in the last step, m/s (a collision). */
  impact = 0;
  readonly impactPoint = new THREE.Vector3();
  /** Seconds of the landing that just happened (set for one step), else 0. */
  landed = 0;
  private readonly velBefore = new THREE.Vector3();
  private readonly impulse = new THREE.Vector3();
  private readonly staticLoad: number[];
  /** Mass each corner is responsible for when cancelling velocity in one step. */
  private readonly mCorner: number;
  private readonly ray: RAPIER_NS.Ray;
  private readonly rayGroups = groups(CG.CAR, CG.WORLD);
  private readonly aPeak: number;
  private dt = 1 / 60;
  /** Traction control stays off for a moment after the handbrake, so power can hold the slide it started. */
  private tcOff = 0;
  /** Per-wheel forces, gathered first and applied together (see step). */
  private readonly fSusp = [0, 0, 0, 0];
  private readonly fTyre = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly pTyre = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** Mid self-righting hop. */
  private righting = false;
  /** Donut request that started at a standstill (see the donut gate). */
  private donutArmed = false;
  onShift?: (gear: number) => void;

  constructor(private readonly physics: Physics, readonly spec: VehicleSpec, position: THREE.Vector3Like, yaw = 0) {
    const R = physics.R;
    const s = spec;
    _q.setFromAxisAngle(WORLD_UP, yaw);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setAdditionalMassProperties(s.mass, { x: s.com[0], y: s.com[1], z: s.com[2] }, { x: s.inertia[0], y: s.inertia[1], z: s.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 })
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0.05);
    this.body = physics.world.createRigidBody(desc);
    for (const c of s.chassis) {
      const cd = R.ColliderDesc.roundCuboid(c.half[0] - c.round, c.half[1] - c.round, c.half[2] - c.round, c.round)
        .setTranslation(c.at[0], c.at[1], c.at[2])
        .setDensity(0).setFriction(0.3).setRestitution(0.05)
        .setCollisionGroups(groups(CG.CAR, CG.WORLD | CG.CAR | CG.PROP));
      const col = physics.world.createCollider(cd, this.body);
      physics.tag(col, { tag: 'car', surface: 'metal' });
      this.colliders.push(col);
    }
    this.wheels = s.wheels.map(() => new WheelState(s.suspension.restLength));
    const frontShare = (0 - s.wheels[2].z + s.com[2]) / (s.wheels[0].z - s.wheels[2].z);
    this.staticLoad = s.wheels.map((w) => s.mass * G * (w.front ? frontShare : 1 - frontShare) / 2);
    this.mCorner = s.mass / 4;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.aPeak = peakSlip(s.tire.B, s.tire.C);
    this.rpm = s.engine.idle;
    this.readState();
  }

  /** Largest road-wheel angle allowed at `speed` (m/s): full lock parked, tyre-limited at speed. */
  maxSteerAngle(speed: number): number {
    const s = this.spec;
    const v2 = Math.max(speed * speed, 1);
    const wheelbase = s.wheels[0].z - s.wheels[2].z;
    const a = wheelbase * s.tire.muLat * G / v2 + this.aPeak * s.steer.overdrive;
    return clamp(a, s.steer.minAngle, s.steer.lock);
  }

  get wheelbase(): number { return this.spec.wheels[0].z - this.spec.wheels[2].z; }

  /** Put the car back on its wheels at `position` facing `yaw`, or where it is now. */
  reset(position?: THREE.Vector3Like, yaw?: number): void {
    const b = this.body;
    const p = position ?? { x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z };
    const heading = yaw ?? Math.atan2(this.fwd.x, this.fwd.z);
    _q.setFromAxisAngle(WORLD_UP, heading);
    b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) { w.compression = 0; w.springLen = this.spec.suspension.restLength; w.spinRate = 0; w.contact = false; }
    this.gear = 1; this.rpm = this.spec.engine.idle; this.steerAngle = 0; this.flippedTime = 0; this.airTime = 0; this.righting = false;
    this.accel.set(0, 0, 0);
    this.readState();
    this.velBefore.copy(this.vel);
  }

  private readState(): void {
    const b = this.body;
    const t = b.translation(), r = b.rotation(), lv = b.linvel(), av = b.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
    this.speed = this.vel.length();
    this.forwardSpeed = this.vel.dot(this.fwd);
    this.lateralSpeed = this.vel.dot(this.left);
    this.yawRate = this.angVel.dot(this.up);
    this.bodySlip = this.speed > 1.5 ? Math.atan2(-this.lateralSpeed, Math.max(Math.abs(this.forwardSpeed), 0.5)) : 0;
  }

  private push(force: THREE.Vector3, point: THREE.Vector3): void {
    _t.copy(force).multiplyScalar(this.dt);
    this.body.applyImpulseAtPoint(_t, point, true);
    this.impulse.add(_t);
  }

  /** One fixed step of forces. Call before `physics.step()`, then `afterStep()`. */
  step(c: VehicleControls, dt: number): void {
    const s = this.spec, sus = s.suspension, tire = s.tire, b = this.body;
    this.dt = dt;
    this.readState();
    this.velBefore.copy(this.vel);
    this.impulse.set(0, 0, 0);
    this.throttle = c.throttle; this.brake = c.brake; this.handbrake = c.handbrake;

    // --- steering: speed-sensitive limiter + counter-steer --------------------------------------
    const vAbs = Math.abs(this.forwardSpeed);
    const sliding = this.forwardSpeed > 2 ? smoothstep(0.1, 0.4, Math.abs(this.bodySlip)) * smoothstep(3, 8, this.speed) : 0;
    // Only steering *into* the slide is cut (c.steer < 0 is left; a left drift has bodySlip > 0):
    // counter-steer keeps full authority, so a slide can always be steered out of.
    const into = c.steer * this.bodySlip < 0 ? 1 : 0;
    let target = -c.steer * this.maxSteerAngle(vAbs) * (1 - s.steer.driftCut * sliding * into);
    if (this.forwardSpeed > 2 && this.grounded > 1) target -= s.steer.counterSteer * this.bodySlip * smoothstep(3, 8, this.speed);
    target = clamp(target, -s.steer.lock, s.steer.lock);
    const maxStep = s.steer.rate * dt;
    this.steerAngle += clamp(target - this.steerAngle, -maxStep, maxStep);

    // --- suspension: rays and spring forces ------------------------------------------------------
    _down.copy(this.up).negate();
    const reach = sus.restLength + s.wheelRadius;
    const springF = [0, 0, 0, 0];
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], m = s.wheels[i];
      _mount.set(m.x, s.mountY, m.z).applyQuaternion(this.quat).add(this.pos);
      this.ray.origin = { x: _mount.x, y: _mount.y, z: _mount.z };
      this.ray.dir = { x: _down.x, y: _down.y, z: _down.z };
      const hit = this.physics.world.castRayAndGetNormal(this.ray, reach, true, undefined, this.rayGroups, undefined, b);
      if (!hit) {
        w.contact = false; w.compression = 0; w.springLen = sus.restLength; w.load = 0;
        continue;
      }
      grounded++;
      w.contact = true;
      const len = hit.timeOfImpact - s.wheelRadius;
      const minLen = sus.restLength - sus.travel;
      w.springLen = Math.max(len, minLen);
      w.compression = sus.restLength - w.springLen;
      w.point.set(_mount.x + _down.x * hit.timeOfImpact, _mount.y + _down.y * hit.timeOfImpact, _mount.z + _down.z * hit.timeOfImpact);
      w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      w.surface = this.physics.dataOf(hit.collider).surface ?? 'asphalt';
      const k = m.front ? sus.stiffnessFront : sus.stiffnessRear;
      // Compression rate from the hard point's actual velocity towards the ground (no one-step lag,
      // which is what a finite difference of the ray length would give the damper).
      const vm = b.velocityAtPoint(_mount, _rv);
      const upN = Math.max(0.3, this.up.dot(w.normal));
      const cv = clamp(-(vm.x * w.normal.x + vm.y * w.normal.y + vm.z * w.normal.z) / upN, -5, 5);
      let f = k * w.compression + (cv > 0 ? sus.bump : sus.rebound) * cv;
      if (len < minLen) f += k * 10 * (minLen - len) + sus.rebound * 2 * Math.max(0, cv);   // bump stop
      springF[i] = f;
    }
    // Anti-roll bars: resist the left/right compression difference on each axle.
    for (let a = 0; a < 2; a++) {
      const l = a * 2, r = l + 1;
      const d = this.wheels[l].compression - this.wheels[r].compression;
      const f = (a === 0 ? sus.antiRollFront : sus.antiRollRear) * d;
      if (this.wheels[l].contact) springF[l] += f;
      if (this.wheels[r].contact) springF[r] -= f;
    }
    const wasAir = this.grounded === 0;
    this.grounded = grounded;

    // --- engine & gearbox -------------------------------------------------------------------------
    let vDrive = 0, nDrive = 0;
    for (let i = 0; i < 4; i++) {
      const driven = s.wheels[i].front ? s.engine.frontShare > 0 : s.engine.frontShare < 1;
      if (driven && this.wheels[i].contact) { vDrive += this.wheels[i].vLong; nDrive++; }
    }
    vDrive = nDrive ? vDrive / nDrive : this.forwardSpeed;
    const drive = this.engine(c, dt, vDrive);

    // --- tyres ------------------------------------------------------------------------------------
    _g.set(0, -G, 0);
    if (c.handbrake) this.tcOff = 1; else this.tcOff = Math.max(0, this.tcOff - dt);
    // Traction control while the car is gripping: drive may only use the grip cornering leaves over,
    // so full throttle mid-corner pushes wide instead of spinning. Off once the car is sliding (then
    // the throttle is what holds the angle), at a crawl (donuts), and just after the handbrake.
    // Sliding is judged by the rear tyres' slip angle, not the body slip: in a tight turn at
    // walking pace the body slip is ~20-30° by geometry alone while the tyres are gripping, and
    // treating that as a slide switched traction control off and let the throttle spin the rear.
    const rearSlip = Math.max(Math.abs(this.wheels[2].slipAngle), Math.abs(this.wheels[3].slipAngle));
    let tc = this.tcOff <= 0 ? 1 - smoothstep(0.1, 0.22, rearSlip) : 0;
    // Full lock + full throttle from a standstill is asking for a donut: let the rear go. Only
    // armed when the request starts below walking pace, or every slow full-lock corner (the yard's
    // right-angle turn at 15 km/h) would spin.
    const dn = s.assists.donut;
    const donutWant = Math.abs(c.steer) > dn.steer && c.throttle > dn.throttle && !c.reverse;
    if (!donutWant) this.donutArmed = false; else if (this.speed < 0.8) this.donutArmed = true;
    const donut = donutWant && this.donutArmed;
    if (donut) tc *= smoothstep(dn.speedLo, dn.speedHi, this.speed);
    // Reversing with lock is geometric body slip, not a slide: keep traction control on.
    if (c.reverse) tc = this.speed > 3 ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], m = s.wheels[i];
      w.steer = m.front ? this.steerAngle : 0;
      this.fSusp[i] = 0; this.fTyre[i].set(0, 0, 0);
      if (!w.contact) {
        w.skid = 0; w.slipAngle = 0; w.locked = false; w.spinning = false;
        const drivenAir = m.front ? s.engine.frontShare > 0 : s.engine.frontShare < 1;
        w.spinRate = drivenAir && c.throttle > 0 ? w.spinRate + (60 * c.throttle - w.spinRate) * dt * 3 : w.spinRate * (1 - dt * 0.6);
        if (c.handbrake && !m.front) w.spinRate = 0;
        w.spin += w.spinRate * dt;
        continue;
      }
      const fz = Math.max(0, springF[i]);
      const load = Math.min(fz, this.staticLoad[i] * 3.5);
      w.load = load;
      const n = w.normal;
      // Wheel axes on the ground plane.
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      _wf.copy(this.fwd).multiplyScalar(cs).addScaledVector(this.left, sn);
      _wf.addScaledVector(n, -_wf.dot(n)).normalize();
      _wl.crossVectors(n, _wf).normalize();
      const vp = b.velocityAtPoint(w.point, _rv);
      _t.set(vp.x, vp.y, vp.z);
      const vx = _t.dot(_wf), vy = _t.dot(_wl);
      w.vLong = vx; w.vLat = vy;
      const gx = _g.dot(_wf), gy = _g.dot(_wl);
      const grip = Math.max(0.5, 1 - tire.loadSensitivity * (load / this.staticLoad[i] - 1));
      const fxMax = tire.muLong * load * grip;
      const fyMax = tire.muLat * load * grip * (m.front ? 1 : tire.rearGrip);
      const driven = m.front ? s.engine.frontShare > 0 : s.engine.frontShare < 1;
      const share = driven ? (m.front ? s.engine.frontShare : 1 - s.engine.frontShare) / 2 : 0;
      const brakeCap = s.brakes.force * c.brake * (m.front ? s.brakes.frontBias : 1 - s.brakes.frontBias) / 2;
      const handLocked = c.handbrake && !m.front;
      const mc = this.mCorner;
      let fx = 0, fy = 0;
      w.locked = false; w.spinning = false;

      const hold = (c.brake > 0.05 && Math.abs(vx) < 1) || (handLocked && Math.abs(vx) < 0.6)
        || (c.throttle < 0.02 && this.speed < 0.5) || (c.burnout && m.front);
      if (handLocked && Math.abs(vx) >= 0.6) {
        // Locked rear tyre: sliding friction straight against the patch's velocity.
        const vm = Math.hypot(vx, vy);
        const f = tire.slide * fxMax;
        fx = -vx / vm * Math.min(f, mc * vm / dt);
        fy = -vy / vm * Math.min(f, mc * vm / dt);
        w.locked = true;
      } else {
        // Lateral first: traction control needs to know how much grip cornering is using.
        // Magic formula at speed, static friction (with slope compensation) at a crawl.
        const alpha = Math.atan2(vy, Math.max(Math.abs(vx), 1));
        w.slipAngle = alpha;
        const fPac = -fyMax * lateralCurve(alpha, tire.B, tire.C);
        const fStatic = clamp(-mc * (vy / dt + gy), -fyMax, fyMax);
        const wBlend = smoothstep(0.8, 3, Math.abs(vx));
        fy = fPac * wBlend + fStatic * (1 - wBlend);
        const noOvershoot = mc * Math.abs(vy) / dt + mc * Math.abs(gy);
        fy = clamp(fy, -noOvershoot, noOvershoot);
        // Longitudinal.
        if (hold) {
          const cap = c.brake > 0.05 || c.burnout ? Math.max(brakeCap, fxMax * 0.9) : fxMax * 0.9;
          fx = clamp(-mc * (vx / dt + gx), -cap, cap);
        } else {
          // ABS: fronts may use nearly all their grip, rears stop well short so they keep enough
          // sideways grip to hold the car straight under hard braking.
          const bf = Math.min(brakeCap, fxMax * (m.front ? 0.95 : 0.62), mc * Math.abs(vx) / dt);
          fx -= Math.sign(vx) * bf;
          fx -= Math.sign(vx) * Math.min(tire.rolling * load, mc * Math.abs(vx) / dt);
        }
        if (share > 0 && !(c.burnout && !m.front)) {
          let want = drive * share;
          if (want !== 0) {
            // Gripping: only the grip cornering leaves over. Sliding: most, never all of it, and
            // how much depends on intent. Steering into the slide keeps it going; straight or
            // steering out lets the rear find grip, so a drift can end with W still held.
            const u = fy / fyMax;
            const gripCap = fxMax * Math.sqrt(Math.max(0, 1 - u * u)) * 0.95;
            const into = clamp01(-c.steer * Math.sign(this.bodySlip));
            const neutral = tire.driftDriveCapNeutral + (tire.driftDriveCapNeutralFast - tire.driftDriveCapNeutral) * smoothstep(tire.driftCapFastFrom, tire.driftCapFastTo, this.speed);
            let slide = neutral + (tire.driftDriveCap - neutral) * into;
            if (donut && this.speed < dn.speedHi) slide = Math.max(slide, dn.cap);
            const slideCap = fxMax * slide;
            const cap = tc * gripCap + (1 - tc) * slideCap;
            want = clamp(want, -cap, cap);
            // Spinning only when the drive actually reaching the tyre is at the slide limit. Flagging
            // it from the *requested* drive put smoke and squeal on every launch and gripping corner.
            w.spinning = c.throttle > 0.3 && tc < 0.5 && Math.abs(drive * share) > cap * 1.05;
          }
          fx += want;
        }
        if (c.burnout && !m.front) w.spinning = true;
        combine(fx, fy, fxMax, fyMax, _combined);
        fx = _combined.x; fy = _combined.y;
      }

      // Buffered, not applied: an impulse changes the body's velocity immediately, so applying
      // wheel 0's suspension push before sampling wheel 1 would make wheel 1 see the pitch it caused
      // and "correct" it, leaving the parked car creeping.
      this.fSusp[i] = fz;
      this.fTyre[i].copy(_wf).multiplyScalar(fx).addScaledVector(_wl, fy);
      this.pTyre[i].copy(w.point).addScaledVector(this.up, tire.forceHeight);

      // Wheel rotation for the model, and how hard the tyre is working for fx/audio.
      if (w.locked) w.spinRate = 0;
      else if (w.spinning) w.spinRate = vx / s.wheelRadius + (c.reverse ? -1 : 1) * (25 + 40 * c.throttle);
      else w.spinRate = vx / s.wheelRadius;
      w.spin += w.spinRate * dt;
      const latSkid = clamp01((Math.abs(w.slipAngle) / this.aPeak - 1.15) / 1.6) * clamp01((Math.abs(vy) - 0.8) / 2.5);
      const lockSkid = w.locked ? clamp01(Math.hypot(vx, vy) / 6) : 0;
      const spinSkid = w.spinning ? 0.85 : 0;
      w.skid = Math.max(latSkid, lockSkid, spinSkid);
    }

    for (let i = 0; i < 4; i++) {
      if (!this.wheels[i].contact) continue;
      _f.copy(this.up).multiplyScalar(this.fSusp[i]);
      this.push(_f, this.wheels[i].point);
      this.push(this.fTyre[i], this.pTyre[i]);
    }

    // --- aero -------------------------------------------------------------------------------------
    const com = b.worldCom(_rv);
    _p.set(com.x, com.y, com.z);
    _f.copy(this.vel).multiplyScalar(-s.aero.drag * this.speed);
    _f.addScaledVector(this.up, -s.aero.downforce * this.forwardSpeed * this.forwardSpeed * (grounded > 0 ? 1 : 0.3));
    this.push(_f, _p);

    // --- assists ----------------------------------------------------------------------------------
    const I = s.inertia;
    if (grounded === 0) {
      this.airTime += dt;
      // Damp pitch and roll in the body frame; leave yaw alone. GTA-style air control on top.
      _t.copy(this.angVel).applyQuaternion(_q.copy(this.quat).invert());
      const k = 1 - Math.exp(-s.assists.airDamping * dt);
      let dPitch = -_t.x * k, dRoll = -_t.z * k;
      dPitch += (c.brake - c.throttle) * s.assists.airControl * dt * (c.reverse ? -1 : 1);
      dRoll += c.steer * s.assists.airControl * dt;
      _t.set(dPitch * I[0], 0, dRoll * I[2]).applyQuaternion(this.quat);
      b.applyTorqueImpulse(_t, true);
    } else {
      if (wasAir && this.airTime > 0.35) this.landed = this.airTime;
      this.airTime = 0;
      // Spin guard: bleed yaw rate once the slide is past ~32°, unless the handbrake asks for it.
      const intoG = clamp01(-c.steer * Math.sign(this.bodySlip));
      const excess = Math.abs(this.bodySlip) - (s.assists.spinAngleNeutral + (s.assists.spinAngle - s.assists.spinAngleNeutral) * intoG);
      // Held off for half a second after the handbrake, so a handbrake turn can finish rotating.
      if (excess > 0 && this.tcOff < 0.5 && this.speed > 5 && grounded >= 3) {
        const k = Math.min(0.25, s.assists.spinGuard * excess * dt * 6);
        _t.copy(this.up).multiplyScalar(-this.yawRate * k * I[1]);
        b.applyTorqueImpulse(_t, true);
      }
    }
    // Sliding with the wheel near centre: bleed the rotation so a straightened slide straightens.
    if (grounded >= 3 && !c.handbrake && this.tcOff <= 0 && this.speed > 4) {
      const calm = (1 - clamp01(Math.abs(c.steer) / 0.3)) * smoothstep(0.06, 0.15, Math.abs(this.bodySlip));
      if (calm > 0) {
        const k = Math.min(0.2, s.assists.calmYawDamp * calm * dt);
        _t.copy(this.up).multiplyScalar(-this.yawRate * k * I[1]);
        b.applyTorqueImpulse(_t, true);
      }
    }
    // On the roof or a side. A/D rocks it about the long axis; after `selfRight` seconds it rights
    // itself. Torque alone cannot do that: tipping 1.4 t over a roof edge 0.7 m from the centre of
    // mass takes ~9.6 kN·m, so instead the body is steered to a lift-and-roll by its velocities,
    // which reads as a hop onto its wheels and cannot fail.
    const upright = this.up.y;
    if (upright < 0.45 && this.speed < 3) this.flippedTime += dt; else if (!this.righting) this.flippedTime = 0;
    if (this.flippedTime > 0.6 && !this.righting) {
      _f.copy(this.fwd).multiplyScalar(-c.steer * 2.6 * dt * I[2]);
      b.applyTorqueImpulse(_f, true);
    }
    if (this.flippedTime > s.assists.selfRight) this.righting = true;
    if (this.righting) {
      _t.crossVectors(this.up, WORLD_UP);
      if (_t.lengthSq() < 1e-4) _t.copy(this.fwd);   // exactly upside down: roll about the long axis
      _t.normalize();
      const av = b.angvel(_rv);
      const k = Math.min(1, dt * 10);
      const wx = av.x + (_t.x * 4 - av.x) * k, wy = av.y * (1 - k), wz = av.z + (_t.z * 4 - av.z) * k;
      b.setAngvel({ x: wx, y: wy, z: wz }, true);
      const lv = b.linvel(_rv);
      b.setLinvel({ x: lv.x * (1 - k), y: upright < 0.2 ? Math.max(lv.y, 2.2) : lv.y, z: lv.z * (1 - k) }, true);
      if (upright > 0.8 || this.flippedTime > s.assists.selfRight + 3) { this.righting = false; this.flippedTime = 0; }
    }
  }

  /** Call right after `physics.step()`: impact detection and smoothed body acceleration. */
  afterStep(dt: number): void {
    const lv = this.body.linvel();
    _t.set(lv.x, lv.y, lv.z);
    // Velocity change the step caused that our own forces and gravity do not explain = a collision.
    _f.copy(_t).sub(this.velBefore).addScaledVector(this.impulse, -1 / this.spec.mass);
    _f.y += G * dt;
    this.impact = _f.length();
    if (this.impact > 0.5) {
      _p.copy(_f).normalize();
      this.impactPoint.copy(this.pos).addScaledVector(_p, -1.6);
    }
    // Body-frame acceleration, smoothed, for the lean in the model and the camera's weight.
    _f.copy(_t).sub(this.velBefore).divideScalar(dt);
    _q.copy(this.quat).invert();
    _f.applyQuaternion(_q);
    const k = 1 - Math.exp(-dt * 7);
    this.accel.x += (_f.x - this.accel.x) * k;
    this.accel.y += (_f.y - this.accel.y) * k;
    this.accel.z += (_f.z - this.accel.z) * k;
    this.readState();
  }

  /**
   * Put the car in motion at `speed` m/s along its nose, with wheels and gearbox as if it had
   * driven there (spawned traffic, tests). Without the wheel speeds the first step saw 0 rpm and
   * downshifted into the limiter.
   */
  setMoving(speed: number): void {
    const e = this.spec.engine, r = this.spec.wheelRadius, f = this.fwd;
    this.body.setLinvel({ x: f.x * speed, y: 0, z: f.z * speed }, true);
    for (const w of this.wheels) { w.spinRate = speed / r; w.vLong = speed; }
    const rpmIn = (g: number) => speed / r * e.gears[g - 1] * e.final * 60 / (2 * Math.PI);
    let gear = 1;
    while (gear < e.gears.length && rpmIn(gear) > e.shiftUp) gear++;
    this.gear = gear;
    this.rpm = Math.max(e.idle, rpmIn(gear));
    this.readState();
  }

  /** Consume a landing event: returns seconds of air time, once. */
  takeLanding(): number { const l = this.landed; this.landed = 0; return l; }

  private engine(c: VehicleControls, dt: number, vDrive: number): number {
    const e = this.spec.engine, r = this.spec.wheelRadius;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (c.reverse) this.gear = -1;
    else if (this.gear < 1) this.gear = 1;
    const ratio = (g: number) => (g > 0 ? e.gears[g - 1] : g < 0 ? -e.reverse : 0);
    const toRpm = (v: number, g: number) => Math.abs(v / r * ratio(g) * e.final) * 60 / (2 * Math.PI);
    let rpm = toRpm(vDrive, this.gear);
    if (this.gear > 0 && this.shiftTimer <= 0 && this.grounded > 0) {
      if (rpm > e.shiftUp && this.gear < e.gears.length && c.throttle > 0.1) {
        this.gear++; this.shiftTimer = e.shiftTime; this.onShift?.(this.gear);
      } else if (this.gear > 1 && rpm < e.shiftDown && toRpm(vDrive, this.gear - 1) < e.shiftUp * 0.92) {
        this.gear--; this.shiftTimer = e.shiftTime * 0.5; this.onShift?.(this.gear);
      }
      rpm = toRpm(vDrive, this.gear);
    }
    const slipping = this.gear === 1 || this.gear === -1;
    let target = Math.max(rpm, slipping ? e.idle + (e.launchRpm - e.idle) * c.throttle : e.idle);
    const freeRev = this.grounded === 0 || c.burnout || this.wheels.some((w) => w.spinning);
    if (freeRev) {
      const flare = e.idle + (e.redline - e.idle) * 0.9 * c.throttle;
      // On the ground a spinning tyre still drags the engine towards road speed: let the note flare
      // above it and climb through the gear, not sit on the limiter for the whole of first.
      target = Math.max(target, this.grounded > 0 && !c.burnout ? Math.min(flare, rpm + 1800) : flare);
    }
    if (this.shiftTimer > 0 && c.throttle > 0) target = Math.max(target * 0.82, e.idle);
    this.rpm += (Math.min(target, e.redline) - this.rpm) * Math.min(1, dt * 16);

    const kmh = Math.abs(this.forwardSpeed) * 3.6;
    const limited = this.gear > 0 ? kmh > e.limiterKmh : kmh > e.reverseKmh;
    if (this.shiftTimer > 0 || limited || c.throttle <= 0.02) {
      // Engine braking, always against the wheels' rotation.
      if (c.throttle <= 0.02 && this.rpm > e.idle * 1.3 && Math.abs(vDrive) > 1) {
        const t = e.engineBrake * torqueAt(e.torque, this.rpm) * Math.min(1, (this.rpm - e.idle) / 2500);
        return -Math.sign(vDrive) * Math.abs(t * ratio(this.gear) * e.final) / r;
      }
      return 0;
    }
    const torque = torqueAt(e.torque, Math.max(this.rpm, rpm)) * c.throttle * (this.rpm >= e.redline - 10 ? 0 : 1);
    return torque * ratio(this.gear) * e.final * e.efficiency / r;
  }
}
