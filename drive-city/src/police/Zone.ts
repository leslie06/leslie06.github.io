import type { LaneGraph } from '../traffic/LaneGraph';

/**
 * 闯空侧的区域判断（2026-11-16，首都机场第三批；police/index.ts 用，单元测试 `Zone.test.ts`）。
 * 空侧多边形（`AirportApi.airside`）是建城时 4 米格子算的，有几处公共道路从它边上压过去 10–25 米（T2 门口机场高速、机场西路、
 * 机场货运路、出租车专用道；还有道口那几条 service 路伸进去一截），货运北路、航管南路从滑行道底下钻隧道，航空桥从上面过——
 * 在这些路上开车、走路都不算闯。
 */

/** 高 y 的 (x, z) 在路网的路面上（含两边 5 米的人行道），路面高度和 y 差不到 3 米（站在隧道顶上的机坪上不算在隧道里的路上）。 */
export function onPublicRoad(g: LaneGraph, x: number, y: number, z: number): boolean {
  for (const id of g.near(x, z, 30)) {
    const l = g.links[id], o = g.nearestOn(l, x, z);
    if (o.d < l.hw + 5 && Math.abs(g.heightAt(l, o.s) - y) < 3) return true;
  }
  return false;
}

/** 站在 (x, y, z) 算不算闯进了空侧：围界里、在地面上（不在桥上、隧道里）、不在公共道路上。 */
export function trespassing(airside: (x: number, z: number) => boolean, g: LaneGraph, x: number, y: number, z: number): boolean {
  if (y < -3 || y > 5) return false;
  return airside(x, z) && !onPublicRoad(g, x, y, z);
}
