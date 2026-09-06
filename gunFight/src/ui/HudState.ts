/**
 * Snapshot of everything the HUD reads each frame, gathered once by Hud from the other modules
 * (all optional — they may not exist yet) so components never touch engine.get themselves.
 * Poses can override any field to fake a state without depending on other modules.
 */
import type { WeaponState, EnemyInfo, LevelApi } from '../game/Contracts';

export interface HudPlayer {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  health: number; maxHealth: number; alive: boolean;
  sprinting: boolean; aiming: boolean;
}

export interface HudGame {
  wave: number; kills: number; score: number; running: boolean;
  /** Frag grenades in hand — drives the equipment slot next to the ammo cluster. Undefined hides it. */
  grenades?: number;
  /** Enemies left in the wave; falls back to the live alive-count when the game module is absent. */
  remaining?: number;
  /** GameApi.interactPrompt verbatim ("[E] RESUPPLY", '' when nothing is in reach). */
  interact?: string;
}

export interface HudEnemy { id: number; x: number; z: number; alive: boolean }

export interface HudState {
  /** engine.time (seconds, frozen in shot mode) */
  t: number;
  dt: number;
  weapon?: WeaponState;
  slots?: WeaponState[];
  player?: HudPlayer;
  game?: HudGame;
  enemies: HudEnemy[];
  level?: LevelApi;
  /** Compass heading in degrees, 0 = north (-Z), clockwise. */
  heading: number;
  fovRad: number;
  /** Canvas height in CSS px (cached on resize). */
  heightPx: number;
}

export type HudOverride = Partial<Omit<HudState, 'enemies'>> & { enemies?: HudEnemy[]; fakeMap?: boolean };

export function enemyToHud(e: EnemyInfo): HudEnemy { return { id: e.id, x: e.position.x, z: e.position.z, alive: e.alive }; }

const RAD2DEG = 180 / Math.PI;

/** three.js yaw (rotation about +Y, 0 faces -Z) -> compass heading in degrees. */
export function yawToHeading(yaw: number): number {
  const h = (-yaw * RAD2DEG) % 360;
  return h < 0 ? h + 360 : h;
}

/** Compass bearing from (px,pz) to (x,z), degrees clockwise from north (-Z). */
export function bearingTo(px: number, pz: number, x: number, z: number): number {
  const b = Math.atan2(x - px, -(z - pz)) * RAD2DEG;
  return b < 0 ? b + 360 : b;
}

/** Wrap a degree delta to -180..180. */
export function wrapDeg(d: number): number {
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return d;
}
