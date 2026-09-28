import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnvUniforms } from '../../game/Contracts';
import STREET from './street.json';

/**
 * Geometry and materials for the street furniture pools (placement: StreetFurniture.ts). Every part
 * carries colour, `aGlow` (lit at night: shelter lightboxes, route boards) and `aSolid` (railing
 * posts and rails ignore the alpha-tested baluster texture), so a whole kind merges into one
 * geometry and one draw call.
 */
function part(g: THREE.BufferGeometry, col: string, glow = 0, solid = 1, uv?: [number, number]): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute('position').count;
  const c = new THREE.Color(col);
  const cols = new Float32Array(n * 3), gl = new Float32Array(n).fill(glow), so = new Float32Array(n).fill(solid);
  for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  geo.setAttribute('aSolid', new THREE.BufferAttribute(so, 1));
  if (uv) { const u = geo.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < u.count; i++) u.setXY(i, uv[0], uv[1]); }
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** 3 m railing along +x: post, top and bottom rail, baluster panel (alpha), a reflector band. */
function railGeometry(): THREE.BufferGeometry {
  const U: [number, number] = [0.5, 0.5];
  const panel = new THREE.PlaneGeometry(3, 0.78).translate(1.5, 0.61, 0);
  const uv = panel.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 18);
  return mergeGeometries([
    part(box(0.07, 1.06, 0.07, 0, 0.53, 0), '#e9e9e4', 0, 1, U),
    part(box(3, 0.06, 0.05, 1.5, 1.03, 0), '#e9e9e4', 0, 1, U),
    part(box(3, 0.05, 0.04, 1.5, 0.21, 0), '#e9e9e4', 0, 1, U),
    part(box(0.078, 0.12, 0.078, 0, 0.86, 0), '#e2b021', 0, 1, U),
    part(panel, '#f2f2ee', 0, 0),
  ])!;
}

/**
 * The same railing past RAIL_NEAR metres: the baluster panel, the top rail and the post as flat bands
 * (6 triangles; the material is double-sided). The full one is 50 triangles, and ~1450 of them within
 * 360 m were 17% of a low-tier frame's triangles.
 */
function railFarGeometry(): THREE.BufferGeometry {
  const U: [number, number] = [0.5, 0.5];
  const panel = new THREE.PlaneGeometry(3, 0.78).translate(1.5, 0.61, 0);
  const uv = panel.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 18);
  return mergeGeometries([
    part(new THREE.PlaneGeometry(3, 0.1).translate(1.5, 1.03, 0), '#e9e9e4', 0, 1, U),
    part(new THREE.PlaneGeometry(0.08, 1.06).translate(0, 0.53, 0), '#e9e9e4', 0, 1, U),
    part(panel, '#f2f2ee', 0, 0),
  ])!;
}

/**
 * The Blender street things (scripts/blender/props/street.py -> street.json: per thing, per material name, positions in
 * mm, normals in hundredths): colour and night glow per material. 'frame' is white, so a bike takes its instance colour.
 */
const STREET_LOOK: Record<string, [string, number]> = {
  frame: ['#ffffff', 0], dark: ['#1b1c1d', 0], tyre: ['#141414', 0], hub: ['#8f9398', 0], seat: ['#262626', 0], lock: ['#3a3d40', 0],
  qr: ['#e8e8e2', 0], reflector: ['#b3261e', 0], binGreen: ['#2f7b48', 0], binGreenLid: ['#276a3d', 0], binGrey: ['#6c7277', 0],
  binGreyLid: ['#5a6065', 0], label: ['#f2f2f2', 0], steel: ['#8d9296', 0], canopy: ['#d3d6d8', 0], soffit: ['#f0efe9', 0.35],
  glass: ['#34424a', 0], ad: ['#86c2e6', 1], adbox: ['#dedfd9', 0], board: ['#1e5eaa', 0.45], boardFace: ['#f2f2f2', 0.6], bench: ['#9aa0a4', 0],
};

function streetGeometry(name: 'bike' | 'bin' | 'shelter'): THREE.BufferGeometry {
  const parts = (STREET as unknown as Record<string, Record<string, { p: number[]; n: number[]; i: number[] }>>)[name];
  return mergeGeometries(Object.entries(parts).map(([mat, g]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(g.p, (v) => v / 1000), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(g.n, (v) => v / 100), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.p.length / 3) * 2).fill(0.5), 2));
    geo.setIndex(g.i);
    const [col, glow] = STREET_LOOK[mat] ?? ['#ff00ff', 0];
    return part(geo, col, glow);
  }))!;
}

/** Bus shelter past SHELTER_NEAR, 7.2 m along +x, the road in front (+z): canopy, glass back, lightbox, route board, bench. */
function shelterGeometry(): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  for (const x of [-3.3, 0, 3.3]) P.push(part(box(0.1, 2.62, 0.1, x, 1.31, -0.7), '#8d9296'));
  P.push(part(box(7.4, 0.14, 1.95, 0, 2.66, 0.1), '#d3d6d8'));
  P.push(part(box(7.4, 0.04, 1.9, 0, 2.58, 0.1), '#f0efe9', 0.35));
  P.push(part(box(6.4, 1.85, 0.03, -0.3, 1.3, -0.72), '#34424a'));
  P.push(part(box(1.3, 1.95, 0.3, 3.75, 1.28, -0.55), '#dedfd9'));
  P.push(part(box(1.1, 1.7, 0.02, 3.75, 1.3, -0.39), '#86c2e6', 1));
  P.push(part(box(0.85, 1.3, 0.07, -2.5, 1.55, -0.66), '#1e5eaa', 0.45));
  P.push(part(box(0.7, 0.9, 0.02, -2.5, 1.5, -0.62), '#f2f2f2', 0.6));
  P.push(part(box(2.8, 0.06, 0.4, -0.4, 0.46, -0.45), '#9aa0a4'));
  for (const x of [-1.6, 0.8]) P.push(part(box(0.06, 0.45, 0.3, x, 0.23, -0.45), '#6f7478'));
  P.push(part(box(2.6, 0.32, 0.05, -0.8, 2.94, 1.02), '#1e5eaa', 0.7));
  return mergeGeometries(P)!;
}

/** Two sorting bins side by side past BIN_NEAR (green recyclables, grey other waste). */
function binGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(box(0.5, 0.84, 0.42, -0.28, 0.42, 0), '#2f7b48'), part(box(0.54, 0.08, 0.46, -0.28, 0.88, 0), '#276a3d'),
    part(box(0.5, 0.84, 0.42, 0.28, 0.42, 0), '#6c7277'), part(box(0.54, 0.08, 0.46, 0.28, 0.88, 0), '#5a6065'),
    part(box(0.22, 0.12, 0.02, -0.28, 0.62, 0.215), '#f2f2f2'), part(box(0.22, 0.12, 0.02, 0.28, 0.62, 0.215), '#f2f2f2'),
  ])!;
}

/** A shared bike past BIKE_NEAR, along +x (frame colour comes from the instance colour). */
function bikeGeometry(): THREE.BufferGeometry {
  const wheel = (x: number) => part(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 8).rotateX(Math.PI / 2).translate(x, 0.33, 0), '#1b1c1d');
  const tube = (x0: number, y0: number, x1: number, y1: number, t: number, col: string) => {
    const L = Math.hypot(x1 - x0, y1 - y0);
    return part(new THREE.BoxGeometry(L, t, t).rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, 0), col);
  };
  return mergeGeometries([
    wheel(-0.52), wheel(0.52),
    tube(-0.52, 0.33, -0.18, 0.86, 0.05, '#ffffff'), tube(-0.18, 0.5, 0.46, 0.8, 0.07, '#ffffff'), tube(0.52, 0.33, 0.44, 0.98, 0.05, '#ffffff'),
    tube(-0.52, 0.33, -0.1, 0.4, 0.035, '#ffffff'),
    part(box(0.28, 0.07, 0.15, -0.2, 0.92, 0), '#262626'),
    part(box(0.06, 0.05, 0.58, 0.46, 1.0, 0), '#2a2a2a'),
    part(box(0.3, 0.2, 0.34, 0.66, 0.84, 0), '#ffffff'),
  ])!;
}

export interface FurnitureGeometries {
  rail: THREE.BufferGeometry; railFar: THREE.BufferGeometry; shelter: THREE.BufferGeometry; shelterFar: THREE.BufferGeometry;
  bin: THREE.BufferGeometry; binFar: THREE.BufferGeometry; bike: THREE.BufferGeometry; bikeFar: THREE.BufferGeometry;
}

/** The near versions are Blender's (2026-09-28); the far ones the old boxes. */
export function furnitureGeometries(): FurnitureGeometries {
  return {
    rail: railGeometry(), railFar: railFarGeometry(), shelter: streetGeometry('shelter'), shelterFar: shelterGeometry(),
    bin: streetGeometry('bin'), binFar: binGeometry(), bike: streetGeometry('bike'), bikeFar: bikeGeometry(),
  };
}

/** Balusters: one opaque bar per repeat, white everywhere so mips do not darken. */
function barTexture(): THREE.DataTexture {
  const S = 32, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, bar = Math.abs(x - S / 2 + 0.5) < 5;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = bar ? 255 : 0;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const SOLID_V = ['#include <common>', '#include <common>\nattribute float aSolid;\nvarying float vSolid;'] as const;
const SOLID_V2 = ['#include <begin_vertex>', '#include <begin_vertex>\nvSolid = aSolid;'] as const;
const SOLID_F = ['#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a = max(diffuseColor.a, vSolid);'] as const;

export function furnitureMaterials(env: EnvUniforms): { props: THREE.MeshStandardMaterial; rail: THREE.MeshStandardMaterial; railDepth: THREE.MeshDepthMaterial } {
  const props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
  props.userData.wet = 'surface';
  props.customProgramCacheKey = () => 'city-props';
  props.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = env.uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uNight * 3.0;');
  };
  const map = barTexture();
  const rail = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.3 });
  rail.userData.wet = 'surface';
  rail.customProgramCacheKey = () => 'city-rail';
  rail.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(...SOLID_V).replace(...SOLID_V2);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSolid;').replace(...SOLID_F);
  };
  const railDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  railDepth.customProgramCacheKey = () => 'city-rail-depth';
  railDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(...SOLID_V).replace(...SOLID_V2);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSolid;').replace(...SOLID_F);
  };
  return { props, rail, railDepth };
}
