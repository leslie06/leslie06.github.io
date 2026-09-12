/**
 * Vehicle tuning data. Body frame: origin at wheel-hub height, mid-wheelbase; +Z forward, +X left,
 * +Y up. Units are SI (m, kg, N, rad) unless the name says otherwise.
 */
export interface WheelMount { x: number; z: number; front: boolean }

export interface VehicleSpec {
  name: string;
  mass: number;
  /** Centre of mass in the body frame. Lower than a real car's on purpose: arcade roll-over margin. */
  com: [number, number, number];
  /** Principal inertia about X (pitch), Y (yaw), Z (roll), kg·m². */
  inertia: [number, number, number];
  /** Rounded boxes for the chassis collider (they carry no mass; `mass`/`inertia` do). */
  chassis: { half: [number, number, number]; at: [number, number, number]; round: number }[];
  /** FL, FR, RL, RR. */
  wheels: WheelMount[];
  wheelRadius: number;
  wheelWidth: number;
  /** Height of the suspension hard points in the body frame. */
  mountY: number;
  suspension: {
    /** Spring length at zero load. */
    restLength: number;
    stiffnessFront: number; stiffnessRear: number;
    /** Damper rates, N/(m/s). Rebound stiffer than bump, as on a road car. */
    bump: number; rebound: number;
    /** Compression beyond which the bump stop takes over. */
    travel: number;
    /** Anti-roll bars, N per metre of left/right compression difference. */
    antiRollFront: number; antiRollRear: number;
  };
  tire: {
    muLat: number; muLong: number;
    /** Magic-formula stiffness and shape. */
    B: number; C: number;
    /** Friction of a locked (handbraked) tyre, as a fraction of `muLong`. */
    slide: number;
    /** Grip lost per unit of load above static (tyres give less per newton as load rises). */
    loadSensitivity: number;
    /**
     * Height above the contact patch where tyre forces act. Real tyres push at the ground, which
     * gives a 1.4 t box a roll moment it can trip over at 1 g; lifting the point towards the centre
     * of mass trades that for stability, and the visible body roll is added back in the model.
     */
    forceHeight: number;
    /** Rolling resistance coefficient. */
    rolling: number;
    /**
     * Rear lateral grip multiplier. Slightly above 1 on a front-heavy car: at 1.0 the rear axle
     * saturated first above ~75 km/h and a held steering key became a 50° slide.
     */
    rearGrip: number;
    /**
     * Most of its longitudinal grip a driven tyre may spend on drive while the car is sliding and
     * the player steers into the slide, so it keeps some sideways grip to balance the slide against
     * (0.88 leaves ~47%).
     */
    driftDriveCap: number;
    /**
     * The same cap with the wheel straight or steering out of the slide. Lower, so the rear finds
     * grip and the drift ends even with W held; a single cap made a drift a stable 40° orbit the
     * steering could not leave (handling critic round 1, issue 2).
     */
    driftDriveCapNeutral: number;
    /**
     * The neutral cap falls to this between `driftCapFastFrom` and `driftCapFastTo` m/s: at 90 km/h
     * a 0.7 cap left the rear too little grip and a straightened drift took 3+ s to end.
     */
    driftDriveCapNeutralFast: number; driftCapFastFrom: number; driftCapFastTo: number;
  };
  steer: {
    /** Mechanical lock, rad. */
    lock: number;
    /**
     * How far past the peak slip angle full lock may push the front tyres at speed. The limiter
     * turns full keyboard lock into "the most the front tyres can give" instead of a skid.
     */
    overdrive: number;
    minAngle: number;
    /** Road-wheel slew rate, rad/s. */
    rate: number;
    /** Automatic counter-steer, as a fraction of body slip angle. */
    counterSteer: number;
    /**
     * Share of the driver's steering removed once the car is sliding. Holding full lock into a
     * drift is what a keyboard player does, and with full authority it drags the front tyres far
     * past their peak and spins the car; the assist keeps the fronts pointing along the slide and
     * leaves the player a trim.
     */
    driftCut: number;
  };
  engine: {
    idle: number; redline: number;
    torque: [number, number][];
    gears: number[]; reverse: number; final: number; efficiency: number;
    shiftUp: number; shiftDown: number; shiftTime: number;
    /** Fraction of drive to the front axle (0 = rear-wheel drive). */
    frontShare: number;
    /** Engine braking torque as a fraction of the torque curve with the throttle shut. */
    engineBrake: number;
    limiterKmh: number; reverseKmh: number;
    /** Clutch-slip rpm at full throttle in first/reverse. */
    launchRpm: number;
  };
  brakes: { force: number; frontBias: number };
  aero: { drag: number; downforce: number };
  assists: {
    /** Yaw damping once the body slip passes `spinAngle`, so an over-rotated slide stops short of a spin. */
    spinGuard: number;
    spinAngle: number;
    /** Spin-guard angle when the player is not steering into the slide (it acts earlier). */
    spinAngleNeutral: number;
    /**
     * Yaw damping (1/s) while sliding with the wheel near centre, off during and just after the
     * handbrake: stops a handbrake turn rotating past where the player straightened up.
     */
    calmYawDamp: number;
    /** Pitch/roll damping in the air, 1/s. */
    airDamping: number;
    /** Pitch/roll authority in the air, rad/s². */
    airControl: number;
    /** Seconds on the roof/side before the car rolls itself back. */
    selfRight: number;
    /**
     * Donut intent: steering past `steer` with throttle past `throttle` below `speedHi` m/s lets
     * the rear break away (traction control fades out between `speedLo` and `speedHi`, drive may
     * use `cap` of the tyre). A rolling corner at part throttle keeps its traction.
     */
    donut: { steer: number; throttle: number; speedLo: number; speedHi: number; cap: number };
  };
}

/**
 * 北京出租车: a mid-size front-engined saloon (think Elantra-class, 2.7 m wheelbase). Converted to
 * rear drive and given a little more torque than the real thing, because the game is a GTA and a
 * taxi that cannot hold a slide is no fun to drive.
 */
export const TAXI: VehicleSpec = {
  name: 'taxi',
  mass: 1400,
  com: [0, 0.07, 0.1],
  inertia: [2100, 2350, 620],
  chassis: [
    { half: [0.86, 0.36, 2.2], at: [0, 0.17, 0.02], round: 0.1 },
    { half: [0.7, 0.29, 1.05], at: [0, 0.8, -0.22], round: 0.12 },
  ],
  wheels: [
    { x: 0.77, z: 1.3, front: true },
    { x: -0.77, z: 1.3, front: true },
    { x: 0.77, z: -1.4, front: false },
    { x: -0.77, z: -1.4, front: false },
  ],
  wheelRadius: 0.32,
  wheelWidth: 0.21,
  mountY: 0.22,
  suspension: {
    restLength: 0.31, stiffnessFront: 42000, stiffnessRear: 34000,
    bump: 1900, rebound: 3300, travel: 0.22,
    antiRollFront: 16000, antiRollRear: 12000,
  },
  tire: {
    muLat: 1.05, muLong: 1.1, B: 13, C: 1.45, slide: 0.75, loadSensitivity: 0.08,
    forceHeight: 0.24, rolling: 0.012, rearGrip: 1.06, driftDriveCap: 0.88, driftDriveCapNeutral: 0.7,
    driftDriveCapNeutralFast: 0.58, driftCapFastFrom: 14, driftCapFastTo: 24,
  },
  steer: { lock: 0.72, overdrive: 1.35, minAngle: 0.09, rate: 3.2, counterSteer: 0.85, driftCut: 0.65 },
  engine: {
    idle: 850, redline: 6800,
    torque: [[1000, 175], [2500, 232], [4000, 265], [5200, 270], [6200, 243], [6800, 215]],
    gears: [3.4, 2.1, 1.45, 1.1, 0.88], reverse: 3.2, final: 4.1, efficiency: 0.88,
    shiftUp: 6300, shiftDown: 2600, shiftTime: 0.18,
    frontShare: 0, engineBrake: 0.3,
    limiterKmh: 185, reverseKmh: 35, launchRpm: 3000,
  },
  brakes: { force: 16500, frontBias: 0.66 },
  aero: { drag: 0.42, downforce: 0.9 },
  assists: {
    spinGuard: 2.5, spinAngle: 0.7, spinAngleNeutral: 0.5, calmYawDamp: 2, airDamping: 1.6, airControl: 2.2, selfRight: 3,
    donut: { steer: 0.8, throttle: 0.9, speedLo: 7, speedHi: 11, cap: 0.95 },
  },
};

// ---- more body types -------------------------------------------------------------------------------
// Added alongside TAXI (which the handling suite pins). Same physics, numbers from the class of car:
// mass and inertia of the real thing (inertia ~0.8 of a uniform box: the mass sits low and central),
// springs from a target ride frequency (f = sqrt(k / m_corner) / 2pi) with mountY set so the hubs
// sit at y = 0 at rest, dampers ~0.25 / 0.45 of critical, gearing from the top speed and 0-100.
// Tyre forces act higher on the tall bodies so the lever to the centre of mass stays ~0.2-0.35 m.

/** A private sedan is the taxi's chassis. */
export const SEDAN: VehicleSpec = TAXI;

/** Compact hatchback (Golf / Polo class, 1.4T, front drive): light, short, nimble, understeers on power. */
export const HATCH: VehicleSpec = {
  name: 'hatch',
  mass: 1200,
  com: [0, 0.09, 0.2],
  inertia: [1500, 1600, 480],
  chassis: [
    { half: [0.85, 0.35, 2.0], at: [0, 0.17, 0.06], round: 0.1 },
    { half: [0.7, 0.3, 0.98], at: [0, 0.8, -0.34], round: 0.12 },
  ],
  wheels: [
    { x: 0.75, z: 1.23, front: true },
    { x: -0.75, z: 1.23, front: true },
    { x: 0.75, z: -1.32, front: false },
    { x: -0.75, z: -1.32, front: false },
  ],
  wheelRadius: 0.31,
  wheelWidth: 0.2,
  mountY: 0.205,
  suspension: {
    restLength: 0.3, stiffnessFront: 36000, stiffnessRear: 26000,
    bump: 1700, rebound: 3000, travel: 0.2,
    antiRollFront: 15000, antiRollRear: 11000,
  },
  tire: { ...TAXI.tire },
  steer: { ...TAXI.steer, lock: 0.74 },
  engine: {
    idle: 850, redline: 6500,
    torque: [[1000, 150], [1600, 215], [3500, 228], [5000, 220], [6000, 190], [6500, 170]],
    gears: [3.65, 2.2, 1.5, 1.12, 0.9], reverse: 3.4, final: 4.2, efficiency: 0.88,
    shiftUp: 6000, shiftDown: 2400, shiftTime: 0.15,
    frontShare: 1, engineBrake: 0.3,
    limiterKmh: 185, reverseKmh: 35, launchRpm: 2800,
  },
  brakes: { force: 14500, frontBias: 0.68 },
  aero: { drag: 0.4, downforce: 0.7 },
  assists: { ...TAXI.assists, donut: { ...TAXI.assists.donut } },
};

/** Compact SUV (Haval H6 / Tiguan class, 2.0T, part-time AWD): heavier, taller, softer. */
export const SUV: VehicleSpec = {
  name: 'suv',
  mass: 1750,
  com: [0, 0.16, 0.12],
  inertia: [2750, 2900, 900],
  chassis: [
    { half: [0.9, 0.42, 2.24], at: [0, 0.24, -0.01], round: 0.12 },
    { half: [0.76, 0.3, 1.25], at: [0, 0.96, -0.3], round: 0.14 },
  ],
  wheels: [
    { x: 0.8, z: 1.36, front: true },
    { x: -0.8, z: 1.36, front: true },
    { x: 0.8, z: -1.36, front: false },
    { x: -0.8, z: -1.36, front: false },
  ],
  wheelRadius: 0.36,
  wheelWidth: 0.235,
  mountY: 0.235,
  suspension: {
    restLength: 0.38, stiffnessFront: 32000, stiffnessRear: 27000,
    bump: 2000, rebound: 3600, travel: 0.26,
    antiRollFront: 22000, antiRollRear: 16000,
  },
  tire: { ...TAXI.tire, muLat: 1.0, muLong: 1.05, forceHeight: 0.3, rolling: 0.013 },
  steer: { ...TAXI.steer, lock: 0.7, rate: 3.0 },
  engine: {
    idle: 800, redline: 6200,
    torque: [[1000, 220], [1800, 340], [4000, 350], [5000, 320], [5800, 280], [6200, 250]],
    gears: [3.9, 2.3, 1.55, 1.15, 0.9, 0.75], reverse: 3.5, final: 3.9, efficiency: 0.86,
    shiftUp: 5700, shiftDown: 2200, shiftTime: 0.2,
    frontShare: 0.4, engineBrake: 0.3,
    limiterKmh: 190, reverseKmh: 30, launchRpm: 2600,
  },
  brakes: { force: 20000, frontBias: 0.64 },
  aero: { drag: 0.56, downforce: 0.6 },
  assists: { ...TAXI.assists, donut: { ...TAXI.assists.donut } },
};

/** MPV (Buick GL8 class, 2.0T, front drive): long, heavy, comfortable. */
export const MPV: VehicleSpec = {
  name: 'mpv',
  mass: 1950,
  com: [0, 0.14, 0.1],
  inertia: [3800, 3950, 1100],
  chassis: [
    { half: [0.92, 0.42, 2.56], at: [0, 0.22, -0.1], round: 0.12 },
    { half: [0.82, 0.38, 1.9], at: [0, 1.0, -0.45], round: 0.16 },
  ],
  wheels: [
    { x: 0.81, z: 1.5, front: true },
    { x: -0.81, z: 1.5, front: true },
    { x: 0.81, z: -1.59, front: false },
    { x: -0.81, z: -1.59, front: false },
  ],
  wheelRadius: 0.34,
  wheelWidth: 0.225,
  mountY: 0.223,
  suspension: {
    restLength: 0.36, stiffnessFront: 38000, stiffnessRear: 32000,
    bump: 2200, rebound: 3900, travel: 0.24,
    antiRollFront: 22000, antiRollRear: 16000,
  },
  tire: { ...TAXI.tire, muLat: 1.0, muLong: 1.05, forceHeight: 0.28, rolling: 0.013 },
  steer: { ...TAXI.steer, lock: 0.7, rate: 2.9 },
  engine: {
    idle: 800, redline: 6200,
    torque: [[1000, 220], [1750, 350], [4000, 350], [5000, 320], [5800, 270], [6200, 240]],
    gears: [4.0, 2.4, 1.6, 1.2, 0.95, 0.78], reverse: 3.6, final: 3.8, efficiency: 0.86,
    shiftUp: 5600, shiftDown: 2200, shiftTime: 0.2,
    frontShare: 1, engineBrake: 0.3,
    limiterKmh: 180, reverseKmh: 30, launchRpm: 2500,
  },
  brakes: { force: 21000, frontBias: 0.66 },
  aero: { drag: 0.62, downforce: 0.5 },
  assists: { ...TAXI.assists, donut: { ...TAXI.assists.donut } },
};

/**
 * Beijing city bus: a 12 m single-deck, 6 m wheelbase, rear diesel (~1100 N·m), 4-speed automatic,
 * air suspension, twin rear tyres (one ray each side; the model draws the pair), limited to 75 km/h.
 */
export const BUS: VehicleSpec = {
  name: 'bus',
  mass: 12500,
  com: [0, 0.3, -0.4],
  inertia: [136000, 133000, 16000],
  chassis: [
    { half: [1.26, 1.38, 5.98], at: [0, 1.24, -0.4], round: 0.15 },
  ],
  wheels: [
    { x: 1.04, z: 3.0, front: true },
    { x: -1.04, z: 3.0, front: true },
    { x: 0.9, z: -3.0, front: false },
    { x: -0.9, z: -3.0, front: false },
  ],
  wheelRadius: 0.48,
  wheelWidth: 0.28,
  mountY: 0.246,
  suspension: {
    restLength: 0.45, stiffnessFront: 130000, stiffnessRear: 170000,
    bump: 9500, rebound: 17000, travel: 0.25,
    antiRollFront: 90000, antiRollRear: 110000,
  },
  tire: {
    muLat: 0.9, muLong: 0.95, B: 10, C: 1.4, slide: 0.75, loadSensitivity: 0.08,
    forceHeight: 0.45, rolling: 0.008, rearGrip: 1.1, driftDriveCap: 0.88, driftDriveCapNeutral: 0.7,
    driftDriveCapNeutralFast: 0.58, driftCapFastFrom: 14, driftCapFastTo: 24,
  },
  steer: { lock: 0.62, overdrive: 1.2, minAngle: 0.05, rate: 1.6, counterSteer: 0.85, driftCut: 0.65 },
  engine: {
    idle: 600, redline: 2400,
    torque: [[700, 700], [1000, 1050], [1300, 1100], [1800, 1050], [2200, 900], [2400, 800]],
    gears: [3.0, 1.8, 1.3, 1.0], reverse: 3.2, final: 5.0, efficiency: 0.85,
    shiftUp: 2100, shiftDown: 1000, shiftTime: 0.35,
    frontShare: 0, engineBrake: 0.35,
    limiterKmh: 75, reverseKmh: 15, launchRpm: 1100,
  },
  brakes: { force: 80000, frontBias: 0.55 },
  aero: { drag: 2.7, downforce: 0 },
  assists: {
    spinGuard: 2.5, spinAngle: 0.5, spinAngleNeutral: 0.35, calmYawDamp: 2.5, airDamping: 1.6, airControl: 0.6, selfRight: 3,
    donut: { steer: 1.1, throttle: 0.9, speedLo: 7, speedHi: 11, cap: 0.95 },
  },
};

/** Light box truck (4.2 m box, cab-over, ~4.5 t laden, diesel, twin rear tyres), 100 km/h. */
export const TRUCK: VehicleSpec = {
  name: 'truck',
  mass: 4500,
  com: [0, 0.35, -0.2],
  inertia: [14600, 13560, 4800],
  chassis: [
    { half: [0.99, 1.07, 0.87], at: [0, 1.03, 2.07], round: 0.12 },
    { half: [1.05, 0.98, 2.07], at: [0, 1.6, -0.97], round: 0.06 },
    { half: [0.45, 0.2, 2.3], at: [0, 0.3, -0.6], round: 0.05 },
  ],
  wheels: [
    { x: 0.83, z: 1.8, front: true },
    { x: -0.83, z: 1.8, front: true },
    { x: 0.78, z: -1.5, front: false },
    { x: -0.78, z: -1.5, front: false },
  ],
  wheelRadius: 0.4,
  wheelWidth: 0.21,
  mountY: 0.225,
  suspension: {
    restLength: 0.33, stiffnessFront: 78000, stiffnessRear: 136000,
    bump: 4000, rebound: 7500, travel: 0.2,
    antiRollFront: 40000, antiRollRear: 60000,
  },
  tire: {
    muLat: 0.95, muLong: 1.0, B: 11, C: 1.4, slide: 0.75, loadSensitivity: 0.08,
    forceHeight: 0.42, rolling: 0.01, rearGrip: 1.1, driftDriveCap: 0.88, driftDriveCapNeutral: 0.7,
    driftDriveCapNeutralFast: 0.58, driftCapFastFrom: 14, driftCapFastTo: 24,
  },
  steer: { lock: 0.68, overdrive: 1.25, minAngle: 0.06, rate: 2.2, counterSteer: 0.85, driftCut: 0.65 },
  engine: {
    idle: 700, redline: 3400,
    torque: [[800, 300], [1200, 420], [1800, 440], [2600, 400], [3100, 340], [3400, 300]],
    gears: [5.0, 2.8, 1.7, 1.2, 1.0], reverse: 5.0, final: 4.3, efficiency: 0.86,
    shiftUp: 3000, shiftDown: 1300, shiftTime: 0.3,
    frontShare: 0, engineBrake: 0.35,
    limiterKmh: 100, reverseKmh: 18, launchRpm: 1300,
  },
  brakes: { force: 34000, frontBias: 0.6 },
  aero: { drag: 2.4, downforce: 0 },
  assists: {
    spinGuard: 2.5, spinAngle: 0.55, spinAngleNeutral: 0.4, calmYawDamp: 2.5, airDamping: 1.6, airControl: 1.0, selfRight: 3,
    donut: { steer: 1.1, throttle: 0.9, speedLo: 7, speedHi: 11, cap: 0.95 },
  },
};

/** Spec per body type (the sedan is the taxi's). */
export const SPEC_OF: Record<import('./Bodies').BodyType, VehicleSpec> = { sedan: TAXI, hatch: HATCH, suv: SUV, mpv: MPV, bus: BUS, truck: TRUCK };
