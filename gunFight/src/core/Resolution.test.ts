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
