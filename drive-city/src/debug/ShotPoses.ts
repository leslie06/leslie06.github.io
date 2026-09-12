import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { FxApi } from '../fx';
import type { UiApi } from '../ui';
import { attractPilot } from '../ui';
import { PathPilot } from '../vehicle/Autopilot';
import { FIGURE8, JUMP, OFFICE, STRIP, YARD } from '../world/Layout';
import { registerPose } from './PoseRegistry';

/**
 * Screenshot poses for `node scripts/shot.mjs`. Every pose starts from a clean yard (car reset, no
 * marks, no pilot) so they can run in any order. Long drives fast-forward physics without
 * rendering, then render the last second and a half so the camera, smoke and lean have settled.
 */
function base(e: Engine) {
  const v = e.get<VehicleApi>('vehicle')!;
  const cam = e.get<CameraApi>('camera')!;
  const ui = e.get<UiApi>('ui')!;
  const hud = e.get<HudApi>('hud')!;
  const fx = e.get<FxApi>('fx')!;
  const world = e.get<WorldApi>('world')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null;
  v.inputEnabled = false;
  cam.override = null;
  cam.mode = 'chase';
  fx.clear();
  // A drift banked in the previous pose would still be on the HUD.
  v.drift.lastAt = -99; v.drift.active = false; v.drift.score = 0;
  return { v, cam, ui, hud, fx, world };
}

/** Advance `seconds` of simulation; only the last `render` seconds are drawn. */
function run(e: Engine, seconds: number, render = 1.5): void {
  const dt = 1 / 60;
  const fast = Math.max(0, Math.round((seconds - render) * 60));
  for (let i = 0; i < fast; i++) {
    e.stepFixed(dt);
    // Keep interpolated pose and particles moving without paying for a render.
    for (const s of e.systems) if (s.name === 'vehicle' || s.name === 'fx') s.update?.(dt, 0);
  }
  for (let i = 0; i < Math.round(render * 60); i++) e.tick(dt);
}

function fixedCam(e: Engine, pos: THREE.Vector3Like, look: THREE.Vector3Like | (() => THREE.Vector3), fov = 50): void {
  const cam = e.get<CameraApi>('camera')!;
  cam.override = (c) => {
    c.position.set(pos.x, pos.y, pos.z);
    const l = typeof look === 'function' ? look() : look;
    c.lookAt(l.x, l.y, l.z);
    c.fov = fov; c.updateProjectionMatrix();
  };
}

function straight(x: number, z0: number, z1: number): [number, number][] {
  const p: [number, number][] = [];
  for (let z = z0; z <= z1; z += 2) p.push([x, z]);
  return p;
}

export function registerPoses(): void {
  registerPose({
    name: 'hero', description: 'Taxi parked by the gate, low three-quarter front view.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: 6, y: world.spawn.y, z: -196 }, 0.5);
      run(e, 1.5, 0.5);
      const p = v.renderPos;
      fixedCam(e, { x: p.x + 5.2, y: 1.1, z: p.z + 5.6 }, { x: p.x, y: 0.55, z: p.z + 0.3 }, 38);
      run(e, 0.1, 0.1);
    },
  });
  registerPose({
    name: 'chase', description: 'Chase camera at ~100 km/h down the strip.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: STRIP.x, y: world.spawn.y, z: STRIP.z0 + 12 }, 0);
      v.autopilot = new PathPilot(straight(STRIP.x, STRIP.z0, STRIP.z1), { speed: 29, lookahead: 14, closed: false });
      run(e, 7.5);
    },
  });
  registerPose({
    name: 'drift', description: 'Mid-drift on the figure-eight, chase camera, smoke and marks.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: FIGURE8.cx, y: world.spawn.y, z: FIGURE8.cz }, Math.PI / 2);
      v.autopilot = attractPilot();
      run(e, 23.2, 2);
    },
  });
  registerPose({
    name: 'drift_side', description: 'The same drift seen from outside the circle.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: FIGURE8.cx, y: world.spawn.y, z: FIGURE8.cz }, Math.PI / 2);
      v.autopilot = attractPilot();
      run(e, 21.5, 0.2);
      fixedCam(e, { x: FIGURE8.cx + 46, y: 4.5, z: FIGURE8.cz + 10 }, () => v.renderPos.clone().add(new THREE.Vector3(0, 0.5, 0)), 34);
      run(e, 1.7, 1.7);
    },
  });
  registerPose({
    name: 'marks_top', description: 'Top-down over the figure-eight after a minute of drifting.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: FIGURE8.cx, y: world.spawn.y, z: FIGURE8.cz }, Math.PI / 2);
      v.autopilot = attractPilot();
      run(e, 60, 0.2);
      fixedCam(e, { x: FIGURE8.cx + 0.1, y: 120, z: FIGURE8.cz - 2 }, { x: FIGURE8.cx, y: 0, z: FIGURE8.cz }, 42);
      run(e, 0.1, 0.1);
    },
  });
  registerPose({
    name: 'jump', description: 'Airborne off the kicker at 80 km/h, side view.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: JUMP.x, y: world.spawn.y, z: JUMP.z - 70 }, 0);
      v.autopilot = new PathPilot(straight(JUMP.x, JUMP.z - 80, JUMP.z + 120), { speed: 23, lookahead: 12, closed: false });
      run(e, 6.1, 0.3);
      fixedCam(e, { x: JUMP.x - 22, y: 2.2, z: JUMP.z + 10 }, () => v.renderPos, 40);
      run(e, 0.35, 0.35);
    },
  });
  registerPose({
    name: 'skyline', description: 'From the yard towards the CBD in the haze.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: -40, y: world.spawn.y, z: 150 }, -0.4);
      run(e, 1, 0.3);
      fixedCam(e, { x: -32, y: 1.7, z: 140 }, { x: -600, y: 180, z: 2200 }, 55);
      run(e, 0.1, 0.1);
    },
  });
  registerPose({
    name: 'yard', description: 'Aerial over the whole yard.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, 0);
      run(e, 1, 0.3);
      fixedCam(e, { x: 160, y: 170, z: -330 }, { x: -20, y: 0, z: 10 }, 50);
      run(e, 0.1, 0.1);
    },
  });
  registerPose({
    name: 'office', description: 'Office, parked training cars, hoarding.',
    apply(e) {
      const { v, world } = base(e);
      v.reset({ x: OFFICE.x + 30, y: world.spawn.y, z: OFFICE.z + 16 }, -2.4);
      run(e, 1, 0.3);
      fixedCam(e, { x: OFFICE.x + 42, y: 4, z: OFFICE.z + 32 }, { x: OFFICE.x + 6, y: 3, z: OFFICE.z }, 50);
      run(e, 0.1, 0.1);
    },
  });
  registerPose({
    name: 'ui_hud', description: 'HUD while drifting.',
    apply(e) {
      const { v, hud, world } = base(e);
      hud.setVisible(true);
      v.reset({ x: FIGURE8.cx, y: world.spawn.y, z: FIGURE8.cz }, Math.PI / 2);
      v.autopilot = attractPilot();
      run(e, 23.2, 2);
    },
  });
  registerPose({
    name: 'ui_menu', description: 'Title screen over the attract loop.',
    apply(e) {
      base(e);
      e.get<UiApi>('ui')!.showTitle();
      run(e, 14, 1.5);
    },
  });
  void YARD;
}
