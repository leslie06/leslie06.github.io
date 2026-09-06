import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { AmbientVolume } from './AmbientVolume';
import type { LevelApi } from '../game/Contracts';

/**
 * Sun + cascaded shadow maps + ambient.
 *
 * - One CSM (three/examples/jsm/csm) with `quality.shadowCascades` cascades of `quality.csmMapSize`
 *   texels each, practical split, fade between cascades. The PCF lookup is replaced globally with a
 *   wider vogel-disk kernel (`quality.shadowPcfTaps` hardware-filtered taps) whose radius is set per
 *   cascade so the penumbra is a few cm at the feet of props and widens with distance. Bias is derived
 *   per cascade from the texel footprint so the near cascade stays crisp without acne.
 * - Every lit material that appears in `engine.scene` is hooked automatically (CSM needs a define +
 *   uniforms per material). Existing `onBeforeCompile` hooks from other modules are chained.
 * - A HemisphereLight supplies the warm ground bounce / cool sky term the IBL alone lacks, so shaded
 *   sides never fall to dead grey-blue.
 * - Interior handling: an `AmbientVolume` (coarse "can this point see sky" grid, auto-probed once the
 *   level exists) occludes indirect light per world position, so a room sits 1.5-2 stops under the street
 *   while the sunlit doorway seen from inside keeps full exposure and the sun still lands on the floor.
 *   `indoor` (0..1, the camera's own enclosure) is read from the same volume and drives the sun shafts.
 *   The world module can override the auto probe with `setInteriorVolumes` / `setAmbientBounds`.
 * - The viewmodel scene gets its own directional light + shadow that tracks the same sun.
 */
export class Lighting implements System {
  name = 'lighting';
  csm: CSM;
  sunDir = new THREE.Vector3(0.3, 0.5, 0.8).normalize();
  sunColor = new THREE.Color(1, 0.9, 0.75);
  sunIntensity = 4;
  /** Weapon-scene sun (no cascades, one tight shadow map around the camera). */
  vmSun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  vmHemi: THREE.HemisphereLight;
  /** Indirect-light occlusion volume (interiors). */
  ambient: AmbientVolume;
  /** 0 outdoors .. 1 fully enclosed, at the camera. Smoothed. */
  indoor = 0;
  private hemiIntensity = 0.55;
  private envIntensity = 0.4;
  private volumes: THREE.Box3[] = [];
  private hooks = new WeakMap<THREE.Material, (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void>();
  private unlit = new WeakSet<THREE.Material>();
  private lastFov = 0; private lastAspect = 0;
  /** Multiplier on the viewmodel's own lights while the camera is enclosed (see applyIndoor). */
  private vmIndoor = 1;
  private tmpQ = new THREE.Quaternion(); private tmpV = new THREE.Vector3(); private tmpP = new THREE.Vector3(); private tmpC = new THREE.Color();
  private skyTint = new THREE.Color(0.55, 0.66, 0.86); private groundTint = new THREE.Color(0.48, 0.38, 0.25);
  private static pcfPatched = false;

  constructor(private engine: Engine) {
    const q = engine.quality;
    const r = engine.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    Lighting.patchPcf(q.shadowPcfTaps);
    const cascades = Math.max(1, Math.min(4, q.shadowCascades));
    this.csm = new CSM({
      camera: engine.camera,
      parent: engine.scene,
      cascades,
      maxFar: q.shadowDistance,
      mode: 'practical',
      shadowMapSize: q.csmMapSize,
      lightDirection: this.sunDir.clone().negate(),
      lightIntensity: this.sunIntensity,
      lightNear: 1,
      lightFar: q.shadowDistance * 2.2 + 80,
      lightMargin: 80,
    });
    this.csm.fade = true;
    this.csm.updateFrustums();
    this.applySun();
    this.refreshBias();

    this.ambient = new AmbientVolume(engine);
    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.66, 0.86), new THREE.Color(0.48, 0.38, 0.25), this.hemiIntensity);
    engine.scene.add(this.hemi);
    this.vmHemi = new THREE.HemisphereLight(this.hemi.color, this.hemi.groundColor, this.hemiIntensity);
    engine.viewmodelScene.add(this.vmHemi);

    this.vmSun = new THREE.DirectionalLight(this.sunColor, this.sunIntensity);
    this.vmSun.castShadow = true;
    this.vmSun.shadow.mapSize.set(1024, 1024);
    const vs = this.vmSun.shadow.camera;
    vs.near = 0.05; vs.far = 6; vs.left = vs.bottom = -1.5; vs.right = vs.top = 1.5;
    this.vmSun.shadow.bias = -0.0002; this.vmSun.shadow.normalBias = 0.01; this.vmSun.shadow.radius = 2;
    engine.viewmodelScene.add(this.vmSun, this.vmSun.target);
  }

  /**
   * Replaces three's 5-tap PCF with an N-tap vogel disk (still hardware-compared, so each tap is a
   * 4-texel bilinear compare). Must run before the first lit material compiles.
   */
  private static patchPcf(taps: number): void {
    if (Lighting.pcfPatched || taps <= 5) { Lighting.pcfPatched = true; return; }
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    const start = chunk.indexOf('shadow = (\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi )');
    const end = chunk.indexOf(') * 0.2;', start);
    if (start < 0 || end < 0) { Lighting.pcfPatched = true; return; }
    const body = `shadow = 0.0;
				for ( int i = 0; i < ${taps}; i ++ ) {
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${taps}, phi ) * radius, shadowCoord.z ) );
				}
				shadow *= ${(1 / taps).toFixed(6)};`;
    THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + body + chunk.slice(end + ') * 0.2;'.length);
    Lighting.pcfPatched = true;
  }

  /** Called by Sky when the time of day changes. `dir` points from the scene towards the sun. */
  setSun(dir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.sunDir.copy(dir).normalize();
    this.sunColor.copy(color);
    this.sunIntensity = intensity;
    this.csm.lightDirection.copy(this.sunDir).negate();
    (this.ambient.uniforms.uAmbSunDir.value as THREE.Vector3).copy(this.sunDir);
    this.applySun();
  }

  /** Ambient terms from the sky preset: hemisphere sky/ground colours + intensity, and the IBL intensity to scale indoors. */
  setAmbient(sky: THREE.Color, ground: THREE.Color, intensity: number, envIntensity: number, bounce?: THREE.Color, bounceStrength?: number): void {
    this.skyTint.copy(sky); this.groundTint.copy(ground);
    this.hemiIntensity = intensity; this.envIntensity = envIntensity;
    if (bounce) (this.ambient.uniforms.uAmbBounceColor.value as THREE.Color).copy(bounce);
    if (bounceStrength !== undefined) this.ambient.uniforms.uAmbBounceStrength.value = bounceStrength;
    this.applyIndoor();
  }

  /**
   * World module API: axis-aligned boxes of room interiors. Registered boxes are treated as fully
   * enclosed regardless of what the auto probe found (use for rooms whose roof is not a physics collider).
   */
  setInteriorVolumes(boxes: THREE.Box3[]): void { this.volumes = boxes.map((b) => b.clone()); this.ambient.stampInteriors(this.volumes); }
  addInteriorVolume(box: THREE.Box3): void { this.volumes.push(box.clone()); this.ambient.stampInteriors(this.volumes); }
  /** World module API: rebuild the ambient volume over an explicit region (defaults to LevelApi.bounds). */
  setAmbientBounds(bounds: THREE.Box3): void { this.ambient.build(bounds); }

  private applySun(): void {
    for (const l of this.csm.lights) { l.color.copy(this.sunColor); l.intensity = this.sunIntensity; }
    if (this.vmSun) { this.vmSun.color.copy(this.sunColor); this.vmSun.intensity = this.sunIntensity * this.vmIndoor; }
  }

  /**
   * Penumbra per cascade: ~3 cm at the near cascade growing with cascade distance, expressed in texels
   * of that cascade. Bias grows with the kernel so wide filters don't self-shadow on grazing surfaces.
   */
  private refreshBias(): void {
    const size = this.engine.quality.csmMapSize;
    const n = this.csm.lights.length;
    this.csm.lights.forEach((l, i) => {
      const cam = l.shadow.camera;
      const texel = (cam.right - cam.left) / size;
      const cascadeFar = this.csm.breaks[i] !== undefined ? this.csm.breaks[i] * this.csm.maxFar : (i + 1) / n * this.csm.maxFar;
      const penumbra = 0.03 + 0.0022 * cascadeFar;           // 3 cm at contact, ~30 cm at 120 m
      const radius = THREE.MathUtils.clamp(penumbra / texel, 1.5, 7);
      l.shadow.radius = radius;
      l.shadow.normalBias = THREE.MathUtils.clamp(texel * (1.0 + radius * 0.55), 0.008, 0.9);
      l.shadow.bias = -0.00005 * (1 + i * 0.5);
    });
  }

  /** Must run after all systems updated the camera and before the frame is drawn. */
  beforeRender(): void {
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    if (Math.abs(cam.fov - this.lastFov) > 0.05 || Math.abs(cam.aspect - this.lastAspect) > 1e-4) {
      this.lastFov = cam.fov; this.lastAspect = cam.aspect;
      this.csm.updateFrustums();
      this.refreshBias();
    }
    this.csm.update();
    this.hookMaterials();
    this.updateViewmodelSun();
  }

  update(dt: number): void {
    this.buildAmbient();
    // Shot mode settles with the engine paused (dt = 0); the probe must still converge, so use a nominal step.
    if (this.engine.quality.interiorProbe || this.volumes.length) this.updateIndoor(dt > 0 ? dt : 1 / 60);
  }

  /** One-off: the level is built after render/ installs, so the volume is probed on the first frame it exists. */
  private buildAmbient(): void {
    if (this.ambient.built || !this.engine.quality.interiorProbe) return;
    const level = this.engine.get<LevelApi>('level');
    if (!level || !this.engine.physics.world) return;
    const b = level.bounds;
    if (!b || b.isEmpty()) return;
    const t0 = performance.now();
    if (this.ambient.build(b)) console.info(`[lighting] ambient volume built in ${(performance.now() - t0).toFixed(0)}ms`);
  }

  /** Enclosure estimate at the camera: registered volumes if any, else 9 rays against world colliders. */
  private updateIndoor(dt: number): void {
    const cam = this.engine.camera; cam.getWorldPosition(this.tmpP);
    let target = 0;
    if (this.ambient.built) {
      target = 1 - THREE.MathUtils.smoothstep(this.ambient.sampleOpenness(this.tmpP), 0.12, 0.72);
    }
    if (this.volumes.length) {
      for (const b of this.volumes) {
        // soft containment: 1 inside, fading to 0 over 0.6 m outside the box
        const dx = Math.max(b.min.x - this.tmpP.x, 0, this.tmpP.x - b.max.x);
        const dy = Math.max(b.min.y - this.tmpP.y, 0, this.tmpP.y - b.max.y);
        const dz = Math.max(b.min.z - this.tmpP.z, 0, this.tmpP.z - b.max.z);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        target = Math.max(target, 1 - THREE.MathUtils.smoothstep(d, 0, 0.6));
      }
    } else if (!this.ambient.built) {
      const ph = this.engine.physics;
      if (!ph.world) return;
      const filter = groups(CG.ALL, CG.WORLD);
      const o = this.tmpP;
      // Ceiling: a hit within 7 m counts fully; horizontal ring of 8 rays slightly upward, hits within 9 m.
      const up = ph.raycast(o, { x: 0, y: 1, z: 0 }, 7, filter);
      const ceiling = up ? 1 - THREE.MathUtils.smoothstep(up.distance, 4.5, 7) : 0;
      let ring = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const hit = ph.raycast(o, { x: Math.cos(a) * 0.94, y: 0.34, z: Math.sin(a) * 0.94 }, 9, filter);
        if (hit) ring += 1 - THREE.MathUtils.smoothstep(hit.distance, 5, 9);
      }
      ring /= 8;
      // Need a roof to count as indoors; walls alone (alleys, courtyards) only add a little.
      target = THREE.MathUtils.clamp(ceiling * (0.55 + 0.45 * ring) + (1 - ceiling) * ring * 0.15, 0, 1);
    }
    const k = 1 - Math.exp(-dt * 9);
    this.indoor += (target - this.indoor) * k;
    if (Math.abs(target - this.indoor) < 0.002) this.indoor = target;
    this.applyIndoor();
  }

  /**
   * The spatial part of interior darkening lives in the AmbientVolume (per world position). What is left
   * here is the *viewmodel* scene, which has no world position to sample: the weapon is graded by the
   * camera's own enclosure so it doesn't stay street-lit inside a dark room.
   */
  private applyIndoor(): void {
    const t = THREE.MathUtils.smoothstep(this.indoor, 0.45, 0.95);
    const sc = this.engine.scene, vs = this.engine.viewmodelScene;
    if (sc.environment) sc.environmentIntensity = this.envIntensity;
    this.hemi.color.copy(this.skyTint); this.hemi.groundColor.copy(this.groundTint);
    this.hemi.intensity = this.hemiIntensity;
    // The weapon is lit by the room, not by the street. PostFx opens the exposure by
    // `quality.interiorExposure` when the camera is enclosed, so the viewmodel's own lights have to
    // fall by roughly the same factor or the weapon comes out as a white cut-out against a dim
    // interior (which is exactly backwards - ref_09's shotgun is the darkest thing in the frame).
    // 0.9x rather than 1x: the weapon is the closest surface to the opening and does catch its light.
    this.vmIndoor = THREE.MathUtils.lerp(1, 0.9 / Math.max(1, this.engine.quality.interiorExposure), t);
    if (vs.environment) vs.environmentIntensity = this.envIntensity * this.vmIndoor;
    this.vmHemi.color.copy(this.skyTint).lerp(this.tmpC.copy(this.skyTint).multiplyScalar(0.45), t);
    this.vmHemi.groundColor.copy(this.groundTint).lerp(this.tmpC.copy(this.groundTint).multiplyScalar(1.6), t);
    this.vmHemi.intensity = this.hemiIntensity * this.vmIndoor;
    if (this.vmSun) this.vmSun.intensity = this.sunIntensity * this.vmIndoor;
  }

  /** Sun direction expressed in the viewmodel scene's space (works whether the vm camera mirrors the world camera or sits at the origin). */
  private updateViewmodelSun(): void {
    const cam = this.engine.camera; const vcam = this.engine.viewmodelCamera;
    vcam.updateMatrixWorld();
    const d = this.tmpV.copy(this.sunDir);
    cam.getWorldQuaternion(this.tmpQ).invert(); d.applyQuaternion(this.tmpQ);
    vcam.getWorldQuaternion(this.tmpQ); d.applyQuaternion(this.tmpQ);
    const anchor = vcam.position;
    this.vmSun.target.position.copy(anchor);
    this.vmSun.position.copy(anchor).addScaledVector(d, 3);
  }

  private hookMaterials(): void {
    this.engine.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) { for (const x of m) this.hook(x); } else this.hook(m);
    });
  }

  private hook(m: THREE.Material): void {
    if (this.unlit.has(m)) return;
    const wrapped = this.hooks.get(m);
    if (wrapped) {
      // Somebody replaced onBeforeCompile after we hooked: re-chain so the cascade uniforms survive.
      if (m.onBeforeCompile !== wrapped) this.chain(m);
      return;
    }
    const mm = m as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshToonMaterial?: boolean; isShaderMaterial?: boolean; lights?: boolean };
    const lit = mm.isMeshStandardMaterial || mm.isMeshLambertMaterial || mm.isMeshPhongMaterial || mm.isMeshToonMaterial || (mm.isShaderMaterial && mm.lights);
    if (!lit) { this.unlit.add(m); return; }
    this.chain(m);
    m.needsUpdate = true;
  }

  private chain(m: THREE.Material): void {
    const prev = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    const wrapped = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
      prev.call(m, shader, renderer);
      csmHook.call(m, shader, renderer);
      this.ambient.patch(shader);
    };
    m.onBeforeCompile = wrapped;
    this.hooks.set(m, wrapped);
  }

  dispose(): void { this.csm.dispose(); this.csm.remove(); }
}
