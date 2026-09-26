import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { Blip, Crime, HudApi, NavApi, PlayerApi, RenderApi, VehicleApi, WantedApi, WorldApi, PeopleApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { FxApi } from '../fx';
import { CarKit } from '../traffic/CarKit';
import { POLICE_LIVERY, type Livery } from '../vehicle/CarModel';
import { ControlFilter, type DriveInput } from '../vehicle/ControlFilter';
import { SUV, TAXI, type VehicleSpec } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { HELI_SIGHT, PoliceHeli } from './Heli';
import { Pursuit, type Goal, type Router } from './Pursuit';
import { WantedHud } from './WantedHud';

const stronger = (s: VehicleSpec, k: number, kmh: number): VehicleSpec =>
  ({ ...s, engine: { ...s.engine, torque: s.engine.torque.map(([r, n]) => [r, n * k] as [number, number]), limiterKmh: kmh } });
/** Police cars: the taxi chassis with a much stronger engine. */
const POLICE = stronger(TAXI, 1.55, 230);
/** 特警 (four stars and up): black SUVs, heavy and quick, built to ram. */
const SWAT = stronger(SUV, 1.7, 210);
const SWAT_LIVERY: Livery = { upper: '#17191c', lower: '#17191c', roofSign: null, beacons: true, plate: { text: '京A·0110警', bg: '#f2f2ee', fg: '#111111' }, doorText: '特警 SWAT', doorColor: '#e9e9e4' };
/**
 * Police cars in the chase per star (GTA-style: a couple at one star, the streets full of them at
 * five). The low tier gets about two thirds. Roadblocks come on top.
 */
const COUNT = [0, 3, 5, 8, 11, 14];
/** 特警 SUVs among them, from four stars. */
const SWAT_COUNT = [0, 0, 0, 0, 2, 4];
/** Seconds between arrivals per star (the first car of a chase comes at once). */
const SPAWN_GAP = [0, 1.6, 1.1, 0.8, 0.6, 0.45];
const WHITE = new THREE.Color('#f4f5f3'), BLUE = new THREE.Color('#1c47a8'), BLACK = new THREE.Color('#17191c');
/** Heat per crime, in stars (half as much once already wanted). */
const HEAT: Record<Crime, number> = { hit_person: 1, carjack: 1, hit_police: 1, ram: 0.35, speeding: 1, report: 1 };
const STOP: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
/** Where they look once they have lost sight of the player: 175 m at one star, 395 at five. */
const searchRadius = (lv: number) => 120 + 55 * lv;
/** Seconds out of sight (outside the circle) to lose them. */
const evadeTime = (lv: number) => 7 + 3.5 * lv;
/**
 * Seconds dispatch knows where the player is after a new star (the crime was just called in: GTA's
 * police drive straight to you before they have to find you), and after each sighting (breaking line
 * of sight round one corner does not start a search).
 */
const KNOWN_ON_STAR = (lv: number) => 8 + 2 * lv;
const KNOWN_AFTER_SIGHT = 3;
/** How far a police car sees the player. */
const sightRange = (lv: number) => 80 + 18 * lv;

type Role = 'chase' | 'intercept';
interface Cop {
  car: Vehicle; driver: Pursuit; filter: ControlFilter; active: boolean; swat: boolean;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  sees: boolean; flipped: number; goal: Goal; search: { x: number; z: number; t: number };
  /** Seconds left parked across the road as a roadblock (0: chasing). */
  block: number;
  /** Chasers come up behind; interceptors were sent ahead of the player and come at them head-on. */
  role: Role;
  /** 0..hp; a wrecked car (`wreck` >= 0, seconds since) stops, smokes and is left behind. */
  hp: number; wreck: number; hitT: number; smokeT: number;
}

export interface PoliceSystem extends WantedApi {
  /** Shots and testing: force a wanted level; `noBust` keeps the player free. */
  debug: { setLevel(n: number): void; noBust: boolean; cops(): { x: number; z: number; speed: number; role: string; sees: boolean; swat: boolean; hp: number; wreck: number; block: number; boost: number; forward: number }[] };
}

/**
 * The wanted level and the police. Crimes the police witness (or that someone reports) add heat;
 * whole stars bring police cars, spawned out of sight on the road graph, that chase the player
 * (direct when they can see them, by road otherwise), box them in and bust them. Out of sight,
 * police search around the last sighting; staying outside that circle long enough loses them.
 * Implements WantedApi as the system 'wanted'.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph;
  const rng = new Rng(110);
  const rnd = () => rng.next();
  const low = engine.quality.tier === 'low';
  const scale = low ? 0.65 : 1;
  const count = (lv: number) => Math.round(COUNT[lv] * scale);
  // Chasing cars plus a three-car roadblock; the SUVs are their own pool.
  const MAX_CAR = count(5) + 3, MAX_SWAT = SWAT_COUNT[5];
  const kit = new CarKit(engine.scene, MAX_CAR, POLICE_LIVERY);
  const swatKit = new CarKit(engine.scene, MAX_SWAT, SWAT_LIVERY, 'suv');
  const makeCop = (i: number, swat: boolean): Cop => {
    const spec = swat ? SWAT : POLICE;
    const car = new Vehicle(engine.physics, spec, { x: 0, y: -400 - i * 6, z: 0 }, 0);
    car.body.setEnabled(false);
    return { car, driver: new Pursuit(), filter: new ControlFilter(), active: false, swat, prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(),
      sees: false, flipped: 0, goal: { x: 0, z: 0, vx: 0, vz: 0 }, search: { x: 0, z: 0, t: 0 }, block: 0, role: 'chase', hp: 100, wreck: -1, hitT: 0, smokeT: 0 };
  };
  const cops: Cop[] = [...Array.from({ length: MAX_CAR }, (_, i) => makeCop(i, false)), ...Array.from({ length: MAX_SWAT }, (_, i) => makeCop(MAX_CAR + i, true))];
  const onStreet: Vehicle[] = [];
  const hud = new WantedHud();
  const heli = new PoliceHeli(engine.scene);
  queueMicrotask(() => engine.get<RenderApi & { prepare?(o: THREE.Object3D): void }>('render')?.prepare?.(heli.group));
  // Light-bar glow on the nearest police car. Always in the scene: a light appearing would recompile every material.
  const glowR = new THREE.PointLight('#ff2a2a', 0, 30, 1.6), glowB = new THREE.PointLight('#2e62ff', 0, 30, 1.6);
  engine.scene.add(glowR, glowB);

  let heat = 0, seen = false, lastX = 0, lastZ = 0, evade = 0, bust = 0, busted = -1, clock = 0, spawnT = 0, losT = 0, sirenD = Infinity, blockT = 12, heliD = Infinity, interceptT = 0, known = 0;
  const intercept = { x: 0, z: 0 };
  let blipsOn = false;
  const area = { x: 0, z: 0, r: 0 };
  const startLevel = Math.max(0, Math.min(5, Number(new URLSearchParams(location.search).get('wanted') ?? 0) || 0));
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const level = () => Math.floor(heat);
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const camDir = new THREE.Vector3(), renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion(), nearPos = new THREE.Vector3(), nearLeft = new THREE.Vector3();
  const losGroups = groups(CG.CAR, CG.WORLD);
  const roofGroups = groups(CG.CAR, CG.WORLD);
  const down = { x: 0, y: -1, z: 0 };
  /** Height of whatever stands at (x, z): what the helicopter must clear. */
  const roof = (x: number, z: number): number => { const h = engine.physics.raycast({ x, y: 420, z }, down, 440, roofGroups, true); return h ? h.point[1] : 0; };
  const dir = { x: 0, y: 0, z: 0 };
  const P = { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0 };

  /** Where the player is and how they move (in the car or on foot). */
  const readPlayer = () => {
    const f = pl.foot, car = vehicle().car;
    if (f) { P.x = f.pos.x; P.y = f.pos.y; P.z = f.pos.z; P.vx = f.vel.x; P.vz = f.vel.z; }
    else { P.x = car.pos.x; P.y = car.pos.y - 0.5; P.z = car.pos.z; P.vx = car.vel.x; P.vz = car.vel.z; }
    P.speed = Math.hypot(P.vx, P.vz);
  };

  /** A police car's view of a point: within range and no building in between (other cars don't block). */
  const canSee = (car: Vehicle, x: number, y: number, z: number, range: number): boolean => {
    const oy = car.pos.y + 1.1, dx = x - car.pos.x, dy = y - oy, dz = z - car.pos.z, d = Math.hypot(dx, dy, dz);
    if (d > range) return false;
    if (d < 6) return true;
    dir.x = dx / d; dir.y = dy / d; dir.z = dz / d;
    return !engine.physics.raycast({ x: car.pos.x, y: oy, z: car.pos.z }, dir, d - 1.5, losGroups, true);
  };

  /** Line of sight from a point (the helicopter) to the player. */
  const canSeeFrom = (o: THREE.Vector3, x: number, y: number, z: number, range: number): boolean => {
    const dx = x - o.x, dy = y - o.y, dz = z - o.z, d = Math.hypot(dx, dy, dz);
    if (d > range) return false;
    dir.x = dx / d; dir.y = dy / d; dir.z = dz / d;
    return !engine.physics.raycast({ x: o.x, y: o.y, z: o.z }, dir, d - 1.5, losGroups, true);
  };

  const despawn = (c: Cop) => {
    c.active = false; c.car.boost = 0;
    c.car.body.setTranslation({ x: 0, y: -400, z: 0 }, false);
    c.car.body.setEnabled(false);
  };

  /**
   * A police car out of sight on a main road round (cx, cz): 110-260 m from the player while they
   * are seen, anywhere within `r` of the search circle's centre while they are not (never within
   * 110 m of the player). `ahead`: dispatched to meet the player, 150-330 m ahead of where they
   * are going, to come at them head-on - GTA's police arrive from every side, not in a queue behind.
   */
  const spawnCop = (cx: number, cz: number, swat: boolean, ahead = false, r = 260): Cop | null => {
    const c = cops.find((k) => !k.active && k.swat === swat);
    if (!c) return null;
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    let hx = P.vx, hz = P.vz;
    if (Math.hypot(hx, hz) < 4) { hx = camDir.x; hz = camDir.z; }
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const ox = ahead ? cx + hx * 240 : cx, oz = ahead ? cz + hz * 240 : cz, rr = ahead ? 140 : r;
    const ids = g.near(ox, oz, rr);
    for (let attempt = 0; attempt < 20 && ids.length; attempt++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      if (l.len < 30 || l.cls === 'service' || l.cls === 'living_street' || l.cls.endsWith('_link') || l.hmax > 0.3) continue;
      g.at(l, 8 + rnd() * (l.len - 16), g.laneOffset(l, 0), tmp);
      const d = Math.hypot(tmp.x - cx, tmp.z - cz), dp = Math.hypot(tmp.x - P.x, tmp.z - P.z);
      if (dp < 110 || d > (ahead ? 380 : r) || (!ahead && r <= 260 && d < 110)) continue;
      if (ahead && ((tmp.x - P.x) * hx + (tmp.z - P.z) * hz) / dp < 0.35) continue;
      const dc = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (dc < 160 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / dc > 0.3) continue;
      if (onStreet.some((o) => Math.hypot(o.pos.x - tmp.x, o.pos.z - tmp.z) < 15) || tr.nearestCar(tmp.x, tmp.z, 9)) continue;
      c.car.body.setEnabled(true);
      c.car.reset({ x: tmp.x, y: 0.03 + c.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      c.car.setMoving(14);
      c.driver.reset(); c.filter.reset();
      c.prevPos.copy(c.car.pos); c.curPos.copy(c.car.pos); c.prevQuat.copy(c.car.quat); c.curQuat.copy(c.car.quat);
      activate(c);
      c.role = ahead ? 'intercept' : 'chase';
      onStreet.push(c.car);
      return c;
    }
    return null;
  };
  const activate = (c: Cop) => {
    c.active = true; c.flipped = 0; c.sees = false; c.search.t = 0; c.block = 0; c.role = 'chase';
    c.hp = c.swat ? 240 : 150; c.wreck = -1; c.hitT = 0; c.smokeT = 0; c.car.boost = 0;
  };

  /** Where the player will be in a few seconds along their road: the interceptors' meeting point. */
  const aheadOfPlayer = (out: { x: number; z: number }): void => {
    const d = Math.max(60, Math.min(220, P.speed * 5));
    const pl0 = P.speed > 5 ? playerLink() : null;
    if (!pl0) { out.x = P.x + P.vx * 4; out.z = P.z + P.vz * 4; return; }
    let l = g.links[pl0.id], s = pl0.s + d;
    for (let hop = 0; s > l.len && hop < 10; hop++) { const nx = g.next(l.id, rnd); if (nx < 0 || nx === l.id) { s = l.len; break; } s -= l.len; l = g.links[nx]; }
    g.at(l, Math.min(s, l.len), 0, tmp);
    out.x = tmp.x; out.z = tmp.z;
  };

  /** The road the player drives along: nearest link within 25 m pointing the way they move. */
  const playerLink = (): { id: number; s: number } | null => {
    let best: { id: number; s: number } | null = null, bd = 25;
    for (const id of g.near(P.x, P.z, 25)) {
      const l = g.links[id];
      if ((l.d0x + l.d1x) * P.vx + (l.d0z + l.d1z) * P.vz <= 0) continue;
      for (let k = 1; k < l.cum.length; k++) {
        const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], vx = l.pts[k * 2] - ax, vz = l.pts[k * 2 + 1] - az;
        const L2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((P.x - ax) * vx + (P.z - az) * vz) / L2));
        const d = Math.hypot(P.x - ax - vx * u, P.z - az - vz * u);
        if (d < bd) { bd = d; best = { id, s: l.cum[k - 1] + u * Math.sqrt(L2) }; }
      }
    }
    return best;
  };

  /** Three stars and up: two cars (three from four stars) parked across the player's road about 170 m ahead. */
  const roadblock = (lv: number): boolean => {
    const free = cops.filter((k) => !k.active && !k.swat);
    const nb = lv >= 4 ? 3 : 2;
    if (free.length < nb || P.speed < 12) return false;
    const pl0 = playerLink();
    if (!pl0) return false;
    let l = g.links[pl0.id], s = pl0.s + 170;
    for (let hop = 0; s > l.len - 6 && hop < 12; hop++) { s -= l.len; const nx = g.next(l.id, rnd); if (nx < 0 || nx === l.id) return false; l = g.links[nx]; }
    if (s > l.len - 6 || s < 6 || l.lanes < 1 || l.hmax > 0.3) return false;
    // Across the carriageway from lane 0 outwards, a car's length apart.
    const offs = [0, 1, 2].map((k) => (k < l.lanes ? g.laneOffset(l, k) : g.laneOffset(l, 0) - 3.1 * k));
    for (let i = 0; i < nb; i++) {
      g.at(l, s + i * 1.5, offs[i], tmp);
      if (tr.nearestCar(tmp.x, tmp.z, 7)) return false;
    }
    for (let i = 0; i < nb; i++) {
      const c = free[i];
      g.at(l, s + i * 1.5, offs[i], tmp);
      c.car.body.setEnabled(true);
      c.car.reset({ x: tmp.x, y: 0.03 + TAXI.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz) + (i % 2 ? -1 : 1) * Math.PI / 2);
      c.driver.reset(); c.filter.reset();
      c.prevPos.copy(c.car.pos); c.curPos.copy(c.car.pos); c.prevQuat.copy(c.car.quat); c.curQuat.copy(c.car.quat);
      activate(c); c.block = 45;
      onStreet.push(c.car);
    }
    return true;
  };

  /** A new star: tell the player what it means, and let the HUD and the siren stinger react. */
  const levelUp = (lv: number) => {
    known = Math.max(known, KNOWN_ON_STAR(lv));
    engine.get<HudApi>('hud')?.toast(t(`wanted.up${Math.min(5, lv)}` as 'wanted.up1'));
    engine.events.emit('wanted:level', { level: lv, up: true });
  };

  const crime = (kind: Crime, x: number, z: number) => {
    if (busted >= 0) return;
    let witnessed = kind === 'hit_police' || kind === 'report';
    for (const c of cops) if (!witnessed && c.active && canSee(c.car, x, 1, z, 90)) witnessed = true;
    // Otherwise it only counts if someone on the pavement phones it in (people/: they stop and
    // dial, and `people:report` arrives a few seconds later unless they are scared off first).
    if (!witnessed) { if (kind === 'hit_person' || kind === 'carjack') engine.get<PeopleApi>('people')?.witness(x, z); return; }
    const before = level();
    heat = Math.min(5.99, heat + HEAT[kind] * (level() === 0 ? 1 : 0.5));
    if (level() > 0) { lastX = x; lastZ = z; seen = true; evade = 0; known = Math.max(known, KNOWN_AFTER_SIGHT); }
    if (level() > before) levelUp(level());
  };

  const clear = () => {
    heat = 0; seen = false; evade = 0; bust = 0; busted = -1; known = 0;
    api.debug.noBust = false;
    for (const c of cops) if (c.active) despawn(c);
    onStreet.length = 0;
    heli.despawn();
    hud.busted(false);
    const nav = engine.get<NavApi>('nav');
    if (nav) nav.searchArea = null;
  };

  const respawn = () => {
    clear();
    const w = engine.get<WorldApi>('world')!, v = vehicle();
    v.reset({ x: w.spawn.x, y: w.spawn.y, z: w.spawn.z }, w.spawn.yaw);
    void w.preload?.(w.spawn.x, w.spawn.z);
    v.inputEnabled = true;
  };

  engine.events.on('people:hit', (e) => { if (e.byPlayer) crime('hit_person', e.x, e.z); });
  engine.events.on('people:report', (e) => crime('report', e.x, e.z));
  engine.events.on('player:mode', (e) => { if (e.carjacked) { readPlayer(); crime('carjack', P.x, P.z); } });
  /** The player drove into (ox, oz): moving, and mostly towards it (being rammed is not a crime). */
  const atFault = (car: Vehicle, ox: number, oz: number) => {
    if (car.speed < 4) return false;
    const dx = ox - car.pos.x, dz = oz - car.pos.z;
    return (dx * car.vel.x + dz * car.vel.z) / (Math.hypot(dx, dz) || 1) > car.speed * 0.4;
  };
  engine.events.on('vehicle:impact', (e) => {
    const v = vehicle();
    if (!v.occupied || e.strength < 2) return;
    const car = v.car, [x, , z] = e.point;
    if (Math.hypot(x - car.pos.x, z - car.pos.z) > 4) return;
    for (const c of cops) {
      if (c.active && Math.hypot(c.car.pos.x - car.pos.x, c.car.pos.z - car.pos.z) < 5.5) {
        if (atFault(car, c.car.pos.x, c.car.pos.z)) crime('hit_police', x, z);
        return;
      }
    }
    const other = e.strength > 4 ? tr.nearestCar(car.pos.x, car.pos.z, 5.5) : null;
    if (other && atFault(car, other.pos.x, other.pos.z)) crime('ram', x, z);
  });
  engine.events.on('game:start', () => { if (startLevel) api.debug.setLevel(startLevel); });

  const api: PoliceSystem = {
    name: 'wanted',
    get level() { return level(); },
    get seen() { return seen; },
    get sirenDistance() { return level() > 0 || busted >= 0 ? sirenD : Infinity; },
    get evade() { const lv = level(); return lv > 0 && !seen ? Math.min(1, evade / evadeTime(lv)) : 0; },
    get heliDistance() { return heliD; },
    policeCars: () => onStreet,
    crime, clear,
    debug: {
      setLevel(n) {
        heat = Math.max(0, Math.min(5.99, n));
        readPlayer(); lastX = P.x; lastZ = P.z; seen = n > 0; evade = 0; known = n > 0 ? KNOWN_ON_STAR(Math.floor(heat)) : 0;
      },
      noBust: false,
      cops: () => cops.filter((c) => c.active).map((c) => ({ x: c.car.pos.x, z: c.car.pos.z, speed: c.car.speed, role: c.role, sees: c.sees, swat: c.swat, hp: c.hp, wreck: c.wreck, block: c.block, boost: c.car.boost, forward: c.driver.input.forward })),
    },
    fixedUpdate(dt) {
      clock += dt;
      readPlayer();
      // nav installs after police: hand it the blips on the first step it is there.
      if (!blipsOn) { const nv = engine.get<NavApi>('nav'); if (nv) { blipsOn = true; nv.addBlips(blipProvider); } }
      if (busted >= 0) {
        busted += dt;
        for (const c of cops) if (c.active) { c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat); c.car.boost = 0; c.car.step(c.filter.update(STOP, c.car.forwardSpeed, dt), dt); }
        heli.step(dt, true, P.x, P.y, P.z, 0, 0, 0, roof);
        if (busted > 3.4) respawn();
        return;
      }
      let lv = level();
      const hidden = engine.get<{ name: string; contains(x: number, y: number, z: number): boolean }>('underground')?.contains(P.x, P.y, P.z) ?? false;
      // Who can see the player: a few rays per second.
      losT -= dt;
      if (lv > 0 && losT <= 0) {
        losT = 0.25;
        for (const c of cops) c.sees = c.active && c.wreck < 0 && c.block <= 0 && !hidden && canSee(c.car, P.x, P.y + 1, P.z, sightRange(lv));
        // Roadblocks see too, but only down the road in front of them.
        for (const c of cops) if (c.active && c.block > 0 && !hidden) c.sees = canSee(c.car, P.x, P.y + 1, P.z, 90);
        heli.sees = heli.active && !hidden && canSeeFrom(heli.pos, P.x, P.y + 1, P.z, HELI_SIGHT);
      }
      const nav = engine.get<NavApi>('nav');
      if (lv > 0) {
        const spotted = heli.sees || cops.some((c) => c.active && c.sees);
        if (spotted) known = Math.max(known, KNOWN_AFTER_SIGHT);
        known = hidden ? 0 : Math.max(0, known - dt);
        if (spotted || known > 0) {
          seen = true; lastX = P.x; lastZ = P.z; evade = 0;
          if (spotted && heat < 4.99) { const b = level(); heat = Math.min(4.99, heat + dt / 90); if (level() > b) levelUp(level()); }   // a long chase escalates, up to four stars
        } else {
          seen = false;
          // Down in the underground car park counts as gone: they cannot see through the slab.
          const outside = hidden || Math.hypot(P.x - lastX, P.z - lastZ) > searchRadius(lv);
          evade += dt * (outside ? 1 : 0.3);
          if (evade > evadeTime(lv)) {
            heat = 0; evade = 0; lv = 0;
            engine.get<HudApi>('hud')?.toast(t('wanted.lost'));
            engine.events.emit('wanted:level', { level: 0, up: false });
          }
        }
      } else { seen = false; heat = Math.max(0, heat - dt * 0.02); }
      if (nav) {
        area.x = lastX; area.z = lastZ; area.r = searchRadius(lv);
        nav.searchArea = lv > 0 && !seen ? area : null;
      }
      // Bring cars in: chasers behind, interceptors ahead, 特警 from four stars.
      spawnT -= dt;
      let chasing = 0, swats = 0, ahead = 0;
      for (const c of cops) if (c.active && c.block <= 0 && c.wreck < 0) { chasing++; if (c.swat) swats++; if (c.role === 'intercept') ahead++; }
      if (lv > 0 && spawnT <= 0 && chasing < count(lv)) {
        spawnT = chasing === 0 ? 0.2 : SPAWN_GAP[lv];
        const swat = swats < SWAT_COUNT[lv];
        // While they can see the player, every other new car is sent ahead to cut them off.
        const sendAhead = seen && lv >= 2 && P.speed > 8 && ahead < Math.ceil(chasing / 2);
        const c = seen ? spawnCop(P.x, P.z, swat, sendAhead) ?? spawnCop(P.x, P.z, swat) : spawnCop(lastX, lastZ, swat, false, searchRadius(lv));
        if (!c && swat) spawnCop(seen ? P.x : lastX, seen ? P.z : lastZ, false);
      }
      blockT -= dt;
      if (lv >= 3 && seen && blockT <= 0) blockT = roadblock(lv) ? (lv >= 4 ? 20 : 28) : 3;
      // The helicopter: three stars and up.
      if (lv >= 3 && !heli.active) heli.spawn(P.x, P.z, P.vx || camDir.x, P.vz || camDir.z);
      else if (lv < 3 && heli.active) heli.leave();
      interceptT -= dt;
      if (interceptT <= 0) { interceptT = 0.8; aheadOfPlayer(intercept); }
      // Drive.
      const router: Router | null = nav ? (a, b, c, d, e) => nav.route(a, b, c, d, e) : null;
      for (const c of cops) {
        if (!c.active) continue;
        c.hitT = Math.max(0, c.hitT - dt);
        if (c.wreck >= 0 || c.block > 0) {
          // Wrecked, or parked across the road until the player is close (or the block times out), then give chase.
          if (c.wreck >= 0) c.wreck += dt;
          else { c.block -= dt; if (Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z) < 22 || lv === 0) c.block = 0; }
          c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat);
          c.car.boost = 0;
          c.car.step(c.filter.update(STOP, c.car.forwardSpeed, dt), dt);
          continue;
        }
        const gl = c.goal;
        const dp = Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z);
        let direct = false, gentle = false;
        // An interceptor that has met the player (or been passed) turns into a chaser.
        if (c.role === 'intercept' && (dp < 60 || (c.car.pos.x - P.x) * P.vx + (c.car.pos.z - P.z) * P.vz < 0)) c.role = 'chase';
        if (lv === 0) {
          // Standing down: roll on along the road until out of sight.
          gl.x = c.car.pos.x + c.car.fwd.x * 60; gl.z = c.car.pos.z + c.car.fwd.z * 60; gl.vx = gl.vz = 0;
          direct = true; gentle = true; c.driver.topSpeed = 11;
        } else if (seen && c.role === 'intercept') {
          gl.x = intercept.x; gl.z = intercept.z; gl.vx = gl.vz = 0;
          c.driver.topSpeed = 30 + 3 * lv;
        } else if (seen) {
          gl.x = P.x; gl.z = P.z; gl.vx = P.vx; gl.vz = P.vz;
          // Straight at them only up close: further out a straight line cuts the corners through the trees and lamp posts.
          direct = c.sees && dp < 45;
          c.driver.topSpeed = 28 + 3 * lv + (c.swat ? 2 : 0);
        } else {
          const s = c.search;
          s.t -= dt;
          if (s.t <= 0 || Math.hypot(s.x - c.car.pos.x, s.z - c.car.pos.z) < 15) {
            const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * searchRadius(lv) * 0.85;
            s.x = lastX + Math.cos(a) * r; s.z = lastZ + Math.sin(a) * r; s.t = 12;
          }
          gl.x = s.x; gl.z = s.z; gl.vx = gl.vz = 0;
          c.driver.topSpeed = 18 + 1.5 * lv;
        }
        // One star: box in. Two: PIT the rear quarter. Three and up: half of them PIT, half (and every 特警) ram.
        const pit = seen && lv >= 2 && !c.swat && (lv < 3 || (cops.indexOf(c) & 1) === 0);
        const ram = seen && !pit && (lv >= 3 || (c.swat && lv > 0));
        const inp = c.driver.update(c.car, gl, direct, dt, router, gentle, ram, pit);
        // Catching up: a chaser falling behind on the straight gets a push (their engines are tuned; GTA's cops are never far behind).
        const behind = lv > 0 && seen && dp > 30 && inp.forward > 0.9 && Math.abs(inp.steer) < 0.3 && c.car.forwardSpeed > 8;
        c.car.boost = behind ? Math.min(5 + lv * 0.6, 1.5 + (dp - 30) * 0.06 + lv * 0.5) : 0;
        c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat);
        c.car.step(c.filter.update(inp, c.car.forwardSpeed, dt), dt);
      }
      // Busted: stopped with a police car right there.
      if (lv > 0 && !api.debug.noBust) {
        const driving = pl.mode === 'driving';
        const near = cops.some((c) => c.active && c.wreck < 0 && c.car.speed < 4 && Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z) < (driving ? 7.5 : 5));
        bust = near && P.speed < (driving ? 1.5 : 1.2) ? bust + dt : Math.max(0, bust - dt * 2);
        if (bust > (driving ? 2.5 : 1.2)) { busted = 0; bust = 0; hud.busted(true); vehicle().inputEnabled = false; engine.events.emit('wanted:busted', { level: lv }); }
      }
      heli.step(dt, seen || lv === 0, seen ? P.x : lastX, seen ? P.y : 0, seen ? P.z : lastZ, seen ? P.vx : 0, seen ? P.vz : 0, searchRadius(lv), roof);
    },
    postStep(dt) {
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      onStreet.length = 0; sirenD = Infinity;
      const lv = level();
      const fx = engine.get<FxApi>('fx');
      for (const c of cops) {
        if (!c.active) continue;
        c.car.afterStep(dt);
        c.curPos.copy(c.car.pos); c.curQuat.copy(c.car.quat);
        c.flipped = c.car.up.y < 0.5 ? c.flipped + dt : 0;
        // Damage: the hardest knock of each burst counts (one crash reads as an impact every step while it scrapes).
        // As for the player's car: knocks under 6 m/s are free and no single crash takes more than half.
        if (c.wreck < 0 && c.car.impact > 6 && c.hitT <= 0) {
          c.hitT = 0.35;
          c.hp -= Math.min(50, (c.car.impact - 6) * 6);
        }
        if (c.wreck < 0 && (c.hp <= 0 || c.flipped > 2.5)) {
          c.wreck = 0;
          const nearPlayer = Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z) < 25;
          engine.events.emit('police:wrecked', { x: c.car.pos.x, z: c.car.pos.z, nearPlayer });
          if (nearPlayer && lv > 0) { const b = level(); heat = Math.min(5.99, heat + 0.3); if (level() > b) levelUp(level()); }
        }
        if (c.wreck >= 0 && fx) {
          c.smokeT -= dt;
          if (c.smokeT <= 0) {
            c.smokeT = 0.09;
            const f = c.car.fwd;
            fx.smoke(c.car.pos.x + f.x * 1.6, c.car.pos.y + 0.7, c.car.pos.z + f.z * 1.6, (rnd() - 0.5) * 0.6, 1.4 + rnd(), (rnd() - 0.5) * 0.6, 0.9 + rnd() * 0.5, 2.5, 1);
          }
        }
        // Searching cars belong to the search circle, not to wherever the player went.
        const d = Math.min(Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z), lv > 0 && !seen ? Math.hypot(c.car.pos.x - lastX, c.car.pos.z - lastZ) : Infinity);
        const dc = Math.hypot(c.car.pos.x - cam.x, c.car.pos.z - cam.z);
        const inView = dc < 1 || ((c.car.pos.x - cam.x) * camDir.x + (c.car.pos.z - cam.z) * camDir.z) / dc > 0.2;
        const wrecked = c.wreck >= 0 || c.car.pos.y < -5;
        // A chaser left far behind is recycled out of view, to be sent in again ahead of the player.
        const leftBehind = lv > 0 && seen && c.block <= 0 && !c.sees && d > 250 && !inView;
        if (d > 600 || leftBehind || (lv === 0 && busted < 0 && (d > 120 || !inView)) || (wrecked && (!inView || dc > 150 || c.wreck > 40))) { despawn(c); continue; }
        onStreet.push(c.car);
        if (c.wreck < 0) sirenD = Math.min(sirenD, dc);
      }
      heliD = heli.active ? heli.pos.distanceTo(cam) : Infinity;
    },
    update(dt, alpha) {
      const cam = engine.camera.position;
      let k = 0, ks = 0, nd = Infinity;
      for (const c of cops) {
        if (!c.active) continue;
        renderPos.lerpVectors(c.prevPos, c.curPos, alpha);
        renderQuat.slerpQuaternions(c.prevQuat, c.curQuat, alpha);
        if (c.swat) swatKit.set(ks++, renderPos, renderQuat, c.car, BLACK, BLACK, true);
        else kit.set(k++, renderPos, renderQuat, c.car, WHITE, BLUE, true);
        const d = renderPos.distanceTo(cam);
        if (d < nd && c.wreck < 0) { nd = d; nearPos.copy(renderPos); nearLeft.copy(c.car.left); }
      }
      kit.commit(k); swatKit.commit(ks);
      const night = engine.get<RenderApi>('render')?.night ?? 0;
      kit.setHeadlights(night > 0.35); swatKit.setHeadlights(night > 0.35);
      // Light bar: red then blue, a double flash each.
      const lit = level() > 0 || busted >= 0;
      const ph = (clock * 2.4) % 2, u = ph % 1, flash = u < 0.16 || (u > 0.28 && u < 0.44) ? 1 : 0;
      const red = lit && ph < 1 ? flash : 0, blue = lit && ph >= 1 ? flash : 0;
      kit.setBeacons(0.25 + red * 9, 0.25 + blue * 9);
      swatKit.setBeacons(0.25 + blue * 9, 0.25 + red * 9);
      const glow = lit && nd < 70 ? 18 + 70 * night : 0;
      glowR.intensity = glow * red; glowB.intensity = glow * blue;
      if (glow > 0) {
        glowR.position.copy(nearPos).addScaledVector(nearLeft, 0.3); glowR.position.y += 1.5;
        glowB.position.copy(nearPos).addScaledVector(nearLeft, -0.3); glowB.position.y += 1.5;
      }
      heli.render(dt, night, clock);
      hud.update(level(), seen, api.evade);
    },
  };
  // Police on the radar and the map: flashing arrows, the helicopter too.
  const blips: Blip[] = [];
  const blipProvider = function* (): Iterable<Blip> {
    let n = 0;
    for (const c of cops) {
      if (!c.active || c.wreck >= 0) continue;
      const b = blips[n] ??= { kind: 'police', x: 0, z: 0 };
      b.x = c.car.pos.x; b.z = c.car.pos.z; b.heading = Math.atan2(c.car.fwd.x, c.car.fwd.z); b.flash = level() > 0;
      n++; yield b;
    }
    if (heli.active) {
      const b = blips[n] ??= { kind: 'police', x: 0, z: 0 };
      b.x = heli.pos.x; b.z = heli.pos.z; b.heading = Math.atan2(heli.vel.x, heli.vel.z); b.flash = true;
      yield b;
    }
  };
  engine.add(api);
}
