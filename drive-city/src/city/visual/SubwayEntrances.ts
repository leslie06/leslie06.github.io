import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { EnvUniforms } from '../../game/Contracts';
import { CJK } from '../landmarks/kit/tex';

/** public/city/entrances.json (scripts/city/entrances.mjs). */
export interface EntrancesFile {
  /** Station names, [zh, en]. */
  names: [string, string][];
  /** x, z, yaw (local +Z = the open end), length, width, station index (-1 none), exit letter. */
  e: [number, number, number, number, number, number, string][];
}

/** The kiosk in its own frame: x across, z along (+z the open end), y up. Length scales per entrance. */
const W = 4.4, L = 10.5, H = 3.3, ROOF_T = 0.4, OVER = 0.25, FRONT = 0.6, SIGN_H = 0.85, SIGN_D = 0.3;
/** The fascia's sign slots: 576 x 100 px (the board's 4.9 x 0.85 m), two columns. */
const SLOT_W = 576, SLOT_H = 100, COLS = 2, ROWS = 16, ATLAS_W = SLOT_W * COLS, ATLAS_H = SLOT_H * ROWS;
const FACES = COLS * ROWS - 1, FACE_RANGE = 220, NEW_PER_TICK = 2, DRAW = 420, REPACK = 30, CAP = 320;
const NAVY = '#163a88', LOGO = '#1d4fa3', WHITE = '#f3f5f7';

/** The ring a kiosk keeps clear of street trees, lamps and kerb furniture (and of the OSM box it replaces). */
export function entranceZones(f: EntrancesFile): number[][] {
  return f.e.map(([x, z, yaw, len, wid]) => {
    const a = len / 2 + FRONT + 0.4, b = Math.max(W, wid) / 2 + 0.5, s = Math.sin(yaw), c = Math.cos(yaw);
    const pt = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c];
    return [...pt(-b, -a), ...pt(b, -a), ...pt(b, a), ...pt(-b, a)];
  });
}

/** The Beijing Subway roundel, roughly: a blue disc with a white G round a bar. */
function logo(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = WHITE; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = LOGO; g.beginPath(); g.arc(cx, cy, r * 0.9, 0, Math.PI * 2); g.fill();
  g.strokeStyle = WHITE; g.lineWidth = r * 0.2; g.lineCap = 'butt';
  // a G: open at the upper right, its bar running in from the right at mid height
  g.beginPath(); g.arc(cx, cy, r * 0.56, 0, Math.PI * 1.7); g.stroke();
  g.fillStyle = WHITE; g.fillRect(cx - r * 0.04, cy - r * 0.1, r * 0.7, r * 0.2);
}

function drawFace(g: CanvasRenderingContext2D, zh: string, en: string, ref: string): void {
  g.fillStyle = NAVY; g.fillRect(0, 0, SLOT_W, SLOT_H);
  g.fillStyle = '#c9d2df'; g.fillRect(0, 0, SLOT_W, 3); g.fillRect(0, SLOT_H - 3, SLOT_W, 3);
  logo(g, 52, SLOT_H / 2, 36);
  const right = ref ? SLOT_W - 100 : SLOT_W - 18;
  g.fillStyle = WHITE; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const room = right - 104;
  g.font = `700 46px ${CJK}`;
  const zw = g.measureText(zh).width;
  g.save(); g.translate(104, 58); if (zw > room) g.scale(room / zw, 1); g.fillText(zh, 0, 0); g.restore();
  g.font = '600 19px system-ui, "Helvetica Neue", Arial, sans-serif';
  const ew = g.measureText(en).width;
  g.save(); g.translate(105, 86); if (ew > room) g.scale(room / ew, 1); g.fillText(en, 0, 0); g.restore();
  if (ref) {
    const x0 = SLOT_W - 88, y0 = 14, s = 72;
    g.fillStyle = WHITE; g.beginPath(); g.roundRect(x0, y0, s, s, 8); g.fill();
    g.fillStyle = NAVY; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${ref.length > 1 ? 40 : 54}px system-ui, "Helvetica Neue", Arial, sans-serif`;
    g.fillText(ref, x0 + s / 2, y0 + s / 2 + 3);
  }
}

/** The stairs going down from the landing at the open end into the dark (the ground has no hole). */
function stairTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d')!;
  // canvas top = the closed end (deepest), bottom = the landing at the open end
  const landing = 80;
  g.fillStyle = '#8f9396'; g.fillRect(0, 512 - landing, 128, landing);
  const steps = 22, top = 0, bottom = 512 - landing, sh = (bottom - top) / steps;
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);                       // 0 at the top step, 1 at the deepest
    const y = bottom - (i + 1) * sh;
    const v = Math.round(120 - 105 * Math.pow(k, 0.6));
    g.fillStyle = `rgb(${v},${v + 2},${v + 4})`; g.fillRect(0, y, 128, sh);
    g.fillStyle = `rgba(0,0,0,${0.35 + 0.4 * k})`; g.fillRect(0, y, 128, sh * 0.3);   // the riser's shadow
    g.fillStyle = `rgba(255,214,90,${0.5 * (1 - k)})`; g.fillRect(0, y + sh - 2, 128, 2); // the nosing strip
  }
  g.fillStyle = 'rgba(40,44,50,0.9)'; g.fillRect(0, 0, 10, bottom); g.fillRect(118, 0, 10, bottom);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A box with one vertex colour. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.deleteAttribute('uv');
  const c = new THREE.Color(colour), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function kioskGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; floor: THREE.BufferGeometry; face: THREE.BufferGeometry } {
  const FRAME = '#565d66', ROOF = '#d3d6d9', SOFFIT = '#e8e9ea', STONE = '#b7b1a5', PLINTH = '#8c8d8c';
  const hx = W / 2, wall = hx - 0.12, under = H - ROOF_T;
  const parts: THREE.BufferGeometry[] = [];
  // roof slab (its underside a shade lighter: the soffit), the sign box at its front
  parts.push(box(-hx - OVER, under + 0.04, -L / 2 - 0.15, hx + OVER, H, L / 2 + FRONT, ROOF));
  parts.push(box(-hx - OVER + 0.05, under, -L / 2 - 0.1, hx + OVER - 0.05, under + 0.04, L / 2 + FRONT - SIGN_D, SOFFIT));
  parts.push(box(-hx - OVER, H - SIGN_H, L / 2 + FRONT - SIGN_D, hx + OVER, H + 0.02, L / 2 + FRONT, NAVY));
  // granite plinth under the side walls and the back
  for (const s of [-1, 1]) parts.push(box(s * wall - 0.17, 0, -L / 2, s * wall + 0.17, 0.42, L / 2 - 0.05, PLINTH));
  // the closed end: stone
  parts.push(box(-hx + 0.05, 0, -L / 2, hx - 0.05, under, -L / 2 + 0.3, STONE));
  // posts and rails of the glass walls
  const posts = 6;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= posts; i++) {
      const z = -L / 2 + 0.35 + (L - 0.45) * i / posts;
      parts.push(box(s * wall - 0.06, 0.42, z - 0.06, s * wall + 0.06, under, z + 0.06, FRAME));
    }
    parts.push(box(s * wall - 0.08, under - 0.14, -L / 2 + 0.3, s * wall + 0.08, under, L / 2 - 0.05, FRAME));
    parts.push(box(s * wall - 0.05, 1.0, -L / 2 + 0.3, s * wall + 0.05, 1.06, L / 2 - 0.05, FRAME));
  }
  const body = mergeGeometries(parts)!;
  const glass = mergeGeometries([-1, 1].map((s) => {
    const g = new THREE.BoxGeometry(0.03, under - 0.14 - 0.42, L - 0.4).translate(s * wall, (0.42 + under - 0.14) / 2, 0.15);
    g.deleteAttribute('uv');
    return g;
  }))!;
  const floor = new THREE.PlaneGeometry(2 * wall - 0.34, L - 0.35).rotateX(-Math.PI / 2).translate(0, 0.075, 0.125);
  const face = new THREE.PlaneGeometry(W + 2 * OVER, SIGN_H).translate(0, H - SIGN_H / 2 + 0.01, L / 2 + FRONT + 0.004);
  return { body, glass, floor, face };
}

export interface SubwayEntranceApi extends System {
  readonly count: number;
  /** Kiosks with their station's board drawn right now (for probes). */
  readonly live: () => number;
}

/**
 * The subway entrances (地铁口, 2026-10-02): a glass kiosk under a flat roof with the blue board of
 * Beijing's subway over the open end - the roundel, the station in Chinese and English and the
 * exit's letter - and the stairs going down inside, drawn on the floor. Four instanced meshes for
 * the kiosks within DRAW of the camera; the boards are drawn on demand into slots of one atlas for
 * the nearest FACES that face the camera (the rest show the plain 地铁 SUBWAY board). The fascia
 * and the stairwell light up at night. Colliders: the two side walls, the closed end and the roof,
 * so the open end can be walked into.
 */
export function placeSubwayEntrances(engine: Engine, data: EntrancesFile, env: EnvUniforms): SubwayEntranceApi {
  const list = data.e;
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
  drawFace(g, '地铁', 'SUBWAY', '');
  for (let k = 0; k <= FACES; k++) blit(k);
  uploaded = true;
  const slotUv = (k: number): [number, number, number, number] => {
    const x0 = (k % COLS) * SLOT_W, y0 = Math.floor(k / COLS) * SLOT_H;
    // texture v runs bottom-up; the slot's top row is at ATLAS_H - 1 - y0
    return [(x0 + 0.5) / ATLAS_W, (ATLAS_H - y0 - SLOT_H + 0.5) / ATLAS_H, (x0 + SLOT_W - 0.5) / ATLAS_W, (ATLAS_H - y0 - 0.5) / ATLAS_H];
  };

  // --- materials
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
  bodyMat.userData.wet = 'surface';
  const glassMat = new THREE.MeshStandardMaterial({ color: '#33505c', roughness: 0.08, metalness: 0.65 });
  glassMat.userData.wet = 'surface';
  const stairs = stairTexture();
  const floorMat = new THREE.MeshStandardMaterial({ map: stairs, emissiveMap: stairs, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.7 });
  const faceMat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4, metalness: 0.05 });
  faceMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFace;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = mix(aFace.xy, aFace.zw, uv);\n#endif\n#ifdef USE_EMISSIVEMAP\n  vEmissiveMapUv = mix(aFace.xy, aFace.zw, uv);\n#endif');
  };
  faceMat.customProgramCacheKey = () => 'subway-face';

  // --- meshes
  const geo = kioskGeometry();
  const aFace = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  aFace.setUsage(THREE.DynamicDrawUsage);
  geo.face.setAttribute('aFace', aFace);
  const mk = (gg: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow: boolean) => {
    const m = new THREE.InstancedMesh(gg, mat, CAP);
    m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
    engine.scene.add(m);
    return m;
  };
  const meshes = [mk(geo.body, bodyMat, 'subway-kiosks', true), mk(geo.glass, glassMat, 'subway-glass', true), mk(geo.floor, floorMat, 'subway-stairs', false), mk(geo.face, faceMat, 'subway-boards', false)];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const mats = list.map(([x, z, yaw, len]) => m4.compose(p.set(x, 0, z), q.setFromAxisAngle(up, yaw), sc.set(1, 1, len / L)).toArray());

  // --- colliders
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const cg = groups(CG.WORLD, CG.ALL);
  for (const [x, z, yaw, len] of list) {
    const s = len / L, sn = Math.sin(yaw), c = Math.cos(yaw), rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const add = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, surface: 'concrete' | 'metal') => {
      const col = world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x + lx * c + lz * sn, ly, z - lx * sn + lz * c).setRotation(rot).setCollisionGroups(cg), body);
      engine.physics.tag(col, { surface, tag: 'subway' });
    };
    for (const side of [-1, 1]) add(side * (W / 2 - 0.12), (H - ROOF_T) / 2, -0.025 * s, 0.18, (H - ROOF_T) / 2, (L / 2 - 0.025) * s, 'metal');
    add(0, (H - ROOF_T) / 2, (-L / 2 + 0.15) * s, W / 2, (H - ROOF_T) / 2, 0.15 * s, 'concrete');
    add(0, H - ROOF_T / 2, (FRONT - 0.15) / 2 * s, W / 2 + OVER, ROOF_T / 2, (L / 2 + (FRONT + 0.15) / 2) * s, 'metal');
  }

  // --- the boards
  const slotOf = new Map<number, number>();
  const free: number[] = [];
  for (let k = FACES; k >= 1; k--) free.push(k);
  let drawn: number[] = [];
  const generic = slotUv(0);
  const writeFaces = () => {
    const a = aFace.array as Float32Array;
    drawn.forEach((i, k) => { const slot = slotOf.get(i); a.set(slot !== undefined ? slotUv(slot) : generic, k * 4); });
    aFace.needsUpdate = true;
  };
  let packX = Infinity, packZ = Infinity;
  const repack = (cx: number, cz: number) => {
    packX = cx; packZ = cz;
    drawn = [];
    list.forEach(([x, z], i) => { if (Math.abs(x - cx) < DRAW && Math.abs(z - cz) < DRAW && drawn.length < CAP) drawn.push(i); });
    for (const mesh of meshes) {
      const arr = mesh.instanceMatrix.array as Float32Array;
      drawn.forEach((i, k) => arr.set(mats[i], k * 16));
      mesh.count = drawn.length;
      mesh.visible = drawn.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    writeFaces();
  };
  const cam = new THREE.Vector3();
  const assign = () => {
    engine.camera.getWorldPosition(cam);
    const want: [number, number][] = [];
    for (const i of drawn) {
      const [x, z, yaw, len, , ni] = list[i];
      if (ni < 0) continue;
      const sn = Math.sin(yaw), c = Math.cos(yaw), f = (L / 2 + FRONT) * len / L;
      const dx = cam.x - (x + f * sn), dz = cam.z - (z + f * c), d = Math.hypot(dx, dz);
      if (d > FACE_RANGE || dx * sn + dz * c < -1) continue;
      want.push([d, i]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const keep = new Set(want.slice(0, FACES).map((w) => w[1]));
    let changed = false;
    for (const [i, slot] of [...slotOf]) if (!keep.has(i)) { slotOf.delete(i); free.push(slot); changed = true; }
    let n = 0;
    for (const [, i] of want) {
      if (!keep.has(i) || slotOf.has(i)) continue;
      if (n >= NEW_PER_TICK || !free.length) break;
      const slot = free.pop()!;
      const [zh, en] = data.names[list[i][5]];
      drawFace(g, zh, en, list[i][6]);
      blit(slot);
      slotOf.set(i, slot);
      n++; changed = true;
    }
    if (changed) writeFaces();
  };

  let tick = 0;
  const sys: SubwayEntranceApi = {
    name: 'subwayEntrances',
    count: list.length,
    live: () => slotOf.size,
    update(dt: number) {
      const night = env.uNight.value;
      faceMat.emissiveIntensity = 0.22 * night;
      floorMat.emissiveIntensity = 0.07 * night;
      const c = engine.camera.position;
      if (Math.abs(c.x - packX) > REPACK || Math.abs(c.z - packZ) > REPACK) repack(c.x, c.z);
      tick -= dt;
      if (tick <= 0) { tick = 0.25; assign(); }
    },
  };
  engine.add(sys);
  return sys;
}
