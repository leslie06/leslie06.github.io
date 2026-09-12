import type { Engine } from '../core/Engine';
import { getPose, listPoses } from './PoseRegistry';

declare global {
  interface Window {
    __gameReady?: boolean;
    __shot?: (pose: string) => Promise<{ ok: boolean; error?: string }>;
    __poses?: () => string[];
    __engine?: Engine;
    __stats?: () => { calls: number; triangles: number; textures: number; geometries: number; programs: number };
  }
}

export const shotMode = new URLSearchParams(location.search).has('shot');

/** Deterministic capture: manual ticking at a fixed dt, so every run lands on the same frame. */
export function installShotMode(engine: Engine): void {
  engine.stop();
  // Frames advance at a fixed dt but CSS transitions run on the wall clock, so a HUD element that
  // just faded in would be captured half-transparent. Shots get the resting state.
  const st = document.createElement('style');
  st.textContent = '*{transition:none!important;animation:none!important}';
  document.head.appendChild(st);
  window.__engine = engine;
  window.__poses = listPoses;
  window.__stats = () => ({ calls: engine.renderer.info.render.calls, triangles: engine.renderer.info.render.triangles, textures: engine.renderer.info.memory.textures, geometries: engine.renderer.info.memory.geometries, programs: engine.renderer.info.programs?.length ?? 0 });
  window.__shot = async (name: string) => {
    const pose = getPose(name);
    if (!pose) return { ok: false, error: `unknown pose ${name}; have ${listPoses().join(', ')}` };
    try {
      engine.paused = false;
      await pose.apply(engine);
      for (let i = 0; i < (pose.animateFrames ?? 0); i++) engine.tick(1 / 60);
      engine.paused = true;
      for (let i = 0; i < (pose.settleFrames ?? 2); i++) engine.tick(1 / 60);
      engine.paused = false;
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e as Error)?.stack ?? e) }; }
  };
  for (let i = 0; i < 3; i++) engine.tick(1 / 60);
  window.__gameReady = true;
}
