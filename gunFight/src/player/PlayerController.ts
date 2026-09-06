import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import type { InputState } from '../core/Input';
import { CG, groups } from '../core/Physics';
import type { SurfaceType } from '../core/Events';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CameraFx, type ViewmodelOffset } from './CameraFx';
import { defaultPlayerSettings, zoomSensitivity, type PlayerSettings } from './PlayerSettings';
import { expDamp, clamp, lerp } from './Spring';
import { applyFriction, accelerate, capSpeed, clipVelocity, stepSmoothingDelta, slideSpeedStep, mantlePoint, mantleDuration, landingSpeedMul, type MantlePath } from './MoveMath';

/** Movement tuning. Single source of truth for feel (meters, seconds, radians). */
export const PLAYER = {
  radius: 0.35, height: 1.8, crouchHeight: 1.2,
  /** `position` is a fixed reference point this far above the feet regardless of stance */
  centerHeight: 0.9,
  eyeHeight: 1.62, crouchEyeHeight: 1.06, deadEyeHeight: 0.28,
  walkSpeed: 4.6, sprintSpeed: 6.6, tacSprintSpeed: 8.0, crouchSpeed: 2.6, adsSpeedMul: 0.62, backpedalMul: 0.82, strafeMul: 0.92,
  accelGround: 11, friction: 9, stopSpeed: 1.6,
  accelAir: 1.6, airSpeedCap: 4.8, airDrag: 0.12,
  jumpSpeed: 5.7, gravity: 20, terminalSpeed: 42,
  stepHeight: 0.42, stepMinWidth: 0.16, snapDistance: 0.35, maxSlopeDeg: 48, slideSlopeDeg: 36,
  slideBoost: 1.18, slideMinStart: 8.4, slideFriction: 5.6, slideDuration: 1.0, slideMinSpeed: 2.0, slideSteer: 1.4, slideCooldown: 0.4,
  tacSprintDuration: 4.0, tacSprintCooldown: 1.5, doubleTapWindow: 0.32,
  mantleMinHeight: 0.35, mantleMaxHeight: 1.55, mantleReach: 0.7,
  coyoteTime: 0.1, jumpBuffer: 0.15,
  regenDelay: 5, regenRate: 40,
  adsFov: 58,
};

const WORLD_FILTER = groups(CG.PLAYER, CG.WORLD | CG.ENEMY);
const MANTLE_FILTER = groups(CG.PLAYER, CG.WORLD);
const DEG = Math.PI / 180;

type LevelLike = System & { surfaceAt?(p: THREE.Vector3): SurfaceType };

/**
 * Kinematic character controller on Rapier with a friction/acceleration model, CoD-style stances
 * (walk / sprint / tactical sprint / crouch / slide / mantle) and a procedural camera (CameraFx).
 *
 * Physics and state machine run in `fixedUpdate`; the camera is composed per frame in `update`
 * from the interpolated position.  `position` is the point 0.9 m above the feet (the standing
 * capsule centre); `eye` is the final camera position.
 */
export class PlayerController implements System {
  name = 'player';
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  controller!: RAPIER.KinematicCharacterController;

  // ---- PlayerApi
  position = new THREE.Vector3(0, 1, 20);
  prevPosition = new THREE.Vector3();
  velocity = new THREE.Vector3();
  eye = new THREE.Vector3();
  yaw = 0; pitch = 0;
  grounded = false; crouching = false; sprinting = false; sliding = false; aiming = false;
  health = 100; maxHealth = 100; alive = true;
  speedFactor = 1;

  // ---- feel / pose blends read by weapons + ui
  readonly settings: PlayerSettings = defaultPlayerSettings();
  readonly fx: CameraFx;
  tacSprinting = false; mantling = false;
  moveBlend = 0; sprintBlend = 0; tacSprintBlend = 0; slideBlend = 0; crouchBlend = 0; airBlend = 0; aimBlend = 0; mantleBlend = 0; deadBlend = 0;
  airborne = false;
  /** horizontal ground speed, m/s */
  speed = 0;
  fovTarget = PLAYER.adsFov;

  /** Debug input override (shot poses / scripted playtests). One-shot flags are cleared after a frame. */
  debugInput: Partial<InputState> | null = null;
  private debugSeq: Array<{ at: number; set: Partial<InputState> | null }> = [];
  private debugFrame = 0;

  // ---- internals
  private vy = 0;
  private wasGrounded = false;
  private sinceGrounded = 0; private sinceJump = 1;
  private jumpBuffer = 0; private jumpedThisStep = false;
  private crouchPress = false; private crouchToggled = false;
  private sprintHeldPrev = false; private lastSprintTap = -1; private tacRequested = false; private sprintHeldTime = 0;
  private tacTimer = 0; private tacCooldown = 0;
  private slideTimer = 0; private slideSpeed = 0; private slideCooldownT = 0;
  private readonly slideDir = new THREE.Vector3();
  slideSide = 1;
  private mantle: MantlePath | null = null; private mantleT = 0; private mantlePreSpeed = 0; private mantleCrouch = false;
  private stanceHeight = PLAYER.height;
  private stepOffset = 0;
  private groundNormal = new THREE.Vector3(0, 1, 0); private groundFlat = true;
  private eyeH = PLAYER.eyeHeight;
  private sinceDamage = 100; private regenAccum = 0;
  private wasDead = false; deadSide = 1;
  private lastInputSens = 0;
  private aimFovExt = PLAYER.adsFov; private aimBlendExt = 0; private aimExtFrame = -10;
  private hasFx = false;
  private readonly mergedInput: InputState = {} as InputState;
  private readonly collisionScratch: RAPIER.CharacterCollision;
  private readonly tmpV = new THREE.Vector3(); private readonly tmpV2 = new THREE.Vector3(); private readonly tmpV3 = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(); private readonly right = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private readonly hv = { x: 0, y: 0, z: 0 };
  private readonly desiredMove = { x: 0, y: 0, z: 0 };
  private blockedFrames = 0;
  /** stair smoothing lives in the fixed step; the camera interpolates prev -> current with alpha */
  private prevStepOffset = 0; private manualRise = 0;

  constructor(private engine: Engine) {
    this.fx = new CameraFx(this.settings);
    this.collisionScratch = new engine.physics.R.CharacterCollision();
    engine.events.on('explosion', ({ position, radius }) => {
      const d = this.position.distanceTo(new THREE.Vector3(position[0], position[1], position[2]));
      const t = clamp(1 - d / (radius * 3 + 2), 0, 1);
      if (t > 0) { this.fx.addShake(t * 0.7); this.fx.addViewPunch(-t * 0.03, 0, t * 0.02 * (this.engine.frame & 1 ? 1 : -1)); }
    });
  }

  get viewmodelOffset(): ViewmodelOffset { return this.fx.viewmodelOffset; }
  get sprintingHard(): boolean { return this.tacSprinting; }

  init(spawn: THREE.Vector3): void {
    const p = this.engine.physics;
    this.position.copy(spawn); this.prevPosition.copy(spawn);
    this.body = p.world.createRigidBody(p.R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z));
    this.collider = p.world.createCollider(
      p.R.ColliderDesc.capsule((PLAYER.height - 2 * PLAYER.radius) / 2, PLAYER.radius).setCollisionGroups(groups(CG.PLAYER, CG.WORLD | CG.ENEMY)).setFriction(0),
      this.body,
    );
    p.tag(this.collider, { tag: 'player' });
    this.controller = p.world.createCharacterController(0.03);
    this.controller.enableAutostep(PLAYER.stepHeight, PLAYER.stepMinWidth, false);
    this.controller.enableSnapToGround(PLAYER.snapDistance);
    this.controller.setMaxSlopeClimbAngle(PLAYER.maxSlopeDeg * DEG);
    this.controller.setMinSlopeSlideAngle(PLAYER.slideSlopeDeg * DEG);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(85);
    this.controller.setNormalNudgeFactor(1e-3);
    this.lastInputSens = this.engine.input.sensitivity = this.settings.sensitivity;
    this.syncCollider();
  }

  // ------------------------------------------------------------------ public API

  teleport(pos: THREE.Vector3, yaw?: number, pitch?: number): void {
    this.position.copy(pos); this.prevPosition.copy(pos);
    this.velocity.set(0, 0, 0); this.vy = 0;
    if (yaw !== undefined) this.yaw = yaw; if (pitch !== undefined) this.pitch = pitch;
    this.sliding = false; this.mantling = false; this.mantle = null; this.sprinting = false; this.tacSprinting = false;
    this.crouching = false; this.crouchToggled = false; this.stepOffset = 0; this.prevStepOffset = 0; this.manualRise = 0;
    this.debugInput = null; this.debugSeq = []; this.debugFrame = 0;
    this.setStance(PLAYER.height);
    this.syncCollider();
    this.body.setNextKinematicTranslation(this.capsuleCenter(this.tmpV));
    this.fx.reset();
    this.eyeH = PLAYER.eyeHeight; this.crouchBlend = 0; this.moveBlend = 0; this.sprintBlend = 0; this.tacSprintBlend = 0; this.slideBlend = 0; this.airBlend = 0; this.mantleBlend = 0;
    this.grounded = false; this.wasGrounded = false;
  }

  respawn(pos?: THREE.Vector3, yaw?: number, pitch?: number): void {
    this.health = this.maxHealth; this.alive = true; this.wasDead = false; this.deadBlend = 0; this.sinceDamage = 100; this.regenAccum = 0;
    this.teleport(pos ?? this.position, yaw, pitch);
  }

  damage(amount: number, from: THREE.Vector3): void {
    if (!this.alive || amount <= 0) return;
    this.health = Math.max(0, Math.round(this.health - amount));
    this.sinceDamage = 0; this.regenAccum = 0;
    // Flinch away from the source: pitch back, roll toward the hit side.
    const dir = this.tmpV.copy(from).sub(this.position); dir.y = 0;
    let lateral = 0, front = 1;
    if (dir.lengthSq() > 1e-6) { dir.normalize(); this.forward(); lateral = dir.dot(this.right); front = dir.dot(this.fwd); }
    const k = clamp(amount / 35, 0.15, 1);
    this.fx.addViewPunch(0.035 * k * (front >= 0 ? 1 : -0.6), -lateral * 0.02 * k, lateral * 0.05 * k);
    this.fx.addShake(0.25 * k);
    this.engine.events.emit('player:damage', { amount, from: [from.x, from.y, from.z] });
    if (this.health <= 0) this.die();
  }

  /** Recoil in radians; `recoilPersist` of it moves the aim, the rest is a spring kick that returns. */
  addRecoil(pitch: number, yaw: number): void {
    const p = clamp(this.settings.recoilPersist, 0, 1);
    this.pitch = clamp(this.pitch + pitch * p, -1.55, 1.55);
    this.yaw += yaw * p;
    this.fx.addRecoil(pitch * (1 - p), yaw * (1 - p));
  }
  addViewPunch(pitch: number, yaw: number, roll: number): void { this.fx.addViewPunch(pitch, yaw, roll); }
  addShake(amount: number): void { this.fx.addShake(amount); }

  /** Weapons call this every frame with their ADS FOV (horizontal deg) and aim blend 0..1. */
  setAimFov(fov: number, blend: number): void {
    this.aimFovExt = fov; this.aimBlendExt = clamp(blend, 0, 1); this.aimExtFrame = this.engine.frame;
  }

  /** Drive input for shot poses / tests. `at` is in frames after the call. `set: null` clears. */
  debugSequence(steps: Array<{ at: number; set: Partial<InputState> | null }>): void {
    this.debugSeq = steps.slice().sort((a, b) => a.at - b.at); this.debugFrame = 0;
  }

  // ------------------------------------------------------------------ fixed step

  fixedUpdate(dt: number): void {
    const inp = this.readInput();
    this.prevPosition.copy(this.position);
    this.prevStepOffset = this.stepOffset; this.manualRise = 0;
    if (this.alive && this.wasDead) { this.wasDead = false; this.deadBlend = 0; }
    if (!this.alive) { this.deadStep(dt); return; }

    this.forward();
    this.tickTimers(dt);
    const feetY = this.position.y - PLAYER.centerHeight;
    const hv = this.hv; hv.x = this.velocity.x; hv.z = this.velocity.z; hv.y = 0;
    const speed = Math.hypot(hv.x, hv.z);
    const moving = Math.abs(inp.moveX) > 0.1 || Math.abs(inp.moveY) > 0.1;

    // ---- aim
    this.aiming = inp.aim && !this.sprinting && !this.sliding && !this.mantling;

    // ---- sprint / tactical sprint
    const wantSprint = inp.sprint && inp.moveY > 0.3 && !inp.aim && !inp.fire && !this.mantling && this.speedFactor > 0.35;
    if (wantSprint && this.crouching && !this.sliding && this.canStand()) this.crouching = false;
    const canSprint = !this.crouching && !this.sliding;
    const sprintingNow = wantSprint && canSprint && (this.grounded || this.sprinting);
    if (sprintingNow && !this.sprinting) this.sprintHeldTime = 0;
    this.sprinting = sprintingNow;
    if (this.sprinting) {
      this.sprintHeldTime += dt;
      const holdTac = this.settings.tacSprintHoldDelay > 0 && this.sprintHeldTime > this.settings.tacSprintHoldDelay;
      if (!this.tacSprinting && (this.tacRequested || holdTac) && this.tacCooldown <= 0) { this.tacSprinting = true; this.tacTimer = 0; }
      if (this.tacSprinting) { this.tacTimer += dt; if (this.tacTimer > PLAYER.tacSprintDuration) { this.tacSprinting = false; this.tacCooldown = PLAYER.tacSprintCooldown; } }
    } else this.tacSprinting = false;
    this.tacRequested = false;

    // ---- slide start (sprint + crouch press on the ground with momentum)
    if (this.crouchPress && this.sprinting && this.grounded && speed > PLAYER.walkSpeed * 0.85 && !this.sliding && this.slideCooldownT <= 0) {
      this.sliding = true; this.slideTimer = 0; this.sprinting = false; this.tacSprinting = false;
      this.slideDir.set(hv.x, 0, hv.z).normalize();
      this.slideSpeed = Math.max(speed * PLAYER.slideBoost, PLAYER.slideMinStart);
      const lat = this.slideDir.dot(this.right);
      this.slideSide = Math.abs(lat) > 0.25 ? Math.sign(lat) : 1;
      this.crouching = true;
      this.fx.onSlideStart();
      this.engine.events.emit('player:slide', { start: true });
    }
    this.crouchPress = false;

    // ---- stance (hold or toggle), stand only with headroom; slide forces crouch
    const wantCrouch = this.settings.crouchToggle ? this.crouchToggled : inp.crouch;
    if (this.sliding) this.crouching = true;
    else if (wantCrouch) { this.crouching = true; this.sprinting = false; this.tacSprinting = false; }
    else if (this.crouching && this.canStand()) this.crouching = false;
    if (this.crouching && this.mantleCrouch && !wantCrouch && this.canStand()) { this.crouching = false; this.mantleCrouch = false; }
    this.setStance(this.crouching ? PLAYER.crouchHeight : PLAYER.height);

    // ---- wish direction (view relative), backpedal / strafe are slower like CoD
    const wish = this.tmpV.set(0, 0, 0).addScaledVector(this.fwd, inp.moveY).addScaledVector(this.right, inp.moveX);
    if (wish.lengthSq() > 1) wish.normalize();
    let maxSpeed = this.crouching ? PLAYER.crouchSpeed : this.tacSprinting ? PLAYER.tacSprintSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (this.aiming) maxSpeed *= PLAYER.adsSpeedMul;
    if (!this.sprinting) {
      if (inp.moveY < -0.1) maxSpeed *= PLAYER.backpedalMul;
      else if (Math.abs(inp.moveX) > 0.1 && Math.abs(inp.moveY) < 0.1) maxSpeed *= PLAYER.strafeMul;
    }
    maxSpeed *= clamp(this.speedFactor, 0, 1.5);

    // ---- mantle: detect, or advance an active one
    if (!this.mantling && !this.sliding && inp.moveY > 0.3) {
      const wantsUp = this.jumpBuffer > 0 || !this.grounded || (this.settings.autoMantle && this.sprinting);
      if (wantsUp && this.tryStartMantle(feetY, speed)) this.jumpBuffer = 0;
    }
    if (this.mantling && this.mantle) {
      this.mantleT += dt;
      const target = mantlePoint(this.mantle, this.mantleT, this.tmpV2);
      const move = this.tmpV3.set(target.x - this.position.x, target.y - this.position.y, target.z - this.position.z);
      this.moveCapsule(move.x, move.y, move.z);
      this.velocity.set(0, 0, 0); this.vy = 0;
      if (this.mantleT >= this.mantle.duration) {
        this.mantling = false; this.mantle = null;
        this.controller.enableSnapToGround(PLAYER.snapDistance);
        const v = this.mantlePreSpeed;
        this.velocity.set(this.fwd.x * v, 0, this.fwd.z * v);
        this.grounded = this.controller.computedGrounded();
        this.fx.onMantleEnd();
      }
      this.finishStep(dt, feetY);
      return;
    }

    // ---- ground / air velocity model
    if (this.sliding) {
      this.slideTimer += dt;
      // steer a little toward the stick, keep the momentum vector
      if (moving && wish.lengthSq() > 0.01) {
        const steer = PLAYER.slideSteer * dt;
        this.slideDir.addScaledVector(wish, steer).normalize();
      }
      const n = this.groundNormal;
      const downhill = this.tmpV2.set(n.x, 0, n.z); // magnitude = sin(slope), points downhill
      const slopeAccel = PLAYER.gravity * downhill.dot(this.slideDir) * 1.6;
      this.slideSpeed = slideSpeedStep(this.slideSpeed, PLAYER.slideFriction, slopeAccel, dt, 0);
      hv.x = this.slideDir.x * this.slideSpeed; hv.z = this.slideDir.z * this.slideSpeed;
      const jumpOut = this.jumpBuffer > 0 && this.grounded;
      if (this.slideTimer > PLAYER.slideDuration || this.slideSpeed < PLAYER.slideMinSpeed || !this.grounded || jumpOut || !inp.sprint && this.slideTimer > 0.35 && inp.moveY < -0.5) {
        this.sliding = false; this.slideCooldownT = PLAYER.slideCooldown;
        this.engine.events.emit('player:slide', { start: false });
        if (jumpOut) { this.crouching = this.canStand() ? false : true; }
      }
    } else if (this.grounded) {
      applyFriction(hv, PLAYER.friction, PLAYER.stopSpeed, dt);
      accelerate(hv, wish, maxSpeed, PLAYER.accelGround, dt);
      // steep ground: gravity pulls you down the slope (Rapier also refuses to climb it)
      const n = this.groundNormal;
      if (n.y < Math.cos(PLAYER.slideSlopeDeg * DEG)) { hv.x += n.x * PLAYER.gravity * dt; hv.z += n.z * PLAYER.gravity * dt; }
    } else {
      // limited air control, keep most of the take-off momentum
      accelerate(hv, wish, Math.min(maxSpeed, PLAYER.airSpeedCap), PLAYER.accelAir, dt);
      const drag = 1 - PLAYER.airDrag * dt; hv.x *= drag; hv.z *= drag;
    }

    // ---- jump (buffered + coyote), also slide-jump
    this.jumpedThisStep = false;
    const canJump = (this.grounded || (this.sinceGrounded < PLAYER.coyoteTime && this.vy <= 0)) && this.sinceJump > 0.2;
    if (this.jumpBuffer > 0 && canJump && !this.mantling) {
      this.vy = PLAYER.jumpSpeed; this.grounded = false; this.jumpBuffer = 0; this.jumpedThisStep = true; this.sinceJump = 0;
      if (this.sliding) { this.sliding = false; this.slideCooldownT = PLAYER.slideCooldown; this.engine.events.emit('player:slide', { start: false }); }
      capSpeed(hv, Math.max(PLAYER.sprintSpeed, Math.hypot(hv.x, hv.z)));
      this.fx.onJump();
    }
    if (!this.grounded) this.vy = Math.max(-PLAYER.terminalSpeed, this.vy - PLAYER.gravity * dt);
    else this.vy = 0;

    this.velocity.x = hv.x; this.velocity.z = hv.z;

    // ---- move through the character controller
    // Small downward bias keeps ground contact on slopes / down-steps without defeating autostep on tall risers.
    const stick = this.grounded && !this.jumpedThisStep ? -0.012 : 0;
    this.moveCapsule(hv.x * dt, this.vy * dt + stick, hv.z * dt);
    if (this.grounded && !this.jumpedThisStep) this.manualStepUp(hv.x * dt, hv.z * dt);
    this.finishStep(dt, feetY);
  }

  /**
   * Immediate stair step: Rapier's autostep only fires after several frames of pushing into a riser,
   * which reads as a stutter. When a low contact blocked most of the horizontal move, probe the step
   * top ahead; if it is within stepHeight with headroom, lift through the controller and finish the move.
   */
  private manualStepUp(dx: number, dz: number): void {
    const desiredH = Math.hypot(dx, dz);
    if (desiredH < 1e-4) return;
    const achX = this.position.x - this.prevPosition.x, achZ = this.position.z - this.prevPosition.z;
    if (Math.hypot(achX, achZ) > desiredH * 0.6) return;
    const feetY = this.position.y - PLAYER.centerHeight;
    let lowContact = false;
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = this.controller.computedCollision(i, this.collisionScratch);
      if (!c || c.normal1.y > 0.7 || c.normal1.y < -0.5) continue;
      if (c.witness1.y - feetY < PLAYER.stepHeight + 0.06) { lowContact = true; break; }
    }
    if (!lowContact) return;
    const ph = this.engine.physics;
    const inv = 1 / desiredH; const dirX = dx * inv, dirZ = dz * inv;
    const ahead = PLAYER.radius + 0.12;
    const px = this.position.x + dirX * ahead, pz = this.position.z + dirZ * ahead;
    const top = ph.raycast({ x: px, y: feetY + PLAYER.stepHeight + 0.1, z: pz }, { x: 0, y: -1, z: 0 }, PLAYER.stepHeight + 0.08, MANTLE_FILTER, true, this.collider);
    if (!top || top.normal[1] < 0.85) return;
    const rise = top.point[1] - feetY;
    if (rise < 0.03 || rise > PLAYER.stepHeight) return;
    const head = ph.raycast({ x: px, y: top.point[1] + 0.05, z: pz }, { x: 0, y: 1, z: 0 }, this.stanceHeight, MANTLE_FILTER, true, this.collider);
    if (head) return;
    const sx = this.position.x, sy = this.position.y, sz = this.position.z;
    this.moveCapsule(0, rise + 0.01, 0);
    const remX = dx - achX, remZ = dz - achZ;
    // keep a downward bias so the controller re-detects the ground on top of the step
    this.moveCapsule(remX, -0.06, remZ);
    const gotX = this.position.x - sx, gotZ = this.position.z - sz;
    if (Math.hypot(gotX, gotZ) < Math.hypot(remX, remZ) * 0.5) {
      // not a step we can take: undo and restore ground contact state
      this.position.set(sx, sy, sz);
      this.moveCapsule(0, -0.012, 0);
      return;
    }
    // credit the exact rise to the camera glide so the eye does not pop with the feet
    const actualRise = this.position.y - sy;
    this.manualRise = actualRise;
    this.stepOffset = clamp(this.stepOffset - actualRise, -0.6, 0.6);
  }

  /** Common tail of a fixed step: ground state, landing, wall clipping, stair smoothing, regen. */
  private finishStep(dt: number, feetYBefore: number): void {
    const wasGrounded = this.wasGrounded;
    const flatBefore = this.groundFlat;
    let grounded = this.controller.computedGrounded();
    if (this.jumpedThisStep) grounded = false;

    // Rapier's autostep needs a sustained push into a riser for several frames, so contacts low on
    // the capsule are not clipped while grounded unless we stay blocked (a real low wall).
    const desired = this.desiredMove;
    const desiredH = Math.hypot(desired.x, desired.z);
    const achievedH = Math.hypot(this.position.x - this.prevPosition.x, this.position.z - this.prevPosition.z);
    const rose = this.position.y - this.prevPosition.y > 0.02;
    if (wasGrounded && desiredH > 1e-4 && achievedH < desiredH * 0.3 && !rose) this.blockedFrames++; else this.blockedFrames = 0;
    const stepZone = PLAYER.stepHeight + 0.06;
    const BLOCKED_LIMIT = 30; // ~0.5 s of pushing before a low obstacle counts as a wall

    // collisions: clip velocity so we never bounce or grind into walls / ceilings
    const n = this.controller.numComputedCollisions();
    const v = this.velocity;
    for (let i = 0; i < n; i++) {
      const c = this.controller.computedCollision(i, this.collisionScratch);
      if (!c) continue;
      const nn = c.normal1;
      if (nn.y > 0.7) { grounded = grounded || this.vy <= 0; continue; }
      if (nn.y < -0.5) { if (this.vy > 0) this.vy = 0; continue; }
      const len = Math.hypot(nn.x, nn.z);
      if (len < 1e-4) continue;
      // Height of the contact above the feet. witness1 is the world-space point on the obstacle
      // (witness2 is documented as character-local but is reported in world space by rapier 0.20).
      const contactH = c.witness1.y - (this.position.y - PLAYER.centerHeight);
      if (wasGrounded && !this.sliding && contactH < stepZone && this.blockedFrames < BLOCKED_LIMIT) continue;
      const wall = { x: nn.x / len, y: 0, z: nn.z / len };
      const vv = { x: v.x, y: 0, z: v.z };
      clipVelocity(vv, wall);
      v.x = vv.x; v.z = vv.z;
      if (this.sliding) { const vs = { x: this.slideDir.x, y: 0, z: this.slideDir.z }; clipVelocity(vs, wall); if (Math.hypot(vs.x, vs.z) > 0.2) this.slideDir.set(vs.x, 0, vs.z).normalize(); else { this.slideSpeed = 0; } }
      if (this.mantling && this.mantle) { /* keep going; the KCC already clipped the path */ }
    }

    // ground normal under the feet (slope + step classification)
    this.probeGround();

    if (grounded && !wasGrounded) {
      const fallSpeed = Math.max(0, -this.vy);
      this.vy = 0;
      if (fallSpeed > 1.5) {
        this.engine.events.emit('player:land', { speed: fallSpeed });
        this.fx.onLand(fallSpeed);
        const m = landingSpeedMul(fallSpeed);
        this.velocity.x *= m; this.velocity.z *= m;
        if (fallSpeed > 9) this.fx.addShake(clamp((fallSpeed - 9) / 12, 0, 0.5));
      }
    }
    this.grounded = grounded;
    this.wasGrounded = grounded;
    this.airborne = !grounded;
    if (grounded) this.sinceGrounded = 0; else this.sinceGrounded += dt;
    this.velocity.y = grounded ? 0 : this.vy;

    // stair smoothing: feet popped up/down a step -> camera glides (manual step-ups already credited their rise)
    const dy = (this.position.y - PLAYER.centerHeight) - feetYBefore - this.manualRise;
    if (!this.mantling) this.stepOffset = clamp(this.stepOffset + stepSmoothingDelta(dy, wasGrounded, grounded, flatBefore, this.groundFlat), -0.6, 0.6);
    this.stepOffset = expDamp(this.stepOffset, 0, 12, dt);

    this.body.setNextKinematicTranslation(this.capsuleCenter(this.tmpV));
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // regen (CoD: nothing for a while, then quick)
    if (this.health < this.maxHealth && this.sinceDamage > PLAYER.regenDelay) {
      this.regenAccum += PLAYER.regenRate * dt;
      const add = Math.floor(this.regenAccum);
      if (add > 0) { this.health = Math.min(this.maxHealth, this.health + add); this.regenAccum -= add; }
    }
    if (!Number.isFinite(this.position.x + this.position.y + this.position.z)) { this.position.copy(this.prevPosition); this.velocity.set(0, 0, 0); this.vy = 0; }
  }

  private deadStep(dt: number): void {
    // Body settles: friction, gravity, slide to the floor.
    const hv = this.hv; hv.x = this.velocity.x; hv.z = this.velocity.z;
    applyFriction(hv, PLAYER.friction * 1.5, PLAYER.stopSpeed, dt);
    if (!this.grounded) this.vy = Math.max(-PLAYER.terminalSpeed, this.vy - PLAYER.gravity * dt); else this.vy = 0;
    this.velocity.x = hv.x; this.velocity.z = hv.z;
    this.setStance(PLAYER.crouchHeight);
    this.moveCapsule(hv.x * dt, this.vy * dt - (this.grounded ? 0.06 : 0), hv.z * dt);
    this.grounded = this.controller.computedGrounded(); this.wasGrounded = this.grounded; this.airborne = !this.grounded;
    this.velocity.y = this.grounded ? 0 : this.vy;
    this.body.setNextKinematicTranslation(this.capsuleCenter(this.tmpV));
    this.speed = Math.hypot(hv.x, hv.z);
    this.stepOffset = expDamp(this.stepOffset, 0, 12, dt);
    this.sprinting = this.tacSprinting = this.sliding = this.mantling = this.aiming = false;
  }

  private tickTimers(dt: number): void {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.sinceJump += dt; this.sinceDamage += dt;
    this.tacCooldown = Math.max(0, this.tacCooldown - dt);
    this.slideCooldownT = Math.max(0, this.slideCooldownT - dt);
  }

  // ------------------------------------------------------------------ physics helpers

  private capsuleCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y - PLAYER.centerHeight + this.stanceHeight / 2, this.position.z);
  }

  private setStance(h: number): void {
    if (h === this.stanceHeight) return;
    this.stanceHeight = h;
    this.collider.setHalfHeight((h - 2 * PLAYER.radius) / 2);
  }

  /** Keep the physics collider exactly where our authoritative position says it is. */
  private syncCollider(): void { this.collider.setTranslation(this.capsuleCenter(this.tmpV)); }

  private moveCapsule(dx: number, dy: number, dz: number): void {
    this.desiredMove.x = dx; this.desiredMove.y = dy; this.desiredMove.z = dz;
    this.syncCollider();
    this.controller.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, undefined, WORLD_FILTER);
    const out = this.controller.computedMovement();
    if (Number.isFinite(out.x + out.y + out.z)) { this.position.x += out.x; this.position.y += out.y; this.position.z += out.z; }
  }

  private probeGround(): void {
    const c = this.capsuleCenter(this.tmpV);
    const hit = this.engine.physics.raycast({ x: c.x, y: c.y, z: c.z }, { x: 0, y: -1, z: 0 }, this.stanceHeight / 2 + 0.5, MANTLE_FILTER, true, this.collider);
    if (hit) { this.groundNormal.set(hit.normal[0], hit.normal[1], hit.normal[2]); if (this.groundNormal.y < 0) this.groundNormal.negate(); }
    else this.groundNormal.set(0, 1, 0);
    this.groundFlat = this.groundNormal.y > 0.96;
  }

  /** Is there headroom to stand up? Five short rays from crouch-top to stand-top. */
  private canStand(): boolean {
    const feetY = this.position.y - PLAYER.centerHeight;
    const from = feetY + PLAYER.crouchHeight - PLAYER.radius;
    const len = PLAYER.height - PLAYER.crouchHeight + 0.05;
    const r = PLAYER.radius * 0.8;
    const ph = this.engine.physics;
    const pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (const [ox, oz] of pts) {
      if (ph.raycast({ x: this.position.x + ox, y: from, z: this.position.z + oz }, { x: 0, y: 1, z: 0 }, len, MANTLE_FILTER, true, this.collider)) return false;
    }
    return true;
  }

  /** Look for a ledge in front of us and start a mantle if it is climbable. */
  private tryStartMantle(feetY: number, speed: number): boolean {
    const ph = this.engine.physics;
    const f = this.fwd;
    const reach = PLAYER.radius + PLAYER.mantleReach;
    let wallDist = Infinity; let wallHit = false;
    for (const h of [0.45, 0.9, 1.35]) {
      const hit = ph.raycast({ x: this.position.x, y: feetY + h, z: this.position.z }, { x: f.x, y: 0, z: f.z }, reach, MANTLE_FILTER, true, this.collider);
      if (hit && Math.abs(hit.normal[1]) < 0.5 && (hit.normal[0] * f.x + hit.normal[2] * f.z) < -0.3) { wallHit = true; wallDist = Math.min(wallDist, hit.distance); }
    }
    if (!wallHit) return false;
    // find the top of the obstacle just past its face
    const px = this.position.x + f.x * (wallDist + 0.3), pz = this.position.z + f.z * (wallDist + 0.3);
    const topY = feetY + PLAYER.mantleMaxHeight + 0.5;
    const down = ph.raycast({ x: px, y: topY, z: pz }, { x: 0, y: -1, z: 0 }, PLAYER.mantleMaxHeight + 0.5 - PLAYER.mantleMinHeight, MANTLE_FILTER, true, this.collider);
    if (!down || down.normal[1] < 0.7) return false;
    const ledgeY = down.point[1];
    const ledgeH = ledgeY - feetY;
    if (ledgeH < PLAYER.mantleMinHeight || ledgeH > PLAYER.mantleMaxHeight) return false;
    // headroom above the ledge for at least a crouched capsule
    const up = ph.raycast({ x: px, y: ledgeY + 0.05, z: pz }, { x: 0, y: 1, z: 0 }, PLAYER.height + 0.05, MANTLE_FILTER, true, this.collider);
    if (up && up.distance < PLAYER.crouchHeight + 0.05) return false;
    this.mantleCrouch = !!up;
    if (this.mantleCrouch) this.crouching = true;
    const endDist = wallDist + PLAYER.radius + 0.3;
    this.mantle = {
      startY: this.position.y, topY: ledgeY + 0.06 + PLAYER.centerHeight,
      startX: this.position.x, startZ: this.position.z,
      endX: this.position.x + f.x * endDist, endZ: this.position.z + f.z * endDist,
      duration: mantleDuration(ledgeH),
    };
    this.mantleT = 0; this.mantling = true;
    this.mantlePreSpeed = clamp(speed, PLAYER.walkSpeed * 0.7, this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed);
    this.sliding = false; this.sprinting = false; this.tacSprinting = false; this.vy = 0; this.velocity.set(0, 0, 0);
    this.controller.disableSnapToGround();
    this.fx.onMantleStart();
    return true;
  }

  private forward(): void {
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    // right = fwd x up for a Y-up right-handed frame, i.e. (-fwd.z, 0, fwd.x).
    // This was negated for a long time, which silently swapped A and D: at yaw 0 the player
    // faces -Z, so world right is +X, and the old (fwd.z, 0, -fwd.x) produced -X.
    // Camera roll and viewmodel lag read lateral velocity through this same vector, so they
    // stayed correct relative to the key press and hid the bug. moveMath.test.ts pins it now.
    this.right.set(-this.fwd.z, 0, this.fwd.x);
  }

  private die(): void {
    this.alive = false; this.wasDead = true;
    this.deadSide = ((this.position.x * 7 + this.position.z * 13) | 0) & 1 ? 1 : -1;
    this.sliding = this.sprinting = this.tacSprinting = this.mantling = this.aiming = false; this.mantle = null;
    this.controller.enableSnapToGround(PLAYER.snapDistance);
    this.fx.addShake(0.5);
    this.engine.events.emit('player:death', {});
  }

  // ------------------------------------------------------------------ input

  /** Base input plus the debug override (used by poses and scripted tests). */
  private readInput(): InputState {
    const base = this.engine.input.state;
    if (!this.debugInput) return base;
    Object.assign(this.mergedInput, base, this.debugInput);
    return this.mergedInput;
  }

  /** Per-frame edge handling (jump buffer, crouch press, sprint double-tap). Runs in update() so 144 Hz frames never drop a press. */
  private latchEdges(inp: InputState, dt: number): void {
    if (inp.jumpPressed) this.jumpBuffer = PLAYER.jumpBuffer;
    if (inp.crouchPressed) { this.crouchPress = true; this.crouchToggled = !this.crouchToggled; }
    if (!inp.crouch && !this.settings.crouchToggle) this.crouchToggled = false;
    const sprintEdge = inp.sprint && !this.sprintHeldPrev;
    if (sprintEdge) {
      const t = this.engine.time;
      if (this.settings.tacSprintDoubleTap && this.lastSprintTap >= 0 && t - this.lastSprintTap < PLAYER.doubleTapWindow) this.tacRequested = true;
      this.lastSprintTap = t;
    }
    this.sprintHeldPrev = inp.sprint;
    void dt;
    if (this.debugInput) {
      // one-shot flags fire once
      const d = this.debugInput;
      if (d.jumpPressed) d.jumpPressed = false; if (d.crouchPressed) d.crouchPressed = false;
      if (d.firePressed) d.firePressed = false; if (d.reload) d.reload = false;
    }
  }

  private advanceDebugSequence(): void {
    if (this.debugSeq.length === 0) return;
    this.debugFrame++;
    while (this.debugSeq.length && this.debugSeq[0].at <= this.debugFrame) {
      const step = this.debugSeq.shift()!;
      this.debugInput = step.set ? { ...(this.debugInput ?? {}), ...step.set } : null;
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, alpha: number): void {
    this.advanceDebugSequence();
    const inp = this.readInput();
    const S = this.settings;
    // keep Input.sensitivity and settings in sync (either side may be edited by the UI)
    if (this.engine.input.sensitivity !== this.lastInputSens) S.sensitivity = this.engine.input.sensitivity;
    this.engine.input.sensitivity = this.lastInputSens = S.sensitivity;

    // ---- aim blend / fov: weapons drive it when they call setAimFov every frame, else we do it
    const ext = this.engine.frame - this.aimExtFrame <= 2;
    const aimTarget = ext ? this.aimBlendExt : (this.aiming ? 1 : 0);
    const aimFov = ext ? this.aimFovExt : PLAYER.adsFov;
    this.aimBlend = ext ? aimTarget : expDamp(this.aimBlend, aimTarget, 14, dt);
    this.fovTarget = lerp(S.fov, aimFov, this.aimBlend);

    // ---- look (per frame for lowest latency; not in fixedUpdate so high refresh rates never lag)
    if (this.alive) {
      const zoom = lerp(1, zoomSensitivity(S.fov, aimFov, S.adsSensMode, S.adsSensMul), this.aimBlend);
      const sens = S.sensitivity * zoom;
      this.yaw -= inp.lookDX * sens;
      this.pitch = clamp(this.pitch - inp.lookDY * sens * (S.invertY ? -1 : 1), -89 * DEG, 89 * DEG);
      this.latchEdges(inp, dt);
    }
    if (Math.abs(this.yaw) > 1e4) this.yaw %= Math.PI * 2;

    // ---- blends for the camera + weapons
    const dead = !this.alive;
    this.deadBlend = expDamp(this.deadBlend, dead ? 1 : 0, 4, dt);
    this.moveBlend = expDamp(this.moveBlend, clamp(this.speed / PLAYER.walkSpeed, 0, 1), 10, dt);
    this.sprintBlend = expDamp(this.sprintBlend, this.sprinting || this.tacSprinting ? 1 : 0, this.sprinting ? 8 : 12, dt);
    this.tacSprintBlend = expDamp(this.tacSprintBlend, this.tacSprinting ? 1 : 0, 6, dt);
    this.slideBlend = expDamp(this.slideBlend, this.sliding ? 1 : 0, 14, dt);
    this.crouchBlend = expDamp(this.crouchBlend, this.crouching ? 1 : 0, this.sliding ? 18 : 11, dt);
    this.airBlend = expDamp(this.airBlend, this.grounded ? 0 : 1, 9, dt);
    this.mantleBlend = this.mantling && this.mantle ? clamp(this.mantleT / this.mantle.duration, 0, 1) : 0;

    // ---- eye height (smooth stance, death drop)
    const standEye = lerp(PLAYER.eyeHeight, PLAYER.crouchEyeHeight, this.crouchBlend);
    const targetEye = lerp(standEye, PLAYER.deadEyeHeight, this.deadBlend);
    this.eyeH = expDamp(this.eyeH, targetEye, 12, dt);

    // ---- camera fx
    this.forward();
    const lateralVel = this.velocity.x * this.right.x + this.velocity.z * this.right.z;
    const forwardVel = this.velocity.x * this.fwd.x + this.velocity.z * this.fwd.z;
    if (!this.hasFx) { this.hasFx = true; this.fx.fovH = S.fov; }
    this.fx.update({
      dt, time: this.engine.time, speed: this.speed, walkSpeed: PLAYER.walkSpeed,
      lateralVel, forwardVel, yaw: this.yaw, pitch: this.pitch,
      moveBlend: this.moveBlend, sprintBlend: this.sprintBlend, tacSprintBlend: this.tacSprintBlend, crouchBlend: this.crouchBlend,
      slideBlend: this.slideBlend, airBlend: this.airBlend, aimBlend: this.aimBlend, mantleBlend: this.mantleBlend, deadBlend: this.deadBlend,
      grounded: this.grounded, sliding: this.sliding, mantling: this.mantling, slideSide: this.slideSide, deadSide: this.deadSide,
      aimFov, aspect: this.engine.camera.aspect,
    });

    // ---- footsteps from the gait phase so audio lands on the bob's heel strike
    if (this.fx.footfalls > 0 && this.grounded && !this.sliding && this.speed > 0.5) {
      const level = this.engine.get<LevelLike>('level');
      const feet = this.tmpV.set(this.position.x, this.position.y - PLAYER.centerHeight, this.position.z);
      const surface: SurfaceType = level?.surfaceAt?.(feet) ?? 'concrete';
      for (let i = 0; i < this.fx.footfalls; i++) this.engine.events.emit('player:footstep', { surface, speed: this.speed });
    }

    // ---- compose the camera
    const cam = this.engine.camera;
    const a = clamp(alpha, 0, 1);
    const base = this.tmpV2.lerpVectors(this.prevPosition, this.position, a);
    base.y += this.eyeH - PLAYER.centerHeight + lerp(this.prevStepOffset, this.stepOffset, a);
    cam.rotation.set(this.pitch + this.fx.pitch, this.yaw + this.fx.yaw, this.fx.roll, 'YXZ');
    this.camQuat.setFromEuler(cam.rotation);
    const off = this.tmpV3.copy(this.fx.posOffset).applyQuaternion(this.camQuat);
    cam.position.copy(base).add(off);
    this.eye.copy(cam.position);
    if (Math.abs(cam.fov - this.fx.fovVertical) > 1e-3) { cam.fov = this.fx.fovVertical; cam.updateProjectionMatrix(); }
  }
}
