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

/**
 * `cooldown` is also the warm-up: the first seconds of a session are full of one-off costs (shader
 * compiles, texture uploads, the first ragdoll) that say nothing about steady-state throughput, and
 * a governor that reacts to them starts the game at its floor.
 */
export function newGovernor(scale = 1, cooldown = 0): GovernorState {
  return { scale, cooldown, samples: [] };
}

/**
 * Per-sample ceiling, in ms, before a frame enters the mean. A single 2 s stall (an alt-tab, a
 * shader compile, the browser reclaiming memory) is not a resolution problem, and without a clip it
 * would drag a 30-frame mean far enough to slam the scale to the floor. 200 ms still says
 * unambiguously "this frame was terrible" while keeping one outlier's contribution bounded.
 */
const SAMPLE_CLIP_MS = 200;

/**
 * Feed one frame time (ms). Returns the new scale, or null when nothing should change.
 *
 * Down and up read different statistics, and that asymmetry is the whole control law.
 *
 * Down uses the **mean**, because the mean frame interval is by definition the reciprocal of the
 * frame rate the player actually got over the window. The median is not: a machine that renders 28
 * frames at 13 ms and then stalls for 760 ms twice has a median of 13 ms (a confident "76 fps")
 * and a real throughput of 16 fps. That is not a hypothetical - it is what an over-subscribed GPU
 * does, because the driver lets the CPU run several frames ahead and then blocks on the swap chain,
 * so the stutter arrives as a few enormous frames among many fast ones. A median-driven governor is
 * blind to exactly the case it exists to fix, and sits at scale 1.00 while the game is unplayable.
 *
 * Up uses the **median**, and demands the predicted cost of the next size still fit with margin.
 * Growing costs quadratic pixels, so 0.8 -> 0.9 is ~27% more work; we only spend that when the
 * window was consistently fast, not when its average was dragged down by luck.
 *
 * The dead band matters in both directions: without it the governor oscillates one step every
 * window, which reads as a pulsing image and is worse than a steady lower resolution.
 */
export function step(s: GovernorState, frameMs: number, cfg: GovernorConfig): number | null {
  if (s.cooldown > 0) { s.cooldown--; return null; }
  s.samples.push(Math.min(frameMs, SAMPLE_CLIP_MS));
  if (s.samples.length < cfg.window) return null;

  let sum = 0;
  for (const v of s.samples) sum += v;
  const mean = sum / s.samples.length;
  s.samples.sort((a, b) => a - b);
  const median = s.samples[s.samples.length >> 1];
  s.samples.length = 0;

  const budget = 1000 / cfg.targetFps;
  let next = s.scale;

  if (mean > budget * 1.1) {
    // Aim straight at the budget instead of stepping down blindly: cost is ~linear in pixels and
    // pixels go as scale², so the scale that fits is sqrt(budget/mean).
    next = s.scale * Math.sqrt(budget / mean);
  } else if (median < budget * 0.7 && mean < budget * 0.9 && s.scale < cfg.maxScale) {
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
