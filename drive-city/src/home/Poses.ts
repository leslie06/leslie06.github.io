import type { Engine } from '../core/Engine';
import { project } from '../city/Geo';
import type { CameraApi, HudApi, PlayerApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import { registerPose } from '../debug/PoseRegistry';
import type { UiApi } from '../ui';
import type { HomeSystem } from '.';
import { ANCHOR, DOOR, ENTRY, GARAGE, HOUSE, PARK_AT, POOL, STAIR } from './Layout';

/**
 * 我家 screenshot poses (`node scripts/shot.mjs --world city --poses home_...`).
 *
 * The villa is 300 m from the spawn, so every pose streams its own corner in first. Poses share one
 * page, so each resets what the last one left set (a vehicle reset also takes the player out of any
 * seat, and the wanted level has to be cleared by hand).
 *
 * The car is always put on the drive, never at the point the camera looks at: `reset` teleports the
 * player's car, so aiming a pose at the living room used to park a taxi in it. To stand the player
 * indoors, the car stays outside and `setRiding(null, at)` enables the foot capsule where we want
 * it. Parking on the drive also keeps the car outside the garage door's 16 m trigger, so the door
 * is shut in the exterior shots.
 */

const [AX, AZ] = project(ANCHOR.lat, ANCHOR.lon);
/** Villa-local metres to world (the villa's heading is 0, so this is a translation). */
const W = (x: number, z: number) => ({ x: AX + x, z: AZ + z });
/** On the entrance drive, 25 m from the garage door: clear of the house and of the door trigger. */
const CAR_SPOT = { x: -30, z: 0 };

async function base(e: Engine) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!;
  const ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null; v.inputEnabled = false; cam.override = null; cam.mode = 'chase';
  e.get<WantedApi>('wanted')?.clear();
  const at = W(CAR_SPOT.x, CAR_SPOT.z);
  v.reset({ x: at.x, y: 1.2, z: at.z }, Math.PI / 2);
  await world.preload?.(at.x, at.z);
  return { v, cam, world, home: e.get<HomeSystem>('home') };
}

function run(e: Engine, seconds: number, render = 1.5): void {
  const dt = 1 / 60;
  for (let i = 0, n = Math.max(0, Math.round((seconds - render) * 60)); i < n; i++) e.stepFixed(dt);
  for (let i = 0, n = Math.round(render * 60); i < n; i++) e.tick(dt);
}

/** Point the camera at a villa-local target from a villa-local eye, and stream that corner in. */
async function shot(e: Engine, eye: [number, number, number], look: [number, number, number], fov = 52): Promise<void> {
  const p = W(eye[0], eye[2]), q = W(look[0], look[2]);
  e.get<CameraApi>('camera')!.override = (c) => {
    c.position.set(p.x, eye[1], p.z);
    c.lookAt(q.x, look[1], q.z);
    c.fov = fov;
    c.updateProjectionMatrix();
  };
  e.tick(1 / 60);
  await e.get<WorldApi>('world')!.preload?.(p.x, p.z);
}

/** Stand the player on foot at a villa-local spot, leaving the car out on the drive. */
function standAt(e: Engine, x: number, z: number, y: number, yaw: number): void {
  const pl = e.get<PlayerApi>('player')!;
  pl.getOut();
  const at = W(x, z);
  pl.setRiding(null, { x: at.x, y, z: at.z, yaw });
}

export function registerHomePoses(): void {
  registerPose({
    name: 'home_aerial',
    description: '我家 from 150 m: the walled plot off 恒惠路, the drive, the house, the pool and the lawn.',
    async apply(e) {
      await base(e);
      await shot(e, [-70, 150, 80], [6, 4, 0], 50);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_gate',
    description: 'The approach: in at the open gate off 恒惠路, the drive running to the garage, door shut.',
    async apply(e) {
      await base(e);
      await shot(e, [-62, 5.5, 6], [-4, 4.5, -3], 58);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_front',
    description: 'The entrance front: travertine and glass, the upper volume cantilevered over the door.',
    async apply(e) {
      await base(e);
      await shot(e, [-16, 6, 14], [HOUSE.x0 + 2, 4.5, ENTRY.z], 52);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_pool',
    description: 'The terrace and pool on the south side, the full-height glazing behind it.',
    async apply(e) {
      await base(e);
      await shot(e, [34, 4.4, 26], [18, 4, POOL.z0 - 3], 58);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_inside',
    description: 'Standing in the living room on foot: the stair up the east wall, the garden through the glass.',
    async apply(e) {
      await base(e);
      standAt(e, HOUSE.x0 + 13, HOUSE.z1 - 8, HOUSE.floor0 + 0.1, Math.PI);
      run(e, 0.4, 0);
      await shot(e, [HOUSE.x0 + 3, HOUSE.floor0 + 1.75, HOUSE.z1 - 1.6], [HOUSE.x0 + 21, HOUSE.floor0 + 1.15, HOUSE.z0 + 7], 70);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_stair',
    description: 'The open-riser stair and the void it comes up through: where the first floor is.',
    async apply(e) {
      await base(e);
      standAt(e, HOUSE.x0 + 16, HOUSE.z1 - 3, HOUSE.floor0 + 0.1, 0);
      run(e, 0.4, 0);
      await shot(e, [HOUSE.x0 + 15, HOUSE.floor0 + 1.7, HOUSE.z1 - 1.5],
        [STAIR.x, HOUSE.floor0 + 2.6, STAIR.zTop + 2], 68);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_garage',
    description: 'The garage with the roller door up and the car parked inside: where the day is banked.',
    async apply(e) {
      const { home } = await base(e);
      const spot = W(PARK_AT.x, PARK_AT.z);
      e.get<VehicleApi>('vehicle')!.reset({ x: spot.x, y: 1.0, z: spot.z }, PARK_AT.yaw);
      home?.debug.setDoor(1);
      run(e, 0.6, 0);
      await shot(e, [GARAGE.x0 - 16, 4.2, DOOR.z + 7], [PARK_AT.x, 1.6, PARK_AT.z], 56);
      run(e, 0.6, 0.6);
    },
  });
}
