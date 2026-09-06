import * as THREE from 'three';
import { Spring1, Spring3, expDamp, clamp, lerp, noise1, smoothstep } from './Spring';
import { BOB_STYLES, blendStyles, bobSample, bobAmplitudeForSpeed, advancePhase, type BobStyle } from './Bob';
import { landingImpulse } from './MoveMath';
import { horizontalToVerticalFov, type PlayerSettings } from './PlayerSettings';

/** Everything CameraFx needs to know about the player this frame. Filled by PlayerController.update. */
export interface FxContext {
  dt: number;
  time: number;
  /** horizontal ground speed (m/s) and the reference walk speed */
  speed: number;
  walkSpeed: number;
  /** view-space velocity components: +lateral = moving right, +forward = moving forward */
  lateralVel: number;
  forwardVel: number;
  /** view angles (radians); CameraFx differentiates these for look sway */
  yaw: number;
  pitch: number;
  /** 0..1 blends, already damped by the controller */
  moveBlend: number;
  sprintBlend: number;
  tacSprintBlend: number;
  crouchBlend: number;
  slideBlend: number;
  airBlend: number;
  aimBlend: number;
  mantleBlend: number;
  deadBlend: number;
  /** discrete states */
  grounded: boolean;
  sliding: boolean;
  mantling: boolean;
  /** +1 leans right during a slide, -1 left */
  slideSide: number;
  deadSide: number;
  /** horizontal-FOV (deg) the current weapon wants at full ADS */
  aimFov: number;
  aspect: number;
}

export interface ViewmodelOffset { position: THREE.Vector3; rotation: THREE.Euler }

/**
 * Procedural camera feel: bob, breathing, look sway, strafe/slide roll, landing dip,
 * recoil + view-punch springs, shake, FOV. All state is advanced with closed-form springs or
 * exponential damping so the result is identical at 30, 60 or 240 fps.
 *
 * Outputs (view space; x right, y up, z toward the viewer):
 *  - `posOffset` / `pitch` / `yaw` / `roll`  for the world camera
 *  - `viewmodelOffset`                        for the weapons module (lags slightly behind the camera)
 *  - `fovVertical`                            degrees, for PerspectiveCamera.fov
 */
export class CameraFx {
  readonly posOffset = new THREE.Vector3();
  pitch = 0; yaw = 0; roll = 0;
  fovVertical = 60;
  /** smoothed horizontal FOV, degrees */
  fovH = 80;
  readonly viewmodelOffset: ViewmodelOffset = { position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YXZ') };

  // --- gait
  bobPhase = 0;
  /** footfalls that happened during the last update (controller turns them into events) */
  footfalls = 0;
  private bobAmp = 0;
  private bobStyle: BobStyle = { ...BOB_STYLES.walk };
  private bobX = 0; private bobY = 0; private bobPitch = 0; private bobRoll = 0;
  private lean = 0; private drop = 0;

  // --- look
  private prevYaw = 0; private prevPitch = 0; private hasPrevLook = false;
  private yawVel = 0; private pitchVel = 0;
  private turnRoll = 0;

  // --- movement-driven
  private strafeRoll = 0;
  private slideRoll = 0;
  private airLift = 0;

  // --- impulses
  readonly landY = new Spring1(20, 0.5);
  readonly landPitch = new Spring1(16, 0.6);
  readonly recoil = new Spring3(30, 0.42);
  readonly punch = new Spring3(24, 0.5);
  private trauma = 0;
  readonly vmRot = new Spring3(16, 0.8);
  readonly vmPos = new Spring3(18, 0.85);

  private mantleDip = 0;

  constructor(private settings: PlayerSettings) {}

  /** Recoil kick in radians (positive pitch = muzzle climb). Spring returns to zero. */
  addRecoil(pitch: number, yaw: number): void {
    const k = this.recoil.omega * 1.6;
    this.recoil.kick(pitch * k, yaw * k, 0);
  }

  /** Damage / explosion punch in radians. */
  addViewPunch(pitch: number, yaw: number, roll: number): void {
    const s = this.settings.shakeScale;
    const k = this.punch.omega * 1.6;
    this.punch.kick(pitch * k * s, yaw * k * s, roll * k * s);
  }

  /** Adds trauma 0..1; shake intensity is trauma squared and decays over ~0.7 s. */
  addShake(amount: number): void { this.trauma = clamp(this.trauma + amount * this.settings.shakeScale, 0, 1); }

  onLand(fallSpeed: number): void {
    const imp = landingImpulse(fallSpeed);
    this.landY.kick(-imp);
    this.landPitch.kick(-imp * 0.45);
  }

  onJump(): void { this.landY.kick(0.35); this.landPitch.kick(0.12); }

  onSlideStart(): void { this.landY.kick(-0.6); }

  onMantleStart(): void { this.landPitch.kick(-0.5); }
  onMantleEnd(): void { this.landY.kick(-0.5); this.landPitch.kick(0.3); }

  reset(): void {
    this.bobPhase = 0; this.bobAmp = 0; this.hasPrevLook = false; this.yawVel = this.pitchVel = 0;
    this.landY.reset(); this.landPitch.reset(); this.recoil.reset(); this.punch.reset(); this.trauma = 0;
    this.vmRot.reset(); this.vmPos.reset(); this.strafeRoll = this.slideRoll = this.turnRoll = 0; this.mantleDip = 0;
    this.airLift = 0;
  }

  update(c: FxContext): void {
    const dt = Math.max(0, c.dt);
    const S = this.settings;
    this.footfalls = 0;

    // ---- look velocity (rad/s), smoothed; drives sway on the viewmodel and a whisper of roll on the camera
    if (!this.hasPrevLook) { this.prevYaw = c.yaw; this.prevPitch = c.pitch; this.hasPrevLook = true; }
    if (dt > 1e-6) {
      let dy = c.yaw - this.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const dp = c.pitch - this.prevPitch;
      this.yawVel = expDamp(this.yawVel, dy / dt, 22, dt);
      this.pitchVel = expDamp(this.pitchVel, dp / dt, 22, dt);
    }
    this.prevYaw = c.yaw; this.prevPitch = c.pitch;
    this.turnRoll = expDamp(this.turnRoll, clamp(-this.yawVel * 0.0035, -0.012, 0.012), 10, dt);

    // ---- gait: style blend + amplitude + phase
    const walkW = Math.max(0, 1 - c.sprintBlend - c.crouchBlend);
    const style = blendStyles([
      [BOB_STYLES.walk, walkW],
      [BOB_STYLES.sprint, c.sprintBlend * (1 - c.tacSprintBlend)],
      [BOB_STYLES.tacSprint, c.sprintBlend * c.tacSprintBlend],
      [BOB_STYLES.crouch, c.crouchBlend],
    ]);
    // ADS collapses the bob almost entirely.
    const adsMix = c.aimBlend * 0.85;
    this.bobStyle = blendStyles([[style, 1 - adsMix], [BOB_STYLES.ads, adsMix]]);
    const wantAmp = c.grounded && !c.sliding && !c.mantling ? bobAmplitudeForSpeed(c.speed, c.walkSpeed) : 0;
    this.bobAmp = expDamp(this.bobAmp, wantAmp, wantAmp > this.bobAmp ? 9 : 6, dt);
    if (c.grounded && !c.sliding && !c.mantling && c.speed > 0.3) {
      const r = advancePhase(this.bobPhase, c.speed, dt, this.bobStyle.cycleLength);
      this.bobPhase = r.phase; this.footfalls = r.footfalls;
    } else {
      // Ease the phase back to a footfall so the next step starts cleanly.
      const target = Math.round(this.bobPhase * 2) / 2;
      this.bobPhase = expDamp(this.bobPhase, target, 8, dt);
    }
    const bob = bobSample(this.bobPhase, this.bobStyle);
    const bobScale = this.bobAmp * S.headBobScale;
    this.bobX = bob.x * bobScale;
    this.bobY = (bob.y + this.bobStyle.drop) * bobScale;
    this.bobPitch = (bob.pitch - this.bobStyle.lean) * bobScale;
    this.bobRoll = bob.roll * bobScale;
    this.lean = expDamp(this.lean, this.bobStyle.lean * (1 - c.aimBlend), 8, dt);
    this.drop = expDamp(this.drop, this.bobStyle.drop * (1 - c.aimBlend), 8, dt);

    // ---- idle breathing (slow, tiny; fades with movement and ADS reduces it)
    const breathe = (1 - c.moveBlend * 0.7) * (1 - c.aimBlend * 0.5) * (1 - c.deadBlend);
    const bt = c.time * Math.PI * 2 * 0.21;
    const breathY = Math.sin(bt) * 0.0035 * breathe;
    const breathPitch = Math.sin(bt + 0.9) * 0.0022 * breathe;
    const breathRoll = Math.sin(bt * 0.5 + 2.0) * 0.0012 * breathe;

    // ---- strafe / slide roll, air lift
    const strafeTarget = clamp(-c.lateralVel * 0.0058, -0.03, 0.03) * (1 - c.aimBlend * 0.6) * (1 - c.slideBlend);
    this.strafeRoll = expDamp(this.strafeRoll, strafeTarget, 11, dt);
    this.slideRoll = expDamp(this.slideRoll, c.slideBlend * -0.05 * c.slideSide, 12, dt);
    this.airLift = expDamp(this.airLift, c.airBlend * 0.012, 8, dt);

    // ---- impulses
    this.landY.step(0, dt); this.landPitch.step(0, dt);
    this.recoil.step(0, 0, 0, dt);
    this.punch.step(0, 0, 0, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const shake = this.trauma * this.trauma;
    const st = c.time;
    const shakePitch = noise1(st * 23, 1) * 0.028 * shake;
    const shakeYaw = noise1(st * 19, 2) * 0.028 * shake;
    const shakeRoll = noise1(st * 17, 3) * 0.02 * shake;
    const shakeX = noise1(st * 21, 4) * 0.02 * shake;
    const shakeY = noise1(st * 25, 5) * 0.02 * shake;

    // ---- mantle: arms pull, eye dips then pops over the edge
    const m = c.mantling ? Math.sin(Math.PI * clamp(c.mantleBlend, 0, 1)) : 0;
    this.mantleDip = expDamp(this.mantleDip, m, 18, dt);

    // ---- death: camera lies on its side
    const dead = smoothstep(0, 1, c.deadBlend);
    const deadRoll = dead * 0.62 * c.deadSide;
    const deadPitch = dead * 0.12;

    // ---- compose camera
    const landClampY = clamp(this.landY.x, -0.22, 0.12);
    this.posOffset.set(
      this.bobX + shakeX,
      this.bobY - this.drop + breathY + landClampY - this.mantleDip * 0.14 + this.airLift,
      0,
    );
    this.pitch = this.bobPitch + this.lean + breathPitch + clamp(this.landPitch.x, -0.25, 0.15) + this.recoil.x + this.punch.x + shakePitch - this.mantleDip * 0.10 + deadPitch;
    this.yaw = this.recoil.y + this.punch.y + shakeYaw;
    this.roll = this.bobRoll + breathRoll + this.strafeRoll + this.slideRoll + this.turnRoll + this.punch.z + shakeRoll + deadRoll;

    // ---- FOV
    const sprintKick = S.fovKick ? lerp(4, 9, c.tacSprintBlend) * c.sprintBlend + c.slideBlend * 3 : 0;
    const hipFov = S.fov + sprintKick;
    const targetH = lerp(hipFov, c.aimFov, smoothstep(0, 1, c.aimBlend));
    this.fovH = expDamp(this.fovH, targetH, 16, dt);
    this.fovVertical = horizontalToVerticalFov(this.fovH, c.aspect);

    // ---- viewmodel: same bob (delayed a touch), look lag, move lag, recoil kick-back
    const vmScale = 1 - c.aimBlend * 0.9;
    const vb = bobSample(this.bobPhase - 0.05, this.bobStyle);
    const vmBobX = vb.x * bobScale * 1.1, vmBobY = (vb.y + this.bobStyle.drop) * bobScale * 0.9;
    // look lag targets: turning left (yaw+) drags the gun to the right and rotates it right
    const lagYaw = clamp(-this.yawVel * 0.028, -0.09, 0.09) * vmScale;
    const lagPitch = clamp(-this.pitchVel * 0.028, -0.07, 0.07) * vmScale;
    const lagRoll = clamp(this.yawVel * 0.012 - c.lateralVel * 0.008, -0.06, 0.06) * vmScale;
    this.vmRot.step(lagPitch, lagYaw, lagRoll, dt);
    const posX = clamp(this.yawVel * 0.006, -0.02, 0.02) * vmScale - c.lateralVel * 0.0035 * vmScale;
    const posY = clamp(-this.pitchVel * 0.005, -0.015, 0.015) * vmScale - c.airBlend * 0.012 * vmScale;
    const posZ = c.forwardVel * 0.0035 * vmScale + Math.max(0, this.recoil.x) * 0.35;
    this.vmPos.step(posX, posY, posZ, dt);
    const vmo = this.viewmodelOffset;
    vmo.position.set(
      this.vmPos.x + vmBobX + shakeX * 0.5,
      this.vmPos.y + vmBobY + landClampY * 0.45 - this.mantleDip * 0.06,
      this.vmPos.z,
    );
    vmo.rotation.set(
      this.vmRot.x + vb.pitch * bobScale * 1.4 - this.bobStyle.lean * bobScale * 1.4 + clamp(this.landPitch.x, -0.25, 0.15) * 0.6 + this.recoil.x * 0.7 + this.punch.x * 0.4 - this.mantleDip * 0.12,
      this.vmRot.y + this.recoil.y * 0.5 + this.punch.y * 0.3,
      this.vmRot.z + vb.roll * bobScale * 1.6 + this.punch.z * 0.5,
      'YXZ',
    );
  }
}
