/**
 * Cross-module contracts. Subsystems are built by different people in parallel and only
 * talk to each other through these interfaces, `engine.events`, and `engine.get(name)`.
 * Extend these (additively) if you need more; never reach into another module's internals.
 */
import type * as THREE from 'three';
import type { System } from '../core/Engine';
import type { SurfaceType } from '../core/Events';

export type BodyPart = 'head' | 'torso' | 'limb';

/** engine.get<PlayerApi>('player') */
export interface PlayerApi extends System {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  eye: THREE.Vector3;
  yaw: number; pitch: number;
  grounded: boolean; crouching: boolean; sprinting: boolean; sliding: boolean; aiming: boolean;
  health: number; maxHealth: number; alive: boolean;
  /** 0..1, how much movement should be slowed (heavy weapon, wounded) */
  speedFactor: number;
  damage(amount: number, from: THREE.Vector3): void;
  teleport(pos: THREE.Vector3, yaw?: number, pitch?: number): void;
  /** Camera effects layer adds impulses here (recoil kick in radians, view punch). */
  addRecoil?(pitch: number, yaw: number): void;
  addViewPunch?(pitch: number, yaw: number, roll: number): void;
  addShake?(amount: number): void;
}

export interface WeaponState {
  id: string;
  name: string;
  ammoInMag: number;
  magSize: number;
  reserveAmmo: number;
  reloading: boolean;
  aiming: boolean;       // 0..1 blend exposed as aimBlend
  aimBlend: number;
  /** Current spread in radians (HUD crosshair reads this). */
  spread: number;
  firing: boolean;
  kind: 'rifle' | 'smg' | 'pistol' | 'shotgun' | 'sniper' | 'lmg' | 'launcher';
  fireMode: 'auto' | 'semi' | 'burst' | 'bolt' | 'pump';
}

/** engine.get<WeaponsApi>('weapons') */
export interface WeaponsApi extends System {
  current: WeaponState;
  slots: WeaponState[];
  /** Force-fire N shots (shot poses use this to capture muzzle flash). */
  debugFire?(): void;
  debugReload?(): void;
  setAim?(aim: boolean): void;
  equip(index: number): void;
  addAmmo(kind: WeaponState['kind'], amount: number): void;
}

export interface EnemyInfo {
  id: number;
  position: THREE.Vector3;
  health: number;
  alive: boolean;
  /** world-space head position for headshot checks / HUD nameplates */
  head: THREE.Vector3;
  state: string;
}

/** engine.get<EnemiesApi>('enemies') */
export interface EnemiesApi extends System {
  list(): EnemyInfo[];
  /** Called by weapons on a raycast hit whose collider userData carries enemyId/bodyPart. Returns damage dealt (0 if already dead). */
  applyDamage(enemyId: number, amount: number, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, part: BodyPart, weaponId: string): number;
  spawn(position: THREE.Vector3, opts?: { archetype?: string }): number;
  killAll(): void;
  aliveCount(): number;
  /** Radial damage from explosions. */
  applyExplosion(center: THREE.Vector3, radius: number, damage: number): void;
  /** Optional: the game mode pushes the current wave's difficulty scalars here at every wave start. */
  setDifficulty?(d: EnemyDifficulty): void;
}

/** Per-wave difficulty scalars (all 1 = baseline). Set by game/, consumed by enemies/. */
export interface EnemyDifficulty {
  /** Hit-chance / spread scalar for enemy fire. */
  accuracy: number;
  /** Damage-per-hit scalar. */
  damage: number;
  /** Reaction-time scalar (<1 = faster reactions). */
  reaction: number;
  /** How aggressively enemies push toward the player (>1 = more pushing, less cover). */
  aggression: number;
}

export interface NavPoint { position: THREE.Vector3; links: number[]; cover?: { dir: THREE.Vector3; height: 'low' | 'high' } }

/** engine.get<LevelApi>('level') */
export interface LevelApi extends System {
  root: THREE.Group;
  spawnPoints: THREE.Vector3[];
  enemySpawns: THREE.Vector3[];
  /** Waypoint graph for AI navigation. Nodes must be on walkable ground, links must be line-of-walk clear. */
  navPoints: NavPoint[];
  bounds: THREE.Box3;
  /** Points of interest for camera poses / vistas. */
  landmarks: Record<string, { position: THREE.Vector3; yaw: number; pitch: number }>;
  surfaceAt?(point: THREE.Vector3): SurfaceType;
}

/** engine.get<FxApi>('fx') */
export interface FxApi extends System {
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceType, dir: THREE.Vector3): void;
  bloodHit(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, big: boolean): void;
  muzzleFlash(worldPos: THREE.Vector3, dir: THREE.Vector3, scale: number): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3): void;
  shell(worldPos: THREE.Vector3, vel: THREE.Vector3, kind: 'rifle' | 'pistol' | 'shotgun'): void;
  explosion(center: THREE.Vector3, radius: number): void;
  dustPuff(point: THREE.Vector3, amount: number): void;
  decal(point: THREE.Vector3, normal: THREE.Vector3, kind: 'bullet' | 'blood' | 'scorch', size: number): void;
  addLight?(pos: THREE.Vector3, color: THREE.Color, intensity: number, life: number): void;
}

/**
 * engine.get<RenderPostApi>('postfx') - the render module's post chain (render/PostFx).
 * Optional: absent when `quality.postFx` is off, so always null-check the `engine.get`.
 */
export interface RenderPostApi extends System {
  /**
   * 0..1 near-blur on the weapon while aiming. Anything on the viewmodel closer than
   * `focusDistance` metres (default 0.55) defocuses; the world is not touched. Works against
   * whatever FOV / near / far the weapons module puts on `engine.viewmodelCamera` - the pass reads
   * them back every frame. Also feeds `setAim`, so calling this alone is enough to get the ADS
   * chromatic aberration, the peripheral darkening and the background defocus ramp.
   */
  setAimDof(blend: number, focusDistance?: number): void;
  /**
   * 0..1 ADS blend for lens behaviour that is not depth of field: chromatic aberration (0 px in
   * hipfire, `quality.caAds` at the corner when aimed) and `quality.adsVignette` of extra corner
   * darkening. Only needed when it differs from the blend passed to `setAimDof`.
   */
  setAim?(blend: number): void;
  /**
   * Background defocus. Everything nearer than `focus` metres (default `quality.dofFarFocus`, 14 m)
   * stays sharp; the circle of confusion ramps to `maxCoc` pixels (default `quality.dofFarCoc`) over
   * `range` metres past it, and `blend` scales the result. Sky pixels and viewmodel pixels are never
   * touched.
   *
   * By default the far field follows the ADS blend (1x hipfire, 2.2x aimed) with no calls at all.
   * Passing options pins it; calling `setWorldDof()` with no argument hands it back.
   */
  setWorldDof?(opts?: { blend?: number; focus?: number; range?: number; maxCoc?: number }): void;
  /** Additive screen flash, ~0.1 for a rifle muzzle, ~0.6 for a nearby explosion. */
  flash(intensity: number, color?: THREE.Color): void;
  /** 0..1 red edge darkening on player damage; decays on its own. */
  damageVignette(amount: number): void;
  /**
   * Runs the world's aerial perspective + tone map + colour grade over a magnified-optic render
   * target, in place, so a scoped view is hazed and graded like the frame around it. The target must
   * carry a `depthTexture` and `camera` must be the camera it was rendered with. Returns false (and
   * touches nothing) if there is no depth texture.
   */
  postProcessScope?(target: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): boolean;
  /**
   * World-scene depth for soft particles. `texture.r` is window-space depth in [0,1] (no log depth),
   * copied after the world render pass, so it excludes the viewmodel and is one frame old - both of
   * which are what a soft particle wants. Linearise with `z = near*far / (far - d*(far-near))`, then
   * fade the particle by `saturate((z - fragViewZ) / fadeDistance)`.
   * Returns null if the post chain is disabled. Calling it enables the copy pass (it is off until then),
   * so call once at install and keep the result; the texture object stays valid across resizes.
   */
  sceneDepth?(): { texture: THREE.Texture; near: number; far: number; width: number; height: number; latencyFrames: number } | null;
}

/**
 * Aerial-perspective parameters for the current frame. render/ owns them (they come from the sky
 * preset and the time of day); other modules read them so that anything drawn OUTSIDE the main post
 * chain can be hazed to match the frame around it.
 *
 * The primary path for a magnified optic is `RenderPostApi.postProcessScope`, which runs the real
 * chain over the scope target. These numbers are the fallback for when the post chain is disabled
 * (`quality.postFx` off, or no depth texture): weapons/ reproduces the same fog integral itself in
 * `ScopeAtmosphere` so the scope is never the one unhazed region in the frame.
 */
export interface AtmosphereParams {
  /** haze colour (matches the sky just above the horizon) */
  color: THREE.Color;
  /** additional in-scatter towards the sun */
  sunScatter: THREE.Color;
  density: number;
  heightFalloff: number;
  /** world Y at which `density` is measured */
  base: number;
  sunPower: number;
  maxFog: number;
  /** how much distance desaturates and lifts blacks before the fog mix */
  desaturate: number;
  lift: number;
}

/** engine.get<SkyApi>('sky') — read-only view of what render/ publishes about the sky. */
export interface SkyApi extends System {
  state: {
    sunDir: THREE.Vector3;
    fog: AtmosphereParams & { skyHaze: number };
  };
  /** the scene fog object render/ installs, if any */
  fog?: THREE.FogExp2 | null;
}

/** engine.get<AudioApi>('audio') */
export interface AudioApi extends System {
  /** Must be called synchronously inside a user gesture. */
  unlock(): void;
  play(id: string, opts?: { position?: THREE.Vector3; volume?: number; pitch?: number }): void;
  setMasterVolume(v: number): void;
  muted: boolean;
}

/** engine.get<HudApi>('hud') */
export interface HudApi extends System {
  setVisible(v: boolean): void;
  showMessage?(text: string, ms?: number): void;
  /** Named screens: 'menu' | 'pause' | 'dead' | 'none' */
  showScreen?(name: string): void;
}

export type GamePhase = 'menu' | 'wave' | 'breather' | 'dead';

export interface BestRecord { score: number; wave: number; kills: number }

/** engine.get<GameApi>('game') */
export interface GameApi extends System {
  wave: number; kills: number; score: number; running: boolean;
  start(): void;
  restart(): void;
  /** Current kill streak (resets on player damage or after a few seconds without a kill). */
  streak: number;
  /** Personal best, persisted in localStorage. */
  best: BestRecord;
  /** 'menu' before start, 'wave' during combat, 'breather' between waves, 'dead' after player death. */
  phase: GamePhase;
  /** Enemies still to be spawned + alive in the current wave (HUD counter). */
  enemiesRemaining: number;
  /** Seconds left in the between-wave breather (0 during combat). */
  breatherLeft: number;
  /** Frag grenades in hand / max carried. */
  grenades: number; maxGrenades: number;
  /** Short interaction hint for the HUD ('' when nothing is in reach). */
  interactPrompt: string;
  /** Leave the match and return to the menu screen. */
  quit?(): void;
  /** Shot-mode helper: begin wave `n` immediately and spawn its opening burst at once (deterministic). */
  debugSpawnWave?(n: number): void;
}
