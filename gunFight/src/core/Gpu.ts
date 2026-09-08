/**
 * Which GPU did the browser actually bind?
 *
 * Kept apart from Quality.ts so the classifier can be unit-tested without a DOM: Quality reads
 * `window.devicePixelRatio` while building its tier table, and this file touches nothing at module
 * scope.
 */
/**
 * `navigator.hardwareConcurrency` is a CPU number, and it was the only input to the tier choice.
 * That is exactly backwards for a renderer that is ~90% GPU-bound: a desktop with a 16-thread Ryzen
 * APU and an RTX 3060 Ti reports 16 cores and picks `high` - and then, if the browser happened to
 * bind the APU's integrated Radeon instead of the discrete card (monitor plugged into the
 * motherboard, or a Windows "power saving" GPU preference), runs that tier on a GPU roughly a tenth
 * as fast. The reported adapter is the only signal that can tell those two machines apart.
 */
export type GpuKind = 'software' | 'integrated' | 'discrete' | 'unknown';
export interface GpuInfo { renderer: string; kind: GpuKind }

/**
 * Classify an `UNMASKED_RENDERER_WEBGL` string.
 *
 * Order matters: a discrete part's string also contains its vendor ("Intel(R) Arc(TM) A770",
 * "AMD Radeon RX 7900"), so the discrete patterns have to be tested before the vendor-wide
 * integrated ones. AMD's APUs report the bare marketing name "AMD Radeon(TM) Graphics" with a PCI
 * id and never a model number, which is what separates them from "Radeon RX <model>".
 */
export function classifyGpu(s: string): GpuKind {
  const r = s.toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic|basic render/.test(r)) return 'software';
  if (/geforce|\brtx\b|\bgtx\b|quadro|nvidia|tesla|radeon rx|radeon pro|firepro|instinct|arc\(tm\)|intel\(r\) arc/.test(r)) return 'discrete';
  if (/apple m\d|apple gpu/.test(r)) return 'discrete';
  if (/radeon\(tm\)\s*graphics|radeon graphics|\bvega\b|\bmali\b|adreno|powervr|videocore/.test(r)) return 'integrated';
  if (/intel/.test(r)) return 'integrated';
  return 'unknown';
}

/**
 * Read the adapter string. Pass the live context when there is one (the renderer's, so we report
 * the adapter the game is actually drawing with rather than whatever a throwaway context binds);
 * otherwise a scratch context is created. Some browsers block the extension - 'unknown' then falls
 * back to the old CPU heuristic rather than guessing.
 */
export function detectGpu(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): GpuInfo {
  let renderer = '';
  try {
    let ctx: WebGLRenderingContext | WebGL2RenderingContext | null = gl ?? null;
    if (!ctx) ctx = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    if (ctx) {
      const d = ctx.getExtension('WEBGL_debug_renderer_info');
      if (d) renderer = String(ctx.getParameter(d.UNMASKED_RENDERER_WEBGL));
      if (!renderer) renderer = String(ctx.getParameter(ctx.RENDERER));
    }
  } catch { /* blocked (privacy.resistFingerprinting et al) - stay 'unknown' */ }
  return { renderer, kind: classifyGpu(renderer) };
}
