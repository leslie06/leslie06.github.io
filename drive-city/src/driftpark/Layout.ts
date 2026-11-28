/**
 * 漂移练习场 (`?world=drift`, 2026-11-28, 「给我单独做一个场地，可以练习漂移和测试漂移的地方」): a paved, walled lot of its
 * own, as plain data. driftpark/World.ts builds it, driftpark/Play.ts runs the practice on it, the tests check it.
 * Metres; +Z is north, +X is west (a car facing +Z has west on its left), heading = atan2(fwd.x, fwd.z).
 *
 * - 测试路口: a 230 m straight into a crossroads, distance marks before the stop line, built up on both corners like a
 *   city junction - where a drift begun early has to come round (the 11-28 「在路口提前开始漂」).
 * - 城市街区: a 3 x 3 grid of blocks, 14 m roads, so a run chains right and left corners between walls.
 * - 连续弯: a closed course of hairpins, an S and sweepers between jersey barriers, timed by the lap.
 * - 定圆 and 8字: a cone to circle round, two circles to swap the drift between.
 */

export const PARK = {
  /** Half-size of the paved square inside the hoarding. */
  half: 262,
  spawn: { x: 0, z: -236, yaw: 0 },
  gate: { z: -262, width: 16 },
};

/** Roads of the grid: their centre lines, all 14 m wide (two lanes each way). */
export const GRID = {
  xs: [40, 100, 160, 220], zs: [40, 100, 160, 220], width: 14, lane: 3.5, sidewalk: 4,
  /**
   * A row of lower blocks south of the first road (from `z0` to the road), either side of the test lane: the junction is
   * built up both sides. Set back `setback` m from the test lane (not the grid's 4): a drift sliding on angled swings the
   * nose a metre and a half to the side, and from the lane by the kerb it hit the corner of the building.
   */
  south: { z0: -40, setback: 9 },
  /** The north-south roads run on south of the grid to here (lead-ins), the test lane further. */
  leadZ: -70,
};

/** The straight into the grid on its x = 100 road, northbound: from `z0` to the stop line `zStop`. */
export const TEST_LANE = { x: 100, z0: -220, zStop: GRID.zs[0] - GRID.width / 2 - 5.5, marks: [10, 20, 30, 40, 50, 60] };

/** Centre of the 定圆 cone and the radius its ring is painted at. */
export const DONUT = { x: -60, z: -150, r: 14 };

/** The 8字: two circles of radius `r`, one either side of (cx, cz) along z. */
export const EIGHT = { cx: -170, cz: -150, r: 22, lane: 11 };

/** The 连续弯 course: its corners (closed, in driving order) and how round each is, m; 12 m wide. */
export const COURSE = {
  width: 12,
  corners: [
    [-40, -58, 20], [-40, 228, 26], [-132, 228, 17], [-132, 150, 13], [-202, 150, 13],
    [-202, 64, 22], [-92, 64, 15], [-92, 2, 14], [-230, 2, 18], [-230, -58, 18],
  ] as [number, number, number][],
  /** Where the start line crosses the first straight (the x = -40 one, northbound), z. */
  startZ: -4,
  /** The barrier on the lot's side of the start straight is open between these z, to drive in. */
  gap: [-30, -10] as [number, number],
};

export type StationId = 'junction' | 'grid' | 'course' | 'donut' | 'eight';

/** Where 练习点 1..5 put the car (and R back again), and whether a running start makes sense there. */
export const STATIONS: { id: StationId; x: number; z: number; yaw: number; running: boolean }[] = [
  // the inner of the right-hand lanes, 160 m before the stop line: a right turn is drifted from the outside of it
  { id: 'junction', x: TEST_LANE.x - GRID.lane * 0.5, z: TEST_LANE.zStop - 160, yaw: 0, running: true },
  // the grid's east road, northbound, 40 m before its first crossing
  { id: 'grid', x: GRID.xs[0] - GRID.lane * 1.5, z: GRID.zs[0] - 52, yaw: 0, running: true },
  { id: 'course', x: COURSE.corners[0][0], z: COURSE.startZ - 26, yaw: 0, running: true },
  // tangent to a 20 m circle round the cone, turning left round it
  { id: 'donut', x: DONUT.x - 20, z: DONUT.z, yaw: Math.PI, running: false },
  { id: 'eight', x: EIGHT.cx, z: EIGHT.cz, yaw: Math.PI / 2, running: false },
];

/** Entry speeds a station can start the car at, km/h (0 = standing). */
export const ENTRY_SPEEDS = [0, 60, 80, 100] as const;

export interface CoursePoint { x: number; z: number; /** heading of the centre line here */ h: number; /** metres from the first point */ s: number }

/**
 * The course's centre line, every `step` m round the loop: straights between the corners, each corner an arc of its
 * own radius tangent to both. Starts on the first straight just past corner 0's arc.
 */
export function courseLine(step = 2): CoursePoint[] {
  const C = COURSE.corners, n = C.length;
  type Seg = { kind: 'line'; ax: number; az: number; bx: number; bz: number } | { kind: 'arc'; cx: number; cz: number; r: number; a0: number; da: number };
  const segs: Seg[] = [];
  const arcs = C.map(([x, z, r], i) => {
    const [px, pz] = C[(i + n - 1) % n], [nx, nz] = C[(i + 1) % n];
    let d1x = x - px, d1z = z - pz; const l1 = Math.hypot(d1x, d1z); d1x /= l1; d1z /= l1;
    let d2x = nx - x, d2z = nz - z; const l2 = Math.hypot(d2x, d2z); d2x /= l2; d2z /= l2;
    const turn = Math.atan2(d1x * d2z - d1z * d2x, d1x * d2x + d1z * d2z);
    const t = r * Math.tan(Math.abs(turn) / 2);
    // the centre lies on the inside: left of the travel (+90° of the direction) when the turn is positive
    const side = Math.sign(turn);
    const ex = x - d1x * t, ez = z - d1z * t, fx = x + d2x * t, fz = z + d2z * t;
    const cx = ex - d1z * r * side, cz = ez + d1x * r * side;
    return { ex, ez, fx, fz, cx, cz, r, a0: Math.atan2(ex - cx, ez - cz), da: -turn };
  });
  for (let i = 0; i < n; i++) {
    const a = arcs[i], b = arcs[(i + 1) % n];
    segs.push({ kind: 'line', ax: a.fx, az: a.fz, bx: b.ex, bz: b.ez });
    segs.push({ kind: 'arc', cx: b.cx, cz: b.cz, r: b.r, a0: b.a0, da: b.da });
  }
  const pts: CoursePoint[] = [];
  let s = 0, carry = 0;
  for (const g of segs) {
    const len = g.kind === 'line' ? Math.hypot(g.bx - g.ax, g.bz - g.az) : Math.abs(g.da) * g.r;
    for (let d = carry; d < len; d += step) {
      const u = d / len;
      if (g.kind === 'line') pts.push({ x: g.ax + (g.bx - g.ax) * u, z: g.az + (g.bz - g.az) * u, h: Math.atan2(g.bx - g.ax, g.bz - g.az), s: s + d });
      else {
        const a = g.a0 + g.da * u;
        // positions round the centre as (sin a, cos a); moving with da, the heading is a ± 90°
        pts.push({ x: g.cx + Math.sin(a) * g.r, z: g.cz + Math.cos(a) * g.r, h: a + Math.sign(g.da) * Math.PI / 2, s: s + d });
      }
    }
    carry = (carry - len) % step; if (carry < 0) carry += step;
    s += len;
  }
  return pts;
}

/** Length of the course's centre line, m. */
export function courseLength(pts = courseLine()): number {
  const a = pts[pts.length - 1], b = pts[0];
  return a.s + Math.hypot(b.x - a.x, b.z - a.z);
}

/** A point is on a grid road (or the test lane): for placing things off them. */
export function onGridRoad(x: number, z: number, margin = 0): boolean {
  const hw = GRID.width / 2 + margin;
  const zMax = GRID.zs[GRID.zs.length - 1] + hw, xMin = GRID.xs[0] - hw, xMax = GRID.xs[GRID.xs.length - 1] + hw;
  for (const gx of GRID.xs) if (Math.abs(x - gx) < hw && z > (gx === TEST_LANE.x ? TEST_LANE.z0 : GRID.leadZ) && z < zMax) return true;
  for (const gz of GRID.zs) if (Math.abs(z - gz) < hw && x > xMin && x < xMax) return true;
  return false;
}
