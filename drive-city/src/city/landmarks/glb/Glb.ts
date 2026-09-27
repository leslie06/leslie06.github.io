import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../../game/Contracts';
import { LANDMARK_LIGHTS } from '../kit/mats';
import { FAR_LOD_DISTANCE } from '../kit/model';

/**
 * Landmarks authored in Blender. `node scripts/landmarks/import.mjs model.glb --id ...` optimises the
 * glb into public/models/landmarks/<id>.glb and writes <id>.meta.json beside this file, and
 * landmarks/index.ts registers every meta it finds. The boot needs only the meta (footprint, clear
 * zones, height: the tiles drop the OSM buildings under it); the glb loads in the background and the
 * city places it with its colliders when it arrives.
 *
 * Blender conventions (object names, or the name of any parent empty or collection - the export
 * writes collections as nodes; case does not matter). scripts/blender/bcity_landmark is an add-on
 * that sets all of this up and exports straight into the game:
 *   - Axes: Blender +X east, +Y north, +Z up, metres, origin at the anchor on the ground.
 *   - `COL_*`      solid collider, not drawn. A box with only a yaw becomes a box, anything else its convex hull.
 *   - `WALK_*`     like COL_, but only people collide with it: stair ramps (a ramp you can walk up, a car can drive up).
 *   - `COLMESH_*`  concave collider from its triangles (a terrace, a sunken court), not drawn.
 *   - `LOD1_*`     the far level, drawn past `farDistance`. Without one the far level reuses the detail.
 *   - `LOD0_*`     detail only (unmarked objects are detail too).
 *   - `FOOTPRINT`, `CLEAR_*`  read by the import script only (footprint, ground kept free of street furniture).
 * Material custom properties (exported as glTF extras, "Include > Custom Properties"):
 *   - `wet`  "surface" (default: glass, glaze, paint) | "ground" (puddles on flat tops) | "damp" | "none"
 *   - `glow` "flood" (default: floodlit at night like every landmark - brightest at the foot of a wall
 *     and under eaves, fading up it, roofs darkest; kit/geo.ts floodGlow's shape) | "lamp" (self-lit) | "none"
 *   - `glowStrength` scales either (default 1)
 *   - `glowColor` "#rrggbb", or [r, g, b] linear (a Blender colour property; flood default warm #ffcf94)
 *   - `emit` "night": Blender emission shows at night only (lit windows); otherwise it shows all day.
 *   - `layer` N: depth layering against the city's ground (city/Materials.ts `layer`: plaza 4, road 5,
 *     paint 7): anything flat within a metre of the ground needs one above them, or at a grazing angle
 *     their polygon offset draws the paving over it (the flower basket's parterre at 0.3 m, 70 m away).
 * Visible meshes are merged per material into one draw call per level; a mesh linked (Alt+D) six
 * or more times becomes one InstancedMesh.
 */
export interface GlbMeta {
  id: string;
  name: { zh: string; en: string };
  lat: number; lon: number; headingDeg: number;
  /** File under public/models/landmarks/ and a content hash for the cache. */
  file: string; version: string;
  footprint: [number, number][];
  clear?: [number, number][][];
  height: number;
  farDistance?: number;
  stats?: Record<string, unknown>;
}

// Keep in step with scripts/landmarks/lib.mjs. GLTFLoader strips '.' from names ("COL.001" -> "COL001");
// the script sees them raw. "COLUMN" is not a collider.
const SEP = '(?:[_\\-.\\s\\d]|$)';
const RE = {
  mesh: new RegExp(`^COLMESH${SEP}`, 'i'),
  solid: new RegExp(`^COL${SEP}`, 'i'),
  walk: new RegExp(`^WALK${SEP}`, 'i'),
  skip: new RegExp(`^(?:FOOTPRINT|CLEAR)${SEP}`, 'i'),
  far: new RegExp(`^LOD1${SEP}`, 'i'),
  near: new RegExp(`^LOD0${SEP}`, 'i'),
};
export type Role = 'detail' | 'near' | 'far' | 'solid' | 'walk' | 'mesh' | 'skip';

/** What an object is, from its own name or the nearest marked ancestor below `root`. Colliders win over levels. */
export function roleOf(o: THREE.Object3D, root: THREE.Object3D): Role {
  let level: Role | null = null;
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) {
    const n = p.name;
    if (RE.mesh.test(n)) return 'mesh';
    if (RE.solid.test(n)) return 'solid';
    if (RE.walk.test(n)) return 'walk';
    if (RE.skip.test(n)) return 'skip';
    if (!level && RE.far.test(n)) level = 'far';
    if (!level && RE.near.test(n)) level = 'near';
  }
  return level ?? 'detail';
}

const _v = new THREE.Vector3();

/** Every vertex of `mesh` in the root's frame (quantized attributes are decoded by getX). */
function worldPoints(mesh: THREE.Mesh): number[] {
  const pos = mesh.geometry.getAttribute('position');
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    out.push(_v.x, _v.y, _v.z);
  }
  return out;
}

/** A box with only a yaw (any scale) as a box collider, else null. */
export function boxOf(mesh: THREE.Mesh): Extract<ColliderSpec, { kind: 'box' }> | null {
  const geo = mesh.geometry, pos = geo.getAttribute('position');
  if (pos.count < 8) return null;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const eps = 2e-3 * Math.max(1, size.x, size.y, size.z);
  const corners = new Set<number>();
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    let code = 0;
    for (let k = 0; k < 3; k++) {
      const c = _v.getComponent(k), lo = bb.min.getComponent(k), hi = bb.max.getComponent(k);
      if (Math.abs(c - lo) < eps) continue;
      if (Math.abs(c - hi) < eps) { code |= 1 << k; continue; }
      return null;
    }
    corners.add(code);
  }
  if (corners.size !== 8) return null;
  const e = mesh.matrixWorld.elements;
  const ax = new THREE.Vector3(e[0], e[1], e[2]), ay = new THREE.Vector3(e[4], e[5], e[6]), az = new THREE.Vector3(e[8], e[9], e[10]);
  const sx = ax.length(), sy = ay.length(), sz = az.length();
  if (sx < 1e-6 || sy < 1e-6 || sz < 1e-6) return null;
  ax.divideScalar(sx); ay.divideScalar(sy); az.divideScalar(sz);
  // only a turn about +Y, no tilt or shear
  if (ay.y < 0.9995 || Math.abs(ax.y) > 1e-3 || Math.abs(az.y) > 1e-3 || Math.abs(ax.dot(az)) > 1e-3) return null;
  const center = bb.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    kind: 'box', center: [r(center.x), r(center.y), r(center.z)],
    half: [r(Math.max(0.01, size.x * sx / 2)), r(Math.max(0.01, size.y * sy / 2)), r(Math.max(0.01, size.z * sz / 2))],
    yaw: r(Math.atan2(-ax.z, ax.x)),
  };
}

/** The collider a marked mesh stands for, in the landmark's frame. */
export function colliderOf(mesh: THREE.Mesh, role: 'solid' | 'walk' | 'mesh'): ColliderSpec | null {
  const walkOnly = role === 'walk' ? true : undefined;
  if (role === 'mesh') {
    const points = worldPoints(mesh);
    const idx = mesh.geometry.getIndex();
    const indices = idx ? Array.from(idx.array as ArrayLike<number>) : Array.from({ length: points.length / 3 }, (_, i) => i);
    return indices.length >= 3 ? { kind: 'trimesh', points, indices, walkOnly } : null;
  }
  const box = boxOf(mesh);
  if (box) return walkOnly ? { ...box, walkOnly } : box;
  const points = worldPoints(mesh);
  return points.length >= 12 ? { kind: 'hull', points, walkOnly } : null;
}

/** A plain Float32, indexed copy with the mesh's world matrix baked in (merging needs matching arrays). */
function bake(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const n = a.count, k = a.itemSize, arr = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) arr[i * k + j] = a.getComponent(i, j);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  const idx = src.getIndex();
  const count = geo.getAttribute('position').count;
  const index = idx ? Uint32Array.from(idx.array as ArrayLike<number>) : Uint32Array.from({ length: count }, (_, i) => i);
  // a mirrored object (negative scale in Blender) turns its faces inside out once baked
  if (mesh.matrixWorld.determinant() < 0) for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.applyMatrix4(mesh.matrixWorld);
  return geo;
}

const INSTANCE_MIN = 6;

/** One draw call per material (and attribute layout), linked duplicates as instances. */
export function mergeLevel(meshes: THREE.Mesh[], name: string): THREE.Group {
  const out = new THREE.Group();
  out.name = name;
  // linked duplicates: the loader shares one geometry between the nodes that use one mesh
  const shared = new Map<string, THREE.Mesh[]>();
  for (const m of meshes) {
    if (Array.isArray(m.material) || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) continue;
    const key = m.geometry.uuid + '|' + m.material.uuid;
    let list = shared.get(key);
    if (!list) shared.set(key, list = []);
    list.push(m);
  }
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  for (const m of meshes) {
    if (Array.isArray(m.material) || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || Object.keys(m.geometry.morphAttributes).length) {
      // left as authored, placed in the landmark's frame
      const c = m.clone();
      m.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      out.add(c);
      continue;
    }
    const mat = m.material;
    const group = shared.get(m.geometry.uuid + '|' + mat.uuid)!;
    if (group.length >= INSTANCE_MIN) {
      if (group[0] !== m) continue;
      const inst = new THREE.InstancedMesh(m.geometry, mat, group.length);
      group.forEach((g, i) => inst.setMatrixAt(i, g.matrixWorld));
      inst.computeBoundingSphere();
      inst.name = `glb ${mat.name || 'material'} x${group.length}`;
      out.add(inst);
      continue;
    }
    const geo = bake(m);
    const key = mat.uuid + '|' + Object.keys(geo.attributes).sort().map((a) => a + geo.getAttribute(a).itemSize).join(',');
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { mat, geos: [] });
    b.geos.push(geo);
  }
  for (const { mat, geos } of buckets.values()) {
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    // not 'marble' etc.: placeLandmarks builds stone trimeshes by name, and glb colliders are explicit
    mesh.name = `glb ${mat.name || 'material'}`;
    out.add(mesh);
  }
  return out;
}

const patched = new WeakSet<THREE.Material>();
/** Floodlight weight: base, + under a soffit, - on a roof, + at the foot of a wall fading over footH m. */
const FLOOD_SHAPE = { base: 0.2, under: 0.6, top: 0.15, foot: 0.45, footH: 6 };
const FLOOD = '#ffcf94';

/** The game's night and rain looks, from the material's custom properties (glTF extras). */
export function prepareMaterial(mat: THREE.Material, env: EnvUniforms): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  const x = mat.userData as { wet?: string; glow?: string; glowColor?: string | number[]; glowStrength?: number; emit?: string; layer?: number };
  if (typeof x.layer === 'number' && x.layer > 0) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -x.layer;
    mat.polygonOffsetUnits = -x.layer;
  }
  const wet = x.wet ?? 'surface';
  if (wet === 'none') delete mat.userData.wet;
  else mat.userData.wet = wet === 'damp' ? true : wet;
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) if (std[k]) std[k]!.anisotropy = 8;
  const glow = x.glow === 'lamp' || x.glow === 'none' ? x.glow : 'flood';
  const night = x.emit === 'night';
  if (glow === 'none' && !night) return;
  const gc = x.glowColor;
  const col = Array.isArray(gc) ? new THREE.Color(gc[0] ?? 1, gc[1] ?? 1, gc[2] ?? 1) : new THREE.Color(gc ?? (glow === 'lamp' ? '#fff3dc' : FLOOD));
  const gain = glow === 'lamp' ? LANDMARK_LIGHTS.lamps : LANDMARK_LIGHTS.flood;
  const strength = typeof x.glowStrength === 'number' ? x.glowStrength : 1;
  const F = FLOOD_SHAPE;
  const hook = (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.uniforms.uNight = env.uNight;
    s.uniforms.uGlowGain = gain;
    s.uniforms.uGlowColor = { value: col };
    s.uniforms.uGlowStrength = { value: strength };
    if (glow === 'flood') {
      // the floodlight's weight per vertex from its world height and normal (kit/geo.ts floodGlow)
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vLmGlow;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 lmP = vec4(transformed, 1.0);
          vec3 lmN = objectNormal;
          #ifdef USE_INSTANCING
          lmP = instanceMatrix * lmP; lmN = mat3(instanceMatrix) * lmN;
          #endif
          lmP = modelMatrix * lmP; float ny = normalize(mat3(modelMatrix) * lmN).y;
          vLmGlow = max(0.08, ${F.base.toFixed(3)} + ${F.under.toFixed(3)} * max(0.0, -ny) - ${F.top.toFixed(3)} * max(0.0, ny)
            + ${F.foot.toFixed(3)} * exp(-max(0.0, lmP.y) / ${F.footH.toFixed(3)}) * (1.0 - abs(ny)));
        }`);
    }
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight;\nuniform float uGlowGain;\nuniform vec3 uGlowColor;\nuniform float uGlowStrength;${glow === 'flood' ? '\nvarying float vLmGlow;' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${night ? 'totalEmissiveRadiance *= uNight;' : ''}
      ${glow === 'none' ? '' : `totalEmissiveRadiance += uNight * uGlowGain * uGlowStrength * uGlowColor${glow === 'flood' ? ' * diffuseColor.rgb * vLmGlow' : ''};`}`);
  };
  mat.onBeforeCompile = hook;
  mat.userData.landmarkCompile = hook;
  mat.customProgramCacheKey = () => `lm-glb-${glow}-${night ? 'n' : 'd'}`;
}

/** A loaded glb scene as the contract's model: LOD 'lod' with 'detail' and 'far', colliders from the markers. */
export function buildGlbModel(scene: THREE.Object3D, env: EnvUniforms, meta: GlbMeta): LandmarkModel {
  scene.updateMatrixWorld(true);
  const detail: THREE.Mesh[] = [], far: THREE.Mesh[] = [], colliders: ColliderSpec[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const role = roleOf(mesh, scene);
    if (role === 'skip') return;
    if (role === 'solid' || role === 'walk' || role === 'mesh') {
      const c = colliderOf(mesh, role);
      if (c) colliders.push(c);
      return;
    }
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) prepareMaterial(m, env);
    (role === 'far' ? far : detail).push(mesh);
  });
  const d = mergeLevel(detail, 'detail');
  let f: THREE.Group;
  if (far.length) f = mergeLevel(far, 'far');
  else {
    // no LOD1: the far level draws the detail's geometry again (shared, not copied)
    f = new THREE.Group();
    f.name = 'far';
    for (const c of d.children) f.add((c as THREE.Mesh).clone());
  }
  const lod = new THREE.LOD();
  lod.name = 'lod';
  lod.addLevel(d, 0);
  lod.addLevel(f, meta.farDistance ?? FAR_LOD_DISTANCE);
  const group = new THREE.Group();
  group.name = meta.id;
  group.add(lod);
  const tris = (g: THREE.Group) => g.children.reduce((n, c) => {
    const geo = (c as THREE.Mesh).geometry;
    const t = (geo.getIndex()?.count ?? geo.getAttribute('position').count) / 3;
    return n + t * ((c as THREE.InstancedMesh).isInstancedMesh ? (c as THREE.InstancedMesh).count : 1);
  }, 0);
  group.userData.stats = { triangles: tris(d), drawCalls: d.children.length, farTriangles: tris(f), farDrawCalls: f.children.length };
  group.updateMatrixWorld(true);
  return { group, colliders, footprint: meta.footprint, clear: meta.clear, height: meta.height };
}

let loader: GLTFLoader | null = null;

/** The LandmarkDef for one imported glb: the meta at boot, the model when it has loaded. */
export function glbLandmark(meta: GlbMeta): LandmarkDef {
  const url = `${import.meta.env.BASE_URL}models/landmarks/${meta.file}?v=${meta.version}`;
  return {
    id: meta.id, name: meta.name, lat: meta.lat, lon: meta.lon, headingDeg: meta.headingDeg,
    build: () => {
      const group = new THREE.Group();
      group.name = meta.id;
      return { group, colliders: [], footprint: meta.footprint, clear: meta.clear, height: meta.height };
    },
    load: async (env) => {
      loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(url);
      return buildGlbModel(gltf.scene, env, meta);
    },
  };
}
