import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { EnvUniforms } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import type { Manifest } from './Data';
import type { CityMaterials } from './Materials';
import type { TileResult } from './tileWorker';
import { TILE, tileOf } from './Geo';
import { treeGeometries, treeMaterials, lampGeometries } from './Vegetation';
import { furnitureGeometries, furnitureMaterials } from './visual/FurnitureGeo';
import type { Furniture } from './visual/StreetFurniture';

const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

interface Tile {
  key: string; ix: number; iz: number;
  group: THREE.Group;
  colVerts: Float32Array; colIdx: Uint32Array;
  trees: number[]; lamps: number[];
  body: RAPIER_NS.RigidBody | null;
  /** Tiles two or more away drop pavements and paint (a few pixels there): two draw calls each. */
  far: boolean;
}

/** Instanced pool fed by the loaded tiles: one draw call per part per type, rebuilt when the set changes. */
class InstancePool {
  readonly meshes: THREE.InstancedMesh[];
  constructor(parts: { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean; depth?: THREE.Material }[], private cap: number, scene: THREE.Scene, colours = false, name = 'pool') {
    this.meshes = parts.map(({ geo, mat, shadow, depth }, i) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.name = parts.length > 1 ? `${name}:${i}` : name;
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
      if (depth) m.customDepthMaterial = depth;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (colours) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      scene.add(m);
      return m;
    });
  }
  /**
   * `lists` are flat mat4 arrays (16 floats per instance), one per contributing tile; `colours` RGB
   * per instance. With `keep`, only instances whose position passes it are copied (distance LOD).
   */
  set(lists: Float32Array[], colours?: Float32Array[], keep?: (x: number, z: number) => boolean): void {
    let n = 0;
    for (const mesh of this.meshes) {
      const dst = mesh.instanceMatrix.array as Float32Array;
      const cdst = mesh.instanceColor?.array as Float32Array | undefined;
      n = 0;
      lists.forEach((l, li) => {
        const c = colours?.[li];
        if (keep) {
          for (let i = 0, k = 0; i < l.length && n < this.cap; i += 16, k += 3) {
            if (!keep(l[i + 12], l[i + 14])) continue;
            dst.set(l.subarray(i, i + 16), n * 16);
            if (cdst && c) cdst.set(c.subarray(k, k + 3), n * 3);
            n++;
          }
          return;
        }
        const take = Math.min(l.length / 16, this.cap - n);
        if (take <= 0) return;
        dst.set(take * 16 === l.length ? l : l.subarray(0, take * 16), n * 16);
        if (cdst && c) cdst.set(c.subarray(0, take * 3), n * 3);
        n += take;
      });
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * Streams the city around the camera. Tiles within `radius` are fetched and meshed in workers and
 * wrapped here (one tile per frame at most); tiles within `physRadius` of the focus also get their
 * static colliders (building walls as a trimesh, tree trunks and lamp posts as cylinders); trees
 * and lamps within `vegRadius` feed the shared instanced pools.
 */
export class CityStreamer implements System {
  name = 'cityStreamer';
  readonly focus = new THREE.Vector3();
  private tiles = new Map<string, Tile>();
  private inflight = new Map<string, number>();
  private done: TileResult[] = [];
  private workers: Worker[] = [];
  private rr = 0;
  private waiters: (() => void)[] = [];
  private radius: number;
  private vegRadius: number;
  private physRadius = 1;
  private treeLists = new Map<string, { m: Float32Array[]; c: Float32Array[] }>();
  private lampLists = new Map<string, Float32Array>();
  private furnLists = new Map<string, { rail: Float32Array; railC: Float32Array; shelter: Float32Array; bin: Float32Array; bike: Float32Array; bikeC: Float32Array }>();
  private railPool: InstancePool;
  private shelterPool: InstancePool;
  private binPool: InstancePool;
  private bikePool: InstancePool;
  private vegKey = '';
  private treeNear: InstancePool[];
  private treeMid: InstancePool[];
  private treeFar: InstancePool[];
  /** Distance LOD bands (m from the focus): shadow-casting detail, and the mid band. */
  private nearD: number;
  private midD: number;
  private vegAt = new THREE.Vector3(1e9, 0, 1e9);
  private lampNear: InstancePool;
  private lampHeads!: InstancePool;
  private lampPool: InstancePool;
  private lampHead: THREE.MeshStandardMaterial;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _p = new THREE.Vector3(); private _s = new THREE.Vector3();
  onDetailChange?: (keys: Set<string>) => void;

  constructor(private engine: Engine, private manifest: Manifest, private mats: CityMaterials, private env: EnvUniforms, private footprints: number[][]) {
    const tier = engine.quality.tier;
    this.radius = tier === 'low' ? 2 : tier === 'medium' ? 3 : 4;
    this.vegRadius = tier === 'low' ? 1 : tier === 'medium' ? 2 : 3;
    const n = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<TileResult>) => this.done.push(ev.data);
      this.workers.push(w);
    }
    const scene = engine.scene;
    // Trees by distance from the focus: full crowns that cast shadows close by, then fewer and
    // bigger cards without shadows. InstancedMeshes are not culled per instance, and every casting
    // pool is drawn whole into each shadow cascade, so only the near band casts.
    const tg = treeGeometries(tier), tm = treeMaterials(env, tier);
    const low = tier === 'low';
    this.nearD = low ? 70 : 110; this.midD = low ? 1e9 : 320;
    this.treeNear = tg.near.map((geo) => new InstancePool([{ geo, mat: tm.mat, shadow: true, depth: tm.depth }], low ? 1500 : 3000, scene, true, 'pool:tree-near'));
    this.treeMid = tg.mid.map((geo) => new InstancePool([{ geo, mat: tm.mat, shadow: false }], low ? 4000 : 8000, scene, true, 'pool:tree-mid'));
    this.treeFar = tg.far.map((geo) => new InstancePool([{ geo, mat: tm.mat, shadow: false }], low ? 1 : 16000, scene, true, 'pool:tree-far'));
    // Street furniture: railings and shelters on the tiles within two of the focus, bins and bikes on the nearest nine.
    const fg = furnitureGeometries(), fm = furnitureMaterials(env);
    this.railPool = new InstancePool([{ geo: fg.rail, mat: fm.rail, shadow: false, depth: fm.railDepth }], low ? 2500 : 6000, scene, true, 'pool:furn-rail');
    this.shelterPool = new InstancePool([{ geo: fg.shelter, mat: fm.props, shadow: true }], 400, scene, false, 'pool:furn-shelter');
    this.binPool = new InstancePool([{ geo: fg.bin, mat: fm.props, shadow: true }], low ? 300 : 800, scene, false, 'pool:furn-bin');
    this.bikePool = new InstancePool([{ geo: fg.bike, mat: fm.props, shadow: true }], low ? 400 : 1500, scene, true, 'pool:furn-bike');
    const lg = lampGeometries();
    queueMicrotask(() => this.engine.get<RenderSystem>('render')?.prepare?.(scene));
    this.lampHead = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffcf8a', emissiveIntensity: 0.1, roughness: 0.4 });
    const postMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });
    postMat.userData.wet = 'surface';
    this.lampPool = new InstancePool([{ geo: lg.post, mat: postMat, shadow: false }], tier === 'low' ? 600 : 1000, scene, false, 'pool:lamp');
    this.lampHeads = new InstancePool([{ geo: lg.head, mat: this.lampHead, shadow: false }], tier === 'low' ? 600 : 1500, scene, false, 'pool:lamp-head');
    this.lampNear = new InstancePool([{ geo: lg.post, mat: postMat, shadow: true }], 200, scene, false, 'pool:lamp-near');
  }

  /** Tiles drawn in detail right now. */
  get loadedKeys(): Set<string> { return new Set(this.tiles.keys()); }

  private wanted(): string[] {
    const [fx, fz] = tileOf(this.focus.x, this.focus.z);
    const out: { k: string; d: number }[] = [];
    const r = this.radius;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dz * dz;
      if (d > (r + 0.5) * (r + 0.5)) continue;
      const k = `${fx + dx}_${fz + dz}`;
      if (this.manifest.tiles[k]) out.push({ k, d });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.k);
  }

  private request(k: string): void {
    if (this.tiles.has(k) || this.inflight.has(k)) return;
    const w = this.workers[this.rr++ % this.workers.length];
    this.inflight.set(k, performance.now());
    w.postMessage({ key: k, url: new URL(`${BASE}city/t_${k}.json`, location.href).href, footprints: this.footprints });
  }

  private build(res: TileResult): void {
    this.inflight.delete(res.key);
    if (res.error || !res.geoms) { console.warn('[city] tile', res.key, res.error); return; }
    const [ix, iz] = res.key.split('_').map(Number);
    const group = new THREE.Group();
    group.name = `tile ${res.key}`;
    for (const pg of res.geoms) {
      const g = new THREE.BufferGeometry();
      for (const a of pg.attrs) g.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize));
      if (pg.index) g.setIndex(new THREE.BufferAttribute(pg.index, 1));
      g.computeBoundingSphere();
      const [kind, sub] = pg.name.split(':');
      const m = this.mats;
      const mat = kind === 'area' ? m.areas[sub as keyof CityMaterials['areas']] : (m as unknown as Record<string, THREE.Material>)[kind];
      if (!mat) { g.dispose(); continue; }
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = pg.name;
      mesh.receiveShadow = true;
      // One shadow caster per tile: the buildings (roofs and roof clutter are in the same mesh).
      mesh.castShadow = kind === 'facade';
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    group.matrixAutoUpdate = false;
    // Patch the materials for shadow cascades / wetness now, not up to 30 frames later.
    this.engine.get<RenderSystem>('render')?.prepare?.(group);
    this.engine.scene.add(group);
    const t: Tile = { key: res.key, ix, iz, group, colVerts: res.colVerts!, colIdx: res.colIdx!, trees: res.trees ?? [], lamps: res.lamps ?? [], body: null, far: false };
    this.tiles.set(res.key, t);
    this.treeLists.set(res.key, this.treeMatrices(t.trees));
    this.lampLists.set(res.key, this.lampMatrices(t.lamps));
    this.furnLists.set(res.key, this.furnMatrices(res.furniture));
    this.onDetailChange?.(this.loadedKeys);
  }

  private treeMatrices(trees: number[]): { m: Float32Array[]; c: Float32Array[] } {
    const per: number[][] = [[], [], [], []], col: number[][] = [[], [], [], []];
    const c = new THREE.Color();
    for (let i = 0; i < trees.length; i += 4) {
      const x = trees[i], z = trees[i + 1], type = trees[i + 2], s = trees[i + 3];
      const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1, h2 = Math.abs(Math.sin(x * 4.1 + z * 9.7) * 23421.631) % 1;
      this._m.compose(this._p.set(x, 0, z), this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * 6.283), this._s.set(s, s * (0.88 + 0.24 * h2), s));
      if (!per[type]) continue;
      per[type].push(...this._m.elements);
      // Per-tree tint: a little lighter/darker, a little yellower/bluer.
      c.setRGB(0.9 + 0.2 * h2, 0.92 + 0.16 * h, 0.86 + 0.2 * ((h + h2) % 1));
      col[type].push(c.r, c.g, c.b);
    }
    return { m: per.map((l) => new Float32Array(l)), c: col.map((l) => new Float32Array(l)) };
  }

  private furnMatrices(f?: Furniture): { rail: Float32Array; railC: Float32Array; shelter: Float32Array; bin: Float32Array; bike: Float32Array; bikeC: Float32Array } {
    const up = new THREE.Vector3(0, 1, 0);
    const mats = (a: number[] | undefined, stride: number) => {
      const out = new Float32Array(((a?.length ?? 0) / stride) * 16);
      for (let i = 0, k = 0; a && i < a.length; i += stride, k += 16) {
        this._m.compose(this._p.set(a[i], a[i + 1], a[i + 2]), this._q.setFromAxisAngle(up, a[i + 3]), this._s.set(1, 1, 1));
        out.set(this._m.elements, k);
      }
      return out;
    };
    const cols = (a: number[] | undefined, stride: number, pal: number[][]) => {
      const out = new Float32Array(((a?.length ?? 0) / stride) * 3);
      for (let i = 0, k = 0; a && i < a.length; i += stride, k += 3) out.set(pal[a[i + 4]] ?? pal[0], k);
      return out;
    };
    return {
      rail: mats(f?.rail, 5), railC: cols(f?.rail, 5, [[1, 1, 1], [0.86, 0.93, 1]]),
      shelter: mats(f?.shelter, 4), bin: mats(f?.bin, 4),
      bike: mats(f?.bike, 5), bikeC: cols(f?.bike, 5, [[0.98, 0.74, 0.08], [0.16, 0.5, 0.92], [0.28, 0.72, 0.36]]),
    };
  }

  private lampMatrices(lamps: number[]): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < lamps.length; i += 3) {
      this._m.compose(this._p.set(lamps[i], 0, lamps[i + 1]), this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), lamps[i + 2]), this._s.set(1, 1, 1));
      out.push(...this._m.elements);
    }
    return new Float32Array(out);
  }

  private unload(t: Tile): void {
    this.engine.scene.remove(t.group);
    t.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.dropBody(t);
    this.tiles.delete(t.key);
    this.treeLists.delete(t.key);
    this.lampLists.delete(t.key);
    this.furnLists.delete(t.key);
    this.onDetailChange?.(this.loadedKeys);
  }

  private addBody(t: Tile): void {
    const { R, world } = this.engine.physics;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const g = groups(CG.WORLD, CG.ALL);
    if (t.colIdx.length) {
      const c = world.createCollider(R.ColliderDesc.trimesh(t.colVerts, t.colIdx).setCollisionGroups(g).setFriction(0.4), body);
      this.engine.physics.tag(c, { surface: 'concrete', tag: 'building' });
    }
    for (let i = 0; i < t.trees.length; i += 4) {
      const c = world.createCollider(R.ColliderDesc.cylinder(1.6, 0.24).setTranslation(t.trees[i], 1.6, t.trees[i + 1]).setCollisionGroups(g).setFriction(0.6), body);
      this.engine.physics.tag(c, { surface: 'concrete', tag: 'tree' });
    }
    for (let i = 0; i < t.lamps.length; i += 3) {
      const c = world.createCollider(R.ColliderDesc.cylinder(3.5, 0.14).setTranslation(t.lamps[i], 3.5, t.lamps[i + 1]).setCollisionGroups(g), body);
      this.engine.physics.tag(c, { surface: 'metal', tag: 'lamp' });
    }
    t.body = body;
  }

  private dropBody(t: Tile): void {
    if (!t.body) return;
    for (let i = 0; i < t.body.numColliders(); i++) this.engine.physics.untag(t.body.collider(i));
    this.engine.physics.world.removeRigidBody(t.body);
    t.body = null;
  }

  update(): void {
    const cam = this.engine.camera.position;
    this.focus.set(cam.x, 0, cam.z);
    const want = this.wanted();
    for (const k of want) this.request(k);
    // Build at most one finished tile per frame, nearest first.
    if (this.done.length) {
      const [fx, fz] = tileOf(this.focus.x, this.focus.z);
      this.done.sort((a, b) => dist(a.key, fx, fz) - dist(b.key, fx, fz));
      this.build(this.done.shift()!);
    }
    // Unload beyond radius + 1.
    const [fx, fz] = tileOf(this.focus.x, this.focus.z);
    for (const t of this.tiles.values()) {
      const d = Math.max(Math.abs(t.ix - fx), Math.abs(t.iz - fz));
      const far = d >= 2;
      if (far !== t.far) { t.far = far; for (const o of t.group.children) if (o.name === 'paint' || o.name === 'sidewalk') o.visible = !far; }
      if (d > this.radius + 1) this.unload(t);
      else if (d <= this.physRadius && !t.body) this.addBody(t);
      else if (d > this.physRadius + 1 && t.body) this.dropBody(t);
    }
    // Vegetation and lamps from the tiles near the focus: full trees on the 3x3 tiles around it.
    const vk: string[] = [], near: string[] = [], far: string[] = [], mid: string[] = [];
    for (const t of this.tiles.values()) {
      const d = Math.max(Math.abs(t.ix - fx), Math.abs(t.iz - fz));
      if (d > this.vegRadius) continue;
      vk.push(t.key);
      (d <= 1 ? near : far).push(t.key);
      if (d <= 2) mid.push(t.key);
    }
    vk.sort(); near.sort(); far.sort(); mid.sort();
    const key = vk.join('|');
    const moved = Math.hypot(this.focus.x - this.vegAt.x, this.focus.z - this.vegAt.z) > 20;
    if (key !== this.vegKey || moved) {
      this.vegKey = key;
      this.vegAt.copy(this.focus);
      const ox = this.focus.x, oz = this.focus.z, n2 = this.nearD * this.nearD, m2 = this.midD * this.midD;
      const d2 = (x: number, z: number) => (x - ox) * (x - ox) + (z - oz) * (z - oz);
      const isNear = (x: number, z: number) => d2(x, z) < n2;
      const isMid = (x: number, z: number) => { const d = d2(x, z); return d >= n2 && d < m2; };
      const isFar = (x: number, z: number) => d2(x, z) >= m2;
      const T = (k: string) => this.treeLists.get(k)!;
      const fill = (pools: InstancePool[], keys: string[], keep: (x: number, z: number) => boolean) => pools.forEach((pool, type) => pool.set(keys.map((k) => T(k).m[type]), keys.map((k) => T(k).c[type]), keep));
      fill(this.treeNear, near, isNear);
      fill(this.treeMid, vk, isMid);
      fill(this.treeFar, vk, isFar);
      this.lampPool.set(mid.map((k) => this.lampLists.get(k)!), undefined, (x, z) => !isNear(x, z));
      this.lampHeads.set(vk.map((k) => this.lampLists.get(k)!));
      this.lampNear.set(near.map((k) => this.lampLists.get(k)!), undefined, isNear);
      const F = (k: string) => this.furnLists.get(k)!;
      const within = (r: number) => (x: number, z: number) => d2(x, z) < r * r;
      this.railPool.set(mid.map((k) => F(k).rail), mid.map((k) => F(k).railC), within(360));
      this.shelterPool.set(mid.map((k) => F(k).shelter), undefined, within(420));
      this.binPool.set(near.map((k) => F(k).bin), undefined, within(150));
      this.bikePool.set(near.map((k) => F(k).bike), near.map((k) => F(k).bikeC), within(170));
    }
    this.lampHead.emissiveIntensity = 0.1 + 7 * this.env.uNight.value;
    if (this.waiters.length && want.every((k) => this.tiles.has(k) || !this.manifest.tiles[k])) {
      const w = this.waiters; this.waiters = []; for (const f of w) f();
    }
  }

  /**
   * Load everything around (x, z) now (spawn, shots): keeps pumping worker results until every
   * wanted tile is built, then adds colliders around the point.
   */
  async preload(x: number, z: number): Promise<void> {
    this.focus.set(x, 0, z);
    const cam = this.engine.camera.position;
    const saved = cam.clone();
    cam.set(x, cam.y, z);
    const want = this.wanted();
    for (const k of want) this.request(k);
    const t0 = performance.now();
    while (want.some((k) => !this.tiles.has(k)) && performance.now() - t0 < 60000) {
      await new Promise((r) => setTimeout(r, 16));
      while (this.done.length) this.build(this.done.shift()!);
    }
    const [fx, fz] = tileOf(x, z);
    for (const t of this.tiles.values()) if (Math.max(Math.abs(t.ix - fx), Math.abs(t.iz - fz)) <= this.physRadius && !t.body) this.addBody(t);
    cam.copy(saved);
    this.vegKey = '';
    this.focus.set(x, 0, z);
    const camNow = this.engine.camera.position; const back = camNow.clone(); camNow.set(x, camNow.y, z); this.update(); camNow.copy(back);
  }
}

const dist = (key: string, fx: number, fz: number) => { const [ix, iz] = key.split('_').map(Number); return (ix - fx) ** 2 + (iz - fz) ** 2; };
export { TILE };
