import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { HudApi, VehicleApi } from '../game/Contracts';
import type { FxApi } from '../fx';
import type { Vehicle } from '../vehicle/Vehicle';

export interface DamageApi extends System {
  /** The player's current car, 0 (engine dead) .. 100. */
  health(): number;
  repair(): void;
}

/**
 * Wear on the cars the player drives. Every hard hit takes health off that car (kept per car, so a
 * wreck left behind stays a wreck): below 45 it smokes, below 20 it loses power, at 0 the engine
 * dies and the player has to find another car. A respawn (a reset far from where the car was)
 * repairs it; R flipping it upright does not.
 */
export async function install(engine: Engine): Promise<void> {
  const hp = new WeakMap<Vehicle, number>();
  const last = new THREE.Vector3();
  let lastCar: Vehicle | null = null, smokeT = 0, clock = 0, lastHit = -9;
  const veh = () => engine.get<VehicleApi>('vehicle')!;
  const get = (car: Vehicle) => hp.get(car) ?? 100;

  engine.events.on('vehicle:impact', (e) => {
    const v = veh();
    if (!v.occupied) return;
    const car = v.car, [x, , z] = e.point;
    if (Math.hypot(x - car.pos.x, z - car.pos.z) > 4) return;
    // A collision fires an impact every step while the car is still scraping, so only the first of
    // a burst counts. Light knocks do nothing, and no single crash can total the car.
    if (clock - lastHit < 0.35) return;
    const before = get(car), dmg = Math.min(30, Math.max(0, e.strength - 6) * 2.2);
    if (dmg <= 0) return;
    lastHit = clock;
    const after = Math.max(0, before - dmg);
    hp.set(car, after);
    if (before > 0 && after <= 0) engine.get<HudApi>('hud')?.toast(t('car.dead'));
  });
  engine.events.on('vehicle:reset', () => {
    const car = veh().car;
    if (car !== lastCar || car.pos.distanceTo(last) > 30) hp.set(car, 100);
  });

  const api: DamageApi = {
    name: 'damage',
    health: () => get(veh().car),
    repair: () => { hp.set(veh().car, 100); },
    fixedUpdate(dt) {
      clock += dt;
      const v = veh(), car = v.car, h = get(car);
      // A wrecked car still limps: the player can always crawl somewhere and find another.
      v.power = h <= 0 ? 0.3 : h < 12 ? 0.55 : h < 30 ? 0.8 : 1;
      last.copy(car.pos); lastCar = car;
    },
    update(dt) {
      const car = veh().car, h = get(car);
      if (h >= 40) return;
      smokeT -= dt;
      const fx = engine.get<FxApi>('fx');
      if (smokeT > 0 || !fx) return;
      smokeT = h <= 0 ? 0.035 : h < 15 ? 0.06 : 0.12;
      // From under the bonnet: grey at first, black once the engine is gone.
      const k = 1.5, u = 0.45;
      fx.smoke(car.pos.x + car.fwd.x * k + car.up.x * u, car.pos.y + car.fwd.y * k + car.up.y * u, car.pos.z + car.fwd.z * k + car.up.z * u,
        car.vel.x * 0.6, 0.6, car.vel.z * 0.6, h <= 0 ? 0.7 : 0.45, h <= 0 ? 3 : 2, h <= 0 ? 0.9 : h < 15 ? 0.6 : 0.15);
    },
  };
  engine.add(api);
}
