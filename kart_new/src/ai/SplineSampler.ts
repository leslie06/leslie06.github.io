/**
 * TrackSpline -> AITrack 的适配器。
 *
 * 只用 type-only import 拿 TrackSpline 的类型，实例由外面传进来，
 * 所以这个文件（以及经它进入 AI 层的一切）在运行时**不依赖 three**。
 */
import type { AITrack, AITrackPoint } from './AITrack';
import type { TrackSpline } from '../track/TrackSpline';

/**
 * 除了 AITrack 的前瞻采样，再补一个"世界坐标 -> 进度"的反查。
 * 投射物飞行时要知道自己在赛道的哪一段，才能沿着样条拐弯。
 */
export interface SplineSampler extends AITrack {
  progressAt(x: number, z: number): number;
}

export function createSplineSampler(spline: TrackSpline): SplineSampler {
  // 复用的中间向量 / 结果对象，避免每帧新建
  const point = spline.getPointAt(0);
  const progress = spline.getProgress(0, 0);

  return {
    length: spline.length,
    progressAt(x: number, z: number): number {
      return spline.getProgress(x, z, progress).t;
    },
    sampleAt(t: number, out: AITrackPoint): AITrackPoint {
      // getPointAt 写的是自己的 target，getHeadingAt 用的是 spline 内部的 tmpA，
      // 两者互不干扰，但顺序还是照 PhysicsSystem 里的老规矩：先取点再取朝向
      spline.getPointAt(t, point);
      out.x = point.x;
      out.z = point.z;
      out.heading = spline.getHeadingAt(t);
      return out;
    },
  };
}
