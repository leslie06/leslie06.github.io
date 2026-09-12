import * as THREE from 'three';
import { LUT_FRAG, LUT_VERT, mieBeta, type AtmoInputs } from './Atmo';
import { SKY_LUT_GLSL } from './glsl';

/**
 * The sky: a sky-view LUT rendered on the GPU from the physical atmosphere (Atmo.LUT_FRAG), a dome
 * that samples it and adds the sun disc, the moon and the stars, and an environment capture (the
 * same LUT, no disc) prefiltered with PMREM for reflections and image-based ambient.
 *
 * Costs, and why they are amortised:
 *  - the LUT is a few hundred to 32k texels of single scattering; re-rendered only when the sun,
 *    the moon or the air changed (index.ts decides), never more than once per frame;
 *  - the env capture is 6 small cube faces plus PMREM's blur chain (the expensive part), refreshed
 *    only when the sky changed by a visible amount and at most every half second, into the same
 *    render target so materials never see a new texture (no recompiles, no allocation).
 */
const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;   // on the far plane: depth 1, which is how every post effect finds sky
}`;

const DOME_FRAG = /* glsl */`
uniform sampler2D uLut;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunDisc;
uniform vec3 uMoonDisc;
uniform float uSunCos;
uniform float uMoonCos;
uniform float uStars;
uniform float uTime;
varying vec3 vDir;
${SKY_LUT_GLSL}

float skyHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 skyHash3(vec3 p) { return vec3(skyHash(p), skyHash(p + 19.19), skyHash(p + 47.77)); }
float skyNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = skyHash(vec3(i, 1.0)), b = skyHash(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = skyHash(vec3(i + vec2(0.0, 1.0), 1.0)), d = skyHash(vec3(i + 1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = texture2D(uLut, skyLutUv(d)).rgb;
#ifndef ENV_CAPTURE
  // Sun disc with limb darkening; the halo around it is Mie scattering, already in the LUT.
  float mu = dot(d, uSunDir);
  if (mu > uSunCos) {
    float r = clamp((1.0 - mu) / (1.0 - uSunCos), 0.0, 1.0);
    float limb = 1.0 - 0.55 * (1.0 - sqrt(1.0 - r));
    col += uSunDisc * limb * (1.0 - smoothstep(0.7, 1.0, r));
  }
  // Moon: an opaque disc with soft maria.
  float mm = dot(d, uMoonDir);
  if (mm > uMoonCos && uMoonDisc.g > 0.0) {
    vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, uMoonDir);
    float rad = sqrt(1.0 - uMoonCos * uMoonCos);
    vec2 q = vec2(dot(d, right), dot(d, up)) / rad;
    float r = length(q);
    float maria = skyNoise2(q * 2.3 + 4.0) * 0.6 + skyNoise2(q * 5.1 + 1.3) * 0.4;
    float shade = 0.78 + 0.22 * smoothstep(0.35, 0.7, maria);
    float a = 1.0 - smoothstep(0.86, 1.0, r);
    col = mix(col, uMoonDisc * shade * (0.85 + 0.15 * sqrt(max(1.0 - r * r, 0.0))) + col * 0.2, a);
  }
  // Stars: one per ~70 cells of a 3D grid around the sphere, projected onto it; 1-2 px, twinkling.
  if (uStars > 0.0 && d.y > 0.0) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    vec3 h = skyHash3(cell);
    float mag = skyHash(cell + 7.1);
    if (mag > 0.991) {
      vec3 sp = normalize(cell + 0.25 + 0.5 * h) * 260.0;
      float dist = length(p - sp);
      float bright = pow((mag - 0.991) / 0.009, 4.0) * 0.9 + 0.04;
      float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 5.0 * h.x) + h.y * 40.0);
      float s = bright * tw * smoothstep(0.6, 0.0, dist);
      col += mix(vec3(1.0, 0.86, 0.72), vec3(0.78, 0.86, 1.0), h.z) * s * uStars * smoothstep(0.03, 0.3, d.y);
    }
  }
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyDomeOptions { lutWidth: number; viewSteps: number; lightSteps: number; envSize: number }

export class SkyDome {
  readonly lut: THREE.WebGLRenderTarget;
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private lutMat: THREE.ShaderMaterial;
  private domeMat: THREE.ShaderMaterial;
  private envMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.Camera();
  private envScene = new THREE.Scene();
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  /** Prefiltered environment (scene.environment). Allocated by the first capture, reused after. */
  envRT: THREE.WebGLRenderTarget | null = null;

  constructor(private renderer: THREE.WebGLRenderer, opts: SkyDomeOptions) {
    const w = opts.lutWidth, h = Math.max(16, opts.lutWidth / 2);
    this.lut = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.lut.texture.name = 'skyLut';
    this.lutMat = new THREE.ShaderMaterial({
      vertexShader: LUT_VERT, fragmentShader: LUT_FRAG, depthTest: false, depthWrite: false,
      defines: { VIEW_STEPS: String(opts.viewSteps), LIGHT_STEPS: String(opts.lightSteps) },
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSunE: { value: new THREE.Color() }, uMoonE: { value: new THREE.Color() },
        uMieBeta: { value: 0.2 }, uMieG: { value: 0.78 }, uMs: { value: 0.45 }, uAlt: { value: 0.01 },
        uLP: { value: new THREE.Color() }, uAirglow: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uFill: { value: new THREE.Color() },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const domeUniforms = () => ({
      uLut: { value: this.lut.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunDisc: { value: new THREE.Color() }, uMoonDisc: { value: new THREE.Color() },
      // Game-sized bodies: sun 0.35 deg radius (real 0.27), moon 0.6 deg (real 0.26) - a real-size
      // moon is 4 px at this FOV and nobody sees it.
      uSunCos: { value: Math.cos(THREE.MathUtils.degToRad(0.35)) }, uMoonCos: { value: Math.cos(THREE.MathUtils.degToRad(0.6)) },
      uStars: { value: 0 }, uTime: { value: 0 },
    });
    this.domeMat = new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: domeUniforms(), side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.domeMat);
    this.mesh.scale.setScalar(1000);
    this.mesh.frustumCulled = false;
    // Drawn after every opaque object: early depth rejects the sky shader wherever geometry covers it.
    this.mesh.renderOrder = 1000;
    this.mesh.name = 'sky';

    this.envMat = new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: domeUniforms(), side: THREE.BackSide, depthWrite: false, depthTest: false, defines: { ENV_CAPTURE: '1' } });
    const envDome = new THREE.Mesh(this.mesh.geometry, this.envMat);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(opts.envSize, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.cubeCam = new THREE.CubeCamera(0.1, 10, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** Copy the atmosphere inputs into the LUT shader. */
  setAtmosphere(a: AtmoInputs): void {
    const u = this.lutMat.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(a.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(a.moonDir);
    (u.uSunE.value as THREE.Color).copy(a.sunE);
    (u.uMoonE.value as THREE.Color).copy(a.moonE);
    u.uMieBeta.value = mieBeta(a.aod); u.uMieG.value = a.mieG; u.uMs.value = a.ms; u.uAlt.value = a.alt;
    (u.uLP.value as THREE.Color).copy(a.lightPollution);
    (u.uAirglow.value as THREE.Color).copy(a.airglow);
    (u.uGround.value as THREE.Color).copy(a.ground);
    (u.uFill.value as THREE.Color).copy(a.fill);
  }

  /** Sun/moon discs and stars on the visible dome. */
  setBodies(sunDir: THREE.Vector3, moonDir: THREE.Vector3, sunDisc: THREE.Color, moonDisc: THREE.Color, stars: number, time: number): void {
    const u = this.domeMat.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(moonDir);
    (u.uSunDisc.value as THREE.Color).copy(sunDisc);
    (u.uMoonDisc.value as THREE.Color).copy(moonDisc);
    u.uStars.value = stars; u.uTime.value = time;
  }

  renderLut(): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.lut);
    r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(prev);
  }

  /** Re-capture the environment from the current LUT into the PMREM target. Returns its texture. */
  captureEnv(): THREE.Texture {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = true;
    this.cubeCam.update(r, this.envScene);
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
    return this.envRT.texture;
  }

  follow(camera: THREE.Camera): void { this.mesh.position.copy(camera.position); }

  dispose(): void {
    this.lut.dispose(); this.cubeRT.dispose(); this.envRT?.dispose(); this.pmrem.dispose();
    this.lutMat.dispose(); this.domeMat.dispose(); this.envMat.dispose(); this.mesh.geometry.dispose(); this.quad.geometry.dispose();
  }
}
