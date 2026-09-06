import * as THREE from 'three';
import { CELL } from './Atlas';
import { LIT_NORMAL, MODE_AXIS, MODE_STRETCH, type ParticlePool } from './ParticlePool';
import type { LightPool } from './Lights';
import type { FxContext } from './Context';

/**
 * Muzzle flash + tracers.
 *
 * Shape: a bore-axis cone (axis billboard, ~0.35 m, spiky, hot throat), 2-3 compensator petals
 * (side + top), one of 4 star cores seen down the bore, and a pin-point HDR hot spot. Life is
 * ~3 frames; a smoke wisp drifts forward afterwards and a warm light hits the walls and the gun.
 *
 * PLACEMENT (this was the "flash orphaned 800 px from the gun" bug). The player's flash lives in
 * the viewmodel pool, and the viewmodel is drawn with its own camera at its own FOV. Deriving its
 * position from a world-space point is wrong twice over: the weapon reports a *FOV-corrected*
 * world position (viewmodel offsets are scaled by tan(vmFov/2)/tan(worldFov/2) so the gun lands on
 * the same pixels), and the naive inverse `vmCamera.matrixWorld * camera.matrixWorldInverse` does
 * not undo that scale — so the flash drifted off the barrel, and any caller passing a hand-built
 * world position put it in open space. So: when the weapon's `muzzle` socket is available we read
 * the flash transform straight off `socket.matrixWorld` (it is already in viewmodel space, and it
 * is the same transform the barrel is drawn with, so the flash cannot drift from the bore by
 * construction). `worldPos` is then only used for the things that genuinely live in the world:
 * the smoke wisps and the scene light.
 *
 * DEPTH. The viewmodel scene is drawn after a depth clear, so a viewmodel-space quad has no world
 * geometry to depth-test against and would happily paint over a wall 20 cm from the muzzle. The
 * pool material depth-tests within the viewmodel scene (so the barrel occludes the flash), and on
 * top of that the cone length is clamped to the free distance ahead of the muzzle in the world, so
 * the flash can never draw through something it should be inside of.
 */
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _wd = new THREE.Vector3(), _r = new THREE.Vector3(), _rn = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Matrix4(), _m3 = new THREE.Matrix3(), _col = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
const _col2 = new THREE.Vector3();
const _ro = { x: 0, y: 0, z: 0 }, _rd = { x: 0, y: 0, z: 0 };

/** Max distance the flash cone may extend from the muzzle, given the geometry in front of it. */
function clearAhead(ctx: FxContext, worldPos: THREE.Vector3, dir: THREE.Vector3, want: number): number {
  _ro.x = worldPos.x; _ro.y = worldPos.y; _ro.z = worldPos.z;
  _rd.x = dir.x; _rd.y = dir.y; _rd.z = dir.z;
  const hit = ctx.raycast(_ro, _rd, want * 1.2);
  return hit ? Math.max(0.04, hit.distance * 0.85) : want;
}

/** Slots the last socket-parented flash wrote, so Fx can keep them pinned to the muzzle. */
export interface FlashSlots { first: number; count: number; t0: number }

export function spawnMuzzleFlash(ctx: FxContext, viewPool: ParticlePool | null, viewLights: LightPool | null, camera: THREE.Camera, vmCamera: THREE.Camera, worldPos: THREE.Vector3, dir: THREE.Vector3, scale: number, socket: THREE.Object3D | null = null, outSlots: FlashSlots | null = null): void {
  const t0 = ctx.time;
  const { pool, rng } = ctx;
  _wd.copy(dir); if (_wd.lengthSq() < 1e-6) _wd.set(0, 0, -1); _wd.normalize();

  // --- world: smoke wisps + light (the world glow is small; the bright shape lives in the viewmodel pool) ---
  for (let i = 0; i < 3; i++) {
    const d = pool.begin(t0 + 0.03 + i * 0.02);
    d.pos(worldPos.x + _wd.x * (0.08 + i * 0.1) * scale, worldPos.y + _wd.y * (0.08 + i * 0.1) * scale, worldPos.z + _wd.z * (0.08 + i * 0.1) * scale);
    d.vel(_wd.x * 1.6 + rng.range(-0.3, 0.3), _wd.y * 1.6 + 0.45 + rng.range(-0.2, 0.2), _wd.z * 1.6 + rng.range(-0.3, 0.3));
    d.drag = 3.0; d.gravity = -0.05;
    d.size(0.04 * scale, rng.range(0.22, 0.34) * scale); d.curve = 0.45;
    d.life = rng.range(0.5, 0.8);
    d.lit = LIT_NORMAL; d.cell = CELL.SMOKE + rng.int(0, CELL.SMOKE_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-1.5, 1.5);
    d.color(0.62, 0.6, 0.58, 0.28); d.colorEnd(0.62, 0.6, 0.58, 0); d.fadeIn = 0.12; d.fadeOut = 0.7;
    pool.emit();
  }
  // The scene light. Two things decide whether it reads:
  //  - the HOLD. Held at full for the first half of its life so the frame *after* the shot still
  //    shows the wall lit; a 1-frame pop is invisible in a still and in most gameplay frames.
  //  - the RANGE, which is what was missing. three.js windows a point light to exactly zero at
  //    `distance`, so a 4.5 m radius put the flash's whole contribution inside the player's own
  //    footprint: fx_muzzle (wall at 3.4 m) lit beautifully while weapon_ar_fire and enemy_firing,
  //    whose nearest surfaces are 5-8 m out, got literally nothing. Same light, same call - the
  //    falloff curve was the bug. 15 m lets inverse-square do the work out to where the geometry
  //    actually is; the intensity comes down to keep the near field where it was, since the hero
  //    frame's wall is already within a stop of clipping.
  _p.copy(worldPos).addScaledVector(_wd, 0.22 * scale);
  ctx.lights.flash(_p, _col.setRGB(1, 0.72, 0.38), 16 * scale, 0.13, 15 * scale, 0.12, 0.45);

  // --- flash shape: viewmodel space when we have a socket, otherwise the caller's world transform ---
  const vp = viewPool ?? pool;
  if (viewPool && socket) {
    socket.updateWorldMatrix(true, false);
    _p.setFromMatrixPosition(socket.matrixWorld);
    _d.set(0, 0, -1).transformDirection(socket.matrixWorld).normalize();
  } else if (viewPool) {
    camera.updateMatrixWorld(); vmCamera.updateMatrixWorld();
    _m.multiplyMatrices(vmCamera.matrixWorld, camera.matrixWorldInverse);
    _p.copy(worldPos).applyMatrix4(_m);
    _m3.setFromMatrix4(_m);
    _d.copy(_wd).applyMatrix3(_m3).normalize();
  } else { _p.copy(worldPos); _d.copy(_wd); }
  _r.crossVectors(_d, _up); if (_r.lengthSq() < 1e-4) _r.set(1, 0, 0); _r.normalize();
  _u.crossVectors(_r, _d).normalize();
  // the same warm pop inside the viewmodel scene, so the flash lights the receiver and the glove
  if (viewLights) viewLights.flash(_col2.copy(_p).addScaledVector(_d, 0.16 * scale), _col.setRGB(1, 0.72, 0.4), 26 * scale, 0.1, 3.2 * scale, 0.15, 0.35);
  const firstSlot = vp.nextSlot;
  const life = 0.075; // ~4.5 frames: the shape is at full brightness for 1-2 frames, then a fast afterglow
  const frame = rng.int(0, CELL.FLASH_N - 1);
  const hot = rng.range(0.85, 1.15);
  // never longer than the free space in front of the real muzzle: the viewmodel scene has no world
  // depth to test against, so this is what stops the cone painting over a nearby wall
  const room = clearAhead(ctx, worldPos, _wd, 0.5 * scale);
  const coneLen = Math.min(rng.range(0.34, 0.46) * scale, room);
  // bore-axis cone (axis billboard: base at the muzzle, tip `coneLen` out)
  {
    const d = vp.begin(t0);
    d.pos(_p.x + _d.x * 0.01, _p.y + _d.y * 0.01, _p.z + _d.z * 0.01);
    d.mode = MODE_AXIS; d.normal(_d.x, _d.y, _d.z); d.stretch = coneLen;
    d.size(rng.range(0.125, 0.16) * scale, rng.range(0.15, 0.195) * scale); d.life = life; d.additive = 1; d.cell = CELL.FLASH_CONE; d.curve = 0.5;
    d.color(3.0 * hot, 2.0 * hot, 1.0 * hot, 1); d.colorEnd(1.5, 0.6, 0.16, 0); d.fadeIn = 0; d.fadeOut = 0.55;
    vp.emit();
  }
  // compensator petals: two sides + top, shorter and thinner
  let petals = 0;
  for (let s = 0; s < 3; s++) {
    if (s === 2 && rng.next() < 0.4) break;
    petals++;
    const ax = s === 0 ? _r : s === 1 ? _rn.copy(_r).negate() : _u;
    const d = vp.begin(t0);
    const back = 0.035 * scale;
    d.pos(_p.x - _d.x * back + ax.x * 0.012, _p.y - _d.y * back + ax.y * 0.012, _p.z - _d.z * back + ax.z * 0.012);
    d.mode = MODE_AXIS; d.normal(ax.x + _d.x * 0.35, ax.y + _d.y * 0.35, ax.z + _d.z * 0.35); d.stretch = Math.min(rng.range(0.14, 0.2) * scale, room * 0.5);
    d.size(0.055 * scale, 0.065 * scale); d.life = life * 0.9; d.additive = 1; d.cell = CELL.FLASH_SIDE; d.curve = 0.5;
    d.color(2.2 * hot, 1.5 * hot, 0.8 * hot, 1); d.colorEnd(1.2, 0.45, 0.12, 0); d.fadeIn = 0; d.fadeOut = 0.6;
    vp.emit();
  }
  // star core (down-the-bore view) + tiny white-hot point
  {
    const d = vp.begin(t0);
    d.pos(_p.x + _d.x * 0.04 * scale, _p.y + _d.y * 0.04 * scale, _p.z + _d.z * 0.04 * scale);
    d.size(0.185 * scale, 0.23 * scale); d.life = life; d.additive = 1; d.cell = CELL.FLASH + frame;
    d.rot = rng.range(0, 6.28);
    d.color(2.2 * hot, 1.5 * hot, 0.75 * hot, 1); d.colorEnd(1.1, 0.42, 0.1, 0); d.fadeIn = 0; d.fadeOut = 0.5;
    vp.emit();
  }
  {
    const d = vp.begin(t0);
    d.pos(_p.x + _d.x * 0.03 * scale, _p.y + _d.y * 0.03 * scale, _p.z + _d.z * 0.03 * scale);
    d.size(0.035 * scale, 0.025 * scale); d.life = life * 0.7; d.additive = 1; d.cell = CELL.GLOW;
    d.color(3.4, 2.4, 1.3, 1); d.colorEnd(1.6, 0.8, 0.25, 0); d.fadeIn = 0; d.fadeOut = 0.6;
    vp.emit();
  }
  // a few unburnt-powder sparks thrown forward
  const ns = 4 + rng.int(0, 3);
  for (let i = 0; i < ns; i++) {
    const d = vp.begin(t0);
    d.pos(_p.x + _d.x * 0.05, _p.y + _d.y * 0.05, _p.z + _d.z * 0.05);
    const sp = rng.range(6, 14) * scale;
    d.vel(_d.x * sp + _r.x * rng.range(-1.5, 1.5) + _u.x * rng.range(-1, 1.5), _d.y * sp + _r.y * rng.range(-1.5, 1.5) + _u.y * rng.range(-1, 1.5), _d.z * sp + _r.z * rng.range(-1.5, 1.5) + _u.z * rng.range(-1, 1.5));
    d.gravity = 0.6; d.drag = 2.5;
    d.mode = MODE_STRETCH; d.stretch = 0.012;
    const sz = rng.range(0.004, 0.008); d.size(sz, sz * 0.5);
    d.life = rng.range(0.06, 0.16);
    d.additive = 1; d.cell = CELL.STREAK;
    d.color(3.5, 2.2, 0.9, 1); d.colorEnd(1.5, 0.4, 0.05, 1); d.fadeIn = 0; d.fadeOut = 0.5;
    vp.emit();
  }
  if (outSlots) {
    // Everything except the sparks, which have their own velocity and should not be dragged along.
    // cone + petals + star core + hot point; the sparks have their own velocity and are not held
    outSlots.first = firstSlot; outSlots.count = 3 + petals; outSlots.t0 = t0;
  }
}

/** Fast bright streak from `from` to `to`; the streak length is fixed (~2.2m) and lifetime = distance / speed. */
export function spawnTracer(ctx: FxContext, from: THREE.Vector3, to: THREE.Vector3): void {
  _d.subVectors(to, from);
  const len = _d.length(); if (len < 0.5) return;
  _d.divideScalar(len);
  const speed = 240;
  const d = ctx.pool.begin(ctx.time);
  d.pos(from.x, from.y, from.z);
  d.vel(_d.x * speed, _d.y * speed, _d.z * speed); d.drag = 0; d.gravity = 0;
  d.mode = MODE_STRETCH; d.stretch = 2.4 / speed;
  d.size(0.022, 0.02); d.life = Math.max(0.03, len / speed);
  d.additive = 1; d.cell = CELL.STREAK;
  d.color(6, 4.2, 2.4, 1); d.colorEnd(4.5, 2.8, 1.3, 1); d.fadeIn = 0.02; d.fadeOut = 0.25;
  ctx.pool.emit();
}
