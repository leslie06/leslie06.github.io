/**
 * One enemy soldier: rig + animator, kinematic character controller, per-bone kinematic hitboxes,
 * rifle state, health, and the ragdoll it becomes on death. Decisions come from AI.ts (Brain);
 * this class executes them (movement, firing) and owns the physics objects.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { BodyPart, FxApi, AudioApi, PlayerApi } from '../game/Contracts';
import { Rng } from '../core/Rng';
import { Animator, type AnimTarget } from './Animator';
import { Brain } from './AI';
import { ACCURACY, COMBAT, HITBOX, MOVE, RAGDOLL, SKELETON as S, type ArchetypeDef } from './EnemyDefs';
import { bulletDamage, shotOffset, type AccuracyInput } from './Accuracy';
import { Ragdoll } from './Ragdoll';
import { B, BONE_NAMES, JOINT, createSoldier, type SoldierRig } from './SoldierModel';
import { materialsFor, TINT_COUNT } from './Materials';
import type { EnemyWorld } from './AI';
import { damp } from './Gait';

interface Hitbox { bone: number; part: BodyPart; body: RAPIER.RigidBody; collider: RAPIER.Collider; offset: THREE.Vector3 }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Enemy {
  readonly rig: SoldierRig;
  readonly anim: Animator;
  readonly brain: Brain;
  readonly rng: Rng;
  health: number;
  alive = true;
  /** ground position (feet) */
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  kcc!: RAPIER.KinematicCharacterController;
  hitboxes: Hitbox[] = [];
  ragdoll: Ragdoll | null = null;
  deadTime = 0;
  removeMe = false;
  /** animation intent, written by the brain */
  target: AnimTarget = { moveVel: new THREE.Vector3(), yaw: 0, aimDir: new THREE.Vector3(0, 0, -1), aim: 0, crouch: 0, lean: 0, sprint: 0, reload: -1, hide: 0 };
  desiredVel = new THREE.Vector3();
  speedCap = MOVE.walkSpeed;
  ammo = COMBAT.magSize;
  reloadT = -1;
  lastFireTime = -10;
  shotsFired = 0;
  stuckTimer = 0;
  private progressPos = new THREE.Vector3();
  private progressT = 0;
  private wantedMove = 0;
  private headOffset = new THREE.Vector3(0, 0.1, 0);
  readonly headPos = new THREE.Vector3();
  private lastHit = { point: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), part: B.spine2 };

  constructor(readonly engine: Engine, readonly id: number, readonly archetype: ArchetypeDef, spawn: THREE.Vector3, readonly world: EnemyWorld) {
    this.rng = new Rng(1000 + id * 7919);
    this.rig = createSoldier(archetype.id, materialsFor(engine, archetype.id, id % TINT_COUNT));
    this.anim = new Animator(this.rig, id * 1.37);
    this.health = archetype.health;
    this.pos.copy(spawn); this.prevPos.copy(spawn);
    engine.scene.add(this.rig.root);
    this.createPhysics();
    this.brain = new Brain(this, world);
    // face away from origin-ish by default: look toward the player if any
    const p = world.player;
    if (p) this.yaw = Math.atan2(-(p.position.x - spawn.x), -(p.position.z - spawn.z));
    this.target.yaw = this.yaw;
    this.target.aimDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.anim.snap(this.pos, this.target);
    this.syncHitboxes(true);
  }

  private createPhysics(): void {
    const p = this.engine.physics; const R = p.R;
    const c = this.pos;
    const bodyY = c.y + MOVE.capsuleHalfHeight + MOVE.capsuleRadius;
    this.body = p.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, bodyY, c.z));
    // membership 0: nothing collides with / raycasts against the movement capsule; the hitboxes are the physical presence.
    this.collider = p.world.createCollider(R.ColliderDesc.capsule(MOVE.capsuleHalfHeight, MOVE.capsuleRadius).setCollisionGroups(groups(0, CG.WORLD | CG.PLAYER)), this.body);
    this.kcc = p.world.createCharacterController(0.02);
    this.kcc.enableAutostep(MOVE.stepHeight, 0.2, true);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    const hb = (bone: number, part: BodyPart, desc: RAPIER.ColliderDesc, offset: THREE.Vector3) => {
      const body = p.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y + 1, c.z));
      const col = p.world.createCollider(desc.setCollisionGroups(groups(CG.ENEMY, CG.ALL)), body);
      p.tag(col, { surface: 'flesh', enemyId: this.id, bodyPart: part });
      this.hitboxes.push({ bone, part, body, collider: col, offset });
    };
    const cap = (r: number, len: number) => R.ColliderDesc.capsule(Math.max(0.01, len / 2 - r), r);
    const half = (child: number, bone: number) => new THREE.Vector3().subVectors(JOINT[BONE_NAMES[child]], JOINT[BONE_NAMES[bone]]).multiplyScalar(0.5);
    hb(B.head, 'head', R.ColliderDesc.ball(HITBOX.head), this.headOffset);
    hb(B.spine2, 'torso', cap(HITBOX.torso.r, S.neckY - S.spine1Y), new THREE.Vector3(0, (S.neckY - S.spine2Y) / 2 - 0.03, 0));
    hb(B.hips, 'torso', R.ColliderDesc.capsule(HITBOX.pelvis.half, HITBOX.pelvis.r).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }), new THREE.Vector3(0, -0.03, 0));
    hb(B.upperArmL, 'limb', cap(HITBOX.upperArm.r, S.upperArmLen), half(B.forearmL, B.upperArmL));
    hb(B.upperArmR, 'limb', cap(HITBOX.upperArm.r, S.upperArmLen), half(B.forearmR, B.upperArmR));
    hb(B.forearmL, 'limb', cap(HITBOX.forearm.r, S.forearmLen + 0.1), half(B.handL, B.forearmL).add(new THREE.Vector3(0, -0.05, 0)));
    hb(B.forearmR, 'limb', cap(HITBOX.forearm.r, S.forearmLen + 0.1), half(B.handR, B.forearmR).add(new THREE.Vector3(0, -0.05, 0)));
    hb(B.thighL, 'limb', cap(HITBOX.thigh.r, S.thighLen), half(B.shinL, B.thighL));
    hb(B.thighR, 'limb', cap(HITBOX.thigh.r, S.thighLen), half(B.shinR, B.thighR));
    hb(B.shinL, 'limb', cap(HITBOX.shin.r, S.shinLen + 0.08), half(B.footL, B.shinL).add(new THREE.Vector3(0, -0.04, 0)));
    hb(B.shinR, 'limb', cap(HITBOX.shin.r, S.shinLen + 0.08), half(B.footR, B.shinR).add(new THREE.Vector3(0, -0.04, 0)));
  }

  syncHitboxes(teleport = false): void {
    const wp = this.anim.wp, wq = this.anim.wq;
    for (const h of this.hitboxes) {
      const q = wq[h.bone];
      const c = _v.copy(h.offset).applyQuaternion(q).add(wp[h.bone]);
      if (teleport) { h.body.setTranslation(c, true); h.body.setRotation(q, true); }
      h.body.setNextKinematicTranslation(c);
      h.body.setNextKinematicRotation(q);
    }
    this.headPos.copy(this.headOffset).applyQuaternion(wq[B.head]).add(wp[B.head]);
  }

  get eye(): THREE.Vector3 { return this.headPos; }
  get crouching(): boolean { return this.target.crouch > 0.5; }
  get moving(): boolean { return this.vel.lengthSq() > 0.25; }

  /** Physics/gameplay tick. */
  fixedUpdate(dt: number): void {
    if (!this.alive) {
      this.deadTime += dt;
      this.ragdoll?.fixedUpdate(dt);
      if (this.deadTime > RAGDOLL.lifetime) this.removeMe = true;
      return;
    }
    this.prevPos.copy(this.pos);
    this.brain.think(dt);
    this.move(dt);
    this.tickWeapon(dt);
    this.syncHitboxes();
  }

  private move(dt: number): void {
    const dv = this.desiredVel;
    const want = _v.set(dv.x, 0, dv.z);
    const wl = want.length();
    if (wl > this.speedCap) want.multiplyScalar(this.speedCap / wl);
    const rate = wl > 0.01 ? MOVE.accel : MOVE.decel;
    this.vel.x = damp(this.vel.x, want.x, rate, dt);
    this.vel.z = damp(this.vel.z, want.z, rate, dt);
    this.vel.y = Math.max(this.vel.y - MOVE.gravity * dt, -20);
    const mv = _v2.copy(this.vel).multiplyScalar(dt);
    this.kcc.computeColliderMovement(this.collider, mv, undefined, groups(CG.ENEMY, CG.WORLD | CG.PLAYER));
    const out = this.kcc.computedMovement();
    this.pos.x += out.x; this.pos.y += out.y; this.pos.z += out.z;
    if (this.kcc.computedGrounded()) this.vel.y = Math.max(this.vel.y, 0);
    // level bounds safety net
    const bnd = this.world.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, bnd.min.x + 1, bnd.max.x - 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, bnd.min.z + 1, bnd.max.z - 1);
    if (this.pos.y < bnd.min.y) { this.pos.y = bnd.min.y + 1; this.vel.y = 0; }
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z)) { this.pos.copy(this.prevPos); this.vel.set(0, 0, 0); }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + MOVE.capsuleHalfHeight + MOVE.capsuleRadius, z: this.pos.z });
    // stuck detection: wanted to move but made no real progress over the last second (sliding along a wall counts as stuck)
    this.progressT += dt;
    if (this.progressT >= 1) {
      const moved = Math.hypot(this.pos.x - this.progressPos.x, this.pos.z - this.progressPos.z);
      if (this.wantedMove > 0.5 && moved < MOVE.stuckSpeed) this.stuckTimer += this.progressT; else this.stuckTimer = 0;
      this.progressPos.copy(this.pos); this.progressT = 0; this.wantedMove = 0;
    }
    this.wantedMove = Math.max(this.wantedMove, wl);
    this.target.moveVel.copy(this.vel);
    this.target.yaw = this.yaw;
  }

  /** Turn the body toward a world yaw (instant; the animator damps it). */
  face(yaw: number): void { this.yaw = yaw; }
  faceDir(dir: THREE.Vector3): void { if (dir.lengthSq() > 1e-6) this.yaw = Math.atan2(-dir.x, -dir.z); }
  facePoint(p: THREE.Vector3): void { this.faceDir(_v3.subVectors(p, this.pos)); }

  // ---------------- weapon ----------------
  burst = 0; nextShot = 0; burstPause = 0;
  timeOnTarget = 0;

  startReload(): void {
    if (this.reloadT >= 0) return;
    this.reloadT = 0;
    this.world.audio?.play('enemy_callout_reload', { position: this.headPos });
    this.world.audio?.play('enemy_reload', { position: this.headPos });
  }
  get reloading(): boolean { return this.reloadT >= 0; }

  private tickWeapon(dt: number): void {
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      this.target.reload = this.reloadT / COMBAT.reloadTime;
      if (this.reloadT >= COMBAT.reloadTime) { this.reloadT = -1; this.ammo = COMBAT.magSize; this.target.reload = -1; }
    } else this.target.reload = -1;
    if (this.burstPause > 0) this.burstPause -= dt;
    if (this.nextShot > 0) this.nextShot -= dt;
  }

  /** Called by the brain while it wants to shoot at `aimPoint`. Handles burst cadence. */
  fireAt(aimPoint: THREE.Vector3, dt: number, burstLen: number, suppress: boolean): void {
    if (this.reloading || this.ammo <= 0) { if (this.ammo <= 0) this.startReload(); return; }
    if (this.anim.aim < 0.55) return;
    if (this.burstPause > 0) return;
    if (this.burst <= 0) { this.burst = Math.max(1, Math.min(burstLen, this.ammo)); }
    if (this.nextShot > 0) return;
    this.shoot(aimPoint, suppress);
    this.burst--; this.nextShot = COMBAT.fireInterval;
    if (this.burst <= 0) this.burstPause = this.rng.range(COMBAT.burstPauseMin, COMBAT.burstPauseMax) * (suppress ? 1.6 : 1);
    void dt;
  }

  private shoot(aimPoint: THREE.Vector3, suppress: boolean): void {
    const w = this.world; const p = w.player;
    const muzzle = this.anim.muzzleWorld;
    const dist = muzzle.distanceTo(aimPoint);
    const input: AccuracyInput = {
      distance: dist, timeOnTarget: this.timeOnTarget, shooterMoving: this.moving, targetSprinting: !!p?.sprinting, targetCrouching: !!p?.crouching,
      accuracyMul: this.archetype.accuracyMul * w.difficulty.accuracy * (suppress ? 0.25 : 1),
    };
    const so = shotOffset(input, this.rng.next(), this.rng.next(), this.rng.next(), this.rng.next());
    const dir = _v.subVectors(aimPoint, muzzle).normalize();
    const right = _v2.crossVectors(dir, UP).normalize();
    const up = _v3.crossVectors(right, dir).normalize();
    if (!so.aimed) dir.copy(aimPoint).addScaledVector(right, so.missX).addScaledVector(up, so.missY).sub(muzzle).normalize();
    const spread = so.spread + (suppress ? COMBAT.suppressSpread : 0);
    dir.addScaledVector(right, this.rng.gauss() * spread).addScaledVector(up, this.rng.gauss() * spread).normalize();
    const hit = this.engine.physics.raycast(muzzle, dir, COMBAT.maxRange, groups(CG.ENEMY, CG.WORLD | CG.PLAYER));
    const origin: [number, number, number] = [muzzle.x, muzzle.y, muzzle.z];
    let hitPlayer = false;
    const end = new THREE.Vector3();
    if (hit) {
      end.set(hit.point[0], hit.point[1], hit.point[2]);
      if (hit.userData.tag === 'player' && p) {
        hitPlayer = true;
        const dmg = bulletDamage(COMBAT.damageMin, COMBAT.damageMax, dist, this.rng.next(), w.difficulty.damage);
        p.damage(dmg, muzzle.clone());
      } else {
        const n = new THREE.Vector3(hit.normal[0], hit.normal[1], hit.normal[2]);
        w.fx?.impact(end, n, hit.userData.surface ?? 'concrete', dir.clone());
        this.engine.events.emit('hit:surface', { point: [end.x, end.y, end.z], normal: [n.x, n.y, n.z], surface: hit.userData.surface ?? 'concrete', dir: [dir.x, dir.y, dir.z] });
      }
    } else end.copy(muzzle).addScaledVector(dir, COMBAT.maxRange);
    this.ammo--; this.shotsFired++; this.lastFireTime = w.time;
    this.anim.recoil();
    w.fx?.muzzleFlash(muzzle.clone(), dir.clone(), 1);
    w.fx?.tracer(muzzle.clone(), end);
    w.fx?.shell?.(muzzle.clone().addScaledVector(dir, -0.45).add(new THREE.Vector3(0, 0.05, 0)), right.clone().multiplyScalar(2.5).add(new THREE.Vector3(0, 1.5, 0)), 'rifle');
    w.audio?.play('enemy_fire_ak', { position: muzzle.clone() });
    this.engine.events.emit('enemy:fire', { enemyId: this.id, origin, dir: [dir.x, dir.y, dir.z], hitPlayer });
  }

  // ---------------- damage / death ----------------
  applyDamage(amount: number, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, part: BodyPart): number {
    if (!this.alive) {
      this.ragdoll?.impulse(point, RAGDOLL.hitImpulse * 0.4, 0.6);
      return 0;
    }
    const mul = part === 'head' ? HITBOX.headshotMul : part === 'limb' ? HITBOX.limbMul : 1;
    const dmg = Math.round(amount * mul);
    this.health -= dmg;
    this.anim.hit(part, dir, point, Math.min(1.5, dmg / 40 + 0.4));
    this.brain.onDamaged(point, dir);
    this.world.fx?.bloodHit(point.clone(), normal.clone(), dir.clone(), dmg > 40 || part === 'head');
    this.lastHit.point.copy(point); this.lastHit.dir.copy(dir);
    this.lastHit.part = part === 'head' ? B.head : part === 'torso' ? B.spine2 : B.thighL;
    if (this.health <= 0) this.die(part === 'head', dir, point);
    return dmg;
  }

  applyExplosion(center: THREE.Vector3, radius: number, damage: number): void {
    const d = this.pos.distanceTo(center);
    if (d > radius) { this.ragdoll?.impulse(center, RAGDOLL.hitImpulse * 2, radius * 1.5); return; }
    const frac = 1 - d / radius;
    const dir = _v.subVectors(this.pos, center).setY(0.5).normalize();
    if (!this.alive) { this.ragdoll?.impulse(center, RAGDOLL.hitImpulse * 3, radius * 1.5); return; }
    const dmg = Math.round(damage * (0.3 + 0.7 * frac));
    this.health -= dmg;
    this.anim.hit('torso', dir, this.pos, 1.5);
    this.world.fx?.bloodHit(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), UP.clone(), dir.clone(), true);
    if (this.health <= 0) this.die(false, dir.clone().multiplyScalar(2.5 * (0.5 + frac)), this.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
  }

  die(headshot: boolean, dir: THREE.Vector3, point: THREE.Vector3): void {
    if (!this.alive) return;
    this.alive = false;
    this.deadTime = 0;
    this.brain.state = 'dead';
    this.world.claims.delete(this.id);
    const p = this.engine.physics;
    for (const h of this.hitboxes) { p.untag(h.collider); p.world.removeRigidBody(h.body); }
    this.hitboxes = [];
    p.world.removeCharacterController(this.kcc);
    p.world.removeRigidBody(this.body);
    const impulse = dir.clone().normalize().multiplyScalar(RAGDOLL.hitImpulse).add(new THREE.Vector3(0, 6, 0));
    this.ragdoll = new Ragdoll(p, this.rig, this.anim, this.id, this.vel.clone(), impulse, point, this.lastHit.part);
    this.ragdoll.onPool = (at, size) => this.world.fx?.decal(at, UP, 'blood', size);
    this.world.audio?.play('enemy_death', { position: this.headPos.clone() });
    this.engine.events.emit('enemy:death', { enemyId: this.id, position: [this.pos.x, this.pos.y, this.pos.z], headshot });
  }

  /** Per-frame visual update. */
  update(dt: number, alpha: number): void {
    const blob = this.rig.blob;
    if (this.ragdoll) {
      this.ragdoll.sync(dt);
      // contact shadow follows the torso on the ground, widens as the body lies flat
      this.ragdoll.centre(_v).sub(this.rig.root.position);
      blob.position.set(_v.x, 0.012, _v.z).applyQuaternion(_q.copy(this.rig.root.quaternion).invert());
      blob.position.y = 0.012;
      // A corpse already lies in its own cast shadow, so the fake contact blob only has to darken
      // the ground it touches. At 1.5x it read as a black puddle spreading past the body.
      blob.scale.setScalar(damp(blob.scale.x, 1.05, 2, dt));
      // sink and fade near the end of the ragdoll's life
      const left = RAGDOLL.lifetime - this.deadTime;
      if (left < RAGDOLL.fadeTime) this.rig.root.position.y -= (RAGDOLL.fadeTime - left) * 0.3 * dt * 4;
      return;
    }
    _v.lerpVectors(this.prevPos, this.pos, alpha);
    this.anim.update(dt, _v, this.target);
    // contact shadow under the hips, shrinking slightly when crouched (body is closer to the ground => tighter, darker)
    const hips = this.anim.wp[B.hips];
    blob.position.set(hips.x - _v.x, 0.012, hips.z - _v.z).applyQuaternion(_q.copy(this.rig.root.quaternion).invert());
    blob.position.y = 0.012;
    blob.scale.setScalar(1 - 0.15 * this.anim.crouch);
  }

  dispose(): void {
    const p = this.engine.physics;
    if (this.alive) {
      for (const h of this.hitboxes) { p.untag(h.collider); p.world.removeRigidBody(h.body); }
      p.world.removeCharacterController(this.kcc);
      p.world.removeRigidBody(this.body);
    }
    this.ragdoll?.dispose(); this.ragdoll = null;
    this.engine.scene.remove(this.rig.root);
    this.rig.skeleton.dispose();
    this.world.claims.delete(this.id);
  }
}

export type { PlayerApi, FxApi, AudioApi };
export { ACCURACY };
