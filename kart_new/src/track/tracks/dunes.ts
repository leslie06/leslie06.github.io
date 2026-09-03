import { DEFAULT_TRACK_CONFIG } from '../TrackConfig';
import type { TrackDefinition } from './types';

/**
 * 沙丘飞坡 —— 大起伏。
 *
 * 高差 26m、最大坡度 10.5°，是全场起伏最大的一条：过坡顶时车会短暂离地，
 * 落地那一下的镜头和音效变化就是这条道的卖点。
 * 弯反过来要缓（最小曲率半径 82m），不然又变成第二条技术道 ——
 * 一条赛道只讲一件事，讲两件就哪件都不突出。
 * 实测：周长 1017m、非相邻段最近 38m。
 *
 * 坡度上限是 15°（tracks.test.ts 盯着）：再陡的话车会真的飞出去，
 * 落地时 groundStick 拉不住，看着像 bug 而不是特技。
 */
export const DUNES: TrackDefinition = {
  id: 'dunes',
  name: '沙丘飞坡',
  subtitle: '大起大落，坡顶会腾空',
  difficulty: 3,
  laps: 3,
  points: [
    [178, 21.1, 0],
    [160, 28.5, 77],
    [102, 26.5, 128],
    [32, 16.6, 141],
    [-30, 6.2, 133],
    [-90, 3.2, 113],
    [-146, 9.8, 70],
    [-178, 21.1, 0],
    [-160, 28.5, -77],
    [-102, 26.5, -128],
    [-32, 16.6, -141],
    [30, 6.2, -133],
    [90, 3.2, -113],
    [146, 9.8, -70],
  ],
  // 裙边要垂得比默认深得多：赛道最低处是 3.2m，最高处 28.5m，
  // skirtBottomY 不够低的话坡下面会露出一圈悬空的路
  config: { ...DEFAULT_TRACK_CONFIG, skirtBottomY: -14 },
  // 箱子避开坡顶（t 大约在 0.1 / 0.35 / 0.6 / 0.85 附近）：
  // 腾空时吃不到箱子，摆在那儿等于白摆
  itemBoxRows: [
    { t: 0.2, lanes: [-5, -2.5, 0, 2.5, 5] },
    { t: 0.45, lanes: [-4, 0, 4] },
    { t: 0.7, lanes: [-5, -2.5, 0, 2.5, 5] },
    { t: 0.95, lanes: [-4, 0, 4] },
  ],
  // 沙漠正午：天顶很亮，地平线是热浪那种土黄
  sky: {
    top: '#3f9ae0',
    horizon: '#ffe3b0',
    bottom: '#c9a878',
    sun: '#fff6d8',
  },
  decor: {
    // 沙漠是空的，参照物少 —— 起伏本身已经提供了足够的速度感
    cones: 180,
    blocks: 200,
    pillarRatio: 0.4, // 高柱子当风蚀岩
    radius: [24, 500],
    palette: ['#e0b070', '#d89050', '#f0d8a8', '#c07848', '#a8683c', '#fff0d0'],
    groundColor: '#c8a067',
    groundLineColor: 'rgba(255,240,210,0.08)',
  },
};
