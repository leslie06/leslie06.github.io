// The playable area and the map projection. Shared by the data scripts (Node) and mirrored in
// src/city/Geo.ts for the game. Origin: the Tiananmen gate. Local metres, +X east, +Z south.
export const ORIGIN = { lat: 39.90883, lon: 116.39757 };
// Extended south-east on 2026-09-12 to reach 北京欢乐谷 (39.8637 N, 116.4937 E) and the East 4th
// Ring Road with it. The projection origin is unchanged, so every tile already built keeps its key.
export const BBOX = { s: 39.857, w: 116.386, n: 39.926, e: 116.504 };
export const CHUNKS = 4;   // 16 chunks of ~2.0 x 2.5 km: the 5.3 MB chunk was already near the Overpass timeout.
// Corridors added on 2026-09-29 (「东四环延长到东风北桥，京通快速往东」): the playable area is the main box
// plus these, not one bigger box - a box reaching 东风北桥 across the whole width would have doubled the
// city. Each is fetched as `chunks` x `chunks` requests into chunk-<tag><i>-<j>.json.
//   n: 东四环北段 from 红领巾桥 past 朝阳公园桥 and 双新桥 to 东风北桥, with 朝阳公园 beside it.
//   e: 京通快速路 east from 四惠 past 高碑店桥 to the 东五环 interchange, with 朝阳路 and 建国路.
//   w, u (2026-09-29, 「一路做到四环」, first the whole old city): w the west of it - 西单, 金融街, 西二环,
//   中南海, 北海 - and u its north - 什刹海, 鼓楼, 南锣鼓巷, 雍和宫, 地坛, 东直门, 工体, 三里屯 - both to
//   a few hundred metres past the 2nd Ring (w 116.342, n 39.948), u running on east to the n corridor.
export const EXTRA = [
  { tag: 'n', s: 39.926, w: 116.462, n: 39.963, e: 116.504, chunks: 2 },
  { tag: 'e', s: 39.897, w: 116.504, n: 39.921, e: 116.550, chunks: 2 },
  { tag: 'w', s: 39.857, w: 116.336, n: 39.926, e: 116.386, chunks: 2 },
  { tag: 'u', s: 39.926, w: 116.336, n: 39.953, e: 116.462, chunks: 2 },
];
/** Every box of the playable area, the main one first. */
export const REGIONS = [BBOX, ...EXTRA];
export const TILE = 256;
const R = 6378137;
export function project(lat, lon) {
  const x = (lon - ORIGIN.lon) * Math.PI / 180 * R * Math.cos(ORIGIN.lat * Math.PI / 180);
  const z = -(lat - ORIGIN.lat) * Math.PI / 180 * R;
  return [x, z];
}
