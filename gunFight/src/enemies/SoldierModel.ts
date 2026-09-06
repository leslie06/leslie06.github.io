/**
 * Soldier character built entirely in code: a 22-bone skeleton + one SkinnedMesh with seven material
 * groups (camo cloth, nylon gear, rubber/black nylon, skin, gun metal, rifle furniture, eyes) plus a
 * contact-shadow blob, so an enemy costs eight draw calls. Geometry is authored in bind space
 * (facing -Z, right side +X, feet on y=0) from lofted elliptical cross-sections (torso, limbs, neck,
 * jaw), a displaced-sphere skull, rounded boxes for gear and ribbons for straps. Skinning is rigid
 * per bone or blended along a bone chain (torso) / across a joint (elbows, knees). UVs are
 * planar-projected in world scale so cloth patterns are continuous across parts.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARCHETYPES, SKELETON as S, type ArchetypeDef } from './EnemyDefs';
import { SLOT, SLOT_COUNT, blobMaterial } from './Materials';

export const BONE_NAMES = [
  'root', 'hips', 'spine1', 'spine2', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'forearmL', 'handL', 'clavR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'rifle', 'eyeL', 'eyeR',
] as const;
export type BoneName = typeof BONE_NAMES[number];
export const B: Record<BoneName, number> = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Bind-space joint positions (world, root at origin). */
export const JOINT: Record<BoneName, THREE.Vector3> = {
  root: new THREE.Vector3(0, 0, 0),
  hips: new THREE.Vector3(0, S.hipsY, 0),
  spine1: new THREE.Vector3(0, S.spine1Y, 0),
  spine2: new THREE.Vector3(0, S.spine2Y, 0),
  chest: new THREE.Vector3(0, S.chestY, 0),
  neck: new THREE.Vector3(0, S.neckY, 0),
  head: new THREE.Vector3(0, S.headY, 0),
  clavL: new THREE.Vector3(-0.07, S.shoulderY + 0.015, 0),
  upperArmL: new THREE.Vector3(-S.shoulderX, S.shoulderY, 0),
  forearmL: new THREE.Vector3(-S.shoulderX - 0.02, S.shoulderY - S.upperArmLen, 0),
  handL: new THREE.Vector3(-S.shoulderX - 0.03, S.shoulderY - S.upperArmLen - S.forearmLen, 0),
  clavR: new THREE.Vector3(0.07, S.shoulderY + 0.015, 0),
  upperArmR: new THREE.Vector3(S.shoulderX, S.shoulderY, 0),
  forearmR: new THREE.Vector3(S.shoulderX + 0.02, S.shoulderY - S.upperArmLen, 0),
  handR: new THREE.Vector3(S.shoulderX + 0.03, S.shoulderY - S.upperArmLen - S.forearmLen, 0),
  thighL: new THREE.Vector3(-S.hipX, S.hipsY, 0),
  shinL: new THREE.Vector3(-S.hipX - 0.008, S.hipsY - S.thighLen, 0),
  footL: new THREE.Vector3(-S.hipX - 0.012, S.ankleY, 0),
  thighR: new THREE.Vector3(S.hipX, S.hipsY, 0),
  shinR: new THREE.Vector3(S.hipX + 0.008, S.hipsY - S.thighLen, 0),
  footR: new THREE.Vector3(S.hipX + 0.012, S.ankleY, 0),
  rifle: new THREE.Vector3(0.12, 1.25, -0.2),
  // eyeball centres: their own bones so the animator can aim the gaze independently of the head
  eyeL: new THREE.Vector3(-0.0325, 1.7025, -0.058),
  eyeR: new THREE.Vector3(0.0325, 1.7025, -0.058),
};
export const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine1: 'hips', spine2: 'spine1', chest: 'spine2', neck: 'chest', head: 'neck',
  clavL: 'chest', upperArmL: 'clavL', forearmL: 'upperArmL', handL: 'forearmL',
  clavR: 'chest', upperArmR: 'clavR', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', rifle: 'root',
  eyeL: 'head', eyeR: 'head',
};

/** Rifle-local reference points (rifle bone origin = top of pistol grip, barrel along -Z). */
export const RIFLE = {
  muzzle: new THREE.Vector3(0, 0.055, -0.75),
  grip: new THREE.Vector3(0.0, -0.035, 0.005),
  foregrip: new THREE.Vector3(-0.005, 0.01, -0.42),
  magwell: new THREE.Vector3(0, -0.09, -0.16),
  stockButt: new THREE.Vector3(0, 0.03, 0.27),
  /** where the shooter's aiming eye sits when cheek-welded: above the rear of the receiver */
  eyeLine: new THREE.Vector3(0, 0.12, 0.02),
  /** wrist positions for the two hands (see Animator) */
  handR: new THREE.Vector3(0.028, -0.008, 0.052),
  handL: new THREE.Vector3(-0.03, -0.014, -0.30),
};

/** Head-local (bone space) positions used by the animator for the cheek weld / eye. */
export const HEAD = {
  eyeR: new THREE.Vector3(0.033, 0.1015, -0.0645),
  centre: new THREE.Vector3(0, 0.1, 0.004),
};

export interface SoldierRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  muzzle: THREE.Object3D;
  /** ground contact-shadow blob (child of root) */
  blob: THREE.Mesh;
  archetype: ArchetypeDef;
}

type SkinFn = (x: number, y: number, z: number) => [number, number, number, number];
const rigid = (b: number): SkinFn => () => [b, 0, 1, 0];
/** Weight by height along a chain of (bone, y) pairs sorted ascending. */
function chain(pairs: [number, number][]): SkinFn {
  return (_x, y) => {
    if (y <= pairs[0][1]) return [pairs[0][0], 0, 1, 0];
    for (let i = 0; i < pairs.length - 1; i++) {
      const [b0, y0] = pairs[i], [b1, y1] = pairs[i + 1];
      if (y <= y1) { const t = (y - y0) / (y1 - y0); const s = t * t * (3 - 2 * t); return [b0, b1, 1 - s, s]; }
    }
    return [pairs[pairs.length - 1][0], 0, 1, 0];
  };
}
const UV_SCALE = [0.7, 0.4, 0.3, 0.35, 0.22, 0.25, 1]; // metres per texture repeat per slot

// ------------------------------------------------------------------------------------------------
// geometry primitives
// ------------------------------------------------------------------------------------------------

interface Ring { y: number; rx: number; rz: number; cx?: number; cz?: number }

/** Lofted tube of elliptical cross-sections along +Y with smooth normals. */
function loft(rings: Ring[], radial = 16, capTop = false, capBottom = false): THREE.BufferGeometry {
  const pos: number[] = []; const idx: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      pos.push((r.cx ?? 0) + Math.cos(a) * r.rx, r.y, (r.cz ?? 0) + Math.sin(a) * r.rz);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < radial; i++) {
      const a = k * radial + i, b = k * radial + (i + 1) % radial, c = a + radial, d = b + radial;
      // outward winding: ring goes +x -> +z (counter-clockwise seen from above); face outward needs (a, c, b) order
      idx.push(a, c, b, b, c, d);
    }
  }
  const capFan = (k: number, up: boolean) => {
    const r = rings[k]; const ci = pos.length / 3;
    pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
    for (let i = 0; i < radial; i++) { const a = k * radial + i, b = k * radial + (i + 1) % radial; if (up) idx.push(ci, a, b); else idx.push(ci, b, a); }
  };
  if (capTop) capFan(rings.length - 1, true);
  if (capBottom) capFan(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ring spec for a limb loft: `s` metres from `a` along the a->b axis (may exceed the segment). */
interface LimbRing { s: number; rx: number; rz: number; cx?: number; cz?: number }
/** Loft along the axis a->b. Local x = world right (⟂ axis), local z = world front (-Z) or up when the axis is horizontal along Z. */
function limbLoft(a: THREE.Vector3, b: THREE.Vector3, rings: LimbRing[], radial = 16, capEnd = false, capStart = false): THREE.BufferGeometry {
  const g = loft(rings.map((r) => ({ y: r.s, rx: r.rx, rz: r.rz, cx: r.cx, cz: r.cz })), radial, capEnd, capStart);
  const axis = new THREE.Vector3().subVectors(b, a).normalize();
  const ref = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
  const front = ref.clone().addScaledVector(axis, -ref.dot(axis)).normalize();
  const right = new THREE.Vector3().crossVectors(axis, front).normalize();
  // local +z should map to `front` (world -Z for vertical limbs => cz negative = forward, matching Ring convention where +z is back)
  const m = new THREE.Matrix4().makeBasis(right, axis, front.negate());
  m.setPosition(a);
  g.applyMatrix4(m);
  return g;
}

/** Flat strap along a smoothed path. `normalAt` gives the strap's face normal at a point. */
function ribbon(points: THREE.Vector3[], width: number, thick: number, normalAt: (p: THREE.Vector3, i: number, n: number) => THREE.Vector3, samples = 12): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const pts = curve.getPoints(samples);
  const pos: number[] = []; const nor: number[] = [];
  const frames: { p: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3 }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = new THREE.Vector3().subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    const n = normalAt(p, i, pts.length).clone(); n.addScaledVector(t, -n.dot(t)).normalize();
    const b = new THREE.Vector3().crossVectors(t, n).normalize();
    frames.push({ p, n, b });
  }
  const corner = (f: typeof frames[0], sb: number, sn: number) => new THREE.Vector3().copy(f.p).addScaledVector(f.b, sb * width / 2).addScaledVector(f.n, sn * thick / 2);
  const quad = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, n: THREE.Vector3) => {
    for (const p of [p0, p1, p2, p0, p2, p3]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); }
  };
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i], f1 = frames[i + 1];
    // top (+n), bottom (-n), sides (±b)
    quad(corner(f0, -1, 1), corner(f0, 1, 1), corner(f1, 1, 1), corner(f1, -1, 1), f0.n);
    quad(corner(f0, 1, -1), corner(f0, -1, -1), corner(f1, -1, -1), corner(f1, 1, -1), f0.n.clone().negate());
    quad(corner(f0, 1, 1), corner(f0, 1, -1), corner(f1, 1, -1), corner(f1, 1, 1), f0.b);
    quad(corner(f0, -1, -1), corner(f0, -1, 1), corner(f1, -1, 1), corner(f1, -1, -1), f0.b.clone().negate());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Cranium: a sphere displaced in unit space (flattened face plane, eye sockets, brow shelf, cheek
 * taper toward the jaw, occipital bulge), then scaled to head proportions. Centre = head-local
 * (0, 0.112, 0.005) => world (0, 1.712, 0.005) in bind pose. Face plane ends up at z ≈ -0.073.
 */
function skull(scale = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 26, 16);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z < -0.5) z = -0.5 + (z + 0.5) * 0.6;                                          // face plane
    for (const sx of [-1, 1]) {                                                          // eye sockets
      const d = Math.hypot((x - sx * 0.42) / 0.3, (y - 0.02) / 0.2);
      if (d < 1 && z < -0.4) z += 0.1 * (1 - d * d);
    }
    if (z < -0.45 && y > 0.14 && y < 0.4) z -= 0.05 * Math.sin(Math.PI * (y - 0.14) / 0.26);  // brow shelf
    if (y < -0.25) x *= 1 - 0.3 * Math.min(1, (-y - 0.25) / 0.75);                      // cheeks -> jaw taper
    if (z > 0.3 && y < 0.15 && y > -0.75) z += 0.07 * Math.max(0, 1 - Math.abs(y + 0.3) / 0.45); // occiput
    p.setXYZ(i, x, y, z);
  }
  g.scale(0.0755 * scale, 0.1005 * scale, 0.0945 * scale);
  g.translate(0, 1.7, 0.004);
  g.computeVertexNormals();
  return g;
}

/** Mandible: ear level down to the chin. `grow` inflates it (beard shell). */
function jawRings(grow = 0): Ring[] {
  return [
    { y: 1.672, rx: 0.064 + grow, rz: 0.073 + grow, cz: 0.002 },
    { y: 1.65, rx: 0.058 + grow, rz: 0.065 + grow, cz: -0.005 },
    { y: 1.628, rx: 0.05 + grow, rz: 0.055 + grow, cz: -0.017 },
    { y: 1.608, rx: 0.038 + grow, rz: 0.04 + grow, cz: -0.03 },
    { y: 1.594, rx: 0.025 + grow, rz: 0.025 + grow, cz: -0.037 },
  ];
}

/**
 * Base grime multiplier at a bind-space height: boots and knees sit in shadow and blotchy stain.
 * This is only the low-frequency ramp; `cavityDust` adds the crease AO and the dust that pools in
 * it afterwards, on the merged geometry where occlusion can actually be measured.
 */
function grimeAt(y: number, x: number, z: number, out: [number, number, number]): void {
  const t = Math.min(1, Math.max(0, (y - 0.04) / 0.78));
  const s = t * t * (3 - 2 * t);
  const dark = 0.66 + 0.34 * s;
  // blotchy dust so the gradient isn't a clean ramp
  const h = Math.sin(x * 37.1 + y * 21.7) * Math.cos(z * 29.3 - y * 17.4);
  const blotch = 1 + h * 0.035 * (1 - s);
  const warm = 1 + (1 - s) * 0.09;
  out[0] = dark * blotch * warm;
  out[1] = dark * blotch * (1 + (1 - s) * 0.04);
  out[2] = dark * blotch * (1 - (1 - s) * 0.05);
}

class Builder {
  parts: THREE.BufferGeometry[][] = Array.from({ length: SLOT_COUNT }, () => []);
  preserveUV = false;
  /** extra darkening for the current part (pouch bodies, strap undersides, recesses) */
  shade = 1;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, slot: number, skin: SkinFn, pos: THREE.Vector3 | [number, number, number], rot?: [number, number, number] | THREE.Quaternion, scale?: [number, number, number]): void {
    const p = Array.isArray(pos) ? new THREE.Vector3(...pos) : pos;
    if (rot instanceof THREE.Quaternion) this.q.copy(rot); else if (rot) this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2])); else this.q.identity();
    const s = scale ? new THREE.Vector3(...scale) : new THREE.Vector3(1, 1, 1);
    this.m.compose(p, this.q, s);
    geo.applyMatrix4(this.m);
    this.finish(geo, slot, skin);
  }
  /** Add geometry already authored in bind space. */
  put(geo: THREE.BufferGeometry, slot: number, skin: SkinFn): void { this.finish(geo, slot, skin); }

  /** Tapered cylinder from joint `a` (radius ra) to joint `b` (radius rb). */
  limb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, slot: number, skin: SkinFn, extendA = 0, extendB = 0, radial = 14): void {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); dir.normalize();
    const start = a.clone().addScaledVector(dir, -extendA), end = b.clone().addScaledVector(dir, extendB);
    const h = len + extendA + extendB;
    const geo = new THREE.CylinderGeometry(ra, rb, h, radial, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(start, end).normalize());
    this.add(geo, slot, skin, start.clone().add(end).multiplyScalar(0.5), q);
  }

  private finish(geo: THREE.BufferGeometry, slot: number, skin: SkinFn): void {
    if (geo.index) geo = geo.toNonIndexed();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    const n = pos.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
    const g: [number, number, number] = [1, 1, 1];
    const shade = this.shade;
    const keep = this.preserveUV && geo.getAttribute('uv');
    const uv = keep ? (geo.getAttribute('uv') as THREE.BufferAttribute).array as Float32Array : new Float32Array(n * 2);
    const scale = 1 / UV_SCALE[slot];
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const [b0, b1, w0, w1] = skin(x, y, z);
      si[i * 4] = b0; si[i * 4 + 1] = b1; sw[i * 4] = w0; sw[i * 4 + 1] = w1;
      grimeAt(y, x, z, g);
      col[i * 3] = g[0] * shade; col[i * 3 + 1] = g[1] * shade; col[i * 3 + 2] = g[2] * shade;
      if (keep) continue;
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
      if (nx >= ny && nx >= nz) { uv[i * 2] = z * scale; uv[i * 2 + 1] = y * scale; }
      else if (ny >= nz) { uv[i * 2] = x * scale; uv[i * 2 + 1] = z * scale; }
      else { uv[i * 2] = x * scale; uv[i * 2 + 1] = y * scale; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
    geo.clearGroups();
    this.parts[slot].push(geo);
  }

  build(): THREE.BufferGeometry {
    const merged: THREE.BufferGeometry[] = [];
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (this.parts[s].length === 0) throw new Error(`soldier: material slot ${s} has no geometry`);
      merged.push(mergeGeometries(this.parts[s], false)!);
    }
    // one geometry, one group per material slot => SLOT_COUNT draw calls
    const geo = mergeGeometries(merged, true)!;
    for (const g of merged) g.dispose();
    for (const list of this.parts) for (const g of list) g.dispose();
    return geo;
  }
}

const rbox = (w: number, h: number, d: number, r = 0.01, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
const sphere = (r: number, ws = 18, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const torus = (R: number, r: number, seg = 10, tub = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, seg, tub, arc);
const cyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const qFromTo = (from: THREE.Vector3, to: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
const DOWN = new THREE.Vector3(0, -1, 0);

const geoCache = new Map<string, THREE.BufferGeometry>();

export function geometryKey(a: ArchetypeDef): string {
  return [a.nvg, a.headset, a.holster, a.rifleFurniture, a.head, a.face, a.sleeves, a.pants, a.beard, a.build.toFixed(2), a.pack, a.weapon ?? 'ak'].join('|');
}

/** Bind geometry for an archetype (shared across all enemies with the same visual switches). */
export function soldierGeometry(archetype: ArchetypeDef): THREE.BufferGeometry {
  const key = geometryKey(archetype);
  const hit = geoCache.get(key); if (hit) return hit;
  const b = new Builder();
  const J = JOINT;
  const torsoChain = chain([[B.hips, J.hips.y], [B.spine1, J.spine1.y], [B.spine2, J.spine2.y], [B.chest, J.chest.y], [B.neck, J.neck.y]]);
  const upperChain = chain([[B.spine2, J.spine2.y], [B.chest, J.chest.y]]);
  const headSkin = rigid(B.head);
  const headOut = (p: THREE.Vector3) => p.clone().sub(V(0, 1.7, 0.01)).normalize();
  const helmet = archetype.head === 'helmet', cap = archetype.head === 'cap', boonie = archetype.head === 'boonie', bareHead = archetype.head === 'bare';
  // `build` inflates the soft mass (torso, deltoids, limbs) without touching the skeleton, so a
  // heavy breacher and a lean scout read as different bodies at 15 m rather than one body twice.
  const bd = archetype.build;
  const gd = 1 + (bd - 1) * 0.7;   // gear follows the body but less than the flesh does
  const faceSlot = archetype.face === 'balaclava' || archetype.face === 'openmask' ? SLOT.RUBBER : SLOT.SKIN;
  const showEars = faceSlot === SLOT.SKIN;

  // ---------- torso (combat shirt + trouser seat) ----------
  b.put(loft(([
    { y: 0.83, rx: 0.162, rz: 0.112, cz: 0.006 },
    { y: 0.92, rx: 0.176, rz: 0.122, cz: 0.012 },
    { y: 1.0, rx: 0.166, rz: 0.112, cz: 0.004 },
    { y: 1.1, rx: 0.156, rz: 0.106, cz: 0.004 },
    { y: 1.22, rx: 0.166, rz: 0.116, cz: -0.004 },
    { y: 1.32, rx: 0.18, rz: 0.126, cz: -0.01 },
    { y: 1.42, rx: 0.192, rz: 0.122, cz: -0.006 },
    { y: 1.475, rx: 0.2, rz: 0.106, cz: 0.0 },
    { y: 1.512, rx: 0.132, rz: 0.086, cz: 0.006 },
    { y: 1.548, rx: 0.076, rz: 0.066, cz: 0.01 },
  ] as Ring[]).map((r) => ({ ...r, rx: r.rx * bd, rz: r.rz * bd })), 24, false, true), SLOT.CAMO, torsoChain);
  // collar
  b.add(torus(0.07, 0.012, 6, 18), SLOT.CAMO, chain([[B.chest, 1.5], [B.neck, 1.56]]), [0, 1.55, 0.008], [Math.PI / 2, 0, 0], [1.08, 1, 1]);

  // ---------- neck & head ----------
  const neckSkin = chain([[B.chest, 1.5], [B.neck, 1.55], [B.head, 1.62]]);
  const neckSlot = archetype.face === 'bare' ? SLOT.SKIN : (archetype.face === 'gaiter' ? SLOT.RUBBER : faceSlot);
  b.put(loft([
    { y: 1.495, rx: 0.082, rz: 0.075, cz: 0.014 },
    { y: 1.535, rx: 0.062, rz: 0.062, cz: 0.012 },
    { y: 1.575, rx: 0.054, rz: 0.056, cz: 0.009 },
    { y: 1.63, rx: 0.055, rz: 0.058, cz: 0.005 },
  ], 16), neckSlot, neckSkin);
  if (archetype.face === 'gaiter') {
    // neck gaiter bunched under the chin
    b.put(loft([{ y: 1.5, rx: 0.088, rz: 0.082, cz: 0.014 }, { y: 1.545, rx: 0.072, rz: 0.07, cz: 0.01 }, { y: 1.585, rx: 0.066, rz: 0.066, cz: 0.002 }, { y: 1.602, rx: 0.058, rz: 0.06, cz: -0.002 }], 16), SLOT.RUBBER, neckSkin);
  }
  b.put(skull(), faceSlot, headSkin);
  b.put(loft(jawRings(), 20, false, true), faceSlot, headSkin);
  if (archetype.beard && faceSlot === SLOT.SKIN) {
    b.put(loft(jawRings(0.004).slice(1), 20, false, true), SLOT.RUBBER, headSkin);
    b.add(box(0.036, 0.006, 0.008), SLOT.RUBBER, headSkin, [0, 1.626, -0.0775]); // moustache
  }
  // face opening in the mask: skin patch where the eyes (and for the open mask, nose + mouth) show
  if (archetype.face === 'balaclava') {
    // eye slot: the skin sits between the brow shelf and cheek mounds, hemmed by cloth
    b.add(sphere(0.054, 20, 14), SLOT.SKIN, headSkin, [0, 1.7025, -0.0455], undefined, [1.3, 0.55, 0.38]);
    b.add(torus(0.058, 0.005, 6, 24), SLOT.RUBBER, headSkin, [0, 1.7025, -0.0645], [0, 0, 0], [1.22, 0.76, 1]);  // opening hem
    b.add(box(0.086, 0.01, 0.012), SLOT.RUBBER, headSkin, [0, 1.7305, -0.0645], [0.25, 0, 0]);                    // mask brow band
    // nose ridge under the mask, well below the opening
    b.add(sphere(0.014, 10, 8), SLOT.RUBBER, headSkin, [0, 1.669, -0.0625], undefined, [0.62, 1.15, 0.5]);
  } else if (archetype.face === 'openmask') {
    b.add(sphere(0.056, 18, 12), SLOT.SKIN, headSkin, [0, 1.668, -0.05], undefined, [1.02, 1.0, 0.44]);
    b.add(torus(0.056, 0.006, 6, 22), SLOT.RUBBER, headSkin, [0, 1.668, -0.07], [0, 0, 0], [1.02, 1.0, 1]);
  }
  // ---------- eyes and orbits ----------
  // The eyeball sits deep enough that the cornea is only ~1 mm proud of the face plane; the lids,
  // brow shelf and cheek mound around it give the socket real depth instead of a flat decal.
  const EY = 1.7025, EZ = -0.058, ER = 0.0128;   // eye centre / radius
  b.preserveUV = true;
  // skinned to their own bones so the gaze can track a target; the sphere's +Y pole (uv v = 0, the
  // iris) is rotated onto -Z, so a bone at identity looks straight ahead.
  for (const sx of [-1, 1]) b.add(sphere(ER, 14, 10), SLOT.EYE, rigid(sx < 0 ? B.eyeL : B.eyeR), [sx * 0.0325, EY, EZ], [-Math.PI / 2, 0, 0]);
  b.preserveUV = false;
  for (const sx of [-1, 1]) {
    const cx = sx * 0.0325;
    // upper lid: a shell whose rim cuts 3 mm above centre, overlapping the top quarter of the 12 mm iris
    const upper = new THREE.SphereGeometry(ER + 0.0017, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.45);
    // rolled slightly toward the outer canthus: the fissure narrows at the outer corner, as in a real eye
    b.add(upper, SLOT.SKIN, headSkin, [cx, EY, EZ], [-0.12, 0, sx * 0.16]);
    // lash line along the lid edge
    b.shade = 0.35;
    b.add(torus(ER * 0.985, 0.0011, 5, 18), SLOT.RUBBER, headSkin, [cx, EY + 0.0032, EZ - 0.0012], [Math.PI / 2, 0, 0], [1, 1, 0.82]);
    // crease above the lid
    b.shade = 0.62;
    b.add(torus(ER + 0.004, 0.0021, 5, 16), SLOT.SKIN, headSkin, [cx, EY + 0.0078, EZ + 0.0035], [Math.PI / 2 - 0.35, 0, 0], [1, 1, 0.7]);
    // socket ambient occlusion at the inner and outer corners
    for (const ox of [-1, 1]) {
      b.shade = ox > 0 ? 0.42 : 0.55;          // outer canthus sits deeper in shadow than the inner
      b.add(sphere(ox > 0 ? 0.0072 : 0.006, 6, 4), SLOT.SKIN, headSkin, [cx + sx * ox * 0.0145, EY - 0.0014, EZ + 0.003], undefined, [0.8, 1.3, 0.6]);
    }
    b.shade = 1;
    // lower lid
    const lower = new THREE.SphereGeometry(ER + 0.0012, 14, 6, 0, Math.PI * 2, Math.PI * 0.64, Math.PI * 0.36);
    b.add(lower, SLOT.SKIN, headSkin, [cx, EY, EZ], [0.1, 0, sx * 0.12]);
    if (faceSlot === SLOT.SKIN) b.add(box(0.03, 0.004, 0.007), SLOT.RUBBER, headSkin, [cx + sx * 0.002, EY + 0.0175, EZ - 0.0125], [0.28, 0, sx * -0.14]); // eyebrow
  }
  // brow shelf above the eyes and cheekbones below: the orbits read as volumes, not a painted patch
  b.add(sphere(0.05, 16, 10), faceSlot, headSkin, [0, EY + 0.0155, EZ + 0.004], [0.35, 0, 0], [1.12, 0.3, 0.42]);
  b.shade = 0.72;
  b.add(box(0.088, 0.005, 0.008), faceSlot, headSkin, [0, EY + 0.0092, EZ - 0.0085], [0.3, 0, 0]);   // shadow under the brow
  b.shade = 1;
  for (const sx of [-1, 1]) b.add(sphere(0.0215, 9, 6), faceSlot, headSkin, [sx * 0.036, EY - 0.0175, EZ - 0.001], undefined, [1.0, 0.62, 0.5]); // cheekbone
  if (archetype.face !== 'balaclava') {
    b.add(rbox(0.075, 0.014, 0.016, 0.006, 1), SLOT.SKIN, headSkin, [0, 1.7145, -0.0655], [0.35, 0, 0]);   // brow ridge
    /*
     * Nose. The old one was a tapered cylinder from the brow to a ball tip: a wedge stuck on the
     * front of the face, which is what a nose looks like when it has no root, no alar wings and no
     * nostrils. This is a loft instead — narrow and *recessed* at the root between the brows,
     * widening down the dorsum, at its widest across the alar wings — so it grows out of the face
     * plane. Nostril openings are small dark recesses under the wings, and the septum sits between
     * them. Total protrusion at the tip is ~11 mm past the cheeks, not 26 mm.
     */
    {
      const nose: Ring[] = [
        { y: 1.6985, rx: 0.0088, rz: 0.009, cz: -0.0655 },   // root, sunk between the brows
        { y: 1.688, rx: 0.0092, rz: 0.011, cz: -0.0705 },
        { y: 1.676, rx: 0.0105, rz: 0.0125, cz: -0.0755 },   // dorsum
        { y: 1.665, rx: 0.0125, rz: 0.014, cz: -0.0805 },
        { y: 1.6565, rx: 0.0155, rz: 0.0145, cz: -0.0835 },  // supratip
        { y: 1.6495, rx: 0.0185, rz: 0.0135, cz: -0.0825 },  // alar wings, the widest point
        { y: 1.6445, rx: 0.017, rz: 0.0105, cz: -0.0785 },   // tuck back under to the base
      ];
      b.put(loft(nose, 14, false, false), SLOT.SKIN, headSkin);
      b.add(sphere(0.0092, 10, 7), SLOT.SKIN, headSkin, [0, 1.6535, -0.0845], undefined, [1.25, 0.95, 0.95]);  // tip
      b.shade = 0.3;
      for (const sx of [-1, 1]) b.add(sphere(0.0052, 7, 5), SLOT.SKIN, headSkin, [sx * 0.0092, 1.6455, -0.0785], undefined, [0.85, 0.6, 1.15]);  // nostril
      b.shade = 0.72;
      for (const sx of [-1, 1]) b.add(box(0.003, 0.009, 0.011), SLOT.SKIN, headSkin, [sx * 0.0175, 1.6495, -0.0805], [0, sx * -0.25, 0]);        // alar crease
      b.shade = 1;
      b.add(box(0.0045, 0.006, 0.008), SLOT.SKIN, headSkin, [0, 1.6435, -0.0795]);   // columella
      // philtrum + lips: an upper lip that recedes under the nose, a fuller lower lip, mouth line
      b.add(rbox(0.042, 0.011, 0.011, 0.004, 1), SLOT.SKIN, headSkin, [0, 1.6255, -0.0765], [0.22, 0, 0]);
      b.add(rbox(0.038, 0.012, 0.012, 0.005, 1), SLOT.SKIN, headSkin, [0, 1.6135, -0.0755], [-0.15, 0, 0]);
      b.shade = 0.45;
      b.add(box(0.032, 0.0022, 0.006), SLOT.SKIN, headSkin, [0, 1.6195, -0.0805]);
      b.shade = 1;
    }
  }
  if (showEars) for (const sx of [-1, 1]) b.add(sphere(0.019, 10, 8), SLOT.SKIN, headSkin, [sx * 0.0745, 1.678, 0.007], [0, 0, sx * 0.15], [0.35, 1.15, 0.8]);

  // ---------- headgear ----------
  if (helmet) {
    const HC = V(0, 1.734, 0.012);
    const tilt = -0.1; // brim up in front, down at the back
    const local = (x: number, y: number, z: number) => V(x, y, z).applyAxisAngle(V(1, 0, 0), tilt).add(HC);
    const rotQ = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), tilt);
    // cap stops at the equator so the rim lands on the brow ridge (1.72) instead of across the eyes (1.70)
    const shell = new THREE.SphereGeometry(0.102, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.5);
    shell.scale(0.99, 0.99, 1.08);
    b.add(shell, SLOT.CAMO, headSkin, HC, rotQ);
    const rimR = 0.102 * 0.99;
    const rim = torus(rimR, 0.008, 6, 28); rim.rotateX(Math.PI / 2); rim.scale(1, 1, 1.09);
    b.add(rim, SLOT.RUBBER, headSkin, HC, rotQ);
    // brow / rim trim across the front, NVG shroud
    b.add(rbox(0.066, 0.03, 0.012, 0.004, 1), SLOT.RUBBER, headSkin, local(0, 0.02, -0.108), [0.25 + tilt, 0, 0]);
    // side rails (curved) + rail pads
    for (const sx of [-1, 1]) {
      const rail = torus(0.108, 0.007, 6, 14, Math.PI * 0.62); rail.rotateY(Math.PI / 2); rail.rotateX(Math.PI * 0.19);
      rail.scale(1, 1, 1.06);
      b.add(rail, SLOT.RUBBER, headSkin, local(sx * 0.108 * 0.98 * 0.0 + sx * 0.0, -0.01, 0.0), rotQ, [sx, 1, 1]);
      b.add(rbox(0.011, 0.028, 0.048, 0.004, 1), SLOT.RUBBER, headSkin, local(sx * 0.104, -0.014, -0.02), [0, 0, 0]);
    }
    // counterweight pouch at the back, bungee retention
    b.add(rbox(0.1, 0.046, 0.042, 0.012, 1), SLOT.GEAR, headSkin, local(0, 0.0, 0.1), [-0.4, 0, 0]);
    b.add(box(0.02, 0.008, 0.058), SLOT.RUBBER, headSkin, local(0, 0.086, 0.03));
    if (archetype.nvg) {
      b.add(rbox(0.048, 0.048, 0.03, 0.006, 1), SLOT.RUBBER, headSkin, local(0, 0.056, -0.102), [0.35, 0, 0]);   // shroud + mount base
      b.add(rbox(0.03, 0.058, 0.03, 0.006, 1), SLOT.RUBBER, headSkin, local(0, 0.1, -0.115), [0.9, 0, 0]);   // mount arm (stowed, flipped up)
      b.add(rbox(0.072, 0.03, 0.044, 0.006, 1), SLOT.RUBBER, headSkin, local(0, 0.129, -0.092), [0.3, 0, 0]);   // NVG body
      for (const sx of [-1, 1]) b.add(cyl(0.016, 0.016, 0.052, 10), SLOT.METAL, headSkin, local(sx * 0.027, 0.134, -0.107), [Math.PI / 2 + 0.3, 0, 0]);
    } else {
      b.add(rbox(0.044, 0.038, 0.01, 0.004, 1), SLOT.RUBBER, headSkin, local(0, 0.042, -0.107), [0.2, 0, 0]);   // bare shroud
    }
    // chin strap: from the rails down the jaw to a chin cup (ribbons follow the head surface)
    for (const sx of [-1, 1]) {
      const pts = [local(sx * 0.098, -0.01, 0.01), V(sx * 0.083, 1.658, -0.004), V(sx * 0.069, 1.616, -0.03), V(sx * 0.045, 1.594, -0.046)];
      b.put(ribbon(pts, 0.018, 0.004, headOut, 8), SLOT.RUBBER, headSkin);
      const back = [local(sx * 0.098, -0.01, 0.042), V(sx * 0.075, 1.652, 0.045), V(sx * 0.06, 1.616, 0.028), V(sx * 0.045, 1.596, -0.014)];
      b.put(ribbon(back, 0.014, 0.004, headOut, 8), SLOT.RUBBER, headSkin);
    }
    b.add(rbox(0.062, 0.026, 0.03, 0.008, 1), SLOT.RUBBER, headSkin, [0, 1.592, -0.04], [0.3, 0, 0]); // chin cup
    if (archetype.headset) {
      // rail-mounted hearing protection: cup + adapter arm; mic boom on the left
      for (const sx of [-1, 1]) {
        b.add(cyl(0.036, 0.04, 0.03, 16), SLOT.RUBBER, headSkin, [sx * 0.0955, 1.676, 0.005], [0, 0, Math.PI / 2]);
        b.add(rbox(0.012, 0.055, 0.03, 0.004, 1), SLOT.RUBBER, headSkin, [sx * 0.109, 1.693, 0.0], [0, 0, sx * 0.25]);
      }
      const mic = [V(-0.098, 1.658, -0.02), V(-0.083, 1.638, -0.07), V(-0.044, 1.62, -0.1)];
      b.put(ribbon(mic, 0.006, 0.006, () => V(0, 1, 0), 8), SLOT.RUBBER, headSkin);
      b.add(sphere(0.011, 8, 6), SLOT.RUBBER, headSkin, [-0.044, 1.62, -0.1], undefined, [1, 1, 1.4]);
    }
  } else if (cap) {
    // patrol cap: crown loft + domed top + curved bill, over short hair
    b.put(loft([{ y: 1.722, rx: 0.082, rz: 0.097, cz: 0.011 }, { y: 1.757, rx: 0.082, rz: 0.097, cz: 0.011 }, { y: 1.8, rx: 0.077, rz: 0.088, cz: 0.011 }], 22, true), SLOT.CAMO, headSkin);
    b.add(torus(0.086, 0.006, 6, 24), SLOT.CAMO, headSkin, [0, 1.727, 0.011], [Math.PI / 2, 0, 0], [1, 1.14, 1]); // band seam
    const bill = new THREE.CylinderGeometry(0.11, 0.11, 0.007, 20, 1, false, Math.PI * 0.55, Math.PI * 0.9); // partial disc
    bill.scale(1, 1, 0.7);
    b.add(bill, SLOT.CAMO, headSkin, [0, 1.729, -0.05], [0.28, 0, 0]);
    if (archetype.headset) headsetOverHead(b, headSkin);
  } else if (boonie) {
    // Boonie: a soft crown that sags onto the skull plus a 30 cm floppy brim. At 15 m this is the
    // one head shape in the squad that is wider than the shoulders are thick, so it separates from
    // helmets and caps on outline alone.
    b.put(loft([
      { y: 1.716, rx: 0.088, rz: 0.1, cz: 0.009 },
      { y: 1.75, rx: 0.09, rz: 0.101, cz: 0.009 },
      { y: 1.782, rx: 0.083, rz: 0.092, cz: 0.008 },
      { y: 1.8, rx: 0.062, rz: 0.068, cz: 0.007 },
    ], 22, true), SLOT.CAMO, headSkin);
    // Brim: two lofted cones (upper surface, then the underside offset 5 mm down and wound the
    // other way) plus a rolled edge. Emitting both windings into one geometry and calling
    // computeVertexNormals cancels the normals against each other, which is what turned the first
    // attempt into a flat radial fan.
    {
      const inner = 0.088, outer = 0.128, drop = 0.03;
      const upper: Ring[] = [
        { y: 1.727, rx: inner, rz: inner * 1.06, cz: 0.009 },
        { y: 1.722, rx: inner + (outer - inner) * 0.55, rz: (inner + (outer - inner) * 0.55) * 1.06, cz: 0.009 },
        { y: 1.727 - drop, rx: outer, rz: outer * 1.06, cz: 0.009 },
      ];
      b.put(loft(upper, 24), SLOT.CAMO, headSkin);
      b.shade = 0.6;   // the underside of a brim is the darkest thing on a soldier's head
      b.put(loft(upper.map((r) => ({ ...r, y: r.y - 0.006 })).reverse(), 24), SLOT.CAMO, headSkin);
      b.shade = 1;
      const edge = torus(outer, 0.005, 5, 24); edge.rotateX(Math.PI / 2); edge.scale(1, 1, 1.06);
      b.add(edge, SLOT.CAMO, headSkin, [0, 1.727 - drop - 0.003, 0.009]);
    }
    b.add(torus(0.09, 0.006, 5, 20), SLOT.GEAR, headSkin, [0, 1.744, 0.009], [Math.PI / 2, 0, 0], [1, 1.12, 1]);  // band
    if (archetype.headset) headsetOverHead(b, headSkin);
  } else if (bareHead) {
    // short hair: a cap over the top/back of the cranium, hairline high on the forehead, sideburns to the ears
    const hair = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const hp = hair.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
      // pull the front edge up (hairline) and let the back edge hang lower (nape)
      const front = Math.max(0, -z), back = Math.max(0, z);
      // tufts: without them the shell is a perfect hemisphere, and a perfect hemisphere in a
      // slightly glossy material is a lacquered dome however dark you make it. Breaking the
      // surface scatters the highlight into something that reads as cropped hair.
      const notch = Math.sin(x * 26) * 0.012 + Math.sin(z * 19 + 1.3) * 0.008;
      const tuft = Math.sin(x * 61 + z * 17) * Math.cos(z * 53 - x * 23) * 0.026 + Math.sin(x * 97 + z * 71) * 0.012;
      const r = 1 + tuft * (0.4 + 0.6 * Math.max(0, y));
      hp.setXYZ(i, x * 1.03 * r, Math.max(y, 0.02) * 1.02 * r + front * 0.26 - back * 0.3 - Math.abs(x) * 0.1 + notch, z * 1.03 * r);
    }
    hair.scale(0.0765, 0.1015, 0.0955); hair.translate(0, 1.7, 0.004); hair.computeVertexNormals();
    b.shade = 0.55;   // hair reads as a matte dark mass, not the lacquered dome a plain slot gives
    b.put(hair, SLOT.RUBBER, headSkin);
    b.shade = 1;
    if (archetype.headset) headsetOverHead(b, headSkin);
  }

  // ---------- plate carrier ----------
  {
    const pcSkin = upperChain;
    b.shade = 0.9;   // carrier sits in the torso's contact shadow
    // front: main panel + narrower shoulder-cut top; back: same
    b.add(rbox(0.275 * gd, 0.25, 0.04, 0.022, 1), SLOT.GEAR, pcSkin, [0, 1.275, -0.136 * gd]);
    b.add(rbox(0.2 * gd, 0.1, 0.04, 0.02, 1), SLOT.GEAR, pcSkin, [0, 1.425, -0.132 * gd]);
    b.add(rbox(0.28 * gd, 0.3, 0.042, 0.022, 1), SLOT.GEAR, pcSkin, [0, 1.3, 0.138 * gd]);
    b.add(rbox(0.21 * gd, 0.08, 0.046, 0.02, 1), SLOT.GEAR, pcSkin, [0, 1.465, 0.125 * gd]);
    // cummerbund wrapping the torso
    b.put(loft([{ y: 1.14, rx: 0.192 * gd, rz: 0.142 * gd, cz: -0.004 }, { y: 1.215, rx: 0.196 * gd, rz: 0.146 * gd, cz: -0.006 }, { y: 1.29, rx: 0.2 * gd, rz: 0.146 * gd, cz: -0.008 }], 24), SLOT.GEAR, chain([[B.spine1, 1.14], [B.spine2, 1.22], [B.chest, 1.3]]));
    // shoulder straps over the trapezius, with buckles on the front
    for (const sx of [-1, 1]) {
      const pts = [V(sx * 0.1, 1.455, -0.12), V(sx * 0.116, 1.51, -0.055), V(sx * 0.12, 1.522, 0.02), V(sx * 0.108, 1.49, 0.1)];
      b.put(ribbon(pts, 0.062, 0.014, (p) => V(sx * 0.35, 1, 0).normalize().add(V(0, 0, (p.z) * 2)).normalize(), 10), SLOT.GEAR, chain([[B.chest, 1.45], [B.neck, 1.56]]));
      b.add(box(0.07, 0.024, 0.03), SLOT.RUBBER, rigid(B.chest), [sx * 0.105, 1.45, -0.13], [0.3, 0, 0]);
    }
    // triple mag pouch with flaps, crease shadows and bungee pulls
    for (const x of [-0.076, 0, 0.076]) {
      b.shade = 0.78;   // pouch body sits under its flap
      b.add(rbox(0.068, 0.13, 0.048, 0.012, 1), SLOT.GEAR, pcSkin, [x, 1.215, -0.178]);
      b.shade = 0.95;
      b.add(rbox(0.074, 0.032, 0.058, 0.008, 1), SLOT.GEAR, pcSkin, [x, 1.288, -0.178]);
      b.shade = 0.55; b.add(box(0.07, 0.007, 0.05), SLOT.RUBBER, pcSkin, [x, 1.269, -0.182]); b.shade = 0.9;       // shadow line under the flap
      b.add(cyl(0.003, 0.003, 0.1, 6), SLOT.RUBBER, pcSkin, [x, 1.22, -0.204], [0, 0, 0]);         // bungee
      b.add(sphere(0.007, 6, 4), SLOT.RUBBER, pcSkin, [x, 1.168, -0.205]);                          // pull tab
    }
    // admin pouch on the top panel + zipper + strobe/PTT + cable to the radio
    b.add(rbox(0.15, 0.066, 0.034, 0.012, 1), SLOT.GEAR, rigid(B.chest), [0, 1.4, -0.164]);
    b.add(box(0.12, 0.005, 0.006), SLOT.RUBBER, rigid(B.chest), [0, 1.42, -0.182]);
    b.add(box(0.036, 0.05, 0.02), SLOT.RUBBER, rigid(B.chest), [0.105, 1.395, -0.165]);
    b.add(cyl(0.006, 0.006, 0.01, 8), SLOT.RUBBER, rigid(B.chest), [0.105, 1.395, -0.176], [Math.PI / 2, 0, 0]);
    const cable = [V(0.095, 1.375, -0.17), V(0.02, 1.44, -0.16), V(-0.11, 1.45, -0.12), V(-0.205, 1.38, -0.075), V(-0.225, 1.33, -0.06)];
    b.put(ribbon(cable, 0.007, 0.007, (p) => V(p.x * 0.5, 0.2, -1).normalize(), 12), SLOT.RUBBER, pcSkin);
    // radio (left cummerbund) with antenna
    b.shade = 0.8; b.add(rbox(0.056, 0.14, 0.055, 0.012, 1), SLOT.GEAR, pcSkin, [-0.216, 1.235, -0.06]); b.shade = 0.9;
    b.add(box(0.05, 0.05, 0.03), SLOT.METAL, pcSkin, [-0.222, 1.33, -0.062]);           // radio top with knobs
    b.add(cyl(0.008, 0.008, 0.012, 8), SLOT.RUBBER, pcSkin, [-0.235, 1.36, -0.062]);
    b.add(cyl(0.0045, 0.0045, 0.26, 6), SLOT.RUBBER, rigid(B.chest), [-0.215, 1.49, -0.062]);       // antenna
    b.add(cyl(0.006, 0.006, 0.02, 6), SLOT.RUBBER, rigid(B.chest), [-0.215, 1.625, -0.062]);
    // utility pouch (right), IFAK (back), dump pouch, frag grenade
    b.shade = 0.8; b.add(rbox(0.072, 0.115, 0.062, 0.014, 1), SLOT.GEAR, pcSkin, [0.222, 1.225, -0.005]); b.shade = 0.9;
    b.add(rbox(0.076, 0.028, 0.068, 0.008, 1), SLOT.GEAR, pcSkin, [0.222, 1.293, -0.005]);
    b.add(rbox(0.14, 0.1, 0.06, 0.014, 1), SLOT.GEAR, rigid(B.spine2), [0.05, 1.18, 0.19 * gd]);
    // ---- back silhouette: nothing, a slim assault pack, or a radio pack with a whip antenna ----
    if (archetype.pack === 'daypack') {
      b.shade = 0.85;
      b.add(rbox(0.29, 0.36, 0.15, 0.035, 1), SLOT.GEAR, chain([[B.spine1, 1.13], [B.spine2, 1.25], [B.chest, 1.4]]), [0, 1.26, 0.21 * gd + 0.06]);
      b.shade = 0.7;
      b.add(rbox(0.2, 0.12, 0.06, 0.02, 1), SLOT.GEAR, rigid(B.spine2), [0, 1.15, 0.235 * gd + 0.09]);   // lower lid pocket
      b.shade = 1;
      for (const sx of [-1, 1]) b.add(box(0.03, 0.3, 0.012), SLOT.GEAR, rigid(B.chest), [sx * 0.1, 1.34, 0.235 * gd + 0.08]);  // compression straps
      b.add(cyl(0.016, 0.016, 0.34, 8), SLOT.RUBBER, rigid(B.spine2), [-0.115, 1.3, 0.24 * gd + 0.08], [0.1, 0, 0.06]);       // rolled mat
    } else if (archetype.pack === 'radio') {
      b.shade = 0.8;
      b.add(rbox(0.24, 0.3, 0.13, 0.02, 1), SLOT.GEAR, chain([[B.spine1, 1.13], [B.spine2, 1.25], [B.chest, 1.4]]), [0, 1.24, 0.2 * gd + 0.055]);
      b.shade = 1;
      b.add(rbox(0.13, 0.08, 0.05, 0.012, 1), SLOT.METAL, rigid(B.spine2), [0.03, 1.38, 0.21 * gd + 0.04]);
      b.add(cyl(0.006, 0.004, 0.46, 6), SLOT.RUBBER, rigid(B.chest), [0.09, 1.6, 0.2 * gd + 0.03], [-0.12, 0, -0.1]);  // whip antenna
      b.add(sphere(0.009, 6, 5), SLOT.RUBBER, rigid(B.chest), [0.03, 1.82, 0.17 * gd]);
    } else if (archetype.pack === 'ruck') {
      // A full ruck is the loudest silhouette a soldier can wear: it stands proud of the shoulders,
      // is deeper than the man's own chest, and hangs a rolled mat and a canteen off the outside.
      // Nothing else in the ladder changes an outline this much at 15 m.
      b.shade = 0.82;
      b.add(rbox(0.42, 0.5, 0.24, 0.045, 1), SLOT.GEAR, chain([[B.spine1, 1.12], [B.spine2, 1.26], [B.chest, 1.42]]), [0, 1.33, 0.21 * gd + 0.11]);
      b.shade = 0.7;
      b.add(rbox(0.26, 0.14, 0.1, 0.025, 1), SLOT.GEAR, rigid(B.spine2), [0, 1.12, 0.24 * gd + 0.12]);          // lower lid pocket
      b.add(rbox(0.1, 0.2, 0.08, 0.02, 1), SLOT.GEAR, rigid(B.chest), [0.2, 1.32, 0.24 * gd + 0.09]);           // side pouch
      b.add(rbox(0.1, 0.2, 0.08, 0.02, 1), SLOT.GEAR, rigid(B.chest), [-0.2, 1.32, 0.24 * gd + 0.09]);
      b.shade = 1;
      b.add(cyl(0.055, 0.055, 0.46, 10), SLOT.RUBBER, rigid(B.chest), [0, 1.6, 0.2 * gd + 0.12], [0, 0, Math.PI / 2]);   // rolled mat, proud of the shoulders
      for (const sx of [-1, 1]) b.add(box(0.03, 0.44, 0.014), SLOT.GEAR, rigid(B.chest), [sx * 0.12, 1.32, 0.24 * gd + 0.14]);  // compression straps
      b.add(cyl(0.042, 0.042, 0.14, 10), SLOT.RUBBER, rigid(B.spine2), [0.19, 1.14, 0.22 * gd + 0.06]);          // canteen
    }
    b.add(box(0.09, 0.05, 0.03), SLOT.GEAR, rigid(B.chest), [-0.06, 1.46, 0.165]);        // hydration hose clip
    if (archetype.holster || archetype.nvg) {
      b.add(sphere(0.031, 12, 8), SLOT.METAL, pcSkin, [-0.145, 1.34, -0.175], undefined, [1, 1.15, 1]);   // frag
      b.add(box(0.06, 0.05, 0.035), SLOT.GEAR, pcSkin, [-0.145, 1.31, -0.17]);                 // grenade pouch
      b.add(cyl(0.004, 0.004, 0.04, 6), SLOT.METAL, pcSkin, [-0.145, 1.385, -0.175], [0, 0, 0.3]);         // spoon
    }
    b.shade = 1;
  }
  // ---------- belt + holster + dump pouch ----------
  b.put(loft([{ y: 0.968, rx: 0.176, rz: 0.124, cz: 0.006 }, { y: 1.015, rx: 0.178, rz: 0.124, cz: 0.005 }], 24), SLOT.GEAR, rigid(B.hips));
  b.add(box(0.05, 0.03, 0.02), SLOT.METAL, rigid(B.hips), [0, 0.992, -0.125]);                              // buckle
  b.add(rbox(0.1, 0.17, 0.09, 0.02, 1), SLOT.GEAR, rigid(B.hips), [-0.17, 0.87, 0.1], [0, 0.3, 0.1]);                  // dump pouch
  for (const sx of [-1, 1]) b.add(rbox(0.07, 0.09, 0.05, 0.012, 1), SLOT.GEAR, rigid(B.hips), [sx * 0.19, 0.9, -0.06]); // belt pouches
  if (archetype.holster) {
    b.add(rbox(0.06, 0.2, 0.11, 0.015, 1), SLOT.RUBBER, rigid(B.thighR), [0.205, 0.74, -0.03], [0, 0, -0.05]);
    b.add(rbox(0.03, 0.06, 0.035, 0.008, 1), SLOT.RUBBER, rigid(B.thighR), [0.205, 0.86, 0.01], [-0.4, 0, 0]);         // pistol grip
    b.add(torus(0.1, 0.012, 5, 16), SLOT.RUBBER, rigid(B.thighR), [0.1, 0.68, 0], [Math.PI / 2, 0, 0], [1, 0.85, 1]);  // thigh strap
    b.add(box(0.02, 0.15, 0.03), SLOT.RUBBER, rigid(B.hips), [0.2, 0.92, -0.03]);                            // drop leg strap
  }

  // ---------- arms ----------
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const clav = B[`clav${side}`], ua = B[`upperArm${side}`], fa = B[`forearm${side}`], hand = B[`hand${side}`];
    const jS = J[`upperArm${side}`], jE = J[`forearm${side}`], jW = J[`hand${side}`];
    // Three-zone weighting up the arm: forearm below the elbow band, upper arm through the middle,
    // and the deltoid blended back onto the clavicle/chest so a raised arm stretches the shoulder
    // cap instead of creasing it off the torso. `chain` takes ascending heights, so read bottom-up.
    // Below the elbow band the sleeve used to be rigid on the forearm and the glove rigid on the
    // hand, which put a hard step at the wrist; every band here is a two-bone blend now, and the
    // elbow/shoulder bands are wide enough (~19 cm) that a bent joint creases instead of shearing.
    const armSkin = chain([
      [hand, jW.y - 0.025], [fa, jW.y + 0.06],
      [fa, jE.y - 0.095], [ua, jE.y + 0.095],
      [ua, S.shoulderY - 0.105], [clav, S.shoulderY + 0.045],
    ]);
    /** Same ladder, but only the wrist rung: for the glove parts that sit across the joint. */
    const wristSkin = chain([[hand, jW.y - 0.025], [fa, jW.y + 0.06]]);
    const rolled = archetype.sleeves === 'rolled';
    const rings: LimbRing[] = [
      { s: -0.03, rx: 0.06, rz: 0.06 }, { s: 0.09, rx: 0.062, rz: 0.065 }, { s: 0.17, rx: 0.058, rz: 0.063, cz: -0.004 },
      { s: 0.26, rx: 0.05, rz: 0.051 }, { s: 0.3, rx: 0.048, rz: 0.052, cz: 0.004 }, { s: 0.35, rx: 0.05, rz: 0.05 },
      { s: 0.41, rx: 0.049, rz: 0.047 }, { s: 0.5, rx: 0.039, rz: 0.035 }, { s: 0.575, rx: 0.032, rz: 0.027 },
    ];
    for (const r of rings) { r.rx *= bd; r.rz *= bd; }
    const cut = rolled ? 0.36 : 0.575;
    const upper = rings.filter((r) => r.s <= cut + 1e-6);
    b.put(limbLoft(jS, jW, upper, 16, true), SLOT.CAMO, armSkin);
    if (rolled) {
      const lower = rings.filter((r) => r.s >= 0.33);
      b.put(limbLoft(jS, jW, lower, 16, true), SLOT.SKIN, armSkin);
      b.add(torus(0.052, 0.016, 6, 16), SLOT.CAMO, armSkin, jE.clone().add(V(0, -0.055, 0)), [Math.PI / 2, 0, 0], [1, 1, 0.98]); // rolled cuff
    } else {
      b.add(torus(0.031, 0.0055, 6, 16), SLOT.CAMO, wristSkin, jW.clone().add(V(0, 0.016, 0)), [Math.PI / 2, 0, 0], [1, 0.85, 1]);   // sleeve cuff
      b.add(rbox(0.09, 0.12, 0.055, 0.02, 1), SLOT.GEAR, armSkin, jE.clone().add(V(sx * 0.02, 0.0, 0.03)), [0.15, 0, 0]);   // elbow pad
    }
    // deltoid cap + shoulder patch
    b.add(sphere(0.07, 16, 12), SLOT.CAMO, armSkin, [sx * 0.178 * (0.6 + 0.4 * bd), 1.468, 0.0], undefined, [1.05 * bd, 1.18, 1.0 * bd]);
    b.add(box(0.05, 0.06, 0.02), SLOT.GEAR, rigid(ua), [sx * 0.238, 1.38, 0.0], [0, 0, sx * 0.12]);
    // elbow bone bulge (back of the joint)
    b.add(sphere(0.026, 8, 6), SLOT.CAMO, armSkin, jE.clone().add(V(0, 0, 0.04)), undefined, [1.3, 1, 1]);
    // ---------- gloved hand: palm, four fingers (2 segments), thumb, cuff ----------
    const hSkin = rigid(hand);
    const hp = (x: number, y: number, z: number) => jW.clone().add(V(x, y, z));
    // The glove shares the RUBBER slot with the balaclava (draw-call budget), and on the dark
    // archetypes that made the hands solid black blobs. Lift them with vertex colour instead.
    b.shade = 1.45;
    b.add(torus(0.032, 0.008, 6, 14), SLOT.RUBBER, wristSkin, hp(0, 0.002, 0), [Math.PI / 2, 0, 0], [1, 0.8, 1]);              // glove cuff
    b.add(box(0.056, 0.022, 0.042), SLOT.RUBBER, wristSkin, hp(0, -0.014, 0.0));                                   // wrist strap
    // wrist volume: a small blended ellipsoid that fills the pinch a bent wrist would otherwise cut
    b.add(sphere(0.03, 10, 8), SLOT.RUBBER, wristSkin, hp(0, -0.006, 0.002), undefined, [1.0, 0.85, 0.95]);
    b.add(rbox(0.064, 0.072, 0.028, 0.011, 1), SLOT.RUBBER, hSkin, hp(sx * 0.002, -0.048, -0.004));                            // palm
    b.add(box(0.058, 0.022, 0.018), SLOT.GEAR, hSkin, hp(sx * 0.002, -0.074, 0.008), [0.35, 0, 0]);                   // knuckle pad
    const fingerLen = [0.07, 0.076, 0.07, 0.056];
    for (let k = 0; k < 4; k++) {
      const x = sx * (-0.023 + k * 0.0153);
      const L1 = fingerLen[k] * 0.5, L2 = fingerLen[k] * 0.5;
      const a1 = 1.0, a2 = 2.15;   // radians curled toward the palm (-Z): wraps a 32 mm grip, leaving a gap
      const p0 = hp(x, -0.082, -0.004);
      const d1 = V(0, -Math.cos(a1), -Math.sin(a1)), d2 = V(0, -Math.cos(a2), -Math.sin(a2));
      b.add(cyl(0.0066, 0.0072, L1, 6), SLOT.RUBBER, hSkin, p0.clone().addScaledVector(d1, L1 / 2), [a1, 0, 0]);
      const p1 = p0.clone().addScaledVector(d1, L1);
      b.add(sphere(0.0072, 6, 4), SLOT.RUBBER, hSkin, p1);
      b.add(cyl(0.0058, 0.0068, L2, 6), SLOT.RUBBER, hSkin, p1.clone().addScaledVector(d2, L2 / 2), [a2, 0, 0]);
    }
    {
      // thumb
      const base = hp(-sx * 0.034, -0.044, -0.008);
      const d1 = V(-sx * 0.4, -0.4, -0.82).normalize(), L1 = 0.034;
      b.add(cyl(0.0078, 0.0088, L1, 6), SLOT.RUBBER, hSkin, base.clone().addScaledVector(d1, L1 / 2), qFromTo(DOWN, d1));
      const p1 = base.clone().addScaledVector(d1, L1);
      b.add(sphere(0.008, 6, 4), SLOT.RUBBER, hSkin, p1);
      const d2 = V(sx * 0.6, -0.15, -0.79).normalize(), L2 = 0.032;
      b.add(cyl(0.0066, 0.0078, L2, 6), SLOT.RUBBER, hSkin, p1.clone().addScaledVector(d2, L2 / 2), qFromTo(DOWN, d2));
    }
    b.shade = 1;
  }

  // ---------- legs ----------
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const th = B[`thigh${side}`], sh = B[`shin${side}`], ft = B[`foot${side}`], hipB = B.hips;
    const jH = J[`thigh${side}`], jK = J[`shin${side}`], jA = J[`foot${side}`];
    // Same idea at the hip: the top 12 cm of the thigh blends back onto the pelvis so a raised knee
    // does not shear the buttock off the torso loft.
    const legSkin = chain([[sh, jK.y - 0.105], [th, jK.y + 0.105], [th, S.hipsY - 0.135], [hipB, S.hipsY + 0.035]]);
    const tucked = archetype.pants === 'tucked';
    const rings: LimbRing[] = [
      { s: -0.1, rx: 0.104, rz: 0.112, cx: sx * 0.005, cz: 0.012 }, { s: 0.0, rx: 0.1, rz: 0.11, cz: 0.014 }, { s: 0.12, rx: 0.092, rz: 0.102, cz: 0.008 },
      { s: 0.25, rx: 0.084, rz: 0.09, cz: 0.0 }, { s: 0.38, rx: 0.07, rz: 0.074, cz: -0.002 }, { s: 0.465, rx: 0.064, rz: 0.072, cz: -0.004 },
      { s: 0.54, rx: 0.062, rz: 0.068, cz: 0.0 }, { s: 0.62, rx: 0.061, rz: 0.074, cz: 0.012 }, { s: 0.7, rx: 0.056, rz: 0.062, cz: 0.006 },
    ];
    for (const r of rings) { r.rx *= bd; r.rz *= bd; }
    if (tucked) {
      b.put(limbLoft(jH, jA, rings, 16), SLOT.CAMO, legSkin);
      b.add(torus(0.058, 0.018, 6, 18), SLOT.CAMO, legSkin, V(jA.x, 0.27, 0.004), [Math.PI / 2, 0, 0], [1, 1.1, 1]);  // bloused cuff
    } else {
      rings.push({ s: 0.8, rx: 0.06, rz: 0.066, cz: 0.002 }, { s: 0.875, rx: 0.068, rz: 0.074, cz: 0.0 });
      b.put(limbLoft(jH, jA, rings, 16), SLOT.CAMO, legSkin);
    }
    // knee cap + pad
    b.add(sphere(0.032, 12, 8), SLOT.CAMO, legSkin, jK.clone().add(V(0, 0.0, -0.05)), undefined, [1.3, 1.2, 0.8]);
    // knee joint volume: sits on the joint itself, weighted across it, so a deep crouch folds the
    // trouser instead of collapsing the loft into a crease
    b.add(sphere(0.062, 12, 8), SLOT.CAMO, legSkin, jK.clone().add(V(0, 0.0, -0.006)), undefined, [1.02, 0.92, 1.06]);
    if (tucked) {
      b.add(rbox(0.11, 0.14, 0.06, 0.028, 1), SLOT.GEAR, legSkin, jK.clone().add(V(0, -0.005, -0.06)), [-0.1, 0, 0]);
      // Knee-pad retention straps. These were 11 mm black tubes rigid-bound to the thigh and the
      // shin — two hard hoops that sheared open the moment the knee bent, and at the RUBBER slot's
      // base value they read as black rings segmenting the leg like an action figure. Now they are
      // thinner, rounder (16 radial), skinned across the joint with the rest of the leg, and lifted
      // to webbing value so they sit above the trouser instead of cutting it in half.
      // ...and they are 240-degree arcs around the *back* of the leg, where a real retention strap
      // runs, instead of closed hoops. A closed ring at a joint is the single loudest "action
      // figure" cue there is: it draws a hard dark line straight across the limb's silhouette.
      b.shade = 1.9;
      for (const dy of [0.085, -0.085]) {
        b.add(torus(dy > 0 ? 0.076 : 0.068, 0.0072, 6, 16, 4.2), SLOT.RUBBER, legSkin, jK.clone().add(V(0, dy, 0)), [Math.PI / 2, 0, 0], [1, 1, 0.92]);
      }
      b.shade = 1;
    }
    // cargo pocket + flap on the outer thigh
    b.add(rbox(0.1, 0.16, 0.036, 0.012, 1), SLOT.CAMO, rigid(th), [sx * 0.168, 0.72, 0.0], [0, 0, sx * 0.05]);
    b.add(rbox(0.1, 0.03, 0.044, 0.008, 1), SLOT.CAMO, rigid(th), [sx * 0.17, 0.805, 0.0], [0, 0, sx * 0.05]);
    // ---------- boot ----------
    // ascending heights: everything at/below the ankle rides the foot bone, the shaft above it the
    // shin, blended across the malleolus. (This used to be written descending, which skinned the
    // sole to the shin and the calf to the foot.)
    const bootSkin = chain([[ft, 0.098], [sh, 0.235]]);
    const bx = jA.x;
    b.shade = 1.3;   // boot leather, same slot as the balaclava but nowhere near as dark
    b.put(loft([{ y: 0.05, rx: 0.052, rz: 0.062, cx: bx, cz: -0.004 }, { y: 0.16, rx: 0.052, rz: 0.06, cx: bx, cz: 0.0 }, { y: 0.27, rx: 0.056, rz: 0.06, cx: bx, cz: 0.004 }], 16), SLOT.RUBBER, bootSkin);
    b.add(box(0.048, 0.17, 0.012), SLOT.RUBBER, bootSkin, [bx, 0.17, -0.062], [-0.12, 0, 0]);                    // tongue / lace panel
    for (let i = 0; i < 5; i++) b.add(box(0.05, 0.005, 0.006), SLOT.GEAR, bootSkin, [bx, 0.1 + i * 0.033, -0.069 + i * 0.004], [-0.12, 0, 0]); // laces
    b.add(rbox(0.096, 0.08, 0.11, 0.022, 1), SLOT.RUBBER, rigid(ft), [bx, 0.055, 0.03]);                                     // heel cup
    b.put(limbLoft(V(bx, 0.056, -0.02), V(bx, 0.044, -0.205), [{ s: 0, rx: 0.05, rz: 0.048 }, { s: 0.08, rx: 0.052, rz: 0.042 }, { s: 0.15, rx: 0.046, rz: 0.03 }, { s: 0.185, rx: 0.032, rz: 0.02 }], 14, true), SLOT.RUBBER, rigid(ft)); // vamp + toe
    b.shade = 0.85;
    b.add(rbox(0.1, 0.024, 0.29, 0.007, 1), SLOT.RUBBER, rigid(ft), [bx, 0.012, -0.06]);                                       // sole
    b.add(box(0.1, 0.018, 0.09), SLOT.RUBBER, rigid(ft), [bx, 0.032, 0.04]);                                        // heel block
    b.shade = 1;
  }

  buildWeapon(b, archetype);
  const geo = b.build();
  cavityDust(geo);
  geo.computeBoundingSphere();
  geoCache.set(key, geo);
  return geo;
}

/**
 * Per-vertex cavity AO and dust, baked into the vertex colours once per archetype.
 *
 * The old dust was a pure height ramp, which cannot pool: it darkened the boots evenly and left
 * every crease — under the plate carrier lip, behind the mag pouches, inside the elbow, the gap
 * between the collar and the helmet — exactly as bright as the surfaces beside them. Here the body
 * is voxelised once and every vertex fires a short hemisphere of rays to measure how enclosed it
 * is. That occlusion does two jobs: it darkens cavities (the AO the characters were missing, so
 * they stop reading as flat ambient), and it drives where dust collects — creases and up-facing
 * ledges catch it, vertical and downward faces stay clean, all still scaled by height so the boots
 * are filthy and the helmet is not.
 */
function cavityDust(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  const n = pos.count;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cell = 0.022, pad = cell * 2;
  const ox = bb.min.x - pad, oy = bb.min.y - pad, oz = bb.min.z - pad;
  const nx = Math.ceil((bb.max.x - bb.min.x + pad * 2) / cell) + 1;
  const ny = Math.ceil((bb.max.y - bb.min.y + pad * 2) / cell) + 1;
  const nz = Math.ceil((bb.max.z - bb.min.z + pad * 2) / cell) + 1;
  const grid = new Uint8Array(nx * ny * nz);
  const at = (ix: number, iy: number, iz: number) => (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) ? 0 : grid[(iz * ny + iy) * nx + ix];
  const mark = (x: number, y: number, z: number) => {
    const ix = ((x - ox) / cell) | 0, iy = ((y - oy) / cell) | 0, iz = ((z - oz) / cell) | 0;
    if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) grid[(iz * ny + iy) * nx + ix] = 1;
  };
  // voxelise: vertices plus a barycentric sprinkle so big flat panels are solid, not a wire outline
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    ax.fromBufferAttribute(pos, t); bx.fromBufferAttribute(pos, t + 1); cx.fromBufferAttribute(pos, t + 2);
    mark(ax.x, ax.y, ax.z); mark(bx.x, bx.y, bx.z); mark(cx.x, cx.y, cx.z);
    const span = Math.max(ax.distanceTo(bx), bx.distanceTo(cx), cx.distanceTo(ax));
    const steps = Math.min(6, Math.ceil(span / cell));
    if (steps <= 1) continue;
    for (let i = 0; i <= steps; i++) for (let j = 0; i + j <= steps; j++) {
      const u = i / steps, v = j / steps, w = 1 - u - v;
      mark(ax.x * w + bx.x * u + cx.x * v, ax.y * w + bx.y * u + cx.y * v, ax.z * w + bx.z * u + cx.z * v);
    }
  }
  // fixed hemisphere of sample directions (cosine-ish), rotated onto each vertex normal
  const dirs: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const y = 0.18 + 0.78 * ((i % 3) + 0.5) / 3;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = (i * 2.399963) % (Math.PI * 2);
    dirs.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  const STEPS = 6, REACH = cell * 1.35;
  const nv = new THREE.Vector3(), tx = new THREE.Vector3(), tz = new THREE.Vector3();
  const c = new THREE.Color();
  // The mesh is non-indexed, so every seam vertex exists several times and a per-vertex occlusion
  // reading speckles along it. Accumulate by quantised position first, then read the average back:
  // that both smooths the voxel aliasing on curved limbs and removes the faceting at seams.
  const occAt = new Float32Array(n);
  const bucket = new Map<string, [number, number]>();
  const keyOf = (i: number) => `${Math.round(pos.getX(i) * 320)},${Math.round(pos.getY(i) * 320)},${Math.round(pos.getZ(i) * 320)}`;
  for (let i = 0; i < n; i++) {
    nv.fromBufferAttribute(nor, i);
    if (nv.lengthSq() < 1e-8) nv.set(0, 1, 0); else nv.normalize();
    // tangent frame
    if (Math.abs(nv.y) < 0.9) tx.set(0, 1, 0).cross(nv).normalize(); else tx.set(1, 0, 0).cross(nv).normalize();
    tz.crossVectors(nv, tx);
    const px = pos.getX(i) + nv.x * cell * 0.7, py = pos.getY(i) + nv.y * cell * 0.7, pz = pos.getZ(i) + nv.z * cell * 0.7;
    let hit = 0, total = 0;
    for (const d of dirs) {
      const dx = tx.x * d[0] + nv.x * d[1] + tz.x * d[2];
      const dy = tx.y * d[0] + nv.y * d[1] + tz.y * d[2];
      const dz = tx.z * d[0] + nv.z * d[1] + tz.z * d[2];
      for (let sIdx = 1; sIdx <= STEPS; sIdx++) {
        const w = 1 / sIdx;
        total += w;
        const l = sIdx * REACH;
        if (at(((px + dx * l - ox) / cell) | 0, ((py + dy * l - oy) / cell) | 0, ((pz + dz * l - oz) / cell) | 0)) { hit += w; break; }
      }
    }
    const raw = total > 0 ? Math.min(1, (hit / total) * 1.3) : 0;
    occAt[i] = raw;
    const k = keyOf(i);
    const acc = bucket.get(k);
    if (acc) { acc[0] += raw; acc[1]++; } else bucket.set(k, [raw, 1]);
  }
  for (let i = 0; i < n; i++) {
    const acc = bucket.get(keyOf(i))!;
    const occ = acc[0] / acc[1];
    nv.fromBufferAttribute(nor, i);
    // Cavity AO is the other half of holding a figure's internal range: at 15 m a pouch survives
    // because its shadow line survives, not because its colour differs. 0.42 was too polite once
    // the value ladder stopped doing that work with brightness.
    const ao = 1 - 0.56 * occ * occ * (3 - 2 * occ);
    // dust: creases and up-facing ledges collect it; height decides how much there is to collect.
    // occ^2 keeps the gently curved parts of a limb clean and puts the dust in the actual folds.
    const y = pos.getY(i);
    const h = 1 - Math.min(1, Math.max(0, (y - 0.12) / 1.05));
    const dust = Math.min(1, Math.max(0, occ * occ * 1.15 + Math.max(0, nv.y) * 0.46 - 0.14)) * (0.22 + 0.78 * h * h);
    c.fromBufferAttribute(col, i).multiplyScalar(ao);
    const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
    const kk = dust * 0.62;
    col.setXYZ(i, c.r + (lum * 1.4 - c.r) * kk, c.g + (lum * 1.32 - c.g) * kk, c.b + (lum * 1.14 - c.b) * kk);
  }
  col.needsUpdate = true;
}

/** Over-the-head headset (cap / bare head variants): band + cups + mic boom. */
function headsetOverHead(b: Builder, headSkin: SkinFn): void {
  const band = torus(0.101, 0.007, 6, 18, Math.PI); band.scale(1, 1.12, 1);
  b.add(band, SLOT.RUBBER, headSkin, [0, 1.688, 0.011]);
  for (const sx of [-1, 1]) {
    b.add(cyl(0.036, 0.04, 0.03, 16), SLOT.RUBBER, headSkin, [sx * 0.0935, 1.676, 0.007], [0, 0, Math.PI / 2]);
    b.add(cyl(0.028, 0.028, 0.008, 12), SLOT.GEAR, headSkin, [sx * 0.11, 1.676, 0.007], [0, 0, Math.PI / 2]);
  }
  const mic = [V(-0.098, 1.658, -0.02), V(-0.083, 1.638, -0.07), V(-0.044, 1.62, -0.1)];
  b.put(ribbon(mic, 0.006, 0.006, () => V(0, 1, 0), 8), SLOT.RUBBER, headSkin);
  b.add(sphere(0.011, 8, 6), SLOT.RUBBER, headSkin, [-0.044, 1.62, -0.1], undefined, [1, 1, 1.4]);
}

/** Builds the bone hierarchy in bind pose. */
export function buildSkeleton(): THREE.Bone[] {
  const bones: THREE.Bone[] = BONE_NAMES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  for (const n of BONE_NAMES) {
    const p = PARENT[n];
    const bone = bones[B[n]];
    if (p) { bones[B[p]].add(bone); bone.position.copy(JOINT[n]).sub(JOINT[p]); }
    else bone.position.copy(JOINT[n]);
  }
  return bones;
}

/**
 * Enemy weapons. A soldier's outline at 15 m is mostly his weapon: barrel length, magazine shape,
 * what is on top of the receiver and what is under the handguard are the four things that survive
 * greyscale and haze, and until this table existed every archetype carried the same AK, so the
 * squad read as one man in four paint schemes. Everything is authored in the rifle bone's frame
 * (origin = top of the pistol grip, barrel down -Z) and the muzzle point travels with the barrel so
 * the flash, the tracer origin and the AI's aim vector all follow the weapon that is actually held.
 */
export type WeaponKind = 'ak' | 'carbine' | 'dmr' | 'lmg' | 'shotgun';

export interface WeaponDef {
  /** muzzle point in the rifle bone's frame */
  muzzle: THREE.Vector3;
  /** where the support hand's wrist goes: on this weapon's handguard, not on the AK's */
  foregrip: THREE.Vector3;
  /** gap from the muzzle back to the front of the handguard */
  hgGap: number;
  /** receiver length (the barrel and handguard are laid out from it) */
  recLen: number;
}

/**
 * `foregrip` is bounded by the arm, not by the gun: the support wrist can only reach about 33 cm
 * ahead of the shoulder pocket, so every weapon's handguard is laid out to *cover* that point
 * (receiver length back, `hgGap` forward) rather than the hand being sent out to whatever length
 * the barrel happens to be. Getting this backwards is what left the carbine's support hand holding
 * air 9 cm past its own muzzle.
 */
export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  ak: { muzzle: new THREE.Vector3(0, 0.055, -0.75), foregrip: new THREE.Vector3(-0.03, -0.016, -0.33), hgGap: 0.30, recLen: 0.27 },
  carbine: { muzzle: new THREE.Vector3(0, 0.055, -0.60), foregrip: new THREE.Vector3(-0.03, -0.026, -0.31), hgGap: 0.12, recLen: 0.25 },
  dmr: { muzzle: new THREE.Vector3(0, 0.055, -0.97), foregrip: new THREE.Vector3(-0.03, -0.018, -0.34), hgGap: 0.30, recLen: 0.28 },
  lmg: { muzzle: new THREE.Vector3(0, 0.055, -0.88), foregrip: new THREE.Vector3(-0.03, -0.02, -0.35), hgGap: 0.24, recLen: 0.30 },
  shotgun: { muzzle: new THREE.Vector3(0, 0.052, -0.66), foregrip: new THREE.Vector3(-0.03, -0.018, -0.32), hgGap: 0.06, recLen: 0.26 },
};

export function weaponOf(a: ArchetypeDef): WeaponKind { return (a.weapon ?? 'ak') as WeaponKind; }

function buildWeapon(b: Builder, archetype: ArchetypeDef): void {
  const kind = weaponOf(archetype);
  const R = rigid(B.rifle);
  const o = JOINT.rifle;
  const at = (x: number, y: number, z: number) => new THREE.Vector3(o.x + x, o.y + y, o.z + z);
  const FURN = SLOT.FURNITURE, MET = SLOT.METAL, RUB = SLOT.RUBBER;
  const muzzleZ = WEAPONS[kind].muzzle.z;

  // ---- receiver group: shared spine of every weapon, with its own length ----
  const recLen = WEAPONS[kind].recLen;
  b.add(rbox(0.045, 0.07, recLen, 0.006, 1), MET, R, at(0, 0.035, -0.02 - recLen / 2));
  b.add(rbox(0.038, 0.02, recLen * 0.75, 0.006, 1), MET, R, at(0, 0.08, -0.02 - recLen / 2));   // dust cover
  b.add(box(0.02, 0.014, 0.016), MET, R, at(0.03, 0.06, -0.11));                                 // charging handle
  b.add(rbox(0.032, 0.03, 0.05, 0.004, 1), MET, R, at(0, 0.0, -0.06));                           // trigger housing
  b.add(box(0.008, 0.035, 0.06), MET, R, at(0, -0.03, -0.075));
  b.add(box(0.006, 0.02, 0.006), MET, R, at(0, -0.02, -0.07));
  b.add(rbox(0.032, 0.095, 0.045, 0.008, 1), kind === 'ak' || kind === 'shotgun' ? FURN : RUB, R, at(0, -0.045, 0.012), [-0.35, 0, 0]);  // pistol grip

  // ---- barrel + handguard: the length cue ----
  // handguard runs from the front of the receiver to `hgGap` short of the muzzle: a carbine's rail
  // reaches almost to the crown, an AK's stops 30 cm back. (The old fixed 0.30 gave the carbine a
  // zero-length handguard and left the support hand gripping air 9 cm past the barrel.)
  const hgFront = muzzleZ + WEAPONS[kind].hgGap;
  const hgBack = -0.02 - recLen;
  const hgMid = (hgFront + hgBack) / 2, hgLen = Math.abs(hgFront - hgBack);
  if (kind === 'lmg') {
    // heavy barrel under a vented heat shield: fat, long, and unmistakable in outline
    b.add(rbox(0.056, 0.07, hgLen, 0.012, 1), FURN, R, at(0, 0.05, hgMid));
    for (let i = 0; i < 5; i++) b.add(box(0.06, 0.012, 0.016), MET, R, at(0, 0.085, hgBack - 0.06 - i * 0.06));
    b.add(cyl(0.016, 0.018, Math.abs(muzzleZ - hgFront) + 0.34, 12), MET, R, at(0, 0.055, (muzzleZ + hgFront) / 2 - 0.17), [Math.PI / 2, 0, 0]);
    b.add(cyl(0.024, 0.024, 0.07, 12), MET, R, at(0, 0.055, muzzleZ + 0.03), [Math.PI / 2, 0, 0]);   // flash hider
    // folded bipod legs under the barrel: two struts that break the underside silhouette
    for (const sx of [-1, 1]) b.add(cyl(0.007, 0.005, 0.26, 6), MET, R, at(sx * 0.02, -0.02, hgFront + 0.08), [1.28, 0, sx * 0.12]);
    b.add(rbox(0.05, 0.03, 0.04, 0.008, 1), MET, R, at(0, 0.005, hgFront + 0.02));                    // bipod mount
    b.add(rbox(0.05, 0.05, 0.13, 0.01, 1), FURN, R, at(0, 0.12, hgBack - 0.05), [0, 0, 0]);           // carry handle
  } else if (kind === 'shotgun') {
    b.add(cyl(0.0135, 0.0135, hgLen + 0.34, 12), MET, R, at(0, 0.052, hgMid - 0.17), [Math.PI / 2, 0, 0]);   // barrel
    b.add(cyl(0.0125, 0.0125, hgLen + 0.28, 10), MET, R, at(0, 0.022, hgMid - 0.14), [Math.PI / 2, 0, 0]);   // tube magazine
    b.add(rbox(0.042, 0.05, 0.15, 0.012, 1), FURN, R, at(0, 0.03, hgBack - 0.12));                             // pump forend (ribbed)
    for (let i = 0; i < 4; i++) b.add(box(0.046, 0.006, 0.008), FURN, R, at(0, 0.056, hgBack - 0.07 - i * 0.03));
    b.add(box(0.016, 0.03, 0.02), MET, R, at(0, 0.08, muzzleZ + 0.04));                                        // bead/ghost ring
  } else {
    const furn = FURN;   // wood or polymer per archetype — the FURNITURE slot carries both textures
    b.add(rbox(kind === 'dmr' ? 0.044 : 0.05, kind === 'dmr' ? 0.05 : 0.062, hgLen, 0.012, 1), furn, R, at(0, 0.04, hgMid));
    b.add(rbox(0.032, 0.03, hgLen * 0.85, 0.01, 1), furn, R, at(0, 0.092, hgMid));                    // top rail / gas tube cover
    const bLen = Math.abs(muzzleZ - hgFront) + (kind === 'dmr' ? 0.34 : 0.2);
    b.add(cyl(kind === 'dmr' ? 0.0115 : 0.011, kind === 'dmr' ? 0.0125 : 0.012, bLen, 10), MET, R, at(0, 0.055, (muzzleZ + hgFront) / 2 - (kind === 'dmr' ? 0.17 : 0.1)), [Math.PI / 2, 0, 0]);
    b.add(cyl(0.009, 0.009, hgLen * 0.7, 8), MET, R, at(0, 0.098, hgMid - 0.02), [Math.PI / 2, 0, 0]);
    b.add(rbox(0.03, 0.055, 0.035, 0.005, 1), MET, R, at(0, 0.078, hgFront - 0.02));                  // gas block
    if (kind === 'ak') b.add(box(0.024, 0.07, 0.024), MET, R, at(0, 0.105, muzzleZ + 0.085));         // front sight tower
    b.add(cyl(kind === 'dmr' ? 0.016 : 0.015, kind === 'dmr' ? 0.016 : 0.015, 0.06, 10), MET, R, at(0, 0.055, muzzleZ + 0.03), [Math.PI / 2, 0, 0]);
    if (kind === 'carbine') {
      b.add(rbox(0.03, 0.075, 0.036, 0.008, 1), FURN, R, at(0, -0.02, WEAPONS.carbine.foregrip.z), [0.06, 0, 0]);  // vertical foregrip, under the hand
      b.add(rbox(0.03, 0.028, 0.05, 0.006, 1), RUB, R, at(-0.038, 0.05, hgFront + 0.16));             // side laser box
      // Suppressor. A 0.8 m carbine held low is a thin dark line at 15 m and vanishes; a 45 mm can
      // on the front of it is 20 cm of thick barrel that survives haze and greyscale.
      b.add(cyl(0.0225, 0.024, 0.2, 14), MET, R, at(0, 0.055, muzzleZ + 0.09), [Math.PI / 2, 0, 0]);
      b.add(cyl(0.026, 0.026, 0.018, 14), MET, R, at(0, 0.055, muzzleZ + 0.18), [Math.PI / 2, 0, 0]);
    }
    if (kind === 'dmr') for (const sx of [-1, 1]) b.add(cyl(0.006, 0.005, 0.24, 6), MET, R, at(sx * 0.016, -0.01, hgFront + 0.06), [1.32, 0, sx * 0.1]);  // folded bipod
  }

  // ---- optic: nothing, a low dot, or a long scope on tall rings ----
  if (kind === 'dmr') {
    b.add(cyl(0.023, 0.026, 0.3, 12), MET, R, at(0, 0.155, -0.19), [Math.PI / 2, 0, 0]);            // scope tube
    b.add(cyl(0.032, 0.032, 0.06, 12), MET, R, at(0, 0.155, -0.33), [Math.PI / 2, 0, 0]);           // objective bell
    b.add(cyl(0.028, 0.028, 0.05, 12), MET, R, at(0, 0.155, -0.05), [Math.PI / 2, 0, 0]);           // ocular
    b.add(cyl(0.03, 0.03, 0.03, 10), MET, R, at(0, 0.176, -0.19), [0, 0, 0]);                        // elevation turret
    for (const z of [-0.09, -0.28]) b.add(rbox(0.024, 0.06, 0.028, 0.005, 1), MET, R, at(0, 0.12, z));  // rings
  } else if (kind === 'lmg') {
    b.add(rbox(0.036, 0.05, 0.11, 0.008, 1), MET, R, at(0, 0.155, -0.17));                           // short optic
    b.add(rbox(0.026, 0.03, 0.03, 0.005, 1), MET, R, at(0, 0.12, -0.17));
  } else if (kind !== 'shotgun') {
    b.add(rbox(0.032, 0.04, 0.07, 0.006, 1), MET, R, at(0, kind === 'carbine' ? 0.132 : 0.115, -0.17));
    b.add(box(0.026, 0.028, 0.006), MET, R, at(0, kind === 'carbine' ? 0.152 : 0.135, -0.205));
    if (kind === 'carbine') b.add(rbox(0.028, 0.026, 0.05, 0.005, 1), MET, R, at(0, 0.1, -0.17));     // riser
  }

  // ---- magazine: the other half of the outline ----
  if (kind === 'ak') {
    for (let i = 0; i < 3; i++) b.add(rbox(0.032, 0.085, 0.07, 0.005, 1), MET, R, at(0, -0.045 - i * 0.0725, -0.165 - i * 0.035), [0.12 + i * 0.3, 0, 0]);
  } else if (kind === 'carbine') {
    b.add(rbox(0.03, 0.17, 0.055, 0.005, 1), RUB, R, at(0, -0.105, -0.15), [0.08, 0, 0]);
  } else if (kind === 'dmr') {
    b.add(rbox(0.03, 0.15, 0.062, 0.005, 1), MET, R, at(0, -0.1, -0.155), [0.05, 0, 0]);
    b.add(rbox(0.03, 0.03, 0.062, 0.005, 1), MET, R, at(0, -0.185, -0.16), [0.05, 0, 0]);             // floorplate
  } else if (kind === 'lmg') {
    b.add(cyl(0.085, 0.085, 0.085, 16), RUB, R, at(0, -0.115, -0.15), [0, 0, Math.PI / 2]);           // drum
    b.add(cyl(0.05, 0.05, 0.09, 12), MET, R, at(0, -0.115, -0.15), [0, 0, Math.PI / 2]);
    b.add(rbox(0.05, 0.06, 0.05, 0.008, 1), MET, R, at(0, -0.05, -0.15));                             // feed neck
  } else {
    for (let i = 0; i < 5; i++) b.add(cyl(0.011, 0.011, 0.03, 8), RUB, R, at(-0.03, 0.045 - i * 0.026, 0.13), [0, Math.PI / 2, Math.PI / 2]);  // side saddle shells
  }

  // ---- stock: fixed timber, collapsible tube, skeleton, or pistol-grip ----
  if (kind === 'ak' || kind === 'shotgun') {
    b.add(rbox(0.036, 0.048, 0.24, 0.008, 1), FURN, R, at(0, 0.03, 0.14), [-0.08, 0, 0]);
    b.add(rbox(0.04, 0.11, 0.025, 0.006, 1), RUB, R, at(0, 0.012, 0.268), [-0.12, 0, 0]);
  } else if (kind === 'carbine') {
    b.add(cyl(0.018, 0.018, 0.16, 10), MET, R, at(0, 0.04, 0.09), [Math.PI / 2, 0, 0]);               // buffer tube
    b.add(rbox(0.042, 0.062, 0.12, 0.012, 1), FURN, R, at(0, 0.03, 0.14), [-0.05, 0, 0]);             // collapsed stock body
    b.add(rbox(0.044, 0.1, 0.022, 0.006, 1), RUB, R, at(0, 0.012, 0.198), [-0.1, 0, 0]);
  } else if (kind === 'dmr') {
    b.add(rbox(0.03, 0.045, 0.26, 0.008, 1), FURN, R, at(0, 0.035, 0.15), [-0.05, 0, 0]);
    b.add(rbox(0.03, 0.05, 0.09, 0.008, 1), RUB, R, at(0, 0.095, 0.11), [-0.05, 0, 0]);               // adjustable cheek riser
    b.add(rbox(0.036, 0.115, 0.024, 0.006, 1), RUB, R, at(0, 0.015, 0.278), [-0.08, 0, 0]);
    b.add(box(0.024, 0.05, 0.09), RUB, R, at(0, -0.03, 0.23), [0.15, 0, 0]);                          // monopod hook
  } else {
    b.add(rbox(0.04, 0.06, 0.28, 0.01, 1), FURN, R, at(0, 0.03, 0.16), [-0.06, 0, 0]);                // heavy fixed stock
    b.add(rbox(0.046, 0.12, 0.026, 0.006, 1), RUB, R, at(0, 0.012, 0.3), [-0.1, 0, 0]);
  }

  // ---- sling: two loops and a strap that sags under the weapon ----
  const frontLoopZ = Math.min(-0.3, hgFront + 0.05);
  b.add(box(0.014, 0.014, 0.05), MET, R, at(-0.028, 0.03, 0.03));
  b.add(box(0.014, 0.014, 0.03), MET, R, at(-0.03, 0.03, frontLoopZ));
  const sling = [at(-0.032, 0.02, 0.03), at(-0.05, -0.09, -0.08), at(-0.055, -0.13, (frontLoopZ + 0.03) / 2), at(-0.045, -0.07, frontLoopZ * 0.8), at(-0.032, 0.02, frontLoopZ)];
  b.put(ribbon(sling, 0.03, 0.004, () => V(-1, 0.15, 0).normalize(), 14), RUB, R);
  b.add(box(0.036, 0.012, 0.03), MET, R, at(-0.052, -0.12, -0.15));
}

export function createSoldier(archetypeId: string, materials: THREE.Material[]): SoldierRig {
  const archetype = ARCHETYPES[archetypeId] ?? ARCHETYPES.rifleman;
  const bones = buildSkeleton();
  const root = new THREE.Group();
  root.name = 'enemy';
  root.add(bones[B.root]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(soldierGeometry(archetype), materials);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(skeleton);
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(WEAPONS[weaponOf(archetype)].muzzle);
  bones[B.rifle].add(muzzle);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), blobMaterial());
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0, 0.012, 0.02);
  blob.renderOrder = 1;
  blob.castShadow = false; blob.receiveShadow = false;
  blob.frustumCulled = false;
  root.add(blob);
  return { root, mesh, skeleton, bones, muzzle, blob, archetype };
}
