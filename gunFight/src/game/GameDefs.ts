/**
 * Every gameplay tunable for the survival mode lives here: the difficulty curve, scoring,
 * streaks, spawn director pacing, grenades and pickups. Pure data, no three.js imports,
 * so the logic layer (GameLogic.ts) can be unit-tested in node.
 */
import type { EnemyDifficulty } from './Contracts';

/** Weighted archetype mix; keys are passed to EnemiesApi.spawn(pos, { archetype }). */
export type ArchetypeMix = Record<string, number>;

export interface WaveDef {
  wave: number;
  /** Total enemies in the wave. */
  count: number;
  /** Cap on simultaneously alive enemies (further capped by quality.maxEnemies). */
  maxAlive: number;
  /** Seconds between spawns while the field is comfortably populated. */
  interval: number;
  /** How many enemies rush in at wave start (spaced by BURST_SPACING). */
  burst: number;
  mix: ArchetypeMix;
  difficulty: EnemyDifficulty;
}

/**
 * Hand-tuned first ten waves; beyond that `waveDef()` extrapolates.
 *
 * Pacing rule of thumb: `burst` fills the field to `maxAlive` at wave start (so a wave opens as a
 * wave, not as a trickle) and `interval` only governs how fast kills are *backfilled*. Concurrency
 * is therefore set by `maxAlive` alone — shortening `interval` makes the pressure continuous without
 * making the peak fight any bigger. The old table opened wave 1 with 3 of 6 and backfilled every
 * 2.4 s, so an efficient player spent more of the wave waiting for the next spawn than fighting.
 */
export const WAVE_TABLE: readonly WaveDef[] = [
  { wave: 1, count: 6, maxAlive: 4, interval: 1.6, burst: 4, mix: { grunt: 1 }, difficulty: { accuracy: 0.55, damage: 0.8, reaction: 1.4, aggression: 0.8 } },
  { wave: 2, count: 9, maxAlive: 5, interval: 1.5, burst: 5, mix: { grunt: 3, rifleman: 1 }, difficulty: { accuracy: 0.65, damage: 0.85, reaction: 1.3, aggression: 0.85 } },
  { wave: 3, count: 12, maxAlive: 6, interval: 1.45, burst: 6, mix: { grunt: 2, rifleman: 2 }, difficulty: { accuracy: 0.72, damage: 0.9, reaction: 1.2, aggression: 0.9 } },
  { wave: 4, count: 15, maxAlive: 7, interval: 1.35, burst: 7, mix: { grunt: 2, rifleman: 2, shotgunner: 1 }, difficulty: { accuracy: 0.8, damage: 0.95, reaction: 1.1, aggression: 1.0 } },
  { wave: 5, count: 18, maxAlive: 8, interval: 1.25, burst: 8, mix: { grunt: 1, rifleman: 3, shotgunner: 1 }, difficulty: { accuracy: 0.88, damage: 1.0, reaction: 1.0, aggression: 1.05 } },
  { wave: 6, count: 22, maxAlive: 9, interval: 1.2, burst: 9, mix: { grunt: 1, rifleman: 3, shotgunner: 1, heavy: 1 }, difficulty: { accuracy: 0.95, damage: 1.05, reaction: 0.95, aggression: 1.1 } },
  { wave: 7, count: 26, maxAlive: 10, interval: 1.1, burst: 10, mix: { rifleman: 3, shotgunner: 2, heavy: 1 }, difficulty: { accuracy: 1.0, damage: 1.1, reaction: 0.9, aggression: 1.15 } },
  { wave: 8, count: 30, maxAlive: 11, interval: 1.05, burst: 11, mix: { rifleman: 3, shotgunner: 2, heavy: 1, sniper: 1 }, difficulty: { accuracy: 1.05, damage: 1.15, reaction: 0.85, aggression: 1.2 } },
  { wave: 9, count: 35, maxAlive: 12, interval: 1.0, burst: 12, mix: { rifleman: 3, shotgunner: 2, heavy: 2, sniper: 1 }, difficulty: { accuracy: 1.1, damage: 1.2, reaction: 0.8, aggression: 1.25 } },
  { wave: 10, count: 40, maxAlive: 13, interval: 0.95, burst: 13, mix: { rifleman: 2, shotgunner: 2, heavy: 2, sniper: 1 }, difficulty: { accuracy: 1.15, damage: 1.25, reaction: 0.75, aggression: 1.3 } },
];

/** Growth applied per wave past the end of WAVE_TABLE. */
export const WAVE_EXTRAPOLATION = {
  countPerWave: 5,
  countMax: 90,
  maxAlivePerWave: 0.5,
  maxAliveMax: 18,
  intervalDecay: 0.96,
  intervalMin: 0.6,
  accuracyPerWave: 0.03,
  accuracyMax: 1.6,
  damagePerWave: 0.04,
  damageMax: 2.0,
  reactionDecay: 0.97,
  reactionMin: 0.5,
  aggressionPerWave: 0.03,
  aggressionMax: 1.8,
};

/** Spawn director pacing. */
export const DIRECTOR = {
  /** Spacing between the wave-opening burst spawns. */
  burstSpacing: 0.35,
  /** When alive count drops to or below this fraction of maxAlive, spawn at the trickle rate. */
  lowPressureFraction: 0.6,
  /** Trickle interval scalar (fraction of the wave interval) used to keep pressure steady. */
  trickleScale: 0.3,
  /**
   * Hard ceiling on how long the map may be EMPTY while the wave still has enemies to deploy.
   * The interval exists to pace pressure, not to create silence: a player who clears the field
   * must never be left hunting an empty street. Kept just long enough that the last kill's ragdoll
   * and hitmarker land before the next contact appears.
   */
  emptyFieldGrace: 0.35,
  /** Seconds between waves. */
  breather: 6,
  /** Seconds before the next wave when the "incoming" warning shows. */
  incomingWarning: 3,
  /** Minimum wave duration before a wave may be declared complete (guards against stubbed enemies). */
  minWaveTime: 0.5,
};

/** Spawn-point selection scoring. Higher is better. */
export const SPAWN_SELECT = {
  /** Distances closer than this are heavily penalised (player would see them pop in). */
  tooClose: 10,
  /** Ideal spawn distance band. */
  idealMin: 16,
  idealMax: 40,
  /** Beyond this distance the enemy takes too long to arrive. */
  tooFar: 60,
  /** Penalty when the player has line of sight to the point. */
  visiblePenalty: 40,
  /** Penalty when the point is inside the player's forward cone (dot > inViewDot). */
  inViewPenalty: 15,
  inViewDot: 0.35,
  /** Penalty for each of the last N used points (most recent gets full penalty). */
  recentPenalty: 25,
  recentMemory: 3,
  /**
   * Extra distance penalty applied when the director is spawning into an EMPTY field: the player is
   * already waiting, so a point 55 m away that takes ten seconds to walk in is worse than a nearer
   * one. Scales from 0 at `idealMin` to the full value at `tooFar`. Line-of-sight is still penalised
   * at full strength — reinforcements must never pop in while the player is looking at the spot.
   */
  urgentFarPenalty: 30,
  /** Random jitter added so equal-scoring points alternate. */
  jitter: 8,
  /** Fallback ring radius when the level exposes no enemy spawns. */
  fallbackRadius: 26,
  fallbackCount: 8,
};

export const SCORING = {
  kill: 100,
  headshotBonus: 50,
  /** Wave clear bonus = waveClearBase * wave. */
  waveClearBase: 250,
  /** Streak tiers: [minStreak, multiplier], ascending. */
  streakTiers: [[1, 1], [3, 1.5], [5, 2], [10, 3]] as ReadonlyArray<readonly [number, number]>,
  /** Seconds without a kill before the streak resets. */
  streakWindow: 4,
};

export const GRENADE = {
  maxCarried: 2,
  fuse: 3.5,
  radius: 6,
  /** Damage at the blast centre; linear falloff to `edgeFraction` at the radius. */
  damage: 140,
  edgeFraction: 0.2,
  /** Player takes less from their own frag (CoD-style). */
  selfDamageScale: 0.6,
  throwSpeed: 16,
  /** Upward component added to the throw direction. */
  throwLift: 0.18,
  /** Physical radius of the ball collider (m). Visual mesh is slightly larger for readability. */
  colliderRadius: 0.065,
  visualRadius: 0.075,
  mass: 0.4,
  restitution: 0.42,
  friction: 0.7,
  linearDamping: 0.15,
  angularDamping: 0.6,
  /** Concurrent live grenades in the pool. */
  poolSize: 4,
  /** Camera shake at the blast centre; falls off to zero at shakeRange * radius. */
  shake: 1.2,
  shakeRange: 2.5,
  /** Throw cooldown (s). */
  cooldown: 0.9,
};

export interface PickupDef { x: number; y: number; z: number; yaw: number }

export const PICKUPS = {
  /** Fallback crate positions (used when the level exposes no `ammo*` landmarks). */
  crates: [
    { x: -8, y: 0, z: -1.6, yaw: 0.2 },
    { x: 8.2, y: 0, z: -3.6, yaw: -0.4 },
    { x: 4.6, y: 0, z: 4.2, yaw: 1.2 },
  ] as readonly PickupDef[],
  /** Interaction radius (m) measured from the crate centre to the player. */
  reach: 2.0,
  /** Seconds before a crate can be used again. */
  cooldown: 30,
  /** Magazines of reserve ammo granted per weapon slot. */
  magsPerSlot: 2,
  /** Magazines granted per slot at every wave clear. */
  breatherMagsPerSlot: 4,
};
