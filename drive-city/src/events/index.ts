import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, RaceApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { GarageApi } from '../garage';
import type { IntroApi } from '../intro';
import { pickAddress } from '../missions/Address';
import { Marker } from '../missions/Marker';
import { Pursuit } from '../police/Pursuit';
import type { TrafficApi } from '../traffic';
import { CarKit } from '../traffic/CarKit';
import { Banner } from '../ui/Banner';
import { ControlFilter } from '../vehicle/ControlFilter';
import { TAXI, type VehicleSpec } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';

/** Seconds of free driving between events: the first comes sooner. */
const FIRST = [35, 55], GAP = [55, 100];
export const BOUNTY = 400, RACE_PRIZE = 300;
/** The fugitive: seconds to stop it, rams that stop it. */
const FUGITIVE_TIME = 90, RAMS = 3;
/** The challenger: a tuned saloon, a sprint of this many road metres. */
const RIVAL: VehicleSpec = { ...TAXI, engine: { ...TAXI.engine, torque: TAXI.engine.torque.map(([r, n]) => [r, n * 1.3] as [number, number]), limiterKmh: 210 } };
const SPRINT = [1200, 1800];
const RED = new THREE.Color('#b3121c'), BLACK = new THREE.Color('#111214');

type Kind = 'fugitive' | 'challenge' | 'urgent';

export interface EventsApi extends System {
  readonly active: Kind | null;
  debug: { start(kind: Kind): boolean; wait(): number; state(): { kind: Kind | null; hits: number; left: number; rivalLeft: number; playerLeft: number; runner: { x: number; z: number; yaw: number; speed: number } | null } };
}

/**
 * Street events: every minute or two of free driving (no stars, no race, job, passenger, story or
 * garage), something happens near the player -
 *   fugitive   a car bolts past, reckless and blind to red lights (traffic's `spawnRunner`): ram it
 *              RAMS times or box it to a stop within FUGITIVE_TIME for BOUNTY;
 *   challenge  a red saloon pulls up beside you and blows its horn: first to an address SPRINT
 *              metres ahead wins RACE_PRIZE (it drives the route with the police pursuit driver,
 *              rubber-banded like the race rivals);
 *   urgent     in a taxi, a rush fare appears on the kerb (missions' `urgentFare`).
 * Each has a banner, a line in the objective slot (`MissionApi.story`) and a flashing blip.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const rng = new Rng(3131);
  const rnd = () => rng.next();
  const banner = new Banner();
  const marker = new Marker(engine.scene);
  const kit = new CarKit(engine.scene, 1);
  const rival = { car: new Vehicle(engine.physics, RIVAL, { x: 0, y: -700, z: 0 }, 0), driver: new Pursuit(), filter: new ControlFilter(),
    prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(), path: new Float32Array(0) as Float32Array, len: 0 };
  rival.car.body.setEnabled(false);

  let active: Kind | null = null, wait = FIRST[0] + rnd() * (FIRST[1] - FIRST[0]), clock = 0, hits = 0, hitCd = 0, stillT = 0;
  let runner: { car: Vehicle; release(): void } | null = null;
  let finish: { x: number; z: number; label: string } | null = null, racing = false, rivalOn = false;

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const missions = () => engine.get<MissionApi>('missions');
  const nav = () => engine.get<NavApi>('nav');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const story = (s: string | null) => { const m = missions(); if (m) m.story = s; };
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const flash = (s: string, colour = '#ffc21f') => { banner.show(s, colour); setTimeout(() => banner.hide(), 1300); };

  /** Nothing else going on: the player drives, free. */
  const free = () => {
    const v = vehicle(), m = missions(), intro = engine.get<IntroApi>('intro')?.step;
    return pl.mode === 'driving' && v.occupied && v.inputEnabled && !v.autopilot
      && (engine.get<WantedApi>('wanted')?.level ?? 0) === 0 && !engine.get<RaceApi>('races')?.active
      && !m?.busy && !m?.story && !engine.get<GarageApi>('garage')?.open && (intro === undefined || intro === 'off' || intro === 'done');
  };

  const end = (msg: string | null, pay = 0) => {
    if (msg) toast(msg);
    if (pay) missions()?.addCash(pay);
    if (runner) { runner.release(); runner = null; }
    if (rivalOn) { rivalOn = false; rival.car.body.setTranslation({ x: 0, y: -700, z: 0 }, false); rival.car.body.setEnabled(false); kit.commit(0); }
    racing = false; finish = null; active = null;
    story(null);
    nav()?.clearTarget('mission');
    marker.hide();
    wait = GAP[0] + rnd() * (GAP[1] - GAP[0]);
  };

  const startFugitive = (): boolean => {
    const c = vehicle().car;
    runner = tr.spawnRunner(c.pos.x, c.pos.z, c.fwd.x, c.fwd.z);
    if (!runner) return false;
    active = 'fugitive'; clock = 0; hits = 0; stillT = 0;
    flash(t('event.bountyBanner'), '#ff4d4d');
    toast(t('event.bounty', { n: BOUNTY }));
    return true;
  };

  /** A red saloon behind the player, matching their speed, racing them to an address ahead. */
  const startChallenge = (): boolean => {
    const v = vehicle(), c = v.car, g = tr.graph, n = nav();
    if (!n || c.speed < 3) return false;
    const heading = Math.atan2(c.fwd.x, c.fwd.z);
    const dest = pickAddress(g, n, rnd, c.pos.x, c.pos.z, SPRINT[0], SPRINT[1]);
    if (!dest) return false;
    // Behind, in the player's own lane (to the left could be the oncoming lanes of a two-way
    // road); it pulls out and alongside soon enough.
    const spot = new THREE.Vector3().copy(c.pos).addScaledVector(c.fwd, -11);
    if (tr.nearestCar(spot.x, spot.z, 4)) spot.copy(c.pos).addScaledVector(c.fwd, -19);
    if (tr.nearestCar(spot.x, spot.z, 4)) return false;
    const route = n.route(spot.x, spot.z, heading, dest.x, dest.z);
    if (!route) return false;
    const r = rival;
    r.car.body.setEnabled(true);
    r.car.reset({ x: spot.x, y: 0.03 + RIVAL.wheelRadius + 0.08, z: spot.z }, heading);
    r.car.setMoving(Math.max(4, c.forwardSpeed));
    r.driver.reset(); r.filter.reset();
    r.path = route.pts; r.len = route.len;
    r.prevPos.copy(r.car.pos); r.curPos.copy(r.car.pos); r.prevQuat.copy(r.car.quat); r.curQuat.copy(r.car.quat);
    rivalOn = true; racing = true;
    finish = dest;
    active = 'challenge'; clock = 0;
    engine.events.emit('traffic:horn', { x: spot.x, z: spot.z });
    flash(t('event.raceBanner'));
    toast(t('event.race', { place: dest.label, n: RACE_PRIZE }));
    n.setTarget({ x: dest.x, z: dest.z, kind: 'mission', label: t('event.finish') });
    marker.show(dest.x, dest.z, '#ffc21f');
    return true;
  };

  const startUrgent = (): boolean => {
    if (!missions()?.urgentFare?.()) return false;
    flash(t('event.urgentBanner'), '#ff2d55');
    wait = GAP[0] + rnd() * (GAP[1] - GAP[0]);
    return true;
  };

  const start = (kind: Kind): boolean => kind === 'fugitive' ? startFugitive() : kind === 'challenge' ? startChallenge() : startUrgent();

  engine.events.on('vehicle:impact', ({ strength }) => {
    if (active !== 'fugitive' || !runner || strength < 2.5 || hitCd > 0) return;
    const c = vehicle().car;
    if (Math.hypot(runner.car.pos.x - c.pos.x, runner.car.pos.z - c.pos.z) > 6.5) return;
    hits++; hitCd = 0.8;
    if (hits < RAMS) toast(t('event.hit', { n: hits, of: RAMS }));
  });
  engine.events.on('vehicle:reset', () => { if (active && active !== 'urgent') end(null); });
  engine.events.on('wanted:busted', () => { if (active && active !== 'urgent') end(null); });

  const blips: Blip[] = [];
  let blipsOn = false;
  const api: EventsApi = {
    name: 'events',
    get active() { return active; },
    debug: {
      start: (kind) => start(kind),
      wait: () => wait,
      state: () => {
        const c = vehicle().car;
        return { kind: active, hits, left: FUGITIVE_TIME - clock,
          rivalLeft: finish ? Math.hypot(rival.car.pos.x - finish.x, rival.car.pos.z - finish.z) : -1,
          playerLeft: finish ? Math.hypot(c.pos.x - finish.x, c.pos.z - finish.z) : -1,
          runner: runner ? { x: runner.car.pos.x, z: runner.car.pos.z, yaw: Math.atan2(runner.car.fwd.x, runner.car.fwd.z), speed: runner.car.speed } : null };
      },
    },
    fixedUpdate(dt) {
      hitCd -= dt;
      const v = vehicle(), c = v.car;
      if (!active) {
        if (!free()) return;
        wait -= dt;
        if (wait > 0) return;
        // A taxi looking for fares gets the rush fare more often; otherwise a chase or a race.
        const choices: Kind[] = v.look.taxi ? ['urgent', 'urgent', 'fugitive', 'challenge'] : ['fugitive', 'challenge'];
        const first = choices[Math.floor(rnd() * choices.length)];
        if (!start(first) && !start(first === 'fugitive' ? 'challenge' : 'fugitive')) wait = 8;
        return;
      }
      if (active === 'urgent') { active = null; return; }
      clock += dt;
      if (pl.mode !== 'driving' && clock > 3) { end(t('event.abandon')); return; }
      if (active === 'fugitive' && runner) {
        const rc = runner.car, d = Math.hypot(rc.pos.x - c.pos.x, rc.pos.z - c.pos.z);
        // Boxed in: stopped with the player right there.
        stillT = rc.speed < 1.5 && d < 9 ? stillT + dt : 0;
        if (hits >= RAMS || stillT > 1.5) { end(t('event.caught', { n: BOUNTY }), BOUNTY); return; }
        if (clock > FUGITIVE_TIME || d > 450) { end(t('event.escaped')); return; }
        story(t('event.bountyLine', { time: fmt(FUGITIVE_TIME - clock), hits, of: RAMS }));
      }
      if (active === 'challenge' && finish) {
        const r = rival, rc = r.car;
        const me = Math.hypot(c.pos.x - finish.x, c.pos.z - finish.z), it = Math.hypot(rc.pos.x - finish.x, rc.pos.z - finish.z);
        if (me < 20) { end(t('event.won', { n: RACE_PRIZE }), RACE_PRIZE); return; }
        if (it < 20) { end(t('event.lost')); return; }
        if (clock > 150 || me > SPRINT[1] + 700) { end(t('event.abandon')); return; }
        // Rubber band: faster when behind the player, easing off when well ahead.
        r.driver.topSpeed = Math.max(20, Math.min(36, 29 + (it - me) * 0.03));
        r.prevPos.copy(r.curPos); r.prevQuat.copy(r.curQuat);
        // A real router, not the start's path: Pursuit re-plans every 1.5 s from where it is and walks
        // the new path from its start, so a fixed path sent it back to where the race began, in circles.
        const n = nav();
        const inp = r.driver.update(rc, { x: finish.x, z: finish.z, vx: 0, vz: 0 }, false, dt, n ? (a, b, c, d, e) => n.route(a, b, c, d, e) : null, false);
        rc.step(r.filter.update(inp, rc.forwardSpeed, dt), dt);
        story(t('event.raceLine', { place: finish.label, gap: Math.round(me - it) > 0 ? t('event.behind', { m: Math.round(me - it) }) : t('event.ahead', { m: Math.round(it - me) }) }));
      }
    },
    postStep(dt) {
      if (!rivalOn) return;
      rival.car.afterStep(dt);
      rival.curPos.copy(rival.car.pos); rival.curQuat.copy(rival.car.quat);
    },
    update(dt, alpha) {
      marker.update(dt);
      if (rivalOn) {
        const p = new THREE.Vector3().lerpVectors(rival.prevPos, rival.curPos, alpha), q = new THREE.Quaternion().slerpQuaternions(rival.prevQuat, rival.curQuat, alpha);
        kit.set(0, p, q, rival.car, RED, BLACK, false);
        kit.commit(1);
      }
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => {
          blips.length = 0;
          if (active === 'fugitive' && runner) blips.push({ kind: 'car', x: runner.car.pos.x, z: runner.car.pos.z, heading: Math.atan2(runner.car.fwd.x, runner.car.fwd.z), flash: true });
          if (active === 'challenge' && rivalOn) blips.push({ kind: 'car', x: rival.car.pos.x, z: rival.car.pos.z, heading: Math.atan2(rival.car.fwd.x, rival.car.fwd.z) });
          return blips;
        });
      }
    },
  };
  engine.add(api);
}
