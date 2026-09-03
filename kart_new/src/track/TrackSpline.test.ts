import { describe, expect, it } from 'vitest';
import { TrackSpline } from './TrackSpline';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth, TRACK_CONTROL_POINTS } from './TrackConfig';

const spline = new TrackSpline();

/** 按 KartState.heading 的约定取"车手视角的右" */
function rightOf(heading: number): [number, number] {
  return [Math.sin(heading - Math.PI / 2), Math.cos(heading - Math.PI / 2)];
}

describe('TrackSpline 基本几何', () => {
  it('是闭合曲线，首尾相接', () => {
    const start = spline.getPointAt(0);
    const end = spline.getPointAt(1);
    expect(start.distanceTo(end)).toBeLessThan(1e-6);
    expect(spline.length).toBeGreaterThan(500);
  });

  it('getTangentAt 是单位向量，和 getHeadingAt 一致', () => {
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const tan = spline.getTangentAt(t);
      expect(tan.length()).toBeCloseTo(1, 6);
      const h = spline.getHeadingAt(t);
      // heading 的约定：x = sin(h), z = cos(h)，取水平分量比较
      const flat = Math.hypot(tan.x, tan.z);
      expect(Math.sin(h)).toBeCloseTo(tan.x / flat, 6);
      expect(Math.cos(h)).toBeCloseTo(tan.z / flat, 6);
    }
  });

  it('getNormalAt 朝上、是单位向量、和切线垂直', () => {
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const n = spline.getNormalAt(t);
      expect(n.length()).toBeCloseTo(1, 6);
      expect(n.y).toBeGreaterThan(0.9); // 坡度不大，法线基本朝上
      expect(n.dot(spline.getTangentAt(t))).toBeCloseTo(0, 6);
    }
  });
});

describe('getProgress', () => {
  it('中心线上的点：t 对得上，横向偏移为 0', () => {
    for (const t0 of [0, 0.13, 0.37, 0.5, 0.76, 0.99]) {
      const c = spline.getPointAt(t0);
      const r = spline.getProgress(c.x, c.z);
      expect(r.lateral).toBeCloseTo(0, 3);
      // t 可能绕圈，比较环上距离
      const d = Math.abs(r.t - t0);
      expect(Math.min(d, 1 - d)).toBeLessThan(0.002);
    }
  });

  it('横向偏移的符号：车手视角右侧为正', () => {
    for (const t0 of [0.05, 0.31, 0.62, 0.88]) {
      const c = spline.getPointAt(t0);
      const [rx, rz] = rightOf(spline.getHeadingAt(t0));
      const right = spline.getProgress(c.x + rx * 4, c.z + rz * 4);
      const left = spline.getProgress(c.x - rx * 4, c.z - rz * 4);
      expect(right.lateral).toBeCloseTo(4, 2);
      expect(left.lateral).toBeCloseTo(-4, 2);
    }
  });

  it('分辨率不受采样点数限制：查询点落在两个采样点中间也能给出准确的 t', () => {
    const coarse = new TrackSpline(TRACK_CONTROL_POINTS, 40);
    // 故意取两个采样点正中间
    const t0 = 0.5 / 40 + 1 / 80;
    const c = coarse.getPointAt(t0);
    const r = coarse.getProgress(c.x, c.z);
    expect(Math.abs(r.lateral)).toBeLessThan(0.3);
  });

  it('每次查询对曲线的求值次数是常数，不随采样点数增长', () => {
    const s = new TrackSpline(TRACK_CONTROL_POINTS, 500);
    let calls = 0;
    const curve = s.curve as unknown as Record<string, (...args: never[]) => unknown>;
    for (const name of ['getPoint', 'getPointAt', 'getTangent', 'getTangentAt']) {
      const original = curve[name]!.bind(s.curve);
      curve[name] = ((...args: never[]) => {
        calls++;
        return original(...args);
      }) as (...args: never[]) => unknown;
    }
    s.getProgress(12, 34);
    // 预采样表是构造时建好的；查询时只在细化那一步碰曲线
    expect(calls).toBeLessThanOrEqual(6);
  });
});

describe('赛道形状', () => {
  it('不自交：不相邻的两段距离大于整条路的宽度', () => {
    const n = 400;
    const pts = Array.from({ length: n }, (_, i) => spline.getPointAt(i / n));
    const need = (drivableHalfWidth(DEFAULT_TRACK_CONFIG) + DEFAULT_TRACK_CONFIG.wallThickness) * 2;
    // 弧长上离得近的先排除掉，那是"同一段路"而不是自交
    const skip = Math.ceil((need * 1.6) / (spline.length / n));
    let worst = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.min(j - i, n - (j - i)) < skip) continue;
        worst = Math.min(worst, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z));
      }
    }
    expect(worst).toBeGreaterThan(need);
  });

  it('有起伏，但坡度不至于让车飞起来', () => {
    let yMin = Infinity;
    let yMax = -Infinity;
    let maxSlope = 0;
    for (let i = 0; i < 200; i++) {
      const p = spline.getPointAt(i / 200);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
      const tan = spline.getTangentAt(i / 200);
      maxSlope = Math.max(maxSlope, Math.abs(Math.atan2(tan.y, Math.hypot(tan.x, tan.z))));
    }
    expect(yMax - yMin).toBeGreaterThan(3);
    expect((maxSlope * 180) / Math.PI).toBeLessThan(15);
  });
});
