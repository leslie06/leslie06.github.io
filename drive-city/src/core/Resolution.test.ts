import { describe, it, expect } from 'vitest';
import { newGovernor, step, DEFAULT_GOVERNOR as C } from './Resolution';

const feed = (s: ReturnType<typeof newGovernor>, ms: number, n = C.window + C.cooldown) => {
  let last: number | null = null;
  for (let i = 0; i < n; i++) { const r = step(s, ms, C); if (r !== null) last = r; }
  return last;
};

describe('resolution governor', () => {
  it('scales down when the frame is over budget', () => {
    const s = newGovernor();
    const r = feed(s, 40);          // 25 fps against a 60 fps target
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(1);
    // 16.7/40 -> sqrt ≈ 0.65, i.e. it aims at the budget rather than nudging
    expect(r!).toBeCloseTo(Math.sqrt(16.667 / 40), 1);
  });

  it('does not scale below the legibility floor', () => {
    const s = newGovernor();
    for (let k = 0; k < 10; k++) feed(s, 200);
    expect(s.scale).toBeGreaterThanOrEqual(C.minScale);
  });

  it('leaves a frame that is inside the budget alone', () => {
    const s = newGovernor(1);
    expect(feed(s, 15)).toBeNull();
    expect(s.scale).toBe(1);
  });

  it('recovers upward when headroom appears, but never past max', () => {
    const s = newGovernor(0.7);
    for (let k = 0; k < 12; k++) feed(s, 5);
    expect(s.scale).toBeGreaterThan(0.7);
    expect(s.scale).toBeLessThanOrEqual(C.maxScale);
  });

  it('does not oscillate when frame time sits just under the target', () => {
    const s = newGovernor(1);
    const seen = new Set<number>();
    for (let k = 0; k < 20; k++) { feed(s, 16); seen.add(s.scale); }
    expect(seen.size).toBe(1);
  });
});

describe('resolution governor: bursty frames', () => {
  /**
   * The failure this control law exists for. Reported from a desktop whose browser had bound the
   * APU's integrated Radeon: the panel read 13.1 ms / "76 fps" median with a 760 ms p95, and the
   * governor sat at 1.00 while the game was unplayable. Most frames really were fast; the GPU was
   * so far behind that the driver ran the CPU ahead and then blocked on the swap chain.
   */
  const bursty = (s: ReturnType<typeof newGovernor>, n = (C.window + C.cooldown) * 6) => {
    let last: number | null = null;
    for (let i = 0; i < n; i++) {
      const ms = i % 18 === 17 ? 760 : 13.1;   // ~5.6% of frames stall, exactly as measured
      const r = step(s, ms, C);
      if (r !== null) last = r;
    }
    return last;
  };

  it('scales down for a fast median with long stalls', () => {
    const s = newGovernor();
    expect(bursty(s)).not.toBeNull();
    expect(s.scale).toBeLessThan(0.9);
  });

  it('is not fooled into scaling up by the fast frames in between', () => {
    const s = newGovernor(0.8);
    bursty(s);
    expect(s.scale).toBeLessThanOrEqual(0.8);
  });

  it('ignores a single one-off stall in an otherwise smooth window', () => {
    const s = newGovernor(1);
    // One 2 s compile hitch per ~150 frames must not cost the player their resolution.
    for (let i = 0; i < 600; i++) step(s, i % 150 === 149 ? 2000 : 12, C);
    expect(s.scale).toBe(1);
  });

  it('honours the warm-up cooldown before deciding anything', () => {
    const s = newGovernor(1, 90);
    for (let i = 0; i < 89; i++) expect(step(s, 500, C)).toBeNull();
    expect(s.scale).toBe(1);
  });
});

describe('resolution governor: locked to the presentation cadence', () => {
  /**
   * The case measured on a 3060 Ti after the frame cap landed: a rock-steady 59 fps, and the
   * governor pinned at its 0.60 floor drawing 1.2 MP into a 3.3 MP window. vsync and the frame cap
   * both hold every frame at the budget, so "how much headroom is there" is unanswerable from the
   * frame interval — and the measured step-up asks for 85 fps, which such a display can never show.
   */
  const feedLocked = (s: ReturnType<typeof newGovernor>, windows: number, ms = 16.7) => {
    for (let i = 0; i < windows * (C.window + C.cooldown); i++) step(s, ms, C);
  };

  it('climbs back off the floor instead of ratcheting down for ever', () => {
    const s = newGovernor(C.minScale);
    feedLocked(s, 40);
    expect(s.scale).toBeGreaterThan(0.9);
  });

  it('needs several windows per step, so it creeps rather than jumps', () => {
    const s = newGovernor(0.6);
    feedLocked(s, 3);
    expect(s.scale).toBeLessThanOrEqual(0.6 * 1.07);
  });

  it('stops probing at a scale that was measured missing, then relaxes', () => {
    const s = newGovernor(0.8);
    // A window that misses the budget records 0.8 as a ceiling and steps down.
    for (let i = 0; i < C.window + C.cooldown; i++) step(s, 30, C);
    expect(s.scale).toBeLessThan(0.8);
    expect(s.ceiling).toBeLessThanOrEqual(0.8);
    // It must not immediately walk back into the wall on the next probe.
    const afterOneProbe = (() => { feedLocked(s, PROBE_WINDOWS_EQUIV); return s.scale; })();
    expect(afterOneProbe).toBeLessThan(0.8);
  });

  it('leaves a machine that is already at max alone', () => {
    const s = newGovernor(1);
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) { feedLocked(s, 1); seen.add(s.scale); }
    expect(seen.size).toBe(1);
    expect(s.scale).toBe(1);
  });

  it('does not probe up when the budget is met only by averaging out hitches', () => {
    // mean lands near the budget, but p95 is enormous: this is the stutter case, not headroom.
    const s = newGovernor(0.8);
    for (let i = 0; i < 20 * (C.window + C.cooldown); i++) step(s, i % 20 === 19 ? 200 : 7, C);
    expect(s.scale).toBeLessThanOrEqual(0.8);
  });
});

/** One probe interval, in whole decision windows (mirrors PROBE_WINDOWS in Resolution.ts). */
const PROBE_WINDOWS_EQUIV = 6;
