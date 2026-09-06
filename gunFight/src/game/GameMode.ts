import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { AudioApi, BestRecord, EnemiesApi, GameApi, GamePhase, HudApi, LevelApi, PlayerApi, WeaponsApi } from './Contracts';
import { DIRECTOR, PICKUPS } from './GameDefs';
import {
  advanceStreak, canSpawn, chooseSpawn, effectiveMaxAlive, expireStreak, fallbackSpawns, killScore, mergeBest, nextSpawnDelay,
  pickArchetype, waveClearBonus, waveComplete, waveDef, type StreakState, type Vec3,
} from './GameLogic';
import type { WaveDef } from './GameDefs';

const BEST_KEY = 'gunfight.best.v1';
const SPAWN_SEED = 0x5eed;

/** Something that can be refilled every wave (the grenade system). */
export interface Resuppliable { resupply(): void; clear(): void }

/**
 * Survival ("Spec Ops"-style) mode: wave state machine, spawn director, scoring/streaks,
 * persistence, and the death/restart loop. Every dependency is optional so the mode never throws
 * while other modules are still stubs.
 */
export class GameMode implements GameApi {
  name = 'game';
  wave = 0; kills = 0; score = 0; running = false; streak = 0;
  best: BestRecord = { score: 0, wave: 0, kills: 0 };
  phase: GamePhase = 'menu';
  enemiesRemaining = 0;
  breatherLeft = 0;
  grenades = 0; maxGrenades = 0;
  interactPrompt = '';
  /** Systems refilled on every wave start / breather (grenades). */
  resuppliables: Resuppliable[] = [];
  /** Where the public `grenades` count is read from each tick. */
  grenadeSource: { count: number } | null = null;

  private def: WaveDef = waveDef(1);
  private toSpawn = 0; private spawned = 0; private spawnTimer = 0; private waveTime = 0;
  /** Score/kills at the start of the current wave; a wave restart rewinds to this checkpoint. */
  private waveStartScore = 0; private waveStartKills = 0;
  /** Shot mode: after debugSpawnWave the director stops so other poses stay deterministic. */
  private directorFrozen = false;
  /** Died between waves (self-frag): restart moves on to the next wave instead of replaying a cleared one. */
  private diedInBreather = false;
  private incomingWarned = false;
  private recentSpawns: number[] = [];
  private rng = new Rng(SPAWN_SEED);
  private streakState: StreakState = { streak: 0, lastKillTime: -1e9 };
  private clock = 0;
  /** enemyId -> weaponId of the last thing that hit it (for game:kill). */
  private lastHitter = new Map<number, string>();
  /** hit:enemy -> ui:hitmarker bridge: pending hits, flushed next tick unless someone else emitted a hitmarker. */
  private pendingHitmarkers: { headshot: boolean; kill: boolean }[] = [];
  private externalHitmarkers = 0;
  private selfEmittingHitmarker = false;
  private wasLocked = false;
  private readonly shotMode: boolean;
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3();

  constructor(private engine: Engine) {
    this.shotMode = new URLSearchParams(location.search).has('shot');
    this.best = this.loadBest();
    const ev = engine.events;
    ev.on('enemy:death', (e) => this.onEnemyDeath(e.enemyId, e.headshot));
    ev.on('hit:enemy', (e) => {
      this.lastHitter.set(e.enemyId, this.weapons?.current?.id ?? 'unknown');
      this.pendingHitmarkers.push({ headshot: e.headshot, kill: e.killed });
    });
    ev.on('ui:hitmarker', () => { if (!this.selfEmittingHitmarker) this.externalHitmarkers++; });
    ev.on('player:damage', () => { this.streak = 0; this.streakState = { streak: 0, lastKillTime: this.streakState.lastKillTime }; });
    ev.on('player:death', () => this.onPlayerDeath());
  }

  // --- module lookups (all optional at runtime) -------------------------------------------------
  private get player(): PlayerApi | undefined { return this.engine.get<PlayerApi>('player'); }
  private get enemies(): EnemiesApi | undefined { return this.engine.get<EnemiesApi>('enemies'); }
  private get level(): LevelApi | undefined { return this.engine.get<LevelApi>('level'); }
  private get weapons(): WeaponsApi | undefined { return this.engine.get<WeaponsApi>('weapons'); }
  private get hud(): HudApi | undefined { return this.engine.get<HudApi>('hud'); }
  private get audio(): AudioApi | undefined { return this.engine.get<AudioApi>('audio'); }

  /** Called once after install: shows the menu (not in shot mode, where poses drive everything). */
  boot(): void {
    if (this.shotMode) return;
    this.safe(() => this.hud?.showScreen?.('menu'));
  }

  // --- public API ------------------------------------------------------------------------------
  start(): void {
    if (this.running) return;
    this.resetRun();
    this.running = true;
    this.safe(() => this.hud?.showScreen?.('none'));
    this.engine.events.emit('game:start', {});
    this.safe(() => this.audio?.play('game_start'));
    this.beginWave(1);
  }

  /** After death: respawn with full health/ammo and replay the current wave (CoD-style). From the menu, same as start(). */
  restart(): void {
    if (this.phase === 'menu' || this.wave < 1) { this.start(); return; }
    this.clearField();
    const next = this.diedInBreather ? this.wave + 1 : this.wave;
    if (!this.diedInBreather) { this.score = this.waveStartScore; this.kills = this.waveStartKills; }
    this.diedInBreather = false;
    this.respawnPlayer();
    this.streak = 0; this.streakState = { streak: 0, lastKillTime: -1e9 };
    this.running = true;
    this.safe(() => this.hud?.showScreen?.('none'));
    this.engine.events.emit('game:start', {});
    this.beginWave(next);
  }

  quit(): void {
    this.clearField();
    this.running = false; this.phase = 'menu';
    this.enemiesRemaining = 0; this.breatherLeft = 0;
    this.persistBest();
    this.safe(() => this.hud?.showScreen?.('menu'));
  }

  /** Shot-mode helper: begin wave n right now and spawn its opening burst at once, deterministically. */
  debugSpawnWave(n: number): void {
    if (!this.running) { this.resetRun(); this.running = true; }
    this.clearField();
    this.rng = new Rng(SPAWN_SEED + n);
    this.beginWave(n, true);
    const cap = effectiveMaxAlive(this.def, this.engine.quality.maxEnemies);
    const burst = Math.min(this.def.burst, cap, this.toSpawn);
    for (let i = 0; i < burst; i++) this.spawnOne();
    this.spawnTimer = nextSpawnDelay({ def: this.def, spawned: this.spawned, alive: this.aliveCount(), maxAlive: cap });
    this.directorFrozen = this.shotMode;
  }

  // --- tick ------------------------------------------------------------------------------------
  fixedUpdate(dt: number): void {
    this.clock += dt;
    this.flushHitmarkers();
    this.pointerLockFallback();
    this.grenades = this.grenadeSource?.count ?? 0;
    if (!this.running) return;

    const expired = expireStreak(this.streakState, this.clock);
    if (expired !== this.streakState) { this.streakState = expired; this.streak = 0; }

    if (this.directorFrozen) return;
    if (this.phase === 'wave') {
      this.waveTime += dt;
      const alive = this.aliveCount();
      const cap = effectiveMaxAlive(this.def, this.engine.quality.maxEnemies);
      this.spawnTimer -= dt;
      if (canSpawn(this.spawnTimer, this.toSpawn, alive, cap)) {
        this.spawnOne();
        this.spawnTimer = nextSpawnDelay({ def: this.def, spawned: this.spawned, alive: alive + 1, maxAlive: cap });
      }
      this.enemiesRemaining = this.toSpawn + this.aliveCount();
      if (waveComplete(this.toSpawn, this.aliveCount(), this.waveTime)) this.completeWave();
    } else if (this.phase === 'breather') {
      this.breatherLeft = Math.max(0, this.breatherLeft - dt);
      if (!this.incomingWarned && this.breatherLeft <= DIRECTOR.incomingWarning) {
        this.incomingWarned = true;
        this.safe(() => this.hud?.showMessage?.(`WAVE ${this.wave + 1} INCOMING`, DIRECTOR.incomingWarning * 1000));
        this.safe(() => this.audio?.play('wave_incoming'));
      }
      if (this.breatherLeft <= 0) this.beginWave(this.wave + 1);
    }
  }

  // --- wave flow -------------------------------------------------------------------------------
  private resetRun(): void {
    this.clearField();
    this.wave = 0; this.kills = 0; this.score = 0; this.streak = 0;
    this.streakState = { streak: 0, lastKillTime: -1e9 };
    this.recentSpawns.length = 0;
    this.rng = new Rng(SPAWN_SEED);
    this.lastHitter.clear();
    this.respawnPlayer();
  }

  private beginWave(n: number, silent = false): void {
    this.wave = n;
    this.def = waveDef(n);
    this.directorFrozen = false;
    this.waveStartScore = this.score; this.waveStartKills = this.kills;
    this.toSpawn = this.def.count; this.spawned = 0; this.spawnTimer = 0; this.waveTime = 0;
    this.phase = 'wave'; this.breatherLeft = 0; this.incomingWarned = false;
    this.enemiesRemaining = this.def.count;
    this.safe(() => this.enemies?.setDifficulty?.(this.def.difficulty));
    for (const r of this.resuppliables) this.safe(() => r.resupply());
    this.engine.events.emit('game:wave', { wave: n });
    if (!silent) {
      this.safe(() => this.hud?.showMessage?.(`WAVE ${n}`, 2500));
      this.safe(() => this.audio?.play('wave_start'));
    }
  }

  private completeWave(): void {
    this.score += waveClearBonus(this.wave);
    this.phase = 'breather';
    this.breatherLeft = DIRECTOR.breather; this.incomingWarned = false;
    this.enemiesRemaining = 0;
    this.resupplyAmmo(PICKUPS.breatherMagsPerSlot);
    for (const r of this.resuppliables) this.safe(() => r.resupply());
    this.persistBest();
    this.safe(() => this.hud?.showMessage?.(`WAVE ${this.wave} COMPLETE`, 3000));
    this.safe(() => this.audio?.play('wave_complete'));
  }

  private onEnemyDeath(enemyId: number, headshot: boolean): void {
    if (!this.running || this.phase !== 'wave') return;
    this.kills++;
    this.streakState = advanceStreak(this.streakState, this.clock);
    this.streak = this.streakState.streak;
    this.score += killScore(this.streak, headshot);
    const weaponId = this.lastHitter.get(enemyId) ?? this.weapons?.current?.id ?? 'unknown';
    this.lastHitter.delete(enemyId);
    this.engine.events.emit('game:kill', { streak: this.streak, headshot, weaponId });
    if (this.score > this.best.score) this.best.score = this.score;
    if (this.kills > this.best.kills) this.best.kills = this.kills;
  }

  private onPlayerDeath(): void {
    if (!this.running) return;
    this.diedInBreather = this.phase === 'breather';
    this.running = false; this.phase = 'dead';
    this.streak = 0;
    this.persistBest();
    this.engine.events.emit('game:over', { kills: this.kills, wave: this.wave });
    this.safe(() => this.hud?.showScreen?.('dead'));
    this.safe(() => this.audio?.play('game_over'));
  }

  // --- spawning --------------------------------------------------------------------------------
  private aliveCount(): number {
    try { return this.enemies?.aliveCount?.() ?? 0; } catch { return 0; }
  }

  private spawnPoints(): Vec3[] {
    const lv = this.level;
    const pts = lv?.enemySpawns;
    if (pts && pts.length > 0) return pts;
    const p = this.player?.position ?? { x: 0, y: 1, z: 0 };
    const b = lv?.bounds ?? new THREE.Box3(new THREE.Vector3(-40, -5, -40), new THREE.Vector3(40, 40, 40));
    return fallbackSpawns(p, { min: b.min, max: b.max });
  }

  /** True when the player has clear line of sight from their eye to the spawn point (chest height). */
  private visibleFromPlayer(p: Vec3): boolean {
    const pl = this.player;
    const phys = this.engine.physics;
    if (!pl || !phys.world) return false;
    const eye = pl.eye.lengthSq() > 0 ? pl.eye : this.tmpB.copy(pl.position).add(new THREE.Vector3(0, 0.8, 0));
    const target = this.tmpA.set(p.x, p.y + 1.0, p.z);
    const dir = target.clone().sub(eye);
    const dist = dir.length();
    if (dist < 1e-3) return true;
    dir.divideScalar(dist);
    try {
      const hit = phys.raycast(eye, dir, dist, groups(CG.ALL, CG.WORLD), true);
      return !hit || hit.distance >= dist - 0.5;
    } catch { return false; }
  }

  private spawnOne(): void {
    const pl = this.player;
    const spawns = this.spawnPoints();
    const playerPos: Vec3 = pl?.position ?? { x: 0, y: 1, z: 0 };
    const yaw = pl?.yaw ?? 0;
    const idx = chooseSpawn({
      spawns, playerPos, playerForward: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
      visible: (p) => this.visibleFromPlayer(p), recent: this.recentSpawns, rng: this.rng,
    });
    this.toSpawn--; this.spawned++;
    if (idx < 0) return;
    this.recentSpawns.unshift(idx); if (this.recentSpawns.length > 6) this.recentSpawns.length = 6;
    const p = spawns[idx];
    const archetype = pickArchetype(this.def.mix, this.rng);
    this.safe(() => this.enemies?.spawn(new THREE.Vector3(p.x, p.y, p.z), { archetype }));
  }

  private clearField(): void {
    this.safe(() => this.enemies?.killAll());
    for (const r of this.resuppliables) this.safe(() => r.clear());
    this.lastHitter.clear();
  }

  // --- player ----------------------------------------------------------------------------------
  private respawnPlayer(): void {
    const pl = this.player; if (!pl) return;
    const lv = this.level;
    const spawn = lv?.spawnPoints?.[0] ?? pl.position.clone();
    const lm = lv?.landmarks?.['spawn'] ?? lv?.landmarks?.['street'] ?? lv?.landmarks?.['main_street'];
    this.safe(() => {
      // Prefer the controller's own respawn (resets death-cam/regen state); fall back to the contract surface.
      const withRespawn = pl as PlayerApi & { respawn?(pos: THREE.Vector3, yaw?: number, pitch?: number): void };
      if (typeof withRespawn.respawn === 'function') { withRespawn.respawn(spawn.clone(), lm?.yaw ?? 0, 0); return; }
      pl.health = pl.maxHealth; pl.alive = true;
      pl.teleport(spawn.clone(), lm?.yaw ?? 0, 0);
    });
    this.resupplyAmmo(PICKUPS.breatherMagsPerSlot);
  }

  private resupplyAmmo(mags: number): void {
    const w = this.weapons; if (!w) return;
    this.safe(() => {
      const slots = w.slots?.length ? w.slots : (w.current ? [w.current] : []);
      for (const s of slots) if (s) w.addAmmo(s.kind, Math.max(1, (s.magSize || 30) * mags));
    });
  }

  /** If no UI ever calls start() (stub HUD), locking the pointer from the menu starts the match. */
  private pointerLockFallback(): void {
    const locked = this.engine.input.locked;
    if (locked && !this.wasLocked && this.phase === 'menu' && !this.shotMode) this.start();
    this.wasLocked = locked;
  }

  // --- events ----------------------------------------------------------------------------------
  private flushHitmarkers(): void {
    if (this.pendingHitmarkers.length === 0) return;
    const list = this.pendingHitmarkers; this.pendingHitmarkers = [];
    if (this.externalHitmarkers > 0) { this.externalHitmarkers = 0; return; } // weapons/ui already emit it
    this.selfEmittingHitmarker = true;
    for (const h of list) this.engine.events.emit('ui:hitmarker', h);
    this.selfEmittingHitmarker = false;
  }

  // --- persistence -----------------------------------------------------------------------------
  private loadBest(): BestRecord {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw) { const b = JSON.parse(raw); return { score: +b.score || 0, wave: +b.wave || 0, kills: +b.kills || 0 }; }
    } catch { /* private mode / disabled storage */ }
    return { score: 0, wave: 0, kills: 0 };
  }

  /** Best wave counts waves *cleared*: the current wave only once its breather has started. */
  private persistBest(): void {
    const cleared = this.phase === 'breather' ? this.wave : Math.max(0, this.wave - 1);
    this.best = mergeBest(this.best, { score: this.score, wave: cleared, kills: this.kills });
    try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)); } catch { /* ignore */ }
  }

  private safe(fn: () => void): void {
    try { fn(); } catch (e) { console.error('[game]', e); }
  }
}

