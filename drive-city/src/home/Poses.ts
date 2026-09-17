import type { Engine } from '../core/Engine';
import { project } from '../city/Geo';
import type { CameraApi, HudApi, PlayerApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import { registerPose } from '../debug/PoseRegistry';
import type { UiApi } from '../ui';
import type { HomeSystem } from '.';
import { ANCHOR, BED, DOOR, ENTRY, GARAGE, HOUSE, LANDING, PARK_AT, ROOM, STAIR, TERRACE, UPPER_ROOM, VOID, stairPoint } from './Layout';

/**
 * 我家 screenshot poses (`node scripts/shot.mjs --world city --poses home_...`).
 *
 * The villa is 300 m from the spawn, so every pose streams its own corner in first. Poses share one
 * page, so each resets what the last one left set (a vehicle reset also takes the player out of any
 * seat, and the wanted level has to be cleared by hand).
 *
 * The car always goes on the drive, never at the point the camera looks at: `reset` teleports it, so
 * aiming a pose at the living room once parked a taxi in it. To stand the player indoors the car
 * stays outside and `setRiding(null, at)` enables the foot capsule where we want it. Parking out
 * there also keeps the car clear of the garage door's 16 m trigger, so the door is shut in the
 * exterior shots.
 */

const [AX, AZ] = project(ANCHOR.lat, ANCHOR.lon);
/** Villa-local metres to world (the villa's heading is 0, so this is a translation). */
const W = (x: number, z: number) => ({ x: AX + x, z: AZ + z });
/** On the drive, 20 m from the garage door: clear of the house and of the door trigger. */
const CAR_SPOT = { x: -40, z: -10 };

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

const F0 = HOUSE.floor0, F1 = HOUSE.floor1;

export function registerHomePoses(): void {
  registerPose({
    name: 'home_aerial',
    description: '我家 from 170 m: the long louvred bar on its plinth, the infinity pool, the curved lawn terraces.',
    async apply(e) {
      await base(e);
      await shot(e, [-40, 170, 90], [14, 4, 2], 50);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_terrace',
    description: 'The south front: the upper bar cantilevered over the terrace, the dark infinity pool below it.',
    async apply(e) {
      await base(e);
      await shot(e, [30, 4.4, 30], [4, 5.5, 8], 58);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_entry',
    description: 'The board-formed concrete entry wall, the tall pivot door over three broad steps, the black reflecting pool.',
    async apply(e) {
      await base(e);
      await shot(e, [-22, 3.0, 8], [ENTRY.x, F0 + 1.5, ENTRY.z], 56);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_great',
    description: 'The great room under its timber plank ceiling: stone fireplace wall, the long table, the glass open to the terrace.',
    async apply(e) {
      await base(e);
      standAt(e, ROOM.great.x0 + 3, ROOM.great.z1 - 3, F0 + 0.1, 0);
      run(e, 0.4, 0);
      await shot(e, [ROOM.great.x0 + 1.5, F0 + 1.75, ROOM.great.z1 - 2.5],
        [ROOM.great.x1 - 4, F0 + 1.2, ROOM.great.z0 + 2], 72);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_stair',
    description: 'The curved timber stair turning against the rough stone wall, up through the void to the bar.',
    async apply(e) {
      await base(e);
      standAt(e, STAIR.cx + 5.5, STAIR.cz + 4, F0 + 0.1, Math.PI);
      run(e, 0.4, 0);
      await shot(e, [STAIR.cx + 6.0, F0 + 1.7, STAIR.cz + 4.5], [STAIR.cx, F0 + 2.6, STAIR.cz], 70);
      run(e, 0.6, 0.6);
    },
  });

  /**
   * The stair, from the four angles the bug reports came from: at the foot looking up it, in
   * elevation with a person beside it for scale, from the landing looking back down, and standing
   * on the first floor at the edge of the void. A flight that reads wrong reads wrong here.
   */
  registerPose({
    name: 'home_stair_foot',
    description: 'At the foot of the curved stair looking up the flight: tread spacing and the climb ahead.',
    async apply(e) {
      await base(e);
      const h = STAIR.hand;
      standAt(e, STAIR.cx - h * 0.4, STAIR.cz - 4.2, F0 + 0.1, 0);
      run(e, 0.4, 0);
      await shot(e, [STAIR.cx - h * 1.4, F0 + 1.65, STAIR.cz - 4.6], [STAIR.cx + h * 2.2, F0 + 1.9, STAIR.cz - 0.6], 74);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_stair_scale',
    description: 'The whole flight in elevation with a person standing at its foot: riser height against a human.',
    async apply(e) {
      await base(e);
      standAt(e, STAIR.cx - STAIR.hand * 0.4, STAIR.cz - 3.9, F0 + 0.1, Math.PI / 2);
      run(e, 0.4, 0);
      await shot(e, [STAIR.cx + 15, F0 + 2.2, STAIR.cz - 1.0], [STAIR.cx, F0 + 2.2, STAIR.cz - 1.0], 42);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_stair_top',
    description: 'From the landing looking back down the flight: does the stair arrive, and is the top tread flush?',
    async apply(e) {
      await base(e);
      standAt(e, (LANDING.x0 + LANDING.x1) / 2, LANDING.z1 - 0.5, F1 + 0.1, Math.PI);
      run(e, 0.4, 0);
      await shot(e, [STAIR.cx - STAIR.hand * 0.6, F1 + 1.6, LANDING.z1 + 0.4], [STAIR.cx + STAIR.hand * 2.4, F0 + 1.2, STAIR.cz - 1.5], 76);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_void',
    description: 'Standing on the first floor at the edge of the stairwell: the slab edge, the rail and the landing.',
    async apply(e) {
      await base(e);
      standAt(e, VOID.x1 + 1.4, VOID.z0 + 2.0, F1 + 0.1, -Math.PI / 2);
      run(e, 0.4, 0);
      await shot(e, [VOID.x1 + 2.4, F1 + 1.65, VOID.z0 + 1.6], [VOID.x0 + 1.0, F1 - 0.8, VOID.z1 - 1.5], 80);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_arrival',
    description: 'Stepping off the top tread: the landing underfoot and the gallery portal straight ahead, no void between.',
    async apply(e) {
      const top = stairPoint(STAIR.a1, STAIR.r);
      await base(e);
      standAt(e, top.x + 0.6, top.z, F1 + 0.1, Math.PI / 2);
      run(e, 0.4, 0);
      await shot(e, [top.x - 1.6, F1 + 1.9, top.z + 0.5], [UPPER_ROOM.hall.x0 + 4, F1 + 0.9, -1], 76);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_master',
    description: 'The master bedroom: the dressed bed on its rug, the corner glass and the balcony beyond.',
    async apply(e) {
      const M = UPPER_ROOM.master;
      await base(e);
      // From the doorway, as you walk in: the foot of the bed, not the back of its headboard.
      standAt(e, 29.5, M.z0 + 1.2, F1 + 0.1, 0);
      run(e, 0.4, 0);
      await shot(e, [29.9, F1 + 1.72, M.z0 + 0.2], [BED.master.wallX + 1.2, F1 + 0.7, BED.master.z + 0.4], 78);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_bed2',
    description: 'A guest bedroom: bed, nightstands and sconces, the wardrobe, the curtains on the south glass.',
    async apply(e) {
      const B = UPPER_ROOM.bed2;
      await base(e);
      standAt(e, 5.6, B.z0 + 1.3, F1 + 0.1, 0);
      run(e, 0.4, 0);
      await shot(e, [5.3, F1 + 1.72, B.z0 + 0.2], [BED.bed2.wallX - 1.2, F1 + 0.7, BED.bed2.z + 0.6], 78);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_gallery',
    description: 'The upper gallery: the doors into the two bedrooms and the bathroom, the pictures along it.',
    async apply(e) {
      const G = UPPER_ROOM.hall;
      await base(e);
      standAt(e, G.x0 + 1.6, G.z1 - 2.0, F1 + 0.1, Math.PI / 2);
      run(e, 0.4, 0);
      await shot(e, [G.x0 + 0.6, F1 + 1.68, (G.z0 + G.z1) / 2], [G.x1 + 4, F1 + 1.3, (G.z0 + G.z1) / 2], 76);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_dress',
    description: 'The master dressing room: the hanging runs, the island of drawers and the long mirror.',
    async apply(e) {
      const D = UPPER_ROOM.dress;
      await base(e);
      standAt(e, D.x1 - 1.4, D.z1 - 1.6, F1 + 0.1, Math.PI);
      run(e, 0.4, 0);
      await shot(e, [D.x1 - 1.0, F1 + 1.68, D.z1 - 0.9], [D.x0 + 1.0, F1 + 1.1, D.z0 + 1.6], 78);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_lounge',
    description: 'The upstairs media room: the joinery wall, the sofa and the reading light.',
    async apply(e) {
      const G = UPPER_ROOM.lounge;
      await base(e);
      standAt(e, G.x1 - 1.6, G.z1 - 1.2, F1 + 0.1, Math.PI);
      run(e, 0.4, 0);
      await shot(e, [G.x1 - 1.2, F1 + 1.68, G.z1 - 0.8], [G.x0 + 2.4, F1 + 1.2, G.z0 + 1.0], 76);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_poolside',
    description: 'The terrace dressed: the outdoor lounge under the cantilever, the loungers and parasols along the pool.',
    async apply(e) {
      await base(e);
      await shot(e, [-8, 3.2, 24], [20, 2.0, TERRACE.z0 + 2], 62);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'home_bath',
    description: 'The master bathroom: the boat tub at the louvred window, the lit vanity, the droplet chandelier.',
    async apply(e) {
      const B = UPPER_ROOM.bath1;
      await base(e);
      standAt(e, B.x0 + 1.5, B.z1 - 1.6, F1 + 0.1, 0);
      run(e, 0.4, 0);
      // From the door end, across the vanity to the tub at the louvred east glass.
      await shot(e, [B.x0 + 1.2, F1 + 1.68, B.z1 - 1.2], [B.x1 - 1.5, F1 + 0.8, (B.z0 + B.z1) / 2 + 0.6], 76);
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
      await shot(e, [GARAGE.x0 - 15, 4.0, DOOR.z + 7], [PARK_AT.x, 1.6, PARK_AT.z], 56);
      run(e, 0.6, 0.6);
    },
  });
}
