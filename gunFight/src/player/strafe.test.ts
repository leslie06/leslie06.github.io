import { describe, it, expect } from 'vitest';

/**
 * Strafe direction. A/D were swapped for most of this project's life because the right vector
 * was negated; the bug hid because camera roll and viewmodel lag derive from the same vector and
 * so stayed consistent with the key press. This pins the world-space direction itself.
 */
function basis(yaw: number) {
  const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  return { fwd, right: { x: -fwd.z, z: fwd.x } };
}

describe('strafe basis', () => {
  it('points right to +X when facing -Z', () => {
    const { fwd, right } = basis(0);
    expect(fwd.z).toBeCloseTo(-1);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBeCloseTo(0);
  });

  it('keeps right 90 degrees clockwise of forward at every yaw', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, Math.PI, 4.2, -1.3]) {
      const { fwd, right } = basis(yaw);
      // right must be perpendicular to forward
      expect(fwd.x * right.x + fwd.z * right.z).toBeCloseTo(0);
      // ...and on the correct side. In the XZ plane the determinant |fwd right| is +1 for the
      // true right vector and -1 for the negated one, so this is what actually catches the swap.
      expect(fwd.x * right.z - fwd.z * right.x).toBeCloseTo(1);
    }
  });
});
