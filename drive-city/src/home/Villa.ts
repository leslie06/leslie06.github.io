import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms } from '../game/Contracts';
import { Parts, box, circlePoly, cyl, flat, lathe, prism, rectPoly } from '../city/landmarks/kit/geo';
import { landmarkMaterials, nightGlow } from '../city/landmarks/kit/mats';
import { stairFlight } from '../city/landmarks/kit/hall';
import {
  DOOR, DRIVE, ENTRY, FORECOURT, GARAGE, GARAGE_DOOR, GATE, HOUSE, LIGHTS, PARK_AT, PLOT, POOL,
  STAIR, TERRACE, TERRACE_DOOR, TREES, UPPER, VOID, WALL, Y,
} from './Layout';

/**
 * The villa itself: a modern stone-and-glass house you can drive into, walk into and walk around.
 *
 * Everything static is baked into the landmark (landmark.ts) because a landmark is built once and
 * never animated; the garage door is the exception and is built here for home/index.ts to move.
 *
 * Two rules the kit imposes and this file has to respect:
 *   - `Parts.build` throws if a buffer's key has no material, so villaMaterials must cover every
 *     key used by the detail model AND the far one. VILLA_KEYS makes that a compile-time fact.
 *   - `placeLandmarks` auto-builds trimesh colliders from meshes named marble/paving/granite/stone,
 *     preferring the far LOD. Every key here starts with `v`, so nothing is picked up by accident
 *     and every surface you stand on is an explicit box or hull below.
 */

type Rect = { x0: number; x1: number; z0: number; z1: number };
const poly = (r: Rect): [number, number][] => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
const mid = (a: number, b: number) => (a + b) / 2;
const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Box collider from a rectangle and a height range. */
const slab = (r: Rect, y0: number, y1: number): ColliderSpec =>
  ({ kind: 'box', center: [mid(r.x0, r.x1), mid(y0, y1), mid(r.z0, r.z1)], half: [(r.x1 - r.x0) / 2, (y1 - y0) / 2, (r.z1 - r.z0) / 2] });

/**
 * Every material key the villa's own geometry uses. `villaMaterials` is typed
 * Record<VillaKey, Material>, so tsc refuses a missing or stray one - worth pinning down because
 * `Parts.build` throws on a key with no material and `placeLandmarks` would only console.warn,
 * leaving the house silently absent from the city.
 */
export const VILLA_KEYS = ['vStone', 'vWall', 'vTrim', 'vGlass', 'vWood', 'vFloor', 'vRoof',
  'vDrive', 'vPave', 'vLawn', 'vWater', 'vHedge', 'vTrunk', 'vLeaf', 'vLight'] as const;
export type VillaKey = (typeof VILLA_KEYS)[number];

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();

/** The landmark kit's materials plus the villa's own: travertine, render, bronze, glass, water. */
export function villaMaterials(env: EnvUniforms): Record<string, THREE.Material> {
  const hit = matCache.get(env);
  if (hit) return hit;
  const std = (p: THREE.MeshStandardMaterialParameters, glow: 'flood' | 'lamp' | null = 'flood',
    color = '#ffe3b8', wet: boolean | 'ground' | 'surface' = 'surface') => {
    const m = new THREE.MeshStandardMaterial(p);
    if (glow) nightGlow(m, env, glow, color);
    m.userData.wet = wet;
    return m;
  };
  /** Coplanar ground needs polygon offset, not millimetre lifts: all of this paving sits within a
   *  centimetre of the city's own ground plane and of the OSM parking/pitch polygons under the
   *  plot, which the depth buffer cannot separate a few hundred metres out. Bigger k = drawn over. */
  const layer = <T extends THREE.Material>(m: T, k: number): T => {
    m.polygonOffset = true; m.polygonOffsetFactor = -k; m.polygonOffsetUnits = -k;
    return m;
  };
  /**
   * Real glass, not the kit's curtain-wall shader. That shader draws convincing mullions but is
   * opaque, which for a glass house is the wrong trade: from the sofa you saw flat blue panels
   * instead of the garden. One double-sided pane per wall (transparent geometry must not be drawn
   * twice) with the frame as separate solid mullions, and no depth write so it never fights them.
   */
  const glass = new THREE.MeshStandardMaterial({
    color: '#c3d6de', roughness: 0.05, metalness: 0.16,
    transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });
  glass.userData.wet = 'surface';
  const own: Record<VillaKey, THREE.Material> = {
    /** Warm travertine cladding: the walls, the piers, the boundary wall. */
    vStone: std({ color: '#d9d2c4', roughness: 0.66 }, 'flood', '#ffe3b8', true),
    /** White render on the upper volume, and the soffits. */
    vWall: std({ color: '#ece9e2', roughness: 0.72 }, 'flood', '#ffe8c8', true),
    /** Dark bronze: window frames, fascias, railings, the gate infill. */
    vTrim: std({ color: '#3a3a36', metalness: 0.55, roughness: 0.45 }),
    vGlass: glass,
    /** Timber: the entrance soffit, the deck, the furniture. */
    vWood: std({ color: '#9d7c53', roughness: 0.78 }, 'flood', '#ffe3b8', true),
    /** Pale indoor floor, and the stair. */
    vFloor: std({ color: '#e3ded2', roughness: 0.42 }, 'lamp', '#ffe0b0'),
    vRoof: std({ color: '#918f88', roughness: 0.88 }, null, '#fff', true),
    vDrive: layer(std({ color: '#54544f', roughness: 0.8 }, 'flood', '#ffe3b8', 'ground'), 2.6),
    vPave: layer(std({ color: '#cdc6b8', roughness: 0.8 }, 'flood', '#ffe3b8', 'ground'), 3.0),
    vLawn: layer(std({ color: '#6d8a52', roughness: 0.95 }, null, '#fff', true), 1.6),
    vWater: layer(std({ color: '#2f6f80', roughness: 0.06, metalness: 0.2 }, null, '#fff', false), 2.2),
    vHedge: std({ color: '#4a6338', roughness: 0.92 }, null, '#fff', true),
    vTrunk: std({ color: '#6b5a45', roughness: 0.95 }, null, '#fff', true),
    vLeaf: std({ color: '#5c7c46', roughness: 0.9 }, null, '#fff', true),
    /** Self-lit: the bollards, the light over the garage door, the plate by the gate. */
    vLight: std({ color: '#f6efdc', roughness: 0.4 }, 'lamp', '#ffdca8'),
  };
  const m: Record<string, THREE.Material> = { ...landmarkMaterials(env), ...own };
  matCache.set(env, m);
  return m;
}

// --------------------------------------------------------------------------------------- helpers

/** A rounded blob of foliage: tree crowns and shrubs. ~110 triangles. */
function blob(P: Parts, key: string, cx: number, cz: number, r: number, y: number, h: number): void {
  lathe(P.get(key), [
    [0.02, y - h / 2], [r * 0.5, y - h * 0.36], [r * 0.9, y - h * 0.1], [r, y + h * 0.06],
    [r * 0.82, y + h * 0.28], [r * 0.46, y + h * 0.42], [0.02, y + h / 2],
  ], 9, cx, cz);
}

/**
 * Thin fascia band round the edge of a flat roof. This used to be one box spanning the whole roof,
 * which covered `vRoof` completely and read as a black hole from the air.
 */
function fascia(P: Parts, r: Rect, y: number, band = 0.45, h = 0.26): void {
  const b = P.get('vTrim');
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  box(b, mid(r.x0, r.x1), y, r.z0, w + band, h, band);
  box(b, mid(r.x0, r.x1), y, r.z1, w + band, h, band);
  box(b, r.x0, y, mid(r.z0, r.z1), band, h, d);
  box(b, r.x1, y, mid(r.z0, r.z1), band, h, d);
}

type Gap = { along: 'x' | 'z'; at: number; w: number; top: number };

/** How an opening splits a wall run, and the head left over it. Shared by solid and glazed walls. */
function runRects(r: Rect, gap?: Gap): { solid: Rect[]; head: Rect | null } {
  if (!gap) return { solid: [r], head: null };
  const lo = gap.at - gap.w / 2, hi = gap.at + gap.w / 2;
  const parts: Rect[] = gap.along === 'x' ? [{ ...r, x1: lo }, { ...r, x0: hi }] : [{ ...r, z1: lo }, { ...r, z0: hi }];
  const solid = parts.filter((p) => (gap.along === 'x' ? p.x1 - p.x0 : p.z1 - p.z0) > 0.05);
  const head = gap.along === 'x' ? { ...r, x0: lo, x1: hi } : { ...r, z0: lo, z1: hi };
  return { solid, head };
}

/** A solid wall run with an optional opening in it; returns the collider boxes. */
function wallRun(P: Parts, key: string, r: Rect, y0: number, y1: number, gap?: Gap): ColliderSpec[] {
  const b = P.get(key);
  const { solid, head } = runRects(r, gap);
  const out: ColliderSpec[] = [];
  for (const p of solid) { prism(b, poly(p), y0, y1, { top: false }); out.push(slab(p, y0, y1)); }
  if (head && gap && gap.top < y1) { prism(b, poly(head), gap.top, y1, { top: false }); out.push(slab(head, gap.top, y1)); }
  return out;
}

/** A glazed wall: one transparent pane per bay plus solid mullions, head and sill. */
function glazedRun(P: Parts, r: Rect, y0: number, y1: number, gap?: Gap): ColliderSpec[] {
  const g = P.get('vGlass'), t = P.get('vTrim');
  const { solid, head } = runRects(r, gap);
  const out: ColliderSpec[] = [];
  const horiz = r.x1 - r.x0 >= r.z1 - r.z0;
  const cx = mid(r.x0, r.x1), cz = mid(r.z0, r.z1);
  const h = y1 - y0, cy = mid(y0, y1);
  for (const p of solid) {
    const w = horiz ? p.x1 - p.x0 : p.z1 - p.z0;
    const px = horiz ? mid(p.x0, p.x1) : cx, pz = horiz ? cz : mid(p.z0, p.z1);
    box(g, px, cy, pz, horiz ? w : 0.03, h, horiz ? 0.03 : w, { faces: horiz ? 'Z' : 'X' });
    for (const y of [y0 + 0.07, y1 - 0.07]) box(t, px, y, pz, horiz ? w : 0.15, 0.14, horiz ? 0.15 : w);
    const n = Math.max(1, Math.round(w / 1.7));
    for (let i = 0; i <= n; i++) {
      const o = -w / 2 + (i * w) / n;
      box(t, horiz ? px + o : px, cy, horiz ? pz : pz + o, 0.13, h, 0.13);
    }
    out.push(slab(p, y0, y1));
  }
  if (head && gap && gap.top < y1) {
    prism(P.get('vWall'), poly(head), gap.top, y1, { top: false });
    out.push(slab(head, gap.top, y1));
  }
  return out;
}

// ------------------------------------------------------------------------------- ground and garden

function ground(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  flat(P.get('vLawn'), rectPoly(PLOT.hw, PLOT.hd), Y.lawn);
  for (const r of [DRIVE.in, DRIVE.corner, DRIVE.apron]) flat(P.get('vDrive'), poly(r), Y.drive);
  for (const r of [FORECOURT, TERRACE]) flat(P.get('vPave'), poly(r), Y.pave);
  // A path from the terrace round the pool, so the lawn is not the only way to the water.
  flat(P.get('vPave'), poly({ x0: POOL.x0 - 2.2, x1: POOL.x1 + 2.2, z0: POOL.z0 - 0.1, z1: POOL.z1 + 2.2 }), Y.pave);

  // Pool: a raised coping ring you step over, the basin cut below it, water just under the lip.
  const stone = P.get('vPave');
  const outer = { x0: POOL.x0 - POOL.rim, x1: POOL.x1 + POOL.rim, z0: POOL.z0 - POOL.rim, z1: POOL.z1 + POOL.rim };
  for (const r of [
    { x0: outer.x0, x1: outer.x1, z0: outer.z0, z1: POOL.z0 },
    { x0: outer.x0, x1: outer.x1, z0: POOL.z1, z1: outer.z1 },
    { x0: outer.x0, x1: POOL.x0, z0: POOL.z0, z1: POOL.z1 },
    { x0: POOL.x1, x1: outer.x1, z0: POOL.z0, z1: POOL.z1 },
  ]) {
    prism(stone, poly(r), Y.pave, POOL.coping);
    out.push(slab(r, Y.pave, POOL.coping));
  }
  prism(P.get('vTrim'), poly(POOL), Y.basin, POOL.coping - 0.02, { top: false });
  flat(P.get('vTrim'), poly(POOL), Y.basin);
  flat(P.get('vWater'), poly(POOL), Y.water);

  // Boundary wall on the plot line, with the gate left open on the west side.
  const w = P.get('vStone'), cap = P.get('vWall');
  const hx = PLOT.hw - WALL.inset, hz = PLOT.hd - WALL.inset;
  const gz0 = GATE.z - GATE.w / 2, gz1 = GATE.z + GATE.w / 2;
  const runs: Rect[] = [
    { x0: -hx, x1: hx, z0: -hz - WALL.t / 2, z1: -hz + WALL.t / 2 },
    { x0: -hx, x1: hx, z0: hz - WALL.t / 2, z1: hz + WALL.t / 2 },
    { x0: hx - WALL.t / 2, x1: hx + WALL.t / 2, z0: -hz, z1: hz },
    { x0: -hx - WALL.t / 2, x1: -hx + WALL.t / 2, z0: -hz, z1: gz0 },
    { x0: -hx - WALL.t / 2, x1: -hx + WALL.t / 2, z0: gz1, z1: hz },
  ];
  for (const r of runs) {
    prism(w, poly(r), 0, WALL.h);
    box(cap, mid(r.x0, r.x1), WALL.h + WALL.cap / 2, mid(r.z0, r.z1), r.x1 - r.x0 + 0.18, WALL.cap, r.z1 - r.z0 + 0.18);
    out.push(slab(r, 0, WALL.h));
  }
  // Gate piers, the open leaves folded back against them, and the house number.
  for (const s of [-1, 1]) {
    const z = GATE.z + s * (GATE.w / 2 + GATE.pierW / 2);
    box(w, -hx, GATE.pierH / 2, z, GATE.pierW, GATE.pierH, GATE.pierW);
    box(cap, -hx, GATE.pierH + 0.09, z, GATE.pierW + 0.24, 0.18, GATE.pierW + 0.24);
    out.push({ kind: 'box', center: [-hx, GATE.pierH / 2, z], half: [GATE.pierW / 2, GATE.pierH / 2, GATE.pierW / 2] });
    const bar = P.get('vTrim');
    const zi = GATE.z + s * (GATE.w / 2 - 0.1);
    for (let i = 0; i < 9; i++) box(bar, -hx + 0.6 + i * 0.42, 1.1, zi, 0.07, 2.0, 0.07);
    for (const y of [0.2, 2.05]) box(bar, -hx + 2.3, y, zi, 3.8, 0.12, 0.1);
  }
  box(P.get('vLight'), -hx + GATE.pierW / 2 + 0.02, 2.1, GATE.z - GATE.w / 2 - GATE.pierW / 2, 0.04, 0.5, 0.9);
  return out;
}

/** Trees, shrubs and the bollard lights: what makes the plot a garden rather than a lawn. */
function garden(P: Parts): void {
  const trunk = P.get('vTrunk');
  // Rounded crowns, not cones: the city's own street trees are leaf-card broadleaves (city/
  // Vegetation.ts) and a cone next to them reads as a traffic cone. Two offset lobes per tree,
  // jittered off the position so no two are identical.
  for (const [x, z, h] of TREES) {
    const th = h * 0.44;
    cyl(trunk, x, 0, z, 0.24, 0.17, th, 6);
    const r = h * 0.33, cy = th + (h - th) / 2, ch = h - th;
    blob(P, 'vLeaf', x, z, r, cy, ch);
    blob(P, 'vLeaf', x + (hash(x * 3.1 + z) - 0.5) * r * 0.8, z + (hash(z * 2.7 + x) - 0.5) * r * 0.8,
      r * 0.62, cy + ch * 0.16, ch * 0.66);
  }
  // Clipped hedge inside the north and east walls.
  const hedge = P.get('vHedge');
  const hx = PLOT.hw - WALL.inset, hz = PLOT.hd - WALL.inset;
  box(hedge, 0, 0.6, -hz + 1.4, 2 * hx - 6, 1.2, 1.6);
  box(hedge, hx - 1.4, 0.6, 4, 1.6, 1.2, 2 * hz - 14);
  // Round shrubs either side of the entrance path, rather than the two foam blocks this was.
  for (const s of [-1, 1]) {
    const z = ENTRY.z + s * 3.2;
    for (let i = 0; i < 5; i++) {
      const x = FORECOURT.x0 + 0.8 + i * 1.25;
      const r = 0.5 + hash(x * 5.7 + z) * 0.22;
      blob(P, 'vHedge', x, z + (hash(z * 1.7 + x) - 0.5) * 0.5, r, r * 0.85, r * 1.7);
    }
  }
  const post = P.get('vTrim'), lens = P.get('vLight');
  for (const [x, z] of LIGHTS) {
    cyl(post, x, 0, z, 0.09, 0.09, 0.78, 6);
    box(lens, x, 0.84, z, 0.2, 0.12, 0.2);
  }
}

// ------------------------------------------------------------------------------------------ house

function house(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const t = HOUSE.wall;
  const { x0, x1, z0, z1, floor0, ceil0, floor1, ceil1, roof } = HOUSE;

  // --- ground floor shell. Stone to the north and east, glass to the south and west.
  out.push(...wallRun(P, 'vStone', { x0: x0 - t, x1, z0: z0 - t, z1: z0 }, 0, ceil0));
  out.push(...wallRun(P, 'vStone', { x0: x1, x1: x1 + t, z0: z0 - t, z1: z1 + t }, 0, ceil0));
  out.push(...glazedRun(P, { x0, x1, z0: z1, z1: z1 + t }, floor0 - 0.12, ceil0,
    { along: 'x', at: TERRACE_DOOR.x, w: TERRACE_DOOR.w, top: floor0 + 2.4 }));
  // West face: glazed hall south of the garage wing, with the front door in it.
  out.push(...glazedRun(P, { x0: x0 - t, x1: x0, z0: GARAGE.z1, z1: z1 + t }, floor0 - 0.12, ceil0,
    { along: 'z', at: ENTRY.z, w: ENTRY.w, top: floor0 + 2.4 }));
  // Between the garage and the hall.
  out.push(...wallRun(P, 'vStone', { x0: x0 - t, x1: x0, z0: z0 - t, z1: GARAGE.z1 }, 0, ceil0,
    { along: 'z', at: GARAGE_DOOR.z, w: GARAGE_DOOR.w, top: floor0 + 2.2 }));

  // Ground floor slab, and the ceiling over the rooms.
  const inside = { x0, x1, z0, z1 };
  out.push(slab(inside, 0, floor0));
  flat(P.get('vFloor'), poly(inside), floor0);
  flat(P.get('vWall'), poly(inside), ceil0, true);

  // --- first floor: slab in two pieces, leaving the stair void open.
  const slabA = { x0: UPPER.x0, x1: VOID.x0, z0: UPPER.z0, z1: UPPER.z1 };
  const slabB = { x0: VOID.x0, x1: UPPER.x1, z0: UPPER.z0, z1: VOID.z0 };
  for (const s of [slabA, slabB]) {
    flat(P.get('vFloor'), poly(s), floor1);
    flat(P.get('vWall'), poly(s), ceil0 + 0.02, true);
    out.push(slab(s, ceil0, floor1));
  }
  // Upper volume: render to the north and east, glass to the south and west.
  out.push(...wallRun(P, 'vWall', { x0: UPPER.x0 - t, x1: UPPER.x1 + t, z0: UPPER.z0 - t, z1: UPPER.z0 }, floor1, ceil1));
  out.push(...wallRun(P, 'vWall', { x0: UPPER.x1, x1: UPPER.x1 + t, z0: UPPER.z0, z1: UPPER.z1 + t }, floor1, ceil1));
  out.push(...glazedRun(P, { x0: UPPER.x0, x1: UPPER.x1, z0: UPPER.z1, z1: UPPER.z1 + t }, floor1, ceil1));
  out.push(...wallRun(P, 'vWall', { x0: UPPER.x0 - t, x1: UPPER.x0, z0: UPPER.z0, z1: UPPER.z1 + t }, floor1, ceil1));
  flat(P.get('vWall'), poly({ x0: UPPER.x0, x1: UPPER.x1, z0: UPPER.z0, z1: UPPER.z1 }), ceil1, true);

  // Roofs: the upper volume's, and the ground-floor roof it leaves as a terrace to the east/south.
  const up = { x0: UPPER.x0 - t, x1: UPPER.x1 + t, z0: UPPER.z0 - t, z1: UPPER.z1 + t };
  flat(P.get('vRoof'), poly(up), roof);
  prism(P.get('vWall'), poly(up), ceil1, roof, { top: false });
  fascia(P, up, roof + 0.12);
  const lowE = { x0: UPPER.x1 + t, x1: x1 + t, z0: z0 - t, z1: z1 + t };
  const lowS = { x0: x0 - t, x1: UPPER.x1 + t, z0: UPPER.z1 + t, z1: z1 + t };
  flat(P.get('vRoof'), poly(lowE), ceil0 + 0.14);
  flat(P.get('vRoof'), poly(lowS), ceil0 + 0.14);
  fascia(P, lowE, ceil0 + 0.2, 0.4, 0.22);
  fascia(P, lowS, ceil0 + 0.2, 0.4, 0.22);
  // Fascia under the cantilever, and the timber soffit over the entrance.
  box(P.get('vTrim'), mid(UPPER.x0, UPPER.x1), floor1 - 0.2, UPPER.z1 + t, UPPER.x1 - UPPER.x0 + 2 * t, 0.4, 0.3);
  flat(P.get('vWood'), poly({ x0: UPPER.x0 - t, x1: x0, z0: GARAGE.z1, z1: UPPER.z1 + t }), ceil0 - 0.02, true);

  // --- entrance steps: two 0.15 m risers, inside the controller's 0.4 m autostep.
  for (let i = 0; i < 2; i++) {
    const r = { x0: x0 - t - 1.1 + i * 0.55, x1: x0 - t, z0: ENTRY.z - ENTRY.w / 2 - 0.7, z1: ENTRY.z + ENTRY.w / 2 + 0.7 };
    const y1 = ENTRY.step * (i + 1);
    prism(P.get('vPave'), poly(r), Y.pave, y1);
    out.push(slab(r, Y.pave, y1));
  }
  // Three steps from the garage floor up into the hall.
  for (let i = 0; i < 3; i++) {
    const r = { x0: x0 - t - 0.9 + i * 0.3, x1: x0 - t, z0: GARAGE_DOOR.z - GARAGE_DOOR.w / 2 - 0.3, z1: GARAGE_DOOR.z + GARAGE_DOOR.w / 2 + 0.3 };
    const y1 = (floor0 / 3) * (i + 1);
    prism(P.get('vFloor'), poly(r), 0, y1);
    out.push(slab(r, 0, y1));
  }

  // --- stair up the east side, and the rail round the void it comes through.
  const run = stairFlight(P, 'vFloor', { x: STAIR.x, z: STAIR.zTop, ry: 0, w: STAIR.w }, floor0, floor1, STAIR.rise, STAIR.tread);
  const zBot = STAIR.zTop + run;
  out.push({
    kind: 'hull',
    points: [
      STAIR.x - STAIR.w / 2, floor0, zBot + 0.1, STAIR.x + STAIR.w / 2, floor0, zBot + 0.1,
      STAIR.x - STAIR.w / 2, floor0, STAIR.zTop - 0.1, STAIR.x + STAIR.w / 2, floor0, STAIR.zTop - 0.1,
      STAIR.x - STAIR.w / 2, floor1, STAIR.zTop - 0.1, STAIR.x + STAIR.w / 2, floor1, STAIR.zTop - 0.1,
      STAIR.x - STAIR.w / 2, floor0 + STAIR.rise, zBot + 0.1, STAIR.x + STAIR.w / 2, floor0 + STAIR.rise, zBot + 0.1,
    ],
  });
  const rail = P.get('vTrim');
  for (let z = VOID.z0; z <= VOID.z1 - 0.4; z += 1.3) box(rail, VOID.x0, floor1 + 0.55, z, 0.07, 1.1, 0.07);
  box(rail, VOID.x0, floor1 + 1.12, mid(VOID.z0, VOID.z1), 0.1, 0.1, VOID.z1 - VOID.z0);
  out.push(slab({ x0: VOID.x0 - 0.1, x1: VOID.x0 + 0.1, z0: VOID.z0, z1: VOID.z1 }, floor1, floor1 + 1.1));

  // --- what makes the rooms rooms: a kitchen run, a sitting group, a bed upstairs.
  const wood = P.get('vWood'), trim = P.get('vTrim'), soft = P.get('vHedge');
  out.push(...wallRun(P, 'vWall', { x0: x0 + 7, x1: x0 + 7.3, z0, z1: z0 + 7 }, floor0, ceil0,
    { along: 'z', at: z0 + 4.2, w: 1.8, top: floor0 + 2.2 }));
  box(wood, x0 + 3.4, floor0 + 0.45, z0 + 1.2, 6.2, 0.9, 0.7);      // kitchen counter
  box(trim, x0 + 3.4, floor0 + 0.92, z0 + 1.2, 6.2, 0.06, 0.74);
  box(wood, x0 + 3.4, floor0 + 0.45, z0 + 4.6, 2.6, 0.9, 1.1);      // island
  // Sitting group: a rug, a sofa with arms and a back, a low table, a screen on the wall.
  box(trim, x0 + 13, floor0 + 0.01, z1 - 5.6, 6.4, 0.02, 4.6);
  box(soft, x0 + 13, floor0 + 0.22, z1 - 4.2, 4.2, 0.44, 1.9);
  box(soft, x0 + 13, floor0 + 0.62, z1 - 5.0, 4.2, 0.44, 0.34);
  for (const s of [-1, 1]) box(soft, x0 + 13 + s * 2.2, floor0 + 0.46, z1 - 4.3, 0.34, 0.92, 1.9);
  box(wood, x0 + 13, floor0 + 0.18, z1 - 7.2, 2.2, 0.36, 1.0);
  box(trim, x0 + 13, floor0 + 1.5, z0 + 7.5, 2.4, 1.36, 0.1);
  // Bedroom upstairs.
  box(wood, x0 + 6, floor1 + 0.28, z0 + 3.4, 2.2, 0.56, 2.0);
  box(soft, x0 + 6, floor1 + 0.62, z0 + 2.5, 2.2, 0.68, 0.24);
  box(trim, x0 + 15, floor1 + 0.3, z0 + 1.0, 3.2, 0.6, 0.5);
  return out;
}

/** The garage wing: three stone walls, a flat roof, and the opening the door fills. */
function garage(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const t = HOUSE.wall, g = GARAGE;
  out.push(...wallRun(P, 'vStone', { x0: g.x0 - t, x1: g.x1, z0: g.z0 - t, z1: g.z0 }, 0, g.roof));
  out.push(...wallRun(P, 'vStone', { x0: g.x0 - t, x1: g.x1, z0: g.z1, z1: g.z1 + t }, 0, g.roof));
  out.push(...wallRun(P, 'vStone', { x0: g.x0 - t, x1: g.x0, z0: g.z0, z1: g.z1 }, 0, g.roof,
    { along: 'z', at: DOOR.z, w: DOOR.w, top: DOOR.h }));
  flat(P.get('vDrive'), poly({ x0: g.x0, x1: g.x1, z0: g.z0, z1: g.z1 }), Y.drive + 0.004);
  const up = { x0: g.x0 - t, x1: g.x1, z0: g.z0 - t, z1: g.z1 + t };
  flat(P.get('vRoof'), poly(up), g.roof);
  prism(P.get('vWall'), poly(up), g.roof - 0.34, g.roof, { top: false });
  fascia(P, up, g.roof + 0.1, 0.4, 0.22);
  // Lintel over the door opening, and a light over it.
  box(P.get('vStone'), g.x0 - t / 2, DOOR.h + 0.25, DOOR.z, t, 0.5, DOOR.w + 0.6);
  box(P.get('vLight'), g.x0 - t - 0.04, DOOR.h + 0.62, DOOR.z, 0.08, 0.16, 1.2);
  return out;
}

export interface VillaStatic { parts: Parts; colliders: ColliderSpec[]; footprint: [number, number][]; height: number }

export function buildVillaStatic(): VillaStatic {
  const P = new Parts();
  const colliders: ColliderSpec[] = [...ground(P), ...garage(P), ...house(P)];
  garden(P);
  return { parts: P, colliders, footprint: rectPoly(PLOT.hw, PLOT.hd), height: HOUSE.roof };
}

/** Outside the footprint: the drive crossing the verge to 恒惠路's kerb. */
export function buildVillaExtras(): Parts {
  const P = new Parts();
  flat(P.get('vDrive'), poly(DRIVE.kerb), Y.drive);
  return P;
}

/** Far LOD: the two volumes, the wall ring, the pool and the trees as massing. */
export function buildVillaFar(): Parts {
  const P = new Parts();
  const t = HOUSE.wall;
  prism(P.get('vStone'), poly({ x0: HOUSE.x0 - t, x1: HOUSE.x1 + t, z0: HOUSE.z0 - t, z1: HOUSE.z1 + t }), 0, HOUSE.ceil0);
  prism(P.get('vWall'), poly({ x0: UPPER.x0 - t, x1: UPPER.x1 + t, z0: UPPER.z0 - t, z1: UPPER.z1 + t }), HOUSE.ceil0, HOUSE.roof);
  prism(P.get('vStone'), poly({ x0: GARAGE.x0 - t, x1: GARAGE.x1, z0: GARAGE.z0 - t, z1: GARAGE.z1 + t }), 0, GARAGE.roof);
  flat(P.get('vLawn'), rectPoly(PLOT.hw, PLOT.hd), Y.lawn);
  flat(P.get('vWater'), poly(POOL), Y.water);
  const hx = PLOT.hw - WALL.inset, hz = PLOT.hd - WALL.inset;
  for (const r of [
    { x0: -hx, x1: hx, z0: -hz - WALL.t / 2, z1: -hz + WALL.t / 2 },
    { x0: -hx, x1: hx, z0: hz - WALL.t / 2, z1: hz + WALL.t / 2 },
    { x0: hx - WALL.t / 2, x1: hx + WALL.t / 2, z0: -hz, z1: hz },
    { x0: -hx - WALL.t / 2, x1: -hx + WALL.t / 2, z0: -hz, z1: hz },
  ]) prism(P.get('vStone'), poly(r), 0, WALL.h);
  for (const [x, z, h] of TREES) blob(P, 'vLeaf', x, z, h * 0.3, h * 0.7, h * 0.6);
  return P;
}

/**
 * The up-and-over garage door, built for home/index.ts to slide: the panel hangs from a group at
 * the head of the opening so moving the group is the whole animation.
 */
export function garageDoor(mats: Record<string, THREE.Material>): THREE.Group {
  const P = new Parts();
  const b = P.get('vTrim'), l = P.get('vLight');
  box(b, 0, 0, 0, DOOR.t, DOOR.h, DOOR.w);
  // Four pressed bands, so the panel reads as a door rather than a slab.
  for (let i = 0; i < 4; i++) {
    box(l, -DOOR.t / 2 - 0.015, -DOOR.h / 2 + (i + 0.5) * (DOOR.h / 4), 0, 0.03, 0.05, DOOR.w - 0.5);
  }
  const g = P.build(mats);
  g.name = 'garageDoor';
  return g;
}

/** Where the corona goes and where the car is meant to stop, in villa-local metres. */
export const PARK_SPOT = PARK_AT;

/** A ring of points for a debug/circle probe; kept so tests can sample the pool surface. */
export const poolRing = (n = 16): [number, number][] => circlePoly((POOL.x1 - POOL.x0) / 2, n, mid(POOL.x0, POOL.x1), mid(POOL.z0, POOL.z1));
