import { describe, expect, it } from 'vitest';
import { borrow, fresh, giveBack, isActive, keep, nextCheckpoint, restore, secure, type Save } from './State';
const layout = { source: { x: 0, z: 0, yaw: 0 }, parking: { x: 300, z: 20, yaw: 1 }, garage: { x: 40, z: 80, yaw: 2 }, finish: { x: 600, z: 20, yaw: 3 } };
const save = (): Save => ({ ...fresh(), layout });
describe('persistent street adventure', () => {
  it('supports all three approaches with the same ownership and return rules', () => {
    for (const method of ['intercept', 'tail', 'race'] as const) {
      const s = save(); s.phase = method === 'race' ? 'race' : 'parked';
      expect(secure(s, method)).toBe(true); expect(s.keys).toBe(true); expect(isActive(s)).toBe(true);
      expect(giveBack(s)).toBe(true); expect(isActive(s)).toBe(false); expect(s.method).toBe(method);
      expect(borrow(s)).toBe(true); expect(giveBack(s)).toBe(false); expect(giveBack(s)).toBe(false);
    }
  });
  it('does not allow borrowing or returning a car before it has been recovered', () => {
    const s = save(); expect(borrow(s)).toBe(false); expect(giveBack(s)).toBe(false); expect(keep(s)).toBe(false);
    expect(secure(s, 'tail')).toBe(false); expect(s.phase).toBe('available');
  });
  it('keeping the car leaves free play available and can be undone without replaying', () => {
    const s = save(); s.phase = 'search'; secure(s, 'intercept');
    expect(keep(s)).toBe(true); expect(isActive(s)).toBe(false);
    expect(giveBack(s)).toBe(true); expect(borrow(s)).toBe(true);
  });
  it('restores clues, tools, damage and ownership after leaving the game', () => {
    const s = save(); s.phase = 'kept'; s.clue = s.informed = s.keys = true; s.tool = 'held'; s.condition = 43; s.pose = { x: 700, z: -200, yaw: 1 };
    expect(restore(JSON.stringify(s))).toEqual(s);
  });
  it('an interrupted race returns to the yard and leaves other approaches open', () => {
    const s = save(); s.phase = 'race'; s.clue = s.informed = true;
    const restored = restore(JSON.stringify(s)); expect(restored.phase).toBe('parked'); expect(restored.pose).toEqual(layout.parking);
    expect(restored.keys).toBe(false); expect(restored.clue).toBe(true); expect(secure(restored, 'tail')).toBe(true);
  });
  it('deferring preserves physical progress, including a car returning after a lost race', () => {
    const s = save(); s.phase = 'parked'; s.tracking = false; s.returning = true; s.pose = layout.finish; s.clue = s.informed = true;
    expect(isActive(s)).toBe(false);
    const restored = restore(JSON.stringify(s));
    expect(restored.pose).toEqual(layout.parking); expect(restored.returning).toBe(false);
    expect(restored.tracking).toBe(false); expect(restored.informed).toBe(true);
    restored.tracking = true; expect(isActive(restored)).toBe(true);
    expect(secure(restored, 'tail')).toBe(true);
  });
  it('rejects broken or foreign saves instead of spawning a car at invalid coordinates', () => {
    for (const raw of ['garbage', '{}', JSON.stringify({ ...save(), version: 2 }), JSON.stringify({ ...save(), layout: { ...layout, garage: { x: 1e9, z: 0, yaw: 0 } } })]) expect(restore(raw)).toEqual(fresh());
    const s = save(); s.phase = 'parked'; s.keys = true; expect(restore(JSON.stringify(s)).keys).toBe(false);
  });
  it('races require the ordered checkpoints, not just driving to the finish', () => {
    const points = [{ x: 0, z: 0 }, { x: 160, z: 0 }, { x: 320, z: 0 }];
    expect(nextCheckpoint(points, 0, 320, 0)).toBe(0);
    let next = nextCheckpoint(points, 0, 0, 0); expect(next).toBe(1);
    expect(nextCheckpoint(points, next, 320, 0)).toBe(1);
    next = nextCheckpoint(points, next, 160, 0); expect(next).toBe(2);
    expect(nextCheckpoint(points, next, 320, 0)).toBe(3);
  });
});
