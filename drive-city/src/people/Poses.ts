import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, WantedApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import type { TrafficApi } from '../traffic';

function simulate(e: Engine, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) e.stepFixed(1 / 60);
}

async function prepare(e: Engine) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null; v.inputEnabled = false; cam.override = null;
  e.get<WantedApi>('wanted')?.clear();
  v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
  await world.preload?.(world.spawn.x, world.spawn.z);
  return { v, cam, world };
}

export function registerPeoplePoses(): void {
  registerPose({
    name: 'people_sidewalk', description: 'The pavement of the nearest mid-sized street to the spawn after 15 s of pedestrians, from across the road.',
    async apply(e) {
      const { cam, world } = await prepare(e);
      const tr = e.get<TrafficApi>('traffic');
      if (!tr) return;
      const g = tr.graph, pt = { x: 0, z: 0, dx: 0, dz: 0 };
      let best = -1, bd = Infinity;
      for (const id of g.near(world.spawn.x, world.spawn.z, 500)) {
        const l = g.links[id];
        if (!['secondary', 'tertiary', 'primary'].includes(l.cls) || l.len < 70 || l.hw > 9) continue;
        g.at(l, l.len / 2, 0, pt);
        const d = Math.hypot(pt.x - world.spawn.x, pt.z - world.spawn.z);
        if (d < bd) { bd = d; best = id; }
      }
      if (best < 0) return;
      const l = g.links[best];
      const target = { ...g.at(l, l.len / 2, -(l.hw + 2), { x: 0, z: 0, dx: 0, dz: 0 }) };
      const eye = { ...g.at(l, l.len / 2 - 14, l.hw + 1.5, { x: 0, z: 0, dx: 0, dz: 0 }) };
      cam.override = (c) => { c.position.set(eye.x, 2.2, eye.z); c.lookAt(target.x, 1.2, target.z); c.fov = 55; c.updateProjectionMatrix(); };
      e.tick(1 / 60);
      await world.preload?.(target.x, target.z);
      simulate(e, 15);
      for (let i = 0; i < 20; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'player_onfoot', description: 'Out of the taxi at the spawn: the on-foot character and third-person camera.',
    async apply(e) {
      await prepare(e);
      simulate(e, 5);
      e.get<PlayerApi>('player')!.getOut();
      simulate(e, 1);
      for (let i = 0; i < 60; i++) e.tick(1 / 60);
    },
  });
}
