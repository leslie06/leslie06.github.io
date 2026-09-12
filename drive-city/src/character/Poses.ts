import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { CameraApi, HudApi, PlayerApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import type { TrafficApi } from '../traffic';
import { registerPose } from '../debug/PoseRegistry';
import { Gait, type Action } from './Animator';
import { randomLook, type Look } from './Body';

/**
 * Screenshot poses for the people themselves: a line-up of varied looks, face close-ups, the gait
 * from the side at walk/jog/sprint, the third-person view of a walker, the knock-down reactions,
 * and a crowd from 8 to 90 m (both LODs). Extra people are drawn through the player's crowd by a
 * small system that only runs while one of these poses is active.
 */
interface Extra { pos: THREE.Vector3; yaw: number; gait: Gait; look: Look; speed: number; action: Action; t: number; seed: number }
let extras: Extra[] = [];
let installed = false;

function install(e: Engine): void {
  if (installed) return;
  installed = true;
  const sys: System = {
    name: 'character-poses',
    update(dt) {
      if (!extras.length) return;
      const crowd = e.get<PlayerApi>('player')!.crowd;
      for (const x of extras) {
        x.t += dt;
        x.gait.update({ speed: x.speed, action: x.action, t: x.t }, dt, x.seed);
        crowd.add(x.pos, x.yaw, x.gait, x.look);
      }
    },
  };
  e.add(sys);
}

const C = (h: string) => new THREE.Color(h);
/** Hand-picked passers-by for the line-up and close-ups. */
const CAST: Look[] = [
  { skin: C('#e2bd98'), shirt: C('#f0efea'), pants: C('#2f3f5c'), shoes: C('#f2f2ef'), hair: C('#141212'), height: 1.76, top: 'tee', hairStyle: 'short', sole: C('#f3f2ee') },
  { skin: C('#efd2b4'), shirt: C('#b89a74'), inner: C('#f0ede6'), pants: C('#1b1c1f'), shoes: C('#1a1a1a'), hair: C('#1a1614'), fem: 1, height: 1.64, top: 'coat', hairStyle: 'long', fringe: true, build: -0.2 },
  { skin: C('#d8ae86'), shirt: C('#1f2a44'), inner: C('#8a8f96'), pants: C('#8f8166'), shoes: C('#3a2f28'), hair: C('#101010'), height: 1.8, top: 'jacket', hairStyle: 'buzz', glasses: true, build: 0.2 },
  { skin: C('#e9c9a8'), shirt: C('#d9a3aa'), inner: C('#f4f1ea'), pants: C('#3e5474'), shoes: C('#f2f2ef'), hair: C('#2a211b'), fem: 1, height: 1.58, top: 'tee', print: true, bottom: 'skirt', hem: 0.55, hairStyle: 'ponytail', cap: C('#f0efea'), sole: C('#f3f2ee') },
  { skin: C('#c99c74'), shirt: C('#8a8d91'), pants: C('#4a4a48'), shoes: C('#1a1a1a'), hair: C('#a9a6a1'), height: 1.7, top: 'shirt', sleeve: 0.36, hairStyle: 'short', build: 0.85, age: 0.85, beard: true },
  { skin: C('#f1d7bd'), shirt: C('#1c1c1e'), pants: C('#26324a'), shoes: C('#ecebe6'), hair: C('#0e0d0d'), fem: 0.95, height: 1.62, top: 'hoodie', bottom: 'shorts', hem: 0.27, hairStyle: 'bob', mask: C('#dfe8ef'), legwear: null, sole: C('#f3f2ee') },
  { skin: C('#dcb58e'), shirt: C('#1d1e21'), inner: C('#eceae4'), pants: C('#20263a'), shoes: C('#1a1a1a'), hair: C('#141212'), height: 1.88, top: 'coat', hairStyle: 'short', cap: C('#1c1c1e'), build: -0.3 },
  { skin: C('#e4c19c'), shirt: C('#f0ede6'), pants: C('#6b5a4a'), shoes: C('#5a4636'), hair: C('#211a16'), fem: 1, height: 1.56, top: 'shirt', bottom: 'skirt', hem: 0.95, print: true, hairStyle: 'bun', glasses: true, legwear: C('#15161a') },
  { skin: C('#bd8e66'), shirt: C('#56603f'), pants: C('#1b1c1f'), shoes: C('#9a2b2b'), hair: C('#1a1614'), height: 1.73, top: 'tee', hairStyle: 'short', bottom: 'shorts', hem: 0.3, sole: C('#f3f2ee'), build: -0.5 },
];

async function prepare(e: Engine) {
  const v = e.get<VehicleApi>('vehicle')!, cam = e.get<CameraApi>('camera')!, ui = e.get<UiApi>('ui')!, hud = e.get<HudApi>('hud')!, world = e.get<WorldApi>('world')!;
  install(e);
  extras = [];
  ui.state = 'playing';
  (document.querySelector('.menu') as HTMLElement).hidden = true;
  hud.setVisible(new URLSearchParams(location.search).has('hud'));
  v.autopilot = null; v.inputEnabled = false; cam.override = null;
  e.get<WantedApi>('wanted')?.clear();
  v.reset({ x: world.spawn.x, y: world.spawn.y, z: world.spawn.z }, world.spawn.yaw);
  await world.preload?.(world.spawn.x, world.spawn.z);
  return { v, cam, world };
}

/** A pavement spot near the spawn: point, direction along the street, and the side towards the buildings. */
function pavement(e: Engine, world: WorldApi): { x: number; z: number; dx: number; dz: number; ox: number; oz: number } {
  const tr = e.get<TrafficApi>('traffic');
  const out = { x: world.spawn.x, z: world.spawn.z, dx: Math.sin(world.spawn.yaw), dz: Math.cos(world.spawn.yaw), ox: Math.cos(world.spawn.yaw), oz: -Math.sin(world.spawn.yaw) };
  if (!tr) return out;
  const g = tr.graph, pt = { x: 0, z: 0, dx: 0, dz: 0 };
  let best = -1, bd = Infinity;
  for (const id of g.near(world.spawn.x, world.spawn.z, 500)) {
    const l = g.links[id];
    if (!['secondary', 'tertiary', 'primary'].includes(l.cls) || l.len < 60 || l.hw > 9) continue;
    g.at(l, l.len / 2, 0, pt);
    const d = Math.hypot(pt.x - world.spawn.x, pt.z - world.spawn.z);
    if (d < bd) { bd = d; best = id; }
  }
  if (best < 0) return out;
  const l = g.links[best];
  g.at(l, l.len / 2, -(l.hw + 2.2), pt);
  const len = Math.hypot(pt.dx, pt.dz) || 1;
  out.x = pt.x; out.z = pt.z; out.dx = pt.dx / len; out.dz = pt.dz / len;
  // -(hw) is to the right of the link; the buildings are further right.
  out.ox = out.dz; out.oz = -out.dx;
  return out;
}

function ground(e: Engine, x: number, z: number): number {
  const hit = e.physics.raycast({ x, y: 30, z }, { x: 0, y: -1, z: 0 }, 60, groups(CG.PED, CG.WORLD), true);
  return hit ? 30 - hit.distance : 0;
}

function person(e: Engine, x: number, z: number, yaw: number, look: Look, speed = 0, action: Action = 'move', t = 0, seed = Math.random()): Extra {
  return { pos: new THREE.Vector3(x, ground(e, x, z), z), yaw, gait: new Gait(), look, speed, action, t, seed };
}

/** Run the extras' animation for `seconds` without rendering (idle habits need a few seconds). */
function advance(seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) for (const x of extras) { x.t += 1 / 60; x.gait.update({ speed: x.speed, action: x.action, t: x.t }, 1 / 60, x.seed); }
}

function moveCarAway(e: Engine, v: VehicleApi, x: number, z: number): void {
  v.reset({ x, y: ground(e, x, z) + 1, z }, 0);
}

export function registerCharacterPoses(): void {
  registerPose({
    name: 'char_lineup', description: 'Nine passers-by in a line on the pavement, facing the camera (idle).',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 + p.dx * 40, p.z - p.oz * 12 + p.dz * 40);
      const face = Math.atan2(-p.ox, -p.oz);
      CAST.forEach((look, i) => {
        const a = (i - (CAST.length - 1) / 2) * 0.92;
        extras.push(person(e, p.x + p.dx * a, p.z + p.dz * a, face + (i % 3 - 1) * 0.12, look, 0, 'move', 0, 0.11 + i * 0.137));
      });
      advance(6);
      const gy = extras[4].pos.y;
      const eye = { x: p.x - p.ox * 5.6, z: p.z - p.oz * 5.6 };
      cam.override = (c) => { c.position.set(eye.x, gy + 1.35, eye.z); c.lookAt(p.x, gy + 0.95, p.z); c.fov = 50; c.updateProjectionMatrix(); };
      for (let i = 0; i < 20; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'char_faces', description: 'Head-and-shoulders close-up of three people at 1.3 m.',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 + p.dx * 40, p.z - p.oz * 12 + p.dz * 40);
      const face = Math.atan2(-p.ox, -p.oz);
      [CAST[0], CAST[3], CAST[4]].forEach((look, i) => {
        const a = (i - 1) * 0.55;
        extras.push(person(e, p.x + p.dx * a, p.z + p.dz * a, face - (i - 1) * 0.25, look, 0, 'move', 0, 0.05 + i * 0.3));
      });
      advance(1.2);
      const gy = extras[1].pos.y;
      const eye = { x: p.x - p.ox * 1.05, z: p.z - p.oz * 1.05 };
      cam.override = (c) => { c.position.set(eye.x, gy + 1.52, eye.z); c.lookAt(p.x, gy + 1.47, p.z); c.fov = 45; c.updateProjectionMatrix(); };
      for (let i = 0; i < 20; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'char_heads_back', description: 'The backs of four heads (short, long, pony tail under a cap, bun) at 1.1 m, like the chase camera.',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 + p.dx * 40, p.z - p.oz * 12 + p.dz * 40);
      const away = Math.atan2(p.ox, p.oz);
      [CAST[0], CAST[1], CAST[3], CAST[7]].forEach((look, i) => {
        const a = (i - 1.5) * 0.52;
        extras.push(person(e, p.x + p.dx * a, p.z + p.dz * a, away + (i - 1.5) * 0.3, look, 0, 'move', 0, 0.9 + i * 0.05));
      });
      advance(1);
      const gy = extras[1].pos.y;
      const eye = { x: p.x - p.ox * 1.25, z: p.z - p.oz * 1.25 };
      cam.override = (c) => { c.position.set(eye.x, gy + 1.62, eye.z); c.lookAt(p.x, gy + 1.45, p.z); c.fov = 50; c.updateProjectionMatrix(); };
      for (let i = 0; i < 20; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'char_gait', description: 'Side view mid-stride: walk 1.3, brisk 1.7, jog 3.9, sprint 6.4 m/s (treadmill).',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 + p.dx * 40, p.z - p.oz * 12 + p.dz * 40);
      const along = Math.atan2(p.dx, p.dz);
      [1.3, 1.7, 3.9, 6.4].forEach((sp, i) => {
        const a = (i - 1.5) * 1.7;
        extras.push(person(e, p.x + p.dx * a, p.z + p.dz * a, along, CAST[[0, 1, 2, 8][i]], sp, 'move', 0, 0.3 + i * 0.21));
      });
      advance(2.35);
      const gy = extras[1].pos.y;
      const eye = { x: p.x - p.ox * 5.2, z: p.z - p.oz * 5.2 };
      cam.override = (c) => { c.position.set(eye.x, gy + 1.0, eye.z); c.lookAt(p.x, gy + 0.85, p.z); c.fov = 55; c.updateProjectionMatrix(); };
      for (let i = 0; i < 8; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'char_back', description: 'Third-person view (3.4 m behind) of a walker in a jacket.',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 + p.dx * 40, p.z - p.oz * 12 + p.dz * 40);
      const along = Math.atan2(p.dx, p.dz);
      extras.push(person(e, p.x, p.z, along, CAST[2], 1.5, 'move', 0, 0.61));
      advance(1.8);
      const gy = extras[0].pos.y;
      const eye = { x: p.x - p.dx * 3.3 + p.ox * 0.45, z: p.z - p.dz * 3.3 + p.oz * 0.45 };
      cam.override = (c) => { c.position.set(eye.x, gy + 2.0, eye.z); c.lookAt(p.x + p.ox * 0.45 + p.dx * 1.2, gy + 1.35, p.z + p.oz * 0.45 + p.dz * 1.2); c.fov = 66; c.updateProjectionMatrix(); };
      for (let i = 0; i < 8; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'char_reactions', description: 'Knocked flying (0.25 s), lying hurt, getting up (0.3 s and 0.6 s).',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 + p.dx * 40, p.z - p.oz * 12 + p.dz * 40);
      const along = Math.atan2(p.dx, p.dz);
      const set: [Action, number][] = [['knocked', 0.22], ['down', 1.2], ['getup', 0.27], ['getup', 0.58]];
      set.forEach(([act, t], i) => {
        const a = (i - 1.5) * 1.9;
        const x = person(e, p.x + p.dx * a, p.z + p.dz * a, along + Math.PI / 2, CAST[i + 3], 0, act, t - 0.2, 0.7 + i * 0.11);
        if (act === 'knocked') x.pos.y += 0.7;
        extras.push(x);
      });
      advance(0.2);
      const gy = extras[1].pos.y;
      const eye = { x: p.x - p.ox * 5.8, z: p.z - p.oz * 5.8 };
      cam.override = (c) => { c.position.set(eye.x, gy + 1.6, eye.z); c.lookAt(p.x, gy + 0.5, p.z); c.fov = 55; c.updateProjectionMatrix(); };
      for (const x of extras) x.t -= 8 / 60;
      for (let i = 0; i < 8; i++) e.tick(1 / 60);
    },
  });
  registerPose({
    name: 'char_crowd', description: 'Ninety random people from 6 to 90 m along the pavement and the road (near and far LOD).',
    async apply(e) {
      const { v, cam, world } = await prepare(e);
      const p = pavement(e, world);
      moveCarAway(e, v, p.x - p.ox * 12 - p.dx * 40, p.z - p.oz * 12 - p.dz * 40);
      let s = 12345;
      const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      const along = Math.atan2(p.dx, p.dz);
      for (let i = 0; i < 90; i++) {
        const d = 6 + Math.pow(rnd(), 0.8) * 85, lat = (rnd() - 0.5) * 5 + 1.5;
        const dir = rnd() < 0.5 ? 0 : Math.PI;
        const walking = rnd() < 0.7;
        extras.push(person(e, p.x + p.dx * d + p.ox * lat, p.z + p.dz * d + p.oz * lat, along + dir + (walking ? 0 : rnd() * 6), randomLook(rnd), walking ? 1.1 + rnd() * 0.6 : 0, 'move', 0, rnd()));
      }
      advance(5);
      const gy = ground(e, p.x, p.z);
      cam.override = (c) => { c.position.set(p.x - p.dx * 2 + p.ox * 1.2, gy + 1.7, p.z - p.dz * 2 + p.oz * 1.2); c.lookAt(p.x + p.dx * 30 + p.ox * 1.2, gy + 1.1, p.z + p.dz * 30 + p.oz * 1.2); c.fov = 55; c.updateProjectionMatrix(); };
      for (let i = 0; i < 8; i++) e.tick(1 / 60);
    },
  });
}
