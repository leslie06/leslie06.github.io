import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { registerPose } from '../debug/Poses';
import { CG, groups } from '../core/Physics';
import type { LevelApi, PlayerApi } from './Contracts';
import { GameMode } from './GameMode';
import { Grenades } from './Grenades';
import { Pickups } from './Pickups';

/**
 * Game module: survival mode (waves, spawn director, scoring), frag grenades and ammo crates.
 * Installed last, so every other module is either present or a stub; everything is guarded.
 */
export async function install(engine: Engine): Promise<void> {
  const game = new GameMode(engine);
  const grenades = new Grenades(engine);
  const pickups = new Pickups(engine);

  grenades.canThrow = () => game.running;
  game.resuppliables.push(grenades);
  game.maxGrenades = grenades.max;
  pickups.onPrompt = (t) => { game.interactPrompt = t; };

  // Order: grenades/pickups tick before the mode so counts read by the HUD are fresh this frame.
  engine.add(grenades);
  engine.add(pickups);
  engine.add(game);
  try { pickups.build(); } catch (e) { console.error('[game] pickups failed to build', e); }

  game.grenadeSource = grenades;
  game.grenades = grenades.count;

  game.boot();

  const facingStreet = (player: PlayerApi, level: LevelApi | undefined) => {
    const lm = level?.landmarks?.['street'] ?? level?.landmarks?.['main_street'] ?? level?.landmarks?.['spawn'];
    const spawn = level?.spawnPoints?.[0] ?? player.position.clone();
    player.teleport(spawn.clone(), lm?.yaw ?? 0, lm?.pitch ?? -0.03);
  };

  registerPose({
    name: 'game_wave_start',
    description: 'Wave 1 just started: player at spawn facing the main street, opening burst of enemies closing in',
    apply: (e) => {
      const player = e.get<PlayerApi>('player'); const level = e.get<LevelApi>('level');
      if (player) facingStreet(player, level);
      e.tick(1 / 60); // settle the eye first so spawn line-of-sight checks don't depend on the previous pose
      game.debugSpawnWave(1);
    },
    animateFrames: 120,
    settleFrames: 24,
  });

  registerPose({
    name: 'game_resupply',
    description: 'Ammo resupply point: crate, painted floor marking and charge ring in a 3/4 view at ~3.4 m',
    apply: (e) => {
      const player = e.get<PlayerApi>('player'); if (!player) return;
      const spots = pickups.placements();
      if (spots.length === 0) return;
      const { pos: a, yaw } = spots[0];
      // Ideal: 3/4 on to the latch/LED face. Fall back around the crate until the view is clear.
      const dist = 3.4;
      let dir: THREE.Vector3 | null = null;
      for (const off of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6, Math.PI]) {
        const t = yaw + off;
        const d = new THREE.Vector3(Math.sin(t), 0, Math.cos(t));
        let clear = true;
        try { clear = !e.physics.raycast({ x: a.x, y: a.y + 1.2, z: a.z }, { x: d.x, y: 0, z: d.z }, dist + 0.8, groups(CG.PROJECTILE, CG.WORLD)); } catch { /* physics not ready */ }
        if (clear) { dir = d; break; }
      }
      if (!dir) dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const eye = a.clone().addScaledVector(dir, dist); eye.y = a.y;
      const look = dir.clone().negate();
      const dy = (a.y + 0.42) - (eye.y + 1.55);
      player.teleport(eye, Math.atan2(-look.x, -look.z), Math.atan2(dy, dist));
    },
    settleFrames: 30,
  });

  registerPose({
    name: 'game_grenade',
    description: 'Frag grenade mid-air ~0.4s after the throw, camera tracking it',
    apply: (e) => {
      const player = e.get<PlayerApi>('player'); const level = e.get<LevelApi>('level');
      if (!player) return;
      facingStreet(player, level);
      grenades.clear();
      e.tick(1 / 60); // settle eye position before the throw origin is sampled
      const yaw = player.yaw;
      const dir = new THREE.Vector3(-Math.sin(yaw), 0.42, -Math.cos(yaw)).normalize();
      const speed = 6.5;
      const t = 0.4;
      const at = grenades.predict(dir, speed, t);
      // Present the fuze, safety lever and pull ring to camera instead of whatever the tumble lands on.
      const look = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-look.z, 0, look.x).normalize();
      const orient = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(look.z, -look.x) + 1.5)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(right, -0.42));
      grenades.throwGrenade(dir, speed, { fuse: 1e9, spin: 0.05, orient }); // never detonates inside another pose's capture
      // Point the camera at where the grenade will be when the capture lands.
      const eye = player.eye.clone();
      const to = at.clone().sub(eye);
      const flat = Math.hypot(to.x, to.z);
      player.yaw = Math.atan2(-to.x, -to.z);
      player.pitch = Math.atan2(to.y, flat);
    },
    animateFrames: 24,
    settleFrames: 24,
  });
}
