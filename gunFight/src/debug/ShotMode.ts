import type { Engine } from '../core/Engine';
import { getPose, listPoses } from './Poses';

declare global {
  interface Window {
    __gameReady?: boolean;
    __shot?: (pose: string) => Promise<{ ok: boolean; error?: string }>;
    __poses?: () => string[];
    __engine?: Engine;
    __stats?: () => { calls: number; triangles: number; textures: number; programs: number; fps: number };
  }
}

export const shotMode = new URLSearchParams(location.search).has('shot');

/**
 * Deterministic capture mode: manual ticking with a fixed dt so temporal effects (TAA, motion blur)
 * converge identically every run, and animations land on the same frame.
 */
export function installShotMode(engine: Engine): void {
  engine.stop();
  const hud = engine.get<{ name: string; setVisible(v: boolean): void }>('hud');
  hud?.setVisible(new URLSearchParams(location.search).has('hud'));
  window.__engine = engine;
  window.__poses = listPoses;
  window.__stats = () => ({ calls: engine.renderer.info.render.calls, triangles: engine.renderer.info.render.triangles, textures: engine.renderer.info.memory.textures, programs: engine.renderer.info.programs?.length ?? 0, fps: 0 });
  window.__shot = async (name: string) => {
    const pose = getPose(name);
    if (!pose) return { ok: false, error: `unknown pose ${name}; have ${listPoses().join(', ')}` };
    try {
      // Pose isolation: undo whatever the previous pose left behind (death camera, ADS, particles, enemies).
      engine.paused = false;
      const player = engine.get<{ name: string; respawn?: () => void }>('player');
      player?.respawn?.();
      const weapons = engine.get<{ name: string; setAim?: (a: boolean) => void; equip?: (i: number) => void }>('weapons');
      weapons?.setAim?.(false); weapons?.equip?.(0);
      engine.get<{ name: string; clearAll?: () => void }>('fx')?.clearAll?.();
      engine.get<{ name: string; killAll?: () => void }>('enemies')?.killAll?.();
      engine.tick(1 / 60);
      await pose.apply(engine);
      const anim = pose.animateFrames ?? 0;
      for (let i = 0; i < anim; i++) engine.tick(1 / 60);
      const settle = pose.settleFrames ?? 24;
      engine.paused = true;
      for (let i = 0; i < settle; i++) engine.tick(1 / 60);
      engine.paused = false;
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e as Error)?.stack ?? e) }; }
  };
  // Keep a slow idle loop so the page isn't frozen when inspected manually.
  for (let i = 0; i < 3; i++) engine.tick(1 / 60);
  window.__gameReady = true;
}
