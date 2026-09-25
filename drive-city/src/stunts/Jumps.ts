import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { t } from '../core/I18n';
import { shotMode } from '../debug/ShotMode';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, VehicleApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { JUMPS, OVERPASSES } from './spots';
import { OVERPASS } from './Structures';

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

  // --- the ramps: one merged mesh, one fixed body with a hull per ramp ---------------------------------
  const deck = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide });
  deck.userData.wet = 'surface';
  const parts: THREE.BufferGeometry[] = [];
  const colour = (g: THREE.BufferGeometry, hex: string) => {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    geo.deleteAttribute('uv');
    return geo;
  };
  const slope = Math.atan2(RAMP.h, RAMP.len), run = Math.hypot(RAMP.len, RAMP.h);
  /** One ramp in its own frame: the foot at z = 0, the lip at z = len, +z along the heading. */
  const rampGeometry = (): THREE.BufferGeometry[] => {
    const g: THREE.BufferGeometry[] = [];
    // The deck plate, tilted up the slope, and yellow/black chevrons painted on it.
    const plate = new THREE.BoxGeometry(RAMP.w, 0.08, run).rotateX(-slope).translate(0, RAMP.h / 2, RAMP.len / 2);
    g.push(colour(plate, '#2b2d30'));
    for (let k = 0; k < 5; k++) {
      const z0 = 0.8 + k * 1.6;
      for (const s of [-1, 1]) {
        const bar = new THREE.BoxGeometry(RAMP.w * 0.46, 0.02, 0.4).rotateY(s * 0.55).translate(s * RAMP.w * 0.22, 0, 0);
        bar.rotateX(-slope).translate(0, (z0 / RAMP.len) * RAMP.h + 0.06, z0);
        g.push(colour(bar, '#f2b705'));
      }
    }
    // Side skirts (triangles) and the lip's back wall, steel grey.
    for (const s of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      const x = s * RAMP.w / 2;
      tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x, 0, 0, x, 0, RAMP.len, x, RAMP.h, RAMP.len]), 3));
      tri.computeVertexNormals();
      g.push(colour(tri, '#6c7176'));
    }
    g.push(colour(new THREE.BoxGeometry(RAMP.w, RAMP.h, 0.12).translate(0, RAMP.h / 2, RAMP.len - 0.06), '#55595e'));
    // Warning flags on the lip.
    for (const s of [-1, 1]) {
      g.push(colour(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5).translate(s * (RAMP.w / 2 + 0.1), RAMP.h + 0.7, RAMP.len), '#d8dadc'));
      g.push(colour(new THREE.BoxGeometry(0.02, 0.35, 0.5).translate(s * (RAMP.w / 2 + 0.1), RAMP.h + 1.2, RAMP.len - 0.25), '#e8481f'));
    }
    return g;
  };
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const j of JUMPS) {
    m.compose(new THREE.Vector3(j.x, 0.03, j.z), q.setFromAxisAngle(up, j.yaw), new THREE.Vector3(1, 1, 1));
    for (const g of rampGeometry()) parts.push(g.applyMatrix4(m));
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
  const O = OVERPASS, lipAt = O.ramp + O.deck, oSlope = Math.atan2(O.h, O.ramp);
  const overpassGeometry = (gap: number): THREE.BufferGeometry[] => {
    const g: THREE.BufferGeometry[] = [];
    const walls = '#b9b6ae', road = '#3a3c3f', kerb = '#d8d5cc';
    // The embankment: an asphalt top up the slope, retaining walls down its sides, parapets on top.
    g.push(colour(new THREE.BoxGeometry(O.w, 0.1, Math.hypot(O.ramp, O.h)).rotateX(-oSlope).translate(0, O.h / 2, O.ramp / 2), road));
    for (const sx of [-1, 1]) {
      const x = sx * O.w / 2, tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x, 0, 0, x, 0, O.ramp, x, O.h, O.ramp]), 3));
      tri.computeVertexNormals();
      g.push(colour(tri, walls));
      g.push(colour(new THREE.BoxGeometry(0.35, 0.8, Math.hypot(O.ramp, O.h)).rotateX(-oSlope).translate(sx * (O.w / 2 - 0.17), O.h / 2 + 0.4, O.ramp / 2), kerb));
      // The deck's parapets, and its pillars.
      g.push(colour(new THREE.BoxGeometry(0.35, 0.8, O.deck).translate(sx * (O.w / 2 - 0.17), O.h + 0.4, O.ramp + O.deck / 2), kerb));
      for (const pz of [O.ramp + 3, lipAt - 2.5]) g.push(colour(new THREE.BoxGeometry(1.1, O.h - 1.2, 1.1).translate(sx * (O.w / 2 - 1.2), (O.h - 1.2) / 2, pz), walls));
    }
    g.push(colour(new THREE.BoxGeometry(O.w, 1.2, O.deck).translate(0, O.h - 0.6, O.ramp + O.deck / 2), walls));
    g.push(colour(new THREE.BoxGeometry(O.w, 0.06, O.deck).translate(0, O.h + 0.03, O.ramp + O.deck / 2), road));
    // The broken end: rebar sticking out of the deck edge.
    for (let i = 0; i < 9; i++) g.push(colour(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4).rotateX(Math.PI / 2 - 0.25).translate(-O.w / 2 + 0.6 + i * (O.w - 1.2) / 8, O.h - 0.6 - (i % 2) * 0.35, lipAt + 0.5), '#7a4a30'));
    // Lane paint up the middle, and a warning board at the foot: 前方断桥.
    for (let k = 0; k < 6; k++) g.push(colour(new THREE.BoxGeometry(0.15, 0.02, 3).rotateX(-oSlope).translate(0, (8 + k * 9) / O.ramp * O.h + 0.07, 8 + k * 9), '#e8e6df'));
    g.push(colour(new THREE.BoxGeometry(2.4, 1.1, 0.08).translate(O.w / 2 + 1.8, 1.6, -2), '#f2b705'));
    g.push(colour(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5).translate(O.w / 2 + 1.8, 1.1, -1.95), '#8e9398'));
    // Across the road: an earth mound to land on, its edge by the kerb, a flat top, a long slope down.
    const L0 = lipAt + gap, mound = new THREE.BufferGeometry();
    const w2 = O.w / 2 + 1, top = O.landH, a = L0 + O.front, b = a + O.top, back = b + O.land;
    mound.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -w2, 0, L0, w2, 0, L0, w2, top, a, -w2, 0, L0, w2, top, a, -w2, top, a,
      -w2, top, a, w2, top, a, w2, top, b, -w2, top, a, w2, top, b, -w2, top, b,
      -w2, top, b, w2, top, b, w2, 0, back, -w2, top, b, w2, 0, back, -w2, 0, back,
      -w2, 0, L0, -w2, top, a, -w2, top, b, -w2, 0, L0, -w2, top, b, -w2, 0, back,
      w2, 0, L0, w2, top, b, w2, top, a, w2, 0, L0, w2, 0, back, w2, top, b,
    ]), 3));
    mound.computeVertexNormals();
    g.push(colour(mound, '#7d6a4f'));
    return g;
  };
  for (const o of OVERPASSES) {
    m.compose(new THREE.Vector3(o.x, 0.03, o.z), q.setFromAxisAngle(up, o.yaw), new THREE.Vector3(1, 1, 1));
    for (const g of overpassGeometry(o.gap)) parts.push(g.applyMatrix4(m));
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

  const merged = mergeAll(parts);
  const mesh = new THREE.Mesh(merged, deck);
  mesh.name = 'stunt-ramps';
  mesh.castShadow = true; mesh.receiveShadow = true;
  engine.scene.add(mesh);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(mesh));

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
      const n = engine.get<NavApi>('nav');
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => { blips.length = 0; for (const j of launchers) if (!done.has(j.id)) blips.push({ kind: 'jump', x: j.x + Math.sin(j.yaw) * j.lip, z: j.z + Math.cos(j.yaw) * j.lip }); return blips; });
      }
    },
  };
  engine.add(api);
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    const c = p.getAttribute('position').count;
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
