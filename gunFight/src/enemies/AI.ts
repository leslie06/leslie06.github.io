/**
 * Enemy brain: perception (LOS + hearing), a small state machine (patrol / investigate / engage /
 * cover / peek / reload / retreat / flank), cover selection with squad de-confliction, A* over
 * level.navPoints with a raycast-steering fallback, and the CoD-style fire discipline.
 * All numbers come from EnemyDefs.
 */
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { AudioApi, FxApi, LevelApi, PlayerApi } from '../game/Contracts';
import { Rng } from '../core/Rng';
import { ACCURACY, COMBAT, MOVE, PERCEPTION, type ArchetypeDef } from './EnemyDefs';
import { burstLength } from './Accuracy';
import { COVER_PEEK_BONUS, coverPrescore, coverScore, distXZ, nearestNode, pickWhisker, planPath, ringSamples, separation, type NavNode, type V3 } from './Nav';
import type { Enemy } from './Enemy';
import { clamp } from './Gait';

export type AIState = 'idle' | 'patrol' | 'investigate' | 'engage' | 'cover' | 'peek' | 'reload' | 'retreat' | 'flank' | 'dead';
export type Role = 'assault' | 'flank' | 'suppress';

/** Shared world view every brain reads (owned by EnemySystem). */
export interface EnemyWorld {
  engine: Engine;
  player: PlayerApi | undefined;
  level: LevelApi | undefined;
  fx: FxApi | undefined;
  audio: AudioApi | undefined;
  nav: NavNode[];
  coverNodes: THREE.Vector3[];
  bounds: THREE.Box3;
  time: number;
  difficulty: { accuracy: number; damage: number; reaction: number; aggression: number };
  /** enemyId -> claimed cover position (squad de-confliction) */
  claims: Map<number, THREE.Vector3>;
  enemies: Enemy[];
  heard: { pos: THREE.Vector3; time: number } | null;
  lastCallout: number;
  rng: Rng;
}

interface Cover { pos: THREE.Vector3; low: boolean; peekSide: number; peekPos: THREE.Vector3 }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
/** Used only inside tryFire, so the muzzle probe can never scribble on the aim point. */
const _fire = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Brain {
  state: AIState = 'idle';
  stateTime = 0;
  role: Role;
  alerted = false;
  reaction = 0;
  visible = false;
  lastSeen = new THREE.Vector3();
  lastSeenTime = -100;
  losTimer = 0;
  path: V3[] = [];
  pathIdx = 0;
  replanT = 0;
  goal: THREE.Vector3 | null = null;
  cover: Cover | null = null;
  coverCycles = 0;
  phaseT = 0;
  phaseDur = 0;
  patrolT = 0;
  suppressT = 0;
  blockedT = 0;
  muzzleBlocked = false;
  /**
   * Squad pressure, in metres of engage-band collapse. It builds for as long as this soldier is
   * alerted and the fight is costing him nothing, and incoming fire buys it back (see onDamaged).
   * Without it a soldier who reaches cover has no reason ever to move again, which is exactly how
   * the squad ended up parked at 27 m with the player standing in the open.
   */
  push = 0;
  /** Seconds left of a deliberate assault: out of cover, closing on the player. */
  assaultT = 0;
  /** Set once we actually see the player during the current peek. */
  private peekSeen = false;
  /**
   * Where we are shooting. This MUST be storage the brain owns. It used to be the module-scope
   * `_v` scratch vector, which `combatFacing`, `moveAlong`, `holdAt` and `tryFire` itself all
   * overwrite — every one of them runs between the aim point being computed and the trigger being
   * pulled, so `fireAt` was handed a normalised direction vector and the whole squad shot at a
   * point one metre from the world origin. Measured: every round in a wave-1 session missed the
   * player by within a few centimetres of the full range to him (9.7 m out of 10.2 m) and hit a
   * wall, which is why a player standing in the open took no damage at all.
   */
  private aimPoint = new THREE.Vector3();
  private whiskerT = 0;
  private steerAngle = 0;
  private def: ArchetypeDef;
  private rng: Rng;
  private coverSearchT = 0;
  private holdT = 0;
  private detour: V3 | null = null;
  private detourT = 0;
  /** Scripted override used by poses/tests: freeze decisions. */
  scripted = false;

  constructor(private me: Enemy, private w: EnemyWorld) {
    this.def = me.archetype;
    this.rng = me.rng;
    const roles: Role[] = ['assault', 'flank', 'suppress', 'assault'];
    this.role = roles[me.id % roles.length];
    this.state = 'patrol';
  }

  // ---------------- perception ----------------
  private perceive(dt: number): void {
    const p = this.w.player; const me = this.me;
    this.losTimer -= dt;
    if (!p || !p.alive) { this.visible = false; return; }
    if (this.losTimer <= 0) {
      this.losTimer = PERCEPTION.losInterval;
      const eye = me.eye;
      const to = _v.subVectors(p.eye, eye); const dist = to.length();
      let vis = false;
      if (dist < PERCEPTION.viewDistance) {
        to.divideScalar(dist);
        const fwd = _v2.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
        const inFov = this.alerted || (to.x * fwd.x + to.z * fwd.z) / Math.max(1e-4, Math.hypot(to.x, to.z)) > PERCEPTION.fovCos;
        if (inFov) vis = this.clear(eye, p.eye);
      }
      this.visible = vis;
    }
    if (this.visible) {
      this.lastSeen.copy(p.position); this.lastSeenTime = this.w.time;
      me.timeOnTarget += dt;
      if (!this.alerted) { this.alerted = true; this.reaction = this.def.reactionTime * this.w.difficulty.reaction; this.callout('enemy_callout_contact'); this.shareContact(); }
    } else me.timeOnTarget = Math.max(0, me.timeOnTarget - dt * 2);
    if (this.reaction > 0) this.reaction -= dt;
    // hearing
    const h = this.w.heard;
    if (h && this.w.time - h.time < 0.2 && h.pos.distanceTo(me.pos) < PERCEPTION.hearingRadius && !this.visible) {
      if (!this.alerted && (this.state === 'idle' || this.state === 'patrol')) { this.lastSeen.copy(h.pos); this.lastSeenTime = this.w.time - PERCEPTION.memoryTime * 0.5; this.setState('investigate'); }
      this.alerted = true;
    }
  }

  /**
   * Call the contact in to the squad. Without this only the soldier who happens to get a sightline
   * ever joins the fight: the rest keep patrolling out of LOS behind buildings, and a wave with
   * four men alive but three of them unaware can never end. They get the position, not a free
   * sightline — the memory is stamped half-stale so nobody snaps onto a target he has not seen.
   */
  private shareContact(): void {
    const p = this.w.player;
    if (!p) return;
    for (const o of this.w.enemies) {
      if (o === this.me || !o.alive) continue;
      const b = o.brain;
      if (b.alerted || b.scripted) continue;
      if (o.pos.distanceTo(this.me.pos) > PERCEPTION.squadRadius) continue;
      b.alerted = true;
      b.reaction = o.archetype.reactionTime * this.w.difficulty.reaction;
      b.lastSeen.copy(p.position);
      b.lastSeenTime = this.w.time - PERCEPTION.memoryTime * 0.5;
      if (b.state === 'idle' || b.state === 'patrol') b.setState('investigate');
    }
  }

  /**
   * Task this soldier onto a known player position regardless of what he can see or hear.
   *
   * Every other route into `alerted` is range-limited on purpose - `viewDistance` and
   * `hearingRadius` are 70 m and `squadRadius` is 55 m, on a map whose far corners are ~100 m
   * apart - so a soldier who spawns across the level from the fight can legitimately patrol for
   * ever without ever learning the player exists. That is fine while the wave is still deploying
   * and awful the moment it stops: the wave ends only when he dies, and a player who cannot find
   * him has no move left. The director calls this once the wave has nothing more to send in.
   *
   * He is given the position, not a sightline: `lastSeenTime` is stamped half-stale exactly as
   * `shareContact` does it, so he walks over to look rather than snapping onto a target across the
   * map.
   */
  alertTo(pos: THREE.Vector3): void {
    if (this.scripted) return;
    this.alerted = true;
    this.lastSeen.copy(pos);
    this.lastSeenTime = this.w.time - PERCEPTION.memoryTime * 0.5;
    if (this.state === 'idle' || this.state === 'patrol') this.setState('investigate');
  }

  /** World-only raycast between two points. */
  clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = _v3.subVectors(b, a); const len = d.length(); if (len < 1e-3) return true;
    d.divideScalar(len);
    const hit = this.me.engine.physics.raycast(a, d, len - 0.05, groups(CG.ENEMY, CG.WORLD));
    return hit === null;
  }

  private callout(id: string): void {
    if (this.w.time - this.w.lastCallout < COMBAT.calloutCooldown / Math.max(1, this.w.enemies.length * 0.5)) return;
    this.w.lastCallout = this.w.time;
    this.w.audio?.play(id, { position: this.me.eye.clone() });
  }

  onDamaged(point: THREE.Vector3, dir: THREE.Vector3): void {
    void point;
    if (!this.alerted) {
      this.alerted = true; this.reaction = this.def.reactionTime * 0.5;
      const from = _v.copy(dir).negate();
      this.lastSeen.copy(this.me.pos).addScaledVector(from, 15);
      if (this.w.player) this.lastSeen.copy(this.w.player.position);
      this.lastSeenTime = this.w.time;
      this.setState('engage');
    }
    // taking fire is what relieves the pressure to close
    this.push = Math.max(0, this.push - COMBAT.pushRelief);
    if (this.state === 'peek' && this.me.health < this.def.health * 0.5 && this.rng.next() < 0.5) this.setState('cover');
  }

  setState(s: AIState): void {
    if (this.state === s) return;
    this.state = s; this.stateTime = 0;
    this.path = []; this.pathIdx = 0; this.replanT = 0;
    if (s === 'cover') { this.phaseDur = this.rng.range(COMBAT.hideTimeMin, COMBAT.hideTimeMax) / Math.max(0.5, this.w.difficulty.aggression); this.phaseT = 0; }
    if (s === 'peek') { this.phaseDur = this.rng.range(COMBAT.peekTimeMin, COMBAT.peekTimeMax) * Math.max(0.5, this.w.difficulty.aggression); this.phaseT = 0; this.peekSeen = false; }
  }

  // ---------------- main ----------------
  think(dt: number): void {
    const me = this.me; const t = me.target;
    this.stateTime += dt;
    this.perceive(dt);
    if (this.scripted) return;
    const p = this.w.player;
    const known = this.w.time - this.lastSeenTime < PERCEPTION.memoryTime;
    // aim direction default: toward the player (if known) or forward
    let aimAt: THREE.Vector3 | null = null;
    if (known && p) { aimAt = this.aimPoint.copy(p.eye); aimAt.y -= 0.3; }
    // reload takes priority: crouch where we are and reload
    if (me.reloading) {
      me.desiredVel.set(0, 0, 0); t.crouch = this.cover?.low ? 1 : 0.6; t.aim = 0; t.hide = this.cover ? 0.6 : 0.2; t.lean = 0; t.sprint = 0;
      if (aimAt) me.facePoint(aimAt);
      return;
    }
    if (me.ammo <= 0) { me.startReload(); return; }
    // Squad pressure. It builds for as long as this soldier is in a fight that is costing him
    // nothing, and incoming fire is what buys it back (see onDamaged). Tying it to line of sight
    // instead was not enough: a soldier who *can* see the player from good cover 10 m away has no
    // reason to move, so a squad that never gets shot at settles at arm's length and the player
    // watches a stand-off. Pressure is what turns four men holding cover into an assault.
    if (!this.alerted) this.push = 0;
    else if (this.state === 'retreat') this.push = Math.max(0, this.push - COMBAT.pushDecay * dt);
    else this.push = Math.min(COMBAT.pushMax, this.push + COMBAT.pushRate * dt);
    // low health -> retreat once
    if (this.alerted && me.health < this.def.health * COMBAT.retreatHealthFrac && this.state !== 'retreat' && this.stateTime > 1 && this.role !== 'assault') this.setState('retreat');

    switch (this.state) {
      case 'idle':
      case 'patrol': this.doPatrol(dt); break;
      case 'investigate': this.doInvestigate(dt, known); break;
      case 'engage':
      case 'flank': this.doEngage(dt, known, aimAt); break;
      case 'cover': this.doCover(dt, known, aimAt); break;
      case 'peek': this.doPeek(dt, known, aimAt); break;
      case 'retreat': this.doRetreat(dt, known, aimAt); break;
      case 'reload': break;
      case 'dead': break;
    }
    // transitions common to all: spotted the player while not engaged
    if (this.visible && (this.state === 'idle' || this.state === 'patrol' || this.state === 'investigate')) this.setState('engage');
  }

  /** Outer edge of the standoff we currently want, after aggression and squad pressure. */
  private bandMax(): number {
    return Math.max(COMBAT.pushMinDistance + 2, COMBAT.engageDistanceMax * this.w.difficulty.aggression - this.push);
  }

  /** True when the cover we hold is so far outside the wanted band that it is a staging position. */
  private coverTooFar(): boolean {
    const p = this.w.player;
    if (!this.cover || !p) return false;
    return distXZ([this.cover.pos.x, 0, this.cover.pos.z], [p.position.x, 0, p.position.z]) > this.bandMax() + COMBAT.coverBandSlack;
  }

  /**
   * Leave a staging position: bound to cover meaningfully closer to the player if one exists, and
   * otherwise go out into the open and assault. The assault timer matters — without it the very
   * next cover search re-acquires the position we just left and the soldier oscillates on the spot
   * instead of closing.
   */
  private boundForward(): void {
    const p = this.w.player;
    const held = this.cover && p ? distXZ([this.cover.pos.x, 0, this.cover.pos.z], [p.position.x, 0, p.position.z]) : Infinity;
    const next = this.findCover(true);
    const gain = next && p ? held - distXZ([next.pos.x, 0, next.pos.z], [p.position.x, 0, p.position.z]) : 0;
    if (next && gain > COMBAT.boundMinGain) this.setCover(next);
    else { this.setCover(null); this.assaultT = COMBAT.assaultTime; }
    this.coverCycles = 0;
    this.setState('engage');
  }

  // ---------------- behaviours ----------------
  /**
   * Patrol is an advance to contact, not a random walk. `randomPoint` ignores its radius arguments
   * whenever a nav graph exists and returns a uniformly random node from the *whole* map, so a
   * spawned squad used to wander the far side of a 74 m arena and never meet the player at all —
   * three of four soldiers in a wave-1 trace never came inside 27 m in 26 seconds, and the wave
   * cannot end while they are alive. With a live player the goal is a point stepped toward him.
   */
  private doPatrol(dt: number): void {
    const me = this.me; const t = me.target;
    t.aim = 0; t.crouch = 0; t.hide = 0; t.lean = 0; t.sprint = 0;
    this.patrolT -= dt;
    const p = this.w.player;
    const hunting = !!p && p.alive;
    if (!this.goal || this.patrolT <= 0 || this.arrived(this.goal, hunting ? 2.5 : 1)) {
      this.patrolT = this.rng.range(hunting ? 2.5 : 4, hunting ? 4.5 : 9);
      this.goal = hunting ? this.approachPoint(p!.position) : this.randomPoint(6, 14);
      this.path = [];
    }
    const far = hunting && this.goal ? distXZ([me.pos.x, 0, me.pos.z], [p!.position.x, 0, p!.position.z]) > COMBAT.engageDistanceMax : false;
    const speed = (far ? MOVE.runSpeed * 0.6 : MOVE.walkSpeed) * this.def.speedMul;
    if (this.goal) this.moveAlong(this.goal, speed, dt);
    if (me.vel.lengthSq() > 0.05) me.faceDir(me.vel);
    t.aimDir.set(-Math.sin(me.yaw), -0.1, -Math.cos(me.yaw));
  }

  private doInvestigate(dt: number, known: boolean): void {
    const me = this.me; const t = me.target;
    t.aim = 0.35; t.crouch = 0; t.hide = 0; t.lean = 0; t.sprint = 0;
    // A goal we never reach must not hold us forever. The old code only counted down towards
    // 'patrol' inside the arrived branch, so a soldier whose path to the last-known position was
    // blocked (or whose nav island does not join the player's) orbited at 30 m indefinitely.
    if (this.stateTime > COMBAT.investigateTimeout) {
      const p = this.w.player;
      if (this.alerted && p && p.alive) { this.lastSeen.copy(p.position); this.path = []; this.replanT = 0; this.stateTime = 0; }
      else { this.setState('patrol'); this.alerted = false; return; }
    }
    const goal = this.lastSeen;
    if (!this.arrived(goal, 2.5)) { this.moveAlong(goal, MOVE.runSpeed * 0.8 * this.def.speedMul, dt); if (me.vel.lengthSq() > 0.05) me.faceDir(me.vel); }
    else {
      me.desiredVel.set(0, 0, 0);
      // scan
      me.face(me.yaw + Math.sin(this.stateTime * 0.8) * dt * 1.2);
      if (this.stateTime > 6) { this.setState('patrol'); this.alerted = false; }
    }
    t.aimDir.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    void known;
  }

  private doEngage(dt: number, known: boolean, aimAt: THREE.Vector3 | null): void {
    const me = this.me; const t = me.target; const p = this.w.player;
    if (!known || !p) { this.setState('investigate'); return; }
    // find / go to cover
    if (this.assaultT > 0) this.assaultT -= dt;
    if (!this.cover && this.assaultT <= 0) {
      this.coverSearchT -= dt;
      if (this.coverSearchT <= 0) {
        this.setCover(this.findCover(false));
        this.coverSearchT = this.cover ? 0.6 : COMBAT.coverSearchRetry;
        if (this.cover) this.coverCycles = 0;
      }
    }
    // contact burst: when we can see the player and haven't shot for a while, plant and shoot before moving
    if (this.visible && this.reaction <= 0 && (this.holdT > 0 || this.w.time - me.lastFireTime > COMBAT.contactRefire)) {
      this.holdT += dt;
      if (this.holdT < COMBAT.contactHoldTime) {
        me.desiredVel.set(0, 0, 0);
        me.facePoint(aimAt!);
        t.aim = 1; t.sprint = 0; t.crouch = 0; t.hide = 0; t.lean = 0;
        t.aimDir.copy(aimAt!).sub(me.anim.muzzleWorld).normalize();
        this.tryFire(aimAt!, dt, false);
        // Eyes on the player but a wall in front of the rifle: planting here is how a soldier ends
        // up standing still for the whole wave firing nothing. Fall through and reposition instead.
        if (!this.muzzleBlocked) return;
        this.holdT = 0;
      }
    } else if (!this.visible) this.holdT = 0;
    if (this.holdT >= COMBAT.contactHoldTime && this.w.time - me.lastFireTime > COMBAT.contactRefire) this.holdT = 0;
    if (this.cover) {
      const dc = distXZ([me.pos.x, me.pos.y, me.pos.z], [this.cover.pos.x, this.cover.pos.y, this.cover.pos.z]);
      if (dc < 0.55) { me.desiredVel.set(0, 0, 0); this.setState(this.rng.next() < 0.4 ? 'peek' : 'cover'); return; }
      const far = dc > COMBAT.fireOnMoveRange || !this.visible;
      this.moveAlong(this.cover.pos, (far ? MOVE.runSpeed : MOVE.strafeSpeed) * this.def.speedMul, dt);
      this.combatFacing(aimAt!, far, dt);
      t.crouch = 0; t.hide = 0; t.lean = 0;
      if (this.visible && !far) this.tryFire(aimAt!, dt, false);
      return;
    }
    // no cover: fight in the open, keep in the engage band and strafe
    const toP = _v2.subVectors(p.position, me.pos).setY(0); const d = toP.length(); toP.normalize();
    const side = _v3.set(toP.z, 0, -toP.x).multiplyScalar(Math.sin(this.stateTime * 0.7 + me.id) > 0 ? 1 : -1);
    const want = _v4.set(0, 0, 0);
    const aggro = this.w.difficulty.aggression;
    const bandMax = Math.max(COMBAT.pushMinDistance, COMBAT.engageDistanceMax * aggro - this.push);
    const bandMin = Math.max(3, COMBAT.engageDistanceMin - this.push * 0.5);
    if (d > bandMax) want.add(toP);
    else if (d < bandMin) want.sub(toP);
    want.addScaledVector(side, 0.6);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(MOVE.strafeSpeed * this.def.speedMul);
    this.applySteer(want, dt);
    this.combatFacing(aimAt!, false, dt);
    t.crouch = 0; t.hide = 0; t.lean = 0; t.sprint = 0;
    if (this.visible) this.tryFire(aimAt!, dt, false);
    else if (this.stateTime > 2) this.suppress(aimAt!, dt);
  }

  private doCover(dt: number, known: boolean, aimAt: THREE.Vector3 | null): void {
    const me = this.me; const t = me.target;
    if (!this.cover) { this.setState('engage'); return; }
    // Holding a position far outside the band we want is staging, not fighting. Sitting out the
    // hide/peek cycles there is how a soldier ended up trading shots from 26 m for a whole wave.
    if (known && this.coverTooFar()) { this.boundForward(); return; }
    this.phaseT += dt;
    this.holdAt(this.cover.pos, dt);
    t.crouch = this.cover.low ? 1 : 0.35; t.hide = this.cover.low ? 1 : 0.5; t.lean = 0; t.aim = 0; t.sprint = 0;
    if (aimAt) { me.facePoint(aimAt); t.aimDir.copy(aimAt).sub(me.eye).normalize(); }
    // if the player can see us in cover, the cover is bad -> new cover
    if (this.visible && this.phaseT > 0.6) {
      this.blockedT += dt;
      if (this.blockedT > 1.2) { this.blockedT = 0; this.setCover(this.findCover(false)); this.setState('engage'); return; }
    } else this.blockedT = 0;
    if (this.phaseT > this.phaseDur) {
      this.coverCycles++;
      if (!known) { this.setState('investigate'); this.setCover(null); return; }
      if (this.coverCycles >= COMBAT.coverCyclesBeforeMove * (this.role === 'suppress' ? 2 : 1)) { this.setCover(this.findCover(this.role !== 'suppress')); this.coverCycles = 0; this.setState('engage'); return; }
      this.setState('peek');
    }
  }

  private doPeek(dt: number, known: boolean, aimAt: THREE.Vector3 | null): void {
    const me = this.me; const t = me.target;
    if (!this.cover || !aimAt) { this.setState('engage'); return; }
    if (known && this.coverTooFar() && this.phaseT > 0.8) { this.boundForward(); return; }
    this.phaseT += dt;
    const c = this.cover;
    this.holdAt(c.peekPos, dt);
    t.crouch = 0; t.hide = 0; t.lean = c.low ? 0 : c.peekSide * 0.8; t.aim = 1; t.sprint = 0;
    me.facePoint(aimAt);
    t.aimDir.copy(aimAt).sub(me.anim.muzzleWorld).normalize();
    if (this.visible) { this.peekSeen = true; this.tryFire(aimAt, dt, false); }
    else this.suppress(aimAt, dt);
    // Standing up out of this cover and still not finding the player means the position has no
    // firing line: drop it and take a fresh one instead of cycling hide/peek behind it forever.
    if (known && !this.peekSeen && this.phaseT > Math.min(this.phaseDur, 1.2)) { this.setCover(null); this.setState('engage'); return; }
    if (this.phaseT > this.phaseDur || (!this.visible && this.phaseT > 1.2 && !known)) this.setState('cover');
    if (this.muzzleBlocked && this.phaseT > 1.5) this.setState('cover');
  }

  private doRetreat(dt: number, known: boolean, aimAt: THREE.Vector3 | null): void {
    const me = this.me; const t = me.target;
    if (this.stateTime < 0.05 || !this.cover || this.cover.pos.distanceTo(this.w.player?.position ?? me.pos) < 8) {
      const c = this.findCover(false, true);
      if (c) this.setCover(c);
    }
    if (!this.cover) { this.setState('engage'); return; }
    const dc = me.pos.distanceTo(this.cover.pos);
    if (dc < 0.55) { this.setState('cover'); this.role = 'suppress'; return; }
    this.moveAlong(this.cover.pos, MOVE.runSpeed * this.def.speedMul, dt);
    if (me.vel.lengthSq() > 0.1) me.faceDir(me.vel);
    t.aim = 0; t.sprint = 1; t.crouch = 0; t.hide = 0; t.lean = 0;
    t.aimDir.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    void known; void aimAt;
  }

  // ---------------- helpers ----------------
  private combatFacing(aimAt: THREE.Vector3, far: boolean, dt: number): void {
    const me = this.me; const t = me.target;
    const toP = _v.subVectors(aimAt, me.pos).setY(0).normalize();
    const mv = me.vel; const sp = mv.length();
    const facingMove = sp > 0.3 && (far || (mv.x * toP.x + mv.z * toP.z) / sp < -0.3);
    if (facingMove) { me.faceDir(mv); t.aim = far ? 0 : 0.5; t.sprint = far ? 1 : 0; t.aimDir.set(-Math.sin(me.yaw), -0.05, -Math.cos(me.yaw)); }
    else { me.facePoint(aimAt); t.aim = 1; t.sprint = 0; t.aimDir.copy(aimAt).sub(me.anim.muzzleWorld).normalize(); }
    void dt;
  }

  private tryFire(aimAt: THREE.Vector3, dt: number, suppress: boolean): void {
    const me = this.me;
    if (this.reaction > 0) return;
    // don't shoot into our own cover
    const m = me.anim.muzzleWorld;
    const toT = _fire.subVectors(aimAt, m); const d = toT.length();
    const hit = me.engine.physics.raycast(m, toT.divideScalar(d), Math.min(d, 3), groups(CG.ENEMY, CG.WORLD));
    this.muzzleBlocked = hit !== null;
    if (this.muzzleBlocked) return;
    me.fireAt(aimAt, dt, burstLength(this.def.burstMin, this.def.burstMax, d, this.rng.next()), suppress);
  }

  private suppress(aimAt: THREE.Vector3, dt: number): void {
    this.suppressT -= dt;
    if (this.suppressT > 0) return;
    if (this.w.time - this.lastSeenTime > PERCEPTION.memoryTime * 0.7) return;
    if (this.me.burst <= 0) this.suppressT = COMBAT.suppressInterval;
    this.tryFire(aimAt, dt, true);
  }

  private arrived(goal: THREE.Vector3, r: number): boolean { return distXZ([this.me.pos.x, 0, this.me.pos.z], [goal.x, 0, goal.z]) < r; }

  /** Stay planted at a point (small correction moves only). */
  private holdAt(p: THREE.Vector3, dt: number): void {
    const me = this.me;
    const d = _v.subVectors(p, me.pos).setY(0);
    const len = d.length();
    if (len > 0.12) { d.multiplyScalar(Math.min(MOVE.crouchSpeed, len * 4) / len); me.desiredVel.copy(d); me.speedCap = MOVE.crouchSpeed; }
    else me.desiredVel.set(0, 0, 0);
    void dt;
  }

  /** Follow a (re)planned path to `goal`, with steering and separation. */
  private moveAlong(goal: THREE.Vector3, speed: number, dt: number): void {
    const me = this.me;
    this.replanT -= dt;
    const g: V3 = [goal.x, goal.y, goal.z];
    if (this.path.length === 0 || this.replanT <= 0 || me.stuckTimer > MOVE.stuckTime) {
      this.replanT = MOVE.replanInterval;
      const from: V3 = [me.pos.x, me.pos.y, me.pos.z];
      const claimed = new Set<number>();
      for (const o of this.w.enemies) if (o !== me && o.alive && o.brain.path.length) { const n = o.brain.path[o.brain.pathIdx]; if (n) { const idx = nearestNode(this.w.nav, n, 1); if (idx >= 0) claimed.add(idx); } }
      this.path = planPath(this.w.nav, from, g, (i) => (claimed.has(i) ? 3 : 0));
      this.pathIdx = 0;
      if (me.stuckTimer > MOVE.stuckTime) {
        me.stuckTimer = 0;
        // detour: head to a random nearby graph node (or a random direction without a graph) for a while
        this.detourT = MOVE.detourTime;
        const near: V3[] = [];
        for (const n of this.w.nav) { const d = distXZ(n.p, from); if (d > 2 && d < 9 && Math.abs(n.p[1] - from[1]) < 1.5) near.push(n.p); }
        this.detour = near.length ? this.rng.pick(near) : [from[0] + this.rng.range(-5, 5), from[1], from[2] + this.rng.range(-5, 5)];
        this.path = [this.detour]; this.pathIdx = 0;
        this.steerAngle = this.rng.pick([1.2, -1.2, 2.2, -2.2]); this.whiskerT = 0.6;
      }
    }
    if (this.detourT > 0) { this.detourT -= dt; if (this.detour && this.path[0] !== this.detour) { this.path = [this.detour, g]; this.pathIdx = 0; } if (this.detourT <= 0) { this.detour = null; this.replanT = 0; } }
    // advance waypoints
    while (this.pathIdx < this.path.length - 1 && distXZ([me.pos.x, 0, me.pos.z], this.path[this.pathIdx]) < MOVE.arriveRadius + 0.3) this.pathIdx++;
    const wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
    const want = _v.set(wp[0] - me.pos.x, 0, wp[2] - me.pos.z);
    const dist = want.length();
    if (dist < 0.05) { me.desiredVel.set(0, 0, 0); return; }
    want.divideScalar(dist);
    // arrive
    const isLast = this.pathIdx >= this.path.length - 1;
    const sp = isLast ? Math.min(speed, Math.max(0.6, dist * 3)) : speed;
    want.multiplyScalar(sp);
    this.applySteer(want, dt);
    me.speedCap = speed;
  }

  /** Whisker obstacle avoidance + separation applied to a desired velocity. */
  private applySteer(want: THREE.Vector3, dt: number): void {
    const me = this.me;
    const sp = want.length();
    if (sp < 0.01) { me.desiredVel.set(0, 0, 0); return; }
    // whiskers (only when the straight line is blocked), refreshed at 8Hz
    this.whiskerT -= dt;
    if (this.whiskerT <= 0) {
      this.whiskerT = 0.12;
      const base = Math.atan2(-want.x, -want.z);
      const clear: number[] = [];
      let allClear = true;
      for (let i = 0; i < MOVE.whiskerAngles.length; i++) {
        const a = base + MOVE.whiskerAngles[i];
        const d = _v3.set(-Math.sin(a), 0, -Math.cos(a));
        let free = MOVE.whiskerLength;
        for (const h of MOVE.whiskerHeights) {
          const hit = me.engine.physics.raycast(_v2.set(me.pos.x, me.pos.y + h, me.pos.z), d, MOVE.whiskerLength, groups(CG.ENEMY, CG.WORLD));
          if (hit && hit.distance < free) free = hit.distance;
        }
        clear.push(free);
        if (i === 0 && free >= MOVE.whiskerLength * 0.6) { allClear = true; break; }
        if (i === 0) allClear = false;
      }
      this.steerAngle = allClear ? 0 : pickWhisker(MOVE.whiskerAngles, clear, MOVE.whiskerLength * 0.6);
    }
    if (this.steerAngle !== 0) {
      const a = Math.atan2(-want.x, -want.z) + this.steerAngle;
      want.set(-Math.sin(a) * sp, 0, -Math.cos(a) * sp);
    }
    // separation from squad-mates
    const others: V3[] = [];
    for (const o of this.w.enemies) if (o !== me && o.alive) others.push([o.pos.x, o.pos.y, o.pos.z]);
    const [sx, sz] = separation([me.pos.x, me.pos.y, me.pos.z], others, MOVE.separationRadius);
    want.x += sx * MOVE.separationWeight; want.z += sz * MOVE.separationWeight;
    me.desiredVel.copy(want);
  }

  /** Release our squad claim and take a new cover (or none). */
  private setCover(c: Cover | null): void {
    this.cover = c;
    if (c) this.w.claims.set(this.me.id, c.pos);
    else this.w.claims.delete(this.me.id);
  }

  private randomPoint(rMin: number, rMax: number): THREE.Vector3 {
    const me = this.me;
    // With a graph, pick among nodes that are actually in the requested ring. The old code took a
    // uniformly random node from the whole map, which turned "wander a bit" into "cross the arena".
    if (this.w.nav.length) {
      const from: V3 = [me.pos.x, me.pos.y, me.pos.z];
      const near: V3[] = [];
      for (const n of this.w.nav) { const d = distXZ(n.p, from); if (d >= rMin && d <= rMax && Math.abs(n.p[1] - from[1]) < 2) near.push(n.p); }
      if (near.length) { const n = this.rng.pick(near); return new THREE.Vector3(n[0], n[1], n[2]); }
    }
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(rMin, rMax);
      const p = new THREE.Vector3(me.pos.x + Math.cos(a) * r, me.pos.y, me.pos.z + Math.sin(a) * r);
      if (!this.w.bounds.containsPoint(p)) continue;
      if (this.clear(_v.set(me.pos.x, me.pos.y + 0.7, me.pos.z), _v2.set(p.x, p.y + 0.7, p.z))) return p;
    }
    return me.pos.clone();
  }

  /**
   * Advance-to-contact goal. What an advancing soldier wants is not the player's feet — walking
   * there is a long trip around whatever building is in the way — it is the nearest place on the
   * walkable graph that gains ground *and* has a sightline to him. Aiming at the player's position
   * instead had the squad following a fifteen-waypoint route around a block while the player stood
   * ten metres away behind one wall.
   */
  private approachPoint(target: THREE.Vector3): THREE.Vector3 {
    const me = this.me;
    const mePos: V3 = [me.pos.x, me.pos.y, me.pos.z];
    const tp: V3 = [target.x, target.y, target.z];
    const dNow = distXZ(mePos, tp);
    if (this.w.nav.length && dNow > 1e-3) {
      // a per-soldier lateral bias so the squad arrives on a frontage instead of in single file
      const bias = (((me.id % 4) - 1.5) / 1.5) * COMBAT.advanceSpread;
      const ux = (tp[0] - mePos[0]) / dNow, uz = (tp[2] - mePos[2]) / dNow;
      const cands: { p: V3; s: number }[] = [];
      for (const n of this.w.nav) {
        const dm = distXZ(n.p, mePos);
        if (dm < 1 || dm > COMBAT.advanceStride * 1.6) continue;
        if (Math.abs(n.p[1] - mePos[1]) > 2.5) continue;
        const dp = distXZ(n.p, tp);
        if (dp > dNow - 2) continue; // must actually gain ground on him
        const off = (n.p[0] - mePos[0]) * uz - (n.p[2] - mePos[2]) * ux;
        cands.push({ p: n.p, s: dp + dm * 0.35 + Math.abs(off - bias) * 0.25 });
      }
      if (cands.length) {
        cands.sort((a, b) => a.s - b.s);
        const eye = this.w.player?.eye;
        const probes = Math.min(cands.length, COMBAT.advanceProbes);
        if (eye) {
          for (let i = 0; i < probes; i++) {
            const c = cands[i].p;
            if (this.clear(_v.set(c[0], c[1] + PERCEPTION.eyeHeight, c[2]), eye)) return new THREE.Vector3(c[0], c[1], c[2]);
          }
        }
        const c = cands[0].p;
        return new THREE.Vector3(c[0], c[1], c[2]);
      }
    }
    // no graph: one stride toward him, fanned sideways
    const to = _v.subVectors(target, me.pos).setY(0);
    const d = to.length();
    if (d < 1e-3) return target.clone();
    to.divideScalar(d);
    const stride = Math.min(d, COMBAT.advanceStride);
    const side = _v2.set(to.z, 0, -to.x);
    const spread = (((me.id % 4) - 1.5) / 1.5) * COMBAT.advanceSpread * Math.min(1, d / COMBAT.advanceStride);
    const g = new THREE.Vector3().copy(me.pos).addScaledVector(to, stride).addScaledVector(side, spread);
    g.y = target.y;
    if (!this.w.bounds.containsPoint(g)) g.copy(target);
    return g;
  }

  /**
   * Cover search. Candidates are the level's cover nodes plus a procedural ring, filtered to what
   * we could plausibly walk to, ranked by the ray-free part of the score, then probed best-first
   * with an admissible bound so the LOS rays are spent on the candidates that can actually win.
   *
   * Two rules earned by a wave-1 trace where the squad backed off to 27 m and went silent:
   *  - a cover position more than `coverMaxTravel` from us is a retreat, not cover. The old search
   *    fed all 546 of the level's cover nodes in authoring order into a flat 140-ray budget, so it
   *    broke out after ~70 array entries and returned the best of an arbitrary early slice of the
   *    map: a hole 31 m from the player with no firing line, while a peekable spot 5 m away and
   *    14 m from the player went unexamined.
   *  - cover you cannot shoot from is a hiding place. Unless we are deliberately retreating, a
   *    candidate has to be `peekable`; when nothing is, we return null and the caller fights in
   *    the open rather than sprinting off to hide.
   */
  findCover(advance: boolean, retreat = false): Cover | null {
    const me = this.me; const p = this.w.player;
    if (!p) return null;
    const mePos: V3 = [me.pos.x, me.pos.y, me.pos.z];
    const pPos: V3 = [p.position.x, p.position.y, p.position.z];
    const dNow = distXZ(mePos, pPos);
    let dMin = COMBAT.engageDistanceMin, dMax = COMBAT.engageDistanceMax;
    if (advance) { dMin = Math.max(4, dNow * 0.4); dMax = Math.max(dMin + 3, dNow * 0.85); }
    if (retreat) { dMin = dNow + 4; dMax = dNow + 14; }
    if (this.role === 'flank' && !retreat) { dMin = Math.max(5, dNow * 0.5); }
    if (!retreat && this.push > 0) {
      // pressure pulls the whole band in until we have something to shoot at
      dMax = Math.max(COMBAT.pushMinDistance + 2, dMax - this.push);
      dMin = Math.max(COMBAT.pushMinDistance, Math.min(dMin, dMax - 2));
    }
    const travel = retreat ? COMBAT.coverMaxTravel * 1.6 : COMBAT.coverMaxTravel;

    // squad bearing for flankers: prefer a different angle around the player than the others
    let squadBearing = 0, nSquad = 0;
    for (const o of this.w.enemies) if (o !== me && o.alive) { squadBearing += Math.atan2(o.pos.z - p.position.z, o.pos.x - p.position.x); nSquad++; }
    if (nSquad) squadBearing /= nSquad;

    // ---- gather + prescore (no rays) ----
    const cands: { c: V3; pre: number; level: boolean }[] = [];
    const add = (c: V3, level: boolean): void => {
      if (distXZ(c, mePos) > travel) return;
      const dp = distXZ(c, pPos);
      if (dp < 3 || dp > COMBAT.maxRange) return;
      if (!this.w.bounds.containsPoint(_v.set(c[0], me.pos.y, c[2]))) return;
      for (const [id, cp] of this.w.claims) if (id !== me.id && distXZ([cp.x, cp.y, cp.z], c) < COMBAT.coverClaimRadius) return;
      let pre = coverPrescore(c, mePos, pPos, dMin, dMax) + (level ? 2 : 0);
      if (this.role === 'flank' && nSquad) {
        const b = Math.atan2(c[2] - p.position.z, c[0] - p.position.x);
        let db = b - squadBearing; db = Math.abs(Math.atan2(Math.sin(db), Math.cos(db)));
        pre += clamp(db / COMBAT.flankAngle, 0, 1.5) * 3;
      }
      cands.push({ c, pre, level });
    };
    for (const c of this.w.coverNodes) add([c.x, c.y, c.z], true);
    for (const c of ringSamples(mePos, COMBAT.coverSearchRadii, COMBAT.coverSearchSamples, this.rng.range(0, Math.PI * 2))) add(c, false);
    // when the player is far, also sample around a point pushed toward him so we close to engagement range
    if (!retreat && dNow > dMax + 4) {
      const k = (dNow - dMax * 0.9) / dNow;
      const adv: V3 = [mePos[0] + (pPos[0] - mePos[0]) * k, mePos[1], mePos[2] + (pPos[2] - mePos[2]) * k];
      for (const c of ringSamples(adv, [3, 6], COMBAT.coverSearchSamples, this.rng.range(0, Math.PI * 2))) add(c, false);
    }
    cands.sort((a, b) => b.pre - a.pre);

    // ---- probe best-first ----
    let best: Cover | null = null, bestScore = -Infinity, probes = 0;
    const eye = p.eye;
    const crouchHead = new THREE.Vector3(), standHead = new THREE.Vector3();
    const scan = Math.min(cands.length, COMBAT.coverProbeScan);
    for (let i = 0; i < scan && probes < COMBAT.coverProbeBudget; i++) {
      const cand = cands[i];
      // the prescore plus the best possible peek bonus bounds the final score from above
      if (best && cand.pre + COVER_PEEK_BONUS <= bestScore) break;
      // must be near the walkable graph (level cover nodes are graph nodes by construction)
      if (!cand.level && this.w.nav.length && nearestNode(this.w.nav, cand.c, 2.5) < 0) continue;
      const cv = new THREE.Vector3(cand.c[0], me.pos.y, cand.c[2]);
      if (this.w.nav.length === 0 && !this.clear(_v.set(me.pos.x, me.pos.y + 0.7, me.pos.z), _v2.set(cv.x, cv.y + 0.7, cv.z))) continue;
      probes++;
      crouchHead.set(cv.x, cv.y + PERCEPTION.crouchEyeHeight, cv.z);
      const hidden = !this.clear(crouchHead, eye);
      if (!hidden) continue;
      standHead.set(cv.x, cv.y + PERCEPTION.eyeHeight, cv.z);
      const standClear = this.clear(standHead, eye);
      let peekSide = 0, peekable = standClear;
      const peekPos = cv.clone();
      if (!standClear) {
        const toP = _v3.set(eye.x - cv.x, 0, eye.z - cv.z).normalize();
        const right = _v4.set(toP.z, 0, -toP.x);
        for (const sgn of [1, -1]) {
          const pp = new THREE.Vector3().copy(cv).addScaledVector(right, sgn * COMBAT.coverPeekOffset);
          if (this.clear(_v.set(pp.x, pp.y + PERCEPTION.eyeHeight, pp.z), eye)) { peekSide = sgn; peekable = true; peekPos.copy(pp); break; }
        }
      }
      // cover with no firing line is a hiding place; only a deliberate retreat may take one
      if (!peekable && !retreat) continue;
      const score = coverScore(cand.c, mePos, pPos, hidden, peekable, dMin, dMax, false) + (cand.level ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = { pos: cv, low: standClear, peekSide, peekPos }; }
    }
    if (best) this.w.claims.set(me.id, best.pos);
    return best;
  }
}

export { ACCURACY };
