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
  // To the 4th Ring (2026-09-30), a few hundred metres past it all round (its box: 116.268-116.484 E,
  // 39.829-39.988 N; the main box already reaches past 东四环): x the whole west - 公主坟, 军博,
  // 西客站, 丽泽, 中关村南 - s the south strip - 北京南站, 陶然亭, 大红门, 分钟寺 - v the north -
  // 北三环, 北太平庄, 奥林匹克公园 - and y the north-east corner up to 四元桥.
  { tag: 'x', s: 39.826, w: 116.264, n: 39.992, e: 116.336, chunks: 2 },
  { tag: 's', s: 39.826, w: 116.336, n: 39.857, e: 116.504, chunks: 2 },
  { tag: 'v', s: 39.953, w: 116.336, n: 39.992, e: 116.462, chunks: 2 },
  { tag: 'y', s: 39.963, w: 116.462, n: 39.992, e: 116.504, chunks: 2 },
  // 奥林匹克公园's centre (2026-10-02, 「扩到奥林匹克公园」): the map stopped behind 水立方 and 鸟巢 stood
  // outside it - o is the strip north of the 4th Ring box between 北辰西路 and 北辰东路 up to 国家会议中心.
  { tag: 'o', s: 39.992, w: 116.374, n: 40.008, e: 116.404, chunks: 1 },
  // Out past the East 4th Ring along the roads (2026-10-14, 「京通往东，五环往北，南延也行，姚家园路到机场二高，京哈往东到
  // 北京白鹿收费站，京津一小段，京沪到五环」): corridors again, not one box over the east (that alone would be ~95 km2).
  //   a 东五环 north from the e corridor to 39.962 (it curves north-west to 116.52 there), with 姚家园路 off it;
  //   b 姚家园路's motorway east to where 机场第二高速 turns north, c that road's first stretch north;
  //   d 京通快速路, 朝阳路 and 广渠快速路 east past 东五环 to 杨闸 and the 京通/通燕 split (116.61);
  //   g 东五环 south from the e corridor to 39.840 (广渠路, 京哈 at 化工桥, 京津's start), h and i 广渠路 and
  //   京哈 between the main box and it; j the ring's curve south-west and k 大羊坊, where 京沪 meets it (the s
  //   box stopped 京沪 at 39.826); l 京哈 east to 北京白鹿收费站 (116.574); m 京津 a few km south-east.
  { tag: 'a', s: 39.921, w: 116.504, n: 39.962, e: 116.548, chunks: 2 },
  { tag: 'b', s: 39.932, w: 116.548, n: 39.950, e: 116.592, chunks: 1 },
  { tag: 'c', s: 39.950, w: 116.568, n: 39.962, e: 116.592, chunks: 1 },
  { tag: 'd', s: 39.886, w: 116.550, n: 39.921, e: 116.612, chunks: 2 },
  { tag: 'g', s: 39.840, w: 116.522, n: 39.897, e: 116.550, chunks: 2 },
  { tag: 'h', s: 39.884, w: 116.504, n: 39.897, e: 116.522, chunks: 1 },
  { tag: 'i', s: 39.860, w: 116.504, n: 39.875, e: 116.522, chunks: 1 },
  { tag: 'j', s: 39.826, w: 116.504, n: 39.840, e: 116.550, chunks: 1 },
  { tag: 'k', s: 39.810, w: 116.480, n: 39.826, e: 116.525, chunks: 1 },
  { tag: 'l', s: 39.856, w: 116.550, n: 39.876, e: 116.582, chunks: 1 },
  { tag: 'm', s: 39.824, w: 116.550, n: 39.840, e: 116.580, chunks: 1 },
  // 四环到五环之间全部补上（2026-10-16，「现在把4环到5环的地图也补全」）：五环（OSM ref S50）实际在东经
  // 116.202-116.544、北纬 39.757-40.022，下面这些框把四环框和东边走廊之外、五环外几百米以内的地方铺满，互不重叠。
  // 标签两个字母也行（build.mjs / extract-pbf.mjs 认 [a-z]{0,2}）。
  //   f 西边一整条：石景山、八宝山、鲁谷、西五环，北到五环西北角；t 西南角（五环从西往南拐）；
  //   r 南边：丰台、科丰桥、南苑、旧宫一带的南五环；ra 四环框和 r 之间那一条；rb 南五环往东北拐的那段（亦庄桥西）；
  //   p / pa / pb 北边：北四环到北五环（清河、上地南、仰山、来广营），o 框上下两边空出来的留给 pa、pb；
  //   q 东北角（五环从东往北拐，来广营到望京东）；z、za 东五环南段东边原来几块走廊之间的空当。
  { tag: 'f', s: 39.840, w: 116.196, n: 40.016, e: 116.264, chunks: 2 },
  { tag: 't', s: 39.808, w: 116.208, n: 39.840, e: 116.264, chunks: 1 },
  { tag: 'r', s: 39.752, w: 116.236, n: 39.808, e: 116.440, chunks: 2 },
  { tag: 'ra', s: 39.808, w: 116.264, n: 39.826, e: 116.480, chunks: 1 },
  { tag: 'rb', s: 39.783, w: 116.440, n: 39.808, e: 116.504, chunks: 1 },
  { tag: 'p', s: 39.992, w: 116.264, n: 40.027, e: 116.374, chunks: 2 },
  { tag: 'pa', s: 39.992, w: 116.404, n: 40.027, e: 116.504, chunks: 2 },
  { tag: 'pb', s: 40.008, w: 116.374, n: 40.027, e: 116.404, chunks: 1 },
  { tag: 'q', s: 39.962, w: 116.504, n: 40.014, e: 116.536, chunks: 1 },
  { tag: 'z', s: 39.840, w: 116.504, n: 39.860, e: 116.522, chunks: 1 },
  { tag: 'za', s: 39.875, w: 116.504, n: 39.884, e: 116.522, chunks: 1 },
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
