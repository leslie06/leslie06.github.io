import * as THREE from 'three';
import type { Livery } from './CarModel';
import { ATLAS_H, ATLAS_W, PX, type PxRect } from './Atlas';
import { LAMP } from './Mesher';

/**
 * Car materials. Four shaders cover every car:
 *
 *   paint  MeshPhysical (clearcoat). Full model: one material per tone (upper, lower) plus glass.
 *          Instanced: one material, the tone picked per vertex (aux.x) from per-instance colours
 *          (instUpper / instLower, .w = metalness), glass keeping its vertex colour.
 *   trim   MeshStandard, livery atlas x vertex colour, roughness/metalness per vertex: black
 *          plastic, rubber, chrome, grille, plates and seams in one draw call.
 *   lamp   trim + emission: atlas rgb x atlas alpha (the lamp's LED pattern) x an intensity per lamp
 *          kind (uniform array), and per instance brake / reverse / taxi flags on traffic. Alpha
 *          doubles as coverage for cut-out lettering (flag F_CUTOUT), which is discarded.
 *   wheel  MeshStandard, vertex colour, roughness/metalness per vertex.
 *
 * The patches only append after three's chunks (and keep the #include lines), so render/Lighting's
 * CSM and wet-surface hooks, which chain after onBeforeCompile, still find what they look for.
 * Paint and glass carry `userData.wet = 'surface'`.
 */

const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

// ---- lamp intensities ------------------------------------------------------------------------------

export type LampArray = Float32Array;
/** Per-kind emission multipliers (indexed by LAMP kinds). */
export function lampArray(): LampArray {
  const a = new Float32Array(9);
  a[LAMP.head] = 0.6; a[LAMP.tail] = 0.35; a[LAMP.brake] = 4; a[LAMP.reverse] = 3; a[LAMP.amber] = 0.12;
  a[LAMP.beaconR] = 0.25; a[LAMP.beaconB] = 0.25; a[LAMP.sign] = 0.35; a[LAMP.none] = 0;
  return a;
}

/**
 * Lamp state -> intensities. Full model: brake and reverse are the car's own. Instanced (`inst`):
 * tail/brake/reverse hold the lit levels and each instance's flags choose between them.
 */
export function setLampState(a: LampArray, o: { head: boolean; brake?: boolean; reverse?: boolean }, inst: boolean): void {
  const tail = o.head ? 1.1 : 0.35;
  a[LAMP.head] = o.head ? 2.6 : 0.6;
  a[LAMP.sign] = o.head ? 1.4 : 0.35;
  if (inst) { a[LAMP.tail] = tail; a[LAMP.brake] = 4; a[LAMP.reverse] = 3; }
  else { a[LAMP.tail] = o.brake ? 4 : tail; a[LAMP.brake] = o.brake ? 4 : 0; a[LAMP.reverse] = o.reverse ? 3 : 0; }
}

// ---- paint -----------------------------------------------------------------------------------------

const _hsl = { h: 0, s: 0, l: 0 };
/** Metalness a paint colour gets: silvers, greys, dark blues and champagne are metallic; white and taxi yellow solid. */
export function paintMetal(c: THREE.Color): number {
  c.getHSL(_hsl);
  if (_hsl.l > 0.8) return 0.05;
  if (_hsl.s < 0.18) return _hsl.l < 0.06 ? 0.35 : 0.65;
  if (_hsl.h > 0.08 && _hsl.h < 0.16 && _hsl.s > 0.7) return 0;   // taxi yellow
  return _hsl.l < 0.25 ? 0.5 : 0.3;
}

// ---- shader patches --------------------------------------------------------------------------------

interface PatchOpts { tone?: boolean; lamp?: LampArray; instLamp?: boolean; map?: boolean }

const VERT_PARS = /* glsl */`
attribute vec2 pbr;
attribute vec2 aux;
varying vec2 vPbr;
varying vec2 vAux;
#ifdef CAR_TONE
attribute vec4 instUpper;
attribute vec4 instLower;
varying float vCarMetal;
#endif
#ifdef CAR_LAMP
uniform float uLamp[9];
varying float vLampI;
#endif
#ifdef CAR_INST_LAMP
attribute vec4 instLamp;
#endif
`;

const VERT_MAIN = /* glsl */`
vPbr = pbr;
vAux = aux;
#ifdef CAR_TONE
{
  vec4 carTone = aux.x < 0.5 ? instUpper : (aux.x < 1.5 ? instLower : vec4(1.0, 1.0, 1.0, -1.0));
  vColor.rgb = color.rgb * carTone.rgb;
  vCarMetal = carTone.a;
}
#endif
#ifdef CAR_LAMP
{
  int k = int(aux.x + 0.5);
  float li = uLamp[k];
  #ifdef CAR_INST_LAMP
    if (k == 1) li = mix(uLamp[1], uLamp[2], instLamp.y);
    else if (k == 2) li = uLamp[2] * instLamp.y;
    else if (k == 3) li = uLamp[3] * instLamp.z;
  #endif
  vLampI = li;
}
#endif
`;

const VERT_COLLAPSE = /* glsl */`
#ifdef CAR_INST_LAMP
  // Taxi-only parts (roof sign, lettering) fold to a point on private cars.
  if (aux.y >= 1.5 && instLamp.x < 0.5) transformed = vec3(0.0);
#endif
`;

const FRAG_PARS = /* glsl */`
varying vec2 vPbr;
varying vec2 vAux;
#ifdef CAR_TONE
varying float vCarMetal;
#endif
#ifdef CAR_LAMP
varying float vLampI;
#endif
`;

function patch(mat: THREE.MeshStandardMaterial, key: string, o: PatchOpts): void {
  mat.defines = { ...(mat.defines ?? {}) };
  if (o.tone) mat.defines.CAR_TONE = '';
  if (o.lamp) mat.defines.CAR_LAMP = '';
  if (o.instLamp) mat.defines.CAR_INST_LAMP = '';
  const lamp = o.lamp;
  mat.onBeforeCompile = (shader) => {
    if (lamp) shader.uniforms.uLamp = { value: lamp };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_MAIN)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_COLLAPSE);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef CAR_TONE
metalnessFactor = vCarMetal >= 0.0 ? vCarMetal : vPbr.y;
#else
metalnessFactor = vPbr.y;
#endif`);
    if (o.map) {
      fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
float carMask = sampledDiffuseColor.a;
if (mod(vAux.y, 2.0) > 0.5 && carMask < 0.5) discard;
diffuseColor.a = opacity;`);
      if (lamp) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += sampledDiffuseColor.rgb * carMask * vLampI;');
    }
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
}

export interface CarMaterials {
  paintU: THREE.MeshPhysicalMaterial;
  paintL: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  /** Same shader as `lamp`, its own material so taxi-only parts can be told apart. */
  taxi: THREE.MeshStandardMaterial;
  wheel: THREE.MeshStandardMaterial;
  lampLevels: LampArray;
}

function paintMat(color: THREE.ColorRepresentation, key: string, tone: boolean): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035 });
  // Full-model paints keep the material's own roughness/metalness (setPaint changes the metalness).
  if (tone) patch(m, key, { tone });
  m.userData.wet = 'surface';
  return m;
}

/** Materials for one full-detail car (the player's, parked yard cars, pose lineups). */
export function fullMaterials(livery: Livery): CarMaterials {
  const atlas = liveryAtlas(livery);
  const paintU = paintMat(livery.upper, 'car-paint', false), paintL = paintMat(livery.lower, 'car-paint', false);
  paintU.metalness = paintMetal(paintU.color); paintL.metalness = paintMetal(paintL.color);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.03, metalness: 0, clearcoat: 0, envMapIntensity: 1.25 });
  patch(glass, 'car-glass', {});
  glass.userData.wet = 'surface';
  const lampLevels = lampArray();
  const c = common(atlas, lampLevels, false);
  const taxi = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 1, metalness: 1, emissive: '#000000' });
  patch(taxi, 'car-lamp', { map: true, lamp: lampLevels });
  taxi.userData.wet = 'surface';
  return { paintU, paintL, glass, lampLevels, taxi, ...c };
}

/** Materials for an instanced kit: one paint material with per-instance tones. */
export function kitMaterials(livery: Livery): { paint: THREE.MeshPhysicalMaterial; trim: THREE.MeshStandardMaterial; lamp: THREE.MeshStandardMaterial; wheel: THREE.MeshStandardMaterial; lampLevels: LampArray } {
  const atlas = liveryAtlas(livery);
  const paint = paintMat('#ffffff', 'car-paint-inst', true);
  const lampLevels = lampArray();
  return { paint, lampLevels, ...common(atlas, lampLevels, true) };
}

function common(atlas: THREE.Texture, lampLevels: LampArray, inst: boolean) {
  const trim = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 1, metalness: 1 });
  patch(trim, 'car-trim', { map: true });
  trim.userData.wet = 'surface';
  const lamp = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 1, metalness: 1, emissive: '#000000' });
  patch(lamp, inst ? 'car-lamp-inst' : 'car-lamp', { map: true, lamp: lampLevels, instLamp: inst });
  lamp.userData.wet = 'surface';
  const wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  patch(wheel, 'car-wheel', {});
  wheel.userData.wet = true;
  return { trim, lamp, wheel };
}

// ---- the livery atlas ------------------------------------------------------------------------------

const atlases = new Map<string, THREE.DataTexture>();

/** The atlas for a livery (cached: every kit and model wearing the same livery shares one texture). */
export function liveryAtlas(l: Livery): THREE.DataTexture {
  const key = JSON.stringify([l.roofSign, l.plate, l.doorText, l.doorColor, l.beacons]);
  let t = atlases.get(key);
  if (t) return t;
  const col = document.createElement('canvas'), msk = document.createElement('canvas');
  col.width = msk.width = ATLAS_W; col.height = msk.height = ATLAS_H;
  const g = col.getContext('2d')!, m = msk.getContext('2d')!;
  // Colour: opaque grey by default; mask: 0 (no emission, full coverage handled per region below).
  g.fillStyle = '#808080'; g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  m.fillStyle = '#000'; m.fillRect(0, 0, ATLAS_W, ATLAS_H);
  // Coverage: regions that are not cut-outs must read alpha 1 where the mask is not emission. The
  // alpha channel is the mask for lamps and the coverage for lettering; everything else is 1.
  const opaque: PxRect[] = [];
  drawWhite(g, PX.white); opaque.push(PX.white);
  drawHead(g, m, PX.head);
  drawHead2(g, m, PX.head2);
  drawTail(g, m, PX.tail);
  drawTail2(g, m, PX.tail2);
  drawGrille(g, PX.grille); opaque.push(PX.grille);
  drawGrilleBars(g, PX.grilleBars); opaque.push(PX.grilleBars);
  drawGrilleSlim(g, PX.grilleSlim); opaque.push(PX.grilleSlim);
  drawGrilleWave(g, PX.grilleWave); opaque.push(PX.grilleWave);
  drawMesh(g, PX.intake, 9); opaque.push(PX.intake);
  drawMesh(g, PX.mesh, 7); opaque.push(PX.mesh);
  drawLens(g, m, PX.amber, '#d98a1a', '#ffb347');
  drawLens(g, m, PX.reverse, '#c9cdd1', '#ffffff');
  drawPlate(g, PX.plateF, l.plate); drawPlate(g, PX.plateR, l.plate); opaque.push(PX.plateF, PX.plateR);
  drawSign(g, m, PX.sign, l.roofSign);
  drawText(g, m, PX.door, l.doorText ?? '', l.doorColor ?? '#ffffff', 700);
  drawDest(g, m, PX.dest);
  drawBeacon(g, m, PX.beacon);
  drawText(g, m, PX.side, l.doorText ?? '', l.doorColor ?? '#ffffff', 800);
  drawBadge(g, PX.badge); opaque.push(PX.badge);
  drawBusHead(g, m, PX.busHead);
  drawRearDoor(g, PX.rearDoor); opaque.push(PX.rearDoor);
  drawVent(g, PX.vent); opaque.push(PX.vent);
  drawMesh(g, PX.cabin, 5); opaque.push(PX.cabin);
  const cd = g.getImageData(0, 0, ATLAS_W, ATLAS_H).data, md = m.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
  const data = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const isOpaque = new Uint8Array(ATLAS_W * ATLAS_H);
  for (const r of opaque) for (let y = r.y; y < r.y + r.h; y++) isOpaque.fill(1, y * ATLAS_W + r.x, y * ATLAS_W + r.x + r.w);
  // Canvas rows run top-down; the texture's v runs bottom-up (flipY off for data textures).
  for (let y = 0; y < ATLAS_H; y++) {
    const src = y * ATLAS_W * 4, dst = (ATLAS_H - 1 - y) * ATLAS_W * 4;
    for (let x = 0; x < ATLAS_W; x++) {
      const i = src + x * 4, o = dst + x * 4;
      data[o] = cd[i]; data[o + 1] = cd[i + 1]; data[o + 2] = cd[i + 2];
      data[o + 3] = isOpaque[y * ATLAS_W + x] ? 255 : md[i];
    }
  }
  t = new THREE.DataTexture(data, ATLAS_W, ATLAS_H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  col.width = col.height = msk.width = msk.height = 0;
  atlases.set(key, t);
  return t;
}

type G = CanvasRenderingContext2D;

function clip(g: G, r: PxRect, fn: () => void): void {
  g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.translate(r.x, r.y); fn(); g.restore();
}

function drawWhite(g: G, r: PxRect): void { g.fillStyle = '#ffffff'; g.fillRect(r.x, r.y, r.w, r.h); }

function rrect(g: G, x: number, y: number, w: number, h: number, rad: number): void {
  g.beginPath();
  g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

/** Headlamp cluster: u = 0 is the outer end (wrapping onto the wing), v up. */
function drawHead(g: G, m: G, r: PxRect): void {
  clip(g, r, () => {
    const W = r.w, H = r.h;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#3a3f45'); bg.addColorStop(0.5, '#16191d'); bg.addColorStop(1, '#2a2e33');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // Chrome reflector bowls and projector lenses.
    for (const [cx, rad] of [[W * 0.5, H * 0.3], [W * 0.78, H * 0.26]] as const) {
      const gr = g.createRadialGradient(cx - rad * 0.3, H * 0.55 - rad * 0.3, rad * 0.1, cx, H * 0.55, rad);
      gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(0.45, '#9aa1a8'); gr.addColorStop(1, '#2b3035');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, H * 0.56, rad, 0, Math.PI * 2); g.fill();
      const lens = g.createRadialGradient(cx - rad * 0.15, H * 0.5, 1, cx, H * 0.56, rad * 0.45);
      lens.addColorStop(0, '#ffffff'); lens.addColorStop(0.3, '#b9d4ff'); lens.addColorStop(1, '#101418');
      g.fillStyle = lens; g.beginPath(); g.arc(cx, H * 0.56, rad * 0.45, 0, Math.PI * 2); g.fill();
    }
    // LED daytime-running strip: along the top, turning down at the outer end.
    g.fillStyle = '#f7fbff';
    rrect(g, W * 0.06, H * 0.12, W * 0.9, H * 0.1, H * 0.05); g.fill();
    rrect(g, W * 0.06, H * 0.12, W * 0.05, H * 0.62, H * 0.025); g.fill();
    // Amber indicator segment at the outer end, low down.
    g.fillStyle = '#e39a2a'; g.fillRect(W * 0.14, H * 0.72, W * 0.2, H * 0.12);
    // Chrome sill under the lamps.
    g.fillStyle = '#c9ced3'; g.fillRect(0, H * 0.92, W, H * 0.08);
  });
  clip(m, r, () => {
    const W = r.w, H = r.h;
    m.fillStyle = '#060606'; m.fillRect(0, 0, W, H);
    for (const [cx, rad] of [[W * 0.5, H * 0.3], [W * 0.78, H * 0.26]] as const) {
      m.fillStyle = '#6a6a6a'; m.beginPath(); m.arc(cx, H * 0.56, rad, 0, Math.PI * 2); m.fill();
      m.fillStyle = '#e6e6e6'; m.beginPath(); m.arc(cx, H * 0.56, rad * 0.45, 0, Math.PI * 2); m.fill();
    }
    m.fillStyle = '#ffffff';
    rrect(m, W * 0.06, H * 0.12, W * 0.9, H * 0.1, H * 0.05); m.fill();
    rrect(m, W * 0.06, H * 0.12, W * 0.05, H * 0.62, H * 0.025); m.fill();
  });
}

/** Tail cluster: u = 0 is the inner end, u = 1 wraps onto the side. */
function drawTail(g: G, m: G, r: PxRect): void {
  const guide = (c: G) => {
    const W = r.w, H = r.h;
    rrect(c, W * 0.05, H * 0.16, W * 0.9, H * 0.12, H * 0.06); c.fill();
    rrect(c, W * 0.83, H * 0.16, W * 0.12, H * 0.66, H * 0.06); c.fill();
    rrect(c, W * 0.45, H * 0.7, W * 0.5, H * 0.12, H * 0.06); c.fill();
  };
  clip(g, r, () => {
    const W = r.w, H = r.h;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#4a0707'); bg.addColorStop(0.5, '#7a0c0c'); bg.addColorStop(1, '#3a0505');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // Smoked inner area with LED dots.
    g.fillStyle = '#2a0404'; g.fillRect(W * 0.12, H * 0.36, W * 0.66, H * 0.28);
    g.fillStyle = '#ff5a4a';
    for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(W * (0.18 + i * 0.09), H * 0.5, H * 0.055, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#ff3b2a'; guide(g);
    // Clear lens sheen along the top.
    const sh = g.createLinearGradient(0, 0, 0, H * 0.2);
    sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H * 0.2);
  });
  clip(m, r, () => {
    const W = r.w, H = r.h;
    m.fillStyle = '#222'; m.fillRect(0, 0, W, H);
    m.fillStyle = '#b0b0b0';
    for (let i = 0; i < 7; i++) { m.beginPath(); m.arc(W * (0.18 + i * 0.09), H * 0.5, H * 0.055, 0, Math.PI * 2); m.fill(); }
    m.fillStyle = '#ffffff'; guide(m);
  });
}

/** A sharper LED headlamp: angular housing, an LED blade along the top and three square elements. */
function drawHead2(g: G, m: G, r: PxRect): void {
  clip(g, r, () => {
    const W = r.w, H = r.h;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2c3138'); bg.addColorStop(0.55, '#101418'); bg.addColorStop(1, '#232830');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0a0c0f';
    g.beginPath(); g.moveTo(0, H * 0.18); g.lineTo(W, H * 0.3); g.lineTo(W, H * 0.9); g.lineTo(0, H * 0.82); g.closePath(); g.fill();
    for (let i = 0; i < 3; i++) {
      const x = W * (0.34 + i * 0.2);
      const gr = g.createLinearGradient(x, H * 0.4, x, H * 0.78);
      gr.addColorStop(0, '#eef4ff'); gr.addColorStop(1, '#59718f');
      g.fillStyle = gr; rrect(g, x, H * 0.42, W * 0.14, H * 0.32, 6); g.fill();
    }
    g.fillStyle = '#f4f9ff';
    g.beginPath(); g.moveTo(W * 0.02, H * 0.2); g.lineTo(W * 0.98, H * 0.32); g.lineTo(W * 0.98, H * 0.42); g.lineTo(W * 0.02, H * 0.3); g.closePath(); g.fill();
    g.fillStyle = '#e39a2a'; g.fillRect(W * 0.06, H * 0.78, W * 0.22, H * 0.09);
  });
  clip(m, r, () => {
    const W = r.w, H = r.h;
    m.fillStyle = '#050505'; m.fillRect(0, 0, W, H);
    m.fillStyle = '#c8c8c8';
    for (let i = 0; i < 3; i++) { const x = W * (0.34 + i * 0.2); rrect(m, x, H * 0.42, W * 0.14, H * 0.32, 6); m.fill(); }
    m.fillStyle = '#ffffff';
    m.beginPath(); m.moveTo(W * 0.02, H * 0.2); m.lineTo(W * 0.98, H * 0.32); m.lineTo(W * 0.98, H * 0.42); m.lineTo(W * 0.02, H * 0.3); m.closePath(); m.fill();
  });
}

/** A full-width light-bar tail lamp: one bright band with segment gaps. */
function drawTail2(g: G, m: G, r: PxRect): void {
  const band = (c: G, colour: string) => {
    const W = r.w, H = r.h;
    c.fillStyle = colour;
    rrect(c, W * 0.03, H * 0.3, W * 0.94, H * 0.4, H * 0.16); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 1; i < 7; i++) c.fillRect(W * (0.03 + i * 0.135), H * 0.3, W * 0.012, H * 0.4);
  };
  clip(g, r, () => {
    const W = r.w, H = r.h;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a0505'); bg.addColorStop(0.5, '#6b0b0b'); bg.addColorStop(1, '#240404');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    band(g, '#ff3524');
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, 0, W, H * 0.12);
  });
  clip(m, r, () => { m.fillStyle = '#1c1c1c'; m.fillRect(0, 0, r.w, r.h); band(m, '#ffffff'); });
}

/** Horizontal chrome slats (SUV). */
function drawGrilleBars(g: G, r: PxRect): void {
  clip(g, r, () => {
    const W = r.w, H = r.h;
    g.fillStyle = '#08090a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      const y = H * (0.14 + i * 0.21);
      const gr = g.createLinearGradient(0, y, 0, y + H * 0.11);
      gr.addColorStop(0, '#f0f3f6'); gr.addColorStop(0.6, '#8b9299'); gr.addColorStop(1, '#c9ced3');
      g.fillStyle = gr; g.fillRect(0, y, W, H * 0.11);
    }
    const ch = g.createLinearGradient(0, 0, 0, H);
    ch.addColorStop(0, '#f2f4f6'); ch.addColorStop(1, '#9aa1a8');
    g.fillStyle = ch; g.fillRect(0, 0, W, 8); g.fillRect(0, H - 8, W, 8); g.fillRect(0, 0, 8, H);
    g.fillStyle = '#20252b'; g.beginPath(); g.ellipse(W, H * 0.5, 34, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d7dbdf'; g.beginPath(); g.ellipse(W, H * 0.5, 24, 13, 0, 0, Math.PI * 2); g.fill();
  });
}

/** A slim upper grille over a dark mesh (hatchback). */
function drawGrilleSlim(g: G, r: PxRect): void {
  clip(g, r, () => {
    const W = r.w, H = r.h;
    g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#23272c'; g.lineWidth = 2;
    for (let y = -W; y < H + W; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + W * 0.4); g.stroke(); }
    const ch = g.createLinearGradient(0, 0, 0, H * 0.24);
    ch.addColorStop(0, '#e9ecef'); ch.addColorStop(1, '#7d848b');
    g.fillStyle = ch; g.fillRect(0, 0, W, H * 0.22);
    g.fillStyle = '#16181b'; g.fillRect(0, H * 0.22, W, H * 0.06);
    g.fillStyle = '#c3c8cd'; g.beginPath(); g.ellipse(W, H * 0.42, 26, 16, 0, 0, Math.PI * 2); g.fill();
  });
}

/** Vertical chrome fins, waterfall style (MPV). */
function drawGrilleWave(g: G, r: PxRect): void {
  clip(g, r, () => {
    const W = r.w, H = r.h;
    g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, W, H);
    for (let x = 6; x < W; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 9, 0);
      gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(1, '#767d85');
      g.fillStyle = gr; g.fillRect(x, H * 0.12, 9, H * 0.76);
    }
    const ch = g.createLinearGradient(0, 0, 0, H);
    ch.addColorStop(0, '#f2f4f6'); ch.addColorStop(1, '#9aa1a8');
    g.fillStyle = ch; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10); g.fillRect(0, 0, 10, H);
  });
}

function drawLens(g: G, m: G, r: PxRect, base: string, hot: string): void {
  clip(g, r, () => {
    const gr = g.createRadialGradient(r.w * 0.5, r.h * 0.45, 2, r.w * 0.5, r.h * 0.5, r.w * 0.6);
    gr.addColorStop(0, hot); gr.addColorStop(1, base);
    g.fillStyle = gr; g.fillRect(0, 0, r.w, r.h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    for (let x = 8; x < r.w; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, r.h); g.stroke(); }
  });
  clip(m, r, () => {
    const gr = m.createRadialGradient(r.w * 0.5, r.h * 0.5, 2, r.w * 0.5, r.h * 0.5, r.w * 0.55);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#707070');
    m.fillStyle = gr; m.fillRect(0, 0, r.w, r.h);
  });
}

/** Front grille, right half: u = 0 at the outer edge, u = 1 at the centre line (mirrored). */
function drawGrille(g: G, r: PxRect): void {
  clip(g, r, () => {
    const W = r.w, H = r.h;
    g.fillStyle = '#0b0c0d'; g.fillRect(0, 0, W, H);
    // Hexagonal mesh.
    const s = 11;
    for (let row = -1; row < H / (s * 0.86) + 1; row++) for (let col = -1; col < W / (s * 1.5) + 1; col++) {
      const cx = col * s * 1.5, cy = row * s * 1.72 + (col % 2 ? s * 0.86 : 0);
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k; g.lineTo(cx + Math.cos(a) * s * 0.78, cy + Math.sin(a) * s * 0.78); }
      g.closePath();
      g.fillStyle = '#1d2024'; g.fill();
      g.strokeStyle = '#3c4046'; g.lineWidth = 1.5; g.stroke();
    }
    // Chrome surround on the outer edge, top and bottom (the centre edge continues into the mirror).
    const ch = g.createLinearGradient(0, 0, 0, H);
    ch.addColorStop(0, '#f2f4f6'); ch.addColorStop(0.5, '#8d949b'); ch.addColorStop(1, '#e3e6e9');
    g.fillStyle = ch;
    g.fillRect(0, 0, W, 9); g.fillRect(0, H - 9, W, 9); g.fillRect(0, 0, 9, H);
    // Half badge at the centre line.
    const bg = g.createLinearGradient(0, H * 0.3, 0, H * 0.7);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#7c838a');
    g.fillStyle = bg; g.beginPath(); g.ellipse(W, H * 0.5, 40, 24, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#20252b'; g.beginPath(); g.ellipse(W, H * 0.5, 31, 16, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d7dbdf'; g.beginPath(); g.ellipse(W, H * 0.5, 22, 10, 0, 0, Math.PI * 2); g.fill();
  });
}

function drawMesh(g: G, r: PxRect, s: number): void {
  clip(g, r, () => {
    g.fillStyle = '#08090a'; g.fillRect(0, 0, r.w, r.h);
    g.strokeStyle = '#2a2d31'; g.lineWidth = 1.2;
    for (let y = -r.w; y < r.h + r.w; y += s) { g.beginPath(); g.moveTo(0, y); g.lineTo(r.w, y + r.w * 0.5); g.stroke(); g.beginPath(); g.moveTo(0, y + r.w * 0.5); g.lineTo(r.w, y); g.stroke(); }
    g.strokeStyle = '#2f3237'; g.lineWidth = 4; g.strokeRect(2, 2, r.w - 4, r.h - 4);
  });
}

function drawVent(g: G, r: PxRect): void {
  clip(g, r, () => {
    g.fillStyle = '#15171a'; g.fillRect(0, 0, r.w, r.h);
    for (let y = 4; y < r.h; y += 8) { g.fillStyle = '#3a3e44'; g.fillRect(4, y, r.w - 8, 3); g.fillStyle = '#050505'; g.fillRect(4, y + 3, r.w - 8, 3); }
  });
}

function drawRearDoor(g: G, r: PxRect): void {
  clip(g, r, () => {
    g.fillStyle = '#e9ebec'; g.fillRect(0, 0, r.w, r.h);
    for (let x = 6; x < r.w; x += 12) { g.fillStyle = '#c9cdd1'; g.fillRect(x, 0, 3, r.h); }
    g.fillStyle = '#2a2c2f'; g.fillRect(r.w / 2 - 1.5, 0, 3, r.h);
    for (const x of [0.2, 0.4, 0.6, 0.8]) { g.fillStyle = '#9ea4aa'; g.fillRect(r.w * x - 2, 0, 4, r.h); g.fillStyle = '#5a5f65'; g.fillRect(r.w * x - 6, r.h * 0.45, 12, 6); }
  });
}

function drawBadge(g: G, r: PxRect): void {
  clip(g, r, () => {
    const gr = g.createLinearGradient(0, 0, 0, r.h);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#7c838a');
    g.fillStyle = '#111'; g.fillRect(0, 0, r.w, r.h);
    g.fillStyle = gr; g.beginPath(); g.ellipse(r.w / 2, r.h / 2, r.w * 0.45, r.h * 0.3, 0, 0, Math.PI * 2); g.fill();
  });
}

function drawPlate(g: G, r: PxRect, p: Livery['plate']): void {
  clip(g, r, () => {
    g.fillStyle = p.bg; g.fillRect(0, 0, r.w, r.h);
    g.strokeStyle = p.fg; g.lineWidth = 4; g.strokeRect(5, 5, r.w - 10, r.h - 10);
    g.fillStyle = p.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit(g, p.text, r.w - 24, 52, 700);
    g.fillText(p.text, r.w / 2, r.h / 2 + 3);
  });
}

function fit(g: G, text: string, maxW: number, size: number, weight: number): void {
  let s = size;
  do { g.font = `${weight} ${s}px ${CJK}`; s -= 2; } while (s > 8 && g.measureText(text).width > maxW);
}

function drawSign(g: G, m: G, r: PxRect, rs: Livery['roofSign']): void {
  const face = (c: G, ox: number, mask: boolean) => {
    const W = r.w / 2, H = r.h;
    c.save(); c.translate(ox, 0);
    c.fillStyle = mask ? '#8a8a8a' : rs?.bg ?? '#ffffff'; c.fillRect(0, 0, W, H);
    if (rs) {
      c.fillStyle = mask ? '#ffffff' : rs.fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      fit(c, rs.text, W * 0.56, 82, 800); c.fillText(rs.text, W * 0.34, H * 0.54);
      fit(c, rs.sub, W * 0.34, 44, 800); c.fillText(rs.sub, W * 0.79, H * 0.56);
    }
    if (!mask) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6); }
    c.restore();
  };
  clip(g, r, () => { face(g, 0, false); face(g, r.w / 2, false); });
  clip(m, r, () => { face(m, 0, true); face(m, r.w / 2, true); });
}

function drawText(g: G, m: G, r: PxRect, text: string, color: string, weight: number): void {
  if (!text) return;
  for (const [c, fill] of [[g, color], [m, '#ffffff']] as const) clip(c, r, () => {
    c.clearRect(0, 0, r.w, r.h);
    if (c === g) { c.fillStyle = color; c.globalAlpha = 1; c.fillRect(0, 0, r.w, r.h); }
    else { c.fillStyle = '#000'; c.fillRect(0, 0, r.w, r.h); }
    c.fillStyle = fill; c.textAlign = 'center'; c.textBaseline = 'middle';
    fit(c, text, r.w - 16, r.h * 0.8, weight);
    if (c === m) c.fillText(text, r.w / 2, r.h * 0.54);
  });
}

function drawDest(g: G, m: G, r: PxRect): void {
  const text = (c: G, color: string) => {
    c.fillStyle = color; c.textBaseline = 'middle';
    c.textAlign = 'left'; c.font = `800 ${r.h * 0.78}px ${CJK}`; c.fillText('1', r.w * 0.04, r.h * 0.54);
    c.textAlign = 'center'; fit(c, '四惠枢纽站', r.w * 0.72, r.h * 0.58, 700); c.fillText('四惠枢纽站', r.w * 0.6, r.h * 0.54);
  };
  clip(g, r, () => {
    g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, r.w, r.h);
    text(g, '#ffb020');
    // Dot-matrix: black out the gaps between LEDs.
    g.fillStyle = 'rgba(8,8,8,0.72)';
    for (let y = 0; y < r.h; y += 4) g.fillRect(0, y + 3, r.w, 1);
    for (let x = 0; x < r.w; x += 4) g.fillRect(x + 3, 0, 1, r.h);
  });
  clip(m, r, () => { m.fillStyle = '#000'; m.fillRect(0, 0, r.w, r.h); text(m, '#ffffff'); });
}

function drawBeacon(g: G, m: G, r: PxRect): void {
  for (const [c, mask] of [[g, false], [m, true]] as const) clip(c, r, () => {
    for (const [ox, base, hot] of [[0, '#6e0c0c', '#ff3030'], [r.w / 2, '#0c1f6e', '#3a6bff']] as const) {
      const gr = c.createLinearGradient(0, 0, 0, r.h);
      gr.addColorStop(0, mask ? '#ffffff' : hot); gr.addColorStop(1, mask ? '#bdbdbd' : base);
      c.fillStyle = gr; c.fillRect(ox, 0, r.w / 2, r.h);
      c.fillStyle = mask ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.3)';
      for (let x = ox + 4; x < ox + r.w / 2; x += 9) c.fillRect(x, 0, 2, r.h);
    }
  });
}

function drawBusHead(g: G, m: G, r: PxRect): void {
  clip(g, r, () => {
    g.fillStyle = '#1b1e22'; g.fillRect(0, 0, r.w, r.h);
    for (const cx of [0.22, 0.5, 0.78]) {
      const gr = g.createRadialGradient(r.w * cx, r.h * 0.5, 2, r.w * cx, r.h * 0.5, r.h * 0.34);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#aab2ba'); gr.addColorStop(1, '#30353a');
      g.fillStyle = gr; g.beginPath(); g.arc(r.w * cx, r.h * 0.5, r.h * 0.34, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#e39a2a'; g.fillRect(r.w * 0.9, r.h * 0.2, r.w * 0.08, r.h * 0.6);
  });
  clip(m, r, () => {
    m.fillStyle = '#000'; m.fillRect(0, 0, r.w, r.h);
    for (const cx of [0.22, 0.5, 0.78]) { m.fillStyle = '#ffffff'; m.beginPath(); m.arc(r.w * cx, r.h * 0.5, r.h * 0.3, 0, Math.PI * 2); m.fill(); }
  });
}
