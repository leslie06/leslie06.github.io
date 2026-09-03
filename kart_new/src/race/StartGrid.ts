/**
 * 发车格。纯逻辑，只吃 AITrack 这个裸数字赛道接口。
 *
 * ## 为什么发车格全部排在起点线**之后**（t > 0）而不是之前
 *
 * RaceProgress 用 checkpoint 判圈，起点线就是 checkpoint 0。车要是停在线前面
 * （t ≈ 0.99），发车瞬间它的 totalProgress = lap + t = 0.99，排名会显示它领先一整圈；
 * 等它过了线 t 掉回 0 才恢复正常。倒计时那几秒的名次表就是乱的。
 *
 * 排在线后就没这个问题：所有人 t 都接近 0，名次从第一帧起就是对的，
 * 而且"格子越靠前 = 要跑的距离越短"这个杆位优势也自然成立。
 *
 * ## 排法
 *
 * 两列错开，前排离线最远（= 杆位）。slot 0 是杆位，序号越大越靠后。
 */
import type { AITrack, AITrackPoint } from '../ai/AITrack';
import { createTrackPoint, shiftLateral, wrap01 } from '../ai/AITrack';

export interface StartGridOptions {
  /** 每排之间的纵向间距（米） */
  rowSpacing?: number;
  /** 左右两列相对中心线的横向偏移（米） */
  columnOffset?: number;
  /** 最后一排离起点线多远（米）。别贴着线，不然发车抖一下就退回线外了 */
  lineMargin?: number;
  /** 一排几辆车 */
  columns?: number;
}

export interface GridSlot {
  /** 这个格子在样条上的进度 0..1 */
  t: number;
  x: number;
  z: number;
  /** 朝向 = 该处赛道切线 */
  heading: number;
  /** 相对中心线的横向偏移（米，正 = 右） */
  lateral: number;
}

export const DEFAULT_START_GRID_OPTIONS: Required<StartGridOptions> = {
  rowSpacing: 7,
  columnOffset: 3.4,
  lineMargin: 2,
  columns: 2,
};

/**
 * 排 count 个发车格。返回数组的下标就是格位：0 = 杆位。
 *
 * @param track 只用到 length 和 sampleAt，所以赛道换成什么都行
 */
export function buildStartGrid(
  track: AITrack,
  count: number,
  options: StartGridOptions = {},
): GridSlot[] {
  const opt = { ...DEFAULT_START_GRID_OPTIONS, ...options };
  const columns = Math.max(1, Math.floor(opt.columns));
  const rows = Math.max(1, Math.ceil(count / columns));
  const length = Math.max(track.length, 1e-6);
  const point: AITrackPoint = createTrackPoint();
  const slots: GridSlot[] = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    // 杆位（row 0）离线最远，往后每排靠近一点
    const ahead = opt.lineMargin + (rows - 1 - row) * opt.rowSpacing;
    const t = wrap01(ahead / length);
    // 单列时居中；多列时以中心线为轴左右分开
    const lateral =
      columns === 1 ? 0 : (col - (columns - 1) / 2) * 2 * opt.columnOffset;

    track.sampleAt(t, point);
    const heading = point.heading;
    shiftLateral(point, lateral);
    slots.push({ t, x: point.x, z: point.z, heading, lateral });
  }
  return slots;
}
