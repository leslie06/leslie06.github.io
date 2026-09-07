/**
 * Pure gameplay logic for the survival mode: wave tables, scoring/streaks, spawn selection and
 * director pacing. No three.js, no engine, no side effects — everything here is unit-tested.
 */
import type { EnemyDifficulty } from './Contracts';
import { DIRECTOR, SCORING, SPAWN_SELECT, WAVE_EXTRAPOLATION, WAVE_TABLE, type ArchetypeMix, type WaveDef } from './GameDefs';

export interface Vec3 { x: number; y: number; z: number }

/** Minimal random source so callers can pass a seeded Rng (core/Rng.ts) or a stub in tests. */
export interface RandomSource { next(): number }

// ---------------------------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------------------------

/** Difficulty for wave `n` (1-based). Waves past the table extrapolate from its last row. */
export function waveDef(n: number): WaveDef {
  const w = Math.max(1, Math.floor(n));
  const row = WAVE_TABLE[w - 1];
  if (row) return row;
  const last = WAVE_TABLE[WAVE_TABLE.length - 1];
  const extra = w - last.wave;
  const X = WAVE_EXTRAPOLATION;
  const difficulty: EnemyDifficulty = {
    accuracy: Math.min(X.accuracyMax, last.difficulty.accuracy + X.accuracyPerWave * extra),
    damage: Math.min(X.damageMax, last.difficulty.damage + X.damagePerWave * extra),
    reaction: Math.max(X.reactionMin, last.difficulty.reaction * Math.pow(X.reactionDecay, extra)),
    aggression: Math.min(X.aggressionMax, last.difficulty.aggression + X.aggressionPerWave * extra),
  };
  return {
    wave: w,
    count: Math.min(X.countMax, last.count + X.countPerWave * extra),
    maxAlive: Math.min(X.maxAliveMax, Math.round(last.maxAlive + X.maxAlivePerWave * extra)),
    interval: Math.max(X.intervalMin, last.interval * Math.pow(X.intervalDecay, extra)),
    burst: Math.min(X.maxAliveMax, last.burst + Math.floor(extra / 2)),
    mix: last.mix,
    difficulty,
  };
}

/** Number of enemies in wave `n`. */
export function enemyCount(n: number): number { return waveDef(n).count; }

/** Weighted random archetype from a mix. Deterministic given the random source. */
export function pickArchetype(mix: ArchetypeMix, rng: RandomSource): string {
  const entries = Object.entries(mix).filter(([, w]) => w > 0);
  if (entries.length === 0) return 'grunt';
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [name, w] of entries) { r -= w; if (r <= 0) return name; }
  return entries[entries.length - 1][0];
}

// ---------------------------------------------------------------------------------------------
// Scoring & streaks
// ---------------------------------------------------------------------------------------------

/** Score multiplier for the current streak length (tiered). */
export function streakMultiplier(streak: number): number {
  let mult = 1;
  for (const [min, m] of SCORING.streakTiers) if (streak >= min) mult = m;
  return mult;
}

/** Points for a single kill at the given (already incremented) streak. */
export function killScore(streak: number, headshot: boolean): number {
  const base = SCORING.kill + (headshot ? SCORING.headshotBonus : 0);
  return Math.round(base * streakMultiplier(streak));
}

/** Bonus for clearing wave `n`. */
export function waveClearBonus(wave: number): number { return SCORING.waveClearBase * Math.max(1, wave); }

export interface StreakState { streak: number; lastKillTime: number }

/** A kill at time `now`: continues the streak if the previous kill was within the window, else starts at 1. */
export function advanceStreak(s: StreakState, now: number, window = SCORING.streakWindow): StreakState {
  const cont = s.streak > 0 && now - s.lastKillTime <= window;
  return { streak: cont ? s.streak + 1 : 1, lastKillTime: now };
}

/** Streak after `now` seconds with no kill: expires past the window. */
export function expireStreak(s: StreakState, now: number, window = SCORING.streakWindow): StreakState {
  if (s.streak > 0 && now - s.lastKillTime > window) return { streak: 0, lastKillTime: s.lastKillTime };
  return s;
}

export interface BestLike { score: number; wave: number; kills: number }

/** Merge a finished/ongoing run into the personal best (each field is a max). */
export function mergeBest(best: BestLike, run: BestLike): BestLike {
  return { score: Math.max(best.score, run.score), wave: Math.max(best.wave, run.wave), kills: Math.max(best.kills, run.kills) };
}

// ---------------------------------------------------------------------------------------------
// Spawn selection
// ---------------------------------------------------------------------------------------------

export interface SpawnChoiceInput {
  spawns: readonly Vec3[];
  playerPos: Vec3;
  /** Unit horizontal forward of the player. */
  playerForward: Vec3;
  /** True when the player can see this point (raycast is done by the caller). */
  visible: (p: Vec3, index: number) => boolean;
  /** Indices of the most recently used spawn points, most recent first. */
  recent: readonly number[];
  /**
   * 0 normally; 1 when the map is empty and the player is standing around waiting. Biases the pick
   * toward points the reinforcement can actually walk in from quickly, without ever relaxing the
   * "not in the player's line of sight" rule.
   */
  urgency?: number;
  rng: RandomSource;
}

function dist3(a: Vec3, b: Vec3): number { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

/** Score for one candidate spawn point (higher is better). Exported for tests. */
export function spawnScore(p: Vec3, index: number, input: Omit<SpawnChoiceInput, 'spawns' | 'rng'>): number {
  const S = SPAWN_SELECT;
  const d = dist3(p, input.playerPos);
  let score = 0;
  if (d < S.tooClose) score -= (S.tooClose - d) * 12;
  else if (d < S.idealMin) score += (d - S.tooClose) / (S.idealMin - S.tooClose) * 20;
  else if (d <= S.idealMax) score += 20;
  else if (d <= S.tooFar) score += 20 - (d - S.idealMax) / (S.tooFar - S.idealMax) * 15;
  else score += 5 - (d - S.tooFar) * 0.5;
  const dx = p.x - input.playerPos.x, dz = p.z - input.playerPos.z;
  const len = Math.hypot(dx, dz) || 1;
  const dot = (dx / len) * input.playerForward.x + (dz / len) * input.playerForward.z;
  if (dot > S.inViewDot) score -= S.inViewPenalty * ((dot - S.inViewDot) / (1 - S.inViewDot));
  const urgency = input.urgency ?? 0;
  if (urgency > 0 && d > S.idealMin) {
    score -= S.urgentFarPenalty * urgency * Math.min(1, (d - S.idealMin) / Math.max(1e-3, S.tooFar - S.idealMin));
  }
  if (input.visible(p, index)) score -= S.visiblePenalty;
  const r = input.recent.indexOf(index);
  if (r >= 0 && r < S.recentMemory) score -= S.recentPenalty * (1 - r / S.recentMemory);
  return score;
}

/** Pick the spawn index that is far from, behind, and out of sight of the player. Never returns -1 when spawns is non-empty. */
export function chooseSpawn(input: SpawnChoiceInput): number {
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < input.spawns.length; i++) {
    const s = spawnScore(input.spawns[i], i, input) + input.rng.next() * SPAWN_SELECT.jitter;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

/** Ring of spawn points around `center` for levels that expose none, clamped to bounds (inset by 2m). */
export function fallbackSpawns(center: Vec3, bounds: { min: Vec3; max: Vec3 }, radius = SPAWN_SELECT.fallbackRadius, count = SPAWN_SELECT.fallbackCount): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({
      x: Math.min(bounds.max.x - 2, Math.max(bounds.min.x + 2, center.x + Math.cos(a) * radius)),
      y: center.y,
      z: Math.min(bounds.max.z - 2, Math.max(bounds.min.z + 2, center.z + Math.sin(a) * radius)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Spawn director pacing
// ---------------------------------------------------------------------------------------------

export interface DirectorInput {
  def: WaveDef;
  /** Enemies spawned so far this wave. */
  spawned: number;
  alive: number;
  /** Effective cap (min of wave maxAlive and quality maxEnemies). */
  maxAlive: number;
}

/** Effective alive cap for a wave under a quality budget. Always >= 1. */
export function effectiveMaxAlive(def: WaveDef, qualityMax: number): number {
  return Math.max(1, Math.min(def.maxAlive, qualityMax));
}

/**
 * Delay until the next spawn after one has just been issued: fast during the opening burst,
 * trickle-fast while the field is thin, else the wave's nominal interval.
 */
export function nextSpawnDelay(input: DirectorInput): number {
  const { def, spawned, alive, maxAlive } = input;
  if (spawned < def.burst) return DIRECTOR.burstSpacing;
  if (alive <= Math.max(1, Math.floor(maxAlive * DIRECTOR.lowPressureFraction))) return def.interval * DIRECTOR.trickleScale;
  return def.interval;
}

/**
 * Re-clamp the pending spawn timer against the field as it looks *now*.
 *
 * `nextSpawnDelay` is only consulted when a spawn is issued, so the delay is chosen for whatever the
 * field looked like at that instant. A player who then wipes the field would sit out the rest of a
 * delay that was picked for a full map — that is the "I killed everything and nothing came" bug.
 * This runs every tick and only ever *shortens* the wait:
 *   - empty map with enemies still to deploy -> at most `DIRECTOR.emptyFieldGrace`,
 *   - thinned-out map -> the trickle rate, immediately, rather than at the next spawn.
 * Returns `timer` unchanged once the wave has nothing left to deploy.
 */
export function reflowSpawnTimer(timer: number, toSpawn: number, input: DirectorInput): number {
  if (toSpawn <= 0) return timer;
  const want = input.alive <= 0 ? DIRECTOR.emptyFieldGrace : nextSpawnDelay(input);
  return Math.min(timer, want);
}

/** True when the director may spawn right now (timer elapsed, enemies left to spawn, cap not reached). */
export function canSpawn(timer: number, toSpawn: number, alive: number, maxAlive: number): boolean {
  return timer <= 0 && toSpawn > 0 && alive < maxAlive;
}

/**
 * True when the wave has deployed everything it is going to: what the player can see is now exactly
 * what is left. This is the moment the "N REMAINING" counter becomes a promise rather than a guess,
 * and the moment worth telling the player about.
 */
export function deployComplete(toSpawn: number): boolean { return toSpawn <= 0; }

/** Centre-screen callout for the moment the wave's last enemy has been deployed. */
export function lastHostilesText(alive: number): string {
  return alive === 1 ? 'FINAL HOSTILE' : `LAST ${alive} HOSTILES`;
}

/** True when the wave is over: everything spawned and dead, and the wave has run at least the minimum time. */
export function waveComplete(toSpawn: number, alive: number, waveTime: number): boolean {
  return toSpawn <= 0 && alive <= 0 && waveTime >= DIRECTOR.minWaveTime;
}

// ---------------------------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------------------------

/** Linear falloff from 1 at the centre to `edge` at `radius`; 0 beyond. */
export function explosionFalloff(distance: number, radius: number, edge: number): number {
  if (distance >= radius) return 0;
  const t = distance / radius;
  return 1 - t * (1 - edge);
}
