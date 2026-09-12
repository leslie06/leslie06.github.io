import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import type { PoliceSystem } from '.';

function simulate(e: Engine, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) e.stepFixed(1 / 60);
}

export function registerPolicePoses(): void {
  registerPose({
    name: 'police_chase', description: 'Three stars at the spawn (busting off): police cars closing in on the parked taxi after 9 s.',
    async apply(e) {
      const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
      const pol = e.get<PoliceSystem>('wanted');
      if (!pol) return;
      ui.state = 'playing';
      (document.querySelector('.menu') as HTMLElement).hidden = true;
      hud.setVisible(new URLSearchParams(location.search).has('hud'));
      v.autopilot = null; v.inputEnabled = false; cam.override = null;
      v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
      await world.preload?.(world.spawn.x, world.spawn.z);
      pol.clear();
      pol.debug.noBust = true;
      pol.debug.setLevel(3);
      cam.mode = 'far';
      simulate(e, 9);
      // Busting stays off through the capture frames; the next pose's clear() turns it back on.
      for (let i = 0; i < 60; i++) e.tick(1 / 60);
    },
  });
}
