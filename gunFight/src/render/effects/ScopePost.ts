import * as THREE from 'three';

/**
 * Standalone copy of the scene post chain's *image* stages (aerial perspective -> ACES -> grade),
 * runnable over an arbitrary render target instead of the composer's buffers.
 *
 * Why it exists: a magnified optic renders the world through its own camera into its own target, which
 * never touches the main composer. Without this, a 6x view of something 40 m out comes back at full
 * contrast and full saturation while the unmagnified periphery around it is hazed - the single most
 * obvious tell that the scope is a different renderer. Real glass shows *more* aerial perspective, not
 * less, because it is looking further.
 *
 * Contract for the weapons module (see PostFx.postProcessScope):
 *   - render the world into a `WebGLRenderTarget` that has a `depthTexture` (DepthTexture, UnsignedInt
 *     or Float), using the scope's own PerspectiveCamera;
 *   - call `engine.get<PostFx>('postfx').postProcessScope(target, scopeCamera)` before compositing the
 *     target into the viewmodel;
 *   - the target's texture is replaced in place, so nothing else in the weapons module has to change.
 * The pass is a no-op when the target has no depth texture.
 */
const frag = /* glsl */`
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uFogTint;
uniform vec3 uSunScatter;
uniform float uDensity;
uniform float uHeightFalloff;
uniform float uHeightBase;
uniform float uSunPower;
uniform float uMaxFog;
uniform float uSkyHaze;
uniform float uDesat;
uniform float uLift;
uniform sampler2D uSkyTex;
uniform float uSkyRot;
uniform float uSkyMix;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uLiftGrade;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplitBalance;
uniform float uSplitStrength;
uniform float uSrgbIO;
varying vec2 vUv;

// The caller's target may be an 8-bit sRGB texture (three encodes on write for lit materials but a
// raw ShaderMaterial does not), so decode on read and re-encode on write when it is.
vec3 scopeSrgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 scopeLinearToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(vec3(0.0031308), c)); }

float scopeLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 scopeSky(vec3 dir) {
  float c = cos(uSkyRot), s = sin(uSkyRot);
  vec3 d = vec3(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
  vec2 uv = vec2(atan(d.z, d.x) * 0.1591549431 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.3183098862 + 0.5);
  return texture2D(uSkyTex, uv).rgb;
}

// three's ACES fit (RRT+ODT), matching ToneMappingEffect's ACES_FILMIC mode.
vec3 scopeAces(vec3 color) {
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  color *= uExposure / 0.6;
  color = ACESIn * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = ACESOut * (a / b);
  return clamp(color, 0.0, 1.0);
}

void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  if (uSrgbIO > 0.5) c = scopeSrgbToLinear(c);
  float depth = texture2D(tDepth, vUv).r;
  if (depth < 0.99999) {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 v = uInvProj * ndc; v.xyz /= v.w;
    vec3 wp = (uCamWorld * vec4(v.xyz, 1.0)).xyz;
    vec3 ray = wp - uCamPos;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-4);
    float k = uHeightFalloff;
    float dy = wp.y - uCamPos.y;
    float startDens = uDensity * exp(-k * (uCamPos.y - uHeightBase));
    float integ = abs(k * dy) > 1e-3 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
    float od = startDens * integ * dist;
    float fog = min(1.0 - exp(-od), uMaxFog);
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), uSunPower);
    vec3 base = mix(uFogColor, scopeSky(dir) * uFogTint, uSkyMix);
    vec3 fogCol = base + uSunScatter * sunAmt;
    float ap = 1.0 - exp(-od * 1.6);
    float l = scopeLum(c);
    c = mix(c, vec3(l), uDesat * ap);
    c += base * (uLift * ap);
    c = mix(c, fogCol, fog);
  }
  c = scopeAces(c);
  float l2 = scopeLum(c);
  c = mix(vec3(l2), c, uSaturation);
  c = (c - 0.18) * uContrast + 0.18;
  c = max(c, 0.0);
  float t = smoothstep(0.0, uSplitBalance, scopeLum(c));
  c *= mix(vec3(1.0), mix(uShadowTint, uHighlightTint, t), uSplitStrength);
  c = c * (1.0 - uLiftGrade) + uLiftGrade;
  c = clamp(c, 0.0, 1.0);
  if (uSrgbIO > 0.5) c = scopeLinearToSrgb(c);
  gl_FragColor = vec4(c, 1.0);
}
`;

/** Plain copy, used to write the graded result back into the caller's own colour attachment. */
const copyFrag = /* glsl */`
precision highp float;
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

export class ScopePost {
  private mat: THREE.ShaderMaterial;
  private copyMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.Camera();
  private rt: THREE.WebGLRenderTarget | null = null;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: frag, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFogColor: { value: new THREE.Color() }, uFogTint: { value: new THREE.Color(1, 1, 1) },
        uSunScatter: { value: new THREE.Color() }, uDensity: { value: 0.002 }, uHeightFalloff: { value: 0.009 }, uHeightBase: { value: 0 },
        uSunPower: { value: 6 }, uMaxFog: { value: 0.97 }, uSkyHaze: { value: 0.3 }, uDesat: { value: 0.34 }, uLift: { value: 0.1 },
        uSkyTex: { value: null }, uSkyRot: { value: 0 }, uSkyMix: { value: 0 }, uExposure: { value: 1 },
        uSaturation: { value: 0.97 }, uContrast: { value: 1.07 }, uLiftGrade: { value: 0.005 },
        uShadowTint: { value: new THREE.Color(0.96, 0.99, 1.06) }, uHighlightTint: { value: new THREE.Color(1.07, 1, 0.92) },
        uSplitBalance: { value: 0.32 }, uSplitStrength: { value: 0.7 }, uSrgbIO: { value: 0 },
      },
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: copyFrag, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Copies the current atmosphere + grade uniforms so the scope matches the frame around it exactly. */
  sync(src: Map<string, THREE.Uniform>, grade: Map<string, THREE.Uniform>, exposure: number): void {
    const u = this.mat.uniforms;
    const copy = (from: Map<string, THREE.Uniform>, key: string, to: string) => {
      const v = from.get(key)?.value;
      if (v === undefined) return;
      const dst = u[to].value;
      if (dst && (dst as THREE.Color).isColor) (dst as THREE.Color).copy(v as THREE.Color);
      else if (dst && (dst as THREE.Vector3).isVector3) (dst as THREE.Vector3).copy(v as THREE.Vector3);
      else u[to].value = v;
    };
    for (const k of ['uSunDir', 'uFogColor', 'uFogTint', 'uSunScatter', 'uDensity', 'uHeightFalloff', 'uHeightBase', 'uSunPower', 'uMaxFog', 'uSkyHaze', 'uDesat', 'uLift', 'uSkyTex', 'uSkyRot', 'uSkyMix']) copy(src, k, k);
    copy(grade, 'uSaturation', 'uSaturation'); copy(grade, 'uContrast', 'uContrast');
    copy(grade, 'uLift', 'uLiftGrade'); copy(grade, 'uShadowTint', 'uShadowTint');
    copy(grade, 'uHighlightTint', 'uHighlightTint'); copy(grade, 'uSplitBalance', 'uSplitBalance');
    copy(grade, 'uSplitStrength', 'uSplitStrength');
    u.uExposure.value = exposure;
  }

  /**
   * Runs the pass over `target` in place. Returns false if the target carries no depth texture.
   *
   * Two passes, never a texture swap. Swapping `target.texture` with the scratch target's texture does
   * NOT move the GL colour attachment with it: on the second call `tColor` would be the texture
   * physically attached to the framebuffer being drawn into, which is a feedback loop
   * (`GL_INVALID_OPERATION: Feedback loop formed between Framebuffer and active Texture`) and shows the
   * caller the previous frame. It also churns `material.map` identity every frame, forcing a recompile.
   * So: grade into scratch, then copy scratch back into the caller's own attachment. The caller's
   * `target.texture` object is never touched, which makes this re-entrant and safe for any number of
   * scopes per frame.
   */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): boolean {
    const depth = target.depthTexture;
    if (!depth) return false;
    const w = target.width, h = target.height;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: target.texture.type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
      this.rt.texture.colorSpace = THREE.NoColorSpace;   // scratch holds whatever we wrote, unconverted
    } else if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    camera.updateMatrixWorld();
    const u = this.mat.uniforms;
    u.tColor.value = target.texture; u.tDepth.value = depth;
    u.uSrgbIO.value = target.texture.colorSpace === THREE.SRGBColorSpace ? 1 : 0;
    (u.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.material = this.mat;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    this.copyMat.uniforms.tSrc.value = this.rt.texture;
    this.quad.material = this.copyMat;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
    this.quad.material = this.mat;
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAuto;
    return true;
  }

  dispose(): void { this.rt?.dispose(); this.mat.dispose(); this.copyMat.dispose(); this.quad.geometry.dispose(); }
}
