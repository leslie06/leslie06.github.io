/**
 * 名片街（2026-11-11，docs/street-level-design.md 第三批 B7「名片街（规则版）」，「按你的顺序做」）：几条有名的街按规则
 * 升级成商业街——沿街的楼一律开店、不拉卷帘、都挂招牌（瓦片 worker 的 Buildings.ts 和立面着色器 Materials.ts 各算一遍，
 * 必须一致），门口挂灯笼或霓虹（visual/ShopFronts.ts），人多（people/ 的热点和 people/Strollers.ts 的逛街人群），柜台全开。
 *
 * 纯数据和几何，worker 和主线程都用：不要在这里引 three。
 *
 * - `roads`：哪条路上的门脸算（RoadPiece 的名字）；`pts` 是这条街的中线 [x, z, ...]，`r` 是离中线多远的楼算这条街的
 *   （两边的楼加上路宽）。只有朝着 `roads` 里那条路、又在走廊里的墙面才算——转角楼朝横街的那面不算。
 * - `style`：灯笼（簋街、烟袋斜街）或霓虹（三里屯）。`flavour`：招牌口味（ShopSigns.ts 的 FLAVOURS 序号 + 1），
 *   这条街上九成的招牌从这一组里抽。
 * - `walk`：不在车道图里的街（烟袋斜街是步行街，路人系统走不到）自己放一群逛街的人，值是他们在中线两边走的半宽。
 * - `busy`：一天里哪几个钟头最热闹（人数按它涨落）。
 */
export interface FamousStreet {
  id: string;
  name: { zh: string; en: string };
  roads: readonly string[];
  pts: readonly number[];
  r: number;
  style: 'lantern' | 'neon';
  flavour: number;
  walk?: number;
  /** 最热闹的钟点段 [从, 到]（可以过午夜：到 > 24）。 */
  busy: readonly [number, number];
  /**
   * 补楼（scripts/city/famous.mts → famous.gen.json）：OSM 在街边留的空当按这个规格补一排铺面——门脸离中线 `front` 米，
   * 进深、面宽在范围里随机，楼的样子从 `kinds` 里按 `share` 抽（`k` 建筑类型、`h` 总高、`rh` 坡屋顶高，0 是平顶）。
   */
  infill: { front: number; depth: readonly [number, number]; width: readonly [number, number]; kinds: readonly { k: 'trad' | 'hutong' | 'low'; h: readonly [number, number]; rh: number; share: number }[] };
}

export const FAMOUS: readonly FamousStreet[] = [
  // 鼓楼下大街（地安门外大街）往西南到银锭桥，三百来米的步行街；OSM 里是 pedestrian，车道图里没有
  { id: 'yandai', name: { zh: '烟袋斜街', en: 'Yandai Xiejie' }, roads: ['烟袋斜街'], r: 22, style: 'lantern', flavour: 6, walk: 2.1, busy: [10, 22],
    infill: { front: 3.4, depth: [6, 8], width: [6.5, 9], kinds: [{ k: 'trad', h: [5.8, 7], rh: 1.6, share: 0.5 }, { k: 'hutong', h: [4.4, 4.9], rh: 1.7, share: 0.5 }] },
    pts: [-865, -3239, -838, -3229, -811, -3220, -784, -3210, -754, -3207, -720, -3228, -704, -3233, -667, -3234] },
  // 东直门内大街，北新桥到东直门，一公里半的饭馆和红灯笼；中线在两条单向车道中间
  { id: 'guijie', name: { zh: '簋街', en: 'Gui Street' }, roads: ['东直门内大街'], r: 50, style: 'lantern', flavour: 4, busy: [17, 26],
    infill: { front: 19.5, depth: [9, 13], width: [7, 12], kinds: [{ k: 'low', h: [7, 10], rh: 0, share: 0.6 }, { k: 'trad', h: [7.5, 9], rh: 2, share: 0.4 }] },
    pts: [1113, -3414, 1480, -3421, 1870, -3426, 2133, -3430, 2400, -3436, 2511, -3437] },
  // 三里屯路，工体北路往南到太古里南头
  { id: 'sanlitun', name: { zh: '三里屯酒吧街', en: 'Sanlitun Bar Street' }, roads: ['三里屯路'], r: 45, style: 'neon', flavour: 5, busy: [19, 27],
    infill: { front: 9.5, depth: [10, 14], width: [8, 14], kinds: [{ k: 'low', h: [7, 11], rh: 0, share: 1 }] },
    pts: [4410, -2627, 4408, -2859, 4410, -2934, 4413, -3005, 4416, -3097] },
];

/** 名片街的招牌九成从本街口味里抽（别处有口味的楼是六成，ShopSigns.ts 的 FLAVOUR_SHARE）。 */
export const FAMOUS_SHARE = 90;

/** 点到折线：离中线多远 `d`、沿着中线走了多少米 `s`、在中线哪一侧 `u`（顺着走向的左手为正）。 */
export function alongLine(pts: readonly number[], x: number, z: number): { d: number; s: number; u: number } {
  let best = Infinity, bs = 0, bu = 0, run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], vx = pts[i + 2] - ax, vz = pts[i + 3] - az, L = Math.hypot(vx, vz) || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (L * L)));
    const qx = ax + vx * t, qz = az + vz * t, d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; bs = run + t * L; bu = ((x - ax) * vz - (z - az) * vx) / L; }
    run += L;
  }
  return { d: best, s: bs, u: bu };
}

/** 折线全长。 */
export function lineLength(pts: readonly number[]): number {
  let L = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) L += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return L;
}

/** 沿中线 `s` 米、往左手偏 `u` 米的点和那里的走向（单位向量）。 */
export function pointOn(pts: readonly number[], s: number, u: number, out: { x: number; z: number; dx: number; dz: number }): typeof out {
  let run = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], vx = pts[i + 2] - ax, vz = pts[i + 3] - az, L = Math.hypot(vx, vz) || 1;
    if (s <= run + L || i + 4 >= pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - run) / L)), dx = vx / L, dz = vz / L;
      // 左手：(dz, -dx)（x 往东、z 往南，顺着走向看）
      out.x = ax + vx * t + dz * u; out.z = az + vz * t - dx * u; out.dx = dx; out.dz = dz;
      return out;
    }
    run += L;
  }
  return out;
}

const BOX = FAMOUS.map((f) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < f.pts.length; i += 2) { x0 = Math.min(x0, f.pts[i]); x1 = Math.max(x1, f.pts[i]); z0 = Math.min(z0, f.pts[i + 1]); z1 = Math.max(z1, f.pts[i + 1]); }
  return [x0 - f.r, x1 + f.r, z0 - f.r, z1 + f.r];
});

/** (x, z) 在哪条名片街的走廊里：0 不在，否则 FAMOUS 序号 + 1。 */
export function famousAt(x: number, z: number, pad = 0): number {
  for (let i = 0; i < FAMOUS.length; i++) {
    const b = BOX[i];
    if (x < b[0] - pad || x > b[1] + pad || z < b[2] - pad || z > b[3] + pad) continue;
    if (alongLine(FAMOUS[i].pts, x, z).d < FAMOUS[i].r + pad) return i + 1;
  }
  return 0;
}

/** 一个是不是正在热闹的钟点：0..1（最热闹的时段里是 1，前后各两个钟头渐变，别的时候 0.3）。 */
export function busyAt(f: FamousStreet, hour: number): number {
  const [a, b] = f.busy;
  let best = 0;
  for (const h of [hour, hour + 24]) {
    const k = h < a ? 1 - (a - h) / 2 : h > b ? 1 - (h - b) / 2 : 1;
    best = Math.max(best, Math.max(0, Math.min(1, k)));
  }
  return 0.3 + 0.7 * best;
}

/**
 * 贴着名片街街面的院墙（OSM 的 barrier=wall，建筑类型 'wall'）：烟袋斜街两边贴街一溜都是院墙，真街上那一线是铺面。
 * 每个顶点都在中线 `front + 3` 米以内的墙拆掉（Buildings.ts 不画，scripts/city/famous.mts 不当它挡路），让补的铺面顶上。
 */
export function streetWall(o: readonly number[]): boolean {
  let x = 0, z = 0;
  for (let i = 0; i < o.length; i += 2) { x += o[i]; z += o[i + 1]; }
  const f = famousAt(x / (o.length / 2), z / (o.length / 2));
  if (!f) return false;
  const st = FAMOUS[f - 1];
  for (let i = 0; i < o.length; i += 2) if (alongLine(st.pts, o[i], o[i + 1]).d > st.infill.front + 3) return false;
  return true;
}
