import * as THREE from 'three';
import { project } from '../city/Geo';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { CarLook, HudApi, MissionApi, NavApi, PlayerApi, TrafficCars, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import { shotMode } from '../debug/ShotMode';
import type { GarageApi } from '../garage';
import { ANCHOR, DRIVE, GARAGE, PARK_AT } from '../home/Layout';
import { Marker } from '../missions/Marker';
import type { PoliceSystem } from '../police';
import type { TrafficApi } from '../traffic';
import { TOUCH } from '../ui/Touch';
import { Banner } from '../ui/Banner';
import { TAXI } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';

const KEY = 'drivecity.intro.v1';
/** Where the getaway starts: on Chang'an Avenue west of 建国门, heading east, about 2 km from home (the fallback point if the street is not found). */
const START = { road: '建国门内大街', x: 2400, z: 40 };
/** The cut, and what the getaway car becomes once it is yours. */
const REWARD = 800;
const CAR_LEVELS = { engine: 1, tyres: 0, nitro: 1 };

/** 'load': the start's streets are streaming in, the player held still. */
type Step = 'off' | 'load' | 'run' | 'home' | 'done';

export interface IntroApi extends System {
  readonly step: Step;
  /** Probes: start it now, whatever the save says. */
  debug: { start(): void };
}

/**
 * The first minute of a new game: a getaway. The player starts in a black saloon with a nitro
 * bottle, two stars and a passenger who has just robbed somewhere, on Chang'an Avenue heading
 * east. Losing the police is the lesson in driving, the nitro and the wanted level; the drive home
 * to the garage shows the map's GPS; the garage pays the cut and gives the player the car, and its
 * screen opens on it. Busted on the way, it starts over. It runs once (`drivecity.intro.v1`), not
 * for a player who already has a car in the garage, and never in shot mode; `?intro=1` forces it
 * and `?intro=0` skips it.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  const tr = engine.get<TrafficApi>('traffic');
  if (!pl || !tr) return;
  const q = new URLSearchParams(location.search).get('intro');
  const [ax, az] = project(ANCHOR.lat, ANCHOR.lon);
  const banner = new Banner();
  const marker = new Marker(engine.scene);
  let step: Step = 'off', clock = 0, hinted = false, retry = false, car: Vehicle | null = null, busted = false, taxiHint = false;

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const missions = () => engine.get<MissionApi>('missions');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const story = (s: string | null) => { const m = missions(); if (m) m.story = s; };
  const done = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const markDone = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };

  /**
   * The longest eastbound piece of START.road, 30% along its inside lane - found by name, as the
   * races find their grids: the nearest multi-lane link to a point picked a slip road at the 建国门
   * interchange, and the car's first second was into the median railings.
   */
  const startPose = () => {
    const g = tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    let best = -1, bl = 0;
    for (const l of g.links) {
      if (l.name !== START.road || l.lanes < 2 || l.len <= bl) continue;
      g.at(l, l.len / 2, 0, at);
      if (at.dx > 0.8) { bl = l.len; best = l.id; }
    }
    if (best < 0) return { x: START.x, z: START.z, yaw: Math.PI / 2 };
    const l = g.links[best];
    g.at(l, l.len * 0.3, g.laneOffset(l, 0), at);
    return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
  };

  const begin = async () => {
    const v = vehicle(), w = engine.get<WorldApi>('world')!;
    const p = startPose();
    // Held still while the start's streets load (a few seconds on a cold page), or the player drives
    // off in the spawn's taxi and is then snatched away mid-turn.
    step = 'load';
    story(t('intro.loading'));
    await w.preload?.(p.x, p.z);
    // A black saloon: the getaway car, nitro fitted and full.
    if (!car) {
      car = new Vehicle(engine.physics, TAXI, { x: p.x, y: 1, z: p.z }, p.yaw);
      const look: CarLook = { upper: new THREE.Color('#161718'), lower: new THREE.Color('#161718'), taxi: false, body: 'sedan' };
      const prev = v.swapCar(car, look);
      prev.car.body.setTranslation({ x: 0, y: -600, z: 0 }, false); prev.car.body.setEnabled(false);
    }
    car.tune.nitro = 3; car.nitroFill = 1;
    v.reset({ x: p.x, y: 0.03 + TAXI.wheelRadius + 0.08, z: p.z }, p.yaw);
    car.setMoving(12);
    engine.get<PoliceSystem>('wanted')?.debug.setLevel(2);
    v.inputEnabled = true;
    step = 'run'; clock = 0; hinted = false; busted = false;
    banner.show(t('intro.go'), '#ffc21f');
    setTimeout(() => banner.hide(), 1400);
    toast(t('intro.say1'));
    story(t('intro.lose'));
    nav()?.clearTarget('mission');
    marker.hide();
  };
  const nav = () => engine.get<NavApi>('nav');

  engine.events.on('game:start', () => {
    if (q === '0' || (shotMode && q !== '1')) return;
    if (q !== '1' && (done() || engine.get<GarageApi>('garage')?.profile)) return;
    void begin();
  });
  // Busted in the getaway: go again from the start once the police have put you back.
  engine.events.on('wanted:busted', () => { if (step === 'run' || step === 'home') { busted = true; } });
  engine.events.on('vehicle:reset', () => { if (busted) { busted = false; retry = true; } });

  const inGarage = (x: number, z: number) => { const lx = x - ax, lz = z - az; return lx > GARAGE.x0 && lx < GARAGE.x1 && lz > GARAGE.z0 && lz < GARAGE.z1; };

  const api: IntroApi = {
    name: 'intro',
    get step() { return step; },
    debug: { start: () => { void begin(); } },
    fixedUpdate(dt) {
      if (retry) { retry = false; toast(t('intro.again')); void begin(); return; }
      // Out of the garage screen: point at the taxi on the drive, the way to earn a living.
      // Parked now rather than on arrival: traffic drops a parked car 420 m from the camera, so it
      // waits until the player has certainly been at home for a while.
      if (taxiHint && !engine.get<GarageApi>('garage')?.open) {
        taxiHint = false;
        const taxi = new Vehicle(engine.physics, TAXI, { x: ax + (DRIVE.in.x0 + DRIVE.in.x1) / 2, y: 1, z: az + (DRIVE.in.z0 + DRIVE.in.z1) / 2 }, -Math.PI / 2);
        engine.get<TrafficCars>('traffic')?.parkCar(taxi, { upper: new THREE.Color('#f3b50f'), lower: new THREE.Color('#1f5e3c'), taxi: true, parked: true, body: 'sedan' });
        toast(t('intro.taxi'));
      }
      if (step === 'load') { vehicle().inputEnabled = false; return; }
      if (step === 'off' || step === 'done') return;
      clock += dt;
      const v = vehicle(), wanted = engine.get<WantedApi>('wanted')?.level ?? 0;
      if (step === 'run') {
        if (!hinted && clock > 3) { hinted = true; toast(t(TOUCH ? 'intro.nitroTouch' : 'intro.nitro')); }
        if (clock > 1 && wanted === 0) {
          step = 'home';
          toast(t('intro.say2'));
          story(t('intro.home'));
          const gx = ax + (DRIVE.in.x0 + DRIVE.in.x1) / 2, gz = az + (DRIVE.in.z0 + DRIVE.in.z1) / 2;
          nav()?.setTarget({ x: gx, z: gz, kind: 'mission', label: t('intro.garage') });
          marker.show(ax + PARK_AT.x, az + PARK_AT.z, '#ffc21f');
        }
      } else if (step === 'home') {
        if (wanted > 0) { step = 'run'; story(t('intro.lose')); nav()?.clearTarget('mission'); marker.hide(); return; }
        const c = v.car;
        if (pl.mode === 'driving' && v.occupied && inGarage(c.pos.x, c.pos.z) && c.speed < 1.2) {
          step = 'done';
          markDone();
          story(null);
          nav()?.clearTarget('mission');
          marker.hide();
          missions()?.addCash(REWARD);
          // The car you came home in is yours now (nitro and a first engine stage), and a taxi waits on the drive.
          engine.get<GarageApi>('garage')?.adopt(CAR_LEVELS);
          toast(t('intro.cut', { n: REWARD }));
          taxiHint = true;
          engine.get<GarageApi>('garage')?.show();
        }
      }
    },
    update(dt) { marker.update(dt); },
  };
  engine.add(api);
}
