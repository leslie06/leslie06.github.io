import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { HudApi, MissionApi, PeopleApi, PlayerApi, TrafficCars, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { project } from '../city/Geo';
import { t } from '../core/I18n';
import { Banner } from '../ui/Banner';
import type { Vehicle } from '../vehicle/Vehicle';
import { CameraRig } from './CameraRig';
import { OnFoot } from './OnFoot';
import { Crowd, CROWD_CAP } from '../character/Crowd';
import type { Look } from '../character/Body';

const REACH = 4.2;
/** Where the wasted wake up: 北京协和医院, on 东单北大街 (rough WGS84 hint; the street name decides). */
const HOSPITAL = { road: '东单北大街', lat: 39.9125, lon: 116.415 };

/**
 * Who the player is right now: the driver of `vehicle.car`, or a person on foot. F gets out (a
 * normal exit at the driver's door when slow, a tumble when fast) and gets into the nearest car:
 * the player's own, a parked one, or a traffic car (carjacking: traffic hands it over and gets
 * the player's previous car back as a parked car).
 */
export async function install(engine: Engine): Promise<void> {
  const cam = new CameraRig(engine);
  engine.add(cam);
  const foot = new OnFoot(engine.physics);
  const crowd = new Crowd(engine.scene, CROWD_CAP[engine.quality.tier]);
  crowd.cam = engine.camera;
  // The player: a Beijing cabbie in a slate jacket over a white tee.
  const look: Look = {
    skin: new THREE.Color('#e2bd98'), shirt: new THREE.Color('#39424e'), pants: new THREE.Color('#1b2536'),
    shoes: new THREE.Color('#1a1a1a'), hair: new THREE.Color('#141212'),
    top: 'jacket', inner: new THREE.Color('#e8e6df'), sleeve: 0.53, bottom: 'trousers',
    hairStyle: 'short', height: 1.78, build: 0.12, age: 0.35, beard: true, sole: new THREE.Color('#2a2a2c'),
  };
  let mode: 'driving' | 'onfoot' = 'driving';
  let health = 100, hurtT = 99, wastedT = -1;
  const banner = new Banner();
  let hpEl: HTMLDivElement | null = null, hpBar: HTMLElement | null = null, hpShown = -1;
  const hurt = (n: number) => { if (wastedT >= 0) return; health = Math.max(0, health - n); hurtT = 0; };
  /** Patched up at home. Clamped at 100, which hurt(-n) would not be. */
  const heal = (n: number) => { if (wastedT >= 0) return; health = Math.min(100, health + Math.abs(n)); hurtT = 99; };
  /** A lane on the hospital's street, facing along it; the world spawn outside the city. */
  const hospital = (): { x: number; z: number; yaw: number } => {
    const tr = engine.get<TrafficApi>('traffic');
    const w = engine.get<WorldApi>('world')!;
    if (tr) {
      const [hx, hz] = project(HOSPITAL.lat, HOSPITAL.lon);
      const at = { x: 0, z: 0, dx: 0, dz: 0 };
      let best = -1, bd = Infinity;
      for (const l of tr.graph.links) {
        if (l.name !== HOSPITAL.road) continue;
        tr.graph.at(l, l.len / 2, 0, at);
        const d = Math.hypot(at.x - hx, at.z - hz);
        if (d < bd) { bd = d; best = l.id; }
      }
      if (best >= 0) {
        const l = tr.graph.links[best];
        tr.graph.at(l, l.len / 2, tr.graph.laneOffset(l, Math.max(0, l.lanes - 1)), at);
        return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
      }
    }
    return { x: w.spawn.x, z: w.spawn.z, yaw: w.spawn.yaw };
  };
  const wakeUp = () => {
    wastedT = -1; banner.hide(); health = 100; hurtT = 99;
    engine.get<WantedApi>('wanted')?.clear();
    const m = engine.get<MissionApi>('missions');
    const bill = m ? Math.min(m.cash, 200) : 0;
    if (m && bill > 0) m.addCash(-bill);
    if (m) engine.get<HudApi>('hud')?.toast(t('player.bill', { n: bill }));
    const h = hospital(), v = vehicle();
    v.reset({ x: h.x, y: 0.03 + v.car.spec.wheelRadius + 0.08, z: h.z }, h.yaw);
    v.inputEnabled = true;
  };
  let jumpLatch = false;
  let nearCar = false;
  /** Strapped into a fairground ride: physics is off and the seat drives the character. */
  let rideSeat: { pos: THREE.Vector3; yaw: number } | null = null;
  const position = new THREE.Vector3();
  const prevFeet = new THREE.Vector3(), curFeet = new THREE.Vector3(), drawFeet = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const traffic = () => engine.get<TrafficCars>('traffic');

  const footView = { pos: foot.pos, vel: foot.vel, get yaw() { return foot.yaw; } };

  const exitCar = () => {
    const v = vehicle(), car = v.car;
    // Driver's door: left-hand drive, so the car's left (+X). If a wall is there, use the right.
    let side = 1;
    // Clear of the body, whatever it is: a bus is far wider than the taxi.
    const out = v.model.size.width / 2 + 0.55;
    const hit = engine.physics.raycast({ x: car.pos.x, y: car.pos.y + 0.4, z: car.pos.z }, { x: car.left.x, y: 0, z: car.left.z }, out + 0.8, groups(CG.PED, CG.WORLD), true, car.body);
    if (hit) side = -1;
    tmp.copy(car.pos).addScaledVector(car.left, side * out);
    // Stand on whatever is under the door (road, kerb, a ramp).
    const top = car.pos.y + 1.5;
    const ground = engine.physics.raycast({ x: tmp.x, y: top, z: tmp.z }, { x: 0, y: -1, z: 0 }, 6, groups(CG.PED, CG.WORLD), true);
    foot.enable(tmp.x, ground ? top - ground.distance : car.pos.y - 0.6, tmp.z, Math.atan2(car.fwd.x, car.fwd.z));
    if (car.speed > 4) foot.hit(tmp.copy(car.vel).multiplyScalar(0.8));   // bailing out at speed
    v.occupied = false;
    mode = 'onfoot';
    engine.events.emit('player:mode', { mode, carjacked: false });
    prevFeet.copy(foot.pos); curFeet.copy(foot.pos);
    cam.snap();
  };

  /** Walking to the driver's door; the car is already the player's (parked, handbrake on). */
  let entering: { t: number; dur: number; carjacked: boolean } | null = null;
  const enterCar = (target: Vehicle) => {
    const v = vehicle();
    let carjacked = false;
    if (target !== v.car) {
      const tr = traffic();
      const taken = tr?.takeCar(target);
      if (!taken) return;
      const prev = v.swapCar(target, taken);
      tr!.parkCar(prev.car, prev.look);
      carjacked = !taken.parked;
      // The driver ends up on the road by the door, gets up and runs.
      if (carjacked) engine.get<PeopleApi>('people')?.spawnFleeing(target.pos.x + target.left.x * 1.6 - target.fwd.x * 0.8, target.pos.z + target.left.z * 1.6 - target.fwd.z * 0.8);
    }
    const d = Math.hypot(v.car.pos.x - foot.pos.x, v.car.pos.z - foot.pos.z);
    entering = { t: 0, dur: Math.max(0.25, Math.min(0.9, (d - 1) / 3.2)), carjacked };
  };
  const finishEnter = () => {
    const v = vehicle(), carjacked = entering?.carjacked ?? false;
    entering = null;
    foot.disable();
    v.occupied = true;
    mode = 'driving';
    engine.events.emit('player:mode', { mode, carjacked });
    cam.snap();
  };

  // A reset (respawn, a new game, a shot pose) puts the player back in the driver's seat.
  engine.events.on('vehicle:reset', () => {
    foot.dead = false; entering = null; rideSeat = null;
    if (mode !== 'onfoot') return;
    foot.disable();
    vehicle().occupied = true;
    mode = 'driving';
    engine.events.emit('player:mode', { mode, carjacked: false });
  });

  const api: PlayerApi = {
    name: 'player',
    get mode() { return mode; },
    get position() { return mode === 'onfoot' ? position.copy(foot.pos) : position.copy(vehicle().car.pos); },
    get foot() { return mode === 'onfoot' ? footView : null; },
    get nearCar() { return nearCar; },
    crowd,
    getOut() { if (mode === 'driving') exitCar(); },
    get health() { return health; },
    hurt,
    heal,
    get riding() { return !!rideSeat; },
    setRiding(seat, at) {
      rideSeat = seat;
      if (seat) { foot.disable(); prevFeet.copy(seat.pos); curFeet.copy(seat.pos); }
      else if (at) { foot.enable(at.x, at.y, at.z, at.yaw); prevFeet.copy(foot.pos); curFeet.copy(foot.pos); cam.snap(); }
    },
    fixedUpdate(dt) {
      // Health: back up to half on its own after a quiet spell; at zero, wasted.
      hurtT += dt;
      if (hurtT > 6 && health < 50) health = Math.min(50, health + 3 * dt);
      if (health <= 0 && wastedT < 0) {
        wastedT = 0; foot.dead = true;
        banner.show(t('player.wasted'));
        vehicle().inputEnabled = false;
      }
      if (wastedT >= 0) { wastedT += dt; if (wastedT > 4.5) wakeUp(); }
      if (mode !== 'onfoot') return;
      // On a ride: the seat is the only thing that moves the character.
      if (rideSeat) {
        prevFeet.copy(curFeet);
        foot.pos.copy(rideSeat.pos); foot.yaw = rideSeat.yaw; foot.vel.set(0, 0, 0);
        curFeet.copy(foot.pos);
        return;
      }
      const inp = engine.input.state;
      const v = vehicle();
      engine.camera.getWorldDirection(camDir);
      const camYaw = Math.atan2(camDir.x, camDir.z);
      prevFeet.copy(curFeet);
      const enabled = v.inputEnabled;
      if (entering) {
        // A few steps to the driver's door (left side), then in.
        const car = v.car, e = entering;
        e.t += dt;
        tmp.copy(car.pos).addScaledVector(car.left, v.model.size.width / 2 + 0.15).addScaledVector(car.fwd, 0.15);
        const k = Math.min(1, dt / Math.max(dt, e.dur - e.t + dt));
        const mx = (tmp.x - foot.pos.x) * k, mz = (tmp.z - foot.pos.z) * k;
        if (Math.hypot(mx, mz) > 1e-4) foot.yaw = Math.atan2(mx, mz);
        foot.pos.x += mx; foot.pos.z += mz;
        foot.vel.set(mx / dt, 0, mz / dt);
        curFeet.copy(foot.pos);
        if (e.t >= e.dur) finishEnter();
        return;
      }
      foot.step(enabled ? inp.steer : 0, enabled ? inp.forward - inp.back : 0, enabled && inp.sprint, enabled && jumpLatch, camYaw, dt);
      jumpLatch = false;
      curFeet.copy(foot.pos);
      // Cars that hit the person: inside the car's footprint and moving.
      const check = (car: Vehicle) => {
        if (car.speed < 2.5 || foot.knock) return;
        tmp.subVectors(foot.pos, car.pos);
        const lx = tmp.dot(car.left), lz = tmp.dot(car.fwd);
        if (Math.abs(lx) < 1.15 && Math.abs(lz) < 2.55 && tmp.y > -1.5 && tmp.y < 1.5) {
          hurt(Math.min(120, Math.max(8, (car.speed - 2.5) * 7)));
          foot.hit(tmp.copy(car.vel).multiplyScalar(0.85).addScaledVector(car.left, Math.sign(lx) * 2));
          engine.events.emit('vehicle:impact', { strength: Math.min(8, car.speed * 0.4), point: [foot.pos.x, foot.pos.y + 1, foot.pos.z] });
        }
      };
      check(v.car);
      const tr = traffic() as (TrafficCars & { cars?: () => Vehicle[] }) | undefined;
      for (const c of tr?.cars?.() ?? []) check(c);
      for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) check(c);
    },
    update(dt, alpha) {
      const inp = engine.input.state;
      const v = vehicle();
      if (inp.jumpPressed) jumpLatch = true;
      nearCar = false;
      if (mode === 'onfoot' && !rideSeat) {
        // Only cars that have (nearly) stopped can be got into.
        const close = traffic()?.nearestCar(foot.pos.x, foot.pos.z, REACH);
        const other = close && close.speed < 4 ? close : null;
        const mineD = Math.hypot(v.car.pos.x - foot.pos.x, v.car.pos.z - foot.pos.z);
        const target = mineD < REACH && (!other || mineD <= Math.hypot(other.pos.x - foot.pos.x, other.pos.z - foot.pos.z)) ? v.car : other;
        // Mouse / E / gamepad B: shove whoever is in front.
        if (v.inputEnabled && inp.punchPressed && !entering && foot.shove()) {
          engine.get<PeopleApi>('people')?.shove(foot.pos.x, foot.pos.z, Math.sin(foot.yaw), Math.cos(foot.yaw));
        }
        nearCar = !!target && !foot.knock && !entering;
        if (v.inputEnabled && inp.enterPressed && target && !foot.knock && !entering) enterCar(target);
      } else if (v.inputEnabled && v.occupied && inp.enterPressed && !v.autopilot) {
        exitCar();
      }
      // Health bar (top-right, under the cash) while on foot or hurt.
      if (!hpEl) {
        const hud = document.querySelector('.hud');
        if (hud) {
          const style = document.createElement('style');
          style.textContent = '.hud .health{position:absolute;top:122px;right:28px;width:118px;height:6px;border-radius:3px;background:rgba(0,0,0,.45);overflow:hidden}.hud .health[hidden]{display:none}.hud .health i{display:block;height:100%;background:#62cf6b;transition:width .25s}';
          document.head.appendChild(style);
          hpEl = document.createElement('div'); hpEl.className = 'health';
          hpBar = document.createElement('i'); hpEl.appendChild(hpBar);
          hud.appendChild(hpEl);
        }
      }
      if (hpEl && hpBar) {
        hpEl.hidden = !(mode === 'onfoot' || health < 100);
        const pct = Math.round(health);
        if (pct !== hpShown) { hpShown = pct; hpBar.style.width = `${pct}%`; hpBar.style.background = pct < 30 ? '#e0463a' : '#62cf6b'; }
      }
      crowd.begin();
      // A rider is inside the car with the camera on their seat: drawing them fills the view.
      if (mode === 'onfoot' && !rideSeat) {
        foot.animate(dt);
        drawFeet.lerpVectors(prevFeet, curFeet, alpha);
        crowd.add(drawFeet, foot.yaw, foot.gait, look);
      }
    },
  };
  engine.add(api);
}
