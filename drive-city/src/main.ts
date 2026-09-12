import { Engine } from './core/Engine';
import { t } from './core/I18n';
import { installShotMode, shotMode } from './debug/ShotMode';
import { Diagnostics } from './debug/Diagnostics';
import { registerPoses } from './debug/ShotPoses';
import * as render from './render';
import * as weather from './weather';
import * as world from './world';
import * as city from './city';
import { registerCityPoses } from './city/Poses';
import { registerTrafficPoses } from './traffic/Poses';
import * as vehicle from './vehicle';
import * as player from './player';
import * as damage from './damage';
import * as traffic from './traffic';
import * as people from './people';
import { registerPeoplePoses } from './people/Poses';
import { registerCharacterPoses } from './character/Poses';
import * as nav from './nav';
import { registerNavPoses } from './nav/Poses';
import * as police from './police';
import { registerPolicePoses } from './police/Poses';
import { registerVehiclePoses } from './vehicle/Poses';
import * as missions from './missions';
import { registerMissionPoses } from './missions/Poses';
import * as races from './races';
import * as park from './park';
import { registerRacePoses } from './races/Poses';
import { registerTitlePose } from './ui/TitlePose';
import * as fx from './fx';
import * as audio from './audio';
import * as ui from './ui';

/**
 * Boot order: render -> world (yard or city) -> vehicle -> player (camera, on foot) -> traffic -> people -> fx -> audio -> ui.
 * A module's install may only `engine.get` modules earlier in this list.
 */
async function boot() {
  const container = document.getElementById('app')!;
  const loading = document.getElementById('loading');
  if (loading) loading.querySelector('b')!.textContent = t('title.loading');
  const engine = new Engine(container);
  await engine.physics.init();
  await render.install(engine);
  await weather.install(engine);
  // Central Beijing from OSM by default; ?world=yard is the M0 driving-school yard (handling sandbox).
  const worldName = new URLSearchParams(location.search).get('world') ?? 'city';
  if (worldName === 'city') await city.install(engine); else await world.install(engine);
  await vehicle.install(engine);
  await player.install(engine);
  await damage.install(engine);
  if (worldName === 'city') { await traffic.install(engine); await people.install(engine); }
  if (worldName === 'city') await nav.install(engine);
  if (worldName === 'city') { await police.install(engine); await missions.install(engine); await races.install(engine); await park.install(engine); }
  await fx.install(engine);
  await audio.install(engine);
  await ui.install(engine, container);
  if (worldName === 'city') { registerCityPoses(); registerTrafficPoses(); registerPeoplePoses(); registerCharacterPoses(); registerNavPoses(); registerPolicePoses(); registerVehiclePoses(); registerMissionPoses(); registerRacePoses(); registerTitlePose(); } else registerPoses();
  engine.resize();
  (window as unknown as { drivecity?: Engine }).drivecity = engine;
  engine.add(new Diagnostics(engine, container));
  engine.events.on('renderer:contextlost', () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:auto 0 0 0;padding:14px 18px;background:#b3261e;color:#fff;font:600 14px system-ui;z-index:99999';
    d.textContent = t('err.context');
    document.body.appendChild(d);
  });
  if (shotMode) installShotMode(engine);
  else engine.start();
  loading?.remove();
}

boot().catch((e) => { console.error(e); document.body.innerHTML = `<pre style="color:#f66;padding:20px;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`; });
