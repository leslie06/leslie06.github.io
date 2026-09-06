import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Screen-space sun shafts. Unlike a sun-disc god-ray pass this works from *any* bright sky pixel, so
 * light pours through a shell hole or a doorway as a visible beam, and cloud gaps give faint
 * crepuscular rays outdoors.
 *
 *   1. mask (1/4 res): sky pixels (depth == 1) -> HDR luminance above a threshold, weighted by angular
 *      closeness to the sun outdoors; indoors (`indoor` from Lighting) every opening counts.
 *   2. two radial blur passes (1/4 res, N taps each) along the lines through the vanishing point of the
 *      sun direction. With the sun in front the streaks converge on the sun; with the sun behind the
 *      camera they diverge from the anti-solar point, which is what a beam entering a room and hitting
 *      the floor does on screen.
 *   3. composite: additive, tinted with the sun colour, strength lerped by `indoor`.
 */
const maskFrag = /* glsl */`
precision highp float;
uniform sampler2D tInput;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform float uThreshold;
uniform float uMaxMask;
uniform float uIndoor;
uniform float uVmDepth;
uniform float uExposure;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d < uVmDepth) { gl_FragColor = vec4(0.0); return; }
  vec3 c = texture2D(tInput, vUv).rgb;
  // Display-referred: the buffer is scene radiance, but what makes a beam is how bright the opening
  // *looks* after exposure. Indoors the camera opens up ~2.4 stops, and a threshold in raw radiance
  // then rejected the very opening the beam comes through.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
  float m = clamp(l - uThreshold, 0.0, uMaxMask);
  // Outdoors only the sky emits shafts, weighted towards the sun. Indoors every bright pixel does: the
  // opening a beam comes through is a lit surface (a room above, a sunlit patch), not necessarily sky.
  float sky = step(0.99999, d);
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 v = uInvProj * ndc; v.xyz /= v.w;
  vec3 dir = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  float near = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  float w = mix(sky * (0.12 + 0.88 * near), 1.0, uIndoor);
  gl_FragColor = vec4(vec3(m * w), 1.0);
}
`;

const blurFrag = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uCenter;
uniform float uSign;
uniform float uLength;
uniform float uDecay;
varying vec2 vUv;
void main() {
  vec2 toC = (uCenter - vUv) * uSign;
  float len = length(toC);
  vec2 stepv = toC / max(len, 1e-4) * min(len, uLength) / float(SHAFT_SAMPLES);
  vec3 sum = vec3(0.0); float wsum = 0.0; float w = 1.0;
  vec2 p = vUv;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    vec2 q = clamp(p, vec2(0.0), vec2(1.0));
    sum += texture2D(tSrc, q).rgb * w; wsum += w;
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
uniform float uVmDepth;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // The beam is airborne dust several metres out; the weapon is 0.3 m from the eye and occludes it.
  // Adding it over viewmodel pixels washed the receiver out whenever a shaft crossed it, and coupled
  // the weapon's value to the room's AO through the mask (the mask reads the AO'd colour buffer).
  if (depth < uVmDepth) { outputColor = inputColor; return; }
  // The mask is display-referred, so undo exposure on the way back into the HDR buffer: uIntensity
  // then means the same thing whether the camera is adapted to a street or to a room.
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
  /** Outdoor / indoor composite strengths, in display-referred units. */
  outdoorIntensity = 0.16;
  indoorIntensity = 0.95;
  indoor = 0;
  /** Effective renderer exposure, so the mask threshold means the same thing in a room and on a street. */
  exposure = 1;

  constructor(private camera: THREE.PerspectiveCamera, vmDepth: number, opts: { samples?: number; resolutionScale?: number } = {}) {
    super('SunShaftsEffect', compFrag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['tShaft', new THREE.Uniform(null)],
        ['uTint', new THREE.Uniform(new THREE.Color(1, 0.9, 0.75))],
        ['uIntensity', new THREE.Uniform(0.16)],
        ['uInvExposure', new THREE.Uniform(1)],
        ['uVmDepth', new THREE.Uniform(vmDepth)],
      ]),
    });
    this.scale = opts.resolutionScale ?? 0.25;
    const samples = opts.samples ?? 16;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.rtA = mk(); this.rtB = mk();
    this.maskMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: maskFrag, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uSunDir: { value: this.sunDir }, uThreshold: { value: 0.9 }, uMaxMask: { value: 3.0 }, uIndoor: { value: 0 }, uVmDepth: { value: vmDepth }, uExposure: { value: 1 } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: blurFrag, depthTest: false, depthWrite: false, defines: { SHAFT_SAMPLES: String(samples) },
      uniforms: { tSrc: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uSign: { value: 1 }, uLength: { value: 0.1 }, uDecay: { value: 0.95 } },
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
    // Only a properly enclosed camera switches to the "any bright pixel emits" mask: half-enclosed
    // outdoor spots (alleys, behind a parapet) would otherwise smear sunlit ground into white blobs.
    const ind = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(this.indoor, 0, 1), 0.4, 0.8);
    this.uniforms.get('uIntensity')!.value = THREE.MathUtils.lerp(this.outdoorIntensity, this.indoorIntensity, ind);
    this.uniforms.get('uInvExposure')!.value = 1 / Math.max(this.exposure, 1e-3);
    this.maskMat.uniforms.uExposure.value = this.exposure;
    // Outdoors only the sky clears the bar; indoors the opening is dim next to a sunlit street, so drop it.
    this.maskMat.uniforms.uThreshold.value = THREE.MathUtils.lerp(0.95, 0.11, ind);
    if (!this.depthTex) return;
    // Vanishing point of the sun direction. clip.w < 0 => sun behind the camera => diverge from the anti-solar point.
    const v = this.tmp4.set(this.sunDir.x, this.sunDir.y, this.sunDir.z, 0).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    // With the sun in front, (x/w, y/w) is the sun's vanishing point; with it behind, the divide by a
    // negative w yields the anti-solar point. Rays converge on whichever is on screen, so always march
    // towards the centre and let distance fade it.
    let cx: number, cy: number;
    if (Math.abs(v.w) < 1e-3) { const l = Math.hypot(v.x, v.y) || 1; cx = 0.5 + (v.x / l) * 50; cy = 0.5 + (v.y / l) * 50; }
    else { cx = (v.x / v.w) * 0.5 + 0.5; cy = (v.y / v.w) * 0.5 + 0.5; }
    const sign = 1;
    // Far off-screen the rays are effectively parallel and read as a smear; fade them out (never indoors,
    // where the beam is short and anchored to the opening).
    const off = Math.max(Math.abs(cx - 0.5), Math.abs(cy - 0.5));
    this.uniforms.get('uIntensity')!.value *= THREE.MathUtils.lerp(1 - THREE.MathUtils.smoothstep(off, 1.5, 3.5), 1, ind);

    const mu = this.maskMat.uniforms;
    mu.tInput.value = inputBuffer.texture;
    (mu.uInvProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (mu.uCamWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
    mu.uIndoor.value = ind;

    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtA); renderer.render(this.quadScene, this.quadCam);
    const bu = this.blurMat.uniforms;
    (bu.uCenter.value as THREE.Vector2).set(cx, cy); bu.uSign.value = sign;
    this.quad.material = this.blurMat;
    // pass 1: short, fills the gaps; pass 2: long streak
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
