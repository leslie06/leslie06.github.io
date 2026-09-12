import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { Rng } from '../core/Rng';
import type { VehicleApi, RenderApi } from '../game/Contracts';

/**
 * Tyre marks and tyre smoke: the two things that make a drift look like one. Each is a single
 * draw call: the marks a ring buffer of quads, the smoke an instanced billboard pool.
 */
class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private next = 0;
  private last: (THREE.Vector3 | null)[] = [null, null, null, null];
  private lastAlpha = [0, 0, 0, 0];
  private readonly side = new THREE.Vector3();

  constructor(private max: number) {
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const b = i * 4;
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    // Double-sided: a quad's winding depends on which way the wheel was travelling.
    const mat = new THREE.MeshBasicMaterial({ color: '#141414', vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Extend wheel `i`'s mark to `p` (on the ground) with `alpha` 0..1; alpha 0 ends the mark. */
  add(i: number, p: THREE.Vector3, lateral: THREE.Vector3, width: number, alpha: number): void {
    const prev = this.last[i];
    if (alpha < 0.08) { this.last[i] = null; return; }
    if (!prev) { this.last[i] = p.clone(); this.lastAlpha[i] = alpha; return; }
    if (prev.distanceToSquared(p) < 0.09) return;
    if (prev.distanceToSquared(p) > 9) { prev.copy(p); return; }   // teleported
    this.side.copy(lateral).multiplyScalar(width / 2);
    const s = this.next;
    this.next = (this.next + 1) % this.max;
    const y = 0.018;
    const P = this.pos, C = this.col, o = s * 12, c = s * 16;
    P[o] = prev.x + this.side.x; P[o + 1] = prev.y + y; P[o + 2] = prev.z + this.side.z;
    P[o + 3] = prev.x - this.side.x; P[o + 4] = prev.y + y; P[o + 5] = prev.z - this.side.z;
    P[o + 6] = p.x + this.side.x; P[o + 7] = p.y + y; P[o + 8] = p.z + this.side.z;
    P[o + 9] = p.x - this.side.x; P[o + 10] = p.y + y; P[o + 11] = p.z - this.side.z;
    const a0 = this.lastAlpha[i] * 0.8, a1 = alpha * 0.8;
    for (let k = 0; k < 4; k++) { C[c + k * 4] = 1; C[c + k * 4 + 1] = 1; C[c + k * 4 + 2] = 1; C[c + k * 4 + 3] = k < 2 ? a0 : a1; }
    const g = this.mesh.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    prev.copy(p);
    this.lastAlpha[i] = alpha;
  }

  clear(): void { this.col.fill(0); (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true; this.last.fill(null); }
}

class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array; private v: Float32Array;
  private age: Float32Array; private life: Float32Array; private s0: Float32Array; private s1: Float32Array; private shade: Float32Array;
  private aPos: THREE.InstancedBufferAttribute; private aSize: THREE.InstancedBufferAttribute; private aAlpha: THREE.InstancedBufferAttribute; private aRot: THREE.InstancedBufferAttribute; private aShade: THREE.InstancedBufferAttribute;
  private alive = 0;
  private rng = new Rng(99);

  constructor(private max: number) {
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.shade = new Float32Array(max);
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aShade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSize', this.aSize); geo.setAttribute('iAlpha', this.aAlpha); geo.setAttribute('iRot', this.aRot); geo.setAttribute('iShade', this.aShade);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uLight: { value: new THREE.Color('#f2ece4') }, uShade: { value: new THREE.Color('#9da0a3') } },
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iRot; attribute float iShade; varying float vShade;
        varying vec2 vUv; varying float vAlpha; varying float vRot;
        void main() {
          vUv = uv; vAlpha = iAlpha; vRot = iRot; vShade = iShade;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(iRot), s = sin(iRot);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vec3 w = iPos + (right * q.x + up * q.y) * iSize;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLight, uShade;
        varying vec2 vUv; varying float vAlpha; varying float vRot; varying float vShade;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float puff = n(vUv * 4.0 + vRot * 3.0) * 0.6 + n(vUv * 9.0 - vRot) * 0.4;
          float a = smoothstep(1.0, 0.25, r + (puff - 0.5) * 0.55) * vAlpha;
          if (a < 0.004) discard;
          vec3 col = mix(uShade, uLight, clamp(0.45 + d.y * 1.2 + puff * 0.3, 0.0, 1.0));
          col = mix(col, vec3(0.045, 0.042, 0.04) * (0.6 + 0.4 * uLight), vShade);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  private light0 = new THREE.Color('#f2ece4'); private shade0 = new THREE.Color('#9da0a3');
  /** Smoke is lit by the sky: take on the haze colour and darken at night. */
  tint(night: number, haze: THREE.Color): void {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms, k = 1 - 0.82 * night;
    u.uLight.value.copy(this.light0).lerp(haze, 0.25).multiplyScalar(k);
    u.uShade.value.copy(this.shade0).lerp(haze, 0.25).multiplyScalar(k);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, shade = 0): void {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    const r = this.rng;
    this.p[i * 3] = x + r.range(-0.2, 0.2); this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z + r.range(-0.2, 0.2);
    this.v[i * 3] = vx + r.range(-0.6, 0.6); this.v[i * 3 + 1] = vy + r.range(0.2, 0.9); this.v[i * 3 + 2] = vz + r.range(-0.6, 0.6);
    this.age[i] = 0; this.life[i] = life * r.range(0.8, 1.2);
    this.s0[i] = size * 0.5; this.s1[i] = size * r.range(2.8, 4.2);
    this.aRot.setX(i, r.range(0, 6.28));
    this.shade[i] = shade;
  }

  update(dt: number): void {
    let n = this.alive;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        n--;
        // Swap-remove: move the last particle into this slot.
        this.p.copyWithin(i * 3, n * 3, n * 3 + 3); this.v.copyWithin(i * 3, n * 3, n * 3 + 3);
        this.age[i] = this.age[n]; this.life[i] = this.life[n]; this.s0[i] = this.s0[n]; this.s1[i] = this.s1[n];
        this.aRot.setX(i, this.aRot.getX(n)); this.shade[i] = this.shade[n];
        i--; continue;
      }
      const drag = Math.exp(-dt * 1.6);
      this.v[i * 3] *= drag; this.v[i * 3 + 2] *= drag;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * drag + dt * 0.35;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.aPos.setXYZ(i, this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.aSize.setX(i, this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t));
      this.aAlpha.setX(i, 0.5 * (1 + this.shade[i] * 0.5) * Math.min(1, t * 8) * Math.pow(1 - t, 1.6));
      this.aShade.setX(i, this.shade[i]);
      this.aRot.setX(i, this.aRot.getX(i) + dt * 0.3);
    }
    this.alive = n;
    this.mesh.count = n;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aRot.needsUpdate = this.aShade.needsUpdate = true;
  }

  clear(): void { this.alive = 0; this.mesh.count = 0; }
}

export interface FxApi extends System {
  clear(): void;
  /** One smoke puff (engine smoke and the like); `shade` 0 is pale tyre smoke, 1 is black. */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, shade?: number): void;
}

export async function install(engine: Engine): Promise<void> {
  const q = engine.quality;
  const marks = new SkidMarks(q.skidSegments);
  const smoke = new Smoke(q.smokeParticles);
  engine.scene.add(marks.mesh, smoke.mesh);
  const lateral = new THREE.Vector3();
  const acc = [0, 0, 0, 0];
  const api: FxApi = {
    name: 'fx',
    clear() { marks.clear(); smoke.clear(); },
    smoke: (x, y, z, vx, vy, vz, size, life, shade) => smoke.emit(x, y, z, vx, vy, vz, size, life, shade ?? 0),
    postStep(dt) {
      const v = engine.get<VehicleApi>('vehicle');
      if (!v) return;
      const car = v.car;
      for (let i = 0; i < 4; i++) {
        const w = car.wheels[i];
        if (!w.contact) { marks.add(i, w.point, lateral, 0.2, 0); continue; }
        // Lateral axis of the wheel on the ground (for the mark's width).
        lateral.copy(car.left).applyAxisAngle(car.up, w.steer);
        marks.add(i, w.point, lateral, car.spec.wheelWidth * 0.95, w.skid);
        // Smoke from the rears mostly; fronts only when properly sliding.
        const s = i >= 2 ? w.skid : w.skid * 0.4;
        if (s > 0.3 && w.surface !== 'grass') {
          acc[i] += dt * (18 + 40 * s) * (0.4 + Math.min(1, car.speed / 10));
          while (acc[i] >= 1) {
            acc[i] -= 1;
            smoke.emit(w.point.x, w.point.y + 0.25, w.point.z, car.vel.x * 0.25, 0.2, car.vel.z * 0.25, 0.55 + s * 0.4, 1.6 + s * 1.4);
          }
        } else acc[i] = 0;
      }
    },
    update(dt) {
      const r = engine.get<RenderApi>('render');
      if (r) smoke.tint(r.night, r.hazeColor);
      smoke.update(dt);
    },
  };
  engine.events.on('vehicle:reset', () => { /* keep marks: they are the record of your driving */ });
  engine.add(api);
}
