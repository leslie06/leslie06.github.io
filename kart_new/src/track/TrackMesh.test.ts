import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { stubCanvasForNode } from '../test/stubCanvas';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth } from './TrackConfig';
import { TrackMesh } from './TrackMesh';
import { TrackSpline } from './TrackSpline';

let spline: TrackSpline;
let track: TrackMesh;

beforeAll(() => {
  stubCanvasForNode();
  spline = new TrackSpline();
  track = new TrackMesh(spline);
});

/** 逐三角形比较"几何叉积算出来的面朝向"和"顶点法线"。 */
function windingMismatches(mesh: THREE.Mesh): number {
  const pos = mesh.geometry.getAttribute('position');
  const nrm = mesh.geometry.getAttribute('normal');
  const index = mesh.geometry.getIndex()!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const face = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  let bad = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1));
    c.fromBufferAttribute(pos, index.getX(i + 2));
    face.crossVectors(b.sub(a), c.sub(a)).normalize();
    vertex.fromBufferAttribute(nrm, index.getX(i));
    if (face.dot(vertex) < 0.5) bad++;
  }
  return bad;
}

describe('TrackMesh', () => {
  it('四块网格都有三角形，没有 NaN', () => {
    for (const [name, mesh] of Object.entries({
      road: track.road,
      shoulders: track.shoulders,
      walls: track.walls,
      skirt: track.skirt,
    })) {
      const pos = mesh.geometry.getAttribute('position');
      expect(mesh.geometry.getIndex()!.count, name).toBeGreaterThan(0);
      expect(
        Array.from(pos.array as Float32Array).every(Number.isFinite),
        name,
      ).toBe(true);
    }
  });

  it('缠绕方向和顶点法线一致（不然会被背面剔除吃掉，看起来是破洞）', () => {
    expect(windingMismatches(track.road)).toBe(0);
    expect(windingMismatches(track.shoulders)).toBe(0);
    expect(windingMismatches(track.walls)).toBe(0);
    expect(windingMismatches(track.skirt)).toBe(0);
  });

  it('护栏的侧面一半朝内一半朝外', () => {
    const pos = track.walls.geometry.getAttribute('position');
    const nrm = track.walls.geometry.getAttribute('normal');
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    let inward = 0;
    let outward = 0;
    for (let i = 0; i < pos.count; i += 17) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      if (Math.abs(n.y) > 0.5) continue; // 顶面不算
      const progress = spline.getProgress(p.x, p.z);
      const toCenter = new THREE.Vector3(progress.centerX - p.x, 0, progress.centerZ - p.z);
      if (n.dot(toCenter) > 0) inward++;
      else outward++;
    }
    expect(inward).toBeGreaterThan(0);
    expect(outward).toBeGreaterThan(0);
    expect(Math.abs(inward - outward)).toBeLessThan(inward * 0.3);
  });

  it('路面顶点贴着样条：横向不倾斜，高度等于中心线高度', () => {
    const pos = track.road.geometry.getAttribute('position');
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 13) {
      p.fromBufferAttribute(pos, i);
      const progress = spline.getProgress(p.x, p.z);
      expect(Math.abs(progress.lateral)).toBeLessThanOrEqual(DEFAULT_TRACK_CONFIG.trackWidth / 2 + 0.1);
      expect(p.y).toBeCloseTo(progress.centerY, 1);
    }
  });

  it('碰撞几何盖住整个可行驶宽度，还多铺出护栏底座那一条', () => {
    const { vertices, indices } = track.collision;
    expect(indices.length % 3).toBe(0);
    // 路面 + 路肩 + 护栏底座（底座不渲染，只给射线打）
    expect(indices.length / 3).toBeGreaterThan(
      track.road.geometry.getIndex()!.count / 3 + track.shoulders.geometry.getIndex()!.count / 3,
    );
    // 索引不能越界，不然 rapier 会直接崩
    expect(Math.max(...indices)).toBeLessThan(vertices.length / 3);

    const half = drivableHalfWidth(DEFAULT_TRACK_CONFIG);
    let maxLateral = 0;
    for (let i = 0; i < vertices.length; i += 3 * 11) {
      const progress = spline.getProgress(vertices[i]!, vertices[i + 2]!);
      maxLateral = Math.max(maxLateral, Math.abs(progress.lateral));
    }
    // 蹭墙时车会短暂待在可行驶半宽之外，那几帧射线也得有东西打
    expect(maxLateral).toBeGreaterThan(half + DEFAULT_TRACK_CONFIG.wallThickness - 0.2);
  });
});
