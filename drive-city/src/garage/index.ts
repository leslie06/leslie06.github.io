import * as THREE from 'three';
import { project } from '../city/Geo';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { CarLook, HudApi, MissionApi, PlayerApi, TrafficCars, VehicleApi } from '../game/Contracts';
import type { DamageApi } from '../damage';
import type { UiApi } from '../ui';
import { ANCHOR, DRIVE, GARAGE, PARK_AT } from '../home/Layout';
import { bodyOfSpec, type BodyType } from '../vehicle/Bodies';
import { SPEC_OF, TAXI } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { GarageMenu } from './GarageMenu';

import { ENGINE, FINE, NITRO, PRICE, TYRES } from './Parts';
export { ENGINE, FINE, NITRO, PAINTS, PRICE, TYRES } from './Parts';

const KEY = 'drivecity.garage.v1';

/** Your car: which body, its paint, what has been done to it, and whether the police have it. */
export interface Profile { body: BodyType; upper: string; lower: string; taxi: boolean; engine: number; tyres: number; nitro: number; impounded: boolean }

export function readProfile(): Profile | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Profile) : null; } catch { return null; }
}

export interface GarageApi extends System {
  readonly open: boolean;
  /** The car the upgrades are on (null until the first one is bought). */
  readonly owned: Vehicle | null;
  readonly profile: Profile | null;
  /** Open the garage screen now (the intro does, at the end of its drive). */
  show(): void;
  /** Give the player the car they are sitting in as theirs, with these upgrades (the intro's getaway car). */
  adopt(levels: { engine: number; tyres: number; nitro: number }): void;
  debug: { buy(item: 'engine' | 'tyres' | 'nitro' | 'repair' | 'paint' | 'impound', paint?: string): boolean };
}

/**
 * The garage at home: park inside and a screen of upgrades opens. What you buy goes on the car
 * you drove in, which becomes *your car* - saved (`drivecity.garage.v1`), rebuilt at the start of
 * every session, and taken by the police when they bust you in it (the fine is paid either way).
 * An impounded car is bought back here.
 *
 * Upgrades are per car, not per type: `Vehicle.tune` carries them (engine torque and top speed,
 * tyre grip, a nitro bottle), because every car of a type shares one spec object.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  if (!pl) return;
  const [ax, az] = project(ANCHOR.lat, ANCHOR.lon);
  const menu = new GarageMenu();
  let profile = readProfile();
  let owned: Vehicle | null = null;
  let open = false, dismissed = false, impoundNext = false;

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const cashOf = () => engine.get<MissionApi>('missions')?.cash ?? 0;
  const pay = (n: number) => { if (cashOf() < n) return false; engine.get<MissionApi>('missions')?.addCash(-n); return true; };
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const save = () => { try { if (profile) localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* private mode */ } };
  const hex = (c: THREE.Color) => `#${c.getHexString()}`;

  /** Put the profile's work on a car. A newly fitted bottle comes full. */
  const apply = (car: Vehicle, p: Profile) => {
    const e = ENGINE[p.engine] ?? ENGINE[0];
    const hadNitro = car.tune.nitro > 0;
    car.tune.torque = e.torque; car.tune.top = e.top; car.tune.grip = TYRES[p.tyres] ?? 1; car.tune.nitro = NITRO[p.nitro] ?? 0;
    if (car.tune.nitro > 0 && !hadNitro) car.nitroFill = 1;
  };
  const stock = (car: Vehicle) => { car.tune.torque = 1; car.tune.top = 1; car.tune.grip = 1; car.tune.nitro = 0; car.boost = 0; };

  /** The car in the garage becomes yours: the profile's upgrades move onto it. */
  const own = () => {
    const v = vehicle(), look = v.look;
    if (owned && owned !== v.car) stock(owned);
    owned = v.car;
    const levels = profile ?? { engine: 0, tyres: 0, nitro: 0 };
    profile = { body: look.body ?? bodyOfSpec(v.car.spec), upper: hex(look.upper), lower: hex(look.lower), taxi: look.taxi, engine: levels.engine, tyres: levels.tyres, nitro: levels.nitro, impounded: false };
    apply(owned, profile);
    save();
  };

  const lookOf = (p: Profile): CarLook => ({ upper: new THREE.Color(p.upper), lower: new THREE.Color(p.lower), taxi: p.taxi, parked: true, body: p.body });

  /** Out of play: disabled and parked far under the map (a Vehicle is kept, not destroyed: see traffic's spares). */
  const stash = (car: Vehicle) => { car.body.setTranslation({ x: 0, y: -600, z: 0 }, false); car.body.setEnabled(false); };

  /** Swap the player into `next` where the current car stands; the old one is stashed. */
  const swapHere = (next: Vehicle, look: CarLook) => {
    const v = vehicle(), cur = v.car;
    next.body.setEnabled(true);
    next.reset({ x: cur.pos.x, y: cur.pos.y + 0.1, z: cur.pos.z }, Math.atan2(cur.fwd.x, cur.fwd.z));
    const prev = v.swapCar(next, look);
    stash(prev.car);
  };

  const inGarage = (x: number, z: number) => { const lx = x - ax, lz = z - az; return lx > GARAGE.x0 && lx < GARAGE.x1 && lz > GARAGE.z0 && lz < GARAGE.z1; };

  const refresh = () => {
    const v = vehicle(), car = v.car, dmg = engine.get<DamageApi>('damage');
    const mine = !!owned && car === owned;
    const p = mine && profile ? profile : { engine: 0, tyres: 0, nitro: 0 };
    menu.render({
      cash: cashOf(), mine, hasProfile: !!profile, impounded: !!profile?.impounded,
      engine: p.engine, tyres: p.tyres, nitro: p.nitro,
      carLevels: profile ? { engine: profile.engine, tyres: profile.tyres, nitro: profile.nitro } : null,
      health: Math.round(dmg?.health() ?? 100),
      taxi: v.look.taxi,
    });
  };

  const buy = (item: 'engine' | 'tyres' | 'nitro' | 'repair' | 'paint' | 'impound', paint?: string): boolean => {
    const v = vehicle();
    if (item === 'repair') {
      const dmg = engine.get<DamageApi>('damage'), h = dmg?.health() ?? 100;
      const cost = Math.ceil((100 - h) * PRICE.repairPerPoint);
      if (h >= 100 || !pay(cost)) return false;
      dmg!.repair(); toast(t('garage.repaired'));
    } else if (item === 'paint') {
      if (!paint || !pay(PRICE.paint)) return false;
      const c = new THREE.Color(paint);
      // A taxi keeps its golden top and changes company colour; anything else is one colour.
      if (!v.look.taxi) v.look.upper.copy(c);
      v.look.lower.copy(c);
      v.model.setPaint(v.look.upper, v.look.lower, v.look.taxi);
      if (owned === v.car && profile) { profile.upper = hex(v.look.upper); profile.lower = hex(v.look.lower); save(); }
    } else if (item === 'impound') {
      if (!profile?.impounded || !owned || !pay(PRICE.impound)) return false;
      // Your car rolls out into the garage; whatever you came in with goes out on the drive.
      const cur = v.car, curLook = { ...v.look, upper: v.look.upper.clone(), lower: v.look.lower.clone(), parked: true };
      owned.body.setEnabled(true);
      owned.reset({ x: ax + PARK_AT.x, y: 0.03 + owned.spec.wheelRadius + 0.1, z: az + PARK_AT.z }, PARK_AT.yaw);
      cur.reset({ x: ax + (DRIVE.in.x0 + DRIVE.in.x1) / 2, y: 0.03 + cur.spec.wheelRadius + 0.1, z: az + (DRIVE.in.z0 + DRIVE.in.z1) / 2 }, -Math.PI / 2);
      const prev = v.swapCar(owned, lookOf(profile));
      engine.get<TrafficCars>('traffic')?.parkCar(prev.car, curLook);
      profile.impounded = false; apply(owned, profile); owned.nitroFill = owned.tune.nitro > 0 ? 1 : 0; save();
      toast(t('garage.back'));
    } else {
      if (profile?.impounded) return false;
      const have = owned === v.car && profile ? profile[item] : (profile?.[item] ?? 0);
      const prices = PRICE[item];
      if (have >= prices.length || !pay(prices[have])) return false;
      if (owned !== v.car) own();
      profile![item] = have + 1;
      apply(v.car, profile!);
      if (item === 'nitro') v.car.nitroFill = 1;
      save();
      toast(t(`garage.bought.${item}` as 'garage.bought.engine', { n: have + 1 }));
    }
    refresh();
    return true;
  };

  const show = () => {
    if (open) return;
    const ui = engine.get<UiApi>('ui');
    if (!ui || ui.state !== 'playing') return;
    open = true;
    ui.overlay(true);
    refresh();
    menu.show();
  };
  const hide = () => {
    if (!open) return;
    open = false; dismissed = true;
    menu.hide();
    engine.get<UiApi>('ui')?.overlay(false);
  };
  menu.onBuy = (item, paint) => { buy(item, paint); };
  menu.onClose = hide;

  // A new session: your car, rebuilt from the save, where the taxi would have started.
  engine.events.on('game:start', () => {
    if (!profile) return;
    const v = vehicle();
    if (profile.impounded) {
      // The police still have it: find it at the start of the next session too, not lost.
      owned = new Vehicle(engine.physics, SPEC_OF[profile.body] ?? TAXI, { x: 0, y: -600, z: 0 }, 0);
      stash(owned);
      setTimeout(() => toast(t('garage.stillImpounded', { n: PRICE.impound })), 1500);
      return;
    }
    const same = (v.look.body ?? 'sedan') === profile.body && v.look.taxi === profile.taxi;
    if (same) {
      v.look.upper.set(profile.upper); v.look.lower.set(profile.lower);
      v.model.setPaint(v.look.upper, v.look.lower, v.look.taxi);
      owned = v.car;
    } else {
      owned = new Vehicle(engine.physics, SPEC_OF[profile.body] ?? TAXI, { x: 0, y: -600, z: 0 }, 0);
      swapHere(owned, lookOf(profile));
    }
    apply(owned, profile);
    owned.nitroFill = owned.tune.nitro > 0 ? 1 : 0;
  });

  // Busted: the fine, and your car to the pound if you were in it. The swap waits for the respawn
  // (the police reset the car to the spawn), so the busted screen still shows the car you were in.
  engine.events.on('wanted:busted', ({ level }) => {
    const fine = Math.min(cashOf(), FINE.base + FINE.perStar * Math.max(1, level));
    if (fine > 0) engine.get<MissionApi>('missions')?.addCash(-fine);
    const v = vehicle();
    impoundNext = !!owned && v.car === owned;
    setTimeout(() => toast(impoundNext ? t('garage.impounded', { fine, n: PRICE.impound }) : t('garage.fined', { fine })), 3600);
  });
  engine.events.on('vehicle:reset', () => {
    if (!impoundNext) return;
    impoundNext = false;
    const taxi = new Vehicle(engine.physics, TAXI, { x: 0, y: -600, z: 0 }, 0);
    swapHere(taxi, { upper: new THREE.Color('#f3b50f'), lower: new THREE.Color('#1f5e3c'), taxi: true, body: 'sedan' });
    if (profile) { profile.impounded = true; save(); }
  });

  const api: GarageApi = {
    name: 'garage',
    get open() { return open; },
    get owned() { return owned; },
    get profile() { return profile; },
    show,
    adopt(levels) {
      own();
      profile!.engine = levels.engine; profile!.tyres = levels.tyres; profile!.nitro = levels.nitro;
      apply(owned!, profile!);
      owned!.nitroFill = owned!.tune.nitro > 0 ? 1 : 0;
      save();
    },
    debug: { buy },
    fixedUpdate() {
      const v = vehicle(), car = v.car;
      const inside = pl.mode === 'driving' && v.occupied && inGarage(car.pos.x, car.pos.z);
      if (!inside) { dismissed = false; return; }
      if (!open && !dismissed && car.speed < 1.2) show();
    },
    update() {
      if (!open) return;
      // Esc leaves the garage, and is used up here: the ui system would otherwise read it as a pause.
      if (engine.input.state.pausePressed) { engine.input.state.pausePressed = false; hide(); }
    },
  };
  engine.add(api);
}
