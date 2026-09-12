/**
 * 北京欢乐谷 Happy Valley Beijing: where everything in the park stands.
 *
 * One file for every position and dimension, like world/Layout.ts for the driving-school yard, so
 * the model (Rides.ts), the ride motion (index.ts) and the tests all read the same numbers.
 *
 * Local frame: +X east, +Z south, +Y up, origin at the centre of the park's OSM boundary, which is
 * also the landmark anchor. The outline, the lakes and the attraction points are the real ones
 * (src/park/Osm.ts, generated from OpenStreetMap); the park is 956 x 570 m on 小武基路 between the
 * East 4th Ring Road (west) and 金蝉西路 (east), and the main gate is the one on the east side.
 *
 * The three rides the player can board are placed on their real attraction points: 水晶神翼 is the
 * B&M flying coaster that circles the 70 m 水晶圣城 rock, 能量风暴 is the giant frisbee, and the
 * pirate ship goes with the 甜品王国 cluster (飞跃牛奶河, 旋转木马, 家庭过山车) that OSM does name.
 */
import { at, OUTLINE, PARK_CENTRE } from './Osm';

/** WGS84 anchor of the park's local origin, and the heading of local -Z (degrees clockwise from north). */
export const ANCHOR = { lat: PARK_CENTRE.lat, lon: PARK_CENTRE.lon, headingDeg: 0 };

const bx = OUTLINE.map((p) => p[0]), bz = OUTLINE.map((p) => p[1]);
/** Half-extent of the real boundary, for the fence and the landmark footprint. */
export const EXTENT = {
  hw: Math.max(...bx.map(Math.abs)),
  hd: Math.max(...bz.map(Math.abs)),
};

const point = (name: string, fallback: [number, number]): { x: number; z: number } =>
  at(name) ?? { x: fallback[0], z: fallback[1] };

/** 水晶圣城: the rock mountain the coaster flies around, 69.98 m, the park's silhouette. */
const CITY = point('水晶圣城', [51, 104]);
export const MOUNTAIN = { x: CITY.x, z: CITY.z, r: 52, h: 69.98 };

export type RideKind = 'coaster' | 'pendulum' | 'ship';

/** A ride the player can board: where its station is and where the camera sits. */
export interface RideSpec {
  id: string;
  kind: RideKind;
  name: { zh: string; en: string };
  /** Themed area it belongs to, for the sign over the station. */
  area: { zh: string; en: string };
  /** Station centre in park-local metres and the heading the queue faces. */
  x: number; z: number; yaw: number;
  /** Where the player stands to board (the marker), relative to the station centre. */
  board: [number, number];
  /** Seconds of one full ride, gate to gate. */
  duration: number;
}

const WING = point('水晶神翼', [1, 63]);
const STORM = point('能量风暴', [121, 24]);
/** No pirate ship in OSM: it goes in the middle of the sweets area, by the carousel and milk river. */
const SHIP_AT = { x: -55, z: 205 };

export const RIDES: RideSpec[] = [
  {
    id: 'crystalwing', kind: 'coaster',
    name: { zh: '水晶神翼', en: 'Crystal Wing' },
    area: { zh: '亚特兰蒂斯', en: 'Atlantis' },
    x: WING.x, z: WING.z, yaw: Math.atan2(MOUNTAIN.x - WING.x, MOUNTAIN.z - WING.z),
    board: [-6, -8], duration: 120,
  },
  {
    id: 'energystorm', kind: 'pendulum',
    name: { zh: '能量风暴', en: 'Energy Storm' },
    area: { zh: '欢乐时光', en: 'Happy Time' },
    x: STORM.x, z: STORM.z, yaw: 0, board: [0, 14], duration: 72,
  },
  {
    id: 'berryship', kind: 'ship',
    name: { zh: '莓饼海盗船', en: 'Berry Pirate Ship' },
    area: { zh: '甜品王国', en: 'Sweet Kingdom' },
    x: SHIP_AT.x, z: SHIP_AT.z, yaw: Math.PI / 2, board: [0, 13], duration: 64,
  },
];

/**
 * 水晶神翼 Crystal Wing (B&M flying coaster, 2006): 853 m of track, 32 m lift, 30 m drop, 82 km/h,
 * two inversions, flown lying face-down. The track circles 水晶圣城: the station sits south-west of
 * the rock on the real attraction point, the lift climbs round the west side, the drop comes down
 * the north face, then a vertical loop, a rising turn over the water and the helix home.
 */
const RAD = Math.PI / 180;

function ring(deg: number, r: number, y: number): [number, number, number] {
  const a = deg * RAD;
  return [MOUNTAIN.x + Math.cos(a) * r, y, MOUNTAIN.z + Math.sin(a) * r];
}

/**
 * A vertical loop: a circle of radius `r` in the plane of travel that advances `run` metres, so the
 * train leaves it further along instead of back where it entered. The top is 2r above the entry,
 * which is what decides whether the train gets round: it must be well under the lift crest.
 */
function loop(p: [number, number, number], deg: number, r: number, run: number, n = 14): [number, number, number][] {
  const a = deg * RAD;
  // Tangent of the ring at `deg`, going the way the train runs (anticlockwise in x, z).
  const dx = -Math.sin(a), dz = Math.cos(a);
  const out: [number, number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const along = r * Math.sin(t) + (run * i) / n;
    out.push([p[0] + dx * along, p[1] + r - r * Math.cos(t), p[2] + dz * along]);
  }
  return out;
}

/** Where the loop starts: the bottom of the first drop, on the north-east side of the rock. */
const LOOP_AT = ring(40, 90, 3.2);

export const COASTER = {
  /**
   * Control points of the track centre line: [x, y, z] in park-local metres. One turn around the
   * rock with a vertical loop spliced into the fast section after the drop. Heights are set by what
   * the train can actually reach: it leaves the 32 m crest at walking pace, so the loop tops out at
   * 21 m and every hill after it is lower than the last.
   */
  path: [
    ring(214, 85, 6), ring(232, 86, 6), ring(250, 88, 6.5),      // the station straight, south-west
    ring(268, 95, 11), ring(286, 100, 19), ring(304, 103, 26),   // onto the lift, climbing west
    ring(322, 103, 31), ring(340, 100, 32),                      // crest of the lift at 32 m
    ring(358, 96, 28), ring(12, 92, 18), ring(26, 90, 8),        // the 30 m drop down the north face
    LOOP_AT,                                                     // bottom of the drop, 82 km/h
    ...loop(LOOP_AT, 40, 9, 26),                                 // the vertical loop, top at 21 m
    ring(70, 100, 6), ring(86, 108, 12), ring(102, 112, 14),     // the rising turn over the water
    ring(118, 110, 11), ring(134, 104, 13), ring(150, 98, 9),    // two hills, each lower than the last
    ring(166, 92, 8), ring(182, 88, 6.5), ring(198, 86, 6),      // the brake run into the station
  ] as [number, number, number][],
  /** Track length is a property of the spline; this is what the ride is sold as. */
  advertised: { lengthM: 853, heightM: 32, dropM: 30, topKmh: 82, inversions: 2 },
  /** Where the chain lift starts and ends, as a fraction of the track. */
  lift: { from: 0, to: 0.34, speed: 6.2 },   // station drive tyres into the chain, and it lets go past the crest
  /** Cars in one train, and the length of one car. */
  train: { cars: 4, carLen: 4.6 },
  /** Sustained-speed cap the brake run bleeds off to (m/s). */
  brake: { from: 0.94, speed: 5 },
} as const;

/**
 * 能量风暴 (欢乐时光): a giant frisbee - a 16-seat disc on a 22 m arm that swings to nearly
 * vertical while the disc spins. The swing builds up over half a minute and dies away again.
 */
export const PENDULUM = {
  armLen: 22,
  pivotY: 26,
  discR: 5.4,
  seats: 16,
  /** Peak swing angle (radians from straight down) and how long it takes to get there. */
  maxSwing: 2.44,
  buildUp: 26,
  /** Radians per second the disc spins at full tilt. */
  spin: 1.15,
} as const;

/** 莓饼海盗船 (甜品王国): a 40-seat boat on a 14 m arm, the classic swinging ship. */
export const SHIP = {
  armLen: 14,
  pivotY: 16,
  hullLen: 18,
  hullW: 4.2,
  maxSwing: 1.13,
  buildUp: 18,
} as const;

/** The main gate, on the east side by 欢乐谷广场, facing 金蝉西路. OSM names the turnstiles. */
const ENTRY = point('入口', [324, 201]);
export const GATE = { x: ENTRY.x + 60, z: ENTRY.z, w: 44 };
