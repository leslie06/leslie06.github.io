/**
 * Adaptive resolution governor.
 *
 * Why this exists: the post chain is per-pixel and linear in pixel count, and it is ~90% of the
 * frame. Measured on an M2 Pro at `high`, walking and turning, after warm-up:
 *
 *   1280x720 @1x  (0.9 MP)  ->  8.1 ms  (123 fps)
 *   1512x945 @2x  (5.7 MP)  -> 39.6 ms  ( 25 fps)
 *   1728x1080 @2x (7.5 MP)  -> 53.0 ms  ( 19 fps)
 *
 * `pixelRatio` is chosen at boot from the device, so it cannot know any of that: the same tier on
 * the same GPU is smooth in a small window and unplayable full-screen on a Retina panel. The
 * governor closes the loop by measuring real frame time and scaling the drawing buffer. The canvas
 * CSS size never changes, so only the render target moves; the browser upscales.
 *
 * `step` is pure so the control law can be tested without a GPU.
 */

export interface GovernorState {
  /** Multiplier on the tier's pixelRatio. 1 = render at the tier's native ratio. */
  scale: number;
  /** Frames left to ignore after a scale change, while the pipeline re-settles. */
  cooldown: number;
  samples: number[];
}

export interface GovernorConfig {
  targetFps: number;
  minScale: number;
  maxScale: number;
  /** Frames per decision. */
  window: number;
  /** Frames ignored after a change (resizing render targets costs a frame or two). */
  cooldown: number;
}

export const DEFAULT_GOVERNOR: GovernorConfig = { targetFps: 60, minScale: 0.6, maxScale: 1, window: 30, cooldown: 20 };

export function newGovernor(scale = 1): GovernorState {
  return { scale, cooldown: 0, samples: [] };
}

/**
 * Feed one frame time (ms). Returns the new scale, or null when nothing should change.
 *
 * The dead band matters: without it the governor oscillates one step every window, which reads as a
 * pulsing image and is worse than a steady lower resolution. We only step down when we are clearly
 * missing the target, and only step up when we have real headroom for the *next* larger size —
 * scaling costs quadratic pixels, so going from 0.8 to 0.9 is ~27% more work, and we must be sure
 * it fits before spending it.
 */
export function step(s: GovernorState, frameMs: number, cfg: GovernorConfig): number | null {
  if (s.cooldown > 0) { s.cooldown--; return null; }
  s.samples.push(frameMs);
  if (s.samples.length < cfg.window) return null;

  s.samples.sort((a, b) => a - b);
  const median = s.samples[s.samples.length >> 1];
  s.samples.length = 0;

  const budget = 1000 / cfg.targetFps;
  let next = s.scale;

  if (median > budget * 1.1) {
    // Aim straight at the budget instead of stepping down blindly: cost is ~linear in pixels and
    // pixels go as scale², so the scale that fits is sqrt(budget/median).
    next = s.scale * Math.sqrt(budget / median);
  } else if (median < budget * 0.7 && s.scale < cfg.maxScale) {
    const up = Math.min(cfg.maxScale, s.scale * 1.12);
    // Only take the step if the predicted cost still fits with margin.
    if (median * (up / s.scale) ** 2 < budget * 0.9) next = up;
  }

  next = Math.max(cfg.minScale, Math.min(cfg.maxScale, next));
  if (Math.abs(next - s.scale) < 0.02) return null;
  s.scale = next;
  s.cooldown = cfg.cooldown;
  return next;
}
