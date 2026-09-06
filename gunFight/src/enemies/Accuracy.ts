/**
 * CoD-style AI accuracy model: each shot is either "aimed" (small spread around the target) or a
 * deliberate near-miss (suppression). The hit-intent probability rises with time on target and
 * decays with distance; movement (either party) lowers it. Pure functions, unit tested.
 */
import { ACCURACY } from './EnemyDefs';
import { clamp, lerp } from './Gait';

export interface AccuracyInput {
  distance: number;
  timeOnTarget: number;
  shooterMoving: boolean;
  targetSprinting: boolean;
  targetCrouching: boolean;
  /** archetype * difficulty multiplier */
  accuracyMul: number;
}

/** Probability that the next shot is aimed at the target rather than a deliberate near miss. */
export function hitIntentChance(i: AccuracyInput): number {
  const t = clamp(i.timeOnTarget / ACCURACY.timeToMaxAccuracy, 0, 1);
  let c = lerp(ACCURACY.baseHitChance, ACCURACY.maxHitChance, t * t * (3 - 2 * t));
  const far = clamp(i.distance / ACCURACY.farDist, 0, 1);
  c *= lerp(1, ACCURACY.farFrac, far);
  if (i.shooterMoving) c *= ACCURACY.movingMul;
  if (i.targetSprinting) c *= ACCURACY.targetSprintingMul;
  if (i.targetCrouching) c *= ACCURACY.targetCrouchMul;
  return clamp(c * i.accuracyMul, 0, 0.97);
}

/**
 * Compute a shot offset in a frame around the aim line: returns { aimed, spread, missX, missY }
 * where spread is angular jitter (radians) and missX/missY are metres of lateral/vertical offset
 * from the target point to steer a deliberate miss.
 * `r0..r3` are uniform randoms in [0,1) so the caller controls determinism.
 */
export function shotOffset(i: AccuracyInput, r0: number, r1: number, r2: number, r3: number): { aimed: boolean; spread: number; missX: number; missY: number } {
  const aimed = r0 < hitIntentChance(i);
  if (aimed) return { aimed: true, spread: ACCURACY.aimedSpread * (i.shooterMoving ? 1.6 : 1), missX: 0, missY: 0 };
  const radius = lerp(ACCURACY.missRadiusMin, ACCURACY.missRadiusMax, r1);
  const ang = r2 * Math.PI * 2;
  const h = ACCURACY.missBiasHorizontal;
  // bias misses horizontally so they whizz past the player rather than into the ground
  const mx = Math.cos(ang) * radius * (h + (1 - h) * r3);
  const my = Math.sin(ang) * radius * (1 - h * 0.5);
  return { aimed: false, spread: ACCURACY.aimedSpread * 2, missX: mx, missY: my + 0.1 };
}

/** Burst length for an archetype at a distance: closer = longer bursts (CoD "spray when close"). */
export function burstLength(min: number, max: number, distance: number, r: number): number {
  const closeness = clamp(1 - distance / 30, 0, 1);
  const span = max - min;
  return Math.round(min + span * clamp(r * 0.5 + closeness * 0.6, 0, 1));
}

/** Damage per bullet with falloff. */
export function bulletDamage(dmin: number, dmax: number, distance: number, r: number, difficultyMul: number): number {
  const base = lerp(dmin, dmax, r);
  const falloff = 1 - clamp((distance - 25) / 60, 0, 0.5);
  return Math.round(base * falloff * difficultyMul);
}
