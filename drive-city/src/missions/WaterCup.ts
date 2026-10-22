/**
 * The cup of water on the dashboard (2026-10-22, 头文字D's tofu run: 「仪表台上放一杯水，横向 / 纵向 G 值太大水就会洒，
 * 洒光任务失败」). Pure, so it is tested without a car (WaterCup.test.ts).
 *
 * The water's surface is a damped spring chasing the car's horizontal acceleration (body frame, in g): held steady it
 * settles at the tilt the acceleration gives it, but a sudden brake or a flick of the wheel throws it past that and it
 * rocks back - so a smooth driver can corner hard and a jerky one spills at half the force. Water goes over the rim at
 * a rate in proportion to how far the surface is past what the rim holds, and the rim holds more as the cup empties
 * (the water is further below it). A crash throws a share out at once and sets the surface rocking.
 */
export const CUP = {
  /** The slosh's natural frequency (Hz) and damping ratio: underdamped, a step overshoots by ~28%. */
  freq: 1.5,
  damping: 0.38,
  /** The surface tilt (g) a full cup holds before it spills, and how much more an empty one holds. */
  rim: 0.7,
  rimEmpty: 0.55,
  /** Spilt per second per g past the rim (as a share of the cup). */
  rate: 0.4,
  /** Acceleration read is clipped to this (g): collisions are the impact's business. */
  maxG: 1.4,
  /** Below this the cup is empty: the run is lost. */
  fail: 0.1,
};

// Calibrated on the AE86's real physics (.scratch/cup/calib.test.ts, two laps of a block: four 120 m straights, four
// 12 m corners): braking early and cornering under ~0.65 g spills nothing; 33 km/h corners (0.88 g) cost 17%, 38 km/h
// ones 45%, braking at the corner from 80 about two thirds; a full stop from 60 with the key held 17%, half a pedal 9%.
const G = 9.81;

export class WaterCup {
  /** 1 = full. */
  level = 1;
  /** The surface's slope, x to the left and z forward, in g (where the water heaps up is the opposite way). */
  sx = 0;
  sz = 0;
  /** Seconds since water last went over the rim (the HUD splashes for a moment). */
  sinceSpill = 99;
  private vx = 0;
  private vz = 0;

  reset(): void {
    this.level = 1; this.sx = this.sz = this.vx = this.vz = 0; this.sinceSpill = 99;
  }

  get empty(): boolean { return this.level <= CUP.fail; }
  /** How far past the rim's limit the surface is right now (0 = holding). */
  get over(): number { return Math.max(0, Math.hypot(this.sx, this.sz) - this.rimLimit()); }

  private rimLimit(): number { return CUP.rim + CUP.rimEmpty * (1 - this.level); }

  /**
   * One step: `ax`, `az` the car's acceleration (m/s², x left, z forward - `Vehicle.accel`). Returns what went over
   * the rim this step.
   */
  step(dt: number, ax: number, az: number): number {
    const gx = Math.max(-CUP.maxG, Math.min(CUP.maxG, ax / G));
    const gz = Math.max(-CUP.maxG, Math.min(CUP.maxG, az / G));
    const w = 2 * Math.PI * CUP.freq, c = 2 * CUP.damping * w;
    // semi-implicit Euler: stable at 60 Hz for w ~ 9.4
    this.vx += (w * w * (gx - this.sx) - c * this.vx) * dt;
    this.vz += (w * w * (gz - this.sz) - c * this.vz) * dt;
    this.sx += this.vx * dt;
    this.sz += this.vz * dt;
    this.sinceSpill += dt;
    const over = this.over;
    if (over <= 0 || this.level <= 0) return 0;
    const out = Math.min(this.level, CUP.rate * over * dt);
    this.level -= out;
    this.sinceSpill = 0;
    return out;
  }

  /** A crash of `strength` (m/s of unexplained Δv, `vehicle:impact`): a share out at once, the surface set rocking. */
  impact(strength: number): number {
    if (strength < 2.5) return 0;
    const out = Math.min(this.level, Math.min(0.45, (strength - 2.5) * 0.035));
    this.level -= out;
    if (out > 0) this.sinceSpill = 0;
    this.vz += Math.min(6, strength * 0.4);
    return out;
  }
}
