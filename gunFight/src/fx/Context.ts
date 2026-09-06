import type { Rng } from '../core/Rng';
import type { RayHit } from '../core/Physics';
import type { ParticlePool } from './ParticlePool';
import type { Decals } from './Decals';
import type { LightPool } from './Lights';
import type { V3 } from './math';

/** Everything an effect recipe needs. Owned by Fx.ts; `time` is engine.time refreshed per frame. */
export interface FxContext {
  pool: ParticlePool;
  decals: Decals;
  lights: LightPool;
  rng: Rng;
  /** particleBudget / 12000 clamped — recipes multiply their counts by this. */
  scale: number;
  time: number;
  /** Floor height under a point (raycast down), or NO_FLOOR. */
  floorAt(p: V3): number;
  raycast(origin: V3, dir: V3, maxDist: number): RayHit | null;
  /** Optional camera shake / screen flash from an explosion at (x,y,z) with the given radius (distance-attenuated by Fx). */
  shake?(x: number, y: number, z: number, radius: number): void;
}
