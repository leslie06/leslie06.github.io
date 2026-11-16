import type { AirfieldData } from './Data';
import { dims, type PlaneKind } from './Plane';

/**
 * 停着的飞机（2026-11-16）：700 个 OSM 机位去重后，按机位之间的间距挑机型（宽体要 66 米以上，窄体 38 米，再挤的停公务机），
 * 公务机楼、专机楼旁边的都是公务机。哪个机位这个钟点有飞机由机位编号和钟点的哈希定：同一个钟点每次去看都一样；
 * 白天走得多（55%），夜里停过夜的多（80%）。
 */
export interface Stand {
  /** 飞机中心（机身中点正下方）和机头朝向。 */
  x: number; z: number; yaw: number;
  kind: PlaneKind;
  livery: number;
  /** 停机点（前轮停的地方）。 */
  sx: number; sz: number;
}

const hash = (a: number, b: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
export { hash as hash2 };

export function stands(d: AirfieldData): Stand[] {
  // 去重：线和点常常是同一个机位
  const raw: { x: number; z: number; yaw?: number }[] = [];
  for (const s of d.stands) {
    const j = raw.findIndex((o) => Math.hypot(o.x - s.x, o.z - s.z) < 8);
    if (j < 0) raw.push({ x: s.x, z: s.z, yaw: s.yaw });
    else if (raw[j].yaw === undefined && s.yaw !== undefined) raw[j].yaw = s.yaw;
  }
  const terms = d.terminals.filter((t) => t.kind === 'terminal');
  const ends = bridgeEnds(d);
  const biz = terms.filter((t) => /公务机|专机/.test(t.name));
  const out: Stand[] = [];
  raw.forEach((s, i) => {
    let gap = Infinity;
    for (const o of raw) if (o !== s) gap = Math.min(gap, Math.hypot(o.x - s.x, o.z - s.z));
    let yaw = s.yaw;
    if (yaw === undefined) {
      // 点机位：机头朝最近的航站楼
      let best = Infinity;
      for (const t of terms) { const dd = Math.hypot(t.c[0] - s.x, t.c[1] - s.z); if (dd < best) { best = dd; yaw = Math.atan2(t.c[0] - s.x, t.c[1] - s.z); } }
    }
    if (yaw === undefined) return;
    const nearBiz = biz.some((t) => Math.hypot(t.c[0] - s.x, t.c[1] - s.z) < 260);
    const r = hash(i, 7);
    const kind: PlaneKind | -1 = nearBiz ? 2 : gap >= 66 && r < 0.4 ? 1 : gap >= 38 ? 0 : gap >= 24 ? 2 : -1;
    if (kind < 0) return;
    // 前轮停在停机点上：中心在它后面「前轮到中心」那么远
    const D = dims(kind as PlaneKind), back = 14.6 * D.len / 38;
    let x = s.x - Math.sin(yaw) * back, z = s.z - Math.cos(yaw) * back;
    // 有廊桥的机位：左前门对着廊桥头（往外 1 米）。OSM 的停机点和廊桥画得不一定对得上，前轮放停机点上廊桥常常压在机身上
    let best: { x: number; z: number } | null = null, bd = 30;
    for (const b of ends) {
      const dd = Math.hypot(b.x - s.x, b.z - s.z);
      if (dd < bd) { bd = dd; best = b; }
    }
    if (best) {
      const [dx, , dz] = D.door, c = Math.cos(yaw), sn = Math.sin(yaw);
      const nx = best.x - (dx * c + dz * sn), nz = best.z - (-dx * sn + dz * c);
      if (Math.hypot(nx - x, nz - z) < 25) { x = nx; z = nz; }
    }
    out.push({ x, z, yaw, kind: kind as PlaneKind, livery: Math.floor(hash(i, 3) * 6), sx: s.x, sz: s.z });
  });
  return out;
}

/**
 * 廊桥的机门那头（往外 1 米：舱门的位置）和走向。哪头是机门：离任何机位停机点近的那头。`Bridges.ts` 用同一个判断。
 */
export function bridgeEnds(d: AirfieldData): { x: number; z: number; ax: number; az: number }[] {
  const pts = d.stands.map((s) => [s.x, s.z]);
  const near = (x: number, z: number) => pts.reduce((m, [px, pz]) => Math.min(m, Math.hypot(px - x, pz - z)), Infinity);
  const out: { x: number; z: number; ax: number; az: number }[] = [];
  for (const b of d.bridges) {
    const p = b.p;
    if (p.length < 4) continue;
    let ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
    if (near(ax, az) < near(bx, bz)) [ax, az, bx, bz] = [bx, bz, ax, az];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 6 || L > 80) continue;
    out.push({ x: bx + (bx - ax) / L, z: bz + (bz - az) / L, ax, az });
  }
  return out;
}

/** 这个钟点（0–24）这个机位有没有飞机。 */
export function occupied(i: number, hour: number): boolean {
  const h = Math.floor(hour);
  const p = h < 6 || h >= 23 ? 0.8 : 0.55;
  return hash(i, 1000 + h) < p;
}
