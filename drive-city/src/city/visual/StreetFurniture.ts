import type { RoadPiece } from '../Data';
import { MAIN, SIDEWALK, Y, at, isCar, junctions, lineOf, spans, zebrasOn, type Line } from '../Roads';
import { hash3, h01 } from './hash';

/**
 * Street furniture placed from a tile's roads, zebra crossings and bus stops (runs in the tile
 * worker). Flat arrays per kind for the Streamer's instanced pools:
 *   rail    [x, y, z, yaw, kind]   3 m railing segments: 0 on the centre line / median, 1 at the curb
 *   shelter [x, y, z, yaw]         bus shelters, front (+z local) to the road
 *   bin     [x, y, z, yaw]         a pair of sorting bins
 *   bike    [x, y, z, yaw, brand]  shared bikes in rows, perpendicular to the curb
 * `yaw` turns local +x onto the road direction.
 */
export interface Furniture { rail: number[]; shelter: number[]; bin: number[]; bike: number[] }

const RAIL = 3;
const yawOf = (tx: number, tz: number) => Math.atan2(-tz, tx);
const RAILED = new Set(['trunk', 'primary', 'secondary']);

function project(l: Line, x: number, z: number): { s: number; lat: number } {
  let best = { s: 0, lat: Infinity, d: Infinity };
  for (let k = 0; k < l.P.length - 1; k++) {
    const [ax, az] = l.P[k], [bx, bz] = l.P[k + 1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
    const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const L = Math.sqrt(L2), nx = vz / L, nz = -vx / L;   // left normal
      best = { s: l.S[k] + L * t, lat: (x - px) * nx + (z - pz) * nz, d };
    }
  }
  return best;
}

export function placeFurniture(pieces: RoadPiece[], crossings: number[], stops: number[]): Furniture {
  const out: Furniture = { rail: [], shelter: [], bin: [], bike: [] };
  const J = junctions(pieces);
  const lines = new Map<RoadPiece, Line>();
  for (const r of pieces) if (isCar(r.c) && r.p.length >= 4) lines.set(r, lineOf(r));
  // Each bus stop belongs to the nearest carriageway.
  const stopsOn = new Map<RoadPiece, { s: number; side: number }[]>();
  for (let i = 0; i < stops.length; i += 3) {
    let best: { r: RoadPiece; s: number; lat: number; e: number } | null = null;
    for (const [r, l] of lines) {
      const p = project(l, stops[i], stops[i + 1]);
      const e = Math.abs(p.lat) - r.w / 2;
      if (e < 14 && (!best || e < best.e)) best = { r, s: p.s, lat: p.lat, e };
    }
    if (!best) continue;
    const side = best.r.o ? -1 : best.lat >= 0 ? 1 : -1;
    (stopsOn.get(best.r) ?? stopsOn.set(best.r, []).get(best.r)!).push({ s: best.s, side });
  }
  for (const [r, l] of lines) {
    const hw = r.w / 2, sw = SIDEWALK[r.c] ?? 0;
    const js = J.get(r) ?? [];
    const zs = zebrasOn(l, hw, crossings);
    const st = stopsOn.get(r) ?? [];
    const seed = (Math.round(Math.abs(r.p[0] * 13.7 + r.p[1] * 7.3)) + 17) >>> 0;
    const R = (a: number, b = 0) => h01(hash3(seed, a, b));
    const sides = sw ? (r.o ? [-1] : [1, -1]) : [];
    const block = (extraJ: number, zebra: number, stop: number, side?: number) => spans(l.len, [
      ...js.map((j) => [j.s - j.cut - extraJ, j.s + j.cut + extraJ] as [number, number]),
      ...zs.map((z) => [z - zebra, z + zebra] as [number, number]),
      ...(stop ? st.filter((q) => side === undefined || q.side === side).map((q) => [q.s - stop, q.s + stop] as [number, number]) : []),
    ]);
    const railRow = (sp: [number, number][], o: number, y: number, kind: number, gaps: number) => {
      let k = 0;
      for (const [a, b] of sp) for (let s = a + 0.4; s + RAIL <= b - 0.4; s += RAIL, k++) {
        if (gaps && R(k, 31 + kind) < gaps) continue;
        const [x, z, nx, nz, tx, tz] = at(l, s);
        out.rail.push(x + nx * o, y, z + nz * o, yawOf(tx, tz), kind);
      }
    };
    const main = MAIN.has(r.c) && !r.c.endsWith('_link');
    // Centre-line railings on wide two-way roads; railings on the median of dual carriageways.
    if (RAILED.has(r.c) && !r.o && r.w >= 14) railRow(block(2, 3, 0), 0, Y.road, 0, 0);
    if (RAILED.has(r.c) && r.o && r.w >= 7) railRow(block(0, 3, 0), hw + 0.3, Y.median, 0, 0);
    // Curb railings on some main roads, open at crossings, stops and the odd gate.
    if (RAILED.has(r.c) && R(1, 1) < 0.6) for (const side of sides) railRow(block(3, 4, 14, side), side * (hw + 0.09), Y.curb, 1, 0.07);
    // Bus shelters on the pavement, facing the road.
    for (const q of st) {
      const [x, z, nx, nz, tx, tz] = at(l, Math.max(0.5, Math.min(l.len - 0.5, q.s)));
      const o = q.side * (hw + Math.max(2.4, sw * 0.6));
      out.shelter.push(x + nx * o, Y.walk, z + nz * o, q.side > 0 ? yawOf(tx, tz) : yawOf(-tx, -tz));
    }
    if (!sw) continue;
    const walkSp = block(1, 0, 0);
    const inWalk = (s: number) => walkSp.some(([a, b]) => s > a + 0.5 && s < b - 0.5);
    // Sorting bins along the pavements.
    for (const side of sides) {
      let k = 0;
      for (let s = 12 + R(side, 5) * 30; s < l.len - 2; s += 45 + R(k++, 6 + side) * 40) {
        if (!inWalk(s)) continue;
        const [x, z, nx, nz, tx, tz] = at(l, s);
        const o = side * (hw + sw - 0.45);
        out.bin.push(x + nx * o, Y.walk, z + nz * o, side > 0 ? yawOf(-tx, -tz) : yawOf(tx, tz));
      }
    }
    // Shared bikes: rows near crossings and stops, and the odd row along the pavement.
    const bikeRow = (s0: number, dir: number, side: number, n: number, brand: number, key: number) => {
      for (let i = 0; i < n; i++) {
        const s = s0 + dir * i * 0.62;
        if (s < 0.5 || s > l.len - 0.5 || !inWalk(s)) break;
        const [x, z, nx, nz] = at(l, s);
        const o = side * (hw + sw - 1.05);
        const b = brand >= 0 ? brand : Math.floor(R(key * 31 + i, 71) * 3);
        out.bike.push(x + nx * o, Y.walk, z + nz * o, yawOf(nx * side, nz * side) + (R(key * 17 + i, 72) - 0.5) * 0.5, b);
      }
    };
    if (main || r.c === 'tertiary' || r.c === 'residential' || r.c === 'unclassified') {
      let key = 1;
      for (const zc of zs) for (const side of sides) for (const dir of [1, -1]) {
        key++;
        if (R(key, 40) > 0.45) continue;
        bikeRow(zc + dir * (3.5 + R(key, 41) * 4), dir, side, 4 + Math.floor(R(key, 42) * 9), R(key, 43) < 0.7 ? Math.floor(R(key, 44) * 3) : -1, key);
      }
      for (const q of st) { key++; bikeRow(q.s + 6, 1, q.side, 3 + Math.floor(R(key, 45) * 6), Math.floor(R(key, 46) * 3), key); }
      for (const side of sides) for (let s = 20 + R(side, 47) * 40; s < l.len; s += 70 + R(key++, 48) * 60) {
        if (R(key, 49) < 0.4) bikeRow(s, 1, side, 3 + Math.floor(R(key, 50) * 7), Math.floor(R(key, 51) * 3), key);
      }
    }
  }
  return out;
}
