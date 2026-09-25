import * as THREE from 'three';
import type { LaneGraph, Link } from './LaneGraph';

/** 0 green, 1 amber, 2 red. */
export type Light = 0 | 1 | 2;
const AMBER = 3, ALLRED = 2;

/** A junction's timing: seconds of green for the main road (phase 0) and the side street (phase 1). */
interface Plan { green: [number, number]; start: [number, number]; cycle: number }
const plan = (main: number, side: number): Plan =>
  ({ green: [main, side], start: [0, main + AMBER + ALLRED], cycle: main + side + 2 * (AMBER + ALLRED) });
/**
 * Where a road of tertiary class or better meets anything. The split is what keeps a city full of
 * lights driveable: doubling the number of junctions with lights cost the arterials a fifth of
 * their speed (25.1 to 20.1 km/h measured with `.scratch/order.mjs`), and giving the main road
 * nearly twice the green of the street crossing it won a quarter of that back (21.2 km/h).
 */
const MAJOR = plan(30, 16);
/**
 * Where only lanes meet (residential, unclassified). A 56 s cycle there held a car in a hutong for
 * up to 40 s at every corner for no traffic at all; this one is 37 s, and still gives a pedestrian
 * time to cross a street that narrow on either green.
 */
const MINOR = plan(15, 12);
/** How important a road is. Two roads of SIG_RANK or better crossing get the long join radius. */
const RANK: Record<string, number> = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2, busway: 2, unclassified: 1, residential: 1 };
const SIG_RANK = 2;
/** Not streets: a driveway, a parking aisle or the lane into a compound meeting a street is not a junction. */
const SERVICE = new Set(['service', 'living_street']);
/**
 * Signal nodes this close are one junction with one clock: OSM draws a crossing of two dual
 * carriageways as up to four nodes 20-40 m apart. Two ordinary streets meeting are one node, and
 * the next junction is often only 10-30 m away (the median in this city is 30 m), so they join
 * over a much shorter distance - with one radius for everything, clusters chained across whole
 * blocks. `RADIUS` caps a cluster however it is chained: nothing joins further than that from the
 * junction's most important node.
 */
const JOIN_MAIN = 45, JOIN = 25, RADIUS = 60;

/** Which lights to put up (`?lights=`): every junction (default), main crossings only (the old rule), or OSM's. */
export type LightsMode = 'all' | 'main' | 'osm';

/**
 * Traffic lights at every junction of the drivable graph, as a Beijing driver would expect them.
 * Approaches are split into two phases by the axis they arrive along; each junction runs a
 * two-phase cycle from its own offset so the city does not change colour all at once.
 *
 * Which nodes are junctions: any node OSM marks, and any node where three or more streets meet and
 * do not all run the same way (`junctionKind`). Not lit: service roads (driveways and parking
 * aisles), and ramps joining an expressway - those merge, they never meet a light. OSM itself
 * marks only a fifth of the crossings that have lights (463 nodes here); the first inference lit
 * crossings of two main roads (`?lights=main`), which left 2,633 junctions of the 3,591 with
 * nothing to obey: drivers went through side-street junctions without looking and pedestrians
 * crossed wherever the traffic left a gap.
 */
export class Signals {
  private cluster: Int32Array;
  private axis: number[] = [];
  private offset: number[] = [];
  private plans: Plan[] = [];
  readonly centres: { x: number; z: number }[] = [];
  /** Nodes signalised although OSM did not mark them (diagnostics). */
  readonly inferred: number = 0;
  /** Junctions on the short MINOR cycle (diagnostics). */
  readonly minor: number = 0;

  constructor(private g: LaneGraph, mode: LightsMode = lightsParam()) {
    const n = g.nodeX.length;
    this.cluster = new Int32Array(n).fill(-1);
    // Links at each node whichever way they run: a two-way edge is one link at each end, a one-way
    // link belongs to both of its ends.
    const inc: number[][] = Array.from({ length: n }, () => []);
    for (const l of g.links) { inc[l.from].push(l.id); if (l.rev < 0) inc[l.to].push(l.id); }
    /** 0 unlit; else bit 1 main crossing (long join radius), bit 2 a main road is involved (MAJOR plan). */
    const kind = new Uint8Array(n);
    const lit: number[] = [];
    // A node up on an interchange's deck gets no lights: the heads stand on the ground. A junction on a
    // ramp's low part (lifted a metre or two by the slope) keeps its lights.
    const up = new Uint8Array(n);
    for (const l of g.links) if (l.h) { if (l.h[0] > 3) up[l.from] = 1; if (l.h[l.h.length - 1] > 3) up[l.to] = 1; }
    for (let i = 0; i < n; i++) {
      if (up[i]) continue;
      const main = this.mainCrossing(inc[i], i);
      let k = 0;
      if (g.sig[i]) k = 1 | 2 | (main ? 4 : 0);
      else if (mode === 'main') k = main ? 1 | 2 | 4 : 0;
      else if (mode === 'all') { k = this.junctionKind(inc[i], i); if (k && main) k |= 4; }
      if (!k) continue;
      kind[i] = k;
      lit.push(i);
      if (!g.sig[i]) this.inferred++;
    }
    // The most important junctions seed their clusters first, so a side street's corner joins the
    // arterial crossing beside it rather than the other way round.
    const weight = (i: number) => (g.sig[i] ? 8 : 0) + (kind[i] & 4 ? 4 : 0) + (kind[i] & 2 ? 2 : 0);
    lit.sort((a, b) => weight(b) - weight(a) || a - b);
    const cell = (x: number) => Math.floor(x / JOIN_MAIN);
    const grid = new Map<string, number[]>();
    for (const i of lit) {
      const key = `${cell(g.nodeX[i])}_${cell(g.nodeZ[i])}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    }
    const strong = (i: number) => g.sig[i] > 0 || (kind[i] & 4) > 0;
    for (const seed of lit) {
      if (this.cluster[seed] >= 0) continue;
      const id = this.axis.length;
      const stack = [seed]; this.cluster[seed] = id;
      const sx0 = g.nodeX[seed], sz0 = g.nodeZ[seed];
      let sx = 0, sz = 0, cnt = 0, major = false;
      while (stack.length) {
        const a = stack.pop()!;
        const ax = g.nodeX[a], az = g.nodeZ[a];
        sx += ax; sz += az; cnt++;
        if (kind[a] & 2) major = true;
        for (let gx = cell(ax) - 1; gx <= cell(ax) + 1; gx++) for (let gz = cell(az) - 1; gz <= cell(az) + 1; gz++) {
          for (const b of grid.get(`${gx}_${gz}`) ?? []) {
            if (this.cluster[b] >= 0) continue;
            const bx = g.nodeX[b], bz = g.nodeZ[b];
            const join = strong(a) && strong(b) ? JOIN_MAIN : JOIN;
            if (Math.hypot(ax - bx, az - bz) >= join || Math.hypot(sx0 - bx, sz0 - bz) >= RADIUS) continue;
            this.cluster[b] = id; stack.push(b);
          }
        }
      }
      const p = major ? MAJOR : MINOR;
      if (!major) this.minor++;
      this.centres.push({ x: sx / cnt, z: sz / cnt });
      this.axis.push(0);
      this.plans.push(p);
      this.offset.push(((seed * 2654435761) >>> 0) / 4294967296 * p.cycle);
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

  /** Plan-view direction of link `l` as an arm of `node` (either way along it: only the axis matters). */
  private armAngle(l: Link, node: number): number {
    return l.from === node ? Math.atan2(l.d0z, l.d0x) : Math.atan2(l.d1z, l.d1x);
  }

  /** True if two of these angles lie on different axes (more than 30 degrees apart, either way along). */
  private static crosses(angles: number[]): boolean {
    for (let i = 0; i < angles.length; i++) for (let j = i + 1; j < angles.length; j++) {
      let d = Math.abs(angles[i] - angles[j]) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      if (d > Math.PI / 6) return true;
    }
    return false;
  }

  /**
   * Whether streets meet at `node`, and so whether it gets lights: 0 no, else 1 | (2 if a main
   * road is involved, for the MAJOR plan). A junction is three or more street arms that do not all
   * run the same way. Service roads are not arms. On an expressway the `_link` ramps are not arms
   * either (they merge and diverge), and nothing on a motorway is ever lit.
   */
  private junctionKind(links: number[], node: number): number {
    if (links.length < 3) return 0;
    let top = 0;
    for (const id of links) {
      const l = this.g.links[id];
      if (l.cls === 'motorway') return 0;
      if (!SERVICE.has(l.cls)) top = Math.max(top, RANK[l.cls] ?? 0);
    }
    const angles: number[] = [];
    for (const id of links) {
      const l = this.g.links[id];
      if (SERVICE.has(l.cls) || (top >= 5 && l.cls.endsWith('_link'))) continue;
      angles.push(this.armAngle(l, node));
    }
    if (angles.length < 3 || !Signals.crosses(angles)) return 0;
    return 1 | (top >= SIG_RANK ? 2 : 0);
  }

  /** True where three or more arms meet and two main roads cross on different axes. */
  private mainCrossing(links: number[], node: number): boolean {
    if (links.length < 3) return false;
    const angles: number[] = [];
    for (const id of links) {
      const l = this.g.links[id];
      if ((RANK[l.cls] ?? 0) >= SIG_RANK) angles.push(this.armAngle(l, node));
    }
    return Signals.crosses(angles);
  }

  junctionOf(node: number): number { return this.cluster[node]; }

  /** Seconds in junction `c`'s whole cycle. */
  cycleOf(c: number): number { return this.plans[c].cycle; }

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

  /** How long `phase` is green for in total at junction `c`. A crossing longer than this has to start on the change. */
  greenSpan(c: number, phase: number): number { return this.plans[c].green[phase]; }

  /** Seconds into `phase`'s own window of the cycle at junction `c`. */
  private local(c: number, phase: number, t: number): number {
    const p = this.plans[c];
    return (((t + this.offset[c]) % p.cycle) - p.start[phase] + p.cycle) % p.cycle;
  }

  /** Seconds of green left for `phase` at junction `c` (0 on amber or red). People cross with the parallel green. */
  greenLeft(c: number, phase: number, t: number): number {
    const u = this.local(c, phase, t), g = this.plans[c].green[phase];
    return u < g ? g - u : 0;
  }

  /** Light facing traffic at the end of link `l` at time `t` (s). Unsignalised ends are green. */
  state(l: Link, t: number): Light {
    const c = this.cluster[l.to];
    if (c < 0) return 0;
    // A link that starts inside the same junction (the short piece between two carriageways) is
    // already past the stop line.
    if (this.cluster[l.from] === c) return 0;
    const phase = this.phaseOf(l);
    const u = this.local(c, phase, t), g = this.plans[c].green[phase];
    return u < g ? 0 : u < g + AMBER ? 1 : 2;
  }
}

function lightsParam(): LightsMode {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lights') : null;
  return v === 'osm' || v === 'main' ? v : 'all';
}

/**
 * The lamp housing: `across` is its width along the arm, `along` its depth along the traffic it
 * faces. The lamps sit just proud of the face towards that traffic. They were placed 0.17 m out -
 * right for a 0.32 m deep box, but the box is 0.42 m that way, so every lamp in the city sat 4 cm
 * inside its housing and no light was ever seen to change (found 2026-09-21 by shooting a head
 * from 6 m in front: `.scratch/lights/lamps.mjs`).
 */
const HOUSING = { across: 0.32, along: 0.42, h: 1.2, out: 1.05, y: 4.95 };
const LAMP_PROUD = HOUSING.along / 2 + 0.015;

/** Poles with three-lamp heads at the stop lines of signalised approaches near the player. */
export class SignalHeads {
  private poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private heads: { l: Link; lamp: number }[] = [];
  private lastX = Infinity; private lastZ = Infinity;
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _v = new THREE.Vector3(); private _s = new THREE.Vector3(1, 1, 1);
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private cols: THREE.Color[];

  private order: { id: number; d: number }[] = [];

  /**
   * `cap` heads, nearest first. With every junction lit there are ~3x the approaches in range, and
   * taking the first 160 the grid happened to list could leave the junction in front of you dark
   * while one 250 m away had its lights: a car stopping at a red nobody could see.
   */
  constructor(scene: THREE.Scene, private g: LaneGraph, private sig: Signals, private cap = 240) {
    const pole = new THREE.CylinderGeometry(0.09, 0.11, 5.6, 8).translate(0, 2.8, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 1).translate(0, 5.3, 0.5);
    const housing = new THREE.BoxGeometry(HOUSING.along, HOUSING.h, HOUSING.across).translate(0, HOUSING.y, HOUSING.out);
    const g0 = mergeAll([pole, arm, housing]);
    this.poles = new THREE.InstancedMesh(g0, new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.6, metalness: 0.5 }), cap);
    // Three lamps per head: one instanced mesh, per-instance colour (lit colours are HDR for bloom).
    const lamp = new THREE.CircleGeometry(0.13, 16).rotateY(Math.PI).translate(0, 0, 0);
    this.lamps = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: '#ffffff' }), cap * 3);
    for (const m of [this.poles, this.lamps]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    this.poles.castShadow = true;
    // Lit colours are HDR for the bloom, but not so bright that AgX bleaches them: at 3.2-3.6 the red
    // read as salmon and the green as mint. Keep one channel dominant and the peak under ~1.8.
    this.cols = [new THREE.Color(0.04, 1.5, 0.45), new THREE.Color(1.7, 0.75, 0.02), new THREE.Color(1.8, 0.06, 0.03)];
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
    const order = this.order;
    order.length = 0;
    for (const id of this.g.near(x, z, 280)) {
      const l = this.g.links[id];
      // Short approaches too: between two junctions 10-15 m apart, AiDriver still stops at the line.
      if (this.sig.junctionOf(l.to) < 0 || this.sig.junctionOf(l.from) === this.sig.junctionOf(l.to) || l.len < 8) continue;
      order.push({ id, d: Math.hypot(this.g.nodeX[l.to] - x, this.g.nodeZ[l.to] - z) });
    }
    order.sort((a, b) => a.d - b.d);
    for (const { id } of order) {
      const l = this.g.links[id];
      if (this.heads.length >= this.cap) break;
      // At the stop line (7 m short of the node, or as near the start as a short approach allows),
      // on the right-hand kerb, arm reaching over the carriageway, lamps facing traffic.
      const p = this.g.at(l, Math.max(2, l.len - 7), -l.hw - 0.8, this.tmp);
      // Local +Z (the arm) turned onto left of travel, (dz, -dx): across the road.
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.dz, -p.dx));
      const i = this.heads.length;
      this.poles.setMatrixAt(i, this._m.compose(this._v.set(p.x, 0, p.z), this._q, this._s));
      for (let k = 0; k < 3; k++) {
        // Lamps on the housing's face towards oncoming traffic (against the travel direction).
        const local = new THREE.Vector3(0, HOUSING.y + 0.38 - k * 0.38, HOUSING.out).applyQuaternion(this._q);
        this._v.set(p.x + local.x - p.dx * LAMP_PROUD, local.y, p.z + local.z - p.dz * LAMP_PROUD);
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
