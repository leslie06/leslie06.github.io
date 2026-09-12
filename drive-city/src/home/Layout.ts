/**
 * 我家 · the player's villa, as plain data.
 *
 * One file for every position and dimension, like world/Layout.ts for the yard and park/Layout.ts
 * for 欢乐谷, so the model (Villa.ts), the garage door and save point (index.ts), the shot poses
 * and the tests all read the same numbers.
 *
 * Local frame: +X east, +Z south, +Y up, origin at the centre of the plot, which is also the
 * landmark anchor. The plot is a real gap in the city: 96 x 50 m of open ground east of 恒惠路,
 * surveyed off the OSM tiles as holding no buildings, no street trees and no lamps (the nearest
 * tree is 1.8 m outside the south wall, and hangs over it). 恒惠路 runs north-south 18 m off the
 * west edge, so the gate and the drive face west onto it.
 *
 * Heights are chosen around what the player can physically do: the character controller autosteps
 * 0.4 m and climbs 50°, so the ground floor sits 0.45 m up behind two 0.15 m steps, and the stair
 * is a 29° flight rather than anything the capsule would refuse.
 */

/** WGS84 anchor of the plot centre, and the heading of local -Z (degrees clockwise from north). */
export const ANCHOR = { lat: 39.904455, lon: 116.450504, headingDeg: 0 };

/** Half-extent of the plot: the landmark footprint, and where the boundary wall runs. */
export const PLOT = { hw: 48, hd: 25 };

/** Ground heights. All below the city ground collider's 0.03 top, so everyone walks on that one
 *  surface and no paving edge becomes a kerb to trip on; polygon offset decides what draws over
 *  what (see villaMaterials). */
export const Y = { lawn: 0.02, drive: 0.024, pave: 0.028, water: 0.30, basin: -0.25 };

export const WALL = { h: 2.4, t: 0.35, inset: 0.6, cap: 0.16 };

/** The gate on the west wall, facing 恒惠路. Left standing open: this is the way the car gets in. */
export const GATE = { z: 0, w: 7.6, pierW: 1.5, pierH: 3.3 };

/** Single-storey garage wing on the north-west, its door facing the drive. */
export const GARAGE = { x0: -6, x1: 6, z0: -13, z1: -3, roof: 3.6 };

/** The up-and-over garage door: the one thing here that moves. */
export const DOOR = { z: -8, w: 5.0, h: 2.7, t: 0.22, open: 16, shut: 22, time: 1.6 };

/** Main block: two storeys, stone to the north and east, glass to the south and west. */
export const HOUSE = {
  x0: 6, x1: 30, z0: -13, z1: 5,
  wall: 0.3,
  /** Walkable ground floor, its ceiling, the walkable first floor, its ceiling, the roof top. */
  floor0: 0.45, ceil0: 3.9, floor1: 4.1, ceil1: 7.2, roof: 7.55,
};

/** The first-floor volume, pulled back east and south and cantilevered 2 m west over the entrance. */
export const UPPER = { x0: 4, x1: 28, z0: -13, z1: 3 };

/** Front door, on the west face of the main block. */
export const ENTRY = { z: 2, w: 2.8, step: 0.15 };

/** Opening in the south glazing onto the terrace (no collider: you walk straight out). */
export const TERRACE_DOOR = { x: 14, w: 3.4 };

/** Door between the garage and the hall, with three steps up to the house floor. */
export const GARAGE_DOOR = { z: -6.4, w: 1.6 };

/**
 * Straight flight up the east side, climbing north. `stairFlight` lays its steps from local +Z
 * (bottom) towards 0 (top), so it is placed at the top and runs back 6 m to z = 4.
 */
export const STAIR = { x: 26, w: 1.5, zTop: -2, rise: 0.18, tread: 0.3 };

/** The void the stair comes up through, and so where the first-floor slab is not. */
export const VOID = { x0: 24.5, x1: UPPER.x1, z0: -2, z1: UPPER.z1 };

/** Pool on the south terrace: a raised coping you step over, water just under its lip. */
export const POOL = { x0: 10, x1: 26, z0: 11, z1: 18.5, coping: 0.35, rim: 0.9 };

/** The drive, as the rectangles it is paved from: in from the gate, the corner, the garage apron. */
export const DRIVE = {
  in: { x0: -PLOT.hw, x1: -14, z0: -3.2, z1: 3.2 },
  corner: { x0: -18, x1: -14, z0: -11.2, z1: 3.2 },
  apron: { x0: -18, x1: GARAGE.x0, z0: -11.2, z1: -4.8 },
  /** Outside the wall, across the verge to 恒惠路's kerb: the landmark's `extras`. */
  kerb: { x0: -66.2, x1: -PLOT.hw, z0: -3.2, z1: 3.2 },
};

export const FORECOURT = { x0: 0, x1: HOUSE.x0, z0: -1, z1: 6 };
export const TERRACE = { x0: HOUSE.x0, x1: HOUSE.x1, z0: HOUSE.z1, z1: POOL.z0 };

/** Where the car is meant to end up, and where the corona marks it: the middle of the garage. */
export const PARK_AT = { x: (GARAGE.x0 + GARAGE.x1) / 2, z: DOOR.z, yaw: Math.PI / 2 };

/** Feature trees in the lawn, and the row screening the north wall (x, z, height). */
export const TREES: [number, number, number][] = [
  [-34, 14, 7.5], [-24, -16, 8.2], [-38, -12, 7], [36, -18, 8], [40, 12, 7.5], [34, 20, 6.5],
  [-10, 18, 6], [18, -19, 7.2], [4, -19, 6.8], [-16, -19, 7], [30, -19, 7.4], [-30, 19, 6.6],
];

/** Bollard lights down the drive and round the terrace. */
export const LIGHTS: [number, number][] = [
  [-40, -4.4], [-40, 4.4], [-30, -4.4], [-30, 4.4], [-20, -4.4], [-20, 4.4],
  [-16, -12.6], [-8, -12.6], [2, 7], [2, -2.4], [8, 12.4], [28, 12.4], [8, 19.8], [28, 19.8],
];
