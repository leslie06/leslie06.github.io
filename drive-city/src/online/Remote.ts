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
const PELVIS_Y = SKELETON[J.pelvis].offset[1];
const TAG_FAR = 1500;
const _a = new THREE.Vector3(), _f = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

const hashOf = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * A friend in the room, as this game draws them: their car (the full-detail model, as the player's own, with a
 * kinematic body of the car's shape so that you can hit it) or themselves on foot (one of the crowd), a name over
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
  /** Last time the kinematic body was jumped (a teleport): hits are not counted for a moment. */
  jumpedAt = 0;
  /**
   * The car is solid to yours. It starts as a ghost (passing through) and after every jump, and turns solid only once
   * it is clear of your car: two players start on the same spot, and a kinematic body made inside your car would throw
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
  }

  /** Where they are at `now` (our clock), into pos / quat / vel / yaw / foot / state. False before the first state. */
  sample(now: number): boolean {
    const S = this.snaps;
    if (!S.length) return false;
    const rt = now - DELAY;
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

  /** A kinematic body of the car's shape: your car bumps into theirs (they feel it through Multiplayer's hit events). */
  private makeBody(): void {
    this.dropBody();
    const { R, world } = this.engine.physics;
    const at = this.car()?.pos ?? this.pos;
    this.kin = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z));
    for (const c of this.spec.chassis) {
      const cd = R.ColliderDesc.roundCuboid(c.half[0] - c.round, c.half[1] - c.round, c.half[2] - c.round, c.round)
        .setTranslation(c.at[0], c.at[1], c.at[2]).setFriction(0.3).setRestitution(0.05)
        .setCollisionGroups(groups(CG.CAR, CG.WORLD | CG.CAR | CG.PROP));
      const col = world.createCollider(cd, this.kin);
      this.engine.physics.tag(col, { tag: 'car', surface: 'metal' });
    }
    this.jumpedAt = performance.now();
    this.setSolid(false);
  }

  /** Solid to cars (and the world's props), or a ghost that only the world's static geometry is set against. */
  private setSolid(on: boolean): void {
    this.solid = on;
    if (!this.kin) return;
    for (let i = 0; i < this.kin.numColliders(); i++) {
      this.kin.collider(i).setCollisionGroups(on ? groups(CG.CAR, CG.WORLD | CG.CAR | CG.PROP) : groups(CG.CAR, 0));
    }
  }

  /** Called each step with how far your car is: a ghost turns solid once it is clear of it. */
  clearOf(dist: number): void {
    if (!this.solid && this.kin?.isEnabled() && dist > 6) this.setSolid(true);
  }

  /** The car's colliders (for Multiplayer's contact check), or none. */
  colliders(): RAPIER_NS.Collider[] {
    if (!this.kin || !this.kin.isEnabled() || !this.solid) return [];
    const out: RAPIER_NS.Collider[] = [];
    for (let i = 0; i < this.kin.numColliders(); i++) out.push(this.kin.collider(i));
    return out;
  }
  get mass(): number { return this.spec.mass; }

  /** Physics step: the kinematic body follows the drawn car (a jump is a jump, not a sweep). */
  fixed(now: number): void {
    if (!this.kin || !this.sample(now)) return;
    const c = this.car();
    if (!c) { if (this.kin.isEnabled()) this.kin.setEnabled(false); return; }
    if (!this.kin.isEnabled()) { this.kin.setEnabled(true); this.kin.setTranslation(c.pos, true); this.jumpedAt = now; this.setSolid(false); }
    const t = this.kin.translation();
    if (Math.hypot(t.x - c.pos.x, t.y - c.pos.y, t.z - c.pos.z) > 8) {
      this.kin.setTranslation(c.pos, true); this.kin.setRotation(c.quat, true); this.jumpedAt = now; this.setSolid(false);
    } else {
      this.kin.setNextKinematicTranslation(c.pos);
      this.kin.setNextKinematicRotation(c.quat);
    }
  }

  /** Draw them this frame: the car, a rider on a two-wheeler, the person on foot, the name tag. */
  update(dt: number, now: number): void {
    if (!this.sample(now)) { this.tag.hidden = true; return; }
    const pl = this.engine.get<PlayerApi>('player');
    const c = this.car();
    if (c && c.s.b) {
      const m = this.ensureModel(c.s);
      if (m) {
        if (!this.kin) this.makeBody();
        m.root.visible = true;
        m.root.position.copy(c.pos); m.root.quaternion.copy(c.quat);
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
          const at = _a.set(seat[0], seat[1], seat[2]).applyQuaternion(c.quat).add(c.pos);
          const fwd = _f.set(0, 0, 1).applyQuaternion(c.quat);
          this.riderMotion.speed = s.sp ?? 0;
          this.riderMotion.ride = s.b as 'moto' | 'bike' | 'ebike';
          this.riderMotion.lean = s.ln?.[1] ?? 0;
          this.rider.update(this.riderMotion, dt, this.seed % 997);
          at.y -= PELVIS_Y * this.rider.scale;
          pl.crowd.add(at, Math.atan2(fwd.x, fwd.z), this.rider, this.look);
        }
      }
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
