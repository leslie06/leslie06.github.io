import * as THREE from 'three';

/**
 * Clothes for the hero, cut from the base body itself.
 *
 * The Quaternius base character comes in underwear. A garment here is the part of the body's
 * surface where the garment's field is positive, cut out along the field's zero line (triangles
 * across it are clipped, so hems, cuffs, the neckline and the open front are clean curves rather
 * than triangle staircases). The piece is then draped (below the chest a jacket hangs straight
 * down, below the knee a trouser leg does, see `drape`) and pushed out along the smoothed normal
 * by the cloth's ease, so it keeps the body's skin weights and moves with it for free. Open edges
 * get a rim folded back to the body, so a hem reads as cloth with thickness; the jacket also grows
 * a collar from its neckline and lapels from its opening. Body triangles wholly inside a garment
 * are dropped, so skin never pokes through and covered skin costs nothing.
 *
 * All of it happens in the model's bind pose (a T-pose: feet at 0, crown 1.81, facing +Z, +X its
 * left, arms along X at shoulder height), where every cut is a simple function of position.
 */

export interface OutfitColors { top: THREE.Color; inner: THREE.Color; pants: THREE.Color; shoes: THREE.Color; sole: THREE.Color }

/** Wrist (|x| of the hand bones) in the bind pose; a sleeve ends a little short of it. */
const WRIST_X = 0.7;

/**
 * Neckline: positive below it. The opening is a tilted cut (lower at the front) within `r` of the
 * neck's axis, so the cloth still covers the trapezius out to the shoulders.
 */
function neckline(x: number, y: number, z: number, front: number, r: number): number {
  const cutY = front + 0.55 * (0.07 - z);
  // Nothing above the base of the skull: the face is also more than `r` from the neck's axis.
  return Math.min(Math.max(cutY - y, Math.hypot(x, z + 0.025) - r), 1.555 - y);
}

/** Half-width of the jacket's open front at height y (a V widening up to the collar). */
function openHalf(y: number): number {
  return 0.02 + 0.06 * THREE.MathUtils.smoothstep(y, 1.12, 1.46);
}

interface Garment {
  name: string;
  /** Inside where positive (bind pose, model metres). */
  field(x: number, y: number, z: number): number;
  /** Ease: how far the cloth stands off the skin (m), may depend on position. */
  ease(x: number, y: number, z: number): number;
  rim: number;
  material: THREE.MeshStandardMaterial;
}

/** A small tiling normal map: a weave with a little fibre noise (no DOM, so tests can build it). */
function fabricNormal(kind: 'twill' | 'knit' | 'denim', size = 128): THREE.DataTexture {
  const h = new Float32Array(size * size);
  let s = kind === 'twill' ? 3 : kind === 'knit' ? 5 : 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v: number;
    if (kind === 'knit') v = Math.abs(Math.sin((x / size) * Math.PI * 32)) * 0.6 + Math.sin((y / size) * Math.PI * 64) * 0.15;
    else v = Math.sin(((x + y) / size) * Math.PI * (kind === 'denim' ? 48 : 32)) * 0.5;
    h[y * size + x] = v + (rnd() - 0.5) * 0.5;
  }
  const d = new Uint8Array(size * size * 4);
  const k = kind === 'denim' ? 1.2 : 0.8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (xx: number, yy: number) => h[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * size + x) * 4;
    d[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); d[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); d[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function cloth(name: string, color: THREE.Color, roughness: number, weave: 'twill' | 'knit' | 'denim', strength: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, normalMap: fabricNormal(weave), side: THREE.DoubleSide });
  m.normalScale.set(strength, strength);
  m.userData.wet = true;
  m.name = `hero-${name}`;
  return m;
}

/** A vertex of the cut surface: position, smoothed normal, uv, up to 4 bone influences. */
class Verts {
  p: number[] = []; n: number[] = []; uv: number[] = []; si: number[] = []; sw: number[] = [];
  get count(): number { return this.p.length / 3; }
  push(p: ArrayLike<number>, n: ArrayLike<number>, uv: ArrayLike<number>, si: ArrayLike<number>, sw: ArrayLike<number>): number {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    for (let k = 0; k < 4; k++) { this.si.push(si[k]); this.sw.push(sw[k]); }
    return this.count - 1;
  }
}

/**
 * Dress `body` (the base character's skinned mesh): returns the garments as skinned meshes on the
 * same skeleton, and trims the covered triangles out of the body's index.
 */
export function dress(body: THREE.SkinnedMesh, c: OutfitColors): THREE.SkinnedMesh[] {
  const g = body.geometry;
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const N = g.getAttribute('normal') as THREE.BufferAttribute;
  const UV = g.getAttribute('uv') as THREE.BufferAttribute;
  const SI = g.getAttribute('skinIndex') as THREE.BufferAttribute;
  const SW = g.getAttribute('skinWeight') as THREE.BufferAttribute;
  const I = g.getIndex()!.array;
  const n = P.count, tris = I.length / 3;

  // Smooth normals welded by position: UV seams split vertices, and pushing each copy out along its
  // own normal would crack the cloth open along every seam.
  const qk = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const acc = new Map<string, THREE.Vector3>();
  for (let i = 0; i < n; i++) {
    const k = qk(P.getX(i), P.getY(i), P.getZ(i));
    const v = acc.get(k) ?? acc.set(k, new THREE.Vector3()).get(k)!;
    v.x += N.getX(i); v.y += N.getY(i); v.z += N.getZ(i);
  }
  const NS = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = acc.get(qk(P.getX(i), P.getY(i), P.getZ(i)))!;
    const l = v.length() || 1;
    NS[i * 3] = v.x / l; NS[i * 3 + 1] = v.y / l; NS[i * 3 + 2] = v.z / l;
  }

  const shoulder = (x: number) => Math.abs(x) > 0.2;
  const garments: Garment[] = [
    {
      // Crew-neck tee, tucked in, short sleeves (seen in the jacket's opening).
      name: 'tee', rim: 0,
      field: (x, y, z) => Math.min(y - 0.94, neckline(x, y, z, 1.47, 0.078), 0.36 - Math.abs(x)),
      ease: () => 0.004,
      material: cloth('tee', c.inner, 0.92, 'knit', 0.35),
    },
    {
      // Straight trousers from the waist to the top of the shoe.
      name: 'trousers', rim: 0.01,
      field: (x, y) => Math.min(1.04 - y, y - 0.07, 0.3 - Math.abs(x)),
      ease: (x, y) => 0.012 + 0.006 * THREE.MathUtils.smoothstep(-y, -0.6, -0.2),
      material: cloth('trousers', c.pants, 0.8, 'denim', 0.5),
    },
    {
      name: 'shoes', rim: 0.006,
      field: (x, y) => Math.min(0.13 - y, 0.3 - Math.abs(x)),
      ease: (x, y) => 0.01 + (y < 0.03 ? 0.004 : 0),
      material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, name: 'hero-shoes' }),
    },
    {
      // Hip-length jacket, open at the front, sleeves to the wrist.
      name: 'jacket', rim: 0.014,
      field: (x, y, z) => {
        if (shoulder(x) && y > 1.25) return WRIST_X - 0.03 - Math.abs(x);                          // sleeve to the cuff
        const open = Math.max(Math.abs(x) - openHalf(y), 0.02 - z);                                 // the open front
        return Math.min(y - 0.9, neckline(x, y, z, 1.455, 0.088), open, WRIST_X - 0.03 - Math.abs(x));
      },
      ease: (x, y) => (shoulder(x) && y > 1.25 ? 0.016 : 0.02),
      material: cloth('jacket', c.top, 0.7, 'twill', 0.45),
    },
  ];
  garments[2].material.userData.wet = 'surface';

  const covered = new Uint8Array(tris);
  const out: THREE.SkinnedMesh[] = [];
  const tmpSI = [0, 0, 0, 0], tmpSW = [0, 0, 0, 0];
  for (const gm of garments) {
    const F = new Float32Array(n);
    for (let i = 0; i < n; i++) F[i] = gm.field(P.getX(i), P.getY(i), P.getZ(i));
    const V = new Verts();
    const own = new Map<number, number>();
    const cut = new Map<string, number>();
    const idx: number[] = [];
    const src = (i: number): number => {
      let k = own.get(i);
      if (k === undefined) {
        const b = [SI.getComponent(i, 0), SI.getComponent(i, 1), SI.getComponent(i, 2), SI.getComponent(i, 3)];
        const w = [SW.getComponent(i, 0), SW.getComponent(i, 1), SW.getComponent(i, 2), SW.getComponent(i, 3)];
        k = V.push([P.getX(i), P.getY(i), P.getZ(i)], [NS[i * 3], NS[i * 3 + 1], NS[i * 3 + 2]], [UV.getX(i), UV.getY(i)], b, w);
        own.set(i, k);
      }
      return k;
    };
    // The point where the field crosses zero on edge a-b (shared by both triangles on the edge).
    const edge = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cut.get(key);
      if (hit !== undefined) return hit;
      const t = F[a] / (F[a] - F[b]);
      const L = (fa: number, fb: number) => fa + (fb - fa) * t;
      const p = [L(P.getX(a), P.getX(b)), L(P.getY(a), P.getY(b)), L(P.getZ(a), P.getZ(b))];
      const nn = new THREE.Vector3(L(NS[a * 3], NS[b * 3]), L(NS[a * 3 + 1], NS[b * 3 + 1]), L(NS[a * 3 + 2], NS[b * 3 + 2])).normalize();
      // Blend the two vertices' influences and keep the heaviest four.
      const inf = new Map<number, number>();
      for (let q = 0; q < 4; q++) {
        inf.set(SI.getComponent(a, q), (inf.get(SI.getComponent(a, q)) ?? 0) + SW.getComponent(a, q) * (1 - t));
        inf.set(SI.getComponent(b, q), (inf.get(SI.getComponent(b, q)) ?? 0) + SW.getComponent(b, q) * t);
      }
      const top = [...inf.entries()].sort((u, v) => v[1] - u[1]).slice(0, 4);
      const sum = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let q = 0; q < 4; q++) { tmpSI[q] = top[q]?.[0] ?? 0; tmpSW[q] = (top[q]?.[1] ?? 0) / sum; }
      const k = V.push(p, [nn.x, nn.y, nn.z], [L(UV.getX(a), UV.getX(b)), L(UV.getY(a), UV.getY(b))], tmpSI, tmpSW);
      cut.set(key, k);
      return k;
    };
    for (let t = 0; t < tris; t++) {
      const tri = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
      const inside = tri.map((i) => F[i] >= 0);
      const nIn = +inside[0] + +inside[1] + +inside[2];
      if (nIn === 0) continue;
      if (nIn === 3) { idx.push(src(tri[0]), src(tri[1]), src(tri[2])); covered[t] = 1; continue; }
      // Clip the triangle to the inside (Sutherland-Hodgman against one plane), fan the polygon.
      const poly: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        if (inside[e]) poly.push(src(a));
        if (inside[e] !== inside[(e + 1) % 3]) poly.push(edge(a, b));
      }
      for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
    }

    drape(gm.name, V);
    // Ease: push out along the normal.
    for (let i = 0; i < V.count; i++) {
      const e = gm.ease(V.p[i * 3], V.p[i * 3 + 1], V.p[i * 3 + 2]);
      V.p[i * 3] += V.n[i * 3] * e; V.p[i * 3 + 1] += V.n[i * 3 + 1] * e; V.p[i * 3 + 2] += V.n[i * 3 + 2] * e;
    }

    // Open edges, matched by position so a UV seam is not an edge.
    const pk = (i: number) => qk(V.p[i * 3], V.p[i * 3 + 1], V.p[i * 3 + 2]);
    const ek = (a: number, b: number) => { const u = pk(a), v = pk(b); return u < v ? `${u}|${v}` : `${v}|${u}`; };
    const count = new Map<string, number>();
    const tcount = idx.length / 3;
    for (let t = 0; t < tcount; t++) for (let e = 0; e < 3; e++) { const k = ek(idx[t * 3 + e], idx[t * 3 + (e + 1) % 3]); count.set(k, (count.get(k) ?? 0) + 1); }
    const open: [number, number][] = [];
    for (let t = 0; t < tcount; t++) for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e], b = idx[t * 3 + (e + 1) % 3];
      if (count.get(ek(a, b)) === 1) open.push([a, b]);
    }
    const copy = (i: number, dx: number, dy: number, dz: number): number => V.push(
      [V.p[i * 3] + dx, V.p[i * 3 + 1] + dy, V.p[i * 3 + 2] + dz], [V.n[i * 3], V.n[i * 3 + 1], V.n[i * 3 + 2]], [V.uv[i * 2], V.uv[i * 2 + 1]],
      V.si.slice(i * 4, i * 4 + 4), V.sw.slice(i * 4, i * 4 + 4));
    // Rims: each open edge folds back towards the body.
    if (gm.rim > 0) for (const [a, b] of open) {
      const r = gm.rim;
      const ia = copy(a, -V.n[a * 3] * r, -V.n[a * 3 + 1] * r, -V.n[a * 3 + 2] * r);
      const ib = copy(b, -V.n[b * 3] * r, -V.n[b * 3 + 1] * r, -V.n[b * 3 + 2] * r);
      idx.push(b, a, ia, b, ia, ib);
    }
    if (gm.name === 'jacket') {
      // Collar: the neckline stands up and flares; lapels: the opening folds out over the chest.
      const flap = (a: number, b: number, f: (i: number) => [number, number, number]) => {
        const ia = copy(a, ...f(a)), ib = copy(b, ...f(b));
        idx.push(a, b, ib, a, ib, ia);
      };
      const y = (i: number) => V.p[i * 3 + 1], x = (i: number) => V.p[i * 3], z = (i: number) => V.p[i * 3 + 2];
      for (const [a, b] of open) {
        if (Math.abs(x(a)) > 0.25 || y(a) < 1.0) continue;
        const neck = y(a) > 1.435 && y(b) > 1.435 && Math.abs(x(a)) > openHalf(y(a)) + 0.002 || z(a) < 0.03;
        if (y(a) > 1.4 && neck) {
          flap(a, b, (i) => {
            const r = Math.hypot(x(i), z(i) + 0.02) || 1;
            return [x(i) / r * 0.014, 0.042, (z(i) + 0.02) / r * 0.014];
          });
        } else if (z(a) > 0.03 && z(b) > 0.03) {
          flap(a, b, (i) => {
            const w = 0.055 * THREE.MathUtils.smoothstep(y(i), 1.02, 1.4);
            const s = Math.sign(x(i)) || 1;
            return [s * w, w * 0.25, 0.006 - w * 0.12];
          });
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(V.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(V.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(V.uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(V.si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(V.sw, 4));
    if (gm.name === 'shoes') {
      // Sole: the bottom 3.5 cm, blended over a centimetre.
      const col: number[] = [];
      for (let i = 0; i < V.count; i++) {
        const s = THREE.MathUtils.smoothstep(-V.p[i * 3 + 1], -0.045, -0.03);
        col.push(c.shoes.r + (c.sole.r - c.shoes.r) * s, c.shoes.g + (c.sole.g - c.shoes.g) * s, c.shoes.b + (c.sole.b - c.shoes.b) * s);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    geo.setIndex(idx);
    const mesh = new THREE.SkinnedMesh(geo, gm.material);
    mesh.name = `hero-${gm.name}`;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.bind(body.skeleton, body.bindMatrix);
    out.push(mesh);
  }
  // The body keeps whatever no garment wholly covers: head, neck, hands, and the triangles cut by a hem.
  const keep: number[] = [];
  for (let t = 0; t < tris; t++) if (!covered[t]) keep.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
  g.setIndex(keep);
  return out;
}

/**
 * Cloth hangs rather than clings: below the chest a jacket falls straight from the widest ring
 * (so it bridges the waist), and below the knee a trouser leg falls straight from the knee.
 * Each vertex keeps its angle round the hanging axis; only its distance from it grows.
 */
function drape(name: string, V: Verts): void {
  const BINS = 32;
  const hang = (axisX: number, axisZ: number, top: number, bottom: number, sel: (x: number, y: number) => boolean, taper: number) => {
    const ring = new Float32Array(BINS);
    const bin = (dx: number, dz: number) => Math.floor(((Math.atan2(dz, dx) / (Math.PI * 2)) + 1) * BINS) % BINS;
    for (let i = 0; i < V.count; i++) {
      const x = V.p[i * 3], y = V.p[i * 3 + 1], z = V.p[i * 3 + 2];
      if (!sel(x, y) || y < top - 0.04 || y > top + 0.04) continue;
      const b = bin(x - axisX, z - axisZ);
      ring[b] = Math.max(ring[b], Math.hypot(x - axisX, z - axisZ));
    }
    // Fill empty bins from their neighbours.
    for (let pass = 0; pass < BINS; pass++) for (let b = 0; b < BINS; b++) if (!ring[b]) ring[b] = Math.max(ring[(b + 1) % BINS], ring[(b + BINS - 1) % BINS]);
    for (let i = 0; i < V.count; i++) {
      const x = V.p[i * 3], y = V.p[i * 3 + 1], z = V.p[i * 3 + 2];
      if (!sel(x, y) || y >= top || y < bottom) continue;
      const dx = x - axisX, dz = z - axisZ, r = Math.hypot(dx, dz) || 1e-6;
      const f = (top - y) / (top - bottom);
      const want = ring[bin(dx, dz)] * (1 - taper * f);
      // Blend in over the first few centimetres below the ring.
      const w = THREE.MathUtils.smoothstep(top - y, 0, 0.06);
      const nr = r + Math.max(0, want - r) * w;
      V.p[i * 3] = axisX + dx / r * nr; V.p[i * 3 + 2] = axisZ + dz / r * nr;
    }
  };
  if (name === 'jacket') hang(0, -0.01, 1.3, 0.8, (x, y) => Math.abs(x) < 0.24 && y < 1.34, 0.06);
  if (name === 'trousers') for (const s of [1, -1]) hang(0.1 * s, -0.03, 0.52, 0, (x) => x * s > 0.01, 0.12);
}
