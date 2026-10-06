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
import { readyBodies, type BodySource } from './vehicle/Bodies';
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
import * as stunts from './stunts';
import * as garage from './garage';
import * as intro from './intro';
import * as collect from './collect';
import * as checkin from './checkin';
import * as trials from './trials';
import * as events from './events';
import * as npc from './npc';
import * as life from './life';
import * as contacts from './contacts';
import * as dialogue from './dialogue';
import * as story from './story';
import * as leaderboard from './online/Leaderboard';
import * as underground from './underground';
import * as park from './park';
import { registerParkPoses } from './park/Poses';
import * as home from './home';
import { registerHomePoses } from './home/Poses';
import { registerRacePoses } from './races/Poses';
import { registerTitlePose } from './ui/TitlePose';
import * as fx from './fx';
import * as audio from './audio';
import * as voices from './voice';
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
  // The Blender car bodies are their own chunks (~1.3 MB gzipped): fetched alongside the physics, render and city
  // setup, needed from the vehicle on (and by the yard's parked coach). Awaiting them before the city serialised
  // the two downloads: +12 s to playable at 500 KB/s.
  // The saloon and the wheels before the world, and the body of the player's saved car (the garage's or
  // the one parked at home); the other bodies after the spawn's tiles (below).
  const saved: BodySource[] = [];
  for (const [key, pick] of [['drivecity.garage.v1', (j: { body?: string }) => j.body], ['drivecity.home.v1', (j: { car?: { body?: string } }) => j.car?.body]] as const) {
    try { const b = (pick as (j: unknown) => string | undefined)(JSON.parse(localStorage.getItem(key) ?? 'null') ?? {}); if (b && b !== 'sedan' && ['hatch', 'suv', 'mpv', 'bus', 'truck'].includes(b)) saved.push(b as BodySource); } catch { /* no save */ }
  }
  const bodies = readyBodies(shotMode ? undefined : ['sedan', 'wheels', ...saved]);
  await engine.physics.init();
  await render.install(engine);
  await weather.install(engine);
  // Central Beijing from OSM by default; ?world=yard is the M0 driving-school yard (handling sandbox).
  const worldName = new URLSearchParams(location.search).get('world') ?? 'city';
  if (worldName === 'city') await city.install(engine); else { await readyBodies(); await world.install(engine); }
  await bodies;
  // the rest of the bodies now the spawn's tiles are in (traffic adds their cars as they arrive)
  void readyBodies();
  await vehicle.install(engine);
  await player.install(engine);
  await damage.install(engine);
  if (worldName === 'city') { await traffic.install(engine); await people.install(engine); await dialogue.install(engine); }
  if (worldName === 'city') await nav.install(engine);
  if (worldName === 'city') { await police.install(engine); await missions.install(engine); await races.install(engine); await park.install(engine); await home.install(engine); await garage.install(engine); await underground.install(engine); await stunts.install(engine); await collect.install(engine); await checkin.install(engine); await trials.install(engine); await intro.install(engine); await events.install(engine); await npc.install(engine); await life.install(engine); await contacts.install(engine); leaderboard.install(engine); await story.install(engine); }
  await fx.install(engine);
  await audio.install(engine);
  if (worldName === 'city') await voices.install(engine);
  await ui.install(engine, container);
  if (worldName === 'city') { registerCityPoses(); registerTrafficPoses(); registerPeoplePoses(); registerCharacterPoses(); registerNavPoses(); registerPolicePoses(); registerVehiclePoses(); registerMissionPoses(); registerRacePoses(); registerParkPoses(); registerHomePoses(); registerTitlePose(); } else registerPoses();
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
