import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CameraApi, HudApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { FxApi } from '../fx';
import type { UiApi } from '../ui';
import { PathPilot } from '../vehicle/Autopilot';
import { STRIP } from '../world/Layout';
import { registerPose } from '../debug/PoseRegistry';
import type { RenderSystem } from './RenderSystem';

/**
 * Time-of-day screenshot poses: the yard at dawn, noon, 17:30 golden hour, 19:30 blue hour, 22:00
 * night, and 22:00 in heavy rain, each from the chase camera (~100 km/h down the strip) and from one
 * wide view (east side of the yard, 10 m up, looking west-south-west: the low sun, the strip, the
 * figure-eight and the CBD in the haze). Each pose restores the boot time and dry weather before
 * the next pose runs, so the other modules' poses are unaffected.
 */
const CONDITIONS: { id: string; hour: number; rain: number; label: string }[] = [
  { id: 'dawn', hour: 6.0, rain: 0, label: 'dawn, 06:00' },
  { id: 'noon', hour: 12.5, rain: 0, label: 'noon, 12:30' },
  { id: 'golden', hour: 17.5, rain: 0, label: 'golden hour, 17:30' },
  { id: 'blue', hour: 19.5, rain: 0, label: 'blue hour, 19:30' },
  { id: 'night', hour: 22.0, rain: 0, label: 'night, 22:00' },
  { id: 'rain', hour: 22.0, rain: 1, label: 'night in heavy rain, 22:00' },
];

/** Run `fn` right before the next pose is applied. */
function onNextPose(fn: () => void): void {
  const orig = window.__shot;
  if (!orig) return;
  window.__shot = async (name: string) => { window.__shot = orig; fn(); return orig(name); };
}

function base(e: Engine) {
  const v = e.get<VehicleApi>('vehicle')!;
  const cam = e.get<CameraApi>('camera')!;
  const ui = e.get<UiApi>('ui')!;
  const hud = e.get<HudApi>('hud')!;
  const fx = e.get<FxApi>('fx')!;
  const world = e.get<WorldApi>('world')!;
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement | null)?.setAttribute('hidden', '');
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null;
  v.inputEnabled = false;
  cam.override = null;
  cam.mode = 'chase';
  fx.clear();
  v.drift.lastAt = -99; v.drift.active = false; v.drift.score = 0;
  return { v, world };
}

/** Advance `seconds`; only the last `render` seconds are drawn. */
function run(e: Engine, seconds: number, render = 1.5): void {
  const dt = 1 / 60;
  const fast = Math.max(0, Math.round((seconds - render) * 60));
  for (let i = 0; i < fast; i++) {
    e.stepFixed(dt);
    for (const s of e.systems) if (s.name === 'vehicle' || s.name === 'fx') s.update?.(dt, 0);
  }
  for (let i = 0; i < Math.round(render * 60); i++) e.tick(dt);
}

function fixedCam(e: Engine, pos: THREE.Vector3Like, look: THREE.Vector3Like, fov: number): void {
  e.get<CameraApi>('camera')!.override = (c) => {
    c.position.set(pos.x, pos.y, pos.z);
    c.lookAt(look.x, look.y, look.z);
    c.fov = fov; c.updateProjectionMatrix();
  };
}

/**
 * Wet the yard's ground for the rain poses. world/ does not opt its materials in yet
 * (`userData.wet`); until it does, the pose marks every flat, wide lit surface (asphalt, grass,
 * paint, lettering) so the wet look can be judged. With uWet at 0 the patch is a no-op, so leaving
 * the flag set after the pose changes nothing in dry poses.
 */
function wetTheGround(e: Engine): void {
  const box = new THREE.Box3(), size = new THREE.Vector3();
  e.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (Array.isArray(mat) || !mat?.isMeshStandardMaterial || mat.userData.wet !== undefined) return;
    box.setFromObject(m).getSize(size);
    if (size.y < 0.4 && size.x * size.z > 4) mat.userData.wet = 'ground';
  });
}

export function registerRenderPoses(engine: Engine): void {
  // The poses are laid out on the M0 yard (world/Layout); the city has its own poses.
  if ((new URLSearchParams(location.search).get('world') ?? 'yard') !== 'yard') return;
  const render = () => engine.get<RenderSystem>('render')!;
  const setup = (hour: number, rain: number) => {
    const r = render();
    r.timeScale = 0;
    r.timeOfDay = hour;
    r.rain = rain;
    if (rain > 0) { wetTheGround(engine); r.prepare(engine.scene); }
    r.settle();
    onNextPose(() => { const rr = render(); rr.timeOfDay = rr.defaultTime; rr.rain = 0; rr.settle(); });
  };
  for (const c of CONDITIONS) {
    registerPose({
      name: `tod_${c.id}_chase`, description: `Chase camera at ~100 km/h down the strip, ${c.label}.`,
      apply(e) {
        const { v, world } = base(e);
        setup(c.hour, c.rain);
        v.reset({ x: STRIP.x, y: world.spawn.y, z: STRIP.z0 + 12 }, 0);
        const path: [number, number][] = [];
        for (let z = STRIP.z0; z <= STRIP.z1; z += 2) path.push([STRIP.x, z]);
        v.autopilot = new PathPilot(path, { speed: 29, lookahead: 14, closed: false });
        run(e, 7.5);
      },
    });
    registerPose({
      name: `tod_${c.id}_wide`, description: `Wide view across the yard towards the CBD, ${c.label}.`,
      apply(e) {
        const { v, world } = base(e);
        setup(c.hour, c.rain);
        v.reset({ x: 181, y: world.spawn.y, z: -139 }, 1.9);
        run(e, 1, 0.3);
        fixedCam(e, { x: 200, y: 10, z: -150 }, { x: -26, y: 3, z: -44 }, 55);
        run(e, 0.5, 0.5);
      },
    });
  }
}
