import * as THREE from 'three';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth, type TrackConfig } from './TrackConfig';
import type { TrackSpline } from './TrackSpline';

/** 给 rapier 建 trimesh collider 用的裸几何。 */
export interface TrackCollision {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * 沿样条挤出赛道网格：路面 + 路肩（减速带）+ 护栏 + 裙边。
 *
 * 全部是"三角带"：沿样条每隔一段采一个环，每个环在法线方向上算出若干个顶点，
 * 相邻两环缝成四边形。顶点法线直接用样条的路面法线，所以上下坡的光照是对的 ——
 * 用固定的 (0,1,0) 的话坡道会被照得跟平地一样，起伏就看不出来了。
 *
 * 碰撞几何直接复用路面 + 路肩的三角形（护栏不进碰撞，护栏是靠横向偏移拉回来的）。
 */
export class TrackMesh {
  readonly group = new THREE.Group();
  readonly road: THREE.Mesh;
  readonly shoulders: THREE.Mesh;
  readonly walls: THREE.Mesh;
  readonly skirt: THREE.Mesh;
  readonly collision: TrackCollision;

  constructor(
    spline: TrackSpline,
    private readonly cfg: Readonly<TrackConfig> = DEFAULT_TRACK_CONFIG,
  ) {
    const halfRoad = cfg.trackWidth / 2;
    const halfDrivable = drivableHalfWidth(cfg);

    const roadB = new StripBuilder();
    const shoulderB = new StripBuilder();
    const wallB = new StripBuilder();
    const skirtB = new StripBuilder();
    // 只进碰撞、不进场景：护栏底座那条水平带
    const wallBaseB = new StripBuilder();

    const rings = cfg.meshSegments;
    const center = new THREE.Vector3();
    const side = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    // 每种带子先各自收集环，最后统一缝。分开收集是因为一条带子的顶点必须连续排布
    const roadRings: Ring[] = [];
    const shoulderRings: Array<[Ring, Ring]> = [];
    const wallRings: Array<[Ring, Ring]> = [];

    let arc = 0;
    let prev: THREE.Vector3 | null = null;

    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      spline.getPointAt(t, center);
      spline.getSideAt(t, side);
      spline.getNormalAt(t, normal);
      spline.getTangentAt(t, tangent);
      if (prev) arc += center.distanceTo(prev);
      prev = center.clone();

      const at = (lateral: number, dy: number) =>
        new THREE.Vector3(
          center.x + side.x * lateral,
          center.y + side.y * lateral + dy,
          center.z + side.z * lateral,
        );

      const n = normal.clone();
      const tan = tangent.clone();
      roadRings.push({ a: at(-halfRoad, 0), b: at(halfRoad, 0), n, tan, arc });
      // 路肩：内侧和路面齐平，外侧下沉一点，做出台阶感
      shoulderRings.push([
        { a: at(-halfDrivable, -cfg.shoulderDrop), b: at(-halfRoad, 0), n, tan, arc },
        { a: at(halfRoad, 0), b: at(halfDrivable, -cfg.shoulderDrop), n, tan, arc },
      ]);
      wallRings.push([
        {
          a: at(-halfDrivable, -cfg.shoulderDrop),
          b: at(-halfDrivable - cfg.wallThickness, -cfg.shoulderDrop),
          n: up,
          tan,
          arc,
        },
        {
          a: at(halfDrivable, -cfg.shoulderDrop),
          b: at(halfDrivable + cfg.wallThickness, -cfg.shoulderDrop),
          n: up,
          tan,
          arc,
        },
      ]);
    }

    // --- 路面 ---
    for (const r of roadRings) {
      roadB.addRing(r.a, r.n, 0, r.arc / cfg.roadTileLength, r.b, r.n, 1, r.arc / cfg.roadTileLength);
    }

    // --- 路肩 ---
    for (const [left] of shoulderRings) {
      shoulderB.addRing(left.a, left.n, 0, left.arc / cfg.shoulderTileLength, left.b, left.n, 1, left.arc / cfg.shoulderTileLength);
    }
    shoulderB.beginStrip();
    for (const [, right] of shoulderRings) {
      shoulderB.addRing(right.a, right.n, 0, right.arc / cfg.shoulderTileLength, right.b, right.n, 1, right.arc / cfg.shoulderTileLength);
    }

    // --- 护栏。每侧三面：朝赛道的内面、顶面、外面 ---
    this.buildWalls(wallB, wallRings);
    // --- 裙边：从护栏外侧一路垂到地面高度，挡住路面悬空的缝 ---
    this.buildSkirt(skirtB, wallRings);

    // --- 护栏底座（不渲染，只给射线打）---
    // 蹭墙时车会短暂地待在可行驶半宽之外（采样差一帧，最多一帧的位移那么多）。
    // 碰撞几何要是只铺到可行驶半宽，那几帧射线就打空了 —— 车不会飞出去（kartStep 里
    // 有专门的判断），但拿不到接触点高度，蹭着墙上坡时车高会卡住不动。
    // 把护栏那条 wallThickness 宽的底座也铺进碰撞几何，射线就一直有东西打。
    for (const [left] of wallRings) {
      wallBaseB.addRing(left.a, left.n, 0, 0, left.b, left.n, 1, 0);
    }
    wallBaseB.beginStrip();
    for (const [, right] of wallRings) {
      wallBaseB.addRing(right.a, right.n, 0, 0, right.b, right.n, 1, 0);
    }

    const textures = makeTrackTextures();
    this.road = mesh(roadB, new THREE.MeshStandardMaterial({ map: textures.asphalt, roughness: 0.92, metalness: 0 }));
    this.road.receiveShadow = true;
    this.shoulders = mesh(shoulderB, new THREE.MeshStandardMaterial({ map: textures.curb, roughness: 0.7 }));
    this.shoulders.receiveShadow = true;
    this.walls = mesh(wallB, new THREE.MeshStandardMaterial({ color: '#eceff5', roughness: 0.75 }));
    this.walls.castShadow = true;
    this.walls.receiveShadow = true;
    this.skirt = mesh(skirtB, new THREE.MeshStandardMaterial({ color: '#4a4f5a', roughness: 1 }));

    this.group.add(this.road, this.shoulders, this.walls, this.skirt);
    this.collision = mergeCollision([roadB, shoulderB, wallBaseB]);
  }

  /** 可行驶半宽，外面判断有没有蹭到护栏要用 */
  get halfWidth(): number {
    return drivableHalfWidth(this.cfg);
  }

  private buildWalls(b: StripBuilder, rings: Array<[Ring, Ring]>): void {
    const h = this.cfg.wallHeight;
    const up = new THREE.Vector3(0, 1, 0);
    const raise = (p: THREE.Vector3) => p.clone().addScaledVector(up, h);

    // 三角带的朝向规则：面法线 = (b - a) × 切线。
    // 想让面朝赛道内侧就把 a/b 排成"下 -> 上"，朝外就排成"上 -> 下"，
    // 左右两侧的 side 方向相反，所以左侧一律反过来排。
    const strips: Array<(r: [Ring, Ring]) => [THREE.Vector3, THREE.Vector3]> = [
      // 右侧：内面（下->上，法线朝 -side = 赛道内）
      ([, r]) => [r.a, raise(r.a)],
      // 右侧：顶面（内->外）
      ([, r]) => [raise(r.a), raise(r.b)],
      // 右侧：外面（上->下）
      ([, r]) => [raise(r.b), r.b],
      // 左侧：内面（上->下）
      ([l]) => [raise(l.a), l.a],
      // 左侧：顶面（外->内）
      ([l]) => [raise(l.b), raise(l.a)],
      // 左侧：外面（下->上）
      ([l]) => [l.b, raise(l.b)],
    ];

    for (let s = 0; s < strips.length; s++) {
      if (s > 0) b.beginStrip();
      const make = strips[s]!;
      const rightSide = s < 3;
      for (const ring of rings) {
        const [pa, pb] = make(ring);
        const r = rightSide ? ring[1] : ring[0];
        const n = faceNormal(pa, pb, r.tan);
        const v = r.arc / this.cfg.shoulderTileLength;
        b.addRing(pa, n, 0, v, pb, n, 1, v);
      }
    }
  }

  private buildSkirt(b: StripBuilder, rings: Array<[Ring, Ring]>): void {
    const bottom = this.cfg.skirtBottomY;
    const drop = (p: THREE.Vector3) => new THREE.Vector3(p.x, bottom, p.z);
    // 右侧：上 -> 下（朝外）；左侧反过来
    for (const [, r] of rings) {
      const n = faceNormal(r.b, drop(r.b), r.tan);
      b.addRing(r.b, n, 0, r.arc / 10, drop(r.b), n, 1, r.arc / 10);
    }
    b.beginStrip();
    for (const [l] of rings) {
      const n = faceNormal(drop(l.b), l.b, l.tan);
      b.addRing(drop(l.b), n, 0, l.arc / 10, l.b, n, 1, l.arc / 10);
    }
  }
}

interface Ring {
  /** 带子的左顶点（沿行驶方向看） */
  a: THREE.Vector3;
  /** 带子的右顶点 */
  b: THREE.Vector3;
  /** 顶点法线（路面用样条法线，护栏各面自己算） */
  n: THREE.Vector3;
  /** 该处切线，算面朝向用 */
  tan: THREE.Vector3;
  /** 从起点累计的弧长，UV 的 v 就是它 */
  arc: number;
}

/**
 * 面朝向的唯一规则：**面法线 = (b - a) × 切线**。
 * addRing 的索引缠绕是固定的，所以要让某个面朝哪边，就只需要安排好 a/b 的先后。
 * 左右两侧的 side 方向相反，左侧的所有面都要把 a/b 反过来排 —— 见 buildWalls。
 */
function faceNormal(a: THREE.Vector3, b: THREE.Vector3, tangent: THREE.Vector3): THREE.Vector3 {
  const n = new THREE.Vector3().subVectors(b, a).cross(tangent).normalize();
  return n.lengthSq() > 0.5 ? n : new THREE.Vector3(0, 1, 0);
}

/** 三角带累加器。addRing 每次加一环的两个顶点，从第二环开始自动缝上索引。 */
class StripBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly index: number[] = [];
  private ringCount = 0;
  private base = 0;

  /** 开始一条新的带子（顶点继续往同一个数组里放，但索引不跨带子连） */
  beginStrip(): void {
    this.base = this.position.length / 3;
    this.ringCount = 0;
  }

  addRing(
    pa: THREE.Vector3,
    na: THREE.Vector3,
    ua: number,
    va: number,
    pb: THREE.Vector3,
    nb: THREE.Vector3,
    ub: number,
    vb: number,
  ): void {
    this.position.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    this.normal.push(na.x, na.y, na.z, nb.x, nb.y, nb.z);
    this.uv.push(ua, va, ub, vb);
    if (this.ringCount > 0) {
      const i = this.base + (this.ringCount - 1) * 2;
      this.index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    this.ringCount++;
  }

  toGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.index);
    geo.computeBoundingSphere();
    return geo;
  }
}

function mesh(builder: StripBuilder, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(builder.toGeometry(), material);
}

/** 把几条带子合成一份 rapier trimesh 用的裸数据。 */
function mergeCollision(builders: readonly StripBuilder[]): TrackCollision {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const b of builders) {
    const offset = vertices.length / 3;
    vertices.push(...b.position);
    for (const i of b.index) indices.push(i + offset);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/** 调试用：把中心线画成一条线，稍微抬高一点免得被路面 z-fighting 吃掉。 */
export function createCenterLine(spline: TrackSpline, samples = 600, lift = 0.12): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = spline.getPointAt(i / samples);
    points.push(new THREE.Vector3(p.x, p.y + lift, p.z));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ff2fd0' }));
  line.frustumCulled = false;
  return line;
}

// ============================================================================
// 纹理
// ============================================================================

function makeTrackTextures(): { asphalt: THREE.Texture; curb: THREE.Texture } {
  const asphalt = new THREE.CanvasTexture(makeAsphaltCanvas());
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.anisotropy = 8;
  asphalt.colorSpace = THREE.SRGBColorSpace;

  const curb = new THREE.CanvasTexture(makeCurbCanvas());
  curb.wrapS = curb.wrapT = THREE.RepeatWrapping;
  curb.anisotropy = 8;
  curb.colorSpace = THREE.SRGBColorSpace;

  return { asphalt, curb };
}

/** u 横跨整条路：两边画白色边线，中间画虚线。 */
function makeAsphaltCanvas(): HTMLCanvasElement {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#3b3f46';
  ctx.fillRect(0, 0, w, h);
  // 沥青颗粒
  for (let i = 0; i < 2600; i++) {
    const g = 40 + Math.random() * 45;
    ctx.fillStyle = `rgb(${g},${g + 2},${g + 6})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // 边线
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(6, 0, 5, h);
  ctx.fillRect(w - 11, 0, 5, h);
  // 中间虚线（沿长度方向断开）
  for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 2, y, 4, 34);
  return canvas;
}

/** 红白相间的减速带，条纹沿长度方向切分。 */
function makeCurbCanvas(): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5f5f7';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#e0362f';
  ctx.fillRect(0, 0, size, size / 2);
  return canvas;
}
