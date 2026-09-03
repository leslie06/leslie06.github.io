import * as THREE from 'three';
import { DEFAULT_TRACK_CONFIG, type ControlPoint } from './TrackConfig';

/** getProgress 的结果。 */
export interface TrackProgress {
  /** 在赛道上的进度 0..1 */
  t: number;
  /** 相对中心线的横向偏移，正 = 车手视角的右侧 */
  lateral: number;
  /** 中心线上最近点的世界坐标 */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** 该处赛道朝向（弧度，和 KartState.heading 同一套约定） */
  heading: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * 闭合的赛道中心线。
 *
 * getProgress 是每帧都要调的，所以**不能**每次去遍历曲线求最近点 ——
 * 构造时把曲线按弧长均分成 lutSamples 个点建表，查询时先在表里找最近的采样点，
 * 再在它左右两段上做一次线性投影细化。O(N) 的表扫描，N=500，一帧一次可以忽略。
 */
export class TrackSpline {
  readonly curve: THREE.CatmullRomCurve3;
  /** 中心线总长（米） */
  readonly length: number;
  /** 预采样点数 */
  readonly sampleCount: number;

  /** 预采样表，扁平存放，避免几百个 Vector3 对象 */
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  /** 每个采样点处车手视角"右"方向（水平面内，已归一化） */
  private readonly rx: Float64Array;
  private readonly rz: Float64Array;

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  /** getProgress 专用。不能跟 tmpA/tmpB 混用 —— getHeadingAt 内部就在写 tmpA，
   *  共用的话刚取到的中心点会被下一句调用覆盖掉（横向偏移会算成几十米）。 */
  private readonly tmpCenter = new THREE.Vector3();

  /**
   * @param points 中心线控制点。**没有默认值** —— 这个类是纯几何，
   *               不该知道项目里有哪些赛道（那是 src/track/tracks/ 的事）
   */
  constructor(
    points: readonly ControlPoint[],
    sampleCount: number = DEFAULT_TRACK_CONFIG.lutSamples,
  ) {
    this.curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      'catmullrom',
      0.5,
    );
    this.length = this.curve.getLength();
    this.sampleCount = sampleCount;

    this.px = new Float64Array(sampleCount);
    this.py = new Float64Array(sampleCount);
    this.pz = new Float64Array(sampleCount);
    this.rx = new Float64Array(sampleCount);
    this.rz = new Float64Array(sampleCount);

    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;
      this.curve.getPointAt(t, p);
      this.curve.getTangentAt(t, tan);
      this.px[i] = p.x;
      this.py[i] = p.y;
      this.pz[i] = p.z;
      // 右 = tangent × up 在水平面上的投影
      const len = Math.hypot(tan.x, tan.z) || 1;
      this.rx[i] = -tan.z / len;
      this.rz[i] = tan.x / len;
    }
  }

  /** 中心线上 t 处的点。t 按弧长参数化，等距。 */
  getPointAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.curve.getPointAt(wrap01(t), target);
  }

  /** t 处的单位切线（行驶方向）。 */
  getTangentAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.curve.getTangentAt(wrap01(t), target).normalize();
  }

  /**
   * t 处的路面法线（朝上）。
   * 由 side × tangent 得到，所以爬坡时它会跟着坡度倾斜 —— 生成网格时直接拿它当顶点法线，
   * 光照才对得上；用固定的 (0,1,0) 会让上下坡看起来是平的。
   */
  getNormalAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const tangent = this.getTangentAt(t, this.tmpA);
    const side = this.tmpB.copy(tangent).cross(UP).normalize();
    return target.copy(side).cross(tangent).normalize();
  }

  /** t 处车手视角的"右"方向（水平面内）。挤出路面左右边缘用。 */
  getSideAt(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const tangent = this.getTangentAt(t, this.tmpA);
    return target.copy(tangent).cross(UP).normalize();
  }

  /** t 处的赛道朝向，和 KartState.heading 同约定（0 = +z，x = sin h, z = cos h）。 */
  getHeadingAt(t: number): number {
    const tangent = this.getTangentAt(t, this.tmpA);
    return Math.atan2(tangent.x, tangent.z);
  }

  /**
   * 世界坐标 -> 赛道进度 + 横向偏移。
   *
   * 只看水平面（忽略 y）：赛道有起伏，用 3D 距离找最近点会在陡坡处偏一截。
   */
  getProgress(x: number, z: number, out?: TrackProgress): TrackProgress {
    const n = this.sampleCount;
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = x - this.px[i]!;
      const dz = z - this.pz[i]!;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }

    // 在最近采样点两侧的线段上各投影一次，取更近的那段做细化。
    // 只找采样点的话，t 的分辨率就被采样密度锁死了（500 点 ≈ 1.7m 一格）。
    const prev = (best - 1 + n) % n;
    const next = (best + 1) % n;
    const a = this.projectOnSegment(prev, best, x, z);
    const b = this.projectOnSegment(best, next, x, z);
    const hit = a.d2 <= b.d2 ? a : b;

    const t = wrap01(hit.index / n + hit.u / n);
    const center = this.getPointAt(t, this.tmpCenter);
    const heading = this.getHeadingAt(t);
    // 横向偏移用细化后的 t 处的右方向算，符号才稳定
    const rx = Math.sin(heading - Math.PI / 2);
    const rz = Math.cos(heading - Math.PI / 2);
    const lateral = (x - center.x) * rx + (z - center.z) * rz;

    const result = out ?? ({} as TrackProgress);
    result.t = t;
    result.lateral = lateral;
    result.centerX = center.x;
    result.centerY = center.y;
    result.centerZ = center.z;
    result.heading = heading;
    return result;
  }

  /** 把点投影到采样段 [i, j] 上，返回参数 u∈[0,1] 和距离平方。 */
  private projectOnSegment(
    i: number,
    j: number,
    x: number,
    z: number,
  ): { index: number; u: number; d2: number } {
    const ax = this.px[i]!;
    const az = this.pz[i]!;
    const ex = this.px[j]! - ax;
    const ez = this.pz[j]! - az;
    const denom = ex * ex + ez * ez;
    const u = denom > 1e-9 ? clamp01(((x - ax) * ex + (z - az) * ez) / denom) : 0;
    const dx = x - (ax + ex * u);
    const dz = z - (az + ez * u);
    return { index: i, u, d2: dx * dx + dz * dz };
  }
}

/** 把 t 折回 [0,1)。闭合曲线，越界就是绕圈。 */
function wrap01(t: number): number {
  const r = t % 1;
  return r < 0 ? r + 1 : r;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
