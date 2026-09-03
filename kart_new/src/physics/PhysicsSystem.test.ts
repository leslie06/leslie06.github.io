import { beforeAll, describe, expect, it } from 'vitest';
import { PhysicsSystem } from './PhysicsSystem';
import { stubCanvasForNode } from '../test/stubCanvas';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth } from '../track/TrackConfig';
import { TrackMesh } from '../track/TrackMesh';
import { TrackSpline } from '../track/TrackSpline';

let spline: TrackSpline;
let physics: PhysicsSystem;

beforeAll(async () => {
  stubCanvasForNode();
  spline = new TrackSpline();
  const track = new TrackMesh(spline);
  physics = await PhysicsSystem.create(spline, track.collision);
});

/** 车手视角的"右" */
function rightOf(heading: number): [number, number] {
  return [Math.sin(heading - Math.PI / 2), Math.cos(heading - Math.PI / 2)];
}

describe('PhysicsSystem 地面探测', () => {
  it('路面中心线上打得到地，高度和法线都对', () => {
    // 这条也是 world.step() 的回归保护：不 step 的话 rapier 的加速结构是空的，
    // 每一条射线都会 MISS，车会一直判定成掉出赛道
    for (const t of [0, 0.17, 0.43, 0.68, 0.91]) {
      const c = spline.getPointAt(t);
      const g = physics.sample(c.x, c.y, c.z);
      expect(g.onTrack, `t=${t}`).toBe(true);
      expect(g.height).toBeCloseTo(c.y, 1);
      expect(g.normalY).toBeGreaterThan(0.9);
      expect(Math.hypot(g.normalX, g.normalY, g.normalZ)).toBeCloseTo(1, 5);
    }
  });

  it('赛道外侧打空 -> onTrack false', () => {
    const c = spline.getPointAt(0.3);
    const [rx, rz] = rightOf(spline.getHeadingAt(0.3));
    const far = 40; // 远远超出路肩
    const g = physics.sample(c.x + rx * far, c.y, c.z + rz * far);
    expect(g.onTrack).toBe(false);
  });

  it('车沉进路面里也能打到（射线是从车头顶往下打的）', () => {
    const c = spline.getPointAt(0.55);
    const g = physics.sample(c.x, c.y - 0.5, c.z);
    expect(g.onTrack).toBe(true);
    expect(g.height).toBeCloseTo(c.y, 1);
  });

  it('横向偏移和可行驶半宽对得上', () => {
    const c = spline.getPointAt(0.22);
    const [rx, rz] = rightOf(spline.getHeadingAt(0.22));
    const g = physics.sample(c.x + rx * 6, c.y, c.z + rz * 6);
    expect(g.lateral).toBeCloseTo(6, 1);
    expect(g.halfWidth).toBeCloseTo(drivableHalfWidth(DEFAULT_TRACK_CONFIG), 6);
  });

  it('toCenter 指向中心线，且是水平单位向量', () => {
    for (const offset of [-8, 8]) {
      const c = spline.getPointAt(0.61);
      const [rx, rz] = rightOf(spline.getHeadingAt(0.61));
      const x = c.x + rx * offset;
      const z = c.z + rz * offset;
      const g = physics.sample(x, c.y, z);
      expect(Math.hypot(g.toCenterX, g.toCenterZ)).toBeCloseTo(1, 6);
      // 沿 toCenter 走 |offset| 米，应该基本回到中心线
      const back = spline.getProgress(x + g.toCenterX * Math.abs(offset), z + g.toCenterZ * Math.abs(offset));
      expect(Math.abs(back.lateral)).toBeLessThan(0.6);
    }
  });

  it('重生点落在中心线上，朝向是赛道方向', () => {
    const c = spline.getPointAt(0.44);
    const [rx, rz] = rightOf(spline.getHeadingAt(0.44));
    const g = physics.sample(c.x + rx * 30, c.y + 10, c.z + rz * 30);
    const at = spline.getProgress(g.respawnX, g.respawnZ);
    expect(Math.abs(at.lateral)).toBeLessThan(0.5);
    expect(g.respawnY).toBeCloseTo(at.centerY, 3);
    expect(Math.cos(g.respawnHeading - at.heading)).toBeCloseTo(1, 4);
  });
});
