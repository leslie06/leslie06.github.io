import { Engine } from './core/Engine';
import { installShotMode, shotMode } from './debug/ShotMode';
import * as render from './render';
import * as world from './world';
import * as player from './player';
import * as weapons from './weapons';
import * as enemies from './enemies';
import * as fx from './fx';
import * as audio from './audio';
import * as ui from './ui';
import * as game from './game';

/**
 * Boot order matters:
 *   render (sky/env/post) -> world (level geometry + static colliders) -> player -> weapons ->
 *   enemies -> fx -> audio -> ui -> game.
 * Each module's `install` may only depend on modules earlier in this list (via engine.get).
 */
async function boot() {
  const container = document.getElementById('app')!;
  const engine = new Engine(container);
  await engine.physics.init();
  await render.install(engine);
  await world.install(engine);
  await player.install(engine);
  await weapons.install(engine);
  await enemies.install(engine);
  await fx.install(engine);
  await audio.install(engine);
  await ui.install(engine, container);
  await game.install(engine);
  engine.resize();
  if (shotMode) installShotMode(engine);
  else engine.start();
}

boot().catch((e) => { console.error(e); document.body.innerHTML = `<pre style="color:#f66;padding:20px;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`; });
