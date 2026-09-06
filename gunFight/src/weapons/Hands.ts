import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HAND_UV, type WeaponMaterials } from './Materials';
import { capsule, cyl, remapUV, xform, lathe, deform, ellipsoid, type V3 } from './Build';

/**
 * Gloved hand + forearm as ONE skinned mesh (17 bones: wrist, forearm, 5 fingers x 3) and one atlas
 * material = 1 draw call per hand.
 *
 * The read, not the rig, is what matters here — this thing is in every frame of the game. Rules taken
 * off the CoD reference (ref_06 is the closest look at a modern viewmodel glove):
 *
 *  - A finger is ONE continuous swept tube, not three capsules with beads at the joints. Cross-sections
 *    are ellipses (wider than deep), the radius tapers ~26% from knuckle to tip, joints are a <=1.3 mm
 *    dorsal swell rather than a separate lobe, and the tip is a flattened pad. Two-bone linear skinning
 *    across each joint keeps the silhouette unbroken when the finger curls.
 *  - Fingers differ: middle is longest and thickest, index and ring shorter, little finger is 71% of the
 *    middle and 78% of its diameter. Each has a resting fan angle so they splay instead of lying parallel.
 *  - The knuckle line is in the silhouette: four hard TPR knuckle caps sit ~4 mm proud of the dorsal
 *    surface, so the back of the hand is a bumpy contour, not an egg.
 *  - Form is read off the specular, so the vertex colour bakes cavity AO: dark between the fingers, dark
 *    on the palmar face, bright along the dorsal ridge.
 *  - Glove -> cuff -> sleeve is a hard edge: the gauntlet ends in a stepped lip that overlaps a *smaller*
 *    sleeve, so there is a value break and an occluding contour instead of a blend.
 *
 * Canonical frame (bind pose): wrist at origin, fingers pointing -Z, back of hand +Y,
 * thumb on -X for the right hand (+X for the left).
 */

export type FingerCurl = [number, number, number]; // mcp, pip, dip (radians)
export interface HandPose { thumb: FingerCurl; index: FingerCurl; middle: FingerCurl; ring: FingerCurl; pinky: FingerCurl; spread: number; thumbOut: number }

const P = (t: FingerCurl, i: FingerCurl, m: FingerCurl, r: FingerCurl, p: FingerCurl, spread = 0.05, thumbOut = 0): HandPose => ({ thumb: t, index: i, middle: m, ring: r, pinky: p, spread, thumbOut });
export const HAND_POSES = {
  /** wrapped around a pistol grip, index resting on the trigger */
  grip: P([0.55, 0.65, 0.45], [0.30, 0.50, 0.30], [1.2, 1.35, 0.95], [1.28, 1.4, 1.0], [1.35, 1.45, 1.05], 0.05, 0.35),
  /** same, trigger finger squeezed */
  gripFire: P([0.55, 0.65, 0.45], [0.75, 0.95, 0.55], [1.2, 1.35, 0.95], [1.28, 1.4, 1.0], [1.35, 1.45, 1.05], 0.05, 0.35),
  /** C-clamp on a handguard: fingers curled over the top, thumb riding along the far side */
  foregrip: P([0.30, 0.40, 0.32], [1.02, 1.28, 0.92], [1.10, 1.34, 0.98], [1.16, 1.40, 1.02], [1.26, 1.46, 1.06], 0.09, 0.70),
  /** wrapped around a vertical pump / SMG foregrip */
  pump: P([0.6, 0.6, 0.4], [1.15, 1.3, 0.9], [1.22, 1.34, 0.94], [1.30, 1.38, 0.98], [1.38, 1.44, 1.02], 0.06, 0.25),
  /** loosely open (reaching for the mag release / rack) */
  open: P([0.2, 0.2, 0.15], [0.3, 0.3, 0.2], [0.35, 0.35, 0.25], [0.4, 0.4, 0.3], [0.45, 0.45, 0.35], 0.16, 0.5),
  /** pinching a magazine */
  magHold: P([0.7, 0.5, 0.3], [0.9, 1.0, 0.6], [1.0, 1.1, 0.7], [1.1, 1.2, 0.8], [1.2, 1.3, 0.9], 0.04, 0.15),
  /** flat palm (slap the mag home / cupped under the pistol) */
  flat: P([0.4, 0.3, 0.2], [0.1, 0.15, 0.1], [0.1, 0.15, 0.1], [0.12, 0.15, 0.1], [0.15, 0.2, 0.1], 0.14, 0.6),
  /** charging-handle pinch: index+thumb */
  pinch: P([0.9, 0.7, 0.4], [1.0, 1.1, 0.7], [1.3, 1.4, 1.0], [1.35, 1.4, 1.0], [1.4, 1.45, 1.0], 0.03, 0.1),
  /** bolt knob grip (sniper) */
  bolt: P([0.7, 0.6, 0.4], [1.1, 1.2, 0.8], [1.2, 1.3, 0.9], [1.3, 1.35, 0.95], [1.4, 1.45, 1.0], 0.05, 0.2),
  /** support hand wrapped over the firing hand on a pistol: thumbs forward */
  support: P([0.10, 0.16, 0.12], [0.92, 1.12, 0.80], [1.02, 1.22, 0.88], [1.12, 1.28, 0.94], [1.22, 1.34, 1.0], 0.045, 0.90),
  fist: P([1.1, 1.0, 0.6], [1.5, 1.6, 1.1], [1.5, 1.6, 1.1], [1.5, 1.6, 1.1], [1.5, 1.6, 1.1], 0.0, 0.1),
} satisfies Record<string, HandPose>;
export type HandPoseName = keyof typeof HAND_POSES;

interface FingerDef {
  name: keyof Omit<HandPose, 'spread' | 'thumbOut'>;
  /** MCP joint position in wrist space (x is pre-mirror) */
  x: number; y: number; z: number;
  lengths: [number, number, number];
  /** radius at the knuckle */
  r: number;
  isThumb: boolean;
  /** resting fan angle about the dorsal axis, so the fingers splay even at spread 0 */
  fan: number;
  /** roll of the cross-section about the finger axis (thumb only) */
  roll: number;
}

/**
 * Anthropometry, not symmetry (50th-pct male hand + ~3 mm of glove, in metres, drawn at 1:1 scale):
 * middle finger 86 mm MCP-to-tip, index 78, ring 80, little 63 — the little finger is 73% of the middle
 * and 80% of its diameter. The MCP row is an arc (middle forward, little back) and each finger carries a
 * resting fan angle so they splay. Getting these numbers right is most of the difference between a hand
 * and a bundle of hoses: the previous rig had 100-119 mm fingers of near-equal length lying parallel.
 */
const FINGERS: FingerDef[] = [
  { name: 'index', x: -0.0290, y: 0.0022, z: -0.0930, lengths: [0.0351, 0.0234, 0.0195], r: 0.0100, isThumb: false, fan: 0.150, roll: 0 },
  { name: 'middle', x: -0.0095, y: 0.0030, z: -0.0975, lengths: [0.0387, 0.0258, 0.0215], r: 0.0104, isThumb: false, fan: 0.040, roll: 0 },
  { name: 'ring', x: 0.0100, y: 0.0014, z: -0.0942, lengths: [0.0360, 0.0240, 0.0200], r: 0.0096, isThumb: false, fan: -0.075, roll: 0 },
  { name: 'pinky', x: 0.0288, y: -0.0024, z: -0.0836, lengths: [0.0290, 0.0189, 0.0151], r: 0.0083, isThumb: false, fan: -0.195, roll: 0 },
  { name: 'thumb', x: -0.0350, y: -0.0050, z: -0.0270, lengths: [0.0360, 0.0280, 0.0230], r: 0.0128, isThumb: true, fan: 0, roll: 0.55 },
];

const FINGER_BY_NAME: Record<string, FingerDef> = Object.fromEntries(FINGERS.map((f) => [f.name, f]));
/** the four wrapping fingers, in the order the grip IK solves them */
export const WRAP_FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;

/**
 * Where along each phalanx the palmar contact pad sits (0 = joint, 1 = next joint). Mid-phalanx: that
 * is the point of a curled finger that actually presses on a handguard, and it stays clear of the
 * tip taper so the pad radius below is the real one.
 */
const PAD_FRAC = 0.55;

/**
 * Palmar contact pad of phalanx `s`, in the finger's *rest* frame (axis +Y from the finger base,
 * dorsal +Z) — the same frame `sweptFinger` builds its cross-sections in, so the radius, the palmar
 * flattening and the palmar arc are read straight off that function rather than guessed.
 */
function padRest(f: FingerDef, s: number, out: THREE.Vector3): THREE.Vector3 {
  const [l0, l1] = f.lengths;
  const L = f.lengths[0] + f.lengths[1] + f.lengths[2];
  const start = s === 0 ? 0 : s === 1 ? l0 : l0 + l1;
  const arc = start + f.lengths[s] * PAD_FRAC;
  const t = arc / L;
  const rad = f.r * (1 - 0.26 * t) * (1 + 0.15 * gauss(arc, 0, 0.011));
  // sweptFinger: half-depth b = rad * 0.90, palmar side flattened by 0.86, plus a slight palmar arc
  const palmar = rad * 0.90 * 0.86;
  const cz = -0.085 * f.r * t * t;
  return out.set(0, arc, -palmar + cz);
}

/**
 * Palmar contact points of the palm itself, in wrist space. Read off `palmForm`: the lowest point of
 * ring `t` is `-halfT(t)` plus the cup term, and the ring sits at z = -t * PD.
 */
const PALM_PD = 0.098;
function palmPad(t: number, out: THREE.Vector3): THREE.Vector3 {
  const halfT = 0.0170 + 0.0016 * THREE.MathUtils.smoothstep(t, 0.0, 0.40) - 0.0046 * THREE.MathUtils.smoothstep(t, 0.55, 1);
  return out.set(0, -halfT + 0.0032 * Math.sin(t * Math.PI), -t * PALM_PD);
}
/**
 * Palm sample positions along the metacarpals. Deliberately distal: what lies on a handguard is the
 * distal palm and the base of the fingers, not the heel of the hand — a heel sample pulls the whole
 * grip 3 cm out of place trying to close a gap that is anatomically supposed to be there.
 */
const PALM_T = [0.62, 0.78, 0.93];
/**
 * The palm point a wrapped object is seated against: the distal palm, level with the MCP row. That is
 * where a hand actually holds a bar - the knuckles have to be *on* it, not 20 mm in front of it, or
 * the fingers start past the object and have to curl backwards to reach it. The MCP row is an arc (little
 * finger 84 mm from the wrist, middle 98 mm) so no single station suits every finger; 0.92 measured
 * best across the five weapons, and what it costs is a little finger a few millimetres shy of the
 * fattest handguards. `depth` is how far it sits below the wrist axis and `z` how
 * far in front of the wrist joint, both in metres. The grip solver uses this to place the wrist
 * analytically - a handguard of radius r wants the wrist at (r + depth) out from its axis and `z`
 * back along the fingers - so the IK only ever has millimetres of correction left to do.
 */
export const PALM_SEAT = (() => { const v = new THREE.Vector3(); palmPad(0.92, v); return { depth: -v.y, z: -v.z }; })();

type UVRect = readonly [number, number, number, number];
const uvTo = (g: THREE.BufferGeometry, r: UVRect) => remapUV(g, r[0], r[1], r[2], r[3]);
const smooth01 = (t: number): number => { const c = THREE.MathUtils.clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const gauss = (x: number, c: number, w: number): number => Math.exp(-((x - c) / w) * ((x - c) / w));

/**
 * One finger as a single continuous swept tube. Returns a geometry that already carries `color`,
 * `skinIndex` and `skinWeight`, built in the finger's rest frame (axis +Y, dorsal +Z, base at origin).
 * `boneBase` is the index of this finger's proximal bone in the skeleton.
 */
function sweptFinger(f: FingerDef, boneBase: number): THREE.BufferGeometry {
  const [l0, l1, l2] = f.lengths;
  const j1 = l0, j2 = l0 + l1, L = l0 + l1 + l2;
  const tipR = f.r * 0.92, tipStart = L - tipR;
  const SEG = 12;

  // ring positions: even spacing per phalanx plus extra density inside each joint blend
  const S: number[] = [];
  const span = (a: number, b: number, n: number) => { for (let i = 0; i < n; i++) S.push(a + (b - a) * (i / n)); };
  span(0, j1, 7); span(j1, j2, 5); span(j2, tipStart, 3);
  for (const j of [j1, j2]) for (const d of [-0.0060, -0.0030, -0.0012, 0, 0.0012, 0.0030, 0.0060]) if (j + d > 0 && j + d < tipStart) S.push(j + d);
  for (let i = 0; i <= 5; i++) S.push(tipStart + tipR * (i / 5));
  S.sort((a, b) => a - b);
  const rings: number[] = [];
  for (const s of S) if (rings.length === 0 || s - rings[rings.length - 1] > 0.0007) rings.push(s);

  const jw = 0.0048; // skin blend half-width at each joint
  const skinAt = (s: number): [number, number, number] => {
    if (s <= j1 - jw) return [0, 0, 1];
    if (s < j1 + jw) return [0, 1, 1 - smooth01((s - (j1 - jw)) / (2 * jw))];
    if (s <= j2 - jw) return [1, 1, 1];
    if (s < j2 + jw) return [1, 2, 1 - smooth01((s - (j2 - jw)) / (2 * jw))];
    return [2, 2, 1];
  };

  const pos: number[] = [], uv: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  for (const s of rings) {
    const t = s / L;
    let rad = f.r * (1 - 0.26 * t);
    rad *= 1 + 0.15 * gauss(s, 0.0, 0.011);                    // flare where the finger leaves the palm
    let a = rad * 1.12;                                        // half-width  (local X)
    let b = rad * 0.90;                                        // half-depth  (local Z, dorsal-palmar)
    // joint swells: dorsal only, small enough to stay a crease rather than a bead
    const kn = 0.00130 * gauss(s, j1, 0.0062) + 0.00098 * gauss(s, j2, 0.0052) + 0.00150 * gauss(s, 0.004, 0.0080);
    b += kn * 0.72; a += kn * 0.34;
    let cz = kn * 0.52 - 0.085 * f.r * t * t;                  // dorsal swell, minus a slight palmar arc
    if (s > tipStart) {                                        // rounded, flattened tip pad
      const u = Math.min(1, (s - tipStart) / tipR);
      const k = Math.sqrt(Math.max(0, 1 - u * u));
      a *= k; b *= k * (1 - 0.12 * u); cz -= 0.10 * f.r * u * u;
    }
    const [b0, b1, w0] = skinAt(s);
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;                       // 0 = palmar, PI = dorsal ridge
      const cx = Math.sin(th), cd = -Math.cos(th);
      let pz = b * cd;
      if (pz < 0) pz *= 0.86;                                   // flatten the palmar face
      pos.push(a * cx, s, pz + cz);
      uv.push(i / SEG, t);
      // cavity AO: dark between the fingers (flanks) and on the palmar face, bright along the dorsal ridge
      let sh = 0.90 + 0.18 * Math.max(0, cd);
      sh *= 1 - 0.38 * Math.pow(Math.abs(cx), 3);                // deep crease between adjacent fingers
      sh *= 1 - 0.30 * Math.max(0, -cd);
      sh *= 1 - 0.28 * gauss(s, 0, 0.009);                      // shadow where the finger meets the palm
      sh *= 1 - 0.16 * (gauss(s, j1, 0.0035) + gauss(s, j2, 0.0030)) * Math.max(0, -cd);
      sh = THREE.MathUtils.clamp(sh, 0.34, 1.08);
      col.push(sh, sh, sh);
      si.push(boneBase + b0, boneBase + b1, 0, 0);
      sw.push(w0, 1 - w0, 0, 0);
    }
  }
  const row = SEG + 1;
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < SEG; i++) {
    const p = r * row + i, q = p + 1, c = p + row, d = c + 1;
    idx.push(p, c, q, q, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Float32BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the normals across the uv seam so the closing edge is invisible
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let r = 0; r < rings.length; r++) {
    const p = r * row, q = r * row + SEG;
    const nx = (n.getX(p) + n.getX(q)) / 2, ny = (n.getY(p) + n.getY(q)) / 2, nz = (n.getZ(p) + n.getZ(q)) / 2;
    n.setXYZ(p, nx, ny, nz); n.setXYZ(q, nx, ny, nz);
  }
  uvTo(g, HAND_UV.finger);
  return g;
}

/**
 * Back-of-hand / palm mass as a swept superelliptical form rather than a rounded box. A box, however
 * bevelled, still shows straight silhouette edges and two big flat faces, which is exactly why the old
 * hand read as "a slab with tubes on it". This sweeps 18 cross-sections from the wrist to the knuckle
 * row: width and thickness follow the real taper, the dorsal side carries a transverse dome, a
 * lengthwise arch and four extensor-tendon ripples, and the palmar side is cupped.
 *
 * `panel` returns instead the same surface offset 1.6 mm outward over the metacarpals — a padded dorsal
 * pad that follows the dome exactly instead of being a flat plate glued on top of it.
 */
function palmForm(PD: number, panel: boolean): THREE.BufferGeometry {
  const RINGS = panel ? 10 : 18, SEG = panel ? 16 : 24;
  const t0 = panel ? 0.16 : 0, t1 = panel ? 0.74 : 1;
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const idx: number[] = [];
  const halfW = (t: number) => 0.0288 + 0.0158 * THREE.MathUtils.smoothstep(t, 0.02, 0.62) - 0.0032 * THREE.MathUtils.smoothstep(t, 0.86, 1);
  const halfT = (t: number) => 0.0170 + 0.0016 * THREE.MathUtils.smoothstep(t, 0.0, 0.40) - 0.0046 * THREE.MathUtils.smoothstep(t, 0.55, 1);
  for (let k = 0; k <= RINGS; k++) {
    const t = t0 + (t1 - t0) * (k / RINGS);
    let a = halfW(t), b = halfT(t);
    // round the knuckle end so the outline of the hand is an arc, not a square cut
    let cap = 1;
    if (!panel && t > 0.90) { const u = (t - 0.90) / 0.10; cap = Math.sqrt(Math.max(0, 1 - u * u)); }
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      const cx = Math.cos(th), cy = Math.sin(th);
      const sq = 0.78;                                          // superellipse: fuller than an ellipse, no corners
      let px = a * Math.sign(cx) * Math.pow(Math.abs(cx), sq);
      let py = b * Math.sign(cy) * Math.pow(Math.abs(cy), sq);
      const wq = Math.max(0, 1 - (px / a) * (px / a));
      if (cy > 0) {
        py += 0.0092 * wq * (0.32 + 0.68 * (1 - t));                              // transverse dome
        py += 0.0036 * Math.sin(t * Math.PI) * (0.4 + 0.6 * wq);                  // lengthwise arch
        py += 0.0010 * Math.cos(px * 330) * wq * Math.max(0, 1 - Math.abs(t - 0.55) / 0.5); // extensor tendons
      } else {
        py += 0.0032 * wq * Math.sin(t * Math.PI);                                // cupped palm
      }
      if (panel) {
        // offset only over the dorsal arc, feathered to zero at its edges and ends so the pad melts in
        const arc = Math.max(0, 1 - Math.abs(((th / Math.PI) % 2) - 0.5) / 0.32);
        const ends = Math.min(1, Math.min(t - t0, t1 - t) / 0.09);
        const k = smooth01(arc) * smooth01(Math.max(0, ends));
        px += px * 0.02 * k; py += 0.0021 * k;
      }
      px *= cap; py *= cap;
      pos.push(px, py, -t * PD);
      uv.push(i / SEG, t);
      // cavity AO: dark under the palm and along the flanks, bright over the dorsal vault
      let sh = 0.92 + 0.14 * Math.max(0, cy) - 0.28 * Math.max(0, -cy);
      sh *= 1 - 0.22 * Math.pow(Math.abs(cx), 4);
      col.push(sh, sh, sh);
    }
  }
  const row = SEG + 1;
  for (let k = 0; k < RINGS; k++) for (let i = 0; i < SEG; i++) {
    const p = k * row + i, q = p + 1, c = p + row, d = c + 1;
    idx.push(p, q, c, q, d, c);
  }
  if (!panel) {
    // close both ends (the wrist end is inside the cuff, the knuckle end is inside the finger bases)
    for (const [ring, flip] of [[0, false], [RINGS, true]] as const) {
      const centre = pos.length / 3;
      pos.push(0, 0, -(t0 + (t1 - t0) * (ring / RINGS)) * PD); uv.push(0.5, ring / RINGS); col.push(0.55, 0.55, 0.55);
      for (let i = 0; i < SEG; i++) {
        const a0 = ring * row + i, b0 = a0 + 1;
        if (flip) idx.push(a0, b0, centre); else idx.push(b0, a0, centre);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let k = 0; k <= RINGS; k++) {
    const p = k * row, q = k * row + SEG;
    const nx = (n.getX(p) + n.getX(q)) / 2, ny = (n.getY(p) + n.getY(q)) / 2, nz = (n.getZ(p) + n.getZ(q)) / 2;
    n.setXYZ(p, nx, ny, nz); n.setXYZ(q, nx, ny, nz);
  }
  return g;
}

/**
 * Forearm sleeve: elliptical tube along +Y from 0 (wrist) to `len` (elbow).
 *
 * Three things keep it from reading as a smooth pale tube, which is what a plain swept ellipse always
 * reads as no matter how many wrinkles are painted on it:
 *
 *  1. The cross-section is NOT an ellipse. Three low-frequency lobes with amplitudes around 8% of the
 *     radius rotate slowly along the arm, so every section is a different irregular shape and the
 *     silhouette wanders instead of tapering cleanly.
 *  2. A bunch of cloth is pushed up above the cuff, with a hard leading hem: the radius steps out over
 *     two rings and then falls away slowly. The occluding contour that step makes is the single
 *     strongest "this is fabric" cue at hip-fire distance.
 *  3. The first third of the tube is skinned across BOTH the wrist and the forearm bone on a graded
 *     weight, so linear-blend skinning pinches the inside of a bend and stretches the outside — folds
 *     that appear and vanish with the wrist angle rather than baked ones that never change. It also
 *     locks the tube's mouth to the cuff so no gap can open.
 *
 * Vertex colour bakes AO from the local radius (fold valleys go dark) and darkens toward the elbow, so
 * the limb has internal value range and stays below the glove: the hand must be the brightest thing on
 * the arm or the eye goes to the forearm instead of the weapon.
 */
function forearmTube(len: number, phase: number, wristBone: number, forearmBone: number): THREE.BufferGeometry {
  const radSeg = 22, lenSeg = 24;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], si: number[] = [], sw: number[] = [], col: number[] = [];
  /** wrist share of the skin weight: 0.86 at the cuff, gone by a third of the way to the elbow */
  const wristW = (t: number) => 0.86 * (1 - smooth01(t / 0.34));
  const [u0, u1] = [HAND_UV.sleeve[0], HAND_UV.sleeve[1]];
  const bump = (t: number, c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w);
  for (let j = 0; j <= lenSeg; j++) {
    const t = j / lenSeg;
    const y = t * len;
    let r = 0.0258 + 0.0060 * THREE.MathUtils.smoothstep(t, 0.06, 0.78) - 0.0030 * THREE.MathUtils.smoothstep(t, 0.88, 1.0);
    // bunched cloth above the cuff: a hard hem that steps out over two rings, then falls away
    r += 0.0052 * (THREE.MathUtils.smoothstep(t, 0.115, 0.155) - THREE.MathUtils.smoothstep(t, 0.30, 0.52));
    // wrinkles: cloth also bunches at the elbow crease
    const amp = 0.028 + 0.036 * bump(t, 0.22, 0.14) + 0.040 * bump(t, 0.52, 0.18) + 0.050 * bump(t, 0.88, 0.14);
    // the forearm is not a cone: it drifts off axis so the silhouette has some life in it
    const dx = 0.0075 * Math.sin(t * 2.1 + phase) * t, dz = 0.0045 * Math.sin(t * 1.6 + phase * 1.7) * t;
    for (let i = 0; i <= radSeg; i++) {
      const a = (i / radSeg) * Math.PI * 2;
      // shape: slow lobes that rotate along the arm, so no two cross-sections are the same ellipse
      const lobe = 0.082 * Math.sin(a * 2 + t * 2.4 + phase) + 0.056 * Math.sin(a * 3 - t * 1.8 + phase * 1.7) + 0.034 * Math.sin(a + t * 3.3 + 2.0);
      const wr = 1 + lobe + amp * (0.55 * Math.sin(a * 3 + t * 13 + phase) + 0.40 * Math.sin(a * 5 - t * 19 + 1.3 + phase) + 0.28 * Math.sin(a * 8 + t * 31) + 0.20 * Math.sin(a * 2 + t * 47 + phase * 2));
      pos.push(Math.cos(a) * r * wr * 1.10 + dx, y, Math.sin(a) * r * wr * 0.94 + dz);
      uv.push(u0 + (i / radSeg) * (u1 - u0), t * 1.0);
      const w = wristW(t);
      si.push(wristBone, forearmBone, 0, 0); sw.push(w, 1 - w, 0, 0);
      // AO from the local radius (valleys dark, crests light) + a gradient into the body's shadow
      // 0.66 base, not 1.0: the sleeve is a big convex form facing the sky, so at equal albedo it
      // out-reads the hand. Vertex colour scales diffuse only, so this darkens the cloth without
      // flattening the specular that the lobes and creases are there to catch.
      let sh = 0.66 + 1.15 * (wr - 1);
      sh *= 1 - 0.12 * smooth01(1 - t / 0.22);              // the mouth sits in the cuff's shadow
      sh *= 1 - 0.34 * smooth01((t - 0.30) / 0.70);          // the elbow end is deeper into the sleeve
      col.push(sh, sh, sh);
    }
  }
  const row = radSeg + 1;
  for (let j = 0; j < lenSeg; j++) for (let i = 0; i < radSeg; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // elbow cap (dark interior of the sleeve, only ever seen in reload extremes)
  const capC = pos.length / 3;
  pos.push(0, len, 0); uv.push((u0 + u1) / 2, 1);
  si.push(forearmBone, forearmBone, 0, 0); sw.push(1, 0, 0, 0); col.push(0.30, 0.30, 0.30);
  for (let i = 0; i < radSeg; i++) { const a = lenSeg * row + i; idx.push(a, a + 1, capC); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Float32BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the UV-seam normals so the seam is invisible
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let j = 0; j <= lenSeg; j++) {
    const a = j * row, b = j * row + radSeg;
    const nx = (n.getX(a) + n.getX(b)) / 2, ny = (n.getY(a) + n.getY(b)) / 2, nz = (n.getZ(a) + n.getZ(b)) / 2;
    n.setXYZ(a, nx, ny, nz); n.setXYZ(b, nx, ny, nz);
  }
  return g;
}

const _v3 = new THREE.Vector3(); const _v3b = new THREE.Vector3();
// grip-IK scratch (see fingerPads)
const _dir = new THREE.Vector3(), _pad = new THREE.Vector3(), _fkPos = new THREE.Vector3(), _step = new THREE.Vector3();
const _qGeo = new THREE.Quaternion(), _qSwing = new THREE.Quaternion(), _fkQ = new THREE.Quaternion(), _qJoint = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _yAxis = new THREE.Vector3(0, 1, 0);
/** MCP splay per finger, index..pinky (see applyPose) */
const FINGER_SPREAD = [1.5, 0.45, -0.55, -1.6];
const KEEP = new Set(['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight']);

export class Hand {
  root = new THREE.Group();
  skin: THREE.SkinnedMesh;
  private bones: Record<string, THREE.Bone[]> = {};
  private fan: Record<string, number> = {};
  private wrist: THREE.Bone;
  private forearm: THREE.Bone;
  private cur: HandPose;
  private target: HandPose;
  readonly side: 'left' | 'right';
  readonly triangles: number;

  constructor(mats: WeaponMaterials, side: 'left' | 'right') {
    this.side = side;
    const mirror = side === 'left' ? -1 : 1;
    const geos: THREE.BufferGeometry[] = [];
    const boneList: THREE.Bone[] = [];
    const strip = (g: THREE.BufferGeometry) => { for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k); };
    /** rigidly bind a geometry to one bone with a flat vertex shade */
    const push = (g: THREE.BufferGeometry, bone: number, shade = 1) => {
      const ng = g.index ? g.toNonIndexed() : g;
      const n = ng.getAttribute('position').count;
      const col = new Float32Array(n * 3); col.fill(shade);
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) { si[v * 4] = bone; sw[v * 4] = 1; }
      ng.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      ng.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      strip(ng); geos.push(ng);
    };
    /** a geometry that already carries color + skinIndex + skinWeight */
    const pushSkinned = (g: THREE.BufferGeometry) => { const ng = g.index ? g.toNonIndexed() : g; strip(ng); geos.push(ng); };
    /** a geometry that carries its own baked `color`; bound rigidly to one bone and scaled by `shade` */
    const pushColoured = (g: THREE.BufferGeometry, bone: number, shade = 1) => {
      const ng = g.index ? g.toNonIndexed() : g;
      const n = ng.getAttribute('position').count;
      const col = ng.getAttribute('color') as THREE.BufferAttribute;
      for (let v = 0; v < n; v++) col.setXYZ(v, col.getX(v) * shade, col.getY(v) * shade, col.getZ(v) * shade);
      const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) { si[v * 4] = bone; sw[v * 4] = 1; }
      ng.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      ng.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      strip(ng); geos.push(ng);
    };

    const wrist = new THREE.Bone(); wrist.name = `${side}_wrist`;
    boneList.push(wrist); this.wrist = wrist;
    const forearm = new THREE.Bone(); forearm.name = `${side}_forearm`;
    forearm.position.set(0, 0.0, 0.020);
    wrist.add(forearm); boneList.push(forearm); this.forearm = forearm;

    // ---- palm: swept superelliptical form (see palmForm) — no flat faces, no straight silhouette edges
    const PD = 0.098;
    const palm = palmForm(PD, false);
    uvTo(palm, HAND_UV.leather);
    pushColoured(palm, 0, 0.94);
    // padded dorsal pad, generated from the same surface so it follows the dome instead of sitting on it
    const dorsal = palmForm(PD, true);
    uvTo(dorsal, HAND_UV.nylon);
    pushColoured(dorsal, 0, 1.0);
    // heel of the palm + ulna head (the wrist is squarer than an ellipsoid; the styloid shows)
    const heel = ellipsoid(0.0362, 0.0172, 0.0272, 12, 8); uvTo(heel, HAND_UV.leather);
    xform(heel, [0.002 * mirror, -0.0012, -0.011]);
    push(heel, 0, 0.92);
    const ulna = ellipsoid(0.0098, 0.0076, 0.0104, 8, 6); uvTo(ulna, HAND_UV.leather);
    xform(ulna, [0.0308 * mirror, 0.0082, 0.0055]);
    push(ulna, 0, 1.0);
    // thenar (thumb muscle) and hypothenar bulges
    const thenar = capsule(0.0165, 0.034, 2, 9); uvTo(thenar, HAND_UV.leather);
    xform(thenar, [-0.0300 * mirror, -0.0074, -0.035], [Math.PI / 2 - 0.35, 0, -0.55 * mirror]);
    push(thenar, 0, 0.90);
    const hypo = capsule(0.0124, 0.043, 2, 9); uvTo(hypo, HAND_UV.leather);
    xform(hypo, [0.0316 * mirror, -0.0072, -0.052], [Math.PI / 2, 0, 0.08 * mirror]);
    push(hypo, 0, 0.90);
    // webbing between the finger bases (deep cavity: this is the dark line that separates the fingers)
    for (let i = 0; i < 3; i++) {
      const a = FINGERS[i], b = FINGERS[i + 1];
      const wb = new RoundedBoxGeometry(0.0100, 0.0135, 0.0165, 1, 0.003); uvTo(wb, HAND_UV.leather);
      xform(wb, [((a.x + b.x) / 2) * mirror, -0.0015, (a.z + b.z) / 2 + 0.005]);
      push(wb, 0, 0.42);
    }
    // ---- knuckle line: four hard TPR caps sitting ~4 mm proud of the dorsal surface, so the back of the
    // hand has a bumpy contour in silhouette instead of reading as a smooth ovoid.
    /** z of the MCP row at a given (mirrored) x — the knuckle line is an arc, not a straight bar */
    const knuckleZ = (x: number): number => {
      const pts = FINGERS.filter((f) => !f.isThumb).map((f) => [f.x * mirror, f.z] as const).sort((a, b) => a[0] - b[0]);
      if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
        const u = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u;
      }
      return pts[pts.length - 1][1];
    };
    for (const f of FINGERS) {
      if (f.isThumb) continue;
      const cap = ellipsoid(f.r * 1.66, 0.0058, f.r * 1.95, 10, 8); uvTo(cap, HAND_UV.shell);
      deform(cap, (p) => { if (p.y < 0) p.y *= 0.45; });                                  // flat underside, domed top
      xform(cap, [f.x * mirror, 0.0128, f.z + 0.0098]);
      push(cap, 0, 1.0);
    }
    // low bridging bar so the four caps read as one guard, not four warts; it follows the knuckle arc
    const bridge = new RoundedBoxGeometry(0.0700, 0.0062, 0.0190, 3, 0.0030); uvTo(bridge, HAND_UV.shell);
    deform(bridge, (p) => { p.z += knuckleZ(p.x) + 0.0100; p.y -= 0.0022 * (Math.abs(p.x) / 0.035) ** 2; });
    xform(bridge, [0, 0.0122, 0]);
    push(bridge, 0, 0.94);

    // ---- cuff: a stepped gauntlet lip. This is the hard glove->sleeve edge; the sleeve underneath is
    // deliberately narrower than the lip so there is an occluding contour and a value break, not a blend.
    const cuff = lathe([[0.0268, 0.002], [0.0300, 0.006], [0.0308, 0.025], [0.0312, 0.030], [0.0338, 0.033], [0.0338, 0.038], [0.0292, 0.040], [0.0262, 0.040]], 22);
    uvTo(cuff, HAND_UV.cuff);
    xform(cuff, [0, 0, 0.0], [Math.PI / 2, 0, 0]);
    deform(cuff, (p) => { p.x *= 1.11; p.y *= 0.93; });
    push(cuff, 0, 0.96);
    // velcro closure: a wide flat band around the cuff (a thin torus read as a floating wire hoop) + pull tab
    const strap = lathe([[0.0316, 0.0], [0.0346, 0.0020], [0.0346, 0.0128], [0.0316, 0.0148]], 22); uvTo(strap, HAND_UV.cuff);
    xform(strap, [0, 0, 0.0105], [Math.PI / 2, 0, 0]);
    deform(strap, (p) => { p.x *= 1.11; p.y *= 0.93; });
    push(strap, 0, 0.86);
    const tab = new RoundedBoxGeometry(0.0165, 0.0125, 0.0036, 1, 0.0012); uvTo(tab, HAND_UV.shell);
    xform(tab, [-0.0300 * mirror, 0.0130, 0.0175], [0, 0, -0.35 * mirror]);
    push(tab, 0, 1.0);
    // Cuff plug, bound to the WRIST so it fills the gauntlet bore at every wrist angle. Without it a bent
    // wrist swings the sleeve out of the cuff and the open lip reads as a floating hoop. Its tail is domed
    // and deep in shadow so it reads as cloth disappearing into the cuff, not as a lid on a jar.
    const plug = lathe([[0, -0.006], [0.0250, -0.006], [0.0250, 0.028], [0.0238, 0.036], [0.0198, 0.043], [0.0118, 0.048], [0, 0.050]], 18);
    uvTo(plug, HAND_UV.sleeve);
    xform(plug, [0, 0, 0], [Math.PI / 2, 0, 0]);
    deform(plug, (p) => { p.x *= 1.10; p.y *= 0.93; });
    push(plug, 0, 0.30);
    // joint filler on the forearm bone so the sleeve never separates from the cuff
    const fill = ellipsoid(0.0252, 0.0230, 0.0224, 12, 8); uvTo(fill, HAND_UV.sleeve);
    xform(fill, [0, 0, 0.016]);
    push(fill, 1, 0.72);
    // sleeve (bound to the forearm bone, built along +Y and rotated at runtime toward the elbow)
    const sleeve = forearmTube(0.185, side === 'left' ? 1.7 : 0.2, 0, 1);
    sleeve.translate(0, 0, 0.020);
    pushSkinned(sleeve);

    // ---- fingers: one continuous swept tube each
    for (const f of FINGERS) {
      const chain: THREE.Bone[] = [];
      let parent: THREE.Object3D = wrist;
      const base = new THREE.Vector3(f.x * mirror, f.y, f.z);
      const dir = new THREE.Vector3(0, 0, -1);
      if (f.isThumb) dir.set(-0.72 * mirror, -0.18, -0.67).normalize();
      const boneBase = boneList.length;
      for (let s = 0; s < 3; s++) {
        const b = new THREE.Bone(); b.name = `${side}_${f.name}_${s}`;
        if (s === 0) b.position.copy(base); else b.position.copy(dir).multiplyScalar(f.lengths[s - 1]);
        parent.add(b); parent = b; chain.push(b); boneList.push(b);
      }
      const g = sweptFinger(f, boneBase);
      // rest frame -> wrist space: roll the cross-section, swing +Y onto `dir`, drop on the MCP
      if (f.roll) g.applyMatrix4(new THREE.Matrix4().makeRotationY(f.roll * mirror));
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      g.translate(base.x, base.y, base.z);
      pushSkinned(g);
      this.bones[f.name] = chain;
      this.fan[f.name] = f.fan * mirror;
    }

    // ---- merge
    for (const g of geos) if (!g.getAttribute('normal')) g.computeVertexNormals();
    const merged = mergeGeometries(geos, false)!;
    merged.computeBoundingSphere();
    this.skin = new THREE.SkinnedMesh(merged, mats.glove);
    this.skin.name = `${side}_hand`;
    this.skin.castShadow = true; this.skin.receiveShadow = true; this.skin.frustumCulled = false;
    this.skin.add(wrist);
    wrist.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(boneList);
    this.skin.bind(skeleton);
    this.skin.scale.setScalar(1.0);
    this.root.add(this.skin);
    this.triangles = merged.getAttribute('position').count / 3;

    this.cur = clonePose(HAND_POSES.open);
    this.target = clonePose(HAND_POSES.open);
    this.applyPose(this.cur);
  }

  setPose(p: HandPose): void { this.target = p; }
  snap(p: HandPose): void { this.target = p; this.cur = clonePose(p); this.applyPose(this.cur); }

  update(dt: number, speed = 18): void {
    const k = 1 - Math.exp(-speed * dt);
    for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) for (let i = 0; i < 3; i++) this.cur[f][i] += (this.target[f][i] - this.cur[f][i]) * k;
    this.cur.spread += (this.target.spread - this.cur.spread) * k;
    this.cur.thumbOut += (this.target.thumbOut - this.cur.thumbOut) * k;
    this.applyPose(this.cur);
  }

  // ---------------------------------------------------------------- grip IK support
  /**
   * Extra curl the grip solver has added at each joint of each wrapping finger, in radians. The pose
   * tables describe the *shape* of a grip; this is how much the shape has to open or close for the
   * fingers to actually land on the thing being held. Applied on top of `cur` in `applyPose`, so it
   * survives the pose damping and is visible in the same frame it is solved.
   */
  readonly wrap: Record<string, [number, number, number]> = { index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0] };
  clearWrap(): void { for (const n of WRAP_FINGERS) { const w = this.wrap[n]; w[0] = 0; w[1] = 0; w[2] = 0; } }
  /** Re-apply the current pose (after the solver has written into `wrap`). */
  refresh(): void { this.applyPose(this.cur); }
  /** The pose currently on the bones (read-only use). */
  get pose(): HandPose { return this.cur; }
  /** Posed curl of one joint, before `wrap` (radians). */
  curlOf(name: string, joint: number): number { return (this.cur as unknown as Record<string, FingerCurl>)[name][joint]; }

  /**
   * Forward kinematics for one finger: the joint rotations are rebuilt exactly as `applyPose` builds
   * them (same Euler order, same fan/spread/thumb terms) plus `extra` on each joint's curl, and the
   * three palmar pads are written into `out` in wrist space. Costs three quaternion products, so the
   * solver can call it a few hundred times a frame without noticing.
   */
  fingerPads(name: string, extra: readonly number[], out: THREE.Vector3[]): void {
    const f = FINGER_BY_NAME[name];
    const mirror = this.side === 'left' ? -1 : 1;
    _dir.set(0, 0, -1);
    if (f.isThumb) _dir.set(-0.72 * mirror, -0.18, -0.67).normalize();
    // rest frame -> wrist space, exactly as the constructor orients the geometry
    _qGeo.identity();
    if (f.roll) _qGeo.setFromAxisAngle(_yAxis, f.roll * mirror);
    _qSwing.setFromUnitVectors(_yAxis, _dir);
    _qGeo.premultiply(_qSwing);
    _fkPos.set(f.x * mirror, f.y, f.z);
    _fkQ.identity();
    for (let s = 0; s < 3; s++) {
      _fkQ.multiply(this.jointQuat(f, s, extra[s] ?? 0, _qJoint));
      const start = s === 0 ? 0 : s === 1 ? f.lengths[0] : f.lengths[0] + f.lengths[1];
      padRest(f, s, _pad).applyQuaternion(_qGeo).addScaledVector(_dir, -start);
      out[s].copy(_pad).applyQuaternion(_fkQ).add(_fkPos);
      _fkPos.addScaledVector(_step.copy(_dir).applyQuaternion(_fkQ), f.lengths[s]);
    }
  }

  /** Palm contact points in wrist space (rigid: the palm is bound to the wrist bone). */
  palmPads(out: THREE.Vector3[]): void {
    for (let i = 0; i < PALM_T.length; i++) palmPad(PALM_T[i], out[i]);
  }

  private jointQuat(f: FingerDef, s: number, extra: number, out: THREE.Quaternion): THREE.Quaternion {
    const mirror = this.side === 'left' ? -1 : 1;
    const p = this.cur;
    if (f.isThumb) {
      const c = p.thumb[s];
      _euler.set(-(c * 0.9 + extra), s === 0 ? -0.9 * mirror * p.thumbOut : 0, s === 0 ? -0.45 * mirror * p.thumb[0] : -0.2 * mirror * c);
    } else {
      const fi = WRAP_FINGERS.indexOf(f.name as (typeof WRAP_FINGERS)[number]);
      const curl = (p as unknown as Record<string, FingerCurl>)[f.name][s];
      _euler.set(-(curl + extra), s === 0 ? this.fan[f.name] - FINGER_SPREAD[fi] * p.spread * mirror : 0, 0);
    }
    return out.setFromEuler(_euler);
  }

  private applyPose(p: HandPose): void {
    const mirror = this.side === 'left' ? -1 : 1;
    const fingerSpread = FINGER_SPREAD;
    (['index', 'middle', 'ring', 'pinky'] as const).forEach((name, fi) => {
      const chain = this.bones[name];
      const curl = p[name];
      const w = this.wrap[name];
      for (let i = 0; i < 3; i++) {
        const b = chain[i];
        b.rotation.set(0, 0, 0);
        b.rotation.x = -(curl[i] + w[i]);        // curl toward the palm (-Y); `wrap` is the grip solve
        // the fan is a rest property of the hand, not of the pose, so fingers never lie parallel
        if (i === 0) b.rotation.y = this.fan[name] - fingerSpread[fi] * p.spread * mirror;
      }
    });
    const th = this.bones.thumb;
    for (let i = 0; i < 3; i++) {
      const b = th[i];
      b.rotation.set(0, 0, 0);
      b.rotation.y = (i === 0 ? -0.9 * mirror * p.thumbOut : 0);
      b.rotation.x = -p.thumb[i] * 0.9;
      b.rotation.z = (i === 0 ? -0.45 * mirror * p.thumb[0] : -0.2 * mirror * p.thumb[i]);
    }
  }

  /**
   * Place the hand so its fingers point along `fingers` and the back of the hand faces `back` (parent
   * space). `elbow` = direction the forearm leaves the wrist; `sleeve` shortens the forearm (1 = full),
   * which is how a two-handed pistol grip keeps the arms out of the sight picture.
   */
  orient(pos: V3, fingers: V3, back: V3, elbow?: V3, sleeve = 1): void {
    const z = new THREE.Vector3(-fingers[0], -fingers[1], -fingers[2]).normalize();
    const y = new THREE.Vector3(back[0], back[1], back[2]);
    y.addScaledVector(z, -y.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    this.root.quaternion.setFromRotationMatrix(m);
    this.root.position.set(pos[0], pos[1], pos[2]);
    const e = elbow ? new THREE.Vector3(elbow[0], elbow[1], elbow[2]).applyQuaternion(this.root.quaternion.clone().invert()) : new THREE.Vector3(0, -0.25, 1);
    e.normalize();
    // forearm bone: +Y of the sleeve tube -> elbow direction (limit the bend so the wrist never folds flat)
    const rest = new THREE.Vector3(0, -0.2, 1).normalize();
    const ang = rest.angleTo(e);
    if (ang > 1.30) e.copy(rest).lerp(e, 1.30 / ang).normalize();
    this.forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), e);
    // The forearm has to leave the frame through a lower corner. It must never run at the eye (a 7 cm
    // tube pointed at the camera fills a third of the screen) and it must never lie flat across the
    // sight picture, so clamp it in gun space: always heading down, and away from the view axis.
    const w = _v3.set(0, 1, 0).applyQuaternion(this.forearm.quaternion).applyQuaternion(this.root.quaternion);
    const sign = this.side === 'left' ? -1 : 1;
    let fixed = false;
    if (w.y > -0.55) { w.y = -0.55; fixed = true; }
    if (w.z > 0.04 && Math.abs(w.x) < 0.46) { w.x = 0.46 * sign; fixed = true; }
    if (fixed) {
      const inv = this.root.quaternion.clone().invert();
      this.forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v3b.copy(w).normalize().applyQuaternion(inv).normalize());
    }
    // scaling the forearm bone shortens the sleeve without touching the hand it carries
    this.forearm.scale.set(1, sleeve, 1);
  }

  get wristBone(): THREE.Bone { return this.wrist; }
}

export function clonePose(p: HandPose): HandPose {
  return { thumb: [...p.thumb], index: [...p.index], middle: [...p.middle], ring: [...p.ring], pinky: [...p.pinky], spread: p.spread, thumbOut: p.thumbOut };
}
