import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Blip, CameraApi, HudApi, MissionApi, PlayerApi, RenderApi } from '../game/Contracts';
import type { MusicSource } from '../audio/StreetMusic';
import { Gait } from '../character/Animator';
import { randomLook, type Look } from '../character/Body';
import type { TravelApi } from '../travel';
import LAYOUT from './nanluo.layout.json';
import LAKE from './houhai.lake.json';

type XY = [number, number];
interface HouhaiLayout {
  frame: { gx: number; gz: number; heading: number }; half: number; bars: XY; shore: XY; bridge: XY[];
  seats: [number, number, number, number][]; music: XY[]; boats: [number, number, number, number][];
  dock: { counter: XY; pier: XY[] };
}
const HH = (LAYOUT as unknown as { houhai: HouhaiLayout }).houhai;
const RINGS = (LAKE as { rings: { o: number[]; hs: number[][] }[] }).rings;

/** A duck boat for a go on the lake, an ice chair in winter; a seat at a bar's table: health back a second. */
export const BOAT_PRICE = 40, SLED_PRICE = 30, SEAT_HEAL = 1.5;
const DOCK_R = 1.6, LAND_R = 9;

// 后海's frame (nanluo.py's houhai part): u across 后海南沿 (the lake at +u), s along it west from 银锭桥, no bends.
const R = -HH.frame.heading * Math.PI / 180, RC = Math.cos(R), RS = Math.sin(R);
export const hhWorld = (u: number, s: number): { x: number; z: number } => ({ x: HH.frame.gx + u * RC - s * RS, z: HH.frame.gz - u * RS - s * RC });
const hhYaw = (du: number, ds: number) => Math.atan2(du * RC - ds * RS, -du * RS - ds * RC);

/** Inside the lake's water (not on one of its islands). */
const inRing = (r: number[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
export const inLake = (x: number, z: number): boolean => RINGS.some((g) => inRing(g.o, x, z) && !g.hs.some((h) => inRing(h, x, z)));

/** The season by Beijing's calendar (December to February: 什刹海 freezes, the rink opens), or ?season=winter|summer. */
export function winterNow(q: URLSearchParams, now = new Date()): boolean {
  const s = q.get('season');
  if (s === 'winter') return true;
  if (s === 'summer') return false;
  const m = new Date(now.getTime() + 8 * 3600e3).getUTCMonth();
  return m === 11 || m === 0 || m === 1;
}

/** A craft on the lake: the player's, one moored at the pier, one going round on its own. */
interface Craft { x: number; z: number; yaw: number; vx: number; vz: number; speed: number; slot: number; npc: boolean; goal: { x: number; z: number } | null; t: number }

/** Merged, vertex-coloured: a pedal boat with a duck's head and a striped canopy; an ice chair on two runners. */
function craftGeo(kind: 'boat' | 'sled'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const put = (g: THREE.BufferGeometry, col: string, x: number, y: number, z: number, rx = 0) => {
    g.rotateX(rx); g.translate(x, y, z);
    const c = new THREE.Color(col), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  if (kind === 'boat') {
    const hull = new THREE.CylinderGeometry(0.72, 0.62, 0.42, 16, 1);
    hull.scale(1, 1, 1.75);
    put(hull, '#f2efe6', 0, 0.21, 0);
    const rim = new THREE.CylinderGeometry(0.75, 0.75, 0.08, 16, 1, true); rim.scale(1, 1, 1.75);
    put(rim, '#e8b923', 0, 0.44, 0);
    put(new THREE.BoxGeometry(1.1, 0.12, 0.5), '#3a6aa8', 0, 0.5, -0.2);   // the bench
    put(new THREE.SphereGeometry(0.24, 12, 9), '#f0c419', 0, 1.0, 1.12);  // the duck's head
    put(new THREE.CylinderGeometry(0.13, 0.18, 0.5, 10), '#f0c419', 0, 0.72, 1.05);
    put(new THREE.ConeGeometry(0.08, 0.22, 8), '#e8762a', 0, 0.98, 1.38, Math.PI / 2);
    for (const sx of [-0.06, 0.06]) put(new THREE.SphereGeometry(0.03, 6, 4), '#141414', sx * 2.4, 1.07, 1.3);
    for (const [px, pz] of [[-0.55, 0.45], [0.55, 0.45], [-0.55, -0.8], [0.55, -0.8]]) put(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 5), '#d8d4cc', px, 0.92, pz);
    put(new THREE.BoxGeometry(1.3, 0.05, 1.5), '#c8372d', 0, 1.42, -0.18);
  } else {
    for (const sx of [-0.28, 0.28]) put(new THREE.BoxGeometry(0.04, 0.06, 1.3), '#9aa3ab', sx, 0.04, 0);
    put(new THREE.BoxGeometry(0.66, 0.06, 0.8), '#8a5a32', 0, 0.3, -0.05);
    for (const [px, pz] of [[-0.28, 0.3], [0.28, 0.3], [-0.28, -0.4], [0.28, -0.4]]) put(new THREE.BoxGeometry(0.05, 0.26, 0.05), '#6b4426', px, 0.17, pz);
    put(new THREE.BoxGeometry(0.66, 0.45, 0.05), '#8a5a32', 0, 0.55, -0.44);
    put(new THREE.BoxGeometry(0.7, 0.05, 0.05), '#c8372d', 0, 0.82, -0.44);
  }
  return mergeGeometries(parts)!;
}

export interface HouhaiApi {
  readonly winter: boolean;
  /** On the water, at a table: no street encounter starts (district.busy). */
  readonly busy: boolean;
  fixedUpdate(dt: number): void;
  update(dt: number, foot: { pos: THREE.Vector3; yaw: number } | null): void;
  /** The bars' music while the player is near, for audio/ (through district.music). */
  music(out: MusicSource[], t: number): void;
  blips(out: Blip[]): void;
  debug: { craft(): { x: number; z: number; yaw: number; speed: number } | null; rent(): boolean; seats(): { x: number; z: number }[]; inLake(x: number, z: number): boolean; dock(): { x: number; z: number }; toDock(): void; rink(): { x: number; z: number } | null };
}

/**
 * 后海 (2026-11-04, docs/gta-plan.md §12.3 第 4 轮, 「后海：湖边酒吧街、银锭桥、划船、冬天冰场」): the bar street on 后海南沿 is the
 * landmark `houhai` (nanluo.py); this runs what happens there -
 *   the pier   F at its root: a duck boat (¥40) - W/S pedal, A/D steer, F back at the pier to get off; three more go
 *              round the lake on their own. In winter (Beijing's December-February, or ?season=winter) the lake is ice:
 *              an ice chair (¥30) instead, sliding, off anywhere; a rink on 前海 by 银锭桥 with people skating round it.
 *   the bars   a table and two stools before every other one: sit (F), the lake in view, health back; music from the doors.
 */
export function installHouhai(engine: Engine, deps: { toast(s: string, secs?: number): void }): HouhaiApi {
  const pl = engine.get<PlayerApi>('player')!;
  const q = new URLSearchParams(location.search);
  const winter = winterNow(q);
  const missions = () => engine.get<MissionApi>('missions');
  const cam = () => engine.get<CameraApi>('camera');
  const rnd = new Rng(8803);
  const W = (p: XY) => hhWorld(p[0], p[1]);
  const dock = W(HH.dock.counter);
  const bridgeMid = hhWorld(HH.bridge[1][0] * 0.35, HH.bridge[1][1] * 0.35);
  const near = (p: { x: number; z: number }, r: number) => Math.hypot(pl.position.x - p.x, pl.position.z - p.z) < r;
  /** Water a craft may be on: the lake, not under 银锭桥 (the boats keep to their own side of it). */
  const navigable = (x: number, z: number) => inLake(x, z) && Math.hypot(x - bridgeMid.x, z - bridgeMid.z) > 9;

  // --- the crafts: the moored ones (the pier's slots), three going round, the player's ---
  const env = engine.get<RenderApi>('render')?.uniforms;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = env?.uNight ?? { value: 0 };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.1 * uNight;');
  };
  mat.customProgramCacheKey = () => 'hh-craft';
  const mesh = new THREE.InstancedMesh(craftGeo(winter ? 'sled' : 'boat'), mat, 12);
  mesh.name = 'hh-crafts'; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0;
  engine.scene.add(mesh);
  const crafts: Craft[] = HH.boats.map(([u, s, du, ds], slot) => { const p = hhWorld(u, s); return { x: p.x, z: p.z, yaw: hhYaw(du, ds), vx: 0, vz: 0, speed: 0, slot, npc: false, goal: null, t: 0 }; });
  // ...and three out on the water already (a random spot in 后海 each)
  const lakePoint = (cx: number, cz: number, r: number): { x: number; z: number } | null => {
    for (let k = 0; k < 40; k++) { const x = cx + (rnd.next() - 0.5) * 2 * r, z = cz + (rnd.next() - 0.5) * 2 * r; if (navigable(x, z)) return { x, z }; }
    return null;
  };
  const lakeMid = hhWorld(60, 120);
  for (let i = 0; i < 3; i++) { const p = lakePoint(lakeMid.x, lakeMid.z, 160); if (p) crafts.push({ ...p, yaw: rnd.next() * 6.28, vx: 0, vz: 0, speed: 0, slot: -1, npc: true, goal: null, t: 0 }); }
  let mine: Craft | null = null;
  const seat = { pos: new THREE.Vector3(), yaw: 0 };

  // --- winter: the ice over the whole lake, a rink on 前海 with skaters ---
  const group = new THREE.Group();
  group.name = 'hh-winter';
  interface Skater { a: number; speed: number; r: number; gait: Gait; look: Look; seed: number; pos: THREE.Vector3; yaw: number }
  const skaters: Skater[] = [];
  const rink = !winter ? null : (() => {
    // the open water nearest 银锭桥 (前海's north end) with room for a rink 28 x 17 m
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let gx = -240; gx <= 240; gx += 12) for (let gz = -240; gz <= 240; gz += 12) {
      const c = { x: bridgeMid.x + gx, z: bridgeMid.z + gz }, d = Math.hypot(gx, gz);
      if (d >= bd || d < 25) continue;
      let ok = true;
      for (let k = 0; k < 20 && ok; k++) { const a = (k / 20) * Math.PI * 2; ok = inLake(c.x + Math.cos(a) * 17, c.z + Math.sin(a) * 11); }
      if (ok && inLake(c.x, c.z)) { best = c; bd = d; }
    }
    return best;
  })();
  if (winter) {
    const ice = new THREE.MeshStandardMaterial({ color: '#dfe8ec', roughness: 0.22, metalness: 0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const geos: THREE.BufferGeometry[] = [];
    for (const g of RINGS) {
      const ring = (o: number[]) => { const r: THREE.Vector2[] = []; for (let i = 0; i < o.length; i += 2) r.push(new THREE.Vector2(o[i], o[i + 1])); return r; };
      const contour = ring(g.o), holes = g.hs.map(ring);
      let faces: number[][];
      try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { continue; }
      const all = contour.concat(...holes), pos = new Float32Array(all.length * 3);
      all.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = 0.03; pos[i * 3 + 2] = v.y; });
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      bg.setIndex(faces.flatMap((f) => [f[0], f[2], f[1]]));
      bg.computeVertexNormals();
      geos.push(bg);
    }
    const merged = geos.length ? mergeGeometries(geos) : null;
    if (merged) { const m = new THREE.Mesh(merged, ice); m.name = 'hh-ice'; m.receiveShadow = true; group.add(m); }
    if (rink) {
      // the rink's boards: posts and two rails round an ellipse, red and white
      const fence: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 48; k++) {
        const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
        const x0 = rink.x + Math.cos(a0) * 14, z0 = rink.z + Math.sin(a0) * 8.5, x1 = rink.x + Math.cos(a1) * 14, z1 = rink.z + Math.sin(a1) * 8.5;
        const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
        const board = new THREE.BoxGeometry(0.05, 0.7, len);
        board.rotateY(yaw); board.translate((x0 + x1) / 2, 0.38, (z0 + z1) / 2);
        const c = new THREE.Color(k % 2 ? '#c8372d' : '#f2efe6'), n = board.getAttribute('position').count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        board.setAttribute('color', new THREE.BufferAttribute(col, 3));
        fence.push(board.toNonIndexed());
      }
      const fm = new THREE.Mesh(mergeGeometries(fence)!, mat);
      fm.name = 'hh-rink'; fm.castShadow = true; group.add(fm);
      for (let i = 0; i < 14; i++) {
        const look = randomLook(() => rnd.next());
        skaters.push({ a: rnd.next() * 6.28, speed: (0.22 + rnd.next() * 0.12) * (rnd.next() < 0.85 ? 1 : -1), r: 0.55 + rnd.next() * 0.35, gait: new Gait(), look, seed: rnd.next(), pos: new THREE.Vector3(), yaw: 0 });
      }
    }
    engine.scene.add(group);
    queueMicrotask(() => engine.get<{ name: string; prepare?(o: THREE.Object3D): void }>('render')?.prepare?.(group));
  }

  // --- riding: board at the pier, the camera behind, off at the pier (in winter anywhere on the ice) ---
  let ride: { t: number; camYaw: number } | null = null;
  const board = () => {
    const m = missions(), price = winter ? SLED_PRICE : BOAT_PRICE;
    if (mine || !m) return false;
    if (m.cash < price) { deps.toast(t('nl.panel.short', { n: price - m.cash }), 2); return false; }
    // the moored one nearest the dock
    let best: Craft | null = null, bd = Infinity;
    for (const c of crafts) if (!c.npc && c.slot >= 0) { const d = Math.hypot(c.x - dock.x, c.z - dock.z); if (d < bd) { bd = d; best = c; } }
    if (!best) return false;
    m.addCash(-price);
    mine = best; mine.speed = 0; mine.vx = mine.vz = 0;
    seat.pos.set(mine.x, 0.02, mine.z); seat.yaw = mine.yaw;
    pl.setRiding(seat);
    pl.setPose?.('sit', 0);
    ride = { t: 0, camYaw: mine.yaw };
    const c = cam();
    if (c) c.override = (cm) => {
      const b = mine;
      if (!b || !ride) return;
      const fx = Math.sin(ride.camYaw), fz = Math.cos(ride.camYaw);
      cm.position.set(b.x - fx * 6.5, 3.2, b.z - fz * 6.5);
      cm.lookAt(b.x + fx * 4, 0.6, b.z + fz * 4);
      cm.fov = 62; cm.updateProjectionMatrix();
    };
    engine.events.emit('district:buy', { shop: 'houhai', item: winter ? 'sled' : 'boat', price });
    deps.toast(t(winter ? 'hh.sled.on' : 'hh.boat.on'), 4.5);
    return true;
  };
  const getOff = () => {
    const b = mine;
    if (!b) return;
    const atPier = Math.hypot(b.x - dock.x, b.z - dock.z) < LAND_R;
    if (!atPier && !winter) { deps.toast(t('hh.boat.backToDock'), 2.5); return; }
    pl.setPose?.(null);
    const c = cam();
    if (c) { c.override = null; }
    const land = atPier ? dock : { x: b.x + Math.cos(b.yaw) * 1.1, z: b.z - Math.sin(b.yaw) * 1.1 };
    pl.setRiding(null, { x: land.x, y: 0.3, z: land.z, yaw: b.yaw });
    c?.snap();
    // back to its slot (from the ice: once out of sight, see fixedUpdate)
    if (atPier) { const [u, s, du, ds] = HH.boats[b.slot]; const p = hhWorld(u, s); b.x = p.x; b.z = p.z; b.yaw = hhYaw(du, ds); }
    b.speed = 0; b.vx = b.vz = 0; b.t = atPier ? 0 : 1;
    mine = null; ride = null;
  };

  // --- the bars' tables ---
  let sat: { seat: number; t: number } | null = null;
  const seats = HH.seats.map(([u, s, fu, fs]) => ({ at: hhWorld(u, s), face: hhWorld(fu, fs), lake: hhWorld(4.6, s) }));
  const sit = (i: number) => {
    const s = seats[i];
    if (!s || sat || mine) return;
    pl.setRiding({ pos: new THREE.Vector3(s.at.x, 0.04, s.at.z), yaw: Math.atan2(s.lake.x - s.at.x, s.lake.z - s.at.z) });
    pl.setPose?.('sit', 0);
    sat = { seat: i, t: 0 };
    const c = cam();
    // behind and beside the player, short of the bar's front (0.9 m back of the stool), over the road to the water
    const fx = s.lake.x - s.at.x, fz = s.lake.z - s.at.z, L = Math.hypot(fx, fz) || 1, ux = fx / L, uz = fz / L;
    const ax = s.at.x - s.face.x, az = s.at.z - s.face.z, AL = Math.hypot(ax, az) || 1, sx = ax / AL, sz = az / AL;
    if (c) c.override = (cm) => {
      cm.position.set(s.at.x + sx * 1.5 - ux * 0.8, 1.7, s.at.z + sz * 1.5 - uz * 0.8);
      cm.lookAt(s.at.x + ux * 10 - sx * 1.6, 0.9, s.at.z + uz * 10 - sz * 1.6);
      cm.fov = 60; cm.updateProjectionMatrix();
    };
    deps.toast(t('hh.seat.on'), 4);
  };
  const standUp = () => {
    const s = sat && seats[sat.seat];
    sat = null;
    pl.setPose?.(null);
    const c = cam();
    if (c) c.override = null;
    if (s) pl.setRiding(null, { x: s.at.x + (s.face.x - s.at.x) * -0.7, y: 0.3, z: s.at.z + (s.face.z - s.at.z) * -0.7, yaw: Math.atan2(s.lake.x - s.at.x, s.lake.z - s.at.z) });
    c?.snap();
  };

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
  const crowdDraw = new THREE.Vector3();
  let clock = 0;
  const api: HouhaiApi = {
    winter,
    get busy() { return !!mine || !!sat; },
    fixedUpdate(dt) {
      clock += dt;
      const inp = engine.input.state;
      // the player's craft
      const b = mine;
      if (b && ride) {
        ride.t += dt;
        const thr = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0), steer = inp.steer;
        if (winter) {
          // an ice chair: pushed along where it points, sliding, little grip sideways
          const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
          b.vx += fx * thr * 2.6 * dt; b.vz += fz * thr * 2.6 * dt;
          const along = b.vx * fx + b.vz * fz, sx = b.vx - along * fx, sz = b.vz - along * fz;
          const k = Math.exp(-0.25 * dt), ks = Math.exp(-1.6 * dt);
          b.vx = along * k * fx + sx * ks; b.vz = along * k * fz + sz * ks;
          const sp = Math.hypot(b.vx, b.vz);
          if (sp > 5.5) { b.vx *= 5.5 / sp; b.vz *= 5.5 / sp; }
          b.yaw -= steer * (0.9 + Math.min(1, sp / 3)) * dt;
          b.speed = sp;
        } else {
          // a duck boat: pedalled, slow, turning even when nearly still
          b.speed += thr * 1.3 * dt;
          b.speed *= Math.exp(-0.55 * dt);
          b.speed = Math.max(-1.0, Math.min(2.6, b.speed));
          b.yaw -= steer * (0.5 + Math.min(0.6, Math.abs(b.speed) / 3)) * dt;
          b.vx = Math.sin(b.yaw) * b.speed; b.vz = Math.cos(b.yaw) * b.speed;
        }
        // keep to the water: its bow and stern, else stopped (and nudged back)
        const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt, fx = Math.sin(b.yaw) * 1.2, fz = Math.cos(b.yaw) * 1.2;
        if (navigable(nx + fx, nz + fz) && navigable(nx - fx, nz - fz)) { b.x = nx; b.z = nz; }
        else { b.vx *= -0.2; b.vz *= -0.2; b.speed *= -0.2; }
        seat.pos.set(b.x - Math.sin(b.yaw) * 0.25, winter ? 0.0 : 0.06, b.z - Math.cos(b.yaw) * 0.25); seat.yaw = b.yaw;
        ride.camYaw += Math.atan2(Math.sin(b.yaw - ride.camYaw), Math.cos(b.yaw - ride.camYaw)) * (1 - Math.exp(-dt * 2.2));
      }
      // the others: going round to a point and on to the next, slowly; a chair left on the ice goes home unseen
      for (const c of crafts) {
        if (c === mine) continue;
        if (!c.npc) {
          if (c.t > 0 && !near(c, 60)) { const [u, s, du, ds] = HH.boats[c.slot]; const p = hhWorld(u, s); c.x = p.x; c.z = p.z; c.yaw = hhYaw(du, ds); c.t = 0; }
          continue;
        }
        if (!c.goal || Math.hypot(c.goal.x - c.x, c.goal.z - c.z) < 4) c.goal = lakePoint(c.x, c.z, 70);
        if (!c.goal) continue;
        const want = Math.atan2(c.goal.x - c.x, c.goal.z - c.z), d = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
        c.yaw += Math.max(-0.35 * dt, Math.min(0.35 * dt, d));
        const sp = winter ? 2.2 : 1.1, nx = c.x + Math.sin(c.yaw) * sp * dt, nz = c.z + Math.cos(c.yaw) * sp * dt;
        if (navigable(nx, nz)) { c.x = nx; c.z = nz; } else c.goal = null;
        c.t += dt;
      }
      if (sat) { sat.t += dt; if (pl.health < 100) pl.heal(SEAT_HEAL * dt); }
      for (const k of skaters) k.a += k.speed * dt;
    },
    update(dt, foot) {
      // the crafts, bobbing a little on the water
      let n = 0;
      if (near(dock, 600)) for (const c of crafts) {
        const bob = winter ? 0 : Math.sin(clock * 1.7 + c.x) * 0.02;
        _q.setFromAxisAngle(_up, c.yaw);
        _m.compose(_p.set(c.x, (winter ? 0.03 : 0.0) + bob, c.z), _q, _s);
        mesh.setMatrixAt(n++, _m);
      }
      mesh.count = n;
      if (n) mesh.instanceMatrix.needsUpdate = true;
      // skaters going round the rink
      if (rink && near(rink, 220)) {
        const camP = engine.camera.position;
        for (const k of skaters) {
          const x = rink.x + Math.cos(k.a) * 14 * k.r, z = rink.z + Math.sin(k.a) * 8.5 * k.r;
          const dx = -Math.sin(k.a) * 14 * k.r * Math.sign(k.speed), dz = Math.cos(k.a) * 8.5 * k.r * Math.sign(k.speed);
          k.yaw = Math.atan2(dx, dz);
          if (Math.hypot(x - camP.x, z - camP.z) > 160) continue;
          // a slow stride for a fast glide: skating
          k.gait.update({ speed: 0.55, action: 'move', t: clock }, dt, k.seed);
          crowdDraw.set(x, 0.04, z);
          pl.crowd.add(crowdDraw, k.yaw, k.gait, k.look);
        }
      }
      // F: off the craft; up from a seat
      const enter = engine.input.state.enterPressed;
      if (mine && ride && ride.t > 0.6 && enter) { getOff(); return; }
      if (sat && sat.t > 0.5 && enter) { standUp(); return; }
      if (!foot || pl.riding) return;
      if (Math.hypot(foot.pos.x - dock.x, foot.pos.z - dock.z) < DOCK_R) {
        const price = winter ? SLED_PRICE : BOAT_PRICE;
        pl.offer?.({ x: dock.x, z: dock.z, r: DOCK_R, label: t(winter ? 'hh.offer.sled' : 'hh.offer.boat', { n: price }), use: () => { board(); } });
      }
      seats.forEach((s, i) => {
        if (Math.hypot(foot.pos.x - s.at.x, foot.pos.z - s.at.z) < 0.95) pl.offer?.({ x: s.at.x, z: s.at.z, r: 0.95, label: t('hh.offer.seat'), use: () => sit(i) });
      });
    },
    music(out, tt) {
      if (!near(dock, 260)) return;
      HH.music.forEach((p, i) => { const w = W(p); out.push({ id: `hh-bar${i}`, kind: 'ballad', x: w.x, z: w.z, t: tt + i * 7, song: i % 3 }); });
    },
    blips(out) {
      out.push({ kind: 'shop', x: dock.x, z: dock.z, label: t(winter ? 'hh.map.rink' : 'hh.map.dock') });
    },
    debug: {
      craft: () => (mine ? { x: mine.x, z: mine.z, yaw: mine.yaw, speed: mine.speed } : null),
      rent: () => board(),
      seats: () => seats.map((s) => s.at),
      inLake: (x, z) => inLake(x, z),
      dock: () => dock,
      toDock: () => { if (mine) { const p = hhWorld(HH.boats[mine.slot][0] + 1.5, HH.boats[mine.slot][1]); mine.x = p.x; mine.z = p.z; mine.speed = 0; mine.vx = mine.vz = 0; } },
      rink: () => rink,
    },
  };

  // 快速前往 (travel/): 后海 by 银锭桥 - driving, on 后海南沿 short of the bars (the lake on the right); on foot at the pier
  const tr = engine.get<TravelApi>('travel');
  const lakeYaw = hhYaw(1, 0), eastYaw = hhYaw(0, -1);
  if (tr) tr.register({ id: 'houhai', group: 'district', label: 'travel.houhai', x: dock.x, z: dock.z, go: () => {
    const road = hhWorld(-1.3, 62);
    void tr.land({ road: { x: road.x, z: road.z, yaw: eastYaw }, foot: { x: dock.x - Math.sin(lakeYaw) * 0.6, z: dock.z - Math.cos(lakeYaw) * 0.6, yaw: lakeYaw },
      caption: t(winter ? 'hh.arrivedWinter' : 'hh.arrived'), footCaption: t(winter ? 'hh.arrivedWinterFoot' : 'hh.arrivedFoot'), look: 0.55 });
  } });
  return api;
}
