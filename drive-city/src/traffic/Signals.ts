import * as THREE from 'three';
import type { LaneGraph, Link } from './LaneGraph';

/** 0 green, 1 amber, 2 red. */
export type Light = 0 | 1 | 2;
const AMBER = 3, ALLRED = 2;
/**
 * Green for the main road (phase 0) and for the side street (phase 1). The split is what keeps a
 * city full of lights driveable: doubling the number of junctions with lights cost the arterials a
 * fifth of their speed (25.1 to 20.1 km/h measured with `.scratch/order.mjs`), and giving the main
 * road nearly twice the green of the street crossing it wins a quarter of that back (21.2 km/h).
 * The rest is the price of the lights: most of it is cars queued at a red, not slower driving.
 */
const GREEN = [30, 16];
const START = [0, GREEN[0] + AMBER + ALLRED];
const CYCLE = START[1] + GREEN[1] + AMBER + ALLRED;
/** How important a road is. Two roads of SIG_RANK or better crossing get lights. */
const RANK: Record<string, number> = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2, busway: 2, unclassified: 1, residential: 1 };
const SIG_RANK = 2;

/**
 * Traffic lights at the signalised junctions of the OSM graph. OSM draws one crossing of two dual
 * carriageways as up to four signalised nodes, so nodes within 45 m are one junction with one
 * clock. Approaches are split into two phases by the axis they arrive along; each junction runs a
 * two-phase cycle from its own offset so the city does not change colour all at once.
 *
 * OSM only marks a fifth of the crossings that really have lights (343 nodes in this extract),
 * which left most of the city with nothing for either drivers or pedestrians to obey. Any junction
 * of three or more arms where two roads of `SIG_RANK` or better cross on different axes is
 * signalised too, which takes the city from 143 junctions with lights to 289 - a light where two
 * through streets meet, and none on the lanes between them (`?lights=osm` restores OSM's own).
 */
export class Signals {
  private cluster: Int32Array;
  private axis: number[] = [];
  private offset: number[] = [];
  readonly centres: { x: number; z: number }[] = [];
  /** Junctions signalised by class because OSM did not mark them (diagnostics). */
  readonly inferred: number = 0;

  constructor(private g: LaneGraph) {
    const n = g.nodeX.length;
    this.cluster = new Int32Array(n).fill(-1);
    // Links at each node whichever way they run: a two-way edge is one link at each end, a one-way
    // link belongs to both of its ends.
    const inc: number[][] = Array.from({ length: n }, () => []);
    for (const l of g.links) { inc[l.from].push(l.id); if (l.rev < 0) inc[l.to].push(l.id); }
    // `?lights=osm` keeps only the junctions OSM marks, which is how the difference was measured.
    const osmOnly = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lights') === 'osm';
    const sigNodes: number[] = [];
    for (let i = 0; i < n; i++) {
      if (g.sig[i]) sigNodes.push(i);
      else if (!osmOnly && this.mainCrossing(inc[i], i)) { sigNodes.push(i); this.inferred++; }
    }
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
      this.axis.push(0);
      this.offset.push(((i * 2654435761) >>> 0) / 4294967296 * CYCLE);
    }
    // Axis: the direction of the junction's most important approach (longest of the top class), so
    // the main road always runs on phase 0 and the side street waits.
    const rank = new Float32Array(this.axis.length).fill(-1);
    for (const l of g.links) {
      const c = this.cluster[l.to];
      if (c < 0 || this.cluster[l.from] === c) continue;
      const r = (RANK[l.cls] ?? 0) + Math.min(0.9, l.len / 400);
      if (r > rank[c]) { rank[c] = r; this.axis[c] = Math.atan2(l.d1z, l.d1x); }
    }
  }

  /** True where three or more arms meet and two main roads cross on different axes. */
  private mainCrossing(links: number[], node: number): boolean {
    if (links.length < 3) return false;
    let first = Infinity;
    for (const id of links) {
      const l = this.g.links[id];
      if ((RANK[l.cls] ?? 0) < SIG_RANK) continue;
      const a = l.from === node ? Math.atan2(l.d0z, l.d0x) : Math.atan2(l.d1z, l.d1x);
      if (first === Infinity) { first = a; continue; }
      let d = Math.abs(a - first) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      if (d > Math.PI / 6) return true;   // not the same street running through
    }
    return false;
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

  /** How long `phase` is green for in total. A crossing longer than this has to start on the change. */
  greenSpan(phase: number): number { return GREEN[phase]; }

  /** Seconds into `phase`'s own window of the cycle at junction `c`. */
  private local(c: number, phase: number, t: number): number {
    return (((t + this.offset[c]) % CYCLE) - START[phase] + CYCLE) % CYCLE;
  }

  /** Seconds of green left for `phase` at junction `c` (0 on amber or red). People cross with the parallel green. */
  greenLeft(c: number, phase: number, t: number): number {
    const u = this.local(c, phase, t);
    return u < GREEN[phase] ? GREEN[phase] - u : 0;
  }

  /** Light facing traffic at the end of link `l` at time `t` (s). Unsignalised ends are green. */
  state(l: Link, t: number): Light {
    const c = this.cluster[l.to];
    if (c < 0) return 0;
    // A link that starts inside the same junction (the short piece between two carriageways) is
    // already past the stop line.
    if (this.cluster[l.from] === c) return 0;
    const phase = this.phaseOf(l);
    const u = this.local(c, phase, t);
    return u < GREEN[phase] ? 0 : u < GREEN[phase] + AMBER ? 1 : 2;
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
