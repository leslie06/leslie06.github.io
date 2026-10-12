import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { retry } from '../core/Retry';

/**
 * Animation clips for the realistic cast (docs/characters.md). A clip file is a skeleton and one animation
 * (Mixamo's, converted by scripts/blender/characters/anims.py and scripts/characters/pack-anims.mjs into
 * public/models/anims/); `retarget` bakes it once onto a character's own skeleton, so one set of clips serves every
 * model whatever its proportions, rest pose (Mixamo's T against MakeHuman's A) or bone axes, and the result plays
 * on the character with a plain THREE.AnimationMixer.
 *
 * How: each mapped bone takes the source bone's world-space rotation *change from rest*, applied to the target
 * bone's rest - after the source's rest has been swung onto the target's (each bone's direction, towards its next
 * mapped bone, turned onto the target's), so a T-pose arm raised 90 degrees ends where an A-pose arm raised 90
 * degrees should. The hips' travel is scaled by the ratio of the two hip heights. Unmapped target bones keep their
 * rest relative to their parent.
 */

/** A target skeleton: bones parent-first, their rest locals and the armature's frame (model space). */
export interface Rig {
  names: string[];
  parent: number[];
  restQ: THREE.Quaternion[];
  restP: THREE.Vector3[];
  baseQ: THREE.Quaternion;
  baseP: THREE.Vector3;
}

/**
 * How a clip file is used (public/models/characters/cast.json): `range` seconds of it, played `speed` times as fast,
 * `loop` (default true) or once, holding its last frame; `anchor` the hips' travel over the ground to where they are
 * at the clip's 'start' (a fall: from where the person stood) or 'end' (getting up: to where they will stand).
 */
export interface ClipOpts { range?: [number, number]; speed?: number; loop?: boolean; anchor?: 'start' | 'end' }

export interface Retargeted {
  clip: THREE.AnimationClip;
  /** Ground speed the clip walks at in place (the planted foot's speed), model units a second; 0 if it does not. */
  speed: number;
  loop: boolean;
}

interface Source { scene: THREE.Object3D; clip: THREE.AnimationClip }

/** Source bone (Mixamo name, prefix stripped) -> target bone (the UE names MPFB's game_engine rig uses). */
const MIXAMO: Record<string, string> = {
  Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head',
  LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
};
for (const [s, t] of [['Left', 'l'], ['Right', 'r']]) {
  for (const [f, u] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky']]) {
    for (let k = 1; k <= 3; k++) MIXAMO[`${s}Hand${f}${k}`] = `${u}_0${k}_${t}`;
  }
}
/**
 * Each source bone's direction: towards this bone (absent: it keeps its parent's alignment). The head is neither:
 * its rest faces ahead in both rigs, and taking the neck's alignment (MakeHuman's neck leans forward 30 degrees more
 * than Mixamo's) tipped every face up to the sky.
 */
const OWN_REST = new Set(['Head']);
const NEXT: Record<string, string> = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
};
for (const s of ['Left', 'Right']) {
  Object.assign(NEXT, {
    [`${s}Shoulder`]: `${s}Arm`, [`${s}Arm`]: `${s}ForeArm`, [`${s}ForeArm`]: `${s}Hand`, [`${s}Hand`]: `${s}HandMiddle1`,
    [`${s}UpLeg`]: `${s}Leg`, [`${s}Leg`]: `${s}Foot`, [`${s}Foot`]: `${s}ToeBase`,
  });
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) Object.assign(NEXT, { [`${s}Hand${f}1`]: `${s}Hand${f}2`, [`${s}Hand${f}2`]: `${s}Hand${f}3` });
}
const FPS = 30;
const strip = (n: string) => n.replace(/^mixamorig\d*[:_]?/, '');

const sources = new Map<string, Promise<Source>>();
/** A clip file (cached by URL; a failure is forgotten so it can be asked for again). */
export function loadClip(url: string): Promise<Source> {
  let p = sources.get(url);
  if (!p) {
    p = retry(`clip ${url}`, () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)).then((g) => {
      if (!g.animations[0]) throw new Error(`${url}: no animation`);
      return { scene: g.scene, clip: g.animations[0] };
    });
    p.catch(() => sources.delete(url));
    sources.set(url, p);
  }
  return p;
}

const _m = new THREE.Matrix4(), _s = new THREE.Vector3();

/** Bake `src` onto `rig`. */
export function retarget(src: Source, rig: Rig, name: string, opts: ClipOpts = {}): Retargeted {
  // source bones by (stripped) name
  const sb = new Map<string, THREE.Object3D>();
  src.scene.traverse((o) => { const n = strip(o.name); if (n in MIXAMO && !sb.has(n)) sb.set(n, o); });
  const lower = rig.names.map((n) => n.toLowerCase());
  const ti = (n: string) => lower.indexOf(n.toLowerCase());
  const pairs = Object.keys(MIXAMO).filter((s) => sb.has(s) && ti(MIXAMO[s]) >= 0);
  const tOf = new Map(pairs.map((s) => [ti(MIXAMO[s]), s]));

  // the source's world pose at time t (rest when t < 0)
  const mixer = new THREE.AnimationMixer(src.scene);
  const action = mixer.clipAction(src.clip);
  const restLocal = new Map<THREE.Object3D, [THREE.Vector3, THREE.Quaternion]>();
  src.scene.traverse((o) => restLocal.set(o, [o.position.clone(), o.quaternion.clone()]));
  const sample = (t: number) => {
    if (t < 0) { action.stop(); for (const [o, [p, q]] of restLocal) { o.position.copy(p); o.quaternion.copy(q); } }
    else { action.play(); mixer.setTime(t); }
    src.scene.updateMatrixWorld(true);
    const out = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
    for (const [n, o] of sb) { const q = new THREE.Quaternion(), p = new THREE.Vector3(); o.matrixWorld.decompose(p, q, _s); out.set(n, { q, p }); }
    return out;
  };

  // the target's rest in model space
  const N = rig.names.length;
  const T0q: THREE.Quaternion[] = [], T0p: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const pq = rig.parent[i] >= 0 ? T0q[rig.parent[i]] : rig.baseQ, pp = rig.parent[i] >= 0 ? T0p[rig.parent[i]] : rig.baseP;
    T0q.push(pq.clone().multiply(rig.restQ[i]));
    T0p.push(rig.restP[i].clone().applyQuaternion(pq).add(pp));
  }
  const S0 = sample(-1);
  // facing: turn the source about the vertical so its hips' left-to-right lies along the target's
  const sl = S0.get('RightUpLeg')!.p.clone().sub(S0.get('LeftUpLeg')!.p), tl = T0p[ti('thigh_r')].clone().sub(T0p[ti('thigh_l')]);
  const G = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sl.z, sl.x) - Math.atan2(tl.z, tl.x));
  const g = (x: { q: THREE.Quaternion; p: THREE.Vector3 }) => ({ q: G.clone().multiply(x.q), p: x.p.clone().applyQuaternion(G) });
  const S0g = new Map([...S0].map(([k, v]) => [k, g(v)]));

  // per mapped bone: K = S0^-1 A^-1 T0 (world: T = S K)
  const K = new Map<number, THREE.Quaternion>();
  const A = new Map<string, THREE.Quaternion>();
  const alignOf = (s: string): THREE.Quaternion => {
    const have = A.get(s);
    if (have) return have;
    let a = new THREE.Quaternion();
    const nx = NEXT[s];
    if (OWN_REST.has(s)) { /* identity */ } else if (nx && S0g.has(nx) && ti(MIXAMO[nx]) >= 0) {
      const from = S0g.get(nx)!.p.clone().sub(S0g.get(s)!.p).normalize();
      const to = T0p[ti(MIXAMO[nx])].clone().sub(T0p[ti(MIXAMO[s])]).normalize();
      a.setFromUnitVectors(from, to);
    } else {
      // no direction of its own: its source parent's
      const par = sb.get(s)!.parent;
      const ps = par ? strip(par.name) : '';
      if (ps in MIXAMO && sb.has(ps)) a = alignOf(ps).clone();
    }
    A.set(s, a);
    return a;
  };
  for (const [i, s] of tOf) K.set(i, S0g.get(s)!.q.clone().invert().multiply(alignOf(s).clone().invert()).multiply(T0q[i]));

  const hipS0 = S0g.get('Hips')!.p, pelvis = ti('pelvis');
  const k = T0p[pelvis].y / Math.max(1e-6, hipS0.y);
  const t0 = Math.max(0, Math.min(opts.range?.[0] ?? 0, src.clip.duration)), t1 = Math.max(t0, Math.min(opts.range?.[1] ?? src.clip.duration, src.clip.duration));
  const speedK = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const frames = Math.max(2, Math.round((t1 - t0) * FPS) + 1);
  const hipXZ: [number, number][] = [];
  const times = new Float32Array(frames);
  const qv = new Map<number, Float32Array>(), pv = new Float32Array(frames * 3);
  for (const i of tOf.keys()) qv.set(i, new Float32Array(frames * 4));
  const Wq = Array.from({ length: N }, () => new THREE.Quaternion()), Wp = Array.from({ length: N }, () => new THREE.Vector3());
  const feet = [ti('foot_l'), ti('foot_r')], footTrack = feet.map(() => [] as THREE.Vector3[]);
  const lq = new THREE.Quaternion(), inv = new THREE.Quaternion(), pelInv = new THREE.Quaternion();
  // the soles: the lowest of the feet and balls over the clip is put where it is standing at rest (Mixamo's hips sit
  // elsewhere in the pelvis than MakeHuman's, so scaling by hip height alone sank the feet 3 cm into the ground)
  const soles = ['foot_l', 'foot_r', 'ball_l', 'ball_r'].map(ti).filter((i) => i >= 0);
  const restMin = Math.min(...soles.map((i) => T0p[i].y));
  let clipMin = Infinity;
  for (let f = 0; f < frames; f++) {
    const t = Math.min(t1, t0 + f / FPS);
    times[f] = (t - t0) / speedK;
    const S = sample(t);
    for (let i = 0; i < N; i++) {
      const pi = rig.parent[i], pq = pi >= 0 ? Wq[pi] : rig.baseQ, pp = pi >= 0 ? Wp[pi] : rig.baseP;
      const s = tOf.get(i);
      if (s !== undefined) {
        const sg = g(S.get(s)!);
        Wq[i].copy(sg.q).multiply(K.get(i)!);
        lq.copy(inv.copy(pq).invert()).multiply(Wq[i]);
        qv.get(i)!.set([lq.x, lq.y, lq.z, lq.w], f * 4);
        if (i === pelvis) {
          Wp[i].copy(sg.p).sub(hipS0).multiplyScalar(k).add(T0p[i]);
          const lp = Wp[i].clone().sub(pp).applyQuaternion(inv);
          pelInv.copy(inv);
          hipXZ.push([Wp[i].x - T0p[i].x, Wp[i].z - T0p[i].z]);
          pv.set([lp.x, lp.y, lp.z], f * 3);
          continue;
        }
      } else Wq[i].copy(pq).multiply(rig.restQ[i]);
      Wp[i].copy(rig.restP[i]).applyQuaternion(pq).add(pp);
    }
    feet.forEach((fi, j) => { if (fi >= 0) footTrack[j].push(Wp[fi].clone()); });
    for (const i of soles) clipMin = Math.min(clipMin, Wp[i].y);
  }
  if (soles.length && Number.isFinite(clipMin)) {
    const at = opts.anchor === 'start' ? hipXZ[0] : opts.anchor === 'end' ? hipXZ[hipXZ.length - 1] : [0, 0];
    const off = new THREE.Vector3(-(at?.[0] ?? 0), restMin - clipMin, -(at?.[1] ?? 0)).applyQuaternion(pelInv);
    for (let f = 0; f < frames; f++) { pv[f * 3] += off.x; pv[f * 3 + 1] += off.y; pv[f * 3 + 2] += off.z; }
  }
  action.stop();
  mixer.uncacheRoot(src.scene);

  const tracks: THREE.KeyframeTrack[] = [];
  for (const [i, v] of qv) tracks.push(new THREE.QuaternionKeyframeTrack(`${rig.names[i]}.quaternion`, times, v));
  tracks.push(new THREE.VectorKeyframeTrack(`${rig.names[pelvis]}.position`, times, pv));
  const clip = new THREE.AnimationClip(name, (t1 - t0) / speedK, tracks);

  // in-place speed: how fast a planted foot slides back (the lowest 15% of each foot's heights count as planted)
  const speeds: number[] = [];
  for (const tr of footTrack) {
    if (tr.length < 3) continue;
    const ys = tr.map((p) => p.y).sort((a, b) => a - b);
    const low = ys[Math.floor(ys.length * 0.15)] + 0.01;
    for (let f = 1; f < tr.length; f++) if (tr[f].y <= low && tr[f - 1].y <= low) speeds.push(Math.hypot(tr[f].x - tr[f - 1].x, tr[f].z - tr[f - 1].z) * FPS * speedK);
  }
  speeds.sort((a, b) => a - b);
  const speed = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;
  return { clip, speed: speed > 0.3 ? speed : 0, loop: opts.loop ?? true };
}
