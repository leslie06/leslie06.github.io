import type { LaneGraph, Link } from '../traffic/LaneGraph';
import type { Signals } from '../traffic/Signals';

/**
 * 车头朝前 `reach` 米之内是不是有一盏没绿的灯在等着（2026-11-11，A7「等红灯不走表」）：车所在的路段（24 米内、
 * 和车头同向、车在路面上），沿直行最多再走两段，头一个有灯的路口是红灯或黄灯就算。已经过了停车线（路段在
 * 路口里面）不算。出租车活儿每 0.25 秒问一次，车停着才问。
 */
export function redAhead(g: LaneGraph, sig: Signals, time: number, x: number, z: number, fx: number, fz: number, reach = 90): boolean {
  let best: Link | null = null, bd = Infinity, bs = 0;
  for (const id of g.near(x, z, 24)) {
    const l = g.links[id];
    for (let k = 1; k < l.cum.length; k++) {
      const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], vx = l.pts[k * 2] - ax, vz = l.pts[k * 2 + 1] - az;
      const L = Math.hypot(vx, vz) || 1, dx = vx / L, dz = vz / L;
      if (dx * fx + dz * fz < 0.7) continue;
      const u = Math.max(0, Math.min(L, (x - ax) * dx + (z - az) * dz));
      const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (d < bd && d < l.hw + 1) { bd = d; best = l; bs = l.cum[k - 1] + u; }
    }
  }
  if (!best) return false;
  let cur: Link = best, dist = best.len - bs;
  for (let hop = 0; hop < 3 && dist <= reach; hop++) {
    if (sig.junctionOf(cur.to) >= 0) return sig.state(cur, time) !== 0;
    let next: Link | null = null, straight = 0.7;
    for (const id of g.out[cur.to]) {
      const o = g.links[id], dot = cur.d1x * o.d0x + cur.d1z * o.d0z;
      if (id !== cur.rev && dot > straight) { straight = dot; next = o; }
    }
    if (!next) return false;
    dist += next.len; cur = next;
  }
  return false;
}
