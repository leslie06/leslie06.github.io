import * as THREE from 'three';
import type { EnvUniforms } from '../../../game/Contracts';
import { GeoBuf, type V3, norm, cross, sub } from './geo';
import { LANDMARK_LIGHTS } from './mats';

/**
 * Curtain-wall facades drawn in the shader from the facade uv (u = metres along the wall, v = height
 * in metres): floor slabs, mullions, per-pane tint and roughness, and at night a random subset of
 * windows lit per floor (warm or cool), plus optional diagrid (CCTV), belt floors and vertical LED
 * lines (CITIC) and a lit crown. Sub-pixel detail fades to its average so distant towers don't
 * shimmer.
 */
export interface FacadeSpec {
  floorH: number; colW: number;
  glass: string; frame: string; spandrel?: string;
  mull?: number; slab?: number; metal?: number; rough?: number;
  lit?: number; warm?: string; cool?: string; coolShare?: number;
  diagrid?: { size: number; width: number; color: string; glow?: number; slope?: number };
  bands?: { every: number; h: number; color: string; glow?: number; from?: number };
  finGlow?: number;
  crown?: { from: number; glow: number; color?: string };
  seed?: number;
  side?: THREE.Side;
}

const PARS = /* glsl */`
uniform float uNight, uWinGain;
uniform vec3 uGlass, uFrame, uSpandrel, uWarm, uCool, uDiagCol, uBandCol, uCrownCol;
uniform float uFloorH, uColW, uMull, uSlab, uLit, uCoolShare, uSeed, uMetal, uRough, uFinGlow;
uniform vec4 uDiag, uBands;
uniform vec2 uCrown;
uniform float uDiagK;
uniform float uBandFrom;
varying vec2 vFac;
float fHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const MAIN = /* glsl */`
vec2 fCell = vec2(vFac.x / uColW, vFac.y / uFloorH);
vec2 fCi = floor(fCell), fCf = fract(fCell);
vec2 fFw = max(fwidth(fCell), vec2(1e-4));
float fAa = clamp(max(fFw.x, fFw.y) * 1.6 - 0.3, 0.0, 1.0);
float fMx = smoothstep(uMull - fFw.x, uMull + fFw.x, fCf.x) * (1.0 - smoothstep(1.0 - uMull - fFw.x, 1.0 - uMull + fFw.x, fCf.x));
float fMy = smoothstep(uSlab - fFw.y, uSlab + fFw.y, fCf.y) * (1.0 - smoothstep(0.975 - fFw.y, 0.975 + fFw.y, fCf.y));
float fG = mix(fMx * fMy, (1.0 - 2.0 * uMull) * (0.975 - uSlab), fAa);
float fRnd = fHash(fCi + uSeed);
vec3 fGlassC = uGlass * (0.82 + 0.36 * fHash(fCi * 1.37 + 3.1 + uSeed));
vec3 fFrameC = mix(uFrame, uSpandrel, (1.0 - fMy) * (1.0 - fAa));
vec3 fCol = mix(fFrameC, fGlassC, fG);
float fBand = 0.0;
if (uBands.w > 0.5 && vFac.y > uBandFrom) {
  float bv = mod(vFac.y, uBands.x);
  float bw = fwidth(vFac.y);
  fBand = smoothstep(uBands.x - uBands.y - bw, uBands.x - uBands.y + bw, bv);
}
float fDiag = 0.0;
if (uDiag.w > 0.5) {
  vec2 blk = floor(vFac / vec2(uDiag.x * 3.0, uDiag.x * 5.0));
  float hb = fHash(blk + 7.0);
  float s = uDiag.x * (hb > 0.66 ? 2.0 : hb > 0.25 ? 1.0 : 0.5);
  s *= vFac.y < 40.0 ? 0.5 : 1.0;
  vec2 d = vec2(vFac.x + vFac.y * uDiagK, vFac.x - vFac.y * uDiagK) / s;
  vec2 dd = 0.5 - abs(fract(d) - 0.5);
  vec2 fwd = max(fwidth(d), vec2(1e-4));
  float lw = uDiag.y / s;
  vec2 l = 1.0 - smoothstep(vec2(lw) - fwd, vec2(lw) + fwd, dd);
  fDiag = max(l.x, l.y);
  fDiag = mix(fDiag, min(1.0, 2.0 * lw * 1.6), clamp(max(fwd.x, fwd.y) * 2.0 - 0.5, 0.0, 1.0));
}
fCol = mix(fCol, uBandCol, fBand);
fCol = mix(fCol, uDiagCol, fDiag);
diffuseColor.rgb *= fCol;
float fGlassOnly = fG * (1.0 - fBand) * (1.0 - fDiag);
`;

export function facadeMaterial(env: EnvUniforms, f: FacadeSpec): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.5, side: f.side ?? THREE.FrontSide });
  const U = {
    uGlass: { value: new THREE.Color(f.glass) }, uFrame: { value: new THREE.Color(f.frame) }, uSpandrel: { value: new THREE.Color(f.spandrel ?? f.frame) },
    uWarm: { value: new THREE.Color(f.warm ?? '#ffcf8a') }, uCool: { value: new THREE.Color(f.cool ?? '#dfeaff') },
    uDiagCol: { value: new THREE.Color(f.diagrid?.color ?? '#000000') }, uBandCol: { value: new THREE.Color(f.bands?.color ?? '#000000') },
    uCrownCol: { value: new THREE.Color(f.crown?.color ?? '#dce8ff') },
    uFloorH: { value: f.floorH }, uColW: { value: f.colW }, uMull: { value: f.mull ?? 0.05 }, uSlab: { value: f.slab ?? 0.2 },
    uLit: { value: f.lit ?? 0.28 }, uCoolShare: { value: f.coolShare ?? 0.4 }, uSeed: { value: f.seed ?? 1 },
    uMetal: { value: f.metal ?? 0.85 }, uRough: { value: f.rough ?? 0.08 }, uFinGlow: { value: f.finGlow ?? 0 },
    uDiag: { value: new THREE.Vector4(f.diagrid?.size ?? 1, f.diagrid?.width ?? 0, f.diagrid?.glow ?? 0, f.diagrid ? 1 : 0) },
    uBands: { value: new THREE.Vector4(f.bands?.every ?? 1, f.bands?.h ?? 0, f.bands?.glow ?? 0, f.bands ? 1 : 0) },
    uBandFrom: { value: f.bands?.from ?? 0 },
    uDiagK: { value: f.diagrid?.slope ?? 1 },
    uCrown: { value: new THREE.Vector2(f.crown?.from ?? 1e9, f.crown?.glow ?? 0) },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.uniforms.uNight = env.uNight;
    s.uniforms.uWinGain = LANDMARK_LIGHTS.windows;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFac;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.55, uRough + 0.1 * fRnd, fGlassOnly);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.3, uMetal, fGlassOnly);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        // occupancy clusters: whole floors busy or empty, lit windows in runs of ~6 (open-plan offices)
        float fl = fHash(vec2(fCi.y * 0.37, uSeed));
        float run = floor(fCi.x / 6.0);
        float on = step(fHash(vec2(run, fCi.y) * vec2(1.3, 2.1) + uSeed * 3.1), uLit * (0.15 + 1.7 * fl * fl));
        on *= step(0.12, fHash(fCi * 1.9 + 5.0));
        vec3 lc = mix(uWarm, uCool, step(1.0 - uCoolShare, fHash(fCi + 9.1)));
        float inner = 0.6 + 0.4 * smoothstep(0.2, 0.95, fCf.y);
        float lit = on * (0.7 + 0.6 * fHash(vec2(run, fCi.y) + 4.2)) * inner;
        lit = mix(lit, uLit * 0.35, fAa);
        vec3 em = lc * lit * fGlassOnly * 0.45;
        em += uBandCol * fBand * uBands.z;
        em += vec3(0.75, 0.85, 1.0) * fDiag * uDiag.z;
        em += vec3(0.8, 0.9, 1.0) * (1.0 - fMx) * fMy * uFinGlow * (1.0 - fAa * 0.6);
        em += uCrownCol * uCrown.y * smoothstep(uCrown.x, uCrown.x + 6.0, vFac.y) * (0.3 + 0.7 * (1.0 - fMx) * (1.0 - fAa * 0.5));
        totalEmissiveRadiance += uNight * uWinGain * em;
      }`);
  };
  m.customProgramCacheKey = () => 'lm-facade';
  m.userData.wet = 'surface';
  return m;
}

/**
 * Lofted tower skin through closed outlines (same point count at every level), u = perimeter
 * metres at that level, v = height. Normals are smoothed around the loop (so rounded corners read
 * round) but faces stay flat because their points are collinear.
 */
export function loft(b: GeoBuf, levels: { y: number; pts: [number, number][] }[], o: { uRef?: number } = {}): void {
  const m = levels[0].pts.length;
  const base = b.count;
  const rows: V3[][] = levels.map((l) => l.pts.map(([x, z]) => [x, l.y, z] as V3));
  const perim = (r: V3[]) => { let s = 0; for (let i = 0; i < m; i++) s += Math.hypot(r[(i + 1) % m][0] - r[i][0], r[(i + 1) % m][2] - r[i][2]); return s; };
  const ref = o.uRef ?? perim(rows[0]);
  for (let j = 0; j < levels.length; j++) {
    const r = rows[j];
    const k = ref / perim(r);
    let u = 0;
    for (let i = 0; i <= m; i++) {
      const p = r[i % m];
      if (i > 0) u += Math.hypot(p[0] - r[i - 1][0], p[2] - r[i - 1][2]) * k;
      const a = r[(i - 1 + m) % m], c = r[(i + 1) % m];
      const up = rows[Math.min(levels.length - 1, j + 1)][i % m], dn = rows[Math.max(0, j - 1)][i % m];
      let n = cross(sub(c, a), sub(up, dn));
      n = norm(n);
      b.vert(p[0], p[1], p[2], n[0], n[1], n[2], u, p[1]);
    }
  }
  for (let j = 0; j < levels.length - 1; j++) for (let i = 0; i < m; i++) {
    const a = base + j * (m + 1) + i, c = a + m + 1;
    b.quad(a, a + 1, c + 1, c);
  }
}

/** Rounded (or chamfered, segs = 1) rectangle outline, counter-clockwise seen from above. */
export function roundRect(hw: number, hd: number, r: number, segs: number, cx = 0, cz = 0): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [[hw - r, hd - r, 0], [hw - r, -(hd - r), -Math.PI / 2], [-(hw - r), -(hd - r), -Math.PI], [-(hw - r), hd - r, -Math.PI * 1.5]];
  // walk: +x+z corner -> +x-z -> -x-z -> -x+z, angles decreasing (clockwise in x,z maths = CCW seen from above with z south)
  for (const [x, z, a0] of corners) {
    for (let k = 0; k <= segs; k++) {
      const a = a0 + Math.PI / 2 - (k / segs) * (Math.PI / 2);
      out.push([cx + x + Math.cos(a) * r, cz + z + Math.sin(a) * r]);
    }
  }
  return out;
}
