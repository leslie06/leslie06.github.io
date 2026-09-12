import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bodyOptions, TAXI_LIVERY, type Livery } from '../vehicle/CarModel';
import { buildBody, type BodyType } from '../vehicle/Bodies';
import { kitMaterials, paintMetal, setLampState, type LampArray } from '../vehicle/CarMaterials';
import { LAMP } from '../vehicle/Mesher';
import { SPEC_OF, type VehicleSpec } from '../vehicle/Spec';
import type { Vehicle } from '../vehicle/Vehicle';

interface WheelSet { mesh: THREE.InstancedMesh; perCar: number; slots: { k: number; dx: number }[] }

const _yFlip = new THREE.Matrix4().makeRotationY(Math.PI);

/**
 * Traffic cars of one body type, drawn as instances of that body's low-detail model: every car of
 * the kit is one instance in each of 4 draw calls (5 with twin rear tyres of another size):
 *
 *   paint   body panels + glass, the two paint tones per instance (upper, lower, metalness)
 *   trim    black plastic, chrome, grille, plates, seams, underfloor
 *   lamp    lamps, roof sign, lettering: per-instance brake / reverse lights and taxi-only parts
 *   wheels  all four (or six) wheels of every car
 *
 * paint, trim and lamp share one instance-matrix buffer. Private cars fold the taxi parts away in
 * the vertex shader (no per-part meshes).
 */
export class CarKit {
  readonly spec: VehicleSpec;
  /** Triangles of one car (body + wheels), and draw calls of the kit in the main pass. */
  readonly triangles: number;
  readonly drawCalls: number;
  private readonly body: THREE.InstancedMesh[] = [];
  private readonly wheels: WheelSet[] = [];
  private readonly matrix: THREE.InstancedBufferAttribute;
  private readonly upper: THREE.InstancedBufferAttribute;
  private readonly lower: THREE.InstancedBufferAttribute;
  private readonly flags: THREE.InstancedBufferAttribute;
  private readonly levels: LampArray;
  private readonly hubs: THREE.Vector3[];
  private _m = new THREE.Matrix4(); private _w = new THREE.Matrix4(); private _l = new THREE.Matrix4();
  private _q = new THREE.Quaternion(); private _e = new THREE.Euler(0, 0, 0, 'YXZ'); private _s = new THREE.Vector3(1, 1, 1);
  private _p = new THREE.Vector3();
  private headOn: boolean | null = null;

  constructor(scene: THREE.Scene, readonly cap: number, livery: Livery = TAXI_LIVERY, readonly bodyType: BodyType = 'sedan') {
    const spec = this.spec = SPEC_OF[bodyType];
    const parts = buildBody(bodyType, spec, bodyOptions(livery), 'low');
    const mats = kitMaterials(livery);
    this.levels = mats.lampLevels;
    setLampState(this.levels, { head: false }, true);
    this.matrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    this.matrix.setUsage(THREE.DynamicDrawUsage);
    this.upper = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4).fill(1), 4);
    this.lower = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4).fill(1), 4);
    this.flags = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.upper, this.lower, this.flags]) a.setUsage(THREE.DynamicDrawUsage);
    let tris = 0;
    const count = (g: THREE.BufferGeometry, n = 1) => { tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3 * n; };
    const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, shadow: boolean) => {
      if (!g) return;
      count(g);
      const im = new THREE.InstancedMesh(g, mat, cap);
      im.instanceMatrix = this.matrix;
      im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true;
      scene.add(im);
      this.body.push(im);
    };
    const b = parts.body;
    const paint = b.build('paint');
    if (paint) { paint.setAttribute('instUpper', this.upper); paint.setAttribute('instLower', this.lower); }
    add(paint, mats.paint, true);
    add(b.build('trim'), mats.trim, true);
    // Lamps and the taxi-only parts in one mesh; taxi parts carry flag 2 in aux.y.
    const lamp = b.build('lamp'), taxi = b.build('taxi');
    if (taxi) { const a = taxi.getAttribute('aux'); for (let i = 0; i < a.count; i++) a.setY(i, a.getY(i) + 2); }
    const lamps = lamp && taxi ? mergeGeometries([lamp, taxi]) : lamp ?? taxi;
    if (lamp && taxi) { lamp.dispose(); taxi.dispose(); }
    if (lamps) lamps.setAttribute('instLamp', this.flags);
    add(lamps, mats.lamp, false);
    // Wheels: front and rear (twin rear tyres are two instances each side).
    this.hubs = spec.wheels.map((w) => new THREE.Vector3(w.x, 0, w.z));
    const wf = parts.wheel.build('trim')!, wr = parts.wheelRear?.build('trim') ?? null;
    const rearSlots = parts.dual > 0 ? [2, 3].flatMap((k) => [{ k, dx: parts.dual / 2 }, { k, dx: -parts.dual / 2 }]) : [{ k: 2, dx: 0 }, { k: 3, dx: 0 }];
    const front = [{ k: 0, dx: 0 }, { k: 1, dx: 0 }];
    const sets: [THREE.BufferGeometry, { k: number; dx: number }[]][] = wr ? [[wf, front], [wr, rearSlots]] : [[wf, [...front, ...rearSlots]]];
    for (const [g, slots] of sets) {
      count(g, slots.length);
      const im = new THREE.InstancedMesh(g, mats.wheel, cap * slots.length);
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.wheels.push({ mesh: im, perCar: slots.length, slots });
    }
    this.triangles = Math.round(tris);
    this.drawCalls = this.body.length + this.wheels.length;
  }

  /** Write car `i`: interpolated pose, per-car colours, taxi or not. Brake and reverse lamps follow the car. */
  set(i: number, pos: THREE.Vector3, quat: THREE.Quaternion, car: Vehicle, upper: THREE.Color, lower: THREE.Color, taxi: boolean): void {
    this._m.compose(pos, quat, this._s);
    this._m.toArray(this.matrix.array, i * 16);
    const u = this.upper.array as Float32Array, l = this.lower.array as Float32Array, f = this.flags.array as Float32Array;
    u[i * 4] = upper.r; u[i * 4 + 1] = upper.g; u[i * 4 + 2] = upper.b; u[i * 4 + 3] = paintMetal(upper);
    l[i * 4] = lower.r; l[i * 4 + 1] = lower.g; l[i * 4 + 2] = lower.b; l[i * 4 + 3] = paintMetal(lower);
    // Brake lamps: braking, or standing with the foot on the brake (not parked on the handbrake).
    const braking = car.brake > 0.05 || (car.speed < 0.5 && car.throttle < 0.05 && !car.handbrake);
    f[i * 4] = taxi ? 1 : 0; f[i * 4 + 1] = braking ? 1 : 0; f[i * 4 + 2] = car.gear === -1 ? 1 : 0;
    for (const ws of this.wheels) {
      for (let s = 0; s < ws.slots.length; s++) {
        const { k, dx } = ws.slots[s];
        const w = car.wheels[k];
        this._p.copy(this.hubs[k]); this._p.y = car.spec.mountY - w.springLen;
        this._e.set(w.spin, w.steer, 0, 'YXZ');
        this._l.compose(this._p, this._q.setFromEuler(this._e), this._s);
        const side = this.hubs[k].x > 0 ? 1 : -1;
        if (dx !== 0) this._l.multiply(this._w.makeTranslation(dx * side, 0, 0));
        if (side < 0) this._l.multiply(_yFlip);
        this._w.multiplyMatrices(this._m, this._l);
        ws.mesh.setMatrixAt(i * ws.perCar + s, this._w);
      }
    }
  }

  /** Headlamps glow at night (all cars of the kit share the lamp levels). */
  setHeadlights(on: boolean): void {
    if (on === this.headOn) return;
    this.headOn = on;
    const r = this.levels[LAMP.beaconR], b = this.levels[LAMP.beaconB];
    setLampState(this.levels, { head: on }, true);
    this.levels[LAMP.beaconR] = r; this.levels[LAMP.beaconB] = b;
  }

  /** Police light bar (all cars of this kit flash together). */
  setBeacons(red: number, blue: number): void { this.levels[LAMP.beaconR] = red; this.levels[LAMP.beaconB] = blue; }

  /** Commit after writing `n` cars. */
  commit(n: number): void {
    for (const im of this.body) im.count = n;
    for (const a of [this.matrix, this.upper, this.lower, this.flags]) {
      a.clearUpdateRanges();
      if (n > 0) a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    for (const ws of this.wheels) {
      ws.mesh.count = n * ws.perCar;
      ws.mesh.instanceMatrix.clearUpdateRanges();
      if (n > 0) ws.mesh.instanceMatrix.addUpdateRange(0, n * ws.perCar * 16);
      ws.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
