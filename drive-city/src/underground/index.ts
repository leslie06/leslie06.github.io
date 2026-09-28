import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { t } from '../core/I18n';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, WantedApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { AT, U, toLocal, toWorld } from './Layout';
import { propGeometry, propMaterials, propMeshes } from '../stunts/Props';

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
  // --- model: Blender's (stunts/Props.ts 'carpark', in this local frame), the lamps always lit -------------------
  const g = propGeometry('carpark');
  const model = new THREE.Group();
  model.name = 'underground';
  for (const mesh of propMeshes('underground', g.matte ? [g.matte] : [], g.metal ? [g.metal] : [], propMaterials(env, 'underground', 1.0, 0.5))) model.add(mesh);
  model.position.set(AT.x, 0.03, AT.z);
  model.rotation.y = AT.yaw;
  engine.scene.add(model);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(model));
  const pillars: [number, number][] = [];
  for (const px of [-7.5, 7.5]) for (let k = 1; k <= 3; k++) pillars.push([px, U.ramp + k * 10]);

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
