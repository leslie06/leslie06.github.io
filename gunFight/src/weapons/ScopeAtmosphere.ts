import * as THREE from 'three';
import type { AtmosphereParams } from '../game/Contracts';

/**
 * Applies render/'s aerial perspective to an offscreen colour+depth pair.
 *
 * A magnified optic renders the world into its own target from a narrow-FOV camera, which bypasses the
 * post chain. Round 2 of the art review called the result out: "the scope interior is rendered outside
 * the post chain ... the magnified image is visibly a different renderer from the frame around it".
 *
 * The primary fix is `RenderPostApi.postProcessScope`, which runs render/'s real chain (atmosphere +
 * ACES + grade) over the scope target in place; WeaponSystem calls that first. This class is the
 * fallback for when the post chain is disabled or the target has no depth texture: the same analytic
 * height-fog integral the Atmosphere effect uses, driven by the same `AtmosphereParams` the sky
 * publishes, so the scope is never the one unhazed region in the frame. One fullscreen pass.
 */
export class ScopeAtmosphere {
  private mat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFogColor: { value: new THREE.Color(0.6, 0.7, 0.8) }, uSunScatter: { value: new THREE.Color(0.8, 0.5, 0.3) },
        uDensity: { value: 0.004 }, uHeightFalloff: { value: 0.045 }, uHeightBase: { value: 0 },
        uSunPower: { value: 5 }, uMaxFog: { value: 0.9 }, uDesat: { value: 0.35 }, uLift: { value: 0.13 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform mat4 uInvProj; uniform mat4 uCamWorld;
        uniform vec3 uCamPos; uniform vec3 uSunDir; uniform vec3 uFogColor; uniform vec3 uSunScatter;
        uniform float uDensity; uniform float uHeightFalloff; uniform float uHeightBase;
        uniform float uSunPower; uniform float uMaxFog; uniform float uDesat; uniform float uLift;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          float depth = texture2D(tDepth, vUv).r;
          bool sky = depth >= 0.999999;
          vec4 ndc = vec4(vUv * 2.0 - 1.0, min(depth, 0.9999) * 2.0 - 1.0, 1.0);
          vec4 v = uInvProj * ndc; v.xyz /= v.w;
          vec3 wp = (uCamWorld * vec4(v.xyz, 1.0)).xyz;
          vec3 ray = wp - uCamPos;
          float dist = length(ray);
          vec3 dir = ray / max(dist, 1e-4);
          if (sky) { dist = 3000.0; wp = uCamPos + dir * dist; }
          float k = uHeightFalloff;
          float dy = wp.y - uCamPos.y;
          float startDens = uDensity * exp(-k * (uCamPos.y - uHeightBase));
          float integ = abs(k * dy) > 1e-3 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
          float od = startDens * integ * dist;
          float fog = min(1.0 - exp(-od), uMaxFog);
          float sunAmt = pow(max(dot(dir, uSunDir), 0.0), uSunPower);
          vec3 fogCol = uFogColor + uSunScatter * sunAmt;
          if (sky) { gl_FragColor = vec4(c, 1.0); return; }
          float ap = 1.0 - exp(-od * 1.6);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, vec3(l), uDesat * ap) + uFogColor * (uLift * ap);
          gl_FragColor = vec4(mix(c, fogCol, fog), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Copy `src` (with its depth texture) into `dst`, hazed to match `p`. */
  apply(r: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, cam: THREE.PerspectiveCamera, p: AtmosphereParams, sunDir: THREE.Vector3): void {
    const u = this.mat.uniforms;
    u.tColor.value = src.texture;
    u.tDepth.value = src.depthTexture;
    (u.uInvProj.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (u.uCamWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
    (u.uCamPos.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uFogColor.value as THREE.Color).copy(p.color);
    (u.uSunScatter.value as THREE.Color).copy(p.sunScatter);
    u.uDensity.value = p.density; u.uHeightFalloff.value = p.heightFalloff; u.uHeightBase.value = p.base;
    u.uSunPower.value = p.sunPower; u.uMaxFog.value = p.maxFog;
    u.uDesat.value = p.desaturate; u.uLift.value = p.lift;
    const prev = r.getRenderTarget();
    r.setRenderTarget(dst);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
  }

  dispose(): void { this.quad.geometry.dispose(); this.mat.dispose(); }
}
