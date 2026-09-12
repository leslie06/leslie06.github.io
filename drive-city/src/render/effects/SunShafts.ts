import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Screen-space sun shafts (ported from gunFight, outdoor mode only):
 *   1. mask (1/4 res): sky pixels above a display-referred threshold, weighted towards the sun;
 *   2. two radial blurs (1/4 res) along lines through the sun's vanishing point (or diverging from
 *      the anti-solar point when the sun is behind the camera);
 *   3. additive composite tinted with the sun colour, faded out when the sun is far off screen.
 * Low sun through the poplars and between the towers is where this earns its cost.
 */
const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const maskFrag = /* glsl */`
precision highp float;
uniform sampler2D tInput;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform float uThreshold;
uniform float uMaxMask;
uniform float uExposure;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
  float m = clamp(l - uThreshold, 0.0, uMaxMask);
  float sky = step(0.99999, d);
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  vec3 dir = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  float near = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  gl_FragColor = vec4(vec3(m * sky * (0.12 + 0.88 * near)), 1.0);
}
`;

const blurFrag = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uCenter;
uniform float uLength;
uniform float uDecay;
varying vec2 vUv;
void main() {
  vec2 toC = uCenter - vUv;
  float len = length(toC);
  vec2 stepv = toC / max(len, 1e-4) * min(len, uLength) / float(SHAFT_SAMPLES);
  vec3 sum = vec3(0.0); float wsum = 0.0; float w = 1.0;
  vec2 p = vUv;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    sum += texture2D(tSrc, clamp(p, vec2(0.0), vec2(1.0))).rgb * w; wsum += w;
    w *= uDecay; p += stepv;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}
`;

const compFrag = /* glsl */`
uniform sampler2D tShaft;
uniform vec3 uTint;
uniform float uIntensity;
uniform float uInvExposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 s = texture2D(tShaft, uv).rgb * uTint * (uIntensity * uInvExposure);
  outputColor = vec4(inputColor.rgb + s, inputColor.a);
}
`;

export class SunShaftsEffect extends Effect {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private maskMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.Camera();
  private depthTex: THREE.Texture | null = null;
  private scale: number;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private tmp4 = new THREE.Vector4();
  /** Composite strength, display-referred. */
  strength = 0.16;
  /** Renderer exposure, so the threshold means the same thing at noon and at dusk. */
  exposure = 1;

  constructor(private camera: THREE.PerspectiveCamera, opts: { samples?: number; resolutionScale?: number } = {}) {
    super('SunShaftsEffect', compFrag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['tShaft', new THREE.Uniform(null)],
        ['uTint', new THREE.Uniform(new THREE.Color(1, 0.9, 0.75))],
        ['uIntensity', new THREE.Uniform(0.16)],
        ['uInvExposure', new THREE.Uniform(1)],
      ]),
    });
    this.scale = opts.resolutionScale ?? 0.25;
    const samples = opts.samples ?? 16;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.rtA = mk(); this.rtB = mk();
    this.maskMat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: maskFrag, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uSunDir: { value: this.sunDir }, uThreshold: { value: 0.95 }, uMaxMask: { value: 3.0 }, uExposure: { value: 1 } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: blurFrag, depthTest: false, depthWrite: false, defines: { SHAFT_SAMPLES: String(samples) },
      uniforms: { tSrc: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uLength: { value: 0.1 }, uDecay: { value: 0.95 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.uniforms.get('tShaft')!.value = this.rtA.texture;
  }

  setSun(dir: THREE.Vector3, color: THREE.Color): void {
    this.sunDir.copy(dir).normalize();
    (this.uniforms.get('uTint')!.value as THREE.Color).copy(color);
  }

  override setDepthTexture(depthTexture: THREE.Texture, _depthPacking?: THREE.DepthPackingStrategies): void {
    this.depthTex = depthTexture;
    this.maskMat.uniforms.tDepth.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width * this.scale)), h = Math.max(1, Math.floor(height * this.scale));
    this.rtA.setSize(w, h); this.rtB.setSize(w, h);
  }

  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    const cam = this.camera;
    this.uniforms.get('uInvExposure')!.value = 1 / Math.max(this.exposure, 1e-3);
    this.maskMat.uniforms.uExposure.value = this.exposure;
    if (!this.depthTex || this.strength <= 0) { this.uniforms.get('uIntensity')!.value = 0; return; }
    const v = this.tmp4.set(this.sunDir.x, this.sunDir.y, this.sunDir.z, 0).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    let cx: number, cy: number;
    if (Math.abs(v.w) < 1e-3) { const l = Math.hypot(v.x, v.y) || 1; cx = 0.5 + (v.x / l) * 50; cy = 0.5 + (v.y / l) * 50; }
    else { cx = (v.x / v.w) * 0.5 + 0.5; cy = (v.y / v.w) * 0.5 + 0.5; }
    const off = Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5));
    this.uniforms.get('uIntensity')!.value = this.strength * (1 - THREE.MathUtils.smoothstep(off, 1.2, 3.0));

    const mu = this.maskMat.uniforms;
    mu.tInput.value = inputBuffer.texture;
    (mu.uInvProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (mu.uCamWorld.value as THREE.Matrix4).copy(cam.matrixWorld);

    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtA); renderer.render(this.quadScene, this.quadCam);
    const bu = this.blurMat.uniforms;
    (bu.uCenter.value as THREE.Vector2).set(cx, cy);
    this.quad.material = this.blurMat;
    bu.tSrc.value = this.rtA.texture; bu.uLength.value = 0.06; bu.uDecay.value = 0.97;
    renderer.setRenderTarget(this.rtB); renderer.render(this.quadScene, this.quadCam);
    bu.tSrc.value = this.rtB.texture; bu.uLength.value = 0.55; bu.uDecay.value = 0.9;
    renderer.setRenderTarget(this.rtA); renderer.render(this.quadScene, this.quadCam);
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
  }

  override dispose(): void {
    this.rtA.dispose(); this.rtB.dispose(); this.maskMat.dispose(); this.blurMat.dispose(); this.quad.geometry.dispose();
    super.dispose();
  }
}
