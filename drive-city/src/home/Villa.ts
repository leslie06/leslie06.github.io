import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms } from '../game/Contracts';
import { Parts, box, circlePoly, cyl, flat, hexa, lathe, prism, rectPoly, tube, type V3 } from '../city/landmarks/kit/geo';
import { landmarkMaterials, nightGlow } from '../city/landmarks/kit/mats';
import { grimeTex, marbleTex, pavingTex } from '../city/landmarks/kit/tex';
import {
  BAR, BED, BEDROOMS, CURVES, DECK, DOOR, DOOR_HEAD, DRIVE, EDGE, ENTRY, GARAGE, GARAGE_DOOR, GATE,
  HERO_TREE, HOUSE, LANDING, LIGHTS, PARK_AT, PLINTH, PLOT, POOL, REFLECT, ROOM, SLIDER, STAIR,
  TERRACE, TREES, UPPER_ROOM, UPPER_WALL, VOID, Y, stairAngle, stairPoint,
} from './Layout';
import {
  armchair, art, basin, bed, bench, bookRow, bookStack, bowl, chair, curtains, dressingRun,
  firePit, floorLamp, gallery, lounger, lowTable, mirror, nightstand, outdoorTable, parasol,
  pendantCluster, plant, rug, sconce, sofa, stool, table, tableLamp, towels, tv, vase, wardrobe,
} from './Furniture';

/**
 * The villa: a long modernist bar on a stone plinth, rebuilt from the reference photographs.
 *
 * Everything static is baked into the landmark (landmark.ts) because a landmark is built once and
 * never animated; the garage door is the exception and is built here for home/index.ts to move.
 *
 * Rules the kit imposes and this file respects:
 *   - `Parts.build` throws if a buffer's key has no material, so villaMaterials must cover every
 *     key used by the detail model AND the far one. VILLA_KEYS makes that a compile-time fact.
 *   - `placeLandmarks` auto-builds trimesh colliders from meshes named marble/paving/granite/stone,
 *     preferring the far LOD. Every key here starts with `v`, so nothing is picked up by accident
 *     and every surface you stand on is an explicit box or hull below.
 *   - `ColliderSpec` boxes carry yaw but no pitch, so anything sloped is a convex `hull`. A helical
 *     stair is not convex, so it is several hulls, one per chunk of the arc.
 */

type Rect = { x0: number; x1: number; z0: number; z1: number };
const poly = (r: Rect): [number, number][] => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];
const mid = (a: number, b: number) => (a + b) / 2;
const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const slab = (r: Rect, y0: number, y1: number): ColliderSpec =>
  ({ kind: 'box', center: [mid(r.x0, r.x1), mid(y0, y1), mid(r.z0, r.z1)], half: [(r.x1 - r.x0) / 2, (y1 - y0) / 2, (r.z1 - r.z0) / 2] });
/**
 * A ramp you can walk up, low at `x0` and full height at `x1`. Steps built as stacked boxes are
 * standable (a drop test lands on every tread) but the character controller will not autostep them
 * however small the risers are on paper - it just slides along the face. Boxes carry yaw but no
 * pitch, so every climb here is a convex hull, the same trick the curved stair uses.
 */
const wedge = (x0: number, x1: number, z0: number, z1: number, yLow: number, yHigh: number): ColliderSpec => ({
  kind: 'hull',
  // Walk-only: a ramp gentle enough for a person is gentle enough for a taxi, and the car drove
  // straight up onto the terrace. Cars now pass through it and stop against the plinth face.
  walkOnly: true,
  points: [
    x0, yLow - 0.12, z0, x0, yLow, z0, x0, yLow - 0.12, z1, x0, yLow, z1,
    x1, yLow - 0.12, z0, x1, yHigh, z0, x1, yLow - 0.12, z1, x1, yHigh, z1,
  ],
});
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });
const real = (r: Rect): boolean => r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05;

/**
 * Every material key the villa's own geometry uses. `villaMaterials` is typed
 * Record<VillaKey, Material>, so tsc refuses a missing or stray one - worth pinning down because
 * `Parts.build` throws on a key with no material and `placeLandmarks` would only console.warn,
 * leaving the house silently absent from the city. One draw call each, which at two dozen is
 * nothing against the park's 17 or the city's 333.
 */
export const VILLA_KEYS = [
  'vConcrete', 'vStoneWall', 'vTravertine', 'vTimberClad', 'vTimberCeil', 'vWoodDark', 'vLouvre',
  'vGlass', 'vPlaster', 'vRoof', 'vMarbleDark', 'vMarbleWhite', 'vDeck', 'vWaterDark', 'vLawn',
  'vHedge', 'vTrunk', 'vLeaf', 'vFabricWhite', 'vFabricTan', 'vBrass', 'vLight', 'vFire', 'vRug',
  // The soft furnishings (Furniture.ts): upholstery, curtains, art, mirrors, books, board floors.
  'vFloorWood', 'vVelvet', 'vSheer', 'vDrape', 'vArt', 'vMirror', 'vBook',
] as const;
export type VillaKey = (typeof VILLA_KEYS)[number];

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();

/** The landmark kit's materials plus the villa's own palette, read off the reference photographs. */
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
  /** Coplanar ground needs polygon offset, not millimetre lifts: the paving out here sits within a
   *  centimetre of the city's ground plane and of the OSM parking/pitch polygons under the plot,
   *  which the depth buffer cannot separate a few hundred metres out. Bigger k = drawn over. */
  const layer = <T extends THREE.Material>(m: T, k: number): T => {
    m.polygonOffset = true; m.polygonOffsetFactor = -k; m.polygonOffsetUnits = -k;
    return m;
  };
  /** Real glass: one double-sided pane per bay, no depth write, frames modelled separately. The
   *  kit's curtain-wall shader is opaque, which for a glass house is the wrong trade. */
  const glass = new THREE.MeshStandardMaterial({
    color: '#cfe0e6', roughness: 0.04, metalness: 0.14,
    transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
  });
  glass.userData.wet = 'surface';
  /** One sheer curtain material: transparent, double-sided, and never writing depth. */
  const sheer = new THREE.MeshStandardMaterial({
    color: '#efe9dc', roughness: 0.95, transparent: true, opacity: 0.34,
    side: THREE.DoubleSide, depthWrite: false,
  });
  sheer.userData.wet = false;
  /** Shared kit textures, repeated in metres: flat colour is what made the first pass read as
   *  grey plastic, and these cost nothing (one canvas each, drawn once for the whole city). */
  const rep = <T extends THREE.Texture>(tx: T, sx: number, sy = sx): T => {
    const c = tx.clone(); c.needsUpdate = true; c.repeat.set(1 / sx, 1 / sy); return c as T;
  };
  const own: Record<VillaKey, THREE.Material> = {
    /** Board-formed concrete: the entry wall, the garden walls, the garage. */
    /** The drive and motor court sit 4 mm above the lawn, and the lawn carries a 1.6 depth bias:
     *  without a bigger one of its own the paving loses at eye level and the court reads as grass
     *  (visible from the air, gone from the driver's seat). Under the water at 2.2. */
    vConcrete: layer(std({ color: '#b8b3a8', map: rep(grimeTex(), 6), roughness: 0.78 }, 'flood', '#ffe3b8', true), 2),
    /** Rough-cut travertine block: the stair wall and the great room's fireplace wall. */
    vStoneWall: std({ color: '#c6b291', map: rep(marbleTex(), 2.2), roughness: 0.88 }, 'flood', '#ffe8c8', true),
    /** Pale stone floors, terrace and steps. */
    vTravertine: std({ color: '#d6c8a8', map: rep(pavingTex(), 4), roughness: 0.52 }, 'lamp', '#ffe6bc', true),
    /** Pale vertical timber cladding on the upper bar. */
    vTimberClad: std({ color: '#c79a63', roughness: 0.62 }, 'flood', '#ffd9a0', true),
    /** Warm plank ceilings: the great room and the bedrooms. */
    vTimberCeil: std({ color: '#c2854b', roughness: 0.6 }, 'lamp', '#ffd9a0'),
    /** Dark walnut joinery: kitchen, vanities, credenzas, the stair spine. */
    vWoodDark: std({ color: '#8a5a33', roughness: 0.55 }, 'lamp', '#ffd6a0'),
    /** Dark bronze: louvre blades, window frames, railings, fascias. */
    vLouvre: std({ color: '#2f2f2c', metalness: 0.5, roughness: 0.44 }),
    vGlass: glass,
    vPlaster: std({ color: '#f7f5f0', map: rep(grimeTex(), 9), roughness: 0.76 }, 'lamp', '#ffeccf'),
    vRoof: std({ color: '#8f8d86', roughness: 0.9 }, null, '#fff', true),
    /** Book-matched black marble: the study fireplace. */
    vMarbleDark: std({ color: '#232326', roughness: 0.24, metalness: 0.1 }, 'lamp', '#ffd6a0'),
    vMarbleWhite: std({ color: '#e8e6e0', map: rep(marbleTex(), 3), roughness: 0.2 }, 'lamp', '#ffe6bc'),
    vDeck: std({ color: '#a8794a', roughness: 0.7 }, 'flood', '#ffd9a0', true),
    /** Near-black water: the infinity pool and the entry reflecting pool. */
    vWaterDark: layer(std({ color: '#14232a', roughness: 0.03, metalness: 0.35 }, null, '#fff', false), 2.2),
    vLawn: layer(std({ color: '#6d8a52', roughness: 0.95 }, null, '#fff', true), 1.6),
    vHedge: std({ color: '#425c33', roughness: 0.93 }, null, '#fff', true),
    vTrunk: std({ color: '#6b5a45', roughness: 0.95 }, null, '#fff', true),
    vLeaf: std({ color: '#5c7c46', roughness: 0.9 }, null, '#fff', true),
    vFabricWhite: std({ color: '#e6e1d6', roughness: 0.92 }, 'lamp', '#ffe6c8', true),
    vFabricTan: std({ color: '#9c7350', roughness: 0.9 }, 'lamp', '#ffdcae', true),
    vBrass: std({ color: '#b08d4c', metalness: 0.85, roughness: 0.32 }, 'lamp', '#ffd79a'),
    /** Self-lit: coves, uplights, lamps, the lit mirrors. */
    vLight: std({ color: '#f8f1dd', roughness: 0.4 }, 'lamp', '#ffdca8'),
    /** The fires: the linear gas burner in the great room, the study firebox. */
    vFire: std({ color: '#ff8a2a', roughness: 0.5 }, 'lamp', '#ff7a18'),
    vRug: std({ color: '#7d6a52', map: rep(grimeTex(), 2.6), roughness: 0.95 }, 'lamp', '#ffe6c8', true),
    /** Oak boards: the whole upper floor, where travertine read as an office lobby. */
    vFloorWood: std({ color: '#a87c46', map: rep(pavingTex(), 1.9, 0.42), roughness: 0.48 }, 'lamp', '#ffd9a0'),
    /** The accent upholstery - a deep green - that stops every soft thing being off-white. */
    vVelvet: std({ color: '#3d5a4f', roughness: 0.88 }, 'lamp', '#ffdcae', true),
    vSheer: sheer,
    vDrape: std({ color: '#cbbfa8', map: rep(grimeTex(), 2), roughness: 0.94 }, 'lamp', '#ffe6c8', true),
    /** Artwork: one moody canvas tone behind brass frames. */
    vArt: std({ color: '#5d5346', map: rep(marbleTex(), 1.1), roughness: 0.62 }, 'lamp', '#ffe6c8'),
    vMirror: std({ color: '#cfd8db', metalness: 0.96, roughness: 0.05 }, null, '#fff', 'surface'),
    vBook: std({ color: '#7c3630', roughness: 0.82 }, 'lamp', '#ffd9a0'),
  };
  const m: Record<string, THREE.Material> = { ...landmarkMaterials(env), ...own };
  matCache.set(env, m);
  return m;
}

// --------------------------------------------------------------------------------------- helpers

/** A rounded blob of foliage: tree crowns, shrubs, planters. */
function blob(P: Parts, key: string, cx: number, cz: number, r: number, y: number, h: number): void {
  lathe(P.get(key), [
    [0.02, y - h / 2], [r * 0.5, y - h * 0.36], [r * 0.9, y - h * 0.1], [r, y + h * 0.06],
    [r * 0.82, y + h * 0.28], [r * 0.46, y + h * 0.42], [0.02, y + h / 2],
  ], 9, cx, cz);
}

/** Thin fascia ring round a flat roof. One box over the whole roof hides it and reads as a hole. */
function fascia(P: Parts, r: Rect, y: number, band = 0.4, h = 0.22): void {
  const b = P.get('vLouvre');
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

/** A solid wall run with an optional opening; returns collider boxes. */
function wallRun(P: Parts, key: string, r: Rect, y0: number, y1: number, gap?: Gap): ColliderSpec[] {
  const b = P.get(key);
  const { solid, head } = runRects(r, gap);
  const out: ColliderSpec[] = [];
  for (const p of solid) { prism(b, poly(p), y0, y1, { top: false }); out.push(slab(p, y0, y1)); }
  if (head && gap && gap.top < y1) { prism(b, poly(head), gap.top, y1, { top: false }); out.push(slab(head, gap.top, y1)); }
  return out;
}

/**
 * A glazed wall: one double-sided transparent pane per bay plus solid mullions, head and sill. The
 * reference frames are slim and dark, so the mullions are the read, not the glass.
 */
function glazedRun(P: Parts, r: Rect, y0: number, y1: number, gap?: Gap, bay = 2.4): ColliderSpec[] {
  const g = P.get('vGlass'), t = P.get('vLouvre');
  const { solid, head } = runRects(r, gap);
  const out: ColliderSpec[] = [];
  const horiz = r.x1 - r.x0 >= r.z1 - r.z0;
  const cx = mid(r.x0, r.x1), cz = mid(r.z0, r.z1);
  const h = y1 - y0, cy = mid(y0, y1);
  for (const p of solid) {
    const w = horiz ? p.x1 - p.x0 : p.z1 - p.z0;
    const px = horiz ? mid(p.x0, p.x1) : cx, pz = horiz ? cz : mid(p.z0, p.z1);
    box(g, px, cy, pz, horiz ? w : 0.03, h, horiz ? 0.03 : w, { faces: horiz ? 'Z' : 'X' });
    for (const y of [y0 + 0.06, y1 - 0.06]) box(t, px, y, pz, horiz ? w : 0.12, 0.12, horiz ? 0.12 : w);
    const n = Math.max(1, Math.round(w / bay));
    for (let i = 0; i <= n; i++) {
      const o = -w / 2 + (i * w) / n;
      box(t, horiz ? px + o : px, cy, horiz ? pz : pz + o, 0.1, h, 0.1);
    }
    out.push(slab(p, y0, y1));
  }
  if (head && gap && gap.top < y1) {
    prism(P.get('vPlaster'), poly(head), gap.top, y1, { top: false });
    out.push(slab(head, gap.top, y1));
  }
  return out;
}

/**
 * A horizontal louvre screen: the signature of the upper bar. Blades on edge, spaced so you read
 * stripes from outside and slats of sky from inside.
 */
function louvres(P: Parts, r: Rect, y0: number, y1: number, step = 0.26): void {
  const b = P.get('vLouvre');
  const horiz = r.x1 - r.x0 >= r.z1 - r.z0;
  const w = horiz ? r.x1 - r.x0 : r.z1 - r.z0;
  const cx = mid(r.x0, r.x1), cz = mid(r.z0, r.z1);
  for (let y = y0 + step * 0.5; y < y1; y += step) {
    box(b, cx, y, cz, horiz ? w : 0.1, 0.055, horiz ? 0.1 : w);
  }
  for (const s of [-1, 1]) {
    if (horiz) box(b, cx + s * w / 2, mid(y0, y1), cz, 0.12, y1 - y0, 0.14);
    else box(b, cx, mid(y0, y1), cz + s * w / 2, 0.14, y1 - y0, 0.12);
  }
}

/** Plank battens across a ceiling, the great room's hero surface. */
function planks(P: Parts, r: Rect, y: number, step = 0.5): void {
  const b = P.get('vTimberCeil');
  flat(b, poly(r), y, true);
  for (let x = r.x0 + step; x < r.x1; x += step) box(b, x, y - 0.04, mid(r.z0, r.z1), 0.05, 0.06, r.z1 - r.z0);
}

/** A recessed cove of light round a ceiling, as in every reference interior. */
function cove(P: Parts, r: Rect, y: number): void {
  const l = P.get('vLight'), p = P.get('vPlaster');
  for (const s of [-1, 1]) {
    box(p, mid(r.x0, r.x1), y - 0.14, s > 0 ? r.z1 - 0.3 : r.z0 + 0.3, r.x1 - r.x0, 0.28, 0.6);
    box(l, mid(r.x0, r.x1), y - 0.3, s > 0 ? r.z1 - 0.62 : r.z0 + 0.62, Math.max(0.4, r.x1 - r.x0 - 0.6), 0.06, 0.1);
  }
}

/**
 * Tile `r` with rectangles that avoid `holes`, so a slab can have a pool or a stairwell cut out of
 * it. Cells whose centre falls in a hole are dropped, and so are degenerate ones.
 */
function tileAround(r: Rect, holes: Rect[]): Rect[] {
  const cut = (lo: number, hi: number, vals: number[]) =>
    [...new Set([lo, hi, ...vals.filter((v) => v > lo && v < hi)])].sort((a, b) => a - b);
  const xs = cut(r.x0, r.x1, holes.flatMap((h) => [h.x0, h.x1]));
  const zs = cut(r.z0, r.z1, holes.flatMap((h) => [h.z0, h.z1]));
  const out: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const c = { x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] };
    if (!real(c)) continue;
    const cx = mid(c.x0, c.x1), cz = mid(c.z0, c.z1);
    if (holes.some((h) => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
    out.push(c);
  }
  return out;
}

/** An arc of points at radius r about (cx, cz), for curved steps and retaining walls. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, n = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}

/** A ring segment between two radii: one curved tread, or one curved lawn terrace. */
function ringSeg(r0: number, r1: number, cx: number, cz: number, a0: number, a1: number, n = 24): [number, number][] {
  return [...arc(cx, cz, r0, a0, a1, n), ...arc(cx, cz, r1, a1, a0, n)];
}

// ------------------------------------------------------------------------------- plinth and garden

function plinthAndGround(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const stone = P.get('vTravertine'), conc = P.get('vConcrete');
  flat(P.get('vLawn'), rectPoly(PLOT.hw, PLOT.hd), Y.lawn);
  for (const r of [DRIVE.in, DRIVE.court]) flat(conc, poly(r), Y.court);

  // The plinth: a stone table the house stands on, with the terrace on top.
  prism(stone, poly(PLINTH), Y.lawn, Y.plinth, { top: false });
  // The top has the pools cut out of it: one quad over the whole plinth laid stone across the
  // infinity pool, burying the water 7 cm under it.
  for (const c of tileAround(PLINTH, [POOL, REFLECT])) flat(stone, poly(c), Y.plinth);
  out.push(slab(PLINTH, 0, Y.plinth));

  // Three broad steps from the motor court up onto the plinth. They must climb to the plinth's
  // OUTER face: built against the door they sat 2.7 m inside its solid 1.05 m collider, so the
  // whole approach was one sheer unclimbable wall and you stuck fast on the court at x = -14.3.
  for (let i = 0; i < ENTRY.steps; i++) {
    const r = {
      x0: PLINTH.x0 - (ENTRY.steps - i) * ENTRY.tread, x1: PLINTH.x0,
      z0: ENTRY.z - ENTRY.flight / 2, z1: ENTRY.z + ENTRY.flight / 2,
    };
    const y = ENTRY.riser * (i + 1);
    prism(stone, poly(r), Y.court, y);
    for (const s of [-1, 1]) box(P.get('vLight'), r.x0 + 0.3, y - 0.02, ENTRY.z + s * (ENTRY.flight / 2 - 0.25), 0.16, 0.04, 0.16);
  }
  out.push(wedge(PLINTH.x0 - ENTRY.steps * ENTRY.tread, PLINTH.x0,
    ENTRY.z - ENTRY.flight / 2, ENTRY.z + ENTRY.flight / 2, Y.court, Y.plinth));

  // The black reflecting pool beside the steps, and the infinity pool along the terrace.
  for (const r of [REFLECT, POOL]) {
    prism(P.get('vLouvre'), poly(r), Y.basin, Y.plinth - 0.02, { top: false });
    flat(P.get('vLouvre'), poly(r), Y.basin);
    flat(P.get('vWaterDark'), poly(r), Y.water);
  }
  flat(stone, poly(TERRACE), Y.plinth + 0.004);
  flat(P.get('vDeck'), poly(DECK), Y.plinth + 0.004);

  // Curved steps down to the lawn, then two curved lawn terraces behind low concrete walls.
  const { cx, cz, steps, terraceA, terraceB } = CURVES;
  const a0 = Math.PI * 0.18, a1 = Math.PI * 0.62;
  for (let i = 0; i < steps.n; i++) {
    const r0 = steps.r + i * 0.9, r1 = r0 + 0.9;
    const y = Y.plinth - (Y.plinth - Y.terraceA) * ((i + 1) / steps.n);
    prism(stone, ringSeg(r0, r1, cx, cz, a0, a1, 18), y - 0.02, y + 0.02);
    const m0 = arc(cx, cz, (r0 + r1) / 2, a0, a1, 2)[1];
    out.push({ kind: 'box', center: [m0[0], y - 0.2, m0[1]], half: [(r1 - r0) * 2.2, 0.22, 4.4], yaw: -Math.PI * 0.4 });
  }
  for (const [t, y] of [[terraceA, Y.terraceA], [terraceB, Y.terraceB]] as [{ r: number; wall: number }, number][]) {
    flat(P.get('vLawn'), ringSeg(t.r, t.r + 9, cx, cz, Math.PI * 0.06, Math.PI * 0.74, 26), y);
    prism(conc, ringSeg(t.r, t.r + t.wall, cx, cz, Math.PI * 0.06, Math.PI * 0.74, 26), y - 0.9, y);
  }

  // Low concrete wall and clipped hedge on the plot line, gate open on the west.
  const hx = PLOT.hw - EDGE.inset, hz = PLOT.hd - EDGE.inset;
  const gz0 = GATE.z - GATE.w / 2, gz1 = GATE.z + GATE.w / 2;
  const runs: Rect[] = [
    { x0: -hx, x1: hx, z0: -hz - EDGE.t / 2, z1: -hz + EDGE.t / 2 },
    { x0: -hx, x1: hx, z0: hz - EDGE.t / 2, z1: hz + EDGE.t / 2 },
    { x0: hx - EDGE.t / 2, x1: hx + EDGE.t / 2, z0: -hz, z1: hz },
    { x0: -hx - EDGE.t / 2, x1: -hx + EDGE.t / 2, z0: -hz, z1: gz0 },
    { x0: -hx - EDGE.t / 2, x1: -hx + EDGE.t / 2, z0: gz1, z1: hz },
  ];
  for (const r of runs) {
    prism(conc, poly(r), 0, EDGE.wall);
    out.push(slab(r, 0, EDGE.wall + EDGE.hedge));
    box(P.get('vHedge'), mid(r.x0, r.x1), EDGE.wall + EDGE.hedge / 2, mid(r.z0, r.z1),
      r.x1 - r.x0 + 1.2, EDGE.hedge, r.z1 - r.z0 + 1.2);
  }
  for (const s of [-1, 1]) {
    const z = GATE.z + s * (GATE.w / 2 + GATE.pierW / 2);
    box(conc, -hx, GATE.pierH / 2, z, GATE.pierW, GATE.pierH, GATE.pierW * 1.6);
    out.push({ kind: 'box', center: [-hx, GATE.pierH / 2, z], half: [GATE.pierW / 2, GATE.pierH / 2, GATE.pierW * 0.8] });
  }
  return out;
}

/** Trees, the hero cork oak the house wraps, planting beds and the in-ground uplights. */
function garden(P: Parts): void {
  const trunk = P.get('vTrunk');
  for (const [x, z, h] of TREES) {
    const th = h * 0.42;
    cyl(trunk, x, 0, z, 0.26, 0.18, th, 6);
    const r = h * 0.33, cy = th + (h - th) / 2, ch = h - th;
    blob(P, 'vLeaf', x, z, r, cy, ch);
    blob(P, 'vLeaf', x + (hash(x * 3.1 + z) - 0.5) * r * 0.8, z + (hash(z * 2.7 + x) - 0.5) * r * 0.8,
      r * 0.62, cy + ch * 0.16, ch * 0.66);
  }
  // The cork oak: a low gnarled trunk that forks, where the house steps round it.
  const T = HERO_TREE;
  cyl(trunk, T.x, Y.plinth, T.z, 0.65, 0.5, T.h * 0.3, 8);
  for (const s of [-1, 1]) {
    const bx = T.x + s * 1.7, bz = T.z + s * 1.1;
    tube(trunk, [
      [T.x, Y.plinth + T.h * 0.28, T.z],
      [T.x + s * 0.9, Y.plinth + T.h * 0.45, T.z + s * 0.5],
      [bx, Y.plinth + T.h * 0.62, bz],
    ] as V3[], 0.3, 6);
    blob(P, 'vLeaf', bx, bz, T.h * 0.3, Y.plinth + T.h * 0.72, T.h * 0.5);
  }
  blob(P, 'vLeaf', T.x, T.z, T.h * 0.26, Y.plinth + T.h * 0.8, T.h * 0.44);
  for (let x = PLINTH.x0 + 2; x < PLINTH.x1; x += 3.4) {
    blob(P, 'vHedge', x, PLINTH.z1 + 1.1, 0.85, Y.lawn + 0.5, 1.1);
  }
  // The terrace's east half was a bare stone apron: a planting bed and a clipped row fill it.
  for (let z = 9.5; z < 19; z += 2.2) {
    blob(P, 'vHedge', PLINTH.x1 - 2.2, z, 0.7, Y.plinth + 0.45, 0.95);
    blob(P, 'vLeaf', PLINTH.x1 - 6.0, z + 1.1, 0.5, Y.plinth + 0.35, 0.7);
  }
  for (const [x, z] of LIGHTS) box(P.get('vLight'), x, Y.court + 0.01, z, 0.18, 0.04, 0.18);
}

// ------------------------------------------------------------------------------------------ house

/** The ground floor: hall and curved stair, formal dining, great room, study, glass pavilion. */
function groundFloor(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const t = HOUSE.wall, { floor0, ceil0 } = HOUSE;
  const G = ROOM.great, H = ROOM.hall, D = ROOM.dining, S = ROOM.study, V = ROOM.pavilion;
  const stone = P.get('vStoneWall'), plaster = P.get('vPlaster'), wood = P.get('vWoodDark');

  flat(P.get('vTravertine'), poly({ x0: HOUSE.x0, x1: HOUSE.x1, z0: HOUSE.z0, z1: HOUSE.z1 }), floor0 + 0.01);

  // North elevation: solid, rough stone where the great room's fireplace backs onto it.
  out.push(...wallRun(P, 'vConcrete', { x0: H.x0 - t, x1: G.x0, z0: H.z0 - t, z1: H.z0 }, floor0, ceil0));
  out.push(...wallRun(P, 'vStoneWall', { x0: G.x0, x1: G.x1, z0: G.z0 - t, z1: G.z0 }, floor0, ceil0));
  out.push(...wallRun(P, 'vPlaster', { x0: S.x0, x1: S.x1 + t, z0: S.z0 - t, z1: S.z0 }, floor0, ceil0));
  out.push(...wallRun(P, 'vPlaster', { x0: S.x1, x1: S.x1 + t, z0: S.z0, z1: S.z1 }, floor0, ceil0));
  out.push(...glazedRun(P, { x0: V.x1, x1: V.x1 + t, z0: V.z0 - t, z1: V.z1 + t }, floor0, ceil0, undefined, 2.6));
  // West elevation: the board-formed entry wall with the tall pivot door in it.
  out.push(...wallRun(P, 'vConcrete', { x0: H.x0 - t, x1: H.x0, z0: H.z0 - t, z1: D.z1 + t }, floor0, ceil0,
    { along: 'z', at: ENTRY.z, w: ENTRY.w, top: floor0 + ENTRY.h }));
  box(P.get('vGlass'), H.x0 - t / 2, floor0 + ENTRY.h / 2, ENTRY.z, t * 0.4, ENTRY.h, ENTRY.w, { faces: 'xX' });
  cyl(P.get('vBrass'), H.x0 - t - 0.06, floor0 + 0.5, ENTRY.z - 0.5, 0.035, 0.035, 2.1, 6);
  // South elevation: full-height glass, a wide slider into the great room, clerestory above it.
  out.push(...glazedRun(P, { x0: H.x0, x1: G.x0, z0: D.z1, z1: D.z1 + t }, floor0, ceil0, undefined, 2.4));
  out.push(...glazedRun(P, { x0: G.x0, x1: G.x1, z0: G.z1, z1: G.z1 + t }, floor0, ceil0 - 0.9,
    { along: 'x', at: SLIDER.great.x, w: SLIDER.great.w, top: ceil0 - 0.9 }, 2.8));
  out.push(...glazedRun(P, { x0: G.x0, x1: G.x1, z0: G.z1, z1: G.z1 + t }, ceil0 - 0.85, ceil0, undefined, 2.8));
  out.push(...glazedRun(P, { x0: V.x0, x1: V.x1, z0: V.z1, z1: V.z1 + t }, floor0, ceil0,
    { along: 'x', at: SLIDER.pavilion.x, w: SLIDER.pavilion.w, top: floor0 + 2.6 }, 2.6));
  // Internal walls.
  out.push(...wallRun(P, 'vPlaster', { x0: S.x0 - t, x1: S.x0, z0: S.z0, z1: S.z1 }, floor0, ceil0,
    { along: 'z', at: -9, w: 1.6, top: floor0 + 2.4 }));
  out.push(...wallRun(P, 'vPlaster', { x0: S.x0 - t, x1: V.x0, z0: V.z0 - t, z1: V.z0 }, floor0, ceil0,
    { along: 'x', at: 33, w: 2.4, top: floor0 + 2.6 }));
  out.push(...wallRun(P, 'vStoneWall', { x0: H.x0 + 3.2, x1: H.x0 + 3.5, z0: H.z0, z1: -5 }, floor0, ceil0));

  // Ceilings: timber planks over the great room, plaster with a cove elsewhere.
  planks(P, { x0: G.x0, x1: G.x1, z0: G.z0, z1: G.z1 }, ceil0 - 0.02);
  // Tiled round the stairwell: one quad over the hall caps the void from below.
  for (const r of [H, D, S, V]) {
    for (const c of tileAround(r, [VOID])) flat(plaster, poly(c), ceil0 - 0.02, true);
    cove(P, r, ceil0);
  }

  // --- great room. 24 x 22 m is a hall, not a room, so it is furnished as three zones with rugs
  // under each: the hearth at the north end, the kitchen down the west wall, dining to the south.
  const fx = mid(G.x0, G.x1);
  const glassIn = G.z1 - 0.18;
  const solid = (x: number, z: number, hx: number, hz: number, h: number): void => {
    out.push({ kind: 'box', center: [x, floor0 + h / 2, z], half: [hx, h / 2, hz] });
  };
  // The hearth wall: rough stone, a linear gas fire, the television and lit niches.
  box(stone, fx, floor0 + 1.9, G.z0 + 0.35, 12, 3.8, 0.7);
  box(P.get('vLouvre'), fx - 1.2, floor0 + 0.62, G.z0 + 0.62, 4.6, 0.5, 0.3);
  box(P.get('vFire'), fx - 1.2, floor0 + 0.6, G.z0 + 0.52, 4.2, 0.26, 0.12);
  P.at(fx - 1.2, floor0 + 2.1, G.z0 + 0.72, 0, () => tv(P, 2.4));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    box(plaster, fx + s * 4.6, floor0 + 1.0 + i * 0.8, G.z0 + 0.6, 1.5, 0.06, 0.5);
    box(P.get('vLight'), fx + s * 4.6, floor0 + 1.06 + i * 0.8, G.z0 + 0.42, 1.3, 0.02, 0.06);
  }
  for (const s of [-1, 1]) P.at(fx + s * 4.6, floor0 + 1.3, G.z0 + 0.5, 0, () => bookStack(P, 2));
  // Hearth seating: a long sofa facing the fire, two chairs opposite, a table between them.
  P.at(fx, floor0, G.z0 + 4.2, 0, () => rug(P, 9.0, 6.4));
  P.at(fx, floor0, G.z0 + 6.2, Math.PI, () => sofa(P, 4.4, 1.15, { accent: 'vVelvet' }));
  solid(fx, G.z0 + 6.2, 2.2, 0.6, 0.62);
  P.at(fx, floor0, G.z0 + 4.1, 0, () => lowTable(P, 2.0, 0.95));
  P.at(fx - 0.5, floor0 + 0.4, G.z0 + 4.1, 0.3, () => bookStack(P, 3));
  P.at(fx + 0.55, floor0 + 0.4, G.z0 + 4.1, 0, () => bowl(P, 0.19));
  for (const s of [-1, 1]) P.at(fx + s * 3.4, floor0, G.z0 + 3.4, -s * 1.35, () => armchair(P));
  P.at(fx - 4.4, floor0, G.z0 + 5.6, 0, () => floorLamp(P));
  P.at(fx + 4.6, floor0, G.z0 + 6.4, 0, () => plant(P, 2.3));

  // Kitchen down the west wall: tall units, a run of joinery, the island and its stools.
  const kx = G.x0 + 1.5;
  box(wood, kx - 0.1, floor0 + 1.35, G.z0 + 9.0, 0.9, 2.7, 5.0);
  for (let z = G.z0 + 7.0; z < G.z0 + 11.2; z += 1.4) {
    box(P.get('vTimberClad'), kx + 0.36, floor0 + 1.35, z, 0.03, 2.6, 1.3);
    box(P.get('vBrass'), kx + 0.4, floor0 + 1.35, z + 0.55, 0.02, 0.6, 0.02);
  }
  box(wood, kx + 0.2, floor0 + 0.45, G.z0 + 13.8, 0.7, 0.9, 3.4);
  box(P.get('vMarbleWhite'), kx + 0.2, floor0 + 0.92, G.z0 + 13.8, 0.76, 0.06, 3.5);
  for (const y of [1.6, 2.1]) {
    box(P.get('vTimberClad'), kx + 0.1, floor0 + y, G.z0 + 13.8, 0.5, 0.05, 3.0);
    P.at(kx + 0.1, floor0 + y + 0.03, G.z0 + 13.0, Math.PI / 2, () => bookRow(P, 1.1, 0.22));
  }
  P.at(kx + 0.2, floor0 + 0.95, G.z0 + 12.6, 0, () => vase(P, 0.14, 0.28));
  const ix = G.x0 + 4.6, iz = G.z0 + 11.6;
  box(wood, ix, floor0 + 0.46, iz, 1.5, 0.92, 4.6);
  box(P.get('vMarbleWhite'), ix, floor0 + 0.95, iz, 1.7, 0.08, 4.8);
  solid(ix, iz, 0.85, 2.4, 0.95);
  P.at(ix, floor0 + 0.99, iz - 1.4, 0, () => bowl(P, 0.2));
  P.at(ix - 0.3, floor0 + 0.99, iz + 1.5, 0.2, () => bookStack(P, 2));
  for (let i = 0; i < 3; i++) P.at(ix + 1.35, floor0, iz - 1.5 + i * 1.5, -Math.PI / 2, () => stool(P));
  P.at(ix, ceil0 - 0.1, iz, 0, () => pendantCluster(P, 1.5, 5, 0.8));

  // Dining, on the glass: a long table, eight chairs, a sideboard and the art over it.
  const dx = fx + 2.6, dz = G.z1 - 5.2;
  P.at(dx, floor0, dz, 0, () => rug(P, 6.6, 4.4));
  P.at(dx, floor0, dz, 0, () => table(P, 3.6, 1.5));
  solid(dx, dz, 1.8, 0.75, 0.78);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    P.at(dx - 1.35 + i * 0.9, floor0, dz + s * 1.15, s > 0 ? Math.PI : 0, () => chair(P));
  }
  P.at(dx, floor0 + 0.79, dz, 0, () => bowl(P, 0.22));
  for (const s of [-1, 1]) {
    cyl(P.get('vBrass'), dx + s * 0.9, floor0 + 0.79, dz, 0.045, 0.035, 0.26, 8);
    cyl(P.get('vLight'), dx + s * 0.9, floor0 + 1.05, dz, 0.018, 0.012, 0.1, 6);
  }
  P.at(dx, ceil0 - 0.1, dz, 0, () => pendantCluster(P, 1.6, 7, 0.7));
  box(wood, G.x1 - 0.55, floor0 + 0.4, dz, 0.6, 0.8, 3.2);
  P.at(G.x1 - 0.22, floor0 + 1.9, dz, -Math.PI / 2, () => art(P, 2.2, 1.4));
  P.at(G.x1 - 0.55, floor0 + 0.8, dz - 1.0, 0, () => vase(P, 0.17, 0.36));
  P.at(G.x1 - 0.55, floor0 + 0.8, dz + 1.1, 0.4, () => bookStack(P, 3));

  // A grand piano in the corner of the glass, and the curtains down it.
  const px = G.x1 - 4.2, pz = G.z1 - 2.6;
  box(wood, px, floor0 + 0.72, pz, 2.3, 0.22, 1.5);
  box(P.get('vMarbleDark'), px, floor0 + 0.84, pz, 2.2, 0.04, 1.42);
  box(wood, px - 0.2, floor0 + 1.06, pz - 0.2, 1.9, 0.2, 0.95, { ry: -0.12 });
  box(P.get('vFabricWhite'), px + 0.9, floor0 + 0.76, pz + 0.05, 0.5, 0.06, 1.2);
  for (const [ox, oz] of [[-1.0, -0.6], [-1.0, 0.6], [1.0, 0.0]] as [number, number][]) {
    cyl(P.get('vLouvre'), px + ox, floor0, pz + oz, 0.05, 0.045, 0.72, 6);
  }
  P.at(px - 1.9, floor0, pz + 0.2, 0, () => bench(P, 0.9, 0.36, 'vVelvet'));
  P.at(fx + 2.0, floor0, glassIn, 0, () => curtains(P, 16.0, ceil0 - floor0 - 0.9));
  P.at(G.x0 + 2.0, floor0, G.z1 - 1.4, 0, () => plant(P, 2.6));

  // --- formal dining room: round table, drum chandelier, bar run, art on the stone wall.
  const rx = mid(D.x0, D.x1), rz = mid(D.z0, D.z1);
  P.at(rx, floor0, rz, 0, () => rug(P, 5.4, 5.4));
  cyl(wood, rx, floor0 + 0.68, rz, 1.5, 1.5, 0.08, 20);
  cyl(wood, rx, floor0, rz, 0.42, 0.36, 0.68, 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    P.at(rx + Math.cos(a) * 2.0, floor0, rz + Math.sin(a) * 2.0, -a - Math.PI / 2, () => chair(P));
  }
  solid(rx, rz, 1.5, 1.5, 0.76);
  P.at(rx, floor0 + 0.76, rz, 0, () => vase(P, 0.2, 0.4));
  cyl(P.get('vBrass'), rx, ceil0 - 1.35, rz, 0.62, 0.62, 0.5, 16, { bottom: true });
  cyl(P.get('vLight'), rx, ceil0 - 1.3, rz, 0.5, 0.5, 0.4, 16, { bottom: true });
  cyl(P.get('vBrass'), rx, ceil0 - 0.85, rz, 0.02, 0.02, 0.85, 6);
  box(stone, D.x1 - 0.2, floor0 + 1.9, rz, 0.3, 3.0, 5.0);
  P.at(D.x1 - 0.4, floor0 + 1.8, rz, -Math.PI / 2, () => art(P, 2.4, 1.5));
  box(wood, D.x1 - 0.8, floor0 + 0.35, rz, 0.6, 0.7, 4.0);
  box(wood, D.x0 + 1.1, floor0 + 1.2, D.z0 + 1.4, 2.0, 2.4, 0.6);
  box(P.get('vLight'), D.x0 + 1.1, floor0 + 1.02, D.z0 + 1.15, 1.7, 0.05, 0.1);
  for (const y of [1.35, 1.85]) P.at(D.x0 + 1.1, floor0 + y, D.z0 + 1.12, 0, () => bookRow(P, 1.6, 0.24));
  P.at(D.x0 + 1.0, floor0, D.z1 - 1.3, 0, () => plant(P, 2.0));

  // --- study: timber panelling, a wall of books, the desk and the black marble fireplace.
  const sx = mid(S.x0, S.x1), sz = mid(S.z0, S.z1);
  box(wood, S.x0 + 0.2, floor0 + 1.6, sz, 0.16, 3.2, S.z1 - S.z0 - 1.2);
  for (let i = 0; i < 4; i++) {
    box(wood, S.x0 + 0.45, floor0 + 1.3 + i * 0.5, sz + 1.6, 0.5, 0.05, 3.4);
    P.at(S.x0 + 0.45, floor0 + 1.33 + i * 0.5, sz + 1.6, Math.PI / 2, () => bookRow(P, 3.2, 0.4));
  }
  P.at(sx, floor0, sz - 1.0, 0, () => rug(P, 4.6, 3.6));
  P.at(sx - 0.6, floor0, sz - 2.0, 0, () => table(P, 2.2, 1.1));
  solid(sx - 0.6, sz - 2.0, 1.1, 0.55, 0.78);
  P.at(sx - 1.2, floor0 + 0.79, sz - 2.0, 0.2, () => bookStack(P, 3));
  P.at(sx - 0.1, floor0 + 0.79, sz - 2.1, 0, () => tableLamp(P, 0.16, 0.4));
  P.at(sx - 0.6, floor0, sz - 3.1, Math.PI, () => armchair(P, { key: 'vWoodDark' }));
  box(P.get('vMarbleDark'), sx + 2.6, floor0 + 1.7, S.z0 + 0.5, 2.6, 3.4, 0.16);
  box(P.get('vFire'), sx + 2.6, floor0 + 0.45, S.z0 + 0.36, 1.5, 0.4, 0.14);
  P.at(sx + 2.6, floor0 + 2.0, S.z0 + 0.44, 0, () => art(P, 1.4, 0.9));
  P.at(sx, floor0, sz + 1.0, Math.PI, () => sofa(P, 2.4, 0.95, { key: 'vFabricTan', accent: 'vVelvet' }));
  P.at(sx + 1.8, floor0, sz + 1.6, 0, () => floorLamp(P));
  P.at(S.x1 - 1.0, floor0, S.z1 - 1.2, 0, () => plant(P, 1.8));

  // --- glass pavilion: white sofas round a marble table, the timber-clad fireplace box.
  const vx = mid(V.x0, V.x1), vz = mid(V.z0, V.z1);
  box(P.get('vTimberClad'), V.x0 + 1.6, floor0 + 2.0, vz - 1.2, 3.0, 2.0, 0.9);
  box(P.get('vGlass'), V.x0 + 1.6, floor0 + 0.6, vz - 1.2, 3.0, 0.8, 0.8, { faces: 'xXzZ' });
  P.at(vx, floor0, vz, 0, () => rug(P, 5.6, 5.6));
  P.at(vx, floor0, vz, 0, () => lowTable(P, 2.2, 1.1, 0.38));
  P.at(vx - 0.5, floor0 + 0.42, vz, 0.3, () => bookStack(P, 3));
  P.at(vx + 0.6, floor0 + 0.42, vz, 0, () => bowl(P, 0.18));
  for (const sz2 of [-1, 1]) {
    P.at(vx, floor0, vz + sz2 * 2.0, sz2 > 0 ? Math.PI : 0, () => sofa(P, 2.8, 1.0));
    solid(vx, vz + sz2 * 2.0, 1.4, 0.5, 0.6);
  }
  P.at(V.x1 - 1.2, floor0, vz + 2.4, -0.8, () => armchair(P, { key: 'vVelvet' }));
  P.at(V.x0 + 1.0, floor0, V.z1 - 1.2, 0, () => plant(P, 2.2));
  P.at(V.x1 - 1.0, floor0, V.z0 + 1.2, 0, () => plant(P, 1.7));
  return out;
}

/**
 * The curved timber stair, and the colliders that carry the player up it.
 *
 * Four things here are load-bearing, and every one of them is a bug the player walked into while
 * the whole test suite was green:
 *   - The flight rises in open air. LANDING is paving laid on the slab, not a slab of its own: as
 *     a 0.25 m slab at floor level it sat directly over treads 13-18, so the climb ended at 3.5 m
 *     against the underside of a floor and the last six treads were sealed inside it.
 *   - One hull per tread. A hull is convex and an arc is not: chunking three treads into one hull
 *     made its outer edge a chord, and the arc bulges 0.22 m outside that chord at mid span. The
 *     outer quarter of every third tread was a hole, and you fell up to 2.3 m through it. At one
 *     tread the chord error is 1.4 cm, which the +0.03 on the radii covers.
 *   - The hulls are slabs under the treads, not wedges down to the floor, so the space under the
 *     flight stays as open as it looks.
 *   - Risers, and a wall each side. Open treads read as twenty floating planks, and a drawn
 *     balustrade stops nobody: the drop off the outer edge is the height of the stair.
 */
function curvedStair(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const tread = P.get('vWoodDark'), rail = P.get('vLouvre');
  const { cx, cz, r, w, a0, a1, treads } = STAIR;
  const y0 = HOUSE.floor0, y1 = HOUSE.floor1;
  const rr = (y1 - y0) / treads;
  const inner = r - w / 2, outer = r + w / 2;
  /** Angle between treads. Tread depth follows the arc at the outer edge, or they gap apart. */
  const step = (a1 - a0) / (treads - 1);
  const depth = outer * Math.abs(step) * 1.06;
  /** Tread thickness, and the riser that closes the rest of the rise behind it. */
  const T = 0.1;
  const { hand } = STAIR;
  const pt = (a: number, rad: number, y: number): [number, number, number] => {
    const p = stairPoint(a, rad);
    return [p.x, y, p.z];
  };
  const railPts: V3[] = [];
  for (let i = 0; i < treads; i++) {
    const a = a0 + step * i;
    const y = y0 + (i + 1) * rr;
    // Local +Z of a tread is the way the plan angle grows, which is up the flight only when the
    // stair swings east: the riser closes the *downhill* edge, so it follows `hand`.
    const { x: tx, z: tz } = stairPoint(a, r), yaw = -stairAngle(a);
    P.at(tx, y - T / 2, tz, yaw, () => box(tread, 0, 0, 0, w, T, depth));
    if (i > 0) P.at(tx, y - T - (rr - T) / 2, tz, yaw, () => box(tread, 0, 0, hand * (-depth / 2 + 0.04), w, rr - T, 0.07));
    const { x: bx, z: bz } = stairPoint(a, outer - 0.08);
    railPts.push([bx, y + 0.95, bz]);
    if (i % 2 === 0) box(rail, bx, y + 0.47, bz, 0.035, 0.9, 0.035);
  }
  // Stone paving at the arrival, laid over the boards like the bathrooms - not a slab.
  flat(P.get('vTravertine'), poly(LANDING), y1 + 0.006);
  // The spine carries on past the first floor as the stairwell's inner parapet. Stopping it 0.3 m
  // short of the floor left the top four treads with an open inner edge over a 3.6 m drop into the
  // hollow middle of the helix - the same fall as walking off the outer side.
  const spineTop = y1 + 0.95;
  const sA = stairAngle(a0 - 0.06), sB = stairAngle(a1 + 0.06);
  prism(tread, ringSeg(inner - 0.22, inner, cx, cz, Math.min(sA, sB), Math.max(sA, sB), 20), y0, spineTop);
  tube(rail, railPts, 0.03, 6);

  /** The walking surface at angle `a`: the tread tops, read as a ramp between their centres. */
  const ramp = (a: number): number => Math.min(y1, Math.max(y0, y0 + ((a - a0) / step + 1) * rr));
  for (let i = 0; i < treads; i++) {
    const aLo = a0 + step * (i - 0.5), aHi = a0 + step * (i + 0.5);
    const pts: number[] = [];
    for (const [a, top] of [[aLo, ramp(aLo)], [aHi, ramp(aHi)]] as [number, number][]) {
      for (const rad of [inner - 0.03, outer + 0.03]) {
        pts.push(...pt(a, rad, top), ...pt(a, rad, top - 0.3));
      }
    }
    out.push({ kind: 'hull', points: pts });
  }
  // The two walls: the spine on the inside (drawn, and until now walk-through), a guard on the
  // outside. One box per two treads keeps each chord within 3 cm of its arc.
  for (let i = 0; i < treads; i += 2) {
    const a = a0 + step * (i + 0.5);
    const chord = (rad: number) => 2 * rad * Math.sin(step);
    const guard = outer + 0.05, y = ramp(a);
    out.push({ kind: 'box', yaw: -stairAngle(a), center: pt(a, guard, y + 0.3), half: [0.05, 0.7, chord(guard) / 2] });
    const spine = inner - 0.11;
    out.push({ kind: 'box', yaw: -stairAngle(a), center: pt(a, spine, mid(y0, spineTop)), half: [0.11, (spineTop - y0) / 2, chord(spine) / 2] });
  }
  return out;
}

/**
 * The upper bar: slab, louvred elevations, three bedrooms and the master suite, the roof.
 *
 * The plan and its doors come from Layout's UPPER_ROOM / UPPER_WALL, so a room cannot be added
 * here without a wall and a door to reach it - which is what went wrong before: three bedrooms
 * were declared and the dividing walls were built only where two rooms happened to share an x
 * edge, leaving one open loft with beds standing about in it.
 */
function upperBar(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const t = HOUSE.wall, { ceil0, floor1, ceil1, roof } = HOUSE;
  const plaster = P.get('vPlaster'), wood = P.get('vWoodDark'), marble = P.get('vMarbleWhite');
  const R = UPPER_ROOM;
  /** How far a wall-hung thing stands off a room's nominal edge: half the wall, plus a hair. */
  const face = t / 2 + 0.03;
  /** Inner face of the south glass, where the curtains hang. */
  const glassIn = BAR.z1 - t - 0.16;
  const H = ceil1 - floor1;
  /** Furniture the player should walk round rather than through. */
  const solid = (x: number, z: number, hx: number, hz: number, h: number): void => {
    out.push({ kind: 'box', center: [x, floor1 + h / 2, z], half: [hx, h / 2, hz] });
  };

  // Slab in pieces, leaving the stair void open. Degenerate pieces are skipped: the void reaches
  // the bar's west wall, so the strip west of it has zero width.
  const pieces: Rect[] = [
    { x0: BAR.x0, x1: VOID.x0, z0: BAR.z0, z1: BAR.z1 },
    { x0: VOID.x0, x1: VOID.x1, z0: BAR.z0, z1: VOID.z0 },
    { x0: VOID.x0, x1: VOID.x1, z0: VOID.z1, z1: BAR.z1 },
    { x0: VOID.x1, x1: BAR.x1, z0: BAR.z0, z1: BAR.z1 },
  ];
  for (const p of pieces) {
    if (!real(p)) continue;
    flat(P.get('vFloorWood'), poly(p), floor1);
    flat(plaster, poly(p), ceil0 + 0.02, true);
    out.push(slab(p, ceil0, floor1));
  }
  // The wet rooms get stone over the boards.
  for (const r of [R.bath1, R.bath2]) flat(marble, poly(r), floor1 + 0.006);

  // Soffit under the cantilever: pale timber, with a linear light at its edge.
  flat(P.get('vTimberClad'), poly({ x0: BAR.x0, x1: BAR.x1, z0: HOUSE.z1 + t, z1: BAR.z1 }), ceil0 - 0.02, true);
  box(P.get('vLight'), mid(BAR.x0, BAR.x1), ceil0 - 0.12, BAR.z1 - 0.5, BAR.x1 - BAR.x0 - 1.5, 0.06, 0.12);
  flat(P.get('vTimberClad'), poly({ x0: BAR.x0, x1: HOUSE.x0 - t, z0: BAR.z0, z1: BAR.z1 }), ceil0 - 0.02, true);

  // Elevations: glass to the south and round the master's east corner, timber elsewhere.
  out.push(...glazedRun(P, { x0: BAR.x0, x1: BAR.x1, z0: BAR.z1 - t, z1: BAR.z1 }, floor1, ceil1, undefined, 2.6));
  out.push(...wallRun(P, 'vTimberClad', { x0: BAR.x0, x1: BAR.x1, z0: BAR.z0, z1: BAR.z0 + t }, floor1, ceil1));
  out.push(...wallRun(P, 'vTimberClad', { x0: BAR.x0, x1: BAR.x0 + t, z0: BAR.z0, z1: BAR.z1 }, floor1, ceil1));
  out.push(...glazedRun(P, { x0: BAR.x1 - t, x1: BAR.x1, z0: R.bath1.z0, z1: R.bath1.z1 }, floor1, ceil1, undefined, 2.2));
  out.push(...wallRun(P, 'vTimberClad', { x0: BAR.x1 - t, x1: BAR.x1, z0: R.hallE.z0, z1: R.hallE.z1 }, floor1, ceil1));
  out.push(...glazedRun(P, { x0: BAR.x1 - t, x1: BAR.x1, z0: R.master.z0, z1: R.master.z1 }, floor1, ceil1, undefined, 2.6));
  louvres(P, { x0: R.bed2.x0, x1: BAR.x1, z0: BAR.z1 + 0.18, z1: BAR.z1 + 0.3 }, floor1 + 0.9, ceil1 - 0.1);
  louvres(P, { x0: BAR.x0 + 1.5, x1: R.bed2.x0, z0: BAR.z1 + 0.18, z1: BAR.z1 + 0.3 }, ceil1 - 1.5, ceil1 - 0.1);
  louvres(P, { x0: BAR.x1 + 0.18, x1: BAR.x1 + 0.3, z0: R.bath1.z0 + 0.5, z1: R.bath1.z1 - 0.5 }, floor1 + 1.0, ceil1 - 0.2);

  // Balcony along the south face, now the whole length of the three bedrooms.
  const balc = { x0: R.bed2.x0, x1: BAR.x1, z0: BAR.z1 + 0.3, z1: BAR.z1 + 1.9 };
  flat(P.get('vDeck'), poly(balc), floor1 + 0.02);
  out.push(slab(balc, floor1 - 0.25, floor1 + 0.02));
  for (let x = balc.x0; x <= balc.x1; x += 1.6) box(P.get('vLouvre'), x, floor1 + 0.55, balc.z1, 0.05, 1.1, 0.05);
  for (let i = 0; i < 4; i++) box(P.get('vLouvre'), mid(balc.x0, balc.x1), floor1 + 0.25 + i * 0.28, balc.z1, balc.x1 - balc.x0, 0.03, 0.03);

  // Internal walls, straight off the plan's own table, each with its doorway and a lined reveal.
  for (const w of UPPER_WALL) {
    const r: Rect = w.axis === 'x'
      ? { x0: w.at - t / 2, x1: w.at + t / 2, z0: w.from, z1: w.to }
      : { x0: w.from, x1: w.to, z0: w.at - t / 2, z1: w.at + t / 2 };
    const at = w.door?.at ?? mid(w.from, w.to);
    const top = floor1 + (w.door?.head ?? DOOR_HEAD);
    const gap: Gap | undefined = w.door
      ? { along: w.axis === 'x' ? 'z' : 'x', at, w: w.door.w, top }
      : undefined;
    out.push(...wallRun(P, 'vPlaster', r, floor1, ceil1, gap));
    if (!w.door) continue;
    // Without a lining a doorway reads as a hole punched in plasterboard.
    const hw = w.door.w / 2;
    for (const s of [-1, 1]) {
      if (w.axis === 'x') box(wood, w.at, mid(floor1, top), at + s * hw, t + 0.04, top - floor1, 0.08);
      else box(wood, at + s * hw, mid(floor1, top), w.at, 0.08, top - floor1, t + 0.04);
    }
    if (top < ceil1) {
      if (w.axis === 'x') box(wood, w.at, top, at, t + 0.04, 0.08, w.door.w + 0.16);
      else box(wood, at, top, w.at, w.door.w + 0.16, 0.08, t + 0.04);
    }
  }

  // Ceilings: the bedrooms slope up to the glass in timber planks, the rest flat with a cove.
  for (const name of BEDROOMS) {
    const r = R[name];
    for (let x = r.x0 + 0.5; x < r.x1; x += 0.5) {
      const b = P.get('vTimberCeil');
      hexa(b, [
        [x - 0.025, ceil1 - 0.94, r.z0], [x + 0.025, ceil1 - 0.94, r.z0],
        [x + 0.025, ceil1 - 0.04, r.z1], [x - 0.025, ceil1 - 0.04, r.z1],
        [x - 0.025, ceil1 - 0.88, r.z0], [x + 0.025, ceil1 - 0.88, r.z0],
        [x + 0.025, ceil1 + 0.02, r.z1], [x - 0.025, ceil1 + 0.02, r.z1],
      ] as V3[], { bottom: true, top: false });
    }
    hexa(P.get('vTimberCeil'), [
      [r.x0, ceil1 - 0.9, r.z0], [r.x1, ceil1 - 0.9, r.z0], [r.x1, ceil1, r.z1], [r.x0, ceil1, r.z1],
      [r.x0, ceil1 - 0.85, r.z0], [r.x1, ceil1 - 0.85, r.z0], [r.x1, ceil1 + 0.05, r.z1], [r.x0, ceil1 + 0.05, r.z1],
    ] as V3[], { bottom: true, top: false });
  }
  for (const r of [R.bath1, R.bath2, R.landing, R.hall, R.hallE, R.dress, R.lounge]) {
    flat(plaster, poly(r), ceil1 - 0.02, true);
    cove(P, r, ceil1);
  }

  // --- the landing: a rail round the void, and a reading corner in the light off the south glass.
  {
    const L = R.landing, rail = P.get('vLouvre');
    // A rail round the void, open only on the east where the flight arrives (the spine's parapet
    // closes the gap up to the tread). The west edge is the bar's own wall. It carries a
    // collider: a drawn rail you can walk through is a 3.8 m fall onto the stair below.
    const runs: { axis: 'x' | 'z'; at: number; from: number; to: number }[] = [
      { axis: 'x', at: VOID.z0, from: VOID.x0, to: VOID.x1 },
      { axis: 'x', at: VOID.z1, from: VOID.x0, to: VOID.x1 },
      { axis: 'z', at: VOID.x1, from: VOID.z0, to: STAIR.cz + STAIR.r - STAIR.w / 2 - 0.25 },
    ];
    for (const rn of runs) {
      const len = rn.to - rn.from, alongX = rn.axis === 'x';
      for (let u = rn.from; u <= rn.to + 0.01; u += 0.9) {
        box(rail, alongX ? u : rn.at, floor1 + 0.5, alongX ? rn.at : u, 0.04, 1.0, 0.04);
      }
      const mx = alongX ? mid(rn.from, rn.to) : rn.at, mz = alongX ? rn.at : mid(rn.from, rn.to);
      box(rail, mx, floor1 + 1.0, mz, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len);
      out.push({ kind: 'box', center: [mx, floor1 + 0.55, mz], half: alongX ? [len / 2, 0.55, 0.06] : [0.06, 0.55, len / 2] });
    }
    P.at(mid(L.x0, L.x1), floor1, L.z1 - 3.0, 0, () => rug(P, 4.2, 3.4));
    P.at(L.x0 + 1.5, floor1, L.z1 - 3.4, 0.9, () => armchair(P));
    P.at(L.x0 + 0.9, floor1, L.z1 - 4.4, 0, () => floorLamp(P));
    P.at(L.x1 - 1.4, floor1, L.z1 - 2.2, -0.7, () => armchair(P, { key: 'vFabricTan' }));
    P.at(mid(L.x0, L.x1), floor1, L.z1 - 0.35, 0, () => curtains(P, 6.4, H - 0.1));
    P.at(L.x0 + face, floor1 + 1.75, L.z1 - 3.4, Math.PI / 2, () => art(P, 1.3, 1.7));
    // The console stands on the floor east of the void, not on the ledge north of it.
    const nx = mid(VOID.x1, L.x1) - 0.3;
    P.at(L.x1 - 0.8, floor1, L.z0 + 3.4, 0, () => plant(P, 2.0));
    box(wood, nx, floor1 + 0.42, L.z0 + face + 0.26, 2.0, 0.84, 0.5);
    P.at(nx - 0.5, floor1 + 0.84, L.z0 + face + 0.26, 0, () => vase(P, 0.15, 0.3));
    P.at(nx + 0.55, floor1 + 0.84, L.z0 + face + 0.26, 0.3, () => bookStack(P, 3));
    P.at(nx, floor1 + 1.9, L.z0 + face, 0, () => art(P, 2.0, 1.1));
  }

  // --- the gallery: a runner, a console, and the pictures you pass on the way to bed.
  {
    const G = R.hall;
    P.at(11.6, floor1, mid(G.z0, G.z1), 0, () => rug(P, 10.0, 2.2));
    box(wood, 5.4, floor1 + 0.42, G.z0 + face + 0.25, 1.6, 0.84, 0.5);
    P.at(5.4, floor1 + 0.84, G.z0 + face + 0.25, 0, () => vase(P, 0.14, 0.26));
    P.at(11.4, floor1 + 1.75, G.z0 + face, 0, () => gallery(P, 6.0));
    P.at(19.2, floor1, G.z0 + 0.9, 0, () => plant(P, 1.9));
    for (const x of [9.4, 14.6]) P.at(x, floor1 + 2.0, G.z1 - face, Math.PI, () => art(P, 1.1, 0.8));
  }

  // --- the gallery's east leg, in front of the master's doors.
  {
    const G = R.hallE;
    box(wood, 25.5, floor1 + 0.42, G.z0 + face + 0.25, 1.8, 0.84, 0.5);
    P.at(25.5, floor1 + 0.84, G.z0 + face + 0.25, 0, () => bowl(P, 0.17));
    P.at(25.5, floor1 + 1.85, G.z0 + face, 0, () => art(P, 1.5, 1.0));
    P.at(BAR.x1 - t - 0.02, floor1 + 1.8, mid(G.z0, G.z1), -Math.PI / 2, () => art(P, 1.2, 1.6));
    P.at(31.0, floor1, G.z1 - 0.9, 0, () => plant(P, 1.8));
    P.at(21.4, floor1, mid(G.z0, G.z1), 0, () => bench(P, 1.4));
  }

  /**
   * A bed with its head on a side wall (Layout's BED), built in a frame whose origin is the wall's
   * inner face behind the pillows and whose +Z runs down the bed to its foot. The bedroom doors
   * are at the foot end, so this is what you see from the doorway - not the back of a headboard.
   */
  const bedOn = (name: keyof typeof BED, o: { head: string; accent: string; h: number }, extra: () => void): void => {
    const b = BED[name], x0 = b.wallX + b.dir * t / 2;
    P.at(x0 + b.dir * 0.03, floor1, b.z, b.dir * Math.PI / 2, () => {
      P.at(0, 0, b.len / 2 + 1.3, 0, () => rug(P, b.w + 2.8, b.len + 2.2));
      P.at(0, 0, b.len / 2 + 0.2, 0, () => bed(P, b.w, b.len, o));
      P.at(0, 0, b.len + 0.65, 0, () => bench(P, b.w - 0.1));
      extra();
    });
    out.push({
      kind: 'box', center: [x0 + b.dir * (b.len / 2 + 0.15), floor1 + o.h / 2, b.z],
      half: [b.len / 2 + 0.15, o.h / 2, b.w / 2 + 0.05],
    });
  };

  // --- master suite: the bed on the blind west wall, looking out through the corner glass.
  {
    const M = R.master, B = BED.master;
    bedOn('master', { head: 'vVelvet', accent: 'vFabricTan', h: 0.62 }, () => {
      for (const s of [-1, 1]) {
        P.at(s * (B.w / 2 + 0.55), 0, 0.3, 0, () => nightstand(P));
        P.at(s * (B.w / 2 + 0.55), 1.66, 0, 0, () => sconce(P));
        P.at(s * (B.w / 2 + 1.9), 1.8, 0, 0, () => art(P, 0.8, 1.1));
      }
    });
    // The television on the north wall, clear of the door at the room's east end.
    box(wood, 24.6, floor1 + 0.3, M.z0 + face + 0.3, 2.6, 0.6, 0.6);
    P.at(24.6, floor1 + 1.5, M.z0 + face, 0, () => tv(P, 1.5));
    P.at(23.7, floor1 + 0.6, M.z0 + face + 0.3, 0.4, () => bookStack(P, 3));
    P.at(M.x1 - 1.6, floor1, M.z1 - 2.0, -2.3, () => armchair(P));
    P.at(M.x1 - 2.4, floor1, M.z1 - 2.8, 0, () => floorLamp(P));
    P.at(M.x1 - 1.5, floor1, M.z1 - 1.1, 0, () => lowTable(P, 0.7, 0.7, 0.4));
    P.at(mid(M.x0, M.x1), floor1, glassIn, 0, () => curtains(P, 10.6, H - 0.1));
    P.at(BAR.x1 - t - 0.16, floor1, mid(M.z0, M.z1), Math.PI / 2, () => curtains(P, 8.0, H - 0.1));
    P.at(M.x0 + 1.1, floor1, M.z1 - 1.2, 0, () => plant(P, 2.1));
  }

  // --- the two other bedrooms: the same room, mirrored, their beds back to back on the shared
  // wall, so neither reads as the spare.
  for (const name of ['bed2', 'bed3'] as const) {
    const r = R[name], B = BED[name], bx = mid(r.x0, r.x1);
    /** +1 towards the wall the bed stands on, -1 towards the door's end of the room. */
    const farX = B.dir > 0 ? r.x1 : r.x0, far = -B.dir;
    bedOn(name, { head: 'vFabricTan', accent: 'vVelvet', h: 0.6 }, () => {
      for (const s of [-1, 1]) {
        P.at(s * (B.w / 2 + 0.5), 0, 0.3, 0, () => nightstand(P, { lamp: s > 0 }));
        P.at(s * (B.w / 2 + 0.5), 1.6, 0, 0, () => sconce(P));
      }
      P.at(0, 1.95, 0, 0, () => art(P, 1.5, 0.9));
    });
    // The wardrobe faces the foot of the bed from the far wall, south of the door's swing.
    const wx = farX + far * 0.62;
    P.at(wx, floor1, r.z0 + 4.2, far * Math.PI / 2, () => wardrobe(P, 2.6));
    solid(wx, r.z0 + 4.2, 0.36, 1.3, 2.4);
    P.at(farX + far * face, floor1 + 1.65, r.z1 - 2.3, far * Math.PI / 2, () => mirror(P, 0.8, 1.6));
    // The north wall beside the door is the one you face from the armchair: hang it.
    P.at(bx - far * 0.6, floor1 + 1.8, r.z0 + face, 0, () => art(P, 1.5, 1.1));
    P.at(B.wallX + B.dir * 1.5, floor1, r.z1 - 1.9, B.dir * 2.2, () => armchair(P, { key: 'vFabricTan' }));
    P.at(bx, floor1, glassIn, 0, () => curtains(P, r.x1 - r.x0 - 1.4, H - 0.1));
    P.at(farX + far * 1.0, floor1, r.z1 - 1.1, 0, () => plant(P, 1.7));
  }

  // --- the media room: the one room with nothing to look at, so it looks at a screen.
  {
    const G = R.lounge, gx = mid(G.x0, G.x1);
    P.at(gx, floor1, G.z0 + 2.6, 0, () => rug(P, 6.0, 3.4));
    // Broken into a credenza, a recessed dark niche for the screen and open shelves either side:
    // as one slab it read as a flat orange wall with a television stuck to it.
    const zw = G.z0 + face + 0.22;
    box(wood, gx, floor1 + 0.3, zw, 5.4, 0.6, 0.5);
    box(P.get('vMarbleWhite'), gx, floor1 + 0.62, zw, 5.5, 0.05, 0.56);
    box(P.get('vMarbleDark'), gx, floor1 + 1.75, zw - 0.12, 3.2, 1.8, 0.2);
    P.at(gx, floor1 + 1.75, zw + 0.02, 0, () => tv(P, 2.4));
    box(P.get('vLight'), gx, floor1 + 2.66, zw - 0.02, 3.0, 0.04, 0.08);
    for (const sx of [-1, 1]) {
      box(wood, gx + sx * 2.2, floor1 + 1.75, zw, 1.0, 1.9, 0.42);
      for (const y of [1.1, 1.62, 2.14]) {
        box(P.get('vTimberClad'), gx + sx * 2.2, floor1 + y, zw + 0.02, 0.94, 0.04, 0.4);
        P.at(gx + sx * 2.2, floor1 + y + 0.02, zw + 0.06, 0, () => bookRow(P, 0.8, 0.24));
      }
    }
    P.at(gx - 1.4, floor1 + 0.66, zw, 0.3, () => bookStack(P, 3));
    P.at(gx + 1.5, floor1 + 0.66, zw, 0, () => vase(P, 0.13, 0.26));
    // Green velvet, not white: a white sofa in a dark media room read as a kitchen counter.
    P.at(gx, floor1, G.z0 + 3.4, Math.PI, () => sofa(P, 3.4, 1.05, { key: 'vVelvet', accent: 'vFabricTan' }));
    solid(gx, G.z0 + 3.4, 1.7, 0.55, 0.6);
    P.at(gx, floor1, G.z0 + 2.3, 0, () => lowTable(P, 1.3, 0.7));
    P.at(gx - 0.1, floor1 + 0.4, G.z0 + 2.3, 0.2, () => bookStack(P, 3));
    P.at(G.x1 - 1.1, floor1, G.z1 - 1.2, -0.9, () => armchair(P));
    P.at(G.x0 + 0.9, floor1, G.z0 + 0.9, 0, () => floorLamp(P));
    P.at(G.x1 - 0.8, floor1, G.z0 + 0.8, 0, () => plant(P, 1.6));
  }

  // --- the dressing room: open runs of clothes, an island of drawers, a long mirror.
  {
    const D = R.dress, dx = mid(D.x0, D.x1), dz = mid(D.z0, D.z1);
    P.at(D.x0 + face, floor1, dz, Math.PI / 2, () => dressingRun(P, 5.0));
    P.at(dx, floor1, D.z0 + face, 0, () => wardrobe(P, 3.4, 2.4, 0.6));
    box(wood, dx, floor1 + 0.42, dz + 0.6, 1.8, 0.84, 0.9);
    box(marble, dx, floor1 + 0.87, dz + 0.6, 1.9, 0.06, 1.0);
    solid(dx, dz + 0.6, 0.95, 0.5, 0.9);
    P.at(dx - 0.5, floor1 + 0.9, dz + 0.6, 0, () => bookStack(P, 2));
    P.at(dx + 0.5, floor1 + 0.9, dz + 0.6, 0, () => vase(P, 0.12, 0.22, { stems: false }));
    P.at(D.x1 - face, floor1 + 1.6, D.z1 - 1.4, -Math.PI / 2, () => mirror(P, 0.9, 1.9));
    P.at(dx, floor1, D.z1 - 1.0, 0, () => bench(P, 1.2, 0.4, 'vVelvet'));
  }

  // --- master ensuite: the boat tub at the louvred glass, a double vanity, a shower.
  {
    const B = R.bath1, bx = mid(B.x0, B.x1);
    lathe(marble, [[0.02, floor1 + 0.05], [0.72, floor1 + 0.2], [0.95, floor1 + 0.62],
      [0.9, floor1 + 0.8], [0.86, floor1 + 0.82], [0.02, floor1 + 0.8]], 14, B.x1 - 1.5, mid(B.z0, B.z1) + 0.6);
    cyl(P.get('vBrass'), B.x1 - 2.6, floor1 + 0.05, mid(B.z0, B.z1) + 0.6, 0.04, 0.04, 0.95, 6);
    solid(B.x1 - 1.5, mid(B.z0, B.z1) + 0.6, 1.0, 1.0, 0.6);
    box(wood, bx - 0.4, floor1 + 0.42, B.z0 + face + 0.32, 3.0, 0.84, 0.64);
    box(marble, bx - 0.4, floor1 + 0.87, B.z0 + face + 0.32, 3.1, 0.06, 0.7);
    for (const s of [-1, 1]) {
      lathe(marble, [[0.2, floor1 + 0.9], [0.26, floor1 + 0.96], [0.24, floor1 + 1.02], [0.06, floor1 + 0.99]], 12, bx - 0.4 + s * 0.8, B.z0 + face + 0.32);
      cyl(P.get('vBrass'), bx - 0.4 + s * 0.8, floor1 + 0.93, B.z0 + face + 0.1, 0.02, 0.02, 0.26, 6);
      P.at(bx - 0.4 + s * 1.55, floor1 + 1.9, B.z0 + face, 0, () => sconce(P));
    }
    P.at(bx - 0.4, floor1 + 1.75, B.z0 + face, 0, () => mirror(P, 2.6, 1.2));
    P.at(bx - 0.9, floor1 + 0.9, B.z0 + face + 0.32, 0, () => towels(P, 3, 0.3));
    // Shower: a stone tray behind two panes of glass.
    const sx0 = B.x0 + 0.2, sz1 = B.z1 - 0.2;
    box(marble, sx0 + 1.1, floor1 + 0.06, sz1 - 1.0, 2.2, 0.12, 2.0);
    box(P.get('vGlass'), sx0 + 2.2, floor1 + 1.25, sz1 - 1.0, 0.03, 2.4, 2.0, { faces: 'xX' });
    box(P.get('vGlass'), sx0 + 1.1, floor1 + 1.25, sz1 - 2.0, 2.2, 2.4, 0.03, { faces: 'zZ' });
    cyl(P.get('vBrass'), sx0 + 0.6, floor1 + 2.2, sz1 - 1.0, 0.09, 0.09, 0.04, 10);
    P.at(B.x0 + 0.8, floor1, B.z0 + 0.7, 0, () => plant(P, 1.5));
  }

  // --- family bathroom, shared by the two bedrooms off the gallery.
  {
    const B = R.bath2, bx = mid(B.x0, B.x1);
    box(wood, bx - 0.5, floor1 + 0.42, B.z0 + face + 0.3, 2.4, 0.84, 0.6);
    box(marble, bx - 0.5, floor1 + 0.87, B.z0 + face + 0.3, 2.5, 0.06, 0.66);
    lathe(marble, [[0.2, floor1 + 0.9], [0.27, floor1 + 0.96], [0.25, floor1 + 1.02], [0.06, floor1 + 0.99]], 12, bx - 0.5, B.z0 + face + 0.3);
    cyl(P.get('vBrass'), bx - 0.5, floor1 + 0.93, B.z0 + face + 0.12, 0.02, 0.02, 0.26, 6);
    P.at(bx - 0.5, floor1 + 1.75, B.z0 + face, 0, () => mirror(P, 1.5, 1.1));
    for (const s of [-1, 1]) P.at(bx - 0.5 + s * 1.0, floor1 + 1.85, B.z0 + face, 0, () => sconce(P));
    P.at(bx + 0.4, floor1 + 0.9, B.z0 + face + 0.3, 0, () => towels(P, 2, 0.28));
    const sx0 = B.x1 - 1.9;
    box(marble, sx0 + 0.85, floor1 + 0.06, B.z0 + 1.2, 1.7, 0.12, 2.0);
    box(P.get('vGlass'), sx0, floor1 + 1.25, B.z0 + 1.2, 0.03, 2.4, 2.0, { faces: 'xX' });
    box(P.get('vGlass'), sx0 + 0.85, floor1 + 1.25, B.z0 + 2.2, 1.7, 2.4, 0.03, { faces: 'zZ' });
    cyl(P.get('vBrass'), sx0 + 1.4, floor1 + 2.2, B.z0 + 1.2, 0.09, 0.09, 0.04, 10);
    P.at(B.x0 + 0.7, floor1, B.z1 - 0.8, 0, () => plant(P, 1.4));
  }

  // Roofs and their fascias, and the great room's flue.
  const up = grow(BAR, t);
  flat(P.get('vRoof'), poly(up), roof);
  prism(P.get('vTimberClad'), poly(up), ceil1, roof, { top: false });
  fascia(P, up, roof + 0.1);
  // The ground floor's north strip is no longer under the bar: its own flat roof is the level
  // change that lets the bar read as a bar from the air.
  // Pale stone, not the bar's grey: without a tonal break the two levels read as one big plate.
  const lowRoof = (r: Rect, y: number) => {
    flat(P.get('vTravertine'), poly(r), y);
    prism(P.get('vPlaster'), poly(r), y, y + 0.34, { top: false });
    fascia(P, r, y + 0.4, 0.36, 0.18);
  };
  const north = { x0: HOUSE.x0 - t, x1: BAR.x1 + t, z0: HOUSE.z0 - t, z1: BAR.z0 };
  lowRoof(north, ceil0 + 0.12);
  const low = { x0: BAR.x1 + t, x1: HOUSE.x1 + t, z0: HOUSE.z0 - t, z1: HOUSE.z1 + t };
  lowRoof(low, ceil0 + 0.12);
  const pav = grow(ROOM.pavilion, t);
  lowRoof(pav, ceil0 + 0.12);
  cyl(P.get('vLouvre'), mid(ROOM.great.x0, ROOM.great.x1), roof, ROOM.great.z0 - 0.1, 0.3, 0.3, 1.6, 8);
  return out;
}

/** The garage: concrete walls at court level, a flat roof, the door opening, steps up to the hall. */
function garage(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const t = HOUSE.wall, g = GARAGE;
  out.push(...wallRun(P, 'vConcrete', { x0: g.x0 - t, x1: g.x1, z0: g.z0 - t, z1: g.z0 }, 0, g.roof));
  out.push(...wallRun(P, 'vConcrete', { x0: g.x0 - t, x1: g.x1, z0: g.z1, z1: g.z1 + t }, 0, g.roof));
  out.push(...wallRun(P, 'vConcrete', { x0: g.x0 - t, x1: g.x0, z0: g.z0, z1: g.z1 }, 0, g.roof,
    { along: 'z', at: DOOR.z, w: DOOR.w, top: DOOR.h }));
  out.push(...wallRun(P, 'vConcrete', { x0: g.x1, x1: g.x1 + t, z0: g.z0, z1: g.z1 }, 0, g.roof,
    { along: 'z', at: GARAGE_DOOR.z, w: GARAGE_DOOR.w, top: Y.plinth + 2.1 }));
  flat(P.get('vConcrete'), poly({ x0: g.x0, x1: g.x1, z0: g.z0, z1: g.z1 }), Y.court + 0.004);
  const up = grow(g, t);
  flat(P.get('vRoof'), poly(up), g.roof);
  fascia(P, up, g.roof + 0.1, 0.36, 0.2);
  box(P.get('vConcrete'), g.x0 - t / 2, DOOR.h + 0.3, DOOR.z, t, 0.6, DOOR.w + 0.8);
  box(P.get('vLight'), g.x0 - t - 0.04, DOOR.h + 0.66, DOOR.z, 0.08, 0.14, 1.2);
  // The step up into the hall happens at the plinth's face, which cuts through the garage 2 m
  // west of its east wall. Built east of that wall these were buried in the plinth, and the
  // doorway with them.
  for (let i = 0; i < 3; i++) {
    const r = { x0: PLINTH.x0 - (3 - i) * 0.6, x1: PLINTH.x0, z0: GARAGE_DOOR.z - GARAGE_DOOR.w / 2, z1: GARAGE_DOOR.z + GARAGE_DOOR.w / 2 };
    const y = (Y.plinth / 3) * (i + 1);
    prism(P.get('vTravertine'), poly(r), Y.court, y);
  }
  out.push(wedge(PLINTH.x0 - 1.8, PLINTH.x0,
    GARAGE_DOOR.z - GARAGE_DOOR.w / 2, GARAGE_DOOR.z + GARAGE_DOOR.w / 2, Y.court, Y.plinth));
  return out;
}

/**
 * The terrace and the poolside. A villa whose garden is bare stone reads as a showhome: the
 * loungers, the outdoor rooms and the fire are what make it somewhere someone lives.
 */
function terraceFurniture(P: Parts): void {
  const y = Y.plinth;
  // Outdoor lounge in the deep shade under the cantilever.
  const lx = 6, lz = TERRACE.z0 + 2.6;
  P.at(lx, y, lz, 0, () => sofa(P, 3.2, 1.05, { key: 'vFabricWhite', accent: 'vFabricTan' }));
  P.at(lx, y, lz + 2.0, Math.PI, () => sofa(P, 3.2, 1.05, { key: 'vFabricWhite', accent: 'vFabricTan' }));
  P.at(lx, y, lz + 1.0, 0, () => lowTable(P, 1.4, 0.8, 0.34));
  P.at(lx, y + 0.38, lz + 1.0, 0, () => bowl(P, 0.18));
  for (const s of [-1, 1]) P.at(lx + s * 2.6, y, lz + 1.0, -s * Math.PI / 2, () => armchair(P, { key: 'vFabricTan' }));
  // Outdoor dining at the east end of the terrace, under a parasol.
  const dx = 24;
  P.at(dx, y, TERRACE.z0 + 2.8, 0, () => outdoorTable(P, 3.0, 1.2));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    P.at(dx - 1.0 + i * 1.0, y, TERRACE.z0 + 2.8 + s * 1.0, s > 0 ? Math.PI : 0, () => chair(P, { key: 'vFabricWhite' }));
  }
  P.at(dx + 2.6, y, TERRACE.z0 + 2.8, 0, () => parasol(P, 2.6, 1.6));
  // Loungers along the deck on the far side of the water, facing the house.
  for (let i = 0; i < 4; i++) {
    P.at(POOL.x0 + 3.4 + i * 5.2, y, DECK.z0 + 0.75, Math.PI, () => lounger(P));
    if (i % 2 === 0) P.at(POOL.x0 + 6.0 + i * 5.2, y, DECK.z0 + 0.8, 0, () => parasol(P, 2.4, 1.4));
  }
  // A fire on the terrace's west end, with seats round it.
  P.at(-1.0, y, TERRACE.z1 - 1.8, 0, () => firePit(P, 0.7));
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 1.1;
    P.at(-1.0 + Math.cos(a) * 2.0, y, TERRACE.z1 - 1.8 + Math.sin(a) * 2.0, -a + Math.PI / 2, () => stool(P, 0.42));
  }
  // Planters breaking up the stone.
  for (const [x, z] of [[-3.0, 8.4], [11.5, 8.2], [19.0, 8.4], [28.5, 9.0]] as [number, number][]) {
    P.at(x, y, z, 0, () => plant(P, 2.0, { pot: 'vConcrete' }));
  }
}

export interface VillaStatic { parts: Parts; colliders: ColliderSpec[]; footprint: [number, number][]; height: number }

export function buildVillaStatic(): VillaStatic {
  const P = new Parts();
  const colliders: ColliderSpec[] = [
    ...plinthAndGround(P), ...garage(P), ...groundFloor(P), ...curvedStair(P), ...upperBar(P),
  ];
  garden(P);
  terraceFurniture(P);
  return { parts: P, colliders, footprint: rectPoly(PLOT.hw, PLOT.hd), height: HOUSE.roof };
}

/** Outside the footprint: the drive crossing the verge to 恒惠路's kerb. */
export function buildVillaExtras(): Parts {
  const P = new Parts();
  flat(P.get('vConcrete'), poly(DRIVE.kerb), Y.court);
  return P;
}

/** Far LOD: the plinth, the two volumes, the pool and the trees as massing. */
export function buildVillaFar(): Parts {
  const P = new Parts();
  const t = HOUSE.wall;
  prism(P.get('vTravertine'), poly(PLINTH), 0, Y.plinth);
  prism(P.get('vGlass'), poly({ x0: HOUSE.x0, x1: HOUSE.x1, z0: HOUSE.z0, z1: HOUSE.z1 }), Y.plinth, HOUSE.ceil0);
  prism(P.get('vTimberClad'), poly(grow(BAR, t)), HOUSE.ceil0, HOUSE.roof);
  prism(P.get('vConcrete'), poly(grow(GARAGE, t)), 0, GARAGE.roof);
  flat(P.get('vLawn'), rectPoly(PLOT.hw, PLOT.hd), Y.lawn);
  flat(P.get('vWaterDark'), poly(POOL), Y.water);
  for (const [x, z, h] of TREES) blob(P, 'vLeaf', x, z, h * 0.3, h * 0.7, h * 0.6);
  blob(P, 'vLeaf', HERO_TREE.x, HERO_TREE.z, HERO_TREE.h * 0.3, Y.plinth + HERO_TREE.h * 0.75, HERO_TREE.h * 0.5);
  return P;
}

/**
 * The roller garage door, built for home/index.ts to slide: the panel hangs from a group at the
 * head of the opening, so scaling that group is the whole animation.
 */
export function garageDoor(mats: Record<string, THREE.Material>): THREE.Group {
  const P = new Parts();
  const b = P.get('vLouvre'), l = P.get('vLight');
  box(b, 0, 0, 0, DOOR.t, DOOR.h, DOOR.w);
  for (let i = 0; i < 5; i++) {
    box(l, -DOOR.t / 2 - 0.015, -DOOR.h / 2 + (i + 0.5) * (DOOR.h / 5), 0, 0.03, 0.04, DOOR.w - 0.5);
  }
  const g = P.build(mats);
  g.name = 'garageDoor';
  return g;
}

/** Where the car is meant to stop, in villa-local metres. */
export const PARK_SPOT = PARK_AT;

/** A ring of points for probes and tests to sample the pool surface. */
export const poolRing = (n = 16): [number, number][] => circlePoly((POOL.x1 - POOL.x0) / 2, n, mid(POOL.x0, POOL.x1), mid(POOL.z0, POOL.z1));
