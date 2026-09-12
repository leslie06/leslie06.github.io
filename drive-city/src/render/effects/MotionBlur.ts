import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Camera motion blur (ported from gunFight), with the player's car handled as a moving object.
 *
 * Every pixel is reprojected with last frame's view-projection and blurred along the screen-space
 * velocity. That assumes a static world, and the car is not static: in the chase view it moves with
 * the camera, so reprojecting it as world geometry smeared the whole car as if the road were
 * sliding past at its speed. Pixels inside the car's local bounding box are therefore reprojected
 * with the car's previous transform instead (world -> car local now -> world last frame), which
 * gives the car its true screen motion (~0 in the chase view, a real smear when it drifts past a
 * fixed camera) without an extra velocity pass.
 *
 * Samples much nearer than the centre pixel are skipped, so the car's paint does not bleed into
 * the road blurring behind its silhouette. Velocity is normalised to 60 Hz.
 */
const frag = /* glsl */`
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uPrevVP;
uniform mat4 uCarInv;
uniform mat4 uCarPrev;
uniform vec3 uCarMin;
uniform vec3 uCarMax;
uniform float uCarOn;
uniform float uIntensity;
uniform float uMaxVel;
uniform float uNear;
uniform float uFar;

vec3 mbWorld(const in vec2 uv, const in float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  return (uCamWorld * vec4(v.xyz, 1.0)).xyz;
}

float mbViewZ(const in float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uIntensity <= 0.0) { outputColor = inputColor; return; }
  vec3 wp = mbWorld(uv, min(depth, 0.9999));
  vec3 prevWp = wp;
  if (uCarOn > 0.5) {
    vec3 lp = (uCarInv * vec4(wp, 1.0)).xyz;
    if (all(greaterThan(lp, uCarMin)) && all(lessThan(lp, uCarMax))) prevWp = (uCarPrev * vec4(lp, 1.0)).xyz;
  }
  vec4 pc = uPrevVP * vec4(prevWp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 vel = (uv - puv) * uIntensity;
  float l = length(vel);
  if (l < 0.0006) { outputColor = inputColor; return; }
  if (l > uMaxVel) vel *= uMaxVel / l;
  float cz = mbViewZ(depth);
  vec4 sum = inputColor; float w = 1.0;
  for (int i = 0; i < MB_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(MB_SAMPLES) - 0.5;
    vec2 suv = uv + vel * t;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    if (mbViewZ(readDepth(suv)) < cz * 0.7 - 0.4) continue;
    sum += texture2D(inputBuffer, suv); w += 1.0;
  }
  outputColor = sum / w;
}
`;

export class MotionBlurEffect extends Effect {
  private prevVP = new THREE.Matrix4();
  private curVP = new THREE.Matrix4();
  private carPrev = new THREE.Matrix4();
  private first = true;
  private carFirst = true;
  /** Shutter fraction, 0..1 (PostFx scales it with speed). */
  intensity = 0.5;
  /** World matrix of the tracked vehicle this frame, or null. */
  car: THREE.Matrix4 | null = null;

  constructor(private camera: THREE.PerspectiveCamera, samples = 8) {
    super('MotionBlurEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: new Map([['MB_SAMPLES', String(samples)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uPrevVP', new THREE.Uniform(new THREE.Matrix4())],
        ['uCarInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCarPrev', new THREE.Uniform(new THREE.Matrix4())],
        ['uCarMin', new THREE.Uniform(new THREE.Vector3(-1, -1, -1))],
        ['uCarMax', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uCarOn', new THREE.Uniform(0)],
        ['uIntensity', new THREE.Uniform(0.5)],
        ['uMaxVel', new THREE.Uniform(0.02)],
        ['uNear', new THREE.Uniform(0.3)],
        ['uFar', new THREE.Uniform(4000)],
      ]),
    });
  }

  /** Local-space bounds of the tracked car (its root's frame). */
  setCarBounds(box: THREE.Box3): void {
    (this.uniforms.get('uCarMin')!.value as THREE.Vector3).copy(box.min);
    (this.uniforms.get('uCarMax')!.value as THREE.Vector3).copy(box.max);
  }

  override update(_renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, deltaTime?: number): void {
    const c = this.camera;
    const u = this.uniforms;
    this.curVP.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    if (this.first) { this.prevVP.copy(this.curVP); this.first = false; }
    (u.get('uInvProj')!.value as THREE.Matrix4).copy(c.projectionMatrixInverse);
    (u.get('uCamWorld')!.value as THREE.Matrix4).copy(c.matrixWorld);
    (u.get('uPrevVP')!.value as THREE.Matrix4).copy(this.prevVP);
    u.get('uNear')!.value = c.near; u.get('uFar')!.value = c.far;
    const dt = deltaTime && deltaTime > 1e-4 ? deltaTime : 1 / 60;
    u.get('uIntensity')!.value = this.intensity * THREE.MathUtils.clamp((1 / 60) / dt, 0.5, 2);
    this.prevVP.copy(this.curVP);
    if (this.car) {
      if (this.carFirst) { this.carPrev.copy(this.car); this.carFirst = false; }
      (u.get('uCarInv')!.value as THREE.Matrix4).copy(this.car).invert();
      (u.get('uCarPrev')!.value as THREE.Matrix4).copy(this.carPrev);
      u.get('uCarOn')!.value = 1;
      this.carPrev.copy(this.car);
    } else u.get('uCarOn')!.value = 0;
  }
}
