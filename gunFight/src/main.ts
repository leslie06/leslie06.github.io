import { Engine } from './core/Engine';
import { installShotMode, shotMode } from './debug/ShotMode';
import { Diagnostics } from './debug/Diagnostics';
import * as render from './render';
import * as world from './world';
import * as player from './player';
import * as weapons from './weapons';
import * as enemies from './enemies';
import * as fx from './fx';
import * as audio from './audio';
import * as ui from './ui';
import * as game from './game';
import { bootBytes, bootDone, bootFraction, bootStage, bootTimings, type BootStage } from './core/BootProgress';

/**
 * Boot order matters:
 *   render (sky/env/post) -> world (level geometry + static colliders) -> player -> weapons ->
 *   enemies -> fx -> audio -> ui -> game.
 * Each module's `install` may only depend on modules earlier in this list (via engine.get).
 */
async function boot() {
  const container = document.getElementById('app')!;
  const engine = new Engine(container);

  // Loading bar: each stage's share is filled by the bytes that arrive while it runs (the stages
  // that download are the long ones). Counted from the stage's start so that the sky's HDRI, done
  // by then, does not hand the texture stage a head start it then sits on.
  let loaded0 = 0, total0 = 0;
  // The CPU-bound installs never return to the event loop, so without a yield the caption and bar
  // they were given would not be painted until the work they describe had finished. The timeout
  // is for a background tab, where rAF does not fire and boot would otherwise wait on it for ever.
  const paint = () => new Promise<void>((res) => { requestAnimationFrame(() => setTimeout(res, 0)); setTimeout(res, 60); });
  const stage = async (id: BootStage) => {
    loaded0 = engine.assets.progress.loadedBytes; total0 = engine.assets.progress.totalBytes;
    bootStage(id);
    await paint();
  };
  const part = async (f: number) => { bootFraction(f); await paint(); };
  engine.assets.onProgress = () => {
    const p = engine.assets.progress;
    bootBytes(p.loadedBytes - loaded0, p.totalBytes - total0, p.loadedBytes, p.totalBytes);
  };

  // Per-module install time, next to the per-stage numbers in `window.gunfightBoot`.
  const modules: Record<string, number> = {};
  const timed = async (name: string, run: () => Promise<unknown>) => {
    const t0 = performance.now();
    await run();
    modules[name] = Math.round(performance.now() - t0);
  };

  await stage('physics');
  await timed('physics', () => engine.physics.init());
  await stage('sky');
  await timed('render', () => render.install(engine));
  await stage('world');
  await timed('world', () => world.install(engine));
  await stage('actors');
  await timed('player', () => player.install(engine));
  await timed('weapons', () => weapons.install(engine));
  await part(0.45);
  await timed('enemies', () => enemies.install(engine));
  await stage('systems');
  await timed('fx', () => fx.install(engine));
  await part(0.75);
  await timed('audio', () => audio.install(engine));
  await timed('ui', () => ui.install(engine, container));
  await timed('game', () => game.install(engine));
  engine.assets.onProgress = null;
  engine.resize();
  // Always expose the engine, not just in shot mode. Several real bugs (wave progression, phantom
  // auto-fire) could only be reproduced in a normal session, and without a handle there was no way
  // to inspect one from a headless driver. Read-only by convention; nothing ships against it.
  (window as unknown as { gunfight?: unknown; gunfightBoot?: unknown }).gunfight = engine;
  (window as unknown as { gunfightBoot?: unknown }).gunfightBoot = { stages: bootTimings, modules };
  engine.add(new Diagnostics(engine, container));
  if (shotMode) { installShotMode(engine); bootDone(); ui.hideLoading(true); return; }

  // Compile the level's programs before the first draw. With KHR_parallel_shader_compile this does
  // not block, so the loading screen stays alive instead of the tab freezing on frame one; the
  // frames after it (texture uploads, the post chain's own programs) are drawn behind the screen too.
  await stage('shaders');
  try {
    await engine.renderer.compileAsync(engine.scene, engine.camera);
    await engine.renderer.compileAsync(engine.viewmodelScene, engine.viewmodelCamera);
  } catch (e) { console.warn('[gunfight] shader warm-up skipped', e); }
  engine.start();
  const first = engine.frame;
  await new Promise<void>((res) => {
    const wait = () => (engine.frame - first >= 3 || engine.contextLost ? res() : requestAnimationFrame(wait));
    requestAnimationFrame(wait);
  });
  bootDone();
  ui.hideLoading();
}

boot().catch((e) => { console.error(e); document.body.innerHTML = `<pre style="color:#f66;padding:20px;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`; });
