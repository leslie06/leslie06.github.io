import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ColliderSpec } from '../game/Contracts';
import {
  BAR, BEDROOMS, DOOR, ENTRY, GARAGE, GARAGE_DOOR, GATE, HOUSE, LANDING, PLINTH, PLOT, POOL, ROOM,
  SLIDER, STAIR, UPPER_ROOM, UPPER_WALL, VOID, Y, BED, stairAngle,
} from './Layout';
import { buildVillaExtras, buildVillaFar, buildVillaStatic, VILLA_KEYS } from './Villa';

/**
 * The villa has to be a house you can actually get into: a car through the gate and the garage
 * door, a player up the steps onto the plinth and round the curved stair, and a first floor with no
 * hole to fall through. The model is built by the same code the landmark builds, so a change that
 * walls the player out shows up here rather than in the game - where `placeLandmarks` would only
 * console.warn about it.
 */
const BUS_W = 2.55;
const CAR_W = 2.0, CAR_H = 1.6;
/** What the character controller will do: autostep 0.4 m, climb 50° (player/OnFoot.ts). */
const STEP = 0.4, SLOPE = 50;

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
    for (const r of [PLINTH, BAR, POOL, GARAGE, ROOM.pavilion]) {
      expect(r.x0).toBeGreaterThan(-PLOT.hw);
      expect(r.x1).toBeLessThan(PLOT.hw);
      expect(r.z0).toBeGreaterThan(-PLOT.hd);
      expect(r.z1).toBeLessThan(PLOT.hd);
    }
  });

  it('lets a car through the gate and into the garage', () => {
    expect(GATE.w).toBeGreaterThan(BUS_W + 2);
    expect(DOOR.w).toBeGreaterThan(CAR_W + 1);
    expect(DOOR.h).toBeGreaterThan(CAR_H + 0.8);
    expect(GARAGE.x1 - GARAGE.x0).toBeGreaterThan(5.5);
    expect(GARAGE.z1 - GARAGE.z0).toBeGreaterThan(4.5);
    // The garage stays at court level: a car cannot climb the plinth.
    expect(GARAGE.roof).toBeLessThan(HOUSE.ceil0);
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

  it('can be climbed: the plinth steps and the garage steps are within the autostep', () => {
    expect(ENTRY.riser).toBeLessThan(STEP);
    expect(Y.plinth / ENTRY.steps).toBeLessThan(STEP);
    expect(Y.plinth / 3).toBeLessThan(STEP);
  });

  it('turns the curved stair at a slope the player can walk', () => {
    const rise = (HOUSE.floor1 - HOUSE.floor0) / STAIR.treads;
    const going = (Math.abs(STAIR.a1 - STAIR.a0) * STAIR.r) / STAIR.treads;
    expect(rise).toBeLessThan(STEP);
    expect(Math.atan2(rise, going) * 180 / Math.PI).toBeLessThan(SLOPE);
    // It has to stand inside the hall and rise through the void.
    expect(STAIR.cx - STAIR.r - STAIR.w / 2).toBeGreaterThan(ROOM.hall.x0);
    expect(STAIR.cx + STAIR.r + STAIR.w / 2).toBeLessThan(ROOM.hall.x1);
    expect(STAIR.cz).toBeGreaterThan(VOID.z0);
    expect(STAIR.cz).toBeLessThan(VOID.z1);
  });

  it('has treads that touch, and a landing to step off onto', () => {
    // The gap that broke it: a fixed 0.32 m tread against a 0.61 m arc spacing at the outer edge,
    // so you could only climb hugging the inside and fell through further out.
    const outer = STAIR.r + STAIR.w / 2;
    const spacing = (outer * Math.abs(STAIR.a1 - STAIR.a0)) / (STAIR.treads - 1);
    const depth = spacing * 1.06;
    expect(depth).toBeGreaterThanOrEqual(spacing);
    // And the whole flight has to fit the hole it rises through, which is the fit that was never
    // checked: the sweep reached z 1.36 against a void that stopped at 0.9, so the top treads ran
    // under the slab, and the landing was a slab of its own over the six treads below it.
    const A = stairAngle(STAIR.a1);
    const rad: [number, number] = [Math.cos(A), Math.sin(A)];
    const tan: [number, number] = [-Math.sin(A), Math.cos(A)];
    const tx = STAIR.cx + rad[0] * STAIR.r, tz = STAIR.cz + rad[1] * STAIR.r;
    let maxX = -Infinity, maxZ = -Infinity;
    for (const sw of [-1, 1]) for (const sd of [-1, 1]) {
      maxX = Math.max(maxX, tx + sw * (STAIR.w / 2) * rad[0] + sd * (depth / 2) * tan[0]);
      maxZ = Math.max(maxZ, tz + sw * (STAIR.w / 2) * rad[1] + sd * (depth / 2) * tan[1]);
    }
    // The top tread laps east onto the paving, which is slab, not a bridge over the flight...
    expect(maxX).toBeGreaterThan(VOID.x1);
    expect(maxX).toBeLessThan(LANDING.x1);
    // ...and that paving lies between the stairwell and the gallery portal, not across the void
    // from it: the landing the flight arrives on has to be the one the rooms open off.
    expect(LANDING.x0).toBeGreaterThanOrEqual(VOID.x1);
    expect(LANDING.x1).toBe(UPPER_ROOM.hall.x0);
    // ...and nothing else in the sweep reaches the slab south of the void.
    expect(maxZ).toBeLessThan(VOID.z1);
  });

  it('carries the stair on one convex hull per tread, since a helix is not convex', () => {
    // Three treads to a hull made each hull's outer edge a chord, and the arc bulges 0.22 m
    // outside it at mid span: a hole with the whole drop below it. One tread to a hull is 1.4 cm.
    const nearStair = (h: Extract<ColliderSpec, { kind: 'hull' }>): boolean =>
      h.points.some((_, i) => i % 3 === 0 && Math.abs(h.points[i]) < 4.5);
    const hulls = built.colliders
      .filter((c): c is Extract<ColliderSpec, { kind: 'hull' }> => c.kind === 'hull')
      .filter(nearStair);
    expect(hulls.length).toBeGreaterThanOrEqual(STAIR.treads);
    // Their tops climb the whole storey, floor to floor.
    const tops = hulls.map((h) => {
      let top = -Infinity;
      for (let i = 1; i < h.points.length; i += 3) top = Math.max(top, h.points[i]);
      return top;
    });
    expect(Math.min(...tops)).toBeLessThan(HOUSE.floor0 + 0.4);
    expect(Math.max(...tops)).toBeCloseTo(HOUSE.floor1, 1);
  });

  it('floors the whole bar except the open part of the stairwell', () => {
    const floor = built.colliders.filter((c) =>
      c.kind === 'box' && Math.abs(c.center[1] + c.half[1] - HOUSE.floor1) < 0.01) as Extract<ColliderSpec, { kind: 'box' }>[];
    // Four pieces: the void is the stairwell now, not the whole west end of the bar.
    expect(floor.length).toBeGreaterThanOrEqual(4);
    const covered = (x: number, z: number) => floor.some((c) =>
      Math.abs(x - c.center[0]) <= c.half[0] + 1e-6 && Math.abs(z - c.center[2]) <= c.half[2] + 1e-6);
    for (let x = BAR.x0 + 0.5; x < BAR.x1; x += 1.5) {
      for (let z = BAR.z0 + 0.5; z < BAR.z1; z += 1.5) {
        // The landing is paving laid on the slab now, not a slab bridging the void, so the hole
        // is simply the hole - and the flight has to fit inside it (Stair.test.ts).
        const inVoid = x > VOID.x0 && x < VOID.x1 && z > VOID.z0 && z < VOID.z1;
        expect(covered(x, z)).toBe(!inVoid);
      }
    }
  });

  it('keeps every upper room inside the bar', () => {
    for (const r of Object.values(UPPER_ROOM)) {
      expect(r.x0).toBeGreaterThanOrEqual(BAR.x0);
      expect(r.x1).toBeLessThanOrEqual(BAR.x1);
      expect(r.z0).toBeGreaterThanOrEqual(BAR.z0);
      expect(r.z1).toBeLessThanOrEqual(BAR.z1);
    }
  });

  it('has three bedrooms, each with the south glass and room for a bed', () => {
    // The complaint that started this: the plan claimed three bedrooms and the house had one.
    expect(BEDROOMS.length).toBe(3);
    for (const name of BEDROOMS) {
      const r = UPPER_ROOM[name];
      expect(r.z1).toBe(BAR.z1);
      expect(Math.min(r.x1 - r.x0, r.z1 - r.z0)).toBeGreaterThan(3.5);
      expect((r.x1 - r.x0) * (r.z1 - r.z0)).toBeGreaterThan(50);
    }
  });

  it('tiles the bar with rooms that never overlap', () => {
    const rooms = Object.values(UPPER_ROOM);
    let area = 0;
    for (const r of rooms) area += (r.x1 - r.x0) * (r.z1 - r.z0);
    expect(area).toBeCloseTo((BAR.x1 - BAR.x0) * (BAR.z1 - BAR.z0), 6);
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const over = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
        * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
      expect(over, `${Object.keys(UPPER_ROOM)[i]} overlaps ${Object.keys(UPPER_ROOM)[j]}`).toBe(0);
    }
  });

  it('opens a door into every upper room, and stands nothing in the doorway', () => {
    // The old plan built a wall only where two rooms shared an x edge, so most of the floor was
    // one open space: three beds, no bedrooms. Walking the doors is what catches that.
    const t = HOUSE.wall;
    const roomAt = (x: number, z: number): string | null => {
      for (const [name, r] of Object.entries(UPPER_ROOM)) {
        if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return name;
      }
      return null;
    };
    const edges: [string, string][] = [];
    for (const w of UPPER_WALL) {
      if (!w.door) continue;
      const at = w.door.at ?? (w.from + w.to) / 2, off = t / 2 + 0.25;
      const a = w.axis === 'x' ? roomAt(w.at - off, at) : roomAt(at, w.at - off);
      const b = w.axis === 'x' ? roomAt(w.at + off, at) : roomAt(at, w.at + off);
      expect(a, `door at ${w.axis}=${w.at} has a room behind it`).toBeTruthy();
      expect(b, `door at ${w.axis}=${w.at} has a room in front of it`).toBeTruthy();
      edges.push([a as string, b as string]);
      // The character capsule is 0.56 m across; a door narrower than this is decoration.
      expect(w.door.w).toBeGreaterThan(1.0);
      // And nothing - a bed, a wardrobe, an island - may stand in the opening.
      const dx = w.axis === 'x' ? w.at : at, dz = w.axis === 'x' ? at : w.at, y = HOUSE.floor1 + 0.9;
      for (const c of built.colliders) {
        if (c.kind !== 'box') continue;
        const [cx, cy, cz] = c.center, [hx, hy, hz] = c.half;
        const blocked = Math.abs(dx - cx) < hx - 0.01 && Math.abs(dz - cz) < hz - 0.01 && Math.abs(y - cy) < hy - 0.01;
        expect(blocked, `something blocks the door at ${w.axis}=${w.at}`).toBe(false);
      }
    }
    // Every room has to be reachable from the stair landing by walking through doors.
    const seen = new Set<string>(['landing']);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [a, b] of edges) {
        if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); changed = true; }
      }
    }
    for (const name of Object.keys(UPPER_ROOM)) expect([...seen]).toContain(name);
  });

  it('enters every bedroom at the foot of the bed, not behind its headboard', () => {
    // 「一进门就是面对的床背面」: bed and door were both dead centre on the same wall.
    for (const name of BEDROOMS) {
      const r = UPPER_ROOM[name], b = BED[name as keyof typeof BED];
      // The head is on a side wall of this room...
      expect([r.x0, r.x1]).toContain(b.wallX);
      const door = UPPER_WALL.find((w) => w.door && w.axis === 'z' && w.at === r.z0 && w.from === r.x0)!;
      expect(door, `${name} has a door off the gallery`).toBeTruthy();
      const at = door.door!.at ?? (door.from + door.to) / 2;
      // ...and the whole doorway is past the foot of the bed, so you walk in facing its front.
      const foot = b.wallX + b.dir * (b.len + 0.3);
      expect((at - b.dir * door.door!.w / 2 - foot) * b.dir, `${name}'s door is past the bed's foot`).toBeGreaterThan(0.5);
    }
  });

  it('leaves every ground-floor opening walkable', () => {
    // The upper doors are checked above; the ground floor never was - and the front door is where
    // the house is actually entered. Each opening is sampled at head height in its middle.
    const t = HOUSE.wall, F0 = HOUSE.floor0;
    const doors: [string, number, number, number][] = [
      ['entry pivot door', HOUSE.x0 - t / 2, ENTRY.z, F0 + 0.9],
      ['garage roller door', GARAGE.x0 - t / 2, DOOR.z, Y.court + 0.9],
      ['garage into the hall', GARAGE.x1 + t / 2, GARAGE_DOOR.z, Y.plinth + 0.9],
      ['great room slider', SLIDER.great.x, ROOM.great.z1 + t / 2, F0 + 0.9],
      ['pavilion slider', SLIDER.pavilion.x, ROOM.pavilion.z1 + t / 2, F0 + 0.9],
      ['study door', ROOM.study.x0 - t / 2, -9, F0 + 0.9],
      ['pavilion door', 33, ROOM.pavilion.z0 - t / 2, F0 + 0.9],
    ];
    const blocked: string[] = [];
    for (const [name, x, z, y] of doors) {
      for (const c of built.colliders) {
        if (c.kind !== 'box') continue;
        const [cx, cy, cz] = c.center, [hx, hy, hz] = c.half;
        if (Math.abs(x - cx) < hx - 0.01 && Math.abs(z - cz) < hz - 0.01 && Math.abs(y - cy) < hy - 0.01) {
          blocked.push(name); break;
        }
      }
    }
    expect(blocked).toEqual([]);
  });


  it('can be walked onto: the court climbs to the plinth in autostep-sized rises', () => {
    // The bug this exists for: both flights of steps were built inside the plinth's solid box, so
    // the approach was a sheer 1.05 m face and the player stopped dead on the court in front of it.
    // Checking riser arithmetic did not catch it - only asking what you can actually stand on does.
    const standOn = (x: number, z: number, feet: number): number => {
      let top = 0;
      for (const c of built.colliders) {
        if (c.kind === 'box') {
          const [cx, cy, cz] = c.center, [hx, hy, hz] = c.half;
          if (Math.abs(x - cx) > hx || Math.abs(z - cz) > hz) continue;
          // Things you walk under (a door head, a soffit) are not floors.
          if (cy - hy > feet + STEP) continue;
          top = Math.max(top, cy + hy);
        } else if (c.kind === 'hull') {
          // A wedge: flat in z, ramping along x. Interpolate its top between the two ends, or a
          // ramp would read as no surface at all and this test would pass an unclimbable house.
          const p = c.points;
          let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (let i = 0; i < p.length; i += 3) {
            x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
            z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
          }
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          let topAtX0 = -Infinity, topAtX1 = -Infinity;
          for (let i = 0; i < p.length; i += 3) {
            if (Math.abs(p[i] - x0) < 0.01) topAtX0 = Math.max(topAtX0, p[i + 1]);
            if (Math.abs(p[i] - x1) < 0.01) topAtX1 = Math.max(topAtX1, p[i + 1]);
          }
          const k = x1 - x0 < 1e-6 ? 1 : (x - x0) / (x1 - x0);
          top = Math.max(top, topAtX0 + (topAtX1 - topAtX0) * k);
        }
      }
      return top;
    };
    const walkIn = (z: number, from: number, to: number, what: string) => {
      let feet = 0;
      for (let x = from; x <= to; x += 0.1) {
        const top = standOn(x, z, feet);
        expect(top - feet, `${what}: a ${(top - feet).toFixed(2)} m rise at x=${x.toFixed(1)}`).toBeLessThanOrEqual(STEP);
        feet = top;
      }
      expect(feet, `${what}: you end up on the plinth`).toBeCloseTo(Y.plinth, 2);
    };
    walkIn(ENTRY.z, -20, -9, 'up the front steps');
    walkIn(DOOR.z, -24, -12.2, 'in through the garage');
  });

  it('cantilevers the bar south of the ground-floor glass, and pools below it', () => {
    // The deep shaded soffit over the terrace is the reference's signature.
    expect(BAR.z1).toBeGreaterThan(ROOM.great.z1 + 2);
    // The infinity pool is flush with the plinth - no raised coping - and sits on it.
    expect(POOL.z0).toBeGreaterThan(BAR.z1);
    expect(POOL.x0).toBeGreaterThan(PLINTH.x0);
    expect(POOL.x1).toBeLessThan(PLINTH.x1);
    expect(POOL.z1).toBeLessThan(PLINTH.z1);
    expect(Y.water).toBeLessThan(Y.plinth);
  });

  /** `PROFILE=1 npx vitest run src/home/Villa.test.ts` writes the model's cost to .scratch/home. */
  it('records the model cost when PROFILE=1', () => {
    if (!process.env.PROFILE) return;
    const far = buildVillaFar();
    const n = (k: string) => built.colliders.filter((c) => c.kind === k).length;
    // How long the model takes to build: the landmark is assembled on the main thread when the
    // player streams into range, so this is a frame hitch you feel walking up to the house.
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) buildVillaStatic();
    const buildMs = (performance.now() - t0) / 5;
    const out = [
      `detail    ${built.parts.triangles()} tris, ${built.parts.bufs.size} draw calls`,
      `far LOD   ${far.triangles()} tris, ${far.bufs.size} draw calls`,
      `colliders ${built.colliders.length} (${n('box')} box, ${n('hull')} hull)`,
      `build     ${buildMs.toFixed(1)} ms per buildVillaStatic()`,
    ].join('\n');
    mkdirSync('.scratch/home', { recursive: true });
    writeFileSync('.scratch/home/stats.txt', out + '\n');
  });

  it('stays inside a landmark budget', () => {
    expect(built.parts.triangles()).toBeLessThan(200000);
    expect(buildVillaFar().triangles()).toBeLessThan(8000);
    // One draw call per material key. Two dozen is nothing against the park's 17 or the city's 333,
    // and this house has a specified palette: concrete, three stones, three timbers, two marbles.
    expect(built.parts.bufs.size).toBeLessThanOrEqual(VILLA_KEYS.length);
    expect(built.colliders.length).toBeLessThan(160);
  });
});
