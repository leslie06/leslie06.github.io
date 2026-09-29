import * as THREE from 'three';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { EnvUniforms } from '../../game/Contracts';
import type { Closure, GuideSign, SignLine } from '../Signs';
import { CJK } from '../landmarks/kit/tex';

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
function name2(g: CanvasRenderingContext2D, l: SignLine, x: number, y: number, maxW: number, px: number, align: CanvasTextAlign = 'center') {
  fitText(g, l.name, x, y, maxW, px, 'cjk', align);
  if (l.en) fitText(g, l.en, x, y + px * 0.62, maxW, Math.round(px * 0.42), 'latin', align);
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

/** Draw a sign's face into (0, 0, W, H) of `g`. */
function drawFace(g: CanvasRenderingContext2D, s: GuideSign, W: number, H: number) {
  g.clearRect(0, 0, SLOT_W, SLOT_H);
  g.fillStyle = '#f2f4f6'; round(g, 0, 0, W, H, 14); g.fill();
  g.fillStyle = BG[s.colour]; round(g, 5, 5, W - 10, H - 10, 10); g.fill();
  g.fillStyle = '#f2f4f6'; g.strokeStyle = '#f2f4f6'; g.textBaseline = 'middle';
  if (s.kind === 'cross') {
    const cx = W / 2, cy = H * 0.6, t = 22, head = 30;
    const by = H - 16;
    const arm = (d: string) => s.lines.find((l) => l.dir === d);
    const L = arm('L'), S = arm('S'), R = arm('R');
    g.fillRect(cx - t / 2, cy - t / 2, t, by - cy + t / 2);
    if (S) arrow(g, cx, cy, cx, H * 0.3, t, head); else g.fillRect(cx - t / 2, cy - t / 2, t, t);
    if (L) arrow(g, cx, cy, W * 0.36, cy, t, head);
    if (R) arrow(g, cx, cy, W * 0.64, cy, t, head);
    if (S) name2(g, S, cx, H * 0.14, W * 0.62, 30);
    if (L) name2(g, L, W * 0.19, cy - 12, W * 0.31, 28);
    if (R) name2(g, R, W * 0.81, cy - 12, W * 0.31, 28);
  } else if (s.kind === 'exit') {
    // 出口 EXIT tag, the interchange big, and the road the slip road leads to with its arrow.
    g.fillStyle = '#f2f4f6'; round(g, 16, 16, 122, 50, 6); g.fill();
    g.fillStyle = BG[s.colour];
    fitText(g, '出口', 50, 42, 60, 28, 'cjk'); fitText(g, 'EXIT', 106, 42, 50, 18, 'latin');
    g.fillStyle = '#f2f4f6';
    const [first, second] = s.lines;
    const dir = (second ?? first).dir;
    name2(g, first, W / 2 + 40, H * 0.36, W - 200, 46);
    if (second) name2(g, second, W / 2, H * 0.74, W - 150, 32);
    // The arrow slants the way the slip road leaves.
    const ax = dir === 'L' ? 46 : W - 46, ay = H * 0.78;
    arrow(g, ax + (dir === 'L' ? 22 : -22), ay + 26, ax + (dir === 'L' ? -14 : 14), ay - 28, 16, 24);
  } else {
    // ahead: up arrow, the road in a white box and its direction; the next interchanges with distances.
    const [road, ...next] = s.lines;
    const colW = W * 0.3;
    arrow(g, colW / 2, H - 22, colW / 2, H * 0.52, 24, 34);
    g.fillStyle = '#f2f4f6'; round(g, 16, 18, colW - 22, 70, 8); g.fill();
    g.fillStyle = BG[s.colour];
    fitText(g, road.name, 16 + (colW - 22) / 2, 44, colW - 34, 32, 'cjk');
    if (road.en) fitText(g, road.en, 16 + (colW - 22) / 2, 73, colW - 34, 14, 'latin');
    g.fillStyle = '#f2f4f6';
    if (s.heading) fitText(g, s.heading, colW / 2, H * 0.43, 60, 26, 'cjk');
    g.fillRect(colW, 18, 2, H - 36);
    const rowH = (H - 30) / Math.max(3, next.length);
    next.forEach((l, i) => {
      const y = 15 + rowH * (i + 0.42);
      fitText(g, l.name, colW + 18, y, W - colW - 130, 32, 'cjk', 'left');
      if (l.en) fitText(g, l.en, colW + 18, y + 22, W - colW - 130, 14, 'latin', 'left');
      if (l.km !== undefined) fitText(g, `${l.km < 1 ? Math.round(l.km * 1000) + ' m' : l.km.toFixed(1) + ' km'}`, W - 22, y + 4, 100, 26, 'latin', 'right');
    });
  }
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
}

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

  const faceSize = (s: GuideSign): [number, number] => {
    const a = s.w / s.h;
    return a >= SLOT_W / SLOT_H ? [SLOT_W, Math.round(SLOT_W / a)] : [Math.round(SLOT_H * a), SLOT_H];
  };

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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSignGlow;');
  };
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

  const sys: GuideSignApi = {
    name: 'guideSigns',
    signs, closures,
    live: () => slotOf.size,
    update(dt: number) {
      // Retroreflective sheeting: a faint glow at night (the night exposure is 6.5; 0.3 washed the faces out white).
      glow.value = 0.02 * env.uNight.value;
      const c = engine.camera.position;
      if (Math.abs(c.x - packX) > REPACK || Math.abs(c.z - packZ) > REPACK) repack(c.x, c.z);
      tick -= dt;
      if (tick <= 0) { tick = 0.2; assign(); }
    },
  };
  engine.add(sys);
  return sys;
}
