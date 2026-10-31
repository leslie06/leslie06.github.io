import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { PlayerApi } from '../game/Contracts';
import type { RenderSystem } from '../render';
import { Gait, type Motion } from '../character/Animator';
import { J, randomLook, SKELETON, type Look } from '../character/Body';
import { buildCar, defaultLivery, type CarModel } from '../vehicle/CarModel';
import { BODY_TYPES, bodySettled, readyBodies, type BodySource, type BodyType } from '../vehicle/Bodies';
import { SPEC_OF, TAXI, type VehicleSpec } from '../vehicle/Spec';
import { SEAT } from '../vehicle/TwoWheelers';

/**
 * What a player sends of themselves (online/Multiplayer.ts, ~10 a second): their clock (ms), driving or on foot, where,
 * and enough of the car to draw it - body, paints, wheel steer and suspension, lean, lights, speed for the wheels' spin.
 */
export interface NetState {
  ts: number;
  m: 'd' | 'f';
  p: [number, number, number];
  v: [number, number, number];
  /** Driving: the car's rotation. On foot: the facing (yaw). */
  q?: [number, number, number, number];
  y?: number;
  b?: BodyType;
  c?: [string, string];
  tx?: number;
  /** Front wheels' steer, the four springs' length, the drawn lean (pitch, roll), forward speed. */
  ws?: [number, number];
  wl?: [number, number, number, number];
  ln?: [number, number];
  sp?: number;
  /** Brake, reverse and head lights. */
  li?: number;
  /** On foot: ground speed (the walk), and an action ('punch'...) if any. */
  fs?: number;
  /** Their time of day (hours): the room's first player's is everyone's clock. */
  tm?: number;
}

const num = (x: unknown, lim = 1e6): number | null => (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < lim ? x : null);
const vec = (a: unknown, n: number, lim = 1e6): number[] | null => {
  if (!Array.isArray(a) || a.length !== n) return null;
  const out = a.map((x) => num(x, lim));
  return out.every((x) => x !== null) ? out as number[] : null;
};
const HEX = /^#[0-9a-f]{6}$/i;
/** A state off the wire, checked: anything malformed is dropped rather than drawn (or crashing the physics). */
export function cleanState(m: Record<string, unknown>): NetState | null {
  const ts = num(m.ts, 1e12), p = vec(m.p, 3), v = vec(m.v, 3, 400);
  if (ts === null || !p || !v || (m.m !== 'd' && m.m !== 'f')) return null;
  const s: NetState = { ts, m: m.m, p: p as NetState['p'], v: v as NetState['v'] };
  const tm = num(m.tm, 25);
  if (tm !== null && tm >= 0) s.tm = tm;
  if (m.m === 'd') {
    const q = vec(m.q, 4, 2);
    if (!q || !BODY_TYPES.includes(m.b as BodyType)) return null;
    s.q = q as NetState['q']; s.b = m.b as BodyType;
    const c = m.c;
    s.c = Array.isArray(c) && c.length === 2 && HEX.test(String(c[0])) && HEX.test(String(c[1])) ? [String(c[0]), String(c[1])] : ['#888888', '#888888'];
    s.tx = m.tx === 1 ? 1 : 0;
    s.ws = (vec(m.ws, 2, 2) ?? [0, 0]) as NetState['ws'];
    s.wl = (vec(m.wl, 4, 3) ?? undefined) as NetState['wl'];
    s.ln = (vec(m.ln, 2, 2) ?? [0, 0]) as NetState['ln'];
    s.sp = num(m.sp, 400) ?? 0;
    s.li = num(m.li, 8) ?? 0;
  } else {
    s.y = num(m.y, 100) ?? 0;
    s.fs = num(m.fs, 50) ?? 0;
  }
  return s;
}

interface Snap { t: number; foot: boolean; p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; yaw: number; s: NetState }

/** How far behind the newest state a peer is drawn (ms): two sends' worth, so there is nearly always a pair to blend. */
const DELAY = 160;
/** Past the newest state, carry on along its velocity at most this long (ms), then hold. */
const EXTRA = 300;
/** Further than this between two states is a jump (a teleport, a respawn): no blending across it. */
const JUMP = 25;
/**
 * A car this near yours is drawn where it is now, not `DELAY` ago: carried on from the newest state along its
 * velocity (2026-10-30, 「一个碰另外一个，看不到撞击感，被撞时只会撞一段距离，但看不到是另一个车撞的」 - 160 ms late, the
 * car that hit you was still 2 m short of you when you were pushed). The delay slides there and back at half speed.
 */
const NEAR = 30;
/** A new state moves the drawn car at most this much (m) without a jump; the step is eased away over SMOOTH (ms). */
const SNAP_MAX = 3, SMOOTH = 120;
/**
 * Their car here is a body with their car's mass, pulled towards where they are (velocity matched, the gap closed at
 * PULL per second) by at most AMAX m/s² - a car's worth, not a wall's. So a crash between yours and theirs is worked
 * out by the physics on each side, each with its own car (2026-10-30): the car hit is pushed by its share and the one
 * hitting slows by its share, here as there, and nothing has to be sent. It floats (no gravity, not set against the
 * ground), its height following theirs; further than JUMP_BODY off, it jumps.
 */
const PULL = 6, AMAX = 14, ROT_K = 10, JUMP_BODY = 8;
/** Closing the gap adds at most this to their speed (m/s): a car fallen behind does not overtake them at a rush. */
const CATCH = 3;
/**
 * Touching your car, it is let go for COAST ms (a free body, sliding as the crash left it): their states from before
 * the crash, carried on at the speed it had, would have it drive on into you and shove your car on and on.
 */
const COAST = 450;
const PELVIS_Y = SKELETON[J.pelvis].offset[1];
const TAG_FAR = 1500;
const _a = new THREE.Vector3(), _f = new THREE.Vector3(), _o = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
/** A rotation as a vector: its axis times its angle (the shorter way round). */
const rotVec = (q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 => {
  const w = Math.min(1, Math.abs(q.w)), sgn = q.w < 0 ? -1 : 1, sin = Math.sqrt(1 - w * w);
  if (sin < 1e-6) return out.set(q.x, q.y, q.z).multiplyScalar(2 * sgn);
  return out.set(q.x, q.y, q.z).multiplyScalar(sgn * 2 * Math.acos(w) / sin);
};
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

const hashOf = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * A friend in the room, as this game draws them: their car (the full-detail model, as the player's own, with a
 * body of the car's shape and mass so that you can hit it) or themselves on foot (one of the crowd), a name over
 * their head, a blip on the radar. Drawn `DELAY` behind what they sent, blended between the two states either side.
 * The car they got out of stays where they left it, while they are near it.
 */
export class RemotePeer {
  private snaps: Snap[] = [];
  /** Their clock to ours (ms): the lowest seen (receive time - send time), allowed to creep up slowly. */
  private off: number | null = null;
  /** Sampled this frame. */
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  foot = false;
  state: NetState | null = null;
  /** Where the car they drove stands (while they are near it on foot), and its look. */
  private carPos = new THREE.Vector3();
  private carQuat = new THREE.Quaternion();
  private carState: NetState | null = null;
  private model: CarModel | null = null;
  private modelKey = '';
  private spec: VehicleSpec = TAXI;
  private kin: RAPIER_NS.RigidBody | null = null;
  /** The body type a model is being fetched for. */
  private waiting: BodyType | null = null;
  private readonly gait = new Gait();
  private readonly rider = new Gait();
  private readonly look: Look;
  private readonly seed: number;
  private spin = 0;
  private paintKey = '';
  private readonly tag: HTMLDivElement;
  private readonly tagName: HTMLSpanElement;
  private readonly tagDist: HTMLSpanElement;
  private readonly motion: Motion = { speed: 0, action: 'move', t: 0 };
  private readonly riderMotion: Motion = { speed: 0, action: 'ride', t: 0, ride: 'ebike', lean: 0 };
  /** How far behind their newest state they are drawn (ms), sliding towards `wantDelay`. */
  private delay = DELAY;
  private wantDelay = DELAY;
  private lastNow = 0;
  /** What a new state moved the drawn car by, eased away (`SMOOTH`). */
  private readonly offset = new THREE.Vector3();
  private offsetAt = 0;
  /** The body's pose before and after the last physics step, to draw it between them. */
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly curPos = new THREE.Vector3();
  private readonly curQuat = new THREE.Quaternion();
  private readonly drawPos = new THREE.Vector3();
  private readonly drawQuat = new THREE.Quaternion();
  /** Let go until then (`COAST`). */
  private coastUntil = 0;
  /** Their car's rotation at the last step (its turn rate). */
  private readonly lastQuat = new THREE.Quaternion();
  /** Last time the body was jumped (a teleport). */
  jumpedAt = 0;
  /**
   * The car is solid to yours. It starts as a ghost (passing through) and after every jump, and turns solid only once
   * it is clear of your car: two players start on the same spot, and a body made inside your car would throw
   * it tens of metres.
   */
  private solid = false;

  constructor(private readonly engine: Engine, readonly id: number, public name: string, tagLayer: HTMLElement) {
    this.seed = hashOf(name + id);
    this.look = randomLook(rng(this.seed));
    this.tag = document.createElement('div');
    this.tag.className = 'mp-tag';
    this.tagName = document.createElement('span');
    this.tagName.textContent = name;
    this.tagDist = document.createElement('span');
    this.tagDist.className = 'd';
    this.tag.append(this.tagName, this.tagDist);
    this.tag.hidden = true;
    tagLayer.appendChild(this.tag);
  }

  rename(name: string): void { this.name = name; this.tagName.textContent = name; }

  push(s: NetState): void {
    const now = performance.now(), off = now - s.ts;
    const had = this.snaps.length > 0 && this.sample(now);
    if (had) _o.copy(this.pos);
    // the lower envelope of the delay, rising 2 ms a state if the link gets slower
    this.off = this.off === null ? off : Math.min(off, this.off + 2);
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.ts <= last.s.ts) return;
    const foot = s.m === 'f';
    const snap: Snap = {
      t: s.ts + this.off, foot, s,
      p: new THREE.Vector3(...s.p), v: new THREE.Vector3(...s.v),
      q: foot ? new THREE.Quaternion().setFromAxisAngle(_up, s.y ?? 0) : new THREE.Quaternion(...s.q!).normalize(),
      yaw: foot ? s.y ?? 0 : 0,
    };
    // leaving the car: it stays where it was last driven
    if (foot && last && !last.foot) { this.carPos.copy(last.p); this.carQuat.copy(last.q); this.carState = last.s; }
    if (!foot) this.carState = s;
    this.snaps.push(snap);
    if (this.snaps.length > 30) this.snaps.splice(0, this.snaps.length - 30);
    // what this state moved the drawn car by is eased away, not jumped
    if (had) {
      this.offsetAt = 0;
      this.sample(now);
      _o.sub(this.pos);
      if (_o.length() < SNAP_MAX && foot === (last?.foot ?? foot)) { this.offset.copy(_o); this.offsetAt = now; }
    }
  }

  /** Their car is `dist` from yours: near, it is drawn where it is now. */
  setNear(dist: number): void { this.wantDelay = dist < NEAR ? 0 : DELAY; }



  /** Where they are at `now` (our clock), into pos / quat / vel / yaw / foot / state. False before the first state. */
  sample(now: number): boolean {
    const S = this.snaps;
    if (!S.length) return false;
    if (now > this.lastNow) {
      const step = this.lastNow ? now - this.lastNow : 0;
      this.delay += Math.max(-step / 2, Math.min(step / 2, this.wantDelay - this.delay));
      this.lastNow = now;
    }
    const rt = now - this.delay;
    let i = S.length - 1;
    while (i > 0 && S[i].t > rt) i--;
    const a = S[i], b = S[i + 1];
    this.state = (b && rt >= b.t ? b : a).s;
    this.foot = a.foot;
    if (b && a.foot === b.foot && a.p.distanceTo(b.p) < JUMP && rt >= a.t) {
      const k = Math.min(1, (rt - a.t) / Math.max(1, b.t - a.t));
      this.pos.lerpVectors(a.p, b.p, k);
      this.quat.slerpQuaternions(a.q, b.q, k);
      this.vel.lerpVectors(a.v, b.v, k);
      this.yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * k;
    } else {
      const s = b && rt >= b.t ? b : a;
      const ahead = Math.min(EXTRA, Math.max(0, rt - s.t)) / 1000;
      this.pos.copy(s.p).addScaledVector(s.v, ahead);
      this.quat.copy(s.q); this.vel.copy(s.v); this.yaw = s.yaw; this.foot = s.foot;
      this.state = s.s;
    }
    if (this.offsetAt) {
      const e = Math.exp(-Math.max(0, now - this.offsetAt) / SMOOTH);
      if (e < 0.01) this.offsetAt = 0;
      else this.pos.addScaledVector(this.offset, e);
    }
    return true;
  }

  /** Where their car is (driven or left nearby), or null. */
  carAt(): THREE.Vector3 | null { return this.car()?.pos ?? null; }

  /** The car to draw and hit: the one they drive, or the one they left nearby. */
  private car(): { pos: THREE.Vector3; quat: THREE.Quaternion; s: NetState } | null {
    if (!this.foot && this.state?.m === 'd') return { pos: this.pos, quat: this.quat, s: this.state };
    if (this.carState && this.pos.distanceTo(this.carPos) < 80) return { pos: this.carPos, quat: this.carQuat, s: this.carState };
    return null;
  }

  /** The full-detail model of this body, built once its Blender mesh is in. */
  private ensureModel(s: NetState): CarModel | null {
    const body = s.b!;
    const key = `${body}`;
    if (this.model && this.modelKey === key) return this.model;
    const blender = (BODY_TYPES as readonly string[]).includes(body) && !['moto', 'bike', 'ebike'].includes(body);
    if (blender && !bodySettled(body as BodySource)) {
      if (this.waiting !== body) { this.waiting = body; void readyBodies([body as BodySource]).catch(() => {}); }
      return this.model && this.modelKey === key ? this.model : null;
    }
    this.dropModel();
    this.spec = SPEC_OF[body] ?? TAXI;
    const m = buildCar(this.spec, defaultLivery(body), body);
    this.engine.get<RenderSystem>('render')?.prepare(m.root);
    this.engine.scene.add(m.root);
    this.model = m; this.modelKey = key; this.paintKey = '';
    this.makeBody();
    return m;
  }

  /** A body of the car's shape and mass (see PULL): your car and theirs crash as two cars do. */
  private makeBody(): void {
    this.dropBody();
    const { R, world } = this.engine.physics;
    const c = this.car(), at = c?.pos ?? this.pos, s = this.spec;
    this.kin = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setGravityScale(0)
      .setAdditionalMassProperties(s.mass, { x: s.com[0], y: s.com[1], z: s.com[2] }, { x: s.inertia[0], y: s.inertia[1], z: s.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 })
      .setCcdEnabled(true));
    if (c) this.kin.setRotation(c.quat, false);
    for (const ch of s.chassis) {
      const cd = R.ColliderDesc.roundCuboid(ch.half[0] - ch.round, ch.half[1] - ch.round, ch.half[2] - ch.round, ch.round)
        .setTranslation(ch.at[0], ch.at[1], ch.at[2]).setDensity(0).setFriction(0.3).setRestitution(0.05);
      const col = world.createCollider(cd, this.kin);
      this.engine.physics.tag(col, { tag: 'car', surface: 'metal' });
    }
    this.jumped(c?.pos ?? at, c?.quat ?? this.quat, performance.now());
  }

  /** Put the body there at once (a first sight, a teleport, a car got back into): a ghost until clear of yours. */
  private jumped(pos: THREE.Vector3, quat: THREE.Quaternion, now: number): void {
    const k = this.kin!;
    k.setTranslation(pos, true); k.setRotation(quat, true);
    k.setLinvel(this.foot ? { x: 0, y: 0, z: 0 } : this.vel, true); k.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevPos.copy(pos); this.curPos.copy(pos); this.prevQuat.copy(quat); this.curQuat.copy(quat); this.lastQuat.copy(quat);
    this.jumpedAt = now;
    this.setSolid(false);
  }

  /** Solid to cars and the world's props, or a ghost (set against nothing). Never against the ground: it floats. */
  private setSolid(on: boolean): void {
    this.solid = on;
    if (!this.kin) return;
    for (let i = 0; i < this.kin.numColliders(); i++) {
      this.kin.collider(i).setCollisionGroups(on ? groups(CG.CAR, CG.CAR | CG.PROP) : groups(CG.CAR, 0));
    }
  }

  /** Called each step with how far your car is: a ghost turns solid once it is clear of it. */
  clearOf(dist: number): void {
    if (!this.solid && this.kin?.isEnabled() && dist > 6) this.setSolid(true);
  }

  /** Physics step, before it: the body is pulled towards their car (or the one they left), by a car's force. */
  fixed(now: number, dt: number, mine: readonly RAPIER_NS.Collider[]): void {
    if (!this.kin || !this.sample(now)) return;
    const c = this.car(), k = this.kin;
    if (!c) { if (k.isEnabled()) k.setEnabled(false); return; }
    if (!k.isEnabled()) { k.setEnabled(true); this.jumped(c.pos, c.quat, now); return; }
    const t = k.translation();
    if (Math.hypot(t.x - c.pos.x, t.y - c.pos.y, t.z - c.pos.z) > JUMP_BODY) { this.jumped(c.pos, c.quat, now); return; }
    this.prevPos.copy(this.curPos); this.prevQuat.copy(this.curQuat);
    if (this.solid && this.touching(mine)) this.coastUntil = now + COAST;
    const lv = k.linvel();
    if (now < this.coastUntil) {
      // let go: only its height still follows theirs
      this.lastQuat.copy(c.quat);
      k.setLinvel({ x: lv.x, y: (c.pos.y - t.y) * PULL, z: lv.z }, true);
      return;
    }
    // the speed to have: theirs, and the gap closed at PULL; a ghost takes it outright, a solid car by AMAX at most
    const driving = c.s === this.state && !this.foot;
    _a.set(c.pos.x - t.x, c.pos.y - t.y, c.pos.z - t.z).multiplyScalar(PULL);
    if (_a.length() > CATCH) _a.setLength(CATCH);
    if (driving) _a.add(this.vel);
    _f.set(_a.x - lv.x, _a.y - lv.y, _a.z - lv.z);
    const most = AMAX * dt;
    if (this.solid && _f.length() > most) _f.setLength(most);
    k.setLinvel({ x: lv.x + _f.x, y: lv.y + _f.y, z: lv.z + _f.z }, true);
    // turning: their turn rate, and what is left of the angle closed at ROT_K
    _q1.copy(c.quat).multiply(_q2.copy(this.lastQuat).invert());
    this.lastQuat.copy(c.quat);
    rotVec(_q1, _a).divideScalar(Math.max(dt, 1e-3));
    const r = k.rotation();
    _q1.copy(c.quat).multiply(_q2.set(r.x, r.y, r.z, r.w).invert());
    _a.addScaledVector(rotVec(_q1, _f), ROT_K);
    k.setAngvel(_a, true);
  }

  /** Probes: the body's speed and whether it is let go. */
  get debugBody(): { v: number[]; coast: boolean; solid: boolean } | null {
    if (!this.kin?.isEnabled()) return null;
    const v = this.kin.linvel();
    return { v: [v.x, v.y, v.z], coast: performance.now() < this.coastUntil, solid: this.solid };
  }

  /** In contact with one of these colliders (your car's) after the last step. */
  private touching(mine: readonly RAPIER_NS.Collider[]): boolean {
    const k = this.kin!, world = this.engine.physics.world;
    let hit = false;
    for (let i = 0; i < k.numColliders() && !hit; i++) {
      const a = k.collider(i);
      for (const b of mine) world.contactPair(a, b, (m) => { if (m.numContacts() > 0) hit = true; });
    }
    return hit;
  }

  /** Physics step, after it: where the body ended up, to draw. */
  afterStep(): void {
    if (!this.kin?.isEnabled()) return;
    const t = this.kin.translation(), r = this.kin.rotation();
    this.curPos.set(t.x, t.y, t.z); this.curQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Draw them this frame: the car, a rider on a two-wheeler, the person on foot, the name tag. */
  update(dt: number, now: number, alpha: number): void {
    if (!this.sample(now)) { this.tag.hidden = true; return; }
    const pl = this.engine.get<PlayerApi>('player');
    const c = this.car();
    if (c && c.s.b) {
      const m = this.ensureModel(c.s);
      if (m) {
        if (!this.kin) this.makeBody();
        // where the body is (pushed by a crash here), between the last two steps
        const k = this.kin!;
        if (k.isEnabled()) { this.drawPos.lerpVectors(this.prevPos, this.curPos, alpha); this.drawQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha); }
        else { this.drawPos.copy(c.pos); this.drawQuat.copy(c.quat); }
        const P = this.drawPos, Q = this.drawQuat;
        m.root.visible = true;
        m.root.position.copy(P); m.root.quaternion.copy(Q);
        const s = c.s, driving = c.s === this.state && !this.foot;
        const pk = `${s.c![0]}${s.c![1]}${s.tx}`;
        if (pk !== this.paintKey) { this.paintKey = pk; m.setPaint(_c1.set(s.c![0]), _c2.set(s.c![1]), s.tx === 1); }
        if (driving) this.spin += (s.sp ?? 0) / this.spec.wheelRadius * dt;
        for (let i = 0; i < 4 && i < m.hubs.length; i++) {
          const w = this.spec.wheels[i];
          m.hubs[i].position.y = this.spec.mountY - (s.wl?.[i] ?? this.spec.suspension.restLength * 0.8);
          m.hubs[i].rotation.y = w.front ? (s.ws?.[i] ?? 0) : 0;
          m.spinners[i].rotation.x = this.spin;
        }
        m.body.rotation.set(s.ln?.[0] ?? 0, 0, s.ln?.[1] ?? 0);
        const li = driving ? s.li ?? 0 : 0;
        m.setLights({ brake: !!(li & 1), reverse: !!(li & 2), head: !!(li & 4) });
        // a two-wheeler's rider, as traffic draws theirs
        if (driving && this.spec.single && pl) {
          const seat = SEAT[s.b as 'moto' | 'bike' | 'ebike'] ?? SEAT.ebike;
          const at = _a.set(seat[0], seat[1], seat[2]).applyQuaternion(Q).add(P);
          const fwd = _f.set(0, 0, 1).applyQuaternion(Q);
          this.riderMotion.speed = s.sp ?? 0;
          this.riderMotion.ride = s.b as 'moto' | 'bike' | 'ebike';
          this.riderMotion.lean = s.ln?.[1] ?? 0;
          this.rider.update(this.riderMotion, dt, this.seed % 997);
          at.y -= PELVIS_Y * this.rider.scale;
          pl.crowd.add(at, Math.atan2(fwd.x, fwd.z), this.rider, this.look);
        }
      } else if (this.model) this.model.root.visible = false;
    } else if (this.model) this.model.root.visible = false;
    if (this.foot && pl) {
      this.motion.speed = this.state?.fs ?? 0;
      this.gait.update(this.motion, dt, this.seed % 997);
      pl.crowd.add(this.pos, this.yaw, this.gait, this.look);
    }
    this.placeTag();
  }

  private placeTag(): void {
    const cam = this.engine.camera;
    const at = _a.set(this.pos.x, this.pos.y + (this.foot ? 2.15 : 2.0), this.pos.z);
    const d = cam.position.distanceTo(at);
    const v = at.project(cam);
    if (v.z > 1 || d > TAG_FAR || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { this.tag.hidden = true; return; }
    const W = innerWidth, H = innerHeight;
    this.tag.hidden = false;
    this.tag.style.transform = `translate(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px) translate(-50%, -100%)`;
    this.tag.style.opacity = d > 400 ? '0.75' : '1';
    this.tagDist.textContent = d > 60 ? ` · ${Math.round(d)}m` : '';
  }

  private dropModel(): void {
    if (!this.model) return;
    this.engine.scene.remove(this.model.root);
    this.model.dispose();
    this.model = null; this.modelKey = '';
  }
  private dropBody(): void {
    if (this.kin) this.engine.physics.world.removeRigidBody(this.kin);
    this.kin = null;
  }

  dispose(): void {
    this.dropModel();
    this.dropBody();
    this.tag.remove();
  }
}
