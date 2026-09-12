import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import type { RaceSystem } from '.';

export function registerRacePoses(): void {
  registerPose({
    name: 'race_start', description: 'Street race on 建国门外大街: the grid 1.5 s after GO, rivals alongside, first checkpoint marker ahead.',
    async apply(e: Engine) {
      const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
      ui.state = 'playing';
      (document.querySelector('.menu') as HTMLElement).hidden = true;
      hud.setVisible(new URLSearchParams(location.search).has('hud'));
      v.autopilot = null; cam.override = null;
      e.get<WantedApi>('wanted')?.clear();
      const r = e.get<RaceSystem>('races');
      if (!r || !r.debug.start(0)) return;
      const cp = r.debug.state().checkpoints[0];
      await world.preload?.(v.car.pos.x, v.car.pos.z);
      await world.preload?.(cp.x, cp.z);
      for (let i = 0; i < 4.5 * 60; i++) e.stepFixed(1 / 60);
      cam.mode = 'far';
      for (let i = 0; i < 40; i++) e.tick(1 / 60);
    },
  });
}
