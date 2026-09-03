import { describe, expect, it } from 'vitest';
import { TrackSpline } from './TrackSpline';
import { drivableHalfWidth } from './TrackConfig';
import { TRACK_IDS, TRACKS, isTrackId, type TrackVariant } from './TrackCatalog';

/**
 * 每条赛道都要过和默认道一样的几何关：不自交、坡度不至于让车飞起来、
 * 相邻控制点不能太近（CatmullRom 会在那里鼓出尖角）、道具箱要落在柏油上。
 *
 * 加新赛道时这个测试是第一道关口 —— 自交的赛道跑起来的表现是
 * "进度突然跳一大截"，肉眼很难当场看出来是赛道的问题。
 */
function splineOf(track: TrackVariant): TrackSpline {
  return new TrackSpline(track.points, track.config.lutSamples);
}

describe.each(TRACK_IDS)('赛道 %s', (id) => {
  const track = TRACKS[id];
  const spline = splineOf(track);

  it('是闭合曲线，长度合理', () => {
    expect(spline.getPointAt(0).distanceTo(spline.getPointAt(1))).toBeLessThan(1e-6);
    expect(spline.length).toBeGreaterThan(500);
    expect(spline.length).toBeLessThan(2500);
  });

  it('不自交：不相邻的两段距离大于整条路的宽度', () => {
    const n = 400;
    const pts = Array.from({ length: n }, (_, i) => spline.getPointAt(i / n));
    const need = (drivableHalfWidth(track.config) + track.config.wallThickness) * 2;
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
      const t = i / 200;
      const p = spline.getPointAt(t);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
      const tan = spline.getTangentAt(t);
      maxSlope = Math.max(maxSlope, Math.abs(Math.atan2(tan.y, Math.hypot(tan.x, tan.z))));
    }
    expect(yMax - yMin).toBeGreaterThan(3);
    expect((maxSlope * 180) / Math.PI).toBeLessThan(15);
  });

  it('相邻控制点不会太近（太近 CatmullRom 会鼓出尖角）', () => {
    const pts = track.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(30);
    }
  });

  it('道具箱落在柏油上，t 不重复', () => {
    const halfRoad = track.config.trackWidth / 2;
    const seen = new Set<number>();
    for (const row of track.itemBoxRows) {
      expect(row.t).toBeGreaterThanOrEqual(0);
      expect(row.t).toBeLessThan(1);
      expect(seen.has(row.t)).toBe(false);
      seen.add(row.t);
      expect(row.lanes.length).toBeGreaterThan(0);
      for (const lane of row.lanes) expect(Math.abs(lane)).toBeLessThan(halfRoad);
    }
  });

  it('圈数是正整数', () => {
    expect(track.laps).toBeGreaterThan(0);
    expect(Number.isInteger(track.laps)).toBe(true);
  });
});

describe('赛道表本身', () => {
  it('TRACK_IDS 和 TRACKS 对得上，且按难度从易到难排', () => {
    expect([...TRACK_IDS].sort()).toEqual(Object.keys(TRACKS).sort());
    const levels = TRACK_IDS.map((id) => TRACKS[id].difficulty);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);
    }
  });

  it('isTrackId 挡得住脏数据（localStorage / URL 参数都可能是乱写的）', () => {
    expect(isTrackId('sunset')).toBe(true);
    for (const bad of ['', 'SUNSET', null, undefined, 0, {}]) expect(isTrackId(bad)).toBe(false);
  });
});
