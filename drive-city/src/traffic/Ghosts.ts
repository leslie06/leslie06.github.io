import * as THREE from 'three';
import { CarKit } from './CarKit';
import type { LaneGraph, Link } from './LaneGraph';
import type { Signals } from './Signals';
import { STOP_LINE } from './AiDriver';
import { SPEC_OF } from '../vehicle/Spec';
import { bodySettled, specLength, type BodySource, type BodyType } from '../vehicle/Bodies';
import { defaultLivery } from '../vehicle/CarModel';

/**
 * The distant traffic (2026-10-11, 「街道太空」: the physics traffic lives within 330 m of the camera, so down a
 * Beijing arterial the road ran empty to the horizon). Cars with no physics drive the lane graph from `R_IN` out
 * to `rOut`: the Intelligent Driver Model behind the car in front (another of these, or a physics car's driver),
 * stopping at red lights, slowing for turns, picking the way on as traffic does (`LaneGraph.next`) - and drawn
 * as instances of far kits that keep their lamps (headlights at night, brake lamps in a queue).
 *
 * At the edges they hand over: one that comes within `R_IN` of the camera becomes a physics car where it is, at
 * its speed and lane (`adopt`, traffic/'s pool; while the pool is full it drives on as one of these until 120 m,
 * and goes when out of view), and a physics car leaving for good past 330 m becomes one of these (`take`), so a
 * car neither appears nor vanishes at either edge. New ones are put out of view (anywhere at the start or after
 * the camera jumps), on links weighted by length, lanes and class density, as far as the budget `cap` allows.
 */
export interface GhostCar {
  link: number; s: number; lane: number; v: number;
  /** Own desired speed factor. */
  mood: number;
  /** The link after this one: -2 not chosen yet, -1 the road ends. */
  next: number;
  body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean;
  /** Drawn lateral offset (eases to the lane's at a lane change across a junction). */
  off: number;
  brake: boolean;
  /** Bucket order this frame (-1: a physics car's entry). */
  ord: number;
  /** Length of its body, m. */
  len: number;
  /** Where it was put this frame: point and direction; `k` the polyline segment it is on (a search hint). */
  x: number; z: number; dx: number; dz: number; k: number;
}
/** A car in a lane's list: a ghost, or a physics car's driver (`ord` -1). */
type Entry = GhostCar | { s: number; v: number; ord: -1; len: number };
/** What a physics car hands over (and an adopted ghost gives). */
export interface Handover { link: number; s: number; lane: number; v: number; body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean }

/** Cars per lane-kilometre by road class (the density the budget is shared out by; scaled down to fit it). */
const DENSITY: Record<string, number> = {
  motorway: 30, trunk: 30, primary: 26, secondary: 18, tertiary: 8, busway: 4, unclassified: 2.5, residential: 2,
  motorway_link: 10, trunk_link: 10, primary_link: 8, secondary_link: 6, tertiary_link: 4,
};
/** How much of its share a link out of view gets (the budget goes where the camera looks; turning round, new ones come). */
const BEHIND = 0.25;
/** Within this a ghost becomes a physics car (traffic spawns its own from 70 m, and lets go of them past 330). */
export const R_IN = 220;
/** A ghost that could not become a physics car goes at the latest here (out of view from R_IN - 40). */
const R_GONE = 120;
/** New ones in view only this far off. */
const IN_VIEW_MIN = R_IN + 10;
const A_MAX = 1.6, B_COMF = 2.8;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class GhostTraffic {
  readonly cars: GhostCar[] = [];
  private kits = new Map<BodyType, CarKit>();
  private buckets = new Map<number, Entry[]>();
  private spareLists: Entry[][] = [];
  private list(o: Entry): Entry[] { const l = this.spareLists.pop() ?? []; l.push(o); return l; }
  /** Physics cars' entries in the lanes, reused. */
  private drv: { s: number; v: number; ord: -1; len: number }[] = [];
  /** Points along each link (x, z), once asked for. */
  private samples = new Map<number, Float32Array>();
  private free: GhostCar[] = [];
  private refillT = 0;
  /** Cars the roads in reach would hold at full density (weighted), last refill: probes. */
  demand = 0;
  private warm = 2;
  private last = new THREE.Vector3(Infinity, 0, Infinity);
  private tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private pos = new THREE.Vector3();
  /** The camera's direction this frame. */
  private dir = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private lit = { taxi: false, brake: false };
  /** Physics cars as leaders: [link, s, lane, v, length] per car, set each frame by traffic. */
  readonly drivers: number[] = [];

  /**
   * At night, one bright point a car (white facing the camera, red going away): its lamps are under a pixel past
   * 300 m, and a Beijing avenue at night is a stream of them. One draw call; HDR colours, so bloom takes them.
   */
  private lights: THREE.Points;
  private lightPos: THREE.BufferAttribute;
  private lightCol: THREE.BufferAttribute;

  constructor(private scene: THREE.Scene, private g: LaneGraph, private sig: Signals, private rnd: () => number,
    readonly cap: number, readonly rOut: number,
    /** Bodies drawn as themselves (others map to these: hatch -> sedan, mpv -> suv, truck -> suv). */
    private bodies: Set<BodyType>,
    /** A body and colours for a new car on a link of class `cls`. */
    private paint: (cls: string) => { body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean },
    /** Make it a physics car here; false while the pool has no room. */
    private adopt: (h: Handover) => boolean) {
    const geo = new THREE.BufferGeometry();
    this.lightPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.lightCol = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.lightPos); geo.setAttribute('color', this.lightCol);
    geo.setDrawRange(0, 0);
    this.lights = new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lights.frustumCulled = false;
    this.lights.name = 'ghost-lights';
    scene.add(this.lights);
  }

  private bodyOf(b: BodyType): BodyType {
    const d: BodyType = this.bodies.has(b) ? b : b === 'mpv' || b === 'truck' ? 'suv' : 'sedan';
    return this.bodies.has(d) && bodySettled(d as BodySource) ? d : 'sedan';
  }
  private kit(b: BodyType): CarKit {
    let k = this.kits.get(b);
    if (!k) { k = new CarKit(this.scene, this.cap, defaultLivery(b), b, { far: true, lamps: true }); this.kits.set(b, k); }
    return k;
  }

  private add(h: Handover, mood = 0.85 + this.rnd() * 0.2): GhostCar | null {
    if (this.cars.length >= this.cap) return null;
    const c = this.free.pop() ?? { link: 0, s: 0, lane: 0, v: 0, mood: 1, next: -2, body: 'sedan', upper: new THREE.Color(), lower: new THREE.Color(), taxi: false, off: 0, brake: false, ord: 0, len: 4.6, x: 0, z: 0, dx: 0, dz: 1, k: 1 };
    const l = this.g.links[h.link];
    c.link = h.link; c.s = h.s; c.lane = Math.min(h.lane, l.lanes - 1); c.v = h.v; c.mood = mood; c.next = -2;
    c.body = h.body; c.len = specLength(SPEC_OF[h.body]); c.upper.copy(h.upper); c.lower.copy(h.lower); c.taxi = h.taxi; c.off = this.g.laneOffset(l, c.lane); c.brake = false; c.k = 1;
    this.place(c, l);
    this.cars.push(c);
    return c;
  }
  /** Put `c` at its s and offset on its link (as `LaneGraph.at`, walking on from the segment it was on). */
  private place(c: GhostCar, l: Link): void {
    const m = l.cum.length, s = Math.max(0, Math.min(l.len, c.s));
    let k = c.k;
    if (k < 1 || k > m - 1 || l.cum[k - 1] > s) k = 1;
    while (k < m - 1 && l.cum[k] < s) k++;
    c.k = k;
    const s0 = l.cum[k - 1], s1 = l.cum[k], t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], bx = l.pts[k * 2], bz = l.pts[k * 2 + 1];
    let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    c.x = ax + (bx - ax) * t + dz * c.off; c.z = az + (bz - az) * t - dx * c.off; c.dx = dx; c.dz = dz;
  }

  private remove(i: number): void {
    const c = this.cars[i];
    this.cars[i] = this.cars[this.cars.length - 1];
    this.cars.pop();
    this.free.push(c);
  }

  /** A physics car leaving for good: it drives on as one of these (when within reach and the budget). */
  take(h: Handover): void { this.add(h); }

  /** Forget them all (a teleport): the next frames fill the new place anywhere, in view or not. */
  reset(): void { while (this.cars.length) this.remove(this.cars.length - 1); this.warm = 2; }

  /**
   * The ghost in front of a physics car on `link` (then `next`) at `s` in `lane`: the distance from centre to
   * centre, its length and speed, or null (traffic's leader test: a physics car must not drive through one either).
   */
  leaderFor(link: number, s: number, lane: number, next: number): { ds: number; len: number; v: number } | null {
    const b = this.buckets.get(link * 8 + lane);
    if (b) for (const o of b) if (o.ord >= 0 && o.s > s) return { ds: o.s - s, len: o.len, v: o.v };
    if (next >= 0) {
      const nl = this.g.links[next], b2 = this.buckets.get(next * 8 + Math.min(lane, nl.lanes - 1));
      if (b2) for (const o of b2) if (o.ord >= 0) return { ds: this.g.links[link].len - s + o.s, len: o.len, v: o.v };
    }
    return null;
  }

  /** Physics room came free: the nearest ghost already within R_IN takes it (before traffic spawns one of its own). */
  adoptWaiting(cam: THREE.Vector3): boolean {
    let best = -1, bd = R_IN;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i], d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    const c = this.cars[best];
    if (!this.adopt({ link: c.link, s: c.s, lane: c.lane, v: c.v, body: c.body, upper: c.upper, lower: c.lower, taxi: c.taxi })) return false;
    this.remove(best);
    return true;
  }

  /** Simulate, hand over, refill and draw: once a frame, from traffic's update (after `drivers` is set); `room`: the physics pool has a free place. */
  update(dt: number, t: number, cam: THREE.Vector3, camDir: THREE.Vector3, night: boolean, room = true): void {
    dt = Math.min(dt, 0.1);
    const g = this.g;
    if (Math.hypot(cam.x - this.last.x, cam.z - this.last.z) > 150) this.reset();
    this.last.copy(cam);
    this.dir.copy(camDir);
    this.warm = Math.max(0, this.warm - dt);
    const inView = (x: number, z: number, d: number) => d < 1 || ((x - cam.x) * camDir.x + (z - cam.z) * camDir.z) / d > 0.3;

    // Lanes: every ghost and every physics car in its link and lane, in order along it.
    // (the map is emptied every frame and its arrays reused: kept, it grew by every lane ever driven)
    for (const b of this.buckets.values()) { b.length = 0; this.spareLists.push(b); }
    this.buckets.clear();
    const put = (key: number, o: Entry) => { const b = this.buckets.get(key); if (b) b.push(o); else this.buckets.set(key, this.list(o)); };
    for (const c of this.cars) { c.ord = 0; put(c.link * 8 + c.lane, c); }
    for (let i = 0, j = 0; i < this.drivers.length; i += 5, j++) {
      const o = this.drv[j] ?? (this.drv[j] = { s: 0, v: 0, ord: -1, len: 4.6 });
      o.s = this.drivers[i + 1]; o.v = this.drivers[i + 3]; o.len = this.drivers[i + 4];
      put(this.drivers[i] * 8 + this.drivers[i + 2], o);
    }
    for (const b of this.buckets.values()) {
      if (b.length > 1) b.sort((a, c) => a.s - c.s);
      for (let k = 0; k < b.length; k++) if (b[k].ord >= 0) b[k].ord = k;
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      let l = g.links[c.link];
      if (c.next === -2 && c.s > l.len - 60) c.next = g.next(c.link, this.rnd);
      // The car in front: on this lane, else the first on the way on.
      let gap = Infinity, vl = 0;
      const b = this.buckets.get(c.link * 8 + c.lane)!;
      const k = c.ord + 1;
      if (k < b.length) { gap = b[k].s - c.s - (b[k].len + c.len) / 2; vl = b[k].v; }
      if (gap === Infinity && c.next >= 0) {
        const nl = g.links[c.next], b2 = this.buckets.get(c.next * 8 + Math.min(c.lane, nl.lanes - 1));
        if (b2?.length) { gap = l.len - c.s + b2[0].s - (b2[0].len + c.len) / 2; vl = b2[0].v; }
      }
      // A red light (or an amber one it can stop for) is a standing car at the stop line.
      const toLine = l.len - STOP_LINE - c.s;
      if (toLine > -0.5 && toLine < 70) {
        const light = this.sig.state(l, t);
        if (light === 2 || (light === 1 && c.v * c.v / 8 < toLine + 0.5)) if (toLine + 2 < gap) { gap = Math.max(0.1, toLine + 2); vl = 0; }
      }
      if (c.next === -1 && l.len - c.s < gap) { gap = Math.max(0.1, l.len - c.s - 2); vl = 0; }
      let v0 = l.speed * c.mood;
      if (c.next >= 0 && l.len - c.s < 40) {
        const nl = g.links[c.next];
        const turn = Math.acos(Math.max(-1, Math.min(1, l.d1x * nl.d0x + l.d1z * nl.d0z)));
        if (turn > 0.3) v0 = Math.min(v0, Math.sqrt(2.6 * 28 / turn));
      }
      const sStar = 2.5 + c.v * 1.3 + c.v * (c.v - vl) / (2 * Math.sqrt(A_MAX * B_COMF));
      const a = A_MAX * (1 - (c.v / Math.max(1, v0)) ** 4 - (gap < Infinity ? (Math.max(0, sStar) / Math.max(0.1, gap)) ** 2 : 0));
      c.v = Math.max(0, c.v + Math.max(-8, a) * dt);
      c.brake = a < -0.6 || c.v < 0.3;
      c.s += c.v * dt;
      // On to the next link (the lane kept where it can be; the drawn offset eases across).
      let gone = false;
      while (c.s > l.len) {
        if (c.next < 0) { gone = true; break; }
        c.s -= l.len; c.link = c.next; c.next = -2; c.k = 1; l = g.links[c.link];
        if (c.lane >= l.lanes) c.lane = l.lanes - 1;
      }
      if (gone) { this.remove(i); continue; }
      const want = g.laneOffset(l, c.lane);
      c.off += Math.max(-1.5 * dt, Math.min(1.5 * dt, want - c.off));
      // At the edges: into the physics traffic, or out of range.
      this.place(c, l);
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d > this.rOut + 40) { this.remove(i); continue; }
      if (d < R_IN) {
        if (room && this.adopt({ link: c.link, s: c.s, lane: c.lane, v: c.v, body: c.body, upper: c.upper, lower: c.lower, taxi: c.taxi })) { this.remove(i); continue; }
        if (d < R_GONE || (d < R_IN - 40 && !inView(c.x, c.z, d))) { this.remove(i); continue; }
      }
    }

    this.refillT -= dt;
    if (this.refillT <= 0) { this.refillT = this.warm > 0 ? 0.05 : 0.4; this.refill(cam, inView); }
    this.draw(night);
  }

  /** Put out new ones where the roads are emptier than their share of the budget. */
  private refill(cam: THREE.Vector3, inView: (x: number, z: number, d: number) => boolean): void {
    if (this.cars.length >= this.cap) return;
    const g = this.g, ids = g.near(cam.x, cam.z, this.rOut);
    const want: number[] = [], who: number[] = [];
    let total = 0;
    for (const id of ids) {
      const l = g.links[id], dens = DENSITY[l.cls];
      if (!dens || l.len < 15 || g.avoid.has(id)) continue;
      // Its share by the part of it in reach, in view and nearer (points every ~50 m along it: judged by its middle,
      // a long link starting by the camera got nothing - the lanes ahead stayed empty to 450 m).
      let pts = this.samples.get(id);
      if (!pts) {
        const n = Math.max(2, Math.min(12, Math.ceil(l.len / 50)));
        pts = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) { g.at(l, (k + 0.5) / n * l.len, 0, this.tmp); pts[k * 2] = this.tmp.x; pts[k * 2 + 1] = this.tmp.z; }
        this.samples.set(id, pts);
      }
      let share = 0;
      const n = pts.length / 2;
      for (let k = 0; k < n; k++) {
        const x = pts[k * 2], z = pts[k * 2 + 1], d = Math.hypot(x - cam.x, z - cam.z);
        if (d < R_IN + 20 || d > this.rOut) continue;
        share += (inView(x, z, d) ? 1 : BEHIND) * (d < 450 ? 1 : 1 - 0.5 * (d - 450) / (this.rOut - 450 || 1));
      }
      if (!share) continue;
      const w = l.len * l.lanes * dens / 1000 * share / n;
      want.push(w); who.push(id); total += w;
    }
    if (!total) return;
    const scale = Math.min(1, this.cap / total);
    this.demand = total;
    const have = new Map<number, number>();
    for (const c of this.cars) have.set(c.link, (have.get(c.link) ?? 0) + 1);
    // Full, and the view short of its share: let the furthest ones out of view go (they would only be seen on turning round).
    if (this.cars.length >= this.cap - 4) {
      let freed = 0;
      for (let i = this.cars.length - 1; i >= 0 && freed < 12; i--) {
        const c = this.cars[i], d = Math.hypot(c.x - cam.x, c.z - cam.z);
        if (d > 380 && ((c.x - cam.x) * this.dir.x + (c.z - cam.z) * this.dir.z) / d < -0.2) { this.remove(i); freed++; }
      }
    }
    const tries = this.warm > 0 ? 60 : 8;
    for (let k = 0; k < tries && this.cars.length < this.cap; k++) {
      // a link by its shortfall
      let sum = 0;
      for (let i = 0; i < who.length; i++) sum += Math.max(0, want[i] * scale - (have.get(who[i]) ?? 0));
      if (sum < 0.5) return;
      let u = this.rnd() * sum, i = 0;
      for (; i < who.length - 1; i++) { u -= Math.max(0, want[i] * scale - (have.get(who[i]) ?? 0)); if (u <= 0) break; }
      const id = who[i], l = g.links[id];
      const s = 4 + this.rnd() * (l.len - 8), lane = Math.floor(this.rnd() * l.lanes);
      g.at(l, s, g.laneOffset(l, lane), this.tmp);
      const d = Math.hypot(this.tmp.x - cam.x, this.tmp.z - cam.z);
      if (d < R_IN + 10 || d > this.rOut) continue;
      // In view only far off: a car seen from behind at 230 m is 7 px wide (the lanes heading away from the camera
      // fill no other way - nothing drives into them from the near side, so held to 450 m they stayed empty).
      if (this.warm <= 0 && d < IN_VIEW_MIN && inView(this.tmp.x, this.tmp.z, d)) continue;
      const b = this.buckets.get(id * 8 + lane);
      if (b && b.some((o) => Math.abs(o.s - s) < 14)) continue;
      const p = this.paint(l.cls);
      const c = this.add({ link: id, s, lane, v: l.speed * 0.8, ...p });
      if (c) { have.set(id, (have.get(id) ?? 0) + 1); if (b) b.push(c); else this.buckets.set(id * 8 + lane, this.list(c)); }
    }
  }

  private draw(night: boolean): void {
    const g = this.g, cam = this.last, lp = this.lightPos.array as Float32Array, lc = this.lightCol.array as Float32Array;
    let nl = 0;
    for (const c of this.cars) {
      const l: Link = g.links[c.link];
      const body = this.bodyOf(c.body), spec = SPEC_OF[body], kit = this.kit(body);
      let y = 0, pitch = 0;
      if (l.h) {
        y = g.heightAt(l, c.s);
        pitch = Math.atan((g.heightAt(l, Math.min(l.len, c.s + 2)) - g.heightAt(l, Math.max(0, c.s - 2))) / 4);
      }
      this.pos.set(c.x, y + 0.03 + spec.wheelRadius, c.z);
      if (!kit.sees(this.pos)) continue;
      this.quat.setFromEuler(_e.set(-pitch, Math.atan2(c.dx, c.dz), 0));
      this.lit.taxi = c.taxi; this.lit.brake = c.brake;
      kit.setStill(this.pos, this.quat, c.upper, c.lower, this.lit);
      if (night) {
        // the end facing the camera, 0.7 m up: headlamps or tail lamps (brighter braking), fading with distance
        const tx = cam.x - c.x, tz = cam.z - c.z, d = Math.hypot(tx, tz) || 1, front = (tx * c.dx + tz * c.dz) / d;
        const end = (front > 0 ? 1 : -1) * c.len * 0.48, k = (1.2 - 0.6 * Math.min(1, d / this.rOut)) * Math.min(1, Math.abs(front) * 3 + 0.25);
        lp[nl * 3] = c.x + c.dx * end; lp[nl * 3 + 1] = this.pos.y + 0.4; lp[nl * 3 + 2] = c.z + c.dz * end;
        if (front > 0) { lc[nl * 3] = 4 * k; lc[nl * 3 + 1] = 3.6 * k; lc[nl * 3 + 2] = 2.8 * k; }
        else { const b = c.brake ? 4.4 : 2.4; lc[nl * 3] = b * k; lc[nl * 3 + 1] = 0.08 * k; lc[nl * 3 + 2] = 0.05 * k; }
        nl++;
      }
    }
    this.lights.geometry.setDrawRange(0, nl);
    this.lights.visible = nl > 0;
    if (nl) { this.lightPos.needsUpdate = true; this.lightCol.needsUpdate = true; this.lightPos.clearUpdateRanges(); this.lightPos.addUpdateRange(0, nl * 3); this.lightCol.clearUpdateRanges(); this.lightCol.addUpdateRange(0, nl * 3); }
    for (const k of this.kits.values()) { k.commit(0); k.setHeadlights(night); }
  }

}
