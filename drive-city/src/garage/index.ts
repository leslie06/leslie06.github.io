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
import { bodyOfSpec, bodySettled, readyBodies, type BodySource, type BodyType } from '../vehicle/Bodies';
import { SPEC_OF, TAXI } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { BuyButton } from './BuyButton';
import { GarageMenu, type Item } from './GarageMenu';

import { DEALER, ENGINE, FINE, isLuxury, NITRO, PRICE, TRANSFER, TYRES, type LuxuryBody } from './Parts';
export { DEALER, ENGINE, FINE, NITRO, PAINTS, PRICE, TYRES } from './Parts';

const KEY = 'drivecity.garage.v1';
const isCarItem = (i: string): i is `car:${LuxuryBody}` => i.startsWith('car:');

/** Your car: which body, its paint, what has been done to it, and whether the police have it. */
export interface Profile { body: BodyType; upper: string; lower: string; taxi: boolean; engine: number; tyres: number; nitro: number; impounded: boolean }
/** The save: the car you drive now (rebuilt at the start of a session) at the top level, your other cars beside it. */
type Saved = Profile & { others?: Profile[] };

const readSaved = (): Profile[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const { others, ...cur } = JSON.parse(raw) as Saved;
    return [cur, ...(others ?? [])];
  } catch { return []; }
};
export function readProfile(): Profile | null { return readSaved()[0] ?? null; }

/** One of your cars, and its Vehicle while it is out in the world or at the pound (null: at home). */
interface Mine { p: Profile; car: Vehicle | null }

export interface GarageApi extends System {
  readonly open: boolean;
  /** The car you drive now, the one the upgrades shown are on (null until the first one is bought, or while it is at home). */
  readonly owned: Vehicle | null;
  readonly profile: Profile | null;
  /** Open the garage screen now (the intro does, at the end of its drive). */
  show(): void;
  /** Open the 车行 on the phone: a luxury car delivered to the kerb beside you, or one of yours brought over. */
  dealer(): void;
  /** Give the player the car they are sitting in as theirs, with these upgrades (the intro's getaway car). */
  adopt(levels: { engine: number; tyres: number; nitro: number }): void;
  debug: { buy(item: Item, paint?: string): boolean; order(body: LuxuryBody): boolean; call(i: number): boolean; fleet(): { body: string; impounded: boolean; out: boolean; engine: number; cur: boolean }[] };
}

/**
 * The garage at home: park inside and a screen of upgrades opens. What you buy goes on the car you drove in, which
 * becomes *your car* - saved (`drivecity.garage.v1`), rebuilt at the start of every session, and taken by the police
 * when they bust you in it (the fine is paid either way). An impounded car is bought back here.
 *
 * You can have several cars (2026-10-21, 「我买了赤骏，然后买蛮牛就把赤骏覆盖了」): one of each 车行 car and one
 * ordinary car (`slotOf`). Making another ordinary car yours moves the old one's parts across, and that one is yours no
 * more; a new 车行 car is one more. Each keeps its own upgrades. The one you sit in is the one you drive now. The others
 * wait where you left them, or at home once the street has taken them back; the phone's 车行 brings one over
 * (`PRICE.call`), the garage swaps one in for nothing.
 *
 * Upgrades are per car, not per type: `Vehicle.tune` carries them (engine torque and top speed,
 * tyre grip, a nitro bottle), because every car of a type shares one spec object.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  if (!pl) return;
  const [ax, az] = project(ANCHOR.lat, ANCHOR.lon);
  const menu = new GarageMenu();
  const fleet: Mine[] = readSaved().map((p) => ({ p, car: null }));
  let cur: Mine | null = fleet[0] ?? null;
  let open = false, dismissed = false, impoundNext = false;
  /** The phone's 车行 is up (the same screen, its dealer page), and the car it brought, until you are in it. */
  let dealerOpen = false;
  let delivered: Vehicle | null = null, deliveredName = '';
  let lastCar: Vehicle | null = null, liveT = 0;

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  /** 大刘's discount and 王队's word on the fine (contacts/). */
  const contacts = () => engine.get<{ name: string; discount: number; fineScale: number }>('contacts');
  const priced = (n: number) => Math.round(n * (1 - (contacts()?.discount ?? 0)));
  const cashOf = () => engine.get<MissionApi>('missions')?.cash ?? 0;
  const pay = (n: number) => { if (cashOf() < n) return false; engine.get<MissionApi>('missions')?.addCash(-n); return true; };
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const save = () => { try { if (cur) localStorage.setItem(KEY, JSON.stringify({ ...cur.p, others: fleet.filter((m) => m !== cur).map((m) => m.p) })); } catch { /* private mode */ } };
  const hex = (c: THREE.Color) => `#${c.getHexString()}`;
  const wanted = () => (engine.get<WantedApi>('wanted')?.level ?? 0) > 0;

  /** One of each 车行 car, and one ordinary car. */
  const slotOf = (b: string) => isLuxury(b) ? b : 'car';
  const holder = (b: string) => fleet.find((m) => slotOf(m.p.body) === slotOf(b)) ?? null;
  const mineOf = (car: Vehicle) => fleet.find((m) => m.car === car) ?? null;
  const bodyHere = () => { const v = vehicle(); return v.look.body ?? bodyOfSpec(v.car.spec); };
  const nameOf = (p: Profile) => p.body === 'coupe' || p.body === 'super' || p.body === 'limo' || p.body === 'ae86' ? t(`car.${p.body}`) : p.taxi ? t('garage.kind.taxi') : t(`garage.kind.${p.body}` as 'garage.kind.sedan');
  /**
   * The Vehicle of one of yours, if it is still that car: the one you are in or got out of, one parked in the street (or
   * the pound's). The street may have taken one back since the last look (despawned, its Vehicle up for reuse).
   */
  const stillOut = (m: Mine) => {
    const car = m.car;
    if (!car || car === vehicle().car || m.p.impounded) return car;
    return engine.get<TrafficApi>('traffic')?.cars().includes(car) ? car : null;
  };
  /** The car at the pound (the one you drove first). */
  const pound = () => (cur?.p.impounded ? cur : fleet.find((m) => m.p.impounded)) ?? null;

  /** The car's Blender body is in (the models come after the title); if not, it is fetched, and the player told to wait. */
  const loaded = (b: BodyType) => {
    if (b === 'moto' || b === 'bike' || b === 'ebike' || bodySettled(b as BodySource)) return true;
    void readyBodies([b as BodySource]); toast(t('garage.carLoading'));
    return false;
  };

  /** Put the profile's work on a car. A newly fitted bottle comes full. */
  const apply = (car: Vehicle, p: Profile) => {
    const e = ENGINE[p.engine] ?? ENGINE[0];
    const hadNitro = car.tune.nitro > 0;
    car.tune.torque = e.torque; car.tune.top = e.top; car.tune.grip = TYRES[p.tyres] ?? 1; car.tune.nitro = NITRO[p.nitro] ?? 0;
    if (car.tune.nitro > 0 && !hadNitro) car.nitroFill = 1;
  };
  const stock = (car: Vehicle) => { car.tune.torque = 1; car.tune.top = 1; car.tune.grip = 1; car.tune.nitro = 0; car.boost = 0; };

  /**
   * The car you are in becomes yours: the parts of the car it takes the place of (your ordinary car, or your 车行 car
   * of that body) move onto it, and that one is yours no more. Your other cars stay yours.
   */
  const own = () => {
    const v = vehicle(), look = v.look, body = bodyHere();
    const old = holder(body);
    const levels = old?.p ?? { engine: 0, tyres: 0, nitro: 0 };
    if (old) { if (old.car && old.car !== v.car) stock(old.car); fleet.splice(fleet.indexOf(old), 1); }
    cur = { p: { body, upper: hex(look.upper), lower: hex(look.lower), taxi: look.taxi, engine: levels.engine, tyres: levels.tyres, nitro: levels.nitro, impounded: false }, car: v.car };
    fleet.push(cur);
    apply(v.car, cur.p);
    save();
  };

  const lookOf = (p: Profile): CarLook => ({ upper: new THREE.Color(p.upper), lower: new THREE.Color(p.lower), taxi: p.taxi, parked: true, body: p.body });

  /** Out of play: disabled and parked far under the map (a Vehicle is kept, not destroyed: see traffic's spares). */
  const stash = (car: Vehicle) => { car.body.setTranslation({ x: 0, y: -600, z: 0 }, false); car.body.setEnabled(false); };

  /** Swap the player into `next` where the current car stands; the old one is stashed. */
  const swapHere = (next: Vehicle, look: CarLook) => {
    const v = vehicle(), was = v.car;
    next.body.setEnabled(true);
    next.reset({ x: was.pos.x, y: was.pos.y + 0.1, z: was.pos.z }, Math.atan2(was.fwd.x, was.fwd.z));
    const prev = v.swapCar(next, look);
    stash(prev.car);
  };

  const inGarage = (x: number, z: number) => { const lx = x - ax, lz = z - az; return lx > GARAGE.x0 && lx < GARAGE.x1 && lz > GARAGE.z0 && lz < GARAGE.z1; };

  /** The car in the garage is a luxury car off the street, not yet through the books (过户). */
  const stolenHere = (): LuxuryBody | null => {
    const b = bodyHere();
    return isLuxury(b) && !mineOf(vehicle().car) ? b : null;
  };
  /** The car in the garage would take the place of one the police have: nothing is done to it until that is back. */
  const lockedHere = () => !mineOf(vehicle().car) && !!holder(bodyHere())?.p.impounded;

  const refresh = () => {
    const v = vehicle(), car = v.car, dmg = engine.get<DamageApi>('damage');
    const me = mineOf(car), slot = me ?? holder(bodyHere()), lost = pound();
    const p = me ? me.p : { engine: 0, tyres: 0, nitro: 0 };
    menu.render({
      cash: cashOf(), mine: !!me, replaces: !me && slot ? nameOf(slot.p) : null, hasProfile: fleet.length > 0,
      pound: lost ? nameOf(lost.p) : null, locked: lockedHere(),
      engine: p.engine, tyres: p.tyres, nitro: p.nitro,
      carLevels: slot ? { engine: slot.p.engine, tyres: slot.p.tyres, nitro: slot.p.nitro } : null,
      health: Math.round(dmg?.health() ?? 100),
      taxi: v.look.taxi,
      dashcam: !!engine.get<{ name: string; dashcam: boolean }>('npc')?.dashcam,
      discount: contacts()?.discount ?? 0,
      stolen: stolenHere(),
      ownBodies: fleet.map((m) => m.p.body),
      others: fleet.flatMap((m, i) => m === me || m.p.impounded ? [] : [{ i, name: nameOf(m.p) }]),
    });
  };

  /**
   * One of your cars rolls into the garage (bought back from the pound, or fetched from wherever it is); the one you
   * came in goes out on the drive (still yours, if it was).
   */
  const rollIn = (m: Mine) => {
    const v = vehicle(), was = v.car, wasLook = { ...v.look, upper: v.look.upper.clone(), lower: v.look.lower.clone(), parked: true };
    const tr = engine.get<TrafficCars & TrafficApi>('traffic');
    let car = stillOut(m);
    if (car && !m.p.impounded) tr?.takeCar(car);
    car ??= new Vehicle(engine.physics, SPEC_OF[m.p.body] ?? TAXI, { x: 0, y: -600, z: 0 }, 0);
    car.body.setEnabled(true);
    car.reset({ x: ax + PARK_AT.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: az + PARK_AT.z }, PARK_AT.yaw);
    was.reset({ x: ax + (DRIVE.in.x0 + DRIVE.in.x1) / 2, y: 0.03 + was.spec.wheelRadius + 0.1, z: az + (DRIVE.in.z0 + DRIVE.in.z1) / 2 }, -Math.PI / 2);
    const prev = v.swapCar(car, lookOf(m.p));
    tr?.parkCar(prev.car, wasLook);
    m.car = car; m.p.impounded = false; cur = m; lastCar = car;
    apply(car, m.p); car.nitroFill = car.tune.nitro > 0 ? 1 : 0;
    save();
  };

  /**
   * A new luxury car from the 车行: it rolls into the garage stock, in its own paint, and is the car you drive now; the
   * one you came in goes out on the drive, a parked car (still yours, if it was).
   */
  const buyCar = (body: LuxuryBody): boolean => {
    const d = DEALER.find((x) => x.body === body)!;
    if (holder(body) || cashOf() < d.price) return false;
    // the model comes after the title; if it is somehow not in yet, fetch it and ask again
    if (!loaded(body)) return false;
    pay(d.price);
    const v = vehicle(), was = v.car, wasLook = { ...v.look, upper: v.look.upper.clone(), lower: v.look.lower.clone(), parked: true };
    const car = new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -600, z: 0 }, 0);
    car.reset({ x: ax + PARK_AT.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: az + PARK_AT.z }, PARK_AT.yaw);
    was.reset({ x: ax + (DRIVE.in.x0 + DRIVE.in.x1) / 2, y: 0.03 + was.spec.wheelRadius + 0.1, z: az + (DRIVE.in.z0 + DRIVE.in.z1) / 2 }, -Math.PI / 2);
    const paint = new THREE.Color(d.paint);
    const prev = v.swapCar(car, { upper: paint, lower: paint.clone(), taxi: false, parked: true, body });
    if (!mineOf(prev.car)) stock(prev.car);
    engine.get<TrafficCars>('traffic')?.parkCar(prev.car, wasLook);
    cur = { p: { body, upper: d.paint, lower: d.paint, taxi: false, engine: 0, tyres: 0, nitro: 0, impounded: false }, car };
    fleet.push(cur); lastCar = car;
    apply(car, cur.p);
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

  /** Tell the player where the car brought to them stands, from where they look. */
  const sayWhere = (at: { x: number; z: number }, name: string) => {
    const me = pl.position, cam = engine.camera.getWorldDirection(new THREE.Vector3());
    const rx = at.x - me.x, rz = at.z - me.z, m = Math.round(Math.hypot(rx, rz));
    const ahead = (rx * cam.x + rz * cam.z) / Math.max(1, m), side = (rx * cam.z - rz * cam.x) / Math.max(1, m);
    const where = Math.abs(ahead) >= Math.abs(side) ? (ahead > 0 ? 'ahead' : 'behind') : (side > 0 ? 'left' : 'right');
    toast(t('garage.delivered', { car: name, where: t(`garage.where.${where}` as 'garage.where.ahead'), m }));
  };

  /**
   * The phone's 车行 (2026-10-19, 「现在买车只能回家在车库买吗？感觉不方便」): the car is brought new to the kerb beside
   * you and waits there with a flashing blip; it is yours (saved) at once, and the car you drive once you get in. Your
   * other cars stay yours. Not while wanted, nor where nothing can stop.
   */
  const order = (body: LuxuryBody): boolean => {
    const d = DEALER.find((x) => x.body === body)!;
    if (holder(body) || cashOf() < d.price) return false;
    if (wanted()) { toast(t('garage.dealerWanted')); return false; }
    if (!loaded(body)) return false;
    const at = spot();
    if (!at) { toast(t('garage.noSpot')); return false; }
    pay(d.price);
    const car = new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -600, z: 0 }, 0);
    car.reset({ x: at.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: at.z }, at.yaw);
    const m: Mine = { p: { body, upper: d.paint, lower: d.paint, taxi: false, engine: 0, tyres: 0, nitro: 0, impounded: false }, car };
    fleet.push(m);
    cur ??= m;
    apply(car, m.p);
    save();
    engine.get<TrafficCars>('traffic')?.parkCar(car, lookOf(m.p));
    delivered = car; deliveredName = nameOf(m.p);
    sayWhere(at, deliveredName);
    return true;
  };

  /**
   * One of your cars brought to the kerb beside you (2026-10-21, 「叫自己的车过来要收钱」), from home or from wherever you
   * left it, for `PRICE.call`; the same rules as an order.
   */
  const call = (m: Mine): boolean => {
    const v = vehicle();
    if (m.p.impounded || (m.car === v.car && pl.mode === 'driving') || cashOf() < PRICE.call) return false;
    if (wanted()) { toast(t('garage.dealerWanted')); return false; }
    if (!loaded(m.p.body)) return false;
    const at = spot();
    if (!at) { toast(t('garage.noSpot')); return false; }
    pay(PRICE.call);
    let car = stillOut(m);
    if (car && car === v.car) {
      // the one you got out of, somewhere else: it is still the player's vehicle, just moved
      car.reset({ x: at.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: at.z }, at.yaw);
    } else {
      if (car) engine.get<TrafficApi>('traffic')?.takeCar(car);
      car ??= new Vehicle(engine.physics, SPEC_OF[m.p.body] ?? TAXI, { x: 0, y: -600, z: 0 }, 0);
      car.body.setEnabled(true);
      car.reset({ x: at.x, y: 0.03 + car.spec.wheelRadius + 0.1, z: at.z }, at.yaw);
      apply(car, m.p);
      engine.get<TrafficCars>('traffic')?.parkCar(car, lookOf(m.p));
    }
    m.car = car;
    delivered = car; deliveredName = nameOf(m.p);
    sayWhere(at, deliveredName);
    return true;
  };

  const buy = (item: Item, paint?: string): boolean => {
    const v = vehicle();
    if (isCarItem(item)) {
      if (!buyCar(item.slice(4) as LuxuryBody)) return false;
    } else if (item.startsWith('fetch:')) {
      const m = fleet[Number(item.slice(6))];
      if (!m || m.p.impounded || m.car === v.car) return false;
      if (!loaded(m.p.body)) return false;
      rollIn(m);
      toast(t('garage.fetched', { car: nameOf(m.p) }));
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
      const me = mineOf(v.car);
      if (me) { me.p.upper = hex(v.look.upper); me.p.lower = hex(v.look.lower); save(); }
    } else if (item === 'impound') {
      const m = pound();
      if (!m) return false;
      if (!loaded(m.p.body)) return false;
      if (!pay(PRICE.impound)) return false;
      // Your car rolls out into the garage; whatever you came in with goes out on the drive.
      rollIn(m);
      toast(t('garage.back'));
    } else if (item === 'engine' || item === 'tyres' || item === 'nitro') {
      if (stolenHere() || lockedHere()) return false;
      const me = mineOf(v.car);
      const have = me ? me.p[item] : (holder(bodyHere())?.p[item] ?? 0);
      const prices = PRICE[item];
      if (have >= prices.length || !pay(priced(prices[have]))) return false;
      if (!me) own();
      cur!.p[item] = have + 1;
      apply(v.car, cur!.p);
      if (item === 'nitro') v.car.nitroFill = 1;
      save();
      toast(t(`garage.bought.${item}` as 'garage.bought.engine', { n: have + 1 }));
    } else return false;
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
  const dealerView = () => {
    const v = vehicle();
    return {
      cash: cashOf(), wanted: wanted(),
      mine: fleet.map((m, i) => ({
        i, name: nameOf(m.p), levels: m.p,
        state: (m.p.impounded ? 'pound' : m.car === v.car && pl.mode === 'driving' ? 'driving' : 'call') as 'pound' | 'driving' | 'call',
      })),
      ownBodies: fleet.map((m) => m.p.body),
    };
  };
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
    // ordered (or one of yours sent for): back to the street to fetch it
    const ok = isCarItem(item) ? order(item.slice(4) as LuxuryBody)
      : item.startsWith('call:') ? !!fleet[Number(item.slice(5))] && call(fleet[Number(item.slice(5))]) : false;
    if (ok) closeDealer(); else menu.renderDealer(dealerView());
  };
  menu.onClose = () => { if (dealerOpen) closeDealer(); else hide(); };
  // 「🚗 买车」 by the cash, B on a keyboard (2026-10-21, 「重新设计下买车的入口，现在不明显」)
  const HINT_KEY = 'drivecity.dealerHint.v1';
  let buyButton: BuyButton | null = null, hinted = (() => { try { return !!localStorage.getItem(HINT_KEY); } catch { return false; } })();
  /** A car you do not have yet is within reach. */
  const canAfford = () => DEALER.some((d) => !holder(d.body) && cashOf() >= d.price);
  const updateBuy = () => {
    const ui = engine.get<UiApi>('ui');
    const intro = engine.get<{ name: string; step: string }>('intro')?.step ?? 'off';
    const playing = ui?.state === 'playing' && (intro === 'off' || intro === 'done');
    if (playing && engine.input.state.dealerPressed) { engine.input.state.dealerPressed = false; dealer(); return; }
    if (!buyButton) {
      const hud = document.querySelector<HTMLElement>('.hud');
      if (!hud) return;
      buyButton = new BuyButton(hud, !!engine.input.touch, dealer);
    }
    const ready = playing && canAfford();
    buyButton.update(playing, ready);
    // the first time a car is affordable, say where to buy it
    if (ready && !hinted) {
      hinted = true;
      try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
      toast(t(engine.input.touch ? 'garage.buyHint' : 'garage.buyHintKey'));
    }
  };
  // the car brought to you flashes on the map until you are in it
  engine.get<NavApi>('nav')?.addBlips(() => {
    if (!delivered) return [];
    if (vehicle().car === delivered) { delivered = null; return []; }
    return [{ kind: 'car' as const, x: delivered.pos.x, z: delivered.pos.z, flash: true, label: deliveredName }];
  });

  // A new session: the car you drove last (or, if the police still have it, another of yours), where the taxi would
  // have started. Your other cars are at home.
  engine.events.on('game:start', () => {
    if (!cur) return;
    const v = vehicle();
    if (cur.p.impounded) {
      setTimeout(() => toast(t('garage.stillImpounded', { n: PRICE.impound })), 1500);
      const free = fleet.find((m) => !m.p.impounded);
      if (!free) return;
      cur = free;
    }
    const p = cur.p;
    const same = (v.look.body ?? 'sedan') === p.body && v.look.taxi === p.taxi;
    if (same) {
      v.look.upper.set(p.upper); v.look.lower.set(p.lower);
      v.model.setPaint(v.look.upper, v.look.lower, v.look.taxi);
      cur.car = v.car;
    } else {
      cur.car = new Vehicle(engine.physics, SPEC_OF[p.body] ?? TAXI, { x: 0, y: -600, z: 0 }, 0);
      swapHere(cur.car, lookOf(p));
    }
    lastCar = cur.car;
    apply(cur.car, p);
    cur.car.nitroFill = cur.car.tune.nitro > 0 ? 1 : 0;
  });

  // Busted: the fine, and your car to the pound if you were in it. The swap waits for the respawn
  // (the police reset the car to the spawn), so the busted screen still shows the car you were in.
  engine.events.on('wanted:busted', ({ level }) => {
    const fine = Math.min(cashOf(), Math.round((FINE.base + FINE.perStar * Math.max(1, level)) * (contacts()?.fineScale ?? 1)));
    if (fine > 0) engine.get<MissionApi>('missions')?.addCash(-fine);
    const v = vehicle();
    impoundNext = !!cur?.car && v.car === cur.car;
    setTimeout(() => toast(impoundNext ? t('garage.impounded', { fine, n: PRICE.impound }) : t('garage.fined', { fine })), 3600);
  });
  engine.events.on('vehicle:reset', () => {
    if (!impoundNext) return;
    impoundNext = false;
    const taxi = new Vehicle(engine.physics, TAXI, { x: 0, y: -600, z: 0 }, 0);
    swapHere(taxi, { upper: new THREE.Color('#f3b50f'), lower: new THREE.Color('#1f5e3c'), taxi: true, body: 'sedan' });
    if (cur) { cur.p.impounded = true; save(); }
  });

  const api: GarageApi = {
    name: 'garage',
    get open() { return open; },
    get owned() { return cur?.car ?? null; },
    get profile() { return cur?.p ?? null; },
    show,
    dealer,
    adopt(levels) {
      own();
      const m = cur!;
      m.p.engine = levels.engine; m.p.tyres = levels.tyres; m.p.nitro = levels.nitro;
      apply(m.car!, m.p);
      m.car!.nitroFill = m.car!.tune.nitro > 0 ? 1 : 0;
      save();
    },
    debug: {
      buy, order,
      call: (i) => !!fleet[i] && call(fleet[i]),
      fleet: () => fleet.map((m) => ({ body: m.p.body, impounded: m.p.impounded, out: !!m.car, engine: m.p.engine, cur: m === cur })),
    },
    fixedUpdate(dt) {
      const v = vehicle(), car = v.car;
      // Got into one of your cars: it is the one you drive now (its upgrades are on it already).
      if (car !== lastCar) {
        lastCar = car;
        const m = mineOf(car);
        if (m && m !== cur && !m.p.impounded) { cur = m; apply(car, m.p); save(); }
      }
      // One of yours left on the street that the street has taken back (despawned, its Vehicle reused): it is at home.
      if ((liveT -= dt) <= 0) {
        liveT = 1;
        const tr = engine.get<TrafficApi>('traffic');
        let cars: Vehicle[] | null = null;
        if (tr) for (const m of fleet) {
          if (!m.car || m.p.impounded || m.car === car) continue;
          cars ??= tr.cars();
          if (!cars.includes(m.car)) { stock(m.car); if (delivered === m.car) delivered = null; m.car = null; }
        }
      }
      const inside = pl.mode === 'driving' && v.occupied && inGarage(car.pos.x, car.pos.z);
      if (!inside) { dismissed = false; return; }
      if (!open && !dismissed && car.speed < 1.2) show();
    },
    update() {
      updateBuy();
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
