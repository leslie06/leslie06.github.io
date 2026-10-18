import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { Rng } from '../core/Rng';
import { CG, groups } from '../core/Physics';
import type { CarLook, SharedBike, PeopleApi, PlayerApi, RenderApi, TrafficCars, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { Routes } from '../city/Routes';
import { Vehicle } from '../vehicle/Vehicle';
import { SPEC_OF } from '../vehicle/Spec';
import { bodyOfSpec, bodySettled, readyBodies, specLength, type BodySource, type BodyType } from '../vehicle/Bodies';
import { defaultLivery } from '../vehicle/CarModel';
import { ControlFilter } from '../vehicle/ControlFilter';
import { LaneGraph } from './LaneGraph';
import { Signals, SignalHeads } from './Signals';
import { CarKit } from './CarKit';
import { readyKitLod } from '../vehicle/KitLod';
import { AiDriver, lineStats, type Leader } from './AiDriver';
import { GhostTraffic, type Handover } from './Ghosts';
import { Gait, type Motion } from '../character/Animator';
import { randomLook, SKELETON, J, type Look } from '../character/Body';
import { SEAT } from '../vehicle/TwoWheelers';

interface Npc {
  car: Vehicle;
  /** Seconds a parked one has stood still (it is put to sleep after one: `nap`). */
  rest?: number;
  driver: AiDriver | null;
  filter: ControlFilter;
  active: boolean;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  upper: THREE.Color; lower: THREE.Color; taxi: boolean;
  body: BodyType;
  flipped: number;
  /** Left by the player: no driver, handbrake on, kept until far away. */
  parked: boolean;
  /** A motorcycle or bicycle the city left at the kerb for the taking (not a car the player left). */
  bike: boolean;
  /** Seconds until this driver may lean on the horn again. */
  hornT: number;
  /** The chase job's getaway car: not despawned for distance, released by the job. */
  runner: boolean;
  /** The person on an electric scooter (drawn in the crowd), or null. */
  rider: { gait: Gait; look: Look } | null;
  /** Stopped where it is, handbrake on, kept however far away (its driver got out: npc/'s road rage). */
  held: boolean;
}

/** A car drawn by `addExternalDraw`. */
export type ExternalPut = (body: BodyType, pos: THREE.Vector3, quat: THREE.Quaternion, car: Vehicle | null, upper: THREE.Color, lower: THREE.Color) => void;
/** Cars another system simulates: the player can take them; `blocking` (optional) are the ones drivers must not run into. */
export interface ExternalCars { cars(): Vehicle[]; canTake(car: Vehicle): boolean; take(car: Vehicle): CarLook | null; park(car: Vehicle): boolean; blocking?(): readonly Vehicle[] }
/** Parked cars a traffic kit can draw on top of traffic's own (parking/ draws the near ones in traffic's kits). */
export const PARKED_DRAW = 64;

export interface TrafficApi extends TrafficCars {
  /** Cars simulated by a persistent event rather than the distance-limited traffic pool. */
  addExternalCars(provider: ExternalCars): void;
  /**
   * Draw extra cars in traffic's kits each frame (parking/: the parked cars near the camera share the kits'
   * draw calls): `draw` is called inside traffic's update, before the kits are committed, with `put` - a body,
   * an interpolated pose, the Vehicle (null: a car at rest with its lamps off, `CarKit.setStill`) and its colours.
   * Each body's kit holds `PARKED_DRAW` such cars on top of traffic's own.
   */
  addExternalDraw(draw: (put: ExternalPut, alpha: number) => void): void;
  readonly graph: LaneGraph;
  readonly signals: Signals;
  /** Active traffic cars (physics objects). */
  cars(): Vehicle[];
  /** Signal clock, seconds (for `signals.state`). */
  readonly time: number;
  /** Stop lines traffic has crossed, and how many on red (diagnostics: `.scratch/order.mjs`). */
  readonly lineStats: { crossed: number; onRed: number; yields: number };
  /** A getaway car for the chase job: spawned on the road 90-200 m from (x, z), fast and blind to red lights, until released. */
  spawnRunner(x: number, z: number, hx: number, hz: number, opts?: { calm?: boolean }): { car: Vehicle; release(): void; bolt(): void } | null;
  /** Riders on electric scooters at most (they take places in the player's crowd before the pedestrians). */
  readonly riderCap: number;
  /**
   * Stop a traffic car where it is and keep it (true), or let its driver drive on (false). False when
   * `car` is not a driven traffic car (parked, a scooter, a getaway car, the police).
   */
  hold?(car: Vehicle, on: boolean): boolean;
  /**
   * Take the driven traffic within `r` of (x, z) off the road at once (chapter 5's toll gate, a scene played on an
   * expressway): returns how many. Parked cars and riders stay.
   */
  clearNear?(x: number, z: number, r: number): number;
}

// Beijing traffic: white, black and silver dominate, then grey, dark blue, red, champagne.
export const PRIVATE = ['#f2f2ef', '#f2f2ef', '#161718', '#161718', '#b9bcbf', '#b9bcbf', '#6c7075', '#26344f', '#8c1d1d', '#c9b48f', '#3d4a3f'];
// Taxi companies share the golden top and vary the lower colour.
const TAXI_LOWER = ['#1f5e3c', '#1d49b5', '#6b1f22', '#4a2d6b', '#7a4a1e'];
const TRUCK_CAB = ['#eceeed', '#e5e8e8', '#2f5aa8', '#8c1d1d'];
const BUS_LOWER = ['#c3232b', '#c3232b', '#c3232b', '#2f7d4f'];
/**
 * The Beijing mix: mostly saloons - many of them taxis - then SUVs and hatchbacks, a few MPVs,
 * buses (main roads only) and light box trucks. Shares of the car pool; the rest are saloons.
 */
const MIX: [BodyType, number][] = [['suv', 0.16], ['hatch', 0.14], ['mpv', 0.08], ['bus', 0.09], ['truck', 0.07]];
/**
 * Now and then a 豪华轿车 or a 跑车 drives by (2026-10-18), on high only: one of each in the pool costs two kits, ~40 draw
 * calls a frame with their shadows (536 -> 579 at the spawn). The other tiers see them parked round 国贸 and 三里屯 (parking/).
 */
const MIX_HIGH: [BodyType, number][] = [['limo', 0.025], ['coupe', 0.02]];
/** Electric scooters: mostly white, black, red and blue, a few silver and pastel. */
const EBIKE_BODY = ['#f0f0ec', '#f0f0ec', '#18191a', '#18191a', '#b3242a', '#2a5bb0', '#b9bcbf', '#9ec9d6', '#e3b8c4'];
/** The delivery companies' colours (美团 yellow, 饿了么 blue), on the box, the jacket and the helmet. */
const DELIVERY = ['#f6c300', '#f6c300', '#f6c300', '#1b8ff0', '#1b8ff0'];
/** Riders keep off the expressways and their ramps. */
const NO_RIDERS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
/** Buses only spawn on these road classes. */
const BUS_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'busway']);
/** The bodies parked along the kerbs (city/visual/Parking.ts `PARK_BODIES`): their kits get room for `PARKED_DRAW`. */
const PARKED_BODIES = new Set<BodyType>(['sedan', 'suv', 'hatch', 'mpv']);

/**
 * City traffic. A fixed pool of taxi-spec Vehicles (disabled when idle) is kept filled in a ring
 * 90-260 m around the camera, spawning out of sight; each car is driven by an AiDriver on the lane
 * graph and runs the same physics as the player's car, so collisions are real collisions and any
 * of them can later be taken by the player.
 */
export async function install(engine: Engine): Promise<void> {
  await readyKitLod();
  const world = engine.get<WorldApi & { routes?: Routes }>('world');
  if (!world?.routes) return;
  const g = new LaneGraph(world.routes.net);
  const sig = new Signals(g);
  const heads = new SignalHeads(engine.scene, g, sig);
  const tier = engine.quality.tier;
  const max = new URLSearchParams(location.search).has('notraffic') ? 0 : tier === 'low' ? 12 : tier === 'medium' ? 26 : 42;
  const MAX_PARKED = 6;
  /**
   * Motorcycles standing at kerbs within reach of the player (bicycles are the shared bikes in the
   * street racks: `rentBike`). Three were too few to ever come across one.
   */
  const BIKES = tier === 'low' ? 5 : 8;
  const BIKE_ROADS = new Set(['residential', 'tertiary', 'secondary', 'unclassified', 'living_street']);
  /**
   * Electric scooters ridden along the kerb (2026-10-03): Beijing's streets are full of them, delivery riders
   * (a yellow or blue box, jacket and helmet) and everyone else. Same physics as the player's scooter.
   */
  const RIDERS = max === 0 ? 0 : tier === 'low' ? 4 : tier === 'medium' ? 7 : 10;
  /**
   * 省电档（`engine.lite`，弱手机）：路上的车和骑手少一半。每辆车每个固定步要打 4 条车轮射线，帧率越低每帧补跑的固定步
   * 越多，模拟 CPU 降速 6 倍时交通占了每帧 47 ms 里的约 15 ms。只管生成：多出来的车开远了照常回收。
   */
  const carCap = () => (engine.lite ? Math.ceil(max / 2) : max);
  const riderCap = () => (engine.lite ? Math.ceil(RIDERS / 2) : RIDERS);
  const crowdOf = () => engine.get<PlayerApi>('player')?.crowd;
  const riderMotion: Motion = { speed: 0, action: 'ride', t: 0, ride: 'ebike', lean: 0 };
  const seatAt = new THREE.Vector3(), seatFwd = new THREE.Vector3();
  const PELVIS_Y = SKELETON[J.pelvis].offset[1];
  // How many of each body the pool holds, and one instanced kit per body (each its own livery).
  const counts = new Map<BodyType, number>();
  let rest = max;
  const mix = tier === 'high' ? [...MIX, ...MIX_HIGH] : MIX;
  for (const [b, share] of mix) { const n = Math.min(rest, Math.round(max * share)); counts.set(b, n); rest -= n; }
  counts.set('sedan', Math.max(0, rest));
  const kits = new Map<BodyType, CarKit>();
  const kitFor = (b: BodyType): CarKit => {
    let k = kits.get(b);
    if (!k) { k = new CarKit(engine.scene, (counts.get(b) ?? 0) + (b === 'ebike' ? RIDERS : 0) + MAX_PARKED + 2 + (PARKED_BODIES.has(b) ? PARKED_DRAW : 0), defaultLivery(b), b); kits.set(b, k); }
    return k;
  };
  const rng = new Rng(4242);
  const rnd = () => rng.next();
  const pool: Npc[] = [];
  const externalCars: ExternalCars[] = [];
  const externalDraws: ((put: ExternalPut, alpha: number) => void)[] = [];
  const putExternal: ExternalPut = (body, pos, quat, car, upper, lower) => {
    const kit = kitFor(body), k = written.get(body) ?? 0;
    if (k >= kit.cap) return;
    if (car) kit.set(k, pos, quat, car, upper, lower, false); else kit.setStill(pos, quat, upper, lower);
    written.set(body, k + 1);
  };
  // Cars the pool let go of (a parked car took their slot), reused before building new ones:
  // removing Rapier bodies would free collider handles that stale tags could then point at.
  const spares = new Map<BodyType, Vehicle[]>();
  const newCar = (body: BodyType): Vehicle => {
    const car = spares.get(body)?.pop() ?? new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -300, z: 0 }, 0);
    car.body.setEnabled(false);
    return car;
  };
  const recycle = (n: Npc) => { const l = spares.get(n.body) ?? []; l.push(n.car); spares.set(n.body, l); };
  /**
   * The ground height to drop a car at on link `l` at `s`: 0 on the flat; on an interchange's deck or
   * ramp (or down in an underpass) its height, but only once the collider is in (the tile has a body), else NaN - a car
   * put there too early fell through to the road underneath.
   */
  const deckAt = (l: { h: Float32Array | null }, s: number, x: number, z: number): number => {
    if (!l.h) return 0;
    const h = g.heightAt(l as Parameters<typeof g.heightAt>[0], s);
    if (Math.abs(h) < 0.3) return h;
    const hit = engine.physics.raycast({ x, y: h + 1.5, z }, { x: 0, y: -1, z: 0 }, 3, groups(CG.CAR, CG.WORLD));
    return hit && Math.abs(hit.point[1] - h) < 0.6 ? hit.point[1] : NaN;
  };
  const makeNpc = (car: Vehicle, body: BodyType): Npc => ({ car, driver: null, filter: new ControlFilter(), active: false, bike: false, hornT: 0, runner: false, prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(),
    upper: new THREE.Color(), lower: new THREE.Color(), taxi: false, body, flipped: 0, parked: false, rider: null, held: false });
  // Each body's cars once its model is in (readyBodies in main.ts loads the saloon first, the rest after the
  // spawn's tiles): until then the pool's places go to saloons, which give theirs back as the others arrive.
  const fill = (b: BodyType, n: number) => {
    kitFor(b);
    for (let i = 0; i < n; i++) {
      const npc = makeNpc(newCar(b), b);
      npc.car.body.setTranslation({ x: 0, y: -300 - pool.length * 8, z: 0 }, false);
      pool.push(npc);
    }
  };
  let sedanExtra = 0;
  for (const [b, n] of counts) {
    if (n <= 0) continue;
    if (b === 'sedan' || bodySettled(b as BodySource)) fill(b, n);
    else {
      sedanExtra += n;
      void readyBodies([b as BodySource]).then(() => {
        fill(b, n);
        // as many idle stand-in saloons leave the pool (their bodies stay, as spares)
        let k = n;
        for (let i = pool.length - 1; i >= 0 && k > 0; i--) { const p = pool[i]; if (p.body === 'sedan' && !p.active && !p.parked && sedanExtra > 0) { recycle(p); pool.splice(i, 1); sedanExtra--; k--; } }
      });
    }
  }
  if (sedanExtra) fill('sedan', sedanExtra);
  /**
   * 路边停着的车和摩托（2026-10-18，手机帧率）：原来每个固定步都跑完整的车辆物理（4 条车轮射线加轮胎模型），低画质下
   * 路边最多 6 辆车加 5 辆摩托，占交通载具的一半。站稳一秒后让刚体睡下、不再 step；撞上来、推一下，Rapier 自己把它
   * 叫醒（`isSleeping` 变 false），下一步照常跑物理。冲量和 reset 都带 wake，所以抢车、回收再用都不受影响。
   */
  const nap = (n: Npc, dt: number): boolean => {
    const b = n.car.body;
    if (b.isSleeping()) return true;
    // 水平速度：靠冲量托着的车静止时竖直速度报 -0.375·g·dt（约 0.06），`speed` 永远到不了 0
    if (Math.hypot(n.car.vel.x, n.car.vel.z) < 0.05 && n.car.grounded === 4) {
      n.rest = (n.rest ?? 0) + dt;
      if (n.rest > 1) { n.rest = 0; b.sleep(); return true; }
    } else n.rest = 0;
    return false;
  };
  const driving = () => { let k = 0; for (const n of pool) if (n.active && !n.parked && !n.rider) k++; return k; };
  const riding = () => { let k = 0; for (const n of pool) if (n.active && n.rider) k++; return k; };
  const parkedInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
  const player = () => engine.get<VehicleApi>('vehicle');
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const camDir = new THREE.Vector3();
  const renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion();
  let t = 0, spawnT = 0, busT = 0;
  /** Cars written to each kit this frame. */
  const written = new Map<BodyType, number>();

  // Taxi liveries only on saloons; buses and trucks keep their own two-tone and their lettering
  // (`taxi` is what the kit calls the livery-only parts: roof sign, door and box lettering).
  const paint = (n: Npc) => {
    if (n.body === 'bus') { n.taxi = true; n.upper.set('#f2f1ea'); n.lower.set(BUS_LOWER[Math.floor(rnd() * BUS_LOWER.length)]); return; }
    if (n.body === 'truck') { n.taxi = true; n.upper.set(TRUCK_CAB[Math.floor(rnd() * TRUCK_CAB.length)]); n.lower.set(rnd() < 0.75 ? '#f2f3f2' : '#dde1e4'); return; }
    n.taxi = n.body === 'sedan' && rnd() < 0.45;
    if (n.taxi) { n.upper.set('#f3b50f'); n.lower.set(TAXI_LOWER[Math.floor(rnd() * TAXI_LOWER.length)]); }
    else { n.upper.set(PRIVATE[Math.floor(rnd() * PRIVATE.length)]); n.lower.copy(n.upper); }
  };

  /**
   * The distant traffic past the physics ring (Ghosts.ts): budget and reach by tier, `?ghosts=0` off. On low only
   * saloons (taxis among them), SUVs and buses are drawn there (three kits); the bodies hand over as they are.
   */
  const ghostOn = max > 0 && new URLSearchParams(location.search).get('ghosts') !== '0';
  const ghostPaint = (cls: string): { body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean } => {
    let body: BodyType = 'sedan', u = rnd();
    for (const [b, share] of MIX) { if (u < share) { body = b; break; } u -= share; }
    if ((body === 'bus' && !BUS_ROADS.has(cls)) || (body === 'truck' && cls === 'residential')) body = 'sedan';
    const n = { body, upper: new THREE.Color(), lower: new THREE.Color(), taxi: false } as unknown as Npc;
    paint(n);
    return { body, upper: n.upper, lower: n.lower, taxi: n.taxi };
  };
  const adoptGhost = (h: Handover): boolean => {
    if (driving() >= carCap()) return false;
    const n = pool.find((p) => !p.active && !p.parked && p.body === h.body);
    if (!n) return false;
    const l = g.links[h.link];
    if (l.len - h.s < 3) return false;
    g.at(l, h.s, g.laneOffset(l, h.lane), tmp);
    if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 9)) return false;
    const lift = deckAt(l, h.s, tmp.x, tmp.z);
    if (Number.isNaN(lift)) return false;
    n.car.body.setEnabled(true);
    n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
    n.car.setMoving(h.v);
    n.driver = new AiDriver(g, sig, h.link, h.s, h.lane, rnd);
    n.filter.reset();
    n.upper.copy(h.upper); n.lower.copy(h.lower); n.taxi = h.taxi;
    n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
    n.active = true; n.flipped = 0;
    return true;
  };
  const ghosts = ghostOn ? new GhostTraffic(engine.scene, g, sig, rnd,
    tier === 'low' ? 140 : tier === 'medium' ? 260 : 420, tier === 'low' ? 450 : tier === 'medium' ? 600 : 750,
    new Set<BodyType>(tier === 'low' ? ['sedan', 'suv', 'bus'] : ['sedan', 'suv', 'hatch', 'mpv', 'bus', 'truck']), ghostPaint, adoptGhost) : null;

  const spawn = () => {
    let n = pool.find((p) => !p.active && !p.parked && p.body !== 'ebike');
    if (!n) { if (driving() >= carCap()) return; n = makeNpc(newCar('sedan'), 'sedan'); pool.push(n); }
    const len = specLength(n.car.spec);
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    const ids = g.near(cam.x, cam.z, 240);
    if (!ids.length) return;
    const pv = player();
    for (let attempt = 0; attempt < 14; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const l = g.links[id];
      if (l.len < 24 || l.cls === 'service' || l.cls === 'living_street') continue;
      // Not on a road that ends: the car would only drive to its end and stand there.
      if (g.endsAfter(id)) continue;
      if (n.body === 'bus' && !BUS_ROADS.has(l.cls)) continue;
      if (n.body === 'truck' && l.cls === 'residential') continue;
      const s = 6 + rnd() * (l.len - 12);
      const lane = l.lanes > 1 ? Math.floor(rnd() * l.lanes) : 0;
      g.at(l, s, g.laneOffset(l, lane), tmp);
      const d = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (d < 70 || d > 240) continue;
      if (d < 190 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / d > 0.3) continue;
      // Long vehicles need more room than a saloon to drop in.
      const clear = 14 + len * 0.5;
      if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < clear)) continue;
      if (pv && Math.hypot(pv.car.pos.x - tmp.x, pv.car.pos.z - tmp.z) < 25) continue;
      const lift = deckAt(l, s, tmp.x, tmp.z);
      if (Number.isNaN(lift)) continue;
      n.car.body.setEnabled(true);
      n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      n.car.setMoving(l.speed * (0.75 + 0.2 * rnd()));
      n.driver = new AiDriver(g, sig, id, s, lane, rnd);
      n.filter.reset();
      paint(n);
      n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
      n.active = true; n.flipped = 0;
      return;
    }
  };

  /** A motorcycle left at a kerb 30-200 m from the camera, out of the road, for the player to take. */
  const spawnBike = () => {
    const cam = engine.camera.position;
    const ids = g.near(cam.x, cam.z, 200);
    if (!ids.length) return;
    const pv = player();
    for (let attempt = 0; attempt < 12; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const l = g.links[id];
      if (l.len < 30 || !BIKE_ROADS.has(l.cls) || l.hmax > 0.3) continue;
      const s = 8 + rnd() * (l.len - 16);
      // On the pavement, a metre in from the kerb on the right of travel (or from the parked cars up on it), pointing along the road.
      g.at(l, s, -(l.hw + 1.1 + l.parkOut), tmp);
      const d = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (d < 30 || d > 200) continue;
      if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 7)) continue;
      if (pv && Math.hypot(pv.car.pos.x - tmp.x, pv.car.pos.z - tmp.z) < 12) continue;
      const body: BodyType = 'moto';
      // A free slot of this body keeps its own vehicle. It must not also go to `spares`: newCar would
      // hand it out again while this slot still drives it (the bike the player took with F kept being
      // parked at another kerb, handbrake on, by the slot that took over from it).
      let n = pool.find((p) => !p.active && !p.parked && p.body === body);
      if (!n) { n = makeNpc(newCar(body), body); pool.push(n); }
      kitFor(body);
      n.car.body.setEnabled(true);
      n.car.reset({ x: tmp.x, y: 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      n.driver = null; n.filter.reset(); paint(n); n.taxi = false;
      n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
      n.active = true; n.parked = true; n.bike = true; n.flipped = 0;
      return;
    }
  };

  /** A delivery rider's look: the company's jacket and helmet (a cap in its colour), dark trousers, mostly men. */
  const riderLook = (delivery: string | null): Look => {
    const l = randomLook(rnd);
    if (!delivery) { if (l.top === 'tee' && rnd() < 0.5) l.top = 'jacket'; return l; }
    const c = new THREE.Color(delivery);
    if (rnd() < 0.85) l.fem = 0;
    l.top = 'jacket'; l.shirt = c; l.inner = c.clone(); l.sleeve = 0.53; l.cap = c.clone(); l.print = false;
    l.bottom = 'trousers'; l.hem = 0.8; l.pants = new THREE.Color(rnd() < 0.5 ? '#1d1f24' : '#2c3036');
    l.hairStyle = rnd() < 0.5 ? 'short' : 'buzz'; l.mask = rnd() < 0.25 ? new THREE.Color('#e9eef2') : null;
    return l;
  };

  /** Someone on an electric scooter, along the right-hand kerb of a street 70-240 m away, out of sight. */
  const spawnRider = () => {
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    const ids = g.near(cam.x, cam.z, 240);
    if (!ids.length) return;
    const pv = player();
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const l = g.links[id];
      if (l.len < 24 || NO_RIDERS.has(l.cls) || g.endsAfter(id)) continue;
      const s = 6 + rnd() * (l.len - 12);
      g.at(l, s, -l.kerbR + 0.8, tmp);   // inside the cars parked along the kerb, where there are any
      const d = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (d < 70 || d > 240) continue;
      if (d < 190 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / d > 0.3) continue;
      if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 10)) continue;
      if (pv && Math.hypot(pv.car.pos.x - tmp.x, pv.car.pos.z - tmp.z) < 25) continue;
      const lift = deckAt(l, s, tmp.x, tmp.z);
      if (Number.isNaN(lift)) continue;
      const body: BodyType = 'ebike';
      let n = pool.find((p) => !p.active && !p.parked && p.body === body);   // a free slot keeps its own scooter (see spawnBike)
      if (!n) { n = makeNpc(newCar(body), body); pool.push(n); }
      kitFor(body);
      n.car.body.setEnabled(true);
      n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      const delivery = rnd() < 0.55 ? DELIVERY[Math.floor(rnd() * DELIVERY.length)] : null;
      const vmax = delivery ? 8 + rnd() * 3 : 5.5 + rnd() * 3;
      n.car.setMoving(Math.min(vmax, l.speed) * 0.8);
      n.driver = new AiDriver(g, sig, id, s, 0, rnd);
      n.driver.vmax = vmax; n.driver.kerb = 0.75 + rnd() * 0.4;
      n.filter.reset();
      n.taxi = false; n.upper.set(EBIKE_BODY[Math.floor(rnd() * EBIKE_BODY.length)]);
      n.lower.set(delivery ?? (rnd() < 0.6 ? '#2a2b2d' : '#d9d9d4'));
      n.rider = { gait: n.rider?.gait ?? new Gait(), look: riderLook(delivery) };
      n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
      n.active = true; n.parked = false; n.bike = false; n.runner = false; n.flipped = 0;
      return;
    }
  };

  /** A rider knocked off (a crash, a fall): they get up and run for the pavement, the scooter lies where it fell. */
  const unseat = (n: Npc) => {
    if (!n.rider) return;
    n.rider = null; n.driver = null; n.parked = true;
    const c = n.car;
    // A scooter rider thrown off speaks as a courier (voice/): most of them are delivery riders.
    engine.get<PeopleApi>('people')?.spawnFleeing(c.pos.x + c.left.x * 1.2, c.pos.z + c.left.z * 1.2, { voice: 'courier', say: 'hit' });
  };

  // The player hit a car: its driver leans on the horn (the player's impact reading is the reliable
  // one; the heavier car being hit reads a much smaller change of velocity).
  engine.events.on('vehicle:impact', ({ point }) => {
    for (const n of pool) {
      if (!n.active || n.parked || n.hornT > 0 || n.rider) continue;
      if (Math.hypot(n.car.pos.x - point[0], n.car.pos.z - point[2]) < 5) { n.hornT = 3 + rnd() * 3; engine.events.emit('traffic:horn', { x: n.car.pos.x, z: n.car.pos.z, car: n.car }); break; }
    }
  });

  const despawn = (n: Npc) => {
    n.active = false; n.driver = null; n.parked = false; n.bike = false; n.runner = false; n.rider = null; n.held = false;
    n.car.body.setTranslation({ x: 0, y: -300, z: 0 }, false);
    n.car.body.setEnabled(false);
  };

  const leaderFor = (n: Npc): Leader | null => {
    const c = n.car;
    let best: Leader | null = null, bestAlong = Infinity;
    // Centre-to-centre distance corrected for both bodies: AiDriver takes one car length (4.6 m)
    // off itself, so a 12 m bus in front is not followed as if it were a saloon.
    const selfLen = specLength(c.spec), selfHw = c.spec.single ? 0.4 : 0.95;
    const consider = (px: number, py: number, pz: number, vx: number, vz: number, len = 4.6, hw = 0.95) => {
      const rx = px - c.pos.x, rz = pz - c.pos.z;
      const along = rx * c.fwd.x + rz * c.fwd.z;
      if (along < 1 || along > 60) return;
      const lat = Math.abs(rx * c.left.x + rz * c.left.z);
      if (lat > selfHw + hw + along * 0.03) return;
      // Not a car on the deck above or the road below (an interchange stacks them in plan).
      if (Math.abs(py - c.pos.y) > 3) return;
      if (along < bestAlong) { bestAlong = along; best = { gap: Math.max(0.5, along - (len + selfLen) / 2 + 4.6), speed: Math.max(0, vx * c.fwd.x + vz * c.fwd.z) }; }
    };
    for (const o of pool) if (o !== n && o.active) consider(o.car.pos.x, o.car.pos.y, o.car.pos.z, o.car.vel.x, o.car.vel.z, specLength(o.car.spec), o.car.spec.single ? 0.4 : 0.95);
    const pv = player();
    if (pv) consider(pv.car.pos.x, pv.car.pos.y, pv.car.pos.z, pv.car.vel.x, pv.car.vel.z, specLength(pv.car.spec));
    // People in the road: drivers brake for the player on foot and for crossing pedestrians.
    const foot = engine.get<PlayerApi>('player')?.foot;
    if (foot) consider(foot.pos.x, foot.pos.y, foot.pos.z, 0, 0, 0.6, 0.4);
    const people = engine.get<PeopleApi>('people');
    if (people) for (const q of people.inRoad()) consider(q.x, 0.5, q.z, 0, 0, 0.6, 0.4);
    for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) consider(c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.z);
    for (const p of externalCars) if (p.blocking) for (const c of p.blocking()) consider(c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.z, specLength(c.spec));
    // The distant traffic on the same lane ahead (the band where both kinds drive, 220-330 m out).
    const dr = n.driver;
    if (ghosts && dr) {
      const o = ghosts.leaderFor(dr.link, dr.s, dr.lane, dr.nextLink);
      if (o && o.ds < 60) {
        const gap = Math.max(0.5, o.ds - (o.len + selfLen) / 2 + 4.6);
        if (!best || gap < (best as Leader).gap) best = { gap, speed: o.v };
      }
    }
    return best;
  };

  /** The rider in the saddle, as the player sits on theirs (player/index.ts): the pelvis on SEAT, upright. */
  const drawRider = (n: Npc, dt: number) => {
    const crowd = crowdOf(), r = n.rider!;
    if (!crowd) return;
    const d = Math.hypot(renderPos.x - engine.camera.position.x, renderPos.z - engine.camera.position.z);
    if (d > 160) return;
    const seat = SEAT.ebike;
    seatAt.set(seat[0], seat[1], seat[2]).applyQuaternion(renderQuat).add(renderPos);
    seatFwd.set(0, 0, 1).applyQuaternion(renderQuat);
    riderMotion.speed = n.car.forwardSpeed;
    r.gait.update(riderMotion, dt, 0.3);
    seatAt.y -= PELVIS_Y * r.gait.scale;
    crowd.add(seatAt, Math.atan2(seatFwd.x, seatFwd.z), r.gait, r.look);
  };

  const api: TrafficApi & { ghosts: GhostTraffic | null } = {
    name: 'traffic',
    ghosts,
    graph: g, signals: sig, lineStats, riderCap: RIDERS,
    get time() { return t; },
    addExternalCars: (provider) => { externalCars.push(provider); },
    addExternalDraw: (draw) => { externalDraws.push(draw); },
    cars: () => [...pool.filter((n) => n.active).map((n) => n.car), ...externalCars.flatMap((p) => p.cars())],
    nearestCar(x, z, r) {
      let best: Vehicle | null = null, bd = r;
      for (const n of pool) {
        if (!n.active) continue;
        const d = Math.hypot(n.car.pos.x - x, n.car.pos.z - z);
        if (d < bd) { bd = d; best = n.car; }
      }
      for (const provider of externalCars) for (const car of provider.cars()) {
        if (!provider.canTake(car)) continue;
        const d = Math.hypot(car.pos.x - x, car.pos.z - z);
        if (d < bd) { bd = d; best = car; }
      }
      return best;
    },
    takeCar(car) {
      for (const provider of externalCars) { const look = provider.take(car); if (look) return look; }
      const i = pool.findIndex((n) => n.active && n.car === car);
      if (i < 0) return null;
      const n = pool[i];
      const look: CarLook = { upper: n.upper.clone(), lower: n.lower.clone(), taxi: n.taxi, parked: n.parked, body: n.body };
      // The Vehicle now belongs to the player; its pool slot gets another of the same kind.
      pool[i] = makeNpc(newCar(n.body), n.body);
      return look;
    },
    clearNear(x, z, r) {
      let k = 0;
      for (const n of pool) {
        if (!n.active || n.parked || n.rider) continue;
        if (Math.hypot(n.car.pos.x - x, n.car.pos.z - z) > r) continue;
        if (engine.get<VehicleApi>('vehicle')?.car === n.car) continue;
        despawn(n); k++;
      }
      return k;
    },
    hold(car, on) {
      const n = pool.find((p) => p.active && p.car === car);
      if (!n || n.parked || n.runner || n.rider || !n.driver) return false;
      n.held = on;
      if (!on) { n.filter.reset(); n.driver.shake(); }
      return true;
    },
    spawnRunner(x, z, hx, hz, opts) {
      // On the player's own road, the way they are facing, 60-90 m ahead: a chase that starts with
      // the quarry in sight, not a 2 km detour round the one-ways to where it was.
      let best = -1, bd = 40, bs = 0;
      for (const id of g.near(x, z, 60)) {
        const l = g.links[id];
        if (l.cls === 'service' || l.cls === 'living_street') continue;
        const pr = g.project(l, x, z, l.len / 2);
        g.at(l, pr.s, 0, tmp);
        if (tmp.dx * hx + tmp.dz * hz < 0.4 || pr.d >= bd) continue;
        bd = pr.d; best = id; bs = pr.s;
      }
      if (best < 0) return null;
      for (let attempt = 0; attempt < 6; attempt++) {
        let id = best, s = bs + 60 + rnd() * 30;
        while (s > g.links[id].len - 8) { const n = g.next(id, rnd); if (n < 0) break; s -= g.links[id].len; id = n; }
        const l = g.links[id];
        s = Math.min(s, l.len - 8);
        g.at(l, s, g.laneOffset(l, 0), tmp);
        if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 8)) { bs += 12; continue; }
        const lift = deckAt(l, s, tmp.x, tmp.z);
        if (Number.isNaN(lift)) { bs += 12; continue; }
        const body: BodyType = rnd() < 0.5 && bodySettled('hatch') ? 'hatch' : 'sedan';
        let n = pool.find((p) => !p.active && !p.parked && p.body === body);
        if (!n) { n = makeNpc(newCar(body), body); pool.push(n); }   // a free slot keeps its own car (see spawnBike)
        kitFor(body);
        n.car.body.setEnabled(true);
        n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
        n.car.setMoving(l.speed);
        n.driver = new AiDriver(g, sig, id, s, 0, rnd);
        // `calm`: an ordinary driver (a car to follow), until `bolt` makes it a getaway.
        if (!opts?.calm) { n.driver.boost = 1.3; n.driver.reckless = true; }
        n.filter.reset(); paint(n); n.taxi = false; n.upper.set('#161718'); n.lower.set('#161718');
        n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
        n.active = true; n.parked = false; n.bike = false; n.runner = true; n.flipped = 0;
        const npc = n;
        return { car: npc.car, release: () => { if (npc.active && npc.runner) despawn(npc); }, bolt: () => { if (npc.driver) { npc.driver.boost = 1.35; npc.driver.reckless = true; } } };
      }
      return null;
    },
    rentBike(b: SharedBike) {
      const car = newCar('bike');
      car.body.setEnabled(true);
      car.reset({ x: b.x, y: b.y + car.spec.wheelRadius + 0.04, z: b.z }, b.heading);
      return car;
    },
    parkCar(car, look) {
      if (externalCars.some((provider) => provider.park(car))) return;
      const parked = pool.filter((n) => n.parked && !n.bike);
      if (parked.length >= MAX_PARKED) despawn(parked[0]);
      const body = look.body ?? bodyOfSpec(car.spec);
      let n = pool.find((p) => !p.active && !p.parked);
      if (n) recycle(n); else { n = makeNpc(car, body); pool.push(n); }
      Object.assign(n, { car, active: true, parked: true, driver: null, flipped: 0, body, bike: false, held: false });
      n.filter.reset();
      kitFor(body);
      n.upper.copy(look.upper); n.lower.copy(look.lower); n.taxi = look.taxi;
      n.prevPos.copy(car.pos); n.curPos.copy(car.pos); n.prevQuat.copy(car.quat); n.curQuat.copy(car.quat);
      // Already in the pool either way (a reused slot, or pushed above): pushing it again stepped the
      // car twice a frame, and a second entry survived `takeCar`, so the player's own car, taken back,
      // stood with its handbrake on.
    },
    fixedUpdate(dt) {
      t += dt;
      spawnT -= dt;
      // Police with their sirens on: drivers they are coming up behind (or meeting head-on) pull over.
      const wanted = engine.get<WantedApi>('wanted');
      if (wanted && wanted.level > 0) {
        for (const c of wanted.policeCars()) {
          if (c.speed < 6) continue;
          for (const n of pool) {
            if (!n.active || n.parked || !n.driver) continue;
            const rx = c.pos.x - n.car.pos.x, rz = c.pos.z - n.car.pos.z;
            if (rx * rx + rz * rz > 55 * 55 || Math.abs(c.pos.y - n.car.pos.y) > 3) continue;
            const along = rx * n.car.fwd.x + rz * n.car.fwd.z, lat = Math.abs(rx * n.car.left.x + rz * n.car.left.z);
            const closing = c.vel.x * n.car.fwd.x + c.vel.z * n.car.fwd.z;
            if (lat < 8 && ((along < -2 && closing > n.car.forwardSpeed + 2) || (along > 4 && closing < -4))) { if (n.driver.yieldT <= 0) lineStats.yields++; n.driver.yieldT = 2.5; }
          }
        }
      }
      if (spawnT <= 0) { spawnT = 0.2; if (driving() < carCap() && !ghosts?.adoptWaiting(engine.camera.position)) spawn(); if (pool.filter((n) => n.active && n.bike).length < BIKES) spawnBike(); if (riding() < riderCap()) spawnRider(); }
      // Buses look for a shelter ahead on their side once a second (at the kerb of the link they are on).
      busT -= dt;
      if (busT <= 0) {
        busT = 1;
        const streamer = (engine.get('world') as unknown as { streamer?: { sheltersNear(x: number, z: number, r: number): number[] } } | undefined)?.streamer;
        if (streamer) for (const n of pool) {
          if (!n.active || n.parked || n.body !== 'bus' || !n.driver || n.driver.busStop || n.driver.busCool > 0 || n.driver.mode !== 'drive') continue;
          const sh = streamer.sheltersNear(n.car.pos.x, n.car.pos.z, 90);
          for (let i = 0; i < sh.length; i += 2) {
            const s = n.driver.stopAhead(sh[i], sh[i + 1], 15, 85);
            if (s >= 0) { n.driver.busStop = { s, dwell: 8 + rnd() * 4 }; break; }
          }
        }
      }
      for (const n of pool) {
        if (!n.active) continue;
        if (n.parked && nap(n, dt)) continue;
        const inp = n.parked || n.held ? parkedInput : n.driver!.update(n.car, dt, t, leaderFor(n));
        const c = n.filter.update(inp, n.car.forwardSpeed, dt);
        n.prevPos.copy(n.curPos); n.prevQuat.copy(n.curQuat);
        n.car.step(c, dt);
      }
    },
    postStep(dt) {
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      for (const n of pool) {
        if (!n.active) continue;
        n.car.afterStep(dt);
        n.curPos.copy(n.car.pos); n.curQuat.copy(n.car.quat);
        const d = Math.hypot(n.car.pos.x - cam.x, n.car.pos.z - cam.z);
        if (n.parked) { if (d > 420) despawn(n); continue; }
        if (n.held) { if (d > 800) despawn(n); continue; }
        // A rider comes off in anything harder than a nudge, or when the scooter goes over.
        if (n.rider && (n.car.impact > 4 || n.car.up.y < 0.6)) { unseat(n); continue; }
        if (n.car.impact > 3) n.driver!.shake();
        // Drivers lean on the horn when the player hits them or sits in their way.
        n.hornT -= dt;
        if (n.hornT <= 0 && !n.parked) {
          const pv = player();
          const pd = pv ? Math.hypot(pv.car.pos.x - n.car.pos.x, pv.car.pos.z - n.car.pos.z) : 99;
          if (n.driver!.stuck > 1.8 && pd < 14) { n.hornT = 3 + rnd() * 3; engine.events.emit('traffic:horn', { x: n.car.pos.x, z: n.car.pos.z, car: n.car }); }
        }
        n.flipped = n.car.up.y < 0.5 ? n.flipped + dt : 0;
        const inView = d < 1 || ((n.car.pos.x - cam.x) * camDir.x + (n.car.pos.z - cam.z) * camDir.z) / d > 0.2;
        const dead = n.driver!.mode === 'lost' || n.flipped > 4 || n.driver!.stuck > 15 || n.car.pos.y < -5;
        // A getaway car is measured from the player, not the camera, and only lost when far gone.
        const pv = n.runner ? player() : null;
        if (n.runner ? (pv ? Math.hypot(n.car.pos.x - pv.car.pos.x, n.car.pos.z - pv.car.pos.z) : d) > 900 : (d > 330 || (dead && (d > 90 || !inView)))) {
          // Driving away past the ring: it carries on as distant traffic.
          if (ghosts && !dead && !n.runner && !n.rider && n.driver && n.body !== 'ebike') {
            const dr = n.driver;
            ghosts.take({ link: dr.link, s: dr.s, lane: dr.lane, v: Math.max(0, n.car.forwardSpeed), body: n.body, upper: n.upper, lower: n.lower, taxi: n.taxi });
          }
          despawn(n);
        }
      }
    },
    update(_dt, alpha) {
      // Traffic updates before police, races and events: set the view every kit culls against.
      CarKit.view(engine.camera);
      for (const b of kits.keys()) written.set(b, 0);
      for (const n of pool) {
        if (!n.active) continue;
        renderPos.lerpVectors(n.prevPos, n.curPos, alpha);
        renderQuat.slerpQuaternions(n.prevQuat, n.curQuat, alpha);
        const kit = kitFor(n.body), k = written.get(n.body) ?? 0;
        if (k >= kit.cap) continue;
        kit.set(k, renderPos, renderQuat, n.car, n.upper, n.lower, n.taxi);
        written.set(n.body, k + 1);
        if (n.rider) drawRider(n, _dt);
      }
      for (const draw of externalDraws) draw(putExternal, alpha);
      if (ghosts) {
        const ds = ghosts.drivers;
        ds.length = 0;
        for (const n of pool) if (n.active && n.driver && !n.parked) ds.push(n.driver.link, n.driver.s, n.driver.lane, Math.max(0, n.car.forwardSpeed), specLength(n.car.spec));
        ghosts.update(_dt, t, engine.camera.position, camDir.set(0, 0, -1).applyQuaternion(engine.camera.quaternion), (engine.get<RenderApi>('render')?.night ?? 0) > 0.35, driving() < carCap());
      }
      const night = (engine.get<RenderApi>('render')?.night ?? 0) > 0.35;
      for (const [b, kit] of kits) { kit.commit(written.get(b) ?? 0); kit.setHeadlights(night); }
      const cam = engine.camera.position;
      heads.update(cam.x, cam.z, t);
    },
  };
  engine.add(api);
}
