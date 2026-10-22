import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MountainData, MountainProp } from './Data';

/**
 * What stands by the roads west of the city (mountain.bin's props): the petrol station and the village's 平房 along
 * 京拉路, green guide boards, the 连续弯路 boards and a convex mirror at each tight bend, a km stone every kilometre, and
 * at the top the paved turning circle, the 妙峰山 牌楼 and the temple's red wall and hall. Merged per material; the
 * lettering is one canvas atlas. Solid ones give boxes for colliders.
 */
const CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
type Key = 'wall' | 'roof' | 'dark' | 'red' | 'white' | 'metal' | 'concrete' | 'paving' | 'green' | 'orange' | 'mirror' | 'atlas' | 'glow';
export interface PropBox { x: number; y: number; z: number; yaw: number; hx: number; hy: number; hz: number }

class Atlas {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  private x = 0; private y = 0; private row = 0;
  constructor(readonly size = 2048) { this.canvas.width = this.canvas.height = size; this.g = this.canvas.getContext('2d')!; }
  /** A w x h slot; draw into it with `fn` (origin at its corner); returns its UV rect [u0, v0, u1, v1]. */
  slot(w: number, h: number, fn: (g: CanvasRenderingContext2D) => void): [number, number, number, number] {
    if (this.x + w > this.size) { this.x = 0; this.y += this.row; this.row = 0; }
    const x = this.x, y = this.y;
    this.g.save(); this.g.translate(x, y); this.g.beginPath(); this.g.rect(0, 0, w, h); this.g.clip(); fn(this.g); this.g.restore();
    this.x += w + 2; this.row = Math.max(this.row, h + 2);
    const S = this.size;
    return [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S];
  }
}

export class PropBuilder {
  private parts = new Map<Key, THREE.BufferGeometry[]>();
  readonly boxes: PropBox[] = [];
  private readonly atlas = new Atlas();
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();

  constructor(private readonly d: MountainData) {}

  private add(key: Key, g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number): void {
    this._m.compose(new THREE.Vector3(x, y, z), this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const geo = (g.index ? g.toNonIndexed() : g).applyMatrix4(this._m);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    (this.parts.get(key) ?? this.parts.set(key, []).get(key)!).push(geo);
  }
  /** A box with its base at local (ox, oy, oz), turned with the prop. */
  private box(p: { x: number; y: number; z: number; yaw: number }, key: Key, w: number, h: number, dd: number, ox = 0, oy = 0, oz = 0, solid = false): void {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const x = p.x + ox * c + oz * s, z = p.z - ox * s + oz * c;
    this.add(key, new THREE.BoxGeometry(w, h, dd).translate(0, h / 2, 0), x, p.y + oy, z, p.yaw);
    if (solid) this.boxes.push({ x, y: p.y + oy + h / 2, z, yaw: p.yaw, hx: w / 2, hy: h / 2, hz: dd / 2 });
  }
  /** A flat panel facing local +z (or -z when `back`), its UVs over an atlas rect. */
  private panel(p: { x: number; y: number; z: number; yaw: number }, w: number, h: number, ox: number, oy: number, oz: number, uv: [number, number, number, number], back = false): void {
    const g = new THREE.PlaneGeometry(w, h);
    const a = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
    if (back) g.rotateY(Math.PI);
    g.translate(0, 0, back ? -0.03 : 0.03);
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    this.add('atlas', g.translate(0, oy, 0), p.x + ox * c + oz * s, p.y, p.z - ox * s + oz * c, p.yaw);
  }
  /** A pitched roof (ridge along local x) over a w x d footprint at height y0, rising `rise`. */
  private roof(p: { x: number; y: number; z: number; yaw: number }, w: number, dd: number, y0: number, rise: number, key: Key = 'roof'): void {
    const o = 0.4, hw = w / 2 + o, hd = dd / 2 + o;
    const pos = [
      -hw, y0, -hd, hw, y0, -hd, hw, y0 + rise, 0, -hw, y0, -hd, hw, y0 + rise, 0, -hw, y0 + rise, 0,
      -hw, y0, hd, -hw, y0 + rise, 0, hw, y0 + rise, 0, -hw, y0, hd, hw, y0 + rise, 0, hw, y0, hd,
      -hw, y0, -hd, -hw, y0 + rise, 0, -hw, y0, hd, hw, y0, -hd, hw, y0, hd, hw, y0 + rise, 0,
    ];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    this.add(key, g, p.x, p.y, p.z, p.yaw);
  }

  build(): void {
    const at = this.atlas;
    // shared graphics
    const warnUV = at.slot(192, 192, (g) => {
      g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(96, 4); g.lineTo(188, 96); g.lineTo(96, 188); g.lineTo(4, 96); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 7; g.stroke();
      g.lineWidth = 11; g.lineJoin = 'round'; g.beginPath(); g.moveTo(96, 150); g.lineTo(96, 128); g.lineTo(122, 108); g.lineTo(70, 82); g.lineTo(96, 62); g.lineTo(96, 44); g.stroke();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(80, 50); g.lineTo(96, 30); g.lineTo(112, 50); g.fill();
    });
    const stationUV = at.slot(512, 96, (g) => { g.fillStyle = '#c8281f'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#fff'; g.font = `800 62px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('加 油 站', 256, 50); });
    const plaqueUV = at.slot(320, 112, (g) => { g.fillStyle = '#1e3a7a'; g.fillRect(0, 0, 320, 112); g.strokeStyle = '#d8b04a'; g.lineWidth = 8; g.strokeRect(6, 6, 308, 100); g.fillStyle = '#e8c35a'; g.font = `900 70px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('妙峰山', 160, 60); });
    for (const p of this.d.props) this.prop(p as MountainProp & { yaw: number }, { warnUV, stationUV, plaqueUV });
  }

  private prop(p: MountainProp & { yaw: number }, uv: Record<string, [number, number, number, number]>): void {
    const at = this.atlas;
    switch (p.k) {
      case 'house': {
        const w = p.w as number, dd = p.d as number, key: Key = 'wall';
        this.box(p, key, w, 3.0, dd, 0, 0, 0, true);
        this.roof(p, w, dd, 3.0, 1.6);
        // a door and two windows on the road side (+z local faces the road: the build turned the far side's round)
        this.box(p, 'dark', 1.0, 2.0, 0.06, -w * 0.18, 0, dd / 2);
        this.box(p, 'dark', 1.4, 1.0, 0.06, w * 0.18, 1.1, dd / 2);
        this.box(p, 'dark', 1.4, 1.0, 0.06, -w * 0.38, 1.1, dd / 2);
        break;
      }
      case 'station': {
        this.box(p, 'white', 13, 0.7, 10, 0, 5.2, 0);
        this.box(p, 'glow', 12, 0.05, 9, 0, 5.15, 0);
        for (const [sx, sz] of [[-4.5, -3], [4.5, -3], [-4.5, 3], [4.5, 3]]) this.box(p, 'white', 0.45, 5.2, 0.45, sx, 0, sz, true);
        for (const sx of [-2.5, 2.5]) { this.box(p, 'concrete', 1.2, 0.25, 5, sx, 0, 0); this.box(p, 'red', 0.8, 1.7, 0.6, sx, 0.25, -1, true); this.box(p, 'red', 0.8, 1.7, 0.6, sx, 0.25, 1.2, true); }
        this.panel(p, 13, 0.7, 0, 5.55, 5.02, uv.stationUV);
        this.panel(p, 13, 0.7, 0, 5.55, -5.02, uv.stationUV, true);
        this.box(p, 'white', 12, 4, 7, 0, 0, -12, true);
        this.box(p, 'dark', 9, 2.4, 0.06, 0, 0.3, -8.48);
        this.box(p, 'red', 12.2, 0.6, 7.2, 0, 4, -12);
        break;
      }
      case 'sign': {
        const lines = p.text as string[];
        const r = at.slot(512, 272, (g) => {
          g.fillStyle = '#1b6e3d'; g.fillRect(0, 0, 512, 272); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(10, 10, 492, 252);
          g.fillStyle = '#fff'; g.textBaseline = 'middle';
          lines.forEach((t, i) => { g.font = `800 ${i === 0 ? 50 : 44}px ${CJK}`; g.textAlign = 'center'; g.fillText(t, 256, 60 + i * 78); });
        });
        // facing the traffic coming up the road: its face looks back along the road (-travel)
        const q = { ...p, yaw: p.yaw + Math.PI };
        this.box(q, 'metal', 0.18, 4.6, 0.18, -1.7, 0, 0); this.box(q, 'metal', 0.18, 4.6, 0.18, 1.7, 0, 0);
        this.box(q, 'green', 4.4, 2.35, 0.08, 0, 2.3, 0);
        this.panel(q, 4.3, 2.28, 0, 3.47, 0.04, r);
        break;
      }
      case 'warn': {
        const q = { ...p, yaw: p.yaw + Math.PI };
        this.box(q, 'metal', 0.08, 2.4, 0.08, 0, 0, -0.06);
        this.panel(q, 0.95, 0.95, 0, 2.5, 0, uv.warnUV);
        break;
      }
      case 'km': {
        const n = p.n as number;
        const r = at.slot(64, 96, (g) => { g.fillStyle = '#eeeeea'; g.fillRect(0, 0, 64, 96); g.fillStyle = '#c0282a'; g.fillRect(0, 0, 64, 26); g.fillStyle = '#222'; g.font = `800 40px ${CJK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 62); });
        const q = { ...p, yaw: p.yaw + Math.PI };
        this.box(q, 'white', 0.26, 0.72, 0.13, 0, -0.05, 0);
        this.panel(q, 0.24, 0.36, 0, 0.45, 0.04, r);
        break;
      }
      case 'mirror': {
        // the pole on the outside of the bend, the mirror turned to the road
        this.box(p, 'orange', 0.09, 2.9, 0.09, 0, 0, 0);
        const g = new THREE.CircleGeometry(0.42, 18).translate(0, 0, 0.06);
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        this.add('mirror', g.clone().translate(0, 2.95, 0), p.x, p.y, p.z, p.yaw);
        this.add('orange', new THREE.TorusGeometry(0.43, 0.05, 6, 18).translate(0, 2.95, 0.06), p.x, p.y, p.z, p.yaw);
        void c; void s;
        break;
      }
      case 'plaza': {
        const g = new THREE.CircleGeometry(p.r as number, 28).rotateX(-Math.PI / 2);
        this.add('paving', g, p.x, p.y - 0.02, p.z, 0);
        break;
      }
      case 'gate': {
        // the 牌楼: four red columns across the way, beams, three roofs, the plaque
        // across the road (the road runs along local z, the columns stand along local x): the middle span over the
        // carriageway and shoulders
        const q = p;
        for (const sx of [-8.8, -6.1, 6.1, 8.8]) this.box(q, 'red', 0.6, 6.8, 0.6, sx, 0, 0, true);
        this.box(q, 'red', 18.6, 0.55, 0.55, 0, 5.7, 0);
        this.box(q, 'red', 12.8, 0.5, 0.5, 0, 7.0, 0);
        this.roof(q, 13.0, 1.6, 7.5, 1.1);
        for (const sx of [-7.45, 7.45]) this.roof({ ...q, x: q.x + Math.cos(q.yaw) * sx, z: q.z - Math.sin(q.yaw) * sx }, 3.4, 1.3, 6.25, 0.8);
        this.panel(q, 3.6, 1.25, 0, 6.35, 0.31, uv.plaqueUV);
        this.panel(q, 3.6, 1.25, 0, 6.35, -0.31, uv.plaqueUV, true);
        break;
      }
      case 'temple': {
        this.box(p, 'red', 34, 3.6, 0.8, 0, 0, -6, true);
        this.box(p, 'roof', 34.6, 0.35, 1.3, 0, 3.6, -6);
        this.box(p, 'red', 16, 5.5, 10, 0, 0, 2, true);
        this.roof({ ...p }, 16, 10, 5.5, 3.2);
        this.box(p, 'dark', 3, 3, 0.06, 0, 0, -3.02);
        break;
      }
    }
  }

  /** The merged meshes (one per material). */
  meshes(night: { value: number }): THREE.Mesh[] {
    const tex = new THREE.CanvasTexture(this.atlas.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const glow = new THREE.MeshStandardMaterial({ color: '#f4f1e8', emissive: '#fff6dc', emissiveIntensity: 0.1, roughness: 0.5 });
    glow.onBeforeRender = () => { glow.emissiveIntensity = 0.1 + 2.4 * night.value; };
    const MAT: Record<Key, THREE.Material> = {
      wall: new THREE.MeshStandardMaterial({ color: '#c9c3b5', roughness: 0.92 }),
      roof: new THREE.MeshStandardMaterial({ color: '#4b4e52', roughness: 0.8, side: THREE.DoubleSide }),
      dark: new THREE.MeshStandardMaterial({ color: '#23272a', roughness: 0.4, metalness: 0.2 }),
      red: new THREE.MeshStandardMaterial({ color: '#9e2b22', roughness: 0.7 }),
      white: new THREE.MeshStandardMaterial({ color: '#e6e6e2', roughness: 0.6 }),
      metal: new THREE.MeshStandardMaterial({ color: '#9aa0a4', roughness: 0.45, metalness: 0.6 }),
      concrete: new THREE.MeshStandardMaterial({ color: '#a6a39b', roughness: 0.95 }),
      paving: new THREE.MeshStandardMaterial({ color: '#9b978d', roughness: 0.95 }),
      green: new THREE.MeshStandardMaterial({ color: '#1b6e3d', roughness: 0.6 }),
      orange: new THREE.MeshStandardMaterial({ color: '#e0761c', roughness: 0.6 }),
      mirror: new THREE.MeshStandardMaterial({ color: '#cfd6dc', roughness: 0.05, metalness: 1 }),
      atlas: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }),
      glow,
    };
    for (const m of Object.values(MAT)) m.userData.wet = true;
    const out: THREE.Mesh[] = [];
    for (const [k, geos] of this.parts) {
      for (const g of geos) for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      const merged = mergeGeometries(geos.map((g) => (g.getAttribute('normal') ? g : (g.computeVertexNormals(), g))));
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, MAT[k]);
      mesh.name = `mountain-props-${k}`; mesh.castShadow = k !== 'paving' && k !== 'glow'; mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  }
}
