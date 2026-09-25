import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { SharedBike, VehicleApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import type { FxApi } from '../fx';
import type { Furniture } from './visual/StreetFurniture';

/**
 * Street furniture the player's car can knock flying: sorting bins, shared bikes and railings.
 * They are drawn by the streamer's instanced pools and have no colliders (thousands per tile), so
 * the car used to drive straight through them in silence. Here, every fixed step, the chassis
 * footprint is tested against the furniture on the tiles round the car (each kind as a few circles
 * in its own frame). A hit hides that instance in the pools (`hidden`), puts a dynamic body of the
 * same shape where it stood with the car's velocity and a kick, throws out debris (bin rubbish,
 * bike and railing chips, sparks off metal at speed) and a puff of dust, costs the car a little
 * momentum, and emits `prop:hit` for the sound and the camera. Knocked things lie where they
 * land until the car is 150 m away; the instance comes back once it is 250 m away (out of sight).
 */
export type KnockKind = 'bin' | 'bike' | 'rail';

interface Shape { mass: number; half: [number, number, number]; at: [number, number, number]; circles: [number, number][]; r: number; surface: 'plastic' | 'metal' }
const SHAPE: Record<KnockKind, Shape> = {
  // Two bins side by side, 1.06 x 0.42 x 0.92 m, centred.
  bin: { mass: 14, half: [0.53, 0.46, 0.22], at: [0, 0.46, 0], circles: [[-0.28, 0], [0.28, 0]], r: 0.28, surface: 'plastic' },
  // A bike along +x, 1.7 m long, centred.
  bike: { mass: 20, half: [0.84, 0.48, 0.14], at: [0, 0.5, 0], circles: [[-0.55, 0], [0, 0], [0.55, 0]], r: 0.24, surface: 'metal' },
  // A 3 m railing section from its post (x = 0) along +x.
  rail: { mass: 28, half: [1.5, 0.53, 0.04], at: [1.5, 0.53, 0], circles: [[0.25, 0], [0.9, 0], [1.5, 0], [2.1, 0], [2.75, 0]], r: 0.12, surface: 'metal' },
};
const KINDS: KnockKind[] = ['bin', 'bike', 'rail'];
/** Stride of each kind's array in `Furniture`. */
const STRIDE: Record<KnockKind, number> = { bin: 4, bike: 5, rail: 5 };
const MAX_DYN = 16, MAX_DEBRIS = 240, MAX_SPARKS = 80;
/** The car must be going this fast (m/s) to knock anything over. */
const MIN_SPEED = 1.2;

interface Hidden { kind: KnockKind; x: number; z: number }
interface Dyn { kind: KnockKind; body: RAPIER_NS.RigidBody; slot: number; age: number; colour: THREE.Color }

export interface KnockParts {
  geo: Record<KnockKind, THREE.BufferGeometry>;
  mat: Record<KnockKind, THREE.Material>;
  depth: Partial<Record<KnockKind, THREE.Material>>;
  /** Colour of a shared bike / railing instance (the pools colour them per instance). */
  bikeColours: number[][];
  railColours: number[][];
}

export class StreetKnocks implements System {
  readonly name = 'knocks';
  /** Bumped whenever `hidden` changes: the streamer refreshes its furniture pools. */
  version = 0;
  private hidden: Hidden[] = [];
  private dyn: Dyn[] = [];
  private meshes: Record<KnockKind, THREE.InstancedMesh>;
  private free: Record<KnockKind, number[]>;
  private debris: Debris;
  private sparks: Sparks;
  private rng = new Rng(1717);
  private readonly _m = new THREE.Matrix4(); private readonly _q = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3(); private readonly _s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly _c = new THREE.Color();
  /** Chassis footprint of the car it was last measured for. */
  private foot = { spec: null as unknown, hw: 0.9, front: 2.3, back: -2.3 };

  constructor(private engine: Engine, private parts: KnockParts, private near: (x: number, z: number) => Furniture[]) {
    const scene = engine.scene;
    this.meshes = {} as Record<KnockKind, THREE.InstancedMesh>;
    this.free = {} as Record<KnockKind, number[]>;
    for (const k of KINDS) {
      const m = new THREE.InstancedMesh(parts.geo[k], parts.mat[k], MAX_DYN);
      m.name = `knock:${k}`;
      m.count = MAX_DYN; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      if (parts.depth[k]) m.customDepthMaterial = parts.depth[k]!;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DYN * 3).fill(1), 3);
      // Unused slots are scaled to nothing, so the mesh can always draw all of them.
      this._m.makeScale(0, 0, 0);
      for (let i = 0; i < MAX_DYN; i++) m.setMatrixAt(i, this._m);
      scene.add(m);
      this.meshes[k] = m;
      this.free[k] = Array.from({ length: MAX_DYN }, (_, i) => MAX_DYN - 1 - i);
    }
    this.debris = new Debris(scene, MAX_DEBRIS);
    this.sparks = new Sparks(scene, MAX_SPARKS);
    queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(scene));
  }

  /** The streamer's pools skip hidden instances (knocked over, or lying somewhere else now). */
  isHidden(kind: KnockKind, x: number, z: number): boolean {
    for (const h of this.hidden) if (h.kind === kind && Math.abs(h.x - x) < 0.05 && Math.abs(h.z - z) < 0.05) return true;
    return false;
  }
  get anyHidden(): boolean { return this.hidden.length > 0; }
  /** Take one instance out of the pools without knocking it (a shared bike someone rode off on). */
  hide(kind: KnockKind, x: number, z: number): void { this.hidden.push({ kind, x, z }); this.version++; }

  /** The nearest shared bike still standing within `r` of (x, z). */
  nearestBike(x: number, z: number, r: number): SharedBike | null {
    let best: SharedBike | null = null, bd = r;
    for (const f of this.near(x, z)) {
      const a = f.bike;
      for (let i = 0; i < a.length; i += 5) {
        // Measured to the middle of the bike (the saddle), which is where one stands to take it.
        const d = Math.hypot(a[i] - x, a[i + 2] - z);
        if (d >= bd || this.isHidden('bike', a[i], a[i + 2])) continue;
        bd = d;
        // Its front (basket, bars) is local +x: (cos, -sin) in world x/z.
        const c = Math.cos(a[i + 3]), s = Math.sin(a[i + 3]);
        best = { x: a[i], y: a[i + 1], z: a[i + 2], heading: Math.atan2(c, -s), colour: new THREE.Color().fromArray(this.parts.bikeColours[a[i + 4]] ?? this.parts.bikeColours[0]) };
      }
    }
    return best;
  }

  private measure(spec: { chassis: { half: [number, number, number]; at: [number, number, number] }[] }): void {
    if (this.foot.spec === spec) return;
    let hw = 0, front = -9, back = 9;
    for (const c of spec.chassis) { hw = Math.max(hw, Math.abs(c.at[0]) + c.half[0]); front = Math.max(front, c.at[2] + c.half[2]); back = Math.min(back, c.at[2] - c.half[2]); }
    this.foot = { spec, hw, front, back };
  }

  postStep(dt: number): void {
    const v = this.engine.get<VehicleApi>('vehicle');
    if (v && v.occupied) this.detect(v);
    this.tidy(dt);
  }

  private detect(v: VehicleApi): void {
    const car = v.car;
    if (car.speed < MIN_SPEED) return;
    this.measure(car.spec as unknown as { chassis: { half: [number, number, number]; at: [number, number, number] }[] });
    const { hw, front, back } = this.foot;
    const cx = car.pos.x, cz = car.pos.z, reach = Math.max(front, -back) + 3.5;
    const fx = car.fwd.x, fz = car.fwd.z, lx = car.left.x, lz = car.left.z;
    for (const f of this.near(cx, cz)) {
      for (const kind of KINDS) {
        const a = f[kind], st = STRIDE[kind], sh = SHAPE[kind];
        for (let i = 0; i < a.length; i += st) {
          const x = a[i], y = a[i + 1], z = a[i + 2];
          if (Math.abs(x - cx) > reach || Math.abs(z - cz) > reach) continue;
          if (car.pos.y - y > 2.2 || this.isHidden(kind, x, z)) continue;
          const c = Math.cos(a[i + 3]), s = Math.sin(a[i + 3]);
          for (const [ox, oz] of sh.circles) {
            // Local +x of the item is (cos, -sin) in world x/z; local +z is (sin, cos).
            const px = x + ox * c + oz * s, pz = z - ox * s + oz * c;
            const dx = px - cx, dz = pz - cz;
            const along = dx * fx + dz * fz, side = dx * lx + dz * lz;
            if (along > front + sh.r || along < back - sh.r || Math.abs(side) > hw + sh.r) continue;
            this.knock(kind, a, i, car, px, pz);
            break;
          }
        }
      }
    }
  }

  private knock(kind: KnockKind, a: number[], i: number, car: VehicleApi['car'], hx: number, hz: number): void {
    const x = a[i], y = a[i + 1], z = a[i + 2], yaw = a[i + 3];
    this.hidden.push({ kind, x, z });
    this.version++;
    const sh = SHAPE[kind], r = this.rng, speed = car.speed;
    const colour = this._c.setRGB(1, 1, 1);
    if (kind === 'bike') colour.fromArray(this.parts.bikeColours[a[i + 4]] ?? this.parts.bikeColours[0]);
    if (kind === 'rail') colour.fromArray(this.parts.railColours[a[i + 4]] ?? this.parts.railColours[0]);
    // Out of the car's way: its velocity, a shove away from the centre line and up, and a tumble.
    const dx = hx - car.pos.x, dz = hz - car.pos.z;
    const side = dx * car.left.x + dz * car.left.z;
    const k = r.range(1.05, 1.35), lift = 1.2 + speed * r.range(0.08, 0.16);
    const push = Math.sign(side || 1) * (1 + speed * 0.12);
    const vx = car.vel.x * k + car.left.x * push, vz = car.vel.z * k + car.left.z * push;
    const slot = this.slot(kind);
    if (slot >= 0) {
      const { R, world } = this.engine.physics;
      this._q.setFromAxisAngle(this.up, yaw);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w })
        .setLinvel(vx, lift, vz).setAngvel({ x: r.range(-1, 1) * speed * 0.35, y: r.range(-1, 1) * speed * 0.25, z: r.range(-1, 1) * speed * 0.35 })
        .setLinearDamping(0.15).setAngularDamping(0.5).setCcdEnabled(true).setCanSleep(true));
      const col = world.createCollider(R.ColliderDesc.cuboid(...sh.half).setTranslation(...sh.at).setDensity(0).setFriction(0.8).setRestitution(0.2)
        .setCollisionGroups(groups(CG.PROP, CG.WORLD | CG.CAR | CG.PROP)), body);
      this.engine.physics.tag(col, { surface: sh.surface, tag: 'prop' });
      body.setAdditionalMassProperties(sh.mass, { x: sh.at[0], y: sh.at[1] * 0.8, z: 0 }, { x: sh.mass * 0.08, y: sh.mass * 0.1, z: sh.mass * 0.08 }, { x: 0, y: 0, z: 0, w: 1 }, true);
      this.meshes[kind].setColorAt(slot, colour);
      this.meshes[kind].instanceColor!.needsUpdate = true;
      this.dyn.push({ kind, body, slot, age: 0, colour: colour.clone() });
    }
    // The car loses what it gave away (a light thing barely slows it, which is right).
    const m = sh.mass * 0.8;
    car.body.applyImpulse({ x: -car.vel.x * m * 0.5, y: 0, z: -car.vel.z * m * 0.5 }, true);
    // Debris, sparks off metal, a puff of dust.
    const py = y + sh.at[1];
    const bits = kind === 'bin' ? 12 : kind === 'bike' ? 7 : 6;
    for (let n = 0; n < bits; n++) {
      const pal = kind === 'bin' ? BIN_BITS : kind === 'bike' ? BIKE_BITS : RAIL_BITS;
      const tint = n < 2 && kind !== 'bin' ? colour : pal[Math.floor(r.next() * pal.length)];
      this.debris.emit(hx, py, hz, vx * r.range(0.5, 1.1) + r.range(-2, 2), lift * r.range(0.6, 1.5) + r.range(0, 2), vz * r.range(0.5, 1.1) + r.range(-2, 2), kind === 'bin' ? r.range(0.07, 0.16) : r.range(0.04, 0.1), tint, r);
    }
    if (sh.surface === 'metal' && speed > 6) {
      const n = Math.min(24, Math.round(speed * 1.2));
      for (let s = 0; s < n; s++) this.sparks.emit(hx, py * 0.7, hz, car.vel.x * r.range(0.3, 0.9) + r.range(-3, 3), r.range(0.5, 4), car.vel.z * r.range(0.3, 0.9) + r.range(-3, 3), r);
    }
    // fx installs after city: looked up when needed.
    const fx = this.engine.get<FxApi>('fx');
    for (let s = 0; s < 2; s++) fx?.smoke(hx, y + 0.3, hz, car.vel.x * 0.2, 0.3, car.vel.z * 0.2, 0.5, 1.1, 0);
    this.engine.events.emit('prop:hit', { kind, x: hx, y: py, z: hz, speed });
  }

  private slot(kind: KnockKind): number {
    const f = this.free[kind];
    if (f.length) return f.pop()!;
    // All in use: the oldest of this kind goes (it stays hidden where it stood, see tidy).
    let oldest: Dyn | null = null;
    for (const d of this.dyn) if (d.kind === kind && (!oldest || d.age > oldest.age)) oldest = d;
    if (!oldest) return -1;
    this.drop(oldest);
    return f.pop() ?? -1;
  }

  private drop(d: Dyn): void {
    this.engine.physics.untag(d.body.collider(0));
    this.engine.physics.world.removeRigidBody(d.body);
    this._m.makeScale(0, 0, 0);
    this.meshes[d.kind].setMatrixAt(d.slot, this._m);
    this.meshes[d.kind].instanceMatrix.needsUpdate = true;
    this.free[d.kind].push(d.slot);
    this.dyn.splice(this.dyn.indexOf(d), 1);
  }

  private tidy(dt: number): void {
    if (!this.dyn.length && !this.hidden.length) return;
    const cam = this.engine.camera.position;
    for (let i = this.dyn.length - 1; i >= 0; i--) {
      const d = this.dyn[i];
      d.age += dt;
      const t = d.body.translation();
      if (Math.hypot(t.x - cam.x, t.z - cam.z) > 150 || t.y < -20) this.drop(d);
    }
    const before = this.hidden.length;
    this.hidden = this.hidden.filter((h) => Math.hypot(h.x - cam.x, h.z - cam.z) < 250);
    if (this.hidden.length !== before) this.version++;
  }

  update(dt: number): void {
    for (const d of this.dyn) {
      if (d.body.isSleeping()) continue;
      const t = d.body.translation(), q = d.body.rotation();
      this._m.compose(this._p.set(t.x, t.y, t.z), this._q.set(q.x, q.y, q.z, q.w), this._s);
      this.meshes[d.kind].setMatrixAt(d.slot, this._m);
      this.meshes[d.kind].instanceMatrix.needsUpdate = true;
    }
    this.debris.update(dt);
    this.sparks.update(dt);
  }

  /** Everything back in place (a new game, a pose). */
  reset(): void {
    while (this.dyn.length) this.drop(this.dyn[0]);
    this.hidden = []; this.version++;
    this.debris.clear(); this.sparks.clear();
  }

  /** For probes. */
  get stats(): { hidden: number; flying: number; debris: number } { return { hidden: this.hidden.length, flying: this.dyn.length, debris: this.debris.alive }; }
}

const BIN_BITS = ['#2f7b48', '#6c7277', '#f1efe6', '#d8d2bf', '#b4462f', '#3a5fa8', '#c9b28a'].map((c) => new THREE.Color(c));
const BIKE_BITS = ['#1b1c1d', '#2a2a2a', '#c9ccce'].map((c) => new THREE.Color(c));
const RAIL_BITS = ['#e9e9e4', '#e2b021', '#c9ccce'].map((c) => new THREE.Color(c));

/** Little chips that fly, bounce once or twice on the road and lie there a few seconds. */
class Debris {
  readonly mesh: THREE.InstancedMesh;
  alive = 0;
  private p: Float32Array; private v: Float32Array; private rot: Float32Array; private spin: Float32Array; private size: Float32Array; private age: Float32Array; private floor: Float32Array;
  private readonly _m = new THREE.Matrix4(); private readonly _q = new THREE.Quaternion(); private readonly _e = new THREE.Euler();
  private readonly _p = new THREE.Vector3(); private readonly _s = new THREE.Vector3();

  constructor(scene: THREE.Scene, private max: number) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 0.7), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 }), max);
    this.mesh.name = 'knock:debris';
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    (this.mesh.material as THREE.Material).userData.wet = 'surface';
    scene.add(this.mesh);
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.rot = new Float32Array(max * 3); this.spin = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.age = new Float32Array(max); this.floor = new Float32Array(max);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, colour: THREE.Color, r: Rng): void {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    this.p.set([x + r.range(-0.3, 0.3), y + r.range(-0.2, 0.3), z + r.range(-0.3, 0.3)], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.rot.set([r.range(0, 6), r.range(0, 6), r.range(0, 6)], i * 3);
    this.spin.set([r.range(-14, 14), r.range(-14, 14), r.range(-14, 14)], i * 3);
    this.size[i] = size; this.age[i] = 0; this.floor[i] = 0.07;
    this.mesh.setColorAt(i, colour);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    let n = this.alive;
    const LIFE = 6;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] > LIFE) {
        n--;
        for (const a of [this.p, this.v, this.rot, this.spin]) a.copyWithin(i * 3, n * 3, n * 3 + 3);
        this.size[i] = this.size[n]; this.age[i] = this.age[n]; this.floor[i] = this.floor[n];
        const c = this.mesh.instanceColor!; c.setXYZ(i, c.getX(n), c.getY(n), c.getZ(n)); c.needsUpdate = true;
        i--; continue;
      }
      const j = i * 3;
      if (this.p[j + 1] > this.floor[i] || this.v[j + 1] > 0) {
        this.v[j + 1] -= 9.81 * dt;
        const drag = Math.exp(-dt * 0.8);
        this.v[j] *= drag; this.v[j + 2] *= drag;
        this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
        this.rot[j] += this.spin[j] * dt; this.rot[j + 1] += this.spin[j + 1] * dt; this.rot[j + 2] += this.spin[j + 2] * dt;
        if (this.p[j + 1] < this.floor[i]) {
          // Bounce, losing most of it; slide to a stop and lie flat-ish.
          this.p[j + 1] = this.floor[i];
          this.v[j + 1] = Math.abs(this.v[j + 1]) > 1.5 ? -this.v[j + 1] * 0.3 : 0;
          this.v[j] *= 0.5; this.v[j + 2] *= 0.5;
          for (let k = 0; k < 3; k++) this.spin[j + k] *= 0.4;
          if (this.v[j + 1] === 0) { this.rot[j] = 0; this.rot[j + 2] = 0; this.spin[j] = this.spin[j + 2] = 0; }
        }
      } else {
        const f = Math.exp(-dt * 5);
        this.v[j] *= f; this.v[j + 2] *= f;
        this.p[j] += this.v[j] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      }
      const s = this.size[i] * Math.min(1, (LIFE - this.age[i]) / 0.6);
      this._q.setFromEuler(this._e.set(this.rot[j], this.rot[j + 1], this.rot[j + 2]));
      this._m.compose(this._p.set(this.p[j], this.p[j + 1] + s * 0.17, this.p[j + 2]), this._q, this._s.set(s, s, s));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.alive = n;
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.alive = 0; this.mesh.count = 0; }
}

/** Sparks: short bright streaks along their velocity that fall and die in half a second. */
class Sparks {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array; private v: Float32Array; private age: Float32Array; private life: Float32Array;
  private alive = 0;
  private readonly _m = new THREE.Matrix4(); private readonly _q = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3(); private readonly _s = new THREE.Vector3(); private readonly _d = new THREE.Vector3();
  private readonly _z = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, private max: number) {
    // HDR orange: well over the bloom threshold, so each streak glows.
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.6, 0.7), toneMapped: true });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.045, 1), mat, max);
    this.mesh.name = 'knock:sparks';
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: Rng): void {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.age[i] = 0; this.life[i] = r.range(0.25, 0.6);
  }

  update(dt: number): void {
    let n = this.alive;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] > this.life[i]) {
        n--;
        this.p.copyWithin(i * 3, n * 3, n * 3 + 3); this.v.copyWithin(i * 3, n * 3, n * 3 + 3);
        this.age[i] = this.age[n]; this.life[i] = this.life[n];
        i--; continue;
      }
      const j = i * 3;
      this.v[j + 1] -= 9.81 * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      if (this.p[j + 1] < 0.05) { this.p[j + 1] = 0.05; this.v[j + 1] *= -0.3; }
      this._d.set(this.v[j], this.v[j + 1], this.v[j + 2]);
      const sp = this._d.length();
      const len = Math.min(0.9, sp * 0.06) * (1 - this.age[i] / this.life[i]);
      this._q.setFromUnitVectors(this._z, sp > 1e-3 ? this._d.multiplyScalar(1 / sp) : this._z);
      this._m.compose(this._p.set(this.p[j], this.p[j + 1], this.p[j + 2]), this._q, this._s.set(1, 1, Math.max(0.01, len)));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.alive = n;
    this.mesh.count = n;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { this.alive = 0; this.mesh.count = 0; }
}
