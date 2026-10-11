import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { System } from '../../core/Engine';
import type { EnvUniforms } from '../../game/Contracts';
import { CJK } from '../../world/Textures';
import { SHOP_STRIDE } from '../Buildings';
import type { CityStreamer } from '../Streamer';
import { tileOf } from '../Geo';
import { hashU, h01 } from './hash';
import { shopSigns, VERT_COLOURS, VERT_COLS, VERT_ROWS, VERT_TEXTS } from './ShopSigns';

/**
 * What stands in front of the shops (2026-10-11, 「底商门头」): the facade shader paints the shop fronts flat, and a
 * street of them read as wallpaper. Near the camera each shop unit the worker found (Buildings.ts `shops`, the
 * shader's own units, sign and shutter) may get, by its hash: an awning over the window, a projecting lightbox with
 * its trade stacked vertically (竖招牌, lit at night), and the trade's things on the pavement - a table and stools
 * outside a food shop, crates outside a fruit shop, an A-frame board - only where the pavement in front has room
 * (`room`, so nothing stands in the road or under the cars parked half up on it). Five instanced meshes, refilled
 * when the camera has moved 12 m or the tiles changed; no colliders (a car passes through a stool).
 */
interface Kind { mesh: THREE.InstancedMesh; n: number; cap: number; cell?: THREE.InstancedBufferAttribute }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** The bottom of a shop's sign band, as the facade shader draws it (Materials.ts). */
const signBottom = (gh: number) => gh - Math.min(0.25, gh * 0.06) - Math.min(0.95, Math.max(0.5, gh * 0.24));
const AWNING = ['#b8261e', '#1f5fae', '#2f7a3a', '#d8702a', '#e8e4da', '#7a1a2a', '#2a6a8a', '#c9a227'];

function coloured(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) => coloured(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

/** An awning 1 m wide (scaled to the unit), 1.05 m deep, sloping 0.35 m down from the wall, with a valance: panels of two shades. */
function awningGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const P = 6;
  for (let i = 0; i < P; i++) {
    const x0 = -0.5 + i / P, x1 = x0 + 1 / P, shade = i % 2 ? '#d6d6d6' : '#ffffff';
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, 0, 0, x1, 0, 0, x1, -0.35, 1.05, x0, 0, 0, x1, -0.35, 1.05, x0, -0.35, 1.05,   // canopy
      x0, -0.35, 1.05, x1, -0.35, 1.05, x1, -0.6, 1.07, x0, -0.35, 1.05, x1, -0.6, 1.07, x0, -0.6, 1.07,   // valance
    ], 3));
    parts.push(coloured(g, shade));
  }
  // the side cheeks
  for (const x of [-0.5, 0.5]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x, 0, 0, x, -0.35, 1.05, x, -0.6, 1.07], 3));
    parts.push(coloured(g, '#e0e0e0'));
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
}

/** A folding table with four plastic stools round it (the stools' colour by instance: the table stays white-ish). */
function foodGeo(): THREE.BufferGeometry {
  const parts = [box(0.8, 0.03, 0.6, 0, 0.72, 0, '#e8e6e0')];
  for (const [x, z] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]]) parts.push(box(0.03, 0.72, 0.03, x, 0.36, z, '#9a9a98'));
  for (const [x, z] of [[-0.62, 0], [0.62, 0], [0, -0.5], [0, 0.5]]) {
    parts.push(coloured(new THREE.CylinderGeometry(0.15, 0.13, 0.04, 10).translate(x, 0.44, z), '#ffffff'));
    parts.push(coloured(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 10, 1, true).translate(x, 0.21, z), '#d0d0d0'));
  }
  return mergeGeometries(parts)!;
}

/** Three crates of fruit on a low stand, sloping to the street. */
function cratesGeo(): THREE.BufferGeometry {
  const parts = [box(1.7, 0.45, 0.7, 0, 0.225, 0, '#6a5a48')];
  const fruit = ['#e8792a', '#c8261e', '#e8c82a', '#5aa83a', '#8a2a5a'];
  for (let i = 0; i < 3; i++) {
    const x = -0.56 + i * 0.56;
    parts.push(box(0.5, 0.26, 0.6, x, 0.58, 0, i % 2 ? '#2a7a3a' : '#2a5aa8'));
    parts.push(coloured(new THREE.SphereGeometry(0.26, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 0.35, 1.05).translate(x, 0.7, 0), fruit[i + (i > 1 ? 1 : 0)]));
  }
  return mergeGeometries(parts)!;
}

/** An A-frame board (its faces take the shop's colour by instance). */
function boardGeo(): THREE.BufferGeometry {
  const a = 0.18, parts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const g = new THREE.BoxGeometry(0.6, 0.95, 0.025);
    g.rotateX(s * a); g.translate(0, 0.47, s * 0.09);
    parts.push(coloured(g, '#ffffff'));
  }
  return mergeGeometries(parts)!;
}

/** The projecting lightbox: 0.16 m thick along the wall, 1.5 m tall, 0.55 m out from it; text on its two broad faces. */
function lightboxGeo(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.16, 1.5, 0.55).translate(0, 0, 0.35);
  // only the +x / -x faces carry the text (BoxGeometry's first 8 vertices); the rest take the frame at the cell's edge
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 8; i < uv.count; i++) uv.setXY(i, 0.02, 0.5);
  // the arm to the wall
  const arm = new THREE.BoxGeometry(0.05, 0.05, 0.1).translate(0, 0.6, 0.05), ua = arm.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < ua.count; i++) ua.setXY(i, 0.02, 0.5);
  return mergeGeometries([g, arm])!;
}

function vertAtlas(): THREE.CanvasTexture {
  const cw = 64, ch = 256, cv = document.createElement('canvas');
  cv.width = cw * VERT_COLS; cv.height = ch * VERT_ROWS;
  const g = cv.getContext('2d')!;
  VERT_TEXTS.forEach((t, i) => {
    const x = (i % VERT_COLS) * cw, y = Math.floor(i / VERT_COLS) * ch, [bg, fg] = VERT_COLOURS[i];
    g.fillStyle = '#3a3c40'; g.fillRect(x, y, cw, ch);
    g.fillStyle = bg; g.fillRect(x + 4, y + 4, cw - 8, ch - 8);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = [...t].length, step = Math.min(70, (ch - 24) / n), size = Math.min(48, step * 0.9);
    g.font = `bold ${size}px ${CJK}`;
    [...t].forEach((c, k) => g.fillText(c, x + cw / 2, y + ch / 2 + (k - (n - 1) / 2) * step));
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class ShopFronts implements System {
  name = 'shopFronts';
  private kinds: Record<'awning' | 'sign' | 'food' | 'crates' | 'board', Kind>;
  private at = new THREE.Vector3(Infinity, 0, Infinity);
  private ver = -1;
  private signMat: THREE.MeshStandardMaterial;
  private readonly signs = shopSigns();
  private readonly colours = this.signs.map((s) => new THREE.Color(s.bg));

  constructor(scene: THREE.Scene, private streamer: CityStreamer, private env: EnvUniforms, private radius: number, private goods: boolean) {
    const lit = (vc = true) => new THREE.MeshStandardMaterial({ vertexColors: vc, roughness: 0.75 });
    const awnMat = lit(); awnMat.side = THREE.DoubleSide;
    this.signMat = new THREE.MeshStandardMaterial({ map: vertAtlas(), emissive: 0xffffff, roughness: 0.4 });
    this.signMat.emissiveMap = this.signMat.map;
    this.signMat.emissiveIntensity = 0;
    // each lightbox shows its own cell of the atlas
    this.signMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
  vMapUv = vec2((mod(aCell, ${VERT_COLS}.0) + vMapUv.x) / ${VERT_COLS}.0, 1.0 - (floor(aCell / ${VERT_COLS}.0) + 1.0 - vMapUv.y) / ${VERT_ROWS}.0);
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = vMapUv;
  #endif`);
    };
    this.signMat.customProgramCacheKey = () => 'shop-lightbox';
    const make = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow: boolean, colours: boolean): Kind => {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (colours) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      scene.add(mesh);
      return { mesh, n: 0, cap };
    };
    this.kinds = {
      awning: make('shop-awning', awningGeo(), awnMat, 500, true, true),
      sign: make('shop-lightbox', lightboxGeo(), this.signMat, 300, false, false),
      food: make('shop-tables', foodGeo(), lit(), 120, false, true),
      crates: make('shop-crates', cratesGeo(), lit(), 80, false, false),
      board: make('shop-board', boardGeo(), lit(), 160, false, true),
    };
    const sk = this.kinds.sign;
    sk.cell = new THREE.InstancedBufferAttribute(new Float32Array(sk.cap), 1);
    sk.mesh.geometry.setAttribute('aCell', sk.cell);
  }

  private put(k: Kind, x: number, y: number, z: number, yaw: number, sx = 1, colour?: THREE.Color): number {
    if (k.n >= k.cap) return -1;
    _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(sx, 1, 1));
    k.mesh.setMatrixAt(k.n, _m);
    if (colour && k.mesh.instanceColor) k.mesh.setColorAt(k.n, colour);
    return k.n++;
  }

  private fill(cx: number, cz: number): void {
    for (const k of Object.values(this.kinds)) k.n = 0;
    const r2 = this.radius * this.radius, g2 = Math.min(this.radius, 70) ** 2, c = new THREE.Color();
    const [ix, iz] = tileOf(cx, cz);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = this.streamer.shops.get(`${ix + dx}_${iz + dz}`);
      if (!list) continue;
      for (let i = 0; i < list.length; i += SHOP_STRIDE) {
        const x = list[i], z = list[i + 1], d2 = (x - cx) ** 2 + (z - cz) ** 2;
        if (d2 > r2) continue;
        const nx = list[i + 2], nz = list[i + 3], w = list[i + 4], gh = list[i + 5], si = list[i + 6], fl = list[i + 7], hs = list[i + 8], room = list[i + 9];
        const open = !(fl & 1), hutong = !!(fl & 2), yaw = Math.atan2(nx, nz), tx = -nz, tz = nx;
        const r = (salt: number) => h01(hashU((hs ^ salt) >>> 0));
        const sign = si >= 0 ? this.signs[si] : null;
        // an awning over an open shop with room under it (not over the road)
        if (open && !hutong && room > 1.6 && signBottom(gh) > 2.4 && r(0x51ed) < 0.45) {
          c.set(AWNING[Math.floor(r(0x7a3) * AWNING.length)]);
          this.put(this.kinds.awning, x + nx * 0.02, signBottom(gh) - 0.04, z + nz * 0.02, yaw, w * 0.97, c);
        }
        // a projecting lightbox at one end of the unit, over the pavement
        if (sign && sign.vert >= 0 && room > 1.2 && r(0x9b1) < 0.38) {
          const side = r(0x33) < 0.5 ? -1 : 1, o = side * (w / 2 - 0.25);
          const y = fl & 4 ? gh + 1.0 : Math.max(2.7, gh - 0.55);
          const n = this.put(this.kinds.sign, x + tx * o, y, z + tz * o, yaw);
          if (n >= 0) this.kinds.sign.cell!.setX(n, sign.vert);
        }
        // the trade's things on the pavement, near only and where the pavement is wide
        if (!this.goods || !open || !sign || d2 > g2 || room < 3.5) continue;
        const along = (r(0x1f) - 0.5) * Math.max(0, w - 1.8);
        if (sign.kind === 'food' && r(0x2c) < 0.4) {
          c.set(r(0x2d) < 0.6 ? '#c8261e' : '#2a5aa8');
          this.put(this.kinds.food, x + nx * 1.5 + tx * along, 0.06, z + nz * 1.5 + tz * along, yaw + (r(0x2e) - 0.5) * 0.4, 1, c);
        } else if (sign.kind === 'fruit' && r(0x3c) < 0.9) {
          this.put(this.kinds.crates, x + nx * 0.7 + tx * along, 0.06, z + nz * 0.7 + tz * along, yaw);
        } else if ((sign.kind === 'shop' || sign.kind === 'service' || sign.kind === 'food') && r(0x4c) < 0.22) {
          this.put(this.kinds.board, x + nx * 1.1 + tx * along, 0.06, z + nz * 1.1 + tz * along, yaw + (r(0x4d) - 0.5) * 0.6, 1, this.colours[si]);
        }
      }
    }
    for (const k of Object.values(this.kinds)) {
      k.mesh.count = k.n;
      k.mesh.instanceMatrix.needsUpdate = true;
      if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
      if (k.cell) k.cell.needsUpdate = true;
    }
  }

  update(): void {
    const f = this.streamer.focus;
    if (this.ver !== this.streamer.shopVer || Math.hypot(f.x - this.at.x, f.z - this.at.z) > 12) {
      this.ver = this.streamer.shopVer; this.at.copy(f);
      this.fill(f.x, f.z);
    }
    this.signMat.emissiveIntensity = this.env.uNight.value * 1.6;
  }
}
