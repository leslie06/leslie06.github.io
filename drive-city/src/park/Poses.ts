import type { Engine } from '../core/Engine';
import { project } from '../city/Geo';
import type { CameraApi, HudApi, PlayerApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import type { ParkSystem } from '.';
import { ANCHOR, COASTER, MOUNTAIN, RIDES } from './Layout';
import { frameAt, makeFrame, trackLength } from './Rides';

/**
 * 北京欢乐谷 screenshot poses (`node scripts/shot.mjs --world city --poses park_...`).
 *
 * The park is 9 km south-east of the spawn, so every pose streams its own corner in before it
 * frames anything. The two ride poses put the player in a seat and wind the ride to the moment
 * worth photographing - the coaster to the lip of its 30 m drop, the frisbee to full swing - rather
 * than waiting out a 76 second lap in real time.
 */

const [AX, AZ] = project(ANCHOR.lat, ANCHOR.lon);
/** Park-local metres to world (the park's heading is 0, so this is a translation). */
const W = (x: number, z: number) => ({ x: AX + x, z: AZ + z });

async function base(e: Engine, x: number, z: number) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!;
  const ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null; v.inputEnabled = false; cam.override = null; cam.mode = 'chase';
  e.get<WantedApi>('wanted')?.clear();
  // A reset also takes the player out of any seat a previous pose left them in.
  v.reset({ x, y: 1.2, z }, 0);
  await world.preload?.(x, z);
  return { v, cam, world, park: e.get<ParkSystem>('park') };
}

function run(e: Engine, seconds: number, render = 1.5): void {
  const dt = 1 / 60;
  for (let i = 0, n = Math.max(0, Math.round((seconds - render) * 60)); i < n; i++) e.stepFixed(dt);
  for (let i = 0, n = Math.round(render * 60); i < n; i++) e.tick(dt);
}

function fixedCam(e: Engine, pos: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }, fov = 50): void {
  e.get<CameraApi>('camera')!.override = (c) => {
    c.position.set(pos.x, pos.y, pos.z);
    c.lookAt(look.x, look.y, look.z);
    c.fov = fov;
    c.updateProjectionMatrix();
  };
}

/** Stand the player at a ride's boarding marker, on foot. */
function standAt(e: Engine, id: string): void {
  const spec = RIDES.find((r) => r.id === id)!;
  const at = W(spec.x + spec.board[0], spec.z + spec.board[1]);
  const v = e.get<VehicleApi>('vehicle')!;
  v.reset({ x: at.x, y: 1.2, z: at.z }, spec.yaw);
  e.get<PlayerApi>('player')!.getOut();
}

export function registerParkPoses(): void {
  registerPose({
    name: 'park_aerial',
    description: '北京欢乐谷 from 430 m: the real OSM boundary, its lakes and paths, 水晶圣城 in the middle with 水晶神翼 round it.',
    async apply(e) {
      const c = W(40, 90), cam = W(-100, 620);
      await base(e, c.x, c.z);
      fixedCam(e, { x: cam.x, y: 430, z: cam.z }, { x: c.x, y: 30, z: c.z }, 52);
      e.tick(1 / 60);
      await e.get<WorldApi>('world')!.preload?.(cam.x, cam.z);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'park_coaster',
    description: '水晶神翼 from across the park: the 32 m lift, the vertical loop and the 70 m rock it circles.',
    async apply(e) {
      const look = W(MOUNTAIN.x, MOUNTAIN.z), cam = W(60, 300);
      await base(e, look.x, look.z);
      fixedCam(e, { x: cam.x, y: 60, z: cam.z }, { x: look.x, y: 35, z: look.z }, 58);
      e.tick(1 / 60);
      await e.get<WorldApi>('world')!.preload?.(cam.x, cam.z);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'park_gate',
    description: 'The east gate on 金蝉西路, where you park and walk in.',
    async apply(e) {
      const gate = W(384, 201), cam = W(470, 214);
      await base(e, gate.x, gate.z);
      fixedCam(e, { x: cam.x, y: 6, z: cam.z }, { x: gate.x, y: 8, z: gate.z }, 60);
      e.tick(1 / 60);
      await e.get<WorldApi>('world')!.preload?.(cam.x, cam.z);
      run(e, 0.6, 0.6);
    },
  });

  registerPose({
    name: 'park_ride',
    description: 'Riding 水晶神翼 over the lip of the 30 m drop: nose down, the park laid out ahead, F to get off.',
    async apply(e) {
      const spec = RIDES[0], at = W(spec.x, spec.z);
      const { park } = await base(e, at.x, at.z);
      if (!park) return;
      standAt(e, 'crystalwing');
      run(e, 0.2, 0);
      if (!park.debug.start('crystalwing')) return;
      // The lip of the first drop: the steepest point in the stretch right after the chain lets go.
      // Searching the whole lap finds the loop instead - its down-side is properly vertical - and
      // lands the camera at grass level on the way out of it.
      const f = makeFrame();
      const total = trackLength();
      const from = COASTER.lift.to * total, to = from + total * 0.1;
      let dropS = from, steepest = 0;
      for (let m = from; m < to; m += 2) {
        frameAt(m, f);
        if (f.tan.y < steepest) { steepest = f.tan.y; dropS = m; }
      }
      park.debug.seek(dropS + 10);
      run(e, 0.5, 0.5);
    },
  });

  registerPose({
    name: 'park_storm',
    description: '能量风暴 at full swing, seen from the queue: the 22 m arm near vertical, the disc spinning.',
    async apply(e) {
      const spec = RIDES[1], at = W(spec.x, spec.z), cam = W(spec.x + 34, spec.z + 30);
      const { park } = await base(e, at.x, at.z);
      if (!park) return;
      standAt(e, 'energystorm');
      run(e, 0.2, 0);
      park.debug.start('energystorm');
      // The swing builds over half a minute; wind it forward to the peak.
      run(e, 30, 0);
      fixedCam(e, { x: cam.x, y: 14, z: cam.z }, { x: at.x, y: 20, z: at.z }, 56);
      run(e, 0.5, 0.5);
    },
  });
}
