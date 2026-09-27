import type { ColliderSpec } from '../../game/Contracts';

/**
 * How tall the face a car meets at the foot of a flight is, above the ramp's lowest point. Well over
 * a wheel's reach and the chassis' underside, so a car cannot climb it; the ramp's own slope carries
 * on above it where the flight rises higher.
 */
export const CAR_STOP = 0.9;

/**
 * A car-only block for every walk-only ramp. The ramp under a flight of steps is walk-only (one a
 * person can climb is one a car can drive up), so a car passed through it and stopped against the
 * tier's face behind - with its nose buried in the drawn steps (人民英雄纪念碑, 2026-09-27; every
 * flight in the city the same). The block has the ramp's plan and rises from a `CAR_STOP` face at
 * the foot to the ramp's top, so the car stops where the steps begin; people never meet it.
 * A walk-only box is its own block; a walk-only trimesh gets none.
 */
export function carStops(colliders: readonly ColliderSpec[]): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  for (const sp of colliders) {
    if (!sp.walkOnly) continue;
    if (sp.kind === 'box' || sp.kind === 'cylinder') { out.push({ ...sp, walkOnly: undefined, carOnly: true }); continue; }
    if (sp.kind !== 'hull') continue;
    const p = sp.points;
    let lo = Infinity;
    for (let i = 1; i < p.length; i += 3) lo = Math.min(lo, p[i]);
    const points = p.slice();
    for (let i = 0; i < p.length; i += 3) points.push(p[i], Math.max(p[i + 1], lo + CAR_STOP), p[i + 2]);
    out.push({ kind: 'hull', points, carOnly: true });
  }
  return out;
}
