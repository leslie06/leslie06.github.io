/**
 * 赛道的尺寸参数和几个共用的类型。
 *
 * **具体某条赛道长什么样不在这里** —— 控制点、道具箱位置、天空配色都在
 * src/track/tracks/ 下，每条赛道一个文件。这里只留"所有赛道都要填的那几个尺寸"
 * 和它们的默认值。
 */

/** 控制点顺序 = 行驶方向。第一个点是出生点，闭合样条会把最后一个点接回第一个 */
export type ControlPoint = readonly [x: number, y: number, z: number];

export interface TrackConfig {
  /** 路面总宽度（米） */
  trackWidth: number;
  /** 单侧路肩宽度（减速带），在路面之外 */
  shoulderWidth: number;
  /** 路肩相对路面下沉多少，做出一点台阶感 */
  shoulderDrop: number;
  /** 护栏高度 */
  wallHeight: number;
  /** 护栏厚度 */
  wallThickness: number;
  /** 生成网格时沿样条采样多少段。越多越圆滑，也越吃三角形 */
  meshSegments: number;
  /** getProgress 用的预采样点数 */
  lutSamples: number;
  /** 路面纹理沿长度方向多少米平铺一次 */
  roadTileLength: number;
  /** 路肩条纹多少米一格 */
  shoulderTileLength: number;
  /** 赛道边缘往下延伸到这个高度，挡住路面悬空的缝 */
  skirtBottomY: number;
}

export const DEFAULT_TRACK_CONFIG: TrackConfig = {
  trackWidth: 17,
  shoulderWidth: 2.4,
  shoulderDrop: 0.12,
  wallHeight: 1.5,
  wallThickness: 0.7,
  meshSegments: 480,
  lutSamples: 500,
  roadTileLength: 9,
  shoulderTileLength: 3,
  skirtBottomY: -4,
};

/**
 * 道具箱的一"排"：同一个赛道进度 t 上横着摆的几个箱子，
 * lanes 是各自相对中心线的横向偏移（米，正 = 车手视角右侧）。
 * 每条赛道自己的排布在 src/track/tracks/ 下。
 */
export interface ItemBoxRow {
  /** 沿样条的进度 0..1 */
  t: number;
  /** 这一排每个箱子的横向偏移（米） */
  lanes: readonly number[];
}

/** 可行驶半宽 = 路面一半 + 路肩。超出它就撞护栏。 */
export function drivableHalfWidth(cfg: Readonly<TrackConfig>): number {
  return cfg.trackWidth / 2 + cfg.shoulderWidth;
}
