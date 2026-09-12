/**
 * The driving-school yard (驾校训练场) where M0 happens, as plain data. world/ builds it, the shot
 * poses frame it, and the handling tests can drive its features. Metres; +Z is north, +X is west
 * (the car's +X is its left, so a car facing +Z has west on its left).
 */
export const YARD = {
  /** Half-size of the paved square. */
  half: 220,
  spawn: { x: 0, z: -175, yaw: 0 },
  gate: { z: -220, width: 16 },
};

export const FIGURE8 = { cx: -110, cz: 0, r: 24, lane: 11 };

/** Straight-line strip on the east side: launches, top speed, the braking box. */
export const STRIP = { x: 150, z0: -200, z1: 200, laneWidth: 4, lanes: 2, boards: 50, brakeBoxZ: 120 };

export const SLALOM = { x: 55, z0: -130, gap: 18, count: 13 };

export interface RampDef { x: number; z: number; yaw: number; length: number; width: number; height: number }

/** Kicker for airtime, on its own run-up east of the slalom. */
export const JUMP: RampDef = { x: 100, z: 95, yaw: 0, length: 7, width: 5, height: 1.4 };

/** 坡道定点停车: the hill-start hump from the driving test (up, flat top, down). */
export const HILL = { x: -20, z: 110, width: 7, up: 12, top: 9, down: 12, height: 1.5 };

/** 科目二 paint: reverse-park bays, parallel-park box, S-bend and right-angle turn. */
export const TEST_AREA = {
  bays: { x: -60, z: -120, count: 4, width: 2.6, depth: 5.6 },
  parallel: { x: -135, z: -120, length: 7.5, width: 2.6 },
  sbend: { x: -165, z: 70, r: 16, width: 4 },
  rightAngle: { x: 20, z: -40, arm: 26, width: 4 },
};

export const OFFICE = { x: -160, z: -192, w: 34, d: 12, h: 8 };

/** Parked 教练车 (training cars) by the office. */
export const PARKED = [
  { x: -120, z: -190, yaw: 0 }, { x: -114, z: -190, yaw: 0 }, { x: -108, z: -190, yaw: 0 }, { x: -96, z: -190, yaw: 0 },
];

/**
 * Distant Beijing CBD, north-east of the yard, several kilometres out in the haze. Heights are the
 * real ones: 中国尊 528 m, 国贸三期 330 m, CCTV 234 m. Positions are free: it is a skyline cue.
 */
export const SKYLINE = {
  centre: { x: -1400, z: 2600 },
  zun: { x: -1350, z: 2700, h: 528 },
  gm3: { x: -1650, z: 2450, h: 330 },
  cctv: { x: -950, z: 2350, h: 234 },
};
