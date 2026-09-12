import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { PathPilot } from '../vehicle/Autopilot';
import { registerPose } from '../debug/PoseRegistry';
import { project } from './Geo';
import type { RenderSystem } from '../render/RenderSystem';
import type { Routes } from './Routes';

let defaultTod: number | null = null;
/** Set the clock (h) for a pose, or back to the default with null; settles exposure, sky and lights. */
function setTime(e: Engine, h: number | null): void {
  const r = e.get<RenderSystem>('render');
  if (!r) return;
  if (defaultTod === null) defaultTod = r.timeOfDay;
  r.timeOfDay = h ?? defaultTod;
  r.settle?.();
}

/** City screenshot poses (`node scripts/shot.mjs --world city`). Each preloads the area it frames. */
async function base(e: Engine, x: number, z: number) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null; v.inputEnabled = false; cam.override = null; cam.mode = 'chase';
  v.drift.lastAt = -99;
  setTime(e, null);
  // The police module's BUSTED screen can come up while a pose holds the car still: these shots
  // judge the city, so keep it out of them.
  if (!document.getElementById('city-shot-css')) {
    const st = document.createElement('style'); st.id = 'city-shot-css'; st.textContent = '.dc-busted{display:none!important}';
    document.head.appendChild(st);
  }
  await world.preload?.(x, z);
  return { v, cam, world };
}

function run(e: Engine, seconds: number, render = 1.5): void {
  const dt = 1 / 60;
  for (let i = 0, n = Math.max(0, Math.round((seconds - render) * 60)); i < n; i++) {
    e.stepFixed(dt);
    for (const s of e.systems) if (s.name === 'vehicle' || s.name === 'fx') s.update?.(dt, 0);
  }
  for (let i = 0, n = Math.round(render * 60); i < n; i++) e.tick(dt);
}

function aerial(e: Engine, pos: THREE.Vector3Like, look: THREE.Vector3Like, fov = 50): void {
  e.get<CameraApi>('camera')!.override = (c) => { c.position.set(pos.x, pos.y, pos.z); c.lookAt(look.x, look.y, look.z); c.fov = fov; c.updateProjectionMatrix(); };
}

export function registerCityPoses(): void {
  registerPose({
    name: 'city_spawn', description: 'The taxi on 建国门外大街 at the spawn, chase camera.',
    async apply(e) {
      const w = e.get<WorldApi>('world')!;
      const { v, cam } = await base(e, w.spawn.x, w.spawn.z);
      v.reset({ x: w.spawn.x, y: w.spawn.y, z: w.spawn.z }, w.spawn.yaw);
      // Snap the chase camera: easing in from wherever the previous pose left it would let the
      // streamer follow a far-away camera and unload the spawn.
      cam.snap();
      run(e, 2, 2);
    },
  });
  registerPose({
    name: 'city_changan', description: 'Driving west on Chang\'an Avenue at 60 km/h.',
    async apply(e) {
      const w = e.get<WorldApi>('world')!;
      const { v, cam } = await base(e, w.spawn.x, w.spawn.z);
      v.reset({ x: w.spawn.x, y: w.spawn.y, z: w.spawn.z }, w.spawn.yaw);
      cam.snap();
      v.autopilot = new PathPilot(w.attract!.path, { speed: 17, lookahead: 14, closed: false });
      run(e, 9, 0);
      await w.preload?.(v.car.pos.x, v.car.pos.z);
      run(e, 1.5, 1.5);
    },
  });
  const air = (name: string, description: string, lat: number, lon: number, dist: number, height: number, bearing: number, fov = 50) => registerPose({
    name, description,
    async apply(e) {
      const [x, z] = project(lat, lon);
      const b = bearing * Math.PI / 180;
      const cx = x - Math.sin(b) * dist, cz = z + Math.cos(b) * dist;
      await base(e, x, z);
      aerial(e, { x: cx, y: height, z: cz }, { x, y: height * 0.15, z }, fov);
      e.tick(1 / 60);
      await e.get<WorldApi>('world')!.preload?.(cx, cz);
      run(e, 0.5, 0.5);
    },
  });
  air('city_cbd', 'CBD from the south-west: 国贸三期, 中国尊, CCTV.', 39.9105, 116.4605, 900, 260, 30, 45);
  air('city_tiananmen', 'Tiananmen from Chang\'an Avenue.', 39.907338, 116.391265, 260, 22, 0, 55);
  air('city_hutong', 'Hutong roofs east of Qianmen.', 39.8975, 116.4035, 180, 90, 40, 55);
  air('city_temple', 'Temple of Heaven from the air.', 39.8823, 116.4066, 700, 320, 20, 50);
  air('city_overview', 'Central Beijing from 520 m over the south-west, the CBD on the horizon.', 39.9050, 116.4180, 1250, 520, 48, 52);
  // Street level on a road of the given classes nearest to a point: camera on the pavement looking along it.
  const street = (name: string, description: string, lat: number, lon: number, classes: string[], o: { h?: number; pitch?: number; side?: number; tod?: number; fov?: number } = {}) => registerPose({
    name, description,
    async apply(e) {
      const [tx, tz] = project(lat, lon);
      const { world } = await base(e, tx, tz);
      if (o.tod !== undefined) setTime(e, o.tod);
      const routes = (world as unknown as { routes?: Routes }).routes;
      let best: { x: number; z: number; dx: number; dz: number; w: number; d: number } | null = null;
      for (const ed of routes?.net.edges ?? []) {
        if (!classes.includes(ed.c)) continue;
        for (let k = 0; k + 3 < ed.p.length; k += 2) {
          const ax = ed.p[k], az = ed.p[k + 1], bx = ed.p[k + 2], bz = ed.p[k + 3], vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz) || 1;
          const t = Math.max(0.2, Math.min(0.8, ((tx - ax) * vx + (tz - az) * vz) / (L * L)));
          const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - tx, pz - tz);
          if (!best || d < best.d) best = { x: px, z: pz, dx: vx / L, dz: vz / L, w: ed.w, d };
        }
      }
      if (!best) best = { x: tx, z: tz, dx: 1, dz: 0, w: 6, d: 0 };
      // On the pavement between the street trees (w/2 + 2.2 m) and the building line.
      const side = (o.side ?? 1) * (best.w / 2 + 3.4), nx = best.dz, nz = -best.dx;
      const cx = best.x + nx * side, cz = best.z + nz * side, h = o.h ?? 1.7, pitch = ((o.pitch ?? 0) * Math.PI) / 180;
      aerial(e, { x: cx, y: h, z: cz }, { x: cx + best.dx * 30, y: h + Math.tan(pitch) * 30, z: cz + best.dz * 30 }, o.fov ?? 60);
      e.tick(1 / 60);
      await world.preload?.(cx, cz);
      run(e, 0.5, 0.5);
    },
  });
  // Pose coordinates here are GCJ-02-ish like Geo.ORIGIN; OSM (WGS-84) features sit ~540 m west,
  // so these two are given in OSM terms.
  street('city_hutong_street', 'Street level in a hutong lane of 东四 (OSM coordinates).', 39.9179, 116.4145, ['residential', 'living_street', 'service', 'unclassified'], { side: 0 });
  air('city_palace', 'The Forbidden City from the south, over the Meridian Gate.', 39.9169, 116.3912, 650, 260, 0, 50);
  street('city_cbd_street', 'Street level on 建国门外大街 in the CBD, looking up at the towers.', 39.9087, 116.4565, ['trunk', 'primary'], { pitch: 16, fov: 65 });
  street('city_shop_street', 'Street level on a shopping street in the old city.', 39.9005, 116.4140, ['secondary', 'tertiary'], { side: -1 });
  street('city_night_street', 'The shopping street at 21:30: lit windows, shop fronts and signs.', 39.9005, 116.4140, ['secondary', 'tertiary'], { side: -1, tod: 21.5 });
  street('city_night_cbd', 'CBD at 21:30 from the pavement.', 39.9087, 116.4565, ['trunk', 'primary'], { pitch: 14, fov: 65, tod: 21.5 });
  air('city_street', 'Street level in the old city.', 39.9005, 116.4140, 60, 3, 90, 60);
}
