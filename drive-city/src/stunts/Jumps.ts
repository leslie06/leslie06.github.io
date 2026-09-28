import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { t } from '../core/I18n';
import { shotMode } from '../debug/ShotMode';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, VehicleApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { JUMPS, OVERPASSES } from './spots';
import { OVERPASS } from './Structures';
import { propGeometry, propMaterials, propMeshes } from './Props';

/** Ramp: run along its heading, height at the lip, width. 12.5 degrees. */
export const RAMP = { len: 9, h: 2, w: 5 };
/** First clean flight off each ramp pays this, once. */
export const JUMP_PRIZE = 250;
/** An overpass flight (over a whole road) pays this the first time. */
export const OVERPASS_PRIZE = 500;
/** A flight shorter than this from the lip was a hop, not a jump. */
const MIN_FLIGHT = 10;
/** The world runs this slow while a launched car is in the air. */
const SLOW = 0.45;
const KEY = 'drivecity.jumps.v1';
/** Stunt structures further than this (m, on either axis) from the camera are not drawn. */
const STUNT_DRAW = 600;

export interface JumpApi extends System {
  readonly done: number;
  readonly total: number;
  /** In flight off a ramp right now. */
  readonly flying: boolean;
  debug: { ramps(): { x: number; z: number; yaw: number }[]; overpasses(): { x: number; z: number; yaw: number; gap: number }[]; last(): { ramp: number; dist: number } | null };
}

/**
 * Stunt ramps (GTA's unique stunt jumps): steel wedges on the open ground of the core, placed from
 * the tiles by Spots.gen.test.ts with a clear run-up and landing. Drive off one fast enough to fly
 * MIN_FLIGHT metres and it counts - the flight is in slow motion, the distance is called out, and
 * the first time for each ramp pays JUMP_PRIZE (saved, `drivecity.jumps.v1`). Undone ramps are on
 * the radar and the map. The air itself scores in the street combo like any other jump.
 */
export function installJumps(engine: Engine): void {
  const pl = engine.get<PlayerApi>('player');
  if (!pl) return;
  let done = new Set<number>();
  try { done = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[]); } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch { /* ignore */ } };

  // --- the ramps: Blender's model per ramp (stunts/Props.ts), one fixed body with a hull per ramp -----------
  const env = engine.get<RenderSystem>('render')?.uniforms;
  const mats = propMaterials(env, 'ramps', 0.2, 1.5);
  const stunts = new THREE.Group();
  stunts.name = 'stunt-ramps';
  /**
   * One group per structure, frustum culled and shown within STUNT_DRAW of the camera: merged into one mesh for the city,
   * the ten ramps, three overpasses and their mounds were drawn from anywhere (34k triangles in a low-tier frame).
   */
  const sites: { g: THREE.Group; x: number; z: number }[] = [];
  const place = (name: string, m: THREE.Matrix4) => {
    const g = propGeometry(name), site = new THREE.Group();
    for (const mesh of propMeshes('stunt-ramps', g.matte ? [g.matte.applyMatrix4(m)] : [], g.metal ? [g.metal.applyMatrix4(m)] : [], mats)) {
      mesh.geometry.computeBoundingSphere();
      site.add(mesh);
    }
    const c = new THREE.Vector3().setFromMatrixPosition(m);
    stunts.add(site);
    sites.push({ g: site, x: c.x, z: c.z });
  };
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const j of JUMPS) {
    m.compose(new THREE.Vector3(j.x, 0.03, j.z), q.setFromAxisAngle(up, j.yaw), new THREE.Vector3(1, 1, 1));
    place('ramp', m);
    // The wedge as a hull: foot edge on the ground, lip edge up, back edge on the ground under the lip.
    const pts: number[] = [];
    const c = Math.cos(j.yaw), s = Math.sin(j.yaw);
    const put = (lx: number, y: number, lz: number) => pts.push(j.x + lx * c + lz * s, y + 0.03, j.z - lx * s + lz * c);
    for (const lx of [-RAMP.w / 2, RAMP.w / 2]) { put(lx, 0, 0); put(lx, RAMP.h, RAMP.len); put(lx, 0, RAMP.len); }
    const desc = R.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) {
      const col = world.createCollider(desc.setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.9), body);
      engine.physics.tag(col, { surface: 'metal', tag: 'ramp' });
    }
  }

  // --- overpasses: 烂尾高架, an unfinished flyover stopping at a road's edge ------------------------------
  const O = OVERPASS, lipAt = O.ramp + O.deck;
  for (const o of OVERPASSES) {
    m.compose(new THREE.Vector3(o.x, 0.03, o.z), q.setFromAxisAngle(up, o.yaw), new THREE.Vector3(1, 1, 1));
    place('overpass', m);
    place('mound', m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, lipAt + o.gap)));
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    const W = (lx: number, y: number, lz: number) => [o.x + lx * c + lz * s, y + 0.03, o.z - lx * s + lz * c];
    const hull = (pts: number[][], tag: string) => {
      const d = R.ColliderDesc.convexHull(new Float32Array(pts.flat()));
      if (d) engine.physics.tag(world.createCollider(d.setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.9), body), { surface: 'concrete', tag });
    };
    const box = (hx: number, hy: number, hz: number, lx: number, ly: number, lz: number) => {
      const [x, y, z] = W(lx, ly, lz);
      const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(o.yaw / 2), z: 0, w: Math.cos(o.yaw / 2) });
      engine.physics.tag(world.createCollider(d.setCollisionGroups(groups(CG.WORLD, CG.ALL)), body), { surface: 'concrete', tag: 'overpass' });
    };
    const hw = O.w / 2;
    hull([W(-hw, 0, 0), W(hw, 0, 0), W(-hw, O.h, O.ramp), W(hw, O.h, O.ramp), W(-hw, 0, O.ramp), W(hw, 0, O.ramp)], 'overpass');
    box(hw, 0.6, O.deck / 2, 0, O.h - 0.6, O.ramp + O.deck / 2);
    for (const sx of [-1, 1]) {
      box(0.17, 0.4, O.deck / 2, sx * (hw - 0.17), O.h + 0.4, O.ramp + O.deck / 2);
      for (const pz of [O.ramp + 3, lipAt - 2.5]) box(0.55, (O.h - 1.2) / 2, 0.55, sx * (hw - 1.2), (O.h - 1.2) / 2, pz);
    }
    const L0 = lipAt + o.gap, w2 = hw + 1;
    const a = L0 + O.front, b = a + O.top;
    hull([W(-w2, 0, L0), W(w2, 0, L0), W(-w2, O.landH, a), W(w2, O.landH, a), W(-w2, O.landH, b), W(w2, O.landH, b), W(-w2, 0, b + O.land), W(w2, 0, b + O.land)], 'mound');
  }

  engine.scene.add(stunts);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(stunts));

  /** Where a flight starts: the launch zone along the heading, how wide, how high off the ground at least, the lip. */
  interface Launcher { id: number; x: number; z: number; yaw: number; from: number; to: number; w: number; minY: number; lip: number; prize: number; over: boolean }
  const launchers: Launcher[] = [
    ...JUMPS.map((j, i) => ({ id: i, x: j.x, z: j.z, yaw: j.yaw, from: -1, to: RAMP.len + 1.5, w: RAMP.w, minY: -9, lip: RAMP.len, prize: JUMP_PRIZE, over: false })),
    ...OVERPASSES.map((o, i) => ({ id: 100 + i, x: o.x, z: o.z, yaw: o.yaw, from: O.ramp - 2, to: lipAt + 1.5, w: O.w, minY: O.h - 1.5, lip: lipAt, prize: OVERPASS_PRIZE, over: true })),
  ];

  // --- flights ---------------------------------------------------------------------------------------
  let onRamp = -1, onRampT = -9, clock = 0, flight: { ramp: number; x: number; z: number; l: Launcher } | null = null, last: { ramp: number; dist: number } | null = null;
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const land = () => {
    const v = vehicle(), car = v.car, f = flight!;
    flight = null;
    v.slowMo = 1;
    const dist = Math.hypot(car.pos.x - f.x, car.pos.z - f.z);
    if (dist < MIN_FLIGHT) return;
    last = { ramp: f.ramp, dist };
    if (!done.has(f.ramp)) {
      done.add(f.ramp); save();
      engine.get<MissionApi>('missions')?.addCash(f.l.prize);
      toast(t(f.l.over ? 'jump.firstOver' : 'jump.first', { m: Math.round(dist), n: f.l.prize, i: done.size, of: launchers.length }));
    } else toast(t(f.l.over ? 'jump.againOver' : 'jump.again', { m: Math.round(dist) }));
  };
  engine.events.on('vehicle:reset', () => { if (flight) { flight = null; vehicle().slowMo = 1; } });

  const blips: Blip[] = [];
  let blipsOn = false;
  const api: JumpApi = {
    name: 'jumps',
    get done() { return done.size; },
    total: JUMPS.length + OVERPASSES.length,
    get flying() { return !!flight; },
    debug: { ramps: () => JUMPS, overpasses: () => OVERPASSES, last: () => last },
    fixedUpdate(dt) {
      clock += dt;
      const v = vehicle(), car = v.car;
      if (pl.mode !== 'driving' || !v.occupied) { if (flight) { flight = null; v.slowMo = 1; } return; }
      if (flight) {
        if (car.grounded >= 2 || car.pos.y < -2) land();
        return;
      }
      // On a ramp, going up it: remember which and when.
      for (let i = 0; i < launchers.length; i++) {
        const j = launchers[i], dx = car.pos.x - j.x, dz = car.pos.z - j.z;
        if (Math.abs(dx) > 80 || Math.abs(dz) > 80) continue;
        const s = Math.sin(j.yaw), c = Math.cos(j.yaw);
        const along = dx * s + dz * c, across = dx * c - dz * s;
        if (along > j.from && along < j.to && Math.abs(across) < j.w / 2 + 0.6 && car.pos.y > j.minY && car.vel.x * s + car.vel.z * c > 9) { onRamp = i; onRampT = clock; }
      }
      // Off the lip and airborne: a flight.
      if (onRamp >= 0 && car.grounded === 0 && clock - onRampT < 0.35) {
        const j = launchers[onRamp];
        flight = { ramp: j.id, x: j.x + Math.sin(j.yaw) * j.lip, z: j.z + Math.cos(j.yaw) * j.lip, l: j };
        onRamp = -1;
        if (!shotMode) v.slowMo = SLOW;
      }
    },
    update() {
      const cam = engine.camera.position;
      for (const s of sites) s.g.visible = Math.abs(s.x - cam.x) < STUNT_DRAW && Math.abs(s.z - cam.z) < STUNT_DRAW;
      const n = engine.get<NavApi>('nav');
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => { blips.length = 0; for (const j of launchers) if (!done.has(j.id)) blips.push({ kind: 'jump', x: j.x + Math.sin(j.yaw) * j.lip, z: j.z + Math.cos(j.yaw) * j.lip }); return blips; });
      }
    },
  };
  engine.add(api);
}
