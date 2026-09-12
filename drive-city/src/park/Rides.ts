import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms } from '../game/Contracts';
import { Parts, box, cyl, flat, prism, rectPoly, tube, type V3 } from '../city/landmarks/kit/geo';
import { landmarkMaterials, nightGlow } from '../city/landmarks/kit/mats';
import { COASTER, PENDULUM, SHIP, MOUNTAIN, EXTENT, GATE, RIDES } from './Layout';
import { OUTLINE, PATHS, WATER } from './Osm';
import { buildProps } from './Props';

/**
 * Everything the park is made of. The static half (track, towers, stations, the rock mountain, the
 * fence) is built into `Parts` and handed to the landmark assembler; the moving half (the train,
 * the frisbee disc, the ship) is built as plain groups because it is transformed every frame.
 *
 * The track is the interesting part. A coaster needs a frame that rolls with the rails - Frenet
 * frames flip at every inflection and would tear the track apart at the loop - so the frame is
 * parallel-transported along the spline and then banked into the turns by the lateral acceleration
 * the train will actually feel. `frameAt()` is shared with the ride motion in index.ts, so the car
 * sits exactly on the rails it is drawn on.
 */

const G = 9.81;
/** Samples along the track: 853 m of track at ~0.7 m a sample. */
const SAMPLES = 1200;

export interface Frame { pos: THREE.Vector3; tan: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3 }

let curve: THREE.CatmullRomCurve3 | null = null;
let frames: { pos: THREE.Vector3; tan: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3 }[] = [];
let arc: Float32Array = new Float32Array(0);

/** The track centre line, closed, in park-local metres. */
export function trackCurve(): THREE.CatmullRomCurve3 {
  if (!curve) {
    curve = new THREE.CatmullRomCurve3(COASTER.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', 0.5);
  }
  return curve;
}

/** Total length of the spline in metres. */
export function trackLength(): number { buildFrames(); return arc[arc.length - 1]; }

/**
 * Parallel-transported frames with banking. The up vector is carried along the curve by the
 * smallest rotation between consecutive tangents (no flips), then rolled about the tangent by
 * atan(v^2 * curvature / g) so the track leans into its turns the way a real one is surveyed.
 */
function buildFrames(): void {
  if (frames.length) return;
  const c = trackCurve();
  const pts = c.getSpacedPoints(SAMPLES);
  const n = pts.length;
  arc = new Float32Array(n);
  const tan: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    tan.push(new THREE.Vector3().subVectors(b, a).normalize());
    if (i > 0) arc[i] = arc[i - 1] + pts[i].distanceTo(pts[i - 1]);
  }
  // Speed from conservation of energy, so the banking matches what the train will do here.
  let hMax = -Infinity;
  for (const p of pts) hMax = Math.max(hMax, p.y);
  const speedAt = (i: number) => Math.sqrt(Math.max(25, 2 * G * (hMax + 1.5 - pts[i].y)));
  const up = new THREE.Vector3(0, 1, 0);
  up.addScaledVector(tan[0], -up.dot(tan[0])).normalize();
  const q = new THREE.Quaternion();
  // Pass one: carry `up` along the track. On a closed circuit it does not come back to where it
  // started (a vertical loop alone turns it a full revolution), and the leftover twist would show
  // up as the track flipping over between the last sample and the first. Measure that residual and
  // unwind it evenly along the lap, so the rails close on themselves.
  const carried: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) { q.setFromUnitVectors(tan[i - 1], tan[i]); up.applyQuaternion(q).normalize(); }
    carried.push(up.clone());
  }
  const first = carried[0], last = carried[n - 1];
  const sideRef = new THREE.Vector3().crossVectors(tan[0], first).normalize();
  let residual = Math.atan2(last.dot(sideRef), last.dot(first));
  if (!Number.isFinite(residual)) residual = 0;
  // Banking, from the turn the track makes in plan alone. The full 3-D curvature saturates inside
  // the vertical loop - where the "turn" is the loop, not a corner - and changes sign halfway round,
  // which flipped the rails over between one sample and the next. Steep track banks less, and a box
  // filter takes the last kinks out, doing the job a transition spiral does on a real ride.
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = tan[(i - 1 + n) % n], b = tan[(i + 1) % n];
    let dh = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z);
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const ds = Math.max(0.01, pts[(i + 1) % n].distanceTo(pts[(i - 1 + n) % n]));
    const level = Math.max(0, 1 - tan[i].y * tan[i].y);
    // Positive bank rolls the riders towards `side`; a turn towards +x needs the opposite.
    const lat = -(dh / ds) * speedAt(i) * speedAt(i) * level;
    raw[i] = Math.max(-1, Math.min(1, Math.atan2(lat, G)));
  }
  const W = 12;
  const bank = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -W; k <= W; k++) sum += raw[(i + k + n) % n];
    bank[i] = sum / (2 * W + 1);
  }
  frames = [];
  for (let i = 0; i < n; i++) {
    up.copy(carried[i]).applyAxisAngle(tan[i], -residual * (i / (n - 1))).normalize();
    const rolled = up.clone().applyAxisAngle(tan[i], bank[i]).normalize();
    const side = new THREE.Vector3().crossVectors(tan[i], rolled).normalize();
    frames.push({ pos: pts[i].clone(), tan: tan[i].clone(), up: rolled, side });
  }
}

/** Frame at `s` metres along the track (wraps). Vectors are shared - copy before keeping them. */
export function frameAt(s: number, out: Frame): Frame {
  buildFrames();
  const total = arc[arc.length - 1];
  let d = s % total; if (d < 0) d += total;
  // arc is uniform enough (getSpacedPoints) to index directly.
  const f = (d / total) * (frames.length - 1);
  const i = Math.floor(f), t = f - i, j = (i + 1) % frames.length;
  const a = frames[i], b = frames[j];
  out.pos.lerpVectors(a.pos, b.pos, t);
  out.tan.lerpVectors(a.tan, b.tan, t).normalize();
  out.up.lerpVectors(a.up, b.up, t).normalize();
  out.side.crossVectors(out.tan, out.up).normalize();
  return out;
}

export function makeFrame(): Frame {
  return { pos: new THREE.Vector3(), tan: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3() };
}

/** Rolling and air drag on the train, tuned so it comes back to the station with speed to spare. */
const DRAG = 0.0009;

export interface TrainState { s: number; v: number }

const trainFrame = makeFrame();

/**
 * One step of the train: gravity along the track less rolling and air drag, with the chain lift and
 * the brake run overriding it. `ending` brakes it wherever it is (the rider asked to get off).
 * Returns true on the step that finishes the lap. Shared by the ride and its test, so what the
 * test measures is what the player rides.
 */
export function advanceTrain(st: TrainState, dt: number, ending = false): boolean {
  const total = trackLength();
  const liftFrom = COASTER.lift.from * total, liftTo = COASTER.lift.to * total;
  const brakeFrom = COASTER.brake.from * total;
  frameAt(st.s, trainFrame);
  if (st.s >= liftFrom && st.s < liftTo && !ending) st.v = COASTER.lift.speed;
  else if (st.s >= brakeFrom || ending) st.v = Math.max(COASTER.brake.speed, st.v - 5 * dt);
  else st.v = Math.max(3, st.v + (-G * trainFrame.tan.y - DRAG * st.v * st.v) * dt);
  st.s += st.v * dt;
  if (st.s >= total) { st.s = total; return true; }
  return false;
}

// --------------------------------------------------------------------------------- materials

const cache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();

/** The landmark kit's materials plus the park's own: painted steel, planks, water, greenery. */
export function parkMaterials(env: EnvUniforms): Record<string, THREE.Material> {
  const hit = cache.get(env);
  if (hit) return hit;
  const std = (p: THREE.MeshStandardMaterialParameters, glow: 'flood' | 'lamp' | null = null, color = '#ffd9a0', wet: boolean | 'surface' = 'surface') => {
    const m = new THREE.MeshStandardMaterial(p);
    if (glow) nightGlow(m, env, glow, color);
    m.userData.wet = wet;
    return m;
  };
  const m: Record<string, THREE.Material> = {
    ...landmarkMaterials(env),
    // 水晶神翼 is white track on blue supports.
    rail: std({ color: '#eceff2', metalness: 0.55, roughness: 0.38 }, 'flood'),
    spine: std({ color: '#d9dde1', metalness: 0.6, roughness: 0.42 }, 'flood'),
    support: std({ color: '#2f5fa8', metalness: 0.5, roughness: 0.5 }, 'flood'),
    carBody: std({ color: '#1d6fd0', metalness: 0.4, roughness: 0.42 }),
    carTrim: std({ color: '#f0c419', metalness: 0.3, roughness: 0.45 }),
    seat: std({ color: '#23272c', roughness: 0.8 }),
    tower: std({ color: '#b4443a', metalness: 0.45, roughness: 0.5 }, 'flood'),
    disc: std({ color: '#e8e2d4', metalness: 0.25, roughness: 0.55 }, 'lamp', '#ffb347'),
    hull: std({ color: '#8a3f2a', roughness: 0.7 }),
    hullTrim: std({ color: '#e7b93f', metalness: 0.3, roughness: 0.5 }, 'lamp', '#ffd27a'),
    plank: std({ color: '#9c7b52', roughness: 0.85 }, null, '#fff', true),
    canopy: std({ color: '#d24b3f', roughness: 0.7, side: THREE.DoubleSide }, 'lamp', '#ffca7a'),
    platform: std({ color: '#b9b3a6', roughness: 0.85 }, 'flood', '#ffe9c8', true),
    fence: std({ color: '#3f4a53', metalness: 0.4, roughness: 0.6 }),
    rock: std({ color: '#b8ac97', roughness: 0.95 }, 'flood', '#ffe4b8', true),
    water: std({ color: '#2b4a52', roughness: 0.08, metalness: 0.1 }, null, '#fff', false),
    lawn: std({ color: '#6f8c55', roughness: 0.95 }, null, '#fff', true),
    leaf: std({ color: '#5f7f48', roughness: 0.92 }, null, '#fff', true),
    trunk: std({ color: '#6b5a45', roughness: 0.95 }, null, '#fff', true),
    path: std({ color: '#c9c2b4', roughness: 0.88 }, 'flood', '#ffe9c8', true),
  };
  cache.set(env, m);
  return m;
}

// --------------------------------------------------------------------------------- static parts

/** A circular section swept along the frames, offset sideways: one rail. */
function sweep(b: ReturnType<Parts['get']>, offset: number, lift: number, r: number, sides: number, step: number): void {
  buildFrames();
  const base = b.count;
  const n = Math.max(2, Math.round(frames.length / step));
  const p = new THREE.Vector3();
  for (let k = 0; k <= n; k++) {
    const f = frames[(k * step) % frames.length];
    p.copy(f.pos).addScaledVector(f.side, offset).addScaledVector(f.up, lift);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = f.side.x * ca + f.up.x * sa, ny = f.side.y * ca + f.up.y * sa, nz = f.side.z * ca + f.up.z * sa;
      b.vert(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, (i / sides) * r * 6.28, k * step * 0.7);
    }
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < sides; i++) {
    const a = base + k * (sides + 1) + i, c = a + sides + 1;
    b.quad(a, c, c + 1, a + 1);
  }
}

/** Track: two rails, the box spine under them, cross ties and the supports down to the ground. */
function coasterTrack(P: Parts): ColliderSpec[] {
  buildFrames();
  const rail = P.get('rail'), spine = P.get('spine'), sup = P.get('support');
  const gauge = 0.62;
  sweep(rail, gauge, 0.32, 0.075, 6, 2);
  sweep(rail, -gauge, 0.32, 0.075, 6, 2);
  sweep(spine, 0, -0.15, 0.34, 6, 3);
  // Cross ties every ~2.4 m.
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  for (let k = 0; k < frames.length; k += 4) {
    const f = frames[k];
    p0.copy(f.pos).addScaledVector(f.side, gauge).addScaledVector(f.up, 0.32);
    p1.copy(f.pos).addScaledVector(f.side, -gauge).addScaledVector(f.up, 0.32);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const yaw = Math.atan2(f.side.x, f.side.z);
    P.at(mid.x, mid.y - 0.18, mid.z, yaw, () => box(P.get('spine'), 0, 0, 0, 0.12, 0.12, gauge * 2.1));
  }
  // Supports: a column under the track wherever it is more than 3 m up, thinned out along the run.
  const cols: ColliderSpec[] = [];
  for (let k = 0; k < frames.length; k += 26) {
    const f = frames[k];
    const h = f.pos.y - 0.2;
    if (h < 3.2) continue;
    // Slim columns with lattice bracing, not fat pipes: a B&M column is about 40 cm across, and
    // what makes a coaster read at distance is the bracing between the legs, not the leg's girth.
    const r = h > 22 ? 0.24 : 0.19;
    const dx = f.side.x, dz = f.side.z;
    const spread = h > 14 ? 2.6 : 1.4;
    const legs: [number, number][] = [[dx * spread, dz * spread], [-dx * spread, -dz * spread]];
    for (const [lx, lz] of legs) {
      cyl(sup, f.pos.x + lx, 0, f.pos.z + lz, r * 1.2, r, h - 0.6, 6, { bottom: true });
    }
    // The cross-piece under the track, and Xs down the bay.
    tube(sup, [[f.pos.x + legs[0][0], h - 0.6, f.pos.z + legs[0][1]], [f.pos.x + legs[1][0], h - 0.6, f.pos.z + legs[1][1]]], r * 0.7, 5);
    const bays = Math.max(1, Math.round(h / 6));
    for (let bi = 0; bi < bays; bi++) {
      const y0 = (bi / bays) * (h - 0.6), y1 = ((bi + 1) / bays) * (h - 0.6);
      const a: V3 = [f.pos.x + legs[0][0], y0, f.pos.z + legs[0][1]];
      const b2: V3 = [f.pos.x + legs[1][0], y1, f.pos.z + legs[1][1]];
      const c: V3 = [f.pos.x + legs[1][0], y0, f.pos.z + legs[1][1]];
      const d: V3 = [f.pos.x + legs[0][0], y1, f.pos.z + legs[0][1]];
      tube(sup, [a, b2], r * 0.42, 4);
      tube(sup, [c, d], r * 0.42, 4);
    }
    cols.push({ kind: 'cylinder', center: [f.pos.x, h / 2, f.pos.z], radius: r * 1.2, halfHeight: h / 2 });
  }
  return cols;
}

/** A station: platform, canopy on posts, queue rails and the sign board. */
function station(P: Parts, x: number, z: number, yaw: number, len: number, w: number, label: 'rail' | 'tower'): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  P.at(x, 0, z, yaw, () => {
    const plat = P.get('platform');
    prism(plat, rectPoly(len / 2, w / 2), 0, 1.15);
    // Posts and a pitched canopy.
    const canopy = P.get('canopy'), post = P.get(label === 'rail' ? 'support' : 'tower');
    for (let i = -1; i <= 1; i += 2) for (let j = -2; j <= 2; j++) {
      cyl(post, j * (len / 5), 1.15, i * (w / 2 - 0.4), 0.11, 0.1, 3.6, 6);
    }
    P.at(0, 4.75, 0, 0, () => {
      box(canopy, 0, 0, 0, len + 1.2, 0.12, w + 1.4);
      box(canopy, 0, 0.45, 0, len + 0.4, 0.1, w * 0.55);
    });
    // Queue rails along the open side.
    const f = P.get('fence');
    for (let j = -2; j <= 2; j++) {
      cyl(f, j * (len / 5), 1.15, w / 2 + 1.6, 0.05, 0.05, 1.0, 5);
      box(f, j * (len / 5), 2.05, w / 2 + 1.6, len / 5, 0.06, 0.06);
    }
    out.push({ kind: 'box', center: [x, 0.575, z], half: [len / 2, 0.575, w / 2], yaw });
  });
  return out;
}

/** 欢乐风火轮: the A-frame tower and its bearing (the arm and disc move, so they are not here). */
function pendulumTower(P: Parts, x: number, z: number): ColliderSpec[] {
  const t = P.get('tower');
  const out: ColliderSpec[] = [];
  for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
    // Four legs leaning in to the pivot. `tube` sweeps along the leg's own direction: composing the
    // rotations by hand laid the legs flat on the ground.
    const lx = x + i * 9, lz = z + j * 7;
    tube(t, [[lx, 0, lz], [x + i * 1.1, PENDULUM.pivotY, z + j * 0.9]], 0.32, 6);
    out.push({ kind: 'cylinder', center: [lx, 1.4, lz], radius: 0.8, halfHeight: 1.4 });
  }
  // Cross-bracing between each pair of legs, the way a frisbee's A-frames are tied together.
  for (const i of [-1, 1]) {
    tube(t, [[x + i * 9, 8.5, z - 7], [x + i * 9 * 0.62, 8.5, z + 7]], 0.16, 5);
    tube(t, [[x + i * 9, 15.5, z - 7 * 0.72], [x + i * 9 * 0.38, 15.5, z + 7 * 0.72]], 0.14, 5);
  }
  // The bearing housing at the top.
  P.at(x, PENDULUM.pivotY, z, 0, () => box(t, 0, 0, 0, 3.4, 1.5, 2.2));
  return out;
}

/** 莓饼海盗船: two A-frames either side of the boat. */
function shipTower(P: Parts, x: number, z: number, yaw: number): ColliderSpec[] {
  const t = P.get('tower');
  const out: ColliderSpec[] = [];
  P.at(x, 0, z, yaw, () => {
    // Two A-frames, one either side of the boat, meeting under the bearing beam.
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        tube(t, [[j * 7.5, 0, i * 4.6], [j * 1.2, SHIP.pivotY, i * 1.1]], 0.26, 6);
      }
      tube(t, [[-7.5 * 0.55, 7.5, i * 3.1], [7.5 * 0.55, 7.5, i * 3.1]], 0.14, 5);
    }
    box(t, 0, SHIP.pivotY, 0, 4.2, 0.7, 3.4);
  });
  out.push({ kind: 'box', center: [x, 1.2, z], half: [7.5, 1.2, 0.5], yaw });
  return out;
}

/** 亚特兰蒂斯's 70 m rock mountain, the park's silhouette from the ring road. */
function mountain(P: Parts): ColliderSpec[] {
  const b = P.get('rock');
  const { x, z, r, h } = MOUNTAIN;
  // A sculpted rock, not a cone. The radius is a sum of cosines in the angle - periodic by
  // construction, so the surface closes on itself with no seam - which cuts buttresses and gullies
  // into the faces; they twist with height, and the summit leans off the axis the way the real
  // 塑山 does. Stacked cylinders read as a pagoda instead, which is what this replaced.
  const NU = 56, NV = 26;
  const lean = 9;
  const step = (a0: number, b0: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a0) / (b0 - a0))); return k * k * (3 - 2 * k); };
  b.grid(NU, NV, (u, v) => {
    const a = u * Math.PI * 2;
    // Flared skirt, near-vertical faces, then the peaks: the silhouette, not the surface noise, is
    // what decides whether this reads as rock or as a cone.
    const taper = 1 - 0.20 * step(0, 0.16, v) - 0.50 * step(0.16, 0.72, v) - 0.24 * step(0.72, 1, v);
    const ridges = 0.13 * Math.cos(5 * a + 2.3 * v) + 0.085 * Math.cos(9 * a - 1.6 * v + 1.1)
      + 0.055 * Math.cos(13 * a + 0.7);
    const rr = Math.max(1.2, r * taper * (1 + ridges * (1 - v * 0.3)));
    // Three summits rather than one point: the tallest to the south-east, where the real one is.
    const peaks = 0.55 * Math.cos(3 * a - 0.9) + 0.28 * Math.cos(5 * a + 2.2);
    const y = h * (v ** 1.05) * (1 - 0.10 * step(0.55, 1, v) * (1 - peaks));
    return [x + Math.cos(a) * rr + lean * v * v, y, z + Math.sin(a) * rr - lean * 0.4 * v * v];
  }, (u, v) => [u * r * 3.2, v * h], true);
  return [{ kind: 'cylinder', center: [x, h / 2, z], radius: r * 0.5, halfHeight: h / 2 }];
}

/** Lake, lawns, the ring path, the perimeter fence and the main gate. */
function grounds(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  // The park as OSM has it: the real boundary, and the real lakes cut into it.
  flat(P.get('lawn'), OUTLINE, 0.02);
  for (const lake of WATER) flat(P.get('water'), lake, 0.3);
  // The park's own footways, straight from OSM: one paved quad per segment.
  const path = P.get('path');
  for (const line of PATHS) {
    for (let i = 0; i + 1 < line.pts.length; i++) {
      const [x0, z0] = line.pts[i], [x1, z1] = line.pts[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const nx = (-dz / len) * (line.w / 2), nz = (dx / len) * (line.w / 2);
      flat(path, [[x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz], [x0 + nx, z0 + nz]], 0.06);
    }
  }
  // Perimeter fence, with the gate left open on the north side.
  // The fence runs along the real boundary, posted every 6 m, with a gap left at the gate.
  const f = P.get('fence');
  const step = 6;
  for (let i = 0; i < OUTLINE.length; i++) {
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % OUTLINE.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d < len; d += step) {
      const t0 = d / len, t1 = Math.min(1, (d + step) / len);
      const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0;
      const x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
      if (Math.hypot(x0 - GATE.x, z0 - GATE.z) < GATE.w) continue;
      cyl(f, x0, 0, z0, 0.08, 0.08, 2.4, 5);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      P.at(mx, 2.2, mz, yaw, () => box(f, 0, 0, 0, 0.08, 0.08, Math.hypot(x1 - x0, z1 - z0)));
    }
  }
  // Gate: two pylons and the arch over them.
  const t = P.get('tower');
  for (const i of [-1, 1]) {
    box(t, i * GATE.w / 2, 4.5, GATE.z, 2.6, 9, 2.6);
    out.push({ kind: 'box', center: [i * GATE.w / 2, 4.5, GATE.z], half: [1.3, 4.5, 1.3] });
  }
  box(P.get('canopy'), 0, 10.4, GATE.z, GATE.w + 3, 1.8, 3.2);
  return out;
}

export interface ParkStatic {
  parts: Parts;
  colliders: ColliderSpec[];
  footprint: [number, number][];
  height: number;
}

/** The whole park as static geometry, ready for the landmark assembler. */
export function buildParkStatic(): ParkStatic {
  const P = new Parts();
  const colliders: ColliderSpec[] = [];
  colliders.push(...grounds(P));
  colliders.push(...mountain(P));
  colliders.push(...buildProps(P));
  colliders.push(...coasterTrack(P));
  const coaster = RIDES[0], fire = RIDES[1], ship = RIDES[2];
  colliders.push(...station(P, coaster.x + 24, coaster.z, coaster.yaw, 34, 7, 'rail'));
  colliders.push(...pendulumTower(P, fire.x, fire.z));
  colliders.push(...station(P, fire.x, fire.z + 16, 0, 18, 6, 'tower'));
  colliders.push(...shipTower(P, ship.x, ship.z, ship.yaw));
  colliders.push(...station(P, ship.x, ship.z + 14, 0, 20, 6, 'tower'));
  return {
    parts: P,
    colliders,
    // The real boundary, not its bounding box: the city drops the OSM buildings inside this.
    footprint: OUTLINE.map(([x, z]) => [x, z] as [number, number]),
    height: MOUNTAIN.h,
  };
}

/** A far-LOD version: the mountain, the towers and the track, without ties, queue rails or fence. */
export function buildParkFar(): Parts {
  const P = new Parts();
  mountain(P);
  const rail = P.get('rail');
  sweep(rail, 0.62, 0.32, 0.12, 4, 6);
  sweep(rail, -0.62, 0.32, 0.12, 4, 6);
  pendulumTower(P, RIDES[1].x, RIDES[1].z);
  shipTower(P, RIDES[2].x, RIDES[2].z, RIDES[2].yaw);
  return P;
}

// --------------------------------------------------------------------------------- movers

/** One coaster car: a body, the wing seats under it, and the wheels that hug the rail. */
function coasterCar(mats: Record<string, THREE.Material>): THREE.Group {
  const P = new Parts();
  const b = P.get('carBody'), s = P.get('seat'), t = P.get('carTrim');
  box(b, 0, -0.25, 0, 1.9, 0.5, 3.6);
  box(t, 0, 0.05, 0, 2.0, 0.14, 3.2);
  // Flying coaster: the seats hang under the spine, riders face down.
  for (const i of [-1, 1]) {
    box(s, i * 0.62, -0.78, 0.35, 0.7, 0.6, 1.9);
    box(t, i * 0.62, -1.05, -0.4, 0.62, 0.1, 0.9);
  }
  box(s, 0, -0.62, -1.5, 1.5, 0.35, 0.5);
  return P.build(mats);
}

export interface Movers {
  train: THREE.Group;
  /** Each car's offset behind the lead car, in metres of track. */
  carOffsets: number[];
  disc: THREE.Group;
  boat: THREE.Group;
}

/** The three moving assemblies. Each is parented to the park group and posed every frame. */
export function buildMovers(env: EnvUniforms): Movers {
  const mats = parkMaterials(env);
  const train = new THREE.Group();
  train.name = 'park:train';
  const carOffsets: number[] = [];
  for (let i = 0; i < COASTER.train.cars; i++) {
    const car = coasterCar(mats);
    car.name = `car${i}`;
    train.add(car);
    carOffsets.push(-i * COASTER.train.carLen);
  }

  // The frisbee: a disc of seats facing outwards on a swinging arm.
  const D = new Parts();
  const d = D.get('disc'), ds = D.get('seat'), dt = D.get('carTrim');
  cyl(d, 0, -0.35, 0, PENDULUM.discR, PENDULUM.discR * 0.92, 0.7, 24, { bottom: true });
  cyl(dt, 0, 0.35, 0, 1.1, 0.9, 0.6, 12);
  for (let i = 0; i < PENDULUM.seats; i++) {
    const a = (i / PENDULUM.seats) * Math.PI * 2;
    const rx = Math.cos(a) * (PENDULUM.discR + 0.55), rz = Math.sin(a) * (PENDULUM.discR + 0.55);
    D.at(rx, 0.3, rz, -a + Math.PI / 2, () => {
      box(ds, 0, 0, 0, 0.62, 1.05, 0.55);
      box(dt, 0, 0.72, 0.05, 0.5, 0.1, 0.5);
    });
  }
  const disc = new THREE.Group();
  disc.name = 'park:disc';
  // The arm hangs down from the pivot, so the group can sit at the bearing and simply rotate.
  const arm = new Parts();
  const ab = arm.get('tower');
  box(ab, 0, -PENDULUM.armLen / 2, 0, 1.1, PENDULUM.armLen, 0.8);
  const armG = arm.build(mats);
  armG.name = 'arm';
  const discG = D.build(mats);
  discG.name = 'disc';
  discG.position.y = -PENDULUM.armLen;
  disc.add(armG, discG);

  // The ship: a hull with a curled bow and stern.
  const S = new Parts();
  const h = S.get('hull'), ht = S.get('hullTrim'), hs = S.get('seat'), pl = S.get('plank');
  const L = SHIP.hullLen / 2, W = SHIP.hullW / 2;
  for (let i = 0; i < 10; i++) {
    const t0 = -1 + (i / 10) * 2, t1 = -1 + ((i + 1) / 10) * 2;
    const w0 = W * Math.cos(t0 * 1.15), w1 = W * Math.cos(t1 * 1.15);
    const y0 = Math.abs(t0) ** 3 * 3.2, y1 = Math.abs(t1) ** 3 * 3.2;
    const poly: [number, number][] = [[t0 * L, -w0], [t1 * L, -w1], [t1 * L, w1], [t0 * L, w0]];
    prism(h, poly, -1.1 + Math.min(y0, y1) * 0.2, 0.5 + Math.max(y0, y1));
  }
  flat(pl, rectPoly(L * 0.94, W * 0.8), 0.55);
  for (let r = -3; r <= 3; r++) {
    box(hs, r * 2.1, 0.95, 0, 0.5, 0.8, W * 1.5);
    box(ht, r * 2.1, 1.45, 0, 0.42, 0.12, W * 1.5);
  }
  const boat = new THREE.Group();
  boat.name = 'park:boat';
  const sArm = new Parts();
  for (const i of [-1, 1]) box(sArm.get('tower'), 0, -SHIP.armLen / 2, i * W * 0.9, 0.32, SHIP.armLen, 0.32);
  const sArmG = sArm.build(mats); sArmG.name = 'arm';
  const hullG = S.build(mats); hullG.name = 'hull';
  hullG.position.y = -SHIP.armLen;
  boat.add(sArmG, hullG);

  for (const g of [train, disc, boat]) g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { train, carOffsets, disc, boat };
}
