/**
 * 我家 · the player's villa, as plain data.
 *
 * Rebuilt 2026-09-12 from reference photographs of a Californian hillside modernist house: a long
 * two-storey bar whose upper floor is clad in pale vertical timber behind dark horizontal louvre
 * screens and cantilevers over a glass ground floor; a projecting glass pavilion at the east end;
 * an infinity pool along a stone terrace; a board-formed concrete entry wall with a tall pivot door
 * above three broad steps and a black reflecting pool beside it; inside, a curved timber stair
 * against a rough stone wall, a great room under a timber plank ceiling with a stone fireplace
 * wall, and bedrooms upstairs under sloping timber ceilings behind louvred glass.
 *
 * One file for every position and dimension, like world/Layout.ts for the yard and park/Layout.ts
 * for 欢乐谷, so the model (Villa.ts), the garage door and save point (index.ts), the shot poses and
 * the tests all read the same numbers.
 *
 * Local frame: +X east, +Z south, +Y up, origin at the centre of the plot, which is also the
 * landmark anchor. The plot is a real gap in the city: 96 x 50 m of open ground east of 恒惠路,
 * surveyed off the OSM tiles as holding no buildings, no street trees and no lamps. 恒惠路 runs
 * north-south 18 m off the west edge, so the drive and the garage face west onto it, and the house
 * faces its view south over the open ground.
 *
 * The reference house stands on a hillside. There is no terrain here, so it stands on a stone
 * plinth instead, with the lawn stepping down from it behind curved retaining walls. Everything the
 * player climbs is sized for the character controller: it autosteps 0.4 m and climbs 50°, so the
 * plinth is 1.05 m behind three 0.35 m steps and the stair is a 30° flight.
 */

/** WGS84 anchor of the plot centre, and the heading of local -Z (degrees clockwise from north). */
export const ANCHOR = { lat: 39.904455, lon: 116.450504, headingDeg: 0 };

/** Half-extent of the plot: the landmark footprint, and where the hedge runs. */
export const PLOT = { hw: 48, hd: 25 };

/**
 * Ground heights. The motor court and lawn sit just under the city ground collider's 0.03 top, so
 * everyone walks on that one surface out there and no paving edge becomes a kerb; polygon offset
 * decides what draws over what (see villaMaterials). The plinth is a real step up with real
 * colliders.
 */
export const Y = {
  lawn: 0.02, court: 0.024, path: 0.028,
  /** Top of the stone plinth the house and terrace stand on: the ground floor. */
  plinth: 1.05,
  /** Infinity pool and the entry reflecting pool, a hair under the coping. */
  water: 0.98,
  /** Bottom of the pool basins (geometry only, no collider: the city ground stops you). */
  basin: 0.15,
  /** The two lawn terraces below the plinth. */
  terraceA: 0.62, terraceB: 0.3,
};

/** House levels. The ground floor is the plinth top; the bar sits above it. */
export const LEVEL = {
  floor0: Y.plinth, ceil0: Y.plinth + 3.6,
  floor1: Y.plinth + 3.8, ceil1: Y.plinth + 6.9,
  roof: Y.plinth + 7.25,
};

/** Wall thickness, shared by every run. `index.ts` reads HOUSE.wall for the garage door. */
export const HOUSE = {
  wall: 0.3,
  floor0: LEVEL.floor0, ceil0: LEVEL.ceil0,
  floor1: LEVEL.floor1, ceil1: LEVEL.ceil1, roof: LEVEL.roof,
  /** Extent of the whole ground floor, hall to pavilion. */
  x0: -8, x1: 42, z0: -15, z1: 7,
};

/** The stone plinth: the house, the terrace and the pool stand on it. */
export const PLINTH = { x0: -14, x1: 44, z0: -18, z1: 20 };

/**
 * The upper bar: pale timber and dark louvres, cantilevered 3 m south beyond the ground-floor
 * glass (the deep shaded soffit over the terrace) and 4 m west over the entry.
 */
export const BAR = { x0: -4, x1: 32, z0: -8, z1: 10 };

/** Ground-floor rooms, west to east. Each is a rectangle in plan. */
export const ROOM = {
  hall: { x0: -8, x1: 4, z0: -15, z1: -3 },
  dining: { x0: -8, x1: 4, z0: -3, z1: 7 },
  great: { x0: 4, x1: 28, z0: -15, z1: 7 },
  study: { x0: 28, x1: 40, z0: -15, z1: -3 },
  /** The glass pavilion: formal living, glazed on three sides, projecting east and south. */
  pavilion: { x0: 28, x1: 42, z0: -3, z1: 7 },
};

/**
 * First-floor rooms inside the bar, as a plan that tiles it exactly (36 x 18 m, no gaps).
 *
 * Three bedrooms, as a house this size should have: a master suite at the east end with its own
 * dressing room and ensuite, and two more bedrooms sharing a bathroom off the gallery. Every
 * bedroom takes the south glass and the balcony behind it - the view is the whole point of the
 * plan - and the rooms with nothing to look at (baths, dressing, the media room) take the north.
 *
 * The gallery is what makes it read as a floor of rooms rather than one loft: you come off the
 * stair into `hall`, and every room opens off it. `UPPER_WALL` below is the wall between each
 * pair, with the doorway in it; `Villa.test.ts` walks those doors to prove every room is
 * reachable from the stair, which is the regression the old plan failed - it declared three
 * bedrooms but built the dividing walls only where two rooms happened to share an x edge, so the
 * whole floor was one open space with beds standing about in it.
 */
export const UPPER_ROOM = {
  /** The stair hall: the void, the landing, and the gallery wall facing them. */
  landing: { x0: -4, x1: 4, z0: -8, z1: 10 },
  /** The gallery, and its east leg in front of the master suite. */
  hall: { x0: 4, x1: 20, z0: -3, z1: 1 },
  hallE: { x0: 20, x1: 32, z0: -2, z1: 1 },
  /** Two bedrooms on the south glass, sharing the bathroom behind them. */
  bed2: { x0: 4, x1: 12, z0: 1, z1: 10 },
  bed3: { x0: 12, x1: 20, z0: 1, z1: 10 },
  bath2: { x0: 4, x1: 11, z0: -8, z1: -3 },
  /** Media room: north, no view to lose, so it is the one room that wants to be dark. */
  lounge: { x0: 11, x1: 20, z0: -8, z1: -3 },
  /** The master suite: bedroom on the corner glass, dressing and ensuite behind it. */
  master: { x0: 20, x1: 32, z0: 1, z1: 10 },
  dress: { x0: 20, x1: 25, z0: -8, z1: -2 },
  bath1: { x0: 25, x1: 32, z0: -8, z1: -2 },
};

export type UpperRoomName = keyof typeof UPPER_ROOM;

/** The three bedrooms, so the model and the tests agree on which rooms get a bed. */
export const BEDROOMS: readonly UpperRoomName[] = ['master', 'bed2', 'bed3'];

/**
 * An interior wall of the upper floor: it stands on a constant `x` (axis 'x') or a constant `z`,
 * spans `from`..`to` on the other axis, and carries an optional opening. `head` is the height of
 * the door head above the floor; a head at or above the room height means no beam over it, which
 * is how the two gallery portals are left fully open.
 */
export interface UpperWall {
  axis: 'x' | 'z';
  at: number;
  from: number; to: number;
  door?: { w: number; at?: number; head?: number };
}

/** Height of a normal internal door head above the first floor. */
export const DOOR_HEAD = 2.3;

/** Every wall between two upper rooms, with the doorway that connects them. */
export const UPPER_WALL: readonly UpperWall[] = [
  // The gallery wall: open to the stair, solid behind the bedroom and the bathroom.
  { axis: 'x', at: 4, from: -3, to: 1, door: { w: 2.6, head: 3.2 } },
  { axis: 'x', at: 4, from: 1, to: 10 },
  { axis: 'x', at: 4, from: -8, to: -3 },
  // Off the gallery: two bedrooms south, the bathroom and the media room north.
  // The bedroom doors stand at the far end of the wall from the bed (see BED), never behind it.
  { axis: 'z', at: 1, from: 4, to: 12, door: { w: 1.4, at: 5.6 } },
  { axis: 'z', at: 1, from: 12, to: 20, door: { w: 1.4, at: 18.4 } },
  { axis: 'z', at: -3, from: 4, to: 11, door: { w: 1.2 } },
  { axis: 'z', at: -3, from: 11, to: 20, door: { w: 1.6 } },
  { axis: 'x', at: 11, from: -8, to: -3 },
  { axis: 'x', at: 12, from: 1, to: 10 },
  // The master suite: a double door to the bedroom, the dressing room through to the ensuite.
  { axis: 'x', at: 20, from: -2, to: 1, door: { w: 3.0, head: 3.2 } },
  { axis: 'x', at: 20, from: 1, to: 10 },
  { axis: 'x', at: 20, from: -8, to: -2 },
  { axis: 'z', at: 1, from: 20, to: 32, door: { w: 1.8, at: 29.5 } },
  { axis: 'z', at: -2, from: 20, to: 25, door: { w: 1.4 } },
  { axis: 'z', at: -2, from: 25, to: 32, door: { w: 1.4 } },
  { axis: 'x', at: 25, from: -8, to: -2, door: { w: 1.2 } },
];

/**
 * Where each bed stands: its head against the side wall on `wallX`, its foot pointing along `dir`
 * (+1 east), centred on `z`.
 *
 * Every bed used to stand with its head on the north wall, dead centre - and every bedroom door
 * was dead centre in that same wall, so you walked in 1.2 m behind the headboard and met the back
 * of it (「一进门就是面对的床背面」). A bedroom is entered from the foot: the head goes on a side
 * wall, the door at the other end of the room, and what you see from the doorway is the front of
 * the bed with the glass beyond it. bed2 and bed3 stand back to back on the wall they share.
 */
export const BED: Record<'master' | 'bed2' | 'bed3', { wallX: number; dir: 1 | -1; z: number; w: number; len: number }> = {
  master: { wallX: 20, dir: 1, z: 5.4, w: 2.0, len: 2.2 },
  bed2: { wallX: 12, dir: -1, z: 4.8, w: 1.6, len: 2.1 },
  bed3: { wallX: 12, dir: 1, z: 4.8, w: 1.6, len: 2.1 },
};

/** Board-formed concrete entry wall, the pivot door in it, and the steps up to the plinth. */
export const ENTRY = {
  /** The wall runs north-south; the door is a tall narrow pivot leaf. */
  x: -8, z: 1, w: 1.5, h: 3.0,
  /** Three broad steps from the motor court up to the plinth. */
  steps: 3, tread: 1.1, riser: Y.plinth / 3,
  /**
   * How wide the flight is. Narrower than a car (2.0 m) on purpose: the climb is a ramp collider,
   * and a ramp wide enough to walk up abreast is also a ramp you can drive a taxi up onto the
   * terrace. The stone face of the plinth does the blocking either side.
   */
  flight: 1.8,
};

/** Black reflecting pool beside the entry steps, as in the night shot. */
export const REFLECT = { x0: -13.5, x1: -8.6, z0: -6, z1: 0 };

/** Single-storey garage at ground level on the west, its door facing the drive. */
export const GARAGE = { x0: -26, x1: -12, z0: -16, z1: -4, roof: 3.4 };

/** The roller garage door: the one thing here that moves (home/index.ts). */
export const DOOR = { z: -10, w: 5.0, h: 2.7, t: 0.22, open: 16, shut: 22, time: 1.6 };

/** Where the car is meant to stop: the middle of the garage. */
export const PARK_AT = { x: (GARAGE.x0 + GARAGE.x1) / 2, z: DOOR.z, yaw: Math.PI / 2 };

/** Door from the garage into the hall, and the steps up to the plinth inside it. */
export const GARAGE_DOOR = { z: -10, w: 1.6 };

/** Sliding glass openings you can walk through (no collider). */
export const SLIDER = { great: { x: 16, w: 7.0 }, pavilion: { x: 35, w: 3.2 } };

/**
 * The curved timber stair in the hall, helical around a solid spine wall against rough stone.
 * Centre, radius to the middle of the tread, the arc it turns through, and the step sizing.
 *
 * `hand` is which side of the centre the flight swings round: +1 east, -1 west. It is -1, and that
 * is the whole fix for 「楼梯和去房间的路是断的」 (2026-09-17). Swinging east, the flight came off
 * heading west onto a landing on the *far* side of the stairwell from the gallery, and the only way
 * round was the 0.35 m left between the void rail and the gallery wall - narrower than the
 * character, so every room upstairs was unreachable while the door-graph test stayed green.
 * Swinging west, it starts at the north heading west, and comes off at the south heading east with
 * the landing, the gallery portal and the bedrooms straight ahead.
 */
export const STAIR = {
  cx: -0.2, cz: -2.8, r: 2.6, w: 1.5, hand: -1 as 1 | -1,
  /** Start and end of the climb (radians, before `hand`): a half turn, north round to south. */
  a0: -Math.PI * 0.55, a1: Math.PI * 0.55,
  rise: 0.19, treads: 20,
};

/** The plan angle (from +X towards +Z) of the flight at climb parameter `a`. */
export const stairAngle = (a: number): number => (STAIR.hand > 0 ? a : Math.PI - a);

/** A point of the flight in plan: climb parameter `a`, radius `rad` from the stair's centre. */
export const stairPoint = (a: number, rad: number): { x: number; z: number } => {
  const A = stairAngle(a);
  return { x: STAIR.cx + Math.cos(A) * rad, z: STAIR.cz + Math.sin(A) * rad };
};

/**
 * The void the stair rises through, and so where the first-floor slab is not.
 *
 * It must contain the flight's whole swept footprint with clearance over every tread, or the slab
 * caps the stair (it once stopped at z 0.9 against a sweep that reached 1.36, under a landing that
 * was a slab of its own: you climbed to 3.5 m and met the underside of a floor). The flight sweeps
 * cx-3.37..cx+0.52 by cz-3.36..cz+3.36 (outer radius plus the tread's tangential half depth), so
 * the hole clears it all round except on the east, where the last tread laps onto the floor. Its
 * west edge is the bar's own west wall. `Stair.test.ts` asserts the headroom over every tread
 * rather than trusting these numbers again.
 */
export const VOID = { x0: BAR.x0 + HOUSE.wall, x1: STAIR.cx + 0.5, z0: STAIR.cz - 3.6, z1: STAIR.cz + 3.5 };

/**
 * Where the flight arrives: stone paving let into the boards between the void and the gallery
 * portal, flush with them. Not a slab of its own - it is part of the first floor, which is exactly
 * why the last tread can be flush with it while the treads below it stay in open air.
 */
export const LANDING = {
  x0: VOID.x1, x1: UPPER_ROOM.landing.x1,
  z0: STAIR.cz + STAIR.r - STAIR.w / 2 - 0.45, z1: VOID.z1,
};

/** Infinity pool along the terrace, dark water, coping flush with the plinth. */
export const POOL = { x0: 2, x1: 26, z0: 12.5, z1: 18.5 };

/** Stone terrace between the ground-floor glass and the pool, under the bar's cantilever. */
export const TERRACE = { x0: -4, x1: 30, z0: 7, z1: 12.5 };

/** Timber deck running along the pool's east side and round to the lawn. */
export const DECK = { x0: 2, x1: 36, z0: 18.5, z1: 20 };

/** Curved steps from the terrace down to the lawn, and the two curved lawn terraces below. */
export const CURVES = {
  /** Centre of the arcs, south-east of the terrace. */
  cx: 30, cz: 6,
  steps: { r: 7.2, n: 3, w: 5.2 },
  terraceA: { r: 17, wall: 0.5 },
  terraceB: { r: 27, wall: 0.5 },
};

/** The drive in from 恒惠路, as the rectangles it is paved from. */
export const DRIVE = {
  in: { x0: -PLOT.hw, x1: -30, z0: -13.2, z1: -6.8 },
  court: { x0: -30, x1: -9, z0: -16, z1: 2 },
  /** Outside the plot, across the verge to 恒惠路's kerb: the landmark's `extras`. */
  kerb: { x0: -66.2, x1: -PLOT.hw, z0: -13.2, z1: -6.8 },
};

/**
 * What the city has to keep off the drive where it leaves the plot and crosses 恒惠路's pavement:
 * street trees, lamps and kerbside furniture (the landmark's `clear` zone).
 *
 * The plot was surveyed clear of trees and lamps, but the drive runs 18 m beyond it, across a
 * pavement OSM lines with a tree every 9 m. One stood 0.6 m off the drive's centre line with a lamp
 * 0.4 m off its north edge, 2.6 m apart: a car turning in from the north was wedged between them
 * with the throttle wide open (「每次把车开到别墅门口就卡住」, 2026-09-21), and nothing caught it
 * because every home probe *teleported* the car to x -52 or further in, east of the tree line.
 * Wider than the paving by `FLARE` each side, because a car turning in off the road cuts the corner:
 * the next trees along stand 5 m and 6.4 m beyond the paving and stay.
 */
const FLARE = 3;
export const DRIVE_CLEAR = {
  x0: DRIVE.kerb.x0 - 1, x1: DRIVE.kerb.x1,
  z0: DRIVE.kerb.z0 - FLARE, z1: DRIVE.kerb.z1 + FLARE,
};

/** Low stone wall and hedge on the plot line, with the gate left open on the west. */
export const EDGE = { wall: 0.7, t: 0.4, inset: 0.6, hedge: 1.1 };
export const GATE = { z: -10, w: 7.6, pierW: 1.2, pierH: 2.6 };

/**
 * The feature tree the house is built around (the cork oak of the reference), and the rest of the
 * planting: (x, z, height).
 */
export const HERO_TREE = { x: 43, z: 9, h: 9 };
export const TREES: [number, number, number][] = [
  [-36, 14, 8], [-30, -20, 8.5], [-42, -4, 7.5], [44, -18, 8.5], [45, 14, 8], [38, 21, 7],
  [-20, 20, 7], [8, -20, 7.5], [-4, -21, 7], [20, -20, 7.5], [30, -20, 7.2], [-14, 21, 6.8],
  [12, 22, 7.4], [-26, 8, 6.6],
];

/** In-ground uplights: the entry treads, the terrace edge, the drive. */
export const LIGHTS: [number, number][] = [
  [-36, -12.4], [-36, -7.6], [-24, -2], [-18, -2], [-12, -2],
  [0, 11.6], [8, 11.6], [16, 11.6], [24, 11.6], [29, 14], [29, 18],
];
