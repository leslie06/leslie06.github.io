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
  /** Decisions since the last blind upward probe. See the `comfortable` branch of `step`. */
  probe: number;
  /**
   * Lowest scale that has been measured missing the budget, or `maxScale` if none has. Blind probes
   * stop just under it, and it relaxes a little every comfortable window so a ceiling set during
   * one heavy moment (an explosion, a full squad on screen) does not cap the rest of the run.
   */
  ceiling: number;
  /**
   * How often probing has been wrong lately, 0..PROBE_FAIL_CAP. Each failure lengthens the wait
   * before the next attempt; comfortable windows forget it slowly. A machine sitting exactly at its
   * limit therefore stops poking at the wall instead of finding it every few seconds.
   */
  fails: number;
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
export function newGovernor(scale = 1, cooldown = 0, maxScale = 1): GovernorState {
  return { scale, cooldown, samples: [], probe: 0, ceiling: maxScale, fails: 0 };
}

/**
 * Per-sample ceiling, in ms, before a frame enters the mean. A single 2 s stall (an alt-tab, a
 * shader compile, the browser reclaiming memory) is not a resolution problem, and without a clip it
 * would drag a 30-frame mean far enough to slam the scale to the floor. 200 ms still says
 * unambiguously "this frame was terrible" while keeping one outlier's contribution bounded.
 */
const SAMPLE_CLIP_MS = 200;

/**
 * Decisions between blind upward probes, and the size of one.
 *
 * Deliberately smaller and rarer than a measured step-up: a probe is a guess, and its cost when
 * wrong is a window spent over budget. 1.06 on the scale is ~12% more pixels — enough to climb from
 * the 0.6 floor back to 1.0 in about a dozen probes, small enough that a wrong one is a brief 6%
 * softening rather than a visible pulse.
 */
const PROBE_WINDOWS = 6;
const PROBE_STEP = 1.06;
/** How fast a ceiling forgets. Per comfortable decision, so a scene that got heavier stays capped. */
const CEILING_RELAX = 1.004;
/**
 * Extra windows to wait after a probe was wrong, multiplied by the recent failure count.
 *
 * Blind probing cannot converge silently: a machine sitting exactly at its limit will find the wall
 * again every time it tries, and every scale change reallocates the post chain's render targets and
 * costs a frame. Measured at a flat back-off, an M2 Pro at `high` settled into a 0.70-0.80 wobble
 * changing scale every ~7 s, which is a hitch often enough to notice. Lengthening the wait with each
 * failure turns that into a machine that probes, learns, and then leaves itself alone — while a
 * machine that genuinely got faster (a background app closed, a thermal throttle lifted) still
 * finds its way up, just more slowly. The alternative — never probing — is the one-way ratchet this
 * whole branch exists to fix.
 */
const PROBE_BACKOFF = 12;
const PROBE_FAIL_CAP = 6;
/**
 * Failures forgotten per comfortable decision — deliberately slow, one level per ~100 windows.
 * At 0.05 the decay outran the failures and the counter sat at ~1 for ever, which left the wobble
 * at one scale change every 7 s; the point of the counter is to let a machine that is genuinely at
 * its limit climb to the cap and stay quiet.
 */
const PROBE_FAIL_DECAY = 0.01;

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
  /**
   * Is this window smooth, or is its average being carried by outliers?
   *
   * Both upward branches below are about spending headroom on pixels, and neither is safe without
   * this. A window of 29 frames at 7 ms and one 200 ms stall has a median of 7 (reads as 143 fps)
   * and a mean of 13 (reads as spare capacity) — and is in fact a quarter-second freeze twice a
   * second. Growing the buffer there makes the only thing that is actually wrong worse. A window
   * genuinely locked to vsync has mean and median within a per cent of each other.
   */
  const steady = mean <= median * 1.25;
  let next = s.scale;

  if (mean > budget * 1.1) {
    // Aim straight at the budget instead of stepping down blindly: cost is ~linear in pixels and
    // pixels go as scale², so the scale that fits is sqrt(budget/mean).
    next = s.scale * Math.sqrt(budget / mean);
    s.ceiling = Math.min(s.ceiling, s.scale);   // this scale demonstrably does not fit
    s.fails = Math.min(PROBE_FAIL_CAP, s.fails + 1);
    s.probe = -PROBE_BACKOFF * Math.ceil(s.fails);
  } else if (s.scale < cfg.maxScale && steady) {
    if (median < budget * 0.7 && mean < budget * 0.9) {
      // Measured headroom: the loop is running free and finishing well inside the budget.
      const up = Math.min(cfg.maxScale, s.scale * 1.12);
      // Only take the step if the predicted cost still fits with margin.
      if (median * (up / s.scale) ** 2 < budget * 0.9) next = up;
    } else if (mean <= budget * 1.05) {
      // Locked to the presentation cadence, and the headroom above it is *unobservable*.
      //
      // This is the normal case, not an edge case: vsync (and the frame cap) hold every frame at
      // the budget, so a machine with 3x the power it needs reports exactly the same 16.7 ms as one
      // with barely enough. The measured branch above asks for 11.7 ms — 85 fps — which no display
      // running at `targetFps` can ever show, so on its own the governor is a one-way ratchet: it
      // steps down for a rough patch and then can never come back, and the player finishes the
      // session at the floor. Measured on a 3060 Ti: pinned at 0.60, drawing 1.2 MP into a 3.3 MP
      // window, at a rock-steady 59 fps.
      //
      // So stop measuring and try. If the step was too much the next window reports it as a miss
      // and the branch above takes it straight back — and records the ceiling, so we do not walk
      // into the same wall every few seconds.

      s.ceiling = Math.min(cfg.maxScale, s.ceiling * CEILING_RELAX);
      s.fails = Math.max(0, s.fails - PROBE_FAIL_DECAY);
      s.probe++;
      if (s.probe >= PROBE_WINDOWS) {
        s.probe = 0;
        const up = Math.min(cfg.maxScale, s.ceiling * 0.98, s.scale * PROBE_STEP);
        if (up > s.scale) next = up;
      }
    }
  }

  next = Math.max(cfg.minScale, Math.min(cfg.maxScale, next));
  if (Math.abs(next - s.scale) < 0.02) return null;
  s.scale = next;
  s.cooldown = cfg.cooldown;
  return next;
}
