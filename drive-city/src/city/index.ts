import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { EnvUniforms, LandmarkDef, LandmarkModel, RenderApi, WorldApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { TAXI } from '../vehicle/Spec';
import { loadCity, type Manifest, type Network, type Skyline } from './Data';
import { project } from './Geo';
import { createCityMaterials } from './Materials';
import { Routes } from './Routes';
import { findDeadEnds } from './DeadEnds';
import { carStops } from './landmarks/CarStops';
import { placeDeadEndSigns } from './visual/DeadEndSigns';
import { SkylineLod } from './Skyline';
import { CityStreamer, spawnTileWorkers } from './Streamer';
import { undergroundHoles } from '../underground/Layout';
import { shortcutClear } from '../stunts/Structures';
import { SHORTCUTS } from '../stunts/spots';

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

/**
 * Landmarks at their OSM anchors, with colliders; returns their footprints and clear zones in world
 * XZ (flat), and a promise for the ones that load later (glb, see LandmarkDef.load). `?glb=0` leaves
 * the imported glb landmarks out altogether.
 *
 * The glb downloads wait for `gate` (the spawn's tiles) and then go nearest `from` first, two at a
 * time: fetched all at once at boot, 11 MB of them shared GitHub Pages' one HTTP/2 connection with
 * the tiles, textures and scripts the boot needs, and the live game took 166 s to become playable
 * instead of 48 (`.scratch/boottime.mjs`).
 */
function placeLandmarks(engine: Engine, env: EnvUniforms, defs: LandmarkDef[], gate: Promise<void>, from: [number, number]): { footprints: number[][]; clear: number[][]; loaded: Promise<void> } {
  /** ?nostone skips the walkable stone colliders (for measuring what they cost). */
  const params = new URLSearchParams(location.search);
  const noStone = params.has('nostone');
  if (params.get('glb') === '0') defs = defs.filter((d) => !d.load);
  const { R, world } = engine.physics;
  const footprints: number[][] = [], clear: number[][] = [];
  const jobs: { d: number; run: () => Promise<void> }[] = [];
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL);
  /** Same world geometry, but invisible to cars: see ColliderSpec.walkOnly. */
  const gWalk = groups(CG.WORLD, CG.ALL & ~CG.CAR);
  /** Only vehicles meet it: see ColliderSpec.carOnly and CarStops.ts. */
  const gCar = groups(CG.WORLD, CG.CAR);
  const place = (def: LandmarkDef, model: LandmarkModel) => {
    const [x, z] = project(def.lat, def.lon);
    const rot = -def.headingDeg * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const toWorld = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    model.group.position.set(x, 0, z);
    model.group.rotation.y = rot;
    model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model.group.name = `landmark ${def.id}`;
    engine.scene.add(model.group);
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
    for (const sp of [...model.colliders, ...carStops(model.colliders)]) {
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
        desc = sp.kind === 'trimesh' ? R.ColliderDesc.trimesh(pts, Uint32Array.from(sp.indices)) : R.ColliderDesc.convexHull(pts);
      }
      if (desc) engine.physics.tag(world.createCollider(desc.setCollisionGroups(sp.walkOnly ? gWalk : sp.carOnly ? gCar : g).setFriction(0.6), body), { surface: 'concrete', tag: `landmark:${def.id}` });
    }
  };
  for (const def of defs) {
    let model;
    try { model = def.build(env); } catch (e) { console.warn('[city] landmark', def.id, e); continue; }
    const [x, z] = project(def.lat, def.lon);
    const rot = -def.headingDeg * Math.PI / 180;
    const c = Math.cos(rot), s = Math.sin(rot);
    const toWorld = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    for (const f of [model.footprint, ...(model.moreFootprints ?? [])]) footprints.push(f.flatMap(([lx, lz]) => toWorld(lx, lz)));
    for (const zone of model.clear ?? []) clear.push(zone.flatMap(([lx, lz]) => toWorld(lx, lz)));
    place(def, model);
    // A glb: the boot has what it needs (the footprint); the model and its colliders come when loaded.
    if (def.load) {
      const placeholder = model.group, load = def.load;
      jobs.push({
        d: Math.hypot(x - from[0], z - from[1]),
        run: () => load(env).then((m) => {
          engine.get<RenderSystem>('render')?.prepare?.(m.group);
          engine.scene.remove(placeholder);
          place(def, m);
        }).catch((e) => console.warn('[city] landmark', def.id, 'did not load', e)),
      });
    }
  }
  jobs.sort((a, b) => a.d - b.d);
  const worker = async () => { for (let j = jobs.shift(); j; j = jobs.shift()) await j.run(); };
  const loaded = gate.then(() => Promise.all([worker(), worker()])).then(() => {});
  return { footprints, clear, loaded };
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

  // Ground: one collider at road level, one plane of paving with metre UVs - both with a hole where
  // the underground car park goes down (underground/): the collider round the whole car park (its
  // own floors and roof slab take over), the plane round its open ramp only (the roof slab is
  // street, drawn by this plane).
  const R = physics.R;
  const gbody = physics.world.createRigidBody(R.RigidBodyDesc.fixed());
  const size = 26000, E = size / 2;
  const hole = undergroundHoles();
  const slabs: [number, number, number, number][] = hole
    ? [[cx - E, cz - E, hole.all.x0, cz + E], [hole.all.x1, cz - E, cx + E, cz + E], [hole.all.x0, cz - E, hole.all.x1, hole.all.z0], [hole.all.x0, hole.all.z1, hole.all.x1, cz + E]]
    : [[cx - E, cz - E, cx + E, cz + E]];
  for (const [x0, z0, x1, z1] of slabs) {
    const ground = physics.world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2, 1, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, -0.97, (z0 + z1) / 2).setFriction(0.95)
      .setCollisionGroups(groups(CG.WORLD, CG.ALL)), gbody);
    physics.tag(ground, { surface: 'asphalt' });
  }
  let pg: THREE.BufferGeometry;
  if (hole) {
    // Shape space is (x, y) facing +z; laid down with rotateX(-90°) its y becomes -z and it faces up,
    // so the outline and the hole are given as (x, -z).
    const v = (x: number, z: number) => new THREE.Vector2(x, -z);
    const shape = new THREE.Shape([v(cx - E, cz - E), v(cx + E, cz - E), v(cx + E, cz + E), v(cx - E, cz + E)]);
    const o = hole.open;
    shape.holes.push(new THREE.Path([v(o.x0, o.z0), v(o.x0, o.z1), v(o.x1, o.z1), v(o.x1, o.z0)]));
    pg = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  } else pg = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const uv = pg.getAttribute('uv') as THREE.BufferAttribute, pos = pg.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  const groundMesh = new THREE.Mesh(pg, mats.ground);
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  scene.add(groundMesh);

  // The spawn's tiles first; the glb landmarks and the Blender trees download after them.
  let openGate = () => {};
  const bootDone = new Promise<void>((r) => { openGate = r; });
  const { footprints, clear, loaded: landmarksLoaded } = placeLandmarks(engine, env, defs, bootDone, [manifest.spawn.x, manifest.spawn.z]);
  clear.push(...shortcutClear(SHORTCUTS));
  const sky = new SkylineLod(skyline, env);
  sky.exclude(footprints);
  scene.add(sky.mesh);
  const streamer = new CityStreamer(engine, manifest, mats, env, footprints, tileWorkers, clear);
  streamer.onDetailChange = (keys) => sky.setDetailed(keys);
  engine.add(streamer);
  engine.add(streamer.knocks);
  const routes = new Routes(network);
  // 此路不通 at the mouth of every dead-end branch (「我把车开到了故宫，发现进了死胡同，开不出去了」).
  placeDeadEndSigns(engine, network, findDeadEnds(network, manifest.bounds), env);

  const sp = manifest.spawn;
  const hx = Math.sin(sp.yaw), hz = Math.cos(sp.yaw);
  await streamer.preload(sp.x, sp.z);
  openGate();
  streamer.loadTrees();
  const path = routes.ahead(sp.x, sp.z, hx, hz, 3500);

  const api: WorldApi & { manifest: Manifest; routes: Routes; streamer: CityStreamer; landmarksLoaded: Promise<void> } = {
    name: 'world',
    /** Resolves once every glb landmark is in (probes and shots of one wait on it). */
    landmarksLoaded,
    spawn: { x: sp.x, y: 0.03 + TAXI.wheelRadius + 0.08, z: sp.z, yaw: sp.yaw },
    attract: { path, closed: false, speed: 15, start: { x: sp.x, z: sp.z, yaw: sp.yaw } },
    placeName: (x, z) => routes.nameAt(x, z),
    preload: (x, z) => streamer.preload(x, z),
    sharedBike: (x, z, r) => streamer.knocks.nearestBike(x, z, r),
    takeSharedBike: (b) => streamer.knocks.hide('bike', b.x, b.z),
    manifest, routes, streamer,
  };
  engine.add(api);

  // ODbL attribution, always visible and out of the way.
  const credit = document.createElement('div');
  credit.textContent = manifest.attribution;
  credit.style.cssText = 'position:fixed;right:6px;bottom:2px;z-index:30;font:10px/1.4 system-ui,sans-serif;color:rgba(255,255,255,.55);pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.6)';
  document.body.appendChild(credit);
}
