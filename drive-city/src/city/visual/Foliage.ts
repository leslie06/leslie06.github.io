import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/Rng';
import type { EnvUniforms } from '../../game/Contracts';

/**
 * Street trees as alpha-tested leaf cards: 国槐 scholar tree (0), 杨树 poplar (1), 柏树 cypress (2),
 * 银杏 ginkgo (3). Each species is one merged geometry (trunk, branches, crown cards), so a pool of
 * thousands is one instanced draw call per species and level of detail. Crown cards carry
 * "spherical" normals (from the crown centre) so the crown shades as a volume, not as flat cards,
 * and an `aSway` weight for the wind in the vertex shader.
 *
 * The leaf atlas is a DataTexture: 2x2 quadrants of leaf clusters, one per species, each with a
 * bark swatch in its bottom-right corner for the trunk. Colour is bled into the transparent texels
 * so mip levels do not grow dark fringes, and the fragment shader raises alpha with the mip level
 * so crowns do not thin out with distance.
 */

type Draw = (g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: Rng) => void;

const shade = (base: [number, number, number], k: number) => `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;

function twigs(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: Rng, n: number, col: string): void {
  g.strokeStyle = col; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = r.next() * Math.PI * 2, L = R * (0.5 + r.next() * 0.45);
    g.lineWidth = 2 + r.next() * 3;
    g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a + 0.4) * L * 0.5, cy + Math.sin(a + 0.4) * L * 0.5, cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke();
  }
}

/** Light from the top-left across the cluster, darker in the middle-bottom. */
function lightAt(x: number, y: number, cx: number, cy: number, R: number): number {
  const dx = (x - cx) / R, dy = (y - cy) / R;
  return 0.78 + 0.32 * (-dx * 0.45 - dy * 0.75) * 0.7 + 0.12 * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
}

const huai: Draw = (g, cx, cy, R, r) => {
  twigs(g, cx, cy, R, r, 14, '#4a3f33');
  const base: [number, number, number][] = [[62, 98, 44], [78, 116, 52], [54, 88, 40], [92, 128, 58]];
  for (let i = 0; i < 115; i++) {
    const a = r.next() * Math.PI * 2, d = R * Math.pow(r.next(), 0.62) * (0.7 + 0.3 * Math.abs(Math.sin(a * 3 + 1)));
    const x0 = cx + Math.cos(a) * d, y0 = cy + Math.sin(a) * d, ang = r.next() * Math.PI * 2, n = 5 + r.int(0, 4);
    const b = base[r.int(0, base.length - 1)];
    g.strokeStyle = '#4b5b33'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * n * 9, y0 + Math.sin(ang) * n * 9); g.stroke();
    for (let k = 0; k < n; k++) for (const side of [-1, 1]) {
      const px = x0 + Math.cos(ang) * k * 9, py = y0 + Math.sin(ang) * k * 9;
      const la = ang + side * 1.1;
      const lx = px + Math.cos(la) * 7, ly = py + Math.sin(la) * 7;
      g.fillStyle = shade(b, lightAt(lx, ly, cx, cy, R) * (0.85 + r.next() * 0.3));
      g.beginPath(); g.ellipse(lx, ly, 7.5, 3.6, la, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = shade(b, lightAt(x0, y0, cx, cy, R));
    g.beginPath(); g.ellipse(x0 + Math.cos(ang) * n * 9 + Math.cos(ang) * 6, y0 + Math.sin(ang) * n * 9 + Math.sin(ang) * 6, 7.5, 3.6, ang, 0, Math.PI * 2); g.fill();
  }
};

const poplar: Draw = (g, cx, cy, R, r) => {
  twigs(g, cx, cy, R, r, 10, '#6e6a60');
  for (let i = 0; i < 400; i++) {
    const a = r.next() * Math.PI * 2, d = R * Math.pow(r.next(), 0.62) * (0.72 + 0.28 * Math.abs(Math.sin(a * 2.5 + 2)));
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const silver = r.next() < 0.25;
    const b: [number, number, number] = silver ? [150, 170, 138] : r.next() < 0.5 ? [72, 110, 52] : [88, 126, 60];
    const s = 9 + r.next() * 7, ang = r.next() * Math.PI * 2;
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = shade(b, lightAt(x, y, cx, cy, R) * (0.85 + r.next() * 0.3));
    g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.9, -s * 0.1, 0, s * 0.8); g.quadraticCurveTo(-s * 0.9, -s * 0.1, 0, -s); g.fill();
    g.restore();
  }
};

const cypress: Draw = (g, cx, cy, R, r) => {
  twigs(g, cx, cy, R, r, 8, '#3d3329');
  const base: [number, number, number][] = [[42, 70, 52], [52, 82, 58], [36, 62, 48], [62, 92, 64]];
  for (let i = 0; i < 140; i++) {
    const a = r.next() * Math.PI * 2, d = R * Math.pow(r.next(), 0.62) * (0.66 + 0.3 * Math.abs(Math.sin(a * 3.5))) ;
    const x0 = cx + Math.cos(a) * d, y0 = cy + Math.sin(a) * d, ang = r.next() * Math.PI * 2;
    const b = base[r.int(0, base.length - 1)];
    // a flat spray: a stem with alternating scale-leaf fans
    for (let k = 0; k < 7; k++) {
      const px = x0 + Math.cos(ang) * k * 6, py = y0 + Math.sin(ang) * k * 6;
      for (const side of [-1, 1]) {
        const la = ang + side * (0.6 + r.next() * 0.3), L = 10 - k * 0.8;
        g.fillStyle = shade(b, lightAt(px, py, cx, cy, R) * (0.8 + r.next() * 0.35));
        g.beginPath(); g.ellipse(px + Math.cos(la) * L * 0.5, py + Math.sin(la) * L * 0.5, L * 0.55, 3.2, la, 0, Math.PI * 2); g.fill();
      }
    }
  }
};

const ginkgo: Draw = (g, cx, cy, R, r) => {
  twigs(g, cx, cy, R, r, 12, '#5a4c3c');
  for (let i = 0; i < 440; i++) {
    const a = r.next() * Math.PI * 2, d = R * Math.pow(r.next(), 0.62) * (0.72 + 0.28 * Math.abs(Math.sin(a * 3 + 0.5)));
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const b: [number, number, number] = r.next() < 0.3 ? [168, 170, 60] : r.next() < 0.5 ? [120, 150, 54] : [140, 160, 58];
    const s = 8 + r.next() * 6, ang = r.next() * Math.PI * 2;
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = shade(b, lightAt(x, y, cx, cy, R) * (0.85 + r.next() * 0.3));
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, s, -0.75 - Math.PI / 2, 0.75 - Math.PI / 2); g.closePath(); g.fill();
    g.strokeStyle = '#6b6a3a'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, s * 0.5); g.stroke();
    g.restore();
  }
};

const DRAW: Draw[] = [huai, poplar, cypress, ginkgo];
const BARK: string[] = ['#5f584e', '#b9b8ab', '#6a5647', '#6b6356'];

let atlasCache: { tex: THREE.DataTexture; size: number } | null = null;

export function leafAtlas(size: number): THREE.DataTexture {
  if (atlasCache && atlasCache.size === size) return atlasCache.tex;
  const Q = size / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const k = size / 1024;
  for (let s = 0; s < 4; s++) {
    const ox = (s % 2) * Q, oy = (s >> 1) * Q;
    g.save(); g.beginPath(); g.rect(ox, oy, Q, Q); g.clip();
    g.translate(ox, oy); g.scale(k, k);
    DRAW[s](g, 256, 256, 206, new Rng(40 + s));
    g.restore();
    // bark swatch in the corner, neutral so vertex colour tints it
    const bx = ox + Q - 40 * k, by = oy + Q - 40 * k, r = new Rng(9 + s);
    g.fillStyle = BARK[s]; g.fillRect(bx, by, 40 * k, 40 * k);
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(${r.next() < 0.5 ? '0,0,0' : '255,255,255'},${0.08 + r.next() * 0.12})`; g.fillRect(bx + r.next() * 40 * k, by, (1 + r.next() * 2) * k, 40 * k); }
  }
  const img = g.getImageData(0, 0, size, size).data;
  // Bleed leaf colour into transparent texels: blurred copies give the local mean colour.
  const bleed = (px: number) => { const c2 = document.createElement('canvas'); c2.width = c2.height = size; const g2 = c2.getContext('2d', { willReadFrequently: true })!; g2.filter = `blur(${px}px)`; g2.drawImage(cv, 0, 0); const d = g2.getImageData(0, 0, size, size).data; c2.width = c2.height = 0; return d; };
  const b1 = bleed(4 * k), b2 = bleed(24 * k);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = y * size * 4, dst = (size - 1 - y) * size * 4;   // flip: data row 0 is v = 0
    for (let x = 0; x < size * 4; x += 4) {
      const i = src + x, o = dst + x;
      let R = img[i], G = img[i + 1], B = img[i + 2];
      const A = img[i + 3];
      if (A < 250) {
        const src2 = b1[i + 3] > 12 ? b1 : b2[i + 3] > 4 ? b2 : null;
        if (src2) { const t = A / 250; R = R * t + src2[i] * (1 - t); G = G * t + src2[i + 1] * (1 - t); B = B * t + src2[i + 2] * (1 - t); }
        else { R = 60; G = 90; B = 45; }
      }
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = A;
    }
  }
  cv.width = cv.height = 0;
  const tex = new THREE.DataTexture(out, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  atlasCache = { tex, size };
  return tex;
}

/** UV rectangle of a species' leaf cluster and its bark swatch in the atlas (u0, v0, u1, v1). */
function quad(s: number): { leaf: number[]; bark: number[] } {
  const u0 = (s % 2) * 0.5, v0 = 1 - ((s >> 1) + 1) * 0.5;
  return { leaf: [u0 + 0.045, v0 + 0.045, u0 + 0.455, v0 + 0.455], bark: [u0 + 0.5 - 36 / 1024, v0 + 4 / 1024, u0 + 0.5 - 6 / 1024, v0 + 34 / 1024] };
}

interface Envelope { centre: THREE.Vector3; sample(r: Rng): { p: THREE.Vector3; out: THREE.Vector3; t: number } }
const ellipsoid = (c: THREE.Vector3, rx: number, ry: number): Envelope => ({
  centre: c,
  sample(r) {
    const u = r.next() * 2 - 1, a = r.next() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
    const t = 0.5 + 0.5 * Math.sqrt(r.next());
    return { p: new THREE.Vector3(c.x + d.x * rx * t, c.y + d.y * ry * t, c.z + d.z * rx * t), out: new THREE.Vector3(d.x / rx, d.y / ry, d.z / rx).normalize(), t };
  },
});
const cone = (y0: number, y1: number, r0: number): Envelope => ({
  centre: new THREE.Vector3(0, y0 + (y1 - y0) * 0.35, 0),
  sample(r) {
    const h = Math.pow(r.next(), 0.8), a = r.next() * Math.PI * 2, t = 0.55 + 0.45 * Math.sqrt(r.next());
    const rad = (r0 * Math.pow(1 - h, 0.85) + 0.25) * t, y = y0 + (y1 - y0) * h;
    return { p: new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad), out: new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a)).normalize(), t };
  },
});

interface Species { trunkH: number; trunkR: number; trunkCol: [string, string]; env: Envelope; cards: number; size: number; branches: number; top: number }
const SPECIES: Species[] = [
  { trunkH: 3.0, trunkR: 0.24, trunkCol: ['#dcd8d0', '#ebe7df'], env: ellipsoid(new THREE.Vector3(0, 5.6, 0), 3.4, 2.5), cards: 34, size: 2.5, branches: 3, top: 8.1 },
  { trunkH: 4.0, trunkR: 0.21, trunkCol: ['#dcdcd4', '#eeeee6'], env: ellipsoid(new THREE.Vector3(0, 9.4, 0), 2.3, 5.8), cards: 32, size: 2.2, branches: 3, top: 15 },
  { trunkH: 1.4, trunkR: 0.26, trunkCol: ['#dcd8d0', '#ebe7df'], env: cone(1.2, 9.6, 2.3), cards: 30, size: 1.9, branches: 0, top: 9.6 },
  { trunkH: 3.4, trunkR: 0.22, trunkCol: ['#dcd8d0', '#ebe7df'], env: ellipsoid(new THREE.Vector3(0, 7.2, 0), 2.6, 4.0), cards: 30, size: 2.2, branches: 3, top: 11.2 },
];

function card(pos: number[], nor: number[], uv: number[], col: number[], sway: number[], sp: Species, s: number, r: Rng, size: number, uvq: number[]): void {
  const { p, out, t } = sp.env.sample(r);
  // Mostly facing out of the crown: cards seen edge-on read as streaks.
  const n = out.clone().add(new THREE.Vector3(r.next() - 0.5, r.next() - 0.5, r.next() - 0.5).multiplyScalar(0.45)).normalize();
  const helper = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(n, helper).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const rot = r.next() * Math.PI * 2, c = Math.cos(rot), si = Math.sin(rot);
  const a = t1.clone().multiplyScalar(c).addScaledVector(t2, si).multiplyScalar(size / 2);
  const b = t1.clone().multiplyScalar(-si).addScaledVector(t2, c).multiplyScalar(size / 2);
  const corners = [p.clone().sub(a).sub(b), p.clone().add(a).sub(b), p.clone().add(a).add(b), p.clone().sub(a).add(b)];
  const uvs = [[uvq[0], uvq[1]], [uvq[2], uvq[1]], [uvq[2], uvq[3]], [uvq[0], uvq[3]]];
  const ao = 0.55 + 0.45 * t;
  const cen = sp.env.centre;
  for (const k of [0, 1, 2, 0, 2, 3]) {
    const v = corners[k];
    pos.push(v.x, v.y, v.z);
    const sn = new THREE.Vector3(v.x - cen.x, (v.y - cen.y) * 0.7, v.z - cen.z).normalize().lerp(n, 0.25).normalize();
    nor.push(sn.x, sn.y, sn.z);
    uv.push(uvs[k][0], uvs[k][1]);
    const h = Math.max(0, Math.min(1, (v.y - sp.trunkH) / (sp.top - sp.trunkH)));
    const k2 = ao * (0.72 + 0.34 * h);
    col.push(k2, k2, k2);
    sway.push(Math.min(1, 0.25 + 0.85 * h));
  }
  void s;
}

function tube(pos: number[], nor: number[], uv: number[], col: number[], sway: number[], from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, sides: number, c0: THREE.Color, c1: THREE.Color, bark: number[], w0: number, w1: number): void {
  const axis = to.clone().sub(from), L = axis.length(); axis.normalize();
  const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(axis, helper).normalize(), e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const d0 = e1.clone().multiplyScalar(Math.cos(a0)).addScaledVector(e2, Math.sin(a0)), d1 = e1.clone().multiplyScalar(Math.cos(a1)).addScaledVector(e2, Math.sin(a1));
    const A = from.clone().addScaledVector(d0, r0), B = from.clone().addScaledVector(d1, r0), C = to.clone().addScaledVector(d1, r1), D = to.clone().addScaledVector(d0, r1);
    const u0 = bark[0] + (bark[2] - bark[0]) * (i / sides), u1 = bark[0] + (bark[2] - bark[0]) * ((i + 1) / sides);
    const verts: [THREE.Vector3, THREE.Vector3, number, number, THREE.Color, number][] = [[A, d0, u0, bark[1], c0, w0], [C, d1, u1, bark[3], c1, w1], [B, d1, u1, bark[1], c0, w0], [A, d0, u0, bark[1], c0, w0], [D, d0, u0, bark[3], c1, w1], [C, d1, u1, bark[3], c1, w1]];
    for (const [v, n, u, vv, cc, w] of verts) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(u, vv); col.push(cc.r, cc.g, cc.b); sway.push(w); }
    void L;
  }
}

/** One species at one level of detail: 'near' (full cards + branches), 'mid' (fewer cards), 'far'. */
export function treeGeometry(s: number, lod: 'near' | 'mid' | 'far'): THREE.BufferGeometry {
  const sp = SPECIES[s], q = quad(s), r = new Rng(700 + s * 31 + (lod === 'near' ? 0 : lod === 'mid' ? 1 : 2));
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], sway: number[] = [];
  const c0 = new THREE.Color(sp.trunkCol[0]), c1 = new THREE.Color(sp.trunkCol[1]);
  const trunkTop = s === 2 ? sp.top * 0.7 : sp.trunkH + 0.6;
  tube(pos, nor, uv, col, sway, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, trunkTop, 0), sp.trunkR, sp.trunkR * 0.6, lod === 'far' ? 4 : 6, c0, c1, q.bark, 0, 0.15);
  if (lod === 'near') for (let i = 0; i < sp.branches; i++) {
    const a = (i / sp.branches) * Math.PI * 2 + r.next();
    const from = new THREE.Vector3(0, sp.trunkH * (0.75 + 0.2 * r.next()), 0);
    const e = sp.env.centre;
    const to = new THREE.Vector3(Math.cos(a) * 1.1, e.y + (r.next() - 0.5) * 1.0, Math.sin(a) * 1.1);
    tube(pos, nor, uv, col, sway, from, to, sp.trunkR * 0.32, 0.04, 4, c0, c1, q.bark, 0.1, 0.45);
  }
  // Near: many small cards (a crown, not a few paper fans); mid and far: fewer, bigger ones.
  const n = lod === 'near' ? Math.round(sp.cards * 1.5) : lod === 'mid' ? Math.round(sp.cards * 0.6) : 9;
  const size = sp.size * (lod === 'near' ? 0.72 : lod === 'mid' ? 1.15 : 1.6);
  for (let i = 0; i < n; i++) card(pos, nor, uv, col, sway, sp, s, r, size * (0.8 + 0.4 * r.next()), q.leaf);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.computeBoundingSphere();
  return g;
}

const SWAY_PARS = 'attribute float aSway;\nuniform float uTime;';
const SWAY = /* glsl */`
{
#ifdef USE_INSTANCING
  vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
#else
  vec2 ip = vec2(0.0);
#endif
  float ph = uTime * 1.15 + ip.x * 0.21 + ip.y * 0.17;
  float sw = aSway * aSway;
  transformed.x += (sin(ph) * 0.16 + sin(uTime * 2.9 + position.y * 1.7 + ip.x) * 0.045) * sw;
  transformed.z += (cos(ph * 0.83) * 0.12 + cos(uTime * 3.3 + position.x * 1.9 + ip.y) * 0.045) * sw;
}`;
const MIP_ALPHA = (size: number) => /* glsl */`
{
  vec2 fdx = dFdx(vMapUv) * ${size.toFixed(1)}, fdy = dFdy(vMapUv) * ${size.toFixed(1)};
  float lod = max(0.0, 0.5 * log2(max(dot(fdx, fdx), dot(fdy, fdy))));
  diffuseColor.a *= 1.0 + lod * 0.32;
}`;

/** The shared tree material and its shadow-depth twin (same sway and alpha test). */
export function foliageMaterials(env: EnvUniforms, size: number): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const map = leafAtlas(size);
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  mat.userData.wet = true;
  mat.customProgramCacheKey = () => 'city-foliage';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = env.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${SWAY_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>\n${MIP_ALPHA(size)}`)
      // Leaves keep their crown normal on both sides (no back-face flip).
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif')
      // A little light through the leaves.
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.06;');
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.42, side: THREE.DoubleSide });
  depth.customProgramCacheKey = () => 'city-foliage-depth';
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = env.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${SWAY_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${MIP_ALPHA(size)}`);
  };
  return { mat, depth };
}

/** All four species at a level of detail, merged per species (index = species). */
export function treeSet(lod: 'near' | 'mid' | 'far'): THREE.BufferGeometry[] {
  return [0, 1, 2, 3].map((s) => treeGeometry(s, lod));
}
export { mergeGeometries };
