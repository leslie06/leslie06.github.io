import { DEFAULT_TRACK_CONFIG } from '../TrackConfig';
import type { TrackDefinition } from './types';

/**
 * 草原环线 —— 平坦高速。
 *
 * 最小曲率半径 62m，是满速转弯半径（约 30m）的两倍：**全程不用松油门**。
 * 路面比默认宽 3m，路肩也宽，压线的余量足。第一次开的人应该从这条开始。
 * 实测：周长 850m、最大坡度 2.2°、高差 4.6m。
 */
export const MEADOW: TrackDefinition = {
  id: 'meadow',
  name: '草原环线',
  subtitle: '又宽又平，全程不用松油门',
  difficulty: 1,
  laps: 3,
  points: [
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
  ],
  config: { ...DEFAULT_TRACK_CONFIG, trackWidth: 20, shoulderWidth: 2.8 },
  // 路宽 20m，所以箱子能摆到 ±6 还留着两米柏油
  itemBoxRows: [
    { t: 0.1, lanes: [-6, -3, 0, 3, 6] },
    { t: 0.3, lanes: [-4.5, 0, 4.5] },
    { t: 0.52, lanes: [-6, -3, 0, 3, 6] },
    { t: 0.74, lanes: [-4.5, 0, 4.5] },
  ],
  // 正午偏早的晴天：天蓝、地绿，最"标准"的一套，衬托它是入门道
  sky: {
    top: '#2f86dd',
    horizon: '#a9daff',
    bottom: '#7ea7bd',
    sun: '#ffeec4',
  },
  decor: {
    cones: 260,
    blocks: 235,
    pillarRatio: 0.23,
    radius: [20, 480],
    palette: ['#ff5d5d', '#ffd23f', '#3ddc97', '#4d9bff', '#ff8ac4', '#ffffff'],
    groundColor: '#4f7a45',
    groundLineColor: 'rgba(255,255,255,0.10)',
  },
};
