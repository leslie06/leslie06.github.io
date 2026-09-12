import type RAPIER_NS from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER_NS;
let RAPIER: Rapier | null = null;

/** Collision groups (membership bits). */
export const CG = {
  /** Static level geometry: ground, walls, ramps. Wheels and the camera hit it. */
  WORLD: 0x0001,
  /** Vehicle chassis. */
  CAR: 0x0002,
  /**
   * Light loose props (cones, tyre stacks). The chassis shoves them, but wheel rays ignore them so a
   * 3 kg cone can never lift a 1.4 t car onto its suspension.
   */
  PROP: 0x0004,
  /** People on foot (the player's capsule). Cars do not collide with it physically; hits are detected. */
  PED: 0x0008,
  ALL: 0xffff,
} as const;

export function groups(membership: number, filter: number): number { return (membership << 16) | filter; }

export interface ColliderUserData { surface?: 'asphalt' | 'concrete' | 'grass' | 'rubber' | 'plastic' | 'metal'; tag?: string }

export interface RayHit {
  point: [number, number, number];
  normal: [number, number, number];
  distance: number;
  collider: RAPIER_NS.Collider;
  userData: ColliderUserData;
}

export class Physics {
  R!: Rapier;
  world!: RAPIER_NS.World;
  private userData = new Map<number, ColliderUserData>();
  readonly fixedDt = 1 / 60;

  async init(): Promise<void> {
    if (!RAPIER) {
      const mod = await import('@dimforge/rapier3d-compat');
      RAPIER = (mod.default ?? mod) as unknown as Rapier;
      await RAPIER.init();
    }
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedDt;
  }

  step(): void { this.world.step(); }

  tag(collider: RAPIER_NS.Collider, data: ColliderUserData): void { this.userData.set(collider.handle, data); }
  dataOf(collider: RAPIER_NS.Collider): ColliderUserData { return this.userData.get(collider.handle) ?? {}; }
  untag(collider: RAPIER_NS.Collider): void { this.userData.delete(collider.handle); }

  raycast(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number,
    filterGroups: number = groups(CG.ALL, CG.ALL), solid = true, excludeBody?: RAPIER_NS.RigidBody): RayHit | null {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, solid, undefined, filterGroups, undefined, excludeBody);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { point: [p.x, p.y, p.z], normal: [hit.normal.x, hit.normal.y, hit.normal.z], distance: hit.timeOfImpact, collider: hit.collider, userData: this.dataOf(hit.collider) };
  }
}
