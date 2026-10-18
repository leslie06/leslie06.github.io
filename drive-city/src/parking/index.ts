import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { CarLook, PlayerApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { CityStreamer } from '../city/Streamer';
import { PARK_BODIES, PARK_HALF, STRIDE } from '../city/visual/Parking';
import { PARK_W } from '../traffic/Lanes';
import { project } from '../city/Geo';
import { CarKit } from '../traffic/CarKit';
import { PRIVATE, type ExternalCars, type TrafficApi } from '../traffic';
import { Vehicle } from '../vehicle/Vehicle';
import { SPEC_OF } from '../vehicle/Spec';
import { bodySettled, specLength } from '../vehicle/Bodies';

type BodyType = (typeof PARK_BODIES)[number] | 'coupe' | 'limo';

/**
 * Where the money parks (2026-10-18, 「车太次了 没有豪车」): within this many metres of these places some of the kerb's
 * cars are 跑车 and 豪华轿车 - a coupe in a saloon, SUV or hatchback's place, a limo (5.2 m) only in an MPV's, so it fits
 * the gap the tile left. Which slots, from their position: the same car every visit, there to be taken.
 */
const LUXURY_AT: [number, number, number][] = [
  [39.9087, 116.4590, 900],   // 国贸 CBD
  [39.9365, 116.4547, 700],   // 三里屯
  [39.9150, 116.3590, 800],   // 金融街
  [39.9497, 116.4610, 600],   // 燕莎 / 亮马桥
  [39.9142, 116.4110, 500],   // 王府井
];
const LUXURY_SHARE = { coupe: 0.05, limo: 0.5 };
import { defaultLivery } from '../vehicle/CarModel';
import { ControlFilter } from '../vehicle/ControlFilter';

/**
 * The cars parked along the kerbs (2026-10-11, 「街道太空」). The tile worker places them (city/visual/Parking.ts);
 * this draws and simulates the ones on the tiles with colliders (the 3x3 round the camera):
 *
 * - Each is checked once against the static colliders when its tile's colliders are in (a kiosk, a wall, a sign
 *   post, a footbridge stair, a house at a hutong's kerb: what the worker cannot see) and dropped if it meets one.
 * - A kept car is two fixed boxes (body and cabin) and an instance: within `NEAR` in traffic's kits (their draw
 *   calls, lamps off), further out in this system's far kits (paint and wheels, two calls a body), to `DRAW[tier]`.
 * - A car about to be hit (the player's car, the police, traffic, another knocked car sweeping towards it) or one
 *   the player on foot walks up to becomes a real Vehicle on the spot, handbrake on (`promote`): it is shoved,
 *   spun and dented like any car, and F takes it (traffic's `addExternalCars`). Left alone where it stood it turns
 *   back into an instance; moved, it stays a Vehicle until far away and its place stays empty.
 *
 * `?parked=0` turns it off (A/B).
 */
export interface ParkingApi extends System {
  /**
   * Clear the parked cars within `r` of (x, z) (someone hailing a taxi from the kerb, a post on the pavement), and
   * keep it clear for `hold` seconds (Infinity: for good) of cars on tiles still to come in.
   */
  clearAround(x: number, z: number, r: number, hold?: number): void;
  /** Counts for probes: kept (drawn and solid), rejected by the collider check, Vehicles now, pending checks. */
  readonly stats: { kept: number; rejected: number; promoted: number; pending: number; drawnNear: number; drawnFar: number; knocked: number };
  /** Probes: the Vehicles now (where, whether knocked out of place), and the kept cars near a point. */
  readonly debug: { promos(): { x: number; z: number; moved: boolean; car: Vehicle; by: string }[]; near(x: number, z: number, r: number): { x: number; z: number; heading: number; body: string }[] };
}

/** Within this the full kit (traffic's), beyond it the far kit. */
const NEAR = 60;
/** How far parked cars are drawn, by tier. */
const DRAW = { low: 190, medium: 250, high: 300 } as const;
/** Real Vehicles at once. */
const PROMO_MAX = 14;
/** Seconds after a tile's colliders arrive before its cars are checked against them (the neighbours' and other systems' too). */
const CHECK_DELAY = 0.6;
const CELL = 16;
const parkedInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

interface Tile { key: string; recs: Rec[]; born: number; checked: boolean; body: RAPIER_NS.RigidBody | null }
/** 0 waiting for its check, 1 parked (drawn and solid), 2 rejected, 3 a Vehicle now, 4 gone (moved, taken, cleared). */
interface Rec { tile: Tile; body: BodyType; pos: THREE.Vector3; quat: THREE.Quaternion; heading: number; hl: number; colour: THREE.Color; state: 0 | 1 | 2 | 3 | 4; cols: RAPIER_NS.Collider[] }
interface Promo { rec: Rec | null; car: Vehicle; body: BodyType; colour: THREE.Color; filter: ControlFilter; prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion; moved: boolean; quiet: number; by: string; home: THREE.Vector3; homeQuat: THREE.Quaternion }

/** Two boxes in plan overlap (separating axes): A at offset (dx, dz) from B, each a facing (unit) and half sizes. */
function boxesMeet(dx: number, dz: number, ax: number, az: number, al: number, aw: number, bx: number, bz: number, bl: number, bw: number): boolean {
  // axes: A's forward and side, B's forward and side; the side of (x, z) is (z, -x)
  for (const [ux, uz] of [[ax, az], [az, -ax], [bx, bz], [bz, -bx]]) {
    const ra = al * Math.abs(ax * ux + az * uz) + aw * Math.abs(az * ux - ax * uz);
    const rb = bl * Math.abs(bx * ux + bz * uz) + bw * Math.abs(bz * ux - bx * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

export async function install(engine: Engine): Promise<void> {
  const params = new URLSearchParams(location.search);
  const streamer = (engine.get('world') as unknown as { streamer?: CityStreamer } | undefined)?.streamer;
  const traffic = engine.get<TrafficApi>('traffic');
  if (!streamer || !traffic || params.get('parked') === '0') return;
  const { R, world } = engine.physics;
  const tier = engine.quality.tier;
  const drawR = DRAW[tier];
  const tiles = new Map<string, Tile>();
  const grid = new Map<number, Rec[]>();
  const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + cz + 32768;
  const promos: Promo[] = [];
  const promoCars: Vehicle[] = [];
  const blocking: Vehicle[] = [];
  const spares = new Map<BodyType, Vehicle[]>();
  const stats = { kept: 0, rejected: 0, promoted: 0, pending: 0, drawnNear: 0, drawnFar: 0, knocked: 0 };
  let time = 0, statT = 0;

  const luxPlaces = LUXURY_AT.map(([lat, lon, r]) => { const [x, z] = project(lat, lon); return { x, z, r }; });
  /** The luxury car standing in this slot instead, if any (a hash of the slot's place: the same one every time). */
  const luxuryAt = (x: number, z: number, body: BodyType): 'coupe' | 'limo' | null => {
    if (!luxPlaces.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) return null;
    const u = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;
    if (body === 'mpv') return u < LUXURY_SHARE.limo ? 'limo' : null;
    return u < LUXURY_SHARE.coupe ? 'coupe' : null;
  };
  const onParked = (key: string, park: number[] | null) => {
    const old = tiles.get(key);
    if (old) dropTile(old);
    if (!park) return;
    const t: Tile = { key, recs: [], born: time, checked: false, body: null };
    for (let i = 0; i < park.length; i += STRIDE) {
      let body: BodyType = PARK_BODIES[park[i + 3]] ?? 'sedan', hl = PARK_HALF[park[i + 3]] ?? 2.4;
      const h = park[i + 2], lux = luxuryAt(park[i], park[i + 1], body);
      if (lux) { body = lux; hl = specLength(SPEC_OF[lux]) / 2 + 0.15; }
      const spec = SPEC_OF[body];
      t.recs.push({ tile: t, body, heading: h, hl, state: 0, cols: [],
        pos: new THREE.Vector3(park[i], 0.03 + spec.wheelRadius, park[i + 1]), quat: new THREE.Quaternion().setFromAxisAngle(_up, h),
        colour: new THREE.Color(PRIVATE[park[i + 4] % PRIVATE.length]) });
    }
    tiles.set(key, t);
  };

  const dropTile = (t: Tile) => {
    for (const r of t.recs) {
      if (r.state === 1) unindex(r);
      if (r.state === 3) { const p = promos.find((q) => q.rec === r); if (p) { p.rec = null; if (!p.moved) putAway(p); } }
      r.cols.length = 0;
    }
    if (t.body) { for (let i = 0; i < t.body.numColliders(); i++) engine.physics.untag(t.body.collider(i)); world.removeRigidBody(t.body); }
    t.body = null;
    tiles.delete(t.key);
  };

  const index = (r: Rec) => {
    const k = cellKey(Math.floor(r.pos.x / CELL), Math.floor(r.pos.z / CELL));
    const c = grid.get(k);
    if (c) c.push(r); else grid.set(k, [r]);
  };
  const unindex = (r: Rec) => {
    const c = grid.get(cellKey(Math.floor(r.pos.x / CELL), Math.floor(r.pos.z / CELL)));
    const i = c ? c.indexOf(r) : -1;
    if (i >= 0) c!.splice(i, 1);
  };

  /** The car's two boxes, as vehicle/Spec's chassis (body and cabin), on its tile's fixed body. */
  const solidify = (r: Rec) => {
    const t = r.tile;
    if (!t.body) t.body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const c = Math.cos(r.heading), s = Math.sin(r.heading), rot = { x: r.quat.x, y: r.quat.y, z: r.quat.z, w: r.quat.w };
    for (const ch of SPEC_OF[r.body].chassis) {
      const [lx, ly, lz] = ch.at;
      const col = world.createCollider(R.ColliderDesc.cuboid(ch.half[0], ch.half[1], ch.half[2])
        .setTranslation(r.pos.x + lx * c + lz * s, r.pos.y + ly, r.pos.z - lx * s + lz * c).setRotation(rot)
        .setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.5), t.body);
      engine.physics.tag(col, { surface: 'metal', tag: 'parked' });
      r.cols.push(col);
    }
  };
  const unsolidify = (r: Rec) => {
    for (const c of r.cols) { engine.physics.untag(c); world.removeCollider(c, true); }
    r.cols.length = 0;
  };

  /** Nothing fixed where the car stands (0.25-1.5 m up, a few cm inside its outline), other parked cars aside. */
  const isParkedCol = (c: RAPIER_NS.Collider) => engine.physics.dataOf(c).tag === 'parked';
  const notParked = (c: RAPIER_NS.Collider) => !isParkedCol(c);
  const clear = (r: Rec) => !world.intersectionWithShape({ x: r.pos.x, y: 0.87, z: r.pos.z }, { x: r.quat.x, y: r.quat.y, z: r.quat.z, w: r.quat.w },
    new R.Cuboid(PARK_W / 2 - 0.03, 0.62, r.hl - 0.05), R.QueryFilterFlags.EXCLUDE_DYNAMIC, groups(CG.PROP, CG.WORLD), undefined, undefined, notParked);

  /** Spots kept clear (`clearAround` with a hold): until `until` (seconds of `time`). */
  const holds: { x: number; z: number; r: number; until: number }[] = [];
  const check = (t: Tile) => {
    t.checked = true;
    for (let i = holds.length - 1; i >= 0; i--) if (holds[i].until < time) holds.splice(i, 1);
    for (const r of t.recs) {
      if (r.state !== 0) continue;
      if (holds.some((k) => Math.hypot(r.pos.x - k.x, r.pos.z - k.z) < k.r + r.hl)) { r.state = 4; continue; }
      if (!clear(r)) { r.state = 2; continue; }
      r.state = 1;
      solidify(r);
      index(r);
    }
  };

  const vehicleFor = (body: BodyType): Vehicle => {
    const car = spares.get(body)?.pop() ?? new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -300, z: 0 }, 0);
    car.body.setEnabled(true);
    return car;
  };
  const putAway = (p: Promo) => {
    const i = promos.indexOf(p);
    if (i >= 0) promos.splice(i, 1);
    p.car.body.setTranslation({ x: 0, y: -300, z: 0 }, false);
    p.car.body.setEnabled(false);
    (spares.get(p.body) ?? spares.set(p.body, []).get(p.body)!).push(p.car);
    if (p.rec?.state === 3) p.rec.state = 4;
  };
  /** Back to an instance and two boxes where it stood (it was never moved). */
  const demote = (p: Promo) => {
    const r = p.rec;
    p.rec = null;
    putAway(p);
    if (r && tiles.get(r.tile.key) === r.tile) { r.state = 1; solidify(r); index(r); }
  };

  const nearestMover = (x: number, z: number) => {
    let d = Infinity;
    const pv = engine.get<VehicleApi>('vehicle'), foot = engine.get<PlayerApi>('player')?.foot;
    if (pv) d = Math.min(d, Math.hypot(pv.car.pos.x - x, pv.car.pos.z - z));
    if (foot) d = Math.min(d, Math.hypot(foot.pos.x - x, foot.pos.z - z));
    for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) d = Math.min(d, Math.hypot(c.pos.x - x, c.pos.z - z));
    return d;
  };

  const promote = (r: Rec, by = '') => {
    if (promos.length >= PROMO_MAX) {
      // Make room: the one furthest from anyone, put back if it never moved.
      let worst: Promo | null = null, wd = 30;
      for (const p of promos) { const d = nearestMover(p.car.pos.x, p.car.pos.z); if (d > wd) { wd = d; worst = p; } }
      if (!worst) return;
      if (worst.rec && !worst.moved) demote(worst); else putAway(worst);
    }
    unindex(r);
    unsolidify(r);
    r.state = 3;
    const car = vehicleFor(r.body);
    car.reset({ x: r.pos.x, y: r.pos.y + 0.03, z: r.pos.z }, r.heading);
    const filter = new ControlFilter();
    promos.push({ rec: r, car, body: r.body, colour: r.colour, filter, prevPos: car.pos.clone(), curPos: car.pos.clone(), prevQuat: car.quat.clone(), curQuat: car.quat.clone(), moved: false, quiet: 0, by, home: r.pos, homeQuat: r.quat });
  };

  /**
   * Promote what a car would touch over the next 0.4 s at its velocity: its footprint (half length `hl`, half
   * width `hw`, facing (fx, fz)) at now, +0.2 and +0.4 s against each parked car's, `margin` apart. Traffic passes
   * parked cars 0.2 m off by design (traffic/Lanes.ts) and gets a small margin; the player and the police more.
   */
  const sweep = (c: Vehicle, margin: number) => {
    const x = c.pos.x, z = c.pos.z, vx = c.vel.x, vz = c.vel.z, fx = c.fwd.x, fz = c.fwd.z;
    const hl = specLength(c.spec) / 2, hw = c.spec.single ? 0.4 : 0.92, m = hl + 3;
    const x1 = x + vx * 0.4, z1 = z + vz * 0.4;
    const ca = Math.floor((Math.min(x, x1) - m) / CELL), cb = Math.floor((Math.max(x, x1) + m) / CELL);
    const za = Math.floor((Math.min(z, z1) - m) / CELL), zb = Math.floor((Math.max(z, z1) + m) / CELL);
    for (let cx = ca; cx <= cb; cx++) for (let cz = za; cz <= zb; cz++) {
      const cell = grid.get(cellKey(cx, cz));
      if (!cell) continue;
      for (let i = cell.length - 1; i >= 0; i--) {
        const r = cell[i], rfx = Math.sin(r.heading), rfz = Math.cos(r.heading);
        for (const t of [0, 0.2, 0.4]) {
          if (boxesMeet(x + vx * t - r.pos.x, z + vz * t - r.pos.z, fx, fz, hl + margin, hw + margin, rfx, rfz, r.hl, PARK_W / 2)) { promote(r, `${c.spec.name} at ${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)} v ${c.speed.toFixed(1)} t ${t}`); break; }
        }
      }
    }
  };

  const take = (car: Vehicle): CarLook | null => {
    const p = promos.find((q) => q.car === car);
    if (!p) return null;
    promos.splice(promos.indexOf(p), 1);
    if (p.rec) p.rec.state = 4;
    // The Vehicle is the player's now: not a spare.
    return { upper: p.colour.clone(), lower: p.colour.clone(), taxi: false, parked: true, body: p.body };
  };
  const provider: ExternalCars = {
    cars: () => { promoCars.length = 0; for (const p of promos) promoCars.push(p.car); return promoCars; },
    canTake: () => true,
    take,
    park: () => false,
    // Only the ones knocked well out of their place: one nudged along the kerb is not in anyone's lane (as an
    // obstacle it stopped the traffic behind it, the leader test being a widening cone).
    blocking: () => {
      blocking.length = 0;
      for (const p of promos) if (p.moved && (p.car.pos.distanceTo(p.home) > 0.8 || p.car.quat.angleTo(p.homeQuat) > 0.3)) blocking.push(p.car);
      return blocking;
    },
  };
  traffic.addExternalCars(provider);

  /**
   * The body a parked car is drawn as: its own once that model is in (a saloon until then); on low, hatchbacks as
   * saloons and MPVs as SUVs - two kits fewer, each 4 draw calls and its shadows (the colliders stay true).
   */
  const drawn = (b: BodyType): BodyType => {
    const d: BodyType = tier !== 'low' ? b : b === 'hatch' ? 'sedan' : b === 'mpv' ? 'suv' : b;
    return bodySettled(d) ? d : 'sedan';
  };
  // Far kits: one per body, made once that body's model is in (a kit made before stays procedural).
  const farKits = new Map<BodyType, CarKit>();
  const farKit = (b: BodyType): CarKit => {
    const body = drawn(b);
    let k = farKits.get(body);
    if (!k) { k = new CarKit(engine.scene, 600, defaultLivery(body), body, { far: true }); farKits.set(body, k); }
    return k;
  };
  const renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion();
  traffic.addExternalDraw((put, alpha) => {
    const cam = engine.camera.position;
    let near = 0, far = 0;
    for (const t of tiles.values()) {
      if (!t.checked) continue;
      for (const r of t.recs) {
        if (r.state !== 1) continue;
        const dx = r.pos.x - cam.x, dz = r.pos.z - cam.z, d2 = dx * dx + dz * dz;
        if (d2 > drawR * drawR) continue;
        if (d2 < NEAR * NEAR) { put(drawn(r.body), r.pos, r.quat, null, r.colour, r.colour); near++; }
        else { farKit(r.body).setStill(r.pos, r.quat, r.colour, r.colour); far++; }
      }
    }
    for (const p of promos) {
      renderPos.lerpVectors(p.prevPos, p.curPos, alpha);
      renderQuat.slerpQuaternions(p.prevQuat, p.curQuat, alpha);
      put(drawn(p.body), renderPos, renderQuat, p.car, p.colour, p.colour);
    }
    for (const k of farKits.values()) k.commit(0);
    stats.drawnNear = near; stats.drawnFar = far;
  });

  const api: ParkingApi = {
    name: 'parking',
    stats,
    debug: {
      promos: () => promos.map((p) => ({ x: p.car.pos.x, z: p.car.pos.z, moved: p.moved, car: p.car, by: p.by })),
      near: (x, z, rad) => [...tiles.values()].flatMap((t) => t.recs).filter((r) => r.state === 1 && Math.hypot(r.pos.x - x, r.pos.z - z) < rad)
        .map((r) => ({ x: r.pos.x, z: r.pos.z, heading: r.heading, body: r.body })),
    },
    clearAround(x, z, r, hold = 0) {
      if (hold > 0) holds.push({ x, z, r, until: time + hold });
      const ca = Math.floor((x - r - 3) / CELL), cb = Math.floor((x + r + 3) / CELL), za = Math.floor((z - r - 3) / CELL), zb = Math.floor((z + r + 3) / CELL);
      for (let cx = ca; cx <= cb; cx++) for (let cz = za; cz <= zb; cz++) {
        const c = grid.get(cellKey(cx, cz));
        if (!c) continue;
        for (let i = c.length - 1; i >= 0; i--) {
          const q = c[i];
          if (Math.hypot(q.pos.x - x, q.pos.z - z) > r + q.hl) continue;
          c.splice(i, 1); unsolidify(q); q.state = 4;
        }
      }
    },
    fixedUpdate(dt) {
      time += dt;
      for (const t of tiles.values()) if (!t.checked && time - t.born > CHECK_DELAY) check(t);
      // Whatever is moving and might reach a parked car in the next 0.4 s turns it into a Vehicle first.
      const pv = engine.get<VehicleApi>('vehicle');
      const movers = traffic.cars();
      const ai = movers.length;
      if (pv) movers.push(pv.car);
      for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) movers.push(c);
      for (let i = 0; i < movers.length; i++) if (movers[i].speed > 0.4) sweep(movers[i], i < ai ? 0.08 : 0.5);
      // The player on foot: the nearest within reach of F becomes a car that can be taken.
      const foot = engine.get<PlayerApi>('player')?.foot;
      if (foot) {
        const cx = Math.floor(foot.pos.x / CELL), cz = Math.floor(foot.pos.z / CELL);
        let best: Rec | null = null, bd = 5.5;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const r of grid.get(cellKey(cx + i, cz + j)) ?? []) {
          const d = Math.hypot(r.pos.x - foot.pos.x, r.pos.z - foot.pos.z);
          if (d < bd) { bd = d; best = r; }
        }
        if (best) promote(best, 'foot');
      }
      for (const p of promos) {
        p.prevPos.copy(p.curPos); p.prevQuat.copy(p.curQuat);
        p.car.step(p.filter.update(parkedInput, p.car.forwardSpeed, dt), dt);
      }
    },
    postStep(dt) {
      const cam = engine.camera.position;
      for (let i = promos.length - 1; i >= 0; i--) {
        const p = promos[i], c = p.car;
        c.afterStep(dt);
        p.curPos.copy(c.pos); p.curQuat.copy(c.quat);
        const r = p.rec;
        if (r && !p.moved && (Math.hypot(c.pos.x - r.pos.x, c.pos.z - r.pos.z) > 0.25 || c.quat.angleTo(r.quat) > 0.06)) { p.moved = true; r.state = 4; p.rec = null; stats.knocked++; }
        if (!p.moved) {
          p.quiet = nearestMover(c.pos.x, c.pos.z) > 24 ? p.quiet + dt : 0;
          if (p.quiet > 1.5) demote(p);
        } else if (Math.hypot(c.pos.x - cam.x, c.pos.z - cam.z) > drawR || c.pos.y < -20) putAway(p);
      }
      if (++statT % 30) return;
      let kept = 0, rejected = 0, pending = 0;
      for (const t of tiles.values()) for (const r of t.recs) { if (r.state === 1) kept++; else if (r.state === 2) rejected++; else if (r.state === 0) pending++; }
      stats.kept = kept; stats.rejected = rejected; stats.pending = pending; stats.promoted = promos.length;
    },
  };
  streamer.onParked = onParked;
  for (const [key, park] of streamer.parkedNow()) onParked(key, park);
  engine.add(api);
}
