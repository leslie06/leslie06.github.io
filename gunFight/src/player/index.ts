import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { LevelApi } from '../game/Contracts';
import { CG, groups } from '../core/Physics';
import { PlayerController, PLAYER } from './PlayerController';
import { registerPose } from '../debug/Poses';

export { PlayerController, PLAYER } from './PlayerController';
export { CameraFx } from './CameraFx';
export type { ViewmodelOffset } from './CameraFx';
export type { PlayerSettings } from './PlayerSettings';

/**
 * What the weapons / ui modules can read off `engine.get('player')` beyond PlayerApi.
 * (Proposed for game/Contracts.ts as an additive extension.)
 */
export interface PlayerFeelApi {
  /** view-space offset the weapon should follow (bob, sway, lag, recoil kick-back) */
  viewmodelOffset: { position: THREE.Vector3; rotation: THREE.Euler };
  moveBlend: number; sprintBlend: number; tacSprintBlend: number; slideBlend: number; crouchBlend: number; airBlend: number; aimBlend: number; mantleBlend: number;
  airborne: boolean; tacSprinting: boolean; mantling: boolean;
  speed: number;
  settings: import('./PlayerSettings').PlayerSettings;
  setAimFov(fov: number, blend: number): void;
  respawn(pos?: THREE.Vector3, yaw?: number, pitch?: number): void;
}

export async function install(engine: Engine): Promise<void> {
  const level = engine.get<LevelApi>('level')!;
  const player = new PlayerController(engine);
  engine.add(player);
  player.init(level.spawnPoints[0]);

  const spawn = () => level.spawnPoints[0].clone();
  /** Yaw that points from `from` at the longest open run of floor (so motion poses do not face a wall). */
  const openYaw = (from: THREE.Vector3): number => {
    let best = 0, bestD = -1;
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * Math.PI * 2;
      const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      const hit = engine.physics.raycast({ x: from.x, y: from.y, z: from.z }, dir, 60, groups(CG.PLAYER, CG.WORLD));
      const d = hit ? hit.distance : 60;
      if (d > bestD) { bestD = d; best = yaw; }
    }
    return best;
  };
  /** Find a waist/chest-high ledge near the spawn and a spot 1.2 m in front of it, facing it. */
  const mantleSpot = (): { pos: THREE.Vector3; yaw: number } | null => {
    const s = spawn();
    const feetY = s.y - PLAYER.centerHeight;
    let best: { pos: THREE.Vector3; yaw: number; d: number } | null = null;
    for (let i = 0; i < 48; i++) {
      const yaw = (i / 48) * Math.PI * 2;
      const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      const wall = engine.physics.raycast({ x: s.x, y: feetY + 0.5, z: s.z }, dir, 40, groups(CG.PLAYER, CG.WORLD));
      if (!wall || Math.abs(wall.normal[1]) > 0.5) continue;
      const px = wall.point[0] + dir.x * 0.35, pz = wall.point[2] + dir.z * 0.35;
      const top = engine.physics.raycast({ x: px, y: feetY + 2.2, z: pz }, { x: 0, y: -1, z: 0 }, 2.2, groups(CG.PLAYER, CG.WORLD));
      if (!top) continue;
      const h = top.point[1] - feetY;
      if (h < 0.6 || h > 1.5) continue;
      const stand = new THREE.Vector3(wall.point[0] - dir.x * 1.6, s.y, wall.point[2] - dir.z * 1.6);
      if (!best || wall.distance < best.d) best = { pos: stand, yaw, d: wall.distance };
    }
    return best;
  };

  registerPose({ name: 'vista', description: 'Spawn vista, hip', apply: () => { const s = spawn(); player.teleport(s, openYaw(s), -0.05); } });

  registerPose({
    name: 'player_sprint', description: 'Mid-sprint bob frame with forward lean and FOV kick',
    apply: () => { const s = spawn(); player.teleport(s, openYaw(s), 0); player.debugInput = { moveY: 1, sprint: true }; },
    animateFrames: 78, settleFrames: 8,
  });
  registerPose({
    name: 'player_slide', description: 'Sprint then crouch-press: slide with camera roll and low eye',
    apply: () => {
      const s = spawn(); player.teleport(s, openYaw(s), -0.04);
      player.debugSequence([{ at: 1, set: { moveY: 1, sprint: true } }, { at: 55, set: { crouchPressed: true, crouch: true } }]);
    },
    animateFrames: 55 + 14, settleFrames: 8,
  });
  registerPose({
    name: 'player_crouch', description: 'Crouched, creeping forward (low eye, tiny bob)',
    apply: () => { const s = spawn(); player.teleport(s, openYaw(s), 0.02); player.debugInput = { moveY: 1, crouch: true }; },
    animateFrames: 60, settleFrames: 8,
  });
  registerPose({
    name: 'player_mantle', description: 'Mid-mantle over waist-high cover (eye rising, dip)',
    apply: () => {
      const spot = mantleSpot();
      if (spot) { player.teleport(spot.pos, spot.yaw, -0.08); player.debugSequence([{ at: 1, set: { moveY: 1, sprint: true } }, { at: 6, set: { jumpPressed: true } }]); }
      else { const s = spawn(); player.teleport(s, openYaw(s), -0.08); player.debugSequence([{ at: 1, set: { moveY: 1, sprint: true } }]); }
    },
    animateFrames: 21, settleFrames: 8,
  });
  registerPose({
    name: 'player_landing', description: 'Camera dip right after a 3 m drop',
    apply: () => { const s = spawn(); s.y += 3; player.teleport(s, openYaw(s), -0.05); },
    animateFrames: 36, settleFrames: 8,
  });
  registerPose({
    name: 'player_dead', description: 'Death camera on the ground, tilted',
    apply: () => { const s = spawn(); player.teleport(s, openYaw(s), 0); player.respawn(s); player.damage(1000, s.clone().add(new THREE.Vector3(1, 0, -3))); },
    animateFrames: 70, settleFrames: 8,
  });
}
