import * as THREE from 'three';
import { project } from '../city/Geo';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { CarLook, HudApi, MissionApi, NavApi, PlayerApi, TrafficCars, VehicleApi, WantedApi } from '../game/Contracts';
import { CG, groups } from '../core/Physics';
import type { TrafficApi } from '../traffic';
import type { DamageApi } from '../damage';
import type { UiApi } from '../ui';
import { ANCHOR, DRIVE, GARAGE, PARK_AT } from '../home/Layout';
import { bodyOfSpec, bodySettled, readyBodies, type BodyType } from '../vehicle/Bodies';
import { SPEC_OF, TAXI } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { GarageMenu } from './GarageMenu';

import { DEALER, ENGINE, FINE, isLuxury, NITRO, PRICE, TRANSFER, TYRES, type LuxuryBody } from './Parts';
export { DEALER, ENGINE, FINE, NITRO, PAINTS, PRICE, TYRES } from './Parts';

const KEY = 'drivecity.garage.v1';
const isCarItem = (i: string): i is `car:${LuxuryBody}` => i.startsWith('car:');

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
  /** Open the 车行 on the phone: a luxury car delivered to the kerb beside you. */
  dealer(): void;
  /** Give the player the car they are sitting in as theirs, with these upgrades (the intro's getaway car). */
  adopt(levels: { engine: number; tyres: number; nitro: number }): void;
  debug: { buy(item: 'engine' | 'tyres' | 'nitro' | 'repair' | 'paint' | 'impound' | 'dashcam' | 'transfer' | `car:${LuxuryBody}`, paint?: string): boolean; order(body: LuxuryBody): boolean };
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
  /** The phone's 车行 is up (the same screen, its dealer page), and the car it brought, until you are in it. */
  let dealerOpen = false;
  let delivered: Vehicle | null = null;

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  /** 大刘's discount and 王队's word on the fine (contacts/). */
  const contacts = () => engine.get<{ name: string; discount: number; fineScale: number }>('contacts');
  const priced = (n: number) => Math.round(n * (1 - (contacts()?.discount ?? 0)));
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

  /** The car in the garage is a luxury car off the street, not yet through the books (过户). */
  const stolenHere = (): LuxuryBody | null => {
    const v = vehicle(), b = v.look.body ?? bodyOfSpec(v.car.spec);
    return isLuxury(b) && !(owned && v.car === owned) ? b : null;
  };

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
      dashcam: !!engine.get<{ name: string; dashcam: boolean }>('npc')?.dashcam,
      discount: contacts()?.discount ?? 0,
      stolen: stolenHere(),
      ownBody: profile?.body ?? null,
    });
  };

  /**
   * A new luxury car from the 车行: it rolls into the garage stock, in its own paint, and is your car; the one you came
   * in goes out on the drive, an ordinary parked car (your old car, if it was, is yours no more).
   */
  const buyCar = (body: LuxuryBody): boolean => {
    const d = DEALER.find((x) => x.body === body)!;
    if ((profile?.body === body && !profile.impounded) || cashOf() < d.price) return false;
    // the model comes after the title; if it is somehow not in yet, fetch it and ask again
    if (!bodySettled(body)) { void readyBodies([body]); toast(t('garage.carLoading')); return false; }
    pay(d.price);
    const v = vehicle(), cur = v.car, curLook = { ...v.look, upper: v.look.upper.clone(), lower: v.look.lower.clone(), parked: true };
    const car = new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -600, z: 0 }, 0);
    car.reset({ x: ax + PARK_AT.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: az + PARK_AT.z }, PARK_AT.yaw);
    cur.reset({ x: ax + (DRIVE.in.x0 + DRIVE.in.x1) / 2, y: 0.03 + cur.spec.wheelRadius + 0.1, z: az + (DRIVE.in.z0 + DRIVE.in.z1) / 2 }, -Math.PI / 2);
    const paint = new THREE.Color(d.paint);
    const prev = v.swapCar(car, { upper: paint, lower: paint.clone(), taxi: false, parked: true, body });
    if (owned && owned !== cur) stash(owned);
    stock(prev.car);
    engine.get<TrafficCars>('traffic')?.parkCar(prev.car, curLook);
    owned = car;
    profile = { body, upper: d.paint, lower: d.paint, taxi: false, engine: 0, tyres: 0, nitro: 0, impounded: false };
    apply(car, profile);
    save();
    engine.get<DamageApi>('damage')?.repair(car);
    toast(t('garage.bought.car', { car: t(`car.${body}`) }));
    return true;
  };

  /**
   * Where a delivered car can stop: the kerb (or the edge of the cars parked along it) of an ordinary street 7-30 m from
   * you, on the flat, nothing standing there (a car, a lamp post, a parked car's box), as near 12 m as it gets; ahead of
   * you before behind. Null when there is none (an expressway, a bridge, a courtyard).
   */
  const NO_DELIVERY = new Set(['motorway', 'motorway_link', 'trunk_link', 'service']);
  const spot = (): { x: number; z: number; yaw: number } | null => {
    const tr = engine.get<TrafficApi>('traffic');
    if (!tr) return null;
    const g = tr.graph, me = pl.position, v = vehicle();
    const fwd = pl.mode === 'driving' ? v.car.fwd : engine.camera.getWorldDirection(new THREE.Vector3());
    const { R, world } = engine.physics;
    const box = new R.Cuboid(1.05, 0.6, 2.5);
    const at = { x: 0, z: 0, dx: 0, dz: 0 };
    let best: { x: number; z: number; yaw: number } | null = null, bestScore = Infinity;
    const others = tr.cars();
    for (const id of g.near(me.x, me.z, 45)) {
      const l = g.links[id];
      if (l.len < 12 || l.hmax > 0.3 || NO_DELIVERY.has(l.cls)) continue;
      for (let s0 = 4; s0 < l.len - 4; s0 += 3) {
        g.at(l, s0, -(l.kerbR - 1.15), at);
        const d = Math.hypot(at.x - me.x, at.z - me.z);
        if (d < 7 || d > 30) continue;
        const behind = ((at.x - me.x) * fwd.x + (at.z - me.z) * fwd.z) < 0;
        const score = Math.abs(d - 12) + (behind ? 6 : 0);
        if (score >= bestScore) continue;
        if (others.some((c) => Math.hypot(c.pos.x - at.x, c.pos.z - at.z) < 6) || Math.hypot(v.car.pos.x - at.x, v.car.pos.z - at.z) < 6) continue;
        const yaw = Math.atan2(at.dx, at.dz);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        if (world.intersectionWithShape({ x: at.x, y: 0.95, z: at.z }, { x: q.x, y: q.y, z: q.z, w: q.w }, box, undefined, groups(CG.CAR, CG.ALL))) continue;
        best = { x: at.x, z: at.z, yaw }; bestScore = score;
      }
    }
    return best;
  };

  /**
   * The phone's 车行 (2026-10-19, 「现在买车只能回家在车库买吗？感觉不方便」): the car is brought new to the kerb beside
   * you, as if bought in the garage - your car, saved, the one you had yours no more (its upgrades gone) - and waits there
   * with a flashing blip until you get in. Not while wanted, nor where nothing can stop.
   */
  const order = (body: LuxuryBody): boolean => {
    const d = DEALER.find((x) => x.body === body)!;
    if ((profile?.body === body && !profile.impounded) || cashOf() < d.price) return false;
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) { toast(t('garage.dealerWanted')); return false; }
    if (!bodySettled(body)) { void readyBodies([body]); toast(t('garage.carLoading')); return false; }
    const at = spot();
    if (!at) { toast(t('garage.noSpot')); return false; }
    pay(d.price);
    const v = vehicle();
    const car = new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -600, z: 0 }, 0);
    car.reset({ x: at.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: at.z }, at.yaw);
    const paint = new THREE.Color(d.paint);
    if (owned && owned !== v.car) stash(owned);
    else if (owned) stock(owned);
    if (delivered && delivered !== v.car && delivered !== owned) stash(delivered);
    owned = car;
    profile = { body, upper: d.paint, lower: d.paint, taxi: false, engine: 0, tyres: 0, nitro: 0, impounded: false };
    apply(car, profile);
    save();
    engine.get<TrafficCars>('traffic')?.parkCar(car, { upper: paint, lower: paint.clone(), taxi: false, parked: true, body });
    delivered = car;
    // which way, from where you look
    const me = pl.position, cam = engine.camera.getWorldDirection(new THREE.Vector3());
    const rx = at.x - me.x, rz = at.z - me.z, m = Math.round(Math.hypot(rx, rz));
    const ahead = (rx * cam.x + rz * cam.z) / Math.max(1, m), side = (rx * cam.z - rz * cam.x) / Math.max(1, m);
    const where = Math.abs(ahead) >= Math.abs(side) ? (ahead > 0 ? 'ahead' : 'behind') : (side > 0 ? 'left' : 'right');
    toast(t('garage.delivered', { car: t(`car.${body}`), where: t(`garage.where.${where}` as 'garage.where.ahead'), m }));
    return true;
  };

  const buy = (item: 'engine' | 'tyres' | 'nitro' | 'repair' | 'paint' | 'impound' | 'dashcam' | 'transfer' | `car:${LuxuryBody}`, paint?: string): boolean => {
    const v = vehicle();
    if (isCarItem(item)) {
      if (!buyCar(item.slice(4) as LuxuryBody)) return false;
    } else if (item === 'transfer') {
      const b = stolenHere();
      if (!b) return false;
      const fee = Math.round(DEALER.find((x) => x.body === b)!.price * TRANSFER);
      if (!pay(fee)) return false;
      own();
      toast(t('garage.transferred', { car: t(`car.${b}`) }));
    } else if (item === 'dashcam') {
      const npc = engine.get<{ name: string; dashcam: boolean }>('npc');
      if (!npc || npc.dashcam || !pay(PRICE.dashcam)) return false;
      npc.dashcam = true; toast(t('garage.bought.dashcam'));
    } else if (item === 'repair') {
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
      if (profile?.impounded || stolenHere()) return false;
      const have = owned === v.car && profile ? profile[item] : (profile?.[item] ?? 0);
      const prices = PRICE[item];
      if (have >= prices.length || !pay(priced(prices[have]))) return false;
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
  const dealerView = () => ({ cash: cashOf(), ownBody: profile?.body ?? null, impounded: !!profile?.impounded, wanted: (engine.get<WantedApi>('wanted')?.level ?? 0) > 0 });
  const dealer = () => {
    if (open || dealerOpen) return;
    const ui = engine.get<UiApi>('ui');
    if (!ui || ui.state !== 'playing') return;
    dealerOpen = true;
    ui.overlay(true); engine.paused = true;
    engine.events.emit('game:pause', { paused: true });
    menu.renderDealer(dealerView());
    menu.show();
  };
  const closeDealer = () => {
    if (!dealerOpen) return;
    dealerOpen = false;
    menu.hide();
    engine.paused = false;
    engine.events.emit('game:pause', { paused: false });
    engine.get<UiApi>('ui')?.overlay(false);
  };
  menu.onBuy = (item, paint) => {
    if (!dealerOpen) { buy(item, paint); return; }
    // ordered: back to the street to fetch it
    if (isCarItem(item) && order(item.slice(4) as LuxuryBody)) closeDealer(); else menu.renderDealer(dealerView());
  };
  menu.onClose = () => { if (dealerOpen) closeDealer(); else hide(); };
  // the delivered car flashes on the map until you are in it
  engine.get<NavApi>('nav')?.addBlips(() => {
    if (!delivered) return [];
    if (vehicle().car === delivered) { delivered = null; return []; }
    return [{ kind: 'car' as const, x: delivered.pos.x, z: delivered.pos.z, flash: true, label: t(`car.${profile?.body ?? 'coupe'}` as 'car.coupe') }];
  });

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
    const fine = Math.min(cashOf(), Math.round((FINE.base + FINE.perStar * Math.max(1, level)) * (contacts()?.fineScale ?? 1)));
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
    dealer,
    adopt(levels) {
      own();
      profile!.engine = levels.engine; profile!.tyres = levels.tyres; profile!.nitro = levels.nitro;
      apply(owned!, profile!);
      owned!.nitroFill = owned!.tune.nitro > 0 ? 1 : 0;
      save();
    },
    debug: { buy, order },
    fixedUpdate() {
      const v = vehicle(), car = v.car;
      const inside = pl.mode === 'driving' && v.occupied && inGarage(car.pos.x, car.pos.z);
      if (!inside) { dismissed = false; return; }
      if (!open && !dismissed && car.speed < 1.2) show();
    },
    update() {
      // Esc closes the phone's 车行 (used up here, or the ui system would pause)
      if (dealerOpen && engine.input.state.pausePressed) { engine.input.state.pausePressed = false; closeDealer(); }
      // Closed in the garage, stopped: F (the big button on a phone) opens it again (2026-10-19, 「关闭之后再没有按钮可以
      // 打开这个页面了」: it only opened by itself on the way in, so once closed you had to drive out and back)
      if (!open && dismissed) {
        const v = vehicle(), car = v.car;
        if (pl.mode === 'driving' && v.occupied && inGarage(car.pos.x, car.pos.z) && car.speed < 1.2) pl.offer?.({ x: car.pos.x, z: car.pos.z, r: 4, label: t('garage.open'), use: show });
      }
      if (!open) return;
      // Esc leaves the garage, and is used up here: the ui system would otherwise read it as a pause.
      if (engine.input.state.pausePressed) { engine.input.state.pausePressed = false; hide(); }
    },
  };
  engine.add(api);
}
