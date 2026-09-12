import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { EnvUniforms } from '../game/Contracts';
import { loadCity, type AreaKind, type Manifest, type Network } from './Data';
import { facadeAtlas, signAtlas } from './visual/FacadeAtlas';
import { GLSL_HASH } from './visual/hash';
import { ST, GLASS_TINTS } from './visual/styles';

/**
 * Every material the city uses, created once and shared by all tiles.
 *
 * Textures are detail, not colour: each photo texture is divided by its own mean colour in the
 * shader, so `color` x vertex colour is the surface's real albedo and the texture only adds grain.
 * (Multiplying a pale tint by a dark photo is what made the first renders brown.)
 *
 * Ground layers are separated by polygon offset, not by millimetre lifts, which z-fight at a
 * kilometre: ground < areas (by kind) < roads < paint; pavements sit 3 cm up with a curb face.
 *
 * All building walls of a tile share one facade material: style, floors and bays come per vertex
 * (Buildings.ts) and the shader draws modules from a canvas atlas (visual/FacadeAtlas.ts): windows
 * with frames, sills, curtains and AC units, enclosed balconies, shop fronts with Chinese signs,
 * hutong doors, palace lattice; curtain-wall glass is analytic (mullions, spandrels, tilted panels
 * for broken reflections). Windows, shops and signs light up with `env.uNight`.
 */
export interface CityMaterials {
  /** Walls, roofs and roof-top objects of every building. */
  facade: THREE.MeshStandardMaterial;
  /** Carriageways (vertex tint: minor roads greyer). */
  road: THREE.MeshStandardMaterial;
  /** Pavements, paths, curb stones and medians (vertex tint). */
  sidewalk: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  areas: Record<AreaKind, THREE.MeshStandardMaterial>;
}

/** Mean linear colour of a texture's image (drawn small), used to turn a photo into detail. */
function meanColour(t?: THREE.Texture): THREE.Vector3 {
  const img = t?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return new THREE.Vector3(0.5, 0.5, 0.5);
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); gg += lin(d[i + 1]); b += lin(d[i + 2]); }
    const n = d.length / 4;
    c.width = c.height = 0;
    return new THREE.Vector3(Math.max(0.02, r / n), Math.max(0.02, gg / n), Math.max(0.02, b / n));
  } catch { return new THREE.Vector3(0.5, 0.5, 0.5); }
}

const NOISE = /* glsl */`
float cityN2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + 1.0, vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

/**
 * Photo texture as detail around the material colour, plus world-space macro variation so a
 * repeated texture does not read as a grid from the air. Chains any existing onBeforeCompile.
 */
function detail(m: THREE.MeshStandardMaterial, mean: THREE.Vector3, amount: number, macro: number): THREE.MeshStandardMaterial {
  const prev = m.onBeforeCompile;
  const u = { uTexMean: { value: mean }, uDetail: { value: amount }, uMacro: { value: macro } };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCityXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCityXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uTexMean;\nuniform float uDetail;\nuniform float uMacro;\nvarying vec2 vCityXZ;\n${NOISE}`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb / uTexMean, uDetail );
#endif
{
  float cm = cityN2( vCityXZ * 0.031 ) * 0.6 + cityN2( vCityXZ * 0.13 + 7.0 ) * 0.4;
  diffuseColor.rgb *= 1.0 + ( cm - 0.5 ) * uMacro;
}`);
  };
  m.customProgramCacheKey = () => 'city-detail';
  return m;
}

/** Depth layering for coplanar ground: bigger = drawn over. */
function layer(m: THREE.Material, k: number): void {
  if (!k) return;
  m.polygonOffset = true; m.polygonOffsetFactor = -k; m.polygonOffsetUnits = -k;
}

interface FacadeTex { plaster?: THREE.Texture; brick?: THREE.Texture; brickN?: THREE.Texture; plasterMean: THREE.Vector3; brickMean: THREE.Vector3 }

function facadeMaterial(env: EnvUniforms, tx: FacadeTex, atlasSize: number, low: boolean): THREE.MeshStandardMaterial {
  const atlas = facadeAtlas(atlasSize), signs = signAtlas();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, normalMap: tx.brickN ?? null });
  m.normalScale.set(0.9, 0.9);
  m.userData.wet = true;
  const white = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); white.needsUpdate = true;
  const uniforms = {
    tFacCol: { value: atlas.col }, tFacMat: { value: atlas.mat }, tSigns: { value: signs },
    tPlaster: { value: tx.plaster ?? white }, tBrick: { value: tx.brick ?? white },
    uPlasterMean: { value: tx.plaster ? tx.plasterMean : new THREE.Vector3(0.216, 0.216, 0.216) },
    uBrickMean: { value: tx.brick ? tx.brickMean : new THREE.Vector3(0.216, 0.216, 0.216) },
    uGlassTints: { value: GLASS_TINTS.map((c) => new THREE.Color(c)) },
  };
  const S = ST;
  m.customProgramCacheKey = () => `city-facade-${low ? 'lo' : 'hi'}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.uniforms.uNight = env.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aFac;
attribute vec4 aFloor;
attribute float aSeed;
varying vec2 vWall;
varying vec4 vFac;
varying vec4 vFloor;
flat varying float vSeed;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWall = uv; vFac = aFac; vFloor = aFloor; vSeed = aSeed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${low ? '#define FAC_LOW' : ''}
uniform float uNight;
uniform sampler2D tFacCol, tFacMat, tSigns, tPlaster, tBrick;
uniform vec3 uPlasterMean, uBrickMean;
uniform vec3 uGlassTints[${GLASS_TINTS.length}];
varying vec2 vWall;
varying vec4 vFac;
varying vec4 vFloor;
flat varying float vSeed;
${GLSL_HASH}
vec2 facClampG(vec2 g) { float l = length(g); return l > 0.0078 ? g * (0.0078 / l) : g; }
void facSample(float col, float row, vec2 f, vec2 dx, vec2 dy, out vec4 c, out vec4 m) {
  vec2 q = clamp(f, vec2(0.006), vec2(0.994));
  vec2 uv = vec2((col + q.x) / 8.0, 1.0 - (row + 1.0 - q.y) / 8.0);
  dx = facClampG(dx / 8.0); dy = facClampG(dy / 8.0);
  c = textureGrad(tFacCol, uv, dx, dy);
  m = textureGrad(tFacMat, uv, dx, dy);
}`)
      .replace('#include <map_fragment>', `
float facRough = 0.88, facMetal = 0.0, facBump = 0.0, facPanel = 0.0;
vec2 facTilt = vec2(0.0);
vec3 facEmis = vec3(0.0);
{
  int sty = int(vFac.w + 0.5);
  float flags = vFac.z;
  bool shopSeg = mod(flags, 2.0) > 0.5;
  bool street = mod(floor(flags * 0.5 + 0.01), 2.0) > 0.5;
  uint seed = uint(vSeed + 0.5);
  float u = vWall.x, v = vWall.y;
  float bayC = vFac.x, bayW = max(vFac.y, 0.5);
  float fh = max(vFloor.x, 0.5), gh = vFloor.y, top = vFloor.z, base = vFloor.w;
  float y = v - base;
  // Screen derivatives, taken in uniform control flow for every textureGrad below.
  vec2 dBay = vec2(dFdx(bayC), dFdy(bayC));
  vec2 dY = vec2(dFdx(y), dFdy(y));
  vec3 dP = texture2D(tPlaster, vWall * 0.25).rgb / uPlasterMean;
  vec3 dB = texture2D(tBrick, vWall * 0.56).rgb / uBrickMean;   // ~24 cm bricks
  float fwU = fwidth(u);
  if (sty >= ${S.ROOF_FLAT}) {
    // Roofs and roof-top objects: concrete, grey hutong tile, glazed palace tile.
    vec3 rc = vColor.rgb;
    if (sty == ${S.ROOF_FLAT}) {
      rc *= mix(vec3(1.0), dP, 0.55);
#ifndef FAC_LOW
      rc *= 0.86 + 0.24 * cityVNoise(vWall * 0.18 + float(seed & 511u));
#endif
      facRough = 0.92;
    } else if (sty == ${S.OBJ}) { facRough = 0.5; facMetal = 0.25; }
    else {
      float cu = u / 0.23, cv = v / 0.27;
      float amt = 1.0 - smoothstep(0.25, 0.7, fwU / 0.23);
      float fr = fract(cu) - 0.5;
      float roll = 1.0 - 4.0 * fr * fr;
      float course = smoothstep(0.0, 0.18, fract(cv));
      rc *= mix(1.0, (0.62 + 0.42 * roll) * (0.8 + 0.2 * course), amt);
      rc *= mix(vec3(1.0), dP, 0.25);
      bool glazed = sty == ${S.ROOF_TRAD};
      facRough = glazed ? 0.32 : 0.82; facMetal = glazed ? 0.12 : 0.0;
      facTilt = vec2(fr * 0.9 * amt, 0.0); facPanel = 1.0;
    }
    diffuseColor.rgb = rc;
  } else {
  bool brick = sty == ${S.HUTONG} || sty == ${S.BRICK} || sty == ${S.WALL};
  float detA = sty == ${S.GLASS} ? 0.0 : sty == ${S.TRAD} ? 0.18 : brick ? 0.85 : 0.45;
  vec3 wallC = vColor.rgb * mix(vec3(1.0), brick ? dB : dP, detA);
  float wallRough = sty == ${S.SLAB} || sty == ${S.TOWER} ? 0.62 : brick ? 0.95 : 0.88;
  // Grime: darker at the foot of the wall, faint rain streaks.
#ifndef FAC_LOW
  float streak = cityVNoise(vec2(u * 1.3, v * 0.05 + float(seed & 1023u)));
  wallC *= 0.93 + 0.12 * streak;
#endif
  wallC *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 1.3, y));

  vec3 col = wallC;
  float cover = 0.0, glassM = 0.0;
  float fl = floor((y - gh) / fh), fy = fract((y - gh) / fh);
  float cellTop = base + gh + (fl + 1.0) * fh;
  bool inGrid = y >= gh && cellTop <= top + 0.05;
  uint cx = uint(int(floor(bayC)) + 4096), cy = uint(int(fl) + 4096);
  uint hc = cityHash3(seed, cx, cy);
  float row = -1.0, colI = 0.0, litShare = 0.5;
  vec2 f = vec2(fract(bayC), fy);
  vec2 gx = vec2(dBay.x, dY.x / fh), gy = vec2(dBay.y, dY.y / fh);

  if (sty == ${S.GLASS}) {
    float pc = bayC * 2.0, pf = fract(pc), pi = floor(pc);
    float fyy = y / fh, fl6 = floor(fyy), fy6 = fract(fyy);
    float aaX = length(dBay) * 2.0 + 1e-4, aaY = length(dY) / fh + 1e-4;
    float mw = 0.045 / (bayW * 0.5);
    float mull = 1.0 - smoothstep(mw, mw + aaX, min(pf, 1.0 - pf));
    float sp = 1.0 - smoothstep(0.26 - aaY, 0.26 + aaY, fy6);
    float tw = 0.035 / fh;
    float tran = 1.0 - smoothstep(tw, tw + aaY, min(abs(fy6 - 0.26), min(fy6, 1.0 - fy6)));
    float fr = max(mull, tran);
    uint hp = cityHash3(seed, uint(int(pi) + 4096), uint(int(fl6) + 4096));
    vec3 tint = uGlassTints[int(seed % ${GLASS_TINTS.length}u)];
    vec3 g = tint * (0.82 + 0.36 * cityH01(hp));
    vec3 spc = tint * 0.55 + vec3(0.03);
    col = mix(mix(g, spc, sp), vColor.rgb * 0.8, fr);
    glassM = 1.0 - fr;
    facRough = mix(mix(0.04 + 0.1 * cityH01(hp >> 5), 0.22, sp), 0.35, fr);
    facMetal = mix(mix(0.9, 0.7, sp), 0.8, fr);
    facTilt = (vec2(cityH01(hp >> 3), cityH01(hp >> 13)) - 0.5) * 0.09;
    facPanel = (1.0 - fr) * (1.0 - sp);
    float on = step(0.5, cityH01(cityHash3(seed, uint(int(fl6) + 4096), uint(int(floor(pc / 7.0)) + 99))));
    facEmis += vec3(0.78, 0.88, 1.0) * on * (1.0 - sp) * glassM * uNight * 1.3;
  } else if (sty == ${S.SLAB} || sty == ${S.TOWER}) {
    uint per = sty == ${S.SLAB} ? 3u : 2u;
    bool balc = (cx + (seed >> 4)) % per == 1u;
    uint grp = cityHash3(seed, 11u, 0u) % 3u;
    if (balc) { row = 1.0; colI = float(grp == 0u ? hc % 4u : grp == 1u ? 4u + hc % 2u : 6u + hc % 2u); }
    else { row = 0.0; colI = float(hc % 8u); }
    litShare = 0.55;
  } else if (sty == ${S.BRICK}) { row = 3.0; colI = float(hc % 8u); litShare = 0.5; }
  else if (sty == ${S.OFF_RIBBON}) { row = 2.0; colI = float(4u + hc % 4u); litShare = 0.45; }
  else if (sty == ${S.OFF_GRID}) { row = 2.0; colI = float(hc % 4u); litShare = 0.45; }
  else if (sty == ${S.HUTONG}) {
    row = 4.0;
    uint r = hc % 100u, w = (hc >> 8) % 2u;
    colI = street ? (r < 16u ? float(4u + (hc >> 9) % 3u) : r < 19u ? 7.0 : r < 55u ? float(2u + w) : float(w))
                  : (r < 6u ? float(4u + (hc >> 9) % 3u) : r < 40u ? float(2u + w) : float(w));
    litShare = 0.45;
  } else if (sty == ${S.TRAD}) { row = 5.0; colI = float(hc % 8u); litShare = 0.0; }
  else if (sty == ${S.LOW}) { row = 7.0; colI = float(hc % 2u); litShare = 0.3; }
  else if (sty == ${S.STATION}) { row = 7.0; colI = float(2u + hc % 2u); litShare = 0.8; }

  vec4 mc = vec4(0.0), mm = vec4(0.0, 0.0, 0.0, 1.0);
  bool ground = gh > 0.0 && y < gh && y >= 0.0 && sty != ${S.GLASS};
  if (ground && shopSeg) {
    // Shop units: pillars, a lightbox sign, the shop front below it.
    float k = max(1.0, floor(4.8 / bayW + 0.5));
    float sc = bayC / k, si = floor(sc), sf = fract(sc);
    uint hs = cityHash3(seed, uint(int(si) + 4096), 555u);
    float sTop = gh - 0.25, sBot = gh - 1.2;
    float qx = (sf - 0.05) / 0.9;
    vec2 sgx = vec2(dBay.x / k / 0.9, dY.x), sgy = vec2(dBay.y / k / 0.9, dY.y);
    if (qx > 0.0 && qx < 1.0) {
      if (y > sBot && y < sTop) {
        if (hs % 10u != 0u) {
          uint idx = (hs >> 4) % 32u;
          vec2 q = vec2(clamp(qx, 0.004, 0.996), (y - sBot) / (sTop - sBot));
          vec2 suv = vec2((float(idx % 2u) + q.x) / 2.0, 1.0 - (float(idx / 2u) + 1.0 - q.y) / 16.0);
          vec4 sgn = textureGrad(tSigns, suv, vec2(sgx.x / 2.0, sgx.y / (sTop - sBot) / 16.0), vec2(sgy.x / 2.0, sgy.y / (sTop - sBot) / 16.0));
          col = sgn.rgb; cover = 1.0; facRough = 0.35;
          facEmis += sgn.rgb * uNight * 1.9;
        }
      } else if (y <= sBot) {
        facSample(float((hs >> 9) % 8u), 6.0, vec2(qx, y / sBot), vec2(sgx.x, sgx.y / sBot), vec2(sgy.x, sgy.y / sBot), mc, mm);
        cover = mm.r; glassM = mm.g;
        col = mix(wallC, mc.rgb, cover) * mm.b;
        facEmis += mc.rgb * vec3(1.0, 0.9, 0.75) * glassM * uNight * step(0.15, cityH01(hs >> 2)) * 0.75;
      } else { col = wallC * 0.9; }
    } else { col = mix(wallC, vec3(0.62, 0.61, 0.58), 0.6); }
  } else if (ground && row >= 0.0 && sty != ${S.HUTONG} && sty != ${S.TRAD}) {
    colI = cx % 5u == 2u ? 6.0 + float(hc % 2u) : 4.0 + float(hc % 2u);
    facSample(colI, 7.0, vec2(fract(bayC), y / gh), vec2(dBay.x, dY.x / gh), vec2(dBay.y, dY.y / gh), mc, mm);
    cover = mm.r; glassM = mm.g;
    col = mix(wallC, mc.rgb, cover) * mm.b;
  } else if (row >= 0.0 && inGrid) {
    facSample(colI, row, f, gx, gy, mc, mm);
    cover = mm.r; glassM = mm.g;
    col = mix(wallC, mc.rgb, cover) * mm.b;
    float litR = cityH01(cityHashU(hc ^ 0x5bd1e995u));
    float on = step(1.0 - litShare, litR);
    vec3 warm = mix(vec3(1.0, 0.7, 0.4), vec3(0.8, 0.87, 1.0), step(0.8, fract(litR * 7.3)));
    facEmis += warm * on * glassM * uNight * (0.5 + 2.4 * dot(mc.rgb, vec3(0.3, 0.55, 0.15)));
  }
  // Floor slab bands on housing blocks, the coping on parapets and walls.
  if ((sty == ${S.SLAB} || sty == ${S.BRICK} || sty == ${S.TOWER}) && y > gh && v < top) {
    float bw = 0.16 / fh, aa = length(dY) / fh + 1e-4;
    float band = (1.0 - smoothstep(bw, bw + aa, fy)) * (1.0 - cover);
    col = mix(col, wallC * (cityH01(seed * 7u) < 0.5 ? 1.16 : 0.84), band);
  }
  if (sty != ${S.GLASS} && v > top + 0.42) col = mix(col, vec3(0.74, 0.73, 0.7), 0.75);
  if (sty == ${S.WALL} && v > top - 0.35) col = mix(col, vec3(0.3, 0.32, 0.33), 0.8);
  if (sty != ${S.GLASS}) {
    facRough = mix(wallRough, 0.45, cover * (1.0 - glassM));
    facRough = mix(facRough, 0.07, glassM);
    facMetal = glassM * 0.2;
  }
  facBump = brick ? (1.0 - cover) : 0.0;
  diffuseColor.rgb = col;
  }
}`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = facRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = facMetal;')
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
vec2 facNS = normalScale * facBump;
#define normalScale facNS
#endif
#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
#undef normalScale
#endif
if (facPanel > 0.001) {
  vec3 facUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 facT = normalize(cross(facUp, normal));
  normal = normalize(normal + (facT * facTilt.x + facUp * facTilt.y) * facPanel);
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facEmis;');
  };
  return m;
}

/**
 * The drivable network drawn once into a world-space mask (a few metres per pixel), for the ground
 * plane beyond the streamed tiles: from the air the city keeps its street grid to the horizon.
 */
async function roadMap(size: number): Promise<{ tex: THREE.CanvasTexture; bounds: THREE.Vector4 } | null> {
  try {
    const [man, net] = await Promise.all([loadCity<Manifest>('manifest.json'), loadCity<Network>('network.json')]);
    const b = man.bounds, pad = 300;
    const x0 = b.x0 - pad, z0 = b.z0 - pad, S = Math.max(b.x1 - b.x0, b.z1 - b.z0) + 2 * pad, k = size / S;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const e of net.edges) {
      g.lineWidth = Math.max(0.8, e.w * k * 1.1);
      g.beginPath();
      for (let i = 0; i < e.p.length; i += 2) { const x = (e.p[i] - x0) * k, y = (e.p[i + 1] - z0) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return { tex, bounds: new THREE.Vector4(x0, z0, S, S) };
  } catch (e) { console.warn('[city] road map', e); return null; }
}

export async function createCityMaterials(engine: Engine, env: EnvUniforms): Promise<CityMaterials> {
  const a = engine.assets;
  const tex = async (name: string, metres: number) => {
    try { return await a.pbr(name, { repeat: [1 / metres, 1 / metres] }); }
    catch (e) { console.warn('[city] texture', name, e); return {}; }
  };
  const [asphalt, asphaltOld, paving, plaza, concrete, tiles, brick, plaster, grass, grassDry] = await Promise.all([
    tex('asphalt_02', 7), tex('asphalt_04', 6), tex('square_brick_paving', 2.4), tex('granite_tile', 3), tex('brushed_concrete', 5),
    tex('concrete_tiles', 4), tex('dark_brick_wall', 3), tex('grey_plaster', 4), tex('leafy_grass', 4), tex('sparse_grass', 5),
  ]);
  const mean = (t?: THREE.Texture) => meanColour(t);
  const std = (o: THREE.MeshStandardMaterialParameters, t: { map?: THREE.Texture } | undefined, amount: number, macro: number, off = 0, wet: boolean | string = true) => {
    const m = detail(new THREE.MeshStandardMaterial({ ...o, map: t?.map ?? null }), mean(t?.map), amount, macro);
    m.userData.wet = wet;
    layer(m, off);
    return m;
  };
  const tier = engine.quality.tier;
  const areas: Record<AreaKind, THREE.MeshStandardMaterial> = {
    rail: std({ roughness: 1, color: '#9a968e' }, concrete, 0.6, 0.25, 1, true),
    parking: std({ roughness: 0.9, color: '#8e8d89' }, asphaltOld, 0.6, 0.2, 1.5, 'ground'),
    grass: std({ normalMap: grass.normalMap ?? null, roughness: 0.95, color: '#7c9460' }, grass, 0.8, 0.35, 2, true),
    park: std({ normalMap: grass.normalMap ?? null, roughness: 0.95, color: '#6f8c55' }, grass, 0.8, 0.4, 2.5, true),
    wood: std({ roughness: 1, color: '#6b7a4c' }, grassDry, 0.7, 0.45, 3, true),
    pitch: std({ roughness: 0.85, color: '#6f9656' }, grass, 0.4, 0.1, 3.5, true),
    plaza: std({ normalMap: plaza.normalMap ?? null, roughness: 0.7, color: '#c4c1b9' }, plaza, 0.55, 0.12, 4, 'ground'),
    water: std({ color: '#2a3c40', roughness: 0.05, metalness: 0.1, envMapIntensity: 1.3 }, undefined, 0, 0.1, 4.5, false),
  };
  const nm = (t: { normalMap?: THREE.Texture }) => t.normalMap ?? null;
  const ground = std({ normalMap: nm(tiles), roughness: 0.95, color: '#9d9c97' }, tiles, 0.6, 0.35, 0, 'ground');
  const rm = await roadMap(tier === 'low' ? 1024 : 2048);
  if (rm) {
    // Fade the map in where the detailed tiles end (radius 2/3/4 tiles by tier).
    const r = (tier === 'low' ? 2 : tier === 'medium' ? 3 : 4) * 256;
    const prev = ground.onBeforeCompile;
    const u = { tRoadMap: { value: rm.tex }, uRoadMapB: { value: rm.bounds }, uRoadFade: { value: new THREE.Vector2(r * 0.85, r * 1.25) } };
    ground.onBeforeCompile = (sh, rr) => {
      prev.call(ground, sh, rr);
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tRoadMap;\nuniform vec4 uRoadMapB;\nuniform vec2 uRoadFade;')
        .replace('#include <color_fragment>', `{
  vec2 ruv = vec2((vCityXZ.x - uRoadMapB.x) / uRoadMapB.z, 1.0 - (vCityXZ.y - uRoadMapB.y) / uRoadMapB.w);
  float rmask = texture2D(tRoadMap, ruv).r;
  float fd = smoothstep(uRoadFade.x, uRoadFade.y, distance(vec3(vCityXZ.x, 0.0, vCityXZ.y), cameraPosition));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.09, 0.095), rmask * fd * 0.9);
}
#include <color_fragment>`);
    };
    ground.customProgramCacheKey = () => 'city-ground';
  }
  return {
    facade: facadeMaterial(env, { plaster: plaster.map, brick: brick.map, brickN: brick.normalMap, plasterMean: mean(plaster.map), brickMean: mean(brick.map) }, tier === 'low' ? 1024 : 2048, tier === 'low'),
    road: std({ normalMap: nm(asphalt), roughnessMap: asphalt.roughnessMap ?? null, roughness: 1, color: '#5c5d5f', vertexColors: true }, asphalt, 0.9, 0.22, 5, 'ground'),
    sidewalk: std({ normalMap: nm(paving), roughness: 0.85, color: '#aeaaa2', vertexColors: true }, paving, 0.75, 0.18, 1, 'ground'),
    paint: std({ roughness: 0.6, color: '#ffffff', vertexColors: true }, undefined, 0, 0.12, 7, 'ground'),
    ground,
    areas,
  };
}
