import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { EnvUniforms, RenderApi } from '../game/Contracts';
import type { CityStreamer } from '../city/Streamer';
import { heightAt, loadMountain, type MountainData } from './Data';
import { farHills, groundDetail, Terrain } from './Terrain';
import { buildRails, buildRoad, roadMaterials } from './Road';
import { PropBuilder } from './Props';

/**
 * West of the city (2026-10-22, 「做下一步出城路段和妙峰山山路」): 阜石路 runs off the edge of the data into 京拉路 (G109),
 * 2.5 km of valley past a petrol station and a village, and on up the top 9.5 km of 妙峰山路 - its real line and real
 * heights - to the 牌楼 at the top. Built by scripts/city/mountain.mjs (public/city/mountain.bin; the two roads are in the
 * network, so the GPS, the map and the lane graph know them). Fetched when the camera comes within `LOAD_R` of it
 * (0.9 MB), then: the ground (Terrain: levels of detail round the camera, one Rapier heightfield), the roads (banked
 * ribbons, trimesh colliders), guardrails, props and their boxes, the trees (handed to the city's streamer).
 *
 * `?mountain=0` leaves it out.
 */
export interface MountainApi extends System {
  readonly loaded: boolean;
  /** Ground height (m) at (x, z) in its grid, null outside it or before it has loaded. */
  heightAt(x: number, z: number): number | null;
  /** Start loading now (a mission heading there; probes). */
  load(): Promise<void>;
  readonly data: MountainData | null;
}

/** Distance from the grid's box at which it starts loading. */
const LOAD_R = 3500;
/** The grid's box (game metres), known before the data: scripts/city/mountain.mjs's terrain. */
const BOX = { x0: -21400, z0: -7600, x1: -17211, z1: -960 };

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('mountain') === '0') return;
  const world = engine.get('world') as unknown as { streamer?: CityStreamer; env?: EnvUniforms } | undefined;
  const streamer = world?.streamer;
  let data: MountainData | null = null;
  let terrain: Terrain | null = null;
  let loading: Promise<void> | null = null;
  const group = new THREE.Group();
  group.name = 'mountain';

  const prepare = (o: THREE.Object3D) => (engine.get('render') as unknown as { prepare?(o: THREE.Object3D): void } | undefined)?.prepare?.(o);
  const night = (engine.get('render') as unknown as { uniforms?: EnvUniforms } | undefined)?.uniforms?.uNight ?? { value: 0 };

  const build = (d: MountainData) => {
    const { R, world: pw } = engine.physics;
    const body = pw.createRigidBody(R.RigidBodyDesc.fixed());
    const g = groups(CG.WORLD, CG.ALL);
    // the ground: one heightfield (rows along z, columns along x, heights column by column)
    {
      const { nx, nz, x0, z0, cell } = d.grid;
      const hf = new Float32Array(nx * nz);
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) hf[j + i * nz] = d.h[j * nx + i];
      const sx = cell * (nx - 1), sz = cell * (nz - 1);
      const gb = pw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x0 + sx / 2, 0, z0 + sz / 2));
      engine.physics.tag(pw.createCollider(R.ColliderDesc.heightfield(nz - 1, nx - 1, hf, { x: sx, y: 1, z: sz }).setCollisionGroups(g).setFriction(0.9), gb), { surface: 'grass' });
    }
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: groundDetail() });
    groundMat.userData.wet = 'ground';
    terrain = new Terrain(d, groundMat, engine.quality.tier === 'low', (m) => prepare(m));
    group.add(terrain.group);
    // the far hills: their mesh, and a coarse heightfield (deep under the detailed ground, so it never meets it)
    group.add(farHills(d, groundMat));
    {
      let lowest = Infinity; for (let k = 0; k < d.h.length; k++) if (d.h[k] < lowest) lowest = d.h[k];
      const R2 = d.ring, deep = lowest - 60;
      const hf = new Float32Array(R2.nx * R2.nz);
      for (let i = 0; i < R2.nx; i++) for (let j = 0; j < R2.nz; j++) { const v = R2.h[j * R2.nx + i]; hf[j + i * R2.nz] = Number.isFinite(v) ? v : deep; }
      const sx = R2.cell * (R2.nx - 1), sz = R2.cell * (R2.nz - 1);
      const rb = pw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(R2.x0 + sx / 2, 0, R2.z0 + sz / 2));
      engine.physics.tag(pw.createCollider(R.ColliderDesc.heightfield(R2.nz - 1, R2.nx - 1, hf, { x: sx, y: 1, z: sz }).setCollisionGroups(g).setFriction(0.9), rb), { surface: 'grass' });
    }
    // the roads
    const mats = roadMaterials();
    for (const r of d.roads) for (const piece of buildRoad(r, d, mats)) {
      group.add(piece.mesh, piece.shoulder);
      engine.physics.tag(pw.createCollider(R.ColliderDesc.trimesh(piece.verts, piece.idx).setCollisionGroups(g).setFriction(0.95), body), { surface: 'asphalt' });
    }
    const rails = buildRails(d, mats);
    for (const m of rails.meshes) group.add(m);
    for (const w of rails.walls) if (w.idx.length) engine.physics.tag(pw.createCollider(R.ColliderDesc.trimesh(w.verts, w.idx).setCollisionGroups(g).setFriction(0.3), body), { surface: 'metal', tag: 'guardrail' });
    // the props
    const pb = new PropBuilder(d);
    pb.build();
    for (const m of pb.meshes(night)) group.add(m);
    const q = new THREE.Quaternion();
    for (const b of pb.boxes) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      engine.physics.tag(pw.createCollider(R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(g).setFriction(0.6), body), { surface: 'concrete' });
    }
    prepare(group);
    engine.scene.add(group);
    // the trees go to the city's pools
    // a wood, not street trees: a little darker (the far cards read pale against the light otherwise)
    streamer?.addTrees(d.trees, 0.74);
    terrain.update(engine.camera.position);
  };

  const load = (): Promise<void> => {
    loading ??= loadMountain().then((d) => { data = d; build(d); }).catch((e) => { console.warn('[mountain] did not load', e); loading = null; });
    return loading;
  };

  const api: MountainApi = {
    name: 'mountain',
    get loaded() { return !!data; },
    get data() { return data; },
    heightAt(x, z) {
      if (!data) return null;
      const { x0, z0, nx, nz, cell } = data.grid;
      if (x < x0 || z < z0 || x > x0 + (nx - 1) * cell || z > z0 + (nz - 1) * cell) return null;
      return heightAt(data, x, z);
    },
    load,
    update() {
      const c = engine.camera.position;
      if (!loading) {
        const dx = Math.max(BOX.x0 - c.x, 0, c.x - BOX.x1), dz = Math.max(BOX.z0 - c.z, 0, c.z - BOX.z1);
        if (Math.hypot(dx, dz) < LOAD_R) void load();
      }
      terrain?.update(c);
    },
  };
  void (engine.get<RenderApi>('render'));
  engine.add(api);
}
