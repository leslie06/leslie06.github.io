import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { Engine } from '../core/Engine';
import { patchWet, wetKind, type WetKind, type WetUniforms } from './Wet';

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;
interface Patch { hook: Hook; prev: Hook; baseKey: string; wet: WetKind | null; keyFn: () => string }

/**
 * The key light (sun by day, moon by night) with its shadows, the hemisphere fill, and the
 * per-material patches lighting needs.
 *
 * Shadows, per tier (measured in .scratch/render, see the report):
 *  - `shadowCascades` > 1: three's CSM. Its cascade boxes are sized from the camera frustum, and
 *    the chase camera's FOV opens by 16 deg with speed, which resized every cascade every frame
 *    and made all shadow edges swim while accelerating. CSM is therefore given a proxy camera that
 *    copies the real camera's transform but keeps a fixed 80 deg FOV (ratcheting wider only if the
 *    real one ever exceeds it): cascade sizes are constant, the centres are snapped to whole
 *    texels, and edges hold still under both motion and zoom.
 *  - 1: one stabilised map of `shadowMapSize` over +-`shadowExtent` m, pushed ahead of the car
 *    along the view direction and snapped to texels (the iGPU path).
 *
 * Materials: CSM needs a define and uniforms per lit material, and wet surfaces need their shader
 * patch. City tiles stream in and out with new materials, so the scene is scanned every 30 frames
 * (WeakMap, so scanning is a lookup per material) and anything new is patched, chaining whatever
 * onBeforeCompile it already has (world/ uses one for the asphalt macro variation). A material
 * rendered before the scan reaches it would otherwise sum every cascade light (3x the sun);
 * `guardUnpatched` makes such a material use only the first cascade until it is patched.
 *
 * Backdrops: world-scale unlit geometry (MeshBasicMaterial with fog off, a bounding radius over a
 * kilometre and no shader hook of its own, e.g. the yard's CBD skyline and Western Hills; or anything
 * with `material.userData.backdrop = true`; `false` opts out) is pre-hazed by its author for one time of day and would
 * glow like cardboard at night. It is multiplied by `backdrop` (current horizon / horizon when it
 * was built), so it keeps sitting in the haze from noon to midnight.
 */
const PROXY_FOV = 80;

export class Lighting {
  readonly csm: CSM | null = null;
  /** Single-map key light (low tier). */
  readonly light: THREE.DirectionalLight | null = null;
  readonly hemi: THREE.HemisphereLight;
  private proxy: THREE.PerspectiveCamera | null = null;
  private patches = new WeakMap<THREE.Material, Patch>();
  private unlit = new WeakSet<THREE.Material>();
  private backdrops = new WeakMap<THREE.Material, Hook>();
  private frame = 0;
  private lastAspect = 0;
  private softness = 0;
  private readonly keyDir = new THREE.Vector3(0, 1, 0);
  private readonly rot = new THREE.Matrix4();
  private readonly rotInv = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private static pcfPatched = false;
  private static guarded = false;

  constructor(private engine: Engine, private wet: WetUniforms, private ripples: boolean, private backdrop: { value: THREE.Color }) {
    const q = engine.quality;
    const r = engine.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    Lighting.patchPcf(q.shadowPcfTaps);
    this.hemi = new THREE.HemisphereLight(0xb8c8e0, 0x5a5048, 0.3);
    engine.scene.add(this.hemi);
    const cam = engine.camera;
    if (q.shadowCascades > 1) {
      this.proxy = new THREE.PerspectiveCamera(Math.max(PROXY_FOV, cam.fov), cam.aspect, cam.near, cam.far);
      this.csm = new CSM({
        camera: this.proxy, parent: engine.scene, cascades: q.shadowCascades, maxFar: q.shadowDistance, mode: 'practical',
        shadowMapSize: q.csmMapSize, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 1,
        lightNear: 1, lightFar: q.shadowDistance * 2.5 + 250, lightMargin: 150,
      });
      this.csm.fade = true;
      this.lastAspect = cam.aspect;
      this.csm.updateFrustums();
      Lighting.guardUnpatched();
      this.refreshBias();
    } else {
      const l = new THREE.DirectionalLight(0xffffff, 1);
      l.castShadow = true;
      l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      const ext = q.shadowExtent, sc = l.shadow.camera;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 500;
      sc.updateProjectionMatrix();
      l.shadow.bias = -0.0003;
      l.shadow.normalBias = 0.035;
      l.shadow.radius = 2;
      engine.scene.add(l, l.target);
      this.light = l;
    }
  }

  /**
   * Replace three's 5-tap PCF with an N-tap vogel disk (each tap still a hardware 2x2 compare), so
   * wide penumbrae do not band. Must run before the first lit material compiles.
   */
  private static patchPcf(taps: number): void {
    if (Lighting.pcfPatched) return;
    Lighting.pcfPatched = true;
    if (taps <= 5) return;
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    const start = chunk.indexOf('shadow = (\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi )');
    const end = chunk.indexOf(') * 0.2;', start);
    if (start < 0 || end < 0) { console.warn('[render] PCF chunk changed; keeping 5 taps'); return; }
    const body = `shadow = 0.0;
				for ( int i = 0; i < ${taps}; i ++ ) {
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${taps}, phi ) * radius, shadowCoord.z ) );
				}
				shadow *= ${(1 / taps).toFixed(6)};`;
    THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + body + chunk.slice(end + ') * 0.2;'.length);
  }

  /**
   * CSM injects a lights chunk whose fallback branch (materials without USE_CSM) sums every
   * directional light - i.e. every cascade. Make that branch use only the first cascade, so a
   * material that renders before the scan patches it is lit correctly (with near shadows) instead
   * of flashing 3x bright. The scene's only directional lights are the cascades.
   */
  private static guardUnpatched(): void {
    if (Lighting.guarded) return;
    Lighting.guarded = true;
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const marker = chunk.indexOf('!defined( USE_CSM ) && !defined( CSM_CASCADES )');
    const loop = 'for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {';
    const at = marker < 0 ? -1 : chunk.indexOf(loop, marker);
    if (at < 0) { console.warn('[render] CSM chunk changed; unpatched materials may flash bright'); return; }
    THREE.ShaderChunk.lights_fragment_begin = chunk.slice(0, at) + 'for ( int i = 0; i < 1; i ++ ) {' + chunk.slice(at + loop.length);
  }

  /** Penumbra per cascade: ~4 cm at the wheels, wider with distance; bias from the texel footprint. */
  private refreshBias(): void {
    const csm = this.csm;
    if (!csm) return;
    const size = this.engine.quality.csmMapSize;
    const n = csm.lights.length;
    csm.lights.forEach((l, i) => {
      const cam = l.shadow.camera;
      const texel = (cam.right - cam.left) / size;
      const cascadeFar = (csm.breaks[i] ?? (i + 1) / n) * csm.maxFar;
      const penumbra = (0.04 + 0.0025 * cascadeFar) * (1 + this.softness * 2.5);
      const radius = THREE.MathUtils.clamp(penumbra / texel, 1.5, 8);
      l.shadow.radius = radius;
      l.shadow.normalBias = THREE.MathUtils.clamp(texel * (1.0 + radius * 0.55), 0.01, 0.9);
      l.shadow.bias = -0.00005 * (1 + i * 0.5);
    });
  }

  /**
   * Point the key light. `dir` points from the scene towards the light. `softness` 0..1 widens the
   * penumbra (the moon, overcast).
   */
  setKey(dir: THREE.Vector3, color: THREE.Color, intensity: number, shadowIntensity: number, softness: number): void {
    this.keyDir.copy(dir).normalize();
    if (this.csm) {
      this.csm.lightDirection.copy(this.keyDir).negate();
      for (const l of this.csm.lights) { l.color.copy(color); l.intensity = intensity; l.shadow.intensity = shadowIntensity; }
      if (Math.abs(softness - this.softness) > 0.02) { this.softness = softness; this.refreshBias(); }
    } else if (this.light) {
      this.light.color.copy(color); this.light.intensity = intensity; this.light.shadow.intensity = shadowIntensity;
      this.light.shadow.radius = 2 + softness * 3;
    }
  }

  setAmbient(sky: THREE.Color, ground: THREE.Color): void {
    this.hemi.color.copy(sky); this.hemi.groundColor.copy(ground); this.hemi.intensity = 1;
  }

  /** After all systems moved the camera, before the frame is drawn. */
  beforeRender(focus: THREE.Vector3): void {
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    if (this.csm && this.proxy) {
      const p = this.proxy;
      if (cam.aspect !== this.lastAspect || cam.fov > p.fov || cam.near !== p.near || cam.far !== p.far) {
        p.fov = Math.max(PROXY_FOV, cam.fov + 2); p.aspect = cam.aspect; p.near = cam.near; p.far = cam.far;
        p.updateProjectionMatrix();
        this.lastAspect = cam.aspect;
        this.csm.updateFrustums();
        this.refreshBias();
      }
      p.matrixWorld.copy(cam.matrixWorld);
      p.matrixWorldInverse.copy(cam.matrixWorldInverse);
      this.csm.update();
    } else if (this.light) {
      // Centre the map ahead of the car (most of what is visible is in front of it), then snap the
      // centre to whole texels in light space so moving the car does not make edges crawl.
      const q = this.engine.quality;
      cam.getWorldDirection(this.fwd); this.fwd.y = 0;
      if (this.fwd.lengthSq() > 1e-6) this.fwd.normalize();
      const c = this.tmp.copy(focus).addScaledVector(this.fwd, q.shadowExtent * 0.45);
      const texel = (2 * q.shadowExtent) / q.shadowMapSize;
      this.rot.lookAt(this.keyDir, this.origin, this.up);
      this.rotInv.copy(this.rot).invert();
      c.applyMatrix4(this.rotInv);
      c.x = Math.round(c.x / texel) * texel; c.y = Math.round(c.y / texel) * texel;
      c.applyMatrix4(this.rot);
      this.light.target.position.copy(c);
      this.light.position.copy(c).addScaledVector(this.keyDir, 200);
      this.light.target.updateMatrixWorld();
    }
    if (this.frame++ % 30 === 0) this.prepare(this.engine.scene);
  }

  /**
   * Patch every lit material under `root` now. The scan does this every 30 frames anyway; call it
   * on a freshly built object (a streamed city tile) before adding it, to skip the one-frame
   * fallback lighting and a recompile.
   */
  prepare(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) { for (const x of m) this.patch(x, o); } else this.patch(m, o);
    });
  }

  private patch(m: THREE.Material, o: THREE.Object3D): void {
    if (this.unlit.has(m)) return;
    const mm = m as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshToonMaterial?: boolean; isShaderMaterial?: boolean; isMeshBasicMaterial?: boolean; lights?: boolean; fog?: boolean };
    if (mm.isMeshBasicMaterial) {
      const hook = this.backdrops.get(m);
      if (hook && m.onBeforeCompile === hook) return;
      // Auto-detected only when nobody else shades the material: a skyline with its own shader hook
      // (city/ lights its windows by uNight) already handles the time of day.
      const custom = m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
      if (hook || m.userData.backdrop === true || (m.userData.backdrop !== false && !custom && mm.fog === false && Lighting.radius(o) > 1000)) this.patchBackdrop(m);
      else this.unlit.add(m);
      return;
    }
    const standard = !!mm.isMeshStandardMaterial;
    const lit = standard || mm.isMeshLambertMaterial || mm.isMeshPhongMaterial || mm.isMeshToonMaterial || (mm.isShaderMaterial && mm.lights);
    if (!lit) { this.unlit.add(m); return; }
    const kind = standard ? wetKind(m.userData.wet) : null;
    const p = this.patches.get(m);
    const replaced = !p || m.onBeforeCompile !== p.hook;
    if (!replaced && p!.wet === kind) return;
    // Nothing to add (no cascades, not wet) and never patched: leave the material alone.
    if (!p && !this.csm && !kind) return;
    const prev: Hook = replaced ? m.onBeforeCompile : p!.prev;
    const baseKey = !replaced ? p!.baseKey : p && m.customProgramCacheKey === p.keyFn ? prev.toString() : m.customProgramCacheKey();
    let csmHook: Hook | null = null;
    if (this.csm) {
      this.csm.setupMaterial(m);
      csmHook = m.onBeforeCompile;
      if (!p) {
        // CSM keeps a strong Map of every material it set up; drop disposed ones (streamed-out tiles).
        const csm = this.csm as unknown as { shaders: Map<THREE.Material, unknown> };
        m.addEventListener('dispose', () => { csm.shaders.delete(m); });
      }
    }
    const wet = this.wet, ripples = this.ripples;
    const hook: Hook = function (this: THREE.Material, shader, renderer) {
      prev.call(this, shader, renderer);
      csmHook?.call(this, shader, renderer);
      if (kind) patchWet(shader, kind, wet, ripples);
    };
    // Every wrapper has the same source text, and three's default program cache key is
    // onBeforeCompile.toString(): without our own key, two materials with different inner hooks
    // (asphalt macro vs plain) could share one compiled program.
    const key = baseKey + (this.csm ? '|dc-csm' : '') + (kind ? `|dc-wet-${kind}${ripples ? '-r' : ''}` : '');
    const keyFn = () => key;
    m.onBeforeCompile = hook;
    m.customProgramCacheKey = keyFn;
    this.patches.set(m, { hook, prev, baseKey, wet: kind, keyFn });
    m.needsUpdate = true;
  }

  private static radius(o: THREE.Object3D): number {
    const g = (o as THREE.Mesh).geometry;
    if (!g) return 0;
    if (!g.boundingSphere) g.computeBoundingSphere();
    return (g.boundingSphere?.radius ?? 0) * o.getWorldScale(new THREE.Vector3()).x;
  }

  private patchBackdrop(m: THREE.Material): void {
    const prev: Hook = m.onBeforeCompile;
    const baseKey = m.customProgramCacheKey();
    const u = this.backdrop;
    const hook: Hook = function (this: THREE.Material, shader, renderer) {
      prev.call(this, shader, renderer);
      shader.uniforms.dcBackdrop = u;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 dcBackdrop;')
        .replace('#include <opaque_fragment>', 'outgoingLight *= dcBackdrop;\n#include <opaque_fragment>');
    };
    const key = baseKey + '|dc-backdrop';
    m.onBeforeCompile = hook;
    m.customProgramCacheKey = () => key;
    this.backdrops.set(m, hook);
    m.needsUpdate = true;
  }

  dispose(): void {
    if (this.csm) { this.csm.dispose(); this.csm.remove(); }
    if (this.light) { this.engine.scene.remove(this.light, this.light.target); this.light.dispose(); }
    this.engine.scene.remove(this.hemi);
  }
}
