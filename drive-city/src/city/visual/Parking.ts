import type { RoadPiece } from '../Data';
import { inside } from '../Clear';
import { at, isCar, junctions, lifted, lineOf, project, spans, sunk, zebrasOn, type Line } from '../Roads';
import { PARK_W, parkingLine } from '../../traffic/Lanes';
import { hash3, h01 } from './hash';

/**
 * Cars parked along the kerbs of side streets (runs in the tile worker, 2026-10-11, 「街道太空」): Beijing's
 * residential streets, lanes and tertiary roads are lined with them, often half up on the pavement. Where a street
 * has room outside its traffic lanes (traffic/Lanes.ts `parkingLine`, which the lane graph also reads, so drivers,
 * scooters and walkers keep clear), rows of cars stand nose to tail on the right of travel - both sides of a two-way
 * street - with gaps, never within reach of a junction, a zebra, a bus stop's pull-in or the feet of a ramp, nor
 * over a street tree, lamp, shared bike or bin. The game checks each against the static colliders again before it
 * draws it (parking/): kiosks, walls, signs, footbridge stairs.
 *
 * Flat records of `STRIDE`: [x, z, heading, body, colour], heading = atan2(dx, dz) of the way the car faces (the
 * Vehicle's yaw), body an index into `PARK_BODIES`, colour into the game's palette (any integer; it wraps).
 */
export const STRIDE = 5;
/** Bodies parked cars come in, and how often: saloons, SUVs, hatchbacks, MPVs. */
export const PARK_BODIES = ['sedan', 'suv', 'hatch', 'mpv'] as const;
const SHARE = [0.44, 0.28, 0.18, 0.1];
/** Half lengths, bumpers and mirrors included (vehicle/Spec chassis + 0.15). */
export const PARK_HALF = [2.37, 2.4, 2.21, 2.81];
/** How full a street's kerb is, by class (before each stretch's own mood). */
const OCCUPANCY: Record<string, number> = { residential: 0.88, unclassified: 0.8, tertiary: 0.62 };

function bodyOf(u: number): number {
  for (let i = 0, a = 0; i < SHARE.length; i++) { a += SHARE[i]; if (u < a) return i; }
  return 0;
}

/** A coarse grid of obstacles on the pavement (point and radius). */
class Grid {
  private cells = new Map<number, number[]>();
  add(x: number, z: number, r: number): void {
    const k = (Math.floor(x / 8) + 4096) * 8192 + Math.floor(z / 8) + 4096;
    const c = this.cells.get(k);
    if (c) c.push(x, z, r); else this.cells.set(k, [x, z, r]);
  }
  /** Whether anything comes within the box half `hl` along (tx, tz) by half `hw` across, centred (x, z). */
  hits(x: number, z: number, tx: number, tz: number, hl: number, hw: number): boolean {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = this.cells.get((cx + i + 4096) * 8192 + cz + j + 4096);
      if (!c) continue;
      for (let k = 0; k < c.length; k += 3) {
        const dx = c[k] - x, dz = c[k + 1] - z, r = c[k + 2];
        if (Math.abs(dx * tx + dz * tz) < hl + r && Math.abs(dx * tz - dz * tx) < hw + r) return true;
      }
    }
    return false;
  }
}

export function placeParking(pieces: RoadPiece[], crossings: number[], stops: number[], trees: number[], lamps: number[], bikes: number[], bins: number[], ctx: RoadPiece[] = []): number[] {
  const out: number[] = [];
  const grid = new Grid();
  for (let i = 0; i < trees.length; i += 4) grid.add(trees[i], trees[i + 1], 0.45);
  for (let i = 0; i < lamps.length; i += 3) grid.add(lamps[i], lamps[i + 1], 0.3);
  for (let i = 0; i < bikes.length; i += 5) grid.add(bikes[i], bikes[i + 2], 0.95);
  for (let i = 0; i < bins.length; i += 4) grid.add(bins[i], bins[i + 2], 0.6);
  const J = junctions(pieces);
  // Every carriageway here and next door, for keeping a car's corners out of another road.
  const roads: { r: RoadPiece; l: Line; box: number[] }[] = [];
  for (const r of [...pieces, ...ctx]) {
    if (!isCar(r.c) || r.p.length < 4) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < r.p.length; i += 2) { x0 = Math.min(x0, r.p[i]); x1 = Math.max(x1, r.p[i]); z0 = Math.min(z0, r.p[i + 1]); z1 = Math.max(z1, r.p[i + 1]); }
    const m = r.w / 2 + 4;
    roads.push({ r, l: lineOf(r), box: [x0 - m, z0 - m, x1 + m, z1 + m] });
  }
  // Where pieces end, which way each leaves the point: a road turning a corner is often two ways meeting end to
  // end there, not a junction (no `j` flag), and cars swing wide round it.
  const ends = new Map<string, { r: RoadPiece; dx: number; dz: number }[]>();
  const endKey = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  for (const { r } of roads) {
    const n = r.p.length / 2;
    for (const [i, k] of [[0, 1], [n - 1, n - 2]]) {
      const dx = r.p[k * 2] - r.p[i * 2], dz = r.p[k * 2 + 1] - r.p[i * 2 + 1], L = Math.hypot(dx, dz) || 1;
      const key = endKey(r.p[i * 2], r.p[i * 2 + 1]);
      (ends.get(key) ?? ends.set(key, []).get(key)!).push({ r, dx: dx / L, dz: dz / L });
    }
  }
  /** Stretches of the piece round its bends: a corner within it, or at an end where another road leaves at an angle. */
  const bendsOf = (r: RoadPiece, l: Line, side: number): [number, number][] => {
    const out: [number, number][] = [], n = r.p.length / 2;
    const block = (s: number, cosTurn: number) => {
      if (cosTurn > 0.87) return;   // under 30 degrees
      const m = 8 + 10 * Math.min(1, 1 - cosTurn), out1 = m + 8;   // longer on the way out, as at a junction
      out.push(side < 0 ? [s - m, s + out1] : [s - out1, s + m]);
    };
    for (let i = 1; i < n - 1; i++) {
      const ax = r.p[i * 2] - r.p[i * 2 - 2], az = r.p[i * 2 + 1] - r.p[i * 2 - 1], bx = r.p[i * 2 + 2] - r.p[i * 2], bz = r.p[i * 2 + 3] - r.p[i * 2 + 1];
      block(l.S[i], (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1));
    }
    for (const [i, k] of [[0, 1], [n - 1, n - 2]]) {
      const dx = r.p[k * 2] - r.p[i * 2], dz = r.p[k * 2 + 1] - r.p[i * 2 + 1], L = Math.hypot(dx, dz) || 1;
      for (const o of ends.get(endKey(r.p[i * 2], r.p[i * 2 + 1])) ?? []) if (o.r !== r) block(l.S[i], -(o.dx * dx + o.dz * dz) / L);
    }
    return out;
  };
  const inOtherRoad = (self: RoadPiece, x: number, z: number) => roads.some(({ r, l, box }) => r !== self && x > box[0] && x < box[2] && z > box[1] && z < box[3] && project(l, x, z).d < r.w / 2 + 0.2);
  for (const { r, l } of roads) {
    if (!pieces.includes(r)) continue;
    const line = parkingLine(r.c, r.w, !!r.o, r.l);
    if (!line || l.len < 14) continue;
    const mid = (line.inner + line.outer) / 2;
    const seed = (Math.round(Math.abs(r.p[0] * 13.7 + r.p[1] * 7.3)) + 91) >>> 0;
    const R = (a: number, b = 0) => h01(hash3(seed, a, b));
    const js = J.get(r) ?? [], zs = zebrasOn(l, r.w / 2, crossings);
    // A bus stop on this piece and its side: the bus pulls in over 45 m before it and out after.
    const st: { s: number; side: number }[] = [];
    for (let i = 0; i < stops.length; i += 3) {
      const p = project(l, stops[i], stops[i + 1]);
      if (p.d < r.w / 2 + 14) st.push({ s: p.s, side: r.o ? -1 : p.lat >= 0 ? 1 : -1 });
    }
    const up = [...lifted(l, 0.1), ...sunk(l, 0.1)].map(([a, b]) => [a - 8, b + 8] as [number, number]);
    const occ = (OCCUPANCY[r.c] ?? 0.7) * (0.55 + 0.45 * R(1, 2));
    for (const side of r.o ? [-1] : [1, -1]) {
      // Each side of a street is parked on or not as a whole now and then (a no-parking side, a school's gate).
      if (R(side, 3) < 0.12) continue;
      const free = spans(l.len, [
        ...up,
        // Cars leaving a junction swing wide towards this kerb (a right turn and a left one alike, still finding
        // their lane 20 m on: traffic clipped the first parked car), so the row starts well past it on the way
        // out; on the way in it can come up to the corner.
        ...js.map((j) => (side < 0 ? [j.s - j.cut - 5, j.s + j.cut + 20] : [j.s - j.cut - 20, j.s + j.cut + 5]) as [number, number]),
        ...zs.map((z) => [z - 7, z + 7] as [number, number]),
        ...bendsOf(r, l, side),
        // travel is along +s on the right (side -1), against it on the left
        ...st.filter((q) => q.side === side).map((q) => (side < 0 ? [q.s - 45, q.s + 12] : [q.s - 12, q.s + 45]) as [number, number]),
      ]);
      let k = 0;
      for (const [a, b] of free) {
        let s = a + 0.5 + R(side * 7 + k, 4) * 3;
        while (s < b) {
          k++;
          const body = bodyOf(R(k, 5 + side)), hl = PARK_HALF[body];
          const c = s + hl;
          if (c + hl > b - 0.3) break;
          const gap = 0.5 + R(k, 7 + side) * 1.1;
          s = c + hl + gap;
          if (R(k, 9 + side) > occ) continue;
          const [px, pz, nx, nz, tx, tz] = at(l, c);
          // Off the centre line on this side, a little ragged (towards the kerb: never into the traffic's room);
          // mostly facing the way traffic goes on this side.
          const o = side * (mid + R(k, 11) * 0.1);
          const x = px + nx * o, z = pz + nz * o;
          const fwd = side < 0 ? 1 : -1, flip = R(k, 13) < 0.08 ? -1 : 1;
          const hx = tx * fwd * flip, hz = tz * fwd * flip;
          if (grid.hits(x, z, tx, tz, hl, PARK_W / 2)) continue;
          // No corner in another carriageway (a side road alongside, a slip road), nor in this one's traffic.
          let bad = false;
          for (const [u, v] of [[hl, PARK_W / 2], [hl, -PARK_W / 2], [-hl, PARK_W / 2], [-hl, -PARK_W / 2]]) {
            const qx = x + tx * u + nx * v, qz = z + tz * u + nz * v;
            if (inOtherRoad(r, qx, qz)) { bad = true; break; }
            const p = project(l, qx, qz);
            if (Math.abs(p.lat) < line.inner - 0.15 && p.d < r.w) { bad = true; break; }
          }
          if (bad) continue;
          out.push(x, z, Math.atan2(hx, hz), body, Math.floor(R(k, 15) * 997));
        }
      }
    }
  }
  return out;
}

/** The records with the middle or a corner of the car in a zone (a landmark's drive, a shortcut's mouth, a ramp's run). */
export function dropParked(list: number[], zones: number[][]): number[] {
  if (!zones.length || !list.length) return list;
  const res: number[] = [];
  for (let i = 0; i < list.length; i += STRIDE) {
    const x = list[i], z = list[i + 1], h = list[i + 2], hl = PARK_HALF[list[i + 3]] ?? 2.4, hw = PARK_W / 2;
    const fx = Math.sin(h), fz = Math.cos(h);
    const pts = [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]];
    if (pts.some(([u, v]) => zones.some((zn) => inside(x + fx * u + fz * v, z + fz * u - fx * v, zn)))) continue;
    for (let k = 0; k < STRIDE; k++) res.push(list[i + k]);
  }
  return res;
}
