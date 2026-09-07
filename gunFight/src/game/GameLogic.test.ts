import { describe, expect, it } from 'vitest';
import {
  advanceStreak, canSpawn, chooseSpawn, deployComplete, effectiveMaxAlive, enemyCount, expireStreak, explosionFalloff,
  fallbackSpawns, killScore, lastHostilesText, mergeBest, nextSpawnDelay, pickArchetype, reflowSpawnTimer, spawnScore,
  streakMultiplier, waveClearBonus, waveComplete, waveDef,
} from './GameLogic';
import { DIRECTOR, SCORING, WAVE_EXTRAPOLATION, WAVE_TABLE } from './GameDefs';

const fixedRng = (v = 0.5) => ({ next: () => v });
const seq = (vals: number[]) => { let i = 0; return { next: () => vals[i++ % vals.length] }; };

describe('wave table', () => {
  it('returns table rows for tabulated waves and clamps below 1', () => {
    expect(waveDef(1)).toBe(WAVE_TABLE[0]);
    expect(waveDef(0)).toBe(WAVE_TABLE[0]);
    expect(waveDef(WAVE_TABLE.length)).toBe(WAVE_TABLE[WAVE_TABLE.length - 1]);
  });
  it('enemy count is non-decreasing and bounded', () => {
    let prev = 0;
    for (let w = 1; w <= 60; w++) { const c = enemyCount(w); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
    expect(enemyCount(200)).toBe(WAVE_EXTRAPOLATION.countMax);
  });
  it('extrapolates past the table with tightening pacing and capped difficulty', () => {
    const last = WAVE_TABLE[WAVE_TABLE.length - 1];
    const d = waveDef(last.wave + 3);
    expect(d.wave).toBe(last.wave + 3);
    expect(d.count).toBe(last.count + 3 * WAVE_EXTRAPOLATION.countPerWave);
    expect(d.interval).toBeLessThan(last.interval);
    expect(d.difficulty.accuracy).toBeGreaterThan(last.difficulty.accuracy);
    expect(d.difficulty.reaction).toBeLessThan(last.difficulty.reaction);
    const far = waveDef(500);
    expect(far.difficulty.accuracy).toBe(WAVE_EXTRAPOLATION.accuracyMax);
    expect(far.interval).toBe(WAVE_EXTRAPOLATION.intervalMin);
    expect(far.maxAlive).toBe(WAVE_EXTRAPOLATION.maxAliveMax);
  });
  it('every table row has a positive count, burst <= count and a non-empty mix', () => {
    for (const r of WAVE_TABLE) {
      expect(r.count).toBeGreaterThan(0);
      expect(r.burst).toBeLessThanOrEqual(r.count);
      expect(Object.keys(r.mix).length).toBeGreaterThan(0);
    }
  });
  it('the opening burst fills the field, so a wave opens as a wave rather than a trickle', () => {
    for (const r of WAVE_TABLE) expect(r.burst).toBe(r.maxAlive);
    // and past the table the two stay in step rather than drifting apart
    for (let w = WAVE_TABLE.length + 1; w <= 40; w++) {
      const d = waveDef(w);
      expect(d.burst).toBeLessThanOrEqual(d.maxAlive);
      expect(d.burst).toBeGreaterThanOrEqual(d.maxAlive - 1);
    }
  });
  it('pacing tightens monotonically: interval never grows, concurrency never shrinks', () => {
    let interval = Infinity, maxAlive = 0;
    for (let w = 1; w <= 40; w++) {
      const d = waveDef(w);
      expect(d.interval).toBeLessThanOrEqual(interval);
      expect(d.maxAlive).toBeGreaterThanOrEqual(maxAlive);
      interval = d.interval; maxAlive = d.maxAlive;
    }
  });
  it('a wave deploys in a time the player will not read as an empty street', () => {
    // Worst case: the field stays full, so every backfill waits the nominal interval.
    for (let w = 1; w <= 10; w++) {
      const d = waveDef(w);
      const deploy = (d.burst - 1) * DIRECTOR.burstSpacing + (d.count - d.burst) * d.interval;
      expect(deploy / d.count).toBeLessThan(1.2); // seconds of deployment per enemy
    }
  });
  it('picks archetypes by weight deterministically', () => {
    const mix = { a: 1, b: 3 };
    expect(pickArchetype(mix, fixedRng(0.1))).toBe('a');
    expect(pickArchetype(mix, fixedRng(0.9))).toBe('b');
    expect(pickArchetype({}, fixedRng())).toBe('grunt');
    expect(pickArchetype({ a: 0, b: 2 }, fixedRng(0.99))).toBe('b');
  });
});

describe('scoring', () => {
  it('streak multiplier follows the tiers', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.5);
    expect(streakMultiplier(5)).toBe(2);
    expect(streakMultiplier(9)).toBe(2);
    expect(streakMultiplier(10)).toBe(3);
    expect(streakMultiplier(99)).toBe(3);
  });
  it('kill score = base (+ headshot) * multiplier', () => {
    expect(killScore(1, false)).toBe(SCORING.kill);
    expect(killScore(1, true)).toBe(SCORING.kill + SCORING.headshotBonus);
    expect(killScore(3, true)).toBe(Math.round((SCORING.kill + SCORING.headshotBonus) * 1.5));
    expect(killScore(10, false)).toBe(SCORING.kill * 3);
  });
  it('wave clear bonus scales with wave', () => {
    expect(waveClearBonus(1)).toBe(SCORING.waveClearBase);
    expect(waveClearBonus(4)).toBe(SCORING.waveClearBase * 4);
    expect(waveClearBonus(0)).toBe(SCORING.waveClearBase);
  });
  it('streak continues within the window and restarts after it', () => {
    let s = { streak: 0, lastKillTime: -100 };
    s = advanceStreak(s, 10); expect(s.streak).toBe(1);
    s = advanceStreak(s, 12); expect(s.streak).toBe(2);
    s = advanceStreak(s, 12 + SCORING.streakWindow); expect(s.streak).toBe(3);
    s = advanceStreak(s, 12 + SCORING.streakWindow * 3); expect(s.streak).toBe(1);
  });
  it('streak expires after the window with no kill', () => {
    const s = advanceStreak({ streak: 0, lastKillTime: 0 }, 5);
    expect(expireStreak(s, 5 + SCORING.streakWindow).streak).toBe(1);
    expect(expireStreak(s, 5 + SCORING.streakWindow + 0.01).streak).toBe(0);
  });
  it('best record merges as per-field max', () => {
    expect(mergeBest({ score: 500, wave: 3, kills: 10 }, { score: 200, wave: 5, kills: 12 })).toEqual({ score: 500, wave: 5, kills: 12 });
  });
});

describe('spawn selection', () => {
  const player = { x: 0, y: 1, z: 20 };
  const fwd = { x: 0, y: 0, z: -1 };
  const base = { playerPos: player, playerForward: fwd, recent: [] as number[], visible: () => false };

  it('penalises points that are too close', () => {
    const near = spawnScore({ x: 0, y: 1, z: 16 }, 0, base);
    const far = spawnScore({ x: 0, y: 1, z: -5 }, 1, base);
    expect(far).toBeGreaterThan(near);
  });
  it('prefers points out of sight and out of the view cone', () => {
    const ahead = { x: 0, y: 1, z: -5 };
    const behind = { x: 0, y: 1, z: 45 };
    expect(spawnScore(behind, 1, base)).toBeGreaterThan(spawnScore(ahead, 0, base));
    const hidden = spawnScore(ahead, 0, base);
    const seen = spawnScore(ahead, 0, { ...base, visible: () => true });
    expect(hidden).toBeGreaterThan(seen);
  });
  it('urgency prefers points a reinforcement can reach quickly, but still refuses visible ones', () => {
    const near = { x: 0, y: 1, z: 2 };   // 18 m behind the player
    const far = { x: 0, y: 1, z: 72 };   // 52 m behind the player
    // Without urgency the far point is at least competitive; with it, near wins outright.
    expect(spawnScore(near, 0, { ...base, urgency: 1 })).toBeGreaterThan(spawnScore(far, 1, { ...base, urgency: 1 }));
    expect(spawnScore(near, 0, { ...base, urgency: 1 })).toBeGreaterThan(spawnScore(near, 0, { ...base, urgency: 1, visible: () => true }));
    // Urgency only ever subtracts, and never touches points inside the ideal band.
    expect(spawnScore(far, 1, { ...base, urgency: 1 })).toBeLessThan(spawnScore(far, 1, base));
    const inBand = { x: 0, y: 1, z: -2 }; // 22 m, inside idealMin..idealMax
    expect(spawnScore(inBand, 2, { ...base, urgency: 1 })).toBeLessThanOrEqual(spawnScore(inBand, 2, base));
  });
  it('avoids recently used points', () => {
    const p = { x: 0, y: 1, z: -5 };
    expect(spawnScore(p, 0, { ...base, recent: [0] })).toBeLessThan(spawnScore(p, 0, base));
    expect(spawnScore(p, 0, { ...base, recent: [3, 0] })).toBeGreaterThan(spawnScore(p, 0, { ...base, recent: [0] }));
  });
  it('chooseSpawn returns the best index and never -1 for non-empty input', () => {
    const spawns = [{ x: 0, y: 1, z: 16 }, { x: 0, y: 1, z: -5 }, { x: 0, y: 1, z: 45 }];
    expect(chooseSpawn({ ...base, spawns, rng: fixedRng(0) })).toBe(2);
    expect(chooseSpawn({ ...base, spawns, rng: fixedRng(0), visible: (_, i) => i === 2 })).toBe(1);
    expect(chooseSpawn({ ...base, spawns: [spawns[0]], rng: fixedRng(0) })).toBe(0);
    expect(chooseSpawn({ ...base, spawns: [], rng: fixedRng(0) })).toBe(-1);
  });
  it('jitter alternates between equal candidates', () => {
    const spawns = [{ x: -25, y: 1, z: 0 }, { x: 25, y: 1, z: 0 }];
    const a = chooseSpawn({ ...base, spawns, rng: seq([0.9, 0.1]) });
    const b = chooseSpawn({ ...base, spawns, rng: seq([0.1, 0.9]) });
    expect(a).not.toBe(b);
  });
  it('fallback ring stays inside bounds', () => {
    const b = { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 5, z: 10 } };
    const ring = fallbackSpawns({ x: 0, y: 1, z: 0 }, b);
    expect(ring.length).toBeGreaterThan(0);
    for (const p of ring) { expect(p.x).toBeGreaterThanOrEqual(-8); expect(p.x).toBeLessThanOrEqual(8); expect(p.z).toBeGreaterThanOrEqual(-8); expect(p.z).toBeLessThanOrEqual(8); }
  });
});

describe('spawn director', () => {
  const def = waveDef(3);
  it('effective cap respects the quality budget and is at least 1', () => {
    expect(effectiveMaxAlive(def, 100)).toBe(def.maxAlive);
    expect(effectiveMaxAlive(def, 2)).toBe(2);
    expect(effectiveMaxAlive(def, 0)).toBe(1);
  });
  it('bursts at wave start, trickles when the field is thin, else nominal interval', () => {
    const maxAlive = def.maxAlive;
    expect(nextSpawnDelay({ def, spawned: 0, alive: 0, maxAlive })).toBe(DIRECTOR.burstSpacing);
    expect(nextSpawnDelay({ def, spawned: def.burst, alive: maxAlive, maxAlive })).toBe(def.interval);
    expect(nextSpawnDelay({ def, spawned: def.burst, alive: 1, maxAlive })).toBeCloseTo(def.interval * DIRECTOR.trickleScale);
  });
  it('canSpawn gates on timer, remaining count and alive cap', () => {
    expect(canSpawn(0, 3, 1, 4)).toBe(true);
    expect(canSpawn(0.1, 3, 1, 4)).toBe(false);
    expect(canSpawn(0, 0, 1, 4)).toBe(false);
    expect(canSpawn(0, 3, 4, 4)).toBe(false);
  });
  it('never buys silence: an empty field pulls the next spawn in to the grace period', () => {
    const maxAlive = def.maxAlive;
    const full = { def, spawned: def.burst, alive: maxAlive, maxAlive };
    // Timer was set for a full field (the nominal interval); the player then wipes the map.
    expect(reflowSpawnTimer(def.interval, 5, { ...full, alive: 0 })).toBe(DIRECTOR.emptyFieldGrace);
    // A thinned-out field gets the trickle rate immediately instead of at the next spawn.
    expect(reflowSpawnTimer(def.interval, 5, { ...full, alive: 1 })).toBeCloseTo(def.interval * DIRECTOR.trickleScale);
    // It only ever shortens the wait, never extends it.
    expect(reflowSpawnTimer(0.05, 5, { ...full, alive: 0 })).toBe(0.05);
    expect(reflowSpawnTimer(0.05, 5, full)).toBe(0.05);
    // Nothing left to deploy: the timer is irrelevant and is left alone.
    expect(reflowSpawnTimer(def.interval, 0, { ...full, alive: 0 })).toBe(def.interval);
  });
  it('an empty field can never outlast the grace period while the wave still owes enemies', () => {
    // Drive the real loop: worst case is the timer having just been set for a full field.
    for (let w = 1; w <= 12; w++) {
      const d = waveDef(w);
      const maxAlive = d.maxAlive;
      let timer = d.interval, empty = 0;
      const dt = 1 / 60;
      for (let i = 0; i < 600; i++) {
        empty += dt;
        timer -= dt;
        timer = reflowSpawnTimer(timer, 5, { def: d, spawned: d.burst, alive: 0, maxAlive });
        if (canSpawn(timer, 5, 0, maxAlive)) break;
      }
      // grace, plus the tick the field emptied on, plus float slack on the countdown
      expect(empty).toBeLessThanOrEqual(DIRECTOR.emptyFieldGrace + 2 * dt);
    }
  });
  it('reports when a wave has stopped deploying, and names what is left', () => {
    expect(deployComplete(3)).toBe(false);
    expect(deployComplete(0)).toBe(true);
    expect(lastHostilesText(1)).toBe('FINAL HOSTILE');
    expect(lastHostilesText(4)).toBe('LAST 4 HOSTILES');
  });
  it('wave completes only when everything is spawned and dead after the minimum time', () => {
    expect(waveComplete(0, 0, DIRECTOR.minWaveTime)).toBe(true);
    expect(waveComplete(1, 0, 10)).toBe(false);
    expect(waveComplete(0, 2, 10)).toBe(false);
    expect(waveComplete(0, 0, 0)).toBe(false);
  });
});

describe('explosion falloff', () => {
  it('is 1 at centre, edge fraction at the radius, 0 beyond', () => {
    expect(explosionFalloff(0, 6, 0.2)).toBe(1);
    expect(explosionFalloff(3, 6, 0.2)).toBeCloseTo(0.6);
    expect(explosionFalloff(6, 6, 0.2)).toBe(0);
    expect(explosionFalloff(9, 6, 0.2)).toBe(0);
  });
});
