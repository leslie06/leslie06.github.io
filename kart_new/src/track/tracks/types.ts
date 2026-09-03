/**
 * 一条赛道的完整定义。纯数据，不 import three / rapier / DOM。
 *
 * "一条赛道"包含的东西全在这里：形状、路宽、道具箱、装饰物、天空配色、难度、圈数。
 * 每条赛道一个文件（同目录下），index.ts 把它们收成一张表。
 *
 * ## 加一条赛道
 * 1. 抄一份同目录下的文件改控制点和配色；
 * 2. 在 index.ts 的 TRACKS 里挂上；
 * 3. 跑 `npm test` —— tracks.test.ts 会验不自交、坡度、最小曲率半径、
 *    相邻控制点间距、道具箱在不在柏油上。**别跳过这一步**：自交的赛道跑起来
 *    只表现为"进度突然跳一大截"，肉眼很难当场看出来是赛道的问题。
 *
 * ## 控制点怎么来的
 * 都是用"半径随角度变化的星形"生成再取整的 —— 星形天然不自交。
 * 生成脚本不在仓库里（一次性的），要新形状的话照着 tracks.test.ts 的判据手调也行。
 *
 * 最小曲率半径这个数决定赛道的性格：满速时普通转向的转弯半径约 30m，所以
 *   > 50m = 全程不用松油门；≈ 33m = 临界；< 30m = 必须减速或者漂过去。
 */
import type { ControlPoint, ItemBoxRow, TrackConfig } from '../TrackConfig';

/** 天空与雾的配色。雾色取 horizon —— 两者必须是同一个值，否则远处一条硬边 */
export interface TrackSkyColors {
  /** 天顶 */
  top: string;
  /** 地平线。**雾色就是它** */
  horizon: string;
  /** 地平线以下（地面方向的天光） */
  bottom: string;
  /** 太阳光晕 */
  sun: string;
}

/**
 * 赛道两侧撒的参照物。它们的作用是给速度感一个参照 —— 没有参照物的话，
 * 一条空旷的路上开 100km/h 和 40km/h 看着差不多。
 *
 * 数量是"满档数量"，实际画多少由画质档位的 propDensity 再乘一次（见 World.setQuality）。
 */
export interface TrackDecor {
  /** 锥形物（树/锥桶）的满档数量 */
  cones: number;
  /** 方块和柱子的满档数量 */
  blocks: number;
  /** 后面多少个方块长成高柱子（远处也能看出在移动）。0..1 的比例 */
  pillarRatio: number;
  /** 撒的范围：距原点的最小/最大半径（米） */
  radius: readonly [min: number, max: number];
  /** 配色。每条赛道一套，这是"换了个地方"最省事也最有效的信号 */
  palette: readonly string[];
  /** 地面（草地/沙地）的底色 */
  groundColor: string;
  /** 地面网格线的颜色。太扎眼会让人分心，一般是底色的浅一档 */
  groundLineColor: string;
}

export type TrackId = 'meadow' | 'sunset' | 'ridge' | 'dunes';

export interface TrackDefinition {
  id: TrackId;
  /** 赛道选择界面上的名字 */
  name: string;
  /** 一句话说清它跟别的不一样在哪 */
  subtitle: string;
  /** 1..3，界面上画成圆点 */
  difficulty: 1 | 2 | 3;
  /** 这条道跑几圈。长道少跑一圈，一局的时长才差不多 */
  laps: number;
  points: readonly ControlPoint[];
  config: TrackConfig;
  itemBoxRows: readonly ItemBoxRow[];
  sky: TrackSkyColors;
  decor: TrackDecor;
}
