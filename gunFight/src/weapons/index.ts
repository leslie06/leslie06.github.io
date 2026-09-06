import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { LevelApi, PlayerApi } from '../game/Contracts';
import { registerPose } from '../debug/Poses';
import { WeaponSystem } from './WeaponSystem';
import { DEFAULT_LOADOUT } from './WeaponDefs';

/** Entry point for the weapons module. Called from main.ts after level + sky are loaded and the player is initialized. */
export async function install(engine: Engine): Promise<void> {
  const weapons = new WeaponSystem(engine);
  engine.add(weapons);

  const slot = (id: string) => DEFAULT_LOADOUT.indexOf(id);
  const look = (name: string, dYaw = 0, dPitch = 0) => {
    const level = engine.get<LevelApi>('level');
    const player = engine.get<PlayerApi>('player');
    const lm = level?.landmarks?.[name] ?? Object.values(level?.landmarks ?? {})[0];
    const pos = lm?.position ?? level?.spawnPoints?.[0] ?? new THREE.Vector3(0, 1, 20);
    player?.teleport(pos.clone(), (lm?.yaw ?? 0.35) + dYaw, (lm?.pitch ?? -0.04) + dPitch);
  };
  const reset = (id: string, aim = false, dYaw = 0, dPitch = 0) => {
    look('weapons', dYaw, dPitch);
    weapons.debugPose({ sprint: null, tac: null, vmFov: null });
    weapons.equip(slot(id), true);
    weapons.setAim(aim);
  };
  const pose = (name: string, description: string, apply: () => void, animateFrames = 0, settleFrames = 8) =>
    registerPose({ name, description, apply, animateFrames, settleFrames });

  pose('weapon_ar_hip', 'M4A1 hip, idle', () => reset('m4'), 6);
  pose('weapon_ar_ads', 'M4A1 aiming down the red dot (reticle centred)', () => reset('m4', true), 6);
  pose('weapon_ar_fire', 'M4A1 mid-shot: muzzle flash, bolt back, kick', () => { reset('m4'); weapons.debugFire(); }, 2, 2);
  pose('weapon_ar_reload', 'M4A1 mid reload: mag coming out', () => { reset('m4'); weapons.debugReload(); }, 21);
  pose('weapon_smg_hip', 'MP5 hip, idle', () => reset('mp5'), 6);
  pose('weapon_pistol_ads', 'M9 aiming down the irons', () => reset('m9', true), 6);
  pose('weapon_shotgun_fire', 'M870 mid-shot: big flash', () => { reset('m870'); weapons.debugFire(); }, 2, 2);
  // Aimed down the street, not at the wall opposite: a magnified view of a flat facade 30 m away has
  // no depth to show, which is what made the round-3 scope read as "a window into a different, flatter
  // renderer". Down the street the ring carries a truck at 15 m, rubble at 30 m and hazed towers behind.
  pose('weapon_sniper_scope', 'L96 looking through the scope', () => reset('l96', true, -0.052, 0.012), 12);
  pose('weapon_inspect', 'M4A1 inspect animation, mid-way', () => { reset('m4'); weapons.debugPose({ inspect: true }); }, 60);
  pose('weapon_sprint', 'M4A1 tactical sprint', () => { reset('m4'); weapons.debugPose({ sprint: 1, tac: 1 }); }, 6);
  pose('weapon_sprint_normal', 'M4A1 sprint (gun lowered)', () => { reset('m4'); weapons.debugPose({ sprint: 1, tac: 0 }); }, 6);
  pose('weapon_pistol_fire', 'M9 mid-shot: slide back', () => { reset('m9'); weapons.debugFire(); }, 2, 2);
  pose('weapon_smg_reload', 'MP5 mid reload', () => { reset('mp5'); weapons.debugReload(); }, 20);
  pose('weapon_sniper_hip', 'L96 hip', () => reset('l96'), 6);
  pose('weapon_shotgun_hip', 'M870 hip', () => reset('m870'), 6);
}
