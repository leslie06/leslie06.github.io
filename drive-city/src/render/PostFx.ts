import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAPreset, EdgeDetectionMode, type Effect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Engine } from '../core/Engine';
import type { VehicleApi } from '../game/Contracts';
import type { Look } from './TimeOfDay';
import { AtmosphereEffect } from './effects/Atmosphere';
import { CloudsEffect } from './effects/Clouds';
import { GradeEffect } from './effects/Grade';
import { LensEffect } from './effects/Lens';
import { MotionBlurEffect } from './effects/MotionBlur';
import { SunShaftsEffect } from './effects/SunShafts';

/**
 * Post chain (pmndrs/postprocessing + n8ao), ported from gunFight without the viewmodel/weapon
 * stages. Owns the final draw. Half-float buffers until tone mapping:
 *
 *   1. RenderPass              scene (sky dome at depth 1, rain, particles)
 *   2. N8AOPostPass            tier 1: half-res; tier 2: full-res (none on low)
 *   3. EffectPass "scene"      MotionBlur (car-aware) -> Clouds -> Atmosphere (height fog + aerial
 *                              perspective from the sky LUT) -> SunShafts -> Bloom -> ToneMapping
 *                              (AgX; `?tm=aces|neutral`) -> Grade
 *   4. EffectPass "aa"         SMAA, plus the lens stage (vignette, grain) when it does not sample
 *   5. EffectPass "lens"       only when sharpen/CA are on (high): they sample the AA'd image
 *
 * The renderer does not tone-map while the chain runs (`renderer.toneMapping = NoToneMapping`):
 * three only applies tone mapping and the sRGB encode when drawing to the canvas, so every
 * material, including the ShaderMaterials with `<tonemapping_fragment>` (sky, smoke, rain), writes
 * linear HDR into the composer and is tone-mapped exactly once, by the ToneMappingEffect. The
 * bypass path (`?nofx=all`) draws straight to the canvas with the renderer tone-mapping instead.
 *
 * Debug: `?nofx=ao,mb,clouds,atmo,shafts,bloom,grade,smaa,lens` drops single stages.
 */
export class PostFx {
  readonly composer: EffectComposer;
  bypass = false;
  readonly atmosphere: AtmosphereEffect;
  readonly clouds: CloudsEffect | null = null;
  readonly shafts: SunShaftsEffect | null = null;
  readonly motionBlur: MotionBlurEffect | null = null;
  readonly bloom: BloomEffect;
  readonly tone: ToneMappingEffect;
  readonly grade: GradeEffect;
  readonly smaa: SMAAEffect;
  readonly lens: LensEffect;
  readonly ao: N8AOPostPass | null = null;
  readonly toneMapping: THREE.ToneMapping;
  private carBounds: THREE.Box3 | null = null;
  /** Which model those bounds belong to: a body swap (bus, truck) rebuilds the player's model. */
  private carRoot: THREE.Object3D | null = null;
  private vehicle: VehicleApi | null | undefined;

  constructor(private engine: Engine, skyLut: THREE.Texture) {
    const r = engine.renderer, q = engine.quality, cam = engine.camera;
    const params = new URLSearchParams(location.search);
    const off = new Set((params.get('nofx') ?? '').split(',').filter(Boolean));
    this.bypass = off.has('all');
    const tm = params.get('tm');
    const mode = tm === 'aces' ? ToneMappingMode.ACES_FILMIC : tm === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX;
    this.toneMapping = tm === 'aces' ? THREE.ACESFilmicToneMapping : tm === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
    const size = r.getDrawingBufferSize(new THREE.Vector2());

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(engine.scene, cam));

    if (q.ao > 0 && !off.has('ao')) {
      const ao = new N8AOPostPass(engine.scene, cam, size.x, size.y);
      const c = ao.configuration;
      const half = q.ao === 1;
      c.aoSamples = q.aoSamples; c.aoRadius = q.aoRadius; c.distanceFalloff = 1.0; c.intensity = 1.6;
      c.denoiseSamples = half ? 6 : 8; c.denoiseRadius = half ? 4 : 6;
      c.halfRes = half; c.depthAwareUpsampling = half;
      c.screenSpaceRadius = false; c.gammaCorrection = false;
      // A cool, lifted floor: the shade side of a car or a wall stays readable, never soot-black.
      c.color = new THREE.Color(0.28, 0.31, 0.38);
      // n8ao re-enables transparencyAware on its own when it sees a transparent material (rain,
      // smoke, skid marks), which costs two extra scene renders per frame (gunFight: 60% of the AO
      // bill). Clear the auto flag directly.
      ao.autoDetectTransparency = false; c.transparencyAware = false;
      this.composer.addPass(ao);
      this.ao = ao;
    }

    const sceneFx: Effect[] = [];
    if (q.motionBlurSamples > 0 && !off.has('mb')) { this.motionBlur = new MotionBlurEffect(cam, q.motionBlurSamples); sceneFx.push(this.motionBlur); }
    if (q.cloudSteps > 0 && !off.has('clouds')) { this.clouds = new CloudsEffect(cam, q.cloudSteps); sceneFx.push(this.clouds); }
    this.atmosphere = new AtmosphereEffect(cam, skyLut);
    if (!off.has('atmo')) sceneFx.push(this.atmosphere);
    if (q.sunShafts && !off.has('shafts')) { this.shafts = new SunShaftsEffect(cam, { samples: q.tier === 'high' ? 20 : 14, resolutionScale: 0.25 }); sceneFx.push(this.shafts); }
    this.bloom = new BloomEffect({ intensity: 0.25, luminanceThreshold: 1.2, luminanceSmoothing: 0.45, mipmapBlur: true, radius: 0.75, levels: q.bloomLevels });
    if (!off.has('bloom')) sceneFx.push(this.bloom);
    this.tone = new ToneMappingEffect({ mode });
    sceneFx.push(this.tone);
    this.grade = new GradeEffect();
    if (!off.has('grade')) sceneFx.push(this.grade);
    this.composer.addPass(new EffectPass(cam, ...sceneFx));

    const presets = [SMAAPreset.LOW, SMAAPreset.MEDIUM, SMAAPreset.HIGH, SMAAPreset.ULTRA];
    this.smaa = new SMAAEffect({ preset: presets[q.smaaPreset], edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.smaa.edgeDetectionMaterial.edgeDetectionThreshold = 0.05;
    this.lens = new LensEffect({ sharpen: q.sharpen, ca: q.sharpen > 0 ? 0.7 : 0, grain: q.filmGrain });
    const aa: Effect[] = off.has('smaa') ? [] : [this.smaa];
    const lensOn = !off.has('lens');
    if (lensOn && !this.lens.samples) aa.push(this.lens);
    if (aa.length) this.composer.addPass(new EffectPass(cam, ...aa));
    if (lensOn && this.lens.samples) this.composer.addPass(new EffectPass(cam, this.lens));

    r.toneMapping = THREE.NoToneMapping;
    this.resize();
  }

  /** Per-frame parameters from the time-of-day look. `exposure` is the smoothed exposure. */
  apply(look: Look, exposure: number, dt: number): void {
    this.engine.renderer.toneMappingExposure = exposure;
    this.atmosphere.set(look.fog);
    this.grade.set(look.grade);
    this.bloom.intensity = look.bloomIntensity;
    this.bloom.luminanceMaterial.threshold = look.bloomThreshold / exposure;
    if (this.clouds) {
      this.clouds.set(look.clouds);
    }
    if (this.shafts) {
      this.shafts.setSun(look.sunDir, look.keyColor);
      this.shafts.exposure = exposure;
      this.shafts.strength = look.keyIsMoon ? 0 : (0.08 + 0.22 * look.golden) * (1 - look.overcast) * Math.min(1, look.keyIntensity / 2);
    }
    if (this.motionBlur) this.updateMotionBlur(dt);
  }

  /** Blur scales with speed: a hint when cruising, a proper smear above ~120 km/h. */
  private updateMotionBlur(dt: number): void {
    const mb = this.motionBlur!;
    if (this.vehicle === undefined) this.vehicle = this.engine.get<VehicleApi>('vehicle') ?? null;
    const v = this.vehicle;
    if (!v) { mb.car = null; mb.intensity = 0.25; return; }
    if (!this.carBounds || this.carRoot !== v.model.root) {
      // The car's bounds in its root frame, shrunk off the ground so the road under it is never
      // treated as car.
      const root = v.model.root;
      root.updateMatrixWorld(true);
      const inv = root.matrixWorld.clone().invert();
      const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
        box.union(tmp);
      });
      box.expandByVector(new THREE.Vector3(0.08, 0.08, 0.08));
      box.min.y += 0.1;
      this.carBounds = box;
      this.carRoot = v.model.root;
      mb.setCarBounds(box);
    }
    mb.car = v.model.root.matrixWorld;
    const kmh = v.car.speed * 3.6;
    mb.intensity = dt > 0 ? 0.2 + 0.55 * THREE.MathUtils.smoothstep(kmh, 40, 150) : 0;
  }

  render(dt: number): void {
    const r = this.engine.renderer;
    if (this.bypass) {
      const prevTm = r.toneMapping;
      r.toneMapping = this.toneMapping;
      r.autoClear = true;
      r.setRenderTarget(null);
      r.render(this.engine.scene, this.engine.camera);
      r.toneMapping = prevTm;
      return;
    }
    r.toneMapping = THREE.NoToneMapping;
    // Fullscreen passes overwrite their whole target; letting three clear before each is wasted bandwidth.
    const prevAuto = r.autoClear;
    r.autoClear = false;
    this.composer.render(dt);
    r.autoClear = prevAuto;
  }

  /** Passing the renderer's current CSS size makes the composer resize its targets without touching the canvas. */
  resize(): void {
    const s = this.engine.renderer.getSize(new THREE.Vector2());
    this.composer.setSize(s.x, s.y, false);
  }
}
