import type { WeaponState } from '../game/Contracts';

/**
 * Every gameplay/animation number for every weapon lives in this table.
 * Nothing else in the module switches on a weapon id.
 * Units: meters, seconds, radians, rounds-per-minute.
 */
export interface SpreadDef {
  hip: number; ads: number;
  /** added per m/s of player speed */
  move: number;
  crouchMul: number; airMul: number;
  /** spread added per shot and how fast it decays (rad, rad/s) */
  bloom: number; bloomMax: number; recover: number;
}

export interface RecoilDef {
  /** camera kick per shot (rad) */
  pitch: number; yaw: number; yawRandom: number;
  /** viewmodel kick */
  kickBack: number; kickUp: number; roll: number;
  /** climb pattern: index i -> [pitchMul, yawMul] applied to the i-th consecutive shot */
  pattern: [number, number][];
  /** spring stiffness/damping for viewmodel recoil return */
  stiffness: number; damping: number;
}

export interface DamageDef {
  base: number;
  /** damage multiplier per body part */
  head: number; torso: number; limb: number;
  /** full damage until `rangeNear`, falls to base*farMul at `rangeFar` */
  rangeNear: number; rangeFar: number; farMul: number;
  pellets?: number;
  /** thin-wall penetration budget in meters (0 = none) */
  penetration: number;
}

export interface TimingDef {
  rpm: number;
  burst?: number;
  adsIn: number; adsOut: number;
  sprintOut: number;
  raise: number; lower: number;
  reload: number; reloadEmpty: number;
  /** bolt/pump cycle time (0 = none) */
  cycle: number;
  inspect: number;
  melee: number;
}

export interface ViewDef {
  /**
   * Hip-fire offset from the viewmodel camera (right, up, forward is -z).
   *
   * Two rules govern these numbers against `fovHip` below:
   *
   *  - **Depth vs FOV.** On-screen size is `size / (dist * tan(vfov/2))`, so narrowing the viewmodel
   *    FOV without pushing the gun out makes it 60% bigger. x and y are *not* scaled with the depth
   *    when the FOV changes: `dist * tan(vfov/2)` is invariant under that pair, so a lateral offset in
   *    metres lands on the same pixels either way. Only the depth moves, which is exactly the "long
   *    lens on a close subject" look of a CoD viewmodel — the far end of the gun stays large while the
   *    near end stops converging.
   *  - **Framing.** Scaling the whole vector by one factor is the size knob: it leaves the screen
   *    position of the grip alone (x/dist is unchanged) and scales the weapon by 1/factor. The pure
   *    FOV move above preserved the size of the gun at the grip but shrank everything behind it — the
   *    stock used to sit 3 cm from the eye and fill the corner — so all three stances then come in by
   *    a further 0.80 to put the weapon back at the mass in frame the previous round was scored on.
   */
  hip: [number, number, number];
  hipRot: [number, number, number];
  /** normal sprint: gun lowered, muzzle down-left, ~20 deg cant */
  sprint: [number, number, number];
  sprintRot: [number, number, number];
  /** tactical sprint: gun high across the chest, muzzle up-left ~35 deg on screen */
  tac: [number, number, number];
  tacRot: [number, number, number];
  /** distance from the eye to the aim socket while aiming */
  adsDist: number;
  /**
   * Viewmodel camera field of view at hip / ads, **horizontal degrees at 16:9** - the same units the
   * player's `settings.fov` uses, so the two numbers are directly comparable. The reference frames put
   * the world at 80-100 deg and the weapon at 55-65 (ref/notes.md, "Viewmodel rendering"): the weapon
   * is drawn through a *longer* lens than the world, which is what stops the barrel converging.
   *
   * This was previously read as a vertical FOV, so `55` meant 85.6 deg horizontal - i.e. the viewmodel
   * was being drawn *wider* than the 80 deg world, the exact opposite of the reference, and the reason
   * three rounds of review called the barrel a fisheye.
   */
  fovHip: number; fovAds: number;
  /** sway/lag multipliers (heavier gun lags more) */
  swayMul: number;
  bobMul: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponState['kind'];
  fireMode: WeaponState['fireMode'];
  magSize: number;
  reserve: number;
  reserveMax: number;
  shellKind: 'rifle' | 'pistol' | 'shotgun';
  audio: string;
  spread: SpreadDef;
  recoil: RecoilDef;
  damage: DamageDef;
  timing: TimingDef;
  view: ViewDef;
  muzzleFlashScale: number;
  tracerEvery: number;
  /** slows the player while held */
  speedFactor: number;
  /** scope magnification when aiming (1 = iron/red-dot) */
  zoom: number;
}

const arPattern: [number, number][] = [[1, 0.2], [1.1, 0.3], [1.15, -0.4], [1.2, -0.6], [1.1, 0.7], [1.0, 0.9], [0.9, -0.8], [0.9, -1.0], [0.85, 0.6], [0.8, 0.4]];
const smgPattern: [number, number][] = [[1, 0.4], [1, -0.5], [1.05, 0.7], [1.05, -0.8], [1, 0.9], [1, -1], [0.95, 0.9], [0.9, -0.7]];

export const WEAPON_DEFS: WeaponDef[] = [
  {
    id: 'm4', name: 'M4A1', kind: 'rifle', fireMode: 'auto', magSize: 30, reserve: 120, reserveMax: 240, shellKind: 'rifle', audio: 'fire_ar',
    spread: { hip: 0.030, ads: 0.0025, move: 0.004, crouchMul: 0.7, airMul: 2.2, bloom: 0.006, bloomMax: 0.035, recover: 0.12 },
    recoil: { pitch: 0.0105, yaw: 0.0028, yawRandom: 0.002, kickBack: 0.028, kickUp: 0.012, roll: 0.012, pattern: arPattern, stiffness: 320, damping: 22 },
    damage: { base: 30, head: 2.0, torso: 1.0, limb: 0.85, rangeNear: 28, rangeFar: 60, farMul: 0.7, penetration: 0.25 },
    timing: { rpm: 800, adsIn: 0.22, adsOut: 0.18, sprintOut: 0.20, raise: 0.42, lower: 0.28, reload: 2.05, reloadEmpty: 2.65, cycle: 0, inspect: 4.6, melee: 0.75 },
    view: { hip: [0.096, -0.108, -0.4744], hipRot: [0.05, 0.08, 0.02], sprint: [0.128, -0.1104, -0.4296], sprintRot: [-0.20, 0.22, 0.30], tac: [0.04, -0.12, -0.3848], tacRot: [0.50, 0.62, 0.30], adsDist: 0.456, fovHip: 60, fovAds: 55, swayMul: 1, bobMul: 1 },
    muzzleFlashScale: 1, tracerEvery: 2, speedFactor: 1, zoom: 1,
  },
  {
    id: 'mp5', name: 'MP5', kind: 'smg', fireMode: 'auto', magSize: 30, reserve: 150, reserveMax: 270, shellKind: 'pistol', audio: 'fire_smg',
    spread: { hip: 0.024, ads: 0.004, move: 0.003, crouchMul: 0.75, airMul: 1.8, bloom: 0.005, bloomMax: 0.03, recover: 0.16 },
    recoil: { pitch: 0.0075, yaw: 0.0032, yawRandom: 0.0025, kickBack: 0.02, kickUp: 0.009, roll: 0.014, pattern: smgPattern, stiffness: 380, damping: 24 },
    damage: { base: 24, head: 1.8, torso: 1.0, limb: 0.85, rangeNear: 15, rangeFar: 35, farMul: 0.6, penetration: 0.1 },
    timing: { rpm: 850, adsIn: 0.17, adsOut: 0.15, sprintOut: 0.15, raise: 0.36, lower: 0.24, reload: 1.85, reloadEmpty: 2.4, cycle: 0, inspect: 4.0, melee: 0.7 },
    view: { hip: [0.096, -0.112, -0.436], hipRot: [0.05, 0.08, 0.02], sprint: [0.12, -0.1056, -0.3976], sprintRot: [-0.19, 0.21, 0.28], tac: [0.04, -0.12, -0.3592], tacRot: [0.48, 0.60, 0.28], adsDist: 0.421, fovHip: 60, fovAds: 56, swayMul: 0.8, bobMul: 0.9 },
    muzzleFlashScale: 0.75, tracerEvery: 2, speedFactor: 1.04, zoom: 1,
  },
  {
    id: 'm9', name: 'M9', kind: 'pistol', fireMode: 'semi', magSize: 15, reserve: 60, reserveMax: 120, shellKind: 'pistol', audio: 'fire_pistol',
    spread: { hip: 0.020, ads: 0.003, move: 0.003, crouchMul: 0.8, airMul: 1.8, bloom: 0.012, bloomMax: 0.04, recover: 0.2 },
    recoil: { pitch: 0.022, yaw: 0.004, yawRandom: 0.004, kickBack: 0.035, kickUp: 0.03, roll: 0.02, pattern: [[1, 0.5], [1, -0.5]], stiffness: 260, damping: 18 },
    damage: { base: 34, head: 2.0, torso: 1.0, limb: 0.8, rangeNear: 12, rangeFar: 30, farMul: 0.65, penetration: 0.08 },
    timing: { rpm: 480, adsIn: 0.14, adsOut: 0.12, sprintOut: 0.12, raise: 0.30, lower: 0.2, reload: 1.55, reloadEmpty: 1.95, cycle: 0, inspect: 3.6, melee: 0.6 },
    view: { hip: [0.08, -0.1, -0.3848], hipRot: [0.06, 0.08, 0.02], sprint: [0.104, -0.1, -0.3528], sprintRot: [-0.17, 0.20, 0.25], tac: [0.04, -0.104, -0.3208], tacRot: [0.42, 0.55, 0.26], adsDist: 0.640, fovHip: 60, fovAds: 57, swayMul: 0.7, bobMul: 0.8 },
    muzzleFlashScale: 0.6, tracerEvery: 1, speedFactor: 1.06, zoom: 1,
  },
  {
    id: 'm870', name: 'M870', kind: 'shotgun', fireMode: 'pump', magSize: 6, reserve: 30, reserveMax: 60, shellKind: 'shotgun', audio: 'fire_shotgun',
    spread: { hip: 0.055, ads: 0.038, move: 0.003, crouchMul: 0.9, airMul: 1.4, bloom: 0.0, bloomMax: 0.0, recover: 0.2 },
    recoil: { pitch: 0.06, yaw: 0.008, yawRandom: 0.008, kickBack: 0.075, kickUp: 0.045, roll: 0.03, pattern: [[1, 0.5]], stiffness: 200, damping: 16 },
    damage: { base: 14, head: 1.6, torso: 1.0, limb: 0.9, rangeNear: 7, rangeFar: 18, farMul: 0.3, pellets: 8, penetration: 0 },
    timing: { rpm: 70, adsIn: 0.24, adsOut: 0.2, sprintOut: 0.24, raise: 0.5, lower: 0.32, reload: 0.62, reloadEmpty: 0.62, cycle: 0.72, inspect: 4.2, melee: 0.8 },
    view: { hip: [0.1, -0.116, -0.4872], hipRot: [0.05, 0.08, 0.02], sprint: [0.128, -0.1136, -0.4424], sprintRot: [-0.20, 0.22, 0.30], tac: [0.04, -0.12, -0.3976], tacRot: [0.50, 0.62, 0.30], adsDist: 0.530, fovHip: 60, fovAds: 56, swayMul: 1.25, bobMul: 1.1 },
    muzzleFlashScale: 1.5, tracerEvery: 0, speedFactor: 0.96, zoom: 1,
  },
  {
    id: 'l96', name: 'L96A1', kind: 'sniper', fireMode: 'bolt', magSize: 5, reserve: 25, reserveMax: 50, shellKind: 'rifle', audio: 'fire_sniper',
    spread: { hip: 0.09, ads: 0.0004, move: 0.006, crouchMul: 0.7, airMul: 3, bloom: 0.0, bloomMax: 0.0, recover: 0.3 },
    recoil: { pitch: 0.075, yaw: 0.012, yawRandom: 0.01, kickBack: 0.09, kickUp: 0.05, roll: 0.045, pattern: [[1, 0.5]], stiffness: 160, damping: 15 },
    damage: { base: 150, head: 2.0, torso: 1.0, limb: 0.75, rangeNear: 80, rangeFar: 200, farMul: 0.9, penetration: 0.6 },
    timing: { rpm: 45, adsIn: 0.34, adsOut: 0.26, sprintOut: 0.32, raise: 0.6, lower: 0.38, reload: 2.9, reloadEmpty: 3.4, cycle: 1.15, inspect: 5.0, melee: 0.9 },
    // adsDist is set by the scope ring, not by taste: the ocular bell's 18.1 mm silhouette radius
    // (measured off the render, not off the geometry) must fill ~57% of frame height like ref_03,
    // i.e. r / (d * tan(vfov/2)) = 0.57 with vfov = 29.4 deg -> d = 0.121 m.
    view: { hip: [0.1, -0.12, -0.5128], hipRot: [0.05, 0.08, 0.02], sprint: [0.128, -0.1184, -0.4552], sprintRot: [-0.20, 0.22, 0.30], tac: [0.04, -0.12, -0.3976], tacRot: [0.50, 0.62, 0.30], adsDist: 0.1210, fovHip: 60, fovAds: 50, swayMul: 1.5, bobMul: 1.2 },
    muzzleFlashScale: 1.6, tracerEvery: 1, speedFactor: 0.92, zoom: 6,
  },
];

export const DEF_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPON_DEFS.map((d) => [d.id, d]));

/** Starting loadout as slot indices into WEAPON_DEFS. */
export const DEFAULT_LOADOUT = ['m4', 'mp5', 'm9', 'm870', 'l96'];

/** Spread-related constants shared by all weapons. */
export const BALLISTICS = {
  maxRange: 400,
  /** m/s of speed above which the "moving" spread term is fully applied */
  moveSpeedRef: 4.6,
  /** how many meters the eye is ahead of the camera for the shot origin (avoids hitting own capsule) */
  originForward: 0.05,
} as const;
