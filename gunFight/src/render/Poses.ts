import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { registerPose } from '../debug/Poses';
import type { LevelApi, PlayerApi } from '../game/Contracts';
import type { Sky } from './Sky';
import type { PostFx } from './PostFx';

/** Run `fn` right before the next pose is applied (undoes pose-local state such as time of day / bypass). */
function onNextPose(fn: () => void): void {
  const orig = window.__shot;
  if (!orig) return;
  window.__shot = async (name: string) => { window.__shot = orig; fn(); return orig(name); };
}

function yawTowards(from: THREE.Vector3, to: THREE.Vector3): number {
  // Player forward is (-sin yaw, 0, -cos yaw).
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function place(engine: Engine, feet: THREE.Vector3, yaw: number, pitch: number): void {
  const player = engine.get<PlayerApi>('player');
  if (player) player.teleport(feet, yaw, pitch);
  else {
    const c = engine.camera; c.position.copy(feet).add(new THREE.Vector3(0, 0.78, 0));
    c.rotation.set(0, 0, 0, 'YXZ'); c.rotation.y = yaw; c.rotation.x = pitch;
  }
}

export function registerRenderPoses(engine: Engine, sky: Sky, postfx: PostFx | null): void {
  const lm = () => engine.get<LevelApi>('level')?.landmarks ?? {};
  const vista = (): { position: THREE.Vector3; yaw: number; pitch: number } => {
    const l = lm();
    const pick = l.vista ?? l.street ?? l.overview ?? Object.values(l)[0];
    if (pick) return { position: pick.position.clone(), yaw: pick.yaw, pitch: pick.pitch };
    const from = new THREE.Vector3(-26, 1, 27); const to = new THREE.Vector3(2, 0.5, -8);
    return { position: from, yaw: yawTowards(from, to), pitch: -0.04 };
  };
  const setDay = async () => { if (sky.state.tod !== 'day') await sky.setTimeOfDay('day'); };

  registerPose({
    name: 'render_lighting', description: 'Wide vista: sun, cascaded shadows, AO, aerial perspective',
    settleFrames: 30,
    apply: async () => { await setDay(); if (postfx) postfx.bypass = false; const v = vista(); place(engine, v.position, v.yaw, v.pitch); },
  });
  registerPose({
    name: 'render_shadow_detail', description: 'Close view of contact shadows / AO under a prop',
    settleFrames: 30,
    apply: async () => {
      await setDay(); if (postfx) postfx.bypass = false;
      const l = lm();
      if (l.shadow_detail) { place(engine, l.shadow_detail.position.clone(), l.shadow_detail.yaw, l.shadow_detail.pitch); return; }
      // Drum cluster on the sidewalk next to the street landmark: contact shadow + AO against the wall.
      const from = new THREE.Vector3(-5.0, 1.1, 15.9); const to = new THREE.Vector3(-7.7, 0.25, 13.2);
      place(engine, from, yawTowards(from, to), -0.34);
    },
  });
  registerPose({
    name: 'render_dusk', description: 'Alternative time of day (industrial sunset), looking into the sun',
    settleFrames: 30,
    apply: async () => {
      await sky.setTimeOfDay('dusk'); if (postfx) postfx.bypass = false;
      // Rooftop (open horizon) looking towards the low sun: halo, god rays and long shadows in frame.
      const l = lm(); const v = l.rooftop ?? vista();
      const s = sky.state.sunDir; const sunYaw = Math.atan2(-s.x, -s.z);
      // Pitch is anchored to the sun and puts it ~66% DOWN the frame, i.e. low, with the sky above it.
      // It used to sit at 28% down (pitch below the horizon), which framed the skyline across the whole
      // upper half - and once the skyline grew, *every* pixel above it was hazed building rather than
      // sky, so the cloud layer had nothing to draw on and the top 40% of the frame was a flat cream
      // field. Measured with a sky-mask test (force the cloud layer opaque and diff): at the old pitch
      // no pixel in the frame was sky; at the new one the sky mask is ~45% of it.
      // ref_07 and ref_10 both put the sun low against a structured sky, not high against a skyline.
      const sunElev = Math.asin(THREE.MathUtils.clamp(s.y, -1, 1));
      const half = Math.tan(THREE.MathUtils.degToRad(engine.camera.fov) * 0.5);
      const pitch = THREE.MathUtils.clamp(sunElev + Math.atan(0.32 * half), -0.05, 0.42);
      place(engine, v.position.clone(), l.rooftop ? sunYaw : THREE.MathUtils.lerp(v.yaw, sunYaw, 0.45), pitch);
      onNextPose(() => { void sky.setTimeOfDay('day'); });
    },
  });
  registerPose({
    name: 'render_post_off', description: 'render_lighting with the post chain bypassed (A/B)',
    settleFrames: 30,
    apply: async () => {
      await setDay();
      const v = vista(); place(engine, v.position, v.yaw, v.pitch);
      if (postfx) { postfx.bypass = true; onNextPose(() => { postfx.bypass = false; }); }
    },
  });
}
