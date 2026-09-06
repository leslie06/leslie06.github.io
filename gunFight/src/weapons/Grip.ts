import * as THREE from 'three';
import type { V3 } from './Build';
import { PALM_SEAT } from './Hands';

/**
 * Grip solids + the contact IK that puts the gloves ON the gun.
 *
 * Why this exists
 * ---------------
 * Hand placements used to be authored as a wrist transform per weapon per pose: a position, a finger
 * direction and a "back of hand" direction, all hand-tuned by eye. That is a 6-DOF pose keyed against
 * whatever the hand mesh happened to measure at the time. When the fingers were rebuilt to real
 * anthropometry the wrist-to-fingertip reach changed by ~49 mm and every one of those poses silently
 * stopped touching its weapon: the fist closed 20-40 mm clear of the handguard in every frame of the
 * game. A global constant "advance" does not fix it, because the error is different per weapon, per
 * grip and per pose.
 *
 * So the contact is no longer authored: it is solved. Each weapon declares the *solid* its hands hold
 * (`GripSolid` - a swept rounded rectangle along a segment, which describes a round handguard, a slab
 * forend and an oval pistol grip equally well). Each hand placement names which solid it is on, and
 * every frame:
 *
 *   1. **seat** (`GripIk.seat`) - the wrist transform is derived from the solid. The authored position
 *      supplies only the two things that are art direction: where *along* the solid the hand sits and
 *      which *side* it comes from. The palm is then turned to face the axis, the fingers are laid
 *      across it, and the wrist is put one palm-thickness clear of the surface and one palm-length
 *      back along the fingers, so the solid lies across the distal palm at the knuckle line;
 *   2. **wrap** - each finger closes onto the solid, MCP then PIP then DIP, each by a 1-D root find on
 *      that joint's absolute angle (the pad's distance falls monotonically as the joint closes);
 *   3. **press** - a 2-D least-squares translation across the solid takes up whatever the seat and the
 *      wrap left, with an anchor that stops the hand sliding around to the far side;
 *   4. wrap and press again (three rounds), then one final wrap.
 *
 * Placements whose pose is art rather than geometry - a two-handed pistol hold - opt out of step 1
 * with `GripSolid.derive = false` and keep their authored transform.
 *
 * The residual after the solve is the real gap in metres, and it is asserted (see WeaponSystem's
 * grip check) so this can never silently regress again.
 *
 * All coordinates are gun-root space unless stated (the weapon model root and both hand roots are
 * siblings under `gunRoot` with identity transforms, so gun space == model space).
 */

/**
 * A convex solid a hand wraps: a rounded rectangle of half-extents (hw, hh) and corner radius `r`,
 * swept along the segment a->b. hw == hh == r is a cylinder; r small is a slab.
 * `u` is the gun-space direction of the hw axis (defaults to +X projected off the segment).
 * `part` names a moving part (pump, mag) whose current offset is added to the segment.
 */
export interface GripSolid {
  a: V3; b: V3;
  hw: number; hh: number; r: number;
  u?: V3;
  part?: string;
  /**
   * Fingers that are NOT wrapped around this solid and keep their authored pose. A pistol grip needs
   * `['index']`: the trigger finger is on the trigger, 30-40 mm forward of the grip column, and
   * solving it onto the grip is how you get a hand that has grown a sixth knuckle.
   */
  skip?: string[];
  /**
   * Set false to keep the authored wrist transform and only run the press + finger wrap on top of it.
   * Deriving the frame is right for a hand wrapped around a bar — a handguard, a forend, a pump — where
   * the geometry fully determines the grip. It is wrong for a two-handed pistol hold: the firing hand's
   * palm is on the backstrap while its knuckles are round the left side, and the support hand is not
   * holding the gun at all but the other hand. Those poses are art, not geometry, and only need to be
   * pressed into contact.
   */
  derive?: boolean;
  /**
   * True when the solid stands in for something that is not weapon geometry - the pistol's `support`
   * capsule is the *firing hand*, which the support hand wraps. Contact with it is solved and reported
   * exactly the same way, but it is not asserted: a capsule is a crude stand-in for a gloved fist and
   * holding it to the same tolerance as a machined handguard would be measuring the approximation.
   */
  virtual?: boolean;
}

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _rel = new THREE.Vector3();

/** Cached per-solid frame, rebuilt when the solid's part offset moves. */
class SolidFrame {
  a = new THREE.Vector3(); b = new THREE.Vector3();
  d = new THREE.Vector3(); len = 1;
  u = new THREE.Vector3(); v = new THREE.Vector3();
  hw = 0; hh = 0; r = 0;
}
const _frame = new SolidFrame();

/** Build the working frame for a solid, applying the current offset of its moving part (if any). */
export function gripFrame(s: GripSolid, offset: THREE.Vector3 | null, out = _frame): SolidFrame {
  out.a.set(s.a[0], s.a[1], s.a[2]);
  out.b.set(s.b[0], s.b[1], s.b[2]);
  if (offset) { out.a.add(offset); out.b.add(offset); }
  out.d.subVectors(out.b, out.a);
  out.len = Math.max(1e-6, out.d.length());
  out.d.multiplyScalar(1 / out.len);
  if (s.u) out.u.set(s.u[0], s.u[1], s.u[2]);
  else out.u.set(1, 0, 0);
  out.u.addScaledVector(out.d, -out.u.dot(out.d));
  if (out.u.lengthSq() < 1e-8) out.u.set(0, 1, 0).addScaledVector(out.d, -out.d.y);
  out.u.normalize();
  out.v.crossVectors(out.d, out.u).normalize();
  out.hw = s.hw; out.hh = s.hh; out.r = Math.min(s.r, Math.min(s.hw, s.hh));
  return out;
}

/**
 * Signed distance from `p` to the solid's surface (positive outside), and the outward unit normal.
 * The measure is perpendicular to the sweep axis - i.e. against the *infinite* extrusion, not the
 * capped segment. That is deliberate: a little finger that hangs off the bottom of a pistol grip is
 * still resting on the grip's surface plane, and capping the solid would report it as centimetres
 * away. `gripAxialOvershoot` reports how far past an end a contact is, for the ones that care.
 */
export function gripDistance(f: SolidFrame, p: THREE.Vector3, outN?: THREE.Vector3): number {
  _rel.subVectors(p, f.a);
  _rel.addScaledVector(f.d, -_rel.dot(f.d));
  const pu = _rel.dot(f.u), pv = _rel.dot(f.v);
  const qx = Math.abs(pu) - (f.hw - f.r), qy = Math.abs(pv) - (f.hh - f.r);
  const mx = Math.max(qx, 0), my = Math.max(qy, 0);
  const outside = Math.hypot(mx, my);
  const dist = outside + Math.min(Math.max(qx, qy), 0) - f.r;
  if (outN) {
    let nu: number, nv: number;
    if (outside > 1e-9) { nu = Math.sign(pu) * mx / outside; nv = Math.sign(pv) * my / outside; }
    else if (qx > qy) { nu = Math.sign(pu) || 1; nv = 0; }
    else { nu = 0; nv = Math.sign(pv) || 1; }
    outN.copy(f.u).multiplyScalar(nu).addScaledVector(f.v, nv);
    if (outN.lengthSq() < 1e-12) outN.copy(f.u);
    else outN.normalize();
  }
  return dist;
}

/** How far past an end cap of the segment `p` sits (0 = between the caps), in metres. */
export function gripAxialOvershoot(f: SolidFrame, p: THREE.Vector3): number {
  _rel.subVectors(p, f.a);
  const t = _rel.dot(f.d);
  return t < 0 ? -t : t > f.len ? t - f.len : 0;
}

const _R = new THREE.Vector3(), _T = new THREE.Vector3(), _F = new THREE.Vector3(), _B = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _mb = new THREE.Matrix4();
const _ex = new THREE.Vector3(), _ey = new THREE.Vector3(), _ez = new THREE.Vector3();

/** The wrist quaternion `Hand.orient` would produce for a (fingers, back) pair. */
function frameQuat(fingers: THREE.Vector3, back: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _ez.copy(fingers).negate().normalize();
  _ey.copy(back).addScaledVector(_ez, -back.dot(_ez));
  if (_ey.lengthSq() < 1e-10) _ey.set(0, 1, 0).addScaledVector(_ez, -_ez.y);
  _ey.normalize();
  _ex.crossVectors(_ey, _ez);
  _mb.makeBasis(_ex, _ey, _ez);
  return out.setFromRotationMatrix(_mb);
}

/**
 * Wrist orientation for a wrap grip, derived from the solid instead of authored.
 *
 * A hand can only close around something if the palm faces it and the fingers cross it. The authored
 * placements did neither reliably - on the M4 the support hand's finger axis was 24 degrees off the
 * line from the wrist *to* the handguard axis, so the fingers pointed at the tube end-on and curling
 * them just swung the tips past it. No amount of moving the wrist fixes that; the frame is wrong.
 *
 * So the frame is built here:
 *   - the back of the hand faces directly away from the solid's axis, i.e. the palm faces it;
 *   - the fingers run tangentially around it, keeping whatever rake along the axis the author asked
 *     for (a support hand angles its fingers forward; a firing hand angles them down the grip).
 * There are two tangential directions - fingers over the top or under the bottom - and the authored
 * `fingers`/`back` pair decides between them: whichever candidate frame is the smaller rotation from
 * what the animator wrote is the one that gets used. The authored vectors therefore still carry the
 * art direction (which side the hand comes from, which way the thumb points); they just no longer
 * have to be metrically exact, which is what they were never going to be by eye.
 */
export function gripOrientation(f: SolidFrame, wrist: THREE.Vector3, fingersAuth: V3, backAuth: V3, outFingers: THREE.Vector3, outBack: THREE.Vector3): void {
  // radial: wrist -> nearest point on the axis
  _R.subVectors(wrist, f.a);
  const t = THREE.MathUtils.clamp(_R.dot(f.d), 0, f.len);
  _R.subVectors(f.a, wrist).addScaledVector(f.d, t);
  if (_R.lengthSq() < 1e-8) _R.copy(f.u);
  _R.normalize();
  outBack.copy(_R).negate();

  _F.set(fingersAuth[0], fingersAuth[1], fingersAuth[2]).normalize();
  const rake = THREE.MathUtils.clamp(_F.dot(f.d), -0.55, 0.55);
  _T.crossVectors(f.d, _R).normalize();
  _B.set(backAuth[0], backAuth[1], backAuth[2]);
  frameQuat(_F, _B, _qa);
  // candidate A: fingers along +T; candidate B: along -T. Keep the one closer to the authored frame.
  const tan = Math.sqrt(Math.max(0, 1 - rake * rake));
  outFingers.copy(_T).multiplyScalar(tan).addScaledVector(f.d, rake).normalize();
  frameQuat(outFingers, outBack, _qb);
  const dotA = Math.abs(_qb.dot(_qa));
  _F.copy(_T).multiplyScalar(-tan).addScaledVector(f.d, rake).normalize();
  frameQuat(_F, outBack, _qb);
  if (Math.abs(_qb.dot(_qa)) > dotA) outFingers.copy(_F);
}

/**
 * Wrist translation solve: press the hand onto the solid until the weighted contact residuals vanish.
 *
 * Two deliberate restrictions on where the hand is allowed to go:
 *
 *  - the solve is 2-D, in the plane perpendicular to the solid's axis. Sliding a hand *along* a
 *    handguard is not a contact correction - every contact normal is perpendicular to the axis, so
 *    that direction carries no information and a 3-D solve just turns numerical noise into a hand
 *    that walks up the barrel;
 *  - within that plane the radial direction (straight at the axis) is free, but sliding *around* the
 *    solid is anchored to the authored position. Without that anchor a cylinder has a whole circle of
 *    equally good contacts and the solver happily finds the one on the far side of the gun. Which
 *    side the hand comes from is art direction; how hard it presses is geometry.
 *
 * The contacts translate rigidly with the wrist, so each residual's gradient is its own contact normal
 * and one Gauss-Newton step is exact for a fixed set of normals; four steps re-evaluate the normals
 * and converge to well under a tenth of a millimetre.
 */
export function solveWristTranslation(
  frame: SolidFrame, radial: THREE.Vector3,
  pts: THREE.Vector3[], weights: number[], count: number,
  out: THREE.Vector3, anchorK: number, iterations = 4,
): void {
  out.set(0, 0, 0);
  const n = _u, p = _v;
  // the authored radial direction, and the "around the solid" direction, in the frame's (u, v) basis
  const ru = radial.dot(frame.u), rv = radial.dot(frame.v);
  const tu = -rv, tv = ru;
  let du = 0, dv = 0;
  for (let it = 0; it < iterations; it++) {
    let a00 = 0, a01 = 0, a11 = 0, b0 = 0, b1 = 0, wsum = 0;
    for (let i = 0; i < count; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      p.copy(pts[i]).addScaledVector(frame.u, du).addScaledVector(frame.v, dv);
      const r = gripDistance(frame, p, n);
      const nu = n.dot(frame.u), nv = n.dot(frame.v);
      a00 += w * nu * nu; a01 += w * nu * nv; a11 += w * nv * nv;
      b0 -= w * r * nu; b1 -= w * r * nv;
      wsum += w;
    }
    // anchor across the solid (see above) + a little Levenberg damping along it, so a degenerate
    // normal set steps conservatively instead of shooting off along a flat face
    const anchor = anchorK * wsum, lam = 0.06 * wsum;
    const proj = du * tu + dv * tv;
    a00 += anchor * tu * tu + lam; a01 += anchor * tu * tv; a11 += anchor * tv * tv + lam;
    b0 -= anchor * proj * tu; b1 -= anchor * proj * tv;
    const det = a00 * a11 - a01 * a01;
    if (Math.abs(det) < 1e-12) break;
    const x0 = (b0 * a11 - b1 * a01) / det, x1 = (a00 * b1 - a01 * b0) / det;
    du += x0; dv += x1;
    if (x0 * x0 + x1 * x1 < 1e-10) break;
  }
  out.copy(frame.u).multiplyScalar(du).addScaledVector(frame.v, dv);
  // Never teleport the hand. 10 cm is about the length of a palm: past that the placement names the
  // wrong solid or the wrong station on it, and a visibly stuck hand is far easier to diagnose in a
  // frame than one that has jumped somewhere plausible.
  const m = out.length();
  if (m > GRIP_MAX_MOVE) out.multiplyScalar(GRIP_MAX_MOVE / m);
}

export { SolidFrame };

// ---------------------------------------------------------------------------------------------
// the solver
// ---------------------------------------------------------------------------------------------

/** One measured contact after a solve. `gap` is signed: positive = floating, negative = interpenetrating. */
export interface PadGap { name: string; gap: number; axial: number }

export interface GripMeasurement {
  side: 'left' | 'right';
  solid: string;
  /**
   * Worst *positive* gap over the finger pads that are on the solid, in metres — how far the nearest
   * thing to a floating finger is from the weapon. This is the number the review is about and the one
   * the dev assert fires on.
   */
  maxGap: number;
  /**
   * Worst positive gap over the *fingertip* pads only, in metres. This is the assert metric the round-3
   * review named — "max(fingertip -> nearest weapon surface) < 3 mm" — and it is the one that matches
   * what an eye sees: a middle phalanx bridging a corner by 4 mm is invisible, a fingertip hanging 4 mm
   * off a handguard is the tell.
   */
  tipGap: number;
  /** Worst interpenetration, in metres. A finger pressed a few mm into a grip reads as pressure. */
  maxPen: number;
  /** worst |gap| over the palm samples, in metres */
  palmGap: number;
  meanGap: number;
  /** how far the solver moved the wrist away from the authored position, in metres */
  move: number;
  pads: PadGap[];
}

/**
 * Least-squares weight of each contact in the wrist *translation*.
 *
 * The palm places the hand; the fingers only get a small vote. Weighting them equally was actively
 * harmful — with the fingers still open they sit tens of millimetres off a handguard, out-weigh the
 * palm four to one, and drag the whole hand *through* the gun looking for a contact on the far side —
 * but zeroing them entirely leaves an authored placement (see `GripSolid.derive`) with no way to close
 * the last centimetre of reach, because the wrap alone cannot lengthen a finger.
 */
const W_PALM = [0.35, 1.0, 0.6];
const W_PAD = [0.40, 0.18, 0.10];
/**
 * Absolute joint angle limits for the wrap solve, radians. These are bounds on the *pose*, not on the
 * correction: a finger that has to straighten out of a fist to lie along a handguard must be allowed
 * to, and one that has to close further must be allowed to. 0.02 is a straight finger, 1.55 is a
 * a fully closed fist (the last 20 degrees are what a hand needs to close on a 36 mm pistol grip). The floor is not zero on purpose: a hand holding a rifle never has a straight
 * finger, and letting the solver flatten one to reach tangency turns the glove from a fist with a
 * readable knuckle line into a strap laid over the handguard. Where 0.30 rad of curl is more than the
 * surface allows, the press step backs the whole hand off instead.
 */
const CURL_MIN = 0.30, CURL_MAX = 1.95;
/**
 * How far the press step may move the wrist away from the analytic seat, in metres. The seat is
 * already metrically right, so this is a polish budget: anything that wants more than 25 mm is a
 * placement naming the wrong solid, and a visibly stuck hand is far easier to diagnose in a frame
 * than one that has quietly jumped somewhere plausible.
 */
const GRIP_MAX_MOVE = 0.025;
/**
 * How hard a pad is pressed into the surface it rests on, in metres. A glove is not a rigid shell: a
 * hand holding a rifle flattens against it, and solving for exact tangency leaves a hairline of
 * background visible between every finger and the handguard at 1080p.
 */
const PRESS = 0.0015;
/**
 * The most a pad is allowed to sink into the solid, in metres. Fingers are longer than the perimeter
 * of a 31 mm pistol grip - in life the last phalanges press into the palm and the heel of the thumb,
 * which this rig has no collision for - so without a cap the pose puts fingertips 25 mm inside the
 * weapon and they come out of the far side.
 */
const PEN_MAX = 0.007;
/**
 * Strength of the anchor that stops the press sliding the hand *around* the solid, relative to the
 * total contact weight. A derived seat is already at the right angle, so it is held there firmly; an
 * authored one (`GripSolid.derive === false`) is only approximately right and needs the freedom to
 * slide a centimetre round the grip to find its contact.
 */
const ANCHOR_DERIVED = 0.9, ANCHOR_AUTHORED = 0.6;

/**
 * Minimal view of a hand the solver needs. `Hands.Hand` satisfies it; keeping it structural means
 * Grip.ts does not have to import the 600-line hand builder.
 */
export interface GripHand {
  readonly side: 'left' | 'right';
  root: THREE.Object3D;
  readonly wrap: Record<string, [number, number, number]>;
  curlOf(name: string, joint: number): number;
  fingerPads(name: string, extra: readonly number[], out: THREE.Vector3[]): void;
  palmPads(out: THREE.Vector3[]): void;
  clearWrap(): void;
  refresh(): void;
}

const FINGERS4 = ['index', 'middle', 'ring', 'pinky'];

export class GripIk {
  private frame = new SolidFrame();
  private pads: THREE.Vector3[][] = FINGERS4.map(() => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  private palm = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private pts: THREE.Vector3[] = [];
  private wts: number[] = [];
  private delta = new THREE.Vector3();
  private total = new THREE.Vector3();
  private scratch = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private qInv = new THREE.Quaternion();
  private tmp = new THREE.Vector3();
  private extra: [number, number, number] = [0, 0, 0];
  private oframe = new SolidFrame();
  private radial = new THREE.Vector3();
  private station = new THREE.Vector3(); private approach = new THREE.Vector3(); private probe = new THREE.Vector3();

  /**
   * Seat the wrist on the solid, analytically.
   *
   * The authored placement supplies the two things that are art direction - *where along* the solid
   * the hand sits and *which side* it comes from - and nothing else. Everything metric is derived:
   * the palm faces the axis, the fingers run across it (`gripOrientation`), and the wrist is put
   * exactly one palm-thickness clear of the surface and one palm-length back along the fingers, so
   * that the solid lies across the distal palm where a hand actually holds something.
   *
   * This is what the authored numbers could never be by hand. On the M4 the support wrist was 102 mm
   * from the handguard axis where the geometry wants 42 mm, which is the whole "fist closes on
   * nothing" defect; and because the error is a function of the hand mesh, the grip radius and the
   * pose, no constant could have absorbed it.
   */
  seat(solid: GripSolid, offset: THREE.Vector3 | null, authored: THREE.Vector3, fingersAuth: V3, backAuth: V3, outPos: THREE.Vector3, outF: THREE.Vector3, outB: THREE.Vector3): void {
    const f = gripFrame(solid, offset, this.oframe);
    // station on the axis + approach direction, both read off the authored placement
    _rel.subVectors(authored, f.a);
    const t = THREE.MathUtils.clamp(_rel.dot(f.d), 0, f.len);
    this.station.copy(f.a).addScaledVector(f.d, t);
    this.approach.subVectors(authored, this.station);
    if (this.approach.lengthSq() < 1e-8) this.approach.copy(f.u);
    this.approach.normalize();
    gripOrientation(f, authored, fingersAuth, backAuth, outF, outB);
    outB.copy(this.approach);
    // how far the surface is from the axis in the approach direction (the section is a rounded
    // rectangle, so this is not simply a radius)
    let lo = 0, hi = f.hw + f.hh + 0.02;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) * 0.5;
      if (gripDistance(f, this.probe.copy(this.station).addScaledVector(this.approach, mid)) < 0) lo = mid; else hi = mid;
    }
    outPos.copy(this.station).addScaledVector(this.approach, (lo + hi) * 0.5 + PALM_SEAT.depth).addScaledVector(outF, -PALM_SEAT.z);
  }
  /** reused so the solver allocates nothing per frame */
  readonly out: GripMeasurement = { side: 'left', solid: '', maxGap: 0, tipGap: 0, maxPen: 0, palmGap: 0, meanGap: 0, move: 0, pads: [] };
  /** debug: per-outer-iteration wrist deltas of the last solve, wrist space */
  readonly trace: number[] = [];

  constructor() {
    for (let i = 0; i < 3; i++) this.out.pads.push({ name: `palm${i}`, gap: 0, axial: 0 });
    for (const n of FINGERS4) for (let s = 0; s < 3; s++) this.out.pads.push({ name: `${n}${s}`, gap: 0, axial: 0 });
  }

  /**
   * Close one finger onto the solid: MCP, then PIP, then DIP, each by a 1-D root find on that joint's
   * absolute angle. The pad's distance to the solid falls monotonically as the joint closes, so
   * bisection is exact and cannot oscillate; solving them in order means each joint only has to close
   * the gap the ones before it left.
   */
  private wrapFinger(hand: GripHand, name: string, strength: number): void {
    const w = hand.wrap[name];
    this.extra[0] = w[0]; this.extra[1] = w[1]; this.extra[2] = w[2];
    for (let s = 0; s < 3; s++) {
      const c = hand.curlOf(name, s);
      const lo = CURL_MIN - c, hi = CURL_MAX - c;
      this.extra[s] = lo;
      const open = this.padDistance(hand, name, s);
      if (open <= -PEN_MAX) {
        // Buried even with the joint straight: a finger longer than the thing it is holding, whose
        // last phalanges in life press into the palm and the heel of the thumb (no collider here).
        // Nothing to solve; take the least-buried pose the joint can reach.
        this.extra[s] = lo;
      } else if (open <= -PRESS) {
        // Can't be pressed any harder, but the authored curl would bury it: open it just enough.
        this.extra[s] = this.bisect(hand, name, s, lo, 0, -PEN_MAX);
      } else {
        this.extra[s] = hi;
        if (this.padDistance(hand, name, s) < -PRESS) this.extra[s] = this.bisect(hand, name, s, lo, hi, -PRESS);
      }
    }
    for (let s = 0; s < 3; s++) w[s] = this.extra[s] * strength;
  }

  /** joint angle at which pad `s` reaches `target` (signed distance); the pad closes monotonically */
  private bisect(hand: GripHand, name: string, s: number, lo: number, hi: number, target: number): number {
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) * 0.5;
      this.extra[s] = mid;
      if (this.padDistance(hand, name, s) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  private skipped(solid: GripSolid, k: number): boolean { return solid.skip !== undefined && solid.skip.indexOf(FINGERS4[k]) >= 0; }

  /** signed distance of pad `s` of finger `k` with `this.extra` as the joint deltas */
  private padDistance(hand: GripHand, name: string, s: number): number {
    hand.fingerPads(name, this.extra, this.scratch);
    return gripDistance(this.frame, this.scratch[s]);
  }

  /**
   * Put `hand` on `solid`. `authored` is the wrist position the animation asked for; the solver only
   * moves away from it along the contact normals. `strength` scales the whole correction (0 leaves
   * the authored pose untouched). Returns the residual gaps, in metres, after solving.
   */
  solve(hand: GripHand, solidName: string, solid: GripSolid, offset: THREE.Vector3 | null, authored: THREE.Vector3, strength = 1): GripMeasurement {
    // Work in wrist space: the solid moves into the hand's frame once, and then every finger pad the
    // FK produces can be measured without a transform. The wrist rotation is fixed during the solve.
    const f = this.frame;
    gripFrame(solid, offset, f);
    this.qInv.copy(hand.root.quaternion).invert();
    f.a.sub(authored).applyQuaternion(this.qInv);
    f.b.sub(authored).applyQuaternion(this.qInv);
    f.d.applyQuaternion(this.qInv); f.u.applyQuaternion(this.qInv); f.v.applyQuaternion(this.qInv);

    // radial direction (wrist -> axis) at the authored position, in wrist space; the anchor axis
    this.radial.copy(f.a).addScaledVector(f.d, THREE.MathUtils.clamp(-f.a.dot(f.d), 0, f.len));
    if (this.radial.lengthSq() < 1e-10) this.radial.copy(f.u);
    this.radial.normalize();

    this.total.set(0, 0, 0);
    this.trace.length = 0;
    for (let outer = 0; outer < 3; outer++) {
      // ---- 1. close every finger onto the solid, knuckle joint outwards
      for (let k = 0; k < 4; k++) if (!this.skipped(solid, k)) this.wrapFinger(hand, FINGERS4[k], strength);
      // ---- 2. press the hand onto it (palm + finger bases; see W_PAD)
      let n = 0;
      hand.palmPads(this.palm);
      for (let i = 0; i < 3; i++) { this.pts[n] = this.palm[i]; this.wts[n] = W_PALM[i]; n++; }
      for (let k = 0; k < 4; k++) {
        hand.fingerPads(FINGERS4[k], hand.wrap[FINGERS4[k]], this.pads[k]);
        const skip = this.skipped(solid, k);
        for (let s = 0; s < 3; s++) { this.pts[n] = this.pads[k][s]; this.wts[n] = skip ? 0 : W_PAD[s]; n++; }
      }
      solveWristTranslation(f, this.radial, this.pts, this.wts, n, this.delta, solid.derive === false ? ANCHOR_AUTHORED : ANCHOR_DERIVED);
      this.delta.multiplyScalar(strength);
      // the wrist moved, so the solid moved the other way in wrist space
      f.a.sub(this.delta); f.b.sub(this.delta);
      this.total.add(this.delta);
      this.trace.push(+(this.delta.length() * 1000).toFixed(2));
    }
    for (let k = 0; k < 4; k++) {
      if (this.skipped(solid, k)) { const w = hand.wrap[FINGERS4[k]]; w[0] = 0; w[1] = 0; w[2] = 0; }
      else this.wrapFinger(hand, FINGERS4[k], strength);
    }

    // ---- 3. commit and measure
    hand.root.position.copy(authored).add(this.tmp.copy(this.total).applyQuaternion(hand.root.quaternion));
    hand.refresh();
    const m = this.out;
    m.side = hand.side; m.solid = solidName; m.maxGap = 0; m.tipGap = 0; m.maxPen = 0; m.palmGap = 0; m.move = this.total.length();
    let sum = 0, cnt = 0, i = 0;
    hand.palmPads(this.palm);
    m.palmGap = Infinity;
    for (let k = 0; k < 3; k++, i++) {
      const g = gripDistance(f, this.palm[k]);
      // the closest sample, not the furthest: a palm curves, so only part of it lies on a handguard
      m.palmGap = Math.min(m.palmGap, Math.abs(g));
      m.pads[i].gap = g; m.pads[i].axial = gripAxialOvershoot(f, this.palm[k]);
    }
    for (let k = 0; k < 4; k++) {
      hand.fingerPads(FINGERS4[k], hand.wrap[FINGERS4[k]], this.pads[k]);
      const skip = this.skipped(solid, k);
      for (let s = 0; s < 3; s++, i++) {
        const p = this.pads[k][s];
        const g = gripDistance(f, p), ax = gripAxialOvershoot(f, p);
        m.pads[i].gap = g; m.pads[i].axial = ax;
        // Two contacts are reported but do not set the assert: a finger that hangs off the end of a
        // short grip (the little finger on a pistol), and one this solid does not wrap at all (the
        // trigger finger). Neither is a failure to touch the weapon.
        if (ax < 0.012 && !skip) {
          m.maxGap = Math.max(m.maxGap, g); m.maxPen = Math.max(m.maxPen, -g);
          if (s === 2) m.tipGap = Math.max(m.tipGap, g);
          sum += Math.abs(g); cnt++;
        }
        void ax;
      }
    }
    m.meanGap = cnt ? sum / cnt : 0;
    return m;
  }
}
