/**
 * Every tunable number for the enemies module. AI/animation code reads from here; nothing in
 * AI.ts / Enemy.ts / Animator.ts carries its own magic numbers.
 */

export interface ArchetypeDef {
  id: string;
  /** Camo palette id used by Textures.ts */
  camo: 'multicam' | 'flecktarn' | 'urban' | 'desert';
  gearColor: number;      // nylon gear (plate carrier, pouches, belt)
  helmetColor: number;
  balaclavaColor: number;
  skinColor: number;
  eyeColor: number;
  health: number;
  /** multiplier on movement speeds */
  speedMul: number;
  /** multiplier on accuracy (hit chance) */
  accuracyMul: number;
  /** seconds before first shot after acquiring the player */
  reactionTime: number;
  burstMin: number; burstMax: number;
  /** wearable variant switches: NVG on helmet, headset, holster */
  nvg: boolean; headset: boolean; holster: boolean; rifleFurniture: 'wood' | 'polymer';
  /** headgear: ballistic helmet, patrol cap, boonie hat, or bare head (short hair) */
  head: 'helmet' | 'cap' | 'boonie' | 'bare';
  /** face cover: balaclava with an eye opening, open-face mask (eyes+nose+mouth), neck gaiter only, or nothing */
  face: 'balaclava' | 'openmask' | 'gaiter' | 'bare';
  sleeves: 'long' | 'rolled';
  /** trousers tucked/bloused into the boots or loose over them */
  pants: 'tucked' | 'loose';
  beard: boolean;

  // ---- the four axes that still separate soldiers at 15 m through haze ----
  /**
   * Overall albedo value multiplier. Hue differences vanish into aerial perspective long before
   * value does, so a squad needs a genuinely dark member and a genuinely light one, not four
   * mid-tone soldiers in different colours.
   */
  value: number;
  /** girth multiplier on the torso, deltoids and limbs: lean scout vs heavy breacher */
  build: number;
  /** back silhouette: nothing, a slim assault pack, a radio pack with a whip antenna, or a full ruck */
  pack: 'none' | 'daypack' | 'radio' | 'ruck';
  /**
   * Weapon carried. At 15 m in greyscale a soldier IS his weapon outline — barrel length, magazine
   * shape, what sits on the receiver, what hangs under the handguard. Four archetypes carrying the
   * same AK is four recolours however different their camo is.
   */
  weapon: 'ak' | 'carbine' | 'dmr' | 'lmg' | 'shotgun';
  /** index into STANCES: how the soldier stands when idle */
  stance: number;
  /** hip-height offset in metres. The legs are IK'd to the ground, so this is real height variation */
  stature: number;
}

/**
 * Idle stance families. Four soldiers sharing one stance read as one soldier copied four times
 * however different their gear is, so each archetype gets its own footprint, carry height and
 * shoulder line.
 */
/**
 * Resting stances. Round 3's ladder moved these by two or three centimetres, which is a phase
 * offset, not a posture: the four archetypes still stood square-on with the weapon in the same
 * place and read as one man in four paint schemes. These are whole different ways of standing —
 * where the weapon sits relative to the body, how far the elbows come off the ribs, how the feet
 * are planted, how much the back is bent. `carry*` are offsets on the low-ready carry (metres /
 * radians); `elbowOut` swings the arm IK pole away from the body; `hunch` is permanent spine
 * flexion on top of the aim/crouch hunch.
 */
export const STANCES = [
  // Negative carryPitch drops the muzzle, positive raises it (it adds to ANIM.carryPitch = -0.35).
  // 0: patrol high-ready — square-on, weapon across the chest, muzzle just below horizontal
  { width: 0.004, lean: 0.01, carryX: 0, carryY: 0.03, carryZ: 0, carryPitch: -0.06, carryYaw: 0.06, shoulder: 0, feetSkew: -0.01, elbowOut: 0, hunch: 0 },
  // 1: heavy low-carry — feet wide, weight back, weapon out from the hip, muzzle 30 deg down, elbows flared
  { width: 0.088, lean: 0.075, carryX: 0.05, carryY: -0.1, carryZ: -0.02, carryPitch: -0.3, carryYaw: -0.1, shoulder: -0.085, feetSkew: 0.07, elbowOut: 0.5, hunch: 0.11 },
  // 2: bladed port-arms — narrow feet, torso side-on, weapon high across the chest with the muzzle up
  { width: -0.052, lean: -0.055, carryX: -0.06, carryY: 0.145, carryZ: -0.02, carryPitch: 0.82, carryYaw: 0.36, shoulder: 0.1, feetSkew: -0.075, elbowOut: -0.32, hunch: -0.06 },
  // 3: relaxed sling carry — feet close, shoulders slack, muzzle hanging down past the right knee
  { width: 0.02, lean: 0.03, carryX: 0.075, carryY: -0.185, carryZ: 0.09, carryPitch: -0.34, carryYaw: 0.46, shoulder: 0.045, feetSkew: 0.11, elbowOut: 0.24, hunch: -0.08 },
];
export type StanceDef = typeof STANCES[number];

export const ARCHETYPES: Record<string, ArchetypeDef> = {
  rifleman: {
    id: 'rifleman', camo: 'multicam', gearColor: 0x5f4e33, helmetColor: 0x5b5340, balaclavaColor: 0x38382f, skinColor: 0xc39a78, eyeColor: 0x5a4a30,
    health: 100, speedMul: 1, accuracyMul: 1, reactionTime: 0.55, burstMin: 3, burstMax: 6,
    nvg: true, headset: true, holster: true, rifleFurniture: 'wood',
    head: 'helmet', face: 'balaclava', sleeves: 'long', pants: 'tucked', beard: false,
    // the baseline: mid height, mid build, AK, slim assault pack
    value: 0.95, build: 1.0, pack: 'daypack', stance: 0, stature: 0.005, weapon: 'ak',
  },
  assault: {
    id: 'assault', camo: 'flecktarn', gearColor: 0x1c1a15, helmetColor: 0x2b3226, balaclavaColor: 0x171410, skinColor: 0x8a5f42, eyeColor: 0x2e2018,
    health: 120, speedMul: 1.12, accuracyMul: 0.9, reactionTime: 0.45, burstMin: 4, burstMax: 8,
    nvg: false, headset: true, holster: false, rifleFurniture: 'polymer',
    // bare head + headset is a good silhouette; the *face* under it was a lumpy brown blob, so it
    // wears the balaclava like everyone else now
    head: 'bare', face: 'balaclava', sleeves: 'rolled', pants: 'tucked', beard: false,
    // the tall, heavy, dark one
    value: 0.76, build: 1.2, pack: 'ruck', stance: 1, stature: 0.038, weapon: 'carbine',
  },
  marksman: {
    id: 'marksman', camo: 'urban', gearColor: 0x464950, helmetColor: 0x43464c, balaclavaColor: 0x232428, skinColor: 0xd9b394, eyeColor: 0x4f6a7a,
    health: 90, speedMul: 0.95, accuracyMul: 1.35, reactionTime: 0.7, burstMin: 2, burstMax: 3,
    nvg: false, headset: true, holster: true, rifleFurniture: 'polymer',
    head: 'cap', face: 'gaiter', sleeves: 'long', pants: 'loose', beard: false,
    // the lean, short, near-black one
    value: 0.58, build: 0.84, pack: 'none', stance: 2, stature: -0.052, weapon: 'dmr',
  },
  grunt: {
    id: 'grunt', camo: 'desert', gearColor: 0x54492f, helmetColor: 0xb8a887, balaclavaColor: 0x3c372a, skinColor: 0x8f6642, eyeColor: 0x3a2a1a,
    health: 80, speedMul: 1, accuracyMul: 0.85, reactionTime: 0.7, burstMin: 3, burstMax: 6,
    nvg: false, headset: false, holster: true, rifleFurniture: 'wood',
    head: 'boonie', face: 'gaiter', sleeves: 'rolled', pants: 'loose', beard: false,
    // the short, pale, wide-brimmed one
    value: 1.06, build: 1.06, pack: 'radio', stance: 3, stature: -0.072, weapon: 'lmg',
  },
};
export const ARCHETYPE_ORDER = ['rifleman', 'assault', 'marksman', 'grunt'] as const;
// Aliases used by the game module's wave table. Each gets its own look so mixed waves never clone.
ARCHETYPES.shotgunner = { ...ARCHETYPES.assault, id: 'shotgunner', health: 110, speedMul: 1.15, burstMin: 5, burstMax: 9, head: 'helmet', face: 'balaclava', skinColor: 0xb88c6a, eyeColor: 0x4a3a28, beard: false, value: 0.88, build: 1.08, pack: 'daypack', stance: 1, stature: 0.014, weapon: 'shotgun' };
ARCHETYPES.heavy = { ...ARCHETYPES.assault, id: 'heavy', health: 220, speedMul: 0.85, accuracyMul: 0.8, burstMin: 8, burstMax: 14, reactionTime: 0.6, head: 'helmet', face: 'balaclava', sleeves: 'long', nvg: true, skinColor: 0xc9a07e, beard: false, value: 0.7, build: 1.26, pack: 'ruck', stance: 1, stature: 0.04, weapon: 'lmg' };
ARCHETYPES.sniper = { ...ARCHETYPES.marksman, id: 'sniper', health: 80, accuracyMul: 1.6, burstMin: 1, burstMax: 2, reactionTime: 0.9, head: 'boonie', face: 'gaiter', beard: true, skinColor: 0xb98a6a, eyeColor: 0x3f5a3a, value: 0.64, build: 0.82, pack: 'none', stance: 2, stature: -0.058, weapon: 'dmr' };
export function archetypeOf(id: string | undefined): ArchetypeDef { return (id && ARCHETYPES[id]) || ARCHETYPES.rifleman; }

/** Global difficulty scalar defaults (1 = regular). setDifficulty() multiplies these. */
export const DIFFICULTY = {
  accuracy: 1,
  damage: 1,
  reaction: 1,
  aggression: 1,
};

export const MOVE = {
  walkSpeed: 1.7,
  runSpeed: 4.6,
  strafeSpeed: 2.4,
  crouchSpeed: 1.3,
  accel: 14,
  decel: 18,
  turnRate: 9,          // rad/s exponential damp
  gravity: 18,
  capsuleRadius: 0.32,
  capsuleHalfHeight: 0.58,
  stepHeight: 0.4,
  separationRadius: 1.4,
  separationWeight: 1.8,
  arriveRadius: 0.45,
  whiskerAngles: [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.2, -2.2],
  whiskerLength: 2.2,
  whiskerHeights: [0.3, 0.8],
  detourTime: 2.5,
  replanInterval: 0.8,
  /** metres of progress per second below which we count as stuck */
  stuckSpeed: 0.35,
  stuckTime: 0.9,
  /**
   * Seconds of *continuous* failure to move before a soldier is written off as wedged and killed.
   *
   * `stuckTime` above only arms the AI's detour, and the detour resets `stuckTimer`, so no counter
   * in the brain can ever notice a soldier who is permanently trapped - spawned inside geometry, or
   * stranded on a nav island with no route out. The wave director's clear condition is `alive <= 0`,
   * so exactly one such soldier ends the run: the player kills everything they can find and the
   * next wave never starts. This is the backstop, and it is deliberately long - a soldier who is
   * merely holding cover never reaches it, because the counter only advances while he is actively
   * trying to move and failing.
   */
  wedgedTime: 25,
};

/**
 * Repair pass on the nav graph the level hands us. The graph is grid-sampled and only links
 * neighbours a step or two apart, so it arrives split into islands; these numbers bound how big a
 * gap the enemies module is willing to bridge, and how carefully.
 */
export const NAV = {
  /** Largest gap (XZ metres) between two islands we will try to join. */
  stitchMaxGap: 9,
  /** Largest height difference across a bridge, and the ground tolerance at its midpoint. */
  stitchMaxRise: 1.2,
  /** Bridges attempted per pair of islands (a couple of links so one blocked probe is not fatal). */
  stitchPerPair: 3,
  /** Repeat so chains of islands merge (each pass re-labels components). */
  stitchPasses: 3,
  /** Knee and chest heights for the line-of-walk probe, matching the level builder's own test. */
  stitchHeights: [0.55, 1.35],
};

export const PERCEPTION = {
  losInterval: 0.1,
  viewDistance: 70,
  fovCos: Math.cos((110 * Math.PI) / 180 / 2),
  /** once the player has been seen, the enemy keeps it "known" this long after losing LOS */
  memoryTime: 6,
  hearingRadius: 70,
  eyeHeight: 1.62,
  crouchEyeHeight: 1.05,
  /** How far a contact callout carries to squad-mates who have not seen the player themselves. */
  squadRadius: 55,
};

export const COMBAT = {
  fireInterval: 0.095,          // ~630 rpm
  burstPauseMin: 0.55, burstPauseMax: 1.4,
  magSize: 30,
  reloadTime: 2.6,
  damageMin: 7, damageMax: 12,
  maxRange: 60,
  /** distance the muzzle sits from the eye, used for LOS-from-muzzle checks */
  suppressInterval: 1.6,
  suppressSpread: 0.06,
  peekTimeMin: 1.4, peekTimeMax: 3.2,
  hideTimeMin: 0.7, hideTimeMax: 1.8,
  /** cycles at one cover before advancing to another */
  coverCyclesBeforeMove: 2,
  retreatHealthFrac: 0.3,
  engageDistanceMin: 7, engageDistanceMax: 18,
  coverSearchRadii: [3, 5.5, 8.5],
  coverSearchSamples: 14,
  coverClaimRadius: 2.2,
  coverPeekOffset: 0.75,
  flankAngle: 1.1,
  calloutCooldown: 8,
  /** on first contact stand and shoot this long before moving to cover (CoD: shoot first, then move) */
  contactHoldTime: 1.7,
  /** shoot on the move when the cover is closer than this; sprint (rifle down) when farther */
  fireOnMoveRange: 12,
  /** re-fire a contact burst after this long without shooting */
  contactRefire: 3.5,
  /**
   * Cover has to be somewhere we can reach and still be in the fight. Without this cap `findCover`
   * happily returned a hole 30 m away on the far side of the map, and walking to it read to the
   * player as the whole squad retreating and going silent.
   */
  coverMaxTravel: 14,
  /** Candidates that get the (expensive) LOS probes, taken best-first off the ray-free prescore. */
  coverProbeBudget: 30,
  /** Iterations of the probe loop before we give up regardless of how many rays were spent. */
  coverProbeScan: 120,
  /** Retry delay after a cover search that found nothing shootable-from. */
  coverSearchRetry: 1.1,
  /** How far past the wanted band a held cover may sit before we bound forward out of it. */
  coverBandSlack: 2,
  /** Metres of ground a forward bound has to gain to be worth taking instead of assaulting. */
  boundMinGain: 1.5,
  /** Seconds spent out of cover closing on the player when no forward bound is available. */
  assaultTime: 4,
  /**
   * Squad pressure. A soldier who is alerted but has no firing line on the player closes the
   * engagement band at this rate until he gets one; contact gives the band back more slowly. This
   * is what stops a squad parking behind hard cover at 18 m with nothing to shoot at.
   */
  pushRate: 1.1,
  pushDecay: 0.7,
  /** Metres of band collapse a hit buys back, so a player who fights back is not simply swarmed. */
  pushRelief: 5,
  /** Cap on the band collapse, and the closest the pushed band is ever allowed to ask for. */
  pushMax: 11,
  pushMinDistance: 5,
  /** An investigate goal we never manage to reach must not hold us forever. */
  investigateTimeout: 8,
  /** Un-alerted wave enemies advance to contact: how far ahead of us the patrol goal is placed. */
  advanceStride: 14,
  /** Lateral spread of the advance-to-contact goal so a squad fans out instead of forming a queue. */
  advanceSpread: 7,
  /** Graph nodes LOS-probed when picking an advance goal, best-first. */
  advanceProbes: 12,
};

/** CoD-like accuracy model constants (see Accuracy.ts) */
export const ACCURACY = {
  baseHitChance: 0.18,
  maxHitChance: 0.62,
  timeToMaxAccuracy: 2.2,
  /** hit chance falls off linearly to `farFrac` at maxRange */
  farDist: 45, farFrac: 0.35,
  movingMul: 0.6,
  targetSprintingMul: 0.7,
  targetCrouchMul: 0.85,
  aimedSpread: 0.012,
  missRadiusMin: 0.35, missRadiusMax: 1.1,
  /** deliberate misses land near the player to feel like suppression */
  missBiasHorizontal: 0.7,
};

export const ANIM = {
  walkStride: 0.68, runStride: 1.55, crouchStride: 0.5,
  walkLift: 0.05, runLift: 0.15,
  stanceFrac: 0.6,
  walkBounce: 0.018, runBounce: 0.045,
  hipSway: 0.035, hipYaw: 0.12, chestCounterYaw: 0.08,
  runLean: 0.26, walkLean: 0.05,
  crouchDrop: 0.46,
  blendRate: 9,
  aimYawLimit: 1.05, aimPitchLimit: 0.8,
  spineTwistShare: 0.55, headTwistShare: 0.35, bladeYaw: 0.42,
  flinchDecay: 7.5, flinchAmount: 0.35,
  breathRate: 1.3, breathAmount: 0.012,
  leanAngle: 0.38,
  idleSwayRate: 0.5,
  footClearance: 0.02,
  /** standing hip height: a little under the leg length so the knees keep some flex */
  hipHeight: 0.945,
  reloadTime: COMBAT.reloadTime,
  /** extra forward lean while sprinting (on top of runLean) */
  sprintLean: 0.14,
  /** shouldered stance: spine hunch forward and shoulders rolled toward the stock */
  aimHunch: 0.14, aimRoll: 0.1,
  /** max neck+head rotation used to bring the eye onto the sight line */
  cheekWeldMax: 0.5,
  /** idle feet are world-locked; a foot re-steps once its ideal stance position drifts this far */
  restepDistance: 0.14, restepTime: 0.3, restepLift: 0.06,
  /** low-ready carry: grip position relative to the chest, plus the angles that keep the stock clear of the ribs */
  carryPos: { x: 0.1, y: -0.09, z: -0.2 },
  carryPitch: -0.35, carryYaw: 0.5,
  /** standing idle contrapposto */
  idleWeightShift: 0.028, idleHipRoll: 0.055, idleHipYaw: 0.045,
  idleShoulderDrop: 0.07, idleTwist: 0.06, idleShiftRate: 0.21,
  idleFreeFootFwd: 0.05, idleFreeFootOut: 0.022,
  /** eyes are their own bones and track the aim direction inside a human range */
  gazeYawLimit: 0.62, gazePitchLimit: 0.34, gazeVergence: 0.028,
  /** micro-saccade amplitude / rate so a held gaze is not dead-still */
  saccade: 0.022, saccadeRate: 1.9,
};

/**
 * Anatomical joint limits, radians, measured in the PARENT bone's local frame.
 *
 * Every bone in the bind pose has identity world rotation, so a joint's relative rotation is
 * identity at bind and its bone axis is `a = -Y`. The relative rotation is decomposed into the
 * direction the child bone points, `d = q * a`, plus the twist about it:
 *   fz = asin(d.x)            — lateral swing out of the sagittal plane. Positive moves the tip
 *                               toward the character's right (+X), so abduction is positive on the
 *                               right and negative on the left: the boxes are mirrored.
 *   fx = atan2(-d.z, -d.y)    — flexion inside that plane. Positive swings the tip forward (-Z):
 *                               elbow/knee/hip/shoulder flexion. For the spine and neck the same
 *                               number reads as extension, since the tracked end points down.
 *   tw = twist about d        — axial rotation: pronation, femoral rotation, head turn.
 * This azimuth/elevation form stays well conditioned all the way to 150° of flexion, unlike a
 * swing-twist log map, and it makes hinges expressible: a knee with fz clamped to ±5° can no
 * longer fold sideways through its own thigh, which a symmetric swing cone happily allowed.
 * |fz| is kept below ~83° everywhere so the decomposition never reaches its gimbal at 90°.
 */
export type JointLimit = { fx: [number, number]; fz: [number, number]; tw: [number, number] };
export const JOINT_LIMITS: Record<string, JointLimit> = {
  spine: { fx: [-0.34, 0.5], fz: [-0.38, 0.38], tw: [-0.5, 0.5] },
  neck: { fx: [-0.6, 0.85], fz: [-0.55, 0.55], tw: [-1.0, 1.0] },
  // shoulder: free up to straight overhead, 92 deg back, abduction 76 deg, adduction 17 deg
  shoulderL: { fx: [-1.6, 3.05], fz: [-1.32, 0.3], tw: [-1.15, 1.15] },
  shoulderR: { fx: [-1.6, 3.05], fz: [-0.3, 1.32], tw: [-1.15, 1.15] },
  // Elbow: pure hinge 0..146 deg with 3 deg of hyperextension and almost no lateral play. `tw` here
  // is roll about the forearm's own axis — real pronation happens at the radioulnar joint, not the
  // hinge, and on a capsule collider it moves no pixel either way, so it is boxed loosely at 40 deg
  // and scored separately from the swing (see Ragdoll.test.ts).
  // (fz is the carrying-angle play a real elbow has, ~9 deg, not a free lateral hinge)
  elbow: { fx: [-0.05, 2.55], fz: [-0.16, 0.16], tw: [-0.7, 0.7] },
  // hip: flexion 112 deg / extension 30 deg, abduction 46 deg, adduction 17 deg
  hipL: { fx: [-0.52, 1.96], fz: [-0.8, 0.3], tw: [-0.5, 0.5] },
  hipR: { fx: [-0.52, 1.96], fz: [-0.3, 0.8], tw: [-0.5, 0.5] },
  // knee: hinge that only bends backwards, 0..145 deg (a deep kneel), 2 deg of hyperextension
  knee: { fx: [-2.53, 0.035], fz: [-0.1, 0.1], tw: [-0.2, 0.2] },
  // the ankle is deliberately loose: the animator's foot IK plants the boot flat under a deep
  // crouch, which needs more dorsiflexion than a real ankle has, and clamping it hard would fight
  // the pose the corpse is born in for no visual gain.
  ankle: { fx: [-0.9, 1.52], fz: [-0.36, 0.36], tw: [-0.45, 0.45] },
};

export const RAGDOLL = {
  lifetime: 18,
  fadeTime: 1.5,
  linearDamping: 0.35,
  angularDamping: 1.4,
  /** N*s applied at the killing hit (a rifle round is ~10; games exaggerate) */
  hitImpulse: 30,
  headImpulseMul: 1.5,
  /** Corpse head, in head-bone-local metres along the bone's +Y (the neck-to-crown axis).
   *  These describe the *rendered* head — helmeted, 24 cm from chin to crown — not HITBOX.head,
   *  which is the bare skull a bullet has to touch. Sizing the ragdoll off the hitbox is what put
   *  the head in the asphalt: a 0.12 ball rests 12 cm up, the neck rides 19 cm up on the torso
   *  capsule, and the only way to close that gap is to nod the head 46 deg face-down. */
  headRadius: 0.145,
  headCrown: 0.225,
  headChin: -0.025,
  /** radius of the crown/chin ground probes (the helmet shell is not a point) */
  headShellRadius: 0.055,
  /** Resting neck pose for a settled corpse, in the chest's frame: a little extension so the chin
   *  comes off the sternum, a lateral loll onto the side of the helmet, and the face turned. This
   *  is the pose that makes a corpse read as having a head at 4 m — the helmet shows its 24 x 20 cm
   *  profile instead of the 10 cm crown disc you get when the head points straight down the body. */
  neckRest: { fx: -0.18, fz: 0.46, tw: 0.62, rate: 0.02, rampTime: 1.2 },
  friction: 1.15,
  density: 950,
  /** after this many seconds the body is damped hard so it settles instead of twitching */
  settleTime: 1.5,
  settleLinearDamping: 4.5,
  settleAngularDamping: 8,
  /** Gauss-Seidel passes of the position-based joint/ground/self-collision solver per fixed step. */
  solverIterations: 14,
  /** extra full sweeps, taken only on frames where a joint is still out of its box. The threshold
   *  is well under a visible angle: a corpse resting an arm against the road loads the shoulder
   *  against its stop and the ground at once, and one sweep budget leaves a few degrees on the
   *  table. These passes are free on the common frame, where nothing is violating at all. */
  refinePasses: 7,
  refineThreshold: 0.012,
  /** fraction of the relative angular velocity removed when a joint hits its limit (inelastic stop) */
  limitVelDamp: 1.0,
  /** how much of the ball-joint correction is allowed to rotate a body (vs translate it). Full
   *  rotational coupling gives a nice pendulum but fights the angle clamp on a hard landing. */
  anchorRotShare: 0.45,
  /** max metres a self-collision pair is pushed apart per solver iteration */
  maxSelfPush: 0.02,
  /** limb pairs that already overlap at spawn are separated over this many seconds instead of popping */
  selfSlackTime: 0.7,
  /** joint anchor error above this (metres) counts as a broken chain in tests */
  maxAnchorError: 0.02,
  /** hard ceilings so a point-blank headshot impulse cannot spin a 5 kg head at 130 rad/s */
  maxAngVel: 22,
  maxLinVel: 14,
  /** blood pool: decal sizes over time after the body is down */
  /** blood pool: decal sizes over time after the body is down. The pool has to grow wider than the
   *  body or it never leaves the corpse's own footprint and reads as nothing at all. */
  bloodPool: [[0.5, 0.5], [1.3, 0.85], [2.4, 1.15], [3.6, 1.35]] as [number, number][],
};

export const HITBOX = {
  head: 0.12,
  torso: { r: 0.19, half: 0.28 },
  pelvis: { r: 0.17, half: 0.08 },
  upperArm: { r: 0.065, len: 0.3 },
  forearm: { r: 0.055, len: 0.27 },
  thigh: { r: 0.09, len: 0.46 },
  shin: { r: 0.065, len: 0.44 },
  headshotMul: 2.6,
  limbMul: 0.7,
};

export const SKELETON = {
  hipsY: 0.985, spine1Y: 1.09, spine2Y: 1.22, chestY: 1.36, neckY: 1.53, headY: 1.6,
  shoulderX: 0.185, shoulderY: 1.485, upperArmLen: 0.3, forearmLen: 0.27, handLen: 0.09,
  hipX: 0.095, thighLen: 0.465, shinLen: 0.44, ankleY: 0.08, footLen: 0.26,
};
