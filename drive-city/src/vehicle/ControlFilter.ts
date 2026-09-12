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
}

/** Driver intent from a device or the autopilot. */
export interface DriveInput { forward: number; back: number; steer: number; analog: boolean; handbrake: boolean }

/**
 * Keyboard steering shape (see ControlFilter). Exported so tuning sweeps can vary it; the game
 * never writes to it.
 */
export const KEYBOARD = {
  /** Lag time constant parked, plus the extra at 30 m/s and above, s. */
  tauParked: 0.09, tauFast: 0.3,
  /** Lag while swapping direction, s. */
  tauSwap: 0.05,
  /**
   * Share of lock a held key gives up at speed, fading in between `cutFrom` and `cutTo` m/s.
   * Only safe with the slow high-speed lag above: with tauFast 0.11 the lock came back as the car
   * slowed in a long turn and a held key at 120 km/h ended in a 32-38° slide (.scratch/sweep).
   */
  highSpeedCut: 0.5, cutFrom: 18, cutTo: 36,
};

export const emptyControls = (): VehicleControls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, reverse: false, burnout: false });

/**
 * Turns driver intent into pedal and steering positions.
 *
 * Keyboard steering is the reason this exists. A key is 0 or 1, and slamming the rack to full lock
 * in one frame is what makes keyboard driving feel like a shopping trolley: every tap is a jolt,
 * and there is no way to hold a partial angle through a long corner. So the wheel follows the key
 * through a first-order lag (slower at speed, where the same angle means far more yaw): ~0.2 s to
 * 90% of lock when parked, ~0.45 s at motorway speed, and taps average to partial lock.
 *
 * Pedals follow GTA's one-key-per-direction model: S brakes while rolling forward and reverses once
 * stopped, W brakes while rolling backwards. W+S at a standstill is a burnout.
 */
export class ControlFilter {
  readonly out: VehicleControls = emptyControls();
  private reversing = false;

  reset(): void { Object.assign(this.out, emptyControls()); this.reversing = false; }

  update(i: DriveInput, forwardSpeed: number, dt: number): VehicleControls {
    const o = this.out;
    if (i.analog) {
      // A small expo keeps the centre of the stick precise without giving up full lock.
      const target = Math.sign(i.steer) * Math.pow(Math.abs(i.steer), 1.3);
      o.steer += (target - o.steer) * Math.min(1, dt * 22);
    } else {
      // First-order lag on the key: the wheel's average position is exactly the share of time the
      // key is held, so tapping gives partial lock at any duty (a rate limiter clamps at centre and
      // loses every tap shorter than the return). Slower at speed, where the same angle means far
      // more yaw; swapping direction passes centre quickly.
      // A held key asks for less lock at motorway speed (65% at 130 km/h): full lock there is the
      // tyre's whole 1 g, and every short correction tap was a lurch (0.25 m -> 1.25 m of weave once
      // taps started to count). A stick still reaches full lock.
      const K = KEYBOARD;
      const target = i.steer * (1 - K.highSpeedCut * smoothstep(K.cutFrom, K.cutTo, Math.abs(forwardSpeed)));
      const fast = Math.min(1, Math.abs(forwardSpeed) / 30);
      const tau = o.steer * target < 0 ? K.tauSwap : K.tauParked + K.tauFast * fast;
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
    return o;
  }
}
