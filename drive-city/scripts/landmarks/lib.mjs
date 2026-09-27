// Blender glb -> game landmark: inspection (footprint, height, stats, warnings) and optimisation.
// Used by scripts/landmarks/import.mjs and src/city/landmarks/glb/Glb.test.ts. The naming rules are
// documented in src/city/landmarks/glb/Glb.ts; keep ROLE in step with its `RE`.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const SEP = '(?:[_\\-.\\s\\d]|$)';
const ROLE = [
  ['mesh', new RegExp(`^COLMESH${SEP}`, 'i')],
  ['solid', new RegExp(`^COL${SEP}`, 'i')],
  ['walk', new RegExp(`^WALK${SEP}`, 'i')],
  ['footprint', new RegExp(`^FOOTPRINT${SEP}`, 'i')],
  ['clear', new RegExp(`^CLEAR${SEP}`, 'i')],
];
const FAR = new RegExp(`^LOD1${SEP}`, 'i'), NEAR = new RegExp(`^LOD0${SEP}`, 'i');

/** detail | near | far | solid | walk | mesh | footprint | clear, from the node or its nearest marked parent. */
export function roleOf(node) {
  let level = null;
  for (let p = node; p; p = p.getParentNode()) {
    const n = p.getName();
    for (const [role, re] of ROLE) if (re.test(n)) return role;
    if (!level && FAR.test(n)) level = 'far';
    if (!level && NEAR.test(n)) level = 'near';
  }
  return level ?? 'detail';
}

export async function createIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** Andrew's monotone chain; points [x, z]. */
export function hull2(pts) {
  const p = [...new Map(pts.map(([x, z]) => [`${x.toFixed(3)},${z.toFixed(3)}`, [x, z]])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cross(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

const area = (poly) => Math.abs(poly.reduce((s, [x, z], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
const r2 = (x) => Math.round(x * 100) / 100;

/** World-space vertices of a node's mesh (all primitives). */
function points(node) {
  const m = node.getWorldMatrix(), out = [], v = [0, 0, 0];
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      out.push([m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
    }
  }
  return out;
}

function triangles(mesh) {
  let n = 0;
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const idx = prim.getIndices();
    n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

/**
 * What the game needs to know before the model loads, and what the author should hear about.
 * `doc` is read straight from Blender's export (before optimise, which quantizes the vertices).
 */
export function inspect(doc) {
  const root = doc.getRoot();
  const nodes = root.listNodes().filter((n) => n.getMesh());
  const visible = [], footprintPts = [], pieces = [], clear = [], warnings = [], notes = [];
  const tris = { detail: 0, far: 0 }, colliders = { solid: 0, walk: 0, mesh: 0 };
  const mats = { detail: new Set(), far: new Set() }, meshUse = new Map();
  let minY = Infinity, maxY = -Infinity, hasFar = false;
  for (const node of nodes) {
    const role = roleOf(node), mesh = node.getMesh();
    if (role in colliders) { colliders[role]++; continue; }
    if (role === 'footprint') { const p = points(node).map(([x, , z]) => [x, z]); footprintPts.push(...p); pieces.push(hull2(p)); continue; }
    if (role === 'clear') { clear.push(hull2(points(node).map(([x, , z]) => [x, z])).map(([x, z]) => [r2(x), r2(z)])); continue; }
    const level = role === 'far' ? 'far' : 'detail';
    if (level === 'far') hasFar = true;
    tris[level] += triangles(mesh);
    for (const prim of mesh.listPrimitives()) mats[level].add(prim.getMaterial());
    meshUse.set(mesh, (meshUse.get(mesh) ?? 0) + 1);
    for (const p of points(node)) {
      if (level === 'detail') { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      visible.push([p[0], p[2]]);
    }
  }
  if (!visible.length) throw new Error('no visible meshes (everything is a collider or marker?)');
  // Several FOOTPRINT objects are pieces, each hulled on its own (天安门 and its reviewing stands): one
  // hull round all of them would take the buildings between them too. The largest is `footprint`.
  pieces.sort((a, b) => area(b) - area(a));
  const round = (poly) => poly.map(([x, z]) => [r2(x), r2(z)]);
  const footprint = round(pieces.length ? pieces[0] : hull2(visible));
  const moreFootprints = pieces.slice(1).map(round);
  const size = footprint.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
  const span = Math.max(size[2] - size[0], size[3] - size[1]);

  if (span > 2000 || maxY > 800) warnings.push(`很大（${span.toFixed(0)} m 宽、${maxY.toFixed(0)} m 高）：Blender 里单位是米吗？缩放应用了吗（Ctrl+A）？`);
  if (span < 1) warnings.push(`很小（${span.toFixed(2)} m）：Blender 里单位是米吗？`);
  if (minY < -0.5 || minY > 0.5) warnings.push(`最低点在 y=${minY.toFixed(2)} m：原点应放在地面上（最低点接近 0）`);
  const nCol = colliders.solid + colliders.walk + colliders.mesh;
  if (!nCol) warnings.push('没有碰撞体（COL_ / WALK_ / COLMESH_）：车和人会直接穿过它');
  if (!hasFar) notes.push('没有 LOD1：远景直接复用近景模型');
  if (tris.detail > 300000) warnings.push(`近景 ${tris.detail} 个三角形，偏多（现有地标 5-85k）`);
  if (hasFar && tris.far > tris.detail / 3) warnings.push(`远景 ${tris.far} 个三角形，超过近景的 1/3，起不到 LOD 的作用`);
  if (!footprintPts.length) notes.push('没有 FOOTPRINT：占地用可见模型的凸包（会删除中心落在里面的 OSM 建筑）');
  const exts = root.listExtensionsUsed().map((e) => e.extensionName);
  for (const e of ['KHR_materials_transmission', 'KHR_materials_volume']) if (exts.includes(e)) warnings.push(`用了 ${e}（透射），渲染很贵；玻璃用普通 Alpha 混合即可`);
  const instanced = [...meshUse.values()].filter((n) => n >= 6).length;
  let maxTex = 0;
  for (const t of root.listTextures()) { const s = t.getSize(); if (s) maxTex = Math.max(maxTex, s[0], s[1]); }
  const drawCalls = (level) => [...mats[level]].length;
  return {
    footprint, moreFootprints, clear, height: r2(maxY),
    stats: {
      triangles: tris.detail, farTriangles: tris.far, materials: drawCalls('detail'), farMaterials: drawCalls('far'),
      colliders, instancedMeshes: instanced, textures: root.listTextures().length, maxTexture: maxTex,
      footprintArea: Math.round(area(footprint) + moreFootprints.reduce((n, f) => n + area(f), 0)),
    },
    warnings, notes,
  };
}

/** Dedup, prune, textures to webp within `maxTexture`, meshopt compression. */
export async function optimize(doc, { maxTexture = 2048, sharp = null } = {}) {
  const steps = [dedup(), prune({ keepLeaves: true, keepExtras: true })];
  if (sharp && doc.getRoot().listTextures().length) steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTexture, maxTexture] }));
  steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16 }));
  await doc.transform(...steps);
  return doc;
}
