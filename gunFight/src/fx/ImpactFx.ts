import * as THREE from 'three';
import type { SurfaceType } from '../core/Events';
import { CELL } from './Atlas';
import { LIT_NORMAL, MODE_STRETCH } from './ParticlePool';
import { budgetCount, coneDir, reflect, NO_FLOOR } from './math';
import type { FxContext } from './Context';

/**
 * Bullet impacts by surface + blood hits. Every recipe is built from the same few ingredients —
 * lit dust puffs (normal-mapped, per-particle tint jitter), lit debris with floor bounce, HDR
 * velocity-stretched sparks, and a per-surface decal set — tuned so the materials are
 * unmistakable at a glance:
 *   concrete  grey dust + grey chips + 2-3 small sparks, dark hole with chipped lip
 *   metal     bright long sparks + ricochet streaks + dent decal with highlight, tiny light
 *   wood      pale splinters + tan dust, fibrous split along the grain
 *   dirt      brown plume that hangs + dark clods, shallow crater
 *   plaster   white powder cloud that falls + white chips, big chipped hole (exposed lath)
 *   brick     red dust + red-brown fragments, red chip decal
 *   sandbag   sand spray that falls fast + burlap threads, torn-burlap decal
 *   glass     glinting shards + fine glitter, crazed hole
 */
const _refl = new THREE.Vector3(), _axis = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3();
const _t = new THREE.Vector3(), _b = new THREE.Vector3(), _proj = new THREE.Vector3();
const _col = new THREE.Color();
/**
 * Blood decals are already painted dark-crimson in the atlas, so they must NOT be dimmed with a
 * dark tint (tint scales albedo, and a dark tint on a dark texture crushes it to near-black —
 * that was the "blood decal renders black" bug). Sun blow-out is handled by `exposure` instead,
 * which scales the lit result and leaves the hue intact.
 */
const BLOOD_TINT: [number, number, number] = [1, 0.95, 0.95];
const BLOOD_EXPOSURE = 0.55;

interface DustSpec { r: number; g: number; b: number; alpha: number; size0: number; size1: number; life: number; speed: number; up: number; gravity?: number; cellBase?: number; cellN?: number; drag?: number; spread?: number; curve?: number; jitter?: number }
interface ChipSpec {
  r: number; g: number; b: number; size0: number; size1: number; speed: number; spread: number;
  gravity?: number; drag?: number; cellBase?: number; cellN?: number; spin?: number; additive?: number; lit?: number; life?: number; alpha?: number; jitter?: number;
  /** Velocity motion blur, in seconds of travel. Set on spall so fast grit reads as a streak
   *  instead of a tumbling ball; the sprite falls back to its own size once it slows down. */
  blur?: number;
  /** Downward bias on the ejecta cone, 0..1. Spall off a wall sprays out and falls; without this
   *  it lofts over the wall and hangs in the sky as a row of brown spheres. */
  sink?: number;
}

function dust(ctx: FxContext, point: THREE.Vector3, normal: THREE.Vector3, refl: THREE.Vector3, floorY: number, count: number, s: DustSpec, t0: number): void {
  const { pool, rng } = ctx;
  const base = s.cellBase ?? CELL.DUST, cn = s.cellN ?? CELL.DUST_N, jit = s.jitter ?? 0.1;
  for (let i = 0; i < count; i++) {
    const d = pool.begin(t0 - rng.range(0, 0.02));
    const k = rng.range(0.6, 1.4);
    coneDir(normal, s.spread ?? 0.9, rng.next(), rng.next(), _axis);
    const sp = s.speed * rng.range(0.4, 1.3);
    d.pos(point.x + normal.x * 0.02, point.y + normal.y * 0.02, point.z + normal.z * 0.02);
    d.vel(_axis.x * sp + refl.x * sp * 0.35, _axis.y * sp + refl.y * sp * 0.35 + s.up, _axis.z * sp + refl.z * sp * 0.35);
    d.drag = s.drag ?? 2.6; d.gravity = s.gravity ?? 0.1;
    d.size(s.size0 * k, s.size1 * k); d.curve = s.curve ?? 0.42;
    d.life = s.life * rng.range(0.75, 1.3);
    d.lit = LIT_NORMAL; d.cell = base + rng.int(0, cn - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-1.2, 1.2);
    const cj = 1 + rng.range(-jit, jit);
    d.color(s.r * cj, s.g * cj, s.b * cj, s.alpha * rng.range(0.7, 1)); d.colorEnd(s.r * cj, s.g * cj, s.b * cj, 0);
    d.fadeIn = 0.04; d.fadeOut = 0.7;
    d.normal(normal.x, normal.y, normal.z);
    d.floorY = floorY;
    pool.emit();
  }
}

function chips(ctx: FxContext, point: THREE.Vector3, axis: THREE.Vector3, floorY: number, count: number, s: ChipSpec, t0: number): void {
  const { pool, rng } = ctx;
  const base = s.cellBase ?? CELL.DEBRIS, cn = s.cellN ?? CELL.DEBRIS_N, jit = s.jitter ?? 0.15;
  // Only bias downward off a wall: on a floor hit the ejecta belongs going up, and `axis` is the
  // surface normal, so how horizontal it is says which case we are in.
  const sink = (s.sink ?? 0.4) * (1 - Math.abs(axis.y));
  for (let i = 0; i < count; i++) {
    const d = pool.begin(t0);
    coneDir(axis, s.spread, rng.next(), rng.next(), _c);
    // pull the cone down: spall leaves a wall roughly along the surface and falls, it does not
    // arc over the parapet and hang in the sky
    _c.y -= sink * rng.range(0.5, 1.4);
    const l = Math.hypot(_c.x, _c.y, _c.z) || 1; _c.x /= l; _c.y /= l; _c.z /= l;
    const sp = s.speed * rng.range(0.35, 1.25);
    d.pos(point.x, point.y, point.z);
    d.vel(_c.x * sp, _c.y * sp, _c.z * sp);
    d.gravity = s.gravity ?? 1; d.drag = s.drag ?? 0.5; d.floorY = floorY;
    const sz = rng.range(s.size0, s.size1); d.size(sz, sz * 0.9);
    d.life = (s.life ?? 1.6) * rng.range(0.6, 1.3);
    d.lit = s.lit ?? LIT_NORMAL; d.additive = s.additive ?? 0;
    d.cell = base + rng.int(0, cn - 1);
    if (s.blur) { d.mode = MODE_STRETCH; d.stretch = s.blur * rng.range(0.7, 1.3); }
    else { d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-1, 1) * (s.spin ?? 22); }
    const cj = 1 + rng.range(-jit, jit);
    d.color(s.r * cj, s.g * cj, s.b * cj, s.alpha ?? 1); d.fadeIn = 0.0; d.fadeOut = 0.12;
    pool.emit();
  }
}

/**
 * Impact sparks: fragments of glowing metal, thrown as *scattered* streaks.
 *
 * The round-3 defect ("a symmetric 8-point starburst sprite") was a burst of identical straight
 * bars all leaving one point at one length, which projects to a star however good the sprite is.
 * Four things break that, and all four are needed:
 *   1. six irregular streak sprites (bent, tapered, fragmenting - see Atlas.sparkTrail) picked per
 *      particle, plus a random 180-degree flip so mirrored variants read as twelve;
 *   2. the origin is scattered over the crater and each fragment is launched with some of its
 *      flight already done, so the inner ends never converge on one pixel;
 *   3. a 9x speed range (0.18..1.6) instead of 4x, so lengths differ by an order of magnitude;
 *   4. HDR held below the clip point and the heat gradient moved into the sprite, so the body
 *      reads orange-hot metal instead of a white line.
 * `cell < 0` means "pick a sparkTrail variant"; callers that want the round glitter dot pass one.
 */
function sparks(ctx: FxContext, point: THREE.Vector3, axis: THREE.Vector3, floorY: number, count: number, speed: number, spread: number, life: number, hdr: number, t0: number, stretch = 0.014, cell = -1): void {
  const { pool, rng } = ctx;
  for (let i = 0; i < count; i++) {
    // stagger the birth times: a burst that all starts on one tick freezes as one clean ring
    const d = pool.begin(t0 - rng.range(0, 0.018));
    coneDir(axis, spread, rng.next(), rng.next(), _c);
    const sp = speed * rng.range(0.18, 1.6);
    // scatter the origin: a few mm across the crater, plus up to 6 cm already travelled
    const lead = rng.range(0, 0.03);
    d.pos(point.x + _c.x * lead + rng.range(-0.014, 0.014), point.y + _c.y * lead + rng.range(-0.014, 0.014), point.z + _c.z * lead + rng.range(-0.014, 0.014));
    d.vel(_c.x * sp, _c.y * sp, _c.z * sp);
    d.gravity = 1; d.drag = rng.range(0.7, 3.0); d.floorY = floorY;
    d.mode = MODE_STRETCH; d.stretch = stretch * rng.range(0.35, 1.9);
    const sz = rng.range(0.004, 0.012); d.size(sz, sz * rng.range(0.25, 0.6));
    d.life = life * rng.range(0.25, 1.7);
    d.additive = 1;
    d.cell = cell >= 0 ? cell : CELL.SPARK_TRAIL + rng.int(0, CELL.SPARK_TRAIL_N - 1);
    if (cell < 0 && rng.next() < 0.5) d.rot = Math.PI;   // mirror the variant about the flight axis
    // Keep the peak under the tonemap's shoulder: the sprite already carries white-hot -> orange,
    // so a flat 3.5x multiplier only clipped the whole streak to a white bar.
    const h = hdr * rng.range(0.4, 1.15);
    d.color(1 * h, 0.6 * h, 0.22 * h, 1); d.colorEnd(0.85 * h * 0.22, 0.18 * h * 0.22, 0.02 * h * 0.22, 1);
    d.fadeIn = 0; d.fadeOut = 0.35;
    pool.emit();
  }
}

function glow(ctx: FxContext, point: THREE.Vector3, normal: THREE.Vector3, size: number, hdr: number, life: number, t0: number): void {
  const d = ctx.pool.begin(t0);
  d.pos(point.x + normal.x * 0.03, point.y + normal.y * 0.03, point.z + normal.z * 0.03);
  d.size(size, size * 1.6); d.life = life; d.additive = 1; d.cell = CELL.GLOW;
  d.color(hdr, hdr * 0.7, hdr * 0.4, 1); d.colorEnd(hdr * 0.5, hdr * 0.25, hdr * 0.05, 0); d.fadeIn = 0; d.fadeOut = 0.8;
  ctx.pool.emit();
}

/** Bullet holes stay upright (alignDown) with a small random rotation so their baked top-shadow reads as depth. */
function hole(ctx: FxContext, point: THREE.Vector3, normal: THREE.Vector3, base: number, n: number, size: number, extra: { roughness?: number; metalness?: number; alpha?: number; tint?: [number, number, number] } = {}): void {
  const rng = ctx.rng;
  ctx.decals.place(point, normal, base + rng.int(0, n - 1), size, { rot: rng.range(-0.35, 0.35), alignDown: true, ...extra });
}

export function spawnImpact(ctx: FxContext, point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceType, dir: THREE.Vector3, age = 0): void {
  if (surface === 'flesh') { spawnBlood(ctx, point, normal, dir, false, age); return; }
  const t0 = ctx.time - age;
  const s = ctx.scale, rng = ctx.rng;
  reflect(dir, normal, _refl);
  if (_refl.lengthSq() < 1e-6) _refl.copy(normal);
  // chips fly back out of the hole: mostly along the normal, biased toward the reflected shot dir
  _axis.copy(normal).multiplyScalar(0.65).addScaledVector(_refl, 0.35).normalize();
  const floorY = ctx.floorAt(point);
  switch (surface) {
    case 'concrete': {
      dust(ctx, point, normal, _refl, floorY, budgetCount(6, s), { r: 0.46, g: 0.44, b: 0.41, alpha: 0.42, size0: 0.08, size1: 0.5, life: 0.8, speed: 1.5, up: 0.15 }, t0);
      dust(ctx, point, normal, _refl, floorY, 2, { r: 0.55, g: 0.53, b: 0.5, alpha: 0.6, size0: 0.04, size1: 0.2, life: 0.35, speed: 2.5, up: 0, drag: 4 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(12, s), { r: 0.32, g: 0.3, b: 0.28, size0: 0.008, size1: 0.024, speed: 5.5, spread: 0.65, blur: 0.009, life: 1.2 }, t0);
      sparks(ctx, point, _axis, floorY, budgetCount(3, s), 7, 0.7, 0.2, 1.6, t0);
      hole(ctx, point, normal, CELL.HOLE_CONCRETE, CELL.HOLE_CONCRETE_N, rng.range(0.08, 0.12));
      break;
    }
    case 'metal': {
      sparks(ctx, point, _axis, floorY, budgetCount(24, s), 11, 0.8, 0.55, 4.2, t0, 0.014);
      sparks(ctx, point, _refl, floorY, budgetCount(4, s), 17, 0.22, 0.5, 5.2, t0, 0.022); // ricochet
      sparks(ctx, point, _axis, floorY, budgetCount(12, s), 3.5, 1.25, 0.2, 2.6, t0, 0.008, CELL.SPARK);
      glow(ctx, point, normal, 0.07, 2.5, 0.06, t0);
      dust(ctx, point, normal, _refl, floorY, 2, { r: 0.3, g: 0.3, b: 0.3, alpha: 0.4, size0: 0.03, size1: 0.18, life: 0.5, speed: 1.2, up: 0.3, drag: 3 }, t0);
      hole(ctx, point, normal, CELL.HOLE_METAL, CELL.HOLE_METAL_N, rng.range(0.06, 0.085), { roughness: 0.3, metalness: 0.9 });
      ctx.lights.flash(_p.copy(point).addScaledVector(normal, 0.08), _col.setRGB(1, 0.62, 0.3), 5, 0.1, 2.5);
      break;
    }
    case 'wood': {
      chips(ctx, point, _axis, floorY, budgetCount(12, s), { r: 0.58, g: 0.42, b: 0.25, size0: 0.02, size1: 0.06, speed: 4.5, spread: 0.7, cellBase: CELL.SPLINTER, cellN: CELL.SPLINTER_N, spin: 14, drag: 0.7 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(5, s), { r: 0.45, g: 0.32, b: 0.18, size0: 0.006, size1: 0.014, speed: 5, spread: 0.8 }, t0);
      dust(ctx, point, normal, _refl, floorY, budgetCount(4, s), { r: 0.5, g: 0.4, b: 0.27, alpha: 0.32, size0: 0.05, size1: 0.28, life: 0.7, speed: 1.2, up: 0.1 }, t0);
      hole(ctx, point, normal, CELL.HOLE_WOOD, CELL.HOLE_WOOD_N, rng.range(0.08, 0.11));
      break;
    }
    case 'dirt': {
      dust(ctx, point, normal, _refl, floorY, budgetCount(10, s), { r: 0.27, g: 0.2, b: 0.13, alpha: 0.75, size0: 0.1, size1: 0.8, life: 1.6, speed: 1.8, up: 1.0, gravity: 0.2, drag: 2.2, spread: 0.6 }, t0);
      dust(ctx, point, normal, _refl, floorY, budgetCount(4, s), { r: 0.22, g: 0.16, b: 0.1, alpha: 0.85, size0: 0.05, size1: 0.3, life: 0.5, speed: 3, up: 1.2, gravity: 0.6, drag: 2.5, spread: 0.4 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(16, s), { r: 0.26, g: 0.19, b: 0.12, size0: 0.012, size1: 0.045, speed: 5, spread: 0.7, drag: 0.9, cellBase: CELL.CLOD, cellN: CELL.CLOD_N, blur: 0.011, life: 1.3 }, t0);
      hole(ctx, point, normal, CELL.HOLE_DIRT, CELL.HOLE_DIRT_N, rng.range(0.12, 0.18));
      break;
    }
    case 'brick': {
      dust(ctx, point, normal, _refl, floorY, budgetCount(6, s), { r: 0.5, g: 0.3, b: 0.23, alpha: 0.45, size0: 0.08, size1: 0.5, life: 0.8, speed: 1.4, up: 0.15 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(12, s), { r: 0.42, g: 0.24, b: 0.18, size0: 0.008, size1: 0.024, speed: 5.5, spread: 0.65, blur: 0.009, life: 1.2 }, t0);
      sparks(ctx, point, _axis, floorY, budgetCount(2, s), 7, 0.7, 0.18, 1.4, t0);
      hole(ctx, point, normal, CELL.HOLE_BRICK, CELL.HOLE_BRICK_N, rng.range(0.08, 0.11));
      break;
    }
    case 'plaster': {
      // dimmer and smaller than the wall it comes off: at 0.78 albedo with the sun on it these
      // clipped to white and read as cotton balls stuck to the plaster (round-2 [B])
      dust(ctx, point, normal, _refl, floorY, budgetCount(7, s), { r: 0.6, g: 0.58, b: 0.54, alpha: 0.34, size0: 0.07, size1: 0.36, life: 0.9, speed: 1.7, up: 0.1 }, t0);
      dust(ctx, point, normal, _refl, floorY, budgetCount(5, s), { r: 0.58, g: 0.56, b: 0.52, alpha: 0.24, size0: 0.1, size1: 0.44, life: 2.2, speed: 0.6, up: -0.3, gravity: 0.3, drag: 2, curve: 0.5 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(14, s), { r: 0.6, g: 0.58, b: 0.54, size0: 0.01, size1: 0.035, speed: 5, spread: 0.7, blur: 0.009, life: 1.2 }, t0);
      hole(ctx, point, normal, CELL.HOLE_PLASTER, CELL.HOLE_PLASTER_N, rng.range(0.12, 0.17), { alpha: 0.9 });
      break;
    }
    case 'glass': {
      chips(ctx, point, _axis, floorY, budgetCount(14, s), { r: 0.9, g: 1.0, b: 1.15, size0: 0.012, size1: 0.038, speed: 4.5, spread: 0.85, cellBase: CELL.SHARD, cellN: CELL.SHARD_N, lit: 0, additive: 0.45, drag: 0.3, spin: 22, life: 1.3, alpha: 0.6 }, t0);
      sparks(ctx, point, _axis, floorY, budgetCount(8, s), 3, 1.1, 0.25, 1.4, t0, 0.006, CELL.SPARK); // glitter
      dust(ctx, point, normal, _refl, floorY, 3, { r: 0.8, g: 0.85, b: 0.9, alpha: 0.2, size0: 0.05, size1: 0.25, life: 0.5, speed: 1.5, up: 0, drag: 3.5 }, t0);
      hole(ctx, point, normal, CELL.HOLE_GLASS, CELL.HOLE_GLASS_N, rng.range(0.1, 0.15), { roughness: 0.15, alpha: 0.8 });
      break;
    }
    case 'sandbag': {
      chips(ctx, point, _axis, floorY, budgetCount(18, s), { r: 0.58, g: 0.48, b: 0.32, size0: 0.005, size1: 0.014, speed: 3.5, spread: 0.85, drag: 1.2, spin: 4, gravity: 1.3 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(5, s), { r: 0.5, g: 0.42, b: 0.28, size0: 0.02, size1: 0.05, speed: 2.5, spread: 0.9, drag: 1.5, spin: 6, cellBase: CELL.FIBER, cellN: CELL.FIBER_N, life: 1.0 }, t0);
      dust(ctx, point, normal, _refl, floorY, budgetCount(7, s), { r: 0.6, g: 0.5, b: 0.34, alpha: 0.6, size0: 0.06, size1: 0.4, life: 0.9, speed: 1.6, up: -0.2, gravity: 0.5, spread: 0.7 }, t0);
      hole(ctx, point, normal, CELL.HOLE_SANDBAG, CELL.HOLE_SANDBAG_N, rng.range(0.09, 0.13), { alpha: 0.9 });
      break;
    }
    case 'water': {
      chips(ctx, point, normal, NO_FLOOR, budgetCount(12, s), { r: 1.2, g: 1.35, b: 1.5, size0: 0.01, size1: 0.03, speed: 4, spread: 0.5, cellBase: CELL.DROP, cellN: 1, lit: 0, additive: 0.3, drag: 0.6, spin: 2, life: 0.8 }, t0);
      dust(ctx, point, normal, _refl, NO_FLOOR, budgetCount(4, s), { r: 0.8, g: 0.85, b: 0.9, alpha: 0.35, size0: 0.08, size1: 0.35, life: 0.7, speed: 1.2, up: 0.5, drag: 3 }, t0);
      break;
    }
    default: {
      dust(ctx, point, normal, _refl, floorY, budgetCount(6, s), { r: 0.5, g: 0.48, b: 0.45, alpha: 0.5, size0: 0.07, size1: 0.4, life: 0.9, speed: 1.4, up: 0.15 }, t0);
      chips(ctx, point, _axis, floorY, budgetCount(8, s), { r: 0.45, g: 0.43, b: 0.4, size0: 0.008, size1: 0.025, speed: 5, spread: 0.65, blur: 0.009, life: 1.2 }, t0);
      hole(ctx, point, normal, CELL.HOLE_CONCRETE, CELL.HOLE_CONCRETE_N, rng.range(0.07, 0.1));
    }
  }
}

/**
 * Blood: a dark crimson mist that dissipates in ~0.4 s, a directional droplet fan sheet along the
 * shot, stretched droplets that arc and land, splatter on whatever is behind (short raycast),
 * drips on the floor. Headshots are ~2x everything.
 */
export function spawnBlood(ctx: FxContext, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, big: boolean, age = 0): void {
  const t0 = ctx.time - age;
  const { pool, rng, scale } = ctx;
  const floorY = ctx.floorAt(point);
  _d.copy(dir); if (_d.lengthSq() < 1e-6) _d.copy(normal).negate(); _d.normalize();
  const m = big ? 2.0 : 1;
  // mist: eroded dust cells, dark, fast expansion, short life
  const nm = budgetCount(big ? 12 : 6, scale);
  for (let i = 0; i < nm; i++) {
    const d = pool.begin(t0 - rng.range(0, 0.015));
    coneDir(_d, 0.75, rng.next(), rng.next(), _c);
    const sp = rng.range(0.8, 2.4) * m;
    d.pos(point.x + rng.range(-0.04, 0.04), point.y + rng.range(-0.04, 0.04), point.z + rng.range(-0.04, 0.04));
    d.vel(_c.x * sp, _c.y * sp + 0.15, _c.z * sp);
    d.drag = 3.2; d.gravity = 0.25;
    d.size(0.12 * m, rng.range(0.45, 0.7) * m); d.curve = 0.35;
    d.life = rng.range(0.3, 0.5);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-1.5, 1.5);
    const k = rng.range(0.8, 1.2);
    d.color(0.11 * k, 0.009, 0.008, 0.6); d.colorEnd(0.06 * k, 0.005, 0.005, 0); d.fadeIn = 0.02; d.fadeOut = 0.65;
    pool.emit();
  }
  // dense core at the wound
  for (let i = 0; i < 3; i++) {
    const d = pool.begin(t0);
    d.pos(point.x, point.y, point.z);
    d.vel(_d.x * 0.8 + rng.range(-0.3, 0.3), 0.3 + rng.range(-0.3, 0.3), _d.z * 0.8 + rng.range(-0.3, 0.3));
    d.drag = 3; d.gravity = 0.5;
    d.size(0.05 * m, 0.2 * m); d.curve = 0.5; d.life = rng.range(0.18, 0.3);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28);
    d.color(0.08, 0.008, 0.006, 0.85); d.colorEnd(0.06, 0.006, 0.005, 0);
    d.fadeIn = 0; d.fadeOut = 0.6;
    pool.emit();
  }
  // directional fan sheets along the shot (velocity-stretched droplet texture)
  const nf = big ? 3 : 2;
  for (let i = 0; i < nf; i++) {
    const d = pool.begin(t0);
    coneDir(_d, 0.25, rng.next(), rng.next(), _c);
    const sp = rng.range(3, 5) * m;
    const len = rng.range(0.35, 0.6) * m;
    d.pos(point.x + _c.x * len * 0.5, point.y + _c.y * len * 0.5, point.z + _c.z * len * 0.5);
    d.vel(_c.x * sp, _c.y * sp + 0.3, _c.z * sp);
    d.gravity = 0.8; d.drag = 4;
    d.mode = MODE_STRETCH; d.stretch = len / sp;
    d.size(rng.range(0.14, 0.22) * m, rng.range(0.2, 0.3) * m);
    d.life = rng.range(0.2, 0.3);
    d.cell = CELL.BLOOD_SPRAY + rng.int(0, CELL.BLOOD_SPRAY_N - 1); d.lit = 0;
    d.rot = rng.next() < 0.5 ? 0 : Math.PI;
    d.color(1, 1, 1, 0.9); d.colorEnd(0.8, 0.8, 0.8, 0); d.fadeIn = 0; d.fadeOut = 0.5;
    pool.emit();
  }
  // spurt: stretched droplets that arc and land
  const nd = budgetCount(big ? 34 : 16, scale);
  for (let i = 0; i < nd; i++) {
    const d = pool.begin(t0);
    coneDir(_d, 0.4, rng.next(), rng.next(), _c);
    const sp = rng.range(2.5, 8.5) * (big ? 1.35 : 1);
    d.pos(point.x, point.y, point.z);
    d.vel(_c.x * sp + normal.x * 0.4, _c.y * sp + 0.5, _c.z * sp + normal.z * 0.4);
    d.gravity = 1; d.drag = rng.range(0.6, 1.1); d.floorY = floorY;
    d.mode = MODE_STRETCH; d.stretch = rng.range(0.014, 0.03);
    const sz = rng.range(0.005, 0.014) * (big ? 1.25 : 1); d.size(sz, sz * 0.8);
    d.life = rng.range(0.35, 0.8);
    d.cell = CELL.DROP; d.lit = 0;
    d.color(1, 1, 1, 1); d.colorEnd(0.7, 0.7, 0.7, 1);
    d.fadeIn = 0; d.fadeOut = 0.25;
    pool.emit();
  }
  // splatter behind
  const hit = ctx.raycast(point, _d, big ? 4.5 : 3);
  if (hit) {
    _p.set(hit.point[0], hit.point[1], hit.point[2]); _n.set(hit.normal[0], hit.normal[1], hit.normal[2]);
    _proj.copy(_d).addScaledVector(_n, -_d.dot(_n));
    let rot = rng.range(-0.15, 0.15);
    if (_proj.lengthSq() > 1e-4) {
      _b.set(0, 1, 0); if (Math.abs(_n.y) > 0.95) _b.set(0, 0, 1);
      _b.addScaledVector(_n, -_b.dot(_n)).normalize();
      _t.crossVectors(_b, _n);
      // spray texture opens toward +x; sprite +x = tangent t rotated by rot
      rot = -Math.atan2(_proj.dot(_b), _proj.dot(_t)) + rng.range(-0.1, 0.1);
    }
    const dist = hit.distance;
    const size = (big ? rng.range(0.9, 1.3) : rng.range(0.5, 0.8)) * (1 + dist * 0.12);
    ctx.decals.place(_p, _n, CELL.BLOOD_SPRAY + rng.int(0, CELL.BLOOD_SPRAY_N - 1), size, { rot, alpha: 0.9, roughness: 0.55, tint: BLOOD_TINT, exposure: BLOOD_EXPOSURE });
    if (Math.abs(_n.y) < 0.6) {
      _p.addScaledVector(_t, rng.range(-0.15, 0.15) * size).addScaledVector(_b, rng.range(-0.05, 0.2) * size);
      ctx.decals.place(_p, _n, CELL.BLOOD_DRIP + rng.int(0, CELL.BLOOD_DRIP_N - 1), size * rng.range(0.45, 0.65), { rot: rng.range(-0.1, 0.1), alignDown: true, alpha: 0.95, roughness: 0.5, tint: BLOOD_TINT, exposure: BLOOD_EXPOSURE });
    } else if (big || rng.next() < 0.5) {
      ctx.decals.place(_p, _n, CELL.BLOOD_SPLAT + rng.int(0, CELL.BLOOD_SPLAT_N - 1), size * rng.range(0.35, 0.5), { rot: rng.range(0, 6.28), alpha: 0.95, roughness: 0.32, tint: BLOOD_TINT, exposure: BLOOD_EXPOSURE });
    }
  }
  // drips / pool under the wound
  _c.set(0, -1, 0);
  const down = ctx.raycast(point, _c, 2.2);
  if (down) {
    _p.set(down.point[0] + rng.range(-0.15, 0.15), down.point[1], down.point[2] + rng.range(-0.15, 0.15)); _n.set(down.normal[0], down.normal[1], down.normal[2]);
    ctx.decals.place(_p, _n, CELL.BLOOD_SPLAT + rng.int(0, CELL.BLOOD_SPLAT_N - 1), (big ? 0.4 : 0.22) * rng.range(0.8, 1.3), { rot: rng.range(0, 6.28), alpha: 0.9, roughness: 0.3, tint: BLOOD_TINT, exposure: 0.7 });
    if (big) ctx.decals.place(_p, _n, CELL.BLOOD_POOL + rng.int(0, CELL.BLOOD_POOL_N - 1), rng.range(0.5, 0.7), { rot: rng.range(0, 6.28), alpha: 0.9, roughness: 0.25, tint: BLOOD_TINT, exposure: 0.7 });
  }
}
