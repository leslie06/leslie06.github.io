import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAPreset, EdgeDetectionMode, DepthCopyPass } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Engine, System } from '../core/Engine';
import type { Sky, SkyState } from './Sky';
import type { PlayerApi, WeaponsApi } from '../game/Contracts';
import { AtmosphereEffect } from './effects/Atmosphere';
import { CloudsEffect } from './effects/Clouds';
import { MotionBlurEffect } from './effects/MotionBlur';
import { ViewmodelDofEffect } from './effects/ViewmodelDof';
import { GradeEffect } from './effects/Grade';
import { LensEffect } from './effects/Lens';
import { SunShaftsEffect } from './effects/SunShafts';
import { ScopePost } from './effects/ScopePost';

/**
 * Post-processing chain (pmndrs/postprocessing + n8ao). Owns the final draw (`engine.renderFrame`).
 *
 * Pass layout (HDR half-float buffers until tone mapping):
 *   1. RenderPass(world)            - CSM-lit scene, HDRI background, sun disc
 *   2. DepthCopyPass                - world-only depth for soft particles (off until sceneDepth())
 *   3. N8AOPostPass x2              - GTAO-style AO. A mid-range pass at `quality.aoRadius` (~0.9 m) for
 *                                     corners and recesses, then a short `quality.aoContactRadius`
 *                                     (~0.25 m) pass so contact darkening survives the denoise
 *   4. ViewmodelPass(weapon)        - drawn into the SAME buffer, no depth clear: the viewmodel camera's
 *                                     clip depth is compressed into [0, VM_DEPTH] so the weapon always wins
 *                                     the depth test against the world and every later effect can tell weapon
 *                                     pixels apart with `depth < VM_DEPTH`. It is drawn *after* AO on
 *                                     purpose - see the note on ViewmodelPass
 *   5. EffectPass "scene"           - Dof (viewmodel near field + world far field), MotionBlur, Clouds
 *                                     (lit layer over the softened HDRI), Atmosphere (height fog +
 *                                     aerial perspective), SunShafts (sky-mask radial blur), Bloom
 *                                     (threshold 1.2, soft knee), ToneMapping (ACES), Grade
 *                                     (teal/orange split tone, lifted blacks)
 *   6. EffectPass "aa"              - SMAA (preset from quality)
 *   7. EffectPass "lens"            - subtle CAS sharpen, ADS-gated radial CA, vignette (deepening on
 *                                     ADS), red edge multiply on damage, flash, luminance-scaled grain
 *
 * Public API for other modules (engine.get<PostFx>('postfx')):
 *   setAimDof(blend, focusDistance?)  0..1 near-blur on the weapon while aiming (weapons module)
 *   setAim(blend)                     0..1 ADS blend: drives CA onset/strength and the ADS vignette
 *   setWorldDof(opts)                 background defocus (blend / focus / range / maxCoc)
 *   flash(intensity, color?)          additive screen flash that decays over ~120ms (muzzle, explosions)
 *   damageVignette(amount)            0..1 red edge darkening, decays over ~1.2s (player damage)
 *   setExposure(v)                    base scene exposure (default from the time-of-day preset)
 *   setIndoor(v)                      0..1 enclosure (render/index feeds it from Lighting every frame)
 *   sceneDepth()                      world depth texture + near/far for soft particles (fx module)
 *   postProcessScope(rt, cam)         run atmosphere+tonemap+grade over a scope render target (weapons)
 *   bypass                            true = draw without the chain (A/B, debugging)
 */
export const VM_DEPTH = 0.02;

/**
 * Renders the viewmodel scene with its depth compressed into [0, VM_DEPTH].
 *
 * Ordering: this runs *after* the AO passes. n8ao renders its own depth/normals from `engine.scene`,
 * which never contains the weapon, so with the weapon drawn first the AO of whatever world geometry
 * happened to be *behind* the weapon was multiplied onto the weapon's pixels - measured at -6.8% on
 * the receiver in `world_interior` against 0% on the open street, i.e. the weapon's value changed
 * with its background. Drawing it after the AO passes leaves it untouched.
 *
 * The AO passes swap the composer's buffers, so the buffer this pass is handed may not be the one the
 * world RenderPass drew into. With an even number of swapping passes (0 or 2 AO passes - every
 * shipped tier) it is the same buffer and its depth attachment already holds the world depth. If it
 * is not, the stable depth is blitted back into it first, because the depth blit that follows this
 * pass is what feeds the world depth to the Atmosphere / DOF / shaft effects.
 */
class ViewmodelPass extends RenderPass {
  private compress = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, VM_DEPTH, VM_DEPTH - 1, 0, 0, 0, 1);
  private saved = new THREE.Matrix4();
  constructor(scene: THREE.Scene, private vmCamera: THREE.PerspectiveCamera, private composer: EffectComposer) {
    super(scene, vmCamera);
    this.clear = false;
    this.clearPass.enabled = false;
  }

  /** Copies the composer's stable world depth into `target`'s depth attachment. */
  private restoreDepth(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const src = (this.composer as unknown as { depthRenderTarget: THREE.WebGLRenderTarget | null }).depthRenderTarget;
    if (!src) { renderer.setRenderTarget(target); renderer.clearDepth(); return; }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.blitFramebuffer !== 'function') { renderer.setRenderTarget(target); renderer.clearDepth(); return; }
    renderer.setRenderTarget(target);            // force both targets to be initialised
    renderer.setRenderTarget(src); renderer.setRenderTarget(target);
    const props = renderer.properties as unknown as { get(o: unknown): { __webglFramebuffer?: WebGLFramebuffer } };
    const srcFbo = props.get(src).__webglFramebuffer;
    const dstFbo = props.get(target).__webglFramebuffer;
    if (!srcFbo || !dstFbo) { renderer.clearDepth(); return; }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, target.width, target.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    renderer.setRenderTarget(null);
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget, deltaTime?: number, stencilTest?: boolean): void {
    if (!this.renderToScreen && inputBuffer && inputBuffer !== this.composer.inputBuffer) this.restoreDepth(renderer, inputBuffer);
    const cam = this.vmCamera;
    this.saved.copy(cam.projectionMatrix);
    cam.projectionMatrix.premultiply(this.compress);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    cam.projectionMatrix.copy(this.saved);
    cam.projectionMatrixInverse.copy(this.saved).invert();
  }
}

export class PostFx implements System {
  name = 'postfx';
  composer: EffectComposer;
  bypass = false;
  bloom: BloomEffect;
  atmosphere: AtmosphereEffect;
  clouds: CloudsEffect | null = null;
  grade: GradeEffect;
  lens: LensEffect;
  tone: ToneMappingEffect;
  smaa: SMAAEffect;
  motionBlur: MotionBlurEffect | null = null;
  vmDof: ViewmodelDofEffect | null = null;
  shafts: SunShaftsEffect | null = null;
  ao: N8AOPostPass | null = null;
  contactAo: N8AOPostPass | null = null;
  private flashColor = new THREE.Color(0, 0, 0);
  private flashAmt = 0;
  private damage = 0;
  private exposure = 1;
  private indoor = 0;
  private indoorExposure = 1;
  /** 0 hipfire .. 1 fully aimed. Drives CA, the ADS vignette and (by default) the world defocus. */
  private aim = 0;
  private appliedAim = -1;
  /** True while another module is driving the ADS blend; otherwise it is read from WeaponsApi. */
  private aimExternal = false;
  /** 0..1 death grade, ramped from PlayerApi.alive. */
  private death = 0;
  private player: PlayerApi | null | undefined;
  private weapons: WeaponsApi | null | undefined;
  private worldDofFollowsAim = true;
  private scopePost: ScopePost | null = null;
  private depthPass: DepthCopyPass;

  constructor(private engine: Engine, private sky: Sky) {
    const r = engine.renderer; const q = engine.quality;
    // Debug: ?nofx=ao,dof,mb,atmo,shafts,bloom,tone,grade,smaa,lens disables individual stages.
    const off = new Set((new URLSearchParams(location.search).get('nofx') ?? '').split(',').filter(Boolean));
    const size = r.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(engine.scene, engine.camera));
    // World-only depth, copied before the weapon is drawn, for consumers that render *inside* the world
    // scene and therefore cannot sample the live depth attachment (soft particles). Disabled until
    // somebody calls sceneDepth(), so it costs nothing by default.
    this.depthPass = new DepthCopyPass({ depthPacking: THREE.BasicDepthPacking });
    this.depthPass.enabled = false;
    this.composer.addPass(this.depthPass);

    if (q.ssao && !off.has('ao')) {
      // Mid-range pass: "is this corner / recess shaded". n8ao's range check keeps occluders within
      // radius * distanceFalloff * 0.2 m, so 0.9 m / 2.4 is a ~0.43 m acceptance window.
      // The denoise `size` is a poisson blur radius in AO-buffer pixels, and halfRes doubles it in
      // full-res terms: 8 + halfRes was a ~16 px smear that erased every contact-scale occlusion before
      // it reached the frame and left depth-aware-upsample blotches around strong depth steps.
      const ao = new N8AOPostPass(engine.scene, engine.camera, size.x, size.y);
      const c = ao.configuration;
      c.aoSamples = q.aoSamples; c.denoiseSamples = q.aoDenoiseSamples; c.denoiseRadius = q.aoDenoiseRadius;
      c.aoRadius = q.aoRadius; c.distanceFalloff = 2.4; c.intensity = q.aoIntensity;
      c.halfRes = q.aoHalfRes; c.depthAwareUpsampling = q.aoHalfRes;
      c.screenSpaceRadius = false; c.gammaCorrection = false; c.transparencyAware = false;
      // The colour a fully occluded pixel is multiplied towards. Near-black crushed small props to
      // 7% luminance on their shade side; a cool ~10% floor keeps the crevice dark but readable, which
      // is what ref_05 shows in the container-lip and door-recess shadow.
      c.color = new THREE.Color(0.42, 0.45, 0.53);
      // n8ao re-enables transparencyAware by itself the moment it sees a transparent material (the sun
      // disc, decals, every particle pool), and that costs two extra full scene renders per AO pass -
      // it was 60% of the AO bill here. Setting `transparencyAware = false` does not clear the auto
      // flag when the value is already false, so clear it directly.
      ao.autoDetectTransparency = false; c.transparencyAware = false;
      this.composer.addPass(ao); this.ao = ao;

      // Contact pass: 5-30 cm. The mid-range pass cannot answer "does this drum touch the ground" -
      // its occlusion is spread over 0.9 m and the denoise then flattens the last few centimetres of
      // it. A second, short-radius pass survives the same denoise because its signal is where the
      // geometry actually meets, and n8ao composites multiplicatively so the two stack.
      if (q.aoContactRadius > 0) {
        const cao = new N8AOPostPass(engine.scene, engine.camera, size.x, size.y);
        const cc = cao.configuration;
        cc.aoSamples = q.aoContactSamples; cc.denoiseSamples = 4; cc.denoiseRadius = 2;
        cc.aoRadius = q.aoContactRadius; cc.distanceFalloff = 5.0; cc.intensity = q.aoContactIntensity;
        cc.halfRes = false; cc.depthAwareUpsampling = false;
        cc.screenSpaceRadius = false; cc.gammaCorrection = false; cc.transparencyAware = false;
        cc.denoiseIterations = 1;
        // The contact pass keeps a near-black floor: 5-30 cm from where two surfaces meet, almost no
        // light does get in, and this is the band that has to read dark for a prop to sit on the
        // ground. The broad mid-range pass carries the lifted floor instead, because that is the one
        // that was crushing whole shade faces of small props.
        cc.color = new THREE.Color(0.10, 0.11, 0.14);
        cao.autoDetectTransparency = false; cc.transparencyAware = false;
        this.composer.addPass(cao); this.contactAo = cao;
      }
    }

    this.composer.addPass(new ViewmodelPass(engine.viewmodelScene, engine.viewmodelCamera, this.composer));

    const sceneFx: Array<AtmosphereEffect | CloudsEffect | MotionBlurEffect | ViewmodelDofEffect | SunShaftsEffect | BloomEffect | ToneMappingEffect | GradeEffect> = [];
    if ((q.dof || q.dofFarCoc > 0) && !off.has('dof')) {
      this.vmDof = new ViewmodelDofEffect(engine.viewmodelCamera, VM_DEPTH, {
        farCoc: q.dofFarCoc, farFocus: q.dofFarFocus, farRange: q.dofFarRange, taps: q.tier === 'low' ? 8 : q.tier === 'medium' ? 10 : 12,
      });
      sceneFx.push(this.vmDof);
    }
    if (q.motionBlur && !off.has('mb')) { this.motionBlur = new MotionBlurEffect(engine.camera, VM_DEPTH, 8); sceneFx.push(this.motionBlur); }
    // Clouds first: the horizon haze must then act on them, and the shaft mask must see their gaps.
    if (q.clouds && !off.has('clouds')) { this.clouds = new CloudsEffect(engine.camera, q.cloudSteps); sceneFx.push(this.clouds); }
    this.atmosphere = new AtmosphereEffect(engine.camera, VM_DEPTH); if (!off.has('atmo')) sceneFx.push(this.atmosphere);
    if ((q.sunShafts || q.godRays) && !off.has('shafts') && !off.has('godrays')) {
      this.shafts = new SunShaftsEffect(engine.camera, VM_DEPTH, { samples: q.tier === 'ultra' ? 24 : 16, resolutionScale: 0.25 });
      sceneFx.push(this.shafts);
    }
    // Threshold above the weapon's specular (rail at ~1.0) with a soft knee: only the sun, emissives and flashes bloom.
    this.bloom = new BloomEffect({ intensity: 0.32, luminanceThreshold: 1.2, luminanceSmoothing: 0.55, mipmapBlur: true, radius: 0.78, levels: 6 });
    if (!off.has('bloom')) sceneFx.push(this.bloom);
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    if (!off.has('tone')) sceneFx.push(this.tone);
    this.grade = new GradeEffect(); if (!off.has('grade')) sceneFx.push(this.grade);
    this.composer.addPass(new EffectPass(engine.camera, ...sceneFx));

    const presets = [SMAAPreset.LOW, SMAAPreset.MEDIUM, SMAAPreset.HIGH, SMAAPreset.ULTRA];
    this.smaa = new SMAAEffect({ preset: presets[q.smaaPreset] ?? SMAAPreset.ULTRA, edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.smaa.edgeDetectionMaterial.edgeDetectionThreshold = 0.04;
    if (!off.has('smaa')) this.composer.addPass(new EffectPass(engine.camera, this.smaa));

    this.lens = new LensEffect({ sharpen: q.sharpen ? 0.3 : 0, ca: 0, grain: q.filmGrain ? 0.018 : 0 });
    if (!off.has('lens')) this.composer.addPass(new EffectPass(engine.camera, this.lens));
    this.applyAim(true);

    r.toneMapping = THREE.NoToneMapping;
    this.exposure = r.toneMappingExposure;
    this.applySky(sky.state);
    sky.onChange.push((s) => this.applySky(s));
    this.resize();
  }

  private applySky(s: SkyState): void {
    this.atmosphere.set({
      sunDir: s.sunDir, color: s.fog.color, sunScatter: s.fog.sunScatter, density: s.fog.density,
      heightFalloff: s.fog.heightFalloff, base: s.fog.base, sunPower: s.fog.sunPower, maxFog: s.fog.maxFog,
      skyHaze: s.fog.skyHaze, desaturate: s.fog.desaturate, lift: s.fog.lift,
      skyTex: s.skyTex, skyRotation: s.skyRotation, skyMix: 1, fogTint: s.fog.tint,
    });
    this.atmosphere.setBaseDensity(s.fog.density);
    this.shafts?.setSun(s.sunDir, s.sunColor);
    this.clouds?.set({ ...s.clouds, sunColor: s.sunColor, sunDir: s.sunDir });
    this.exposure = s.exposure;
    this.applyExposure();
    // Dusk carries more contrast and saturation than noon: the light is one warm direction against a
    // cool sky, so the split-tone does the work and the midtones must not be lifted back to milk.
    if (s.tod === 'dusk') this.grade.set({ saturation: 1.03, contrast: 1.15, shadowTint: new THREE.Color(0.90, 0.95, 1.12), highlightTint: new THREE.Color(1.14, 0.99, 0.84), lift: 0.004, splitStrength: 0.8, splitBalance: 0.30 });
    else this.grade.set({ saturation: 0.97, contrast: 1.07, shadowTint: new THREE.Color(0.96, 0.99, 1.06), highlightTint: new THREE.Color(1.07, 1.0, 0.92), lift: 0.005, splitStrength: 0.7, splitBalance: 0.32 });
  }

  /**
   * Renderer exposure = the time-of-day exposure x an interior adaptation term. Interiors are lit
   * ~2 stops under the street (AmbientVolume), and a real camera / eye opens up when you step inside:
   * the room comes back to a readable level and the doorway behind it clips to white, which is the
   * whole reason ref_09 reads as an interior. Without it the opening was *darker* than the wall.
   */
  private applyExposure(): void {
    const t = THREE.MathUtils.smoothstep(this.indoor, 0.45, 0.95);
    this.indoorExposure = THREE.MathUtils.lerp(1, this.engine.quality.interiorExposure, t);
    this.engine.renderer.toneMappingExposure = this.exposure * this.indoorExposure;
    // The viewmodel scene's light rig belongs to the weapons module and does not know about the room,
    // so undo most of the adaptation on weapon pixels (exponent < 1 leaves the weapon a little
    // brighter indoors, which is what a hand-held object next to a lit opening actually does).
    this.atmosphere.viewmodelExposure = Math.pow(1 / this.indoorExposure, 0.88);
  }

  /**
   * Everything the ADS blend drives in the lens stage. Chromatic aberration is hipfire-free by
   * default (`quality.caHip` = 0): a 1 px white-on-tan line picks up visible magenta/cyan fringing
   * at anything above ~0.3 px, and CA on a bare eye is a lens artefact nobody is looking through.
   * It arrives with the sight picture instead, together with the peripheral darkening ref_03 has.
   */
  private applyAim(force = false): void {
    const q = this.engine.quality;
    const a = this.aim;
    if (!force && Math.abs(a - this.appliedAim) < 0.004) return;
    this.appliedAim = a;
    this.lens.ca = q.chromaticAberration ? THREE.MathUtils.lerp(q.caHip, q.caAds, a) : 0;
    this.lens.caOnset = THREE.MathUtils.lerp(0.90, 0.78, a);
    this.lens.vignette = { darkness: 0.14 + q.adsVignette * a, offset: THREE.MathUtils.lerp(0.40, 0.26, a) };
    // The background opens up as the sight comes to the eye: 1x defocus in hipfire, ~2.2x aimed.
    if (this.worldDofFollowsAim) this.vmDof?.setWorld({ blend: 1 + 1.2 * a });
  }

  // ---- public API -------------------------------------------------------------------------------
  /** 0..1 blend of the weapon near-blur (call every frame from the weapons module with the ADS blend). */
  setAimDof(blend: number, focusDistance?: number): void {
    if (this.engine.quality.dof) this.vmDof?.setBlend(blend, focusDistance);
    this.setAim(blend);
  }
  /**
   * 0..1 ADS blend. Drives chromatic aberration (off in hipfire, `quality.caAds` px at the corner
   * when aimed), the peripheral darkening, and - unless `setWorldDof` overrides it - how far the
   * background defocus opens up. `setAimDof` already calls this, so the weapons module only needs it
   * when the two blends differ.
   */
  setAim(blend: number): void { this.aim = THREE.MathUtils.clamp(blend, 0, 1); this.aimExternal = true; }
  /**
   * Background (world) defocus. Everything nearer than `focus` metres stays sharp; the circle of
   * confusion ramps to `maxCoc` pixels (default `quality.dofFarCoc`) over `range` metres past it.
   * `blend` scales the whole thing.
   *
   * Passing anything here pins the far field to what you set: it stops following the ADS blend until
   * `setWorldDof()` is called with no arguments, which hands it back.
   */
  setWorldDof(opts?: { blend?: number; focus?: number; range?: number; maxCoc?: number }): void {
    if (!opts) {
      this.worldDofFollowsAim = true;
      const q = this.engine.quality;
      this.vmDof?.setWorld({ focus: q.dofFarFocus, range: q.dofFarRange });
      this.applyAim(true);
      return;
    }
    this.worldDofFollowsAim = false;
    this.vmDof?.setWorld(opts);
  }
  /** Additive screen flash. `intensity` ~0.1 for a rifle muzzle, ~0.6 for a nearby explosion. */
  flash(intensity: number, color = new THREE.Color(1, 0.9, 0.7)): void {
    if (intensity <= this.flashAmt) return;
    this.flashAmt = Math.min(1.5, intensity); this.flashColor.copy(color);
  }
  /**
   * Runs the world's aerial perspective + tone map + grade over a magnified-optic render target,
   * in place. Call it from the weapons module after rendering the world into the scope target and
   * before compositing it into the viewmodel:
   *
   *   const ok = engine.get<PostFx>('postfx')?.postProcessScope(scopeRT, scopeCamera);
   *
   * Requirements: `scopeRT.depthTexture` must be set (a `THREE.DepthTexture` on the same target) and
   * `scopeCamera` must be the camera the target was rendered with. Returns false if there is no depth
   * texture, in which case nothing is touched. Without this, a 6x view of something 40 m out is the
   * only unhazed, ungraded region in the frame - the periphery around it is hazed and graded.
   */
  postProcessScope(target: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): boolean {
    if (this.bypass) return false;
    this.scopePost ??= new ScopePost();
    this.scopePost.sync(this.atmosphere.uniforms, this.grade.uniforms, this.exposure * this.indoorExposure);
    return this.scopePost.render(this.engine.renderer, target, camera);
  }

  /**
   * World-scene depth for soft particles and other depth-aware work inside the world scene.
   *
   * The live depth attachment cannot be sampled by anything drawing into the same target, so this is a
   * copy taken right after the world render pass - i.e. **one frame old** and **without the viewmodel**.
   * For a soft particle that is exactly right: fade by the distance between the fragment and the scene
   * behind it, and a frame of latency is invisible at 60 Hz.
   *
   * `texture.r` is window-space depth in [0,1] (BasicDepthPacking, no log depth). Linearise with the
   * returned near/far:
   *   `float z = (near * far) / (far - d * (far - near));`
   * The pass is off until the first call, so call it once at install and keep the result.
   */
  sceneDepth(): { texture: THREE.Texture; near: number; far: number; width: number; height: number; latencyFrames: number } | null {
    if (!this.depthPass) return null;
    this.depthPass.enabled = true;
    const s = this.engine.renderer.getSize(new THREE.Vector2());
    const cam = this.engine.camera;
    return { texture: this.depthPass.texture, near: cam.near, far: cam.far, width: s.x, height: s.y, latencyFrames: 1 };
  }

  /** 0..1 red vignette (hit feedback). Decays automatically. */
  damageVignette(amount: number): void { this.damage = Math.max(this.damage, THREE.MathUtils.clamp(amount, 0, 1)); }
  /** Base (time-of-day) exposure. The interior adaptation term multiplies this. */
  setExposure(v: number): void { this.exposure = v; this.applyExposure(); }
  getExposure(): number { return this.exposure; }
  /** Exposure actually handed to the renderer this frame (base x interior adaptation). */
  getEffectiveExposure(): number { return this.exposure * this.indoorExposure; }
  /** 0 outdoors .. 1 enclosed; drives interior exposure adaptation and sun-shaft strength. */
  setIndoor(v: number): void {
    this.indoor = THREE.MathUtils.clamp(v, 0, 1);
    if (this.shafts) { this.shafts.indoor = this.indoor; this.shafts.exposure = this.exposure * this.indoorExposure; }
    this.applyExposure();
  }

  update(dt: number): void {
    this.applyAim();
    this.updateDeath(dt);
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * 9);
      this.lens.flash.copy(this.flashColor).multiplyScalar(this.flashAmt * 0.6);
    } else this.lens.flash.setScalar(0);
    if (this.damage > 0) { this.damage = Math.max(0, this.damage - dt * 0.85); this.lens.damage = this.damage; }
    else if (this.lens.damage !== 0) this.lens.damage = 0;
  }

  /**
   * Death grade, polled from `PlayerApi.alive` rather than driven by the `player:death` event: there
   * is no matching respawn event, and a grade that can only be switched on is a grade that sticks.
   * Ramps in over ~0.9 s and back out over ~0.35 s, and pulls the weapon lying across the frame out
   * of focus with it.
   */
  private updateDeath(dt: number): void {
    if (this.player === undefined) this.player = this.engine.get<PlayerApi>('player') ?? null;
    const dead = this.player ? !this.player.alive : false;
    const target = dead ? 1 : 0;
    // Shot mode settles with dt = 0; the ramp must still converge, so use a nominal step.
    const step = dt > 0 ? dt : 1 / 60;
    this.death += (target - this.death) * (1 - Math.exp(-step * (dead ? 3.4 : 9)));
    if (Math.abs(target - this.death) < 0.004) this.death = target;
    this.applyDeath();
  }

  /** Re-asserts the death terms at draw time: the weapons module owns setAimDof and runs after us. */
  private applyDeath(): void {
    this.lens.death = this.death;
    if (this.death <= 0.01 || !this.vmDof) return;
    this.vmDof.setBlend(Math.max(this.vmDof.blend, this.death * 0.85));
    if (this.worldDofFollowsAim) this.vmDof.setWorld({ blend: 1 + 1.2 * Math.max(this.aim, this.death) });
  }

  render(dt: number): void {
    // Also here, not just in update(): the weapons module drives the ADS blend from its own update,
    // which runs after this system's (render/ installs first), so applying it at draw time keeps the
    // lens stage on the same frame as the sight picture instead of one behind it.
    // Fallback: if nobody drove the blend this frame, take it off the equipped weapon. The ADS lens
    // behaviour is a property of the sight picture, not of whether the weapons module remembered to
    // call us, and `WeaponState.aimBlend` is already the number setAimDof would be passed.
    if (!this.aimExternal) {
      this.weapons ??= this.engine.get<WeaponsApi>('weapons') ?? null;
      const b = this.weapons?.current?.aimBlend;
      if (typeof b === 'number') this.aim = THREE.MathUtils.clamp(b, 0, 1);
    }
    this.aimExternal = false;
    this.applyAim();
    if (this.death > 0.01) this.applyDeath();
    // The composer owns clearing (ClearPass); a stray autoClear=true would make the viewmodel pass wipe the world.
    this.engine.renderer.autoClear = false;
    this.composer.render(dt);
  }

  resize(): void {
    const s = this.engine.renderer.getSize(new THREE.Vector2());
    this.composer.setSize(s.x, s.y);
  }
}
