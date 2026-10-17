import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { CG, groups } from '../core/Physics';
import type { CameraApi, HudApi, MissionApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import { shotMode } from '../debug/ShotMode';
import type { IntroApi } from '../intro';
import type { UiApi } from '../ui';

const KEY = 'drivecity.resume.v1';
/** How often the pose is written while playing (it also goes on pagehide / tab hidden). */
const EVERY = 30;
/** On foot further than this from the car: come back where the player was, on the nearest road. */
const FAR_FROM_CAR = 150;

/** `car`: the car's own pose, tried as it is first; `foot`: a spot to find a road near. */
interface Saved { kind: 'car' | 'foot'; x: number; y: number; z: number; yaw: number }

export interface ResumeApi extends System {
  /** Putting the car back where the last session left it (loading its streets). */
  readonly restoring: boolean;
  debug: { save(): Saved | null; saved(): Saved | null };
}

/**
 * The car where you left it (2026-10-17, 「把车开到了5环，我重新进游戏，发现还是出生点」): the pose of the
 * car the player last drove is kept in localStorage (so the cloud save carries it to the account), and
 * a new session starts there instead of at the spawn - after its streets have loaded, as the opening
 * getaway does. The car is whichever one the session starts in (the garage's own or the taxi); a car
 * taken off the street is not kept. A pose that no longer fits (a parked car or a fence there now)
 * falls back to the nearest lane, as R does; nothing near, the spawn. `?resume=0` turns it off.
 */
export function install(engine: Engine): void {
  if (shotMode || new URLSearchParams(location.search).get('resume') === '0') return;
  const v = () => engine.get<VehicleApi>('vehicle')!;
  const pl = () => engine.get<PlayerApi>('player');
  let started = false, restoring = false, clock = 0, lastJson = '';
  /** The line this module put on the HUD (cleared only if still ours). */
  let shown: string | null = null;

  const read = (): Saved | null => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
      if (!s || (s.kind !== 'car' && s.kind !== 'foot') || ![s.x, s.y, s.z, s.yaw].every(Number.isFinite)) return null;
      return s;
    } catch { return null; }
  };

  /** Where the player is now, or null while that is not a place to come back to. */
  const pose = (): Saved | null => {
    if (!started || restoring) return null;
    if (engine.get<UiApi>('ui')?.state === 'title') return null;
    const intro = engine.get<IntroApi>('intro')?.step;
    if (intro !== undefined && intro !== 'off' && intro !== 'done') return null;
    const p = pl();
    if (p?.riding) return null;
    const car = v().car;
    if (car.pos.y < -50) return null;   // stashed out of the world (impounded, swapped out)
    const r1 = (n: number) => Math.round(n * 10) / 10, r2 = (n: number) => Math.round(n * 100) / 100;
    const foot = p?.mode === 'onfoot' ? p.foot : null;
    if (foot && Math.hypot(foot.pos.x - car.pos.x, foot.pos.z - car.pos.z) > FAR_FROM_CAR) {
      return { kind: 'foot', x: r1(foot.pos.x), y: r1(foot.pos.y), z: r1(foot.pos.z), yaw: 0 };
    }
    // In the air (a jump, a crash): keep the last pose on the ground.
    if (car.grounded < 3) return null;
    return { kind: 'car', x: r1(car.pos.x), y: r1(car.pos.y), z: r1(car.pos.z), yaw: r2(Math.atan2(car.fwd.x, car.fwd.z)) };
  };
  const save = (): Saved | null => {
    const s = pose();
    if (!s) return null;
    const json = JSON.stringify(s);
    // Unchanged pose: no write, so the cloud's change check stays quiet while parked.
    if (json !== lastJson) { try { localStorage.setItem(KEY, json); lastJson = json; } catch { /* private mode */ } }
    return s;
  };
  // Before the cloud's own handlers (cloud/ installs after this): its keepalive upload takes the pose too.
  window.addEventListener('pagehide', () => { save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  /** The car's pose fits as it is: ground under the wheels and nothing in the body's way. */
  const fits = (s: Saved): { y: number } | null => {
    const { R, world } = engine.physics, car = v().car;
    const down = engine.physics.raycast({ x: s.x, y: s.y + 1.5, z: s.z }, { x: 0, y: -1, z: 0 }, 4, groups(CG.CAR, CG.WORLD), true, car.body);
    if (!down) return null;
    const ground = s.y + 1.5 - down.distance, size = v().model.size;
    const box = new R.Cuboid(size.width / 2, 0.6, size.length / 2);
    const q = { x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) };
    let blocked = false;
    world.intersectionsWithShape({ x: s.x, y: ground + 1.25, z: s.z }, q, box, (col) => {
      if (col.isSensor() || col.parent() === car.body) return true;
      blocked = true; return false;
    });
    return blocked ? null : { y: ground };
  };

  const restore = async (s: Saved) => {
    const world = engine.get<WorldApi>('world');
    const sp = world?.spawn;
    if (!world || !sp || Math.hypot(s.x - sp.x, s.z - sp.z) < 30) return;
    restoring = true;
    const m = engine.get<MissionApi>('missions');
    if (m && !m.story) { shown = t('resume.loading'); m.story = shown; }
    try {
      await world.preload?.(s.x, s.z);
      const veh = v();
      let to: { pos: { x: number; y: number; z: number }; yaw: number } | null = null;
      const ok = s.kind === 'car' ? fits(s) : null;
      if (ok) to = { pos: { x: s.x, y: ok.y + 0.03 + veh.car.spec.wheelRadius + 0.08, z: s.z }, yaw: s.yaw };
      else to = veh.roadPoseNear?.(s.x, s.y, s.z) ?? null;
      // Someone else moved the car while the streets loaded (a chapter, a ride): leave it be.
      if (!to || Math.hypot(veh.car.pos.x - sp.x, veh.car.pos.z - sp.z) > 5) return;
      veh.reset(to.pos, to.yaw);
      engine.get<CameraApi>('camera')?.snap();
      engine.get<HudApi>('hud')?.toast(t('resume.back'));
    } finally {
      restoring = false;
      if (m && shown && m.story === shown) m.story = null;
      shown = null;
      const ui = engine.get<UiApi>('ui');
      v().inputEnabled = !ui || ui.state === 'playing';
    }
  };

  // Registered after the garage (your own car in place), the intro and the adventure: theirs run first.
  engine.events.on('game:start', () => {
    if (started) return;
    started = true;
    const intro = engine.get<IntroApi>('intro')?.step;
    if (intro !== undefined && intro !== 'off' && intro !== 'done') return;
    const s = read();
    if (s) void restore(s);
  });

  const api: ResumeApi = {
    name: 'resume',
    get restoring() { return restoring; },
    debug: { save, saved: read },
    fixedUpdate() {
      // Held still while the streets load, or the player drives off from the spawn and is snatched away.
      if (restoring) v().inputEnabled = false;
    },
    update(dt) {
      clock += dt;
      if (clock < EVERY) return;
      clock = 0;
      save();
    },
  };
  engine.add(api);
}
