import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { EnvUniforms } from '../../game/Contracts';
import { FlatMesh } from './Footbridges';
import type { RailFile } from './Railways';

/** A continuous stretch of track a train can run: points [x, z, ...], rail-top heights, arc lengths. */
export interface RailRun { kind: number; p: number[]; h: number[]; s: number[]; len: number }

/** Height of the rail head above the deck or ground surface the track's `h` gives (bed 0.32 + rail 0.16). */
const RAIL_TOP = 0.02 + 0.3 + 0.16;

/**
 * The tracks joined end to end into runs a train can travel (pure; Node-safe): at each end the track
 * carries on along the one that continues it straightest (within 25 degrees, the same kind - main line or
 * subway; yards and sidings left out), and a run is cut wherever a segment crosses a road on the level
 * (a train across 东二环 at 东便门 would be OSM's error, not Beijing). Runs shorter than `min` are dropped,
 * longest first; each track belongs to one run.
 */
export function railRuns(f: RailFile, min = 1200): RailRun[] {
  const tracks = f.r.filter((t) => t.k !== 2 && t.p.length >= 4);
  const key = (x: number, z: number) => `${Math.round(x)}_${Math.round(z)}`;
  const ends = new Map<string, { t: number; at: 0 | 1 }[]>();
  tracks.forEach((t, i) => {
    for (const at of [0, 1] as const) {
      const j = at ? t.p.length - 2 : 0;
      const k = key(t.p[j], t.p[j + 1]);
      (ends.get(k) ?? ends.set(k, []).get(k)!).push({ t: i, at });
    }
  });
  const len = (t: (typeof tracks)[number]) => { let s = 0; for (let i = 2; i < t.p.length; i += 2) s += Math.hypot(t.p[i] - t.p[i - 2], t.p[i + 1] - t.p[i - 1]); return s; };
  const order = tracks.map((t, i) => ({ i, L: len(t) })).sort((a, b) => b.L - a.L);
  const used = new Set<number>();
  /** Track i's points (x, z, h, crossing flag of the segment ending there) in the given direction. */
  const pts = (i: number, rev: boolean) => {
    const t = tracks[i], n = t.p.length / 2, out: [number, number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      const j = rev ? n - 1 - k : k;
      const seg = rev ? j : j - 1;   // the segment that ends at this point, in travel order
      out.push([t.p[2 * j], t.p[2 * j + 1], (t.h?.[j] ?? 0) + RAIL_TOP, k > 0 && t.e ? (t.e[Math.max(0, seg)] ?? 0) : 0]);
    }
    return out;
  };
  const dirAt = (P: [number, number, number, number][], end: boolean) => {
    const a = end ? P[P.length - 2] : P[1], b = end ? P[P.length - 1] : P[0];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const runs: RailRun[] = [];
  for (const { i } of order) {
    if (used.has(i)) continue;
    used.add(i);
    const kind = tracks[i].k;
    let chain = pts(i, false);
    // extend forward from the chain's end, then backward from its start
    for (const back of [false, true]) {
      for (let guard = 0; guard < 200; guard++) {
        const P = back ? [...chain].reverse() : chain;
        const [dx, dz] = dirAt(P, true), last = P[P.length - 1];
        let best: { t: number; rev: boolean; c: number } | null = null;
        for (const c of ends.get(key(last[0], last[1])) ?? []) {
          if (used.has(c.t) || tracks[c.t].k !== kind) continue;
          const Q = pts(c.t, c.at === 1);   // leaving from the end we are at
          const l = Math.hypot(Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]) || 1;
          const cos = ((Q[1][0] - Q[0][0]) * dx + (Q[1][1] - Q[0][1]) * dz) / l;
          if (cos > Math.cos(25 * Math.PI / 180) && (!best || cos > best.c)) best = { t: c.t, rev: c.at === 1, c: cos };
        }
        if (!best) break;
        used.add(best.t);
        const Q = pts(best.t, best.rev).slice(1);
        chain = back ? [...Q.map((q) => q).reverse(), ...chain] : [...chain, ...Q];
      }
    }
    // cut at level crossings (flag 4 on the segment ending at a point), keep the pieces of `min` or more
    let piece: [number, number, number, number][] = [chain[0]];
    const flush = () => {
      if (piece.length < 2) return;
      const s = [0];
      for (let k = 1; k < piece.length; k++) s.push(s[k - 1] + Math.hypot(piece[k][0] - piece[k - 1][0], piece[k][1] - piece[k - 1][1]));
      if (s[s.length - 1] >= min) runs.push({ kind, p: piece.flatMap((q) => [q[0], q[1]]), h: piece.map((q) => q[2]), s, len: s[s.length - 1] });
    };
    for (let k = 1; k < chain.length; k++) {
      if (chain[k][3] & 4) { flush(); piece = [chain[k]]; continue; }
      piece.push(chain[k]);
    }
    flush();
  }
  return runs.sort((a, b) => b.len - a.len);
}

/** Car lengths and the gap, per kind (0 main line: an EMU; 1 subway). */
const CAR = { 0: { len: 25, w: 3.3, h: 4.0, cars: 8, speed: 24 }, 1: { len: 19, w: 2.9, h: 3.7, cars: 6, speed: 18 } } as const;
const GAP = 0.9;

function carGeometry(kind: 0 | 1, nose: boolean): THREE.BufferGeometry {
  const m = new FlatMesh(), c = CAR[kind], L = c.len, hw = c.w / 2;
  const body = kind === 0 ? '#eef1f3' : '#d9dee2', stripe = kind === 0 ? '#2c5aa8' : '#c8323a', glass = '#20262c', under = '#2e3134', roof = '#b9bec2';
  // along local z (forward +z), base at the rail head
  const y0 = 0.85, y1 = c.h;
  const z0 = -L / 2, z1 = L / 2 - (nose ? 4 : 0);
  m.bar(0, z0, 0, z1, -hw, hw, y0, y1 - 0.25, y0, y1 - 0.25, body);
  m.bar(0, z0, 0, z1, -hw + 0.15, hw - 0.15, y1 - 0.25, y1, y1 - 0.25, y1, roof);
  // window band and stripe, proud of the body sides
  for (const s of [-1, 1]) {
    const o0 = s > 0 ? hw : -hw - 0.02, o1 = s > 0 ? hw + 0.02 : -hw;
    m.bar(0, z0 + 0.6, 0, z1 - 0.6, o0, o1, y0 + 1.45, y0 + 2.35, y0 + 1.45, y0 + 2.35, glass);
    m.bar(0, z0, 0, z1, o0, o1, y0 + 1.05, y0 + 1.3, y0 + 1.05, y0 + 1.3, stripe);
  }
  // underframe and bogies
  m.bar(0, z0 + 0.5, 0, z1 - 0.5, -hw + 0.3, hw - 0.3, 0.2, y0, 0.2, y0, under);
  for (const b of [z0 + 3.2, z1 - 3.2]) m.bar(0, b - 1.4, 0, b + 1.4, -hw + 0.15, hw - 0.15, 0, 0.75, 0, 0.75, '#1d1f21');
  if (nose) {
    // a sloped nose to the front: the body tapering down and in over 4 m, the windscreen on it
    const zn = L / 2;
    m.bar(0, z1, 0, zn, -hw, hw, y0, y1 - 0.25, y0, y0 + (kind === 0 ? 1.1 : 2.6), body);
    m.bar(0, z1, 0, zn - (kind === 0 ? 1.5 : 0.2), -hw + 0.3, hw - 0.3, y1 - 0.6, y1 - 0.25, y0 + 2.2, y0 + 2.5, glass);
    m.bar(0, z1, 0, zn, -hw - 0.01, hw + 0.01, y0 + 1.05, y0 + 1.3, y0 + 0.6, y0 + 0.8, stripe);
  }
  if (kind === 0 && !nose) m.bar(0, -1, 0, 1, -0.6, 0.6, y1, y1 + 0.5, y1, y1 + 0.5, '#555a5e');   // a pantograph's base
  return m.geometry();
}

interface Train { run: RailRun; kind: 0 | 1; phase: number; speed: number; length: number }

export interface TrainApi extends System {
  readonly runs: number;
  readonly trains: number;
  /** Trains drawn this frame (for probes). */
  readonly drawn: () => number;
  /** Every train's middle now and its heading: [x, y, z, yaw, kind] (for probes and shots). */
  readonly where: () => number[][];
  /** The nearest train to (x, z): how far its nearest end is (m), its speed (m/s) and its kind; d Infinity if none. */
  readonly nearest: (x: number, z: number) => { d: number; speed: number; kind: number };
}

/**
 * Trains on the railways (2026-10-03, 「让城市动起来」): EMUs on the main lines, six-car subway trains on
 * the subway's tracks above ground, each running a run of `railRuns` back and forth (the consist has a
 * nose at both ends, so the turn at an end reads as a train going back). Their position is a function of
 * time, so nothing is simulated far away: only the trains within DRAW of the camera are drawn (two
 * instanced meshes a kind: cars and noses), and those within BODIES of the player's car get a kinematic
 * box per car that the car hits. Lit windows at night.
 */
export function placeTrains(engine: Engine, data: RailFile, env: EnvUniforms): TrainApi {
  const runs = railRuns(data, 1200);
  const DRAW = 2000, BODIES = 350;
  // one train per 2.5 km of run (at least one), phases spread so they do not travel together
  const trains: Train[] = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const run of runs) {
    const kind = (run.kind === 1 ? 1 : 0) as 0 | 1, c = CAR[kind], length = c.cars * (c.len + GAP);
    if (run.len < length + 100) continue;
    const n = Math.max(1, Math.round(run.len / 2500));
    for (let i = 0; i < n; i++) trains.push({ run, kind, phase: (i / n + rnd() * 0.3) * 2 * (run.len - length), speed: c.speed * (0.85 + rnd() * 0.3), length });
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 });
  mat.userData.wet = 'surface';
  const night = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTrainNight = night;
    // dark glass (luminance under 0.03) lit warm at night
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTrainNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (dot(vColor.rgb, vec3(0.333)) < 0.03) totalEmissiveRadiance += vec3(1.0, 0.86, 0.62) * 0.9 * uTrainNight;');
  };
  mat.customProgramCacheKey = () => 'trains';
  const CAP = 160;
  const meshes = { 0: { car: carGeometry(0, false), nose: carGeometry(0, true) }, 1: { car: carGeometry(1, false), nose: carGeometry(1, true) } };
  const im: Record<0 | 1, { car: THREE.InstancedMesh; nose: THREE.InstancedMesh }> = { 0: null!, 1: null! };
  for (const kind of [0, 1] as const) {
    const mk = (g: THREE.BufferGeometry, name: string) => { const x = new THREE.InstancedMesh(g, mat, CAP); x.name = name; x.count = 0; x.frustumCulled = false; x.castShadow = true; x.receiveShadow = true; engine.scene.add(x); return x; };
    im[kind] = { car: mk(meshes[kind].car, `train-cars-${kind}`), nose: mk(meshes[kind].nose, `train-noses-${kind}`) };
  }

  // position along a run: x, y, z and the direction (dx, dz) and grade at arc length s
  const at = (r: RailRun, s: number, out: number[]) => {
    s = Math.max(0, Math.min(r.len, s));
    let lo = 0, hi = r.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= s) lo = m; else hi = m; }
    const t = (s - r.s[lo]) / ((r.s[hi] - r.s[lo]) || 1);
    out[0] = r.p[2 * lo] + (r.p[2 * hi] - r.p[2 * lo]) * t;
    out[2] = r.p[2 * lo + 1] + (r.p[2 * hi + 1] - r.p[2 * lo + 1]) * t;
    out[1] = r.h[lo] + (r.h[hi] - r.h[lo]) * t;
    return out;
  };
  const A = [0, 0, 0], B = [0, 0, 0];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  /** The head's arc length at time t, and which way it runs (+1 up the run, -1 down it: the cars then lie above the head). */
  const headAt = (tr: Train, t: number) => {
    const span = tr.run.len - tr.length, x = (tr.phase + t * tr.speed) % (2 * span);
    return x < span ? { s: tr.length + x, dir: 1 } : { s: tr.run.len - (x - span) - tr.length, dir: -1 };
  };
  /** Each car's centre pose: [x, y, z, yaw, pitch]. */
  const poses = (tr: Train, t: number, out: number[][]) => {
    const { s, dir } = headAt(tr, t), c = CAR[tr.kind];
    out.length = 0;
    for (let i = 0; i < c.cars; i++) {
      // up the run the cars trail behind the head at s; down it they trail above it
      const centre = s - dir * (i + 0.5) * (c.len + GAP);
      at(tr.run, centre - c.len / 2 * dir, A); at(tr.run, centre + c.len / 2 * dir, B);
      const dx = B[0] - A[0], dz = B[2] - A[2], dy = B[1] - A[1], L = Math.hypot(dx, dz) || 1;
      out.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, Math.atan2(dx, dz), -Math.atan2(dy, L)]);
    }
    return out;
  };

  // kinematic bodies for the trains near the player: a box per car, reused
  const { R, world } = engine.physics;
  const bodies: { b: RigidBody; used: boolean }[] = [];
  const getBody = (i: number) => {
    while (bodies.length <= i) {
      const b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0));
      const col = world.createCollider(R.ColliderDesc.cuboid(1.55, 1.7, 10).setTranslation(0, 1.95, 0).setCollisionGroups(groups(CG.WORLD, CG.ALL)), b);
      engine.physics.tag(col, { surface: 'metal', tag: 'train' });
      bodies.push({ b, used: false });
    }
    return bodies[i].b;
  };
  let clock = 0, drawn = 0;
  const pose: number[][] = [];
  const sys: TrainApi = {
    name: 'trains',
    runs: runs.length,
    trains: trains.length,
    drawn: () => drawn,
    where: () => trains.map((tr) => { const ps = poses(tr, clock, []); const m = ps[ps.length >> 1]; return [m[0], m[1], m[2], m[3], tr.kind]; }),
    nearest: (x, z) => {
      let best = { d: Infinity, speed: 0, kind: 0 };
      for (const tr of trains) {
        const { s, dir } = headAt(tr, clock);
        at(tr.run, s - dir * tr.length / 2, A);
        const d = Math.max(0, Math.hypot(A[0] - x, A[2] - z) - tr.length / 2);
        if (d < best.d) best = { d, speed: tr.speed, kind: tr.kind };
      }
      return best;
    },
    fixedUpdate(dt) {
      clock += dt;
      const car = (engine.get('vehicle') as unknown as { car?: { pos: THREE.Vector3 } } | undefined)?.car;
      const px = car?.pos.x ?? engine.camera.position.x, pz = car?.pos.z ?? engine.camera.position.z;
      let k = 0;
      for (const tr of trains) {
        const { s, dir } = headAt(tr, clock);
        at(tr.run, s - dir * tr.length / 2, A);
        if (Math.abs(A[0] - px) > BODIES + tr.length || Math.abs(A[2] - pz) > BODIES + tr.length) continue;
        for (const [x, y, z, yaw, pitch] of poses(tr, clock, pose)) {
          const b = getBody(k++);
          e.set(pitch, yaw, 0); q.setFromEuler(e);
          b.setNextKinematicTranslation({ x, y, z });
          b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        }
      }
      for (let i = k; i < bodies.length; i++) bodies[i].b.setNextKinematicTranslation({ x: 0, y: -500 - i * 10, z: 0 });
    },
    update() {
      night.value = env.uNight.value;
      const cx = engine.camera.position.x, cz = engine.camera.position.z;
      const n = { 0: { car: 0, nose: 0 }, 1: { car: 0, nose: 0 } };
      drawn = 0;
      for (const tr of trains) {
        const { s, dir } = headAt(tr, clock);
        at(tr.run, s - dir * tr.length / 2, A);
        if (Math.abs(A[0] - cx) > DRAW || Math.abs(A[2] - cz) > DRAW) continue;
        drawn++;
        const ps = poses(tr, clock, pose), c = CAR[tr.kind];
        ps.forEach(([x, y, z, yaw, pitch], i) => {
          // the first and last cars are the noses, turned to face out
          const end = i === 0 ? 0 : i === c.cars - 1 ? 1 : -1;
          // the head faces the way it runs, the tail the other way (its nose out, its pitch reversed)
          if (end === 1) e.set(-pitch, yaw + Math.PI, 0); else e.set(pitch, yaw, 0);
          q.setFromEuler(e);
          m4.compose(p.set(x, y, z), q, one);
          const slot = end >= 0 ? 'nose' : 'car', mesh = im[tr.kind][slot];
          if (n[tr.kind][slot] < CAP) { mesh.setMatrixAt(n[tr.kind][slot]++, m4); }
        });
      }
      for (const kind of [0, 1] as const) for (const slot of ['car', 'nose'] as const) {
        const mesh = im[kind][slot];
        mesh.count = n[kind][slot]; mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
  engine.add(sys);
  return sys;
}
