import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document, type Material, type Mesh, type Node } from '@gltf-transform/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createIO, inspect, optimize } from '../../../../scripts/landmarks/lib.mjs';
import type { ColliderSpec, EnvUniforms } from '../../../game/Contracts';
import { buildGlbModel, prepareMaterial, type GlbMeta } from './Glb';

/**
 * The Blender pipeline end to end, without Blender: a document shaped like Blender's glTF export
 * (Y up, names with ".001", linked duplicates sharing one mesh, markers on parent empties), through
 * the import script's inspect + optimise (meshopt, quantized), parsed by three's GLTFLoader, built
 * into the landmark model the city places.
 */
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event { constructor(type: string, public init: object = {}) { super(type); } };
const env: EnvUniforms = { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };

function cube(doc: Document, name: string, mat: Material | null, [sx, sy, sz]: number[]): Mesh {
  const p: number[] = [], idx: number[] = [];
  // 6 faces x 4 vertices, split like an exported cube
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]] as const;
  for (const [axis, sign] of faces) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, base = p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = [0, 0, 0];
      c[axis] = sign; c[u] = a; c[v] = b;
      p.push(c[0] * sx / 2, c[1] * sy / 2, c[2] * sz / 2);
    }
    idx.push(...(sign > 0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
  return prim(doc, name, mat, p, idx);
}

function prim(doc: Document, name: string, mat: Material | null, p: number[], idx: number[]): Mesh {
  const buf = doc.getRoot().listBuffers()[0];
  const pr = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
  if (mat) pr.setMaterial(mat);
  return doc.createMesh(name).addPrimitive(pr);
}

const yawQ = (deg: number): [number, number, number, number] => { const h = deg * Math.PI / 360; return [0, Math.sin(h), 0, Math.cos(h)]; };

function fixture(withFar = true): Document {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  const stone = doc.createMaterial('Stone').setBaseColorFactor([0.8, 0.78, 0.7, 1]).setRoughnessFactor(0.8).setExtras({ wet: 'ground' });
  const tile = doc.createMaterial('Tile').setEmissiveFactor([1, 0.8, 0.5]).setExtras({ glow: 'lamp', emit: 'night' });
  const add = (n: Node, parent?: Node) => { if (parent) parent.addChild(n); else scene.addChild(n); return n; };
  add(doc.createNode('Hall').setMesh(cube(doc, 'Hall', stone, [20, 10, 12])).setTranslation([0, 5, 0]));
  add(doc.createNode('Roof').setMesh(cube(doc, 'Roof', tile, [22, 1, 14])).setTranslation([0, 10.5, 0]));
  const column = cube(doc, 'ColumnMesh', stone, [0.6, 8, 0.6]);
  // Blender names linked duplicates Column, Column.001 ...: "COLUMN" must not read as a collider
  for (let i = 0; i < 8; i++) add(doc.createNode(i ? `Column.00${i}` : 'Column').setMesh(column).setTranslation([-10.5 + i * 3, 4, 7]));
  if (withFar) {
    const lod1 = add(doc.createNode('LOD1'));
    add(doc.createNode('Massing').setMesh(cube(doc, 'Massing', stone, [22, 11, 14])).setTranslation([0, 5.5, 0]), lod1);
  }
  add(doc.createNode('COL_hall').setMesh(cube(doc, 'ColHall', null, [2, 2, 2])).setTranslation([1, 5, -2]).setRotation(yawQ(30)).setScale([10, 5, 6]));
  const tilted = doc.createNode('COL.001').setMesh(cube(doc, 'Tilted', null, [1, 1, 1])).setTranslation([0, 1, 9]);
  tilted.setRotation([Math.sin(0.2), 0, 0, Math.cos(0.2)]);
  add(tilted);
  // a stair ramp: wedge from the ground at z 12 up to 1.2 m at z 8
  add(doc.createNode('WALK_stairs').setMesh(prim(doc, 'Ramp', null,
    [-2, 0, 12, 2, 0, 12, -2, 0, 8, 2, 0, 8, -2, 1.2, 8, 2, 1.2, 8], [0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 0, 4, 1, 1, 4, 5])));
  const markers = add(doc.createNode('COLMESH_group'));
  add(doc.createNode('terrace').setMesh(prim(doc, 'Terrace', null, [-15, 0.3, -15, 15, 0.3, -15, 15, 0.3, -10, -15, 0.3, -10], [0, 2, 1, 0, 3, 2])), markers);
  add(doc.createNode('FOOTPRINT').setMesh(prim(doc, 'Fp', null, [-15, 0, -15, 15, 0, -15, 15, 0, 15, -15, 0, 15], [0, 2, 1, 0, 3, 2])));
  add(doc.createNode('CLEAR_drive').setMesh(prim(doc, 'Clear', null, [-3, 0, 15, 3, 0, 15, 3, 0, 30, -3, 0, 30], [0, 2, 1, 0, 3, 2])));
  return doc;
}

async function load(doc: Document) {
  const info = inspect(doc);
  const io = await createIO();
  await optimize(doc);
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.slice().buffer, '');
  const meta: GlbMeta = { id: 'fixture', name: { zh: '测试', en: 'Test' }, lat: 39.9, lon: 116.4, headingDeg: 0, file: 'x.glb', version: '0', footprint: info.footprint, clear: info.clear, height: info.height };
  return { info, model: buildGlbModel(gltf.scene, env, meta), bytes };
}

describe('Blender glb landmarks', () => {
  it('inspect reads the footprint, clear zones and height from the markers', () => {
    const info = inspect(fixture());
    const xs = info.footprint.map((p) => p[0]), zs = info.footprint.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([-15, 15, -15, 15]);
    expect(info.clear).toHaveLength(1);
    expect(info.height).toBe(11);
    expect(info.stats.colliders).toEqual({ solid: 2, walk: 1, mesh: 1 });
    expect(info.stats.instancedMeshes).toBe(1);
    expect(info.stats.triangles).toBe(12 * 10);
    expect(info.stats.farTriangles).toBe(12);
    expect(info.warnings).toEqual([]);
  });

  it('builds colliders from COL_ / WALK_ / COLMESH_ and draws none of them', async () => {
    const { model } = await load(fixture());
    const box = model.colliders.filter((c): c is Extract<ColliderSpec, { kind: 'box' }> => c.kind === 'box');
    expect(box).toHaveLength(1);
    expect(box[0].yaw!).toBeCloseTo(Math.PI / 6, 3);
    box[0].center.forEach((v, i) => expect(v).toBeCloseTo([1, 5, -2][i], 2));
    box[0].half.forEach((v, i) => expect(v).toBeCloseTo([10, 5, 6][i], 2));
    const hulls = model.colliders.filter((c) => c.kind === 'hull');
    expect(hulls).toHaveLength(2);                       // the tilted box and the ramp
    expect(hulls.filter((c) => c.walkOnly)).toHaveLength(1);
    const tri = model.colliders.find((c) => c.kind === 'trimesh')!;
    expect(tri.kind === 'trimesh' && tri.indices.length).toBe(6);
    // the terrace's height survived quantization
    if (tri.kind === 'trimesh') for (let i = 1; i < tri.points.length; i += 3) expect(tri.points[i]).toBeCloseTo(0.3, 2);
    model.group.traverse((o) => expect(o.name).not.toMatch(/^(COL|WALK|FOOTPRINT|CLEAR|Col|Tilted|Ramp|Terrace|Fp)/));
  });

  it('merges the detail per material, instances linked duplicates, keeps LOD1 as the far level', async () => {
    const { model } = await load(fixture());
    const lod = model.group.getObjectByName('lod') as THREE.LOD;
    expect(lod.levels.map((l) => l.object.name)).toEqual(['detail', 'far']);
    const detail = lod.levels[0].object, far = lod.levels[1].object;
    const kinds = detail.children.map((c) => (c as THREE.InstancedMesh).isInstancedMesh ? `inst ${(c as THREE.InstancedMesh).count}` : c.name).sort();
    expect(kinds).toEqual(['glb Stone', 'glb Tile', 'inst 8']);
    expect(far.children.map((c) => c.name)).toEqual(['glb Stone']);
    expect(model.group.userData.stats).toMatchObject({ triangles: 120, drawCalls: 3, farTriangles: 12, farDrawCalls: 1 });
    // the merged hall sits where it was authored (the node transform is baked into the vertices)
    const hall = detail.children.find((c) => c.name === 'glb Stone') as THREE.Mesh;
    const bb = new THREE.Box3().setFromBufferAttribute(hall.geometry.getAttribute('position') as THREE.BufferAttribute);
    [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].forEach((v, i) => expect(v).toBeCloseTo([-10, 0, -6, 10, 10, 6][i], 2));
    // columns: instance 3 stands at x -1.5
    const inst = detail.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    const m = new THREE.Matrix4(); inst.getMatrixAt(3, m);
    const local = new THREE.Box3().setFromBufferAttribute(inst.geometry.getAttribute('position') as THREE.BufferAttribute).getCenter(new THREE.Vector3()).applyMatrix4(m);
    expect(local.x).toBeCloseTo(-1.5, 2);
    expect(local.z).toBeCloseTo(7, 2);
  });

  it('takes the night and rain looks from the material custom properties', async () => {
    const { model } = await load(fixture());
    const mats = new Map<string, THREE.Material>();
    model.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) mats.set(m.name, m); });
    expect(mats.get('Stone')!.userData.wet).toBe('ground');
    expect(mats.get('Stone')!.customProgramCacheKey()).toBe('lm-glb-flood-d');
    expect(mats.get('Tile')!.userData.wet).toBe('surface');
    expect(mats.get('Tile')!.customProgramCacheKey()).toBe('lm-glb-lamp-n');
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    mats.get('Tile')!.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= uNight;');
    // a flood-lit material weights its floodlight per vertex (height and normal), a lamp does not
    const flood = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    mats.get('Stone')!.onBeforeCompile(flood as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(flood.vertexShader).toContain('vLmGlow = max(0.08');
    expect(flood.fragmentShader).toContain('* vLmGlow');
    expect(shader.fragmentShader).not.toContain('vLmGlow');
    expect(shader.uniforms.uNight).toBe(env.uNight);
    // a Blender colour property arrives as a linear [r, g, b]
    const blender = new THREE.MeshStandardMaterial();
    blender.userData = { glowColor: [0.2, 0.4, 0.6] };
    prepareMaterial(blender, env);
    const s2 = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
    blender.onBeforeCompile(s2 as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect((s2.uniforms.uGlowColor.value as THREE.Color).toArray()).toEqual([0.2, 0.4, 0.6]);
  });

  it('without LOD1 the far level draws the detail geometry again, shared', async () => {
    const { model } = await load(fixture(false));
    const lod = model.group.getObjectByName('lod') as THREE.LOD;
    const d = lod.levels[0].object.children as THREE.Mesh[], f = lod.levels[1].object.children as THREE.Mesh[];
    expect(f).toHaveLength(d.length);
    f.forEach((m, i) => expect(m.geometry).toBe(d[i].geometry));
  });
});
