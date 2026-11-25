import { approach, smoothstep } from './Tire';

/** What the physics consumes. */
export interface VehicleControls {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1 (left) .. 1 (right), before the speed-sensitive limiter
  handbrake: boolean;
  reverse: boolean;
  /** Throttle and brake together at a standstill: front brakes hold, rear tyres spin. */
  burnout: boolean;
  /** The player's drift key (QQ飞车-style arcade drift, Vehicle.ts `ARCADE`); a handbrake below its speed. */
  drift?: boolean;
  /** The player's brakes let go of the front tyres to steer (Vehicle.ts `TRAIL`). */
  trail?: boolean;
  /**
   * On keys: the share of lock a held key has at this speed (`steer` reaches this, no more), and the wheel angle follows
   * `steer` so that the turn does in proportion (Vehicle.ts `keyAngle`). 0 on a stick, the autopilot and traffic.
   */
  keys?: number;
}

/** Driver intent from a device or the autopilot. */
export interface DriveInput { forward: number; back: number; steer: number; analog: boolean; handbrake: boolean; drift?: boolean; trail?: boolean }

/**
 * Keyboard steering shape (see ControlFilter). Exported so tuning sweeps can vary it; the game
 * never writes to it.
 */
export const KEYBOARD = {
  /**
   * Lag time constant parked, plus the extra at 30 m/s and above, s (`tauFastTwo` on a two-wheeler). The extra was 0.3,
   * then 0.2, while the key drove the wheel angle and 0.4 of it was already the tyres' limit; with the turn in proportion
   * (`linear`) and the yaw aid (Vehicle.ts `KEYAID`) it is next to nothing, and a dodge is as quick as it was.
   */
  tauParked: 0.09, tauFast: 0.02, tauFastTwo: 0.2,
  /** Lag while swapping direction, s. */
  tauSwap: 0.05,
  /**
   * Lag back to centre once the key is up, s; never slower than the lag going in (0 = one lag both ways, as it was).
   * 2026-11-25, 「开车的手感不好」: the front tyres are at their limit from ~0.4 of the key, so on the way back the wheel
   * spent most of the lag above anything the car could feel, and the car turned on for 0.5-1 s after the key came up
   * (60 km/h, 0.6 s press: 19° more; a 0.1 s tap: 9.5°). With 0.08: 6° and 4°, calm in 0.27 s. Taps now average under
   * their duty at the wheel (4/8 -> 0.26) and nearer it in turn rate (2/8, 4/8, 6/8 -> 0.32, 0.72, 1.07 of a held key).
   * 0.12 since the turn is in proportion to the key (`linear`): as quick to stop, and steady taps ripple less;
   * `tauReleaseFast` from 30 m/s, where nervous taps wove the super 1.05 m at 120 km/h with 0.12.
   */
  tauRelease: 0.12, tauReleaseFast: 0.08,
  /**
   * Share of lock a held key gives up at speed, fading in between `cutFrom` and `cutTo` m/s.
   * Without `linear` and KEYAID only safe with a slow high-speed lag: with tauFast 0.11 the lock came back as the car
   * slowed in a long turn and a held key at 120 km/h ended in a 32-38° slide (.scratch/sweep).
   */
  highSpeedCut: 0.5, cutFrom: 18, cutTo: 36,
  /** The turn follows the key in proportion (Vehicle.ts `keyAngle`), not the wheel angle. */
  linear: true,
};

export const emptyControls = (): VehicleControls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: false, burnout: false, drift: false, trail: false, keys: 0 });

/**
 * Turns driver intent into pedal and steering positions.
 *
 * Keyboard steering is the reason this exists. A key is 0 or 1, and slamming the rack to full lock
 * in one frame is what makes keyboard driving feel like a shopping trolley: every tap is a jolt,
 * and there is no way to hold a partial angle through a long corner. So the wheel follows the key
 * through a first-order lag: ~0.2-0.25 s to
 * 90% of the key at any speed, the turn in proportion to it (Vehicle.ts `keyAngle`), and taps average to partial lock. It comes back
 * to centre faster than that (`tauRelease`), so the car stops turning when the key comes up.
 *
 * Pedals follow GTA's one-key-per-direction model: S brakes while rolling forward and reverses once
 * stopped, W brakes while rolling backwards. W+S at a standstill is a burnout.
 */
export class ControlFilter {
  readonly out: VehicleControls = emptyControls();
  private reversing = false;
  /**
   * 方向灵敏度（vehicle/SteerPref.ts），1 是调好的默认，只有玩家的车会改。按键：滞后时间 ÷ sense，
   * 高速时少给的舵 ÷ sense（最多少给 75%）；摇杆：中间那段的弧度 1.3 / sense，满舵照样推得到。
   */
  sense = 1;
  /** Driving a two-wheeler: keys keep the plain lag on the wheel angle. */
  two = false;

  reset(): void { Object.assign(this.out, emptyControls()); this.reversing = false; }

  update(i: DriveInput, forwardSpeed: number, dt: number): VehicleControls {
    const o = this.out;
    if (i.analog) {
      // A small expo keeps the centre of the stick precise without giving up full lock.
      const target = Math.sign(i.steer) * Math.pow(Math.abs(i.steer), 1.3 / this.sense);
      o.steer += (target - o.steer) * Math.min(1, dt * 22 * this.sense);
      o.keys = 0;
    } else {
      // First-order lag on the key: the wheel's average position follows the share of time the key
      // is held, so tapping gives partial lock at any duty (a rate limiter clamps at centre and
      // loses every tap shorter than the return). Swapping direction passes centre quickly, and so
      // does letting go (`tauRelease`).
      // A held key asks for less lock at motorway speed (65% at 130 km/h): full lock there is the
      // tyre's whole 1 g, and every short correction tap was a lurch (0.25 m -> 1.25 m of weave once
      // taps started to count). A stick still reaches full lock.
      const K = KEYBOARD, sense = this.sense;
      const cut = sense === 1 ? K.highSpeedCut : Math.min(0.75, K.highSpeedCut / sense);
      const full = 1 - cut * smoothstep(K.cutFrom, K.cutTo, Math.abs(forwardSpeed));
      const target = i.steer * full;
      o.keys = K.linear && !this.two ? full : 0;
      const fast = Math.min(1, Math.abs(forwardSpeed) / 30);
      const tauIn = K.tauParked + (this.two ? K.tauFastTwo : K.tauFast) * fast;
      const tau = (o.steer * target < 0 ? K.tauSwap : i.steer === 0 && K.tauRelease > 0 ? Math.min(tauIn, K.tauRelease + (K.tauReleaseFast - K.tauRelease) * fast) : tauIn) / sense;
      o.steer += (target - o.steer) * (1 - Math.exp(-dt / tau));
      if (Math.abs(o.steer) < 1e-4) o.steer = 0;
    }

    let throttle = 0, brake = 0;
    o.burnout = false;
    if (i.forward > 0 && i.back > 0 && Math.abs(forwardSpeed) < 1.5) {
      throttle = 1; brake = 1; o.burnout = true; this.reversing = false;
    } else if (this.reversing) {
      if (i.forward > 0) {
        if (forwardSpeed < -1) brake = i.forward;
        else { this.reversing = false; throttle = i.forward; }
      } else if (i.back > 0) throttle = i.back;
    } else {
      if (i.back > 0) {
        if (forwardSpeed > 1) brake = i.back;
        else { this.reversing = true; throttle = i.back; }
      } else if (i.forward > 0) throttle = i.forward;
    }
    if (i.analog) { o.throttle = throttle; o.brake = brake; }
    else {
      o.throttle = approach(o.throttle, throttle, (throttle > o.throttle ? 7 : 12) * dt);
      o.brake = approach(o.brake, brake, (brake > o.brake ? 9 : 14) * dt);
    }
    o.reverse = this.reversing;
    o.handbrake = i.handbrake;
    o.drift = !!i.drift;
    o.trail = !!i.trail;
    return o;
  }
}
