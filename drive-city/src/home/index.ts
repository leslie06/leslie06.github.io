import * as THREE from 'three';
import { project } from '../city/Geo';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import { CG, groups } from '../core/Physics';
import type { HomeApi, HudApi, MissionApi, PlayerApi, RenderApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { ANCHOR, DOOR, GARAGE, HOUSE, PLOT } from './Layout';
import { garageDoor, villaMaterials } from './Villa';

/**
 * Home: the garage door opens for you, and parking inside banks the day.
 *
 * The door is a roller: its top is pinned at the head of the opening and the panel is scaled down
 * as it opens, which is both what a roller door does and the one animation that needs no second
 * body. Its collider is a plain static box that is switched off once the door is more than a third
 * open - the door opens from 16 m away, so the car is never in the opening while it is moving.
 *
 * Parking in the garage is the save: cash is already persisted by missions/, so what this adds is
 * the rest of a safehouse - the wanted level goes, the player is patched up, and the state is
 * written to localStorage so a later session can read what you came home with.
 */

const SAVE_KEY = 'drivecity.home.v1';
/** Don't re-save while the car simply sits there. */
const SAVE_COOLDOWN = 45;
/** Slower than this counts as parked. */
const PARKED_SPEED = 1.6;

export interface HomeSave {
  /** ms since epoch. */
  at: number;
  cash: number;
  car: { body: string; upper: string; lower: string; taxi: boolean } | null;
  tod: number;
}

export function readHomeSave(): HomeSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as HomeSave) : null;
  } catch { return null; }
}

/** The villa with the handles poses and probes drive it by. */
export interface HomeSystem extends HomeApi {
  debug: { save(): void; setDoor(u: number): void; state(): { door: number; atHome: boolean; savedAt: number } };
}

export async function install(engine: Engine): Promise<void> {
  const player = engine.get<PlayerApi>('player');
  if (!player) return;
  const env = engine.get<RenderSystem & { uniforms: import('../game/Contracts').EnvUniforms }>('render')?.uniforms
    ?? { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };

  // The door sits in the same frame as the landmark: villa-local metres at the villa's anchor.
  const [ax, az] = project(ANCHOR.lat, ANCHOR.lon);
  const root = new THREE.Group();
  root.name = 'home';
  root.position.set(ax, 0, az);
  root.rotation.y = -ANCHOR.headingDeg * Math.PI / 180;
  engine.scene.add(root);

  // Pinned at the head of the opening, hanging down: scaling y closes it.
  const door = garageDoor(villaMaterials(env));
  const doorPivot = new THREE.Group();
  doorPivot.position.set(GARAGE.x0 - HOUSE.wall / 2, DOOR.h, DOOR.z);
  door.position.y = -DOOR.h / 2;
  doorPivot.add(door);
  root.add(doorPivot);

  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const doorCol = world.createCollider(
    R.ColliderDesc.cuboid(DOOR.t / 2, DOOR.h / 2, DOOR.w / 2)
      .setTranslation(ax + GARAGE.x0 - HOUSE.wall / 2, DOOR.h / 2, az + DOOR.z)
      .setCollisionGroups(groups(CG.WORLD, CG.ALL)),
    body);
  engine.physics.tag(doorCol, { surface: 'metal', tag: 'home:door' });

  const doorAt = new THREE.Vector3(ax + GARAGE.x0 - HOUSE.wall / 2, 1.2, az + DOOR.z);
  const hud = () => engine.get<HudApi>('hud');
  /** Villa-local position of the player (the villa's heading is 0, so this is a translation). */
  const local = (out: THREE.Vector2): THREE.Vector2 => {
    const p = player.position;
    return out.set(p.x - ax, p.z - az);
  };

  let open = 0, want = 0, savedAt = 0, cooldown = 0, atHome = false, greeted = 0;
  const here = new THREE.Vector2();

  const save = () => {
    const v = engine.get<VehicleApi>('vehicle');
    const cash = engine.get<MissionApi>('missions')?.cash ?? 0;
    const look = v?.look;
    const data: HomeSave = {
      at: Date.now(),
      cash,
      car: look ? {
        body: look.body ?? 'sedan',
        upper: `#${look.upper.getHexString()}`,
        lower: `#${look.lower.getHexString()}`,
        taxi: look.taxi,
      } : null,
      tod: engine.get<RenderApi>('render')?.timeOfDay ?? 0,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
    savedAt = data.at;
    cooldown = SAVE_COOLDOWN;
    player.heal(100);
    engine.get<WantedApi>('wanted')?.clear();
    hud()?.toast(t('home.saved', { cash }));
  };

  const inGarage = (x: number, z: number): boolean =>
    x > GARAGE.x0 && x < GARAGE.x1 && z > GARAGE.z0 && z < GARAGE.z1;

  const api: HomeSystem = {
    name: 'home',
    get atHome() { return atHome; },
    get doorOpen() { return open; },
    get savedAt() { return savedAt; },
    debug: {
      save,
      setDoor(u) { open = want = Math.max(0, Math.min(1, u)); doorCol.setEnabled(open < 0.35); },
      state() { return { door: open, atHome, savedAt }; },
    },

    fixedUpdate(dt) {
      cooldown = Math.max(0, cooldown - dt);
      local(here);
      atHome = Math.abs(here.x) < PLOT.hw && Math.abs(here.y) < PLOT.hd;
      if (atHome) {
        if (greeted <= 0) { hud()?.toast(t('home.welcome')); greeted = 120; }
      } else if (greeted > 0) greeted = Math.max(0, greeted - dt);

      // Open for whoever comes up the drive, on foot or in a car; hysteresis so it does not flap.
      const d = player.position.distanceTo(doorAt);
      want = d < DOOR.open ? 1 : d > DOOR.shut ? 0 : want;
      const step = dt / DOOR.time;
      open = want > open ? Math.min(want, open + step) : Math.max(want, open - step);
      doorCol.setEnabled(open < 0.35);

      // Parking inside is the save.
      const v = engine.get<VehicleApi>('vehicle');
      if (v && v.occupied && player.mode === 'driving' && cooldown <= 0) {
        const car = v.car;
        const cx = car.pos.x - ax, cz = car.pos.z - az;
        if (inGarage(cx, cz) && car.vel.length() < PARKED_SPEED) save();
      }
    },

    update() {
      // A zero scale is degenerate; leave a sliver of panel in the head.
      doorPivot.scale.y = Math.max(0.02, 1 - open);
    },
  };
  engine.add(api);
  // Built here rather than streamed, but it still needs the night/wet/shadow patch a tile gets.
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(root));
}
