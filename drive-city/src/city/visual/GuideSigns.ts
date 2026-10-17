import * as THREE from 'three';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { EnvUniforms, PlayerApi, VehicleApi } from '../../game/Contracts';
import type { Closure, GuideSign, SignLine } from '../Signs';
import { CJK } from '../landmarks/kit/tex';
import { lang, onLangChange } from '../../core/I18n';

/**
 * The guide signs (`city/Signs.ts`, placed at build time into signs.json) drawn and made solid.
 *
 * Structures are instanced - poles, arms, plates, the closures' barriers - and only those within
 * DRAW of the camera are packed (one draw call each, whatever the count). The faces are text, a
 * thousand different ones, so they are drawn on demand into slots of one atlas (a DataTexture:
 * a new face is a row-by-row sub-upload of its slot, not a re-upload of the whole atlas): the
 * nearest signs that face the camera get a slot, the rest show their plain colour, which is all a
 * sign shows past a couple of hundred metres anyway.
 */

const ATLAS_W = 2048, ATLAS_H = 1536, SLOT_W = 512, SLOT_H = 256, COLS = ATLAS_W / SLOT_W, ROWS = ATLAS_H / SLOT_H;
/** Slot 0 holds the swatches and the closure board; the rest are faces. */
const FACES = COLS * ROWS - 1;
const DRAW = 320, REPACK = 25, FACE_RANGE = 280, NEW_PER_TICK = 2;
const BG = { blue: '#1c4e9e', green: '#0b6b3b' } as const;
/** Swatch cells in slot 0 (64 px squares): the plate colours seen from afar and the grey back. */
const SWATCH = { blue: 0, green: 1, back: 2 } as const;
const CLOSURE_BOARD = { x: 256, y: 0, w: 256, h: 154, mw: 2.0, mh: 1.2 };
const LATIN = '600 {px}px system-ui, "Helvetica Neue", Arial, sans-serif';
/** Texture LOD bias on the faces (`?signbias=` to try others). */
const MIP_BIAS = Number(new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('signbias') ?? -0.7);

interface SignsFile { signs: GuideSign[]; closures: Closure[] }

/** Atlas pixel rect -> [u0, vBottom, u1, vTop], inset half a texel and a bit so mip levels do not bleed. */
function rectUv(x: number, y: number, w: number, h: number): [number, number, number, number] {
  const i = 1.5;
  return [(x + i) / ATLAS_W, 1 - (y + h - i) / ATLAS_H, (x + w - i) / ATLAS_W, 1 - (y + i) / ATLAS_H];
}
const swatchUv = (k: number) => rectUv(k * 64 + 16, 16, 32, 32);

// ------------------------------------------------------------------------------------------ faces
function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/** Text fitted into `maxW` (shrunk, never grown past `px`). */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, font: 'cjk' | 'latin', align: CanvasTextAlign = 'center') {
  let size = px;
  const set = () => { g.font = font === 'cjk' ? `700 ${size}px ${CJK}` : LATIN.replace('{px}', String(size)); };
  set();
  const w = g.measureText(text).width;
  if (w > maxW) { size = Math.max(8, Math.floor(size * maxW / w)); set(); }
  g.textAlign = align;
  g.fillText(text, x, y);
}
/** Generic endings a long name breaks before (王府井|大街, 工人体育场|北路). */
const SUFFIX = /(东|西|南|北|中)?(大街|大道|胡同|快速路|高速|北路|南路|东路|西路|中路|路|街|桥|巷|里)$/;
/**
 * A road name in big characters, centred on (x, y), within maxW: on one line if it fits at `px`, else (four
 * characters or more) on two at up to 0.8 px, broken before its generic ending or in the middle. Returns the
 * height it took, so an English line can go under it.
 */
function bigName(g: CanvasRenderingContext2D, name: string, x: number, y: number, maxW: number, px: number, align: CanvasTextAlign = 'center'): number {
  g.font = `700 ${px}px ${CJK}`;
  const chars = [...name];
  if (g.measureText(name).width <= maxW || chars.length < 4) { fitText(g, name, x, y, maxW, px, 'cjk', align); return px; }
  const m = name.match(SUFFIX);
  let cut = m && m.index! >= 2 && chars.length - [...m[0]].length >= 2 ? [...name.slice(0, m.index)].length : Math.ceil(chars.length / 2);
  if (cut >= chars.length - 1 || cut < 2) cut = Math.ceil(chars.length / 2);
  const a = chars.slice(0, cut).join(''), b = chars.slice(cut).join('');
  // Both lines at one size: the longer one decides it.
  const p2 = Math.round(px * 0.8);
  g.font = `700 ${p2}px ${CJK}`;
  const size = Math.max(8, Math.min(p2, Math.floor(p2 * maxW / Math.max(g.measureText(a).width, g.measureText(b).width))));
  const gap = size * 1.08;
  fitText(g, a, x, y - gap / 2, maxW, size, 'cjk', align);
  fitText(g, b, x, y + gap / 2, maxW, size, 'cjk', align);
  return gap + size;
}
/**
 * A sign line: the name big; its English under it only when the game is in English (in Chinese the pinyin line
 * took a third of the height and every character was half the size it could be: 「远点看不清晰」, 2026-10-17).
 */
function name2(g: CanvasRenderingContext2D, l: SignLine, x: number, y: number, maxW: number, px: number, align: CanvasTextAlign = 'center') {
  if (lang() === 'en' && l.en) {
    const h = bigName(g, l.name, x, y - px * 0.3, maxW, Math.round(px * 0.8), align);
    fitText(g, l.en, x, y - px * 0.3 + h / 2 + px * 0.34, maxW, Math.round(px * 0.46), 'latin', align);
  } else bigName(g, l.name, x, y, maxW, px, align);
}
/** A white arrow shaft from (x0, y0) to (x1, y1) with its head at the end. */
function arrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, t: number, head: number) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const bx = x1 - ux * head, by = y1 - uy * head;
  g.beginPath();
  g.moveTo(x0 + nx * t / 2, y0 + ny * t / 2); g.lineTo(bx + nx * t / 2, by + ny * t / 2); g.lineTo(bx + nx * head * 0.62, by + ny * head * 0.62);
  g.lineTo(x1, y1);
  g.lineTo(bx - nx * head * 0.62, by - ny * head * 0.62); g.lineTo(bx - nx * t / 2, by - ny * t / 2); g.lineTo(x0 - nx * t / 2, y0 - ny * t / 2);
  g.closePath(); g.fill();
}

/**
 * Draw a sign's face into (0, 0, W, H) of `g` (a SLOT_W x SLOT_H canvas, or the HUD card's at any scale).
 * The names take most of the plate: at 35 m a plate is ~70 px wide on a phone, so every pixel of character
 * height counts; the arrows are only as big as they need to be to read.
 */
export function drawFace(g: CanvasRenderingContext2D, s: GuideSign, W: number, H: number) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.fillStyle = '#f2f4f6'; round(g, 0, 0, W, H, 14); g.fill();
  g.fillStyle = BG[s.colour]; round(g, 5, 5, W - 10, H - 10, 10); g.fill();
  g.fillStyle = '#f2f4f6'; g.strokeStyle = '#f2f4f6'; g.textBaseline = 'middle';
  if (s.kind === 'cross') {
    // The straight-on road across the top; the junction low in the middle with short arms, its side roads either side.
    const arm = (d: string) => s.lines.find((l) => l.dir === d);
    const L = arm('L'), S = arm('S'), R = arm('R');
    const cx = W / 2, cy = H * 0.7, t = 15, head = 22, reach = 52;
    g.fillRect(cx - t / 2, cy - t / 2, t, H - 14 - cy + t / 2);
    if (S) arrow(g, cx, cy, cx, H * 0.4, t, head); else g.fillRect(cx - t / 2, cy - t / 2, t, t);
    if (L) arrow(g, cx, cy, cx - reach, cy, t, head);
    if (R) arrow(g, cx, cy, cx + reach, cy, t, head);
    if (S) {
      name2(g, S, cx, H * 0.19, W - 36, 50);
      const side = cx - reach - 22;   // each side road's column
      if (L) name2(g, L, 12 + side / 2, cy - 4, side - 6, 46);
      if (R) name2(g, R, W - 12 - side / 2, cy - 4, side - 6, 46);
    } else if (L && R) {
      // A T from its stem: the top is free, each side road over its own half.
      name2(g, L, W / 4 + 6, H * 0.3, W / 2 - 24, 50);
      name2(g, R, W * 3 / 4 - 6, H * 0.3, W / 2 - 24, 50);
    } else if (L || R) name2(g, (L ?? R)!, cx, H * 0.3, W - 36, 52);
  } else if (s.kind === 'exit') {
    // 出口 tag, the interchange big, and the road the slip road leads to with its arrow.
    const en = lang() === 'en';
    g.fillStyle = '#f2f4f6'; round(g, 16, 16, en ? 122 : 84, 48, 6); g.fill();
    g.fillStyle = BG[s.colour];
    if (en) { fitText(g, '出口', 50, 41, 60, 28, 'cjk'); fitText(g, 'EXIT', 106, 41, 50, 18, 'latin'); } else fitText(g, '出口', 58, 41, 66, 34, 'cjk');
    g.fillStyle = '#f2f4f6';
    const [first, second] = s.lines;
    const dir = (second ?? first).dir;
    name2(g, first, W / 2 + 50, H * 0.3, W - 190, 58);
    // The arrow slants the way the slip road leaves; the road it leads to beside it.
    const ax = dir === 'L' ? 46 : W - 46, ay = H * 0.74;
    arrow(g, ax + (dir === 'L' ? 22 : -22), ay + 26, ax + (dir === 'L' ? -14 : 14), ay - 28, 16, 24);
    if (second) name2(g, second, W / 2, H * 0.73, W - 150, 46);
  } else {
    // ahead: up arrow, the road in a white box and its direction; the next interchanges with distances.
    const [road, ...next] = s.lines;
    const colW = W * 0.3, en = lang() === 'en';
    arrow(g, colW / 2, H - 18, colW / 2, H * 0.6, 20, 30);
    g.fillStyle = '#f2f4f6'; round(g, 14, 16, colW - 18, 78, 8); g.fill();
    g.fillStyle = BG[s.colour];
    if (en && road.en) { fitText(g, road.name, 14 + (colW - 18) / 2, 44, colW - 30, 34, 'cjk'); fitText(g, road.en, 14 + (colW - 18) / 2, 76, colW - 30, 15, 'latin'); }
    else fitText(g, road.name, 14 + (colW - 18) / 2, 56, colW - 28, 44, 'cjk');
    g.fillStyle = '#f2f4f6';
    if (s.heading) fitText(g, s.heading, colW / 2, H * 0.48, 60, 36, 'cjk');
    g.fillRect(colW, 18, 2, H - 36);
    const rowH = (H - 24) / Math.max(3, next.length);
    next.forEach((l, i) => {
      const y = 12 + rowH * (i + 0.5);
      if (en && l.en) { fitText(g, l.name, colW + 16, y - 9, W - colW - 120, 34, 'cjk', 'left'); fitText(g, l.en, colW + 16, y + 20, W - colW - 120, 15, 'latin', 'left'); }
      else fitText(g, l.name, colW + 16, y, W - colW - 120, 46, 'cjk', 'left');
      if (l.km !== undefined) fitText(g, `${l.km < 1 ? Math.round(l.km * 1000) + ' m' : l.km.toFixed(1) + ' km'}`, W - 16, y, 100, 34, 'latin', 'right');
    });
  }
}

/** A plate's face in atlas pixels: the slot, fitted to the plate's shape. */
export function faceSize(s: GuideSign): [number, number] {
  const a = s.w / s.h;
  return a >= SLOT_W / SLOT_H ? [SLOT_W, Math.round(SLOT_W / a)] : [Math.round(SLOT_H * a), SLOT_H];
}

/** Slot 0: the swatches and the closure board (前方道路封闭, red border on white). */
function drawStatic(g: CanvasRenderingContext2D) {
  g.clearRect(0, 0, SLOT_W, SLOT_H);
  const sw: [number, string][] = [[SWATCH.blue, BG.blue], [SWATCH.green, BG.green], [SWATCH.back, '#8b9197']];
  for (const [k, c] of sw) { g.fillStyle = c; g.fillRect(k * 64, 0, 64, 64); }
  const { x, y, w, h } = CLOSURE_BOARD;
  g.fillStyle = '#f4f4f2'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#d42a24'; g.lineWidth = 12; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
  g.fillStyle = '#d42a24'; g.textBaseline = 'middle';
  fitText(g, '前方道路封闭', x + w / 2, y + h * 0.42, w - 40, 34, 'cjk');
  g.fillStyle = '#222';
  fitText(g, 'ROAD CLOSED', x + w / 2, y + h * 0.7, w - 60, 20, 'latin');
}

// ------------------------------------------------------------------------------------------ geometry
function plateGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 0.08);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry's faces are +x, -x, +y, -y, +z, -z, four vertices each: only +z (16..19) is the face.
  for (let i = 0; i < uv.count; i++) if (i < 16 || i >= 20) uv.setXY(i, -1, -1);
  return geo;
}

export interface GuideSignApi extends System {
  readonly signs: readonly GuideSign[];
  readonly closures: readonly Closure[];
  /** Signs with their face drawn right now (for probes). */
  readonly live: () => number;
  /**
   * The sign the player is driving up to and has not passed yet (the HUD's card shows it, `ui/SignCard.ts`):
   * within AHEAD m ahead on the same level, facing the car, roughly over its road. Null on foot.
   */
  readonly ahead: GuideSign | null;
}

/** How far ahead a sign is shown on the HUD card, and how far to the side of the car's line it may stand. */
const AHEAD = 170, AHEAD_SIDE = 26;

export function placeGuideSigns(engine: Engine, data: SignsFile, env: EnvUniforms): GuideSignApi {
  const { signs, closures } = data;
  // --- atlas
  const pixels = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const atlas = new THREE.DataTexture(pixels, ATLAS_W, ATLAS_H, THREE.RGBAFormat);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.anisotropy = 8;
  const cv = document.createElement('canvas');
  cv.width = SLOT_W; cv.height = SLOT_H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  let uploaded = false;
  /** Copy the canvas into slot k (canvas rows top-down into the texture's bottom-up rows). */
  const blit = (k: number) => {
    const sx = (k % COLS) * SLOT_W, sy = Math.floor(k / COLS) * SLOT_H;
    const img = g.getImageData(0, 0, SLOT_W, SLOT_H).data;
    for (let y = 0; y < SLOT_H; y++) {
      const row = ATLAS_H - 1 - (sy + y), start = (row * ATLAS_W + sx) * 4;
      pixels.set(img.subarray(y * SLOT_W * 4, (y + 1) * SLOT_W * 4), start);
      if (uploaded) atlas.addUpdateRange(start, SLOT_W * 4);
    }
    atlas.needsUpdate = true;
  };
  drawStatic(g); blit(0);
  // Every face slot starts blue, so a slot in the middle of being filled never shows black.
  g.fillStyle = BG.blue; g.fillRect(0, 0, SLOT_W, SLOT_H);
  for (let k = 1; k <= FACES; k++) blit(k);
  uploaded = true;


  // --- materials
  const metal = new THREE.MeshStandardMaterial({ color: '#a3aab0', metalness: 0.55, roughness: 0.42 });
  metal.userData.wet = 'surface';
  // A touch under white: a plate square-on in the headlights at night otherwise saturates, text and ground alike.
  const plateMat = new THREE.MeshStandardMaterial({ map: atlas, color: '#d6d6d6', roughness: 0.6, metalness: 0.05 });
  plateMat.userData.wet = 'surface';
  const glow = { value: 0 };
  const back = swatchUv(SWATCH.back);
  plateMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSignGlow = glow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFace;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = uv.x < -0.5 ? vec2(${((back[0] + back[2]) / 2).toFixed(5)}, ${((back[1] + back[3]) / 2).toFixed(5)}) : mix(aFace.xy, aFace.zw, uv);\n#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSignGlow;')
      // A sharper mip than the screen size asks for: a plate is small on screen and its text is all edges, so the
      // default level smudged the characters a hundred metres before they were too small to read.
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor *= texture2D(map, vMapUv, SIGN_MIP_BIAS);\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSignGlow;');
  };
  plateMat.defines = { SIGN_MIP_BIAS: MIP_BIAS.toFixed(2) };
  plateMat.customProgramCacheKey = () => 'guide-sign-plate';
  const barrierMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  barrierMat.userData.wet = 'surface';

  // --- instanced meshes (capacity for the densest DRAW square)
  const CAP = 400;
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.16, 1, 10).translate(0, 0.5, 0);
  const armGeo = new THREE.BoxGeometry(1, 0.15, 0.15).translate(-0.5, 0, 0);
  const plateGeo = plateGeometry();
  const aFace = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  aFace.setUsage(THREE.DynamicDrawUsage);
  plateGeo.setAttribute('aFace', aFace);
  const barrierGeo = new THREE.BoxGeometry(1.8, 0.85, 0.5).translate(0, 0.425, 0);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    engine.scene.add(m);
    return m;
  };
  const poles = mk(poleGeo, metal, CAP * 2, 'guide-sign-poles');
  const arms = mk(armGeo, metal, CAP * 2, 'guide-sign-arms');
  // The arms' shadows are two thin lines on the road: not worth a draw call per cascade.
  arms.castShadow = false;
  const plates = mk(plateGeo, plateMat, CAP, 'guide-sign-plates');
  const barriers = mk(barrierGeo, barrierMat, CAP * 2, 'road-closed-barriers');
  barriers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2 * 3), 3);

  // --- static matrices per sign
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const place = (x: number, y: number, z: number, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // local +X -> (cos, -sin), local +Z -> (sin, cos)
    p.set(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
    q.setFromAxisAngle(up, yaw); sc.set(sx, sy, sz);
    return m.compose(p, q, sc).toArray();
  };
  const sPole = signs.map((s) => place(s.x, s.y, s.z, s.yaw, 0, 0, 0, 1, s.clear + s.h + 0.25, 1));
  const armLen = (s: GuideSign) => s.reach + s.w / 2 - 0.15;
  const sArm1 = signs.map((s) => place(s.x, s.y, s.z, s.yaw, 0, s.clear + s.h * 0.28, 0, armLen(s), 1, 1));
  const sArm2 = signs.map((s) => place(s.x, s.y, s.z, s.yaw, 0, s.clear + s.h * 0.78, 0, armLen(s), 1, 1));
  const sPlate = signs.map((s) => place(s.x, s.y, s.z, s.yaw, -s.reach, s.clear + s.h / 2, 0.13, s.w, s.h, 1));
  const B = CLOSURE_BOARD;
  const cBoard = closures.map((c) => place(c.x, c.y, c.z, c.yaw, 0, 1.55, 0.3, B.mw, B.mh, 1));
  const cPosts = closures.map((c) => [place(c.x, c.y, c.z, c.yaw, -0.7, 0, 0.22, 0.4, 2.15, 0.4), place(c.x, c.y, c.z, c.yaw, 0.7, 0, 0.22, 0.4, 2.15, 0.4)]);
  const cBarriers = closures.map((c) => {
    const n = Math.max(2, Math.ceil(c.width / 1.85)), out: number[][] = [];
    for (let i = 0; i < n; i++) out.push(place(c.x, c.y, c.z, c.yaw, (i - (n - 1) / 2) * 1.85, 0, 0, 1, 1, 1));
    return out;
  });
  const boardUv = rectUv(B.x, B.y, B.w, B.h);

  // --- colliders: a pole each, and a wall of barriers across each closed road
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const cg = groups(CG.WORLD, CG.ALL);
  for (const s of signs) {
    const c = world.createCollider(R.ColliderDesc.cylinder((s.clear + s.h) / 2, 0.17).setTranslation(s.x, s.y + (s.clear + s.h) / 2, s.z).setCollisionGroups(cg), body);
    engine.physics.tag(c, { surface: 'metal', tag: 'sign' });
  }
  for (const c of closures) {
    const col = world.createCollider(R.ColliderDesc.cuboid(c.width / 2 + 0.5, 0.45, 0.28).setTranslation(c.x, c.y + 0.45, c.z)
      .setRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }).setCollisionGroups(cg), body);
    engine.physics.tag(col, { surface: 'plastic', tag: 'barrier' });
  }

  // --- face slots
  const slotOf = new Map<number, number>();   // sign -> slot (1..FACES)
  const owner = new Int32Array(FACES + 1).fill(-1);
  const free: number[] = [];
  for (let k = FACES; k >= 1; k--) free.push(k);
  let drawn: number[] = [], drawnClosures: number[] = [];

  const writeFaces = () => {
    const a = aFace.array as Float32Array;
    let k = 0;
    for (const i of drawn) {
      const s = signs[i], slot = slotOf.get(i);
      let uv: [number, number, number, number];
      if (slot !== undefined) { const [fw, fh] = faceSize(s); uv = rectUv((slot % COLS) * SLOT_W, Math.floor(slot / COLS) * SLOT_H, fw, fh); }
      else uv = swatchUv(SWATCH[s.colour]);
      a.set(uv, k * 4); k++;
    }
    for (let j = 0; j < drawnClosures.length; j++) { a.set(boardUv, k * 4); k++; }
    aFace.needsUpdate = true;
  };

  let packX = Infinity, packZ = Infinity;
  const repack = (cx: number, cz: number) => {
    packX = cx; packZ = cz;
    drawn = []; drawnClosures = [];
    signs.forEach((s, i) => { if (Math.abs(s.x - cx) < DRAW && Math.abs(s.z - cz) < DRAW && drawn.length < CAP) drawn.push(i); });
    closures.forEach((c, i) => { if (Math.abs(c.x - cx) < DRAW && Math.abs(c.z - cz) < DRAW && drawn.length + drawnClosures.length < CAP) drawnClosures.push(i); });
    const pa = poles.instanceMatrix.array as Float32Array, aa = arms.instanceMatrix.array as Float32Array, la = plates.instanceMatrix.array as Float32Array;
    const ba = barriers.instanceMatrix.array as Float32Array, bc = barriers.instanceColor!.array as Float32Array;
    let np = 0, na = 0, nl = 0, nb = 0;
    for (const i of drawn) {
      pa.set(sPole[i], np++ * 16);
      aa.set(sArm1[i], na++ * 16); aa.set(sArm2[i], na++ * 16);
      la.set(sPlate[i], nl++ * 16);
    }
    for (const i of drawnClosures) {
      la.set(cBoard[i], nl++ * 16);
      for (const mm of cPosts[i]) if (np < CAP * 2) pa.set(mm, np++ * 16);
      cBarriers[i].forEach((mm, j) => {
        if (nb >= CAP * 2) return;
        ba.set(mm, nb * 16);
        const red = j % 2 === 0;
        bc.set(red ? [0.75, 0.08, 0.06] : [0.9, 0.9, 0.88], nb * 3);
        nb++;
      });
    }
    poles.count = np; arms.count = na; plates.count = nl; barriers.count = nb;
    for (const mesh of [poles, arms, plates, barriers]) mesh.visible = mesh.count > 0;
    for (const mesh of [poles, arms, plates, barriers]) mesh.instanceMatrix.needsUpdate = true;
    barriers.instanceColor!.needsUpdate = true;
    writeFaces();
  };

  let tick = 0;
  const cam = new THREE.Vector3();
  const assign = () => {
    engine.camera.getWorldPosition(cam);
    // The nearest signs whose face looks towards the camera.
    const want: [number, number][] = [];
    for (const i of drawn) {
      const s = signs[i];
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const px = s.x - s.reach * c, pz = s.z + s.reach * sn;
      const dx = cam.x - px, dz = cam.z - pz, d = Math.hypot(dx, dz);
      if (d > FACE_RANGE || (dx * sn + dz * c) < -2) continue;
      want.push([d, i]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const keep = new Set(want.slice(0, FACES).map((w) => w[1]));
    let changed = false;
    for (const [i, slot] of [...slotOf]) if (!keep.has(i)) { slotOf.delete(i); owner[slot] = -1; free.push(slot); changed = true; }
    let drawnNow = 0;
    for (const [, i] of want) {
      if (!keep.has(i) || slotOf.has(i)) continue;
      if (drawnNow >= NEW_PER_TICK || !free.length) break;
      const slot = free.pop()!;
      const s = signs[i], [fw, fh] = faceSize(s);
      drawFace(g, s, fw, fh);
      blit(slot);
      slotOf.set(i, slot); owner[slot] = i;
      drawnNow++; changed = true;
    }
    if (changed) writeFaces();
  };

  // --- the sign ahead of the player (the HUD card)
  let ahead: GuideSign | null = null;
  /** Where a sign's plate hangs and how it lies relative to the car: metres ahead, to the side, and facing. */
  const relate = (s: GuideSign, p: THREE.Vector3Like, fx: number, fz: number) => {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const rx = s.x - s.reach * c - p.x, rz = s.z + s.reach * sn - p.z;
    // The plate faces (sin yaw, cos yaw): towards a car coming at it that is -1.
    return { along: rx * fx + rz * fz, side: Math.abs(rx * fz - rz * fx), facing: sn * fx + c * fz };
  };
  const pickAhead = () => {
    const pl = engine.get<PlayerApi>('player'), v = engine.get<VehicleApi>('vehicle');
    if (!pl || !v || pl.mode !== 'driving') { ahead = null; return; }
    const car = v.car, p = car.pos;
    const fl = Math.hypot(car.fwd.x, car.fwd.z) || 1, fx = car.fwd.x / fl, fz = car.fwd.z / fl;
    // Keep the one on the card until the car is under it (or has turned off).
    if (ahead) {
      const r = relate(ahead, p, fx, fz);
      if (r.along > -2 && r.along < AHEAD + 30 && r.side < AHEAD_SIDE + 10 && r.facing < -0.5) return;
      ahead = null;
    }
    let best = AHEAD;
    for (const i of drawn) {
      const s = signs[i];
      if (Math.abs(s.y - p.y) > 4) continue;
      const r = relate(s, p, fx, fz);
      if (r.along < 12 || r.along > best || r.side > AHEAD_SIDE || r.facing > -0.75) continue;
      best = r.along; ahead = s;
    }
  };

  // The English lines come and go with the language: draw every face again.
  onLangChange(() => { for (const [i, slot] of [...slotOf]) { slotOf.delete(i); owner[slot] = -1; free.push(slot); } writeFaces(); tick = 0; });

  const sys: GuideSignApi = {
    name: 'guideSigns',
    signs, closures,
    live: () => slotOf.size,
    get ahead() { return ahead; },
    update(dt: number) {
      // Retroreflective sheeting: a faint glow at night (the night exposure is 6.5; 0.3 washed the faces out white).
      glow.value = 0.02 * env.uNight.value;
      const c = engine.camera.position;
      if (Math.abs(c.x - packX) > REPACK || Math.abs(c.z - packZ) > REPACK) repack(c.x, c.z);
      tick -= dt;
      if (tick <= 0) { tick = 0.2; assign(); pickAhead(); }
    },
  };
  engine.add(sys);
  return sys;
}
