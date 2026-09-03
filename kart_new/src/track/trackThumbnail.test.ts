import { describe, expect, it } from 'vitest';
import { trackOutline, trackThumbnailSvg } from './trackThumbnail';
import { TRACKS, TRACK_IDS } from './tracks';
import type { ControlPoint } from './TrackConfig';

/** 一个边长 200 的正方形，方便手算 */
const SQUARE: readonly ControlPoint[] = [
  [-100, 0, -100],
  [100, 0, -100],
  [100, 0, 100],
  [-100, 0, 100],
];

describe('trackOutline', () => {
  it('每个控制点出一段三次贝塞尔，闭合', () => {
    const { path } = trackOutline(SQUARE);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path.match(/C/g)).toHaveLength(SQUARE.length);
  });

  /**
   * 曲线永远落在它自己贝塞尔控制点的凸包里，所以"所有数字都在 viewBox 内"
   * 是一个保守但正确的判据 —— 留白就是给控制点鼓出去的那一点用的。
   */
  it('所有坐标都落在 viewBox 里（留白之内）', () => {
    for (const id of TRACK_IDS) {
      const size = 100;
      const padding = 6;
      const { path } = trackOutline(TRACKS[id].points, { size, padding });
      const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (const v of numbers) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(size);
      }
    }
  });

  it('长边贴着留白，短边居中', () => {
    // 宽 400 高 200 的长方形：x 方向应该占满，y 方向应该居中
    const wide: readonly ControlPoint[] = [
      [-200, 0, -100],
      [200, 0, -100],
      [200, 0, 100],
      [-200, 0, 100],
    ];
    const { path } = trackOutline(wide, { size: 100, padding: 10 });
    // 只看**曲线经过的点**（M 的坐标和每段 C 的最后一对），控制点会鼓出去
    const xs = anchors(path).map((p) => p.x);
    const ys = anchors(path).map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10, 1);
    expect(Math.max(...xs)).toBeCloseTo(90, 1);
    // 高 200 是宽 400 的一半，所以纵向只占一半，上下各留四分之一
    expect(Math.min(...ys)).toBeCloseTo(30, 1);
    expect(Math.max(...ys)).toBeCloseTo(70, 1);
  });

  /**
   * 世界坐标的 +z 朝北，SVG 的 +y 朝下。不翻转的话缩略图是实际赛道的镜像 ——
   * 这种错在缩略图上很难看出来，但拿着它对照实际赛道找路口时就完全对不上了。
   */
  it('z 轴翻转：世界里 z 大的点在图上更靠上', () => {
    const { path } = trackOutline(SQUARE, { size: 100, padding: 0 });
    const first = /M([\d.]+) ([\d.]+)/.exec(path)!;
    // SQUARE[0] 是 z = -100（最南），在图上应该在最下面
    expect(Number(first[2])).toBeCloseTo(100, 1);
  });

  it('起点坐标就是路径的第一个点', () => {
    const { path, start } = trackOutline(SQUARE);
    expect(path.startsWith(`M${start.x} ${start.y}`)).toBe(true);
  });

  it('控制点太少时给一个空路径，而不是崩', () => {
    expect(trackOutline([[0, 0, 0]]).path).toBe('');
    expect(trackThumbnailSvg([])).toBe('');
  });
});

/** 曲线真正经过的点：M 的坐标 + 每段 C 的最后一对 */
function anchors(path: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const move = /^M(-?[\d.]+) (-?[\d.]+)/.exec(path);
  if (move) out.push({ x: Number(move[1]), y: Number(move[2]) });
  for (const m of path.matchAll(/C[\d.\s-]*? (-?[\d.]+) (-?[\d.]+)(?=[CZ])/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return out;
}

describe('trackThumbnailSvg', () => {
  it('是一段合法的 svg，两层描边 + 起点标记', () => {
    const svg = trackThumbnailSvg(TRACKS.sunset.points, { size: 120 });
    expect(svg.startsWith('<svg viewBox="0 0 120 120"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain('<circle');
  });

  it('四条赛道的缩略图互不相同（不然选择界面就白做了）', () => {
    const svgs = TRACK_IDS.map((id) => trackThumbnailSvg(TRACKS[id].points));
    expect(new Set(svgs).size).toBe(TRACK_IDS.length);
  });

  it('体积够小，塞进 innerHTML 不心疼', () => {
    for (const id of TRACK_IDS) {
      expect(trackThumbnailSvg(TRACKS[id].points).length).toBeLessThan(3000);
    }
  });
});
