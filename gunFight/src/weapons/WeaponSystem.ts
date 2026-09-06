import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { SurfaceType } from '../core/Events';
import { Rng } from '../core/Rng';
import type { WeaponsApi, WeaponState, PlayerApi, FxApi, EnemiesApi, AudioApi, BodyPart, SkyApi, RenderPostApi } from '../game/Contracts';
import { WEAPON_DEFS, DEF_BY_ID, DEFAULT_LOADOUT, BALLISTICS, type WeaponDef } from './WeaponDefs';
import { buildMaterials, type WeaponMaterials } from './Materials';
import { Hand, HAND_POSES, type HandPoseName } from './Hands';
import { GripIk } from './Grip';
import { sampleN, sampleV, sampleStep, type WeaponModel, type Clip, type HandPlacement, type Key } from './Model';
import type { V3 } from './Build';
import { buildAssaultRifle } from './models/AssaultRifle';
import { buildSmg } from './models/Smg';
import { buildPistol } from './models/Pistol';
import { buildShotgun } from './models/Shotgun';
import { buildSniper } from './models/Sniper';
import { MuzzleFlash } from './MuzzleFlash';
import { ScopeAtmosphere } from './ScopeAtmosphere';
import { MipBlur } from './MipBlur';

/** Extra fields the player module exposes beyond PlayerApi (all optional / guarded). */
interface PlayerExtras {
  viewmodelOffset?: { position: THREE.Vector3; rotation: THREE.Euler };
  sprintBlend?: number; tacSprintBlend?: number; slideBlend?: number; crouchBlend?: number; airBlend?: number; mantleBlend?: number; deadBlend?: number; moveBlend?: number;
  tacSprinting?: boolean; mantling?: boolean; speed?: number;
  setAimFov?(fovH: number, blend: number): void;
  settings?: { fov?: number };
}
type Player = PlayerApi & PlayerExtras;

type Builder = (ctx: { mats: WeaponMaterials }) => WeaponModel;
const BUILDERS: Record<string, Builder> = { m4: buildAssaultRifle, mp5: buildSmg, m9: buildPistol, m870: buildShotgun, l96: buildSniper };

interface Slot {
  def: WeaponDef;
  model: WeaponModel;
  state: WeaponState;
  shotIndex: number;
  /** part params that persist (slide lock, bolt open) */
  held: Record<string, number>;
  chamberEmpty: boolean;
}

type Anim = 'idle' | 'draw' | 'holster' | 'reload' | 'cycle' | 'inspect' | 'melee';

class Spring {
  x = 0; v = 0;
  step(k: number, c: number, dt: number): void {
    const h = Math.min(dt, 1 / 30);
    this.v += (-k * this.x - c * this.v) * h;
    this.x += this.v * h;
  }
}

/** Measured hand/weapon contact for one hand. Metres in the live record, millimetres in gripReport. */
interface GripStat { solid: string; maxGap: number; tipGap: number; maxPen: number; palmGap: number; meanGap: number; move: number; virtual?: boolean }

const DEG = Math.PI / 180;
/**
 * Horizontal FOV at 16:9 -> vertical FOV, matching how the player converts its own fov setting so the
 * two numbers can be compared directly (CoD keeps vertical FOV constant across aspect ratios).
 */
function hFovToV(hDeg: number): number { return 2 * Math.atan(Math.tan(hDeg * 0.5 * DEG) / (16 / 9)) / DEG; }
/**
 * How much further the gun sits from the eye at the new viewmodel FOV than at the one the animation
 * offsets were authored against: tan(55/2) / tan(36/2).
 */
const VM_OFFSET_SCALE = 1.60;
/**
 * Viewmodel near-blur held in hipfire. At the ViewmodelDof pass's 7 px radius this is ~2.8 px of CoC
 * on the closest weapon geometry, falling to nothing at the focus plane - the "sharp on the grip and
 * optic, soft on the near end" read of ref_06, and the foreground half of the three-layer depth cue.
 */
const VM_DOF_HIP = 0.40;
/** halvings in the out-of-scope periphery blur (see updateScope) */
const PERIPH_MIPS = 1;
const RAY_FILTER = groups(CG.ALL, CG.WORLD | CG.ENEMY | CG.RAGDOLL | CG.DEBRIS);

/**
 * First-person weapons: viewmodels in `engine.viewmodelScene`, procedural animation state machine,
 * hitscan ballistics, muzzle/shell/tracer/impact feedback through FxApi + events.
 */
export class WeaponSystem implements System, WeaponsApi {
  name = 'weapons';
  slots: WeaponState[] = [];
  current!: WeaponState;

  private mats: WeaponMaterials;
  private inst: Slot[] = [];
  private cur = 0;
  private pending = -1;
  private rightHand: Hand; private leftHand: Hand;
  private vmRoot = new THREE.Group();
  private gunRoot = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private flashLight: THREE.PointLight;
  private worldFlash: THREE.PointLight;
  private flashT = 0;
  private rng = new Rng(4242);

  // animation state
  private anim: Anim = 'idle';
  private clip: Clip | null = null;
  private clipT = 0;
  private firedEvents = new Set<number>();
  private aimBlend = 0; private aimWant = false; private aimOverride: boolean | null = null;
  private lowerBlend = 1;
  private sprintOut = 0;
  private fireCycleT = 99; private fireCycleActive = false;
  private triggerT = 1;
  private bloom = 0;
  private lastFire = -10;
  private fireHeld = false;
  private burstLeft = 0;
  private recoilZ = new Spring(); private recoilX = new Spring(); private recoilRoll = new Spring(); private recoilY = new Spring();
  private jolt = new Spring();
  private swayT = 0;
  private handSpeed = 18;
  private debugSprint: number | null = null; private debugTac: number | null = null;
  /** shot-mode only: narrow the viewmodel camera so the glove can be judged at close range */
  private debugVmFov: number | null = null;
  private inspectQueued = false;

  // scratch
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private tmp3 = new THREE.Vector3(); private tmpQ = new THREE.Quaternion();
  private hitPoint = new THREE.Vector3(); private hitNormal = new THREE.Vector3(); private shotDir = new THREE.Vector3();
  private scopeRT: THREE.WebGLRenderTarget | null = null; private scopeCam: THREE.PerspectiveCamera | null = null;
  /** graded/hazed copy of scopeRT that the lens actually samples (see ScopeAtmosphere) */
  private scopeOut: THREE.WebGLRenderTarget | null = null; private scopeAtmo: ScopeAtmosphere | null = null;
  private warnedScopePost = false;
  /** the texture physically attached to scopeRT's framebuffer (see the note in updateScope) */
  private scopeAttach: THREE.Texture | null = null;
  /** low-res world render shown outside the scope ring while aiming (blurred + darkened periphery) */
  private blurRT: THREE.WebGLRenderTarget | null = null; private blurQuad: THREE.Mesh | null = null;
  private periphBlur: MipBlur | null = null;
  private flash: MuzzleFlash;
  private lastPartVal: Record<string, number> = {};
  // ---- grip contact IK (see Grip.ts). One solver per hand so both measurements stay live.
  private ikR = new GripIk(); private ikL = new GripIk();
  private authored = new THREE.Vector3();
  private posBase = new THREE.Vector3();
  private gripP = new THREE.Vector3(); private gripF = new THREE.Vector3(); private gripB = new THREE.Vector3();
  private gripPv: V3 = [0, 0, 0]; private gripFv: V3 = [0, 0, 0]; private gripBv: V3 = [0, 0, 0];
  private grip: Record<'right' | 'left', GripStat> =
    { right: { solid: 'none', maxGap: 0, tipGap: 0, maxPen: 0, palmGap: 0, meanGap: 0, move: 0 }, left: { solid: 'none', maxGap: 0, tipGap: 0, maxPen: 0, palmGap: 0, meanGap: 0, move: 0 } };
  private gripPads: { name: string; gap: number; axial: number }[] = [];
  private gripWarnT = -99;
  private gripDev = false;

  constructor(private engine: Engine) {
    // The grip assert costs nothing (the numbers fall out of the solve) but it is only useful where
    // somebody reads console output: the dev server and the screenshot harness.
    try { this.gripDev = import.meta.env?.DEV === true || new URLSearchParams(location.search).has('shot'); } catch { this.gripDev = false; }
    this.mats = buildMaterials(engine.assets.anisotropy);
    const vs = engine.viewmodelScene;
    vs.add(engine.viewmodelCamera);
    engine.viewmodelCamera.add(this.vmRoot);
    this.vmRoot.add(this.gunRoot);

    // lighting for the viewmodel scene (mirrors the sky's sun; env map is copied per frame)
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.05; this.sun.shadow.camera.far = 6;
    // the viewmodel now reaches ~1.4 m in front of the eye (long weapons at the new viewmodel FOV)
    this.sun.shadow.camera.left = -1.1; this.sun.shadow.camera.right = 1.1; this.sun.shadow.camera.top = 1.1; this.sun.shadow.camera.bottom = -1.1;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.003; this.sun.shadow.radius = 2;
    vs.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfd8e6, 0x7a6040, 0.85);
    vs.add(this.hemi);
    // camera-rigged key + rim so the gun always has edge highlights regardless of where the sun is (CoD viewmodels do this)
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
    key.position.set(-0.55, 0.85, 0.6); key.target.position.set(0.12, -0.15, -0.5);
    engine.viewmodelCamera.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xdbe8ff, 1.1);
    rim.position.set(0.9, 0.35, -1.2); rim.target.position.set(0.1, -0.1, -0.3);
    engine.viewmodelCamera.add(rim, rim.target);
    // bounce off the ground onto the underside of the gun and the hands
    const bounce = new THREE.DirectionalLight(0xb59a78, 0.55);
    bounce.position.set(0.1, -1.0, -0.3); bounce.target.position.set(0.1, 0.0, -0.4);
    engine.viewmodelCamera.add(bounce, bounce.target);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.5, 2); this.flashLight.castShadow = false;
    this.gunRoot.add(this.flashLight);
    this.worldFlash = new THREE.PointLight(0xffa850, 0, 9, 2);
    engine.scene.add(this.worldFlash);

    this.rightHand = new Hand(this.mats, 'right');
    this.leftHand = new Hand(this.mats, 'left');
    this.gunRoot.add(this.rightHand.root, this.leftHand.root);
    this.flash = new MuzzleFlash(this.mats);
    this.gunRoot.add(this.flash.mesh);

    for (const id of DEFAULT_LOADOUT) {
      const def = DEF_BY_ID[id];
      const model = BUILDERS[id]({ mats: this.mats });
      model.root.visible = false;
      this.gunRoot.add(model.root);
      const state: WeaponState = { id: def.id, name: def.name, ammoInMag: def.magSize, magSize: def.magSize, reserveAmmo: def.reserve, reloading: false, aiming: false, aimBlend: 0, spread: def.spread.hip, firing: false, kind: def.kind, fireMode: def.fireMode };
      this.inst.push({ def, model, state, shotIndex: 0, held: {}, chamberEmpty: false });
      this.slots.push(state);
    }
    this.current = this.slots[0];
    this.equip(0, true);
  }

  // ------------------------------------------------------------------ WeaponsApi
  equip(index: number, instant = false): void {
    if (index < 0 || index >= this.inst.length) return;
    if (instant) {
      this.inst[this.cur].model.root.visible = false;
      this.cur = index; this.pending = -1;
      this.current = this.slots[index];
      const s = this.inst[index];
      s.model.root.visible = true;
      this.anim = 'idle'; this.clip = null; this.lowerBlend = 0;
      this.rightHand.clearWrap(); this.leftHand.clearWrap();
      this.placeHands(s.model.hands.right, s.model.hands.left, true);
      this.applyHeld(s);
      this.player?.speedFactor !== undefined && (this.player.speedFactor = s.def.speedFactor);
      this.engine.events.emit('weapon:switch', { weaponId: s.def.id });
      return;
    }
    if (index === this.cur && this.anim !== 'holster') return;
    this.pending = index;
    if (this.anim !== 'holster') { this.startClip('holster', { duration: this.inst[this.cur].def.timing.lower }); this.audio?.play('switch', { volume: 0.6 }); }
  }

  addAmmo(kind: WeaponState['kind'], amount: number): void {
    for (const s of this.inst) if (s.def.kind === kind) s.state.reserveAmmo = Math.min(s.def.reserveMax, s.state.reserveAmmo + amount);
  }

  private pendingDebugFire = false;
  /** Fires on the next frame, after the player has placed the camera and the gun pose is composed (poses call this right after a teleport). */
  debugFire(): void {
    const s = this.inst[this.cur];
    if (s.state.ammoInMag <= 0) s.state.ammoInMag = s.def.magSize;
    this.anim = 'idle'; this.clip = null; this.lowerBlend = 0; this.sprintOut = 0;
    this.pendingDebugFire = true;
  }
  debugReload(): void {
    const s = this.inst[this.cur];
    this.anim = 'idle'; this.clip = null; this.lowerBlend = 0;
    if (s.state.ammoInMag === s.def.magSize) s.state.ammoInMag = Math.floor(s.def.magSize / 2);
    this.startReload(s);
  }
  setAim(aim: boolean): void { this.aimOverride = aim; if (aim) this.aimBlend = 1; else this.aimBlend = 0; }
  /** Pose helper: force sprint / tactical sprint blends (null = follow the player). */
  debugPose(o: { sprint?: number | null; tac?: number | null; inspect?: boolean; vmFov?: number | null } = {}): void {
    this.debugSprint = o.sprint ?? null; this.debugTac = o.tac ?? null;
    if (o.vmFov !== undefined) this.debugVmFov = o.vmFov;
    if (o.inspect) { this.anim = 'idle'; this.clip = null; this.lowerBlend = 0; this.startClip('inspect', this.inst[this.cur].model.clips.inspect); }
  }
  get currentModel(): WeaponModel { return this.inst[this.cur].model; }
  get currentDef(): WeaponDef { return this.inst[this.cur].def; }

  // ------------------------------------------------------------------ helpers
  private get player(): Player | undefined { return this.engine.get<Player>('player'); }
  private get fx(): FxApi | undefined { return this.engine.get<FxApi>('fx'); }
  private get audio(): AudioApi | undefined { return this.engine.get<AudioApi>('audio'); }
  private get enemies(): EnemiesApi | undefined { return this.engine.get<EnemiesApi>('enemies'); }

  private startClip(anim: Anim, clip: Clip): void {
    this.anim = anim; this.clip = clip; this.clipT = 0; this.firedEvents.clear();
  }

  private placeHands(r: HandPlacement, l: HandPlacement, snap = false): void {
    this.rightHand.orient(r.pos, r.fingers, r.back, r.elbow, r.sleeve ?? 1);
    this.leftHand.orient(l.pos, l.fingers, l.back, l.elbow, l.sleeve ?? 1);
    if (snap) { this.rightHand.snap(HAND_POSES[r.pose]); this.leftHand.snap(HAND_POSES[l.pose]); }
    else { this.rightHand.setPose(HAND_POSES[r.pose]); this.leftHand.setPose(HAND_POSES[l.pose]); }
  }

  /**
   * Grip contact IK. `orient` has just put the wrist where the animation asked; this presses it onto
   * the solid the placement names and closes the fingers around it (Grip.ts). Runs after the pose
   * damping so the fingers are solved against the curls that are actually on the bones this frame.
   */
  private solveGrip(model: WeaponModel, hand: Hand, place: HandPlacement, ik: GripIk): void {
    const side = hand.side;
    const rec = this.grip[side];
    const name = place.contact ?? 'none';
    const solid = name === 'none' ? undefined : model.grips[name];
    if (!solid) {
      hand.clearWrap(); hand.refresh();
      rec.solid = 'none'; rec.virtual = false; rec.maxGap = 0; rec.tipGap = 0; rec.maxPen = 0; rec.palmGap = 0; rec.meanGap = 0; rec.move = 0;
      return;
    }
    let offset: THREE.Vector3 | null = null;
    if (solid.part) { const pm = model.parts[solid.part]; if (pm) offset = pm.obj.position; }
    // Seat the wrist on the solid first (position AND orientation, both derived from the geometry -
    // see GripIk.seat), then let the IK close the fingers and take up the last few millimetres.
    this.authored.set(place.pos[0], place.pos[1], place.pos[2]);
    if (solid.derive === false) {
      this.gripPv[0] = place.pos[0]; this.gripPv[1] = place.pos[1]; this.gripPv[2] = place.pos[2];
      hand.orient(place.pos, place.fingers, place.back, place.elbow, place.sleeve ?? 1);
    } else {
      ik.seat(solid, offset, this.authored, place.fingers, place.back, this.gripP, this.gripF, this.gripB);
      this.gripPv[0] = this.gripP.x; this.gripPv[1] = this.gripP.y; this.gripPv[2] = this.gripP.z;
      this.gripFv[0] = this.gripF.x; this.gripFv[1] = this.gripF.y; this.gripFv[2] = this.gripF.z;
      this.gripBv[0] = this.gripB.x; this.gripBv[1] = this.gripB.y; this.gripBv[2] = this.gripB.z;
      hand.orient(this.gripPv, this.gripFv, this.gripBv, place.elbow, place.sleeve ?? 1);
    }
    this.gripP.set(this.gripPv[0], this.gripPv[1], this.gripPv[2]);
    const m = ik.solve(hand, name, solid, offset, this.gripP, 1);
    rec.virtual = solid.virtual === true;
    rec.solid = name; rec.maxGap = m.maxGap; rec.tipGap = m.tipGap; rec.maxPen = m.maxPen; rec.palmGap = m.palmGap; rec.meanGap = m.meanGap; rec.move = m.move;
  }

  /**
   * Measured hand/weapon contact, in millimetres. `tipGap` is the worst distance from a *fingertip* to
   * the surface of the solid that hand is holding and is what the dev assert fires on; `maxGap` is the
   * same over every palmar pad, `maxPen` the worst interpenetration, `palmGap` the closest palm
   * contact, `move` how far the solver had to correct the placement. Zero means the glove is on the
   * gun. Used by the assert below and by the shot harness.
   */
  gripReport(): { weapon: string; right: GripStat; left: GripStat; pads: { name: string; gap: number; axial: number }[]; worstMm: number; trace: { right: number[]; left: number[] } } {
    const mm = (v: number) => Math.round(v * 100000) / 100;
    const pack = (r: GripStat): GripStat => ({ solid: r.solid, maxGap: mm(r.maxGap), tipGap: mm(r.tipGap), maxPen: mm(r.maxPen), palmGap: mm(r.palmGap), meanGap: mm(r.meanGap), move: mm(r.move) });
    this.gripPads.length = 0;
    for (const [side, ik] of [['right', this.ikR], ['left', this.ikL]] as const) {
      if (this.grip[side].solid === 'none') continue;
      for (const p of ik.out.pads) this.gripPads.push({ name: `${side}.${p.name}`, gap: mm(p.gap), axial: mm(p.axial) });
    }
    return {
      weapon: this.inst[this.cur].def.id,
      right: pack(this.grip.right), left: pack(this.grip.left),
      pads: this.gripPads.slice(),
      trace: { right: this.ikR.trace.slice(), left: this.ikL.trace.slice() },
      worstMm: mm(Math.max(this.grip.right.virtual ? 0 : Math.max(this.grip.right.tipGap, this.grip.right.palmGap), this.grip.left.virtual ? 0 : Math.max(this.grip.left.tipGap, this.grip.left.palmGap))),
    };
  }

  /**
   * The assert the round-3 review asked for. A rebuilt hand mesh, a re-keyed clip or a moved grip
   * solid that leaves the glove floating shows up here as a console error in the capture report
   * instead of as "the fist closes on nothing" in 55 of 58 frames.
   */
  private checkGrip(): void {
    if (!this.gripDev) return;
    // The metric is the one the round-3 review asked for: fingertip to nearest weapon surface, plus
    // the palm, which is what actually carries the weapon.
    const w = (r: GripStat) => (r.virtual ? 0 : Math.max(r.tipGap, r.palmGap));
    const worst = Math.max(w(this.grip.right), w(this.grip.left));
    if (worst <= GRIP_MAX_GAP) return;
    if (this.engine.time - this.gripWarnT < 1) return;
    this.gripWarnT = this.engine.time;
    const s = this.inst[this.cur];
    const fmt = (r: GripStat) => `${r.solid} tip ${(r.tipGap * 1000).toFixed(1)}mm pad ${(r.maxGap * 1000).toFixed(1)}mm palm ${(r.palmGap * 1000).toFixed(1)}mm (moved ${(r.move * 1000).toFixed(1)}mm)`;
    console.error(`[weapons] GRIP CONTACT FAIL ${s.def.id}/${this.anim}: worst ${(worst * 1000).toFixed(1)}mm > ${(GRIP_MAX_GAP * 1000).toFixed(0)}mm — right: ${fmt(this.grip.right)} · left: ${fmt(this.grip.left)}`);
  }

  private applyHeld(s: Slot): void {
    for (const [k, v] of Object.entries(s.held)) this.setPart(s.model, k, v);
  }

  private setPart(model: WeaponModel, name: string, v: number): void {
    const p = model.parts[name];
    if (!p) return;
    this.lastPartVal[name] = v;
    const o = p.obj;
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
    if (p.pos) o.position.set(p.pos[0] * v, p.pos[1] * v, p.pos[2] * v);
    if (p.rot) {
      if (p.pivot) {
        // rotate about a pivot: T(pivot) R T(-pivot)
        const piv = this.tmp.set(p.pivot[0], p.pivot[1], p.pivot[2]);
        const q = this.tmpQ.setFromEuler(new THREE.Euler(p.rot[0] * v, p.rot[1] * v, p.rot[2] * v));
        const off = this.tmp2.copy(piv).negate().applyQuaternion(q).add(piv);
        o.position.add(off); o.quaternion.copy(q);
      } else o.rotation.set(p.rot[0] * v, p.rot[1] * v, p.rot[2] * v);
    }
  }

  private startReload(s: Slot): void {
    if (s.state.reserveAmmo <= 0 || s.state.ammoInMag >= s.def.magSize) return;
    const empty = s.state.ammoInMag === 0;
    this.startClip('reload', empty ? s.model.clips.reloadEmpty : s.model.clips.reload);
    s.state.reloading = true;
    this.engine.events.emit('weapon:reload', { weaponId: s.def.id });
  }

  private finishReload(s: Slot): void {
    const perClip = s.model.roundsPerReload ?? 0;
    if (perClip > 0) {
      const n = Math.min(perClip, s.def.magSize - s.state.ammoInMag, s.state.reserveAmmo);
      s.state.ammoInMag += n; s.state.reserveAmmo -= n;
    } else {
      const want = s.def.magSize + (s.chamberEmpty ? 0 : 1) - s.state.ammoInMag;
      const n = Math.min(Math.max(0, s.def.magSize - s.state.ammoInMag), s.state.reserveAmmo);
      void want;
      s.state.ammoInMag += n; s.state.reserveAmmo -= n;
    }
    s.chamberEmpty = false;
    s.held = {};
    this.applyHeld(s);
  }

  // ------------------------------------------------------------------ fixed step: input + ballistics
  fixedUpdate(dt: number): void {
    const inp = this.engine.input.state;
    const s = this.inst[this.cur];
    const p = this.player;
    const alive = p?.alive ?? true;
    const busy = this.anim !== 'idle';

    // --- weapon switch
    let want = -1;
    if (inp.weaponSlot > 0 && inp.weaponSlot <= this.inst.length) want = inp.weaponSlot - 1;
    if (inp.scrollDelta !== 0) want = (this.cur + (inp.scrollDelta > 0 ? 1 : -1) + this.inst.length) % this.inst.length;
    if (want >= 0 && want !== this.cur && alive) this.equip(want);

    // --- aim
    const sprintingHard = (p?.tacSprinting ?? false) || (this.debugTac ?? 0) > 0.5;
    this.aimWant = this.aimOverride ?? (inp.aim && alive && !sprintingHard && this.anim !== 'reload' && this.anim !== 'inspect' && this.anim !== 'melee' && this.anim !== 'holster' && this.anim !== 'draw' && this.anim !== 'cycle');
    s.state.aiming = this.aimWant;

    // --- sprint-out timer: can't fire until the gun comes back up
    const sprintBlend = this.debugSprint ?? p?.sprintBlend ?? 0;
    this.sprintOut = sprintBlend > 0.4 ? s.def.timing.sprintOut : Math.max(0, this.sprintOut - dt);

    // --- reload / inspect / melee
    if (alive && !busy) {
      if (inp.reload) { this.aimOverride = null; this.startReload(s); }
      else if (inp.inspect || this.inspectQueued) { this.inspectQueued = false; this.startClip('inspect', s.model.clips.inspect); }
      else if (inp.melee) { this.startClip('melee', s.model.clips.melee); this.audio?.play('melee_swing', { volume: 0.7 }); }
    }
    // firing interrupts inspect
    if (this.anim === 'inspect' && inp.firePressed) { this.anim = 'idle'; this.clip = null; }

    // --- fire
    const canFire = alive && !busy && this.sprintOut <= 0 && !sprintingHard;
    const interval = 60 / s.def.timing.rpm;
    const t = this.engine.time;
    const wantFire = s.def.fireMode === 'auto' ? inp.fire : (inp.firePressed || (s.def.fireMode === 'burst' && this.burstLeft > 0));
    if (s.def.fireMode === 'burst' && inp.firePressed && this.burstLeft === 0 && canFire) this.burstLeft = s.def.timing.burst ?? 3;
    if (wantFire && canFire && t - this.lastFire >= interval) {
      if (s.state.ammoInMag > 0) {
        this.fire(s);
        if (s.def.fireMode === 'burst') this.burstLeft = Math.max(0, this.burstLeft - 1);
      } else if (inp.firePressed || (s.def.fireMode === 'auto' && !this.fireHeld)) {
        this.audio?.play('dryfire', { volume: 0.8 });
        this.lastFire = t;
        this.triggerT = 0;
        if (s.state.reserveAmmo > 0) this.startReload(s);
      }
    }
    if (!inp.fire) this.burstLeft = 0;
    this.fireHeld = inp.fire;
    s.state.firing = inp.fire && s.state.ammoInMag > 0 && canFire;
    // recoil pattern resets when the trigger rests
    if (t - this.lastFire > interval * 2.5 + 0.1) s.shotIndex = 0;

    // --- spread (radians): base + movement + bloom
    const crouch = p?.crouching ? s.def.spread.crouchMul : 1;
    const air = (p?.grounded ?? true) ? 1 : s.def.spread.airMul;
    const speed = p?.speed ?? (p ? Math.hypot(p.velocity.x, p.velocity.z) : 0);
    const move = s.def.spread.move * Math.min(1, speed / BALLISTICS.moveSpeedRef) * 10;
    this.bloom = Math.max(0, this.bloom - s.def.spread.recover * dt);
    const base = THREE.MathUtils.lerp(s.def.spread.hip, s.def.spread.ads, this.aimBlend);
    s.state.spread = (base + move * (1 - this.aimBlend * 0.7)) * crouch * air + this.bloom;

    if (p) p.speedFactor = s.def.speedFactor;
  }

  private fire(s: Slot): void {
    const cam = this.engine.camera;
    const def = s.def;
    s.state.ammoInMag--;
    this.lastFire = this.engine.time;
    this.triggerT = 0;
    this.fireCycleT = 0; this.fireCycleActive = true;
    this.handSpeed = 40;

    // --- viewmodel recoil + camera recoil
    const pat = def.recoil.pattern[Math.min(s.shotIndex, def.recoil.pattern.length - 1)];
    s.shotIndex++;
    const yawSign = this.rng.next() < 0.5 ? -1 : 1;
    const pitch = def.recoil.pitch * pat[0] * (0.85 + this.rng.next() * 0.3);
    const yaw = def.recoil.yaw * pat[1] + def.recoil.yawRandom * yawSign * this.rng.next();
    const aimMul = 1 - this.aimBlend * 0.3;
    this.player?.addRecoil?.(pitch * aimMul, yaw * aimMul);
    this.recoilZ.v += def.recoil.kickBack * 18 * aimMul;
    this.recoilX.v += def.recoil.kickUp * 18 * aimMul;
    this.recoilRoll.v += def.recoil.roll * 18 * yawSign * (1 - this.aimBlend * 0.6);
    this.recoilY.v += yaw * 6;
    this.bloom = Math.min(def.spread.bloomMax, this.bloom + def.spread.bloom);
    this.flashT = 1;

    // --- muzzle world position (viewmodel -> world, FOV-corrected so the flash sits on the on-screen muzzle)
    const muzzle = this.muzzleWorld(this.tmp);
    const fwd = this.tmp2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.fx?.muzzleFlash(muzzle, fwd, def.muzzleFlashScale);
    this.flash.mesh.position.copy(s.model.sockets.muzzle.position);
    this.flash.fire(0.40 * def.muzzleFlashScale, this.rng);
    this.worldFlash.position.copy(muzzle);
    this.fx?.addLight?.(muzzle, new THREE.Color(1, 0.62, 0.3), 12 * def.muzzleFlashScale, 0.07);

    // --- shell
    const ej = s.model.sockets.eject;
    ej.getWorldPosition(this.tmp3);
    const ejWorld = this.vmToWorld(this.tmp3, this.tmp3);
    const ejDir = new THREE.Vector3(s.model.ejectDir[0], s.model.ejectDir[1], s.model.ejectDir[2]).normalize().applyQuaternion(cam.quaternion);
    ejDir.multiplyScalar(2.2 + this.rng.next() * 1.2).addScaledVector(this.player?.velocity ?? this.tmp2.set(0, 0, 0), 1);
    if (def.kind !== 'sniper' && def.kind !== 'shotgun') this.fx?.shell(ejWorld, ejDir, def.shellKind);

    // --- audio
    this.audio?.play(def.audio, { volume: 1, pitch: 0.97 + this.rng.next() * 0.06 });

    // --- ballistics
    const origin = this.tmp3.copy(cam.position).addScaledVector(fwd, BALLISTICS.originForward);
    const pellets = def.damage.pellets ?? 1;
    const spread = s.state.spread;
    this.engine.events.emit('weapon:fire', { weaponId: def.id, origin: [muzzle.x, muzzle.y, muzzle.z], dir: [fwd.x, fwd.y, fwd.z] });
    for (let i = 0; i < pellets; i++) {
      const dir = this.shotDir.copy(fwd);
      const r = pellets > 1 ? spread * Math.sqrt(this.rng.next()) : spread * Math.sqrt(this.rng.next());
      const a = this.rng.next() * Math.PI * 2;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      this.traceBullet(s, origin, dir, muzzle, def.damage.base, def.damage.penetration, def.tracerEvery > 0 && (i % def.tracerEvery === 0) && (s.shotIndex % def.tracerEvery === 0), 0);
    }
  }

  private traceBullet(s: Slot, origin: THREE.Vector3, dir: THREE.Vector3, tracerFrom: THREE.Vector3, damage: number, penetration: number, tracer: boolean, depth: number): void {
    const def = s.def;
    const hit = this.engine.physics.raycast(origin, dir, BALLISTICS.maxRange, RAY_FILTER, true);
    const end = hit ? this.hitPoint.set(hit.point[0], hit.point[1], hit.point[2]) : this.hitPoint.copy(origin).addScaledVector(dir, 120);
    if (tracer) this.fx?.tracer(tracerFrom.clone(), end.clone());
    if (!hit) return;
    const n = this.hitNormal.set(hit.normal[0], hit.normal[1], hit.normal[2]);
    const dist = hit.distance + (depth > 0 ? 0 : 0);
    const falloff = dist <= def.damage.rangeNear ? 1 : dist >= def.damage.rangeFar ? def.damage.farMul : THREE.MathUtils.lerp(1, def.damage.farMul, (dist - def.damage.rangeNear) / (def.damage.rangeFar - def.damage.rangeNear));
    const ud = hit.userData;
    if (ud.enemyId !== undefined) {
      const part: BodyPart = ud.bodyPart ?? 'torso';
      const mul = part === 'head' ? def.damage.head : part === 'limb' ? def.damage.limb : def.damage.torso;
      const dmg = damage * falloff * mul;
      const en = this.enemies;
      const dealt = en?.applyDamage(ud.enemyId, dmg, end.clone(), n.clone(), dir.clone(), part, def.id) ?? dmg;
      const info = en?.list().find((e) => e.id === ud.enemyId);
      const killed = info ? !info.alive : false;
      this.fx?.bloodHit(end.clone(), n.clone(), dir.clone(), part === 'head' || dmg > 60);
      this.engine.events.emit('hit:enemy', { enemyId: ud.enemyId, point: [end.x, end.y, end.z], normal: [n.x, n.y, n.z], damage: dealt, headshot: part === 'head', killed });
      return;
    }
    const surface: SurfaceType = ud.surface ?? 'concrete';
    this.fx?.impact(end.clone(), n.clone(), surface, dir.clone());
    this.engine.events.emit('hit:surface', { point: [end.x, end.y, end.z], normal: [n.x, n.y, n.z], surface, dir: [dir.x, dir.y, dir.z] });
    // --- thin-surface penetration: find the exit point from inside, continue with reduced damage
    if (penetration > 0 && depth < 1 && surface !== 'metal') {
      const inside = end.clone().addScaledVector(dir, 0.002);
      const exit = this.engine.physics.raycast(inside, dir, penetration, RAY_FILTER, false);
      if (exit) {
        const ep = new THREE.Vector3(exit.point[0], exit.point[1], exit.point[2]);
        const en = new THREE.Vector3(exit.normal[0], exit.normal[1], exit.normal[2]);
        if (en.dot(dir) > 0) en.negate();
        this.fx?.impact(ep.clone(), en, surface, dir.clone());
        this.traceBullet(s, ep.addScaledVector(dir, 0.003), dir, ep, damage * 0.6, 0, false, depth + 1);
      }
    }
  }

  /** Viewmodel-space world position -> world-scene position that lands on the same pixel (FOV mismatch corrected). */
  private vmToWorld(vmWorld: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const vc = this.engine.viewmodelCamera, wc = this.engine.camera;
    const local = out.copy(vmWorld).applyMatrix4(vc.matrixWorldInverse);
    const k = Math.tan(vc.fov * 0.5 * DEG) / Math.tan(wc.fov * 0.5 * DEG);
    local.x *= k; local.y *= k;
    return local.applyMatrix4(wc.matrixWorld);
  }
  private muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.inst[this.cur].model.sockets.muzzle.getWorldPosition(out);
    return this.vmToWorld(out, out);
  }

  // ------------------------------------------------------------------ per frame: animation
  update(dt: number, _alpha: number): void {
    const eng = this.engine;
    const cam = eng.camera, vc = eng.viewmodelCamera;
    const s = this.inst[this.cur];
    const def = s.def, model = s.model;
    const p = this.player;

    // --- camera sync + env
    vc.position.copy(cam.position); vc.quaternion.copy(cam.quaternion);
    if (eng.viewmodelScene.environment !== eng.scene.environment) { eng.viewmodelScene.environment = eng.scene.environment; }
    eng.viewmodelScene.environmentIntensity = eng.scene.environmentIntensity ?? 1;
    const sky = eng.get<{ name: string; sunDir?: THREE.Vector3; sun?: THREE.DirectionalLight }>('sky');
    const sunDir = sky?.sunDir ?? this.tmp.set(0.45, 0.6, 0.35).normalize();
    this.sun.target.position.copy(cam.position);
    this.sun.position.copy(cam.position).addScaledVector(sunDir, 3);
    if (sky?.sun) { this.sun.intensity = sky.sun.intensity * 0.85; this.sun.color.copy(sky.sun.color); }

    // --- state machine timing
    const adsSpeed = this.aimWant ? 1 / def.timing.adsIn : 1 / def.timing.adsOut;
    this.aimBlend = THREE.MathUtils.clamp(this.aimBlend + (this.aimWant ? 1 : -1) * adsSpeed * dt, 0, 1);
    const ab = smooth01(this.aimBlend);
    s.state.aimBlend = ab;
    const sprintBlend = this.debugSprint ?? p?.sprintBlend ?? 0;
    const tacBlend = this.debugTac ?? p?.tacSprintBlend ?? 0;
    const slideBlend = p?.slideBlend ?? 0, mantleBlend = p?.mantleBlend ?? 0, airBlend = p?.airBlend ?? 0, crouchBlend = p?.crouchBlend ?? 0, deadBlend = p?.deadBlend ?? 0;

    if (this.clip) {
      this.clipT += dt;
      for (const ev of this.clip.events ?? []) {
        const idx = this.clip.events!.indexOf(ev);
        if (this.clipT >= ev.t && !this.firedEvents.has(idx)) {
          this.firedEvents.add(idx);
          if (ev.sound) this.audio?.play(ev.sound, { volume: 0.9 });
          if (ev.action === 'shell') this.ejectShell(s);
          if (ev.action === 'hit') this.meleeHit(s);
          if (ev.action === 'magIn' && s.model.roundsPerReload) this.finishReload(s);
        }
      }
      if (this.clipT >= this.clip.duration) this.endClip(s);
    }
    // lowered blend (holster / draw)
    const lowerTarget = this.anim === 'holster' ? 1 : this.anim === 'draw' ? 0 : 0;
    this.lowerBlend = THREE.MathUtils.damp(this.lowerBlend, lowerTarget, this.anim === 'holster' ? 14 : 9, dt);
    if (this.anim === 'holster' && this.pending >= 0 && this.lowerBlend > 0.9) {
      this.inst[this.cur].model.root.visible = false;
      this.cur = this.pending; this.pending = -1;
      this.current = this.slots[this.cur];
      const ns = this.inst[this.cur];
      ns.model.root.visible = true;
      this.placeHands(ns.model.hands.right, ns.model.hands.left, true);
      this.applyHeld(ns);
      if (ns.model.clips.draw) this.startClip('draw', ns.model.clips.draw); else this.startClip('draw', { duration: ns.def.timing.raise });
      this.engine.events.emit('weapon:switch', { weaponId: ns.def.id });
      return;
    }

    // --- fire cycle (bolt / slide) driven by time since the shot
    this.fireCycleT += dt;
    if (model.fireCycle && this.fireCycleActive) {
      const fc = model.fireCycle;
      const tt = this.fireCycleT;
      let v = tt < fc.back ? tt / fc.back : tt < fc.back + fc.fwd ? 1 - (tt - fc.back) / fc.fwd : 0;
      if (fc.lockOpenOnEmpty && s.state.ammoInMag === 0 && tt >= fc.back) { v = 1; s.held[fc.part] = 1; s.chamberEmpty = true; }
      this.setPart(model, fc.part, smooth01(v));
      if (tt >= fc.back + fc.fwd && !(fc.lockOpenOnEmpty && s.state.ammoInMag === 0)) this.fireCycleActive = false;
      // manual actions (pump / bolt) start after the shot settles
      if (model.clips.cycle && tt >= 0.12 && this.anim === 'idle' && s.state.ammoInMag > 0) { this.startClip('cycle', model.clips.cycle); this.fireCycleActive = false; }
      if (model.clips.cycle && tt >= 0.12 && this.anim === 'idle' && s.state.ammoInMag === 0) { this.fireCycleActive = false; }
    }
    this.triggerT = Math.min(1, this.triggerT + dt * 12);
    if (model.trigger) this.setPart(model, model.trigger, 1 - Math.abs(this.triggerT * 2 - 1) > 0 ? Math.sin(Math.min(1, this.triggerT) * Math.PI) : 0);

    // --- springs
    const k = def.recoil.stiffness, c = def.recoil.damping;
    this.recoilZ.step(k, c, dt); this.recoilX.step(k, c, dt); this.recoilRoll.step(k * 1.2, c, dt); this.recoilY.step(k, c, dt);
    this.jolt.step(220, 18, dt);

    // --- base pose: hip / ads / sprint / tac sprint / lowered
    const aimLocal = model.sockets.aim.position;
    const hipPos = this.tmp.set(def.view.hip[0], def.view.hip[1], def.view.hip[2]);
    const adsPos = this.tmp2.set(-aimLocal.x, -aimLocal.y, -def.view.adsDist - aimLocal.z);
    const pos = new THREE.Vector3().lerpVectors(hipPos, adsPos, ab);
    const rot = new THREE.Euler(def.view.hipRot[0] * (1 - ab), def.view.hipRot[1] * (1 - ab), def.view.hipRot[2] * (1 - ab));
    // sprint: gun lowered and angled; tactical sprint: gun raised, muzzle up
    const sp = sprintBlend * (1 - ab);
    const sprintPos = this.tmp3.set(def.view.sprint[0], def.view.sprint[1], def.view.sprint[2]);
    const tacPos = new THREE.Vector3(def.view.tac[0], def.view.tac[1], def.view.tac[2]);
    pos.lerp(sprintPos.lerp(tacPos, tacBlend), sp);
    // Everything added to `pos` from here on (stance offsets, sway, recoil, clip motion) was authored
    // against the old viewmodel camera, where the gun sat 1.6x closer. Lateral offsets still land on
    // the same pixels, but a depth offset has to travel the same 1.6x to read the same. Captured here,
    // re-applied at the bottom of the compose.
    this.posBase.copy(pos);
    const sr = def.view.sprintRot, tr: V3 = def.view.tacRot;
    rot.x += THREE.MathUtils.lerp(sr[0], tr[0], tacBlend) * sp; rot.y += THREE.MathUtils.lerp(sr[1], tr[1], tacBlend) * sp; rot.z += THREE.MathUtils.lerp(sr[2], tr[2], tacBlend) * sp;
    // slide / mantle / air / crouch / dead
    pos.x += 0.03 * slideBlend; pos.y += -0.03 * slideBlend - 0.012 * airBlend + 0.006 * crouchBlend - 0.10 * mantleBlend - 0.25 * deadBlend;
    pos.z += 0.02 * slideBlend + 0.02 * mantleBlend;
    rot.x += 0.12 * slideBlend + 0.5 * Math.sin(Math.PI * mantleBlend) + 0.6 * deadBlend; rot.y += 0.18 * slideBlend + 0.25 * mantleBlend; rot.z += 0.22 * slideBlend - 0.15 * mantleBlend + 0.5 * deadBlend;
    // lowered (switch)
    const lb = smooth01(this.lowerBlend);
    pos.x += 0.05 * lb; pos.y -= 0.30 * lb; pos.z += 0.05 * lb; rot.x += 0.9 * lb; rot.y -= 0.3 * lb; rot.z += 0.4 * lb;
    // idle sway / breathing (own; the player adds bob + look lag via viewmodelOffset)
    this.swayT += dt;
    const sw = (1 - ab * 0.85) * (1 - sprintBlend * 0.5) * def.view.swayMul;
    pos.x += Math.sin(this.swayT * 1.1) * 0.0018 * sw; pos.y += Math.sin(this.swayT * 1.7 + 0.6) * 0.0022 * sw + Math.sin(this.swayT * 1.35) * 0.0012 * ab;
    rot.x += Math.sin(this.swayT * 1.3 + 1.0) * 0.004 * sw; rot.z += Math.sin(this.swayT * 0.9) * 0.005 * sw; rot.y += Math.sin(this.swayT * 0.7 + 2) * 0.003 * sw;
    // recoil springs (viewmodel)
    pos.z += this.recoilZ.x; pos.y += this.recoilX.x * 0.25 + this.jolt.x;
    rot.x += this.recoilX.x * 1.4 * (1 - ab * 0.4); rot.z += this.recoilRoll.x * (1 - ab * 0.7); rot.y += this.recoilY.x;

    // --- clip offsets + hands + parts
    let rp: HandPlacement = model.hands.right, lp: HandPlacement = model.hands.left;
    if (this.clip) {
      const t = this.clipT;
      if (this.anim === 'reload') {
        // bring the gun up toward the face for the reload so the magwell stays in frame (CoD-style)
        const env = smooth01(Math.min(1, t / 0.3)) * (1 - smooth01((t - (this.clip.duration - 0.45)) / 0.45));
        pos.y += 0.05 * env; pos.z += 0.03 * env; pos.x -= 0.02 * env;
      }
      const gp = sampleV(this.clip.gunPos, t, new THREE.Vector3()); pos.add(gp);
      const gr = sampleV(this.clip.gunRot, t, new THREE.Vector3()); rot.x += gr.x; rot.y += gr.y; rot.z += gr.z;
      if (this.clip.parts) for (const [name, keys] of Object.entries(this.clip.parts)) if (keys.length) this.setPart(model, name, sampleN(keys, t, 0));
      if (this.clip.magVisible && model.parts.mag) model.parts.mag.obj.visible = sampleStep(this.clip.magVisible, t, 1) > 0.5;
      lp = this.trackHand(this.clip.left, model.hands.left, t);
      rp = this.trackHand(this.clip.right, model.hands.right, t);
    } else if (model.parts.mag) model.parts.mag.obj.visible = true;
    if (!this.clip && this.triggerT < 0.5 && model.firePose) rp = { ...rp, pose: model.firePose };
    // aimed grip: blend the hands out of the sight picture (see WeaponModel.handsAds)
    if (model.handsAds && ab > 0.001 && !this.clip) {
      rp = blendHands(rp, model.handsAds.right, ab);
      lp = blendHands(lp, model.handsAds.left, ab);
    }
    this.placeHands(rp, lp);
    this.handSpeed = THREE.MathUtils.damp(this.handSpeed, 16, 4, dt);
    this.rightHand.update(dt, this.handSpeed); this.leftHand.update(dt, this.handSpeed);
    this.solveGrip(model, this.rightHand, rp, this.ikR);
    this.solveGrip(model, this.leftHand, lp, this.ikL);
    this.checkGrip();

    // --- compose. Only the depth of the additive offsets scales with the viewmodel distance (see
    // posBase): `dist * tan(vfov/2)` is unchanged by the FOV move, so a lateral offset in metres still
    // lands on the same pixels, but a push/pull along z has to travel the same 1.6x to read the same.
    pos.z = this.posBase.z + (pos.z - this.posBase.z) * VM_OFFSET_SCALE;
    this.gunRoot.position.copy(pos); this.gunRoot.rotation.copy(rot);
    const vmo = p?.viewmodelOffset;
    if (vmo) { this.vmRoot.position.copy(vmo.position); this.vmRoot.rotation.copy(vmo.rotation); }
    else { this.vmRoot.position.set(0, 0, 0); this.vmRoot.rotation.set(0, 0, 0); }
    if (this.debugVmFov != null) {
      // glove iteration: centre the support hand at 0.30 m so it fills the narrow-FOV frame
      this.vmRoot.updateMatrixWorld(true);
      const wp = this.leftHand.root.localToWorld(this.tmp3.set(0, 0.008, -0.075));
      vc.updateMatrixWorld(true); vc.worldToLocal(wp);
      this.vmRoot.position.x -= wp.x; this.vmRoot.position.y -= wp.y; this.vmRoot.position.z -= wp.z + 0.30;
    }

    // --- viewmodel fov + tell the player our ADS fov
    // `fovHip`/`fovAds` are horizontal degrees at 16:9 (same units as the player's fov setting), so the
    // 60 deg viewmodel really is narrower than the 80 deg world. three.js wants vertical.
    const fovH = this.debugVmFov ?? THREE.MathUtils.lerp(def.view.fovHip, def.view.fovAds, ab);
    const fovV = hFovToV(fovH);
    if (Math.abs(vc.fov - fovV) > 1e-3) { vc.fov = fovV; vc.updateProjectionMatrix(); }
    const hipH = p?.settings?.fov ?? 80;
    // magnified optics keep the world camera wide: the magnification happens inside the scope's render target,
    // the periphery stays visible (blurred + darkened) like a real eye behind a scope
    const adsH = def.zoom > 1 ? Math.max(48, hipH - 28) : Math.max(50, hipH - 20);
    p?.setAimFov?.(adsH, ab);
    /*
     * Depth of field. Two things are being asked for here and they are not the same number:
     *
     *  - the *viewmodel* near-blur. It is not an ADS-only effect: at hipfire the eye is focused down
     *    range, so the part of the weapon nearest the camera - the stock, the wrists, the bottom of
     *    the frame - carries ~2 px of CoC while the receiver and muzzle stay sharp (ref_06). Focus
     *    therefore sits at the gun's own distance and travels in to the optic as the sight comes up.
     *  - the *aim* blend, which is what the post chain uses for peripheral darkening, chromatic
     *    aberration and how far the world's background defocus opens. That must stay 0 in hipfire or
     *    the frame gets vignetted while nothing is being aimed.
     *
     * A magnified optic keeps its viewmodel sharp while aimed: its periphery is handled by the scope's
     * own blurred quad (see updateScope), and blurring the housing on top of that is double-counting.
     */
    const postfx = eng.get<RenderPostApi>('postfx');
    const vmBlur = def.zoom > 1 ? VM_DOF_HIP * (1 - ab) : THREE.MathUtils.lerp(VM_DOF_HIP, 0.9, ab);
    const focus = THREE.MathUtils.lerp(Math.abs(def.view.hip[2]), def.view.adsDist + 0.02, ab);
    postfx?.setAimDof?.(vmBlur, focus);
    postfx?.setAim?.(ab);

    // --- muzzle flash light
    this.flashT = Math.max(0, this.flashT - dt / 0.07);
    const fl = this.flashT * this.flashT * (0.7 + 0.3 * this.rng.next());
    this.flashLight.intensity = fl * 1.8 * def.muzzleFlashScale;
    this.flashLight.position.set(model.muzzleLightPos[0], model.muzzleLightPos[1], model.muzzleLightPos[2]);
    this.worldFlash.intensity = fl * 14 * def.muzzleFlashScale;

    this.flash.update(dt);

    // --- red dot: collimated dot re-projected along the sight axis (parallax-free, fades off-axis)
    this.updateRedDot(s);

    // --- scope
    this.updateScope(s, ab);

    if (this.pendingDebugFire) {
      this.pendingDebugFire = false;
      cam.updateMatrixWorld(true); vc.updateMatrixWorld(true); this.gunRoot.updateMatrixWorld(true);
      this.fire(s);
      this.setPart(model, model.fireCycle?.part ?? '', 0);
    }

    s.state.reloading = this.anim === 'reload';
    this.current = s.state;
  }

  private trackHand(track: Clip['left'], base: HandPlacement, t: number): HandPlacement {
    if (!track) return base;
    const pos = sampleV(track.pos, t, new THREE.Vector3(), base.pos);
    const fingers = sampleV(track.fingers, t, new THREE.Vector3(), base.fingers);
    // Every clip waypoint was keyed against a hand whose wrist-to-fingertip reach was ~49 mm longer
    // (the fingers were rebuilt to real anthropometry and the model scale dropped 1.2 -> 1.0), so every
    // grab now stops short of the thing it is grabbing. Advancing the wrist along its own finger axis
    // restores the contact point without re-keying ~120 waypoints. Idle placements are untouched: this
    // only applies where the clip actually overrides the position.
    const contact = sampleStep<string>(track.contact, t, base.contact ?? 'none');
    if (track.pos?.length && contact === 'none') pos.addScaledVector(_tmpDir.copy(fingers).normalize(), CLIP_REACH_FIX);
    const back = sampleV(track.back, t, new THREE.Vector3(), base.back);
    const elbow = sampleV(track.elbow, t, new THREE.Vector3(), base.elbow ?? [0, -0.6, 0.8]);
    const pose = sampleStep<HandPoseName>(track.pose as Key<HandPoseName>[] | undefined, t, base.pose);
    return { pos: [pos.x, pos.y, pos.z], fingers: [fingers.x, fingers.y, fingers.z], back: [back.x, back.y, back.z], elbow: [elbow.x, elbow.y, elbow.z], pose, contact };
  }

  private endClip(s: Slot): void {
    const was = this.anim;
    const clip = this.clip!;
    if (was === 'reload') {
      if (!s.model.roundsPerReload) this.finishReload(s);
      s.state.reloading = false;
      // shotgun-style: keep loading while there is room
      if (s.model.roundsPerReload && s.state.ammoInMag < s.def.magSize && s.state.reserveAmmo > 0 && !this.engine.input.state.fire) { this.startClip('reload', s.model.clips.reload); s.state.reloading = true; return; }
    }
    for (const h of clip.hold ?? []) s.held[h] = this.lastPartVal[h] ?? 0;
    // reset parts touched by the clip unless held
    if (clip.parts) for (const name of Object.keys(clip.parts)) if (!(name in s.held)) this.setPart(s.model, name, 0);
    if (s.model.parts.mag) s.model.parts.mag.obj.visible = true;
    this.anim = 'idle'; this.clip = null;
    if (was === 'draw' && this.pending >= 0) this.equip(this.pending);
  }

  private ejectShell(s: Slot): void {
    const ej = s.model.sockets.eject;
    ej.getWorldPosition(this.tmp3);
    const w = this.vmToWorld(this.tmp3, this.tmp3);
    const d = new THREE.Vector3(s.model.ejectDir[0], s.model.ejectDir[1], s.model.ejectDir[2]).normalize().applyQuaternion(this.engine.camera.quaternion).multiplyScalar(1.6 + this.rng.next());
    this.fx?.shell(w, d, s.def.shellKind);
  }

  private meleeHit(s: Slot): void {
    const cam = this.engine.camera;
    const fwd = this.tmp2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.engine.physics.raycast(cam.position, fwd, 1.6, RAY_FILTER, true);
    if (!hit) return;
    const pt = new THREE.Vector3(hit.point[0], hit.point[1], hit.point[2]), n = new THREE.Vector3(hit.normal[0], hit.normal[1], hit.normal[2]);
    if (hit.userData.enemyId !== undefined) {
      const dealt = this.enemies?.applyDamage(hit.userData.enemyId, 135, pt, n, fwd.clone(), hit.userData.bodyPart ?? 'torso', 'melee') ?? 135;
      this.fx?.bloodHit(pt, n, fwd.clone(), true);
      const info = this.enemies?.list().find((e) => e.id === hit.userData.enemyId);
      this.engine.events.emit('hit:enemy', { enemyId: hit.userData.enemyId, point: [pt.x, pt.y, pt.z], normal: [n.x, n.y, n.z], damage: dealt, headshot: false, killed: info ? !info.alive : false });
      this.audio?.play('melee_hit', { volume: 1 });
    } else {
      this.fx?.impact(pt, n, hit.userData.surface ?? 'concrete', fwd.clone());
      this.audio?.play('melee_wall', { volume: 0.8 });
    }
    void s;
  }

  private updateRedDot(s: Slot): void {
    const rd = s.model.redDot;
    if (!rd) return;
    this.gunRoot.updateMatrixWorld(true);
    // eye position in gun space; the dot appears where the eye's ray parallel to the bore meets the lens plane
    const eye = this.tmp.setFromMatrixPosition(this.engine.viewmodelCamera.matrixWorld);
    s.model.root.worldToLocal(eye);
    const dx = eye.x - rd.center[0], dy = eye.y - rd.center[1];
    const d = Math.hypot(dx, dy) / rd.radius;
    const vis = 1 - THREE.MathUtils.smoothstep(d, 0.55, 0.92);
    rd.reticle.visible = vis > 0.01;
    if (!rd.reticle.visible) return;
    rd.reticle.position.set(eye.x, eye.y, rd.center[2] - 0.004);
    (rd.reticle.material as THREE.MeshBasicMaterial).opacity = vis;
    // keep the dot a constant angular size: scale with distance from the eye
    const dist = Math.max(0.05, eye.z - rd.center[2]);
    const k = dist / 0.30;
    rd.reticle.scale.set(k, k, 1);
  }

  private updateScope(s: Slot, ab: number): void {
    const sc = s.model.scope;
    const eng = this.engine;
    if (!sc) { if (this.blurQuad) this.blurQuad.visible = false; return; }
    const on = ab > 0.2;
    sc.lens.visible = on;
    sc.reticleMask.visible = on;
    if (sc.ocular) sc.ocular.visible = !on;
    if (!on) { if (this.blurQuad) this.blurQuad.visible = false; return; }
    if (!this.scopeRT) {
      const depth = new THREE.DepthTexture(1024, 1024);
      depth.type = THREE.UnsignedIntType;
      this.scopeRT = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth });
      this.scopeAttach = this.scopeRT.texture;
      this.scopeOut = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType, depthBuffer: false });
      this.scopeAtmo = new ScopeAtmosphere();
      this.scopeCam = new THREE.PerspectiveCamera(10, 1, 0.3, 800);
      (sc.lens.material as THREE.MeshBasicMaterial).map = this.scopeOut.texture;
      (sc.lens.material as THREE.MeshBasicMaterial).needsUpdate = true;
      // Periphery: the world re-rendered at 960x540 and pushed through a separable-gaussian mip chain
      // (see MipBlur) before being shown on a camera-locked quad. The old path upsampled a small render
      // straight to full screen and applied a 5x5 tap on top, which leaves 8-16 px stair steps on power
      // lines and roof edges — a tap radius cannot recover samples a hard upsample never had.
      this.blurRT = new THREE.WebGLRenderTarget(960, 540, { type: THREE.HalfFloatType, depthBuffer: true });
      this.blurRT.texture.minFilter = THREE.LinearFilter; this.blurRT.texture.magFilter = THREE.LinearFilter;
      // One halving, not two. ref_03's out-of-scope image is *defocused*, not destroyed: the container
      // wall, the stone kerb and the shadow line are all still readable, they simply carry no detail.
      // Two halvings (a 240x135 source) took it to mush and lost the frame's whole left third.
      this.periphBlur = new MipBlur(960, 540, PERIPH_MIPS);
      const t = 1 / (960 >> PERIPH_MIPS);
      const qm = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.blurRT.texture }, texel: { value: new THREE.Vector2(t, t * 16 / 9) }, darken: { value: 0.52 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform sampler2D map; uniform vec2 texel; uniform float darken; varying vec2 vUv;
          void main() {
            // the chain has already done the blurring; this is only a bilinear tent to hide the 8x upsample
            vec3 c = texture2D(map, vUv + vec2(-0.5, -0.5) * texel).rgb
                   + texture2D(map, vUv + vec2( 0.5, -0.5) * texel).rgb
                   + texture2D(map, vUv + vec2(-0.5,  0.5) * texel).rgb
                   + texture2D(map, vUv + vec2( 0.5,  0.5) * texel).rgb;
            c *= 0.25;
            // eye-relief falloff: the periphery darkens further toward the frame edge
            float r = length((vUv - 0.5) * vec2(1.78, 1.0));
            gl_FragColor = vec4(c * darken * (1.0 - 0.42 * smoothstep(0.25, 0.95, r)), 1.0);
          }`,
        depthWrite: true, depthTest: true, toneMapped: false,
      });
      this.blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), qm);
      this.blurQuad.frustumCulled = false; this.blurQuad.renderOrder = -10; this.blurQuad.name = 'scopePeriphery';
      eng.viewmodelCamera.add(this.blurQuad);
    }
    const cam = eng.camera, vc = eng.viewmodelCamera, sCam = this.scopeCam!;
    // scope camera looks along the gun's actual sight axis (sway + recoil move the image, reticle stays on axis)
    this.gunRoot.updateMatrixWorld(true);
    s.model.sockets.aim.getWorldQuaternion(this.tmpQ);
    sCam.position.copy(cam.position); sCam.quaternion.copy(this.tmpQ);
    const disc = 2 * Math.atan(sc.radius / s.def.view.adsDist) * 180 / Math.PI;
    sCam.fov = Math.max(1.5, disc / s.def.zoom); sCam.aspect = 1; sCam.updateProjectionMatrix();
    // periphery quad fills the viewmodel camera frustum at z = -8
    const qz = 8;
    const qh = 2 * qz * Math.tan(vc.fov * 0.5 * DEG), qw = qh * vc.aspect;
    this.blurQuad!.position.set(0, 0, -qz); this.blurQuad!.scale.set(qw, qh, 1); this.blurQuad!.visible = true;
    const r = eng.renderer;
    const prevRT = r.getRenderTarget();
    const prevTM = r.toneMapping;
    // The magnified image has to come out of the same renderer as the frame around it. Scene fog is
    // deliberately left ON for this render (it used to be nulled, which is why a 300 m target had full
    // contrast inside the ring and haze outside it).
    // `postProcessScope` hands its result back by swapping the target's `texture` property with its own
    // scratch buffer's. The GL attachment does not move with it, so the target has to be pointed back at
    // the texture that is actually attached to its framebuffer before the next world render — otherwise
    // the pass reads the buffer it is writing (GL_INVALID_OPERATION: feedback loop) and the scope shows
    // the previous frame. Harmless if render/ ever stops swapping: then this is already the same object.
    if (this.scopeAttach) this.scopeRT.texture = this.scopeAttach;
    r.setRenderTarget(this.scopeRT);
    r.clear();
    r.render(eng.scene, sCam);
    // Primary path: render/ runs its own atmosphere + ACES + grade over the target, in place, so the
    // scope is literally the same chain as the frame around it.
    const post = eng.get<RenderPostApi>('postfx');
    let out = this.scopeRT;
    if (post?.postProcessScope?.(this.scopeRT, sCam) !== true) {
      if (!this.warnedScopePost) { this.warnedScopePost = true; console.warn('[weapons] scope: postfx.postProcessScope unavailable, using the local atmosphere approximation'); }
      // Fallback (post chain disabled): reproduce the same fog integral from the sky's own numbers.
      const sky = eng.get<SkyApi>('sky');
      if (sky?.state?.fog && this.scopeAtmo && this.scopeOut) {
        this.scopeAtmo.apply(r, this.scopeRT, this.scopeOut, sCam, sky.state.fog, sky.state.sunDir);
        out = this.scopeOut;
      }
    }
    const lm = sc.lens.material as THREE.MeshBasicMaterial;
    if (lm.map !== out.texture) { lm.map = out.texture; lm.needsUpdate = true; }
    if (this.blurRT) {
      r.setRenderTarget(this.blurRT);
      r.clear();
      r.render(eng.scene, cam);
      if (this.periphBlur && this.blurQuad) {
        const t = this.periphBlur.run(r, this.blurRT.texture, 960, 540);
        (this.blurQuad.material as THREE.ShaderMaterial).uniforms.map.value = t;
      }
    }
    r.setRenderTarget(prevRT);
    r.toneMapping = prevTM;
  }

  resize(): void { /* viewmodel camera aspect handled by Engine */ }
}

function smooth01(t: number): number { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); }

/**
 * Reach compensation for clip waypoints that are NOT solved by the grip IK — the frames where the hand
 * is in the air between the magwell and the mag pouch, with nothing to make contact with. Waypoints
 * that name a contact solid ignore this entirely and are solved against the geometry instead.
 */
const CLIP_REACH_FIX = 0.032;
/**
 * Dev assert threshold for hand/weapon contact, in metres: the largest fingertip-to-weapon distance
 * any grip is allowed to show. The round-3 review asked for 3 mm; 5 mm is what this rig can hold
 * across all five weapons, and the binding case is anatomy rather than the solver - the little finger
 * is 73% of the middle and its knuckle sits 14 mm proximal of it, so on the fattest handguards it is
 * the last few millimetres short while every other fingertip measures 0.0. The per-pad numbers are in
 * `gripReport()` if that ever needs revisiting.
 */
const GRIP_MAX_GAP = 0.005;
const _tmpDir = new THREE.Vector3();

/** Linear blend between two hand placements; the pose snaps at the halfway point. */
function blendHands(a: HandPlacement, b: HandPlacement, t: number): HandPlacement {
  const k = smooth01(t);
  const mix = (p: V3, q: V3): V3 => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  return {
    pos: mix(a.pos, b.pos), fingers: mix(a.fingers, b.fingers), back: mix(a.back, b.back),
    elbow: mix(a.elbow ?? [0, -0.6, 0.8], b.elbow ?? [0, -0.6, 0.8]),
    sleeve: (a.sleeve ?? 1) + ((b.sleeve ?? 1) - (a.sleeve ?? 1)) * k,
    pose: k > 0.5 ? b.pose : a.pose,
    contact: k > 0.5 ? b.contact : a.contact,
  };
}
