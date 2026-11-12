// 名片街补楼（2026-11-11，docs/street-level-design.md B7，src/city/Famous.ts）：OSM 在这几条街边留了很多空当（烟袋斜街两边
// 的房子东一块西一块，簋街南边的胡同房退在行道树后面，三里屯的店隔着绿化带），光给现有的墙开店连不成一条街。这里沿街两边
// 按 Famous.ts 的 `infill` 规格一间挨一间排铺面：离中线 `front` 米起，面宽、进深、高度按哈希抽；跟现有房子、别的路
// （横街、胡同口、小区路：离路面 2.5 米以内）、水面、名片街本身的路面重叠的就跳过。写 src/city/famous.gen.json，瓦片
// worker 打包它，把补的楼当普通房子加进对应瓦片（地标的 footprint / clear 照样能删），楼底下的树、路灯、停的车清掉。
// 不是 build.mjs 的一步：改了 Famous.ts 的表或者重建了城市再跑：npx tsx scripts/city/famous.mts。改完重启开发服务器。
import fs from 'node:fs';
import path from 'node:path';
import type { BuildingRec, RoadPiece, TileData } from '../../src/city/Data';
import { FAMOUS, lineLength, pointOn, streetWall } from '../../src/city/Famous';

const DIR = path.resolve('public/city'), TILE = 256;
/** 别的路离补的楼至少多远（路面边上留出人行道）；名片街自己的路面离门脸至少多远。 */
const ROAD_GAP = 2.5, OWN_GAP = 0.4;

const tiles = new Map<string, TileData | null>();
const tile = (ix: number, iz: number): TileData | null => {
  const k = `${ix}_${iz}`;
  if (!tiles.has(k)) { const f = path.join(DIR, `t_${k}.json`); tiles.set(k, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as TileData : null); }
  return tiles.get(k)!;
};

// 哈希（和游戏里一样确定：同一份数据每次跑出同样的楼）
const hash = (a: number, b: number): number => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; return (h >>> 0) / 4294967296; };

type Poly = number[];
const inside = (x: number, z: number, p: Poly): boolean => {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2));
  return Math.hypot(ax + vx * t - px, az + vz * t - pz);
};
const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean => {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return o(ax, az, bx, bz, cx, cz) !== o(ax, az, bx, bz, dx, dz) && o(cx, cz, dx, dz, ax, az) !== o(cx, cz, dx, dz, bx, bz);
};
/** 两个多边形重不重叠（边相交，或一个的顶点在另一个里面）。 */
const overlap = (a: Poly, b: Poly): boolean => {
  for (let i = 0; i < a.length; i += 2) if (inside(a[i], a[i + 1], b)) return true;
  for (let i = 0; i < b.length; i += 2) if (inside(b[i], b[i + 1], a)) return true;
  for (let i = 0; i < a.length; i += 2) {
    const i2 = (i + 2) % a.length;
    for (let j = 0; j < b.length; j += 2) { const j2 = (j + 2) % b.length; if (cross(a[i], a[i + 1], a[i2], a[i2 + 1], b[j], b[j + 1], b[j2], b[j2 + 1])) return true; }
  }
  return false;
};
/** 多边形离一条折线多近（顶点到线段、线段顶点到多边形边；穿过去算 0）。 */
const polyLineDist = (a: Poly, p: number[]): number => {
  let d = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    for (let k = 0; k < a.length; k += 2) {
      const k2 = (k + 2) % a.length;
      if (cross(a[k], a[k + 1], a[k2], a[k2 + 1], p[i], p[i + 1], p[i + 2], p[i + 3])) return 0;
      d = Math.min(d, segDist(a[k], a[k + 1], p[i], p[i + 1], p[i + 2], p[i + 3]), segDist(p[i], p[i + 1], a[k], a[k + 1], a[k2], a[k2 + 1]));
    }
  }
  for (let i = 0; i < p.length; i += 2) if (inside(p[i], p[i + 1], a)) return 0;
  return d;
};
const grow = (a: Poly, m: number): Poly => {
  let cx = 0, cz = 0; for (let i = 0; i < a.length; i += 2) { cx += a[i]; cz += a[i + 1]; } cx /= a.length / 2; cz /= a.length / 2;
  return a.map((v, i) => (i % 2 ? cz + (v - cz) * (1 + m / Math.max(1, Math.hypot(a[i - 1] - cx, v - cz))) : cx + (v - cx) * (1 + m / Math.max(1, Math.hypot(v - cx, a[i + 1] - cz)))));
};

const out: BuildingRec[] = [];
const stats: string[] = [];
let id = 0;
FAMOUS.forEach((f, fi) => {
  const len = lineLength(f.pts), sp = f.infill;
  // 这条街两边的瓦片：房子、路、水面
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < f.pts.length; i += 2) { x0 = Math.min(x0, f.pts[i]); x1 = Math.max(x1, f.pts[i]); z0 = Math.min(z0, f.pts[i + 1]); z1 = Math.max(z1, f.pts[i + 1]); }
  const pad = sp.front + sp.depth[1] + 40, blds: Poly[] = [], roads: RoadPiece[] = [], water: Poly[] = [];
  for (let ix = Math.floor((x0 - pad) / TILE); ix <= Math.floor((x1 + pad) / TILE); ix++) for (let iz = Math.floor((z0 - pad) / TILE); iz <= Math.floor((z1 + pad) / TILE); iz++) {
    const t = tile(ix, iz);
    if (!t) continue;
    for (const b of t.buildings) if (!(b.k === 'wall' && streetWall(b.o))) blds.push(b.o);
    for (const r of t.roads) roads.push(r);
    for (const a of t.areas) if (a.k === 'water') water.push(a.o);
  }
  let made = 0, tried = 0; const reasons: Record<string, number> = {};
  const m = { x: 0, z: 0, dx: 0, dz: 0 }, put: Poly[] = [];
  for (const side of [1, -1]) {
    let s = 2;
    while (s < len - 2) {
      const r1 = hash(fi * 7919 + (side > 0 ? 1 : 2), Math.round(s * 10)), r2 = hash(Math.round(s * 10), fi * 31 + side), r3 = hash(Math.round(s * 7), fi * 131 + side * 3);
      const W = sp.width[0] + r1 * (sp.width[1] - sp.width[0]), D = sp.depth[0] + r2 * (sp.depth[1] - sp.depth[0]);
      if (s + W > len - 2) break;
      tried++;
      // 门脸两头在中线 side 那一侧 front 米处，屋后再往外 d 米（弯道上两头各按自己那一点的走向）
      const fit = (w: number, d: number) => {
        const a = pointOn(f.pts, s, side * sp.front, { ...m }), b = pointOn(f.pts, s + w, side * sp.front, { ...m });
        const nx = (a.dz + b.dz) / 2 * side, nz = -(a.dx + b.dx) / 2 * side, nl = Math.hypot(nx, nz) || 1;
        const ox = nx / nl * d, oz = nz / nl * d;
        let ring: Poly = [a.x, a.z, b.x, b.z, b.x + ox, b.z + oz, a.x + ox, a.z + oz];
        // 外环要正面积（Buildings.ts：正面积的外环，法线朝外）
        let area = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; area += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
        if (area < 0) ring = [a.x + ox, a.z + oz, b.x + ox, b.z + oz, b.x, b.z, a.x, a.z];
        const g = grow(ring, 0.35);
        const why = blds.some((o) => overlap(g, o)) ? 'bld' : put.some((o) => overlap(ring, o)) ? 'self' : water.some((o) => overlap(g, o)) ? 'water'
          : roads.find((r) => { const own = f.roads.includes(r.n ?? ''); const dd = polyLineDist(ring, r.p) - r.w / 2; return dd < (own ? OWN_GAP : r.c === 'footway' || r.c === 'steps' || r.c === 'path' ? 0.3 : ROAD_GAP); });
        return { a, b, ox, oz, ring, w, d, why };
      };
      // 碰上了就缩：先缩进深，再缩面宽（最小 4 米宽、3.5 米深的一间小铺子）
      let got = fit(W, D);
      for (const [kw, kd] of [[1, 0.6], [0.65, 0.6], [0, 0]] as const) {
        if (!got.why) break;
        got = fit(kw ? Math.max(4, W * kw) : 4, kd ? Math.max(3.5, D * kd) : 3.5);
      }
      const { a, b, ox, oz, ring, why } = got;
      if (why) { const k = typeof why === 'string' ? why : `road:${why.c}${f.roads.includes(why.n ?? '') ? '(own)' : ''}`; reasons[k] = (reasons[k] ?? 0) + 1; s += 1.5; continue; }
      // 楼的样子
      let pick = r3, kind = sp.kinds[0];
      for (const k of sp.kinds) { if (pick < k.share) { kind = k; break; } pick -= k.share; }
      const h = kind.h[0] + hash(fi, Math.round(s * 13)) * (kind.h[1] - kind.h[0]);
      const cx = (a.x + b.x) / 2 + ox / 2, cz = (a.z + b.z) / 2 + oz / 2, ang = Math.atan2(b.z - a.z, b.x - a.x);
      const rec: BuildingRec = { i: 9.6e12 + id++, k: kind.k, h: +h.toFixed(2), m: 0, r: kind.rh > 0 ? 'g' : 'f', rh: kind.rh, o: ring.map((v) => +v.toFixed(2)), s: +hash(id, 77).toFixed(3) };
      // 老式铺面是灰瓦（'trad' 的屋顶默认是琉璃瓦的颜色，那是宫殿、庙的）
      if (kind.k === 'trad') rec.rc = hash(id, 9) < 0.5 ? '#55595e' : '#4a4d52';
      if (kind.rh > 0) rec.ob = [+cx.toFixed(2), +cz.toFixed(2), +ang.toFixed(4), +(got.w / 2).toFixed(2), +(got.d / 2).toFixed(2)];
      out.push(rec); put.push(ring); made++;
      // 间壁：紧挨着下一间（偶尔留一条一米多的缝）
      s += got.w + (hash(id, 5) < 0.15 ? 1.2 : 0.05);
    }
  }
  stats.push(`${f.name.zh}：补了 ${made} 间（试了 ${tried} 处；挡掉的 ${JSON.stringify(reasons)}）`);
});
fs.writeFileSync('src/city/famous.gen.json', JSON.stringify({ b: out }));
for (const s of stats) console.log(s);
console.log(`写了 src/city/famous.gen.json：${out.length} 栋，${(fs.statSync('src/city/famous.gen.json').size / 1024).toFixed(1)} KB`);
