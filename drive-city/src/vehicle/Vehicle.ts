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
  /** 0..1: how near the tyre is to its sideways limit (0 under 0.55 of its grip, 1 at the peak), for the sound and the camera. */
  strain = 0;
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
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Since 2026-11-25 (「改GTA」) only the phone's 漂移 button and `?drift=qq`: Space and the pad are a real handbrake (vehicle/index.ts).
 * The player's drift key (2026-10-23, 「现在开车几乎不能漂移，开车手感很差，做成qq飞车这样的操作」): QQ飞车's drift, not the
 * tyres'. Held with a direction above `minSpeed`, the car swings its tail out to `angle` and carves a steady arc while
 * the tyre forces are set aside: the path and the body's angle are steered straight (an impulse on the velocity, a
 * torque on the yaw), so a drift starts on any car at any speed and never spins. The key bends the arc: into the drift
 * it closes it and opens the angle, let go the car slides on angled and nearly straight (a drift begun before the corner). Let go and the travel turns to where the nose points (that is what the
 * drift was for), then the tyres take over again; a drift held `kickAfter` s ends in a short push (小喷), and it fills
 * a fitted nitro bottle. Below `minSpeed`, and on two-wheelers, the key is the handbrake it was.
 */
export const ARCADE = {
  // 2026-11-26 (phone, 「漂移没有拉扯感，车头转的幅度太大」, then 「车要更有分量」): the tail swung out at 155°/s to 40° with a key
  // held, and 2.5 s of drift turned the travel 157°. Heavier now: out at 84°/s (`yawMax*`, `yawK`), 31° held, the turn building
  // over `turnTau` and the keys pulling through a longer lag (`steerTau` 0.4 -> 0.6): 116° in 2.5 s. .scratch/feel/qq.test.ts
  minSpeed: 8, steerIn: 0.25,
  /**
   * The direction's hold on the drift follows the key through this lag, s (2026-10-23, 「方向键太过灵敏，导致漂移不好操作…
   * qq飞车…它的方向键有拉拽感，很好漂移」): a tap is a nudge, a held key tightens the arc over half a second. Taken at
   * once, swapping into the drift for against it swung the angle 42° -> 16° and the arc 14 -> 3.5 m/s² in a frame.
   */
  steerTau: 0.6,
  /** Body angle to the travel, rad: neutral, steering into the drift, steering against it. */
  angle: 0.44, angleIn: 0.56, angleOut: 0.28,
  /**
   * How fast the travel turns, rad/s (neutral, the key into the drift, against it), at most `latMax` m/s² sideways (fast,
   * the arc opens). As a turn rate (2026-10-23, 「漂移成功不了，比如我右转，车子一直向左偏」): the first version set a sideways
   * pull of 9 m/s², and with half of it reaching the path each step a drift at 60 km/h turned the travel 15°/s - the nose
   * swung right at once and the car slid on nearly straight, off the road on the left.
   * 2026-11-28 (「漂移应该做成在路口提前开始漂，等到路口的时候就能漂过去了，而不是走到路口才开始漂」): neutral turned 1.0 rad/s
   * (and against 0.35), so a drift begun before the corner turned 65° in a second, 10 m into the buildings before it. The
   * arc now follows the key itself (not `steerTau`): let go and the car slides on angled and nearly straight (a second's
   * slide at 60 km/h: 14°, 3 m aside), press into it at the corner and it comes round in 13 m. A key held all through turns
   * a 90° corner in 19 / 26 / 36 m at 60 / 80 / 100 km/h, as 11-27 left it. .scratch/feel/predrift.test.ts, corner.test.ts
   */
  turn: 0.06, turnIn: 1.5, turnOut: 0, latMax: 32,
  /**
   * Lag of the turn behind its target, s (0 = at once). 2026-11-27 (「车速起来的时候，前面要右拐弯…根据惯性往前面甩，不能
   * 稳定的转向」): 0.3 with turn 0.8 / turnIn 1.0 / latMax 24 carried the car on its line - a 90° right turn needed 26 / 35 /
   * 45 m at 60 / 80 / 100 km/h (37 m at 100 before 11-26); then 19 / 25 / 35, and the turn starts from what the car was
   * already turning. The body's angle and its swing (`yawK`, `yawMax*`) are as 11-26 left them. .scratch/feel/corner.test.ts
   */
  turnTau: 0.12,
  /** The key's pull on the arc grows over the drift's first `arcIn` s: the tail swings out first, the press barely turns it. */
  arcIn: 0.3,
  /** Speed lost per second: coasting, extra when steering in, extra on the brake; the throttle gives back `gas`. */
  loss: 1.2, lossIn: 1.5, brakeLoss: 9, gas: 1,
  /**
   * Yaw: rad/s per rad of angle error, the cap (`yawMaxIn` for the first `entryT` s: the swing out stays quick), and the
   * share of the yaw-rate error fixed each step.
   */
  yawK: 3.5, yawMax: 1.5, yawMaxIn: 2, entryT: 0.35, yawGain: 0.35,
  /** Share of the velocity error fixed each step (all of it: the turn comes out as set). */
  velGain: 1,
  /** After the key: the travel swings to the nose at `align` rad/s, for `recover` s at most. */
  align: 4, recover: 0.35,
  /** The push after a drift: needs `kickAfter` s of drift, lasts `kickTime` s at `kickAccel` m/s². */
  kickAfter: 0.6, kickTime: 0.8, kickAccel: 5,
  /** Nitro bottle filled per second of drift (when one is fitted). */
  charge: 0.12,
  /** An impact this hard (m/s) ends the drift without the push. */
  crash: 4,
};

/**
 * The player's brakes with the wheel turned (2026-11-25, 「我开车离前面的车很近，想变向，半天头转不过去，就撞在前面的车上了」).
 * The ABS gives the front tyres 0.95 of their grip for braking, which leaves 0.31 of it sideways: brake and steer
 * behind a car, as anyone does, and the nose turned 1-5° in half a second (15° off the brake) and never cleared it.
 * With `VehicleControls.trail` the fronts brake with `front` of their grip at `steerHi` of the wheel and more
 * (0.95 still below `steerLo`), so they keep sqrt(1 - front²) of it to turn with; the rears are left as they were.
 * Only the player's car asks for it: traffic, police and the handling suite brake as before.
 */
export const TRAIL = {
  front: 0.5, rear: 0.3, steerLo: 0.25, steerHi: 0.6, slipLo: 0.06, slipHi: 0.14,
  /**
   * Handling critic round 3: braking in a slide with the wheel straight. At 25° of slip the brakes took the tyres'
   * sideways grip and the car came round to 62-89°; off the brakes it caught itself. From `slideLo` to `slideHi` rad
   * the fronts go down to `slideFront` and the rears to `rear`, wheel turned or not.
   */
  slideLo: 0.2, slideHi: 0.35, slideFront: 0.35,
};
/**
 * The player's car reversing with the wheel turned (handling critic round 3: S + D for 4 s went round 300-450°, faster
 * and faster). Past `vLo`..`vHi` m/s and with the lock on, the drive gives up `cut` of itself and is no more than
 * `accel` m/s²; turning faster than the wheels point (or than `grip` of the tyres allow) is damped at `damp` 1/s.
 */
export const BACKING = { cut: 0.7, vLo: 1.5, vHi: 4, accel: 2, grip: 0.7, damp: 8 };

/**
 * The player's slides (2026-11-26, 「漂移没有拉扯感，车头转的幅度太大」): a handbrake slide held on full lock stood at 56-60 deg, the
 * arcade drift at 39, and letting the key go swung it 55 -> 45 deg in 0.3 s where the arcade drift (「有拉拽感」) moved 1.
 *  - the steering reaches a slide through a lag of `tau` s (from `lo` to `hi` rad of slip): a tap nudges, a held key pulls;
 *  - past `angle` rad (`angleIn` steering into it) the nose is turned back to the travel at `k` rad/s² per rad over, and its
 *    swing outwards damped at `damp` 1/s. Not while the handbrake is held: held on, it still spins the car round.
 */
export const SLIDE = { tau: 0.35, lo: 0.12, hi: 0.25, angle: 0.52, angleIn: 0.68, k: 14, damp: 7 };

/**
 * Letting a slide go (2026-11-25, 「改GTA」: Space is a real handbrake again on keys and pads). Slid out by it at 80-110 km/h the car
 * took 1.4-2 s to straighten with everything let go. The player's car, wheel near centre, handbrake off: the nose is turned
 * to the travel at `k` rad/s² per rad of slip, `gasCut` of it given up with the throttle down, and its turning damped at
 * `damp` 1/s; from `lo` to `hi` rad of slip, all of it from `vLo` to `vHi` m/s.
 */
export const CATCH = { k: 6, damp: 2.5, gasCut: 0.5, lo: 0.1, hi: 0.25, vLo: 5, vHi: 10 };

/**
 * Space with the throttle (2026-11-27, 「电脑同时按方向键和空格键，车就不动了」): the handbrake locked the rears whatever the
 * throttle, so W + D + Space on a rear-driven car slid to a stop in 2-3 s and sat there turning 20° in 3 s (1 km/h). As in
 * GTA: the player's car, throttle past `gas`, the rears are not locked but spun by the engine (drive up to `cap` of their
 * grip, sideways `grip` of it): W + Space + a direction is a power slide, or a donut from rest. Space alone still locks them.
 * From `fastFrom`..`fastTo` m/s the drive goes down to `capFast` and the handbrake drags `drag` of the grip: unlocked and
 * driven, a coupe with Space held went on to 150 km/h.
 */
/**
 * The handbrake turns the travel too (2026-11-27, 「车速起来的时候，前面要右拐弯，我电脑版…飘移都会根据惯性往前面甩」): locked
 * rears give up their sideways grip, so the nose came round but the car slid on along its line - a 90° right turn at 60 km/h
 * took 35 m with a 0.5 s handbrake and 36 m without (24 m on the brakes). The player's car, Space held, a direction: the
 * travel is turned towards it at `acc` m/s² (at most `rate` rad/s), from `vLo` to `vHi` m/s, its speed kept. Space held with
 * W and the key at 60 / 80 / 100 km/h: 90° in 20 / 37 / 65 m (the phone's drift 19 / 25 / 35). .scratch/feel/corner.test.ts
 */
export const HBTURN = { acc: 9, rate: 0.8, vLo: 5, vHi: 9 };

export const HBGAS = { gas: 0.3, cap: 0.95, capFast: 0.5, drag: 0.45, fastFrom: 8, fastTo: 16, grip: 0.55 };

/**
 * A slide held on Space with the throttle (2026-11-28, 「漂移应该做成在路口提前开始漂，等到路口的时候就能漂过去了，而不是走到路口
 * 才开始漂」, both phone and keys, the key to bend the arc): flicked out with Space and a direction, then the key let go,
 * the car straightened in a moment (1-3° left) and pressed again at 90 km/h it spun. The player's car, Space and the
 * throttle (past `HBGAS.gas`) held, past `lo`..`hi` rad of slip and `vLo`..`vHi` m/s: as the phone's drift, the travel
 * turns `turn` rad/s with the key let go, `turnIn` into the slide, `turnOut` against it (at most `latMax` m/s², lagging by
 * `tau` s), and the body is held at `angle` / `angleIn` / `angleOut` rad to it (`yawK` rad/s per rad, at most `yawMax`,
 * `gain` of the yaw-rate error each step). The speed is the tyres' and the engine's. Space without the throttle is the
 * handbrake as it was: held with a key it still spins the car round.
 */
export const HOLD = {
  keyIn: 0.25, gasOff: 0.1, vLo: 8, vHi: 12,
  turn: 0.06, turnIn: 1.5, turnOut: 0, latMax: 32, tau: 0.12, arcIn: 0.3,
  angle: 0.4, angleIn: 0.52, angleOut: 0.25, yawK: 3.5, yawMax: 1.5, yawMaxIn: 2, entryT: 0.35, gain: 0.35,
};

/**
 * Keys only (2026-11-25, 「从第 1 项开始」: a gentle bend could only be held by tapping, and at 90 km/h the taps swung the
 * car ±0.76 g): a yaw torque towards the turn rate the key asks for, its share of what the tyres' grip allows, so the
 * nose goes in with the key and does not swing past. `gain` 1/s of the error, at most `max` rad/s². `over`: the reference
 * over the grip's turn rate from `fastFrom` m/s; `overSlow` below `slowTo`, where the taxi really turns at ~0.85 of it
 * and a full reference with the throttle held spun it (3° -> 56° at 40 km/h; .scratch/feel/stab.test.ts). Fades out as
 * the tail steps out (`slipLo`..`slipHi`, rad): a slide is the tyres' and the driver's.
 */
export const KEYAID = { gain: 10, max: 15, over: 1.06, overSlow: 0.75, slowTo: 9, fastFrom: 18, vLo: 5, vHi: 9, slipLo: 0.1, slipHi: 0.2 };

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
  /** The axles' `strain`, by load: the front's is a car about to push wide, the rear's one about to step out. */
  strainFront = 0; strainRear = 0;
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
  /**
   * Garage work on this one car (the spec is shared by every car of its type): engine torque and
   * top speed, tyre grip, and nitro - the seconds of boost a full bottle gives, 0 when none is fitted.
   */
  tune = { torque: 1, top: 1, grip: 1, nitro: 0 };
  /** Nitro left in the bottle, 0..1 of `tune.nitro`. */
  nitroFill = 0;
  /** Extra forward acceleration while the nitro burns, m/s² (set every step by whoever drives). */
  boost = 0;
  /** The arcade drift (`ARCADE`): 0 off, 1 drifting, 2 straightening after the key came up. */
  driftPhase: 0 | 1 | 2 = 0;
  /** +1 a left drift, -1 a right one. */
  driftDir = 0;
  /** Seconds into the arcade drift. */
  driftT = 0;
  /** Seconds left of the push after a drift (小喷). */
  kick = 0;
  private recoverT = 0;
  /** The direction's hold on the drift, -1 (against) .. 1 (into), lagging the steering by `ARCADE.steerTau`. */
  private driftSteer = 0;
  /** The arcade drift's turn of the travel, rad/s, lagging its target by `ARCADE.turnTau`. */
  private driftTurn = 0;
  /** The slide held on Space (`HOLD`): 0 none, +1 left, -1 right; seconds into it; its turn of the travel, rad/s. */
  holdDir = 0;
  private holdT = 0;
  private holdTurn = 0;
  /** The steering a slide feels (`SLIDE.tau`). */
  private slideSteer = 0;
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

  /**
   * Metres the road stands above its collider at (x, z), for the wheel rays: null (flat) for every car but the one a
   * world gives a road to feel (2026-11-10: the city's ground is one flat slab, and a drive had nothing to feel).
   */
  roadProfile: ((x: number, z: number) => number) | null = null;

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

  /**
   * Road-wheel angle for a key-driven wheel at `u` (0..1 of what a held key gives, which is `full` of the limiter's
   * angle): the part that follows the corner's radius goes with `u`, and the slip angle on top is the one whose tyre
   * force is `u` of the held key's. The tyre's force is nearly all there by 0.4 of the wheel, so with the angle itself
   * following the key a 0.15 s press was already 0.5-0.9 g, and nothing gentler could be held (2026-11-25).
   */
  keyAngle(u: number, speed: number, full: number): number {
    const s = this.spec, t = s.tire;
    const end = this.maxSteerAngle(speed) * full;
    const geo = Math.min(end, this.wheelbase * t.muLat * G / Math.max(speed * speed, 1) * full);
    const aEnd = end - geo;
    if (aEnd < 1e-3) return end * u;
    const fEnd = lateralCurve(Math.min(aEnd, this.aPeak), t.B, t.C);
    const slipOf = (f: number) => Math.tan(Math.asin(Math.min(1, f)) / t.C) / t.B;
    // past the peak there is no force left to follow: the rest of the angle comes in at the end of the key
    const aIn = Math.min(aEnd, this.aPeak);
    const u2 = u * u, u4 = u2 * u2;
    return geo * u + Math.min(aIn, slipOf(u * fEnd)) + (aEnd - aIn) * u4 * u4;
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
    this.driftPhase = 0; this.driftT = 0; this.kick = 0;
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
    // the arcade drift's phase (from the last step's state); below its speed and on two-wheelers the key is the handbrake
    const A = ARCADE;
    const canDrift = !s.single && this.grounded >= 3 && this.forwardSpeed > A.minSpeed && !c.reverse && this.up.y > 0.8;
    if (this.driftPhase === 1) {
      this.driftT += dt;
      const crashed = this.impact > A.crash;
      if (!c.drift || crashed || this.speed < A.minSpeed * 0.75 || this.airTime > 0.3 || this.up.y < 0.7) {
        if (!crashed && !c.drift && this.driftT >= A.kickAfter) this.kick = A.kickTime;
        this.driftPhase = crashed || this.airTime > 0.3 ? 0 : 2; this.recoverT = 0;
      }
    } else if (this.driftPhase === 2) {
      this.recoverT += dt;
      if (Math.abs(this.bodySlip) < 0.05 || this.recoverT > A.recover || this.impact > A.crash || this.speed < 3) this.driftPhase = 0;
    }
    if (this.driftPhase !== 1 && c.drift && canDrift && Math.abs(c.steer) > A.steerIn) {
      this.driftPhase = 1; this.driftDir = c.steer < 0 ? 1 : -1; this.driftT = 0; this.driftSteer = 0;
      // the turn starts from what the car was already turning (a drift begun mid-corner does not straighten it first)
      this.driftTurn = Math.max(0, this.yawRate * this.driftDir);
    }
    const arcade = this.driftPhase > 0;
    const handbrake = c.handbrake || (!!c.drift && !arcade && (!!s.single || this.forwardSpeed < A.minSpeed));
    this.throttle = c.throttle; this.brake = c.brake; this.handbrake = handbrake;

    // --- steering: speed-sensitive limiter + counter-steer --------------------------------------
    const vAbs = Math.abs(this.forwardSpeed);
    const sliding = this.forwardSpeed > 2 ? smoothstep(0.1, 0.4, Math.abs(this.bodySlip)) * smoothstep(3, 8, this.speed) : 0;
    // the player's slides: the steering pulls through a lag (`SLIDE`)
    const mine = !!c.trail && !s.single && !arcade;
    const inSlide = mine ? smoothstep(SLIDE.lo, SLIDE.hi, Math.abs(this.bodySlip)) * smoothstep(5, 10, this.speed) : 0;
    const kSteer = 1 - Math.exp(-dt / SLIDE.tau);
    this.slideSteer += (c.steer - this.slideSteer) * (1 - inSlide * (1 - kSteer));
    const st = mine ? this.slideSteer : c.steer;
    // Only steering *into* the slide is cut (c.steer < 0 is left; a left drift has bodySlip > 0):
    // counter-steer keeps full authority, so a slide can always be steered out of.
    const into = st * this.bodySlip < 0 ? 1 : 0;
    const wheel = c.keys ? Math.sign(st) * this.keyAngle(Math.min(1, Math.abs(st) / c.keys), vAbs, c.keys) : st * this.maxSteerAngle(vAbs);
    let target = -wheel * (1 - s.steer.driftCut * sliding * into);
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
      // the road's own small heights under this wheel (traffic/RoadFeel.ts: joints on a bridge, a kerb, rough paving)
      const len = hit.timeOfImpact - s.wheelRadius - (this.roadProfile ? this.roadProfile(_mount.x + _down.x * hit.timeOfImpact, _mount.z + _down.z * hit.timeOfImpact) : 0);
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
    if (handbrake) this.tcOff = 1; else this.tcOff = Math.max(0, this.tcOff - dt);
    // Traction control while the car is gripping: drive may only use the grip cornering leaves over,
    // so full throttle mid-corner pushes wide instead of spinning. Off once the car is sliding (then
    // the throttle is what holds the angle), at a crawl (donuts), and just after the handbrake.
    // Sliding is judged by the rear tyres' slip angle, not the body slip: in a tight turn at
    // walking pace the body slip is ~20-30° by geometry alone while the tyres are gripping, and
    // treating that as a slide switched traction control off and let the throttle spin the rear.
    const rearSlip = Math.max(Math.abs(this.wheels[2].slipAngle), Math.abs(this.wheels[3].slipAngle));
    // A loose traction control (`assists.tcMax`) lets go only as the wheel turns: a launch in a straight line still hooks up.
    const tcHold = 1 - (1 - (s.assists.tcMax ?? 1)) * smoothstep(0.3, 0.8, Math.abs(c.steer));
    // how much the rear is gripping; `tc` is that, less what a loose traction control lets go
    let gripping = this.tcOff <= 0 ? 1 - smoothstep(0.1, 0.22, rearSlip) : 0;
    // Full lock + full throttle from a standstill is asking for a donut: let the rear go. Only
    // armed when the request starts below walking pace, or every slow full-lock corner (the yard's
    // right-angle turn at 15 km/h) would spin.
    const dn = s.assists.donut;
    const donutWant = Math.abs(c.steer) > dn.steer && c.throttle > dn.throttle && !c.reverse;
    if (!donutWant) this.donutArmed = false; else if (this.speed < 0.8) this.donutArmed = true;
    const donut = donutWant && this.donutArmed;
    if (donut) gripping *= smoothstep(dn.speedLo, dn.speedHi, this.speed);
    // Reversing with lock is geometric body slip, not a slide: keep traction control on.
    if (c.reverse) gripping = this.speed > 3 ? 1 : 0;
    const tc = c.reverse ? gripping : gripping * tcHold;
    // the player's brakes with the wheel turned (`TRAIL`): 0..1, how far the ABS lets go to leave the tyres grip to steer with
    // (the fronts take their braking back as the tail steps out, which pulls it in again; the rears do not)
    const trailRear = c.trail && c.brake > 0 ? smoothstep(s.single ? 0.05 : TRAIL.steerLo, s.single ? 0.4 : TRAIL.steerHi, Math.abs(c.steer)) : 0;   // a two-wheeler: from the first of the bars, or it slides
    const trailFront = trailRear * (1 - smoothstep(TRAIL.slipLo, TRAIL.slipHi, Math.abs(this.bodySlip)));
    const slideBrake = c.trail && c.brake > 0 && !c.reverse && !s.single ? smoothstep(TRAIL.slideLo, TRAIL.slideHi, Math.abs(this.bodySlip)) : 0;
    const absFront = 0.95 - Math.max((0.95 - TRAIL.front) * trailFront, (0.95 - TRAIL.slideFront) * slideBrake);
    const absRear = 0.62 - (0.62 - TRAIL.rear) * Math.max(trailRear, slideBrake);
    // the player's Space with the throttle down on a car the rears drive: they spin, not lock (`HBGAS`)
    const hbGas = !!c.trail && c.handbrake && !s.single && !c.reverse && c.throttle > HBGAS.gas && s.engine.frontShare < 1;
    const hbFast = smoothstep(HBGAS.fastFrom, HBGAS.fastTo, this.speed);
    // the player backing with the wheel turned (`BACKING`)
    let driveF = drive;
    if (c.trail && c.reverse && !s.single) {
      const k = smoothstep(0.3, 1, Math.abs(this.steerAngle) / s.steer.lock) * smoothstep(BACKING.vLo, BACKING.vHi, this.speed);
      const most = s.mass * BACKING.accel, cut = drive * (1 - BACKING.cut);
      driveF += (clamp(cut, -most, most) - drive) * k;
    }
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], m = s.wheels[i];
      w.steer = m.front ? this.steerAngle : 0;
      this.fSusp[i] = 0; this.fTyre[i].set(0, 0, 0);
      if (!w.contact) {
        w.skid = 0; w.strain = 0; w.slipAngle = 0; w.locked = false; w.spinning = false;
        const drivenAir = m.front ? s.engine.frontShare > 0 : s.engine.frontShare < 1;
        w.spinRate = drivenAir && c.throttle > 0 ? w.spinRate + (60 * c.throttle - w.spinRate) * dt * 3 : w.spinRate * (1 - dt * 0.6);
        if (handbrake && !m.front) w.spinRate = 0;
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
      const fxMax = tire.muLong * load * grip * this.tune.grip;
      const fyMax = tire.muLat * load * grip * this.tune.grip * (m.front ? 1 : tire.rearGrip * (hbGas ? HBGAS.grip : 1));
      const driven = m.front ? s.engine.frontShare > 0 : s.engine.frontShare < 1;
      const share = driven ? (m.front ? s.engine.frontShare : 1 - s.engine.frontShare) / 2 : 0;
      const brakeCap = s.brakes.force * c.brake * (m.front ? s.brakes.frontBias : 1 - s.brakes.frontBias) / 2;
      const handLocked = handbrake && !m.front && !hbGas;
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
          const bf = Math.min(brakeCap, fxMax * (m.front ? absFront : absRear), mc * Math.abs(vx) / dt);
          fx -= Math.sign(vx) * bf;
          fx -= Math.sign(vx) * Math.min(tire.rolling * load, mc * Math.abs(vx) / dt);
          if (hbGas && !m.front) fx -= Math.sign(vx) * Math.min(HBGAS.drag * hbFast * fxMax, mc * Math.abs(vx) / dt);
        }
        if (share > 0 && !(c.burnout && !m.front)) {
          let want = driveF * share;
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
            if (hbGas && !m.front) slide = HBGAS.cap + (HBGAS.capFast - HBGAS.cap) * hbFast;
            const slideCap = fxMax * slide;
            const cap = tc * gripCap + (1 - tc) * slideCap;
            want = clamp(want, -cap, cap);
            // Spinning only when the drive actually reaching the tyre is at the slide limit. Flagging
            // it from the *requested* drive put smoke and squeal on every launch and gripping corner.
            // `gripping`, not `tc`: a loose traction control (`tcMax`) read as wheelspin in a corner that gripped (critic round 3).
            w.spinning = c.throttle > 0.3 && gripping < 0.5 && Math.abs(drive * share) > cap * 1.05;
          }
          fx += want;
        }
        if (c.burnout && !m.front) w.spinning = true;
        combine(fx, fy, fxMax, fyMax, _combined);
        fx = _combined.x; fy = _combined.y;
      }

      // The arcade drift steers the car itself (below): the tyres only roll and smoke.
      if (arcade) { fx = 0; fy = 0; w.locked = false; w.spinning = false; w.slipAngle = this.bodySlip; }

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
      w.strain = arcade || w.locked ? 0 : (Math.abs(w.slipAngle) >= this.aPeak ? 1 : smoothstep(0.55, 0.98, lateralCurve(Math.abs(w.slipAngle), tire.B, tire.C))) * smoothstep(3, 8, this.speed);
      const lockSkid = w.locked ? clamp01(Math.hypot(vx, vy) / 6) : 0;
      const spinSkid = w.spinning ? 0.85 : 0;
      w.skid = arcade ? (this.driftPhase === 1 ? (m.front ? 0.25 : 0.95) : 0.4) * smoothstep(4, 9, this.speed) : Math.max(latSkid, lockSkid, spinSkid);
    }

    for (let a = 0; a < 4; a += 2) {
      const l = this.wheels[a], r = this.wheels[a + 1], n = l.load + r.load;
      const st = n > 1 ? (l.strain * l.load + r.strain * r.load) / n : 0;
      if (a === 0) this.strainFront = st; else this.strainRear = st;
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

    // --- nitro: a push at the centre of mass, past the limiter but not without end -----------------
    if (this.boost > 0 && grounded >= 2 && this.forwardSpeed > -1 && this.forwardSpeed * 3.6 < s.engine.limiterKmh * this.tune.top * 1.3) {
      _f.copy(this.fwd).multiplyScalar(s.mass * this.boost);
      this.push(_f, _p);
    }

    // --- the push after a drift (小喷) ----------------------------------------------------------------
    if (this.kick > 0) {
      this.kick -= dt;
      if (grounded >= 2 && this.forwardSpeed > 0 && this.forwardSpeed * 3.6 < s.engine.limiterKmh * this.tune.top * 1.3) {
        _f.copy(this.fwd).multiplyScalar(s.mass * A.kickAccel);
        this.push(_f, _p);
      }
    }

    const I = s.inertia;
    // --- the arcade drift: the path's arc and the body's angle, set straight --------------------------
    if (arcade && grounded >= 2) {
      const vx = this.vel.x, vz = this.vel.z, v = Math.hypot(vx, vz);
      const psiV = Math.atan2(vx, vz), psiB = Math.atan2(this.fwd.x, this.fwd.z), dir = this.driftDir;
      let psiNew = psiV, vNew = v, yawCmd = 0;
      if (this.driftPhase === 1) {
        // + steering into the drift; through a lag, so a tap nudges and a held key tightens
        this.driftSteer += (clamp(-c.steer * dir, -1, 1) - this.driftSteer) * (1 - Math.exp(-dt / A.steerTau));
        const u = this.driftSteer;
        const ang = u >= 0 ? A.angle + (A.angleIn - A.angle) * u : A.angle + (A.angle - A.angleOut) * u;
        // the arc follows the key itself, not the body's lag: let go and the car slides on, angled, nearly straight;
        // press into the drift where the corner is and the arc closes (`turn*`, 2026-11-28)
        // the first `arcIn` s the tail swings out before the key bends the line: the press that starts it barely turns it
        const k = clamp(-c.steer * dir, -1, 1);
        const turn = k >= 0 ? A.turn + (A.turnIn - A.turn) * k * smoothstep(0, A.arcIn, this.driftT) : A.turn + (A.turn - A.turnOut) * k;
        // the turn builds through a lag (`turnTau`): the car carries its line a moment before the drift bends it
        this.driftTurn += (Math.min(turn, A.latMax / Math.max(v, 1)) - this.driftTurn) * (1 - Math.exp(-dt / A.turnTau));
        const omega = dir * this.driftTurn;
        psiNew = psiV + omega * dt;
        vNew = Math.max(0, v - Math.max(0, A.loss + A.lossIn * Math.max(0, u) + A.brakeLoss * c.brake - A.gas * c.throttle) * dt);
        const yawMax = this.driftT < A.entryT ? A.yawMaxIn : A.yawMax;
        yawCmd = omega + clamp(wrap(psiV + dir * ang - psiB) * A.yawK, -yawMax, yawMax);
        if (this.tune.nitro > 0) this.nitroFill = Math.min(1, this.nitroFill + A.charge * dt);
      } else {
        // the key is up: the travel turns to the nose, the body holds its heading
        const e = wrap(psiB - psiV), stepA = A.align * dt;
        psiNew = psiV + clamp(e, -stepA, stepA);
      }
      _t.set(Math.sin(psiNew) * vNew - vx, 0, Math.cos(psiNew) * vNew - vz).multiplyScalar(b.mass() * A.velGain);
      b.applyImpulse(_t, true);
      this.impulse.add(_t);
      _t.copy(this.up).multiplyScalar((yawCmd - this.yawRate) * A.yawGain * I[1]);
      b.applyTorqueImpulse(_t, true);
    }

    // --- assists ----------------------------------------------------------------------------------
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
      const intoG = clamp01(-st * Math.sign(this.bodySlip));
      const excess = Math.abs(this.bodySlip) - (s.assists.spinAngleNeutral + (s.assists.spinAngle - s.assists.spinAngleNeutral) * intoG);
      // Held off for half a second after the handbrake, so a handbrake turn can finish rotating.
      if (excess > 0 && this.tcOff < 0.5 && this.speed > 5 && grounded >= 3 && !arcade) {
        const k = Math.min(0.25, s.assists.spinGuard * excess * dt * 6);
        _t.copy(this.up).multiplyScalar(-this.yawRate * k * I[1]);
        b.applyTorqueImpulse(_t, true);
      }
    }
    if (c.keys && !s.single && grounded >= 3 && !handbrake && !arcade && this.tcOff <= 0 && this.forwardSpeed > KEYAID.vLo && !donut) {
      const K = KEYAID, v = this.forwardSpeed, u = Math.min(1, Math.abs(c.steer) / c.keys);
      const most = Math.min(s.tire.muLat * G * this.tune.grip / v, v * Math.tan(this.maxSteerAngle(v)) / this.wheelbase);
      const want = -Math.sign(c.steer) * u * most * (K.overSlow + (K.over - K.overSlow) * smoothstep(K.slowTo, K.fastFrom, v));
      let acc = (want - this.yawRate) * K.gain * smoothstep(K.vLo, K.vHi, v) * (1 - smoothstep(K.slipLo, K.slipHi, Math.abs(this.bodySlip)));
      // into the turn: not on the brakes, where the light rear would come round; holding it back: not in the throttle's
      // way on a car whose traction control lets the rear step out (`tcMax`)
      const push = acc * want > 0 && Math.abs(want) > Math.abs(this.yawRate);
      acc *= push ? 1 - c.brake : 1 - (tcHold < 1 ? smoothstep(0.3, 0.8, Math.abs(c.steer)) * c.throttle : 0);
      _t.copy(this.up).multiplyScalar(clamp(acc, -K.max, K.max) * dt * I[1]);
      b.applyTorqueImpulse(_t, true);
    }
    if (c.trail && c.reverse && !s.single && grounded >= 3 && !handbrake && this.forwardSpeed < -1) {
      const lim = s.tire.muLat * G * BACKING.grip / Math.max(1, this.speed);
      const geo = clamp(this.forwardSpeed * Math.tan(this.steerAngle) / this.wheelbase, -lim, lim);
      if (Math.abs(this.yawRate) > Math.abs(geo)) {
        _t.copy(this.up).multiplyScalar(clamp((geo - this.yawRate) * BACKING.damp, -10, 10) * dt * I[1]);
        b.applyTorqueImpulse(_t, true);
      }
    }
    if (c.trail && !s.single && !c.reverse && grounded >= 3 && !handbrake && !arcade && this.forwardSpeed > CATCH.vLo) {
      const K = CATCH, sl = Math.abs(this.bodySlip);
      const w = (1 - clamp01(Math.abs(st) / 0.3)) * smoothstep(K.lo, K.hi, sl) * smoothstep(K.vLo, K.vHi, this.speed) * (1 - K.gasCut * c.throttle);
      if (w > 0) {
        // bodySlip is + with the travel to the right of the nose: the nose goes right (yaw -)
        _t.copy(this.up).multiplyScalar((-this.bodySlip * K.k - this.yawRate * K.damp) * w * dt * I[1]);
        b.applyTorqueImpulse(_t, true);
      }
    }
    if (c.trail && c.handbrake && !s.single && !c.reverse && grounded >= 3 && this.forwardSpeed > HBTURN.vLo && st !== 0) {
      const v = Math.hypot(this.vel.x, this.vel.z);
      const w = Math.min(HBTURN.acc / v, HBTURN.rate) * Math.min(1, Math.abs(st)) * smoothstep(HBTURN.vLo, HBTURN.vHi, v);
      // steer + is right, where the travel's heading atan2(x, z) goes down
      const psi = Math.atan2(this.vel.x, this.vel.z) - Math.sign(st) * w * dt;
      _t.set(Math.sin(psi) * v - this.vel.x, 0, Math.cos(psi) * v - this.vel.z).multiplyScalar(b.mass());
      b.applyImpulse(_t, true);
      this.impulse.add(_t);
    }
    if (mine && grounded >= 3 && !handbrake && this.speed > 5) {
      const b0 = this.bodySlip, limit = SLIDE.angle + (SLIDE.angleIn - SLIDE.angle) * clamp01(-st * Math.sign(b0));
      const over = Math.abs(b0) - limit;
      if (over > -0.05) {
        const w = smoothstep(-0.05, 0.05, over) * smoothstep(5, 10, this.speed);
        // b0 > 0: the travel is right of the nose, the nose goes right (yaw -) to close it; yaw + opens it
        const acc = -Math.sign(b0) * Math.max(0, over) * SLIDE.k - (b0 * this.yawRate > 0 ? this.yawRate * SLIDE.damp : 0);
        _t.copy(this.up).multiplyScalar(acc * w * dt * I[1]);
        b.applyTorqueImpulse(_t, true);
      }
    }
    // --- the player's slide held on Space with the throttle: the key bends the arc, let go it slides on (`HOLD`) ----
    const holding = mine && c.handbrake && !c.reverse && grounded >= 3 && this.up.y > 0.8;
    if (this.holdDir !== 0 && (!holding || c.throttle < HOLD.gasOff || this.speed < HOLD.vLo * 0.75 || this.impact > ARCADE.crash)) this.holdDir = 0;
    if (this.holdDir === 0 && holding && c.throttle > HBGAS.gas && this.forwardSpeed > HOLD.vLo && Math.abs(c.steer) > HOLD.keyIn) {
      // steer - is left: a left slide, the travel right of the nose (bodySlip +)
      this.holdDir = c.steer < 0 ? 1 : -1; this.holdT = 0;
      this.holdTurn = Math.max(0, this.yawRate * this.holdDir);
    }
    if (this.holdDir !== 0) {
      const H = HOLD, side = this.holdDir;
      this.holdT += dt;
      const w = smoothstep(H.vLo * 0.75, H.vHi, this.speed);
      // the arc follows the key itself, its pull growing over the first `arcIn` s; the angle follows the slide's lag
      const k = clamp(-c.steer * side, -1, 1), u = clamp(-st * side, -1, 1);
      const want = k >= 0 ? H.turn + (H.turnIn - H.turn) * k * smoothstep(0, H.arcIn, this.holdT) : H.turn + (H.turn - H.turnOut) * k;
      const lv = b.linvel(), v = Math.hypot(lv.x, lv.z);
      this.holdTurn += (Math.min(want, H.latMax / Math.max(v, 1)) - this.holdTurn) * (1 - Math.exp(-dt / H.tau));
      // the travel's heading atan2(x, z) goes up turning left
      const omega = side * this.holdTurn;
      const psi = Math.atan2(this.velBefore.x, this.velBefore.z) + omega * dt;
      _t.set(Math.sin(psi) * v - lv.x, 0, Math.cos(psi) * v - lv.z).multiplyScalar(b.mass() * w);
      b.applyImpulse(_t, true);
      this.impulse.add(_t);
      const ang = u >= 0 ? H.angle + (H.angleIn - H.angle) * u : H.angle + (H.angle - H.angleOut) * u;
      const yawMax = this.holdT < H.entryT ? H.yawMaxIn : H.yawMax;
      const yawCmd = omega + clamp((side * ang - this.bodySlip) * H.yawK, -yawMax, yawMax);
      _t.copy(this.up).multiplyScalar((yawCmd - this.yawRate) * H.gain * w * I[1]);
      b.applyTorqueImpulse(_t, true);
    }
    // Sliding with the wheel near centre: bleed the rotation so a straightened slide straightens.
    if (grounded >= 3 && !handbrake && !arcade && this.tcOff <= 0 && this.speed > 4) {
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
    const limited = this.gear > 0 ? kmh > e.limiterKmh * this.tune.top : kmh > e.reverseKmh;
    if (this.shiftTimer > 0 || limited || c.throttle <= 0.02) {
      // Engine braking, always against the wheels' rotation.
      if (c.throttle <= 0.02 && this.rpm > e.idle * 1.3 && Math.abs(vDrive) > 1) {
        const t = e.engineBrake * torqueAt(e.torque, this.rpm) * Math.min(1, (this.rpm - e.idle) / 2500);
        return -Math.sign(vDrive) * Math.abs(t * ratio(this.gear) * e.final) / r;
      }
      return 0;
    }
    const torque = torqueAt(e.torque, Math.max(this.rpm, rpm)) * c.throttle * (this.rpm >= e.redline - 10 ? 0 : 1);
    return torque * this.tune.torque * ratio(this.gear) * e.final * e.efficiency / r;
  }
}
