/**
 * Pure gait math. No three.js, no state — everything is a function of (phase, params) so it can be
 * unit-tested and so the animator can blend several gaits by evaluating them at the same phase.
 */
import { ANIM } from './EnemyDefs';

export interface GaitParams {
  /** stride length (distance between consecutive footfalls of the same foot) in metres */
  stride: number;
  /** foot lift height in metres during swing */
  lift: number;
  /** fraction of the cycle a foot spends on the ground */
  stanceFrac: number;
  /** vertical bounce amplitude of the hips (metres) */
  bounce: number;
  /** forward lean (radians) */
  lean: number;
}

export interface FootSample {
  /** offset along movement direction relative to the hip, metres */
  forward: number;
  /** height above the ground, metres */
  up: number;
  /** 1 during stance (planted), 0 in swing */
  planted: number;
  /** foot pitch: positive = toes down (plantar flexion), radians */
  pitch: number;
}

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const wrap01 = (x: number): number => x - Math.floor(x);

/** Gait parameters for a body speed (m/s). Blends walk→run continuously so transitions don't pop. */
export function gaitFor(speed: number, crouch: number): GaitParams {
  const t = smoothstep((speed - 1.4) / 2.2);
  // Below the reference walk speed the stride has to shorten too, or a soldier picking his way
  // forward at 1 m/s takes 68 cm steps and reads from the side as a fencing lunge rather than a
  // patrol walk. Cadence follows from stride in phaseRate(), so shorter steps just mean more of them.
  const slow = clamp(speed / 1.4, 0.5, 1);
  const stride = lerp(lerp(ANIM.walkStride * slow, ANIM.runStride, t), ANIM.crouchStride * slow, crouch);
  return {
    stride,
    lift: lerp(lerp(ANIM.walkLift, ANIM.runLift, t), ANIM.walkLift * 0.7, crouch),
    stanceFrac: lerp(ANIM.stanceFrac, 0.5, t),
    bounce: lerp(ANIM.walkBounce, ANIM.runBounce, t),
    lean: lerp(lerp(ANIM.walkLean, ANIM.runLean, t), 0.35, crouch),
  };
}

/**
 * Cycle rate (cycles / second) that makes a planted foot stationary in world space:
 * during stance a foot travels `stride` backwards relative to the hips in stanceFrac of a cycle.
 */
export function phaseRate(speed: number, p: GaitParams): number {
  if (p.stride <= 1e-4) return 0;
  return (speed * p.stanceFrac) / p.stride;
}

/**
 * Foot offset for a given cycle phase (0..1). Stance = phase in [0, stanceFrac): foot glides
 * linearly from +stride/2 to -stride/2 (so at the correct phase rate it is world-locked).
 * Swing = the remainder: foot returns forward on a raised arc.
 */
export function footCurve(phase: number, p: GaitParams): FootSample {
  const ph = wrap01(phase);
  const half = p.stride / 2;
  if (ph < p.stanceFrac) {
    const t = ph / p.stanceFrac;
    // heel strike at t=0 slightly toes-up, push-off at t=1 toes-down
    const pitch = lerp(-0.18, 0.35, smoothstep((t - 0.55) / 0.45)) * (t < 0.15 ? t / 0.15 : 1) + (t < 0.15 ? -0.18 * (1 - t / 0.15) : 0);
    return { forward: lerp(half, -half, t), up: 0, planted: 1, pitch };
  }
  const t = (ph - p.stanceFrac) / (1 - p.stanceFrac);
  const s = smoothstep(t);
  const up = Math.sin(Math.PI * t) * p.lift;
  return { forward: lerp(-half, half, s), up, planted: 0, pitch: lerp(0.4, -0.15, s) };
}

/** Hips bob/sway for a cycle phase (two bounces per cycle, one sway). */
export function hipsCurve(phase: number, p: GaitParams, moveBlend: number): { bob: number; sway: number; yaw: number; roll: number } {
  const a = phase * Math.PI * 2;
  return {
    bob: (-Math.abs(Math.cos(a)) + 0.5) * p.bounce * 2 * moveBlend,
    sway: Math.sin(a) * ANIM.hipSway * moveBlend,
    yaw: Math.sin(a) * ANIM.hipYaw * moveBlend,
    roll: Math.sin(a) * 0.05 * moveBlend,
  };
}

/** Arm swing for unarmed limbs (we hold a rifle so this only leaks in as a small amount). */
export function armSwing(phase: number, amount: number): number { return Math.sin(phase * Math.PI * 2) * amount; }

/** Critically-damped-ish spring used for flinches and blend weights: returns new [x, v]. */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const detX = f * x + dt * v + hhoo * target;
  const detV = v + hoo * (target - x);
  return [detX * detInv, detV * detInv];
}

/** Exponential damping toward a target (frame-rate independent). */
export function damp(cur: number, target: number, rate: number, dt: number): number {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}
export function dampAngle(cur: number, target: number, rate: number, dt: number): number {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * (1 - Math.exp(-rate * dt));
}
