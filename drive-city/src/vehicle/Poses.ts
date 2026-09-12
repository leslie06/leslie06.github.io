import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CameraApi, CarLook, HudApi, TrafficCars, VehicleApi, WorldApi } from '../game/Contracts';
import { Vehicle } from './Vehicle';
import type { RenderSystem } from '../render';
import type { UiApi } from '../ui';
import { registerPose } from '../debug/PoseRegistry';
import { BODY_TYPES, type BodyType } from './Bodies';
import { buildCar, defaultLivery, POLICE_LIVERY, type CarModel } from './CarModel';
import { SPEC_OF } from './Spec';

/**
 * Poses for the cars themselves: a lineup of every body type, close-ups of the player's taxi by day
 * and night, and the traffic mix at chase-camera distance. The lineup builds full-detail models of
 * its own and drops them when the next pose starts.
 */
let display: { group: THREE.Group; models: CarModel[] } | null = null;

function clearDisplay(e: Engine): void {
  if (!display) return;
  e.scene.remove(display.group);
  for (const m of display.models) m.dispose();
  display = null;
}

async function base(e: Engine, tod?: number) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, world = e.get<WorldApi>('world')!;
  const ui = e.get<UiApi>('ui'), hud = e.get<HudApi>('hud'), render = e.get<RenderSystem>('render')!;
  if (ui) ui.state = 'playing';
  const menu = document.querySelector('.menu') as HTMLElement | null;
  if (menu) menu.hidden = true;
  hud?.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null; v.inputEnabled = false; cam.override = null;
  clearDisplay(e);
  render.timeOfDay = tod ?? render.defaultTime;
  render.settle();
  v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
  await world.preload?.(world.spawn.x, world.spawn.z);
  const yaw = world.spawn.yaw;
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const at = new THREE.Vector3(world.spawn.x, world.spawn.y, world.spawn.z);
  return { v, cam, world, render, yaw, fwd, left, at, road: world.spawn.y - SPEC_OF.sedan.wheelRadius };
}

const look2 = (e: Engine, pos: THREE.Vector3, target: THREE.Vector3, fov = 45) => look(e, pos, target, fov);

function look(e: Engine, pos: THREE.Vector3, target: THREE.Vector3, fov = 45): void {
  const cam = e.get<CameraApi>('camera')!;
  cam.override = (c) => { c.position.copy(pos); c.lookAt(target); c.fov = fov; c.updateProjectionMatrix(); };
}

/** Render `frames` at a fixed step (physics keeps running: traffic and lights move). */
function run(e: Engine, frames: number): void { for (let i = 0; i < frames; i++) e.tick(1 / 60); }
function simulate(e: Engine, seconds: number): void { for (let i = 0; i < seconds * 60; i++) e.stepFixed(1 / 60); }

/** Park a full-detail model of every body type across the road, plus a police car. */
function lineup(e: Engine, origin: THREE.Vector3, fwd: THREE.Vector3, left: THREE.Vector3, road: number, night: boolean): number {
  const group = new THREE.Group();
  const models: CarModel[] = [];
  const list: [BodyType, boolean][] = [...BODY_TYPES.map((t) => [t, false] as [BodyType, boolean]), ['sedan', true]];
  let offset = 0;
  const widths = list.map(([t]) => (t === 'bus' ? 2.6 : t === 'truck' ? 2.1 : 1.9));
  const total = widths.reduce((a, w) => a + w + 0.9, -0.9);
  offset = -total / 2;
  list.forEach(([t, police], i) => {
    const spec = SPEC_OF[t];
    const car = buildCar(spec, police ? POLICE_LIVERY : defaultLivery(t), t);
    car.setLights({ brake: false, reverse: false, head: night });
    if (police) car.setBeacons(8, 0.3);
    else if (t !== 'sedan') car.setPaint(new THREE.Color(t === 'bus' ? '#f2f1ea' : t === 'truck' ? '#e9ebea' : ['#f2f2ef', '#26344f', '#8c1d1d'][i % 3]), new THREE.Color(t === 'bus' ? '#c3232b' : t === 'truck' ? '#f4f5f4' : ['#f2f2ef', '#26344f', '#8c1d1d'][i % 3]), t === 'bus' || t === 'truck');
    const p = origin.clone().addScaledVector(left, offset + widths[i] / 2);
    car.root.position.set(p.x, road + spec.wheelRadius, p.z);
    car.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z));
    group.add(car.root);
    models.push(car);
    offset += widths[i] + 0.9;
  });
  e.scene.add(group);
  e.get<RenderSystem>('render')?.prepare(group);
  display = { group, models };
  return total;
}

export function registerVehiclePoses(): void {
  registerPose({
    name: 'veh_lineup', description: 'Every body type (sedan, hatch, SUV, MPV, bus, truck) and a police car, three-quarter front.',
    async apply(e) {
      const { fwd, left, at, road } = await base(e);
      const origin = at.clone().addScaledVector(fwd, 52);
      const total = lineup(e, origin, fwd, left, road, false);
      look(e, origin.clone().addScaledVector(fwd, total * 1.15).addScaledVector(left, -total * 0.18).setY(road + 7.2), origin.clone().setY(road + 1.0), 36);
      run(e, 4);
    },
  });
  registerPose({
    name: 'veh_lineup_night', description: 'The same lineup at 22:00 with lamps lit.',
    async apply(e) {
      const { fwd, left, at, road } = await base(e, 22);
      const origin = at.clone().addScaledVector(fwd, 52);
      const total = lineup(e, origin, fwd, left, road, true);
      look(e, origin.clone().addScaledVector(fwd, total * 1.15).addScaledVector(left, -total * 0.18).setY(road + 7.2), origin.clone().setY(road + 1.0), 36);
      run(e, 4);
    },
  });
  registerPose({
    name: 'veh_taxi_front', description: 'The player taxi, low three-quarter front.',
    async apply(e) {
      const { v, fwd, left, road } = await base(e);
      run(e, 30);
      const p = v.renderPos;
      look(e, p.clone().addScaledVector(fwd, 5.4).addScaledVector(left, 3.6).setY(road + 1.15), p.clone().addScaledVector(fwd, 0.2).setY(road + 0.75), 36);
      run(e, 3);
    },
  });
  registerPose({
    name: 'veh_taxi_rear', description: 'The player taxi from behind: tail lights, boot, wheels.',
    async apply(e) {
      const { v, fwd, left, road } = await base(e);
      run(e, 30);
      const p = v.renderPos;
      look(e, p.clone().addScaledVector(fwd, -5.2).addScaledVector(left, -3.2).setY(road + 1.25), p.clone().addScaledVector(fwd, -0.4).setY(road + 0.8), 36);
      run(e, 3);
    },
  });
  registerPose({
    name: 'veh_taxi_night', description: 'The player taxi at 22:00: headlamps, roof sign, tail lights.',
    async apply(e) {
      const { v, fwd, left, road } = await base(e, 22);
      run(e, 30);
      const p = v.renderPos;
      look(e, p.clone().addScaledVector(fwd, 6.0).addScaledVector(left, 3.4).setY(road + 1.1), p.clone().addScaledVector(fwd, 0.2).setY(road + 0.8), 36);
      run(e, 3);
    },
  });
  registerPose({
    name: 'veh_swap_bus', description: 'The player takes a bus: swapCar rebuilds the full-detail model for that body.',
    async apply(e) {
      const { v, fwd, left, at, road } = await base(e);
      const pos = at.clone().addScaledVector(fwd, 14);
      const bus = new Vehicle(e.physics, SPEC_OF.bus, { x: pos.x, y: road + SPEC_OF.bus.wheelRadius + 0.05, z: pos.z }, Math.atan2(fwd.x, fwd.z));
      const look: CarLook = { upper: new THREE.Color('#f2f1ea'), lower: new THREE.Color('#c3232b'), taxi: true, body: 'bus' };
      const prev = v.swapCar(bus, look);
      e.get<TrafficCars>('traffic')?.parkCar(prev.car, prev.look);
      run(e, 40);
      const p = v.renderPos;
      look2(e, p.clone().addScaledVector(fwd, -12).addScaledVector(left, -7).setY(road + 4.6), p.clone().addScaledVector(fwd, 1).setY(road + 1.5), 46);
      run(e, 3);
    },
  });
  registerPose({
    name: 'veh_traffic_mix', description: 'The traffic mix on the avenue after 30 s, from chase-camera height.',
    async apply(e) {
      const { fwd, left, at, road } = await base(e);
      const eye = at.clone().addScaledVector(fwd, -9).addScaledVector(left, -2.2).setY(road + 2.6);
      look(e, eye, at.clone().addScaledVector(fwd, 40).setY(road + 1.4), 55);
      e.tick(1 / 60);
      simulate(e, 30);
      run(e, 30);
    },
  });
  registerPose({
    name: 'veh_traffic_night', description: 'The traffic mix at 22:00: headlamps and tail lights down the avenue.',
    async apply(e) {
      const { fwd, left, at, road } = await base(e, 22);
      const eye = at.clone().addScaledVector(fwd, -9).addScaledVector(left, -2.2).setY(road + 2.6);
      look(e, eye, at.clone().addScaledVector(fwd, 40).setY(road + 1.4), 55);
      e.tick(1 / 60);
      simulate(e, 30);
      run(e, 30);
    },
  });
}
