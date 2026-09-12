import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { Rng } from '../core/Rng';
import type { CarLook, PeopleApi, PlayerApi, RenderApi, TrafficCars, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { Routes } from '../city/Routes';
import { Vehicle } from '../vehicle/Vehicle';
import { SPEC_OF } from '../vehicle/Spec';
import { bodyOfSpec, specLength, type BodyType } from '../vehicle/Bodies';
import { defaultLivery } from '../vehicle/CarModel';
import { ControlFilter } from '../vehicle/ControlFilter';
import { LaneGraph } from './LaneGraph';
import { Signals, SignalHeads } from './Signals';
import { CarKit } from './CarKit';
import { AiDriver, type Leader } from './AiDriver';

interface Npc {
  car: Vehicle;
  driver: AiDriver | null;
  filter: ControlFilter;
  active: boolean;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  upper: THREE.Color; lower: THREE.Color; taxi: boolean;
  body: BodyType;
  flipped: number;
  /** Left by the player: no driver, handbrake on, kept until far away. */
  parked: boolean;
}

export interface TrafficApi extends TrafficCars {
  readonly graph: LaneGraph;
  readonly signals: Signals;
  /** Active traffic cars (physics objects). */
  cars(): Vehicle[];
  /** Signal clock, seconds (for `signals.state`). */
  readonly time: number;
}

// Beijing traffic: white, black and silver dominate, then grey, dark blue, red, champagne.
const PRIVATE = ['#f2f2ef', '#f2f2ef', '#161718', '#161718', '#b9bcbf', '#b9bcbf', '#6c7075', '#26344f', '#8c1d1d', '#c9b48f', '#3d4a3f'];
// Taxi companies share the golden top and vary the lower colour.
const TAXI_LOWER = ['#1f5e3c', '#1d49b5', '#6b1f22', '#4a2d6b', '#7a4a1e'];
const TRUCK_CAB = ['#eceeed', '#e5e8e8', '#2f5aa8', '#8c1d1d'];
const BUS_LOWER = ['#c3232b', '#c3232b', '#c3232b', '#2f7d4f'];
/**
 * The Beijing mix: mostly saloons - many of them taxis - then SUVs and hatchbacks, a few MPVs,
 * buses (main roads only) and light box trucks. Shares of the car pool; the rest are saloons.
 */
const MIX: [BodyType, number][] = [['suv', 0.16], ['hatch', 0.14], ['mpv', 0.08], ['bus', 0.05], ['truck', 0.07]];
/** Buses only spawn on these road classes. */
const BUS_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'busway']);

/**
 * City traffic. A fixed pool of taxi-spec Vehicles (disabled when idle) is kept filled in a ring
 * 90-260 m around the camera, spawning out of sight; each car is driven by an AiDriver on the lane
 * graph and runs the same physics as the player's car, so collisions are real collisions and any
 * of them can later be taken by the player.
 */
export async function install(engine: Engine): Promise<void> {
  const world = engine.get<WorldApi & { routes?: Routes }>('world');
  if (!world?.routes) return;
  const g = new LaneGraph(world.routes.net);
  const sig = new Signals(g);
  const heads = new SignalHeads(engine.scene, g, sig);
  const tier = engine.quality.tier;
  const max = new URLSearchParams(location.search).has('notraffic') ? 0 : tier === 'low' ? 12 : tier === 'medium' ? 26 : 42;
  const MAX_PARKED = 6;
  // How many of each body the pool holds, and one instanced kit per body (each its own livery).
  const counts = new Map<BodyType, number>();
  let rest = max;
  for (const [b, share] of MIX) { const n = Math.min(rest, Math.round(max * share)); counts.set(b, n); rest -= n; }
  counts.set('sedan', Math.max(0, rest));
  const kits = new Map<BodyType, CarKit>();
  const kitFor = (b: BodyType): CarKit => {
    let k = kits.get(b);
    if (!k) { k = new CarKit(engine.scene, (counts.get(b) ?? 0) + MAX_PARKED + 2, defaultLivery(b), b); kits.set(b, k); }
    return k;
  };
  const rng = new Rng(4242);
  const rnd = () => rng.next();
  const pool: Npc[] = [];
  // Cars the pool let go of (a parked car took their slot), reused before building new ones:
  // removing Rapier bodies would free collider handles that stale tags could then point at.
  const spares = new Map<BodyType, Vehicle[]>();
  const newCar = (body: BodyType): Vehicle => {
    const car = spares.get(body)?.pop() ?? new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -300, z: 0 }, 0);
    car.body.setEnabled(false);
    return car;
  };
  const recycle = (n: Npc) => { const l = spares.get(n.body) ?? []; l.push(n.car); spares.set(n.body, l); };
  const makeNpc = (car: Vehicle, body: BodyType): Npc => ({ car, driver: null, filter: new ControlFilter(), active: false, prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(),
    upper: new THREE.Color(), lower: new THREE.Color(), taxi: false, body, flipped: 0, parked: false });
  for (const [b, n] of counts) {
    if (n <= 0) continue;
    kitFor(b);
    for (let i = 0; i < n; i++) {
      const npc = makeNpc(newCar(b), b);
      npc.car.body.setTranslation({ x: 0, y: -300 - pool.length * 8, z: 0 }, false);
      pool.push(npc);
    }
  }
  const driving = () => { let k = 0; for (const n of pool) if (n.active && !n.parked) k++; return k; };
  const parkedInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
  const player = () => engine.get<VehicleApi>('vehicle');
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const camDir = new THREE.Vector3();
  const renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion();
  let t = 0, spawnT = 0;
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

  const spawn = () => {
    let n = pool.find((p) => !p.active && !p.parked);
    if (!n) { if (driving() >= max) return; n = makeNpc(newCar('sedan'), 'sedan'); pool.push(n); }
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
      n.car.body.setEnabled(true);
      n.car.reset({ x: tmp.x, y: 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      n.car.setMoving(l.speed * (0.75 + 0.2 * rnd()));
      n.driver = new AiDriver(g, sig, id, s, lane, rnd);
      n.filter.reset();
      paint(n);
      n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
      n.active = true; n.flipped = 0;
      return;
    }
  };

  const despawn = (n: Npc) => {
    n.active = false; n.driver = null; n.parked = false;
    n.car.body.setTranslation({ x: 0, y: -300, z: 0 }, false);
    n.car.body.setEnabled(false);
  };

  const leaderFor = (n: Npc): Leader | null => {
    const c = n.car;
    let best: Leader | null = null, bestAlong = Infinity;
    // Centre-to-centre distance corrected for both bodies: AiDriver takes one car length (4.6 m)
    // off itself, so a 12 m bus in front is not followed as if it were a saloon.
    const selfLen = specLength(c.spec);
    const consider = (px: number, pz: number, vx: number, vz: number, len = 4.6) => {
      const rx = px - c.pos.x, rz = pz - c.pos.z;
      const along = rx * c.fwd.x + rz * c.fwd.z;
      if (along < 1 || along > 60) return;
      const lat = Math.abs(rx * c.left.x + rz * c.left.z);
      if (lat > 1.9 + along * 0.03) return;
      if (along < bestAlong) { bestAlong = along; best = { gap: Math.max(0.5, along - (len + selfLen) / 2 + 4.6), speed: Math.max(0, vx * c.fwd.x + vz * c.fwd.z) }; }
    };
    for (const o of pool) if (o !== n && o.active) consider(o.car.pos.x, o.car.pos.z, o.car.vel.x, o.car.vel.z, specLength(o.car.spec));
    const pv = player();
    if (pv) consider(pv.car.pos.x, pv.car.pos.z, pv.car.vel.x, pv.car.vel.z, specLength(pv.car.spec));
    // People in the road: drivers brake for the player on foot and for crossing pedestrians.
    const foot = engine.get<PlayerApi>('player')?.foot;
    if (foot) consider(foot.pos.x, foot.pos.z, 0, 0);
    const people = engine.get<PeopleApi>('people');
    if (people) for (const q of people.inRoad()) consider(q.x, q.z, 0, 0);
    for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) consider(c.pos.x, c.pos.z, c.vel.x, c.vel.z);
    return best;
  };

  const api: TrafficApi = {
    name: 'traffic',
    graph: g, signals: sig,
    get time() { return t; },
    cars: () => pool.filter((n) => n.active).map((n) => n.car),
    nearestCar(x, z, r) {
      let best: Vehicle | null = null, bd = r;
      for (const n of pool) {
        if (!n.active) continue;
        const d = Math.hypot(n.car.pos.x - x, n.car.pos.z - z);
        if (d < bd) { bd = d; best = n.car; }
      }
      return best;
    },
    takeCar(car) {
      const i = pool.findIndex((n) => n.active && n.car === car);
      if (i < 0) return null;
      const n = pool[i];
      const look: CarLook = { upper: n.upper.clone(), lower: n.lower.clone(), taxi: n.taxi, parked: n.parked, body: n.body };
      // The Vehicle now belongs to the player; its pool slot gets another of the same kind.
      pool[i] = makeNpc(newCar(n.body), n.body);
      return look;
    },
    parkCar(car, look) {
      const parked = pool.filter((n) => n.parked);
      if (parked.length >= MAX_PARKED) despawn(parked[0]);
      const body = look.body ?? bodyOfSpec(car.spec);
      let n = pool.find((p) => !p.active && !p.parked);
      if (n) recycle(n); else { n = makeNpc(car, body); pool.push(n); }
      Object.assign(n, { car, active: true, parked: true, driver: null, flipped: 0, body });
      n.filter.reset();
      kitFor(body);
      n.upper.copy(look.upper); n.lower.copy(look.lower); n.taxi = look.taxi;
      n.prevPos.copy(car.pos); n.curPos.copy(car.pos); n.prevQuat.copy(car.quat); n.curQuat.copy(car.quat);
      pool.push(n);
    },
    fixedUpdate(dt) {
      t += dt;
      spawnT -= dt;
      if (spawnT <= 0) { spawnT = 0.2; if (driving() < max) spawn(); }
      for (const n of pool) {
        if (!n.active) continue;
        const inp = n.parked ? parkedInput : n.driver!.update(n.car, dt, t, leaderFor(n));
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
        if (n.car.impact > 3) n.driver!.shake();
        n.flipped = n.car.up.y < 0.5 ? n.flipped + dt : 0;
        const inView = d < 1 || ((n.car.pos.x - cam.x) * camDir.x + (n.car.pos.z - cam.z) * camDir.z) / d > 0.2;
        const dead = n.driver!.mode === 'lost' || n.flipped > 4 || n.driver!.stuck > 15 || n.car.pos.y < -5;
        if (d > 330 || (dead && (d > 90 || !inView))) despawn(n);
      }
    },
    update(_dt, alpha) {
      for (const b of kits.keys()) written.set(b, 0);
      for (const n of pool) {
        if (!n.active) continue;
        renderPos.lerpVectors(n.prevPos, n.curPos, alpha);
        renderQuat.slerpQuaternions(n.prevQuat, n.curQuat, alpha);
        const kit = kitFor(n.body), k = written.get(n.body) ?? 0;
        if (k >= kit.cap) continue;
        kit.set(k, renderPos, renderQuat, n.car, n.upper, n.lower, n.taxi);
        written.set(n.body, k + 1);
      }
      const night = (engine.get<RenderApi>('render')?.night ?? 0) > 0.35;
      for (const [b, kit] of kits) { kit.commit(written.get(b) ?? 0); kit.setHeadlights(night); }
      const cam = engine.camera.position;
      heads.update(cam.x, cam.z, t);
    },
  };
  engine.add(api);
}
