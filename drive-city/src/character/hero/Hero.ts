import * as THREE from 'three';
import { retry } from '../../core/Retry';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ANKLE_H, BALL, BASE_HEIGHT, J, JOINT_COUNT, type Look } from '../Body';
import { bindWorld, poseWorld, type Gait } from '../Animator';
import { dress } from './Outfit';
import type { Retargeted, Rig } from '../Clips';

/**
 * The player drawn as an authored character instead of the crowd's procedural body.
 *
 * The model is Quaternius' Universal Base Characters male (CC0, `public/models/hero/`, copied by
 * `scripts/hero/extract.mjs`): 14k triangles, a UE-style humanoid skeleton of 65 bones, in a
 * T-pose, 1.81 m. It is dressed at load by `Outfit.ts` in the player's look.
 *
 * It is animated by the same `Gait` that drives the crowd, so every walk, run, punch, fall,
 * idle habit and ride pose carries over: each frame the crowd skeleton is posed in character space
 * and every mapped bone takes its joint's world-space rotation *change from bind*, applied to the
 * bone's own bind orientation (after an alignment that turns the model's T-pose limbs onto the
 * crowd's A-pose). Unmapped bones (the extra spine segment, clavicles, toes, fingers) keep their
 * rest pose relative to their parent. The legs are then solved by two-bone IK onto the crowd's
 * ankle targets, knees towards the crowd's knees, so the feet stay planted where the gait plants
 * them although the two legs differ in length.
 */

/** Crown of the Quaternius model (feet at 0); an authored character's own is measured. */
const QUATERNIUS_HEIGHT = 1.81;

/**
 * A finished character (scripts/blender/characters/mpfb_char.py: MPFB's `game_engine` rig, dressed, haired):
 * drawn as it is - no Outfit, no skin tint, no bone scales - with its hair tinted if asked.
 */
/** `lite` (the low tier): no soft hair fringe pass, the hair casts no shadow. */
export interface AuthoredOpts { hairColor?: THREE.Color; lite?: boolean }

/** Model bone -> crowd joint whose rotation it follows. */
const MAP: Record<string, number> = {
  pelvis: J.pelvis, spine_01: J.spine, spine_03: J.chest, neck_01: J.neck, Head: J.head,
  upperarm_l: J.shoulderL, lowerarm_l: J.elbowL, hand_l: J.wristL,
  upperarm_r: J.shoulderR, lowerarm_r: J.elbowR, hand_r: J.wristR,
  thigh_l: J.hipL, calf_l: J.kneeL, foot_l: J.ankleL,
  thigh_r: J.hipR, calf_r: J.kneeR, foot_r: J.ankleR,
};
/** Limb bones aligned bind-to-bind: [child bone in the model, crowd joint from, crowd joint to]. */
const ALIGN: Record<string, [string, number, number]> = {
  upperarm_l: ['lowerarm_l', J.shoulderL, J.elbowL], lowerarm_l: ['hand_l', J.elbowL, J.wristL], hand_l: ['middle_01_l', J.elbowL, J.wristL],
  upperarm_r: ['lowerarm_r', J.shoulderR, J.elbowR], lowerarm_r: ['hand_r', J.elbowR, J.wristR], hand_r: ['middle_01_r', J.elbowR, J.wristR],
  thigh_l: ['calf_l', J.hipL, J.kneeL], calf_l: ['foot_l', J.kneeL, J.ankleL],
  thigh_r: ['calf_r', J.hipR, J.kneeR], calf_r: ['foot_r', J.kneeR, J.ankleR],
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
/**
 * Bone scales that take the base model from superhero towards ordinary proportions: narrower
 * shoulders with slimmer arms and smaller hands (everything under the clavicle), a larger head.
 */
const BONE_SCALE: Record<string, number> = { clavicle_l: 0.88, clavicle_r: 0.88, Head: 1.06 };
/** Finger curl per joint (rad): relaxed, and round a phone. */
const CURL = { relaxed: [0.3, 0.45, 0.3], grip: [0.75, 1.0, 0.6] };

interface Bone {
  obj: THREE.Bone;
  parent: number;
  joint: number;
  /** Rest local position and rotation (fingers: relaxed curl; `grip` is the phone hand's); `rq` the model's own rest. */
  lp: THREE.Vector3; lq: THREE.Quaternion; grip: THREE.Quaternion | null; rq: THREE.Quaternion;
  /** Bind position in model space. */
  pb: THREE.Vector3;
  /** Bind orientation in model space and its alignment onto the crowd's bind. */
  qb: THREE.Quaternion; align: THREE.Quaternion;
  /** Unit bone axis in local space (towards its IK child) and its length. */
  axis: THREE.Vector3; len: number;
  /** Accumulated scale of the parent (BONE_SCALE), which scales this bone's offset. */
  ps: number;
}

/**
 * What a gait action plays when the model has clips: a clip's name, or 'locomotion' (idle / walk / run by speed);
 * `legs: 'gait'` keeps the gait's pelvis and legs under the clip's upper body (a shove while walking on).
 */
export type ClipAction = string | { clip: string; legs?: 'gait' };
export type ClipActions = Partial<Record<string, ClipAction>>;
/** Seated actions: the pelvis and legs stay the gait's (its seat height and feet), the clip moves the rest. */
const SEATED = new Set(['sit', 'drink', 'chess', 'erhu']);
const LEGS = /^(pelvis|thigh_|calf_|foot_|ball_)/;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * An MPFB material (a base colour map, sometimes a normal map, roughness 0.5-0.9) as a physical one tuned by what
 * it is: skin with a warm sheen at grazing angles (the light through the edges of ears and cheeks that plain
 * diffuse skin lacks), hair with a soft sheen band and alpha-tested cards, wet eyes under a clear coat, cloth with a
 * fabric sheen, shoes a little glossy.
 */
function physical(src: THREE.MeshStandardMaterial, name: string, o: AuthoredOpts): THREE.MeshPhysicalMaterial {
  const card = /short|bob|long|ponytail|braid|afro|eyebrow|eyelash/i.test(name);
  const kind = /eyelash|eyebrow/i.test(name) ? 'brow' : card ? 'hair' : /body|skin/i.test(name) ? 'skin'
    : /low-poly|high-poly|eye/i.test(name) ? 'eye' : /shoe|boot/i.test(name) ? 'shoes' : 'cloth';
  const p = new THREE.MeshPhysicalMaterial({ name: src.name, map: src.map, normalMap: src.normalMap, color: src.color.clone() });
  if (src.normalMap) p.normalScale.copy(src.normalScale);
  p.userData.wet = true;
  // hair cards cut at half (their soft fringe is a second, blended pass: `fringe`); brows and lashes lie on the skin,
  // blended (cut, they were thin jagged strokes)
  if (kind === 'hair') { p.alphaTest = 0.5; p.side = THREE.DoubleSide; }
  if (kind === 'brow') { p.transparent = true; p.depthWrite = false; p.side = THREE.DoubleSide; }
  if (kind === 'skin') {
    p.roughness = 0.55; p.specularIntensity = 0.45;
    p.sheen = 0.3; p.sheenRoughness = 0.5; p.sheenColor.set('#ffb08f');
  } else if (kind === 'hair') {
    if (o.hairColor) p.color.copy(o.hairColor);
    p.roughness = 0.5; p.specularIntensity = 0.7;
    p.sheen = 0.35; p.sheenRoughness = 0.4; p.sheenColor.copy(p.color).lerp(new THREE.Color('#a49686'), 0.3);
  } else if (kind === 'brow') {
    p.roughness = 0.8;
  } else if (kind === 'eye') {
    p.roughness = 0.25; p.clearcoat = 1; p.clearcoatRoughness = 0.04;
  } else if (kind === 'shoes') {
    p.roughness = 0.42; p.clearcoat = 0.25; p.clearcoatRoughness = 0.3;
  } else {
    p.roughness = 0.9; p.specularIntensity = 0.35;
    p.sheen = 0.5; p.sheenRoughness = 0.8; p.sheenColor.set('#6b6b6b');
  }
  src.dispose();
  return p;
}

/**
 * The hair's soft edge: the same cards again, blended, after the cut pass and without writing depth. Where the cut
 * pass drew, its depth hides this one (same surface, depth test 'less'); where it left a strand's thin end out, this
 * draws it see-through, so the hairline and the tips fade instead of ending in a hard serrated line.
 */
function fringe(m: THREE.SkinnedMesh): THREE.SkinnedMesh {
  const mat = (m.material as THREE.MeshPhysicalMaterial).clone();
  mat.alphaTest = 0.02; mat.transparent = true; mat.depthWrite = false; mat.depthFunc = THREE.LessDepth;
  const f = new THREE.SkinnedMesh(m.geometry, mat);
  f.name = `${m.name} fringe`;
  f.bind(m.skeleton, m.bindMatrix);
  f.position.copy(m.position); f.quaternion.copy(m.quaternion); f.scale.copy(m.scale);
  f.frustumCulled = false; f.castShadow = false; f.receiveShadow = true;
  return f;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Hero {
  /** Add this to the scene; it is posed and placed by `draw`. */
  readonly root: THREE.Object3D;
  private readonly bones: Bone[] = [];
  private readonly byName = new Map<string, number>();
  private readonly base = new THREE.Matrix4();
  private readonly baseQ = new THREE.Quaternion();
  private readonly baseP = new THREE.Vector3();
  private readonly W = new Float64Array(JOINT_COUNT * 12);
  private readonly BW = new Float64Array(JOINT_COUNT * 12);
  private readonly qInvBind: THREE.Quaternion[] = [];
  private readonly D: THREE.Quaternion[] = Array.from({ length: JOINT_COUNT }, () => new THREE.Quaternion());
  private readonly Qw: THREE.Quaternion[];
  private readonly Pw: THREE.Vector3[];
  private readonly phone: THREE.Mesh;
  private readonly hipLat = [0, 0];
  private leg: { thigh: number; calf: number; foot: number; hip: number; knee: number; ankle: number; side: number }[] = [];
  /** Crown height of this model, model units. */
  private readonly H: number;
  /** Clips (character/Clips.ts) played by a mixer when the gait's action has one; else the gait poses the model. */
  private mixer: THREE.AnimationMixer | null = null;
  private readonly acts = new Map<string, { a: THREE.AnimationAction; speed: number; dur: number; w: number; loop: boolean }>();
  /** The clip state playing (a clip's name or 'locomotion') and whether its legs are the gait's. */
  private cur: string | null = null; private legsGait = false;
  private clipActions: ClipActions = {};
  /** How much of the pose is the clips' (0: the gait's), the locomotion cycle's phase, the gait clock last drawn. */
  private cw = 0; private phase = 0; private lastClock = -1;
  private procQ: THREE.Quaternion[] = [];
  private readonly procP = new THREE.Vector3();
  private legs: boolean[] = [];

  private constructor(scene: THREE.Group, private readonly look: Look, private readonly authored: AuthoredOpts | null = null) {
    this.root = scene;
    scene.name = 'hero';
    // MPFB's head bone is 'head'; the map (and the crowd's joint) say 'Head'
    scene.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === 'head') o.name = 'Head'; });
    scene.updateMatrixWorld(true);
    if (authored) { const b = new THREE.Box3().setFromObject(scene); this.H = b.max.y - Math.min(0, b.min.y); }
    else this.H = QUATERNIUS_HEIGHT;
    const MODEL_HEIGHT = this.H;
    const skinned: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
    const body = skinned.find((m) => m.skeleton.bones.length > 10 && (m.geometry.getAttribute('position').count > 3000))!;

    // Bones in parent-first order, their bind pose in model space.
    const order: THREE.Bone[] = [];
    const visit = (o: THREE.Object3D) => { if ((o as THREE.Bone).isBone) order.push(o as THREE.Bone); o.children.forEach(visit); };
    visit(scene);
    const top = order[0];
    top.parent!.updateWorldMatrix(true, false);
    this.base.copy(top.parent!.matrixWorld);
    this.base.decompose(this.baseP, this.baseQ, _v);
    order.forEach((b, i) => this.byName.set(b.name, i));
    for (const b of order) {
      const pi = b.parent && (b.parent as THREE.Bone).isBone ? this.byName.get(b.parent.name)! : -1;
      b.updateWorldMatrix(false, false);
      const qb = new THREE.Quaternion(), pb = new THREE.Vector3(); b.matrixWorld.decompose(pb, qb, _v2);
      this.bones.push({ obj: b, parent: pi, joint: MAP[b.name] ?? -1, lp: b.position.clone(), lq: b.quaternion.clone(), grip: null, rq: b.quaternion.clone(), pb, qb, align: new THREE.Quaternion(), axis: new THREE.Vector3(0, 1, 0), len: 0, ps: 1 });
    }
    const ws = this.bones.map(() => 1);
    this.bones.forEach((bn, i) => {
      const own = authored ? 1 : BONE_SCALE[bn.obj.name] ?? 1;
      bn.ps = bn.parent >= 0 ? ws[bn.parent] : 1;
      ws[i] = bn.ps * own;
    });
    const worldPos = (name: string) => { const b = this.bones[this.byName.get(name)!].obj; return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); };

    // The crowd's bind pose (canonical 1.75 m) in model units, and the alignment of each limb.
    bindWorld(this.BW);
    const ours = (j: number) => new THREE.Vector3(this.BW[j * 12 + 3], this.BW[j * 12 + 7], this.BW[j * 12 + 11]).multiplyScalar(MODEL_HEIGHT / BASE_HEIGHT);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 12, B = this.BW;
      _m.set(B[o], B[o + 1], B[o + 2], 0, B[o + 4], B[o + 5], B[o + 6], 0, B[o + 8], B[o + 9], B[o + 10], 0, 0, 0, 0, 1);
      this.qInvBind.push(new THREE.Quaternion().setFromRotationMatrix(_m).invert());
    }
    for (const bn of this.bones) {
      const al = ALIGN[bn.obj.name];
      if (al) {
        const from = worldPos(al[0]).sub(worldPos(bn.obj.name)).normalize();
        const to = ours(al[2]).sub(ours(al[1])).normalize();
        bn.align.setFromUnitVectors(from, to);
      } else if (bn.obj.name.startsWith('foot_')) {
        const side = bn.obj.name.endsWith('_l') ? 'l' : 'r';
        const from = worldPos(`ball_${side}`).sub(worldPos(bn.obj.name)).normalize();
        bn.align.setFromUnitVectors(from, new THREE.Vector3(0, -ANKLE_H, BALL).normalize());
      }
    }
    // Leg chains for the IK.
    for (const [s, side, hip, knee, ankle] of [['l', 1, J.hipL, J.kneeL, J.ankleL], ['r', -1, J.hipR, J.kneeR, J.ankleR]] as const) {
      const thigh = this.byName.get(`thigh_${s}`)!, calf = this.byName.get(`calf_${s}`)!, foot = this.byName.get(`foot_${s}`)!;
      this.bones[thigh].axis.copy(this.bones[calf].lp).normalize(); this.bones[thigh].len = this.bones[calf].lp.length();
      this.bones[calf].axis.copy(this.bones[foot].lp).normalize(); this.bones[calf].len = this.bones[foot].lp.length();
      this.leg.push({ thigh, calf, foot, hip, knee, ankle, side });
      // Sideways offset of the model's hip from the crowd's (model units), carried to the feet.
      this.hipLat[side > 0 ? 0 : 1] = worldPos(`thigh_${s}`).x - ours(hip).x;
    }
    // Fingers: a relaxed curl about the axis across the palm; the right hand also has a phone grip.
    for (const s of ['l', 'r']) {
      const side = s === 'l' ? 1 : -1;
      const hand = worldPos(`hand_${s}`), mid = worldPos(`middle_01_${s}`);
      const dir = mid.clone().sub(hand).normalize();
      const across = worldPos(`index_01_${s}`).sub(worldPos(`pinky_01_${s}`)).normalize();
      const palm = new THREE.Vector3().crossVectors(dir, across).multiplyScalar(side).normalize();
      const axisW = new THREE.Vector3().crossVectors(dir, palm).normalize();
      for (const f of FINGERS) for (let k = 0; k < 3; k++) {
        const i = this.byName.get(`${f}_0${k + 1}_${s}`);
        if (i === undefined) continue;
        const bn = this.bones[i];
        const axisL = axisW.clone().applyQuaternion(bn.qb.clone().invert());
        const extra = f === 'pinky' ? 1.15 : f === 'index' ? 0.85 : 1;
        const rest = bn.lq.clone();
        bn.lq.copy(rest).multiply(_q.setFromAxisAngle(axisL, CURL.relaxed[k] * extra));
        if (s === 'r') bn.grip = rest.clone().multiply(_q.setFromAxisAngle(axisL, CURL.grip[k] * extra));
      }
    }
    this.Qw = this.bones.map(() => new THREE.Quaternion());
    this.Pw = this.bones.map(() => new THREE.Vector3());

    if (authored) {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // names are "<id>.<asset>": the asset decides the kind ("feilong" contains "long", a hairstyle's name)
        const asset = (n: string) => n.replace(/^[^.]*\./, '');
        // brows, lashes and eyes cast nothing visible; on the low tier the hair neither (body, clothes and shoes do:
        // without a shadow a person floats)
        const small = /eyebrow|eyelash|low-poly|high-poly/i.test(asset(m.name)), hairy = /short|bob|long|ponytail|braid|afro/i.test(asset(m.name));
        m.castShadow = !small && !(authored.lite && hairy); m.receiveShadow = true; m.frustumCulled = false;
        if (!Array.isArray(m.material)) m.material = physical(m.material as THREE.MeshStandardMaterial, `${asset(m.name)} ${asset(m.material.name)}`, authored);
      });
      const hair: THREE.SkinnedMesh[] = [];
      scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (m.material as THREE.Material).alphaTest >= 0.5) hair.push(m); });
      if (!authored.lite) for (const m of hair) m.parent!.add(fringe(m));
    } else {
    // Skin and hair in the look's colours, then the clothes.
      // The texture is a warm tan; this lightens it to the look's skin (relative to the player's own).
      const ref = new THREE.Color('#e2bd98');
      const skinTint = new THREE.Color(1.18, 1.06, 0.98).multiply(new THREE.Color(look.skin.r / ref.r, look.skin.g / ref.g, look.skin.b / ref.b));
      for (const m of skinned) {
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.userData.wet = true;
        if (/hair/i.test(mat.name)) mat.color.copy(look.hair).multiplyScalar(1.6);
        else if (/superhero/i.test(mat.name)) mat.color.copy(skinTint);
      }
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) { m.castShadow = true; m.frustumCulled = false; const mat = m.material as THREE.MeshStandardMaterial; if (/hair/i.test(mat.name)) mat.color.copy(look.hair).multiplyScalar(1.6); }
      });
      const clothes = dress(body, {
        top: look.shirt, inner: look.inner ?? new THREE.Color('#e8e6df'), pants: look.pants, shoes: look.shoes, sole: look.sole ?? new THREE.Color('#2a2a2c'),
      });
      for (const c of clothes) body.parent!.add(c);

    }
    // The phone, held in the right palm.
    const hb = this.bones[this.byName.get('hand_r')!];
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.009, 0.15), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.3, metalness: 0.4 }));
    const hand = worldPos('hand_r'), mid = worldPos('middle_01_r');
    const dir = mid.clone().sub(hand).normalize();
    const across = worldPos('index_01_r').sub(worldPos('pinky_01_r')).normalize();
    const palm = new THREE.Vector3().crossVectors(dir, across).multiplyScalar(-1).normalize();
    const zAx = dir.clone(), yAx = palm.clone().negate(), xAx = new THREE.Vector3().crossVectors(yAx, zAx).normalize();
    _m.makeBasis(xAx, yAx, zAx).setPosition(hand.clone().addScaledVector(dir, 0.06).addScaledVector(palm, 0.022));
    const inv = hb.obj.matrixWorld.clone().invert();
    _m.premultiply(inv).decompose(phone.position, phone.quaternion, phone.scale);
    phone.castShadow = true; phone.visible = false; phone.name = 'hero-phone';
    hb.obj.add(phone);
    this.phone = phone;
    for (const bn of this.bones) bn.obj.scale.setScalar(authored ? 1 : BONE_SCALE[bn.obj.name] ?? 1);
    scene.visible = false;
  }

  /** Load and dress the model. `base` is the directory holding `body.gltf` and `hair.gltf`. */
  static async load(base: string, look: Look): Promise<Hero> {
    // A texture that fails only warns inside GLTFLoader (the model comes back without it): count the
    // manager's errors and treat any as a failed attempt, so the whole file is fetched again.
    const once = (file: string) => async () => {
      let failed = '';
      const manager = new THREE.LoadingManager();
      manager.onError = (url) => { failed ||= url; };
      const gltf = await new GLTFLoader(manager).loadAsync(`${base}${file}`);
      if (failed) throw new Error(`${file}: ${failed} did not load`);
      return gltf;
    };
    const [body, hair] = await Promise.all([retry('hero body', once('body.gltf')), retry('hero hair', once('hair.gltf'))]);
    return Hero.build(body.scene, hair.scene, look);
  }

  /** A finished character glb (public/models/characters/<id>.glb). */
  static async loadAuthored(url: string, look: Look, opts: AuthoredOpts = {}): Promise<Hero> {
    const gltf = await retry(`character ${url}`, () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url));
    return new Hero(gltf.scene, look, opts);
  }

  /** Dress and rig loaded scenes (tests parse the glTF themselves). */
  static build(scene: THREE.Group, hair: THREE.Object3D, look: Look): Hero {
    // The hair is modelled in place over the bind pose: re-parent it to the head bone, keeping it there.
    scene.updateMatrixWorld(true);
    let head: THREE.Object3D | undefined;
    scene.traverse((o) => { if (o.name === 'Head' && (o as THREE.Bone).isBone) head = o; });
    if (!head) throw new Error('hero: no Head bone');
    hair.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    hair.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const invHead = head.matrixWorld.clone().invert();
    for (const m of meshes) {
      m.matrixWorld.clone().premultiply(invHead).decompose(m.position, m.quaternion, m.scale);
      head.add(m);
    }
    return new Hero(scene, look);
  }

  hide(): void { this.root.visible = false; }

  /** The skeleton at rest, for retargeting clips onto it. */
  rig(): Rig {
    return {
      names: this.bones.map((b) => b.obj.name), parent: this.bones.map((b) => b.parent),
      restQ: this.bones.map((b) => b.rq.clone()), restP: this.bones.map((b) => b.lp.clone()),
      baseQ: this.baseQ.clone(), baseP: this.baseP.clone(),
    };
  }

  /** Play clips (by name: 'idle', 'walk', 'run', 'sit', 'talk'...) for the actions `actions` maps to them. */
  useClips(clips: Record<string, Retargeted>, actions: ClipActions): void {
    this.mixer?.stopAllAction();
    this.mixer = new THREE.AnimationMixer(this.root);
    this.acts.clear();
    for (const [name, r] of Object.entries(clips)) {
      const a = this.mixer.clipAction(r.clip);
      if (!r.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play(); a.setEffectiveWeight(0);
      this.acts.set(name, { a, speed: r.speed, dur: r.clip.duration, w: 0, loop: r.loop });
    }
    this.clipActions = actions;
    this.procQ = this.bones.map(() => new THREE.Quaternion());
    this.legs = this.bones.map((b) => LEGS.test(b.obj.name));
    this.cw = 0; this.lastClock = -1; this.cur = null;
  }

  /** Seconds this model takes to get up off the ground (its 'getup' clip), if it has one: people/ waits for it. */
  get getupSecs(): number | undefined {
    const a = this.clipActions.getup, name = typeof a === 'string' ? a : a?.clip;
    return name ? this.acts.get(name)?.dur : undefined;
  }

  /** Blend the clips over the gait's pose (which `draw` has just set on the bones). */
  private animate(g: Gait, sm: number): void {
    const mixer = this.mixer!;
    const clock = g.clock;
    const dt = this.lastClock < 0 ? 0 : Math.min(0.1, Math.max(0, clock - this.lastClock));
    this.lastClock = clock;
    let spec = this.clipActions[g.act];
    if (spec !== undefined && g.speed > 0.4 && (typeof spec === 'string' ? spec : spec.clip) === 'talk') spec = this.clipActions.move;
    const state = typeof spec === 'string' ? spec : spec?.clip;
    const have = state === 'locomotion' ? this.acts.has('idle') : !!state && this.acts.has(state);
    const v = g.speed;
    // what each clip should weigh
    const target = new Map<string, number>();
    if (have && state === 'locomotion') {
      const walk = this.acts.has('walk') ? sstep(0.12, 0.9, v) : 0, run = this.acts.has('run') ? sstep(2.3, 3.6, v) * (this.acts.has('walk') ? 1 : sstep(0.12, 0.9, v)) : 0;
      target.set('idle', 1 - walk); target.set('walk', walk * (1 - run)); target.set('run', run);
    } else if (have) target.set(state!, 1);
    if (have && state !== this.cur) {
      // a clip played once starts from its beginning; one that goes on into the next action (falling, then lying) carries on
      const c = state === 'locomotion' ? null : this.acts.get(state!);
      if (c && !c.loop) c.a.reset();
      this.cur = state!;
    }
    if (have) this.legsGait = SEATED.has(g.act) || (typeof spec === 'object' && spec.legs === 'gait');
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.12) : 1;
    if (have) {
      let sum = 0;
      for (const [name, c] of this.acts) { c.w += ((target.get(name) ?? 0) - c.w) * k; sum += c.w; }
      for (const c of this.acts.values()) c.w = sum > 1e-4 ? c.w / sum : 0;
    }
    const tc = have ? 1 : 0;
    this.cw = dt > 0 ? this.cw + (tc - this.cw) * (1 - Math.exp(-dt / 0.15)) : tc;
    if (this.cw < 0.002) { this.cw = 0; return; }
    // walk and run share one cycle, each at the rate that keeps its planted foot under the ground speed
    const w = this.acts.get('walk'), r = this.acts.get('run');
    let cyc = 0, ws = 0;
    for (const c of [w, r]) if (c && c.speed > 0 && c.w > 0) { cyc += c.w * (v / (c.speed * sm)) / c.dur; ws += c.w; }
    if (ws > 0) this.phase = (this.phase + dt * cyc / ws) % 1;
    for (const c of [w, r]) if (c) { c.a.timeScale = 0; c.a.time = this.phase * c.dur; }
    for (const c of this.acts.values()) c.a.setEffectiveWeight(c.w);
    // the gait's pose, then the clips', then between the two
    for (let i = 0; i < this.bones.length; i++) this.procQ[i].copy(this.bones[i].obj.quaternion);
    const pel = this.bones[this.byName.get('pelvis')!].obj;
    this.procP.copy(pel.position);
    mixer.update(dt);
    const seated = this.legsGait;
    for (let i = 0; i < this.bones.length; i++) {
      const o = this.bones[i].obj;
      if (seated && this.legs[i]) { o.quaternion.copy(this.procQ[i]); continue; }
      _q.copy(o.quaternion);
      o.quaternion.copy(this.procQ[i]).slerp(_q, this.cw);
    }
    if (seated) pel.position.copy(this.procP);
    else pel.position.lerpVectors(this.procP, _v.copy(pel.position), this.cw);
  }

  /** Pose from `g` and place the feet at `root`, facing `yaw` (same arguments as `Crowd.add`). */
  draw(root: THREE.Vector3, yaw: number, g: Gait): void {
    if (g.look !== this.look) g.bindLook(this.look);
    const MODEL_HEIGHT = this.H;
    const sm = g.scale * BASE_HEIGHT / MODEL_HEIGHT;
    this.root.visible = true;
    this.root.position.copy(root);
    this.root.rotation.set(0, yaw, 0);
    this.root.scale.setScalar(sm);
    const W = this.W, BW = this.BW;
    _v.set(0, 0, 0);
    poseWorld(_v, 0, g.scale, g, W);
    const inv = 1 / g.scale;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 12;
      _m.set(W[o] * inv, W[o + 1] * inv, W[o + 2] * inv, 0, W[o + 4] * inv, W[o + 5] * inv, W[o + 6] * inv, 0, W[o + 8] * inv, W[o + 9] * inv, W[o + 10] * inv, 0, 0, 0, 0, 1);
      this.D[j].setFromRotationMatrix(_m).multiply(this.qInvBind[j]);
    }
    // Crowd positions in model units: character space / sm.
    const k = 1 / sm, kb = MODEL_HEIGHT / BASE_HEIGHT;
    const P = (j: number, out: THREE.Vector3) => out.set(W[j * 12 + 3] * k, W[j * 12 + 7] * k, W[j * 12 + 11] * k);
    const grip = g.prop > 0.5;

    const ikAim: (THREE.Vector3 | null)[] = [];
    const knee = new THREE.Vector3(), ankle = new THREE.Vector3();
    for (let i = 0; i < this.bones.length; i++) {
      const bn = this.bones[i];
      const pq = bn.parent >= 0 ? this.Qw[bn.parent] : this.baseQ;
      const pp = bn.parent >= 0 ? this.Pw[bn.parent] : this.baseP;
      const Qt = this.Qw[i];
      if (bn.joint >= 0) Qt.copy(this.D[bn.joint]).multiply(bn.align).multiply(bn.qb);
      else Qt.copy(pq).multiply(grip && bn.grip ? bn.grip : bn.lq);
      // Position: the pelvis moves as the crowd's does; everything else hangs off its parent.
      const Pw = this.Pw[i];
      if (bn.obj.name === 'pelvis') {
        P(J.pelvis, Pw).sub(_v2.set(BW[3] * kb, BW[7] * kb, BW[11] * kb)).add(bn.pb);
      } else Pw.copy(bn.lp).multiplyScalar(bn.ps).applyQuaternion(pq).add(pp);
      // Leg IK: aim the thigh at the knee and the calf at the ankle.
      const aim = ikAim[i];
      if (aim) {
        _v.copy(bn.axis).applyQuaternion(Qt);
        _v2.copy(aim).sub(Pw).normalize();
        Qt.premultiply(_q.setFromUnitVectors(_v, _v2));
      }
      const leg = this.leg.find((l) => l.thigh === i);
      if (leg) {
        const lat = this.hipLat[leg.side > 0 ? 0 : 1];
        _v3.set(lat, 0, 0).applyQuaternion(this.D[J.pelvis]);
        P(leg.ankle, ankle).add(_v3);
        P(leg.knee, knee).add(_v3);
        const a = bn.len, b = this.bones[leg.calf].len;
        const to = _v.copy(ankle).sub(Pw);
        const d = Math.min(Math.max(to.length(), 1e-4), (a + b) * 0.9995);
        to.normalize();
        // Bend towards the crowd's knee, perpendicular to hip->ankle.
        const pole = _v2.copy(knee).sub(Pw);
        pole.addScaledVector(to, -pole.dot(to));
        if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1).applyQuaternion(this.D[J.pelvis]);
        pole.normalize();
        const x = (a * a - b * b + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, a * a - x * x));
        const kneeAt = new THREE.Vector3().copy(Pw).addScaledVector(to, x).addScaledVector(pole, hgt);
        const ankleAt = new THREE.Vector3().copy(Pw).addScaledVector(to, d);
        _v.copy(bn.axis).applyQuaternion(Qt);
        _v2.copy(kneeAt).sub(Pw).normalize();
        Qt.premultiply(_q.setFromUnitVectors(_v, _v2));
        ikAim[leg.calf] = ankleAt;
      }
      _q2.copy(pq).invert();
      bn.obj.quaternion.copy(_q2).multiply(Qt);
      if (bn.obj.name === 'pelvis') bn.obj.position.copy(Pw).sub(pp).applyQuaternion(_q2);
    }
    this.phone.visible = grip;
    if (this.mixer) this.animate(g, sm);
  }
}
