import * as THREE from 'three';
import type { LaneGraph, Link } from './LaneGraph';

/** 0 green, 1 amber, 2 red. */
export type Light = 0 | 1 | 2;
const GREEN = 22, AMBER = 3, ALLRED = 2, CYCLE = 2 * (GREEN + AMBER + ALLRED);

/**
 * Traffic lights at the signalised junctions of the OSM graph. OSM draws one crossing of two dual
 * carriageways as up to four signalised nodes, so nodes within 45 m are one junction with one
 * clock. Approaches are split into two phases by the axis they arrive along; each junction runs a
 * two-phase cycle from its own offset so the city does not change colour all at once.
 */
export class Signals {
  private cluster: Int32Array;
  private axis: number[] = [];
  private offset: number[] = [];
  readonly centres: { x: number; z: number }[] = [];

  constructor(private g: LaneGraph) {
    const n = g.nodeX.length;
    this.cluster = new Int32Array(n).fill(-1);
    const sigNodes: number[] = [];
    for (let i = 0; i < n; i++) if (g.sig[i]) sigNodes.push(i);
    for (const i of sigNodes) {
      if (this.cluster[i] >= 0) continue;
      const id = this.axis.length;
      const stack = [i]; this.cluster[i] = id;
      let sx = 0, sz = 0, cnt = 0;
      while (stack.length) {
        const a = stack.pop()!;
        sx += g.nodeX[a]; sz += g.nodeZ[a]; cnt++;
        for (const b of sigNodes) if (this.cluster[b] < 0 && Math.hypot(g.nodeX[a] - g.nodeX[b], g.nodeZ[a] - g.nodeZ[b]) < 45) { this.cluster[b] = id; stack.push(b); }
      }
      this.centres.push({ x: sx / cnt, z: sz / cnt });
      // Axis: direction of the first approach into this junction (mod pi).
      let ax = 0;
      for (const l of g.links) if (this.cluster[l.to] === id) { ax = Math.atan2(l.d1z, l.d1x); break; }
      this.axis.push(ax);
      this.offset.push(((i * 2654435761) >>> 0) / 4294967296 * CYCLE);
    }
  }

  junctionOf(node: number): number { return this.cluster[node]; }

  /** Phase (0/1) of an approach by the axis it arrives along. */
  phaseOf(l: Link): number {
    const c = this.cluster[l.to];
    return c < 0 ? 0 : this.phaseAlong(c, l.d1x, l.d1z);
  }

  /** Phase (0/1) whose traffic runs along (dx, dz) at junction `c`. */
  phaseAlong(c: number, dx: number, dz: number): number {
    let d = Math.abs(Math.atan2(dz, dx) - this.axis[c]) % Math.PI;
    if (d > Math.PI / 2) d = Math.PI - d;
    return d < Math.PI / 4 ? 0 : 1;
  }

  /** Seconds of green left for `phase` at junction `c` (0 on amber or red). People cross with the parallel green. */
  greenLeft(c: number, phase: number, t: number): number {
    let u = (t + this.offset[c]) % CYCLE;
    if (phase === 1) u = (u + CYCLE / 2) % CYCLE;
    return u < GREEN ? GREEN - u : 0;
  }

  /** Light facing traffic at the end of link `l` at time `t` (s). Unsignalised ends are green. */
  state(l: Link, t: number): Light {
    const c = this.cluster[l.to];
    if (c < 0) return 0;
    // A link that starts inside the same junction (the short piece between two carriageways) is
    // already past the stop line.
    if (this.cluster[l.from] === c) return 0;
    const phase = this.phaseOf(l);
    let u = (t + this.offset[c]) % CYCLE;
    if (phase === 1) u = (u + CYCLE / 2) % CYCLE;
    return u < GREEN ? 0 : u < GREEN + AMBER ? 1 : 2;
  }
}

/** Poles with three-lamp heads at the stop lines of signalised approaches near the player. */
export class SignalHeads {
  private poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private heads: { l: Link; lamp: number }[] = [];
  private lastX = Infinity; private lastZ = Infinity;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _v = new THREE.Vector3(); private _s = new THREE.Vector3(1, 1, 1);
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private cols: THREE.Color[];

  constructor(scene: THREE.Scene, private g: LaneGraph, private sig: Signals, private cap = 160) {
    const pole = new THREE.CylinderGeometry(0.09, 0.11, 5.6, 8).translate(0, 2.8, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 1).translate(0, 5.3, 0.5);
    const housing = new THREE.BoxGeometry(0.42, 1.2, 0.32).translate(0, 4.95, 1.05);
    const g0 = mergeAll([pole, arm, housing]);
    this.poles = new THREE.InstancedMesh(g0, new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.6, metalness: 0.5 }), cap);
    // Three lamps per head: one instanced mesh, per-instance colour (lit colours are HDR for bloom).
    const lamp = new THREE.CircleGeometry(0.13, 16).rotateY(Math.PI).translate(0, 0, 0);
    this.lamps = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: '#ffffff' }), cap * 3);
    for (const m of [this.poles, this.lamps]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    this.poles.castShadow = true;
    this.cols = [new THREE.Color(0.2, 3.2, 0.9), new THREE.Color(3.4, 2.1, 0.1), new THREE.Color(3.6, 0.25, 0.15)];
  }

  update(x: number, z: number, t: number): void {
    if (Math.hypot(x - this.lastX, z - this.lastZ) > 60) { this.lastX = x; this.lastZ = z; this.rebuild(x, z); }
    const dark = new THREE.Color(0.05, 0.05, 0.05);
    for (let i = 0; i < this.heads.length; i++) {
      const st = this.sig.state(this.heads[i].l, t);
      // Lamp order top to bottom: red, amber, green.
      this.lamps.setColorAt(i * 3, st === 2 ? this.cols[2] : dark);
      this.lamps.setColorAt(i * 3 + 1, st === 1 ? this.cols[1] : dark);
      this.lamps.setColorAt(i * 3 + 2, st === 0 ? this.cols[0] : dark);
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  private rebuild(x: number, z: number): void {
    this.heads = [];
    for (const id of this.g.near(x, z, 280)) {
      const l = this.g.links[id];
      if (this.sig.junctionOf(l.to) < 0 || this.sig.junctionOf(l.from) === this.sig.junctionOf(l.to) || l.len < 12) continue;
      if (this.heads.length >= this.cap) break;
      // At the stop line, on the right-hand kerb, arm reaching over the carriageway, lamps facing traffic.
      const p = this.g.at(l, l.len - 7, -(l.oneway ? l.hw : l.hw) - 0.8, this.tmp);
      const yaw = Math.atan2(-p.dz, -p.dx) + Math.PI / 2;   // local +Z (the arm) points left of travel, across the road
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.dz, -p.dx) * 0 + Math.atan2(-p.dz * 0 - p.dx, p.dz) );
      const armYaw = Math.atan2(p.dz, -p.dx);   // rotation taking local +Z to the left-of-travel direction (dz, -dx)
      void yaw;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), armYaw);
      const i = this.heads.length;
      this.poles.setMatrixAt(i, this._m.compose(this._v.set(p.x, 0, p.z), this._q, this._s));
      for (let k = 0; k < 3; k++) {
        // Lamps on the housing's face towards oncoming traffic (against the travel direction).
        const local = new THREE.Vector3(0, 5.33 - k * 0.38, 1.05).applyQuaternion(this._q);
        this._v.set(p.x + local.x - p.dx * 0.17, local.y, p.z + local.z - p.dz * 0.17);
        const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-p.dx, 0, -p.dz));
        this.lamps.setMatrixAt(i * 3 + k, this._m.compose(this._v, face, this._s));
      }
      this.heads.push({ l, lamp: i });
    }
    this.poles.count = this.heads.length;
    this.lamps.count = this.heads.length * 3;
    this.poles.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
  }
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.getAttribute('position').array as Float32Array, o * 3); nor.set(g.getAttribute('normal').array as Float32Array, o * 3); o += g.getAttribute('position').count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
