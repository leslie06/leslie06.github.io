import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import type { MissionSystem } from '.';

export function registerMissionPoses(): void {
  registerPose({
    name: 'taxi_fare', description: 'A fare waiting at the kerb near the spawn: the marker and the client, from above the taxi.',
    async apply(e: Engine) {
      const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
      ui.state = 'playing';
      (document.querySelector('.menu') as HTMLElement).hidden = true;
      hud.setVisible(new URLSearchParams(location.search).has('hud'));
      v.autopilot = null; v.inputEnabled = true; cam.override = null;
      e.get<WantedApi>('wanted')?.clear();
      v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
      await world.preload?.(world.spawn.x, world.spawn.z);
      const m = e.get<MissionSystem>('missions');
      if (!m || !m.debug.startFare()) return;
      const p = m.debug.state().pickup!;
      // From the road, 16 m back along the line from the taxi, head height plus a little.
      const car = v.car, dx = p.x - car.pos.x, dz = p.z - car.pos.z, d = Math.hypot(dx, dz) || 1;
      const eye = { x: p.x - (dx / d) * 16, z: p.z - (dz / d) * 16 };
      cam.override = (c) => { c.position.set(eye.x, 4.5, eye.z); c.lookAt(p.x, 1.2, p.z); c.fov = 50; c.updateProjectionMatrix(); };
      e.tick(1 / 60);
      await world.preload?.(p.x, p.z);
      for (let i = 0; i < 8 * 60; i++) e.stepFixed(1 / 60);
      for (let i = 0; i < 40; i++) e.tick(1 / 60);
      v.inputEnabled = false;
    },
  });
}
