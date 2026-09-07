/**
 * Every tunable quality number lives here. Nothing else hardcodes pixel ratio,
 * shadow map size, particle counts, or post-fx toggles.
 */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  shadowMapSize: number;
  shadowCascades: number;
  shadowDistance: number;
  anisotropy: number;
  postFx: boolean;
  ssao: boolean;
  bloom: boolean;
  motionBlur: boolean;
  dof: boolean;
  taa: boolean;
  volumetrics: boolean;
  ssr: boolean;
  particleBudget: number;
  decalBudget: number;
  propDensity: number;
  textureRes: 1024 | 2048;
  maxEnemies: number;
  dynamicLights: number;
  fogDistance: number;
  // --- render/ (owned by the render module) ---
  /** Per-cascade CSM shadow map resolution. */
  csmMapSize: number;
  /** n8ao sample count / half-resolution AO. */
  aoSamples: number;
  aoHalfRes: boolean;
  /** Screen-space god rays from the sun disc. */
  godRays: boolean;
  /** CAS-style sharpening after AA. */
  sharpen: boolean;
  chromaticAberration: boolean;
  filmGrain: boolean;
  /** SMAA preset: 0 low .. 3 ultra. */
  smaaPreset: 0 | 1 | 2 | 3;
  /** n8ao world-space radius (m) and strength (n8ao 'intensity' exponent). */
  aoRadius: number;
  aoIntensity: number;
  /** PCF taps per shadow lookup (hardware-filtered vogel disk). 5 = three.js default. */
  shadowPcfTaps: 5 | 8 | 12 | 16;
  /** Screen-space sun shafts through openings / cloud gaps (quarter-res radial blur). */
  sunShafts: boolean;
  /** Camera enclosure probe: darkens IBL indoors (physics raycasts, 9 per frame). */
  interiorProbe: boolean;
  /**
   * n8ao denoise blur, in pixels of the AO buffer. At `aoHalfRes` this is doubled in full-res terms,
   * so 8 + halfRes = a ~16 px smear that erases every contact-scale occlusion before it reaches the
   * frame (and leaves depth-aware-upsample blotches around strong depth steps). Keep it <= 3 at high.
   */
  aoDenoiseRadius: number;
  aoDenoiseSamples: number;
  /**
   * Second, short-range AO pass (metres). The 0.9 m pass answers "is this corner shaded"; a 5-30 cm
   * pass answers "does this drum touch the ground", which is the read that makes props sit in the world.
   * 0 disables it.
   */
  aoContactRadius: number;
  aoContactIntensity: number;
  aoContactSamples: number;
  /**
   * Exposure multiplier when the camera is fully enclosed. Interiors are lit ~2 stops under the street
   * (see `AmbientVolume`); the eye adapts, so the room comes back to a readable level and everything
   * seen through a door/window clips to white - which is what makes an interior read as an interior.
   */
  interiorExposure: number;
  /** Procedural lit cloud layer over the HDRI sky (sky pixels only, texture-free fBm). */
  clouds: boolean;
  /**
   * Samples taken through the cloud slab per pixel. 2 = the old base/top plane pair (no vertical
   * silhouette: a cell is either "there" or not, so tops and bases have the same outline). >=3 marches
   * the slab and raises the coverage threshold with height, which is what gives flat bases, domed
   * tops and per-cell height variation. Only sky pixels pay for it.
   */
  cloudSteps: number;
  /**
   * World (background) defocus, in pixels of circle of confusion at 1080p, reached at `dofFarRange`
   * metres past `dofFarFocus`. 0 disables the world branch of the DOF pass entirely; the viewmodel
   * near-blur is independent of this and is gated by `dof`.
   */
  dofFarCoc: number;
  /** Metres: everything nearer than this stays sharp. */
  dofFarFocus: number;
  /**
   * Metres past `dofFarFocus` over which the far CoC ramps to `dofFarCoc`. Long (90 m) on purpose:
   * the hero walls the camera stands 3-10 m from and the midground it fights over at 30-50 m must stay
   * crisp; what needs to stop resolving is the 100 m+ skyline.
   */
  dofFarRange: number;
  /**
   * Chromatic aberration at the frame corner, in pixels, hipfire vs. fully aimed. A 1 px
   * high-contrast line picks up visible fringing at anything above ~0.3 px, so the hipfire value is
   * 0 and the effect is an optics cue that arrives with the sight picture. Gated by
   * `chromaticAberration`.
   */
  caHip: number;
  caAds: number;
  /** Extra corner darkening at full ADS, added to the base 14% vignette (ref_03 drops 30-40%). */
  adsVignette: number;

  // --- resolution policy (core/Resolution.ts) ----------------------------------------------------
  /**
   * Adaptive resolution governor. The whole post chain is per-pixel and linear in pixel count, so
   * the frame time is set by the drawing-buffer size and nothing else: at `high` the same scene cost
   * 11 ms at 1280x720 and 61 ms at 1728x1080 on a 2x display. `pixelRatio` alone cannot know that -
   * it is picked at boot from the device, not from the machine's actual throughput - so the governor
   * measures real frame times and moves the render scale between `minRenderScale` and
   * `maxRenderScale` to hold `targetFps`. The canvas CSS size never changes; only the drawing buffer
   * does, and the browser upscales it.
   */
  adaptiveResolution: boolean;
  /** Frame rate the governor holds. It aims slightly under this (see `core/Resolution.ts`). */
  targetFps: number;
  /**
   * Bounds on the multiplier applied to `pixelRatio`. The floor is a legibility floor, not a
   * performance one: below ~0.6 of a 2x buffer (i.e. ~1.2x native) thin geometry - railings, weapon
   * rails, the reticle - starts to crawl, and no frame rate buys that back.
   */
  minRenderScale: number;
  maxRenderScale: number;

  // --- post-chain fixed cost (render/PostFx.ts) --------------------------------------------------
  /**
   * Resolution scale of the world-depth copy that feeds soft particles. The copy is a full-screen
   * pass whose only consumer fades particles over a few centimetres of depth difference, and it is
   * already one frame old; half res is free of visible cost and quarters the pass.
   */
  depthCopyScale: number;
  /**
   * Resolution scale of the bloom luminance pass (the mip pyramid is built from it). Bloom is
   * low-frequency by construction, so it does not need the full buffer to start from.
   */
  bloomScale: number;
  /** Camera motion-blur taps. Each costs a colour fetch plus a depth fetch. */
  motionBlurSamples: number;
  /** Viewmodel/world DOF taps. */
  dofSamples: number;
  /** Sun-shaft radial-blur taps, and the resolution the shaft mask is built at. */
  sunShaftSamples: number;
  sunShaftScale: number;
  /**
   * Run the short-range contact AO pass at half resolution. The contact band is 5-30 cm at 1-4 m,
   * which is 20-60 px at 2x - wide enough to survive a half-res pass with depth-aware upsampling,
   * unlike the 2-3 px it would be at a distance (where it contributes nothing anyway).
   */
  aoContactHalfRes: boolean;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low', pixelRatio: 1, shadowMapSize: 1024, shadowCascades: 1, shadowDistance: 40, anisotropy: 2,
    postFx: true, ssao: false, bloom: true, motionBlur: false, dof: false, taa: false, volumetrics: false, ssr: false,
    particleBudget: 2000, decalBudget: 64, propDensity: 0.4, textureRes: 1024, maxEnemies: 6, dynamicLights: 2, fogDistance: 120,
    csmMapSize: 1024, aoSamples: 8, aoHalfRes: true, godRays: false, sharpen: true, chromaticAberration: false, filmGrain: true, smaaPreset: 1,
    aoRadius: 0.8, aoIntensity: 2.6, shadowPcfTaps: 5, sunShafts: false, interiorProbe: true,
    aoDenoiseRadius: 4, aoDenoiseSamples: 4, aoContactRadius: 0, aoContactIntensity: 0, aoContactSamples: 0, interiorExposure: 3.6, clouds: false,
    cloudSteps: 2, dofFarCoc: 0, dofFarFocus: 14, dofFarRange: 55, caHip: 0, caAds: 0, adsVignette: 0.12,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.60, maxRenderScale: 1,
    depthCopyScale: 0.5, bloomScale: 0.5, motionBlurSamples: 0, dofSamples: 8, sunShaftSamples: 12, sunShaftScale: 0.25, aoContactHalfRes: true,
  },
  medium: {
    tier: 'medium', pixelRatio: Math.min(1.5, window.devicePixelRatio || 1), shadowMapSize: 2048, shadowCascades: 2, shadowDistance: 80, anisotropy: 4,
    postFx: true, ssao: true, bloom: true, motionBlur: false, dof: false, taa: true, volumetrics: false, ssr: false,
    particleBudget: 6000, decalBudget: 128, propDensity: 0.7, textureRes: 1024, maxEnemies: 10, dynamicLights: 4, fogDistance: 200,
    csmMapSize: 2048, aoSamples: 8, aoHalfRes: true, godRays: true, sharpen: true, chromaticAberration: true, filmGrain: true, smaaPreset: 2,
    aoRadius: 0.9, aoIntensity: 2.6, shadowPcfTaps: 8, sunShafts: true, interiorProbe: true,
    aoDenoiseRadius: 3, aoDenoiseSamples: 4, aoContactRadius: 0.30, aoContactIntensity: 1.6, aoContactSamples: 8, interiorExposure: 4.3, clouds: true,
    cloudSteps: 3, dofFarCoc: 2.4, dofFarFocus: 15, dofFarRange: 90, caHip: 0, caAds: 0.55, adsVignette: 0.16,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.60, maxRenderScale: 1,
    depthCopyScale: 0.5, bloomScale: 0.5, motionBlurSamples: 8, dofSamples: 10, sunShaftSamples: 16, sunShaftScale: 0.25, aoContactHalfRes: true,
  },
  high: {
    tier: 'high', pixelRatio: Math.min(2, window.devicePixelRatio || 1), shadowMapSize: 4096, shadowCascades: 3, shadowDistance: 140, anisotropy: 8,
    postFx: true, ssao: true, bloom: true, motionBlur: true, dof: true, taa: true, volumetrics: true, ssr: false,
    particleBudget: 12000, decalBudget: 256, propDensity: 1, textureRes: 2048, maxEnemies: 14, dynamicLights: 8, fogDistance: 300,
    csmMapSize: 2048, aoSamples: 12, aoHalfRes: true, godRays: true, sharpen: true, chromaticAberration: true, filmGrain: true, smaaPreset: 3,
    aoRadius: 0.9, aoIntensity: 2.85, shadowPcfTaps: 12, sunShafts: true, interiorProbe: true,
    aoDenoiseRadius: 3, aoDenoiseSamples: 8, aoContactRadius: 0.26, aoContactIntensity: 1.75, aoContactSamples: 8, interiorExposure: 4.7, clouds: true,
    cloudSteps: 4, dofFarCoc: 3.0, dofFarFocus: 15, dofFarRange: 90, caHip: 0, caAds: 0.7, adsVignette: 0.17,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.60, maxRenderScale: 1,
    depthCopyScale: 0.5, bloomScale: 0.5, motionBlurSamples: 6, dofSamples: 12, sunShaftSamples: 16, sunShaftScale: 0.25, aoContactHalfRes: true,
  },
  ultra: {
    tier: 'ultra', pixelRatio: Math.min(2, window.devicePixelRatio || 1), shadowMapSize: 4096, shadowCascades: 4, shadowDistance: 200, anisotropy: 16,
    postFx: true, ssao: true, bloom: true, motionBlur: true, dof: true, taa: true, volumetrics: true, ssr: true,
    particleBudget: 20000, decalBudget: 512, propDensity: 1, textureRes: 2048, maxEnemies: 18, dynamicLights: 12, fogDistance: 400,
    csmMapSize: 4096, aoSamples: 32, aoHalfRes: false, godRays: true, sharpen: true, chromaticAberration: true, filmGrain: true, smaaPreset: 3,
    aoRadius: 1.0, aoIntensity: 2.95, shadowPcfTaps: 16, sunShafts: true, interiorProbe: true,
    aoDenoiseRadius: 3, aoDenoiseSamples: 8, aoContactRadius: 0.24, aoContactIntensity: 1.8, aoContactSamples: 12, interiorExposure: 4.7, clouds: true,
    cloudSteps: 5, dofFarCoc: 3.4, dofFarFocus: 15, dofFarRange: 90, caHip: 0, caAds: 0.7, adsVignette: 0.17,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.70, maxRenderScale: 1,
    depthCopyScale: 0.5, bloomScale: 0.5, motionBlurSamples: 8, dofSamples: 12, sunShaftSamples: 24, sunShaftScale: 0.30, aoContactHalfRes: false,
  },
};

export function pickTier(): QualityTier {
  const q = new URLSearchParams(location.search).get('quality') as QualityTier | null;
  if (q && q in QUALITY) return q;
  const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (isMobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'high' : 'medium';
}
