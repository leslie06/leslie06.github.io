/**
 * Every tunable quality number lives here. Nothing else hardcodes pixel ratio, shadow map size or
 * particle counts.
 *
 * Tiers are picked from the GPU the renderer actually bound (see core/Gpu.ts): the user's Windows
 * desktop runs browsers on its Ryzen iGPU even though it has a discrete card, and a CPU-core
 * heuristic picks `high` there.
 */
import { type GpuInfo } from './Gpu';

export { classifyGpu, detectGpu, type GpuInfo, type GpuKind } from './Gpu';

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  /** Hardware MSAA on the default framebuffer. There is no post chain yet, so this is the only AA. */
  antialias: boolean;
  shadowMapSize: number;
  /** Half-size (m) of the sun's shadow frustum, which follows the car. */
  shadowExtent: number;
  anisotropy: number;
  /** Largest edge of a loaded file texture (Assets.fit). */
  textureRes: 512 | 1024 | 2048;
  /** Largest edge of a procedurally drawn canvas texture (Assets.compact). */
  canvasTextureRes: 1024 | 2048 | 4096;
  /** Tyre smoke particles alive at once (one instanced draw call). */
  smokeParticles: number;
  /** Skid mark quads kept before the oldest is overwritten (one draw call). */
  skidSegments: number;
  /** Trees and lamp posts around the yard. */
  propDensity: number;
  // --- resolution policy (core/Resolution.ts) ---
  adaptiveResolution: boolean;
  targetFps: number;
  minRenderScale: number;
  maxRenderScale: number;
  /** Drawing-buffer cap in megapixels, applied before the governor. */
  maxPixels: number;
  /** Presented frames per second, 0 = display refresh. `?fps=N` overrides. */
  frameCap: number;
  // --- render/ (post chain, sky, shadows, weather). `shadowMapSize`/`shadowExtent` above are the
  // single-map path used when shadowCascades is 1. ---
  /** Sun/moon shadow cascades. 1 = one stabilised map around the car (no CSM). */
  shadowCascades: number;
  /** Map size of each cascade when shadowCascades > 1. */
  csmMapSize: number;
  /** Reach (m) of the cascades from the camera. */
  shadowDistance: number;
  /** Hardware-filtered PCF taps per shadow lookup (5 = three's default kernel). */
  shadowPcfTaps: number;
  /** Screen-space AO (n8ao): 0 off, 1 one half-res pass, 2 one full-res pass. */
  ao: 0 | 1 | 2;
  aoSamples: number;
  /** AO radius (m). */
  aoRadius: number;
  /** Bloom mip levels (each level is a down + up blur pass at falling resolution). */
  bloomLevels: number;
  /** SMAA preset 0 low .. 3 ultra. */
  smaaPreset: 0 | 1 | 2 | 3;
  /** Camera motion-blur taps, 0 = off. */
  motionBlurSamples: number;
  /** Cloud-layer march steps, 0 = no cloud layer. */
  cloudSteps: number;
  sunShafts: boolean;
  /** Film grain amplitude, 0 = off. */
  filmGrain: number;
  /** CAS sharpen strength, 0 = off (it costs a pass of its own). */
  sharpen: number;
  /** Sky-view LUT width (height is half) and view-ray steps of the scattering integral. */
  skyLutSize: number;
  skySteps: number;
  /** Environment cube face size (reflections and image-based ambient, PMREM input). */
  envSize: number;
  /** Rain streak quads (one draw call). */
  rainStreaks: number;
  /** Rain ripples in puddles (wet-surface patch). */
  wetRipples: boolean;
}

const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low', pixelRatio: 1, antialias: true, shadowMapSize: 1024, shadowExtent: 40, anisotropy: 2,
    textureRes: 512, canvasTextureRes: 1024, smokeParticles: 160, skidSegments: 1500, propDensity: 0.5,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.6, maxRenderScale: 1, maxPixels: 1.6, frameCap: 60,
    shadowCascades: 1, csmMapSize: 1024, shadowDistance: 40, shadowPcfTaps: 5, ao: 0, aoSamples: 8, aoRadius: 1.2,
    bloomLevels: 4, smaaPreset: 0, motionBlurSamples: 0, cloudSteps: 0, sunShafts: false, filmGrain: 0.012, sharpen: 0,
    skyLutSize: 128, skySteps: 14, envSize: 64, rainStreaks: 2500, wetRipples: false,
  },
  medium: {
    tier: 'medium', pixelRatio: Math.min(1.5, dpr), antialias: true, shadowMapSize: 2048, shadowExtent: 55, anisotropy: 4,
    textureRes: 1024, canvasTextureRes: 2048, smokeParticles: 320, skidSegments: 3000, propDensity: 0.8,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.6, maxRenderScale: 1, maxPixels: 2.4, frameCap: 60,
    shadowCascades: 2, csmMapSize: 2048, shadowDistance: 120, shadowPcfTaps: 8, ao: 1, aoSamples: 12, aoRadius: 1.4,
    bloomLevels: 5, smaaPreset: 1, motionBlurSamples: 6, cloudSteps: 3, sunShafts: true, filmGrain: 0.015, sharpen: 0,
    skyLutSize: 192, skySteps: 20, envSize: 128, rainStreaks: 5000, wetRipples: true,
  },
  high: {
    tier: 'high', pixelRatio: Math.min(2, dpr), antialias: true, shadowMapSize: 4096, shadowExtent: 70, anisotropy: 8,
    textureRes: 2048, canvasTextureRes: 2048, smokeParticles: 600, skidSegments: 5000, propDensity: 1,
    adaptiveResolution: true, targetFps: 60, minRenderScale: 0.6, maxRenderScale: 1, maxPixels: 3.6, frameCap: 60,
    shadowCascades: 3, csmMapSize: 2048, shadowDistance: 200, shadowPcfTaps: 12, ao: 2, aoSamples: 16, aoRadius: 1.5,
    bloomLevels: 6, smaaPreset: 2, motionBlurSamples: 10, cloudSteps: 5, sunShafts: true, filmGrain: 0.018, sharpen: 0.25,
    skyLutSize: 256, skySteps: 24, envSize: 128, rainStreaks: 9000, wetRipples: true,
  },
};

/** The tier the player last picked by hand. Only an explicit choice is stored here. */
export const QUALITY_CHOICE_KEY = 'drivecity.quality.choice';

function savedTier(): QualityTier | null {
  try {
    const q = localStorage.getItem(QUALITY_CHOICE_KEY);
    return q && q in QUALITY ? (q as QualityTier) : null;
  } catch { return null; }
}

export function pickTier(gpu?: GpuInfo): QualityTier {
  const q = new URLSearchParams(location.search).get('quality') as QualityTier | null;
  if (q && q in QUALITY) return q;
  const saved = savedTier();
  if (saved) return saved;
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'low';
  if (gpu && (gpu.kind === 'software' || gpu.kind === 'integrated')) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'high' : 'medium';
}
