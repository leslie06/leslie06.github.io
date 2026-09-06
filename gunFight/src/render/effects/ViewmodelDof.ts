import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

/**
 * Depth of field, in one pass, with two independent regimes:
 *
 * 1. **Viewmodel near field.** The weapon is rendered with its clip depth compressed into
 *    [0, vmDepth], so its pixels are trivially identified and its own view-space distance is
 *    recovered from that range - which is why this works no matter what FOV, near or far plane the
 *    weapons module gives `engine.viewmodelCamera`. Parts closer than `uFocus` get a golden-spiral
 *    disc blur scaled by `uBlend` (weapons drives it with `setAimDof`).
 * 2. **World far field.** Geometry past `uFarFocus` gets a smaller disc blur ramping to `uFarCoc`
 *    pixels over `uFarRange` metres. This is the background half of the three-layer depth read: at
 *    2 px of CoC the far skyline stops competing for attention with the midground and the
 *    stamped window grid on it stops resolving. `uFarBlend` scales it, so the weapons module can
 *    open it up on ADS (`setWorldDof`).
 *
 * Sky pixels are never touched (the HDRI is already background-blurred and the cloud layer draws
 * after this), and the two regimes never sample across each other: a far-field gather rejects
 * samples that are much nearer than the centre, so the weapon does not bleed onto the street behind
 * it and a near foreground edge does not smear into the distance.
 */
const frag = /* glsl */`
uniform float uBlend;
uniform float uFocus;
uniform float uRadius;
uniform float uVmDepth;
uniform float uVmNear;
uniform float uVmFar;
uniform float uFarCoc;
uniform float uFarFocus;
uniform float uFarRange;
uniform float uFarBlend;

/** Golden-spiral disc gather. reject = weight applied to samples nearer than the centre. */
vec4 dofGather(const in vec2 uv, const in vec4 centre, const in float coc, const in float zc, const in float reject) {
  vec4 sum = centre; float w = 1.0;
  for (int i = 0; i < DOF_TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(DOF_TAPS));
    float a = fi * 2.39996323 + zc * 0.7;
    vec2 o = vec2(cos(a), sin(a)) * r * coc * texelSize;
    vec2 suv = uv + o;
    float sd = readDepth(suv);
    float sw = sd < uVmDepth ? reject : 1.0;
    sum += texture2D(inputBuffer, suv) * sw; w += sw;
  }
  return sum / w;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth < uVmDepth) {
    // ---- viewmodel: near-field blur on anything in front of the focus plane
    if (uBlend <= 0.001) { outputColor = inputColor; return; }
    float d = depth / uVmDepth;
    float z = -perspectiveDepthToViewZ(d, uVmNear, uVmFar);
    float near = 1.0 - smoothstep(uFocus - 0.28, uFocus + 0.02, z);
    float coc = uBlend * uRadius * (0.18 + 0.82 * near);
    if (coc < 0.6) { outputColor = inputColor; return; }
    outputColor = dofGather(uv, inputColor, coc, z, 1.0);
    return;
  }
  // ---- world: far-field defocus. Sky is left alone (already soft, and the cloud layer is drawn later).
  if (uFarCoc <= 0.0 || uFarBlend <= 0.001 || depth >= 0.99999) { outputColor = inputColor; return; }
  float z = -getViewZ(depth);
  float coc = uFarCoc * uFarBlend * smoothstep(uFarFocus, uFarFocus + uFarRange, z);
  if (coc < 0.5) { outputColor = inputColor; return; }
  // 0.25 rather than 0: a hard reject leaves a dark halo where a sharp near object cuts the blurred
  // background, because the gather then loses half its taps on one side.
  outputColor = dofGather(uv, inputColor, coc, z, 0.25);
}
`;

export class ViewmodelDofEffect extends Effect {
  constructor(vmCamera: THREE.PerspectiveCamera, vmDepth: number, opts: { farCoc: number; farFocus: number; farRange: number; taps?: number } = { farCoc: 0, farFocus: 14, farRange: 55 }) {
    super('ViewmodelDofEffect', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: new Map<string, string>([['DOF_TAPS', String(Math.max(4, Math.round(opts.taps ?? 12)))]]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uBlend', new THREE.Uniform(0)],
        ['uFocus', new THREE.Uniform(0.55)],
        ['uRadius', new THREE.Uniform(7)],
        ['uVmDepth', new THREE.Uniform(vmDepth)],
        ['uVmNear', new THREE.Uniform(vmCamera.near)],
        ['uVmFar', new THREE.Uniform(vmCamera.far)],
        ['uFarCoc', new THREE.Uniform(opts.farCoc)],
        ['uFarFocus', new THREE.Uniform(opts.farFocus)],
        ['uFarRange', new THREE.Uniform(opts.farRange)],
        ['uFarBlend', new THREE.Uniform(1)],
      ]),
    });
    this.vmCamera = vmCamera;
    this.baseFarCoc = opts.farCoc;
  }
  private vmCamera: THREE.PerspectiveCamera;
  private baseFarCoc: number;

  setBlend(blend: number, focus?: number): void {
    this.uniforms.get('uBlend')!.value = THREE.MathUtils.clamp(blend, 0, 1);
    if (focus !== undefined) this.uniforms.get('uFocus')!.value = focus;
  }
  get blend(): number { return this.uniforms.get('uBlend')!.value as number; }

  /**
   * World background defocus. `blend` scales the tier's `dofFarCoc`; `maxCoc` overrides it outright
   * (in pixels at 1080p). Everything nearer than `focus` metres stays sharp and the CoC reaches its
   * maximum `range` metres past that.
   */
  setWorld(opts: { blend?: number; focus?: number; range?: number; maxCoc?: number }): void {
    const u = this.uniforms;
    if (opts.blend !== undefined) u.get('uFarBlend')!.value = THREE.MathUtils.clamp(opts.blend, 0, 4);
    if (opts.focus !== undefined) u.get('uFarFocus')!.value = Math.max(0, opts.focus);
    if (opts.range !== undefined) u.get('uFarRange')!.value = Math.max(0.5, opts.range);
    u.get('uFarCoc')!.value = opts.maxCoc !== undefined ? Math.max(0, opts.maxCoc) : this.baseFarCoc;
  }
  get farCoc(): number { return this.uniforms.get('uFarCoc')!.value as number; }
  get farBlend(): number { return this.uniforms.get('uFarBlend')!.value as number; }

  override update(): void {
    // Re-read every frame: the weapons module owns the viewmodel camera and may change its FOV,
    // near or far plane at runtime (ADS zoom, a scope pass), and the depth decompression above is
    // only correct against the planes the frame was actually rendered with.
    this.uniforms.get('uVmNear')!.value = this.vmCamera.near;
    this.uniforms.get('uVmFar')!.value = this.vmCamera.far;
  }
}
