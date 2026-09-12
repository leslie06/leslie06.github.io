import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ColliderSpec } from '../game/Contracts';
import { DOOR, ENTRY, GARAGE, GATE, HOUSE, PLOT, POOL, STAIR, UPPER, VOID, WALL } from './Layout';
import { buildVillaExtras, buildVillaFar, buildVillaStatic, VILLA_KEYS } from './Villa';

/**
 * The villa has to be a house you can actually get into: a car through the gate and the garage
 * door, a player up the steps and the stair, and a first floor with no hole to fall through. The
 * model is built by the same code the landmark builds, so a change that walls the player out shows
 * up here rather than in the game - where `placeLandmarks` would only console.warn about it.
 */
/** The tallest, widest thing the player can drive home: the box truck (2.5 m wide, ~3.2 m tall). */
const BUS_W = 2.55;
const CAR_W = 2.0, CAR_H = 1.6;

describe('我家 the villa', () => {
  const built = buildVillaStatic();

  it('uses only material keys villaMaterials declares', () => {
    // Parts.build throws on a key with no material, and placeLandmarks would only console.warn -
    // the house would just be missing. villaMaterials is typed Record<VillaKey, Material>, so tsc
    // guarantees every VILLA_KEYS entry exists; this guarantees the models ask for nothing else.
    // (The materials cannot be built here: the kit's textures need a canvas.)
    for (const parts of [built.parts, buildVillaFar(), buildVillaExtras()]) {
      for (const key of parts.bufs.keys()) expect(VILLA_KEYS as readonly string[]).toContain(key);
    }
  });

  it('stays inside its own plot, so it cannot overhang the street', () => {
    for (const [x, z] of built.footprint) {
      expect(Math.abs(x)).toBeLessThanOrEqual(PLOT.hw + 0.001);
      expect(Math.abs(z)).toBeLessThanOrEqual(PLOT.hd + 0.001);
    }
    // Every collider centre is within the plot too (the drive apron outside is geometry only).
    for (const c of built.colliders) {
      if (c.kind !== 'box') continue;
      expect(Math.abs(c.center[0])).toBeLessThan(PLOT.hw + 1);
      expect(Math.abs(c.center[2])).toBeLessThan(PLOT.hd + 1);
    }
  });

  it('lets a car through the gate and the garage door', () => {
    expect(GATE.w).toBeGreaterThan(BUS_W + 2);
    expect(DOOR.w).toBeGreaterThan(CAR_W + 1);
    expect(DOOR.h).toBeGreaterThan(CAR_H + 0.8);
    // The garage is deep enough to hold the car with the door shut behind it.
    expect(GARAGE.x1 - GARAGE.x0).toBeGreaterThan(5.5);
    expect(GARAGE.z1 - GARAGE.z0).toBeGreaterThan(4.5);
  });

  it('never blocks the garage opening with a wall collider', () => {
    const openZ0 = DOOR.z - DOOR.w / 2, openZ1 = DOOR.z + DOOR.w / 2;
    const x = GARAGE.x0 - HOUSE.wall / 2;
    for (const c of built.colliders) {
      if (c.kind !== 'box') continue;
      const [cx, cy, cz] = c.center, [hx, hy, hz] = c.half;
      const spansX = Math.abs(cx - x) < hx + 0.01;
      const spansZ = cz - hz < openZ1 - 0.05 && cz + hz > openZ0 + 0.05;
      const lowEnough = cy - hy < DOOR.h - 0.1;
      expect(spansX && spansZ && lowEnough).toBe(false);
    }
  });

  it('can be walked into: steps and stair are within what the controller climbs', () => {
    // The character controller autosteps 0.4 m and climbs 50 degrees (player/OnFoot.ts).
    expect(ENTRY.step).toBeLessThan(0.4);
    expect(HOUSE.floor0 / 2).toBeLessThan(0.4);          // two risers reach the floor
    expect(HOUSE.floor0 / 3).toBeLessThan(0.4);          // three from the garage
    const run = Math.round((HOUSE.floor1 - HOUSE.floor0) / STAIR.rise) * STAIR.tread;
    const slope = Math.atan2(HOUSE.floor1 - HOUSE.floor0, run) * 180 / Math.PI;
    expect(slope).toBeLessThan(50);
    expect(STAIR.rise).toBeLessThan(0.4);
    // The flight has to land inside the house, not through the south glazing.
    expect(STAIR.zTop + run).toBeLessThan(HOUSE.z1 - 0.5);
  });

  it('has a stair hull that actually spans the two floors', () => {
    const hulls = built.colliders.filter((c): c is Extract<ColliderSpec, { kind: 'hull' }> => c.kind === 'hull');
    expect(hulls).toHaveLength(1);
    const ys: number[] = [];
    for (let i = 1; i < hulls[0].points.length; i += 3) ys.push(hulls[0].points[i]);
    expect(Math.min(...ys)).toBeCloseTo(HOUSE.floor0, 2);
    expect(Math.max(...ys)).toBeCloseTo(HOUSE.floor1, 2);
  });

  it('floors the first storey everywhere except the stair void', () => {
    const floor = built.colliders.filter((c) =>
      c.kind === 'box' && Math.abs(c.center[1] + c.half[1] - HOUSE.floor1) < 0.01) as Extract<ColliderSpec, { kind: 'box' }>[];
    expect(floor.length).toBeGreaterThanOrEqual(2);
    const covered = (x: number, z: number) => floor.some((c) =>
      Math.abs(x - c.center[0]) <= c.half[0] + 1e-6 && Math.abs(z - c.center[2]) <= c.half[2] + 1e-6);
    // Sample the upper volume: solid outside the void, open inside it.
    for (let x = UPPER.x0 + 0.5; x < UPPER.x1; x += 1.5) {
      for (let z = UPPER.z0 + 0.5; z < UPPER.z1; z += 1.5) {
        const inVoid = x > VOID.x0 && x < VOID.x1 && z > VOID.z0 && z < VOID.z1;
        expect(covered(x, z)).toBe(!inVoid);
      }
    }
  });

  it('keeps the pool inside the walls and its coping steppable', () => {
    expect(POOL.x1 + POOL.rim).toBeLessThan(PLOT.hw - WALL.inset - 1);
    expect(POOL.z1 + POOL.rim).toBeLessThan(PLOT.hd - WALL.inset - 1);
    expect(POOL.coping).toBeLessThan(0.4);
  });

  /** `PROFILE=1 npx vitest run src/home/Villa.test.ts` writes the model's cost to .scratch/home. */
  it('records the model cost when PROFILE=1', () => {
    if (!process.env.PROFILE) return;
    const far = buildVillaFar();
    const n = (k: string) => built.colliders.filter((c) => c.kind === k).length;
    const out = [
      `detail    ${built.parts.triangles()} tris, ${built.parts.bufs.size} draw calls`,
      `far LOD   ${far.triangles()} tris, ${far.bufs.size} draw calls`,
      `colliders ${built.colliders.length} (${n('box')} box, ${n('hull')} hull)`,
    ].join('\n');
    mkdirSync('.scratch/home', { recursive: true });
    writeFileSync('.scratch/home/stats.txt', out + '\n');
  });

  it('stays inside a landmark budget', () => {
    expect(built.parts.triangles()).toBeLessThan(140000);
    expect(buildVillaFar().triangles()).toBeLessThan(6000);
    // One draw call per material key.
    expect(built.parts.bufs.size).toBeLessThanOrEqual(18);
    expect(built.colliders.length).toBeLessThan(80);
  });
});
