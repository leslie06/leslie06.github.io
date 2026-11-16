/**
 * public/city/airfield.json（scripts/city/airfield.mjs，2026-11-16）：首都机场的跑道、滑行道图、机位、廊桥、围界。
 * 坐标都是游戏米（+X 东、+Z 南），折线压平成 [x, z, x, z, ...]。
 */
export interface AirfieldData {
  v: number;
  /** 跑道和滑行道共用的节点表 [x, z, ...]：OSM 里同一个节点（滑行道接上跑道的地方）是同一个下标。 */
  nodes: number[];
  runways: { ref: string; w: number; p: number[]; n: number[] }[];
  stopways: { w: number; p: number[] }[];
  taxiways: { ref: string; w: number; p: number[]; n: number[] }[];
  /** 机位：停机点和机头朝向（沿 OSM 那条线从滑行道指向停机点；点要素没有）。 */
  stands: { ref: string; x: number; z: number; yaw?: number }[];
  bridges: { ref: string; p: number[] }[];
  terminals: { name: string; ref: string; kind: string; c: [number, number]; h: number }[];
  /** 空侧勤务道（不在路网里）。 */
  roads: { w: number; p: number[] }[];
  /** 围界折线（建城时沿空侧的边，贴着航站楼的几段去掉了）。 */
  fence: number[][];
  /** 空侧多边形的外环和洞（第三批加的；老的 airfield.json 没有）。 */
  air?: number[][];
  airHoles?: number[][];
}

/** 机场多边形的范围（游戏米），数据下载之前就要知道：开近了才下载。 */
export const AIRPORT_BOX = { x0: 14365, z0: -22951, x1: 19155, z1: -15225 };

export async function loadAirfield(): Promise<AirfieldData> {
  if (typeof window === 'undefined') {
    const fs = await import(/* @vite-ignore */ 'node:fs');
    return JSON.parse(fs.readFileSync('public/city/airfield.json', 'utf8')) as AirfieldData;
  }
  const r = await fetch(new URL(`${import.meta.env.BASE_URL}city/airfield.json`, document.baseURI).href);
  if (!r.ok) throw new Error(`airfield.json: HTTP ${r.status}`);
  return (await r.json()) as AirfieldData;
}
