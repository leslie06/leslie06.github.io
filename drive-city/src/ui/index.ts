import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import type { CameraApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { AudioApi } from '../audio';
import type { FxApi } from '../fx';
import { onLangChange, t } from '../core/I18n';
import { PathPilot, figureEight } from '../vehicle/Autopilot';
import { FIGURE8 } from '../world/Layout';
import { Hud } from './Hud';
import { Menu, type MenuState } from './Menu';
import { Minimap } from './Minimap';
import { MapScreen } from './MapScreen';

export interface UiApi extends System {
  state: MenuState;
  /** Title screen with the attract loop (the taxi drifting the figure-eight). */
  showTitle(): void;
  start(): void;
  pause(): void;
}

/** A figure-eight drift pilot starting at the pad's crossing, for the title screen and the shots. */
export function attractPilot(): PathPilot {
  const per = 120;
  return new PathPilot(figureEight(FIGURE8.cx, FIGURE8.cz, FIGURE8.r, per), {
    speed: 13, lookahead: 10, closed: true,
    drift: { tap: 0.32, slip: 0.4, rekick: 0.2, entries: [6, per + 6], kickZones: [[16, per - 14], [per + 16, 2 * per - 14]] },
  });
}

export async function install(engine: Engine, container: HTMLElement): Promise<void> {
  const hud = new Hud(engine, container);
  const menu = new Menu(engine, container);
  engine.add(hud);
  // Radar and full-screen map (city only; before `api` so the map's Esc/Tab handling runs first).
  if (engine.get('nav')) { engine.add(new Minimap(engine, hud.root)); engine.add(new MapScreen(engine, container)); }
  const v = () => engine.get<VehicleApi>('vehicle')!;
  const cam = () => engine.get<CameraApi>('camera')!;
  const world = engine.get<WorldApi>('world')!;
  let orbit = 0, stalled = 0;
  const startAttract = () => {
    const veh = v(), at = world.attract;
    if (at) {
      veh.reset({ x: at.start.x, y: world.spawn.y, z: at.start.z }, at.start.yaw);
      veh.autopilot = new PathPilot(at.path, { speed: at.speed, lookahead: at.drift ? 10 : 14, closed: at.closed, drift: at.drift });
    } else {
      veh.reset({ x: FIGURE8.cx, y: world.spawn.y, z: FIGURE8.cz }, Math.PI / 2);
      veh.autopilot = attractPilot();
    }
  };

  const attractCamera = (c: THREE.PerspectiveCamera, dt: number) => {
    orbit += dt * 0.12;
    const p = v().renderPos;
    c.position.set(p.x + Math.sin(orbit) * 11, p.y + 3.2, p.z + Math.cos(orbit) * 11);
    c.lookAt(p.x, p.y + 0.6, p.z);
    c.fov = 50; c.updateProjectionMatrix();
  };

  const api: UiApi = {
    name: 'ui',
    state: 'title',
    showTitle() {
      api.state = 'title';
      menu.set('title');
      hud.setVisible(false);
      const veh = v();
      veh.inputEnabled = false;
      startAttract();
      cam().override = attractCamera;
      engine.paused = false;
    },
    start() {
      engine.get<AudioApi>('audio')?.unlock();
      const veh = v();
      if (api.state === 'title') {
        veh.autopilot = null;
        veh.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
        engine.get<FxApi>('fx')?.clear();
        cam().override = null;
        cam().snap();
        engine.events.emit('game:start', {});
      }
      api.state = 'playing';
      menu.set('playing');
      hud.setVisible(true);
      veh.inputEnabled = true;
      engine.paused = false;
      engine.input.requestLock();
    },
    pause() {
      if (api.state !== 'playing') return;
      api.state = 'paused';
      menu.set('paused');
      v().inputEnabled = false;
      engine.paused = true;
      engine.input.exitLock();
      engine.events.emit('game:pause', { paused: true });
    },
    update(dt) {
      const inp = engine.input.state;
      // An open attract route (the city) loops back to its start when the taxi reaches the end.
      // It also restarts if the demo car is stuck (traffic in the way), so the title never sits still.
      const at = world.attract;
      const pilot = v().autopilot;
      stalled = api.state === 'title' && v().car.speed < 1 ? stalled + dt : 0;
      if (api.state === 'title' && at && ((!at.closed && pilot && pilot.index >= at.path.length - 4) || stalled > 4)) {
        stalled = 0;
        startAttract();
      }
      if (inp.pausePressed) {
        if (api.state === 'playing') api.pause();
        else if (api.state === 'paused') api.start();
      }
    },
  };
  menu.onStart = () => api.start();
  // Losing pointer lock (Esc, alt-tab) while driving pauses, as in any PC game.
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && api.state === 'playing' && !new URLSearchParams(location.search).has('nolock')) api.pause();
  });
  onLangChange(() => { document.title = `${t('title.name')} · ${t('title.place')}`; });
  document.title = `${t('title.name')} · ${t('title.place')}`;
  engine.add(api);
  api.showTitle();
}
