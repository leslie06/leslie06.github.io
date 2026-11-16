import * as THREE from 'three';
import type { AirfieldData } from './Data';
import type { Runway } from './Flights';

/**
 * 机场的灯（2026-11-16，第二批）：一个点精灵着色器，点的大小按距离缩小但不小于 2 像素（几公里外还是一个亮点，真机场夜里就是这样）。
 * - 地上的（`fieldLights`，夜里才亮）：跑道边灯（白，60 米）、中线灯（白，30 米，最后 900 米红白相间、最后 300 米红）、入口一排绿、
 *   尽头一排红、进近灯光带（跑道头外 900 米，30 米一排横杆，中间一串顺序闪光往跑道跑）、PAPI（左边四个，两红两白）；
 *   滑行道边灯（蓝，30 米）、中线灯（绿，15 米，压在跑道上的不要）。
 * - 飞机上的（`planeLights`，白天也亮，暗一些）：左红右绿航行灯、尾白灯、红色防撞灯一闪一闪、翼尖白频闪两下一组、着陆灯。
 *
 * 属性：`color`、`size`（米）、`flash`（0 常亮；1 顺序闪光，`seed` 是第几个；2 防撞灯；3 频闪），`seed`。
 */
export function lightMaterial(uNight: { value: number }, day: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uNight, uTime: { value: 0 }, uScale: { value: 600 }, uDay: { value: day } },
    vertexShader: /* glsl */`
      attribute vec3 color; attribute float size; attribute float flash; attribute float seed;
      uniform float uNight, uTime, uScale, uDay;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(1.0, -mv.z);
        float on = 1.0;
        if (flash > 0.5 && flash < 1.5) on = step(fract(uTime * 2.0 - seed * 0.035), 0.06);
        else if (flash > 1.5 && flash < 2.5) on = step(fract(uTime * 0.95 + seed), 0.1);
        else if (flash > 2.5) { float f = fract(uTime * 0.8 + seed); on = step(f, 0.03) + step(0.09, f) * step(f, 0.12); }
        vA = on * max(uDay, uNight);
        vC = color;
        gl_PointSize = clamp(size * uScale / d, 2.0, 48.0) * (0.6 + 0.4 * on);
        gl_Position = projectionMatrix * mv;
        if (vA < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        float a = smoothstep(1.0, 0.0, r); a *= a;
        gl_FragColor = vec4(vC * (a * vA * 1.6), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

class Pts {
  pos: number[] = []; col: number[] = []; size: number[] = []; flash: number[] = []; seed: number[] = [];
  add(x: number, y: number, z: number, c: THREE.Color, size: number, flash = 0, seed = 0): void {
    this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.size.push(size); this.flash.push(flash); this.seed.push(seed);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('flash', new THREE.Float32BufferAttribute(this.flash, 1));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const W = new THREE.Color('#fff4dc'), WB = new THREE.Color('#ffffff'), R = new THREE.Color('#ff2a1a'), GR = new THREE.Color('#27ff6a'),
  B = new THREE.Color('#3d6bff'), AMB = new THREE.Color('#ffc36a');

/** 地上的灯。 */
export function fieldLights(d: AirfieldData, rws: Runway[]): THREE.BufferGeometry {
  const P = new Pts(), y = 0.35;
  for (const rw of rws) {
    const { sx, sz, ux, uz, len, w } = rw, nx = -uz, nz = ux;
    const at = (s: number, o: number): [number, number] => [sx + ux * s + nx * o, sz + uz * s + nz * o];
    // 边灯
    for (let s = 0; s <= len; s += 60) for (const o of [-w / 2 - 1.5, w / 2 + 1.5]) { const [x, z] = at(s, o); P.add(x, y, z, len - s < 600 ? AMB : W, 1.1); }
    // 中线
    for (let s = 15; s < len; s += 30) { const [x, z] = at(s, 0); const left = len - s; P.add(x, y * 0.6, z, left < 300 ? R : left < 900 && Math.floor(s / 30) % 2 ? R : W, 0.8); }
    // 两头：入口绿、尽头红（这条跑道两个方向都用，两头各一排绿红）
    for (const [s0, out] of [[0, -1], [len, 1]] as const) for (let o = -w / 2; o <= w / 2; o += 3) {
      const [x, z] = at(s0 + out * 1.5, o); P.add(x, y, z, out < 0 ? GR : R, 1.2);
      const [x2, z2] = at(s0 - out * 1.5, o); P.add(x2, y, z2, out < 0 ? R : GR, 0.7);
    }
    // 进近灯光带（南头，向北运行的进近从南边来）：900 米，30 米一排；300 米处一道长横杆；中间顺序闪光
    for (let k = 1; k <= 30; k++) {
      const s = -k * 30;
      for (const o of [-1.5, 0, 1.5]) { const [x, z] = at(s, o); P.add(x, 0.5 + k * 0.02, z, W, 1.3); }
      if (k === 10) for (let o = -15; o <= 15; o += 1.5) { const [x, z] = at(s, o); P.add(x, 0.5, z, W, 1.1); }
      const [fx, fz] = at(s, 0); P.add(fx, 1.2, fz, WB, 3.2, 1, 30 - k);
    }
    // PAPI：接地点旁，跑道左边四盏，两红两白
    for (let k = 0; k < 4; k++) { const [x, z] = at(330, -(w / 2 + 15 + k * 9)); P.add(x, 0.8, z, k < 2 ? W : R, 1.6); }
  }
  // 滑行道：中线绿（压在跑道上的不要），两边蓝
  const onRw = (x: number, z: number) => rws.some((r) => { const s = (x - r.sx) * r.ux + (z - r.sz) * r.uz, o = Math.abs((x - r.sx) * -r.uz + (z - r.sz) * r.ux); return s > -20 && s < r.len + 20 && o < r.w / 2 + 6; });
  for (const t of d.taxiways) {
    const p = t.p;
    let acc = 0;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      for (let s = (15 - acc % 15) % 15; s < L; s += 15) {
        const x = ax + ux * s, z = az + uz * s;
        if (onRw(x, z)) continue;
        P.add(x, y * 0.6, z, GR, 0.6);
        if (Math.round((acc + s) / 15) % 2 === 0) for (const o of [-t.w / 2 - 1, t.w / 2 + 1]) { const ex = x + nx * o, ez = z + nz * o; if (!onRw(ex, ez)) P.add(ex, y, ez, B, 0.8); }
      }
      acc += L;
    }
  }
  return P.geometry();
}

/** 飞机上的灯（每帧重写）：最多 n 架。 */
export class PlaneLights {
  readonly geo: THREE.BufferGeometry;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private flash: Float32Array; private seed: Float32Array;
  private k = 0;
  constructor(private cap: number) {
    const n = cap;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.flash = new Float32Array(n); this.seed = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('flash', new THREE.BufferAttribute(this.flash, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }
  begin(): void { this.k = 0; }
  add(x: number, y: number, z: number, c: THREE.Color, size: number, flash: number, seed: number): void {
    if (this.k >= this.cap) return;
    const i = this.k++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = size; this.flash[i] = flash; this.seed[i] = seed;
  }
  end(): void {
    this.geo.setDrawRange(0, this.k);
    for (const n of ['position', 'color', 'size', 'flash', 'seed']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
  static readonly RED = R; static readonly GREEN = GR; static readonly WHITE = WB; static readonly LAND = new THREE.Color('#fff8e6');
}
