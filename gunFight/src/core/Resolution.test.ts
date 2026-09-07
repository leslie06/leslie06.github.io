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
