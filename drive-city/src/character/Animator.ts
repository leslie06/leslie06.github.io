import * as THREE from 'three';
import { ANKLE_H, BALL, BIND_ROT, HEEL, J, JOINT_COUNT, LOOK_FLOATS, SHIN, SKELETON, THIGH, lookScale, packLook, type Look } from './Body';

export type Action = 'move' | 'air' | 'knocked' | 'down' | 'getup' | 'punch';

/** What drives a pose this frame. */
export interface Motion {
  /** Ground speed, m/s (the gait follows it: idle, walk, jog, sprint). */
  speed: number;
  action: Action;
  /** Seconds in the current action (knocked / down / getup; air: seconds airborne). */
  t: number;
  /** Tumble axis for `knocked` (character-local, horizontal): extra roll rate, rad/s. */
  tumble?: number;
}

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const bez = (a: number, b: number, c: number, d: number, t: number) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
const PELVIS_Y = SKELETON[J.pelvis].offset[1];
const LEG_MAX = (THIGH + SHIN) * 0.995;
/** Pelvis height above the ground when lying on the back. */
const LIE_Y = 0.12;

interface Foot { x: number; y: number; z: number; pitch: number; stance: number }
const footL: Foot = { x: 0, y: 0, z: 0, pitch: 0, stance: 0 }, footR: Foot = { x: 0, y: 0, z: 0, pitch: 0, stance: 0 };
const idleL: Foot = { x: 0, y: 0, z: 0, pitch: 0, stance: 1 }, idleR: Foot = { x: 0, y: 0, z: 0, pitch: 0, stance: 1 };
const ARM = new Float32Array(10);
/** Getup keyframes: [time 0..1, pelvis pitch, drop, forward]. */
const GETUP_K = [[0, -Math.PI / 2, PELVIS_Y - LIE_Y, -0.45], [0.3, -0.35, PELVIS_Y - LIE_Y - 0.02, -0.4], [0.62, 0.55, 0.52, -0.08], [1, 0.03, 0, 0]];

function blendFoot(g: Foot, i: Foot, moving: number): void {
  g.x = mix(i.x, g.x, moving); g.y = mix(i.y, g.y, moving); g.z = mix(i.z, g.z, moving); g.pitch = mix(i.pitch, g.pitch, moving); g.stance = mix(1, g.stance, moving);
}
function setArm(s: number, x: number, y: number, z: number, e: number, wr: number, t: number): void {
  const o = s * 5;
  ARM[o] = mix(ARM[o], x, t); ARM[o + 1] = mix(ARM[o + 1], y, t); ARM[o + 2] = mix(ARM[o + 2], z, t); ARM[o + 3] = mix(ARM[o + 3], e, t); ARM[o + 4] = mix(ARM[o + 4], wr, t);
}
/** Stance: ankle over a world-fixed contact point (heel rocker, flat, ball rocker). */
function stanceAt(q: number, sig: number, stride: number, c0: number, s1: number, s2: number, th0: number, gam: number, o: Foot): void {
  const s = q / sig, c = c0 - stride * q;
  if (s < s1) {
    const th = th0 * (1 - s / s1) ** 2;
    o.z = c + HEEL * Math.cos(th) - ANKLE_H * Math.sin(th); o.y = HEEL * Math.sin(th) + ANKLE_H * Math.cos(th); o.pitch = th;
  } else if (s < s2) {
    o.z = c + HEEL; o.y = ANKLE_H; o.pitch = 0;
  } else {
    const th = -gam * ((s - s2) / (1 - s2)) ** 1.6, b = c + HEEL + BALL;
    o.z = b - BALL * Math.cos(th) - ANKLE_H * Math.sin(th); o.y = -BALL * Math.sin(th) + ANKLE_H * Math.cos(th); o.pitch = th;
  }
}

/**
 * Procedural body animation for one person.
 *
 * Locomotion is foot-driven: each foot follows a stance/swing cycle whose phase advances by
 * distance over stride length, so during stance the foot's contact point (heel, then the whole
 * sole, then the ball: foot roll) moves backwards exactly as fast as the body moves forwards - it
 * stays planted. The legs reach those targets by two-bone IK from a pelvis that bobs, sways over
 * the stance leg, drops on the swing side and twists against the shoulders; the pelvis is lowered
 * whenever a planted foot would be out of reach. Arms counter-swing (elbows fold for running),
 * the body leans with speed, the head stays level.
 *
 * Standing still blends into an idle: weight shifts from leg to leg, breathing, looking around,
 * and after a few seconds a per-person habit (phone, arms crossed, hands behind the back or in
 * pockets). Reactions (knocked flying, lying hurt, getting up) are posed curves; action changes
 * cross-fade over 0.2 s.
 *
 * Angles are Euler per joint: pelvis YXZ (x pitch forward, y yaw, z roll), limbs ZXY (x flexion:
 * + swings the limb back / bends the knee / points the toes down, z abduction: + to the
 * character's left, y twist about the bone). All distances canonical (1.75 m person).
 */
export class Gait {
  /** Cycle phase 0..1: left heel strike at 0, right at 0.5. */
  phase = 0;
  /** Local joint rotations: rot[j*3 + 0..2] = x, y, z. */
  readonly rot = new Float32Array(JOINT_COUNT * 3);
  /** Pelvis offsets (canonical metres): sideways, up (negative = lower), forward; `drop` lowers it too (reactions). */
  sway = 0; bob = 0; fwd = 0; drop = 0;
  /** Held prop this frame (1: phone in the right hand). */
  prop = 0;
  /** The look this gait was last drawn with, packed for the GPU (Crowd keeps these in sync). */
  look: Look | null = null;
  readonly pack = new Float32Array(LOOK_FLOATS);
  scale = 1; fem = 0; age = 0.3; build = 0;
  /** Drawn with the far LOD (Crowd's hysteresis state). */
  lodFar = false;

  private seed = -1;
  private time = 0;
  private still = 0;
  private action: Action = 'move';
  private fade = 0;
  private readonly from = new Float32Array(JOINT_COUNT * 3 + 4);
  private rng = 1;
  private idleKind = 0; private armStyle = 1; private cadStyle = 1; private posture = 0; private toeOut = 0.06; private phoneWalk = false; private hipStyle = 1;
  private weight = 0; private weightT = 1; private weightTimer = 3;
  private lookYaw = 0; private lookYawT = 0; private lookPitchT = 0; private lookPitch = 0; private lookTimer = 1;
  private readonly pm = new Float64Array(9);
  private px = 0; private py = 0; private pz = 0;

  /** Adopt a look: body proportions for the gait, and the packed colours for the crowd. */
  bindLook(look: Look): void {
    this.look = look;
    packLook(look, this.pack, 0);
    this.scale = lookScale(look);
    this.fem = look.fem ?? 0; this.age = look.age ?? 0.3; this.build = look.build ?? 0;
  }

  private rand(): number { this.rng = (this.rng * 16807) % 2147483647; return (this.rng - 1) / 2147483646; }

  private setSeed(seed: number): void {
    this.seed = seed;
    const h = (k: number) => { const s = Math.sin((seed + 1.37) * (12.9898 + k * 7.13)) * 43758.5453; return s - Math.floor(s); };
    const k = h(1);
    this.idleKind = k < 0.36 ? 0 : k < 0.6 ? 1 : k < 0.72 ? 2 : k < 0.82 ? 3 : 4;
    this.armStyle = 0.75 + 0.5 * h(2);
    this.cadStyle = 0.95 + 0.1 * h(3);
    this.posture = (h(4) - 0.35) * 0.07;
    this.toeOut = 0.03 + 0.09 * h(5);
    this.phoneWalk = h(6) < 0.13;
    this.hipStyle = 0.8 + 0.4 * h(7);
    this.rng = Math.floor(h(8) * 2147483645) + 1;
    this.weightT = h(9) < 0.5 ? 1 : -1; this.weightTimer = 1 + 4 * h(10);
    this.lookTimer = h(11) * 3; this.phase = h(12);
  }

  update(m: Motion, dt: number, seed: number): void {
    if (seed !== this.seed) this.setSeed(seed);
    this.time += dt;
    if (m.action !== this.action) {
      this.from.set(this.rot); this.from[JOINT_COUNT * 3] = this.sway; this.from[JOINT_COUNT * 3 + 1] = this.bob; this.from[JOINT_COUNT * 3 + 2] = this.fwd; this.from[JOINT_COUNT * 3 + 3] = this.drop;
      this.fade = 1; this.action = m.action;
    }
    this.rot.fill(0);
    this.sway = 0; this.bob = 0; this.fwd = 0; this.drop = 0; this.prop = 0;
    if (m.action === 'knocked') this.knocked(m.t, m.tumble ?? 0);
    else if (m.action === 'down') this.down(m.t);
    else if (m.action === 'getup') this.getup(m.t);
    else if (m.action === 'air') this.air(m.t);
    else if (m.action === 'punch') { this.locomotion(m.speed, dt); this.shoveArm(m.t); }
    else this.locomotion(m.speed, dt);
    if (this.fade > 0) {
      const k = this.fade * this.fade * (3 - 2 * this.fade);
      const r = this.rot, f = this.from, n = JOINT_COUNT * 3;
      for (let i = 0; i < n; i++) r[i] = mix(r[i], f[i], k);
      this.sway = mix(this.sway, f[n], k); this.bob = mix(this.bob, f[n + 1], k); this.fwd = mix(this.fwd, f[n + 2], k); this.drop = mix(this.drop, f[n + 3], k);
      this.fade = Math.max(0, this.fade - dt / 0.22);
    }
  }

  // ---------------------------------------------------------------- locomotion and idle

  private locomotion(v: number, dt: number): void {
    const r = this.rot, fem = this.fem, old = sstep(0.6, 1, this.age);
    const vc = v / this.scale;
    const run = sstep(2.3, 3.3, vc), sprint = sstep(4.6, 6.0, vc);
    const cad = mix(0.62 + 0.26 * Math.min(vc, 2.6), 1.25 + 0.11 * vc, run) * this.cadStyle * (1 - 0.1 * old);
    const stride = Math.max(0.05, vc / cad);
    this.phase = (this.phase + (vc * dt) / stride) % 1;
    const moving = sstep(0.03, 0.3, vc);
    this.still = moving > 0.05 ? 0 : this.still + dt;
    const sig = mix(0.62, 0.4, run) - 0.07 * sprint;
    const p = this.phase;

    // Pelvis over the stance leg, dropping on the swing side, twisting with the swinging leg.
    const mid = TAU * (p - sig / 2 + 0.25);
    const yawA = (0.07 + 0.03 * run + 0.05 * sprint + 0.025 * fem) * this.hipStyle * moving;
    const rollA = (0.04 + 0.035 * fem) * (1 - 0.35 * run) * moving;
    const swayA = (0.02 + 0.014 * fem) * (1 - 0.7 * run) * moving;
    let yaw = -yawA * Math.cos(TAU * p), roll = rollA * Math.sin(mid), sway = swayA * Math.sin(mid);
    let pitch = (0.03 + 0.08 * run + 0.13 * sprint) * moving + this.posture + 0.04 * old;
    const bobW = -0.03 * (1 - Math.cos(2 * TAU * (p - sig / 2))) / 2;
    const bobR = -(0.045 + 0.025 * sprint) * (1 + Math.cos(2 * TAU * (p - sig / 2))) / 2;
    let bob = (mix(bobW, bobR, run) - 0.02 * run - 0.03 * sprint) * moving;

    // Feet: gait cycle, and the idle stance with its weight shift.
    const width = 0.072 - 0.025 * run - 0.022 * fem;
    this.foot(p, sig, stride, run, sprint, footL); footL.x = width;
    this.foot((p + 0.5) % 1, sig, stride, run, sprint, footR); footR.x = -width;
    this.idle(dt, moving);
    const w = this.weight * (1 - moving);
    blendFoot(footL, idleL, moving); blendFoot(footR, idleR, moving);
    sway += 0.032 * w; roll += 0.055 * w; yaw += 0.06 * w; bob -= (0.012 + 0.012 * Math.abs(w)) * (1 - moving);

    // Keep planted feet in reach: lower the pelvis where a planted foot would be out of reach.
    r[0] = pitch; r[1] = yaw; r[2] = roll;
    this.sway = sway; this.fwd = 0; this.bob = bob;
    this.setPelvis();
    let py = this.reach(footL, 1, this.py);
    py = this.reach(footR, -1, py);
    this.bob = py - PELVIS_Y;
    this.setPelvis();
    this.solveLeg(1, footL, pitch, roll, yaw);
    this.solveLeg(-1, footR, pitch, roll, yaw);

    // Spine twists against the hips, rights the roll; head stays level and looks around.
    const cp = Math.cos(TAU * p);
    r[J.spine * 3] = 0.02 + 0.04 * run * moving - 0.5 * this.posture;
    r[J.spine * 3 + 1] = 0.35 * yawA * cp;
    r[J.spine * 3 + 2] = -0.5 * roll;
    r[J.chest * 3] = 0.01 + 0.03 * run * moving;
    r[J.chest * 3 + 1] = (0.85 + 0.45 * run) * yawA * cp;
    r[J.chest * 3 + 2] = -0.35 * roll;
    const lean = pitch + r[J.spine * 3] + r[J.chest * 3];
    const twist = yaw + r[J.spine * 3 + 1] + r[J.chest * 3 + 1];
    r[J.neck * 3] = -0.45 * lean + 0.35 * this.lookPitch; r[J.neck * 3 + 1] = -0.4 * twist + 0.4 * this.lookYaw;
    r[J.head * 3] = -0.45 * lean + 0.65 * this.lookPitch; r[J.head * 3 + 1] = -0.45 * twist + 0.6 * this.lookYaw;
    r[J.head * 3 + 2] = 0.5 * roll;
    // Breathing.
    r[J.chest * 3] += Math.sin(this.time * (1.4 + 1.6 * run)) * (0.012 + 0.02 * run);

    // Arms: counter-swing, elbows folding with speed; idle habits take over when standing.
    const armA = (0.28 + 0.3 * run + 0.3 * sprint) * this.armStyle * (1 - 0.3 * fem * (1 - run)) * moving;
    const ap = Math.cos(TAU * (p - 0.04));
    const bias = -0.04 - 0.16 * run - 0.1 * sprint;
    const abd = 0.1 + 0.05 * run + 0.06 * Math.max(0, this.build) - 0.025 * fem;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      const sw = side * armA * ap;
      const fwd = armA > 1e-3 ? Math.max(0, -sw / armA) : 0;
      ARM[s * 5] = sw + bias * moving + 0.02;
      ARM[s * 5 + 1] = 0;
      ARM[s * 5 + 2] = side * abd;
      ARM[s * 5 + 3] = -(mix(0.16 + 0.22 * fwd, 1.3 + 0.25 * fwd, run) + 0.2 * sprint) * moving - 0.14 * (1 - moving);
      ARM[s * 5 + 4] = -0.12 + 0.1 * run;
    }
    this.idleArms(moving);
    for (let s = 0; s < 2; s++) {
      const jS = s === 0 ? J.shoulderL : J.shoulderR, jE = s === 0 ? J.elbowL : J.elbowR, jW = s === 0 ? J.wristL : J.wristR;
      r[jS * 3] = ARM[s * 5]; r[jS * 3 + 1] = ARM[s * 5 + 1]; r[jS * 3 + 2] = ARM[s * 5 + 2];
      r[jE * 3] = ARM[s * 5 + 3]; r[jW * 3] = ARM[s * 5 + 4];
    }
  }

  /**
   * Ankle target and foot pitch (+ toes up) for leg phase `lp`, relative to the root below the
   * hip. Stance: a world-fixed contact point (heel, sole, then ball) moves back at body speed.
   */
  private foot(lp: number, sig: number, stride: number, run: number, sprint: number, out: Foot): void {
    const th0 = mix(0.3, 0.06, run), gam = mix(0.55, 0.95, run) + 0.1 * sprint;
    const s1 = mix(0.18, 0.08, run), s2 = mix(0.62, 0.45, run);
    const c0 = (stride * sig - HEEL - BALL) / 2 + 0.03 - 0.07 * run;
    if (lp < sig) { stanceAt(lp, sig, stride, c0, s1, s2, th0, gam, out); out.stance = 1; return; }
    stanceAt(sig - 1e-6, sig, stride, c0, s1, s2, th0, gam, out);
    const z0 = out.z, y0 = out.y;
    const z3 = c0 + HEEL * Math.cos(th0) - ANKLE_H * Math.sin(th0), y3 = HEEL * Math.sin(th0) + ANKLE_H * Math.cos(th0);
    const s = (lp - sig) / (1 - sig);
    // Control points a third of a stance-speed step out: the foot leaves and lands with the
    // ground's velocity (no touchdown skid), and the heel kicks up behind when running.
    const match = (stride * (1 - sig)) / 3;
    const kick = match + 0.05 * run, lift1 = 0.06 + 0.22 * run + 0.16 * sprint, lift2 = 0.035 + 0.08 * run;
    out.z = bez(z0, z0 - kick, z3 + match, z3, s);
    out.y = bez(y0, y0 + lift1, y3 + lift2, y3, s);
    out.pitch = -gam + (th0 + gam) * sstep(0.1, 0.95, s) - 0.35 * run * Math.sin(Math.PI * s) * (1 - s);
    out.stance = 1 - sstep(0, 0.12, s);
  }

  /** Idle state: weight shifts, where the eyes go, and the standing foot targets. */
  private idle(dt: number, moving: number): void {
    this.weightTimer -= dt;
    if (this.weightTimer <= 0) { this.weightT = this.rand() < 0.75 ? -this.weightT : this.weightT * 0.3; this.weightTimer = 4 + this.rand() * 6; }
    this.weight += (this.weightT - this.weight) * (1 - Math.exp(-dt * 1.4));
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookYawT = moving > 0.5 ? (this.rand() - 0.5) * 0.5 : (this.rand() - 0.5) * 1.3;
      this.lookPitchT = (this.rand() - 0.6) * 0.2;
      this.lookTimer = 1.5 + this.rand() * 4;
    }
    const phone = this.phoneWeight(moving);
    const yawT = mix(this.lookYawT, 0, phone), pitchT = mix(this.lookPitchT, 0.42, phone);
    this.lookYaw += (yawT - this.lookYaw) * (1 - Math.exp(-dt * 2.5));
    this.lookPitch += (pitchT - this.lookPitch) * (1 - Math.exp(-dt * 2.5));
    const w = this.weight, fem = this.fem;
    const stanceW = 0.095 - 0.02 * fem;
    const freeL = Math.max(0, -w), freeR = Math.max(0, w);
    idleL.x = stanceW + 0.02 * freeL; idleL.z = 0.015 + 0.07 * freeL; idleL.y = ANKLE_H; idleL.pitch = 0;
    idleR.x = -stanceW - 0.02 * freeR; idleR.z = 0.015 + 0.07 * freeR; idleR.y = ANKLE_H; idleR.pitch = 0;
  }

  private phoneWeight(moving: number): number {
    const habit = sstep(2.5, 4, this.still) * (this.idleKind === 1 ? 1 : 0);
    return Math.max(habit * (1 - moving), this.phoneWalk ? 1 : 0);
  }

  /** Arm habits while standing (and the phone while walking), blended over the swing in ARM. */
  private idleArms(moving: number): void {
    const phone = this.phoneWeight(moving);
    const habit = sstep(2.5, 4, this.still) * (1 - moving);
    const k = this.idleKind;
    if (phone > 0) {
      // Right hand holds the phone up in front, left hand supports it when standing.
      setArm(1, -0.34, 0.5, 0.1, -1.6, -0.35, phone);
      setArm(0, -0.3, -0.5, -0.1, -1.45, -0.25, phone * (1 - moving));
      if (phone > 0.5) this.prop = 1;
    } else if (habit > 0 && k === 2) {
      setArm(0, -0.42, -0.95, -0.28, -1.95, 0.1, habit); setArm(1, -0.36, 0.95, 0.3, -1.9, 0.1, habit);
    } else if (habit > 0 && k === 3) {
      setArm(0, 0.42, 0.25, -0.05, -1.05, 0.2, habit); setArm(1, 0.42, -0.25, 0.05, -1.05, 0.2, habit);
    } else if (habit > 0 && k === 4) {
      setArm(0, -0.02, -0.1, 0.12, -0.42, 0.35, habit); setArm(1, -0.02, 0.1, -0.12, -0.42, 0.35, habit);
    }
  }

  /** Pelvis matrix (YXZ) and position, for the leg IK. */
  private setPelvis(): void {
    const x = this.rot[0], y = this.rot[1], z = this.rot[2];
    eulerYXZ(x, y, z, this.pm, 0);
    this.px = this.sway; this.py = PELVIS_Y + this.bob - this.drop; this.pz = this.fwd;
  }

  /** Highest pelvis (<= py) from which a planted foot `f` is still in reach. */
  private reach(f: Foot, side: number, py: number): number {
    const P = this.pm, ox = 0.088 * side, oy = -0.055;
    const hx = P[0] * ox + P[1] * oy, hy = P[3] * ox + P[4] * oy, hz = P[6] * ox + P[7] * oy;
    const dx = f.x - (this.px + hx), dz = f.z - (this.pz + hz);
    const need = f.y + Math.sqrt(Math.max(0, LEG_MAX * LEG_MAX - dx * dx - dz * dz)) - hy;
    return need < py ? mix(py, need, f.stance) : py;
  }

  /**
   * Two-bone IK from the hip to an ankle target, then the ankle to the requested foot pitch. The
   * toe-out twist is at the ankle (keeps the knee in the IK plane) and cancels the pelvis yaw while
   * the foot is planted, so the sole does not swivel on the ground.
   */
  private solveLeg(side: number, f: Foot, pelvisPitch: number, pelvisRoll: number, pelvisYaw = 0): void {
    const jH = side > 0 ? J.hipL : J.hipR, jK = side > 0 ? J.kneeL : J.kneeR, jA = side > 0 ? J.ankleL : J.ankleR;
    const o = SKELETON[jH].offset, P = this.pm;
    const hx = this.px + P[0] * o[0] + P[1] * o[1] + P[2] * o[2];
    const hy = this.py + P[3] * o[0] + P[4] * o[1] + P[5] * o[2];
    const hz = this.pz + P[6] * o[0] + P[7] * o[1] + P[8] * o[2];
    const vx = f.x - hx, vy = f.y - hy, vz = f.z - hz;
    const dx = P[0] * vx + P[3] * vy + P[6] * vz, dy = P[1] * vx + P[4] * vy + P[7] * vz, dz = P[2] * vx + P[5] * vy + P[8] * vz;
    const D = Math.max(1e-4, Math.hypot(dx, dy, dz));
    const Dc = clamp(D, 0.12, (THIGH + SHIN) * 0.9995);
    const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - Dc * Dc) / (2 * THIGH * SHIN), -1, 1));
    const alpha = Math.acos(clamp((THIGH * THIGH + Dc * Dc - SHIN * SHIN) / (2 * THIGH * Dc), -1, 1));
    const fHA = Math.asin(clamp(-dz / D, -1, 1)), abd = Math.atan2(dx, -dy);
    const r = this.rot;
    r[jH * 3] = fHA - alpha; r[jH * 3 + 1] = 0; r[jH * 3 + 2] = abd;
    r[jK * 3] = knee;
    r[jA * 3] = -f.pitch - pelvisPitch - (fHA - alpha) - knee;
    r[jA * 3 + 1] = this.toeOut * side - pelvisYaw * f.stance;
    r[jA * 3 + 2] = -(pelvisRoll + abd);
  }

  // ---------------------------------------------------------------- reactions

  /** Hit by a car: flung backwards, rotating onto the back, limbs flailing. */
  private knocked(t: number, tumble: number): void {
    const r = this.rot, s = this.seed * 10;
    const lie = sstep(0, 0.55, t);
    r[0] = -Math.PI / 2 * lie - 0.35 * Math.sin(Math.min(1, t / 0.55) * Math.PI);
    r[2] = tumble * t * (1 - lie * 0.7) + 0.2 * Math.sin(s) * lie;
    this.drop = (PELVIS_Y - LIE_Y) * lie; this.fwd = -0.45 * lie;
    const fl = 1 - lie * 0.6;
    r[J.spine * 3] = -0.25 * fl; r[J.chest * 3] = -0.2 * fl;
    r[J.neck * 3] = 0.35 * fl; r[J.head * 3] = 0.25 * fl;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1, ph = s + k * 1.7;
      const jS = k === 0 ? J.shoulderL : J.shoulderR, jE = k === 0 ? J.elbowL : J.elbowR, jH = k === 0 ? J.hipL : J.hipR, jK = k === 0 ? J.kneeL : J.kneeR;
      r[jS * 3] = -1.2 - 0.5 * Math.sin(t * 9 + ph) * fl; r[jS * 3 + 2] = side * (0.9 + 0.35 * Math.sin(t * 7 + ph));
      r[jE * 3] = -0.5 - 0.4 * Math.sin(t * 8 + ph);
      r[jH * 3] = -0.95 - 0.3 * Math.sin(t * 6 + ph) * fl; r[jH * 3 + 2] = side * 0.18;
      r[jK * 3] = 0.8 + 0.45 * Math.sin(t * 7.5 + ph + 1) * fl;
      r[(k === 0 ? J.ankleL : J.ankleR) * 3] = 0.4;
    }
  }

  /** Lying on the back, hurt: a knee up, an arm across the body, breathing, a slow writhe. */
  private down(t: number): void {
    const r = this.rot, s = this.seed * 10;
    const a = Math.sin(s) > 0 ? 1 : -1;
    r[0] = -Math.PI / 2; r[2] = 0.12 * a + 0.07 * Math.sin(t * 1.3 + s);
    this.drop = PELVIS_Y - LIE_Y; this.fwd = -0.45;
    r[J.chest * 3] = 0.03 * Math.sin(t * 2.6);
    r[J.neck * 3] = 0.25 + 0.1 * Math.sin(t * 0.9 + s); r[J.head * 3] = 0.15; r[J.head * 3 + 1] = 0.45 * a + 0.15 * Math.sin(t * 0.6);
    const up = a > 0 ? 0 : 1;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const jS = k === 0 ? J.shoulderL : J.shoulderR, jE = k === 0 ? J.elbowL : J.elbowR, jH = k === 0 ? J.hipL : J.hipR, jK = k === 0 ? J.kneeL : J.kneeR, jA = k === 0 ? J.ankleL : J.ankleR;
      if (k === up) {
        r[jS * 3] = -0.95; r[jS * 3 + 2] = -side * 0.25; r[jE * 3] = -1.7;
        r[jH * 3] = -1.0 - 0.1 * Math.sin(t * 1.1); r[jK * 3] = 1.7; r[jA * 3] = -0.4; r[jH * 3 + 2] = side * 0.12;
      } else {
        r[jS * 3] = -0.2; r[jS * 3 + 2] = side * 1.15; r[jE * 3] = -0.35;
        r[jH * 3] = -0.08; r[jK * 3] = 0.15; r[jA * 3] = 0.3; r[jH * 3 + 2] = side * 0.1;
      }
    }
  }

  /** 0.9 s: sit up, get the feet under the body (planted, IK), stand. */
  private getup(t: number): void {
    const r = this.rot, s = clamp(t / 0.9, 0, 1);
    // Pelvis keyframes: lying -> sitting -> crouch -> standing.
    const K = GETUP_K;
    let i = 0;
    while (i < K.length - 2 && s > K[i + 1][0]) i++;
    const u = sstep(0, 1, (s - K[i][0]) / (K[i + 1][0] - K[i][0]));
    const pitch = mix(K[i][1], K[i + 1][1], u);
    this.drop = mix(K[i][2], K[i + 1][2], u); this.fwd = mix(K[i][3], K[i + 1][3], u);
    this.sway = 0; this.bob = 0;
    r[0] = pitch;
    r[J.spine * 3] = 0.2 * sstep(0.3, 0.6, s) * (1 - sstep(0.75, 1, s));
    r[J.neck * 3] = 0.2 * (1 - s); r[J.head * 3] = -0.15 * sstep(0.35, 0.65, s) * (1 - sstep(0.8, 1, s));
    // Legs: drawn up from lying (FK), then planted feet (IK).
    const plant = sstep(0.22, 0.4, s);
    this.setPelvis();
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const jH = k === 0 ? J.hipL : J.hipR, jK = k === 0 ? J.kneeL : J.kneeR, jA = k === 0 ? J.ankleL : J.ankleR;
      const f = k === 0 ? footL : footR;
      f.x = side * 0.1; f.y = ANKLE_H; f.z = 0.02 - 0.04 * k; f.pitch = 0; f.stance = 1;
      this.solveLeg(side, f, pitch, 0);
      const fk = sstep(0, 0.3, s);
      const hx = mix(-0.1, -1.6, fk), kx = mix(0.15, 2.2, fk), ax = mix(0.3, -0.3, fk);
      r[jH * 3] = mix(hx, r[jH * 3], plant); r[jK * 3] = mix(kx, r[jK * 3], plant); r[jA * 3] = mix(ax, r[jA * 3], plant);
      r[jH * 3 + 2] = mix(side * 0.12, r[jH * 3 + 2], plant); r[jH * 3 + 1] = mix(0, r[jH * 3 + 1], plant);
      // Arms: push off the ground behind, then reach forward for balance, then hang.
      const jS = k === 0 ? J.shoulderL : J.shoulderR, jE = k === 0 ? J.elbowL : J.elbowR;
      const push = sstep(0, 0.25, s) * (1 - sstep(0.3, 0.5, s)), reachF = sstep(0.35, 0.55, s) * (1 - sstep(0.7, 1, s));
      r[jS * 3] = 0.7 * push - 0.75 * reachF; r[jS * 3 + 2] = side * (0.15 + 0.2 * push); r[jE * 3] = -0.15 - 0.6 * reachF - 0.12 * sstep(0.8, 1, s);
    }
  }

  /** Jumping or falling: legs tucked, arms out for balance. */
  /** A shove with the right hand: the arm jabs out and comes back while the legs keep going. */
  private shoveArm(t: number): void {
    const r = this.rot, out = sstep(0, 0.1, t) * (1 - sstep(0.2, 0.42, t));
    r[J.shoulderR * 3] = -1.2 * out;
    r[J.shoulderR * 3 + 2] = -0.2 - 0.25 * out;
    r[J.elbowR * 3] = -0.95 + 0.8 * out;
    r[J.shoulderL * 3] = 0.4 * out;
    r[J.elbowL * 3] = -0.9 - 0.4 * out;
    r[J.chest * 3 + 1] = -0.45 * out;
    r[J.spine * 3 + 1] = -0.15 * out;
    this.fwd = 0.05 * out;
  }

  private air(t: number): void {
    const r = this.rot, k = sstep(0, 0.25, t);
    r[0] = 0.08 * k;
    r[J.hipL * 3] = -0.75 * k; r[J.kneeL * 3] = 1.15 * k; r[J.ankleL * 3] = 0.35 * k;
    r[J.hipR * 3] = -0.2 * k; r[J.kneeR * 3] = 0.65 * k; r[J.ankleR * 3] = 0.3 * k;
    r[J.shoulderL * 3] = -0.35 * k; r[J.shoulderR * 3] = -0.25 * k;
    r[J.shoulderL * 3 + 2] = 0.1 + 0.5 * k; r[J.shoulderR * 3 + 2] = -0.1 - 0.5 * k;
    r[J.elbowL * 3] = -0.2 - 0.5 * k; r[J.elbowR * 3] = -0.2 - 0.6 * k;
    r[J.neck * 3] = -0.05 * k;
  }
}

// -------------------------------------------------------------------- matrices

/** 3x3 row-major rotation from Euler angles, R = Ry Rx Rz (the pelvis). */
function eulerYXZ(x: number, y: number, z: number, m: Float64Array, o: number): void {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  m[o] = cy * cz + sy * sx * sz; m[o + 1] = -cy * sz + sy * sx * cz; m[o + 2] = sy * cx;
  m[o + 3] = cx * sz; m[o + 4] = cx * cz; m[o + 5] = -sx;
  m[o + 6] = -sy * cz + cy * sx * sz; m[o + 7] = sy * sz + cy * sx * cz; m[o + 8] = cy * cx;
}
/** 3x3 row-major rotation from Euler angles, R = Rz Rx Ry (limbs, spine, head). */
function eulerZXY(x: number, y: number, z: number, m: Float64Array, o: number): void {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  m[o] = cz * cy - sz * sx * sy; m[o + 1] = -sz * cx; m[o + 2] = cz * sy + sz * sx * cy;
  m[o + 3] = sz * cy + cz * sx * sy; m[o + 4] = cz * cx; m[o + 5] = sz * sy - cz * sx * cy;
  m[o + 6] = -cx * sy; m[o + 7] = sx; m[o + 8] = cx * cy;
}

/** Floats per joint in a pose buffer: a 3x4 affine, row-major (R00 R01 R02 Tx | R10 .. Ty | R20 .. Tz). */
export const JOINT_FLOATS = 12;
const PARENT = SKELETON.map((s) => s.parent);
const OFF = SKELETON.map((s) => s.offset);
const _L = new Float64Array(9);

/** A = P * [R | t] (3x4 affines, row-major). */
function compose(P: Float64Array, po: number, R: Float64Array, tx: number, ty: number, tz: number, out: Float64Array, o: number): void {
  for (let i = 0; i < 3; i++) {
    const a = P[po + i * 4], b = P[po + i * 4 + 1], c = P[po + i * 4 + 2];
    out[o + i * 4] = a * R[0] + b * R[3] + c * R[6];
    out[o + i * 4 + 1] = a * R[1] + b * R[4] + c * R[7];
    out[o + i * 4 + 2] = a * R[2] + b * R[5] + c * R[8];
    out[o + i * 4 + 3] = a * tx + b * ty + c * tz + P[po + i * 4 + 3];
  }
}

const _root = new Float64Array(12);
/**
 * World transform of every joint (3x4 each) for a person with feet at `root`, heading `yaw`,
 * `scale` times the canonical size, posed by the given local rotations / pelvis offsets.
 */
function poseRaw(rx: number, ry: number, rz: number, yaw: number, scale: number, rot: ArrayLike<number>, sway: number, lift: number, fwd: number, W: Float64Array): void {
  const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
  _root[0] = c; _root[1] = 0; _root[2] = s; _root[3] = rx;
  _root[4] = 0; _root[5] = scale; _root[6] = 0; _root[7] = ry;
  _root[8] = -s; _root[9] = 0; _root[10] = c; _root[11] = rz;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const x = rot[j * 3], y = rot[j * 3 + 1], z = rot[j * 3 + 2];
    if (j === 0) {
      eulerYXZ(x, y, z, _L, 0);
      compose(_root, 0, _L, sway, PELVIS_Y + lift, fwd, W, 0);
    } else {
      eulerZXY(x, y, z, _L, 0);
      const o = OFF[j];
      compose(W, PARENT[j] * 12, _L, o[0], o[1], o[2], W, j * 12);
    }
  }
}

export function poseWorld(root: THREE.Vector3, yaw: number, scale: number, g: Gait, W: Float64Array): void {
  poseRaw(root.x, root.y, root.z, yaw, scale, g.rot, g.sway, g.bob - g.drop, g.fwd, W);
}

/** Inverse bind matrices (bind pose: A-pose arms, canonical size, at the origin). */
const INV_BIND = (() => {
  const B = new Float64Array(JOINT_COUNT * 12), inv = new Float64Array(JOINT_COUNT * 12);
  const rot = new Float64Array(JOINT_COUNT * 3);
  BIND_ROT.forEach((e, j) => { rot[j * 3] = e[0]; rot[j * 3 + 1] = e[1]; rot[j * 3 + 2] = e[2]; });
  poseRaw(0, 0, 0, 0, 1, rot, 0, 0, 0, B);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const o = j * 12;
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) inv[o + i * 4 + k] = B[o + k * 4 + i];
    for (let i = 0; i < 3; i++) inv[o + i * 4 + 3] = -(inv[o + i * 4] * B[o + 3] + inv[o + i * 4 + 1] * B[o + 7] + inv[o + i * 4 + 2] * B[o + 11]);
  }
  return inv;
})();

/**
 * Skinning matrices (world * inverse bind) into a joint-texture row: joint j's three matrix rows
 * go to texels j*4 + 0..2 (floats `base + (j*4 + r)*4`). Texel j*4+3 is left alone.
 */
export function writeSkin(W: Float64Array, out: Float32Array, base: number): void {
  for (let j = 0; j < JOINT_COUNT; j++) {
    const o = j * 12, t = base + j * 16;
    const b00 = INV_BIND[o], b01 = INV_BIND[o + 1], b02 = INV_BIND[o + 2], b03 = INV_BIND[o + 3];
    const b10 = INV_BIND[o + 4], b11 = INV_BIND[o + 5], b12 = INV_BIND[o + 6], b13 = INV_BIND[o + 7];
    const b20 = INV_BIND[o + 8], b21 = INV_BIND[o + 9], b22 = INV_BIND[o + 10], b23 = INV_BIND[o + 11];
    for (let i = 0; i < 3; i++) {
      const a = W[o + i * 4], b = W[o + i * 4 + 1], c = W[o + i * 4 + 2], d = W[o + i * 4 + 3];
      const q = t + i * 4;
      out[q] = a * b00 + b * b10 + c * b20;
      out[q + 1] = a * b01 + b * b11 + c * b21;
      out[q + 2] = a * b02 + b * b12 + c * b22;
      out[q + 3] = a * b03 + b * b13 + c * b23 + d;
    }
  }
}

const _W = new Float64Array(JOINT_COUNT * JOINT_FLOATS);
/** World matrix of every joint for a person at `root` (feet) with `yaw`, posed by `g` (at its look's height). */
export function jointMatrices(root: THREE.Vector3, yaw: number, g: Gait, out: THREE.Matrix4[]): void {
  poseWorld(root, yaw, g.scale, g, _W);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const o = j * 12;
    out[j].set(_W[o], _W[o + 1], _W[o + 2], _W[o + 3], _W[o + 4], _W[o + 5], _W[o + 6], _W[o + 7], _W[o + 8], _W[o + 9], _W[o + 10], _W[o + 11], 0, 0, 0, 1);
  }
}
