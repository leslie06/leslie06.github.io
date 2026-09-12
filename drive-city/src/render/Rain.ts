import * as THREE from 'three';
import { Rng } from '../core/Rng';

/**
 * Rain streaks: one instanced draw call of thin quads in a box that travels with the camera.
 *
 * Nothing is simulated on the CPU. Each streak has a fixed seed position in the box; the vertex
 * shader moves it by fall velocity x time and wraps it modulo the box around the camera, so the
 * field never pops as the camera moves. Streaks are stretched along the drop's velocity *relative
 * to the camera* over a ~1/16 s shutter: standing still they fall straight, at 100 km/h they rake
 * towards the lens, which sells speed as much as the motion blur does. `amount` (the rain value)
 * culls a fraction of the instances in the shader, so light rain is sparse rain, not faint rain.
 */
const VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uCamPos;
uniform vec3 uCamVel;
uniform vec3 uBox;
uniform vec3 uFall;
uniform float uTime;
uniform float uAmount;
uniform float uLen;
uniform float uWidth;
varying float vFade;
varying vec2 vUv;
void main() {
  vUv = vec2(position.x + 0.5, position.y);
  float speed = 0.85 + 0.3 * fract(aSeed.w * 7.13);
  vec3 origin = uCamPos - uBox * 0.5;
  vec3 p = aSeed.xyz * uBox + uFall * speed * uTime;
  p = origin + mod(p - origin, uBox);
  vec3 rel = uFall * speed - uCamVel;
  float relLen = max(length(rel), 1e-3);
  vec3 axis = rel / relLen;
  float len = uLen * clamp(relLen / 9.0, 0.6, 1.6);
  vec3 toCam = uCamPos - p;
  float dist = length(toCam);
  vec3 side = normalize(cross(axis, toCam / max(dist, 1e-3)));
  float keep = step(aSeed.w, uAmount);
  vec3 wp = p - axis * (position.y * len) + side * (position.x * uWidth * (1.0 + dist * 0.03));
  // Nothing within ~2 m: a streak right at the lens is a metre-long bar across the screen.
  vFade = keep * smoothstep(1.6, 4.0, dist) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, dist));
  gl_Position = keep > 0.5 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
varying vec2 vUv;
void main() {
  float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * vFade * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Rain {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private time = 0;
  private lastCam = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private first = true;

  constructor(count: number) {
    const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const rng = new Rng(4242);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = rng.range(0, 1);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      // Double-sided: the quad's winding depends on which way the camera sees the streak, and with
      // back-face culling every streak vanished while still costing its draw call.
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() }, uCamVel: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(34, 22, 34) }, uFall: { value: new THREE.Vector3(1.4, -9.5, 0.7) },
        uTime: { value: 0 }, uAmount: { value: 0 }, uLen: { value: 0.5 }, uWidth: { value: 0.009 },
        uColor: { value: new THREE.Color(0.5, 0.5, 0.5) }, uOpacity: { value: 0.35 },
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'rain';
    this.mesh.visible = false;
  }

  update(camera: THREE.Camera, dt: number, amount: number, color: THREE.Color): void {
    const u = this.mesh.material.uniforms;
    this.mesh.visible = amount > 0.01;
    camera.getWorldPosition(this.tmp);
    if (this.first) { this.lastCam.copy(this.tmp); this.first = false; }
    if (dt > 0) {
      this.time += dt;
      // Smoothed camera velocity: a teleport (reset, pose change) must not rake the streaks sideways.
      const v = this.vel.copy(this.tmp).sub(this.lastCam).divideScalar(dt);
      if (v.lengthSq() > 80 * 80) v.set(0, 0, 0);
      this.camVel.lerp(v, 1 - Math.exp(-dt * 8));
    }
    this.lastCam.copy(this.tmp);
    if (!this.mesh.visible) return;
    (u.uCamPos.value as THREE.Vector3).copy(this.tmp);
    (u.uCamVel.value as THREE.Vector3).copy(this.camVel);
    u.uTime.value = this.time;
    u.uAmount.value = Math.min(1, amount * 1.1);
    u.uOpacity.value = 0.16 + 0.14 * amount;
    (u.uColor.value as THREE.Color).copy(color);
  }

  /** Forget the camera's motion (after a teleport). */
  reset(): void { this.first = true; this.camVel.set(0, 0, 0); }
}
