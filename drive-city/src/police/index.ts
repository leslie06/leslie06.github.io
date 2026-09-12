import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { Crime, HudApi, NavApi, PlayerApi, RenderApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { CarKit } from '../traffic/CarKit';
import { POLICE_LIVERY } from '../vehicle/CarModel';
import { ControlFilter, type DriveInput } from '../vehicle/ControlFilter';
import { TAXI, type VehicleSpec } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { Pursuit, type Goal, type Router } from './Pursuit';
import { WantedHud } from './WantedHud';

/** Police cars: the taxi chassis with a stronger engine. */
const POLICE: VehicleSpec = { ...TAXI, engine: { ...TAXI.engine, torque: TAXI.engine.torque.map(([r, n]) => [r, n * 1.35] as [number, number]), limiterKmh: 215 } };
/** Police cars on the streets per star. */
const COUNT = [0, 2, 3, 4, 5, 7];
/** Chasing cars plus a two-car roadblock. */
const MAX = 9;
const WHITE = new THREE.Color('#f4f5f3'), BLUE = new THREE.Color('#1c47a8');
/** Heat per crime, in stars (half as much once already wanted). */
const HEAT: Record<Crime, number> = { hit_person: 1, carjack: 1, hit_police: 1, ram: 0.35, speeding: 1 };
const STOP: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
const searchRadius = (lv: number) => 90 + 30 * lv;

interface Cop {
  car: Vehicle; driver: Pursuit; filter: ControlFilter; active: boolean;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  sees: boolean; flipped: number; goal: Goal; search: { x: number; z: number; t: number };
  /** Seconds left parked across the road as a roadblock (0: chasing). */
  block: number;
}

export interface PoliceSystem extends WantedApi {
  /** Shots and testing: force a wanted level; `noBust` keeps the player free. */
  debug: { setLevel(n: number): void; noBust: boolean };
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
  const kit = new CarKit(engine.scene, MAX, POLICE_LIVERY);
  const cops: Cop[] = Array.from({ length: MAX }, (_, i) => {
    const car = new Vehicle(engine.physics, POLICE, { x: 0, y: -400 - i * 6, z: 0 }, 0);
    car.body.setEnabled(false);
    return { car, driver: new Pursuit(), filter: new ControlFilter(), active: false, prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(),
      sees: false, flipped: 0, goal: { x: 0, z: 0, vx: 0, vz: 0 }, search: { x: 0, z: 0, t: 0 }, block: 0 };
  });
  const onStreet: Vehicle[] = [];
  const hud = new WantedHud();
  // Light-bar glow on the nearest police car. Always in the scene: a light appearing would recompile every material.
  const glowR = new THREE.PointLight('#ff2a2a', 0, 30, 1.6), glowB = new THREE.PointLight('#2e62ff', 0, 30, 1.6);
  engine.scene.add(glowR, glowB);

  let heat = 0, seen = false, lastX = 0, lastZ = 0, evade = 0, bust = 0, busted = -1, clock = 0, spawnT = 0, losT = 0, sirenD = Infinity, blockT = 12;
  const area = { x: 0, z: 0, r: 0 };
  const startLevel = Math.max(0, Math.min(5, Number(new URLSearchParams(location.search).get('wanted') ?? 0) || 0));
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const level = () => Math.floor(heat);
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const camDir = new THREE.Vector3(), renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion(), nearPos = new THREE.Vector3(), nearLeft = new THREE.Vector3();
  const losGroups = groups(CG.CAR, CG.WORLD);
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

  const despawn = (c: Cop) => {
    c.active = false;
    c.car.body.setTranslation({ x: 0, y: -400, z: 0 }, false);
    c.car.body.setEnabled(false);
  };

  /**
   * A police car out of sight on a main road 110-260 m from (cx, cz): the player while they are
   * seen, the search circle's centre while they are not (never within 110 m of the player).
   */
  const spawnCop = (cx: number, cz: number): boolean => {
    const c = cops.find((k) => !k.active);
    if (!c) return false;
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    const ids = g.near(cx, cz, 260);
    for (let attempt = 0; attempt < 16 && ids.length; attempt++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      if (l.len < 30 || l.cls === 'service' || l.cls === 'living_street' || l.cls.endsWith('_link')) continue;
      g.at(l, 8 + rnd() * (l.len - 16), g.laneOffset(l, 0), tmp);
      const d = Math.hypot(tmp.x - cx, tmp.z - cz);
      if (d < 110 || d > 260 || Math.hypot(tmp.x - P.x, tmp.z - P.z) < 110) continue;
      const dc = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (dc < 160 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / dc > 0.3) continue;
      if (onStreet.some((o) => Math.hypot(o.pos.x - tmp.x, o.pos.z - tmp.z) < 15) || tr.nearestCar(tmp.x, tmp.z, 9)) continue;
      c.car.body.setEnabled(true);
      c.car.reset({ x: tmp.x, y: 0.03 + TAXI.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      c.car.setMoving(12);
      c.driver.reset(); c.filter.reset();
      c.prevPos.copy(c.car.pos); c.curPos.copy(c.car.pos); c.prevQuat.copy(c.car.quat); c.curQuat.copy(c.car.quat);
      c.active = true; c.flipped = 0; c.sees = false; c.search.t = 0; c.block = 0;
      onStreet.push(c.car);
      return true;
    }
    return false;
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

  /** Three stars and up: two cars parked across the player's road about 170 m ahead. */
  const roadblock = (): boolean => {
    const free = cops.filter((k) => !k.active);
    if (free.length < 2 || P.speed < 12) return false;
    const pl0 = playerLink();
    if (!pl0) return false;
    let l = g.links[pl0.id], s = pl0.s + 170;
    for (let hop = 0; s > l.len - 6 && hop < 12; hop++) { s -= l.len; const nx = g.next(l.id, rnd); if (nx === l.id) return false; l = g.links[nx]; }
    if (s > l.len - 6 || s < 6 || l.lanes < 1) return false;
    const offs = [g.laneOffset(l, 0), l.lanes > 1 ? g.laneOffset(l, 1) : g.laneOffset(l, 0) - 3.1];
    for (let i = 0; i < 2; i++) {
      g.at(l, s + i * 1.5, offs[i], tmp);
      if (tr.nearestCar(tmp.x, tmp.z, 7)) return false;
    }
    for (let i = 0; i < 2; i++) {
      const c = free[i];
      g.at(l, s + i * 1.5, offs[i], tmp);
      c.car.body.setEnabled(true);
      c.car.reset({ x: tmp.x, y: 0.03 + TAXI.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz) + (i ? -1 : 1) * Math.PI / 2);
      c.driver.reset(); c.filter.reset();
      c.prevPos.copy(c.car.pos); c.curPos.copy(c.car.pos); c.prevQuat.copy(c.car.quat); c.curQuat.copy(c.car.quat);
      c.active = true; c.flipped = 0; c.sees = false; c.search.t = 0; c.block = 45;
      onStreet.push(c.car);
    }
    return true;
  };

  const crime = (kind: Crime, x: number, z: number) => {
    if (busted >= 0) return;
    let witnessed = kind === 'hit_police';
    for (const c of cops) if (!witnessed && c.active && canSee(c.car, x, 1, z, 90)) witnessed = true;
    // Otherwise someone may call it in.
    if (!witnessed) witnessed = kind === 'hit_person' ? rnd() < 0.7 : kind === 'carjack' ? rnd() < 0.3 : false;
    if (!witnessed) return;
    heat = Math.min(5.99, heat + HEAT[kind] * (level() === 0 ? 1 : 0.5));
    if (level() > 0) { lastX = x; lastZ = z; seen = true; evade = 0; }
  };

  const clear = () => {
    heat = 0; seen = false; evade = 0; bust = 0; busted = -1;
    api.debug.noBust = false;
    for (const c of cops) if (c.active) despawn(c);
    onStreet.length = 0;
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
    policeCars: () => onStreet,
    crime, clear,
    debug: {
      setLevel(n) {
        heat = Math.max(0, Math.min(5.99, n));
        readPlayer(); lastX = P.x; lastZ = P.z; seen = n > 0; evade = 0;
      },
      noBust: false,
    },
    fixedUpdate(dt) {
      clock += dt;
      readPlayer();
      if (busted >= 0) {
        busted += dt;
        for (const c of cops) if (c.active) { c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat); c.car.step(c.filter.update(STOP, c.car.forwardSpeed, dt), dt); }
        if (busted > 3.4) respawn();
        return;
      }
      let lv = level();
      // Who can see the player: a few rays per second.
      losT -= dt;
      if (lv > 0 && losT <= 0) {
        losT = 0.25;
        for (const c of cops) c.sees = c.active && canSee(c.car, P.x, P.y + 1, P.z, 70 + 15 * lv);
      }
      const nav = engine.get<NavApi>('nav');
      if (lv > 0) {
        if (cops.some((c) => c.active && c.sees)) {
          seen = true; lastX = P.x; lastZ = P.z; evade = 0;
          if (heat < 4.99) heat = Math.min(4.99, heat + dt / 120);   // a long chase escalates, up to four stars
        } else {
          seen = false;
          const outside = Math.hypot(P.x - lastX, P.z - lastZ) > searchRadius(lv);
          evade += dt * (outside ? 1 : 0.3);
          if (evade > 6 + 3 * lv) {
            heat = 0; evade = 0; lv = 0;
            engine.get<HudApi>('hud')?.toast(t('wanted.lost'));
          }
        }
      } else { seen = false; heat = Math.max(0, heat - dt * 0.02); }
      if (nav) {
        area.x = lastX; area.z = lastZ; area.r = searchRadius(lv);
        nav.searchArea = lv > 0 && !seen ? area : null;
      }
      // Bring cars in.
      spawnT -= dt;
      const n = cops.reduce((k, c) => k + (c.active ? 1 : 0), 0);
      const chasing = cops.reduce((k, c) => k + (c.active && c.block <= 0 ? 1 : 0), 0);
      if (spawnT <= 0 && chasing < COUNT[lv] && n < MAX) { spawnT = n === 0 ? 0.3 : 1.2; if (seen) spawnCop(P.x, P.z); else spawnCop(lastX, lastZ); }
      blockT -= dt;
      if (lv >= 3 && seen && blockT <= 0) blockT = roadblock() ? 30 : 3;
      // Drive.
      const router: Router | null = nav ? (a, b, c, d, e) => nav.route(a, b, c, d, e) : null;
      for (const c of cops) {
        if (!c.active) continue;
        if (c.block > 0) {
          // Parked across the road until the player is close (or the block times out), then give chase.
          c.block -= dt;
          if (Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z) < 22 || lv === 0) c.block = 0;
          c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat);
          c.car.step(c.filter.update(STOP, c.car.forwardSpeed, dt), dt);
          continue;
        }
        const gl = c.goal;
        let direct = false, gentle = false;
        if (lv === 0) {
          // Standing down: roll on along the road until out of sight.
          gl.x = c.car.pos.x + c.car.fwd.x * 60; gl.z = c.car.pos.z + c.car.fwd.z * 60; gl.vx = gl.vz = 0;
          direct = true; gentle = true; c.driver.topSpeed = 11;
        } else if (seen) {
          gl.x = P.x; gl.z = P.z; gl.vx = P.vx; gl.vz = P.vz;
          direct = c.sees && Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z) < 70;
          c.driver.topSpeed = 30 + 2 * lv;
        } else {
          const s = c.search;
          s.t -= dt;
          if (s.t <= 0 || Math.hypot(s.x - c.car.pos.x, s.z - c.car.pos.z) < 15) {
            const a = rnd() * Math.PI * 2, r = rnd() * searchRadius(lv) * 0.7;
            s.x = lastX + Math.cos(a) * r; s.z = lastZ + Math.sin(a) * r; s.t = 12;
          }
          gl.x = s.x; gl.z = s.z; gl.vx = gl.vz = 0;
          c.driver.topSpeed = 17;
        }
        const inp = c.driver.update(c.car, gl, direct, dt, router, gentle);
        c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat);
        c.car.step(c.filter.update(inp, c.car.forwardSpeed, dt), dt);
      }
      // Busted: stopped with a police car right there.
      if (lv > 0 && !api.debug.noBust) {
        const driving = pl.mode === 'driving';
        const near = cops.some((c) => c.active && c.car.speed < 4 && Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z) < (driving ? 7.5 : 5));
        bust = near && P.speed < (driving ? 1.5 : 1.2) ? bust + dt : Math.max(0, bust - dt * 2);
        if (bust > (driving ? 2.5 : 1.2)) { busted = 0; bust = 0; hud.busted(true); vehicle().inputEnabled = false; }
      }
    },
    postStep(dt) {
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      onStreet.length = 0; sirenD = Infinity;
      const lv = level();
      for (const c of cops) {
        if (!c.active) continue;
        c.car.afterStep(dt);
        c.curPos.copy(c.car.pos); c.curQuat.copy(c.car.quat);
        c.flipped = c.car.up.y < 0.5 ? c.flipped + dt : 0;
        // Searching cars belong to the search circle, not to wherever the player went.
        const d = Math.min(Math.hypot(c.car.pos.x - P.x, c.car.pos.z - P.z), lv > 0 && !seen ? Math.hypot(c.car.pos.x - lastX, c.car.pos.z - lastZ) : Infinity);
        const dc = Math.hypot(c.car.pos.x - cam.x, c.car.pos.z - cam.z);
        const inView = dc < 1 || ((c.car.pos.x - cam.x) * camDir.x + (c.car.pos.z - cam.z) * camDir.z) / dc > 0.2;
        const wrecked = c.flipped > 3 || c.car.pos.y < -5;
        if (d > 420 || (lv === 0 && busted < 0 && (d > 120 || !inView)) || (wrecked && (!inView || dc > 80))) { despawn(c); continue; }
        onStreet.push(c.car);
        sirenD = Math.min(sirenD, dc);
      }
    },
    update(_dt, alpha) {
      const cam = engine.camera.position;
      let k = 0, nd = Infinity;
      for (const c of cops) {
        if (!c.active) continue;
        renderPos.lerpVectors(c.prevPos, c.curPos, alpha);
        renderQuat.slerpQuaternions(c.prevQuat, c.curQuat, alpha);
        kit.set(k++, renderPos, renderQuat, c.car, WHITE, BLUE, true);
        const d = renderPos.distanceTo(cam);
        if (d < nd) { nd = d; nearPos.copy(renderPos); nearLeft.copy(c.car.left); }
      }
      kit.commit(k);
      const night = engine.get<RenderApi>('render')?.night ?? 0;
      kit.setHeadlights(night > 0.35);
      // Light bar: red then blue, a double flash each.
      const lit = level() > 0 || busted >= 0;
      const ph = (clock * 2.4) % 2, u = ph % 1, flash = u < 0.16 || (u > 0.28 && u < 0.44) ? 1 : 0;
      const red = lit && ph < 1 ? flash : 0, blue = lit && ph >= 1 ? flash : 0;
      kit.setBeacons(0.25 + red * 9, 0.25 + blue * 9);
      const glow = lit && nd < 70 ? 18 + 70 * night : 0;
      glowR.intensity = glow * red; glowB.intensity = glow * blue;
      if (glow > 0) {
        glowR.position.copy(nearPos).addScaledVector(nearLeft, 0.3); glowR.position.y += 1.5;
        glowB.position.copy(nearPos).addScaledVector(nearLeft, -0.3); glowB.position.y += 1.5;
      }
      hud.update(level(), seen);
    },
  };
  engine.add(api);
}
