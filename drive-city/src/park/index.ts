import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { project } from '../city/Geo';
import type { CameraApi, HudApi, ParkApi, PlayerApi } from '../game/Contracts';
import { Marker } from '../missions/Marker';
import type { RenderSystem } from '../render/RenderSystem';
import { ANCHOR, PENDULUM, RIDES, SHIP, type RideSpec } from './Layout';
import { advanceTrain, buildMovers, frameAt, makeFrame } from './Rides';

/**
 * 北京欢乐谷: the rides run, and the player can get on them.
 *
 * Boarding reuses what is already there - walk up on foot, the corona marks the gate, F gets you in
 * as it does with a car. A ride is kinematic: the train is driven along the spline by gravity
 * (`v' = -g sin θ - drag`, the chain lift and brake run override it), the frisbee and the ship are
 * pendulums whose amplitude builds up and dies away. While riding, the camera is handed to the ride
 * (`CameraApi.override`) and the player's character is parked in the seat (`PlayerApi.setRiding`),
 * so physics is off but streaming, shadows and the HUD still follow the rider.
 *
 * State lives in `fixedUpdate` as scalars (metres along the track, swing angle); `update` poses the
 * meshes and the camera from them, interpolated with `alpha`, per the engine's convention.
 */

const BOARD_REACH = 4.0;

type Stage = 'idle' | 'running';

interface Ride {
  spec: RideSpec;
  stage: Stage;
  /** Seconds since the ride started. */
  t: number;
  /** Ends the ride early (the player pressed F), and when that was asked for. */
  ending: boolean; endT: number;
  /** Coaster: metres along the track, previous and current step. */
  prevS: number; curS: number;
  /** Pendulum/ship: swing angle, and the frisbee's spin. */
  prevAng: number; curAng: number;
  prevSpin: number; curSpin: number;
  marker: Marker;
  /** Where the player stands to board, and where they are put down afterwards (world metres). */
  board: THREE.Vector3;
  /** The node the camera and the rider sit on. */
  seat: THREE.Object3D;
}

/** The park with the handle poses and probes drive it by (see races/ for the same pattern). */
export interface ParkSystem extends ParkApi {
  debug: { start(id: string): boolean; seek(s: number): void; state(): { riding: string | null; s: number; stage: Stage } };
}

export async function install(engine: Engine): Promise<void> {
  const player = engine.get<PlayerApi>('player');
  if (!player) return;
  const env = engine.get<RenderSystem & { uniforms: import('../game/Contracts').EnvUniforms }>('render')?.uniforms
    ?? { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };

  // The movers sit in the same frame as the landmark: park-local metres at the park's anchor.
  const [ax, az] = project(ANCHOR.lat, ANCHOR.lon);
  const root = new THREE.Group();
  root.name = 'park';
  root.position.set(ax, 0, az);
  root.rotation.y = -ANCHOR.headingDeg * Math.PI / 180;
  engine.scene.add(root);

  const movers = buildMovers(env);
  root.add(movers.train, movers.disc, movers.boat);

  const [coasterSpec, fireSpec, shipSpec] = RIDES;
  movers.disc.position.set(fireSpec.x, PENDULUM.pivotY, fireSpec.z);
  movers.boat.position.set(shipSpec.x, SHIP.pivotY, shipSpec.z);
  movers.boat.rotation.y = shipSpec.yaw;

  /** A camera seat: its -Z is the view direction, so the camera can take its world pose directly. */
  const seatNode = (parent: THREE.Object3D, x: number, y: number, z: number, ry: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.rotation.y = ry;
    parent.add(o);
    return o;
  };
  // The coaster's front car. The camera goes at the nose, ahead of the seat boxes - between them it
  // was 27 cm from each and the view was two black walls - and pitches down, the way a flying
  // coaster hangs its riders face to the ground.
  const leadCar = movers.train.children[0];
  const coasterSeat = seatNode(leadCar, 0, -0.5, 3.1, Math.PI);
  coasterSeat.rotation.order = 'YXZ';
  coasterSeat.rotation.x = -0.3;
  const discG = movers.disc.getObjectByName('disc')!;
  const fireSeat = seatNode(discG, PENDULUM.discR + 0.55, 0.3, 0, -Math.PI / 2);
  const hullG = movers.boat.getObjectByName('hull')!;
  const shipSeat = seatNode(hullG, 6.3, 1.5, 0, Math.PI / 2);
  const seats = [coasterSeat, fireSeat, shipSeat];

  /** The coaster train: metres along the track and its speed, stepped by Rides.advanceTrain. */
  const train = { s: 0, v: 0 };

  const rides: Ride[] = RIDES.map((spec, i) => {
    const b = new THREE.Vector3(spec.x + spec.board[0], 0, spec.z + spec.board[1]);
    b.applyEuler(root.rotation).add(root.position);
    return {
      spec, stage: 'idle', t: 0, ending: false, endT: 0,
      prevS: 0, curS: 0, prevAng: 0, curAng: 0, prevSpin: 0, curSpin: 0,
      marker: new Marker(engine.scene), board: b, seat: seats[i],
    };
  });
  for (const r of rides) r.marker.show(r.board.x, r.board.z, '#ffc21f');

  const frame = makeFrame();
  const basis = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  const seatPos = new THREE.Vector3();
  const seatQuat = new THREE.Quaternion();
  const riderSeat = { pos: new THREE.Vector3(), yaw: 0 };
  let riding: Ride | null = null;
  let prompt: 'board' | 'exit' | null = null;

  const cam = () => engine.get<CameraApi>('camera');
  const hud = () => engine.get<HudApi>('hud');
  const nameOf = (r: Ride) => (lang() === 'zh' ? r.spec.name.zh : r.spec.name.en);

  /** Amplitude envelope of a swinging ride: builds up, holds, dies away (0..1). */
  const envelope = (r: Ride): number => {
    const build = r.spec.kind === 'pendulum' ? PENDULUM.buildUp : SHIP.buildUp;
    const up = Math.min(1, r.t / build);
    const left = r.ending ? Math.max(0, 1 - (r.t - r.endT) / (build * 0.7)) : Math.min(1, (r.spec.duration - r.t) / (build * 0.7));
    const e = Math.max(0, Math.min(up, left));
    return e * e * (3 - 2 * e);
  };

  const start = (r: Ride) => {
    r.stage = 'running'; r.t = 0; r.ending = false; r.endT = 0;
    if (r.spec.kind === 'coaster') { r.curS = r.prevS = 0; train.s = 0; train.v = 2.4; }
    else { r.curAng = r.prevAng = 0; r.curSpin = r.prevSpin = 0; }
  };

  /**
   * Anything that resets the car takes the player out of the seat (a respawn, a shot pose). Let go
   * of the ride rather than leaving the camera bolted to a train nobody is on. Called from update
   * and before boarding, because a pose can do both inside one fixed step.
   */
  const releaseIfEmpty = () => {
    if (!riding || player.riding) return;
    const r = riding;
    riding = null; r.stage = 'idle'; r.ending = false;
    const c = cam();
    if (c) { c.override = null; c.snap(); }
  };

  const board = (r: Ride) => {
    start(r);
    riding = r;
    player.setRiding(riderSeat);
    const c = cam();
    if (c) c.override = (camera) => {
      camera.position.copy(seatPos);
      camera.quaternion.copy(seatQuat);
      camera.fov = 72;
      camera.updateProjectionMatrix();
    };
    hud()?.toast(t('park.board', { name: nameOf(r) }));
  };

  const land = (r: Ride) => {
    riding = null;
    const c = cam();
    if (c) { c.override = null; c.snap(); }
    player.setRiding(null, { x: r.board.x, y: 1.2, z: r.board.z, yaw: r.spec.yaw + Math.PI });
    hud()?.toast(t('park.done', { name: nameOf(r) }));
  };

  const api: ParkSystem = {
    name: 'park',
    get prompt() { return prompt; },
    get riding() { return riding?.spec.id ?? null; },
    debug: {
      start(id) {
        releaseIfEmpty();
        const r = rides.find((v) => v.spec.id === id);
        if (!r || riding) return false;
        board(r);
        return true;
      },
      seek(s) { const r = rides[0]; train.s = s; r.curS = s; r.prevS = s; },
      state() { return { riding: riding?.spec.id ?? null, s: rides[0].curS, stage: rides[0].stage }; },
    },

    fixedUpdate(dt) {
      for (const r of rides) {
        r.prevS = r.curS; r.prevAng = r.curAng; r.prevSpin = r.curSpin;
        if (r.stage !== 'running') continue;
        r.t += dt;
        if (r.spec.kind === 'coaster') {
          const done = advanceTrain(train, dt, r.ending);
          r.curS = train.s;
          if (done) { r.stage = 'idle'; if (riding === r) land(r); }
        } else {
          const spec = r.spec.kind === 'pendulum' ? PENDULUM : SHIP;
          const w = Math.sqrt(9.81 / spec.armLen);
          r.curAng = spec.maxSwing * envelope(r) * Math.sin(w * r.t);
          if (r.spec.kind === 'pendulum') r.curSpin += PENDULUM.spin * envelope(r) * dt;
          const over = r.ending ? r.t - r.endT > (PENDULUM.buildUp * 0.7) : r.t >= r.spec.duration;
          if (over && Math.abs(r.curAng) < 0.05) { r.stage = 'idle'; r.curAng = 0; if (riding === r) land(r); }
        }
      }
      // The rider's seat, at the fixed rate: the player's position feeds streaming and shadows.
      if (riding) {
        riding.seat.updateWorldMatrix(true, false);
        riderSeat.pos.setFromMatrixPosition(riding.seat.matrixWorld);
        riderSeat.yaw = Math.atan2(
          riding.seat.matrixWorld.elements[8], riding.seat.matrixWorld.elements[10]);
      }
    },

    update(dt, alpha) {
      for (const r of rides) r.marker.update(dt);
      releaseIfEmpty();
      // Pose the movers from the interpolated state.
      const coaster = rides[0];
      const s = coaster.prevS + (coaster.curS - coaster.prevS) * alpha;
      for (let i = 0; i < movers.train.children.length; i++) {
        const car = movers.train.children[i];
        frameAt(s + movers.carOffsets[i], frame);
        car.position.copy(frame.pos).addScaledVector(frame.up, 0.55);
        basis.makeBasis(frame.side, frame.up, frame.tan);
        car.quaternion.setFromRotationMatrix(basis);
      }
      const fire = rides[1];
      movers.disc.rotation.x = fire.prevAng + (fire.curAng - fire.prevAng) * alpha;
      discG.rotation.y = fire.prevSpin + (fire.curSpin - fire.prevSpin) * alpha;
      const ship = rides[2];
      movers.boat.rotation.x = ship.prevAng + (ship.curAng - ship.prevAng) * alpha;

      // The camera seat, interpolated with the meshes it is attached to.
      if (riding) {
        riding.seat.updateWorldMatrix(true, false);
        seatPos.setFromMatrixPosition(riding.seat.matrixWorld);
        seatQuat.setFromRotationMatrix(riding.seat.matrixWorld);
      }

      // Boarding: on foot, near an idle ride's gate.
      const inp = engine.input.state;
      prompt = null;
      if (riding) {
        prompt = 'exit';
        if (inp.enterPressed && !riding.ending) { riding.ending = true; riding.endT = riding.t; }
      } else if (player.mode === 'onfoot' && !player.riding) {
        let near: Ride | null = null;
        for (const r of rides) {
          tmp.copy(player.position).sub(r.board);
          if (Math.abs(tmp.y) < 4 && Math.hypot(tmp.x, tmp.z) < BOARD_REACH) { near = r; break; }
        }
        if (near) {
          if (near.stage === 'idle') {
            prompt = 'board';
            if (inp.enterPressed) board(near);
          } else if (inp.enterPressed) hud()?.toast(t('park.closed', { name: nameOf(near) }));
        }
      }
    },
  };
  engine.add(api);
  // Streamed-in geometry has to be patched for night, wet and shadows like a city tile.
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(root));
}
