import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { EnvUniforms, LandmarkDef, RenderApi, WorldApi } from '../game/Contracts';
import { TAXI } from '../vehicle/Spec';
import { loadCity, type Manifest, type Network, type Skyline } from './Data';
import { project } from './Geo';
import { createCityMaterials } from './Materials';
import { Routes } from './Routes';
import { SkylineLod } from './Skyline';
import { CityStreamer, spawnTileWorkers } from './Streamer';

export interface CityApi {
  name: 'city';
  manifest: Manifest;
  routes: Routes;
  streamer: CityStreamer;
}

// Optional until the landmark models land: a missing module must not break the build.
const landmarkModules = import.meta.glob('./landmarks/index.ts');

async function loadLandmarks(): Promise<LandmarkDef[]> {
  const loader = landmarkModules['./landmarks/index.ts'];
  if (!loader) return [];
  try { return ((await loader()) as { LANDMARKS?: LandmarkDef[] }).LANDMARKS ?? []; }
  catch (e) { console.warn('[city] landmarks unavailable', e); return []; }
}

/** Landmarks at their OSM anchors, with colliders; returns their footprints in world XZ (flat). */
function placeLandmarks(engine: Engine, env: EnvUniforms, defs: LandmarkDef[]): number[][] {
  /** ?nostone skips the walkable stone colliders (for measuring what they cost). */
  const noStone = new URLSearchParams(location.search).has('nostone');
  const { R, world } = engine.physics;
  const footprints: number[][] = [];
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL);
  for (const def of defs) {
    let model;
    try { model = def.build(env); } catch (e) { console.warn('[city] landmark', def.id, e); continue; }
    const [x, z] = project(def.lat, def.lon);
    const rot = -def.headingDeg * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const toWorld = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    model.group.position.set(x, 0, z);
    model.group.rotation.y = rot;
    model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model.group.name = `landmark ${def.id}`;
    engine.scene.add(model.group);
    footprints.push(model.footprint.flatMap(([lx, lz]) => toWorld(lx, lz)));
    // Stone you can stand on. Terraces, steps and bridges are geometry only, so the player used to
    // stand on the ground *under* them and looked buried. Build trimesh colliders from the stone
    // meshes, preferring the far LOD (same shape, a fraction of the triangles).
    model.group.updateMatrixWorld(true);
    const stone = noStone ? /(?!)/ : /^(marble|paving|granite|stone)/i;
    const roots = [model.group.getObjectByName('far') ?? model.group.getObjectByName('detail'), model.group.getObjectByName('extras')];
    const wp = new THREE.Vector3();
    for (const root of roots) {
      root?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !stone.test(mesh.name)) return;
        const geo = mesh.geometry as THREE.BufferGeometry;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
        const index = geo.getIndex();
        const tris = (index ? index.count : (pos?.count ?? 0)) / 3;
        if (!pos || tris < 1 || tris > 60000) return;
        const verts = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          wp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          verts[i * 3] = wp.x; verts[i * 3 + 1] = wp.y; verts[i * 3 + 2] = wp.z;
        }
        const idx = index ? Uint32Array.from(index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
        engine.physics.tag(world.createCollider(R.ColliderDesc.trimesh(verts, idx).setCollisionGroups(g).setFriction(0.8), body), { surface: 'concrete', tag: `landmark:${def.id}` });
      });
    }
    for (const sp of model.colliders) {
      let desc: import('@dimforge/rapier3d-compat').ColliderDesc | null = null;
      if (sp.kind === 'box') {
        const [wx, wz] = toWorld(sp.center[0], sp.center[2]);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + (sp.yaw ?? 0));
        desc = R.ColliderDesc.cuboid(sp.half[0], sp.half[1], sp.half[2]).setTranslation(wx, sp.center[1], wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      } else if (sp.kind === 'cylinder') {
        const [wx, wz] = toWorld(sp.center[0], sp.center[2]);
        desc = R.ColliderDesc.cylinder(sp.halfHeight, sp.radius).setTranslation(wx, sp.center[1], wz);
      } else {
        const pts = new Float32Array(sp.points.length);
        for (let i = 0; i < sp.points.length; i += 3) { const [wx, wz] = toWorld(sp.points[i], sp.points[i + 2]); pts[i] = wx; pts[i + 1] = sp.points[i + 1]; pts[i + 2] = wz; }
        desc = R.ColliderDesc.convexHull(pts);
      }
      if (desc) engine.physics.tag(world.createCollider(desc.setCollisionGroups(g).setFriction(0.6), body), { surface: 'concrete', tag: `landmark:${def.id}` });
    }
  }
  return footprints;
}

/**
 * Central Beijing from OpenStreetMap: 天安门 to 国贸, 故宫 to 天坛. Ground and colliders, the
 * streamed tiles, the far skyline, the landmarks, and the street-name lookup for the HUD.
 */
export async function install(engine: Engine): Promise<void> {
  const { scene, physics } = engine;
  const render = engine.get<RenderApi>('render');
  const env: EnvUniforms = render?.uniforms ?? { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };
  // The tile workers first: their module fetch is 42 KB the boot cannot finish without, and it must
  // go out before the facade photos below take the connection for the next minute (see Streamer).
  const tileWorkers = spawnTileWorkers();
  const [manifest, network, skyline, mats, defs] = await Promise.all([
    loadCity<Manifest>('manifest.json'), loadCity<Network>('network.json'), loadCity<Skyline>('skyline.json'),
    createCityMaterials(engine, env), loadLandmarks(),
  ]);
  const b = manifest.bounds;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;

  // Ground: one collider at road level, one plane of paving with metre UVs.
  const R = physics.R;
  const ground = physics.world.createCollider(R.ColliderDesc.cuboid(14000, 1, 14000).setTranslation(cx, -0.97, cz).setFriction(0.95)
    .setCollisionGroups(groups(CG.WORLD, CG.ALL)), physics.world.createRigidBody(R.RigidBodyDesc.fixed()));
  physics.tag(ground, { surface: 'asphalt' });
  const size = 26000;
  const pg = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const uv = pg.getAttribute('uv') as THREE.BufferAttribute, pos = pg.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  const groundMesh = new THREE.Mesh(pg, mats.ground);
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  scene.add(groundMesh);

  const footprints = placeLandmarks(engine, env, defs);
  const sky = new SkylineLod(skyline, env);
  sky.exclude(footprints);
  scene.add(sky.mesh);
  const streamer = new CityStreamer(engine, manifest, mats, env, footprints, tileWorkers);
  streamer.onDetailChange = (keys) => sky.setDetailed(keys);
  engine.add(streamer);
  const routes = new Routes(network);

  const sp = manifest.spawn;
  const hx = Math.sin(sp.yaw), hz = Math.cos(sp.yaw);
  await streamer.preload(sp.x, sp.z);
  const path = routes.ahead(sp.x, sp.z, hx, hz, 3500);

  const api: WorldApi & { manifest: Manifest; routes: Routes; streamer: CityStreamer } = {
    name: 'world',
    spawn: { x: sp.x, y: 0.03 + TAXI.wheelRadius + 0.08, z: sp.z, yaw: sp.yaw },
    attract: { path, closed: false, speed: 15, start: { x: sp.x, z: sp.z, yaw: sp.yaw } },
    placeName: (x, z) => routes.nameAt(x, z),
    preload: (x, z) => streamer.preload(x, z),
    manifest, routes, streamer,
  };
  engine.add(api);

  // ODbL attribution, always visible and out of the way.
  const credit = document.createElement('div');
  credit.textContent = manifest.attribution;
  credit.style.cssText = 'position:fixed;right:6px;bottom:2px;z-index:30;font:10px/1.4 system-ui,sans-serif;color:rgba(255,255,255,.55);pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.6)';
  document.body.appendChild(credit);
}
