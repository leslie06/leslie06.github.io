/**
 * 赛道形状与尺寸。控制点带 y，赛道是有起伏的。
 *
 * 控制点顺序 = 行驶方向。第一个点是出生点，闭合样条会自动把最后一个点接回第一个。
 * 改控制点时注意两件事：
 *   1. 相邻点别太近（< 30m 左右），CatmullRom 会在那里鼓出一个尖角；
 *   2. 不相邻的两段别靠得比 (trackWidth + shoulderWidth * 2) 还近，否则赛道会自己叠自己。
 * TrackSpline.test.ts 里有一条用例专门盯着第 2 点。
 */
export type ControlPoint = readonly [x: number, y: number, z: number];

export const TRACK_CONTROL_POINTS: readonly ControlPoint[] = [
  [168, 11.3, 0],
  [142, 12.3, 52],
  [118, 10.8, 99],
  [85, 8.1, 147],
  [23, 6.2, 133],
  [-17, 6.5, 96],
  [-62, 8.2, 108],
  [-118, 9.4, 99],
  [-124, 8.4, 45],
  [-128, 5.4, 0],
  [-154, 2, -56],
  [-126, 0.1, -106],
  [-67, 0, -116],
  [-25, 1, -141],
  [27, 2.1, -154],
  [58, 3.5, -100],
  [71, 5.6, -60],
  [128, 8.6, -47],
];

/**
 * 上面这组点是用"半径随角度变化的星形"生成再手工取整的（星形保证不自交），
 * 实测：周长约 1010m、最小曲率半径 33m、非相邻段最近 34m、最大坡度 4.4°、高差 12m。
 * 最小曲率半径这个数是有讲究的：满速时普通转向的转弯半径 ≈ maxSpeed / (turnRate *
 * highSpeedSteerFactor) ≈ 30m，所以 33m 的弯刚好是"不减速能过、减速更稳"的临界，
 * 再紧就变成必须松油门了。改控制点后跑一下 TrackSpline.test.ts。
 */

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
 * 道具箱的摆放。
 *
 * 一"排"是同一个赛道进度 t 上横着摆的几个箱子，lanes 是各自相对中心线的横向偏移
 * （米，正 = 车手视角右侧）。路面半宽 8.5m，所以 lanes 控制在 ±6 以内，
 * 让箱子留在柏油上而不是路肩上。
 *
 * t 的选点原则：放在直道和出弯处，别放在弯心 —— 弯心上抢箱子会逼着人切内线撞墙。
 */
export interface ItemBoxRow {
  /** 沿样条的进度 0..1 */
  t: number;
  /** 这一排每个箱子的横向偏移（米） */
  lanes: readonly number[];
}

export const ITEM_BOX_ROWS: readonly ItemBoxRow[] = [
  { t: 0.08, lanes: [-5, -2.5, 0, 2.5, 5] },
  { t: 0.24, lanes: [-4, 0, 4] },
  { t: 0.38, lanes: [-5, -2.5, 0, 2.5, 5] },
  { t: 0.52, lanes: [-4, 0, 4] },
  { t: 0.66, lanes: [-5, -2.5, 0, 2.5, 5] },
  { t: 0.81, lanes: [-4, 0, 4] },
];

/** 可行驶半宽 = 路面一半 + 路肩。超出它就撞护栏。 */
export function drivableHalfWidth(cfg: Readonly<TrackConfig>): number {
  return cfg.trackWidth / 2 + cfg.shoulderWidth;
}
