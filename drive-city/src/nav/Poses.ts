import type { Engine } from '../core/Engine';
import type { Blip, CameraApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import type { MapScreen } from '../ui/MapScreen';
import { registerPose } from '../debug/PoseRegistry';
import { project } from '../city/Geo';
import { PathPilot } from '../vehicle/Autopilot';
import type { NavSystem } from '.';

/**
 * Navigation poses (`--world city`): the radar while driving with a route, blips and a search
 * circle; the full map framing a cross-city route; the map at street zoom. ui_* so the HUD shows.
 * Demo blips live only for the frames the pose renders.
 */
let demo: Blip[] = [];
let demoUntil = -1;
let hooked = false;

async function prepare(e: Engine) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, world = e.get<WorldApi>('world')!;
  const nav = e.get<NavSystem>('nav')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  v.autopilot = null; v.inputEnabled = false; cam.override = null; cam.mode = 'chase';
  v.drift.lastAt = -99;
  v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
  cam.snap();
  if (!hooked) {
    hooked = true;
    nav.addBlips(() => (e.frame <= demoUntil ? demo : []));
    // Once a nav pose has been captured, its waypoint and search circle must not leak into the next pose.
    e.add({ name: 'navposes', update() { if (demoUntil >= 0 && e.frame > demoUntil) { demoUntil = -1; nav.setTarget(null); nav.searchArea = null; } } });
  }
  nav.setTarget(null); nav.searchArea = null;
  await world.preload?.(world.spawn.x, world.spawn.z);
  await nav.map.ready;
  return { v, cam, world, nav };
}

/** Physics-only fast-forward, then real frames (the city poses' pattern). */
function run(e: Engine, seconds: number, render: number): void {
  const dt = 1 / 60;
  for (let i = 0, n = Math.max(0, Math.round((seconds - render) * 60)); i < n; i++) {
    e.stepFixed(dt);
    for (const s of e.systems) if (s.name === 'vehicle' || s.name === 'fx' || s.name === 'nav') s.update?.(dt, 0);
  }
  for (let i = 0, n = Math.round(render * 60); i < n; i++) e.tick(dt);
}

/** Blips around a point: a flashing police car, a patrol, a pickup, a drop-off, a parked car. */
function around(x: number, z: number, h: number): Blip[] {
  const fx = Math.sin(h), fz = Math.cos(h), lx = fz, lz = -fx;
  const at = (f: number, l: number) => ({ x: x + fx * f + lx * l, z: z + fz * f + lz * l });
  return [
    { kind: 'police', ...at(-70, 4), heading: h, flash: true },
    { kind: 'police', ...at(150, -90), heading: h + Math.PI / 2, flash: true },
    { kind: 'pickup', ...at(110, 30), label: '乘客' },
    { kind: 'car', ...at(40, -14), heading: h },
    { kind: 'dropoff', ...at(-160, -120), label: 'Drop-off' },
  ];
}

export function registerNavPoses(): void {
  registerPose({
    name: 'ui_minimap', description: 'Driving west on Chang\'an at 50 km/h with a waypoint at Beijing Railway Station: radar, route, blips, search circle.',
    async apply(e) {
      const { v, world, nav } = await prepare(e);
      const [tx, tz] = project(39.902290, 116.421031);
      nav.setTarget({ x: tx, z: tz, kind: 'waypoint' });
      v.autopilot = new PathPilot(world.attract!.path, { speed: 14, lookahead: 14, closed: false });
      run(e, 7, 0);
      await world.preload?.(v.car.pos.x, v.car.pos.z);
      const h = Math.atan2(v.car.fwd.x, v.car.fwd.z);
      demo = around(v.car.pos.x, v.car.pos.z, h);
      demoUntil = e.frame + 200;
      run(e, 1.5, 1.5);
      // Police rewrite the search area every physics step: set it for paused frames only.
      const p = v.car.pos;
      nav.searchArea = { x: p.x + Math.sin(h) * 170 + Math.cos(h) * 110, z: p.z + Math.cos(h) * 170 - Math.sin(h) * 110, r: 150 };
      e.paused = true; e.tick(1 / 60); e.paused = false;
      demoUntil = e.frame + 4;
    },
  });
  const mapPose = (name: string, description: string, zoom: boolean) => registerPose({
    name, description,
    async apply(e) {
      const { v, nav } = await prepare(e);
      run(e, 1, 0.5);
      const [tx, tz] = project(39.882249, 116.406618);
      nav.setTarget({ x: tx, z: tz, kind: 'waypoint' });
      const p = v.car.pos, h = Math.atan2(v.car.fwd.x, v.car.fwd.z);
      demo = around(p.x, p.z, h);
      demo.push({ kind: 'target', x: tx + 380, z: tz - 520, label: 'Mission' });
      nav.searchArea = { x: p.x - 120, z: p.z + 90, r: 260 };
      demoUntil = e.frame + 200;
      const map = e.get<MapScreen>('navmap')!;
      map.open();
      const g = nav.gps;
      if (zoom && g) {
        // Street zoom half-way along the route.
        const k = Math.floor(g.pts.length / 4) * 2;
        map.focus(g.pts[k], g.pts[k + 1], 2.4);
      } else if (g) {
        let x0 = p.x, z0 = p.z, x1 = p.x, z1 = p.z;
        for (let i = 0; i < g.pts.length; i += 2) { x0 = Math.min(x0, g.pts[i]); x1 = Math.max(x1, g.pts[i]); z0 = Math.min(z0, g.pts[i + 1]); z1 = Math.max(z1, g.pts[i + 1]); }
        map.frame(x0 - 300, z0 - 300, x1 + 300, z1 + 300);
      }
      for (let i = 0; i < 20; i++) e.tick(1 / 60);
      demoUntil = e.frame + 4;
    },
  });
  mapPose('ui_map', 'Full-screen map framing a waypoint route from the spawn to the Temple of Heaven, with blips and a search circle.', false);
  mapPose('ui_map_zoom', 'Full-screen map at street zoom half-way along the route: buildings, street names.', true);
}
