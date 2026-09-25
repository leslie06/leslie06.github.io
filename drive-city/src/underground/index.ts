import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { t } from '../core/I18n';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, WantedApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { AT, U, toLocal, toWorld } from './Layout';

/** The bag at the back of the hall, once. */
export const STASH = 500;
const KEY = 'drivecity.underground.v1';

export interface UndergroundApi extends System {
  /** (x, y, z) is down in the car park: under its roof, or on the lower half of its ramp. */
  contains(x: number, y: number, z: number): boolean;
  readonly inside: boolean;
  debug: { at(): { x: number; z: number; yaw: number } | null; stash(): { x: number; z: number } | null; taken(): boolean };
}

/**
 * An underground car park (地下停车场) on open ground in the core: a ramp down to a pillared hall
 * under a roof slab that is the street above. The city cuts its ground there (city/index.ts,
 * `undergroundHoles`). Down here the police cannot see you - their line-of-sight rays stop at the
 * slab - and hiding counts towards losing them as if you were outside their search circle (police/
 * asks `contains`). A bag of cash waits at the back, once.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  if (!pl || !AT) return;
  const at = AT;
  const env = engine.get<RenderSystem>('render')?.uniforms;
  let taken = false;
  try { taken = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }

  const D = U.depth, len = U.ramp + U.hall, hw = U.hallW / 2, rw = U.rampW / 2;
  // --- model (local frame, then placed) --------------------------------------------------------------
  const part = (g: THREE.BufferGeometry, hex: string, glow = 0) => {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex);
    const col = new Float32Array(n * 3), gl = new Float32Array(n).fill(glow);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    geo.deleteAttribute('uv');
    return geo;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string, glow = 0) => part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, glow);
  const slope = Math.atan2(D, U.ramp), run = Math.hypot(D, U.ramp);
  const P: THREE.BufferGeometry[] = [];
  const concrete = '#8f8c86', dark = '#4a4b4d', floor = '#5d5f62', paint = '#e7e3d8';
  // Ramp: its deck, walls up both sides (retaining the street), a kerb and railing above.
  P.push(part(new THREE.BoxGeometry(U.rampW, 0.2, run).rotateX(slope).translate(0, -D / 2 - 0.1, U.ramp / 2), floor));
  for (const s of [-1, 1]) {
    P.push(box(0.4, D + 1, U.ramp, s * (rw + 0.2), -D / 2 + 0.5, U.ramp / 2, concrete));
    P.push(box(0.1, 1, U.ramp, s * (rw + 0.35), 0.55, U.ramp / 2, '#c9ccce'));
  }
  // Hall: floor with bays, walls, roof slab (underside dark), pillars, light strips.
  P.push(box(U.hallW, 0.2, U.hall, 0, -D - 0.1, U.ramp + U.hall / 2, floor));
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) {
    // Bays either side of the aisle: white lines across.
    P.push(box(5.5, 0.02, 0.12, s * (hw - 3), -D + 0.01, U.ramp + 5 + k * 6, paint));
  }
  P.push(box(0.15, 0.02, U.hall - 4, 0, -D + 0.01, U.ramp + U.hall / 2, '#e2b021'));
  P.push(box(U.hallW, 0.1, U.hall, 0, -U.slab - 0.05, U.ramp + U.hall / 2, dark));
  P.push(box(U.hallW + 1.2, 0.35, 0.6, 0, -U.slab - 0.3, U.ramp, concrete));   // the portal beam (限高)
  P.push(box(U.rampW, 0.25, 0.08, 0, -U.slab - 0.62, U.ramp - 0.35, '#f2b705'));
  for (const s of [-1, 1]) P.push(box(0.6, D, U.hall, s * (hw + 0.3), -D / 2, U.ramp + U.hall / 2, concrete));
  P.push(box(U.hallW, D, 0.6, 0, -D / 2, len + 0.3, concrete));
  for (const s of [-1, 1]) P.push(box(hw - rw, D, 0.6, s * (rw + (hw - rw) / 2), -D / 2, U.ramp - 0.3, concrete));
  // A yellow-and-black stripe along the foot of the walls.
  for (const s of [-1, 1]) P.push(box(0.05, 0.5, U.hall, s * (hw - 0.02), -D + 0.25, U.ramp + U.hall / 2, '#e2b021'));
  const pillars: [number, number][] = [];
  for (const px of [-7.5, 7.5]) for (let k = 1; k <= 3; k++) pillars.push([px, U.ramp + k * 10]);
  for (const [px, pz] of pillars) P.push(box(0.8, D - U.slab, 0.8, px, -D + (D - U.slab) / 2, pz, '#b9b6ae'));
  for (let k = 0; k < 4; k++) for (const s of [-1, 0, 1]) P.push(box(0.25, 0.06, 3, s * 9, -U.slab - 0.13, U.ramp + 6 + k * 10, '#fff4dc', 1.6));
  // The sign at the top of the ramp: a blue P on a post.
  P.push(box(0.1, 3, 0.1, rw + 1.3, 1.5, -0.8, '#8e9398'));
  P.push(box(1.1, 1.1, 0.1, rw + 1.3, 3.2, -0.8, '#1d5fd1', 0.5));
  P.push(box(0.5, 0.7, 0.02, rw + 1.3, 3.2, -0.86, '#ffffff', 0.5));
  const geo = mergeGeometries(P)!;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = env?.uNight ?? { value: 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 1.5;');
  };
  mat.customProgramCacheKey = () => 'underground';
  mat.userData.wet = 'surface';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'underground';
  mesh.position.set(AT.x, 0.03, AT.z);
  mesh.rotation.y = AT.yaw;
  mesh.castShadow = true; mesh.receiveShadow = true;
  engine.scene.add(mesh);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(mesh));

  // --- colliders ------------------------------------------------------------------------------------
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const rot = { x: 0, y: Math.sin(AT.yaw / 2), z: 0, w: Math.cos(AT.yaw / 2) };
  const collide = (hx: number, hy: number, hz: number, lx: number, ly: number, lz: number, tag = 'underground') => {
    const [x, z] = toWorld(lx, lz);
    const c = world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, ly + 0.03, z).setRotation(rot).setFriction(0.9).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body);
    engine.physics.tag(c, { surface: 'concrete', tag });
  };
  // The ramp as a hull (its top face slopes from the street to the hall floor).
  const pts: number[] = [];
  for (const lx of [-rw, rw]) for (const [y, lz] of [[0, 0], [-D, U.ramp], [-D - 1, 0], [-D - 1, U.ramp]] as const) { const [x, z] = toWorld(lx, lz); pts.push(x, y + 0.03, z); }
  const hull = R.ColliderDesc.convexHull(new Float32Array(pts));
  if (hull) engine.physics.tag(world.createCollider(hull.setFriction(0.9).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body), { surface: 'concrete', tag: 'underground' });
  for (const s of [-1, 1]) {
    collide(0.2, (D + 1.6) / 2, U.ramp / 2, s * (rw + 0.2), -D / 2 + 0.3, U.ramp / 2);   // ramp walls, a railing's height above the street
    // The street either side of the open ramp, over the hole the city left (slab level).
    collide((hw - rw - 0.4) / 2 + 0.3, 0.5, U.ramp / 2 + 0.5, s * (rw + 0.4 + (hw - rw - 0.4) / 2 + 0.3), -0.5, U.ramp / 2 - 0.5);
  }
  collide(hw + 0.6, 0.5, 0.5, 0, -0.5, -0.5);   // the street at the top of the ramp, over the hole's lip (local z -1..0)
  collide(hw, 0.5, U.hall / 2, 0, -D - 0.5, U.ramp + U.hall / 2);   // hall floor
  collide(hw + 0.6, U.slab / 2, U.hall / 2 + 0.6, 0, -U.slab / 2, U.ramp + U.hall / 2);   // roof slab = street, to the hole's far edge
  for (const s of [-1, 1]) collide(0.3, D / 2, U.hall / 2, s * (hw + 0.3), -D / 2, U.ramp + U.hall / 2);
  collide(hw, D / 2, 0.3, 0, -D / 2, len + 0.3);
  for (const s of [-1, 1]) collide((hw - rw) / 2, D / 2, 0.3, s * (rw + (hw - rw) / 2), -D / 2, U.ramp - 0.3);
  collide(hw + 0.6, 0.18, 0.3, 0, -U.slab - 0.3, U.ramp);   // portal beam
  for (const [px, pz] of pillars) collide(0.4, (D - U.slab) / 2, 0.4, px, -D + (D - U.slab) / 2, pz);

  // --- the stash ----------------------------------------------------------------------------------
  const stashLocal: [number, number] = [hw - 3, len - 3];
  const [sx, sz] = toWorld(...stashLocal);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.4), new THREE.MeshStandardMaterial({ color: '#2b2d30', emissive: '#ffd24a', emissiveIntensity: 0.6, roughness: 0.6 }));
  bag.position.set(sx, -D + 0.45, sz);
  bag.visible = !taken;
  engine.scene.add(bag);

  const contains = (x: number, y: number, z: number) => {
    if (y > -1.5) return false;
    const [lx, lz] = toLocal(x, z);
    return Math.abs(lx) < hw && lz > U.ramp * 0.5 && lz < len;
  };
  let inside = false, clock = 0;
  const blips: Blip[] = [];
  let blipsOn = false;
  const api: UndergroundApi = {
    name: 'underground',
    contains,
    get inside() { return inside; },
    debug: { at: () => AT, stash: () => ({ x: sx, z: sz }), taken: () => taken },
    fixedUpdate(dt) {
      clock += dt;
      const p = pl.position;
      const now = contains(p.x, p.y, p.z);
      if (now && !inside) {
        const wanted = (engine.get<WantedApi>('wanted')?.level ?? 0) > 0;
        engine.get<HudApi>('hud')?.toast(t(wanted ? 'under.hide' : 'under.enter'));
      }
      inside = now;
      if (!taken && Math.hypot(p.x - sx, p.z - sz) < 2.6 && p.y < -2) {
        taken = true; bag.visible = false;
        try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
        engine.get<MissionApi>('missions')?.addCash(STASH);
        engine.get<HudApi>('hud')?.toast(t('under.stash', { n: STASH }));
      }
    },
    update() {
      if (!taken) { bag.rotation.y = clock * 1.2; bag.position.y = -D + 0.45 + Math.sin(clock * 2) * 0.06; }
      const n = engine.get<NavApi>('nav');
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => { blips.length = 0; blips.push({ kind: 'parking', x: at.x, z: at.z, label: t('under.name') }); return blips; });
      }
    },
  };
  engine.add(api);
}
