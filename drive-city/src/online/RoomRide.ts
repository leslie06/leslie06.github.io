import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { CameraApi, HudApi, PlayerApi } from '../game/Contracts';
import type { MultiplayerApi } from './Multiplayer';

/**
 * 搭车 (2026-11-01, the room's 6th idea: 「朋友也能上自己的车」): on foot by a friend's car, F rides along in its passenger
 * seat - the character put in the seat and not drawn (`PlayerApi.setRiding`), the camera behind the friend's car,
 * the streaming following the seat. Our state says whose car we sit in (`rd`), so the others draw nobody standing in
 * it; the driver is told. F gets out on the kerb side; so does the friend leaving the room or getting out. Your own
 * car waits where you left it.
 */
export interface RideApi extends System {
  /** The friend whose car we sit in, or null. */
  readonly with: number | null;
  /** Get in this friend's car (probes, and F by it): what is wrong, or null. */
  board(id: number): string | null;
  /** Get out. */
  stop(): void;
}

/** F reaches a friend's car this far from its middle. */
const REACH = 4.2;
/** The passenger seat in the car's frame (left-hand drive: the driver sits on +X). */
const SEAT = new THREE.Vector3(-0.42, 0.55, 0.05);
/** The camera behind and over the car, eased towards it. */
const BACK = 7.5, UP = 2.8, LOOK_UP = 1.2, EASE = 6;

export function install(engine: Engine): RideApi | null {
  const mp = engine.get<MultiplayerApi>('mp');
  const pl = engine.get<PlayerApi>('player');
  if (!mp || !pl) return null;
  const toast = (s: string, secs = 3) => engine.get<HudApi>('hud')?.toast(s, secs);
  const cam = () => engine.get<CameraApi>('camera');
  const nameOf = (id: number) => mp.peers.find((p) => p.id === id)?.name ?? '?';
  const seat = { pos: new THREE.Vector3(), yaw: 0 };
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();
  let withId: number | null = null, camReady = false, boardedAt = 0;

  /** The seat where the friend's car is drawn; false if it is not. */
  const place = (): boolean => {
    if (withId === null) return false;
    const c = mp.carPose(withId);
    if (!c) return false;
    seat.pos.copy(SEAT).applyQuaternion(c.quat).add(c.pos);
    fwd.set(0, 0, 1).applyQuaternion(c.quat);
    seat.yaw = Math.atan2(fwd.x, fwd.z);
    return true;
  };

  const leave = (msg?: string) => {
    if (withId === null) return;
    const id = withId;
    withId = null; mp.aboard = null;
    const c = cam();
    if (c) c.override = null;
    // out on the passenger's side, on the ground beside the car
    const car = mp.carPose(id);
    if (pl.riding) {
      if (car) {
        side.set(-2.3, 0, 0).applyQuaternion(car.quat);
        pl.setRiding(null, { x: car.pos.x + side.x, y: car.pos.y + 0.6, z: car.pos.z + side.z, yaw: seat.yaw });
      } else pl.setRiding(null, { x: seat.pos.x, y: seat.pos.y + 0.6, z: seat.pos.z, yaw: seat.yaw });
    }
    c?.snap();
    mp.send('ride', { op: 'out', to: id });
    if (msg) toast(msg);
  };

  const api: RideApi = {
    name: 'ride',
    get with() { return withId; },
    board(id) {
      const p = mp.peers.find((q) => q.id === id);
      if (!p || p.foot || p.dist < 0) return t('ride.noCar');
      if (pl.mode !== 'onfoot' || pl.riding) return t('ride.onFoot');
      if (engine.get<{ name: string; active: boolean }>('play')?.active) return t('play.already');
      withId = id;
      if (!place()) { withId = null; return t('ride.noCar'); }
      mp.aboard = id;
      pl.setRiding(seat);
      // the F that got us in is still down this frame
      boardedAt = performance.now();
      camReady = false;
      const c = cam();
      if (c) c.override = (camera, dt) => {
        const car = withId !== null ? mp.carPose(withId) : null;
        if (!car) return;
        fwd.set(0, 0, 1).applyQuaternion(car.quat); fwd.y = 0; fwd.normalize();
        look.copy(car.pos); look.y += LOOK_UP;
        const want = side.copy(car.pos).addScaledVector(fwd, -BACK); want.y += UP;
        if (!camReady) { camPos.copy(want); camReady = true; } else camPos.lerp(want, 1 - Math.exp(-dt * EASE));
        camera.position.copy(camPos);
        camera.lookAt(look);
        if (camera.fov !== 62) { camera.fov = 62; camera.updateProjectionMatrix(); }
      };
      mp.send('ride', { op: 'in', to: id });
      toast(t('ride.in', { name: p.name }), 4);
      return null;
    },
    stop() { leave(); },
    fixedUpdate() {
      if (withId !== null) place();
    },
    update() {
      // a friend's car in reach, on foot: F rides along
      if (withId === null) {
        if (mp.status !== 'in' || pl.mode !== 'onfoot' || pl.riding || engine.get<{ name: string; active: boolean }>('play')?.active) return;
        const me = pl.position;
        let best: number | null = null, bd = REACH;
        for (const p of mp.peers) {
          if (p.foot || p.dist < 0 || p.dist > 12) continue;
          const c = mp.carPose(p.id);
          if (!c) continue;
          const d = Math.hypot(c.pos.x - me.x, c.pos.z - me.z);
          if (d < bd) { bd = d; best = p.id; }
        }
        if (best !== null) {
          const c = mp.carPose(best)!, id = best;
          pl.offer?.({ x: c.pos.x, z: c.pos.z, r: REACH, label: t('ride.offer', { name: nameOf(id) }), use: () => { const e = api.board(id); if (e) toast(e); } });
        }
        return;
      }
      // riding: F gets out; so does losing the friend or their car
      const p = mp.peers.find((q) => q.id === withId);
      if (mp.status !== 'in' || !p) { leave(t('ride.lost')); return; }
      if (p.foot) { leave(t('ride.theyOut', { name: p.name })); return; }
      if (!pl.riding) { leave(); return; }   // a reset put us back in our own car
      place();
      const ui = engine.get<System & { state: string }>('ui')?.state;
      if (ui === 'playing' && engine.input.state.enterPressed && performance.now() - boardedAt > 400) leave();
    },
  };

  // the driver's side: who got in and out
  mp.onEvent((from, m) => {
    if (m.k !== 'ride' || m.to !== mp.me?.id) return;
    const name = nameOf(from);
    toast(t(m.op === 'in' ? 'ride.theyIn' : 'ride.theyLeft', { name }), 4);
  });
  mp.onGone((id) => { if (id === withId) leave(t('ride.lost')); });
  engine.add(api);
  return api;
}
