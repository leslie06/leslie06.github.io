import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { CarLook, DriftState, VehicleApi, WorldApi } from '../game/Contracts';
import type { RenderApi } from '../render';
import { Vehicle } from './Vehicle';
import { TAXI } from './Spec';
import { ControlFilter, type DriveInput } from './ControlFilter';
import { buildCar, defaultLivery, TAXI_LIVERY } from './CarModel';
import { bodyOfSpec, type BodyType } from './Bodies';
import type { RenderSystem } from '../render';
import type { PathPilot } from './Autopilot';

/**
 * The player's taxi: input -> ControlFilter -> Vehicle physics at 60 Hz, the model drawn at the
 * interpolated pose every frame, plus the visual body lean and the drift score.
 */
export async function install(engine: Engine): Promise<void> {
  const world = engine.get<WorldApi>('world')!;
  const render = engine.get<RenderApi>('render');
  const sp = world.spawn;
  let car = new Vehicle(engine.physics, TAXI, { x: sp.x, y: sp.y, z: sp.z }, sp.yaw);
  const onShift = (gear: number) => engine.events.emit('vehicle:shift', { gear });
  car.onShift = onShift;
  let bodyType: BodyType = 'sedan';
  const look: CarLook = { upper: new THREE.Color('#f3b50f'), lower: new THREE.Color('#1f5e3c'), taxi: true, body: bodyType };
  let model = buildCar(TAXI, TAXI_LIVERY, bodyType);
  // Headlight beams: always in the scene (a light appearing would recompile every lit material), dark
  // by day. They sit at the model's headlamps, so they move with a rebuilt body.
  const beams = [0, 1].map(() => new THREE.SpotLight('#fff0d6', 0, 75, 0.46, 0.6, 1.4));
  const attachBeams = () => {
    model.headlamps.forEach((p, i) => {
      const l = beams[i];
      l.position.set(p.x, p.y, p.z);
      l.target.position.set(p.x * 1.8, 0, p.z + 16);
      model.root.add(l, l.target);
    });
  };
  attachBeams();
  engine.scene.add(model.root);
  const filter = new ControlFilter();

  const prevPos = car.pos.clone(), curPos = car.pos.clone();
  const prevQuat = car.quat.clone(), curQuat = car.quat.clone();
  const renderPos = car.pos.clone(), renderQuat = car.quat.clone();
  // Lean state: [pitch, roll] and their rates, as a critically-ish damped spring.
  const lean = { p: 0, r: 0, vp: 0, vr: 0 };
  const drift: DriftState = { active: false, score: 0, multiplier: 1, angle: 0, best: 0, last: 0, lastAt: -99, lastCrashed: false };
  let driftTime = 0, calmTime = 0;
  const drive: DriveInput = { forward: 0, back: 0, steer: 0, analog: false, handbrake: false };
  try { drift.best = Number(localStorage.getItem('drivecity.drift.best') ?? 0) || 0; } catch { /* private mode */ }

  const bank = (crashed: boolean) => {
    const score = crashed ? 0 : Math.round(drift.score);
    drift.last = crashed ? Math.round(drift.score) : score;
    drift.lastAt = engine.time; drift.lastCrashed = crashed;
    if (!crashed && score > drift.best) {
      drift.best = score;
      try { localStorage.setItem('drivecity.drift.best', String(score)); } catch { /* ignore */ }
    }
    engine.events.emit('drift:end', { score, crashed });
    drift.active = false; drift.score = 0; drift.multiplier = 1; driftTime = 0;
  };

  const api: VehicleApi = {
    name: 'vehicle',
    get car() { return car; },
    get model() { return model; },
    renderPos, renderQuat, drift, look,
    occupied: true,
    power: 1,
    swapCar(next, nextLook) {
      const prev = { car, look: { upper: look.upper.clone(), lower: look.lower.clone(), taxi: look.taxi, body: bodyType } };
      car.onShift = undefined;
      car = next;
      car.onShift = onShift;
      look.upper.copy(nextLook.upper); look.lower.copy(nextLook.lower); look.taxi = nextLook.taxi;
      // Another kind of vehicle (a bus, a van): the full-detail model is rebuilt for that body.
      const type = nextLook.body ?? bodyOfSpec(next.spec);
      if (type !== bodyType) {
        const old = model;
        engine.scene.remove(old.root);
        model = buildCar(next.spec, defaultLivery(type), type);
        bodyType = type;
        engine.scene.add(model.root);
        attachBeams();
        engine.get<RenderSystem>('render')?.prepare(model.root);
        old.dispose();
      }
      look.body = type;
      model.setPaint(look.upper, look.lower, look.taxi);
      filter.reset();
      prevPos.copy(car.pos); curPos.copy(car.pos); prevQuat.copy(car.quat); curQuat.copy(car.quat);
      lean.p = lean.r = lean.vp = lean.vr = 0;
      if (drift.active) bank(true);
      return prev;
    },
    get controls() { return filter.out; },
    autopilot: null as PathPilot | null,
    inputEnabled: false,
    reset(pos, yaw) {
      car.reset(pos, yaw);
      filter.reset();
      prevPos.copy(car.pos); curPos.copy(car.pos); prevQuat.copy(car.quat); curQuat.copy(car.quat);
      lean.p = lean.r = lean.vp = lean.vr = 0;
      if (drift.active) bank(true);
      engine.events.emit('vehicle:reset', {});
    },
    fixedUpdate(dt) {
      const inp = engine.input.state;
      if (api.autopilot) {
        const c = car;
        Object.assign(drive, api.autopilot.update({ x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.fwd.x, c.fwd.z), vx: c.vel.x, vz: c.vel.z, forwardSpeed: c.forwardSpeed, bodySlip: c.bodySlip, maxSteer: c.maxSteerAngle(Math.abs(c.forwardSpeed)), wheelbase: c.wheelbase }, dt));
      } else if (api.inputEnabled && api.occupied) {
        drive.forward = inp.forward; drive.back = inp.back; drive.steer = inp.steer; drive.analog = inp.analog; drive.handbrake = inp.handbrake;
        // A failing engine pulls less; a dead one only lets the brakes work.
        if (api.power < 1) { drive.forward *= api.power; if (api.power <= 0 && car.speed < 0.6) drive.back = 0; }
      } else {
        // Nobody at the wheel: parked, handbrake on.
        drive.forward = 0; drive.back = 0; drive.steer = 0; drive.analog = false; drive.handbrake = !api.occupied;
      }
      const c = filter.update(drive, car.forwardSpeed, dt);
      prevPos.copy(curPos); prevQuat.copy(curQuat);
      car.step(c, dt);
    },
    postStep(dt) {
      car.afterStep(dt);
      curPos.copy(car.pos); curQuat.copy(car.quat);
      if (car.impact > 2.5) engine.events.emit('vehicle:impact', { strength: car.impact, point: [car.impactPoint.x, car.impactPoint.y, car.impactPoint.z] });
      const air = car.takeLanding();
      if (air > 0) engine.events.emit('vehicle:land', { airTime: air, speed: car.speed });
      // Drift scoring: points for angle x speed, a multiplier for holding it, lost on a crash.
      const ang = Math.abs(car.bodySlip);
      drift.angle = ang * 180 / Math.PI;
      const sliding = api.occupied && ang > 0.26 && car.speed > 5 && car.grounded >= 3 && car.forwardSpeed > 0;
      if (sliding) {
        drift.active = true; calmTime = 0; driftTime += dt;
        drift.multiplier = Math.min(5, 1 + Math.floor(driftTime / 2));
        drift.score += dt * car.speed * ang * 12 * drift.multiplier;
      } else if (drift.active) {
        calmTime += dt;
        if (calmTime > 0.7) bank(false);
      }
      if (drift.active && car.impact > 3.5) bank(true);
    },
    update(dt, alpha) {
      const inp = engine.input.state;
      if (api.inputEnabled && api.occupied && inp.resetPressed) api.reset();
      renderPos.lerpVectors(prevPos, curPos, alpha);
      renderQuat.slerpQuaternions(prevQuat, curQuat, alpha);
      model.root.position.copy(renderPos);
      model.root.quaternion.copy(renderQuat);
      for (let i = 0; i < 4; i++) {
        const w = car.wheels[i], hub = model.hubs[i];
        hub.position.y = car.spec.mountY - w.springLen;
        hub.rotation.y = w.steer;
        model.spinners[i].rotation.x = w.spin;
      }
      // Body lean from the smoothed body-frame acceleration: nose dives under braking, squats on
      // launch, rolls out of corners. Visual only; the physics body stays stiff (see Spec.forceHeight).
      const tp = THREE.MathUtils.clamp(-car.accel.z * 0.0048, -0.055, 0.07);
      const tr = THREE.MathUtils.clamp(car.accel.x * 0.0075, -0.085, 0.085) * (car.grounded > 1 ? 1 : 0);
      const k = 90, d = 12;
      lean.vp += ((tp - lean.p) * k - lean.vp * d) * dt; lean.p += lean.vp * dt;
      lean.vr += ((tr - lean.r) * k - lean.vr * d) * dt; lean.r += lean.vr * dt;
      model.body.rotation.set(lean.p, 0, lean.r);
      model.body.position.y = -Math.abs(lean.r) * 0.25;
      const c = filter.out;
      const night = engine.get<RenderApi>('render')?.night ?? 0;
      const head = api.occupied && night > 0.35;
      for (const b of beams) b.intensity = head ? 120 * THREE.MathUtils.smoothstep(night, 0.35, 0.7) : 0;
      model.setLights({ brake: api.occupied && (c.brake > 0.1 || (c.handbrake && car.speed > 1)), reverse: api.occupied && car.gear === -1, head });
      render?.setFocus(renderPos);
    },
  };
  engine.add(api);
}
