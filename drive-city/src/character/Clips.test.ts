import { afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createIO } from '../../scripts/landmarks/lib.mjs';
import { Gait } from './Animator';
import type { Look } from './Body';
import { retarget, type ClipOpts, type Retargeted } from './Clips';
import { Hero } from './hero/Hero';

const PUB = path.resolve(__dirname, '../../public/models');
const FIGHT = new Set(['LeadJab', 'CrossPunch', 'MmaKick', 'BodyBlock', 'HeadHit']);
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event { constructor(type: string, public init: object = {}) { super(type); } };

/** A published glb parsed in Node: meshopt decoded and textures dropped by glTF-Transform, then three's loader. */
async function parse(file: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const io = await createIO();
  const doc = await io.read(path.join(PUB, file));
  const root = doc.getRoot();
  for (const t of root.listTextures()) t.dispose();
  for (const e of root.listExtensionsUsed()) e.dispose();
  const bin: Uint8Array = await io.writeBinary(doc);
  const g = await new GLTFLoader().parseAsync(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '');
  return { scene: g.scene, animations: g.animations };
}

const C = (h: string) => new THREE.Color(h);
const LOOK: Look = { skin: C('#e2bd98'), shirt: C('#39424e'), pants: C('#1b2536'), shoes: C('#1a1a1a'), hair: C('#141212'), height: 1.7 };
const P = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

async function setup(clip: string): Promise<{ h: Hero; src: { scene: THREE.Group; clip: THREE.AnimationClip }; r: Retargeted }> {
  const m = await parse('characters/laok.glb');
  const h = new (Hero as unknown as { new(s: THREE.Group, l: Look, o: object): Hero })(m.scene, LOOK, {});
  const a = await parse(`anims/${clip}.glb`);
  const src = { scene: a.scene, clip: a.animations[0] };
  return { h, src, r: retarget(src, h.rig(), clip) };
}

describe('animation clips retargeted onto a cast model', () => {
  it('follows the source limb for limb, at its own proportions', async () => {
    // fight clips hold the arms high and bent, where the rest-pose swing leaves a few degrees (2.8 on the jab's
    // upper arm): 4x the walk's 1 degree there
    const worst: Record<string, number> = {};
    afterAll(() => console.log('worst limb error / tolerance', JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(2)])))));
    for (const clip of ['walk', 'run', 'idle', 'talk', 'LeadJab', 'CrossPunch', 'MmaKick', 'BodyBlock', 'HeadHit']) {
      const { h, src, r } = await setup(clip);
      expect(r.clip.tracks.length).toBeGreaterThan(40);
      const sN = new Map<string, THREE.Object3D>(), tN = new Map<string, THREE.Object3D>();
      src.scene.traverse((o) => sN.set(o.name.replace(/^mixamorig\d*[:_]?/, ''), o));
      h.root.traverse((o) => tN.set(o.name, o));
      h.root.updateMatrixWorld(true);
      const headRest = tN.get('Head')!.getWorldQuaternion(new THREE.Quaternion());
      src.scene.updateMatrixWorld(true);
      const sHeadRest = sN.get('Head')!.getWorldQuaternion(new THREE.Quaternion());
      const sm = new THREE.AnimationMixer(src.scene), tm = new THREE.AnimationMixer(h.root);
      sm.clipAction(src.clip).play(); tm.clipAction(r.clip).play();
      const pairs: [string, string, string, string, number][] = [
        ['LeftArm', 'LeftForeArm', 'upperarm_l', 'lowerarm_l', 1], ['RightForeArm', 'RightHand', 'lowerarm_r', 'hand_r', 1],
        ['LeftUpLeg', 'LeftLeg', 'thigh_l', 'calf_l', 1], ['RightLeg', 'RightFoot', 'calf_r', 'foot_r', 1],
        ['Hips', 'Spine2', 'pelvis', 'spine_03', 3],
      ];
      for (const t of [0, r.clip.duration * 0.3, r.clip.duration * 0.5, r.clip.duration * 0.7]) {
        sm.setTime(t); tm.setTime(t); src.scene.updateMatrixWorld(true); h.root.updateMatrixWorld(true);
        for (const [a, b, c, d, tol] of pairs) {
          const ds = P(sN.get(b)!).sub(P(sN.get(a)!)).normalize(), dt = P(tN.get(d)!).sub(P(tN.get(c)!)).normalize();
          const err = ds.angleTo(dt) * 180 / Math.PI;
          worst[clip] = Math.max(worst[clip] ?? 0, err / tol);
          expect(err, `${clip} ${a} at ${t.toFixed(2)}`).toBeLessThan(tol * (FIGHT.has(clip) ? 4 : 1));
        }
        // the face keeps looking ahead as the model's rest does (taking the neck's alignment tipped it to the sky)
        const tTurn = tN.get('Head')!.getWorldQuaternion(new THREE.Quaternion()).angleTo(headRest), sTurn = sN.get('Head')!.getWorldQuaternion(new THREE.Quaternion()).angleTo(sHeadRest);
        expect(Math.abs(tTurn - sTurn) * 180 / Math.PI, `${clip} head turn`).toBeLessThan(3);
      }
    }
  });

  it('measures how fast a clip walks in place, and keeps the soles on the ground', async () => {
    const speed: Record<string, number> = {};
    for (const clip of ['idle', 'walk', 'run']) {
      const { h, r } = await setup(clip);
      speed[clip] = r.speed;
      const tm = new THREE.AnimationMixer(h.root);
      tm.clipAction(r.clip).play();
      let low = Infinity;
      for (let t = 0; t <= r.clip.duration; t += 1 / 30) {
        tm.setTime(t); h.root.updateMatrixWorld(true);
        for (const n of ['foot_l', 'foot_r', 'ball_l', 'ball_r']) low = Math.min(low, P(h.root.getObjectByName(n)!).y);
      }
      // the lowest sole point is where the feet stand at rest (the balls ~1 cm above the sole): not sunk, not floating
      expect(low, `${clip} lowest sole`).toBeGreaterThan(0.004);
      expect(low, `${clip} lowest sole`).toBeLessThan(0.03);
    }
    expect(speed.idle).toBe(0);
    expect(speed.walk).toBeGreaterThan(1.1); expect(speed.walk).toBeLessThan(2);
    expect(speed.run).toBeGreaterThan(2.8); expect(speed.run).toBeLessThan(5);
  });

  it('cuts, speeds up and anchors one-shot clips: a fall from where they stood, getting up to where they will stand', async () => {
    const m = await setup('idle');
    const rig = m.h.rig();
    const pelvisAt = (r: Retargeted, t: number) => {
      const tm = new THREE.AnimationMixer(m.h.root);
      const a = tm.clipAction(r.clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); tm.setTime(t);
      m.h.root.updateMatrixWorld(true);
      const p = P(m.h.root.getObjectByName('pelvis')!);
      a.stop(); tm.uncacheRoot(m.h.root);
      return p;
    };
    m.h.root.updateMatrixWorld(true);
    const rest = P(m.h.root.getObjectByName('pelvis')!);
    const fallSrc = await parse('anims/fall_back_death.glb'), upSrc = await parse('anims/getting_up.glb');
    const fall = retarget({ scene: fallSrc.scene, clip: fallSrc.animations[0] }, rig, 'fall', { range: [0.15, 2], speed: 1.2, loop: false, anchor: 'start' });
    const up = retarget({ scene: upSrc.scene, clip: upSrc.animations[0] }, rig, 'getup', { range: [2.2, 6.1], speed: 1.6, loop: false, anchor: 'end' });
    expect(fall.clip.duration).toBeCloseTo(1.85 / 1.2, 2);
    expect(up.clip.duration).toBeCloseTo(3.9 / 1.6, 2);
    expect(fall.loop).toBe(false);
    const f0 = pelvisAt(fall, 0), f1 = pelvisAt(fall, fall.clip.duration);
    expect(Math.hypot(f0.x - rest.x, f0.z - rest.z), 'a fall starts over the feet').toBeLessThan(0.02);
    expect(Math.hypot(f1.x - rest.x, f1.z - rest.z), 'and lies back from them').toBeGreaterThan(0.5);
    expect(f1.y, 'lying').toBeLessThan(0.3);
    const u0 = pelvisAt(up, 0), u1 = pelvisAt(up, up.clip.duration);
    expect(Math.hypot(u1.x - rest.x, u1.z - rest.z), 'getting up ends over the feet').toBeLessThan(0.02);
    expect(u0.y, 'from lying').toBeLessThan(0.3);
    expect(u1.y, 'to standing').toBeGreaterThan(rest.y - 0.08);
  });

  it('plays through the gait: clips for walking, the gait for what has no clip, no NaN either way', async () => {
    const clips: Record<string, Retargeted> = {};
    let h: Hero | null = null;
    for (const c of ['idle', 'walk', 'run']) { const s = await setup(c); h ??= s.h; clips[c] = retarget(s.src, h.rig(), c); }
    h!.useClips(clips, { move: 'locomotion' });
    const g = new Gait();
    const root = new THREE.Vector3();
    const pelvis = h!.root.getObjectByName('pelvis')!;
    for (const [action, speed] of [['move', 0], ['move', 1.4], ['move', 4], ['punch', 0], ['move', 1.4]] as const) {
      for (let i = 0; i < 40; i++) { g.update({ action, speed, t: i / 60 }, 1 / 60, 7); h!.draw(root, 0, g); }
      h!.root.updateMatrixWorld(true);
      h!.root.traverse((o) => { expect(Number.isFinite(o.quaternion.x + o.position.y), `${action} ${o.name}`).toBe(true); });
      const y = P(pelvis).y;
      expect(y, `${action} at ${speed}: pelvis height`).toBeGreaterThan(0.75);
      expect(y).toBeLessThan(1.05);
    }
  });

  it('fights through the gait: the blows, the guard, a block and a flinch from either clip, no NaN, feet on the ground', async () => {
    const clips: Record<string, Retargeted> = {};
    let h: Hero | null = null;
    const files: Record<string, [string, ClipOpts]> = {
      fightIdle: ['FightIdle', {}], jab: ['LeadJab', { range: [0.3, 0.88], speed: 1.9, loop: false }], kick: ['MmaKick', { range: [0.3, 1.18], speed: 1.45, loop: false, anchor: 'start' }],
      hitHead: ['HeadHit', { range: [0, 0.95], speed: 2.1, loop: false }], hitBody: ['StomachHit', { range: [0, 0.9], speed: 2, loop: false }],
    };
    for (const [name, [file, o]] of Object.entries(files)) { const s = await setup(file); h ??= s.h; clips[name] = retarget(s.src, h.rig(), name, o); }
    h!.useClips(clips, { guard: { clip: 'fightIdle', legs: 'gait' }, jab: { clip: 'jab', legs: 'gait' }, kick: 'kick', flinch: { clip: ['hitHead', 'hitBody'], legs: 'gait' } });
    const g = new Gait();
    const root = new THREE.Vector3(), pelvis = h!.root.getObjectByName('pelvis')!, foot = h!.root.getObjectByName('foot_l')!;
    for (const [action, speed, secs] of [['guard', 0, 0.6], ['jab', 0, 0.3], ['guard', 1.2, 0.6], ['kick', 0, 0.6], ['flinch', 0, 0.45], ['guard', 0, 0.3], ['flinch', 0, 0.45]] as const) {
      const n = Math.round(secs * 60);
      for (let i = 0; i < n; i++) { g.update({ action, speed, t: i / 60 }, 1 / 60, 7); h!.draw(root, 0, g); }
      h!.root.updateMatrixWorld(true);
      h!.root.traverse((o) => { expect(Number.isFinite(o.quaternion.x + o.position.y), `${action} ${o.name}`).toBe(true); });
      expect(P(pelvis).y, `${action}: pelvis height`).toBeGreaterThan(0.7);
      expect(P(pelvis).y).toBeLessThan(1.1);
      expect(P(foot).y, `${action}: the left foot`).toBeLessThan(action === 'kick' ? 0.6 : 0.25);
    }
  });
});
