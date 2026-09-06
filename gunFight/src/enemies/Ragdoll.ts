/**
 * Ragdoll: Rapier dynamic bodies (gravity, CCD, contact with the level) whose skeleton is held
 * together by a small position-based solver in this file rather than by Rapier joints.
 *
 * Rapier's spherical joints have no angular limits, so the previous version bolted an angle clamp
 * on top of them: it rotated a body about its centre of mass, which tore the joint anchor apart,
 * and Rapier's joint solver then converted that error back into velocity. The two fought every
 * frame and the corpse ended up in poses no body can hold — an elbow past 180 degrees, a shin
 * through a thigh, a knee at road level. Having two authorities for one constraint is the bug, so
 * there is now exactly one: no impulse joints, and every step (before the world steps) an XPBD
 * pass projects, in `solverIterations` Gauss-Seidel sweeps:
 *
 *  1. joint anchors — a ball constraint with the full rotational Jacobian, so a limb swings about
 *     its joint like a pendulum instead of sliding.
 *  2. joint angle limits — the relative rotation is decomposed into the direction the child bone
 *     points plus the twist about it, then clamped to a per-joint anatomical box (JOINT_LIMITS).
 *     Hinges get a near-zero lateral box, so an elbow or knee can only bend the way a real one
 *     does and a shin can no longer swing through its own thigh.
 *  3. ground — every collider's lowest point is kept at or above the plane the enemy died on.
 *  4. self-collision — limb capsules of the same body are separated analytically. Rapier contacts
 *     cannot do this job: adjacent capsules touch by construction at every joint (thigh and shin
 *     share the knee), so contacts there fight the joint forever, and at spawn the forearms sit
 *     inside the chest capsule, so group self-collision would detonate the corpse on frame 1. This
 *     pass handles every non-adjacent pair with a spawn-overlap allowance that relaxes away over
 *     `selfSlackTime`.
 *
 * Velocities are then updated from the total projection (post-stabilisation) and capped, so a
 * point-blank headshot impulse cannot spin a 5 kg head at 130 rad/s. Bodies are damped hard after
 * `settleTime` so the corpse comes to rest instead of twitching, and a blood pool decal grows under
 * the torso. Bones are driven from the bodies every frame; bones without a body (spine links,
 * clavicles, hands, eyes) inherit the rotation of their driving body.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import { CG, groups } from '../core/Physics';
import { HITBOX, JOINT_LIMITS, RAGDOLL, SKELETON as S, type JointLimit } from './EnemyDefs';
import type { Animator } from './Animator';
import { B, BONE_NAMES, JOINT, PARENT, type SoldierRig } from './SoldierModel';

interface Part {
  name: string;
  bone: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** vector from bone origin to body centre, in bone-local space */
  offset: THREE.Vector3;
  /** bones whose rotation copies this part */
  followers: number[];
  invMass: number;
  /** scalar inverse inertia (m * k^2 with k the radius of gyration) — good enough for a corpse */
  invI: number;
  /** half-extents of the collider in its own local frame (capsule axis, or box half sizes) */
  ext: THREE.Vector3;
  /** capsule/ball radius added around `ext` (0 for the boot boxes) */
  radius: number;
  /** local half-segment used by the self-collision pass (capsule axis * half length) */
  seg: THREE.Vector3;
  /** Extra body-local points whose `shellR` sphere must also stay above the road. The colliders are
   *  crude (the head is one ball); these are the places where the *rendered* mesh sticks out past
   *  the collider — the helmet crown, the chin — and they are what actually has to clear the
   *  asphalt for the corpse to read. Empty for everything but the head. */
  shell: THREE.Vector3[];
  shellR: number;
  /** working copies, so the solver never round-trips through wasm */
  p: THREE.Vector3;
  q: THREE.Quaternion;
  /** pose at the start of the step, so velocities can be updated from the total projection */
  p0: THREE.Vector3;
  q0: THREE.Quaternion;
}

interface Limit {
  name: string;
  parent: Part; child: Part;
  /** joint anchor in the parent's / child's body-local frame */
  la: THREE.Vector3; lb: THREE.Vector3;
  lim: JointLimit;
  /** last measured swing/twist, exposed for tests */
  fx: number; fz: number; tw: number;
  /** radians of *swing* outside the box on the last step (0 = inside) */
  over: number;
  /** radians of twist (roll about the bone) outside the box — measured, but not what drives refinement */
  overTw: number;
  /** world axis of the last correction, used to kill the outward angular velocity */
  axis: THREE.Vector3;
  /** false when the bone is folded so far back that the twist reading is degenerate */
  twValid: boolean;
  /** Optional resting pose (swing/twist, radians) the joint is weakly driven toward once the body
   *  is settling. Only the neck uses it: see `neckRest`. */
  rest: { fx: number; fz: number; tw: number } | null;
}

interface SelfPair { a: Part; b: Part; slack: number }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _r = new THREE.Vector3(), _r2 = new THREE.Vector3();
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const TAU = Math.PI * 2;
const NEG_Y = new THREE.Vector3(0, -1, 0);

/** Clamp helper. */
const cl = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class Ragdoll {
  parts: Part[] = [];
  joints: RAPIER.ImpulseJoint[] = [];
  limits: Limit[] = [];
  age = 0;
  /** called with (ground point, size) when the blood pool should grow */
  onPool: ((p: THREE.Vector3, size: number) => void) | null = null;
  private poolStage = 0;
  private settled = false;
  private groundY: number;
  private bones: THREE.Bone[];
  private wp: THREE.Vector3[]; private wq: THREE.Quaternion[];
  private chest: Part;
  private selfPairs: SelfPair[] = [];
  private pendingDt = 0;
  private byBone = new Map<number, Part>();
  /** 0 during the fall, ramping to 1 as the body settles: how much of the neck rest pose applies. */
  private restBlend = 0;

  constructor(private physics: Physics, private rig: SoldierRig, anim: Animator, enemyId: number, velocity: THREE.Vector3, impulse: THREE.Vector3, hitPoint: THREE.Vector3, hitPart: number) {
    this.bones = rig.bones;
    this.wp = anim.wp; this.wq = anim.wq;
    this.groundY = rig.root.position.y;
    const R = physics.R; const world = physics.world;
    // Ragdolls collide with the level and debris only: same-body limb contacts are handled by
    // solveSelf() (see the header), and corpse-vs-corpse contact is not worth the instability.
    const filter = groups(CG.RAGDOLL, CG.WORLD | CG.DEBRIS);
    const mk = (name: string, bone: number, shape: RAPIER.ColliderDesc, offset: THREE.Vector3, ext: THREE.Vector3, radius: number, seg: THREE.Vector3, followers: number[], density = RAGDOLL.density, shell: THREE.Vector3[] = [], shellR = 0) => {
      const p = this.wp[bone], q = this.wq[bone];
      const c = _v.copy(offset).applyQuaternion(q).add(p);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(velocity.x, velocity.y, velocity.z).setLinearDamping(RAGDOLL.linearDamping).setAngularDamping(RAGDOLL.angularDamping).setCcdEnabled(true));
      const col = world.createCollider(shape.setCollisionGroups(filter).setFriction(RAGDOLL.friction).setDensity(density).setRestitution(0.02), body);
      physics.tag(col, { surface: 'flesh', enemyId, bodyPart: 'torso' });
      const part: Part = {
        name, bone, body, collider: col, offset: offset.clone(), followers, shell, shellR,
        invMass: 1 / Math.max(0.05, body.mass()), invI: 0, ext: ext.clone(), radius, seg: seg.clone(),
        p: new THREE.Vector3(c.x, c.y, c.z), q: q.clone(),
        p0: new THREE.Vector3(c.x, c.y, c.z), q0: q.clone(),
      };
      // radius of gyration from the collider extents; a capsule/box is close enough to a corpse limb
      part.invI = part.invMass / Math.max(0.0025, ext.lengthSq() / 3 + radius * radius * 0.4 + 0.0016);
      this.parts.push(part);
      this.byBone.set(bone, part);
      return part;
    };
    const capHalf = (r: number, len: number) => Math.max(0.01, len / 2 - r);
    const cap = (r: number, len: number) => R.ColliderDesc.capsule(capHalf(r, len), r);
    /** capsule along the bone's -Y axis: ext/seg carry the half length so the solver knows the shape */
    const capY = (r: number, len: number) => ({ ext: new THREE.Vector3(0, capHalf(r, len), 0), r, seg: new THREE.Vector3(0, capHalf(r, len), 0) });
    const half = (child: number, bone: number) => new THREE.Vector3().subVectors(JOINT[BONE_NAMES[child]], JOINT[BONE_NAMES[bone]]).multiplyScalar(0.5);

    const hipsShape = { ext: new THREE.Vector3(0.06, 0, 0), r: HITBOX.pelvis.r, seg: new THREE.Vector3(0.06, 0, 0) };
    const hips = mk('hips', B.hips, R.ColliderDesc.capsule(0.06, HITBOX.pelvis.r).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }),
      new THREE.Vector3(0, -0.02, 0), hipsShape.ext, hipsShape.r, hipsShape.seg, [], RAGDOLL.density * 1.1);
    const chestS = capY(HITBOX.torso.r, S.neckY - S.spine1Y);
    const chest = mk('chest', B.spine2, cap(HITBOX.torso.r, S.neckY - S.spine1Y).setRotation({ x: 0, y: 0, z: 0, w: 1 }),
      new THREE.Vector3(0, (S.neckY - S.spine2Y) / 2 - 0.02, 0), chestS.ext, chestS.r, chestS.seg, [B.spine1, B.chest, B.neck, B.clavL, B.clavR], RAGDOLL.density * 0.9);
    this.chest = chest;
    // the eye bones are deliberately NOT followers: a corpse keeps the gaze it died with rather
    // than snapping both eyes back to dead ahead.
    // HITBOX.head (0.12) is the *hit* sphere — the bare skull, and what a headshot has to touch.
    // The thing that has to sit on the road is the helmet, which is 2.5 cm bigger and reaches
    // 22 cm up the bone. Sizing the corpse's collider off the hitbox is what buried the head:
    // a 0.12 ball rests with its centre 12 cm up, the neck sits 19 cm up on a 0.19 torso capsule,
    // so the only way for the ball to reach the road was to nod the head 46 deg — face into the
    // asphalt, helmet under it, and the whole head tucked behind the plate carrier.
    const headR = RAGDOLL.headRadius;
    const headShell = [new THREE.Vector3(0, RAGDOLL.headCrown - 0.1, 0), new THREE.Vector3(0, RAGDOLL.headChin - 0.1, 0)];
    const head = mk('head', B.head, R.ColliderDesc.ball(headR), new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(), headR, new THREE.Vector3(), [], RAGDOLL.density * 0.8, headShell, RAGDOLL.headShellRadius);
    const uaS = capY(HITBOX.upperArm.r, S.upperArmLen), faS = capY(HITBOX.forearm.r, S.forearmLen + 0.1);
    const thS = capY(HITBOX.thigh.r, S.thighLen), shS = capY(HITBOX.shin.r, S.shinLen);
    const uaL = mk('upperArmL', B.upperArmL, cap(HITBOX.upperArm.r, S.upperArmLen), half(B.forearmL, B.upperArmL), uaS.ext, uaS.r, uaS.seg, []);
    const uaR = mk('upperArmR', B.upperArmR, cap(HITBOX.upperArm.r, S.upperArmLen), half(B.forearmR, B.upperArmR), uaS.ext, uaS.r, uaS.seg, []);
    const faL = mk('forearmL', B.forearmL, cap(HITBOX.forearm.r, S.forearmLen + 0.1), half(B.handL, B.forearmL).add(new THREE.Vector3(0, -0.05, 0)), faS.ext, faS.r, faS.seg, [B.handL]);
    const faR = mk('forearmR', B.forearmR, cap(HITBOX.forearm.r, S.forearmLen + 0.1), half(B.handR, B.forearmR).add(new THREE.Vector3(0, -0.05, 0)), faS.ext, faS.r, faS.seg, [B.handR]);
    const thL = mk('thighL', B.thighL, cap(HITBOX.thigh.r, S.thighLen), half(B.shinL, B.thighL), thS.ext, thS.r, thS.seg, []);
    const thR = mk('thighR', B.thighR, cap(HITBOX.thigh.r, S.thighLen), half(B.shinR, B.thighR), thS.ext, thS.r, thS.seg, []);
    const shL = mk('shinL', B.shinL, cap(HITBOX.shin.r, S.shinLen), half(B.footL, B.shinL), shS.ext, shS.r, shS.seg, []);
    const shR = mk('shinR', B.shinR, cap(HITBOX.shin.r, S.shinLen), half(B.footR, B.shinR), shS.ext, shS.r, shS.seg, []);
    const footExt = new THREE.Vector3(0.048, 0.035, 0.14);
    const ftL = mk('footL', B.footL, R.ColliderDesc.cuboid(footExt.x, footExt.y, footExt.z), new THREE.Vector3(0, -0.045, -0.06), footExt, 0, new THREE.Vector3(0, 0, 0.1), [], RAGDOLL.density * 0.8);
    const ftR = mk('footR', B.footR, R.ColliderDesc.cuboid(footExt.x, footExt.y, footExt.z), new THREE.Vector3(0, -0.045, -0.06), footExt, 0, new THREE.Vector3(0, 0, 0.1), [], RAGDOLL.density * 0.8);
    const rifle = mk('rifle', B.rifle, R.ColliderDesc.cuboid(0.03, 0.06, 0.45), new THREE.Vector3(0, 0.02, -0.2), new THREE.Vector3(0.03, 0.06, 0.45), 0, new THREE.Vector3(0, 0, 0.39), [], RAGDOLL.density * 0.5);
    rifle.body.setAngularDamping(1.2); rifle.body.setLinearDamping(0.25);
    // rifle: not connected; it drops out of the hands with a little spin instead of being launched
    {
      const m = rifle.body.mass();
      rifle.body.applyImpulse({ x: velocity.x * 0.25 * m, y: 0.35 * m, z: velocity.z * 0.25 * m }, true);
      rifle.body.setAngvel({ x: 1.4, y: -2.1, z: 0.8 }, true);
    }

    const L = JOINT_LIMITS;
    // No Rapier impulse joint: solveAnchor() is the only thing holding the skeleton together, so
    // nothing can disagree with the angle limits.
    const link = (name: string, a: Part, b: Part, jointBone: number, lim: JointLimit) => {
      const jw = this.wp[jointBone];
      this.limits.push({ name, parent: a, child: b, la: this.localOf(a, jw), lb: this.localOf(b, jw), lim, fx: 0, fz: 0, tw: 0, over: 0, overTw: 0, axis: new THREE.Vector3(), twValid: true, rest: null });
    };
    // parent-first order: the solver is Gauss-Seidel down the tree
    link('spine', hips, chest, B.spine1, L.spine);
    link('neck', chest, head, B.head, L.neck);
    // A ball collider cannot generate ground torque, so the head keeps whatever angle gravity last
    // nodded it to — and on a supine body that is straight down, face into the road. Real corpses
    // loll: the head rolls onto the side of the helmet with the face turned. Drive the neck weakly
    // toward that once the body is settling (see `restBlend`); the side is seeded off the enemy id
    // so a street of bodies is not a rank of identical heads.
    {
      const side = (enemyId & 1) ? 1 : -1;
      const r = RAGDOLL.neckRest;
      this.limits[this.limits.length - 1].rest = { fx: r.fx, fz: side * r.fz, tw: side * r.tw };
    }
    link('shoulderL', chest, uaL, B.upperArmL, L.shoulderL);
    link('elbowL', uaL, faL, B.forearmL, L.elbow);
    link('shoulderR', chest, uaR, B.upperArmR, L.shoulderR);
    link('elbowR', uaR, faR, B.forearmR, L.elbow);
    link('hipL', hips, thL, B.thighL, L.hipL);
    link('kneeL', thL, shL, B.shinL, L.knee);
    link('ankleL', shL, ftL, B.footL, L.ankle);
    link('hipR', hips, thR, B.thighR, L.hipR);
    link('kneeR', thR, shR, B.shinR, L.knee);
    link('ankleR', shR, ftR, B.footR, L.ankle);

    // self-collision pairs: every limb/torso pair that is not directly jointed
    const jointed = new Set(this.limits.map((l) => `${l.parent.name}|${l.child.name}`));
    const solid = this.parts.filter((p) => p.bone !== B.rifle);
    for (let i = 0; i < solid.length; i++) for (let k = i + 1; k < solid.length; k++) {
      const a = solid[i], b = solid[k];
      if (jointed.has(`${a.name}|${b.name}`) || jointed.has(`${b.name}|${a.name}`)) continue;
      // parts joined through a single link (foot/thigh via the shin) still collide; only the direct
      // pair is skipped. Record how deep they already overlap so the fix-up is a push, not a pop.
      const d = this.pairDistance(a, b);
      this.selfPairs.push({ a, b, slack: Math.max(0, a.radius + b.radius - d) });
    }

    // apply the killing impulse to the closest part
    let best = this.parts[1], bd = Infinity;
    for (const p of this.parts) { if (p.bone === B.rifle) continue; const t = p.body.translation(); const d = (t.x - hitPoint.x) ** 2 + (t.y - hitPoint.y) ** 2 + (t.z - hitPoint.z) ** 2; if (d < bd) { bd = d; best = p; } }
    if (hitPart === B.head) best = head;
    const mul = best === head ? RAGDOLL.headImpulseMul : 1;
    best.body.applyImpulseAtPoint({ x: impulse.x * mul, y: impulse.y * mul, z: impulse.z * mul }, { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z }, true);
    chest.body.applyImpulse({ x: impulse.x * 0.3, y: impulse.y * 0.3, z: impulse.z * 0.3 }, true);
    // knees buckle: a downward nudge on the hips so the body folds rather than falling like a plank
    hips.body.applyImpulse({ x: 0, y: -RAGDOLL.hitImpulse * 0.5, z: 0 }, true);
    // and a small forward pitch so the torso goes down rather than staying upright over the hips
    chest.body.applyTorqueImpulse({ x: impulse.z > 0 ? 2.2 : -2.2, y: 0, z: 0 }, true);
    this.clampSpawnVelocity();
    // The animator's last pose is not guaranteed to satisfy the boxes — a deep crouch over-flexes
    // the ankle, and a sprinting soldier's IK rolls the forearm past any hinge's twist range — so
    // frame zero is snapped *hard* into the boxes before the iterative passes run. The sweep alone
    // is not enough: from a badly wound pose it converges too slowly, the body falls with the wind
    // still in it, and a second later an elbow is folded 148 deg with the forearm rolled 109 deg.
    this.snapToBox();
    this.read();
    for (let k = 0; k < RAGDOLL.solverIterations; k++) {
      for (const l of this.limits) { this.solveAnchor(l); this.solveAngular(l); }
      this.solveGround();
    }
    this.write();
    this.measureLimits();
    this.limitVelocities(1 / 60);
  }

  /**
   * One-shot exact projection of the whole chain, parent-first: each child is rotated to the
   * nearest orientation inside its joint box and then translated so its anchor meets its parent's.
   * Non-iterative and order-independent down the tree, so the result satisfies every angle box and
   * every anchor exactly — which the Gauss-Seidel sweep only approaches.
   */
  private snapToBox(): void {
    this.read();
    for (const l of this.limits) {
      const lim = l.lim;
      _q.copy(l.parent.q).invert().multiply(l.child.q);
      if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
      const d = _v.set(0, -1, 0).applyQuaternion(_q);
      const fz = Math.asin(cl(d.x, -1, 1));
      const fx = Math.atan2(-d.z, -d.y);
      _q2.setFromUnitVectors(NEG_Y, d);
      _q3.copy(_q2).invert().multiply(_q);
      if (_q3.w < 0) { _q3.x = -_q3.x; _q3.y = -_q3.y; _q3.z = -_q3.z; _q3.w = -_q3.w; }
      let tw = 2 * Math.atan2(-_q3.y, _q3.w);
      if (tw > Math.PI) tw -= TAU; else if (tw < -Math.PI) tw += TAU;
      let ux = fx;
      if (ux < lim.fx[0] && (ux + TAU) - lim.fx[1] < lim.fx[0] - ux) ux += TAU;
      else if (ux > lim.fx[1] && lim.fx[0] - (ux - TAU) < ux - lim.fx[1]) ux -= TAU;
      const cx = cl(ux, lim.fx[0], lim.fx[1]), cz = cl(fz, lim.fz[0], lim.fz[1]), ct = cl(tw, lim.tw[0], lim.tw[1]);
      const ca = Math.cos(cz);
      _v2.set(Math.sin(cz), -ca * Math.cos(cx), -ca * Math.sin(cx));
      _q2.setFromUnitVectors(NEG_Y, _v2);
      _q2.multiply(_q3.setFromAxisAngle(NEG_Y, ct));
      l.child.q.copy(l.parent.q).multiply(_q2).normalize();
      // anchor: the child moves, the parent (already placed by its own link) does not
      _v3.copy(l.la).applyQuaternion(l.parent.q);
      _v4.copy(l.lb).applyQuaternion(l.child.q);
      l.child.p.set(l.parent.p.x + _v3.x - _v4.x, l.parent.p.y + _v3.y - _v4.y, l.parent.p.z + _v3.z - _v4.z);
    }
    for (const p of this.parts) { if (p.bone === B.rifle) continue; p.body.setTranslation({ x: p.p.x, y: p.p.y, z: p.p.z }, true); p.body.setRotation({ x: p.q.x, y: p.q.y, z: p.q.z, w: p.q.w }, true); }
    this.measureLimits();
  }

  /** The killing impulse lands on a light body at a lever arm; cap what it can produce. */
  private clampSpawnVelocity(): void {
    for (const p of this.parts) {
      const w = p.body.angvel(), wl = Math.hypot(w.x, w.y, w.z);
      if (wl > RAGDOLL.maxAngVel) { const s = RAGDOLL.maxAngVel / wl; p.body.setAngvel({ x: w.x * s, y: w.y * s, z: w.z * s }, true); }
      const v = p.body.linvel(), vl = Math.hypot(v.x, v.y, v.z);
      if (vl > RAGDOLL.maxLinVel) { const s = RAGDOLL.maxLinVel / vl; p.body.setLinvel({ x: v.x * s, y: v.y * s, z: v.z * s }, true); }
    }
  }

  private localOf(p: Part, worldPoint: THREE.Vector3): THREE.Vector3 {
    const t = p.body.translation(), r = p.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    return new THREE.Vector3(worldPoint.x - t.x, worldPoint.y - t.y, worldPoint.z - t.z).applyQuaternion(_q);
  }

  // ------------------------------------------------------------------------------------------
  // solver
  // ------------------------------------------------------------------------------------------

  /**
   * Pre-step bookkeeping only: settling, the blood pool, and the spawn-overlap allowance. The
   * constraint projection deliberately runs *after* the world steps (see `solve`, called from
   * `sync`) so that the pose the camera sees is the corrected one rather than one step of overshoot
   * behind it.
   */
  fixedUpdate(dt: number): void {
    this.age += dt;
    // ramp the neck rest in over the second half of the fall so it shapes the settle, never the collapse
    this.restBlend = cl((this.age - RAGDOLL.settleTime * 0.5) / RAGDOLL.neckRest.rampTime, 0, 1);
    if (!this.settled && this.age > RAGDOLL.settleTime) {
      this.settled = true;
      for (const p of this.parts) { if (p.bone === B.rifle) continue; p.body.setLinearDamping(RAGDOLL.settleLinearDamping); p.body.setAngularDamping(RAGDOLL.settleAngularDamping); }
    }
    if (this.onPool && this.poolStage < RAGDOLL.bloodPool.length && this.age > RAGDOLL.bloodPool[this.poolStage][0]) {
      // spread from under the torso toward the head, the way a pool actually runs off a body
      const t = this.chest.body.translation(), h = this.byBone.get(B.head)!.body.translation();
      const dx = h.x - t.x, dz = h.z - t.z;
      const l = Math.hypot(dx, dz) || 1;
      const k = this.poolStage * 0.12;
      this.onPool(new THREE.Vector3(t.x + (dx / l) * k, this.groundY + 0.012, t.z + (dz / l) * k), RAGDOLL.bloodPool[this.poolStage][1]);
      this.poolStage++;
    }
    const decay = dt / RAGDOLL.selfSlackTime;
    for (const s of this.selfPairs) s.slack = Math.max(0, s.slack - decay * (s.a.radius + s.b.radius));
    this.pendingDt = dt;
  }

  /** The XPBD projection. Runs post-step; `measureLimits` then records the pose that is rendered. */
  solve(dt: number): void {
    // A settled corpse is static: once Rapier has put every part to sleep there is nothing to
    // project, and skipping it is what keeps a street full of bodies off the frame budget.
    if (this.asleep()) return;
    this.read();
    for (let k = 0; k < RAGDOLL.solverIterations; k++) {
      for (const l of this.limits) { this.solveAngular(l); this.solveAnchor(l); }
      this.solveGround();
      // self-collision is the expensive pass (every non-adjacent limb pair); it only has to run
      // often enough to keep limbs apart, not on every sweep
      if (k % 3 === 2 || k === RAGDOLL.solverIterations - 1) this.solveSelf();
    }
    // a few anchor-only sweeps to close the chain: a 3 cm gap at a shoulder reads as a detached
    // limb, which is worse than the couple of degrees of angle it costs.
    for (let k = 0; k < 4; k++) for (const l of this.limits) this.solveAnchor(l);
    this.write();
    this.fixVelocities(dt);
    this.measureLimits();
    // Impact frames are over-constrained (ground vs joint stop vs 60 kg of torso) and one sweep
    // budget is not always enough. Rather than pay for the worst case every frame, refine only
    // when something is still visibly out.
    for (let extra = 0; extra < RAGDOLL.refinePasses && this.worstOver() > RAGDOLL.refineThreshold; extra++) {
      this.read();
      for (let k = 0; k < RAGDOLL.solverIterations; k++) {
        for (const l of this.limits) { this.solveAngular(l); this.solveAnchor(l); }
        this.solveGround();
        this.solveSelf();
      }
      for (let k = 0; k < 4; k++) for (const l of this.limits) this.solveAnchor(l);
      this.write();
      this.measureLimits();
    }
  }

  private worstOver(): number { let m = 0; for (const l of this.limits) m = Math.max(m, l.over); return m; }

  private asleep(): boolean {
    if (!this.settled) return false;
    for (const p of this.parts) if (!p.body.isSleeping()) return false;
    return true;
  }

  /** Pull body poses into the working copies (one wasm round-trip per part per step). */
  private read(): void {
    for (const p of this.parts) {
      const t = p.body.translation(), r = p.body.rotation();
      p.p.set(t.x, t.y, t.z); p.q.set(r.x, r.y, r.z, r.w);
      p.p0.copy(p.p); p.q0.copy(p.q);
    }
  }
  private write(): void {
    for (const p of this.parts) {
      if (p.bone === B.rifle) continue;
      const dp = Math.abs(p.p.x - p.p0.x) + Math.abs(p.p.y - p.p0.y) + Math.abs(p.p.z - p.p0.z);
      const dq = Math.abs(p.q.x - p.q0.x) + Math.abs(p.q.y - p.q0.y) + Math.abs(p.q.z - p.q0.z) + Math.abs(p.q.w - p.q0.w);
      if (dp < 1e-5 && dq < 1e-5) continue;
      // wake only for a correction big enough to matter, so a settled corpse can go to sleep
      const wake = dp > 3e-4 || dq > 3e-4;
      p.body.setTranslation({ x: p.p.x, y: p.p.y, z: p.p.z }, wake);
      p.body.setRotation({ x: p.q.x, y: p.q.y, z: p.q.z, w: p.q.w }, wake);
    }
  }

  /**
   * Apply an impulse-like positional correction `p` (magnitude and direction) at the world point
   * `r` offsets from each body centre — the XPBD rigid-body form, so the constraint rotates a body
   * as well as translating it. Without the rotational term a limb would slide off its joint rather
   * than swing about it.
   */
  private applyPair(a: Part, ra: THREE.Vector3, b: Part, rb: THREE.Vector3, n: THREE.Vector3, c: number, maxStep: number, rot = 1): void {
    // generalised inverse mass along n at each anchor
    const ia = a.invI * rot, ib = b.invI * rot;
    const ca = _v3.crossVectors(ra, n), cb = _v4.crossVectors(rb, n);
    const wa = a.invMass + ia * ca.lengthSq();
    const wb = b.invMass + ib * cb.lengthSq();
    const w = wa + wb;
    if (w < 1e-9) return;
    const lam = Math.min(c, maxStep) / w;
    _p.copy(n).multiplyScalar(lam);
    a.p.addScaledVector(_p, a.invMass);
    b.p.addScaledVector(_p, -b.invMass);
    this.spin(a, _v3.crossVectors(ra, _p).multiplyScalar(ia));
    this.spin(b, _v4.crossVectors(rb, _p).multiplyScalar(-ib));
  }

  /** q += 0.5 * (dw, 0) * q, normalised: the small-rotation quaternion update. */
  private spin(p: Part, dw: THREE.Vector3): void {
    if (dw.lengthSq() < 1e-16) return;
    const q = p.q;
    const x = 0.5 * (dw.x * q.w + dw.y * q.z - dw.z * q.y);
    const y = 0.5 * (dw.y * q.w + dw.z * q.x - dw.x * q.z);
    const z = 0.5 * (dw.z * q.w + dw.x * q.y - dw.y * q.x);
    const w = 0.5 * (-dw.x * q.x - dw.y * q.y - dw.z * q.z);
    q.set(q.x + x, q.y + y, q.z + z, q.w + w).normalize();
  }

  /**
   * Rotate two bodies apart by `ang` about `axis`, weighted by inverse inertia. Exact axis-angle
   * rather than the small-angle form: a limit correction can be a radian wide on the frame a body
   * lands, and the linearised update would be badly wrong there.
   */
  private applyTwist(a: Part, b: Part, axis: THREE.Vector3, ang: number): void {
    const w = a.invI + b.invI;
    if (w < 1e-9) return;
    a.q.premultiply(_qa.setFromAxisAngle(axis, -ang * (a.invI / w))).normalize();
    b.q.premultiply(_qa.setFromAxisAngle(axis, ang * (b.invI / w))).normalize();
  }

  /** Keep the two anchor points of a joint coincident (ball constraint). */
  private solveAnchor(l: Limit): void {
    const ra = _v.copy(l.la).applyQuaternion(l.parent.q);
    const rb = _v2.copy(l.lb).applyQuaternion(l.child.q);
    const cx = (l.child.p.x + rb.x) - (l.parent.p.x + ra.x);
    const cy = (l.child.p.y + rb.y) - (l.parent.p.y + ra.y);
    const cz = (l.child.p.z + rb.z) - (l.parent.p.z + ra.z);
    const c = Math.hypot(cx, cy, cz);
    if (c < 1e-7) return;
    _n.set(cx / c, cy / c, cz / c);
    this.applyPair(l.parent, ra, l.child, rb, _n, c, 0.5, RAGDOLL.anchorRotShare);
  }

  /** Clamp one joint into its anatomical box. */
  private solveAngular(l: Limit): void {
    const qp = l.parent.q, qc = l.child.q;
    // relative rotation child-in-parent, and the direction the child bone points
    _q.copy(qp).invert().multiply(qc);
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const d = _v.set(0, -1, 0).applyQuaternion(_q);
    const fz = Math.asin(cl(d.x, -1, 1));
    const fx = Math.atan2(-d.z, -d.y);
    // twist = what is left after the shortest arc that takes -Y onto d
    _q2.setFromUnitVectors(NEG_Y, d);
    _q3.copy(_q2).invert().multiply(_q);
    if (_q3.w < 0) { _q3.x = -_q3.x; _q3.y = -_q3.y; _q3.z = -_q3.z; _q3.w = -_q3.w; }
    let tw = 2 * Math.atan2(-_q3.y, _q3.w);
    if (tw > Math.PI) tw -= 2 * Math.PI; else if (tw < -Math.PI) tw += 2 * Math.PI;
    const lim = l.lim;
    // fx wraps at +-pi, so pick the representative nearest the allowed interval before clamping —
    // otherwise a joint just past -pi is dragged the long way round and the solver never settles.
    let ux = fx;
    if (ux < lim.fx[0] && (ux + TAU) - lim.fx[1] < lim.fx[0] - ux) ux += TAU;
    else if (ux > lim.fx[1] && lim.fx[0] - (ux - TAU) < ux - lim.fx[1]) ux -= TAU;
    let cx = cl(ux, lim.fx[0], lim.fx[1]), cz = cl(fz, lim.fz[0], lim.fz[1]), ct = cl(tw, lim.tw[0], lim.tw[1]);
    if (l.rest && this.restBlend > 0) {
      // Not a spring: a per-iteration fraction of the remaining error, so it is unconditionally
      // stable and cannot inject energy. Anything the limits or the ground disagree with wins,
      // because those are projected in the same sweep and this only nudges the target.
      const k = RAGDOLL.neckRest.rate * this.restBlend;
      cx = cl(cx + (l.rest.fx - cx) * k, lim.fx[0], lim.fx[1]);
      cz = cl(cz + (l.rest.fz - cz) * k, lim.fz[0], lim.fz[1]);
      if (l.twValid) ct = cl(ct + (l.rest.tw - ct) * k, lim.tw[0], lim.tw[1]);
    }
    const over = Math.abs(ux - cx) + Math.abs(fz - cz) + Math.abs(tw - ct);
    if (over < 1e-5) return;
    // rebuild the allowed relative rotation from the clamped angles
    const ca = Math.cos(cz);
    _v2.set(Math.sin(cz), -ca * Math.cos(cx), -ca * Math.sin(cx));
    _q2.setFromUnitVectors(NEG_Y, _v2);
    // Near the antipode (the bone folded back on itself) the shortest-arc split makes `tw`
    // meaningless, so fade the twist correction out and let the swing clamp bring the bone back
    // into range first — acting on a garbage twist reading is how the old solver injected energy.
    const swing = Math.acos(cl(-d.y, -1, 1));
    const cond = cl((3.0 - swing) / 0.14, 0, 1);
    _q3.setFromAxisAngle(NEG_Y, ct + (tw - ct) * (1 - cond));
    _q2.multiply(_q3);                                       // allowed relative rotation
    _q4.copy(qp).multiply(_q2);                              // target child world rotation
    _q.copy(_q4).multiply(_q3.copy(qc).invert());            // world rotation from here to there
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const el = Math.hypot(_q.x, _q.y, _q.z);
    const ang = 2 * Math.atan2(el, _q.w);
    if (!(ang > 1e-6) || el < 1e-9) return;
    _n.set(_q.x / el, _q.y / el, _q.z / el);
    this.applyTwist(l.parent, l.child, _n, ang);
  }

  /** Record every joint's angles from the final, rendered pose (introspection + tests). */
  private measureLimits(): void {
    for (const l of this.limits) {
      _q.copy(l.parent.q).invert().multiply(l.child.q);
      if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
      const d = _v.set(0, -1, 0).applyQuaternion(_q);
      l.fz = Math.asin(cl(d.x, -1, 1));
      l.fx = Math.atan2(-d.z, -d.y);
      _q2.setFromUnitVectors(NEG_Y, d);
      _q3.copy(_q2).invert().multiply(_q);
      if (_q3.w < 0) { _q3.x = -_q3.x; _q3.y = -_q3.y; _q3.z = -_q3.z; _q3.w = -_q3.w; }
      let tw = 2 * Math.atan2(-_q3.y, _q3.w);
      if (tw > Math.PI) tw -= TAU; else if (tw < -Math.PI) tw += TAU;
      l.tw = tw;
      const lim = l.lim;
      let ux = l.fx;
      if (ux < lim.fx[0] && (ux + TAU) - lim.fx[1] < lim.fx[0] - ux) ux += TAU;
      else if (ux > lim.fx[1] && lim.fx[0] - (ux - TAU) < ux - lim.fx[1]) ux -= TAU;
      l.fx = ux;
      // `over` is the *swing* violation only — where the bone points, which is the part a viewer
      // sees. Roll about the bone's own axis is scored separately in `overTw`: the collider is a
      // capsule so rolling it moves no pixel, and its decomposition is worst exactly where a limb
      // is folded hardest. Feeding it into `over` made the extra refine sweeps fire every frame on
      // a corpse that had nothing visibly wrong with it, and mask the frames that did.
      l.over = Math.max(0, lim.fx[0] - ux, ux - lim.fx[1], lim.fz[0] - l.fz, l.fz - lim.fz[1]);
      // twist is only meaningful while the bone is away from the antipode of its bind direction;
      // there the shortest-arc split is degenerate and any reading is noise, so it is not scored.
      l.twValid = Math.acos(cl(-d.y, -1, 1)) < 2.9;
      l.overTw = l.twValid ? Math.max(0, lim.tw[0] - tw, tw - lim.tw[1]) : 0;
    }
  }

  /** Distance from a part's centre down to the lowest point of its collider, for any orientation. */
  private support(p: Part): number {
    _m.makeRotationFromQuaternion(p.q);
    const e = _m.elements;
    // |y-component of each rotated local axis| * half extent, summed => the box/capsule support along -Y
    return Math.abs(e[1] * p.ext.x) + Math.abs(e[5] * p.ext.y) + Math.abs(e[9] * p.ext.z) + p.radius;
  }

  private solveGround(): void {
    for (const p of this.parts) {
      if (p.bone === B.rifle) continue;
      const sup = this.support(p);
      const pen = this.groundY - (p.p.y - sup);
      if (pen > 0) {
        // push at the lowest point so a capsule lying at an angle rolls flat instead of levitating
        _r.set(0, -sup, 0);
        const w = p.invMass + p.invI * (_r.x * _r.x + _r.z * _r.z);
        const lam = Math.min(pen, 0.08) / Math.max(w, 1e-9);
        _p.set(0, lam, 0);
        p.p.addScaledVector(_p, p.invMass);
        this.spin(p, _v3.crossVectors(_r, _p).multiplyScalar(p.invI));
      }
      // Points where the rendered mesh reaches past the collider (the helmet crown, the chin).
      // These push at a real lever arm, so unlike the centre push above they also *rotate* the
      // part — which is what tips a nodded head back up out of the road.
      for (const sh of p.shell) {
        _r.copy(sh).applyQuaternion(p.q);
        const d = this.groundY - (p.p.y + _r.y - p.shellR);
        if (d <= 0) continue;
        _n.set(0, 1, 0);
        const c = _v4.crossVectors(_r, _n);
        const w = p.invMass + p.invI * c.lengthSq();
        const lam = Math.min(d, 0.06) / Math.max(w, 1e-9);
        _p.set(0, lam, 0);
        p.p.addScaledVector(_p, p.invMass);
        this.spin(p, _v3.crossVectors(_r, _p).multiplyScalar(p.invI));
      }
    }
  }

  /** World-space closest distance between two parts' capsule/box segments. */
  private pairDistance(a: Part, b: Part, outN?: THREE.Vector3, outA?: THREE.Vector3, outB?: THREE.Vector3): number {
    const pa = _v.copy(a.seg).applyQuaternion(a.q), pb = _v2.copy(b.seg).applyQuaternion(b.q);
    const a0 = _v3.copy(a.p).sub(pa), b0 = _v4.copy(b.p).sub(pb);
    // segment a: a0 + s*(2*pa), segment b: b0 + t*(2*pb)
    const dax = pa.x * 2, day = pa.y * 2, daz = pa.z * 2;
    const dbx = pb.x * 2, dby = pb.y * 2, dbz = pb.z * 2;
    const rx = a0.x - b0.x, ry = a0.y - b0.y, rz = a0.z - b0.z;
    const A = dax * dax + day * day + daz * daz;
    const E = dbx * dbx + dby * dby + dbz * dbz;
    const F = dbx * rx + dby * ry + dbz * rz;
    let s = 0, t = 0;
    if (A <= 1e-10 && E <= 1e-10) { s = 0; t = 0; }
    else if (A <= 1e-10) { t = cl(F / E, 0, 1); }
    else {
      const C = dax * rx + day * ry + daz * rz;
      if (E <= 1e-10) { s = cl(-C / A, 0, 1); }
      else {
        const Bc = dax * dbx + day * dby + daz * dbz;
        const den = A * E - Bc * Bc;
        s = den > 1e-12 ? cl((Bc * F - C * E) / den, 0, 1) : 0;
        t = (Bc * s + F) / E;
        if (t < 0) { t = 0; s = cl(-C / A, 0, 1); } else if (t > 1) { t = 1; s = cl((Bc - C) / A, 0, 1); }
      }
    }
    const ax = a0.x + dax * s, ay = a0.y + day * s, az = a0.z + daz * s;
    const bx = b0.x + dbx * t, by = b0.y + dby * t, bz = b0.z + dbz * t;
    const cx = ax - bx, cy = ay - by, cz = az - bz;
    const d = Math.hypot(cx, cy, cz);
    if (outN) { if (d > 1e-6) outN.set(cx / d, cy / d, cz / d); else outN.set(0, 1, 0); }
    if (outA) outA.set(ax, ay, az);
    if (outB) outB.set(bx, by, bz);
    return d;
  }

  private solveSelf(): void {
    for (const sp of this.selfPairs) {
      const target = sp.a.radius + sp.b.radius - sp.slack;
      if (target <= 0) continue;
      // broad phase: centre distance minus both half-lengths can never be beaten by the exact test
      const reach = target + sp.a.seg.length() + sp.b.seg.length();
      if (sp.a.p.distanceToSquared(sp.b.p) > reach * reach) continue;
      const d = this.pairDistance(sp.a, sp.b, _n, _ca, _cb);
      const pen = target - d;
      if (pen <= 0) continue;
      this.applyPair(sp.a, _r.subVectors(_ca, sp.a.p), sp.b, _r2.subVectors(_cb, sp.b.p), _n, pen, RAGDOLL.maxSelfPush);
    }
  }

  /**
   * Velocity fix-up after the positional solve. Teleporting a body without touching its velocity
   * lets it drive straight back through the limit next step — the pumping that made the old corpse
   * thrash — so the angular correction is fed back into angular velocity (position-based
   * post-stabilisation), and everything is capped: a point-blank headshot impulse on a 0.03 kgm^2
   * head is otherwise worth 130 rad/s.
   */
  private fixVelocities(dt: number): void {
    const inv = 1 / Math.max(dt, 1e-4);
    const fb = RAGDOLL.limitVelDamp;
    const maxW = RAGDOLL.maxAngVel, maxV = RAGDOLL.maxLinVel;
    for (const p of this.parts) {
      if (p.bone === B.rifle) continue;
      // linear: the projection is real motion, so it becomes velocity
      const v = p.body.linvel();
      let vx = v.x + (p.p.x - p.p0.x) * inv * fb;
      let vy = v.y + (p.p.y - p.p0.y) * inv * fb;
      let vz = v.z + (p.p.z - p.p0.z) * inv * fb;
      if (p.p.y - this.support(p) <= this.groundY + 1e-4 && vy < 0) vy = 0;
      const vl = Math.hypot(vx, vy, vz);
      if (vl > maxV) { const s = maxV / vl; vx *= s; vy *= s; vz *= s; }
      p.body.setLinvel({ x: vx, y: vy, z: vz }, true);
      // angular: rotation vector of q * q0^-1
      _q.copy(p.q).multiply(_q2.copy(p.q0).invert());
      if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
      const el = Math.hypot(_q.x, _q.y, _q.z);
      const w = p.body.angvel();
      let wx = w.x, wy = w.y, wz = w.z;
      if (el > 1e-9) {
        const ang = 2 * Math.atan2(el, _q.w) * inv * fb / el;
        wx += _q.x * ang; wy += _q.y * ang; wz += _q.z * ang;
      }
      const wl = Math.hypot(wx, wy, wz);
      if (wl > maxW) { const s = maxW / wl; wx *= s; wy *= s; wz *= s; }
      p.body.setAngvel({ x: wx, y: wy, z: wz }, true);
    }
    this.limitVelocities(dt);
  }

  /**
   * Velocity-level joint stops. Projecting positions alone still lets the next step drive a joint
   * straight past its limit and only pulls it back afterwards, which on a hard landing shows up as
   * a few frames of over-bent knee. Here the relative angular velocity is capped so a joint cannot
   * leave its box during the coming step at all. Near identity the parent-frame components of the
   * relative angular velocity map one-to-one onto the three angles (x -> flexion, z -> lateral,
   * -y -> twist), which is accurate enough for a stop.
   */
  private limitVelocities(dt: number): void {
    const inv = 1 / Math.max(dt, 1e-4);
    for (const l of this.limits) {
      const wc = l.child.body.angvel(), wp = l.parent.body.angvel();
      _v.set(wc.x - wp.x, wc.y - wp.y, wc.z - wp.z).applyQuaternion(_q.copy(l.parent.q).invert());
      const lim = l.lim;
      // allowed rate range for each angle so that angle + rate*dt stays inside; never force a
      // recovery velocity (the positional pass owns that), only refuse to go further out.
      const cap = (rate: number, angle: number, lo: number, hi: number) =>
        cl(rate, Math.min((lo - angle) * inv, 0), Math.max((hi - angle) * inv, 0));
      const nx = cap(_v.x, l.fx, lim.fx[0], lim.fx[1]);
      const nz = cap(_v.z, l.fz, lim.fz[0], lim.fz[1]);
      const ny = l.twValid ? -cap(-_v.y, l.tw, lim.tw[0], lim.tw[1]) : _v.y;
      if (Math.abs(nx - _v.x) + Math.abs(nz - _v.z) + Math.abs(ny - _v.y) < 1e-6) continue;
      _v2.set(nx - _v.x, ny - _v.y, nz - _v.z).applyQuaternion(l.parent.q);
      const ic = l.child.invI, ip = l.parent.invI;
      const fc = ic / (ic + ip);
      l.child.body.setAngvel({ x: wc.x + _v2.x * fc, y: wc.y + _v2.y * fc, z: wc.z + _v2.z * fc }, true);
      l.parent.body.setAngvel({ x: wp.x - _v2.x * (1 - fc), y: wp.y - _v2.y * (1 - fc), z: wp.z - _v2.z * (1 - fc) }, true);
    }
  }

  // ------------------------------------------------------------------------------------------
  // introspection (tests / debug)
  // ------------------------------------------------------------------------------------------

  /** Measured joint angles and their allowed boxes, in radians. */
  jointAngles(): { name: string; fx: number; fz: number; tw: number; lim: JointLimit; over: number; overTw: number; twValid: boolean }[] {
    return this.limits.map((l) => ({ name: l.name, fx: l.fx, fz: l.fz, tw: l.tw, lim: l.lim, over: l.over, overTw: l.overTw, twValid: l.twValid }));
  }
  /** Largest joint-anchor separation in metres (a broken chain shows up here). */
  maxAnchorError(): number {
    let m = 0;
    this.read();
    for (const l of this.limits) {
      const a = _v.copy(l.la).applyQuaternion(l.parent.q).add(l.parent.p);
      const b = _v2.copy(l.lb).applyQuaternion(l.child.q).add(l.child.p);
      m = Math.max(m, a.distanceTo(b));
    }
    return m;
  }
  /** Deepest same-body limb interpenetration in metres. */
  maxSelfPenetration(): number {
    let m = 0;
    this.read();
    for (const s of this.selfPairs) m = Math.max(m, s.a.radius + s.b.radius - s.slack - this.pairDistance(s.a, s.b));
    return m;
  }
  /** How far the lowest collider point sits below the ground plane (metres, 0 when clean). */
  groundPenetration(): number {
    let m = 0;
    this.read();
    for (const p of this.parts) {
      if (p.bone === B.rifle) continue;
      m = Math.max(m, this.groundY - (p.p.y - this.support(p)));
      for (const sh of p.shell) m = Math.max(m, this.groundY - (p.p.y + _r.copy(sh).applyQuaternion(p.q).y - p.shellR));
    }
    return m;
  }

  /**
   * Where the rendered head actually is, in world space, for the tests and the debug HUD:
   * the head bone origin, the top of the helmet, the chin, and the neck joint it hangs off.
   * A head that has been left behind, collapsed into the chest, driven under the road or scaled
   * away fails on one of these four numbers rather than on somebody looking at a screenshot.
   */
  headProbe(): { head: THREE.Vector3; neck: THREE.Vector3; crown: THREE.Vector3; chin: THREE.Vector3; chest: THREE.Vector3 } {
    this.read();
    const p = this.byBone.get(B.head)!;
    const bone = _v.copy(p.offset).applyQuaternion(p.q);
    const origin = new THREE.Vector3(p.p.x - bone.x, p.p.y - bone.y, p.p.z - bone.z);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.q);
    const c = this.chest;
    const cOff = _v2.copy(c.offset).applyQuaternion(c.q);
    const chest = new THREE.Vector3(c.p.x - cOff.x, c.p.y - cOff.y, c.p.z - cOff.z);
    // the neck bone rides the chest body (it is one of its followers), so it comes from the chest's
    // pose and the bind offset rather than from the head — otherwise the check is circular
    const neck = new THREE.Vector3(0, JOINT.neck.y - JOINT.spine2.y, 0).applyQuaternion(c.q).add(chest);
    return {
      head: origin,
      neck,
      crown: origin.clone().addScaledVector(up, RAGDOLL.headCrown),
      chin: origin.clone().addScaledVector(up, RAGDOLL.headChin),
      chest,
    };
  }
  /** Height of the highest body part above the ground plane — a settled corpse must be low. */
  topHeight(): number {
    let m = 0;
    this.read();
    for (const p of this.parts) { if (p.bone === B.rifle) continue; m = Math.max(m, p.p.y + this.support(p) - this.groundY); }
    return m;
  }

  /** Project the constraints (once per physics step), then copy body poses onto the bones. */
  sync(_dt: number): void {
    if (this.pendingDt > 0) { const d = this.pendingDt; this.pendingDt = 0; this.solve(d); }
    const root = this.rig.root;
    const driver = new Map<number, Part>();
    for (const p of this.parts) { driver.set(p.bone, p); for (const f of p.followers) driver.set(f, p); }
    // walk bones parent-first; keep world pose arrays updated so children can convert to local
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const name = BONE_NAMES[i]; const parent = PARENT[name];
      const bone = this.bones[i];
      if (parent === null) { this.wp[i].copy(root.position).add(bone.position); this.wq[i].copy(root.quaternion).multiply(bone.quaternion); continue; }
      const pi = B[parent];
      const p = driver.get(i);
      if (p) {
        const r = p.body.rotation(); const wq = _q.set(r.x, r.y, r.z, r.w);
        if (p.bone === i) {
          // bone origin = body centre - rotated offset
          const t = p.body.translation();
          _v3.copy(p.offset).applyQuaternion(wq);
          this.wp[i].set(t.x - _v3.x, t.y - _v3.y, t.z - _v3.z);
          this.wq[i].copy(wq);
          _q3.copy(this.wq[pi]).invert();
          bone.quaternion.copy(_q3).multiply(wq);
          bone.position.copy(this.wp[i]).sub(this.wp[pi]).applyQuaternion(_q3);
        } else {
          this.wq[i].copy(wq);
          bone.quaternion.copy(this.wq[pi]).invert().multiply(wq);
          this.wp[i].copy(bone.position).applyQuaternion(this.wq[pi]).add(this.wp[pi]);
        }
      } else {
        this.wp[i].copy(bone.position).applyQuaternion(this.wq[pi]).add(this.wp[pi]);
        this.wq[i].multiplyQuaternions(this.wq[pi], bone.quaternion);
      }
    }
  }

  /** Ground-plane centre of the body (for the contact shadow). */
  centre(out: THREE.Vector3): THREE.Vector3 {
    const t = this.chest.body.translation();
    return out.set(t.x, this.groundY, t.z);
  }

  /** Extra impulse (explosions / shooting a corpse). */
  impulse(center: THREE.Vector3, strength: number, radius: number): void {
    if (this.settled) for (const p of this.parts) { p.body.setLinearDamping(RAGDOLL.linearDamping); p.body.setAngularDamping(RAGDOLL.angularDamping); }
    this.settled = false; this.age = Math.min(this.age, RAGDOLL.settleTime * 0.3);
    for (const p of this.parts) {
      const t = p.body.translation();
      const d = _v.set(t.x - center.x, t.y - center.y + 0.3, t.z - center.z);
      const len = d.length(); if (len > radius) continue;
      d.divideScalar(Math.max(0.3, len)).multiplyScalar(strength * (1 - len / radius));
      p.body.applyImpulse({ x: d.x, y: d.y, z: d.z }, true);
    }
    this.clampSpawnVelocity();
  }

  dispose(): void {
    const w = this.physics.world;
    for (const j of this.joints) w.removeImpulseJoint(j, true);
    for (const p of this.parts) { this.physics.untag(p.collider); w.removeRigidBody(p.body); }
    this.parts = []; this.joints = []; this.limits = []; this.selfPairs = [];
  }
}
