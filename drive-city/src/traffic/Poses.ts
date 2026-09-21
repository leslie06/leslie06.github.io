import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, WantedApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import type { TrafficApi } from '.';

/** Traffic poses: let the simulation fill the streets (physics only), then frame a junction. */
function simulate(e: Engine, seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) e.stepFixed(dt);
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

export function registerTrafficPoses(): void {
  registerPose({
    name: 'traffic_junction', description: 'The nearest signalised junction to the spawn, from above, after 25 s of traffic.',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const tr = e.get<TrafficApi>('traffic');
      if (!tr) return;
      // Nearest junction to the spawn.
      let best = tr.signals.centres[0], bd = Infinity;
      for (const c of tr.signals.centres) { const d = Math.hypot(c.x - world.spawn.x, c.z - world.spawn.z); if (d < bd) { bd = d; best = c; } }
      cam.override = (c) => { c.position.set(best.x + 38, 30, best.z + 38); c.lookAt(best.x, 0, best.z); c.fov = 55; c.updateProjectionMatrix(); };
      e.tick(1 / 60);
      await world.preload?.(best.x, best.z);
      simulate(e, 25);
      for (let i = 0; i < 30; i++) e.tick(1 / 60);
      void v;
    },
  });
  registerPose({
    name: 'traffic_lane_junction',
    description: 'A lane junction in 金鱼池 (on the short cycle), at eye height: side streets have lights too.',
    async apply(e) {
      const { cam, world } = await prepare(e);
      const tr = e.get<TrafficApi>('traffic');
      if (!tr) return;
      // The short-cycle junction nearest a grid of lanes south of 天坛's north gate.
      const g = tr.graph, sig = tr.signals;
      const want = { x: 330, z: 2257 };
      let node = -1, bd = Infinity;
      for (let i = 0; i < g.nodeX.length; i++) {
        const c = sig.junctionOf(i);
        if (c < 0 || sig.cycleOf(c) >= 50) continue;
        const d = Math.hypot(g.nodeX[i] - want.x, g.nodeZ[i] - want.z);
        if (d < bd) { bd = d; node = i; }
      }
      if (node < 0) return;
      // Stand back along the longest approach, looking into the junction.
      let best = -1, bl = 0;
      for (const l of g.links) if (l.to === node && l.len > bl && sig.junctionOf(l.from) !== sig.junctionOf(node)) { bl = l.len; best = l.id; }
      const at = g.at(g.links[best], Math.max(0, g.links[best].len - 22), 0, { x: 0, z: 0, dx: 0, dz: 0 });
      const x = g.nodeX[node], z = g.nodeZ[node];
      e.get<VehicleApi>('vehicle')!.reset({ x: at.x - at.dx * 30, y: 1.2, z: at.z - at.dz * 30 }, Math.atan2(at.dx, at.dz));
      cam.override = (c) => { c.position.set(at.x, 1.7, at.z); c.lookAt(x, 2.6, z); c.fov = 60; c.updateProjectionMatrix(); };
      e.tick(1 / 60);
      await world.preload?.(x, z);
      simulate(e, 20);
      for (let i = 0; i < 30; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'traffic_street', description: 'Chang\'an Avenue behind the parked taxi after 20 s of traffic.',
    async apply(e) {
      const { cam } = await prepare(e);
      cam.mode = 'far';
      simulate(e, 20);
      for (let i = 0; i < 60; i++) e.tick(1 / 60);
    },
  });
}
