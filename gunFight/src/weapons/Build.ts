import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponMaterials } from './Materials';

/**
 * Geometry toolkit for the viewmodels. Every part is a bevelled primitive; parts are merged per
 * (group, material) so a whole rifle is ~10 draw calls while moving parts (mag, bolt, slide, pump)
 * stay separate groups.
 *
 * Model convention: +X right, +Y up, muzzle towards -Z. Units are meters.
 */

export type MatKey = keyof Omit<WeaponMaterials, 'engraving' | 'witness' | 'engravingSheet'>;
export type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function xform(geo: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.BufferGeometry {
  _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e);
  _p.set(pos[0], pos[1], pos[2]);
  if (typeof scale === 'number') _s.setScalar(scale); else _s.set(scale[0], scale[1], scale[2]);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Remap uv into a sub-rectangle (used to keep the wear band off cylinder seams). */
export function remapUV(geo: THREE.BufferGeometry, u0: number, u1: number, v0: number, v1: number): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

/** Box-project UVs per triangle using the dominant normal axis, normalised to the geometry bbox with a margin. */
export function boxProjectUV(geo: THREE.BufferGeometry, margin = 0.04): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = new THREE.Vector3().subVectors(bb.max, bb.min);
  size.x = Math.max(size.x, 1e-5); size.y = Math.max(size.y, 1e-5); size.z = Math.max(size.z, 1e-5);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const span = 1 - 2 * margin;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u: number, w: number;
      if (ax >= ay && ax >= az) { u = (v.z - bb.min.z) / size.z; w = (v.y - bb.min.y) / size.y; }
      else if (ay >= az) { u = (v.x - bb.min.x) / size.x; w = (v.z - bb.min.z) / size.z; }
      else { u = (v.x - bb.min.x) / size.x; w = (v.y - bb.min.y) / size.y; }
      uv.setXY(i + k, margin + u * span, margin + w * span);
    }
  }
  g.setAttribute('uv', uv);
  return g;
}

/** Bevelled box. `bevel` is the edge radius in meters. */
export function box(w: number, h: number, d: number, bevel = 0.002, seg = 2): THREE.BufferGeometry {
  const r = Math.min(bevel, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(r, 1e-4));
}

/** Lathe from a (radius, y) profile; y runs along +Y, then rotated so the axis points where you want. */
export function lathe(profile: [number, number][], seg = 24, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
  remapUV(g, 0.12, 0.88, 0, 1);
  return g;
}

/** Cylinder with chamfered ends along +Y (height centered at 0). */
export function cyl(rTop: number, rBot: number, h: number, seg = 24, chamfer = 0.0015): THREE.BufferGeometry {
  const c = Math.min(chamfer, h * 0.3, rTop * 0.5, rBot * 0.5);
  const prof: [number, number][] = [[0, -h / 2], [rBot - c, -h / 2], [rBot, -h / 2 + c], [rTop, h / 2 - c], [rTop - c, h / 2], [0, h / 2]];
  return lathe(prof, seg);
}

/** Cylinder whose axis runs along -Z (barrel direction), centered at origin. */
export function cylZ(rFront: number, rBack: number, len: number, seg = 24, chamfer = 0.0015): THREE.BufferGeometry {
  return xform(cyl(rBack, rFront, len, seg, chamfer), [0, 0, 0], [-Math.PI / 2, 0, 0]);
}

/** Tube (hollow cylinder) along +Y. */
export function tube(rOut: number, rIn: number, h: number, seg = 24, chamfer = 0.001): THREE.BufferGeometry {
  const c = Math.min(chamfer, h * 0.3, (rOut - rIn) * 0.45);
  const prof: [number, number][] = [[rIn, -h / 2], [rOut - c, -h / 2], [rOut, -h / 2 + c], [rOut, h / 2 - c], [rOut - c, h / 2], [rIn, h / 2], [rIn, -h / 2]];
  return lathe(prof, seg);
}
export function tubeZ(rOut: number, rIn: number, len: number, seg = 24, chamfer = 0.001): THREE.BufferGeometry {
  return xform(tube(rOut, rIn, len, seg, chamfer), [0, 0, 0], [-Math.PI / 2, 0, 0]);
}

/** Extrude a 2D outline (x,y points) along Z, centered, with a bevel. */
export function extrude(points: [number, number][], depth: number, bevel = 0.0015, bevelSeg = 2, curveSeg = 8): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(depth - 2 * bevel, 1e-4), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg, curveSegments: curveSeg, steps: 1 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return boxProjectUV(g);
}

/** Extrude a THREE.Shape (for outlines with arcs/holes). */
export function extrudeShape(shape: THREE.Shape, depth: number, bevel = 0.0015, bevelSeg = 2, curveSeg = 10): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(depth - 2 * bevel, 1e-4), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg, curveSegments: curveSeg, steps: 1 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return boxProjectUV(g);
}

/** Rounded rectangle outline helper for extrude(). */
export function roundedRect(w: number, h: number, r: number, seg = 4): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

/** Capsule along +Y. */
export function capsule(r: number, len: number, capSeg = 4, radSeg = 10): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, capSeg, radSeg);
  remapUV(g, 0.1, 0.9, 0.05, 0.95);
  return g;
}

export function torus(r: number, tubeR: number, radSeg = 8, tubSeg = 24, arc = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tubeR, radSeg, tubSeg, arc);
  remapUV(g, 0.1, 0.9, 0.1, 0.9);
  return g;
}

interface Pending { geo: THREE.BufferGeometry; mat: MatKey; shade: number }
interface Darken { center: THREE.Vector3; radius: number; amount: number }

export interface BuiltGroups { [group: string]: THREE.Group }

/**
 * Accumulates transformed primitives per (group, material) and bakes one mesh per material per group.
 */
export class PartBuilder {
  private parts = new Map<string, Pending[]>();
  /** Extra objects (decal planes, lights, sockets) attached to a group after baking. */
  private extras = new Map<string, THREE.Object3D[]>();
  private darkens = new Map<string, Darken[]>();
  /** shade multiplier applied to parts added while > 0 (cavity darkening: rail slots, port interiors) */
  private curShade = 1;
  constructor(private mats: WeaponMaterials) {}

  /** Every part added until `endShade()` gets this vertex-colour multiplier (1 = untouched, 0.4 = deep recess). */
  shade(v: number): this { this.curShade = v; return this; }
  endShade(): this { this.curShade = 1; return this; }

  add(group: string, mat: MatKey, geo: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): this {
    xform(geo, pos, rot, scale);
    let list = this.parts.get(group);
    if (!list) { list = []; this.parts.set(group, list); }
    list.push({ geo, mat, shade: this.curShade });
    return this;
  }

  /** Soft vertex darkening of everything in `group` within `radius` of `center` (contact shadow where a hand wraps the gun). */
  darken(group: string, center: V3, radius: number, amount = 0.55): this {
    let list = this.darkens.get(group);
    if (!list) { list = []; this.darkens.set(group, list); }
    list.push({ center: new THREE.Vector3(center[0], center[1], center[2]), radius, amount });
    return this;
  }

  attach(group: string, obj: THREE.Object3D): this {
    let list = this.extras.get(group);
    if (!list) { list = []; this.extras.set(group, list); }
    list.push(obj);
    return this;
  }

  box(group: string, mat: MatKey, size: V3, pos: V3, bevel = 0.002, rot: V3 = [0, 0, 0], seg = 2): this {
    return this.add(group, mat, box(size[0], size[1], size[2], bevel, seg), pos, rot);
  }
  /** Cylinder along -Z (barrel axis) */
  cylZ(group: string, mat: MatKey, rFront: number, rBack: number, len: number, pos: V3, seg = 24, chamfer = 0.0015, rot: V3 = [0, 0, 0]): this {
    return this.add(group, mat, cylZ(rFront, rBack, len, seg, chamfer), pos, rot);
  }
  /** Cylinder along +Y */
  cylY(group: string, mat: MatKey, rTop: number, rBot: number, h: number, pos: V3, seg = 24, chamfer = 0.0015, rot: V3 = [0, 0, 0]): this {
    return this.add(group, mat, cyl(rTop, rBot, h, seg, chamfer), pos, rot);
  }
  /** Cylinder along +X (pins, screws through the receiver) */
  cylX(group: string, mat: MatKey, r: number, len: number, pos: V3, seg = 16, chamfer = 0.0008): this {
    return this.add(group, mat, cyl(r, r, len, seg, chamfer), pos, [0, 0, Math.PI / 2]);
  }
  tubeZ(group: string, mat: MatKey, rOut: number, rIn: number, len: number, pos: V3, seg = 24, rot: V3 = [0, 0, 0]): this {
    return this.add(group, mat, tubeZ(rOut, rIn, len, seg), pos, rot);
  }
  lathe(group: string, mat: MatKey, profile: [number, number][], pos: V3, rot: V3 = [0, 0, 0], seg = 24): this {
    return this.add(group, mat, lathe(profile, seg), pos, rot);
  }
  /** Lathe with axis along -Z (profile y becomes -z, so y=0 is the back and y=len is the front). */
  latheZ(group: string, mat: MatKey, profile: [number, number][], pos: V3, seg = 24): this {
    return this.add(group, mat, lathe(profile, seg), pos, [-Math.PI / 2, 0, 0]);
  }
  /** Side-profile extrusion: points in (z, y) plane (z forward = negative), extruded along X by `width`. */
  profileX(group: string, mat: MatKey, pts: [number, number][], width: number, pos: V3, bevel = 0.0015, rot: V3 = [0, 0, 0]): this {
    // Shape drawn as (x=-z, y=y); rotY(+90) maps local (sx,sy,sz) -> (sz, sy, -sx) = (width, y, z). No reflection.
    const g = extrude(pts.map(([z, y]) => [-z, y] as [number, number]), width, bevel);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    g.computeVertexNormals();
    return this.add(group, mat, g, pos, rot);
  }
  /** Front-profile extrusion: points in (x, y), extruded along Z by `len`. */
  profileZ(group: string, mat: MatKey, pts: [number, number][], len: number, pos: V3, bevel = 0.0015, rot: V3 = [0, 0, 0]): this {
    return this.add(group, mat, extrude(pts, len, bevel), pos, rot);
  }
  /** Top-profile extrusion: points in (x, z) plane, extruded along Y by `h`. */
  profileY(group: string, mat: MatKey, pts: [number, number][], h: number, pos: V3, bevel = 0.0015, rot: V3 = [0, 0, 0]): this {
    const g = extrude(pts.map(([x, z]) => [x, -z] as [number, number]), h, bevel);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    g.computeVertexNormals();
    return this.add(group, mat, g, pos, rot);
  }
  capsuleY(group: string, mat: MatKey, r: number, len: number, pos: V3, rot: V3 = [0, 0, 0]): this {
    return this.add(group, mat, capsule(r, len), pos, rot);
  }
  torus(group: string, mat: MatKey, r: number, tubeR: number, pos: V3, rot: V3 = [0, 0, 0], arc = Math.PI * 2): this {
    return this.add(group, mat, torus(r, tubeR, 8, 24, arc), pos, rot);
  }
  /** Hex socket screw head, axis along `axis` ('x' | 'y' | 'z'), sunk slightly. */
  screw(group: string, pos: V3, axis: 'x' | '-x' | 'y' | '-y' | 'z' | '-z', r = 0.0025): this {
    const rot: V3 = axis === 'x' ? [0, 0, -Math.PI / 2] : axis === '-x' ? [0, 0, Math.PI / 2] : axis === 'y' ? [0, 0, 0] : axis === '-y' ? [Math.PI, 0, 0] : axis === 'z' ? [Math.PI / 2, 0, 0] : [-Math.PI / 2, 0, 0];
    const head = lathe([[0, 0], [r, 0], [r, r * 0.55], [r * 0.85, r * 0.7], [r * 0.5, r * 0.7], [r * 0.5, r * 0.3], [0, r * 0.3]], 12);
    // pin/screw recesses are a cavity: 2-4 px of darkening at 1080p is what sells a hole as a hole
    const prev = this.curShade; this.curShade = Math.min(prev, 0.42);
    this.add(group, 'metalDark', head, pos, rot);
    this.curShade = prev;
    return this;
  }
  /** Picatinny rail section along -Z: base + slots. */
  rail(group: string, mat: MatKey, len: number, width: number, pos: V3, rot: V3 = [0, 0, 0], slotPitch = 0.01, height = 0.0085): this {
    const n = Math.floor(len / slotPitch);
    const g = new THREE.Group();
    void g;
    // base strip = slot floor: cavity-darkened
    const prev = this.curShade;
    this.curShade = Math.min(prev, 0.32);
    this.box(group, mat, [width, height * 0.45, len], [pos[0], pos[1] + height * 0.225, pos[2]], 0.0008, rot);
    this.curShade = prev;
    // teeth (flat boxes: 12 tris each; the bevel would be sub-pixel)
    for (let i = 0; i < n; i++) {
      const z = pos[2] - len / 2 + slotPitch * (i + 0.5);
      const t = boxProjectUV(new THREE.BoxGeometry(width, height * 0.55, slotPitch * 0.55));
      xform(t, [0, height * 0.45 + height * 0.275, 0]);
      const p = new THREE.Vector3(0, 0, z - pos[2]).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
      this.add(group, mat, t, [pos[0] + p.x, pos[1] + p.y, pos[2] + p.z], rot);
    }
    return this;
  }

  /** Bake into one Group per part-group, one Mesh per material. */
  build(): BuiltGroups {
    const out: BuiltGroups = {};
    const names = new Set<string>([...this.parts.keys(), ...this.extras.keys()]);
    for (const name of names) {
      const grp = new THREE.Group(); grp.name = name;
      const list = this.parts.get(name) ?? [];
      const byMat = new Map<MatKey, THREE.BufferGeometry[]>();
      for (const p of list) {
        let l = byMat.get(p.mat); if (!l) { l = []; byMat.set(p.mat, l); }
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        const n = g.getAttribute('position').count;
        const col = new Float32Array(n * 3); col.fill(p.shade);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        l.push(g);
      }
      const dk = this.darkens.get(name) ?? [];
      for (const [mat, geos] of byMat) {
        const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
        if (!merged) continue;
        if (dk.length) applyDarken(merged, dk);
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, this.mats[mat]);
        mesh.name = `${name}:${mat}`;
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        grp.add(mesh);
      }
      for (const o of this.extras.get(name) ?? []) grp.add(o);
      out[name] = grp;
    }
    return out;
  }
}

/** A quad decal (engraving, witness marks) facing +X or -X etc. */
export function decalPlane(w: number, h: number, mat: THREE.Material, pos: V3, rot: V3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(pos[0], pos[1], pos[2]); m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  return m;
}

/** Several quads sharing one material merged into a single mesh. `rect` = uv sub-rectangle of the texture. */
export function decalPlanes(list: { w: number; h: number; pos: V3; rot: V3; rect?: [number, number, number, number] }[], mat: THREE.Material): THREE.Mesh {
  const geos = list.map((d) => {
    const g = new THREE.PlaneGeometry(d.w, d.h);
    if (d.rect) remapUV(g, d.rect[0], d.rect[2], d.rect[1], d.rect[3]);
    return xform(g, d.pos, d.rot);
  });
  const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()), false)!;
  const m = new THREE.Mesh(merged, mat);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  return m;
}

export function socket(name: string, pos: V3, rot: V3 = [0, 0, 0]): THREE.Object3D {
  const o = new THREE.Object3D(); o.name = name; o.position.set(pos[0], pos[1], pos[2]); o.rotation.set(rot[0], rot[1], rot[2]);
  return o;
}

function applyDarken(g: THREE.BufferGeometry, list: Darken[]): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let m = 1;
    for (const d of list) {
      const t = v.distanceTo(d.center) / d.radius;
      if (t < 1) m *= 1 - d.amount * (1 - t * t) * (1 - t * t);
    }
    if (m < 1) col.setXYZ(i, col.getX(i) * m, col.getY(i) * m, col.getZ(i) * m);
  }
}

/** Move every vertex through `fn` (in place) and recompute normals. */
export function deform(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); fn(v); pos.setXYZ(i, v.x, v.y, v.z); }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Ellipsoid (sphere scaled per axis). */
export function ellipsoid(rx: number, ry: number, rz: number, wSeg = 14, hSeg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.scale(rx, ry, rz);
  remapUV(g, 0.1, 0.9, 0.1, 0.9);
  return g;
}

/**
 * Contact-shadow decals: soft dark discs where a hand (or a part) touches the gun. `normal` is the surface
 * normal at the contact; the disc is lifted 0.4 mm off the surface. One merged mesh = one draw call.
 */
export function contactShadows(list: { pos: V3; normal: V3; radius: number; stretch?: number }[], mat: THREE.Material): THREE.Mesh {
  const q = new THREE.Quaternion(); const up = new THREE.Vector3(0, 0, 1); const n = new THREE.Vector3();
  const geos = list.map((d) => {
    const g = new THREE.PlaneGeometry(d.radius * 2 * (d.stretch ?? 1), d.radius * 2);
    n.set(d.normal[0], d.normal[1], d.normal[2]).normalize();
    q.setFromUnitVectors(up, n);
    g.applyQuaternion(q);
    g.translate(d.pos[0] + n.x * 0.0004, d.pos[1] + n.y * 0.0004, d.pos[2] + n.z * 0.0004);
    return g.toNonIndexed();
  });
  const m = new THREE.Mesh(mergeGeometries(geos, false)!, mat);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.renderOrder = 1; m.name = 'contactShadows';
  return m;
}
