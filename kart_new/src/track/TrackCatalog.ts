/**
 * 可选赛道表。纯数据，不 import three / rapier / DOM。
 *
 * ## 加一条赛道 = 往 TRACKS 里加一条
 *
 * 一条赛道 = 一组控制点 + 一份 TrackConfig + 一排道具箱位置。别处不许再写
 * `if (trackId === ...)`：难度、圈数、路宽全是这里的字段。
 *
 * ## 控制点怎么来的
 *
 * 三条都是用"半径随角度变化的星形"生成再取整的（星形保证不自交），
 * 生成之后跑 TrackCatalog.test.ts 验四件事：不自交、坡度、最小曲率半径、
 * 相邻控制点间距。手改控制点之后一定要跑那个测试 —— 自交的赛道在
 * getProgress 里表现为"进度突然跳一大截"，很难当场看出来。
 *
 * 最小曲率半径这个数是有讲究的：满速时普通转向的转弯半径 ≈ maxSpeed /
 * (turnRate * highSpeedSteerFactor) ≈ 30m。所以
 *   > 30m 的弯 = 不减速也能过（新手道）；
 *   ≈ 33m     = 临界，减速更稳（默认道）；
 *   < 30m     = 必须松油门或者漂移（高手道）。
 */
import type { ControlPoint, ItemBoxRow, TrackConfig } from './TrackConfig';
import { DEFAULT_TRACK_CONFIG, ITEM_BOX_ROWS, TRACK_CONTROL_POINTS } from './TrackConfig';

export type TrackId = 'sunset' | 'meadow' | 'ridge';

export interface TrackVariant {
  id: TrackId;
  /** 赛道选择界面上的名字 */
  name: string;
  /** 一句话说清它跟别的不一样在哪 */
  subtitle: string;
  /** 1..3，界面上画成星星 */
  difficulty: 1 | 2 | 3;
  /** 这条道跑几圈。长道少跑一圈，一局的时长才差不多 */
  laps: number;
  points: readonly ControlPoint[];
  config: TrackConfig;
  itemBoxRows: readonly ItemBoxRow[];
}

/** 新手道：又宽又平的大回环，最小曲率半径 62m —— 全程不用松油门 */
const MEADOW_POINTS: readonly ControlPoint[] = [
  [141, 7, 0],
  [133, 7.1, 77],
  [73, 5.1, 126],
  [0, 3, 123],
  [-55, 2.9, 95],
  [-103, 4.9, 59],
  [-141, 7, 0],
  [-133, 7.1, -77],
  [-73, 5.1, -126],
  [0, 3, -123],
  [55, 2.9, -95],
  [103, 4.9, -59],
];

/** 高手道：窄、长、起伏大，最小曲率半径 24m —— 好几个弯必须减速或者漂过去 */
const RIDGE_POINTS: readonly ControlPoint[] = [
  [177, 13.7, 0],
  [184, 12.9, 67],
  [116, 8.2, 98],
  [59, 4.3, 102],
  [26, 5.1, 148],
  [-34, 9.8, 192],
  [-89, 13.7, 155],
  [-98, 12.9, 82],
  [-119, 8.2, 43],
  [-177, 4.3, 0],
  [-184, 5.1, -67],
  [-116, 9.8, -98],
  [-59, 13.7, -102],
  [-26, 12.9, -148],
  [34, 8.2, -192],
  [89, 4.3, -155],
  [98, 5.1, -82],
  [119, 9.8, -43],
];

/**
 * 道具箱的排布。lanes 是相对中心线的横向偏移（米），必须落在柏油上，
 * 也就是 |lane| < trackWidth / 2。窄道的箱子排得也窄，不然会长到路肩上。
 */
const MEADOW_BOXES: readonly ItemBoxRow[] = [
  { t: 0.1, lanes: [-6, -3, 0, 3, 6] },
  { t: 0.3, lanes: [-4.5, 0, 4.5] },
  { t: 0.52, lanes: [-6, -3, 0, 3, 6] },
  { t: 0.74, lanes: [-4.5, 0, 4.5] },
];

const RIDGE_BOXES: readonly ItemBoxRow[] = [
  { t: 0.06, lanes: [-4.5, -2.2, 0, 2.2, 4.5] },
  { t: 0.2, lanes: [-3.5, 0, 3.5] },
  { t: 0.35, lanes: [-4.5, -2.2, 0, 2.2, 4.5] },
  { t: 0.5, lanes: [-3.5, 0, 3.5] },
  { t: 0.64, lanes: [-4.5, -2.2, 0, 2.2, 4.5] },
  { t: 0.79, lanes: [-3.5, 0, 3.5] },
  { t: 0.91, lanes: [-3.5, 0, 3.5] },
];

export const TRACKS: Readonly<Record<TrackId, TrackVariant>> = Object.freeze({
  meadow: {
    id: 'meadow',
    name: '草原环线',
    subtitle: '又宽又平，适合摸手感',
    difficulty: 1,
    laps: 3,
    points: MEADOW_POINTS,
    // 路面比默认宽 3m、路肩也宽一点：新手压线的余量要够
    config: { ...DEFAULT_TRACK_CONFIG, trackWidth: 20, shoulderWidth: 2.8 },
    itemBoxRows: MEADOW_BOXES,
  },
  sunset: {
    id: 'sunset',
    name: '黄昏赛道',
    subtitle: '标准长度，几个弯要减速',
    difficulty: 2,
    laps: 3,
    points: TRACK_CONTROL_POINTS,
    config: DEFAULT_TRACK_CONFIG,
    itemBoxRows: ITEM_BOX_ROWS,
  },
  ridge: {
    id: 'ridge',
    name: '山脊长道',
    subtitle: '又窄又长，起伏大',
    difficulty: 3,
    // 一圈 1200m，比默认长两成，所以少跑一圈，一局的时长才差不多
    laps: 2,
    points: RIDGE_POINTS,
    config: { ...DEFAULT_TRACK_CONFIG, trackWidth: 15, shoulderWidth: 2.2, meshSegments: 560 },
    itemBoxRows: RIDGE_BOXES,
  },
});

/** 选择界面上的显示顺序：由易到难 */
export const TRACK_IDS: readonly TrackId[] = ['meadow', 'sunset', 'ridge'] as const;

export const DEFAULT_TRACK_ID: TrackId = 'sunset';

export function isTrackId(value: unknown): value is TrackId {
  return value === 'meadow' || value === 'sunset' || value === 'ridge';
}

export function trackAt(id: TrackId): TrackVariant {
  return TRACKS[id];
}
