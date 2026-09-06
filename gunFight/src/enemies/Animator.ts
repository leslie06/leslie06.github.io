/**
 * Procedural animation for the soldier rig. No clips: locomotion comes from a gait generator with
 * IK-planted feet (world-locked when idle, re-stepping when the body turns), the upper body is
 * layered (spine/head aim-offset, rifle placed in world space with the stock in the shoulder pocket
 * and the head cheek-welded to it, both arms IK'd to the rifle), hit reactions are damped springs per
 * body part, and cover poses (crouch / lean / hunker) are blended in with damped weights.
 */
import * as THREE from 'three';
import { ANIM, SKELETON as S, STANCES, type StanceDef } from './EnemyDefs';
import { B, BONE_NAMES, HEAD, JOINT, PARENT, RIFLE, WEAPONS, weaponOf, type SoldierRig } from './SoldierModel';
import { clamp, damp, dampAngle, footCurve, gaitFor, hipsCurve, lerp, phaseRate, smoothstep, springStep, wrap01 } from './Gait';

export interface AnimTarget {
  moveVel: THREE.Vector3;
  yaw: number;
  aimDir: THREE.Vector3;
  aim: number;
  crouch: number;
  lean: number;
  sprint: number;
  /** -1 = not reloading, else 0..1 */
  reload: number;
  hide: number;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function basisQuat(out: THREE.Quaternion, f: THREE.Vector3, u: THREE.Vector3): THREE.Quaternion {
  const x = _v3.copy(f).normalize();
  const z = _v4.crossVectors(x, u).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}
/** Quaternion that maps basis (f0,u0) onto (f1,u1). */
function alignQuat(out: THREE.Quaternion, f0: THREE.Vector3, u0: THREE.Vector3, f1: THREE.Vector3, u1: THREE.Vector3): THREE.Quaternion {
  basisQuat(_q2, f0, u0);
  basisQuat(_q3, f1, u1);
  return out.copy(_q3).multiply(_q2.invert());
}

const BIND_DIR: Partial<Record<number, THREE.Vector3>> = {};
for (const n of BONE_NAMES) for (const c of BONE_NAMES) if (PARENT[c] === n && n !== 'root' && n !== 'hips' && n !== 'chest') BIND_DIR[B[n]] = new THREE.Vector3().subVectors(JOINT[c], JOINT[n]).normalize();
const BEND_ARM = new THREE.Vector3(0, 0, 1), BEND_LEG = new THREE.Vector3(0, 0, -1);
const HAND_LEN = new THREE.Vector3(0, -1, 0), HAND_PALM = new THREE.Vector3(0, 0, -1);
/** rifle-space hand frames: length = wrist->knuckles, palm = palm normal */
const HAND_R_LEN = new THREE.Vector3(0, -0.35, -1).normalize(), HAND_R_PALM = new THREE.Vector3(-1, 0, 0);
const HAND_L_LEN = new THREE.Vector3(0.12, 0.28, -0.95).normalize(), HAND_L_PALM = new THREE.Vector3(0.3, 0.95, 0).normalize();
const POLE_R = new THREE.Vector3(0.45, -1, 0.15).normalize(), POLE_L = new THREE.Vector3(-0.4, -1, 0.05).normalize();
/** chest-local shoulder pocket where the stock butt sits when shouldered */
const SHOULDER_POCKET = new THREE.Vector3(0.1, 0.13, -0.075);
/** barrel axis in the rifle's own frame — the axis the elbow flare swings the IK poles about */
const FWD_AXIS = new THREE.Vector3(0, 0, 1);
/** support (left) shoulder joint, in the chest's local frame */
const SUPPORT_SHOULDER = new THREE.Vector3().subVectors(JOINT.upperArmL, JOINT.chest);
/** clavL bind position (local to the chest) and the clavicle -> shoulder offset */
const CLAV_L_BIND = new THREE.Vector3().subVectors(JOINT.clavL, JOINT.chest);
const CLAV_L_TO_SHOULDER = new THREE.Vector3().subVectors(JOINT.upperArmL, JOINT.clavL);
/** wrist reach from the shoulder joint, and how far the scapula may protract to add to it */
const ARM_REACH = S.upperArmLen + S.forearmLen;
const SCAPULA_SLIDE = 0.085;
const _reach = new THREE.Vector3(), _reach2 = new THREE.Vector3(), _reach3 = new THREE.Vector3();

interface Spring { x: number; v: number }
const spring = (): Spring => ({ x: 0, v: 0 });
interface FootLock { pos: THREE.Vector3; valid: boolean; from: THREE.Vector3; to: THREE.Vector3; t: number; stepping: boolean }

export class Animator {
  /** world-space bone poses (computed every frame, read by hitboxes / ragdoll / muzzle) */
  readonly wp: THREE.Vector3[];
  readonly wq: THREE.Quaternion[];
  phase = 0;
  moveBlend = 0; crouch = 0; aim = 0; sprint = 0; lean = 0; hide = 0;
  speed = 0;
  /** damped body yaw actually used for the mesh (the AI turns instantly; this lags a little) */
  yaw = 0;
  aimYaw = 0; aimPitch = 0;
  private moveDirLocal = new THREE.Vector3(0, 0, -1);
  private flinch = { headPitch: spring(), headYaw: spring(), chestPitch: spring(), chestRoll: spring(), armL: spring(), armR: spring(), legL: spring(), legR: spring(), stagger: spring() };
  private t = 0;
  private seed: number;
  /** +1 = weight on the right leg, -1 = left; fixed per enemy so a squad isn't in lockstep */
  readonly weightSide: number;
  /** archetype stance family + hip-height offset: real posture and height variation across a squad */
  readonly stance: StanceDef;
  readonly stature: number;
  /** muzzle point in the rifle bone's frame — a DMR's is 37 cm further out than a carbine's */
  readonly muzzleLocal: THREE.Vector3;
  /** support-hand wrist point in the rifle bone's frame: this weapon's handguard */
  readonly foregripLocal: THREE.Vector3;
  private bones: THREE.Bone[];
  private feet: [FootLock, FootLock] = [
    { pos: new THREE.Vector3(), valid: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, stepping: false },
    { pos: new THREE.Vector3(), valid: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, stepping: false },
  ];
  readonly rifleWorldPos = new THREE.Vector3();
  readonly rifleWorldQuat = new THREE.Quaternion();
  readonly muzzleWorld = new THREE.Vector3();
  readonly muzzleDir = new THREE.Vector3(0, 0, -1);
  /** world position of the aiming eye after the cheek weld (debug / tests) */
  readonly eyeWorld = new THREE.Vector3();

  constructor(private rig: SoldierRig, seed: number) {
    this.bones = rig.bones;
    this.wp = rig.bones.map(() => new THREE.Vector3());
    this.wq = rig.bones.map(() => new THREE.Quaternion());
    this.seed = seed;
    this.weightSide = Math.floor(Math.abs(seed) * 3.7) % 2 === 0 ? 1 : -1;
    const a = rig.archetype;
    this.stance = STANCES[a ? a.stance % STANCES.length : 0];
    this.stature = a ? a.stature : 0;
    this.muzzleLocal = (a ? WEAPONS[weaponOf(a)].muzzle : RIFLE.muzzle).clone();
    this.foregripLocal = (a ? WEAPONS[weaponOf(a)].foregrip : RIFLE.handL).clone();
  }

  /** Physical reaction to a hit; part decides which springs kick. */
  hit(part: 'head' | 'torso' | 'limb', dir: THREE.Vector3, point: THREE.Vector3, strength = 1): void {
    const a = ANIM.flinchAmount * strength;
    // direction in body-local frame
    _q.setFromAxisAngle(UP, -this.yaw);
    const d = _v.copy(dir).applyQuaternion(_q);
    const f = this.flinch;
    if (part === 'head') { f.headPitch.v += a * 14 * (d.z < 0 ? -1 : 1); f.headYaw.v += a * 10 * -d.x; f.chestPitch.v += a * 3; }
    else if (part === 'torso') { f.chestPitch.v += a * 8 * (d.z < 0 ? -1 : 1); f.chestRoll.v += a * 6 * -d.x; f.stagger.v += a * 0.6; }
    else {
      const local = _v2.copy(point).sub(this.wp[B.hips]).applyQuaternion(_q);
      if (local.y < 0) { if (local.x < 0) f.legL.v += a * 6; else f.legR.v += a * 6; f.stagger.v += a * 0.4; }
      else { if (local.x < 0) f.armL.v += a * 9; else f.armR.v += a * 9; }
    }
  }

  /** Rifle kick: arms and chest rock back a touch per shot. */
  recoil(): void { const f = this.flinch; f.armR.v += 1.6; f.armL.v += 0.8; f.chestPitch.v += -0.45; f.headPitch.v += -0.3; }

  private stepSprings(dt: number): void {
    for (const s of Object.values(this.flinch)) { const [x, v] = springStep(s.x, s.v, 0, ANIM.flinchDecay, dt); s.x = x; s.v = v; }
  }

  private setWorld(i: number): void {
    const b = this.bones[i]; const p = PARENT[BONE_NAMES[i]];
    if (p === null) { this.wp[i].copy(b.position).add(this.rig.root.position); this.wq[i].copy(this.rig.root.quaternion).multiply(b.quaternion); return; }
    const pi = B[p];
    this.wp[i].copy(b.position).applyQuaternion(this.wq[pi]).add(this.wp[pi]);
    this.wq[i].multiplyQuaternions(this.wq[pi], b.quaternion);
  }
  /** Set a bone's world rotation (position stays on its parent's chain) and refresh its world pose. */
  private setWorldQuat(i: number, q: THREE.Quaternion): void {
    const p = PARENT[BONE_NAMES[i]]!; const pi = B[p];
    this.bones[i].quaternion.copy(this.wq[pi]).invert().multiply(q);
    this.setWorld(i);
  }

  /** Two-bone IK for bones (a -> b -> end). `pole` = direction the middle joint bends toward. */
  private ik(a: number, b: number, lenA: number, lenB: number, target: THREE.Vector3, pole: THREE.Vector3, bend: THREE.Vector3): void {
    const root = this.wp[a];
    const dir = _v.subVectors(target, root);
    let d = dir.length(); if (d < 1e-5) { dir.set(0, -1, 0); d = 1e-5; } dir.divideScalar(d);
    d = clamp(d, Math.abs(lenA - lenB) + 0.01, lenA + lenB - 0.005);
    const poleProj = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (poleProj.lengthSq() < 1e-6) poleProj.set(0, 0, -1).addScaledVector(dir, -dir.z);
    poleProj.normalize();
    const cosA = clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const mid = new THREE.Vector3().copy(root).addScaledVector(dir, lenA * cosA).addScaledVector(poleProj, lenA * sinA);
    const upperDir = new THREE.Vector3().subVectors(mid, root).normalize();
    alignQuat(_q, BIND_DIR[a]!, bend, upperDir, poleProj);
    this.setWorldQuat(a, _q);
    const lowerDir = new THREE.Vector3().subVectors(target, mid).normalize();
    const bendLower = new THREE.Vector3().copy(poleProj).addScaledVector(lowerDir, -poleProj.dot(lowerDir)).normalize();
    alignQuat(_q, BIND_DIR[b]!, bend, lowerDir, bendLower);
    this.setWorldQuat(b, _q);
  }

  /** Main pose update. `pos` = interpolated ground position of the character. */
  update(dt: number, pos: THREE.Vector3, tg: AnimTarget): void {
    this.t += dt;
    this.stepSprings(dt);
    const f = this.flinch;
    const rate = ANIM.blendRate;
    const speed = Math.hypot(tg.moveVel.x, tg.moveVel.z);
    this.speed = speed;
    const moving = speed > 0.2;
    this.moveBlend = damp(this.moveBlend, moving ? 1 : 0, rate, dt);
    this.crouch = damp(this.crouch, tg.crouch, rate * 0.7, dt);
    this.aim = damp(this.aim, tg.aim, rate, dt);
    this.sprint = damp(this.sprint, tg.sprint, rate, dt);
    this.lean = damp(this.lean, tg.lean, rate * 0.6, dt);
    this.hide = damp(this.hide, tg.hide, rate * 0.7, dt);
    this.yaw = dampAngle(this.yaw, tg.yaw, ANIM.blendRate * 1.4, dt);
    const gait = gaitFor(speed, this.crouch);
    if (moving) this.phase = wrap01(this.phase + phaseRate(speed, gait) * dt);
    else { const settle = Math.round(this.phase * 2) / 2; this.phase = damp(this.phase, settle, 6, dt); }
    if (moving) {
      _q.setFromAxisAngle(UP, -this.yaw);
      this.moveDirLocal.copy(tg.moveVel).divideScalar(speed).applyQuaternion(_q);
    }
    // aim angles relative to body yaw
    const aimWorldYaw = Math.atan2(-tg.aimDir.x, -tg.aimDir.z);
    let rel = aimWorldYaw - this.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.aimYaw = damp(this.aimYaw, clamp(rel, -ANIM.aimYawLimit, ANIM.aimYawLimit), rate * 1.2, dt);
    this.aimPitch = damp(this.aimPitch, clamp(Math.asin(clamp(tg.aimDir.y, -1, 1)), -ANIM.aimPitchLimit, ANIM.aimPitchLimit), rate * 1.2, dt);
    const aimW = smoothstep(this.aim);
    const run = this.moveBlend * smoothstep((speed - 2.2) / 2);

    const root = this.rig.root;
    root.position.copy(pos);
    root.quaternion.setFromAxisAngle(UP, this.yaw);
    this.setWorld(B.root);

    // ---------- hips ----------
    const hc = hipsCurve(this.phase, gait, this.moveBlend);
    const idleSway = Math.sin(this.t * ANIM.idleSwayRate + this.seed) * 0.012 * (1 - this.moveBlend);
    const hips = this.bones[B.hips];
    const crouchDrop = ANIM.crouchDrop * this.crouch + 0.05 * this.hide;
    // standing idle is asymmetric: weight over one leg, that hip high, the free knee soft
    const idle = (1 - this.moveBlend) * (1 - this.crouch);
    const shift = Math.sin(this.t * ANIM.idleShiftRate + this.seed * 3) * 0.25 + 0.75;   // slow settle onto the loaded leg
    const ws = this.weightSide * idle * shift;
    const st = this.stance;
    hips.position.set(hc.sway + idleSway + ws * ANIM.idleWeightShift, ANIM.hipHeight + this.stature - crouchDrop + hc.bob - f.stagger.x * 0.05 - 0.02 * aimW * (1 - this.crouch), 0.03 * this.crouch + f.stagger.x * 0.12);
    const bodyLean = gait.lean * this.moveBlend + ANIM.sprintLean * this.sprint * this.moveBlend + 0.24 * this.crouch + 0.1 * this.hide + f.stagger.x * 0.25 + st.lean * (1 - this.moveBlend);
    hips.quaternion.setFromEuler(_e.set(bodyLean, hc.yaw + this.aimYaw * 0.12 - ws * ANIM.idleHipYaw, hc.roll - ws * ANIM.idleHipRoll, 'YXZ'));
    this.setWorld(B.hips);

    // ---------- spine ----------
    const breath = Math.sin(this.t * ANIM.breathRate * Math.PI * 2 + this.seed) * ANIM.breathAmount;
    // blade the body when shouldered (left shoulder forward) so the support hand reaches the handguard
    const tw = this.aimYaw * ANIM.spineTwistShare - ANIM.bladeYaw * aimW;
    const leanRoll = -this.lean * ANIM.leanAngle;
    const hunch = 0.12 * this.crouch + 0.2 * this.hide + ANIM.aimHunch * aimW + 0.1 * this.sprint + st.hunch * (1 - this.moveBlend * 0.6);
    const aimRoll = ANIM.aimRoll * aimW; // shoulders roll toward the stock
    const idleDrop = ws * ANIM.idleShoulderDrop + st.shoulder * (1 - this.moveBlend) * this.weightSide;   // counter-rotate the shoulders over the loaded hip
    const idleTwist = ws * ANIM.idleTwist;
    this.bones[B.spine1].quaternion.setFromEuler(_e.set(breath * 0.5 + hunch * 0.3 + f.chestPitch.x * 0.3, tw * 0.25 - hc.yaw * 0.3 + idleTwist * 0.4, leanRoll * 0.3 + aimRoll * 0.3 + f.chestRoll.x * 0.3 + idleDrop * 0.35, 'YXZ'));
    this.setWorld(B.spine1);
    this.bones[B.spine2].quaternion.setFromEuler(_e.set(breath * 0.5 + hunch * 0.3 - this.aimPitch * 0.12 * this.aim + f.chestPitch.x * 0.35, tw * 0.3 - hc.yaw * 0.3 + idleTwist * 0.35, leanRoll * 0.3 + aimRoll * 0.3 + f.chestRoll.x * 0.35 + idleDrop * 0.35, 'YXZ'));
    this.setWorld(B.spine2);
    this.bones[B.chest].quaternion.setFromEuler(_e.set(hunch * 0.4 - this.aimPitch * 0.25 * this.aim + f.chestPitch.x * 0.35 + breath * 0.3, tw * 0.45 - hc.yaw * 0.2 + ANIM.chestCounterYaw * Math.sin(this.phase * Math.PI * 2) * this.moveBlend, leanRoll * 0.4 + aimRoll * 0.4 + f.chestRoll.x * 0.35 + idleDrop * 0.3, 'YXZ'));
    this.setWorld(B.chest);
    for (const c of [B.clavL, B.clavR]) { this.bones[c].quaternion.identity(); this.setWorld(c); }

    // ---------- rifle ----------
    const chestP = this.wp[B.chest], chestQ = this.wq[B.chest];
    // aimed pose: stock in the shoulder pocket, barrel exactly along aimDir
    const aimQ = new THREE.Quaternion();
    {
      _m2.lookAt(new THREE.Vector3(), tg.aimDir, UP); // Matrix4.lookAt: -Z of the result points from eye to target
      aimQ.setFromRotationMatrix(_m2);
      // cant toward the body while leaning / reloading
      const roll = this.lean * 0.15 + (tg.reload >= 0 ? -0.45 * Math.sin(Math.PI * clamp(tg.reload, 0, 1)) : 0);
      aimQ.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    }
    const shoulder = new THREE.Vector3().copy(SHOULDER_POCKET).applyQuaternion(chestQ).add(chestP);
    const aimPos = new THREE.Vector3().copy(RIFLE.stockButt).applyQuaternion(aimQ).negate().add(shoulder);
    // carry poses (low ready / sprint / hide) — relative to the chest
    const carryQ = new THREE.Quaternion();
    const carryPos = new THREE.Vector3();
    {
      const sprint = this.sprint, hide = this.hide, low = Math.max(0, 1 - sprint - hide);
      const bob = Math.sin(this.phase * Math.PI * 4) * 0.02 * run;
      const pitch = (ANIM.carryPitch + st.carryPitch) * low - 0.72 * sprint + 0.95 * hide - this.aimPitch * 0.3 * low;
      // swing the muzzle across the body so the buttstock clears the ribcage instead of passing through the chest
      const relYaw = (ANIM.carryYaw + st.carryYaw + this.aimYaw * 0.35) * low + 0.66 * sprint + 0.45 * hide;
      const rollC = 0.12 * low + 0.35 * sprint + 0.5 * hide;
      carryQ.copy(chestQ).multiply(_q.setFromEuler(_e.set(pitch, relYaw, rollC, 'YXZ')));
      const local = _v.set(
        (ANIM.carryPos.x + st.carryX) * low + 0.1 * sprint + 0.05 * hide,
        (ANIM.carryPos.y + st.carryY) * low - 0.13 * sprint - 0.07 * hide + bob,
        (ANIM.carryPos.z + st.carryZ) * low - 0.2 * sprint - 0.16 * hide,
      );
      carryPos.copy(local).applyQuaternion(chestQ).add(chestP);
      // A carry pose the support arm cannot make is how a soldier ends up with a straight arm
      // ending in nothing beside his weapon. The stances below place the weapon low, wide and
      // forward — and a carbine's handguard is not where an AK's is — so pull the whole weapon back
      // along the line to the support shoulder until the handguard is inside the arm's reach.
      // Orientation is untouched, so the pose keeps its character; only the offset gives.
      _reach.copy(this.foregripLocal).applyQuaternion(carryQ).add(carryPos);
      _reach2.copy(SUPPORT_SHOULDER).applyQuaternion(chestQ).add(chestP);
      const over = _reach.distanceTo(_reach2) - (ARM_REACH * 0.94 + SCAPULA_SLIDE);
      if (over > 0) carryPos.addScaledVector(_reach3.subVectors(_reach2, _reach).normalize(), over);
    }
    const rq = this.rifleWorldQuat.copy(carryQ).slerp(aimQ, aimW);
    const rp = this.rifleWorldPos.copy(carryPos).lerp(aimPos, aimW);
    // write rifle bone (child of root)
    const rifle = this.bones[B.rifle];
    rifle.quaternion.copy(this.wq[B.root]).invert().multiply(rq);
    rifle.position.copy(rp).sub(this.wp[B.root]).applyQuaternion(_q.copy(this.wq[B.root]).invert());
    this.setWorld(B.rifle);
    this.muzzleWorld.copy(this.muzzleLocal).applyQuaternion(rq).add(rp);
    this.muzzleDir.set(0, 0, -1).applyQuaternion(rq);

    // ---------- neck / head: look + cheek weld ----------
    const headYaw = this.aimYaw * ANIM.headTwistShare + (1 - this.aim) * (1 - this.moveBlend) * Math.sin(this.t * 0.37 + this.seed * 2) * 0.2;
    const headPitch = -this.aimPitch * 0.45 * (1 - aimW) + 0.12 * this.hide + 0.1 * this.sprint;
    this.bones[B.neck].quaternion.setFromEuler(_e.set(headPitch * 0.35 + f.headPitch.x * 0.4, headYaw * 0.35 + f.headYaw.x * 0.4, -leanRoll * 0.15, 'YXZ'));
    this.setWorld(B.neck);
    this.bones[B.head].quaternion.setFromEuler(_e.set(headPitch * 0.65 + f.headPitch.x * 0.6, headYaw * 0.65 + f.headYaw.x * 0.6, -leanRoll * 0.2, 'YXZ'));
    this.setWorld(B.head);
    if (aimW > 0.001) {
      // rotate the neck+head about the neck base so the aiming eye moves onto the sight line
      const neckP = this.wp[B.neck];
      const eye = _v.copy(HEAD.eyeR).applyQuaternion(this.wq[B.head]).add(this.wp[B.head]);
      const sight = _v2.copy(RIFLE.eyeLine).applyQuaternion(rq).add(rp);
      const a = _v3.subVectors(eye, neckP), b = _v4.subVectors(sight, neckP);
      const la = a.length(), lb = b.length();
      if (la > 1e-4 && lb > 1e-4) {
        a.divideScalar(la); b.divideScalar(lb);
        let ang = Math.acos(clamp(a.dot(b), -1, 1));
        ang = Math.min(ang, ANIM.cheekWeldMax) * aimW;
        const axis = new THREE.Vector3().crossVectors(a, b);
        if (axis.lengthSq() > 1e-8 && ang > 1e-4) {
          axis.normalize();
          const dq = new THREE.Quaternion().setFromAxisAngle(axis, ang);
          const neckQ = new THREE.Quaternion().copy(dq).slerp(new THREE.Quaternion(), 0.6).multiply(this.wq[B.neck]);
          this.setWorldQuat(B.neck, neckQ);
          const headQ = new THREE.Quaternion().copy(dq).multiply(this.wq[B.head]);
          // keep the head's own rotation but pre-multiply the full correction (neck already took 40%)
          this.setWorldQuat(B.head, headQ);
        }
      }
    }
    this.eyeWorld.copy(HEAD.eyeR).applyQuaternion(this.wq[B.head]).add(this.wp[B.head]);

    // ---------- eyes ----------
    // The eyeballs have their own bones, so the gaze is driven from the aim direction rather than
    // baked forward: with the head turned three-quarters the irises stay on the target instead of
    // sliding to the outer corner of the sclera. Head yaw only takes ~35% of the aim offset, so the
    // eyes pick up the rest — which is exactly what a real shooter's eyes do.
    {
      const inv = _q2.copy(this.wq[B.head]).invert();
      const d = _v.copy(tg.aimDir).applyQuaternion(inv);
      const gl = d.length();
      if (gl > 1e-5) {
        d.divideScalar(gl);
        const sac = Math.sin(this.t * ANIM.saccadeRate + this.seed * 5) * Math.sin(this.t * 0.61 + this.seed) * ANIM.saccade;
        const yaw = clamp(Math.atan2(-d.x, -d.z) + sac, -ANIM.gazeYawLimit, ANIM.gazeYawLimit);
        const pitch = clamp(Math.asin(clamp(d.y, -1, 1)) + sac * 0.4, -ANIM.gazePitchLimit, ANIM.gazePitchLimit);
        // slight convergence so the two eyes are not perfectly parallel
        for (const [i, sx] of [[B.eyeL, -1], [B.eyeR, 1]] as [number, number][]) {
          this.bones[i].quaternion.setFromEuler(_e.set(pitch, yaw + sx * ANIM.gazeVergence, 0, 'YXZ'));
          this.setWorld(i);
        }
      }
    }

    // ---------- legs ----------
    const fwdW = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rightW = new THREE.Vector3(-fwdW.z, 0, fwdW.x);   // facing -Z => right is +X
    const groundY = pos.y + S.ankleY + ANIM.footClearance;   // feet stay on the road; `stature` moves the hips, not the ground
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? -1 : 1;
      const thigh = s === 0 ? B.thighL : B.thighR, shin = s === 0 ? B.shinL : B.shinR, foot = s === 0 ? B.footL : B.footR;
      const fc = footCurve(this.phase + (s === 0 ? 0.5 : 0), gait);
      // A combat crouch is narrow and staggered: the soldier drops behind cover and stays able to
      // stand up. Widening the track by 7 cm AND splitting the feet 28 cm fore/aft turned it into a
      // sumo squat, so both come down and the depth comes from the hips instead.
      const side = 0.12 + st.width * (1 - this.moveBlend) + 0.028 * this.crouch + 0.02 * this.moveBlend + 0.04 * aimW * (1 - this.crouch);
      // idle stance: bladed when aiming (right foot back), staggered when crouched
      const free = sx === this.weightSide ? 0 : 1;   // 1 for the unloaded leg
      const stagger = this.crouch * (sx > 0 ? 0.1 : -0.045) + (1 - this.crouch) * (sx > 0 ? -0.04 - 0.14 * aimW : 0.03 + 0.06 * aimW) + free * idle * ANIM.idleFreeFootFwd + sx * st.feetSkew * (1 - this.moveBlend * 0.5) * (1 - 0.45 * this.crouch);
      // gait target (body-local x right, z forward = -Z)
      const gx = sx * side + this.moveDirLocal.x * fc.forward;
      const gz = this.moveDirLocal.z * fc.forward;
      const gaitTarget = new THREE.Vector3(gx, 0, gz).applyAxisAngle(UP, this.yaw).add(pos);
      gaitTarget.y = groundY + fc.up;
      // idle target: world-locked; re-step when the desired stance has drifted (turning / stance change)
      const ideal = new THREE.Vector3(sx * (side + free * idle * ANIM.idleFreeFootOut), 0, stagger).applyAxisAngle(UP, this.yaw).add(pos); ideal.y = groundY;
      const lock = this.feet[s];
      if (this.moveBlend > 0.6) { lock.valid = false; lock.stepping = false; }
      if (!lock.valid) { lock.pos.copy(this.moveBlend > 0.3 ? gaitTarget : ideal); lock.pos.y = groundY; lock.valid = true; }
      const other = this.feet[1 - s];
      const drift = lock.pos.distanceTo(ideal);
      if (!lock.stepping && !other.stepping && drift > ANIM.restepDistance && this.moveBlend < 0.6) { lock.stepping = true; lock.t = 0; lock.from.copy(lock.pos); lock.to.copy(ideal); }
      if (lock.stepping) {
        lock.t += dt / ANIM.restepTime;
        const k = clamp(lock.t, 0, 1);
        lock.to.copy(ideal); // track a moving target
        lock.pos.lerpVectors(lock.from, lock.to, smoothstep(k));
        lock.pos.y = groundY + Math.sin(Math.PI * k) * ANIM.restepLift;
        if (k >= 1) { lock.stepping = false; lock.pos.y = groundY; }
      } else lock.pos.y = groundY;
      const target = new THREE.Vector3().lerpVectors(lock.pos, gaitTarget, smoothstep(this.moveBlend));
      // knee pole: forward, splayed outward a little (more when crouched)
      // knees track forward when crouched, not out to the sides — splaying them is the other half
      // of the squat read
      const pole = new THREE.Vector3().copy(fwdW).addScaledVector(rightW, sx * (0.25 + 0.16 * this.crouch)).normalize();
      const legF = s === 0 ? f.legL.x : f.legR.x;
      const shinLen = S.shinLen - Math.abs(legF) * 0.02;
      this.ik(thigh, shin, S.thighLen, shinLen, target, pole, BEND_LEG);
      // foot: flat on the ground, pitched by the gait during swing; toes out a little; toes point along the step while re-stepping
      const toeYaw = this.yaw - sx * (0.1 + 0.2 * this.crouch) + (aimW * (1 - this.crouch) * (sx > 0 ? -0.35 : 0.05));
      const pitch = fc.pitch * this.moveBlend + (lock.stepping ? Math.sin(Math.PI * clamp(lock.t, 0, 1)) * 0.25 : 0);
      _q.setFromEuler(_e.set(-pitch, toeYaw, 0, 'YXZ'));
      this.setWorldQuat(foot, _q);
    }

    // ---------- arms ----------
    {
      // right hand: pistol grip
      const gripPos = new THREE.Vector3().copy(RIFLE.handR).applyQuaternion(rq).add(rp);
      const handLen = new THREE.Vector3().copy(HAND_R_LEN).applyQuaternion(rq);
      const handPalm = new THREE.Vector3().copy(HAND_R_PALM).applyQuaternion(rq);
      // stance elbow flare: rotate the pole about the barrel axis so the elbows come off the ribs
      // (a man carrying an LMG low) or tuck in tight (a marksman at port arms)
      const flare = this.stance.elbowOut * (1 - aimW) * (1 - this.moveBlend * 0.5);
      const poleR = new THREE.Vector3().copy(POLE_R).applyAxisAngle(FWD_AXIS, -flare).applyQuaternion(rq);
      this.ik(B.upperArmR, B.forearmR, S.upperArmLen, S.forearmLen, gripPos, poleR, BEND_ARM);
      alignQuat(_q, HAND_LEN, HAND_PALM, handLen, handPalm);
      this.setWorldQuat(B.handR, _q);
      if (f.armR.x !== 0) { this.bones[B.upperArmR].quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), f.armR.x * 0.3)); this.setWorld(B.upperArmR); this.setWorld(B.forearmR); this.setWorld(B.handR); }
      // left hand: handguard, or reload path (foregrip -> magwell -> down -> magwell -> foregrip)
      const fore = this.foregripLocal;
      let leftLocal = fore;
      let palmL = HAND_L_PALM.clone(), lenL = HAND_L_LEN.clone();
      if (tg.reload >= 0) {
        const t = clamp(tg.reload, 0, 1);
        const mag = new THREE.Vector3(-0.03, -0.14, -0.2), low = new THREE.Vector3(-0.08, -0.34, -0.12);
        let a: THREE.Vector3, b: THREE.Vector3, k: number;
        if (t < 0.22) { a = fore; b = mag; k = t / 0.22; }
        else if (t < 0.45) { a = mag; b = low; k = (t - 0.22) / 0.23; }
        else if (t < 0.72) { a = low; b = mag; k = (t - 0.45) / 0.27; }
        else { a = mag; b = fore; k = (t - 0.72) / 0.28; }
        leftLocal = new THREE.Vector3().lerpVectors(a, b, smoothstep(k));
        if (t > 0.1 && t < 0.85) { palmL = new THREE.Vector3(0.2, 0.7, 0.7).normalize(); lenL = new THREE.Vector3(0.5, -0.5, 0.4).normalize(); }
      }
      const leftPos = leftLocal.clone().applyQuaternion(rq).add(rp);
      // Scapula protraction: a shooter reaching a long handguard rolls the support shoulder forward
      // rather than hyperextending the elbow. Up to 6 cm, which is what closes the last few
      // centimetres on a shouldered DMR — the carry clamp above owns the rest.
      {
        const clav = this.bones[B.clavL];
        clav.position.copy(CLAV_L_BIND);
        this.setWorld(B.clavL);
        _reach.copy(CLAV_L_TO_SHOULDER).applyQuaternion(this.wq[B.clavL]).add(this.wp[B.clavL]);
        const short = _reach.distanceTo(leftPos) - ARM_REACH * 0.965;
        if (short > 0) {
          _reach2.subVectors(leftPos, _reach).normalize().multiplyScalar(Math.min(short, SCAPULA_SLIDE));
          clav.position.add(_reach2.applyQuaternion(_q.copy(this.wq[B.chest]).invert()));
          this.setWorld(B.clavL);
        }
        this.setWorld(B.upperArmL);
      }
      const poleL = new THREE.Vector3().copy(POLE_L).applyAxisAngle(FWD_AXIS, flare).applyQuaternion(rq);
      this.ik(B.upperArmL, B.forearmL, S.upperArmLen, S.forearmLen, leftPos, poleL, BEND_ARM);
      alignQuat(_q, HAND_LEN, HAND_PALM, lenL.applyQuaternion(rq), palmL.applyQuaternion(rq));
      this.setWorldQuat(B.handL, _q);
      if (f.armL.x !== 0) { this.bones[B.upperArmL].quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), f.armL.x * 0.3)); this.setWorld(B.upperArmL); this.setWorld(B.forearmL); this.setWorld(B.handL); }
    }
  }

  /** Force the rig to a pose immediately (used on spawn so the first frame isn't a T-pose). */
  snap(pos: THREE.Vector3, tg: AnimTarget): void {
    this.yaw = tg.yaw; this.crouch = tg.crouch; this.aim = tg.aim; this.sprint = tg.sprint; this.hide = tg.hide; this.lean = tg.lean;
    const aimWorldYaw = Math.atan2(-tg.aimDir.x, -tg.aimDir.z);
    let rel = aimWorldYaw - this.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.aimYaw = clamp(rel, -ANIM.aimYawLimit, ANIM.aimYawLimit);
    this.aimPitch = clamp(Math.asin(clamp(tg.aimDir.y, -1, 1)), -ANIM.aimPitchLimit, ANIM.aimPitchLimit);
    for (const l of this.feet) l.valid = false;
    this.moveBlend = Math.hypot(tg.moveVel.x, tg.moveVel.z) > 0.2 ? 1 : 0;
    for (let i = 0; i < 3; i++) this.update(1 / 60, pos, tg);
    // finish any re-step started by the snap
    for (const l of this.feet) if (l.stepping) { l.stepping = false; l.pos.copy(l.to); }
    this.update(1 / 60, pos, tg);
  }
}
