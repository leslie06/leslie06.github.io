import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Camera motion blur: reprojects each pixel with last frame's view-projection and blurs along the
 * screen-space velocity. Viewmodel pixels (depth < vmDepth) are neither blurred nor sampled, so the
 * weapon stays locked to the camera. Velocity is normalised to 60 Hz so the look doesn't depend on fps.
 */
const frag = /* glsl */`
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uPrevVP;
uniform float uIntensity;
uniform float uMaxVel;
uniform float uVmDepth;

vec3 mbWorld(const in vec2 uv, const in float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  return (uCamWorld * vec4(v.xyz, 1.0)).xyz;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth < uVmDepth || uIntensity <= 0.0) { outputColor = inputColor; return; }
  vec3 wp = mbWorld(uv, min(depth, 0.9999));
  vec4 pc = uPrevVP * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 vel = (uv - puv) * uIntensity;
  float l = length(vel);
  if (l < 0.0004) { outputColor = inputColor; return; }
  if (l > uMaxVel) vel *= uMaxVel / l;
  vec4 sum = inputColor; float w = 1.0;
  for (int i = 0; i < MB_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(MB_SAMPLES) - 0.5;
    vec2 suv = uv + vel * t;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    if (readDepth(suv) < uVmDepth) continue;
    sum += texture2D(inputBuffer, suv); w += 1.0;
  }
  outputColor = sum / w;
}
`;

export class MotionBlurEffect extends Effect {
  private prevVP = new THREE.Matrix4();
  private curVP = new THREE.Matrix4();
  private first = true;
  /** Shutter fraction, 0..1. */
  intensity = 0.55;

  constructor(private camera: THREE.PerspectiveCamera, vmDepth: number, samples = 8) {
    super('MotionBlurEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: new Map([['MB_SAMPLES', String(samples)]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uPrevVP', new THREE.Uniform(new THREE.Matrix4())],
        ['uIntensity', new THREE.Uniform(0.55)],
        ['uMaxVel', new THREE.Uniform(0.018)],
        ['uVmDepth', new THREE.Uniform(vmDepth)],
      ]),
    });
  }

  override update(_renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, deltaTime?: number): void {
    const c = this.camera;
    this.curVP.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    if (this.first) { this.prevVP.copy(this.curVP); this.first = false; }
    const u = this.uniforms;
    (u.get('uInvProj')!.value as THREE.Matrix4).copy(c.projectionMatrixInverse);
    (u.get('uCamWorld')!.value as THREE.Matrix4).copy(c.matrixWorld);
    (u.get('uPrevVP')!.value as THREE.Matrix4).copy(this.prevVP);
    const dt = deltaTime && deltaTime > 1e-4 ? deltaTime : 1 / 60;
    const norm = THREE.MathUtils.clamp((1 / 60) / dt, 0.5, 2);
    u.get('uIntensity')!.value = this.intensity * norm;
    this.prevVP.copy(this.curVP);
  }
}
